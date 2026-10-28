"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Flame,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AnimatedNumber } from "@/components/animated-number";
import { CouponCodeBox } from "@/components/coupon-code-box";
import { LiveMatchClock } from "@/components/live-match-clock";
import { OddsLockControls } from "@/components/odds-lock-controls";
import {
  OddsTrendCorner,
  oddsTrendTextClass,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { TeamAvatar } from "@/components/team-avatar";
import { CardOverlayLink } from "@/components/card-overlay-link";
import { useApp, useFeedMatches } from "@/components/providers";
import {
  ApiRequestError,
  api,
  type ClientMatch,
  type ClientPrediction,
} from "@/lib/api";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  nextComboBoostTier,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { cn, eur, formatOdds } from "@/lib/format";
import { mergeSingleSlimIntoFullMatch } from "@/lib/query-client";
import {
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/odds-lock";

const QUICK_STAKES = [5, 10, 25, 50];

function DesktopLegLiveOddsBadge({
  odds,
  oddsFormat,
}: {
  odds: number;
  oddsFormat?: "decimal" | "fractional";
}) {
  const trend = useOddsTrend(odds);
  return (
    <span
      className={cn(
        "relative overflow-hidden rounded-lg border border-edge bg-white px-2 py-0.5 font-display text-[10.5px] font-medium tabular-nums transition-colors duration-200",
        oddsTrendTextClass(trend)
      )}
    >
      <OddsTrendCorner trend={trend} />
      {formatOdds(odds, oddsFormat)}
    </span>
  );
}

function formatMarketName(market: string): string {
  switch (market) {
    case "result":
    case "1x2":
      return "1X2";
    case "double_chance":
    case "double":
      return "Double chance";
    case "btts":
      return "Les 2 marquent";
    case "over_under_25":
    case "total_25":
    case "ou25":
    case "ou15":
    case "ou35":
      return "Total buts";
    case "yesno":
      return "Oui / Non";
    case "multichoice":
      return "Choix multiple";
    default:
      return market;
  }
}

function splitMatchTitle(
  title: string
): { homeTeam: string; awayTeam: string } | null {
  for (const sep of [" – ", " - ", " vs "]) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      const homeTeam = title.slice(0, idx).trim();
      const awayTeam = title.slice(idx + sep.length).trim();
      if (homeTeam && awayTeam) return { homeTeam, awayTeam };
    }
  }
  return null;
}

function resolveLiveMatchSelectionOdds(
  match: ClientMatch,
  market: string,
  selection: string,
  fallbackOdds?: number
): { odds: number | null; closed: boolean; suspended: boolean } {
  if (match.status === "finished") {
    return { odds: null, closed: true, suspended: false };
  }
  if (match.suspended || match.kickoffReached) {
    return { odds: null, closed: false, suspended: true };
  }
  const grp = match.markets?.find(
    (m) => m.key === market || (market === "result" && m.key === "1x2")
  );
  let out = grp?.outcomes.find((o) => o.key === selection);
  if (!out && grp?.rows) {
    for (const r of grp.rows) {
      const inRow = r.outcomes.find((o) => o.key === selection);
      if (inRow) {
        out = inRow;
        break;
      }
    }
  }
  if (out) {
    return { odds: out.odds, closed: false, suspended: false };
  }
  if (market === "result" || market === "1x2") {
    const odds =
      selection === "home"
        ? match.oddsHome
        : selection === "draw"
          ? match.oddsDraw
          : selection === "away"
            ? match.oddsAway
            : null;
    return {
      odds,
      closed: grp ? true : odds == null,
      suspended: false,
    };
  }
  // Si le flux temps réel (`MATCHES_SNAPSHOT`) ne transporte que le groupe 1x2 (`markets.length <= 1`),
  // ne jamais marquer à tort un marché secondaire comme clôturé avant l'hydratation complète.
  const isSlimSnapshot =
    (match.markets?.length ?? 0) <= 1 && (match.marketCount ?? 2) > 1;
  if (!grp && isSlimSnapshot) {
    return { odds: fallbackOdds ?? null, closed: false, suspended: false };
  }
  return { odds: null, closed: true, suspended: false };
}

function resolveLivePredictionOdds(
  q: ClientPrediction,
  selection: string,
  nowMs: number
): { odds: number | null; closed: boolean } {
  const closed =
    q.status !== "open" || new Date(q.resolvesAt).getTime() <= nowMs;
  if (Array.isArray(q.options) && q.options.length >= 2) {
    const opt = q.options.find((o) => o.key === selection);
    return { odds: opt?.odds ?? null, closed: closed || !opt };
  }
  const odds =
    selection === "yes" ? q.oddsYes : selection === "no" ? q.oddsNo : null;
  return { odds, closed: closed || odds == null };
}

function EmptyBetslipIllustration() {
  return (
    <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
      <div className="absolute inset-1 rounded-full bg-betclic-red/8" />
      <svg
        viewBox="0 0 96 96"
        className="relative h-22 w-22"
        fill="none"
        aria-hidden
      >
        <rect
          x="26"
          y="16"
          width="46"
          height="60"
          rx="10"
          transform="rotate(9 49 46)"
          fill="#f1f3f5"
          stroke="#111827"
          strokeWidth="2.5"
        />
        <rect
          x="20"
          y="18"
          width="46"
          height="60"
          rx="10"
          transform="rotate(-6 43 48)"
          fill="#ffffff"
          stroke="#111827"
          strokeWidth="2.6"
        />
        <path
          d="M19.5 29.5L64.5 24.8L65.4 33.2L20.4 37.9Z"
          fill="#e10014"
        />
        <rect
          x="27"
          y="44"
          width="24"
          height="4"
          rx="2"
          transform="rotate(-6 27 44)"
          fill="#111827"
        />
        <rect
          x="28"
          y="53"
          width="17"
          height="3.5"
          rx="1.75"
          transform="rotate(-6 28 53)"
          fill="#9ca3af"
        />
        <circle
          cx="65"
          cy="63"
          r="14"
          fill="#e10014"
          stroke="#ffffff"
          strokeWidth="3"
        />
        <path
          d="M65 55.2L67.1 60.4L72.7 60.9L68.4 64.5L69.7 70L65 67.1L60.3 70L61.6 64.5L57.3 60.9L62.9 60.4Z"
          fill="#ffffff"
        />
      </svg>
    </div>
  );
}

export function DesktopBetslipSidebar() {
  const router = useRouter();
  const {
    authReady,
    user,
    balance,
    oddsFormat,
    oddsPolicy,
    setOddsPolicy,
    setBalance,
    openRecharge,
    comboLegs,
    removeComboLeg,
    clearCombo,
    applyComboOddsUpdates,
    toast,
    bumpBets,
  } = useApp();
  const feedMatches = useFeedMatches();

  const [stake, setStake] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(null);
  const [legOverrides, setLegOverrides] = useState<{
    until: number;
    byUid: Record<string, number>;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [livePredMap, setLivePredMap] = useState<Map<number, ClientPrediction>>(
    new Map()
  );
  const [detailMatchesById, setDetailMatchesById] = useState<
    Record<number, ClientMatch>
  >({});
  const [placedReceipt, setPlacedReceipt] = useState<{
    mode: "single" | "combo";
    legsCount: number;
    stake: number;
    finalOdds: number;
    potentialWin: number;
  } | null>(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  const hasPredLegs = comboLegs.some((l) => l.kind === "prediction");
  const secondarySportIdsKey = useMemo(
    () =>
      [
        ...new Set(
          comboLegs
            .filter(
              (l) =>
                l.kind === "sport" &&
                l.matchId != null &&
                l.market !== "result" &&
                l.market !== "1x2"
            )
            .map((l) => l.matchId as number)
        ),
      ]
        .sort((a, b) => a - b)
        .join(","),
    [comboLegs]
  );

  useEffect(() => {
    if (!hasPredLegs && !secondarySportIdsKey) return;
    let active = true;
    const secondaryIds = secondarySportIdsKey
      ? secondarySportIdsKey.split(",").map(Number)
      : [];

    const refreshSidebarLive = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof window !== "undefined" && window.innerWidth < 1024) return;
      if (hasPredLegs) {
        api
          .predictionsCatalog()
          .then((pRes) => {
            if (!active) return;
            setLivePredMap(new Map(pRes.questions.map((q) => [q.id, q])));
            setNowMs(Date.now());
          })
          .catch(() => undefined);
      }
      if (secondaryIds.length > 0) {
        void Promise.all(
          secondaryIds.map((id) => api.matchById(id).catch(() => null))
        ).then((results) => {
          if (!active) return;
          const next: Record<number, ClientMatch> = {};
          for (const r of results) {
            if (r?.match) next[r.match.id] = r.match;
          }
          if (Object.keys(next).length > 0) {
            setDetailMatchesById((prev) => ({ ...prev, ...next }));
            setNowMs(Date.now());
          }
        });
      }
    };

    refreshSidebarLive();
    const id = setInterval(refreshSidebarLive, 3_500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [hasPredLegs, secondarySportIdsKey]);

  const liveMatchMap = useMemo(() => {
    const map = new Map<number, ClientMatch>();
    for (const [idStr, m] of Object.entries(detailMatchesById)) {
      map.set(Number(idStr), m);
    }
    for (const m of feedMatches ?? []) {
      const prev = map.get(m.id);
      map.set(m.id, prev ? mergeSingleSlimIntoFullMatch(prev, m) : m);
    }
    return map;
  }, [detailMatchesById, feedMatches]);

  const enrichedLegs = useMemo(() => {
    const activeOverrides =
      legOverrides && nowMs < legOverrides.until ? legOverrides.byUid : null;
    const mapped = comboLegs.map((leg) => {
      const overrideOdds = activeOverrides?.[leg.uid];
      if (leg.kind === "sport" && leg.matchId) {
        const m = liveMatchMap.get(leg.matchId);
        if (!m) {
          return {
            ...leg,
            liveOdds: roundOdds2(overrideOdds ?? leg.odds),
            isLive: Boolean(leg.isLive),
            closed: false,
            suspended: false,
            startsAt: leg.startsAt ?? null,
            liveMatch: null as ClientMatch | null,
          };
        }
        const resolved = resolveLiveMatchSelectionOdds(
          m,
          leg.market,
          leg.selection,
          leg.odds
        );
        return {
          ...leg,
          matchSource: m.source,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeLogo: m.homeLogo,
          awayLogo: m.awayLogo,
          liveOdds: roundOdds2(overrideOdds ?? resolved.odds ?? leg.odds),
          isLive: m.status === "live",
          closed: resolved.closed,
          suspended: resolved.suspended,
          startsAt: m.startsAt,
          liveMatch: m,
        };
      }
      if (leg.kind === "prediction" && leg.questionId) {
        const q = livePredMap.get(leg.questionId);
        if (!q) {
          return {
            ...leg,
            liveOdds: roundOdds2(overrideOdds ?? leg.odds),
            isLive: false,
            closed: false,
            suspended: false,
            startsAt: leg.startsAt ?? null,
            liveMatch: null as ClientMatch | null,
          };
        }
        const resolved = resolveLivePredictionOdds(q, leg.selection, nowMs);
        return {
          ...leg,
          liveOdds: roundOdds2(overrideOdds ?? resolved.odds ?? leg.odds),
          isLive: false,
          closed: resolved.closed,
          suspended: false,
          startsAt: q.resolvesAt,
          liveMatch: null as ClientMatch | null,
        };
      }
      return {
        ...leg,
        liveOdds: roundOdds2(overrideOdds ?? leg.odds),
        isLive: Boolean(leg.isLive),
        closed: false,
        suspended: false,
        startsAt: leg.startsAt ?? null,
        liveMatch: null as ClientMatch | null,
      };
    });
    return sortSlipSelectionsChronologically(mapped);
  }, [comboLegs, liveMatchMap, livePredMap, nowMs, legOverrides]);

  const isSingle = enrichedLegs.length === 1;
  const isCombo = enrichedLegs.length >= 2;

  const quote = useMemo(
    () =>
      computeComboQuote(
        enrichedLegs.map((l) => l.liveOdds),
        stake
      ),
    [enrichedLegs, stake]
  );

  const nextBoost = nextComboBoostTier(quote.eligibleLegs);

  const hasClosedLeg = enrichedLegs.some((l) => l.closed);
  const hasSuspendedLeg = enrichedLegs.some((l) => l.suspended);
  const sportSourcesInSlip = new Set(
    enrichedLegs
      .filter((l) => l.kind === "sport" && l.matchSource != null)
      .map((l) => l.matchSource)
  );
  const hasMixedMatchSources = sportSourcesInSlip.size > 1;
  const insufficient = user !== null && stake > balance;

  const canSubmit =
    enrichedLegs.length >= 1 &&
    enrichedLegs.length <= MAX_COMBO_LEGS &&
    !hasClosedLeg &&
    !hasSuspendedLeg &&
    !hasMixedMatchSources &&
    stake >= 0.5 &&
    stake <= 10_000 &&
    !insufficient &&
    !loading;

  const submit = async () => {
    if (enrichedLegs.length === 0) return;
    if (!authReady && !user) return;
    if (!user) {
      toast({
        kind: "info",
        title: "Connectez-vous pour valider votre coupon",
      });
      router.push("/auth/connexion");
      return;
    }
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

    setLoading(true);
    setError(null);
    try {
      let newBalance = balance;
      let finalOdds = quote.totalOdds;
      let potentialWin = quote.potentialWin;
      const mode: "single" | "combo" = isSingle ? "single" : "combo";

      if (isSingle) {
        const leg = enrichedLegs[0];
        if (leg.kind === "sport" && leg.matchId) {
          const res = await api.placeBet({
            matchId: leg.matchId,
            selection: leg.selection,
            stake,
            market: leg.market,
            expectedOdds: leg.liveOdds,
            oddsPolicy,
            idempotencyKey,
          });
          newBalance = res.balance;
          finalOdds = res.bet.odds;
          potentialWin = res.bet.potentialWin;
        } else if (leg.kind === "prediction" && leg.questionId) {
          const res = await api.placePredictionBet({
            questionId: leg.questionId,
            selection: leg.selection,
            stake,
            expectedOdds: leg.liveOdds,
            oddsPolicy,
            idempotencyKey,
          });
          newBalance = res.balance;
          finalOdds = res.bet.odds;
          potentialWin = res.bet.potentialWin;
        }
      } else {
        const res = await api.placeComboBet({
          stake,
          expectedTotalOdds: quote.totalOdds,
          oddsPolicy,
          idempotencyKey,
          legs: enrichedLegs.map((l) => ({
            kind: l.kind,
            ...(l.matchId ? { matchId: l.matchId } : {}),
            ...(l.questionId ? { questionId: l.questionId } : {}),
            market: l.market,
            selection: l.selection,
            expectedOdds: l.liveOdds,
          })),
        });
        newBalance = res.balance;
        finalOdds = res.bet.totalOdds;
        potentialWin = res.bet.potentialWin;
      }

      idempotencySlotRef.current = null;
      setOddsChanged(null);
      setLegOverrides(null);
      setBalance(newBalance);
      bumpBets();
      triggerHaptic(user?.haptics, [18, 35, 55]);
      playUiSound(user?.sound, "bet");

      const snap = {
        mode,
        legsCount: enrichedLegs.length,
        stake,
        finalOdds,
        potentialWin,
      };
      clearCombo();
      setPlacedReceipt(snap);
      toast({
        kind: "success",
        title:
          mode === "single"
            ? "Pari simple validé !"
            : `Combiné ${snap.legsCount} sélections validé !`,
        description: `${eur(snap.stake)} @ ${formatOdds(snap.finalOdds, oddsFormat)} · Gain pot. ${eur(snap.potentialWin)}`,
      });
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
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Validation du coupon impossible."
      );
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const headerLabel =
    enrichedLegs.length === 0
      ? "0 sélection"
      : enrichedLegs.length === 1
        ? "1 sélection"
        : `${enrichedLegs.length} sélections · Combiné`;

  return (
    <aside
      aria-label="Coupon de paris"
      className="hidden lg:sticky lg:top-[76px] lg:block"
    >
      <div className="glass-card flex max-h-[calc(100dvh-96px)] flex-col overflow-hidden rounded-2xl">
        {/* En-tête Betslip */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="font-display text-[12px] font-medium tracking-tight text-ink">
              {headerLabel}
            </span>
            {quote.boostPct > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-win/12 px-2 py-0.5 font-display text-[10px] font-medium text-win">
                <Flame className="h-3 w-3" strokeWidth={2.4} />+{quote.boostPct}%
              </span>
            )}
          </div>

          {enrichedLegs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearCombo();
                setError(null);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-elev px-2.5 py-1 font-display text-[10px] font-medium text-mist transition-colors hover:bg-betclic-red/10 hover:text-betclic-red"
            >
              <Trash2 className="h-3 w-3" strokeWidth={2.2} />
              Vider
            </button>
          )}
        </div>

        {/* État 1 : Reçu de confirmation après validation */}
        {placedReceipt && enrichedLegs.length === 0 ? (
          <div className="p-5 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-win/12 text-win">
              <CheckCircle2 className="h-6 w-6" strokeWidth={2.3} />
            </div>
            <h2 className="mt-3 font-display text-[13.5px] font-bold text-ink">
              Coupon enregistré !
            </h2>
            <p className="mt-0.5 text-[10.5px] text-mist">
              {placedReceipt.mode === "single"
                ? "Votre pari simple est en cours."
                : `Votre combiné (${placedReceipt.legsCount} sélections) est en cours.`}
            </p>

            <div className="mt-4 grid grid-cols-3 divide-x divide-edge rounded-xl bg-elev py-2.5 text-center">
              <div className="px-1.5">
                <p className="text-[9.5px] font-medium text-dim">Mise</p>
                <p className="mt-0.5 font-display text-[11px] font-medium tabular-nums text-ink">
                  {eur(placedReceipt.stake)}
                </p>
              </div>
              <div className="px-1.5">
                <p className="text-[9.5px] font-medium text-dim">Cote</p>
                <p className="mt-0.5 font-display text-[11px] font-medium tabular-nums text-betclic-red">
                  {formatOdds(placedReceipt.finalOdds, oddsFormat)}
                </p>
              </div>
              <div className="px-1.5">
                <p className="text-[9.5px] font-medium text-dim">Gain pot.</p>
                <p className="mt-0.5 font-display text-[11px] font-medium tabular-nums text-win">
                  {eur(placedReceipt.potentialWin)}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPlacedReceipt(null)}
                className="flex h-10 items-center justify-center rounded-xl bg-elev font-display text-[10.5px] font-medium text-ink transition-colors hover:bg-edge/70"
              >
                Nouveau pari
              </button>
              <Link
                href="/paris"
                onClick={() => setPlacedReceipt(null)}
                className="flex h-10 items-center justify-center gap-1 rounded-xl bg-betclic-red font-display text-[10.5px] font-medium text-white transition-colors hover:bg-betclic-red-deep"
              >
                Mes paris
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              </Link>
            </div>
          </div>
        ) : enrichedLegs.length === 0 ? (
          /* État 2 : Coupon vide (fidèle à la maquette 3 colonnes avec nos couleurs PULSE) */
          <>
            <div className="px-5 py-9 text-center">
              <EmptyBetslipIllustration />
              <h2 className="mt-3 font-display text-[13.5px] font-bold italic tracking-tight text-ink">
                Place un nouveau pari
              </h2>
              <p className="mt-1 text-[11px] text-mist">
                On croise les doigts pour toi !
              </p>
            </div>

            <div className="px-4 pb-4">
              <CouponCodeBox variant="empty" />
            </div>

            <div className="border-t border-edge bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-medium text-ink">
                  Gains possibles
                </span>
                <span className="font-display text-[12.5px] font-medium tabular-nums text-ink">
                  0,00 €
                </span>
              </div>

              <button
                type="button"
                disabled
                className="mt-3 flex h-11 w-full cursor-not-allowed items-center justify-center rounded-xl bg-betclic-red/35 font-display text-[11.5px] font-medium text-white"
              >
                Parier
              </button>
            </div>
          </>
        ) : (
          /* État 3 : Sélections actives (Simple ou Combiné) */
          <>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
              {/* Jauge Bonus Combiné */}
              {(isCombo || nextBoost) && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-elev/85 px-3 py-2 text-[10px]">
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    <Sparkles
                      className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                      strokeWidth={2.3}
                    />
                    {quote.boostPct > 0
                      ? `Bonus Combiné +${quote.boostPct}% actif`
                      : "Bonus Combiné dès 3 sél. (cote ≥ 1,35)"}
                  </span>
                  {nextBoost && (
                    <span className="shrink-0 font-display text-[10px] font-medium text-win">
                      +{nextBoost.needed} → +{nextBoost.pct}%
                    </span>
                  )}
                </div>
              )}

              {/* Liste des sélections avec disposition empilée 2 lignes + logos */}
              {enrichedLegs.map((leg) => {
                const oddsChanged =
                  Math.abs(leg.liveOdds - leg.odds) >= 0.01 && !leg.closed;
                const sportTeams =
                  leg.kind === "sport"
                    ? leg.homeTeam && leg.awayTeam
                      ? { homeTeam: leg.homeTeam, awayTeam: leg.awayTeam }
                      : splitMatchTitle(leg.title)
                    : null;
                const sportMatchId = leg.liveMatch?.id ?? leg.matchId;
                const legHref =
                  leg.kind === "sport" && sportMatchId
                    ? leg.liveMatch?.status === "finished"
                      ? `/resultats/${sportMatchId}`
                      : `/matchs/${sportMatchId}`
                    : leg.kind === "prediction" && leg.questionId
                      ? `/predictions/${leg.questionId}`
                      : "/predictions";

                return (
                  <article
                    key={leg.uid}
                    className={cn(
                      "relative cursor-pointer overflow-hidden rounded-xl border bg-white p-3 transition-colors hover:bg-elev/25",
                      leg.closed
                        ? "border-betclic-red/40 bg-betclic-red/[0.03]"
                        : leg.suspended
                          ? "border-warn/50 bg-warn/[0.04]"
                          : "border-edge"
                    )}
                  >
                    <CardOverlayLink
                      href={legHref}
                      label={
                        sportTeams
                          ? `${sportTeams.homeTeam} – ${sportTeams.awayTeam}`
                          : leg.title
                      }
                      className="rounded-xl"
                    />
                    <div className="pointer-events-none relative z-[1] flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[9.5px]">
                          <span className="truncate font-display font-medium uppercase text-mist">
                            {leg.league ||
                              (leg.kind === "prediction" ? "Prédiction" : "Match")}
                          </span>
                          {leg.liveMatch?.status === "live" && (
                            <span className="inline-flex items-center gap-1 font-display font-medium tabular-nums text-betclic-red">
                              <span className="live-dot !h-1.5 !w-1.5" />
                              <LiveMatchClock
                                match={leg.liveMatch}
                                fallback={leg.liveMatch.minute ?? "LIVE"}
                              />{" "}
                              · {leg.liveMatch.homeScore}-{leg.liveMatch.awayScore}
                            </span>
                          )}
                        </div>

                        {sportTeams ? (
                          <div className="mt-1.5 space-y-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <TeamAvatar
                                name={sportTeams.homeTeam}
                                logo={leg.homeLogo}
                                size="2xs"
                              />
                              <p className="truncate font-display text-[11px] font-medium leading-snug text-ink">
                                {sportTeams.homeTeam}
                              </p>
                            </div>
                            <div className="flex min-w-0 items-center gap-2">
                              <TeamAvatar
                                name={sportTeams.awayTeam}
                                logo={leg.awayLogo}
                                size="2xs"
                              />
                              <p className="truncate font-display text-[11px] font-medium leading-snug text-ink">
                                {sportTeams.awayTeam}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1 line-clamp-2 font-display text-[11px] font-medium leading-snug text-ink">
                            {leg.title}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeComboLeg(leg.uid)}
                        aria-label="Retirer du coupon"
                        className="pointer-events-auto relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-elev text-mist transition-colors hover:bg-betclic-red/12 hover:text-betclic-red"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                      </button>
                    </div>

                    <div className="pointer-events-none relative z-[1] mt-2 flex items-center justify-between gap-2 border-t border-edge/80 pt-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded-md bg-elev px-1.5 py-0.5 text-[9.5px] font-medium text-mist">
                          {formatMarketName(leg.market)}
                        </span>
                        <span className="truncate font-display text-[10.5px] font-medium text-ink">
                          {leg.selectionLabel}
                        </span>
                      </div>

                      {leg.closed ? (
                        <span className="shrink-0 rounded-md bg-betclic-red/10 px-2 py-0.5 font-display text-[10px] font-medium text-betclic-red">
                          Fermé
                        </span>
                      ) : leg.suspended ? (
                        <span className="shrink-0 rounded-md bg-warn/15 px-2 py-0.5 font-display text-[10px] font-medium text-warn">
                          Suspendu
                        </span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1">
                          {oddsChanged && (
                            <span className="font-display text-[9.5px] text-dim line-through tabular-nums">
                              {formatOdds(leg.odds, oddsFormat)}
                            </span>
                          )}
                          <DesktopLegLiveOddsBadge
                            odds={leg.liveOdds}
                            oddsFormat={oddsFormat}
                          />
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              <CouponCodeBox variant="compact" />

              {hasMixedMatchSources && (
                <div className="flex items-center gap-2 rounded-xl border border-betclic-red/30 bg-betclic-red/[0.06] px-3 py-2 text-[10.5px] font-medium text-betclic-red">
                  <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
                  Impossible de mélanger un match réel et un match virtuel.
                </div>
              )}

              {(hasClosedLeg || hasSuspendedLeg) && (
                <div className="flex items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[10.5px] font-medium text-ink">
                  <AlertTriangle
                    className="h-4 w-4 shrink-0 text-warn"
                    strokeWidth={2.2}
                  />
                  {hasClosedLeg
                    ? "Retirez la sélection fermée pour valider votre coupon."
                    : "Une sélection est temporairement suspendue en direct."}
                </div>
              )}
            </div>

            {/* Pied de carte : Mise + Gains possibles + CTA Parier */}
            <div className="shrink-0 border-t border-edge bg-white p-3.5">
              {/* Champ Mise */}
              <div className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-elev/60 px-3 py-2 focus-within:border-betclic-red focus-within:bg-white">
                <span className="text-[10.5px] font-medium text-mist">Mise</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.5}
                    max={10000}
                    step={0.5}
                    value={Number.isNaN(stake) ? "" : stake}
                    onChange={(e) => {
                      setError(null);
                      const v = parseFloat(e.target.value);
                      setStake(Number.isNaN(v) ? 0 : v);
                    }}
                    className="w-24 bg-transparent text-right font-display text-[12.5px] font-medium tabular-nums text-ink outline-none"
                  />
                  <span className="font-display text-[11px] font-medium text-dim">
                    €
                  </span>
                </div>
              </div>

              {/* Mises rapides */}
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {QUICK_STAKES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStake(q);
                    }}
                    className={cn(
                      "h-7 rounded-lg font-display text-[10.5px] font-medium transition-colors",
                      stake === q
                        ? "bg-ink text-white"
                        : "bg-elev text-ink hover:bg-edge/70"
                    )}
                  >
                    {q} €
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStake(
                      Math.max(0.5, Math.min(10_000, Math.floor(balance || 50)))
                    );
                  }}
                  className="h-7 rounded-lg bg-elev font-display text-[10px] font-medium uppercase text-mist transition-colors hover:bg-edge/70 hover:text-ink"
                >
                  Max
                </button>
              </div>

              {/* Récapitulatif Cote & Gains */}
              <div className="mt-3 space-y-1 border-t border-edge pt-2.5">
                <div className="flex items-center justify-between text-[10.5px] text-mist">
                  <span>{isCombo ? "Cote totale" : "Cote"}</span>
                  <span className="font-display font-medium tabular-nums text-betclic-red">
                    {formatOdds(quote.totalOdds, oddsFormat)}
                  </span>
                </div>
                {quote.boostAmount > 0 && (
                  <div className="flex items-center justify-between text-[10.5px] font-medium text-win">
                    <span>Bonus Combiné (+{quote.boostPct}%)</span>
                    <span className="font-display font-medium tabular-nums">
                      +{eur(quote.boostAmount)}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between pt-0.5">
                  <span className="text-[11px] font-medium text-ink">
                    Gains possibles
                  </span>
                  <AnimatedNumber
                    value={quote.potentialWin}
                    format={eur}
                    className="font-display text-[13.5px] font-medium tabular-nums text-win"
                  />
                </div>
              </div>

              {insufficient && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-betclic-red/8 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  <span>Solde insuffisant ({eur(balance)})</span>
                  <button
                    type="button"
                    onClick={openRecharge}
                    className="font-display font-medium underline"
                  >
                    Dépôt +
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
                compact
              />

              {error && (
                <p className="mt-2 rounded-lg bg-betclic-red/8 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={user ? !canSubmit : !authReady || loading}
                onClick={submit}
                className={cn(
                  "mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl font-display text-[11.5px] font-medium text-white transition-all",
                  (authReady && !user) || canSubmit
                    ? "bg-betclic-red shadow-xs hover:bg-betclic-red-deep active:scale-[0.99]"
                    : "cursor-not-allowed bg-betclic-red/35"
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validation…
                  </>
                ) : oddsChanged ? (
                  `Accepter (${formatOdds(quote.totalOdds, oddsFormat)})`
                ) : (
                  "Parier"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
