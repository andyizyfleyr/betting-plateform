import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarChart3 } from "lucide-react-native";
import type { ClientRealMatchStats } from "@/lib/api";
import { COLORS } from "@/theme/tokens";
import { TeamAvatar } from "./team-avatar";

export function hasAnyRealStats(stats?: ClientRealMatchStats | null): boolean {
  if (!stats) return false;
  return (
    stats.possessionHome != null ||
    stats.shotsTotalHome != null ||
    stats.shotsOnTargetHome != null ||
    stats.cornersHome != null ||
    stats.foulsHome != null ||
    stats.savesHome != null ||
    stats.offsidesHome != null ||
    stats.yellowCardsHome != null
  );
}

export interface StatLine {
  key: string;
  label: string;
  left: string;
  right: string;
  leftShare: number;
}

function ratioShare(a: number, b: number): number {
  const sum = a + b;
  if (sum <= 0) return 50;
  return Math.round((a / sum) * 100);
}

export function buildRealStatLines(
  stats?: ClientRealMatchStats | null
): StatLine[] {
  if (!stats) return [];
  const rows: StatLine[] = [];

  if (stats.possessionHome != null && stats.possessionAway != null) {
    rows.push({
      key: "possession",
      label: "Possession (%)",
      left: `${Math.round(stats.possessionHome)}%`,
      right: `${Math.round(stats.possessionAway)}%`,
      leftShare: ratioShare(stats.possessionHome, stats.possessionAway),
    });
  }
  if (stats.shotsOnTargetHome != null && stats.shotsOnTargetAway != null) {
    rows.push({
      key: "sot",
      label: "Tirs cadrés",
      left: String(stats.shotsOnTargetHome),
      right: String(stats.shotsOnTargetAway),
      leftShare: ratioShare(stats.shotsOnTargetHome, stats.shotsOnTargetAway),
    });
  }
  if (stats.shotsTotalHome != null && stats.shotsTotalAway != null) {
    rows.push({
      key: "shots",
      label: "Tirs totaux",
      left: String(stats.shotsTotalHome),
      right: String(stats.shotsTotalAway),
      leftShare: ratioShare(stats.shotsTotalHome, stats.shotsTotalAway),
    });
  }
  if (stats.cornersHome != null && stats.cornersAway != null) {
    rows.push({
      key: "corners",
      label: "Corners",
      left: String(stats.cornersHome),
      right: String(stats.cornersAway),
      leftShare: ratioShare(stats.cornersHome, stats.cornersAway),
    });
  }
  if (stats.foulsHome != null && stats.foulsAway != null) {
    rows.push({
      key: "fouls",
      label: "Fautes",
      left: String(stats.foulsHome),
      right: String(stats.foulsAway),
      leftShare: ratioShare(stats.foulsHome, stats.foulsAway),
    });
  }
  if (stats.savesHome != null && stats.savesAway != null) {
    rows.push({
      key: "saves",
      label: "Arrêts du gardien",
      left: String(stats.savesHome),
      right: String(stats.savesAway),
      leftShare: ratioShare(stats.savesHome, stats.savesAway),
    });
  }
  if (stats.offsidesHome != null && stats.offsidesAway != null) {
    rows.push({
      key: "offsides",
      label: "Hors-jeu",
      left: String(stats.offsidesHome),
      right: String(stats.offsidesAway),
      leftShare: ratioShare(stats.offsidesHome, stats.offsidesAway),
    });
  }
  if (stats.yellowCardsHome != null && stats.yellowCardsAway != null) {
    rows.push({
      key: "yellow",
      label: "Cartons jaunes",
      left: String(stats.yellowCardsHome),
      right: String(stats.yellowCardsAway),
      leftShare: ratioShare(stats.yellowCardsHome, stats.yellowCardsAway),
    });
  }

  return rows;
}

export function RealMatchStatsCard({
  stats,
  homeTeam,
  awayTeam,
  homeLogo,
  awayLogo,
  htHomeScore,
  htAwayScore,
  compact = false,
}: {
  stats?: ClientRealMatchStats | null;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  compact?: boolean;
}) {
  const lines = buildRealStatLines(stats);
  const visibleLines = compact ? lines.slice(0, 5) : lines;
  const effHtH = htHomeScore ?? stats?.htHomeScore ?? null;
  const effHtA = htAwayScore ?? stats?.htAwayScore ?? null;

  if (visibleLines.length === 0 && (effHtH == null || effHtA == null)) {
    return null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.headLeft}>
          <BarChart3 size={14} color="#047857" strokeWidth={2.3} />
          <Text style={styles.headTitle}>Statistiques officielles</Text>
        </View>
        {effHtH != null && effHtA != null ? (
          <View style={styles.htBadge}>
            <Text style={styles.htText}>
              MT {effHtH} - {effHtA}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.teamsRow}>
        <View style={styles.teamSide}>
          <TeamAvatar name={homeTeam} logo={homeLogo} size="2xs" />
          <Text numberOfLines={1} style={styles.teamName}>
            {homeTeam}
          </Text>
        </View>
        <View style={[styles.teamSide, styles.teamSideRight]}>
          <Text numberOfLines={1} style={styles.teamName}>
            {awayTeam}
          </Text>
          <TeamAvatar name={awayTeam} logo={awayLogo} size="2xs" />
        </View>
      </View>

      <View style={styles.list}>
        {visibleLines.map((row) => (
          <View key={row.key} style={styles.rowWrap}>
            <View style={styles.rowText}>
              <Text style={styles.val}>{row.left}</Text>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.val}>{row.right}</Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barHome,
                  { width: `${Math.max(6, Math.min(94, row.leftShare))}%` },
                ]}
              />
              <View style={styles.barAway} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(5, 150, 105, 0.20)",
    backgroundColor: "#ffffff",
    padding: 12,
  },
  headRow: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headTitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "#047857",
  },
  htBadge: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  htText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  teamsRow: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamSide: {
    flex: 1,
    maxWidth: "46%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  teamSideRight: {
    justifyContent: "flex-end",
  },
  teamName: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  list: {
    gap: 8,
  },
  rowWrap: {
    gap: 4,
  },
  rowText: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  val: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  barTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    flexDirection: "row",
    overflow: "hidden",
  },
  barHome: {
    height: "100%",
    backgroundColor: "#059669",
  },
  barAway: {
    flex: 1,
    height: "100%",
    backgroundColor: "rgba(17, 24, 39, 0.20)",
  },
});
