import { asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bets, matches } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { buildLiveMarkets, buildMarkets, minuteNumber } from "@/lib/markets";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  await runLiveEngine();

  const allRows = await db
    .select()
    .from(matches)
    .where(eq(matches.source, "manual"))
    .orderBy(
      asc(sql`CASE ${matches.status} WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END`),
      asc(matches.startsAt),
      desc(matches.id)
    );

  // Conserve tous les matchs en direct / à venir + les 12 derniers terminés (pour l'onglet Résultats)
  const activeRows = allRows.filter((r) => r.status !== "finished");
  const finishedRows = allRows
    .filter((r) => r.status === "finished")
    .sort((a, b) => {
      const ta = a.finishedAt ? a.finishedAt.getTime() : a.startsAt.getTime();
      const tb = b.finishedAt ? b.finishedAt.getTime() : b.startsAt.getTime();
      return tb - ta;
    })
    .slice(0, 12);

  const rows = [...activeRows, ...finishedRows];

  const pending = await db
    .select({
      matchId: bets.matchId,
      market: bets.market,
      selection: bets.selection,
      stake: bets.stake,
      odds: bets.odds,
    })
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
    const exposure = pendingByMatch.get(m.id) ?? [];
    const markets =
      m.status === "finished"
        ? []
        : m.source === "manual" && m.markets && m.markets.length > 0
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

    // Garantit une identité stricte à 0,00 près entre les boutons 1/N/2 de la carte et la feuille de marchés
    const resGroup = markets.find((g) => g.key === "result");
    const oddsHome =
      resGroup?.outcomes.find((o) => o.key === "home")?.odds ?? m.oddsHome;
    const oddsDraw =
      resGroup
        ? (resGroup.outcomes.find((o) => o.key === "draw")?.odds ?? m.oddsDraw)
        : m.oddsDraw;
    const oddsAway =
      resGroup?.outcomes.find((o) => o.key === "away")?.odds ?? m.oddsAway;

    return {
      ...m,
      homeLogo: teamLogo(m.homeTeam) || m.homeLogo,
      awayLogo: teamLogo(m.awayTeam) || m.awayLogo,
      oddsHome,
      oddsDraw,
      oddsAway,
      markets,
    };
  });

  return NextResponse.json({ matches: withMarkets });
}
