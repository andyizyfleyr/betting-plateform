import type { MatchRow } from "@/db/schema";
import type { ClientMatch } from "@/lib/api";
import { computeMatchTelemetry } from "@/lib/live-telemetry";
import {
  buildLiveMarkets,
  buildMarkets,
  buildRealMatchMarkets,
  isRealMatchKickoffReached,
  isRealMatchPostIncidentSuspended,
  minuteNumber,
} from "@/lib/markets";
import { reconcileRedCardCounts, sanitizeMatchEvents } from "@/lib/match-events";
import { isRealMatchFeedStale } from "@/lib/real-sports-feed";
import { teamLogo } from "@/lib/team-logos";

function toIsoString(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString();
  return typeof v === "string" ? v : v.toISOString();
}

function toNullableIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.toISOString();
}

/**
 * Sérialise une ligne `MatchRow` (réelle ou virtuelle) en contrat public `ClientMatch`,
 * en masquant strictement tous les champs internes serveur (`tickHistory`, `scriptedEvents`, `regime`, etc.).
 */
export function serializePublicMatch(rawRow: MatchRow, now = Date.now()): ClientMatch {
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
  const m: MatchRow = {
    ...rawRow,
    events: cleanEvents,
    redHome: cleanRedHome,
    redAway: cleanRedAway,
  };
  const isReal = m.source === "manual";

  const {
    regime: _regime,
    homeForm: _homeForm,
    awayForm: _awayForm,
    scenarioLocked: _scenarioLocked,
    scenarioNonce: _scenarioNonce,
    tickHistory: _tickHistory,
    scriptedEvents: _scriptedEvents,
    ...publicMatch
  } = m;
  void _regime;
  void _homeForm;
  void _awayForm;
  void _scenarioLocked;
  void _scenarioNonce;
  void _tickHistory;
  void _scriptedEvents;

  const normalizedStatus: ClientMatch["status"] =
    m.status === "live" || m.status === "finished" ? m.status : "upcoming";

  if (isReal) {
    const kickoffReached = isRealMatchKickoffReached(m, now);
    const postIncidentSuspended = isRealMatchPostIncidentSuspended(m, now);
    const feedStale = isRealMatchFeedStale(m, now);
    const effectiveSuspended =
      Boolean(m.suspended) || kickoffReached || postIncidentSuspended || feedStale;
    const markets = buildRealMatchMarkets(m, now);
    const resGroup = markets.find((g) => g.key === "result");
    const oddsHome =
      resGroup?.outcomes.find((o) => o.key === "home")?.odds ?? m.oddsHome;
    const oddsDraw = resGroup
      ? (resGroup.outcomes.find((o) => o.key === "draw")?.odds ?? m.oddsDraw)
      : m.oddsDraw;
    const oddsAway =
      resGroup?.outcomes.find((o) => o.key === "away")?.odds ?? m.oddsAway;

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
      status: normalizedStatus,
      startsAt: toIsoString(m.startsAt),
      finishedAt: toNullableIso(m.finishedAt),
      source: "manual" as const,
      homeLogo: teamLogo(m.homeTeam, m.homeLogo),
      awayLogo: teamLogo(m.awayTeam, m.awayLogo),
      oddsHome,
      oddsDraw,
      oddsAway,
      kickoffReached,
      suspended: effectiveSuspended,
      redHome: m.redHome ?? 0,
      redAway: m.redAway ?? 0,
      events: m.events ?? [],
      realStats: m.realStats ?? null,
      htHomeScore: m.htHomeScore ?? m.realStats?.htHomeScore ?? null,
      htAwayScore: m.htAwayScore ?? m.realStats?.htAwayScore ?? null,
      externalId: m.externalId ?? null,
      autoSync: Boolean(m.autoSync ?? true),
      markets,
      marketCount: markets.length,
    };
  }

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
  const oddsHome =
    resGroup?.outcomes.find((o) => o.key === "home")?.odds ?? m.oddsHome;
  const oddsDraw = resGroup
    ? (resGroup.outcomes.find((o) => o.key === "draw")?.odds ?? m.oddsDraw)
    : m.oddsDraw;
  const oddsAway =
    resGroup?.outcomes.find((o) => o.key === "away")?.odds ?? m.oddsAway;

  const telemetry = m.status === "live" ? computeMatchTelemetry(m) : undefined;

  return {
    ...publicMatch,
    status: normalizedStatus,
    startsAt: toIsoString(m.startsAt),
    finishedAt: toNullableIso(m.finishedAt),
    source: "virtual" as const,
    homeLogo: teamLogo(m.homeTeam, m.homeLogo),
    awayLogo: teamLogo(m.awayTeam, m.awayLogo),
    oddsHome,
    oddsDraw,
    oddsAway,
    suspended: Boolean(m.suspended),
    redHome: m.redHome ?? 0,
    redAway: m.redAway ?? 0,
    events: m.events ?? [],
    ...(telemetry ? { telemetry } : {}),
    markets,
    marketCount: markets.length,
  };
}

/**
 * Version ultra-légère (~88 % d'octets en moins) pour le polling 5 s mobile (`GET /api/matches/slim`).
 * Conserve l'intégralité des cotes 1X2 live, scores, minute, cartons rouges, logos, `marketCount`
 * et uniquement le groupe `result` dans `markets`, tandis que `GET /api/matches/[id]` sert les
 * 18–19 groupes complets + `realStats` + `telemetry` à la demande.
 */
export function serializeSlimPublicMatch(rawRow: MatchRow, now = Date.now()): ClientMatch {
  const full = serializePublicMatch(rawRow, now);
  const resGroup = full.markets.find((g) => g.key === "result");
  const { telemetry: _telemetry, realStats: _realStats, ...rest } = full;
  void _telemetry;
  void _realStats;
  return {
    ...rest,
    realStats: null,
    marketCount: full.markets.length,
    markets: resGroup ? [resGroup] : [],
  };
}
