"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  BarChart3,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Flag,
  Goal,
  HelpCircle,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Ticket,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { Toggle } from "@/components/toggle";
import { LEAGUES, findLeague } from "@/lib/leagues";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt, initials, teamHue } from "@/lib/format";

type TabKey = "dashboard" | "matches" | "questions" | "users" | "bets" | "deposits";

const POLL_INTERVAL = 5_000;

interface AdminUser {
  id: number;
  name: string;
  email?: string | null;
  balance: number;
  role: string;
}

interface AdminBet {
  id: number;
  kind: "sport" | "prediction";
  matchId: number | null;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  question?: string | null;
  selectionLabel: string;
  odds: number;
  stake: number;
  potentialWin: number;
  status: string;
  closingOdds?: number | null;
  riskFlag?: string | null;
  placedAt: string;
}

interface AdminDeposit {
  id: number;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

interface AdminMatch {
  id: number;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: string | null;
  startsAt: string;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  suspended: boolean;
  source?: string | null;
}

interface AdminQuestionOption {
  key: string;
  label: string;
  odds: number;
}

interface AdminQuestion {
  id: number;
  question: string;
  category: string;
  status: string;
  resolution: string | null;
  oddsYes: number;
  oddsNo: number;
  options?: AdminQuestionOption[] | null;
  volume: number;
  resolvesAt: string;
}

interface QuestionFormState {
  mode: "binary" | "multi";
  question: string;
  category: string;
  oddsYes: string;
  oddsNo: string;
  options: Array<{ label: string; odds: string }>;
  hours: string;
}

const defaultQuestionOptions = () => [
  { label: "", odds: "2.85" },
  { label: "", odds: "3.25" },
  { label: "", odds: "4.50" },
];

interface AdminWithdrawal {
  id: number;
  userId: number;
  userName: string;
  userEmail: string;
  method: string;
  destination: string;
  amount: number;
  status: string;
  note?: string | null;
  createdAt: string;
}

interface PanelData {
  stats: {
    totalUsers: number;
    totalBets: number;
    sportsBets: number;
    predBets: number;
    comboBets?: number;
    deposits: number;
    withdrawalsPaid?: number;
    pendingWithdrawals?: number;
    stake: number;
    payouts: number;
    balance: number;
    liveMatches: number;
    openQuestions: number;
    netRevenue: number;
  };
  users: AdminUser[];
  bets: AdminBet[];
  predictionBets: Array<{
    id: number;
    questionId: number;
    question: string;
    selectionLabel: string;
    odds: number;
    stake: number;
    potentialWin: number;
    status: string;
    placedAt: string;
  }>;
  comboBets?: Array<{
    id: number;
    legs: Array<{ title: string; selectionLabel: string }>;
    totalOdds: number;
    boostPct: number;
    stake: number;
    potentialWin: number;
    status: string;
    placedAt: string;
  }>;
  deposits: AdminDeposit[];
  withdrawals?: AdminWithdrawal[];
  matches: AdminMatch[];
  questions: AdminQuestion[];
}

const TABS: { key: TabKey; label: string; Icon: typeof Trophy }[] = [
  { key: "dashboard", label: "Synthèse", Icon: BarChart3 },
  { key: "matches", label: "Matchs", Icon: Trophy },
  { key: "questions", label: "Pronostics", Icon: HelpCircle },
  { key: "users", label: "Joueurs", Icon: Users },
  { key: "bets", label: "Paris", Icon: Ticket },
  { key: "deposits", label: "Finance", Icon: CircleDollarSign },
];

const MARKET_CATALOG: {
  key: string;
  label: string;
  short: string;
  outcomes: { key: string; label: string; short: string }[];
}[] = [
  {
    key: "result",
    label: "Résultat du match",
    short: "1/N/2",
    outcomes: [
      { key: "home", label: "Victoire du domicile (Domicile)", short: "1" },
      { key: "draw", label: "Match nul", short: "X" },
      { key: "away", label: "Victoire de l'extérieur (Extérieur)", short: "2" },
    ],
  },
  {
    key: "double_chance",
    label: "Double chance",
    short: "1X/12/X2",
    outcomes: [
      { key: "1X", label: "Domicile ou nul (1X)", short: "1X" },
      { key: "12", label: "Domicile ou extérieur (12)", short: "12" },
      { key: "X2", label: "Nul ou extérieur (X2)", short: "X2" },
    ],
  },
  {
    key: "total_ou",
    label: "Total de buts (plus/moins)",
    short: "Plus/Moins",
    outcomes: [
      { key: "ou_1_5_over", label: "Plus de 1,5 buts", short: "+1,5" },
      { key: "ou_1_5_under", label: "Moins de 1,5 buts", short: "-1,5" },
      { key: "ou_2_5_over", label: "Plus de 2,5 buts", short: "+2,5" },
      { key: "ou_2_5_under", label: "Moins de 2,5 buts", short: "-2,5" },
      { key: "ou_3_5_over", label: "Plus de 3,5 buts", short: "+3,5" },
      { key: "ou_3_5_under", label: "Moins de 3,5 buts", short: "-3,5" },
    ],
  },
  {
    key: "btts",
    label: "Les deux équipes marquent",
    short: "BTTS",
    outcomes: [
      { key: "oui", label: "Oui — les deux équipes marquent", short: "Oui" },
      { key: "non", label: "Non — les deux équipes ne marquent pas", short: "Non" },
    ],
  },
  {
    key: "odd_even",
    label: "Total de buts (pair/impair)",
    short: "Pair/Impair",
    outcomes: [
      { key: "pair", label: "Total de buts pair", short: "Pair" },
      { key: "impair", label: "Total de buts impair", short: "Impair" },
    ],
  },
  {
    key: "score_exact",
    label: "Score exact",
    short: "Score exact",
    outcomes: [
      { key: "1_0", label: "Score exact 1-0", short: "1-0" },
      { key: "2_0", label: "Score exact 2-0", short: "2-0" },
      { key: "2_1", label: "Score exact 2-1", short: "2-1" },
      { key: "0_0", label: "Score exact 0-0", short: "0-0" },
      { key: "1_1", label: "Score exact 1-1", short: "1-1" },
      { key: "0_1", label: "Score exact 0-1", short: "0-1" },
      { key: "0_2", label: "Score exact 0-2", short: "0-2" },
      { key: "1_2", label: "Score exact 1-2", short: "1-2" },
    ],
  },
];

const emptyMarkets = () =>
  MARKET_CATALOG.map((m) => ({
    key: m.key,
    label: m.label,
    short: m.short,
    outcomes: m.outcomes.map((o) => ({ key: o.key, label: o.label, short: o.short, odds: "" })),
  }));

export default function AdminPage() {
  const { user } = useApp();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const loadingRef = useRef(false);
  const mutatingRef = useRef(0);

  const [matchForm, setMatchForm] = useState({
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

  const load = useCallback(async (isBackground = false) => {
    if (isBackground && typeof document !== "undefined" && document.hidden) return;
    // Un poll en arrière-plan n'interrompt jamais une action admin ou un chargement en cours
    if (isBackground && (loadingRef.current || mutatingRef.current > 0)) return;
    loadingRef.current = true;
    try {
      const res = await fetch("/api/admin", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setPanel(data);
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
  }, []);

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

  const act = async (
    payload: Record<string, unknown>,
    key: string,
    okMsg: string
  ): Promise<boolean> => {
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
  };

  const onAddMatch = async (e: FormEvent): Promise<boolean> => {
    e.preventDefault();
    const builtMarkets = matchForm.markets
      .map((g) => {
        const outcomes = g.outcomes
          .map((o) => ({ ...o, odds: Number(o.odds) || 0 }))
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
        oddsHome: Number(matchForm.oddsHome),
        oddsDraw: Number(matchForm.oddsDraw),
        oddsAway: Number(matchForm.oddsAway),
        status: matchForm.status,
        startsAt: matchForm.startsAt || undefined,
        homeLogo: matchForm.homeLogo,
        awayLogo: matchForm.awayLogo,
        markets: builtMarkets,
      },
      "add-match",
      "Match créé"
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
  };

  const onAddQuestion = async (e: FormEvent): Promise<boolean> => {
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
  };

  return (
    <div className="px-4 pb-8 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Administration
          </h1>
          <p className="text-[12px] text-mist">Pilotage des matchs, pronostics et joueurs</p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="glass-card flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-ink active:bg-elev"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={2.3} />
          Actualiser
        </button>
      </div>

      {notice && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] font-medium",
            notice.kind === "ok"
              ? "border-win/30 bg-win/10 text-win"
              : "border-betclic-red/30 bg-betclic-red/8 text-betclic-red"
          )}
        >
          {notice.kind === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <X className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">{notice.msg}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-current/70"
            aria-label="Fermer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {user && user.role !== "admin" && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-betclic-red/30 bg-betclic-red/8 px-3.5 py-2.5 text-[12.5px] text-betclic-red">
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          Accès réservé au compte administrateur.
        </div>
      )}

      {/* Onglets collants */}
      <div className="sticky top-[52px] z-30 -mx-4 mt-3 border-b border-edge/70 bg-deep/95 px-4 py-2 backdrop-blur-md">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            const pendingW = key === "deposits" ? (panel?.stats.pendingWithdrawals ?? 0) : 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-display text-[12px] transition-colors",
                  active
                    ? "border-ink bg-ink font-bold text-white"
                    : "border-edge bg-white font-medium text-mist"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                <span>{label}</span>
                {pendingW > 0 && (
                  <span className="ml-0.5 rounded-full bg-betclic-red px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {pendingW}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {loading || !panel ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="shimmer h-[92px] rounded-2xl" />
          <div className="shimmer h-[92px] rounded-2xl" />
          <div className="shimmer h-[180px] rounded-2xl" />
        </div>
      ) : (
        <div className="mt-3">
          {tab === "dashboard" && <Dashboard stats={panel.stats} />}
          {tab === "matches" && (
            <MatchesTab
              matches={panel.matches}
              busy={busy}
              act={act}
              form={matchForm}
              setForm={setMatchForm}
              onAdd={onAddMatch}
            />
          )}
          {tab === "questions" && (
            <QuestionsTab
              questions={panel.questions}
              busy={busy}
              act={act}
              form={questionForm}
              setForm={setQuestionForm}
              onAdd={onAddQuestion}
            />
          )}
          {tab === "users" && (
            <UsersTab
              users={panel.users}
              balanceForm={balanceForm}
              setBalanceForm={setBalanceForm}
              busy={busy}
              act={act}
            />
          )}
          {tab === "bets" && (
            <BetsTab
              bets={panel.bets}
              predBets={panel.predictionBets}
              comboBets={panel.comboBets ?? []}
            />
          )}
          {tab === "deposits" && (
            <DepositsTab
              deposits={panel.deposits}
              withdrawals={panel.withdrawals ?? []}
              busy={busy}
              act={act}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

function Dashboard({ stats }: { stats: PanelData["stats"] }) {
  const revenue = stats.stake - stats.payouts;
  const cards: { label: string; value: string; Icon: typeof Trophy; accent?: boolean }[] = [
    { label: "Joueurs", value: String(stats.totalUsers), Icon: Users },
    { label: "Matchs live", value: String(stats.liveMatches), Icon: Trophy, accent: stats.liveMatches > 0 },
    { label: "Pronostics ouverts", value: String(stats.openQuestions), Icon: HelpCircle },
    { label: "Tickets totaux", value: String(stats.totalBets), Icon: Ticket },
    { label: "Volume misé", value: eur(stats.stake), Icon: CircleDollarSign },
    { label: "Gains versés", value: eur(stats.payouts), Icon: TrendingUp },
  ];

  return (
    <div className="flex flex-col gap-3">
      <section className="glass-card rounded-2xl p-4">
        <p className="text-[11px] font-medium text-dim">Marge brute globale (mises − gains)</p>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <p className="font-display text-[26px] font-bold leading-none tabular-nums text-ink">
            {eur(revenue)}
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-display text-[11px] font-bold",
              revenue >= 0 ? "bg-win/12 text-win" : "bg-betclic-red/10 text-betclic-red"
            )}
          >
            {revenue >= 0 ? "+" : ""}
            {revenue.toFixed(0)} €
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="glass-card rounded-2xl p-3.5">
            <c.Icon
              className={cn("h-4 w-4", c.accent ? "text-betclic-red" : "text-dim")}
              strokeWidth={2.1}
            />
            <p className="mt-2 font-display text-[17px] font-bold tabular-nums text-ink">
              {c.value}
            </p>
            <p className="text-[11px] font-medium text-dim">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatPill label="Sport" value={stats.sportsBets} />
        <StatPill label="Pronostics" value={stats.predBets} />
        <StatPill label="Dépôts" value={stats.deposits} />
      </div>
    </div>
  );
}

/* ---------------- Matchs ---------------- */

interface MatchFormState {
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
  markets: Array<{
    key: string;
    label: string;
    short: string;
    outcomes: Array<{ key: string; label: string; short: string; odds: string }>;
  }>;
}

function MatchesTab({
  matches,
  busy,
  act,
  form,
  setForm,
  onAdd,
}: {
  matches: AdminMatch[];
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
  form: MatchFormState;
  setForm: (f: MatchFormState) => void;
  onAdd: (e: FormEvent) => Promise<boolean>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [openLogos, setOpenLogos] = useState(false);
  const [openMarkets, setOpenMarkets] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "upcoming" | "finished">("all");

  const activeLeague = findLeague(form.league);
  const clubOptions = (activeLeague?.clubs ?? []).map((c) => c.name);
  const activeMarkets = form.markets.filter((g) => g.outcomes.some((o) => Number(o.odds) > 1));

  const filteredMatches =
    statusFilter === "all"
      ? matches
      : matches.filter((m) => m.status === statusFilter);

  return (
    <div className="flex flex-col gap-3">
      {/* Tiroir repliable pour ne pas encombrer l'écran mobile */}
      <div className="glass-card overflow-hidden rounded-2xl">
        <button
          type="button"
          onClick={() => setFormOpen((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <span className="flex items-center gap-2 font-display text-[13.5px] font-bold text-ink">
            <Plus className="h-4 w-4 text-betclic-red" strokeWidth={2.5} />
            Ajouter un match
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-dim transition-transform", formOpen && "rotate-180")}
            strokeWidth={2.2}
          />
        </button>

        {formOpen && (
          <form
            onSubmit={async (e) => {
              const ok = await onAdd(e);
              if (ok) setFormOpen(false);
            }}
            className="border-t border-edge p-3.5"
          >
            <ComboBox
              label="Championnat"
              placeholder="Choisir une ligue…"
              value={form.league}
              onChange={(v) => {
                if (findLeague(v)) {
                  setForm({ ...form, league: v, home: "", away: "", homeLogo: "", awayLogo: "" });
                } else {
                  setForm({ ...form, league: v });
                }
              }}
              options={LEAGUES.map((l) => ({ label: l.name, hint: l.country }))}
            />

            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ComboBox
                label="Domicile"
                placeholder="Équipe domicile"
                value={form.home}
                onChange={(v, logo) =>
                  setForm({
                    ...form,
                    home: v,
                    homeLogo: typeof logo === "string" && logo !== "" ? logo : form.homeLogo,
                  })
                }
                options={clubOptions
                  .filter((name) => name !== form.away)
                  .map((name) => ({
                    label: name,
                    logo: activeLeague
                      ? (activeLeague.clubs.find((c) => c.name === name)?.logo ?? null)
                      : null,
                  }))}
              />
              <ComboBox
                label="Extérieur"
                placeholder="Équipe extérieure"
                value={form.away}
                onChange={(v, logo) =>
                  setForm({
                    ...form,
                    away: v,
                    awayLogo: typeof logo === "string" && logo !== "" ? logo : form.awayLogo,
                  })
                }
                options={clubOptions
                  .filter((name) => name !== form.home)
                  .map((name) => ({
                    label: name,
                    logo: activeLeague
                      ? (activeLeague.clubs.find((c) => c.name === name)?.logo ?? null)
                      : null,
                  }))}
              />
            </div>

            <div className="mt-2.5 grid grid-cols-1 gap-2">
              <AdminInput
                label="Coup d'envoi"
                type="datetime-local"
                value={form.startsAt}
                onChange={(v) => setForm({ ...form, startsAt: v })}
              />
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-mist">Statut initial</span>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-edge bg-elev p-1">
                  {[
                    { v: "upcoming", label: "À venir" },
                    { v: "live", label: "En direct" },
                  ].map(({ v, label }) => {
                    const active = form.status === v;
                    return (
                      <button
                        type="button"
                        key={v}
                        onClick={() => setForm({ ...form, status: v })}
                        className={cn(
                          "h-9 rounded-lg font-display text-[12px] transition-colors",
                          active ? "bg-ink font-bold text-white" : "font-medium text-mist"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <AdminInput
                label="Cote 1"
                value={form.oddsHome}
                onChange={(v) => setForm({ ...form, oddsHome: v })}
              />
              <AdminInput
                label="Cote N"
                value={form.oddsDraw}
                onChange={(v) => setForm({ ...form, oddsDraw: v })}
              />
              <AdminInput
                label="Cote 2"
                value={form.oddsAway}
                onChange={(v) => setForm({ ...form, oddsAway: v })}
              />
            </div>

            {/* Logos optionnels */}
            <div className="mt-2.5 overflow-hidden rounded-xl border border-edge bg-elev/40">
              <button
                type="button"
                onClick={() => setOpenLogos((s) => !s)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[11.5px] font-semibold text-mist"
              >
                <span>Logos personnalisés (optionnel)</span>
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", openLogos && "rotate-180")}
                />
              </button>
              {openLogos && (
                <div className="grid grid-cols-1 gap-2 border-t border-edge p-2.5">
                  <AdminInput
                    label="URL logo domicile"
                    placeholder="https://…"
                    value={form.homeLogo}
                    onChange={(v) => setForm({ ...form, homeLogo: v })}
                  />
                  <AdminInput
                    label="URL logo extérieur"
                    placeholder="https://…"
                    value={form.awayLogo}
                    onChange={(v) => setForm({ ...form, awayLogo: v })}
                  />
                </div>
              )}
            </div>

            {/* Marchés optionnels */}
            <div className="mt-2 overflow-hidden rounded-xl border border-edge bg-elev/40">
              <button
                type="button"
                onClick={() => setOpenMarkets((s) => !s)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[11.5px] font-semibold text-mist"
              >
                <span>
                  Marchés libres{" "}
                  {activeMarkets.length > 0 && `(${activeMarkets.length} actifs)`}
                </span>
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", openMarkets && "rotate-180")}
                />
              </button>
              {openMarkets && (
                <div className="flex flex-col gap-2 border-t border-edge p-2.5">
                  {form.markets.map((g, gi) => (
                    <div key={g.key} className="rounded-xl border border-edge bg-white p-2.5">
                      <p className="text-[11.5px] font-semibold text-ink">{g.label}</p>
                      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                        {g.outcomes.map((o, oi) => (
                          <input
                            key={o.key}
                            type="text"
                            inputMode="decimal"
                            placeholder={o.short}
                            value={o.odds}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                markets: form.markets.map((mg, mgi) =>
                                  mgi === gi
                                    ? {
                                        ...mg,
                                        outcomes: mg.outcomes.map((mo, moi) =>
                                          moi === oi ? { ...mo, odds: e.target.value } : mo
                                        ),
                                      }
                                    : mg
                                ),
                              })
                            }
                            className="h-10 w-full rounded-lg border border-edge bg-elev/60 px-2 text-center text-[16px] font-semibold tabular-nums text-ink outline-none focus:border-ink"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!form.home || !form.away || busy["add-match"]}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-betclic-red font-display text-[13.5px] font-bold text-white disabled:opacity-55"
            >
              {busy["add-match"] ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" strokeWidth={2.2} />
              )}
              Publier le match
            </button>
          </form>
        )}
      </div>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {(
          [
            { key: "all", label: `Tous (${matches.length})` },
            { key: "live", label: `En direct (${matches.filter((m) => m.status === "live").length})` },
            { key: "upcoming", label: `À venir (${matches.filter((m) => m.status === "upcoming").length})` },
            { key: "finished", label: `Terminés (${matches.filter((m) => m.status === "finished").length})` },
          ] as const
        ).map(({ key, label }) => {
          const active = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                "h-8 shrink-0 rounded-full border px-3 font-display text-[11.5px] transition-colors",
                active
                  ? "border-betclic-red bg-betclic-red font-bold text-white"
                  : "border-edge bg-white font-medium text-mist"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <AdminSectionTitle label="Matchs programmés" count={filteredMatches.length} />
      <div className="flex flex-col gap-2.5">
        {filteredMatches.map((m) => (
          <AdminMatchCard key={m.id} m={m} busy={busy} act={act} />
        ))}
      </div>
    </div>
  );
}

function AdminMatchCard({
  m,
  busy,
  act,
}: {
  m: AdminMatch;
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
}) {
  const isManual = m.source === "manual";
  const [editingOdds, setEditingOdds] = useState(false);
  const [o1, setO1] = useState(String(m.oddsHome));
  const [oN, setON] = useState(String(m.oddsDraw ?? 3.2));
  const [o2, setO2] = useState(String(m.oddsAway));

  return (
    <div className={cn("glass-card rounded-2xl p-3.5", m.suspended && "opacity-70")}>
      <div className="flex items-center gap-2.5">
        <div className="flex shrink-0 -space-x-2">
          <LogoOrAvatar logo={m.homeLogo} name={m.homeTeam} />
          <LogoOrAvatar logo={m.awayLogo} name={m.awayTeam} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-display text-[13.5px] font-bold text-ink">
              {m.homeTeam} – {m.awayTeam}
            </p>
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase",
                isManual ? "bg-ink text-white" : "bg-elev text-mist"
              )}
            >
              {isManual ? "Manuel" : "Virtuel 2-3m"}
            </span>
          </div>
          <p className="truncate text-[11.5px] text-mist">
            {m.league} ·{" "}
            {m.status === "live"
              ? `Direct ${m.minute ?? ""}`
              : m.status === "finished"
                ? "Terminé"
                : formatKickoff(new Date(m.startsAt))}
            {m.homeScore != null && ` · ${m.homeScore}-${m.awayScore}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Toggle
            checked={!m.suspended}
            onChange={(v) =>
              act(
                { action: "toggleMatch", matchId: m.id, suspended: !v },
                `tg-${m.id}`,
                v ? "Match réactivé" : "Match suspendu"
              )
            }
          />
          <button
            type="button"
            disabled={busy[`del-${m.id}`]}
            onClick={() => act({ action: "deleteMatch", matchId: m.id }, `del-${m.id}`, "Match supprimé")}
            className="grid h-9 w-9 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red active:scale-95 disabled:opacity-50"
            aria-label="Supprimer"
          >
            {busy[`del-${m.id}`] ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" strokeWidth={2.1} />
            )}
          </button>
        </div>
      </div>

      {/* Cotes 1/N/2 actuelles + édition rapide */}
      {m.status !== "finished" && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-dim">
          <span>
            1: <strong className="text-ink">{formatOdds(m.oddsHome)}</strong> · N:{" "}
            <strong className="text-ink">{formatOdds(m.oddsDraw ?? 3.2)}</strong> · 2:{" "}
            <strong className="text-ink">{formatOdds(m.oddsAway)}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setO1(String(m.oddsHome));
              setON(String(m.oddsDraw ?? 3.2));
              setO2(String(m.oddsAway));
              setEditingOdds((s) => !s);
            }}
            className="rounded-md bg-elev px-2 py-0.5 font-display text-[10.5px] font-semibold text-ink"
          >
            {editingOdds ? "Fermer" : "Éditer cotes"}
          </button>
        </div>
      )}

      {editingOdds && m.status !== "finished" && (
        <div className="mt-2 flex items-center gap-1.5 rounded-xl border border-edge bg-elev/50 p-2">
          <input
            type="text"
            inputMode="decimal"
            value={o1}
            onChange={(e) => setO1(e.target.value)}
            placeholder="1"
            className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-white px-2 text-center font-display text-[14px] font-bold text-ink"
          />
          <input
            type="text"
            inputMode="decimal"
            value={oN}
            onChange={(e) => setON(e.target.value)}
            placeholder="N"
            className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-white px-2 text-center font-display text-[14px] font-bold text-ink"
          />
          <input
            type="text"
            inputMode="decimal"
            value={o2}
            onChange={(e) => setO2(e.target.value)}
            placeholder="2"
            className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-white px-2 text-center font-display text-[14px] font-bold text-ink"
          />
          <button
            type="button"
            disabled={busy[`eo-${m.id}`]}
            onClick={async () => {
              const ok = await act(
                {
                  action: "editMatch",
                  matchId: m.id,
                  oddsHome: o1,
                  oddsDraw: oN,
                  oddsAway: o2,
                },
                `eo-${m.id}`,
                "Cotes du match mises à jour"
              );
              if (ok) setEditingOdds(false);
            }}
            className="h-9 shrink-0 rounded-lg bg-betclic-red px-3 font-display text-[11.5px] font-bold text-white disabled:opacity-50"
          >
            OK
          </button>
        </div>
      )}

      <MatchControls m={m} busy={busy} act={act} />
    </div>
  );
}

function MatchControls({
  m,
  busy,
  act,
}: {
  m: AdminMatch;
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
}) {
  const [homeEdit, setHomeEdit] = useState<{ base: number | null; val: string } | null>(null);
  const [awayEdit, setAwayEdit] = useState<{ base: number | null; val: string } | null>(null);
  const [mp, setMp] = useState("");

  const home = homeEdit && homeEdit.base === m.homeScore ? homeEdit.val : String(m.homeScore ?? 0);
  const away = awayEdit && awayEdit.base === m.awayScore ? awayEdit.val : String(m.awayScore ?? 0);
  const setHome = (v: string) => setHomeEdit({ base: m.homeScore, val: v });
  const setAway = (v: string) => setAwayEdit({ base: m.awayScore, val: v });

  if (m.status === "upcoming") {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-edge pt-2.5">
        <span className="text-[11px] text-dim">Démarrage auto à l&apos;heure prévue</span>
        <button
          type="button"
          onClick={() =>
            act({ action: "startMatch", matchId: m.id }, `start-${m.id}`, "Match passé en direct")
          }
          disabled={busy[`start-${m.id}`]}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-betclic-red px-3 font-display text-[11.5px] font-bold text-white disabled:opacity-60"
        >
          {busy[`start-${m.id}`] ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
          Lancer en direct
        </button>
      </div>
    );
  }

  if (m.status === "finished") {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-edge pt-2.5">
        <span className="text-[11.5px] text-mist">
          Score final : <strong>{m.homeScore}–{m.awayScore}</strong>
        </span>
        <button
          type="button"
          onClick={() =>
            act({ action: "reopenMatch", matchId: m.id }, `reopen-${m.id}`, "Match rouvert")
          }
          disabled={busy[`reopen-${m.id}`]}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-elev px-3 font-display text-[11.5px] font-semibold text-ink disabled:opacity-60"
        >
          {busy[`reopen-${m.id}`] ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
          )}
          Rouvrir
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-elev/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            act({ action: "markGoal", matchId: m.id, team: "home" }, `gh-${m.id}`, "But domicile")
          }
          disabled={busy[`gh-${m.id}`]}
          className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-win/30 bg-white text-[11.5px] font-bold text-win active:scale-95 disabled:opacity-60"
        >
          {busy[`gh-${m.id}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Goal className="h-3.5 w-3.5" />}
          +1 Dom.
        </button>

        <div className="flex items-center gap-1">
          <input
            inputMode="numeric"
            value={home}
            onChange={(e) => setHome(e.target.value.replace(/[^\d]/g, ""))}
            className="h-9 w-10 rounded-lg border border-edge bg-white text-center font-display text-[16px] font-bold text-ink outline-none focus:border-ink"
          />
          <span className="text-dim">–</span>
          <input
            inputMode="numeric"
            value={away}
            onChange={(e) => setAway(e.target.value.replace(/[^\d]/g, ""))}
            className="h-9 w-10 rounded-lg border border-edge bg-white text-center font-display text-[16px] font-bold text-ink outline-none focus:border-ink"
          />
        </div>

        <button
          type="button"
          onClick={() =>
            act({ action: "markGoal", matchId: m.id, team: "away" }, `ga-${m.id}`, "But extérieur")
          }
          disabled={busy[`ga-${m.id}`]}
          className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-win/30 bg-white text-[11.5px] font-bold text-win active:scale-95 disabled:opacity-60"
        >
          {busy[`ga-${m.id}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Goal className="h-3.5 w-3.5" />}
          +1 Ext.
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-mist">Min.</span>
          <input
            inputMode="numeric"
            value={mp}
            onChange={(e) => setMp(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={m.minute ?? "45"}
            className="h-8 w-14 rounded-lg border border-edge bg-white px-2 text-center text-[16px] font-semibold text-ink outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={() =>
              act(
                { action: "setMinute", matchId: m.id, minute: `${mp || "0"}'` },
                `min-${m.id}`,
                `Minute ${mp}' enregistrée`
              )
            }
            disabled={busy[`min-${m.id}`] || !mp}
            className="h-8 rounded-lg bg-white px-2.5 text-[11.5px] font-bold text-ink border border-edge disabled:opacity-50"
          >
            OK
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            act(
              {
                action: "finishMatch",
                matchId: m.id,
                homeScore: Number(home) || 0,
                awayScore: Number(away) || 0,
              },
              `fin-${m.id}`,
              "Match terminé et paris réglés"
            )
          }
          disabled={busy[`fin-${m.id}`]}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-betclic-red px-3 font-display text-[11.5px] font-bold text-white disabled:opacity-60"
        >
          {busy[`fin-${m.id}`] ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Flag className="h-3.5 w-3.5" strokeWidth={2.2} />
          )}
          Terminer
        </button>
      </div>
    </div>
  );
}

/* ---------------- Pronostics ---------------- */

function QuestionsTab({
  questions,
  busy,
  act,
  form,
  setForm,
  onAdd,
}: {
  questions: AdminQuestion[];
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
  form: QuestionFormState;
  setForm: (f: QuestionFormState) => void;
  onAdd: (e: FormEvent) => Promise<boolean>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    question: string;
    category: string;
    oddsYes: string;
    oddsNo: string;
    options: Array<{ key?: string; label: string; odds: string }> | null;
  }>({
    question: "",
    category: "Sport",
    oddsYes: "1.90",
    oddsNo: "1.80",
    options: null,
  });

  const startEdit = (q: AdminQuestion) => {
    setEditingId(q.id);
    const hasMulti = Array.isArray(q.options) && q.options.length >= 2;
    setEditForm({
      question: q.question,
      category: q.category,
      oddsYes: String(q.oddsYes),
      oddsNo: String(q.oddsNo),
      options: hasMulti && q.options
        ? q.options.map((o) => ({ key: o.key, label: o.label, odds: String(o.odds) }))
        : null,
    });
  };

  const saveEdit = async (id: number) => {
    const ok = await act(
      {
        action: "editQuestion",
        questionId: id,
        question: editForm.question,
        category: editForm.category,
        oddsYes: Number(editForm.oddsYes.replace(",", ".")),
        oddsNo: Number(editForm.oddsNo.replace(",", ".")),
        ...(editForm.options
          ? {
              options: editForm.options.map((o) => ({
                ...(o.key ? { key: o.key } : {}),
                label: o.label.trim(),
                odds: Number(o.odds.replace(",", ".")),
              })),
            }
          : {}),
      },
      `edit-q-${id}`,
      "Question mise à jour"
    );
    if (ok) setEditingId(null);
  };

  const [qFilter, setQFilter] = useState<"all" | "open" | "resolved">("all");
  const multiPlaceholders = ["Lamine Yamal", "Kylian Mbappé", "Harry Kane", "Vinícius Jr."];
  const visibleQuestions =
    qFilter === "all" ? questions : questions.filter((q) => q.status === qFilter);

  return (
    <div className="flex flex-col gap-3">
      <div className="glass-card overflow-hidden rounded-2xl">
        <button
          type="button"
          onClick={() => setFormOpen((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <span className="flex items-center gap-2 font-display text-[13.5px] font-bold text-ink">
            <Plus className="h-4 w-4 text-betclic-red" strokeWidth={2.5} />
            Nouvelle question (Oui / Non ou Choix multiples)
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-dim transition-transform", formOpen && "rotate-180")}
            strokeWidth={2.2}
          />
        </button>

        {formOpen && (
          <form
            onSubmit={async (e) => {
              const ok = await onAdd(e);
              if (ok) setFormOpen(false);
            }}
            className="border-t border-edge p-3.5"
          >
            {/* Format : Oui / Non vs Choix multiples */}
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-edge bg-elev/60 p-1">
              {(
                [
                  { key: "binary", label: "Oui / Non" },
                  { key: "multi", label: "Choix multiples" },
                ] as const
              ).map((m) => {
                const active = form.mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setForm({ ...form, mode: m.key })}
                    className={cn(
                      "h-8 rounded-lg font-display text-[12px] transition-colors",
                      active ? "bg-ink font-bold text-white" : "font-semibold text-mist"
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            <AdminInput
              label="Intitulé de la question"
              value={form.question}
              onChange={(v) => setForm({ ...form, question: v })}
              placeholder={
                form.mode === "multi"
                  ? "Ex. Qui va remporter le Ballon d'Or 2026 ?"
                  : "Ex. Le PSG gagnera-t-il ce soir ?"
              }
            />

            {form.mode === "binary" ? (
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-mist">Catégorie</span>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    aria-label="Catégorie"
                    className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[16px] font-medium text-ink outline-none focus:border-ink"
                  >
                    <option value="Sport">Sport</option>
                    <option value="Actus">Actus</option>
                    <option value="Crypto">Crypto</option>
                    <option value="Culture">Culture</option>
                  </select>
                </label>
                <AdminInput
                  label="Cote Oui"
                  value={form.oddsYes}
                  onChange={(v) => setForm({ ...form, oddsYes: v })}
                />
                <AdminInput
                  label="Cote Non"
                  value={form.oddsNo}
                  onChange={(v) => setForm({ ...form, oddsNo: v })}
                />
              </div>
            ) : (
              <>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-mist">Catégorie</span>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      aria-label="Catégorie"
                      className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[16px] font-medium text-ink outline-none focus:border-ink"
                    >
                      <option value="Sport">Sport</option>
                      <option value="Actus">Actus</option>
                      <option value="Crypto">Crypto</option>
                      <option value="Culture">Culture</option>
                    </select>
                  </label>
                  <AdminInput
                    label="Échéance (heures)"
                    value={form.hours}
                    onChange={(v) => setForm({ ...form, hours: v })}
                  />
                </div>

                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-mist">
                      Choix & cotes fixes ({form.options.length})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          options: [...form.options, { label: "", odds: "5.00" }],
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-elev px-2 py-1 font-display text-[11px] font-bold text-betclic-red"
                    >
                      <Plus className="h-3 w-3" strokeWidth={2.5} />
                      Ajouter un choix
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {form.options.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => {
                            const next = [...form.options];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setForm({ ...form, options: next });
                          }}
                          placeholder={multiPlaceholders[idx] ?? `Choix #${idx + 1}`}
                          className="h-10 min-w-0 flex-1 rounded-xl border border-edge bg-elev/60 px-3 text-[15px] font-medium text-ink outline-none focus:border-ink"
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          value={opt.odds}
                          onChange={(e) => {
                            const next = [...form.options];
                            next[idx] = { ...next[idx], odds: e.target.value };
                            setForm({ ...form, options: next });
                          }}
                          placeholder="Cote"
                          className="h-10 w-20 shrink-0 rounded-xl border border-edge bg-elev/60 px-2.5 text-center font-display text-[15px] font-bold tabular-nums text-ink outline-none focus:border-ink"
                        />
                        {form.options.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                options: form.options.filter((_, i) => i !== idx),
                              })
                            }
                            aria-label="Retirer ce choix"
                            className="grid h-10 w-9 shrink-0 place-items-center rounded-xl bg-elev text-mist active:bg-edge"
                          >
                            <X className="h-4 w-4" strokeWidth={2.2} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {form.mode === "binary" && (
              <AdminInput
                label="Échéance (heures)"
                value={form.hours}
                className="mt-2.5"
                onChange={(v) => setForm({ ...form, hours: v })}
              />
            )}

            <button
              type="submit"
              disabled={!form.question || busy["add-q"]}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-betclic-red font-display text-[13.5px] font-bold text-white disabled:opacity-55"
            >
              {busy["add-q"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Publier
            </button>
          </form>
        )}
      </div>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {(
          [
            { key: "all", label: `Toutes (${questions.length})` },
            { key: "open", label: `Ouvertes (${questions.filter((q) => q.status === "open").length})` },
            { key: "resolved", label: `Résolues (${questions.filter((q) => q.status === "resolved").length})` },
          ] as const
        ).map(({ key, label }) => {
          const active = qFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setQFilter(key)}
              className={cn(
                "h-8 shrink-0 rounded-full border px-3 font-display text-[11.5px] transition-colors",
                active
                  ? "border-betclic-red bg-betclic-red font-bold text-white"
                  : "border-edge bg-white font-medium text-mist"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <AdminSectionTitle label="Questions" count={visibleQuestions.length} />
      <div className="flex flex-col gap-2.5">
        {visibleQuestions.map((q) => {
          const isEditing = editingId === q.id;
          const isMulti = Array.isArray(q.options) && q.options.length >= 2;
          const resolvedLabel =
            q.status === "open"
              ? "Ouverte"
              : isMulti && q.options
                ? `Résolue · ${q.options.find((o) => o.key === q.resolution)?.label ?? q.resolution}`
                : `Résolue · ${q.resolution === "yes" ? "Oui" : "Non"}`;

          return (
            <div key={q.id} className="glass-card rounded-2xl p-3.5">
              {isEditing ? (
                <div className="flex flex-col gap-2.5">
                  <AdminInput
                    label="Question"
                    value={editForm.question}
                    onChange={(v) => setEditForm({ ...editForm, question: v })}
                  />
                  {editForm.options ? (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-mist">Catégorie</span>
                        <select
                          value={editForm.category}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          aria-label="Catégorie"
                          className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[16px] font-medium text-ink"
                        >
                          <option value="Sport">Sport</option>
                          <option value="Actus">Actus</option>
                          <option value="Crypto">Crypto</option>
                          <option value="Culture">Culture</option>
                        </select>
                      </label>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-mist">Choix & cotes</span>
                          <button
                            type="button"
                            onClick={() =>
                              setEditForm({
                                ...editForm,
                                options: [...(editForm.options ?? []), { label: "", odds: "4.00" }],
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-elev px-2 py-0.5 font-display text-[11px] font-bold text-betclic-red"
                          >
                            <Plus className="h-3 w-3" /> Ajouter
                          </button>
                        </div>
                        {editForm.options.map((opt, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={opt.label}
                              onChange={(e) => {
                                const next = [...(editForm.options ?? [])];
                                next[idx] = { ...next[idx], label: e.target.value };
                                setEditForm({ ...editForm, options: next });
                              }}
                              placeholder={`Choix #${idx + 1}`}
                              className="h-9 min-w-0 flex-1 rounded-xl border border-edge bg-elev/60 px-2.5 text-[14px] font-medium text-ink"
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              value={opt.odds}
                              onChange={(e) => {
                                const next = [...(editForm.options ?? [])];
                                next[idx] = { ...next[idx], odds: e.target.value };
                                setEditForm({ ...editForm, options: next });
                              }}
                              className="h-9 w-20 shrink-0 rounded-xl border border-edge bg-elev/60 px-2 text-center font-display text-[14px] font-bold tabular-nums text-ink"
                            />
                            {editForm.options && editForm.options.length > 2 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditForm({
                                    ...editForm,
                                    options: (editForm.options ?? []).filter((_, i) => i !== idx),
                                  })
                                }
                                className="grid h-9 w-8 shrink-0 place-items-center rounded-xl bg-elev text-mist"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-mist">Catégorie</span>
                        <select
                          value={editForm.category}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          aria-label="Catégorie"
                          className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[16px] font-medium text-ink"
                        >
                          <option value="Sport">Sport</option>
                          <option value="Actus">Actus</option>
                          <option value="Crypto">Crypto</option>
                          <option value="Culture">Culture</option>
                        </select>
                      </label>
                      <AdminInput
                        label="Oui"
                        value={editForm.oddsYes}
                        onChange={(v) => setEditForm({ ...editForm, oddsYes: v })}
                      />
                      <AdminInput
                        label="Non"
                        value={editForm.oddsNo}
                        onChange={(v) => setEditForm({ ...editForm, oddsYes: editForm.oddsYes, oddsNo: v })}
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(q.id)}
                      disabled={busy[`edit-q-${q.id}`]}
                      className="h-9 flex-1 rounded-xl bg-betclic-red font-display text-[12px] font-bold text-white"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="h-9 rounded-xl bg-elev px-4 font-display text-[12px] font-semibold text-mist"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-[13.5px] font-semibold leading-snug text-ink">
                      {q.question}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 font-display text-[10px] font-bold",
                        q.status === "open"
                          ? "bg-betclic-red/10 text-betclic-red"
                          : "bg-elev text-mist"
                      )}
                    >
                      {resolvedLabel}
                    </span>
                  </div>

                  {isMulti && q.options ? (
                    <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
                      {q.category} · {q.options.map((o) => `${o.label} (${formatOdds(o.odds)})`).join(" · ")} · Mises {eur(q.volume)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11.5px] text-dim">
                      {q.category} · Oui {formatOdds(q.oddsYes)} · Non {formatOdds(q.oddsNo)} · Mises{" "}
                      {eur(q.volume)}
                    </p>
                  )}

                  {q.status === "open" && isMulti && q.options && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {q.options.map((opt) => {
                        const bKey = `ro-${q.id}-${opt.key}`;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            disabled={busy[bKey]}
                            onClick={() =>
                              act(
                                { action: "resolveQuestion", questionId: q.id, resolution: opt.key },
                                bKey,
                                `Résolue : ${opt.label}`
                              )
                            }
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-win/12 px-2.5 font-display text-[11px] font-bold text-win active:opacity-80 disabled:opacity-50"
                          >
                            {busy[bKey] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              `✓ ${opt.label}`
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center gap-1.5">
                    {q.status === "open" ? (
                      !isMulti && (
                        <>
                          <button
                            type="button"
                            disabled={busy[`ry-${q.id}`] || busy[`rn-${q.id}`]}
                            onClick={() =>
                              act(
                                { action: "resolveQuestion", questionId: q.id, resolution: "yes" },
                                `ry-${q.id}`,
                                "Résolue : Oui"
                              )
                            }
                            className="h-8 flex-1 rounded-lg bg-win/12 font-display text-[11.5px] font-bold text-win disabled:opacity-50"
                          >
                            {busy[`ry-${q.id}`] ? "..." : "Oui gagne"}
                          </button>
                          <button
                            type="button"
                            disabled={busy[`ry-${q.id}`] || busy[`rn-${q.id}`]}
                            onClick={() =>
                              act(
                                { action: "resolveQuestion", questionId: q.id, resolution: "no" },
                                `rn-${q.id}`,
                                "Résolue : Non"
                              )
                            }
                            className="h-8 flex-1 rounded-lg bg-betclic-red/10 font-display text-[11.5px] font-bold text-betclic-red disabled:opacity-50"
                          >
                            {busy[`rn-${q.id}`] ? "..." : "Non gagne"}
                          </button>
                        </>
                      )
                    ) : (
                      <button
                        type="button"
                        disabled={busy[`reopen-${q.id}`]}
                        onClick={() =>
                          act(
                            { action: "reopenQuestion", questionId: q.id },
                            `reopen-${q.id}`,
                            "Question réouverte et paris restaurés"
                          )
                        }
                        className="h-8 flex-1 rounded-lg bg-sky-500/12 font-display text-[11.5px] font-bold text-sky-700 disabled:opacity-50"
                      >
                        {busy[`reopen-${q.id}`] ? "..." : "Réouvrir"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(q)}
                      className={cn(
                        "h-8 rounded-lg bg-elev px-3 font-display text-[11.5px] font-semibold text-ink",
                        q.status === "open" && isMulti && "flex-1"
                      )}
                    >
                      Éditer
                    </button>
                    <button
                      type="button"
                      disabled={busy[`dq-${q.id}`]}
                      onClick={() =>
                        act(
                          { action: "deleteQuestion", questionId: q.id },
                          `dq-${q.id}`,
                          "Question supprimée"
                        )
                      }
                      className="grid h-8 w-8 place-items-center rounded-lg bg-elev text-mist disabled:opacity-50"
                      aria-label="Supprimer"
                    >
                      {busy[`dq-${q.id}`] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.1} />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Joueurs ---------------- */

function UsersTab({
  users,
  balanceForm,
  setBalanceForm,
  busy,
  act,
}: {
  users: AdminUser[];
  balanceForm: Record<number, string>;
  setBalanceForm: (f: Record<number, string>) => void;
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <AdminSectionTitle label="Comptes enregistrés" count={users.length} />
      {users.map((u) => (
        <div key={u.id} className="glass-card rounded-2xl p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev font-display text-[12px] font-bold text-ink">
                {initials(u.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-[13.5px] font-bold text-ink">
                  {u.name}
                  {u.role === "admin" && (
                    <ShieldCheck
                      className="ml-1 inline h-3.5 w-3.5 text-betclic-red"
                      strokeWidth={2.2}
                    />
                  )}
                </p>
                <p className="truncate text-[11.5px] text-dim">{u.email ?? "—"}</p>
              </div>
            </div>
            <p className="shrink-0 font-display text-[15px] font-bold tabular-nums text-ink">
              {eur(u.balance)}
            </p>
          </div>
          <div className="mt-2.5 flex gap-2">
            <AdminInput
              placeholder="Nouveau solde (€)"
              type="text"
              inputMode="decimal"
              className="flex-1"
              value={balanceForm[u.id] ?? ""}
              onChange={(v) => setBalanceForm({ ...balanceForm, [u.id]: v })}
            />
            <button
              type="button"
              onClick={() => {
                const amt = parseFloat((balanceForm[u.id] ?? "").replace(",", "."));
                if (Number.isFinite(amt)) {
                  act(
                    { action: "setBalance", userId: u.id, amount: amt },
                    `bal-${u.id}`,
                    "Solde mis à jour"
                  );
                  setBalanceForm({ ...balanceForm, [u.id]: "" });
                }
              }}
              disabled={busy[`bal-${u.id}`] || !balanceForm[u.id]}
              className="h-11 shrink-0 rounded-xl bg-ink px-4 font-display text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {busy[`bal-${u.id}`] ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fixer"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Paris ---------------- */

function BetsTab({
  bets,
  predBets,
  comboBets,
}: {
  bets: AdminBet[];
  predBets: PanelData["predictionBets"];
  comboBets: NonNullable<PanelData["comboBets"]>;
}) {
  const rows = [
    ...bets.map((b) => ({
      id: b.id,
      kind: "Sport",
      label: `${b.homeTeam} – ${b.awayTeam}`,
      detail: b.selectionLabel,
      stake: b.stake,
      win: b.potentialWin,
      status: b.status,
      riskFlag: b.riskFlag ?? null,
      clv: b.closingOdds != null && b.closingOdds > 0 ? b.odds / b.closingOdds - 1 : null,
      placedAt: b.placedAt,
    })),
    ...predBets.map((p) => ({
      id: p.id,
      kind: "Préd.",
      label: p.question,
      detail: p.selectionLabel,
      stake: p.stake,
      win: p.potentialWin,
      status: p.status,
      riskFlag: null,
      clv: null,
      placedAt: p.placedAt,
    })),
    ...comboBets.map((c) => ({
      id: c.id,
      kind: "Combiné",
      label: `Combiné ${c.legs.length} sél. (${c.totalOdds.toFixed(2)})`,
      detail: c.legs.map((l) => l.selectionLabel).join(" · "),
      stake: c.stake,
      win: c.potentialWin,
      status: c.status,
      riskFlag: null,
      clv: null,
      placedAt: c.placedAt,
    })),
  ].sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());

  const riskLabel = (flag: string) =>
    flag === "stale_mark_goal"
      ? "Latence but"
      : flag === "stale_near_decided"
        ? "Quasi décidé"
        : flag;

  return (
    <div className="flex flex-col gap-2.5">
      <AdminSectionTitle label="Historique global" count={rows.length} />
      {rows.map((b) => (
        <div key={`${b.kind}-${b.id}`} className="glass-card rounded-2xl p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-[13.5px] font-semibold text-ink">{b.label}</p>
              <p className="mt-0.5 truncate text-[11.5px] text-dim">
                {b.kind} · {b.detail} · {formatPlacedAt(b.placedAt)}
              </p>
              {(b.riskFlag || b.clv != null) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {b.riskFlag && (
                    <span className="rounded-md bg-betclic-red/10 px-1.5 py-0.5 text-[10px] font-semibold text-betclic-red">
                      {riskLabel(b.riskFlag)}
                    </span>
                  )}
                  {b.clv != null && (
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                        b.clv >= 0 ? "bg-win/12 text-win" : "bg-elev text-mist"
                      )}
                    >
                      CLV {b.clv >= 0 ? "+" : ""}
                      {(b.clv * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
            </div>
            <StatusBadge status={b.status} />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-edge pt-2 text-[11.5px]">
            <span className="text-mist">Mise {eur(b.stake)}</span>
            <span className="font-display font-bold tabular-nums text-ink">→ {eur(b.win)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Finance (Retraits & Dépôts) ---------------- */

function DepositsTab({
  deposits,
  withdrawals,
  busy,
  act,
}: {
  deposits: AdminDeposit[];
  withdrawals: AdminWithdrawal[];
  busy: Record<string, boolean>;
  act: (payload: Record<string, unknown>, key: string, okMsg: string) => Promise<boolean>;
}) {
  const totalDeposits = deposits
    .filter((d) => d.status === "credited")
    .reduce((s, d) => s + d.amount, 0);
  const totalWithdrawals = withdrawals
    .filter((w) => w.status === "approved")
    .reduce((s, w) => s + w.amount, 0);
  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="glass-card rounded-2xl p-3.5 text-center">
          <p className="text-[11px] font-medium text-dim">Dépôts crédités</p>
          <p className="mt-0.5 font-display text-[20px] font-bold tabular-nums text-win">
            {eur(totalDeposits)}
          </p>
        </div>
        <div className="glass-card rounded-2xl p-3.5 text-center">
          <p className="text-[11px] font-medium text-dim">Retraits payés</p>
          <p className="mt-0.5 font-display text-[20px] font-bold tabular-nums text-ink">
            {eur(totalWithdrawals)}
          </p>
        </div>
      </div>

      <AdminSectionTitle label="Demandes de retrait en attente" count={pendingWithdrawals.length} />
      {pendingWithdrawals.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-white py-5 text-center text-[12px] text-dim">
          Aucune demande de retrait en attente.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendingWithdrawals.map((w) => {
            const approveKey = `w-app-${w.id}`;
            const rejectKey = `w-rej-${w.id}`;
            return (
              <div key={w.id} className="glass-card rounded-2xl p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[14px] font-bold text-ink">
                      {w.userName} · {eur(w.amount)}
                    </p>
                    <p className="truncate text-[11.5px] font-medium text-mist">
                      {w.method.toUpperCase()} · {w.destination}
                    </p>
                    <p className="text-[10.5px] text-dim">
                      {w.userEmail || `Joueur #${w.userId}`} · {formatPlacedAt(w.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={w.status} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!!busy[approveKey] || !!busy[rejectKey]}
                    onClick={() =>
                      act(
                        { action: "approveWithdrawal", withdrawalId: w.id },
                        approveKey,
                        `Retrait de ${eur(w.amount)} approuvé`
                      )
                    }
                    className="h-9 rounded-xl bg-win font-display text-[12px] font-bold text-white disabled:opacity-50"
                  >
                    {busy[approveKey] ? "Validation…" : "Approuver"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy[approveKey] || !!busy[rejectKey]}
                    onClick={() =>
                      act(
                        { action: "rejectWithdrawal", withdrawalId: w.id },
                        rejectKey,
                        `Retrait refusé et ${eur(w.amount)} recrédités`
                      )
                    }
                    className="h-9 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[12px] font-bold text-betclic-red disabled:opacity-50"
                  >
                    {busy[rejectKey] ? "Remboursement…" : "Refuser & rembourser"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {withdrawals.filter((w) => w.status !== "pending").length > 0 && (
        <>
          <AdminSectionTitle
            label="Historique des retraits"
            count={withdrawals.filter((w) => w.status !== "pending").length}
          />
          <div className="flex flex-col gap-2">
            {withdrawals
              .filter((w) => w.status !== "pending")
              .map((w) => (
                <div key={w.id} className="glass-card flex items-center gap-3 rounded-2xl p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[13px] font-semibold text-ink">
                      {w.userName} · {eur(w.amount)} ({w.method.toUpperCase()})
                    </p>
                    <p className="truncate text-[11px] text-dim">
                      {w.destination} · {formatPlacedAt(w.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={w.status} />
                </div>
              ))}
          </div>
        </>
      )}

      <AdminSectionTitle label="Dépôts enregistrés" count={deposits.length} />
      {deposits.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-dim">Aucun dépôt enregistré.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {deposits.map((d) => (
            <div key={d.id} className="glass-card flex items-center gap-3 rounded-2xl p-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev text-ink">
                <CircleDollarSign className="h-4 w-4" strokeWidth={2.1} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[13.5px] font-semibold capitalize text-ink">
                  {d.provider} · {eur(d.amount)}
                </p>
                <p className="text-[11.5px] text-dim">{formatPlacedAt(d.createdAt)}</p>
              </div>
              <StatusBadge status={d.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Sous-composants ---------------- */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "En attente", cls: "bg-amber-500/15 text-amber-800" },
    approved: { label: "Validé", cls: "bg-win/12 text-win" },
    rejected: { label: "Refusé", cls: "bg-betclic-red/10 text-betclic-red" },
    cancelled: { label: "Annulé", cls: "bg-elev text-dim" },
    won: { label: "Gagné", cls: "bg-win/12 text-win" },
    lost: { label: "Perdu", cls: "bg-elev text-dim" },
    cashed: { label: "Cash-out", cls: "bg-sky-500/12 text-sky-700" },
    paid: { label: "Payé", cls: "bg-win/12 text-win" },
    credited: { label: "Crédité", cls: "bg-win/12 text-win" },
    failed: { label: "Échec", cls: "bg-betclic-red/10 text-betclic-red" },
    expired: { label: "Expiré", cls: "bg-elev text-dim" },
  };
  const s = map[status] ?? { label: status, cls: "bg-elev text-mist" };
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 font-display text-[10px] font-bold", s.cls)}>
      {s.label}
    </span>
  );
}

function LogoOrAvatar({ logo, name }: { logo?: string | null; name: string }) {
  const hue = teamHue(name);
  if (logo) {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-2 ring-white border border-edge">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
      </span>
    );
  }
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl font-display text-[10px] font-bold text-white ring-2 ring-white"
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 62% 46%), hsl(${(hue + 40) % 360} 70% 30%))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

function AdminInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "decimal" | "numeric";
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1 block text-[11px] font-semibold text-mist">{label}</span>}
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-3 text-[16px] text-ink outline-none transition-colors placeholder:text-dim focus:border-ink focus:bg-white"
      />
    </label>
  );
}

function AdminSectionTitle({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <h2 className="font-display text-[12px] font-bold uppercase tracking-wider text-mist">
        {label}
      </h2>
      {count != null && <span className="text-[11.5px] font-semibold text-dim">{count}</span>}
    </div>
  );
}

function ComboBox({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label?: string;
  value: string;
  onChange: (v: string, logo?: string | null) => void;
  placeholder?: string;
  options: Array<{ label: string; hint?: string; logo?: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onClick);
    return () => document.removeEventListener("pointerdown", onClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)
      )
    : options;
  const highlighted = filtered[0];

  return (
    <div className="relative" ref={boxRef}>
      {label && <span className="mb-1 block text-[11px] font-semibold text-mist">{label}</span>}
      <input
        value={open ? query : value}
        placeholder={placeholder}
        onFocus={() => {
          setQuery(value);
          setOpen(true);
        }}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && filtered[0]) {
            e.preventDefault();
            onChange(filtered[0].label, highlighted?.logo);
            setQuery(filtered[0].label);
          }
          if (e.key === "Enter" && highlighted) {
            e.preventDefault();
            onChange(highlighted.label, highlighted.logo);
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-3 text-[16px] text-ink outline-none transition-colors placeholder:text-dim focus:border-ink focus:bg-white"
      />

      {open && options.length > 0 && (
        <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-edge bg-white p-1 shadow-lg">
          {filtered.length === 0 && (
            <p className="px-2.5 py-2 text-[12px] text-dim">Aucun résultat</p>
          )}
          {filtered.map((o) => (
            <button
              key={o.label}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                onChange(o.label, o.logo);
                setQuery(o.label);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left active:bg-elev"
            >
              {o.logo != null && (
                <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-edge">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={o.logo}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain p-0.5"
                  />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[13px] font-semibold text-ink">
                  {o.label}
                </span>
                {o.hint && <span className="block text-[11px] text-dim">{o.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-card rounded-2xl p-3 text-center">
      <p className="font-display text-[16px] font-bold tabular-nums text-ink">{value}</p>
      <p className="text-[10.5px] font-medium text-dim">{label}</p>
    </div>
  );
}
