import React, { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Search, X } from "lucide-react-native";
import { MatchCard } from "@/components/match-card";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  BareInfiniteSpinner,
  INFINITE_BATCH_STEP,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import {
  deduplicateLeagueNames,
  matchesLeagueChoice,
  matchesSearchAndOdds,
  resolveEspnSlugForLeague,
  sortRealLiveByPopularity,
  sortRealUpcomingByPopularity,
  type MatchStatusFilter,
  type OddsProfileFilter,
} from "@/lib/matches-catalog";
import type { ClientMatch } from "@/lib/api";
import { colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page `/matchs/tous` : Tous les matchs réels avec `FilterDropdownRow` sticky `40 px`,
 * tri chronologique croissant (date et heure les plus proches d'abord) et infinite scroll 10 par 10.
 */
export default function TousLesMatchsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; league?: string }>();
  const { feedMatches, refreshFeedMatches } = useApp();

  const [statusFilter, setStatusFilter] = useState<MatchStatusFilter>(
    params.status === "live" || params.status === "upcoming"
      ? params.status
      : "all"
  );
  const [leagueFilter, setLeagueFilter] = useState<string>(
    params.league || "all"
  );
  const [oddsProfile, setOddsProfile] = useState<OddsProfileFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const realMatches = useMemo(
    () =>
      (feedMatches ?? []).filter(
        (m) => m.source === "manual" && m.status !== "finished"
      ),
    [feedMatches]
  );

  const leagues = useMemo(
    () => deduplicateLeagueNames(realMatches.map((m) => m.league)),
    [realMatches]
  );

  const selectedSlug = useMemo(
    () => (leagueFilter === "all" ? null : resolveEspnSlugForLeague(leagueFilter)),
    [leagueFilter]
  );

  const qNorm = search.trim().toLowerCase();

  const orderedMatches = useMemo(() => {
    const base = realMatches.filter(
      (m) =>
        matchesLeagueChoice(m, leagueFilter, selectedSlug) &&
        matchesSearchAndOdds(m, qNorm, oddsProfile)
    );
    const live = sortRealLiveByPopularity(
      base.filter((m) => m.status === "live")
    );
    const upcoming = sortRealUpcomingByPopularity(
      base.filter((m) => m.status === "upcoming")
    );
    if (statusFilter === "live") return live;
    if (statusFilter === "upcoming") return upcoming;
    return [...live, ...upcoming];
  }, [leagueFilter, oddsProfile, qNorm, realMatches, selectedSlug, statusFilter]);

  const resetKey = `${statusFilter}|${leagueFilter}|${oddsProfile}|${qNorm}`;
  const { visibleCount, hasMore, loadMore } = useInfiniteBatch(
    orderedMatches.length,
    resetKey,
    INFINITE_BATCH_STEP
  );

  const visibleItems = useMemo(
    () => orderedMatches.slice(0, visibleCount),
    [orderedMatches, visibleCount]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshFeedMatches();
    setRefreshing(false);
  };

  return (
    <View style={styles.root}>
      {/* En-tête compact */}
      <View style={styles.topHeader}>
        <View style={styles.leftRow}>
          <Pressable
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
          <Text style={styles.pageTitle}>Tous les matchs</Text>
        </View>
        <Pressable
          onPress={() => setSearchOpen((v) => !v)}
          style={styles.iconBtn}
        >
          {searchOpen ? (
            <X size={17} color={colors.ink} strokeWidth={2.4} />
          ) : (
            <Search size={17} color={colors.ink} strokeWidth={2.4} />
          )}
        </Pressable>
      </View>

      {searchOpen && (
        <View style={styles.searchWrap}>
          <Search size={15} color={colors.dim} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            autoFocus
            placeholder="Club ou compétition…"
            placeholderTextColor={colors.dim}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <X size={15} color={colors.dim} />
            </Pressable>
          )}
        </View>
      )}

      <View style={{ paddingHorizontal: 16 }}>
        <FilterDropdownRow
          filters={[
            {
              id: "status",
              label: "Statut",
              value: statusFilter,
              options: [
                { value: "all", label: "Tous les statuts" },
                { value: "live", label: "En direct" },
                { value: "upcoming", label: "À venir" },
              ],
              onChange: (v) => setStatusFilter(v as MatchStatusFilter),
            },
            {
              id: "league",
              label: "Compétition",
              value: leagueFilter,
              options: [
                { value: "all", label: "Toutes les ligues" },
                ...leagues.map((lg) => ({ value: lg, label: lg })),
              ],
              onChange: setLeagueFilter,
            },
            {
              id: "odds",
              label: "Cotes",
              value: oddsProfile,
              options: [
                { value: "all", label: "Tous profils" },
                { value: "favorite", label: "Favoris nets (≤ 1,85)" },
                { value: "tight", label: "Chocs équilibrés" },
              ],
              onChange: (v) => setOddsProfile(v as OddsProfileFilter),
            },
          ]}
          onReset={() => {
            setStatusFilter("all");
            setLeagueFilter("all");
            setOddsProfile("all");
            setSearch("");
          }}
          resultCountLabel={`${orderedMatches.length} match${orderedMatches.length > 1 ? "s" : ""}`}
        />
      </View>

      <FlatList<ClientMatch>
        data={visibleItems}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        windowSize={7}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.betclicRed}
            colors={[colors.betclicRed]}
          />
        }
        ListEmptyComponent={
          !feedMatches ? (
            <BareInfiniteSpinner visible />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Aucun match officiel ne correspond à ces filtres.
              </Text>
              <Pressable
                onPress={() => router.push("/matchs/virtuels")}
                style={styles.virtLinkBtn}
              >
                <Text style={styles.virtLinkText}>
                  Voir les matchs virtuels EN DIRECT
                </Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => <MatchCard match={item} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListFooterComponent={<BareInfiniteSpinner visible={hasMore} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  leftRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.ink,
    letterSpacing: -0.3,
  },
  searchWrap: {
    marginHorizontal: 16,
    marginBottom: 6,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    color: colors.ink,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  emptyCard: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.mist,
    textAlign: "center",
  },
  virtLinkBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.betclicRed,
  },
  virtLinkText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.white,
  },
});
