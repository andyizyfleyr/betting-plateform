"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ArrowRight, Check, Layers, Loader2, Plus, Ticket, X } from "lucide-react";
import { ApiRequestError, api, type ClientPrediction } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import {
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/odds-lock";
import { useApp } from "./providers";
import { triggerRouteLoader } from "./pulse-flash-loader";
import { AnimatedNumber } from "./animated-number";
import { OddsLockControls } from "./odds-lock-controls";
import { TouchStakePad } from "./touch-stake-pad";
import {
  formatLocalAmount,
  formatLocalInputString,
  localToEur,
  maxSpendableLocalFromEur,
} from "@/lib/countries";
import { cn, eur, formatKickoff, formatOdds } from "@/lib/format";

interface Props {
  question: ClientPrediction | null;
  selection: string | null;
  onClose: () => void;
}

function getSelectionMeta(question: ClientPrediction, selection: string) {
  if (question.options && question.options.length >= 2) {
    const opt = question.options.find((o) => o.key === selection);
    if (opt) return { label: opt.label, odds: opt.odds };
  }
  const isYes = selection === "yes";
  return {
    label: isYes ? "Oui" : "Non",
    odds: isYes ? question.oddsYes : question.oddsNo,
  };
}

export function PredictionBetModal({ question, selection, onClose }: Props) {
  const open = question !== null && selection !== null;

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && question && selection && (
        <PredictionBetSheet
          key={`${question.id}-${selection}`}
          question={question}
          selection={selection}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  );
}

function PredictionBetSheet({
  question,
  selection,
  onClose,
}: {
  question: ClientPrediction;
  selection: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const {
    balance,
    setBalance,
    bumpBets,
    oddsFormat,
    oddsPolicy,
    setOddsPolicy,
    toast,
    openRecharge,
    comboLegs,
    toggleComboLeg,
    authReady,
    user,
    currency,
    currencyConfig,
    bettingLimits,
    bettingLimitsReady,
    maxPayoutEur,
  } = useApp();
  const dragControls = useDragControls();

  const computeDefaultStakeStr = () => {
    const maxLocal = maxSpendableLocalFromEur(balance, currency);
    const def =
      balance > 0 && maxLocal >= currencyConfig.minStakeLocal
        ? Math.min(currencyConfig.defaultStakeLocal, maxLocal)
        : currencyConfig.defaultStakeLocal;
    return formatLocalInputString(def, currency, ".");
  };

  const [prevCur, setPrevCur] = useState(currency);
  const [stakeText, setStakeText] = useState(computeDefaultStakeStr);
  if (prevCur !== currency) {
    setPrevCur(currency);
    setStakeText(computeDefaultStakeStr());
  }
  const [phase, setPhase] = useState<"input" | "loading" | "success">("input");
  const [error, setError] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState<OddsChangedDetails | null>(null);
  const [serverOverrideOdds, setServerOverrideOdds] = useState<number | null>(
    null
  );
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  useEffect(() => {
    if (serverOverrideOdds == null) return;
    const t = setTimeout(() => setServerOverrideOdds(null), 10_000);
    return () => clearTimeout(t);
  }, [serverOverrideOdds]);
  const [placed, setPlaced] = useState<{
    id: number;
    potentialWin: number;
    stake: number;
    odds: number;
    selectionLabel: string;
  } | null>(null);
  const [liveOdds, setLiveOdds] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await api.predictionsCatalog();
        if (!active) return;
        const fresh = r.questions.find((q) => q.id === question.id);
        if (fresh) {
          setLiveOdds(getSelectionMeta(fresh, selection).odds);
        }
      } catch {
        /* silencieux */
      }
    };
    poll();
    const id = setInterval(poll, 12_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [question.id, selection]);

  const initialMeta = getSelectionMeta(question, selection);
  const odds = roundOdds2(serverOverrideOdds ?? liveOdds ?? initialMeta.odds);
  const parsed = Number(stakeText.replace(",", "."));
  const localStake =
    Number.isFinite(parsed) && parsed > 0
      ? currencyConfig.decimals === 0
        ? Math.round(parsed)
        : Math.round(parsed * 100) / 100
      : 0;
  const stake = localToEur(localStake, currency, balance);
  const overBalance = Boolean(user) && stake > balance + 1e-5;
  const belowMin = localStake > 0 && localStake < currencyConfig.minStakeLocal;
  const payout = Math.min(maxPayoutEur, stake * odds);
  const profit = payout - stake;

  const comboUid = `pred-${question.id}`;
  const isMulti = Array.isArray(question.options) && question.options.length >= 2;
  const comboMarket = isMulti ? "multichoice" : "yesno";
  const inComboExact = comboLegs.some(
    (l) => l.uid === comboUid && l.selection === selection
  );

  const handleAddToCombo = () => {
    const res = toggleComboLeg({
      uid: comboUid,
      kind: "prediction",
      questionId: question.id,
      title: question.question,
      league: question.category,
      market: comboMarket,
      selection,
      selectionLabel: initialMeta.label,
      odds,
      startsAt: question.resolvesAt,
    });
    if (res === "full") {
      toast({ kind: "error", title: "Coupon complet (limite atteinte)" });
      return;
    }
    if (res === "removed") {
      toast({ kind: "info", title: "Retiré du coupon" });
    } else {
      toast({
        kind: "success",
        title: res === "replaced" ? "Choix remplacé dans le coupon" : "Ajouté au coupon de pari",
        description: `${initialMeta.label} · Cote ${formatOdds(odds, oddsFormat)}`,
      });
      onClose();
    }
  };

  const confirm = async () => {
    if (
      phase !== "input" ||
      !bettingLimitsReady || localStake > currencyConfig.maxComboStakeLocal ||
      localStake < currencyConfig.minStakeLocal ||
      overBalance ||
      inFlightRef.current
    ) {
      return;
    }
    if (!authReady && !user) return;
    if (!user) {
      onClose();
      router.push("/auth/connexion");
      return;
    }
    inFlightRef.current = true;
    const sig = `${question.id}:${selection}:${stake}:${odds}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = { key: generateBetIdempotencyKey(), sig };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setPhase("loading");
    setError(null);
    try {
      const res = await api.placePredictionBet({
        expectedMaxPayoutXof: bettingLimits.maxPayoutXof,
        questionId: question.id,
        selection,
        stake,
        expectedOdds: odds,
        oddsPolicy,
        idempotencyKey,
      });
      idempotencySlotRef.current = null;
      setOddsChanged(null);
      setServerOverrideOdds(null);
      setBalance(res.balance);
      bumpBets();
      playUiSound(user?.sound, "bet");
      triggerHaptic(user?.haptics, [18, 28]);
      setPlaced({
        id: res.bet.id,
        potentialWin: res.bet.potentialWin,
        stake: res.bet.stake,
        odds: res.bet.odds,
        selectionLabel: res.bet.selectionLabel,
      });
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
        setServerOverrideOdds(e.details.currentOdds);
        triggerHaptic(user?.haptics, [12, 20]);
        return;
      }
      setOddsChanged(null);
      const msg = e instanceof Error ? e.message : "Une erreur est survenue";
      setError(msg);
      toast({ kind: "error", title: "Pari refusé", description: msg });
    } finally {
      inFlightRef.current = false;
    }
  };

  const goToBets = () => {
    onClose();
    triggerRouteLoader("/paris");
    router.push("/paris");
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={phase === "success" ? undefined : onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
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
          if (info.offset.y > 120 || info.velocity.y > 550) onClose();
        }}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[86dvh] lg:max-w-[480px] lg:rounded-3xl lg:border"
      >
        {phase === "success" && placed ? (
          <SuccessView
            betId={placed.id}
            payout={placed.potentialWin}
            stake={placed.stake}
            odds={placed.odds}
            question={question.question}
            selectionLabel={placed.selectionLabel}
            onGoToBets={goToBets}
            onContinue={onClose}
          />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-4 pb-3 pt-2 lg:px-6 lg:pb-4 lg:pt-4">
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="mx-auto h-1 w-10 cursor-grab rounded-full bg-edge active:cursor-grabbing lg:hidden"
              />

              <div className="mt-2.5 flex items-center justify-between">
                <h2 className="font-display text-[12.5px] font-bold tracking-tight text-ink lg:text-[13.5px]">
                  Confirmer la prédiction
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist active:scale-95"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>

              {/* Question & choix */}
              <div className="mt-2.5 rounded-2xl border border-edge bg-elev/60 p-3">
                <div className="flex items-center justify-between text-[10px] text-dim">
                  <span className="rounded-md bg-white px-2 py-0.5 font-display text-[9.5px] font-medium uppercase text-ink">
                    {question.category}
                  </span>
                  <span>Clôture · {formatKickoff(question.resolvesAt)}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 font-display text-[11.5px] font-medium leading-snug text-ink">
                  {question.question}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-edge bg-white px-3 py-1.5">
                  <span className="min-w-0 truncate text-[10.5px] font-medium text-ink">
                    Choix : <span className="text-betclic-red">{initialMeta.label}</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-betclic-red px-2.5 py-1 font-display text-[11.5px] font-medium tabular-nums text-white">
                    {formatOdds(odds, oddsFormat)}
                  </span>
                </div>
              </div>

              {/* Saisie de la mise + jetons 5/10/25/50/MAX (pavé 0-9 replié par défaut sur mobile) */}
              <div className="mt-3">
                <TouchStakePad
                  id="pred-stake-input"
                  label="Votre mise"
                  stakeText={stakeText}
                  onChangeStakeText={(next) => {
                    setStakeText(next);
                    setError(null);
                  }}
                  balance={balance}
                  maxCap={currencyConfig.maxComboStakeLocal}
                  hasError={overBalance || belowMin}
                  haptics={user?.haptics}
                  collapsibleOnMobile
                  defaultExpandedOnMobile={false}
                />
              </div>

              {overBalance && (
                <div className="mt-2.5 flex items-center justify-between rounded-xl border border-betclic-red/25 bg-betclic-red/5 px-3 py-2 text-[10.5px]">
                  <span className="font-medium text-betclic-red">Solde insuffisant</span>
                  <button
                    type="button"
                    onClick={openRecharge}
                    className="inline-flex items-center gap-1 font-display font-medium text-betclic-red underline underline-offset-2"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Recharger
                  </button>
                </div>
              )}

              {belowMin && !overBalance && (
                <p className="mt-2 text-[10.5px] font-medium text-betclic-red">
                  Mise minimale : {formatLocalAmount(currencyConfig.minStakeLocal, currency)}
                </p>
              )}

              {error && !overBalance && (
                <p className="mt-2 rounded-xl bg-betclic-red/8 px-3 py-2 text-[10.5px] font-medium text-betclic-red">
                  {error}
                </p>
              )}

              <OddsLockControls
                feedKind="predictions"
                oddsFormat={oddsFormat}
                oddsPolicy={oddsPolicy}
                onChangePolicy={setOddsPolicy}
                oddsChanged={oddsChanged}
              />
            </div>

            {/* Pied épinglé en bas de la feuille : Gain potentiel + Validation immédiate sans scroller */}
            <div className="shrink-0 border-t border-edge bg-surface px-4 pb-4 pb-safe pt-2.5 lg:px-6 lg:pb-5">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-[10.5px] font-medium text-ink">
                    Gain potentiel
                  </span>
                  <span className="text-[10px] font-medium text-win">
                    +{eur(Math.max(profit, 0))} net
                  </span>
                </div>
                <AnimatedNumber
                  value={payout}
                  format={eur}
                  className="font-display text-[14.5px] font-medium tabular-nums text-win"
                />
              </div>

              <p className="mb-1 text-[10px] text-mist">Plafond de gain : {eur(maxPayoutEur)}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddToCombo}
                  aria-label={inComboExact ? "Retirer du coupon" : "Ajouter au combiné"}
                  className={cn(
                    "inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-2xl border px-3.5 font-display text-[10.5px] font-medium transition-colors active:scale-[0.99]",
                    inComboExact
                      ? "border-ink bg-ink text-white"
                      : "border-edge bg-elev text-ink active:bg-edge"
                  )}
                >
                  <Layers
                    className={cn(
                      "h-3.5 w-3.5",
                      inComboExact ? "text-white" : "text-betclic-red"
                    )}
                    strokeWidth={2.3}
                  />
                  <span>
                    {inComboExact
                      ? "Retirer"
                      : `+ Combiné${comboLegs.length > 0 ? ` (${comboLegs.length})` : ""}`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={
                    !bettingLimitsReady || localStake > currencyConfig.maxComboStakeLocal ||
      localStake < currencyConfig.minStakeLocal ||
                    overBalance ||
                    phase === "loading"
                  }
                  onClick={confirm}
                  className={cn(
                    "flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl px-3 font-display text-[11.5px] font-medium transition-all active:scale-[0.99]",
                    bettingLimitsReady && localStake <= currencyConfig.maxComboStakeLocal &&
    localStake >= currencyConfig.minStakeLocal && !overBalance
                      ? "bg-betclic-red text-white shadow-sm"
                      : "bg-elev text-dim"
                  )}
                >
                  {phase === "loading" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                      <span className="truncate">Validation…</span>
                    </>
                  ) : oddsChanged ? (
                    <>
                      <span className="truncate">
                        Accepter ({formatOdds(odds, oddsFormat)})
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                    </>
                  ) : (
                    <>
                      <span className="truncate">
                        Valider {stake > 0 ? eur(stake) : "la prédiction"}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

function SuccessView({
  betId,
  payout,
  stake,
  odds,
  question,
  selectionLabel,
  onGoToBets,
  onContinue,
}: {
  betId: number;
  payout: number;
  stake: number;
  odds: number;
  question: string;
  selectionLabel: string;
  onGoToBets: () => void;
  onContinue: () => void;
}) {
  const { oddsFormat } = useApp();

  return (
    <div className="no-scrollbar overflow-y-auto px-4 pb-5 pb-safe pt-6">
      <div className="flex flex-col items-center text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-win/12 text-win">
          <Check className="h-7 w-7" strokeWidth={2.8} />
        </div>
        <h3 className="mt-3 font-display text-[14.5px] font-bold text-ink">Pari accepté</h3>
        <p className="mt-0.5 text-[11px] text-mist">Coupon #{String(betId).padStart(5, "0")}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-edge bg-elev/50 p-3.5">
        <p className="font-display text-[11.5px] font-medium leading-snug text-ink">{question}</p>
        <p className="mt-1 text-[10.5px] font-medium text-mist">
          Réponse choisie : <strong className="text-ink">{selectionLabel}</strong>
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-3">
          <div>
            <p className="text-[9.5px] font-medium uppercase text-dim">Mise</p>
            <p className="mt-0.5 font-display text-[11.5px] font-medium tabular-nums text-ink">
              {eur(stake)}
            </p>
          </div>
          <div>
            <p className="text-[9.5px] font-medium uppercase text-dim">Cote</p>
            <p className="mt-0.5 font-display text-[11.5px] font-medium tabular-nums text-ink">
              {formatOdds(odds, oddsFormat)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9.5px] font-medium uppercase text-dim">Gain max</p>
            <p className="mt-0.5 font-display text-[11.5px] font-medium tabular-nums text-win">
              {eur(payout)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onGoToBets}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[11.5px] font-medium text-white active:opacity-95"
        >
          <Ticket className="h-4 w-4" strokeWidth={2.3} />
          Voir mes paris
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="flex h-11 w-full items-center justify-center rounded-2xl border border-edge bg-white font-display text-[11px] font-medium text-ink active:bg-elev"
        >
          Continuer
        </button>
      </div>
    </div>
  );
}
