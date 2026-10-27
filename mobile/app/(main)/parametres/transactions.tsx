import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  generateIdempotencyKey,
  type ClientWalletData,
  type ClientWalletEntry,
} from "@/lib/api";
import { getCachedWalletSnapshot } from "@/lib/entity-cache";
import { eur, formatFullDateTime } from "@/lib/format";
import { Redirect, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function TransactionsScreen() {
  const router = useRouter();
  const { user, authReady, setBalance, toast } = useApp();

  const [wallet, setWallet] = useState<ClientWalletData | null>(() =>
    getCachedWalletSnapshot()
  );
  const [loading, setLoading] = useState<boolean>(!wallet);
  const [refreshing, setRefreshing] = useState(false);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.wallet();
      setWallet(data);
      setBalance(data.balance);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [setBalance, user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authReady && !user) {
    return <Redirect href="/auth" />;
  }

  const entries: ClientWalletEntry[] = useMemo(() => {
    const raw = wallet?.entries ?? [];
    return [...raw].sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
    );
  }, [wallet?.entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (statusFilter === "pending" && e.status !== "pending") return false;
      if (statusFilter === "completed" && e.status === "pending") return false;
      return true;
    });
  }, [entries, statusFilter, typeFilter]);

  const resetKey = `${typeFilter}|${statusFilter}`;
  const { visibleItems, hasMore, onScrollCheck } = useInfiniteBatch(
    filtered,
    10,
    resetKey
  );

  const handleCancelWithdrawal = async (rawId?: number) => {
    if (!rawId) return;
    try {
      const res = await api.cancelWithdrawal(
        rawId,
        generateIdempotencyKey("wdc")
      );
      setBalance(res.balance);
      await load();
      toast({ kind: "info", title: "Retrait annulé" });
    } catch (err) {
      toast({
        kind: "error",
        title: "Annulation impossible",
        description:
          err instanceof ApiHttpError ? err.message : "Veuillez réessayer.",
      });
    }
  };

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
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          colors={[COLORS.betclicRed]}
          tintColor={COLORS.betclicRed}
        />
      }
    >
      <View style={styles.topSection}>
        <View style={styles.navBar}>
          <Pressable
            onPress={() => router.back("/parametres")}
            style={styles.backBtn}
          >
            <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
          </Pressable>
          <Text style={styles.navTitle}>Transactions</Text>
          <View style={{ width: 36 }} />
        </View>

        {wallet ? (
          <View style={styles.kpiRow}>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiLabel}>Déposé</Text>
              <Text style={styles.kpiVal}>
                {eur(wallet.summary.totalDeposited)}
              </Text>
            </View>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiLabel}>Retiré</Text>
              <Text style={styles.kpiVal}>
                {eur(wallet.summary.totalWithdrawn)}
              </Text>
            </View>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiLabel}>En attente</Text>
              <Text style={styles.kpiVal}>
                {eur(wallet.summary.pendingWithdrawals)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <FilterDropdownRow
        filters={[
          {
            id: "type",
            label: "Type d'opération",
            value: typeFilter,
            defaultValue: "all",
            onChange: setTypeFilter,
            options: [
              { value: "all", label: "Toutes opérations", count: entries.length },
              { value: "deposit", label: "Dépôts" },
              { value: "withdrawal", label: "Retraits" },
              { value: "win", label: "Gains" },
              { value: "cashout", label: "Cash Out" },
              { value: "stake", label: "Mises" },
            ],
          },
          {
            id: "status",
            label: "Statut",
            value: statusFilter,
            defaultValue: "all",
            onChange: setStatusFilter,
            options: [
              { value: "all", label: "Tous statuts" },
              { value: "completed", label: "Validées" },
              { value: "pending", label: "En attente" },
            ],
          },
        ]}
        onReset={() => {
          setTypeFilter("all");
          setStatusFilter("all");
        }}
      />

      <Text style={styles.countLine}>
        {filtered.length} mouvement{filtered.length > 1 ? "s" : ""}
      </Text>

      {loading && entries.length === 0 ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucune transaction trouvée.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleItems.map((e) => {
            const positive = e.amount >= 0;
            return (
              <View key={e.id} style={styles.rowCard}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowTitle}>{e.title}</Text>
                  <Text style={styles.rowSub}>{e.subtitle}</Text>
                  <Text style={styles.rowDate}>
                    {formatFullDateTime(e.createdAt)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 5 }}>
                  <Text
                    style={[
                      styles.rowAmt,
                      { color: positive ? COLORS.win : COLORS.ink },
                    ]}
                  >
                    {positive ? `+${eur(e.amount)}` : eur(e.amount)}
                  </Text>
                  {e.canCancel && e.rawId ? (
                    <Pressable
                      onPress={() => handleCancelWithdrawal(e.rawId)}
                      style={styles.cancelPill}
                    >
                      <Text style={styles.cancelPillText}>Annuler</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.statusText}>{e.status}</Text>
                  )}
                </View>
              </View>
            );
          })}
          <InfiniteScrollLoader hasMore={hasMore} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.deep },
  content: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 26 },
  topSection: { gap: 10, marginBottom: 4 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { fontSize: 17, fontWeight: "800", color: COLORS.ink },
  kpiRow: { flexDirection: "row", gap: 8 },
  kpiBox: {
    flex: 1,
    borderRadius: 13,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 10,
    gap: 2,
  },
  kpiLabel: { fontSize: 10.5, fontWeight: "600", color: COLORS.dim },
  kpiVal: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  countLine: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
    marginTop: 4,
    marginBottom: 8,
  },
  loader: { paddingVertical: 36, alignItems: "center" },
  list: { gap: 9 },
  emptyCard: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 24,
    alignItems: "center",
  },
  emptyText: { fontSize: 13, fontWeight: "600", color: COLORS.dim },
  rowCard: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowTitle: { fontSize: 13.5, fontWeight: "800", color: COLORS.ink },
  rowSub: { fontSize: 12, color: COLORS.mist },
  rowDate: { fontSize: 10.5, color: COLORS.dim },
  rowAmt: {
    fontSize: 14.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  statusText: { fontSize: 10.5, fontWeight: "700", color: COLORS.dim },
  cancelPill: {
    borderRadius: 7,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cancelPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
});
