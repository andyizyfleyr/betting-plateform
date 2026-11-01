"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { ApiRequestError, api, type ClientMatch, type ClientUser } from "@/lib/api";
import { AUTH_UID_COOKIE, USER_CACHE_STORAGE_KEY } from "@/lib/jwt";
import {
  MAX_COMBO_LEGS,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { DEFAULT_BETTING_LIMITS, limitsForCurrency, validateBettingLimits, type BettingLimits } from "@/lib/betting-limits-shared";
import {
  DEFAULT_COUNTRY_CODE,
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
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import {
  readStoredOddsPolicy,
  writeStoredOddsPolicy,
  type OddsChangedLegDetail,
  type OddsChangePolicy,
} from "@/lib/odds-lock";
import {
  PartyRealtimeBridge,
  useRealtimeStatus,
} from "@/lib/party-realtime";
import {
  getBrowserQueryClient,
  pulseQueryKeys,
} from "@/lib/query-client";
import { BetModal } from "./bet-modal";
import { ComboSheet, type ComboSelection } from "./combo-slip";
import { MarketSheet } from "./market-sheet";
import { RechargeModal } from "./recharge-modal";
import { ActionOutcome } from "./action-outcome";

export interface BetTarget {
  match: ClientMatch;
  selection: string;
  odds: number;
  label: string;
  market: string;
  marketLabel: string;
}

interface Toast {
  id: number;
  title: string;
  description?: string;
  kind: "success" | "error" | "info";
}

export type AdminTabKey =
  | "dashboard"
  | "forecasts"
  | "matches"
  | "ml"
  | "questions"
  | "users"
  | "bets"
  | "deposits";

export type SportUniverse = "real" | "virtual";
export type SportStatusFilter = "all" | "live" | "upcoming" | "finished";

interface AppContextValue {
  authReady: boolean;
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
  oddsFormat: "decimal" | "fractional";
  setBalance: (n: number) => void;
  applyUser: (u: ClientUser | null) => void;
  target: BetTarget | null;
  openBet: (t: BetTarget) => void;
  closeBet: () => void;
  marketMatch: ClientMatch | null;
  openMarkets: (m: ClientMatch) => void;
  closeMarkets: () => void;
  setFeedMatches: (m: ClientMatch[] | null) => void;
  sportUniverse: SportUniverse | null;
  setSportUniverse: (u: SportUniverse | null) => void;
  sportLeagueFilter: string;
  setSportLeagueFilter: (league: string) => void;
  sportStatusFilter: SportStatusFilter;
  setSportStatusFilter: (status: SportStatusFilter) => void;
  rechargeOpen: boolean;
  openRecharge: () => void;
  closeRecharge: () => void;
  comboLegs: ComboSelection[];
  comboOpen: boolean;
  comboQuickMode: boolean;
  setComboQuickMode: (v: boolean) => void;
  openCombo: () => void;
  closeCombo: () => void;
  toggleComboLeg: (
    sel: ComboSelection
  ) => "added" | "replaced" | "removed" | "full" | "source_conflict";
  isInCombo: (uid: string, market: string, selection: string) => boolean;
  removeComboLeg: (uid: string) => void;
  clearCombo: () => void;
  loadComboLegs: (legs: ComboSelection[]) => void;
  applyComboOddsUpdates: (updates: OddsChangedLegDetail[]) => void;
  oddsPolicy: OddsChangePolicy;
  setOddsPolicy: (policy: OddsChangePolicy) => void;
  toast: (t: Omit<Toast, "id">) => void;
  betsVersion: number;
  bumpBets: () => void;
  pendingCount: number;
  adminTab: AdminTabKey;
  setAdminTab: (t: AdminTabKey) => void;
  adminPendingFinance: number;
  setAdminPendingFinance: (n: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
const FeedMatchesContext = createContext<ClientMatch[] | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp doit être utilisé dans <Providers>");
  return ctx;
}

export function useFeedMatches(): ClientMatch[] | null {
  return useContext(FeedMatchesContext);
}

const COMBO_STORAGE_KEY = "pulsebet_combo_v1";
const GUEST_COUNTRY_STORAGE_KEY = "pulse_guest_country_v1";

interface WebAuthSnapshot {
  user: ClientUser | null;
  authReady: boolean;
}

const SERVER_AUTH_SNAPSHOT: WebAuthSnapshot = {
  user: null,
  authReady: false,
};

function readUidHintFromDocumentCookie(): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie ? document.cookie.split(";") : [];
  for (const raw of parts) {
    const [k, ...rest] = raw.trim().split("=");
    if (k === AUTH_UID_COOKIE) {
      const val = decodeURIComponent(rest.join("=")).trim();
      return val.length > 0 ? val : null;
    }
  }
  return null;
}

// Ne stocker qu'un indicateur de session, jamais le profil ni le solde.
function removeLegacyWebBalance(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(USER_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { id?: unknown; balance?: unknown };
    if (typeof parsed.id === "number") {
      if ("balance" in parsed) window.localStorage.setItem(USER_CACHE_STORAGE_KEY, JSON.stringify({ id: parsed.id }));
    } else window.localStorage.removeItem(USER_CACHE_STORAGE_KEY);
  } catch { /* stockage indisponible */ }
}

function writeStoredWebUser(u: ClientUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (u) window.localStorage.setItem(USER_CACHE_STORAGE_KEY, JSON.stringify({ id: u.id }));
    else window.localStorage.removeItem(USER_CACHE_STORAGE_KEY);
  } catch { /* stockage indisponible */ }
}

let clientAuthHydrated = false;
let clientAuthSnapshot: WebAuthSnapshot = SERVER_AUTH_SNAPSHOT;
const authStoreListeners = new Set<() => void>();

function notifyAuthStore(): void {
  for (const listener of authStoreListeners) {
    listener();
  }
}

function ensureClientAuthHydrated(): void {
  if (clientAuthHydrated || typeof window === "undefined") return;
  clientAuthHydrated = true;
  const uidCookie = readUidHintFromDocumentCookie();
  removeLegacyWebBalance();
  if (uidCookie) {
    // Ne pas afficher un solde sauvegardé : attendre le profil serveur.
    clientAuthSnapshot = { user: null, authReady: false };
  } else {
    writeStoredWebUser(null);
    clientAuthSnapshot = { user: null, authReady: true };
  }
}

function subscribeWebAuthStore(listener: () => void): () => void {
  authStoreListeners.add(listener);
  return () => {
    authStoreListeners.delete(listener);
  };
}

function getClientWebAuthSnapshot(): WebAuthSnapshot {
  ensureClientAuthHydrated();
  return clientAuthSnapshot;
}

function getServerWebAuthSnapshot(): WebAuthSnapshot {
  return SERVER_AUTH_SNAPSHOT;
}

function setWebAuthUser(nextUser: ClientUser | null, markReady = true): void {
  ensureClientAuthHydrated();
  writeStoredWebUser(nextUser);
  if (!nextUser && typeof document !== "undefined") {
    document.cookie = `${AUTH_UID_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  const nextReady = markReady ? true : clientAuthSnapshot.authReady;
  if (
    clientAuthSnapshot.user === nextUser &&
    clientAuthSnapshot.authReady === nextReady
  ) {
    return;
  }
  clientAuthSnapshot = {
    user: nextUser,
    authReady: nextReady,
  };
  notifyAuthStore();
}

function updateWebAuthBalance(cleanBalance: number): void {
  ensureClientAuthHydrated();
  const cur = clientAuthSnapshot.user;
  if (!cur || Math.abs(cur.balance - cleanBalance) < 1e-6) return;
  const updated: ClientUser = { ...cur, balance: cleanBalance };
  writeStoredWebUser(updated);
  clientAuthSnapshot = {
    user: updated,
    authReady: true,
  };
  notifyAuthStore();
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => getBrowserQueryClient());
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw-static.js").catch(() => {});
    }
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ProvidersInner>{children}</ProvidersInner>
    </QueryClientProvider>
  );
}

function ProvidersRealtimeQueries({
  user,
  setBalance,
  loggedIn,
  isAuthRoute,
  isAdminMode,
  isMatchsFeedRoute,
  isParisRoute,
  needsBackgroundMatchFeed,
  hasPending,
  betsVersion,
  setFeedMatches,
  setPendingCount,
}: {
  user: ClientUser | null;
  setBalance: (n: number) => void;
  loggedIn: boolean;
  isAuthRoute: boolean;
  isAdminMode: boolean;
  isMatchsFeedRoute: boolean;
  isParisRoute: boolean;
  needsBackgroundMatchFeed: boolean;
  hasPending: boolean;
  betsVersion: number;
  setFeedMatches: (m: ClientMatch[] | null) => void;
  setPendingCount: (n: number) => void;
}) {
  const { wsConnected } = useRealtimeStatus();
  const { isConstrained, isOffline } = useNetworkQuality();
  const bgMatchesIntervalMs = getAdaptiveIntervalMs(6_000, isConstrained);
  const bgWsFullSyncMs = getAdaptiveIntervalMs(12_000, isConstrained);
  const bgBetsActiveMs = getAdaptiveIntervalMs(8_000, isConstrained);
  const bgBetsIdleMs = getAdaptiveIntervalMs(20_000, isConstrained);

  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const shouldSyncBgMatches =
    !isAuthRoute &&
    !isAdminMode &&
    !isMatchsFeedRoute &&
    (isDesktop || needsBackgroundMatchFeed) &&
    !isOffline;

  const bgMatchesQuery = useQuery({
    queryKey: pulseQueryKeys.matches,
    queryFn: () => api.matches(),
    enabled: shouldSyncBgMatches,
    refetchInterval: wsConnected ? bgWsFullSyncMs : bgMatchesIntervalMs,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (bgMatchesQuery.data?.matches) {
      setFeedMatches(bgMatchesQuery.data.matches);
    }
  }, [bgMatchesQuery.data, setFeedMatches]);

  // Synchronisation automatique du solde & des règlements de paris (`/api/pulse`) :
  // - Même lorsque le WebSocket privé est connecté ou qu'il y a 0 pari en cours, maintient une
  //   veille légère (8 s si pari en attente, 20 s au repos) afin que les dépôts/retraits validés
  //   par l'admin ou les mises multi-appareils s'actualisent sans rechargement manuel.
  const pulseQuery = useQuery({
    queryKey: [...pulseQueryKeys.userPulse(user?.id), betsVersion],
    queryFn: () => api.pulse(),
    enabled: loggedIn && !isOffline,
    staleTime: 5_000,
    refetchInterval: isParisRoute
      ? bgBetsIdleMs
      : hasPending
        ? bgBetsActiveMs
        : bgBetsIdleMs,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const r = pulseQuery.data;
    if (!r) return;

    setPendingCount(r.pendingCount);
    if (typeof r.balance === "number") {
      setBalance(r.balance);
    }

  }, [pulseQuery.data, setBalance, setPendingCount]);

  return null;
}

function ProvidersInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const isAuthRoute = pathname === "/auth" || pathname.startsWith("/auth/");

  const { user, authReady } = useSyncExternalStore(
    subscribeWebAuthStore,
    getClientWebAuthSnapshot,
    getServerWebAuthSnapshot
  );
  const applyUser = useCallback((u: ClientUser | null) => {
    setWebAuthUser(u, true);
  }, []);
  const [target, setTarget] = useState<BetTarget | null>(null);
  const [marketMatch, setMarketMatch] = useState<ClientMatch | null>(null);
  const [feedMatches, setFeedMatchesState] = useState<ClientMatch[] | null>(null);
  const [sportUniverse, setSportUniverse] = useState<SportUniverse | null>(null);
  const [sportLeagueFilter, setSportLeagueFilter] = useState("all");
  const [sportStatusFilter, setSportStatusFilter] = useState<SportStatusFilter>("all");
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [comboLegs, setComboLegs] = useState<ComboSelection[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuickMode, setComboQuickMode] = useState(false);
  const [oddsPolicy, setOddsPolicyState] = useState<OddsChangePolicy>("confirm_all");
  const [betsVersion, setBetsVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [adminTab, setAdminTab] = useState<AdminTabKey>("dashboard");
  const [adminPendingFinance, setAdminPendingFinance] = useState(0);
  const [guestCountryCode, setGuestCountryCodeState] =
    useState<string>(DEFAULT_COUNTRY_CODE);
  const [clientHydrated, setClientHydrated] = useState(false);
  const guestCountryManualRef = useRef(false);
  const userRef = useRef<ClientUser | null>(null);

  const setGuestCountryCode = useCallback((raw: string) => {
    const clean = normalizeCountryCode(raw);
    guestCountryManualRef.current = true;
    setGuestCountryCodeState(clean);
    try {
      window.localStorage.setItem(GUEST_COUNTRY_STORAGE_KEY, clean);
    } catch {
      /* ignore */
    }
  }, []);

  const countryCode = useMemo(() => {
    if (!clientHydrated) return DEFAULT_COUNTRY_CODE;
    if (user) return normalizeCountryCode(user.countryCode);
    return normalizeCountryCode(guestCountryCode);
  }, [clientHydrated, user, guestCountryCode]);

  const currency = useMemo<CurrencyCode>(() => {
    if (!clientHydrated) return "EUR";
    if (user) {
      return normalizeCurrencyCode(
        user.currency,
        getOfficialCurrencyForCountry(countryCode)
      );
    }
    return getOfficialCurrencyForCountry(countryCode);
  }, [clientHydrated, user, countryCode]);

  const countryConfig = useMemo(
    () => getCountryConfig(countryCode),
    [countryCode]
  );
  const limitsQuery = useQuery({
    queryKey: ["betting-limits"],
    queryFn: async () => {
      const response = await fetch("/api/betting-limits", { cache: "no-store" });
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
  if (typeof window !== "undefined" && clientHydrated) {
    setActiveDisplayCurrency(isAdminPath ? "EUR" : currency);
  }

  useEffect(() => {
    setActiveDisplayCurrency(isAdminPath ? "EUR" : currency);
  }, [isAdminPath, currency]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(COMBO_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ComboSelection[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setComboLegs(
              sortSlipSelectionsChronologically(parsed.slice(0, MAX_COMBO_LEGS))
            );
          }
        }
      } catch {
        /* silencieux */
      }
      setOddsPolicyState(readStoredOddsPolicy());
      setClientHydrated(true);
      let storedGuest: string | null = null;
      try {
        storedGuest = window.localStorage.getItem(GUEST_COUNTRY_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      if (storedGuest && isValidCountryCode(storedGuest)) {
        guestCountryManualRef.current = true;
        setGuestCountryCodeState(storedGuest.trim().toUpperCase());
      } else {
        setGuestCountryCodeState(detectCountryFromDevice());
        void api.auth
          .geo()
          .then((g) => {
            if (
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
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const setOddsPolicy = useCallback((policy: OddsChangePolicy) => {
    setOddsPolicyState(policy);
    writeStoredOddsPolicy(policy);
  }, []);

  const persistCombo = useCallback((next: ComboSelection[]) => {
    const ordered = sortSlipSelectionsChronologically(next);
    setComboLegs(ordered);
    if (ordered.length === 0) setComboQuickMode(false);
    try {
      sessionStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(ordered));
    } catch {
      /* silencieux */
    }
  }, []);

  const [outcome, setOutcome] = useState<Omit<Toast, "id"> | null>(null);
  const toast = useCallback((t: Omit<Toast, "id">) => {
    if (t.kind === "info" || /ajouté au coupon|sélection remplacée dans le coupon/i.test(t.title)) return;
    setOutcome(t);
  }, []);

  useEffect(() => {
    if (isAuthRoute) {
      if (!authReady) {
        setWebAuthUser(userRef.current, true);
      }
      return;
    }
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const syncSettings = async (attempt = 0) => {
      if (!readUidHintFromDocumentCookie() && !userRef.current) {
        if (active) setWebAuthUser(null, true);
        return;
      }
      try {
        const r = await api.settings();
        if (!active) return;
        setWebAuthUser(r.user, true);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiRequestError && err.status === 401) {
          setWebAuthUser(null, true);
          return;
        }
        // En cas de lenteur réseau passagère (hors 401), conserve le profil en cache
        // ou réessaie automatiquement sans jamais afficher « Connectez-vous » à tort.
        const delayMs = Math.min(6_000, 1_500 * Math.max(1, attempt + 1));
        retryTimer = setTimeout(() => {
          void syncSettings(attempt + 1);
        }, delayMs);
      }
    };

    void syncSettings(0);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== USER_CACHE_STORAGE_KEY) return;
      // Un autre onglet a changé de session : revalider auprès du serveur,
      // sans restaurer de solde périmé depuis localStorage.
      if (readUidHintFromDocumentCookie()) void syncSettings(0);
      else setWebAuthUser(null, true);
    };
    const onAuthExpired = () => {
      if (active) setWebAuthUser(null, true);
    };
    const onOnline = () => {
      if (!userRef.current && readUidHintFromDocumentCookie()) {
        void syncSettings(0);
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pulsebet:auth-expired", onAuthExpired);
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pulsebet:auth-expired", onAuthExpired);
      window.removeEventListener("online", onOnline);
    };
  }, [authReady, isAuthRoute]);

  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminMode = isAdminRoute || user?.role === "admin";
  const loggedIn = user !== null && !isAuthRoute && !isAdminMode;

  const isMatchsFeedRoute =
    pathname === "/matchs" ||
    pathname === "/matchs/tous" ||
    pathname === "/matchs/virtuels";
  const isBetslipRoute =
    pathname === "/betslip" || pathname.startsWith("/betslip/");
  const isParisRoute = pathname === "/paris" || pathname.startsWith("/paris/");
  const needsBackgroundMatchFeed =
    isBetslipRoute ||
    comboLegs.length > 0 ||
    comboOpen ||
    marketMatch !== null ||
    target !== null;
  const hasPending = pendingCount > 0;


  const toggleComboLeg = useCallback(
    (
      sel: ComboSelection
    ): "added" | "replaced" | "removed" | "full" | "source_conflict" => {
      triggerHaptic(userRef.current?.haptics ?? true, 10);
      playUiSound(userRef.current?.sound, "tap");
      const existingIdx = comboLegs.findIndex((l) => l.uid === sel.uid);
      if (existingIdx >= 0) {
        const existing = comboLegs[existingIdx];
        if (existing.market === sel.market && existing.selection === sel.selection) {
          persistCombo(comboLegs.filter((l) => l.uid !== sel.uid));
          return "removed";
        }
        const replaced = [...comboLegs];
        replaced[existingIdx] = sel;
        persistCombo(replaced);
        return "replaced";
      }

      // Interdiction absolue de mélanger un match réel ("manual") et un match virtuel ("virtual")
      if (sel.kind === "sport" && sel.matchSource) {
        const hasConflict = comboLegs.some(
          (l) =>
            l.kind === "sport" &&
            l.matchSource != null &&
            l.matchSource !== sel.matchSource
        );
        if (hasConflict) {
          return "source_conflict";
        }
      }

      if (comboLegs.length >= bettingLimits.maxComboLegs) {
        return "full";
      }
      const next = [...comboLegs, sel];
      persistCombo(next);
      return "added";
    },
    [comboLegs, persistCombo, bettingLimits.maxComboLegs]
  );

  const isInCombo = useCallback(
    (uid: string, market: string, selection: string) =>
      comboLegs.some(
        (l) => l.uid === uid && l.market === market && l.selection === selection
      ),
    [comboLegs]
  );

  const removeComboLeg = useCallback(
    (uid: string) => {
      triggerHaptic(userRef.current?.haptics, 10);
      persistCombo(comboLegs.filter((l) => l.uid !== uid));
    },
    [comboLegs, persistCombo]
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
    (updates: OddsChangedLegDetail[]) => {
      if (!updates || updates.length === 0) return;
      const next = comboLegs.map((leg) => {
        const hit = updates.find((u) =>
          leg.kind === "sport"
            ? u.kind === "sport" &&
              u.matchId === leg.matchId &&
              u.market === leg.market &&
              u.selection === leg.selection
            : u.kind === "prediction" &&
              u.questionId === leg.questionId &&
              u.selection === leg.selection
        );
        return hit ? { ...leg, odds: hit.currentOdds } : leg;
      });
      persistCombo(next);
    },
    [comboLegs, persistCombo]
  );

  // Met à jour `feedMatches` ET synchronise dans le même lot les cotes live du coupon combiné
  const setFeedMatches = useCallback((list: ClientMatch[] | null) => {
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
              liveOdds = Math.round(o.odds * 100) / 100;
              break;
            }
          }
          if (liveOdds == null) {
            for (const r of g.rows ?? []) {
              for (const o of r.outcomes) {
                if (o.key === leg.selection && Number.isFinite(o.odds) && o.odds > 1) {
                  liveOdds = Math.round(o.odds * 100) / 100;
                  break;
                }
              }
              if (liveOdds != null) break;
            }
          }
        }
        if (liveOdds == null && (leg.market === "result" || leg.market === "1x2")) {
          if ((leg.selection === "home" || leg.selection === "V1") && m.oddsHome > 1) {
            liveOdds = Math.round(m.oddsHome * 100) / 100;
          } else if (
            (leg.selection === "draw" || leg.selection === "X") &&
            m.oddsDraw != null &&
            m.oddsDraw > 1
          ) {
            liveOdds = Math.round(m.oddsDraw * 100) / 100;
          } else if ((leg.selection === "away" || leg.selection === "V2") && m.oddsAway > 1) {
            liveOdds = Math.round(m.oddsAway * 100) / 100;
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
      const ordered = sortSlipSelectionsChronologically(next);
      try {
        sessionStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(ordered));
      } catch {
        /* silencieux */
      }
      return ordered;
    });
  }, []);

  const hapticsRef = useRef<boolean | undefined>(user?.haptics);
  useEffect(() => {
    hapticsRef.current = user?.haptics;
  }, [user?.haptics]);

  const setBalance = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const clean = roundEurPivot(n);
    updateWebAuthBalance(clean);
  }, []);

  const openBet = useCallback(
    (t: BetTarget) => {
      triggerHaptic(hapticsRef.current, 10);
      if (typeof window !== "undefined" && window.innerWidth >= 1024) {
        const comboSel: ComboSelection = {
          uid: `sport-${t.match.id}`,
          kind: "sport",
          matchId: t.match.id,
          matchSource: t.match.source,
          title: `${t.match.homeTeam} – ${t.match.awayTeam}`,
          homeTeam: t.match.homeTeam,
          awayTeam: t.match.awayTeam,
          homeLogo: t.match.homeLogo,
          awayLogo: t.match.awayLogo,
          league: t.match.league,
          market: t.market,
          selection: t.selection,
          selectionLabel: t.label,
          odds: t.odds,
          startsAt: t.match.startsAt,
          isLive: t.match.status === "live",
        };
        const res = toggleComboLeg(comboSel);
        if (res === "full") {
          toast({ kind: "error", title: "Coupon complet (limite atteinte)" });
        } else if (res === "source_conflict") {
          toast({
            kind: "error",
            title: "Mélange interdit",
            description:
              "Impossible de mélanger un match réel et un match virtuel dans le même coupon.",
          });
        }
        setMarketMatch(null);
        return;
      }
      setTarget(t);
    },
    [toggleComboLeg, toast]
  );

  const closeBet = useCallback(() => setTarget(null), []);

  const openMarkets = useCallback((m: ClientMatch) => {
    triggerHaptic(hapticsRef.current, 10);
    setMarketMatch(m);
  }, []);

  const closeMarkets = useCallback(() => setMarketMatch(null), []);
  const openRecharge = useCallback(() => setRechargeOpen(true), []);
  const closeRecharge = useCallback(() => setRechargeOpen(false), []);
  const openCombo = useCallback(() => setComboOpen(true), []);
  const closeCombo = useCallback(() => setComboOpen(false), []);

  const bumpBets = useCallback(() => {
    setBetsVersion((v) => v + 1);
    void queryClient.invalidateQueries({ queryKey: ["pulse"] });
    void queryClient.invalidateQueries({ queryKey: ["bets"] });
    void queryClient.invalidateQueries({ queryKey: ["predictions", "my-bets"] });
  }, [queryClient]);

  const value = useMemo<AppContextValue>(
    () => ({
      authReady,
      user,
      balance: user?.balance ?? 0,
      countryCode,
      currency,
      countryConfig,
      currencyConfig,
      bettingLimits,
      bettingLimitsReady,
      maxPayoutEur,
      setGuestCountryCode,
      oddsFormat: user?.oddsFormat ?? "decimal",
      setBalance,
      applyUser,
      target,
      openBet,
      closeBet,
      marketMatch,
      openMarkets,
      closeMarkets,
      setFeedMatches,
      sportUniverse,
      setSportUniverse,
      sportLeagueFilter,
      setSportLeagueFilter,
      sportStatusFilter,
      setSportStatusFilter,
      rechargeOpen,
      openRecharge,
      closeRecharge,
      comboLegs,
      comboOpen,
      comboQuickMode,
      setComboQuickMode,
      openCombo,
      closeCombo,
      toggleComboLeg,
      isInCombo,
      removeComboLeg,
      clearCombo,
      loadComboLegs,
      applyComboOddsUpdates,
      oddsPolicy,
      setOddsPolicy,
      toast,
      betsVersion,
      bumpBets,
      pendingCount,
      adminTab,
      setAdminTab,
      adminPendingFinance,
      setAdminPendingFinance,
    }),
    [
      authReady,
      user,
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
      target,
      openBet,
      closeBet,
      marketMatch,
      openMarkets,
      closeMarkets,
      setFeedMatches,
      sportUniverse,
      sportLeagueFilter,
      sportStatusFilter,
      rechargeOpen,
      openRecharge,
      closeRecharge,
      comboLegs,
      comboOpen,
      comboQuickMode,
      openCombo,
      closeCombo,
      toggleComboLeg,
      isInCombo,
      removeComboLeg,
      clearCombo,
      loadComboLegs,
      applyComboOddsUpdates,
      oddsPolicy,
      setOddsPolicy,
      toast,
      betsVersion,
      bumpBets,
      pendingCount,
      adminTab,
      adminPendingFinance,
    ]
  );

  return (
    <AppContext.Provider value={value}>
      <FeedMatchesContext.Provider value={feedMatches}>
        <PartyRealtimeBridge
          userId={user?.id ?? null}
          disabled={isAuthRoute}
          onMatchesUpdated={setFeedMatches}
        >
          <ProvidersRealtimeQueries
            user={user}
            setBalance={setBalance}
            loggedIn={loggedIn}
            isAuthRoute={isAuthRoute}
            isAdminMode={isAdminMode}
            isMatchsFeedRoute={isMatchsFeedRoute}
            isParisRoute={isParisRoute}
            needsBackgroundMatchFeed={needsBackgroundMatchFeed}
            hasPending={hasPending}
            betsVersion={betsVersion}
            setFeedMatches={setFeedMatches}
            setPendingCount={setPendingCount}
          />
          {children}
          {outcome && outcome.kind !== "info" && <ActionOutcome kind={outcome.kind} title={outcome.title} description={outcome.description} onClose={() => setOutcome(null)} />}
          {!isAdminMode && (
            <>
              <ComboSheet />
              <MarketSheet />
              <BetModal />
              <RechargeModal open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
            </>
          )}
        </PartyRealtimeBridge>
      </FeedMatchesContext.Provider>
    </AppContext.Provider>
  );
}
