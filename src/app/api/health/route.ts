import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { matches } from "@/db/schema";
import { syncPlatformStateThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    await syncPlatformStateThrottled();
    const [, [live]] = await Promise.all([
      db.execute(sql`SELECT 1`),
      db
        .select({
          id: matches.id,
          homeTeam: matches.homeTeam,
          awayTeam: matches.awayTeam,
          minute: matches.minute,
          homeScore: matches.homeScore,
          awayScore: matches.awayScore,
        })
        .from(matches)
        .where(eq(matches.status, "live"))
        .limit(1),
    ]);
    return NextResponse.json({
      ok: true,
      db: "connected",
      liveMatch: live ?? null,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[health] DB check failed:", err);
    return NextResponse.json({ ok: false, db: "error" }, { status: 500 });
  }
}
