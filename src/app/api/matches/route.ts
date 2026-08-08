import { asc, desc, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { buildLiveMarkets, buildMarkets, minuteNumber } from "@/lib/markets";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();

  await runLiveEngine();

  const rows = await db
    .select()
    .from(matches)
    .where(inArray(matches.source, ["virtual", "manual"]))
    .orderBy(
      // Live d'abord, puis à venir, puis terminés
      asc(
        sql`CASE ${matches.status} WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END`
      ),
      asc(matches.startsAt),
      desc(matches.id)
    );

  const withMarkets = rows.map((m) => {
    // En direct : cotes live sur TOUS les marchés, issues déjà décidées retirées.
    const markets =
      m.status === "live"
        ? buildLiveMarkets(
            m.homeTeam,
            m.awayTeam,
            m.homeScore ?? 0,
            m.awayScore ?? 0,
            minuteNumber(m.minute),
            {
              homeForm: m.homeForm ?? 1,
              awayForm: m.awayForm ?? 1,
              redHome: m.redHome ?? 0,
              redAway: m.redAway ?? 0,
            }
          )
        : buildMarkets(m.homeTeam, m.awayTeam);
    return { ...m, markets };
  });

  return NextResponse.json({ matches: withMarkets });
}
