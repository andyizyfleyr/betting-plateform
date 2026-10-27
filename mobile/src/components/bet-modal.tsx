import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, Layers, X } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/api";
import { eur, formatOdds } from "@/lib/format";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";
import { OddsLockControls } from "./odds-lock-controls";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";
import { TouchStakePad } from "./touch-stake-pad";

export function BetModal() {
  const router = useRouter();
  const {
    target,
    closeBet,
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
    feedMatches,
  } = useApp();

  const [stake, setStake] = useState("10");
  const [lockedOdds, setLockedOdds] = useState<number>(1.8);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const idempotencyRef = useRef<string>(generateBetIdempotencyKey());

  const liveMatch = useMemo(() => {
    if (!target) return null;
    return (
      feedMatches?.find((m) => m.id === target.match.id) ?? target.match
    );
  }, [feedMatches, target]);

  useEffect(() => {
    if (!target) return;
    setStake("10");
    setLockedOdds(roundOdds2(target.odds));
    setOddsChanged(null);
    setErrorMsg(null);
    setSubmitting(false);
    idempotencyRef.current = generateBetIdempotencyKey();
  }, [target]);

  if (!target || !liveMatch) return null;

  const numericStake = Math.max(
    0,
    Math.round((parseFloat(stake.replace(",", ".")) || 0) * 100) / 100
  );
  const potentialWin = Math.round(numericStake * lockedOdds * 100) / 100;
  const uid = `sport-${liveMatch.id}`;
  const inCombo = isInCombo(uid, target.market, target.selection);

  const handleAddCombo = () => {
    const res = toggleComboLeg({
      uid,
      kind: "sport",
      matchId: liveMatch.id,
      matchSource: liveMatch.source,
      title: `${liveMatch.homeTeam} – ${liveMatch.awayTeam}`,
      homeTeam: liveMatch.homeTeam,
      awayTeam: liveMatch.awayTeam,
      homeLogo: liveMatch.homeLogo ?? null,
      awayLogo: liveMatch.awayLogo ?? null,
      league: liveMatch.league,
      market: target.market,
      selection: target.selection,
      selectionLabel:
        target.market === "result"
          ? target.label
          : `${target.marketLabel} · ${target.label}`,
      odds: lockedOdds,
      startsAt: liveMatch.startsAt,
      isLive: liveMatch.status === "live",
    });
    if (res === "full") {
      toast({
        kind: "error",
        title: "Combiné complet",
        description: "Maximum 8 sélections par ticket combiné.",
      });
      return;
    }
    if (res === "source_conflict") {
      toast({
        kind: "error",
        title: "Mélange interdit",
        description:
          "Impossible de combiner un match officiel et un match virtuel.",
      });
      return;
    }
    closeBet();
  };

  const handleConfirm = async () => {
    if (!user) {
      closeBet();
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
      const res = await api.placeBet({
        matchId: liveMatch.id,
        selection: target.selection,
        market: target.market,
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
        title: "Pari validé !",
        description: `${target.label} @ ${formatOdds(res.bet.odds, oddsFormat)} · Gain potentiel ${eur(res.bet.potentialWin)}`,
      });
      closeBet();
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
        setErrorMsg("Impossible de valider le pari. Réessayez.");
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
      onRequestClose={closeBet}
    >
      <Pressable style={styles.backdrop} onPress={closeBet}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.grabber} />

          <View style={styles.topRow}>
            <View style={styles.leagueRow}>
              <SportIcon sport={liveMatch.sport} size={14} color={COLORS.dim} />
              <Text numberOfLines={1} style={styles.leagueText}>
                {liveMatch.league}
              </Text>
              {liveMatch.status === "live" ? (
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>
                    {liveMatch.minute ?? "LIVE"}
                  </Text>
                </View>
              ) : null}
            </View>
            <Pressable onPress={closeBet} style={styles.closeBtn}>
              <X size={17} color={COLORS.mist} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            <View style={styles.selectionCard}>
              <View style={styles.matchLine}>
                <TeamAvatar
                  name={liveMatch.homeTeam}
                  logo={liveMatch.homeLogo}
                  size="xs"
                />
                <Text numberOfLines={1} style={styles.matchTeams}>
                  {liveMatch.homeTeam} – {liveMatch.awayTeam}
                </Text>
                <TeamAvatar
                  name={liveMatch.awayTeam}
                  logo={liveMatch.awayLogo}
                  size="xs"
                />
              </View>

              <View style={styles.pickRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.marketLabel}>{target.marketLabel}</Text>
                  <Text style={styles.pickLabel}>{target.label}</Text>
                </View>
                <View style={styles.oddsBadge}>
                  <Text style={styles.oddsBadgeText}>
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
                      closeBet();
                      openRecharge();
                    }}
                    style={styles.rechargeInlineBtn}
                  >
                    <Text style={styles.rechargeInlineText}>Recharger</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.summaryBox}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Cote fixe</Text>
                <Text style={styles.summaryVal}>
                  {formatOdds(lockedOdds, oddsFormat)}
                </Text>
              </View>
              <View style={[styles.summaryCol, { alignItems: "flex-end" }]}>
                <Text style={styles.summaryLabel}>Gain potentiel</Text>
                <Text style={styles.summaryWin}>{eur(potentialWin)}</Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                onPress={handleAddCombo}
                style={[
                  styles.comboBtn,
                  inCombo && styles.comboBtnActive,
                ]}
              >
                {inCombo ? (
                  <Check size={16} color="#ffffff" strokeWidth={2.6} />
                ) : (
                  <Layers size={16} color={COLORS.ink} strokeWidth={2.2} />
                )}
                <Text
                  style={[
                    styles.comboBtnText,
                    inCombo && { color: "#ffffff" },
                  ]}
                >
                  {inCombo ? "Au combiné" : "Combiné"}
                </Text>
              </Pressable>

              <Pressable
                disabled={submitting || liveMatch.suspended}
                onPress={handleConfirm}
                style={[
                  styles.submitBtn,
                  (submitting || liveMatch.suspended) && { opacity: 0.65 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.submitText}>
                    {!user
                      ? "Se connecter pour parier"
                      : oddsChanged
                        ? `Accepter ${formatOdds(lockedOdds, oddsFormat)} · ${eur(numericStake)}`
                        : `Parier · ${eur(numericStake)}`}
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
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
  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  leagueText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.mist,
    flexShrink: 1,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.betclicRed,
  },
  liveText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.betclicRed,
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
  selectionCard: {
    borderRadius: 14,
    backgroundColor: COLORS.elev,
    padding: 12,
    gap: 10,
  },
  matchLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  matchTeams: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    flex: 1,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  marketLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  pickLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
    marginTop: 1,
  },
  oddsBadge: {
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.edge,
  },
  oddsBadgeText: {
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
  rechargeInlineBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rechargeInlineText: {
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
  summaryCol: {
    gap: 1,
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
  comboBtnText: {
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
    paddingHorizontal: 12,
  },
  submitText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
});
