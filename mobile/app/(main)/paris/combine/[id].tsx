import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Flame,
  Layers,
  Lock,
  Share2,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react-native";
import {
  resolveLegTeams,
  shortMarketBadge,
  StatusPill,
  TicketTeamRow,
} from "@/components/bet-ticket";
import { LiveMatchClock } from "@/components/live-match-clock";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { SlideToCashOut } from "@/components/slide-to-cashout";
import { SportIcon } from "@/components/sport-icon";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  type ComboLegClient,
  type UnifiedBet,
} from "@/lib/api";
import { getCachedUnifiedBet } from "@/lib/entity-cache";
import { eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { createIdempotencyKey } from "@/lib/http";
import { useParams, useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const POLL_LIVE_MS = 3_500;
const POLL_IDLE_MS = 6_000;

function legBucket(leg: ComboLegClient): number {
  const isFinished =
    leg.status !== "pending" || leg.matchStatus === "finished";
  if (isFinished) return 0;
  if (leg.matchStatus === "live") return 1;
  return 2;
}

function legSortTimestamp(leg: ComboLegClient): number {
  const t = leg.startsAt ? new Date(leg.startsAt).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

export default function ComboDetailScreen() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const comboId = Number(params.id);
  const invalidId = !Number.isInteger(comboId) || comboId <= 0;

  const {
    authReady,
    sessionRestoring,
    user,
    oddsFormat,
    setBalance,
    bumpBets,
    toast,
    hapticsEnabled,
  } = useApp();

  const [prevId, setPrevId] = useState<number>(comboId);
  const [bet, setBet] = useState<UnifiedBet | null | undefined>(() =>
    invalidId ? null : (getCachedUnifiedBet("combo", comboId) ?? undefined)
  );
  const [cashing, setCashing] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [sharingBet, setSharingBet] = useState<UnifiedBet | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cashoutKeyRef = useRef<{ expected: number; key: string } | null>(null);

  if (comboId !== prevId) {
    setPrevId(comboId);
    setBet(
      invalidId ? null : (getCachedUnifiedBet("combo", comboId) ?? undefined)
    );
    setCashoutError(null);
  }

  const userId = user?.id ?? null;
  const canQueryCombo = !invalidId && (Boolean(userId) || sessionRestoring);

  const fetchCombo = useCallback(async () => {
    if (!canQueryCombo) return;
    try {
      const r = await api.bets.byId("combo", comboId);
      if (r.balance != null) setBalance(r.balance);
      setBet(r.bet);
    } catch {
      /* garde l'état courant */
    }
  }, [canQueryCombo, comboId, setBalance]);

  const hasLiveLeg = useMemo(
    () =>
      Boolean(
        bet &&
          bet.status === "pending" &&
          bet.legs?.some((l) => l.matchStatus === "live")
      ),
    [bet]
  );
  const shouldPoll = bet === undefined || bet?.status === "pending";

  useEffect(() => {
    if (!canQueryCombo) return;
    void fetchCombo();
  }, [canQueryCombo, fetchCombo]);

  useEffect(() => {
    if (!canQueryCombo || !shouldPoll) return;
    const id = setInterval(
      () => void fetchCombo(),
      hasLiveLeg ? POLL_LIVE_MS : POLL_IDLE_MS
    );
    return () => clearInterval(id);
  }, [canQueryCombo, fetchCombo, shouldPoll, hasLiveLeg]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchCombo();
    setRefreshing(false);
  }, [fetchCombo]);

  // Sélections triées : terminés (récents d'abord) -> en cours -> à venir (plus proches d'abord)
  const orderedLegs = useMemo(() => {
    const legs = bet?.legs ?? [];
    return [...legs].sort((a, b) => {
      const ba = legBucket(a);
      const bb = legBucket(b);
      if (ba !== bb) return ba - bb;
      const ta = legSortTimestamp(a);
      const tb = legSortTimestamp(b);
      if (ba === 0) return tb - ta || b.id - a.id;
      return (ta || Infinity) - (tb || Infinity) || a.id - b.id;
    });
  }, [bet?.legs]);

  const progress = useMemo(() => {
    const legs = bet?.legs ?? [];
    return {
      total: legs.length,
      won: legs.filter((l) => l.status === "won").length,
      lost: legs.filter((l) => l.status === "lost").length,
      pending: legs.filter((l) => l.status === "pending").length,
    };
  }, [bet]);

  const handleCashOut = async () => {
    if (!bet || bet.cashOutValue == null || cashing) return;
    const expectedCashout = bet.cashOutValue;
    if (
      !cashoutKeyRef.current ||
      cashoutKeyRef.current.expected !== expectedCashout
    ) {
      cashoutKeyRef.current = {
        expected: expectedCashout,
        key: createIdempotencyKey(`cashout-combo-${bet.id}`),
      };
    }
    const idempotencyKey = cashoutKeyRef.current.key;
    setCashing(true);
    setCashoutError(null);
    try {
      const r = await api.bets.cashout({
        betId: bet.id,
        kind: "combo",
        expectedCashout,
        idempotencyKey,
      });
      cashoutKeyRef.current = null;
      setBalance(r.balance);
      bumpBets();
      triggerHaptic("success", hapticsEnabled);
      toast({
        kind: "success",
        title: `Pari vendu pour ${eur(r.value)}`,
        description: "Le montant a été crédité sur votre solde.",
      });
      void fetchCombo();
    } catch (e) {
      if (e instanceof ApiHttpError && e.status >= 400 && e.status < 500) {
        cashoutKeyRef.current = null;
      }
      if (
        e instanceof ApiHttpError &&
        e.status === 409 &&
        e.code === "CASHOUT_CHANGED" &&
        e.cashoutDetails
      ) {
        const nextVal =
          e.cashoutDetails.currentValue ?? e.cashoutDetails.currentCashout ?? 0;
        setCashoutError(
          nextVal > 0
            ? `Offre mise à jour à ${eur(nextVal)}. Glissez à nouveau pour confirmer.`
            : "Le Cash Out vient d'être suspendu."
        );
        void fetchCombo();
        return;
      }
      const msg = e instanceof Error ? e.message : "Cash Out indisponible";
      setCashoutError(msg);
      toast({ kind: "error", title: "Vente refusée", description: msg });
    } finally {
      setCashing(false);
    }
  };

  if ((!authReady || sessionRestoring) && !user) {
    return (
      <View style={styles.page}>
        <PulseFlashLoader compact />
      </View>
    );
  }

  if (!user && bet == null) {
    return (
      <View style={[styles.page, styles.centerWrap]}>
        <View style={styles.authCard}>
          <Lock size={22} color={COLORS.betclicRed} strokeWidth={2.2} />
          <Text style={styles.authTitle}>Connexion requise</Text>
          <Text style={styles.authSub}>
            Connectez-vous pour consulter ce coupon combiné.
          </Text>
          <Pressable
            onPress={() => router.push("/auth")}
            style={styles.redPillBtn}
          >
            <Text style={styles.redPillBtnText}>Se connecter</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <>
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
        {/* En-tête identique à src/app/(main)/paris/combine/[id]/page.tsx */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={() => router.back("/paris")}
              style={({ pressed }) => [
                styles.roundBackBtn,
                pressed && { transform: [{ scale: 0.95 }] },
              ]}
            >
              <ArrowLeft size={16} color={COLORS.ink} strokeWidth={2.2} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <Layers size={16} color={COLORS.betclicRed} strokeWidth={2.3} />
                <Text style={styles.pageTitle}>Pari Combiné</Text>
              </View>
              {bet ? (
                <Text style={styles.subText}>
                  {progress.total} sélections · Placé{" "}
                  {formatPlacedAt(bet.placedAt)}
                </Text>
              ) : null}
            </View>
          </View>

          {bet ? (
            <View style={styles.headerRight}>
              <StatusPill
                status={bet.status}
                live={
                  bet.status === "pending" &&
                  Boolean(
                    bet.matchStatus === "live" ||
                      bet.legs?.some(
                        (l) => l.status === "pending" && l.matchStatus === "live"
                      )
                  )
                }
                minute={bet.matchMinute}
                clockSource={(() => {
                  const liveLeg = bet.legs?.find(
                    (l) => l.status === "pending" && l.matchStatus === "live"
                  );
                  if (
                    bet.status !== "pending" ||
                    (bet.matchStatus !== "live" && !liveLeg)
                  ) {
                    return null;
                  }
                  return {
                    matchId: bet.liveMatchId ?? liveLeg?.matchId ?? null,
                    status: "live",
                    minute: bet.matchMinute ?? liveLeg?.matchMinute ?? null,
                    startsAt:
                      bet.liveMatchStartsAt ?? liveLeg?.matchStartsAt ?? null,
                    source:
                      bet.liveMatchSource ?? liveLeg?.matchSource ?? null,
                    clockAnchor:
                      bet.matchClockAnchor ?? liveLeg?.matchClockAnchor ?? null,
                  };
                })()}
              />
              {bet.status === "pending" ? (
                <Pressable
                  onPress={() => setSharingBet(bet)}
                  style={styles.sharePillBtn}
                >
                  <Share2 size={14} color={COLORS.ink} strokeWidth={2.2} />
                  <Text style={styles.sharePillText}>Partager</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: 14 }}>
          {bet === undefined ? (
            <PulseFlashLoader compact />
          ) : bet === null ? (
            <View style={styles.notFoundCard}>
              <AlertTriangle
                size={24}
                color={COLORS.betclicRed}
                strokeWidth={2.2}
              />
              <Text style={styles.notFoundTitle}>Combiné introuvable</Text>
              <Text style={styles.notFoundSub}>
                Ce coupon combiné n&apos;existe pas ou ne vous appartient pas.
              </Text>
              <Pressable
                onPress={() => router.push("/paris")}
                style={[styles.redPillBtn, { marginTop: 16 }]}
              >
                <Text style={styles.redPillBtnText}>Retour à mes paris</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              {/* Carte récapitulative financière */}
              <View style={styles.card}>
                <View style={styles.progressHeader}>
                  <View style={styles.progressTitleRow}>
                    <Text style={styles.progressLabel}>Progression</Text>
                    <Text style={styles.progressFraction}>
                      {progress.won}/{progress.total} validée
                      {progress.won > 1 ? "s" : ""}
                    </Text>
                  </View>

                  {(bet.boostPct ?? 0) > 0 ? (
                    <View style={styles.boostBadge}>
                      <Flame
                        size={12}
                        color={COLORS.betclicRed}
                        strokeWidth={2.4}
                      />
                      <Text style={styles.boostBadgeText}>
                        Boost +{bet.boostPct}%
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${
                          progress.total > 0
                            ? Math.round((progress.won / progress.total) * 100)
                            : 0
                        }%`,
                        backgroundColor:
                          bet.status === "lost" ? COLORS.betclicRed : COLORS.win,
                      },
                    ]}
                  />
                </View>

                <View style={styles.amountsRow}>
                  <Text style={styles.amountItem}>
                    <Text style={styles.amountMuted}>Mise : </Text>
                    <Text style={styles.amountStrong}>{eur(bet.stake)}</Text>
                  </Text>
                  <Text style={styles.amountItem}>
                    <Text style={styles.amountMuted}>Cote : </Text>
                    <Text
                      style={[styles.amountStrong, { color: COLORS.betclicRed }]}
                    >
                      {formatOdds(bet.odds, oddsFormat)}
                    </Text>
                  </Text>
                  <Text style={styles.amountItem}>
                    <Text style={styles.amountMuted}>
                      {bet.status === "won"
                        ? "Gain : "
                        : bet.status === "cashed"
                          ? "Vendu : "
                          : bet.status === "void"
                            ? "Remboursé : "
                            : "Gain max : "}
                    </Text>
                    <Text
                      style={[
                        styles.amountStrong,
                        {
                          color:
                            bet.status === "won" || bet.status === "cashed"
                              ? COLORS.win
                              : bet.status === "lost"
                                ? COLORS.dim
                                : COLORS.ink,
                        },
                      ]}
                    >
                      {bet.status === "cashed" &&
                      (bet.cashOutAmount ?? bet.cashOut) != null
                        ? eur((bet.cashOutAmount ?? bet.cashOut)!)
                        : bet.status === "void"
                          ? eur(bet.stake)
                          : bet.status === "lost"
                            ? eur(0)
                            : eur(bet.potentialWin)}
                    </Text>
                  </Text>
                </View>

                {bet.status === "pending" && bet.cashOutValue != null ? (
                  <View style={{ marginTop: 14, gap: 6 }}>
                    <SlideToCashOut
                      amount={bet.cashOutValue}
                      stake={bet.stake}
                      loading={cashing}
                      onConfirm={handleCashOut}
                    />
                    {cashoutError ? (
                      <Text style={styles.cashoutError}>{cashoutError}</Text>
                    ) : null}
                  </View>
                ) : null}

                {bet.status === "cashed" &&
                (bet.cashOutAmount ?? bet.cashOut) != null ? (
                  <View style={styles.cashedBanner}>
                    <Sparkles size={14} color={COLORS.win} strokeWidth={2.3} />
                    <Text style={styles.cashedBannerText}>
                      Cash Out encaissé :{" "}
                      {eur((bet.cashOutAmount ?? bet.cashOut)!)}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Sélections du combiné (date/heure à côté du statut, jamais dans le corps) */}
              <View style={{ gap: 10 }}>
                <Text style={styles.sectionCaps}>
                  SÉLECTIONS DU COMBINÉ ({orderedLegs.length})
                </Text>

                <View style={{ gap: 10 }}>
                  {orderedLegs.map((leg) => (
                    <ComboLegCard
                      key={leg.id}
                      leg={leg}
                      oddsFormat={oddsFormat}
                    />
                  ))}
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <ShareTicketModal
        bet={sharingBet}
        onClose={() => setSharingBet(null)}
      />
    </>
  );
}

function ComboLegCard({
  leg,
  oddsFormat,
}: {
  leg: ComboLegClient;
  oddsFormat: "decimal" | "fractional";
}) {
  const router = useRouter();
  const teams = resolveLegTeams(leg);
  const showLegScores = Boolean(
    teams &&
      (leg.matchStatus === "live" || leg.matchStatus === "finished") &&
      leg.homeScore != null &&
      leg.awayScore != null
  );
  const legMarketTag = shortMarketBadge(leg.market);

  const legHref =
    leg.kind === "sport" && leg.matchId
      ? leg.matchStatus === "finished"
        ? `/resultats/${leg.matchId}`
        : `/matchs/${leg.matchId}`
      : leg.kind === "prediction" && leg.questionId
        ? `/predictions/${leg.questionId}`
        : null;

  return (
    <Pressable
      disabled={!legHref}
      onPress={() => legHref && router.push(legHref)}
      style={({ pressed }) => [
        styles.legCard,
        leg.status === "won"
          ? styles.legCardWon
          : leg.status === "lost"
            ? styles.legCardLost
            : undefined,
        pressed && legHref ? { opacity: 0.96 } : undefined,
      ]}
    >
      {/* En-tête : ligue à gauche + date/heure à côté du statut à droite */}
      <View style={styles.legTopRow}>
        <View style={styles.legTopLeft}>
          {leg.kind === "prediction" ? (
            <TrendingUp
              size={14}
              color={COLORS.betclicRed}
              strokeWidth={2.2}
            />
          ) : (
            <SportIcon
              sport={leg.sport}
              size={14}
              color={COLORS.betclicRed}
            />
          )}
          <Text numberOfLines={1} style={styles.legLeagueText}>
            {leg.league}
          </Text>
        </View>

        <View style={styles.legTopRight}>
          {leg.startsAt ? (
            <Text style={styles.legDateText}>
              {formatKickoff(leg.startsAt)}
            </Text>
          ) : null}

          {leg.matchStatus === "live" && leg.status === "pending" ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <LiveMatchClock
                match={{
                  matchId: leg.matchId,
                  status: "live",
                  minute: leg.minute ?? leg.matchMinute,
                  startsAt: leg.startsAt ?? leg.matchStartsAt,
                  source: leg.matchSource ?? null,
                  clockAnchor: leg.matchClockAnchor ?? null,
                }}
                fallback={leg.minute ?? "LIVE"}
                style={styles.liveBadgeText}
              />
            </View>
          ) : null}

          <View
            style={[
              styles.legStatusBadge,
              leg.status === "won"
                ? styles.legStatusWon
                : leg.status === "lost"
                  ? styles.legStatusLost
                  : styles.legStatusPending,
            ]}
          >
            {leg.status === "won" ? (
              <>
                <Check size={11} color={COLORS.win} strokeWidth={2.8} />
                <Text style={[styles.legStatusText, { color: COLORS.win }]}>
                  Gagné
                </Text>
              </>
            ) : leg.status === "lost" ? (
              <>
                <X size={11} color={COLORS.betclicRed} strokeWidth={2.8} />
                <Text
                  style={[styles.legStatusText, { color: COLORS.betclicRed }]}
                >
                  Perdu
                </Text>
              </>
            ) : leg.status === "void" ? (
              <Text style={[styles.legStatusText, { color: COLORS.mist }]}>
                Remboursé
              </Text>
            ) : (
              <>
                <Clock size={11} color={COLORS.mist} strokeWidth={2.2} />
                <Text style={[styles.legStatusText, { color: COLORS.mist }]}>
                  En cours
                </Text>
              </>
            )}
          </View>
        </View>
      </View>

      {/* Équipes / question */}
      <View style={{ marginTop: 10 }}>
        {teams ? (
          <View style={{ gap: 6 }}>
            <TicketTeamRow
              name={teams.home}
              logo={teams.homeLogo}
              score={showLegScores ? (leg.homeScore ?? null) : null}
              isLive={leg.matchStatus === "live"}
            />
            <TicketTeamRow
              name={teams.away}
              logo={teams.awayLogo}
              score={showLegScores ? (leg.awayScore ?? null) : null}
              isLive={leg.matchStatus === "live"}
            />
          </View>
        ) : (
          <Text style={styles.predTitle}>{leg.title}</Text>
        )}
      </View>

      {/* Sélection + cote */}
      <View style={styles.pickRow}>
        <View style={styles.pickLeft}>
          <Text numberOfLines={1} style={styles.pickLabel}>
            {leg.selectionLabel}
          </Text>
          {legMarketTag ? (
            <View style={styles.marketBadge}>
              <Text style={styles.marketBadgeText}>{legMarketTag}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.pickOddsBadge}>
          <Text style={styles.pickOddsText}>
            {formatOdds(leg.odds, oddsFormat)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 36,
  },
  centerWrap: {
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  authCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 24,
    alignItems: "center",
  },
  authTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.ink,
  },
  authSub: {
    marginTop: 4,
    fontSize: 12.5,
    color: COLORS.mist,
    textAlign: "center",
  },
  redPillBtn: {
    marginTop: 14,
    height: 40,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  redPillBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  roundBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.3,
  },
  subText: {
    fontSize: 11.5,
    color: COLORS.dim,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sharePillBtn: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sharePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  loaderBox: {
    paddingVertical: 48,
    alignItems: "center",
  },
  notFoundCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 24,
    alignItems: "center",
  },
  notFoundTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.ink,
  },
  notFoundSub: {
    marginTop: 4,
    fontSize: 12.5,
    color: COLORS.mist,
    textAlign: "center",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 16,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  progressTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressLabel: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  progressFraction: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
  boostBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(225,0,20,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 2.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  boostBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  progressTrack: {
    marginTop: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  amountsRow: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(229,231,235,0.7)",
    paddingTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  amountItem: {
    fontSize: 11,
  },
  amountMuted: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.dim,
  },
  amountStrong: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  cashoutError: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  cashedBanner: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(21,128,61,0.25)",
    backgroundColor: "rgba(21,128,61,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cashedBannerText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.win,
  },
  sectionCaps: {
    paddingHorizontal: 2,
    fontSize: 12.5,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: COLORS.mist,
  },
  legCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 14,
  },
  legCardWon: {
    borderColor: "rgba(21,128,61,0.35)",
  },
  legCardLost: {
    borderColor: "rgba(225,0,20,0.40)",
  },
  legTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legTopLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legLeagueText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
  },
  legTopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legDateText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  liveBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(225,0,20,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  legStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legStatusWon: {
    backgroundColor: "rgba(21,128,61,0.15)",
  },
  legStatusLost: {
    backgroundColor: "rgba(225,0,20,0.15)",
  },
  legStatusPending: {
    backgroundColor: COLORS.elev,
  },
  legStatusText: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  predTitle: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
    color: COLORS.ink,
  },
  pickRow: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  pickLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pickLabel: {
    flexShrink: 1,
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  marketBadge: {
    borderRadius: 6,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  marketBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.mist,
  },
  pickOddsBadge: {
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pickOddsText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
});
