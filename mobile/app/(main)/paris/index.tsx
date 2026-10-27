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
import { useRouter } from "expo-router";
import { ReceiptText, Search, X } from "lucide-react-native";
import { api, type ClientBet } from "@/lib/api";
import { getCachedBetsList } from "@/lib/entity-cache";
import { eur } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { BetTicket } from "@/components/bet-ticket";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  BareInfiniteSpinner,
  INFINITE_BATCH_STEP,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page `/paris` (`Mes paris`) fidèle à `src/app/(main)/paris/page.tsx` :
 * - Tri strict du plus récent au plus ancien tant pour les mises (`placedAt`) que pour les résultats (`settledAt ?? placedAt`)
 * - Bascule automatiquement sur « Terminés » lorsqu'aucun pari n'est en cours
 * - `BetTicket` compact + `SlideToCashOut` vert créatif + statut `Perdu` rouge + infinite scroll 10 par 10.
 */
export default function MesParisScreen() {
  const router = useRouter();
  const { user, setBalance, setPendingCount, dataSaverMode } = useApp();

  const [bets, setBets] = useState<ClientBet[] | null>(() =>
    getCachedBetsList()
  );
  const [tab, setTab] = useState<"ongoing" | "finished">("ongoing");
  const [userPickedTab, setUserPickedTab] = useState(false);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadBets = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.bets("all");
      setBets(res.bets);
      if (typeof res.balance === "number") setBalance(res.balance);
      setPendingCount(res.bets.filter((b) => b.status === "pending").length);
    } catch {
      // Conserve le snapshot
    }
  }, [setBalance, setPendingCount, user]);

  useSmartPolling(loadBets, 5_500, {
    enabled: Boolean(user),
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const ongoingCount = useMemo(
    () => (bets ?? []).filter((b) => b.status === "pending").length,
    [bets]
  );
  const finishedCount = useMemo(
    () => (bets ?? []).filter((b) => b.status !== "pending").length,
    [bets]
  );

  // Bascule par défaut sur les paris terminés si aucun pari n'est en cours
  useEffect(() => {
    if (!userPickedTab && bets && ongoingCount === 0 && finishedCount > 0) {
      setTab("finished");
    }
  }, [bets, finishedCount, ongoingCount, userPickedTab]);

  const qNorm = search.trim().toLowerCase();

  const sortedFiltered = useMemo(() => {
    const base = (bets ?? []).filter((b) => {
      if (tab === "ongoing" && b.status !== "pending") return false;
      if (tab === "finished" && b.status === "pending") return false;
      if (kindFilter !== "all" && b.kind !== kindFilter) return false;
      if (outcomeFilter !== "all" && b.status !== outcomeFilter) return false;
      if (qNorm) {
        const hay = `${b.homeTeam} ${b.awayTeam} ${b.question ?? ""} ${b.selectionLabel} ${b.league}`.toLowerCase();
        if (!hay.includes(qNorm)) return false;
      }
      return true;
    });

    // Tri du plus récent au plus ancien (mises comme résultats)
    return [...base].sort((a, b) => {
      const ta =
        tab === "finished"
          ? Date.parse(a.settledAt ?? a.placedAt) || 0
          : Date.parse(a.placedAt) || 0;
      const tb =
        tab === "finished"
          ? Date.parse(b.settledAt ?? b.placedAt) || 0
          : Date.parse(b.placedAt) || 0;
      return tb - ta || b.id - a.id;
    });
  }, [bets, kindFilter, outcomeFilter, qNorm, tab]);

  const summary = useMemo(() => {
    const all = bets ?? [];
    const ongoing = all.filter((b) => b.status === "pending");
    const settled = all.filter(
      (b) => b.status === "won" || b.status === "lost" || b.status === "cashed_out"
    );
    const won = settled.filter(
      (b) => b.status === "won" || b.status === "cashed_out"
    );
    return {
      inPlay: ongoing.reduce((s, b) => s + b.stake, 0),
      maxPayout: ongoing.reduce((s, b) => s + b.potentialWin, 0),
      winRate:
        settled.length > 0 ? Math.round((won.length / settled.length) * 100) : 0,
    };
  }, [bets]);

  const resetKey = `${tab}|${kindFilter}|${outcomeFilter}|${qNorm}`;
  const { visibleCount, hasMore, loadMore } = useInfiniteBatch(
    sortedFiltered.length,
    resetKey,
    INFINITE_BATCH_STEP
  );

  const visibleItems = useMemo(
    () => sortedFiltered.slice(0, visibleCount),
    [sortedFiltered, visibleCount]
  );

  if (!user) {
    return (
      <View style={[styles.root, { justifyContent: "center", padding: 20 }]}>
        <View style={[cardSurface.glassCard, styles.guestCard]}>
          <ReceiptText size={28} color={colors.dim} />
          <Text style={styles.guestTitle}>Connectez-vous pour suivre vos paris</Text>
          <Text style={styles.guestSub}>
            Retrouvez vos tickets simples, combinés et votre Cash Out en temps réel.
          </Text>
          <Pressable
            onPress={() => router.push("/auth")}
            style={styles.loginBtn}
          >
            <Text style={styles.loginBtnText}>Se connecter</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.topHeader}>
        <Text style={styles.pageTitle}>Mes paris</Text>
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
            placeholder="Rechercher un ticket, club, sélection…"
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

      {/* Bandeau synthèse contextuel */}
      {(ongoingCount > 0 || finishedCount > 0) && (
        <View style={styles.kpiStrip}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>En jeu</Text>
            <Text style={styles.kpiVal}>{eur(summary.inPlay)}</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Gain max</Text>
            <Text style={[styles.kpiVal, { color: colors.win }]}>
              {eur(summary.maxPayout)}
            </Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Réussite</Text>
            <Text style={styles.kpiVal}>{summary.winRate}%</Text>
          </View>
        </View>
      )}

      <View style={{ paddingHorizontal: 16 }}>
        <FilterDropdownRow
          filters={[
            {
              id: "tab",
              label: "Statut",
              value: tab,
              defaultValue: "ongoing",
              options: [
                { value: "ongoing", label: "En cours", count: ongoingCount },
                { value: "finished", label: "Terminés", count: finishedCount },
              ],
              onChange: (v) => {
                setUserPickedTab(true);
                setTab(v as "ongoing" | "finished");
                setOutcomeFilter("all");
              },
            },
            {
              id: "kind",
              label: "Format",
              value: kindFilter,
              options: [
                { value: "all", label: "Tous les formats" },
                { value: "sport", label: "Paris simples" },
                { value: "combo", label: "Combinés" },
                { value: "prediction", label: "Prédictions" },
              ],
              onChange: setKindFilter,
            },
            ...(tab === "finished"
              ? [
                  {
                    id: "outcome",
                    label: "Issue",
                    value: outcomeFilter,
                    options: [
                      { value: "all", label: "Toutes les issues" },
                      { value: "won", label: "Gagnés" },
                      { value: "cashed_out", label: "Vendus (Cash Out)" },
                      { value: "lost", label: "Perdus" },
                      { value: "void", label: "Remboursés" },
                    ],
                    onChange: setOutcomeFilter,
                  },
                ]
              : []),
          ]}
          onReset={() => {
            setUserPickedTab(true);
            setTab(ongoingCount > 0 ? "ongoing" : "finished");
            setKindFilter("all");
            setOutcomeFilter("all");
            setSearch("");
          }}
          resultCountLabel={`${sortedFiltered.length} ticket${sortedFiltered.length > 1 ? "s" : ""}`}
        />
      </View>

      <FlatList<ClientBet>
        data={visibleItems}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
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
              await loadBets();
              setRefreshing(false);
            }}
            tintColor={colors.betclicRed}
            colors={[colors.betclicRed]}
          />
        }
        ListEmptyComponent={
          !bets ? (
            <BareInfiniteSpinner visible />
          ) : (
            <View style={[cardSurface.glassCard, styles.emptyCard]}>
              <Text style={styles.emptyText}>
                {tab === "ongoing"
                  ? "Aucun pari en cours pour le moment."
                  : "Aucun ticket terminé pour ces filtres."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <BetTicket bet={item} onCashedOut={() => void loadBets()} />
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
  kpiStrip: {
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    flexDirection: "row",
    alignItems: "center",
  },
  kpiItem: {
    flex: 1,
    alignItems: "center",
  },
  kpiDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.edgeSoft,
  },
  kpiLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    color: colors.dim,
  },
  kpiVal: {
    marginTop: 1,
    fontSize: 13.5,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
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
  guestCard: {
    padding: 22,
    alignItems: "center",
    gap: 8,
  },
  guestTitle: {
    fontSize: 15.5,
    fontWeight: "900",
    color: colors.ink,
    textAlign: "center",
  },
  guestSub: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.mist,
    textAlign: "center",
  },
  loginBtn: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.betclicRed,
  },
  loginBtnText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.white,
  },
});
