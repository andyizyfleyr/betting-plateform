"use client";

import { useRef, useState } from "react";
import { Check, ChevronsRight, HandCoins, Loader2, X } from "lucide-react";
import { triggerHaptic } from "@/lib/feedback";
import { AnimatedNumber } from "./animated-number";
import { useOddsTrend } from "./odds-trend-corner";
import { cn, eur } from "@/lib/format";

interface SlideToCashOutProps {
  amount: number;
  stake: number;
  loading: boolean;
  haptics?: boolean;
  onConfirm: () => Promise<void> | void;
}

/**
 * Contrôle « Vendre le coupon » (Cash Out 1xBet) sécurisé au pouce :
 * - Mobile (< lg) : glisser-confirmer horizontal (`touch-pan-y` préserve le scroll vertical sans faux déclenchement)
 *   avec montant animé en temps réel et micro-flèche d'évolution ▲ / ▼.
 * - Desktop (>= lg) : bouton avec confirmation 1-clic accessible souris/clavier.
 */
export function SlideToCashOut({
  amount,
  stake,
  loading,
  haptics = true,
  onConfirm,
}: SlideToCashOutProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef<number | null>(null);
  const maxTravelRef = useRef<number>(1);
  const crossedHalfRef = useRef(false);
  const triggeredRef = useRef(false);

  const [dragPx, setDragPx] = useState(0);
  const [maxTravel, setMaxTravel] = useState(220);
  const [dragging, setDragging] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [desktopConfirm, setDesktopConfirm] = useState(false);

  const trend = useOddsTrend(amount, 4200);
  const profit = Math.round((amount - stake) * 100) / 100;
  const inProfit = profit >= 0.01;

  const progress =
    maxTravel > 0 ? Math.min(1, Math.max(0, dragPx / maxTravel)) : 0;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (loading) return;
    const track = trackRef.current;
    if (!track) return;
    const thumbWidth = 46;
    const pad = 8;
    const nextMax = Math.max(80, track.clientWidth - thumbWidth - pad);
    maxTravelRef.current = nextMax;
    setMaxTravel(nextMax);
    startXRef.current = e.clientX;
    crossedHalfRef.current = false;
    triggeredRef.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    triggerHaptic(haptics, 6);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || startXRef.current === null || loading) return;
    const dx = Math.max(0, Math.min(maxTravelRef.current, e.clientX - startXRef.current));
    setDragPx(dx);

    const ratio = dx / maxTravelRef.current;
    if (ratio >= 0.55 && !crossedHalfRef.current) {
      crossedHalfRef.current = true;
      triggerHaptic(haptics, 10);
    }

    if (ratio >= 0.9 && !triggeredRef.current) {
      triggeredRef.current = true;
      setDragging(false);
      setDragPx(maxTravelRef.current);
      triggerHaptic(haptics, [18, 28, 40]);
      void Promise.resolve(onConfirm()).finally(() => {
        setDragPx(0);
      });
    }
  };

  const handlePointerUpOrCancel = () => {
    if (!dragging) return;
    setDragging(false);
    const ratio = maxTravelRef.current > 0 ? dragPx / maxTravelRef.current : 0;
    if (ratio >= 0.8 && !triggeredRef.current && !loading) {
      triggeredRef.current = true;
      setDragPx(maxTravelRef.current);
      triggerHaptic(haptics, [18, 28, 40]);
      void Promise.resolve(onConfirm()).finally(() => {
        setDragPx(0);
      });
      return;
    }
    setDragPx(0);
    startXRef.current = null;
  };

  const handleTrackTapHint = () => {
    if (dragging || loading) return;
    triggerHaptic(haptics, 6);
    setNudge(true);
    setTimeout(() => setNudge(false), 240);
  };

  return (
    <div className="space-y-1">
      {/* ── MOBILE (< lg) : Glisser pour vendre le coupon (zéro clic accidentel au scroll) ── */}
      <div
        ref={trackRef}
        onClick={handleTrackTapHint}
        className="relative flex h-11.5 w-full touch-pan-y items-center overflow-hidden rounded-2xl bg-ink p-1 text-white shadow-xs select-none lg:hidden"
      >
        {/* Jauge de progression verte/rouge au glissement */}
        <div
          aria-hidden
          style={{
            width: `${loading ? 100 : Math.round(progress * 100)}%`,
          }}
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0",
            inProfit ? "bg-win/40" : "bg-betclic-red/40",
            !dragging && "transition-all duration-200"
          )}
        />

        {/* Libellé central + montant temps réel + indicateur d'évolution */}
        <div
          style={{ opacity: loading ? 1 : Math.max(0.18, 1 - progress * 0.95) }}
          className="pointer-events-none relative z-10 flex w-full items-center justify-between pr-3 pl-13"
        >
          <span className="truncate font-display text-[11.5px] font-bold tracking-tight text-white/90">
            {loading
              ? "Vente du coupon…"
              : nudge
                ? "Glissez vers la droite →"
                : "Glisser · Vendre le coupon"}
          </span>

          <span className="inline-flex shrink-0 items-center gap-1 font-display text-[13px] font-extrabold tabular-nums text-white">
            {trend === "up" && (
              <span className="text-[9.5px] leading-none text-emerald-400" aria-hidden>
                ▲
              </span>
            )}
            {trend === "down" && (
              <span className="text-[9.5px] leading-none text-amber-300" aria-hidden>
                ▼
              </span>
            )}
            <AnimatedNumber value={amount} format={eur} />
            {inProfit && (
              <span className="rounded-md bg-emerald-500/25 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-300">
                +{eur(profit)}
              </span>
            )}
          </span>
        </div>

        {/* Curseur tactile à glisser au pouce */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`Glisser pour vendre le coupon à ${eur(amount)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !loading) {
              e.preventDefault();
              void onConfirm();
            }
          }}
          style={{
            transform: `translateX(${loading ? maxTravel : nudge ? 10 : dragPx}px)`,
          }}
          className={cn(
            "relative z-20 grid h-9.5 w-11.5 shrink-0 cursor-grab touch-none place-items-center rounded-xl text-white shadow-md active:cursor-grabbing",
            inProfit ? "bg-win" : "bg-betclic-red",
            !dragging && "transition-transform duration-200"
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          ) : progress >= 0.8 ? (
            <Check className="h-4 w-4" strokeWidth={2.8} />
          ) : (
            <ChevronsRight className="h-4.5 w-4.5" strokeWidth={2.6} />
          )}
        </div>
      </div>

      {/* ── DESKTOP (>= lg) : Bouton + confirmation 1-clic souris ── */}
      <div className="hidden lg:block">
        {desktopConfirm ? (
          <div className="flex items-center gap-2 rounded-xl border border-edge bg-elev p-2">
            <p className="flex-1 pl-1 text-[12px] font-semibold text-ink">
              Vendre pour <AnimatedNumber value={amount} format={eur} /> ?
            </p>
            <button
              type="button"
              onClick={() => {
                void Promise.resolve(onConfirm()).finally(() => setDesktopConfirm(false));
              }}
              disabled={loading}
              className="flex h-8.5 items-center gap-1 rounded-lg bg-betclic-red px-3 font-display text-[12px] font-bold text-white disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
              )}
              Confirmer
            </button>
            <button
              type="button"
              onClick={() => setDesktopConfirm(false)}
              className="grid h-8.5 w-8.5 place-items-center rounded-lg border border-edge bg-white text-mist"
              aria-label="Annuler"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDesktopConfirm(true)}
            className="flex h-10.5 w-full items-center justify-center gap-2 rounded-xl bg-ink font-display text-[12.5px] font-bold text-white shadow-xs transition-transform hover:opacity-95 active:scale-[0.99]"
          >
            <HandCoins className="h-4 w-4 text-betclic-red" strokeWidth={2.2} />
            <span>Vendre le coupon ·</span>
            <AnimatedNumber value={amount} format={eur} />
            {trend === "up" && (
              <span className="text-[10px] text-emerald-400" aria-hidden>
                ▲
              </span>
            )}
            {trend === "down" && (
              <span className="text-[10px] text-amber-300" aria-hidden>
                ▼
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
