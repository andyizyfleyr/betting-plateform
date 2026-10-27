import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Plus, X } from "lucide-react-native";
import { api, ApiHttpError, generateIdempotencyKey } from "@/lib/api";
import { eur, formatOdds } from "@/lib/format";
import { colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";
import { TouchStakePad } from "./touch-stake-pad";
import { OddsLockControls } from "./odds-lock-controls";

export function PredictionBetModal() {
  const router = useRouter();
  const {
    user,
    balance,
    setBalance,
    predictionTarget,
    closePredictionBet,
    oddsFormat,
    oddsPolicy,
    setOddsPolicy,
    stakePresets,
    toggleComboLeg,
    openRecharge,
    refreshPulseNow,
    toast,
  } = useApp();

  const [stake, setStake] = useState<number>(stakePresets[1] ?? 10);
  const [liveOdds, setLiveOdds] = useState<number>(1.9);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState<string>(() =>
    generateIdempotencyKey("prd")
  );

  useEffect(() => {
    if (predictionTarget) {
      setLiveOdds(predictionTarget.odds);
      setIdemKey(generateIdempotencyKey("prd"));
    }
  }, [predictionTarget]);

  if (!predictionTarget) return null;

  const potentialWin = Math.round(stake * liveOdds * 100) / 100;
  const insufficient = Boolean(user) && stake > balance;

  const handleSubmit = async () => {
    if (!user) {
      closePredictionBet();
      router.push("/auth");
      return;
    }
    if (stake < 0.5 || submitting) return;
    if (insufficient) {
      closePredictionBet();
      openRecharge();
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.placePredictionBet({
        questionId: predictionTarget.question.id,
        selection: predictionTarget.selection,
        stake,
        expectedOdds: liveOdds,
        oddsPolicy,
        idempotencyKey: idemKey,
      });
      setBalance(res.balance);
      void refreshPulseNow();
      void api.predictions(true).catch(() => {});
      closePredictionBet();
      toast({
        kind: "success",
        title: "Pronostic validé !",
        subtitle: `Gain potentiel ${eur(res.potentialWin)}`,
      });
    } catch (err) {
      setIdemKey(generateIdempotencyKey("prd"));
      if (err instanceof ApiHttpError && err.code === "ODDS_CHANGED" && err.currentOdds) {
        setLiveOdds(err.currentOdds);
        toast({
          kind: "info",
          title: `Cote actualisée à ${formatOdds(err.currentOdds, oddsFormat)}`,
          subtitle: "Appuyez à nouveau pour confirmer",
        });
      } else {
        toast({
          kind: "error",
          title: "Pronostic refusé",
          subtitle: err instanceof Error ? err.message : "Réessayez",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCombo = () => {
    const res = toggleComboLeg({
      kind: "prediction",
      questionId: predictionTarget.question.id,
      title: predictionTarget.question.question,
      league: predictionTarget.question.category,
      market:
        predictionTarget.question.options &&
        predictionTarget.question.options.length >= 2
          ? "multichoice"
          : "yesno",
      selection: predictionTarget.selection,
      selectionLabel: predictionTarget.selectionLabel,
      odds: liveOdds,
      startsAt: predictionTarget.question.resolvesAt,
      isLive: false,
    });
    closePredictionBet();
    if (res === "full") {
      toast({ kind: "error", title: "Maximum 8 sélections dans le Betslip" });
    } else {
      toast({
        kind: "info",
        title: "Ajouté au Betslip",
        subtitle: predictionTarget.selectionLabel,
      });
    }
  };

  return (
    <Modal
      visible={Boolean(predictionTarget)}
      transparent
      animationType="slide"
      onRequestClose={closePredictionBet}
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={closePredictionBet} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={styles.qTitle}>
                  {predictionTarget.question.question}
                </Text>
                <Text style={styles.selLabel}>
                  Choix : {predictionTarget.selectionLabel}
                </Text>
              </View>
              <View style={styles.oddsBadge}>
                <Text style={styles.oddsBadgeText}>
                  {formatOdds(liveOdds, oddsFormat)}
                </Text>
              </View>
              <Pressable onPress={closePredictionBet} style={styles.closeBtn}>
                <X size={17} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            </View>

            <TouchStakePad
              stake={stake}
              onChangeStake={setStake}
              maxBalance={balance}
              presets={stakePresets}
            />

            <OddsLockControls value={oddsPolicy} onChange={setOddsPolicy} />

            <View style={styles.payoutRow}>
              <Text style={styles.payoutLabel}>Gain fixe garanti</Text>
              <Text style={styles.payoutVal}>{eur(potentialWin)}</Text>
            </View>

            <View style={styles.actionsRow}>
              <Pressable onPress={handleAddCombo} style={styles.comboBtn}>
                <Plus size={15} color={colors.ink} strokeWidth={2.5} />
                <Text style={styles.comboBtnText}>Betslip</Text>
              </Pressable>
              <Pressable
                disabled={submitting || stake < 0.5}
                onPress={() => void handleSubmit()}
                style={[
                  styles.submitBtn,
                  (submitting || stake < 0.5) && { opacity: 0.55 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {!user
                      ? "Se connecter"
                      : insufficient
                        ? "Recharger mon solde"
                        : `Parier ${eur(stake)}`}
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.48)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.edge,
    marginBottom: 6,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  qTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.ink,
  },
  selLabel: {
    marginTop: 3,
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.betclicRed,
  },
  oddsBadge: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.betclicRed,
  },
  oddsBadgeText: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  payoutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "rgba(21, 128, 61, 0.25)",
  },
  payoutLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.win,
  },
  payoutVal: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.win,
    fontVariant: ["tabular-nums"],
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  comboBtn: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    borderRadius: 13,
    backgroundColor: colors.elev,
  },
  comboBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
  },
  submitBtn: {
    flex: 1,
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.white,
  },
});
