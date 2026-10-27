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
import {
  api,
  type ClientBet,
  type ClientMatchHistoryItem,
} from "@/lib/api";
import {
  getAllCachedBets,
  getCachedMatchHistoryItem,
} from "@/lib/client-entity-cache";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { BetTicket } from "@/components/bet-ticket";
import { useApp } from "@/components/providers";
import {
  hasAnyRealStats,
  RealMatchStatsCard,
} from "@/components/real-match-stats-card";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { cn, formatKickoff, formatOdds } from "@/lib/format";

export default function ResultDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = Number(params?.id);
  const invalidId = !Number.isInteger(matchId) || matchId <= 0;
  const { oddsFormat, user, betsVersion } = useApp();

  const [prevId, setPrevId] = useState(matchId);
  const [item, setItem] = useState<ClientMatchHistoryItem | null | undefined>(() =>
    invalidId ? null : (getCachedMatchHistoryItem(matchId) ?? undefined)
  );
  const [myMatchBets, setMyMatchBets] = useState<ClientBet[]>(() =>
    invalidId
      ? []
      : getAllCachedBets().filter(
          (b) =>
            (b.kind === "sport" && b.matchId === matchId) ||
            (b.kind === "combo" &&
              b.legs?.some((l) => l.kind === "sport" && l.matchId === matchId))
        )
  );
  const [shareBet, setShareBet] = useState<ClientBet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (matchId !== prevId) {
    setPrevId(matchId);
    setItem(invalidId ? null : (getCachedMatchHistoryItem(matchId) ?? undefined));
    setMyMatchBets(
      invalidId
        ? []
        : getAllCachedBets().filter(
            (b) =>
              (b.kind === "sport" && b.matchId === matchId) ||
              (b.kind === "combo" &&
                b.legs?.some((l) => l.kind === "sport" && l.matchId === matchId))
          )
    );
  }

  const fetchResult = useCallback(async () => {
    if (invalidId) return;
    try {
      const base = await api.matchHistory();
      const inBase = base.matches.find((m) => m.id === matchId) ?? null;
      if (inBase) {
        setItem(inBase);
        setLoadError(null);
        return;
      }
      const focused = await api.matchHistory(matchId);
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
  }, [invalidId, matchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchResult();
  }, [fetchResult]);

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
    const winnerLabel =
      item.winnerCode === "V1"
        ? `1 · ${item.homeTeam}`
        : item.winnerCode === "V2"
          ? `2 · ${item.awayTeam}`
          : "X · Match nul";
    return [
      { label: "Résultat 1X2", value: winnerLabel },
      { label: "Score exact", value: `${hs} - ${as}` },
      {
        label: "Total de buts (2.5)",
        value: total >= 3 ? `Plus de 2.5 (${total})` : `Moins de 2.5 (${total})`,
      },
      {
        label: "Les 2 équipes marquent",
        value: btts ? "Oui" : "Non",
      },
      ...(item.htHome != null && item.htAway != null
        ? [
            {
              label: "Score 1ère mi-temps",
              value: `${item.htHome} - ${item.htAway}`,
            },
          ]
        : []),
    ];
  }, [item]);

  return (
    <div className="pb-8">
      {/* En-tête collant */}
      <div className="sticky top-[52px] z-30 border-b border-edge bg-white/95 px-3.5 py-2.5 backdrop-blur lg:top-0 lg:rounded-t-2xl lg:px-5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && window.history.length > 1) {
                  router.back();
                } else {
                  router.push("/resultats");
                }
              }}
              aria-label="Retour aux résultats"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elev text-ink transition-colors hover:bg-edge active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.3} />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <SportIcon
                  sport={item?.sport ?? "football"}
                  className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                />
                <h1 className="truncate font-display text-[14.5px] font-extrabold text-ink">
                  {item?.league ?? "Résultat du match"}
                </h1>
              </div>
              {item && (
                <p className="truncate text-[11px] text-dim">
                  Terminé · {formatKickoff(item.finishedAt ?? item.startsAt)}
                </p>
              )}
            </div>
          </div>

          <span className="shrink-0 rounded-full bg-win/12 px-2.5 py-1 font-display text-[10.5px] font-bold text-win">
            Officiel FT
          </span>
        </div>
      </div>

      <div className="px-3.5 pt-3.5 lg:px-0 lg:pt-4">
        {item === undefined ? (
          <div className="space-y-3">
            <div className="skeleton h-[150px] rounded-2xl" />
            <div className="skeleton h-[190px] rounded-2xl" />
          </div>
        ) : item === null ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-betclic-red" />
            <p className="mt-2 font-display text-[16px] font-bold text-ink">
              Résultat introuvable
            </p>
            <p className="mt-1 text-[12.5px] text-mist">
              {loadError ?? "Ce match n'est pas encore terminé ou n'existe plus."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void fetchResult()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-elev px-4 py-2 font-display text-[12px] font-bold text-ink"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Réessayer
              </button>
              <Link
                href={`/matchs/${matchId}`}
                className="btn-red rounded-xl px-4 py-2 text-[12px]"
              >
                Ouvrir la fiche du match
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Scoreboard final */}
            <section className="glass-card overflow-hidden rounded-2xl p-4">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <TeamAvatar
                    name={item.homeTeam}
                    logo={item.homeLogo}
                    size="lg"
                  />
                  <span className="font-display text-[13px] font-extrabold leading-tight text-ink">
                    {item.homeTeam}
                  </span>
                </div>

                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-1.5 rounded-xl bg-elev px-4 py-2 font-display text-[24px] font-black tabular-nums leading-none text-ink">
                    <span
                      className={cn(
                        (item.homeScore ?? 0) > (item.awayScore ?? 0) && "text-win"
                      )}
                    >
                      {item.homeScore ?? 0}
                    </span>
                    <span className="text-[15px] text-dim">-</span>
                    <span
                      className={cn(
                        (item.awayScore ?? 0) > (item.homeScore ?? 0) && "text-win"
                      )}
                    >
                      {item.awayScore ?? 0}
                    </span>
                  </div>
                  {item.htHome != null && item.htAway != null && (
                    <span className="mt-1 text-[10.5px] font-semibold tabular-nums text-dim">
                      MT {item.htHome}-{item.htAway}
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center gap-1.5 text-center">
                  <TeamAvatar
                    name={item.awayTeam}
                    logo={item.awayLogo}
                    size="lg"
                  />
                  <span className="font-display text-[13px] font-extrabold leading-tight text-ink">
                    {item.awayTeam}
                  </span>
                </div>
              </div>

              {/* Cotes 1X2 de clôture */}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-edge/80 pt-3">
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
                        "flex items-center justify-between rounded-xl border px-3 py-2",
                        won
                          ? "border-win/45 bg-win/10 text-win"
                          : "border-edge bg-elev/50 text-mist"
                      )}
                    >
                      <span className="font-display text-[11.5px] font-bold">
                        {c.label}
                      </span>
                      <span className="font-display text-[13px] font-extrabold tabular-nums">
                        {c.odds ? formatOdds(c.odds, oddsFormat) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Marchés principaux validés */}
            <section className="glass-card overflow-hidden rounded-2xl p-4">
              <h2 className="font-display text-[13px] font-extrabold uppercase tracking-wider text-mist">
                Marchés réglés
              </h2>
              <div className="mt-2.5 divide-y divide-edge/70">
                {settledSummary.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-2 py-2.5 text-[12.5px]"
                  >
                    <span className="text-mist">{row.label}</span>
                    <span className="inline-flex items-center gap-1.5 font-display font-bold text-ink">
                      <CheckCircle2 className="h-3.5 w-3.5 text-win" />
                      {row.value}
                    </span>
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
              />
            )}

            {item.source !== "manual" && item.telemetry && (
              <section className="glass-card overflow-hidden rounded-2xl p-4">
                <h2 className="font-display text-[13px] font-extrabold uppercase tracking-wider text-mist">
                  Statistiques du match
                </h2>
                <div className="mt-3 space-y-2.5 text-[12px]">
                  {[
                    {
                      label: "Possession",
                      left: `${item.telemetry.possessionHome}%`,
                      right: `${item.telemetry.possessionAway}%`,
                    },
                    {
                      label: "xG (Buts attendus)",
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
                      label: "Attaques dangereuses",
                      left: String(item.telemetry.dangerousAttacksHome),
                      right: String(item.telemetry.dangerousAttacksAway),
                    },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between rounded-xl bg-elev/55 px-3 py-2"
                    >
                      <span className="font-display font-bold tabular-nums text-ink">
                        {s.left}
                      </span>
                      <span className="text-[11.5px] font-medium text-mist">
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

            {/* Chronologie des faits de jeu */}
            {cleanEvents.length > 0 && (
              <section className="glass-card overflow-hidden rounded-2xl p-4">
                <h2 className="font-display text-[13px] font-extrabold uppercase tracking-wider text-mist">
                  Faits de match ({cleanEvents.length})
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
                        {ev.team === "home" ? item.homeTeam : item.awayTeam}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Vos paris sur ce match */}
            {myMatchBets.length > 0 && (
              <section className="space-y-2.5">
                <h2 className="font-display text-[14px] font-extrabold text-ink">
                  Vos paris sur ce match ({myMatchBets.length})
                </h2>
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
