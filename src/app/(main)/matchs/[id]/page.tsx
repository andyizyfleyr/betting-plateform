"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, type ClientMatch } from "@/lib/api";
import { getCachedClientMatch } from "@/lib/client-entity-cache";
import { sanitizeMatchEvents } from "@/lib/match-events";
import {
  forceRefreshMatchDetail,
  useMatchDetailQuery,
} from "@/lib/party-realtime";
import { LiveMatchTracker } from "@/components/live-match-tracker";
import {
  AccordionItem,
  CATEGORY_TABS,
  formatMatchDateTime,
  inferCategory,
  sanitizeMatchMarkets,
  type SheetCategory,
} from "@/components/market-sheet";
import { LiveStatusBadge } from "@/components/match-card";
import { PullToRefresh } from "@/components/pull-to-refresh";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import { useApp, useFeedMatches } from "@/components/providers";
import {
  hasAnyRealStats,
  RealMatchStatsCard,
} from "@/components/real-match-stats-card";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { cn } from "@/lib/format";

function detailQueryStatusFinished(
  a?: ClientMatch | null,
  b?: ClientMatch | null
): boolean {
  return a?.status === "finished" || b?.status === "finished";
}

function defaultOpenMarkets(match: ClientMatch | null | undefined): Record<string, boolean> {
  const groups = match?.markets ?? [];
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const preferred = isDesktop
    ? ["result", "total_ou", "double_chance", "btts"]
    : ["result", "total_ou"];
  const initial: Record<string, boolean> = {};
  for (const key of preferred) {
    if (groups.some((g) => g.key === key)) initial[key] = true;
  }
  if (Object.keys(initial).length === 0) {
    for (const g of groups.slice(0, 2)) initial[g.key] = true;
  }
  return initial;
}

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const rawParamId = params?.id;
  const paramPending = rawParamId === undefined;
  const matchId = Number(rawParamId);
  const invalidId =
    !paramPending && (!Number.isInteger(matchId) || matchId <= 0);

  const {
    openBet,
    oddsFormat,
    target,
    comboLegs,
    comboQuickMode,
    toggleComboLeg,
    toast,
  } = useApp();
  const feedMatches = useFeedMatches();

  // IMPORTANT : renvoie `undefined` (et jamais `null`) tant que le flux global ou
  // `/api/matches/[id]` n'a pas résolu la rencontre, afin d'éviter que `undefined ?? null`
  // n'affiche brièvement « Match introuvable » avant l'arrivée des données.
  const sharedFromFeed = useMemo<ClientMatch | undefined>(
    () =>
      !paramPending && !invalidId && feedMatches
        ? feedMatches.find((m) => m.id === matchId)
        : undefined,
    [paramPending, invalidId, feedMatches, matchId]
  );

  const [prevId, setPrevId] = useState(matchId);
  const [category, setCategory] = useState<SheetCategory>("all");
  const [showTracker, setShowTracker] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024
  );
  const [initializedMatchId, setInitializedMatchId] = useState<number | null>(
    () => {
      const c = paramPending || invalidId ? null : getCachedClientMatch(matchId);
      return c && (c.markets?.length ?? 0) > 0 ? matchId : null;
    }
  );
  const [fullMarketsOpenedId, setFullMarketsOpenedId] = useState<number | null>(
    () => {
      const c = paramPending || invalidId ? null : getCachedClientMatch(matchId);
      return c && (c.markets?.length ?? 0) > 1 ? matchId : null;
    }
  );
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    defaultOpenMarkets(
      paramPending || invalidId ? null : getCachedClientMatch(matchId)
    )
  );

  if (matchId !== prevId) {
    setPrevId(matchId);
    const cached =
      paramPending || invalidId
        ? null
        : (getCachedClientMatch(matchId) ?? undefined);
    setCategory("all");
    setInitializedMatchId(
      cached && (cached.markets?.length ?? 0) > 0 ? matchId : null
    );
    setFullMarketsOpenedId(
      cached && (cached.markets?.length ?? 0) > 1 ? matchId : null
    );
    setOpenMap(defaultOpenMarkets(cached));
  }

  const cachedInitialMatch = useMemo<ClientMatch | undefined>(
    () =>
      paramPending || invalidId
        ? undefined
        : (getCachedClientMatch(matchId) ?? undefined),
    [paramPending, invalidId, matchId]
  );

  const fallbackMatch = cachedInitialMatch ?? sharedFromFeed;

  // Maintient toujours `useMatchDetailQuery` actif sur `/matchs/[id]` jusqu'à la fin du match :
  // - Reçoit instantanément (< 50 ms) les frames WebSocket PartyKit fusionnées dans `pulseQueryKeys.matchDetail(matchId)`
  // - Polle `/api/matches/[id]` (~3 Ko) toutes les 3.5 s pour actualiser les 19 marchés, les stats réelles et le terrain 2D.
  const detailQuery = useMatchDetailQuery(matchId, {
    enabled: !paramPending && !invalidId,
    initialMatch:
      cachedInitialMatch &&
      (cachedInitialMatch.status === "finished" ||
        (cachedInitialMatch.markets?.length ?? 0) > 1)
        ? cachedInitialMatch
        : null,
    isFinished:
      detailQueryStatusFinished(cachedInitialMatch, sharedFromFeed),
  });

  const isNotFoundError =
    invalidId ||
    (detailQuery.error instanceof ApiRequestError &&
      (detailQuery.error.status === 404 || detailQuery.error.status === 400));

  const fetchedMatch: ClientMatch | null | undefined = paramPending
    ? undefined
    : invalidId
      ? null
      : detailQuery.data !== undefined
        ? (detailQuery.data.match ?? null)
        : detailQuery.isError
          ? null
          : undefined;

  const loadError =
    !isNotFoundError &&
    !detailQuery.data &&
    detailQuery.error instanceof Error
      ? detailQuery.error.message
      : !isNotFoundError && detailQuery.isError && !detailQuery.data
        ? "Impossible de charger ce match."
        : null;

  const match = useMemo<ClientMatch | null | undefined>(() => {
    if (paramPending) return undefined;
    if (invalidId) return null;
    if (fetchedMatch !== undefined) {
      return fetchedMatch ?? fallbackMatch ?? null;
    }
    return fallbackMatch;
  }, [paramPending, fetchedMatch, invalidId, fallbackMatch]);

  const groups = useMemo(() => sanitizeMatchMarkets(match?.markets), [match]);

  if (match && groups.length > 0 && initializedMatchId !== match.id) {
    setInitializedMatchId(match.id);
    if (groups.length > 1) {
      setFullMarketsOpenedId(match.id);
    }
    setOpenMap(defaultOpenMarkets(match));
  } else if (match && groups.length > 1 && fullMarketsOpenedId !== match.id) {
    setFullMarketsOpenedId(match.id);
    setOpenMap((prev) => ({ ...defaultOpenMarkets(match), ...prev }));
  }

  const fetchMatch = useCallback(async () => {
    if (invalidId) return;
    try {
      await forceRefreshMatchDetail(queryClient, matchId);
    } catch {
      await detailQuery.refetch();
    }
  }, [detailQuery, invalidId, matchId, queryClient]);

  const filteredGroups = useMemo(() => {
    if (category === "all") return groups;
    return groups.filter((g) => inferCategory(g) === category);
  }, [groups, category]);

  const cleanEvents = useMemo(
    () => (match ? sanitizeMatchEvents(match.events) : []),
    [match]
  );

  const isLive = match?.status === "live";
  const isFinished = match?.status === "finished";
  const isReal = match?.source === "manual";
  const realStatsAvailable = Boolean(isReal && hasAnyRealStats(match?.realStats));
  const suspended = Boolean(match?.suspended);

  if (match === undefined && !loadError) {
    return <PulseFlashLoader />;
  }

  return (
    <PullToRefresh onRefresh={fetchMatch}>
    <div className="mx-auto w-full max-w-[1440px] px-3 pb-6 pt-2.5 lg:px-0 lg:py-0">
      {/* En-tête compact en ligne (sans double barre collante) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                triggerRouteLoader("/matchs");
                router.push("/matchs");
              }
            }}
            aria-label="Retour aux matchs"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:h-9 lg:w-9"
          >
            <ArrowLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" strokeWidth={2.3} />
          </button>

          <div className="flex min-w-0 items-center gap-1.5">
            <SportIcon
              sport={match?.sport ?? "football"}
              className="h-3.5 w-3.5 shrink-0 text-betclic-red"
            />
            <h1 className="truncate font-display text-[14px] font-extrabold text-ink lg:text-[18px]">
              {match?.league ?? "Match"}
            </h1>
          </div>
        </div>

        {match && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="shrink-0 rounded-full bg-elev px-2 py-0.5 font-display text-[10.5px] font-bold tabular-nums text-mist lg:px-2.5 lg:py-1 lg:text-[11px]">
              {formatMatchDateTime(match.startsAt)}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2.5 lg:mt-4">
        {match === undefined ? (
          <PulseFlashLoader compact />
        ) : match === null ? (
          <div className="glass-card rounded-xl p-4 text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-betclic-red" />
            <p className="mt-1.5 font-display text-[14.5px] font-bold text-ink">
              {loadError ? "Connexion interrompue" : "Match introuvable"}
            </p>
            <p className="mt-0.5 text-[11.5px] text-mist">
              {loadError ?? "Cette affiche n'est plus disponible."}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void fetchMatch()}
                className="inline-flex items-center gap-1 rounded-lg bg-elev px-3 py-1.5 font-display text-[11.5px] font-bold text-ink"
              >
                <RefreshCw className="h-3 w-3" />
                Réessayer
              </button>
              <Link
                href="/matchs"
                className="btn-red rounded-lg px-3.5 py-1.5 text-[11.5px]"
              >
                Tous les matchs
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 lg:space-y-4">
            {/* Scoreboard compact sur mobile (écussons sm, noms intégraux) */}
            <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="flex flex-col items-center gap-1 text-center">
                  <TeamAvatar
                    name={match.homeTeam}
                    logo={match.homeLogo}
                    size="sm"
                    className="lg:hidden"
                  />
                  <TeamAvatar
                    name={match.homeTeam}
                    logo={match.homeLogo}
                    size="md"
                    className="hidden lg:grid"
                  />
                  <span className="font-display text-[11.5px] font-bold leading-tight text-ink lg:text-[13px]">
                    {match.homeTeam}
                  </span>
                  {(match.redHome ?? 0) > 0 && (
                    <span className="rounded bg-betclic-red px-1 py-0.5 font-display text-[8.5px] font-bold text-white">
                      🟥 ×{match.redHome}
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center">
                  {isLive ? (
                    <div className="mb-1.5">
                      <LiveStatusBadge
                        match={match}
                        minute={match.minute}
                        suspended={match.suspended}
                      />
                    </div>
                  ) : isFinished ? (
                    <span className="mb-1.5 rounded-full bg-elev px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-mist">
                      Terminé
                    </span>
                  ) : null}

                  {isLive || isFinished ? (
                    <div className="flex items-center gap-1 rounded-lg bg-elev px-2.5 py-1 font-display text-[18px] font-black tabular-nums leading-none text-ink lg:rounded-xl lg:px-4 lg:py-2 lg:text-[24px]">
                      <span
                        className={cn(
                          isFinished &&
                            (match.homeScore ?? 0) > (match.awayScore ?? 0) &&
                            "text-betclic-red"
                        )}
                      >
                        {match.homeScore ?? 0}
                      </span>
                      <span className="text-[12px] text-dim lg:text-[15px]">-</span>
                      <span
                        className={cn(
                          isFinished &&
                            (match.awayScore ?? 0) > (match.homeScore ?? 0) &&
                            "text-betclic-red"
                        )}
                      >
                        {match.awayScore ?? 0}
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-elev px-2.5 py-1 text-center font-display text-[11.5px] font-extrabold text-mist lg:rounded-xl lg:px-3.5 lg:py-2 lg:text-[13px]">
                      VS
                    </div>
                  )}

                  {match.htHomeScore != null && match.htAwayScore != null && (
                    <span className="mt-0.5 text-[9.5px] font-semibold tabular-nums text-dim lg:mt-1 lg:text-[10.5px]">
                      MT {match.htHomeScore}-{match.htAwayScore}
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center gap-1 text-center">
                  <TeamAvatar
                    name={match.awayTeam}
                    logo={match.awayLogo}
                    size="sm"
                    className="lg:hidden"
                  />
                  <TeamAvatar
                    name={match.awayTeam}
                    logo={match.awayLogo}
                    size="md"
                    className="hidden lg:grid"
                  />
                  <span className="font-display text-[11.5px] font-bold leading-tight text-ink lg:text-[13px]">
                    {match.awayTeam}
                  </span>
                  {(match.redAway ?? 0) > 0 && (
                    <span className="rounded bg-betclic-red px-1 py-0.5 font-display text-[8.5px] font-bold text-white">
                      🟥 ×{match.redAway}
                    </span>
                  )}
                </div>
              </div>

              {/* Bascules compactes (Terrain 2D / Stats / Rapport) */}
              {(isLive && !isReal) || realStatsAvailable || isFinished ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 border-t border-edge/70 pt-2">
                  {((isLive && !isReal) || realStatsAvailable) && (
                    <button
                      type="button"
                      onClick={() => setShowTracker((v) => !v)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-display text-[10.5px] font-bold transition-colors",
                        showTracker
                          ? "bg-ink text-white"
                          : "bg-elev text-ink hover:bg-edge"
                      )}
                    >
                      {isReal ? (
                        <BarChart3 className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Radio className="h-3 w-3 text-betclic-red" />
                      )}
                      {showTracker
                        ? isReal
                          ? "Masquer stats"
                          : "Masquer 2D"
                        : isReal
                          ? "Stats officielles"
                          : "Terrain 2D"}
                    </button>
                  )}

                  {isFinished && (
                    <Link
                      href={`/resultats/${match.id}`}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-betclic-red/10 px-2.5 font-display text-[10.5px] font-bold text-betclic-red"
                    >
                      Bilan du résultat
                      <ChevronRight className="h-3 w-3" strokeWidth={2.4} />
                    </Link>
                  )}
                </div>
              ) : null}
            </section>

            {/* Terrain 2D live ou statistiques ESPN (replié par défaut sur mobile) */}
            {showTracker && isLive && !isReal && (
              <LiveMatchTracker match={match} />
            )}

            {showTracker && realStatsAvailable && (
              <RealMatchStatsCard
                stats={match.realStats}
                homeTeam={match.homeTeam}
                awayTeam={match.awayTeam}
                homeLogo={match.homeLogo}
                awayLogo={match.awayLogo}
                htHomeScore={match.htHomeScore}
                htAwayScore={match.htAwayScore}
                compact
              />
            )}

            {/* Onglets de catégories compacts + accordéons */}
            {isFinished || groups.length === 0 ? (
              <div className="glass-card rounded-xl p-3.5 text-center">
                <p className="font-display text-[12.5px] font-bold text-ink">
                  {isFinished
                    ? "Rencontre terminée — marchés clôturés."
                    : "Aucun marché ouvert pour le moment."}
                </p>
                {isFinished && (
                  <Link
                    href={`/resultats/${match.id}`}
                    className="btn-red mt-2.5 inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-[11.5px]"
                  >
                    Bilan détaillé
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            ) : (
              <section className="space-y-2 lg:space-y-3">
                <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5 lg:mx-0 lg:px-0">
                  {CATEGORY_TABS.map((t) => {
                    const count =
                      t.key === "all"
                        ? groups.length
                        : groups.filter((g) => inferCategory(g) === t.key).length;
                    if (t.key !== "all" && count === 0) return null;
                    const active = category === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setCategory(t.key)}
                        className={cn(
                          "inline-flex h-7.5 shrink-0 items-center gap-1 rounded-full px-2.5 font-display text-[11px] font-bold transition-colors lg:h-9 lg:px-3.5 lg:text-[12px]",
                          active
                            ? "bg-betclic-red text-white shadow-xs"
                            : "bg-elev text-mist hover:text-ink"
                        )}
                      >
                        {t.label}
                        <span
                          className={cn(
                            "text-[10px] font-semibold tabular-nums",
                            active ? "text-white/80" : "text-dim"
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {suspended && (
                  <div className="rounded-lg border border-amber-500/35 bg-amber-500/12 px-3 py-1.5 text-center font-display text-[11px] font-bold text-amber-800">
                    Marchés suspendus momentanément…
                  </div>
                )}

                <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                  {filteredGroups.map((g) => {
                    const isOpen =
                      category !== "all"
                        ? (openMap[g.key] ?? true)
                        : Boolean(openMap[g.key]);
                    const comboSelectedKey =
                      comboLegs.find(
                        (l) => l.uid === `sport-${match.id}` && l.market === g.key
                      )?.selection ?? null;

                    return (
                      <AccordionItem
                        key={g.key}
                        match={match}
                        group={g}
                        suspended={suspended}
                        open={isOpen}
                        oddsFormat={oddsFormat}
                        selectedKey={
                          target &&
                          target.match.id === match.id &&
                          target.market === g.key
                            ? target.selection
                            : null
                        }
                        comboSelectedKey={comboSelectedKey}
                        onToggle={() =>
                          setOpenMap((prev) => ({
                            ...prev,
                            [g.key]: !(category !== "all"
                              ? (prev[g.key] ?? true)
                              : Boolean(prev[g.key])),
                          }))
                        }
                        onPick={(outcome) => {
                          if (comboQuickMode) {
                            const res = toggleComboLeg({
                              uid: `sport-${match.id}`,
                              kind: "sport",
                              matchId: match.id,
                              matchSource: match.source,
                              title: `${match.homeTeam} – ${match.awayTeam}`,
                              homeTeam: match.homeTeam,
                              awayTeam: match.awayTeam,
                              homeLogo: match.homeLogo,
                              awayLogo: match.awayLogo,
                              league: match.league,
                              market: g.key,
                              selection: outcome.key,
                              selectionLabel: outcome.label,
                              odds: outcome.odds,
                              startsAt: match.startsAt,
                              isLive: match.status === "live",
                            });
                            if (res === "full") {
                              toast({
                                kind: "error",
                                title: "Betslip complet (8 sélections max)",
                              });
                            } else if (res === "source_conflict") {
                              toast({
                                kind: "error",
                                title: "Mélange interdit",
                                description:
                                  "Impossible de mélanger match réel et match virtuel.",
                              });
                            }
                            return;
                          }
                          openBet({
                            match,
                            selection: outcome.key,
                            odds: outcome.odds,
                            label: outcome.label,
                            market: g.key,
                            marketLabel: g.label,
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Chronologie compacte */}
            {cleanEvents.length > 0 && (
              <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
                <h2 className="font-display text-[11px] font-extrabold uppercase tracking-wider text-mist">
                  Chronologie ({cleanEvents.length})
                </h2>
                <div className="mt-1.5 divide-y divide-edge/60">
                  {cleanEvents.map((ev, idx) => (
                    <div
                      key={`${ev.minute}-${ev.type}-${idx}`}
                      className="flex items-center justify-between gap-2 py-1.5 text-[11px]"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="inline-flex min-w-[28px] justify-center rounded bg-elev px-1 py-0.5 font-display text-[10px] font-bold tabular-nums text-ink">
                          {ev.minute}’
                        </span>
                        <span className="text-[11px]">
                          {ev.type === "goal"
                            ? "⚽"
                            : ev.type === "red"
                              ? "🟥"
                              : "🟨"}
                        </span>
                        <span className="truncate font-semibold text-ink">
                          {ev.player}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-dim">
                        {ev.team === "home" ? match.homeTeam : match.awayTeam}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
    </PullToRefresh>
  );
}
