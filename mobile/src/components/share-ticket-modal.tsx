import React, { useEffect, useState } from "react";
import { Clipboard, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Check, Copy, Share2, X } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, type ClientBet, type ClientSavedCouponLeg } from "@/lib/api";
import { eur, formatFullDateTime, formatOdds } from "@/lib/format";
import { COLORS, triggerHaptic } from "@/theme/tokens";
import { BetStatusBadge } from "./bet-ticket";
import { PulseMark } from "./pulse-logo";

export function ShareTicketModal({
  bet: betProp,
  onClose,
}: {
  bet?: ClientBet | null;
  onClose?: () => void;
} = {}) {
  const { shareTicketBet, closeShareTicket, oddsFormat, user } = useApp();
  const activeBet = betProp !== undefined ? betProp : shareTicketBet;
  const handleClose = onClose ?? closeShareTicket;
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponSaving, setCouponSaving] = useState(false);
  const [couponCopied, setCouponCopied] = useState(false);

  useEffect(() => {
    setCouponCode(null);
    setCouponCopied(false);
  }, [activeBet?.id]);

  if (!activeBet) return null;

  const bet = activeBet;
  const title =
    bet.kind === "combo"
      ? `Combiné PULSE (${bet.legs?.length ?? 2} sélections)`
      : bet.kind === "prediction"
        ? bet.question || bet.homeTeam
        : `${bet.homeTeam} – ${bet.awayTeam}`;

  const buildCouponLegs = (b: ClientBet): ClientSavedCouponLeg[] => {
    if (b.kind === "combo" && b.legs && b.legs.length > 0) {
      return b.legs
        .filter((l) => (l.kind === "sport" ? l.matchId : l.questionId))
        .map((l, i) => ({
          uid: `share-${b.id}-${i}`,
          kind: l.kind,
          matchId: l.matchId ?? undefined,
          questionId: l.questionId ?? undefined,
          title: l.title,
          homeTeam: l.homeTeam,
          awayTeam: l.awayTeam,
          league: l.league,
          market: l.market,
          selection: l.selection,
          selectionLabel: l.selectionLabel,
          odds: l.odds,
        }));
    }
    const kind = b.kind === "prediction" ? "prediction" : "sport";
    const id = kind === "sport" ? b.matchId : b.questionId;
    if (!id) return [];
    return [
      {
        uid: `share-${b.id}`,
        kind,
        matchId: kind === "sport" ? id : undefined,
        questionId: kind === "prediction" ? id : undefined,
        title:
          b.kind === "prediction"
            ? b.question || b.homeTeam
            : `${b.homeTeam} – ${b.awayTeam}`,
        homeTeam: b.homeTeam,
        awayTeam: b.awayTeam,
        league: b.league,
        market: b.market,
        selection: b.selection,
        selectionLabel: b.selectionLabel,
        odds: b.odds,
      },
    ];
  };

  const generateCouponCode = async () => {
    if (couponSaving) return;
    const legs = buildCouponLegs(bet);
    if (legs.length === 0) return;
    setCouponSaving(true);
    try {
      const { code } = await api.saveCoupon(legs);
      setCouponCode(code);
      triggerHaptic("success", user?.haptics);
      Clipboard.setString(code);
    } catch {
      /* génération échouée : on ne bloque pas le partage */
    } finally {
      setCouponSaving(false);
    }
  };

  const copyCouponCode = async () => {
    if (!couponCode) return;
    triggerHaptic("light", user?.haptics);
    await Clipboard.setString(couponCode);
    setCouponCopied(true);
    setTimeout(() => setCouponCopied(false), 2000);
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.brand}>
              <PulseMark size={22} />
              <Text style={styles.brandText}>PULSE BET · TICKET #{bet.id}</Text>
            </View>
            <Pressable onPress={handleClose} style={styles.closeBtn}>
              <X size={16} color={COLORS.mist} strokeWidth={2.2} />
            </Pressable>
          </View>

          <View style={styles.receipt}>
            <View style={styles.receiptHead}>
              <Text style={styles.dateText}>
                {formatFullDateTime(bet.placedAt)}
              </Text>
              <BetStatusBadge status={bet.status} />
            </View>

            <Text style={styles.title}>{title}</Text>
            <Text style={styles.pick}>{bet.selectionLabel}</Text>

            <View style={styles.metrics}>
              <View>
                <Text style={styles.metricLabel}>Mise</Text>
                <Text style={styles.metricVal}>{eur(bet.stake)}</Text>
              </View>
              <View>
                <Text style={styles.metricLabel}>Cote</Text>
                <Text style={styles.metricVal}>
                  {formatOdds(bet.odds, oddsFormat)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.metricLabel}>Gain max</Text>
                <Text style={[styles.metricVal, { color: COLORS.win }]}>
                  {eur(bet.potentialWin)}
                </Text>
              </View>
            </View>
          </View>

          {couponCode ? (
            <View style={styles.couponCard}>
              <View style={styles.couponRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.couponLabel}>Code coupon partagé</Text>
                  <Text style={styles.couponCode}>{couponCode}</Text>
                </View>
                <Pressable onPress={() => void copyCouponCode()} style={styles.couponCopyBtn}>
                  {couponCopied ? (
                    <Check size={14} color="#ffffff" strokeWidth={2.6} />
                  ) : (
                    <Copy size={14} color="#ffffff" strokeWidth={2.2} />
                  )}
                  <Text style={styles.couponCopyText}>
                    {couponCopied ? "Copié" : "Copier"}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.couponHint}>
                Vos amis chargent ce code dans l'app pour jouer les mêmes matchs.
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={() => void generateCouponCode()}
              disabled={couponSaving}
              style={styles.couponBtn}
            >
              <Share2 size={15} color={COLORS.betclicRed} strokeWidth={2.3} />
              <Text style={styles.couponBtnText}>
                {couponSaving ? "Génération du code…" : "Générer le code coupon"}
              </Text>
            </Pressable>
          )}

          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  couponCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${COLORS.win}55`,
    backgroundColor: `${COLORS.win}12`,
    padding: 12,
    gap: 6,
  },
  couponRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  couponLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: COLORS.win,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  couponCode: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: 1,
    marginTop: 2,
  },
  couponCopyBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: COLORS.win,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  couponCopyText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ffffff",
  },
  couponHint: {
    fontSize: 9.5,
    color: COLORS.mist,
  },
  couponBtn: {
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  couponBtnText: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 14,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  brandIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.ink,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  receipt: {
    borderRadius: 16,
    backgroundColor: COLORS.elev,
    padding: 14,
    gap: 8,
  },
  receiptHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  pick: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  metrics: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.edge,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  metricVal: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  shareBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  shareBtnText: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "#ffffff",
  },
});
