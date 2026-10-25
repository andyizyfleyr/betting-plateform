"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Trophy, X } from "lucide-react";
import { api, type ClientMatch } from "@/lib/api";
import { MatchCard } from "@/components/match-card";
import { FeaturedMatch } from "@/components/featured-match";
import { AiRecommendationsStrip } from "@/components/ai-recommendations-strip";
import { useApp } from "@/components/providers";
import { cn, todayLabel } from "@/lib/format";

type Filter = "all" | "live" | "upcoming" | "finished";

const POLL_INTERVAL = 3_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

export default function MatchsPage() {
  const { setFeedMatches } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
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

  const allMatches = useMemo(() => matches ?? [], [matches]);

  const activeMatches = useMemo(
    () => allMatches.filter((m) => m.status !== "finished"),
    [allMatches]
  );

  const finishedMatches = useMemo(
    () => allMatches.filter((m) => m.status === "finished"),
    [allMatches]
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

  const leagues = useMemo(() => {
    const set = new Set<string>();
    for (const m of baseForTab) set.add(m.league);
    return [...set];
  }, [baseForTab]);

  const effectiveLeague =
    leagueFilter === "all" || leagues.includes(leagueFilter) ? leagueFilter : "all";

  const visible = useMemo(() => {
    const byLeague =
      effectiveLeague === "all"
        ? baseForTab
        : baseForTab.filter((m) => m.league === effectiveLeague);
    const q = query.trim().toLowerCase();
    if (!q) return byLeague;
    return byLeague.filter(
      (m) =>
        m.homeTeam.toLowerCase().includes(q) ||
        m.awayTeam.toLowerCase().includes(q) ||
        m.league.toLowerCase().includes(q)
    );
  }, [baseForTab, effectiveLeague, query]);

  const showFeatured =
    !query.trim() &&
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

        <div className="flex items-center gap-1.5">
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
          <button
            type="button"
            onClick={() => {
              setSearchOpen((s) => {
                if (s) setQuery("");
                return !s;
              });
            }}
            aria-label="Rechercher un match"
            className={cn(
              "grid h-8 w-8 place-items-center rounded-full border transition-colors active:scale-95",
              searchOpen
                ? "border-ink bg-ink text-white"
                : "border-edge bg-white text-mist"
            )}
          >
            {searchOpen ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un club ou une ligue…"
            autoFocus
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-dim"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="text-dim">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Barre de filtres collante optimisée petits écrans */}
      <div className="sticky top-[52px] z-30 -mx-4 mt-3 border-b border-edge/70 bg-deep/95 px-4 py-2 backdrop-blur-md">
        <div
          className={cn(
            "grid gap-1 rounded-xl border border-edge bg-white p-1",
            finishedMatches.length > 0 ? "grid-cols-4" : "grid-cols-3"
          )}
        >
          {(
            [
              { key: "all" as const, label: "Affiche", count: activeMatches.length },
              {
                key: "live" as const,
                label: "Direct",
                count: liveCount,
                dot: liveCount > 0,
              },
              { key: "upcoming" as const, label: "À venir", count: upcomingCount },
              ...(finishedMatches.length > 0
                ? [
                    {
                      key: "finished" as const,
                      label: "Scores",
                      count: finishedMatches.length,
                    },
                  ]
                : []),
            ]
          ).map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setFilter(item.key);
                  setLeagueFilter("all");
                }}
                className={cn(
                  "flex h-9 items-center justify-center gap-1 rounded-lg px-1 font-display text-[11px] transition-colors",
                  active
                    ? "bg-ink font-bold text-white"
                    : "font-semibold text-mist active:bg-elev"
                )}
              >
                {"dot" in item && item.dot && (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      active ? "bg-betclic-red" : "live-dot bg-betclic-red"
                    )}
                  />
                )}
                <span className="truncate">{item.label}</span>
                <span
                  className={cn(
                    "font-display text-[10px] tabular-nums",
                    active ? "text-white/75" : "text-dim"
                  )}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        {leagues.length > 1 && (
          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setLeagueFilter("all")}
              className={cn(
                "h-7 shrink-0 rounded-full border px-3 text-[11.5px] font-medium transition-colors",
                effectiveLeague === "all"
                  ? "border-betclic-red bg-betclic-red font-semibold text-white"
                  : "border-edge bg-white text-mist"
              )}
            >
              Toutes ligues
            </button>
            {leagues.map((lg) => (
              <button
                key={lg}
                type="button"
                onClick={() => setLeagueFilter(lg)}
                className={cn(
                  "h-7 shrink-0 rounded-full border px-3 text-[11.5px] font-medium transition-colors",
                  effectiveLeague === lg
                    ? "border-betclic-red bg-betclic-red font-semibold text-white"
                    : "border-edge bg-white text-mist"
                )}
              >
                {lg}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Contenu */}
      {matches === null ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="shimmer h-[196px] rounded-2xl" />
          <div className="shimmer h-[136px] rounded-2xl" />
          <div className="shimmer h-[136px] rounded-2xl" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-14 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <Trophy className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink">
            Aucun match dans cette vue
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            Touchez « Affiche » pour retrouver toutes les rencontres ouvertes.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
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
              <SectionHeader label="Résultats récents" count={finishedList.length} />
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
