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
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react-native";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { useApp, type ComboSelection } from "@/context/app-context";
import { api, type ClientPrediction } from "@/lib/api";
import { getCachedClientPrediction } from "@/lib/entity-cache";
import { eur, formatOdds, formatPlacedAt } from "@/lib/format";
import { useParams, useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const POLL_MS = 6_000;

interface DisplayOption {
  key: string;
  label: string;
  odds: number;
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

export default function PredictionDetailScreen() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const questionId = Number(params.id);
  const invalidId = !Number.isInteger(questionId) || questionId <= 0;

  const {
    user,
    betsVersion,
    oddsFormat,
    isInCombo,
    comboQuickMode,
    toggleComboLeg,
    toast,
    hapticsEnabled,
  } = useApp();

  const [prevId, setPrevId] = useState<number>(questionId);
  const [question, setQuestion] = useState<
    ClientPrediction | null | undefined
  >(() =>
    invalidId ? null : (getCachedClientPrediction(questionId) ?? undefined)
  );
  const [myBet, setMyBet] = useState<ClientPrediction["myBet"]>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    question: ClientPrediction;
    selection: string;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (questionId !== prevId) {
    setPrevId(questionId);
    setQuestion(
      invalidId ? null : (getCachedClientPrediction(questionId) ?? undefined)
    );
    setMyBet(null);
    setLoadError(null);
    setTarget(null);
  }

  const fetchQuestion = useCallback(
    async (forceRefresh = false) => {
      if (invalidId) return;
      try {
        const r = await api.predictionsCatalog({ forceRefresh });
        const found = r.questions.find((q) => q.id === questionId) ?? null;
        setQuestion(found);
        setNowMs(Date.now());
        setLoadError(null);
      } catch (e) {
        setQuestion((prev) => (prev === undefined ? null : prev));
        setLoadError(
          e instanceof Error
            ? e.message
            : "Impossible de charger cette prédiction."
        );
      }
    },
    [invalidId, questionId]
  );

  useEffect(() => {
    if (invalidId) return;
    void fetchQuestion(false);
    const id = setInterval(() => void fetchQuestion(false), POLL_MS);
    return () => clearInterval(id);
  }, [invalidId, fetchQuestion]);

  useEffect(() => {
    if (!user || invalidId) {
      setMyBet(null);
      return;
    }
    void api
      .predictionsMine()
      .then((r) => setMyBet(r.myBets[questionId] ?? null))
      .catch(() => {});
  }, [user, betsVersion, invalidId, questionId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchQuestion(true),
      user && !invalidId
        ? api
            .predictionsMine({ forceRefresh: true })
            .then((r) => setMyBet(r.myBets[questionId] ?? null))
            .catch(() => undefined)
        : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [fetchQuestion, invalidId, questionId, user]);

  const mergedQuestion = useMemo<ClientPrediction | null | undefined>(() => {
    if (!question) return question;
    return { ...question, myBet: myBet ?? question.myBet ?? null };
  }, [question, myBet]);

  const isMulti = Boolean(
    mergedQuestion?.options && mergedQuestion.options.length >= 2
  );

  const options = useMemo<DisplayOption[]>(() => {
    if (!mergedQuestion) return [];
    if (mergedQuestion.options && mergedQuestion.options.length >= 2) {
      return [...mergedQuestion.options].sort((a, b) => a.odds - b.odds);
    }
    return [
      { key: "yes", label: "Oui", odds: mergedQuestion.oddsYes },
      { key: "no", label: "Non", odds: mergedQuestion.oddsNo },
    ];
  }, [mergedQuestion]);

  const probs = useMemo(() => {
    const weights = options.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const map = new Map<string, number>();
    options.forEach((o, i) => {
      map.set(o.key, Math.round((weights[i] / sum) * 100));
    });
    return map;
  }, [options]);

  const expired = mergedQuestion
    ? new Date(mergedQuestion.resolvesAt).getTime() <= nowMs
    : false;
  const resolved = mergedQuestion ? mergedQuestion.status !== "open" : false;
  const disabled = expired || resolved;
  const marketKey = isMulti ? "multichoice" : "yesno";

  const myBetLabel = useMemo(() => {
    const b = mergedQuestion?.myBet;
    if (!b) return null;
    if (b.selectionLabel) return b.selectionLabel;
    return options.find((o) => o.key === b.selection)?.label ?? b.selection;
  }, [mergedQuestion?.myBet, options]);

  const handleSelectOutcome = useCallback(
    (q: ClientPrediction, opt: DisplayOption) => {
      if (disabled) return;
      if (comboQuickMode) {
        const res = toggleComboLeg({
          uid: `pred-${q.id}`,
          kind: "prediction",
          questionId: q.id,
          title: q.question,
          league: q.category,
          market: marketKey,
          selection: opt.key,
          selectionLabel: opt.label,
          odds: opt.odds,
          startsAt: q.resolvesAt,
        });
        triggerHaptic("light", hapticsEnabled);
        if (res === "full") {
          toast({
            kind: "error",
            title: "Betslip complet (8 sélections max)",
          });
        }
        return;
      }
      setTarget({ question: q, selection: opt.key });
    },
    [comboQuickMode, disabled, hapticsEnabled, marketKey, toast, toggleComboLeg]
  );

  return (
    <>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.betclicRed]}
            tintColor={COLORS.betclicRed}
          />
        }
      >
        {/* En-tête compact identique à src/app/(main)/predictions/[id]/page.tsx */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={() => router.back("/predictions")}
              style={({ pressed }) => [
                styles.roundBackBtn,
                pressed && { transform: [{ scale: 0.95 }] },
              ]}
            >
              <ArrowLeft size={14} color={COLORS.ink} strokeWidth={2.3} />
            </Pressable>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {mergedQuestion ? mergedQuestion.category : "Prédiction"}
            </Text>
          </View>

          {mergedQuestion ? (
            <View
              style={[
                styles.statusBadge,
                resolved ? styles.statusBadgeResolved : styles.statusBadgeOpen,
              ]}
            >
              {resolved ? (
                <CheckCircle2 size={12} color={COLORS.win} strokeWidth={2.4} />
              ) : (
                <Clock size={12} color={COLORS.ink} strokeWidth={2.2} />
              )}
              <Text
                style={[
                  styles.statusBadgeText,
                  resolved && { color: COLORS.win },
                ]}
              >
                {resolved
                  ? "Résolue"
                  : formatResolves(mergedQuestion.resolvesAt, nowMs)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: 10 }}>
          {mergedQuestion === undefined ? (
            <PulseFlashLoader compact />
          ) : mergedQuestion === null ? (
            <View style={styles.notFoundCard}>
              <AlertTriangle
                size={20}
                color={COLORS.betclicRed}
                strokeWidth={2.2}
              />
              <Text style={styles.notFoundTitle}>
                {loadError ? "Connexion interrompue" : "Prédiction introuvable"}
              </Text>
              <Text style={styles.notFoundSub}>
                {loadError ?? "Cette question n'existe plus."}
              </Text>
              <View style={styles.notFoundActions}>
                <Pressable
                  onPress={() => void fetchQuestion()}
                  style={styles.retryGrayBtn}
                >
                  <RefreshCw size={12} color={COLORS.ink} strokeWidth={2.2} />
                  <Text style={styles.retryGrayText}>Réessayer</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push("/predictions")}
                  style={styles.redBtn}
                >
                  <Text style={styles.redBtnText}>Prédictions</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.stack}>
              {/* Carte question compacte */}
              <View style={styles.card}>
                <Text style={styles.questionText}>
                  {mergedQuestion.question}
                </Text>

                <Text style={styles.resolvesSub}>
                  {resolved
                    ? mergedQuestion.resolvedAt
                      ? `Résolue le ${formatPlacedAt(mergedQuestion.resolvedAt)}`
                      : "Question résolue"
                    : `Clôture : ${formatPlacedAt(mergedQuestion.resolvesAt)}`}
                </Text>

                {mergedQuestion.myBet && myBetLabel ? (
                  <View style={styles.myBetRow}>
                    <Text style={styles.myBetLeft}>
                      Votre mise : {myBetLabel}
                    </Text>
                    <Text style={styles.myBetRight}>
                      {eur(mergedQuestion.myBet.stake)}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Issues / options compactes */}
              <View style={styles.card}>
                <Text style={styles.optionsHeading}>
                  ISSUES ({options.length})
                </Text>

                <View style={styles.optionsList}>
                  {options.map((opt) => {
                    const pct = probs.get(opt.key) ?? 0;
                    const selected =
                      mergedQuestion.myBet?.selection === opt.key;
                    const inCombo = isInCombo(
                      `pred-${mergedQuestion.id}`,
                      marketKey,
                      opt.key
                    );
                    const isWinner =
                      resolved && mergedQuestion.resolution === opt.key;
                    const comboSel: ComboSelection = {
                      uid: `pred-${mergedQuestion.id}`,
                      kind: "prediction",
                      questionId: mergedQuestion.id,
                      title: mergedQuestion.question,
                      league: mergedQuestion.category,
                      market: marketKey,
                      selection: opt.key,
                      selectionLabel: opt.label,
                      odds: opt.odds,
                      startsAt: mergedQuestion.resolvesAt,
                    };

                    return (
                      <PredictionOutcomeRow
                        key={opt.key}
                        opt={opt}
                        pct={pct}
                        disabled={disabled}
                        selected={selected}
                        inCombo={inCombo}
                        isWinner={isWinner}
                        oddsFormat={oddsFormat}
                        onSelect={() =>
                          handleSelectOutcome(mergedQuestion, opt)
                        }
                        onLongPress={() => {
                          if (disabled) return;
                          const res = toggleComboLeg(comboSel);
                          triggerHaptic("medium", hapticsEnabled);
                          if (res === "added" || res === "replaced") {
                            toast({
                              kind: "info",
                              title: "Ajouté au Betslip",
                              description: `${opt.label} (${formatOdds(opt.odds, oddsFormat)})`,
                            });
                          } else if (res === "removed") {
                            toast({
                              kind: "info",
                              title: "Retiré du Betslip",
                            });
                          } else if (res === "full") {
                            toast({
                              kind: "error",
                              title: "Betslip complet (8 sélections max)",
                            });
                          }
                        }}
                      />
                    );
                  })}
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <PredictionBetModal
        question={target?.question ?? null}
        selection={target?.selection ?? null}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

function PredictionOutcomeRow({
  opt,
  pct,
  disabled,
  selected,
  inCombo,
  isWinner,
  oddsFormat,
  onSelect,
  onLongPress,
}: {
  opt: DisplayOption;
  pct: number;
  disabled: boolean;
  selected: boolean;
  inCombo: boolean;
  isWinner: boolean;
  oddsFormat: "decimal" | "fractional";
  onSelect: () => void;
  onLongPress: () => void;
}) {
  const trend = useOddsTrend(opt.odds);

  return (
    <Pressable
      disabled={disabled}
      onPress={onSelect}
      onLongPress={onLongPress}
      delayLongPress={360}
      style={({ pressed }) => [
        styles.outcomeRow,
        isWinner
          ? styles.outcomeWinner
          : inCombo
            ? styles.outcomeInCombo
            : selected
              ? styles.outcomeSelected
              : styles.outcomeDefault,
        pressed && !disabled && { transform: [{ scale: 0.99 }] },
      ]}
    >
      {!inCombo && !isWinner ? (
        <View
          pointerEvents="none"
          style={[
            styles.outcomeFillBar,
            {
              width: `${Math.max(pct, 4)}%`,
              backgroundColor: selected
                ? "rgba(225, 0, 20, 0.12)"
                : "rgba(17, 24, 39, 0.045)",
            },
          ]}
        />
      ) : null}

      <View style={styles.outcomeLeft}>
        {isWinner ? (
          <CheckCircle2 size={14} color={COLORS.win} strokeWidth={2.5} />
        ) : selected || inCombo ? (
          <View style={styles.checkBadge}>
            <Check size={9} color="#ffffff" strokeWidth={3} />
          </View>
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.outcomeLabel,
            inCombo && { color: "#ffffff" },
            isWinner && { color: COLORS.win },
          ]}
        >
          {opt.label}
        </Text>
      </View>

      <View style={styles.outcomeRight}>
        <Text
          style={[
            styles.outcomePct,
            inCombo && { color: "rgba(255,255,255,0.75)" },
          ]}
        >
          {pct}%
        </Text>
        <View
          style={[
            styles.outcomeOddsBadge,
            isWinner
              ? { backgroundColor: COLORS.win }
              : selected || inCombo
                ? { backgroundColor: COLORS.betclicRed }
                : styles.outcomeOddsDefault,
          ]}
        >
          {!disabled ? (
            <OddsTrendCorner trend={trend} inverted={selected || inCombo} />
          ) : null}
          <Text
            style={[
              styles.outcomeOddsText,
              {
                color: isWinner
                  ? "#ffffff"
                  : oddsTrendTextColor(trend, selected || inCombo, COLORS.ink),
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

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 28,
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
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusBadgeOpen: {
    backgroundColor: COLORS.elev,
  },
  statusBadgeResolved: {
    backgroundColor: "rgba(21,128,61,0.12)",
  },
  statusBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  loaderBox: {
    paddingVertical: 44,
    alignItems: "center",
  },
  notFoundCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 16,
    alignItems: "center",
  },
  notFoundTitle: {
    marginTop: 6,
    fontSize: 14.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  notFoundSub: {
    marginTop: 2,
    fontSize: 11.5,
    color: COLORS.mist,
    textAlign: "center",
  },
  notFoundActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  retryGrayBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  retryGrayText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  redBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  redBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  stack: {
    gap: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  questionText: {
    fontSize: 14.5,
    fontWeight: "700",
    lineHeight: 20,
    color: COLORS.ink,
  },
  resolvesSub: {
    marginTop: 4,
    fontSize: 10.5,
    color: COLORS.dim,
  },
  myBetRow: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: "rgba(225,0,20,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  myBetLeft: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.betclicRed,
  },
  myBetRight: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  optionsHeading: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: COLORS.mist,
  },
  optionsList: {
    marginTop: 8,
    gap: 6,
  },
  outcomeRow: {
    position: "relative",
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    overflow: "hidden",
  },
  outcomeDefault: {
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241,243,245,0.55)",
  },
  outcomeSelected: {
    borderColor: COLORS.betclicRed,
    backgroundColor: "rgba(225,0,20,0.06)",
  },
  outcomeInCombo: {
    borderColor: COLORS.ink,
    backgroundColor: COLORS.ink,
  },
  outcomeWinner: {
    borderColor: "rgba(21,128,61,0.40)",
    backgroundColor: "rgba(21,128,61,0.10)",
  },
  outcomeFillBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  outcomeLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  checkBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  outcomeLabel: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  outcomeRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  outcomePct: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  outcomeOddsBadge: {
    position: "relative",
    minWidth: 48,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  outcomeOddsDefault: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
  },
  outcomeOddsText: {
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
