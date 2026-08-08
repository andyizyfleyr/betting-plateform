"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarPlus,
  CheckCircle2,
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
import { cn, eur, formatOdds, formatPlacedAt, initials } from "@/lib/format";

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
    league: "Football",
    oddsHome: "1.90",
    oddsDraw: "3.30",
    oddsAway: "3.10",
    status: "upcoming",
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
      },
      "add-match",
      "Match créé"
    );
    if (ok) {
      setMatchForm({ home: "", away: "", league: "Football", oddsHome: "1.90", oddsDraw: "3.30", oddsAway: "3.10", status: "upcoming" });
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
  };
  setForm: (f: typeof form) => void;
  onAdd: (e: FormEvent) => void;
}) {
  return (
    <div>
      <form onSubmit={onAdd} className="glass-card rounded-[20px] p-3.5">
        <p className="flex items-center gap-1.5 font-display text-[12.5px] font-semibold">
          <Plus className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
          Ajouter un match réel manuellement
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <AdminInput placeholder="Équipe domicile" value={form.home} onChange={(v) => setForm({ ...form, home: v })} />
          <AdminInput placeholder="Équipe extérieure" value={form.away} onChange={(v) => setForm({ ...form, away: v })} />
        </div>
        <AdminInput label="Championnat" value={form.league} className="mt-2" onChange={(v) => setForm({ ...form, league: v })} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <AdminInput label="Cote domicile" value={form.oddsHome} onChange={(v) => setForm({ ...form, oddsHome: v })} />
          <AdminInput label="Cote nul" value={form.oddsDraw} onChange={(v) => setForm({ ...form, oddsDraw: v })} />
          <AdminInput label="Cote ext." value={form.oddsAway} onChange={(v) => setForm({ ...form, oddsAway: v })} />
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] font-semibold tracking-[0.14em] text-dim">STATUT</span>
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
                    "relative rounded-lg py-2 font-display text-[11.5px] transition-colors",
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
        </label>
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
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-[12px] font-bold text-white",
                  m.status === "live" ? "bg-live" : m.status === "upcoming" ? "bg-betclic-red" : "bg-mist"
                )}
              >
                {m.status === "live" ? "L" : m.status === "upcoming" ? "U" : "T"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[13px] font-semibold">
                  {m.homeTeam} · {m.awayTeam}
                </p>
                <p className="truncate text-[11px] text-dim">
                  {m.league} · {formatOdds(m.oddsHome)} — {formatOdds(m.oddsAway)}
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