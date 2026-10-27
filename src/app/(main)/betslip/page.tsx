"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Flame,
  Hash,
  Layers,
  Loader2,
  Trash2,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import {
  ApiRequestError,
  api,
  type ClientMatch,
  type ClientPrediction,
} from "@/lib/api";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  MIN_ELIGIBLE_BOOST_ODDS,
  nextComboBoostTier,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { CardOverlayLink } from "@/components/card-overlay-link";
import { LiveMatchClock } from "@/components/live-match-clock";
import {
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/odds-lock";
import { AnimatedNumber } from "@/components/animated-number";
import { CouponCodeBox } from "@/components/coupon-code-box";
import { OddsLockControls } from "@/components/odds-lock-controls";
import {
  OddsTrendCorner,
  oddsTrendTextClass,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { TeamAvatar } from "@/components/team-avatar";
import { TouchStakePad } from "@/components/touch-stake-pad";
import { useApp } from "@/components/providers";
import { cn, eur, formatKickoff, formatOdds } from "@/lib/format";

function LegLiveOddsBadge({
  odds,
  oddsFormat,
}: {
  odds: number;
  oddsFormat: "decimal" | "fractional";
}) {
  const trend = useOddsTrend(odds);
  return (
    <span
      className={cn(
        "relative shrink-0 rounded-lg bg-white px-2.5 py-1 font-display text-[13.5px] font-bold tabular-nums shadow-2xs transition-colors duration-200",
        oddsTrendTextClass(trend)
      )}
    >
      <OddsTrendCorner trend={trend} />
      {formatOdds(odds, oddsFormat)}
    </span>
  );
}

interface PlacedReceipt {
  kind: "single" | "combo";
  count: number;
  totalOdds: number;
  stake: number;
  potentialWin: number;
  boostPct: number;
}

export default function BetslipPage() {
  const router = useRouter();
  const {
    comboLegs,
    removeComboLeg,
    clearCombo,
    applyComboOddsUpdates,
    oddsPolicy,
    setOddsPolicy,
    openMarkets,
    balance,
    setBalance,
    bumpBets,
    openRecharge,
    oddsFormat,
    toast,
    user,
  } = useApp();

  const [liveMatches, setLiveMatches] = useState<ClientMatch[]>([]);
  const [livePredictions, setLivePredictions] = useState<ClientPrediction[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [stakeText, setStakeText] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(null);
  const [legOverrides, setLegOverrides] = useState<{
    until: number;
    byUid: Record<string, number>;
  } | null>(null);
  const [receipt, setReceipt] = useState<PlacedReceipt | null>(null);
  const [mobileCouponOpen, setMobileCouponOpen] = useState(false);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  const hasPredLegs = comboLegs.some((l) => l.kind === "prediction");

  useEffect(() => {
    if (comboLegs.length === 0) return;
    let cancelled = false;
    async function load() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const [mRes, pRes] = await Promise.all([
          api.matches(),
          hasPredLegs
            ? api.predictionsCatalog().catch(() => ({ questions: [] as ClientPrediction[] }))
            : Promise.resolve({ questions: [] as ClientPrediction[] }),
        ]);
        if (cancelled) return;
        setLiveMatches(mRes.matches);
        if (hasPredLegs) setLivePredictions(pRes.questions);
        setNowMs(Date.now());
      } catch {
        /* silencieux */
      }
    }
    void load();
    const id = setInterval(() => void load(), 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [comboLegs.length, hasPredLegs]);

  const matchMap = useMemo(
    () => new Map(liveMatches.map((m) => [m.id, m])),
    [liveMatches]
  );
  const predMap = useMemo(
    () => new Map(livePredictions.map((q) => [q.id, q])),
    [livePredictions]
  );

  // Enrichissement temps réel de chaque sélection du Betslip
  const enrichedLegs = useMemo(() => {
    const activeOverrides =
      legOverrides && nowMs < legOverrides.until ? legOverrides.byUid : null;
    const mapped = comboLegs.map((leg) => {
      const overrideOdds = activeOverrides?.[leg.uid];
      if (leg.kind === "sport" && leg.matchId) {
        const m = matchMap.get(leg.matchId);
        if (!m) {
          return {
            ...leg,
            resolvedSource: leg.matchSource ?? null,
            liveOdds: roundOdds2(overrideOdds ?? leg.odds),
            isLive: Boolean(leg.isLive),
            closed: false,
            suspended: false,
            startsAt: leg.startsAt ?? null,
            matchObj: null,
          };
        }
        if (m.status === "finished") {
          return {
            ...leg,
            resolvedSource: m.source,
            liveOdds: roundOdds2(overrideOdds ?? leg.odds),
            isLive: false,
            closed: true,
            suspended: false,
            startsAt: m.startsAt,
            matchObj: m,
          };
        }
        const grp = m.markets?.find((g) => g.key === leg.market);
        const out = grp?.outcomes.find((o) => o.key === leg.selection);
        const liveOdds =
          out?.odds ??
          (leg.market === "result"
            ? leg.selection === "home"
              ? m.oddsHome
              : leg.selection === "draw"
                ? (m.oddsDraw ?? leg.odds)
                : m.oddsAway
            : null);

        return {
          ...leg,
          resolvedSource: m.source,
          liveOdds: roundOdds2(overrideOdds ?? liveOdds ?? leg.odds),
          isLive: m.status === "live",
          closed: grp != null && !out,
          suspended: Boolean(m.suspended || m.kickoffReached),
          startsAt: m.startsAt,
          matchObj: m,
        };
      }

      if (leg.kind === "prediction" && leg.questionId) {
        const q = predMap.get(leg.questionId);
        if (!q) {
          return {
            ...leg,
            resolvedSource: null,
            liveOdds: roundOdds2(overrideOdds ?? leg.odds),
            isLive: false,
            closed: false,
            suspended: false,
            startsAt: leg.startsAt ?? null,
            matchObj: null,
          };
        }
        const expired = q.status !== "open" || new Date(q.resolvesAt).getTime() <= nowMs;
        let liveOdds = leg.odds;
        if (Array.isArray(q.options) && q.options.length >= 2) {
          const opt = q.options.find((o) => o.key === leg.selection);
          if (opt) liveOdds = opt.odds;
        } else {
          liveOdds = leg.selection === "yes" ? q.oddsYes : q.oddsNo;
        }
        return {
          ...leg,
          resolvedSource: null,
          liveOdds: roundOdds2(overrideOdds ?? liveOdds),
          isLive: false,
          closed: expired,
          suspended: false,
          startsAt: q.resolvesAt,
          matchObj: null,
        };
      }

      return {
        ...leg,
        resolvedSource: leg.matchSource ?? null,
        liveOdds: roundOdds2(overrideOdds ?? leg.odds),
        isLive: Boolean(leg.isLive),
        closed: false,
        suspended: false,
        startsAt: leg.startsAt ?? null,
        matchObj: null,
      };
    });
    return sortSlipSelectionsChronologically(mapped);
  }, [comboLegs, matchMap, predMap, nowMs, legOverrides]);

  const parsed = Number(stakeText.replace(",", "."));
  const stake = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const overBalance = stake > balance;
  const belowMin = stake > 0 && stake < 0.5;
  const isCombo = enrichedLegs.length >= 2;
  const hasClosedLeg = enrichedLegs.some((l) => l.closed);
  const hasSuspendedLeg = enrichedLegs.some((l) => l.suspended);
  const hasMixedSources =
    enrichedLegs.some((l) => l.resolvedSource === "manual") &&
    enrichedLegs.some((l) => l.resolvedSource === "virtual");

  const quote = useMemo(
    () =>
      computeComboQuote(
        enrichedLegs.map((l) => l.liveOdds),
        stake
      ),
    [enrichedLegs, stake]
  );

  const nextBoost = nextComboBoostTier(quote.eligibleLegs);

  const canSubmit =
    !submitting &&
    enrichedLegs.length >= 1 &&
    enrichedLegs.length <= MAX_COMBO_LEGS &&
    !hasClosedLeg &&
    !hasSuspendedLeg &&
    !hasMixedSources &&
    stake >= 0.5 &&
    !overBalance;

  const submitSlip = async () => {
    if (!canSubmit || inFlightRef.current) return;
    inFlightRef.current = true;
    const legsSig = enrichedLegs
      .map((l) => `${l.uid}:${l.market}:${l.selection}:${l.liveOdds}`)
      .join("|");
    const sig = `${legsSig}::${stake}::${quote.totalOdds}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = { key: generateBetIdempotencyKey(), sig };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setSubmitting(true);
    setError(null);

    try {
      if (enrichedLegs.length === 1) {
        const single = enrichedLegs[0];
        if (single.kind === "sport" && single.matchId) {
          const res = await api.placeBet({
            matchId: single.matchId,
            market: single.market,
            selection: single.selection,
            stake,
            expectedOdds: single.liveOdds,
            oddsPolicy,
            idempotencyKey,
          });
          idempotencySlotRef.current = null;
          setOddsChanged(null);
          setLegOverrides(null);
          setBalance(res.balance);
          bumpBets();
          playUiSound(user?.sound, "bet");
          triggerHaptic(user?.haptics, [18, 30]);
          setReceipt({
            kind: "single",
            count: 1,
            totalOdds: res.bet.odds,
            stake: res.bet.stake,
            potentialWin: res.bet.potentialWin,
            boostPct: 0,
          });
          clearCombo();
        } else if (single.kind === "prediction" && single.questionId) {
          const res = await api.placePredictionBet({
            questionId: single.questionId,
            selection: single.selection,
            stake,
            expectedOdds: single.liveOdds,
            oddsPolicy,
            idempotencyKey,
          });
          idempotencySlotRef.current = null;
          setOddsChanged(null);
          setLegOverrides(null);
          setBalance(res.balance);
          bumpBets();
          playUiSound(user?.sound, "bet");
          triggerHaptic(user?.haptics, [18, 30]);
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
        const res = await api.placeComboBet({
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
        playUiSound(user?.sound, "bet");
        triggerHaptic(user?.haptics, [18, 30]);
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
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      if (
        e instanceof ApiRequestError &&
        e.status === 409 &&
        e.code === ODDS_CHANGED_CODE &&
        e.details
      ) {
        setOddsChanged(e.details);
        setNowMs(Date.now());
        if (e.details.updatedLegs && e.details.updatedLegs.length > 0) {
          applyComboOddsUpdates(e.details.updatedLegs);
          const byUid: Record<string, number> = {};
          for (const u of e.details.updatedLegs) {
            const uid =
              u.kind === "sport" ? `sport-${u.matchId}` : `pred-${u.questionId}`;
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
        triggerHaptic(user?.haptics, [12, 20]);
        return;
      }
      setOddsChanged(null);
      const msg = e instanceof Error ? e.message : "Validation du coupon impossible";
      setError(msg);
      toast({ kind: "error", title: "Coupon refusé", description: msg });
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  // État après validation réussie
  if (receipt && comboLegs.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1360px] px-4 pt-6 pb-8 lg:px-0 lg:py-4">
        <div className="glass-card mx-auto max-w-[540px] rounded-3xl p-5 text-center lg:p-7">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-win/15 text-win">
            <Check className="h-7 w-7" strokeWidth={2.6} />
          </div>
          <h1 className="mt-3 font-display text-[20px] font-bold text-ink">
            Coupon validé !
          </h1>
          <p className="mt-1 text-[12.5px] text-mist">
            {receipt.kind === "combo"
              ? `Pari combiné (${receipt.count} sélections)`
              : "Pari simple enregistré"}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-elev p-3">
            <div>
              <p className="text-[10.5px] text-dim">Mise</p>
              <p className="font-display text-[14px] font-bold tabular-nums text-ink">
                {eur(receipt.stake)}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] text-dim">Cote totale</p>
              <p className="font-display text-[14px] font-bold tabular-nums text-betclic-red">
                {formatOdds(receipt.totalOdds, oddsFormat)}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] text-dim">Gain max</p>
              <p className="font-display text-[14px] font-bold tabular-nums text-win">
                {eur(receipt.potentialWin)}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setReceipt(null);
                router.push("/matchs");
              }}
              className="h-11 rounded-xl bg-elev font-display text-[13px] font-bold text-ink active:scale-[0.98]"
            >
              Continuer
            </button>
            <button
              type="button"
              onClick={() => {
                setReceipt(null);
                router.push("/paris");
              }}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[13px] font-bold text-white active:scale-[0.98]"
            >
              Mes paris
              <ArrowRight className="h-4 w-4" strokeWidth={2.3} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 pt-3.5 pb-2 lg:px-0 lg:py-0">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-[20px] font-bold leading-tight tracking-tight text-ink lg:text-[25px]">
            Coupon de pari
          </h1>
          {enrichedLegs.length > 0 && (
            <span className="rounded-full bg-betclic-red px-2 py-0.5 font-display text-[11px] font-bold text-white">
              {enrichedLegs.length}/{MAX_COMBO_LEGS}
            </span>
          )}
        </div>

        {enrichedLegs.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMobileCouponOpen((o) => !o)}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full px-2.5 font-display text-[11.5px] font-bold transition-colors active:scale-95 lg:hidden",
                mobileCouponOpen
                  ? "bg-ink text-white"
                  : "bg-elev text-ink"
              )}
            >
              <Hash className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
              Code coupon
            </button>
            <button
              type="button"
              onClick={() => {
                clearCombo();
                setError(null);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-elev px-2.5 font-display text-[11.5px] font-bold text-mist hover:bg-edge/80 hover:text-ink active:bg-edge active:text-ink"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.1} />
              Vider
            </button>
          </div>
        )}
      </div>

      {/* État vide */}
      {enrichedLegs.length === 0 ? (
        <div className="glass-card mx-auto mt-8 max-w-[560px] rounded-3xl p-6 text-center lg:p-8">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-betclic-red/10 text-betclic-red">
            <Layers className="h-6 w-6" strokeWidth={2.1} />
          </div>
          <h2 className="mt-3.5 font-display text-[16.5px] font-bold text-ink">
            Votre coupon de pari est vide
          </h2>
          <p className="mx-auto mt-1.5 max-w-[290px] text-[12.5px] leading-relaxed text-mist">
            Faites un <strong className="font-semibold text-ink">appui long</strong> sur
            n&apos;importe quelle cote dans Matchs ou Prédictions pour l&apos;ajouter à votre
            coupon combiné.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Link
              href="/matchs"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[13px] font-bold text-white active:scale-[0.98]"
            >
              <Trophy className="h-4 w-4" strokeWidth={2.2} />
              Matchs
            </Link>
            <Link
              href="/predictions"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-elev font-display text-[13px] font-bold text-ink active:scale-[0.98]"
            >
              <TrendingUp className="h-4 w-4 text-betclic-red" strokeWidth={2.2} />
              Prédictions
            </Link>
          </div>

          <CouponCodeBox variant="empty" autoCheckUrlCode />
        </div>
      ) : (
        <div className="mt-3 space-y-3 lg:mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start lg:gap-6 lg:space-y-0">
          {/* Colonne gauche desktop : Code coupon (replié sur mobile sauf demande) + Bonus Combiné + Sélections */}
          <div className="space-y-2.5 lg:space-y-3">
          <CouponCodeBox
            variant="compact"
            autoCheckUrlCode
            className={cn(!mobileCouponOpen && "hidden lg:block")}
          />

          {/* Jauge Bonus Combiné (uniquement en mode combiné ≥ 2 sélections) */}
          {isCombo && (
            <div className="rounded-2xl border border-edge bg-white p-3">
              <div className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className="inline-flex items-center gap-1.5 font-display font-bold text-ink">
                  <Flame className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
                  {quote.boostPct > 0
                    ? `Bonus Combiné actif : +${quote.boostPct}%`
                    : "Bonus Combiné jusqu'à +20%"}
                </span>
                {nextBoost ? (
                  <span className="text-[11px] font-semibold text-mist">
                    +{nextBoost.needed} cote{nextBoost.needed > 1 ? "s" : ""} (≥{MIN_ELIGIBLE_BOOST_ODDS}) → +{nextBoost.pct}%
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-win">Palier max atteint</span>
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elev">
                <div
                  className="h-full rounded-full bg-betclic-red transition-all duration-300"
                  style={{ width: `${Math.min(100, (quote.eligibleLegs / 8) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Liste des sélections */}
          <div className="space-y-2.5">
            {enrichedLegs.map((leg) => {
              const splitTeams =
                leg.kind === "sport" && (!leg.homeTeam || !leg.awayTeam) && leg.title.includes("–")
                  ? leg.title.split("–").map((s) => s.trim())
                  : null;
              const hName = leg.matchObj?.homeTeam || leg.homeTeam || splitTeams?.[0] || "";
              const aName = leg.matchObj?.awayTeam || leg.awayTeam || splitTeams?.[1] || "";
              const hasSportTeams = leg.kind === "sport" && Boolean(hName && aName);
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
                <div
                  key={leg.uid}
                  className={cn(
                    "glass-card relative cursor-pointer overflow-hidden rounded-2xl p-3 transition-colors hover:bg-elev/20 active:bg-elev/40 lg:p-3.5",
                    leg.closed && "border-betclic-red/40 bg-betclic-red/[0.04]"
                  )}
                >
                  <CardOverlayLink
                    href={legHref}
                    label={hasSportTeams ? `${hName} – ${aName}` : leg.title}
                  />

                  {/* En-tête : ligue + statut + retrait */}
                  <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-mist">
                      <span className="truncate font-semibold">{leg.league}</span>
                      {leg.isLive && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[10px] font-bold tabular-nums text-betclic-red">
                          <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
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
                          />
                        </span>
                      )}
                      {!leg.isLive && !leg.closed && leg.startsAt && (
                        <span className="shrink-0 rounded-full bg-elev px-2 py-0.5 font-display text-[10px] font-semibold tabular-nums text-ink">
                          {formatKickoff(leg.startsAt)}
                        </span>
                      )}
                      {leg.closed && (
                        <span className="shrink-0 rounded-full bg-betclic-red/15 px-2 py-0.5 font-display text-[10px] font-bold text-betclic-red">
                          Clôturé
                        </span>
                      )}
                      {leg.suspended && !leg.closed && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 font-display text-[10px] font-bold text-amber-700">
                          Suspendu
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeComboLeg(leg.uid)}
                      aria-label="Retirer cette sélection"
                      className="pointer-events-auto relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elev text-mist hover:bg-edge hover:text-ink active:bg-edge active:text-ink"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                  </div>

                  {/* Corps de la sélection */}
                  <div className="pointer-events-none relative z-[1] mt-2.5 block w-full text-left">
                    {hasSportTeams ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2.5">
                          <TeamAvatar
                            name={hName}
                            logo={leg.matchObj?.homeLogo ?? leg.homeLogo}
                            size="xs"
                          />
                          <span className="truncate font-display text-[14px] font-semibold text-ink">
                            {hName}
                          </span>
                          {showScores && (
                            <span
                              className={cn(
                                "ml-auto min-w-[22px] rounded-md px-1.5 py-0.5 text-center font-display text-[15px] font-bold tabular-nums",
                                leg.isLive ? "bg-betclic-red/10 text-betclic-red" : "bg-elev text-ink"
                              )}
                            >
                              {leg.matchObj!.homeScore}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <TeamAvatar
                            name={aName}
                            logo={leg.matchObj?.awayLogo ?? leg.awayLogo}
                            size="xs"
                          />
                          <span className="truncate font-display text-[14px] font-semibold text-ink">
                            {aName}
                          </span>
                          {showScores && (
                            <span
                              className={cn(
                                "ml-auto min-w-[22px] rounded-md px-1.5 py-0.5 text-center font-display text-[15px] font-bold tabular-nums",
                                leg.isLive ? "bg-betclic-red/10 text-betclic-red" : "bg-elev text-ink"
                              )}
                            >
                              {leg.matchObj!.awayScore}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="font-display text-[14px] font-semibold leading-snug text-ink">
                        {leg.title}
                      </p>
                    )}

                    <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
                      <span className="truncate pr-2 text-[12.5px] font-semibold text-ink">
                        {leg.selectionLabel}
                      </span>
                      <LegLiveOddsBadge odds={leg.liveOdds} oddsFormat={oddsFormat} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>

          {/* Bloc Mise & Validation : barre collante juste au-dessus de la BottomNav sur mobile, colonne collante à droite sur desktop */}
          <div className="glass-card rounded-2xl p-3.5 space-y-2.5 max-lg:sticky max-lg:bottom-[calc(58px+env(safe-area-inset-bottom,0px))] max-lg:z-20 max-lg:-mx-4 max-lg:rounded-t-2xl max-lg:rounded-b-none max-lg:border-x-0 max-lg:border-b-0 max-lg:border-t max-lg:border-edge max-lg:bg-white/98 max-lg:px-4 max-lg:pt-2.5 max-lg:pb-3 max-lg:shadow-[0_-6px_20px_rgba(17,24,39,0.08)] max-lg:backdrop-blur-md lg:sticky lg:top-[84px] lg:space-y-3 lg:p-5">
            <TouchStakePad
              id="betslip-stake-input"
              label="Votre mise"
              stakeText={stakeText}
              onChangeStakeText={(next) => {
                setStakeText(next);
                setError(null);
              }}
              balance={balance}
              hasError={overBalance || belowMin}
              haptics={user?.haptics}
              collapsibleOnMobile
              defaultExpandedOnMobile={false}
            />

            {/* Récapitulatif cotes & gain potentiel */}
            <div className="space-y-1.5 border-t border-edge pt-2.5 text-[12.5px]">
              <div className="flex items-center justify-between text-mist">
                <span>{isCombo ? "Cote totale" : "Cote"}</span>
                <span className="font-display text-[14px] font-bold tabular-nums text-ink">
                  {formatOdds(quote.totalOdds, oddsFormat)}
                </span>
              </div>
              {quote.boostAmount > 0 && (
                <div className="flex items-center justify-between text-win">
                  <span>Bonus Combiné (+{quote.boostPct}%)</span>
                  <span className="font-display font-bold tabular-nums">
                    +{eur(quote.boostAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-0.5">
                <span className="font-display text-[13.5px] font-bold text-ink">
                  Gain potentiel
                </span>
                <span className="font-display text-[18px] font-extrabold tabular-nums text-win">
                  <AnimatedNumber value={quote.potentialWin} format={eur} />
                </span>
              </div>
            </div>

            {/* Alertes éventuelles */}
            {hasMixedSources && (
              <div className="flex items-center gap-2 rounded-xl bg-betclic-red/10 px-3 py-2 text-[12px] font-medium text-betclic-red">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Impossible de mélanger des matchs réels et des matchs virtuels dans un même coupon.
                </span>
              </div>
            )}

            {hasClosedLeg && (
              <div className="flex items-center gap-2 rounded-xl bg-betclic-red/10 px-3 py-2 text-[12px] font-medium text-betclic-red">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Retirez la sélection clôturée pour valider votre coupon.</span>
              </div>
            )}

            {hasSuspendedLeg && !hasClosedLeg && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-500/12 px-3 py-2 text-[12px] font-medium text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Une sélection est temporairement suspendue (coup d&apos;envoi ou action live).</span>
              </div>
            )}

            {belowMin && (
              <p className="text-[11.5px] font-medium text-betclic-red">
                La mise minimale est de 0,50 €.
              </p>
            )}

            {overBalance && (
              <div className="flex items-center justify-between rounded-xl bg-betclic-red/10 px-3 py-2 text-[12px]">
                <span className="font-medium text-betclic-red">Solde insuffisant</span>
                <button
                  type="button"
                  onClick={openRecharge}
                  className="font-display font-bold text-betclic-red underline"
                >
                  Recharger
                </button>
              </div>
            )}

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

            {error && !overBalance && (
              <p className="text-[12px] font-medium text-betclic-red">{error}</p>
            )}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={submitSlip}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-betclic-red font-display text-[14.5px] font-bold text-white shadow-sm transition-transform active:scale-[0.985] disabled:opacity-45"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              ) : oddsChanged ? (
                <>
                  Accepter la nouvelle cote ({formatOdds(quote.totalOdds, oddsFormat)})
                </>
              ) : (
                <>
                  {isCombo
                    ? `Placer le combiné · ${eur(stake)}`
                    : `Placer le pari · ${eur(stake)}`}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
