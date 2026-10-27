import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, CheckCircle2 } from "lucide-react-native";
import { LiveMatchTracker } from "@/components/live-match-tracker";
import { RealMatchStatsCard } from "@/components/real-match-stats-card";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { api, type ClientMatchHistoryItem } from "@/lib/api";
import { getCachedFinishedMatchSnapshot } from "@/lib/entity-cache";
import { formatFullDateTime } from "@/lib/format";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function ResultatDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = Number(id);

  const [item, setItem] = useState<ClientMatchHistoryItem | null>(() =>
    Number.isFinite(matchId) ? getCachedFinishedMatchSnapshot(matchId) : null
  );
  const [loading, setLoading] = useState<boolean>(!item);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(matchId) || matchId <= 0) return;
    try {
      const res = await api.matchHistory(matchId);
      const found =
        res.focusedMatch ??
        res.matches.find((m) => m.id === matchId) ??
        null;
      if (found) setItem(found);
    } catch {
      /* garde snapshot */
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading && !item) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={COLORS.betclicRed} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Résultat introuvable</Text>
        <Pressable
          onPress={() => router.back("/resultats")}
          style={styles.backFallback}
        >
          <Text style={styles.backFallbackText}>Retour aux résultats</Text>
        </Pressable>
      </View>
    );
  }

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
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back("/resultats")}
          style={styles.backBtn}
        >
          <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>
        <View style={styles.leagueRow}>
          <SportIcon sport={item.sport} size={14} color={COLORS.dim} />
          <Text numberOfLines={1} style={styles.leagueText}>
            {item.league}
          </Text>
        </View>
        <View style={styles.finBadge}>
          <Text style={styles.finBadgeText}>Terminé</Text>
        </View>
      </View>

      <View style={styles.scoreboardCard}>
        <Text style={styles.dateHeader}>
          {formatFullDateTime(item.finishedAt || item.startsAt)}
        </Text>

        <View style={styles.clubsRow}>
          <View style={styles.clubCol}>
            <TeamAvatar
              name={item.homeTeam}
              logo={item.homeLogo}
              size="lg"
            />
            <Text style={styles.clubName}>{item.homeTeam}</Text>
          </View>

          <View style={styles.scoreCenter}>
            <Text style={styles.bigScore}>
              {item.homeScore ?? 0} : {item.awayScore ?? 0}
            </Text>
            {item.htHome !== null && item.htAway !== null ? (
              <Text style={styles.htScore}>
                MT {item.htHome} - {item.htAway}
              </Text>
            ) : null}
          </View>

          <View style={styles.clubCol}>
            <TeamAvatar
              name={item.awayTeam}
              logo={item.awayLogo}
              size="lg"
            />
            <Text style={styles.clubName}>{item.awayTeam}</Text>
          </View>
        </View>
      </View>

      <View style={styles.settlementCard}>
        <View style={styles.settlementHead}>
          <CheckCircle2 size={15} color={COLORS.win} strokeWidth={2.4} />
          <Text style={styles.settlementTitle}>Marchés réglés</Text>
        </View>
        <View style={styles.grid}>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Résultat 1X2</Text>
            <Text style={styles.cellVal}>{item.winnerCode ?? "—"}</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Mi-temps 1X2</Text>
            <Text style={styles.cellVal}>{item.htWinnerCode ?? "—"}</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Total buts</Text>
            <Text style={styles.cellVal}>
              {item.totalGoals !== null ? `${item.totalGoals}` : "—"}
            </Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Les 2 marquent</Text>
            <Text style={styles.cellVal}>
              {item.btts === null ? "—" : item.btts ? "Oui" : "Non"}
            </Text>
          </View>
        </View>
      </View>

      <RealMatchStatsCard stats={item.realStats} />

      <LiveMatchTracker
        homeTeam={item.homeTeam}
        awayTeam={item.awayTeam}
        homeScore={item.homeScore}
        awayScore={item.awayScore}
        telemetry={item.telemetry}
        events={item.events}
      />
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
    paddingBottom: 26,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  notFound: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  backFallback: {
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  backFallbackText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  leagueText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.mist,
    flexShrink: 1,
  },
  finBadge: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  finBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.dim,
  },
  scoreboardCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 16,
    gap: 12,
  },
  dateHeader: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.dim,
    textAlign: "center",
  },
  clubsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  clubCol: {
    flex: 1,
    alignItems: "center",
    gap: 7,
  },
  clubName: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    textAlign: "center",
  },
  scoreCenter: {
    minWidth: 74,
    paddingTop: 6,
    alignItems: "center",
    gap: 4,
  },
  bigScore: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  htScore: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  settlementCard: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 14,
    gap: 10,
  },
  settlementHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  settlementTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  cell: {
    width: "48.5%",
    borderRadius: 11,
    backgroundColor: COLORS.elev,
    padding: 10,
    gap: 2,
  },
  cellLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  cellVal: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
  },
});
