import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Check,
  ChevronRight,
  Search,
  Sparkles,
  X,
} from "lucide-react-native";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { KickoffCountdown } from "@/components/kickoff-countdown";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { useApp } from "@/context/app-context";
import { api, type ClientPrediction } from "@/lib/api";
import { getCachedPredictionsList } from "@/lib/entity-cache";
import { eur, formatOdds } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

function OptionOddsBtn({
  label,
  odds,
  oddsFormat,
  selected,
  disabled,
  onPress,
  onLongPress,
}: {
  label: string;
  odds: number;
  oddsFormat: "decimal" | "fractional";
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const trend = useOddsTrend(odds);
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[
        styles.optBtn,
        selected ? styles.optBtnSelected : styles.optBtnIdle,
        disabled && { opacity: 0.55 },
      ]}
    >
      <OddsTrendCorner trend={trend} inverted={selected} />
      <View style={styles.optLeft}>
        {selected ? (
          <Check size={12} color="#ffffff" strokeWidth={3} />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.optLabel,
            selected && { color: "rgba(255,255,255,0.88)" },
          ]}
        >
          {label}
        </Text>
      </View>
      <Text
        style={[
          styles.optOdds,
          { color: oddsTrendTextColor(trend, selected) },
        ]}
      >
        {formatOdds(odds, oddsFormat)}
      </Text>
    </Pressable>
  );
}

function PredictionCard({ item }: { item: ClientPrediction }) {
  const router = useRouter();
  const {
    oddsFormat,
    openPredictionBet,
    toggleComboLeg,
    isInCombo,
    comboQuickMode,
    toast,
  } = useApp();

  const uid = `pred-${item.id}`;
  const isResolved = item.status === "resolved";
  const allOptions =
    item.options && item.options.length > 0
      ? item.options
      : [
          { key: "yes", label: "Oui", odds: item.oddsYes },
          { key: "no", label: "Non", odds: item.oddsNo },
        ];

  // Contrainte stricte : afficher 2 options par défaut quand > 2 existent, avec « Voir tout »
  const hasMoreOptions = allOptions.length > 2;
  const visibleOptions = hasMoreOptions ? allOptions.slice(0, 2) : allOptions;

  const handleCombo = (opt: { key: string; label: string; odds: number }) => {
    const res = toggleComboLeg({
      uid,
      kind: "prediction",
      questionId: item.id,
      title: item.question,
      league: item.category,
      market: "prediction",
      selection: opt.key,
      selectionLabel: opt.label,
      odds: opt.odds,
      startsAt: item.resolvesAt,
      isLive: false,
    });
    if (res === "full") {
      toast({
        kind: "error",
        title: "Combiné complet",
        description: "Maximum 8 sélections par ticket combiné.",
      });
    }
  };

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => router.push(`/predictions/${item.id}`)}
        style={styles.cardTop}
      >
        <View style={styles.metaRow}>
          <View style={styles.catTag}>
            <Sparkles size={11.5} color={COLORS.betclicRed} strokeWidth={2.4} />
            <Text style={styles.catText}>{item.category}</Text>
          </View>
          {isResolved ? (
            <View style={styles.resolvedPill}>
              <Text style={styles.resolvedText}>Résolue</Text>
            </View>
          ) : (
            <KickoffCountdown startsAt={item.resolvesAt} />
          )}
        </View>

        <Text style={styles.questionText}>{item.question}</Text>

        {item.myBet ? (
          <View style={styles.myBetPill}>
            <Text style={styles.myBetText}>
              Ma mise : {eur(item.myBet.stake)} sur{" "}
              {item.myBet.selectionLabel ?? item.myBet.selection} @{" "}
              {formatOdds(item.myBet.odds, oddsFormat)}
            </Text>
          </View>
        ) : null}
      </Pressable>

      {isResolved ? (
        <View style={styles.resolutionBar}>
          <Text style={styles.resolutionText}>
            Issue officielle :{" "}
            {allOptions.find((o) => o.key === item.resolution)?.label ??
              item.resolution ??
              "—"}
          </Text>
        </View>
      ) : (
        <View style={styles.optionsBlock}>
          <View style={styles.optsGrid}>
            {visibleOptions.map((opt) => (
              <View key={opt.key} style={{ flex: 1 }}>
                <OptionOddsBtn
                  label={opt.label}
                  odds={opt.odds}
                  oddsFormat={oddsFormat}
                  selected={isInCombo(uid, "prediction", opt.key)}
                  onPress={() => {
                    if (comboQuickMode) {
                      handleCombo(opt);
                    } else {
                      openPredictionBet({
                        question: item,
                        selection: opt.key,
                      });
                    }
                  }}
                  onLongPress={() => handleCombo(opt)}
                />
              </View>
            ))}
          </View>

          {hasMoreOptions ? (
            <Pressable
              onPress={() => router.push(`/predictions/${item.id}`)}
              style={styles.seeAllBtn}
            >
              <Text style={styles.seeAllText}>
                Voir tout ({allOptions.length} choix)
              </Text>
              <ChevronRight
                size={13}
                color={COLORS.betclicRed}
                strokeWidth={2.5}
              />
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

export default function PredictionsListScreen() {
  const { user, betsVersion, dataSaverMode } = useApp();

  const [questions, setQuestions] = useState<ClientPrediction[]>(
    () => getCachedPredictionsList() ?? []
  );
  const [loading, setLoading] = useState<boolean>(
    () => getCachedPredictionsList() === null
  );
  const [refreshing, setRefreshing] = useState(false);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">(
    "open"
  );
  const [catFilter, setCatFilter] = useState<string>("all");
  const [mineFilter, setMineFilter] = useState<"all" | "mine">("all");

  const loadData = useCallback(async () => {
    try {
      const [catRes, myRes] = await Promise.all([
        api.predictionsCatalog(),
        user
          ? api.myPredictionBets().catch(() => ({ myBets: {} }))
          : Promise.resolve({ myBets: {} }),
      ]);
      const map = myRes.myBets as Record<number, ClientPrediction["myBet"]>;
      setQuestions(
        catRes.questions.map((q) => ({
          ...q,
          myBet: map[q.id] ?? q.myBet ?? null,
        }))
      );
    } catch {
      /* garde le snapshot */
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadData();
  }, [loadData, betsVersion]);

  useSmartPolling(loadData, 10_000, {
    enabled: true,
    dataSaver: dataSaverMode,
    runImmediately: false,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const q of questions) {
      if (q.category) s.add(q.category);
    }
    return Array.from(s);
  }, [questions]);

  const filtered = useMemo(() => {
    const qNorm = query.trim().toLowerCase();
    return questions.filter((q) => {
      if (statusFilter !== "all" && q.status !== statusFilter) return false;
      if (catFilter !== "all" && q.category !== catFilter) return false;
      if (mineFilter === "mine" && !q.myBet) return false;
      if (
        qNorm &&
        !q.question.toLowerCase().includes(qNorm) &&
        !q.category.toLowerCase().includes(qNorm)
      ) {
        return false;
      }
      return true;
    });
  }, [catFilter, mineFilter, query, questions, statusFilter]);

  const resetKey = `${statusFilter}|${catFilter}|${mineFilter}|${query}`;
  const { visibleItems, hasMore, onScrollCheck } = useInfiniteBatch(
    filtered,
    10,
    resetKey
  );

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
      <View style={styles.topSection}>
        <Text style={styles.pageTitle}>Prédictions</Text>
        <View style={styles.searchBar}>
          <Search size={16} color={COLORS.dim} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher une question ou un thème…"
            placeholderTextColor={COLORS.dim}
            style={styles.searchInput}
          />
          {query.length > 0 ? (
            <Pressable hitSlop={8} onPress={() => setQuery("")}>
              <X size={16} color={COLORS.dim} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FilterDropdownRow
        filters={[
          {
            id: "status",
            label: "Statut",
            value: statusFilter,
            defaultValue: "open",
            onChange: setStatusFilter,
            options: [
              {
                value: "open",
                label: "Ouvertes",
                count: questions.filter((q) => q.status === "open").length,
              },
              {
                value: "resolved",
                label: "Résolues",
                count: questions.filter((q) => q.status === "resolved").length,
              },
              { value: "all", label: "Toutes", count: questions.length },
            ],
          },
          {
            id: "cat",
            label: "Catégorie",
            value: catFilter,
            defaultValue: "all",
            onChange: setCatFilter,
            options: [
              { value: "all", label: "Toutes catégories" },
              ...categories.map((c) => ({ value: c, label: c })),
            ],
          },
          ...(user
            ? [
                {
                  id: "mine",
                  label: "Mes mises",
                  value: mineFilter,
                  defaultValue: "all" as const,
                  onChange: setMineFilter,
                  options: [
                    { value: "all" as const, label: "Toutes les questions" },
                    { value: "mine" as const, label: "Avec ma mise" },
                  ],
                },
              ]
            : []),
        ]}
        onReset={() => {
          setStatusFilter("open");
          setCatFilter("all");
          setMineFilter("all");
          setQuery("");
        }}
      />

      <Text style={styles.countLine}>
        {filtered.length} prédiction{filtered.length > 1 ? "s" : ""}
      </Text>

      {loading && questions.length === 0 ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            Aucune prédiction ne correspond à ces filtres.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleItems.map((q) => (
            <PredictionCard key={q.id} item={q} />
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
  topSection: {
    gap: 8,
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
  },
  searchBar: {
    height: 40,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "500",
    color: COLORS.ink,
    paddingVertical: 0,
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
  },
  emptyText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.dim,
    textAlign: "center",
  },
  card: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 14,
    gap: 11,
  },
  cardTop: {
    gap: 7,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  catTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  catText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
    textTransform: "uppercase",
  },
  resolvedPill: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  resolvedText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.dim,
  },
  questionText: {
    fontSize: 14.5,
    fontWeight: "800",
    color: COLORS.ink,
    lineHeight: 20,
  },
  myBetPill: {
    borderRadius: 9,
    backgroundColor: "rgba(21, 128, 61, 0.09)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  myBetText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.win,
  },
  optionsBlock: {
    gap: 7,
  },
  optsGrid: {
    flexDirection: "row",
    gap: 7,
  },
  optBtn: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    position: "relative",
    overflow: "hidden",
  },
  optBtnIdle: {
    backgroundColor: COLORS.elev,
  },
  optBtnSelected: {
    backgroundColor: COLORS.outerSpace,
  },
  optLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  optLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mist,
    flexShrink: 1,
  },
  optOdds: {
    fontSize: 13.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  seeAllBtn: {
    height: 30,
    borderRadius: 9,
    backgroundColor: "rgba(225, 0, 20, 0.07)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  seeAllText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  resolutionBar: {
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  resolutionText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
});
