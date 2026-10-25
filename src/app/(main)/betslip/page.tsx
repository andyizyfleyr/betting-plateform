"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Flame,
  Layers,
  Loader2,
  Plus,
  Trash2,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import { api, type ClientMatch, type ClientPrediction } from "@/lib/api";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  MIN_ELIGIBLE_BOOST_ODDS,
  nextComboBoostTier,
} from "@/lib/combo-math";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { AnimatedNumber } from "@/components/animated-number";
import { TeamAvatar } from "@/components/team-avatar";
import { useApp } from "@/components/providers";
import { cn, eur, formatOdds } from "@/lib/format";

const QUICK_STAKES = [5, 10, 25, 50];

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
  const [receipt, setReceipt] = useState<PlacedReceipt | null>(null);

  useEffect(() => {
    if (comboLegs.length === 0) return;
    let cancelled = false;
    async function load() {
      try {
        const [mRes, pRes] = await Promise.all([
          api.matches(),
          api.predictions().catch(() => ({ questions: [] as ClientPrediction[] })),
        ]);
        if (cancelled) return;
        setLiveMatches(mRes.matches);
        setLivePredictions(pRes.questions);
        setNowMs(Date.now());
      } catch {
        /* silencieux */
      }
    }
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [comboLegs.length]);

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
    return comboLegs.map((leg) => {
      if (leg.kind === "sport" && leg.matchId) {
        const m = matchMap.get(leg.matchId);
        if (!m) {
          return {
            ...leg,
            resolvedSource: leg.matchSource ?? null,
            liveOdds: leg.odds,
            isLive: false,
            closed: false,
            suspended: false,
            matchObj: null,
          };
        }
        if (m.status === "finished") {
          return {
            ...leg,
            resolvedSource: m.source,
            liveOdds: leg.odds,
            isLive: false,
            closed: true,
            suspended: false,
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
          liveOdds: liveOdds ?? leg.odds,
          isLive: m.status === "live",
          closed: grp != null && !out,
          suspended: Boolean(m.suspended || m.kickoffReached),
          matchObj: m,
        };
      }

      if (leg.kind === "prediction" && leg.questionId) {
        const q = predMap.get(leg.questionId);
        if (!q) {
          return {
            ...leg,
            resolvedSource: null,
            liveOdds: leg.odds,
            isLive: false,
            closed: false,
            suspended: false,
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
          liveOdds,
          isLive: false,
          closed: expired,
          suspended: false,
          matchObj: null,
        };
      }

      return {
        ...leg,
        resolvedSource: leg.matchSource ?? null,
        liveOdds: leg.odds,
        isLive: false,
        closed: false,
        suspended: false,
        matchObj: null,
      };
    });
  }, [comboLegs, matchMap, predMap, nowMs]);

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

  const handleStakeInput = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.,]/g, "");
    const parts = cleaned.split(/[.,]/);
    const normalized =
      parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}` : parts[0];
    setStakeText(normalized);
    setError(null);
  };

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
    if (!canSubmit) return;
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
          });
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
          });
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
          })),
          stake,
        });
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
      const msg = e instanceof Error ? e.message : "Validation du coupon impossible";
      setError(msg);
      toast({ kind: "error", title: "Coupon refusé", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // État après validation réussie
  if (receipt && comboLegs.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1360px] px-4 pt-6 pb-8 lg:px-8 lg:py-10">
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
    <div className="mx-auto w-full max-w-[1360px] px-4 pt-4 pb-8 lg:px-8 lg:py-6">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink lg:text-[25px]">
              Coupon de pari
            </h1>
            {enrichedLegs.length > 0 && (
              <span className="rounded-full bg-betclic-red px-2 py-0.5 font-display text-[11px] font-bold text-white">
                {enrichedLegs.length}/{MAX_COMBO_LEGS}
              </span>
            )}
          </div>
          <p className="text-[12px] text-mist lg:text-[13px]">
            {enrichedLegs.length === 0
              ? "Coupon de pari · Simple & Combiné"
              : isCombo
                ? `Pari combiné · ${enrichedLegs.length} événements`
                : "Pari simple · Ajoutez une cote pour un combiné"}
          </p>
        </div>

        {enrichedLegs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              clearCombo();
              setError(null);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-elev px-3 font-display text-[11.5px] font-bold text-mist hover:bg-edge/80 hover:text-ink active:bg-edge active:text-ink"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.1} />
            Vider
          </button>
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
        </div>
      ) : (
        <div className="mt-4 space-y-3 lg:mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start lg:gap-6 lg:space-y-0">
          {/* Colonne gauche desktop : Bonus Combiné + Sélections */}
          <div className="space-y-3">
          {/* Jauge Bonus Combiné 1xBet */}
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

              return (
                <div
                  key={leg.uid}
                  className={cn(
                    "glass-card rounded-2xl p-3.5",
                    leg.closed && "border-betclic-red/40 bg-betclic-red/[0.04]"
                  )}
                >
                  {/* En-tête : type + ligue + statut + retrait */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-mist">
                      {leg.kind === "sport" && leg.resolvedSource && (
                        <span
                          className={cn(
                            "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase tracking-wide",
                            leg.resolvedSource === "manual"
                              ? "bg-emerald-600/12 text-emerald-700"
                              : "bg-elev text-dim"
                          )}
                        >
                          {leg.resolvedSource === "manual" ? "Réel" : "Virtuel"}
                        </span>
                      )}
                      <span className="truncate font-semibold">{leg.league}</span>
                      {leg.isLive && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display text-[10px] font-bold tabular-nums text-betclic-red">
                          <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                          {leg.matchObj?.minute ?? "LIVE"}
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
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elev text-mist active:bg-edge active:text-ink"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                  </div>

                  {/* Équipes alignées exactement comme sur la page Matchs */}
                  <button
                    type="button"
                    onClick={() => {
                      if (leg.kind === "sport" && leg.matchObj) {
                        if (leg.matchObj.status === "finished") {
                          router.push(`/resultats?match=${leg.matchObj.id}`);
                        } else {
                          openMarkets(leg.matchObj);
                        }
                      } else if (leg.kind === "sport" && leg.matchId) {
                        router.push(`/resultats?match=${leg.matchId}`);
                      } else {
                        router.push("/predictions");
                      }
                    }}
                    className="mt-2.5 block w-full text-left"
                  >
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
                      <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-betclic-red">
                        {formatOdds(leg.liveOdds, oddsFormat)}
                      </span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Bouton ajouter d'autres sélections */}
          {enrichedLegs.length < MAX_COMBO_LEGS && (
            <Link
              href="/matchs"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-edge bg-white/70 font-display text-[12.5px] font-semibold text-mist hover:bg-elev/60 active:bg-elev"
            >
              <Plus className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
              Ajouter une sélection (appui long ou mode Combiné 1-clic)
            </Link>
          )}
          </div>

          {/* Bloc Mise & Validation (collant à droite sur desktop) */}
          <div className="glass-card rounded-2xl p-3.5 space-y-3 lg:sticky lg:top-[84px] lg:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-mist">Votre mise</span>
              <span className="text-[11.5px] text-dim">
                Solde : <strong className="font-semibold text-ink">{eur(balance)}</strong>
              </span>
            </div>

            <div className="flex h-12 items-center justify-between rounded-xl border border-edge bg-elev/60 px-3.5 focus-within:border-ink">
              <input
                type="text"
                inputMode="decimal"
                value={stakeText}
                onChange={(e) => handleStakeInput(e.target.value)}
                placeholder="10"
                className="w-full bg-transparent font-display text-[18px] font-bold tabular-nums text-ink outline-none"
              />
              <span className="font-display text-[15px] font-bold text-dim">€</span>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {QUICK_STAKES.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => {
                    setStakeText(String(amt));
                    setError(null);
                  }}
                  className={cn(
                    "h-8 rounded-lg font-display text-[12px] font-bold transition-colors",
                    stake === amt
                      ? "bg-ink text-white"
                      : "bg-elev text-ink active:bg-edge"
                  )}
                >
                  {amt} €
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (balance > 0) {
                    setStakeText(String(Math.floor(balance * 100) / 100));
                    setError(null);
                  }
                }}
                className="h-8 rounded-lg bg-elev font-display text-[12px] font-bold text-betclic-red active:bg-edge"
              >
                Max
              </button>
            </div>

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
