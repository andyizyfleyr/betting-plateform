import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Clock } from "lucide-react-native";
import { COLORS } from "@/theme/tokens";

const DAYS_SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function KickoffCountdown({ startsAt }: { startsAt: string }) {
  const target = new Date(startsAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const diff = target - now;
  const underFiveMin = Number.isFinite(target) && diff > 0 && diff < 300_000;
  const underOneHour = Number.isFinite(target) && diff > 0 && diff < 3_600_000;

  useEffect(() => {
    const interval = underFiveMin ? 5_000 : underOneHour ? 15_000 : 30_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [underFiveMin, underOneHour]);

  if (!Number.isFinite(target) || diff <= 12_000) {
    return (
      <View style={styles.urgentPill}>
        <View style={styles.urgentDot} />
        <Text style={styles.urgentText}>Imminent</Text>
      </View>
    );
  }

  if (diff < 60_000) {
    const secs = Math.max(15, Math.ceil(diff / 5_000) * 5);
    return (
      <View style={styles.urgentPill}>
        <View style={styles.urgentDot} />
        <Text style={styles.urgentText}>dans {secs} s</Text>
      </View>
    );
  }

  if (underOneHour) {
    const mins = Math.max(1, Math.round(diff / 60_000));
    return (
      <View style={styles.soonPill}>
        <Clock size={12} color={COLORS.dim} strokeWidth={2.2} />
        <Text style={styles.soonText}>dans {mins} min</Text>
      </View>
    );
  }

  const kickoffDate = new Date(target);
  const nowDate = new Date(now);
  const sameDay =
    kickoffDate.getFullYear() === nowDate.getFullYear() &&
    kickoffDate.getMonth() === nowDate.getMonth() &&
    kickoffDate.getDate() === nowDate.getDate();

  const tomorrowDate = new Date(nowDate);
  tomorrowDate.setDate(nowDate.getDate() + 1);
  const isTomorrow =
    kickoffDate.getFullYear() === tomorrowDate.getFullYear() &&
    kickoffDate.getMonth() === tomorrowDate.getMonth() &&
    kickoffDate.getDate() === tomorrowDate.getDate();

  const timeStr = `${pad2(kickoffDate.getHours())}:${pad2(kickoffDate.getMinutes())}`;
  const label = sameDay
    ? `Auj. ${timeStr}`
    : isTomorrow
      ? `Demain ${timeStr}`
      : `${DAYS_SHORT[kickoffDate.getDay()]} ${kickoffDate.getDate()} · ${timeStr}`;

  return (
    <View style={styles.datePill}>
      <Clock size={12} color={COLORS.dim} strokeWidth={2.2} />
      <Text style={styles.soonText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  urgentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    flexShrink: 0,
  },
  urgentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
  },
  urgentText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  soonPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    flexShrink: 0,
  },
  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    flexShrink: 0,
  },
  soonText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
});
