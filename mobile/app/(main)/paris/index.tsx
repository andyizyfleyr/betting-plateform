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
  ArrowRight,
  Lock,
  RefreshCw,
  Search,
  TicketX,
  X,
} from "lucide-react-native";
import { BetTicket } from "@/components/bet-ticket";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { useQuery } from "@tanstack/react-query";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { useApp } from "@/context/app-context";
import { api, type UnifiedBet } from "@/lib/api";
import { eur, formatDayHeading } from "@/lib/format";
import { useMobileRealtimeStatus } from "@/lib/party-realtime";
import { mobileQueryKeys } from "@/lib/query-client";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const POLL_LIVE = 4_000;
const POLL_IDLE = 15_000;

type Tab = "ongoing" | "finished";
type KindFilter = "all" | "sport" | "prediction" | "combo";
type OutcomeFilter = "all" | "won" | "lost" | "cashed" | "void";

function betDecisionTimestamp(b: UnifiedBet): number {
  const iso = b.status === "pending" ? b.placedAt : (b.settledAt ?? b.placedAt);
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function matchesSearch(b: UnifiedBet, qNorm: string): boolean {
  if (!qNorm) return true;
  if (
    b.title.toLowerCase().includes(qNorm) ||
    b.subtitle.toLowerCase().includes(qNorm) ||
    b.selectionLabel.toLowerCase().includes(qNorm)
  ) {
    return true;
  }
  if (
    b.kind === "combo" &&
    b.legs?.some(
      (l) =>
        l.title.toLowerCase().includes(qNorm) ||
        l.league.toLowerCase().includes(qNorm) ||
        l.selectionLabel.toLowerCase().includes(qNorm)
    )
  ) {
    return true;
  }
  return false;
}

export default function ParisScreen() {
  const router = useRouter();
  const { user, betsVersion, setBalance, dataSaverMode } = useApp();
  const { wsConnected, userWsConnected } = useMobileRealtimeStatus();

  const [refreshing, setRefreshing] = useState(false);

  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput | null>(null);
  const [sharingBet, setSharingBet] = useState<UnifiedBet | null>(null);

  const betsQuery = useQuery({
    queryKey: [...mobileQueryKeys.userBets(user?.id, "all"), betsVersion],
    queryFn: () => api.bets.list(),
    enabled: Boolean(user),
    staleTime: 2_500,
    refetchInterval: (q) => {
      const currentBets = q.state.data?.bets;
      const livePending = Boolean(
        currentBets?.some(
          (b) =>
            b.status === "pending" &&
            (b.matchStatus === "live" ||
              b.legs?.some((l) => l.matchStatus === "live"))
        )
      );
      const anyPending = Boolean(
        currentBets?.some((b) => b.status === "pending")
      );
      if (!anyPending) return false;
      if (wsConnected && userWsConnected) {
        return livePending ? 15_000 : false;
      }
      const base = livePending ? POLL_LIVE : POLL_IDLE;
      return Math.round(base * (dataSaverMode ? 2.4 : 1));
    },
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (betsQuery.data?.balance != null) {
      setBalance(betsQuery.data.balance);
    }
  }, [betsQuery.data?.balance, setBalance]);

  const bets = useMemo(
    () => betsQuery.data?.bets ?? (betsQuery.isError ? [] : null),
    [betsQuery.data, betsQuery.isError]
  );

  const loadError =
    !betsQuery.data && betsQuery.error instanceof Error
      ? betsQuery.error.message
      : betsQuery.isError && !betsQuery.data
        ? "Impossible de charger vos paris."
        : null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await betsQuery.refetch();
      if (r.data?.balance != null) setBalance(r.data.balance);
    } finally {
      setRefreshing(false);
    }
  }, [betsQuery, setBalance]);

  const qNorm = query.trim().toLowerCase();

  const searchedBets = useMemo(
    () => (bets ?? []).filter((b) => matchesSearch(b, qNorm)),
    [bets, qNorm]
  );

  const ongoingAll = useMemo(
    () =>
      [...searchedBets.filter((b) => b.status === "pending")].sort(
        (a, b) =>
          new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime() ||
          b.id - a.id
      ),
    [searchedBets]
  );

  const finishedAll = useMemo(
    () =>
      [...searchedBets.filter((b) => b.status !== "pending")].sort(
        (a, b) => betDecisionTimestamp(b) - betDecisionTimestamp(a) || b.id - a.id
      ),
    [searchedBets]
  );

  const smartDefaultTab: Tab =
    bets !== null && ongoingAll.length === 0 && finishedAll.length > 0
      ? "finished"
      : "ongoing";
  const tab: Tab = tabChoice ?? smartDefaultTab;

  const statusPool = tab === "ongoing" ? ongoingAll : finishedAll;

  const kindCounts = useMemo(
    () => ({
      all: statusPool.length,
      combo: statusPool.filter((b) => b.kind === "combo").length,
      sport: statusPool.filter((b) => b.kind === "sport").length,
      prediction: statusPool.filter((b) => b.kind === "prediction").length,
    }),
    [statusPool]
  );

  const kindFiltered = useMemo(
    () =>
      kindFilter === "all"
        ? statusPool
        : statusPool.filter((b) => b.kind === kindFilter),
    [statusPool, kindFilter]
  );

  const finishedKindPool = useMemo(
    () =>
      kindFilter === "all"
        ? finishedAll
        : finishedAll.filter((b) => b.kind === kindFilter),
    [finishedAll, kindFilter]
  );

  const outcomeCounts = useMemo(
    () => ({
      all: finishedKindPool.length,
      won: finishedKindPool.filter((b) => b.status === "won").length,
      lost: finishedKindPool.filter((b) => b.status === "lost").length,
      cashed: finishedKindPool.filter((b) => b.status === "cashed").length,
      void: finishedKindPool.filter((b) => b.status === "void").length,
    }),
    [finishedKindPool]
  );

  const visibleBets = useMemo(() => {
    if (tab === "ongoing" || outcomeFilter === "all") return kindFiltered;
    return kindFiltered.filter((b) => b.status === outcomeFilter);
  }, [tab, kindFiltered, outcomeFilter]);

  const resetKey = `${tab}|${kindFilter}|${outcomeFilter}|${qNorm}`;
  const { visibleItems: pagedBets, hasMore, onScrollCheck } = useInfiniteBatch(
    visibleBets,
    10,
    resetKey
  );

  const dayTotalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (tab !== "finished") return counts;
    for (const b of visibleBets) {
      const label = formatDayHeading(b.settledAt ?? b.placedAt);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  }, [tab, visibleBets]);

  const finishedGroups = useMemo(() => {
    const groups = new Map<string, UnifiedBet[]>();
    if (tab !== "finished") return [];
    for (const b of pagedBets) {
      const label = formatDayHeading(b.settledAt ?? b.placedAt);
      const list = groups.get(label) ?? [];
      list.push(b);
      groups.set(label, list);
    }
    return Array.from(groups.entries());
  }, [tab, pagedBets]);

  // Synthèse globale
  const { staked, potential, settled, winRate } = useMemo(() => {
    const list = bets ?? [];
    const pend = list.filter((b) => b.status === "pending");
    const st = pend.reduce((s, b) => s + b.stake, 0);
    const pot = pend.reduce((s, b) => s + b.potentialWin, 0);
    const decided = list.filter(
      (b) => b.status === "won" || b.status === "lost"
    );
    const won = decided.filter((b) => b.status === "won").length;
    return {
      staked: st,
      potential: pot,
      settled: decided.length,
      winRate: decided.length > 0 ? Math.round((won / decided.length) * 100) : 0,
    };
  }, [bets]);

  const toggleMobileSearch = () => {
    if (mobileSearchOpen) {
      setQuery("");
      setMobileSearchOpen(false);
    } else {
      setMobileSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  };

  if (!user) {
    return (
      <View style={[styles.page, styles.guestCenter]}>
        <View style={styles.guestCard}>
          <View style={styles.guestIconCircle}>
            <Lock size={22} color={COLORS.betclicRed} strokeWidth={2.2} />
          </View>
          <Text style={styles.guestTitle}>Connectez-vous pour suivre vos paris</Text>
          <Text style={styles.guestSub}>
            Retrouvez vos coupons simples et combinés, vendez vos paris en
            direct (Cash Out) et partagez vos codes coupons.
          </Text>
          <Pressable
            onPress={() => router.push("/auth")}
            style={styles.guestBtn}
          >
            <Text style={styles.guestBtnText}>Se connecter</Text>
            <ArrowRight size={15} color="#ffffff" strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        stickyHeaderIndices={[3]}
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
        {/* 0 : En-tête identique à src/app/(main)/paris/page.tsx */}
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Mes paris</Text>
          <Pressable
            onPress={toggleMobileSearch}
            style={[
              styles.roundSearchBtn,
              (mobileSearchOpen || Boolean(query)) &&
                styles.roundSearchBtnActive,
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

        {/* 1 : Synthèse contextuelle */}
        <View>
          {bets !== null && (staked > 0 || settled > 0) ? (
            <View style={styles.summaryStrip}>
              {staked > 0 ? (
                <View style={styles.summaryLeft}>
                  <Text style={styles.summaryMuted}>
                    En jeu :{" "}
                    <Text style={styles.summaryStrong}>{eur(staked)}</Text>
                  </Text>
                  <Text style={styles.summaryMuted}>
                    Gain max :{" "}
                    <Text style={[styles.summaryStrong, { color: COLORS.win }]}>
                      {eur(potential)}
                    </Text>
                  </Text>
                </View>
              ) : null}
              {settled > 0 ? (
                <Text style={styles.summaryMuted}>
                  Réussite :{" "}
                  <Text style={styles.summaryStrong}>{winRate}%</Text>
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* 2 : Barre de recherche mobile dépliable */}
        <View>
          {mobileSearchOpen || query ? (
            <View style={styles.searchBar}>
              <Search size={16} color={COLORS.dim} strokeWidth={2.1} />
              <TextInput
                ref={searchInputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Rechercher un match, un coupon, un combiné…"
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

        {/* 3 : Rangée unique collante de 3 pastilles dropdown */}
        <View style={styles.stickyFilterWrap}>
          <FilterDropdownRow
            filters={[
              {
                id: "status",
                placeholder: "Statut",
                value: tab,
                defaultValue: smartDefaultTab,
                onChange: (next) => {
                  setTabChoice(next === smartDefaultTab ? null : next);
                  if (next === "ongoing") setOutcomeFilter("all");
                },
                options: [
                  {
                    value: "ongoing",
                    label: "En cours",
                    count: bets !== null ? ongoingAll.length : undefined,
                  },
                  {
                    value: "finished",
                    label: "Terminés",
                    count: bets !== null ? finishedAll.length : undefined,
                  },
                ],
              },
              {
                id: "kind",
                placeholder: "Type",
                value: kindFilter,
                defaultValue: "all",
                onChange: setKindFilter,
                options: [
                  {
                    value: "all",
                    label: "Tous types",
                    count: bets !== null ? kindCounts.all : undefined,
                  },
                  {
                    value: "combo",
                    label: "Combinés",
                    count: bets !== null ? kindCounts.combo : undefined,
                  },
                  {
                    value: "sport",
                    label: "Sport",
                    count: bets !== null ? kindCounts.sport : undefined,
                  },
                  {
                    value: "prediction",
                    label: "Prédictions",
                    count: bets !== null ? kindCounts.prediction : undefined,
                  },
                ],
              },
              {
                id: "outcome",
                placeholder: "Résultat",
                value: outcomeFilter,
                defaultValue: "all",
                onChange: (next) => {
                  setOutcomeFilter(next);
                  if (next !== "all" && tab === "ongoing") {
                    setTabChoice("finished");
                  }
                },
                options: [
                  {
                    value: "all",
                    label: "Tous résultats",
                    count: bets !== null ? outcomeCounts.all : undefined,
                  },
                  {
                    value: "won",
                    label: "Gagnés",
                    count: bets !== null ? outcomeCounts.won : undefined,
                  },
                  {
                    value: "lost",
                    label: "Perdus",
                    count: bets !== null ? outcomeCounts.lost : undefined,
                  },
                  {
                    value: "cashed",
                    label: "Vendus",
                    count: bets !== null ? outcomeCounts.cashed : undefined,
                  },
                  {
                    value: "void",
                    label: "Remboursés",
                    count: bets !== null ? outcomeCounts.void : undefined,
                  },
                ],
              },
            ]}
            onReset={() => {
              setTabChoice(null);
              setKindFilter("all");
              setOutcomeFilter("all");
            }}
            resultCountText={
              bets !== null
                ? tab === "ongoing"
                  ? `${visibleBets.length} pari${
                      visibleBets.length > 1 ? "s" : ""
                    } en cours`
                  : `${visibleBets.length} pari${
                      visibleBets.length > 1 ? "s" : ""
                    } terminé${visibleBets.length > 1 ? "s" : ""}`
                : null
            }
          />
        </View>

        {/* 4 : Liste des tickets */}
        {bets === null ? (
          <PulseFlashLoader compact />
        ) : loadError && bets.length === 0 ? (
          <View style={styles.errorCard}>
            <View style={styles.errorIconCircle}>
              <AlertTriangle size={20} color="#d97706" strokeWidth={2.1} />
            </View>
            <Text style={styles.errorTitle}>
              Connexion au serveur interrompue
            </Text>
            <Text style={styles.errorSub}>{loadError}</Text>
            <Pressable
              onPress={() => {
                void betsQuery.refetch();
              }}
              style={styles.retryBtn}
            >
              <RefreshCw size={14} color="#ffffff" strokeWidth={2.3} />
              <Text style={styles.retryBtnText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : visibleBets.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyCircle}>
              <TicketX size={24} color={COLORS.dim} strokeWidth={1.8} />
            </View>
            <Text style={styles.emptyTitle}>
              {tab === "ongoing" ? "Aucun pari en cours" : "Aucun pari terminé"}
            </Text>
            <Text style={styles.emptySub}>
              {tab === "ongoing"
                ? "Choisissez une prédiction ou un match pour placer une mise."
                : "Modifiez vos filtres ou consultez vos coupons en cours."}
            </Text>
            {tab === "ongoing" ? (
              <View style={styles.emptyBtnsRow}>
                <Pressable
                  onPress={() => router.push("/matchs")}
                  style={styles.emptyRedBtn}
                >
                  <Text style={styles.emptyRedBtnText}>Matchs</Text>
                  <ArrowRight size={14} color="#ffffff" strokeWidth={2.4} />
                </Pressable>
                <Pressable
                  onPress={() => router.push("/predictions")}
                  style={styles.emptyWhiteBtn}
                >
                  <Text style={styles.emptyWhiteBtnText}>Prédictions</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <View>
            {tab === "ongoing" ? (
              <View style={styles.ticketStack}>
                {pagedBets.map((b) => (
                  <BetTicket
                    key={`${b.kind}-${b.id}`}
                    bet={b}
                    onShare={setSharingBet}
                  />
                ))}
              </View>
            ) : (
              <View style={{ gap: 20 }}>
                {finishedGroups.map(([label, group]) => (
                  <View key={label}>
                    <Text style={styles.dayHeading}>
                      {label}
                      <Text style={styles.dayCount}>
                        {" "}
                        ({dayTotalCounts.get(label) ?? group.length})
                      </Text>
                    </Text>
                    <View style={styles.ticketStack}>
                      {group.map((b) => (
                        <BetTicket
                          key={`${b.kind}-${b.id}`}
                          bet={b}
                          onShare={setSharingBet}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
            <InfiniteScrollLoader hasMore={hasMore} />
          </View>
        )}
      </ScrollView>

      <ShareTicketModal
        bet={sharingBet}
        onClose={() => setSharingBet(null)}
      />
    </>
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
    gap: 12,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  roundSearchBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  roundSearchBtnActive: {
    backgroundColor: COLORS.betclicRed,
  },
  summaryStrip: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  summaryLeft: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 12,
  },
  summaryMuted: {
    fontSize: 12,
    color: COLORS.mist,
  },
  summaryStrong: {
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
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
    fontSize: 15.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  emptySub: {
    marginTop: 4,
    maxWidth: 240,
    textAlign: "center",
    fontSize: 12.5,
    color: COLORS.dim,
    lineHeight: 18,
  },
  emptyBtnsRow: {
    marginTop: 16,
    flexDirection: "row",
    gap: 8,
  },
  emptyRedBtn: {
    height: 40,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  emptyRedBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  emptyWhiteBtn: {
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWhiteBtnText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  ticketStack: {
    gap: 12,
  },
  dayHeading: {
    marginBottom: 8,
    paddingHorizontal: 2,
    fontSize: 11.5,
    fontWeight: "600",
    textTransform: "capitalize",
    color: COLORS.mist,
  },
  dayCount: {
    color: COLORS.dim,
  },
  guestCenter: {
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  guestCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 24,
    alignItems: "center",
  },
  guestIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(225,0,20,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  guestTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
  },
  guestSub: {
    marginTop: 6,
    fontSize: 12.5,
    color: COLORS.mist,
    textAlign: "center",
    lineHeight: 18,
  },
  guestBtn: {
    marginTop: 18,
    height: 44,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  guestBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#ffffff",
  },
});
