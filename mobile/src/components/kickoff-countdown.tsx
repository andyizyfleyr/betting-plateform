import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Clock } from "@/components/icons";
import { formatKickoff } from "@/lib/format";
import { colors } from "@/theme/tokens";

export function KickoffCountdown({ startsAt }: { startsAt: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const diff = new Date(startsAt).getTime() - Date.now();
    if (diff > 20 * 60_000) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [startsAt]);

  const diffMs = new Date(startsAt).getTime() - Date.now();
  const isSoon = diffMs <= 3 * 60_000 && diffMs > -30_000;

  let label = formatKickoff(startsAt);
  if (diffMs > 0 && diffMs <= 180_000) {
    const totalSecs = Math.max(0, Math.ceil(diffMs / 1000));
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    label = m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
  }

  return (
    <View style={[styles.badge, isSoon && styles.badgeSoon]}>
      <Clock
        size={10.5}
        color={isSoon ? colors.betclicRed : colors.mist}
        strokeWidth={2.4}
      />
      <Text style={[styles.text, isSoon && styles.textSoon]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.elev,
  },
  badgeSoon: {
    backgroundColor: "rgba(225, 0, 20, 0.10)",
  },
  text: {
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  textSoon: {
    color: colors.betclicRed,
  },
});
