import React, { useCallback, useMemo, useState } from "react";
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
import { ArrowLeft, Search, X } from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { MatchCard } from "@/components/match-card";
import { useApp } from "@/context/app-context";
import {
  matchesClubForLeagueSlug,
  matchesSearchAndOdds,
  sortByKickoffAsc,
  type OddsProfileFilter,
} from "@/lib/matches-catalog";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function MatchsVirtuelsScreen() {
  const router = useRouter();
  const { feedMatches, refreshFeedMatches } = useApp();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "upcoming">(
    "all"
  );
  const [clubSlug, setClubSlug] = useState<string>("all");
  const [oddsFilter, setOddsFilter] = useState<OddsProfileFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshFeedMatches();
    setRefreshing(false);
  }, [refreshFeedMatches]);

  const virtualMatches = useMemo(
    () =>
      (feedMatches ?? []).filter(
        (m) => m.source === "virtual" && m.status !== "finished"
      ),
    [feedMatches]
  );

  const filtered = useMemo(() => {
    const qNorm = query.trim().toLowerCase();
    const base = virtualMatches.filter((m) => {
      if (statusFilter === "live" && m.status !== "live") return false;
      if (statusFilter === "upcoming" && m.status !== "upcoming") return false;
      if (
        clubSlug !== "all" &&
        !matchesClubForLeagueSlug(m, clubSlug) &&
        m.league !== clubSlug
      ) {
        return false;
      }
      return matchesSearchAndOdds(m, qNorm, oddsFilter);
    });
    const live = base.filter((m) => m.status === "live");
    const up = sortByKickoffAsc(base.filter((m) => m.status === "upcoming"));
    return [...live, ...up];
  }, [clubSlug, oddsFilter, query, statusFilter, virtualMatches]);

  const resetKey = `${statusFilter}|${clubSlug}|${oddsFilter}|${query}`;
  const { visibleItems, hasMore, onScrollCheck } = useInfiniteBatch(
    filtered,
    10,
    resetKey
  );

  const liveCount = useMemo(
    () => virtualMatches.filter((m) => m.status === "live").length,
    [virtualMatches]
  );
  const upCount = useMemo(
    () => virtualMatches.filter((m) => m.status === "upcoming").length,
    [virtualMatches]
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
            onPress={() => router.push("/matchs")}
            style={styles.backBtn}
          >
            <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.pageTitle}>Matchs virtuels 24h/24</Text>
          </View>
          <Pressable
            onPress={() => router.push("/resultats?source=virtual")}
            style={styles.resultsLink}
          >
            <Text style={styles.resultsLinkText}>Résultats</Text>
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <Search size={16} color={COLORS.dim} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un club virtuel…"
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
            id: "status",
            label: "Statut",
            value: statusFilter,
            defaultValue: "all",
            onChange: setStatusFilter,
            options: [
              {
                value: "all",
                label: "Tous les statuts",
                count: virtualMatches.length,
              },
              { value: "live", label: "En direct", count: liveCount },
              { value: "upcoming", label: "Imminents", count: upCount },
            ],
          },
          {
            id: "clubs",
            label: "Championnat des clubs",
            value: clubSlug,
            defaultValue: "all",
            onChange: setClubSlug,
            options: [
              { value: "all", label: "Toutes les affiches" },
              { value: "esp.1", label: "Clubs LaLiga" },
              { value: "eng.1", label: "Clubs Premier League" },
              { value: "fra.1", label: "Clubs Ligue 1" },
              { value: "ita.1", label: "Clubs Serie A" },
              { value: "ger.1", label: "Clubs Bundesliga" },
            ],
          },
          {
            id: "odds",
            label: "Profil de cote",
            value: oddsFilter,
            defaultValue: "all",
            onChange: setOddsFilter,
            options: [
              { value: "all", label: "Toutes les cotes" },
              { value: "favorite", label: "Favori net (≤ 1,85)" },
              { value: "tight", label: "Match serré (> 1,85)" },
            ],
          },
        ]}
        onReset={() => {
          setStatusFilter("all");
          setClubSlug("all");
          setOddsFilter("all");
          setQuery("");
        }}
      />

      <Text style={styles.countLine}>
        {filtered.length} match{filtered.length > 1 ? "s" : ""} en continu
      </Text>

      {feedMatches === null ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            Aucun match virtuel ne correspond à ces filtres.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleItems.map((m) => (
            <MatchCard key={m.id} match={m} />
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
  resultsLink: {
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.pillDefault,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  resultsLinkText: {
    fontSize: 12,
    fontWeight: "700",
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
});
