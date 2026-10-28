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
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  RefreshCw,
  Search,
  TrendingUp,
  X,
} from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import {
  forceRefreshMobilePredictionsCatalog,
  useMobilePredictionsCatalogQuery,
} from "@/lib/party-realtime";
import { mobileQueryKeys } from "@/lib/query-client";
import {
  InfiniteScrollLoader,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { useApp, type ComboSelection } from "@/context/app-context";
import {
  api,
  type ClientPrediction,
  type PredictionOptionClient,
} from "@/lib/api";
import { eur, formatOdds, formatPlacedAt } from "@/lib/format";
import { useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const POLL_INTERVAL = 20_000;

type Category = "Tous" | "Sport" | "Actus" | "Crypto" | "Culture";
const CATEGORIES: Category[] = ["Tous", "Sport", "Actus", "Crypto", "Culture"];
type FormatFilter = "all" | "multi" | "binary";
type StatusTab = "open" | "resolved";

function isMultiChoiceQuestion(q: ClientPrediction): boolean {
  return Array.isArray(q.options) && q.options.length >= 2;
}

function formatResolves(iso: string, nowMs: number) {
  const diff = new Date(iso).getTime() - nowMs;
  if (diff <= 0) return "Clôturé";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Demain";
  return `${days} j`;
}

export default function PredictionsScreen() {
  const queryClient = useQueryClient();
  const {
    user,
    betsVersion,
    comboQuickMode,
    toggleComboLeg,
    toast,
    hapticsEnabled,
    dataSaverMode,
  } = useApp();

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [category, setCategory] = useState<Category>("Tous");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput | null>(null);

  const [target, setTarget] = useState<{
    question: ClientPrediction;
    selection: string;
  } | null>(null);

  const catalogQuery = useMobilePredictionsCatalogQuery({
    dataSaver: dataSaverMode,
  });

  const catalogQuestions = useMemo(
    () => catalogQuery.data?.questions ?? (catalogQuery.isError ? [] : null),
    [catalogQuery.data, catalogQuery.isError]
  );

  const loadError =
    !catalogQuery.data && catalogQuery.error instanceof Error
      ? catalogQuery.error.message
      : catalogQuery.isError && !catalogQuery.data
        ? "Impossible de charger les prédictions."
        : null;

  useEffect(() => {
    if (catalogQuery.dataUpdatedAt > 0) {
      setNowMs(Date.now());
    }
  }, [catalogQuery.dataUpdatedAt]);

  const myBetsQuery = useQuery({
    queryKey: [...mobileQueryKeys.myPredictionBets(user?.id), betsVersion],
    queryFn: () => api.predictionsMine(),
    enabled: Boolean(user),
    staleTime: 3_000,
    refetchInterval: user ? (dataSaverMode ? 20_000 : 10_000) : false,
    refetchIntervalInBackground: false,
  });

  const myBetsMap = useMemo(
    () => (user ? (myBetsQuery.data?.myBets ?? {}) : {}),
    [myBetsQuery.data, user]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        forceRefreshMobilePredictionsCatalog(queryClient).catch(() =>
          catalogQuery.refetch()
        ),
        user
          ? api.predictions
              .mine({ forceRefresh: true })
              .then((fresh) => {
                queryClient.setQueryData(
                  [...mobileQueryKeys.myPredictionBets(user.id), betsVersion],
                  fresh
                );
              })
              .catch(() => myBetsQuery.refetch())
          : Promise.resolve(),
      ]);
      setNowMs(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, [betsVersion, catalogQuery, myBetsQuery, queryClient, user]);

  const questions = useMemo(() => {
    if (!catalogQuestions) return null;
    return catalogQuestions.map((q) => ({
      ...q,
      myBet: myBetsMap[q.id] ?? null,
    }));
  }, [catalogQuestions, myBetsMap]);

  const qNorm = query.trim().toLowerCase();

  const searchedList = useMemo(() => {
    if (!questions) return [];
    if (!qNorm) return questions;
    return questions.filter(
      (q) =>
        q.question.toLowerCase().includes(qNorm) ||
        q.category.toLowerCase().includes(qNorm) ||
        (q.options ?? []).some((o) => o.label.toLowerCase().includes(qNorm))
    );
  }, [questions, qNorm]);

  const openList = useMemo(
    () =>
      [...searchedList.filter((q) => q.status === "open")].sort(
        (a, b) =>
          new Date(a.resolvesAt).getTime() - new Date(b.resolvesAt).getTime()
      ),
    [searchedList]
  );

  const resolvedList = useMemo(
    () =>
      [...searchedList.filter((q) => q.status !== "open")].sort(
        (a, b) =>
          new Date(b.resolvedAt ?? b.resolvesAt).getTime() -
          new Date(a.resolvedAt ?? a.resolvesAt).getTime()
      ),
    [searchedList]
  );

  const statusPool = statusTab === "open" ? openList : resolvedList;

  const counts = useMemo(() => {
    const map: Record<Category, number> = {
      Tous: statusPool.length,
      Sport: 0,
      Actus: 0,
      Crypto: 0,
      Culture: 0,
    };
    for (const q of statusPool) {
      if (q.category in map) {
        map[q.category as Category] += 1;
      }
    }
    return map;
  }, [statusPool]);

  const categoryFiltered = useMemo(
    () =>
      category === "Tous"
        ? statusPool
        : statusPool.filter((q) => q.category === category),
    [statusPool, category]
  );

  const multiCount = useMemo(
    () => categoryFiltered.filter(isMultiChoiceQuestion).length,
    [categoryFiltered]
  );
  const binaryCount = useMemo(
    () => categoryFiltered.filter((q) => !isMultiChoiceQuestion(q)).length,
    [categoryFiltered]
  );

  const visibleQuestions = useMemo(() => {
    if (formatFilter === "multi")
      return categoryFiltered.filter(isMultiChoiceQuestion);
    if (formatFilter === "binary")
      return categoryFiltered.filter((q) => !isMultiChoiceQuestion(q));
    return categoryFiltered;
  }, [categoryFiltered, formatFilter]);

  const resetKey = `${statusTab}|${category}|${formatFilter}|${qNorm}`;
  const { visibleItems: pagedQuestions, hasMore, onScrollCheck } =
    useInfiniteBatch(visibleQuestions, 10, resetKey);

  const handleSelectOutcome = useCallback(
    (q: ClientPrediction, selection: string, label: string, odds: number) => {
      if (comboQuickMode) {
        const res = toggleComboLeg({
          uid: `pred-${q.id}`,
          kind: "prediction",
          questionId: q.id,
          title: q.question,
          league: q.category,
          market: isMultiChoiceQuestion(q) ? "multichoice" : "yesno",
          selection,
          selectionLabel: label,
          odds,
          startsAt: q.resolvesAt,
        });
        triggerHaptic("light", hapticsEnabled);
        if (res === "full") {
          toast({
            kind: "error",
            title: "Betslip complet (limite atteinte)",
          });
        }
        return;
      }
      setTarget({ question: q, selection });
    },
    [comboQuickMode, hapticsEnabled, toast, toggleComboLeg]
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
    <>
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
        {/* 0 : En-tête identique à src/app/(main)/predictions/page.tsx */}
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Prédictions</Text>
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

        {/* 1 : Barre de recherche mobile dépliable */}
        <View>
          {mobileSearchOpen || query ? (
            <View style={styles.searchBar}>
              <Search size={16} color={COLORS.dim} strokeWidth={2.1} />
              <TextInput
                ref={searchInputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Rechercher une question, un pays, un sujet…"
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

        {/* 2 : Rangée unique collante de 3 pastilles dropdown */}
        <View style={styles.stickyFilterWrap}>
          <FilterDropdownRow
            filters={[
              {
                id: "status",
                placeholder: "Statut",
                value: statusTab,
                defaultValue: "open",
                onChange: setStatusTab,
                options: [
                  {
                    value: "open",
                    label: "Ouvertes",
                    count: questions !== null ? openList.length : undefined,
                  },
                  {
                    value: "resolved",
                    label: "Résolues",
                    count: questions !== null ? resolvedList.length : undefined,
                  },
                ],
              },
              {
                id: "category",
                placeholder: "Catégorie",
                value: category,
                defaultValue: "Tous",
                onChange: setCategory,
                options: CATEGORIES.map((c) => ({
                  value: c,
                  label: c,
                  count: questions !== null ? counts[c] : undefined,
                })),
              },
              {
                id: "format",
                placeholder: "Format",
                value: formatFilter,
                defaultValue: "all",
                onChange: setFormatFilter,
                options: [
                  {
                    value: "all",
                    label: "Tous formats",
                    count:
                      questions !== null ? categoryFiltered.length : undefined,
                  },
                  {
                    value: "multi",
                    label: "Choix multiples",
                    count: questions !== null ? multiCount : undefined,
                  },
                  {
                    value: "binary",
                    label: "Oui / Non",
                    count: questions !== null ? binaryCount : undefined,
                  },
                ],
              },
            ]}
            onReset={() => {
              setStatusTab("open");
              setCategory("Tous");
              setFormatFilter("all");
            }}
            resultCountText={
              questions !== null
                ? `${visibleQuestions.length} prédiction${
                    visibleQuestions.length > 1 ? "s" : ""
                  }`
                : null
            }
          />
        </View>

        {/* 3 : Liste des questions */}
        {questions === null ? (
          <PulseFlashLoader compact />
        ) : loadError && questions.length === 0 ? (
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
                void onRefresh();
              }}
              style={styles.retryBtn}
            >
              <RefreshCw size={14} color="#ffffff" strokeWidth={2.3} />
              <Text style={styles.retryBtnText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : visibleQuestions.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyCircle}>
              <TrendingUp size={20} color={COLORS.dim} strokeWidth={1.9} />
            </View>
            <Text style={styles.emptyTitle}>
              {statusTab === "resolved"
                ? "Aucune prédiction résolue dans ce filtre"
                : "Aucune prédiction disponible"}
            </Text>
            <Text style={styles.emptySub}>
              Modifiez ou réinitialisez les filtres pour élargir les résultats.
            </Text>
          </View>
        ) : statusTab === "resolved" ? (
          <View style={styles.cardStack}>
            {pagedQuestions.map((q) => (
              <ResolvedQuestionCard key={q.id} q={q} />
            ))}
            <InfiniteScrollLoader hasMore={hasMore} />
          </View>
        ) : (
          <View style={styles.cardStack}>
            {pagedQuestions.map((q) =>
              isMultiChoiceQuestion(q) && q.options ? (
                <MultiChoiceQuestionCard
                  key={q.id}
                  q={q}
                  options={q.options}
                  nowMs={nowMs}
                  onSelect={(selection, label, odds) =>
                    handleSelectOutcome(q, selection, label, odds)
                  }
                />
              ) : (
                <BinaryQuestionCard
                  key={q.id}
                  q={q}
                  nowMs={nowMs}
                  onSelect={(selection) =>
                    handleSelectOutcome(
                      q,
                      selection,
                      selection === "yes" ? "Oui" : "Non",
                      selection === "yes" ? q.oddsYes : q.oddsNo
                    )
                  }
                />
              )
            )}
            <InfiniteScrollLoader hasMore={hasMore} />
          </View>
        )}
      </ScrollView>

      <PredictionBetModal
        question={target?.question ?? null}
        selection={target?.selection ?? null}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

function ResolvedQuestionCard({ q }: { q: ClientPrediction }) {
  const router = useRouter();
  const { oddsFormat } = useApp();

  const winner = useMemo(() => {
    if (Array.isArray(q.options) && q.options.length >= 2) {
      const opt = q.options.find((o) => o.key === q.resolution);
      return {
        label: opt?.label ?? q.resolution ?? "Résolu",
        odds: opt?.odds ?? null,
      };
    }
    return {
      label: q.resolution === "yes" ? "Oui" : "Non",
      odds: q.resolution === "yes" ? q.oddsYes : q.oddsNo,
    };
  }, [q]);

  return (
    <Pressable
      onPress={() => router.push(`/predictions/${q.id}`)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.94 }]}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.catBadge}>
          <Text style={styles.catBadgeText}>{q.category}</Text>
        </View>
        <Text style={styles.cardTimeText}>
          {q.resolvedAt ? `Résolu · ${formatPlacedAt(q.resolvedAt)}` : "Résolu"}
        </Text>
      </View>

      <Text style={styles.questionTextBold}>{q.question}</Text>

      <View style={styles.winnerBox}>
        <View style={styles.winnerLeft}>
          <CheckCircle2 size={15} color={COLORS.win} strokeWidth={2.4} />
          <Text style={styles.winnerText}>Issue gagnante : {winner.label}</Text>
        </View>
        {winner.odds != null ? (
          <Text style={styles.winnerOddsText}>
            {formatOdds(winner.odds, oddsFormat)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function MultiChoiceQuestionCard({
  q,
  options,
  nowMs,
  onSelect,
}: {
  q: ClientPrediction;
  options: PredictionOptionClient[];
  nowMs: number;
  onSelect: (selection: string, label: string, odds: number) => void;
}) {
  const router = useRouter();
  const { oddsFormat, isInCombo, toggleComboLeg, toast, hapticsEnabled } =
    useApp();
  const expired = new Date(q.resolvesAt).getTime() <= nowMs;
  const comboUid = `pred-${q.id}`;

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.odds - b.odds),
    [options]
  );

  const [expanded, setExpanded] = useState(false);
  const hasMoreOptions = sortedOptions.length > 2;
  const displayed =
    expanded || !hasMoreOptions ? sortedOptions : sortedOptions.slice(0, 2);

  const probs = useMemo(() => {
    const weights = sortedOptions.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const map = new Map<string, number>();
    sortedOptions.forEach((o, i) => {
      map.set(o.key, Math.round((weights[i] / sum) * 100));
    });
    return map;
  }, [sortedOptions]);

  const myBetLabel = useMemo(() => {
    if (!q.myBet) return null;
    if (q.myBet.selectionLabel) return q.myBet.selectionLabel;
    return (
      sortedOptions.find((o) => o.key === q.myBet?.selection)?.label ??
      q.myBet.selection
    );
  }, [q.myBet, sortedOptions]);

  return (
    <View style={[styles.card, expired && { opacity: 0.7 }]}>
      <Pressable
        onPress={() => router.push(`/predictions/${q.id}`)}
        style={({ pressed }) => (pressed ? { opacity: 0.9 } : undefined)}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.catBadge}>
            <Text style={styles.catBadgeText}>{q.category}</Text>
          </View>
          <View style={styles.timeRow}>
            <Clock size={12} color={COLORS.dim} strokeWidth={2.2} />
            <Text style={styles.cardTimeText}>
              {expired ? "Clos" : formatResolves(q.resolvesAt, nowMs)}
            </Text>
          </View>
        </View>

        <Text style={styles.questionTextBold}>{q.question}</Text>

        {q.myBet && myBetLabel ? (
          <View style={styles.myBetBanner}>
            <Text style={styles.myBetBannerText}>
              Votre mise : {myBetLabel} · {eur(q.myBet.stake)}
            </Text>
          </View>
        ) : null}
      </Pressable>

      <View style={styles.multiOptionsStack}>
        {displayed.map((opt) => {
          const pct = probs.get(opt.key) ?? 0;
          const selected = q.myBet?.selection === opt.key;
          const inCombo = isInCombo(comboUid, "multichoice", opt.key);
          const comboSel: ComboSelection = {
            uid: comboUid,
            kind: "prediction",
            questionId: q.id,
            title: q.question,
            league: q.category,
            market: "multichoice",
            selection: opt.key,
            selectionLabel: opt.label,
            odds: opt.odds,
            startsAt: q.resolvesAt,
          };

          return (
            <MultiOptionButton
              key={opt.key}
              opt={opt}
              pct={pct}
              expired={expired}
              selected={selected}
              inCombo={inCombo}
              oddsFormat={oddsFormat}
              onSelect={() => onSelect(opt.key, opt.label, opt.odds)}
              onLongPress={() => {
                if (expired) return;
                const res = toggleComboLeg(comboSel);
                triggerHaptic("medium", hapticsEnabled);
                if (res === "added" || res === "replaced") {
                  toast({
                    kind: "info",
                    title: "Ajouté au Betslip",
                    description: `${opt.label} (${formatOdds(opt.odds, oddsFormat)})`,
                  });
                } else if (res === "removed") {
                  toast({ kind: "info", title: "Retiré du Betslip" });
                } else if (res === "full") {
                  toast({
                    kind: "error",
                    title: "Betslip complet (limite atteinte)",
                  });
                }
              }}
            />
          );
        })}
      </View>

      {hasMoreOptions ? (
        <Pressable
          onPress={() => setExpanded((s) => !s)}
          style={({ pressed }) => [
            styles.expandBtn,
            pressed && { backgroundColor: COLORS.elev },
          ]}
        >
          <Text style={styles.expandBtnText}>
            {expanded
              ? "Voir moins"
              : `Voir tout (${sortedOptions.length} choix)`}
          </Text>
          <View
            style={expanded ? { transform: [{ rotate: "180deg" }] } : undefined}
          >
            <ChevronDown size={16} color={COLORS.mist} strokeWidth={2.3} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

function MultiOptionButton({
  opt,
  pct,
  expired,
  selected,
  inCombo,
  oddsFormat,
  onSelect,
  onLongPress,
}: {
  opt: PredictionOptionClient;
  pct: number;
  expired: boolean;
  selected: boolean;
  inCombo: boolean;
  oddsFormat: "decimal" | "fractional";
  onSelect: () => void;
  onLongPress: () => void;
}) {
  const trend = useOddsTrend(opt.odds);

  return (
    <Pressable
      disabled={expired}
      onPress={onSelect}
      onLongPress={onLongPress}
      delayLongPress={360}
      style={({ pressed }) => [
        styles.multiOptionRow,
        inCombo
          ? styles.multiOptionInCombo
          : selected
            ? styles.multiOptionSelected
            : styles.multiOptionDefault,
        pressed && !expired && { transform: [{ scale: 0.99 }] },
      ]}
    >
      {!inCombo ? (
        <View
          pointerEvents="none"
          style={[
            styles.multiFillBar,
            {
              width: `${Math.max(pct, 4)}%`,
              backgroundColor: selected
                ? "rgba(225, 0, 20, 0.12)"
                : "rgba(17, 24, 39, 0.045)",
            },
          ]}
        />
      ) : null}

      <View style={styles.multiLeft}>
        {selected || inCombo ? (
          <View style={styles.checkBadge}>
            <Check size={10} color="#ffffff" strokeWidth={3} />
          </View>
        ) : null}
        <Text
          numberOfLines={1}
          style={[styles.multiLabel, inCombo && { color: "#ffffff" }]}
        >
          {opt.label}
        </Text>
      </View>

      <View style={styles.multiRight}>
        <Text
          style={[
            styles.multiPct,
            inCombo && { color: "rgba(255,255,255,0.75)" },
          ]}
        >
          {pct}%
        </Text>
        <View
          style={[
            styles.multiOddsBadge,
            selected || inCombo
              ? styles.multiOddsBadgeActive
              : styles.multiOddsBadgeDefault,
          ]}
        >
          {!expired ? (
            <OddsTrendCorner trend={trend} inverted={selected || inCombo} />
          ) : null}
          <Text
            style={[
              styles.multiOddsText,
              {
                color: oddsTrendTextColor(
                  trend,
                  selected || inCombo,
                  COLORS.ink
                ),
              },
            ]}
          >
            {formatOdds(opt.odds, oddsFormat)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function BinaryQuestionCard({
  q,
  nowMs,
  onSelect,
}: {
  q: ClientPrediction;
  nowMs: number;
  onSelect: (selection: "yes" | "no") => void;
}) {
  const router = useRouter();
  const { oddsFormat, isInCombo, toggleComboLeg, toast, hapticsEnabled } =
    useApp();
  const expired = new Date(q.resolvesAt).getTime() <= nowMs;
  const comboUid = `pred-${q.id}`;

  return (
    <View style={[styles.card, expired && { opacity: 0.7 }]}>
      <Pressable
        onPress={() => router.push(`/predictions/${q.id}`)}
        style={({ pressed }) => (pressed ? { opacity: 0.9 } : undefined)}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.catBadge}>
            <Text style={styles.catBadgeText}>{q.category}</Text>
          </View>
          <View style={styles.timeRow}>
            <Clock size={12} color={COLORS.dim} strokeWidth={2.2} />
            <Text style={styles.cardTimeText}>
              {expired ? "Clos" : formatResolves(q.resolvesAt, nowMs)}
            </Text>
          </View>
        </View>

        <Text style={styles.questionTextSemi}>{q.question}</Text>

        {q.myBet ? (
          <View style={styles.myBetBanner}>
            <Text style={styles.myBetBannerText}>
              Votre mise : {q.myBet.selection === "yes" ? "Oui" : "Non"} ·{" "}
              {eur(q.myBet.stake)}
            </Text>
          </View>
        ) : null}
      </Pressable>

      <View style={styles.binaryGrid}>
        {(
          [
            { key: "yes" as const, label: "Oui", odds: q.oddsYes },
            { key: "no" as const, label: "Non", odds: q.oddsNo },
          ] as const
        ).map((side) => {
          const selected = q.myBet?.selection === side.key;
          const inCombo = isInCombo(comboUid, "yesno", side.key);
          return (
            <SideButton
              key={side.key}
              label={side.label}
              odds={side.odds}
              oddsFormat={oddsFormat}
              disabled={expired}
              selected={selected}
              inCombo={inCombo}
              onPress={() => onSelect(side.key)}
              onLongPress={() => {
                if (expired) return;
                const res = toggleComboLeg({
                  uid: comboUid,
                  kind: "prediction",
                  questionId: q.id,
                  title: q.question,
                  league: q.category,
                  market: "yesno",
                  selection: side.key,
                  selectionLabel: side.label,
                  odds: side.odds,
                  startsAt: q.resolvesAt,
                });
                triggerHaptic("medium", hapticsEnabled);
                if (res === "added" || res === "replaced") {
                  toast({
                    kind: "info",
                    title: "Ajouté au Betslip",
                    description: `${side.label} (${formatOdds(side.odds, oddsFormat)})`,
                  });
                } else if (res === "removed") {
                  toast({ kind: "info", title: "Retiré du Betslip" });
                } else if (res === "full") {
                  toast({
                    kind: "error",
                    title: "Betslip complet (limite atteinte)",
                  });
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function SideButton({
  label,
  odds,
  oddsFormat,
  disabled,
  selected,
  inCombo,
  onPress,
  onLongPress,
}: {
  label: string;
  odds: number;
  oddsFormat: "decimal" | "fractional";
  disabled?: boolean;
  selected?: boolean;
  inCombo?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const active = Boolean(selected || inCombo);
  const trend = useOddsTrend(odds);

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={360}
      style={({ pressed }) => [
        styles.sideBtn,
        selected
          ? styles.sideBtnSelected
          : inCombo
            ? styles.sideBtnInCombo
            : styles.sideBtnDefault,
        pressed && !disabled && { transform: [{ scale: 0.98 }] },
      ]}
    >
      {!disabled ? (
        <OddsTrendCorner trend={trend} inverted={active} />
      ) : null}
      <Text style={[styles.sideLabel, active && { color: "#ffffff" }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.sideOdds,
          { color: oddsTrendTextColor(trend, active, COLORS.ink) },
        ]}
      >
        {formatOdds(odds, oddsFormat)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 8,
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
    fontSize: 14.5,
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
    fontSize: 11.5,
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
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  errorSub: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  emptyState: {
    marginTop: 48,
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
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.ink,
  },
  emptySub: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 11,
    color: COLORS.dim,
  },
  cardStack: {
    gap: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  catBadge: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  catBadgeText: {
    fontSize: 9.5,
    fontWeight: "500",
    textTransform: "uppercase",
    color: COLORS.ink,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cardTimeText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  questionTextBold: {
    marginTop: 8,
    fontSize: 12.5,
    fontWeight: "500",
    lineHeight: 21,
    color: COLORS.ink,
  },
  questionTextSemi: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 21,
    color: COLORS.ink,
  },
  myBetBanner: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: "rgba(225,0,20,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  myBetBannerText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  multiOptionsStack: {
    marginTop: 10,
    gap: 6,
  },
  multiOptionRow: {
    position: "relative",
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    overflow: "hidden",
  },
  multiOptionDefault: {
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241, 243, 245, 0.55)",
  },
  multiOptionSelected: {
    borderColor: COLORS.betclicRed,
    backgroundColor: "rgba(225, 0, 20, 0.06)",
  },
  multiOptionInCombo: {
    borderColor: COLORS.ink,
    backgroundColor: COLORS.ink,
  },
  multiFillBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  multiLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  checkBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  multiLabel: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  multiRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  multiPct: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  multiOddsBadge: {
    position: "relative",
    minWidth: 52,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  multiOddsBadgeDefault: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
  },
  multiOddsBadgeActive: {
    backgroundColor: COLORS.betclicRed,
  },
  multiOddsText: {
    fontSize: 11,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  expandBtn: {
    marginTop: 8,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(241,243,245,0.85)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  expandBtnText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  binaryGrid: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  sideBtn: {
    flex: 1,
    position: "relative",
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  },
  sideBtnDefault: {
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
  },
  sideBtnSelected: {
    borderColor: COLORS.betclicRed,
    backgroundColor: COLORS.betclicRed,
  },
  sideBtnInCombo: {
    borderColor: COLORS.ink,
    backgroundColor: COLORS.ink,
  },
  sideLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.mist,
  },
  sideOdds: {
    fontSize: 11.5,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  winnerBox: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(21,128,61,0.25)",
    backgroundColor: "rgba(21,128,61,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  winnerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  winnerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.win,
  },
  winnerOddsText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
});
