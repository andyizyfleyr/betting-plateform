import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { colors } from "@/theme/tokens";

export type OddsTrend = "up" | "down" | "flat";

/**
 * Détecte en temps réel les hausses (vert `#15803d`), baisses (rouge `#e10014`)
 * et stabilités (noir `#111827`) de cotes pendant 4,5 secondes.
 */
export function useOddsTrend(odds: number): OddsTrend {
  const prevRef = useRef<number>(odds);
  const [trend, setTrend] = useState<OddsTrend>("flat");

  useEffect(() => {
    const prev = prevRef.current;
    if (Math.abs(odds - prev) >= 0.009) {
      const next: OddsTrend = odds > prev ? "up" : "down";
      prevRef.current = odds;
      setTrend(next);
      const t = setTimeout(() => setTrend("flat"), 4_500);
      return () => clearTimeout(t);
    }
    prevRef.current = odds;
    return undefined;
  }, [odds]);

  return trend;
}

export function oddsTextColor(trend: OddsTrend, selected = false): string {
  if (selected) return colors.white;
  if (trend === "up") return colors.win;
  if (trend === "down") return colors.betclicRed;
  return colors.ink;
}

export function OddsTrendCorner({
  trend,
  selected = false,
}: {
  trend: OddsTrend;
  selected?: boolean;
}) {
  if (trend === "flat") return null;

  const fill = selected
    ? "rgba(255,255,255,0.9)"
    : trend === "up"
      ? "#16a34a"
      : colors.betclicRed;

  return (
    <View
      pointerEvents="none"
      style={trend === "up" ? styles.topRight : styles.bottomRight}
    >
      <Svg width={9} height={9} viewBox="0 0 9 9">
        {trend === "up" ? (
          <Polygon points="0,0 9,0 9,9" fill={fill} />
        ) : (
          <Polygon points="9,0 9,9 0,9" fill={fill} />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  topRight: {
    position: "absolute",
    top: 2,
    right: 2,
  },
  bottomRight: {
    position: "absolute",
    bottom: 2,
    right: 2,
  },
});
