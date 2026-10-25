"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  Cpu,
  History,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { api, type ClientMatchHistoryItem } from "@/lib/api";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { hasAnyRealStats, RealMatchStatsCard } from "@/components/real-match-stats-card";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { useApp } from "@/components/providers";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { cn, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";

type Universe = "real" | "virtual";
type WinnerFilter = "all" | "V1" | "X" | "V2";
type GoalsFilter = "all" | "over25" | "under25" | "btts";

function formatDayHeading(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Récents";
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, now)) return "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Hier";

  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function MatchHistoryCard({
  match,
  expanded,
  highlighted = false,
  onToggle,
}: {
  match: ClientMatchHistoryItem;
  expanded: boolean;
  highlighted?: boolean;
  onToggle: () => void;
}) {
  const { oddsFormat } = useApp();
  const isFinished = match.status === "finished";
  const isLive = match.status === "live";
  const isReal = match.source === "manual";
  const hasScore = match.homeScore != null && match.awayScore != null;
  const h = match.homeScore ?? 0;
  const a = match.awayScore ?? 0;

  const winningOdds =
    match.winnerCode === "V1"
      ? match.oddsHome
      : match.winnerCode === "X"
        ? (match.oddsDraw ?? null)
        : match.winnerCode === "V2"
          ? match.oddsAway
          : null;

  const doubleChanceLabel =
    match.winnerCode === "V1"
      ? "1X & 12"
      : match.winnerCode === "X"
        ? "1X & 2X"
        : match.winnerCode === "V2"
          ? "12 & 2X"
          : "—";

  const sortedEvents = useMemo(
    () =>
      sanitizeMatchEvents(match.events, match.homeScore, match.awayScore).sort(
        (x, y) => x.minute - y.minute
      ),
    [match.events, match.homeScore, match.awayScore]
  );

  return (
    <article
      className={cn(
        "glass-card overflow-hidden rounded-2xl transition-all",
        highlighted && "ring-2 ring-betclic-red/45 shadow-sm"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-3.5 text-left active:bg-elev/50"
      >
        {/* En-tête ligue + heure + statut */}
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-mist">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide",
                isReal
                  ? "bg-emerald-600/12 text-emerald-700"
                  : "bg-elev text-dim"
              )}
            >
              {isReal ? "Réel" : "Virtuel"}
            </span>
            <SportIcon sport={match.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
            <span className="truncate">{match.league}</span>
            <span className="text-dim">·</span>
            <span className="shrink-0 text-dim">
              {isFinished
                ? formatPlacedAt(match.finishedAt ?? match.startsAt)
                : isLive
                  ? match.minute ?? "LIVE"
                  : formatKickoff(match.startsAt)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {isLive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[10px] font-bold text-betclic-red">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                {match.minute ?? "LIVE"}
              </span>
            ) : isFinished && match.winnerCode ? (
              <span className="rounded-md bg-elev px-1.5 py-0.5 font-display text-[10px] font-bold text-ink">
                {match.winnerCode}
                {winningOdds != null ? ` · ${formatOdds(winningOdds, oddsFormat)}` : ""}
              </span>
            ) : (
              <span className="rounded-md bg-elev px-1.5 py-0.5 font-display text-[10px] font-semibold text-mist">
                À venir
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-dim transition-transform duration-150",
                expanded && "rotate-180 text-ink"
              )}
              strokeWidth={2.2}
            />
          </div>
        </div>

        {/* Équipes + score */}
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="xs" />
              <span
                className={cn(
                  "truncate font-display text-[13.5px]",
                  hasScore && h > a ? "font-bold text-ink" : "font-semibold text-ink/85"
                )}
              >
                {match.homeTeam}
              </span>
              {match.redHome > 0 && (
                <span className="inline-block h-2.5 w-2 rounded-[2px] bg-betclic-red" />
              )}
            </div>
            <span
              className={cn(
                "font-display text-[15px] tabular-nums",
                hasScore && h > a ? "font-extrabold text-ink" : "font-bold text-mist"
              )}
            >
              {hasScore ? h : "–"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <TeamAvatar name={match.awayTeam} logo={match.awayLogo} size="xs" />
              <span
                className={cn(
                  "truncate font-display text-[13.5px]",
                  hasScore && a > h ? "font-bold text-ink" : "font-semibold text-ink/85"
                )}
              >
                {match.awayTeam}
              </span>
              {match.redAway > 0 && (
                <span className="inline-block h-2.5 w-2 rounded-[2px] bg-betclic-red" />
              )}
            </div>
            <span
              className={cn(
                "font-display text-[15px] tabular-nums",
                hasScore && a > h ? "font-extrabold text-ink" : "font-bold text-mist"
              )}
            >
              {hasScore ? a : "–"}
            </span>
          </div>
        </div>

        {/* Résumé rapide sous les scores */}
        {hasScore && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10.5px] font-semibold text-mist">
            {match.htHome != null && match.htAway != null && (
              <span className="rounded-md bg-elev px-2 py-0.5 tabular-nums">
                MT {match.htHome}-{match.htAway}
              </span>
            )}
            {match.totalGoals != null && (
              <span className="rounded-md bg-elev px-2 py-0.5">
                {match.totalGoals >= 3 ? "TP 2.5" : "TM 2.5"} ({match.totalGoals} b.)
              </span>
            )}
            {match.btts != null && (
              <span className="rounded-md bg-elev px-2 py-0.5">
                Les 2 marquent : {match.btts ? "Oui" : "Non"}
              </span>
            )}
          </div>
        )}
      </button>

      {/* Détail dépliable : marchés réglés + chronologie + statistiques */}
      {expanded && (
        <div className="border-t border-edge bg-elev/40 px-3.5 py-3 space-y-3">
          {!isFinished && (
            <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-edge">
              <span className="text-[12px] font-medium text-mist">
                {isLive ? "Ce match est actuellement en direct." : "Ce match n'a pas encore débuté."}
              </span>
              <Link
                href="/matchs"
                className="shrink-0 rounded-lg bg-betclic-red px-2.5 py-1 font-display text-[11px] font-bold text-white"
              >
                Voir l&apos;affiche
              </Link>
            </div>
          )}

          {/* Marchés clés réglés (terminologie 1xBet) */}
          {hasScore && isFinished && (
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-dim">
                Marchés réglés
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <SettledPill
                  label="1x2"
                  value={
                    match.winnerCode === "V1"
                      ? `V1 (${match.homeTeam})`
                      : match.winnerCode === "V2"
                        ? `V2 (${match.awayTeam})`
                        : "X (Match nul)"
                  }
                />
                <SettledPill label="Double chance" value={doubleChanceLabel} />
                {match.htWinnerCode && match.winnerCode && (
                  <SettledPill
                    label="MT-Fin"
                    value={`${match.htWinnerCode}-${match.winnerCode}`}
                  />
                )}
                <SettledPill label="Score exact" value={`${h}-${a}`} />
                <SettledPill
                  label="Total (2.5)"
                  value={(match.totalGoals ?? 0) >= 3 ? "Plus de (2.5)" : "Moins de (2.5)"}
                />
                <SettledPill
                  label="Les 2 marquent"
                  value={match.btts ? "Oui" : "Non"}
                />
              </div>
            </div>
          )}

          {/* Chronologie des faits de jeu */}
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-dim">
              Faits de match
            </p>
            {sortedEvents.length === 0 ? (
              <p className="mt-1 text-[12px] text-mist">
                {hasScore && h === 0 && a === 0
                  ? "Aucun but ni carton rouge (0 - 0)."
                  : "Aucun événement détaillé enregistré."}
              </p>
            ) : (
              <div className="mt-1.5 space-y-1">
                {sortedEvents.map((ev, idx) => {
                  const teamName = ev.team === "home" ? match.homeTeam : match.awayTeam;
                  const isGoal = ev.type === "goal";
                  return (
                    <div
                      key={`${ev.minute}-${ev.type}-${idx}`}
                      className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-[11.5px] ring-1 ring-edge/70"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-7 shrink-0 font-display text-[11px] font-bold tabular-nums text-betclic-red">
                          {ev.minute}&prime;
                        </span>
                        <span className="shrink-0 text-[12px]">
                          {isGoal ? "⚽" : "🟥"}
                        </span>
                        <span className="truncate font-medium text-ink">
                          {isGoal
                            ? ev.player
                              ? `${ev.player} (${teamName})`
                              : `But ${teamName}`
                            : ev.player
                              ? `${ev.player} — Carton rouge (${teamName})`
                              : `Carton rouge ${teamName}`}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10.5px] font-semibold text-dim">
                        {ev.team === "home" ? "DOM" : "EXT"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Statistiques officielles (Match réel) */}
          {match.source === "manual" && hasAnyRealStats(match.realStats) && (
            <RealMatchStatsCard
              stats={match.realStats}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              homeLogo={match.homeLogo}
              awayLogo={match.awayLogo}
              htHomeScore={match.htHome}
              htAwayScore={match.htAway}
              className="bg-white ring-1 ring-edge/70 border-0 shadow-none"
            />
          )}

          {/* Statistiques du match (Virtuel) */}
          {match.source !== "manual" && match.telemetry && (
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-dim">
                Statistiques
              </p>
              <div className="mt-1.5 space-y-1.5 rounded-xl bg-white p-2.5 ring-1 ring-edge/70">
                <StatRow
                  label="Possession"
                  left={`${match.telemetry.possessionHome}%`}
                  right={`${match.telemetry.possessionAway}%`}
                  leftShare={match.telemetry.possessionHome}
                />
                <StatRow
                  label="Tirs cadrés"
                  left={String(match.telemetry.shotsOnTargetHome)}
                  right={String(match.telemetry.shotsOnTargetAway)}
                  leftShare={sharePct(
                    match.telemetry.shotsOnTargetHome,
                    match.telemetry.shotsOnTargetAway
                  )}
                />
                <StatRow
                  label="xG (Buts attendus)"
                  left={match.telemetry.xgHome.toFixed(2)}
                  right={match.telemetry.xgAway.toFixed(2)}
                  leftShare={sharePct(match.telemetry.xgHome, match.telemetry.xgAway)}
                />
                <StatRow
                  label="Corners"
                  left={String(match.telemetry.cornersHome)}
                  right={String(match.telemetry.cornersAway)}
                  leftShare={sharePct(match.telemetry.cornersHome, match.telemetry.cornersAway)}
                />
              </div>
            </div>
          )}

          {/* Cotes de départ / clôture */}
          <div className="flex items-center justify-between gap-1.5 pt-0.5 text-[11px] text-dim">
            <span>Cotes 1x2</span>
            <div className="flex items-center gap-1.5 font-display font-bold tabular-nums">
              <span
                className={cn(
                  "rounded-md px-2 py-0.5",
                  match.winnerCode === "V1"
                    ? "bg-win/15 text-win"
                    : "bg-white text-mist ring-1 ring-edge"
                )}
              >
                V1 {formatOdds(match.oddsHome, oddsFormat)}
              </span>
              {match.oddsDraw != null && (
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5",
                    match.winnerCode === "X"
                      ? "bg-win/15 text-win"
                      : "bg-white text-mist ring-1 ring-edge"
                  )}
                >
                  X {formatOdds(match.oddsDraw, oddsFormat)}
                </span>
              )}
              <span
                className={cn(
                  "rounded-md px-2 py-0.5",
                  match.winnerCode === "V2"
                    ? "bg-win/15 text-win"
                    : "bg-white text-mist ring-1 ring-edge"
                )}
              >
                V2 {formatOdds(match.oddsAway, oddsFormat)}
              </span>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function sharePct(a: number, b: number): number {
  const sum = a + b;
  if (sum <= 0) return 50;
  return Math.round((a / sum) * 100);
}

function SettledPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-edge/70">
      <p className="text-[10px] font-medium text-dim">{label}</p>
      <p className="truncate font-display text-[11.5px] font-bold text-ink">{value}</p>
    </div>
  );
}

function StatRow({
  label,
  left,
  right,
  leftShare,
}: {
  label: string;
  left: string;
  right: string;
  leftShare: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-display font-bold tabular-nums text-ink">{left}</span>
        <span className="text-[10.5px] font-medium text-mist">{label}</span>
        <span className="font-display font-bold tabular-nums text-ink">{right}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-elev">
        <div
          className="bg-betclic-red transition-all"
          style={{ width: `${Math.max(6, Math.min(94, leftShare))}%` }}
        />
        <div className="flex-1 bg-ink/20" />
      </div>
    </div>
  );
}

function ResultatsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const matchParam = searchParams.get("match");
  const universeParam = searchParams.get("universe");
  const requestedMatchId = matchParam ? Number(matchParam) : undefined;

  const [history, setHistory] = useState<ClientMatchHistoryItem[] | null>(null);
  const [focusedMatch, setFocusedMatch] = useState<ClientMatchHistoryItem | null>(null);
  const [selectedUniverse, setSelectedUniverse] = useState<Universe | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [query, setQuery] = useState("");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [winnerFilter, setWinnerFilter] = useState<WinnerFilter>("all");
  const [goalsFilter, setGoalsFilter] = useState<GoalsFilter>("all");

  const load = useCallback(async () => {
    try {
      const res = await api.matchHistory(
        requestedMatchId && Number.isFinite(requestedMatchId) ? requestedMatchId : undefined
      );
      setHistory(res.matches);
      setFocusedMatch(res.focusedMatch);
      if (res.focusedMatch) {
        setExpandedIds((prev) => ({ ...prev, [res.focusedMatch!.id]: true }));
      }
    } catch {
      // ignore transient error
    }
  }, [requestedMatchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), 10000);
    return () => clearInterval(id);
  }, [load]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const realHistory = useMemo(
    () => (history ?? []).filter((m) => m.source === "manual"),
    [history]
  );
  const virtualHistory = useMemo(
    () => (history ?? []).filter((m) => m.source !== "manual"),
    [history]
  );

  const universe: Universe =
    selectedUniverse ??
    (focusedMatch
      ? focusedMatch.source === "manual"
        ? "real"
        : "virtual"
      : universeParam === "real"
        ? "real"
        : universeParam === "virtual"
          ? "virtual"
          : realHistory.length > 0
            ? "real"
            : "virtual");

  const isRealUniverse = universe === "real";
  const universeHistory = isRealUniverse ? realHistory : virtualHistory;

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return universeHistory;
    return universeHistory.filter(
      (m) =>
        m.homeTeam.toLowerCase().includes(q) ||
        m.awayTeam.toLowerCase().includes(q) ||
        m.league.toLowerCase().includes(q)
    );
  }, [universeHistory, query]);

  const leaguesWithCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of searched) {
      counts.set(m.league, (counts.get(m.league) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([league, count]) => ({ league, count }));
  }, [searched]);

  const effectiveLeague = useMemo(() => {
    if (leagueFilter === "all") return "all";
    return leaguesWithCounts.some((l) => l.league === leagueFilter) ? leagueFilter : "all";
  }, [leagueFilter, leaguesWithCounts]);

  const byLeague = useMemo(() => {
    if (effectiveLeague === "all") return searched;
    return searched.filter((m) => m.league === effectiveLeague);
  }, [searched, effectiveLeague]);

  const v1Count = useMemo(
    () => byLeague.filter((m) => m.winnerCode === "V1").length,
    [byLeague]
  );
  const drawCount = useMemo(
    () => byLeague.filter((m) => m.winnerCode === "X").length,
    [byLeague]
  );
  const v2Count = useMemo(
    () => byLeague.filter((m) => m.winnerCode === "V2").length,
    [byLeague]
  );

  const byWinner = useMemo(() => {
    if (winnerFilter === "all") return byLeague;
    return byLeague.filter((m) => m.winnerCode === winnerFilter);
  }, [byLeague, winnerFilter]);

  const over25Count = useMemo(
    () => byWinner.filter((m) => (m.totalGoals ?? 0) >= 3).length,
    [byWinner]
  );
  const under25Count = useMemo(
    () => byWinner.filter((m) => m.totalGoals != null && m.totalGoals < 3).length,
    [byWinner]
  );
  const bttsCount = useMemo(
    () => byWinner.filter((m) => m.btts === true).length,
    [byWinner]
  );

  const visible = useMemo(() => {
    if (goalsFilter === "over25") return byWinner.filter((m) => (m.totalGoals ?? 0) >= 3);
    if (goalsFilter === "under25")
      return byWinner.filter((m) => m.totalGoals != null && m.totalGoals < 3);
    if (goalsFilter === "btts") return byWinner.filter((m) => m.btts === true);
    return byWinner;
  }, [byWinner, goalsFilter]);

  const groupedByDay = useMemo(() => {
    const groups: Array<{ day: string; items: ClientMatchHistoryItem[] }> = [];
    for (const m of visible) {
      if (focusedMatch && m.id === focusedMatch.id) continue;
      const day = formatDayHeading(m.finishedAt ?? m.startsAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) {
        last.items.push(m);
      } else {
        groups.push({ day, items: [m] });
      }
    }
    return groups;
  }, [visible, focusedMatch]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pt-3.5 pb-6 lg:px-8 lg:py-6">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Retour"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <div>
            <h1 className="font-display text-[20px] font-bold tracking-tight text-ink lg:text-[25px]">
              Résultats
            </h1>
            <p className="text-[12px] text-mist lg:text-[13px]">
              Historique des matchs terminés
            </p>
          </div>
        </div>

        <Link
          href="/matchs"
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-elev px-3 font-display text-[11.5px] font-bold text-ink active:scale-95"
        >
          Affiche live
        </Link>
      </div>

      {/* Sélecteur d'univers + Recherche côte à côte sur desktop */}
      <div className="mt-3.5 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center lg:gap-3">
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-edge bg-white p-1">
          <button
            type="button"
            onClick={() => {
              setSelectedUniverse("real");
              setLeagueFilter("all");
            }}
            className={cn(
              "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 font-display text-[12.5px] font-bold transition-all",
              isRealUniverse
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-mist hover:bg-elev/60 active:bg-elev"
            )}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
            <span className="truncate">Matchs réels</span>
            {history !== null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  isRealUniverse ? "bg-white/20 text-white" : "bg-elev text-ink"
                )}
              >
                {realHistory.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedUniverse("virtual");
              setLeagueFilter("all");
            }}
            className={cn(
              "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 font-display text-[12.5px] font-bold transition-all",
              !isRealUniverse
                ? "bg-betclic-red text-white shadow-xs"
                : "text-mist hover:bg-elev/60 active:bg-elev"
            )}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
            <span className="truncate">Matchs virtuels</span>
            {history !== null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  !isRealUniverse ? "bg-white/20 text-white" : "bg-elev text-ink"
                )}
              >
                {virtualHistory.length}
              </span>
            )}
          </button>
        </div>

        {/* Recherche */}
        <div className="mt-3 flex h-12 items-center gap-2 rounded-2xl border border-edge bg-white px-3.5 max-lg:h-10 max-lg:rounded-xl max-lg:px-3 lg:mt-0">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une équipe ou compétition…"
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
              className="text-dim active:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Match ciblé depuis un coupon / pari */}
      {focusedMatch && (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-display text-[11.5px] font-bold uppercase tracking-wider text-betclic-red">
              <History className="h-3.5 w-3.5" strokeWidth={2.3} />
              Match sélectionné
            </span>
            <button
              type="button"
              onClick={() => router.replace(`/resultats?universe=${universe}`)}
              className="text-[11.5px] font-semibold text-mist hover:text-ink"
            >
              Fermer le focus
            </button>
          </div>
          <MatchHistoryCard
            match={focusedMatch}
            expanded={expandedIds[focusedMatch.id] ?? true}
            highlighted
            onToggle={() => toggleExpand(focusedMatch.id)}
          />
        </section>
      )}

      {/* Rangée unique collante de 3 pastilles dropdown */}
      <FilterDropdownRow
        filters={[
          {
            id: "league",
            placeholder: "Ligue",
            value: effectiveLeague,
            defaultValue: "all",
            onChange: setLeagueFilter,
            options: [
              {
                value: "all",
                label: "Toutes ligues",
                count: history !== null ? searched.length : undefined,
              },
              ...leaguesWithCounts.map(({ league, count }) => ({
                value: league,
                label: league,
                count,
              })),
            ],
          },
          {
            id: "winner",
            placeholder: "Issue 1x2",
            value: winnerFilter,
            defaultValue: "all",
            onChange: setWinnerFilter,
            options: [
              {
                value: "all",
                label: "Toutes issues",
                count: history !== null ? byLeague.length : undefined,
              },
              { value: "V1", label: "V1 (Domicile)", count: v1Count },
              { value: "X", label: "X (Match nul)", count: drawCount },
              { value: "V2", label: "V2 (Extérieur)", count: v2Count },
            ],
          },
          {
            id: "goals",
            placeholder: "Buts",
            value: goalsFilter,
            defaultValue: "all",
            onChange: setGoalsFilter,
            options: [
              {
                value: "all",
                label: "Tous scores",
                count: history !== null ? byWinner.length : undefined,
              },
              { value: "over25", label: "TP 2.5 (3+ buts)", count: over25Count },
              { value: "under25", label: "TM 2.5 (0-2 buts)", count: under25Count },
              { value: "btts", label: "Les 2 marquent", count: bttsCount },
            ],
          },
        ]}
        onReset={() => {
          setLeagueFilter("all");
          setWinnerFilter("all");
          setGoalsFilter("all");
        }}
        resultCountText={
          history !== null
            ? `${visible.length} résultat${visible.length > 1 ? "s" : ""} ${
                isRealUniverse ? "réel" : "virtuel"
              }${visible.length > 1 ? "s" : ""}`
            : null
        }
      />

      {/* Liste groupée par journée */}
      {history === null ? (
        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2 xl:gap-3.5">
          <div className="shimmer h-[118px] rounded-2xl" />
          <div className="shimmer h-[118px] rounded-2xl" />
          <div className="shimmer h-[118px] rounded-2xl" />
          <div className="shimmer h-[118px] rounded-2xl" />
        </div>
      ) : groupedByDay.length === 0 && !focusedMatch ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <Trophy className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink">
            Aucun match terminé trouvé
          </p>
          <p className="mt-1 max-w-[260px] text-[12.5px] text-mist">
            Modifiez vos filtres ou revenez dès la fin du match en direct.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedByDay.map((group) => (
            <section key={group.day} className="space-y-2.5">
              <h2 className="px-0.5 font-display text-[12px] font-bold uppercase tracking-wider text-dim">
                {group.day}
              </h2>
              <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
                {group.items.map((m) => (
                  <MatchHistoryCard
                    key={m.id}
                    match={m}
                    expanded={!!expandedIds[m.id]}
                    onToggle={() => toggleExpand(m.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResultatsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 space-y-3 lg:px-8 lg:py-6">
          <div className="shimmer h-10 rounded-xl" />
          <div className="shimmer h-[120px] rounded-2xl" />
          <div className="shimmer h-[120px] rounded-2xl" />
        </div>
      }
    >
      <ResultatsContent />
    </Suspense>
  );
}
