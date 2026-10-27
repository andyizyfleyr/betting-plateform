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
import { ArrowLeft, Search, X } from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { MatchCard } from "@/components/match-card";
import { useApp } from "@/context/app-context";
import {
  deduplicateLeagueNames,
  matchesLeagueChoice,
  matchesSearchAndOdds,
  sortRealLiveByPopularity,
  sortRealUpcomingByPopularity,
  type OddsProfileFilter,
} from "@/lib/matches-catalog";
import {
  OFFICIAL_SOCCER_LEAGUES,
  resolveEspnSlugForLeague,
} from "@/lib/real-leagues";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function TousMatchsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; league?: string }>();
  const { feedMatches, refreshFeedMatches } = useApp();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "upcoming">(
    params.status === "live"
      ? "live"
      : params.status === "upcoming"
        ? "upcoming"
        : "all"
  );
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [oddsFilter, setOddsFilter] = useState<OddsProfileFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const realMatches = useMemo(
    () =>
      (feedMatches ?? []).filter(
        (m) => m.source === "manual" && m.status !== "finished"
      ),
    [feedMatches]
  );

  const leagueNames = useMemo(
    () => deduplicateLeagueNames(realMatches.map((m) => m.league)),
    [realMatches]
  );

  useEffect(() => {
    if (!params.league) return;
    const raw = params.league;
    const matchBySlug = leagueNames.find(
      (lg) => resolveEspnSlugForLeague(lg) === raw
    );
    if (matchBySlug) {
      setLeagueFilter(matchBySlug);
      return;
    }
    const official = OFFICIAL_SOCCER_LEAGUES.find((o) => o.slug === raw);
    if (official) setLeagueFilter(official.label);
  }, [leagueNames, params.league]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshFeedMatches();
    setRefreshing(false);
  }, [refreshFeedMatches]);

  const selectedSlug = useMemo(
    () =>
      leagueFilter === "all" ? null : resolveEspnSlugForLeague(leagueFilter),
    [leagueFilter]
  );

  const filteredMatches = useMemo(() => {
    const qNorm = query.trim().toLowerCase();
    const base = realMatches.filter((m) => {
      if (statusFilter === "live" && m.status !== "live") return false;
      if (statusFilter === "upcoming" && m.status !== "upcoming") return false;
      if (!matchesLeagueChoice(m, leagueFilter, selectedSlug)) return false;
      return matchesSearchAndOdds(m, qNorm, oddsFilter);
    });
    const live = sortRealLiveByPopularity(
      base.filter((m) => m.status === "live")
    );
    const upcoming = sortRealUpcomingByPopularity(
      base.filter((m) => m.status === "upcoming")
    );
    return [...live, ...upcoming];
  }, [leagueFilter, oddsFilter, query, realMatches, selectedSlug, statusFilter]);

  const resetKey = `${statusFilter}|${leagueFilter}|${oddsFilter}|${query}`;
  const { visibleItems, hasMore, onScrollCheck } = useInfiniteBatch(
    filteredMatches,
    10,
    resetKey
  );

  const liveCount = useMemo(
    () => realMatches.filter((m) => m.status === "live").length,
    [realMatches]
  );
  const upCount = useMemo(
    () => realMatches.filter((m) => m.status === "upcoming").length,
    [realMatches]
  );

  const leagueOptions = useMemo(() => {
    const opts = [
      { value: "all", label: "Toutes les ligues", count: realMatches.length },
    ];
    for (const lg of leagueNames) {
      const slug = resolveEspnSlugForLeague(lg);
      const count = realMatches.filter((m) =>
        matchesLeagueChoice(m, lg, slug)
      ).length;
      opts.push({ value: lg, label: lg, count });
    }
    if (
      leagueFilter !== "all" &&
      !opts.some((o) => o.value === leagueFilter)
    ) {
      opts.push({ value: leagueFilter, label: leagueFilter, count: 0 });
    }
    return opts;
  }, [leagueFilter, leagueNames, realMatches]);

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
      {/* En-tête + recherche */}
      <View style={styles.topSection}>
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => router.push("/matchs")}
            style={styles.backBtn}
          >
            <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
          </Pressable>
          <Text style={styles.pageTitle}>Tous les matchs</Text>
          <Pressable
            onPress={() => router.push("/resultats")}
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
            placeholder="Club ou compétition officielle…"
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

      {/* Barre sticky de filtres 40 px */}
      <FilterDropdownRow
        filters={[
          {
            id: "status",
            label: "Statut du match",
            value: statusFilter,
            defaultValue: "all",
            onChange: setStatusFilter,
            options: [
              { value: "all", label: "Tous les statuts", count: realMatches.length },
              { value: "live", label: "En direct", count: liveCount },
              { value: "upcoming", label: "À venir", count: upCount },
            ],
          },
          {
            id: "league",
            label: "Compétition",
            value: leagueFilter,
            defaultValue: "all",
            onChange: setLeagueFilter,
            options: leagueOptions,
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
          setLeagueFilter("all");
          setOddsFilter("all");
          setQuery("");
        }}
      />

      <Text style={styles.countLine}>
        {filteredMatches.length} match
        {filteredMatches.length > 1 ? "s" : ""} officiel
        {filteredMatches.length > 1 ? "s" : ""}
      </Text>

      {feedMatches === null ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Aucun match officiel trouvé</Text>
          <Text style={styles.emptyDesc}>
            Modifiez vos filtres ou consultez les matchs virtuels 24h/24.
          </Text>
          <Pressable
            onPress={() => router.push("/matchs/virtuels")}
            style={styles.virtualBtn}
          >
            <Text style={styles.virtualBtnText}>Voir les virtuels 24h/24</Text>
          </Pressable>
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
    flex: 1,
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
    padding: 22,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  emptyDesc: {
    fontSize: 12.5,
    color: COLORS.dim,
    textAlign: "center",
  },
  virtualBtn: {
    marginTop: 4,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  virtualBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
});
