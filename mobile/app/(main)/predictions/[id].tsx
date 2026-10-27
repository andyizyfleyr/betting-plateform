import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, Check, Sparkles } from "lucide-react-native";
import { KickoffCountdown } from "@/components/kickoff-countdown";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { useApp } from "@/context/app-context";
import { api, type ClientPrediction } from "@/lib/api";
import { getCachedPredictionSnapshot } from "@/lib/entity-cache";
import { eur, formatFullDateTime, formatOdds } from "@/lib/format";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

function DetailOptionRow({
  opt,
  oddsFormat,
  selected,
  winner,
  disabled,
  onPress,
  onLongPress,
}: {
  opt: { key: string; label: string; odds: number };
  oddsFormat: "decimal" | "fractional";
  selected: boolean;
  winner: boolean;
  disabled: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const trend = useOddsTrend(opt.odds);
  const probPct = Math.min(95, Math.max(4, Math.round(100 / opt.odds)));

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[
        styles.optRow,
        selected && styles.optRowSelected,
        winner && styles.optRowWinner,
      ]}
    >
      <OddsTrendCorner trend={trend} inverted={selected} />
      <View style={styles.optInfo}>
        <View style={styles.optTitleRow}>
          {selected ? (
            <Check size={13} color="#ffffff" strokeWidth={2.8} />
          ) : null}
          <Text
            style={[
              styles.optTitle,
              selected && { color: "#ffffff" },
              winner && { color: COLORS.win },
            ]}
          >
            {opt.label}
          </Text>
        </View>
        <View style={styles.probTrack}>
          <View
            style={[
              styles.probFill,
              { width: `${probPct}%` },
              selected && { backgroundColor: "#ffffff" },
            ]}
          />
        </View>
        <Text
          style={[
            styles.probText,
            selected && { color: "rgba(255,255,255,0.75)" },
          ]}
        >
          Probabilité implicite ~{probPct} %
        </Text>
      </View>

      <View
        style={[
          styles.oddsBox,
          selected && { backgroundColor: "rgba(255,255,255,0.16)" },
        ]}
      >
        <Text
          style={[
            styles.oddsVal,
            { color: oddsTrendTextColor(trend, selected) },
          ]}
        >
          {formatOdds(opt.odds, oddsFormat)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function PredictionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qId = Number(id);
  const {
    user,
    oddsFormat,
    openPredictionBet,
    toggleComboLeg,
    isInCombo,
    comboQuickMode,
    betsVersion,
    toast,
  } = useApp();

  const [item, setItem] = useState<ClientPrediction | null>(() =>
    Number.isFinite(qId) ? getCachedPredictionSnapshot(qId) : null
  );
  const [loading, setLoading] = useState<boolean>(!item);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(qId) || qId <= 0) return;
    try {
      const [catRes, myRes] = await Promise.all([
        api.predictionsCatalog(),
        user
          ? api.myPredictionBets().catch(() => ({ myBets: {} }))
          : Promise.resolve({ myBets: {} }),
      ]);
      const found = catRes.questions.find((q) => q.id === qId) ?? null;
      if (found) {
        const myMap = myRes.myBets as Record<number, ClientPrediction["myBet"]>;
        setItem({ ...found, myBet: myMap[found.id] ?? found.myBet ?? null });
      }
    } catch {
      /* garde snapshot */
    } finally {
      setLoading(false);
    }
  }, [qId, user]);

  useEffect(() => {
    void load();
  }, [load, betsVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading && !item) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={COLORS.betclicRed} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Prédiction introuvable</Text>
        <Pressable
          onPress={() => router.back("/predictions")}
          style={styles.backFallback}
        >
          <Text style={styles.backFallbackText}>Retour aux prédictions</Text>
        </Pressable>
      </View>
    );
  }

  const options =
    item.options && item.options.length > 0
      ? item.options
      : [
          { key: "yes", label: "Oui", odds: item.oddsYes },
          { key: "no", label: "Non", odds: item.oddsNo },
        ];
  const uid = `pred-${item.id}`;
  const isResolved = item.status === "resolved";

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
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back("/predictions")}
          style={styles.backBtn}
        >
          <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>
        <View style={styles.catWrap}>
          <Sparkles size={13} color={COLORS.betclicRed} strokeWidth={2.3} />
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

      <View style={styles.heroCard}>
        <Text style={styles.question}>{item.question}</Text>
        <Text style={styles.deadline}>
          Clôture : {formatFullDateTime(item.resolvesAt)}
        </Text>
      </View>

      {item.myBet ? (
        <View style={styles.myBetCard}>
          <Text style={styles.myBetTitle}>Votre mise enregistrée</Text>
          <Text style={styles.myBetBody}>
            {item.myBet.selectionLabel ?? item.myBet.selection} · Mise{" "}
            {eur(item.myBet.stake)} @ {formatOdds(item.myBet.odds, oddsFormat)}{" "}
            → Gain potentiel {eur(item.myBet.potentialWin)}
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Toutes les issues ({options.length})
        </Text>
        <View style={styles.optionsList}>
          {options.map((opt) => (
            <DetailOptionRow
              key={opt.key}
              opt={opt}
              oddsFormat={oddsFormat}
              selected={isInCombo(uid, "prediction", opt.key)}
              winner={isResolved && item.resolution === opt.key}
              disabled={isResolved}
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
          ))}
        </View>
      </View>
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
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  notFound: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  backFallback: {
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  backFallbackText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
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
  catWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  catText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.betclicRed,
    textTransform: "uppercase",
  },
  resolvedPill: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  resolvedText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.dim,
  },
  heroCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 16,
    gap: 8,
  },
  question: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.ink,
    lineHeight: 23,
  },
  deadline: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
  },
  myBetCard: {
    borderRadius: 14,
    backgroundColor: COLORS.winSoft,
    borderWidth: 1,
    borderColor: COLORS.winBorder,
    padding: 13,
    gap: 3,
  },
  myBetTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.win,
  },
  myBetBody: {
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  section: {
    gap: 9,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
  },
  optionsList: {
    gap: 9,
  },
  optRow: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    position: "relative",
    overflow: "hidden",
  },
  optRowSelected: {
    backgroundColor: COLORS.outerSpace,
    borderColor: COLORS.outerSpace,
  },
  optRowWinner: {
    borderColor: COLORS.win,
    backgroundColor: COLORS.winSoft,
  },
  optInfo: {
    flex: 1,
    gap: 5,
  },
  optTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  optTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
  },
  probTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.elev,
    overflow: "hidden",
  },
  probFill: {
    height: "100%",
    backgroundColor: COLORS.betclicRed,
  },
  probText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  oddsBox: {
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  oddsVal: {
    fontSize: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
});
