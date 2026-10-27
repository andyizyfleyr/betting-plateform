import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarChart3 } from "lucide-react-native";
import type { ClientRealMatchStats } from "@/lib/api";
import { COLORS } from "@/theme/tokens";

function Row({
  label,
  home,
  away,
  suffix = "",
}: {
  label: string;
  home: number | null | undefined;
  away: number | null | undefined;
  suffix?: string;
}) {
  if (home === null || home === undefined || away === null || away === undefined) {
    return null;
  }
  const total = home + away;
  const homePct = total > 0 ? Math.round((home / total) * 100) : 50;

  return (
    <View style={styles.rowWrap}>
      <View style={styles.textLine}>
        <Text style={styles.val}>
          {home}
          {suffix}
        </Text>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.val}>
          {away}
          {suffix}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barHome, { width: `${homePct}%` }]} />
      </View>
    </View>
  );
}

export function RealMatchStatsCard({
  stats,
}: {
  stats?: ClientRealMatchStats | null;
}) {
  if (!stats) return null;

  const hasAny =
    stats.possessionHome !== null ||
    stats.shotsTotalHome !== null ||
    stats.cornersHome !== null ||
    stats.foulsHome !== null;

  if (!hasAny) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <BarChart3 size={15} color={COLORS.betclicRed} strokeWidth={2.3} />
        <Text style={styles.title}>Statistiques officielles</Text>
        {stats.htHomeScore !== null && stats.htAwayScore !== null ? (
          <View style={styles.htBadge}>
            <Text style={styles.htText}>
              MT {stats.htHomeScore} - {stats.htAwayScore}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.list}>
        <Row
          label="Possession"
          home={stats.possessionHome}
          away={stats.possessionAway}
          suffix=" %"
        />
        <Row
          label="Tirs totaux"
          home={stats.shotsTotalHome}
          away={stats.shotsTotalAway}
        />
        <Row
          label="Tirs cadrés"
          home={stats.shotsOnTargetHome}
          away={stats.shotsOnTargetAway}
        />
        <Row
          label="Corners"
          home={stats.cornersHome}
          away={stats.cornersAway}
        />
        <Row label="Fautes" home={stats.foulsHome} away={stats.foulsAway} />
        <Row
          label="Cartons jaunes"
          home={stats.yellowCardsHome}
          away={stats.yellowCardsAway}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 14,
    gap: 11,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  title: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    flex: 1,
  },
  htBadge: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  htText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
  list: {
    gap: 9,
  },
  rowWrap: {
    gap: 4,
  },
  textLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  val: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.outerSpace,
    overflow: "hidden",
  },
  barHome: {
    height: "100%",
    backgroundColor: COLORS.betclicRed,
  },
});
