import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ExternalLink, Share2 } from "lucide-react-native";
import { api, ApiHttpError, type ClientBet, type ClientMatch } from "@/lib/api";
import {
  getCachedMatchSnapshot,
  getCachedSingleOrPredictionBet,
} from "@/lib/entity-cache";
import { eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { TeamAvatar } from "@/components/team-avatar";
import { SlideToCashOut } from "@/components/slide-to-cashout";
import {
  LiveMatchTracker,
  RealMatchStatsCard,
} from "@/components/live-match-tracker";
import { BareInfiniteSpinner } from "@/components/infinite-scroll-loader";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page dédiée `/paris/simple/[id]` fidèle à `src/app/(main)/paris/simple/[id]/page.tsx`.
 */
export default function SingleBetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const betId = Number(params.id);
  const {
    oddsFormat,
    setBalance,
    refreshPulseNow,
    openShareTicket,
    dataSaverMode,
    toast,
  } = useApp();

  const [bet, setBet] = useState<ClientBet | null>(() =>
    Number.isFinite(betId) ? getCachedSingleOrPredictionBet(betId) : null
  );
  const [liveMatch, setLiveMatch] = useState<ClientMatch | null>(() =>
    bet?.matchId ? getCachedMatchSnapshot(bet.matchId) : null
  );
  const [cashingOut, setCashingOut] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(betId) || betId <= 0) return;
    try {
      const res = await api.bets("all");
      const found =
        res.bets.find((b) => b.kind !== "combo" && b.id === betId) ?? null;
      if (found) {
        setBet(found);
        if (found.matchId) {
          const mRes = await api.matchById(found.matchId).catch(() => null);
          if (mRes) setLiveMatch(mRes.match);
        }
      }
    } catch {
      // Conserve le snapshot
    }
  }, [betId]);

  useSmartPolling(load, 5_000, {
    enabled: Number.isFinite(betId) && betId > 0,
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const handleCashOut = async () => {
    if (!bet?.cashOut || cashingOut) return;
    setCashingOut(true);
    try {
      const res = await api.cashOut(bet.id, bet.kind, bet.cashOut);
      setBalance(res.balance);
      void refreshPulseNow();
      await load();
      toast({
        kind: "win",
        title: `Ticket vendu · +${eur(res.cashOutAmount)}`,
      });
    } catch (err) {
      if (err instanceof ApiHttpError && err.code === "CASHOUT_CHANGED") {
        await load();
        toast({ kind: "info", title: "Offre Cash Out actualisée" });
      } else {
        toast({
          kind: "error",
          title: "Cash Out indisponible",
          subtitle: err instanceof Error ? err.message : undefined,
        });
      }
    } finally {
      setCashingOut(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.pageTitle}>Ticket #{betId}</Text>
        {bet && (
          <Pressable
            onPress={() => openShareTicket(bet)}
            style={styles.iconBtn}
          >
            <Share2 size={16} color={colors.ink} strokeWidth={2.3} />
          </Pressable>
        )}
      </View>

      {!bet ? (
        <BareInfiniteSpinner visible />
      ) : (
        <>
          <View
            style={[
              bet.status === "won" ? cardSurface.ticketWon : cardSurface.glassCard,
              styles.card,
            ]}
          >
            <View style={styles.statusHeader}>
              <Text style={styles.leagueText}>{bet.league}</Text>
              <View
                style={[
                  styles.statusBadge,
                  bet.status === "won" && { backgroundColor: "rgba(21,128,61,0.14)" },
                  bet.status === "lost" && { backgroundColor: "rgba(220,38,38,0.14)" },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    bet.status === "won" && { color: colors.win },
                    bet.status === "lost" && { color: colors.bittersweet },
                  ]}
                >
                  {bet.status === "won"
                    ? "Gagné"
                    : bet.status === "lost"
                      ? "Perdu"
                      : bet.status === "cashed_out"
                        ? "Vendu"
                        : bet.status === "void"
                          ? "Remboursé"
                          : "En cours"}
                </Text>
              </View>
            </View>

            {bet.kind === "sport" ? (
              <View style={styles.teamsRow}>
                <View style={styles.teamCol}>
                  <TeamAvatar name={bet.homeTeam} logo={bet.homeLogo} size="sm" />
                  <Text style={styles.teamName}>{bet.homeTeam}</Text>
                </View>
                {typeof bet.matchHomeScore === "number" &&
                typeof bet.matchAwayScore === "number" ? (
                  <Text style={styles.scoreText}>
                    {bet.matchHomeScore} - {bet.matchAwayScore}
                  </Text>
                ) : (
                  <Text style={styles.vsText}>VS</Text>
                )}
                <View style={styles.teamCol}>
                  <TeamAvatar name={bet.awayTeam} logo={bet.awayLogo} size="sm" />
                  <Text style={styles.teamName}>{bet.awayTeam}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.predTitle}>{bet.question}</Text>
            )}

            <View style={styles.selBox}>
              <Text style={styles.selLabel}>Sélection</Text>
              <Text style={styles.selValue}>{bet.selectionLabel}</Text>
            </View>

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
                <Text style={styles.metricLabel}>
                  {bet.status === "cashed_out" ? "Encaissé :" : "Gain max :"}
                </Text>
                <Text
                  style={[
                    styles.metricVal,
                    bet.status === "won" && { color: colors.win },
                    bet.status === "lost" && { color: colors.bittersweet },
                  ]}
                >
                  {bet.status === "lost"
                    ? eur(0)
                    : eur(
                        bet.status === "cashed_out"
                          ? (bet.cashOutAmount ?? bet.stake)
                          : bet.potentialWin
                      )}
                </Text>
              </View>
            </View>

            <Text style={styles.metaDate}>
              Placé {formatPlacedAt(bet.placedAt)}
              {bet.matchStartsAt
                ? ` · Coup d'envoi ${formatKickoff(bet.matchStartsAt)}`
                : ""}
            </Text>

            {bet.status === "pending" &&
              typeof bet.cashOut === "number" &&
              bet.cashOut > 0 && (
                <SlideToCashOut
                  amount={bet.cashOut}
                  loading={cashingOut}
                  onConfirm={handleCashOut}
                />
              )}
          </View>

          {liveMatch && liveMatch.status === "live" && (
            <>
              {liveMatch.source !== "manual" ? (
                <LiveMatchTracker match={liveMatch} />
              ) : (
                <RealMatchStatsCard
                  stats={liveMatch.realStats}
                  homeTeam={liveMatch.homeTeam}
                  awayTeam={liveMatch.awayTeam}
                />
              )}
            </>
          )}

          {/* Bouton contextuel unique vers le match ou le résultat */}
          {bet.kind === "sport" && bet.matchId && (
            <Pressable
              onPress={() =>
                router.push(
                  bet.matchStatus === "finished"
                    ? `/resultats/${bet.matchId}`
                    : `/matchs/${bet.matchId}`
                )
              }
              style={styles.contextLinkBtn}
            >
              <Text style={styles.contextLinkText}>
                {bet.matchStatus === "finished"
                  ? "Consulter le résultat officiel"
                  : "Ouvrir la fiche du match"}
              </Text>
              <ExternalLink size={14} color={colors.ink} strokeWidth={2.3} />
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 11,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.ink,
  },
  card: {
    padding: 14,
    gap: 11,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  leagueText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.mist,
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.elev,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.ink,
  },
  teamsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamCol: {
    flex: 1,
    alignItems: "center",
    gap: 5,
  },
  teamName: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
    textAlign: "center",
  },
  scoreText: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  vsText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.dim,
  },
  predTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.ink,
  },
  selBox: {
    padding: 10,
    borderRadius: 11,
    backgroundColor: colors.elev,
    gap: 2,
  },
  selLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    color: colors.dim,
  },
  selValue: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  amountsInline: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 6,
  },
  metricInline: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.dim,
    fontWeight: "500",
  },
  metricVal: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  metaDate: {
    fontSize: 11,
    color: colors.dim,
    fontWeight: "500",
  },
  contextLinkBtn: {
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  contextLinkText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
  },
});
