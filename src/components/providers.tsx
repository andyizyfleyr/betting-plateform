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
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { api, type ClientMatch, type ClientUser } from "@/lib/api";
import { cn } from "@/lib/format";
import { BetModal } from "./bet-modal";
import { MarketSheet } from "./market-sheet";

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
  applyUser: (u: ClientUser) => void;
  target: BetTarget | null;
  openBet: (t: BetTarget) => void;
  closeBet: () => void;
  marketMatch: ClientMatch | null;
  openMarkets: (m: ClientMatch) => void;
  closeMarkets: () => void;
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

export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [target, setTarget] = useState<BetTarget | null>(null);
  const [marketMatch, setMarketMatch] = useState<ClientMatch | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [betsVersion, setBetsVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    api
      .settings()
      .then((r) => setUser(r.user))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .bets("ongoing")
      .then((r) => setPendingCount(r.bets.length))
      .catch(() => undefined);
  }, [betsVersion]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    const timer = setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      3200
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
      toast,
      betsVersion,
      bumpBets: () => setBetsVersion((v) => v + 1),
      pendingCount,
    }),
    [user, target, marketMatch, toast, betsVersion, pendingCount]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <MarketSheet />
      <BetModal />
      <Toasts toasts={toasts} />
    </AppContext.Provider>
  );
}

const TOAST_STYLE = {
  success: { Icon: CheckCircle2, cls: "text-betclic-red" },
  error: { Icon: AlertTriangle, cls: "text-betclic-red" },
  info: { Icon: Info, cls: "text-betclic-red" },
} as const;

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[90] mx-auto flex w-full max-w-[26rem] flex-col items-center gap-2 px-3.5">
      <AnimatePresence>
        {toasts.map((t) => {
          const { Icon, cls } = TOAST_STYLE[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -24, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -18, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className="pointer-events-auto flex w-full items-center gap-3 overflow-hidden rounded-xl border border-edge bg-white/95 py-3 pl-0 pr-4 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.15)] backdrop-blur-xl"
            >
              <span
                className={cn(
                  "-ml-px h-full w-[3px] shrink-0 self-stretch",
                  t.kind === "success" && "bg-betclic-red",
                  t.kind === "error" && "bg-bittersweet",
                  t.kind === "info" && "bg-betclic-red"
                )}
              />
              <Icon className={`h-5 w-5 shrink-0 ${cls}`} strokeWidth={2.2} />
              <div className="min-w-0">
                <p className="truncate font-display text-[13px] font-semibold text-ink">
                  {t.title}
                </p>
                {t.description && (
                  <p className="truncate text-xs text-mist">{t.description}</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
