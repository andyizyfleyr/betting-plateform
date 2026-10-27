import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { ChevronRight, Search, X } from "@/components/icons";
import { api, type ClientFinishedMatch } from "@/lib/api";
import { getCachedFinishedMatchesList } from "@/lib/entity-cache";
import { formatPlacedAt } from "@/lib/format";
import { deduplicateLeagueNames } from "@/lib/matches-catalog";
import { useSmartPolling } from "@/lib/polling";
import { TeamAvatar } from "@/components/team-avatar";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  BareInfiniteSpinner,
  INFINITE_BATCH_STEP,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page `/resultats` fidèle à `src/app/(main)/resultats/page.tsx` :
 * - Requête canonique sans paramètre d'abord (`/api/matches/history`)
 * - Sélecteur `Matchs réels | Matchs virtuels`
 * - Tri du plus récent au plus ancien (`finishedAt` décroissant)
 * - Clic direct sur carte -> `/resultats/[id]` + infinite scroll 10 par 10 avec spinner nu.
 */
export default function ResultatsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ match?: string }>();
  const focusedId = params.match ? Number(params.match) : null;
  const { dataSaverMode, hapticsEnabled } = useApp();

  const [items, setItems] = useState<ClientFinishedMatch[] | null>(() =>
    getCachedFinishedMatchesList()
  );
  const [sourceTab, setSourceTab] = useState<"manual" | "virtual">("manual");
  const [userPickedSource, setUserPickedSource] = useState(false);
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const base = await api.finishedMatches();
      let list = base.matches;
      if (focusedId && !list.some((m) => m.id === focusedId)) {
        const focusedRes = await api.finishedMatches(focusedId).catch(() => null);
        if (focusedRes?.focusedMatch) {
          list = [focusedRes.focusedMatch, ...list];
        }
      }
      setItems(list);
    } catch {
      // Conserve le snapshot
    }
  }, [focusedId]);

  useSmartPolling(loadHistory, 16_000, {
    enabled: true,
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  // Si `?match=<id>` est passé, ouvrir directement sa fiche dédiée ou basculer sur son onglet
  useEffect(() => {
    if (focusedId && items) {
      const target = items.find((m) => m.id === focusedId);
      if (target && !userPickedSource) {
        setSourceTab(target.source === "manual" ? "manual" : "virtual");
      }
    }
  }, [focusedId, items, userPickedSource]);

  useEffect(() => {
    if (!userPickedSource && items) {
      const realCount = items.filter((m) => m.source === "manual").length;
      if (realCount === 0 && items.length > 0) {
        setSourceTab("virtual");
      }
    }
  }, [items, userPickedSource]);

  const scopedBySource = useMemo(
    () =>
      (items ?? []).filter((m) =>
        sourceTab === "manual" ? m.source === "manual" : m.source !== "manual"
      ),
    [items, sourceTab]
  );

  const leagues = useMemo(
    () => deduplicateLeagueNames(scopedBySource.map((m) => m.league)),
    [scopedBySource]
  );

  const qNorm = search.trim().toLowerCase();

  const sortedFiltered = useMemo(() => {
    const filtered = scopedBySource.filter((m) => {
      if (leagueFilter !== "all" && m.league !== leagueFilter) return false;
      if (outcomeFilter === "home" && m.winner !== "home") return false;
      if (outcomeFilter === "draw" && m.winner !== "draw") return false;
      if (outcomeFilter === "away" && m.winner !== "away") return false;
      if (outcomeFilter === "over25" && m.totalGoals < 3) return false;
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

    return [...filtered].sort(
      (a, b) =>
        (Date.parse(b.finishedAt) || 0) - (Date.parse(a.finishedAt) || 0) ||
        b.id - a.id
    );
  }, [leagueFilter, outcomeFilter, qNorm, scopedBySource]);

  const resetKey = `${sourceTab}|${leagueFilter}|${outcomeFilter}|${qNorm}`;
  const { visibleCount, hasMore, loadMore } = useInfiniteBatch(
    sortedFiltered.length,
    resetKey,
    INFINITE_BATCH_STEP
  );

  const visibleItems = useMemo(
    () => sortedFiltered.slice(0, visibleCount),
    [sortedFiltered, visibleCount]
  );

  return (
    <View style={styles.root}>
      <View style={styles.topHeader}>
        <Text style={styles.pageTitle}>Résultats</Text>
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

      {/* Sélecteur Matchs réels | Matchs virtuels */}
      <View style={styles.segmentWrap}>
        <Pressable
          onPress={() => {
            setUserPickedSource(true);
            setSourceTab("manual");
            setLeagueFilter("all");
          }}
          style={[
            styles.segmentBtn,
            sourceTab === "manual" && styles.segmentBtnActive,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              sourceTab === "manual" && styles.segmentTextActive,
            ]}
          >
            Matchs réels
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setUserPickedSource(true);
            setSourceTab("virtual");
            setLeagueFilter("all");
          }}
          style={[
            styles.segmentBtn,
            sourceTab === "virtual" && styles.segmentBtnActive,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              sourceTab === "virtual" && styles.segmentTextActive,
            ]}
          >
            Matchs virtuels
          </Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <FilterDropdownRow
          filters={[
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
              id: "outcome",
              label: "Issue",
              value: outcomeFilter,
              options: [
                { value: "all", label: " Tous les scores" },
                { value: "home", label: "Victoire domicile (1)" },
                { value: "draw", label: "Match nul (X)" },
                { value: "away", label: "Victoire extérieur (2)" },
                { value: "over25", label: "3 buts ou plus (+2,5)" },
              ],
              onChange: setOutcomeFilter,
            },
          ]}
          onReset={() => {
            setLeagueFilter("all");
            setOutcomeFilter("all");
            setSearch("");
          }}
          resultCountLabel={`${sortedFiltered.length} résultat${sortedFiltered.length > 1 ? "s" : ""}`}
        />
      </View>

      <FlatList<ClientFinishedMatch>
        data={visibleItems}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        windowSize={7}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadHistory();
              setRefreshing(false);
            }}
            tintColor={colors.betclicRed}
            colors={[colors.betclicRed]}
          />
        }
        ListEmptyComponent={
          !items ? (
            <BareInfiniteSpinner visible />
          ) : (
            <View style={[cardSurface.glassCard, styles.emptyCard]}>
              <Text style={styles.emptyText}>
                Aucun résultat terminé pour cette sélection.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              triggerHaptic("light", hapticsEnabled);
              router.push(`/resultats/${item.id}`);
            }}
            style={[
              cardSurface.glassCard,
              styles.resultCard,
              focusedId === item.id && {
                borderColor: colors.betclicRed,
              },
            ]}
          >
            <View style={styles.cardTop}>
              <Text numberOfLines={1} style={styles.leagueText}>
                {item.league}
              </Text>
              <View style={styles.topRight}>
                <Text style={styles.timeText}>
                  {formatPlacedAt(item.finishedAt)}
                </Text>
                <ChevronRight size={13} color={colors.dim} strokeWidth={2.4} />
              </View>
            </View>

            <View style={styles.teamLine}>
              <View style={styles.teamLeft}>
                <TeamAvatar name={item.homeTeam} logo={item.homeLogo} size="xs" />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.teamName,
                    item.winner === "home" && styles.winnerText,
                  ]}
                >
                  {item.homeTeam}
                </Text>
              </View>
              <Text
                style={[
                  styles.scoreNum,
                  item.winner === "home" && styles.winnerText,
                ]}
              >
                {item.homeScore}
              </Text>
            </View>

            <View style={styles.teamLine}>
              <View style={styles.teamLeft}>
                <TeamAvatar name={item.awayTeam} logo={item.awayLogo} size="xs" />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.teamName,
                    item.winner === "away" && styles.winnerText,
                  ]}
                >
                  {item.awayTeam}
                </Text>
              </View>
              <Text
                style={[
                  styles.scoreNum,
                  item.winner === "away" && styles.winnerText,
                ]}
              >
                {item.awayScore}
              </Text>
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
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
  pageTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: colors.ink,
    letterSpacing: -0.3,
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
  segmentWrap: {
    marginHorizontal: 16,
    marginBottom: 4,
    flexDirection: "row",
    backgroundColor: colors.elev,
    borderRadius: 12,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    height: 35,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: colors.white,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.dim,
  },
  segmentTextActive: {
    color: colors.ink,
    fontWeight: "900",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  resultCard: {
    padding: 13,
    gap: 7,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leagueText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.mist,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  timeText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.dim,
  },
  teamLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  teamName: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.ink,
  },
  winnerText: {
    fontWeight: "900",
  },
  scoreNum: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  emptyCard: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.mist,
  },
});
