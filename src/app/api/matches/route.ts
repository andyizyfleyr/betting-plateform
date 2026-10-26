import { and, asc, desc, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
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
import {
  getMatchesPayloadCache,
  jsonWithEtag,
  setMatchesPayloadCache,
} from "@/lib/response-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Projection SQL légère : exclut la colonne JSONB lourde `scripted_events` dès PostgreSQL
const { scriptedEvents: _omitScriptedEvents, ...publicMatchColumns } = getTableColumns(matches);
void _omitScriptedEvents;

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    await ensureMlLoaded();
    await syncLiveMatchesThrottled();

    // Fast-path mémoire (2,5 s, invalidé dès qu'un tick ou une action admin modifie l'état)
    const cached = getMatchesPayloadCache();
    if (cached) {
      return jsonWithEtag(req, null, cached);
    }

  const now = Date.now();
  // UNE SEULE requête SQL `UNION ALL` projetant sans `scripted_events` et bornant les historiques :
  // divise par 3 les allers-retours réseau vers Neon PostgreSQL et minimise la latence Vercel.
  const qActive = db
    .select(publicMatchColumns)
    .from(matches)
    .where(ne(matches.status, "finished"))
    .orderBy(
      asc(sql`CASE ${matches.status} WHEN 'live' THEN 0 ELSE 1 END`),
      asc(matches.startsAt),
      desc(matches.id)
    )
    .limit(120);

  const qFinishedManual = db
    .select(publicMatchColumns)
    .from(matches)
    .where(and(eq(matches.source, "manual"), eq(matches.status, "finished")))
    .orderBy(sql`${matches.finishedAt} DESC NULLS LAST`, desc(matches.id))
    .limit(20);

  const qFinishedVirtual = db
    .select(publicMatchColumns)
    .from(matches)
    .where(and(ne(matches.source, "manual"), eq(matches.status, "finished")))
    .orderBy(sql`${matches.finishedAt} DESC NULLS LAST`, desc(matches.id))
    .limit(12);

  const unifiedRows = await unionAll(qActive, qFinishedManual, qFinishedVirtual);

  const activeManual = unifiedRows.filter((r) => r.source === "manual" && r.status !== "finished");
  const finishedManual = unifiedRows.filter((r) => r.source === "manual" && r.status === "finished");
  const activeVirtual = unifiedRows.filter((r) => r.source !== "manual" && r.status !== "finished");
  const finishedVirtual = unifiedRows.filter((r) => r.source !== "manual" && r.status === "finished");

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

    // On masque strictement les variables internes du simulateur, `tickHistory` et les scénarios anticipés admin
    const {
      regime: _regime,
      homeForm: _homeForm,
      awayForm: _awayForm,
      scenarioLocked: _scenarioLocked,
      scenarioNonce: _scenarioNonce,
      tickHistory: _tickHistory,
      ...publicMatch
    } = m;
    void _regime;
    void _homeForm;
    void _awayForm;
    void _scenarioLocked;
    void _scenarioNonce;
    void _tickHistory;

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
      regime: m.regime ?? null,
      league: m.league ?? null,
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
      m.status === "live"
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

  const payload = { matches: withMarkets };
  const stored = setMatchesPayloadCache(payload);
  return jsonWithEtag(req, payload, stored);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/matches");
  }
}
