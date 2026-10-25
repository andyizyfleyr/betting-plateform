"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  BarChart3,
  Brain,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Dices,
  Eye,
  Flag,
  Goal,
  HelpCircle,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Target,
  Ticket,
  Trash2,
  TrendingUp,
  Trophy,
  Unlock,
  Users,
  X,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { Toggle } from "@/components/toggle";
import { LEAGUES, findLeague } from "@/lib/leagues";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt, initials, teamHue } from "@/lib/format";

type TabKey = "dashboard" | "forecasts" | "ml" | "matches" | "questions" | "users" | "bets" | "deposits";

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
  userId?: number;
  userName?: string;
  provider: string;
  providerRef?: string;
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
  adminNote?: string | null;
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
    pendingDeposits?: number;
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
  ml?: AdminMlOverview;
  scenarioMode?: "dynamic" | "locked";
  matchForecasts?: Record<number, AdminMatchForecast>;
}

interface AdminMatchForecast {
  matchId: number;
  finalHomeScore: number;
  finalAwayScore: number;
  htHomeScore: number;
  htAwayScore: number;
  isLocked: boolean;
  events: Array<{
    type: string;
    team: string;
    minute: number;
    player?: string;
  }>;
}

interface AdminMlOverview {
  models: Array<{
    key: string;
    name: string;
    algorithm: string;
    version: number;
    samplesCount: number;
    brierScore: number;
    logLoss: number;
    updatedAt: string;
  }>;
  sharpWeights: Array<{
    key: string;
    label: string;
    weight: number;
    prior: number;
  }>;
  sharpBias: number;
  playerProfiles: Array<{
    userId: number;
    name: string;
    email: string | null;
    betsCount: number;
    pSharpPct: number;
    zScore: number;
    roiPct: number;
    riskWeight: number;
    maxStake: number;
    topReason: string;
  }>;
  calibratedSegments: Array<{
    segment: string;
    market: string;
    bucket: string;
    samples: number;
    predWinPct: number;
    obsWinPct: number;
    staked: number;
    paid: number;
    marginMult: number;
  }>;
  clubRatings: Array<{
    clubKey: string;
    attack: number;
    defense: number;
    netPower: number;
    rd: number;
    matches: number;
    goalsFor: number;
    goalsAgainst: number;
    lastDelta: number;
  }>;
  recommenderSummary: {
    avgPreferredOdds: number;
    totalAnalysedBets: number;
    topLeagues: Array<{ league: string; weight: number }>;
  };
}

const TABS: { key: TabKey; label: string; Icon: typeof Trophy }[] = [
  { key: "dashboard", label: "Synthèse", Icon: BarChart3 },
  { key: "forecasts", label: "Scores prévus", Icon: Eye },
  { key: "matches", label: "Matchs", Icon: Trophy },
  { key: "ml", label: "IA & ML", Icon: Brain },
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
            const pendingFinance =
              key === "deposits"
                ? (panel?.stats.pendingWithdrawals ?? 0) + (panel?.stats.pendingDeposits ?? 0)
                : 0;
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
                {pendingFinance > 0 && (
                  <span className="ml-0.5 rounded-full bg-betclic-red px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {pendingFinance}
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
          {tab === "forecasts" && (
            <ScoresPrevusTab
              matches={panel.matches}
              scenarioMode={panel.scenarioMode ?? "dynamic"}
              forecasts={panel.matchForecasts ?? {}}
              busy={busy}
              act={act}
            />
          )}
          {tab === "ml" && (
            <MlAdminTab ml={panel.ml} busy={busy} act={act} />
          )}
          {tab === "matches" && (
            <MatchesTab
              matches={panel.matches}
              forecasts={panel.matchForecasts ?? {}}
              onOpenForecasts={() => setTab("forecasts")}
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
  forecasts,
  onOpenForecasts,
  busy,
  act,
  form,
  setForm,
  onAdd,
}: {
  matches: AdminMatch[];
  forecasts: Record<number, AdminMatchForecast>;
  onOpenForecasts: () => void;
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
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [matchQuery, setMatchQuery] = useState("");

  const activeLeague = findLeague(form.league);
  const clubOptions = (activeLeague?.clubs ?? []).map((c) => c.name);
  const activeMarkets = form.markets.filter((g) => g.outcomes.some((o) => Number(o.odds) > 1));

  const qMatch = matchQuery.trim().toLowerCase();
  const searchedMatches = qMatch
    ? matches.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(qMatch) ||
          m.awayTeam.toLowerCase().includes(qMatch) ||
          m.league.toLowerCase().includes(qMatch)
      )
    : matches;

  const byMatchStatus =
    statusFilter === "all"
      ? searchedMatches
      : searchedMatches.filter((m) => m.status === statusFilter);

  const matchLeagueOptions = Array.from(new Set(matches.map((m) => m.league))).map((lg) => ({
    value: lg,
    label: lg,
    count: byMatchStatus.filter((m) => m.league === lg).length,
  }));

  const effectiveLeague =
    leagueFilter === "all" || matchLeagueOptions.some((o) => o.value === leagueFilter)
      ? leagueFilter
      : "all";

  const filteredMatches =
    effectiveLeague === "all"
      ? byMatchStatus
      : byMatchStatus.filter((m) => m.league === effectiveLeague);

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

      <div className="flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={matchQuery}
          onChange={(e) => setMatchQuery(e.target.value)}
          placeholder="Rechercher un club ou une ligue…"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
        />
        {matchQuery && (
          <button type="button" onClick={() => setMatchQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] -my-3"
        filters={[
          {
            id: "admin-match-status",
            placeholder: "Statut",
            value: statusFilter,
            defaultValue: "all",
            onChange: setStatusFilter,
            options: [
              { value: "all", label: "Tous", count: searchedMatches.length },
              {
                value: "live",
                label: "En direct",
                count: searchedMatches.filter((m) => m.status === "live").length,
              },
              {
                value: "upcoming",
                label: "À venir",
                count: searchedMatches.filter((m) => m.status === "upcoming").length,
              },
              {
                value: "finished",
                label: "Terminés",
                count: searchedMatches.filter((m) => m.status === "finished").length,
              },
            ],
          },
          {
            id: "admin-match-league",
            placeholder: "Ligue",
            value: effectiveLeague,
            defaultValue: "all",
            onChange: setLeagueFilter,
            options: [
              { value: "all", label: "Toutes ligues", count: byMatchStatus.length },
              ...matchLeagueOptions,
            ],
          },
        ]}
        onReset={() => {
          setStatusFilter("all");
          setLeagueFilter("all");
        }}
        resultCountText={`${filteredMatches.length} match${filteredMatches.length > 1 ? "s" : ""}`}
      />

      <div className="flex flex-col gap-2.5">
        {filteredMatches.map((m) => (
          <AdminMatchCard
            key={m.id}
            m={m}
            forecast={forecasts[m.id]}
            onOpenForecasts={onOpenForecasts}
            busy={busy}
            act={act}
          />
        ))}
      </div>
    </div>
  );
}

function AdminMatchCard({
  m,
  forecast,
  onOpenForecasts,
  busy,
  act,
}: {
  m: AdminMatch;
  forecast?: AdminMatchForecast;
  onOpenForecasts: () => void;
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

      {/* Aperçu direct du score final prévu avant/pendant le match */}
      {m.status !== "finished" && forecast && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-edge bg-elev/60 px-2.5 py-1.5 text-[11.5px]">
          <div className="flex min-w-0 items-center gap-1.5">
            {forecast.isLocked ? (
              <Lock className="h-3.5 w-3.5 shrink-0 text-win" strokeWidth={2.4} />
            ) : (
              <Eye className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
            )}
            <span className="truncate font-medium text-mist">
              Score final prévu :{" "}
              <strong className="font-display font-bold tabular-nums text-ink">
                {forecast.finalHomeScore} – {forecast.finalAwayScore}
              </strong>{" "}
              <span className="text-[10.5px] text-dim">
                (MT {forecast.htHomeScore}-{forecast.htAwayScore})
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenForecasts}
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-display text-[10px] font-bold",
              forecast.isLocked
                ? "bg-win/12 text-win"
                : "bg-betclic-red/10 text-betclic-red"
            )}
          >
            {forecast.isLocked ? "Figé 100 % →" : "Dynamique →"}
          </button>
        </div>
      )}

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

  const [qFilter, setQFilter] = useState<"open" | "resolved">("open");
  const [qCategory, setQCategory] = useState<string>("Tous");
  const [qFormat, setQFormat] = useState<"all" | "multi" | "binary">("all");
  const [qQuery, setQQuery] = useState("");
  const multiPlaceholders = ["Lamine Yamal", "Kylian Mbappé", "Harry Kane", "Vinícius Jr."];

  const isMultiQ = (q: AdminQuestion) => Array.isArray(q.options) && q.options.length >= 2;
  const qTrim = qQuery.trim().toLowerCase();
  const searchedQs = qTrim
    ? questions.filter(
        (q) =>
          q.question.toLowerCase().includes(qTrim) ||
          q.category.toLowerCase().includes(qTrim) ||
          (q.options ?? []).some((o) => o.label.toLowerCase().includes(qTrim))
      )
    : questions;

  const openQs = searchedQs.filter((q) => q.status === "open");
  const resolvedQs = searchedQs.filter((q) => q.status === "resolved");
  const baseQs = qFilter === "open" ? openQs : resolvedQs;

  const adminCategories = ["Tous", "Sport", "Actus", "Crypto", "Culture"];
  const byCatQs =
    qCategory === "Tous" ? baseQs : baseQs.filter((q) => q.category === qCategory);
  const multiQCount = byCatQs.filter(isMultiQ).length;
  const binaryQCount = byCatQs.length - multiQCount;

  const visibleQuestions =
    qFormat === "multi"
      ? byCatQs.filter(isMultiQ)
      : qFormat === "binary"
        ? byCatQs.filter((q) => !isMultiQ(q))
        : byCatQs;

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

      <div className="flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={qQuery}
          onChange={(e) => setQQuery(e.target.value)}
          placeholder="Rechercher une question ou un candidat…"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
        />
        {qQuery && (
          <button type="button" onClick={() => setQQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] -my-3"
        filters={[
          {
            id: "admin-q-status",
            placeholder: "Statut",
            value: qFilter,
            defaultValue: "open",
            onChange: setQFilter,
            options: [
              { value: "open", label: "Ouvertes", count: openQs.length },
              { value: "resolved", label: "Résolues", count: resolvedQs.length },
            ],
          },
          {
            id: "admin-q-cat",
            placeholder: "Catégorie",
            value: qCategory,
            defaultValue: "Tous",
            onChange: setQCategory,
            options: adminCategories.map((c) => ({
              value: c,
              label: c,
              count: c === "Tous" ? baseQs.length : baseQs.filter((q) => q.category === c).length,
            })),
          },
          {
            id: "admin-q-format",
            placeholder: "Format",
            value: qFormat,
            defaultValue: "all",
            onChange: setQFormat,
            options: [
              { value: "all", label: "Tous formats", count: byCatQs.length },
              { value: "multi", label: "Choix multiples", count: multiQCount },
              { value: "binary", label: "Oui / Non", count: binaryQCount },
            ],
          },
        ]}
        onReset={() => {
          setQFilter("open");
          setQCategory("Tous");
          setQFormat("all");
        }}
        resultCountText={`${visibleQuestions.length} prédiction${visibleQuestions.length > 1 ? "s" : ""}`}
      />

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
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "player" | "admin">("all");
  const [balFilter, setBalFilter] = useState<"all" | "positive" | "zero">("all");
  const q = query.trim().toLowerCase();
  const searchedUsers = q
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          String(u.id) === q.replace("#", "")
      )
    : users;

  const byRoleUsers =
    roleFilter === "all"
      ? searchedUsers
      : roleFilter === "admin"
        ? searchedUsers.filter((u) => u.role === "admin")
        : searchedUsers.filter((u) => u.role !== "admin");

  const filteredUsers =
    balFilter === "positive"
      ? byRoleUsers.filter((u) => u.balance > 0)
      : balFilter === "zero"
        ? byRoleUsers.filter((u) => u.balance <= 0)
        : byRoleUsers;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par nom, e-mail ou #id…"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] -my-2.5"
        filters={[
          {
            id: "admin-user-role",
            placeholder: "Rôle",
            value: roleFilter,
            defaultValue: "all",
            onChange: setRoleFilter,
            options: [
              { value: "all", label: "Tous rôles", count: searchedUsers.length },
              {
                value: "player",
                label: "Joueurs",
                count: searchedUsers.filter((u) => u.role !== "admin").length,
              },
              {
                value: "admin",
                label: "Admins",
                count: searchedUsers.filter((u) => u.role === "admin").length,
              },
            ],
          },
          {
            id: "admin-user-balance",
            placeholder: "Solde",
            value: balFilter,
            defaultValue: "all",
            onChange: setBalFilter,
            options: [
              { value: "all", label: "Tous soldes", count: byRoleUsers.length },
              {
                value: "positive",
                label: "Solde > 0 €",
                pillLabel: "Solde actif",
                count: byRoleUsers.filter((u) => u.balance > 0).length,
              },
              {
                value: "zero",
                label: "Solde à 0 €",
                pillLabel: "Solde 0 €",
                count: byRoleUsers.filter((u) => u.balance <= 0).length,
              },
            ],
          },
        ]}
        onReset={() => {
          setRoleFilter("all");
          setBalFilter("all");
        }}
        resultCountText={`${filteredUsers.length} joueur${filteredUsers.length > 1 ? "s" : ""}`}
      />
      {filteredUsers.map((u) => (
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

  const [query, setQuery] = useState("");
  const [betStatusFilter, setBetStatusFilter] = useState<"all" | "pending" | "won" | "lost" | "cashed" | "void">("all");
  const [betKindFilter, setBetKindFilter] = useState<"all" | "Sport" | "Préd." | "Combiné">("all");
  const q = query.trim().toLowerCase();
  const searchedRows = q
    ? rows.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          r.detail.toLowerCase().includes(q) ||
          r.kind.toLowerCase().includes(q)
      )
    : rows;

  const byBetStatus =
    betStatusFilter === "all"
      ? searchedRows
      : searchedRows.filter((r) => r.status === betStatusFilter);

  const filteredRows =
    betKindFilter === "all"
      ? byBetStatus
      : byBetStatus.filter((r) => r.kind === betKindFilter);

  const riskLabel = (flag: string) =>
    flag === "stale_mark_goal"
      ? "Latence but"
      : flag === "stale_near_decided"
        ? "Quasi décidé"
        : flag;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer par match, question, combiné…"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] -my-2.5"
        filters={[
          {
            id: "admin-bet-status",
            placeholder: "Statut",
            value: betStatusFilter,
            defaultValue: "all",
            onChange: setBetStatusFilter,
            options: [
              { value: "all", label: "Tous", count: searchedRows.length },
              {
                value: "pending",
                label: "En cours",
                count: searchedRows.filter((r) => r.status === "pending").length,
              },
              {
                value: "won",
                label: "Gagnés",
                count: searchedRows.filter((r) => r.status === "won").length,
              },
              {
                value: "lost",
                label: "Perdus",
                count: searchedRows.filter((r) => r.status === "lost").length,
              },
              {
                value: "cashed",
                label: "Cash-out",
                count: searchedRows.filter((r) => r.status === "cashed").length,
              },
              {
                value: "void",
                label: "Remboursés",
                count: searchedRows.filter((r) => r.status === "void").length,
              },
            ],
          },
          {
            id: "admin-bet-kind",
            placeholder: "Type",
            value: betKindFilter,
            defaultValue: "all",
            onChange: setBetKindFilter,
            options: [
              { value: "all", label: "Tous types", count: byBetStatus.length },
              {
                value: "Sport",
                label: "Sport",
                count: byBetStatus.filter((r) => r.kind === "Sport").length,
              },
              {
                value: "Préd.",
                label: "Prédictions",
                count: byBetStatus.filter((r) => r.kind === "Préd.").length,
              },
              {
                value: "Combiné",
                label: "Combinés",
                count: byBetStatus.filter((r) => r.kind === "Combiné").length,
              },
            ],
          },
        ]}
        onReset={() => {
          setBetStatusFilter("all");
          setBetKindFilter("all");
        }}
        resultCountText={`${filteredRows.length} pari${filteredRows.length > 1 ? "s" : ""}`}
      />

      {filteredRows.map((b) => (
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
  const [wdNotes, setWdNotes] = useState<Record<number, string>>({});

  const totalDeposits = deposits
    .filter((d) => d.status === "credited" || d.status === "paid")
    .reduce((s, d) => s + d.amount, 0);
  const totalWithdrawals = withdrawals
    .filter((w) => w.status === "approved")
    .reduce((s, w) => s + w.amount, 0);
  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending");
  const pendingDeposits = deposits.filter((d) => d.status === "pending_review");
  const settledDeposits = deposits.filter((d) => d.status !== "pending_review");

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

      {/* Demandes de dépôt Mobile Money / Virement à valider */}
      <AdminSectionTitle label="Demandes de dépôt à valider" count={pendingDeposits.length} />
      {pendingDeposits.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-white py-4 text-center text-[12px] text-dim">
          Aucune demande de dépôt en attente.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendingDeposits.map((d) => {
            const appKey = `d-app-${d.id}`;
            const rejKey = `d-rej-${d.id}`;
            return (
              <div key={d.id} className="glass-card rounded-2xl p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[14px] font-bold text-ink">
                      {d.userName ?? `Joueur #${d.userId ?? 1}`} · +{eur(d.amount)}
                    </p>
                    <p className="truncate text-[11.5px] font-medium text-mist">
                      {d.provider === "mobile_money" ? "Mobile Money" : "Virement SEPA"} ·{" "}
                      {d.providerRef ?? "—"}
                    </p>
                    <p className="text-[10.5px] text-dim">{formatPlacedAt(d.createdAt)}</p>
                  </div>
                  <StatusBadge status="pending" />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!!busy[appKey] || !!busy[rejKey]}
                    onClick={() =>
                      act(
                        { action: "approveDeposit", depositId: d.id },
                        appKey,
                        `Dépôt de ${eur(d.amount)} crédité sur le compte`
                      )
                    }
                    className="h-9 rounded-xl bg-win font-display text-[12px] font-bold text-white disabled:opacity-50"
                  >
                    {busy[appKey] ? "Crédit…" : "Créditer"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy[appKey] || !!busy[rejKey]}
                    onClick={() =>
                      act(
                        { action: "rejectDeposit", depositId: d.id },
                        rejKey,
                        "Demande de dépôt refusée"
                      )
                    }
                    className="h-9 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[12px] font-bold text-betclic-red disabled:opacity-50"
                  >
                    {busy[rejKey] ? "Refus…" : "Refuser"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Demandes de retrait */}
      <AdminSectionTitle label="Demandes de retrait en attente" count={pendingWithdrawals.length} />
      {pendingWithdrawals.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-white py-4 text-center text-[12px] text-dim">
          Aucune demande de retrait en attente.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendingWithdrawals.map((w) => {
            const approveKey = `w-app-${w.id}`;
            const rejectKey = `w-rej-${w.id}`;
            const noteVal = wdNotes[w.id] ?? "";
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

                <input
                  type="text"
                  value={noteVal}
                  onChange={(e) => setWdNotes({ ...wdNotes, [w.id]: e.target.value })}
                  placeholder="Motif ou réf. transfert (optionnel, visible par le joueur)"
                  className="mt-2.5 h-9 w-full rounded-xl border border-edge bg-elev/60 px-3 text-[12px] text-ink outline-none placeholder:text-dim focus:border-ink focus:bg-white"
                />

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!!busy[approveKey] || !!busy[rejectKey]}
                    onClick={() =>
                      act(
                        {
                          action: "approveWithdrawal",
                          withdrawalId: w.id,
                          ...(noteVal.trim() ? { note: noteVal.trim() } : {}),
                        },
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
                        {
                          action: "rejectWithdrawal",
                          withdrawalId: w.id,
                          ...(noteVal.trim() ? { note: noteVal.trim() } : {}),
                        },
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
                      {w.destination}
                      {w.adminNote ?? w.note ? ` · ${w.adminNote ?? w.note}` : ""} ·{" "}
                      {formatPlacedAt(w.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={w.status} />
                </div>
              ))}
          </div>
        </>
      )}

      <AdminSectionTitle label="Dépôts traités" count={settledDeposits.length} />
      {settledDeposits.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-dim">Aucun dépôt enregistré.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {settledDeposits.map((d) => (
            <div key={d.id} className="glass-card flex items-center gap-3 rounded-2xl p-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev text-ink">
                <CircleDollarSign className="h-4 w-4" strokeWidth={2.1} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[13.5px] font-semibold capitalize text-ink">
                  {d.userName ? `${d.userName} · ` : ""}
                  {d.provider === "mobile_money" ? "Mobile Money" : d.provider} · {eur(d.amount)}
                </p>
                <p className="truncate text-[11.5px] text-dim">
                  {d.providerRef ? `${d.providerRef} · ` : ""}
                  {formatPlacedAt(d.createdAt)}
                </p>
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
    void: { label: "Remboursé", cls: "bg-amber-500/12 text-amber-800" },
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

/* ---------------- IA & Machine Learning ---------------- */

function MlAdminTab({
  ml,
  busy,
  act,
}: {
  ml?: AdminMlOverview;
  busy: Record<string, boolean>;
  act: (payload: Record<string, unknown>, key: string, okMsg: string) => Promise<boolean>;
}) {
  if (!ml) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center text-[13px] text-dim">
        Chargement de la télémétrie Machine Learning…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Bandeau d'action & statut global */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <div className="flex items-center gap-1.5">
              <Brain className="h-4 w-4 text-betclic-red" />
              <h2 className="font-display text-[15px] font-bold text-ink">
                Moteur IA & Machine Learning (4 modèles actifs)
              </h2>
            </div>
            <p className="mt-0.5 text-[11.5px] text-dim">
              Apprentissage en ligne continu à chaque règlement + consolidation batch PostgreSQL.
            </p>
          </div>
          <button
            type="button"
            disabled={Boolean(busy["retrain-ml"])}
            onClick={() =>
              void act(
                { action: "retrainMl" },
                "retrain-ml",
                "Les 4 modèles IA ont été ré-entraînés sur l'historique complet"
              )
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink px-3.5 font-display text-[12px] font-bold text-white transition-opacity disabled:opacity-50"
          >
            {busy["retrain-ml"] ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Ré-entraîner les modèles
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ml.models.map((m) => (
            <div
              key={m.key}
              className="rounded-xl border border-edge bg-elev/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-display text-[13px] font-bold text-ink">
                  {m.name}
                </span>
                <span className="rounded-full bg-ink/8 px-2 py-0.5 font-display text-[10px] font-bold text-ink">
                  v{m.version}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-mist">{m.algorithm}</p>
              <div className="mt-2 flex items-center justify-between border-t border-edge/70 pt-2 text-[11px] tabular-nums">
                <span className="text-dim">
                  Échantillons : <strong className="text-ink">{m.samplesCount}</strong>
                </span>
                <span className="text-dim">
                  Brier : <strong className="text-win">{m.brierScore.toFixed(3)}</strong>
                </span>
                <span className="text-dim">
                  LogLoss : <strong className="text-ink">{m.logLoss.toFixed(3)}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Modèle 1 : Poids appris Logistic SGD + Radar comptes */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[14px] font-bold text-ink">
            1. Poids appris · Détecteur Sharp (Logistic SGD)
          </h3>
          <span className="text-[11px] tabular-nums text-dim">
            Biais b₀ = {ml.sharpBias.toFixed(2)}
          </span>
        </div>
        <div className="mt-2.5 space-y-2">
          {ml.sharpWeights.map((w) => {
            const pct = Math.min(100, Math.max(8, Math.round((w.weight / 2.2) * 100)));
            const delta = w.weight - w.prior;
            return (
              <div key={w.key}>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="truncate font-medium text-ink">{w.label}</span>
                  <span className="shrink-0 font-display font-bold tabular-nums text-ink">
                    {w.weight.toFixed(3)}{" "}
                    <span className="text-[10px] font-normal text-dim">
                      ({delta >= 0 ? "+" : ""}
                      {delta.toFixed(2)} vs prior)
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elev">
                  <div
                    className="h-full rounded-full bg-betclic-red transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <h4 className="mt-4 font-display text-[12.5px] font-bold text-ink">
          Radar IA des profils joueurs ({ml.playerProfiles.length})
        </h4>
        {ml.playerProfiles.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-dim">
            Aucun historique de pari suffisant pour scorer les profils.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {ml.playerProfiles.map((p) => (
              <div
                key={p.userId}
                className="flex flex-col gap-1 rounded-xl border border-edge bg-white p-2.5 text-[11.5px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold text-ink">
                    {p.name}{" "}
                    <span className="font-normal text-dim">({p.betsCount} paris)</span>
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-display text-[10.5px] font-bold tabular-nums",
                      p.pSharpPct >= 55
                        ? "bg-betclic-red/12 text-betclic-red"
                        : p.pSharpPct >= 35
                          ? "bg-amber-500/15 text-amber-700"
                          : "bg-win/12 text-win"
                    )}
                  >
                    P(Sharp) {p.pSharpPct.toFixed(0)} %
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-dim">
                  <span>Z-Score : <strong className="text-ink">{p.zScore}</strong></span>
                  <span>ROI : <strong className="text-ink">{p.roiPct}%</strong></span>
                  <span>Bouclier : <strong className="text-ink">×{p.riskWeight}</strong></span>
                  <span>Plafond IA : <strong className="text-ink">{p.maxStake} €</strong></span>
                </div>
                <p className="truncate text-[10.5px] text-mist">
                  Signal dominant : {p.topReason}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modèle 2 : Auto-Calibration Bayésienne des Marchés */}
      <section className="glass-card rounded-2xl p-4">
        <h3 className="font-display text-[14px] font-bold text-ink">
          2. Auto-Calibration Bayésienne des Marchés
        </h3>
        <p className="mt-0.5 text-[11.5px] text-dim">
          Ajuste tout seul le multiplicateur de marge si un segment gagne plus souvent que prévu.
        </p>
        {ml.calibratedSegments.length === 0 ? (
          <p className="mt-2 text-[12px] text-dim">
            En attente des premiers paris réglés pour calibrer les segments.
          </p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {ml.calibratedSegments.map((s) => (
              <div
                key={s.segment}
                className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-white px-3 py-2 text-[11.5px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink">
                    {s.market}{" "}
                    <span className="rounded bg-elev px-1.5 py-0.5 text-[10px] font-semibold uppercase text-mist">
                      {s.bucket}
                    </span>
                  </p>
                  <p className="text-[10.5px] tabular-nums text-dim">
                    {s.samples} paris · Prédit {s.predWinPct}% vs Réel {s.obsWinPct}%
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-lg px-2 py-1 font-display text-[11px] font-bold tabular-nums",
                    s.marginMult > 1.005
                      ? "bg-amber-500/15 text-amber-800"
                      : "bg-elev text-ink"
                  )}
                >
                  ×{s.marginMult.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modèle 3 : Classement Dynamique Glicko-2 des Clubs */}
      <section className="glass-card rounded-2xl p-4">
        <h3 className="font-display text-[14px] font-bold text-ink">
          3. Forces Dynamiques des Clubs (Glicko-2 Attaque / Défense)
        </h3>
        <p className="mt-0.5 text-[11.5px] text-dim">
          Mis à jour automatiquement après chaque coup de sifflet final.
        </p>
        {ml.clubRatings.length === 0 ? (
          <p className="mt-2 text-[12px] text-dim">
            Les ratings apparaissent dès les premiers matchs terminés.
          </p>
        ) : (
          <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {ml.clubRatings.map((c) => (
              <div
                key={c.clubKey}
                className="flex items-center justify-between rounded-xl border border-edge bg-white px-3 py-2 text-[11.5px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold capitalize text-ink">{c.clubKey}</p>
                  <p className="text-[10.5px] tabular-nums text-dim">
                    {c.matches} m · Att ×{c.attack.toFixed(2)} · Déf ×{c.defense.toFixed(2)} ({c.goalsFor}:{c.goalsAgainst})
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-ink px-2 py-0.5 font-display text-[11px] font-bold tabular-nums text-white">
                  {c.netPower.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------- Scores Finaux Prévus (Oracle Avant-Match & Live) ---------------- */

function ScoresPrevusTab({
  matches,
  scenarioMode,
  forecasts,
  busy,
  act,
}: {
  matches: AdminMatch[];
  scenarioMode: "dynamic" | "locked";
  forecasts: Record<number, AdminMatchForecast>;
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "upcoming" | "live">("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [lockFilter, setLockFilter] = useState<"all" | "locked" | "dynamic">("all");
  const [editingMatchId, setEditingMatchId] = useState<number | null>(null);
  const [targetScore, setTargetScore] = useState<{ home: number; away: number }>({
    home: 1,
    away: 0,
  });

  // Tous les matchs ouverts ayant un scénario prévu, triés dans l'ordre exact de passage
  const openScheduled = matches
    .filter((m) => (m.status === "upcoming" || m.status === "live") && forecasts[m.id] != null)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "live" ? -1 : 1;
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || a.id - b.id;
    });

  const q = query.trim().toLowerCase();
  const searched = q
    ? openScheduled.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(q) ||
          m.awayTeam.toLowerCase().includes(q) ||
          m.league.toLowerCase().includes(q)
      )
    : openScheduled;

  const byStatus =
    statusFilter === "all"
      ? searched
      : searched.filter((m) => m.status === statusFilter);

  const leagueOpts = Array.from(new Set(openScheduled.map((m) => m.league))).map((lg) => ({
    value: lg,
    label: lg,
    count: byStatus.filter((m) => m.league === lg).length,
  }));

  const effectiveLeague =
    leagueFilter === "all" || leagueOpts.some((o) => o.value === leagueFilter)
      ? leagueFilter
      : "all";

  const byLeague =
    effectiveLeague === "all"
      ? byStatus
      : byStatus.filter((m) => m.league === effectiveLeague);

  const lockedCount = byLeague.filter((m) => forecasts[m.id]?.isLocked).length;
  const dynamicCount = byLeague.length - lockedCount;

  const visible =
    lockFilter === "locked"
      ? byLeague.filter((m) => forecasts[m.id]?.isLocked)
      : lockFilter === "dynamic"
        ? byLeague.filter((m) => !forecasts[m.id]?.isLocked)
        : byLeague;

  const upcomingOrderMap = new Map<number, number>();
  let queueRank = 1;
  for (const m of openScheduled) {
    if (m.status === "upcoming") {
      upcomingOrderMap.set(m.id, queueRank++);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Sélecteur des 2 modes demandés */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-betclic-red" strokeWidth={2.3} />
          <h2 className="font-display text-[15px] font-bold text-ink">
            Mode des scores anticipés (Avant-match & Direct)
          </h2>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
          Visible uniquement par l&apos;administrateur. Les joueurs ne reçoivent jamais ces données.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={Boolean(busy["mode-dynamic"]) || Boolean(busy["mode-locked"])}
            onClick={() => {
              if (scenarioMode !== "dynamic") {
                void act(
                  { action: "setScenarioMode", mode: "dynamic" },
                  "mode-dynamic",
                  "Mode 1 activé : Dynamique + verrouillage à la carte"
                );
              }
            }}
            className={cn(
              "flex flex-col items-start rounded-2xl border p-3 text-left transition-all active:scale-[0.99]",
              scenarioMode === "dynamic"
                ? "border-betclic-red bg-betclic-red/[0.06] ring-1 ring-betclic-red/30"
                : "border-edge bg-white hover:bg-elev/50"
            )}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-display text-[13px] font-bold text-ink">
                Mode 1 · Dynamique + Verrouillage
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-display text-[10px] font-bold",
                  scenarioMode === "dynamic"
                    ? "bg-betclic-red text-white"
                    : "bg-elev text-dim"
                )}
              >
                {scenarioMode === "dynamic" ? "Actif" : "Choisir"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-mist">
              Affiche les scores prévus à l&apos;avance tout en gardant le bouclier de la banque actif en live, avec bouton pour figer ou forcer chaque match.
            </p>
          </button>

          <button
            type="button"
            disabled={Boolean(busy["mode-dynamic"]) || Boolean(busy["mode-locked"])}
            onClick={() => {
              if (scenarioMode !== "locked") {
                void act(
                  { action: "setScenarioMode", mode: "locked" },
                  "mode-locked",
                  "Mode 2 activé : Tous les scores à venir sont figés à 100 %"
                );
              }
            }}
            className={cn(
              "flex flex-col items-start rounded-2xl border p-3 text-left transition-all active:scale-[0.99]",
              scenarioMode === "locked"
                ? "border-win bg-win/[0.06] ring-1 ring-win/30"
                : "border-edge bg-white hover:bg-elev/50"
            )}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-display text-[13px] font-bold text-ink">
                Mode 2 · 100 % Figé d&apos;office
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-display text-[10px] font-bold",
                  scenarioMode === "locked"
                    ? "bg-win text-white"
                    : "bg-elev text-dim"
                )}
              >
                {scenarioMode === "locked" ? "Actif" : "Choisir"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-mist">
              Verrouille automatiquement tous les scénarios dès l&apos;avant-match : le score final et les minutes des buts sont garantis à 100 % sans bouger.
            </p>
          </button>
        </div>
      </section>

      {/* Barre de recherche */}
      <div className="flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une affiche ou une ligue…"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Rangée unique collante de 3 pastilles dropdown */}
      <FilterDropdownRow
        className="top-[105px] -my-3"
        filters={[
          {
            id: "forecast-status",
            placeholder: "Statut",
            value: statusFilter,
            defaultValue: "all",
            onChange: setStatusFilter,
            options: [
              { value: "all", label: "Tous prévus", count: searched.length },
              {
                value: "upcoming",
                label: "À venir",
                count: searched.filter((m) => m.status === "upcoming").length,
              },
              {
                value: "live",
                label: "En direct",
                count: searched.filter((m) => m.status === "live").length,
              },
            ],
          },
          {
            id: "forecast-league",
            placeholder: "Ligue",
            value: effectiveLeague,
            defaultValue: "all",
            onChange: setLeagueFilter,
            options: [
              { value: "all", label: "Toutes ligues", count: byStatus.length },
              ...leagueOpts,
            ],
          },
          {
            id: "forecast-lock",
            placeholder: "Garantie",
            value: lockFilter,
            defaultValue: "all",
            onChange: setLockFilter,
            options: [
              { value: "all", label: "Tous états", count: byLeague.length },
              { value: "locked", label: "Figés 100 %", count: lockedCount },
              { value: "dynamic", label: "Dynamiques", count: dynamicCount },
            ],
          },
        ]}
        onReset={() => {
          setStatusFilter("all");
          setLeagueFilter("all");
          setLockFilter("all");
        }}
        resultCountText={`${visible.length} match${visible.length > 1 ? "s" : ""} programmé${visible.length > 1 ? "s" : ""}`}
      />

      {visible.length === 0 ? (
        <div className="glass-card rounded-2xl p-6 text-center text-[12.5px] text-dim">
          Aucun match programmé dans ce filtre.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((m) => {
            const fc = forecasts[m.id];
            if (!fc) return null;
            const rank = upcomingOrderMap.get(m.id);
            const isEditingScore = editingMatchId === m.id;
            const minHome = m.status === "live" ? (m.homeScore ?? 0) : 0;
            const minAway = m.status === "live" ? (m.awayScore ?? 0) : 0;

            return (
              <div key={m.id} className="glass-card rounded-2xl p-3.5">
                {/* En-tête ligue + ordre file + badge Figé/Dynamique */}
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {m.status === "live" ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[10px] font-bold text-betclic-red">
                        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                        Direct {m.minute ?? ""}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-elev px-2 py-0.5 font-display text-[10px] font-bold text-ink">
                        À venir {rank ? `#${rank}` : ""} · {formatKickoff(new Date(m.startsAt))}
                      </span>
                    )}
                    <span className="truncate font-medium text-mist">{m.league}</span>
                  </div>

                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-display text-[10px] font-bold",
                      fc.isLocked
                        ? "bg-win/12 text-win"
                        : "bg-amber-500/15 text-amber-800"
                    )}
                  >
                    {fc.isLocked ? (
                      <>
                        <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />
                        Figé 100 %
                      </>
                    ) : (
                      <>⚡ Dynamique</>
                    )}
                  </span>
                </div>

                {/* Affiche + Score final prévu central */}
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-elev/55 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <LogoOrAvatar logo={m.homeLogo} name={m.homeTeam} />
                    <span className="truncate font-display text-[13px] font-bold text-ink">
                      {m.homeTeam}
                    </span>
                  </div>

                  <div className="flex flex-col items-center px-2">
                    <span className="text-[9.5px] font-semibold uppercase tracking-wider text-dim">
                      Score final
                    </span>
                    <span className="font-display text-[21px] font-extrabold leading-tight tabular-nums text-ink">
                      {fc.finalHomeScore} – {fc.finalAwayScore}
                    </span>
                    <span className="text-[10px] font-medium tabular-nums text-mist">
                      MT {fc.htHomeScore} – {fc.htAwayScore}
                      {m.status === "live" &&
                        ` · Actuel ${m.homeScore ?? 0}-${m.awayScore ?? 0}`}
                    </span>
                  </div>

                  <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                    <span className="truncate font-display text-[13px] font-bold text-ink">
                      {m.awayTeam}
                    </span>
                    <LogoOrAvatar logo={m.awayLogo} name={m.awayTeam} />
                  </div>
                </div>

                {/* Chronologie minute par minute des buts et cartons prévus */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {fc.events.length === 0 ? (
                    <span className="rounded-lg bg-elev/60 px-2.5 py-1 text-[11px] font-medium text-dim">
                      Aucun but ni carton prévu (0 – 0)
                    </span>
                  ) : (
                    fc.events.map((ev, idx) => {
                      const isHome = ev.team === "home";
                      const isRed = ev.type === "red_card";
                      return (
                        <span
                          key={`${ev.minute}-${ev.type}-${idx}`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium",
                            isRed
                              ? "bg-betclic-red/10 text-betclic-red"
                              : isHome
                                ? "bg-ink/[0.06] text-ink"
                                : "bg-sky-500/10 text-sky-900"
                          )}
                        >
                          <span>{isRed ? "🟥" : "⚽"}</span>
                          <strong className="font-display tabular-nums">{ev.minute}&apos;</strong>
                          <span className="truncate max-w-[130px]">
                            {ev.player ?? (isHome ? m.homeTeam : m.awayTeam)}
                          </span>
                          <span className="text-[10px] opacity-70">
                            ({isHome ? "Dom." : "Ext."})
                          </span>
                        </span>
                      );
                    })
                  )}
                </div>

                {/* Éditeur rapide de score exact personnalisé */}
                {isEditingScore && (
                  <div className="mt-3 rounded-xl border border-edge bg-white p-3">
                    <p className="text-[11.5px] font-semibold text-ink">
                      Imposer le score final exact (génère automatiquement minutes & buteurs)
                    </p>
                    <div className="mt-2.5 flex items-center justify-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setTargetScore((s) => ({
                              ...s,
                              home: Math.max(minHome, s.home - 1),
                            }))
                          }
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[15px] font-bold text-ink active:scale-95"
                        >
                          −
                        </button>
                        <span className="w-7 text-center font-display text-[18px] font-extrabold tabular-nums text-ink">
                          {targetScore.home}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setTargetScore((s) => ({
                              ...s,
                              home: Math.min(9, s.home + 1),
                            }))
                          }
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[15px] font-bold text-ink active:scale-95"
                        >
                          +
                        </button>
                      </div>

                      <span className="font-display text-[14px] font-bold text-dim">–</span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setTargetScore((s) => ({
                              ...s,
                              away: Math.max(minAway, s.away - 1),
                            }))
                          }
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[15px] font-bold text-ink active:scale-95"
                        >
                          −
                        </button>
                        <span className="w-7 text-center font-display text-[18px] font-extrabold tabular-nums text-ink">
                          {targetScore.away}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setTargetScore((s) => ({
                              ...s,
                              away: Math.min(9, s.away + 1),
                            }))
                          }
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[15px] font-bold text-ink active:scale-95"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        disabled={Boolean(busy[`force-${m.id}`])}
                        onClick={async () => {
                          const ok = await act(
                            {
                              action: "forceMatchFinalScore",
                              matchId: m.id,
                              homeScore: targetScore.home,
                              awayScore: targetScore.away,
                            },
                            `force-${m.id}`,
                            `Score final fixé à ${targetScore.home} – ${targetScore.away}`
                          );
                          if (ok) setEditingMatchId(null);
                        }}
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[12px] font-bold text-white disabled:opacity-50"
                      >
                        {busy[`force-${m.id}`] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Valider & Figer {targetScore.home} – {targetScore.away}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingMatchId(null)}
                        className="h-9 rounded-xl bg-elev px-3 font-display text-[12px] font-semibold text-mist"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

                {/* Barre de 3 actions rapides */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busy[`lock-${m.id}`])}
                    onClick={() =>
                      void act(
                        {
                          action: fc.isLocked ? "unlockMatchScenario" : "lockMatchScenario",
                          matchId: m.id,
                        },
                        `lock-${m.id}`,
                        fc.isLocked
                          ? "Match repassé en mode dynamique"
                          : `Score ${fc.finalHomeScore}–${fc.finalAwayScore} verrouillé à 100 %`
                      )
                    }
                    className={cn(
                      "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl font-display text-[11.5px] font-bold transition-colors disabled:opacity-50",
                      fc.isLocked
                        ? "bg-elev text-ink hover:bg-edge/70"
                        : "bg-win/12 text-win hover:bg-win/18"
                    )}
                  >
                    {busy[`lock-${m.id}`] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : fc.isLocked ? (
                      <Unlock className="h-3.5 w-3.5" strokeWidth={2.2} />
                    ) : (
                      <Lock className="h-3.5 w-3.5" strokeWidth={2.2} />
                    )}
                    <span>{fc.isLocked ? "Débloquer" : "Figer"}</span>
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(busy[`reroll-${m.id}`])}
                    onClick={() =>
                      void act(
                        { action: "rerollMatchScenario", matchId: m.id },
                        `reroll-${m.id}`,
                        "Nouveau scénario généré"
                      )
                    }
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-elev font-display text-[11.5px] font-bold text-ink transition-colors hover:bg-edge/70 disabled:opacity-50"
                  >
                    {busy[`reroll-${m.id}`] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Dices className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
                    )}
                    <span>Relancer</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (isEditingScore) {
                        setEditingMatchId(null);
                      } else {
                        setEditingMatchId(m.id);
                        setTargetScore({
                          home: Math.max(minHome, fc.finalHomeScore),
                          away: Math.max(minAway, fc.finalAwayScore),
                        });
                      }
                    }}
                    className={cn(
                      "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl font-display text-[11.5px] font-bold transition-colors",
                      isEditingScore
                        ? "bg-ink text-white"
                        : "bg-betclic-red/10 text-betclic-red hover:bg-betclic-red/16"
                    )}
                  >
                    <Target className="h-3.5 w-3.5" strokeWidth={2.2} />
                    <span>Choisir</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
