"use client";

/**
 * Provider admin : charge le panneau de données (/api/admin) et expose
 * l'état partagé (panel, loading, busy, notice, act, load) ainsi que les
 * forms d'édition (match, question, balance, stakeLimit) à toutes les
 * pages de l'admin. Le polling reste centralisé ici.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useApp } from "@/components/providers";
import {
  POLL_INTERVAL,
  defaultQuestionOptions,
  emptyMarkets,
  type PanelData,
  type QuestionFormState,
} from "./admin-shared";

export interface AdminContextValue {
  panel: PanelData | null;
  loading: boolean;
  busy: Record<string, boolean>;
  notice: { kind: "ok" | "err"; msg: string } | null;
  setNotice: (n: { kind: "ok" | "err"; msg: string } | null) => void;
  load: (isBackground?: boolean) => Promise<void>;
  act: (payload: Record<string, unknown>, key: string, okMsg: string) => Promise<boolean>;
  matchForm: MatchFormState;
  setMatchForm: (f: MatchFormState) => void;
  questionForm: QuestionFormState;
  setQuestionForm: (f: QuestionFormState) => void;
  balanceForm: Record<number, string>;
  setBalanceForm: (f: Record<number, string>) => void;
  stakeLimitForm: Record<number, string>;
  setStakeLimitForm: (f: Record<number, string>) => void;
  onAddMatch: (e: FormEvent) => Promise<boolean>;
  onAddQuestion: (e: FormEvent) => Promise<boolean>;
  setAdminPendingFinance: (n: number) => void;
}

export interface MatchFormState {
  home: string;
  away: string;
  league: string;
  oddsHome: string;
  oddsDraw: string;
  oddsAway: string;
  status: string;
  startsAt: string;
  homeLogo: string;
  awayLogo: string;
  markets: ReturnType<typeof emptyMarkets>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { setAdminPendingFinance } = useApp();
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const loadingRef = useRef(false);
  const mutatingRef = useRef(0);

  const [matchForm, setMatchForm] = useState<MatchFormState>({
    home: "",
    away: "",
    league: "Premier League",
    oddsHome: "1.90",
    oddsDraw: "3.30",
    oddsAway: "3.10",
    status: "upcoming",
    startsAt: "",
    homeLogo: "",
    awayLogo: "",
    markets: emptyMarkets(),
  });
  const [questionForm, setQuestionForm] = useState<QuestionFormState>({
    mode: "binary",
    question: "",
    category: "Sport",
    oddsYes: "1.90",
    oddsNo: "1.80",
    options: defaultQuestionOptions(),
    hours: "72",
  });
  const [balanceForm, setBalanceForm] = useState<Record<number, string>>({});
  const [stakeLimitForm, setStakeLimitForm] = useState<Record<number, string>>({});

  const load = useCallback(
    async (isBackground = false) => {
      if (isBackground && typeof document !== "undefined" && document.hidden) return;
      if (isBackground && (loadingRef.current || mutatingRef.current > 0)) return;
      loadingRef.current = true;
      try {
        const res = await fetch("/api/admin", { cache: "no-store" });
        const data = (await res.json()) as PanelData & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erreur");
        setPanel(data);
        setAdminPendingFinance(
          (data.stats?.pendingWithdrawals ?? 0) + (data.stats?.pendingDeposits ?? 0)
        );
      } catch (e) {
        if (!isBackground) {
          setNotice({
            kind: "err",
            msg: e instanceof Error ? e.message : "Impossible de charger le tableau de bord",
          });
        }
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [setAdminPendingFinance]
  );

  useEffect(() => {
    const initTimer = setTimeout(() => {
      void load(false);
    }, 0);
    const id = setInterval(() => void load(true), POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initTimer);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const act = useCallback(
    async (payload: Record<string, unknown>, key: string, okMsg: string) => {
      mutatingRef.current += 1;
      setBusy((b) => ({ ...b, [key]: true }));
      setNotice(null);
      try {
        const res = await fetch("/api/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "Erreur lors de l'action");
        setNotice({ kind: "ok", msg: okMsg });
        await load(false);
        return true;
      } catch (e) {
        setNotice({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
        return false;
      } finally {
        mutatingRef.current = Math.max(0, mutatingRef.current - 1);
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [load]
  );

  const onAddMatch = useCallback(
    async (e: FormEvent): Promise<boolean> => {
      e.preventDefault();
      const parseOdd = (raw: string) => Number(String(raw).trim().replace(",", "."));
      const builtMarkets = matchForm.markets
        .map((g) => {
          const outcomes = g.outcomes
            .map((o) => ({ ...o, odds: parseOdd(o.odds) || 0 }))
            .filter((o) => o.odds > 1);
          return outcomes.length > 0
            ? { key: g.key, label: g.label, short: g.short, outcomes }
            : null;
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);

      const ok = await act(
        {
          action: "addMatch",
          home: matchForm.home,
          away: matchForm.away,
          league: matchForm.league,
          oddsHome: parseOdd(matchForm.oddsHome),
          oddsDraw: parseOdd(matchForm.oddsDraw),
          oddsAway: parseOdd(matchForm.oddsAway),
          status: matchForm.status,
          startsAt: matchForm.startsAt || undefined,
          homeLogo: matchForm.homeLogo,
          awayLogo: matchForm.awayLogo,
          markets: builtMarkets,
        },
        "add-match",
        "Match réel publié"
      );
      if (ok) {
        setMatchForm({
          home: "",
          away: "",
          league: "Premier League",
          oddsHome: "1.90",
          oddsDraw: "3.30",
          oddsAway: "3.10",
          status: "upcoming",
          startsAt: "",
          homeLogo: "",
          awayLogo: "",
          markets: emptyMarkets(),
        });
      }
      return ok;
    },
    [act, matchForm]
  );

  const onAddQuestion = useCallback(
    async (e: FormEvent): Promise<boolean> => {
      e.preventDefault();
      const isMulti = questionForm.mode === "multi";
      const builtOptions = isMulti
        ? questionForm.options
            .map((o) => ({ label: o.label.trim(), odds: Number(o.odds.replace(",", ".")) }))
            .filter((o) => o.label && o.odds > 1.01)
        : undefined;

      const ok = await act(
        {
          action: "addQuestion",
          mode: questionForm.mode,
          question: questionForm.question,
          category: questionForm.category,
          oddsYes: Number(questionForm.oddsYes.replace(",", ".")),
          oddsNo: Number(questionForm.oddsNo.replace(",", ".")),
          ...(isMulti ? { options: builtOptions } : {}),
          resolvesAt: Number(questionForm.hours),
        },
        "add-q",
        "Pronostic publié"
      );
      if (ok) {
        setQuestionForm({
          mode: questionForm.mode,
          question: "",
          category: "Sport",
          oddsYes: "1.90",
          oddsNo: "1.80",
          options: defaultQuestionOptions(),
          hours: "72",
        });
      }
      return ok;
    },
    [act, questionForm]
  );

  const value: AdminContextValue = {
    panel,
    loading,
    busy,
    notice,
    setNotice,
    load,
    act,
    matchForm,
    setMatchForm,
    questionForm,
    setQuestionForm,
    balanceForm,
    setBalanceForm,
    stakeLimitForm,
    setStakeLimitForm,
    onAddMatch,
    onAddQuestion,
    setAdminPendingFinance,
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin doit être utilisé dans <AdminProvider>");
  return ctx;
}
