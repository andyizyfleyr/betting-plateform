"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Delete, Loader2, Ticket, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { AnimatedNumber } from "./animated-number";
import { cn, eur, formatOdds } from "@/lib/format";

const CHIP_AMOUNTS = [5, 10, 25, 50];

export function BetModal() {
  const router = useRouter();
  const { target, closeBet, balance, setBalance, bumpBets, oddsFormat, toast } = useApp();
  const [cents, setCents] = useState(2500);
  const [phase, setPhase] = useState<"input" | "loading" | "success">("input");
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ id: number; potentialWin: number } | null>(null);

  useEffect(() => {
    if (target) {
      setCents(2500);
      setPhase("input");
      setError(null);
      setPlaced(null);
    }
  }, [target]);

  useEffect(() => {
    document.body.style.overflow = target ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [target]);

  const stake = cents / 100;
  const overBalance = stake > balance;
  const payout = target ? stake * target.odds : 0;
  const profit = payout - stake;

  const sliderMax = Math.max(1, Math.floor(balance));
  const sliderValue = Math.min(stake, sliderMax);
  const sliderPct = Math.min(100, (sliderValue / sliderMax) * 100);

  const pushDigit = (d: string) => setCents((c) => Math.min(c * 10 + Number(d), 9_999_999));
  const pushDoubleZero = () => setCents((c) => Math.min(c * 100, 9_999_999));
  const backspace = () => setCents((c) => Math.floor(c / 10));

  const confirm = async () => {
    if (!target || phase !== "input") return;
    setPhase("loading");
    setError(null);
    try {
      const res = await api.placeBet({
        matchId: target.match.id,
        selection: target.selection,
        stake,
      });
      setBalance(res.balance);
      bumpBets();
      setPlaced({ id: res.bet.id, potentialWin: res.bet.potentialWin });
      setPhase("success"); // persiste jusqu'à action de l'utilisateur
    } catch (e) {
      setPhase("input");
      setError(e instanceof Error ? e.message : "Une erreur est survenue");
      toast({ kind: "error", title: "Pari refusé", description: "Vérifiez votre mise" });
    }
  };

  const goToBets = () => {
    closeBet();
    router.push("/paris");
  };

  return (
    <AnimatePresence>
      {target && (
        <div className="fixed inset-0 z-[70]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={phase === "success" ? undefined : closeBet}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <motion.div
            initial={{ y: "102%" }}
            animate={{ y: 0 }}
            exit={{ y: "102%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            drag={phase === "input" ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 130 || info.velocity.y > 600) closeBet();
            }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[94dvh] w-full max-w-[27.5rem] flex-col overflow-hidden rounded-t-[24px] border-t border-white/10 bg-surface shadow-[0_-20px_80px_-20px_rgba(0,0,0,0.9)]"
          >
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-lime/70 to-transparent" />

            {phase === "success" && placed ? (
              <SuccessView
                betId={placed.id}
                payout={placed.potentialWin}
                stake={stake}
                onGoToBets={goToBets}
                onContinue={closeBet}
              />
            ) : (
              <div className="no-scrollbar overflow-y-auto px-4 pb-4 pb-safe">
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-elev" />

                {/* Titre */}
                <div className="flex items-center justify-between pt-2.5">
                  <h2 className="font-display text-base font-bold tracking-tight">Nouveau pari</h2>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={closeBet}
                    className="glass-pill grid h-8 w-8 place-items-center rounded-full text-mist active:scale-90"
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" strokeWidth={2.2} />
                  </motion.button>
                </div>

                {/* Bandeau match + sélection */}
                <div className="glass-card mt-2.5 flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
                  <div className="flex shrink-0 -space-x-2">
                    <TeamAvatar name={target.match.homeTeam} size="sm" className="ring-2 ring-card" />
                    <TeamAvatar name={target.match.awayTeam} size="sm" className="ring-2 ring-card" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[12.5px] font-semibold leading-tight">
                      {target.match.homeTeam} <span className="text-dim">–</span> {target.match.awayTeam}
                    </p>
                    <p className="mt-0.5 truncate text-[10.5px] font-medium text-mist">
                      {target.match.status === "live" ? (
                        <span className="inline-flex items-center gap-1 font-bold text-live">
                          <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
                          LIVE {target.match.minute}
                        </span>
                      ) : (
                        target.match.league
                      )}
                      <span className="text-dim"> · </span>
                      <span className="text-lime">{target.label}</span>
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-lime/10 px-2.5 py-1.5 font-display text-[17px] font-bold tabular-nums text-lime">
                    {formatOdds(target.odds, oddsFormat)}
                  </span>
                </div>

                {/* Montant */}
                <div className="mt-3 flex items-end justify-between px-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[9.5px] font-semibold tracking-[0.24em] text-dim">MISE</span>
                    <div
                      className={cn(
                        "flex items-baseline font-display text-[32px] font-bold leading-none tracking-tight tabular-nums",
                        overBalance ? "text-live" : "text-white"
                      )}
                    >
                      {eur(stake)}
                      <span className="caret-blink ml-1 inline-block h-7 w-[3px] translate-y-0.5 rounded bg-lime" />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setCents(0);
                      setError(null);
                    }}
                    className="mb-0.5 text-[11px] font-medium text-dim underline-offset-2 active:underline"
                  >
                    Solde · {eur(balance)}
                  </button>
                </div>
                <AnimatePresence>
                  {overBalance && (
                    <motion.p
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-1 px-1 text-[11px] font-semibold text-live"
                    >
                      Solde insuffisant — rechargez ou réduisez la mise
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Jetons rapides */}
                <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                  {CHIP_AMOUNTS.map((a) => (
                    <motion.button
                      key={a}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setCents((c) => Math.min(c + a * 100, 9_999_999))}
                      className="glass-pill rounded-lg py-1.5 font-display text-[12px] font-bold text-white transition-colors active:border-lime/50 active:bg-lime/10 active:text-lime"
                    >
                      +{a}€
                    </motion.button>
                  ))}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setCents(Math.floor(balance * 100))}
                    className="rounded-lg border border-lime/40 bg-lime/10 py-1.5 font-display text-[12px] font-bold text-lime"
                  >
                    MAX
                  </motion.button>
                </div>

                {/* Curseur de mise */}
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

                {/* Clavier */}
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <Key key={d} onPress={() => pushDigit(d)} label={d} />
                  ))}
                  <Key onPress={pushDoubleZero} label="00" muted />
                  <Key onPress={() => pushDigit("0")} label="0" />
                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    onClick={backspace}
                    className="grid h-12 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.02] text-mist shadow-[inset_0_-2px_0_rgba(255,255,255,0.04)] active:bg-elev"
                    aria-label="Effacer"
                  >
                    <Delete className="h-[18px] w-[18px]" strokeWidth={2} />
                  </motion.button>
                </div>

                {/* Gain potentiel */}
                <div className="mt-2.5 flex items-center justify-between px-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[9.5px] font-semibold tracking-[0.18em] text-dim">
                      GAIN POTENTIEL
                    </span>
                    <span className="text-[10.5px] font-medium text-win">
                      +{eur(Math.max(profit, 0))}
                    </span>
                  </div>
                  <AnimatedNumber
                    value={payout}
                    format={eur}
                    className="font-display text-[22px] font-bold tabular-nums text-lime"
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
                      ? "bg-[linear-gradient(135deg,#d4ff54,#9ccf1f)] text-ink shadow-[0_14px_38px_-10px_rgba(201,247,58,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]"
                      : "bg-elev text-dim"
                  )}
                >
                  {phase === "loading" ? (
                    <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
                  ) : (
                    <>
                      Placer le pari
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

function Key({
  onPress,
  label,
  muted,
}: {
  onPress: () => void;
  label: string;
  muted?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onPress}
      className={cn(
        "grid h-12 place-items-center rounded-xl border font-display text-[18px] font-bold shadow-[inset_0_-2px_0_rgba(255,255,255,0.05)] transition-colors",
        muted
          ? "border-white/[0.06] bg-white/[0.02] text-mist active:bg-elev"
          : "border-white/[0.07] bg-white/[0.045] text-white active:bg-elev"
      )}
    >
      {label}
    </motion.button>
  );
}

/** Confirmation persistante avec explosion de confettis. */
function SuccessView({
  betId,
  payout,
  stake,
  onGoToBets,
  onContinue,
}: {
  betId: number;
  payout: number;
  stake: number;
  onGoToBets: () => void;
  onContinue: () => void;
}) {
  const { target, oddsFormat } = useApp();

  return (
    <div className="no-scrollbar overflow-y-auto px-4 pb-5 pb-safe">
      <div className="flex flex-col items-center pt-8 text-center">
        <div className="relative">
          {/* Confettis */}
          {[...Array(12)].map((_, i) => (
            <motion.span
              key={i}
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
              style={{ background: i % 3 === 0 ? "#7dd3fc" : "var(--color-lime)" }}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="spin-slow absolute -inset-3 rounded-full border-2 border-dashed border-lime/40"
          />
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.1 }}
            className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[linear-gradient(135deg,#d4ff54,#9ccf1f)] shadow-[0_0_50px_-8px_rgba(201,247,58,0.75),inset_0_1px_0_rgba(255,255,255,0.5)]"
          >
            <Check className="h-8 w-8 text-ink" strokeWidth={3} />
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}>
          <h3 className="mt-6 font-display text-[22px] font-bold">Pari confirmé !</h3>
          <p className="mt-1 text-[12px] text-mist">
            Votre ticket est enregistré et suivi en temps réel
          </p>
        </motion.div>
      </div>

      {/* Ticket récapitulatif */}
      {target && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34 }}
          className="glass-card relative mt-5 overflow-hidden rounded-2xl"
        >
          <span className="pointer-events-none absolute right-3 top-3 rotate-[8deg] rounded border border-lime/50 px-1.5 py-0.5 font-display text-[8px] font-bold tracking-[0.18em] text-lime/80">
            CONFIRMÉ
          </span>
          <div className="px-3.5 pt-3">
            <div className="flex items-center gap-2.5 pr-16">
              <div className="flex shrink-0 -space-x-2">
                <TeamAvatar name={target.match.homeTeam} size="sm" className="ring-2 ring-card" />
                <TeamAvatar name={target.match.awayTeam} size="sm" className="ring-2 ring-card" />
              </div>
              <p className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold">
                {target.match.homeTeam} <span className="text-dim">–</span> {target.match.awayTeam}
              </p>
            </div>
            <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white/[0.05] px-3 py-2">
              <span className="text-[12px] font-semibold text-white">{target.label}</span>
              <span className="font-display text-[14px] font-bold tabular-nums text-lime">
                {formatOdds(target.odds, oddsFormat)}
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
                {formatOdds(target.odds, oddsFormat)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[8.5px] font-semibold tracking-[0.16em] text-dim">À GAGNER</p>
              <p className="glow-lime mt-0.5 font-display text-[13px] font-bold tabular-nums text-lime">
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
      )}

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.42 }}
        className="mt-4"
      >
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onGoToBets}
          className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#d4ff54,#9ccf1f)] font-display text-[14.5px] font-bold text-ink shadow-[0_14px_38px_-10px_rgba(201,247,58,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]"
        >
          <Ticket className="h-4.5 w-4.5" strokeWidth={2.4} />
          Voir mes paris
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onContinue}
          className="glass-card mt-2 flex h-11 w-full items-center justify-center rounded-xl font-display text-[13px] font-semibold text-white active:bg-elev"
        >
          Continuer à parier
        </motion.button>
      </motion.div>
    </div>
  );
}
