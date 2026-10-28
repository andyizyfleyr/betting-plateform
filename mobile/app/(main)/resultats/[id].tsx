import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
} from "lucide-react-native";
import {
  hasAnyRealStats,
  RealMatchStatsCard,
} from "@/components/real-match-stats-card";
import { SportIcon } from "@/components/sport-icon";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { TeamAvatar } from "@/components/team-avatar";
import { useApp } from "@/context/app-context";
import { api, type ClientMatchHistoryItem } from "@/lib/api";
import { getCachedMatchHistoryItem } from "@/lib/entity-cache";
import { formatKickoff, formatOdds } from "@/lib/format";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { useParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function ResultDetailScreen() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = Number(params.id);
  const invalidId = !Number.isInteger(matchId) || matchId <= 0;
  const { oddsFormat } = useApp();

  const [prevId, setPrevId] = useState(matchId);
  const [item, setItem] = useState<
    ClientMatchHistoryItem | null | undefined
  >(() =>
    invalidId ? null : (getCachedMatchHistoryItem(matchId) ?? undefined)
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (matchId !== prevId) {
    setPrevId(matchId);
    setItem(
      invalidId ? null : (getCachedMatchHistoryItem(matchId) ?? undefined)
    );
  }

  const fetchResult = useCallback(async () => {
    if (invalidId) return;
    try {
      const base = await api.matchHistory();
      const inBase = base.matches.find((m) => m.id === matchId) ?? null;
      if (inBase) {
        setItem(inBase);
        setLoadError(null);
        return;
      }
      const focused = await api.matchHistory(matchId);
      setItem(focused.focusedMatch ?? null);
      setLoadError(null);
    } catch (e) {
      setItem((prev) => (prev === undefined ? null : prev));
      setLoadError(
        e instanceof Error
          ? e.message
          : "Impossible de charger ce résultat."
      );
    }
  }, [invalidId, matchId]);

  useEffect(() => {
    void fetchResult();
    if (item?.status === "finished") return;
    const id = setInterval(() => void fetchResult(), 5_000);
    return () => clearInterval(id);
  }, [fetchResult, item?.status]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchResult();
    setRefreshing(false);
  }, [fetchResult]);

  const cleanEvents = useMemo(
    () => (item ? sanitizeMatchEvents(item.events) : []),
    [item]
  );

  const settledSummary = useMemo(() => {
    if (!item) return [];
    const hs = item.homeScore ?? 0;
    const as = item.awayScore ?? 0;
    const total = hs + as;
    const btts = hs > 0 && as > 0;
    const doubleChance =
      item.winnerCode === "V1"
        ? "1X & 12"
        : item.winnerCode === "V2"
          ? "12 & 2X"
          : "1X & 2X";
    return [
      { label: "Double chance", value: doubleChance },
      {
        label: "Total 2.5",
        value: total >= 3 ? `TP 2.5 (${total} b.)` : `TM 2.5 (${total} b.)`,
      },
      {
        label: "Les 2 marquent",
        value: btts ? "Oui" : "Non",
      },
      ...(item.htWinnerCode && item.winnerCode
        ? [
            {
              label: "MT-Fin",
              value: `${item.htWinnerCode}-${item.winnerCode}`,
            },
          ]
        : []),
    ];
  }, [item]);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.betclicRed]}
          tintColor={COLORS.betclicRed}
        />
      }
    >
      {/* En-tête compact identique à src/app/(main)/resultats/[id]/page.tsx */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back("/resultats")}
            style={({ pressed }) => [
              styles.roundBackBtn,
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
          >
            <ArrowLeft size={14} color={COLORS.ink} strokeWidth={2.3} />
          </Pressable>

          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <SportIcon
                sport={item?.sport ?? "football"}
                size={14}
                color={COLORS.betclicRed}
              />
              <Text numberOfLines={1} style={styles.headerTitle}>
                {item?.league ?? "Résultat"}
              </Text>
            </View>
            {item ? (
              <Text numberOfLines={1} style={styles.headerSub}>
                {formatKickoff(item.finishedAt ?? item.startsAt)}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.ftBadge}>
          <Text style={styles.ftBadgeText}>Officiel FT</Text>
        </View>
      </View>

      <View style={{ marginTop: 10 }}>
        {item === undefined ? (
          <PulseFlashLoader compact />
        ) : item === null ? (
          <View style={styles.notFoundCard}>
            <AlertTriangle
              size={20}
              color={COLORS.betclicRed}
              strokeWidth={2.2}
            />
            <Text style={styles.notFoundTitle}>Résultat introuvable</Text>
            <Text style={styles.notFoundSub}>
              {loadError ??
                "Ce match n'est pas encore terminé ou n'existe plus."}
            </Text>
            <View style={styles.notFoundActions}>
              <Pressable
                onPress={() => void fetchResult()}
                style={styles.retryGrayBtn}
              >
                <RefreshCw size={12} color={COLORS.ink} strokeWidth={2.2} />
                <Text style={styles.retryGrayText}>Réessayer</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/matchs/${matchId}`)}
                style={styles.redBtn}
              >
                <Text style={styles.redBtnText}>Fiche du match</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.stack}>
            {/* Scoreboard final compact */}
            <View style={styles.card}>
              <View style={styles.scoreGrid}>
                <View style={styles.teamCol}>
                  <TeamAvatar
                    name={item.homeTeam}
                    logo={item.homeLogo}
                    size="sm"
                  />
                  <Text style={styles.teamName}>{item.homeTeam}</Text>
                </View>

                <View style={styles.scoreCenter}>
                  <View style={styles.scorePill}>
                    <Text
                      style={[
                        styles.scoreDigit,
                        (item.homeScore ?? 0) > (item.awayScore ?? 0) && {
                          color: COLORS.win,
                        },
                      ]}
                    >
                      {item.homeScore ?? 0}
                    </Text>
                    <Text style={styles.scoreDash}>-</Text>
                    <Text
                      style={[
                        styles.scoreDigit,
                        (item.awayScore ?? 0) > (item.homeScore ?? 0) && {
                          color: COLORS.win,
                        },
                      ]}
                    >
                      {item.awayScore ?? 0}
                    </Text>
                  </View>
                  {item.htHome != null && item.htAway != null ? (
                    <Text style={styles.htText}>
                      MT {item.htHome}-{item.htAway}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.teamCol}>
                  <TeamAvatar
                    name={item.awayTeam}
                    logo={item.awayLogo}
                    size="sm"
                  />
                  <Text style={styles.teamName}>{item.awayTeam}</Text>
                </View>
              </View>

              {/* Cotes 1X2 de clôture compactes */}
              <View style={styles.closingOddsGrid}>
                {[
                  { code: "V1", label: "1", odds: item.oddsHome },
                  { code: "X", label: "N", odds: item.oddsDraw },
                  { code: "V2", label: "2", odds: item.oddsAway },
                ].map((c) => {
                  const won = item.winnerCode === c.code;
                  return (
                    <View
                      key={c.code}
                      style={[
                        styles.closingCell,
                        won ? styles.closingCellWon : styles.closingCellDefault,
                      ]}
                    >
                      <Text
                        style={[
                          styles.closingLabel,
                          won && { color: COLORS.win },
                        ]}
                      >
                        {c.label}
                      </Text>
                      <Text
                        style={[
                          styles.closingOdds,
                          won && { color: COLORS.win },
                        ]}
                      >
                        {c.odds ? formatOdds(c.odds, oddsFormat) : "—"}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Marchés réglés en grille 2 colonnes */}
            <View style={styles.card}>
              <Text style={styles.sectionCaps}>MARCHÉS RÉGLÉS</Text>
              <View style={styles.settledGrid}>
                {settledSummary.map((row) => (
                  <View key={row.label} style={styles.settledCell}>
                    <Text style={styles.settledLabel}>{row.label}</Text>
                    <View style={styles.settledValRow}>
                      <CheckCircle2
                        size={12}
                        color={COLORS.win}
                        strokeWidth={2.5}
                      />
                      <Text numberOfLines={1} style={styles.settledValText}>
                        {row.value}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* Statistiques officielles ou télémétrie virtuelle */}
            {item.source === "manual" && hasAnyRealStats(item.realStats) ? (
              <RealMatchStatsCard
                stats={item.realStats}
                homeTeam={item.homeTeam}
                awayTeam={item.awayTeam}
                homeLogo={item.homeLogo}
                awayLogo={item.awayLogo}
                htHomeScore={item.htHome}
                htAwayScore={item.htAway}
                compact
              />
            ) : null}

            {item.source !== "manual" && item.telemetry ? (
              <View style={styles.card}>
                <Text style={styles.sectionCaps}>STATISTIQUES</Text>
                <View style={{ marginTop: 8, gap: 4 }}>
                  {[
                    {
                      label: "Possession",
                      left: `${item.telemetry.possessionHome}%`,
                      right: `${item.telemetry.possessionAway}%`,
                    },
                    {
                      label: "xG",
                      left: item.telemetry.xgHome.toFixed(2),
                      right: item.telemetry.xgAway.toFixed(2),
                    },
                    {
                      label: "Tirs (cadrés)",
                      left: `${item.telemetry.shotsTotalHome} (${item.telemetry.shotsOnTargetHome})`,
                      right: `${item.telemetry.shotsTotalAway} (${item.telemetry.shotsOnTargetAway})`,
                    },
                    {
                      label: "Corners",
                      left: String(item.telemetry.cornersHome),
                      right: String(item.telemetry.cornersAway),
                    },
                    {
                      label: "Attaques dang.",
                      left: String(item.telemetry.dangerousAttacksHome),
                      right: String(item.telemetry.dangerousAttacksAway),
                    },
                  ].map((s) => (
                    <View key={s.label} style={styles.statRow}>
                      <Text style={styles.statNum}>{s.left}</Text>
                      <Text style={styles.statLabel}>{s.label}</Text>
                      <Text style={styles.statNum}>{s.right}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Chronologie compacte */}
            {cleanEvents.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionCaps}>
                  FAITS DE MATCH ({cleanEvents.length})
                </Text>
                <View style={{ marginTop: 6 }}>
                  {cleanEvents.map((ev, idx) => (
                    <View
                      key={`${ev.minute}-${ev.type}-${idx}`}
                      style={[
                        styles.eventRow,
                        idx > 0 && styles.eventDivider,
                      ]}
                    >
                      <View style={styles.eventLeft}>
                        <View style={styles.minuteBox}>
                          <Text style={styles.minuteText}>
                            {ev.minute}&apos;
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11 }}>
                          {ev.type === "goal"
                            ? "⚽"
                            : ev.type === "red"
                              ? "🟥"
                              : "🟨"}
                        </Text>
                        <Text numberOfLines={1} style={styles.playerName}>
                          {ev.player}
                        </Text>
                      </View>
                      <Text style={styles.eventTeam}>
                        {ev.team === "home" ? item.homeTeam : item.awayTeam}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roundBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
  },
  headerSub: {
    fontSize: 10,
    color: COLORS.dim,
  },
  ftBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(21,128,61,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  ftBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.win,
  },
  loaderBox: {
    paddingVertical: 44,
    alignItems: "center",
  },
  notFoundCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 16,
    alignItems: "center",
  },
  notFoundTitle: {
    marginTop: 6,
    fontSize: 14.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  notFoundSub: {
    marginTop: 2,
    fontSize: 11.5,
    color: COLORS.mist,
    textAlign: "center",
  },
  notFoundActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  retryGrayBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  retryGrayText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  redBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  redBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  stack: {
    gap: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  scoreGrid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  teamCol: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  teamName: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
  },
  scoreCenter: {
    alignItems: "center",
  },
  scorePill: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  scoreDigit: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  scoreDash: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.dim,
  },
  htText: {
    marginTop: 2,
    fontSize: 9.5,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  closingOddsGrid: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(229,231,235,0.7)",
    paddingTop: 8,
    flexDirection: "row",
    gap: 6,
  },
  closingCell: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closingCellDefault: {
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241,243,245,0.5)",
  },
  closingCellWon: {
    borderColor: "rgba(21,128,61,0.45)",
    backgroundColor: "rgba(21,128,61,0.10)",
  },
  closingLabel: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.mist,
  },
  closingOdds: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
  sectionCaps: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: COLORS.mist,
  },
  settledGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  settledCell: {
    width: "48.5%",
    borderRadius: 8,
    backgroundColor: "rgba(241,243,245,0.65)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  settledLabel: {
    fontSize: 9.5,
    fontWeight: "600",
    textTransform: "uppercase",
    color: COLORS.dim,
  },
  settledValRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  settledValText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  statRow: {
    borderRadius: 8,
    backgroundColor: "rgba(241,243,245,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statNum: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 6,
  },
  eventDivider: {
    borderTopWidth: 1,
    borderTopColor: "rgba(229,231,235,0.6)",
  },
  eventLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  minuteBox: {
    minWidth: 28,
    borderRadius: 4,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 4,
    paddingVertical: 2,
    alignItems: "center",
  },
  minuteText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  playerName: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.ink,
  },
  eventTeam: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
});
