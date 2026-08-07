"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ArrowRight, Check, Loader2, Ticket, TrendingUp, X } from "lucide-react";
import { api, type ClientPrediction } from "@/lib/api";
import { useApp } from "./providers";
import { AnimatedNumber } from "./animated-number";
import { cn, eur, formatOdds } from "@/lib/format";

const CHIP_AMOUNTS = [5, 10, 25, 50];

interface Props {
  question: ClientPrediction | null;
  selection: "yes" | "no" | null;
  onClose: () => void;
}

/** Feuille de pari Oui/Non pour les questions de prédiction. */
export function PredictionBetModal({ question, selection, onClose }: Props) {
  const router = useRouter();
  const { balance, setBalance, bumpBets, oddsFormat, toast } = useApp();
  const dragControls = useDragControls();
  const [cents, setCents] = useState(2500);
  const [phase, setPhase] = useState<"input" | "loading" | "success">("input");
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ id: number; potentialWin: number } | null>(null);

  const open = question !== null && selection !== null;

  useEffect(() => {
    if (open) {
      setCents(2500);
      setPhase("input");
      setError(null);
      setPlaced(null);
    }
  }, [open, question?.id, selection]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const odds = selection === "yes" ? question?.oddsYes ?? 0 : question?.oddsNo ?? 0;
  const stake = cents / 100;
  const overBalance = stake > balance;
  const payout = stake * odds;
  const profit = payout - stake;

  const sliderMax = Math.max(1, Math.floor(balance));
  const sliderValue = Math.min(stake, sliderMax);
  const sliderPct = Math.min(100, (sliderValue / sliderMax) * 100);

  const confirm = async () => {
    if (!question || !selection || phase !== "input") return;
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
      setPlaced({ id: res.bet.id, potentialWin: res.bet.potentialWin });
      setPhase("success");
      toast({
        kind: "success",
        title: "Prédiction placée !",
        description: `${res.bet.selectionLabel} · ${eur(res.bet.stake)}`,
      });
    } catch (e) {
      setPhase("input");
      setError(e instanceof Error ? e.message : "Une erreur est survenue");
      toast({ kind: "error", title: "Pari refusé", description: "Vérifiez votre mise" });
    }
  };

  const goToBets = () => {
    onClose();
    router.push("/paris");
  };

  return (
    <AnimatePresence>
      {open && question && selection && (
        <div className="fixed inset-0 z-[70]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={phase === "success" ? undefined : onClose}
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          />

          <motion.div
            initial={{ y: "102%" }}
            animate={{ y: 0 }}
            exit={{ y: "102%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            drag={phase === "input" ? "y" : false}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 130 || info.velocity.y > 600) onClose();
            }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-[27.5rem] flex-col overflow-hidden rounded-t-[24px] border-t border-edge bg-surface shadow-[0_-20px_80px_-20px_rgba(0,0,0,0.3)]"
          >
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-betclic-red/70 to-transparent" />

            {phase === "success" && placed ? (
              <SuccessView
                betId={placed.id}
                payout={placed.potentialWin}
                stake={stake}
                question={question.question}
                selection={selection}
                onGoToBets={goToBets}
                onContinue={onClose}
              />
            ) : (
              <div className="no-scrollbar overflow-y-auto px-4 pb-4 pb-safe">
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  className="mx-auto mt-2 h-1 w-10 cursor-grab rounded-full bg-elev active:cursor-grabbing"
                />

                <div className="flex items-center justify-between pt-2.5">
                  <h2 className="font-display text-base font-bold tracking-tight">
                    Nouvelle prédiction
                  </h2>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={onClose}
                    className="glass-pill grid h-8 w-8 place-items-center rounded-full text-mist active:scale-90"
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" strokeWidth={2.2} />
                  </motion.button>
                </div>

                {/* Question + sélection */}
                <div className="glass-card mt-2.5 rounded-2xl px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-betclic-red/10 px-2 py-0.5 font-display text-[9px] font-bold tracking-[0.16em] text-betclic-red">
                      {question.category.toUpperCase()}
                    </span>
                    <span className="ml-auto text-[9.5px] font-medium text-dim">
                      Résolution ·{" "}
                      {new Intl.DateTimeFormat("fr-FR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(question.resolvesAt))}
                    </span>
                  </div>
                  <p className="mt-2 font-display text-[14px] font-bold leading-snug">
                    {question.question}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between rounded-lg bg-elev px-3 py-2">
                    <span className="text-[12px] font-semibold text-ink">
                      {selection === "yes" ? "Oui" : "Non"}
                    </span>
                    <span className="font-display text-[15px] font-bold tabular-nums text-betclic-red">
                      {formatOdds(odds, oddsFormat)}
                    </span>
                  </div>
                </div>

                {/* Montant */}
                <div className="mt-3 flex items-end justify-between px-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[9.5px] font-semibold tracking-[0.24em] text-dim">MISE</span>
                    <div
                      className={cn(
                        "flex items-baseline font-display text-[32px] font-bold leading-none tracking-tight tabular-nums",
                        overBalance ? "text-betclic-red" : "text-ink"
                      )}
                    >
                      {eur(stake)}
                      <span className="caret-blink ml-1 inline-block h-7 w-[3px] translate-y-0.5 rounded bg-betclic-red" />
                    </div>
                  </div>
                  <button
                    onClick={() => setCents(0)}
                    className="mb-0.5 text-[11px] font-medium text-dim underline-offset-2 active:underline"
                  >
                    Solde · {eur(balance)}
                  </button>
                </div>

                {/* Jetons rapides */}
                <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                  {CHIP_AMOUNTS.map((a) => (
                    <motion.button
                      key={a}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setCents((c) => Math.min(c + a * 100, 9_999_999))}
                      className="glass-pill rounded-lg py-1.5 font-display text-[12px] font-bold text-ink transition-colors active:border-betclic-red/50 active:bg-betclic-red/10 active:text-betclic-red"
                    >
                      +{a}€
                    </motion.button>
                  ))}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setCents(Math.floor(balance * 100))}
                    className="rounded-lg border border-betclic-red/40 bg-betclic-red/10 py-1.5 font-display text-[12px] font-bold text-betclic-red"
                  >
                    MAX
                  </motion.button>
                </div>

                {/* Curseur */}
                <div className="mt-1.5">
                  <input
                    type="range"
                    min={0}
                    max={sliderMax}
                    step={0.5}
                    value={sliderValue}
                    disabled={balance <= 0}
                    onChange={(e) => setCents(Math.round(Number(e.target.value) * 100))}
                    className="pulse-range"
                    style={{ "--fill": `${sliderPct}%` } as CSSProperties}
                    aria-label="Montant de la mise"
                  />
                  <div className="-mt-1 flex justify-between px-0.5 text-[9.5px] font-semibold text-dim">
                    <span>0 €</span>
                    <span>{eur(sliderMax)}</span>
                  </div>
                </div>

                {/* Gain potentiel */}
                <div className="mt-2.5 flex items-center justify-between px-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[9.5px] font-semibold tracking-[0.18em] text-dim">
                      GAIN POTENTIEL
                    </span>
                    <span className="text-[10.5px] font-medium text-betclic-red">
                      +{eur(Math.max(profit, 0))}
                    </span>
                  </div>
                  <AnimatedNumber
                    value={payout}
                    format={eur}
                    className="font-display text-[22px] font-bold tabular-nums text-betclic-red"
                  />
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }}
                      exit={{ opacity: 0 }}
                      className="mt-1.5 text-center text-[11px] font-semibold text-live"
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* CTA */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={stake <= 0 || overBalance || phase === "loading"}
                  onClick={confirm}
                  className={cn(
                    "mt-2.5 flex h-[50px] w-full items-center justify-center gap-2 rounded-xl font-display text-[14.5px] font-bold transition-opacity",
                    stake > 0 && !overBalance
                      ? "bg-[linear-gradient(135deg,#E10014,#FB6962)] text-white shadow-[0_14px_38px_-10px_rgba(225,0,20,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]"
                      : "bg-elev text-dim"
                  )}
                >
                  {phase === "loading" ? (
                    <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
                  ) : (
                    <>
                      Valider la prédiction
                      <span className="opacity-60">·</span>
                      {eur(stake)}
                      <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
                    </>
                  )}
                </motion.button>
                <p className="mt-1.5 text-center text-[9.5px] leading-snug text-dim">
                  18+ · Jouer comporte des risques : endettement, isolement, dépendance.
                </p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function SuccessView({
  betId,
  payout,
  stake,
  question,
  selection,
  onGoToBets,
  onContinue,
}: {
  betId: number;
  payout: number;
  stake: number;
  question: string;
  selection: "yes" | "no";
  onGoToBets: () => void;
  onContinue: () => void;
}) {
  const { oddsFormat } = useApp();

  return (
    <div className="no-scrollbar overflow-y-auto px-4 pb-5 pb-safe">
      <div className="flex flex-col items-center pt-8 text-center">
        <div className="relative">
          {[...Array(12)].map((_, i) => (
            <motion.span
              key={i}
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
              style={{ background: i % 3 === 0 ? "#FB6962" : "var(--color-betclic-red)" }}
              initial={{ x: -3, y: -3, scale: 1, opacity: 1 }}
              animate={{
                x: Math.cos((i / 12) * Math.PI * 2) * (70 + (i % 4) * 14),
                y: Math.sin((i / 12) * Math.PI * 2) * (80 + (i % 3) * 16),
                scale: 0.3,
                opacity: 0,
              }}
              transition={{ duration: 1.1, delay: 0.18, ease: "easeOut" }}
            />
          ))}
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.1 }}
            className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[linear-gradient(135deg,#E10014,#FB6962)] shadow-[0_0_50px_-8px_rgba(225,0,20,0.75),inset_0_1px_0_rgba(255,255,255,0.5)]"
          >
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}>
          <h3 className="mt-6 font-display text-[22px] font-bold">Prédiction confirmée !</h3>
          <p className="mt-1 text-[12px] text-mist">
            Votre ticket est enregistré et suivi en temps réel
          </p>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.34 }}
        className="glass-card relative mt-5 overflow-hidden rounded-2xl"
      >
        <span className="pointer-events-none absolute right-3 top-3 rotate-[8deg] rounded border border-betclic-red/50 px-1.5 py-0.5 font-display text-[8px] font-bold tracking-[0.18em] text-betclic-red/80">
          CONFIRMÉ
        </span>
        <div className="px-3.5 pt-3">
          <div className="flex items-center gap-2.5 pr-16">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-betclic-red/10 text-betclic-red">
              <TrendingUp className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <p className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold">
              {question}
            </p>
          </div>
          <div className="mt-2.5 flex items-center justify-between rounded-lg bg-elev px-3 py-2">
            <span className="text-[12px] font-semibold text-ink">
              {selection === "yes" ? "Oui" : "Non"}
            </span>
            <span className="font-display text-[14px] font-bold tabular-nums text-betclic-red">
              {formatOdds(payout / stake, oddsFormat)}
            </span>
          </div>
        </div>

        <div className="relative mx-3.5 mt-3 border-t border-dashed border-edge">
          <span className="absolute -left-[24px] -top-[10px] h-5 w-5 rounded-full bg-surface" />
          <span className="absolute -right-[24px] -top-[10px] h-5 w-5 rounded-full bg-surface" />
        </div>

        <div className="grid grid-cols-3 gap-2 px-3.5 py-3">
          <div>
            <p className="text-[8.5px] font-semibold tracking-[0.16em] text-dim">MISE</p>
            <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums">{eur(stake)}</p>
          </div>
          <div>
            <p className="text-[8.5px] font-semibold tracking-[0.16em] text-dim">COTE</p>
            <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums">
              {formatOdds(payout / stake, oddsFormat)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[8.5px] font-semibold tracking-[0.16em] text-dim">À GAGNER</p>
            <p className="glow-betclic mt-0.5 font-display text-[13px] font-bold tabular-nums text-betclic-red">
              {eur(payout)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-edge px-3.5 py-2.5">
          <div className="barcode h-6 w-28 opacity-60" aria-hidden />
          <p className="font-display text-[9px] font-semibold tracking-[0.22em] text-dim">
            N° {String(betId).padStart(5, "0")}
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.42 }}
        className="mt-4"
      >
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onGoToBets}
          className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#E10014,#FB6962)] font-display text-[14.5px] font-bold text-white shadow-[0_14px_38px_-10px_rgba(225,0,20,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]"
        >
          <Ticket className="h-4.5 w-4.5" strokeWidth={2.4} />
          Voir mes paris
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onContinue}
          className="glass-card mt-2 flex h-11 w-full items-center justify-center rounded-xl font-display text-[13px] font-semibold text-ink active:bg-elev"
        >
          Continuer à prédire
        </motion.button>
      </motion.div>
    </div>
  );
}
