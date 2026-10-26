"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Flame,
  Layers,
  RotateCcw,
  Share2,
  TrendingUp,
  X,
} from "lucide-react";
import { api, type ClientBet, type ClientComboLeg } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { SlideToCashOut } from "./slide-to-cashout";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { useApp } from "./providers";

function shortMarketBadge(market: string): string | null {
  switch (market) {
    case "result":
    case "1x2":
      return "1X2";
    case "double":
    case "double_chance":
      return "DC";
    case "btts":
      return "BTTS";
    case "ou15":
      return "T 1.5";
    case "ou25":
    case "over_under_25":
    case "total_25":
      return "T 2.5";
    case "ou35":
      return "T 3.5";
    case "yesno":
      return "Oui/Non";
    case "multichoice":
      return "Choix";
    default:
      return null;
  }
}

function resolveLegTeams(leg: ClientComboLeg): { home: string; away: string } | null {
  if (leg.kind !== "sport") return null;
  if (leg.homeTeam && leg.awayTeam) {
    return { home: leg.homeTeam, away: leg.awayTeam };
  }
  for (const sep of [" – ", " - ", " vs "]) {
    if (leg.title.includes(sep)) {
      const [h, a] = leg.title.split(sep).map((s) => s.trim());
      if (h && a) return { home: h, away: a };
    }
  }
  return null;
}

export function BetTicket({
  bet,
  onShare,
}: {
  bet: ClientBet;
  index?: number;
  onShare?: (bet: ClientBet) => void;
}) {
  if (bet.kind === "combo" && bet.legs && bet.legs.length > 0) {
    return <ComboBetTicket bet={bet} legs={bet.legs} onShare={onShare} />;
  }
  return <SingleBetTicket bet={bet} onShare={onShare} />;
}

function ComboBetTicket({
  bet,
  legs,
  onShare,
}: {
  bet: ClientBet;
  legs: ClientComboLeg[];
  onShare?: (bet: ClientBet) => void;
}) {
  const { oddsFormat, setBalance, bumpBets, toast, user } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [cashing, setCashing] = useState(false);

  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const canCashOut = bet.status === "pending" && bet.cashOut != null;

  const totalLegs = legs.length;
  const wonCount = legs.filter((l) => l.status === "won").length;
  const lostCount = legs.filter((l) => l.status === "lost").length;
  const voidCount = legs.filter((l) => l.status === "void").length;
  const liveCount = legs.filter(
    (l) => l.status === "pending" && l.matchStatus === "live"
  ).length;
  const anyLive = bet.status === "pending" && (liveCount > 0 || bet.matchStatus === "live");

  const canCollapse = totalLegs > 2;
  const visibleLegs = canCollapse && !expanded ? legs.slice(0, 2) : legs;
  const hiddenLegs = canCollapse && !expanded ? legs.slice(2) : [];
  const hiddenLiveCount = hiddenLegs.filter(
    (l) => l.status === "pending" && l.matchStatus === "live"
  ).length;
  const hiddenLostCount = hiddenLegs.filter((l) => l.status === "lost").length;

  const doCashOut = async () => {
    if (cashing) return;
    setCashing(true);
    try {
      const r = await api.cashOut(bet.id, bet.kind);
      setBalance(r.balance);
      bumpBets();
      playUiSound(user?.sound, "win");
      triggerHaptic(user?.haptics, [22, 30, 45]);
      toast({
        kind: "success",
        title: "Coupon vendu",
        description: `+${eur(r.value)} crédités sur votre solde`,
      });
    } catch (e) {
      toast({
        kind: "error",
        title: "Vente du coupon impossible",
        description: e instanceof Error ? e.message : "Réessayez dans un instant",
      });
    } finally {
      setCashing(false);
    }
  };

  const progressSummary = (() => {
    if (won) return `${totalLegs}/${totalLegs} sélections validées`;
    if (cashed) return `Coupon vendu · ${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""}`;
    if (voided) return "Combiné intégralement remboursé";
    if (lost) {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${lostCount} perdue${lostCount > 1 ? "s" : ""}`;
    }
    const parts: string[] = [
      `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""}`,
    ];
    if (liveCount > 0) parts.push(`${liveCount} en direct`);
    if (voidCount > 0) parts.push(`${voidCount} annulée${voidCount > 1 ? "s" : ""}`);
    return parts.join(" · ");
  })();

  const hasBoost =
    bet.boostPct != null &&
    bet.boostPct > 0 &&
    bet.baseOdds != null &&
    bet.odds - bet.baseOdds >= 0.01;

  return (
    <article
      className={cn(
        "glass-card relative overflow-hidden rounded-2xl transition-all",
        won && "border-win/40 shadow-[0_4px_18px_rgba(21,128,61,0.08)]",
        anyLive && "border-betclic-red/30 shadow-[0_4px_18px_rgba(225,0,20,0.06)]"
      )}
    >
      {/* Liseré supérieur signature Combiné */}
      <div
        aria-hidden
        className={cn(
          "h-1 w-full",
          won
            ? "bg-win"
            : cashed
              ? "bg-sky-600"
              : lost
                ? "bg-edge"
                : "bg-betclic-red"
        )}
      />

      {/* En-tête du coupon combiné + Barre de progression segmentée */}
      <div className="border-b border-edge/75 bg-gradient-to-b from-elev/60 to-white px-3.5 pt-3 pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 font-display text-[10.5px] font-extrabold uppercase tracking-wide",
                won
                  ? "bg-win text-white"
                  : cashed
                    ? "bg-sky-600 text-white"
                    : lost
                      ? "bg-elev text-mist"
                      : anyLive
                        ? "bg-betclic-red text-white"
                        : "bg-ink text-white"
              )}
            >
              <Layers className="h-3 w-3" strokeWidth={2.5} />
              Combiné · {totalLegs}
            </span>

            {bet.boostPct != null && bet.boostPct > 0 && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-win/12 px-2 py-0.5 font-display text-[10px] font-extrabold text-win">
                <Flame className="h-3 w-3" strokeWidth={2.4} />+{bet.boostPct}%
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onShare && (
              <button
                type="button"
                onClick={() => onShare(bet)}
                aria-label="Partager ce combiné"
                className="inline-flex h-6.5 items-center gap-1 rounded-full border border-edge bg-white px-2.5 font-display text-[10px] font-bold text-ink shadow-2xs active:scale-95 active:bg-elev"
              >
                <Share2 className="h-3 w-3 text-betclic-red" strokeWidth={2.3} />
                Flex
              </button>
            )}
            <StatusPill status={bet.status} live={anyLive} minute={bet.matchMinute} />
          </div>
        </div>

        {/* Jauge segmentée : 1 segment par sélection */}
        <div
          className="mt-2.5 flex items-center gap-1"
          role="progressbar"
          aria-valuenow={wonCount}
          aria-valuemin={0}
          aria-valuemax={totalLegs}
          aria-label={`Progression du combiné : ${wonCount} sur ${totalLegs} validées`}
        >
          {legs.map((leg, i) => {
            const isLegLive = leg.status === "pending" && leg.matchStatus === "live";
            return (
              <span
                key={`seg-${leg.kind}-${leg.matchId ?? leg.questionId ?? i}`}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-all duration-300",
                  leg.status === "won"
                    ? "bg-win"
                    : leg.status === "lost"
                      ? "bg-betclic-red"
                      : leg.status === "void"
                        ? "bg-amber-400"
                        : isLegLive
                          ? "live-dot bg-betclic-red"
                          : "bg-ink/12"
                )}
              />
            );
          })}
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span
            className={cn(
              "truncate font-display font-semibold",
              won
                ? "text-win"
                : lost
                  ? "text-mist"
                  : wonCount > 0 || anyLive
                    ? "text-ink"
                    : "text-mist"
            )}
          >
            {progressSummary}
          </span>
          <span className="shrink-0 text-[10.5px] text-dim">
            {formatPlacedAt(
              bet.status !== "pending" ? (bet.settledAt ?? bet.placedAt) : bet.placedAt
            )}
          </span>
        </div>
      </div>

      {/* Timeline verticale connectée des sélections */}
      <div className="px-3.5 pt-3 pb-2.5">
        <div>
          {visibleLegs.map((leg, idx) => {
            const isLastRendered = idx === visibleLegs.length - 1;
            const hasMoreBelow = isLastRendered && hiddenLegs.length > 0;
            const legHref =
              leg.kind === "sport" && leg.matchId
                ? `/resultats?match=${leg.matchId}`
                : leg.kind === "prediction"
                  ? "/predictions"
                  : null;

            const teams = resolveLegTeams(leg);
            const legHasScore =
              leg.kind === "sport" &&
              leg.matchHomeScore != null &&
              leg.matchAwayScore != null;
            const legLive = leg.matchStatus === "live";
            const legFinished = leg.matchStatus === "finished" && legHasScore;
            const legHomeWon =
              legFinished && (leg.matchHomeScore ?? 0) > (leg.matchAwayScore ?? 0);
            const legAwayWon =
              legFinished && (leg.matchAwayScore ?? 0) > (leg.matchHomeScore ?? 0);
            const marketTag = shortMarketBadge(leg.market);

            const stepNode = (
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full font-display text-[10px] font-extrabold transition-colors",
                  leg.status === "won"
                    ? "bg-win text-white shadow-2xs"
                    : leg.status === "lost"
                      ? "bg-betclic-red text-white shadow-2xs"
                      : leg.status === "void"
                        ? "bg-amber-500/20 text-amber-800"
                        : legLive
                          ? "bg-betclic-red/12 text-betclic-red ring-2 ring-betclic-red/25"
                          : "bg-elev text-mist ring-1 ring-edge"
                )}
              >
                {leg.status === "won" ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : leg.status === "lost" ? (
                  <X className="h-3 w-3" strokeWidth={3} />
                ) : leg.status === "void" ? (
                  <RotateCcw className="h-2.5 w-2.5" strokeWidth={2.6} />
                ) : legLive ? (
                  <span className="live-dot h-2 w-2 rounded-full bg-betclic-red" />
                ) : (
                  idx + 1
                )}
              </span>
            );

            const legCardBody = (
              <>
                {/* Métadonnées de la sélection : compétition + horaire / statut live */}
                <div className="flex items-center justify-between gap-2 text-[10.5px]">
                  <div className="flex min-w-0 items-center gap-1.5 text-mist">
                    {leg.kind === "prediction" ? (
                      <TrendingUp className="h-3 w-3 shrink-0 text-betclic-red" strokeWidth={2.3} />
                    ) : (
                      <SportIcon sport={leg.sport || "football"} className="h-3 w-3 shrink-0 text-dim" />
                    )}
                    <span className="truncate font-semibold">{leg.league || "Match"}</span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {legLive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/12 px-1.5 py-0.5 font-display text-[9.5px] font-bold text-betclic-red">
                        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                        {leg.matchMinute ?? "LIVE"}
                      </span>
                    ) : legFinished ? (
                      <span className="text-[10px] font-medium text-dim">Terminé</span>
                    ) : leg.matchStartsAt ? (
                      <span className="font-display text-[10px] font-semibold tabular-nums text-dim">
                        {formatKickoff(leg.matchStartsAt)}
                      </span>
                    ) : null}

                    {legHref && (
                      <ChevronRight className="h-3 w-3 text-dim" strokeWidth={2.3} />
                    )}
                  </div>
                </div>

                {/* Équipes empilées sur 2 lignes avec logos ou intitulé de prédiction */}
                {teams ? (
                  <div className="mt-1.5 flex flex-col gap-1">
                    <TicketTeamRow
                      name={teams.home}
                      logo={leg.homeLogo}
                      score={legHasScore ? leg.matchHomeScore : null}
                      winner={legHomeWon}
                      isLive={legLive}
                      isFinished={legFinished}
                      compact
                    />
                    <TicketTeamRow
                      name={teams.away}
                      logo={leg.awayLogo}
                      score={legHasScore ? leg.matchAwayScore : null}
                      winner={legAwayWon}
                      isLive={legLive}
                      isFinished={legFinished}
                      compact
                    />
                  </div>
                ) : (
                  <p className="mt-1 line-clamp-2 font-display text-[12.5px] font-semibold leading-snug text-ink">
                    {leg.title}
                  </p>
                )}

                {/* Barre de pronostic choisi + cote individuelle */}
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-elev/80 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {marketTag && (
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase text-mist ring-1 ring-edge/80">
                        {marketTag}
                      </span>
                    )}
                    <span
                      className={cn(
                        "truncate font-display text-[12px] font-bold",
                        leg.status === "lost" ? "text-mist line-through" : "text-ink"
                      )}
                    >
                      {leg.selectionLabel}
                    </span>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[11.5px] font-extrabold tabular-nums",
                      leg.status === "won"
                        ? "bg-win text-white"
                        : leg.status === "lost"
                          ? "bg-betclic-red/12 text-betclic-red line-through"
                          : leg.status === "void"
                            ? "bg-amber-500/15 text-amber-800 line-through"
                            : "bg-white text-ink ring-1 ring-edge"
                    )}
                  >
                    {formatOdds(leg.odds, oddsFormat)}
                  </span>
                </div>
              </>
            );

            const legBoxClasses = cn(
              "block w-full rounded-xl border px-2.5 py-2 transition-all",
              leg.status === "won"
                ? "border-win/25 bg-win/[0.025]"
                : leg.status === "lost"
                  ? "border-betclic-red/30 bg-betclic-red/[0.03]"
                  : legLive
                    ? "border-betclic-red/25 bg-white shadow-2xs"
                    : "border-edge bg-white",
              legHref && "hover:border-ink/20 active:scale-[0.99] active:bg-elev/40"
            );

            return (
              <div
                key={`${leg.kind}-${leg.matchId ?? leg.questionId ?? idx}`}
                className="flex items-stretch gap-2.5"
              >
                {/* Rail gauche : pastille numérotée / validée + trait vertical */}
                <div className="flex flex-col items-center pt-1">
                  {stepNode}
                  {!isLastRendered ? (
                    <span
                      aria-hidden
                      className={cn(
                        "my-1 w-[2px] flex-1 rounded-full",
                        leg.status === "won" ? "bg-win/35" : "bg-edge"
                      )}
                    />
                  ) : hasMoreBelow ? (
                    <span
                      aria-hidden
                      className="mt-1 h-3 w-[2px] rounded-full bg-gradient-to-b from-edge to-transparent"
                    />
                  ) : null}
                </div>

                {/* Carte de la sélection */}
                <div className={cn("min-w-0 flex-1", !isLastRendered && "pb-2")}>
                  {legHref ? (
                    <Link href={legHref} className={legBoxClasses}>
                      {legCardBody}
                    </Link>
                  ) : (
                    <div className={legBoxClasses}>{legCardBody}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bouton Accordéon intelligent (3+ sélections) avec blasons empilés */}
        {canCollapse && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(user?.haptics, 8);
              setExpanded((s) => !s);
            }}
            className="mt-2 flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-edge/80 bg-elev/65 px-3 font-display text-[12px] font-bold text-ink transition-colors hover:bg-elev active:scale-[0.99]"
          >
            {!expanded ? (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  {/* Pile miniature des blasons des sélections masquées */}
                  <div className="flex shrink-0 -space-x-1.5">
                    {hiddenLegs.slice(0, 4).map((hl, i) => {
                      const t = resolveLegTeams(hl);
                      return (
                        <TeamAvatar
                          key={` crest-${i}`}
                          name={t?.home ?? hl.title}
                          logo={hl.homeLogo}
                          size="2xs"
                          className="ring-2 ring-white"
                        />
                      );
                    })}
                  </div>
                  <span className="truncate">
                    Voir {hiddenLegs.length} autre{hiddenLegs.length > 1 ? "s" : ""} sélection
                    {hiddenLegs.length > 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {hiddenLiveCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/12 px-1.5 py-0.5 text-[10px] font-extrabold text-betclic-red">
                      <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                      {hiddenLiveCount}
                    </span>
                  )}
                  {hiddenLostCount > 0 && (
                    <span className="rounded-full bg-betclic-red/12 px-1.5 py-0.5 text-[10px] font-extrabold text-betclic-red">
                      {hiddenLostCount} ✕
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 text-mist" strokeWidth={2.4} />
                </div>
              </>
            ) : (
              <div className="mx-auto flex items-center gap-1.5 text-mist">
                <span>Réduire les sélections</span>
                <ChevronDown
                  className="h-4 w-4 rotate-180 transition-transform"
                  strokeWidth={2.4}
                />
              </div>
            )}
          </button>
        )}
      </div>

      {/* Ligne de découpe coupon avec encoches latérales */}
      <div className="relative flex items-center px-3.5" aria-hidden>
        <span className="absolute -left-2 h-4 w-4 rounded-full border border-edge bg-deep" />
        <div className="w-full border-t border-dashed border-edge" />
        <span className="absolute -right-2 h-4 w-4 rounded-full border border-edge bg-deep" />
      </div>

      {/* Talon financier du combiné + Cash Out */}
      <div className="px-3.5 pt-2.5 pb-3.5">
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5",
            won
              ? "bg-win/10"
              : cashed
                ? "bg-sky-500/10"
                : "bg-elev/75"
          )}
        >
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                Mise
              </p>
              <p className="mt-0.5 font-display text-[13.5px] font-bold tabular-nums text-ink">
                {eur(bet.stake)}
              </p>
            </div>

            <div className="h-7 w-px bg-edge" aria-hidden />

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                Cote totale
              </p>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                {hasBoost && bet.baseOdds != null && (
                  <span className="font-display text-[11px] font-semibold tabular-nums text-dim line-through">
                    {formatOdds(bet.baseOdds, oddsFormat)}
                  </span>
                )}
                <span className="font-display text-[14px] font-extrabold tabular-nums text-betclic-red">
                  ×{formatOdds(bet.odds, oddsFormat)}
                </span>
              </div>
            </div>
          </div>

          <div className="text-right">
            {won ? (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wide text-win">
                  Gain reçu
                </p>
                <p className="mt-0.5 font-display text-[16.5px] font-extrabold tabular-nums text-win">
                  +{eur(bet.potentialWin)}
                </p>
              </>
            ) : lost ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                  Résultat
                </p>
                <p className="mt-0.5 font-display text-[14.5px] font-bold tabular-nums text-mist">
                  -{eur(bet.stake)}
                </p>
              </>
            ) : cashed ? (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">
                  Vendu pour
                </p>
                <p className="mt-0.5 font-display text-[16px] font-extrabold tabular-nums text-sky-700">
                  +{eur(bet.cashOutAmount ?? 0)}
                </p>
              </>
            ) : voided ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  Remboursé
                </p>
                <p className="mt-0.5 font-display text-[15px] font-bold tabular-nums text-ink">
                  +{eur(bet.stake)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                  Gain max
                </p>
                <p className="mt-0.5 font-display text-[16.5px] font-extrabold tabular-nums text-win">
                  {eur(bet.potentialWin)}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Vendre le coupon (1xBet Cash Out temps réel glisser-confirmer) */}
        {canCashOut && (
          <div className="mt-2.5">
            <SlideToCashOut
              amount={bet.cashOut!}
              stake={bet.stake}
              loading={cashing}
              haptics={user?.haptics}
              onConfirm={doCashOut}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function SingleBetTicket({
  bet,
  onShare,
}: {
  bet: ClientBet;
  onShare?: (bet: ClientBet) => void;
}) {
  const { oddsFormat, setBalance, bumpBets, toast, user } = useApp();
  const [cashing, setCashing] = useState(false);

  const isPrediction = bet.kind === "prediction";
  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const live = bet.matchStatus === "live" && bet.status === "pending";
  const canCashOut = bet.status === "pending" && bet.cashOut != null;

  const doCashOut = async () => {
    if (cashing) return;
    setCashing(true);
    try {
      const r = await api.cashOut(bet.id, bet.kind);
      setBalance(r.balance);
      bumpBets();
      playUiSound(user?.sound, "win");
      triggerHaptic(user?.haptics, [22, 30, 45]);
      toast({
        kind: "success",
        title: "Coupon vendu",
        description: `+${eur(r.value)} crédités sur votre solde`,
      });
    } catch (e) {
      toast({
        kind: "error",
        title: "Vente du coupon impossible",
        description: e instanceof Error ? e.message : "Réessayez dans un instant",
      });
    } finally {
      setCashing(false);
    }
  };

  return (
    <article
      className={cn(
        "glass-card overflow-hidden rounded-2xl p-3.5 transition-opacity",
        won && "ticket-won",
        lost && "opacity-75"
      )}
    >
      {/* En-tête : ligue/catégorie + bouton partager + badge de statut */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-mist">
          {isPrediction ? (
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
          ) : (
            <SportIcon sport={bet.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
          )}
          {!isPrediction && bet.matchSource && (
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide",
                bet.matchSource === "manual"
                  ? "bg-emerald-600/12 text-emerald-700"
                  : "bg-elev text-dim"
              )}
            >
              {bet.matchSource === "manual" ? "Réel" : "Virtuel"}
            </span>
          )}
          <span className="truncate">{bet.league}</span>
          <span className="text-dim">·</span>
          <span className="shrink-0 text-[11px] text-dim">
            {formatPlacedAt(
              bet.status !== "pending" ? (bet.settledAt ?? bet.placedAt) : bet.placedAt
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(bet)}
              aria-label="Partager ce ticket"
              className="inline-flex h-6 items-center gap-1 rounded-full bg-elev px-2 font-display text-[10px] font-bold text-mist active:bg-edge active:text-ink"
            >
              <Share2 className="h-3 w-3" strokeWidth={2.2} />
              Flex
            </button>
          )}
          <StatusPill status={bet.status} live={live} minute={bet.matchMinute} />
        </div>
      </div>

      {/* Événement */}
      <div className="mt-2.5">
        {isPrediction ? (
          <>
            <p className="font-display text-[14.5px] font-semibold leading-snug text-ink">
              {bet.question}
            </p>
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[12.5px] font-semibold text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-betclic-red">
                {formatOdds(bet.odds, oddsFormat)}
              </span>
            </div>
          </>
        ) : (
          <>
            {(() => {
              const hasScore = bet.matchHomeScore != null && bet.matchAwayScore != null;
              const matchLive = bet.matchStatus === "live" && hasScore;
              const matchFinished = bet.matchStatus === "finished" && hasScore;
              const homeWon =
                matchFinished && (bet.matchHomeScore ?? 0) > (bet.matchAwayScore ?? 0);
              const awayWon =
                matchFinished && (bet.awayTeam != null && (bet.matchAwayScore ?? 0) > (bet.matchHomeScore ?? 0));

              const rows = (
                <div className="flex w-full items-center gap-2.5">
                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <TicketTeamRow
                      name={bet.homeTeam}
                      logo={bet.homeLogo}
                      score={hasScore ? bet.matchHomeScore : null}
                      winner={homeWon}
                      isLive={matchLive}
                      isFinished={matchFinished}
                    />
                    <TicketTeamRow
                      name={bet.awayTeam}
                      logo={bet.awayLogo}
                      score={hasScore ? bet.matchAwayScore : null}
                      winner={awayWon}
                      isLive={matchLive}
                      isFinished={matchFinished}
                    />
                  </div>
                  {!hasScore && bet.matchStartsAt && (
                    <span className="shrink-0 rounded-full bg-elev px-2.5 py-0.5 font-display text-[10.5px] font-semibold tabular-nums text-ink">
                      {formatKickoff(bet.matchStartsAt)}
                    </span>
                  )}
                  {bet.matchId && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
                  )}
                </div>
              );

              return bet.matchId ? (
                <Link
                  href={`/resultats?match=${bet.matchId}`}
                  className="-mx-1.5 flex items-center rounded-xl px-1.5 py-1 transition-colors hover:bg-elev/70 active:bg-elev"
                >
                  {rows}
                </Link>
              ) : (
                rows
              );
            })()}

            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[12.5px] font-semibold text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[13.5px] font-bold tabular-nums text-betclic-red">
                {formatOdds(bet.odds, oddsFormat)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Montants */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-2.5">
        <Amount label="Mise" value={eur(bet.stake)} tone="neutral" />
        <Amount
          label="Cote"
          value={formatOdds(bet.odds, oddsFormat)}
          tone="neutral"
        />
        {won ? (
          <Amount label="Gain reçu" value={`+${eur(bet.potentialWin)}`} tone="win" align="right" />
        ) : lost ? (
          <Amount label="Résultat" value={`-${eur(bet.stake)}`} tone="lost" align="right" />
        ) : cashed ? (
          <Amount
            label="Vendu pour"
            value={`+${eur(bet.cashOutAmount ?? 0)}`}
            tone="cash"
            align="right"
          />
        ) : voided ? (
          <Amount
            label="Remboursé"
            value={`+${eur(bet.stake)}`}
            tone="neutral"
            align="right"
          />
        ) : (
          <Amount label="Gain max" value={eur(bet.potentialWin)} tone="pot" align="right" />
        )}
      </div>

      {/* Vendre le coupon (1xBet Cash Out temps réel glisser-confirmer) */}
      {canCashOut && (
        <div className="mt-3">
          <SlideToCashOut
            amount={bet.cashOut!}
            stake={bet.stake}
            loading={cashing}
            haptics={user?.haptics}
            onConfirm={doCashOut}
          />
        </div>
      )}
    </article>
  );
}

function TicketTeamRow({
  name,
  logo,
  score,
  winner,
  isLive,
  isFinished,
  compact = false,
}: {
  name: string;
  logo?: string | null;
  score?: number | null;
  winner?: boolean;
  isLive?: boolean;
  isFinished?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <TeamAvatar name={name} logo={logo} size={compact ? "2xs" : "xs"} />
      <span
        className={cn(
          "truncate font-display font-semibold leading-snug",
          compact ? "text-[12.5px]" : "text-[14px]",
          isFinished && !winner ? "text-mist" : "text-ink"
        )}
      >
        {name}
      </span>
      {score != null && (
        <span
          className={cn(
            "ml-auto min-w-[20px] rounded-md px-1.5 py-0.5 text-center font-display font-bold leading-none tabular-nums",
            compact ? "text-[13px]" : "text-[15px]",
            isLive
              ? "bg-betclic-red/10 text-betclic-red"
              : isFinished && winner
                ? "bg-elev text-ink"
                : "text-mist"
          )}
        >
          {score}
        </span>
      )}
    </div>
  );
}

function StatusPill({
  status,
  live,
  minute,
}: {
  status: ClientBet["status"];
  live: boolean;
  minute: string | null;
}) {
  if (status === "won") {
    return (
      <span className="shrink-0 rounded-full bg-win/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-win">
        Gagné
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span className="shrink-0 rounded-full bg-elev px-2.5 py-0.5 font-display text-[10.5px] font-semibold text-dim">
        Perdu
      </span>
    );
  }
  if (status === "cashed") {
    return (
      <span className="shrink-0 rounded-full bg-sky-500/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-sky-700">
        Vendu
      </span>
    );
  }
  if (status === "void") {
    return (
      <span className="shrink-0 rounded-full bg-amber-500/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-amber-800">
        Remboursé
      </span>
    );
  }
  if (live) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-betclic-red/10 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-betclic-red">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
        Direct {minute ?? ""}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-elev px-2.5 py-0.5 font-display text-[10.5px] font-semibold text-ink">
      En cours
    </span>
  );
}

function Amount({
  label,
  value,
  tone,
  align,
}: {
  label: string;
  value: string;
  tone: "neutral" | "win" | "lost" | "cash" | "pot";
  align?: "right";
}) {
  return (
    <div className={cn(align === "right" && "text-right")}>
      <p className="text-[10.5px] font-medium text-dim">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-display text-[13.5px] font-bold tabular-nums",
          tone === "win" && "text-win",
          tone === "lost" && "text-mist",
          tone === "cash" && "text-sky-700",
          tone === "pot" && "text-ink",
          tone === "neutral" && "text-ink"
        )}
      >
        {value}
      </p>
    </div>
  );
}
