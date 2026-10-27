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
  BarChart3,
  ChevronRight,
  Radio,
  RefreshCw,
} from "lucide-react-native";
import { LiveMatchTracker } from "@/components/live-match-tracker";
import { LiveStatusBadge } from "@/components/match-card";
import { useMobileMatchDetailQuery } from "@/lib/party-realtime";
import {
  AccordionItem,
  CATEGORY_TABS,
  formatMatchDateTime,
  inferCategory,
  sanitizeMatchMarkets,
  type SheetCategory,
} from "@/components/market-sheet";
import {
  hasAnyRealStats,
  RealMatchStatsCard,
} from "@/components/real-match-stats-card";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { useApp } from "@/context/app-context";
import { api, type ClientMatch } from "@/lib/api";
import { getCachedClientMatch } from "@/lib/entity-cache";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { useParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const POLL_LIVE_MS = 3_500;
const POLL_IDLE_MS = 15_000;

export default function MatchDetailScreen() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = Number(params.id);
  const invalidId = !Number.isInteger(matchId) || matchId <= 0;

  const {
    openBet,
    oddsFormat,
    target,
    comboLegs,
    comboQuickMode,
    toggleComboLeg,
    toast,
    dataSaverMode,
  } = useApp();

  const [prevId, setPrevId] = useState<number>(matchId);
  const [category, setCategory] = useState<SheetCategory>("all");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [initializedMatchId, setInitializedMatchId] = useState<number | null>(
    null
  );
  const [showTracker, setShowTracker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (matchId !== prevId) {
    setPrevId(matchId);
    setCategory("all");
    setInitializedMatchId(null);
    setOpenMap({});
    setShowTracker(false);
  }

  const cachedInitial = useMemo(
    () => (invalidId ? null : getCachedClientMatch(matchId)),
    [invalidId, matchId]
  );

  const detailQuery = useMobileMatchDetailQuery(matchId, {
    enabled: !invalidId,
    dataSaver: dataSaverMode,
    initialMatch: cachedInitial,
    isFinished: cachedInitial?.status === "finished",
  });

  const match = invalidId
    ? null
    : detailQuery.data?.match ??
      (detailQuery.isError ? null : undefined);

  const loadError =
    !detailQuery.data && detailQuery.error instanceof Error
      ? detailQuery.error.message
      : detailQuery.isError && !detailQuery.data
        ? "Impossible de charger cette rencontre."
        : null;

  const fetchMatch = useCallback(async () => {
    if (invalidId) return;
    await detailQuery.refetch();
  }, [detailQuery, invalidId]);

  const isFinished = match?.status === "finished";
  const isLive = match?.status === "live";

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMatch();
    setRefreshing(false);
  }, [fetchMatch]);

  const groups = useMemo(
    () => sanitizeMatchMarkets(match?.markets),
    [match]
  );

  if (match && match.id !== initializedMatchId && groups.length > 0) {
    setInitializedMatchId(match.id);
    const initial: Record<string, boolean> = {};
    for (const k of ["result", "total_ou"]) {
      if (groups.some((g) => g.key === k)) initial[k] = true;
    }
    if (Object.keys(initial).length === 0) {
      for (const g of groups.slice(0, 2)) initial[g.key] = true;
    }
    setOpenMap(initial);
  }

  const filteredGroups = useMemo(() => {
    if (category === "all") return groups;
    return groups.filter((g) => inferCategory(g) === category);
  }, [groups, category]);

  const cleanEvents = useMemo(
    () => (match ? sanitizeMatchEvents(match.events) : []),
    [match]
  );

  const isReal = match?.source === "manual";
  const realStatsAvailable = Boolean(
    isReal && hasAnyRealStats(match?.realStats)
  );
  const suspended = Boolean(match?.suspended);
  const canToggleTracker = Boolean(
    match && ((!isReal && isLive) || realStatsAvailable)
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
      {/* En-tête compact en une seule ligne (identique à src/app/(main)/matchs/[id]/page.tsx) */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back("/matchs")}
            style={({ pressed }) => [
              styles.roundBackBtn,
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
          >
            <ArrowLeft size={14} color={COLORS.ink} strokeWidth={2.3} />
          </Pressable>
          <View style={styles.leagueTitleRow}>
            <SportIcon
              sport={match?.sport ?? "football"}
              size={14}
              color={COLORS.betclicRed}
            />
            <Text numberOfLines={1} style={styles.leagueTitle}>
              {match?.league ?? "Rencontre"}
            </Text>
          </View>
        </View>

        {match ? (
          <View style={styles.headerRight}>
            {isLive ? (
              <LiveStatusBadge
                match={match}
                minute={match.minute}
                suspended={suspended}
              />
            ) : isFinished ? (
              <View style={styles.finBadge}>
                <Text style={styles.finBadgeText}>TERMINÉ</Text>
              </View>
            ) : null}
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>
                {formatMatchDateTime(match.startsAt)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: 10 }}>
        {match === undefined ? (
          <View style={styles.loaderBox}>
            <ActivityIndicator size="small" color={COLORS.betclicRed} />
          </View>
        ) : match === null ? (
          <View style={styles.notFoundCard}>
            <AlertTriangle
              size={20}
              color={COLORS.betclicRed}
              strokeWidth={2.2}
            />
            <Text style={styles.notFoundTitle}>Rencontre introuvable</Text>
            <Text style={styles.notFoundSub}>
              {loadError ?? "Ce match n'est plus disponible."}
            </Text>
            <View style={styles.notFoundActions}>
              <Pressable
                onPress={() => void fetchMatch()}
                style={styles.retryGrayBtn}
              >
                <RefreshCw size={12} color={COLORS.ink} strokeWidth={2.2} />
                <Text style={styles.retryGrayText}>Réessayer</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/matchs")}
                style={styles.redBtn}
              >
                <Text style={styles.redBtnText}>Matchs</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.stack}>
            {/* Scoreboard compact */}
            <View style={styles.scoreCard}>
              <View style={styles.scoreGrid}>
                <View style={styles.teamCol}>
                  <TeamAvatar
                    name={match.homeTeam}
                    logo={match.homeLogo}
                    size="sm"
                  />
                  <Text style={styles.teamName}>{match.homeTeam}</Text>
                  {(match.redHome ?? 0) > 0 ? (
                    <Text style={styles.redCardLabel}>
                      🟥 ×{match.redHome}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.scoreCenter}>
                  {isLive || isFinished ? (
                    <>
                      <View style={styles.scorePill}>
                        <Text
                          style={[
                            styles.scoreDigit,
                            isFinished &&
                              (match.homeScore ?? 0) > (match.awayScore ?? 0) &&
                              { color: COLORS.betclicRed },
                          ]}
                        >
                          {match.homeScore ?? 0}
                        </Text>
                        <Text style={styles.scoreDash}>-</Text>
                        <Text
                          style={[
                            styles.scoreDigit,
                            isFinished &&
                              (match.awayScore ?? 0) > (match.homeScore ?? 0) &&
                              { color: COLORS.betclicRed },
                          ]}
                        >
                          {match.awayScore ?? 0}
                        </Text>
                      </View>
                      {match.htHomeScore != null && match.htAwayScore != null ? (
                        <Text style={styles.htScore}>
                          MT {match.htHomeScore}-{match.htAwayScore}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <View style={styles.vsPill}>
                      <Text style={styles.vsText}>VS</Text>
                    </View>
                  )}
                </View>

                <View style={styles.teamCol}>
                  <TeamAvatar
                    name={match.awayTeam}
                    logo={match.awayLogo}
                    size="sm"
                  />
                  <Text style={styles.teamName}>{match.awayTeam}</Text>
                  {(match.redAway ?? 0) > 0 ? (
                    <Text style={styles.redCardLabel}>
                      🟥 ×{match.redAway}
                    </Text>
                  ) : null}
                </View>
              </View>

              {canToggleTracker || isFinished ? (
                <View style={styles.scoreFooter}>
                  {canToggleTracker ? (
                    <Pressable
                      onPress={() => setShowTracker((s) => !s)}
                      style={[
                        styles.trackerToggleBtn,
                        showTracker && styles.trackerToggleBtnActive,
                      ]}
                    >
                      {isReal ? (
                        <BarChart3
                          size={12}
                          color={showTracker ? "#34d399" : "#059669"}
                          strokeWidth={2.3}
                        />
                      ) : (
                        <Radio
                          size={12}
                          color={COLORS.betclicRed}
                          strokeWidth={2.3}
                        />
                      )}
                      <Text
                        style={[
                          styles.trackerToggleText,
                          showTracker && { color: "#ffffff" },
                        ]}
                      >
                        {isReal
                          ? showTracker
                            ? "Masquer stats"
                            : "Stats officielles"
                          : showTracker
                            ? "Masquer 2D"
                            : "Terrain 2D"}
                      </Text>
                    </Pressable>
                  ) : null}

                  {isFinished ? (
                    <Pressable
                      onPress={() => router.push(`/resultats/${match.id}`)}
                      style={styles.resultLinkPill}
                    >
                      <Text style={styles.resultLinkText}>
                        Bilan du résultat
                      </Text>
                      <ChevronRight
                        size={12}
                        color={COLORS.betclicRed}
                        strokeWidth={2.4}
                      />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Terrain 2D ou Stats officielles à la demande */}
            {showTracker && !isReal && isLive ? (
              <LiveMatchTracker match={match} />
            ) : null}

            {showTracker && realStatsAvailable ? (
              <RealMatchStatsCard
                stats={match.realStats}
                homeTeam={match.homeTeam}
                awayTeam={match.awayTeam}
                homeLogo={match.homeLogo}
                awayLogo={match.awayLogo}
                htHomeScore={match.htHomeScore}
                htAwayScore={match.htAwayScore}
                compact
              />
            ) : null}

            {/* Onglets de catégories + accordéons de marchés */}
            {isFinished || groups.length === 0 ? (
              <View style={styles.closedMarketsCard}>
                <Text style={styles.closedMarketsTitle}>
                  {isFinished
                    ? "Rencontre terminée — marchés clôturés."
                    : "Aucun marché ouvert pour le moment."}
                </Text>
                {isFinished ? (
                  <Pressable
                    onPress={() => router.push(`/resultats/${match.id}`)}
                    style={[styles.redBtn, { marginTop: 10 }]}
                  >
                    <Text style={styles.redBtnText}>Bilan détaillé</Text>
                    <ChevronRight size={14} color="#ffffff" strokeWidth={2.4} />
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catTabsRow}
                >
                  {CATEGORY_TABS.map((t) => {
                    const count =
                      t.key === "all"
                        ? groups.length
                        : groups.filter((g) => inferCategory(g) === t.key)
                            .length;
                    if (t.key !== "all" && count === 0) return null;
                    const active = category === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        onPress={() => setCategory(t.key)}
                        style={[
                          styles.catTabPill,
                          active && styles.catTabPillActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.catTabLabel,
                            active && styles.catTabLabelActive,
                          ]}
                        >
                          {t.label}
                        </Text>
                        <Text
                          style={[
                            styles.catTabCount,
                            active && styles.catTabCountActive,
                          ]}
                        >
                          {count}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {suspended ? (
                  <View style={styles.suspendedNotice}>
                    <Text style={styles.suspendedNoticeText}>
                      Marchés suspendus momentanément…
                    </Text>
                  </View>
                ) : null}

                <View style={{ gap: 8 }}>
                  {filteredGroups.map((g) => {
                    const isOpen =
                      category !== "all"
                        ? (openMap[g.key] ?? true)
                        : Boolean(openMap[g.key]);
                    const comboSelectedKey =
                      comboLegs.find(
                        (l) =>
                          l.uid === `sport-${match.id}` && l.market === g.key
                      )?.selection ?? null;

                    return (
                      <AccordionItem
                        key={g.key}
                        match={match}
                        group={g}
                        suspended={suspended}
                        open={isOpen}
                        oddsFormat={oddsFormat}
                        selectedKey={
                          target &&
                          target.match.id === match.id &&
                          target.market === g.key
                            ? target.selection
                            : null
                        }
                        comboSelectedKey={comboSelectedKey}
                        onToggle={() =>
                          setOpenMap((prev) => ({
                            ...prev,
                            [g.key]: !(category !== "all"
                              ? (prev[g.key] ?? true)
                              : Boolean(prev[g.key])),
                          }))
                        }
                        onPick={(outcome) => {
                          if (comboQuickMode) {
                            const res = toggleComboLeg({
                              uid: `sport-${match.id}`,
                              kind: "sport",
                              matchId: match.id,
                              matchSource: match.source,
                              title: `${match.homeTeam} – ${match.awayTeam}`,
                              homeTeam: match.homeTeam,
                              awayTeam: match.awayTeam,
                              homeLogo: match.homeLogo ?? null,
                              awayLogo: match.awayLogo ?? null,
                              league: match.league,
                              market: g.key,
                              selection: outcome.key,
                              selectionLabel: outcome.label,
                              odds: outcome.odds,
                              startsAt: match.startsAt,
                              isLive: match.status === "live",
                            });
                            if (res === "full") {
                              toast({
                                kind: "error",
                                title: "Betslip complet (8 sélections max)",
                              });
                            } else if (res === "source_conflict") {
                              toast({
                                kind: "error",
                                title: "Mélange interdit",
                                description:
                                  "Impossible de mélanger match réel et match virtuel.",
                              });
                            }
                            return;
                          }
                          openBet({
                            match,
                            selection: outcome.key,
                            odds: outcome.odds,
                            label: outcome.label,
                            market: g.key,
                            marketLabel: g.label,
                          });
                        }}
                      />
                    );
                  })}
                </View>
              </View>
            )}

            {/* Chronologie compacte */}
            {cleanEvents.length > 0 ? (
              <View style={styles.timelineCard}>
                <Text style={styles.timelineHeading}>
                  CHRONOLOGIE ({cleanEvents.length})
                </Text>
                <View style={{ marginTop: 6 }}>
                  {cleanEvents.map((ev, idx) => (
                    <View
                      key={`${ev.minute}-${ev.type}-${idx}`}
                      style={[
                        styles.timelineRow,
                        idx > 0 && styles.timelineDivider,
                      ]}
                    >
                      <View style={styles.timelineLeft}>
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
                        {ev.team === "home" ? match.homeTeam : match.awayTeam}
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
  leagueTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  leagueTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  finBadge: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  finBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.mist,
    letterSpacing: 0.4,
  },
  datePill: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  datePillText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
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
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  redBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  stack: {
    gap: 10,
  },
  scoreCard: {
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
    lineHeight: 15,
  },
  redCardLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
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
  htScore: {
    marginTop: 2,
    fontSize: 9.5,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  vsPill: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  vsText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.mist,
  },
  scoreFooter: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(228,230,235,0.7)",
    paddingTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  trackerToggleBtn: {
    height: 28,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  trackerToggleBtnActive: {
    backgroundColor: COLORS.ink,
  },
  trackerToggleText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  resultLinkPill: {
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(225,0,20,0.10)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  resultLinkText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  closedMarketsCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 14,
    alignItems: "center",
  },
  closedMarketsTitle: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
  },
  catTabsRow: {
    marginHorizontal: -12,
    paddingHorizontal: 12,
    paddingVertical: 2,
    flexDirection: "row",
    gap: 6,
  },
  catTabPill: {
    height: 30,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  catTabPillActive: {
    backgroundColor: COLORS.betclicRed,
  },
  catTabLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.mist,
  },
  catTabLabelActive: {
    color: "#ffffff",
  },
  catTabCount: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  catTabCountActive: {
    color: "rgba(255,255,255,0.8)",
  },
  suspendedNotice: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    backgroundColor: "rgba(245,158,11,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center",
  },
  suspendedNoticeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400e",
  },
  timelineCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  timelineHeading: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: COLORS.mist,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 6,
  },
  timelineDivider: {
    borderTopWidth: 1,
    borderTopColor: "rgba(228,230,235,0.6)",
  },
  timelineLeft: {
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
