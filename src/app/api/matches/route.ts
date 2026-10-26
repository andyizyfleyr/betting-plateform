import { NextRequest } from "next/server";
import { ensureSeeded } from "@/db/seed";
import {
  ensureMatchStoreHydrated,
  getCachedAllMatchesForFeed,
} from "@/lib/active-state-cache";
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
  publicJsonWithEdgeCache,
  runSingleflight,
  setMatchesPayloadCache,
} from "@/lib/response-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MATCHES_EDGE_POLICY = {
  maxAge: 1,
  sMaxAge: 4,
  staleWhileRevalidate: 8,
} as const;

export async function GET(req: NextRequest) {
  try {
    // Protection anti-cache-busting (ex. attaque `?random=...` contournant l'URL canonique du CDN) :
    // renvoie immédiatement le tampon RAM existant sans ré-exécuter de synchronisation.
    if (req.nextUrl.searchParams.size > 0) {
      const anyRam = getMatchesPayloadCache(true);
      if (anyRam) {
        return publicJsonWithEdgeCache(req, null, anyRam, MATCHES_EDGE_POLICY);
      }
    }

    const stored = await runSingleflight("api:matches", async () => {
      await ensureSeeded();
      await ensureMlLoaded();
      await syncLiveMatchesThrottled();

      const freshCached = getMatchesPayloadCache();
      if (freshCached) {
        return freshCached;
      }

      await ensureMatchStoreHydrated();
      const now = Date.now();
      // 0 requête SQL à chaud : lit directement le store mémoire synchronisé (matchs réels + virtuels)
      const rows = getCachedAllMatchesForFeed();

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
      return setMatchesPayloadCache(payload);
    });

    return publicJsonWithEdgeCache(req, null, stored, MATCHES_EDGE_POLICY);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/matches");
  }
}
