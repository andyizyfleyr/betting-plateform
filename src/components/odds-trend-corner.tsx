"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

export type OddsTrend = "up" | "down" | null;

/**
 * Classe couleur de texte des cotes selon leur variation :
 * - Hausse : vert (`text-win`)
 * - Baisse : rouge (`text-betclic-red`)
 * - Stable : noir (`text-ink`)
 */
export function oddsTrendTextClass(trend: OddsTrend, active = false): string {
  if (active) {
    if (trend === "up") return "text-emerald-300";
    if (trend === "down") return "text-rose-200";
    return "text-white";
  }
  if (trend === "up") return "text-win";
  if (trend === "down") return "text-betclic-red";
  return "text-ink";
}

/**
 * Détecte toute variation visible d'une cote (>= 0,01 affichée) et maintient
 * la couleur directionnelle + micro-indicateur pendant quelques secondes avant
 * de revenir à l'état stable (noir).
 */
export function useOddsTrend(odds: number, durationMs = 4200): OddsTrend {
  const [trend, setTrend] = useState<OddsTrend>(null);
  const prevRef = useRef<number>(odds);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = odds;

    if (!Number.isFinite(odds) || !Number.isFinite(prev)) {
      return;
    }

    const centsNow = Math.round(odds * 100);
    const centsPrev = Math.round(prev * 100);
    if (centsNow === centsPrev) {
      return;
    }

    const dir: Exclude<OddsTrend, null> = centsNow > centsPrev ? "up" : "down";
    const micro = setTimeout(() => {
      setTrend(dir);
    }, 0);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setTrend(null);
    }, durationMs);

    return () => {
      clearTimeout(micro);
    };
  }, [odds, durationMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return trend;
}

/**
 * Minuscule triangle directionnel épinglé en coin supérieur droit d'un bouton de cote :
 * - ▲ vert quand la cote monte
 * - ▼ rouge quand la cote baisse
 */
export function OddsTrendCorner({
  trend,
  inverted = false,
  className,
}: {
  trend: OddsTrend;
  inverted?: boolean;
  className?: string;
}) {
  if (!trend) return null;
  const isUp = trend === "up";

  return (
    <span
      aria-label={isUp ? "Cote en hausse" : "Cote en baisse"}
      className={cn(
        "pointer-events-none absolute top-1 right-1 leading-none transition-opacity duration-200",
        isUp
          ? inverted
            ? "text-emerald-300"
            : "text-win"
          : inverted
            ? "text-rose-200"
            : "text-betclic-red",
        className
      )}
    >
      <svg
        viewBox="0 0 8 7"
        className="h-[6.5px] w-[7.5px] fill-current drop-shadow-[0_0.5px_0.5px_rgba(0,0,0,0.08)]"
        aria-hidden
      >
        {isUp ? (
          <polygon points="4,0 8,7 0,7" />
        ) : (
          <polygon points="0,0 8,0 4,7" />
        )}
      </svg>
    </span>
  );
}
