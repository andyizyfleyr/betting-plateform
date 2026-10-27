import React from "react";
import { Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Share2, X } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { eur, formatFullDateTime, formatOdds } from "@/lib/format";
import { COLORS } from "@/theme/tokens";
import { BetStatusBadge } from "./bet-ticket";
import { PulseMark } from "./pulse-logo";

import type { ClientBet } from "@/lib/api";

export function ShareTicketModal({
  bet: betProp,
  onClose,
}: {
  bet?: ClientBet | null;
  onClose?: () => void;
} = {}) {
  const { shareTicketBet, closeShareTicket, oddsFormat } = useApp();
  const activeBet = betProp !== undefined ? betProp : shareTicketBet;
  const handleClose = onClose ?? closeShareTicket;
  if (!activeBet) return null;

  const bet = activeBet;
  const title =
    bet.kind === "combo"
      ? `Combiné PULSE (${bet.legs?.length ?? 2} sélections)`
      : bet.kind === "prediction"
        ? bet.question || bet.homeTeam
        : `${bet.homeTeam} – ${bet.awayTeam}`;

  const handleNativeShare = async () => {
    try {
      await Share.share({
        message: `Ticket PULSE #${bet.id}\n${title}\n${bet.selectionLabel} @ ${formatOdds(bet.odds, oddsFormat)}\nMise : ${eur(bet.stake)} · Gain potentiel : ${eur(bet.potentialWin)}\nhttps://be-plateform.vercel.app`,
      });
    } catch {
      /* annulé */
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
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

          <Pressable onPress={handleNativeShare} style={styles.shareBtn}>
            <Share2 size={16} color="#ffffff" strokeWidth={2.4} />
            <Text style={styles.shareBtnText}>Partager le ticket</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    padding: 16,
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
    fontSize: 13,
    fontWeight: "800",
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
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  pick: {
    fontSize: 13,
    fontWeight: "700",
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
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  metricVal: {
    fontSize: 14.5,
    fontWeight: "800",
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
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
  },
});
