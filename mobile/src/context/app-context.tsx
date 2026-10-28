import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  api,
  roundOdds2,
  type ClientBet,
  type ClientMatch,
  type ClientPrediction,
  type ClientUser,
  type MatchSource,
  type OddsChangePolicy,
  type OddsChangedLegDetail,
  type PaymentProvider,
} from "@/lib/api";
import { MAX_COMBO_LEGS } from "@/lib/combo-math";
import {
  clearPrivateEntityCaches,
  getCachedMatchesList,
  getCachedPredictionsList,
  hydrateEntityCacheFromDisk,
  seedPredictionsSnapshot,
} from "@/lib/entity-cache";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hydrateAuthToken, onUnauthorizedResponse } from "@/lib/http";
import {
  MobilePartyRealtimeBridge,
  useMobileMatchesSlimQuery,
} from "@/lib/party-realtime";
import { mobileQueryKeys } from "@/lib/query-client";
import { triggerHaptic } from "@/theme/tokens";

export interface BetTarget {
  match: ClientMatch;
  selection: string;
  odds: number;
  label: string;
  market: string;
  marketLabel: string;
}

export type BetModalTarget = BetTarget;

export interface PredictionModalTarget {
  question: ClientPrediction;
  selection: string;
}

export interface ComboSelection {
  uid: string; // "sport-12" ou "pred-5" (1 seule par événement, identique à Next.js)
  kind: "sport" | "prediction";
  matchId?: number;
  matchSource?: MatchSource;
  questionId?: number;
  title: string;
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  league: string;
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  startsAt?: string | null;
  isLive?: boolean;
}

export type ComboSlipLeg = ComboSelection;

export type ComboToggleResult =
  | "added"
  | "removed"
  | "replaced"
  | "full"
  | "source_conflict";

export interface ToastItem {
  id: string;
  kind: "success" | "error" | "info" | "win";
  title: string;
  description?: string;
  subtitle?: string;
}

interface AppContextValue {
  authReady: boolean;
  user: ClientUser | null;
  balance: number;
  setBalance: (b: number) => void;
  applyUser: (u: ClientUser | null) => void;
  pendingCount: number;
  setPendingCount: (n: number) => void;
  betsVersion: number;
  bumpBets: () => void;
  feedMatches: ClientMatch[] | null;
  setFeedMatches: (list: ClientMatch[]) => void;
  refreshFeedMatches: () => Promise<void>;
  refreshPulseNow: () => Promise<void>;
  comboLegs: ComboSelection[];
  comboOpen: boolean;
  openCombo: () => void;
  closeCombo: () => void;
  comboQuickMode: boolean;
  setComboQuickMode: (v: boolean) => void;
  toggleComboLeg: (leg: ComboSelection) => ComboToggleResult;
  removeComboLeg: (uid: string) => void;
  clearCombo: () => void;
  loadComboLegs: (legs: ComboSelection[]) => void;
  applyComboOddsUpdates: (updates?: OddsChangedLegDetail[]) => void;
  isInCombo: (uid: string, market: string, selection: string) => boolean;
  oddsPolicy: OddsChangePolicy;
  setOddsPolicy: (p: OddsChangePolicy) => void;
  dataSaverMode: boolean;
  setDataSaverMode: (v: boolean) => void;
  dataSaverEnabled: boolean;
  setDataSaverEnabled: (v: boolean) => void;
  adminPendingFinance: number;
  setAdminPendingFinance: (n: number) => void;
  oddsFormat: "decimal" | "fractional";
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  paymentProviders: PaymentProvider[];
  target: BetTarget | null;
  openBet: (target: BetTarget) => void;
  closeBet: () => void;
  predictionTarget: PredictionModalTarget | null;
  openPredictionBet: (target: PredictionModalTarget) => void;
  closePredictionBet: () => void;
  marketMatch: ClientMatch | null;
  openMarkets: (match: ClientMatch) => void;
  closeMarkets: () => void;
  rechargeOpen: boolean;
  openRecharge: () => void;
  closeRecharge: () => void;
  shareTicketBet: ClientBet | null;
  openShareTicket: (bet: ClientBet) => void;
  closeShareTicket: () => void;
  toasts: ToastItem[];
  toast: (t: Omit<ToastItem, "id">) => void;
  dismissToast: (id: string) => void;
}

const COMBO_STORAGE_KEY = "pulse_android_combo_v2";
const POLICY_STORAGE_KEY = "pulse_odds_change_policy_v1";
const DATASAVER_STORAGE_KEY = "pulse_android_datasaver_v1";

const AppContext = createContext<AppContextValue | null>(null);

function MobileBackgroundQueries({
  authReady,
  dataSaverMode,
  user,
  pendingCount,
  betsVersion,
  setFeedMatches,
  setBalance,
  setPendingCount,
  toast,
  seenSettledTicketIds,
}: {
  authReady: boolean;
  dataSaverMode: boolean;
  user: ClientUser | null;
  pendingCount: number;
  betsVersion: number;
  setFeedMatches: (list: ClientMatch[]) => void;
  setBalance: (b: number) => void;
  setPendingCount: (n: number) => void;
  toast: (t: Omit<ToastItem, "id">) => void;
  seenSettledTicketIds: React.MutableRefObject<Set<string>>;
}) {
  const matchesQuery = useMobileMatchesSlimQuery({
    enabled: authReady,
    dataSaver: dataSaverMode,
    baseIntervalMs: 3_500,
  });

  useEffect(() => {
    if (matchesQuery.data?.matches) {
      setFeedMatches(matchesQuery.data.matches);
    }
  }, [matchesQuery.data, setFeedMatches]);

  const pulseActiveMs = Math.round(5_000 * (dataSaverMode ? 2.2 : 1));
  const pulseIdleMs = Math.round(15_000 * (dataSaverMode ? 2.2 : 1));
  const isLoggedInPlayer = authReady && Boolean(user) && user?.role !== "admin";

  const pulseQuery = useQuery({
    queryKey: [...mobileQueryKeys.userPulse(user?.id), betsVersion],
    queryFn: () => api.pulse(),
    enabled: isLoggedInPlayer,
    staleTime: 1_500,
    refetchInterval: !isLoggedInPlayer
      ? false
      : pendingCount > 0
        ? pulseActiveMs
        : pulseIdleMs,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const res = pulseQuery.data;
    if (!res || !user) return;
    if (typeof res.balance === "number") {
      setBalance(res.balance);
    }
    setPendingCount(res.pendingCount ?? 0);
    for (const tk of res.tickets ?? []) {
      if (tk.status === "pending") continue;
      const key = `${tk.kind}:${tk.id}:${tk.status}`;
      if (seenSettledTicketIds.current.has(key)) continue;
      seenSettledTicketIds.current.add(key);
      if (tk.status === "won" && (user.notifications ?? true)) {
        toast({
          kind: "win",
          title: `Pari gagné ! +${tk.potentialWin.toFixed(2).replace(".", ",")} €`,
          description: `${tk.title} · ${tk.selectionLabel}`,
        });
      } else if (tk.status === "void" && (user.notifications ?? true)) {
        toast({
          kind: "info",
          title: "Pari remboursé",
          description: `${tk.title} · Mise restituée`,
        });
      }
    }
  }, [pulseQuery.data, seenSettledTicketIds, setBalance, setPendingCount, toast, user]);

  return null;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<ClientUser | null>(null);
  const [balance, setBalanceState] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [betsVersion, setBetsVersion] = useState<number>(0);
  const [feedMatches, setFeedMatchesState] = useState<ClientMatch[] | null>(() =>
    getCachedMatchesList()
  );
  const [comboLegs, setComboLegs] = useState<ComboSelection[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuickMode, setComboQuickMode] = useState(false);
  const [oddsPolicy, setOddsPolicyState] =
    useState<OddsChangePolicy>("confirm_all");
  const [dataSaverMode, setDataSaverState] = useState<boolean>(false);
  const [adminPendingFinance, setAdminPendingFinance] = useState<number>(0);
  const [paymentProviders, setPaymentProviders] = useState<PaymentProvider[]>([]);

  const [target, setTarget] = useState<BetTarget | null>(null);
  const [predictionTarget, setPredictionTarget] =
    useState<PredictionModalTarget | null>(null);
  const [marketMatch, setMarketMatch] = useState<ClientMatch | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [shareTicketBet, setShareTicketBet] = useState<ClientBet | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const seenSettledTicketIds = useRef<Set<string>>(new Set());
  const comboLegsRef = useRef<ComboSelection[]>([]);
  comboLegsRef.current = comboLegs;

  const hapticsEnabled = user?.haptics ?? true;
  const soundEnabled = user?.sound ?? true;
  const oddsFormat = user?.oddsFormat ?? "decimal";

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      if (t.kind === "win" || t.kind === "success") {
        triggerHaptic("success", hapticsEnabled);
      } else if (t.kind === "error") {
        triggerHaptic("error", hapticsEnabled);
      }
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 3_600);
    },
    [hapticsEnabled]
  );

  const setBalance = useCallback((b: number) => {
    if (Number.isFinite(b)) {
      const clean = Math.round(b * 100) / 100;
      setBalanceState((prev) => (Math.abs(prev - clean) < 0.001 ? prev : clean));
      setUser((prev) => {
        if (!prev) return prev;
        if (Math.abs(prev.balance - clean) < 0.001) return prev;
        return { ...prev, balance: clean };
      });
    }
  }, []);

  const bumpBets = useCallback(() => {
    setBetsVersion((v) => v + 1);
    void queryClient.invalidateQueries({ queryKey: ["pulse"] });
    void queryClient.invalidateQueries({ queryKey: ["bets"] });
    void queryClient.invalidateQueries({ queryKey: ["predictions", "my-bets"] });
  }, [queryClient]);

  const applyUser = useCallback((u: ClientUser | null) => {
    setUser(u);
    if (u) {
      setBalanceState(Math.round(u.balance * 100) / 100);
    } else {
      setBalanceState(0);
      setPendingCount(0);
      clearPrivateEntityCaches();
      seenSettledTicketIds.current.clear();
    }
  }, []);

  const setFeedMatches = useCallback((list: ClientMatch[]) => {
    setFeedMatchesState(list);
    if (!list || list.length === 0) return;
    setComboLegs((prevLegs) => {
      if (prevLegs.length === 0) return prevLegs;
      const byId = new Map(list.map((m) => [m.id, m]));
      let changed = false;
      const next = prevLegs.map((leg) => {
        if (leg.kind !== "sport" || leg.matchId == null) return leg;
        const m = byId.get(leg.matchId);
        if (!m || m.status === "finished") return leg;
        let liveOdds: number | null = null;
        for (const g of m.markets ?? []) {
          if (g.key !== leg.market && !(leg.market === "result" && g.key === "1x2")) {
            continue;
          }
          for (const o of g.outcomes ?? []) {
            if (o.key === leg.selection && Number.isFinite(o.odds) && o.odds > 1) {
              liveOdds = roundOdds2(o.odds);
              break;
            }
          }
          if (liveOdds == null) {
            for (const r of g.rows ?? []) {
              for (const o of r.outcomes) {
                if (o.key === leg.selection && Number.isFinite(o.odds) && o.odds > 1) {
                  liveOdds = roundOdds2(o.odds);
                  break;
                }
              }
              if (liveOdds != null) break;
            }
          }
        }
        if (liveOdds == null && leg.market === "result") {
          if (leg.selection === "V1" && m.oddsHome > 1) {
            liveOdds = roundOdds2(m.oddsHome);
          } else if (leg.selection === "X" && m.oddsDraw != null && m.oddsDraw > 1) {
            liveOdds = roundOdds2(m.oddsDraw);
          } else if (leg.selection === "V2" && m.oddsAway > 1) {
            liveOdds = roundOdds2(m.oddsAway);
          }
        }
        const nextIsLive = m.status === "live";
        const nextOdds = liveOdds ?? leg.odds;
        if (Math.abs(nextOdds - leg.odds) >= 0.005 || Boolean(leg.isLive) !== nextIsLive) {
          changed = true;
          return { ...leg, odds: nextOdds, isLive: nextIsLive };
        }
        return leg;
      });
      if (!changed) return prevLegs;
      void AsyncStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribeUnauth = onUnauthorizedResponse(() => {
      if (mounted) applyUser(null);
    });

    (async () => {
      await Promise.all([
        hydrateEntityCacheFromDisk(),
        (async () => {
          try {
            const [rawCombo, rawPolicy, rawSaver] = await Promise.all([
              AsyncStorage.getItem(COMBO_STORAGE_KEY),
              AsyncStorage.getItem(POLICY_STORAGE_KEY),
              AsyncStorage.getItem(DATASAVER_STORAGE_KEY),
            ]);
            if (mounted && rawCombo) {
              const parsed = JSON.parse(rawCombo) as ComboSelection[];
              if (Array.isArray(parsed)) {
                setComboLegs(parsed.slice(0, MAX_COMBO_LEGS));
              }
            }
            if (
              mounted &&
              (rawPolicy === "confirm_all" || rawPolicy === "accept_higher")
            ) {
              setOddsPolicyState(rawPolicy);
            }
            if (mounted && rawSaver === "1") {
              setDataSaverState(true);
            }
          } catch {
            /* ignore */
          }
        })(),
      ]);

      if (mounted) {
        const diskMatches = getCachedMatchesList();
        if (diskMatches && diskMatches.length > 0) {
          setFeedMatchesState(diskMatches);
          queryClient.setQueryData(mobileQueryKeys.matchesSlim, {
            matches: diskMatches,
          });
        }
      }

      const token = await hydrateAuthToken();
      if (token) {
        try {
          const boot = await api.mobileBootstrap();
          if (mounted) {
            applyUser(boot.user);
            setPendingCount(boot.pendingCount ?? 0);
            if (Array.isArray(boot.providers)) {
              setPaymentProviders(boot.providers);
            }
            const existingPreds = getCachedPredictionsList();
            if (existingPreds && boot.myPredictionBets) {
              seedPredictionsSnapshot(
                existingPreds.map((q) => ({
                  ...q,
                  myBet: boot.myPredictionBets[q.id] ?? q.myBet ?? null,
                })),
                false
              );
            }
          }
        } catch {
          try {
            const me = await api.auth.me();
            if (mounted) applyUser(me.user);
          } catch {
            /* hors-ligne */
          }
        }
      }

      if (mounted) setAuthReady(true);
    })();

    return () => {
      mounted = false;
      unsubscribeUnauth();
    };
  }, [applyUser]);

  const refreshFeedMatches = useCallback(async () => {
    try {
      const res = await queryClient.fetchQuery({
        queryKey: mobileQueryKeys.matchesSlim,
        queryFn: () => api.matchesSlim(),
        staleTime: 0,
      });
      setFeedMatchesState(res.matches);
    } catch {
      /* conserve l'affichage */
    }
  }, [queryClient]);

  const refreshPulseNow = useCallback(async () => {
    if (!user) return;
    try {
      await queryClient.invalidateQueries({
        queryKey: mobileQueryKeys.userPulse(user.id),
      });
    } catch {
      /* silencieux */
    }
  }, [queryClient, user]);

  const persistCombo = useCallback((next: ComboSelection[]) => {
    setComboLegs(next);
    void AsyncStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(next)).catch(
      () => {}
    );
  }, []);

  const toggleComboLeg = useCallback(
    (leg: ComboSelection): ComboToggleResult => {
      const prev = comboLegsRef.current;

      const exactIdx = prev.findIndex(
        (l) =>
          l.uid === leg.uid &&
          l.market === leg.market &&
          l.selection === leg.selection
      );
      if (exactIdx !== -1) {
        const next = prev.filter((_, i) => i !== exactIdx);
        persistCombo(next);
        triggerHaptic("light", hapticsEnabled);
        return "removed";
      }

      // Interdit le mélange Match réel ("manual") + Match virtuel ("virtual")
      if (leg.kind === "sport" && leg.matchSource) {
        const otherSport = prev.filter(
          (l) => l.kind === "sport" && l.uid !== leg.uid && l.matchSource
        );
        if (otherSport.some((l) => l.matchSource !== leg.matchSource)) {
          triggerHaptic("error", hapticsEnabled);
          return "source_conflict";
        }
      }

      const sameEventIdx = prev.findIndex((l) => l.uid === leg.uid);
      if (sameEventIdx !== -1) {
        const next = [...prev];
        next[sameEventIdx] = leg;
        persistCombo(next);
        triggerHaptic("light", hapticsEnabled);
        return "replaced";
      }

      if (prev.length >= MAX_COMBO_LEGS) {
        triggerHaptic("warning", hapticsEnabled);
        return "full";
      }

      const next = [...prev, leg];
      persistCombo(next);
      triggerHaptic("light", hapticsEnabled);
      return "added";
    },
    [hapticsEnabled, persistCombo]
  );

  const removeComboLeg = useCallback(
    (uid: string) => {
      const next = comboLegsRef.current.filter((l) => l.uid !== uid);
      persistCombo(next);
      triggerHaptic("light", hapticsEnabled);
    },
    [hapticsEnabled, persistCombo]
  );

  const clearCombo = useCallback(() => {
    persistCombo([]);
  }, [persistCombo]);

  const loadComboLegs = useCallback(
    (legs: ComboSelection[]) => {
      persistCombo(legs.slice(0, MAX_COMBO_LEGS));
    },
    [persistCombo]
  );

  const applyComboOddsUpdates = useCallback(
    (updates?: OddsChangedLegDetail[]) => {
      if (!updates || updates.length === 0) return;
      const next = comboLegsRef.current.map((leg) => {
        const found = updates.find((u) =>
          leg.kind === "sport"
            ? u.kind === "sport" &&
              u.matchId === leg.matchId &&
              u.market === leg.market &&
              u.selection === leg.selection
            : u.kind === "prediction" &&
              u.questionId === leg.questionId &&
              u.selection === leg.selection
        );
        return found ? { ...leg, odds: roundOdds2(found.currentOdds) } : leg;
      });
      persistCombo(next);
    },
    [persistCombo]
  );

  const isInCombo = useCallback(
    (uid: string, market: string, selection: string) => {
      return comboLegs.some(
        (l) =>
          l.uid === uid && l.market === market && l.selection === selection
      );
    },
    [comboLegs]
  );

  const setOddsPolicy = useCallback((p: OddsChangePolicy) => {
    setOddsPolicyState(p);
    void AsyncStorage.setItem(POLICY_STORAGE_KEY, p).catch(() => {});
  }, []);

  const setDataSaverMode = useCallback((v: boolean) => {
    setDataSaverState(v);
    void AsyncStorage.setItem(DATASAVER_STORAGE_KEY, v ? "1" : "0").catch(
      () => {}
    );
  }, []);

  const openBet = useCallback(
    (nextTarget: BetTarget) => {
      triggerHaptic("light", hapticsEnabled);
      setTarget(nextTarget);
    },
    [hapticsEnabled]
  );
  const closeBet = useCallback(() => setTarget(null), []);

  const openPredictionBet = useCallback(
    (nextTarget: PredictionModalTarget) => {
      triggerHaptic("light", hapticsEnabled);
      setPredictionTarget(nextTarget);
    },
    [hapticsEnabled]
  );
  const closePredictionBet = useCallback(() => setPredictionTarget(null), []);

  const openMarkets = useCallback(
    (match: ClientMatch) => {
      triggerHaptic("light", hapticsEnabled);
      setMarketMatch(match);
    },
    [hapticsEnabled]
  );
  const closeMarkets = useCallback(() => setMarketMatch(null), []);

  const openCombo = useCallback(() => {
    triggerHaptic("light", hapticsEnabled);
    setComboOpen(true);
  }, [hapticsEnabled]);
  const closeCombo = useCallback(() => setComboOpen(false), []);

  const openRecharge = useCallback(() => {
    triggerHaptic("light", hapticsEnabled);
    setRechargeOpen(true);
    if (paymentProviders.length === 0) {
      void api.payments
        .providers()
        .then((r) => setPaymentProviders(r.providers))
        .catch(() => {});
    }
  }, [hapticsEnabled, paymentProviders.length]);
  const closeRecharge = useCallback(() => setRechargeOpen(false), []);

  const openShareTicket = useCallback(
    (bet: ClientBet) => {
      triggerHaptic("light", hapticsEnabled);
      setShareTicketBet(bet);
    },
    [hapticsEnabled]
  );
  const closeShareTicket = useCallback(() => setShareTicketBet(null), []);

  const value = useMemo<AppContextValue>(
    () => ({
      authReady,
      user,
      balance,
      setBalance,
      applyUser,
      pendingCount,
      setPendingCount,
      betsVersion,
      bumpBets,
      feedMatches,
      setFeedMatches,
      refreshFeedMatches,
      refreshPulseNow,
      comboLegs,
      comboOpen,
      openCombo,
      closeCombo,
      comboQuickMode,
      setComboQuickMode,
      toggleComboLeg,
      removeComboLeg,
      clearCombo,
      loadComboLegs,
      applyComboOddsUpdates,
      isInCombo,
      oddsPolicy,
      setOddsPolicy,
      dataSaverMode,
      setDataSaverMode,
      dataSaverEnabled: dataSaverMode,
      setDataSaverEnabled: setDataSaverMode,
      adminPendingFinance,
      setAdminPendingFinance,
      oddsFormat,
      soundEnabled,
      hapticsEnabled,
      paymentProviders,
      target,
      openBet,
      closeBet,
      predictionTarget,
      openPredictionBet,
      closePredictionBet,
      marketMatch,
      openMarkets,
      closeMarkets,
      rechargeOpen,
      openRecharge,
      closeRecharge,
      shareTicketBet,
      openShareTicket,
      closeShareTicket,
      toasts,
      toast,
      dismissToast,
    }),
    [
      applyComboOddsUpdates,
      applyUser,
      authReady,
      balance,
      betsVersion,
      bumpBets,
      clearCombo,
      closeBet,
      closeCombo,
      closeMarkets,
      closePredictionBet,
      closeRecharge,
      closeShareTicket,
      comboLegs,
      comboOpen,
      comboQuickMode,
      adminPendingFinance,
      dataSaverMode,
      dismissToast,
      feedMatches,
      hapticsEnabled,
      isInCombo,
      loadComboLegs,
      marketMatch,
      oddsFormat,
      oddsPolicy,
      openBet,
      openCombo,
      openMarkets,
      openPredictionBet,
      openRecharge,
      openShareTicket,
      paymentProviders,
      pendingCount,
      predictionTarget,
      rechargeOpen,
      refreshFeedMatches,
      refreshPulseNow,
      removeComboLeg,
      setBalance,
      setDataSaverMode,
      setFeedMatches,
      setOddsPolicy,
      shareTicketBet,
      soundEnabled,
      target,
      toast,
      toasts,
      toggleComboLeg,
      user,
    ]
  );

  return (
    <AppContext.Provider value={value}>
      <MobilePartyRealtimeBridge
        userId={user?.id ?? null}
        enabled={authReady && user?.role !== "admin"}
        onMatchesUpdated={setFeedMatches}
      >
        <MobileBackgroundQueries
          authReady={authReady}
          dataSaverMode={dataSaverMode}
          user={user}
          pendingCount={pendingCount}
          betsVersion={betsVersion}
          setFeedMatches={setFeedMatches}
          setBalance={setBalance}
          setPendingCount={setPendingCount}
          toast={toast}
          seenSettledTicketIds={seenSettledTicketIds}
        />
        {children}
      </MobilePartyRealtimeBridge>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used inside AppProvider");
  }
  return ctx;
}
