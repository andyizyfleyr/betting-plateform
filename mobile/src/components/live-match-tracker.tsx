import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";
import type { ClientMatch, ClientRealMatchStats } from "@/lib/api";
import { colors } from "@/theme/tokens";

/**
 * Terrain 2D SVG natif (`LiveMatchTracker`) pour les matchs virtuels EN DIRECT.
 */
export function LiveMatchTracker({ match }: { match: ClientMatch }) {
  const tel = match.telemetry;
  const ballX = Math.max(6, Math.min(94, tel?.ballX ?? 50));
  const ballY = Math.max(10, Math.min(90, tel?.ballY ?? 50));
  const possHome = tel?.possessionHome ?? 50;
  const possAway = tel?.possessionAway ?? 50;

  return (
    <View style={styles.wrap}>
      <View style={styles.pitchBox}>
        <Svg width="100%" height={116} viewBox="0 0 200 110">
          <Rect x="2" y="2" width="196" height="106" rx="8" fill="#14532d" stroke="#22c55e" strokeOpacity="0.35" strokeWidth="1.5" />
          <Line x1="100" y1="2" x2="100" y2="108" stroke="#bbf7d0" strokeOpacity="0.45" strokeWidth="1.2" />
          <Circle cx="100" cy="55" r="16" stroke="#bbf7d0" strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
          <Rect x="2" y="28" width="24" height="54" stroke="#bbf7d0" strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
          <Rect x="174" y="28" width="24" height="54" stroke="#bbf7d0" strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
          <Circle cx={ballX * 2} cy={(ballY / 100) * 110} r="7.5" fill="#fbbf24" fillOpacity="0.28" />
          <Circle cx={ballX * 2} cy={(ballY / 100) * 110} r="3.8" fill="#ffffff" stroke="#111827" strokeWidth="1" />
        </Svg>
        <View style={styles.commentaryBar}>
          <Text numberOfLines={1} style={styles.commentaryText}>
            {tel?.commentary ?? `${match.homeTeam} vs ${match.awayTeam} · En jeu`}
          </Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <StatMini label="Possession" left={`${possHome}%`} right={`${possAway}%`} />
        <StatMini
          label="Tirs (cadrés)"
          left={`${tel?.shotsHome ?? 0} (${tel?.shotsOnTargetHome ?? 0})`}
          right={`${tel?.shotsAway ?? 0} (${tel?.shotsOnTargetAway ?? 0})`}
        />
        <StatMini
          label="Corners · xG"
          left={`${tel?.cornersHome ?? 0} · ${(tel?.xgHome ?? 0).toFixed(1)}`}
          right={`${tel?.cornersAway ?? 0} · ${(tel?.xgAway ?? 0).toFixed(1)}`}
        />
      </View>
    </View>
  );
}

/**
 * Carte des statistiques officielles ESPN (`RealMatchStatsCard`) pour les matchs réels.
 */
export function RealMatchStatsCard({
  stats,
  homeTeam,
  awayTeam,
}: {
  stats?: ClientRealMatchStats | null;
  homeTeam: string;
  awayTeam: string;
}) {
  if (!stats) return null;
  const rows: Array<{ label: string; h: number | null | undefined; a: number | null | undefined; suffix?: string }> = [
    { label: "Possession", h: stats.possessionHome, a: stats.possessionAway, suffix: "%" },
    { label: "Tirs", h: stats.shotsHome, a: stats.shotsAway },
    { label: "Tirs cadrés", h: stats.shotsOnTargetHome, a: stats.shotsOnTargetAway },
    { label: "Corners", h: stats.cornersHome, a: stats.cornersAway },
    { label: "Fautes", h: stats.foulsHome, a: stats.foulsAway },
    { label: "Cartons jaunes", h: stats.yellowHome, a: stats.yellowAway },
  ].filter((r) => typeof r.h === "number" || typeof r.a === "number");

  if (rows.length === 0) return null;

  return (
    <View style={styles.realWrap}>
      <View style={styles.realHeader}>
        <Text numberOfLines={1} style={styles.realClub}>{homeTeam}</Text>
        <Text style={styles.realTitle}>Stats officielles</Text>
        <Text numberOfLines={1} style={[styles.realClub, { textAlign: "right" }]}>{awayTeam}</Text>
      </View>
      {rows.map((r) => {
        const hv = r.h ?? 0;
        const av = r.a ?? 0;
        const total = Math.max(1, hv + av);
        const hPct = Math.round((hv / total) * 100);
        return (
          <View key={r.label} style={styles.realRow}>
            <View style={styles.realTopLine}>
              <Text style={styles.realVal}>
                {hv}
                {r.suffix ?? ""}
              </Text>
              <Text style={styles.realMetric}>{r.label}</Text>
              <Text style={styles.realVal}>
                {av}
                {r.suffix ?? ""}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barHome, { width: `${hPct}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function StatMini({
  label,
  left,
  right,
}: {
  label: string;
  left: string;
  right: string;
}) {
  return (
    <View style={styles.statMini}>
      <Text style={styles.statMiniLabel}>{label}</Text>
      <Text style={styles.statMiniNums}>
        {left} · {right}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#0f172a",
    padding: 10,
    gap: 8,
  },
  pitchBox: {
    borderRadius: 10,
    overflow: "hidden",
  },
  commentaryBar: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  commentaryText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: "#f8fafc",
  },
  statsGrid: {
    flexDirection: "row",
    gap: 6,
  },
  statMini: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  statMiniLabel: {
    fontSize: 9.5,
    color: "#94a3b8",
    fontWeight: "600",
  },
  statMiniNums: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "800",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  realWrap: {
    borderRadius: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    padding: 12,
    gap: 9,
  },
  realHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  realClub: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "800",
    color: colors.ink,
  },
  realTitle: {
    fontSize: 10.5,
    fontWeight: "800",
    textTransform: "uppercase",
    color: colors.dim,
  },
  realRow: {
    gap: 4,
  },
  realTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  realVal: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  realMetric: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.mist,
  },
  barTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.elev,
    overflow: "hidden",
  },
  barHome: {
    height: "100%",
    backgroundColor: colors.betclicRed,
    borderRadius: 999,
  },
});
