import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Flame, QrCode, Ticket, Trash2, X } from "lucide-react-native";
import { api, ApiHttpError, generateIdempotencyKey } from "@/lib/api";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  nextComboBoostTier,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { eur, formatKickoff, formatOdds } from "@/lib/format";
import { TouchStakePad } from "@/components/touch-stake-pad";
import { OddsLockControls } from "@/components/odds-lock-controls";
import { CouponCodeBox } from "@/components/coupon-code-box";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page dédiée `/betslip` fidèle à `src/app/(main)/betslip/page.tsx` :
 * - En-tête `Coupon de pari` + compteur `N/8` + `Code coupon` + `Vider`
 * - Jauge `Bonus Combiné` uniquement lorsque `>= 2` sélections
 * - Cartes de sélections épurées (sans étiquettes `Réel`/`Virtuel`)
 * - Validation simple (1 sélection) ou combinée (2 à 8 sélections) avec idempotence & `409 ODDS_CHANGED`.
 */
export default function BetslipScreen() {
  const router = useRouter();
  const {
    user,
    balance,
    setBalance,
    comboLegs,
    feedMatches,
    removeComboLeg,
    clearCombo,
    oddsFormat,
    oddsPolicy,
    setOddsPolicy,
    stakePresets,
    openRecharge,
    refreshPulseNow,
    hapticsEnabled,
    toast,
  } = useApp();

  const [stake, setStake] = useState<number>(stakePresets[1] ?? 10);
  const [couponBoxOpen, setCouponBoxOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState<string>(() =>
    generateIdempotencyKey("slip")
  );

  // Actualise les cotes 1X2 live depuis le flux match en mémoire
  const enrichedLegs = useMemo(() => {
    const map = new Map((feedMatches ?? []).map((m) => [m.id, m]));
    const mapped = comboLegs.map((l) => {
      if (l.kind === "sport" && l.matchId) {
        const m = map.get(l.matchId);
        if (m) {
          let liveOdds = l.odds;
          if (l.market === "result") {
            if (l.selection === "home") liveOdds = m.oddsHome;
            else if (l.selection === "draw" && m.oddsDraw) liveOdds = m.oddsDraw;
            else if (l.selection === "away") liveOdds = m.oddsAway;
          } else {
            const grp = m.markets.find((g) => g.key === l.market);
            const out = grp?.outcomes.find((o) => o.key === l.selection);
            if (out) liveOdds = out.odds;
          }
          return {
            ...l,
            odds: liveOdds,
            isLive: m.status === "live",
            closed: m.status === "finished" || Boolean(m.suspended),
            startsAt: m.startsAt,
          };
        }
      }
      return { ...l, closed: false };
    });
    return sortSlipSelectionsChronologically(mapped);
  }, [comboLegs, feedMatches]);

  const isSingle = enrichedLegs.length === 1;
  const quote = useMemo(
    () => computeComboQuote(enrichedLegs.map((l) => l.odds), stake),
    [enrichedLegs, stake]
  );
  const nextTier = useMemo(
    () => nextComboBoostTier(quote.eligibleLegs),
    [quote.eligibleLegs]
  );

  const hasClosedLeg = enrichedLegs.some((l) => l.closed);
  const insufficient = Boolean(user) && stake > balance;

  const handleSubmit = async () => {
    if (enrichedLegs.length === 0 || submitting) return;
    if (!user) {
      router.push("/auth");
      return;
    }
    if (insufficient) {
      openRecharge();
      return;
    }
    if (hasClosedLeg) {
      toast({
        kind: "error",
        title: "Sélection suspendue ou terminée",
        subtitle: "Retirez la sélection clôturée pour valider votre coupon.",
      });
      return;
    }

    setSubmitting(true);
    try {
      if (isSingle) {
        const leg = enrichedLegs[0];
        if (leg.kind === "sport" && leg.matchId) {
          const res = await api.placeBet({
            matchId: leg.matchId,
            market: leg.market,
            selection: leg.selection,
            selectionLabel: leg.selectionLabel,
            odds: leg.odds,
            expectedOdds: leg.odds,
            oddsPolicy,
            stake,
            idempotencyKey: idemKey,
          });
          setBalance(res.balance);
        } else if (leg.kind === "prediction" && leg.questionId) {
          const res = await api.placePredictionBet({
            questionId: leg.questionId,
            selection: leg.selection,
            stake,
            expectedOdds: leg.odds,
            oddsPolicy,
            idempotencyKey: idemKey,
          });
          setBalance(res.balance);
        }
      } else {
        const res = await api.placeComboBet({
          legs: enrichedLegs.map((l) => ({
            kind: l.kind,
            matchId: l.matchId,
            questionId: l.questionId,
            market: l.market,
            selection: l.selection,
            selectionLabel: l.selectionLabel,
            odds: l.odds,
            expectedOdds: l.odds,
          })),
          stake,
          oddsPolicy,
          idempotencyKey: idemKey,
        });
        setBalance(res.balance);
      }

      clearCombo();
      setIdemKey(generateIdempotencyKey("slip"));
      void refreshPulseNow();
      toast({
        kind: "win",
        title: isSingle ? "Pari validé !" : "Combiné validé !",
        subtitle: `Gain potentiel ${eur(quote.potentialWin)}`,
      });
      router.push("/paris");
    } catch (err) {
      setIdemKey(generateIdempotencyKey("slip"));
      if (err instanceof ApiHttpError && err.code === "ODDS_CHANGED") {
        toast({
          kind: "info",
          title: "Cotes mises à jour",
          subtitle: "Vérifiez la nouvelle cote totale puis validez.",
        });
      } else {
        toast({
          kind: "error",
          title: "Validation refusée",
          subtitle: err instanceof Error ? err.message : "Réessayez",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* En-tête */}
      <View style={styles.topHeader}>
        <View style={styles.titleRow}>
          <Text style={styles.pageTitle}>Coupon de pari</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {enrichedLegs.length}/{MAX_COMBO_LEGS}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRight}>
          <Pressable
            onPress={() => {
              triggerHaptic("light", hapticsEnabled);
              setCouponBoxOpen((v) => !v);
            }}
            style={styles.codeBtn}
          >
            <QrCode size={14} color={colors.ink} strokeWidth={2.3} />
            <Text style={styles.codeBtnText}>Code coupon</Text>
          </Pressable>

          {enrichedLegs.length > 0 && (
            <Pressable
              onPress={() => {
                triggerHaptic("light", hapticsEnabled);
                clearCombo();
              }}
              style={styles.clearBtn}
            >
              <Trash2 size={15} color={colors.betclicRed} strokeWidth={2.3} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {(couponBoxOpen || enrichedLegs.length === 0) && (
          <CouponCodeBox defaultStake={stake} onLoadedStake={setStake} />
        )}

        {/* Jauge Bonus Combiné uniquement si >= 2 sélections */}
        {enrichedLegs.length >= 2 && (
          <View style={[cardSurface.glassCard, styles.boostCard]}>
            <View style={styles.boostRow}>
              <Flame size={15} color={colors.betclicRed} strokeWidth={2.4} />
              <Text style={styles.boostTitle}>
                {quote.boostPct > 0
                  ? `Bonus Combiné +${quote.boostPct}% activé (+${eur(quote.boostAmount)})`
                  : "Bonus Combiné jusqu'à +20%"}
              </Text>
            </View>
            {nextTier && (
              <Text style={styles.boostSub}>
                +{nextTier.needed} sélection{nextTier.needed > 1 ? "s" : ""} (cote ≥
                1,35) pour débloquer +{nextTier.pct}%
              </Text>
            )}
          </View>
        )}

        {enrichedLegs.length === 0 ? (
          <View style={[cardSurface.glassCard, styles.emptyCard]}>
            <Ticket size={28} color={colors.dim} strokeWidth={2} />
            <Text style={styles.emptyTitle}>Votre Betslip est vide</Text>
            <Text style={styles.emptySub}>
              Maintenez appuyé sur n&apos;importe quelle cote de match ou de
              prédiction pour composer votre pari simple ou combiné.
            </Text>
            <Pressable
              onPress={() => router.push("/matchs")}
              style={styles.browseBtn}
            >
              <Text style={styles.browseBtnText}>Explorer les matchs</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {enrichedLegs.map((leg) => (
              <View
                key={leg.uid}
                style={[
                  cardSurface.glassCard,
                  styles.legCard,
                  leg.closed && { opacity: 0.6 },
                ]}
              >
                <View style={styles.legHeader}>
                  <Text numberOfLines={1} style={styles.legLeague}>
                    {leg.league}
                    {leg.startsAt
                      ? ` · ${leg.isLive ? "EN DIRECT" : formatKickoff(leg.startsAt)}`
                      : ""}
                  </Text>
                  <Pressable
                    hitSlop={8}
                    onPress={() => removeComboLeg(leg.uid)}
                    style={styles.removeBtn}
                  >
                    <X size={14} color={colors.dim} strokeWidth={2.5} />
                  </Pressable>
                </View>

                <Text numberOfLines={1} style={styles.legTitle}>
                  {leg.title}
                </Text>

                <View style={styles.legBottom}>
                  <Text numberOfLines={1} style={styles.legSelection}>
                    {leg.selectionLabel}
                  </Text>
                  <View style={styles.legOddsPill}>
                    <Text style={styles.legOddsText}>
                      {leg.closed
                        ? "Fermé"
                        : formatOdds(leg.odds, oddsFormat)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Panneau de validation sticky en bas */}
      {enrichedLegs.length > 0 && (
        <View style={styles.bottomDock}>
          <TouchStakePad
            stake={stake}
            onChangeStake={setStake}
            maxBalance={balance}
            presets={stakePresets}
          />

          <OddsLockControls value={oddsPolicy} onChange={setOddsPolicy} />

          <View style={styles.summaryLine}>
            <View style={styles.inlineMetric}>
              <Text style={styles.inlineLabel}>Cote totale :</Text>
              <Text style={styles.inlineVal}>
                ×{formatOdds(quote.totalOdds, oddsFormat)}
              </Text>
            </View>
            <View style={styles.inlineMetric}>
              <Text style={styles.inlineLabel}>Gain max :</Text>
              <Text style={[styles.inlineVal, { color: colors.win }]}>
                {eur(quote.potentialWin)}
              </Text>
            </View>
          </View>

          <Pressable
            disabled={submitting || stake < 0.5 || hasClosedLeg}
            onPress={() => void handleSubmit()}
            style={[
              styles.validateBtn,
              (submitting || stake < 0.5 || hasClosedLeg) && { opacity: 0.55 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.validateBtnText}>
                {!user
                  ? "Se connecter pour valider"
                  : insufficient
                    ? "Recharger mon solde"
                    : isSingle
                      ? `Valider le pari · ${eur(stake)}`
                      : `Valider le combiné (${enrichedLegs.length}) · ${eur(stake)}`}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pageTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: colors.ink,
    letterSpacing: -0.3,
  },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    backgroundColor: colors.ink,
  },
  countPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  actionsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  codeBtn: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
  },
  codeBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink,
  },
  clearBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  boostCard: {
    padding: 12,
    gap: 4,
  },
  boostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  boostTitle: {
    fontSize: 12.5,
    fontWeight: "900",
    color: colors.ink,
  },
  boostSub: {
    fontSize: 11.5,
    fontWeight: "600",
    color: colors.mist,
  },
  emptyCard: {
    padding: 22,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.ink,
  },
  emptySub: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.mist,
    textAlign: "center",
  },
  browseBtn: {
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.betclicRed,
  },
  browseBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.white,
  },
  legCard: {
    padding: 12,
    gap: 5,
  },
  legHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legLeague: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: colors.dim,
  },
  removeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  legTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.ink,
  },
  legBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legSelection: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.betclicRed,
  },
  legOddsPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.elev,
  },
  legOddsText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  bottomDock: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.edge,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 9,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inlineMetric: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  inlineLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    color: colors.dim,
  },
  inlineVal: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  validateBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  validateBtnText: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.white,
  },
});
