"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ArrowRight, Check, Layers, Loader2, Lock, Plus, Ticket, X } from "lucide-react";
import { api } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { useApp, type BetTarget } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { AnimatedNumber } from "./animated-number";
import { cn, eur, formatOdds } from "@/lib/format";

const QUICK_STAKES = [5, 10, 25, 50];
const POLL_INTERVAL = 4_000;

export function BetModal() {
  const { target, closeBet, marketMatch } = useApp();

  useEffect(() => {
    document.body.style.overflow = target || marketMatch ? "hidden" : "";
    return () => {
      document.body.style.overflow = marketMatch ? "hidden" : "";
    };
  }, [target, marketMatch]);

  return (
    <AnimatePresence>
      {target && (
        <BetModalSheet
          key={`${target.match.id}-${target.market}-${target.selection}`}
          target={target}
          onClose={closeBet}
        />
      )}
    </AnimatePresence>
  );
}

function BetModalSheet({
  target,
  onClose,
}: {
  target: BetTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const {
    balance,
    setBalance,
    bumpBets,
    oddsFormat,
    toast,
    openRecharge,
    comboLegs,
    toggleComboLeg,
    feedMatches,
    user,
  } = useApp();
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
  const [live, setLive] = useState<{
    matchId: number;
    odds: number | null;
    minute: string | null;
    homeScore: number | null;
    awayScore: number | null;
    suspended: boolean;
    finished: boolean;
  } | null>(null);

  const sharedFreshMatch =
    feedMatches?.find((m) => m.id === target.match.id) ?? null;

  useEffect(() => {
    if (target.match.status !== "live" || sharedFreshMatch) return;
    let active = true;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await api.matches();
        if (!active) return;
        const fresh = r.matches.find((m) => m.id === target.match.id);
        if (!fresh) return;

        if (fresh.status === "finished") {
          setLive({
            matchId: target.match.id,
            odds: null,
            minute: null,
            homeScore: fresh.homeScore,
            awayScore: fresh.awayScore,
            suspended: true,
            finished: true,
          });
          return;
        }

        const grp = (fresh.markets ?? []).find((g) => g.key === target.market);
        const outcome = grp?.outcomes.find((o) => o.key === target.selection);

        setLive({
          matchId: target.match.id,
          odds: outcome ? outcome.odds : null,
          minute: fresh.minute,
          homeScore: fresh.homeScore,
          awayScore: fresh.awayScore,
          suspended: fresh.suspended,
          finished: false,
        });
      } catch {
        /* silencieux */
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [target, sharedFreshMatch]);

  const parsed = Number(stakeText.replace(",", "."));
  const stake = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const overBalance = stake > balance;
  const belowMin = stake > 0 && stake < 0.5;

  const derivedFromFeed = sharedFreshMatch
    ? (() => {
        if (sharedFreshMatch.status === "finished") {
          return {
            matchId: target.match.id,
            odds: null as number | null,
            minute: null as string | null,
            homeScore: sharedFreshMatch.homeScore,
            awayScore: sharedFreshMatch.awayScore,
            suspended: true,
            finished: true,
          };
        }
        const grp = (sharedFreshMatch.markets ?? []).find((g) => g.key === target.market);
        const outcome = grp?.outcomes.find((o) => o.key === target.selection);
        return {
          matchId: target.match.id,
          odds: outcome ? outcome.odds : null,
          minute: sharedFreshMatch.minute,
          homeScore: sharedFreshMatch.homeScore,
          awayScore: sharedFreshMatch.awayScore,
          suspended: sharedFreshMatch.suspended,
          finished: false,
        };
      })()
    : null;

  const liveActive =
    derivedFromFeed ?? (live && live.matchId === target.match.id ? live : null);

  const marketClosed = Boolean(liveActive && (liveActive.finished || liveActive.odds == null));
  const marketSuspended = Boolean(liveActive ? liveActive.suspended : target.match.suspended);
  const displayOdds = liveActive?.odds ?? target.odds;
  const liveMinute = liveActive ? liveActive.minute : target.match.minute;
  const liveHomeScore = liveActive ? liveActive.homeScore : target.match.homeScore;
  const liveAwayScore = liveActive ? liveActive.awayScore : target.match.awayScore;

  const payout = stake * displayOdds;
  const profit = payout - stake;

  const handleStakeInput = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.,]/g, "");
    const parts = cleaned.split(/[.,]/);
    const normalized =
      parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}` : parts[0];
    setStakeText(normalized);
    setError(null);
  };

  const comboUid = `sport-${target.match.id}`;
  const inComboExact = comboLegs.some(
    (l) =>
      l.uid === comboUid &&
      l.market === target.market &&
      l.selection === target.selection
  );

  const handleAddToCombo = () => {
    if (marketSuspended || marketClosed) return;
    const outcome = toggleComboLeg({
      uid: comboUid,
      kind: "sport",
      matchId: target.match.id,
      matchSource: target.match.source,
      title: `${target.match.homeTeam} – ${target.match.awayTeam}`,
      homeTeam: target.match.homeTeam,
      awayTeam: target.match.awayTeam,
      homeLogo: target.match.homeLogo,
      awayLogo: target.match.awayLogo,
      league: target.match.league,
      market: target.market,
      selection: target.selection,
      selectionLabel: target.label,
      odds: displayOdds,
    });
    if (outcome === "full") {
      toast({ kind: "error", title: "Coupon complet (8 sélections max)" });
      return;
    }
    if (outcome === "removed") {
      toast({ kind: "info", title: "Retiré du coupon" });
    } else {
      toast({
        kind: "success",
        title: outcome === "replaced" ? "Sélection remplacée dans le coupon" : "Ajouté au coupon de pari",
        description: `${target.match.homeTeam} – ${target.match.awayTeam} · ${target.label}`,
      });
      onClose();
    }
  };

  const canSubmit =
    phase === "input" &&
    stake >= 0.5 &&
    !overBalance &&
    !marketSuspended &&
    !marketClosed;

  const confirm = async () => {
    if (!canSubmit) return;
    setPhase("loading");
    setError(null);
    try {
      const res = await api.placeBet({
        matchId: target.match.id,
        selection: target.selection,
        market: target.market,
        stake,
      });
      setBalance(res.balance);
      bumpBets();
      playUiSound(user?.sound, "bet");
      triggerHaptic(user?.haptics, [18, 28]);
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
          if (info.offset.y > 120 || info.velocity.y > 550) onClose();
        }}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[86dvh] lg:max-w-[480px] lg:rounded-3xl lg:border"
      >
        {phase === "success" && placed ? (
          <SuccessView
            target={target}
            betId={placed.id}
            payout={placed.potentialWin}
            stake={placed.stake}
            odds={placed.odds}
            onGoToBets={goToBets}
            onContinue={onClose}
          />
        ) : (
          <div className="no-scrollbar overflow-y-auto px-4 pb-5 pb-safe pt-2 lg:px-6 lg:pb-6 lg:pt-4">
            <div
              onPointerDown={phase === "input" ? (e) => dragControls.start(e) : undefined}
              className="mx-auto h-1 w-10 cursor-grab rounded-full bg-edge active:cursor-grabbing lg:hidden"
            />

            <div className="mt-3 flex items-center justify-between">
              <h2 className="font-display text-[17px] font-bold tracking-tight text-ink">
                Coupon de pari
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

            {/* Résumé de la sélection (même disposition d'équipes & logos que la page Matchs) */}
            <div className="mt-3 rounded-2xl border border-edge bg-elev/60 p-3">
              {target.match.status === "live" && (
                <div className="mb-2 flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="truncate font-semibold text-mist">{target.match.league}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display font-bold tabular-nums text-betclic-red">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                    {liveMinute ?? "LIVE"}
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2.5">
                  <TeamAvatar
                    name={target.match.homeTeam}
                    logo={target.match.homeLogo}
                    size="xs"
                  />
                  <span className="truncate font-display text-[14px] font-semibold text-ink">
                    {target.match.homeTeam}
                  </span>
                  {target.match.status === "live" && liveHomeScore != null && (
                    <span className="ml-auto min-w-[22px] rounded-md bg-betclic-red/10 px-1.5 py-0.5 text-center font-display text-[14.5px] font-bold tabular-nums text-betclic-red">
                      {liveHomeScore}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  <TeamAvatar
                    name={target.match.awayTeam}
                    logo={target.match.awayLogo}
                    size="xs"
                  />
                  <span className="truncate font-display text-[14px] font-semibold text-ink">
                    {target.match.awayTeam}
                  </span>
                  {target.match.status === "live" && liveHomeScore != null && (
                    <span className="ml-auto min-w-[22px] rounded-md bg-betclic-red/10 px-1.5 py-0.5 text-center font-display text-[14.5px] font-bold tabular-nums text-betclic-red">
                      {liveAwayScore ?? 0}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
                <p className="min-w-0 truncate text-[12px] text-mist">
                  <span className="font-semibold text-ink">{target.label}</span>
                  {target.market !== "result" && (
                    <span className="text-dim"> · {target.marketLabel}</span>
                  )}
                </p>
                <span
                  className={cn(
                    "shrink-0 rounded-lg px-2.5 py-1 font-display text-[14px] font-bold tabular-nums text-white",
                    marketSuspended || marketClosed ? "bg-dim" : "bg-betclic-red"
                  )}
                >
                  {marketClosed ? "Fermé" : formatOdds(displayOdds, oddsFormat)}
                </span>
              </div>
            </div>

            {(marketSuspended || marketClosed) && (
              <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-amber-500/12 px-3 py-2 text-[11.5px] font-semibold text-amber-800">
                <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
                <span>
                  {marketClosed
                    ? "Cette sélection est désormais décidée ou clôturée."
                    : "Marché momentanément suspendu (action de jeu en cours)…"}
                </span>
              </div>
            )}

            {/* Champ de mise */}
            <div className="mt-3.5">
              <div className="flex items-center justify-between text-[11.5px]">
                <label htmlFor="sport-stake-input" className="font-semibold text-mist">
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
                  id="sport-stake-input"
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

              {/* Mises rapides */}
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
                    const maxVal = Math.max(0, Math.floor(balance * 100) / 100);
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

            {/* Gain potentiel */}
            <div className="mt-3.5 flex items-center justify-between rounded-2xl bg-elev px-3.5 py-3">
              <div>
                <p className="text-[11px] font-semibold text-mist">Gain potentiel</p>
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

            {/* Validation simple ou Ajout au combiné */}
            <div className="mt-3.5 flex flex-col gap-2">
              <button
                type="button"
                disabled={!canSubmit}
                onClick={confirm}
                className={cn(
                  "flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14.5px] font-bold transition-all active:scale-[0.99]",
                  canSubmit
                    ? "bg-betclic-red text-white shadow-sm"
                    : "bg-elev text-dim"
                )}
              >
                {phase === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                    Validation en cours…
                  </>
                ) : marketClosed ? (
                  "Sélection clôturée"
                ) : marketSuspended ? (
                  "Marché suspendu…"
                ) : (
                  <>
                    Placer {stake > 0 ? eur(stake) : "le pari"}
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </>
                )}
              </button>

              {!marketClosed && !marketSuspended && (
                <button
                  type="button"
                  onClick={handleAddToCombo}
                  className={cn(
                    "flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl border font-display text-[12.5px] font-bold transition-colors active:scale-[0.99]",
                    inComboExact
                      ? "border-ink bg-ink text-white"
                      : "border-edge bg-white text-ink active:bg-elev"
                  )}
                >
                  <Layers className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
                  {inComboExact
                    ? "Dans le coupon (toucher pour retirer)"
                    : `Ajouter au coupon${comboLegs.length > 0 ? ` (${comboLegs.length})` : ""}`}
                </button>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function SuccessView({
  target,
  betId,
  payout,
  stake,
  odds,
  onGoToBets,
  onContinue,
}: {
  target: BetTarget;
  betId: number;
  payout: number;
  stake: number;
  odds: number;
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
        <h3 className="mt-3 font-display text-[20px] font-bold text-ink">Pari accepté</h3>
        <p className="mt-0.5 text-[12.5px] text-mist">Coupon #{String(betId).padStart(5, "0")}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-edge bg-elev/50 p-3.5">
        <p className="truncate font-display text-[13.5px] font-semibold text-ink">
          {target.match.homeTeam} – {target.match.awayTeam}
        </p>
        <p className="mt-0.5 text-[12px] font-medium text-mist">{target.label}</p>

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
            <p className="text-[10px] font-semibold uppercase text-dim">Gain max</p>
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
