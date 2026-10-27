import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { ArrowLeft, ChevronRight, Share2 } from "@/components/icons";
import { api, ApiHttpError, type ClientBet, type ClientComboLeg } from "@/lib/api";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import { getCachedBetSnapshot } from "@/lib/entity-cache";
import { eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { SlideToCashOut } from "@/components/slide-to-cashout";
import { BareInfiniteSpinner } from "@/components/infinite-scroll-loader";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page dédiée `/paris/combine/[id]` fidèle à `src/app/(main)/paris/combine/[id]/page.tsx` :
 * - Sélections terminées en premier, puis en direct, puis à venir (`sortComboBetLegsChronologically`)
 * - Date & heure placées **à côté du statut** en haut de la sélection (jamais à l'intérieur du corps de la carte)
 * - Statut `Perdu` en rouge + `SlideToCashOut` vert créatif émeraude.
 */
export default function ComboBetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const comboId = Number(params.id);
  const {
    oddsFormat,
    setBalance,
    refreshPulseNow,
    openShareTicket,
    dataSaverMode,
    hapticsEnabled,
    toast,
  } = useApp();

  const [bet, setBet] = useState<ClientBet | null>(() =>
    Number.isFinite(comboId) ? getCachedBetSnapshot("combo", comboId) : null
  );
  const [cashingOut, setCashingOut] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(comboId) || comboId <= 0) return;
    try {
      const res = await api.bets("all");
      const found =
        res.bets.find((b) => b.kind === "combo" && b.id === comboId) ?? null;
      if (found) setBet(found);
    } catch {
      // Conserve le snapshot
    }
  }, [comboId]);

  useSmartPolling(load, 5_000, {
    enabled: Number.isFinite(comboId) && comboId > 0,
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const sortedLegs = useMemo<ClientComboLeg[]>(
    () => sortComboBetLegsChronologically(bet?.legs ?? []),
    [bet?.legs]
  );

  const wonLegsCount = sortedLegs.filter((l) => l.status === "won").length;

  const handleCashOut = async () => {
    if (!bet?.cashOut || cashingOut) return;
    setCashingOut(true);
    try {
      const res = await api.cashOut(bet.id, "combo", bet.cashOut);
      setBalance(res.balance);
      void refreshPulseNow();
      await load();
      toast({
        kind: "win",
        title: `Combiné vendu · +${eur(res.cashOutAmount)}`,
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
        <Text style={styles.pageTitle}>Combiné #{comboId}</Text>
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
              styles.summaryCard,
            ]}
          >
            <View style={styles.summaryTop}>
              <Text style={styles.summaryTitle}>
                Progression : {wonLegsCount}/{sortedLegs.length} validée
                {wonLegsCount > 1 ? "s" : ""}
              </Text>
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

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${
                      sortedLegs.length > 0
                        ? Math.round((wonLegsCount / sortedLegs.length) * 100)
                        : 0
                    }%`,
                  },
                ]}
              />
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

            <Text style={styles.placedMeta}>
              Placé {formatPlacedAt(bet.placedAt)}
              {bet.boostPct && bet.boostPct > 0
                ? ` · Bonus Combiné +${bet.boostPct}% inclus`
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

          <Text style={styles.sectionHeader}>Sélections du combiné</Text>

          <View style={{ gap: 10 }}>
            {sortedLegs.map((leg, idx) => {
              const statusLabel =
                leg.status === "won"
                  ? "Gagné"
                  : leg.status === "lost"
                    ? "Perdu"
                    : leg.status === "void"
                      ? "Remboursé"
                      : leg.matchStatus === "live"
                        ? (leg.matchMinute ?? "EN DIRECT")
                        : "À venir";

              const destHref =
                leg.kind === "sport" && leg.matchId
                  ? leg.matchStatus === "finished" || leg.status !== "pending"
                    ? `/resultats?match=${leg.matchId}`
                    : `/matchs/${leg.matchId}`
                  : leg.kind === "prediction" && leg.questionId
                    ? `/predictions/${leg.questionId}`
                    : null;

              return (
                <View key={`${leg.title}-${idx}`} style={styles.legBlock}>
                  {/* En-tête externe : Statut + Date/Heure juste à côté (jamais dans la carte) */}
                  <View style={styles.legOuterMeta}>
                    <View
                      style={[
                        styles.legStatusPill,
                        leg.status === "won" && {
                          backgroundColor: "rgba(21,128,61,0.14)",
                        },
                        leg.status === "lost" && {
                          backgroundColor: "rgba(220,38,38,0.14)",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.legStatusText,
                          leg.status === "won" && { color: colors.win },
                          leg.status === "lost" && { color: colors.bittersweet },
                        ]}
                      >
                        {statusLabel}
                      </Text>
                    </View>
                    {leg.matchStartsAt ? (
                      <Text style={styles.legKickoffNextToStatus}>
                        {formatKickoff(leg.matchStartsAt)}
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    disabled={!destHref}
                    onPress={() => {
                      if (destHref) {
                        triggerHaptic("light", hapticsEnabled);
                        router.push(destHref);
                      }
                    }}
                    style={[cardSurface.glassCard, styles.legCard]}
                  >
                    <View style={styles.legCardTop}>
                      <Text numberOfLines={1} style={styles.legLeague}>
                        {leg.league}
                      </Text>
                      {typeof leg.matchHomeScore === "number" &&
                        typeof leg.matchAwayScore === "number" && (
                          <Text style={styles.legScore}>
                            {leg.matchHomeScore} - {leg.matchAwayScore}
                          </Text>
                        )}
                    </View>

                    <Text style={styles.legTitle}>{leg.title}</Text>

                    <View style={styles.legBottomRow}>
                      <Text numberOfLines={1} style={styles.legSel}>
                        {leg.selectionLabel}
                      </Text>
                      <View style={styles.legOddsRight}>
                        <Text style={styles.legOddsVal}>
                          ×{formatOdds(leg.odds, oddsFormat)}
                        </Text>
                        {destHref && (
                          <ChevronRight
                            size={13}
                            color={colors.dim}
                            strokeWidth={2.4}
                          />
                        )}
                      </View>
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
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
  summaryCard: {
    padding: 14,
    gap: 10,
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
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
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.elev,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.win,
    borderRadius: 999,
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
  placedMeta: {
    fontSize: 11,
    color: colors.dim,
    fontWeight: "500",
  },
  sectionHeader: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "900",
    color: colors.ink,
  },
  legBlock: {
    gap: 5,
  },
  legOuterMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
  },
  legStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    backgroundColor: colors.white,
  },
  legStatusText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: colors.ink,
  },
  legKickoffNextToStatus: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.dim,
  },
  legCard: {
    padding: 12,
    gap: 5,
  },
  legCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  legLeague: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: colors.mist,
  },
  legScore: {
    fontSize: 12.5,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  legTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.ink,
  },
  legBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legSel: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.betclicRed,
  },
  legOddsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  legOddsVal: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
});
