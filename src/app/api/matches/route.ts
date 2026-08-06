import { asc, desc, sql } from "drizzle-orm";
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
        ? buildLiveMarkets(m.homeTeam, m.awayTeam, m.homeScore ?? 0, m.awayScore ?? 0, minuteNumber(m.minute))
        : buildMarkets(m.homeTeam, m.awayTeam);
    return { ...m, markets };
  });

  return NextResponse.json({ matches: withMarkets });
}
