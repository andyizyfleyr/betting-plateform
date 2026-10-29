"use client";
import { AdminDisputes } from "@/components/admin-disputes";
import { AdminMonitoring } from "@/components/admin-monitoring";
import { PaymentIncidents } from "@/components/payment-incidents";

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
import {
  InfiniteScrollSentinel,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { TeamAvatar } from "@/components/team-avatar";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { LiveMatchClock } from "@/components/live-match-clock";
import { Toggle } from "@/components/toggle";
import { LEAGUES, findLeague } from "@/lib/leagues";
import { OFFICIAL_SOCCER_LEAGUES } from "@/lib/real-leagues";
import { teamLogo } from "@/lib/team-logos";
import {
  formatEurAsCurrency,
  getCountryConfig,
  getCurrencyConfig,
} from "@/lib/countries";
import {
  cn,
  eur,
  eurPivot,
  formatKickoff,
  formatOdds,
  formatPlacedAt,
  initials,
} from "@/lib/format";

type TabKey = "dashboard" | "forecasts" | "ml" | "matches" | "questions" | "users" | "bets" | "deposits";

const POLL_INTERVAL = 5_000;

interface AdminUser {
  id: number;
  name: string;
  email?: string | null;
  balance: number;
  role: string;
  countryCode?: string;
  currency?: string;
}

interface AdminBet {
  id: number;
  kind: "sport" | "prediction";
  matchId: number | null;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
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
  userCountryCode?: string;
  userCurrency?: string;
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
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  status: string;
  minute: string | null;
  startsAt: string;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  suspended: boolean;
  source?: string | null;
  externalId?: string | null;
  externalLeague?: string | null;
  autoSync?: boolean;
  feedSyncedAt?: string | null;
  feedStatusNote?: string | null;
  realStats?: {
    possessionHome: number | null;
    possessionAway: number | null;
    shotsTotalHome: number | null;
    shotsTotalAway: number | null;
    shotsOnTargetHome: number | null;
    shotsOnTargetAway: number | null;
    cornersHome: number | null;
    cornersAway: number | null;
    htHomeScore: number | null;
    htAwayScore: number | null;
    updatedAt: string;
  } | null;
}

interface DiscoveredOfficialFixture {
  externalId: string;
  externalLeague: string;
  leagueLabel: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  startsAt: string;
  status: "upcoming" | "live";
  minute: string | null;
  homeScore: number | null;
  awayScore: number | null;
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
  alreadyImported?: boolean;
  existingMatchId?: number | null;
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
  userCountryCode?: string;
  userCurrency?: string;
  method: string;
  destination: string;
  amount: number;
  status: string;
  adminNote?: string | null;
  note?: string | null;
  createdAt: string;
}

interface PanelData {
  bettingLimits?: { minStakeXof: number; maxStakeXof: number; maxPayoutXof: number; maxComboLegs: number };
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
  realSettlementMode?: "auto" | "confirm";
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
    label: "1x2",
    short: "1x2",
    outcomes: [
      { key: "home", label: "V1 (Domicile)", short: "V1" },
      { key: "draw", label: "X (Match nul)", short: "X" },
      { key: "away", label: "V2 (Extérieur)", short: "V2" },
    ],
  },
  {
    key: "double_chance",
    label: "Double chance",
    short: "1X · 12 · 2X",
    outcomes: [
      { key: "1X", label: "1X (Domicile ou X)", short: "1X" },
      { key: "12", label: "12 (Domicile ou Extérieur)", short: "12" },
      { key: "X2", label: "2X (Extérieur ou X)", short: "2X" },
    ],
  },
  {
    key: "total_ou",
    label: "Total",
    short: "Total",
    outcomes: [
      { key: "ou_1_5_over", label: "Total : Plus de (1.5)", short: "TP (1.5)" },
      { key: "ou_1_5_under", label: "Total : Moins de (1.5)", short: "TM (1.5)" },
      { key: "ou_2_5_over", label: "Total : Plus de (2.5)", short: "TP (2.5)" },
      { key: "ou_2_5_under", label: "Total : Moins de (2.5)", short: "TM (2.5)" },
      { key: "ou_3_5_over", label: "Total : Plus de (3.5)", short: "TP (3.5)" },
      { key: "ou_3_5_under", label: "Total : Moins de (3.5)", short: "TM (3.5)" },
    ],
  },
  {
    key: "btts",
    label: "Les deux équipes vont marquer",
    short: "Les 2 marquent",
    outcomes: [
      { key: "oui", label: "Les deux équipes vont marquer : Oui", short: "Oui" },
      { key: "non", label: "Les deux équipes vont marquer : Non", short: "Non" },
    ],
  },
  {
    key: "odd_even",
    label: "Total Pair / Impair",
    short: "Pair / Impair",
    outcomes: [
      { key: "pair", label: "Total Pair / Impair : Pair", short: "Pair" },
      { key: "impair", label: "Total Pair / Impair : Impair", short: "Impair" },
    ],
  },
  {
    key: "score_exact",
    label: "Score exact",
    short: "Score exact",
    outcomes: [
      { key: "1_0", label: "Score exact : 1-0", short: "1-0" },
      { key: "2_0", label: "Score exact : 2-0", short: "2-0" },
      { key: "2_1", label: "Score exact : 2-1", short: "2-1" },
      { key: "0_0", label: "Score exact : 0-0", short: "0-0" },
      { key: "1_1", label: "Score exact : 1-1", short: "1-1" },
      { key: "0_1", label: "Score exact : 0-1", short: "0-1" },
      { key: "0_2", label: "Score exact : 0-2", short: "0-2" },
      { key: "1_2", label: "Score exact : 1-2", short: "1-2" },
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
  const { user, adminTab: tab, setAdminTab: setTab, setAdminPendingFinance } = useApp();
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
  }, [setAdminPendingFinance]);

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
    <div className="mx-auto w-full max-w-[1680px] px-2 pb-6 pt-3 lg:px-3.5 lg:py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[16px] font-bold leading-tight tracking-tight text-ink lg:text-[16px]">
            Administration
          </h1>
          <p className="text-[10.5px] text-mist lg:text-[11px]">
            Pilotage des matchs, pronostics et joueurs
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="glass-card flex h-9 items-center gap-1.5 rounded-full px-3 text-[10.5px] font-medium text-ink hover:bg-elev/60 active:bg-elev"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={2.3} />
          Actualiser
        </button>
      </div>

      {notice && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium",
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
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-betclic-red/30 bg-betclic-red/8 px-3.5 py-2.5 text-[11px] text-betclic-red">
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          Accès réservé au compte administrateur.
        </div>
      )}

      {/* Onglets collants mobiles (remplacés par la barre latérale à gauche sur desktop) */}
      <div className="sticky top-[48px] z-30 -mx-2 mt-2.5 border-b border-edge/70 bg-deep/95 px-2 py-1.5 backdrop-blur-md lg:hidden">
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
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-display text-[10.5px] transition-colors",
                  active
                    ? "border-ink bg-ink font-medium text-white"
                    : "border-edge bg-white font-medium text-mist"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                <span>{label}</span>
                {pendingFinance > 0 && (
                  <span className="ml-0.5 rounded-full bg-betclic-red px-1.5 py-0.5 text-[9.5px] font-medium leading-none text-white">
                    {pendingFinance}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {loading || !panel ? (
        <PulseFlashLoader compact />
      ) : (
        <div className="mt-3">
          {tab === "dashboard" && <>
            <Dashboard stats={panel.stats} />
            <AdminMonitoring />
            <PaymentIncidents />
            <AdminDisputes />
            {panel.bettingLimits && <BettingLimitsForm key={JSON.stringify(panel.bettingLimits)} limits={panel.bettingLimits} busy={Boolean(busy.bettingLimits)} act={act} />}
          </>}
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
              realSettlementMode={panel.realSettlementMode ?? "auto"}
              onOpenForecasts={() => setTab("forecasts")}
              onReload={() => load(false)}
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

function BettingLimitsForm({ limits, busy, act }: {
  limits: NonNullable<PanelData["bettingLimits"]>;
  busy: boolean;
  act: (payload: Record<string, unknown>, key: string, okMsg: string) => Promise<boolean>;
}) {
  const [values, setValues] = useState(() => ({ ...limits }));
  const fields = [
    ["minStakeXof", "Mise minimale (₣)"],
    ["maxStakeXof", "Mise maximale (₣)"],
    ["maxPayoutXof", "Gain maximum (₣)"],
    ["maxComboLegs", "Sélections combinées maximum"],
  ] as const;
  return <section className="glass-card mt-4 rounded-xl p-4">
    <h2 className="font-display text-[13px] font-bold text-ink">Limites de paris</h2>
    <p className="mt-1 text-[11px] text-mist">Montants en ₣, convertis pour les autres devises. Le gain maximum doit être au moins égal à la mise maximale.</p>
    <div className="mt-3 grid grid-cols-2 gap-3">
      {fields.map(([key, label]) => <label key={key} className="text-[11px] text-mist">{label}
        <input type="number" min="1" value={values[key]} onChange={(e) => {
          setValues((v) => ({ ...v, [key]: Number(e.target.value) }));
        }} className="mt-1 block h-10 w-full rounded-lg border border-edge bg-white px-3 text-ink" />
      </label>)}
    </div>
    <button type="button" disabled={busy} onClick={() => void act({ action: "setBettingLimits", limits: values }, "bettingLimits", "Limites enregistrées")} className="mt-3 rounded-lg bg-betclic-red px-4 py-2 text-[11px] text-white disabled:opacity-50">Enregistrer</button>
  </section>;
}

function Dashboard({ stats }: { stats: PanelData["stats"] }) {
  const revenue = stats.stake - stats.payouts;
  const cards: { label: string; value: string; Icon: typeof Trophy; accent?: boolean }[] = [
    { label: "Joueurs", value: String(stats.totalUsers), Icon: Users },
    { label: "Matchs live", value: String(stats.liveMatches), Icon: Trophy, accent: stats.liveMatches > 0 },
    { label: "Pronostics ouverts", value: String(stats.openQuestions), Icon: HelpCircle },
    { label: "Coupons totaux", value: String(stats.totalBets), Icon: Ticket },
    { label: "Volume misé", value: eur(stats.stake), Icon: CircleDollarSign },
    { label: "Gains versés", value: eur(stats.payouts), Icon: TrendingUp },
  ];

  return (
    <div className="flex flex-col gap-3">
      <section className="glass-card rounded-2xl p-4">
        <p className="text-[10px] font-medium text-dim">Marge brute globale (mises − gains)</p>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <p className="font-display text-[17.5px] font-medium leading-none tabular-nums text-ink">
            {eur(revenue)}
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-display text-[10px] font-medium",
              revenue >= 0 ? "bg-win/12 text-win" : "bg-betclic-red/10 text-betclic-red"
            )}
          >
            {revenue >= 0 ? "+" : ""}
            {revenue.toFixed(0)} €
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6 xl:gap-3">
        {cards.map((c) => (
          <div key={c.label} className="glass-card rounded-2xl p-3.5 lg:p-4">
            <c.Icon
              className={cn("h-4 w-4", c.accent ? "text-betclic-red" : "text-dim")}
              strokeWidth={2.1}
            />
            <p className="mt-2 font-display text-[13.5px] font-medium tabular-nums text-ink lg:text-[14.5px]">
              {c.value}
            </p>
            <p className="text-[10px] font-medium text-dim">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 xl:gap-3">
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
  realSettlementMode,
  onOpenForecasts,
  onReload,
  busy,
  act,
  form,
  setForm,
  onAdd,
}: {
  matches: AdminMatch[];
  forecasts: Record<number, AdminMatchForecast>;
  realSettlementMode: "auto" | "confirm";
  onOpenForecasts: () => void;
  onReload: () => Promise<void>;
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
  form: MatchFormState;
  setForm: (f: MatchFormState) => void;
  onAdd: (e: FormEvent) => Promise<boolean>;
}) {
  const [universe, setUniverse] = useState<"real" | "virtual">("real");
  const [importerOpen, setImporterOpen] = useState(
    () => matches.filter((m) => m.source === "manual").length === 0
  );
  const [formOpen, setFormOpen] = useState(false);
  const [openLogos, setOpenLogos] = useState(false);
  const [openMarkets, setOpenMarkets] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "upcoming" | "finished">("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [matchQuery, setMatchQuery] = useState("");
  const [nowTs, setNowTs] = useState(0);
  const [optimisticSettleMode, setOptimisticSettleMode] = useState<"auto" | "confirm" | null>(
    null
  );
  const [syncingAll, setSyncingAll] = useState(false);
  const [realBanner, setRealBanner] = useState<{
    kind: "ok" | "err" | "info";
    msg: string;
  } | null>(null);

  const activeSettleMode = optimisticSettleMode ?? realSettlementMode;

  const handleSetSettlementMode = async (mode: "auto" | "confirm") => {
    if (mode === activeSettleMode && !busy["real-settle-mode"]) return;
    setOptimisticSettleMode(mode);
    setRealBanner(null);
    const ok = await act(
      { action: "setRealSettlementMode", mode },
      "real-settle-mode",
      mode === "auto"
        ? "Règlement automatique activé (confirmation anti-VAR 90s)"
        : "Mode Confirmation Admin activé avant règlement final"
    );
    if (ok) {
      setRealBanner({
        kind: "ok",
        msg:
          mode === "auto"
            ? "Mode Auto (Anti-VAR 90s) enregistré : les paris réels sont réglés automatiquement 90s après le coup de sifflet final."
            : "Mode Confirmation Admin enregistré : le score final verrouille les marchés et attend votre validation en 1 clic.",
      });
    }
    setOptimisticSettleMode(null);
  };

  const handleSyncAllReal = async () => {
    setSyncingAll(true);
    setRealBanner(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "syncAllRealMatches" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        summary?: {
          activeCount: number;
          syncedCount: number;
          linkedCount: number;
          liveCount: number;
          settledCount: number;
          pendingConfirmCount: number;
        };
      };
      if (!res.ok) throw new Error(data.error ?? "Échec de la synchronisation");
      await onReload();
      const s = data.summary;
      if (!s || s.activeCount === 0) {
        setRealBanner({
          kind: "info",
          msg: "Aucun match réel actif à synchroniser — importez d'abord une affiche officielle ci-dessous.",
        });
      } else {
        const details: string[] = [`${s.syncedCount}/${s.activeCount} match(s) synchronisé(s)`];
        if (s.liveCount > 0) details.push(`${s.liveCount} en direct`);
        if (s.linkedCount > 0) details.push(`${s.linkedCount} relié(s) auto`);
        if (s.settledCount > 0) details.push(`${s.settledCount} clôturé(s) et réglé(s)`);
        if (s.pendingConfirmCount > 0) details.push(`${s.pendingConfirmCount} en attente FT`);
        setRealBanner({
          kind: "ok",
          msg: details.join(" · "),
        });
      }
    } catch (e) {
      setRealBanner({
        kind: "err",
        msg: e instanceof Error ? e.message : "Erreur réseau lors de la synchronisation",
      });
    } finally {
      setSyncingAll(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setNowTs(Date.now()), 0);
    const id = setInterval(() => setNowTs(Date.now()), 5_000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, []);

  const realMatches = matches.filter((m) => m.source === "manual");
  const virtualMatches = matches.filter((m) => m.source !== "manual");
  const isReal = universe === "real";
  const scopedMatches = isReal ? realMatches : virtualMatches;

  const activeLeague = findLeague(form.league);
  const clubOptions = (activeLeague?.clubs ?? []).map((c) => c.name);
  const activeMarkets = form.markets.filter((g) =>
    g.outcomes.some((o) => Number(String(o.odds).replace(",", ".")) > 1)
  );

  const qMatch = matchQuery.trim().toLowerCase();
  const searchedMatches = qMatch
    ? scopedMatches.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(qMatch) ||
          m.awayTeam.toLowerCase().includes(qMatch) ||
          m.league.toLowerCase().includes(qMatch)
      )
    : scopedMatches;

  const byMatchStatus =
    statusFilter === "all"
      ? searchedMatches
      : searchedMatches.filter((m) => m.status === statusFilter);

  const matchLeagueOptions = Array.from(new Set(scopedMatches.map((m) => m.league))).map((lg) => ({
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

  const matchesBatch = useInfiniteBatch(
    filteredMatches.length,
    `${universe}|${statusFilter}|${effectiveLeague}|${qMatch}`
  );
  const pagedMatches = filteredMatches.slice(0, matchesBatch.visibleCount);

  return (
    <div className="flex flex-col gap-3">
      {/* Sélecteur strict entre Matchs réels (ajoutés par l'admin) et Matchs virtuels (simulateur) */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-edge bg-white p-1">
        <button
          type="button"
          onClick={() => {
            setUniverse("real");
            setLeagueFilter("all");
          }}
          className={cn(
            "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 font-display text-[11px] font-medium transition-all",
            isReal ? "bg-emerald-600 text-white shadow-xs" : "text-mist active:bg-elev"
          )}
        >
          <span>Matchs réels</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums",
              isReal ? "bg-white/20 text-white" : "bg-elev text-ink"
            )}
          >
            {realMatches.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setUniverse("virtual");
            setLeagueFilter("all");
          }}
          className={cn(
            "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 font-display text-[11px] font-medium transition-all",
            !isReal ? "bg-betclic-red text-white shadow-xs" : "text-mist active:bg-elev"
          )}
        >
          <span>Matchs virtuels</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums",
              !isReal ? "bg-white/20 text-white" : "bg-elev text-ink"
            )}
          >
            {virtualMatches.length}
          </span>
        </button>
      </div>

      {isReal ? (
        <div className="glass-card rounded-2xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-[11px] font-medium text-ink">
                Flux officiel automatique (Scores, MT et Stats)
              </p>
              <p className="text-[10px] text-mist">
                {realMatches.filter((m) => Boolean(m.externalId) && m.autoSync !== false).length}{" "}
                match(s) lié(s) en Auto-Sync · sans clé API payante
              </p>
            </div>
            <button
              type="button"
              disabled={syncingAll || busy["sync-all-real"]}
              onClick={() => void handleSyncAllReal()}
              className="inline-flex h-8.5 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 font-display text-[10.5px] font-medium text-white active:scale-95 disabled:opacity-60"
            >
              {syncingAll || busy["sync-all-real"] ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.4} />
              )}
              Synchroniser
            </button>
          </div>

          <div className="flex flex-col gap-1 border-t border-edge/70 pt-2">
            <span className="text-[10px] font-medium text-dim">
              Règlement de fin de match (protection anti-VAR) :
            </span>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-edge bg-elev p-1">
              <button
                type="button"
                disabled={busy["real-settle-mode"]}
                onClick={() => void handleSetSettlementMode("auto")}
                className={cn(
                  "h-8 rounded-lg px-2 font-display text-[10px] transition-colors",
                  activeSettleMode === "auto"
                    ? "bg-emerald-600 font-medium text-white"
                    : "font-medium text-mist"
                )}
              >
                Auto (Anti-VAR 90s)
              </button>
              <button
                type="button"
                disabled={busy["real-settle-mode"]}
                onClick={() => void handleSetSettlementMode("confirm")}
                className={cn(
                  "h-8 rounded-lg px-2 font-display text-[10px] transition-colors",
                  activeSettleMode === "confirm"
                    ? "bg-ink font-medium text-white"
                    : "font-medium text-mist"
                )}
              >
                Confirmation Admin
              </button>
            </div>
            <p className="text-[10px] text-mist">
              {activeSettleMode === "auto"
                ? "Actif : clôture et règlement automatiques 90 s après le coup de sifflet final officiel."
                : "Actif : suspension automatique à la 90e et validation finale par l'administrateur en 1 clic."}
            </p>
          </div>

          {realBanner && (
            <div
              className={cn(
                "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[10.5px] font-medium",
                realBanner.kind === "ok"
                  ? "bg-emerald-600/12 text-emerald-800"
                  : realBanner.kind === "info"
                    ? "bg-amber-500/12 text-amber-900"
                    : "bg-betclic-red/12 text-betclic-red"
              )}
            >
              <span>{realBanner.msg}</span>
              <button
                type="button"
                onClick={() => setRealBanner(null)}
                className="shrink-0 opacity-70"
                aria-label="Fermer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-elev/70 px-3 py-2 text-[10.5px] text-mist">
          <span>
            <strong className="font-display font-medium text-ink">Simulateur 10 min :</strong> 4
            matchs en direct simultanés (canaux décalés), 100 % séparés des matchs réels.
          </span>
          <button
            type="button"
            onClick={onOpenForecasts}
            className="shrink-0 rounded-full bg-betclic-red/12 px-2.5 py-1 font-display text-[10px] font-medium text-betclic-red"
          >
            Scores prévus →
          </button>
        </div>
      )}

      {/* Catalogue officiel 1 clic (Auto-Sync) réservé aux matchs réels */}
      {isReal && (
        <OfficialFixtureImporter
          open={importerOpen}
          setOpen={setImporterOpen}
          onReload={onReload}
        />
      )}

      {/* Tiroir de création manuelle réservé aux matchs réels */}
      {isReal && (
      <div className="glass-card overflow-hidden rounded-2xl">
        <button
          type="button"
          onClick={() => setFormOpen((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <span className="flex items-center gap-2 font-display text-[11.5px] font-medium text-ink">
            <Plus className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
            Créer un match réel manuellement
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
                showClubCrest
                onChange={(v, logo) =>
                  setForm({
                    ...form,
                    home: v,
                    homeLogo:
                      typeof logo === "string" && logo !== ""
                        ? logo
                        : (teamLogo(v) ?? ""),
                  })
                }
                options={clubOptions
                  .filter((name) => name !== form.away)
                  .map((name) => ({
                    label: name,
                    logo: activeLeague
                      ? (activeLeague.clubs.find((c) => c.name === name)?.logo ?? teamLogo(name))
                      : teamLogo(name),
                  }))}
              />
              <ComboBox
                label="Extérieur"
                placeholder="Équipe extérieure"
                value={form.away}
                showClubCrest
                onChange={(v, logo) =>
                  setForm({
                    ...form,
                    away: v,
                    awayLogo:
                      typeof logo === "string" && logo !== ""
                        ? logo
                        : (teamLogo(v) ?? ""),
                  })
                }
                options={clubOptions
                  .filter((name) => name !== form.home)
                  .map((name) => ({
                    label: name,
                    logo: activeLeague
                      ? (activeLeague.clubs.find((c) => c.name === name)?.logo ?? teamLogo(name))
                      : teamLogo(name),
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
                <span className="mb-1 block text-[10px] font-medium text-mist">Statut initial</span>
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
                          "h-9 rounded-lg font-display text-[10.5px] transition-colors",
                          active ? "bg-ink font-medium text-white" : "font-medium text-mist"
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
                label="Cote V1"
                value={form.oddsHome}
                onChange={(v) => setForm({ ...form, oddsHome: v })}
              />
              <AdminInput
                label="Cote X"
                value={form.oddsDraw}
                onChange={(v) => setForm({ ...form, oddsDraw: v })}
              />
              <AdminInput
                label="Cote V2"
                value={form.oddsAway}
                onChange={(v) => setForm({ ...form, oddsAway: v })}
              />
            </div>

            {/* Logos optionnels */}
            <div className="mt-2.5 overflow-hidden rounded-xl border border-edge bg-elev/40">
              <button
                type="button"
                onClick={() => setOpenLogos((s) => !s)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[10.5px] font-medium text-mist"
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
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[10.5px] font-medium text-mist"
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
                      <p className="text-[10.5px] font-medium text-ink">{g.label}</p>
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
                            className="h-10 w-full rounded-lg border border-edge bg-elev/60 px-2 text-center text-[12.5px] font-medium tabular-nums text-ink outline-none focus:border-ink"
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
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 font-display text-[11.5px] font-medium text-white disabled:opacity-55"
            >
              {busy["add-match"] ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" strokeWidth={2.2} />
              )}
              Publier le match réel
            </button>
          </form>
        )}
      </div>
      )}

      <div className="flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={matchQuery}
          onChange={(e) => setMatchQuery(e.target.value)}
          placeholder={
            isReal
              ? "Rechercher un match réel ou une compétition…"
              : "Rechercher un match virtuel…"
          }
          className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-dim"
        />
        {matchQuery && (
          <button type="button" onClick={() => setMatchQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] lg:top-[60px] -my-3"
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
        resultCountText={`${filteredMatches.length} match${filteredMatches.length > 1 ? "s" : ""} ${
          isReal ? "réel" : "virtuel"
        }${filteredMatches.length > 1 ? "s" : ""}`}
      />

      {filteredMatches.length === 0 ? (
        <div className="glass-card rounded-2xl p-5 text-center text-[11px] text-mist">
          {isReal && realMatches.length === 0
            ? "Aucun match réel créé pour l'instant. Importez une affiche officielle en 1 clic ci-dessus ou créez une rencontre manuelle."
            : "Aucun match dans cette sélection."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
            {pagedMatches.map((m) => (
              <AdminMatchCard
                key={m.id}
                m={m}
                nowTs={nowTs}
                forecast={!isReal ? forecasts[m.id] : undefined}
                onOpenForecasts={onOpenForecasts}
                busy={busy}
                act={act}
              />
            ))}
          </div>
          <InfiniteScrollSentinel
            hasMore={matchesBatch.hasMore}
            isLoadingMore={matchesBatch.isLoadingMore}
            onLoadMore={matchesBatch.loadMore}
          />
        </>
      )}
    </div>
  );
}

function OfficialFixtureImporter({
  open,
  setOpen,
  onReload,
}: {
  open: boolean;
  setOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  onReload: () => Promise<void>;
}) {
  const [leagueSlug, setLeagueSlug] = useState<string>("all");
  const [daysAhead, setDaysAhead] = useState<number>(7);
  const [loading, setLoading] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<DiscoveredOfficialFixture[] | null>(null);
  const [reachable, setReachable] = useState<boolean>(true);
  const [extendedWindow, setExtendedWindow] = useState<boolean>(false);
  const [oddsEdits, setOddsEdits] = useState<
    Record<string, { o1: string; oN: string; o2: string }>
  >({});
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null
  );
  const autoLoadedRef = useRef(false);

  const loadFixtures = useCallback(async (slug: string, days: number) => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "discoverRealMatches",
          leagueSlug: slug,
          daysAhead: days,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        reachable?: boolean;
        extendedWindow?: boolean;
        fixtures?: DiscoveredOfficialFixture[];
      };
      if (!res.ok) throw new Error(data.error ?? "Impossible de charger le calendrier");
      const list = data.fixtures ?? [];
      setFixtures(list);
      setReachable(data.reachable !== false);
      setExtendedWindow(Boolean(data.extendedWindow));
      const nextEdits: Record<string, { o1: string; oN: string; o2: string }> = {};
      for (const f of list) {
        nextEdits[f.externalId] = {
          o1: String(f.oddsHome),
          oN: String(f.oddsDraw),
          o2: String(f.oddsAway),
        };
      }
      setOddsEdits(nextEdits);
    } catch (e) {
      setFeedback({
        kind: "err",
        msg: e instanceof Error ? e.message : "Erreur de connexion au calendrier officiel",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    const t = setTimeout(() => {
      void loadFixtures("all", 7);
    }, 0);
    return () => clearTimeout(t);
  }, [open, loadFixtures]);

  const importItems = async (items: DiscoveredOfficialFixture[], key: string) => {
    if (items.length === 0) return;
    setImportingKey(key);
    setFeedback(null);
    try {
      const payloadFixtures = items.map((f) => {
        const ed = oddsEdits[f.externalId];
        return {
          ...f,
          oddsHome: ed ? ed.o1 : f.oddsHome,
          oddsDraw: ed ? ed.oN : f.oddsDraw,
          oddsAway: ed ? ed.o2 : f.oddsAway,
        };
      });
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "importRealMatches",
          fixtures: payloadFixtures,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        importedCount?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "Échec de l'importation");
      const importedSet = new Set(items.map((x) => x.externalId));
      setFixtures((prev) =>
        prev
          ? prev.map((f) =>
              importedSet.has(f.externalId) ? { ...f, alreadyImported: true } : f
            )
          : prev
      );
      setFeedback({
        kind: "ok",
        msg: `${data.importedCount ?? items.length} match(s) officiel(s) importé(s) avec Auto-Sync actif`,
      });
      await onReload();
    } catch (e) {
      setFeedback({
        kind: "err",
        msg: e instanceof Error ? e.message : "Erreur d'importation",
      });
    } finally {
      setImportingKey(null);
    }
  };

  const availableToImport = (fixtures ?? []).filter((f) => !f.alreadyImported);

  return (
    <div className="glass-card overflow-hidden rounded-2xl border-emerald-600/25">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && fixtures === null && !loading) {
            void loadFixtures(leagueSlug, daysAhead);
          }
        }}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CalendarPlus className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.4} />
          <div className="min-w-0">
            <p className="truncate font-display text-[11.5px] font-medium text-ink">
              Importer du calendrier officiel (1 clic)
            </p>
            <p className="truncate text-[10px] text-mist">
              Liaison ID officielle · Scores live, MT, buteurs et stats automatiques
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-dim transition-transform", open && "rotate-180")}
          strokeWidth={2.2}
        />
      </button>

      {open && (
        <div className="border-t border-edge p-3.5 space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <select
              value={leagueSlug}
              onChange={(e) => {
                const next = e.target.value;
                setLeagueSlug(next);
                void loadFixtures(next, daysAhead);
              }}
              className="h-10 w-full rounded-xl border border-edge bg-white px-3 text-[11px] font-medium text-ink outline-none focus:border-emerald-600"
            >
              <option value="all">Toutes les grandes compétitions</option>
              {OFFICIAL_SOCCER_LEAGUES.map((lg) => (
                <option key={lg.slug} value={lg.slug}>
                  {lg.label} ({lg.country})
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 rounded-xl border border-edge bg-elev p-1">
              {[
                { d: 1, label: "24h" },
                { d: 3, label: "3 j" },
                { d: 7, label: "7 j" },
                { d: 14, label: "14 j" },
              ].map(({ d, label }) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDaysAhead(d);
                    void loadFixtures(leagueSlug, d);
                  }}
                  className={cn(
                    "h-8 rounded-lg px-2.5 font-display text-[10.5px] transition-colors",
                    daysAhead === d
                      ? "bg-ink font-medium text-white"
                      : "font-medium text-mist"
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadFixtures(leagueSlug, daysAhead)}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white text-ink shadow-2xs disabled:opacity-50"
                title="Actualiser le calendrier"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
            </div>
          </div>

          {feedback && (
            <div
              className={cn(
                "rounded-xl px-3 py-2 text-[10.5px] font-medium",
                feedback.kind === "ok"
                  ? "bg-emerald-600/12 text-emerald-800"
                  : "bg-betclic-red/12 text-betclic-red"
              )}
            >
              {feedback.msg}
            </div>
          )}

          {extendedWindow && !loading && fixtures && fixtures.length > 0 && (
            <div className="rounded-xl bg-amber-500/12 px-3 py-2 text-[10px] font-medium text-amber-900">
              Aucune rencontre dans le filtre court — prochaines journées officielles chargées automatiquement.
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-mist">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
              Recherche des rencontres officielles…
            </div>
          ) : fixtures && fixtures.length === 0 ? (
            <div className="rounded-xl bg-elev/70 p-4 text-center text-[10.5px] text-mist">
              {!reachable
                ? "Le flux sportif officiel est momentanément indisponible. Appuyez sur Actualiser pour réessayer."
                : "Aucune affiche programmée actuellement pour cette compétition (hors saison ou trêve). Choisissez « Toutes les grandes compétitions » ou un horizon de 14 jours."}
            </div>
          ) : fixtures ? (
            <div className="space-y-2">
              {availableToImport.length > 1 && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-600/8 px-3 py-2">
                  <span className="text-[10.5px] font-medium text-emerald-900">
                    {availableToImport.length} affiche(s) disponible(s)
                  </span>
                  <button
                    type="button"
                    disabled={importingKey !== null}
                    onClick={() =>
                      void importItems(availableToImport.slice(0, 15), "bulk")
                    }
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 font-display text-[10px] font-medium text-white disabled:opacity-50"
                  >
                    {importingKey === "bulk"
                      ? "Importation…"
                      : `Importer ${Math.min(15, availableToImport.length)} matchs`}
                  </button>
                </div>
              )}

              <div className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto pr-0.5 xl:grid-cols-2">
                {fixtures.map((f) => {
                  const ed = oddsEdits[f.externalId] ?? {
                    o1: String(f.oddsHome),
                    oN: String(f.oddsDraw),
                    o2: String(f.oddsAway),
                  };
                  return (
                    <div
                      key={f.externalId}
                      className="rounded-xl border border-edge bg-white p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex shrink-0 -space-x-1.5">
                            <LogoOrAvatar logo={f.homeLogo} name={f.homeTeam} />
                            <LogoOrAvatar logo={f.awayLogo} name={f.awayTeam} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-display text-[11px] font-medium text-ink">
                              {f.homeTeam} – {f.awayTeam}
                            </p>
                            <p className="truncate text-[10px] text-mist">
                              {f.leagueLabel} ·{" "}
                              {f.status === "live"
                                ? `En direct ${f.minute ?? ""} (${f.homeScore ?? 0}-${f.awayScore ?? 0})`
                                : formatKickoff(new Date(f.startsAt))}
                            </p>
                          </div>
                        </div>

                        {f.alreadyImported ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600/12 px-2.5 py-1 font-display text-[10px] font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Importé
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={importingKey !== null}
                            onClick={() => void importItems([f], f.externalId)}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 font-display text-[10px] font-medium text-white active:scale-95 disabled:opacity-50"
                          >
                            {importingKey === f.externalId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" strokeWidth={2.5} />
                            )}
                            Importer
                          </button>
                        )}
                      </div>

                      {!f.alreadyImported && (
                        <div className="grid grid-cols-3 gap-1.5">
                          {(
                            [
                              { k: "o1" as const, lbl: "V1" },
                              { k: "oN" as const, lbl: "X" },
                              { k: "o2" as const, lbl: "V2" },
                            ] as const
                          ).map(({ k, lbl }) => (
                            <label
                              key={k}
                              className="flex h-8 items-center justify-between rounded-lg border border-edge bg-elev/50 px-2 text-[10px]"
                            >
                              <span className="font-display font-medium text-dim">{lbl}</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={ed[k]}
                                onChange={(e) =>
                                  setOddsEdits((prev) => ({
                                    ...prev,
                                    [f.externalId]: {
                                      ...ed,
                                      [k]: e.target.value,
                                    },
                                  }))
                                }
                                className="w-12 bg-transparent text-right font-display text-[11px] font-medium tabular-nums text-ink outline-none"
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AdminMatchCard({
  m,
  nowTs,
  forecast,
  onOpenForecasts,
  busy,
  act,
}: {
  m: AdminMatch;
  nowTs: number;
  forecast?: AdminMatchForecast;
  onOpenForecasts: () => void;
  busy: Record<string, boolean>;
  act: (p: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
}) {
  const isManual = m.source === "manual";
  const hasExternalLink = isManual && Boolean(m.externalId);
  const autoSyncActive = hasExternalLink && m.autoSync !== false;
  const [editingOdds, setEditingOdds] = useState(false);
  const [o1, setO1] = useState(String(m.oddsHome));
  const [oN, setON] = useState(String(m.oddsDraw ?? 3.2));
  const [o2, setO2] = useState(String(m.oddsAway));

  const kickoffReached =
    isManual &&
    m.status === "upcoming" &&
    nowTs > 0 &&
    new Date(m.startsAt).getTime() <= nowTs;

  const isPendingAdminFt =
    isManual &&
    m.status !== "finished" &&
    (m.minute === "Fin (à valider)" ||
      m.feedStatusNote === "PENDING_ADMIN_FT" ||
      Boolean(m.feedStatusNote?.startsWith("PENDING_FT_CONFIRM:")));

  const isPostponedAlert =
    isManual &&
    m.status !== "finished" &&
    (m.minute === "Reporté" || Boolean(m.feedStatusNote?.startsWith("POSTPONED:")));

  const cleanFeedNote =
    isManual &&
    m.feedStatusNote &&
    m.feedStatusNote !== "VOIDED" &&
    m.feedStatusNote !== "ADMIN_CONFIRMED_FT"
      ? m.feedStatusNote.replace(/^(PENDING_FT_CONFIRM|POSTPONED|ANTI_VAR_CHECK):\s*/, "")
      : null;

  const effHtH = m.htHomeScore ?? m.realStats?.htHomeScore ?? null;
  const effHtA = m.htAwayScore ?? m.realStats?.htAwayScore ?? null;

  return (
    <div className={cn("glass-card rounded-2xl p-3.5", m.suspended && "opacity-75")}>
      <div className="flex items-center gap-2.5">
        <div className="flex shrink-0 -space-x-2">
          <LogoOrAvatar logo={m.homeLogo} name={m.homeTeam} />
          <LogoOrAvatar logo={m.awayLogo} name={m.awayTeam} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-display text-[11.5px] font-medium text-ink">
              {m.homeTeam} – {m.awayTeam}
            </p>
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9.5px] font-medium uppercase",
                isManual ? "bg-emerald-600 text-white" : "bg-elev text-mist"
              )}
            >
              {isManual ? "Réel" : "Virtuel 2-3m"}
            </span>
            {isManual && (
              hasExternalLink ? (
                <button
                  type="button"
                  disabled={busy[`as-${m.id}`]}
                  onClick={() =>
                    act(
                      {
                        action: "toggleAutoSync",
                        matchId: m.id,
                        autoSync: !autoSyncActive,
                      },
                      `as-${m.id}`,
                      !autoSyncActive
                        ? "Auto-Sync officiel réactivé"
                        : "Auto-Sync mis en pause (pilotage manuel)"
                    )
                  }
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9.5px] font-medium",
                    autoSyncActive
                      ? "bg-emerald-600/14 text-emerald-700"
                      : "bg-amber-500/15 text-amber-800"
                  )}
                  title="Activer ou mettre en pause la synchronisation automatique"
                >
                  {autoSyncActive ? "⚡ Auto-Sync" : "⏸ Sync pause"}
                </button>
              ) : (
                <span className="shrink-0 rounded-md bg-elev px-1.5 py-0.5 font-display text-[9.5px] font-medium text-dim">
                  Manuel
                </span>
              )
            )}
          </div>
          <p className="truncate text-[10.5px] tabular-nums text-mist">
            {m.league} ·{" "}
            {m.status === "live" ? (
              <>
                Direct{" "}
                <LiveMatchClock match={m} fallback={m.minute ?? "LIVE"} />
              </>
            ) : m.status === "finished"
                ? m.feedStatusNote === "VOIDED"
                  ? "Annulé / Remboursé"
                  : "Terminé"
                : formatKickoff(new Date(m.startsAt))}
            {m.homeScore != null && ` · ${m.homeScore}-${m.awayScore}`}
            {effHtH != null && effHtA != null && ` (MT ${effHtH}-${effHtA})`}
          </p>
          {cleanFeedNote && (
            <p className="truncate text-[10px] font-medium text-emerald-700">
              {cleanFeedNote}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isManual && m.status !== "finished" && (
            <button
              type="button"
              disabled={busy[`sync-${m.id}`]}
              onClick={() =>
                act(
                  { action: "syncRealMatch", matchId: m.id },
                  `sync-${m.id}`,
                  "Match synchronisé avec le flux officiel"
                )
              }
              className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600/12 text-emerald-700 active:scale-95 disabled:opacity-50"
              title="Synchroniser maintenant avec le flux officiel"
            >
              <RefreshCw
                className={cn("h-4 w-4", busy[`sync-${m.id}`] && "animate-spin")}
                strokeWidth={2.2}
              />
            </button>
          )}
          <Toggle
            checked={!m.suspended}
            onChange={(v) =>
              act(
                { action: "toggleMatch", matchId: m.id, suspended: !v },
                `tg-${m.id}`,
                v ? "Marchés réactivés" : "Marchés suspendus"
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

      {/* Résumé compact des vraies statistiques officielles captées */}
      {isManual && m.realStats && m.realStats.possessionHome != null && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-emerald-600/6 px-2.5 py-1.5 text-[10px] font-medium text-mist">
          <span>
            Poss.{" "}
            <strong className="text-ink">
              {Math.round(m.realStats.possessionHome)}%-{Math.round(m.realStats.possessionAway ?? 0)}%
            </strong>
          </span>
          {m.realStats.shotsOnTargetHome != null && (
            <span>
              Cadrés{" "}
              <strong className="text-ink">
                {m.realStats.shotsOnTargetHome}-{m.realStats.shotsOnTargetAway ?? 0}
              </strong>
            </span>
          )}
          {m.realStats.cornersHome != null && (
            <span>
              Corners{" "}
              <strong className="text-ink">
                {m.realStats.cornersHome}-{m.realStats.cornersAway ?? 0}
              </strong>
            </span>
          )}
        </div>
      )}

      {/* Confirmation finale 1-clic en cas de fin de match détectée */}
      {isPendingAdminFt && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-[10px] text-emerald-950">
          <span>
            <strong>Fin du match détectée ({m.homeScore ?? 0}–{m.awayScore ?? 0})</strong>
            {effHtH != null && effHtA != null ? ` · MT ${effHtH}-${effHtA}` : ""} — marchés verrouillés.
          </span>
          <button
            type="button"
            disabled={busy[`fin-${m.id}`]}
            onClick={() =>
              act(
                {
                  action: "finishMatch",
                  matchId: m.id,
                  homeScore: m.homeScore ?? 0,
                  awayScore: m.awayScore ?? 0,
                  ...(effHtH != null && effHtA != null
                    ? { htHomeScore: effHtH, htAwayScore: effHtA }
                    : {}),
                },
                `fin-${m.id}`,
                "Résultat officiel confirmé et paris réglés"
              )
            }
            className="rounded-lg bg-emerald-600 px-3 py-1 font-display text-[10px] font-medium text-white disabled:opacity-50"
          >
            Confirmer &amp; régler
          </button>
        </div>
      )}

      {/* Alerte match reporté / annulé */}
      {isPostponedAlert && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/12 px-3 py-2 text-[10px] text-amber-900">
          <span>
            <strong>Match reporté / interrompu détecté</strong> — paris suspendus automatiquement.
          </span>
          <button
            type="button"
            disabled={busy[`void-${m.id}`]}
            onClick={() =>
              act(
                { action: "voidMatch", matchId: m.id },
                `void-${m.id}`,
                "Match annulé — mises simples remboursées et sélections combinées annulées (cote 1.00)"
              )
            }
            className="rounded-lg bg-amber-700 px-2.5 py-1 font-display text-[10px] font-medium text-white disabled:opacity-50"
          >
            Annuler &amp; rembourser
          </button>
        </div>
      )}

      {kickoffReached && !autoSyncActive && (
        <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-500/12 px-2.5 py-1.5 text-[10px] font-medium text-amber-800">
          <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
          <span>
            Coup d&apos;envoi officiel atteint — paris pré-match verrouillés. Passez en direct ou
            réglez le score final.
          </span>
        </div>
      )}

      {/* Aperçu direct du score final prévu — réservé aux matchs virtuels uniquement */}
      {!isManual && m.status !== "finished" && forecast && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-edge bg-elev/60 px-2.5 py-1.5 text-[10.5px]">
          <div className="flex min-w-0 items-center gap-1.5">
            {forecast.isLocked ? (
              <Lock className="h-3.5 w-3.5 shrink-0 text-win" strokeWidth={2.4} />
            ) : (
              <Eye className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
            )}
            <span className="truncate font-medium text-mist">
              Score final prévu :{" "}
              <strong className="font-display font-medium tabular-nums text-ink">
                {forecast.finalHomeScore} – {forecast.finalAwayScore}
              </strong>{" "}
              <span className="text-[10px] text-dim">
                (MT {forecast.htHomeScore}-{forecast.htAwayScore})
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenForecasts}
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-display text-[9.5px] font-medium",
              forecast.isLocked
                ? "bg-win/12 text-win"
                : "bg-betclic-red/10 text-betclic-red"
            )}
          >
            {forecast.isLocked ? "Figé 100 % →" : "Dynamique →"}
          </button>
        </div>
      )}

      {/* Cotes 1x2 (V1 / X / V2) actuelles + édition rapide */}
      {m.status !== "finished" && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-dim">
          <span>
            V1: <strong className="text-ink">{formatOdds(m.oddsHome)}</strong> · X:{" "}
            <strong className="text-ink">{formatOdds(m.oddsDraw ?? 3.2)}</strong> · V2:{" "}
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
            className="rounded-md bg-elev px-2 py-0.5 font-display text-[10px] font-medium text-ink"
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
            placeholder="V1"
            className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-white px-2 text-center font-display text-[11.5px] font-medium text-ink"
          />
          <input
            type="text"
            inputMode="decimal"
            value={oN}
            onChange={(e) => setON(e.target.value)}
            placeholder="X"
            className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-white px-2 text-center font-display text-[11.5px] font-medium text-ink"
          />
          <input
            type="text"
            inputMode="decimal"
            value={o2}
            onChange={(e) => setO2(e.target.value)}
            placeholder="V2"
            className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-white px-2 text-center font-display text-[11.5px] font-medium text-ink"
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
            className="h-9 shrink-0 rounded-lg bg-betclic-red px-3 font-display text-[10.5px] font-medium text-white disabled:opacity-50"
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
  const isManual = m.source === "manual";
  const isAutoSynced = isManual && Boolean(m.externalId) && m.autoSync !== false;
  const [homeEdit, setHomeEdit] = useState<{ base: number | null; val: string } | null>(null);
  const [awayEdit, setAwayEdit] = useState<{ base: number | null; val: string } | null>(null);
  const [mp, setMp] = useState("");
  const [directSettleOpen, setDirectSettleOpen] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [htHome, setHtHome] = useState("");
  const [htAway, setHtAway] = useState("");

  const home = homeEdit && homeEdit.base === m.homeScore ? homeEdit.val : String(m.homeScore ?? 0);
  const away = awayEdit && awayEdit.base === m.awayScore ? awayEdit.val : String(m.awayScore ?? 0);
  const setHome = (v: string) => setHomeEdit({ base: m.homeScore, val: v });
  const setAway = (v: string) => setAwayEdit({ base: m.awayScore, val: v });

  if (m.status === "upcoming") {
    return (
      <div className="mt-3 border-t border-edge pt-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-dim">
            {isAutoSynced
              ? "Démarrage & stats live automatiques au coup d'envoi"
              : isManual
                ? "Pilotage opérateur (aucun démarrage simulé)"
                : "Démarrage séquentiel automatique"}
          </span>
          <div className="flex items-center gap-1.5">
            {isManual && (
              <button
                type="button"
                onClick={() => setConfirmVoid((s) => !s)}
                className="flex h-8 items-center rounded-lg bg-amber-500/12 px-2 font-display text-[10px] font-medium text-amber-800"
              >
                {confirmVoid ? "Garder" : "Annuler"}
              </button>
            )}
            {isManual && (
              <button
                type="button"
                onClick={() => setDirectSettleOpen((s) => !s)}
                className="flex h-8 items-center gap-1 rounded-lg bg-elev px-2.5 font-display text-[10px] font-medium text-ink"
              >
                <Flag className="h-3 w-3 text-emerald-600" strokeWidth={2.3} />
                {directSettleOpen ? "Fermer" : "Régler score"}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                act(
                  { action: "startMatch", matchId: m.id },
                  `start-${m.id}`,
                  isManual
                    ? "Match réel passé en direct (sans affecter les autres matchs)"
                    : "Match virtuel lancé en direct"
                )
              }
              disabled={busy[`start-${m.id}`]}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 font-display text-[10.5px] font-medium text-white disabled:opacity-60",
                isManual ? "bg-emerald-600" : "bg-betclic-red"
              )}
            >
              {busy[`start-${m.id}`] ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" strokeWidth={2.4} />
              )}
              {isManual ? "Passer en direct" : "Lancer en direct"}
            </button>
          </div>
        </div>

        {isManual && confirmVoid && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-500/12 px-3 py-2 text-[10px] text-amber-900">
            <span>Rembourser les paris simples et annuler (1.00) dans les combinés ?</span>
            <button
              type="button"
              disabled={busy[`void-${m.id}`]}
              onClick={async () => {
                const ok = await act(
                  { action: "voidMatch", matchId: m.id },
                  `void-${m.id}`,
                  "Match annulé et paris remboursés"
                );
                if (ok) setConfirmVoid(false);
              }}
              className="shrink-0 rounded-lg bg-amber-700 px-2.5 py-1 font-display text-[10px] font-medium text-white disabled:opacity-50"
            >
              Confirmer l&apos;annulation
            </button>
          </div>
        )}

        {/* Règlement direct d'un match réel sans passer par le live */}
        {isManual && directSettleOpen && (
          <div className="rounded-xl bg-elev/70 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-ink">Score final officiel :</span>
              <div className="flex items-center gap-1">
                <input
                  inputMode="numeric"
                  value={home}
                  onChange={(e) => setHome(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  className="h-8 w-10 rounded-lg border border-edge bg-white text-center font-display text-[11.5px] font-medium text-ink"
                />
                <span className="text-dim">–</span>
                <input
                  inputMode="numeric"
                  value={away}
                  onChange={(e) => setAway(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  className="h-8 w-10 rounded-lg border border-edge bg-white text-center font-display text-[11.5px] font-medium text-ink"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-mist">Mi-temps (optionnel) :</span>
              <div className="flex items-center gap-1">
                <input
                  inputMode="numeric"
                  value={htHome}
                  onChange={(e) => setHtHome(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="MT"
                  className="h-7 w-10 rounded-lg border border-edge bg-white text-center font-display text-[10.5px] font-medium text-ink"
                />
                <span className="text-dim">–</span>
                <input
                  inputMode="numeric"
                  value={htAway}
                  onChange={(e) => setHtAway(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="MT"
                  className="h-7 w-10 rounded-lg border border-edge bg-white text-center font-display text-[10.5px] font-medium text-ink"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={busy[`fin-${m.id}`]}
              onClick={async () => {
                const hasHt = htHome.trim() !== "" && htAway.trim() !== "";
                const ok = await act(
                  {
                    action: "finishMatch",
                    matchId: m.id,
                    homeScore: Number(home) || 0,
                    awayScore: Number(away) || 0,
                    ...(hasHt
                      ? { htHomeScore: Number(htHome), htAwayScore: Number(htAway) }
                      : {}),
                  },
                  `fin-${m.id}`,
                  "Match réel clôturé et paris réglés"
                );
                if (ok) setDirectSettleOpen(false);
              }}
              className="flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 font-display text-[10.5px] font-medium text-white disabled:opacity-60"
            >
              {busy[`fin-${m.id}`] ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Flag className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              Valider le résultat officiel & régler
            </button>
          </div>
        )}
      </div>
    );
  }

  if (m.status === "finished") {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-edge pt-2.5">
        <span className="text-[10.5px] text-mist">
          Score final : <strong>{m.homeScore}–{m.awayScore}</strong>
        </span>
        <button
          type="button"
          onClick={() =>
            act({ action: "reopenMatch", matchId: m.id }, `reopen-${m.id}`, "Match rouvert")
          }
          disabled={busy[`reopen-${m.id}`]}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-elev px-3 font-display text-[10.5px] font-medium text-ink disabled:opacity-60"
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

  const scoreDirty =
    Number(home || "0") !== (m.homeScore ?? 0) ||
    Number(away || "0") !== (m.awayScore ?? 0);

  return (
    <div className="mt-3 rounded-xl bg-elev/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() =>
            act({ action: "markGoal", matchId: m.id, team: "home" }, `gh-${m.id}`, "But domicile")
          }
          disabled={busy[`gh-${m.id}`]}
          className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-win/30 bg-white text-[10.5px] font-medium text-win active:scale-95 disabled:opacity-60"
        >
          {busy[`gh-${m.id}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Goal className="h-3.5 w-3.5" />}
          +1 Dom.
        </button>

        <div className="flex items-center gap-1">
          <input
            inputMode="numeric"
            value={home}
            onChange={(e) => setHome(e.target.value.replace(/[^\d]/g, ""))}
            className="h-9 w-10 rounded-lg border border-edge bg-white text-center font-display text-[12.5px] font-medium text-ink outline-none focus:border-ink"
          />
          <span className="text-dim">–</span>
          <input
            inputMode="numeric"
            value={away}
            onChange={(e) => setAway(e.target.value.replace(/[^\d]/g, ""))}
            className="h-9 w-10 rounded-lg border border-edge bg-white text-center font-display text-[12.5px] font-medium text-ink outline-none focus:border-ink"
          />
          {isManual && scoreDirty && (
            <button
              type="button"
              disabled={busy[`sc-${m.id}`]}
              onClick={() =>
                act(
                  {
                    action: "setScore",
                    matchId: m.id,
                    homeScore: Number(home) || 0,
                    awayScore: Number(away) || 0,
                  },
                  `sc-${m.id}`,
                  "Score direct mis à jour"
                )
              }
              className="h-9 rounded-lg bg-ink px-2 font-display text-[10px] font-medium text-white"
            >
              MAJ
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() =>
            act({ action: "markGoal", matchId: m.id, team: "away" }, `ga-${m.id}`, "But extérieur")
          }
          disabled={busy[`ga-${m.id}`]}
          className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-win/30 bg-white text-[10.5px] font-medium text-win active:scale-95 disabled:opacity-60"
        >
          {busy[`ga-${m.id}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Goal className="h-3.5 w-3.5" />}
          +1 Ext.
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-mist">Min.</span>
          <input
            type="text"
            value={mp}
            onChange={(e) =>
              setMp(
                isManual
                  ? e.target.value.slice(0, 8)
                  : e.target.value.replace(/[^\d]/g, "")
              )
            }
            placeholder={m.minute ?? "45'"}
            className="h-8 w-16 rounded-lg border border-edge bg-white px-2 text-center text-[11.5px] font-medium text-ink outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={() => {
              const raw = mp.trim();
              const formatted =
                raw.toUpperCase() === "MT" || raw.endsWith("'") ? raw : `${raw || "0"}'`;
              void act(
                { action: "setMinute", matchId: m.id, minute: formatted },
                `min-${m.id}`,
                `Minute ${formatted} enregistrée`
              );
            }}
            disabled={busy[`min-${m.id}`] || !mp.trim()}
            className="h-8 rounded-lg border border-edge bg-white px-2.5 text-[10.5px] font-medium text-ink disabled:opacity-50"
          >
            OK
          </button>
          {isManual && (
            <button
              type="button"
              disabled={busy[`min-mt-${m.id}`]}
              onClick={() =>
                act(
                  { action: "setMinute", matchId: m.id, minute: "MT" },
                  `min-mt-${m.id}`,
                  "Mi-temps affichée"
                )
              }
              className="h-8 rounded-lg border border-edge bg-white px-2 text-[10px] font-medium text-mist active:bg-elev"
            >
              MT
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            const hasHt = isManual && htHome.trim() !== "" && htAway.trim() !== "";
            void act(
              {
                action: "finishMatch",
                matchId: m.id,
                homeScore: Number(home) || 0,
                awayScore: Number(away) || 0,
                ...(hasHt
                  ? { htHomeScore: Number(htHome), htAwayScore: Number(htAway) }
                  : {}),
              },
              `fin-${m.id}`,
              "Match terminé et paris réglés"
            );
          }}
          disabled={busy[`fin-${m.id}`]}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-3 font-display text-[10.5px] font-medium text-white disabled:opacity-60",
            isManual ? "bg-emerald-600" : "bg-betclic-red"
          )}
        >
          {busy[`fin-${m.id}`] ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Flag className="h-3.5 w-3.5" strokeWidth={2.2} />
          )}
          Terminer
        </button>
      </div>

      {isManual && (
        <div className="space-y-1.5 border-t border-edge/60 pt-1.5 text-[10px] text-mist">
          <div className="flex items-center justify-between gap-2">
            <span>
              Score MT officiel{" "}
              {m.htHomeScore != null && m.htAwayScore != null
                ? `(capté : ${m.htHomeScore}-${m.htAwayScore})`
                : "(optionnel)"} :
            </span>
            <div className="flex items-center gap-1">
              <input
                inputMode="numeric"
                value={htHome}
                onChange={(e) => setHtHome(e.target.value.replace(/[^\d]/g, ""))}
                placeholder={m.htHomeScore != null ? String(m.htHomeScore) : "MT"}
                className="h-7 w-9 rounded-md border border-edge bg-white text-center font-display text-[10.5px] font-medium text-ink"
              />
              <span className="text-dim">–</span>
              <input
                inputMode="numeric"
                value={htAway}
                onChange={(e) => setHtAway(e.target.value.replace(/[^\d]/g, ""))}
                placeholder={m.htAwayScore != null ? String(m.htAwayScore) : "MT"}
                className="h-7 w-9 rounded-md border border-edge bg-white text-center font-display text-[10.5px] font-medium text-ink"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span>Match interrompu ou annulé ?</span>
            {confirmVoid ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmVoid(false)}
                  className="rounded-md bg-white px-2 py-0.5 font-medium text-mist ring-1 ring-edge"
                >
                  Non
                </button>
                <button
                  type="button"
                  disabled={busy[`void-${m.id}`]}
                  onClick={() =>
                    act(
                      { action: "voidMatch", matchId: m.id },
                      `void-${m.id}`,
                      "Match annulé et paris remboursés"
                    )
                  }
                  className="rounded-md bg-amber-700 px-2 py-0.5 font-display font-medium text-white"
                >
                  Confirmer remboursement
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmVoid(true)}
                className="font-display font-medium text-amber-800 underline underline-offset-2"
              >
                Annuler &amp; rembourser
              </button>
            )}
          </div>
        </div>
      )}
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

  const questionsBatch = useInfiniteBatch(
    visibleQuestions.length,
    `${qFilter}|${qCategory}|${qFormat}|${qQuery.trim().toLowerCase()}`
  );
  const pagedQuestions = visibleQuestions.slice(0, questionsBatch.visibleCount);

  return (
    <div className="flex flex-col gap-3">
      <div className="glass-card overflow-hidden rounded-2xl">
        <button
          type="button"
          onClick={() => setFormOpen((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <span className="flex items-center gap-2 font-display text-[11.5px] font-medium text-ink">
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
                      "h-8 rounded-lg font-display text-[10.5px] transition-colors",
                      active ? "bg-ink font-medium text-white" : "font-medium text-mist"
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
                  <span className="mb-1 block text-[10px] font-medium text-mist">Catégorie</span>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    aria-label="Catégorie"
                    className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[12.5px] font-medium text-ink outline-none focus:border-ink"
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
                    <span className="mb-1 block text-[10px] font-medium text-mist">Catégorie</span>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      aria-label="Catégorie"
                      className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[12.5px] font-medium text-ink outline-none focus:border-ink"
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
                    <span className="text-[10px] font-medium text-mist">
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
                      className="inline-flex items-center gap-1 rounded-lg bg-elev px-2 py-1 font-display text-[10px] font-medium text-betclic-red"
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
                          className="h-10 min-w-0 flex-1 rounded-xl border border-edge bg-elev/60 px-3 text-[12px] font-medium text-ink outline-none focus:border-ink"
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
                          className="h-10 w-20 shrink-0 rounded-xl border border-edge bg-elev/60 px-2.5 text-center font-display text-[12px] font-medium tabular-nums text-ink outline-none focus:border-ink"
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
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-betclic-red font-display text-[11.5px] font-medium text-white disabled:opacity-55"
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
          className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-dim"
        />
        {qQuery && (
          <button type="button" onClick={() => setQQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] lg:top-[60px] -my-3"
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

      <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
        {pagedQuestions.map((q) => {
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
                        <span className="mb-1 block text-[10px] font-medium text-mist">Catégorie</span>
                        <select
                          value={editForm.category}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          aria-label="Catégorie"
                          className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[12.5px] font-medium text-ink"
                        >
                          <option value="Sport">Sport</option>
                          <option value="Actus">Actus</option>
                          <option value="Crypto">Crypto</option>
                          <option value="Culture">Culture</option>
                        </select>
                      </label>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-mist">Choix & cotes</span>
                          <button
                            type="button"
                            onClick={() =>
                              setEditForm({
                                ...editForm,
                                options: [...(editForm.options ?? []), { label: "", odds: "4.00" }],
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-elev px-2 py-0.5 font-display text-[10px] font-medium text-betclic-red"
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
                              className="h-9 min-w-0 flex-1 rounded-xl border border-edge bg-elev/60 px-2.5 text-[11.5px] font-medium text-ink"
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
                              className="h-9 w-20 shrink-0 rounded-xl border border-edge bg-elev/60 px-2 text-center font-display text-[11.5px] font-medium tabular-nums text-ink"
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
                        <span className="mb-1 block text-[10px] font-medium text-mist">Catégorie</span>
                        <select
                          value={editForm.category}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          aria-label="Catégorie"
                          className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-2.5 text-[12.5px] font-medium text-ink"
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
                      className="h-9 flex-1 rounded-xl bg-betclic-red font-display text-[10.5px] font-medium text-white"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="h-9 rounded-xl bg-elev px-4 font-display text-[10.5px] font-medium text-mist"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-[11.5px] font-medium leading-snug text-ink">
                      {q.question}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 font-display text-[9.5px] font-medium",
                        q.status === "open"
                          ? "bg-betclic-red/10 text-betclic-red"
                          : "bg-elev text-mist"
                      )}
                    >
                      {resolvedLabel}
                    </span>
                  </div>

                  {isMulti && q.options ? (
                    <p className="mt-1 text-[10.5px] leading-relaxed text-dim">
                      {q.category} · {q.options.map((o) => `${o.label} (${formatOdds(o.odds)})`).join(" · ")} · Mises {eur(q.volume)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10.5px] text-dim">
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
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-win/12 px-2.5 font-display text-[10px] font-medium text-win active:opacity-80 disabled:opacity-50"
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
                            className="h-8 flex-1 rounded-lg bg-win/12 font-display text-[10.5px] font-medium text-win disabled:opacity-50"
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
                            className="h-8 flex-1 rounded-lg bg-betclic-red/10 font-display text-[10.5px] font-medium text-betclic-red disabled:opacity-50"
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
                        className="h-8 flex-1 rounded-lg bg-sky-500/12 font-display text-[10.5px] font-medium text-sky-700 disabled:opacity-50"
                      >
                        {busy[`reopen-${q.id}`] ? "..." : "Réouvrir"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(q)}
                      className={cn(
                        "h-8 rounded-lg bg-elev px-3 font-display text-[10.5px] font-medium text-ink",
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
      <InfiniteScrollSentinel
        hasMore={questionsBatch.hasMore}
        isLoadingMore={questionsBatch.isLoadingMore}
        onLoadMore={questionsBatch.loadMore}
      />
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

  const usersBatch = useInfiniteBatch(
    filteredUsers.length,
    `${roleFilter}|${balFilter}|${q}`
  );
  const pagedUsers = filteredUsers.slice(0, usersBatch.visibleCount);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par nom, e-mail ou #id…"
          className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-dim"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] lg:top-[60px] -my-2.5"
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
      <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
      {pagedUsers.map((u) => {
        const uCountry = getCountryConfig(u.countryCode);
        const uCur = getCurrencyConfig(u.currency ?? uCountry.currency).code;
        return (
        <div key={u.id} className="glass-card rounded-2xl p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev font-display text-[10.5px] font-medium text-ink">
                {initials(u.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-[11.5px] font-medium text-ink">
                  {u.name}
                  {u.role === "admin" && (
                    <ShieldCheck
                      className="ml-1 inline h-3.5 w-3.5 text-betclic-red"
                      strokeWidth={2.2}
                    />
                  )}
                </p>
                <p className="truncate text-[10.5px] text-dim">
                  <span>{uCountry.flag} {uCountry.code} · {uCur}</span>
                  {" · "}
                  {u.email ?? "—"}
                </p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-[12px] font-medium tabular-nums text-ink">
                {eurPivot(u.balance)}
              </p>
              {uCur !== "EUR" && (
                <p className="text-[9.5px] tabular-nums text-dim">
                  ≈ {formatEurAsCurrency(u.balance, uCur)}
                </p>
              )}
            </div>
          </div>
          <div className="mt-2.5 flex gap-2">
            <AdminInput
              placeholder="Nouveau solde pivot (€)"
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
              className="h-11 shrink-0 rounded-xl bg-ink px-4 font-display text-[11px] font-medium text-white disabled:opacity-50"
            >
              {busy[`bal-${u.id}`] ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fixer"}
            </button>
          </div>
        </div>
        );
      })}
      </div>
      <InfiniteScrollSentinel
        hasMore={usersBatch.hasMore}
        isLoadingMore={usersBatch.isLoadingMore}
        onLoadMore={usersBatch.loadMore}
      />
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
      kind: "Sport" as const,
      label: `${b.homeTeam} – ${b.awayTeam}`,
      homeTeam: b.homeTeam,
      awayTeam: b.awayTeam,
      homeLogo: b.homeLogo ?? null,
      awayLogo: b.awayLogo ?? null,
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
      kind: "Préd." as const,
      label: p.question,
      homeTeam: null as string | null,
      awayTeam: null as string | null,
      homeLogo: null as string | null,
      awayLogo: null as string | null,
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
      kind: "Combiné" as const,
      label: `Combiné ${c.legs.length} sél. (${c.totalOdds.toFixed(2)})`,
      homeTeam: null as string | null,
      awayTeam: null as string | null,
      homeLogo: null as string | null,
      awayLogo: null as string | null,
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

  const betsBatch = useInfiniteBatch(
    filteredRows.length,
    `${betStatusFilter}|${betKindFilter}|${q}`
  );
  const pagedRows = filteredRows.slice(0, betsBatch.visibleCount);

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
          className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-dim"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterDropdownRow
        className="top-[105px] lg:top-[60px] -my-2.5"
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
                label: "Vendus",
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

      <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
      {pagedRows.map((b) => (
        <div key={`${b.kind}-${b.id}`} className="glass-card rounded-2xl p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {b.homeTeam && b.awayTeam && (
                <div className="flex shrink-0 -space-x-2">
                  <TeamAvatar
                    name={b.homeTeam}
                    logo={b.homeLogo}
                    size="xs"
                    className="ring-1 ring-white"
                  />
                  <TeamAvatar
                    name={b.awayTeam}
                    logo={b.awayLogo}
                    size="xs"
                    className="ring-1 ring-white"
                  />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-display text-[11.5px] font-medium text-ink">{b.label}</p>
                <p className="mt-0.5 truncate text-[10.5px] text-dim">
                  {b.kind} · {b.detail} · {formatPlacedAt(b.placedAt)}
                </p>
                {(b.riskFlag || b.clv != null) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {b.riskFlag && (
                      <span className="rounded-md bg-betclic-red/10 px-1.5 py-0.5 text-[9.5px] font-medium text-betclic-red">
                        {riskLabel(b.riskFlag)}
                      </span>
                    )}
                    {b.clv != null && (
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[9.5px] font-medium",
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
            </div>
            <StatusBadge status={b.status} />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-edge pt-2 text-[10.5px]">
            <span className="text-mist">Mise {eur(b.stake)}</span>
            <span className="font-display font-medium tabular-nums text-ink">→ {eur(b.win)}</span>
          </div>
        </div>
      ))}
      </div>
      <InfiniteScrollSentinel
        hasMore={betsBatch.hasMore}
        isLoadingMore={betsBatch.isLoadingMore}
        onLoadMore={betsBatch.loadMore}
      />
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
  const settledWithdrawals = withdrawals.filter((w) => w.status !== "pending");
  const pendingDeposits = deposits.filter((d) => d.status === "pending_review");
  const settledDeposits = deposits.filter((d) => d.status !== "pending_review");

  const wdHistoryBatch = useInfiniteBatch(settledWithdrawals.length, "wd-history");
  const pagedSettledWithdrawals = settledWithdrawals.slice(
    0,
    wdHistoryBatch.visibleCount
  );

  const depHistoryBatch = useInfiniteBatch(settledDeposits.length, "dep-history");
  const pagedSettledDeposits = settledDeposits.slice(
    0,
    depHistoryBatch.visibleCount
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="glass-card rounded-2xl p-3.5 text-center">
          <p className="text-[10px] font-medium text-dim">Dépôts crédités</p>
          <p className="mt-0.5 font-display text-[14.5px] font-medium tabular-nums text-win">
            {eur(totalDeposits)}
          </p>
        </div>
        <div className="glass-card rounded-2xl p-3.5 text-center">
          <p className="text-[10px] font-medium text-dim">Retraits payés</p>
          <p className="mt-0.5 font-display text-[14.5px] font-medium tabular-nums text-ink">
            {eur(totalWithdrawals)}
          </p>
        </div>
      </div>

      {/* Demandes de dépôt Mobile Money / Virement à valider */}
      <AdminSectionTitle label="Demandes de dépôt à valider" count={pendingDeposits.length} />
      {pendingDeposits.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-white py-4 text-center text-[10.5px] text-dim">
          Aucune demande de dépôt en attente.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendingDeposits.map((d) => {
            const appKey = `d-app-${d.id}`;
            const rejKey = `d-rej-${d.id}`;
            const dCountry = getCountryConfig(d.userCountryCode);
            const dCur = getCurrencyConfig(d.userCurrency ?? d.currency ?? dCountry.currency).code;
            const localLabel = dCur !== "EUR" ? `${formatEurAsCurrency(d.amount, dCur)} (${eurPivot(d.amount)})` : eurPivot(d.amount);
            return (
              <div key={d.id} className="glass-card rounded-2xl p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[11.5px] font-medium text-ink">
                      {dCountry.flag} {d.userName ?? `Joueur #${d.userId ?? 1}`} · +{localLabel}
                    </p>
                    <p className="truncate text-[10.5px] font-medium text-mist">
                      {d.provider === "mobile_money" ? "Mobile Money" : "Virement bancaire"} ·{" "}
                      {d.providerRef ?? "—"}
                    </p>
                    <p className="text-[10px] text-dim">{formatPlacedAt(d.createdAt)}</p>
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
                        `Dépôt de ${localLabel} crédité sur le compte`
                      )
                    }
                    className="h-9 rounded-xl bg-win font-display text-[10.5px] font-medium text-white disabled:opacity-50"
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
                    className="h-9 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[10.5px] font-medium text-betclic-red disabled:opacity-50"
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
        <p className="rounded-2xl border border-edge bg-white py-4 text-center text-[10.5px] text-dim">
          Aucune demande de retrait en attente.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendingWithdrawals.map((w) => {
            const approveKey = `w-app-${w.id}`;
            const rejectKey = `w-rej-${w.id}`;
            const noteVal = wdNotes[w.id] ?? "";
            const wCountry = getCountryConfig(w.userCountryCode);
            const wCur = getCurrencyConfig(w.userCurrency ?? wCountry.currency).code;
            const localLabel = wCur !== "EUR" ? `${formatEurAsCurrency(w.amount, wCur)} (${eurPivot(w.amount)})` : eurPivot(w.amount);
            return (
              <div key={w.id} className="glass-card rounded-2xl p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[11.5px] font-medium text-ink">
                      {wCountry.flag} {w.userName} · {localLabel}
                    </p>
                    <p className="truncate text-[10.5px] font-medium text-mist">
                      {w.method.toUpperCase()} · {w.destination}
                    </p>
                    <p className="text-[10px] text-dim">
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
                  className="mt-2.5 h-9 w-full rounded-xl border border-edge bg-elev/60 px-3 text-[10.5px] text-ink outline-none placeholder:text-dim focus:border-ink focus:bg-white"
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
                        `Retrait de ${localLabel} approuvé`
                      )
                    }
                    className="h-9 rounded-xl bg-win font-display text-[10.5px] font-medium text-white disabled:opacity-50"
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
                        `Retrait refusé et ${localLabel} recrédités`
                      )
                    }
                    className="h-9 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[10.5px] font-medium text-betclic-red disabled:opacity-50"
                  >
                    {busy[rejectKey] ? "Remboursement…" : "Refuser & rembourser"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {settledWithdrawals.length > 0 && (
        <>
          <AdminSectionTitle
            label="Historique des retraits"
            count={settledWithdrawals.length}
          />
          <div className="flex flex-col gap-2">
            {pagedSettledWithdrawals.map((w) => {
                const wCountry = getCountryConfig(w.userCountryCode);
                const wCur = getCurrencyConfig(w.userCurrency ?? wCountry.currency).code;
                const localLabel = wCur !== "EUR" ? `${formatEurAsCurrency(w.amount, wCur)} (${eurPivot(w.amount)})` : eurPivot(w.amount);
                return (
                <div key={w.id} className="glass-card flex items-center gap-3 rounded-2xl p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[11px] font-medium text-ink">
                      {wCountry.flag} {w.userName} · {localLabel} ({w.method.toUpperCase()})
                    </p>
                    <p className="truncate text-[10px] text-dim">
                      {w.destination}
                      {w.adminNote ?? w.note ? ` · ${w.adminNote ?? w.note}` : ""} ·{" "}
                      {formatPlacedAt(w.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={w.status} />
                </div>
                );
              })}
          </div>
          <InfiniteScrollSentinel
            hasMore={wdHistoryBatch.hasMore}
            isLoadingMore={wdHistoryBatch.isLoadingMore}
            onLoadMore={wdHistoryBatch.loadMore}
          />
        </>
      )}

      <AdminSectionTitle label="Dépôts traités" count={settledDeposits.length} />
      {settledDeposits.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-dim">Aucun dépôt enregistré.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-3">
            {pagedSettledDeposits.map((d) => {
              const dCountry = getCountryConfig(d.userCountryCode);
              const dCur = getCurrencyConfig(d.userCurrency ?? d.currency ?? dCountry.currency).code;
              const localLabel = dCur !== "EUR" ? `${formatEurAsCurrency(d.amount, dCur)} (${eurPivot(d.amount)})` : eurPivot(d.amount);
              return (
              <div key={d.id} className="glass-card flex items-center gap-3 rounded-2xl p-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev text-ink">
                  <CircleDollarSign className="h-4 w-4" strokeWidth={2.1} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[11.5px] font-medium text-ink">
                    {dCountry.flag} {d.userName ? `${d.userName} · ` : ""}
                    {d.provider === "mobile_money" ? "Mobile Money" : d.provider} · {localLabel}
                  </p>
                  <p className="truncate text-[10.5px] text-dim">
                    {d.providerRef ? `${d.providerRef} · ` : ""}
                    {formatPlacedAt(d.createdAt)}
                  </p>
                </div>
                <StatusBadge status={d.status} />
              </div>
              );
            })}
          </div>
          <InfiniteScrollSentinel
            hasMore={depHistoryBatch.hasMore}
            isLoadingMore={depHistoryBatch.isLoadingMore}
            onLoadMore={depHistoryBatch.loadMore}
          />
        </>
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
    lost: { label: "Perdu", cls: "bg-betclic-red/12 text-betclic-red font-medium" },
    cashed: { label: "Vendu", cls: "bg-sky-500/12 text-sky-700" },
    void: { label: "Remboursé", cls: "bg-amber-500/12 text-amber-800" },
    paid: { label: "Payé", cls: "bg-win/12 text-win" },
    credited: { label: "Crédité", cls: "bg-win/12 text-win" },
    failed: { label: "Échec", cls: "bg-betclic-red/10 text-betclic-red" },
    expired: { label: "Expiré", cls: "bg-elev text-dim" },
  };
  const s = map[status] ?? { label: status, cls: "bg-elev text-mist" };
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 font-display text-[9.5px] font-medium", s.cls)}>
      {s.label}
    </span>
  );
}

function LogoOrAvatar({ logo, name }: { logo?: string | null; name: string }) {
  return <TeamAvatar name={name} logo={logo} size="sm" className="ring-2 ring-white" />;
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
      {label && <span className="mb-1 block text-[10px] font-medium text-mist">{label}</span>}
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-dim focus:border-ink focus:bg-white"
      />
    </label>
  );
}

function AdminSectionTitle({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <h2 className="font-display text-[10.5px] font-bold uppercase tracking-wider text-mist">
        {label}
      </h2>
      {count != null && <span className="text-[10.5px] font-medium text-dim">{count}</span>}
    </div>
  );
}

function ComboBox({
  label,
  value,
  onChange,
  placeholder,
  options,
  showClubCrest = false,
}: {
  label?: string;
  value: string;
  onChange: (v: string, logo?: string | null) => void;
  placeholder?: string;
  options: Array<{ label: string; hint?: string; logo?: string | null }>;
  showClubCrest?: boolean;
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
      {label && <span className="mb-1 block text-[10px] font-medium text-mist">{label}</span>}
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
        className="h-11 w-full rounded-xl border border-edge bg-elev/60 px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-dim focus:border-ink focus:bg-white"
      />

      {open && options.length > 0 && (
        <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-edge bg-white p-1 shadow-lg">
          {filtered.length === 0 && (
            <p className="px-2.5 py-2 text-[10.5px] text-dim">Aucun résultat</p>
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
              {(showClubCrest || o.logo != null) && (
                <TeamAvatar name={o.label} logo={o.logo} size="2xs" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[11px] font-medium text-ink">
                  {o.label}
                </span>
                {o.hint && <span className="block text-[10px] text-dim">{o.hint}</span>}
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
      <p className="font-display text-[12.5px] font-medium tabular-nums text-ink">{value}</p>
      <p className="text-[10px] font-medium text-dim">{label}</p>
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
      <div className="glass-card rounded-2xl p-6 text-center text-[11px] text-dim">
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
              <h2 className="font-display text-[12px] font-bold text-ink">
                Moteur IA & Machine Learning (4 modèles actifs)
              </h2>
            </div>
            <p className="mt-0.5 text-[10.5px] text-dim">
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
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink px-3.5 font-display text-[10.5px] font-medium text-white transition-opacity disabled:opacity-50"
          >
            {busy["retrain-ml"] ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Ré-entraîner les modèles
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {ml.models.map((m) => (
            <div
              key={m.key}
              className="rounded-xl border border-edge bg-elev/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-display text-[11px] font-medium text-ink">
                  {m.name}
                </span>
                <span className="rounded-full bg-ink/8 px-2 py-0.5 font-display text-[9.5px] font-medium text-ink">
                  v{m.version}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] font-medium text-mist">{m.algorithm}</p>
              <div className="mt-2 flex items-center justify-between border-t border-edge/70 pt-2 text-[10px] tabular-nums">
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
          <h3 className="font-display text-[11.5px] font-bold text-ink">
            1. Poids appris · Détecteur Sharp (Logistic SGD)
          </h3>
          <span className="text-[10px] tabular-nums text-dim">
            Biais b₀ = {ml.sharpBias.toFixed(2)}
          </span>
        </div>
        <div className="mt-2.5 space-y-2">
          {ml.sharpWeights.map((w) => {
            const pct = Math.min(100, Math.max(8, Math.round((w.weight / 2.2) * 100)));
            const delta = w.weight - w.prior;
            return (
              <div key={w.key}>
                <div className="flex items-center justify-between text-[10.5px]">
                  <span className="truncate font-medium text-ink">{w.label}</span>
                  <span className="shrink-0 font-display font-medium tabular-nums text-ink">
                    {w.weight.toFixed(3)}{" "}
                    <span className="text-[9.5px] font-normal text-dim">
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

        <h4 className="mt-4 font-display text-[11px] font-bold text-ink">
          Radar IA des profils joueurs ({ml.playerProfiles.length})
        </h4>
        {ml.playerProfiles.length === 0 ? (
          <p className="mt-1.5 text-[10.5px] text-dim">
            Aucun historique de pari suffisant pour scorer les profils.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {ml.playerProfiles.map((p) => (
              <div
                key={p.userId}
                className="flex flex-col gap-1 rounded-xl border border-edge bg-white p-2.5 text-[10.5px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink">
                    {p.name}{" "}
                    <span className="font-normal text-dim">({p.betsCount} paris)</span>
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-display text-[10px] font-medium tabular-nums",
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
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px] text-dim">
                  <span>Z-Score : <strong className="text-ink">{p.zScore}</strong></span>
                  <span>ROI : <strong className="text-ink">{p.roiPct}%</strong></span>
                  <span>Bouclier : <strong className="text-ink">×{p.riskWeight}</strong></span>
                  <span>Plafond IA : <strong className="text-ink">{p.maxStake} €</strong></span>
                </div>
                <p className="truncate text-[10px] text-mist">
                  Signal dominant : {p.topReason}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modèle 2 : Auto-Calibration Bayésienne des Marchés */}
      <section className="glass-card rounded-2xl p-4">
        <h3 className="font-display text-[11.5px] font-bold text-ink">
          2. Auto-Calibration Bayésienne des Marchés
        </h3>
        <p className="mt-0.5 text-[10.5px] text-dim">
          Ajuste tout seul le multiplicateur de marge si un segment gagne plus souvent que prévu.
        </p>
        {ml.calibratedSegments.length === 0 ? (
          <p className="mt-2 text-[10.5px] text-dim">
            En attente des premiers paris réglés pour calibrer les segments.
          </p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {ml.calibratedSegments.map((s) => (
              <div
                key={s.segment}
                className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-white px-3 py-2 text-[10.5px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {s.market}{" "}
                    <span className="rounded bg-elev px-1.5 py-0.5 text-[9.5px] font-medium uppercase text-mist">
                      {s.bucket}
                    </span>
                  </p>
                  <p className="text-[10px] tabular-nums text-dim">
                    {s.samples} paris · Prédit {s.predWinPct}% vs Réel {s.obsWinPct}%
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-lg px-2 py-1 font-display text-[10px] font-medium tabular-nums",
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
        <h3 className="font-display text-[11.5px] font-bold text-ink">
          3. Forces Dynamiques des Clubs (Glicko-2 Attaque / Défense)
        </h3>
        <p className="mt-0.5 text-[10.5px] text-dim">
          Mis à jour automatiquement après chaque coup de sifflet final.
        </p>
        {ml.clubRatings.length === 0 ? (
          <p className="mt-2 text-[10.5px] text-dim">
            Les ratings apparaissent dès les premiers matchs terminés.
          </p>
        ) : (
          <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {ml.clubRatings.map((c) => (
              <div
                key={c.clubKey}
                className="flex items-center justify-between rounded-xl border border-edge bg-white px-3 py-2 text-[10.5px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium capitalize text-ink">{c.clubKey}</p>
                  <p className="text-[10px] tabular-nums text-dim">
                    {c.matches} m · Att ×{c.attack.toFixed(2)} · Déf ×{c.defense.toFixed(2)} ({c.goalsFor}:{c.goalsAgainst})
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-ink px-2 py-0.5 font-display text-[10px] font-medium tabular-nums text-white">
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

  // Uniquement les matchs virtuels du simulateur (les matchs réels admin n'ont aucun score simulé)
  const openScheduled = matches
    .filter(
      (m) =>
        m.source !== "manual" &&
        (m.status === "upcoming" || m.status === "live") &&
        forecasts[m.id] != null
    )
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

  const forecastsBatch = useInfiniteBatch(
    visible.length,
    `${statusFilter}|${effectiveLeague}|${lockFilter}|${query.trim().toLowerCase()}`
  );
  const pagedForecasts = visible.slice(0, forecastsBatch.visibleCount);

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
          <h2 className="font-display text-[12px] font-bold text-ink">
            Mode des scores anticipés (Avant-match & Direct)
          </h2>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-dim">
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
              <span className="font-display text-[11px] font-medium text-ink">
                Mode 1 · Dynamique + Verrouillage
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-display text-[9.5px] font-medium",
                  scenarioMode === "dynamic"
                    ? "bg-betclic-red text-white"
                    : "bg-elev text-dim"
                )}
              >
                {scenarioMode === "dynamic" ? "Actif" : "Choisir"}
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-mist">
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
              <span className="font-display text-[11px] font-medium text-ink">
                Mode 2 · 100 % Figé d&apos;office
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-display text-[9.5px] font-medium",
                  scenarioMode === "locked"
                    ? "bg-win text-white"
                    : "bg-elev text-dim"
                )}
              >
                {scenarioMode === "locked" ? "Actif" : "Choisir"}
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-mist">
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
          className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-dim"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-dim">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Rangée unique collante de 3 pastilles dropdown */}
      <FilterDropdownRow
        className="top-[105px] lg:top-[60px] -my-3"
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
        <div className="glass-card rounded-2xl p-6 text-center text-[11px] text-dim">
          Aucun match programmé dans ce filtre.
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
          {pagedForecasts.map((m) => {
            const fc = forecasts[m.id];
            if (!fc) return null;
            const rank = upcomingOrderMap.get(m.id);
            const isEditingScore = editingMatchId === m.id;
            const minHome = m.status === "live" ? (m.homeScore ?? 0) : 0;
            const minAway = m.status === "live" ? (m.awayScore ?? 0) : 0;

            return (
              <div key={m.id} className="glass-card rounded-2xl p-3.5">
                {/* En-tête ligue + ordre file + badge Figé/Dynamique */}
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {m.status === "live" ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[9.5px] font-medium tabular-nums text-betclic-red">
                        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                        Direct{" "}
                        <LiveMatchClock
                          match={m}
                          fallback={m.minute ?? "LIVE"}
                        />
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-elev px-2 py-0.5 font-display text-[9.5px] font-medium text-ink">
                        À venir {rank ? `#${rank}` : ""} · {formatKickoff(new Date(m.startsAt))}
                      </span>
                    )}
                    <span className="truncate font-medium text-mist">{m.league}</span>
                  </div>

                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-display text-[9.5px] font-medium",
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
                    <span className="truncate font-display text-[11px] font-medium text-ink">
                      {m.homeTeam}
                    </span>
                  </div>

                  <div className="flex flex-col items-center px-2">
                    <span className="text-[9.5px] font-medium uppercase tracking-wider text-dim">
                      Score final
                    </span>
                    <span className="font-display text-[14.5px] font-medium leading-tight tabular-nums text-ink">
                      {fc.finalHomeScore} – {fc.finalAwayScore}
                    </span>
                    <span className="text-[9.5px] font-medium tabular-nums text-mist">
                      MT {fc.htHomeScore} – {fc.htAwayScore}
                      {m.status === "live" &&
                        ` · Actuel ${m.homeScore ?? 0}-${m.awayScore ?? 0}`}
                    </span>
                  </div>

                  <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                    <span className="truncate font-display text-[11px] font-medium text-ink">
                      {m.awayTeam}
                    </span>
                    <LogoOrAvatar logo={m.awayLogo} name={m.awayTeam} />
                  </div>
                </div>

                {/* Chronologie minute par minute des buts et cartons prévus */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {fc.events.length === 0 ? (
                    <span className="rounded-lg bg-elev/60 px-2.5 py-1 text-[10px] font-medium text-dim">
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
                            "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium",
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
                          <span className="text-[9.5px] opacity-70">
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
                    <p className="text-[10.5px] font-medium text-ink">
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
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[12px] font-medium text-ink active:scale-95"
                        >
                          −
                        </button>
                        <span className="w-7 text-center font-display text-[13.5px] font-medium tabular-nums text-ink">
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
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[12px] font-medium text-ink active:scale-95"
                        >
                          +
                        </button>
                      </div>

                      <span className="font-display text-[11.5px] font-medium text-dim">–</span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setTargetScore((s) => ({
                              ...s,
                              away: Math.max(minAway, s.away - 1),
                            }))
                          }
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[12px] font-medium text-ink active:scale-95"
                        >
                          −
                        </button>
                        <span className="w-7 text-center font-display text-[13.5px] font-medium tabular-nums text-ink">
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
                          className="grid h-8 w-8 place-items-center rounded-lg bg-elev font-display text-[12px] font-medium text-ink active:scale-95"
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
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[10.5px] font-medium text-white disabled:opacity-50"
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
                        className="h-9 rounded-xl bg-elev px-3 font-display text-[10.5px] font-medium text-mist"
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
                      "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl font-display text-[10.5px] font-medium transition-colors disabled:opacity-50",
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
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-elev font-display text-[10.5px] font-medium text-ink transition-colors hover:bg-edge/70 disabled:opacity-50"
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
                      "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl font-display text-[10.5px] font-medium transition-colors",
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
        <InfiniteScrollSentinel
          hasMore={forecastsBatch.hasMore}
          isLoadingMore={forecastsBatch.isLoadingMore}
          onLoadMore={forecastsBatch.loadMore}
        />
        </>
      )}
    </div>
  );
}
