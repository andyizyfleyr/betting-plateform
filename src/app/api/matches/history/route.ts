import { isPubliclyOfferedMatch } from "@/lib/real-leagues";
import { NextRequest } from "next/server";
import { and, desc, eq, getTableColumns, ne } from "drizzle-orm";
import { db } from "@/db";
import { hydrateLiveMatchRow } from "@/db/engine";
import { matches, type MatchRow } from "@/db/schema";
import { extractMatchTimelineStats, hasVerifiedGoalTimeline } from "@/db/fixtures";
import { ensureSeeded } from "@/db/seed";
import {
  ensureMatchStoreHydrated,
  getCachedMatchById,
} from "@/lib/active-state-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { computeMatchTelemetry } from "@/lib/live-telemetry";
import {
  buildServerClockAnchor,
  normalizeRealLiveMinuteLabel,
} from "@/lib/live-clock";
import { reconcileRedCardCounts, sanitizeMatchEvents } from "@/lib/match-events";
import { ensureMlLoaded } from "@/lib/ml-engine";
import {
  EDGE_CACHE_TAGS,
  getHistoryBaseCache,
  hasUnexpectedSearchParams,
  isManualRefreshRequest,
  publicJsonWithEdgeCache,
  rejectUnexpectedQueryParams,
  runSingleflight,
  setHistoryBaseCache,
} from "@/lib/response-cache";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";
import { readSecondaryHistory, writeSecondaryHistory } from "@/lib/secondary-history-cache";
import { fetchHyperdriveHistory } from "@/lib/hyperdrive-history";
import type { ClientMatchHistoryItem } from "@/lib/api";

export const dynamic = "force-dynamic";

const HISTORY_EDGE_POLICY = {
  maxAge: 0,
  sMaxAge: 15,
  staleWhileRevalidate: 2,
  tags: [EDGE_CACHE_TAGS.history],
} as const;

// Projection SQL légère : omet les colonnes JSONB volumineuses ou strictement serveur
// (`markets` ~20 Ko/match, `scripted_events`, `tick_history`) lors du chargement de l'historique.
const {
  markets: _omitMarkets,
  scriptedEvents: _omitScriptedEvents,
  tickHistory: _omitTickHistory,
  ...historyMatchColumns
} = getTableColumns(matches);
void _omitMarkets;
void _omitScriptedEvents;
void _omitTickHistory;

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  return v.toISOString();
}

function mapHistoryItem(rawMatch: MatchRow): ClientMatchHistoryItem {
  const cleanEvents = sanitizeMatchEvents(
    rawMatch.events,
    rawMatch.homeScore,
    rawMatch.awayScore
  );
  const { redHome: cleanRedHome, redAway: cleanRedAway } = reconcileRedCardCounts(
    rawMatch.events,
    cleanEvents,
    rawMatch.redHome,
    rawMatch.redAway
  );
  const m: MatchRow = {
    ...rawMatch,
    events: cleanEvents,
    redHome: cleanRedHome,
    redAway: cleanRedAway,
  };
  const isReal = m.source === "manual";
  const hasScore = m.homeScore != null && m.awayScore != null;
  const h = m.homeScore ?? 0;
  const a = m.awayScore ?? 0;

  // Sur un match réel, la mi-temps est affichée dès que le score MT officiel (`htHomeScore`/`htAwayScore`)
  // ou la chronologie complète des buts est connue (jamais d'estimation pseudo-aléatoire).
  const hasExplicitHt =
    isReal && m.htHomeScore != null && m.htAwayScore != null;
  const canComputeHt =
    hasScore &&
    (!isReal ||
      hasExplicitHt ||
      hasVerifiedGoalTimeline(h, a, m.events, m.htHomeScore, m.htAwayScore));

  const timelineStats =
    canComputeHt && !hasExplicitHt
      ? extractMatchTimelineStats(h, a, m.events, m.id)
      : null;

  const htHome = hasExplicitHt ? m.htHomeScore! : (timelineStats?.htHome ?? null);
  const htAway = hasExplicitHt ? m.htAwayScore! : (timelineStats?.htAway ?? null);

  const winnerCode: "V1" | "X" | "V2" | null = !hasScore
    ? null
    : h > a
      ? "V1"
      : h === a
        ? "X"
        : "V2";

  const htWinnerCode: "V1" | "X" | "V2" | null =
    htHome == null || htAway == null
      ? null
      : htHome > htAway
        ? "V1"
        : htHome === htAway
          ? "X"
          : "V2";

  const telemetry =
    !isReal && (m.status === "finished" || m.status === "live")
      ? computeMatchTelemetry(m)
      : undefined;

  return {
    id: m.id,
    sport: m.sport,
    league: m.league,
    source: isReal ? "manual" : "virtual",
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: teamLogo(m.homeTeam, m.homeLogo),
    awayLogo: teamLogo(m.awayTeam, m.awayLogo),
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    htHome,
    htAway,
    status: m.status === "live" || m.status === "finished" ? m.status : "upcoming",
    minute:
      isReal && m.status === "live"
        ? normalizeRealLiveMinuteLabel(m)
        : m.minute,
    startsAt: toIso(m.startsAt) ?? new Date().toISOString(),
    finishedAt: toIso(m.finishedAt),
    oddsHome: m.oddsHome,
    oddsDraw: m.oddsDraw,
    oddsAway: m.oddsAway,
    redHome: m.redHome ?? 0,
    redAway: m.redAway ?? 0,
    events: m.events ?? [],
    telemetry,
    realStats: isReal ? (m.realStats ?? null) : null,
    clockAnchor: m.status === "live" ? buildServerClockAnchor(m) : null,
    winnerCode,
    htWinnerCode,
    totalGoals: hasScore ? h + a : null,
    btts: hasScore ? h > 0 && a > 0 : null,
  };
}

async function getOrBuildBaseHistory(manualRefresh = false): Promise<{
  payload: ReturnType<typeof setHistoryBaseCache>;
  items: ClientMatchHistoryItem[];
  serverTime: string;
}> {
  if (!manualRefresh) {
    const hit = getHistoryBaseCache<ClientMatchHistoryItem>();
    if (hit) return hit;
  }

  return runSingleflight(
    manualRefresh ? "api:matches:history:base:refresh" : "api:matches:history:base",
    async () => {
      if (!manualRefresh) {
        const doubleCheck = getHistoryBaseCache<ClientMatchHistoryItem>();
        if (doubleCheck) return doubleCheck;
      }

      if (!manualRefresh) {
        const secondary = await readSecondaryHistory();
        if (secondary) {
          const payload = setHistoryBaseCache(secondary.items, secondary.serverTime);
          return { payload, items: secondary.items, serverTime: secondary.serverTime };
        }
      }

      await ensureSeeded();
      await ensureMlLoaded();
      await syncLiveMatchesThrottled(false, { manualRefresh });

    const hyperdriveRows = await fetchHyperdriveHistory(manualRefresh);
    const [manualFinished, virtualFinished] = hyperdriveRows ? [hyperdriveRows, []] : await Promise.all([
      db
        .select(historyMatchColumns)
        .from(matches)
        .where(and(eq(matches.status, "finished"), eq(matches.source, "manual")))
        .orderBy(desc(matches.finishedAt), desc(matches.id))
        .limit(120),
      db
        .select(historyMatchColumns)
        .from(matches)
        .where(and(eq(matches.status, "finished"), ne(matches.source, "manual")))
        .orderBy(desc(matches.finishedAt), desc(matches.id))
        .limit(120),
    ]);

    const sortedFinished = [...manualFinished, ...virtualFinished]
      .map((r) => ({ ...r, markets: null, scriptedEvents: null, tickHistory: [] }) as MatchRow)
      .sort((a, b) => {
        const ta = a.finishedAt ? a.finishedAt.getTime() : a.startsAt.getTime();
        const tb = b.finishedAt ? b.finishedAt.getTime() : b.startsAt.getTime();
        return tb - ta || b.id - a.id;
      });

    const mapped = sortedFinished.filter(isPubliclyOfferedMatch).map(mapHistoryItem);
    const serverTime = new Date().toISOString();
    const payload = setHistoryBaseCache(mapped, serverTime);
    await writeSecondaryHistory({ items: mapped, serverTime });
    return { payload, items: mapped, serverTime };
  });
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    if (hasUnexpectedSearchParams(params, ["matchId"])) {
      return rejectUnexpectedQueryParams("Seul le paramètre numérique matchId est autorisé");
    }
    const manualRefresh = isManualRefreshRequest(req);

    const matchIdParam = params.get("matchId");
    let parsedId = NaN;
    if (matchIdParam !== null) {
      if (!/^[1-9]\d{0,9}$/.test(matchIdParam)) {
        return rejectUnexpectedQueryParams("Paramètre matchId numérique invalide");
      }
      parsedId = Number(matchIdParam);
      if (!Number.isInteger(parsedId) || parsedId <= 0 || parsedId > 2_147_483_647) {
        return rejectUnexpectedQueryParams("Paramètre matchId hors plage");
      }
    }
    const hasValidFocusId = Number.isInteger(parsedId) && parsedId > 0;

    const base = await getOrBuildBaseHistory(manualRefresh);

    // Cas majoritaire (99 %+) : `/api/matches/history` sans `matchId` -> sert directement le tampon pré-sérialisé
    if (!hasValidFocusId) {
      return publicJsonWithEdgeCache(req, null, base.payload, HISTORY_EDGE_POLICY);
    }

    let focusedMatch: ClientMatchHistoryItem | null =
      base.items.find((m) => m.id === parsedId) ?? null;

    if (!focusedMatch) {
      await ensureMatchStoreHydrated(manualRefresh);
      const now = Date.now();
      const ramMatch = getCachedMatchById(parsedId);
      if (ramMatch && !manualRefresh) {
        focusedMatch = mapHistoryItem(hydrateLiveMatchRow(ramMatch, now));
      } else {
        const [raw] = await db
          .select(historyMatchColumns)
          .from(matches)
          .where(eq(matches.id, parsedId))
          .limit(1);
        if (raw) {
          focusedMatch = mapHistoryItem(
            hydrateLiveMatchRow(
              {
                ...raw,
                markets: null,
                scriptedEvents: null,
                tickHistory: [],
              } as MatchRow,
              now
            )
          );
        } else if (ramMatch) {
          focusedMatch = mapHistoryItem(hydrateLiveMatchRow(ramMatch, now));
        }
      }
    }

    return publicJsonWithEdgeCache(
      req,
      { matches: base.items, focusedMatch, serverTime: base.serverTime },
      undefined,
      HISTORY_EDGE_POLICY
    );
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/matches/history");
  }
}
