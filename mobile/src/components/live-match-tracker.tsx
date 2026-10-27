import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Activity } from "lucide-react-native";
import type { ClientMatchEvent, LiveMatchTelemetry } from "@/lib/api";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { COLORS } from "@/theme/tokens";

function StatCompareRow({
  label,
  home,
  away,
  suffix = "",
}: {
  label: string;
  home: number;
  away: number;
  suffix?: string;
}) {
  const total = home + away;
  const homePct = total > 0 ? Math.round((home / total) * 100) : 50;

  return (
    <View style={styles.statWrap}>
      <View style={styles.statTextRow}>
        <Text style={styles.statVal}>
          {home}
          {suffix}
        </Text>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statVal}>
          {away}
          {suffix}
        </Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barHome, { width: `${homePct}%` }]} />
      </View>
    </View>
  );
}

export function LiveMatchTracker({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  telemetry,
  events,
}: {
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  telemetry?: LiveMatchTelemetry;
  events?: ClientMatchEvent[];
}) {
  const cleanEvents = sanitizeMatchEvents(events, homeScore, awayScore);

  if (!telemetry && cleanEvents.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Activity size={15} color={COLORS.betclicRed} strokeWidth={2.4} />
        <Text style={styles.headTitle}>Télémétrie & Temps forts</Text>
      </View>

      {telemetry?.momentum && telemetry.momentum.length > 0 ? (
        <View style={styles.momentumBox}>
          <View style={styles.momentumHeader}>
            <Text style={styles.momentumSide}>{homeTeam}</Text>
            <Text style={styles.momentumLabel}>Pression par tranche</Text>
            <Text style={styles.momentumSide}>{awayTeam}</Text>
          </View>
          <View style={styles.momentumBars}>
            {telemetry.momentum.map((b, idx) => {
              const abs = Math.min(1, Math.abs(b.value));
              const h = Math.max(4, Math.round(abs * 24));
              const isHome = b.value >= 0;
              return (
                <View key={idx} style={styles.mCol}>
                  <View style={styles.mTop}>
                    {b.played && isHome ? (
                      <View
                        style={[
                          styles.mBarHome,
                          { height: h },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.mMidLine} />
                  <View style={styles.mBottom}>
                    {b.played && !isHome ? (
                      <View
                        style={[
                          styles.mBarAway,
                          { height: h },
                        ]}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {telemetry ? (
        <View style={styles.statsList}>
          <StatCompareRow
            label="Possession"
            home={telemetry.possessionHome}
            away={telemetry.possessionAway}
            suffix=" %"
          />
          <StatCompareRow
            label="Expected Goals (xG)"
            home={Number(telemetry.xgHome.toFixed(2))}
            away={Number(telemetry.xgAway.toFixed(2))}
          />
          <StatCompareRow
            label="Tirs (cadrés)"
            home={telemetry.shotsTotalHome}
            away={telemetry.shotsTotalAway}
          />
          <StatCompareRow
            label="Attaques dangereuses"
            home={telemetry.dangerousAttacksHome}
            away={telemetry.dangerousAttacksAway}
          />
          <StatCompareRow
            label="Corners"
            home={telemetry.cornersHome}
            away={telemetry.cornersAway}
          />
        </View>
      ) : null}

      {cleanEvents.length > 0 ? (
        <View style={styles.timeline}>
          <Text style={styles.timelineTitle}>Chronologie du match</Text>
          {cleanEvents.map((ev, idx) => {
            const isHome = ev.team === "home";
            const icon =
              ev.type === "goal" ? "⚽" : ev.type === "red" ? "🟥" : "🟨";
            return (
              <View key={idx} style={styles.evRow}>
                <Text style={styles.evMin}>{ev.minute}&apos;</Text>
                <Text style={styles.evIcon}>{icon}</Text>
                <Text numberOfLines={1} style={styles.evText}>
                  {ev.player ? `${ev.player} · ` : ""}
                  {isHome ? homeTeam : awayTeam}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
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
    gap: 12,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  headTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  momentumBox: {
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    padding: 10,
    gap: 8,
  },
  momentumHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  momentumSide: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.ink,
    maxWidth: "34%",
  },
  momentumLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.dim,
  },
  momentumBars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 54,
  },
  mCol: {
    flex: 1,
    height: "100%",
    justifyContent: "center",
  },
  mTop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  mMidLine: {
    height: 1,
    backgroundColor: COLORS.edge,
  },
  mBottom: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
  },
  mBarHome: {
    width: "80%",
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: COLORS.betclicRed,
  },
  mBarAway: {
    width: "80%",
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: COLORS.outerSpace,
  },
  statsList: {
    gap: 9,
  },
  statWrap: {
    gap: 4,
  },
  statTextRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statVal: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  barBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.outerSpace,
    overflow: "hidden",
  },
  barHome: {
    height: "100%",
    backgroundColor: COLORS.betclicRed,
  },
  timeline: {
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 10,
    gap: 6,
  },
  timelineTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.dim,
    marginBottom: 2,
  },
  evRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  evMin: {
    width: 28,
    fontSize: 11.5,
    fontWeight: "800",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  evIcon: {
    fontSize: 12,
  },
  evText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.ink,
    flex: 1,
  },
});
