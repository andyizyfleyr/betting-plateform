import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Layers, Share2, Sparkles } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  CASHOUT_CHANGED_CODE,
  generateIdempotencyKey,
  type BetStatus,
  type ClientBet,
} from "@/lib/api";
import { eur, formatOdds, formatPlacedAt } from "@/lib/format";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";
import { SlideToCashOut } from "./slide-to-cashout";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";

export function BetStatusBadge({ status }: { status: BetStatus }) {
  if (status === "won") {
    return (
      <View style={[styles.badge, styles.badgeWon]}>
        <Text style={[styles.badgeText, { color: COLORS.win }]}>Gagné</Text>
      </View>
    );
  }
  if (status === "lost") {
    // Perdu en ROUGE (contrainte explicite)
    return (
      <View style={[styles.badge, styles.badgeLost]}>
        <Text style={[styles.badgeText, { color: COLORS.betclicRed }]}>
          Perdu
        </Text>
      </View>
    );
  }
  if (status === "cashed") {
    return (
      <View style={[styles.badge, styles.badgeCashed]}>
        <Text style={[styles.badgeText, { color: "#059669" }]}>Vendu</Text>
      </View>
    );
  }
  if (status === "void") {
    return (
      <View style={[styles.badge, styles.badgeVoid]}>
        <Text style={[styles.badgeText, { color: COLORS.mist }]}>
          Remboursé
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgePending]}>
      <Text style={[styles.badgeText, { color: COLORS.ink }]}>En cours</Text>
    </View>
  );
}

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
    bumpBets,
    openShareTicket,
    toast,
  } = useApp();

  const [cashingOut, setCashingOut] = useState(false);
  const [liveCashoutOffer, setLiveCashoutOffer] = useState<number | null>(null);

  const cashOutOffer = liveCashoutOffer ?? bet.cashOut;
  const canCashOut =
    bet.status === "pending" &&
    typeof cashOutOffer === "number" &&
    cashOutOffer > 0;

  const isCombo = bet.kind === "combo";
  const isPrediction = bet.kind === "prediction";
  const detailHref = isCombo
    ? `/paris/combine/${bet.id}`
    : `/paris/simple/${bet.id}`;

  const handleCashOut = async () => {
    if (!canCashOut || cashOutOffer === null || cashingOut) return;
    setCashingOut(true);
    try {
      const res = await api.cashOut({
        betId: bet.id,
        kind: bet.kind,
        expectedCashout: Math.round(cashOutOffer * 100) / 100,
        idempotencyKey: generateIdempotencyKey("co"),
      });
      setBalance(res.balance);
      bumpBets();
      onCashedOut?.();
      toast({
        kind: "win",
        title: `Cash Out validé : +${eur(res.value)}`,
        description: "Montant crédité immédiatement sur votre solde.",
      });
    } catch (err) {
      if (err instanceof ApiHttpError && err.code === CASHOUT_CHANGED_CODE) {
        const nextOffer =
          err.cashoutDetails?.currentCashout ?? err.currentCashOut ?? null;
        if (typeof nextOffer === "number" && nextOffer > 0) {
          setLiveCashoutOffer(nextOffer);
          toast({
            kind: "info",
            title: "Offre Cash Out actualisée",
            description: `Nouveau montant disponible : ${eur(nextOffer)}. Glissez à nouveau pour confirmer.`,
          });
        }
      } else {
        toast({
          kind: "error",
          title: "Cash Out indisponible",
          description:
            err instanceof ApiHttpError
              ? err.message
              : "Action momentanément suspendue.",
        });
      }
    } finally {
      setCashingOut(false);
    }
  };

  const firstComboLeg = isCombo ? bet.legs?.[0] : null;
  const extraComboCount = isCombo
    ? Math.max(0, (bet.legs?.length ?? 0) - 1)
    : 0;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => router.push(detailHref)}
        style={styles.cardPress}
      >
        {/* Ligne supérieure : Type / Ligue (sans texte « n sélections » à côté de Combiné) + Statut */}
        <View style={styles.headRow}>
          <View style={styles.headLeft}>
            {isCombo ? (
              <View style={styles.comboTag}>
                <Layers size={11.5} color={COLORS.betclicRed} strokeWidth={2.5} />
                <Text style={styles.comboTagText}>Combiné</Text>
              </View>
            ) : isPrediction ? (
              <View style={styles.predTag}>
                <Sparkles size={11.5} color={COLORS.betclicRed} strokeWidth={2.3} />
                <Text numberOfLines={1} style={styles.leagueText}>
                  {bet.league || "Prédiction"}
                </Text>
              </View>
            ) : (
              <View style={styles.sportTag}>
                <SportIcon sport={bet.sport} size={13} color={COLORS.dim} />
                <Text numberOfLines={1} style={styles.leagueText}>
                  {bet.league}
                </Text>
              </View>
            )}
            <Text style={styles.dot}>·</Text>
            <Text numberOfLines={1} style={styles.placedAt}>
              {formatPlacedAt(bet.placedAt)}
            </Text>
          </View>

          <View style={styles.headRight}>
            <BetStatusBadge status={bet.status} />
            <Pressable
              hitSlop={8}
              onPress={() => openShareTicket(bet)}
              style={styles.shareIconBtn}
            >
              <Share2 size={13.5} color={COLORS.dim} strokeWidth={2.2} />
            </Pressable>
            <ChevronRight size={15} color={COLORS.dim} strokeWidth={2.2} />
          </View>
        </View>

        {/* Corps compact uniforme (Simple & Combiné alignés) */}
        {isCombo ? (
          <View style={styles.bodyBlock}>
            <Text numberOfLines={1} style={styles.eventTitle}>
              {firstComboLeg?.title ?? "Ticket combiné"}
              {extraComboCount > 0 ? ` + ${extraComboCount}` : ""}
            </Text>
            <Text numberOfLines={1} style={styles.selectionLine}>
              {firstComboLeg?.selectionLabel ?? bet.selectionLabel}
              {bet.boostPct && bet.boostPct > 0
                ? ` · Boost +${bet.boostPct} %`
                : ""}
            </Text>
          </View>
        ) : isPrediction ? (
          <View style={styles.bodyBlock}>
            <Text numberOfLines={2} style={styles.eventTitle}>
              {bet.question || bet.homeTeam}
            </Text>
            <Text numberOfLines={1} style={styles.selectionLine}>
              Choix : {bet.selectionLabel}
            </Text>
          </View>
        ) : (
          <View style={styles.bodyBlock}>
            <View style={styles.matchRow}>
              <View style={styles.teamsInline}>
                <TeamAvatar
                  name={bet.homeTeam}
                  logo={bet.homeLogo}
                  size="2xs"
                />
                <Text numberOfLines={1} style={styles.eventTitle}>
                  {bet.homeTeam} – {bet.awayTeam}
                </Text>
                <TeamAvatar
                  name={bet.awayTeam}
                  logo={bet.awayLogo}
                  size="2xs"
                />
              </View>
              {bet.matchHomeScore !== null && bet.matchAwayScore !== null ? (
                <View style={styles.liveScorePill}>
                  {bet.matchStatus === "live" ? (
                    <View style={styles.liveDot} />
                  ) : null}
                  <Text style={styles.liveScoreText}>
                    {bet.matchHomeScore} - {bet.matchAwayScore}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text numberOfLines={1} style={styles.selectionLine}>
              {bet.selectionLabel}
            </Text>
          </View>
        )}

        {/* Pied en ligne : petits libellés discrets + grandes valeurs grasses (« Mise : N », « Cote : N », « Gain max : N ») */}
        <View style={styles.amountsRow}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Mise : </Text>
            <Text style={styles.amountVal}>{eur(bet.stake)}</Text>
          </View>

          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Cote : </Text>
            <Text style={styles.amountVal}>
              {formatOdds(bet.odds, oddsFormat)}
            </Text>
          </View>

          <View style={[styles.amountItem, { justifyContent: "flex-end" }]}>
            <Text style={styles.amountLabel}>
              {bet.status === "cashed"
                ? "Vendu : "
                : bet.status === "won"
                  ? "Gain : "
                  : "Gain max : "}
            </Text>
            <Text
              style={[
                styles.amountVal,
                bet.status === "won" && { color: COLORS.win },
                bet.status === "cashed" && { color: "#059669" },
                bet.status === "lost" && { color: COLORS.dim },
              ]}
            >
              {eur(
                bet.status === "cashed" && bet.cashOutAmount !== null
                  ? bet.cashOutAmount
                  : bet.potentialWin
              )}
            </Text>
          </View>
        </View>
      </Pressable>

      {canCashOut && cashOutOffer !== null ? (
        <View style={styles.cashoutWrap}>
          <SlideToCashOut
            amount={cashOutOffer}
            loading={cashingOut}
            onConfirm={handleCashOut}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 13,
    gap: 10,
  },
  cardPress: {
    gap: 9,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  comboTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 6,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
  },
  comboTagText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.betclicRed,
  },
  predTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  sportTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  leagueText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
    flexShrink: 1,
  },
  dot: {
    fontSize: 11,
    color: COLORS.dim,
  },
  placedAt: {
    fontSize: 11,
    color: COLORS.dim,
    flexShrink: 0,
  },
  headRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  shareIconBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  badgePending: {
    backgroundColor: COLORS.elev,
  },
  badgeWon: {
    backgroundColor: COLORS.winSoft,
  },
  badgeLost: {
    backgroundColor: "rgba(225, 0, 20, 0.10)",
  },
  badgeCashed: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  badgeVoid: {
    backgroundColor: COLORS.elev,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: "800",
  },
  bodyBlock: {
    gap: 3,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamsInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    flexShrink: 1,
  },
  liveScorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.betclicRed,
  },
  liveScoreText: {
    fontSize: 11.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  selectionLine: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  amountsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 8,
    gap: 6,
  },
  amountItem: {
    flexDirection: "row",
    alignItems: "baseline",
    flexShrink: 1,
  },
  amountLabel: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.dim,
  },
  amountVal: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  cashoutWrap: {
    marginTop: 2,
  },
});
