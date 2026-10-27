import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import Constants from "expo-constants";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PartySocket from "partysocket";
import {
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

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      setIsForeground(next === "active");
    });
    return () => sub.remove();
  }, []);

  const realtimeQuery = useQuery({
    queryKey: mobileQueryKeys.realtime(userId),
    queryFn: () => api.realtime(),
    enabled: enabled && isForeground,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const cfg = realtimeQuery.data;
  const extraHost = (
    Constants.expoConfig?.extra as { partykitHost?: string } | undefined
  )?.partykitHost?.trim();

  const partyHost =
    (cfg?.enabled && cfg.host ? cfg.host : null) || extraHost || null;
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

    const socket = new PartySocket({
      host: partyHost,
      room: cfg?.publicRoom || "live-matches",
      protocol: partyProtocol,
    });

    const handleOpen = () => setWsConnected(true);
    const handleClose = () => setWsConnected(false);

    const handleMessage = (ev: { data?: unknown }) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          matches?: ClientMatch[];
          matchIds?: number[];
          serverTime?: string;
        };

        if (msg.type === "MATCHES_SNAPSHOT" && Array.isArray(msg.matches)) {
          if (msg.serverTime) {
            calibrateServerClockOffset({ serverTimeIso: msg.serverTime });
          }
          registerLiveClockMatches(msg.matches);
          seedMatchesSnapshot(msg.matches, false);

          let newlyFinished = false;
          type MatchesCacheData = {
            matches: ClientMatch[];
            serverTime?: string;
          };
          queryClient.setQueryData<MatchesCacheData>(
            mobileQueryKeys.matchesSlim,
            (prev: MatchesCacheData | undefined) => {
              if (prev?.matches) {
                const prevStatus = new Map(
                  prev.matches.map((m: ClientMatch) => [m.id, m.status])
                );
                for (const nextM of msg.matches!) {
                  const oldS = prevStatus.get(nextM.id);
                  if (oldS && oldS !== "finished" && nextM.status === "finished") {
                    newlyFinished = true;
                  }
                }
              }
              return {
                matches: msg.matches!,
                serverTime: msg.serverTime ?? prev?.serverTime,
              };
            }
          );

          onMatchesUpdated?.(msg.matches);

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
      setWsConnected(false);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleClose);
      socket.removeEventListener("message", handleMessage as EventListener);
      socket.close();
    };
  }, [
    cfg?.publicRoom,
    onMatchesUpdated,
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

    const userSocket = new PartySocket({
      host: partyHost,
      room: cfg.userRoom,
      protocol: partyProtocol,
      query: { token: cfg.userToken },
    });

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
  const fallbackMs = Math.round(baseMs * (options?.dataSaver ? 2.4 : 1));

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
        ? Date.now() - 4_000
        : undefined,
    refetchInterval: wsConnected ? 60_000 : fallbackMs,
    refetchIntervalInBackground: false,
  });
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
  const { wsConnected } = useMobileRealtimeStatus();
  const fallbackMs = Math.round(5_000 * (options?.dataSaver ? 2.4 : 1));

  return useQuery({
    queryKey: mobileQueryKeys.matchDetail(matchId),
    queryFn: () => api.matchById(matchId),
    enabled:
      (options?.enabled ?? true) && Number.isInteger(matchId) && matchId > 0,
    initialData: options?.initialMatch
      ? { match: options.initialMatch }
      : undefined,
    initialDataUpdatedAt: options?.initialMatch ? Date.now() - 4_000 : undefined,
    refetchInterval: options?.isFinished
      ? false
      : wsConnected
        ? 45_000
        : fallbackMs,
    refetchIntervalInBackground: false,
  });
}

export function useMobilePredictionsCatalogQuery(options?: {
  enabled?: boolean;
  dataSaver?: boolean;
  initialQuestions?: ClientPrediction[] | null;
}) {
  const { wsConnected } = useMobileRealtimeStatus();
  const fallbackMs = Math.round(15_000 * (options?.dataSaver ? 2.4 : 1));

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
        ? Date.now() - 5_000
        : undefined,
    refetchInterval: wsConnected ? 60_000 : fallbackMs,
    refetchIntervalInBackground: false,
  });
}

export function useMobileMatchHistoryQuery(options?: {
  enabled?: boolean;
  dataSaver?: boolean;
  initialHistory?: ClientMatchHistoryItem[] | null;
}) {
  const { wsConnected } = useMobileRealtimeStatus();
  const fallbackMs = Math.round(25_000 * (options?.dataSaver ? 2.4 : 1));

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
        ? Date.now() - 5_000
        : undefined,
    refetchInterval: wsConnected ? 60_000 : fallbackMs,
    refetchIntervalInBackground: false,
  });
}
