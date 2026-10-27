"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Clock,
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
import { sanitizeMatchEvents } from "@/lib/match-events";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import {
  CASHOUT_CHANGED_CODE,
  generateIdempotencyKey,
  type CashoutChangedDetails,
} from "@/lib/odds-lock";
import { StatusPill, shortMarketBadge } from "@/components/bet-ticket";
import { LiveMatchTracker } from "@/components/live-match-tracker";
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
import { SlideToCashOut } from "@/components/slide-to-cashout";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";

const POLL_INTERVAL = 4_000;

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
  const router = useRouter();
  const parsed = useMemo(() => parseSimpleBetSlug(params?.id), [params?.id]);
  const { betsVersion, oddsFormat, setBalance, bumpBets, toast, user } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();
  const pollIntervalMs = getAdaptiveIntervalMs(POLL_INTERVAL, isConstrained);

  const [prevSlug, setPrevSlug] = useState(params?.id);
  const [fetchedBet, setFetchedBet] = useState<ClientBet | null | undefined>(() =>
    !parsed.valid ? null : (getCachedBet(parsed.kind, parsed.id) ?? undefined)
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

  if (params?.id !== prevSlug) {
    setPrevSlug(params?.id);
    const cached = parsed.valid ? getCachedBet(parsed.kind, parsed.id) : undefined;
    setFetchedBet(!parsed.valid ? null : (cached ?? undefined));
    setLinkedMatch(
      cached?.matchId ? (getCachedClientMatch(cached.matchId) ?? null) : null
    );
    setLinkedPrediction(
      cached?.questionId ? (getCachedPrediction(cached.questionId) ?? null) : null
    );
  }

  const bet = !parsed.valid ? null : fetchedBet;
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

  const fetchSingleBet = useCallback(async () => {
    if (!parsed.valid) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (isOffline) return;

    try {
      const r = await api.allBets();
      if (typeof r.balance === "number") setBalance(r.balance);
      const found =
        r.bets.find((b) => b.kind === parsed.kind && b.id === parsed.id) ??
        r.bets.find((b) => b.kind !== "combo" && b.id === parsed.id) ??
        null;
      setFetchedBet(found);
      setLoadError(null);

      if (found?.kind === "sport" && found.matchId) {
        try {
          const mr = await api.matchById(found.matchId);
          if (mr.match) setLinkedMatch(mr.match);
        } catch {
          /* match archivé hors cache : conservé tel quel */
        }
      } else if (found?.kind === "prediction" && found.questionId) {
        try {
          const pr = await api.predictionsCatalog();
          const q = pr.questions.find((item) => item.id === found.questionId) ?? null;
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
  }, [parsed.valid, parsed.kind, parsed.id, isOffline, setBalance]);

  const isPending = bet?.status === "pending";

  useEffect(() => {
    if (!user || !parsed.valid) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSingleBet();
    if (!isPending && bet !== undefined) return;
    const id = setInterval(() => void fetchSingleBet(), pollIntervalMs);
    return () => clearInterval(id);
  }, [
    user,
    parsed.valid,
    fetchSingleBet,
    betsVersion,
    reloadNonce,
    isPending,
    bet,
    pollIntervalMs,
  ]);

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

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-6 pb-8">
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="font-display text-[17px] font-bold text-ink">
            Connectez-vous pour consulter ce pari
          </p>
          <div className="mt-4 flex justify-center gap-2.5">
            <Link
              href="/auth?mode=login"
              className="btn-red rounded-xl px-5 py-2.5 text-[12.5px]"
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

  const matchStatus = linkedMatch?.status ?? bet?.matchStatus ?? "upcoming";
  const homeScore = linkedMatch?.homeScore ?? bet?.matchHomeScore ?? null;
  const awayScore = linkedMatch?.awayScore ?? bet?.matchAwayScore ?? null;
  const hasScore = homeScore != null && awayScore != null;
  const isReal = (linkedMatch?.source ?? bet?.matchSource) === "manual";
  const realStatsAvailable = isReal && hasAnyRealStats(linkedMatch?.realStats);
  const { homeGoals, awayGoals } = formatGoalSummary(
    linkedMatch?.events,
    homeScore ?? 0,
    awayScore ?? 0
  );

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
                  router.push("/paris");
                }
              }}
              aria-label="Retour à Mes paris"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elev text-ink transition-colors hover:bg-edge active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.3} />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {isPrediction ? (
                  <TrendingUp
                    className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                    strokeWidth={2.3}
                  />
                ) : (
                  <SportIcon
                    sport={bet?.sport ?? "football"}
                    className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                  />
                )}
                <h1 className="truncate font-display text-[15px] font-extrabold text-ink">
                  {isPrediction ? "Pari prédiction" : "Pari simple"}
                </h1>
              </div>
              {bet && (
                <p className="truncate text-[11px] text-dim">
                  Ticket #{bet.id} · placé {formatPlacedAt(bet.placedAt)}
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
                className="inline-flex h-8 items-center gap-1 rounded-full bg-elev px-2.5 font-display text-[11px] font-bold text-ink transition-colors hover:bg-edge active:scale-95"
              >
                <Share2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                Flex
              </button>
              <StatusPill
                status={bet.status}
                live={live}
                minute={linkedMatch?.minute ?? bet.matchMinute}
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-3.5 pt-3.5 lg:px-0 lg:pt-4">
        {loadError && bet === undefined ? (
          <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-5 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-rose-600" />
            <p className="mt-2 font-display text-[14px] font-bold text-ink">
              Chargement interrompu
            </p>
            <p className="mt-1 text-[12px] text-mist">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setReloadNonce((n) => n + 1);
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-betclic-red px-4 py-2 font-display text-[12px] font-bold text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Réessayer
            </button>
          </div>
        ) : bet === undefined ? (
          <div className="space-y-3">
            <div className="skeleton h-[156px] rounded-2xl" />
            <div className="skeleton h-[180px] rounded-2xl" />
          </div>
        ) : bet === null ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <p className="font-display text-[16px] font-bold text-ink">
              Pari introuvable
            </p>
            <p className="mt-1 text-[12.5px] text-mist">
              Ce ticket n&apos;existe pas ou n&apos;appartient pas à votre compte.
            </p>
            <Link
              href="/paris"
              className="btn-red mt-4 inline-flex rounded-xl px-5 py-2.5 text-[12.5px]"
            >
              Retour à Mes paris
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Carte financière & sélection verrouillée */}
            <section
              className={cn(
                "glass-card overflow-hidden rounded-2xl p-4",
                won && "ticket-won",
                lost && "border-betclic-red/25"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {shortMarketBadge(bet.market) && (
                      <span className="rounded-md bg-elev px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-mist">
                        {shortMarketBadge(bet.market)}
                      </span>
                    )}
                    <span className="text-[11.5px] font-medium text-mist">
                      Cote fixe verrouillée
                    </span>
                  </div>
                  <p className="mt-1.5 font-display text-[16px] font-extrabold leading-snug text-ink">
                    {bet.selectionLabel}
                  </p>
                </div>

                <div className="shrink-0 rounded-xl bg-betclic-red/10 px-3 py-1.5 text-right">
                  <div className="text-[9.5px] font-bold uppercase tracking-wider text-betclic-red">
                    Cote
                  </div>
                  <div className="font-display text-[16px] font-black tabular-nums text-betclic-red">
                    {formatOdds(bet.odds, oddsFormat)}
                  </div>
                </div>
              </div>

              {/* Montants financiers alignés horizontalement */}
              <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-edge/80 pt-3">
                <div className="inline-flex items-baseline gap-1">
                  <span className="text-[10.5px] font-medium text-dim">Mise :</span>
                  <span className="font-display text-[13.5px] font-bold tabular-nums text-ink">
                    {eur(bet.stake)}
                  </span>
                </div>

                <div className="inline-flex items-baseline gap-1">
                  <span className="text-[10.5px] font-medium text-dim">Cote :</span>
                  <span className="font-display text-[13.5px] font-bold tabular-nums text-ink">
                    ×{formatOdds(bet.odds, oddsFormat)}
                  </span>
                </div>

                <div className="inline-flex items-baseline gap-1">
                  {won ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">
                        Gain reçu :
                      </span>
                      <span className="font-display text-[14px] font-extrabold tabular-nums text-win">
                        +{eur(bet.potentialWin)}
                      </span>
                    </>
                  ) : cashed ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">
                        Vendu pour :
                      </span>
                      <span className="font-display text-[14px] font-extrabold tabular-nums text-sky-700">
                        {eur(bet.cashOutAmount ?? 0)}
                      </span>
                    </>
                  ) : voided ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">
                        Remboursé :
                      </span>
                      <span className="font-display text-[13.5px] font-bold tabular-nums text-ink">
                        {eur(bet.stake)}
                      </span>
                    </>
                  ) : lost ? (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">
                        Résultat :
                      </span>
                      <span className="font-display text-[14px] font-extrabold tabular-nums text-betclic-red">
                        -{eur(bet.stake)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10.5px] font-medium text-dim">
                        Gain max :
                      </span>
                      <span className="font-display text-[14px] font-extrabold tabular-nums text-ink">
                        {eur(bet.potentialWin)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {bet.settledAt && bet.status !== "pending" && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-dim">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>Résultat validé {formatPlacedAt(bet.settledAt)}</span>
                </div>
              )}

              {/* Vendre le coupon (vert créatif + glisser-confirmer) */}
              {canCashOut && (
                <div className="mt-3.5 space-y-2 border-t border-edge/80 pt-3.5">
                  {cashoutChanged && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/12 px-3 py-2 text-[11.5px] text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">
                          Offre réévaluée : {eur(cashoutChanged.previousCashout)} →{" "}
                          <span className="font-bold">
                            {eur(cashoutChanged.currentCashout)}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-amber-800/90">
                          Glissez à nouveau pour confirmer la vente à ce montant.
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

            {/* Détail complet de l'événement (Sport ou Prédiction) */}
            {isPrediction ? (
              <section className="glass-card overflow-hidden rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-betclic-red/10 px-2 py-0.5 font-display text-[10.5px] font-bold uppercase tracking-wide text-betclic-red">
                    {bet.league}
                  </span>
                  {linkedPrediction?.resolvesAt && (
                    <span className="text-[11px] font-medium tabular-nums text-dim">
                      Clôture · {formatKickoff(linkedPrediction.resolvesAt)}
                    </span>
                  )}
                </div>

                <h2 className="mt-2.5 font-display text-[16px] font-extrabold leading-snug text-ink">
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
                    <div className="mt-3.5 space-y-2">
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
                              "relative overflow-hidden rounded-xl border px-3 py-2.5",
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
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-display text-[13px] font-bold text-ink">
                                  {opt.label}
                                </span>
                                {picked && (
                                  <span className="shrink-0 rounded-full bg-betclic-red px-2 py-0.5 font-display text-[9.5px] font-bold text-white">
                                    Votre choix
                                  </span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="text-[11.5px] font-semibold tabular-nums text-mist">
                                  {sharePct}%
                                </span>
                                <span className="font-display text-[13px] font-extrabold tabular-nums text-ink">
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
                  <Link
                    href={`/predictions/${bet.questionId}`}
                    className="mt-4 flex items-center justify-between rounded-xl bg-elev px-3.5 py-2.5 font-display text-[12.5px] font-bold text-ink transition-colors hover:bg-edge active:scale-[0.99]"
                  >
                    <span>Ouvrir la page dédiée de cette prédiction</span>
                    <ChevronRight className="h-4 w-4 text-dim" strokeWidth={2.3} />
                  </Link>
                )}
              </section>
            ) : (
              <section className="space-y-3.5">
                <div className="glass-card overflow-hidden rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-mist">
                      <SportIcon
                        sport={bet.sport}
                        className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                      />
                      <span className="truncate">{bet.league}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {bet.matchStartsAt && (
                        <span className="text-[11px] font-medium tabular-nums text-dim">
                          {formatKickoff(bet.matchStartsAt)}
                        </span>
                      )}
                      {matchStatus === "live" && linkedMatch ? (
                        <LiveStatusBadge
                          minute={linkedMatch.minute}
                          suspended={linkedMatch.suspended}
                        />
                      ) : matchStatus === "finished" ? (
                        <span className="rounded-full bg-elev px-2.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-mist">
                          Terminé
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Scoreboard complet sans troncature des clubs */}
                  <div className="mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <TeamAvatar
                        name={bet.homeTeam}
                        logo={linkedMatch?.homeLogo ?? bet.homeLogo}
                        size="lg"
                      />
                      <span className="font-display text-[12.5px] font-bold leading-tight text-ink">
                        {bet.homeTeam}
                      </span>
                    </div>

                    <div className="flex flex-col items-center">
                      {hasScore ? (
                        <div className="flex items-center gap-1.5 rounded-xl bg-elev px-3.5 py-1.5 font-display text-[22px] font-black tabular-nums leading-none text-ink">
                          <span>{homeScore}</span>
                          <span className="text-[14px] text-dim">-</span>
                          <span>{awayScore}</span>
                        </div>
                      ) : (
                        <span className="rounded-xl bg-elev px-3 py-1.5 font-display text-[13px] font-extrabold text-mist">
                          VS
                        </span>
                      )}
                      {linkedMatch &&
                        linkedMatch.htHomeScore != null &&
                        linkedMatch.htAwayScore != null && (
                          <span className="mt-1 text-[10.5px] font-semibold tabular-nums text-dim">
                            MT {linkedMatch.htHomeScore}-{linkedMatch.htAwayScore}
                          </span>
                        )}
                    </div>

                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <TeamAvatar
                        name={bet.awayTeam ?? ""}
                        logo={linkedMatch?.awayLogo ?? bet.awayLogo}
                        size="lg"
                      />
                      <span className="font-display text-[12.5px] font-bold leading-tight text-ink">
                        {bet.awayTeam}
                      </span>
                    </div>
                  </div>

                  {(homeGoals.length > 0 || awayGoals.length > 0) && (
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

                  {/* Actions rapides vers la page dédiée du match / résultat */}
                  {bet.matchId && (
                    <div className="mt-3.5 grid grid-cols-1 gap-2 border-t border-edge/80 pt-3 sm:grid-cols-2">
                      <Link
                        href={`/matchs/${bet.matchId}`}
                        className="flex items-center justify-between rounded-xl bg-elev px-3.5 py-2.5 font-display text-[12px] font-bold text-ink transition-colors hover:bg-edge active:scale-[0.99]"
                      >
                        <span>Fiche du match & marchés</span>
                        <ChevronRight className="h-4 w-4 text-dim" strokeWidth={2.3} />
                      </Link>
                      <Link
                        href={`/resultats?match=${bet.matchId}`}
                        className="flex items-center justify-between rounded-xl bg-elev px-3.5 py-2.5 font-display text-[12px] font-bold text-ink transition-colors hover:bg-edge active:scale-[0.99]"
                      >
                        <span>Voir dans les résultats</span>
                        <ChevronRight className="h-4 w-4 text-dim" strokeWidth={2.3} />
                      </Link>
                    </div>
                  )}
                </div>

                {/* Tracker 2D temps réel ou statistiques officielles ESPN */}
                {linkedMatch && !isReal && matchStatus === "live" && (
                  <LiveMatchTracker match={linkedMatch} />
                )}

                {linkedMatch && realStatsAvailable && (
                  <RealMatchStatsCard
                    stats={linkedMatch.realStats}
                    homeTeam={linkedMatch.homeTeam}
                    awayTeam={linkedMatch.awayTeam}
                    homeLogo={linkedMatch.homeLogo}
                    awayLogo={linkedMatch.awayLogo}
                    htHomeScore={linkedMatch.htHomeScore}
                    htAwayScore={linkedMatch.htAwayScore}
                  />
                )}

                {/* Chronologie minute par minute s'il y a des faits de jeu */}
                {cleanEvents.length > 0 && (
                  <div className="glass-card overflow-hidden rounded-2xl p-4">
                    <h3 className="font-display text-[13px] font-extrabold uppercase tracking-wider text-mist">
                      Faits de match ({cleanEvents.length})
                    </h3>
                    <div className="mt-2.5 divide-y divide-edge/70">
                      {cleanEvents.map((ev, i) => (
                        <div
                          key={`${ev.minute}-${ev.type}-${i}`}
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

      <ShareTicketModal
        bet={sharing && bet ? bet : null}
        onClose={() => setSharing(false)}
      />
    </div>
  );
}
