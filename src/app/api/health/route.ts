import { count, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { matches, predictionQuestions } from "@/db/schema";
import { classifyServerError } from "@/lib/db-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    // 1. Test immédiat de connectivité PostgreSQL (< 100 ms) sans dépendre d'aucun flux externe
    await db.execute(sql`SELECT 1`);
    await ensureSeeded();

    const [[live], [matchTotal], [predTotal]] = await Promise.all([
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
      db.select({ n: count() }).from(matches),
      db.select({ n: count() }).from(predictionQuestions),
    ]);

    return NextResponse.json({
      ok: true,
      db: "connected",
      matchesCount: matchTotal?.n ?? 0,
      predictionsCount: predTotal?.n ?? 0,
      liveMatch: live ?? null,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[health] DB check failed:", err);
    const classified = classifyServerError(err);
    return NextResponse.json(
      {
        ok: false,
        db: "error",
        code: classified.code,
        error: classified.message,
      },
      { status: classified.status }
    );
  }
}
