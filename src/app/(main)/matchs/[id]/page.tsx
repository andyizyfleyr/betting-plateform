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
import { api, type ClientBet, type ClientMatch } from "@/lib/api";
import {
  getAllCachedBets,
  getCachedClientMatch,
} from "@/lib/client-entity-cache";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import { BetTicket } from "@/components/bet-ticket";
import { LiveMatchTracker } from "@/components/live-match-tracker";
import {
  AccordionItem,
  CATEGORY_TABS,
  formatMatchDateTime,
  inferCategory,
  sanitizeMatchMarkets,
  type SheetCategory,
} from "@/components/market-sheet";
import {
  formatGoalSummary,
  LiveStatusBadge,
} from "@/components/match-card";
import { useApp } from "@/components/providers";
import {
  hasAnyRealStats,
  RealMatchStatsCard,
} from "@/components/real-match-stats-card";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { cn } from "@/lib/format";

const LIVE_POLL_MS = 3_500;
const UPCOMING_POLL_MS = 12_000;

function defaultOpenMarkets(match: ClientMatch | null | undefined): Record<string, boolean> {
  const groups = match?.markets ?? [];
  const initial: Record<string, boolean> = {};
  for (const key of ["result", "total_ou", "double_chance", "btts"]) {
    if (groups.some((g) => g.key === key)) initial[key] = true;
  }
  if (Object.keys(initial).length === 0) {
    for (const g of groups.slice(0, 3)) initial[g.key] = true;
  }
  return initial;
}

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = Number(params?.id);
  const invalidId = !Number.isInteger(matchId) || matchId <= 0;

  const {
    openBet,
    oddsFormat,
    target,
    feedMatches,
    comboLegs,
    comboQuickMode,
    toggleComboLeg,
    toast,
    user,
    betsVersion,
  } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();

  const sharedFromFeed = useMemo(
    () =>
      !invalidId && feedMatches
        ? (feedMatches.find((m) => m.id === matchId) ?? null)
        : null,
    [invalidId, feedMatches, matchId]
  );

  const [prevId, setPrevId] = useState(matchId);
  const [fetchedMatch, setFetchedMatch] = useState<ClientMatch | null | undefined>(() =>
    invalidId ? null : (getCachedClientMatch(matchId) ?? undefined)
  );
  const [category, setCategory] = useState<SheetCategory>("all");
  const [showTracker, setShowTracker] = useState(true);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    defaultOpenMarkets(invalidId ? null : getCachedClientMatch(matchId))
  );
  const [myMatchBets, setMyMatchBets] = useState<ClientBet[]>(() =>
    invalidId
      ? []
      : getAllCachedBets().filter(
          (b) => b.kind === "sport" && b.matchId === matchId
        )
  );
  const [shareBet, setShareBet] = useState<ClientBet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (matchId !== prevId) {
    setPrevId(matchId);
    const cached = invalidId ? null : (getCachedClientMatch(matchId) ?? undefined);
    setFetchedMatch(cached);
    setCategory("all");
    setOpenMap(defaultOpenMarkets(cached));
    setMyMatchBets(
      invalidId
        ? []
        : getAllCachedBets().filter(
            (b) => b.kind === "sport" && b.matchId === matchId
          )
    );
  }

  const match = invalidId ? null : (sharedFromFeed ?? fetchedMatch);

  // Dès que les marchés arrivent du réseau pour la 1re fois, ouvre les marchés principaux
  const hasAnyOpen = Object.keys(openMap).length > 0;
  if (match && !hasAnyOpen && (match.markets?.length ?? 0) > 0) {
    setOpenMap(defaultOpenMarkets(match));
  }

  const fetchMatch = useCallback(async () => {
    if (invalidId || isOffline) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const r = await api.matchById(matchId);
      setFetchedMatch(r.match);
      setLoadError(null);
    } catch (e) {
      setFetchedMatch((prev) => (prev === undefined ? null : prev));
      setLoadError(
        e instanceof Error ? e.message : "Impossible de charger ce match."
      );
    }
  }, [invalidId, isOffline, matchId]);

  const status = match?.status;
  const pollMs = getAdaptiveIntervalMs(
    status === "live" ? LIVE_POLL_MS : UPCOMING_POLL_MS,
    isConstrained
  );

  useEffect(() => {
    if (invalidId || sharedFromFeed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMatch();
    if (status === "finished") return;
    const id = setInterval(() => void fetchMatch(), pollMs);
    return () => clearInterval(id);
  }, [invalidId, sharedFromFeed, fetchMatch, status, pollMs]);

  useEffect(() => {
    if (!user || invalidId) return;
    let cancelled = false;
    api
      .allBets()
      .then((r) => {
        if (cancelled) return;
        setMyMatchBets(
          r.bets.filter(
            (b) =>
              (b.kind === "sport" && b.matchId === matchId) ||
              (b.kind === "combo" &&
                b.legs?.some((l) => l.kind === "sport" && l.matchId === matchId))
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, invalidId, matchId, betsVersion]);

  const groups = useMemo(() => sanitizeMatchMarkets(match?.markets), [match]);
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
  const { homeGoals, awayGoals } = formatGoalSummary(
    match?.events,
    match?.homeScore ?? 0,
    match?.awayScore ?? 0
  );
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;

  return (
    <div className="pb-8">
      {/* En-tête collant : retour + ligue (sans label Virtuel) + date/heure du match */}
      <div className="sticky top-[52px] z-30 border-b border-edge bg-white/95 px-3.5 py-2.5 backdrop-blur lg:top-0 lg:rounded-t-2xl lg:px-5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && window.history.length > 1) {
                  router.back();
                } else {
                  router.push("/matchs");
                }
              }}
              aria-label="Retour aux matchs"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elev text-ink transition-colors hover:bg-edge active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.3} />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
                <SportIcon
                  sport={match?.sport ?? "football"}
                  className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                />
                <h1 className="truncate font-display text-[14.5px] font-extrabold text-ink">
                  {match?.league ?? "Match"}
                </h1>
              </div>
              {match && (
                <p className="truncate text-[11px] text-dim">
                  {groups.length > 0
                    ? `${groups.length} marchés disponibles`
                    : isFinished
                      ? "Rencontre terminée"
                      : "Cotes fixes temps réel"}
                </p>
              )}
            </div>
          </div>

          {match && (
            <div className="flex shrink-0 items-center gap-2">
              {isLive ? (
                <LiveStatusBadge
                  minute={match.minute}
                  suspended={match.suspended}
                />
              ) : isFinished ? (
                <span className="rounded-full bg-elev px-2.5 py-1 font-display text-[10.5px] font-bold uppercase tracking-wider text-mist">
                  Terminé
                </span>
              ) : null}
              <span className="shrink-0 rounded-full bg-elev px-2.5 py-1 font-display text-[11px] font-bold tabular-nums text-mist">
                {formatMatchDateTime(match.startsAt)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="px-3.5 pt-3.5 lg:px-0 lg:pt-4">
        {match === undefined ? (
          <div className="space-y-3">
            <div className="skeleton h-[150px] rounded-2xl" />
            <div className="skeleton h-[44px] rounded-full" />
            <div className="skeleton h-[220px] rounded-2xl" />
          </div>
        ) : match === null ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-betclic-red" />
            <p className="mt-2 font-display text-[16px] font-bold text-ink">
              Match introuvable
            </p>
            <p className="mt-1 text-[12.5px] text-mist">
              {loadError ?? "Cette affiche n'est plus disponible."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void fetchMatch()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-elev px-4 py-2 font-display text-[12px] font-bold text-ink"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Réessayer
              </button>
              <Link
                href="/matchs"
                className="btn-red rounded-xl px-4 py-2 text-[12px]"
              >
                Voir tous les matchs
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Scoreboard complet (noms des clubs intégraux sans troncature) */}
            <section className="glass-card overflow-hidden rounded-2xl p-4">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <TeamAvatar
                    name={match.homeTeam}
                    logo={match.homeLogo}
                    size="lg"
                  />
                  <span className="font-display text-[13px] font-extrabold leading-tight text-ink">
                    {match.homeTeam}
                  </span>
                  {(match.redHome ?? 0) > 0 && (
                    <span className="rounded bg-betclic-red px-1.5 py-0.5 font-display text-[9.5px] font-bold text-white">
                      🟥 ×{match.redHome}
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center">
                  {isLive || isFinished ? (
                    <div className="flex items-center gap-1.5 rounded-xl bg-elev px-4 py-2 font-display text-[24px] font-black tabular-nums leading-none text-ink">
                      <span
                        className={cn(
                          isFinished &&
                            (match.homeScore ?? 0) > (match.awayScore ?? 0) &&
                            "text-betclic-red"
                        )}
                      >
                        {match.homeScore ?? 0}
                      </span>
                      <span className="text-[15px] text-dim">-</span>
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
                    <div className="rounded-xl bg-elev px-3.5 py-2 text-center font-display text-[13px] font-extrabold text-mist">
                      VS
                    </div>
                  )}

                  {match.htHomeScore != null && match.htAwayScore != null && (
                    <span className="mt-1 text-[10.5px] font-semibold tabular-nums text-dim">
                      MT {match.htHomeScore}-{match.htAwayScore}
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center gap-1.5 text-center">
                  <TeamAvatar
                    name={match.awayTeam}
                    logo={match.awayLogo}
                    size="lg"
                  />
                  <span className="font-display text-[13px] font-extrabold leading-tight text-ink">
                    {match.awayTeam}
                  </span>
                  {(match.redAway ?? 0) > 0 && (
                    <span className="rounded bg-betclic-red px-1.5 py-0.5 font-display text-[9.5px] font-bold text-white">
                      🟥 ×{match.redAway}
                    </span>
                  )}
                </div>
              </div>

              {(isLive || isFinished) && hasGoals && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-edge/70 pt-2.5 text-[11px] text-mist">
                  <div className="space-y-0.5">
                    {homeGoals.map((g, i) => (
                      <div key={i} className="truncate">
                        ⚽ {g}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-0.5 text-right">
                    {awayGoals.map((g, i) => (
                      <div key={i} className="truncate">
                        {g} ⚽
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Boutons de bascule Tracker 2D / Stats ESPN / Rapport post-match */}
              {(isLive && !isReal) || realStatsAvailable || isFinished ? (
                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-edge/80 pt-3">
                  {((isLive && !isReal) || realStatsAvailable) && (
                    <button
                      type="button"
                      onClick={() => setShowTracker((v) => !v)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[11px] font-bold transition-colors",
                        showTracker
                          ? "bg-ink text-white"
                          : "bg-elev text-ink hover:bg-edge"
                      )}
                    >
                      {isReal ? (
                        <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Radio className="h-3.5 w-3.5 text-betclic-red" />
                      )}
                      {showTracker
                        ? isReal
                          ? "Masquer les stats"
                          : "Masquer le terrain 2D"
                        : isReal
                          ? "Stats officielles"
                          : "Terrain 2D en direct"}
                    </button>
                  )}

                  {isFinished && (
                    <Link
                      href={`/resultats/${match.id}`}
                      className="inline-flex items-center gap-1 rounded-full bg-betclic-red/10 px-3 py-1.5 font-display text-[11px] font-bold text-betclic-red transition-colors hover:bg-betclic-red/15"
                    >
                      Rapport complet du résultat
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.4} />
                    </Link>
                  )}
                </div>
              ) : null}
            </section>

            {/* Terrain 2D live (virtuel) ou statistiques officielles ESPN (réel) */}
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
              />
            )}

            {/* Onglets de catégories de marchés + accordéons complets */}
            {isFinished || groups.length === 0 ? (
              <div className="glass-card rounded-2xl p-5 text-center">
                <p className="font-display text-[14px] font-bold text-ink">
                  {isFinished
                    ? "Cette rencontre est terminée — les marchés sont clôturés."
                    : "Aucun marché ouvert pour le moment."}
                </p>
                {isFinished && (
                  <Link
                    href={`/resultats/${match.id}`}
                    className="btn-red mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px]"
                  >
                    Consulter le bilan détaillé
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            ) : (
              <section className="space-y-3">
                <div className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 py-0.5 lg:mx-0 lg:px-0">
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
                          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 font-display text-[12px] font-bold transition-colors",
                          active
                            ? "bg-betclic-red text-white shadow-xs"
                            : "bg-elev text-mist hover:text-ink"
                        )}
                      >
                        {t.label}
                        <span
                          className={cn(
                            "text-[10.5px] font-semibold tabular-nums",
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
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/12 px-3.5 py-2 text-center font-display text-[12px] font-bold text-amber-800">
                    Marchés momentanément suspendus suite à une action décisive…
                  </div>
                )}

                <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
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

            {/* Chronologie des événements */}
            {cleanEvents.length > 0 && (
              <section className="glass-card overflow-hidden rounded-2xl p-4">
                <h2 className="font-display text-[13px] font-extrabold uppercase tracking-wider text-mist">
                  Chronologie du match ({cleanEvents.length})
                </h2>
                <div className="mt-2.5 divide-y divide-edge/70">
                  {cleanEvents.map((ev, idx) => (
                    <div
                      key={`${ev.minute}-${ev.type}-${idx}`}
                      className="flex items-center justify-between gap-2 py-2 text-[12px]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex min-w-[34px] justify-center rounded-md bg-elev px-1.5 py-0.5 font-display text-[11px] font-bold tabular-nums text-ink">
                          {ev.minute}&apos;
                        </span>
                        <span>
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
                      <span className="shrink-0 text-[11px] font-medium text-dim">
                        {ev.team === "home" ? match.homeTeam : match.awayTeam}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Vos paris engagés sur cette affiche */}
            {myMatchBets.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-[14px] font-extrabold text-ink">
                    Vos paris sur ce match ({myMatchBets.length})
                  </h2>
                  <Link
                    href="/paris"
                    className="font-display text-[12px] font-bold text-betclic-red"
                  >
                    Tous mes paris
                  </Link>
                </div>
                <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                  {myMatchBets.map((b) => (
                    <BetTicket
                      key={`${b.kind}-${b.id}`}
                      bet={b}
                      onShare={(ticket) => setShareBet(ticket)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <ShareTicketModal bet={shareBet} onClose={() => setShareBet(null)} />
    </div>
  );
}
