import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  AlertTriangle,
  ArrowLeft,
  Cpu,
  History,
  RefreshCw,
  Search,
  Trophy,
  X,
} from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { MatchCard } from "@/components/match-card";
import { useApp } from "@/context/app-context";
import { api, type ClientMatch } from "@/lib/api";
import {
  matchesSearchAndOdds,
  type OddsProfile,
  sortByKickoffAsc,
  type StatusFilter,
} from "@/lib/matches-catalog";
import { sortRealLeaguesByPriority } from "@/lib/real-leagues";
import { useRouter, useSearchParams } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const POLL_INTERVAL = 12_000;

export default function AllMatchesScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setFeedMatches } = useApp();

  const initialStatusParam = searchParams.get("status");
  const initialLeagueParam = searchParams.get("league");

  const [matches, setMatches] = useState<ClientMatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const [filter, setFilter] = useState<StatusFilter>(() =>
    initialStatusParam === "live" ||
    initialStatusParam === "upcoming" ||
    initialStatusParam === "finished"
      ? initialStatusParam
      : "all"
  );
  const [leagueFilter, setLeagueFilter] = useState<string>(
    () => initialLeagueParam || "all"
  );
  const [oddsProfile, setOddsProfile] = useState<OddsProfile>("all");
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput | null>(null);

  const fetchList = useCallback(
    async (isBackground = false) => {
      try {
        const r = await api.matches();
        setMatches(r.matches);
        setFeedMatches(r.matches);
        setLoadError(null);
      } catch (err) {
        if (!isBackground) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Impossible de charger les rencontres officielles."
          );
          setMatches((prev) => prev ?? []);
        }
      }
    },
    [setFeedMatches]
  );

  useEffect(() => {
    void fetchList(false);
    const id = setInterval(() => void fetchList(true), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchList, reloadNonce]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchList(true);
    setRefreshing(false);
  }, [fetchList]);

  const realMatchesAll = useMemo(
    () => (matches ?? []).filter((m) => m.source === "manual"),
    [matches]
  );

  const qNorm = query.trim().toLowerCase();

  const searchedPool = useMemo(
    () => realMatchesAll.filter((m) => matchesSearchAndOdds(m, qNorm, "all")),
    [realMatchesAll, qNorm]
  );

  const activeAllCount = useMemo(
    () => searchedPool.filter((m) => m.status !== "finished").length,
    [searchedPool]
  );
  const liveAllCount = useMemo(
    () => searchedPool.filter((m) => m.status === "live").length,
    [searchedPool]
  );
  const upcomingAllCount = useMemo(
    () => searchedPool.filter((m) => m.status === "upcoming").length,
    [searchedPool]
  );
  const finishedAllCount = useMemo(
    () => searchedPool.filter((m) => m.status === "finished").length,
    [searchedPool]
  );

  const statusPoolForLeagueCounts = useMemo(() => {
    if (filter === "live")
      return searchedPool.filter((m) => m.status === "live");
    if (filter === "upcoming")
      return searchedPool.filter((m) => m.status === "upcoming");
    if (filter === "finished")
      return searchedPool.filter((m) => m.status === "finished");
    return searchedPool.filter((m) => m.status !== "finished");
  }, [searchedPool, filter]);

  const leagueOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of statusPoolForLeagueCounts) {
      counts.set(m.league, (counts.get(m.league) ?? 0) + 1);
    }
    const ordered = sortRealLeaguesByPriority([...counts.keys()]);
    return ordered.map((lg) => ({ league: lg, count: counts.get(lg) ?? 0 }));
  }, [statusPoolForLeagueCounts]);

  const effectiveLeague = useMemo(() => {
    if (leagueFilter === "all") return "all";
    return realMatchesAll.some((m) => m.league === leagueFilter)
      ? leagueFilter
      : "all";
  }, [leagueFilter, realMatchesAll]);

  const byStatusAndLeague = useMemo(() => {
    return statusPoolForLeagueCounts.filter(
      (m) => effectiveLeague === "all" || m.league === effectiveLeague
    );
  }, [statusPoolForLeagueCounts, effectiveLeague]);

  const favCount = useMemo(
    () =>
      byStatusAndLeague.filter((m) =>
        matchesSearchAndOdds(m, "", "favorite")
      ).length,
    [byStatusAndLeague]
  );
  const tightCount = useMemo(
    () =>
      byStatusAndLeague.filter((m) => matchesSearchAndOdds(m, "", "tight"))
        .length,
    [byStatusAndLeague]
  );

  const filteredPool = useMemo(
    () =>
      byStatusAndLeague.filter((m) =>
        matchesSearchAndOdds(m, "", oddsProfile)
      ),
    [byStatusAndLeague, oddsProfile]
  );

  const liveOrdered = useMemo(
    () => filteredPool.filter((m) => m.status === "live"),
    [filteredPool]
  );
  const upcomingOrdered = useMemo(
    () => sortByKickoffAsc(filteredPool.filter((m) => m.status === "upcoming")),
    [filteredPool]
  );
  const finishedOrdered = useMemo(
    () =>
      [...filteredPool.filter((m) => m.status === "finished")].sort(
        (a, b) =>
          new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
      ),
    [filteredPool]
  );

  const visible = useMemo(() => {
    if (filter === "live") return liveOrdered;
    if (filter === "upcoming") return upcomingOrdered;
    if (filter === "finished") return finishedOrdered;
    return [...liveOrdered, ...upcomingOrdered];
  }, [filter, liveOrdered, upcomingOrdered, finishedOrdered]);

  const resetKey = `${filter}|${effectiveLeague}|${oddsProfile}|${qNorm}`;
  const { visibleItems, hasMore, onScrollCheck } = useInfiniteBatch(
    visible,
    10,
    resetKey
  );

  const visibleLiveOrdered = useMemo(
    () => visibleItems.filter((m) => m.status === "live"),
    [visibleItems]
  );
  const visibleUpcomingOrdered = useMemo(
    () => visibleItems.filter((m) => m.status === "upcoming"),
    [visibleItems]
  );
  const visibleFinishedOrdered = useMemo(
    () => visibleItems.filter((m) => m.status === "finished"),
    [visibleItems]
  );

  const toggleMobileSearch = () => {
    if (mobileSearchOpen) {
      setQuery("");
      setMobileSearchOpen(false);
    } else {
      setMobileSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[2]}
      showsVerticalScrollIndicator={false}
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
      {/* 0 : En-tête identique à src/app/(main)/matchs/tous/page.tsx */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back("/matchs")}
            style={({ pressed }) => [
              styles.roundBackBtn,
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
          >
            <ArrowLeft size={16} color={COLORS.ink} strokeWidth={2.2} />
          </Pressable>
          <Text numberOfLines={1} style={styles.pageTitle}>
            {effectiveLeague !== "all" ? effectiveLeague : "Tous les matchs"}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push("/resultats?universe=real")}
            style={styles.roundActionBtn}
          >
            <History size={16} color={COLORS.ink} strokeWidth={2.2} />
          </Pressable>
          <Pressable
            onPress={toggleMobileSearch}
            style={[
              styles.roundActionBtn,
              (mobileSearchOpen || Boolean(query)) &&
                styles.roundActionBtnActive,
            ]}
          >
            {mobileSearchOpen ? (
              <X size={16} color="#ffffff" strokeWidth={2.3} />
            ) : (
              <Search
                size={16}
                color={query ? "#ffffff" : COLORS.ink}
                strokeWidth={2.2}
              />
            )}
          </Pressable>
        </View>
      </View>

      {/* 1 : Barre de recherche mobile dépliable */}
      <View>
        {mobileSearchOpen || query ? (
          <View style={styles.searchBar}>
            <Search size={16} color={COLORS.dim} strokeWidth={2.1} />
            <TextInput
              ref={searchInputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Rechercher un match, un club ou une compétition…"
              placeholderTextColor={COLORS.dim}
              style={styles.searchInput}
            />
            <Pressable
              hitSlop={8}
              onPress={() => {
                setQuery("");
                setMobileSearchOpen(false);
              }}
            >
              <X size={16} color={COLORS.dim} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* 2 : Rangée unique collante de 3 pastilles dropdown 40 px */}
      <View style={styles.stickyFilterWrap}>
        <FilterDropdownRow
          filters={[
            {
              id: "status",
              placeholder: "Statut",
              value: filter,
              defaultValue: "all",
              onChange: setFilter,
              options: [
                {
                  value: "all",
                  label: "Affiche",
                  count: matches !== null ? activeAllCount : undefined,
                },
                {
                  value: "live",
                  label: "En direct",
                  count: matches !== null ? liveAllCount : undefined,
                },
                {
                  value: "upcoming",
                  label: "Avant-match",
                  count: matches !== null ? upcomingAllCount : undefined,
                },
                {
                  value: "finished",
                  label: "Terminés",
                  count: matches !== null ? finishedAllCount : undefined,
                },
              ],
            },
            {
              id: "league",
              placeholder: "Ligue",
              value: effectiveLeague,
              defaultValue: "all",
              onChange: setLeagueFilter,
              options: [
                {
                  value: "all",
                  label: "Toutes ligues",
                  count:
                    matches !== null
                      ? statusPoolForLeagueCounts.length
                      : undefined,
                },
                ...leagueOptions.map(({ league, count }) => ({
                  value: league,
                  label: league,
                  count: matches !== null ? count : undefined,
                })),
              ],
            },
            {
              id: "odds",
              placeholder: "Cotes",
              value: oddsProfile,
              defaultValue: "all",
              onChange: setOddsProfile,
              options: [
                {
                  value: "all",
                  label: "Toutes cotes",
                  count: matches !== null ? byStatusAndLeague.length : undefined,
                },
                {
                  value: "favorite",
                  label: "Favori net",
                  count: matches !== null ? favCount : undefined,
                },
                {
                  value: "tight",
                  label: "Match serré",
                  count: matches !== null ? tightCount : undefined,
                },
              ],
            },
          ]}
          onReset={() => {
            setFilter("all");
            setLeagueFilter("all");
            setOddsProfile("all");
          }}
          resultCountText={
            matches !== null
              ? `${visible.length} match${visible.length > 1 ? "s" : ""} officiel${
                  visible.length > 1 ? "s" : ""
                }`
              : null
          }
        />
      </View>

      {/* 3 : Contenu */}
      {matches === null ? (
        <View style={styles.loaderBox}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : loadError && matches.length === 0 ? (
        <View style={styles.errorCard}>
          <View style={styles.errorIconCircle}>
            <AlertTriangle size={20} color="#d97706" strokeWidth={2.1} />
          </View>
          <Text style={styles.errorTitle}>Connexion au serveur interrompue</Text>
          <Text style={styles.errorSub}>{loadError}</Text>
          <Pressable
            onPress={() => {
              setMatches(null);
              setLoadError(null);
              setReloadNonce((n) => n + 1);
            }}
            style={styles.retryBtn}
          >
            <RefreshCw size={14} color="#ffffff" strokeWidth={2.3} />
            <Text style={styles.retryBtnText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <Trophy size={20} color={COLORS.dim} strokeWidth={1.9} />
          </View>
          <Text style={styles.emptyTitle}>
            {filter === "live"
              ? "Aucun match officiel en direct actuellement"
              : "Aucun match officiel dans ce filtre"}
          </Text>
          <Text style={styles.emptySub}>
            {filter === "live"
              ? "Retrouvez les prochaines affiches en avant-match ou pariez en direct sur les matchs virtuels 24h/24."
              : "Modifiez ou réinitialisez les filtres pour afficher l'ensemble des rencontres."}
          </Text>
          <View style={styles.emptyActions}>
            {filter === "live" && upcomingAllCount > 0 ? (
              <Pressable
                onPress={() => setFilter("upcoming")}
                style={styles.emptySecondaryBtn}
              >
                <Text style={styles.emptySecondaryText}>
                  Avant-match ({upcomingAllCount})
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.push("/matchs/virtuels")}
              style={styles.emptyPrimaryBtn}
            >
              <Cpu size={14} color="#ffffff" strokeWidth={2.3} />
              <Text style={styles.emptyPrimaryText}>Matchs virtuels 24h/24</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.sectionsStack}>
          {visibleLiveOrdered.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadLeft}>
                  <View style={styles.emeraldDot} />
                  <Text style={styles.sectionHeadTitle}>EN DIRECT</Text>
                </View>
                <View style={styles.emeraldCountPill}>
                  <Text style={styles.emeraldCountText}>
                    {liveOrdered.length}
                  </Text>
                </View>
              </View>
              <View style={styles.cardStack}>
                {visibleLiveOrdered.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </View>
            </View>
          ) : null}

          {visibleUpcomingOrdered.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionHeadTitle}>AVANT-MATCH</Text>
                <View style={styles.grayCountPill}>
                  <Text style={styles.grayCountText}>
                    {upcomingOrdered.length}
                  </Text>
                </View>
              </View>
              <View style={styles.cardStack}>
                {visibleUpcomingOrdered.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </View>
            </View>
          ) : null}

          {visibleFinishedOrdered.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionHeadTitle}>TERMINÉS RÉCEMMENT</Text>
                <Pressable
                  onPress={() => router.push("/resultats?universe=real")}
                  style={styles.historyLink}
                >
                  <History
                    size={14}
                    color={COLORS.betclicRed}
                    strokeWidth={2.2}
                  />
                  <Text style={styles.historyLinkText}>
                    Tout l&apos;historique
                  </Text>
                </Pressable>
              </View>
              <View style={styles.cardStack}>
                {visibleFinishedOrdered.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </View>
            </View>
          ) : null}

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
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  roundBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  roundActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  roundActionBtnActive: {
    backgroundColor: COLORS.betclicRed,
  },
  searchBar: {
    marginTop: 10,
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
  stickyFilterWrap: {
    backgroundColor: COLORS.deep,
  },
  loaderBox: {
    paddingVertical: 48,
    alignItems: "center",
  },
  errorCard: {
    marginTop: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
    backgroundColor: "#ffffff",
    padding: 20,
    alignItems: "center",
  },
  errorIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorTitle: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.ink,
  },
  errorSub: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 12.5,
    color: COLORS.mist,
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 16,
    height: 40,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  retryBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
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
    textAlign: "center",
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
    lineHeight: 18,
  },
  emptyActions: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  emptySecondaryBtn: {
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  emptySecondaryText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  emptyPrimaryBtn: {
    height: 38,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  emptyPrimaryText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  sectionsStack: {
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  sectionHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  emeraldDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#059669",
  },
  sectionHeadTitle: {
    fontSize: 12.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: COLORS.ink,
  },
  emeraldCountPill: {
    borderRadius: 999,
    backgroundColor: "rgba(5,150,105,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  emeraldCountText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#047857",
    fontVariant: ["tabular-nums"],
  },
  grayCountPill: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  grayCountText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  historyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  historyLinkText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  cardStack: {
    gap: 12,
  },
});
