"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  computeLiveClockSnapshot,
  isVirtualClockInput,
  subscribeLiveClock,
  type LiveClockSnapshot,
  type LiveClockSource,
} from "@/lib/live-clock";

/**
 * Retourne la chaîne du chronomètre live (`MM:SS`, `45+M:SS`, `MT` / `Mi-temps`)
 * synchronisée avec le serveur, sans provoquer de re-render tant que la seconde affichée
 * n'a pas changé.
 */
export function useLiveMatchClock(
  source: LiveClockSource | null | undefined,
  fallbackMinute?: string | null,
  variant: "compact" | "badge" = "compact"
): string {
  const isFast = isVirtualClockInput(source);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeLiveClock(isFast ? "fast" : "real", onStoreChange),
    [isFast]
  );

  const getSnapshot = () => {
    const snap = computeLiveClockSnapshot(source, fallbackMinute);
    return variant === "badge" ? snap.badgeLabel : snap.display;
  };

  const getServerSnapshot = () => {
    const raw = (source?.minute ?? fallbackMinute ?? "LIVE").trim() || "LIVE";
    if (
      variant === "badge" &&
      (raw.toUpperCase() === "MT" || raw.toUpperCase() === "HT")
    ) {
      return "Mi-temps";
    }
    return raw;
  };

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Retourne l'instantané complet (`display`, `isHalfTime`, `progressPct`, `gameMinute`)
 * mémoïsé par valeur pour la frise chronologique `0' → 90'` du `LiveMatchTracker`.
 */
export function useLiveMatchClockSnapshot(
  source: LiveClockSource | null | undefined,
  fallbackMinute?: string | null
): LiveClockSnapshot {
  const isFast = isVirtualClockInput(source);
  const cacheRef = useRef<LiveClockSnapshot | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeLiveClock(isFast ? "fast" : "real", onStoreChange),
    [isFast]
  );

  const getSnapshot = (): LiveClockSnapshot => {
    const next = computeLiveClockSnapshot(source, fallbackMinute);
    const roundedPct = Math.round(next.progressPct * 5) / 5;
    const prev = cacheRef.current;
    if (
      prev &&
      prev.display === next.display &&
      prev.badgeLabel === next.badgeLabel &&
      prev.isHalfTime === next.isHalfTime &&
      prev.isPaused === next.isPaused &&
      prev.gameMinute === next.gameMinute &&
      prev.progressPct === roundedPct
    ) {
      return prev;
    }
    const frozen: LiveClockSnapshot = {
      ...next,
      progressPct: roundedPct,
    };
    cacheRef.current = frozen;
    return frozen;
  };

  const getServerSnapshot = (): LiveClockSnapshot => {
    const raw = (source?.minute ?? fallbackMinute ?? "LIVE").trim() || "LIVE";
    const isHt = raw.toUpperCase() === "MT" || raw.toUpperCase() === "HT";
    const fallbackSnap: LiveClockSnapshot = {
      display: isHt ? "MT" : raw,
      badgeLabel: isHt ? "Mi-temps" : raw,
      isHalfTime: isHt,
      isPaused: true,
      progressPct: 50,
      gameMinute: 45,
    };
    const prev = cacheRef.current;
    if (prev && prev.display === fallbackSnap.display) return prev;
    cacheRef.current = fallbackSnap;
    return fallbackSnap;
  };

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function LiveMatchClock({
  match,
  fallback,
  variant = "compact",
  prefix,
  className,
}: {
  match?: LiveClockSource | null;
  fallback?: string | null;
  variant?: "compact" | "badge";
  prefix?: string;
  className?: string;
}) {
  const text = useLiveMatchClock(match, fallback, variant);
  return (
    <span className={className ?? "tabular-nums"}>
      {prefix ? `${prefix}${text}` : text}
    </span>
  );
}
