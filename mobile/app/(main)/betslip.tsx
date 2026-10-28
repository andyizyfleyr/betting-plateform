import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Flame,
  Hash,
  Layers,
  Trash2,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react-native";
import { CouponCodeBox } from "@/components/coupon-code-box";
import { LiveMatchClock } from "@/components/live-match-clock";
import { OddsLockControls } from "@/components/odds-lock-controls";
import { mergeSlimIntoMobileMatch } from "@/lib/query-client";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { TeamAvatar } from "@/components/team-avatar";
import { TouchStakePad } from "@/components/touch-stake-pad";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  type ClientMatch,
  type ClientPrediction,
  type OddsChangedDetails,
  type OddsLockPolicy,
} from "@/lib/api";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  MIN_ELIGIBLE_BOOST_ODDS,
  nextBoostHint,
} from "@/lib/combo-math";
import { eur, formatKickoff, formatOdds } from "@/lib/format";
import { createIdempotencyKey } from "@/lib/http";
import { useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const LIVE_ODDS_POLL_MS = 2_500;

function LegLiveOddsBadge({
  odds,
  oddsFormat,
}: {
  odds: number;
  oddsFormat: "decimal" | "fractional";
}) {
  const trend = useOddsTrend(odds);
  return (
    <View style={styles.legOddsBadge}>
      <OddsTrendCorner trend={trend} />
      <Text
        style={[
          styles.legOddsText,
          { color: oddsTrendTextColor(trend, false, COLORS.ink) },
        ]}
      >
        {formatOdds(odds, oddsFormat)}
      </Text>
    </View>
  );
}

export default function BetslipScreen() {
  const router = useRouter();
  const {
    authReady,
    sessionRestoring,
    user,
    balance,
    setBalance,
    oddsFormat,
    oddsPolicy,
    setOddsPolicy,
    comboLegs,
    removeComboLeg,
    clearCombo,
    applyComboOddsUpdates,
    openMarkets,
    openRecharge,
    bumpBets,
    toast,
    hapticsEnabled,
    feedMatches,
  } = useApp();

  const [stakeText, setStakeText] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(
    null
  );
  const [legOverrides, setLegOverrides] = useState<{
    until: number;
    byUid: Record<string, number>;
  } | null>(null);
  const [matchesMap, setMatchesMap] = useState<Record<number, ClientMatch>>({});
  const [predsMap, setPredsMap] = useState<Record<number, ClientPrediction>>(
    {}
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [receipt, setReceipt] = useState<{
    kind: "single" | "combo";
    count: number;
    totalOdds: number;
    stake: number;
    potentialWin: number;
    boostPct: number;
  } | null>(null);
  const [mobileCouponOpen, setMobileCouponOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

  const hasPredLegs = comboLegs.some((l) => l.kind === "prediction");
  const sportMatchIdsKey = useMemo(
    () =>
      [
        ...new Set(
          comboLegs
            .filter((l) => l.kind === "sport" && l.matchId != null)
            .map((l) => l.matchId as number)
        ),
      ]
        .sort((a, b) => a - b)
        .join(","),
    [comboLegs]
  );

  useEffect(() => {
    if (!feedMatches) return;
    setMatchesMap((prev) => {
      const next = { ...prev };
      for (const m of feedMatches) {
        const existing = next[m.id];
        next[m.id] = existing ? mergeSlimIntoMobileMatch(existing, m) : m;
      }
      return next;
    });
  }, [feedMatches]);

  const refreshLiveOdds = useCallback(
    async (forceRefresh = false) => {
      const matchIds = sportMatchIdsKey
        ? sportMatchIdsKey.split(",").map(Number)
        : [];
      if (matchIds.length === 0 && !hasPredLegs) return;
      try {
        const [detailResults, predsRes] = await Promise.all([
          Promise.all(
            matchIds.map((id) =>
              api.matchById(id, { forceRefresh }).catch(() => null)
            )
          ),
          hasPredLegs
            ? api.predictionsCatalog({ forceRefresh }).catch(() => null)
            : Promise.resolve(null),
        ]);
        setNowMs(Date.now());
        const nextDetails: Record<number, ClientMatch> = {};
        for (const r of detailResults) {
          if (r?.match) nextDetails[r.match.id] = r.match;
        }
        if (Object.keys(nextDetails).length > 0) {
          setMatchesMap((prev) => ({ ...prev, ...nextDetails }));
        }
        if (predsRes) {
          const pMap: Record<number, ClientPrediction> = {};
          for (const q of predsRes.questions) pMap[q.id] = q;
          setPredsMap(pMap);
        }
      } catch {
        /* silencieux */
      }
    },
    [hasPredLegs, sportMatchIdsKey]
  );

  useEffect(() => {
    if (comboLegs.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshLiveOdds(false);
    };
    void tick();
    const id = setInterval(() => void tick(), LIVE_ODDS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [comboLegs.length, refreshLiveOdds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshLiveOdds(true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshLiveOdds]);

  const enrichedLegs = useMemo(() => {
    const activeOverrides =
      legOverrides && legOverrides.until > nowMs ? legOverrides.byUid : null;

    const mapped = comboLegs.map((leg) => {
      if (leg.kind === "sport" && leg.matchId) {
        const m = matchesMap[leg.matchId];
        if (!m) {
          return {
            ...leg,
            liveOdds: activeOverrides?.[leg.uid] ?? leg.odds,
            suspended: false,
            closed: false,
            matchObj: null as ClientMatch | null,
          };
        }
        const closed = m.status === "finished";
        const suspended = Boolean(m.suspended || m.kickoffReached);
        let liveOdds = leg.odds;
        const grp = m.markets?.find(
          (g) =>
            g.key === leg.market || (leg.market === "result" && g.key === "1x2")
        );
        let out = grp?.outcomes.find((o) => o.key === leg.selection);
        if (!out && grp?.rows) {
          for (const r of grp.rows) {
            const hit = r.outcomes.find((o) => o.key === leg.selection);
            if (hit) {
              out = hit;
              break;
            }
          }
        }
        if (out) {
          liveOdds = out.odds;
        } else if (leg.market === "result" || leg.market === "1x2") {
          liveOdds =
            leg.selection === "home" || leg.selection === "V1"
              ? m.oddsHome
              : leg.selection === "draw" || leg.selection === "X"
                ? (m.oddsDraw ?? leg.odds)
                : m.oddsAway;
        }
        if (activeOverrides?.[leg.uid] != null) {
          liveOdds = activeOverrides[leg.uid];
        }
        return {
          ...leg,
          liveOdds,
          suspended,
          closed,
          isLive: m.status === "live",
          startsAt: m.startsAt,
          matchObj: m,
        };
      }

      if (leg.kind === "prediction" && leg.questionId) {
        const q = predsMap[leg.questionId];
        if (!q) {
          return {
            ...leg,
            liveOdds: activeOverrides?.[leg.uid] ?? leg.odds,
            suspended: false,
            closed: false,
            matchObj: null as ClientMatch | null,
          };
        }
        const closed =
          q.status !== "open" || new Date(q.resolvesAt).getTime() <= nowMs;
        let liveOdds = leg.odds;
        if (leg.market === "multichoice" && Array.isArray(q.options)) {
          const opt = q.options.find((o) => o.key === leg.selection);
          if (opt) liveOdds = opt.odds;
        } else {
          liveOdds = leg.selection === "yes" ? q.oddsYes : q.oddsNo;
        }
        if (activeOverrides?.[leg.uid] != null) {
          liveOdds = activeOverrides[leg.uid];
        }
        return {
          ...leg,
          liveOdds,
          suspended: false,
          closed,
          startsAt: q.resolvesAt,
          matchObj: null as ClientMatch | null,
        };
      }

      return {
        ...leg,
        liveOdds: activeOverrides?.[leg.uid] ?? leg.odds,
        suspended: false,
        closed: false,
        matchObj: null as ClientMatch | null,
      };
    });

    return mapped.sort((a, b) => {
      const aLive = a.isLive ? 0 : 1;
      const bLive = b.isLive ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const aTime = a.startsAt
        ? new Date(a.startsAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const bTime = b.startsAt
        ? new Date(b.startsAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, [comboLegs, matchesMap, predsMap, nowMs, legOverrides]);

  const rawStake = Number(stakeText.replace(",", "."));
  const stake = Number.isFinite(rawStake) && rawStake > 0 ? rawStake : 0;

  const isCombo = enrichedLegs.length >= 2;

  const quote = useMemo(() => {
    if (!isCombo) {
      const singleOdds = enrichedLegs[0]?.liveOdds ?? 1;
      return {
        legCount: enrichedLegs.length,
        eligibleLegs: singleOdds >= MIN_ELIGIBLE_BOOST_ODDS ? 1 : 0,
        rawOdds: singleOdds,
        boostPct: 0,
        totalOdds: singleOdds,
        baseWin: Math.round(stake * singleOdds * 100) / 100,
        boostAmount: 0,
        potentialWin: Math.round(stake * singleOdds * 100) / 100,
      };
    }
    return computeComboQuote(
      enrichedLegs.map((l) => l.liveOdds),
      stake
    );
  }, [enrichedLegs, isCombo, stake]);

  const nextBoost = isCombo ? nextBoostHint(quote.eligibleLegs) : null;
  const hasClosedLeg = enrichedLegs.some((l) => l.closed);
  const hasSuspendedLeg = enrichedLegs.some((l) => l.suspended);

  const hasMixedSources = useMemo(() => {
    const sources = new Set<"manual" | "virtual">();
    for (const leg of enrichedLegs) {
      if (leg.kind !== "sport") continue;
      const src = leg.matchObj?.source ?? leg.matchSource;
      if (src === "manual" || src === "virtual") sources.add(src);
    }
    return sources.size > 1;
  }, [enrichedLegs]);

  const overBalance = Boolean(user) && stake > balance;
  const belowMin = stake > 0 && stake < 0.5;
  const canSubmit =
    enrichedLegs.length >= 1 &&
    !hasClosedLeg &&
    !hasSuspendedLeg &&
    !hasMixedSources &&
    stake >= 0.5 &&
    !overBalance &&
    !submitting;

  const submitSlip = async () => {
    if (!canSubmit || inFlightRef.current) return;
    if ((!authReady || sessionRestoring) && !user) return;
    if (!user) {
      toast({
        kind: "info",
        title: "Connectez-vous pour valider votre coupon",
      });
      router.push("/auth");
      return;
    }

    const fingerprint = `${enrichedLegs
      .map((l) => `${l.uid}:${l.market}:${l.selection}:${l.liveOdds}`)
      .join("|")}|${stake}|${quote.totalOdds}|${oddsPolicy}`;
    if (
      !idempotencySlotRef.current ||
      idempotencySlotRef.current.fingerprint !== fingerprint
    ) {
      idempotencySlotRef.current = {
        fingerprint,
        key: createIdempotencyKey("slip"),
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      if (enrichedLegs.length === 1) {
        const leg = enrichedLegs[0];
        if (leg.kind === "sport" && leg.matchId) {
          const res = await api.bets.placeSingle({
            matchId: leg.matchId,
            selection: leg.selection,
            market: leg.market,
            stake,
            expectedOdds: leg.liveOdds,
            oddsPolicy,
            idempotencyKey,
          });
          idempotencySlotRef.current = null;
          setOddsChanged(null);
          setLegOverrides(null);
          setBalance(res.balance);
          bumpBets();
          triggerHaptic("success", hapticsEnabled);
          setReceipt({
            kind: "single",
            count: 1,
            totalOdds: res.bet.odds,
            stake: res.bet.stake,
            potentialWin: res.bet.potentialWin,
            boostPct: 0,
          });
          clearCombo();
        } else if (leg.kind === "prediction" && leg.questionId) {
          const res = await api.predictions.place({
            questionId: leg.questionId,
            selection: leg.selection,
            stake,
            expectedOdds: leg.liveOdds,
            oddsPolicy,
            idempotencyKey,
          });
          idempotencySlotRef.current = null;
          setOddsChanged(null);
          setLegOverrides(null);
          setBalance(res.balance);
          bumpBets();
          triggerHaptic("success", hapticsEnabled);
          setReceipt({
            kind: "single",
            count: 1,
            totalOdds: res.bet.odds,
            stake: res.bet.stake,
            potentialWin: res.bet.potentialWin,
            boostPct: 0,
          });
          clearCombo();
        }
      } else {
        const res = await api.bets.placeCombo({
          legs: enrichedLegs.map((l) => ({
            kind: l.kind,
            ...(l.matchId ? { matchId: l.matchId } : {}),
            ...(l.questionId ? { questionId: l.questionId } : {}),
            market: l.market,
            selection: l.selection,
            expectedOdds: l.liveOdds,
          })),
          stake,
          expectedTotalOdds: quote.totalOdds,
          oddsPolicy,
          idempotencyKey,
        });
        idempotencySlotRef.current = null;
        setOddsChanged(null);
        setLegOverrides(null);
        setBalance(res.balance);
        bumpBets();
        triggerHaptic("success", hapticsEnabled);
        setReceipt({
          kind: "combo",
          count: enrichedLegs.length,
          totalOdds: res.bet.totalOdds,
          stake: res.bet.stake,
          potentialWin: res.bet.potentialWin,
          boostPct: res.bet.boostPct,
        });
        clearCombo();
      }
    } catch (e) {
      if (e instanceof ApiHttpError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      if (
        e instanceof ApiHttpError &&
        e.status === 409 &&
        e.code === "ODDS_CHANGED" &&
        e.details
      ) {
        setOddsChanged(e.details);
        setNowMs(Date.now());
        if (e.details.updatedLegs && e.details.updatedLegs.length > 0) {
          applyComboOddsUpdates(e.details.updatedLegs);
          const byUid: Record<string, number> = {};
          for (const u of e.details.updatedLegs) {
            const uid =
              u.kind === "sport"
                ? `sport-${u.matchId}`
                : `pred-${u.questionId}`;
            byUid[uid] = u.currentOdds;
          }
          setLegOverrides({ until: Date.now() + 10_000, byUid });
        } else if (enrichedLegs.length === 1) {
          const single = enrichedLegs[0];
          applyComboOddsUpdates([
            {
              kind: single.kind,
              matchId: single.matchId,
              questionId: single.questionId,
              market: single.market,
              selection: single.selection,
              previousOdds: e.details.previousOdds,
              currentOdds: e.details.currentOdds,
              direction: e.details.direction,
            },
          ]);
          setLegOverrides({
            until: Date.now() + 10_000,
            byUid: { [single.uid]: e.details.currentOdds },
          });
        }
        triggerHaptic("warning", hapticsEnabled);
        return;
      }
      setOddsChanged(null);
      const msg =
        e instanceof Error ? e.message : "Validation du coupon impossible";
      setError(msg);
      toast({ kind: "error", title: "Coupon refusé", description: msg });
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  if (receipt && comboLegs.length === 0) {
    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.receiptScroll}
      >
        <View style={styles.receiptCard}>
          <View style={styles.receiptIconCircle}>
            <Check size={28} color={COLORS.win} strokeWidth={2.6} />
          </View>
          <Text style={styles.receiptTitle}>Coupon validé !</Text>
          <Text style={styles.receiptSub}>
            {receipt.kind === "combo"
              ? `Pari combiné (${receipt.count} sélections)`
              : "Pari simple enregistré"}
          </Text>

          <View style={styles.receiptSummaryGrid}>
            <View style={styles.receiptStatCol}>
              <Text style={styles.receiptStatLabel}>Mise</Text>
              <Text style={styles.receiptStatValue}>{eur(receipt.stake)}</Text>
            </View>
            <View style={styles.receiptStatCol}>
              <Text style={styles.receiptStatLabel}>Cote totale</Text>
              <Text
                style={[styles.receiptStatValue, { color: COLORS.betclicRed }]}
              >
                {formatOdds(receipt.totalOdds, oddsFormat)}
              </Text>
            </View>
            <View style={styles.receiptStatCol}>
              <Text style={styles.receiptStatLabel}>Gain max</Text>
              <Text style={[styles.receiptStatValue, { color: COLORS.win }]}>
                {eur(receipt.potentialWin)}
              </Text>
            </View>
          </View>

          <View style={styles.receiptActions}>
            <Pressable
              onPress={() => {
                setReceipt(null);
                router.push("/matchs");
              }}
              style={styles.receiptSecondaryBtn}
            >
              <Text style={styles.receiptSecondaryText}>Continuer</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setReceipt(null);
                router.push("/paris");
              }}
              style={styles.receiptPrimaryBtn}
            >
              <Text style={styles.receiptPrimaryText}>Mes paris</Text>
              <ArrowRight size={16} color="#ffffff" strokeWidth={2.3} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.betclicRed}
            colors={[COLORS.betclicRed]}
          />
        }
      >
        {/* En-tête identique à src/app/(main)/betslip/page.tsx */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.pageTitle}>Coupon de pari</Text>
            {enrichedLegs.length > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {enrichedLegs.length}/{MAX_COMBO_LEGS}
                </Text>
              </View>
            ) : null}
          </View>

          {enrichedLegs.length > 0 ? (
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => setMobileCouponOpen((o) => !o)}
                style={[
                  styles.actionPill,
                  mobileCouponOpen && styles.actionPillActive,
                ]}
              >
                <Hash
                  size={14}
                  color={COLORS.betclicRed}
                  strokeWidth={2.4}
                />
                <Text
                  style={[
                    styles.actionPillText,
                    mobileCouponOpen && { color: "#ffffff" },
                  ]}
                >
                  Code coupon
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  clearCombo();
                  setError(null);
                }}
                style={styles.clearPill}
              >
                <Trash2 size={14} color={COLORS.mist} strokeWidth={2.1} />
                <Text style={styles.clearPillText}>Vider</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {enrichedLegs.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconBox}>
              <Layers size={24} color={COLORS.betclicRed} strokeWidth={2.1} />
            </View>
            <Text style={styles.emptyTitle}>
              Votre coupon de pari est vide
            </Text>
            <Text style={styles.emptySub}>
              Faites un{" "}
              <Text style={{ fontWeight: "500", color: COLORS.ink }}>
                appui long
              </Text>{" "}
              sur n&apos;importe quelle cote dans Matchs ou Prédictions pour
              l&apos;ajouter à votre coupon combiné.
            </Text>

            <View style={styles.emptyBtnsGrid}>
              <Pressable
                onPress={() => router.push("/matchs")}
                style={styles.emptyPrimaryBtn}
              >
                <Trophy size={16} color="#ffffff" strokeWidth={2.2} />
                <Text style={styles.emptyPrimaryText}>Matchs</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/predictions")}
                style={styles.emptySecondaryBtn}
              >
                <TrendingUp
                  size={16}
                  color={COLORS.betclicRed}
                  strokeWidth={2.2}
                />
                <Text style={styles.emptySecondaryText}>Prédictions</Text>
              </Pressable>
            </View>

            <View style={{ width: "100%", marginTop: 16 }}>
              <CouponCodeBox variant="empty" autoCheckUrlCode />
            </View>
          </View>
        ) : (
          <View style={styles.legsWrap}>
            {mobileCouponOpen ? (
              <CouponCodeBox variant="compact" autoCheckUrlCode />
            ) : null}

            {/* Jauge Bonus Combiné */}
            {isCombo ? (
              <View style={styles.boostCard}>
                <View style={styles.boostTopRow}>
                  <View style={styles.boostTitleWrap}>
                    <Flame
                      size={14}
                      color={COLORS.betclicRed}
                      strokeWidth={2.4}
                    />
                    <Text style={styles.boostTitleText}>
                      {quote.boostPct > 0
                        ? `Bonus Combiné actif : +${quote.boostPct}%`
                        : "Bonus Combiné jusqu'à +20%"}
                    </Text>
                  </View>
                  {nextBoost ? (
                    <Text style={styles.boostHintText}>
                      +{nextBoost.needed} cote{nextBoost.needed > 1 ? "s" : ""}{" "}
                      (≥{MIN_ELIGIBLE_BOOST_ODDS}) → +{nextBoost.pct}%
                    </Text>
                  ) : (
                    <Text style={styles.boostMaxText}>Palier max atteint</Text>
                  )}
                </View>
                <View style={styles.boostTrack}>
                  <View
                    style={[
                      styles.boostFill,
                      {
                        width: `${Math.min(100, (quote.eligibleLegs / 8) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            {/* Liste des sélections */}
            <View style={styles.legsStack}>
              {enrichedLegs.map((leg) => {
                const splitTeams =
                  leg.kind === "sport" &&
                  (!leg.homeTeam || !leg.awayTeam) &&
                  leg.title.includes("–")
                    ? leg.title.split("–").map((s) => s.trim())
                    : null;
                const hName =
                  leg.matchObj?.homeTeam ||
                  leg.homeTeam ||
                  splitTeams?.[0] ||
                  "";
                const aName =
                  leg.matchObj?.awayTeam ||
                  leg.awayTeam ||
                  splitTeams?.[1] ||
                  "";
                const hasSportTeams =
                  leg.kind === "sport" && Boolean(hName && aName);
                const showScores =
                  hasSportTeams &&
                  leg.matchObj != null &&
                  (leg.isLive || leg.matchObj.status === "finished") &&
                  leg.matchObj.homeScore != null &&
                  leg.matchObj.awayScore != null;

                const sportMatchId = leg.matchObj?.id ?? leg.matchId;
                const legHref =
                  leg.kind === "sport" && sportMatchId
                    ? leg.matchObj?.status === "finished"
                      ? `/resultats/${sportMatchId}`
                      : `/matchs/${sportMatchId}`
                    : leg.kind === "prediction" && leg.questionId
                      ? `/predictions/${leg.questionId}`
                      : "/predictions";

                return (
                  <Pressable
                    key={leg.uid}
                    onPress={() => router.push(legHref)}
                    style={({ pressed }) => [
                      styles.legCard,
                      leg.closed && styles.legCardClosed,
                      pressed && { opacity: 0.94 },
                    ]}
                  >
                    <View style={styles.legTopRow}>
                      <View style={styles.legMetaLeft}>
                        <Text numberOfLines={1} style={styles.legLeague}>
                          {leg.league}
                        </Text>
                        {leg.isLive ? (
                          <View style={styles.livePill}>
                            <View style={styles.liveDot} />
                            <LiveMatchClock
                              match={
                                leg.matchObj ?? {
                                  matchId: leg.matchId,
                                  status: "live",
                                  startsAt: leg.startsAt,
                                  source: leg.matchSource,
                                }
                              }
                              fallback={leg.matchObj?.minute ?? "LIVE"}
                              style={styles.livePillText}
                            />
                          </View>
                        ) : null}
                        {!leg.isLive && !leg.closed && leg.startsAt ? (
                          <View style={styles.kickoffPill}>
                            <Text style={styles.kickoffPillText}>
                              {formatKickoff(leg.startsAt)}
                            </Text>
                          </View>
                        ) : null}
                        {leg.closed ? (
                          <View style={styles.closedPill}>
                            <Text style={styles.closedPillText}>Clôturé</Text>
                          </View>
                        ) : null}
                        {leg.suspended && !leg.closed ? (
                          <View style={styles.suspendedPill}>
                            <Text style={styles.suspendedPillText}>
                              Suspendu
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Pressable
                        hitSlop={8}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          removeComboLeg(leg.uid);
                        }}
                        style={styles.removeLegBtn}
                      >
                        <X size={14} color={COLORS.mist} strokeWidth={2.2} />
                      </Pressable>
                    </View>

                    <View style={{ marginTop: 10 }}>
                      {hasSportTeams ? (
                        <View style={{ gap: 6 }}>
                          <View style={styles.teamRow}>
                            <TeamAvatar
                              name={hName}
                              logo={leg.matchObj?.homeLogo ?? leg.homeLogo}
                              size="xs"
                            />
                            <Text numberOfLines={1} style={styles.teamName}>
                              {hName}
                            </Text>
                            {showScores ? (
                              <View
                                style={[
                                  styles.scoreBox,
                                  leg.isLive
                                    ? styles.scoreBoxLive
                                    : styles.scoreBoxDefault,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.scoreBoxText,
                                    leg.isLive && { color: COLORS.betclicRed },
                                  ]}
                                >
                                  {leg.matchObj!.homeScore}
                                </Text>
                              </View>
                            ) : null}
                          </View>

                          <View style={styles.teamRow}>
                            <TeamAvatar
                              name={aName}
                              logo={leg.matchObj?.awayLogo ?? leg.awayLogo}
                              size="xs"
                            />
                            <Text numberOfLines={1} style={styles.teamName}>
                              {aName}
                            </Text>
                            {showScores ? (
                              <View
                                style={[
                                  styles.scoreBox,
                                  leg.isLive
                                    ? styles.scoreBoxLive
                                    : styles.scoreBoxDefault,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.scoreBoxText,
                                    leg.isLive && { color: COLORS.betclicRed },
                                  ]}
                                >
                                  {leg.matchObj!.awayScore}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.predTitle}>{leg.title}</Text>
                      )}

                      <View style={styles.selectionBar}>
                        <Text
                          numberOfLines={1}
                          style={styles.selectionLabelText}
                        >
                          {leg.selectionLabel}
                        </Text>
                        <LegLiveOddsBadge
                          odds={leg.liveOdds}
                          oddsFormat={oddsFormat}
                        />
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Barre collante juste au-dessus de la BottomNav (identique à src/app/(main)/betslip/page.tsx) */}
      {enrichedLegs.length > 0 ? (
        <View style={styles.stickyDock}>
          <TouchStakePad
            label="Votre mise"
            stakeText={stakeText}
            onChangeStakeText={(next) => {
              setStakeText(next);
              setError(null);
            }}
            balance={balance}
            hasError={overBalance || belowMin}
            collapsibleOnMobile
            defaultExpandedOnMobile={false}
          />

          <View style={styles.summarySection}>
            <View style={styles.summaryLine}>
              <Text style={styles.summaryMuted}>
                {isCombo ? "Cote totale" : "Cote"}
              </Text>
              <Text style={styles.summaryOddsVal}>
                {formatOdds(quote.totalOdds, oddsFormat)}
              </Text>
            </View>

            {quote.boostAmount > 0 ? (
              <View style={styles.summaryLine}>
                <Text style={{ fontSize: 11, color: COLORS.win }}>
                  Bonus Combiné (+{quote.boostPct}%)
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "500",
                    color: COLORS.win,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  +{eur(quote.boostAmount)}
                </Text>
              </View>
            ) : null}

            <View style={[styles.summaryLine, { paddingTop: 2 }]}>
              <Text style={styles.potentialLabel}>Gain potentiel</Text>
              <Text style={styles.potentialValue}>
                {eur(quote.potentialWin)}
              </Text>
            </View>
          </View>

          {hasMixedSources ? (
            <View style={styles.redAlertBox}>
              <AlertTriangle
                size={15}
                color={COLORS.betclicRed}
                strokeWidth={2.2}
              />
              <Text style={styles.redAlertText}>
                Impossible de mélanger des matchs réels et des matchs virtuels
                dans un même coupon.
              </Text>
            </View>
          ) : null}

          {hasClosedLeg ? (
            <View style={styles.redAlertBox}>
              <AlertTriangle
                size={15}
                color={COLORS.betclicRed}
                strokeWidth={2.2}
              />
              <Text style={styles.redAlertText}>
                Retirez la sélection clôturée pour valider votre coupon.
              </Text>
            </View>
          ) : null}

          {hasSuspendedLeg && !hasClosedLeg ? (
            <View style={styles.amberAlertBox}>
              <AlertTriangle size={15} color="#92400e" strokeWidth={2.2} />
              <Text style={styles.amberAlertText}>
                Une sélection est temporairement suspendue (coup d&apos;envoi ou
                action live).
              </Text>
            </View>
          ) : null}

          {belowMin ? (
            <Text style={styles.inlineRedError}>
              La mise minimale est de 0,50 €.
            </Text>
          ) : null}

          {overBalance ? (
            <View style={styles.overBalanceRow}>
              <Text style={styles.inlineRedError}>Solde insuffisant</Text>
              <Pressable onPress={openRecharge}>
                <Text style={styles.rechargeLink}>Recharger</Text>
              </Pressable>
            </View>
          ) : null}

          <OddsLockControls
            feedKind={
              enrichedLegs.every((l) => l.kind === "prediction")
                ? "predictions"
                : "matches"
            }
            oddsFormat={oddsFormat}
            oddsPolicy={oddsPolicy}
            onChangePolicy={setOddsPolicy}
            oddsChanged={oddsChanged}
          />

          {error && !overBalance ? (
            <Text style={styles.inlineRedError}>{error}</Text>
          ) : null}

          <Pressable
            disabled={!canSubmit}
            onPress={submitSlip}
            style={({ pressed }) => [
              styles.submitBtn,
              !canSubmit && { opacity: 0.45 },
              pressed && canSubmit && { transform: [{ scale: 0.985 }] },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.submitBtnText}>
                {oddsChanged
                  ? `Accepter la nouvelle cote (${formatOdds(quote.totalOdds, oddsFormat)})`
                  : isCombo
                    ? `Placer le combiné · ${eur(stake)}`
                    : `Placer le pari · ${eur(stake)}`}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 16,
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
    gap: 8,
  },
  pageTitle: {
    fontSize: 14.5,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  countBadge: {
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: "500",
    color: "#ffffff",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionPill: {
    height: 32,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionPillActive: {
    backgroundColor: COLORS.ink,
  },
  actionPillText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  clearPill: {
    height: 32,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  clearPillText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  emptyCard: {
    marginTop: 32,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 24,
    alignItems: "center",
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(225,0,20,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    marginTop: 14,
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
  },
  emptySub: {
    marginTop: 6,
    maxWidth: 290,
    fontSize: 11,
    lineHeight: 18,
    color: COLORS.mist,
    textAlign: "center",
  },
  emptyBtnsGrid: {
    marginTop: 20,
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },
  emptyPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyPrimaryText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  emptySecondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptySecondaryText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  legsWrap: {
    marginTop: 12,
    gap: 10,
  },
  boostCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  boostTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  boostTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  boostTitleText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  boostHintText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  boostMaxText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.win,
  },
  boostTrack: {
    marginTop: 8,
    height: 6,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    overflow: "hidden",
  },
  boostFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
  },
  legsStack: {
    gap: 10,
  },
  legCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  legCardClosed: {
    borderColor: "rgba(225,0,20,0.40)",
    backgroundColor: "rgba(225,0,20,0.04)",
  },
  legTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legMetaLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legLeague: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  livePill: {
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
  livePillText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  kickoffPill: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  kickoffPillText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  closedPill: {
    borderRadius: 999,
    backgroundColor: "rgba(225,0,20,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  closedPillText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  suspendedPill: {
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  suspendedPillText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#b45309",
  },
  removeLegBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  teamName: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  scoreBox: {
    minWidth: 22,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: "center",
  },
  scoreBoxDefault: {
    backgroundColor: COLORS.elev,
  },
  scoreBoxLive: {
    backgroundColor: "rgba(225,0,20,0.10)",
  },
  scoreBoxText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  predTitle: {
    fontSize: 11.5,
    fontWeight: "600",
    lineHeight: 19,
    color: COLORS.ink,
  },
  selectionBar: {
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
  selectionLabelText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  legOddsBadge: {
    position: "relative",
    minWidth: 52,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  legOddsText: {
    fontSize: 11.5,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  stickyDock: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.edge,
    backgroundColor: "rgba(255,255,255,0.98)",
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
    shadowColor: "#111827",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  summarySection: {
    borderTopWidth: 1,
    borderTopColor: COLORS.edge,
    paddingTop: 10,
    gap: 6,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryMuted: {
    fontSize: 11,
    color: COLORS.mist,
  },
  summaryOddsVal: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  potentialLabel: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  potentialValue: {
    fontSize: 13.5,
    fontWeight: "500",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
  redAlertBox: {
    borderRadius: 12,
    backgroundColor: "rgba(225,0,20,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  redAlertText: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  amberAlertBox: {
    borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  amberAlertText: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: "500",
    color: "#92400e",
  },
  inlineRedError: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  overBalanceRow: {
    borderRadius: 12,
    backgroundColor: "rgba(225,0,20,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rechargeLink: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
    textDecorationLine: "underline",
  },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#ffffff",
  },
  receiptScroll: {
    paddingHorizontal: 8,
    paddingTop: 24,
    paddingBottom: 32,
  },
  receiptCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 20,
    alignItems: "center",
  },
  receiptIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(21,128,61,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptTitle: {
    marginTop: 12,
    fontSize: 14.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  receiptSub: {
    marginTop: 4,
    fontSize: 11,
    color: COLORS.mist,
  },
  receiptSummaryGrid: {
    marginTop: 16,
    width: "100%",
    borderRadius: 16,
    backgroundColor: COLORS.elev,
    padding: 12,
    flexDirection: "row",
    gap: 8,
  },
  receiptStatCol: {
    flex: 1,
    alignItems: "center",
  },
  receiptStatLabel: {
    fontSize: 10,
    color: COLORS.dim,
  },
  receiptStatValue: {
    marginTop: 2,
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  receiptActions: {
    marginTop: 20,
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },
  receiptSecondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptSecondaryText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  receiptPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  receiptPrimaryText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
});
