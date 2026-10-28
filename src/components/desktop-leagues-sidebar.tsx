"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { SportIcon } from "@/components/sport-icon";
import { useApp, useFeedMatches } from "@/components/providers";
import { triggerRouteLoader } from "@/components/pulse-flash-loader";
import {
  OFFICIAL_SOCCER_LEAGUES,
  resolveEspnSlugForLeague,
} from "@/lib/real-leagues";
import { cn } from "@/lib/format";

interface LeagueEntry {
  key: string;
  filterValue: string;
  label: string;
  topDisplayLabel: string;
  country: string;
  slug: string | null;
  totalCount: number;
  liveCount: number;
}

const TOP_COMPETITION_SLUGS = [
  "fra.1",
  "eng.1",
  "esp.1",
  "ger.1",
  "ita.1",
  "uefa.champions",
  "uefa.europa",
] as const;

function formatTopLabel(country: string, label: string): string {
  if (country === "UEFA" || country === "FIFA" || country === "Afrique") {
    return label;
  }
  if (label.toLowerCase().startsWith(country.toLowerCase())) {
    return label;
  }
  return `${country} ${label}`;
}

function CountryFlagCircle({
  country,
  className,
}: {
  country: string;
  className?: string;
}) {
  const base = cn(
    "relative inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10",
    className
  );

  switch (country) {
    case "France":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="8" height="24" x="0" fill="#002654" />
            <rect width="8" height="24" x="8" fill="#ffffff" />
            <rect width="8" height="24" x="16" fill="#ed2939" />
          </svg>
        </span>
      );
    case "Espagne":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="24" height="6" y="0" fill="#aa151b" />
            <rect width="24" height="12" y="6" fill="#f1bf00" />
            <rect width="24" height="6" y="18" fill="#aa151b" />
          </svg>
        </span>
      );
    case "Allemagne":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="24" height="8" y="0" fill="#111827" />
            <rect width="24" height="8" y="8" fill="#dd0000" />
            <rect width="24" height="8" y="16" fill="#ffce00" />
          </svg>
        </span>
      );
    case "Italie":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="8" height="24" x="0" fill="#009246" />
            <rect width="8" height="24" x="8" fill="#ffffff" />
            <rect width="8" height="24" x="16" fill="#ce2b37" />
          </svg>
        </span>
      );
    case "Angleterre":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="24" height="24" fill="#ffffff" />
            <rect x="9.5" y="0" width="5" height="24" fill="#ce1124" />
            <rect x="0" y="9.5" width="24" height="5" fill="#ce1124" />
          </svg>
        </span>
      );
    case "Portugal":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="9.5" height="24" x="0" fill="#006600" />
            <rect width="14.5" height="24" x="9.5" fill="#ff0000" />
            <circle cx="9.5" cy="12" r="3.6" fill="#ffcc00" />
          </svg>
        </span>
      );
    case "Pays-Bas":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="24" height="8" y="0" fill="#ae1c28" />
            <rect width="24" height="8" y="8" fill="#ffffff" />
            <rect width="24" height="8" y="16" fill="#21468b" />
          </svg>
        </span>
      );
    case "Belgique":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="8" height="24" x="0" fill="#111827" />
            <rect width="8" height="24" x="8" fill="#fae042" />
            <rect width="8" height="24" x="16" fill="#ed2939" />
          </svg>
        </span>
      );
    case "Turquie":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="24" height="24" fill="#e30a17" />
            <circle cx="10.4" cy="12" r="5" fill="#ffffff" />
            <circle cx="11.7" cy="12" r="4" fill="#e30a17" />
            <polygon
              points="15.3,12 18.1,13 16.4,10.6 16.4,13.4 18.1,11"
              fill="#ffffff"
            />
          </svg>
        </span>
      );
    case "Arabie Saoudite":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="24" height="24" fill="#006c35" />
            <rect x="6" y="13.5" width="12" height="1.8" rx="0.9" fill="#ffffff" />
            <rect x="7" y="9" width="10" height="2" rx="1" fill="#ffffff" opacity="0.85" />
          </svg>
        </span>
      );
    case "États-Unis":
      return (
        <span className={base} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <rect width="24" height="24" fill="#b22234" />
            <rect width="24" height="3.2" y="3.4" fill="#ffffff" />
            <rect width="24" height="3.2" y="10" fill="#ffffff" />
            <rect width="24" height="3.2" y="16.8" fill="#ffffff" />
            <rect width="11.5" height="12" x="0" y="0" fill="#3c3b6e" />
          </svg>
        </span>
      );
    case "UEFA":
    case "Europe (UEFA)":
      return (
        <span className={cn(base, "bg-[#0b2a6e] text-white")} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <polygon points="12,2.2 14.7,8.4 21.4,9.1 16.3,13.6 17.8,20.2 12,16.7 6.2,20.2 7.7,13.6 2.6,9.1 9.3,8.4" />
          </svg>
        </span>
      );
    case "Afrique":
      return (
        <span className={cn(base, "bg-emerald-700 text-amber-300")} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <circle cx="12" cy="12" r="7" />
          </svg>
        </span>
      );
    default:
      return (
        <span
          className={cn(
            base,
            "bg-elev font-display text-[9.5px] font-medium uppercase text-ink"
          )}
          aria-hidden
        >
          {country.slice(0, 2)}
        </span>
      );
  }
}

export function DesktopLeaguesSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    sportUniverse,
    setSportUniverse,
    sportLeagueFilter,
    setSportLeagueFilter,
    setSportStatusFilter,
  } = useApp();
  const feedMatches = useFeedMatches();

  const [footballOpen, setFootballOpen] = useState(true);
  const [expandedCountries, setExpandedCountries] = useState<Record<string, boolean>>({});

  const isOnMatchs = pathname === "/matchs" || pathname.startsWith("/matchs/");

  const {
    realActiveTotal,
    realLiveTotal,
    virtualActiveTotal,
    virtualLiveTotal,
    effectiveUniverse,
    topCompetitions,
    countriesAz,
  } = useMemo(() => {
    const all = feedMatches ?? [];
    const realActive = all.filter(
      (m) => m.source === "manual" && (m.status === "live" || m.status === "upcoming")
    );
    const virtualActive = all.filter(
      (m) => m.source !== "manual" && (m.status === "live" || m.status === "upcoming")
    );

    const effUniverse: "real" | "virtual" =
      sportUniverse ?? (realActive.length > 0 ? "real" : "virtual");

    const countsBySlug = new Map<string, { total: number; live: number; rawLabel: string }>();
    const customLeagues = new Map<string, { total: number; live: number }>();

    for (const m of realActive) {
      const slug = resolveEspnSlugForLeague(m.league);
      if (slug) {
        const cur = countsBySlug.get(slug) ?? { total: 0, live: 0, rawLabel: m.league };
        cur.total += 1;
        if (m.status === "live") cur.live += 1;
        countsBySlug.set(slug, cur);
      } else {
        const cur = customLeagues.get(m.league) ?? { total: 0, live: 0 };
        cur.total += 1;
        if (m.status === "live") cur.live += 1;
        customLeagues.set(m.league, cur);
      }
    }

    const officialEntries: LeagueEntry[] = OFFICIAL_SOCCER_LEAGUES.map((lg) => {
      const stat = countsBySlug.get(lg.slug);
      return {
        key: lg.slug,
        filterValue: lg.label,
        label: lg.label,
        topDisplayLabel: formatTopLabel(lg.country, lg.label),
        country:
          lg.country === "UEFA"
            ? "Europe (UEFA)"
            : lg.country === "FIFA"
              ? "International"
              : lg.country,
        slug: lg.slug,
        totalCount: stat?.total ?? 0,
        liveCount: stat?.live ?? 0,
      };
    });

    const customEntries: LeagueEntry[] = [...customLeagues.entries()].map(
      ([leagueName, stat]) => ({
        key: `custom-${leagueName}`,
        filterValue: leagueName,
        label: leagueName,
        topDisplayLabel: leagueName,
        country: "International",
        slug: null,
        totalCount: stat.total,
        liveCount: stat.live,
      })
    );

    const allEntries = [...officialEntries, ...customEntries];

    const topSet = new Set<string>(TOP_COMPETITION_SLUGS);
    const topList = allEntries
      .filter((e) => (e.slug && topSet.has(e.slug)) || e.totalCount > 0)
      .sort((a, b) => {
        if ((b.liveCount > 0) !== (a.liveCount > 0)) return b.liveCount > 0 ? 1 : -1;
        if ((b.totalCount > 0) !== (a.totalCount > 0)) return b.totalCount > 0 ? 1 : -1;
        const idxA = a.slug ? TOP_COMPETITION_SLUGS.indexOf(a.slug as (typeof TOP_COMPETITION_SLUGS)[number]) : 99;
        const idxB = b.slug ? TOP_COMPETITION_SLUGS.indexOf(b.slug as (typeof TOP_COMPETITION_SLUGS)[number]) : 99;
        const rankA = idxA === -1 ? 99 : idxA;
        const rankB = idxB === -1 ? 99 : idxB;
        if (rankA !== rankB) return rankA - rankB;
        return b.totalCount - a.totalCount;
      });

    const groupedMap = new Map<
      string,
      { country: string; flagCountry: string; leagues: LeagueEntry[]; total: number; live: number }
    >();
    for (const entry of allEntries) {
      const existing = groupedMap.get(entry.country);
      const flagCountry =
        entry.country === "Europe (UEFA)"
          ? "UEFA"
          : entry.country === "International"
            ? "FIFA"
            : entry.country;
      if (existing) {
        existing.leagues.push(entry);
        existing.total += entry.totalCount;
        existing.live += entry.liveCount;
      } else {
        groupedMap.set(entry.country, {
          country: entry.country,
          flagCountry,
          leagues: [entry],
          total: entry.totalCount,
          live: entry.liveCount,
        });
      }
    }

    const sortedCountries = [...groupedMap.values()].sort((a, b) =>
      a.country.localeCompare(b.country, "fr", { sensitivity: "base" })
    );

    return {
      realActiveTotal: realActive.length,
      realLiveTotal: realActive.filter((m) => m.status === "live").length,
      virtualActiveTotal: virtualActive.length,
      virtualLiveTotal: virtualActive.filter((m) => m.status === "live").length,
      effectiveUniverse: effUniverse,
      topCompetitions: topList,
      countriesAz: sortedCountries,
    };
  }, [feedMatches, sportUniverse]);

  const selectRealLeague = (leagueValue: string) => {
    setSportUniverse("real");
    setSportLeagueFilter(leagueValue);
    if (leagueValue === "all") {
      setSportStatusFilter("all");
    }
    if (pathname !== "/matchs" && pathname !== "/matchs/tous") {
      triggerRouteLoader("/matchs");
      router.push("/matchs");
    }
  };

  const selectVirtualUniverse = () => {
    setSportUniverse("virtual");
    setSportLeagueFilter("all");
    setSportStatusFilter("all");
    if (pathname === "/matchs/tous") {
      triggerRouteLoader("/matchs/virtuels");
      router.push("/matchs/virtuels");
    } else if (!isOnMatchs) {
      triggerRouteLoader("/matchs");
      router.push("/matchs");
    }
  };

  const toggleCountry = (country: string) => {
    setExpandedCountries((prev) => ({ ...prev, [country]: !prev[country] }));
  };

  const isLeagueSelected = (entry: LeagueEntry) => {
    if (!isOnMatchs || effectiveUniverse !== "real") return false;
    if (sportLeagueFilter === entry.filterValue) return true;
    const selectedSlug = resolveEspnSlugForLeague(sportLeagueFilter);
    return Boolean(selectedSlug && entry.slug && selectedSlug === entry.slug);
  };

  const isAllRealSelected =
    isOnMatchs && effectiveUniverse === "real" && sportLeagueFilter === "all";
  const isVirtualSelected = isOnMatchs && effectiveUniverse === "virtual";

  return (
    <aside
      aria-label="Compétitions et ligues"
      className="hidden lg:sticky lg:top-[76px] lg:block"
    >
      <div className="glass-card flex max-h-[calc(100dvh-96px)] flex-col overflow-hidden rounded-2xl">
        {/* En-tête accordéon Football */}
        <button
          type="button"
          onClick={() => setFootballOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2.5 border-b border-edge px-4 py-3.5 text-left transition-colors hover:bg-elev/50"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elev text-ink">
              <SportIcon sport="football" className="h-4 w-4 text-ink" />
            </span>
            <span className="font-display text-[12px] font-medium tracking-tight text-ink">
              Football
            </span>
          </div>
          {footballOpen ? (
            <ChevronUp className="h-4 w-4 text-mist" strokeWidth={2.3} />
          ) : (
            <ChevronDown className="h-4 w-4 text-mist" strokeWidth={2.3} />
          )}
        </button>

        {footballOpen && (
          <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
            {/* Toute l'offre */}
            <button
              type="button"
              onClick={() => selectRealLeague("all")}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors",
                isAllRealSelected
                  ? "bg-betclic-red/8 text-betclic-red"
                  : "text-ink hover:bg-elev/60"
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full",
                    isAllRealSelected
                      ? "bg-betclic-red text-white"
                      : "bg-elev text-ink"
                  )}
                >
                  <SportIcon sport="football" className="h-3.5 w-3.5" />
                </span>
                <span className="truncate font-display text-[11.5px] font-medium">
                  Toute l&apos;offre
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {realLiveTotal > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/12 px-1.5 py-0.5 font-display text-[9.5px] font-medium text-betclic-red">
                    <span className="live-dot !h-1.5 !w-1.5" />
                    {realLiveTotal}
                  </span>
                )}
                {realActiveTotal > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 font-display text-[10px] font-medium tabular-nums",
                      isAllRealSelected
                        ? "bg-betclic-red text-white"
                        : "bg-elev text-mist"
                    )}
                  >
                    {realActiveTotal}
                  </span>
                )}
              </div>
            </button>

            {/* Top des compétitions */}
            <div className="mt-1 border-t border-edge/70 pt-2.5">
              <p className="px-4 pb-1.5 text-[10px] font-medium text-dim">
                Top des compétitions
              </p>

              <div className="space-y-0.5">
                {topCompetitions.map((entry) => {
                  const selected = isLeagueSelected(entry);
                  const flagCountry =
                    entry.country === "Europe (UEFA)"
                      ? "UEFA"
                      : entry.country === "International"
                        ? "FIFA"
                        : entry.country;

                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => selectRealLeague(entry.filterValue)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-4 py-2 text-left transition-colors",
                        selected
                          ? "bg-betclic-red/8 text-betclic-red"
                          : "text-ink hover:bg-elev/60"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CountryFlagCircle country={flagCountry} />
                        <span
                          className={cn(
                            "truncate text-[11px]",
                            selected ? "font-medium text-betclic-red" : "font-medium text-ink"
                          )}
                        >
                          {entry.topDisplayLabel}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {entry.liveCount > 0 && (
                          <span className="live-dot !h-1.5 !w-1.5" title="En direct" />
                        )}
                        {entry.totalCount > 0 && (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 font-display text-[10px] font-medium tabular-nums",
                              selected
                                ? "bg-betclic-red text-white"
                                : "bg-elev text-mist"
                            )}
                          >
                            {entry.totalCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pays (A-Z) */}
            <div className="mt-2 border-t border-edge/70 pt-2.5">
              <p className="px-4 pb-1.5 text-[10px] font-medium text-dim">
                Pays (A-Z)
              </p>

              <div className="space-y-0.5">
                {countriesAz.map((group) => {
                  const hasSelectedChild = group.leagues.some((l) => isLeagueSelected(l));
                  const isOpen = expandedCountries[group.country] ?? hasSelectedChild;

                  return (
                    <div key={group.country}>
                      <button
                        type="button"
                        onClick={() => toggleCountry(group.country)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-4 py-2 text-left transition-colors hover:bg-elev/60",
                          hasSelectedChild ? "text-betclic-red" : "text-ink"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CountryFlagCircle country={group.flagCountry} />
                          <span className="truncate text-[11px] font-medium">
                            {group.country}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {group.live > 0 && (
                            <span className="live-dot !h-1.5 !w-1.5" title="En direct" />
                          )}
                          {group.total > 0 && (
                            <span className="rounded-full bg-elev px-1.5 py-0.5 font-display text-[9.5px] font-medium tabular-nums text-mist">
                              {group.total}
                            </span>
                          )}
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-mist transition-transform duration-150",
                              isOpen && "rotate-180"
                            )}
                            strokeWidth={2.1}
                          />
                        </div>
                      </button>

                      {isOpen && (
                        <div className="bg-elev/35 py-1">
                          {group.leagues.map((entry) => {
                            const selected = isLeagueSelected(entry);
                            return (
                              <button
                                key={entry.key}
                                type="button"
                                onClick={() => selectRealLeague(entry.filterValue)}
                                className={cn(
                                  "flex w-full items-center justify-between gap-2 py-1.5 pl-12 pr-4 text-left text-[11px] transition-colors",
                                  selected
                                    ? "bg-betclic-red/10 font-medium text-betclic-red"
                                    : "font-medium text-ink hover:bg-elev/70"
                                )}
                              >
                                <span className="truncate">{entry.label}</span>
                                <div className="flex shrink-0 items-center gap-1">
                                  {entry.liveCount > 0 && (
                                    <span className="live-dot !h-1.5 !w-1.5" />
                                  )}
                                  {entry.totalCount > 0 && (
                                    <span
                                      className={cn(
                                        "rounded-full px-1.5 py-0.5 font-display text-[9.5px] font-medium tabular-nums",
                                        selected
                                          ? "bg-betclic-red text-white"
                                          : "bg-white text-mist"
                                      )}
                                    >
                                      {entry.totalCount}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Univers Virtuel 24/7 séparé */}
            <div className="mt-2 border-t border-edge/70 pt-2 pb-1">
              <p className="px-4 pb-1 text-[10px] font-medium text-dim">
                Simulation 24/7
              </p>
              <button
                type="button"
                onClick={selectVirtualUniverse}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-4 py-2 text-left transition-colors",
                  isVirtualSelected
                    ? "bg-betclic-red/8 text-betclic-red"
                    : "text-ink hover:bg-elev/60"
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full",
                      isVirtualSelected
                        ? "bg-betclic-red text-white"
                        : "bg-betclic-red/10 text-betclic-red"
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </span>
                  <span
                    className={cn(
                      "truncate text-[11px]",
                      isVirtualSelected ? "font-medium text-betclic-red" : "font-medium text-ink"
                    )}
                  >
                    Ligue Virtuelle 24/7
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {virtualLiveTotal > 0 && (
                    <span className="live-dot !h-1.5 !w-1.5" title="En direct" />
                  )}
                  {virtualActiveTotal > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 font-display text-[10px] font-medium tabular-nums",
                        isVirtualSelected
                          ? "bg-betclic-red text-white"
                          : "bg-elev text-mist"
                      )}
                    >
                      {virtualActiveTotal}
                    </span>
                  )}
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
