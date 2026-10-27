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
  type ClientBet,
  type ClientMatch,
  type ClientPredictionQuestion,
  type ClientUser,
  type OddsLockPolicy,
  type PaymentProviderInfo,
} from "@/lib/api";
import { MAX_COMBO_LEGS } from "@/lib/combo-math";
import {
  clearPrivateEntityCaches,
  getCachedMatchesList,
  hydrateEntityCacheFromDisk,
  seedPredictionsSnapshot,
  getCachedPredictionsList,
} from "@/lib/entity-cache";
import { hydrateAuthToken, onUnauthorizedResponse } from "@/lib/http";
import { useSmartPolling } from "@/lib/polling";
import { triggerHaptic } from "@/theme/tokens";

export interface BetModalTarget {
  match: ClientMatch;
  market: string;
  marketLabel: string;
  selection: string;
  selectionLabel: string;
  odds: number;
}

export interface PredictionModalTarget {
  question: ClientPredictionQuestion;
  selection: string;
  selectionLabel: string;
  odds: number;
}

export interface ComboSlipLeg {
  uid: string;
  kind: "sport" | "prediction";
  matchId?: number;
  questionId?: number;
  title: string;
  league: string;
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  startsAt?: string | null;
  isLive?: boolean;
  source?: "virtual" | "manual";
}

export interface ToastItem {
  id: string;
  kind: "success" | "error" | "info" | "win";
  title: string;
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
  feedMatches: ClientMatch[] | null;
  refreshFeedMatches: () => Promise<void>;
  refreshPulseNow: () => Promise<void>;
  comboLegs: ComboSlipLeg[];
  toggleComboLeg: (leg: Omit<ComboSlipLeg, "uid">) => "added" | "removed" | "replaced" | "full";
  removeComboLeg: (uid: string) => void;
  clearCombo: () => void;
  replaceComboLegs: (legs: ComboSlipLeg[]) => void;
  isInCombo: (
    kind: "sport" | "prediction",
    entityId: number,
    market: string,
    selection: string
  ) => boolean;
  oddsPolicy: OddsLockPolicy;
  setOddsPolicy: (p: OddsLockPolicy) => void;
  dataSaverMode: boolean;
  setDataSaverMode: (v: boolean) => void;
  oddsFormat: "decimal" | "fractional";
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  stakePresets: number[];
  paymentProviders: PaymentProviderInfo[];
  betTarget: BetModalTarget | null;
  openBet: (target: BetModalTarget) => void;
  closeBet: () => void;
  predictionTarget: PredictionModalTarget | null;
  openPredictionBet: (target: PredictionModalTarget) => void;
  closePredictionBet: () => void;
  marketMatchId: number | null;
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

const COMBO_STORAGE_KEY = "pulse_android_combo_v1";
const POLICY_STORAGE_KEY = "pulse_android_odds_policy_v1";
const DATASAVER_STORAGE_KEY = "pulse_android_datasaver_v1";

const AppContext = createContext<AppContextValue | null>(null);

export function makeComboUid(
  kind: "sport" | "prediction",
  entityId: number,
  market: string,
  selection: string
): string {
  return `${kind}:${entityId}:${market}:${selection}`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<ClientUser | null>(null);
  const [balance, setBalanceState] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [feedMatches, setFeedMatches] = useState<ClientMatch[] | null>(() =>
    getCachedMatchesList()
  );
  const [comboLegs, setComboLegs] = useState<ComboSlipLeg[]>([]);
  const [oddsPolicy, setOddsPolicyState] = useState<OddsLockPolicy>("accept_higher");
  const [dataSaverMode, setDataSaverState] = useState<boolean>(false);
  const [paymentProviders, setPaymentProviders] = useState<PaymentProviderInfo[]>([]);

  const [betTarget, setBetTarget] = useState<BetModalTarget | null>(null);
  const [predictionTarget, setPredictionTarget] =
    useState<PredictionModalTarget | null>(null);
  const [marketMatchId, setMarketMatchId] = useState<number | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [shareTicketBet, setShareTicketBet] = useState<ClientBet | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const seenSettledTicketIds = useRef<Set<string>>(new Set());

  const hapticsEnabled = user?.hapticsEnabled ?? true;
  const soundEnabled = user?.soundEnabled ?? true;
  const oddsFormat = user?.oddsFormat ?? "decimal";
  const stakePresets = useMemo(
    () => (user?.stakePresets?.length ? user.stakePresets : [5, 10, 25, 50]),
    [user?.stakePresets]
  );

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
      }, 3_800);
    },
    [hapticsEnabled]
  );

  const setBalance = useCallback((b: number) => {
    if (Number.isFinite(b)) {
      setBalanceState(Math.round(b * 100) / 100);
    }
  }, []);

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

  // Hydratation initiale à froid : cache disque 0 ms + jeton Keystore + bootstrap 1-requête
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
              const parsed = JSON.parse(rawCombo) as ComboSlipLeg[];
              if (Array.isArray(parsed)) setComboLegs(parsed.slice(0, MAX_COMBO_LEGS));
            }
            if (
              mounted &&
              (rawPolicy === "strict" ||
                rawPolicy === "accept_higher" ||
                rawPolicy === "accept_any")
            ) {
              setOddsPolicyState(rawPolicy);
            }
            if (mounted && rawSaver === "1") {
              setDataSaverState(true);
            }
          } catch {
            // Silencieux
          }
        })(),
      ]);

      if (mounted) {
        const diskMatches = getCachedMatchesList();
        if (diskMatches && diskMatches.length > 0) {
          setFeedMatches(diskMatches);
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
            // Mode hors-ligne temporaire : conserve l'UI disponible
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
      const res = await api.matchesSlim();
      setFeedMatches(res.matches);
    } catch {
      // Conserve le dernier snapshot mémoire
    }
  }, []);

  const refreshPulseNow = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.pulse();
      if (typeof res.balance === "number") {
        setBalance(res.balance);
      }
      setPendingCount(res.pendingCount ?? 0);
      for (const tk of res.tickets ?? []) {
        if (tk.status === "pending") continue;
        const key = `${tk.kind}:${tk.id}:${tk.status}`;
        if (seenSettledTicketIds.current.has(key)) continue;
        seenSettledTicketIds.current.add(key);
        if (tk.status === "won") {
          toast({
            kind: "win",
            title: `Pari gagné ! +${tk.potentialWin.toFixed(2).replace(".", ",")} €`,
            subtitle: `${tk.title} · ${tk.selectionLabel}`,
          });
        } else if (tk.status === "void") {
          toast({
            kind: "info",
            title: "Pari remboursé",
            subtitle: `${tk.title} · Mise restituée`,
          });
        }
      }
    } catch {
      // Silencieux en cas de micro-coupure réseau
    }
  }, [setBalance, toast, user]);

  // Polling global des matchs (5.5s, pause auto en arrière-plan, ×2.4 en mode économie 3G)
  useSmartPolling(refreshFeedMatches, 5_500, {
    enabled: authReady,
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  // Pulsation légère joueur connecté (14s, 304 ETag si inchangé)
  useSmartPolling(refreshPulseNow, 14_000, {
    enabled: authReady && Boolean(user) && user?.role !== "admin",
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const persistCombo = useCallback((next: ComboSlipLeg[]) => {
    setComboLegs(next);
    void AsyncStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const toggleComboLeg = useCallback(
    (leg: Omit<ComboSlipLeg, "uid">): "added" | "removed" | "replaced" | "full" => {
      const entityId = leg.kind === "sport" ? (leg.matchId ?? 0) : (leg.questionId ?? 0);
      const uid = makeComboUid(leg.kind, entityId, leg.market, leg.selection);
      let outcome: "added" | "removed" | "replaced" | "full" = "added";

      setComboLegs((prev) => {
        const exactIdx = prev.findIndex((l) => l.uid === uid);
        if (exactIdx !== -1) {
          outcome = "removed";
          const next = prev.filter((l) => l.uid !== uid);
          void AsyncStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        }
        const sameEventIdx = prev.findIndex((l) =>
          leg.kind === "sport"
            ? l.kind === "sport" && l.matchId === leg.matchId
            : l.kind === "prediction" && l.questionId === leg.questionId
        );
        if (sameEventIdx !== -1) {
          outcome = "replaced";
          const next = [...prev];
          next[sameEventIdx] = { ...leg, uid };
          void AsyncStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        }
        if (prev.length >= MAX_COMBO_LEGS) {
          outcome = "full";
          return prev;
        }
        outcome = "added";
        const next = [...prev, { ...leg, uid }];
        void AsyncStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });

      triggerHaptic("light", hapticsEnabled);
      return outcome;
    },
    [hapticsEnabled]
  );

  const removeComboLeg = useCallback(
    (uid: string) => {
      setComboLegs((prev) => {
        const next = prev.filter((l) => l.uid !== uid);
        void AsyncStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      triggerHaptic("light", hapticsEnabled);
    },
    [hapticsEnabled]
  );

  const clearCombo = useCallback(() => {
    persistCombo([]);
  }, [persistCombo]);

  const replaceComboLegs = useCallback(
    (legs: ComboSlipLeg[]) => {
      persistCombo(legs.slice(0, MAX_COMBO_LEGS));
    },
    [persistCombo]
  );

  const isInCombo = useCallback(
    (
      kind: "sport" | "prediction",
      entityId: number,
      market: string,
      selection: string
    ) => {
      const uid = makeComboUid(kind, entityId, market, selection);
      return comboLegs.some((l) => l.uid === uid);
    },
    [comboLegs]
  );

  const setOddsPolicy = useCallback((p: OddsLockPolicy) => {
    setOddsPolicyState(p);
    void AsyncStorage.setItem(POLICY_STORAGE_KEY, p).catch(() => {});
  }, []);

  const setDataSaverMode = useCallback((v: boolean) => {
    setDataSaverState(v);
    void AsyncStorage.setItem(DATASAVER_STORAGE_KEY, v ? "1" : "0").catch(() => {});
  }, []);

  const openBet = useCallback(
    (target: BetModalTarget) => {
      triggerHaptic("light", hapticsEnabled);
      setBetTarget(target);
    },
    [hapticsEnabled]
  );

  const closeBet = useCallback(() => setBetTarget(null), []);

  const openPredictionBet = useCallback(
    (target: PredictionModalTarget) => {
      triggerHaptic("light", hapticsEnabled);
      setPredictionTarget(target);
    },
    [hapticsEnabled]
  );

  const closePredictionBet = useCallback(() => setPredictionTarget(null), []);

  const openMarkets = useCallback(
    (match: ClientMatch) => {
      triggerHaptic("light", hapticsEnabled);
      setMarketMatchId(match.id);
    },
    [hapticsEnabled]
  );

  const closeMarkets = useCallback(() => setMarketMatchId(null), []);

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
      feedMatches,
      refreshFeedMatches,
      refreshPulseNow,
      comboLegs,
      toggleComboLeg,
      removeComboLeg,
      clearCombo,
      replaceComboLegs,
      isInCombo,
      oddsPolicy,
      setOddsPolicy,
      dataSaverMode,
      setDataSaverMode,
      oddsFormat,
      soundEnabled,
      hapticsEnabled,
      stakePresets,
      paymentProviders,
      betTarget,
      openBet,
      closeBet,
      predictionTarget,
      openPredictionBet,
      closePredictionBet,
      marketMatchId,
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
      applyUser,
      authReady,
      balance,
      betTarget,
      clearCombo,
      closeBet,
      closeMarkets,
      closePredictionBet,
      closeRecharge,
      closeShareTicket,
      comboLegs,
      dataSaverMode,
      dismissToast,
      feedMatches,
      hapticsEnabled,
      isInCombo,
      marketMatchId,
      oddsFormat,
      oddsPolicy,
      openBet,
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
      replaceComboLegs,
      setBalance,
      setDataSaverMode,
      setOddsPolicy,
      shareTicketBet,
      soundEnabled,
      stakePresets,
      toast,
      toasts,
      toggleComboLeg,
      user,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used inside AppProvider");
  }
  return ctx;
}
