import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CalendarClock, ChevronRight, Search, X } from "lucide-react-native";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { MatchCard } from "@/components/match-card";
import {
  MobileHeroCarousel,
  type HeroPromoAction,
} from "@/components/mobile-hero-carousel";
import { useApp } from "@/context/app-context";
import {
  matchesSearchAndOdds,
  sortByKickoffAsc,
  sortRealLiveByPopularity,
  sortRealUpcomingByPopularity,
} from "@/lib/matches-catalog";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function MatchsHomeScreen() {
  const router = useRouter();
  const {
    feedMatches,
    refreshFeedMatches,
    setComboQuickMode,
    openCombo,
    comboLegs,
  } = useApp();

  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const screenWidth = Dimensions.get("window").width;
  const carouselCardWidth = Math.min(336, Math.round(screenWidth * 0.86));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshFeedMatches();
    setRefreshing(false);
  }, [refreshFeedMatches]);

  const handleHeroAction = useCallback(
    (action: HeroPromoAction) => {
      if (action.type === "virtual") {
        router.push("/matchs/virtuels");
      } else if (action.type === "live") {
        router.push("/matchs/tous?status=live");
      } else if (action.type === "league") {
        router.push(
          `/matchs/tous?league=${encodeURIComponent(action.slug)}`
        );
      } else if (action.type === "combo") {
        setComboQuickMode(true);
        if (comboLegs.length > 0) {
          openCombo();
        } else {
          router.push("/betslip");
        }
      }
    },
    [comboLegs.length, openCombo, router, setComboQuickMode]
  );

  const allMatches = feedMatches ?? [];
  const qNorm = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!qNorm) return [];
    const active = allMatches.filter(
      (m) => m.status !== "finished" && matchesSearchAndOdds(m, qNorm, "all")
    );
    const live = active.filter((m) => m.status === "live");
    const up = sortByKickoffAsc(active.filter((m) => m.status === "upcoming"));
    return [...live, ...up];
  }, [allMatches, qNorm]);

  const {
    visibleItems: visibleSearch,
    hasMore: searchHasMore,
    onScrollCheck,
  } = useInfiniteBatch(searchResults, 10, qNorm);

  const realLive = useMemo(
    () =>
      sortRealLiveByPopularity(
        allMatches.filter(
          (m) => m.source === "manual" && m.status === "live"
        )
      ).slice(0, 12),
    [allMatches]
  );

  const virtualLive = useMemo(
    () =>
      allMatches
        .filter((m) => m.source === "virtual" && m.status === "live")
        .slice(0, 10),
    [allMatches]
  );

  const realUpcoming = useMemo(
    () =>
      sortRealUpcomingByPopularity(
        allMatches.filter(
          (m) => m.source === "manual" && m.status === "upcoming"
        )
      ).slice(0, 14),
    [allMatches]
  );

  const virtualUpcoming = useMemo(
    () =>
      sortByKickoffAsc(
        allMatches.filter(
          (m) => m.source === "virtual" && m.status === "upcoming"
        )
      ).slice(0, 10),
    [allMatches]
  );

  const showingRealLive = realLive.length > 0;
  const liveCarouselItems = showingRealLive ? realLive : virtualLive;

  const showingRealUpcoming = realUpcoming.length > 0;
  const upcomingCarouselItems = showingRealUpcoming
    ? realUpcoming
    : virtualUpcoming;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      onScroll={qNorm ? onScrollCheck : undefined}
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
      <MobileHeroCarousel onAction={handleHeroAction} />

      {/* Barre de recherche juste sous le HeroCarousel (sans boutons de filtre) */}
      <View style={styles.searchBar}>
        <Search size={16} color={COLORS.dim} strokeWidth={2.2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher un club ou une ligue…"
          placeholderTextColor={COLORS.dim}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable hitSlop={8} onPress={() => setQuery("")}>
            <X size={16} color={COLORS.dim} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>

      {feedMatches === null ? (
        <View style={styles.initialLoader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : qNorm ? (
        <View style={styles.searchResultsWrap}>
          <Text style={styles.resultCount}>
            {searchResults.length} match
            {searchResults.length > 1 ? "s" : ""} trouvé
            {searchResults.length > 1 ? "s" : ""}
          </Text>
          {visibleSearch.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                Aucun match ne correspond à « {query.trim()} ».
              </Text>
            </View>
          ) : (
            <View style={styles.verticalStack}>
              {visibleSearch.map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
              <InfiniteScrollLoader hasMore={searchHasMore} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.sectionsWrap}>
          {/* Carrousel 1 : Populaire EN DIRECT (ou Matchs virtuels EN DIRECT sans badge ni compteur) */}
          {liveCarouselItems.length > 0 ? (
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <View style={styles.liveDot} />
                  <Text numberOfLines={1} style={styles.sectionTitle}>
                    {showingRealLive
                      ? "Populaire EN DIRECT"
                      : "Matchs virtuels EN DIRECT"}
                  </Text>
                  {showingRealLive ? (
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>
                        {realLive.length}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Pressable
                  onPress={() =>
                    router.push(
                      showingRealLive
                        ? "/matchs/tous?status=live"
                        : "/matchs/virtuels"
                    )
                  }
                  style={styles.seeAllPill}
                >
                  <Text style={styles.seeAllText}>Voir tout</Text>
                  <ChevronRight
                    size={12}
                    color={COLORS.betclicRed}
                    strokeWidth={2.6}
                  />
                </Pressable>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={carouselCardWidth + 12}
                decelerationRate="fast"
                contentContainerStyle={styles.carouselRow}
              >
                {liveCarouselItems.map((m) => (
                  <MatchCard key={m.id} match={m} width={carouselCardWidth} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Carrousel 2 : Populaire en avant-match (sans chevrons < >, avec « Voir tout » -> /matchs/tous) */}
          {upcomingCarouselItems.length > 0 ? (
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <CalendarClock
                    size={16}
                    color={COLORS.betclicRed}
                    strokeWidth={2.3}
                  />
                  <Text numberOfLines={1} style={styles.sectionTitle}>
                    Populaire en avant-match
                  </Text>
                </View>

                <Pressable
                  onPress={() =>
                    router.push(
                      showingRealUpcoming ? "/matchs/tous" : "/matchs/virtuels"
                    )
                  }
                  style={styles.seeAllPill}
                >
                  <Text style={styles.seeAllText}>Voir tout</Text>
                  <ChevronRight
                    size={12}
                    color={COLORS.betclicRed}
                    strokeWidth={2.6}
                  />
                </Pressable>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={carouselCardWidth + 12}
                decelerationRate="fast"
                contentContainerStyle={styles.carouselRow}
              >
                {upcomingCarouselItems.map((m) => (
                  <MatchCard key={m.id} match={m} width={carouselCardWidth} />
                ))}
              </ScrollView>
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
    paddingBottom: 22,
    gap: 6,
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
  initialLoader: {
    paddingVertical: 40,
    alignItems: "center",
  },
  sectionsWrap: {
    marginTop: 8,
    gap: 18,
  },
  sectionBlock: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flex: 1,
    minWidth: 0,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.betclicRed,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  countBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 7,
    paddingVertical: 1.5,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  seeAllPill: {
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  seeAllText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  carouselRow: {
    gap: 12,
    paddingRight: 4,
  },
  searchResultsWrap: {
    marginTop: 8,
    gap: 8,
  },
  resultCount: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
  },
  verticalStack: {
    gap: 10,
  },
  emptyBox: {
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
