import React, { useCallback, useMemo, useState } from "react";
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
import { CheckCircle2, ChevronDown, ChevronRight, Search, X } from "lucide-react-native";
import { api, type ClientPredictionQuestion } from "@/lib/api";
import { getCachedPredictionsList } from "@/lib/entity-cache";
import { eur, formatKickoff, formatOdds } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  BareInfiniteSpinner,
  INFINITE_BATCH_STEP,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

export function PredictionCard({
  q,
  defaultExpanded = false,
}: {
  q: ClientPredictionQuestion;
  defaultExpanded?: boolean;
}) {
  const router = useRouter();
  const {
    oddsFormat,
    comboLegs,
    isInCombo,
    toggleComboLeg,
    openPredictionBet,
    hapticsEnabled,
    toast,
  } = useApp();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isMulti = Boolean(q.options && q.options.length >= 2);
  const isResolved = q.status === "resolved";
  const marketKey = isMulti ? "multichoice" : "yesno";

  const handleSelect = (
    selection: string,
    selectionLabel: string,
    odds: number,
    longPress = false
  ) => {
    if (isResolved || q.myBet) return;
    if (longPress || comboLegs.length >= 1) {
      const res = toggleComboLeg({
        kind: "prediction",
        questionId: q.id,
        title: q.question,
        league: q.category,
        market: marketKey,
        selection,
        selectionLabel,
        odds,
        startsAt: q.resolvesAt,
        isLive: false,
      });
      if (res === "added" && longPress) {
        toast({
          kind: "info",
          title: "Ajouté au Betslip",
          subtitle: selectionLabel,
        });
      } else if (res === "full") {
        toast({ kind: "error", title: "Maximum 8 sélections dans le Betslip" });
      }
      return;
    }

    openPredictionBet({
      question: q,
      selection,
      selectionLabel,
      odds,
    });
  };

  const optionsToShow =
    isMulti && q.options
      ? expanded || q.options.length <= 2
        ? q.options
        : q.options.slice(0, 2)
      : [];

  return (
    <Pressable
      onPress={() => {
        triggerHaptic("light", hapticsEnabled);
        router.push(`/predictions/${q.id}`);
      }}
      style={[cardSurface.glassCard, styles.card]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.catBadge}>{q.category}</Text>
        <View style={styles.topRight}>
          <Text style={styles.deadlineText}>
            {isResolved ? "Résolu" : formatKickoff(q.resolvesAt)}
          </Text>
          <ChevronRight size={13} color={colors.dim} strokeWidth={2.4} />
        </View>
      </View>

      <Text style={styles.questionText}>{q.question}</Text>

      {q.myBet && (
        <View style={styles.myBetPill}>
          <CheckCircle2 size={13} color={colors.win} strokeWidth={2.4} />
          <Text numberOfLines={1} style={styles.myBetText}>
            Votre pronostic : {q.myBet.selectionLabel} ({eur(q.myBet.stake)} · ×
            {formatOdds(q.myBet.odds, oddsFormat)})
          </Text>
        </View>
      )}

      {isResolved ? (
        <View style={styles.resolvedBox}>
          <Text style={styles.resolvedLabel}>Issue officielle :</Text>
          <Text style={styles.resolvedOutcome}>
            {isMulti
              ? (q.options?.find((o) => o.key === q.outcome)?.label ??
                q.outcome ??
                "—")
              : q.outcome === "yes"
                ? "OUI"
                : q.outcome === "no"
                  ? "NON"
                  : "Annulé"}
          </Text>
        </View>
      ) : isMulti && q.options ? (
        <View style={{ gap: 7 }}>
          {optionsToShow.map((opt) => {
            const selected = isInCombo(
              "prediction",
              q.id,
              marketKey,
              opt.key
            );
            return (
              <Pressable
                key={opt.key}
                disabled={Boolean(q.myBet)}
                onPress={(e) => {
                  e.stopPropagation();
                  handleSelect(opt.key, opt.label, opt.odds, false);
                }}
                onLongPress={(e) => {
                  e.stopPropagation();
                  handleSelect(opt.key, opt.label, opt.odds, true);
                }}
                style={[
                  styles.multiOptBtn,
                  selected && styles.multiOptBtnSelected,
                  Boolean(q.myBet) && { opacity: 0.6 },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.multiOptLabel,
                    selected && { color: colors.white },
                  ]}
                >
                  {opt.label}
                </Text>
                <Text
                  style={[
                    styles.multiOptOdds,
                    selected && { color: colors.white },
                  ]}
                >
                  {formatOdds(opt.odds, oddsFormat)}
                </Text>
              </Pressable>
            );
          })}

          {q.options.length > 2 && !expanded && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                triggerHaptic("light", hapticsEnabled);
                setExpanded(true);
              }}
              style={styles.showMoreBtn}
            >
              <Text style={styles.showMoreText}>
                Voir tout ({q.options.length} choix)
              </Text>
              <ChevronDown
                size={13.5}
                color={colors.betclicRed}
                strokeWidth={2.5}
              />
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.binaryRow}>
          {(
            [
              { key: "yes", label: "Oui", odds: q.oddsYes },
              { key: "no", label: "Non", odds: q.oddsNo },
            ] as const
          ).map((side) => {
            const selected = isInCombo(
              "prediction",
              q.id,
              marketKey,
              side.key
            );
            return (
              <Pressable
                key={side.key}
                disabled={Boolean(q.myBet)}
                onPress={(e) => {
                  e.stopPropagation();
                  handleSelect(side.key, side.label, side.odds, false);
                }}
                onLongPress={(e) => {
                  e.stopPropagation();
                  handleSelect(side.key, side.label, side.odds, true);
                }}
                style={[
                  styles.binaryBtn,
                  selected && styles.multiOptBtnSelected,
                  Boolean(q.myBet) && { opacity: 0.6 },
                ]}
              >
                <Text
                  style={[
                    styles.binaryLabel,
                    selected && { color: "rgba(255,255,255,0.85)" },
                  ]}
                >
                  {side.label}
                </Text>
                <Text
                  style={[
                    styles.multiOptOdds,
                    selected && { color: colors.white },
                  ]}
                >
                  {formatOdds(side.odds, oddsFormat)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

export default function PredictionsScreen() {
  const { user, dataSaverMode } = useApp();
  const [questions, setQuestions] = useState<ClientPredictionQuestion[] | null>(
    () => getCachedPredictionsList()
  );
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadPredictions = useCallback(async () => {
    try {
      const res = await api.predictions(Boolean(user));
      setQuestions(res.questions);
    } catch {
      // Conserve le cache
    }
  }, [user]);

  useSmartPolling(loadPredictions, 18_000, {
    enabled: true,
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions ?? []) {
      if (q.category) set.add(q.category);
    }
    return Array.from(set);
  }, [questions]);

  const qNorm = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return (questions ?? []).filter((q) => {
      if (statusFilter === "open" && q.status !== "open") return false;
      if (statusFilter === "resolved" && q.status !== "resolved") return false;
      if (categoryFilter !== "all" && q.category !== categoryFilter) return false;
      const isMulti = Boolean(q.options && q.options.length >= 2);
      if (formatFilter === "multi" && !isMulti) return false;
      if (formatFilter === "binary" && isMulti) return false;
      if (
        qNorm &&
        !q.question.toLowerCase().includes(qNorm) &&
        !q.category.toLowerCase().includes(qNorm)
      ) {
        return false;
      }
      return true;
    });
  }, [categoryFilter, formatFilter, qNorm, questions, statusFilter]);

  const resetKey = `${statusFilter}|${categoryFilter}|${formatFilter}|${qNorm}`;
  const { visibleCount, hasMore, loadMore } = useInfiniteBatch(
    filtered.length,
    resetKey,
    INFINITE_BATCH_STEP
  );

  const visibleItems = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );

  return (
    <View style={styles.root}>
      <View style={styles.topHeader}>
        <Text style={styles.pageTitle}>Prédictions</Text>
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
            placeholder="Rechercher un pronostic…"
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
              defaultValue: "open",
              options: [
                { value: "open", label: "En cours" },
                { value: "resolved", label: "Résolues" },
                { value: "all", label: "Toutes" },
              ],
              onChange: setStatusFilter,
            },
            {
              id: "cat",
              label: "Catégorie",
              value: categoryFilter,
              options: [
                { value: "all", label: "Toutes catégories" },
                ...categories.map((c) => ({ value: c, label: c })),
              ],
              onChange: setCategoryFilter,
            },
            {
              id: "fmt",
              label: "Format",
              value: formatFilter,
              options: [
                { value: "all", label: "Tous formats" },
                { value: "multi", label: "Choix multiples" },
                { value: "binary", label: "Oui / Non" },
              ],
              onChange: setFormatFilter,
            },
          ]}
          onReset={() => {
            setStatusFilter("open");
            setCategoryFilter("all");
            setFormatFilter("all");
            setSearch("");
          }}
          resultCountLabel={`${filtered.length} prédiction${filtered.length > 1 ? "s" : ""}`}
        />
      </View>

      <FlatList<ClientPredictionQuestion>
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
              await loadPredictions();
              setRefreshing(false);
            }}
            tintColor={colors.betclicRed}
            colors={[colors.betclicRed]}
          />
        }
        ListEmptyComponent={
          !questions ? (
            <BareInfiniteSpinner visible />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Aucune prédiction pour ces critères.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <PredictionCard q={item} />}
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
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  catBadge: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    color: colors.betclicRed,
    letterSpacing: 0.3,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  deadlineText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.dim,
  },
  questionText: {
    fontSize: 14.5,
    lineHeight: 19.5,
    fontWeight: "800",
    color: colors.ink,
  },
  myBetPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#f0fdf4",
  },
  myBetText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.win,
  },
  resolvedBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.elev,
  },
  resolvedLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.mist,
  },
  resolvedOutcome: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.ink,
  },
  multiOptBtn: {
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  multiOptBtnSelected: {
    backgroundColor: colors.betclicRed,
    borderColor: colors.betclicRed,
  },
  multiOptLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
  },
  multiOptOdds: {
    fontSize: 13.5,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  showMoreBtn: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  showMoreText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  binaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  binaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  binaryLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.mist,
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
