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
  ChevronRight,
  Lock,
  Share2,
  Sparkles,
  TrendingUp,
} from "lucide-react-native";
import {
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
import { api, ApiHttpError, type UnifiedBet } from "@/lib/api";
import { getCachedUnifiedBet } from "@/lib/entity-cache";
import { eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { createIdempotencyKey } from "@/lib/http";
import { useParams, useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const POLL_LIVE_MS = 3_500;
const POLL_IDLE_MS = 6_000;

function parseSimpleParam(
  raw: string
): { kind: "sport" | "prediction"; id: number } | null {
  const m = /^(sport|pred)-(\d+)$/.exec(raw);
  if (m) {
    const id = Number(m[2]);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { kind: m[1] === "pred" ? "prediction" : "sport", id };
  }
  const num = Number(raw);
  if (Number.isInteger(num) && num > 0) {
    return { kind: "sport", id: num };
  }
  return null;
}

export default function SingleBetDetailScreen() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const parsed = useMemo(() => parseSimpleParam(params.id ?? ""), [params.id]);

  const { user, oddsFormat, setBalance, bumpBets, toast, hapticsEnabled } =
    useApp();

  const [prevKey, setPrevKey] = useState<string>(params.id ?? "");
  const [bet, setBet] = useState<UnifiedBet | null | undefined>(() =>
    parsed ? (getCachedUnifiedBet(parsed.kind, parsed.id) ?? undefined) : null
  );
  const [cashing, setCashing] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [sharingBet, setSharingBet] = useState<UnifiedBet | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cashoutKeyRef = useRef<{ expected: number; key: string } | null>(null);

  if ((params.id ?? "") !== prevKey) {
    setPrevKey(params.id ?? "");
    setBet(
      parsed ? (getCachedUnifiedBet(parsed.kind, parsed.id) ?? undefined) : null
    );
    setCashoutError(null);
  }

  const userId = user?.id ?? null;

  const fetchSingle = useCallback(async () => {
    if (!userId || !parsed) return;
    try {
      let r = await api.bets.byId(parsed.kind, parsed.id);
      if (!r.bet && !/^(sport|pred)-/i.test(params.id ?? "")) {
        r = await api.bets.byId(
          parsed.kind === "sport" ? "prediction" : "sport",
          parsed.id
        );
      }
      if (r.balance != null) setBalance(r.balance);
      setBet(r.bet);
    } catch {
      /* garde l'état courant */
    }
  }, [userId, parsed, params.id, setBalance]);

  const hasLive = Boolean(
    bet && bet.status === "pending" && bet.matchStatus === "live"
  );
  const shouldPoll = bet === undefined || bet?.status === "pending";

  useEffect(() => {
    if (!userId || !parsed) return;
    void fetchSingle();
  }, [userId, parsed, fetchSingle]);

  useEffect(() => {
    if (!userId || !parsed || !shouldPoll) return;
    const id = setInterval(
      () => void fetchSingle(),
      hasLive ? POLL_LIVE_MS : POLL_IDLE_MS
    );
    return () => clearInterval(id);
  }, [userId, parsed, fetchSingle, shouldPoll, hasLive]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSingle();
    setRefreshing(false);
  }, [fetchSingle]);

  const teams = useMemo(() => {
    if (!bet || bet.kind !== "sport") return null;
    if (bet.homeTeam && bet.awayTeam) {
      return {
        home: bet.homeTeam,
        away: bet.awayTeam,
        homeLogo: bet.homeLogo ?? null,
        awayLogo: bet.awayLogo ?? null,
      };
    }
    if (bet.title.includes("–")) {
      const [h, a] = bet.title.split("–").map((s) => s.trim());
      if (h && a) {
        return {
          home: h,
          away: a,
          homeLogo: bet.homeLogo ?? null,
          awayLogo: bet.awayLogo ?? null,
        };
      }
    }
    return null;
  }, [bet]);

  const showScores = Boolean(
    bet &&
      teams &&
      (bet.matchStatus === "live" || bet.matchStatus === "finished") &&
      bet.homeScore != null &&
      bet.awayScore != null
  );

  const eventHref = useMemo(() => {
    if (!bet) return null;
    if (bet.kind === "sport" && bet.matchId) {
      return bet.matchStatus === "finished"
        ? `/resultats/${bet.matchId}`
        : `/matchs/${bet.matchId}`;
    }
    if (bet.kind === "prediction" && bet.questionId) {
      return `/predictions/${bet.questionId}`;
    }
    return null;
  }, [bet]);

  const marketTag = bet ? shortMarketBadge(bet.market) : null;
  const canShare = Boolean(
    bet &&
      bet.status === "pending" &&
      ((bet.kind === "sport" && bet.matchId) ||
        (bet.kind === "prediction" && bet.questionId))
  );

  const handleCashOut = async () => {
    if (!bet || bet.cashOutValue == null || cashing) return;
    const expectedCashout = bet.cashOutValue;
    if (
      !cashoutKeyRef.current ||
      cashoutKeyRef.current.expected !== expectedCashout
    ) {
      cashoutKeyRef.current = {
        expected: expectedCashout,
        key: createIdempotencyKey(`cashout-${bet.kind}-${bet.id}`),
      };
    }
    const idempotencyKey = cashoutKeyRef.current.key;
    setCashing(true);
    setCashoutError(null);
    try {
      const r = await api.bets.cashout({
        betId: bet.id,
        kind: bet.kind,
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
      void fetchSingle();
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
        void fetchSingle();
        return;
      }
      const msg = e instanceof Error ? e.message : "Cash Out indisponible";
      setCashoutError(msg);
      toast({ kind: "error", title: "Vente refusée", description: msg });
    } finally {
      setCashing(false);
    }
  };

  if (!user) {
    return (
      <View style={[styles.page, styles.centerWrap]}>
        <View style={styles.authCard}>
          <Lock size={22} color={COLORS.betclicRed} strokeWidth={2.2} />
          <Text style={styles.authTitle}>Connexion requise</Text>
          <Text style={styles.authSub}>
            Connectez-vous pour consulter ce coupon de pari.
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
        {/* En-tête identique à src/app/(main)/paris/simple/[id]/page.tsx */}
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
            <Text style={styles.pageTitle}>
              {bet?.kind === "prediction" ? "Pari Prédiction" : "Pari Simple"}
            </Text>
          </View>

          {bet ? (
            <View style={styles.headerRight}>
              <StatusPill
                status={bet.status}
                live={bet.status === "pending" && bet.matchStatus === "live"}
                minute={bet.minute ?? bet.matchMinute}
                clockSource={
                  bet.status === "pending" && bet.matchStatus === "live"
                    ? {
                        matchId: bet.matchId,
                        status: "live",
                        minute: bet.minute ?? bet.matchMinute,
                        startsAt: bet.startsAt ?? bet.matchStartsAt,
                        source: bet.matchSource ?? null,
                        clockAnchor: bet.matchClockAnchor ?? null,
                      }
                    : null
                }
              />
              {canShare ? (
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
              <Text style={styles.notFoundTitle}>Pari introuvable</Text>
              <Text style={styles.notFoundSub}>
                Ce coupon simple n&apos;existe pas ou ne vous appartient pas.
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
                <View style={styles.cardMetaRow}>
                  <View style={styles.cardMetaLeft}>
                    {bet.kind === "prediction" ? (
                      <TrendingUp
                        size={14}
                        color={COLORS.betclicRed}
                        strokeWidth={2.2}
                      />
                    ) : (
                      <SportIcon
                        sport={bet.sport}
                        size={14}
                        color={COLORS.betclicRed}
                      />
                    )}
                    <Text numberOfLines={1} style={styles.subtitleText}>
                      {bet.subtitle}
                    </Text>
                  </View>
                  <Text style={styles.placedAtText}>
                    Placé · {formatPlacedAt(bet.placedAt)}
                  </Text>
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

              {/* Détail de la rencontre ou prédiction */}
              <Pressable
                disabled={!eventHref}
                onPress={eventHref ? () => router.push(eventHref) : undefined}
                style={({ pressed }) => [
                  styles.card,
                  eventHref && pressed ? { opacity: 0.9 } : null,
                ]}
              >
                <View style={styles.eventTopRow}>
                  <Text style={styles.sectionCaps}>
                    {bet.kind === "prediction"
                      ? "QUESTION DE PRÉDICTION"
                      : "RENCONTRE"}
                  </Text>

                  <View style={styles.eventBadgesRow}>
                    {bet.matchStatus === "live" ? (
                      <View style={styles.liveBadge}>
                        <View style={styles.liveDot} />
                        <LiveMatchClock
                          match={{
                            matchId: bet.matchId,
                            status: "live",
                            minute: bet.minute ?? bet.matchMinute,
                            startsAt: bet.startsAt ?? bet.matchStartsAt,
                            source: bet.matchSource ?? null,
                            clockAnchor: bet.matchClockAnchor ?? null,
                          }}
                          fallback={bet.minute ?? "LIVE"}
                          style={styles.liveBadgeText}
                        />
                      </View>
                    ) : null}
                    {bet.matchStatus === "upcoming" && bet.startsAt ? (
                      <View style={styles.kickoffBadge}>
                        <Text style={styles.kickoffBadgeText}>
                          {formatKickoff(bet.startsAt)}
                        </Text>
                      </View>
                    ) : null}
                    {bet.matchStatus === "finished" ? (
                      <View style={styles.finBadge}>
                        <Text style={styles.finBadgeText}>TERMINÉ</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  {teams ? (
                    <View style={{ gap: 8 }}>
                      <TicketTeamRow
                        name={teams.home}
                        logo={teams.homeLogo}
                        score={showScores ? (bet.homeScore ?? null) : null}
                        isLive={bet.matchStatus === "live"}
                      />
                      <TicketTeamRow
                        name={teams.away}
                        logo={teams.awayLogo}
                        score={showScores ? (bet.awayScore ?? null) : null}
                        isLive={bet.matchStatus === "live"}
                      />
                    </View>
                  ) : (
                    <Text style={styles.predQuestionTitle}>{bet.title}</Text>
                  )}
                </View>

                <View style={styles.pickRow}>
                  <View style={styles.pickLeft}>
                    <Text numberOfLines={1} style={styles.pickLabel}>
                      {bet.selectionLabel}
                    </Text>
                    {marketTag ? (
                      <View style={styles.marketBadge}>
                        <Text style={styles.marketBadgeText}>{marketTag}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.pickOddsBadge}>
                    <Text style={styles.pickOddsText}>
                      {formatOdds(bet.odds, oddsFormat)}
                    </Text>
                  </View>
                </View>

                {eventHref ? (
                  <View style={styles.eventLinkBtn}>
                    <Text style={styles.eventLinkText}>
                      {bet.kind === "prediction"
                        ? "Ouvrir la prédiction"
                        : bet.matchStatus === "finished"
                          ? "Voir le bilan du match"
                          : "Ouvrir la fiche du match"}
                    </Text>
                    <ChevronRight
                      size={16}
                      color={COLORS.ink}
                      strokeWidth={2.3}
                    />
                  </View>
                ) : null}
              </Pressable>
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
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.3,
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
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardMetaLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  subtitleText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mist,
  },
  placedAtText: {
    fontSize: 11,
    color: COLORS.dim,
  },
  amountsRow: {
    marginTop: 12,
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
  eventTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionCaps: {
    fontSize: 12.5,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: COLORS.mist,
  },
  eventBadgesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  kickoffBadge: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  kickoffBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  finBadge: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  finBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.mist,
  },
  predQuestionTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    color: COLORS.ink,
  },
  pickRow: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    fontSize: 13.5,
    fontWeight: "700",
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
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  eventLinkBtn: {
    marginTop: 12,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eventLinkText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
});
