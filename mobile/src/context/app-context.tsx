import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActionOutcome } from "@/components/action-outcome";
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
import { DEFAULT_BETTING_LIMITS, limitsForCurrency, validateBettingLimits, type BettingLimits } from "@/lib/betting-limits-shared";
import { API_BASE_URL } from "@/lib/http";
import {
  detectCountryFromDevice,
  getCountryConfig,
  getCurrencyConfig,
  getOfficialCurrencyForCountry,
  isValidCountryCode,
  normalizeCountryCode,
  normalizeCurrencyCode,
  roundEurPivot,
  type CountryConfig,
  type CurrencyCode,
  type CurrencyConfig,
} from "@/lib/countries";
import { setActiveDisplayCurrency } from "@/lib/format";
import { usePathname } from "@/lib/router";
import {
  clearPrivateEntityCaches,
  getCachedMatchesList,
  getCachedPredictionsList,
  hydrateEntityCacheFromDisk,
  seedPredictionsSnapshot,
} from "@/lib/entity-cache";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMemoryAuthToken,
  hydrateAuthToken,
  onUnauthorizedResponse,
} from "@/lib/http";
import {
  forceRefreshMobileMatchesFeed,
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

// Persiste les sélections, jamais les cotes ; elles sont rechargées avant validation.
function serializeComboSelections(legs: ComboSelection[]): string {
  return JSON.stringify(legs.map((leg) => ({ ...leg, odds: 0 })));
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
  sessionRestoring: boolean;
  user: ClientUser | null;
  balance: number;
  countryCode: string;
  currency: CurrencyCode;
  countryConfig: CountryConfig;
  currencyConfig: CurrencyConfig;
  bettingLimits: BettingLimits;
  bettingLimitsReady: boolean;
  maxPayoutEur: number;
  setGuestCountryCode: (code: string) => void;
  setBalance: (b: number) => void;
  applyUser: (u: ClientUser | null) => void;
  pendingCount: number;
  setPendingCount: (n: number) => void;
  betsVersion: number;
  bumpBets: () => void;
  feedMatches: ClientMatch[] | null;
  setFeedMatches: (list: ClientMatch[]) => void;
  refreshFeedMatches: (force?: boolean) => Promise<void>;
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
  toast: (t: Omit<ToastItem, "id">) => void;
}

const COMBO_STORAGE_KEY = "pulse_android_combo_v2";
const POLICY_STORAGE_KEY = "pulse_odds_change_policy_v1";
const DATASAVER_STORAGE_KEY = "pulse_android_datasaver_v1";
const USER_STORAGE_KEY = "pulse_cached_user_v1";
const GUEST_COUNTRY_STORAGE_KEY = "pulse_guest_country_v1";

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
}: {
  authReady: boolean;
  dataSaverMode: boolean;
  user: ClientUser | null;
  pendingCount: number;
  betsVersion: number;
  setFeedMatches: (list: ClientMatch[]) => void;
  setBalance: (b: number) => void;
  setPendingCount: (n: number) => void;
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
  }, [pulseQuery.data, setBalance, setPendingCount, user]);

  return null;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [authReady, setAuthReady] = useState(false);
  const [sessionRestoring, setSessionRestoring] = useState(false);
  const [user, setUser] = useState<ClientUser | null>(null);
  const [balance, setBalanceState] = useState<number>(0);
  const [guestCountryCode, setGuestCountryCodeState] = useState<string>(() =>
    detectCountryFromDevice()
  );
  const guestCountryManualRef = useRef(false);
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

  const comboLegsRef = useRef<ComboSelection[]>([]);
  comboLegsRef.current = comboLegs;

  const hapticsEnabled = user?.haptics ?? true;
  const soundEnabled = user?.sound ?? true;
  const oddsFormat = user?.oddsFormat ?? "decimal";

  const setGuestCountryCode = useCallback((raw: string) => {
    const clean = normalizeCountryCode(raw);
    guestCountryManualRef.current = true;
    setGuestCountryCodeState(clean);
    void AsyncStorage.setItem(GUEST_COUNTRY_STORAGE_KEY, clean).catch(() => {});
  }, []);

  const countryCode = useMemo(
    () =>
      user
        ? normalizeCountryCode(user.countryCode)
        : normalizeCountryCode(guestCountryCode),
    [user, guestCountryCode]
  );

  const currency = useMemo<CurrencyCode>(
    () =>
      user
        ? normalizeCurrencyCode(
            user.currency,
            getOfficialCurrencyForCountry(countryCode)
          )
        : getOfficialCurrencyForCountry(countryCode),
    [user, countryCode]
  );

  const countryConfig = useMemo(
    () => getCountryConfig(countryCode),
    [countryCode]
  );
  const limitsQuery = useQuery({
    queryKey: ["betting-limits"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/api/betting-limits`, { cache: "no-store" });
      if (!response.ok) throw new Error("Limites indisponibles");
      const value = validateBettingLimits(await response.json());
      if (!value) throw new Error("Limites invalides");
      return value;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const bettingLimits = limitsQuery.data ?? DEFAULT_BETTING_LIMITS;
  const bettingLimitsReady = Boolean(limitsQuery.data) && !limitsQuery.isError;
  const maxPayoutEur = limitsForCurrency(bettingLimits, currency).maxPayoutEur;
  const currencyConfig = useMemo(() => {
    const base = getCurrencyConfig(currency);
    const limits = limitsForCurrency(bettingLimits, currency);
    return { ...base, minStakeLocal: limits.minLocal, maxComboStakeLocal: limits.maxLocal, maxPredictionStakeLocal: limits.maxLocal };
  }, [currency, bettingLimits]);

  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  setActiveDisplayCurrency(isAdminPath ? "EUR" : currency);
  useEffect(() => {
    setActiveDisplayCurrency(isAdminPath ? "EUR" : currency);
  }, [isAdminPath, currency]);

  const [outcome, setOutcome] = useState<Omit<ToastItem, "id"> | null>(null);
  const toast = useCallback((t: Omit<ToastItem, "id">) => {
    if (t.kind === "info" || /ajouté au coupon|sélection remplacée dans le coupon/i.test(t.title)) return;
    setOutcome(t);
  }, []);

  const setBalance = useCallback((b: number) => {
    if (Number.isFinite(b)) {
      const clean = roundEurPivot(b);
      setBalanceState((prev) => (Math.abs(prev - clean) < 1e-6 ? prev : clean));
      setUser((prev) => {
        if (!prev) return prev;
        if (Math.abs(prev.balance - clean) < 1e-6) return prev;
        const updated = { ...prev, balance: clean };
        return updated;
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
      setSessionRestoring(false);
      setBalanceState(roundEurPivot(u.balance));
    } else {
      setSessionRestoring(false);
      setBalanceState(0);
      setPendingCount(0);
      clearPrivateEntityCaches();
      void AsyncStorage.removeItem(USER_STORAGE_KEY).catch(() => {});
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
        if (liveOdds == null && (leg.market === "result" || leg.market === "1x2")) {
          if (
            (leg.selection === "V1" || leg.selection === "home") &&
            m.oddsHome > 1
          ) {
            liveOdds = roundOdds2(m.oddsHome);
          } else if (
            (leg.selection === "X" || leg.selection === "draw") &&
            m.oddsDraw != null &&
            m.oddsDraw > 1
          ) {
            liveOdds = roundOdds2(m.oddsDraw);
          } else if (
            (leg.selection === "V2" || leg.selection === "away") &&
            m.oddsAway > 1
          ) {
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
      void AsyncStorage.setItem(COMBO_STORAGE_KEY, serializeComboSelections(next)).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    let restoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeUnauth = onUnauthorizedResponse(() => {
      if (mounted) applyUser(null);
    });

    (async () => {
      void AsyncStorage.removeItem(USER_STORAGE_KEY).catch(() => {});
      const withStorageTimeout = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((resolve) => setTimeout(() => resolve(fallback), 2_500)),
        ]);

      const [token] = await Promise.all([
        hydrateAuthToken(),
        withStorageTimeout(hydrateEntityCacheFromDisk(), undefined),
        withStorageTimeout(
          (async () => {
            try {
              const [rawCombo, rawPolicy, rawSaver, rawGuestCountry] =
                await Promise.all([
                  AsyncStorage.getItem(COMBO_STORAGE_KEY),
                  AsyncStorage.getItem(POLICY_STORAGE_KEY),
                  AsyncStorage.getItem(DATASAVER_STORAGE_KEY),
                  AsyncStorage.getItem(GUEST_COUNTRY_STORAGE_KEY),
                ]);
              if (
                mounted &&
                rawGuestCountry &&
                isValidCountryCode(rawGuestCountry)
              ) {
                guestCountryManualRef.current = true;
                setGuestCountryCodeState(rawGuestCountry.trim().toUpperCase());
              } else if (mounted) {
                void api.auth
                  .geo()
                  .then((g) => {
                    if (
                      mounted &&
                      !guestCountryManualRef.current &&
                      g.detected &&
                      g.countryCode &&
                      isValidCountryCode(g.countryCode)
                    ) {
                      setGuestCountryCodeState(g.countryCode);
                    }
                  })
                  .catch(() => {});
              }
              if (mounted && rawCombo) {
                const parsed = JSON.parse(rawCombo) as ComboSelection[];
                if (Array.isArray(parsed)) {
                  const restored = parsed.slice(0, MAX_COMBO_LEGS).map((leg) => ({ ...leg, odds: 0 }));
                  setComboLegs(restored);
                  void AsyncStorage.setItem(COMBO_STORAGE_KEY, serializeComboSelections(restored)).catch(() => {});
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
          undefined
        ),
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

      if (token) {
        // Le solde ne doit pas être restauré depuis le disque.
        if (mounted) setSessionRestoring(true);

        const runNetworkBootstrap = async () => {
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
              if (mounted && getMemoryAuthToken()) {
                const retryAuth = async () => {
                  if (!mounted || !getMemoryAuthToken()) {
                    if (mounted) setSessionRestoring(false);
                    return;
                  }
                  try {
                    const me = await api.auth.me();
                    if (mounted) applyUser(me.user);
                  } catch {
                    if (mounted && getMemoryAuthToken()) {
                      restoreRetryTimer = setTimeout(
                        () => void retryAuth(),
                        2_000
                      );
                    } else if (mounted) {
                      setSessionRestoring(false);
                    }
                  }
                };
                restoreRetryTimer = setTimeout(() => void retryAuth(), 1_500);
              }
            }
          }
        };

        await Promise.race([
          runNetworkBootstrap(),
          new Promise<void>((resolve) => setTimeout(resolve, 2_800)),
        ]);
      }


      if (mounted) setAuthReady(true);
    })();

    return () => {
      mounted = false;
      if (restoreRetryTimer) clearTimeout(restoreRetryTimer);
      unsubscribeUnauth();
    };
  }, [applyUser, queryClient]);

  const refreshFeedMatches = useCallback(
    async (force = false) => {
      try {
        if (force) {
          const res = await forceRefreshMobileMatchesFeed(queryClient);
          setFeedMatches(res.matches);
          return;
        }
        const res = await queryClient.fetchQuery({
          queryKey: mobileQueryKeys.matchesSlim,
          queryFn: () => api.matchesSlim(),
          staleTime: 0,
        });
        setFeedMatches(res.matches);
      } catch {
        /* conserve l'affichage */
      }
    },
    [queryClient, setFeedMatches]
  );

  const refreshPulseNow = useCallback(async () => {
    if (!user) return;
    try {
      const fresh = await api.pulse({ forceRefresh: true });
      queryClient.setQueryData(
        [...mobileQueryKeys.userPulse(user.id), betsVersion],
        fresh
      );
      if (typeof fresh.balance === "number") setBalance(fresh.balance);
      setPendingCount(fresh.pendingCount ?? 0);
    } catch {
      /* silencieux */
    }
  }, [betsVersion, queryClient, setBalance, user]);

  const persistCombo = useCallback((next: ComboSelection[]) => {
    comboLegsRef.current = next;
    setComboLegs(next);
    void AsyncStorage.setItem(COMBO_STORAGE_KEY, serializeComboSelections(next)).catch(
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

      if (prev.length >= bettingLimits.maxComboLegs) {
        triggerHaptic("warning", hapticsEnabled);
        return "full";
      }

      const next = [...prev, leg];
      persistCombo(next);
      triggerHaptic("light", hapticsEnabled);
      return "added";
    },
    [hapticsEnabled, persistCombo, bettingLimits.maxComboLegs]
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
      sessionRestoring,
      user,
      balance,
      countryCode,
      currency,
      countryConfig,
      currencyConfig,
      bettingLimits,
      bettingLimitsReady,
      maxPayoutEur,
      setGuestCountryCode,
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
      toast,
    }),
    [
      applyComboOddsUpdates,
      applyUser,
      authReady,
      sessionRestoring,
      balance,
      countryCode,
      currency,
      countryConfig,
      currencyConfig,
      bettingLimits,
      bettingLimitsReady,
      maxPayoutEur,
      setGuestCountryCode,
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
        />
        {children}
        {outcome && outcome.kind !== "info" && <ActionOutcome kind={outcome.kind === "error" ? "error" : "success"} title={outcome.title} description={outcome.description ?? outcome.subtitle} onClose={() => setOutcome(null)} />}
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
