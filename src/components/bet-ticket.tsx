"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Layers,
  RotateCcw,
  Share2,
  TrendingUp,
  X,
} from "lucide-react";
import {
  ApiRequestError,
  api,
  type ClientBet,
  type ClientComboLeg,
} from "@/lib/api";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import {
  CASHOUT_CHANGED_CODE,
  generateIdempotencyKey,
  type CashoutChangedDetails,
} from "@/lib/odds-lock";
import { SlideToCashOut } from "./slide-to-cashout";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { useApp } from "./providers";

export function shortMarketBadge(market: string): string | null {
  switch (market) {
    case "result":
    case "1x2":
      return "1X2";
    case "double":
    case "double_chance":
      return "DC";
    case "btts":
      return "BTTS";
    case "ou15":
      return "T 1.5";
    case "ou25":
    case "over_under_25":
    case "total_25":
    case "total_ou":
      return "Total";
    case "ou35":
      return "T 3.5";
    case "dnb":
      return "DNB";
    case "score_exact":
      return "Score";
    case "yesno":
      return "Oui/Non";
    case "multichoice":
      return "Choix";
    default:
      return null;
  }
}

export function resolveLegTeams(
  leg: ClientComboLeg
): { home: string; away: string } | null {
  if (leg.kind !== "sport") return null;
  if (leg.homeTeam && leg.awayTeam) {
    return { home: leg.homeTeam, away: leg.awayTeam };
  }
  for (const sep of [" – ", " - ", " vs "]) {
    if (leg.title.includes(sep)) {
      const [h, a] = leg.title.split(sep).map((s) => s.trim());
      if (h && a) return { home: h, away: a };
    }
  }
  return null;
}

export function singleBetHref(bet: Pick<ClientBet, "id" | "kind">): string {
  return bet.kind === "prediction"
    ? `/paris/simple/pred-${bet.id}`
    : `/paris/simple/sport-${bet.id}`;
}

export function BetTicket({
  bet,
  onShare,
}: {
  bet: ClientBet;
  index?: number;
  onShare?: (bet: ClientBet) => void;
}) {
  if (bet.kind === "combo" && bet.legs && bet.legs.length > 0) {
    return <ComboBetTicket bet={bet} legs={bet.legs} onShare={onShare} />;
  }
  return <SingleBetTicket bet={bet} onShare={onShare} />;
}

/**
 * Carte de pari combiné compacte (même gabarit qu'un pari simple).
 * Un clic ouvre la page dédiée `/paris/combine/[id]` avec toutes les sélections détaillées.
 */
function ComboBetTicket({
  bet,
  legs,
  onShare,
}: {
  bet: ClientBet;
  legs: ClientComboLeg[];
  onShare?: (bet: ClientBet) => void;
}) {
  const router = useRouter();
  const { oddsFormat, setBalance, bumpBets, toast, user } = useApp();
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

  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const effectiveCashOut =
    bet.cashOut != null
      ? serverOverrideCashout ?? Math.round(bet.cashOut * 100) / 100
      : null;
  const canCashOut = bet.status === "pending" && effectiveCashOut != null;

  const sortedLegs = useMemo(
    () => sortComboBetLegsChronologically(legs),
    [legs]
  );
  const totalLegs = sortedLegs.length;
  const wonCount = sortedLegs.filter((l) => l.status === "won").length;
  const lostCount = sortedLegs.filter((l) => l.status === "lost").length;
  const liveCount = sortedLegs.filter(
    (l) => l.status === "pending" && l.matchStatus === "live"
  ).length;
  const anyLive =
    bet.status === "pending" && (liveCount > 0 || bet.matchStatus === "live");

  const previewLegs = sortedLegs.slice(0, 2);
  const extraCount = Math.max(0, totalLegs - previewLegs.length);

  const progressSummary = (() => {
    if (won) return `${totalLegs}/${totalLegs} sélections validées`;
    if (cashed) {
      return `Vendu · ${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""}`;
    }
    if (voided) return "Combiné remboursé";
    if (lost) {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${lostCount} perdue${lostCount > 1 ? "s" : ""}`;
    }
    if (liveCount > 0) {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${liveCount} en direct`;
    }
    return `${wonCount}/${totalLegs} sélection${totalLegs > 1 ? "s" : ""} validée${wonCount > 1 ? "s" : ""}`;
  })();

  const doCashOut = async () => {
    if (cashing || inFlightRef.current || effectiveCashOut == null) return;
    inFlightRef.current = true;
    const sig = `${bet.kind ?? "combo"}:${bet.id}:${effectiveCashOut}`;
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

  return (
    <article
      onClick={() => router.push(`/paris/combine/${bet.id}`)}
      className={cn(
        "glass-card cursor-pointer overflow-hidden rounded-2xl p-3.5 transition-all active:bg-elev/35",
        won && "ticket-won",
        lost && "border-betclic-red/25"
      )}
    >
      {/* En-tête identique aux paris simples */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-mist">
          <Layers className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
          <span className="truncate font-semibold text-ink">Combiné</span>
          {bet.boostPct != null && bet.boostPct > 0 && (
            <span className="shrink-0 rounded-md bg-win/12 px-1.5 py-0.5 font-display text-[9.5px] font-bold text-win">
              +{bet.boostPct}%
            </span>
          )}
          <span className="text-dim">·</span>
          <span className="shrink-0 text-[11px] text-dim">
            {formatPlacedAt(
              bet.status !== "pending"
                ? (bet.settledAt ?? bet.placedAt)
                : bet.placedAt
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onShare && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShare(bet);
              }}
              aria-label="Partager ce combiné"
              className="inline-flex h-6 items-center gap-1 rounded-full bg-elev px-2 font-display text-[10px] font-bold text-mist active:bg-edge active:text-ink"
            >
              <Share2 className="h-3 w-3" strokeWidth={2.2} />
              Flex
            </button>
          )}
          <StatusPill status={bet.status} live={anyLive} minute={bet.matchMinute} />
        </div>
      </div>

      {/* Corps compact cliquable vers la page dédiée `/paris/combine/[id]` */}
      <Link
        href={`/paris/combine/${bet.id}`}
        onClick={(e) => e.stopPropagation()}
        className="mt-2.5 block rounded-xl transition-opacity active:opacity-80"
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            {previewLegs.map((leg, idx) => {
              const teams = resolveLegTeams(leg);
              const legLive = leg.status === "pending" && leg.matchStatus === "live";
              const titleText = teams ? `${teams.home} – ${teams.away}` : leg.title;
              return (
                <div
                  key={`${leg.kind}-${leg.matchId ?? leg.questionId ?? idx}`}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <LegMiniStatus leg={leg} live={legLive} />
                    {teams ? (
                      <TeamAvatar name={teams.home} logo={leg.homeLogo} size="2xs" />
                    ) : (
                      <TrendingUp
                        className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                        strokeWidth={2.2}
                      />
                    )}
                    <span
                      className={cn(
                        "truncate font-display text-[13.5px] font-semibold leading-snug",
                        leg.status === "lost" ? "text-mist line-through" : "text-ink"
                      )}
                    >
                      {titleText}
                    </span>
                  </div>

                  <span className="shrink-0 font-display text-[12.5px] font-bold tabular-nums text-mist">
                    {formatOdds(leg.odds, oddsFormat)}
                  </span>
                </div>
              );
            })}
          </div>

          <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
        </div>

        {/* Barre compacte de synthèse (même gabarit que la barre de sélection d'un pari simple) */}
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-elev px-3 py-2">
          <span className="truncate text-[12px] font-semibold text-ink">
            {progressSummary}
            {extraCount > 0
              ? ` · +${extraCount} autre${extraCount > 1 ? "s" : ""}`
              : ""}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-display text-[12px] font-bold text-betclic-red">
            Détails
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </div>
      </Link>

      {/* Montants en ligne (Nom en petit + valeur en grand) */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-edge pt-2.5">
        <Amount label="Mise" value={eur(bet.stake)} tone="neutral" />
        <Amount
          label="Cote"
          value={`×${formatOdds(bet.odds, oddsFormat)}`}
          tone="neutral"
        />
        {won ? (
          <Amount
            label="Gain reçu"
            value={`+${eur(bet.potentialWin)}`}
            tone="win"
            align="right"
          />
        ) : lost ? (
          <Amount
            label="Résultat"
            value={`-${eur(bet.stake)}`}
            tone="lost"
            align="right"
          />
        ) : cashed ? (
          <Amount
            label="Vendu pour"
            value={`+${eur(bet.cashOutAmount ?? 0)}`}
            tone="cash"
            align="right"
          />
        ) : voided ? (
          <Amount
            label="Remboursé"
            value={`+${eur(bet.stake)}`}
            tone="neutral"
            align="right"
          />
        ) : (
          <Amount
            label="Gain max"
            value={eur(bet.potentialWin)}
            tone="pot"
            align="right"
          />
        )}
      </div>

      {/* Vendre le coupon (Cash Out temps réel glisser-confirmer) */}
      {canCashOut && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="mt-3 space-y-2 border-t border-edge/80 pt-3"
        >
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
    </article>
  );
}

function LegMiniStatus({
  leg,
  live,
}: {
  leg: ClientComboLeg;
  live: boolean;
}) {
  if (leg.status === "won") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-win text-white">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (leg.status === "lost") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-betclic-red text-white">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (leg.status === "void") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-500/20 text-amber-800">
        <RotateCcw className="h-2.5 w-2.5" strokeWidth={2.6} />
      </span>
    );
  }
  if (live) {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-betclic-red/12">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
      </span>
    );
  }
  return (
    <span className="h-2 w-2 shrink-0 rounded-full bg-ink/20" aria-hidden />
  );
}

function SingleBetTicket({
  bet,
  onShare,
}: {
  bet: ClientBet;
  onShare?: (bet: ClientBet) => void;
}) {
  const router = useRouter();
  const { oddsFormat, setBalance, bumpBets, toast, user } = useApp();
  const detailHref = singleBetHref(bet);
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

  const isPrediction = bet.kind === "prediction";
  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const live = bet.matchStatus === "live" && bet.status === "pending";
  const effectiveCashOut =
    bet.cashOut != null
      ? serverOverrideCashout ?? Math.round(bet.cashOut * 100) / 100
      : null;
  const canCashOut = bet.status === "pending" && effectiveCashOut != null;

  const doCashOut = async () => {
    if (cashing || inFlightRef.current || effectiveCashOut == null) return;
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

  return (
    <article
      onClick={() => router.push(detailHref)}
      className={cn(
        "glass-card cursor-pointer overflow-hidden rounded-2xl p-3.5 transition-all active:bg-elev/35",
        won && "ticket-won",
        lost && "border-betclic-red/25"
      )}
    >
      {/* En-tête : ligue/catégorie + date/heure + bouton partager + badge de statut */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-mist">
          {isPrediction ? (
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
          ) : (
            <SportIcon sport={bet.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
          )}
          {!isPrediction && bet.matchSource === "manual" && (
            <span className="hidden shrink-0 rounded-md bg-emerald-600/12 px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide text-emerald-700 lg:inline-block">
              Réel
            </span>
          )}
          <span className="truncate">{bet.league}</span>
          <span className="text-dim">·</span>
          <span className="shrink-0 text-[11px] tabular-nums text-dim">
            {formatPlacedAt(
              bet.status !== "pending" ? (bet.settledAt ?? bet.placedAt) : bet.placedAt
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!isPrediction && bet.matchStartsAt && !live && (
            <span className="text-[10.5px] font-medium tabular-nums text-dim">
              {formatKickoff(bet.matchStartsAt)}
            </span>
          )}
          {onShare && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShare(bet);
              }}
              aria-label="Partager ce ticket"
              className="inline-flex h-6 items-center gap-1 rounded-full bg-elev px-2 font-display text-[10px] font-bold text-mist active:bg-edge active:text-ink"
            >
              <Share2 className="h-3 w-3" strokeWidth={2.2} />
              Flex
            </button>
          )}
          <StatusPill status={bet.status} live={live} minute={bet.matchMinute} />
        </div>
      </div>

      {/* Événement cliquable vers la page dédiée du pari simple */}
      <Link
        href={detailHref}
        onClick={(e) => e.stopPropagation()}
        className="mt-2.5 block rounded-xl transition-opacity active:opacity-80"
      >
        {isPrediction ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-[14.5px] font-semibold leading-snug text-ink">
                {bet.question}
              </p>
              <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
            </div>
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[12.5px] font-semibold text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-ink">
                {formatOdds(bet.odds, oddsFormat)}
              </span>
            </div>
          </>
        ) : (
          <>
            {(() => {
              const hasScore = bet.matchHomeScore != null && bet.matchAwayScore != null;
              const matchLive = bet.matchStatus === "live" && hasScore;
              const matchFinished = bet.matchStatus === "finished" && hasScore;
              const homeWon =
                matchFinished && (bet.matchHomeScore ?? 0) > (bet.matchAwayScore ?? 0);
              const awayWon =
                matchFinished &&
                bet.awayTeam != null &&
                (bet.matchAwayScore ?? 0) > (bet.matchHomeScore ?? 0);

              return (
                <div className="flex w-full items-center gap-2.5">
                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <TicketTeamRow
                      name={bet.homeTeam}
                      logo={bet.homeLogo}
                      score={hasScore ? bet.matchHomeScore : null}
                      winner={homeWon}
                      isLive={matchLive}
                      isFinished={matchFinished}
                    />
                    <TicketTeamRow
                      name={bet.awayTeam}
                      logo={bet.awayLogo}
                      score={hasScore ? bet.matchAwayScore : null}
                      winner={awayWon}
                      isLive={matchLive}
                      isFinished={matchFinished}
                    />
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
                </div>
              );
            })()}

            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[12.5px] font-semibold text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-ink">
                {formatOdds(bet.odds, oddsFormat)}
              </span>
            </div>
          </>
        )}
      </Link>

      {/* Montants en ligne (Nom en petit + valeur en grand) */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-edge pt-2.5">
        <Amount label="Mise" value={eur(bet.stake)} tone="neutral" />
        <Amount
          label="Cote"
          value={formatOdds(bet.odds, oddsFormat)}
          tone="neutral"
        />
        {won ? (
          <Amount label="Gain reçu" value={`+${eur(bet.potentialWin)}`} tone="win" align="right" />
        ) : lost ? (
          <Amount label="Résultat" value={`-${eur(bet.stake)}`} tone="lost" align="right" />
        ) : cashed ? (
          <Amount
            label="Vendu pour"
            value={`+${eur(bet.cashOutAmount ?? 0)}`}
            tone="cash"
            align="right"
          />
        ) : voided ? (
          <Amount
            label="Remboursé"
            value={`+${eur(bet.stake)}`}
            tone="neutral"
            align="right"
          />
        ) : (
          <Amount label="Gain max" value={eur(bet.potentialWin)} tone="pot" align="right" />
        )}
      </div>

      {/* Vendre le coupon (1xBet Cash Out temps réel glisser-confirmer) */}
      {canCashOut && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="mt-3 space-y-2 border-t border-edge/80 pt-3"
        >
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
    </article>
  );
}

export function TicketTeamRow({
  name,
  logo,
  score,
  winner,
  isLive,
  isFinished,
  compact = false,
}: {
  name: string;
  logo?: string | null;
  score?: number | null;
  winner?: boolean;
  isLive?: boolean;
  isFinished?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <TeamAvatar name={name} logo={logo} size={compact ? "2xs" : "xs"} />
      <span
        className={cn(
          "truncate font-display font-semibold leading-snug",
          compact ? "text-[12.5px]" : "text-[14px]",
          isFinished && !winner ? "text-mist" : "text-ink"
        )}
      >
        {name}
      </span>
      {score != null && (
        <span
          className={cn(
            "ml-auto min-w-[20px] rounded-md px-1.5 py-0.5 text-center font-display font-bold leading-none tabular-nums",
            compact ? "text-[13px]" : "text-[15px]",
            isLive
              ? "bg-betclic-red/10 text-betclic-red"
              : isFinished && winner
                ? "bg-elev text-ink"
                : "text-mist"
          )}
        >
          {score}
        </span>
      )}
    </div>
  );
}

export function StatusPill({
  status,
  live,
  minute,
}: {
  status: ClientBet["status"];
  live: boolean;
  minute: string | null;
}) {
  if (status === "won") {
    return (
      <span className="shrink-0 rounded-full bg-win/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-win">
        Gagné
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-betclic-red">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
        Perdu
      </span>
    );
  }
  if (status === "cashed") {
    return (
      <span className="shrink-0 rounded-full bg-sky-500/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-sky-700">
        Vendu
      </span>
    );
  }
  if (status === "void") {
    return (
      <span className="shrink-0 rounded-full bg-amber-500/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-amber-800">
        Remboursé
      </span>
    );
  }
  if (live) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-betclic-red/10 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-betclic-red">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
        Direct {minute ?? ""}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-elev px-2.5 py-0.5 font-display text-[10.5px] font-semibold text-ink">
      En cours
    </span>
  );
}

function Amount({
  label,
  value,
  tone,
  align,
}: {
  label: string;
  value: string;
  tone: "neutral" | "win" | "lost" | "cash" | "pot";
  align?: "right";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-baseline gap-1 whitespace-nowrap",
        align === "right" && "justify-end text-right"
      )}
    >
      <span className="text-[10.5px] font-medium text-dim">{label} :</span>
      <span
        className={cn(
          "font-display text-[13.5px] font-bold tabular-nums",
          tone === "win" && "text-win",
          tone === "lost" && "text-betclic-red",
          tone === "cash" && "text-sky-700",
          tone === "pot" && "text-ink",
          tone === "neutral" && "text-ink"
        )}
      >
        {value}
      </span>
    </div>
  );
}
