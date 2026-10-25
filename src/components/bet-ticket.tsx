"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, HandCoins, Layers, Loader2, Share2, TrendingUp, X } from "lucide-react";
import { api, type ClientBet } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { useApp } from "./providers";

export function BetTicket({
  bet,
  onShare,
}: {
  bet: ClientBet;
  index?: number;
  onShare?: (bet: ClientBet) => void;
}) {
  const { oddsFormat, setBalance, bumpBets, toast, user } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [cashing, setCashing] = useState(false);

  const isPrediction = bet.kind === "prediction";
  const isCombo = bet.kind === "combo";
  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const live = bet.matchStatus === "live" && bet.status === "pending";
  const canCashOut = bet.status === "pending" && bet.cashOut != null;

  const doCashOut = async () => {
    if (cashing) return;
    setCashing(true);
    try {
      const r = await api.cashOut(bet.id, bet.kind);
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
      toast({
        kind: "error",
        title: "Vente du coupon impossible",
        description: e instanceof Error ? e.message : "Réessayez dans un instant",
      });
    } finally {
      setCashing(false);
      setConfirming(false);
    }
  };

  return (
    <article
      className={cn(
        "glass-card overflow-hidden rounded-2xl p-3.5 transition-opacity",
        won && "ticket-won",
        lost && "opacity-75"
      )}
    >
      {/* En-tête : ligue/catégorie + bouton partager + badge de statut */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-mist">
          {isCombo ? (
            <Layers className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
          ) : isPrediction ? (
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
          ) : (
            <SportIcon sport={bet.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
          )}
          {!isCombo && !isPrediction && bet.matchSource && (
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide",
                bet.matchSource === "manual"
                  ? "bg-emerald-600/12 text-emerald-700"
                  : "bg-elev text-dim"
              )}
            >
              {bet.matchSource === "manual" ? "Réel" : "Virtuel"}
            </span>
          )}
          <span className="truncate">{bet.league}</span>
          {bet.boostPct != null && bet.boostPct > 0 && (
            <span className="shrink-0 rounded-md bg-win/12 px-1.5 py-0.5 font-display text-[9.5px] font-bold text-win">
              +{bet.boostPct}% Bonus
            </span>
          )}
          <span className="text-dim">·</span>
          <span className="shrink-0 text-[11px] text-dim">
            {formatPlacedAt(
              bet.status !== "pending" ? (bet.settledAt ?? bet.placedAt) : bet.placedAt
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(bet)}
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

      {/* Événement(s) */}
      <div className="mt-2.5">
        {isCombo && bet.legs ? (
          <div className="space-y-1.5">
            {bet.legs.map((leg, i) => {
              const legHref =
                leg.kind === "sport" && leg.matchId
                  ? `/resultats?match=${leg.matchId}`
                  : leg.kind === "prediction"
                    ? "/predictions"
                    : null;

              const scoreBadge =
                leg.kind === "sport" && leg.matchHomeScore != null && leg.matchAwayScore != null
                  ? leg.matchStatus === "live"
                    ? `${leg.matchHomeScore}-${leg.matchAwayScore} · ${leg.matchMinute ?? "LIVE"}`
                    : `${leg.matchHomeScore} - ${leg.matchAwayScore}`
                  : null;

              const content = (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9.5px] font-bold",
                        leg.status === "won"
                          ? "bg-win/15 text-win"
                          : leg.status === "lost"
                            ? "bg-betclic-red/15 text-betclic-red"
                            : leg.status === "void"
                              ? "bg-amber-500/15 text-amber-700"
                              : "bg-white text-dim"
                      )}
                    >
                      {leg.status === "won"
                        ? "✓"
                        : leg.status === "lost"
                          ? "✕"
                          : leg.status === "void"
                            ? "↺"
                            : "•"}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {leg.kind === "sport" && leg.matchSource && (
                          <span
                            className={cn(
                              "shrink-0 rounded px-1 py-0.5 font-display text-[8.5px] font-bold uppercase tracking-wide",
                              leg.matchSource === "manual"
                                ? "bg-emerald-600/12 text-emerald-700"
                                : "bg-white text-dim ring-1 ring-edge"
                            )}
                          >
                            {leg.matchSource === "manual" ? "Réel" : "Virtuel"}
                          </span>
                        )}
                        <p className="truncate font-display text-[12.5px] font-semibold text-ink">
                          {leg.title}
                        </p>
                        {scoreBadge && (
                          <span
                            className={cn(
                              "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[10px] font-bold tabular-nums",
                              leg.matchStatus === "live"
                                ? "bg-betclic-red/12 text-betclic-red"
                                : "bg-white text-ink ring-1 ring-edge"
                            )}
                          >
                            {scoreBadge}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-mist">{leg.selectionLabel}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="font-display text-[12px] font-bold tabular-nums text-betclic-red">
                      {formatOdds(leg.odds, oddsFormat)}
                    </span>
                    {legHref && (
                      <ChevronRight className="h-3.5 w-3.5 text-dim" strokeWidth={2.2} />
                    )}
                  </div>
                </>
              );

              return legHref ? (
                <Link
                  key={`${leg.kind}-${leg.matchId ?? leg.questionId ?? i}`}
                  href={legHref}
                  className="flex items-center justify-between gap-2 rounded-xl bg-elev/80 px-2.5 py-2 transition-colors hover:bg-elev active:bg-edge/60"
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={`${leg.kind}-${leg.matchId ?? leg.questionId ?? i}`}
                  className="flex items-center justify-between gap-2 rounded-xl bg-elev/80 px-2.5 py-2"
                >
                  {content}
                </div>
              );
            })}
          </div>
        ) : isPrediction ? (
          <>
            <p className="font-display text-[14.5px] font-semibold leading-snug text-ink">
              {bet.question}
            </p>
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[12.5px] font-semibold text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-betclic-red">
                {formatOdds(bet.odds, oddsFormat)}
              </span>
            </div>
          </>
        ) : (
          <>
            {bet.matchId ? (
              <Link
                href={`/resultats?match=${bet.matchId}`}
                className="-mx-1.5 flex items-center gap-2.5 rounded-xl px-1.5 py-1 transition-colors hover:bg-elev/70 active:bg-elev"
              >
                <div className="flex shrink-0 -space-x-2">
                  <TeamAvatar name={bet.homeTeam} size="xs" className="ring-2 ring-white" />
                  <TeamAvatar name={bet.awayTeam} size="xs" className="ring-2 ring-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[14px] font-semibold text-ink">
                    {bet.homeTeam} <span className="text-dim">–</span> {bet.awayTeam}
                  </p>
                  {(bet.matchHomeScore != null || bet.matchStartsAt) && (
                    <p className="text-[11px] tabular-nums text-dim">
                      {bet.matchStatus === "live" && bet.matchHomeScore != null
                        ? `Score live : ${bet.matchHomeScore} - ${bet.matchAwayScore}`
                        : bet.matchStatus === "finished" && bet.matchHomeScore != null
                          ? `Score final : ${bet.matchHomeScore} - ${bet.matchAwayScore}`
                          : bet.matchStartsAt
                            ? formatKickoff(bet.matchStartsAt)
                            : null}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
              </Link>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="flex shrink-0 -space-x-2">
                  <TeamAvatar name={bet.homeTeam} size="xs" className="ring-2 ring-white" />
                  <TeamAvatar name={bet.awayTeam} size="xs" className="ring-2 ring-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[14px] font-semibold text-ink">
                    {bet.homeTeam} <span className="text-dim">–</span> {bet.awayTeam}
                  </p>
                  {(bet.matchHomeScore != null || bet.matchStartsAt) && (
                    <p className="text-[11px] tabular-nums text-dim">
                      {bet.matchStatus === "live" && bet.matchHomeScore != null
                        ? `Score live : ${bet.matchHomeScore} - ${bet.matchAwayScore}`
                        : bet.matchStatus === "finished" && bet.matchHomeScore != null
                          ? `Score final : ${bet.matchHomeScore} - ${bet.matchAwayScore}`
                          : bet.matchStartsAt
                            ? formatKickoff(bet.matchStartsAt)
                            : null}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[12.5px] font-semibold text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-betclic-red">
                {formatOdds(bet.odds, oddsFormat)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Montants */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-2.5">
        <Amount label="Mise" value={eur(bet.stake)} tone="neutral" />
        <Amount
          label={isCombo ? "Cote totale" : "Cote"}
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

      {/* Vendre le coupon (1xBet Cash Out) */}
      {canCashOut && (
        <div className="mt-3">
          {confirming ? (
            <div className="flex items-center gap-2 rounded-xl border border-edge bg-elev p-2">
              <p className="flex-1 pl-1 text-[12px] font-medium text-ink">
                Vendre pour {eur(bet.cashOut!)} ?
              </p>
              <button
                type="button"
                onClick={doCashOut}
                disabled={cashing}
                className="flex h-8 items-center gap-1 rounded-lg bg-betclic-red px-3 font-display text-[12px] font-bold text-white disabled:opacity-60"
              >
                {cashing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
                )}
                Confirmer
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="grid h-8 w-8 place-items-center rounded-lg border border-edge bg-white text-mist"
                aria-label="Annuler"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink font-display text-[12.5px] font-bold text-white active:opacity-90"
            >
              <HandCoins className="h-4 w-4" strokeWidth={2.1} />
              Vendre le coupon · {eur(bet.cashOut!)}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function StatusPill({
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
      <span className="shrink-0 rounded-full bg-elev px-2.5 py-0.5 font-display text-[10.5px] font-semibold text-dim">
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
    <div className={cn(align === "right" && "text-right")}>
      <p className="text-[10.5px] font-medium text-dim">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-display text-[13.5px] font-bold tabular-nums",
          tone === "win" && "text-win",
          tone === "lost" && "text-mist",
          tone === "cash" && "text-sky-700",
          tone === "pot" && "text-ink",
          tone === "neutral" && "text-ink"
        )}
      >
        {value}
      </p>
    </div>
  );
}
