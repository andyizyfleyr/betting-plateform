"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, HandCoins, Loader2, TrendingUp, X } from "lucide-react";
import { api, type ClientBet } from "@/lib/api";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { useApp } from "./providers";

/** Ticket de pari façon "stub" : perforations, tampon, code-barres et cash-out live. */
export function BetTicket({ bet, index = 0 }: { bet: ClientBet; index?: number }) {
  const { oddsFormat, setBalance, bumpBets, toast } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [cashing, setCashing] = useState(false);

  const isPrediction = bet.kind === "prediction";
  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const live = bet.matchStatus === "live" && bet.status === "pending";
  const canCashOut = bet.status === "pending" && bet.cashOut != null;

  const doCashOut = async () => {
    if (cashing) return;
    setCashing(true);
    try {
      const r = await api.cashOut(bet.id);
      setBalance(r.balance);
      bumpBets();
      toast({
        kind: "success",
        title: "Pari encaissé",
        description: `+${eur(r.value)} crédités sur votre solde`,
      });
    } catch (e) {
      toast({
        kind: "error",
        title: "Encaissement impossible",
        description: e instanceof Error ? e.message : "Réessayez dans un instant",
      });
    } finally {
      setCashing(false);
      setConfirming(false);
    }
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.07, 0.45), ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.985 }}
      className={cn(
        "glass-card relative overflow-hidden rounded-[20px]",
        won && "ticket-won",
        lost && "opacity-70"
      )}
    >
      {live && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(22rem 9rem at 85% -20%, rgba(255,77,94,0.11), transparent 60%)",
          }}
        />
      )}

      {/* Tampon de résultat */}
      {(won || lost || cashed) && (
        <span
          className={cn(
            "pointer-events-none absolute right-3 top-6 rotate-[-10deg] rounded-md border-2 px-2 py-0.5 font-display text-[11px] font-bold tracking-[0.2em]",
            won && "border-win text-win",
            lost && "border-betclic-red text-betclic-red",
            cashed && "border-sky-500 text-sky-600"
          )}
        >
          {won ? "PAYÉ" : lost ? "PERDU" : "CASH-OUT"}
        </span>
      )}

      {/* En-tête du ticket */}
      <div className="relative flex items-center gap-2 px-3.5 pt-3.5">
        {isPrediction ? (
          <>
            <TrendingUp className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
            <span className="font-display text-[10px] font-bold tracking-[0.16em] text-betclic-red">
              PRÉDICTION
            </span>
            <span className="text-dim">·</span>
            <span className="truncate text-[11px] font-medium text-mist">{bet.league}</span>
          </>
        ) : (
          <>
            <SportIcon sport={bet.sport} className="h-3.5 w-3.5 text-dim" />
            <span className="truncate text-[11px] font-medium text-mist">{bet.league}</span>
          </>
        )}
{!won && !lost && !cashed && (
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md bg-betclic-red/15 px-2.5 py-1 font-display text-[9.5px] font-bold tracking-[0.14em] text-betclic-red"
          >
            {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />}
            {live ? `DIRECT · ${bet.matchMinute}` : "EN COURS"}
          </span>
        )}
      </div>

      {/* Question / équipes + sélection */}
      <div className="relative px-3.5 pt-3.5">
        {isPrediction ? (
          <div>
            <p className="font-display text-[14.5px] font-semibold leading-snug">{bet.question}</p>
            <p className="mt-1 text-[11px] text-dim">
              {bet.league} · {formatPlacedAt(bet.placedAt)}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2.5">
              <TeamAvatar name={bet.homeTeam} size="sm" className="ring-2 ring-card" />
              <TeamAvatar name={bet.awayTeam} size="sm" className="ring-2 ring-card" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[14.5px] font-semibold leading-tight">
                {bet.homeTeam} <span className="text-dim">vs</span> {bet.awayTeam}
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-dim">
                {bet.matchStatus === "live" && bet.matchHomeScore != null
                  ? `${bet.matchHomeScore} - ${bet.matchAwayScore} · ${bet.matchMinute}`
                  : bet.matchStatus === "finished" && bet.matchHomeScore != null
                    ? `Score final · ${bet.matchHomeScore} - ${bet.matchAwayScore}`
                    : bet.matchStartsAt
                      ? formatKickoff(bet.matchStartsAt)
                      : formatPlacedAt(bet.placedAt)}
              </p>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between rounded-lg bg-elev px-3.5 py-2.5">
          <span className="text-[12.5px] font-semibold text-ink">{bet.selectionLabel}</span>
          <span className="font-display text-[15px] font-bold tabular-nums text-betclic-red">
            {formatOdds(bet.odds, oddsFormat)}
          </span>
        </div>
      </div>

      {/* Séparateur perforé */}
      <div className="relative mx-3.5 mt-3.5 border-t border-dashed border-edge">
        <span className="absolute -left-[25px] -top-[11px] h-[22px] w-[22px] rounded-full bg-ink shadow-[inset_-1px_0_0_rgba(0,0,0,0.075)]" />
        <span className="absolute -right-[25px] -top-[11px] h-[22px] w-[22px] rounded-full bg-ink shadow-[inset_1px_0_0_rgba(0,0,0,0.075)]" />
      </div>

      {/* Montants */}
      <div className="relative grid grid-cols-3 gap-2 px-3.5 py-3">
        <Amount label="MISE" value={eur(bet.stake)} tone="neutral" />
        <Amount label="COTE" value={formatOdds(bet.odds, oddsFormat)} tone="neutral" />
        {won ? (
          <Amount label="GAIN REÇU" value={`+${eur(bet.potentialWin)}`} tone="win" align="right" />
        ) : lost ? (
          <Amount label="PERDU" value={`-${eur(bet.stake)}`} tone="lost" align="right" />
        ) : cashed ? (
          <Amount
            label="ENCAISSÉ"
            value={`+${eur(bet.cashOutAmount ?? 0)}`}
            tone="cash"
            align="right"
          />
        ) : (
          <Amount label="À GAGNER" value={eur(bet.potentialWin)} tone="pot" align="right" />
        )}
      </div>

      {/* Cash-out live */}
      {canCashOut && (
        <div className="relative px-3.5 pb-3">
          {confirming ? (
            <div className="flex items-center gap-2 rounded-2xl border border-bittersweet/30 bg-bittersweet/[0.08] px-3 py-2">
              <p className="flex-1 text-[11px] font-medium text-bittersweet/90">
                Confirmer l'encaissement ?
              </p>
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={doCashOut}
                disabled={cashing}
                className="flex h-8 items-center gap-1 rounded-full bg-bittersweet px-3 font-display text-[11px] font-bold text-white disabled:opacity-60"
              >
                {cashing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.6} />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.8} />
                )}
                Oui
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => setConfirming(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-elev text-mist"
                aria-label="Annuler"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.4} />
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setConfirming(true)}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#E10014,#FB6962)] font-display text-[12.5px] font-bold text-white shadow-[0_10px_26px_-12px_rgba(225,0,20,0.7)]"
            >
              <HandCoins className="h-4 w-4" strokeWidth={2.2} />
              Encaisser · {eur(bet.cashOut!)}
            </motion.button>
          )}
        </div>
      )}

      {/* Pied stub : code-barres */}
      <div className="relative flex items-center justify-between border-t border-dashed border-edge px-3.5 py-2.5">
        <div className="barcode h-6 w-28 opacity-60" aria-hidden />
        <p className="font-display text-[9px] font-semibold tracking-[0.22em] text-dim">
          N° {String(bet.id).padStart(5, "0")} · {formatPlacedAt(bet.placedAt).toUpperCase()}
        </p>
      </div>
    </motion.article>
  );
}

function Amount({
  label,
  value,
  tone,
  align = "left",
}: {
  label: string;
  value: string;
  tone: "neutral" | "win" | "lost" | "pot" | "cash";
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <p className="text-[9px] font-semibold tracking-[0.16em] text-dim">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-display text-[13.5px] font-bold tabular-nums",
          tone === "win" && "text-betclic-red",
          tone === "lost" && "text-mist",
          tone === "pot" && "text-betclic-red",
          tone === "cash" && "text-bittersweet",
          tone === "neutral" && "text-ink"
        )}
      >
        {value}
      </p>
    </div>
  );
}
