"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw, Search, TicketX, X } from "lucide-react";
import { api, type ClientBet } from "@/lib/api";
import { BetTicket } from "@/components/bet-ticket";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollSentinel,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/components/providers";
import { pulseQueryKeys } from "@/lib/query-client";
import { getAllCachedBets } from "@/lib/client-entity-cache";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import { cn, eur } from "@/lib/format";

type Tab = "ongoing" | "finished";
type OutcomeFilter = "all" | "won" | "lost" | "void";
type KindFilter = "all" | "simple" | "combo";

const POLL_LIVE_MS = 2_500;
const POLL_PENDING_MS = 5_000;
const POLL_IDLE_MS = 15_000;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((sod(now) - sod(d)) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  }).format(d);
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function settledOrPlacedIso(b: ClientBet): string {
  return b.status !== "pending" && b.settledAt ? b.settledAt : b.placedAt;
}

export default function ParisPage() {
  const queryClient = useQueryClient();
  const { betsVersion, user, setBalance } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();
  const livePollMs = getAdaptiveIntervalMs(POLL_LIVE_MS, isConstrained);
  const pendingPollMs = getAdaptiveIntervalMs(POLL_PENDING_MS, isConstrained);
  const idlePollMs = getAdaptiveIntervalMs(POLL_IDLE_MS, isConstrained);
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [sharingBet, setSharingBet] = useState<ClientBet | null>(null);

  const initialCachedBets = useMemo(() => {
    const cached = getAllCachedBets();
    return cached.length > 0 ? { bets: cached, balance: null } : undefined;
  }, []);

  // Liste complète des paris gérée par TanStack Query + invalidation instantanée PartyKit (`user-<id>`)
  // Maintient un rafraîchissement continu (3.5 s en live pour le Cash Out, 6 s en avant-match, 18 s au repos).
  const allBetsQuery = useQuery({
    queryKey: [...pulseQueryKeys.userBets(user?.id, "all"), betsVersion],
    queryFn: () => api.allBets(),
    enabled: !isOffline,
    initialData: initialCachedBets,
    initialDataUpdatedAt: initialCachedBets ? () => Date.now() - 2_000 : undefined,
    staleTime: 1_500,
    refetchInterval: (q) => {
      if (isOffline) return false;
      const currentBets = q.state.data?.bets;
      const anyPending = Boolean(
        currentBets?.some((b) => b.status === "pending")
      );
      if (!anyPending) return idlePollMs;
      const livePending = Boolean(
        currentBets?.some(
          (b) =>
            b.status === "pending" &&
            (b.matchStatus === "live" ||
              b.legs?.some((l) => l.matchStatus === "live"))
        )
      );
      return livePending ? livePollMs : pendingPollMs;
    },
    refetchIntervalInBackground: false,
  });

  const refetchAllBets = allBetsQuery.refetch;

  useEffect(() => {
    if (typeof allBetsQuery.data?.balance === "number") {
      setBalance(allBetsQuery.data.balance);
    }
  }, [allBetsQuery.data?.balance, setBalance]);

  const bets = useMemo(
    () => allBetsQuery.data?.bets ?? (allBetsQuery.isError ? [] : null),
    [allBetsQuery.data, allBetsQuery.isError]
  );

  const loadError =
    !allBetsQuery.data && allBetsQuery.error instanceof Error
      ? allBetsQuery.error.message
      : allBetsQuery.isError && !allBetsQuery.data
        ? "Impossible de charger vos paris pour le moment."
        : null;

  const currentUserId = user?.id;
  const handlePullRefresh = useCallback(async () => {
    try {
      const fresh = await api.allBets({ forceRefresh: true });
      queryClient.setQueryData(
        [...pulseQueryKeys.userBets(currentUserId, "all"), betsVersion],
        fresh
      );
      if (typeof fresh.balance === "number") setBalance(fresh.balance);
    } catch {
      /* conserve la liste affichée si la 3G coupe brièvement */
    }
  }, [betsVersion, currentUserId, queryClient, setBalance]);

  const allBets = useMemo(() => bets ?? [], [bets]);

  // Si aucun pari n'est en cours mais qu'il existe des paris terminés,
  // on bascule automatiquement sur « Terminés » par défaut.
  const hasAnyOngoing = useMemo(
    () => allBets.some((b) => b.status === "pending"),
    [allBets]
  );
  const hasAnyFinished = useMemo(
    () => allBets.some((b) => b.status !== "pending"),
    [allBets]
  );
  const smartDefaultTab: Tab = !hasAnyOngoing && hasAnyFinished ? "finished" : "ongoing";
  const tab: Tab = tabChoice ?? smartDefaultTab;

  const staked = useMemo(
    () => allBets.filter((b) => b.status === "pending").reduce((s, b) => s + b.stake, 0),
    [allBets]
  );
  const potential = useMemo(
    () => allBets.filter((b) => b.status === "pending").reduce((s, b) => s + b.potentialWin, 0),
    [allBets]
  );
  const { settled, winRate } = useMemo(() => {
    const fin = allBets.filter((b) => b.status === "won" || b.status === "lost");
    const w = fin.filter((b) => b.status === "won").length;
    return {
      settled: fin.length,
      winRate: fin.length ? Math.round((w / fin.length) * 100) : 0,
    };
  }, [allBets]);

  const searchedBets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allBets;
    return allBets.filter(
      (b) =>
        b.homeTeam.toLowerCase().includes(q) ||
        b.awayTeam.toLowerCase().includes(q) ||
        b.league.toLowerCase().includes(q) ||
        b.selectionLabel.toLowerCase().includes(q) ||
        (b.question ?? "").toLowerCase().includes(q) ||
        (b.legs ?? []).some(
          (l) =>
            l.title.toLowerCase().includes(q) ||
            l.selectionLabel.toLowerCase().includes(q) ||
            (l.league ?? "").toLowerCase().includes(q)
        )
    );
  }, [allBets, query]);

  const ongoingAll = useMemo(
    () =>
      searchedBets
        .filter((b) => b.status === "pending")
        .sort(
          (a, b) =>
            new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime() ||
            b.id - a.id
        ),
    [searchedBets]
  );
  const finishedAll = useMemo(
    () =>
      searchedBets
        .filter((b) => b.status !== "pending")
        .sort(
          (a, b) =>
            new Date(settledOrPlacedIso(b)).getTime() -
              new Date(settledOrPlacedIso(a)).getTime() ||
            new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime() ||
            b.id - a.id
        ),
    [searchedBets]
  );

  const baseByStatus = tab === "ongoing" ? ongoingAll : finishedAll;

  const kindCounts = useMemo(() => {
    return {
      all: baseByStatus.length,
      combo: baseByStatus.filter((b) => b.kind === "combo").length,
      simple: baseByStatus.filter((b) => b.kind !== "combo").length,
    };
  }, [baseByStatus]);

  const byKind = useMemo(
    () => (kindFilter === "all" ? baseByStatus : baseByStatus.filter((b) => kindFilter === "simple" ? b.kind !== "combo" : b.kind === "combo")),
    [baseByStatus, kindFilter]
  );

  const finishedForOutcomeCounts = useMemo(
    () => (kindFilter === "all" ? finishedAll : finishedAll.filter((b) => kindFilter === "simple" ? b.kind !== "combo" : b.kind === "combo")),
    [finishedAll, kindFilter]
  );

  const outcomeCounts = useMemo(
    () => ({
      all: byKind.length,
      won: finishedForOutcomeCounts.filter((b) => b.status === "won").length,
      lost: finishedForOutcomeCounts.filter((b) => b.status === "lost").length,
      void: finishedForOutcomeCounts.filter((b) => b.status === "void").length,
    }),
    [byKind.length, finishedForOutcomeCounts]
  );

  const visibleBets = useMemo(() => {
    if (tab === "ongoing" || outcomeFilter === "all") return byKind;
    return byKind.filter((b) => b.status === outcomeFilter);
  }, [tab, byKind, outcomeFilter]);

  const betsResetKey = `${tab}|${kindFilter}|${outcomeFilter}|${query
    .trim()
    .toLowerCase()}`;
  const betsBatch = useInfiniteBatch(visibleBets.length, betsResetKey);
  const pagedBets = useMemo(
    () => visibleBets.slice(0, betsBatch.visibleCount),
    [visibleBets, betsBatch.visibleCount]
  );

  const dayTotalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of visibleBets) {
      const key = dayKey(settledOrPlacedIso(b));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [visibleBets]);

  const finishedGroups = useMemo(() => {
    const map = new Map<string, ClientBet[]>();
    for (const b of pagedBets) {
      const key = dayKey(settledOrPlacedIso(b));
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()];
  }, [pagedBets]);

  const toggleMobileSearch = () => {
    if (mobileSearchOpen) {
      setQuery("");
      setMobileSearchOpen(false);
    } else {
      setMobileSearchOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  };

  if (bets === null && !loadError) {
    return <PulseFlashLoader />;
  }

  return (
    <PullToRefresh onRefresh={handlePullRefresh} haptics={user?.haptics}>
    <div className="mx-auto w-full max-w-[1600px] px-2 pb-6 pt-2.5 lg:px-0 lg:py-0">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[14.5px] font-bold leading-tight tracking-tight text-ink lg:text-[16px]">
          Mes paris
        </h1>

        <button
          type="button"
          onClick={toggleMobileSearch}
          aria-label={mobileSearchOpen ? "Fermer la recherche" : "Rechercher un pari"}
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

        {/* Recherche en ligne sur desktop */}
        <div className="hidden h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:flex lg:w-[340px] xl:w-[380px]">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un match, un coupon, un combiné…"
            className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-dim"
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

      {/* Synthèse contextuelle uniquement s'il y a des paris */}
      {bets !== null && (staked > 0 || settled > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-edge bg-white px-3 py-2 text-[10.5px] shadow-2xs">
          {staked > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-mist">
                En jeu :{" "}
                <strong className="font-display font-medium tabular-nums text-ink">
                  {eur(staked)}
                </strong>
              </span>
              <span className="text-mist">
                Gain max :{" "}
                <strong className="font-display font-medium tabular-nums text-win">
                  {eur(potential)}
                </strong>
              </span>
            </div>
          )}
          {settled > 0 && (
            <span className="text-mist">
              Réussite :{" "}
              <strong className="font-display font-medium tabular-nums text-ink">
                {winRate}%
              </strong>
            </span>
          )}
        </div>
      )}

      {/* Barre de recherche mobile dépliable au clic sur la loupe */}
      {(mobileSearchOpen || query) && (
        <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:hidden">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un match, un coupon, un combiné…"
            className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-dim"
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

      <div className="sticky top-[48px] z-30 bg-deep/95 backdrop-blur-md lg:top-[52px]">
        <div role="tablist" aria-label="Statut des paris" className="flex gap-1.5 pt-2 lg:gap-2 lg:pt-3">
          {([['ongoing', 'En cours'], ['finished', 'Terminés']] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value}
              onClick={() => { setTabChoice(value); if (value === "ongoing") setOutcomeFilter("all"); }}
              className={cn("h-8 rounded-full px-3 text-[11.5px] font-medium lg:h-10 lg:flex-1 lg:px-0", tab === value ? "bg-betclic-red text-white" : "bg-[#e7e9ed] text-[#374151]")}>
              {label} {bets !== null && `(${value === "ongoing" ? ongoingAll.length : finishedAll.length})`}
            </button>
          ))}
        </div>
      <FilterDropdownRow sticky={false} compactMobile
        filters={[
          {
            id: "kind",
            placeholder: "Type",
            value: kindFilter,
            defaultValue: "all",
            onChange: setKindFilter,
            options: [
              {
                value: "all",
                label: "Tous",
                count: bets !== null ? kindCounts.all : undefined,
              },
              {
                value: "simple",
                label: "Simple",
                count: bets !== null ? kindCounts.simple : undefined,
              },
              {
                value: "combo",
                label: "Combiné",
                count: bets !== null ? kindCounts.combo : undefined,
              },
            ],
          },
          ...(tab === "finished" ? [{
            id: "outcome",
            placeholder: "Résultat",
            value: outcomeFilter,
            defaultValue: "all",
            onChange: setOutcomeFilter,
            options: [
              {
                value: "all",
                label: "Tous résultats",
                count: bets !== null ? outcomeCounts.all : undefined,
              },
              {
                value: "won",
                label: "Gagnés",
                count: bets !== null ? outcomeCounts.won : undefined,
              },
              {
                value: "lost",
                label: "Perdus",
                count: bets !== null ? outcomeCounts.lost : undefined,
              },
              {
                value: "void",
                label: "Remboursés",
                count: bets !== null ? outcomeCounts.void : undefined,
              },
            ],
          }] : []),
        ]}
        onReset={() => {
          setKindFilter("all");
          setOutcomeFilter("all");
        }}
        resultCountText={
          bets !== null
            ? tab === "ongoing"
              ? `${visibleBets.length} pari${visibleBets.length > 1 ? "s" : ""} en cours`
              : `${visibleBets.length} pari${visibleBets.length > 1 ? "s" : ""} terminé${visibleBets.length > 1 ? "s" : ""}`
            : null
        }
      />
      </div>

      {/* Liste des tickets */}
      {bets === null ? (
        <PulseFlashLoader compact />
      ) : loadError && (bets?.length ?? 0) === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-amber-500/30 bg-white p-5 text-center shadow-xs">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/12 text-amber-600">
            <AlertTriangle className="h-5 w-5" strokeWidth={2.1} />
          </div>
          <p className="mt-3 font-display text-[12px] font-medium text-ink">
            Connexion au serveur interrompue
          </p>
          <p className="mt-1 max-w-[330px] text-[11px] leading-relaxed text-mist">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => {
              void allBetsQuery.refetch();
            }}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-betclic-red px-4 font-display text-[11px] font-medium text-white shadow-xs active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.3} />
            Réessayer
          </button>
        </div>
      ) : visibleBets.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <TicketX className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <p className="mt-3 font-display text-[12.5px] font-medium text-ink">
            {tab === "ongoing" ? "Aucun pari en cours" : "Aucun pari terminé"}
          </p>
          <p className="mt-1 max-w-[240px] text-[11px] text-dim">
            {tab === "ongoing"
              ? "Choisissez une prédiction ou un match pour placer une mise."
              : "Modifiez vos filtres ou consultez vos coupons en cours."}
          </p>
          {tab === "ongoing" && (
            <div className="mt-4 flex gap-2">
              <Link
                href="/matchs"
                className="flex h-10 items-center gap-1.5 rounded-full bg-betclic-red px-4 font-display text-[11px] font-medium text-white active:opacity-90"
              >
                Matchs
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              </Link>
              <Link
                href="/predictions"
                className="flex h-10 items-center rounded-full border border-edge bg-white px-4 font-display text-[11px] font-medium text-ink active:bg-elev"
              >
                Prédictions
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div>
          {tab === "ongoing" ? (
            <div className="grid grid-cols-1 items-start gap-3">
              {pagedBets.map((b) => (
                <BetTicket key={`${b.kind}-${b.id}`} bet={b} onShare={setSharingBet} />
              ))}
            </div>
          ) : (
            finishedGroups.map(([key, group]) => (
              <div key={key} className="mb-5 last:mb-0">
                <p className="mb-2 px-0.5 text-[10.5px] font-medium capitalize text-mist">
                  {dayLabel(settledOrPlacedIso(group[0]))}
                  <span className="ml-1.5 text-dim">
                    ({dayTotalCounts.get(key) ?? group.length})
                  </span>
                </p>
                <div className="grid grid-cols-1 items-start gap-3">
                  {group.map((b) => (
                    <BetTicket key={`${b.kind}-${b.id}`} bet={b} onShare={setSharingBet} />
                  ))}
                </div>
              </div>
            ))
          )}
          <InfiniteScrollSentinel
            hasMore={betsBatch.hasMore}
            isLoadingMore={betsBatch.isLoadingMore}
            onLoadMore={betsBatch.loadMore}
          />
        </div>
      )}

      <ShareTicketModal bet={sharingBet} onClose={() => setSharingBet(null)} />
    </div>
    </PullToRefresh>
  );
}
