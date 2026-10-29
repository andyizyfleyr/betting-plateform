import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireUserId } from "@/lib/session";
import { formatServerErrorResponse } from "@/lib/db-error";

export const dynamic = "force-dynamic";
const tokenPattern = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!tokenPattern.test(token)) return NextResponse.json({ error: "Jeton de notification invalide" }, { status: 400 });
    await db.transaction(async (tx) => {
      // Sérialise les changements de propriétaire pour un même appareil.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${token}))`);
      // Un appareil partagé ne doit jamais recevoir les notifications du compte précédent.
      await tx.execute(sql`DELETE FROM push_devices WHERE token = ${token} AND user_id <> ${uid}`);
      await tx.execute(sql`INSERT INTO push_devices (token, user_id) VALUES (${token}, ${uid})
        ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()`);
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return formatServerErrorResponse(e, "POST /api/push-devices"); }
}
export async function DELETE(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!tokenPattern.test(token)) return NextResponse.json({ error: "Jeton invalide" }, { status: 400 });
    await db.execute(sql`DELETE FROM push_devices WHERE token = ${token} AND user_id = ${uid}`);
    return NextResponse.json({ ok: true });
  } catch (e) { return formatServerErrorResponse(e, "DELETE /api/push-devices"); }
}
