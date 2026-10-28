"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ArrowRight, Check, Layers, Loader2, Lock, Plus, Ticket, X } from "lucide-react";
import { ApiRequestError, api } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import {
  generateBetIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/odds-lock";
import { useApp, useFeedMatches, type BetTarget } from "./providers";
import { triggerRouteLoader } from "./pulse-flash-loader";
import { OddsLockControls } from "./odds-lock-controls";
import { LiveMatchClock } from "./live-match-clock";
import { TeamAvatar } from "./team-avatar";
import { AnimatedNumber } from "./animated-number";
import { TouchStakePad } from "./touch-stake-pad";
import { cn, eur, formatOdds } from "@/lib/format";

const POLL_INTERVAL = 3_500;

function findSelectionOddsInMatch(
  m: BetTarget["match"],
  market: string,
  selection: string
): { odds: number | null; hasMarketInPayload: boolean } {
  const groups = m.markets ?? [];
  const grp = groups.find(
    (g) => g.key === market || (market === "result" && g.key === "1x2")
  );
  if (!grp) {
    // Si le payload est slim (`markets.length <= 1`), les 18 marchés secondaires ne sont pas inclus dedans.
    return { odds: null, hasMarketInPayload: groups.length > 1 };
  }
  const direct = grp.outcomes.find((o) => o.key === selection);
  if (direct) return { odds: direct.odds, hasMarketInPayload: true };
  for (const row of grp.rows ?? []) {
    const inRow = row.outcomes.find((o) => o.key === selection);
    if (inRow) return { odds: inRow.odds, hasMarketInPayload: true };
  }
  return { odds: null, hasMarketInPayload: true };
}

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
    oddsPolicy,
    setOddsPolicy,
    toast,
    openRecharge,
    comboLegs,
    toggleComboLeg,
    authReady,
    user,
  } = useApp();
  const feedMatches = useFeedMatches();
  const dragControls = useDragControls();

  const [stakeText, setStakeText] = useState(() => {
    const def = balance > 0 ? Math.min(10, Math.max(1, Math.floor(balance))) : 10;
    return String(def);
  });
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
    if (target.match.status === "finished") return;
    let active = true;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await api.matchById(target.match.id);
        if (!active || !r.match) return;
        const fresh = r.match;

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

        const { odds } = findSelectionOddsInMatch(
          fresh,
          target.market,
          target.selection
        );

        setLive({
          matchId: target.match.id,
          odds,
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
  }, [target.market, target.match.id, target.match.status, target.selection]);

  const parsed = Number(stakeText.replace(",", "."));
  const stake = Number(Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0);
  const overBalance = Boolean(user) && stake > balance;
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
        const { odds, hasMarketInPayload } = findSelectionOddsInMatch(
          sharedFreshMatch,
          target.market,
          target.selection
        );
        if (!hasMarketInPayload) return null;
        return {
          matchId: target.match.id,
          odds,
          minute: sharedFreshMatch.minute,
          homeScore: sharedFreshMatch.homeScore,
          awayScore: sharedFreshMatch.awayScore,
          suspended: sharedFreshMatch.suspended,
          finished: false,
        };
      })()
    : null;

  const polledLive = live && live.matchId === target.match.id ? live : null;
  const liveActive = polledLive ?? derivedFromFeed;

  const marketClosed = Boolean(liveActive && (liveActive.finished || liveActive.odds == null));
  const marketSuspended = Boolean(liveActive ? liveActive.suspended : target.match.suspended);
  const feedOdds = liveActive?.odds ?? target.odds;
  const displayOdds = roundOdds2(serverOverrideOdds ?? feedOdds);
  const liveMinute = liveActive ? liveActive.minute : target.match.minute;
  const liveHomeScore = liveActive ? liveActive.homeScore : target.match.homeScore;
  const liveAwayScore = liveActive ? liveActive.awayScore : target.match.awayScore;

  const payout = stake * displayOdds;
  const profit = payout - stake;

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
      startsAt: target.match.startsAt,
      isLive: target.match.status === "live",
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
    if (!canSubmit || inFlightRef.current) return;
    if (!authReady && !user) return;
    if (!user) {
      onClose();
      router.push("/auth/connexion");
      return;
    }
    inFlightRef.current = true;
    const sig = `${target.match.id}:${target.market}:${target.selection}:${stake}:${displayOdds}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = { key: generateBetIdempotencyKey(), sig };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setPhase("loading");
    setError(null);
    try {
      const res = await api.placeBet({
        matchId: target.match.id,
        selection: target.selection,
        market: target.market,
        stake,
        expectedOdds: displayOdds,
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
          <>
            <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-4 pb-3 pt-2 lg:px-6 lg:pb-4 lg:pt-4">
              <div
                onPointerDown={phase === "input" ? (e) => dragControls.start(e) : undefined}
                className="mx-auto h-1 w-10 cursor-grab rounded-full bg-edge active:cursor-grabbing lg:hidden"
              />

              <div className="mt-2.5 flex items-center justify-between">
                <h2 className="font-display text-[16.5px] font-bold tracking-tight text-ink lg:text-[17px]">
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
              <div className="mt-2.5 rounded-2xl border border-edge bg-elev/60 p-3">
                {target.match.status === "live" && (
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px]">
                    <span className="truncate font-semibold text-mist">{target.match.league}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2 py-0.5 font-display font-bold tabular-nums text-betclic-red">
                      <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                      <LiveMatchClock
                        match={{
                          ...(sharedFreshMatch ?? target.match),
                          minute: liveMinute ?? target.match.minute,
                        }}
                        fallback={liveMinute ?? "LIVE"}
                      />
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
                    <span className="truncate font-display text-[13.5px] font-semibold text-ink">
                      {target.match.homeTeam}
                    </span>
                    {target.match.status === "live" && liveHomeScore != null && (
                      <span className="ml-auto min-w-[22px] rounded-md bg-betclic-red/10 px-1.5 py-0.5 text-center font-display text-[14px] font-bold tabular-nums text-betclic-red">
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
                    <span className="truncate font-display text-[13.5px] font-semibold text-ink">
                      {target.match.awayTeam}
                    </span>
                    {target.match.status === "live" && liveHomeScore != null && (
                      <span className="ml-auto min-w-[22px] rounded-md bg-betclic-red/10 px-1.5 py-0.5 text-center font-display text-[14px] font-bold tabular-nums text-betclic-red">
                        {liveAwayScore ?? 0}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-1.5">
                  <p className="min-w-0 truncate text-[12px] text-mist">
                    <span className="font-semibold text-ink">{target.label}</span>
                    {target.market !== "result" && (
                      <span className="text-dim"> · {target.marketLabel}</span>
                    )}
                  </p>
                  <span
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1 font-display text-[13.5px] font-bold tabular-nums text-white",
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

              {/* Champ de mise + jetons 5/10/25/50/MAX (pavé 0-9 replié par défaut sur mobile) */}
              <div className="mt-3">
                <TouchStakePad
                  id="sport-stake-input"
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
              </div>

              {overBalance && (
                <div className="mt-2.5 flex items-center justify-between rounded-xl border border-betclic-red/25 bg-betclic-red/5 px-3 py-2 text-[12px]">
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

              <OddsLockControls
                feedKind="matches"
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
                  <span className="font-display text-[12px] font-bold text-ink">
                    Gain potentiel
                  </span>
                  <span className="text-[11px] font-medium text-win">
                    +{eur(Math.max(profit, 0))} net
                  </span>
                </div>
                <AnimatedNumber
                  value={payout}
                  format={eur}
                  className="font-display text-[19px] font-extrabold tabular-nums text-win"
                />
              </div>

              <div className="flex items-center gap-2">
                {!marketClosed && !marketSuspended && (
                  <button
                    type="button"
                    onClick={handleAddToCombo}
                    aria-label={inComboExact ? "Retirer du coupon" : "Ajouter au combiné"}
                    className={cn(
                      "inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-2xl border px-3.5 font-display text-[12px] font-bold transition-colors active:scale-[0.99]",
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
                )}

                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={confirm}
                  className={cn(
                    "flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl px-3 font-display text-[14px] font-bold transition-all active:scale-[0.99]",
                    canSubmit
                      ? "bg-betclic-red text-white shadow-sm"
                      : "bg-elev text-dim"
                  )}
                >
                  {phase === "loading" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                      <span className="truncate">Validation…</span>
                    </>
                  ) : marketClosed ? (
                    "Clôturée"
                  ) : marketSuspended ? (
                    "Suspendu…"
                  ) : oddsChanged ? (
                    <>
                      <span className="truncate">
                        Accepter ({formatOdds(displayOdds, oddsFormat)})
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                    </>
                  ) : (
                    <>
                      <span className="truncate">
                        Placer {stake > 0 ? eur(stake) : "le pari"}
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
