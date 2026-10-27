import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ticket } from "lucide-react-native";
import { BetTicket } from "@/components/bet-ticket";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { useApp } from "@/context/app-context";
import { api, type BetKind, type ClientBet } from "@/lib/api";
import { getCachedBetsList } from "@/lib/entity-cache";
import { useSmartPolling } from "@/lib/polling";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

function sortNewestFirst(list: ClientBet[]): ClientBet[] {
  return [...list].sort((a, b) => {
    const tA = Date.parse(a.settledAt || a.placedAt) || 0;
    const tB = Date.parse(b.settledAt || b.placedAt) || 0;
    return tB - tA || b.id - a.id;
  });
}

export default function MesParisScreen() {
  const router = useRouter();
  const { user, setBalance, setPendingCount, betsVersion, dataSaverMode } =
    useApp();

  const [allBets, setAllBets] = useState<ClientBet[]>(
    () => getCachedBetsList() ?? []
  );
  const [loading, setLoading] = useState<boolean>(
    () => Boolean(user) && getCachedBetsList() === null
  );
  const [refreshing, setRefreshing] = useState(false);

  const [statusFilter, setStatusFilter] = useState<
    "ongoing" | "finished" | "all"
  >("ongoing");
  const [kindFilter, setKindFilter] = useState<"all" | BetKind>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<
    "all" | "won" | "lost" | "cashed"
  >("all");
  const autoDefaultAppliedRef = useRef(false);

  const loadBets = useCallback(async () => {
    if (!user) {
      setAllBets([]);
      setLoading(false);
      return;
    }
    try {
      const res = await api.allBets();
      const sorted = sortNewestFirst(res.bets);
      setAllBets(sorted);
      if (typeof res.balance === "number") setBalance(res.balance);
      const ongoing = sorted.filter((b) => b.status === "pending");
      setPendingCount(ongoing.length);

      // Contrainte stricte : basculer par défaut sur « Terminés » (du plus récent au plus ancien) quand 0 pari en cours
      if (
        !autoDefaultAppliedRef.current &&
        ongoing.length === 0 &&
        sorted.length > 0
      ) {
        autoDefaultAppliedRef.current = true;
        setStatusFilter("finished");
      } else if (ongoing.length > 0) {
        autoDefaultAppliedRef.current = true;
      }
    } catch {
      /* garde snapshot */
    } finally {
      setLoading(false);
    }
  }, [setBalance, setPendingCount, user]);

  useEffect(() => {
    void loadBets();
  }, [loadBets, betsVersion]);

  useSmartPolling(loadBets, 6_000, {
    enabled: Boolean(user),
    dataSaver: dataSaverMode,
    runImmediately: false,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBets();
    setRefreshing(false);
  }, [loadBets]);

  const ongoingCount = useMemo(
    () => allBets.filter((b) => b.status === "pending").length,
    [allBets]
  );
  const finishedCount = useMemo(
    () => allBets.filter((b) => b.status !== "pending").length,
    [allBets]
  );

  const filtered = useMemo(() => {
    const base = allBets.filter((b) => {
      if (statusFilter === "ongoing" && b.status !== "pending") return false;
      if (statusFilter === "finished" && b.status === "pending") return false;
      if (kindFilter !== "all" && b.kind !== kindFilter) return false;
      if (statusFilter !== "ongoing" && outcomeFilter !== "all") {
        if (b.status !== outcomeFilter) return false;
      }
      return true;
    });
    return sortNewestFirst(base);
  }, [allBets, kindFilter, outcomeFilter, statusFilter]);

  const resetKey = `${statusFilter}|${kindFilter}|${outcomeFilter}`;
  const { visibleItems, hasMore, onScrollCheck } = useInfiniteBatch(
    filtered,
    10,
    resetKey
  );

  if (!user) {
    return (
      <View style={styles.guestWrap}>
        <View style={styles.guestIcon}>
          <Ticket size={24} color={COLORS.betclicRed} strokeWidth={2.2} />
        </View>
        <Text style={styles.guestTitle}>Connectez-vous pour voir vos paris</Text>
        <Text style={styles.guestDesc}>
          Suivez vos tickets simples et combinés en temps réel et encaissez via
          Cash Out.
        </Text>
        <Pressable
          onPress={() => router.push("/auth")}
          style={styles.guestBtn}
        >
          <Text style={styles.guestBtnText}>Connexion / Inscription</Text>
        </Pressable>
      </View>
    );
  }

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
      <View style={styles.topRow}>
        <Text style={styles.pageTitle}>Mes paris</Text>
      </View>

      <FilterDropdownRow
        filters={[
          {
            id: "status",
            label: "Statut",
            value: statusFilter,
            defaultValue: ongoingCount > 0 ? "ongoing" : "finished",
            onChange: setStatusFilter,
            options: [
              { value: "ongoing", label: "En cours", count: ongoingCount },
              { value: "finished", label: "Terminés", count: finishedCount },
              { value: "all", label: "Tous", count: allBets.length },
            ],
          },
          {
            id: "kind",
            label: "Type de pari",
            value: kindFilter,
            defaultValue: "all",
            onChange: setKindFilter,
            options: [
              { value: "all", label: "Tous les types" },
              { value: "sport", label: "Paris simples" },
              { value: "combo", label: "Combinés" },
              { value: "prediction", label: "Prédictions" },
            ],
          },
          ...(statusFilter !== "ongoing"
            ? [
                {
                  id: "outcome",
                  label: "Résultat",
                  value: outcomeFilter,
                  defaultValue: "all" as const,
                  onChange: setOutcomeFilter,
                  options: [
                    { value: "all" as const, label: "Tous résultats" },
                    { value: "won" as const, label: "Gagnés" },
                    { value: "lost" as const, label: "Perdus" },
                    { value: "cashed" as const, label: "Vendus (Cash Out)" },
                  ],
                },
              ]
            : []),
        ]}
        onReset={() => {
          setStatusFilter(ongoingCount > 0 ? "ongoing" : "finished");
          setKindFilter("all");
          setOutcomeFilter("all");
        }}
      />

      <Text style={styles.countLine}>
        {filtered.length} ticket{filtered.length > 1 ? "s" : ""}
      </Text>

      {loading && allBets.length === 0 ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Aucun ticket dans cette vue</Text>
          <Pressable
            onPress={() => router.push("/matchs")}
            style={styles.browseBtn}
          >
            <Text style={styles.browseText}>Voir les matchs</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleItems.map((b) => (
            <BetTicket
              key={`${b.kind}-${b.id}`}
              bet={b}
              onCashedOut={loadBets}
            />
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
  topRow: {
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
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
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.dim,
  },
  browseBtn: {
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  browseText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  guestWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 26,
    gap: 10,
  },
  guestIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
    alignItems: "center",
    justifyContent: "center",
  },
  guestTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
    textAlign: "center",
  },
  guestDesc: {
    fontSize: 13,
    color: COLORS.dim,
    textAlign: "center",
    lineHeight: 19,
  },
  guestBtn: {
    marginTop: 4,
    height: 44,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  guestBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
  },
});
