import { asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bets, matches } from "@/db/schema";
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
    .where(eq(matches.source, "manual"))
    .orderBy(
      // Live d'abord, puis à venir, puis terminés
      asc(
        sql`CASE ${matches.status} WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END`
      ),
      asc(matches.startsAt),
      desc(matches.id)
    );

  // Exposition du bookmaker par match : les paris en cours resserrent les cotes
  // affichées de la même façon que lors de la validation serveur d'un pari.
  const pending = await db
    .select({ matchId: bets.matchId, market: bets.market, selection: bets.selection, stake: bets.stake, odds: bets.odds })
    .from(bets)
    .where(eq(bets.status, "pending"));
  const pendingByMatch = new Map<number, typeof pending>();
  for (const b of pending) {
    if (b.matchId == null) continue;
    const arr = pendingByMatch.get(b.matchId) ?? [];
    arr.push(b);
    pendingByMatch.set(b.matchId, arr);
  }

  const withMarkets = rows.map((m) => {
    // Match manuel avec marchés saisis par l'admin : servis tels quels.
    const exposure = pendingByMatch.get(m.id) ?? [];
    const markets = m.source === "manual" && m.markets && m.markets.length > 0
      ? m.markets
      : m.status === "live"
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
            },
            exposure
          )
        : buildMarkets(m.homeTeam, m.awayTeam, exposure);
    return { ...m, markets };
  });

  return NextResponse.json({ matches: withMarkets });
}
