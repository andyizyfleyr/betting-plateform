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
import { useRouter } from "expo-router";
import { ArrowLeft, Search, X } from "lucide-react-native";
import { MatchCard } from "@/components/match-card";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  BareInfiniteSpinner,
  INFINITE_BATCH_STEP,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import {
  matchesClubForLeagueSlug,
  matchesSearchAndOdds,
  sortByKickoffAsc,
  type MatchStatusFilter,
  type OddsProfileFilter,
} from "@/lib/matches-catalog";
import type { ClientMatch } from "@/lib/api";
import { colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page `/matchs/virtuels` : Multiplex EN DIRECT (4 matchs simultanés décalés) + Prochains départs
 * triés par coup d'envoi le plus proche d'abord.
 */
export default function MatchsVirtuelsScreen() {
  const router = useRouter();
  const { feedMatches, refreshFeedMatches } = useApp();

  const [statusFilter, setStatusFilter] = useState<MatchStatusFilter>("all");
  const [clubSlug, setClubSlug] = useState<string>("all");
  const [oddsProfile, setOddsProfile] = useState<OddsProfileFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const qNorm = search.trim().toLowerCase();

  const { ordered, firstUpcomingId } = useMemo(() => {
    const virt = (feedMatches ?? []).filter(
      (m) => m.source !== "manual" && m.status !== "finished"
    );
    const filtered = virt.filter(
      (m) =>
        (clubSlug === "all" || matchesClubForLeagueSlug(m, clubSlug)) &&
        matchesSearchAndOdds(m, qNorm, oddsProfile)
    );
    const live = filtered.filter((m) => m.status === "live");
    const upcoming = sortByKickoffAsc(
      filtered.filter((m) => m.status === "upcoming")
    );
    const list =
      statusFilter === "live"
        ? live
        : statusFilter === "upcoming"
          ? upcoming
          : [...live, ...upcoming];
    return {
      ordered: list,
      firstUpcomingId: upcoming[0]?.id ?? null,
    };
  }, [clubSlug, feedMatches, oddsProfile, qNorm, statusFilter]);

  const resetKey = `${statusFilter}|${clubSlug}|${oddsProfile}|${qNorm}`;
  const { visibleCount, hasMore, loadMore } = useInfiniteBatch(
    ordered.length,
    resetKey,
    INFINITE_BATCH_STEP
  );

  const visibleItems = useMemo(
    () => ordered.slice(0, visibleCount),
    [ordered, visibleCount]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshFeedMatches();
    setRefreshing(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.topHeader}>
        <View style={styles.leftRow}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
          <Text style={styles.pageTitle}>Matchs virtuels</Text>
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
            placeholder="Rechercher un club virtuel…"
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
                { value: "all", label: "Direct + Prochains" },
                { value: "live", label: "Multiplex EN DIRECT" },
                { value: "upcoming", label: "Prochains départs" },
              ],
              onChange: (v) => setStatusFilter(v as MatchStatusFilter),
            },
            {
              id: "clubs",
              label: "Championnat",
              value: clubSlug,
              options: [
                { value: "all", label: "Tous les clubs" },
                { value: "eng.1", label: "Clubs anglais" },
                { value: "esp.1", label: "Clubs espagnols" },
                { value: "fra.1", label: "Clubs français" },
                { value: "ita.1", label: "Clubs italiens" },
                { value: "ger.1", label: "Clubs allemands" },
              ],
              onChange: setClubSlug,
            },
            {
              id: "odds",
              label: "Cotes",
              value: oddsProfile,
              options: [
                { value: "all", label: "Tous profils" },
                { value: "favorite", label: "Favoris nets" },
                { value: "tight", label: "Affiches serrées" },
              ],
              onChange: (v) => setOddsProfile(v as OddsProfileFilter),
            },
          ]}
          onReset={() => {
            setStatusFilter("all");
            setClubSlug("all");
            setOddsProfile("all");
            setSearch("");
          }}
          resultCountLabel={`${ordered.length} match${ordered.length > 1 ? "s" : ""} virtuel${ordered.length > 1 ? "s" : ""}`}
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
                Aucun match virtuel pour cette sélection.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <MatchCard match={item} nextUp={item.id === firstUpcomingId} />
        )}
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
  },
  emptyText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.mist,
  },
});
