"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, LayoutGrid, RefreshCw } from "lucide-react";
import { api, type ClientMatch } from "@/lib/api";
import { MatchCard } from "@/components/match-card";
import { FeaturedMatch } from "@/components/featured-match";
import { LiveTicker } from "@/components/live-ticker";
import { SportIcon } from "@/components/sport-icon";
import { cn, todayLabel } from "@/lib/format";

type Filter = "all" | "live" | "football";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "live", label: "Direct" },
  { key: "football", label: "Foot" },
];

const POLL_INTERVAL = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

export default function MatchsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [matches, setMatches] = useState<ClientMatch[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMatches = useCallback(async (isBackground = false) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      if (!isBackground) setIsLoading(true);
      else setIsUpdating(true);
      setError(null);

      const r = await api.matches();
      retryCountRef.current = 0;
      setMatches(r.matches);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        await new Promise(r => setTimeout(r, RETRY_DELAY * retryCountRef.current));
        return fetchMatches(isBackground);
      }
      
      const msg = e instanceof Error ? e.message : "Erreur de chargement";
      if (!isBackground) {
        setError(msg);
        setMatches([]);
      }
      // On background error: keep previous data, just show error toast via provider if needed
    } finally {
      if (!isBackground) setIsLoading(false);
      else setIsUpdating(false);
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    fetchMatches(false);
    const id = setInterval(() => fetchMatches(true), POLL_INTERVAL);
    return () => {
      clearInterval(id);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchMatches]);

  const liveCount = useMemo(
    () => (matches ?? []).filter((m) => m.status === "live").length,
    [matches]
  );

  const visible = useMemo(() => {
    const all = (matches ?? []).filter((m) => m.status !== "finished");
    if (filter === "live") return all.filter((m) => m.status === "live");
    if (filter === "all") return all;
    return all.filter((m) => m.sport === filter);
  }, [matches, filter]);

  const live = visible.filter((m) => m.status === "live");
  const upcoming = visible.filter((m) => m.status === "upcoming");
  const featured = live[0] ?? upcoming[0] ?? null;

  const liveRest = live.slice(1);

  const upcomingByLeague = useMemo(() => {
    const map = new Map<string, ClientMatch[]>();
    for (const m of upcoming) {
      if (featured && m.id === featured.id) continue;
      map.set(m.league, [...(map.get(m.league) ?? []), m]);
    }
    return [...map.entries()];
  }, [upcoming, featured]);

  return (
    <div className="px-3 pb-24 pt-5">
      {/* Titre + compteur live */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-betclic-red">
            {todayLabel().toUpperCase()}
          </p>
          <h1 className="mt-1 font-display text-[30px] font-bold leading-none tracking-tight">
            Programme
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
          <span className={cn("h-2 w-2 rounded-full", liveCount > 0 ? "bg-live live-dot" : "bg-dim")} />
          <span className="font-display text-xl font-bold leading-none tabular-nums">{liveCount}</span>
          <span className="text-[9px] font-semibold tracking-[0.18em] text-dim">EN DIRECT</span>
          {isUpdating && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-1 rounded-md bg-betclic-red/15 px-2 py-0.5 text-[9px] font-semibold tracking-[0.18em] text-betclic-red"
            >
              <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2.5} />
              MAJ
            </motion.span>
          )}
        </div>
      </div>

      {/* Ticker live */}
      <LiveTicker live={live} />

      {/* Filtres segmentés */}
      <div className="sticky top-12 z-30 -mx-3 bg-ink/90 px-3 pb-1 pt-3 backdrop-blur-xl">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "relative flex items-center justify-center gap-1 rounded-lg py-2 transition-colors",
                  active ? "text-ink" : "text-mist"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="seg-pill"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    className="absolute inset-0 rounded-lg bg-betclic-red"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  {key === "all" && <LayoutGrid className="h-3 w-3" strokeWidth={2.4} />}
                  {key === "live" && (
                    <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-ink" : "bg-live live-dot")} />
                  )}
                  {key === "football" && <SportIcon sport="football" className="h-3 w-3" />}
                  <span className={cn("font-display text-[11.5px]", active ? "font-bold" : "font-medium")}>
                    {label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Contenu */}
      {matches === null ? (
        <Skeletons />
      ) : visible.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="glass-card grid h-16 w-16 place-items-center rounded-full text-dim">
            <Flame className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <p className="mt-4 font-display text-[15px] font-semibold">Aucun match ici</p>
          <p className="mt-1 text-[12.5px] text-dim">Revenez plus tard pour de nouvelles affiches.</p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={filter}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {featured && <FeaturedMatch match={featured} />}

            {liveRest.length > 0 && (
              <section className="mt-6">
                <SectionHeader label="Aussi en direct" count={liveRest.length} pulse />
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {liveRest.map((m, i) => (
                    <MatchCard key={m.id} match={m} index={i} />
                  ))}
                </div>
              </section>
            )}

            {upcomingByLeague.length > 0 && (
              <section className="mt-6">
                <SectionHeader
                  label="À venir"
                  count={upcoming.length - (featured?.status === "upcoming" ? 1 : 0)}
                />
                <div className="mt-3 flex flex-col gap-5">
                  {upcomingByLeague.map(([league, group]) => (
                    <div key={league}>
                      <div className="mb-2 flex items-center gap-2 px-1">
                        <SportIcon sport={group[0].sport} className="h-3.5 w-3.5 text-dim" />
                        <span className="text-[11px] font-semibold tracking-wide text-mist">
                          {league}
                        </span>
                        <span className="h-px flex-1 bg-white/[0.06]" />
                        <span className="font-display text-[10px] font-bold text-dim">
                          {group.length}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {group.map((m, i) => (
                          <MatchCard key={m.id} match={m} index={i + liveRest.length} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <p className="mt-8 text-center text-[10px] leading-relaxed text-dim">
        Cotes fournies à titre indicatif · 18+ · Jouez de manière responsable.
      </p>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  pulse,
}: {
  label: string;
  count: number;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      {pulse ? (
        <span className="live-dot h-2 w-2 rounded-full bg-live" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-betclic-red/70" />
      )}
      <h2 className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-white">
        {label}
      </h2>
      <span className="h-px flex-1 bg-white/[0.06]" />
      <span className="rounded-md bg-white/[0.05] px-2 py-0.5 font-display text-[10.5px] font-bold text-mist">
        {count}
      </span>
    </div>
  );
}

function Skeletons() {
  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <div className="shimmer h-[220px] rounded-[20px]" />
      {[0, 1].map((i) => (
        <div key={i} className="shimmer h-[144px] rounded-[18px]" />
      ))}
    </div>
  );
}
