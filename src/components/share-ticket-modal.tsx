"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Share2, X } from "lucide-react";
import { api, type ClientBet } from "@/lib/api";
import type { ClientSavedCouponLeg } from "@/lib/api";
import { triggerHaptic } from "@/lib/feedback";
import { cn, eur, formatOdds, formatPlacedAt } from "@/lib/format";
import { PulseMark } from "@/components/pulse-logo";
import { StatusPill } from "@/components/bet-ticket";

interface Props {
  bet: ClientBet | null;
  onClose: () => void;
}

export function ShareTicketModal({ bet, onClose }: Props) {
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponSaving, setCouponSaving] = useState(false);
  const [couponCopied, setCouponCopied] = useState(false);

  useEffect(() => {
    setCouponCode(null);
    setCouponCopied(false);
  }, [bet]);

  if (!bet) return null;

  const title =
    bet.kind === "combo"
      ? `Combiné PULSE (${bet.legs?.length ?? 2} sélections)`
      : bet.kind === "prediction"
        ? bet.question || bet.homeTeam
        : `${bet.homeTeam} – ${bet.awayTeam}`;

  const buildCouponLegs = (b: ClientBet): ClientSavedCouponLeg[] => {
    if (b.kind === "combo" && b.legs && b.legs.length > 0) {
      return b.legs
        .filter((l) => (l.kind === "sport" ? l.matchId : l.questionId))
        .map((l, i) => ({
          uid: `share-${b.id}-${i}`,
          kind: l.kind,
          matchId: l.matchId ?? undefined,
          questionId: l.questionId ?? undefined,
          title: l.title,
          homeTeam: l.homeTeam,
          awayTeam: l.awayTeam,
          league: l.league,
          market: l.market,
          selection: l.selection,
          selectionLabel: l.selectionLabel,
          odds: l.odds,
        }));
    }
    const kind = b.kind === "prediction" ? "prediction" : "sport";
    const id = kind === "sport" ? b.matchId : b.questionId;
    if (!id) return [];
    return [
      {
        uid: `share-${b.id}`,
        kind,
        matchId: kind === "sport" ? id : undefined,
        questionId: kind === "prediction" ? id : undefined,
        title:
          b.kind === "prediction" ? (b.question ?? "Prédiction") : `${b.homeTeam} – ${b.awayTeam}`,
        homeTeam: b.homeTeam,
        awayTeam: b.awayTeam,
        league: b.league,
        market: b.market,
        selection: b.selection,
        selectionLabel: b.selectionLabel,
        odds: b.odds,
      },
    ];
  };

  const generateCouponCode = async () => {
    if (couponSaving) return;
    const legs = buildCouponLegs(bet);
    if (legs.length === 0) {
      setCouponCode(null);
      return;
    }
    setCouponSaving(true);
    try {
      const { code } = await api.saveCoupon(legs);
      setCouponCode(code);
      triggerHaptic(false, [12, 22]);
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code).catch(() => undefined);
      }
    } catch {
      /* génération échouée : on ne bloque pas le partage */
    } finally {
      setCouponSaving(false);
    }
  };

  const copyCouponCode = async () => {
    if (!couponCode) return;
    triggerHaptic(false, 8);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(couponCode).catch(() => undefined);
    }
    setCouponCopied(true);
    setTimeout(() => setCouponCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        />
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[86dvh] lg:max-w-[500px] lg:rounded-3xl lg:border"
        >
          {/* En-tête brand + fermeture */}
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
            <div className="flex items-center gap-2">
              <PulseMark size={22} />
              <span className="font-display text-[11.5px] font-bold tracking-wide text-ink">
                PULSE BET · TICKET #{bet.id}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist active:scale-95"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
            {/* Reçu du ticket */}
            <div className="overflow-hidden rounded-2xl border border-edge bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] text-mist">
                  {formatPlacedAt(bet.placedAt)}
                </span>
                <StatusPill status={bet.status} live={false} minute={null} />
              </div>

              <p className="mt-2 font-display text-[13px] font-bold text-ink">
                {title}
              </p>
              <p className="text-[11.5px] font-medium text-dim">
                {bet.selectionLabel}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-wider text-mist">
                    Mise
                  </p>
                  <p className="font-display text-[12.5px] font-bold text-ink">
                    {eur(bet.stake)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-wider text-mist">
                    Cote
                  </p>
                  <p className="font-display text-[12.5px] font-bold text-ink">
                    {formatOdds(bet.odds)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-medium uppercase tracking-wider text-mist">
                    Gain max
                  </p>
                  <p className="font-display text-[12.5px] font-bold text-win">
                    {eur(bet.potentialWin)}
                  </p>
                </div>
              </div>
            </div>

            {/* Code de partage du coupon */}
            {couponCode ? (
              <div className="mt-3 rounded-2xl border border-win/30 bg-win/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-medium uppercase tracking-wider text-win">
                      Code coupon partagé
                    </p>
                    <p className="truncate font-display text-[14px] font-bold tracking-wider text-ink">
                      {couponCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyCouponCode()}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-win px-2.5 font-display text-[10.5px] font-medium text-white active:scale-95"
                  >
                    {couponCopied ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
                    ) : (
                      <Copy className="h-3.5 w-3.5" strokeWidth={2.2} />
                    )}
                    {couponCopied ? "Copié" : "Copier"}
                  </button>
                </div>
                <p className="mt-1 text-[9.5px] text-mist">
                  Vos amis chargent ce code dans l&apos;app pour jouer les mêmes matchs.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void generateCouponCode()}
                disabled={couponSaving}
                className={cn(
                  "mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl font-display text-[11.5px] font-medium active:scale-[0.99]",
                  couponSaving
                    ? "border border-edge bg-white text-ink"
                    : "bg-betclic-red text-white"
                )}
              >
                {couponSaving ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Share2 className="h-4 w-4" strokeWidth={2.3} />
                )}
                {couponSaving ? "Génération du code…" : "Générer le code coupon"}
              </button>
            )}

            <p className="mt-3 text-center text-[9.5px] text-dim">
              Partager ce code permet à vos amis de jouer les mêmes matchs.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
