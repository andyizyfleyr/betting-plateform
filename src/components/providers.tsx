"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { api, type ClientMatch, type ClientUser } from "@/lib/api";
import {
  MAX_COMBO_LEGS,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { cn, eur } from "@/lib/format";
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
  user: ClientUser | null;
  balance: number;
  oddsFormat: "decimal" | "fractional";
  setBalance: (n: number) => void;
  applyUser: (u: ClientUser | null) => void;
  target: BetTarget | null;
  openBet: (t: BetTarget) => void;
  closeBet: () => void;
  marketMatch: ClientMatch | null;
  openMarkets: (m: ClientMatch) => void;
  closeMarkets: () => void;
  feedMatches: ClientMatch[] | null;
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

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp doit être utilisé dans <Providers>");
  return ctx;
}

let toastId = 0;
const COMBO_STORAGE_KEY = "pulsebet_combo_v1";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => getBrowserQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ProvidersInner>{children}</ProvidersInner>
    </QueryClientProvider>
  );
}

function ProvidersRealtimeQueries({
  user,
  setUser,
  loggedIn,
  isAuthRoute,
  isAdminMode,
  isMatchsRoute,
  isParisRoute,
  needsBackgroundMatchFeed,
  hasPending,
  betsVersion,
  setFeedMatches,
  setPendingCount,
  toast,
}: {
  user: ClientUser | null;
  setUser: React.Dispatch<React.SetStateAction<ClientUser | null>>;
  loggedIn: boolean;
  isAuthRoute: boolean;
  isAdminMode: boolean;
  isMatchsRoute: boolean;
  isParisRoute: boolean;
  needsBackgroundMatchFeed: boolean;
  hasPending: boolean;
  betsVersion: number;
  setFeedMatches: (m: ClientMatch[] | null) => void;
  setPendingCount: (n: number) => void;
  toast: (t: Omit<Toast, "id">) => void;
}) {
  const { wsConnected, userWsConnected } = useRealtimeStatus();
  const { isConstrained, isOffline } = useNetworkQuality();
  const bgMatchesIntervalMs = getAdaptiveIntervalMs(15_000, isConstrained);
  const bgBetsIntervalMs = getAdaptiveIntervalMs(8_000, isConstrained);

  const prevBetStatuses = useRef<Map<string, string> | null>(null);
  const userRef = useRef<ClientUser | null>(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const isDesktop =
    typeof window !== "undefined" && window.innerWidth >= 1024;
  const shouldSyncBgMatches =
    !isAuthRoute &&
    !isAdminMode &&
    !isMatchsRoute &&
    (isDesktop || needsBackgroundMatchFeed) &&
    !isOffline;

  const bgMatchesQuery = useQuery({
    queryKey: pulseQueryKeys.matches,
    queryFn: () => api.matches(),
    enabled: shouldSyncBgMatches,
    refetchInterval: wsConnected ? 60_000 : bgMatchesIntervalMs,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (bgMatchesQuery.data?.matches) {
      setFeedMatches(bgMatchesQuery.data.matches);
    }
  }, [bgMatchesQuery.data, setFeedMatches]);

  // Synchronisation TanStack Query du solde & tickets (`/api/pulse`) :
  // - 0 polling continu lorsque le salon privé PartyKit `user-<id>` est connecté !
  // - Bascule automatique sur `bgBetsIntervalMs` uniquement s'il y a >= 1 pari en cours et pas de WebSocket.
  const pulseQuery = useQuery({
    queryKey: [...pulseQueryKeys.userPulse(user?.id), betsVersion],
    queryFn: () => api.pulse(),
    enabled: loggedIn && !isOffline,
    staleTime: 2_000,
    refetchInterval:
      userWsConnected || !hasPending || isParisRoute ? false : bgBetsIntervalMs,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const r = pulseQuery.data;
    if (!r) return;

    setPendingCount(r.pendingCount);
    if (typeof r.balance === "number") {
      setUser((u) => (u && u.balance !== r.balance ? { ...u, balance: r.balance } : u));
    }

    const currentPrefs = userRef.current;
    const prev = prevBetStatuses.current;
    if (prev && (currentPrefs?.notifications ?? true)) {
      for (const b of r.tickets) {
        const key = `${b.kind}-${b.id}`;
        if (prev.get(key) !== "pending" || b.status === "pending") continue;
        if (b.status === "won") {
          playUiSound(currentPrefs?.sound, "win");
          triggerHaptic(currentPrefs?.haptics, [25, 35, 55]);
          toast({
            kind: "success",
            title: "Pari gagné !",
            description: `+${eur(b.potentialWin)} crédités sur votre solde`,
          });
        } else if (b.status === "void") {
          triggerHaptic(currentPrefs?.haptics, 18);
          toast({
            kind: "info",
            title: "Mise remboursée",
            description: `+${eur(b.stake)} recrédités sur votre solde`,
          });
        } else if (b.status === "lost") {
          triggerHaptic(currentPrefs?.haptics, 18);
          toast({
            kind: "info",
            title: "Pari terminé",
            description: b.selectionLabel
              ? `${b.title} · ${b.selectionLabel}`
              : b.title,
          });
        }
      }
    }
    prevBetStatuses.current = new Map(
      r.tickets.map((b) => [`${b.kind}-${b.id}`, b.status])
    );
  }, [pulseQuery.data, setPendingCount, setUser, toast]);

  return null;
}

function ProvidersInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const isAuthRoute = pathname === "/auth" || pathname.startsWith("/auth/");

  const [user, setUser] = useState<ClientUser | null>(null);
  const [target, setTarget] = useState<BetTarget | null>(null);
  const [marketMatch, setMarketMatch] = useState<ClientMatch | null>(null);
  const [feedMatches, setFeedMatches] = useState<ClientMatch[] | null>(null);
  const [sportUniverse, setSportUniverse] = useState<SportUniverse | null>(null);
  const [sportLeagueFilter, setSportLeagueFilter] = useState("all");
  const [sportStatusFilter, setSportStatusFilter] = useState<SportStatusFilter>("all");
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [comboLegs, setComboLegs] = useState<ComboSelection[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuickMode, setComboQuickMode] = useState(false);
  const [oddsPolicy, setOddsPolicyState] = useState<OddsChangePolicy>("confirm_all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [betsVersion, setBetsVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [adminTab, setAdminTab] = useState<AdminTabKey>("dashboard");
  const [adminPendingFinance, setAdminPendingFinance] = useState(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const userRef = useRef<ClientUser | null>(null);

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

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-1), { ...t, id }]);
    const timer = setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      2800
    );
    timers.current.set(id, timer);
  }, []);

  useEffect(() => {
    if (isAuthRoute || user) return;
    let active = true;
    api
      .settings()
      .then((r) => {
        if (active) setUser(r.user);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isAuthRoute, user]);

  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminMode = isAdminRoute || user?.role === "admin";
  const loggedIn = user !== null && !isAuthRoute && !isAdminMode;

  const isMatchsRoute = pathname === "/matchs" || pathname.startsWith("/matchs/");
  const isParisRoute = pathname === "/paris" || pathname.startsWith("/paris/");
  const needsBackgroundMatchFeed =
    comboLegs.length > 0 || comboOpen || marketMatch !== null || target !== null;
  const hasPending = pendingCount > 0;

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const toggleComboLeg = useCallback(
    (
      sel: ComboSelection
    ): "added" | "replaced" | "removed" | "full" | "source_conflict" => {
      triggerHaptic(userRef.current?.haptics, 14);
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

      if (comboLegs.length >= MAX_COMBO_LEGS) {
        return "full";
      }
      const next = [...comboLegs, sel];
      persistCombo(next);
      return "added";
    },
    [comboLegs, persistCombo]
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

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      balance: user?.balance ?? 0,
      oddsFormat: user?.oddsFormat ?? "decimal",
      setBalance: (n) => setUser((u) => (u ? { ...u, balance: n } : u)),
      applyUser: setUser,
      target,
      openBet: (t) => {
        triggerHaptic(user?.haptics, 10);
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
            toast({ kind: "error", title: "Coupon complet (8 sélections max)" });
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
      closeBet: () => setTarget(null),
      marketMatch,
      openMarkets: (m) => {
        triggerHaptic(user?.haptics, 10);
        setMarketMatch(m);
      },
      closeMarkets: () => setMarketMatch(null),
      feedMatches,
      setFeedMatches,
      sportUniverse,
      setSportUniverse,
      sportLeagueFilter,
      setSportLeagueFilter,
      sportStatusFilter,
      setSportStatusFilter,
      rechargeOpen,
      openRecharge: () => setRechargeOpen(true),
      closeRecharge: () => setRechargeOpen(false),
      comboLegs,
      comboOpen,
      comboQuickMode,
      setComboQuickMode,
      openCombo: () => setComboOpen(true),
      closeCombo: () => setComboOpen(false),
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
      bumpBets: () => {
        setBetsVersion((v) => v + 1);
        void queryClient.invalidateQueries({ queryKey: ["pulse"] });
        void queryClient.invalidateQueries({ queryKey: ["bets"] });
        void queryClient.invalidateQueries({ queryKey: ["predictions", "my-bets"] });
      },
      pendingCount,
      adminTab,
      setAdminTab,
      adminPendingFinance,
      setAdminPendingFinance,
    }),
    [
      user,
      target,
      marketMatch,
      feedMatches,
      sportUniverse,
      sportLeagueFilter,
      sportStatusFilter,
      rechargeOpen,
      comboLegs,
      comboOpen,
      comboQuickMode,
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
      queryClient,
      pendingCount,
      adminTab,
      adminPendingFinance,
    ]
  );

  return (
    <AppContext.Provider value={value}>
      <PartyRealtimeBridge
        userId={user?.id ?? null}
        disabled={isAuthRoute}
        onMatchesUpdated={setFeedMatches}
      >
        <ProvidersRealtimeQueries
          user={user}
          setUser={setUser}
          loggedIn={loggedIn}
          isAuthRoute={isAuthRoute}
          isAdminMode={isAdminMode}
          isMatchsRoute={isMatchsRoute}
          isParisRoute={isParisRoute}
          needsBackgroundMatchFeed={needsBackgroundMatchFeed}
          hasPending={hasPending}
          betsVersion={betsVersion}
          setFeedMatches={setFeedMatches}
          setPendingCount={setPendingCount}
          toast={toast}
        />
        {children}
        {!isAdminMode && (
          <>
            <ComboSheet />
            <MarketSheet />
            <BetModal />
            <RechargeModal open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
          </>
        )}
        <Toasts toasts={toasts} />
      </PartyRealtimeBridge>
    </AppContext.Provider>
  );
}

const TOAST_STYLE = {
  success: { Icon: CheckCircle2, cls: "text-win", bar: "bg-win" },
  error: { Icon: AlertTriangle, cls: "text-betclic-red", bar: "bg-betclic-red" },
  info: { Icon: Info, cls: "text-ink", bar: "bg-ink" },
} as const;

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[90] mx-auto flex w-full max-w-[420px] flex-col items-center gap-2 px-3.5 lg:left-auto lg:right-6 lg:top-4 lg:mx-0 lg:px-0"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const { Icon, cls, bar } = TOAST_STYLE[t.kind];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto flex w-full items-center gap-3 overflow-hidden rounded-xl border border-edge bg-white py-2.5 pl-0 pr-3.5 shadow-lg"
            >
              <span className={cn("h-full w-1 shrink-0 self-stretch", bar)} />
              <Icon className={cn("h-4 w-4 shrink-0", cls)} strokeWidth={2.3} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[13px] font-semibold text-ink">
                  {t.title}
                </p>
                {t.description && (
                  <p className="truncate text-[11.5px] text-mist">{t.description}</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
