import "@/lib/rn-polyfills";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import Constants from "expo-constants";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import PartySocket from "partysocket";
import {
  ApiHttpError,
  api,
  type ClientMatch,
  type ClientMatchHistoryItem,
  type ClientPrediction,
} from "@/lib/api";
import { seedMatchesSnapshot } from "@/lib/entity-cache";
import {
  calibrateServerClockOffset,
  registerLiveClockMatches,
} from "@/lib/live-clock";
import {
  mergeSlimIntoMobileMatch,
  mergeSlimIntoMobileMatches,
  mobileQueryKeys,
} from "@/lib/query-client";

interface MobileRealtimeContextValue {
  wsConnected: boolean;
  userWsConnected: boolean;
  partyEnabled: boolean;
}

const MobileRealtimeContext = createContext<MobileRealtimeContextValue>({
  wsConnected: false,
  userWsConnected: false,
  partyEnabled: false,
});

export function useMobileRealtimeStatus(): MobileRealtimeContextValue {
  return useContext(MobileRealtimeContext);
}

/**
 * Pont temps réel PartyKit + TanStack Query pour Android (Expo Go SDK 52) :
 * - Utilise le `WebSocket` natif d'Android via `partysocket`.
 * - Se met automatiquement en veille dès que l'application passe en arrière-plan (`AppState !== "active"`)
 *   pour préserver 100 % de la batterie et se reconnecte dès le retour à l'écran.
 * - Met à jour instantanément le cache `TanStack Query` (`matchesSlim`, `matchDetail`, `pulse`, `bets`)
 *   et désactive le polling rapide tant que la liaison WebSocket est active.
 */
export function MobilePartyRealtimeBridge({
  userId,
  enabled = true,
  onMatchesUpdated,
  children,
}: {
  userId: number | null;
  enabled?: boolean;
  onMatchesUpdated?: (matches: ClientMatch[]) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [isForeground, setIsForeground] = useState(
    () => AppState.currentState === "active"
  );
  const [wsConnected, setWsConnected] = useState(false);
  const [userWsConnected, setUserWsConnected] = useState(false);
  const onMatchesUpdatedRef = useRef(onMatchesUpdated);
  onMatchesUpdatedRef.current = onMatchesUpdated;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const active = next === "active";
      setIsForeground((prev) => {
        if (!prev && active) {
          // Retour au premier plan sur Android : force une lecture fraîche immédiate
          void api
            .matchesSlim({ forceRefresh: true })
            .then((fresh) => {
              queryClient.setQueryData(mobileQueryKeys.matchesSlim, fresh);
              onMatchesUpdatedRef.current?.(fresh.matches);
            })
            .catch(() => undefined);
          if (userId) {
            void queryClient.invalidateQueries({
              queryKey: mobileQueryKeys.userPulse(userId),
            });
            void queryClient.invalidateQueries({
              queryKey: ["bets", userId],
            });
          }
        }
        return active;
      });
    });
    return () => sub.remove();
  }, [queryClient, userId]);

  const realtimeQuery = useQuery({
    queryKey: mobileQueryKeys.realtime(userId),
    queryFn: () => api.realtime(),
    enabled: enabled && isForeground,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const cfg = realtimeQuery.data;
  const envPartyHost =
    typeof process !== "undefined" &&
    process.env &&
    typeof process.env.EXPO_PUBLIC_PARTYKIT_HOST === "string"
      ? process.env.EXPO_PUBLIC_PARTYKIT_HOST.trim()
      : "";
  const extraHost =
    envPartyHost ||
    (
      Constants.expoConfig?.extra as { partykitHost?: string } | undefined
    )?.partykitHost?.trim();

  const partyHost =
    cfg !== undefined
      ? cfg.enabled && cfg.host
        ? cfg.host
        : null
      : extraHost || null;
  const partyProtocol =
    cfg?.protocol ??
    (partyHost &&
    (partyHost.startsWith("localhost") || partyHost.startsWith("127.0.0.1"))
      ? "ws"
      : "wss");
  const partyActive = Boolean(enabled && isForeground && partyHost);

  // 1) Salon public `live-matches`
  useEffect(() => {
    if (!partyActive || !partyHost) {
      setWsConnected(false);
      return;
    }

    let socket: PartySocket;
    try {
      socket = new PartySocket({
        host: partyHost,
        room: cfg?.publicRoom || "live-matches",
        protocol: partyProtocol,
      });
      socket.binaryType = "arraybuffer";
    } catch {
      setWsConnected(false);
      return;
    }

    const WS_SNAPSHOT_LIVENESS_MS = 9_000;
    let lastSnapshotAt = 0;
    let deltaSnapshot: ClientMatch[] | null = null;
    let deltaSequence: number | null = null;
    const requestResync = () => {
      deltaSnapshot = null;
      deltaSequence = null;
      setWsConnected(false);
      try { socket.send(JSON.stringify({ type: "LIVE_RESYNC_V1" })); } catch { /* HTTP reste disponible */ }
    };

    const handleOpen = () => {
      deltaSnapshot = null;
      deltaSequence = null;
      // Les anciens Workers ignorent ce message et continuent leurs snapshots.
      try { socket.send(JSON.stringify({ type: "LIVE_DELTA_V1" })); } catch { /* repli HTTP */ }
    };
    const handleClose = () => {
      deltaSnapshot = null;
      deltaSequence = null;
      lastSnapshotAt = 0;
      setWsConnected(false);
    };

    const livenessTimer = setInterval(() => {
      if (lastSnapshotAt === 0 || Date.now() - lastSnapshotAt > WS_SNAPSHOT_LIVENESS_MS) {
        setWsConnected(false);
      }
    }, 3_000);

    const handleMessage = (ev: { data?: unknown }) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          matches?: ClientMatch[];
          matchIds?: number[];
          serverTime?: string;
          base?: number;
          seq?: number;
          order?: number[];
        };
        if (msg.type === "MATCHES_DELTA") {
          if (!deltaSnapshot || !Number.isSafeInteger(msg.base) || msg.base !== deltaSequence ||
              !Number.isSafeInteger(msg.seq) || msg.seq !== msg.base! + 1 ||
              !Array.isArray(msg.matches) || !Array.isArray(msg.order)) {
            requestResync();
            return;
          }
          const byId = new Map(deltaSnapshot.map((match) => [match.id, match]));
          for (const match of msg.matches) {
            if (!match || !Number.isSafeInteger(match.id)) { requestResync(); return; }
            byId.set(match.id, match);
          }
          const ids = new Set(msg.order);
          if (ids.size !== msg.order.length || msg.order.some((id) => !byId.has(id))) {
            requestResync();
            return;
          }
          msg.matches = msg.order.map((id) => byId.get(id)!);
          msg.type = "MATCHES_SNAPSHOT";
        }
        if (msg.type === "MATCHES_SNAPSHOT" && Array.isArray(msg.matches) && Number.isSafeInteger(msg.seq)) {
          deltaSnapshot = msg.matches;
          deltaSequence = msg.seq!;
        }

        if (msg.type === "MATCHES_SNAPSHOT" && Array.isArray(msg.matches)) {
          lastSnapshotAt = Date.now();
          setWsConnected(true);
          if (msg.serverTime) {
            calibrateServerClockOffset({ serverTimeIso: msg.serverTime });
          }
          registerLiveClockMatches(msg.matches);

          type MatchesCacheData = {
            matches: ClientMatch[];
            serverTime?: string;
          };
          const prevCache = queryClient.getQueryData<MatchesCacheData>(
            mobileQueryKeys.matchesSlim
          );
          const prevById = new Map(
            (prevCache?.matches ?? []).map((m: ClientMatch) => [m.id, m])
          );
          let newlyFinished = false;
          let liveTicketsImpacted = false;
          const secondaryMarketDeltaIds: number[] = [];

          for (const nextM of msg.matches) {
            const oldM = prevById.get(nextM.id);
            if (!oldM) continue;
            if (oldM.status !== "finished" && nextM.status === "finished") {
              newlyFinished = true;
              liveTicketsImpacted = true;
            }
            const scoreOrCardChanged =
              oldM.homeScore !== nextM.homeScore ||
              oldM.awayScore !== nextM.awayScore ||
              (oldM.redHome ?? 0) !== (nextM.redHome ?? 0) ||
              (oldM.redAway ?? 0) !== (nextM.redAway ?? 0) ||
              oldM.status !== nextM.status ||
              Boolean(oldM.suspended) !== Boolean(nextM.suspended);
            const oddsShifted =
              Math.abs((oldM.oddsHome ?? 0) - (nextM.oddsHome ?? 0)) >= 0.01 ||
              Math.abs((oldM.oddsDraw ?? 0) - (nextM.oddsDraw ?? 0)) >= 0.01 ||
              Math.abs((oldM.oddsAway ?? 0) - (nextM.oddsAway ?? 0)) >= 0.01;
            if (scoreOrCardChanged) {
              liveTicketsImpacted = true;
            }
            if (scoreOrCardChanged || oddsShifted) {
              secondaryMarketDeltaIds.push(nextM.id);
            }
          }

          const mergedMatches = mergeSlimIntoMobileMatches(
            prevCache?.matches,
            msg.matches
          );

          queryClient.setQueryData<MatchesCacheData>(
            mobileQueryKeys.matchesSlim,
            {
              matches: mergedMatches,
              serverTime: msg.serverTime ?? prevCache?.serverTime,
            }
          );

          seedMatchesSnapshot(mergedMatches, false);
          onMatchesUpdatedRef.current?.(mergedMatches);

          // Met aussi à jour toute fiche détail `/matchs/[id]` en mémoire
          type MatchDetailCacheData = {
            match: ClientMatch;
            serverTime?: string;
          };
          for (const slim of msg.matches) {
            queryClient.setQueryData<MatchDetailCacheData>(
              mobileQueryKeys.matchDetail(slim.id),
              (prevDetail: MatchDetailCacheData | undefined) => {
                if (!prevDetail) return prevDetail;
                return {
                  match: mergeSlimIntoMobileMatch(prevDetail.match, slim),
                  serverTime: msg.serverTime ?? prevDetail.serverTime,
                };
              }
            );
          }

          for (const mid of secondaryMarketDeltaIds) {
            void queryClient.invalidateQueries({
              queryKey: mobileQueryKeys.matchDetail(mid),
              refetchType: "active",
            });
          }

          if (liveTicketsImpacted && userId) {
            void queryClient.invalidateQueries({
              queryKey: ["bets", userId],
              refetchType: "active",
            });
          }

          if (newlyFinished) {
            void queryClient.invalidateQueries({
              queryKey: mobileQueryKeys.matchHistory,
            });
          }
          return;
        }

        if (msg.type === "MATCHES_INVALIDATE") {
          void queryClient.invalidateQueries({
            queryKey: mobileQueryKeys.matchesSlim,
          });
          if (Array.isArray(msg.matchIds)) {
            for (const mid of msg.matchIds) {
              void queryClient.invalidateQueries({
                queryKey: mobileQueryKeys.matchDetail(mid),
              });
            }
          } else {
            void queryClient.invalidateQueries({
              queryKey: ["matches", "detail"],
            });
          }
          return;
        }

        if (msg.type === "PREDICTIONS_INVALIDATE") {
          void queryClient.invalidateQueries({
            queryKey: mobileQueryKeys.predictionsCatalog,
          });
          return;
        }

        if (msg.type === "USER_PULSE_INVALIDATE" && userId) {
          void queryClient.invalidateQueries({
            queryKey: mobileQueryKeys.userPulse(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: ["bets", userId],
          });
        }
      } catch {
        /* ignore */
      }
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleClose);
    socket.addEventListener("message", handleMessage as EventListener);

    return () => {
      clearInterval(livenessTimer);
      setWsConnected(false);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleClose);
      socket.removeEventListener("message", handleMessage as EventListener);
      socket.close();
    };
  }, [
    cfg?.publicRoom,
    partyActive,
    partyHost,
    partyProtocol,
    queryClient,
    userId,
  ]);

  // 2) Salon privé authentifié `user-<id>`
  useEffect(() => {
    if (
      !partyActive ||
      !partyHost ||
      !userId ||
      !cfg?.userRoom ||
      !cfg?.userToken
    ) {
      setUserWsConnected(false);
      return;
    }

    let userSocket: PartySocket;
    try {
      userSocket = new PartySocket({
        host: partyHost,
        room: cfg.userRoom,
        protocol: partyProtocol,
        query: { token: cfg.userToken },
      });
      userSocket.binaryType = "arraybuffer";
    } catch {
      setUserWsConnected(false);
      return;
    }

    const handleOpen = () => setUserWsConnected(true);
    const handleClose = () => setUserWsConnected(false);
    const handleMessage = (ev: { data?: unknown }) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as { type?: string };
        if (msg.type === "USER_PULSE_INVALIDATE") {
          void queryClient.invalidateQueries({
            queryKey: mobileQueryKeys.userPulse(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: ["bets", userId],
          });
          void queryClient.invalidateQueries({
            queryKey: mobileQueryKeys.myPredictionBets(userId),
          });
        }
      } catch {
        /* ignore */
      }
    };

    userSocket.addEventListener("open", handleOpen);
    userSocket.addEventListener("close", handleClose);
    userSocket.addEventListener("error", handleClose);
    userSocket.addEventListener("message", handleMessage as EventListener);

    return () => {
      setUserWsConnected(false);
      userSocket.removeEventListener("open", handleOpen);
      userSocket.removeEventListener("close", handleClose);
      userSocket.removeEventListener("error", handleClose);
      userSocket.removeEventListener("message", handleMessage as EventListener);
      userSocket.close();
    };
  }, [
    cfg?.userRoom,
    cfg?.userToken,
    partyActive,
    partyHost,
    partyProtocol,
    queryClient,
    userId,
  ]);

  const value = useMemo<MobileRealtimeContextValue>(
    () => ({
      wsConnected,
      userWsConnected,
      partyEnabled: Boolean(partyHost),
    }),
    [partyHost, userWsConnected, wsConnected]
  );

  return (
    <MobileRealtimeContext.Provider value={value}>
      {children}
    </MobileRealtimeContext.Provider>
  );
}

/* ============================================================================
 *  HOOKS TANSTACK QUERY PARTAGÉS SUR MOBILE ANDROID
 * ============================================================================ */

export function useMobileMatchesSlimQuery(options?: {
  enabled?: boolean;
  dataSaver?: boolean;
  baseIntervalMs?: number;
  initialMatches?: ClientMatch[] | null;
}) {
  const { wsConnected } = useMobileRealtimeStatus();
  const baseMs = options?.baseIntervalMs ?? 5_000;
  const fallbackMs = Math.round(baseMs * (options?.dataSaver ? 2.2 : 1));
  const wsSafetyMs = Math.round(15_000 * (options?.dataSaver ? 2 : 1));

  return useQuery({
    queryKey: mobileQueryKeys.matchesSlim,
    queryFn: () => api.matchesSlim(),
    enabled: options?.enabled ?? true,
    initialData:
      options?.initialMatches && options.initialMatches.length > 0
        ? { matches: options.initialMatches }
        : undefined,
    initialDataUpdatedAt:
      options?.initialMatches && options.initialMatches.length > 0
        ? () => Date.now() - 2_000
        : undefined,
    refetchInterval: wsConnected ? wsSafetyMs : fallbackMs,
    refetchIntervalInBackground: false,
  });
}

export async function forceRefreshMobileMatchesFeed(
  queryClient: QueryClient
): Promise<{ matches: ClientMatch[]; serverTime?: string }> {
  const fresh = await api.matchesSlim({ forceRefresh: true });
  type MatchesCacheData = { matches: ClientMatch[]; serverTime?: string };
  const prev = queryClient.getQueryData<MatchesCacheData>(
    mobileQueryKeys.matchesSlim
  );
  const merged = mergeSlimIntoMobileMatches(prev?.matches, fresh.matches);
  const payload = { matches: merged, serverTime: fresh.serverTime };
  queryClient.setQueryData(mobileQueryKeys.matchesSlim, payload);
  return payload;
}

export async function forceRefreshMobileMatchDetail(
  queryClient: QueryClient,
  matchId: number
): Promise<{ match: ClientMatch; serverTime?: string }> {
  const fresh = await api.matchById(matchId, { forceRefresh: true });
  queryClient.setQueryData(mobileQueryKeys.matchDetail(matchId), fresh);
  type MatchesCacheData = { matches: ClientMatch[]; serverTime?: string };
  queryClient.setQueryData<MatchesCacheData>(
    mobileQueryKeys.matchesSlim,
    (prev: MatchesCacheData | undefined) => {
      if (!prev) return prev;
      return {
        matches: prev.matches.map((m: ClientMatch) =>
          m.id === fresh.match.id ? fresh.match : m
        ),
        serverTime: fresh.serverTime ?? prev.serverTime,
      };
    }
  );
  return fresh;
}

export async function forceRefreshMobileMatchHistory(
  queryClient: QueryClient,
  matchId?: number
): Promise<{
  matches: ClientMatchHistoryItem[];
  focusedMatch: ClientMatchHistoryItem | null;
  serverTime?: string;
}> {
  const fresh = await api.matchHistory(matchId, { forceRefresh: true });
  if (typeof matchId === "number" && matchId > 0) {
    queryClient.setQueryData(
      mobileQueryKeys.matchHistoryFocused(matchId),
      fresh
    );
  } else {
    queryClient.setQueryData(mobileQueryKeys.matchHistory, fresh);
  }
  return fresh;
}

export async function forceRefreshMobilePredictionsCatalog(
  queryClient: QueryClient
): Promise<{ questions: ClientPrediction[]; serverTime?: string }> {
  const fresh = await api.predictionsCatalog({ forceRefresh: true });
  queryClient.setQueryData(mobileQueryKeys.predictionsCatalog, fresh);
  return fresh;
}

export function useMobileMatchDetailQuery(
  matchId: number,
  options?: {
    enabled?: boolean;
    dataSaver?: boolean;
    initialMatch?: ClientMatch | null;
    isFinished?: boolean;
  }
) {
  const detailMs = Math.round(5_000 * (options?.dataSaver ? 2.2 : 1));
  const initialIsSlim =
    Boolean(options?.initialMatch) &&
    options?.initialMatch?.status !== "finished" &&
    (options?.initialMatch?.markets?.length ?? 0) <= 1;

  return useQuery({
    queryKey: mobileQueryKeys.matchDetail(matchId),
    queryFn: () => api.matchById(matchId),
    enabled:
      (options?.enabled ?? true) && Number.isInteger(matchId) && matchId > 0,
    initialData: options?.initialMatch
      ? { match: options.initialMatch }
      : undefined,
    initialDataUpdatedAt: options?.initialMatch
      ? initialIsSlim
        ? 0
        : () => Date.now() - 2_000
      : undefined,
    retry: (failureCount, err) => {
      if (
        err instanceof ApiHttpError &&
        (err.status === 404 || err.status === 400)
      ) {
        return false;
      }
      return failureCount < 2;
    },
    // Rafraîchit toujours `/api/matches/[id]` toutes les 5 s pour maintenir les 19 marchés,
    // les stats réelles et la télémétrie 2D en direct.
    refetchInterval: options?.isFinished ? false : detailMs,
    refetchIntervalInBackground: false,
  });
}

export function useMobilePredictionsCatalogQuery(options?: {
  enabled?: boolean;
  dataSaver?: boolean;
  initialQuestions?: ClientPrediction[] | null;
}) {
  const intervalMs = Math.round(15_000 * (options?.dataSaver ? 2.2 : 1));

  return useQuery({
    queryKey: mobileQueryKeys.predictionsCatalog,
    queryFn: () => api.predictionsCatalog(),
    enabled: options?.enabled ?? true,
    initialData:
      options?.initialQuestions && options.initialQuestions.length > 0
        ? { questions: options.initialQuestions }
        : undefined,
    initialDataUpdatedAt:
      options?.initialQuestions && options.initialQuestions.length > 0
        ? () => Date.now() - 3_000
        : undefined,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
  });
}

export function useMobileMatchHistoryQuery(options?: {
  enabled?: boolean;
  dataSaver?: boolean;
  initialHistory?: ClientMatchHistoryItem[] | null;
}) {
  const intervalMs = Math.round(10_000 * (options?.dataSaver ? 2.2 : 1));

  return useQuery({
    queryKey: mobileQueryKeys.matchHistory,
    queryFn: () => api.matchHistory(),
    enabled: options?.enabled ?? true,
    initialData:
      options?.initialHistory && options.initialHistory.length > 0
        ? { matches: options.initialHistory, focusedMatch: null }
        : undefined,
    initialDataUpdatedAt:
      options?.initialHistory && options.initialHistory.length > 0
        ? () => Date.now() - 3_000
        : undefined,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
  });
}
