import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { formatServerErrorResponse } from "@/lib/db-error";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function admin(req: NextRequest) {
  await ensureSeeded();
  const uid = await requireUserId(req);
  if (typeof uid !== "number") return uid;
  const [user] = await db.select({ role: appUser.role }).from(appUser).where(eq(appUser.id, uid));
  return user?.role === "admin" ? uid : NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
}

export async function GET(req: NextRequest) {
  try {
    const uid = await admin(req); if (typeof uid !== "number") return uid;
    const rows = await db.execute(sql`
      SELECT * FROM (
        SELECT 'deposit'::text AS kind, d.id, d.status AS payment_status, d.provider AS method,
          d.created_at, d.updated_at AS payment_updated_at, COALESCE(r.state, 'open') AS review_state,
          COALESCE(r.note, '') AS note, r.updated_at AS reviewed_at
        FROM deposits d LEFT JOIN payment_incident_reviews r ON r.kind='deposit' AND r.payment_id=d.id
        WHERE d.status='pending_review' OR (d.status='pending' AND d.created_at < now() - interval '24 hours')
          OR (d.status IN ('failed','expired','rejected') AND d.updated_at >= now() - interval '7 days')
          OR r.state IN ('open','investigating')
        UNION ALL
        SELECT 'withdrawal'::text AS kind, w.id, w.status, w.method,
          w.created_at, COALESCE(w.processed_at,w.created_at), COALESCE(r.state, 'open'),
          COALESCE(r.note, ''), r.updated_at
        FROM withdrawals w LEFT JOIN payment_incident_reviews r ON r.kind='withdrawal' AND r.payment_id=w.id
        WHERE (w.status='pending' AND w.created_at < now() - interval '24 hours')
          OR (w.status='rejected' AND w.processed_at >= now() - interval '7 days')
          OR r.state IN ('open','investigating')
      ) incidents ORDER BY CASE WHEN review_state='resolved' THEN 1 ELSE 0 END, payment_updated_at DESC LIMIT 100
    `);
    return NextResponse.json({ incidents: rows.rows }, { headers });
  } catch (e) { return formatServerErrorResponse(e, "GET /api/admin/payment-incidents"); }
}

export async function PATCH(req: NextRequest) {
  try {
    const uid = await admin(req); if (typeof uid !== "number") return uid;
    const body = await req.json().catch(() => null);
    const kind = body?.kind; const id = Number(body?.id); const state = body?.state;
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!['deposit','withdrawal'].includes(kind) || !Number.isSafeInteger(id) || id <= 0 || !['open','investigating','resolved'].includes(state) || note.length > 1000) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }
    const found = kind === 'deposit'
      ? await db.execute(sql`SELECT id FROM deposits WHERE id=${id}`)
      : await db.execute(sql`SELECT id FROM withdrawals WHERE id=${id}`);
    if (!found.rows.length) return NextResponse.json({ error: "Paiement introuvable" }, { status: 404 });
    await db.transaction(async tx => {
      await tx.execute(sql`INSERT INTO payment_incident_reviews (kind, payment_id, state, note, updated_by, updated_at)
        VALUES (${kind}, ${id}, ${state}, ${note}, ${uid}, now())
        ON CONFLICT (kind, payment_id) DO UPDATE SET state=EXCLUDED.state, note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now()`);
      await tx.execute(sql`INSERT INTO payment_incident_actions (kind, payment_id, state, note, actor_id)
        VALUES (${kind}, ${id}, ${state}, ${note}, ${uid})`);
    });
    return NextResponse.json({ ok: true }, { headers });
  } catch (e) { return formatServerErrorResponse(e, "PATCH /api/admin/payment-incidents"); }
}
