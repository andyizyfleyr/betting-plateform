"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Cpu,
  History,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { api, type ClientMatch } from "@/lib/api";
import { MatchCard } from "@/components/match-card";
import { FeaturedMatch } from "@/components/featured-match";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { useApp } from "@/components/providers";
import { resolveEspnSlugForLeague } from "@/lib/real-leagues";
import { cn, todayLabel } from "@/lib/format";

type Universe = "real" | "virtual";
type Filter = "all" | "live" | "upcoming" | "finished";
type OddsProfileFilter = "all" | "favorite" | "tight";

function isClearFavoriteMatch(m: ClientMatch): boolean {
  return Math.min(m.oddsHome, m.oddsAway) <= 1.85;
}

const TIER_S_CLUBS = [
  "real madrid",
  "barcelon",
  "paris saint-germain",
  "psg",
  "manchester city",
  "liverpool",
  "arsenal",
  "bayern",
  "inter milan",
  "internazionale",
];

const TIER_A_CLUBS = [
  "chelsea",
  "manchester united",
  "atletico",
  "atlético",
  "juventus",
  "ac milan",
  "dortmund",
  "marseille",
  "naples",
  "napoli",
  "leverkusen",
  "tottenham",
];

const TIER_B_CLUBS = [
  "monaco",
  "lyon",
  "lille",
  "aston villa",
  "newcastle",
  "athletic",
  "real betis",
  "villarreal",
  "rome",
  "roma",
  "atalanta",
  "benfica",
  "porto",
  "sporting",
  "ajax",
  "psv",
  "galatasaray",
  "fenerbah",
];

function clubPopularityScore(teamName: string): number {
  const n = teamName.toLowerCase();
  if (TIER_S_CLUBS.some((c) => n.includes(c))) return 20;
  if (TIER_A_CLUBS.some((c) => n.includes(c))) return 14;
  if (TIER_B_CLUBS.some((c) => n.includes(c))) return 9;
  return 4;
}

function leaguePopularityScore(league: string): number {
  const l = league.toLowerCase();
  if (
    l.includes("champions") ||
    l.includes("coupe du monde") ||
    l.includes("world cup") ||
    l === "can" ||
    l.includes("euro ")
  ) {
    return 50;
  }
  if (
    l.includes("premier league") ||
    l.includes("ligue 1") ||
    l.includes("laliga") ||
    l.includes("la liga") ||
    l.includes("serie a") ||
    l.includes("bundesliga")
  ) {
    return 42;
  }
  if (l.includes("ligue europa") || l.includes("europa league") || l.includes("nations")) {
    return 34;
  }
  if (
    l.includes("conference") ||
    l.includes("fa cup") ||
    l.includes("copa del rey") ||
    l.includes("portugal") ||
    l.includes("eredivisie")
  ) {
    return 26;
  }
  return 18;
}

function scoreRealMatchBasePopularity(m: ClientMatch): number {
  const leaguePts = leaguePopularityScore(m.league);
  const clubsPts = clubPopularityScore(m.homeTeam) + clubPopularityScore(m.awayTeam);
  const oddsGap = Math.abs(m.oddsHome - m.oddsAway);
  const suspensePts = oddsGap <= 0.8 ? 8 : oddsGap <= 1.6 ? 4 : 0;
  return leaguePts + clubsPts + suspensePts;
}

function scoreRealLivePopularity(m: ClientMatch): number {
  const base = scoreRealMatchBasePopularity(m);
  const openBonus = m.suspended ? 0 : 12;
  const goalsBonus = Math.min(8, ((m.homeScore ?? 0) + (m.awayScore ?? 0)) * 2);
  return base + openBonus + goalsBonus;
}

function scoreRealPreMatchPopularity(m: ClientMatch, earliestUpcomingMs: number): number {
  const base = scoreRealMatchBasePopularity(m);
  const kickoffMs = new Date(m.startsAt).getTime();
  const hoursAfterNext = Math.max(0, (kickoffMs - earliestUpcomingMs) / 3_600_000);
  const proximityPts =
    hoursAfterNext <= 10 ? 24 : hoursAfterNext <= 26 ? 15 : hoursAfterNext <= 54 ? 7 : 0;
  return base + proximityPts;
}

const POLL_INTERVAL = 3_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

export default function MatchsPage() {
  const {
    setFeedMatches,
    sportUniverse: selectedUniverse,
    setSportUniverse: setSelectedUniverse,
    sportStatusFilter: filter,
    setSportStatusFilter: setFilter,
    sportLeagueFilter: leagueFilter,
    setSportLeagueFilter: setLeagueFilter,
  } = useApp();
  const [oddsProfile, setOddsProfile] = useState<OddsProfileFilter>("all");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientMatch[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMatches(isBackground = false) {
      if (isBackground && typeof document !== "undefined" && document.hidden) return;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const r = await api.matches();
          if (cancelled) return;
          setMatches(r.matches);
          setFeedMatches(r.matches);
          return;
        } catch {
          if (cancelled) return;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
            continue;
          }
          if (!isBackground && !cancelled) setMatches([]);
        }
      }
    }

    void fetchMatches(false);
    const id = setInterval(() => void fetchMatches(true), POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) void fetchMatches(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [setFeedMatches]);

  // Séparation stricte des deux univers : Matchs réels (admin) vs Matchs virtuels (simulateur)
  const realMatchesAll = useMemo(
    () => (matches ?? []).filter((m) => m.source === "manual"),
    [matches]
  );
  const virtualMatchesAll = useMemo(
    () => (matches ?? []).filter((m) => m.source !== "manual"),
    [matches]
  );

  const realActiveTotal = useMemo(
    () => realMatchesAll.filter((m) => m.status !== "finished").length,
    [realMatchesAll]
  );
  const realLiveTotal = useMemo(
    () => realMatchesAll.filter((m) => m.status === "live").length,
    [realMatchesAll]
  );
  const virtualActiveTotal = useMemo(
    () => virtualMatchesAll.filter((m) => m.status !== "finished").length,
    [virtualMatchesAll]
  );
  const virtualLiveTotal = useMemo(
    () => virtualMatchesAll.filter((m) => m.status === "live").length,
    [virtualMatchesAll]
  );

  const universe: Universe =
    selectedUniverse ?? (realActiveTotal > 0 ? "real" : "virtual");
  const isRealUniverse = universe === "real";

  const universeMatches = isRealUniverse ? realMatchesAll : virtualMatchesAll;

  const searchedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return universeMatches;
    return universeMatches.filter(
      (m) =>
        m.homeTeam.toLowerCase().includes(q) ||
        m.awayTeam.toLowerCase().includes(q) ||
        m.league.toLowerCase().includes(q)
    );
  }, [universeMatches, query]);

  const activeMatches = useMemo(
    () => searchedMatches.filter((m) => m.status !== "finished"),
    [searchedMatches]
  );

  const finishedMatches = useMemo(
    () => searchedMatches.filter((m) => m.status === "finished"),
    [searchedMatches]
  );

  const liveCount = useMemo(
    () => activeMatches.filter((m) => m.status === "live").length,
    [activeMatches]
  );

  const upcomingCount = useMemo(
    () => activeMatches.filter((m) => m.status === "upcoming").length,
    [activeMatches]
  );

  const baseForTab = useMemo(() => {
    if (filter === "live") return activeMatches.filter((m) => m.status === "live");
    if (filter === "upcoming") return activeMatches.filter((m) => m.status === "upcoming");
    if (filter === "finished") return finishedMatches;
    return activeMatches;
  }, [activeMatches, finishedMatches, filter]);

  const leaguesWithCounts = useMemo(() => {
    const allSet = new Set<string>();
    for (const m of universeMatches) allSet.add(m.league);
    if (isRealUniverse && leagueFilter !== "all") {
      allSet.add(leagueFilter);
    }
    const counts = new Map<string, number>();
    for (const m of baseForTab) {
      counts.set(m.league, (counts.get(m.league) ?? 0) + 1);
    }
    return [...allSet].map((lg) => {
      if (counts.has(lg)) return { league: lg, count: counts.get(lg) ?? 0 };
      const targetSlug = resolveEspnSlugForLeague(lg);
      if (!targetSlug) return { league: lg, count: 0 };
      const aliasCount = baseForTab.filter(
        (m) => resolveEspnSlugForLeague(m.league) === targetSlug
      ).length;
      return { league: lg, count: aliasCount };
    });
  }, [universeMatches, baseForTab, isRealUniverse, leagueFilter]);

  const effectiveLeague =
    leagueFilter === "all" ||
    isRealUniverse ||
    leaguesWithCounts.some((l) => l.league === leagueFilter)
      ? leagueFilter
      : "all";

  const byLeague = useMemo(() => {
    if (effectiveLeague === "all") return baseForTab;
    const selectedSlug = resolveEspnSlugForLeague(effectiveLeague);
    return baseForTab.filter((m) => {
      if (m.league === effectiveLeague) return true;
      if (!selectedSlug) return false;
      return resolveEspnSlugForLeague(m.league) === selectedSlug;
    });
  }, [baseForTab, effectiveLeague]);

  const favCount = useMemo(
    () => byLeague.filter(isClearFavoriteMatch).length,
    [byLeague]
  );
  const tightCount = byLeague.length - favCount;

  const visible = useMemo(() => {
    if (oddsProfile === "favorite") return byLeague.filter(isClearFavoriteMatch);
    if (oddsProfile === "tight") return byLeague.filter((m) => !isClearFavoriteMatch(m));
    return byLeague;
  }, [byLeague, oddsProfile]);

  // Pour les matchs réels, tous les matchs s'affichent uniformément sous forme de cartes (aucun bloc vedette unique en haut)
  const showFeatured =
    !isRealUniverse &&
    !query.trim() &&
    oddsProfile === "all" &&
    ((filter === "all" && effectiveLeague === "all" && visible.length >= 1) ||
      (filter === "live" && visible.length >= 1));

  const featured = showFeatured
    ? (visible.find((m) => m.status === "live") ?? visible[0] ?? null)
    : null;

  const liveRest = useMemo(() => {
    const raw = visible.filter((m) => m.status === "live" && m.id !== featured?.id);
    if (!isRealUniverse) return raw;
    return [...raw].sort(
      (a, b) => scoreRealLivePopularity(b) - scoreRealLivePopularity(a) || a.id - b.id
    );
  }, [visible, featured, isRealUniverse]);

  const upcomingOrdered = useMemo(() => {
    const raw = visible.filter((m) => m.status === "upcoming" && m.id !== featured?.id);
    if (!isRealUniverse || raw.length <= 1) {
      return [...raw].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      );
    }
    const earliestMs = Math.min(...raw.map((m) => new Date(m.startsAt).getTime()));
    return [...raw].sort(
      (a, b) =>
        scoreRealPreMatchPopularity(b, earliestMs) -
          scoreRealPreMatchPopularity(a, earliestMs) ||
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
  }, [visible, featured, isRealUniverse]);

  const finishedList = useMemo(
    () => visible.filter((m) => m.status === "finished"),
    [visible]
  );

  const switchUniverse = (next: Universe) => {
    setSelectedUniverse(next);
    setLeagueFilter("all");
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-4 lg:px-0 lg:py-0">
      {/* En-tête compact */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink lg:text-[24px]">
            {isRealUniverse && effectiveLeague !== "all" ? effectiveLeague : "Matchs"}
          </h1>
          <p className="capitalize text-[12px] text-mist lg:text-[13px]">{todayLabel()}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/resultats?universe=${universe}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-elev px-2.5 font-display text-[11.5px] font-bold text-ink active:scale-95"
          >
            <History className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
            Résultats
          </Link>

          {liveCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter(filter === "live" ? "all" : "live")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-[11.5px] font-bold active:scale-95",
                isRealUniverse
                  ? "bg-emerald-600/12 text-emerald-700"
                  : "bg-betclic-red/12 text-betclic-red"
              )}
            >
              <span
                className={cn(
                  "live-dot h-1.5 w-1.5 rounded-full",
                  isRealUniverse ? "bg-emerald-600" : "bg-betclic-red"
                )}
              />
              {liveCount === 1 ? "En direct" : `${liveCount} en direct`}
            </button>
          )}
        </div>
      </div>

      {/* Sélecteur strict d'univers + Barre de recherche côte à côte sur grand écran */}
      <div className="mt-3 xl:grid xl:grid-cols-[minmax(0,1fr)_270px] xl:items-center xl:gap-3">
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-edge bg-white p-1">
          <button
            type="button"
            onClick={() => switchUniverse("real")}
            className={cn(
              "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 font-display text-[12.5px] font-bold transition-all",
              isRealUniverse
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-mist hover:bg-elev/60 active:bg-elev"
            )}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
            <span className="truncate">Matchs réels</span>
            {matches !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  isRealUniverse ? "bg-white/20 text-white" : "bg-elev text-ink"
                )}
              >
                {realLiveTotal > 0 && (
                  <span
                    className={cn(
                      "live-dot h-1.5 w-1.5 rounded-full",
                      isRealUniverse ? "bg-white" : "bg-emerald-600"
                    )}
                  />
                )}
                {realActiveTotal}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => switchUniverse("virtual")}
            className={cn(
              "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 font-display text-[12.5px] font-bold transition-all",
              !isRealUniverse
                ? "bg-betclic-red text-white shadow-xs"
                : "text-mist hover:bg-elev/60 active:bg-elev"
            )}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
            <span className="truncate">Matchs virtuels</span>
            {matches !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  !isRealUniverse ? "bg-white/20 text-white" : "bg-elev text-ink"
                )}
              >
                {virtualLiveTotal > 0 && (
                  <span
                    className={cn(
                      "live-dot h-1.5 w-1.5 rounded-full",
                      !isRealUniverse ? "bg-white" : "bg-betclic-red"
                    )}
                  />
                )}
                {virtualActiveTotal}
              </span>
            )}
          </button>
        </div>

        {/* Barre de recherche */}
        <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 xl:mt-0 xl:h-12 xl:rounded-2xl xl:px-3.5">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isRealUniverse
                ? "Rechercher un match réel ou une compétition…"
                : "Rechercher un club ou une ligue virtuelle…"
            }
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

      {/* Bandeau explicatif du mode actif */}
      <div
        className={cn(
          "mt-2 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[11px] font-medium",
          isRealUniverse
            ? "bg-emerald-600/8 text-emerald-800"
            : "bg-elev/80 text-mist"
        )}
      >
        {isRealUniverse ? (
          <span>Compétitions officielles · Cotes fixes opérateur · Coup d&apos;envoi réel</span>
        ) : (
          <span>Simulateur 24h/24 · Matchs de 2-3 min · 1 seul direct à tour de rôle</span>
        )}
      </div>

      {/* Rangée unique collante de 3 pastilles dropdown */}
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
                count: matches !== null ? activeMatches.length : undefined,
              },
              {
                value: "live",
                label: "En direct",
                count: matches !== null ? liveCount : undefined,
              },
              {
                value: "upcoming",
                label: isRealUniverse ? "Avant-match" : "À venir",
                count: matches !== null ? upcomingCount : undefined,
              },
              {
                value: "finished",
                label: "Terminés",
                count: matches !== null ? finishedMatches.length : undefined,
              },
            ],
          },
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
                count: matches !== null ? baseForTab.length : undefined,
              },
              ...leaguesWithCounts.map(({ league, count }) => ({
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
                count: matches !== null ? byLeague.length : undefined,
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
            ? `${visible.length} match${visible.length > 1 ? "s" : ""} ${
                isRealUniverse ? "réel" : "virtuel"
              }${visible.length > 1 ? "s" : ""}`
            : null
        }
      />

      {/* Contenu */}
      {matches === null ? (
        isRealUniverse ? (
          <>
            {/* Squelette mobile sur 2 lignes carrousel (Populaire EN DIRECT + Populaire en avant-match) */}
            <div className="flex flex-col gap-5 lg:hidden">
              {[0, 1].map((rowIdx) => (
                <div key={rowIdx} className="space-y-2">
                  <div className="shimmer h-4 w-44 rounded-md" />
                  <div className="-mx-4 flex gap-3 overflow-hidden px-4">
                    <div className="shimmer h-[168px] w-[85vw] max-w-[332px] shrink-0 rounded-2xl" />
                    <div className="shimmer h-[168px] w-[85vw] max-w-[332px] shrink-0 rounded-2xl" />
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden grid-cols-1 gap-3 lg:grid">
              <div className="shimmer h-[156px] rounded-2xl" />
              <div className="shimmer h-[156px] rounded-2xl" />
              <div className="shimmer h-[156px] rounded-2xl" />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="shimmer h-[196px] rounded-2xl" />
            <div className="grid grid-cols-1 gap-3">
              <div className="shimmer h-[136px] rounded-2xl" />
              <div className="shimmer h-[136px] rounded-2xl" />
            </div>
          </div>
        )
      ) : visible.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <Trophy className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink">
            {isRealUniverse && realMatchesAll.length === 0
              ? "Aucun match réel programmé"
              : "Aucun match dans cette vue"}
          </p>
          <p className="mt-1 max-w-[290px] text-[12.5px] text-dim">
            {isRealUniverse && realActiveTotal === 0 && filter !== "finished"
              ? "Les prochaines rencontres officielles publiées par l'opérateur s'afficheront ici."
              : "Modifiez ou réinitialisez les filtres pour retrouver toutes les rencontres."}
          </p>
          {isRealUniverse && realActiveTotal === 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {realMatchesAll.length > 0 && filter !== "finished" && (
                <button
                  type="button"
                  onClick={() => setFilter("finished")}
                  className="h-9 rounded-full bg-elev px-3.5 font-display text-[12px] font-bold text-ink active:scale-95"
                >
                  Voir les résultats réels ({realMatchesAll.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => switchUniverse("virtual")}
                className="h-9 rounded-full bg-betclic-red px-3.5 font-display text-[12px] font-bold text-white active:scale-95"
              >
                Ouvrir les matchs virtuels ({virtualActiveTotal})
              </button>
            </div>
          )}
        </div>
      ) : isRealUniverse ? (
        <>
          {/* MOBILE (< lg) : Classement 1xBet sur 2 lignes carrousel défilables gauche-droite */}
          <div className="flex flex-col gap-5 lg:hidden">
            {(filter === "all" || filter === "live") && (
              <RealMatchCarouselRow
                label="Populaire EN DIRECT"
                items={liveRest}
                live
                emptyMessage="Aucun match réel en direct pour le moment"
              />
            )}

            {(filter === "all" || filter === "upcoming") && (
              <RealMatchCarouselRow
                label="Populaire en avant-match"
                items={upcomingOrdered}
                emptyMessage="Aucun match réel en avant-match dans cette sélection"
              />
            )}

            {filter === "finished" && finishedList.length > 0 && (
              <RealMatchCarouselRow
                label="Résultats officiels récents"
                items={finishedList}
                trailingHref={`/resultats?universe=${universe}`}
                trailingLabel="Tout l'historique →"
              />
            )}
          </div>

          {/* DESKTOP (>= lg) : Colonne centrale de cartes MatchCard pleine largeur */}
          <div className="hidden flex-col gap-5 lg:flex">
            {liveRest.length > 0 && (
              <section>
                <SectionHeader
                  label="Populaire EN DIRECT"
                  count={liveRest.length}
                  live
                  real
                />
                <div className="mt-2 grid grid-cols-1 items-start gap-3">
                  {liveRest.map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            )}

            {upcomingOrdered.length > 0 && (
              <section>
                <SectionHeader
                  label="Populaire en avant-match"
                  count={upcomingOrdered.length}
                />
                <div className="mt-2 grid grid-cols-1 items-start gap-3">
                  {upcomingOrdered.map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            )}

            {finishedList.length > 0 && (
              <section>
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-ink">
                    Résultats officiels récents
                  </h2>
                  <Link
                    href={`/resultats?universe=${universe}`}
                    className="font-display text-[11.5px] font-bold text-betclic-red"
                  >
                    Tout l&apos;historique →
                  </Link>
                </div>
                <div className="mt-2 grid grid-cols-1 items-start gap-3">
                  {finishedList.map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-5">
          {featured && <FeaturedMatch match={featured} />}

          {liveRest.length > 0 && (
            <section>
              <SectionHeader
                label="En direct"
                count={liveRest.length}
                live
              />
              <div className="mt-2 grid grid-cols-1 items-start gap-3">
                {liveRest.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </section>
          )}

          {upcomingOrdered.length > 0 && (
            <section>
              <SectionHeader
                label="À venir · À tour de rôle"
                count={upcomingOrdered.length}
              />
              <div className="mt-2 grid grid-cols-1 items-start gap-3">
                {upcomingOrdered.map((m, idx) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    nextUp={idx === 0 && effectiveLeague === "all"}
                  />
                ))}
              </div>
            </section>
          )}

          {finishedList.length > 0 && (
            <section>
              <div className="flex items-center justify-between px-0.5">
                <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-ink">
                  Résultats virtuels récents
                </h2>
                <Link
                  href={`/resultats?universe=${universe}`}
                  className="font-display text-[11.5px] font-bold text-betclic-red"
                >
                  Tout l&apos;historique →
                </Link>
              </div>
              <div className="mt-2 grid grid-cols-1 items-start gap-3">
                {finishedList.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function RealMatchCarouselRow({
  label,
  items,
  live,
  emptyMessage,
  trailingHref,
  trailingLabel,
}: {
  label: string;
  items: ClientMatch[];
  live?: boolean;
  emptyMessage?: string;
  trailingHref?: string;
  trailingLabel?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(items.length > 1);

  const syncScrollEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 6);
    setCanRight(maxScroll - el.scrollLeft > 6);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const raf = window.requestAnimationFrame(syncScrollEdges);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncScrollEdges())
        : null;
    ro?.observe(el);
    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [items.length, syncScrollEdges]);

  const scrollStep = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(260, Math.round(el.clientWidth * 0.84));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {live && <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-emerald-600" />}
          <h2 className="truncate font-display text-[13.5px] font-bold tracking-tight text-ink">
            {label}
          </h2>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-display text-[10.5px] font-bold tabular-nums",
              live && items.length > 0
                ? "bg-emerald-600/12 text-emerald-700"
                : "bg-elev text-dim"
            )}
          >
            {items.length}
          </span>
        </div>

        {trailingHref && trailingLabel ? (
          <Link
            href={trailingHref}
            className="shrink-0 font-display text-[11.5px] font-bold text-betclic-red"
          >
            {trailingLabel}
          </Link>
        ) : items.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => scrollStep(-1)}
              disabled={!canLeft}
              aria-label={`Défiler ${label} vers la gauche`}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full border transition-all active:scale-95",
                canLeft
                  ? "border-edge bg-white text-ink shadow-2xs"
                  : "border-transparent bg-elev/60 text-dim/45"
              )}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.3} />
            </button>
            <button
              type="button"
              onClick={() => scrollStep(1)}
              disabled={!canRight}
              aria-label={`Défiler ${label} vers la droite`}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full border transition-all active:scale-95",
                canRight
                  ? "border-edge bg-white text-ink shadow-2xs"
                  : "border-transparent bg-elev/60 text-dim/45"
              )}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.3} />
            </button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="mt-2 flex h-12 items-center justify-center rounded-2xl border border-dashed border-edge bg-white/75 px-3.5 text-[12px] font-medium text-mist">
          {emptyMessage ?? "Aucun match disponible"}
        </div>
      ) : (
        <div
          ref={scrollerRef}
          onScroll={syncScrollEdges}
          className="-mx-4 mt-2 flex snap-x snap-mandatory scroll-px-4 items-stretch gap-3 overflow-x-auto px-4 pb-1 scroll-smooth no-scrollbar"
        >
          {items.map((m) => (
            <div
              key={m.id}
              className={cn(
                "shrink-0 snap-start",
                items.length === 1
                  ? "w-full"
                  : "w-[85vw] max-w-[332px] sm:w-[328px]"
              )}
            >
              <MatchCard match={m} className="h-full" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionHeader({
  label,
  count,
  live,
  real,
}: {
  label: string;
  count: number;
  live?: boolean;
  real?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <div className="flex items-center gap-1.5">
        {live && (
          <span
            className={cn(
              "live-dot h-2 w-2 rounded-full",
              real ? "bg-emerald-600" : "bg-betclic-red"
            )}
          />
        )}
        <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-ink">
          {label}
        </h2>
      </div>
      <span className="text-[11px] font-semibold text-dim">{count}</span>
    </div>
  );
}
