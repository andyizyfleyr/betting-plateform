import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, Layers, Sparkles, X } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type ClientPrediction,
  type OddsChangedDetails,
} from "@/lib/api";
import { eur, formatOdds } from "@/lib/format";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";
import { OddsLockControls } from "./odds-lock-controls";
import { TouchStakePad } from "./touch-stake-pad";

export function PredictionBetModal({
  question: questionProp,
  selection: selectionProp,
  onClose,
}: {
  question?: ClientPrediction | null;
  selection?: string | null;
  onClose?: () => void;
} = {}) {
  const router = useRouter();
  const {
    predictionTarget: ctxTarget,
    closePredictionBet: ctxClose,
    authReady,
    sessionRestoring,
    user,
    balance,
    setBalance,
    pendingCount,
    setPendingCount,
    bumpBets,
    oddsFormat,
    oddsPolicy,
    setOddsPolicy,
    toggleComboLeg,
    isInCombo,
    openRecharge,
    toast,
  } = useApp();
  const authPending = !authReady || sessionRestoring;

  const predictionTarget =
    questionProp !== undefined
      ? questionProp && selectionProp
        ? { question: questionProp, selection: selectionProp }
        : null
      : ctxTarget;
  const closePredictionBet = onClose ?? ctxClose;

  const [stake, setStake] = useState("10");
  const [lockedOdds, setLockedOdds] = useState(1.85);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const idempotencyRef = useRef<string>(generateBetIdempotencyKey());

  useEffect(() => {
    if (!predictionTarget) return;
    const { question, selection } = predictionTarget;
    const opt = question.options?.find((o) => o.key === selection);
    const initialOdds = opt
      ? opt.odds
      : selection === "yes"
        ? question.oddsYes
        : question.oddsNo;
    setStake("10");
    setLockedOdds(roundOdds2(initialOdds));
    setOddsChanged(null);
    setErrorMsg(null);
    setSubmitting(false);
    idempotencyRef.current = generateBetIdempotencyKey();
  }, [predictionTarget]);

  if (!predictionTarget) return null;

  const { question, selection } = predictionTarget;
  const opt = question.options?.find((o) => o.key === selection);
  const selectionLabel = opt
    ? opt.label
    : selection === "yes"
      ? "Oui"
      : "Non";

  const numericStake = Math.max(
    0,
    Math.round((parseFloat(stake.replace(",", ".")) || 0) * 100) / 100
  );
  const potentialWin = Math.round(numericStake * lockedOdds * 100) / 100;
  const uid = `pred-${question.id}`;
  const inCombo = isInCombo(uid, "prediction", selection);

  const handleAddCombo = () => {
    const res = toggleComboLeg({
      uid,
      kind: "prediction",
      questionId: question.id,
      title: question.question,
      league: question.category,
      market: "prediction",
      selection,
      selectionLabel,
      odds: lockedOdds,
      startsAt: question.resolvesAt,
      isLive: false,
    });
    if (res === "full") {
      toast({
        kind: "error",
        title: "Combiné complet",
        description: "Maximum 8 sélections par ticket combiné.",
      });
      return;
    }
    closePredictionBet();
  };

  const handleConfirm = async () => {
    if (authPending && !user) return;
    if (!user) {
      closePredictionBet();
      router.push("/auth");
      return;
    }
    if (numericStake < 0.5) {
      setErrorMsg("Mise minimale : 0,50 €.");
      return;
    }
    if (numericStake > balance + 0.001) {
      setErrorMsg("Solde insuffisant pour cette mise.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.placePredictionBet({
        questionId: question.id,
        selection,
        stake: numericStake,
        expectedOdds: lockedOdds,
        oddsPolicy,
        idempotencyKey: idempotencyRef.current,
      });
      setBalance(res.balance);
      if (!res.deduplicated) {
        setPendingCount(pendingCount + 1);
      }
      bumpBets();
      toast({
        kind: "success",
        title: "Prédiction enregistrée !",
        description: `${selectionLabel} @ ${formatOdds(res.bet.odds, oddsFormat)} · Gain potentiel ${eur(res.bet.potentialWin)}`,
      });
      closePredictionBet();
    } catch (err) {
      idempotencyRef.current = generateBetIdempotencyKey();
      if (err instanceof ApiHttpError && err.code === ODDS_CHANGED_CODE) {
        const nextOdds = roundOdds2(
          err.details?.currentOdds ?? err.currentOdds ?? lockedOdds
        );
        setOddsChanged(
          err.details ?? {
            previousOdds: lockedOdds,
            currentOdds: nextOdds,
            direction: nextOdds > lockedOdds ? "up" : "down",
          }
        );
        setLockedOdds(nextOdds);
      } else if (err instanceof ApiHttpError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Impossible d'enregistrer la prédiction.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={closePredictionBet}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closePredictionBet}
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.topRow}>
            <View style={styles.catRow}>
              <Sparkles
                size={14}
                color={COLORS.betclicRed}
                strokeWidth={2.2}
              />
              <Text style={styles.catText}>{question.category}</Text>
            </View>
            <Pressable onPress={closePredictionBet} style={styles.closeBtn}>
              <X size={17} color={COLORS.mist} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            <View style={styles.card}>
              <Text style={styles.question}>{question.question}</Text>
              <View style={styles.pickRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subLabel}>Votre choix</Text>
                  <Text style={styles.pickLabel}>{selectionLabel}</Text>
                </View>
                <View style={styles.oddsBadge}>
                  <Text style={styles.oddsText}>
                    {formatOdds(lockedOdds, oddsFormat)}
                  </Text>
                </View>
              </View>
            </View>

            <TouchStakePad
              value={stake}
              onChange={(v) => {
                setStake(v);
                setErrorMsg(null);
              }}
              balance={balance}
              isLoggedIn={Boolean(user)}
            />

            <OddsLockControls
              oddsFormat={oddsFormat}
              oddsPolicy={oddsPolicy}
              onChangePolicy={setOddsPolicy}
              oddsChanged={oddsChanged}
            />

            {errorMsg ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
                {user && numericStake > balance ? (
                  <Pressable
                    onPress={() => {
                      closePredictionBet();
                      openRecharge();
                    }}
                    style={styles.rechargeBtn}
                  >
                    <Text style={styles.rechargeText}>Recharger</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.summaryBox}>
              <View>
                <Text style={styles.summaryLabel}>Cote fixe</Text>
                <Text style={styles.summaryVal}>
                  {formatOdds(lockedOdds, oddsFormat)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.summaryLabel}>Gain potentiel</Text>
                <Text style={styles.summaryWin}>{eur(potentialWin)}</Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                onPress={handleAddCombo}
                style={[styles.comboBtn, inCombo && styles.comboBtnActive]}
              >
                {inCombo ? (
                  <Check size={16} color="#ffffff" strokeWidth={2.6} />
                ) : (
                  <Layers size={16} color={COLORS.ink} strokeWidth={2.2} />
                )}
                <Text
                  style={[styles.comboText, inCombo && { color: "#ffffff" }]}
                >
                  {inCombo ? "Au combiné" : "Combiné"}
                </Text>
              </Pressable>

              <Pressable
                disabled={submitting || (authPending && !user)}
                onPress={handleConfirm}
                style={[
                  styles.submitBtn,
                  (submitting || (authPending && !user)) && { opacity: 0.65 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.submitText}>
                    {!user && !authPending
                      ? "Se connecter"
                      : oddsChanged
                        ? `Accepter ${formatOdds(lockedOdds, oddsFormat)} · ${eur(numericStake)}`
                        : `Parier · ${eur(numericStake)}`}
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
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: "90%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.edge,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  catText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.betclicRed,
    textTransform: "uppercase",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollBody: {
    gap: 12,
    paddingBottom: 6,
  },
  card: {
    borderRadius: 14,
    backgroundColor: COLORS.elev,
    padding: 13,
    gap: 10,
  },
  question: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.ink,
    lineHeight: 19,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  pickLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  oddsBadge: {
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.edge,
  },
  oddsText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  errorBox: {
    borderRadius: 12,
    backgroundColor: "rgba(225, 0, 20, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(225, 0, 20, 0.24)",
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  errorText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.betclicRed,
    flex: 1,
  },
  rechargeBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rechargeText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  summaryBox: {
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  summaryVal: {
    fontSize: 14.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  summaryWin: {
    fontSize: 16.5,
    fontWeight: "800",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  comboBtn: {
    height: 48,
    borderRadius: 13,
    paddingHorizontal: 13,
    backgroundColor: COLORS.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  comboBtnActive: {
    backgroundColor: COLORS.outerSpace,
  },
  comboText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  submitBtn: {
    flex: 1,
    height: 48,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
});
