import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { api, type ClientPredictionQuestion } from "@/lib/api";
import { getCachedPredictionSnapshot } from "@/lib/entity-cache";
import { useSmartPolling } from "@/lib/polling";
import { BareInfiniteSpinner } from "@/components/infinite-scroll-loader";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";
import { PredictionCard } from "./index";

export default function PredictionDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const qId = Number(params.id);
  const { user, dataSaverMode } = useApp();

  const [question, setQuestion] = useState<ClientPredictionQuestion | null>(() =>
    Number.isFinite(qId) ? getCachedPredictionSnapshot(qId) : null
  );

  const load = useCallback(async () => {
    if (!Number.isFinite(qId) || qId <= 0) return;
    try {
      const res = await api.predictions(Boolean(user));
      const found = res.questions.find((q) => q.id === qId) ?? null;
      if (found) setQuestion(found);
    } catch {
      // Conserve le snapshot
    }
  }, [qId, user]);

  useSmartPolling(load, 15_000, {
    enabled: Number.isFinite(qId) && qId > 0,
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {question?.category ?? "Prédiction"}
        </Text>
      </View>

      {!question ? (
        <BareInfiniteSpinner visible />
      ) : (
        <>
          <PredictionCard q={question} defaultExpanded />

          {question.description ? (
            <View style={[cardSurface.glassCard, styles.descCard]}>
              <Text style={styles.descTitle}>Règle de résolution</Text>
              <Text style={styles.descText}>{question.description}</Text>
            </View>
          ) : null}

          {question.resolutionNote ? (
            <View style={[cardSurface.glassCard, styles.descCard]}>
              <Text style={styles.descTitle}>Note officielle</Text>
              <Text style={styles.descText}>{question.resolutionNote}</Text>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 11,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
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
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
    color: colors.ink,
  },
  descCard: {
    padding: 13,
    gap: 5,
  },
  descTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.ink,
  },
  descText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.mist,
  },
});
