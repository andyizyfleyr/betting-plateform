"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, Search, Trophy, X } from "lucide-react";
import { api, type ClientMatch } from "@/lib/api";
import { MatchCard } from "@/components/match-card";
import { FeaturedMatch } from "@/components/featured-match";
import { AiRecommendationsStrip } from "@/components/ai-recommendations-strip";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { useApp } from "@/components/providers";
import { todayLabel } from "@/lib/format";

type Filter = "all" | "live" | "upcoming" | "finished";
type OddsProfileFilter = "all" | "favorite" | "tight";

function isClearFavoriteMatch(m: ClientMatch): boolean {
  return Math.min(m.oddsHome, m.oddsAway) <= 1.85;
}

const POLL_INTERVAL = 3_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

export default function MatchsPage() {
  const { setFeedMatches } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
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
      setFeedMatches(null);
    };
  }, [setFeedMatches]);

  const searchedMatches = useMemo(() => {
    const base = matches ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (m) =>
        m.homeTeam.toLowerCase().includes(q) ||
        m.awayTeam.toLowerCase().includes(q) ||
        m.league.toLowerCase().includes(q)
    );
  }, [matches, query]);

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
    for (const m of matches ?? []) allSet.add(m.league);
    const counts = new Map<string, number>();
    for (const m of baseForTab) {
      counts.set(m.league, (counts.get(m.league) ?? 0) + 1);
    }
    return [...allSet].map((lg) => ({ league: lg, count: counts.get(lg) ?? 0 }));
  }, [matches, baseForTab]);

  const effectiveLeague =
    leagueFilter === "all" || leaguesWithCounts.some((l) => l.league === leagueFilter)
      ? leagueFilter
      : "all";

  const byLeague = useMemo(
    () =>
      effectiveLeague === "all"
        ? baseForTab
        : baseForTab.filter((m) => m.league === effectiveLeague),
    [baseForTab, effectiveLeague]
  );

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

  const showFeatured =
    !query.trim() &&
    oddsProfile === "all" &&
    ((filter === "all" && effectiveLeague === "all" && visible.length >= 1) ||
      (filter === "live" && visible.length >= 1));

  const featured = showFeatured
    ? (visible.find((m) => m.status === "live") ?? visible[0] ?? null)
    : null;

  const liveRest = visible.filter((m) => m.status === "live" && m.id !== featured?.id);

  // File d'attente chronologique stricte (« à tour de rôle »)
  const upcomingOrdered = useMemo(
    () =>
      visible
        .filter((m) => m.status === "upcoming" && m.id !== featured?.id)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [visible, featured]
  );

  const finishedList = useMemo(
    () => visible.filter((m) => m.status === "finished"),
    [visible]
  );

  return (
    <div className="px-4 pb-8 pt-4">
      {/* En-tête compact */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Matchs
          </h1>
          <p className="capitalize text-[12px] text-mist">{todayLabel()}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/resultats"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-elev px-2.5 font-display text-[11.5px] font-bold text-ink active:scale-95"
          >
            <History className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
            Résultats
          </Link>

          {liveCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter(filter === "live" ? "all" : "live")}
              className="inline-flex items-center gap-1.5 rounded-full bg-betclic-red/12 px-2.5 py-1 font-display text-[11.5px] font-bold text-betclic-red active:scale-95"
            >
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
              {liveCount === 1 ? "En direct" : `${liveCount} en direct`}
            </button>
          )}
        </div>
      </div>

      {/* Barre de recherche (marge 16 px gauche/droite) */}
      <div className="mt-3 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un club ou une ligue…"
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
                label: "À venir",
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
            ? `${visible.length} match${visible.length > 1 ? "s" : ""}`
            : null
        }
      />

      {/* Contenu */}
      {matches === null ? (
        <div className="flex flex-col gap-3">
          <div className="shimmer h-[196px] rounded-2xl" />
          <div className="shimmer h-[136px] rounded-2xl" />
          <div className="shimmer h-[136px] rounded-2xl" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <Trophy className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink">
            Aucun match dans cette vue
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            Modifiez ou réinitialisez les filtres pour retrouver toutes les rencontres.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {featured && <FeaturedMatch match={featured} />}

          {filter === "all" && !query.trim() && (
            <AiRecommendationsStrip matches={activeMatches} />
          )}

          {liveRest.length > 0 && (
            <section>
              <SectionHeader label="En direct" count={liveRest.length} live />
              <div className="mt-2 flex flex-col gap-2.5">
                {liveRest.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </section>
          )}

          {upcomingOrdered.length > 0 && (
            <section>
              <SectionHeader label="À venir · À tour de rôle" count={upcomingOrdered.length} />
              <div className="mt-2 flex flex-col gap-2.5">
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
                  Résultats récents
                </h2>
                <Link
                  href="/resultats"
                  className="font-display text-[11.5px] font-bold text-betclic-red"
                >
                  Tout l&apos;historique →
                </Link>
              </div>
              <div className="mt-2 flex flex-col gap-2.5">
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

function SectionHeader({
  label,
  count,
  live,
}: {
  label: string;
  count: number;
  live?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <div className="flex items-center gap-1.5">
        {live && <span className="live-dot h-2 w-2 rounded-full bg-betclic-red" />}
        <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-ink">
          {label}
        </h2>
      </div>
      <span className="text-[11px] font-semibold text-dim">{count}</span>
    </div>
  );
}
