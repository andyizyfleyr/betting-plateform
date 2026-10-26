"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Cpu,
  History,
  List,
  RefreshCw,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { api, type ClientMatch } from "@/lib/api";
import { MatchCard } from "@/components/match-card";
import {
  MobileHeroCarousel,
  type HeroPromoAction,
} from "@/components/mobile-hero-carousel";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useApp } from "@/components/providers";
import {
  matchesSearchAndOdds,
  sortByKickoffAsc,
  sortRealLiveByPopularity,
  sortRealUpcomingByPopularity,
  VIRTUAL_FILTER_VALUE,
} from "@/lib/matches-catalog";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import { resolveEspnSlugForLeague } from "@/lib/real-leagues";
import { cn, todayLabel } from "@/lib/format";

type Universe = "real" | "virtual";

const POLL_INTERVAL = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;
const INITIAL_CAROUSEL_WINDOW = 12;
const CAROUSEL_WINDOW_STEP = 12;
const MOBILE_MEDIA_QUERY = "(max-width: 1023px)";

function subscribeMobileViewport(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getMobileViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function subscribeNoop(): () => void {
  return () => {};
}
function getClientTrue(): boolean {
  return true;
}
function getServerFalse(): boolean {
  return false;
}

export default function MatchsPage() {
  const router = useRouter();
  const {
    user,
    openRecharge,
    setFeedMatches,
    sportUniverse: selectedUniverse,
    setSportUniverse: setSelectedUniverse,
    sportStatusFilter: filter,
    setSportStatusFilter: setFilter,
    sportLeagueFilter: leagueFilter,
    setSportLeagueFilter: setLeagueFilter,
  } = useApp();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientMatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const lastMatchesRef = useRef<ClientMatch[] | null>(null);
  const isClient = useSyncExternalStore(subscribeNoop, getClientTrue, getServerFalse);
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    getServerFalse
  );
  const { isOffline, isConstrained } = useNetworkQuality();
  const baseMatchesPollMs =
    !isMobileViewport && (filter === "finished" || filter === "upcoming")
      ? 18_000
      : POLL_INTERVAL;
  const pollIntervalMs = getAdaptiveIntervalMs(baseMatchesPollMs, isConstrained);

  const handlePullRefresh = useCallback(async () => {
    try {
      const r = await api.matches();
      if (lastMatchesRef.current !== r.matches) {
        lastMatchesRef.current = r.matches;
        setMatches(r.matches);
        setFeedMatches(r.matches);
      }
      setLoadError(null);
    } catch {
      /* conserve l'affichage en cours si le réseau mobile est instable */
    }
  }, [setFeedMatches]);

  const handleHeroAction = useCallback(
    (action: HeroPromoAction) => {
      const allLoaded = matches ?? [];
      switch (action.type) {
        case "league": {
          const activeRealMatch = allLoaded.find(
            (m) =>
              m.source === "manual" &&
              m.status !== "finished" &&
              resolveEspnSlugForLeague(m.league) === action.slug
          );
          const anyRealMatch = allLoaded.find(
            (m) =>
              m.source === "manual" &&
              resolveEspnSlugForLeague(m.league) === action.slug
          );
          const resolvedLabel =
            activeRealMatch?.league ?? anyRealMatch?.league ?? action.defaultLabel;
          router.push(`/matchs/tous?league=${encodeURIComponent(resolvedLabel)}`);
          break;
        }
        case "virtual":
          router.push("/matchs/virtuels");
          break;
        case "live": {
          const hasRealLive = allLoaded.some(
            (m) => m.source === "manual" && m.status === "live"
          );
          router.push(hasRealLive ? "/matchs/tous?status=live" : "/matchs/virtuels");
          break;
        }
        case "combo":
          router.push("/betslip");
          break;
        case "recharge":
          if (user) {
            openRecharge();
          } else {
            router.push("/auth");
          }
          break;
      }
    },
    [matches, openRecharge, router, user]
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchMatches(isBackground = false) {
      if (isBackground && typeof document !== "undefined" && document.hidden) return;
      if (isBackground && typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const r = await api.matches();
          if (cancelled) return;
          if (lastMatchesRef.current !== r.matches) {
            lastMatchesRef.current = r.matches;
            setMatches(r.matches);
            setFeedMatches(r.matches);
          }
          setLoadError((prev) => (prev === null ? prev : null));
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
            continue;
          }
          if (!isBackground && !cancelled) {
            setLoadError(
              err instanceof Error
                ? err.message
                : "Impossible de charger les matchs pour le moment."
            );
            setMatches((prev) => prev ?? []);
          }
        }
      }
    }

    void fetchMatches(false);
    const id = setInterval(() => void fetchMatches(true), pollIntervalMs);
    const onVisible = () => {
      if (!document.hidden) void fetchMatches(true);
    };
    const onOnline = () => void fetchMatches(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [setFeedMatches, reloadNonce, pollIntervalMs, isOffline]);

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

  const baseForTab = useMemo(() => {
    if (filter === "live") return activeMatches.filter((m) => m.status === "live");
    if (filter === "upcoming") return activeMatches.filter((m) => m.status === "upcoming");
    if (filter === "finished") return finishedMatches;
    return activeMatches;
  }, [activeMatches, finishedMatches, filter]);

  const effectiveLeague =
    leagueFilter === VIRTUAL_FILTER_VALUE
      ? "all"
      : leagueFilter === "all" ||
          isRealUniverse ||
          universeMatches.some((m) => m.league === leagueFilter)
        ? leagueFilter
        : "all";

  const visible = useMemo(() => {
    if (effectiveLeague === "all") return baseForTab;
    const selectedSlug = resolveEspnSlugForLeague(effectiveLeague);
    return baseForTab.filter((m) => {
      if (m.league === effectiveLeague) return true;
      if (!selectedSlug) return false;
      return resolveEspnSlugForLeague(m.league) === selectedSlug;
    });
  }, [baseForTab, effectiveLeague]);

  const liveRest = useMemo(() => {
    const raw = visible.filter((m) => m.status === "live");
    return isRealUniverse
      ? sortRealLiveByPopularity(raw)
      : [...raw].sort(
          (a, b) =>
            new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime() ||
            a.id - b.id
        );
  }, [visible, isRealUniverse]);

  const upcomingOrdered = useMemo(() => {
    const raw = visible.filter((m) => m.status === "upcoming");
    return isRealUniverse ? sortRealUpcomingByPopularity(raw) : sortByKickoffAsc(raw);
  }, [visible, isRealUniverse]);

  const finishedList = useMemo(
    () => visible.filter((m) => m.status === "finished"),
    [visible]
  );

  // ── Logique Mobile (< lg) dédiée & épurée (sans barre de filtres sur l'accueil) ──
  const mobileRows = useMemo(() => {
    const qNorm = query.trim().toLowerCase();

    const realMatching = realMatchesAll.filter((m) =>
      matchesSearchAndOdds(m, qNorm, "all")
    );
    const virtualMatching = virtualMatchesAll.filter((m) =>
      matchesSearchAndOdds(m, qNorm, "all")
    );

    const realLive = sortRealLiveByPopularity(
      realMatching.filter((m) => m.status === "live")
    );
    const realUpcoming = sortRealUpcomingByPopularity(
      realMatching.filter((m) => m.status === "upcoming")
    );

    const vLive = [...virtualMatching.filter((m) => m.status === "live")].sort(
      (a, b) =>
        new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime() ||
        a.id - b.id
    );
    const vUpcoming = sortByKickoffAsc(
      virtualMatching.filter((m) => m.status === "upcoming")
    );
    const virtualAllActive = [...vLive, ...vUpcoming];

    // S'il n'y a aucun match réel en direct, les matchs virtuels en direct prennent le relais
    const liveRowUsesVirtual = realLive.length === 0;
    const liveRowItems = liveRowUsesVirtual
      ? vLive.length > 0
        ? vLive
        : virtualAllActive
      : realLive;

    const upcomingRowUsesVirtual = realUpcoming.length === 0;
    const upcomingRowItems = upcomingRowUsesVirtual ? vUpcoming : realUpcoming;

    return {
      liveRowItems,
      liveRowUsesVirtual,
      upcomingRowItems,
      upcomingRowUsesVirtual,
      hasAny: liveRowItems.length > 0 || upcomingRowItems.length > 0,
    };
  }, [realMatchesAll, virtualMatchesAll, query]);

  const switchUniverse = (next: Universe) => {
    setSelectedUniverse(next);
    setLeagueFilter("all");
  };

  return (
    <PullToRefresh onRefresh={handlePullRefresh} haptics={user?.haptics}>
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-6 pt-2.5 lg:px-0 lg:py-0">
        {/* En-tête desktop uniquement (masqué sur mobile) */}
        <div className="hidden items-center justify-between gap-2 lg:flex">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink lg:text-[24px]">
              {isRealUniverse && effectiveLeague !== "all" ? effectiveLeague : "Matchs"}
            </h1>
            <p className="capitalize text-[12px] text-mist lg:text-[13px]">
              {todayLabel()}
            </p>
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

        {/* Barre de recherche mobile placée en haut du slide Hero */}
        <div className="mb-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:hidden">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un match, un club ou une ligue…"
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

        {/* Hero publicitaire mobile */}
        <MobileHeroCarousel onAction={handleHeroAction} />

        {/* Sélecteur d'univers + Barre de recherche (desktop >= lg uniquement) */}
        <div className="hidden lg:mt-3 lg:block xl:grid xl:grid-cols-[minmax(0,1fr)_270px] xl:items-center xl:gap-3">
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
                className="text-dim hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Bandeau explicatif du mode actif (desktop uniquement) */}
        <div
          className={cn(
            "mb-4 mt-2 hidden items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[11px] font-medium lg:flex",
            isRealUniverse
              ? "bg-emerald-600/8 text-emerald-800"
              : "bg-elev/80 text-mist"
          )}
        >
          {isRealUniverse ? (
            <span>
              Compétitions officielles · Cotes fixes opérateur · Coup d&apos;envoi réel
            </span>
          ) : (
            <span>
              Simulateur 24h/24 · Matchs de 2-3 min · Multiplex 4 directs simultanés
            </span>
          )}
        </div>

        {/* Contenu */}
        {matches === null ? (
          <>
            {/* Squelette mobile constant sur 2 lignes carrousel (zéro saut de mise en page CLS) */}
            <div className="mt-1 flex flex-col gap-5 lg:hidden">
              {[0, 1].map((rowIdx) => (
                <div key={rowIdx} className="space-y-2.5">
                  <div className="shimmer h-4 w-44 rounded-md" />
                  <div className="-mx-4 flex gap-3 overflow-hidden px-4">
                    <div className="shimmer h-[194px] w-[86vw] max-w-[336px] shrink-0 rounded-2xl" />
                    <div className="shimmer h-[194px] w-[86vw] max-w-[336px] shrink-0 rounded-2xl" />
                  </div>
                </div>
              ))}
            </div>

            {/* Squelette desktop (>= lg) */}
            {isRealUniverse ? (
              <div className="hidden grid-cols-1 gap-3 lg:grid">
                <div className="shimmer h-[156px] rounded-2xl" />
                <div className="shimmer h-[156px] rounded-2xl" />
                <div className="shimmer h-[156px] rounded-2xl" />
              </div>
            ) : (
              <div className="hidden flex-col gap-3 lg:flex">
                <div className="shimmer h-[196px] rounded-2xl" />
                <div className="grid grid-cols-1 gap-3">
                  <div className="shimmer h-[136px] rounded-2xl" />
                  <div className="shimmer h-[136px] rounded-2xl" />
                </div>
              </div>
            )}
          </>
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
                setMatches(null);
                setLoadError(null);
                setReloadNonce((n) => n + 1);
              }}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-betclic-red px-4 font-display text-[12.5px] font-bold text-white shadow-xs active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.3} />
              Réessayer
            </button>
          </div>
        ) : (
          <>
            {/* ── VUE MOBILE (< lg) : 2 lignes carrousel avec repli automatique sur les matchs virtuels ── */}
            {(!isClient || isMobileViewport) && (
              <div className="mt-1 lg:hidden">
                {!mobileRows.hasAny ? (
                  <div className="mt-10 flex flex-col items-center text-center">
                    <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
                      <Trophy className="h-5 w-5" strokeWidth={1.9} />
                    </div>
                    <p className="mt-3 font-display text-[15px] font-semibold text-ink">
                      Aucun match trouvé
                    </p>
                    <p className="mt-1 max-w-[290px] text-[12.5px] text-dim">
                      Effacez la recherche pour retrouver toutes les rencontres.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {mobileRows.liveRowItems.length > 0 && (
                      <RealMatchCarouselRow
                        label={
                          mobileRows.liveRowUsesVirtual
                            ? "Matchs virtuels EN DIRECT"
                            : "Populaire EN DIRECT"
                        }
                        items={mobileRows.liveRowItems}
                        live
                        virtualFallback={mobileRows.liveRowUsesVirtual}
                        trailingHref={
                          mobileRows.liveRowUsesVirtual
                            ? "/matchs/virtuels"
                            : "/matchs/tous?status=live"
                        }
                        trailingLabel="Voir tout"
                        emptyMessage="Aucun match en direct pour le moment"
                      />
                    )}

                    <RealMatchCarouselRow
                      label="Populaire en avant-match"
                      items={mobileRows.upcomingRowItems}
                      virtualFallback={mobileRows.upcomingRowUsesVirtual}
                      markFirstAsNextUp={mobileRows.upcomingRowUsesVirtual}
                      trailingHref={
                        mobileRows.upcomingRowUsesVirtual
                          ? "/matchs/virtuels"
                          : "/matchs/tous"
                      }
                      trailingLabel="Voir tout"
                      emptyMessage="Aucun match en avant-match dans cette sélection"
                    />

                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-white px-3.5 py-2.5 shadow-2xs">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
                          <List className="h-4 w-4" strokeWidth={2.3} />
                        </span>
                        <p className="min-w-0 text-[12px] font-medium leading-snug text-mist">
                          Parcourir tous les matchs alignés{" "}
                          <strong className="font-semibold text-ink">
                            en liste verticale
                          </strong>{" "}
                          au pouce
                        </p>
                      </div>
                      <Link
                        href={
                          mobileRows.upcomingRowUsesVirtual
                            ? "/matchs/virtuels"
                            : "/matchs/tous"
                        }
                        className="inline-flex h-8.5 shrink-0 items-center gap-1 rounded-full bg-betclic-red px-3 font-display text-[12px] font-bold text-white shadow-2xs transition-transform active:scale-95"
                      >
                        Voir tout
                        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </Link>
                    </div>

                    {/* Accès rapides mobiles : Matchs virtuels 24/7 & Historique des résultats */}
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <Link
                        href="/matchs/virtuels"
                        className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-edge bg-white px-3 font-display text-[12px] font-bold text-ink shadow-2xs active:bg-elev"
                      >
                        <Cpu className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
                        <span>Virtuels 24h/24</span>
                        {virtualLiveTotal > 0 && (
                          <span className="rounded-full bg-betclic-red/12 px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums text-betclic-red">
                            {virtualLiveTotal}
                          </span>
                        )}
                      </Link>
                      <Link
                        href="/resultats"
                        className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-edge bg-white px-3 font-display text-[12px] font-bold text-ink shadow-2xs active:bg-elev"
                      >
                        <History className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
                        <span>Résultats</span>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── VUE DESKTOP (>= lg) : séparation stricte Matchs réels / Matchs virtuels ── */}
            {(!isClient || !isMobileViewport) && (
              <div className="hidden lg:block">
                {visible.length === 0 ? (
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
                        : "Modifiez votre sélection de ligue ou effacez la recherche pour retrouver toutes les rencontres."}
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
                          className="inline-flex h-9 items-center rounded-full bg-betclic-red px-3.5 font-display text-[12px] font-bold text-white active:scale-95"
                        >
                          Ouvrir les matchs virtuels ({virtualActiveTotal})
                        </button>
                      </div>
                    )}
                  </div>
                ) : isRealUniverse ? (
                  <div className="flex flex-col gap-5">
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
                ) : (
                  <div className="flex flex-col gap-5">
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
                          label="À venir · Prochains départs"
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
            )}
          </>
        )}
      </div>
    </PullToRefresh>
  );
}

const RealMatchCarouselRow = memo(function RealMatchCarouselRow({
  label,
  items,
  live,
  virtualFallback,
  markFirstAsNextUp,
  emptyMessage,
  trailingHref,
  trailingLabel,
}: {
  label: string;
  items: ClientMatch[];
  live?: boolean;
  virtualFallback?: boolean;
  markFirstAsNextUp?: boolean;
  emptyMessage?: string;
  trailingHref?: string;
  trailingLabel?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [renderLimit, setRenderLimit] = useState(INITIAL_CAROUSEL_WINDOW);

  const visibleItems = useMemo(
    () => (items.length <= renderLimit ? items : items.slice(0, renderLimit)),
    [items, renderLimit]
  );

  const syncScrollEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (renderLimit < items.length && maxScroll - el.scrollLeft < 680) {
      setRenderLimit((prev) => Math.min(items.length, prev + CAROUSEL_WINDOW_STEP));
    }
  }, [items.length, renderLimit]);

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      syncScrollEdges();
    });
  }, [syncScrollEdges]);

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
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      ro?.disconnect();
    };
  }, [visibleItems.length, syncScrollEdges]);

  return (
    <section>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {live && (
            <span
              className={cn(
                "live-dot h-2 w-2 shrink-0 rounded-full",
                virtualFallback ? "bg-betclic-red" : "bg-emerald-600"
              )}
            />
          )}
          <h2 className="truncate font-display text-[13.5px] font-bold tracking-tight text-ink">
            {label}
          </h2>
          {virtualFallback && items.length > 0 && (
            <span className="shrink-0 rounded-full bg-betclic-red/10 px-2 py-0.5 font-display text-[10px] font-bold text-betclic-red">
              Virtuels
            </span>
          )}
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-display text-[10.5px] font-bold tabular-nums",
              live && items.length > 0
                ? virtualFallback
                  ? "bg-betclic-red/12 text-betclic-red"
                  : "bg-emerald-600/12 text-emerald-700"
                : "bg-elev text-dim"
            )}
          >
            {items.length}
          </span>
        </div>

        {trailingHref && trailingLabel && (
          <Link
            href={trailingHref}
            className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full bg-betclic-red/10 pl-2.5 pr-1.5 font-display text-[11.5px] font-bold text-betclic-red transition-transform active:scale-95"
          >
            <span>{trailingLabel}</span>
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-2 flex h-12 items-center justify-center rounded-2xl border border-dashed border-edge bg-white/75 px-3.5 text-[12px] font-medium text-mist">
          {emptyMessage ?? "Aucun match disponible"}
        </div>
      ) : (
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="-mx-4 mt-2.5 flex snap-x snap-mandatory scroll-px-4 items-stretch gap-3 overflow-x-auto px-4 pb-1 scroll-smooth no-scrollbar"
        >
          {visibleItems.map((m, idx) => (
            <div
              key={m.id}
              className={cn(
                "shrink-0 snap-start",
                items.length === 1
                  ? "w-full"
                  : "w-[86vw] max-w-[336px] sm:w-[332px]"
              )}
            >
              <MatchCard
                match={m}
                nextUp={Boolean(markFirstAsNextUp && idx === 0)}
                className="h-full"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

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
