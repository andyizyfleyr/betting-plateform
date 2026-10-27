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
  ChevronUp,
  Flame,
  Layers,
  Sparkles,
  Trash2,
  X,
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
  MIN_ELIGIBLE_BOOST_ODDS,
  nextComboBoostTier,
} from "@/lib/combo-math";
import { eur, formatMatchDateTimeShort, formatOdds } from "@/lib/format";
import { usePathname, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";
import { CouponCodeBox } from "./coupon-code-box";
import { OddsLockControls } from "./odds-lock-controls";
import { TeamAvatar } from "./team-avatar";
import { TouchStakePad } from "./touch-stake-pad";

function sortDraftChronologically(legs: ComboSelection[]): ComboSelection[] {
  if (legs.length <= 1) return [...legs];
  return legs
    .map((leg, idx) => {
      const rank = leg.isLive ? 1 : 2;
      const ms = leg.startsAt ? Date.parse(leg.startsAt) : Number.MAX_SAFE_INTEGER;
      return {
        leg,
        idx,
        rank,
        ms: Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.ms - b.ms || a.idx - b.idx)
    .map((x) => x.leg);
}

export function ComboSlipBody({
  inPage = false,
  onAfterSubmit,
}: {
  inPage?: boolean;
  onAfterSubmit?: () => void;
}) {
  const router = useRouter();
  const {
    user,
    balance,
    setBalance,
    bumpBets,
    comboLegs,
    removeComboLeg,
    clearCombo,
    applyComboOddsUpdates,
    oddsFormat,
    oddsPolicy,
    setOddsPolicy,
    comboQuickMode,
    setComboQuickMode,
    openRecharge,
    toast,
    feedMatches,
  } = useApp();

  const [stake, setStake] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(
    null
  );
  const idempotencyRef = useRef<string>(generateBetIdempotencyKey());

  const syncedLegs = useMemo(() => {
    const mapped = comboLegs.map((leg) => {
      if (leg.kind === "sport" && leg.matchId && feedMatches) {
        const live = feedMatches.find((m) => m.id === leg.matchId);
        if (live) {
          const g = live.markets.find((mk) => mk.key === leg.market);
          const o = g?.outcomes.find((out) => out.key === leg.selection);
          return {
            ...leg,
            odds: o ? o.odds : leg.odds,
            isLive: live.status === "live",
            startsAt: live.startsAt,
          };
        }
      }
      return leg;
    });
    return sortDraftChronologically(mapped);
  }, [comboLegs, feedMatches]);

  useEffect(() => {
    idempotencyRef.current = generateBetIdempotencyKey();
  }, [comboLegs.length]);

  const numericStake = Math.max(
    0,
    Math.round((parseFloat(stake.replace(",", ".")) || 0) * 100) / 100
  );
  const quote = useMemo(
    () =>
      computeComboQuote(
        syncedLegs.map((l) => l.odds),
        numericStake
      ),
    [numericStake, syncedLegs]
  );
  const nextBoost = useMemo(
    () => nextComboBoostTier(quote.eligibleLegs),
    [quote.eligibleLegs]
  );

  const handlePlace = async () => {
    if (!user) {
      onAfterSubmit?.();
      router.push("/auth");
      return;
    }
    if (syncedLegs.length === 0) return;
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
      if (syncedLegs.length === 1) {
        const single = syncedLegs[0];
        if (single.kind === "sport" && single.matchId) {
          const res = await api.placeBet({
            matchId: single.matchId,
            selection: single.selection,
            market: single.market,
            stake: numericStake,
            expectedOdds: roundOdds2(single.odds),
            oddsPolicy,
            idempotencyKey: idempotencyRef.current,
          });
          setBalance(res.balance);
        } else if (single.kind === "prediction" && single.questionId) {
          const res = await api.placePredictionBet({
            questionId: single.questionId,
            selection: single.selection,
            stake: numericStake,
            expectedOdds: roundOdds2(single.odds),
            oddsPolicy,
            idempotencyKey: idempotencyRef.current,
          });
          setBalance(res.balance);
        }
        clearCombo();
        setOddsChanged(null);
        bumpBets();
        toast({
          kind: "success",
          title: "Pari simple validé !",
          description: `Mise ${eur(numericStake)} enregistrée.`,
        });
        onAfterSubmit?.();
        return;
      }

      const res = await api.placeComboBet({
        legs: syncedLegs.map((l) => ({
          kind: l.kind,
          matchId: l.matchId,
          questionId: l.questionId,
          market: l.market,
          selection: l.selection,
          expectedOdds: roundOdds2(l.odds),
        })),
        stake: numericStake,
        expectedTotalOdds: quote.totalOdds,
        oddsPolicy,
        idempotencyKey: idempotencyRef.current,
      });

      setBalance(res.balance);
      clearCombo();
      setOddsChanged(null);
      bumpBets();
      toast({
        kind: "success",
        title: `Combiné validé @ ${formatOdds(res.bet.totalOdds, oddsFormat)} !`,
        description: `Gain potentiel ${eur(res.bet.potentialWin)}${res.bet.boostPct > 0 ? ` (Boost +${res.bet.boostPct} %)` : ""}`,
      });
      onAfterSubmit?.();
    } catch (err) {
      idempotencyRef.current = generateBetIdempotencyKey();
      if (err instanceof ApiHttpError && err.code === ODDS_CHANGED_CODE) {
        if (err.details?.updatedLegs) {
          applyComboOddsUpdates(err.details.updatedLegs);
        }
        setOddsChanged(
          err.details ?? {
            previousOdds: quote.totalOdds,
            currentOdds: err.currentOdds ?? quote.totalOdds,
            direction:
              (err.currentOdds ?? quote.totalOdds) > quote.totalOdds
                ? "up"
                : "down",
          }
        );
      } else if (err instanceof ApiHttpError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Impossible de valider le ticket. Réessayez.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Barre Mode 1-clic + Vider */}
      <View style={styles.toolbar}>
        <Pressable
          onPress={() => setComboQuickMode(!comboQuickMode)}
          style={[
            styles.quickToggle,
            comboQuickMode && styles.quickToggleActive,
          ]}
        >
          <Sparkles
            size={13}
            color={comboQuickMode ? "#ffffff" : COLORS.mist}
            strokeWidth={2.3}
          />
          <Text
            style={[
              styles.quickToggleText,
              comboQuickMode && { color: "#ffffff" },
            ]}
          >
            Sélection 1-clic {comboQuickMode ? "ON" : "OFF"}
          </Text>
        </Pressable>

        {syncedLegs.length > 0 ? (
          <Pressable onPress={clearCombo} style={styles.clearBtn}>
            <Trash2 size={13.5} color={COLORS.dim} strokeWidth={2.2} />
            <Text style={styles.clearBtnText}>Vider</Text>
          </Pressable>
        ) : null}
      </View>

      {syncedLegs.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Layers size={22} color={COLORS.betclicRed} strokeWidth={2.2} />
          </View>
          <Text style={styles.emptyTitle}>Votre Betslip est vide</Text>
          <Text style={styles.emptyDesc}>
            Maintenez une cote appuyée (ou activez le mode 1-clic) pour combiner
            jusqu&apos;à 8 sélections et débloquer jusqu&apos;à +20 % de Bonus
            Combiné.
          </Text>
          {inPage ? (
            <Pressable
              onPress={() => router.push("/matchs")}
              style={styles.browseBtn}
            >
              <Text style={styles.browseBtnText}>Parcourir les matchs</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          {/* Jauge Boost Combiné */}
          <View style={styles.boostCard}>
            <View style={styles.boostRow}>
              <Flame
                size={15}
                color={quote.boostPct > 0 ? COLORS.win : COLORS.amber}
                strokeWidth={2.4}
              />
              <Text style={styles.boostTitle}>
                {quote.boostPct > 0
                  ? `Bonus Combiné actif : +${quote.boostPct} %`
                  : "Bonus Combiné jusqu'à +20 %"}
              </Text>
            </View>
            {nextBoost ? (
              <Text style={styles.boostSub}>
                +{nextBoost.needed} sélection
                {nextBoost.needed > 1 ? "s" : ""} (cote ≥{" "}
                {formatOdds(MIN_ELIGIBLE_BOOST_ODDS, oddsFormat)}) pour +
                {nextBoost.pct} %
              </Text>
            ) : (
              <Text style={styles.boostSub}>
                Palier maximum +20 % débloqué !
              </Text>
            )}
          </View>

          {/* Liste des sélections */}
          <View style={styles.legsList}>
            {syncedLegs.map((leg) => (
              <View key={leg.uid} style={styles.legCard}>
                <Pressable
                  onPress={() => {
                    onAfterSubmit?.();
                    if (leg.kind === "sport" && leg.matchId) {
                      router.push(`/matchs/${leg.matchId}`);
                    } else if (leg.kind === "prediction" && leg.questionId) {
                      router.push(`/predictions/${leg.questionId}`);
                    }
                  }}
                  style={styles.legMain}
                >
                  <View style={styles.legMetaRow}>
                    <Text numberOfLines={1} style={styles.legLeague}>
                      {leg.league}
                    </Text>
                    {leg.isLive ? (
                      <View style={styles.legLivePill}>
                        <View style={styles.legLiveDot} />
                        <Text style={styles.legLiveText}>DIRECT</Text>
                      </View>
                    ) : leg.startsAt ? (
                      <Text style={styles.legDate}>
                        {formatMatchDateTimeShort(leg.startsAt)}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.legTitleRow}>
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
                    {leg.awayTeam ? (
                      <TeamAvatar
                        name={leg.awayTeam}
                        logo={leg.awayLogo}
                        size="2xs"
                      />
                    ) : null}
                  </View>

                  <Text numberOfLines={1} style={styles.legPick}>
                    {leg.selectionLabel}
                  </Text>
                </Pressable>

                <View style={styles.legRight}>
                  <View style={styles.legOddsPill}>
                    <Text style={styles.legOddsText}>
                      {formatOdds(leg.odds, oddsFormat)}
                    </Text>
                  </View>
                  <Pressable
                    hitSlop={8}
                    onPress={() => removeComboLeg(leg.uid)}
                    style={styles.removeBtn}
                  >
                    <X size={14} color={COLORS.dim} strokeWidth={2.4} />
                  </Pressable>
                </View>
              </View>
            ))}
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
                    onAfterSubmit?.();
                    openRecharge();
                  }}
                  style={styles.rechargeBtn}
                >
                  <Text style={styles.rechargeText}>Recharger</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={styles.quoteCard}>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>
                {syncedLegs.length > 1 ? "Cote totale" : "Cote fixe"}
              </Text>
              <Text style={styles.quoteVal}>
                {formatOdds(quote.totalOdds, oddsFormat)}
              </Text>
            </View>
            {quote.boostAmount > 0 ? (
              <View style={styles.quoteRow}>
                <Text style={[styles.quoteLabel, { color: COLORS.win }]}>
                  Bonus Combiné (+{quote.boostPct} %)
                </Text>
                <Text style={[styles.quoteVal, { color: COLORS.win }]}>
                  +{eur(quote.boostAmount)}
                </Text>
              </View>
            ) : null}
            <View style={[styles.quoteRow, styles.quoteTotalRow]}>
              <Text style={styles.quoteTotalLabel}>Gain potentiel</Text>
              <Text style={styles.quoteTotalWin}>
                {eur(quote.potentialWin)}
              </Text>
            </View>
          </View>

          <Pressable
            disabled={submitting}
            onPress={handlePlace}
            style={[styles.submitBtn, submitting && { opacity: 0.65 }]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.submitText}>
                {!user
                  ? "Se connecter pour valider"
                  : oddsChanged
                    ? `Accepter ${formatOdds(quote.totalOdds, oddsFormat)} · ${eur(numericStake)}`
                    : syncedLegs.length > 1
                      ? `Valider le combiné · ${eur(numericStake)}`
                      : `Valider le pari · ${eur(numericStake)}`}
              </Text>
            )}
          </Pressable>
        </>
      )}

      <CouponCodeBox />
    </View>
  );
}

export function ComboFloatingBar() {
  const pathname = usePathname();
  const { comboLegs, openCombo, oddsFormat } = useApp();

  if (
    comboLegs.length === 0 ||
    pathname.startsWith("/betslip") ||
    pathname.startsWith("/parametres") ||
    pathname === "/jeux" ||
    pathname === "/auth" ||
    pathname.startsWith("/admin") ||
    pathname === "/tap" ||
    pathname === "/accelerator"
  ) {
    return null;
  }

  const quote = computeComboQuote(
    comboLegs.map((l) => l.odds),
    10
  );

  return (
    <View pointerEvents="box-none" style={styles.floatWrap}>
      <Pressable onPress={openCombo} style={styles.floatBar}>
        <View style={styles.floatLeft}>
          <View style={styles.floatCountBadge}>
            <Text style={styles.floatCountText}>{comboLegs.length}</Text>
          </View>
          <View>
            <Text style={styles.floatTitle}>
              {comboLegs.length > 1 ? "Ticket combiné" : "Sélection Betslip"}
            </Text>
            <Text style={styles.floatSub}>
              Cote {formatOdds(quote.totalOdds, oddsFormat)}
              {quote.boostPct > 0 ? ` · Boost +${quote.boostPct}%` : ""}
            </Text>
          </View>
        </View>
        <View style={styles.floatRight}>
          <Text style={styles.floatOpenText}>Ouvrir</Text>
          <ChevronUp size={15} color="#ffffff" strokeWidth={2.5} />
        </View>
      </Pressable>
    </View>
  );
}

export function ComboSheet() {
  const { comboOpen, closeCombo, comboLegs } = useApp();

  if (!comboOpen) return null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={closeCombo}
    >
      <Pressable style={styles.backdrop} onPress={closeCombo}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <View style={styles.sheetTitleRow}>
              <Layers size={17} color={COLORS.betclicRed} strokeWidth={2.4} />
              <Text style={styles.sheetTitle}>Betslip</Text>
              {comboLegs.length > 0 ? (
                <View style={styles.sheetCount}>
                  <Text style={styles.sheetCountText}>{comboLegs.length}</Text>
                </View>
              ) : null}
            </View>
            <Pressable onPress={closeCombo} style={styles.closeBtn}>
              <X size={17} color={COLORS.mist} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 14 }}
          >
            <ComboSlipBody onAfterSubmit={closeCombo} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 11,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  quickToggle: {
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 11,
    backgroundColor: COLORS.pillDefault,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickToggleActive: {
    backgroundColor: COLORS.betclicRed,
  },
  quickToggleText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  clearBtn: {
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 10,
    backgroundColor: COLORS.pillDefault,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  clearBtnText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
  },
  emptyCard: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  emptyDesc: {
    fontSize: 12.5,
    color: COLORS.dim,
    textAlign: "center",
    lineHeight: 18,
  },
  browseBtn: {
    marginTop: 4,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  browseBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  boostCard: {
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 2,
  },
  boostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  boostTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  boostSub: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.dim,
  },
  legsList: {
    gap: 8,
  },
  legCard: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  legMain: {
    flex: 1,
    gap: 3,
  },
  legMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  legLeague: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
    flexShrink: 1,
  },
  legLivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  legLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.betclicRed,
  },
  legLiveText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: COLORS.betclicRed,
  },
  legDate: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  legTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    flexShrink: 1,
  },
  legPick: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  legRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legOddsPill: {
    borderRadius: 9,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  legOddsText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  removeBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
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
  quoteCard: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 6,
  },
  quoteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quoteLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
  },
  quoteVal: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  quoteTotalRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 7,
    marginTop: 2,
  },
  quoteTotalLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
  },
  quoteTotalWin: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
  submitBtn: {
    height: 48,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  floatWrap: {
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: "transparent",
  },
  floatBar: {
    height: 48,
    borderRadius: 14,
    backgroundColor: COLORS.ink,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  floatLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  floatCountBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  floatCountText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  floatTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  floatSub: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255,255,255,0.72)",
    fontVariant: ["tabular-nums"],
  },
  floatRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  floatOpenText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.deep,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 20,
    maxHeight: "92%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.edge,
    marginBottom: 10,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
  },
  sheetCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  sheetCountText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
});
