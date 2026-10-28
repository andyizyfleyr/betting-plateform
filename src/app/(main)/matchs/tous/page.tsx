"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Cpu,
  History,
  RefreshCw,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { api, type ClientMatch } from "@/lib/api";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollSentinel,
  sliceThreeSections,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { MatchCard } from "@/components/match-card";
import { useApp } from "@/components/providers";
import { PullToRefresh } from "@/components/pull-to-refresh";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import { useQueryClient } from "@tanstack/react-query";
import {
  forceRefreshMatchesFeed,
  useMatchesFeedQuery,
} from "@/lib/party-realtime";
import {
  deduplicateLeagueNames,
  isClearFavoriteMatch,
  matchesLeagueChoice,
  matchesSearchAndOdds,
  sortRealLiveByPopularity,
  sortRealUpcomingByPopularity,
  type MatchStatusFilter,
  type OddsProfileFilter,
} from "@/lib/matches-catalog";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import { resolveEspnSlugForLeague } from "@/lib/real-leagues";
import { cn } from "@/lib/format";

const POLL_INTERVAL = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

function parseStatusParam(raw: string | null): MatchStatusFilter {
  if (raw === "live" || raw === "upcoming" || raw === "finished") return raw;
  return "all";
}

function AllMatchesContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { user, setFeedMatches } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();

  const initialStatus = parseStatusParam(searchParams.get("status"));
  const initialLeague = searchParams.get("league")?.trim() || "all";

  const [filter, setFilter] = useState<MatchStatusFilter>(initialStatus);
  const [leagueFilter, setLeagueFilter] = useState<string>(initialLeague);
  const [oddsProfile, setOddsProfile] = useState<OddsProfileFilter>("all");
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const basePollMs =
    filter === "finished" || filter === "upcoming" ? 18_000 : POLL_INTERVAL;

  const matchesQuery = useMatchesFeedQuery({
    baseFallbackIntervalMs: basePollMs,
  });

  const matches = useMemo(
    () => matchesQuery.data?.matches ?? (matchesQuery.isError ? [] : null),
    [matchesQuery.data, matchesQuery.isError]
  );

  const loadError =
    !matchesQuery.data && matchesQuery.error instanceof Error
      ? matchesQuery.error.message
      : matchesQuery.isError && !matchesQuery.data
        ? "Impossible de charger les matchs pour le moment."
        : null;

  useEffect(() => {
    if (matchesQuery.data?.matches) {
      setFeedMatches(matchesQuery.data.matches);
    }
  }, [matchesQuery.data, setFeedMatches]);

  const handlePullRefresh = useCallback(async () => {
    try {
      const res = await forceRefreshMatchesFeed(queryClient);
      setFeedMatches(res.matches);
    } catch {
      /* conserve l'affichage actuel sur réseau mobile instable */
    }
  }, [queryClient, setFeedMatches]);

  const realMatchesAll = useMemo(
    () => (matches ?? []).filter((m) => m.source === "manual"),
    [matches]
  );

  const qNorm = query.trim().toLowerCase();
  const selectedSlug = useMemo(
    () => (leagueFilter !== "all" ? resolveEspnSlugForLeague(leagueFilter) : null),
    [leagueFilter]
  );

  const searchedReal = useMemo(
    () => realMatchesAll.filter((m) => matchesSearchAndOdds(m, qNorm, "all")),
    [realMatchesAll, qNorm]
  );

  const byLeague = useMemo(
    () =>
      searchedReal.filter((m) =>
        matchesLeagueChoice(m, leagueFilter, selectedSlug)
      ),
    [searchedReal, leagueFilter, selectedSlug]
  );

  const statusPoolForLeagueCounts = useMemo(() => {
    if (filter === "live") return searchedReal.filter((m) => m.status === "live");
    if (filter === "upcoming") return searchedReal.filter((m) => m.status === "upcoming");
    if (filter === "finished") return searchedReal.filter((m) => m.status === "finished");
    return searchedReal.filter((m) => m.status !== "finished");
  }, [searchedReal, filter]);

  const leagueOptions = useMemo(() => {
    const raw: string[] = [];
    if (leagueFilter !== "all") raw.push(leagueFilter);
    for (const m of realMatchesAll) raw.push(m.league);
    return deduplicateLeagueNames(raw).map((lg) => {
      const slug = resolveEspnSlugForLeague(lg);
      const count = statusPoolForLeagueCounts.filter((m) =>
        matchesLeagueChoice(m, lg, slug)
      ).length;
      return { league: lg, count };
    });
  }, [realMatchesAll, leagueFilter, statusPoolForLeagueCounts]);

  const liveAllCount = useMemo(
    () => byLeague.filter((m) => m.status === "live").length,
    [byLeague]
  );
  const upcomingAllCount = useMemo(
    () => byLeague.filter((m) => m.status === "upcoming").length,
    [byLeague]
  );
  const finishedAllCount = useMemo(
    () => byLeague.filter((m) => m.status === "finished").length,
    [byLeague]
  );
  const activeAllCount = liveAllCount + upcomingAllCount;

  const byStatusAndLeague = useMemo(() => {
    if (filter === "live") return byLeague.filter((m) => m.status === "live");
    if (filter === "upcoming") return byLeague.filter((m) => m.status === "upcoming");
    if (filter === "finished") return byLeague.filter((m) => m.status === "finished");
    return byLeague.filter((m) => m.status !== "finished");
  }, [byLeague, filter]);

  const favCount = useMemo(
    () => byStatusAndLeague.filter(isClearFavoriteMatch).length,
    [byStatusAndLeague]
  );
  const tightCount = byStatusAndLeague.length - favCount;

  const visible = useMemo(() => {
    if (oddsProfile === "favorite") {
      return byStatusAndLeague.filter(isClearFavoriteMatch);
    }
    if (oddsProfile === "tight") {
      return byStatusAndLeague.filter((m) => !isClearFavoriteMatch(m));
    }
    return byStatusAndLeague;
  }, [byStatusAndLeague, oddsProfile]);

  const liveOrdered = useMemo(
    () => sortRealLiveByPopularity(visible.filter((m) => m.status === "live")),
    [visible]
  );
  const upcomingOrdered = useMemo(
    () => sortRealUpcomingByPopularity(visible.filter((m) => m.status === "upcoming")),
    [visible]
  );
  const finishedOrdered = useMemo(
    () => visible.filter((m) => m.status === "finished"),
    [visible]
  );

  const totalMatchesCount =
    liveOrdered.length + upcomingOrdered.length + finishedOrdered.length;
  const batchResetKey = `${filter}|${leagueFilter}|${oddsProfile}|${query
    .trim()
    .toLowerCase()}`;
  const batch = useInfiniteBatch(totalMatchesCount, batchResetKey);

  const [visibleLiveOrdered, visibleUpcomingOrdered, visibleFinishedOrdered] =
    useMemo(
      () =>
        sliceThreeSections(
          liveOrdered,
          upcomingOrdered,
          finishedOrdered,
          batch.visibleCount
        ),
      [liveOrdered, upcomingOrdered, finishedOrdered, batch.visibleCount]
    );

  const toggleMobileSearch = () => {
    if (mobileSearchOpen) {
      setQuery("");
      setMobileSearchOpen(false);
    } else {
      setMobileSearchOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  };

  if (matches === null && !loadError) {
    return <PulseFlashLoader />;
  }

  return (
    <PullToRefresh onRefresh={handlePullRefresh} haptics={user?.haptics}>
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-3.5 lg:px-0 lg:py-0">
        {/* En-tête compact + icône loupe sur mobile */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                triggerRouteLoader("/matchs");
                router.push("/matchs");
              }}
              aria-label="Retour à l'accueil Matchs"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <h1 className="truncate font-display text-[20px] font-bold leading-tight tracking-tight text-ink lg:text-[24px]">
              {leagueFilter !== "all" ? leagueFilter : "Tous les matchs"}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleMobileSearch}
              aria-label={mobileSearchOpen ? "Fermer la recherche" : "Rechercher un match"}
              className={cn(
                "grid h-8.5 w-8.5 place-items-center rounded-full transition-colors active:scale-95 lg:hidden",
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

            {/* Recherche desktop en ligne */}
            <div className="hidden h-10 w-[300px] items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:flex xl:w-[340px]">
              <Search className="h-4 w-4 shrink-0 text-dim" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un club ou une ligue…"
                className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-dim"
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
        </div>

        {/* Barre de recherche mobile dépliable à la demande */}
        {(mobileSearchOpen || query) && (
          <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:hidden">
            <Search className="h-4 w-4 shrink-0 text-dim" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un match, un club ou une compétition…"
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

        {/* Rangée unique collante de 3 pastilles dropdown 40 px */}
        <FilterDropdownRow
          filters={[
            {
              id: "status",
              placeholder: "Statut",
              value: filter,
              defaultValue: "all",
              onChange: setFilter,
              options: [
                {
                  value: "all",
                  label: "Affiche",
                  count: matches !== null ? activeAllCount : undefined,
                },
                {
                  value: "live",
                  label: "En direct",
                  count: matches !== null ? liveAllCount : undefined,
                },
                {
                  value: "upcoming",
                  label: "Avant-match",
                  count: matches !== null ? upcomingAllCount : undefined,
                },
                {
                  value: "finished",
                  label: "Terminés",
                  count: matches !== null ? finishedAllCount : undefined,
                },
              ],
            },
            {
              id: "league",
              placeholder: "Ligue",
              value: leagueFilter,
              defaultValue: "all",
              onChange: setLeagueFilter,
              options: [
                {
                  value: "all",
                  label: "Toutes ligues",
                  count:
                    matches !== null ? statusPoolForLeagueCounts.length : undefined,
                },
                ...leagueOptions.map(({ league, count }) => ({
                  value: league,
                  label: league,
                  count: matches !== null ? count : undefined,
                })),
              ],
            },
            {
              id: "odds",
              placeholder: "Cotes",
              value: oddsProfile,
              defaultValue: "all",
              onChange: setOddsProfile,
              options: [
                {
                  value: "all",
                  label: "Toutes cotes",
                  count: matches !== null ? byStatusAndLeague.length : undefined,
                },
                {
                  value: "favorite",
                  label: "Favori net",
                  count: matches !== null ? favCount : undefined,
                },
                {
                  value: "tight",
                  label: "Match serré",
                  count: matches !== null ? tightCount : undefined,
                },
              ],
            },
          ]}
          onReset={() => {
            setFilter("all");
            setLeagueFilter("all");
            setOddsProfile("all");
          }}
          resultCountText={
            matches !== null
              ? `${visible.length} match${visible.length > 1 ? "s" : ""} officiel${visible.length > 1 ? "s" : ""}`
              : null
          }
        />

        {/* Liste verticale fluide au pouce */}
        {matches === null ? (
          <PulseFlashLoader compact />
        ) : loadError && (matches?.length ?? 0) === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-amber-500/30 bg-white p-5 text-center shadow-xs">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/12 text-amber-600">
              <AlertTriangle className="h-5 w-5" strokeWidth={2.1} />
            </div>
            <p className="mt-3 font-display text-[15px] font-bold text-ink">
              Connexion au serveur interrompue
            </p>
            <p className="mt-1 max-w-[330px] text-[12.5px] leading-relaxed text-mist">
              {loadError}
            </p>
            <button
              type="button"
              onClick={() => {
                void handlePullRefresh();
              }}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-betclic-red px-4 font-display text-[12.5px] font-bold text-white shadow-xs active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.3} />
              Réessayer
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
              <Trophy className="h-5 w-5" strokeWidth={1.9} />
            </div>
            <p className="mt-3 font-display text-[15px] font-semibold text-ink">
              {filter === "live"
                ? "Aucun match officiel en direct actuellement"
                : "Aucun match officiel dans ce filtre"}
            </p>
            <p className="mt-1 max-w-[290px] text-[12.5px] text-dim">
              {filter === "live"
                ? "Retrouvez les prochaines affiches en avant-match ou pariez en direct sur les matchs virtuels 24h/24."
                : "Modifiez ou réinitialisez les filtres pour afficher l'ensemble des rencontres."}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {filter === "live" && upcomingAllCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter("upcoming")}
                  className="h-9.5 rounded-full border border-edge bg-white px-3.5 font-display text-[12px] font-bold text-ink active:scale-95"
                >
                  Avant-match ({upcomingAllCount})
                </button>
              )}
              <Link
                href="/matchs/virtuels"
                className="inline-flex h-9.5 items-center gap-1.5 rounded-full bg-betclic-red px-4 font-display text-[12px] font-bold text-white active:scale-95"
              >
                <Cpu className="h-3.5 w-3.5" strokeWidth={2.3} />
                Matchs virtuels 24h/24
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {visibleLiveOrdered.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-2">
                    <span className="live-dot h-2 w-2 rounded-full bg-emerald-600" />
                    <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-ink">
                      En direct
                    </h2>
                  </div>
                  <span className="rounded-full bg-emerald-600/12 px-2 py-0.5 font-display text-[10.5px] font-bold tabular-nums text-emerald-700">
                    {liveOrdered.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 items-start gap-3">
                  {visibleLiveOrdered.map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            )}

            {visibleUpcomingOrdered.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-ink">
                    Avant-match
                  </h2>
                  <span className="rounded-full bg-elev px-2 py-0.5 font-display text-[10.5px] font-bold tabular-nums text-dim">
                    {upcomingOrdered.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 items-start gap-3">
                  {visibleUpcomingOrdered.map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            )}

            {visibleFinishedOrdered.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-ink">
                    Terminés récemment
                  </h2>
                  <Link
                    href="/resultats?universe=real"
                    className="inline-flex items-center gap-1 font-display text-[11.5px] font-bold text-betclic-red"
                  >
                    <History className="h-3.5 w-3.5" strokeWidth={2.2} />
                    Tout l&apos;historique
                  </Link>
                </div>
                <div className="grid grid-cols-1 items-start gap-3">
                  {visibleFinishedOrdered.map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            )}

            <InfiniteScrollSentinel
              hasMore={batch.hasMore}
              isLoadingMore={batch.isLoadingMore}
              onLoadMore={batch.loadMore}
            />
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

export default function AllMatchesPage() {
  return (
    <Suspense fallback={<PulseFlashLoader />}>
      <AllMatchesContent />
    </Suspense>
  );
}
