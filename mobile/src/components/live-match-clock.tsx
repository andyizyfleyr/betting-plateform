import React, { useCallback, useRef, useSyncExternalStore } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  computeLiveClockSnapshot,
  isVirtualClockInput,
  subscribeLiveClock,
  type LiveClockSnapshot,
  type LiveClockSource,
} from "@/lib/live-clock";

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

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

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

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function LiveMatchClock({
  match,
  fallback,
  variant = "compact",
  prefix,
  style,
}: {
  match?: LiveClockSource | null;
  fallback?: string | null;
  variant?: "compact" | "badge";
  prefix?: string;
  style?: StyleProp<TextStyle>;
}) {
  const text = useLiveMatchClock(match, fallback, variant);
  return (
    <Text style={[{ fontVariant: ["tabular-nums"] }, style]}>
      {prefix ? `${prefix}${text}` : text}
    </Text>
  );
}
