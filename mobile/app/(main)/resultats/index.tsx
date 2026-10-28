import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Cpu,
  History,
  Search,
  Trophy,
  X,
} from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { LiveMatchClock } from "@/components/live-match-clock";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/context/app-context";
import { useMobileMatchHistoryQuery } from "@/lib/party-realtime";
import { mobileQueryKeys } from "@/lib/query-client";
import { api, type ClientMatchHistoryItem } from "@/lib/api";
import {
  formatDayHeading,
  formatKickoff,
  formatOdds,
  formatPlacedAt,
} from "@/lib/format";
import { useRouter, useSearchParams } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

type Universe = "real" | "virtual";
type WinnerFilter = "all" | "V1" | "X" | "V2";
type GoalsFilter = "all" | "over25" | "under25" | "btts";

function MatchHistoryCard({
  match,
  highlighted = false,
}: {
  match: ClientMatchHistoryItem;
  highlighted?: boolean;
}) {
  const router = useRouter();
  const { oddsFormat } = useApp();
  const isFinished = match.status === "finished";
  const isLive = match.status === "live";
  const hasScore = match.homeScore != null && match.awayScore != null;
  const h = match.homeScore ?? 0;
  const a = match.awayScore ?? 0;

  const winningOdds =
    match.winnerCode === "V1"
      ? match.oddsHome
      : match.winnerCode === "X"
        ? (match.oddsDraw ?? null)
        : match.winnerCode === "V2"
          ? match.oddsAway
          : null;

  const targetHref = isFinished
    ? `/resultats/${match.id}`
    : `/matchs/${match.id}`;

  return (
    <Pressable
      onPress={() => router.push(targetHref)}
      style={({ pressed }) => [
        styles.card,
        highlighted && styles.cardHighlighted,
        pressed && { backgroundColor: "#fafbfc" },
      ]}
    >
      {/* En-tête ligue + heure + statut */}
      <View style={styles.cardTopRow}>
        <View style={styles.cardTopLeft}>
          <SportIcon sport={match.sport} size={14} color={COLORS.dim} />
          <Text numberOfLines={1} style={styles.leagueText}>
            {match.league}
          </Text>
          <Text style={styles.dotSep}>·</Text>
          {isFinished ? (
            <Text style={styles.timeText}>
              {formatPlacedAt(match.finishedAt ?? match.startsAt)}
            </Text>
          ) : isLive ? (
            <LiveMatchClock
              match={match}
              fallback={match.minute ?? "LIVE"}
              style={styles.timeText}
            />
          ) : (
            <Text style={styles.timeText}>{formatKickoff(match.startsAt)}</Text>
          )}
        </View>

        <View style={styles.cardTopRight}>
          {isLive ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <LiveMatchClock
                match={match}
                fallback={match.minute ?? "LIVE"}
                style={styles.liveBadgeText}
              />
            </View>
          ) : isFinished && match.winnerCode ? (
            <View style={styles.winnerBadge}>
              <Text style={styles.winnerBadgeText}>
                {match.winnerCode}
                {winningOdds != null
                  ? ` · ${formatOdds(winningOdds, oddsFormat)}`
                  : ""}
              </Text>
            </View>
          ) : (
            <View style={styles.upcomingBadge}>
              <Text style={styles.upcomingBadgeText}>À venir</Text>
            </View>
          )}
          <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
        </View>
      </View>

      {/* Équipes + score */}
      <View style={styles.teamsBlock}>
        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar
              name={match.homeTeam}
              logo={match.homeLogo}
              size="xs"
            />
            <Text
              numberOfLines={1}
              style={[
                styles.teamName,
                hasScore && h > a && styles.teamNameWinner,
              ]}
            >
              {match.homeTeam}
            </Text>
            {match.redHome > 0 ? <View style={styles.redCardChip} /> : null}
          </View>
          <Text
            style={[
              styles.scoreText,
              hasScore && h > a && styles.scoreTextWinner,
            ]}
          >
            {hasScore ? h : "–"}
          </Text>
        </View>

        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar
              name={match.awayTeam}
              logo={match.awayLogo}
              size="xs"
            />
            <Text
              numberOfLines={1}
              style={[
                styles.teamName,
                hasScore && a > h && styles.teamNameWinner,
              ]}
            >
              {match.awayTeam}
            </Text>
            {match.redAway > 0 ? <View style={styles.redCardChip} /> : null}
          </View>
          <Text
            style={[
              styles.scoreText,
              hasScore && a > h && styles.scoreTextWinner,
            ]}
          >
            {hasScore ? a : "–"}
          </Text>
        </View>
      </View>

      {/* Résumé compact sur une ligne */}
      {hasScore && match.htHome != null && match.htAway != null ? (
        <View style={styles.summaryPillsRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryPillText}>
              MT {match.htHome}-{match.htAway}
            </Text>
          </View>
          {match.totalGoals != null ? (
            <View style={styles.summaryPill}>
              <Text style={styles.summaryPillText}>
                {match.totalGoals >= 3 ? "TP 2.5" : "TM 2.5"}
              </Text>
            </View>
          ) : null}
          {match.btts != null ? (
            <View style={styles.summaryPill}>
              <Text style={styles.summaryPillText}>
                BTTS : {match.btts ? "Oui" : "Non"}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function ResultatsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const matchParam = searchParams.get("match");
  const universeParam = searchParams.get("universe");
  const { dataSaverMode } = useApp();
  const requestedMatchId = matchParam ? Number(matchParam) : undefined;
  const validRequestedId =
    requestedMatchId && Number.isInteger(requestedMatchId) && requestedMatchId > 0
      ? requestedMatchId
      : undefined;

  const [refreshing, setRefreshing] = useState(false);

  const [selectedUniverse, setSelectedUniverse] = useState<Universe | null>(
    universeParam === "virtual"
      ? "virtual"
      : universeParam === "real"
        ? "real"
        : null
  );
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [winnerFilter, setWinnerFilter] = useState<WinnerFilter>("all");
  const [goalsFilter, setGoalsFilter] = useState<GoalsFilter>("all");
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput | null>(null);

  const historyQuery = useMobileMatchHistoryQuery({
    dataSaver: dataSaverMode,
  });

  const history = useMemo(
    () => historyQuery.data?.matches ?? (historyQuery.isError ? [] : null),
    [historyQuery.data, historyQuery.isError]
  );

  const focusedInBase = useMemo(
    () =>
      validRequestedId && history
        ? (history.find((m) => m.id === validRequestedId) ?? null)
        : null,
    [history, validRequestedId]
  );

  const focusedFallbackQuery = useQuery({
    queryKey: mobileQueryKeys.matchHistoryFocused(validRequestedId ?? 0),
    queryFn: () => api.matchHistory(validRequestedId),
    enabled: Boolean(validRequestedId && history && !focusedInBase),
    staleTime: 60_000,
  });

  const focusedMatch = validRequestedId
    ? (focusedInBase ?? focusedFallbackQuery.data?.focusedMatch ?? null)
    : null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await historyQuery.refetch();
      if (validRequestedId && !focusedInBase) {
        await focusedFallbackQuery.refetch();
      }
    } finally {
      setRefreshing(false);
    }
  }, [focusedFallbackQuery, focusedInBase, historyQuery, validRequestedId]);

  const sortedHistory = useMemo(() => {
    if (!history) return [];
    return [...history].sort((a, b) => {
      const ta = new Date(a.finishedAt ?? a.startsAt).getTime();
      const tb = new Date(b.finishedAt ?? b.startsAt).getTime();
      return tb - ta || b.id - a.id;
    });
  }, [history]);

  const realHistory = useMemo(
    () => sortedHistory.filter((m) => m.source === "manual"),
    [sortedHistory]
  );
  const virtualHistory = useMemo(
    () => sortedHistory.filter((m) => m.source !== "manual"),
    [sortedHistory]
  );

  const defaultUniverse: Universe = useMemo(() => {
    if (universeParam === "virtual") return "virtual";
    if (universeParam === "real") return "real";
    if (focusedMatch) {
      return focusedMatch.source === "manual" ? "real" : "virtual";
    }
    if (realHistory.length > 0) return "real";
    return "virtual";
  }, [universeParam, focusedMatch, realHistory.length]);

  const universe: Universe = selectedUniverse ?? defaultUniverse;
  const isRealUniverse = universe === "real";
  const universePool = isRealUniverse ? realHistory : virtualHistory;

  const qNorm = query.trim().toLowerCase();

  const searched = useMemo(() => {
    if (!qNorm) return universePool;
    return universePool.filter(
      (m) =>
        m.homeTeam.toLowerCase().includes(qNorm) ||
        m.awayTeam.toLowerCase().includes(qNorm) ||
        m.league.toLowerCase().includes(qNorm)
    );
  }, [universePool, qNorm]);

  const leaguesWithCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of searched) {
      counts.set(m.league, (counts.get(m.league) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([league, count]) => ({ league, count }));
  }, [searched]);

  const effectiveLeague = useMemo(() => {
    if (leagueFilter === "all") return "all";
    return universePool.some((m) => m.league === leagueFilter)
      ? leagueFilter
      : "all";
  }, [leagueFilter, universePool]);

  const byLeague = useMemo(
    () =>
      effectiveLeague === "all"
        ? searched
        : searched.filter((m) => m.league === effectiveLeague),
    [searched, effectiveLeague]
  );

  const v1Count = useMemo(
    () => byLeague.filter((m) => m.winnerCode === "V1").length,
    [byLeague]
  );
  const drawCount = useMemo(
    () => byLeague.filter((m) => m.winnerCode === "X").length,
    [byLeague]
  );
  const v2Count = useMemo(
    () => byLeague.filter((m) => m.winnerCode === "V2").length,
    [byLeague]
  );

  const byWinner = useMemo(
    () =>
      winnerFilter === "all"
        ? byLeague
        : byLeague.filter((m) => m.winnerCode === winnerFilter),
    [byLeague, winnerFilter]
  );

  const over25Count = useMemo(
    () => byWinner.filter((m) => (m.totalGoals ?? 0) >= 3).length,
    [byWinner]
  );
  const under25Count = useMemo(
    () =>
      byWinner.filter((m) => m.totalGoals != null && m.totalGoals < 3).length,
    [byWinner]
  );
  const bttsCount = useMemo(
    () => byWinner.filter((m) => m.btts === true).length,
    [byWinner]
  );

  const visible = useMemo(() => {
    if (goalsFilter === "over25")
      return byWinner.filter((m) => (m.totalGoals ?? 0) >= 3);
    if (goalsFilter === "under25")
      return byWinner.filter((m) => m.totalGoals != null && m.totalGoals < 3);
    if (goalsFilter === "btts") return byWinner.filter((m) => m.btts === true);
    return byWinner;
  }, [byWinner, goalsFilter]);

  const unfocusedVisible = useMemo(
    () =>
      focusedMatch ? visible.filter((m) => m.id !== focusedMatch.id) : visible,
    [visible, focusedMatch]
  );

  const resetKey = `${universe}|${effectiveLeague}|${winnerFilter}|${goalsFilter}|${qNorm}`;
  const { visibleItems: pagedResults, hasMore, onScrollCheck } =
    useInfiniteBatch(unfocusedVisible, 10, resetKey);

  const groupedByDay = useMemo(() => {
    const groups: Array<{ day: string; items: ClientMatchHistoryItem[] }> = [];
    for (const m of pagedResults) {
      const day = formatDayHeading(m.finishedAt ?? m.startsAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) {
        last.items.push(m);
      } else {
        groups.push({ day, items: [m] });
      }
    }
    return groups;
  }, [pagedResults]);

  const toggleMobileSearch = () => {
    if (mobileSearchOpen) {
      setQuery("");
      setMobileSearchOpen(false);
    } else {
      setMobileSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[4]}
      showsVerticalScrollIndicator={false}
      onScroll={onScrollCheck}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.betclicRed]}
          tintColor={COLORS.betclicRed}
        />
      }
    >
      {/* 0 : En-tête identique à src/app/(main)/resultats/page.tsx */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back("/matchs")}
            style={({ pressed }) => [
              styles.roundBackBtn,
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
          >
            <ArrowLeft size={16} color={COLORS.ink} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.pageTitle}>Résultats</Text>
        </View>

        <Pressable
          onPress={toggleMobileSearch}
          style={[
            styles.roundSearchBtn,
            (mobileSearchOpen || Boolean(query)) &&
              styles.roundSearchBtnActive,
          ]}
        >
          {mobileSearchOpen ? (
            <X size={16} color="#ffffff" strokeWidth={2.3} />
          ) : (
            <Search
              size={16}
              color={query ? "#ffffff" : COLORS.ink}
              strokeWidth={2.2}
            />
          )}
        </Pressable>
      </View>

      {/* 1 : Sélecteur d'univers Matchs réels / Matchs virtuels */}
      <View style={styles.universeSwitcher}>
        <Pressable
          onPress={() => {
            setSelectedUniverse("real");
            setLeagueFilter("all");
          }}
          style={[
            styles.universeBtn,
            isRealUniverse && styles.universeBtnRealActive,
          ]}
        >
          <CalendarClock
            size={14}
            color={isRealUniverse ? "#ffffff" : COLORS.mist}
            strokeWidth={2.3}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.universeBtnText,
              isRealUniverse && { color: "#ffffff" },
            ]}
          >
            Matchs réels
          </Text>
          {history !== null ? (
            <View
              style={[
                styles.universeCountPill,
                isRealUniverse && styles.universeCountPillActive,
              ]}
            >
              <Text
                style={[
                  styles.universeCountText,
                  isRealUniverse && { color: "#ffffff" },
                ]}
              >
                {realHistory.length}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          onPress={() => {
            setSelectedUniverse("virtual");
            setLeagueFilter("all");
          }}
          style={[
            styles.universeBtn,
            !isRealUniverse && styles.universeBtnVirtualActive,
          ]}
        >
          <Cpu
            size={14}
            color={!isRealUniverse ? "#ffffff" : COLORS.mist}
            strokeWidth={2.3}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.universeBtnText,
              !isRealUniverse && { color: "#ffffff" },
            ]}
          >
            Matchs virtuels
          </Text>
          {history !== null ? (
            <View
              style={[
                styles.universeCountPill,
                !isRealUniverse && styles.universeCountPillActive,
              ]}
            >
              <Text
                style={[
                  styles.universeCountText,
                  !isRealUniverse && { color: "#ffffff" },
                ]}
              >
                {virtualHistory.length}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* 2 : Recherche mobile dépliable */}
      <View>
        {mobileSearchOpen || query ? (
          <View style={styles.searchBar}>
            <Search size={16} color={COLORS.dim} strokeWidth={2.1} />
            <TextInput
              ref={searchInputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Rechercher une équipe ou compétition…"
              placeholderTextColor={COLORS.dim}
              style={styles.searchInput}
            />
            <Pressable
              hitSlop={8}
              onPress={() => {
                setQuery("");
                setMobileSearchOpen(false);
              }}
            >
              <X size={16} color={COLORS.dim} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* 3 : Match ciblé depuis un coupon / pari */}
      <View>
        {focusedMatch ? (
          <View style={{ marginTop: 16 }}>
            <View style={styles.focusedHeader}>
              <View style={styles.focusedTitleRow}>
                <History
                  size={14}
                  color={COLORS.betclicRed}
                  strokeWidth={2.3}
                />
                <Text style={styles.focusedTitleText}>MATCH SÉLECTIONNÉ</Text>
              </View>
              <Pressable
                onPress={() => router.replace(`/resultats?universe=${universe}`)}
              >
                <Text style={styles.focusedCloseText}>Fermer</Text>
              </Pressable>
            </View>
            <MatchHistoryCard match={focusedMatch} highlighted />
          </View>
        ) : null}
      </View>

      {/* 4 : Rangée unique collante de 3 pastilles dropdown */}
      <View style={styles.stickyFilterWrap}>
        <FilterDropdownRow
          filters={[
            {
              id: "league",
              placeholder: "Ligue",
              value: effectiveLeague,
              defaultValue: "all",
              onChange: setLeagueFilter,
              options: [
                {
                  value: "all",
                  label: "Toutes ligues",
                  count: history !== null ? searched.length : undefined,
                },
                ...leaguesWithCounts.map(({ league, count }) => ({
                  value: league,
                  label: league,
                  count,
                })),
              ],
            },
            {
              id: "winner",
              placeholder: "Issue 1x2",
              value: winnerFilter,
              defaultValue: "all",
              onChange: setWinnerFilter,
              options: [
                {
                  value: "all",
                  label: "Toutes issues",
                  count: history !== null ? byLeague.length : undefined,
                },
                { value: "V1", label: "V1 (Domicile)", count: v1Count },
                { value: "X", label: "X (Match nul)", count: drawCount },
                { value: "V2", label: "V2 (Extérieur)", count: v2Count },
              ],
            },
            {
              id: "goals",
              placeholder: "Buts",
              value: goalsFilter,
              defaultValue: "all",
              onChange: setGoalsFilter,
              options: [
                {
                  value: "all",
                  label: "Tous scores",
                  count: history !== null ? byWinner.length : undefined,
                },
                {
                  value: "over25",
                  label: "TP 2.5 (3+ buts)",
                  count: over25Count,
                },
                {
                  value: "under25",
                  label: "TM 2.5 (0-2 buts)",
                  count: under25Count,
                },
                { value: "btts", label: "Les 2 marquent", count: bttsCount },
              ],
            },
          ]}
          onReset={() => {
            setLeagueFilter("all");
            setWinnerFilter("all");
            setGoalsFilter("all");
          }}
          resultCountText={
            history !== null
              ? `${visible.length} résultat${visible.length > 1 ? "s" : ""}`
              : null
          }
        />
      </View>

      {/* 5 : Liste groupée par journée */}
      {history === null ? (
        <PulseFlashLoader compact />
      ) : groupedByDay.length === 0 && !focusedMatch ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <Trophy size={20} color={COLORS.dim} strokeWidth={1.9} />
          </View>
          <Text style={styles.emptyTitle}>Aucun match terminé trouvé</Text>
          <Text style={styles.emptySub}>
            Modifiez vos filtres ou revenez dès la fin du match en direct.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 20 }}>
          {groupedByDay.map((group) => (
            <View key={group.day} style={{ gap: 10 }}>
              <Text style={styles.dayHeading}>{group.day}</Text>
              <View style={{ gap: 12 }}>
                {group.items.map((m) => (
                  <MatchHistoryCard key={m.id} match={m} />
                ))}
              </View>
            </View>
          ))}
          <InfiniteScrollLoader hasMore={hasMore} />
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
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  roundBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  roundSearchBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  roundSearchBtnActive: {
    backgroundColor: COLORS.betclicRed,
  },
  universeSwitcher: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 4,
    flexDirection: "row",
    gap: 8,
  },
  universeBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  universeBtnRealActive: {
    backgroundColor: "#059669",
  },
  universeBtnVirtualActive: {
    backgroundColor: COLORS.betclicRed,
  },
  universeBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.mist,
    flexShrink: 1,
  },
  universeCountPill: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  universeCountPillActive: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  universeCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  searchBar: {
    marginTop: 10,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.ink,
    paddingVertical: 0,
  },
  focusedHeader: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  focusedTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  focusedTitleText: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: COLORS.betclicRed,
  },
  focusedCloseText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
  },
  stickyFilterWrap: {
    backgroundColor: COLORS.deep,
  },
  loaderBox: {
    paddingVertical: 48,
    alignItems: "center",
  },
  emptyState: {
    marginTop: 40,
    alignItems: "center",
  },
  emptyCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.ink,
  },
  emptySub: {
    marginTop: 4,
    maxWidth: 260,
    textAlign: "center",
    fontSize: 12.5,
    color: COLORS.mist,
    lineHeight: 18,
  },
  dayHeading: {
    paddingHorizontal: 2,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: COLORS.dim,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 14,
  },
  cardHighlighted: {
    borderWidth: 2,
    borderColor: "rgba(225,0,20,0.55)",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTopLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  leagueText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.mist,
  },
  dotSep: {
    fontSize: 11,
    color: COLORS.dim,
  },
  timeText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.dim,
  },
  cardTopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(225,0,20,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  winnerBadge: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  winnerBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  upcomingBadge: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  upcomingBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.mist,
  },
  teamsBlock: {
    marginTop: 10,
    gap: 6,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  teamName: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "600",
    color: "rgba(17,24,39,0.85)",
  },
  teamNameWinner: {
    fontWeight: "700",
    color: COLORS.ink,
  },
  redCardChip: {
    width: 8,
    height: 10,
    borderRadius: 2,
    backgroundColor: COLORS.betclicRed,
  },
  scoreText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
  scoreTextWinner: {
    fontWeight: "800",
    color: COLORS.ink,
  },
  summaryPillsRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  summaryPill: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  summaryPillText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
});
