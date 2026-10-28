"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const THUMB_WIDTH = 46;
const TRACK_PAD = 5;
const CONFIRM_RELEASE_RATIO = 0.78;
const CONFIRM_SNAP_RATIO = 0.94;

/**
 * Contrôle « Vendre le coupon » (Cash Out temps réel) en vert émeraude créatif :
 * - Mobile (< lg) : glisser-confirmer fluide de gauche à droite (`touch-none` dédié
 *   pour garantir une réponse immédiate au doigt sur Android Chrome et iOS Safari,
 *   curseur blanc ancré en `absolute left-[5px]`, et double ligne lisible sans collision).
 * - Desktop (>= lg) : bouton vert émeraude harmonisé avec confirmation 1-clic.
 */
export function SlideToCashOut({
  amount,
  stake,
  loading,
  haptics = true,
  onConfirm,
}: SlideToCashOutProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const fingerLeadOffsetRef = useRef<number>(0);
  const dragPxRef = useRef<number>(0);
  const rightwardSwipeRef = useRef<number>(0);
  const maxTravelRef = useRef<number>(220);
  const crossedHalfRef = useRef(false);
  const crossedReadyRef = useRef(false);
  const triggeredRef = useRef(false);

  const [dragPx, setDragPx] = useState(0);
  const [maxTravel, setMaxTravel] = useState(220);
  const [dragging, setDragging] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [desktopConfirm, setDesktopConfirm] = useState(false);

  const trend = useOddsTrend(amount, 4200);
  const profit = Math.round((amount - stake) * 100) / 100;
  const inProfit = profit >= 0.01;

  const measureTrack = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return maxTravelRef.current;
    const next = Math.max(80, track.clientWidth - THUMB_WIDTH - TRACK_PAD * 2);
    maxTravelRef.current = next;
    setMaxTravel(next);
    return next;
  }, []);

  useEffect(() => {
    measureTrack();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      measureTrack();
    });
    ro.observe(track);
    return () => ro.disconnect();
  }, [measureTrack]);

  const executeCashOut = useCallback(() => {
    if (triggeredRef.current || loading) return;
    triggeredRef.current = true;
    activePointerIdRef.current = null;
    startXRef.current = null;
    setDragging(false);
    const full = maxTravelRef.current;
    dragPxRef.current = full;
    setDragPx(full);
    triggerHaptic(haptics, [18, 28, 40]);

    void Promise.resolve(onConfirm()).finally(() => {
      triggeredRef.current = false;
      dragPxRef.current = 0;
      setDragPx(0);
    });
  }, [haptics, loading, onConfirm]);

  const triggerNudgeHint = useCallback(() => {
    if (loading) return;
    triggerHaptic(haptics, 6);
    setNudge(true);
    window.setTimeout(() => setNudge(false), 320);
  }, [haptics, loading]);

  const beginSlideAt = useCallback(
    (clientX: number): boolean => {
      if (loading || triggeredRef.current) return false;
      const track = trackRef.current;
      if (!track) return false;

      const travel = measureTrack();
      const rect = track.getBoundingClientRect();
      const localX = clientX - rect.left;

      // Zone droite (montant) : affiche l'indice visuel sans déclencher par erreur
      if (localX > rect.width * 0.72 && travel > 0) {
        triggerNudgeHint();
        return false;
      }

      startXRef.current = clientX;
      fingerLeadOffsetRef.current = Math.max(
        0,
        Math.min(travel * 0.42, localX - (TRACK_PAD + THUMB_WIDTH / 2))
      );
      dragPxRef.current = 0;
      rightwardSwipeRef.current = 0;
      crossedHalfRef.current = false;
      crossedReadyRef.current = false;
      setNudge(false);
      setDragging(true);
      setDragPx(0);
      triggerHaptic(haptics, 6);
      return true;
    },
    [haptics, loading, measureTrack, triggerNudgeHint]
  );

  const updateSlideAt = useCallback(
    (clientX: number) => {
      if (startXRef.current === null || loading || triggeredRef.current) return;

      const travel = maxTravelRef.current;
      const minRequiredSwipe = Math.max(76, travel * 0.46);
      const fingerDelta = clientX - startXRef.current;
      if (fingerDelta > rightwardSwipeRef.current) {
        rightwardSwipeRef.current = fingerDelta;
      }

      // Tant que le doigt n'a pas glissé de >= 6px, reste à 0 (évite tout saut sur un simple tap)
      const leadScale = Math.min(1, Math.max(0, (fingerDelta - 4) / 24));
      const rawDx = fingerDelta + fingerLeadOffsetRef.current * leadScale;
      const clamped = Math.max(0, Math.min(travel, rawDx));

      dragPxRef.current = clamped;
      setDragPx(clamped);

      const ratio = travel > 0 ? clamped / travel : 0;
      const enoughSwipe = fingerDelta >= minRequiredSwipe;

      if (ratio >= 0.5 && !crossedHalfRef.current) {
        crossedHalfRef.current = true;
        triggerHaptic(haptics, 8);
      }
      if (ratio >= CONFIRM_RELEASE_RATIO && enoughSwipe && !crossedReadyRef.current) {
        crossedReadyRef.current = true;
        triggerHaptic(haptics, 12);
      } else if ((ratio < CONFIRM_RELEASE_RATIO || !enoughSwipe) && crossedReadyRef.current) {
        crossedReadyRef.current = false;
      }

      if (ratio >= CONFIRM_SNAP_RATIO && enoughSwipe) {
        executeCashOut();
      }
    },
    [executeCashOut, haptics, loading]
  );

  const endSlide = useCallback(
    (cancelled: boolean) => {
      if (startXRef.current === null && !dragging) return;

      const finalDx = dragPxRef.current;
      const maxRightSwipe = rightwardSwipeRef.current;
      const travel = maxTravelRef.current;
      const minRequiredSwipe = Math.max(76, travel * 0.46);
      const ratio = travel > 0 ? finalDx / travel : 0;

      activePointerIdRef.current = null;
      startXRef.current = null;
      setDragging(false);

      if (
        !cancelled &&
        ratio >= CONFIRM_RELEASE_RATIO &&
        maxRightSwipe >= minRequiredSwipe &&
        !loading
      ) {
        executeCashOut();
        return;
      }

      dragPxRef.current = 0;
      setDragPx(0);

      if (!cancelled && maxRightSwipe < 6) {
        triggerNudgeHint();
      }
    },
    [dragging, executeCashOut, loading, triggerNudgeHint]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!beginSlideAt(e.clientX)) return;
    activePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    updateSlideAt(e.clientX);
  };

  const handlePointerFinish = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    endSlide(cancelled);
  };

  const progress =
    maxTravel > 0 ? Math.min(1, Math.max(0, dragPx / maxTravel)) : 0;
  const readyToConfirm = progress >= CONFIRM_RELEASE_RATIO;
  const thumbOffsetPx = loading ? maxTravel : nudge ? 14 : dragPx;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      className="w-full"
    >
      {/* ── MOBILE (< lg) : Glisser pour vendre en vert émeraude créatif ── */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => handlePointerFinish(e, false)}
        onPointerCancel={(e) => handlePointerFinish(e, true)}
        onTouchStart={(e) => {
          e.stopPropagation();
          if (typeof window !== "undefined" && "PointerEvent" in window) return;
          const t = e.touches[0];
          if (t) beginSlideAt(t.clientX);
        }}
        onTouchMove={(e) => {
          e.stopPropagation();
          if (typeof window !== "undefined" && "PointerEvent" in window) return;
          const t = e.touches[0];
          if (t) updateSlideAt(t.clientX);
        }}
        onTouchEnd={() => {
          if (typeof window !== "undefined" && "PointerEvent" in window) return;
          endSlide(false);
        }}
        onTouchCancel={() => {
          if (typeof window !== "undefined" && "PointerEvent" in window) return;
          endSlide(true);
        }}
        className={cn(
          "relative flex h-[54px] w-full cursor-grab touch-none items-center overflow-hidden rounded-2xl p-[5px] text-white select-none active:cursor-grabbing lg:hidden",
          "bg-gradient-to-r from-[#047857] via-[#059669] to-[#10b981]",
          "shadow-[0_8px_20px_-6px_rgba(5,150,105,0.52)] ring-1 ring-inset ring-white/25"
        )}
      >
        {/* Reflet lumineux supérieur subtil */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/14 to-transparent"
        />

        {/* Jauge lumineuse qui accompagne le doigt */}
        <div
          aria-hidden
          style={{
            width: loading
              ? "100%"
              : `${Math.min(
                  100,
                  Math.max(
                    0,
                    ((thumbOffsetPx + THUMB_WIDTH + TRACK_PAD) /
                      Math.max(1, maxTravel + THUMB_WIDTH + TRACK_PAD * 2)) *
                      100
                  )
                )}%`,
          }}
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 bg-white/20",
            !dragging && "transition-all duration-200 ease-out"
          )}
        />

        {/* Curseur tactile blanc ancré à GAUCHE (`absolute left-[5px]`) */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`Glisser vers la droite pour vendre le coupon à ${eur(amount)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !loading) {
              e.preventDefault();
              executeCashOut();
            }
          }}
          style={{
            transform: `translate3d(${thumbOffsetPx}px, 0, 0)`,
          }}
          className={cn(
            "pointer-events-none absolute top-[5px] bottom-[5px] left-[5px] z-20 grid w-[46px] place-items-center rounded-xl bg-white text-[#047857] shadow-[0_3px_10px_rgba(0,0,0,0.2)]",
            dragging && "scale-[1.03]",
            !dragging && "transition-transform duration-200 ease-out"
          )}
        >
          {loading ? (
            <Loader2 className="h-4.5 w-4.5 animate-spin text-[#059669]" strokeWidth={2.6} />
          ) : readyToConfirm ? (
            <Check className="h-4.5 w-4.5 text-[#047857]" strokeWidth={3} />
          ) : (
            <ChevronsRight className="h-5 w-5 text-[#047857]" strokeWidth={2.7} />
          )}
        </div>

        {/* Contenu disposé proprement en 2 colonnes équilibrées (zéro chevauchement) */}
        <div
          style={{
            opacity: loading ? 1 : Math.max(0.25, 1 - progress * 0.65),
          }}
          className="pointer-events-none relative z-10 flex w-full items-center justify-between gap-2 pr-3 pl-[56px]"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[11px] font-medium leading-tight tracking-tight text-white">
              {loading
                ? "Vente en cours…"
                : readyToConfirm
                  ? "Relâchez pour vendre !"
                  : "Vendre le coupon"}
            </p>
            <p className="mt-0.5 truncate text-[9.5px] font-medium leading-tight text-emerald-50/90">
              {loading
                ? "Crédit immédiat sur le solde"
                : nudge
                  ? "Faites glisser le bouton blanc →"
                  : "Glisser vers la droite →"}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end justify-center text-right">
            <span className="inline-flex items-center gap-1 font-display text-[12px] font-medium leading-tight tabular-nums text-white">
              {trend === "up" && (
                <span className="text-[9.5px] leading-none text-emerald-100" aria-hidden>
                  ▲
                </span>
              )}
              {trend === "down" && (
                <span className="text-[9.5px] leading-none text-amber-200" aria-hidden>
                  ▼
                </span>
              )}
              <AnimatedNumber value={amount} format={eur} />
            </span>

            {inProfit && (
              <span className="mt-0.5 rounded-full bg-white/22 px-1.5 py-[1px] font-display text-[9.5px] font-medium leading-tight tabular-nums text-white">
                +{eur(profit)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── DESKTOP (>= lg) : Bouton vert émeraude créatif + confirmation 1-clic ── */}
      <div className="hidden lg:block">
        {desktopConfirm ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-500/35 bg-emerald-500/[0.08] p-2">
            <div className="min-w-0 pl-1.5">
              <p className="truncate font-display text-[10.5px] font-medium text-ink">
                Confirmer la vente à <AnimatedNumber value={amount} format={eur} /> ?
              </p>
              {inProfit && (
                <p className="text-[10px] font-medium text-[#047857]">
                  Gain net sécurisé : +{eur(profit)}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  void Promise.resolve(onConfirm()).finally(() =>
                    setDesktopConfirm(false)
                  );
                }}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#047857] to-[#10b981] px-3.5 font-display text-[10.5px] font-medium text-white shadow-xs transition hover:brightness-105 disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.8} />
                )}
                Vendre
              </button>
              <button
                type="button"
                onClick={() => setDesktopConfirm(false)}
                className="grid h-9 w-9 place-items-center rounded-xl border border-edge bg-white text-mist transition hover:text-ink"
                aria-label="Annuler"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDesktopConfirm(true)}
            className={cn(
              "group flex h-12 w-full items-center justify-between gap-3 rounded-2xl px-3.5 text-white transition-all",
              "bg-gradient-to-r from-[#047857] via-[#059669] to-[#10b981]",
              "shadow-[0_6px_16px_-6px_rgba(5,150,105,0.5)] ring-1 ring-inset ring-white/25 hover:brightness-105 active:scale-[0.99]"
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-xl bg-white text-[#047857] shadow-2xs transition-transform group-hover:scale-105">
                <HandCoins className="h-4 w-4" strokeWidth={2.3} />
              </span>
              <span className="min-w-0 text-left">
                <span className="block truncate font-display text-[11px] font-medium leading-tight">
                  Vendre le coupon
                </span>
                <span className="block truncate text-[9.5px] font-medium leading-tight text-emerald-50/90">
                  Encaissement immédiat
                </span>
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-1.5">
              {inProfit && (
                <span className="rounded-full bg-white/22 px-2 py-0.5 font-display text-[9.5px] font-medium tabular-nums text-white">
                  +{eur(profit)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 font-display text-[12px] font-medium tabular-nums text-white">
                {trend === "up" && (
                  <span className="text-[9.5px] text-emerald-100" aria-hidden>
                    ▲
                  </span>
                )}
                {trend === "down" && (
                  <span className="text-[9.5px] text-amber-200" aria-hidden>
                    ▼
                  </span>
                )}
                <AnimatedNumber value={amount} format={eur} />
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
