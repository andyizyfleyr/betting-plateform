"use client";

import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { api, type ClientMatch } from "@/lib/api";
import { MatchCard } from "@/components/match-card";
import { FeaturedMatch } from "@/components/featured-match";
import { SportIcon } from "@/components/sport-icon";
import { cn, todayLabel } from "@/lib/format";

type Filter = "all" | "live" | "upcoming";

const POLL_INTERVAL = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

export default function MatchsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
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
  }, []);

  const activeMatches = useMemo(
    () => (matches ?? []).filter((m) => m.status !== "finished"),
    [matches]
  );

  const liveCount = useMemo(
    () => activeMatches.filter((m) => m.status === "live").length,
    [activeMatches]
  );

  const upcomingCount = useMemo(
    () => activeMatches.filter((m) => m.status === "upcoming").length,
    [activeMatches]
  );

  const leagues = useMemo(() => {
    const set = new Set<string>();
    for (const m of activeMatches) set.add(m.league);
    return [...set];
  }, [activeMatches]);

  const visible = useMemo(() => {
    let list = activeMatches;
    if (filter === "live") list = list.filter((m) => m.status === "live");
    else if (filter === "upcoming") list = list.filter((m) => m.status === "upcoming");
    if (leagueFilter !== "all") list = list.filter((m) => m.league === leagueFilter);
    return list;
  }, [activeMatches, filter, leagueFilter]);

  const showFeatured = filter === "all" && leagueFilter === "all" && visible.length > 1;
  const featured = showFeatured
    ? (visible.find((m) => m.status === "live") ?? visible[0] ?? null)
    : null;

  const liveRest = visible.filter((m) => m.status === "live" && m.id !== featured?.id);

  const upcomingByLeague = useMemo(() => {
    const map = new Map<string, ClientMatch[]>();
    for (const m of visible) {
      if (m.status !== "upcoming") continue;
      if (featured && m.id === featured.id) continue;
      map.set(m.league, [...(map.get(m.league) ?? []), m]);
    }
    return [...map.entries()];
  }, [visible, featured]);

  return (
    <div className="px-4 pb-8 pt-4">
      {/* En-tête compact */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Matchs
          </h1>
          <p className="capitalize text-[12px] text-mist">{todayLabel()}</p>
        </div>

        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-betclic-red/10 px-2.5 py-1 font-display text-[11.5px] font-bold text-betclic-red">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
            {liveCount} en direct
          </span>
        )}
      </div>

      {/* Filtres collants */}
      <div className="sticky top-[52px] z-30 -mx-4 mt-3 border-b border-edge/70 bg-deep/95 px-4 py-2 backdrop-blur-md">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-edge bg-white p-1">
          {(
            [
              { key: "all", label: `Tous (${activeMatches.length})` },
              { key: "live", label: `Direct (${liveCount})`, dot: liveCount > 0 },
              { key: "upcoming", label: `À venir (${upcomingCount})` },
            ] as const
          ).map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-lg font-display text-[11.5px] transition-colors",
                  active
                    ? "bg-ink font-bold text-white"
                    : "font-medium text-mist active:bg-elev"
                )}
              >
                {"dot" in item && item.dot && (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      active ? "bg-betclic-red" : "live-dot bg-betclic-red"
                    )}
                  />
                )}
                <span>{item.label}</span>
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
                leagueFilter === "all"
                  ? "border-betclic-red bg-betclic-red text-white font-semibold"
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
                  leagueFilter === lg
                    ? "border-betclic-red bg-betclic-red text-white font-semibold"
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
            Aucun match trouvé
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            Changez de filtre pour voir les autres rencontres.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {featured && <FeaturedMatch match={featured} />}

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

          {upcomingByLeague.length > 0 && (
            <section className="flex flex-col gap-4">
              {upcomingByLeague.map(([league, group]) => (
                <div key={league}>
                  <div className="mb-2 flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-1.5">
                      <SportIcon sport={group[0].sport} className="h-3.5 w-3.5 text-dim" />
                      <h2 className="font-display text-[12.5px] font-bold text-ink">{league}</h2>
                    </div>
                    <span className="text-[11px] font-medium text-dim">
                      {group.length} {group.length > 1 ? "matchs" : "match"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {group.map((m) => (
                      <MatchCard key={m.id} match={m} />
                    ))}
                  </div>
                </div>
              ))}
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
