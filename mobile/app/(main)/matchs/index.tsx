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
import {
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Search,
  Trophy,
  X,
} from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { MatchCard } from "@/components/match-card";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import {
  MobileHeroCarousel,
  type HeroPromoAction,
} from "@/components/mobile-hero-carousel";
import { useApp } from "@/context/app-context";
import type { ClientMatch } from "@/lib/api";
import {
  forceRefreshMobileMatchesFeed,
  useMobileMatchesSlimQuery,
} from "@/lib/party-realtime";
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
      ? screenWidth - 16
      : Math.min(328, Math.round(screenWidth * 0.89));

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
              size={12}
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
  const queryClient = useQueryClient();
  const {
    feedMatches,
    setFeedMatches,
    dataSaverMode,
    openRecharge,
  } = useApp();

  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const matchesQuery = useMobileMatchesSlimQuery({
    dataSaver: dataSaverMode,
    baseIntervalMs: 6_000,
  });

  useEffect(() => {
    if (matchesQuery.data?.matches) {
      setFeedMatches(matchesQuery.data.matches);
    }
  }, [matchesQuery.data, setFeedMatches]);

  const activeMatches = useMemo<ClientMatch[] | null>(() => {
    if (matchesQuery.data?.matches) return matchesQuery.data.matches;
    if (feedMatches !== null) return feedMatches;
    if (matchesQuery.isError) return [];
    return null;
  }, [feedMatches, matchesQuery.data, matchesQuery.isError]);

  const loadError =
    activeMatches !== null &&
    activeMatches.length === 0 &&
    !matchesQuery.data &&
    feedMatches === null &&
    matchesQuery.isError
      ? matchesQuery.error instanceof Error
        ? matchesQuery.error.message
        : "Impossible de charger les rencontres."
      : null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await forceRefreshMobileMatchesFeed(queryClient);
      setFeedMatches(r.matches);
    } catch {
      await matchesQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [matchesQuery, queryClient, setFeedMatches]);

  const realMatchesAll = useMemo(
    () => (activeMatches ?? []).filter((m) => m.source === "manual"),
    [activeMatches]
  );
  const virtualMatchesAll = useMemo(
    () => (activeMatches ?? []).filter((m) => m.source !== "manual"),
    [activeMatches]
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
        router.push("/betslip");
        return;
      }
      if (action.type === "recharge") {
        openRecharge();
      }
    },
    [
      openRecharge,
      realMatchesAll,
      router,
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

      {activeMatches === null ? (
        <PulseFlashLoader compact />
      ) : loadError ? (
        <View style={styles.errorCard}>
          <View style={styles.errorIconCircle}>
            <AlertTriangle size={18} color="#d97706" strokeWidth={2} />
          </View>
          <Text style={styles.errorTitle}>Connexion au serveur interrompue</Text>
          <Text style={styles.errorSub}>{loadError}</Text>
          <Pressable
            onPress={() => void onRefresh()}
            style={({ pressed }) => [
              styles.retryBtn,
              pressed && { opacity: 0.9 },
            ]}
          >
            <RefreshCw size={13} color="#ffffff" strokeWidth={2.2} />
            <Text style={styles.retryBtnText}>Réessayer</Text>
          </Pressable>
        </View>
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
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 24,
  },
  searchBar: {
    marginBottom: 12,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "400",
    color: COLORS.ink,
    paddingVertical: 0,
  },
  loaderBox: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  errorCard: {
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 16,
    alignItems: "center",
  },
  errorIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorTitle: {
    marginTop: 10,
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  errorSub: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 11.5,
    fontWeight: "400",
    color: COLORS.mist,
  },
  retryBtn: {
    marginTop: 12,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#ffffff",
  },
  emptyState: {
    marginTop: 32,
    alignItems: "center",
  },
  emptyCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  emptySub: {
    marginTop: 3,
    maxWidth: 280,
    textAlign: "center",
    fontSize: 11.5,
    fontWeight: "400",
    color: COLORS.dim,
  },
  rowsStack: {
    marginTop: 2,
    gap: 16,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingHorizontal: 2,
  },
  rowTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  seeAllPill: {
    height: 22,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
    paddingLeft: 7.5,
    paddingRight: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 1.5,
  },
  seeAllText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  emptyCarouselBox: {
    marginTop: 6,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.edge,
    backgroundColor: "rgba(255,255,255,0.75)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  emptyCarouselText: {
    fontSize: 11.5,
    fontWeight: "400",
    color: COLORS.mist,
  },
  carouselTrack: {
    marginHorizontal: -8,
    paddingHorizontal: 8,
    marginTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  horizontalSpinnerWrap: {
    width: 56,
    alignItems: "center",
    justifyContent: "center",
  },
});
