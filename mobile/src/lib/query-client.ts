import { AppState, type AppStateStatus } from "react-native";
import { focusManager, QueryClient } from "@tanstack/react-query";
import type { ClientMatch } from "@/lib/api";

// Synchronise nativement TanStack Query avec l'état de l'application Android (`AppState`) :
// - Coupe 100 % des requêtes périodiques dès que l'écran est verrouillé ou que l'app passe en arrière-plan.
// - Déclenche une revalidation immédiate au retour au premier plan (`active`).
let appStateBound = false;

export function ensureMobileFocusManagerBound(): void {
  if (appStateBound) return;
  appStateBound = true;
  focusManager.setEventListener((handleFocus) => {
    const onChange = (status: AppStateStatus) => {
      handleFocus(status === "active");
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => {
      sub.remove();
    };
  });
}

export const mobileQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_500,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
});

export const mobileQueryKeys = {
  realtime: (userId: number | null | undefined) =>
    ["realtime", userId ?? "guest"] as const,
  matchesSlim: ["matches", "slim"] as const,
  matchesFull: ["matches", "full"] as const,
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

export function mergeSlimIntoMobileMatch(
  existing: ClientMatch,
  slim: ClientMatch
): ClientMatch {
  let nextMarkets = existing.markets;
  if (
    Array.isArray(existing.markets) &&
    existing.markets.length > 0 &&
    (existing.oddsHome !== slim.oddsHome ||
      existing.oddsDraw !== slim.oddsDraw ||
      existing.oddsAway !== slim.oddsAway)
  ) {
    nextMarkets = existing.markets.map((group) => {
      if (group.key !== "1x2") return group;
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

  return {
    ...existing,
    ...slim,
    markets: slim.markets ?? nextMarkets,
    realStats: slim.realStats ?? existing.realStats,
  };
}
