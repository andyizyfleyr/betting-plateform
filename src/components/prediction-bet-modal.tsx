"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ArrowRight, Check, Loader2, Plus, Ticket, X } from "lucide-react";
import { api, type ClientPrediction } from "@/lib/api";
import { useApp } from "./providers";
import { AnimatedNumber } from "./animated-number";
import { cn, eur, formatKickoff, formatOdds } from "@/lib/format";

const QUICK_STAKES = [5, 10, 25, 50];

interface Props {
  question: ClientPrediction | null;
  selection: "yes" | "no" | null;
  onClose: () => void;
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
  selection: "yes" | "no";
  onClose: () => void;
}) {
  const router = useRouter();
  const { balance, setBalance, bumpBets, oddsFormat, toast, openRecharge } = useApp();
  const dragControls = useDragControls();

  const [stakeText, setStakeText] = useState(() => {
    const def = balance > 0 ? Math.min(10, Math.max(1, Math.floor(balance))) : 10;
    return String(def);
  });
  const [phase, setPhase] = useState<"input" | "loading" | "success">("input");
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{
    id: number;
    potentialWin: number;
    stake: number;
    odds: number;
  } | null>(null);
  const [liveOdds, setLiveOdds] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await api.predictions();
        if (!active) return;
        const fresh = r.questions.find((q) => q.id === question.id);
        if (fresh) {
          setLiveOdds(selection === "yes" ? fresh.oddsYes : fresh.oddsNo);
        }
      } catch {
        /* silencieux */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [question.id, selection]);

  const baseOdds = selection === "yes" ? question.oddsYes : question.oddsNo;
  const odds = liveOdds ?? baseOdds;
  const parsed = Number(stakeText.replace(",", "."));
  const stake = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const overBalance = stake > balance;
  const belowMin = stake > 0 && stake < 0.5;
  const payout = stake * odds;
  const profit = payout - stake;

  const handleStakeInput = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.,]/g, "");
    const parts = cleaned.split(/[.,]/);
    const normalized =
      parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}` : parts[0];
    setStakeText(normalized);
    setError(null);
  };

  const confirm = async () => {
    if (phase !== "input" || stake < 0.5 || overBalance) return;
    setPhase("loading");
    setError(null);
    try {
      const res = await api.placePredictionBet({
        questionId: question.id,
        selection,
        stake,
      });
      setBalance(res.balance);
      bumpBets();
      setPlaced({
        id: res.bet.id,
        potentialWin: res.bet.potentialWin,
        stake: res.bet.stake,
        odds: res.bet.odds,
      });
      setPhase("success");
    } catch (e) {
      setPhase("input");
      const msg = e instanceof Error ? e.message : "Une erreur est survenue";
      setError(msg);
      toast({ kind: "error", title: "Pari refusé", description: msg });
    }
  };

  const goToBets = () => {
    onClose();
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
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-t border-edge bg-surface shadow-2xl"
      >
        {phase === "success" && placed ? (
          <SuccessView
            betId={placed.id}
            payout={placed.potentialWin}
            stake={placed.stake}
            odds={placed.odds}
            question={question.question}
            selection={selection}
            onGoToBets={goToBets}
            onContinue={onClose}
          />
        ) : (
          <div className="no-scrollbar overflow-y-auto px-4 pb-5 pb-safe pt-2">
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="mx-auto h-1 w-10 cursor-grab rounded-full bg-edge active:cursor-grabbing"
            />

            <div className="mt-3 flex items-center justify-between">
              <h2 className="font-display text-[17px] font-bold tracking-tight text-ink">
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
            <div className="mt-3 rounded-2xl border border-edge bg-elev/60 p-3">
              <div className="flex items-center justify-between text-[11px] text-dim">
                <span className="rounded-md bg-white px-2 py-0.5 font-display text-[10px] font-bold uppercase text-ink">
                  {question.category}
                </span>
                <span>Clôture · {formatKickoff(question.resolvesAt)}</span>
              </div>
              <p className="mt-2 font-display text-[14px] font-semibold leading-snug text-ink">
                {question.question}
              </p>
              <div className="mt-2.5 flex items-center justify-between rounded-xl border border-edge bg-white px-3 py-2">
                <span className="text-[12.5px] font-semibold text-ink">
                  Choix :{" "}
                  <span className="text-betclic-red">{selection === "yes" ? "Oui" : "Non"}</span>
                </span>
                <span className="rounded-lg bg-betclic-red px-2.5 py-1 font-display text-[13.5px] font-bold tabular-nums text-white">
                  {formatOdds(odds, oddsFormat)}
                </span>
              </div>
            </div>

            {/* Saisie directe de la mise */}
            <div className="mt-3.5">
              <div className="flex items-center justify-between text-[11.5px]">
                <label htmlFor="pred-stake-input" className="font-semibold text-mist">
                  Votre mise
                </label>
                <span className="text-dim">
                  Solde : <strong className="font-semibold text-ink">{eur(balance)}</strong>
                </span>
              </div>

              <div
                className={cn(
                  "mt-1.5 flex h-13 items-center rounded-2xl border bg-white px-3.5 transition-colors",
                  overBalance || belowMin
                    ? "border-betclic-red"
                    : "border-edge focus-within:border-ink"
                )}
              >
                <input
                  id="pred-stake-input"
                  type="text"
                  inputMode="decimal"
                  value={stakeText}
                  onChange={(e) => handleStakeInput(e.target.value)}
                  placeholder="0"
                  className="w-full bg-transparent font-display text-[22px] font-bold tabular-nums text-ink outline-none placeholder:text-dim/50"
                />
                {stakeText && (
                  <button
                    type="button"
                    onClick={() => {
                      setStakeText("");
                      setError(null);
                    }}
                    className="mr-2 rounded-md bg-elev px-2 py-1 text-[11px] font-semibold text-mist active:bg-edge"
                  >
                    Effacer
                  </button>
                )}
                <span className="font-display text-[18px] font-bold text-dim">€</span>
              </div>

              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {QUICK_STAKES.map((amount) => {
                  const active = stake === amount;
                  return (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => {
                        setStakeText(String(amount));
                        setError(null);
                      }}
                      className={cn(
                        "h-9 rounded-xl border font-display text-[12.5px] font-bold transition-colors active:scale-95",
                        active
                          ? "border-ink bg-ink text-white"
                          : "border-edge bg-elev text-ink"
                      )}
                    >
                      {amount} €
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    const maxVal = Math.min(500, Math.max(0, Math.floor(balance * 100) / 100));
                    setStakeText(String(maxVal));
                    setError(null);
                  }}
                  className="h-9 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[12px] font-bold text-betclic-red active:scale-95"
                >
                  MAX
                </button>
              </div>
            </div>

            {overBalance && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-betclic-red/25 bg-betclic-red/5 px-3 py-2 text-[12px]">
                <span className="font-medium text-betclic-red">Solde insuffisant</span>
                <button
                  type="button"
                  onClick={openRecharge}
                  className="inline-flex items-center gap-1 font-display font-bold text-betclic-red underline underline-offset-2"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Recharger
                </button>
              </div>
            )}

            {belowMin && !overBalance && (
              <p className="mt-2 text-[11.5px] font-medium text-betclic-red">
                Mise minimale : 0,50 €
              </p>
            )}

            {error && !overBalance && (
              <p className="mt-2 rounded-xl bg-betclic-red/8 px-3 py-2 text-[12px] font-medium text-betclic-red">
                {error}
              </p>
            )}

            {/* Gain estimé */}
            <div className="mt-3.5 flex items-center justify-between rounded-2xl bg-elev px-3.5 py-3">
              <div>
                <p className="text-[11px] font-semibold text-mist">Gain estimé (pool mutuel)</p>
                <p className="text-[11px] font-medium text-win">
                  Bénéfice net +{eur(Math.max(profit, 0))}
                </p>
              </div>
              <AnimatedNumber
                value={payout}
                format={eur}
                className="font-display text-[20px] font-bold tabular-nums text-win"
              />
            </div>

            <button
              type="button"
              disabled={stake < 0.5 || overBalance || phase === "loading"}
              onClick={confirm}
              className={cn(
                "mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14.5px] font-bold transition-all active:scale-[0.99]",
                stake >= 0.5 && !overBalance
                  ? "bg-betclic-red text-white shadow-sm"
                  : "bg-elev text-dim"
              )}
            >
              {phase === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                  Validation…
                </>
              ) : (
                <>
                  Valider {stake > 0 ? eur(stake) : "la prédiction"}
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </>
              )}
            </button>
          </div>
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
  selection,
  onGoToBets,
  onContinue,
}: {
  betId: number;
  payout: number;
  stake: number;
  odds: number;
  question: string;
  selection: "yes" | "no";
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
        <h3 className="mt-3 font-display text-[20px] font-bold text-ink">Prédiction validée</h3>
        <p className="mt-0.5 text-[12.5px] text-mist">Ticket #{String(betId).padStart(5, "0")}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-edge bg-elev/50 p-3.5">
        <p className="font-display text-[13.5px] font-semibold leading-snug text-ink">{question}</p>
        <p className="mt-1 text-[12px] font-medium text-mist">
          Réponse choisie :{" "}
          <strong className="text-ink">{selection === "yes" ? "Oui" : "Non"}</strong>
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-dim">Mise</p>
            <p className="mt-0.5 font-display text-[13.5px] font-bold tabular-nums text-ink">
              {eur(stake)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-dim">Cote</p>
            <p className="mt-0.5 font-display text-[13.5px] font-bold tabular-nums text-ink">
              {formatOdds(odds, oddsFormat)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase text-dim">Estimé</p>
            <p className="mt-0.5 font-display text-[13.5px] font-bold tabular-nums text-win">
              {eur(payout)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onGoToBets}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[14px] font-bold text-white active:opacity-95"
        >
          <Ticket className="h-4 w-4" strokeWidth={2.3} />
          Voir mes paris
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="flex h-11 w-full items-center justify-center rounded-2xl border border-edge bg-white font-display text-[13px] font-semibold text-ink active:bg-elev"
        >
          Continuer
        </button>
      </div>
    </div>
  );
}
