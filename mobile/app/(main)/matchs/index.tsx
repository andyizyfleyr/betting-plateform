import React, { useMemo, useState } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, Search, X } from "lucide-react-native";
import { MobileHeroCarousel } from "@/components/mobile-hero-carousel";
import { MatchCard } from "@/components/match-card";
import { BareInfiniteSpinner } from "@/components/infinite-scroll-loader";
import {
  sortByKickoffAsc,
  sortRealLiveByPopularity,
  sortRealUpcomingByPopularity,
} from "@/lib/matches-catalog";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page d'accueil mobile `/matchs` fidèle à `src/app/(main)/matchs/page.tsx` :
 * - `<MobileHeroCarousel />` + barre de recherche juste en dessous
 * - Carrousel horizontal EN DIRECT (`Populaire EN DIRECT` ou repli `Matchs virtuels EN DIRECT`, sans badge « Virtuels » ni compteur N, avec `Voir tout`)
 * - Carrousel horizontal `Populaire en avant-match` sans chevrons `<`/`>`, trié par date/heure croissante, avec `Voir tout` -> `/matchs/tous`.
 */
export default function MatchsHomeScreen() {
  const router = useRouter();
  const { feedMatches, refreshFeedMatches, hapticsEnabled } = useApp();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const screenWidth = Dimensions.get("window").width;
  const cardWidth = Math.min(342, Math.max(286, Math.round(screenWidth * 0.85)));

  const qNorm = search.trim().toLowerCase();

  const {
    liveCarousel,
    liveIsVirtualFallback,
    preMatchCarousel,
    preMatchIsVirtualFallback,
    searchResults,
  } = useMemo(() => {
    const all = feedMatches ?? [];
    const realLive = sortRealLiveByPopularity(
      all.filter((m) => m.source === "manual" && m.status === "live")
    );
    const virtualLive = all.filter(
      (m) => m.source !== "manual" && m.status === "live"
    );
    const realUpcoming = sortRealUpcomingByPopularity(
      all.filter((m) => m.source === "manual" && m.status === "upcoming")
    );
    const virtualUpcoming = sortByKickoffAsc(
      all.filter((m) => m.source !== "manual" && m.status === "upcoming")
    );

    const searched = qNorm
      ? all.filter(
          (m) =>
            m.status !== "finished" &&
            (m.homeTeam.toLowerCase().includes(qNorm) ||
              m.awayTeam.toLowerCase().includes(qNorm) ||
              m.league.toLowerCase().includes(qNorm))
        )
      : [];

    return {
      liveCarousel: realLive.length > 0 ? realLive.slice(0, 8) : virtualLive.slice(0, 8),
      liveIsVirtualFallback: realLive.length === 0,
      preMatchCarousel:
        realUpcoming.length > 0
          ? realUpcoming.slice(0, 10)
          : virtualUpcoming.slice(0, 10),
      preMatchIsVirtualFallback: realUpcoming.length === 0,
      searchResults: searched,
    };
  }, [feedMatches, qNorm]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshFeedMatches();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.betclicRed}
          colors={[colors.betclicRed]}
        />
      }
      keyboardShouldPersistTaps="handled"
    >
      <MobileHeroCarousel />

      {/* Barre de recherche sous le carrousel */}
      <View style={styles.searchBox}>
        <Search size={16} color={colors.dim} strokeWidth={2.2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher un club ou une compétition…"
          placeholderTextColor={colors.dim}
          style={styles.searchInput}
        />
        {search.length > 0 && (
          <Pressable
            onPress={() => setSearch("")}
            hitSlop={8}
            style={styles.clearBtn}
          >
            <X size={15} color={colors.dim} strokeWidth={2.4} />
          </Pressable>
        )}
      </View>

      {!feedMatches ? (
        <BareInfiniteSpinner visible />
      ) : qNorm ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Résultats ({searchResults.length})
            </Text>
          </View>
          {searchResults.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Aucun match trouvé pour « {search.trim()} ».
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {searchResults.slice(0, 20).map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
            </View>
          )}
        </View>
      ) : (
        <>
          {/* Section 1 : EN DIRECT */}
          {liveCarousel.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.titleRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.sectionTitle}>
                    {liveIsVirtualFallback
                      ? "Matchs virtuels EN DIRECT"
                      : "Populaire EN DIRECT"}
                  </Text>
                </View>

                <Pressable
                  onPress={() => {
                    triggerHaptic("light", hapticsEnabled);
                    router.push(
                      liveIsVirtualFallback
                        ? "/matchs/virtuels"
                        : "/matchs/tous?status=live"
                    );
                  }}
                  style={styles.seeAllBtn}
                >
                  <Text style={styles.seeAllText}>Voir tout</Text>
                  <ChevronRight
                    size={14}
                    color={colors.betclicRed}
                    strokeWidth={2.6}
                  />
                </Pressable>
              </View>

              <FlatList
                data={liveCarousel}
                keyExtractor={(item) => String(item.id)}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={cardWidth + 10}
                decelerationRate="fast"
                contentContainerStyle={{ gap: 10 }}
                renderItem={({ item }) => (
                  <MatchCard match={item} width={cardWidth} />
                )}
              />
            </View>
          )}

          {/* Section 2 : Populaire en avant-match (sans chevrons < / >) */}
          {preMatchCarousel.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  Populaire en avant-match
                </Text>

                <Pressable
                  onPress={() => {
                    triggerHaptic("light", hapticsEnabled);
                    router.push(
                      preMatchIsVirtualFallback
                        ? "/matchs/virtuels"
                        : "/matchs/tous"
                    );
                  }}
                  style={styles.seeAllBtn}
                >
                  <Text style={styles.seeAllText}>Voir tout</Text>
                  <ChevronRight
                    size={14}
                    color={colors.betclicRed}
                    strokeWidth={2.6}
                  />
                </Pressable>
              </View>

              <FlatList
                data={preMatchCarousel}
                keyExtractor={(item) => String(item.id)}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={cardWidth + 10}
                decelerationRate="fast"
                contentContainerStyle={{ gap: 10 }}
                renderItem={({ item, index }) => (
                  <MatchCard
                    match={item}
                    nextUp={preMatchIsVirtualFallback && index === 0}
                    width={cardWidth}
                  />
                )}
              />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 14,
  },
  searchBox: {
    height: 42,
    borderRadius: 13,
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
  clearBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.betclicRed,
  },
  sectionTitle: {
    fontSize: 15.5,
    fontWeight: "900",
    color: colors.ink,
    letterSpacing: -0.2,
  },
  seeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  emptyCard: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 13,
    color: colors.mist,
    fontWeight: "600",
  },
});
