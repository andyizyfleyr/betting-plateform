import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { ChevronRight, Search, Trophy, X } from "lucide-react-native";
import { MatchCard } from "@/components/match-card";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import {
  MobileHeroCarousel,
  type HeroPromoAction,
} from "@/components/mobile-hero-carousel";
import { useApp } from "@/context/app-context";
import type { ClientMatch } from "@/lib/api";
import {
  matchesSearchAndOdds,
  sortByKickoffAsc,
  sortRealLiveByPopularity,
  sortRealUpcomingByPopularity,
} from "@/lib/matches-catalog";
import { resolveRealLeagueBySlug } from "@/lib/real-leagues";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const INITIAL_CAROUSEL_WINDOW = 10;
const CAROUSEL_WINDOW_STEP = 10;

function RealMatchCarouselRow({
  label,
  items,
  resetKey,
  live,
  virtualFallback,
  markFirstAsNextUp,
  trailingHref,
  trailingLabel,
  emptyMessage,
}: {
  label: string;
  items: ClientMatch[];
  resetKey: string;
  live?: boolean;
  virtualFallback?: boolean;
  markFirstAsNextUp?: boolean;
  trailingHref?: string;
  trailingLabel?: string;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [limit, setLimit] = useState(INITIAL_CAROUSEL_WINDOW);
  const [prevKey, setPrevKey] = useState(resetKey);

  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setLimit(INITIAL_CAROUSEL_WINDOW);
  }

  const screenWidth = Dimensions.get("window").width;
  const cardWidth =
    items.length === 1
      ? screenWidth - 32
      : Math.min(336, Math.round(screenWidth * 0.86));

  const visibleItems = useMemo(
    () => (items.length <= limit ? items : items.slice(0, limit)),
    [items, limit]
  );
  const hasMore = limit < items.length;

  const onHorizontalScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasMore) return;
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      if (contentSize.width - (layoutMeasurement.width + contentOffset.x) < 420) {
        setLimit((prev) => Math.min(items.length, prev + CAROUSEL_WINDOW_STEP));
      }
    },
    [hasMore, items.length]
  );

  return (
    <View>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleWrap}>
          {live ? (
            <View
              style={[
                styles.liveDot,
                {
                  backgroundColor: virtualFallback
                    ? COLORS.betclicRed
                    : "#059669",
                },
              ]}
            />
          ) : null}
          <Text numberOfLines={1} style={styles.rowTitle}>
            {label}
          </Text>
        </View>

        {trailingHref && trailingLabel ? (
          <Pressable
            onPress={() => router.push(trailingHref)}
            style={({ pressed }) => [
              styles.seeAllPill,
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
          >
            <Text style={styles.seeAllText}>{trailingLabel}</Text>
            <ChevronRight
              size={14}
              color={COLORS.betclicRed}
              strokeWidth={2.5}
            />
          </Pressable>
        ) : null}
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyCarouselBox}>
          <Text style={styles.emptyCarouselText}>
            {emptyMessage ?? "Aucun match disponible"}
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={items.length > 1 ? cardWidth + 12 : undefined}
          decelerationRate="fast"
          onScroll={onHorizontalScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.carouselTrack}
        >
          {visibleItems.map((m, idx) => (
            <MatchCard
              key={m.id}
              match={m}
              nextUp={Boolean(markFirstAsNextUp && idx === 0)}
              width={cardWidth}
            />
          ))}
          {hasMore ? (
            <View style={styles.horizontalSpinnerWrap}>
              <ActivityIndicator size="small" color={COLORS.betclicRed} />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

export default function MatchsHomeScreen() {
  const router = useRouter();
  const {
    feedMatches,
    refreshFeedMatches,
    setComboQuickMode,
    openCombo,
    openRecharge,
    comboLegs,
    toast,
  } = useApp();

  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void refreshFeedMatches();
  }, [refreshFeedMatches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshFeedMatches();
    setRefreshing(false);
  }, [refreshFeedMatches]);

  const realMatchesAll = useMemo(
    () => (feedMatches ?? []).filter((m) => m.source === "manual"),
    [feedMatches]
  );
  const virtualMatchesAll = useMemo(
    () => (feedMatches ?? []).filter((m) => m.source !== "manual"),
    [feedMatches]
  );

  const handleHeroAction = useCallback(
    (action: HeroPromoAction) => {
      if (action.type === "virtual") {
        router.push("/matchs/virtuels");
        return;
      }
      if (action.type === "live") {
        router.push("/matchs/tous?status=live");
        return;
      }
      if (action.type === "league") {
        const availableRealLeagues = Array.from(
          new Set(realMatchesAll.map((m) => m.league))
        );
        const matched = resolveRealLeagueBySlug(
          availableRealLeagues,
          action.slug
        );
        const target = matched ?? action.defaultLabel;
        router.push(`/matchs/tous?league=${encodeURIComponent(target)}`);
        return;
      }
      if (action.type === "combo") {
        setComboQuickMode(true);
        if (comboLegs.length > 0) {
          openCombo();
        } else {
          toast({
            kind: "info",
            title: "Mode Combiné activé",
            description:
              "Touchez vos cotes préférées pour composer votre combiné.",
          });
        }
        return;
      }
      if (action.type === "recharge") {
        openRecharge();
      }
    },
    [
      comboLegs.length,
      openCombo,
      openRecharge,
      realMatchesAll,
      router,
      setComboQuickMode,
      toast,
    ]
  );

  const mobileRows = useMemo(() => {
    const q = query.trim().toLowerCase();

    const realMatching = realMatchesAll.filter(
      (m) => m.status !== "finished" && matchesSearchAndOdds(m, q, "all")
    );
    const virtualMatching = virtualMatchesAll.filter(
      (m) => m.status !== "finished" && matchesSearchAndOdds(m, q, "all")
    );

    const realLive = sortRealLiveByPopularity(
      realMatching.filter((m) => m.status === "live")
    );
    const realUpcoming = sortRealUpcomingByPopularity(
      realMatching.filter((m) => m.status === "upcoming")
    );

    const vLive = [...virtualMatching.filter((m) => m.status === "live")].sort(
      (a, b) =>
        new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime() ||
        a.id - b.id
    );
    const vUpcoming = sortByKickoffAsc(
      virtualMatching.filter((m) => m.status === "upcoming")
    );
    const virtualAllActive = [...vLive, ...vUpcoming];

    const liveRowUsesVirtual = realLive.length === 0;
    const liveRowItems = liveRowUsesVirtual
      ? vLive.length > 0
        ? vLive
        : virtualAllActive
      : realLive;

    const upcomingRowUsesVirtual = realUpcoming.length === 0;
    const upcomingRowItems = upcomingRowUsesVirtual ? vUpcoming : realUpcoming;

    return {
      liveRowItems,
      liveRowUsesVirtual,
      upcomingRowItems,
      upcomingRowUsesVirtual,
      hasAny: liveRowItems.length > 0 || upcomingRowItems.length > 0,
    };
  }, [realMatchesAll, virtualMatchesAll, query]);

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
      {/* Hero publicitaire mobile */}
      <MobileHeroCarousel onAction={handleHeroAction} />

      {/* Barre de recherche juste sous MobileHeroCarousel */}
      <View style={styles.searchBar}>
        <Search size={16} color={COLORS.dim} strokeWidth={2.1} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher un match, un club ou une ligue…"
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
        <PulseFlashLoader compact />
      ) : !mobileRows.hasAny ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <Trophy size={20} color={COLORS.dim} strokeWidth={1.9} />
          </View>
          <Text style={styles.emptyTitle}>Aucun match trouvé</Text>
          <Text style={styles.emptySub}>
            Effacez la recherche pour retrouver toutes les rencontres.
          </Text>
        </View>
      ) : (
        <View style={styles.rowsStack}>
          {mobileRows.liveRowItems.length > 0 ? (
            <RealMatchCarouselRow
              label={
                mobileRows.liveRowUsesVirtual
                  ? "Matchs virtuels EN DIRECT"
                  : "Populaire EN DIRECT"
              }
              items={mobileRows.liveRowItems}
              resetKey={`live|${query.trim().toLowerCase()}|${
                mobileRows.liveRowUsesVirtual ? "v" : "r"
              }`}
              live
              virtualFallback={mobileRows.liveRowUsesVirtual}
              trailingHref={
                mobileRows.liveRowUsesVirtual
                  ? "/matchs/virtuels"
                  : "/matchs/tous?status=live"
              }
              trailingLabel="Voir tout"
              emptyMessage="Aucun match en direct pour le moment"
            />
          ) : null}

          <RealMatchCarouselRow
            label="Populaire en avant-match"
            items={mobileRows.upcomingRowItems}
            resetKey={`upcoming|${query.trim().toLowerCase()}|${
              mobileRows.upcomingRowUsesVirtual ? "v" : "r"
            }`}
            virtualFallback={mobileRows.upcomingRowUsesVirtual}
            markFirstAsNextUp={mobileRows.upcomingRowUsesVirtual}
            trailingHref={
              mobileRows.upcomingRowUsesVirtual
                ? "/matchs/virtuels"
                : "/matchs/tous"
            }
            trailingLabel="Voir tout"
            emptyMessage="Aucun match en avant-match dans cette sélection"
          />
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
    paddingTop: 10,
    paddingBottom: 28,
  },
  searchBar: {
    marginBottom: 14,
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
  loaderBox: {
    paddingVertical: 48,
    alignItems: "center",
    justifyContent: "center",
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
    maxWidth: 290,
    textAlign: "center",
    fontSize: 12.5,
    color: COLORS.dim,
  },
  rowsStack: {
    marginTop: 4,
    gap: 20,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 2,
  },
  rowTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  seeAllPill: {
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingLeft: 10,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  emptyCarouselBox: {
    marginTop: 8,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.edge,
    backgroundColor: "rgba(255,255,255,0.75)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  emptyCarouselText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.mist,
  },
  carouselTrack: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
    marginTop: 10,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  horizontalSpinnerWrap: {
    width: 64,
    alignItems: "center",
    justifyContent: "center",
  },
});
