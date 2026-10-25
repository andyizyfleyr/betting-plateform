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
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { api, type ClientMatch, type ClientUser } from "@/lib/api";
import { cn } from "@/lib/format";
import { BetModal } from "./bet-modal";
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
  rechargeOpen: boolean;
  openRecharge: () => void;
  closeRecharge: () => void;
  toast: (t: Omit<Toast, "id">) => void;
  betsVersion: number;
  bumpBets: () => void;
  pendingCount: number;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp doit être utilisé dans <Providers>");
  return ctx;
}

let toastId = 0;
const POLL_INTERVAL = 5_000;

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === "/auth" || pathname.startsWith("/auth/");

  const [user, setUser] = useState<ClientUser | null>(null);
  const [target, setTarget] = useState<BetTarget | null>(null);
  const [marketMatch, setMarketMatch] = useState<ClientMatch | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [betsVersion, setBetsVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

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

  const loggedIn = user !== null && !isAuthRoute;

  useEffect(() => {
    if (!loggedIn) return;
    let active = true;

    const poll = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      api
        .bets("ongoing")
        .then((r) => {
          if (!active) return;
          setPendingCount(r.bets.length);
          const bal = r.balance;
          if (typeof bal === "number") {
            setUser((u) => (u ? { ...u, balance: bal } : u));
          }
        })
        .catch(() => undefined);
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loggedIn, betsVersion]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-1), { ...t, id }]);
    const timer = setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      2800
    );
    timers.current.set(id, timer);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      balance: user?.balance ?? 0,
      oddsFormat: user?.oddsFormat ?? "decimal",
      setBalance: (n) => setUser((u) => (u ? { ...u, balance: n } : u)),
      applyUser: setUser,
      target,
      openBet: (t) => setTarget(t),
      closeBet: () => setTarget(null),
      marketMatch,
      openMarkets: (m) => setMarketMatch(m),
      closeMarkets: () => setMarketMatch(null),
      rechargeOpen,
      openRecharge: () => setRechargeOpen(true),
      closeRecharge: () => setRechargeOpen(false),
      toast,
      betsVersion,
      bumpBets: () => setBetsVersion((v) => v + 1),
      pendingCount,
    }),
    [user, target, marketMatch, rechargeOpen, toast, betsVersion, pendingCount]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <MarketSheet />
      <BetModal />
      <RechargeModal open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
      <Toasts toasts={toasts} />
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
      className="pointer-events-none fixed inset-x-0 top-3 z-[90] mx-auto flex w-full max-w-[420px] flex-col items-center gap-2 px-3.5"
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
