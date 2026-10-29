"use client";
import { BetDispute } from "@/components/bet-dispute";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Clock,
  Radio,
  RefreshCw,
  Share2,
  TrendingUp,
} from "lucide-react";
import {
  api,
  ApiRequestError,
  type BetKind,
  type ClientBet,
  type ClientMatch,
  type ClientPrediction,
} from "@/lib/api";
import {
  getCachedBet,
  getCachedClientMatch,
  getCachedPrediction,
} from "@/lib/client-entity-cache";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import {
  CASHOUT_CHANGED_CODE,
  generateIdempotencyKey,
  type CashoutChangedDetails,
} from "@/lib/odds-lock";
import { StatusPill, shortMarketBadge } from "@/components/bet-ticket";
import { CardOverlayLink } from "@/components/card-overlay-link";
import { LiveMatchTracker } from "@/components/live-match-tracker";
import { LiveStatusBadge } from "@/components/match-card";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useApp, useFeedMatches } from "@/components/providers";
import { mergeSingleSlimIntoFullMatch } from "@/lib/query-client";
import {
  hasAnyRealStats,
  RealMatchStatsCard,
} from "@/components/real-match-stats-card";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { SlideToCashOut } from "@/components/slide-to-cashout";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";

const POLL_INTERVAL = 3_500;

function parseSimpleBetSlug(raw: string | undefined): {
  kind: BetKind;
  id: number;
  valid: boolean;
} {
  if (!raw) return { kind: "sport", id: 0, valid: false };
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("pred-") || lower.startsWith("prediction-")) {
    const num = Number(lower.replace(/^pred(?:iction)?-/, ""));
    return {
      kind: "prediction",
      id: num,
      valid: Number.isInteger(num) && num > 0,
    };
  }
  const num = Number(lower.replace(/^sport-/, ""));
  return {
    kind: "sport",
    id: num,
    valid: Number.isInteger(num) && num > 0,
  };
}

export default function SingleBetDetailPage() {
  const params = useParams<{ id: string }>();
  const paramPending = params?.id === undefined;
  const rawParamId = String(params?.id ?? "");
  const router = useRouter();
  const parsed = useMemo(() => parseSimpleBetSlug(rawParamId), [rawParamId]);
  const { authReady, betsVersion, oddsFormat, setBalance, bumpBets, toast, user } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();
  const pollIntervalMs = getAdaptiveIntervalMs(POLL_INTERVAL, isConstrained);

  const [prevSlug, setPrevSlug] = useState(params?.id);
  const [fetchedBet, setFetchedBet] = useState<ClientBet | null | undefined>(() =>
    paramPending
      ? undefined
      : !parsed.valid
        ? null
        : (getCachedBet(parsed.kind, parsed.id) ?? undefined)
  );
  const [linkedMatch, setLinkedMatch] = useState<ClientMatch | null>(() => {
    const initial = parsed.valid ? getCachedBet(parsed.kind, parsed.id) : undefined;
    return initial?.matchId ? (getCachedClientMatch(initial.matchId) ?? null) : null;
  });
  const [linkedPrediction, setLinkedPrediction] = useState<ClientPrediction | null>(() => {
    const initial = parsed.valid ? getCachedBet(parsed.kind, parsed.id) : undefined;
    return initial?.questionId
      ? (getCachedPrediction(initial.questionId) ?? null)
      : null;
  });
  const [showTracker, setShowTracker] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024
  );

  if (params?.id !== prevSlug) {
    setPrevSlug(params?.id);
    const cached = parsed.valid ? getCachedBet(parsed.kind, parsed.id) : undefined;
    setFetchedBet(
      paramPending ? undefined : !parsed.valid ? null : (cached ?? undefined)
    );
    setLinkedMatch(
      cached?.matchId ? (getCachedClientMatch(cached.matchId) ?? null) : null
    );
    setLinkedPrediction(
      cached?.questionId ? (getCachedPrediction(cached.questionId) ?? null) : null
    );
  }

  const bet = paramPending ? undefined : !parsed.valid ? null : fetchedBet;
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

  const fetchSingleBet = useCallback(
    async (forceRefresh = false) => {
      if (!parsed.valid) return;
      if (typeof document !== "undefined" && document.hidden && !forceRefresh) {
        return;
      }
      if (isOffline && !forceRefresh) return;

      try {
        let r = await api.betById(parsed.kind, parsed.id, { forceRefresh });
        if (!r.bet && !/^(sport|pred)-/i.test(rawParamId ?? "")) {
          r = await api.betById(
            parsed.kind === "sport" ? "prediction" : "sport",
            parsed.id,
            { forceRefresh }
          );
        }
        if (typeof r.balance === "number") setBalance(r.balance);
        const found = r.bet;
        setFetchedBet(found);
        setLoadError(null);

        if (found?.kind === "sport" && found.matchId) {
          try {
            const mr = await api.matchById(found.matchId, { forceRefresh });
            if (mr.match) setLinkedMatch(mr.match);
          } catch {
            /* match archivé hors cache */
          }
        } else if (found?.kind === "prediction" && found.questionId) {
          try {
            const pr = await api.predictionsCatalog({ forceRefresh });
            const q =
              pr.questions.find((item) => item.id === found.questionId) ?? null;
            if (q) setLinkedPrediction(q);
          } catch {
            /* silencieux */
          }
        }
      } catch (e) {
        setLoadError(
          e instanceof Error
            ? e.message
            : "Impossible de charger ce pari. Réessayez."
        );
      }
    },
    [parsed, rawParamId, isOffline, setBalance]
  );

  const feedMatches = useFeedMatches();
  const ticketMatchId = bet?.matchId ?? null;
  const liveSlimForTicket = useMemo(
    () =>
      ticketMatchId
        ? (feedMatches?.find((m) => m.id === ticketMatchId) ?? null)
        : null,
    [ticketMatchId, feedMatches]
  );
  const effectiveLinkedMatch = useMemo(() => {
    if (!linkedMatch) return liveSlimForTicket;
    if (!liveSlimForTicket) return linkedMatch;
    return mergeSingleSlimIntoFullMatch(linkedMatch, liveSlimForTicket);
  }, [linkedMatch, liveSlimForTicket]);

  const liveMatchSig = liveSlimForTicket
    ? `${liveSlimForTicket.status}:${liveSlimForTicket.homeScore}:${liveSlimForTicket.awayScore}:${liveSlimForTicket.suspended ? 1 : 0}:${liveSlimForTicket.oddsHome}:${liveSlimForTicket.oddsAway}`
    : "";

  const userId = user?.id ?? null;
  const canQueryBet = parsed.valid && (Boolean(userId) || !authReady);
  const shouldPoll = bet === undefined || bet?.status === "pending";

  useEffect(() => {
    if (!canQueryBet) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSingleBet(false);
  }, [canQueryBet, fetchSingleBet, betsVersion, reloadNonce, liveMatchSig]);

  useEffect(() => {
    if (!canQueryBet || !shouldPoll) return;
    const id = setInterval(() => void fetchSingleBet(false), pollIntervalMs);
    return () => clearInterval(id);
  }, [canQueryBet, fetchSingleBet, shouldPoll, pollIntervalMs]);

  const handlePullRefresh = useCallback(async () => {
    await fetchSingleBet(true);
  }, [fetchSingleBet]);

  const effectiveCashOut =
    bet?.cashOut != null
      ? serverOverrideCashout ?? Math.round(bet.cashOut * 100) / 100
      : null;
  const canCashOut = bet?.status === "pending" && effectiveCashOut != null;

  const doCashOut = async () => {
    if (!bet || cashing || inFlightRef.current || effectiveCashOut == null) return;
    inFlightRef.current = true;
    const sig = `${bet.kind ?? "sport"}:${bet.id}:${effectiveCashOut}`;
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
        kind: bet.kind,
        expectedCashout: effectiveCashOut,
        idempotencyKey,
      });
      idempotencySlotRef.current = null;
      setCashoutChanged(null);
      setServerOverrideCashout(null);
      setBalance(r.balance);
      bumpBets();
      void fetchSingleBet();
      toast({
        kind: "success",
        title: `Coupon vendu · ${eur(r.value)}`,
        description: `+${eur(r.value)} crédités sur votre solde.`,
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
        toast({
          kind: "error",
          title: "Offre de rachat réévaluée",
          description: `Nouvelle offre : ${eur(e.cashoutDetails.currentCashout)} (au lieu de ${eur(e.cashoutDetails.previousCashout)}).`,
        });
        return;
      }
      setCashoutChanged(null);
      toast({
        kind: "error",
        title: "Vente indisponible",
        description: e instanceof Error ? e.message : "Action refusée",
      });
    } finally {
      inFlightRef.current = false;
      setCashing(false);
    }
  };

  const cleanEvents = useMemo(
    () => (linkedMatch ? sanitizeMatchEvents(linkedMatch.events) : []),
    [linkedMatch]
  );

  if (!authReady && !user) {
    return <PulseFlashLoader />;
  }

  if (!user && bet == null) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-2 pt-3 pb-6 lg:px-0">
        <div className="glass-card rounded-xl p-4 text-center">
          <p className="font-display text-[12px] font-medium text-ink">
            Connectez-vous pour consulter ce pari
          </p>
          <div className="mt-3 flex justify-center">
            <Link
              href="/auth?mode=login"
              className="btn-red rounded-xl px-4 py-2 text-[10.5px]"
            >
              Connexion
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isPrediction = (bet?.kind ?? parsed.kind) === "prediction";
  const live = Boolean(bet && bet.status === "pending" && bet.matchStatus === "live");
  const won = bet?.status === "won";
  const lost = bet?.status === "lost";
  const cashed = bet?.status === "cashed";
  const voided = bet?.status === "void";

  const matchStatus = effectiveLinkedMatch?.status ?? bet?.matchStatus ?? "upcoming";
  const homeScore = effectiveLinkedMatch?.homeScore ?? bet?.matchHomeScore ?? null;
  const awayScore = effectiveLinkedMatch?.awayScore ?? bet?.matchAwayScore ?? null;
  const hasScore = homeScore != null && awayScore != null;
  const isReal = (effectiveLinkedMatch?.source ?? bet?.matchSource) === "manual";
  const realStatsAvailable = Boolean(
    isReal && hasAnyRealStats(effectiveLinkedMatch?.realStats)
  );
  const canToggleTracker = Boolean(
    effectiveLinkedMatch && ((!isReal && matchStatus === "live") || realStatsAvailable)
  );

  if (!authReady && !user && bet === undefined) {
    return <PulseFlashLoader />;
  }

  if (bet === undefined && !loadError) {
    return <PulseFlashLoader />;
  }

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
    <div className="mx-auto w-full max-w-[1600px] px-2 pb-6 pt-2 lg:px-0 lg:py-0">
      {/* En-tête compact en ligne */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                triggerRouteLoader("/paris");
                router.push("/paris");
              }
            }}
            aria-label="Retour à Mes paris"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:h-9 lg:w-9"
          >
            <ArrowLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" strokeWidth={2.3} />
          </button>

          <div className="min-w-0">
            <h1 className="truncate font-display text-[12px] font-bold leading-tight text-ink lg:text-[14.5px]">
              {isPrediction ? "Pari prédiction" : "Pari simple"}
            </h1>
            {bet && (
              <p className="truncate text-[10px] leading-tight text-mist lg:text-[10.5px]">
                Ticket #{bet.id} · {formatPlacedAt(bet.placedAt)}
              </p>
            )}
          </div>
        </div>

        {bet && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSharing(true)}
              aria-label="Partager ce pari"
              className="inline-flex h-7 items-center gap-1 rounded-full bg-elev px-2 font-display text-[9.5px] font-medium text-ink active:scale-95 lg:h-8 lg:px-2.5 lg:text-[10px]"
            >
              <Share2 className="h-3 w-3 text-betclic-red" strokeWidth={2.2} />
              Flex
            </button>
            <StatusPill
              status={bet.status}
              live={live}
              minute={linkedMatch?.minute ?? bet.matchMinute}
              clockSource={
                live
                  ? (linkedMatch ?? {
                      matchId: bet.matchId,
                      status: "live",
                      minute: bet.matchMinute,
                      startsAt: bet.matchStartsAt,
                      source: bet.matchSource ?? null,
                      clockAnchor: bet.matchClockAnchor ?? null,
                    })
                  : null
              }
            />
          </div>
        )}
      </div>

      <div className="mt-2.5 lg:mt-3.5">
        {loadError && bet === undefined ? (
          <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-4 text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-rose-600" />
            <p className="mt-1.5 font-display text-[11.5px] font-medium text-ink">
              Chargement interrompu
            </p>
            <p className="mt-0.5 text-[10.5px] text-mist">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setReloadNonce((n) => n + 1);
              }}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-betclic-red px-3.5 py-1.5 font-display text-[10.5px] font-medium text-white"
            >
              <RefreshCw className="h-3 w-3" />
              Réessayer
            </button>
          </div>
        ) : bet === undefined ? (
          <PulseFlashLoader compact />
        ) : bet === null ? (
          <div className="glass-card rounded-xl p-4 text-center">
            <p className="font-display text-[12px] font-medium text-ink">
              Pari introuvable
            </p>
            <p className="mt-1 text-[10.5px] text-mist">
              Ce ticket n&apos;existe pas ou n&apos;appartient pas à votre compte.
            </p>
            <Link
              href="/paris"
              className="btn-red mt-3 inline-flex rounded-xl px-4 py-2 text-[10.5px]"
            >
              Retour à Mes paris
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5 lg:space-y-4">
            {/* Carte compacte : sélection verrouillée + montants en ligne + Cash Out */}
            <section
              className={cn(
                "glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4",
                won && "ticket-won",
                lost && "border-betclic-red/25"
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-elev px-2.5 py-1.5 lg:rounded-xl lg:px-3 lg:py-2">
                {shortMarketBadge(bet.market) && (
                  <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-display text-[9.5px] font-medium uppercase text-mist ring-1 ring-edge/80">
                    {shortMarketBadge(bet.market)}
                  </span>
                )}
                <span className="truncate text-[11px] font-medium text-ink lg:text-[11.5px]">
                  {bet.selectionLabel}
                </span>
              </div>

              {/* Montants financiers alignés sur une seule ligne compacte */}
              <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-edge/80 pt-2">
                <div className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-[9.5px] font-medium text-dim">Mise :</span>
                  <span className="font-display text-[11px] font-medium tabular-nums text-ink lg:text-[11.5px]">
                    {eur(bet.stake)}
                  </span>
                </div>

                <div className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-[9.5px] font-medium text-dim">Cote :</span>
                  <span className="font-display text-[11px] font-medium tabular-nums text-ink lg:text-[11.5px]">
                    ×{formatOdds(bet.odds, oddsFormat)}
                  </span>
                </div>

                <div className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  {won ? (
                    <>
                      <span className="text-[9.5px] font-medium text-dim">
                        Gain reçu :
                      </span>
                      <span className="font-display text-[11px] font-medium tabular-nums text-win lg:text-[11.5px]">
                        +{eur(bet.potentialWin)}
                      </span>
                    </>
                  ) : cashed ? (
                    <>
                      <span className="text-[9.5px] font-medium text-dim">
                        Vendu pour :
                      </span>
                      <span className="font-display text-[11px] font-medium tabular-nums text-sky-700 lg:text-[11.5px]">
                        {eur(bet.cashOutAmount ?? 0)}
                      </span>
                    </>
                  ) : voided ? (
                    <>
                      <span className="text-[9.5px] font-medium text-dim">
                        Remboursé :
                      </span>
                      <span className="font-display text-[11px] font-medium tabular-nums text-ink">
                        {eur(bet.stake)}
                      </span>
                    </>
                  ) : lost ? (
                    <>
                      <span className="text-[9.5px] font-medium text-dim">
                        Résultat :
                      </span>
                      <span className="font-display text-[11px] font-medium tabular-nums text-betclic-red lg:text-[11.5px]">
                        -{eur(bet.stake)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[9.5px] font-medium text-dim">
                        Gain max :
                      </span>
                      <span className="font-display text-[11px] font-medium tabular-nums text-ink lg:text-[11.5px]">
                        {eur(bet.potentialWin)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {bet.settledAt && bet.status !== "pending" && (
                <div className="mt-1.5 flex items-center gap-1 text-[9.5px] text-dim">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>Validé {formatPlacedAt(bet.settledAt)}</span>
                </div>
              )}

              {/* Vendre le coupon (inchangé de l'avant-dernier push) */}
              {canCashOut && (
                <div className="mt-2.5 space-y-2 border-t border-edge/80 pt-2.5">
                  {cashoutChanged && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/12 px-2.5 py-1.5 text-[10px] text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          Offre réévaluée : {eur(cashoutChanged.previousCashout)} →{" "}
                          <span className="font-medium">
                            {eur(cashoutChanged.currentCashout)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <SlideToCashOut
                    amount={effectiveCashOut ?? 0}
                    stake={bet.stake}
                    loading={cashing}
                    onConfirm={doCashOut}
                  />
                </div>
              )}
            </section>

            {/* Détail compact de l'événement (Sport ou Prédiction) */}
            {isPrediction ? (
              <section
                className={cn(
                  "glass-card relative overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4",
                  Boolean(bet.questionId) && "cursor-pointer transition-colors hover:bg-elev/20 active:bg-elev/40"
                )}
              >
                {Boolean(bet.questionId) && (
                  <CardOverlayLink
                    href={`/predictions/${bet.questionId}`}
                    label={bet.question ?? "Ouvrir la prédiction"}
                    className="rounded-xl lg:rounded-2xl"
                  />
                )}
                <div className="pointer-events-none relative z-[1]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded bg-betclic-red/10 px-1.5 py-0.5 font-display text-[9.5px] font-medium uppercase tracking-wide text-betclic-red">
                      <TrendingUp className="h-3 w-3" />
                      {bet.league}
                    </span>
                    {linkedPrediction?.resolvesAt && (
                      <span className="text-[9.5px] font-medium tabular-nums text-dim">
                        Clôture · {formatKickoff(linkedPrediction.resolvesAt)}
                      </span>
                    )}
                  </div>

                  <h2 className="mt-1.5 font-display text-[11.5px] font-bold leading-snug text-ink lg:text-[12.5px]">
                    {bet.question}
                  </h2>

                  {linkedPrediction && (() => {
                    const opts =
                      linkedPrediction.options && linkedPrediction.options.length >= 2
                        ? linkedPrediction.options
                        : [
                            {
                              key: "yes",
                              label: "Oui",
                              odds: linkedPrediction.oddsYes,
                            },
                            {
                              key: "no",
                              label: "Non",
                              odds: linkedPrediction.oddsNo,
                            },
                          ];
                    const weights = opts.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
                    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
                    return (
                      <div className="mt-2.5 space-y-1.5">
                        {opts.map((opt, idx) => {
                          const sharePct = Math.round((weights[idx] / wSum) * 100);
                          const picked = opt.key === bet.selection;
                          const winner =
                            linkedPrediction.status === "resolved" &&
                            linkedPrediction.resolution === opt.key;
                          return (
                            <div
                              key={opt.key}
                              className={cn(
                                "relative overflow-hidden rounded-lg border px-2.5 py-1.5",
                                winner
                                  ? "border-win/50 bg-win/8"
                                  : picked
                                    ? "border-betclic-red/40 bg-betclic-red/6"
                                    : "border-edge bg-elev/45"
                              )}
                            >
                              <div
                                className={cn(
                                  "pointer-events-none absolute inset-y-0 left-0",
                                  winner
                                    ? "bg-win/15"
                                    : picked
                                      ? "bg-betclic-red/12"
                                      : "bg-ink/[0.04]"
                                )}
                                style={{
                                  width: `${Math.max(4, Math.min(100, sharePct))}%`,
                                }}
                              />
                              <div className="relative flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate font-display text-[10.5px] font-medium text-ink">
                                    {opt.label}
                                  </span>
                                  {picked && (
                                    <span className="shrink-0 rounded-full bg-betclic-red px-1.5 py-0.5 font-display text-[9px] font-medium text-white">
                                      Choisi
                                    </span>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <span className="text-[10px] font-medium tabular-nums text-mist">
                                    {sharePct}%
                                  </span>
                                  <span className="font-display text-[10.5px] font-medium tabular-nums text-ink">
                                    {formatOdds(opt.odds, oddsFormat)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {bet.questionId && (
                    <div className="mt-2.5 flex h-8 items-center justify-between rounded-lg bg-elev px-2.5 font-display text-[10.5px] font-medium text-ink">
                      <span>Marché complet de la prédiction</span>
                      <ChevronRight className="h-3.5 w-3.5 text-dim" strokeWidth={2.3} />
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="space-y-2.5 lg:space-y-3.5">
                <div
                  className={cn(
                    "glass-card relative overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4",
                    Boolean(bet.matchId) && "cursor-pointer transition-colors hover:bg-elev/20 active:bg-elev/40"
                  )}
                >
                  {Boolean(bet.matchId) && (
                    <CardOverlayLink
                      href={
                        matchStatus === "finished"
                          ? `/resultats/${bet.matchId}`
                          : `/matchs/${bet.matchId}`
                      }
                      label={`${bet.homeTeam} – ${bet.awayTeam ?? ""}`}
                      className="rounded-xl lg:rounded-2xl"
                    />
                  )}
                  <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-mist">
                      <SportIcon
                        sport={bet.sport}
                        className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                      />
                      <span className="truncate">{bet.league}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {bet.matchStartsAt && (
                        <span className="text-[10px] font-medium tabular-nums text-dim">
                          {formatKickoff(bet.matchStartsAt)}
                        </span>
                      )}
                      {matchStatus === "live" && linkedMatch ? (
                        <LiveStatusBadge
                          match={linkedMatch}
                          minute={linkedMatch.minute}
                          suspended={linkedMatch.suspended}
                        />
                      ) : matchStatus === "live" ? (
                        <LiveStatusBadge
                          match={{
                            matchId: bet.matchId,
                            status: "live",
                            minute: bet.matchMinute,
                            startsAt: bet.matchStartsAt,
                            source: bet.matchSource ?? null,
                            clockAnchor: bet.matchClockAnchor ?? null,
                          }}
                          minute={bet.matchMinute}
                        />
                      ) : matchStatus === "finished" ? (
                        <span className="rounded-full bg-elev px-2 py-0.5 font-display text-[9.5px] font-medium uppercase tracking-wider text-mist">
                          Terminé
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Équipes & scores en lignes compactes horizontales */}
                  <div className="pointer-events-none relative z-[1] mt-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <TeamAvatar
                          name={bet.homeTeam}
                          logo={linkedMatch?.homeLogo ?? bet.homeLogo}
                          size="xs"
                        />
                        <span className="font-display text-[11px] font-medium leading-snug text-ink lg:text-[11.5px]">
                          {bet.homeTeam}
                        </span>
                      </div>
                      {hasScore && (
                        <span
                          className={cn(
                            "shrink-0 font-display text-[12px] font-medium tabular-nums",
                            matchStatus === "live"
                              ? "text-betclic-red"
                              : (homeScore ?? 0) > (awayScore ?? 0)
                                ? "text-ink"
                                : "text-mist"
                          )}
                        >
                          {homeScore}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <TeamAvatar
                          name={bet.awayTeam ?? ""}
                          logo={linkedMatch?.awayLogo ?? bet.awayLogo}
                          size="xs"
                        />
                        <span className="font-display text-[11px] font-medium leading-snug text-ink lg:text-[11.5px]">
                          {bet.awayTeam}
                        </span>
                      </div>
                      {hasScore && (
                        <span
                          className={cn(
                            "shrink-0 font-display text-[12px] font-medium tabular-nums",
                            matchStatus === "live"
                              ? "text-betclic-red"
                              : (awayScore ?? 0) > (homeScore ?? 0)
                                ? "text-ink"
                                : "text-mist"
                          )}
                        >
                          {awayScore}
                        </span>
                      )}
                    </div>
                  </div>

                  {linkedMatch?.htHomeScore != null &&
                    linkedMatch?.htAwayScore != null && (
                      <div className="pointer-events-none relative z-[1] mt-2 border-t border-edge/60 pt-1.5 text-[9.5px] text-mist">
                        <span className="rounded bg-elev px-1.5 py-0.5 font-medium tabular-nums">
                          MT {linkedMatch.htHomeScore}-{linkedMatch.htAwayScore}
                        </span>
                      </div>
                    )}

                  {/* Action contextuelle unique vers le match ou son résultat */}
                  {bet.matchId && (
                    <div className="pointer-events-none relative z-[1] mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-edge/70 pt-2">
                      {canToggleTracker && (
                        <button
                          type="button"
                          onClick={() => setShowTracker((s) => !s)}
                          className={cn(
                            "pointer-events-auto relative z-10 inline-flex h-7.5 items-center gap-1 rounded-lg px-2.5 font-display text-[10px] font-medium transition-colors",
                            showTracker
                              ? "bg-ink text-white"
                              : "bg-elev text-ink"
                          )}
                        >
                          {isReal ? (
                            <BarChart3 className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Radio className="h-3 w-3 text-betclic-red" />
                          )}
                          {isReal ? "Stats" : "Terrain 2D"}
                        </button>
                      )}
                      <div className="inline-flex h-7.5 flex-1 items-center justify-between rounded-lg bg-elev px-2.5 font-display text-[10px] font-medium text-ink">
                        <span className="truncate">
                          {matchStatus === "finished"
                            ? "Voir le résultat du match"
                            : "Voir le match & les cotes"}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={2.3} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Tracker 2D ou Stats ESPN à la demande sur mobile */}
                {showTracker && linkedMatch && !isReal && matchStatus === "live" && (
                  <LiveMatchTracker match={linkedMatch} />
                )}

                {showTracker && linkedMatch && realStatsAvailable && (
                  <RealMatchStatsCard
                    stats={linkedMatch.realStats}
                    homeTeam={linkedMatch.homeTeam}
                    awayTeam={linkedMatch.awayTeam}
                    homeLogo={linkedMatch.homeLogo}
                    awayLogo={linkedMatch.awayLogo}
                    htHomeScore={linkedMatch.htHomeScore}
                    htAwayScore={linkedMatch.htAwayScore}
                    compact
                  />
                )}

                {/* Chronologie compacte des faits de jeu */}
                {cleanEvents.length > 0 && (
                  <div className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
                    <h3 className="font-display text-[10px] font-bold uppercase tracking-wider text-mist">
                      Faits de match ({cleanEvents.length})
                    </h3>
                    <div className="mt-1.5 divide-y divide-edge/60">
                      {cleanEvents.map((ev, i) => (
                        <div
                          key={`${ev.minute}-${ev.type}-${i}`}
                          className="flex items-center justify-between gap-2 py-1.5 text-[10px]"
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="inline-flex min-w-[28px] justify-center rounded bg-elev px-1 py-0.5 font-display text-[9.5px] font-medium tabular-nums text-ink">
                              {ev.minute}&apos;
                            </span>
                            <span className="text-[10px]">
                              {ev.type === "goal"
                                ? "⚽"
                                : ev.type === "red"
                                  ? "🟥"
                                  : "🟨"}
                            </span>
                            <span className="truncate font-medium text-ink">
                              {ev.player}
                            </span>
                          </div>
                          <span className="shrink-0 text-[9.5px] font-medium text-dim">
                            {ev.team === "home" ? bet.homeTeam : bet.awayTeam}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {bet ? <BetDispute betId={bet.id} betKind={bet.kind === "prediction" ? "prediction" : "sport"} /> : null}
      <ShareTicketModal
        bet={sharing && bet ? bet : null}
        onClose={() => setSharing(false)}
      />
    </div>
    </PullToRefresh>
  );
}
