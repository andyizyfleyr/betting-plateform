import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  X,
} from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { useApp } from "@/context/app-context";
import {
  api,
  type ClientWalletData,
  type ClientWalletEntry,
} from "@/lib/api";
import {
  getCachedWallet,
  getCachedWalletUpdatedAt,
} from "@/lib/entity-cache";
import { eur, formatPlacedAt } from "@/lib/format";
import { createIdempotencyKey } from "@/lib/http";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

type TxKindFilter = "all" | "credits" | "debits" | "withdrawals" | "deposits";

function walletTxSignature(w: ClientWalletData | null): string {
  if (!w) return "";
  const first = w.entries[0];
  return [
    w.balance.toFixed(6),
    w.entries.length,
    first ? `${first.id}:${first.status}:${first.amount.toFixed(6)}` : "",
  ].join("|");
}

const TransactionRow = memo(function TransactionRow({
  item,
  cancelling,
  onCancel,
}: {
  item: ClientWalletEntry;
  cancelling: boolean;
  onCancel: (rawId: number) => void;
}) {
  const positive = item.amount >= 0;
  const canCancel = Boolean(
    item.type === "withdrawal" && item.canCancel && item.rawId != null
  );

  return (
    <View style={styles.txRow}>
      <View style={styles.txLeft}>
        <View
          style={[
            styles.txIconCircle,
            positive ? styles.txIconPos : styles.txIconNeg,
          ]}
        >
          {positive ? (
            <ArrowDownLeft size={14} color={COLORS.win} strokeWidth={2.3} />
          ) : (
            <ArrowUpRight size={14} color={COLORS.mist} strokeWidth={2.3} />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.txTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.txSub}>
            {item.subtitle} · {formatPlacedAt(item.createdAt)}
          </Text>
        </View>
      </View>

      <View style={styles.txRight}>
        <Text style={[styles.txAmount, positive && { color: COLORS.win }]}>
          {positive ? `+${eur(item.amount)}` : `-${eur(Math.abs(item.amount))}`}
        </Text>
        {canCancel ? (
          <Pressable
            disabled={cancelling}
            onPress={() => item.rawId != null && onCancel(item.rawId)}
            style={styles.cancelBtn}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color={COLORS.ink} />
            ) : (
              <X size={12} color={COLORS.betclicRed} strokeWidth={2.4} />
            )}
            <Text style={styles.cancelBtnText}>Annuler</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

export default function TransactionsScreen() {
  const router = useRouter();
  const { authReady, sessionRestoring, user, setBalance, toast, betsVersion } =
    useApp();

  const userId = user?.id ?? null;
  const userBalance = user?.balance ?? 0;
  const userBalanceRef = useRef(userBalance);
  useEffect(() => {
    userBalanceRef.current = userBalance;
  }, [userBalance]);

  const [wallet, setWallet] = useState<ClientWalletData | null>(() =>
    getCachedWallet()
  );
  const [kindFilter, setKindFilter] = useState<TxKindFilter>("all");
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const cancelSlotRef = useRef<Map<number, string>>(new Map());
  const cancelInFlightRef = useRef(false);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (userId == null && !sessionRestoring) return;
      try {
        const w = await api.wallet({ forceRefresh });
        setWallet((prev) =>
          walletTxSignature(prev) === walletTxSignature(w) ? prev : w
        );
        if (
          typeof w.balance === "number" &&
          Math.abs(userBalanceRef.current - w.balance) > 1e-5
        ) {
          setBalance(w.balance);
        }
      } catch {
        /* silencieux */
      }
    },
    [sessionRestoring, setBalance, userId]
  );

  useEffect(() => {
    if (userId == null && !sessionRestoring) return;
    const cached = getCachedWallet();
    const freshEnough =
      cached !== null && Date.now() - getCachedWalletUpdatedAt() < 4_500;

    let interactionTask: ReturnType<
      typeof InteractionManager.runAfterInteractions
    > | null = null;
    if (!freshEnough) {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        void load(false);
      });
    }

    const id = setInterval(() => void load(false), 8_000);
    return () => {
      interactionTask?.cancel();
      clearInterval(id);
    };
  }, [load, betsVersion, sessionRestoring, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const cancelWithdrawal = useCallback(
    async (withdrawalId: number) => {
      if (cancellingId != null || cancelInFlightRef.current) return;
      cancelInFlightRef.current = true;
      const idemKey =
        cancelSlotRef.current.get(withdrawalId) ??
        createIdempotencyKey("wdcancel");
      cancelSlotRef.current.set(withdrawalId, idemKey);
      setCancellingId(withdrawalId);
      try {
        const res = await api.cancelWithdrawal(withdrawalId, idemKey);
        cancelSlotRef.current.delete(withdrawalId);
        setBalance(res.balance);
        void load(true);
        toast({ kind: "success", title: "Retrait annulé et recrédité" });
      } catch (e) {
        toast({
          kind: "error",
          title: "Annulation impossible",
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        cancelInFlightRef.current = false;
        setCancellingId(null);
      }
    },
    [cancellingId, load, setBalance, toast]
  );

  const filteredTx = useMemo(() => {
    const src = wallet?.entries;
    if (!src || src.length === 0) return [];
    const list = [...src].sort((a, b) =>
      a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1
    );
    if (kindFilter === "credits") return list.filter((t) => t.amount > 0);
    if (kindFilter === "debits") return list.filter((t) => t.amount < 0);
    if (kindFilter === "withdrawals") {
      return list.filter((t) => t.type === "withdrawal");
    }
    if (kindFilter === "deposits") {
      return list.filter((t) => t.type === "deposit");
    }
    return list;
  }, [wallet, kindFilter]);

  const { visibleItems: visibleTx, hasMore, onScrollCheck } = useInfiniteBatch(
    filteredTx,
    10,
    kindFilter
  );

  if ((!authReady || sessionRestoring) && !user) {
    return (
      <View style={styles.page}>
        <PulseFlashLoader compact />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.page, styles.guestWrap]}>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            Connectez-vous pour consulter vos mouvements
          </Text>
          <Pressable
            onPress={() => router.push("/auth?mode=login")}
            style={styles.redBtn}
          >
            <Text style={styles.redBtnText}>Connexion</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[1]}
      showsVerticalScrollIndicator={false}
      overScrollMode="never"
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
      {/* 0 : En-tête compact identique à src/app/(main)/parametres/transactions/page.tsx */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back("/parametres")}
          style={({ pressed }) => [
            styles.roundBackBtn,
            pressed && { transform: [{ scale: 0.95 }] },
          ]}
        >
          <ArrowLeft size={14} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          Mouvements
        </Text>
      </View>

      {/* 1 : Filtre dropdown collant */}
      <View style={styles.stickyFilterWrap}>
        <FilterDropdownRow
          filters={[
            {
              id: "kind",
              placeholder: "Mouvement",
              value: kindFilter,
              defaultValue: "all",
              onChange: (v) => setKindFilter(v as TxKindFilter),
              options: [
                { value: "all", label: "Tous les mouvements" },
                { value: "credits", label: "Crédits & gains (+)" },
                { value: "debits", label: "Mises & débits (-)" },
                { value: "deposits", label: "Dépôts" },
                { value: "withdrawals", label: "Retraits" },
              ],
            },
          ]}
          onReset={() => setKindFilter("all")}
          resultCountText={
            wallet
              ? `${filteredTx.length} ${
                  filteredTx.length > 1 ? "mouvements" : "mouvement"
                }`
              : null
          }
        />
      </View>

      {/* 2 : Liste */}
      {wallet === null ? (
        <PulseFlashLoader compact />
      ) : visibleTx.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            Aucun mouvement dans cette catégorie
          </Text>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {visibleTx.map((t) => (
            <TransactionRow
              key={t.id}
              item={t}
              cancelling={cancellingId === t.rawId}
              onCancel={cancelWithdrawal}
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
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 28,
  },
  guestWrap: {
    paddingHorizontal: 8,
    paddingTop: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roundBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  stickyFilterWrap: {
    backgroundColor: COLORS.deep,
  },
  loaderBox: {
    paddingVertical: 44,
    alignItems: "center",
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 16,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
  },
  redBtn: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  redBtnText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  txRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  txLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  txIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  txIconPos: {
    backgroundColor: "rgba(21,128,61,0.12)",
  },
  txIconNeg: {
    backgroundColor: COLORS.elev,
  },
  txTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.ink,
  },
  txSub: {
    fontSize: 10,
    color: COLORS.dim,
  },
  txRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  txAmount: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  cancelBtn: {
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cancelBtnText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
});
