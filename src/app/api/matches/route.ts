import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { computeMatchTelemetry } from "@/lib/live-telemetry";
import {
  buildLiveMarkets,
  buildMarkets,
  buildRealMatchMarkets,
  isRealMatchKickoffReached,
  isRealMatchPostIncidentSuspended,
  minuteNumber,
} from "@/lib/markets";
import { ensureMlLoaded } from "@/lib/ml-engine";
import { reconcileRedCardCounts, sanitizeMatchEvents } from "@/lib/match-events";
import { isRealMatchFeedStale } from "@/lib/real-sports-feed";
import { formatServerErrorResponse } from "@/lib/db-error";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    await ensureSeeded();
    await ensureMlLoaded();
    await syncLiveMatchesThrottled();

  const now = Date.now();
  // Filtrage et LIMIT directement en SQL (au lieu d'un `SELECT *` complet de tout l'historique)
  // pour réduire de > 99 % le transfert réseau PostgreSQL (Neon egress) à chaque rafraîchissement.
  const [activeRows, finishedManual, finishedVirtual] = await Promise.all([
    db
      .select()
      .from(matches)
      .where(ne(matches.status, "finished"))
      .orderBy(
        asc(sql`CASE ${matches.status} WHEN 'live' THEN 0 ELSE 1 END`),
        asc(matches.startsAt),
        desc(matches.id)
      ),
    db
      .select()
      .from(matches)
      .where(and(eq(matches.source, "manual"), eq(matches.status, "finished")))
      .orderBy(sql`${matches.finishedAt} DESC NULLS LAST`, desc(matches.id))
      .limit(20),
    db
      .select()
      .from(matches)
      .where(and(ne(matches.source, "manual"), eq(matches.status, "finished")))
      .orderBy(sql`${matches.finishedAt} DESC NULLS LAST`, desc(matches.id))
      .limit(12),
  ]);

  const activeManual = activeRows.filter((r) => r.source === "manual");
  const activeVirtual = activeRows.filter((r) => r.source !== "manual");

  const rows = [...activeManual, ...finishedManual, ...activeVirtual, ...finishedVirtual];

  const withMarkets = rows.map((rawRow) => {
    const cleanEvents = sanitizeMatchEvents(
      rawRow.events,
      rawRow.homeScore,
      rawRow.awayScore
    );
    const { redHome: cleanRedHome, redAway: cleanRedAway } = reconcileRedCardCounts(
      rawRow.events,
      cleanEvents,
      rawRow.redHome,
      rawRow.redAway
    );
    const m = {
      ...rawRow,
      events: cleanEvents,
      redHome: cleanRedHome,
      redAway: cleanRedAway,
    };
    const isReal = m.source === "manual";

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

    if (isReal) {
      // Moteur dédié aux matchs réels : cotes officielles de l'admin, verrouillage pré-match à l'heure
      // du coup d'envoi, suspension post-but/carton (18 s), vraies stats officielles (aucune télémétrie virtuelle).
      const kickoffReached = isRealMatchKickoffReached(m, now);
      const postIncidentSuspended = isRealMatchPostIncidentSuspended(m, now);
      const feedStale = isRealMatchFeedStale(m, now);
      const effectiveSuspended =
        Boolean(m.suspended) || kickoffReached || postIncidentSuspended || feedStale;
      const markets = buildRealMatchMarkets(m, now);
      const resGroup = markets.find((g) => g.key === "result");
      const oddsHome = resGroup?.outcomes.find((o) => o.key === "home")?.odds ?? m.oddsHome;
      const oddsDraw = resGroup
        ? (resGroup.outcomes.find((o) => o.key === "draw")?.odds ?? m.oddsDraw)
        : m.oddsDraw;
      const oddsAway = resGroup?.outcomes.find((o) => o.key === "away")?.odds ?? m.oddsAway;

      const {
        feedSyncedAt: _feedSyncedAt,
        feedFinishedAt: _feedFinishedAt,
        feedStatusNote: _feedStatusNote,
        ...cleanRealMatch
      } = publicMatch;
      void _feedSyncedAt;
      void _feedFinishedAt;
      void _feedStatusNote;

      return {
        ...cleanRealMatch,
        source: "manual" as const,
        homeLogo: teamLogo(m.homeTeam, m.homeLogo),
        awayLogo: teamLogo(m.awayTeam, m.awayLogo),
        oddsHome,
        oddsDraw,
        oddsAway,
        kickoffReached,
        suspended: effectiveSuspended,
        realStats: m.realStats ?? null,
        htHomeScore: m.htHomeScore ?? m.realStats?.htHomeScore ?? null,
        htAwayScore: m.htAwayScore ?? m.realStats?.htAwayScore ?? null,
        externalId: m.externalId ?? null,
        autoSync: Boolean(m.autoSync ?? true),
        markets,
      };
    }

    // Moteur dédié aux matchs virtuels (2-3 min)
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
    const oddsHome = resGroup?.outcomes.find((o) => o.key === "home")?.odds ?? m.oddsHome;
    const oddsDraw = resGroup
      ? (resGroup.outcomes.find((o) => o.key === "draw")?.odds ?? m.oddsDraw)
      : m.oddsDraw;
    const oddsAway = resGroup?.outcomes.find((o) => o.key === "away")?.odds ?? m.oddsAway;

    const telemetry =
      m.status === "live" || m.status === "finished"
        ? computeMatchTelemetry(m)
        : undefined;

    return {
      ...publicMatch,
      source: "virtual" as const,
      homeLogo: teamLogo(m.homeTeam, m.homeLogo),
      awayLogo: teamLogo(m.awayTeam, m.awayLogo),
      oddsHome,
      oddsDraw,
      oddsAway,
      ...(telemetry ? { telemetry } : {}),
      markets,
    };
  });

  return NextResponse.json({ matches: withMarkets });
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/matches");
  }
}
