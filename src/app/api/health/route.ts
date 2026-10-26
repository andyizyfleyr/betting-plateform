import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  db,
  ensureHealthyDbConnection,
  getActiveDbPoolInfo,
  getCandidateDatabaseUrls,
} from "@/db";
import { ensureSeeded } from "@/db/seed";
import { matches, predictionQuestions } from "@/db/schema";
import { classifyServerError } from "@/lib/db-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const envKeys = getCandidateDatabaseUrls().map((c) => c.envName);
  try {
    await ensureHealthyDbConnection();
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
      pool: getActiveDbPoolInfo(),
      envKeys,
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
        envKeys,
        code: classified.code,
        error: classified.message,
        detail: classified.detail,
      },
      { status: classified.status }
    );
  }
}
