"use client";

/**
 * Éléments partagés par toutes les pages de l'admin (utilsitaires UI,
 * constantes de catalogue, types). Extrait de l'ancien SPA admin.
 */

import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  BarChart3,
  Brain,
  CircleDollarSign,
  Eye,
  HelpCircle,
  Trophy,
  Ticket,
  Users,
} from "lucide-react";
import { cn } from "@/lib/format";
import { TeamAvatar } from "@/components/team-avatar";

export type TabKey =
  | "dashboard"
  | "forecasts"
  | "ml"
  | "matches"
  | "questions"
  | "users"
  | "bets"
  | "deposits"
  | "settings";

export const POLL_INTERVAL = 5_000;

export const TABS: {
  key: TabKey;
  label: string;
  href: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "dashboard", label: "Synthèse", href: "/admin/dashboard", Icon: BarChart3 },
  { key: "forecasts", label: "Scores prévus", href: "/admin/forecasts", Icon: Eye },
  { key: "matches", label: "Matchs", href: "/admin/matches", Icon: Trophy },
  { key: "ml", label: "IA & ML", href: "/admin/ml", Icon: Brain },
  { key: "questions", label: "Pronostics", href: "/admin/questions", Icon: HelpCircle },
  { key: "users", label: "Joueurs", href: "/admin/users", Icon: Users },
  { key: "bets", label: "Paris", href: "/admin/bets", Icon: Ticket },
  { key: "deposits", label: "Finance", href: "/admin/deposits", Icon: CircleDollarSign },
];

export interface AdminUser {
  id: number;
  name: string;
  email?: string | null;
  balance: number;
  role: string;
  countryCode?: string;
  currency?: string;
  suspended?: boolean;
  suspendedUntil?: string | null;
  stakeLimit?: number;
}

export interface AdminBet {
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

export interface AdminDeposit {
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

export interface AdminMatch {
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

export interface DiscoveredOfficialFixture {
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

export interface AdminQuestionOption {
  key: string;
  label: string;
  odds: number;
}

export interface AdminQuestion {
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

export interface QuestionFormState {
  mode: "binary" | "multi";
  question: string;
  category: string;
  oddsYes: string;
  oddsNo: string;
  options: Array<{ label: string; odds: string }>;
  hours: string;
}

export interface AdminWithdrawal {
  id: number;
  userId: number;
  userName: string;
  userEmail: string;
  userCountryCode?: string;
  userCurrency?: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface AdminMatchForecast {
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

export interface AdminMlModel {
  key: string;
  name: string;
  algorithm: string;
  version: number;
  samplesCount: number;
  brierScore: number;
  logLoss: number;
  updatedAt: string;
}

export interface AdminMlOverview {
  models: AdminMlModel[];
  sharpWeights: Array<{
    key: string;
    label: string;
    weight: number;
  }>;
}

export interface PanelData {
  stats: Record<string, number>;
  deposits: AdminDeposit[];
  withdrawals?: AdminWithdrawal[];
  matches: AdminMatch[];
  questions: AdminQuestion[];
  ml?: AdminMlOverview;
  scenarioMode?: "dynamic" | "locked";
  realSettlementMode?: "auto" | "confirm";
  matchForecasts?: Record<number, AdminMatchForecast>;
  users: AdminUser[];
  bets: AdminBet[];
  predictionBets: AdminBet[];
  comboBets: AdminBet[];
  bettingLimits?: Record<string, unknown> | null;
}

export const MARKET_CATALOG: {
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
    ],
  },
  {
    key: "btts",
    label: "Les deux équipes marquent",
    short: "LDEM",
    outcomes: [
      { key: "oui", label: "Les deux équipes marquent", short: "Oui" },
      { key: "non", label: "Au moins une équipe ne marque pas", short: "Non" },
    ],
  },
  {
    key: "handicap_euro",
    label: "Handicap",
    short: "Hcp",
    outcomes: [
      { key: "h1", label: "Handicap : Domicile (+1)", short: "H1 (+1)" },
      { key: "h2", label: "Handicap : Extérieur (-1)", short: "H2 (-1)" },
      { key: "hx", label: "Handicap : nul", short: "HX" },
    ],
  },
  {
    key: "goals_range",
    label: "Nombre de buts",
    short: "Buts",
    outcomes: [
      { key: "0_1", label: "0 - 1 buts", short: "0-1" },
      { key: "2_3", label: "2 - 3 buts", short: "2-3" },
      { key: "4_6", label: "4 - 6 buts", short: "4-6" },
      { key: "7_plus", label: "7 buts et +", short: "7+" },
    ],
  },
  {
    key: "score_exact",
    label: "Score exact",
    short: "Score",
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

export const defaultQuestionOptions = () => [
  { label: "", odds: "2.85" },
  { label: "", odds: "3.25" },
  { label: "", odds: "4.50" },
];

export const emptyMarkets = () =>
  MARKET_CATALOG.map((m) => ({
    key: m.key,
    label: m.label,
    short: m.short,
    outcomes: m.outcomes.map((o) => ({ key: o.key, label: o.label, short: o.short, odds: "" })),
  }));

export function StatusBadge({ status }: { status: string }) {
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

export function LogoOrAvatar({ logo, name }: { logo?: string | null; name: string }) {
  return <TeamAvatar name={name} logo={logo} size="sm" className="ring-2 ring-white" />;
}

export function AdminInput({
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

export function AdminSectionTitle({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <h2 className="font-display text-[10.5px] font-bold uppercase tracking-wider text-mist">
        {label}
      </h2>
      {count != null && <span className="text-[10.5px] font-medium text-dim">{count}</span>}
    </div>
  );
}

export function ComboBox({
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

export function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-card rounded-2xl p-3 text-center">
      <p className="font-display text-[12.5px] font-medium tabular-nums text-ink">{value}</p>
      <p className="text-[10px] font-medium text-dim">{label}</p>
    </div>
  );
}
