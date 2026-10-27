import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, ChevronRight, Layers, Share2 } from "lucide-react-native";
import { BetStatusBadge } from "@/components/bet-ticket";
import { SlideToCashOut } from "@/components/slide-to-cashout";
import { SportIcon } from "@/components/sport-icon";
import { TeamAvatar } from "@/components/team-avatar";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  CASHOUT_CHANGED_CODE,
  generateIdempotencyKey,
  type ClientBet,
  type ClientComboLeg,
} from "@/lib/api";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import { getCachedBetSnapshot } from "@/lib/entity-cache";
import {
  eur,
  formatFullDateTime,
  formatMatchDateTimeShort,
  formatOdds,
} from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

function LegStatusPill({ leg }: { leg: ClientComboLeg }) {
  if (leg.status === "won") {
    return (
      <View style={[styles.legBadge, styles.legBadgeWon]}>
        <Text style={[styles.legBadgeText, { color: COLORS.win }]}>Gagné</Text>
      </View>
    );
  }
  if (leg.status === "lost") {
    return (
      <View style={[styles.legBadge, styles.legBadgeLost]}>
        <Text style={[styles.legBadgeText, { color: COLORS.betclicRed }]}>
          Perdu
        </Text>
      </View>
    );
  }
  if (leg.status === "void") {
    return (
      <View style={[styles.legBadge, styles.legBadgeIdle]}>
        <Text style={[styles.legBadgeText, { color: COLORS.dim }]}>
          Remboursé
        </Text>
      </View>
    );
  }
  if (leg.matchStatus === "live") {
    return (
      <View style={[styles.legBadge, styles.legBadgeLost]}>
        <Text style={[styles.legBadgeText, { color: COLORS.betclicRed }]}>
          {leg.matchMinute ?? "DIRECT"}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.legBadge, styles.legBadgeIdle]}>
      <Text style={[styles.legBadgeText, { color: COLORS.mist }]}>À jouer</Text>
    </View>
  );
}

export default function ComboBetDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const betId = Number(id);
  const {
    oddsFormat,
    setBalance,
    bumpBets,
    openShareTicket,
    toast,
    dataSaverMode,
  } = useApp();

  const [bet, setBet] = useState<ClientBet | null>(() =>
    Number.isFinite(betId) ? getCachedBetSnapshot("combo", betId) : null
  );
  const [loading, setLoading] = useState<boolean>(!bet);
  const [refreshing, setRefreshing] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [liveCashout, setLiveCashout] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(betId) || betId <= 0) return;
    try {
      const res = await api.allBets();
      const found =
        res.bets.find((b) => b.kind === "combo" && b.id === betId) ?? null;
      if (found) setBet(found);
    } catch {
      /* garde snapshot */
    } finally {
      setLoading(false);
    }
  }, [betId]);

  useEffect(() => {
    void load();
  }, [load]);

  useSmartPolling(load, 5_000, {
    enabled: bet?.status === "pending",
    dataSaver: dataSaverMode,
    runImmediately: false,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Contrainte stricte : sélections terminées d'abord, puis en direct, puis à venir
  const orderedLegs = useMemo(
    () => sortComboBetLegsChronologically(bet?.legs ?? []),
    [bet?.legs]
  );

  if (loading && !bet) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={COLORS.betclicRed} />
      </View>
    );
  }

  if (!bet) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Combiné introuvable</Text>
        <Pressable
          onPress={() => router.back("/paris")}
          style={styles.backFallback}
        >
          <Text style={styles.backFallbackText}>Retour à Mes paris</Text>
        </Pressable>
      </View>
    );
  }

  const cashOutOffer = liveCashout ?? bet.cashOut;
  const canCashOut =
    bet.status === "pending" &&
    typeof cashOutOffer === "number" &&
    cashOutOffer > 0;

  const handleCashOut = async () => {
    if (!canCashOut || cashOutOffer === null || cashingOut) return;
    setCashingOut(true);
    try {
      const res = await api.cashOut({
        betId: bet.id,
        kind: "combo",
        expectedCashout: Math.round(cashOutOffer * 100) / 100,
        idempotencyKey: generateIdempotencyKey("co"),
      });
      setBalance(res.balance);
      bumpBets();
      await load();
      toast({
        kind: "win",
        title: `Cash Out validé : +${eur(res.value)}`,
      });
    } catch (err) {
      if (err instanceof ApiHttpError && err.code === CASHOUT_CHANGED_CODE) {
        const next =
          err.cashoutDetails?.currentCashout ?? err.currentCashOut ?? null;
        if (typeof next === "number" && next > 0) {
          setLiveCashout(next);
          toast({
            kind: "info",
            title: "Offre Cash Out mise à jour",
            description: `Nouveau montant : ${eur(next)}`,
          });
        }
      } else {
        toast({
          kind: "error",
          title: "Cash Out indisponible",
          description:
            err instanceof ApiHttpError ? err.message : "Réessayez.",
        });
      }
    } finally {
      setCashingOut(false);
    }
  };

  const wonLegsCount = orderedLegs.filter((l) => l.status === "won").length;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.betclicRed]}
          tintColor={COLORS.betclicRed}
        />
      }
    >
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back("/paris")}
          style={styles.backBtn}
        >
          <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>
        <View style={styles.navCenter}>
          <Layers size={16} color={COLORS.betclicRed} strokeWidth={2.5} />
          <Text style={styles.navTitle}>Combiné #{bet.id}</Text>
        </View>
        <Pressable
          onPress={() => openShareTicket(bet)}
          style={styles.shareBtn}
        >
          <Share2 size={15} color={COLORS.ink} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Résumé financier du ticket combiné */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHead}>
          <Text style={styles.placedDate}>
            {formatFullDateTime(bet.placedAt)}
          </Text>
          <BetStatusBadge status={bet.status} />
        </View>

        <View style={styles.progressBarWrap}>
          <View style={styles.progressTextRow}>
            <Text style={styles.progressTitle}>Progression des sélections</Text>
            <Text style={styles.progressCount}>
              {wonLegsCount}/{orderedLegs.length} validée
              {wonLegsCount > 1 ? "s" : ""}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${
                    orderedLegs.length > 0
                      ? Math.round((wonLegsCount / orderedLegs.length) * 100)
                      : 0
                  }%`,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View>
            <Text style={styles.mLabel}>Mise</Text>
            <Text style={styles.mVal}>{eur(bet.stake)}</Text>
          </View>
          <View>
            <Text style={styles.mLabel}>
              Cote{bet.boostPct ? ` (+${bet.boostPct}%)` : ""}
            </Text>
            <Text style={styles.mVal}>
              {formatOdds(bet.odds, oddsFormat)}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.mLabel}>
              {bet.status === "cashed" ? "Vendu" : "Gain max"}
            </Text>
            <Text
              style={[
                styles.mVal,
                bet.status === "won" && { color: COLORS.win },
                bet.status === "lost" && { color: COLORS.betclicRed },
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

        {canCashOut && cashOutOffer !== null ? (
          <SlideToCashOut
            amount={cashOutOffer}
            loading={cashingOut}
            onConfirm={handleCashOut}
          />
        ) : null}
      </View>

      {/* Sélections du combiné : date & heure à côté du statut (JAMAIS dans le corps) */}
      <View style={styles.legsSection}>
        <Text style={styles.sectionTitle}>Sélections du combiné</Text>

        <View style={styles.legsStack}>
          {orderedLegs.map((leg, idx) => {
            const href =
              leg.kind === "prediction" && leg.questionId
                ? `/predictions/${leg.questionId}`
                : leg.matchId
                  ? leg.matchStatus === "finished" || leg.status !== "pending"
                    ? `/resultats?match=${leg.matchId}`
                    : `/matchs/${leg.matchId}`
                  : null;

            return (
              <Pressable
                key={idx}
                disabled={!href}
                onPress={() => {
                  if (href) router.push(href);
                }}
                style={styles.legCard}
              >
                {/* En-tête de la sélection : Ligue à gauche, Date/Heure + Statut côte à côte à droite */}
                <View style={styles.legHeader}>
                  <View style={styles.legLeagueRow}>
                    <SportIcon
                      sport={leg.sport || "football"}
                      size={13}
                      color={COLORS.dim}
                    />
                    <Text numberOfLines={1} style={styles.legLeague}>
                      {leg.league}
                    </Text>
                  </View>

                  <View style={styles.legStatusGroup}>
                    {leg.matchStartsAt ? (
                      <Text style={styles.legDateNextToStatus}>
                        {formatMatchDateTimeShort(leg.matchStartsAt)}
                      </Text>
                    ) : null}
                    <LegStatusPill leg={leg} />
                  </View>
                </View>

                {/* Corps de la sélection (sans date ni heure répétée) */}
                <View style={styles.legBodyRow}>
                  <View style={styles.legTeamsCol}>
                    <View style={styles.legTeamsInline}>
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
                  </View>

                  <View style={styles.legRightCol}>
                    {leg.matchHomeScore !== null &&
                    leg.matchHomeScore !== undefined &&
                    leg.matchAwayScore !== null &&
                    leg.matchAwayScore !== undefined ? (
                      <Text style={styles.legScore}>
                        {leg.matchHomeScore} - {leg.matchAwayScore}
                      </Text>
                    ) : null}
                    <View style={styles.legOddsPill}>
                      <Text style={styles.legOddsText}>
                        {formatOdds(leg.odds, oddsFormat)}
                      </Text>
                    </View>
                    {href ? (
                      <ChevronRight
                        size={14}
                        color={COLORS.dim}
                        strokeWidth={2.2}
                      />
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 26,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  notFound: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  backFallback: {
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  backFallbackText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  navCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 15,
    gap: 12,
  },
  summaryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  placedDate: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.dim,
  },
  progressBarWrap: {
    gap: 5,
  },
  progressTextRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
  },
  progressCount: {
    fontSize: 11.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.elev,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.win,
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 10,
  },
  mLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  mVal: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
    marginTop: 1,
  },
  legsSection: {
    gap: 9,
  },
  sectionTitle: {
    fontSize: 14.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  legsStack: {
    gap: 9,
  },
  legCard: {
    borderRadius: 15,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 12,
    gap: 8,
  },
  legHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legLeagueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  legLeague: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
    flexShrink: 1,
  },
  legStatusGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  legDateNextToStatus: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  legBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  legBadgeWon: {
    backgroundColor: COLORS.winSoft,
  },
  legBadgeLost: {
    backgroundColor: "rgba(225, 0, 20, 0.10)",
  },
  legBadgeIdle: {
    backgroundColor: COLORS.elev,
  },
  legBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  legBodyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legTeamsCol: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  legTeamsInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    flexShrink: 1,
  },
  legPick: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  legRightCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  legScore: {
    fontSize: 12.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  legOddsPill: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  legOddsText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
});
