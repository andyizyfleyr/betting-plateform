"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Share2, X } from "lucide-react";
import { api, type ClientBet, type ClientSavedCouponLeg } from "@/lib/api";
import { triggerHaptic } from "@/lib/feedback";
import { cn, eur, formatOdds } from "@/lib/format";
import { PulseMark } from "@/components/pulse-logo";

interface Props {
  bet: ClientBet | null;
  onClose: () => void;
}

function formatReceiptDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} · ${time}`;
}

function ReceiptStatusBadge({ status }: { status: ClientBet["status"] }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: "En cours", className: "bg-elev text-ink" },
    won: { label: "Gagné", className: "bg-win/12 text-win" },
    lost: { label: "Perdu", className: "bg-betclic-red/12 text-betclic-red" },
    cashed: { label: "Vendu", className: "bg-sky-500/12 text-sky-700" },
    void: { label: "Remboursé", className: "bg-amber-500/12 text-amber-800" },
  };
  const item = map[status] ?? map.pending;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 font-display text-[10px] font-medium",
        item.className
      )}
    >
      {item.label}
    </span>
  );
}

export function ShareTicketModal({ bet, onClose }: Props) {
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponSaving, setCouponSaving] = useState(false);
  const [couponCopied, setCouponCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [lastBetId, setLastBetId] = useState<string | null>(null);

  // Réinitialise l'état local quand on ouvre le partage d'un autre ticket.
  const currentBetId = bet ? String(bet.id) : null;
  if (currentBetId !== lastBetId) {
    setLastBetId(currentBetId);
    setCouponCode(null);
    setCouponCopied(false);
    setShared(false);
  }

  if (!bet) return null;

  const title =
    bet.kind === "combo"
      ? `Combiné PULSE (${bet.legs?.length ?? 2} sélections)`
      : bet.kind === "prediction"
        ? (bet.question ?? bet.homeTeam)
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
          b.kind === "prediction"
            ? (b.question ?? "Prédiction")
            : `${b.homeTeam} – ${b.awayTeam}`,
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

  const couponMessage = couponCode
    ? `\nCode coupon : ${couponCode} (chargez-le dans l'app pour jouer les mêmes matchs)`
    : "";

  const generateCouponCode = async () => {
    if (couponSaving) return;
    const legs = buildCouponLegs(bet);
    if (legs.length === 0) return;
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

  const shareMessage = `Ticket PULSE #${bet.id}\n${title}\n${bet.selectionLabel} @ ${formatOdds(bet.odds)}\nMise : ${eur(bet.stake)} · Gain potentiel : ${eur(bet.potentialWin)}${couponMessage}\nhttps://be-plateform.vercel.app`;

  const handleShare = async () => {
    triggerHaptic(false, 10);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Mon ticket Pulse Bet", text: shareMessage });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareMessage);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      /* silencieux */
    }
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
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="absolute inset-0 m-auto flex h-fit max-h-[92dvh] w-[calc(100%-24px)] max-w-[400px] flex-col overflow-hidden rounded-3xl bg-surface p-4 shadow-2xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <PulseMark size={22} />
              <span className="truncate font-display text-[12.5px] font-bold uppercase tracking-wide text-ink">
                Pulse Bet · Ticket #{bet.id}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elev text-mist active:scale-95"
            >
              <X className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            <div className="rounded-2xl border border-edge bg-elev/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-dim">
                  {formatReceiptDate(bet.placedAt)}
                </span>
                <ReceiptStatusBadge status={bet.status} />
              </div>

              <p className="mt-2 font-display text-[12px] font-bold leading-snug text-ink">
                {title}
              </p>
              <p className="mt-1 truncate font-display text-[11.5px] font-medium text-betclic-red">
                {bet.selectionLabel}
              </p>

              <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-edge/80 pt-2.5">
                <div className="min-w-0">
                  <p className="text-[9.5px] font-medium text-dim">Mise</p>
                  <p className="truncate font-display text-[11.5px] font-medium tabular-nums text-ink">
                    {eur(bet.stake)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9.5px] font-medium text-dim">Cote</p>
                  <p className="truncate font-display text-[11.5px] font-medium tabular-nums text-ink">
                    {formatOdds(bet.odds)}
                  </p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[9.5px] font-medium text-dim">Gain max</p>
                  <p className="truncate font-display text-[11.5px] font-medium tabular-nums text-win">
                    {eur(bet.potentialWin)}
                  </p>
                </div>
              </div>
            </div>

            {couponCode ? (
              <div className="mt-2.5 rounded-2xl border border-win/30 bg-win/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-medium uppercase tracking-wider text-win">
                      Code coupon partagé
                    </p>
                    <p className="truncate font-display text-[13px] font-bold tracking-wider text-ink">
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
                  Vos amis chargent ce code dans l&apos;app pour jouer les mêmes
                  matchs.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void generateCouponCode()}
                disabled={couponSaving}
                className="mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-edge bg-white font-display text-[10.5px] font-medium text-ink active:bg-elev disabled:opacity-45"
              >
                {couponSaving ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-betclic-red/40 border-t-betclic-red" />
                ) : (
                  <Share2 className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
                )}
                {couponSaving ? "Génération du code…" : "Générer le code coupon"}
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleShare()}
              className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[11.5px] font-medium text-white active:scale-[0.99]"
            >
              {shared ? (
                <Check className="h-4 w-4" strokeWidth={2.6} />
              ) : (
                <Share2 className="h-4 w-4" strokeWidth={2.3} />
              )}
              {shared ? "Ticket copié !" : "Partager le ticket"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
