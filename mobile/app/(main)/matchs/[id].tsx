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
import { ArrowLeft, Clock, Lock } from "lucide-react-native";
import { KickoffCountdown } from "@/components/kickoff-countdown";
import { LiveMatchTracker } from "@/components/live-match-tracker";
import { MarketGroupAccordion } from "@/components/market-sheet";
import { RealMatchStatsCard } from "@/components/real-match-stats-card";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { useApp } from "@/context/app-context";
import { api, type ClientMatch } from "@/lib/api";
import { getCachedMatchSnapshot } from "@/lib/entity-cache";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { useSmartPolling } from "@/lib/polling";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const CATEGORIES = [
  { key: "all", label: "Tous" },
  { key: "main", label: "Principaux" },
  { key: "goals", label: "Buts" },
  { key: "halftime", label: "Mi-temps" },
  { key: "teams", label: "Équipes" },
  { key: "scores", label: "Score exact" },
] as const;

export default function MatchDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = Number(id);
  const { dataSaverMode } = useApp();

  const [match, setMatch] = useState<ClientMatch | null>(() =>
    Number.isFinite(matchId) ? getCachedMatchSnapshot(matchId) : null
  );
  const [loading, setLoading] = useState<boolean>(!match);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"markets" | "stats">("markets");
  const [category, setCategory] = useState<string>("all");

  const fetchMatch = useCallback(async () => {
    if (!Number.isFinite(matchId) || matchId <= 0) return;
    try {
      const res = await api.matchById(matchId);
      setMatch(res.match);
    } catch {
      /* garde le snapshot */
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    setMatch(Number.isFinite(matchId) ? getCachedMatchSnapshot(matchId) : null);
    setLoading(!getCachedMatchSnapshot(matchId));
    void fetchMatch();
  }, [fetchMatch, matchId]);

  useSmartPolling(
    fetchMatch,
    match?.status === "live" ? 3_500 : 7_000,
    {
      enabled:
        Number.isFinite(matchId) &&
        matchId > 0 &&
        match?.status !== "finished",
      dataSaver: dataSaverMode,
      runImmediately: false,
    }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMatch();
    setRefreshing(false);
  }, [fetchMatch]);

  const goals = useMemo(
    () =>
      sanitizeMatchEvents(
        match?.events,
        match?.homeScore ?? null,
        match?.awayScore ?? null
      ).filter((e) => e.type === "goal"),
    [match?.awayScore, match?.events, match?.homeScore]
  );

  if (loading && !match) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator size="small" color={COLORS.betclicRed} />
      </View>
    );
  }

  if (!match) {
    return (
      <View style={styles.centerLoader}>
        <Text style={styles.notFoundTitle}>Match introuvable</Text>
        <Pressable
          onPress={() => router.back("/matchs")}
          style={styles.backFallbackBtn}
        >
          <Text style={styles.backFallbackText}>Retour aux matchs</Text>
        </Pressable>
      </View>
    );
  }

  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isPostGameVerifying =
    match.source === "manual" &&
    isLive &&
    Boolean(match.suspended) &&
    match.minute === "Fin · Vérif.";

  const filteredGroups = match.markets.filter(
    (g) => category === "all" || g.category === category
  );

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
      {/* Barre supérieure : Retour + Ligue + Date / Statut */}
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back("/matchs")}
          style={styles.backBtn}
        >
          <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>

        <View style={styles.leagueWrap}>
          <SportIcon sport={match.sport} size={14} color={COLORS.dim} />
          <Text numberOfLines={1} style={styles.leagueText}>
            {match.league}
          </Text>
        </View>

        {isPostGameVerifying ? (
          <View style={styles.verifyPill}>
            <Clock size={11.5} color={COLORS.amber} strokeWidth={2.3} />
            <Text style={styles.verifyText}>Fin · Vérif.</Text>
          </View>
        ) : isLive ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{match.minute ?? "LIVE"}</Text>
          </View>
        ) : isFinished ? (
          <View style={styles.finPill}>
            <Text style={styles.finText}>Terminé</Text>
          </View>
        ) : (
          <KickoffCountdown startsAt={match.startsAt} />
        )}
      </View>

      {/* Scoreboard complet — Noms complets des clubs sans troncature */}
      <View style={styles.scoreboardCard}>
        <View style={styles.clubsRow}>
          <View style={styles.clubCol}>
            <TeamAvatar
              name={match.homeTeam}
              logo={match.homeLogo}
              size="lg"
            />
            <Text style={styles.clubName}>{match.homeTeam}</Text>
            {(match.redHome ?? 0) > 0 ? (
              <View style={styles.redBadge}>
                <Text style={styles.redBadgeText}>
                  {match.redHome} rouge
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.scoreCenter}>
            {isLive || isFinished ? (
              <>
                <Text style={styles.bigScore}>
                  {match.homeScore ?? 0} : {match.awayScore ?? 0}
                </Text>
                {match.htHomeScore !== null &&
                match.htHomeScore !== undefined &&
                match.htAwayScore !== null &&
                match.htAwayScore !== undefined ? (
                  <Text style={styles.htScore}>
                    MT {match.htHomeScore} - {match.htAwayScore}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.vsLabel}>VS</Text>
            )}
          </View>

          <View style={styles.clubCol}>
            <TeamAvatar
              name={match.awayTeam}
              logo={match.awayLogo}
              size="lg"
            />
            <Text style={styles.clubName}>{match.awayTeam}</Text>
            {(match.redAway ?? 0) > 0 ? (
              <View style={styles.redBadge}>
                <Text style={styles.redBadgeText}>
                  {match.redAway} rouge
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {goals.length > 0 ? (
          <View style={styles.goalsBox}>
            {goals.map((g, i) => (
              <Text key={i} style={styles.goalLine}>
                ⚽ {g.minute}&apos; {g.player ? `${g.player} · ` : ""}
                {g.team === "home" ? match.homeTeam : match.awayTeam}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {/* Sélecteur Marchés / Statistiques */}
      <View style={styles.tabsBar}>
        <Pressable
          onPress={() => setActiveTab("markets")}
          style={[
            styles.tabBtn,
            activeTab === "markets" && styles.tabBtnActive,
          ]}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "markets" && styles.tabTextActive,
            ]}
          >
            Marchés ({match.markets.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("stats")}
          style={[
            styles.tabBtn,
            activeTab === "stats" && styles.tabBtnActive,
          ]}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "stats" && styles.tabTextActive,
            ]}
          >
            Direct & Stats
          </Text>
        </Pressable>
      </View>

      {activeTab === "markets" ? (
        <View style={styles.marketsSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catsRow}
          >
            {CATEGORIES.map((c) => {
              const active = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  style={[styles.catPill, active && styles.catPillActive]}
                >
                  <Text
                    style={[styles.catText, active && styles.catTextActive]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {match.suspended ? (
            <View style={styles.suspendedBanner}>
              <Lock size={14} color={COLORS.amber} strokeWidth={2.2} />
              <Text style={styles.suspendedText}>
                {isPostGameVerifying
                  ? "Fin du match · vérification du score officiel…"
                  : "Marchés momentanément suspendus"}
              </Text>
            </View>
          ) : null}

          {match.markets.length <= 1 ? (
            <View style={styles.inlineSpinner}>
              <ActivityIndicator size="small" color={COLORS.betclicRed} />
            </View>
          ) : null}

          <View style={styles.groupsStack}>
            {filteredGroups.map((group) => (
              <MarketGroupAccordion
                key={group.key}
                match={match}
                group={group}
              />
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.statsSection}>
          <RealMatchStatsCard stats={match.realStats} />
          <LiveMatchTracker
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homeScore={match.homeScore}
            awayScore={match.awayScore}
            telemetry={match.telemetry}
            events={match.events}
          />
          {!match.realStats &&
          !match.telemetry &&
          (!match.events || match.events.length === 0) ? (
            <View style={styles.emptyStats}>
              <Text style={styles.emptyStatsText}>
                Les statistiques détaillées s&apos;afficheront dès le coup
                d&apos;envoi.
              </Text>
            </View>
          ) : null}
        </View>
      )}
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
  centerLoader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  notFoundTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  backFallbackBtn: {
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
  leagueWrap: {
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
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
  },
  liveText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  verifyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.amberSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  verifyText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.amber,
  },
  finPill: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  finText: {
    fontSize: 11,
    fontWeight: "600",
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
    lineHeight: 17.5,
  },
  redBadge: {
    borderRadius: 5,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  redBadgeText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  scoreCenter: {
    minWidth: 74,
    paddingTop: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  bigScore: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  htScore: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  vsLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.dim,
  },
  goalsBox: {
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 9,
    gap: 3,
  },
  goalLine: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
    textAlign: "center",
  },
  tabsBar: {
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.pillDefault,
    padding: 3,
    flexDirection: "row",
  },
  tabBtn: {
    flex: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBtnActive: {
    backgroundColor: "#ffffff",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.mist,
  },
  tabTextActive: {
    fontWeight: "800",
    color: COLORS.ink,
  },
  marketsSection: {
    gap: 10,
  },
  catsRow: {
    flexDirection: "row",
    gap: 7,
  },
  catPill: {
    height: 36,
    borderRadius: 11,
    paddingHorizontal: 13,
    backgroundColor: COLORS.pillDefault,
    alignItems: "center",
    justifyContent: "center",
  },
  catPillActive: {
    backgroundColor: COLORS.betclicRed,
  },
  catText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.ink,
  },
  catTextActive: {
    fontWeight: "700",
    color: "#ffffff",
  },
  suspendedBanner: {
    borderRadius: 12,
    backgroundColor: COLORS.amberSoft,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  suspendedText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.amber,
    flex: 1,
  },
  inlineSpinner: {
    paddingVertical: 10,
    alignItems: "center",
  },
  groupsStack: {
    gap: 10,
  },
  statsSection: {
    gap: 10,
  },
  emptyStats: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 22,
    alignItems: "center",
  },
  emptyStatsText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.dim,
    textAlign: "center",
  },
});
