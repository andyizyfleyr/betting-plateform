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
import { AlertTriangle, Plus, X } from "lucide-react-native";
import { api, ApiHttpError, generateIdempotencyKey } from "@/lib/api";
import { eur, formatOdds } from "@/lib/format";
import { colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";
import { TouchStakePad } from "./touch-stake-pad";
import { OddsLockControls } from "./odds-lock-controls";

export function BetModal() {
  const router = useRouter();
  const {
    user,
    balance,
    setBalance,
    betTarget,
    closeBet,
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
  const [liveOdds, setLiveOdds] = useState<number>(1.85);
  const [submitting, setSubmitting] = useState(false);
  const [oddsConflict, setOddsConflict] = useState<number | null>(null);
  const [idemKey, setIdemKey] = useState<string>(() =>
    generateIdempotencyKey("bet")
  );

  useEffect(() => {
    if (betTarget) {
      setLiveOdds(betTarget.odds);
      setOddsConflict(null);
      setIdemKey(generateIdempotencyKey("bet"));
    }
  }, [betTarget]);

  if (!betTarget) return null;

  const potentialWin = Math.round(stake * liveOdds * 100) / 100;
  const insufficient = Boolean(user) && stake > balance;

  const handleSubmit = async (acceptedOdds?: number) => {
    if (!user) {
      closeBet();
      router.push("/auth");
      return;
    }
    if (stake < 0.5 || submitting) return;
    if (insufficient) {
      closeBet();
      openRecharge();
      return;
    }

    const effectiveOdds = acceptedOdds ?? liveOdds;
    setSubmitting(true);
    try {
      const res = await api.placeBet({
        matchId: betTarget.match.id,
        market: betTarget.market,
        selection: betTarget.selection,
        selectionLabel: betTarget.selectionLabel,
        odds: effectiveOdds,
        expectedOdds: effectiveOdds,
        oddsPolicy,
        stake,
        idempotencyKey: idemKey,
      });
      setBalance(res.balance);
      void refreshPulseNow();
      closeBet();
      toast({
        kind: "success",
        title: "Pari validé !",
        subtitle: `${betTarget.match.homeTeam} – ${betTarget.match.awayTeam} · Gain potentiel ${eur(res.bet.potentialWin)}`,
      });
    } catch (err) {
      // Sur 409/503, régénérer une nouvelle clé d'idempotence pour le nouvel essai
      setIdemKey(generateIdempotencyKey("bet"));
      if (err instanceof ApiHttpError && err.code === "ODDS_CHANGED" && err.currentOdds) {
        setLiveOdds(err.currentOdds);
        setOddsConflict(err.currentOdds);
      } else {
        toast({
          kind: "error",
          title: "Pari refusé",
          subtitle: err instanceof Error ? err.message : "Réessayez",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToCombo = () => {
    const res = toggleComboLeg({
      kind: "sport",
      matchId: betTarget.match.id,
      title: `${betTarget.match.homeTeam} – ${betTarget.match.awayTeam}`,
      league: betTarget.match.league,
      homeTeam: betTarget.match.homeTeam,
      awayTeam: betTarget.match.awayTeam,
      homeLogo: betTarget.match.homeLogo ?? null,
      awayLogo: betTarget.match.awayLogo ?? null,
      market: betTarget.market,
      selection: betTarget.selection,
      selectionLabel: betTarget.selectionLabel,
      odds: liveOdds,
      startsAt: betTarget.match.startsAt,
      isLive: betTarget.match.status === "live",
      source: betTarget.match.source ?? "virtual",
    });
    closeBet();
    if (res === "full") {
      toast({ kind: "error", title: "Maximum 8 sélections dans le Betslip" });
    } else {
      toast({
        kind: "info",
        title: "Ajouté au Betslip",
        subtitle: `${betTarget.match.homeTeam} – ${betTarget.match.awayTeam}`,
      });
    }
  };

  return (
    <Modal
      visible={Boolean(betTarget)}
      transparent
      animationType="slide"
      onRequestClose={closeBet}
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={closeBet} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.matchTitle}>
                  {betTarget.match.homeTeam} – {betTarget.match.awayTeam}
                </Text>
                <Text numberOfLines={1} style={styles.selLabel}>
                  {betTarget.selectionLabel}
                </Text>
              </View>
              <View style={styles.oddsBadge}>
                <Text style={styles.oddsBadgeText}>
                  {formatOdds(liveOdds, oddsFormat)}
                </Text>
              </View>
              <Pressable onPress={closeBet} style={styles.closeBtn}>
                <X size={17} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            </View>

            {oddsConflict !== null && (
              <View style={styles.conflictBox}>
                <AlertTriangle size={15} color={colors.amber} strokeWidth={2.4} />
                <Text style={styles.conflictText}>
                  La cote a évolué à {formatOdds(oddsConflict, oddsFormat)}. Confirmez pour valider.
                </Text>
              </View>
            )}

            <TouchStakePad
              stake={stake}
              onChangeStake={setStake}
              maxBalance={balance}
              presets={stakePresets}
            />

            <OddsLockControls value={oddsPolicy} onChange={setOddsPolicy} />

            <View style={styles.payoutRow}>
              <Text style={styles.payoutLabel}>Gain potentiel (cote fixe)</Text>
              <Text style={styles.payoutVal}>{eur(potentialWin)}</Text>
            </View>

            <View style={styles.actionsRow}>
              <Pressable onPress={handleAddToCombo} style={styles.comboBtn}>
                <Plus size={15} color={colors.ink} strokeWidth={2.5} />
                <Text style={styles.comboBtnText}>Betslip</Text>
              </Pressable>

              <Pressable
                disabled={submitting || stake < 0.5}
                onPress={() =>
                  void handleSubmit(oddsConflict ?? undefined)
                }
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
                      ? "Se connecter pour parier"
                      : insufficient
                        ? "Recharger mon solde"
                        : oddsConflict !== null
                          ? `Accepter ${formatOdds(oddsConflict, oddsFormat)} & parier`
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
  matchTitle: {
    fontSize: 14.5,
    fontWeight: "900",
    color: colors.ink,
  },
  selLabel: {
    marginTop: 2,
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
  conflictBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 11,
    backgroundColor: colors.amberSoft,
  },
  conflictText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: colors.amber,
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
