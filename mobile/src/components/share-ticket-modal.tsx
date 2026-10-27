import React from "react";
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { Copy, Share2, X, Zap } from "lucide-react-native";
import { eur, formatOdds } from "@/lib/format";
import { colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Modale « Flex » de partage de ticket (`ShareTicketModal`) avec partage Android natif (`Share.share`).
 */
export function ShareTicketModal() {
  const { shareTicketBet, closeShareTicket, oddsFormat, toast } = useApp();

  if (!shareTicketBet) return null;

  const title =
    shareTicketBet.kind === "combo"
      ? `Combiné (${shareTicketBet.legs?.length ?? 2})`
      : shareTicketBet.kind === "prediction"
        ? (shareTicketBet.question ?? "Prédiction")
        : `${shareTicketBet.homeTeam} – ${shareTicketBet.awayTeam}`;

  const shareText = `⚡ PULSE · ${title}\nSélection : ${shareTicketBet.selectionLabel}\nCote : ×${formatOdds(shareTicketBet.odds, oddsFormat)} · Mise : ${eur(shareTicketBet.stake)}\n${shareTicketBet.status === "won" ? `Gain remporté : ${eur(shareTicketBet.potentialWin)}` : `Gain potentiel : ${eur(shareTicketBet.potentialWin)}`}\nhttps://be-plateform.vercel.app`;

  return (
    <Modal
      visible={Boolean(shareTicketBet)}
      transparent
      animationType="fade"
      onRequestClose={closeShareTicket}
    >
      <Pressable style={styles.backdrop} onPress={closeShareTicket}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <LinearGradient
            colors={["#111827", "#1f2937", "#be0011"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.flexCard}
          >
            <View style={styles.flexTop}>
              <View style={styles.brandRow}>
                <View style={styles.logoDot}>
                  <Zap size={13} color={colors.white} fill={colors.white} />
                </View>
                <Text style={styles.brandText}>PULSE TICKET</Text>
              </View>
              <Pressable onPress={closeShareTicket} style={styles.closeIcon}>
                <X size={16} color={colors.white} />
              </Pressable>
            </View>

            <Text style={styles.eventTitle}>{title}</Text>
            <Text style={styles.selText}>{shareTicketBet.selectionLabel}</Text>

            <View style={styles.metricsRow}>
              <View>
                <Text style={styles.metricLabel}>Cote</Text>
                <Text style={styles.metricVal}>
                  ×{formatOdds(shareTicketBet.odds, oddsFormat)}
                </Text>
              </View>
              <View>
                <Text style={styles.metricLabel}>Mise</Text>
                <Text style={styles.metricVal}>{eur(shareTicketBet.stake)}</Text>
              </View>
              <View>
                <Text style={styles.metricLabel}>
                  {shareTicketBet.status === "won" ? "Gain" : "Gain max"}
                </Text>
                <Text style={[styles.metricVal, { color: "#6ee7b7" }]}>
                  {eur(shareTicketBet.potentialWin)}
                </Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.actionsRow}>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(shareText);
                toast({ kind: "success", title: "Ticket copié dans le presse-papiers" });
              }}
              style={styles.copyBtn}
            >
              <Copy size={15} color={colors.ink} strokeWidth={2.3} />
              <Text style={styles.copyText}>Copier</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                try {
                  await Share.share({ message: shareText });
                } catch {
                  // Annulé par l'utilisateur
                }
              }}
              style={styles.shareBtn}
            >
              <Share2 size={15} color={colors.white} strokeWidth={2.3} />
              <Text style={styles.shareText}>Partager sur Android</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.58)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  dialog: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: 14,
    gap: 12,
  },
  flexCard: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  flexTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logoDot: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: {
    fontSize: 11.5,
    fontWeight: "900",
    letterSpacing: 0.7,
    color: colors.white,
  },
  closeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.white,
  },
  selText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fca5a5",
  },
  metricsRow: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.16)",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metricLabel: {
    fontSize: 10.5,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "600",
  },
  metricVal: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: "900",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  copyBtn: {
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.elev,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  copyText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
  },
  shareBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  shareText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.white,
  },
});
