import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { formatServerErrorResponse } from "@/lib/db-error";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    const [user] = await db.select({ role: appUser.role }).from(appUser).where(eq(appUser.id, uid));
    if (user?.role !== "admin") return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM deposits WHERE status='pending_review') AS deposits_review,
        (SELECT count(*)::int FROM deposits WHERE status='pending' AND created_at < now() - interval '24 hours') AS deposits_stale,
        (SELECT count(*)::int FROM deposits WHERE status IN ('failed','expired','rejected') AND updated_at >= now() - interval '7 days') AS deposits_failed,
        (SELECT count(*)::int FROM withdrawals WHERE status='pending' AND created_at < now() - interval '24 hours') AS withdrawals_stale,
        (SELECT count(*)::int FROM push_outbox WHERE sent_at IS NULL AND attempts >= 5) AS push_failed,
        (SELECT count(*)::int FROM bets b JOIN matches m ON m.id=b.match_id WHERE b.status='pending' AND m.status='finished') AS unsettled_bets
    `);
    return NextResponse.json({ monitoring: result.rows[0], observedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return formatServerErrorResponse(e, "GET /api/admin/monitoring"); }
}
