import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { formatServerErrorResponse } from "@/lib/db-error";
import { requireUserId } from "@/lib/session";
import { schedulePushNotifications } from "@/lib/push-notifications";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };
async function authenticate(req: NextRequest) {
  await ensureSeeded();
  const uid = await requireUserId(req);
  if (typeof uid !== "number") return uid;
  const [user] = await db.select({ id: appUser.id, role: appUser.role }).from(appUser).where(eq(appUser.id, uid));
  return user || NextResponse.json({ error: "Compte introuvable" }, { status: 401 });
}
async function touch(uid: number) {
  await db.execute(sql`INSERT INTO support_presence (user_id, last_seen_at) VALUES (${uid}, now())
    ON CONFLICT (user_id) DO UPDATE SET last_seen_at=now()`);
}
async function getConversation(uid: number, role: string, id: number, create: boolean) {
  if (role === "admin") {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const found = await db.execute(sql`SELECT id, user_id FROM support_conversations WHERE id=${id}`);
    return found.rows[0] as { id: number; user_id: number } | undefined;
  }
  if (create) {
    const inserted = await db.execute(sql`INSERT INTO support_conversations (user_id) VALUES (${uid})
      ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id, user_id`);
    return inserted.rows[0] as { id: number; user_id: number } | undefined;
  }
  const found = await db.execute(sql`SELECT id, user_id FROM support_conversations WHERE user_id=${uid}`);
  return found.rows[0] as { id: number; user_id: number } | undefined;
}
export async function GET(req: NextRequest) {
  try {
    const user = await authenticate(req); if (user instanceof NextResponse) return user;
    await touch(user.id);
    const isAdmin = user.role === "admin";
    if (isAdmin && req.nextUrl.searchParams.get("view") !== "messages") {
      const list = await db.execute(sql`SELECT c.id, u.name, c.updated_at,
          (p.last_seen_at > now() - interval '60 seconds') AS online, p.last_seen_at,
          (SELECT count(*)::int FROM support_messages m WHERE m.conversation_id=c.id AND m.sender_role='user' AND m.read_at IS NULL) AS unread
        FROM support_conversations c JOIN app_user u ON u.id=c.user_id
        LEFT JOIN support_presence p ON p.user_id=u.id ORDER BY c.updated_at DESC LIMIT 100`);
      return NextResponse.json({ conversations: list.rows }, { headers: noStore });
    }
    const wantMessages = req.nextUrl.searchParams.get("view") === "messages";
    const conversation = await getConversation(user.id, user.role, Number(req.nextUrl.searchParams.get("id")), wantMessages);
    if (!conversation) return NextResponse.json({ messages: [], unread: 0, adminOnline: false }, { headers: noStore });
    const unread = await db.execute(sql`SELECT count(*)::int AS n FROM support_messages
      WHERE conversation_id=${conversation.id} AND sender_role=${isAdmin ? "user" : "admin"} AND read_at IS NULL`);
    const adminOnline = await db.execute(sql`SELECT EXISTS(SELECT 1 FROM support_presence p JOIN app_user u ON u.id=p.user_id
      WHERE u.role='admin' AND p.last_seen_at > now() - interval '60 seconds') AS online`);
    if (!wantMessages) return NextResponse.json({ unread: unread.rows[0]?.n ?? 0, adminOnline: adminOnline.rows[0]?.online }, { headers: noStore });
    // Marquer uniquement les 100 messages chargés ; jamais les anciens messages invisibles.
    await db.execute(sql`UPDATE support_messages SET read_at=now() WHERE id IN
      (SELECT id FROM support_messages WHERE conversation_id=${conversation.id} ORDER BY id DESC LIMIT 100)
      AND sender_role=${isAdmin ? "user" : "admin"} AND read_at IS NULL`);
    const messages = await db.execute(sql`SELECT id, sender_id, sender_role, body, created_at, read_at FROM
      (SELECT id, sender_id, sender_role, body, created_at, read_at FROM support_messages
      WHERE conversation_id=${conversation.id} ORDER BY id DESC LIMIT 100) m ORDER BY id ASC`);
    return NextResponse.json({ conversationId: conversation.id, messages: messages.rows, unread: 0, adminOnline: adminOnline.rows[0]?.online }, { headers: noStore });
  } catch (e) { return formatServerErrorResponse(e, "GET /api/chat"); }
}
export async function POST(req: NextRequest) {
  try {
    const user = await authenticate(req); if (user instanceof NextResponse) return user;
    if (!checkRateLimit(`chat:${user.id}`, 30, 60_000).allowed) return NextResponse.json({ error: "Trop de messages, réessayez dans une minute." }, { status: 429 });
    const data = await req.json().catch(() => null);
    const text = typeof data?.body === "string" ? data.body.trim() : "";
    const clientId = typeof data?.clientId === "string" ? data.clientId : randomUUID();
    if (!text || text.length > 2000 || !/^[a-zA-Z0-9_-]{8,80}$/.test(clientId)) return NextResponse.json({ error: "Message invalide" }, { status: 400 });
    const conversation = await getConversation(user.id, user.role, Number(data?.conversationId), true);
    if (!conversation) return NextResponse.json({ error: "Discussion introuvable" }, { status: 404 });
    const role = user.role === "admin" ? "admin" : "user";
    const message = await db.transaction(async tx => {
      const result = await tx.execute(sql`INSERT INTO support_messages (conversation_id, sender_id, sender_role, client_id, body)
        VALUES (${conversation.id}, ${user.id}, ${role}, ${clientId}, ${text}) ON CONFLICT (sender_id, client_id) DO NOTHING
        RETURNING id, sender_id, sender_role, body, created_at, read_at`);
      if (!result.rows.length) {
        const previous = await tx.execute(sql`SELECT id, sender_id, sender_role, body, created_at, read_at, conversation_id FROM support_messages WHERE sender_id=${user.id} AND client_id=${clientId}`);
        const row = previous.rows[0];
        if (!row || Number(row.conversation_id) !== conversation.id || row.body !== text) throw new Error("Clé de message déjà utilisée");
        return row;
      }
      const row = result.rows[0];
      await tx.execute(sql`UPDATE support_conversations SET updated_at=now() WHERE id=${conversation.id}`);
      await tx.execute(sql`INSERT INTO push_outbox (token, event_key, title, body, data)
        SELECT d.token, ${'chat:message:'} || ${String(row.id)}, 'Nouveau message', 'Vous avez reçu un message dans votre messagerie.', jsonb_build_object('path', '/chat', 'conversationId', ${conversation.id}::integer)
        FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
        WHERE ${role}='admin' AND u.id=${conversation.user_id} OR (${role}='user' AND u.role='admin')
        ON CONFLICT (token, event_key) DO NOTHING`);
      return row;
    });
    schedulePushNotifications();
    return NextResponse.json({ message }, { headers: noStore });
  } catch (e) { return formatServerErrorResponse(e, "POST /api/chat"); }
}
