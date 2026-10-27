"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ArrowRight, Check, Flame, Layers, Loader2, Plus, Trash2, X, Zap } from "lucide-react";
import { ApiRequestError, api } from "@/lib/api";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  MIN_COMBO_LEGS,
  nextComboBoostTier,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import {
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/odds-lock";
import { AnimatedNumber } from "./animated-number";
import { CardOverlayLink } from "./card-overlay-link";
import { OddsLockControls } from "./odds-lock-controls";
import { TeamAvatar } from "./team-avatar";
import { TouchStakePad } from "./touch-stake-pad";
import { useApp } from "./providers";
import { cn, eur, formatOdds } from "@/lib/format";

export interface ComboSelection {
  uid: string; // ex: "sport-12" ou "pred-5" (1 seule par événement)
  kind: "sport" | "prediction";
  matchId?: number;
  matchSource?: "virtual" | "manual";
  questionId?: number;
  title: string;
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  league: string;
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  startsAt?: string | null;
  isLive?: boolean;
}

export function ComboFloatingBar() {
  const pathname = usePathname();
  const {
    comboLegs,
    comboOpen,
    comboQuickMode,
    setComboQuickMode,
    openCombo,
    clearCombo,
    target,
    marketMatch,
    rechargeOpen,
    oddsFormat,
  } = useApp();

  // Affiché uniquement sur les pages de paris (/matchs, /predictions, /paris) et jamais sur /tap
  const allowedRoute =
    pathname === "/matchs" ||
    pathname.startsWith("/matchs/") ||
    pathname === "/predictions" ||
    pathname.startsWith("/predictions/") ||
    pathname === "/paris";

  if (!allowedRoute || comboLegs.length === 0 || comboOpen || target || marketMatch || rechargeOpen) {
    return null;
  }

  const quote = computeComboQuote(
    comboLegs.map((l) => l.odds),
    10
  );

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[66px] z-40 mx-auto w-full max-w-[440px] px-3.5 lg:bottom-6 lg:left-auto lg:right-8 lg:mx-0 lg:max-w-[420px] lg:px-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="pointer-events-auto flex items-center justify-between gap-2 rounded-2xl border border-ink/15 bg-ink px-3.5 py-2.5 text-white shadow-xl"
      >
        <button
          type="button"
          onClick={openCombo}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-betclic-red font-display text-[12.5px] font-bold text-white">
            {comboLegs.length}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-[13px] font-bold">
                {comboLegs.length === 1 ? "Coupon (1 sélection)" : "Coupon de pari · Combiné"}
              </span>
              {quote.boostPct > 0 && (
                <span className="rounded-md bg-emerald-500/25 px-1.5 py-0.5 font-display text-[10px] font-bold text-emerald-300">
                  +{quote.boostPct}% Bonus
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-white/70">
              Cote totale{" "}
              <strong className="font-display font-bold text-white">
                {formatOdds(quote.totalOdds, oddsFormat)}
              </strong>
            </p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setComboQuickMode(!comboQuickMode)}
            title="Mode ajout 1-clic sur les cotes"
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-xl px-2.5 font-display text-[10.5px] font-bold transition-colors active:scale-95",
              comboQuickMode
                ? "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/40"
                : "bg-white/10 text-white/75"
            )}
          >
            <Zap className="h-3 w-3" strokeWidth={2.5} />
            1-clic
          </button>
          <button
            type="button"
            onClick={openCombo}
            className="h-8 rounded-xl bg-betclic-red px-3 font-display text-[11.5px] font-bold text-white active:scale-95"
          >
            Ouvrir
          </button>
          <button
            type="button"
            onClick={clearCombo}
            aria-label="Vider le coupon"
            className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-white/75 active:bg-white/20"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.3} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function ComboSheet() {
  const router = useRouter();
  const dragControls = useDragControls();
  const {
    comboLegs,
    comboOpen,
    closeCombo,
    removeComboLeg,
    clearCombo,
    applyComboOddsUpdates,
    oddsPolicy,
    setOddsPolicy,
    balance,
    setBalance,
    bumpBets,
    openRecharge,
    oddsFormat,
    toast,
    user,
  } = useApp();

  const [stakeText, setStakeText] = useState("10");
  const [phase, setPhase] = useState<"input" | "loading" | "success">("input");
  const [error, setError] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);
  const [placedInfo, setPlacedInfo] = useState<{
    id: number;
    totalOdds: number;
    stake: number;
    potentialWin: number;
    boostPct: number;
  } | null>(null);

  if (!comboOpen) return null;

  const parsed = Number(stakeText.replace(",", "."));
  const stake = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const overBalance = stake > balance;
  const belowMin = stake > 0 && stake < 0.5;
  const enoughLegs = comboLegs.length >= MIN_COMBO_LEGS;

  const quote = computeComboQuote(
    comboLegs.map((l) => l.odds),
    stake
  );
  const nextBoost = nextComboBoostTier(quote.eligibleLegs);

  const canSubmit =
    phase === "input" &&
    enoughLegs &&
    comboLegs.length <= MAX_COMBO_LEGS &&
    stake >= 0.5 &&
    !overBalance;

  const submitCombo = async () => {
    if (!canSubmit || inFlightRef.current) return;
    inFlightRef.current = true;
    const legsSig = comboLegs
      .map((l) => `${l.uid}:${l.market}:${l.selection}:${roundOdds2(l.odds)}`)
      .join("|");
    const sig = `${legsSig}::${stake}::${quote.totalOdds}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = { key: generateBetIdempotencyKey(), sig };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setPhase("loading");
    setError(null);
    try {
      const res = await api.placeComboBet({
        legs: comboLegs.map((l) => ({
          kind: l.kind,
          ...(l.matchId ? { matchId: l.matchId } : {}),
          ...(l.questionId ? { questionId: l.questionId } : {}),
          market: l.market,
          selection: l.selection,
          expectedOdds: roundOdds2(l.odds),
        })),
        stake,
        expectedTotalOdds: quote.totalOdds,
        oddsPolicy,
        idempotencyKey,
      });
      idempotencySlotRef.current = null;
      setOddsChanged(null);
      setBalance(res.balance);
      bumpBets();
      playUiSound(user?.sound, "bet");
      triggerHaptic(user?.haptics, [18, 30]);
      setPlacedInfo(res.bet);
      clearCombo();
      setPhase("success");
    } catch (e) {
      setPhase("input");
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
        if (e.details.updatedLegs && e.details.updatedLegs.length > 0) {
          applyComboOddsUpdates(e.details.updatedLegs);
        }
        triggerHaptic(user?.haptics, [12, 20]);
        return;
      }
      setOddsChanged(null);
      const msg = e instanceof Error ? e.message : "Validation impossible";
      setError(msg);
      toast({ kind: "error", title: "Combiné refusé", description: msg });
    } finally {
      inFlightRef.current = false;
    }
  };

  const finishAndClose = (goBets = false) => {
    setPhase("input");
    setPlacedInfo(null);
    setError(null);
    setOddsChanged(null);
    closeCombo();
    if (goBets) router.push("/paris");
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[75]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={phase === "loading" ? undefined : () => finishAndClose(false)}
          className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        />

        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          drag={phase === "input" ? "y" : false}
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 550) finishAndClose(false);
          }}
          className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[85dvh] lg:max-w-[500px] lg:rounded-3xl lg:border"
        >
          {phase === "success" && placedInfo ? (
            <div className="px-5 pb-7 pt-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-win/15 text-win">
                <Check className="h-7 w-7" strokeWidth={2.6} />
              </div>
              <h3 className="mt-3 font-display text-[19px] font-bold text-ink">
                Pari combiné accepté !
              </h3>
              <p className="mt-1 text-[12.5px] text-mist">
                Cote totale{" "}
                <strong className="text-ink">{formatOdds(placedInfo.totalOdds, oddsFormat)}</strong>
                {placedInfo.boostPct > 0 && ` (+${placedInfo.boostPct}% Bonus inclus)`}
              </p>

              <div className="mt-4 flex items-center justify-between rounded-2xl bg-elev px-4 py-3 text-left">
                <div>
                  <p className="text-[11px] text-dim">Mise : {eur(placedInfo.stake)}</p>
                  <p className="font-display text-[12.5px] font-semibold text-ink">
                    Gain potentiel
                  </p>
                </div>
                <span className="font-display text-[20px] font-bold tabular-nums text-win">
                  {eur(placedInfo.potentialWin)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => finishAndClose(true)}
                  className="h-11 rounded-2xl bg-betclic-red font-display text-[13px] font-bold text-white"
                >
                  Voir mes paris
                </button>
                <button
                  type="button"
                  onClick={() => finishAndClose(false)}
                  className="h-11 rounded-2xl bg-elev font-display text-[13px] font-bold text-ink"
                >
                  Continuer
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* En-tête fixe */}
              <div className="shrink-0 border-b border-edge px-4 pb-3 pt-2">
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  className="mx-auto h-1 w-10 cursor-grab rounded-full bg-edge active:cursor-grabbing"
                />
                <div className="mt-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-betclic-red/12 text-betclic-red">
                      <Layers className="h-4 w-4" strokeWidth={2.3} />
                    </span>
                    <div>
                      <h2 className="font-display text-[16px] font-bold text-ink">
                        Coupon de pari ({comboLegs.length}/{MAX_COMBO_LEGS})
                      </h2>
                      <p className="text-[11px] text-dim">
                        Pari combiné · 2 à 8 événements
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {comboLegs.length > 0 && (
                      <button
                        type="button"
                        onClick={clearCombo}
                        className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist active:scale-95"
                        aria-label="Tout vider"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.1} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => finishAndClose(false)}
                      className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist active:scale-95"
                      aria-label="Fermer"
                    >
                      <X className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Zone scrollable en bloc standard */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
                {/* Jauge Bonus Combiné */}
                <div className="rounded-2xl border border-emerald-600/20 bg-emerald-500/8 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className="flex items-center gap-1.5 font-display font-bold text-emerald-800">
                      <Flame className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.4} />
                      {quote.boostPct > 0
                        ? `Bonus Combiné actif : +${quote.boostPct}%`
                        : "Bonus Combiné jusqu'à +25%"}
                    </span>
                    {nextBoost && (
                      <span className="text-[10.5px] font-semibold text-emerald-700">
                        +{nextBoost.needed} sél. (≥1,25) → +{nextBoost.pct}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Liste des sélections (du plus présent au plus futur) */}
                <div className="mt-3 space-y-2.5">
                  {sortSlipSelectionsChronologically(comboLegs).map((leg) => {
                    const splitTeams =
                      leg.kind === "sport" && (!leg.homeTeam || !leg.awayTeam) && leg.title.includes("–")
                        ? leg.title.split("–").map((s) => s.trim())
                        : null;
                    const homeName = leg.homeTeam || splitTeams?.[0] || "";
                    const awayName = leg.awayTeam || splitTeams?.[1] || "";
                    const hasSportTeams = leg.kind === "sport" && Boolean(homeName && awayName);
                    const legHref =
                      leg.kind === "sport" && leg.matchId
                        ? `/matchs/${leg.matchId}`
                        : leg.kind === "prediction" && leg.questionId
                          ? `/predictions/${leg.questionId}`
                          : "/predictions";

                    return (
                      <div
                        key={leg.uid}
                        className="relative cursor-pointer overflow-hidden rounded-2xl border border-edge bg-white p-3 transition-colors hover:bg-elev/20 active:bg-elev/45"
                      >
                        <CardOverlayLink
                          href={legHref}
                          label={hasSportTeams ? `${homeName} – ${awayName}` : leg.title}
                          onBeforeNavigate={() => finishAndClose(false)}
                        />
                        <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {leg.kind === "sport" && leg.matchSource && (
                              <span
                                className={cn(
                                  "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide",
                                  leg.matchSource === "manual"
                                    ? "bg-emerald-600/12 text-emerald-700"
                                    : "bg-elev text-dim"
                                )}
                              >
                                {leg.matchSource === "manual" ? "Réel" : "Virtuel"}
                              </span>
                            )}
                            <p className="truncate text-[11px] font-semibold text-mist">
                              {leg.league}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeComboLeg(leg.uid)}
                            className="pointer-events-auto relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elev text-mist active:bg-edge"
                            aria-label="Retirer"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                          </button>
                        </div>

                        {hasSportTeams ? (
                          <div className="pointer-events-none relative z-[1] mt-2 flex flex-col gap-1.5">
                            <div className="flex items-center gap-2.5">
                              <TeamAvatar
                                name={homeName}
                                logo={leg.homeLogo}
                                size="xs"
                              />
                              <span className="truncate font-display text-[13.5px] font-semibold text-ink">
                                {homeName}
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <TeamAvatar
                                name={awayName}
                                logo={leg.awayLogo}
                                size="xs"
                              />
                              <span className="truncate font-display text-[13.5px] font-semibold text-ink">
                                {awayName}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="pointer-events-none relative z-[1] mt-1.5 font-display text-[13.5px] font-bold text-ink">
                            {leg.title}
                          </p>
                        )}

                        <div className="pointer-events-none relative z-[1] mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
                          <span className="truncate pr-2 text-[12px] font-semibold text-ink">
                            {leg.selectionLabel}
                          </span>
                          <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-betclic-red">
                            {formatOdds(leg.odds, oddsFormat)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!enoughLegs && (
                  <p className="mt-3 rounded-xl bg-elev px-3 py-2 text-center text-[11.5px] font-medium text-mist">
                    Ajoutez encore au moins <strong>1 sélection</strong> depuis Matchs ou
                    Prédictions pour former un pari combiné.
                  </p>
                )}

                {/* Mise + pavé numérique tactile mobile */}
                <div className="mt-4">
                  <TouchStakePad
                    id="combo-sheet-stake"
                    label="Mise du coupon"
                    stakeText={stakeText}
                    onChangeStakeText={(next) => {
                      setStakeText(next);
                      setError(null);
                    }}
                    balance={balance}
                    maxCap={200}
                    hasError={overBalance || belowMin}
                    haptics={user?.haptics}
                    collapsibleOnMobile
                    defaultExpandedOnMobile={false}
                  />
                </div>

                {overBalance && (
                  <div className="mt-2.5 flex items-center justify-between rounded-xl border border-betclic-red/25 bg-betclic-red/5 px-3 py-2 text-[12px]">
                    <span className="font-medium text-betclic-red">Solde insuffisant</span>
                    <button
                      type="button"
                      onClick={() => {
                        closeCombo();
                        openRecharge();
                      }}
                      className="inline-flex items-center gap-1 font-display font-bold text-betclic-red underline"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Recharger
                    </button>
                  </div>
                )}

                {error && !overBalance && (
                  <p className="mt-2.5 rounded-xl bg-betclic-red/8 px-3 py-2 text-[12px] font-medium text-betclic-red">
                    {error}
                  </p>
                )}

                {/* Récapitulatif Cote & Gain */}
                <div className="mt-3.5 rounded-2xl bg-elev px-3.5 py-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-mist">Cote combinée totale</span>
                    <span className="font-display font-bold tabular-nums text-ink">
                      {formatOdds(quote.totalOdds, oddsFormat)}
                    </span>
                  </div>
                  {quote.boostAmount > 0 && (
                    <div className="mt-1 flex items-center justify-between text-[11.5px] text-win">
                      <span>Bonus Combiné (+{quote.boostPct}%)</span>
                      <span className="font-display font-bold tabular-nums">
                        +{eur(quote.boostAmount)}
                      </span>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t border-edge pt-2">
                    <span className="font-display text-[13px] font-bold text-ink">
                      Gain potentiel
                    </span>
                    <AnimatedNumber
                      value={enoughLegs ? quote.potentialWin : 0}
                      format={eur}
                      className="font-display text-[20px] font-bold tabular-nums text-win"
                    />
                  </div>
                </div>

                <OddsLockControls
                  feedKind={
                    comboLegs.every((l) => l.kind === "prediction")
                      ? "predictions"
                      : "matches"
                  }
                  oddsFormat={oddsFormat}
                  oddsPolicy={oddsPolicy}
                  onChangePolicy={setOddsPolicy}
                  oddsChanged={oddsChanged}
                />

                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submitCombo}
                  className={cn(
                    "mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14.5px] font-bold transition-all active:scale-[0.99]",
                    canSubmit ? "bg-betclic-red text-white shadow-sm" : "bg-elev text-dim"
                  )}
                >
                  {phase === "loading" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                      Validation du coupon…
                    </>
                  ) : oddsChanged ? (
                    <>
                      Accepter la nouvelle cote ({formatOdds(quote.totalOdds, oddsFormat)})
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </>
                  ) : (
                    <>
                      Placer le pari combiné {stake > 0 ? `(${eur(stake)})` : ""}
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
