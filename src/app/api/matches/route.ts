import { asc, desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { buildMarkets } from "@/lib/markets";

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
    const markets = buildMarkets(m.homeTeam, m.awayTeam);
    if (m.status === "live") {
      // Le marché « Résultat » reflète les cotes live (score en cours), comme les
      // grandes plateformes : le favori est coté bas, l'équipe menée très haut.
      const result = markets.find((g) => g.key === "result");
      if (result) {
        const liveOdds: Record<string, number | null> = {
          home: m.oddsHome,
          draw: m.oddsDraw,
          away: m.oddsAway,
        };
        result.outcomes = result.outcomes.map((o) =>
          liveOdds[o.key] != null ? { ...o, odds: liveOdds[o.key] as number } : o
        );
      }
    }
    return { ...m, markets };
  });

  return NextResponse.json({ matches: withMarkets });
}
