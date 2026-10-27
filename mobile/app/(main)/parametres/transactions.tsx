import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "@/lib/router";
import { ArrowLeft } from "@/components/icons";
import { api, type ClientWalletEntry, type ClientWalletResponse } from "@/lib/api";
import { getCachedWalletSnapshot } from "@/lib/entity-cache";
import { eur, formatPlacedAt } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  BareInfiniteSpinner,
  INFINITE_BATCH_STEP,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page dédiée `/parametres/transactions` fidèle à `src/app/(main)/parametres/transactions/page.tsx`.
 */
export default function TransactionsScreen() {
  const router = useRouter();
  const { setBalance, dataSaverMode, toast } = useApp();

  const [wallet, setWallet] = useState<ClientWalletResponse | null>(() =>
    getCachedWalletSnapshot()
  );
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.wallet();
      setWallet(res);
      setBalance(res.balance);
    } catch {
      // Conserve le snapshot
    }
  }, [setBalance]);

  useSmartPolling(load, 20_000, {
    enabled: true,
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const filtered = useMemo(() => {
    return (wallet?.entries ?? []).filter((e) => {
      if (typeFilter === "all") return true;
      return e.type === typeFilter;
    });
  }, [typeFilter, wallet?.entries]);

  const { visibleCount, hasMore, loadMore } = useInfiniteBatch(
    filtered.length,
    typeFilter,
    INFINITE_BATCH_STEP
  );

  const visibleItems = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );

  const handleCancel = async (rawId: number) => {
    try {
      const res = await api.withdrawals.cancel(rawId);
      setBalance(res.balance);
      await load();
      toast({ kind: "success", title: "Retrait annulé et remboursé" });
    } catch (err) {
      toast({
        kind: "error",
        title: "Annulation impossible",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.topHeader}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.pageTitle}>Mouvements</Text>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <FilterDropdownRow
          filters={[
            {
              id: "type",
              label: "Type",
              value: typeFilter,
              options: [
                { value: "all", label: "Tous les mouvements" },
                { value: "deposit", label: "Dépôts" },
                { value: "withdrawal", label: "Retraits" },
                { value: "stake", label: "Mises" },
                { value: "win", label: "Gains" },
                { value: "cashout", label: "Cash Out" },
              ],
              onChange: setTypeFilter,
            },
          ]}
          onReset={() => setTypeFilter("all")}
          resultCountLabel={`${filtered.length} opération${filtered.length > 1 ? "s" : ""}`}
        />
      </View>

      <FlatList<ClientWalletEntry>
        data={visibleItems}
        keyExtractor={(item) => item.id}
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
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.betclicRed}
            colors={[colors.betclicRed]}
          />
        }
        ListEmptyComponent={
          !wallet ? (
            <BareInfiniteSpinner visible />
          ) : (
            <View style={[cardSurface.glassCard, styles.emptyCard]}>
              <Text style={styles.emptyText}>Aucune opération enregistrée.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={[cardSurface.glassCard, styles.rowCard]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={styles.title}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.sub}>
                {item.subtitle} · {formatPlacedAt(item.createdAt)}
              </Text>
            </View>
            <View style={styles.rightCol}>
              <Text
                style={[
                  styles.amount,
                  item.amount > 0 && { color: colors.win },
                  item.amount < 0 && { color: colors.ink },
                ]}
              >
                {item.amount > 0 ? `+${eur(item.amount)}` : eur(item.amount)}
              </Text>
              {item.canCancel && item.rawId != null && (
                <Pressable
                  onPress={() => {
                    if (item.rawId != null) void handleCancel(item.rawId);
                  }}
                  style={styles.cancelChip}
                >
                  <Text style={styles.cancelText}>Annuler</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListFooterComponent={<BareInfiniteSpinner visible={hasMore} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.deep },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: { fontSize: 18, fontWeight: "900", color: colors.ink },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  rowCard: {
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: { fontSize: 13.5, fontWeight: "800", color: colors.ink },
  sub: { fontSize: 11.5, color: colors.dim, fontWeight: "500" },
  rightCol: { alignItems: "flex-end", gap: 4 },
  amount: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.dim,
    fontVariant: ["tabular-nums"],
  },
  cancelChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: "rgba(225,0,20,0.10)",
  },
  cancelText: { fontSize: 11, fontWeight: "800", color: colors.betclicRed },
  emptyCard: { padding: 20, alignItems: "center" },
  emptyText: { fontSize: 13, fontWeight: "600", color: colors.mist },
});
