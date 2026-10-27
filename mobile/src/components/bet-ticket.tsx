import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "@/lib/router";
import { ChevronRight, Share2 } from "@/components/icons";
import { api, ApiHttpError, type ClientBet } from "@/lib/api";
import { eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";
import { SportIcon } from "./sport-icon";
import { SlideToCashOut } from "./slide-to-cashout";

function StatusBadge({ bet }: { bet: ClientBet }) {
  if (bet.status === "won") {
    return (
      <View style={[styles.badge, styles.badgeWon]}>
        <Text style={[styles.badgeText, styles.badgeTextWon]}>Gagné</Text>
      </View>
    );
  }
  if (bet.status === "lost") {
    // Règle stricte utilisateur : le statut « Perdu » doit être ROUGE
    return (
      <View style={[styles.badge, styles.badgeLost]}>
        <Text style={[styles.badgeText, styles.badgeTextLost]}>Perdu</Text>
      </View>
    );
  }
  if (bet.status === "cashed_out") {
    return (
      <View style={[styles.badge, styles.badgeCashout]}>
        <Text style={[styles.badgeText, styles.badgeTextCashout]}>Vendu</Text>
      </View>
    );
  }
  if (bet.status === "void") {
    return (
      <View style={[styles.badge, styles.badgeVoid]}>
        <Text style={[styles.badgeText, styles.badgeTextVoid]}>Remboursé</Text>
      </View>
    );
  }
  if (bet.matchStatus === "live") {
    return (
      <View style={[styles.badge, styles.badgeLive]}>
        <View style={styles.liveDot} />
        <Text style={[styles.badgeText, styles.badgeTextLost]}>
          {bet.matchMinute ?? "EN DIRECT"}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgePending]}>
      <Text style={[styles.badgeText, styles.badgeTextPending]}>En cours</Text>
    </View>
  );
}

/**
 * Carte ticket unifiée (`BetTicket`) fidèle à `src/components/bet-ticket.tsx` :
 * - Clic sur un pari simple -> `/paris/simple/[id]`
 * - Clic sur un pari combiné -> `/paris/combine/[id]` (intitulé sobre « Combiné » sans « n sélections »)
 * - Statut `Perdu` en rouge
 * - Montants en bas en ligne (`Mise : N`, `Cote : ×N`, `Gain max / Gain : N`) avec libellés discrets et chiffres gras
 * - `SlideToCashOut` vert créatif émeraude.
 */
export function BetTicket({
  bet,
  onCashedOut,
}: {
  bet: ClientBet;
  onCashedOut?: () => void;
}) {
  const router = useRouter();
  const {
    oddsFormat,
    setBalance,
    refreshPulseNow,
    openShareTicket,
    hapticsEnabled,
    toast,
  } = useApp();
  const [cashingOut, setCashingOut] = useState(false);

  const isCombo = bet.kind === "combo";
  const isPrediction = bet.kind === "prediction";
  const href = isCombo ? `/paris/combine/${bet.id}` : `/paris/simple/${bet.id}`;

  const topTitle = isCombo
    ? "Combiné"
    : isPrediction
      ? bet.league || "Prédiction"
      : bet.league;

  const mainTitle = isCombo
    ? (bet.legs ?? [])
        .slice(0, 2)
        .map((l) => l.title)
        .join(" • ") +
      ((bet.legs?.length ?? 0) > 2 ? ` +${(bet.legs?.length ?? 0) - 2}` : "")
    : isPrediction
      ? (bet.question ?? "Prédiction")
      : `${bet.homeTeam} – ${bet.awayTeam}`;

  const handleCashOut = async () => {
    if (!bet.cashOut || cashingOut) return;
    setCashingOut(true);
    try {
      const res = await api.cashOut(bet.id, bet.kind, bet.cashOut);
      setBalance(res.balance);
      void refreshPulseNow();
      toast({
        kind: "win",
        title: `Ticket vendu · +${eur(res.cashOutAmount)}`,
        subtitle: "Montant crédité immédiatement sur votre solde",
      });
      onCashedOut?.();
    } catch (err) {
      if (err instanceof ApiHttpError && err.code === "CASHOUT_CHANGED") {
        toast({
          kind: "info",
          title: "Montant Cash Out actualisé",
          subtitle:
            typeof err.currentCashOut === "number"
              ? `Nouvelle offre : ${eur(err.currentCashOut)}`
              : err.message,
        });
        onCashedOut?.();
      } else {
        toast({
          kind: "error",
          title: "Cash Out indisponible",
          subtitle: err instanceof Error ? err.message : "Réessayez dans un instant",
        });
      }
    } finally {
      setCashingOut(false);
    }
  };

  const finalAmountLabel =
    bet.status === "won"
      ? "Gain :"
      : bet.status === "cashed_out"
        ? "Encaissé :"
        : bet.status === "void"
          ? "Remboursé :"
          : "Gain max :";

  const finalAmountValue =
    bet.status === "cashed_out"
      ? (bet.cashOutAmount ?? bet.stake)
      : bet.status === "void"
        ? bet.stake
        : bet.potentialWin;

  return (
    <Pressable
      onPress={() => {
        triggerHaptic("light", hapticsEnabled);
        router.push(href);
      }}
      style={[
        bet.status === "won" ? cardSurface.ticketWon : cardSurface.glassCard,
        styles.card,
      ]}
    >
      {/* Ligne 1 : Catégorie + Statut */}
      <View style={styles.topRow}>
        <View style={styles.catLeft}>
          <SportIcon sport={bet.sport} size={13.5} color={colors.dim} />
          <Text numberOfLines={1} style={styles.catText}>
            {topTitle}
          </Text>
          <Text style={styles.dotSep}>·</Text>
          <Text style={styles.dateText}>
            {bet.status === "pending" && bet.matchStartsAt
              ? formatKickoff(bet.matchStartsAt)
              : formatPlacedAt(bet.settledAt ?? bet.placedAt)}
          </Text>
        </View>

        <View style={styles.topRight}>
          <StatusBadge bet={bet} />
          <ChevronRight size={14} color={colors.dim} strokeWidth={2.4} />
        </View>
      </View>

      {/* Ligne 2 : Intitulé principal + Sélection */}
      <View style={styles.midBlock}>
        <View style={styles.titleScoreRow}>
          <Text numberOfLines={1} style={styles.mainTitle}>
            {mainTitle}
          </Text>
          {!isCombo &&
            !isPrediction &&
            typeof bet.matchHomeScore === "number" &&
            typeof bet.matchAwayScore === "number" && (
              <Text style={styles.liveScore}>
                {bet.matchHomeScore} - {bet.matchAwayScore}
              </Text>
            )}
        </View>
        <Text numberOfLines={1} style={styles.selectionLine}>
          {bet.selectionLabel}
        </Text>
      </View>

      {/* Ligne 3 : Montants en ligne (petits libellés discrets + chiffres gras) + Flex */}
      <View style={styles.amountsRow}>
        <View style={styles.amountsInline}>
          <View style={styles.metricInline}>
            <Text style={styles.metricLabel}>Mise :</Text>
            <Text style={styles.metricVal}>{eur(bet.stake)}</Text>
          </View>
          <View style={styles.metricInline}>
            <Text style={styles.metricLabel}>Cote :</Text>
            <Text style={styles.metricVal}>
              ×{formatOdds(bet.odds, oddsFormat)}
            </Text>
          </View>
          <View style={styles.metricInline}>
            <Text style={styles.metricLabel}>{finalAmountLabel}</Text>
            <Text
              style={[
                styles.metricVal,
                bet.status === "won" && { color: colors.win },
                bet.status === "lost" && { color: colors.bittersweet },
              ]}
            >
              {bet.status === "lost" ? eur(0) : eur(finalAmountValue)}
            </Text>
          </View>
        </View>

        {(bet.status === "won" || bet.status === "pending") && (
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              openShareTicket(bet);
            }}
            style={styles.shareBtn}
          >
            <Share2 size={13.5} color={colors.ink} strokeWidth={2.3} />
          </Pressable>
        )}
      </View>

      {/* Cash Out vert créatif émeraude */}
      {bet.status === "pending" && typeof bet.cashOut === "number" && bet.cashOut > 0 && (
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.cashoutWrap}>
          <SlideToCashOut
            amount={bet.cashOut}
            loading={cashingOut}
            onConfirm={handleCashOut}
          />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 13,
    gap: 9,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  catLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  catText: {
    flexShrink: 1,
    fontSize: 11.5,
    fontWeight: "800",
    color: colors.mist,
  },
  dotSep: {
    fontSize: 11,
    color: colors.dim,
  },
  dateText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.dim,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: "800",
  },
  badgeWon: {
    backgroundColor: "rgba(21, 128, 61, 0.14)",
  },
  badgeTextWon: {
    color: colors.win,
  },
  badgeLost: {
    backgroundColor: "rgba(220, 38, 38, 0.13)",
  },
  badgeTextLost: {
    color: colors.bittersweet,
  },
  badgeCashout: {
    backgroundColor: "rgba(5, 150, 105, 0.14)",
  },
  badgeTextCashout: {
    color: "#047857",
  },
  badgeVoid: {
    backgroundColor: colors.elev,
  },
  badgeTextVoid: {
    color: colors.mist,
  },
  badgeLive: {
    backgroundColor: "rgba(225, 0, 20, 0.12)",
  },
  liveDot: {
    width: 5.5,
    height: 5.5,
    borderRadius: 3,
    backgroundColor: colors.betclicRed,
  },
  badgePending: {
    backgroundColor: colors.elev,
  },
  badgeTextPending: {
    color: colors.ink,
  },
  midBlock: {
    gap: 2,
  },
  titleScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  mainTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: colors.ink,
  },
  liveScore: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  selectionLine: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.betclicRed,
  },
  amountsRow: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.edgeSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  amountsInline: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 12,
    rowGap: 4,
  },
  metricInline: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3.5,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.dim,
  },
  metricVal: {
    fontSize: 13.5,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  shareBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  cashoutWrap: {
    marginTop: 2,
  },
});
