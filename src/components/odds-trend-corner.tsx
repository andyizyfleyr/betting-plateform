"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

export type OddsTrend = "up" | "down" | null;

/**
 * Détecte toute variation réelle d'une cote (>= 0,015) et maintient
 * un micro-indicateur directionnel pendant quelques secondes sans faire
 * clignoter toute la carte.
 */
export function useOddsTrend(odds: number, durationMs = 4200): OddsTrend {
  const [trend, setTrend] = useState<OddsTrend>(null);
  const prevRef = useRef<number>(odds);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    const delta = odds - prev;
    prevRef.current = odds;

    if (!Number.isFinite(odds) || !Number.isFinite(prev) || Math.abs(delta) < 0.015) {
      return;
    }

    const dir: Exclude<OddsTrend, null> = delta > 0 ? "up" : "down";
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
 * - ▲ vert émeraude quand la cote monte
 * - ▼ rouge 1xBet quand la cote baisse
 * Zéro décalage de mise en page, zéro flash agressif sur la carte entière.
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
            ? "text-amber-300"
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
