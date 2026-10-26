"use client";

import { useRef, useState, type ReactNode } from "react";
import { RefreshCw, WifiOff, Zap } from "lucide-react";
import { triggerHaptic } from "@/lib/feedback";
import { useNetworkQuality } from "@/lib/network-saver";
import { cn } from "@/lib/format";

const PULL_THRESHOLD = 52;
const MAX_PULL = 76;

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  haptics?: boolean;
  children: ReactNode;
}

/**
 * Conteneur « Tirer pour actualiser » (Pull-to-Refresh) natif sur mobile :
 * - Ne s'active que tout en haut de la page (`window.scrollY <= 2`) et sur un geste vertical franc
 *   (n'interfère jamais avec les carrousels horizontaux ni avec le défilement normal).
 * - Affiche discrètement l'état hors-ligne ou économie de données 3G lors du geste.
 */
export function PullToRefresh({
  onRefresh,
  haptics = true,
  children,
}: PullToRefreshProps) {
  const { isOffline, isConstrained } = useNetworkQuality();
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pullingRef = useRef(false);
  const armedRef = useRef(false);

  const [pullPx, setPullPx] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (refreshing || typeof window === "undefined") return;
    if (window.scrollY > 2) {
      startRef.current = null;
      return;
    }
    const t = e.touches[0];
    if (!t) return;
    startRef.current = { x: t.clientX, y: t.clientY };
    pullingRef.current = false;
    armedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!startRef.current || refreshing || typeof window === "undefined") return;
    if (window.scrollY > 2) {
      startRef.current = null;
      if (pullingRef.current) {
        pullingRef.current = false;
        setIsPulling(false);
      }
      if (pullPx !== 0) setPullPx(0);
      return;
    }
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;

    if (!pullingRef.current) {
      // Si geste latéral (carrousel hero ou matchs), on abandonne immédiatement
      if (Math.abs(dx) > 10 && Math.abs(dx) >= dy) {
        startRef.current = null;
        return;
      }
      if (dy > 10 && dy > Math.abs(dx) * 1.35) {
        pullingRef.current = true;
        setIsPulling(true);
      } else {
        return;
      }
    }

    if (dy <= 0) {
      setPullPx(0);
      return;
    }

    const damped = Math.min(MAX_PULL, Math.round(Math.pow(dy, 0.84) * 1.35));
    setPullPx(damped);

    if (damped >= PULL_THRESHOLD && !armedRef.current) {
      armedRef.current = true;
      triggerHaptic(haptics, 10);
    } else if (damped < PULL_THRESHOLD && armedRef.current) {
      armedRef.current = false;
    }
  };

  const handleTouchEnd = () => {
    startRef.current = null;
    if (pullingRef.current) {
      pullingRef.current = false;
      setIsPulling(false);
    }

    if (refreshing) return;

    if (pullPx >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullPx(44);
      triggerHaptic(haptics, [12, 20]);
      void Promise.resolve(onRefresh()).finally(() => {
        setTimeout(() => {
          setRefreshing(false);
          setPullPx(0);
          armedRef.current = false;
        }, 220);
      });
    } else {
      setPullPx(0);
      armedRef.current = false;
    }
  };

  const progress = Math.min(1, pullPx / PULL_THRESHOLD);
  const showIndicator = pullPx > 4 || refreshing;

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="relative"
    >
      {/* Bandeau ultra-léger uniquement si hors-ligne */}
      {isOffline && (
        <div className="mb-2 flex items-center justify-center gap-1.5 rounded-xl bg-amber-500/12 px-3 py-1.5 text-[11.5px] font-semibold text-amber-800 lg:hidden">
          <WifiOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
          <span>Connexion interrompue · Actualisation dès le retour du réseau</span>
        </div>
      )}

      {/* Indicateur élastique Pull-to-Refresh */}
      <div
        aria-live="polite"
        style={{
          height: showIndicator ? `${pullPx}px` : "0px",
          opacity: showIndicator ? Math.min(1, Math.max(0.25, progress)) : 0,
        }}
        className={cn(
          "pointer-events-none flex items-center justify-center overflow-hidden lg:hidden",
          !isPulling && "transition-all duration-200"
        )}
      >
        <div className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-white px-3 py-1 shadow-xs">
          <RefreshCw
            style={{
              transform: refreshing ? undefined : `rotate(${Math.round(progress * 260)}deg)`,
            }}
            className={cn(
              "h-3.5 w-3.5 text-betclic-red",
              refreshing && "animate-spin"
            )}
            strokeWidth={2.5}
          />
          <span className="font-display text-[11px] font-bold text-ink">
            {refreshing
              ? "Actualisation…"
              : progress >= 1
                ? "Relâcher pour actualiser"
                : "Tirer pour actualiser"}
          </span>
          {isConstrained && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-elev px-1.5 py-0.5 font-display text-[9.5px] font-bold text-mist">
              <Zap className="h-2.5 w-2.5 text-amber-600" strokeWidth={2.4} />
              Éco 3G
            </span>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
