import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { ArrowLeft, ChevronRight, Search, X } from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { api, type ClientMatchHistoryItem } from "@/lib/api";
import { getCachedFinishedMatchesList } from "@/lib/entity-cache";
import { formatMatchDateTimeShort } from "@/lib/format";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { deduplicateLeagueNames } from "@/lib/matches-catalog";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

function sortResultsNewestFirst(
  list: ClientMatchHistoryItem[]
): ClientMatchHistoryItem[] {
  return [...list].sort((a, b) => {
    const tA = Date.parse(a.finishedAt || a.startsAt) || 0;
    const tB = Date.parse(b.finishedAt || b.startsAt) || 0;
    return tB - tA || b.id - a.id;
  });
}

function ResultCard({
  item,
  highlighted = false,
}: {
  item: ClientMatchHistoryItem;
  highlighted?: boolean;
}) {
  const router = useRouter();
  const goals = useMemo(
    () =>
      sanitizeMatchEvents(item.events, item.homeScore, item.awayScore).filter(
        (e) => e.type === "goal"
      ),
    [item.awayScore, item.events, item.homeScore]
  );

  return (
    <Pressable
      onPress={() => router.push(`/resultats/${item.id}`)}
      style={[styles.card, highlighted && styles.cardHighlighted]}
    >
      <View style={styles.cardHead}>
        <View style={styles.leagueWrap}>
          <SportIcon sport={item.sport} size={13.5} color={COLORS.dim} />
          <Text numberOfLines={1} style={styles.leagueText}>
            {item.league}
          </Text>
        </View>
        <View style={styles.headRight}>
          <Text style={styles.dateText}>
            {formatMatchDateTimeShort(item.finishedAt || item.startsAt)}
          </Text>
          <View style={styles.finBadge}>
            <Text style={styles.finBadgeText}>Terminé</Text>
          </View>
          <ChevronRight size={14} color={COLORS.dim} strokeWidth={2.2} />
        </View>
      </View>

      <View style={styles.teamsBlock}>
        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar
              name={item.homeTeam}
              logo={item.homeLogo}
              size="sm"
            />
            <Text numberOfLines={1} style={styles.teamName}>
              {item.homeTeam}
            </Text>
          </View>
          <Text
            style={[
              styles.scoreVal,
              item.winnerCode === "V1" && { color: COLORS.win },
            ]}
          >
            {item.homeScore ?? 0}
          </Text>
        </View>

        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar
              name={item.awayTeam}
              logo={item.awayLogo}
              size="sm"
            />
            <Text numberOfLines={1} style={styles.teamName}>
              {item.awayTeam}
            </Text>
          </View>
          <Text
            style={[
              styles.scoreVal,
              item.winnerCode === "V2" && { color: COLORS.win },
            ]}
          >
            {item.awayScore ?? 0}
          </Text>
        </View>
      </View>

      {goals.length > 0 ? (
        <Text numberOfLines={1} style={styles.goalsLine}>
          ⚽{" "}
          {goals
            .map((g) => `${g.minute}'${g.player ? ` ${g.player}` : ""}`)
            .join(" · ")}
        </Text>
      ) : null}

      <View style={styles.chipsRow}>
        {item.winnerCode ? (
          <View style={styles.outcomeChip}>
            <Text style={styles.outcomeChipText}>1X2 : {item.winnerCode}</Text>
          </View>
        ) : null}
        {item.htHome !== null && item.htAway !== null ? (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>
              MT {item.htHome} - {item.htAway}
            </Text>
          </View>
        ) : null}
        {item.totalGoals !== null ? (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>
              {item.totalGoals} but{item.totalGoals > 1 ? "s" : ""}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function ResultatsListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ match?: string; source?: string }>();
  const focusedId = params.match ? Number(params.match) : null;

  const [items, setItems] = useState<ClientMatchHistoryItem[]>(() =>
    sortResultsNewestFirst(getCachedFinishedMatchesList() ?? [])
  );
  const [focusedItem, setFocusedItem] =
    useState<ClientMatchHistoryItem | null>(null);
  const [loading, setLoading] = useState<boolean>(
    () => getCachedFinishedMatchesList() === null
  );
  const [refreshing, setRefreshing] = useState(false);

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "manual" | "virtual"
  >(
    params.source === "virtual"
      ? "virtual"
      : params.source === "manual"
        ? "manual"
        : "all"
  );
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [winnerFilter, setWinnerFilter] = useState<"all" | "V1" | "X" | "V2">(
    "all"
  );

  // Contrainte stricte : requête canonique sans paramètre d'abord (cache CDN Edge), puis ?matchId= si nécessaire
  const load = useCallback(async () => {
    try {
      const canonical = await api.matchHistory();
      const sorted = sortResultsNewestFirst(canonical.matches);
      setItems(sorted);

      if (focusedId && Number.isInteger(focusedId) && focusedId > 0) {
        const inList = sorted.find((m) => m.id === focusedId) ?? null;
        if (inList) {
          setFocusedItem(inList);
        } else {
          const single = await api.matchHistory(focusedId);
          setFocusedItem(single.focusedMatch);
        }
      } else {
        setFocusedItem(null);
      }
    } catch {
      /* garde snapshot */
    } finally {
      setLoading(false);
    }
  }, [focusedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const leagues = useMemo(
    () => deduplicateLeagueNames(items.map((m) => m.league)),
    [items]
  );

  const filtered = useMemo(() => {
    const qNorm = query.trim().toLowerCase();
    const list = items.filter((m) => {
      if (sourceFilter !== "all" && m.source !== sourceFilter) return false;
      if (leagueFilter !== "all" && m.league !== leagueFilter) return false;
      if (winnerFilter !== "all" && m.winnerCode !== winnerFilter) return false;
      if (
        qNorm &&
        !m.homeTeam.toLowerCase().includes(qNorm) &&
        !m.awayTeam.toLowerCase().includes(qNorm) &&
        !m.league.toLowerCase().includes(qNorm)
      ) {
        return false;
      }
      return true;
    });
    return sortResultsNewestFirst(list);
  }, [items, leagueFilter, query, sourceFilter, winnerFilter]);

  const resetKey = `${sourceFilter}|${leagueFilter}|${winnerFilter}|${query}`;
  const { visibleItems, hasMore, onScrollCheck } = useInfiniteBatch(
    filtered,
    10,
    resetKey
  );

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      stickyHeaderIndices={[1]}
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
      <View style={styles.topSection}>
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => router.back("/matchs")}
            style={styles.backBtn}
          >
            <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
          </Pressable>
          <Text style={styles.pageTitle}>Résultats officiels</Text>
        </View>

        <View style={styles.searchBar}>
          <Search size={16} color={COLORS.dim} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un score ou un club…"
            placeholderTextColor={COLORS.dim}
            style={styles.searchInput}
          />
          {query.length > 0 ? (
            <Pressable hitSlop={8} onPress={() => setQuery("")}>
              <X size={16} color={COLORS.dim} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FilterDropdownRow
        filters={[
          {
            id: "source",
            label: "Type de compétition",
            value: sourceFilter,
            defaultValue: "all",
            onChange: setSourceFilter,
            options: [
              { value: "all", label: "Tous les résultats", count: items.length },
              {
                value: "manual",
                label: "Matchs officiels",
                count: items.filter((m) => m.source === "manual").length,
              },
              {
                value: "virtual",
                label: "Matchs virtuels",
                count: items.filter((m) => m.source === "virtual").length,
              },
            ],
          },
          {
            id: "league",
            label: "Ligue",
            value: leagueFilter,
            defaultValue: "all",
            onChange: setLeagueFilter,
            options: [
              { value: "all", label: "Toutes les ligues" },
              ...leagues.map((l) => ({ value: l, label: l })),
            ],
          },
          {
            id: "winner",
            label: "Issue 1X2",
            value: winnerFilter,
            defaultValue: "all",
            onChange: setWinnerFilter,
            options: [
              { value: "all", label: "Toutes issues" },
              { value: "V1", label: "Victoire domicile (V1)" },
              { value: "X", label: "Match nul (X)" },
              { value: "V2", label: "Victoire extérieur (V2)" },
            ],
          },
        ]}
        onReset={() => {
          setSourceFilter("all");
          setLeagueFilter("all");
          setWinnerFilter("all");
          setQuery("");
        }}
      />

      <Text style={styles.countLine}>
        {filtered.length} résultat{filtered.length > 1 ? "s" : ""} (du plus
        récent au plus ancien)
      </Text>

      {focusedItem ? (
        <View style={styles.focusedWrap}>
          <Text style={styles.focusedTitle}>Match sélectionné</Text>
          <ResultCard item={focusedItem} highlighted />
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            Aucun résultat ne correspond à ces filtres.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleItems.map((m) => (
            <ResultCard
              key={m.id}
              item={m}
              highlighted={focusedId === m.id}
            />
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
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
  },
  topSection: {
    gap: 10,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
  pageTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.ink,
  },
  searchBar: {
    height: 40,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "500",
    color: COLORS.ink,
    paddingVertical: 0,
  },
  countLine: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
    marginTop: 4,
    marginBottom: 8,
  },
  focusedWrap: {
    gap: 6,
    marginBottom: 14,
  },
  focusedTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.betclicRed,
    textTransform: "uppercase",
  },
  loader: {
    paddingVertical: 36,
    alignItems: "center",
  },
  list: {
    gap: 10,
  },
  emptyCard: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.dim,
    textAlign: "center",
  },
  card: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 14,
    gap: 9,
  },
  cardHighlighted: {
    borderColor: COLORS.betclicRed,
    borderWidth: 1.5,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leagueWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  leagueText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mist,
    flexShrink: 1,
  },
  headRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dateText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  finBadge: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  finBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.dim,
  },
  teamsBlock: {
    gap: 7,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
  },
  teamName: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.ink,
    flexShrink: 1,
  },
  scoreVal: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  goalsLine: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.dim,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 8,
  },
  outcomeChip: {
    borderRadius: 7,
    backgroundColor: COLORS.winSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  outcomeChipText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.win,
  },
  metaChip: {
    borderRadius: 7,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  metaChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
});
