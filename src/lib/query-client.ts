"use client";

import {
  focusManager,
  isServer,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import type { ClientMatch } from "@/lib/api";

export const pulseQueryKeys = {
  realtime: (userId: number | null | undefined) =>
    ["realtime", userId ?? "guest"] as const,
  matches: ["matches", "full"] as const,
  matchesSlim: ["matches", "slim"] as const,
  matchDetail: (matchId: number) => ["matches", "detail", matchId] as const,
  matchHistory: ["matches", "history"] as const,
  matchHistoryFocused: (matchId: number) =>
    ["matches", "history", "focused", matchId] as const,
  predictionsCatalog: ["predictions", "catalog"] as const,
  myPredictionBets: (userId: number | null | undefined) =>
    ["predictions", "my-bets", userId ?? "guest"] as const,
  userPulse: (userId: number | null | undefined) =>
    ["pulse", userId ?? "guest"] as const,
  userBets: (
    userId: number | null | undefined,
    filter: "all" | "ongoing" | "finished"
  ) => ["bets", userId ?? "guest", filter] as const,
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1_200,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchIntervalInBackground: false,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;
let managersInitialized = false;

export function getBrowserQueryClient(): QueryClient {
  if (isServer) {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  if (!managersInitialized && typeof window !== "undefined") {
    managersInitialized = true;
    focusManager.setEventListener((handleFocus) => {
      const onVisibilityChange = () => {
        handleFocus(document.visibilityState === "visible");
      };
      const onWindowFocus = () => handleFocus(true);
      document.addEventListener("visibilitychange", onVisibilityChange, false);
      window.addEventListener("focus", onWindowFocus, false);
      return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("focus", onWindowFocus);
      };
    });
    onlineManager.setEventListener((setOnline) => {
      const onOnline = () => setOnline(true);
      const onOffline = () => setOnline(false);
      window.addEventListener("online", onOnline, false);
      window.addEventListener("offline", onOffline, false);
      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    });
  }
  return browserQueryClient;
}

/**
 * Fusionne un match léger `MATCHES_SNAPSHOT` dans un `ClientMatch` complet existant
 * sans jamais écraser les 18–19 groupes de marchés (`markets`), `realStats` ni `telemetry`
 * par le tableau réduit `[result]` (longueur 1) du snapshot slim.
 */
export function mergeSingleSlimIntoFullMatch(
  existing: ClientMatch,
  slim: ClientMatch
): ClientMatch {
  if (slim.status === "finished" || slim.marketCount === 0) {
    return {
      ...existing,
      ...slim,
      markets: [],
      marketCount: 0,
      realStats: slim.realStats ?? existing.realStats,
    };
  }

  const slimHasFullMarkets =
    Array.isArray(slim.markets) && slim.markets.length > 1;
  const existingHasFullMarkets =
    Array.isArray(existing.markets) && existing.markets.length > 1;

  let nextMarkets = slimHasFullMarkets
    ? slim.markets
    : existingHasFullMarkets
      ? existing.markets
      : (slim.markets ?? existing.markets);

  if (!slimHasFullMarkets && existingHasFullMarkets) {
    const slimResGroup = slim.markets?.find(
      (g) => g.key === "result" || g.key === "1x2"
    );
    if (slimResGroup) {
      nextMarkets = existing.markets.map((group) =>
        group.key === "result" || group.key === "1x2" ? slimResGroup : group
      );
    } else if (slim.status === "live" && Array.isArray(slim.markets)) {
      nextMarkets = existing.markets.filter(
        (group) => group.key !== "result" && group.key !== "1x2"
      );
    } else if (
      existing.oddsHome !== slim.oddsHome ||
      existing.oddsDraw !== slim.oddsDraw ||
      existing.oddsAway !== slim.oddsAway
    ) {
      nextMarkets = existing.markets.map((group) => {
        if (group.key !== "result" && group.key !== "1x2") return group;
        return {
          ...group,
          outcomes: group.outcomes.map((o) => {
            if (o.key === "home") return { ...o, odds: slim.oddsHome };
            if (o.key === "draw" && slim.oddsDraw != null) {
              return { ...o, odds: slim.oddsDraw };
            }
            if (o.key === "away") return { ...o, odds: slim.oddsAway };
            return o;
          }),
        };
      });
    }
  }

  return {
    ...existing,
    ...slim,
    markets: nextMarkets,
    marketCount:
      slim.marketCount ??
      existing.marketCount ??
      (Array.isArray(nextMarkets) ? nextMarkets.length : 0),
    realStats: slim.realStats ?? existing.realStats,
    ...(slim.telemetry
      ? { telemetry: slim.telemetry }
      : existing.telemetry && slim.status === "live"
        ? { telemetry: existing.telemetry }
        : {}),
  };
}

/**
 * Fusionne un snapshot léger `MATCHES_SNAPSHOT` (PartyKit) dans le cache `matches` complet
 * en préservant les groupes de marchés détaillés (`markets`) déjà chargés pour chaque match.
 */
export function mergeSlimIntoFullMatches(
  prevMatches: ClientMatch[] | undefined,
  slimList: ClientMatch[]
): {
  merged: ClientMatch[];
  hasNewMatch: boolean;
  needsFullMarkets: boolean;
  newlyFinishedIds: number[];
} {
  if (!prevMatches || prevMatches.length === 0) {
    const needsFullMarkets = slimList.some(
      (m) =>
        m.status !== "finished" &&
        (m.marketCount ?? 0) > 1 &&
        (m.markets?.length ?? 0) <= 1
    );
    return {
      merged: slimList,
      hasNewMatch: slimList.length > 0,
      needsFullMarkets: slimList.length > 0 || needsFullMarkets,
      newlyFinishedIds: [],
    };
  }

  const prevById = new Map<number, ClientMatch>();
  for (const m of prevMatches) {
    prevById.set(m.id, m);
  }

  let hasNewMatch = false;
  let needsFullMarkets = false;
  const newlyFinishedIds: number[] = [];

  const merged = slimList.map((slim) => {
    const existing = prevById.get(slim.id);
    if (!existing) {
      hasNewMatch = true;
      if (
        slim.status !== "finished" &&
        (slim.marketCount ?? 0) > 1 &&
        (slim.markets?.length ?? 0) <= 1
      ) {
        needsFullMarkets = true;
      }
      return slim;
    }
    if (existing.status !== "finished" && slim.status === "finished") {
      newlyFinishedIds.push(slim.id);
    }

    const combined = mergeSingleSlimIntoFullMatch(existing, slim);
    if (
      combined.status !== "finished" &&
      (combined.marketCount ?? 0) > 1 &&
      (combined.markets?.length ?? 0) <= 1
    ) {
      needsFullMarkets = true;
    }
    return combined;
  });

  return { merged, hasNewMatch, needsFullMarkets, newlyFinishedIds };
}
