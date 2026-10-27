import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { COLORS } from "@/theme/tokens";

export type OddsTrend = "up" | "down" | null;

export function oddsTrendTextColor(trend: OddsTrend, active = false): string {
  if (active) {
    if (trend === "up") return "#6ee7b7";
    if (trend === "down") return "#fecdd3";
    return "#ffffff";
  }
  if (trend === "up") return COLORS.win;
  if (trend === "down") return COLORS.betclicRed;
  return COLORS.ink;
}

export function useOddsTrend(odds: number, durationMs = 4200): OddsTrend {
  const [trend, setTrend] = useState<OddsTrend>(null);
  const prevRef = useRef<number>(odds);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = odds;
    if (!Number.isFinite(odds) || !Number.isFinite(prev)) return;
    const centsNow = Math.round(odds * 100);
    const centsPrev = Math.round(prev * 100);
    if (centsNow === centsPrev) return;

    const dir: Exclude<OddsTrend, null> = centsNow > centsPrev ? "up" : "down";
    setTrend(dir);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setTrend(null);
    }, durationMs);
  }, [odds, durationMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return trend;
}

export function OddsTrendCorner({
  trend,
  inverted = false,
}: {
  trend: OddsTrend;
  inverted?: boolean;
}) {
  if (!trend) return null;
  const isUp = trend === "up";
  const fill = isUp
    ? inverted
      ? "#6ee7b7"
      : COLORS.win
    : inverted
      ? "#fda4af"
      : COLORS.betclicRed;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Svg width={9} height={9} viewBox="0 0 10 10">
        {isUp ? (
          <Path d="M5 1.5 L9 8.5 L1 8.5 Z" fill={fill} />
        ) : (
          <Path d="M1 1.5 L9 1.5 L5 8.5 Z" fill={fill} />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 3.5,
    right: 4,
  },
});
