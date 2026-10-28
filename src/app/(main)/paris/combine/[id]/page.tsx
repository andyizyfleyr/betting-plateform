"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Flame,
  Layers,
  RefreshCw,
  RotateCcw,
  Share2,
  TicketX,
  TrendingUp,
  X,
} from "lucide-react";
import {
  ApiRequestError,
  api,
  type ClientBet,
  type ClientComboLeg,
} from "@/lib/api";
import {
  resolveLegTeams,
  shortMarketBadge,
  StatusPill,
  TicketTeamRow,
} from "@/components/bet-ticket";
import { CardOverlayLink } from "@/components/card-overlay-link";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import {
  InfiniteScrollSentinel,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { SlideToCashOut } from "@/components/slide-to-cashout";
import { SportIcon } from "@/components/sport-icon";
import { useApp, useFeedMatches } from "@/components/providers";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import {
  CASHOUT_CHANGED_CODE,
  generateIdempotencyKey,
  type CashoutChangedDetails,
} from "@/lib/odds-lock";
import { getCachedBet } from "@/lib/client-entity-cache";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { LiveMatchClock } from "@/components/live-match-clock";
import type { LiveClockSource } from "@/lib/live-clock";

const POLL_INTERVAL = 3_500;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

function LegStatusBadge({
  status,
  live,
  minute,
  clockSource,
}: {
  status: ClientComboLeg["status"];
  live: boolean;
  minute?: string | null;
  clockSource?: LiveClockSource | null;
}) {
  if (status === "won") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-win/12 px-2 py-0.5 font-display text-[10px] font-bold text-win">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
        Validée
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[10px] font-bold text-betclic-red">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
        Perdue
      </span>
    );
  }
  if (status === "void") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-display text-[10px] font-bold text-amber-800">
        <RotateCcw className="h-2.5 w-2.5" strokeWidth={2.5} />
        Remboursée
      </span>
    );
  }
  if (live) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[10px] font-bold tabular-nums text-betclic-red">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
        <LiveMatchClock match={clockSource} fallback={minute ?? "LIVE"} />
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-elev px-2 py-0.5 font-display text-[10px] font-semibold text-dim">
      En attente
    </span>
  );
}

export default function ComboDetailPage() {
  const params = useParams<{ id: string }>();
  const rawParamId = params?.id;
  const paramPending = rawParamId === undefined;
  const comboId = Number(rawParamId);
  const invalidId = !paramPending && (!Number.isFinite(comboId) || comboId <= 0);
  const { betsVersion, oddsFormat, setBalance, bumpBets, toast, user } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();
  const pollIntervalMs = getAdaptiveIntervalMs(POLL_INTERVAL, isConstrained);

  const [prevComboId, setPrevComboId] = useState(comboId);
  const [fetchedBet, setFetchedBet] = useState<ClientBet | null | undefined>(() =>
    paramPending
      ? undefined
      : invalidId
        ? null
        : (getCachedBet("combo", comboId) ?? undefined)
  );
  if (comboId !== prevComboId) {
    setPrevComboId(comboId);
    setFetchedBet(
      paramPending
        ? undefined
        : invalidId
          ? null
          : (getCachedBet("combo", comboId) ?? undefined)
    );
  }
  const bet = paramPending ? undefined : invalidId ? null : fetchedBet;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [sharing, setSharing] = useState(false);

  const [cashing, setCashing] = useState(false);
  const [cashoutChanged, setCashoutChanged] =
    useState<CashoutChangedDetails | null>(null);
  const [serverOverrideCashout, setServerOverrideCashout] = useState<
    number | null
  >(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  useEffect(() => {
    if (serverOverrideCashout == null) return;
    const t = window.setTimeout(() => setServerOverrideCashout(null), 10_000);
    return () => window.clearTimeout(t);
  }, [serverOverrideCashout]);

  const feedMatches = useFeedMatches();
  const betLegs = bet?.legs;
  const comboLiveSig = useMemo(() => {
    if (!betLegs || !feedMatches) return "";
    const byId = new Map(feedMatches.map((m) => [m.id, m]));
    return betLegs
      .map((l) => {
        if (!l.matchId) return "";
        const m = byId.get(l.matchId);
        if (!m) return "";
        return `${m.id}:${m.status}:${m.homeScore}:${m.awayScore}:${m.suspended ? 1 : 0}:${m.oddsHome}:${m.oddsAway}`;
      })
      .filter(Boolean)
      .join("|");
  }, [betLegs, feedMatches]);

  const fetchCombo = useCallback(
    async (forceRefresh = false) => {
      const r = await api.betById("combo", comboId, { forceRefresh });
      if (typeof r.balance === "number") setBalance(r.balance);
      setFetchedBet(r.bet);
    },
    [comboId, setBalance]
  );

  const handlePullRefresh = useCallback(async () => {
    if (invalidId) return;
    try {
      await fetchCombo(true);
      setLoadError(null);
    } catch {
      /* conserve l'affichage actuel si la connexion coupe brièvement */
    }
  }, [invalidId, fetchCombo]);

  useEffect(() => {
    if (invalidId || !comboLiveSig || bet?.status !== "pending") return;
    let cancelled = false;
    api
      .betById("combo", comboId)
      .then((r) => {
        if (cancelled) return;
        if (typeof r.balance === "number") setBalance(r.balance);
        setFetchedBet(r.bet);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bet?.status, comboId, comboLiveSig, invalidId, setBalance]);

  useEffect(() => {
    if (invalidId) return;

    let cancelled = false;
    async function loadInitial() {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const r = await api.betById("combo", comboId);
          if (cancelled) return;
          if (typeof r.balance === "number") setBalance(r.balance);
          setFetchedBet(r.bet);
          setLoadError(null);
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
            continue;
          }
          if (!cancelled) {
            setLoadError(
              err instanceof Error
                ? err.message
                : "Impossible de charger ce combiné pour le moment."
            );
            setFetchedBet((prev) => (prev === undefined ? null : prev));
          }
        }
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [invalidId, comboId, betsVersion, reloadNonce, setBalance]);

  const isPending = bet?.status === "pending";

  useEffect(() => {
    if (!isPending || invalidId) return;
    let cancelled = false;

    const refreshLive = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      try {
        const ongoingRes = await api.bets("ongoing");
        if (cancelled) return;
        if (typeof ongoingRes.balance === "number") {
          setBalance(ongoingRes.balance);
        }
        const liveCombo = ongoingRes.bets.find(
          (b) => b.kind === "combo" && b.id === comboId
        );
        if (liveCombo) {
          setFetchedBet(liveCombo);
        } else {
          const full = await api.allBets();
          if (!cancelled) {
            if (typeof full.balance === "number") setBalance(full.balance);
            setFetchedBet(
              full.bets.find((b) => b.kind === "combo" && b.id === comboId) ?? null
            );
          }
        }
      } catch {
        /* silencieux en arrière-plan */
      }
    };

    const id = setInterval(() => void refreshLive(), pollIntervalMs);
    const onVisible = () => {
      if (!document.hidden) void refreshLive();
    };
    const onOnline = () => void refreshLive();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [isPending, invalidId, comboId, pollIntervalMs, isOffline, setBalance]);

  const legs = useMemo(
    () => sortComboBetLegsChronologically(bet?.legs ?? []),
    [bet]
  );
  const totalLegs = legs.length;
  const legsBatch = useInfiniteBatch(totalLegs, String(comboId));
  const pagedLegs = useMemo(
    () => legs.slice(0, legsBatch.visibleCount),
    [legs, legsBatch.visibleCount]
  );
  const wonCount = legs.filter((l) => l.status === "won").length;
  const lostCount = legs.filter((l) => l.status === "lost").length;
  const voidCount = legs.filter((l) => l.status === "void").length;
  const liveCount = legs.filter(
    (l) => l.status === "pending" && l.matchStatus === "live"
  ).length;
  const anyLive =
    bet?.status === "pending" && (liveCount > 0 || bet.matchStatus === "live");

  const effectiveCashOut =
    bet && bet.cashOut != null
      ? serverOverrideCashout ?? Math.round(bet.cashOut * 100) / 100
      : null;
  const canCashOut = bet?.status === "pending" && effectiveCashOut != null;

  const doCashOut = async () => {
    if (!bet || cashing || inFlightRef.current || effectiveCashOut == null) return;
    inFlightRef.current = true;
    const sig = `combo:${bet.id}:${effectiveCashOut}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: generateIdempotencyKey("co"),
        sig,
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setCashing(true);
    try {
      const r = await api.cashOut({
        betId: bet.id,
        kind: "combo",
        expectedCashout: effectiveCashOut,
        idempotencyKey,
      });
      idempotencySlotRef.current = null;
      setCashoutChanged(null);
      setServerOverrideCashout(null);
      setBalance(r.balance);
      bumpBets();
      playUiSound(user?.sound, "win");
      triggerHaptic(user?.haptics, [22, 30, 45]);
      toast({
        kind: "success",
        title: "Coupon vendu",
        description: `+${eur(r.value)} crédités sur votre solde`,
      });
    } catch (e) {
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      if (
        e instanceof ApiRequestError &&
        e.status === 409 &&
        e.code === CASHOUT_CHANGED_CODE &&
        e.cashoutDetails
      ) {
        setCashoutChanged(e.cashoutDetails);
        setServerOverrideCashout(e.cashoutDetails.currentCashout);
        bumpBets();
        triggerHaptic(user?.haptics, [12, 20]);
        return;
      }
      setCashoutChanged(null);
      toast({
        kind: "error",
        title: "Vente du coupon impossible",
        description: e instanceof Error ? e.message : "Réessayez dans un instant",
      });
    } finally {
      inFlightRef.current = false;
      setCashing(false);
    }
  };

  const progressSummary = useMemo(() => {
    if (!bet) return "";
    if (bet.status === "won") return `${totalLegs}/${totalLegs} sélections validées`;
    if (bet.status === "cashed") {
      return `Coupon vendu · ${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""}`;
    }
    if (bet.status === "void") return "Combiné intégralement remboursé";
    if (bet.status === "lost") {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${lostCount} perdue${lostCount > 1 ? "s" : ""}`;
    }
    const parts: string[] = [
      `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""}`,
    ];
    if (liveCount > 0) parts.push(`${liveCount} en direct`);
    if (voidCount > 0) parts.push(`${voidCount} annulée${voidCount > 1 ? "s" : ""}`);
    return parts.join(" · ");
  }, [bet, liveCount, lostCount, totalLegs, voidCount, wonCount]);

  if (bet === undefined && !loadError) {
    return <PulseFlashLoader />;
  }

  return (
    <PullToRefresh onRefresh={handlePullRefresh} haptics={user?.haptics}>
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-3.5 lg:px-0 lg:py-0">
        {/* En-tête avec retour vers Mes paris */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/paris"
              aria-label="Retour à Mes paris"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[19px] font-bold leading-tight tracking-tight text-ink lg:text-[23px]">
                {bet ? "Combiné" : "Détail du combiné"}
              </h1>
              {bet && (
                <p className="truncate text-[11.5px] text-mist">
                  Ticket #{bet.id} ·{" "}
                  {formatPlacedAt(
                    bet.status !== "pending"
                      ? (bet.settledAt ?? bet.placedAt)
                      : bet.placedAt
                  )}
                </p>
              )}
            </div>
          </div>

          {bet && (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSharing(true)}
                aria-label="Partager ce combiné"
                className="inline-flex h-8 items-center gap-1 rounded-full bg-elev px-2.5 font-display text-[11px] font-bold text-ink active:scale-95"
              >
                <Share2 className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
                Flex
              </button>
              <StatusPill
                status={bet.status}
                live={Boolean(anyLive)}
                minute={bet.matchMinute}
                clockSource={
                  anyLive
                    ? (() => {
                        const liveLeg = (bet.legs ?? []).find(
                          (l) => l.status === "pending" && l.matchStatus === "live"
                        );
                        return {
                          matchId: bet.liveMatchId ?? liveLeg?.matchId ?? null,
                          status: "live",
                          minute: bet.matchMinute ?? liveLeg?.matchMinute ?? null,
                          startsAt:
                            bet.liveMatchStartsAt ?? liveLeg?.matchStartsAt ?? null,
                          source:
                            bet.liveMatchSource ?? liveLeg?.matchSource ?? null,
                          clockAnchor:
                            bet.matchClockAnchor ?? liveLeg?.matchClockAnchor ?? null,
                        };
                      })()
                    : null
                }
              />
            </div>
          )}
        </div>

        {/* États : chargement, erreur, introuvable ou contenu détaillé */}
        {bet === undefined ? (
          <PulseFlashLoader compact />
        ) : loadError && !bet ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-amber-500/30 bg-white p-5 text-center shadow-xs">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/12 text-amber-600">
              <AlertTriangle className="h-5 w-5" strokeWidth={2.1} />
            </div>
            <p className="mt-3 font-display text-[15px] font-bold text-ink">
              Connexion interrompue
            </p>
            <p className="mt-1 max-w-[320px] text-[12.5px] text-mist">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setFetchedBet(undefined);
                setLoadError(null);
                setReloadNonce((n) => n + 1);
              }}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-betclic-red px-4 font-display text-[12.5px] font-bold text-white shadow-xs active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.3} />
              Réessayer
            </button>
          </div>
        ) : !bet ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
              <TicketX className="h-5 w-5" strokeWidth={1.9} />
            </div>
            <p className="mt-3 font-display text-[15px] font-semibold text-ink">
              Combiné introuvable
            </p>
            <p className="mt-1 max-w-[290px] text-[12.5px] text-dim">
              Ce coupon combiné n&apos;existe pas ou n&apos;est plus accessible sur ce compte.
            </p>
            <Link
              href="/paris"
              className="mt-4 inline-flex h-9.5 items-center gap-1.5 rounded-full bg-betclic-red px-4 font-display text-[12.5px] font-bold text-white active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
              Retour à Mes paris
            </Link>
          </div>
        ) : (
          <div className="mt-3.5 space-y-4">
            {/* Carte synthèse financière + progression + Cash Out */}
            <section
              className={cn(
                "glass-card rounded-2xl p-4",
                bet.status === "won" && "ticket-won"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 font-display text-[12.5px] font-bold text-ink">
                    <Layers className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
                    {progressSummary}
                  </span>
                </div>

                {bet.boostPct != null && bet.boostPct > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-win/12 px-2 py-0.5 font-display text-[10.5px] font-extrabold text-win">
                    <Flame className="h-3 w-3" strokeWidth={2.4} />
                    Boost +{bet.boostPct}%
                  </span>
                )}
              </div>

              {/* Barre de progression segmentée */}
              <div
                className="mt-2.5 flex items-center gap-1"
                role="progressbar"
                aria-valuenow={wonCount}
                aria-valuemin={0}
                aria-valuemax={totalLegs}
              >
                {legs.map((leg, i) => {
                  const isLegLive =
                    leg.status === "pending" && leg.matchStatus === "live";
                  return (
                    <span
                      key={`seg-${leg.kind}-${leg.matchId ?? leg.questionId ?? i}`}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-all duration-300",
                        leg.status === "won"
                          ? "bg-win"
                          : leg.status === "lost"
                            ? "bg-betclic-red"
                            : leg.status === "void"
                              ? "bg-amber-400"
                              : isLegLive
                                ? "live-dot bg-betclic-red"
                                : "bg-ink/12"
                      )}
                    />
                  );
                })}
              </div>

              {/* Montants en ligne (Nom en petit + valeur en grand) */}
              <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-edge pt-3">
                <div className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-[10.5px] font-medium text-dim">Mise :</span>
                  <span className="font-display text-[13.5px] font-bold tabular-nums text-ink">
                    {eur(bet.stake)}
                  </span>
                </div>

                <div className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-[10.5px] font-medium text-dim">Cote :</span>
                  {bet.boostPct != null &&
                    bet.boostPct > 0 &&
                    bet.baseOdds != null &&
                    bet.odds - bet.baseOdds >= 0.01 && (
                      <span className="hidden font-display text-[11px] font-semibold tabular-nums text-dim line-through sm:inline">
                        {formatOdds(bet.baseOdds, oddsFormat)}
                      </span>
                    )}
                  <span className="font-display text-[13.5px] font-bold tabular-nums text-ink">
                    ×{formatOdds(bet.odds, oddsFormat)}
                  </span>
                </div>

                <div className="inline-flex items-baseline justify-end gap-1 whitespace-nowrap text-right">
                  {bet.status === "won" ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">Gain reçu :</span>
                      <span className="font-display text-[13.5px] font-bold tabular-nums text-win">
                        +{eur(bet.potentialWin)}
                      </span>
                    </>
                  ) : bet.status === "lost" ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">Résultat :</span>
                      <span className="font-display text-[13.5px] font-bold tabular-nums text-betclic-red">
                        -{eur(bet.stake)}
                      </span>
                    </>
                  ) : bet.status === "cashed" ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">Vendu pour :</span>
                      <span className="font-display text-[13.5px] font-bold tabular-nums text-sky-700">
                        +{eur(bet.cashOutAmount ?? 0)}
                      </span>
                    </>
                  ) : bet.status === "void" ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">Remboursé :</span>
                      <span className="font-display text-[13.5px] font-bold tabular-nums text-ink">
                        +{eur(bet.stake)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">Gain max :</span>
                      <span className="font-display text-[13.5px] font-bold tabular-nums text-ink">
                        {eur(bet.potentialWin)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {canCashOut && (
                <div className="mt-3 space-y-2 border-t border-edge/80 pt-3">
                  {cashoutChanged && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-snug text-amber-900"
                    >
                      <AlertTriangle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700"
                        strokeWidth={2.3}
                      />
                      <span>
                        Montant mis à jour :{" "}
                        <strong className="line-through opacity-75">
                          {eur(cashoutChanged.previousCashout)}
                        </strong>{" "}
                        → <strong>{eur(cashoutChanged.currentCashout)}</strong>.
                        Confirmez à nouveau pour encaisser.
                      </span>
                    </div>
                  )}
                  <SlideToCashOut
                    amount={effectiveCashOut!}
                    stake={bet.stake}
                    loading={cashing}
                    haptics={user?.haptics}
                    onConfirm={doCashOut}
                  />
                </div>
              )}
            </section>

            {/* Liste propre et aérée de toutes les sélections du combiné */}
            <section>
              <div className="mb-2 flex items-center justify-between px-0.5">
                <h2 className="font-display text-[12.5px] font-bold uppercase tracking-wider text-mist">
                  Sélections du combiné ({totalLegs})
                </h2>
              </div>

              <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                {pagedLegs.map((leg, idx) => {
                  const teams = resolveLegTeams(leg);
                  const legHasScore =
                    leg.kind === "sport" &&
                    leg.matchHomeScore != null &&
                    leg.matchAwayScore != null;
                  const legLive =
                    leg.status === "pending" && leg.matchStatus === "live";
                  const legFinished = leg.matchStatus === "finished" && legHasScore;
                  const legHomeWon =
                    legFinished &&
                    (leg.matchHomeScore ?? 0) > (leg.matchAwayScore ?? 0);
                  const legAwayWon =
                    legFinished &&
                    (leg.matchAwayScore ?? 0) > (leg.matchHomeScore ?? 0);
                  const marketTag = shortMarketBadge(leg.market);
                  const legHref =
                    leg.kind === "sport" && leg.matchId
                      ? leg.matchStatus === "finished"
                        ? `/resultats/${leg.matchId}`
                        : `/matchs/${leg.matchId}`
                      : leg.kind === "prediction"
                        ? leg.questionId
                          ? `/predictions/${leg.questionId}`
                          : "/predictions"
                        : null;

                  const eventContent = teams ? (
                    <div className="flex w-full items-center gap-2.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <TicketTeamRow
                          name={teams.home}
                          logo={leg.homeLogo}
                          score={legHasScore ? leg.matchHomeScore : null}
                          winner={legHomeWon}
                          isLive={legLive}
                          isFinished={legFinished}
                        />
                        <TicketTeamRow
                          name={teams.away}
                          logo={leg.awayLogo}
                          score={legHasScore ? leg.matchAwayScore : null}
                          winner={legAwayWon}
                          isLive={legLive}
                          isFinished={legFinished}
                        />
                      </div>
                      {legHref && (
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-dim"
                          strokeWidth={2.2}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display text-[14px] font-semibold leading-snug text-ink">
                        {leg.title}
                      </p>
                      {legHref && (
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-dim"
                          strokeWidth={2.2}
                        />
                      )}
                    </div>
                  );

                  return (
                    <article
                      key={`${leg.kind}-${leg.matchId ?? leg.questionId ?? idx}`}
                      className={cn(
                        "glass-card relative overflow-hidden rounded-2xl p-3.5 transition-colors",
                        legHref && "cursor-pointer hover:bg-elev/25 active:bg-elev/45",
                        leg.status === "won" && "ticket-won",
                        leg.status === "lost" && "border-betclic-red/25"
                      )}
                    >
                      {legHref && (
                        <CardOverlayLink
                          href={legHref}
                          label={teams ? `${teams.home} – ${teams.away}` : leg.title}
                        />
                      )}
                      <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-mist">
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-elev px-1 font-display text-[10px] font-bold tabular-nums text-ink">
                            {idx + 1}
                          </span>
                          {leg.kind === "prediction" ? (
                            <TrendingUp
                              className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                              strokeWidth={2.3}
                            />
                          ) : (
                            <SportIcon
                              sport={leg.sport || "football"}
                              className="h-3.5 w-3.5 shrink-0 text-dim"
                            />
                          )}
                          <span className="truncate">{leg.league || "Match"}</span>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {leg.matchStartsAt && (
                            <span className="shrink-0 text-[10.5px] font-medium tabular-nums text-dim">
                              {formatKickoff(leg.matchStartsAt)}
                            </span>
                          )}
                          <LegStatusBadge
                            status={leg.status}
                            live={legLive}
                            minute={leg.matchMinute}
                            clockSource={
                              legLive
                                ? {
                                    matchId: leg.matchId,
                                    status: "live",
                                    minute: leg.matchMinute,
                                    startsAt: leg.matchStartsAt,
                                    source: leg.matchSource ?? null,
                                    clockAnchor: leg.matchClockAnchor ?? null,
                                  }
                                : null
                            }
                          />
                        </div>
                      </div>

                      <div className="pointer-events-none relative z-[1] mt-2.5">
                        <div className="-mx-1.5 flex items-center rounded-xl px-1.5 py-1">
                          {eventContent}
                        </div>

                        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-elev px-3 py-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {marketTag && (
                              <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase text-mist ring-1 ring-edge/80">
                                {marketTag}
                              </span>
                            )}
                            <span
                              className={cn(
                                "truncate text-[12.5px] font-semibold",
                                leg.status === "lost"
                                  ? "text-mist line-through"
                                  : "text-ink"
                              )}
                            >
                              {leg.selectionLabel}
                            </span>
                          </div>

                          <span
                            className={cn(
                              "shrink-0 font-display text-[13.5px] font-bold tabular-nums",
                              leg.status === "won"
                                ? "text-win"
                                : leg.status === "lost"
                                  ? "text-betclic-red line-through"
                                  : "text-ink"
                            )}
                          >
                            {formatOdds(leg.odds, oddsFormat)}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <InfiniteScrollSentinel
                hasMore={legsBatch.hasMore}
                isLoadingMore={legsBatch.isLoadingMore}
                onLoadMore={legsBatch.loadMore}
              />
            </section>
          </div>
        )}
      </div>

      <ShareTicketModal
        bet={sharing && bet ? bet : null}
        onClose={() => setSharing(false)}
      />
    </PullToRefresh>
  );
}
