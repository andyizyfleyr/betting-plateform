"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { api, type ClientMatchHistoryItem } from "@/lib/api";
import { getCachedMatchHistoryItem } from "@/lib/client-entity-cache";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { useApp } from "@/components/providers";
import {
  hasAnyRealStats,
  RealMatchStatsCard,
} from "@/components/real-match-stats-card";
import { SportIcon } from "@/components/sport-icon";
import { PullToRefresh } from "@/components/pull-to-refresh";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import { TeamAvatar } from "@/components/team-avatar";
import { cn, formatKickoff, formatOdds } from "@/lib/format";

export default function ResultDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const paramPending = params?.id === undefined;
  const matchId = Number(params?.id);
  const invalidId = !paramPending && (!Number.isInteger(matchId) || matchId <= 0);
  const { oddsFormat } = useApp();

  const [prevId, setPrevId] = useState(matchId);
  const [item, setItem] = useState<ClientMatchHistoryItem | null | undefined>(() =>
    paramPending
      ? undefined
      : invalidId
        ? null
        : (getCachedMatchHistoryItem(matchId) ?? undefined)
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  if (matchId !== prevId) {
    setPrevId(matchId);
    setItem(
      paramPending
        ? undefined
        : invalidId
          ? null
          : (getCachedMatchHistoryItem(matchId) ?? undefined)
    );
  }

  const fetchResult = useCallback(
    async (forceRefresh = false) => {
      if (invalidId) return;
      try {
        const base = await api.matchHistory(undefined, { forceRefresh });
        const inBase = base.matches.find((m) => m.id === matchId) ?? null;
        if (inBase) {
          setItem(inBase);
          setLoadError(null);
          return;
        }
        const focused = await api.matchHistory(matchId, { forceRefresh });
        setItem(focused.focusedMatch ?? null);
        setLoadError(null);
      } catch (e) {
        setItem((prev) => (prev === undefined ? null : prev));
        setLoadError(
          e instanceof Error
            ? e.message
            : "Impossible de charger ce résultat."
        );
      }
    },
    [invalidId, matchId]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchResult(false);
    if (item?.status === "finished") return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetchResult(false);
    }, 5_000);
    return () => clearInterval(id);
  }, [fetchResult, item?.status]);

  const handlePullRefresh = useCallback(async () => {
    await fetchResult(true);
  }, [fetchResult]);

  const cleanEvents = useMemo(
    () => (item ? sanitizeMatchEvents(item.events) : []),
    [item]
  );

  const settledSummary = useMemo(() => {
    if (!item) return [];
    const hs = item.homeScore ?? 0;
    const as = item.awayScore ?? 0;
    const total = hs + as;
    const btts = hs > 0 && as > 0;
    const doubleChance =
      item.winnerCode === "V1"
        ? "1X & 12"
        : item.winnerCode === "V2"
          ? "12 & 2X"
          : "1X & 2X";
    return [
      { label: "Double chance", value: doubleChance },
      {
        label: "Total 2.5",
        value: total >= 3 ? `TP 2.5 (${total} b.)` : `TM 2.5 (${total} b.)`,
      },
      {
        label: "Les 2 marquent",
        value: btts ? "Oui" : "Non",
      },
      ...(item.htWinnerCode && item.winnerCode
        ? [
            {
              label: "MT-Fin",
              value: `${item.htWinnerCode}-${item.winnerCode}`,
            },
          ]
        : []),
    ];
  }, [item]);

  if (item === undefined && !loadError) {
    return <PulseFlashLoader />;
  }

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
    <div className="mx-auto w-full max-w-[1440px] px-3 pb-6 pt-2.5 lg:px-0 lg:py-0">
      {/* En-tête compact en ligne */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                triggerRouteLoader("/resultats");
                router.push("/resultats");
              }
            }}
            aria-label="Retour aux résultats"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:h-9 lg:w-9"
          >
            <ArrowLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" strokeWidth={2.3} />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <SportIcon
                sport={item?.sport ?? "football"}
                className="h-3.5 w-3.5 shrink-0 text-betclic-red"
              />
              <h1 className="truncate font-display text-[14px] font-extrabold text-ink lg:text-[18px]">
                {item?.league ?? "Résultat"}
              </h1>
            </div>
            {item && (
              <p className="truncate text-[10px] leading-tight text-dim lg:text-[11px]">
                {formatKickoff(item.finishedAt ?? item.startsAt)}
              </p>
            )}
          </div>
        </div>

        <span className="shrink-0 rounded-full bg-win/12 px-2 py-0.5 font-display text-[10px] font-bold text-win">
          Officiel FT
        </span>
      </div>

      <div className="mt-2.5 lg:mt-4">
        {item === undefined ? (
          <PulseFlashLoader compact />
        ) : item === null ? (
          <div className="glass-card rounded-xl p-4 text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-betclic-red" />
            <p className="mt-1.5 font-display text-[14.5px] font-bold text-ink">
              {loadError ? "Connexion interrompue" : "Résultat introuvable"}
            </p>
            <p className="mt-0.5 text-[11.5px] text-mist">
              {loadError ?? "Ce match n'est pas encore terminé ou n'existe plus."}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void fetchResult()}
                className="inline-flex items-center gap-1 rounded-lg bg-elev px-3 py-1.5 font-display text-[11.5px] font-bold text-ink"
              >
                <RefreshCw className="h-3 w-3" />
                Réessayer
              </button>
              <Link
                href={`/matchs/${matchId}`}
                className="btn-red rounded-lg px-3.5 py-1.5 text-[11.5px]"
              >
                Fiche du match
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 lg:space-y-4">
            {/* Scoreboard final compact */}
            <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="flex flex-col items-center gap-1 text-center">
                  <TeamAvatar
                    name={item.homeTeam}
                    logo={item.homeLogo}
                    size="sm"
                    className="lg:hidden"
                  />
                  <TeamAvatar
                    name={item.homeTeam}
                    logo={item.homeLogo}
                    size="md"
                    className="hidden lg:grid"
                  />
                  <span className="font-display text-[11.5px] font-bold leading-tight text-ink lg:text-[13px]">
                    {item.homeTeam}
                  </span>
                </div>

                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-1 rounded-lg bg-elev px-2.5 py-1 font-display text-[18px] font-black tabular-nums leading-none text-ink lg:rounded-xl lg:px-4 lg:py-2 lg:text-[24px]">
                    <span
                      className={cn(
                        (item.homeScore ?? 0) > (item.awayScore ?? 0) && "text-win"
                      )}
                    >
                      {item.homeScore ?? 0}
                    </span>
                    <span className="text-[12px] text-dim lg:text-[15px]">-</span>
                    <span
                      className={cn(
                        (item.awayScore ?? 0) > (item.homeScore ?? 0) && "text-win"
                      )}
                    >
                      {item.awayScore ?? 0}
                    </span>
                  </div>
                  {item.htHome != null && item.htAway != null && (
                    <span className="mt-0.5 text-[9.5px] font-semibold tabular-nums text-dim lg:mt-1 lg:text-[10.5px]">
                      MT {item.htHome}-{item.htAway}
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center gap-1 text-center">
                  <TeamAvatar
                    name={item.awayTeam}
                    logo={item.awayLogo}
                    size="sm"
                    className="lg:hidden"
                  />
                  <TeamAvatar
                    name={item.awayTeam}
                    logo={item.awayLogo}
                    size="md"
                    className="hidden lg:grid"
                  />
                  <span className="font-display text-[11.5px] font-bold leading-tight text-ink lg:text-[13px]">
                    {item.awayTeam}
                  </span>
                </div>
              </div>

              {/* Cotes 1X2 de clôture compactes */}
              <div className="mt-2.5 grid grid-cols-3 gap-1.5 border-t border-edge/70 pt-2">
                {[
                  { code: "V1", label: "1", odds: item.oddsHome },
                  { code: "X", label: "N", odds: item.oddsDraw },
                  { code: "V2", label: "2", odds: item.oddsAway },
                ].map((c) => {
                  const won = item.winnerCode === c.code;
                  return (
                    <div
                      key={c.code}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-2.5 py-1.5",
                        won
                          ? "border-win/45 bg-win/10 text-win"
                          : "border-edge bg-elev/50 text-mist"
                      )}
                    >
                      <span className="font-display text-[10.5px] font-bold">
                        {c.label}
                      </span>
                      <span className="font-display text-[12px] font-extrabold tabular-nums">
                        {c.odds ? formatOdds(c.odds, oddsFormat) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Marchés principaux validés en grille 2 colonnes compacte */}
            <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <h2 className="font-display text-[11px] font-extrabold uppercase tracking-wider text-mist">
                Marchés réglés
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {settledSummary.map((row) => (
                  <div
                    key={row.label}
                    className="rounded-lg bg-elev/60 px-2.5 py-1.5"
                  >
                    <p className="text-[9.5px] font-semibold uppercase tracking-wide text-dim">
                      {row.label}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 truncate font-display text-[11.5px] font-bold text-ink">
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-win" />
                      <span className="truncate">{row.value}</span>
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* Statistiques officielles ou télémétrie virtuelle */}
            {item.source === "manual" && hasAnyRealStats(item.realStats) && (
              <RealMatchStatsCard
                stats={item.realStats}
                homeTeam={item.homeTeam}
                awayTeam={item.awayTeam}
                homeLogo={item.homeLogo}
                awayLogo={item.awayLogo}
                htHomeScore={item.htHome}
                htAwayScore={item.htAway}
                compact
              />
            )}

            {item.source !== "manual" && item.telemetry && (
              <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
                <h2 className="font-display text-[11px] font-extrabold uppercase tracking-wider text-mist">
                  Statistiques
                </h2>
                <div className="mt-2 space-y-1 text-[11px]">
                  {[
                    {
                      label: "Possession",
                      left: `${item.telemetry.possessionHome}%`,
                      right: `${item.telemetry.possessionAway}%`,
                    },
                    {
                      label: "xG",
                      left: item.telemetry.xgHome.toFixed(2),
                      right: item.telemetry.xgAway.toFixed(2),
                    },
                    {
                      label: "Tirs (cadrés)",
                      left: `${item.telemetry.shotsTotalHome} (${item.telemetry.shotsOnTargetHome})`,
                      right: `${item.telemetry.shotsTotalAway} (${item.telemetry.shotsOnTargetAway})`,
                    },
                    {
                      label: "Corners",
                      left: String(item.telemetry.cornersHome),
                      right: String(item.telemetry.cornersAway),
                    },
                    {
                      label: "Attaques dang.",
                      left: String(item.telemetry.dangerousAttacksHome),
                      right: String(item.telemetry.dangerousAttacksAway),
                    },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between rounded-lg bg-elev/55 px-2.5 py-1.5"
                    >
                      <span className="font-display font-bold tabular-nums text-ink">
                        {s.left}
                      </span>
                      <span className="text-[10.5px] font-medium text-mist">
                        {s.label}
                      </span>
                      <span className="font-display font-bold tabular-nums text-ink">
                        {s.right}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Chronologie compacte */}
            {cleanEvents.length > 0 && (
              <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
                <h2 className="font-display text-[11px] font-extrabold uppercase tracking-wider text-mist">
                  Faits de match ({cleanEvents.length})
                </h2>
                <div className="mt-1.5 divide-y divide-edge/60">
                  {cleanEvents.map((ev, idx) => (
                    <div
                      key={`${ev.minute}-${ev.type}-${idx}`}
                      className="flex items-center justify-between gap-2 py-1.5 text-[11px]"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="inline-flex min-w-[28px] justify-center rounded bg-elev px-1 py-0.5 font-display text-[10px] font-bold tabular-nums text-ink">
                          {ev.minute}&apos;
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
                        {ev.team === "home" ? item.homeTeam : item.awayTeam}
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
