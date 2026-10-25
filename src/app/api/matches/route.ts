import { asc, desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { computeMatchTelemetry } from "@/lib/live-telemetry";
import { buildLiveMarkets, buildMarkets, minuteNumber } from "@/lib/markets";
import { ensureMlLoaded } from "@/lib/ml-engine";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  await ensureMlLoaded();
  await syncLiveMatchesThrottled();

  const allRows = await db
    .select()
    .from(matches)
    .orderBy(
      asc(sql`CASE ${matches.status} WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END`),
      asc(matches.startsAt),
      desc(matches.id)
    );

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

  // Cotes fixes bookmaker basées sur le match (forces, forme, score, minute)
  const withMarkets = rows.map((m) => {
    const formOpts = {
      homeForm: m.homeForm ?? 1,
      awayForm: m.awayForm ?? 1,
      redHome: m.redHome ?? 0,
      redAway: m.redAway ?? 0,
      events: m.events ?? [],
      matchId: m.id,
    };

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
                formOpts
              )
            : buildMarkets(m.homeTeam, m.awayTeam, formOpts);

    const resGroup = markets.find((g) => g.key === "result");
    const oddsHome =
      resGroup?.outcomes.find((o) => o.key === "home")?.odds ?? m.oddsHome;
    const oddsDraw =
      resGroup
        ? (resGroup.outcomes.find((o) => o.key === "draw")?.odds ?? m.oddsDraw)
        : m.oddsDraw;
    const oddsAway =
      resGroup?.outcomes.find((o) => o.key === "away")?.odds ?? m.oddsAway;

    const telemetry =
      m.status === "live" || m.status === "finished"
        ? computeMatchTelemetry(m)
        : undefined;

    // On masque strictement les variables internes du simulateur et les scénarios anticipés admin
    const {
      regime: _regime,
      homeForm: _homeForm,
      awayForm: _awayForm,
      scenarioLocked: _scenarioLocked,
      scenarioNonce: _scenarioNonce,
      scriptedEvents: _scriptedEvents,
      ...publicMatch
    } = m;
    void _regime;
    void _homeForm;
    void _awayForm;
    void _scenarioLocked;
    void _scenarioNonce;
    void _scriptedEvents;

    return {
      ...publicMatch,
      homeLogo: teamLogo(m.homeTeam) || m.homeLogo,
      awayLogo: teamLogo(m.awayTeam) || m.awayLogo,
      oddsHome,
      oddsDraw,
      oddsAway,
      ...(telemetry ? { telemetry } : {}),
      markets,
    };
  });

  return NextResponse.json({ matches: withMarkets });
}
