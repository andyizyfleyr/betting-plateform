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
import {
  Check,
  Flame,
  Trash2,
  X,
  Zap,
} from "lucide-react-native";
import { useApp, type ComboSelection } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/api";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  MIN_COMBO_LEGS,
  MIN_ELIGIBLE_BOOST_ODDS,
  nextComboBoostTier,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { eur, formatOdds } from "@/lib/format";
import { usePathname, useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";
import { OddsLockControls } from "./odds-lock-controls";
import { TeamAvatar } from "./team-avatar";
import { TouchStakePad } from "./touch-stake-pad";

export type { ComboSelection };

export function ComboFloatingBar() {
  const pathname = usePathname();
  const {
    comboLegs,
    comboOpen,
    comboQuickMode,
    setComboQuickMode,
    openCombo,
    clearCombo,
    target,
    marketMatch,
    rechargeOpen,
    oddsFormat,
  } = useApp();

  const allowedRoute =
    pathname === "/matchs" ||
    pathname.startsWith("/matchs/") ||
    pathname === "/predictions" ||
    pathname.startsWith("/predictions/") ||
    pathname === "/paris";

  if (
    !allowedRoute ||
    comboLegs.length === 0 ||
    comboOpen ||
    target ||
    marketMatch ||
    rechargeOpen
  ) {
    return null;
  }

  const quote = computeComboQuote(
    comboLegs.map((l) => l.odds),
    10
  );

  return (
    <View pointerEvents="box-none" style={styles.floatWrap}>
      <View style={styles.floatCard}>
        <Pressable onPress={openCombo} style={styles.floatLeft}>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{comboLegs.length}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.floatTitleRow}>
              <Text numberOfLines={1} style={styles.floatTitle}>
                {comboLegs.length === 1
                  ? "Coupon (1 sélection)"
                  : "Coupon de pari · Combiné"}
              </Text>
              {quote.boostPct > 0 ? (
                <View style={styles.floatBoostBadge}>
                  <Text style={styles.floatBoostText}>
                    +{quote.boostPct}% Bonus
                  </Text>
                </View>
              ) : null}
            </View>
            <Text numberOfLines={1} style={styles.floatSub}>
              Cote totale{" "}
              <Text style={styles.floatSubStrong}>
                {formatOdds(quote.totalOdds, oddsFormat)}
              </Text>
            </Text>
          </View>
        </Pressable>

        <View style={styles.floatRight}>
          <Pressable
            onPress={() => setComboQuickMode(!comboQuickMode)}
            style={[
              styles.quickModeBtn,
              comboQuickMode && styles.quickModeBtnActive,
            ]}
          >
            <Zap
              size={12}
              color={comboQuickMode ? "#6ee7b7" : "rgba(255,255,255,0.75)"}
              strokeWidth={2.5}
            />
            <Text
              style={[
                styles.quickModeText,
                comboQuickMode && { color: "#6ee7b7" },
              ]}
            >
              1-clic
            </Text>
          </Pressable>

          <Pressable onPress={openCombo} style={styles.openBtn}>
            <Text style={styles.openBtnText}>Ouvrir</Text>
          </Pressable>

          <Pressable onPress={clearCombo} style={styles.clearIconBtn}>
            <X size={14} color="rgba(255,255,255,0.75)" strokeWidth={2.3} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function ComboSheet() {
  const router = useRouter();
  const {
    comboLegs,
    comboOpen,
    closeCombo,
    removeComboLeg,
    clearCombo,
    applyComboOddsUpdates,
    oddsPolicy,
    setOddsPolicy,
    balance,
    setBalance,
    bumpBets,
    openRecharge,
    oddsFormat,
    toast,
    authReady,
    sessionRestoring,
    user,
    hapticsEnabled,
  } = useApp();

  const [stakeText, setStakeText] = useState("10");
  const [phase, setPhase] = useState<"input" | "loading" | "success">("input");
  const [error, setError] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(
    null
  );
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);
  const [placedInfo, setPlacedInfo] = useState<{
    id: number;
    totalOdds: number;
    stake: number;
    potentialWin: number;
    boostPct: number;
  } | null>(null);

  const orderedLegs = useMemo(
    () => sortSlipSelectionsChronologically(comboLegs),
    [comboLegs]
  );
  const legsRef = useRef(comboLegs);
  legsRef.current = comboLegs;

  useEffect(() => {
    if (!comboOpen || comboLegs.length === 0) return;
    let active = true;
    const pollLegs = async () => {
      const currentLegs = legsRef.current;
      if (currentLegs.length === 0) return;
      const matchIds = [
        ...new Set(
          currentLegs
            .filter((l) => l.kind === "sport" && l.matchId != null)
            .map((l) => l.matchId as number)
        ),
      ];
      const hasPreds = currentLegs.some((l) => l.kind === "prediction");
      try {
        const [matchResults, predsCatalog] = await Promise.all([
          Promise.all(
            matchIds.map((id) => api.matchById(id).catch(() => null))
          ),
          hasPreds ? api.predictionsCatalog().catch(() => null) : Promise.resolve(null),
        ]);
        if (!active) return;
        const updates: Parameters<typeof applyComboOddsUpdates>[0] = [];
        const matchById = new Map(
          matchResults
            .filter((r): r is NonNullable<typeof r> => Boolean(r?.match))
            .map((r) => [r.match.id, r.match])
        );
        const predById = new Map(
          (predsCatalog?.questions ?? []).map((q) => [q.id, q])
        );
        for (const leg of legsRef.current) {
          if (leg.kind === "sport" && leg.matchId != null) {
            const m = matchById.get(leg.matchId);
            if (!m || m.status === "finished") continue;
            const grp = (m.markets ?? []).find(
              (g) =>
                g.key === leg.market ||
                (leg.market === "result" && g.key === "1x2")
            );
            let nextOdds =
              grp?.outcomes.find((o) => o.key === leg.selection)?.odds ?? null;
            if (nextOdds == null && grp?.rows) {
              for (const row of grp.rows) {
                const hit = row.outcomes.find((o) => o.key === leg.selection);
                if (hit) {
                  nextOdds = hit.odds;
                  break;
                }
              }
            }
            if (
              nextOdds != null &&
              Math.abs(roundOdds2(nextOdds) - roundOdds2(leg.odds)) >= 0.005
            ) {
              updates.push({
                kind: "sport",
                matchId: leg.matchId,
                market: leg.market,
                selection: leg.selection,
                previousOdds: leg.odds,
                currentOdds: roundOdds2(nextOdds),
                direction: nextOdds > leg.odds ? "up" : "down",
              });
            }
          } else if (leg.kind === "prediction" && leg.questionId != null) {
            const q = predById.get(leg.questionId);
            if (!q || q.status !== "open") continue;
            const optOdds =
              leg.selection === "yes"
                ? q.oddsYes
                : leg.selection === "no"
                  ? q.oddsNo
                  : (q.options?.find((o) => o.key === leg.selection)?.odds ??
                    null);
            if (
              optOdds != null &&
              Math.abs(roundOdds2(optOdds) - roundOdds2(leg.odds)) >= 0.005
            ) {
              updates.push({
                kind: "prediction",
                questionId: leg.questionId,
                market: leg.market,
                selection: leg.selection,
                previousOdds: leg.odds,
                currentOdds: roundOdds2(optOdds),
                direction: optOdds > leg.odds ? "up" : "down",
              });
            }
          }
        }
        if (updates.length > 0) {
          applyComboOddsUpdates(updates);
        }
      } catch {
        /* silencieux */
      }
    };
    void pollLegs();
    const timer = setInterval(() => void pollLegs(), 4_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [applyComboOddsUpdates, comboLegs.length, comboOpen]);

  if (!comboOpen) return null;

  const parsed = Number(stakeText.replace(",", "."));
  const stake =
    Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const overBalance = Boolean(user) && stake > balance;
  const enoughLegs = orderedLegs.length >= MIN_COMBO_LEGS;

  const quote = computeComboQuote(
    orderedLegs.map((l) => l.odds),
    stake
  );
  const nextBoost = nextComboBoostTier(quote.eligibleLegs);

  const canSubmit =
    phase === "input" &&
    enoughLegs &&
    orderedLegs.length <= MAX_COMBO_LEGS &&
    stake >= 0.5 &&
    !overBalance;

  const submitCombo = async () => {
    if ((!authReady || sessionRestoring) && !user) return;
    if (!user) {
      closeCombo();
      router.push("/auth");
      return;
    }
    if (!canSubmit || inFlightRef.current) return;
    inFlightRef.current = true;
    const legsSig = orderedLegs
      .map((l) => `${l.uid}:${l.market}:${l.selection}:${roundOdds2(l.odds)}`)
      .join("|");
    const sig = `${legsSig}::${stake}::${quote.totalOdds}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = { key: generateBetIdempotencyKey(), sig };
    }

    setPhase("loading");
    setError(null);
    try {
      const res = await api.placeComboBet({
        legs: orderedLegs.map((l) => ({
          kind: l.kind,
          ...(l.matchId ? { matchId: l.matchId } : {}),
          ...(l.questionId ? { questionId: l.questionId } : {}),
          market: l.market,
          selection: l.selection,
          expectedOdds: roundOdds2(l.odds),
        })),
        stake,
        expectedTotalOdds: quote.totalOdds,
        oddsPolicy,
        idempotencyKey: idempotencySlotRef.current.key,
      });
      idempotencySlotRef.current = null;
      setOddsChanged(null);
      setBalance(res.balance);
      bumpBets();
      triggerHaptic("success", hapticsEnabled);
      setPlacedInfo(res.bet);
      clearCombo();
      setPhase("success");
    } catch (e) {
      setPhase("input");
      if (e instanceof ApiHttpError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      if (
        e instanceof ApiHttpError &&
        e.status === 409 &&
        e.code === ODDS_CHANGED_CODE &&
        e.details
      ) {
        setOddsChanged(e.details);
        if (e.details.updatedLegs && e.details.updatedLegs.length > 0) {
          applyComboOddsUpdates(e.details.updatedLegs);
        }
        return;
      }
      setOddsChanged(null);
      const msg = e instanceof Error ? e.message : "Validation impossible";
      setError(msg);
      toast({ kind: "error", title: "Combiné refusé", description: msg });
    } finally {
      inFlightRef.current = false;
    }
  };

  const finishAndClose = (goBets = false) => {
    setPhase("input");
    setPlacedInfo(null);
    setError(null);
    setOddsChanged(null);
    closeCombo();
    if (goBets) router.push("/paris");
  };

  return (
    <Modal
      visible={comboOpen}
      transparent
      animationType="slide"
      onRequestClose={() => finishAndClose(false)}
    >
      <View style={styles.sheetOverlay}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={
            phase === "loading" ? undefined : () => finishAndClose(false)
          }
        />

        <View style={styles.sheetCard}>
          {phase === "success" && placedInfo ? (
            <View style={styles.successBox}>
              <View style={styles.successIcon}>
                <Check size={28} color={COLORS.win} strokeWidth={2.6} />
              </View>
              <Text style={styles.successTitle}>Pari combiné accepté !</Text>
              <Text style={styles.successSub}>
                Cote totale{" "}
                <Text style={{ fontWeight: "500", color: COLORS.ink }}>
                  {formatOdds(placedInfo.totalOdds, oddsFormat)}
                </Text>
                {placedInfo.boostPct > 0
                  ? ` (+${placedInfo.boostPct}% Bonus inclus)`
                  : ""}
              </Text>

              <View style={styles.successPayoutRow}>
                <View>
                  <Text style={styles.successStake}>
                    Mise : {eur(placedInfo.stake)}
                  </Text>
                  <Text style={styles.successGainLabel}>Gain potentiel</Text>
                </View>
                <Text style={styles.successGainVal}>
                  {eur(placedInfo.potentialWin)}
                </Text>
              </View>

              <View style={styles.successActions}>
                <Pressable
                  onPress={() => finishAndClose(true)}
                  style={styles.successPrimaryBtn}
                >
                  <Text style={styles.successPrimaryText}>Voir mes paris</Text>
                </Pressable>
                <Pressable
                  onPress={() => finishAndClose(false)}
                  style={styles.successSecondaryBtn}
                >
                  <Text style={styles.successSecondaryText}>Continuer</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.sheetHeader}>
                <View style={styles.grabber} />
                <View style={styles.sheetHeadRow}>
                  <View style={styles.sheetHeadLeft}>
                    <Text style={styles.sheetTitle}>Coupon combiné</Text>
                    <View style={styles.sheetCountBadge}>
                      <Text style={styles.sheetCountText}>
                        {orderedLegs.length}/{MAX_COMBO_LEGS}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.sheetHeadRight}>
                    {orderedLegs.length > 0 ? (
                      <Pressable
                        onPress={clearCombo}
                        style={styles.sheetClearBtn}
                      >
                        <Trash2 size={13} color={COLORS.mist} strokeWidth={2.1} />
                        <Text style={styles.sheetClearText}>Vider</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => finishAndClose(false)}
                      style={styles.sheetCloseBtn}
                    >
                      <X size={16} color={COLORS.mist} strokeWidth={2.2} />
                    </Pressable>
                  </View>
                </View>
              </View>

              <ScrollView
                style={{ maxHeight: 380 }}
                contentContainerStyle={styles.sheetBody}
                showsVerticalScrollIndicator={false}
              >
                {orderedLegs.length >= 2 ? (
                  <View style={styles.boostCard}>
                    <View style={styles.boostRow}>
                      <View style={styles.boostLeft}>
                        <Flame
                          size={14}
                          color={COLORS.betclicRed}
                          strokeWidth={2.4}
                        />
                        <Text style={styles.boostTitle}>
                          {quote.boostPct > 0
                            ? `Bonus Combiné +${quote.boostPct}%`
                            : "Bonus Combiné jusqu'à +20%"}
                        </Text>
                      </View>
                      <Text style={styles.boostHint}>
                        {nextBoost
                          ? `+${nextBoost.needed} (≥${MIN_ELIGIBLE_BOOST_ODDS}) → +${nextBoost.pct}%`
                          : "Max atteint"}
                      </Text>
                    </View>
                    <View style={styles.boostTrack}>
                      <View
                        style={[
                          styles.boostFill,
                          {
                            width: `${Math.min(100, (quote.eligibleLegs / 8) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.needTwoBox}>
                    <Text style={styles.needTwoText}>
                      Ajoutez au moins 2 sélections pour valider un combiné (ou
                      ouvrez l&apos;onglet Betslip pour un pari simple).
                    </Text>
                  </View>
                )}

                {orderedLegs.map((leg) => (
                  <View key={leg.uid} style={styles.legItem}>
                    <View style={styles.legTopRow}>
                      <View style={styles.legMeta}>
                        {leg.homeTeam ? (
                          <TeamAvatar
                            name={leg.homeTeam}
                            logo={leg.homeLogo}
                            size="2xs"
                          />
                        ) : null}
                        <Text numberOfLines={1} style={styles.legTitle}>
                          {leg.title}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => removeComboLeg(leg.uid)}
                        style={styles.legRemoveBtn}
                      >
                        <X size={13} color={COLORS.mist} strokeWidth={2.2} />
                      </Pressable>
                    </View>
                    <View style={styles.legPickRow}>
                      <Text numberOfLines={1} style={styles.legPickText}>
                        {leg.selectionLabel}
                      </Text>
                      <Text style={styles.legOddsText}>
                        {formatOdds(leg.odds, oddsFormat)}
                      </Text>
                    </View>
                  </View>
                ))}

                <TouchStakePad
                  value={stakeText}
                  onChange={(next) => {
                    setStakeText(next);
                    setError(null);
                  }}
                  balance={balance}
                  isLoggedIn={Boolean(user)}
                  compact
                />

                {oddsChanged ? (
                  <OddsLockControls
                    policy={oddsPolicy}
                    onChangePolicy={setOddsPolicy}
                    details={oddsChanged}
                    oddsFormat={oddsFormat}
                    onAcceptNewOdds={() => {
                      setOddsChanged(null);
                      void submitCombo();
                    }}
                  />
                ) : null}

                {overBalance && user ? (
                  <Pressable onPress={openRecharge} style={styles.rechargeHint}>
                    <Text style={styles.rechargeHintText}>
                      Solde insuffisant ({eur(balance)}) · Recharger
                    </Text>
                  </Pressable>
                ) : null}

                {error ? <Text style={styles.errText}>{error}</Text> : null}
              </ScrollView>

              <View style={styles.sheetFooter}>
                <View style={styles.quoteSummaryRow}>
                  <Text style={styles.quoteLabel}>
                    Cote totale{" "}
                    <Text style={styles.quoteOddsStrong}>
                      {formatOdds(quote.totalOdds, oddsFormat)}
                    </Text>
                  </Text>
                  <Text style={styles.quoteWin}>
                    Gain : {eur(quote.potentialWin)}
                  </Text>
                </View>

                <Pressable
                  disabled={!canSubmit}
                  onPress={() => void submitCombo()}
                  style={[
                    styles.submitBtn,
                    !canSubmit && { opacity: 0.48 },
                  ]}
                >
                  {phase === "loading" ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.submitBtnText}>
                      Valider le combiné · {eur(stake)}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  floatWrap: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 66,
    zIndex: 40,
  },
  floatCard: {
    borderRadius: 14,
    backgroundColor: COLORS.ink,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  floatLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  countBadge: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  floatTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  floatTitle: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
  floatBoostBadge: {
    borderRadius: 6,
    backgroundColor: "rgba(16, 185, 129, 0.25)",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  floatBoostText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#6ee7b7",
  },
  floatSub: {
    fontSize: 10,
    color: "rgba(255,255,255,0.70)",
  },
  floatSubStrong: {
    fontWeight: "500",
    color: "#ffffff",
  },
  floatRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickModeBtn: {
    height: 32,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  quickModeBtnActive: {
    backgroundColor: "rgba(16,185,129,0.25)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.4)",
  },
  quickModeText: {
    fontSize: 10,
    fontWeight: "500",
    color: "rgba(255,255,255,0.75)",
  },
  openBtn: {
    height: 32,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  openBtnText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  clearIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheetCard: {
    maxHeight: "88%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  sheetHeader: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edge,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: COLORS.edge,
    alignSelf: "center",
  },
  sheetHeadRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetTitle: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  sheetCountBadge: {
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sheetCountText: {
    fontSize: 10,
    fontWeight: "500",
    color: "#ffffff",
  },
  sheetHeadRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetClearBtn: {
    height: 30,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sheetClearText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBody: {
    padding: 16,
    gap: 10,
  },
  boostCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    padding: 10,
    gap: 6,
  },
  boostRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  boostLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  boostTitle: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  boostHint: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  boostTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  boostFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
  },
  needTwoBox: {
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    padding: 10,
  },
  needTwoText: {
    fontSize: 10.5,
    color: COLORS.mist,
    lineHeight: 16,
  },
  legItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 6,
  },
  legTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legMeta: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.ink,
  },
  legRemoveBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  legPickRow: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  legPickText: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  legOddsText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  rechargeHint: {
    borderRadius: 10,
    backgroundColor: "rgba(225,0,20,0.08)",
    padding: 9,
    alignItems: "center",
  },
  rechargeHintText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  errText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  sheetFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.edge,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 8,
  },
  quoteSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quoteLabel: {
    fontSize: 11,
    color: COLORS.mist,
  },
  quoteOddsStrong: {
    fontWeight: "500",
    color: COLORS.ink,
  },
  quoteWin: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
  submitBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  successBox: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
    alignItems: "center",
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(21,128,61,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: {
    marginTop: 12,
    fontSize: 14.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  successSub: {
    marginTop: 4,
    fontSize: 11,
    color: COLORS.mist,
  },
  successPayoutRow: {
    marginTop: 16,
    width: "100%",
    borderRadius: 16,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  successStake: {
    fontSize: 10,
    color: COLORS.dim,
  },
  successGainLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  successGainVal: {
    fontSize: 14.5,
    fontWeight: "500",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
  successActions: {
    marginTop: 16,
    width: "100%",
    flexDirection: "row",
    gap: 8,
  },
  successPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  successPrimaryText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  successSecondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  successSecondaryText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
});
