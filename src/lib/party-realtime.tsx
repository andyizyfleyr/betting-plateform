"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PartySocket from "partysocket";
import {
  ApiRequestError,
  api,
  type ClientMatch,
  type ClientMatchHistoryItem,
  type ClientPrediction,
} from "@/lib/api";
import { rememberMatches } from "@/lib/client-entity-cache";
import {
  calibrateServerClockOffset,
  registerLiveClockMatches,
} from "@/lib/live-clock";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import {
  mergeSingleSlimIntoFullMatch,
  mergeSlimIntoFullMatches,
  pulseQueryKeys,
} from "@/lib/query-client";

interface RealtimeContextValue {
  /** `true` dès que la connexion WebSocket PartyKit `live-matches` est ouverte */
  wsConnected: boolean;
  /** `true` dès que le salon privé `user-<id>` du joueur est ouvert */
  userWsConnected: boolean;
  /** Indique si PartyKit est activé sur le serveur */
  partyEnabled: boolean;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  wsConnected: false,
  userWsConnected: false,
  partyEnabled: false,
});

export function useRealtimeStatus(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/**
 * Pont temps réel PartyKit + TanStack Query (Web Next.js) :
 * - Découvre dynamiquement l'hôte PartyKit et le jeton HMAC du joueur via `/api/realtime`.
 * - Maintient le WebSocket `live-matches` (scores, cotes, Cash Out, chronos) et le salon
 *   privé `user-<id>` (solde, paris gagnés/vendus/remboursés) synchronisés avec `QueryClient`.
 * - Coupe automatiquement le polling rapide dès que le WebSocket est actif (`wsConnected = true`),
 *   et bascule sans coupure sur `TanStack Query` en cas d'absence de configuration ou de réseau 3G filtré.
 */
export function PartyRealtimeBridge({
  userId,
  disabled = false,
  onMatchesUpdated,
  children,
}: {
  userId: number | null;
  disabled?: boolean;
  onMatchesUpdated?: (matches: ClientMatch[]) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [wsConnected, setWsConnected] = useState(false);
  const [userWsConnected, setUserWsConnected] = useState(false);
  const lastFullHydrateAtRef = useRef<number>(0);
  const hydratingFullRef = useRef<boolean>(false);
  const onMatchesUpdatedRef = useRef(onMatchesUpdated);
  useEffect(() => {
    onMatchesUpdatedRef.current = onMatchesUpdated;
  }, [onMatchesUpdated]);

  const realtimeQuery = useQuery({
    queryKey: pulseQueryKeys.realtime(userId),
    queryFn: () => api.realtime(),
    enabled: !disabled,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const cfg = realtimeQuery.data;
  const partyHost =
    (cfg?.enabled && cfg.host ? cfg.host : null) ||
    (process.env.NEXT_PUBLIC_PARTYKIT_HOST?.trim() || null);
  const partyProtocol =
    cfg?.protocol ??
    (partyHost &&
    (partyHost.startsWith("localhost") || partyHost.startsWith("127.0.0.1"))
      ? "ws"
      : "wss");
  const partyEnabled = Boolean(!disabled && partyHost);

  // 1) Salon public `live-matches`
  useEffect(() => {
    if (!partyEnabled || !partyHost) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWsConnected(false);
      return;
    }

    const socket = new PartySocket({
      host: partyHost,
      room: cfg?.publicRoom || "live-matches",
      protocol: partyProtocol,
    });

    const WS_SNAPSHOT_LIVENESS_MS = 9_000;
    let lastSnapshotAt = 0;

    const handleOpen = () => {
      // N'active `wsConnected` qu'à réception effective d'un frame `MATCHES_SNAPSHOT`
      // afin de ne jamais couper le polling HTTP si le Worker est silencieux.
    };

    const handleClose = () => {
      lastSnapshotAt = 0;
      setWsConnected(false);
    };

    const livenessTimer = setInterval(() => {
      if (lastSnapshotAt === 0 || Date.now() - lastSnapshotAt > WS_SNAPSHOT_LIVENESS_MS) {
        setWsConnected(false);
      }
    }, 3_000);

    const handleMessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          matches?: ClientMatch[];
          matchIds?: number[];
          serverTime?: string;
        };

        if (msg.type === "MATCHES_SNAPSHOT" && Array.isArray(msg.matches)) {
          lastSnapshotAt = Date.now();
          setWsConnected(true);
          if (msg.serverTime) {
            calibrateServerClockOffset({ serverTimeIso: msg.serverTime });
          }
          registerLiveClockMatches(msg.matches);

          queryClient.setQueryData(pulseQueryKeys.matchesSlim, {
            matches: msg.matches,
            serverTime: msg.serverTime,
          });

          const prevData = queryClient.getQueryData<{
            matches: ClientMatch[];
            serverTime?: string;
          }>(pulseQueryKeys.matches);

          const hasActiveMatchesObserver =
            (queryClient
              .getQueryCache()
              .find({ queryKey: pulseQueryKeys.matches })
              ?.getObserversCount() ?? 0) > 0;

          const { merged, hasNewMatch, needsFullMarkets, newlyFinishedIds } =
            mergeSlimIntoFullMatches(prevData?.matches, msg.matches);

          // Ne pré-remplit `pulseQueryKeys.matches` avec un snapshot slim que si le cache
          // complet existe déjà ou qu'une vue active observe `matches` (évite tout appel
          // `/api/matches` de ~250 Ko en tâche de fond sur `/paris`, `/predictions`, `/resultats` mobile).
          if (prevData || hasActiveMatchesObserver) {
            queryClient.setQueryData<{
              matches: ClientMatch[];
              serverTime?: string;
            }>(pulseQueryKeys.matches, {
              matches: merged,
              serverTime: msg.serverTime ?? prevData?.serverTime,
            });
            onMatchesUpdatedRef.current?.(merged);
          }

          rememberMatches(merged);

          // Met aussi à jour instantanément toute fiche détail `/matchs/[id]` en cache
          for (const slim of msg.matches) {
            queryClient.setQueryData<{
              match: ClientMatch;
              serverTime?: string;
            }>(pulseQueryKeys.matchDetail(slim.id), (prevDetail) => {
              if (!prevDetail) return prevDetail;
              return {
                match: mergeSingleSlimIntoFullMatch(prevDetail.match, slim),
                serverTime: msg.serverTime ?? prevDetail.serverTime,
              };
            });
          }

          if (
            hasActiveMatchesObserver &&
            (!prevData || hasNewMatch || needsFullMarkets)
          ) {
            void queryClient.invalidateQueries({
              queryKey: pulseQueryKeys.matches,
            });
            const now = Date.now();
            if (
              !hydratingFullRef.current &&
              now - lastFullHydrateAtRef.current >= 5_000
            ) {
              hydratingFullRef.current = true;
              lastFullHydrateAtRef.current = now;
              void queryClient
                .fetchQuery({
                  queryKey: pulseQueryKeys.matches,
                  queryFn: () => api.matches(),
                  staleTime: 2_500,
                })
                .then((fullRes) => {
                  if (fullRes?.matches) {
                    rememberMatches(fullRes.matches);
                    onMatchesUpdatedRef.current?.(fullRes.matches);
                  }
                })
                .catch(() => undefined)
                .finally(() => {
                  hydratingFullRef.current = false;
                });
            }
          }
          if (newlyFinishedIds.length > 0) {
            void queryClient.invalidateQueries({
              queryKey: pulseQueryKeys.matchHistory,
            });
          }
          return;
        }

        if (msg.type === "MATCHES_INVALIDATE") {
          void queryClient.invalidateQueries({
            queryKey: pulseQueryKeys.matches,
          });
          if (Array.isArray(msg.matchIds)) {
            for (const mid of msg.matchIds) {
              void queryClient.invalidateQueries({
                queryKey: pulseQueryKeys.matchDetail(mid),
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
            queryKey: pulseQueryKeys.predictionsCatalog,
          });
          return;
        }

        if (msg.type === "USER_PULSE_INVALIDATE" && userId) {
          void queryClient.invalidateQueries({
            queryKey: pulseQueryKeys.userPulse(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: ["bets", userId],
          });
        }
      } catch {
        /* ignore malformed frame */
      }
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleClose);
    socket.addEventListener("message", handleMessage);

    return () => {
      clearInterval(livenessTimer);
      setWsConnected(false);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleClose);
      socket.removeEventListener("message", handleMessage);
      socket.close();
    };
  }, [
    cfg?.publicRoom,
    partyEnabled,
    partyHost,
    partyProtocol,
    queryClient,
    userId,
  ]);

  // 2) Salon privé authentifié `user-<id>`
  useEffect(() => {
    if (
      !partyEnabled ||
      !partyHost ||
      !userId ||
      !cfg?.userRoom ||
      !cfg?.userToken
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const handleMessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as { type?: string };
        if (msg.type === "USER_PULSE_INVALIDATE") {
          void queryClient.invalidateQueries({
            queryKey: pulseQueryKeys.userPulse(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: ["bets", userId],
          });
          void queryClient.invalidateQueries({
            queryKey: pulseQueryKeys.myPredictionBets(userId),
          });
        }
      } catch {
        /* ignore */
      }
    };

    userSocket.addEventListener("open", handleOpen);
    userSocket.addEventListener("close", handleClose);
    userSocket.addEventListener("error", handleClose);
    userSocket.addEventListener("message", handleMessage);

    return () => {
      setUserWsConnected(false);
      userSocket.removeEventListener("open", handleOpen);
      userSocket.removeEventListener("close", handleClose);
      userSocket.removeEventListener("error", handleClose);
      userSocket.removeEventListener("message", handleMessage);
      userSocket.close();
    };
  }, [
    cfg?.userRoom,
    cfg?.userToken,
    partyEnabled,
    partyHost,
    partyProtocol,
    queryClient,
    userId,
  ]);

  const ctxValue = useMemo<RealtimeContextValue>(
    () => ({
      wsConnected,
      userWsConnected,
      partyEnabled,
    }),
    [partyEnabled, userWsConnected, wsConnected]
  );

  return (
    <RealtimeContext.Provider value={ctxValue}>
      {children}
    </RealtimeContext.Provider>
  );
}

/* ============================================================================
 *  HOOKS TANSTACK QUERY PARTAGÉS (AVEC BASCULE AUTOMATIQUE WEBSOCKET / POLLING)
 * ============================================================================ */

export function useMatchesFeedQuery(options?: {
  enabled?: boolean;
  baseFallbackIntervalMs?: number;
  initialMatches?: ClientMatch[];
}) {
  const { wsConnected } = useRealtimeStatus();
  const { isConstrained, isOffline } = useNetworkQuality();
  const baseMs = options?.baseFallbackIntervalMs ?? 3_500;
  const fallbackMs = getAdaptiveIntervalMs(baseMs, isConstrained);
  const wsFullSyncMs = getAdaptiveIntervalMs(12_000, isConstrained);

  return useQuery({
    queryKey: pulseQueryKeys.matches,
    queryFn: () => api.matches(),
    enabled: (options?.enabled ?? true) && !isOffline,
    initialData:
      options?.initialMatches && options.initialMatches.length > 0
        ? { matches: options.initialMatches }
        : undefined,
    initialDataUpdatedAt:
      options?.initialMatches && options.initialMatches.length > 0
        ? () => Date.now() - 2_000
        : undefined,
    // Même quand le flux WebSocket slim (1X2/score/minute) est actif, resynchronise
    // les 18 marchés secondaires toutes les 12 s (et bascule à 3.5 s hors WS).
    refetchInterval: wsConnected ? wsFullSyncMs : fallbackMs,
    refetchIntervalInBackground: false,
  });
}

export function useMatchDetailQuery(
  matchId: number,
  options?: {
    enabled?: boolean;
    initialMatch?: ClientMatch | null;
    isFinished?: boolean;
  }
) {
  const { isConstrained, isOffline } = useNetworkQuality();
  const detailIntervalMs = getAdaptiveIntervalMs(3_500, isConstrained);
  const initialIsSlim =
    Boolean(options?.initialMatch) &&
    options?.initialMatch?.status !== "finished" &&
    (options?.initialMatch?.markets?.length ?? 0) <= 1;

  return useQuery({
    queryKey: pulseQueryKeys.matchDetail(matchId),
    queryFn: () => api.matchById(matchId),
    enabled:
      (options?.enabled ?? true) &&
      Number.isInteger(matchId) &&
      matchId > 0 &&
      !isOffline,
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
        err instanceof ApiRequestError &&
        (err.status === 404 || err.status === 400)
      ) {
        return false;
      }
      return failureCount < 2;
    },
    // Rafraîchit toujours `/api/matches/[id]` (~3 Ko) toutes les 3.5 s pour maintenir
    // les 19 marchés complets, les stats réelles et la télémétrie 2D en direct.
    refetchInterval: options?.isFinished ? false : detailIntervalMs,
    refetchIntervalInBackground: false,
  });
}

export function usePredictionsCatalogQuery(options?: {
  enabled?: boolean;
  initialQuestions?: ClientPrediction[];
}) {
  const { isConstrained, isOffline } = useNetworkQuality();
  const intervalMs = getAdaptiveIntervalMs(8_000, isConstrained);

  return useQuery({
    queryKey: pulseQueryKeys.predictionsCatalog,
    queryFn: () => api.predictionsCatalog(),
    enabled: (options?.enabled ?? true) && !isOffline,
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

export function useMatchHistoryQuery(options?: {
  enabled?: boolean;
  initialHistory?: ClientMatchHistoryItem[];
}) {
  const { isConstrained, isOffline } = useNetworkQuality();
  const intervalMs = getAdaptiveIntervalMs(5_000, isConstrained);

  return useQuery({
    queryKey: pulseQueryKeys.matchHistory,
    queryFn: () => api.matchHistory(),
    enabled: (options?.enabled ?? true) && !isOffline,
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
