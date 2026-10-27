import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, ExternalLink, Share2 } from "lucide-react-native";
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
} from "@/lib/api";
import { getCachedSingleOrPredictionBet } from "@/lib/entity-cache";
import {
  eur,
  formatFullDateTime,
  formatMatchDateTimeShort,
  formatOdds,
} from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function SingleBetDetailScreen() {
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
    Number.isFinite(betId) ? getCachedSingleOrPredictionBet(betId) : null
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
        res.bets.find(
          (b) =>
            b.id === betId && (b.kind === "sport" || b.kind === "prediction")
        ) ?? null;
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
        <Text style={styles.notFound}>Ticket introuvable</Text>
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
        kind: bet.kind,
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

  const eventHref =
    bet.kind === "prediction" && bet.questionId
      ? `/predictions/${bet.questionId}`
      : bet.matchId
        ? bet.matchStatus === "finished"
          ? `/resultats?match=${bet.matchId}`
          : `/matchs/${bet.matchId}`
        : null;

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
        <Text style={styles.navTitle}>Ticket #{bet.id}</Text>
        <Pressable
          onPress={() => openShareTicket(bet)}
          style={styles.shareBtn}
        >
          <Share2 size={15} color={COLORS.ink} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.leagueRow}>
            <SportIcon sport={bet.sport} size={14} color={COLORS.dim} />
            <Text numberOfLines={1} style={styles.leagueText}>
              {bet.league}
            </Text>
          </View>
          <View style={styles.statusRight}>
            {bet.matchStartsAt ? (
              <Text style={styles.dateText}>
                {formatMatchDateTimeShort(bet.matchStartsAt)}
              </Text>
            ) : null}
            <BetStatusBadge status={bet.status} />
          </View>
        </View>

        {bet.kind === "prediction" ? (
          <Text style={styles.matchTitle}>
            {bet.question || bet.homeTeam}
          </Text>
        ) : (
          <View style={styles.teamsBlock}>
            <View style={styles.teamRow}>
              <TeamAvatar
                name={bet.homeTeam}
                logo={bet.homeLogo}
                size="sm"
              />
              <Text style={styles.teamName}>{bet.homeTeam}</Text>
              {bet.matchHomeScore !== null ? (
                <Text style={styles.scoreVal}>{bet.matchHomeScore}</Text>
              ) : null}
            </View>
            <View style={styles.teamRow}>
              <TeamAvatar
                name={bet.awayTeam}
                logo={bet.awayLogo}
                size="sm"
              />
              <Text style={styles.teamName}>{bet.awayTeam}</Text>
              {bet.matchAwayScore !== null ? (
                <Text style={styles.scoreVal}>{bet.matchAwayScore}</Text>
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.pickBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pickCaption}>Sélection</Text>
            <Text style={styles.pickVal}>{bet.selectionLabel}</Text>
          </View>
          <View style={styles.oddsBadge}>
            <Text style={styles.oddsText}>
              {formatOdds(bet.odds, oddsFormat)}
            </Text>
          </View>
        </View>

        <View style={styles.summaryRows}>
          <View style={styles.sRow}>
            <Text style={styles.sLabel}>Placé le</Text>
            <Text style={styles.sVal}>{formatFullDateTime(bet.placedAt)}</Text>
          </View>
          <View style={styles.sRow}>
            <Text style={styles.sLabel}>Mise engagée</Text>
            <Text style={styles.sVal}>{eur(bet.stake)}</Text>
          </View>
          <View style={styles.sRow}>
            <Text style={styles.sLabel}>Cote fixe verrouillée</Text>
            <Text style={styles.sVal}>{formatOdds(bet.odds, oddsFormat)}</Text>
          </View>
          <View style={[styles.sRow, styles.sTotal]}>
            <Text style={styles.sTotalLabel}>
              {bet.status === "cashed" ? "Montant vendu" : "Gain potentiel"}
            </Text>
            <Text
              style={[
                styles.sTotalVal,
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

        {eventHref ? (
          <Pressable
            onPress={() => router.push(eventHref)}
            style={styles.eventLink}
          >
            <Text style={styles.eventLinkText}>
              {bet.matchStatus === "finished"
                ? "Voir le résultat officiel du match"
                : "Ouvrir la fiche de l'événement"}
            </Text>
            <ExternalLink size={14} color={COLORS.ink} strokeWidth={2.2} />
          </Pressable>
        ) : null}
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
  card: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 15,
    gap: 13,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  leagueText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.mist,
    flexShrink: 1,
  },
  statusRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dateText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
    lineHeight: 22,
  },
  teamsBlock: {
    gap: 9,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  teamName: {
    fontSize: 14.5,
    fontWeight: "800",
    color: COLORS.ink,
    flex: 1,
  },
  scoreVal: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  pickBox: {
    borderRadius: 13,
    backgroundColor: COLORS.elev,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  pickCaption: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.dim,
  },
  pickVal: {
    fontSize: 14.5,
    fontWeight: "800",
    color: COLORS.betclicRed,
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
  oddsText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  summaryRows: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 11,
  },
  sRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sLabel: {
    fontSize: 12.5,
    fontWeight: "500",
    color: COLORS.dim,
  },
  sVal: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  sTotal: {
    borderTopWidth: 1,
    borderTopColor: COLORS.edgeSoft,
    paddingTop: 9,
    marginTop: 2,
  },
  sTotalLabel: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  sTotalVal: {
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
  eventLink: {
    height: 42,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  eventLinkText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
});
