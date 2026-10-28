"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Cpu,
  History,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { api, type ClientMatchHistoryItem } from "@/lib/api";
import { rememberMatchHistory } from "@/lib/client-entity-cache";
import { CardOverlayLink } from "@/components/card-overlay-link";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollSentinel,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { SportIcon } from "@/components/sport-icon";
import { LiveMatchClock } from "@/components/live-match-clock";
import { TeamAvatar } from "@/components/team-avatar";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/components/providers";
import { useMatchHistoryQuery } from "@/lib/party-realtime";
import { pulseQueryKeys } from "@/lib/query-client";
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
  highlighted = false,
}: {
  match: ClientMatchHistoryItem;
  highlighted?: boolean;
}) {
  const { oddsFormat } = useApp();
  const isFinished = match.status === "finished";
  const isLive = match.status === "live";
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

  const targetHref = isFinished ? `/resultats/${match.id}` : `/matchs/${match.id}`;

  return (
    <article
      className={cn(
        "glass-card relative cursor-pointer overflow-hidden rounded-2xl p-3.5 transition-all hover:bg-elev/35 active:bg-elev/60",
        highlighted && "ring-2 ring-betclic-red/45 shadow-sm"
      )}
    >
      <CardOverlayLink
        href={targetHref}
        label={`${match.homeTeam} – ${match.awayTeam}`}
        onBeforeNavigate={() => rememberMatchHistory([match])}
      />
      {/* En-tête ligue + heure + statut */}
      <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-2 text-[11px] font-medium text-mist">
        <div className="flex min-w-0 items-center gap-1.5">
          <SportIcon sport={match.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
          <span className="truncate">{match.league}</span>
          <span className="text-dim">·</span>
          <span className="shrink-0 tabular-nums text-dim">
            {isFinished
              ? formatPlacedAt(match.finishedAt ?? match.startsAt)
              : isLive ? (
                  <LiveMatchClock
                    match={match}
                    fallback={match.minute ?? "LIVE"}
                  />
                )
                : formatKickoff(match.startsAt)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isLive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[10px] font-bold tabular-nums text-betclic-red">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
              <LiveMatchClock
                match={match}
                fallback={match.minute ?? "LIVE"}
              />
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
          <ChevronRight className="h-4 w-4 text-dim" strokeWidth={2.2} />
        </div>
      </div>

      {/* Équipes + score */}
      <div className="pointer-events-none relative z-[1] mt-2.5 space-y-1.5">
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

      {/* Résumé compact sur une ligne */}
      {hasScore && match.htHome != null && match.htAway != null && (
        <div className="pointer-events-none relative z-[1] mt-2 flex items-center gap-1.5 text-[10.5px] font-semibold text-mist">
          <span className="rounded-md bg-elev px-2 py-0.5 tabular-nums">
            MT {match.htHome}-{match.htAway}
          </span>
          {match.totalGoals != null && (
            <span className="rounded-md bg-elev px-2 py-0.5">
              {match.totalGoals >= 3 ? "TP 2.5" : "TM 2.5"}
            </span>
          )}
          {match.btts != null && (
            <span className="rounded-md bg-elev px-2 py-0.5">
              BTTS : {match.btts ? "Oui" : "Non"}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function ResultatsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const matchParam = searchParams.get("match");
  const universeParam = searchParams.get("universe");
  const requestedMatchId = matchParam ? Number(matchParam) : undefined;

  const [selectedUniverse, setSelectedUniverse] = useState<Universe | null>(
    universeParam === "real" || universeParam === "virtual" ? universeParam : null
  );
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [winnerFilter, setWinnerFilter] = useState<WinnerFilter>("all");
  const [goalsFilter, setGoalsFilter] = useState<GoalsFilter>("all");

  const validId =
    requestedMatchId != null &&
    Number.isInteger(requestedMatchId) &&
    requestedMatchId > 0
      ? requestedMatchId
      : undefined;

  // 1) Historique canonique mutualisé via TanStack Query + invalidation PartyKit dès qu'un match se termine
  const historyQuery = useMatchHistoryQuery();
  const history = historyQuery.data?.matches ?? null;

  const focusedInBase = useMemo(
    () =>
      validId && history ? (history.find((m) => m.id === validId) ?? null) : null,
    [history, validId]
  );

  // 2) Repli ciblé uniquement si `validId` est plus ancien que le lot de base en cache Edge
  const focusedFallbackQuery = useQuery({
    queryKey: pulseQueryKeys.matchHistoryFocused(validId ?? 0),
    queryFn: () => api.matchHistory(validId),
    enabled: Boolean(validId && history && !focusedInBase),
    staleTime: 60_000,
  });

  const focusedMatch = validId
    ? (focusedInBase ?? focusedFallbackQuery.data?.focusedMatch ?? null)
    : null;

  const load = useCallback(async () => {
    await historyQuery.refetch();
    if (validId && !focusedInBase) {
      await focusedFallbackQuery.refetch();
    }
  }, [focusedFallbackQuery, focusedInBase, historyQuery, validId]);

  const realHistory = useMemo(
    () =>
      (history ?? [])
        .filter((m) => m.source === "manual")
        .sort(
          (a, b) =>
            new Date(b.finishedAt ?? b.startsAt).getTime() -
              new Date(a.finishedAt ?? a.startsAt).getTime() || b.id - a.id
        ),
    [history]
  );
  const virtualHistory = useMemo(
    () =>
      (history ?? [])
        .filter((m) => m.source !== "manual")
        .sort(
          (a, b) =>
            new Date(b.finishedAt ?? b.startsAt).getTime() -
              new Date(a.finishedAt ?? a.startsAt).getTime() || b.id - a.id
        ),
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
    return leaguesWithCounts.some((l) => l.league === leagueFilter)
      ? leagueFilter
      : "all";
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
    if (goalsFilter === "over25")
      return byWinner.filter((m) => (m.totalGoals ?? 0) >= 3);
    if (goalsFilter === "under25")
      return byWinner.filter((m) => m.totalGoals != null && m.totalGoals < 3);
    if (goalsFilter === "btts") return byWinner.filter((m) => m.btts === true);
    return byWinner;
  }, [byWinner, goalsFilter]);

  const unfocusedVisible = useMemo(
    () =>
      focusedMatch ? visible.filter((m) => m.id !== focusedMatch.id) : visible,
    [visible, focusedMatch]
  );

  const resultsResetKey = `${universe}|${effectiveLeague}|${winnerFilter}|${goalsFilter}|${query
    .trim()
    .toLowerCase()}`;
  const resultsBatch = useInfiniteBatch(unfocusedVisible.length, resultsResetKey);
  const pagedResults = useMemo(
    () => unfocusedVisible.slice(0, resultsBatch.visibleCount),
    [unfocusedVisible, resultsBatch.visibleCount]
  );

  const groupedByDay = useMemo(() => {
    const groups: Array<{ day: string; items: ClientMatchHistoryItem[] }> = [];
    for (const m of pagedResults) {
      const day = formatDayHeading(m.finishedAt ?? m.startsAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) {
        last.items.push(m);
      } else {
        groups.push({ day, items: [m] });
      }
    }
    return groups;
  }, [pagedResults]);

  const toggleMobileSearch = () => {
    if (mobileSearchOpen) {
      setQuery("");
      setMobileSearchOpen(false);
    } else {
      setMobileSearchOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  };

  if (history === null) {
    return <PulseFlashLoader />;
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pt-3.5 pb-6 lg:px-0 lg:py-0">
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
          <h1 className="font-display text-[20px] font-bold tracking-tight text-ink lg:text-[25px]">
            Résultats
          </h1>
        </div>

        <button
          type="button"
          onClick={toggleMobileSearch}
          aria-label={mobileSearchOpen ? "Fermer la recherche" : "Rechercher un résultat"}
          className={cn(
            "grid h-8.5 w-8.5 shrink-0 place-items-center rounded-full transition-colors active:scale-95 lg:hidden",
            mobileSearchOpen || query
              ? "bg-betclic-red text-white"
              : "bg-elev text-ink"
          )}
        >
          {mobileSearchOpen ? (
            <X className="h-4 w-4" strokeWidth={2.3} />
          ) : (
            <Search className="h-4 w-4" strokeWidth={2.2} />
          )}
        </button>
      </div>

      {/* Sélecteur d'univers + Recherche en ligne sur desktop */}
      <div className="mt-3 xl:grid xl:grid-cols-[minmax(0,1fr)_270px] xl:items-center xl:gap-3">
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

        {/* Recherche desktop */}
        <div className="hidden h-12 items-center gap-2 rounded-2xl border border-edge bg-white px-3.5 lg:mt-3 lg:flex xl:mt-0">
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
              className="text-dim hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Recherche mobile dépliable à la demande */}
      {(mobileSearchOpen || query) && (
        <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:hidden">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une équipe ou compétition…"
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
          />
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setMobileSearchOpen(false);
            }}
            aria-label="Fermer la recherche"
            className="text-dim active:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
              Fermer
            </button>
          </div>
          <MatchHistoryCard match={focusedMatch} highlighted />
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
            ? `${visible.length} résultat${visible.length > 1 ? "s" : ""}`
            : null
        }
      />

      {/* Liste groupée par journée */}
      {history === null ? (
        <div className="grid grid-cols-1 gap-2.5">
          <div className="shimmer h-[112px] rounded-2xl" />
          <div className="shimmer h-[112px] rounded-2xl" />
          <div className="shimmer h-[112px] rounded-2xl" />
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
              <div className="grid grid-cols-1 items-start gap-3">
                {group.items.map((m) => (
                  <MatchHistoryCard key={m.id} match={m} />
                ))}
              </div>
            </section>
          ))}
          <InfiniteScrollSentinel
            hasMore={resultsBatch.hasMore}
            isLoadingMore={resultsBatch.isLoadingMore}
            onLoadMore={resultsBatch.loadMore}
          />
        </div>
      )}
    </div>
  );
}

export default function ResultatsPage() {
  return (
    <Suspense fallback={<PulseFlashLoader />}>
      <ResultatsContent />
    </Suspense>
  );
}
