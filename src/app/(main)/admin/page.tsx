"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  HelpCircle,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Trash2,
  Trophy,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { Toggle } from "@/components/toggle";
import { LEAGUES, findLeague } from "@/lib/leagues";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt, initials, teamHue } from "@/lib/format";

type TabKey = "dashboard" | "matches" | "questions" | "users" | "bets" | "deposits";

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
}

interface AdminQuestion {
  id: number;
  question: string;
  category: string;
  status: string;
  resolution: "yes" | "no" | null;
  oddsYes: number;
  oddsNo: number;
  volume: number;
  resolvesAt: string;
}

interface PanelData {
  stats: {
    totalUsers: number;
    totalBets: number;
    sportsBets: number;
    predBets: number;
    deposits: number;
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
  deposits: AdminDeposit[];
  matches: AdminMatch[];
  questions: AdminQuestion[];
}

const TABS: { key: TabKey; label: string; Icon: typeof Trophy }[] = [
  { key: "dashboard", label: "Synthèse", Icon: BarChart3 },
  { key: "matches", label: "Matchs", Icon: Trophy },
  { key: "questions", label: "Pronostics", Icon: HelpCircle },
  { key: "users", label: "Joueurs", Icon: Users },
  { key: "bets", label: "Paris", Icon: Ticket },
  { key: "deposits", label: "Dépôts", Icon: CircleDollarSign },
];

/** Catalogue des marchés éditables (issues avec libellés) pour l'ajout manuel. */
const MARKET_CATALOG: { key: string; label: string; short: string; outcomes: { key: string; label: string; short: string }[] }[] = [
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
      { key: "ou_1_5_over", label: "Plus de 1,5 buts", short: "Plus 1,5" },
      { key: "ou_1_5_under", label: "Moins de 1,5 buts", short: "Moins 1,5" },
      { key: "ou_2_5_over", label: "Plus de 2,5 buts", short: "Plus 2,5" },
      { key: "ou_2_5_under", label: "Moins de 2,5 buts", short: "Moins 2,5" },
      { key: "ou_3_5_over", label: "Plus de 3,5 buts", short: "Plus 3,5" },
      { key: "ou_3_5_under", label: "Moins de 3,5 buts", short: "Moins 3,5" },
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

const fmtEur = (n: number) => eur(n);

export default function AdminPage() {
  const { user } = useApp();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    markets: MARKET_CATALOG.map((m) => ({
      key: m.key,
      label: m.label,
      short: m.short,
      outcomes: m.outcomes.map((o) => ({ key: o.key, label: o.label, short: o.short, odds: "" })),
    })),
  });
  const [questionForm, setQuestionForm] = useState({ question: "", category: "Sport", oddsYes: "1.90", oddsNo: "1.80", hours: "72" });
  const [balanceForm, setBalanceForm] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/admin", { signal: abortRef.current.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setPanel(data);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setNotice({ kind: "err", msg: "Impossible de charger le tableau de bord" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const act = async (payload: Record<string, unknown>, key: string, okMsg: string): Promise<boolean> => {
    setBusy((b) => ({ ...b, [key]: true }));
    setNotice(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setNotice({ kind: "ok", msg: okMsg });
      await load();
      return true;
    } catch (e) {
      setNotice({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
      return false;
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const onAddMatch = async (e: FormEvent) => {
    e.preventDefault();
    const builtMarkets = matchForm.markets
      .map((g) => {
        const outcomes = g.outcomes
          .map((o) => ({ ...o, odds: Number(o.odds) || 0 }))
          .filter((o) => o.odds > 1);
        return outcomes.length > 0 ? { key: g.key, label: g.label, short: g.short, outcomes } : null;
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
        home: "", away: "", league: "Premier League", oddsHome: "1.90", oddsDraw: "3.30", oddsAway: "3.10",
        status: "upcoming", startsAt: "", homeLogo: "", awayLogo: "",
        markets: MARKET_CATALOG.map((m) => ({ key: m.key, label: m.label, short: m.short, outcomes: m.outcomes.map((o) => ({ key: o.key, label: o.label, short: o.short, odds: "" })) })),
      });
    }
  };

  const onAddQuestion = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(
      {
        action: "addQuestion",
        question: questionForm.question,
        category: questionForm.category,
        oddsYes: Number(questionForm.oddsYes),
        oddsNo: Number(questionForm.oddsNo),
        resolvesAt: Number(questionForm.hours),
      },
      "add-q",
      "Pronostic publié"
    );
    if (ok) setQuestionForm({ question: "", category: "Sport", oddsYes: "1.90", oddsNo: "1.80", hours: "72" });
  };

  const stats = panel?.stats;

  return (
    <div className="px-3 pb-24 pt-5">
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              "mb-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] font-medium",
              notice.kind === "ok"
                ? "border-win/30 bg-win/10 text-win"
                : "border-bittersweet/30 bg-bittersweet/10 text-bittersweet"
            )}
          >
            {notice.kind === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
            <span className="flex-1">{notice.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-betclic-red">PULSE ADMIN</p>
          <h1 className="mt-1 font-display text-[30px] font-bold leading-none tracking-tight">Espace admin</h1>
        </div>
        <button
          onClick={() => load()}
          className="glass-card flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold text-mist transition-transform active:scale-95"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={2.4} />
          Actualiser
        </button>
      </div>

      {user?.role !== "admin" && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-bittersweet/30 bg-bittersweet/10 px-3.5 py-3 text-[12.5px] text-bittersweet">
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          Accès réservé au compte administrateur.
        </div>
      )}

      {/* Onglets */}
      <div className="sticky top-12 z-30 -mx-3 mt-5 overflow-x-auto bg-white/90 px-3 pb-0 pt-2 backdrop-blur-xl">
        <div className="flex items-center gap-1">
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "relative flex items-center gap-1.5 whitespace-nowrap px-3.5 pb-2.5 pt-1 transition-colors",
                  active ? "text-foreground" : "text-mist hover:text-dim"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={active ? 2.6 : 2.1} />
                <span className={cn("font-display text-[11.5px]", active && "font-bold")}>{label}</span>
                <motion.span
                  layoutId="admin-tab-underline"
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                  className={cn(
                    "absolute inset-x-2 -bottom-0 h-[2.5px] rounded-full",
                    active ? "bg-betclic-red" : "bg-transparent"
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {loading || !panel ? (
        <Skeletons />
      ) : (
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-4">
          {tab === "dashboard" && <Dashboard stats={stats!} />}
          {tab === "matches" && (
            <MatchesTab matches={panel.matches} busy={busy} act={act} form={matchForm} setForm={setMatchForm} onAdd={onAddMatch} />
          )}
          {tab === "questions" && (
            <QuestionsTab questions={panel.questions} busy={busy} act={act} form={questionForm} setForm={setQuestionForm} onAdd={onAddQuestion} />
          )}
          {tab === "users" && (
            <UsersTab users={panel.users} balanceForm={balanceForm} setBalanceForm={setBalanceForm} busy={busy} act={act} />
          )}
          {tab === "bets" && <BetsTab bets={panel.bets} predBets={panel.predictionBets} />}
          {tab === "deposits" && <DepositsTab deposits={panel.deposits} />}
        </motion.div>
      )}

      <p className="mt-8 text-center text-[10px] leading-relaxed text-dim">
        Espace réservé au compte administrateur · PULSE BETS
      </p>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

function Dashboard({ stats }: { stats: PanelData["stats"] }) {
  const cards: { label: string; value: string; Icon: typeof Trophy; tint?: string }[] = [
    { label: "Joueurs", value: String(stats.totalUsers), Icon: Users, tint: "text-betclic-red" },
    { label: "Paris totaux", value: String(stats.totalBets), Icon: Ticket },
    { label: "En direct", value: String(stats.liveMatches), Icon: Trophy, tint: "text-live" },
    { label: "Pronostics ouverts", value: String(stats.openQuestions), Icon: HelpCircle },
    { label: "Gains versés", value: fmtEur(stats.payouts), Icon: TrendingUp },
    { label: "Volume misé", value: fmtEur(stats.stake), Icon: CircleDollarSign },
  ];
  const revenue = stats.stake - stats.payouts;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="glass-card rounded-2xl p-3.5">
            <c.Icon className={cn("h-4 w-4", c.tint ?? "text-mist")} strokeWidth={2.2} />
            <p className="mt-2 font-display text-[17px] font-bold tabular-nums">{c.value}</p>
            <p className="mt-0.5 text-[10px] font-semibold tracking-[0.16em] text-dim">{c.label.toUpperCase()}</p>
          </div>
        ))}
      </div>

      <section className="mt-3 overflow-hidden rounded-[22px] border border-betclic-red/20 bg-[linear-gradient(135deg,#fef2f2,#fff5f5_55%,#f5f5f5)] p-4">
        <p className="text-[10px] font-semibold tracking-[0.26em] text-mist">SANTÉ DE LA PLATEFORME</p>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="font-display text-[26px] font-bold leading-none tabular-nums">{fmtEur(revenue)}</p>
            <p className="mt-1 text-[12px] text-mist">Marge brute (mises − gains)</p>
          </div>
          <span
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[11px] font-bold",
              revenue >= 0 ? "bg-win/10 text-win" : "bg-bittersweet/10 text-bittersweet"
            )}
          >
            {revenue >= 0 ? "+" : ""}{revenue.toFixed(0)} €
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-elev">
          <div
            className="h-full rounded-full bg-betclic-red"
            style={{ width: `${Math.min(100, Math.max(4, (stats.payouts / (stats.stake || 1)) * 100))}%` }}
          />
        </div>
      </section>

      <section className="mt-3">
        <AdminSectionTitle label="Répartition" />
        <div className="mt-2.5 flex gap-2">
          <StatPill label="Paris sportifs" value={stats.sportsBets} />
          <StatPill label="Pronostics" value={stats.predBets} />
          <StatPill label="Dépôts" value={stats.deposits} />
        </div>
      </section>
    </div>
  );
}

/* ---------------- Matchs ---------------- */

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
  form: {
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
  };
  setForm: (f: typeof form) => void;
  onAdd: (e: FormEvent) => void;
}) {
  const activeLeague = findLeague(form.league);
  const clubOptions = (activeLeague?.clubs ?? []).map((c) => c.name);
  const [openLogos, setOpenLogos] = useState(false);
  const [openMarkets, setOpenMarkets] = useState(false);
  const activeMarkets = form.markets.filter((g) => g.outcomes.some((o) => Number(o.odds) > 1));

  return (
    <div>
      <form onSubmit={onAdd} className="glass-card rounded-[20px] p-3.5">
        <p className="flex items-center gap-1.5 font-display text-[12.5px] font-semibold">
          <Plus className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
          Ajouter un match réel manuellement
        </p>

        {/* Ligue (suggestions) */}
        <div className="mt-3">
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
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <ComboBox
            placeholder="Équipe domicile"
            value={form.home}
            onChange={(v, logo) =>
              setForm({
                ...form,
                home: v,
                homeLogo: typeof logo === "string" && logo !== "" ? logo : form.homeLogo,
              })
            }
            options={clubOptions.map((name) => ({ label: name, logo: activeLeague ? activeLeague.clubs.find((c) => c.name === name)?.logo ?? null : null }))}
          />
          <ComboBox
            placeholder="Équipe extérieure"
            value={form.away}
            onChange={(v, logo) =>
              setForm({
                ...form,
                away: v,
                awayLogo: typeof logo === "string" && logo !== "" ? logo : form.awayLogo,
              })
            }
            options={clubOptions.map((name) => ({ label: name, logo: activeLeague ? activeLeague.clubs.find((c) => c.name === name)?.logo ?? null : null }))}
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <AdminInput label="Date & heure de coup d'envoi" type="datetime-local" value={form.startsAt} onChange={(v) => setForm({ ...form, startsAt: v })} />
          <div className="flex flex-col">
            <span className="mb-1 block text-[10px] font-semibold tracking-[0.14em] text-dim">STATUT</span>
            <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl border border-edge bg-elev p-1">
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
                      "relative rounded-lg py-1.5 font-display text-[11px] transition-colors",
                      active ? "font-bold text-white" : "font-medium text-mist"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="add-match-status"
                        transition={{ type: "spring", stiffness: 480, damping: 38 }}
                        className="absolute inset-0 rounded-lg bg-betclic-red"
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <AdminInput label="Cote domicile" value={form.oddsHome} onChange={(v) => setForm({ ...form, oddsHome: v })} />
          <AdminInput label="Cote nul" value={form.oddsDraw} onChange={(v) => setForm({ ...form, oddsDraw: v })} />
          <AdminInput label="Cote ext." value={form.oddsAway} onChange={(v) => setForm({ ...form, oddsAway: v })} />
        </div>

        {/* Logos (URL) */}
        <div className="mt-2 overflow-hidden rounded-xl border border-edge bg-elev/40">
          <button
            type="button"
            onClick={() => setOpenLogos((s) => !s)}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
          >
            <span className="flex-1 text-[10.5px] font-semibold tracking-[0.14em] text-dim">LOGOS DES ÉQUIPES (URL)</span>
            <span className="text-[10px] text-dim">Auto selon le club</span>
            <motion.span animate={{ rotate: openLogos ? 180 : 0 }} transition={{ duration: 0.18 }} className="text-mist">
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.4} />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {openLogos && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-2 px-2.5 pb-2.5">
                  <AdminInput label="Logo domicile" placeholder="https://…" value={form.homeLogo} onChange={(v) => setForm({ ...form, homeLogo: v })} />
                  <AdminInput label="Logo extérieur" placeholder="https://…" value={form.awayLogo} onChange={(v) => setForm({ ...form, awayLogo: v })} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Marchés avec cotes libres */}
        <div className="mt-2 overflow-hidden rounded-xl border bg-elev/40 transition-colors">
          <button
            type="button"
            onClick={() => setOpenMarkets((s) => !s)}
            className={cn("flex w-full items-center gap-2 px-2.5 py-2 text-left", activeMarkets.length > 0 && "border-b border-edge bg-white/50")}
          >
            <span className="flex-1 text-[10.5px] font-semibold tracking-[0.14em] text-dim">MARCHÉS & COTES LIBRES</span>
            {activeMarkets.length > 0 && (
              <span className="rounded-md bg-betclic-red/10 px-1.5 py-0.5 text-[9.5px] font-bold text-betclic-red">
                {activeMarkets.length} marché{activeMarkets.length > 1 ? "s" : ""} rempli{activeMarkets.length > 1 ? "s" : ""}
              </span>
            )}
            <span className="text-[10px] text-dim">Optionnel</span>
            <motion.span animate={{ rotate: openMarkets ? 180 : 0 }} transition={{ duration: 0.18 }} className="text-mist">
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.4} />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {openMarkets && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="px-2.5 pb-2.5 pt-2">
                  <p className="mb-2 text-[10px] text-dim">Laisse une cote vide pour masquer le marché</p>
                  <div className="flex flex-col gap-1.5">
                    {form.markets.map((g, gi) => {
                      const anyOdds = g.outcomes.some((o) => Number(o.odds) > 1);
                      return (
                        <div
                          key={g.key}
                          className={cn(
                            "rounded-xl border border-edge bg-elev/60 p-2 transition-colors",
                            anyOdds && "border-betclic-red/30 bg-elev"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[11.5px] font-semibold">{g.label}</span>
                            <span className="ml-auto shrink-0 rounded-md bg-edge px-1.5 py-0.5 text-[9px] font-bold text-mist">{g.short}</span>
                          </div>
                          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                            {g.outcomes.map((o, oi) => {
                              const filled = Number(o.odds) > 1;
                              return (
                                <label key={o.key} className="block">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="1.01"
                                    placeholder={o.short}
                                    value={o.odds}
                                    onChange={(e) =>
                                      setForm({
                                        ...form,
                                        markets: form.markets.map((mg, mgi) =>
                                          mgi === gi
                                            ? { ...mg, outcomes: mg.outcomes.map((mo, moi) => (moi === oi ? { ...mo, odds: e.target.value } : mo)) }
                                            : mg
                                        ),
                                      })
                                    }
                                    className={cn(
                                      "w-full rounded-lg border border-edge bg-white px-1.5 py-1.5 text-center text-[11px] font-semibold tabular-nums text-ink outline-none transition-colors placeholder:text-dim focus:border-betclic-red/50",
                                      filled && "border-betclic-red/40"
                                    )}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          type="submit"
          disabled={!form.home || !form.away || busy["add-match"]}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#E10014,#FB6962)] py-2.5 font-display text-[12.5px] font-bold text-white disabled:opacity-60"
        >
          {busy["add-match"] ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} /> : <CalendarPlus className="h-4 w-4" strokeWidth={2.4} />}
          Ajouter
        </button>
      </form>

      <section className="mt-4">
        <AdminSectionTitle label="Matchs" count={matches.length} />
        <div className="mt-2.5 flex flex-col gap-2">
          {matches.map((m) => (
            <div key={m.id} className={cn("glass-card flex items-center gap-3 rounded-2xl px-3.5 py-3", m.suspended && "opacity-60")}>
              <div className="flex shrink-0 -space-x-2">
                <LogoOrAvatar logo={m.homeLogo} name={m.homeTeam} size="sm" />
                <LogoOrAvatar logo={m.awayLogo} name={m.awayTeam} size="sm" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[13px] font-semibold">
                  {m.homeTeam} · {m.awayTeam}
                </p>
                <p className="truncate text-[11px] text-dim">
                  {m.league}
                  {m.status === "live" ? " · LIVE" : ` · ${formatKickoff(new Date(m.startsAt))}`}
                  {m.homeScore != null && ` · ${m.homeScore}–${m.awayScore}`}
                </p>
                <p className="truncate text-[10px] text-mist">
                  {formatOdds(m.oddsHome)} — {formatOdds(m.oddsAway)}
                  {m.suspended && " · suspendu"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={!m.suspended}
                  onChange={(v) =>
                    act({ action: "toggleMatch", matchId: m.id, suspended: !v }, `tg-${m.id}`, v ? "Match réactivé" : "Match suspendu")
                  }
                />
                <button
                  onClick={() => act({ action: "deleteMatch", matchId: m.id }, `del-${m.id}`, "Match supprimé")}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-bittersweet/10 text-bittersweet transition-transform active:scale-90"
                  aria-label="Supprimer"
                >
                  {busy[`del-${m.id}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
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
  form: { question: string; category: string; oddsYes: string; oddsNo: string; hours: string };
  setForm: (f: { question: string; category: string; oddsYes: string; oddsNo: string; hours: string }) => void;
  onAdd: (e: FormEvent) => void;
}) {
  return (
    <div>
      <form onSubmit={onAdd} className="glass-card rounded-[20px] p-3.5">
        <p className="flex items-center gap-1.5 font-display text-[12.5px] font-semibold">
          <HelpCircle className="h-4 w-4 text-betclic-red" strokeWidth={2.4} />
          Ajouter une question de pronostic
        </p>
        <AdminInput label="Question (Oui/Non)" value={form.question} className="mt-2" onChange={(v) => setForm({ ...form, question: v })} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <AdminInput label="Catégorie" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <AdminInput label="Cote Oui" value={form.oddsYes} onChange={(v) => setForm({ ...form, oddsYes: v })} />
          <AdminInput label="Cote Non" value={form.oddsNo} onChange={(v) => setForm({ ...form, oddsNo: v })} />
        </div>
        <AdminInput label="Échéance (heures)" value={form.hours} className="mt-2" onChange={(v) => setForm({ ...form, hours: v })} />
        <button
          type="submit"
          disabled={!form.question || busy["add-q"]}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#E10014,#FB6962)] py-2.5 font-display text-[12.5px] font-bold text-white disabled:opacity-60"
        >
          {busy["add-q"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.4} />}
          Publier
        </button>
      </form>

      <section className="mt-4">
        <AdminSectionTitle label="Questions" count={questions.length} />
        <div className="mt-2.5 flex flex-col gap-2">
          {questions.map((q) => (
            <div key={q.id} className="glass-card rounded-2xl px-3.5 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium leading-snug">{q.question}</p>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold",
                    q.status === "open" ? "bg-betclic-red/10 text-betclic-red" : "bg-elev text-mist"
                  )}
                >
                  {q.status === "open" ? "En cours" : `Résolue · ${q.resolution === "yes" ? "Oui" : "Non"}`}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-dim">
                {q.category} · Oui {formatOdds(q.oddsYes)} · Non {formatOdds(q.oddsNo)} · {fmtEur(q.volume)} misés
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                {q.status === "open" && (
                  <>
                    <button
                      onClick={() => act({ action: "resolveQuestion", questionId: q.id, resolution: "yes" }, `ry-${q.id}`, "Résolu : Oui")}
                      className="flex-1 rounded-lg bg-win/10 py-1.5 text-[11px] font-bold text-win"
                    >
                      Résoudre Oui
                    </button>
                    <button
                      onClick={() => act({ action: "resolveQuestion", questionId: q.id, resolution: "no" }, `rn-${q.id}`, "Résolu : Non")}
                      className="flex-1 rounded-lg bg-bittersweet/10 py-1.5 text-[11px] font-bold text-bittersweet"
                    >
                      Résoudre Non
                    </button>
                  </>
                )}
                <button
                  onClick={() => act({ action: "deleteQuestion", questionId: q.id }, `dq-${q.id}`, "Question supprimée")}
                  className="grid h-7 w-7 place-items-center rounded-md bg-elev text-mist"
                  aria-label="Supprimer"
                >
                  {busy[`dq-${q.id}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
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
    <div>
      <AdminSectionTitle label="Joueurs" count={users.length} />
      <div className="mt-2.5 flex flex-col gap-2">
        {users.map((u) => (
          <div key={u.id} className="glass-card rounded-2xl px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 font-display text-[12px] font-bold text-betclic-red">
                  {initials(u.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-display text-[13px] font-semibold">
                    {u.name}
                    {u.role === "admin" && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />}
                  </p>
                  <p className="truncate text-[11px] text-dim">{u.email ?? "—"}</p>
                </div>
              </div>
              <p className="shrink-0 font-display text-[15px] font-bold tabular-nums text-betclic-red">{fmtEur(u.balance)}</p>
            </div>
            <div className="mt-2.5 flex gap-2">
              <AdminInput
                placeholder="Nouveau solde"
                type="number"
                value={balanceForm[u.id] ?? ""}
                onChange={(v) => setBalanceForm({ ...balanceForm, [u.id]: v })}
              />
              <button
                onClick={() => {
                  const amt = parseFloat(balanceForm[u.id]);
                  if (Number.isFinite(amt)) {
                    act({ action: "setBalance", userId: u.id, amount: amt }, `bal-${u.id}`, "Solde mis à jour");
                    setBalanceForm({ ...balanceForm, [u.id]: "" });
                  }
                }}
                disabled={busy[`bal-${u.id}`] || !balanceForm[u.id]}
                className="shrink-0 rounded-xl bg-betclic-red px-4 font-display text-[12px] font-bold text-white disabled:opacity-50"
              >
                {busy[`bal-${u.id}`] ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fixer"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Paris ---------------- */

function BetsTab({
  bets,
  predBets,
}: {
  bets: AdminBet[];
  predBets: PanelData["predictionBets"];
}) {
  const rows: Array<{ id: number; kind: string; label: string; detail: string; stake: number; win: number; status: string; placedAt: string }> = [
    ...bets.map((b) => ({
      id: b.id,
      kind: "Sport",
      label: `${b.homeTeam} – ${b.awayTeam}`,
      detail: b.selectionLabel,
      stake: b.stake,
      win: b.potentialWin,
      status: b.status,
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
      placedAt: p.placedAt,
    })),
  ].sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());

  return (
    <div>
      <AdminSectionTitle label="Tous les paris" count={rows.length} />
      <div className="mt-2.5 flex flex-col gap-2">
        {rows.map((b) => (
          <div key={`${b.kind}-${b.id}`} className="glass-card rounded-2xl px-3.5 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-[13px] font-semibold">{b.label}</p>
                <p className="mt-0.5 truncate text-[11px] text-dim">
                  {b.detail} · {formatPlacedAt(b.placedAt)}
                </p>
              </div>
              <StatusBadge status={b.status} />
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px]">
              <span className="text-dim">Mise {fmtEur(b.stake)}</span>
              <span className="font-display text-[12.5px] font-bold text-betclic-red">→ {fmtEur(b.win)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Dépôts ---------------- */

function DepositsTab({ deposits }: { deposits: AdminDeposit[] }) {
  const total = deposits.filter((d) => d.status === "credited").reduce((s, d) => s + d.amount, 0);
  return (
    <div>
      <div className="glass-card mb-3 rounded-2xl p-4 text-center">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-dim">TOTAL CRÉDITÉ</p>
        <p className="mt-1 font-display text-[22px] font-bold tabular-nums text-betclic-red">{fmtEur(total)}</p>
      </div>
      <AdminSectionTitle label="Dépôts" count={deposits.length} />
      <div className="mt-2.5 flex flex-col gap-2">
        {deposits.map((d) => (
          <div key={d.id} className="glass-card flex items-center gap-3 rounded-2xl px-3.5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
              <CircleDollarSign className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[13px] font-semibold">
                {d.provider} · {fmtEur(d.amount)}
              </p>
              <p className="text-[11px] text-dim">{formatPlacedAt(d.createdAt)}</p>
            </div>
            <StatusBadge status={d.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Sous-composants ---------------- */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "En cours", cls: "bg-betclic-red/10 text-betclic-red" },
    won: { label: "Gagné", cls: "bg-win/10 text-win" },
    lost: { label: "Perdu", cls: "bg-elev text-mist" },
    cashed: { label: "Encaissé", cls: "bg-sky-500/10 text-sky-600" },
    paid: { label: "Payé", cls: "bg-win/10 text-win" },
    credited: { label: "Crédité", cls: "bg-win/10 text-win" },
    failed: { label: "Échec", cls: "bg-bittersweet/10 text-bittersweet" },
    expired: { label: "Expiré", cls: "bg-elev text-mist" },
  };
  const s = map[status] ?? { label: status, cls: "bg-elev text-mist" };
  return <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold", s.cls)}>{s.label}</span>;
}

/** Logo du club (URL) avec repli avatar initiales. */
function LogoOrAvatar({ logo, name, size }: { logo?: string | null; name: string; size?: "sm" | "md" }) {
  const hue = teamHue(name);
  const dim = size === "sm" ? "h-8 w-8 text-[10px]" : "h-10 w-10 text-[12px]";
  if (logo) {
    return (
      <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-2 ring-card", dim)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
      </span>
    );
  }
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-xl font-display font-bold text-white/95", dim)}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 62% 46% / 0.9), hsl(${(hue + 40) % 360} 70% 30% / 0.95))`,
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
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1 block text-[10px] font-semibold tracking-[0.14em] text-dim">{label.toUpperCase()}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-edge bg-elev/50 px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-dim focus:border-betclic-red/50 focus:bg-white"
      />
    </label>
  );
}

function AdminSectionTitle({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="h-2 w-2 rounded-full bg-betclic-red/70" />
      <h2 className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-ink">{label}</h2>
      <span className="h-px flex-1 bg-elev" />
      {count != null && (
        <span className="rounded-md bg-elev px-2 py-0.5 font-display text-[10.5px] font-bold text-mist">{count}</span>
      )}
    </div>
  );
}

/**
 * Champ avec autocomplétion façon combobox :
 * - tape pour filtrer les options (ligues ou clubs) ;
 * - affiche le logo quand il est fourni ;
 * - `onChange(valeur, logo?)` est appelé à la saisie ET à la sélection.
 */
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (open) setQuery(value);
  }, [open, value]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q))
    : options;
  const highlighted = filtered[0];

  return (
    <div className="relative" ref={boxRef}>
      {label && <span className="mb-1 block text-[10px] font-semibold tracking-[0.14em] text-dim">{label.toUpperCase()}</span>}
      <div className="relative">
        <input
          ref={inputRef}
          value={open ? query : value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
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
          className="w-full rounded-xl border border-edge bg-elev/50 px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-dim focus:border-betclic-red/50 focus:bg-white"
        />
      </div>

      <AnimatePresence>
        {open && options.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute z-40 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-edge bg-white p-1 shadow-lg"
          >
            {filtered.length === 0 && (
              <p className="px-2.5 py-2 text-[11.5px] text-dim">Aucun résultat</p>
            )}
            {filtered.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => {
                  onChange(o.label, o.logo);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-elev active:bg-elev"
              >
                {o.logo != null && (
                  <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-edge">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.logo} alt="" loading="lazy" className="h-full w-full object-contain p-0.5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[12.5px] font-semibold text-ink">{o.label}</span>
                  {o.hint && <span className="block text-[10.5px] text-dim">{o.hint}</span>}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminRow({ label, count }: { label: string; count?: number }) {
  return <AdminSectionTitle label={label} count={count} />;
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-card flex-1 rounded-2xl px-3 py-3 text-center">
      <p className="font-display text-[16px] font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[9px] font-semibold tracking-[0.14em] text-dim">{label.toUpperCase()}</p>
    </div>
  );
}

function Skeletons() {
  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <div className="shimmer h-[96px] rounded-[20px]" />
      <div className="shimmer h-[96px] rounded-[20px]" />
      <div className="shimmer h-[220px] rounded-[20px]" />
    </div>
  );
}