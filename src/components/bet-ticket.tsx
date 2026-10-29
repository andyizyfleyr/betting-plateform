"use client";

import { useMemo } from "react";
import {
  Check,
  ChevronRight,
  Layers,
  RotateCcw,
  Share2,
  TrendingUp,
  X,
} from "lucide-react";
import type { ClientBet, ClientComboLeg } from "@/lib/api";
import { rememberSingleBet } from "@/lib/client-entity-cache";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import { CardOverlayLink } from "./card-overlay-link";
import { LiveMatchClock } from "./live-match-clock";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";
import type { LiveClockSource } from "@/lib/live-clock";
import { cn, eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import { useApp } from "./providers";

export function shortMarketBadge(market: string): string | null {
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
    case "total_ou":
      return "Total";
    case "ou35":
      return "T 3.5";
    case "dnb":
      return "DNB";
    case "score_exact":
      return "Score";
    case "yesno":
      return "Oui/Non";
    case "multichoice":
      return "Choix";
    default:
      return null;
  }
}

export function resolveLegTeams(
  leg: ClientComboLeg
): { home: string; away: string } | null {
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

export function singleBetHref(bet: Pick<ClientBet, "id" | "kind">): string {
  return bet.kind === "prediction"
    ? `/paris/simple/pred-${bet.id}`
    : `/paris/simple/sport-${bet.id}`;
}

export function BetTicket({
  bet,
  onShare,
}: {
  bet: ClientBet;
  index?: number;
  onShare?: (bet: ClientBet) => void;
}) {
  if (bet.kind === "combo") {
    return <ComboBetTicket bet={bet} legs={bet.legs ?? []} onShare={onShare} />;
  }
  return <SingleBetTicket bet={bet} onShare={onShare} />;
}

/**
 * Carte de pari combiné compacte (même gabarit qu'un pari simple).
 * Un clic ouvre la page dédiée `/paris/combine/[id]` avec toutes les sélections détaillées.
 */
function ComboBetTicket({
  bet,
  legs,
  onShare,
}: {
  bet: ClientBet;
  legs: ClientComboLeg[];
  onShare?: (bet: ClientBet) => void;
}) {
  const { oddsFormat } = useApp();
  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const sortedLegs = useMemo(
    () => sortComboBetLegsChronologically(legs),
    [legs]
  );
  const totalLegs = sortedLegs.length;
  const wonCount = sortedLegs.filter((l) => l.status === "won").length;
  const lostCount = sortedLegs.filter((l) => l.status === "lost").length;
  const liveCount = sortedLegs.filter(
    (l) => l.status === "pending" && l.matchStatus === "live"
  ).length;
  const anyLive =
    bet.status === "pending" && (liveCount > 0 || bet.matchStatus === "live");

  const previewLegs = sortedLegs.slice(0, 2);
  const extraCount = Math.max(0, totalLegs - previewLegs.length);

  const progressSummary = (() => {
    if (won) return `${totalLegs}/${totalLegs} sélections validées`;
    if (cashed) {
      return `Vendu · ${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""}`;
    }
    if (voided) return "Combiné remboursé";
    if (lost) {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${lostCount} perdue${lostCount > 1 ? "s" : ""}`;
    }
    if (liveCount > 0) {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${liveCount} en direct`;
    }
    return `${wonCount}/${totalLegs} sélection${totalLegs > 1 ? "s" : ""} validée${wonCount > 1 ? "s" : ""}`;
  })();


  return (
    <article
      className={cn(
        "glass-card relative cursor-pointer overflow-hidden rounded-2xl p-3.5 transition-all hover:bg-elev/20 active:bg-elev/35",
        won && "ticket-won",
        lost && "border-betclic-red/25"
      )}
    >
      <CardOverlayLink
        href={`/paris/combine/${bet.id}`}
        label={`Ouvrir le combiné #${bet.id}`}
        onBeforeNavigate={() => rememberSingleBet(bet)}
      />

      {/* En-tête identique aux paris simples */}
      <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-medium text-mist">
          <Layers className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
          <span className="truncate font-medium text-ink">Combiné</span>
          {bet.boostPct != null && bet.boostPct > 0 && (
            <span className="shrink-0 rounded-md bg-win/12 px-1.5 py-0.5 font-display text-[9.5px] font-medium text-win">
              +{bet.boostPct}%
            </span>
          )}
          <span className="text-dim">·</span>
          <span className="shrink-0 text-[10px] text-dim">
            {formatPlacedAt(
              bet.status !== "pending"
                ? (bet.settledAt ?? bet.placedAt)
                : bet.placedAt
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(bet)}
              aria-label="Partager ce combiné"
              className="pointer-events-auto relative z-10 inline-flex h-6 items-center gap-1 rounded-full bg-elev px-2 font-display text-[9.5px] font-medium text-mist hover:bg-edge hover:text-ink active:bg-edge active:text-ink"
            >
              <Share2 className="h-3 w-3" strokeWidth={2.2} />
              Flex
            </button>
          )}
          <StatusPill
            status={bet.status}
            live={anyLive}
            minute={bet.matchMinute}
            clockSource={
              anyLive
                ? (() => {
                    const liveLeg = legs.find(
                      (l) => l.status === "pending" && l.matchStatus === "live"
                    );
                    return {
                      matchId: bet.liveMatchId ?? liveLeg?.matchId ?? null,
                      status: "live",
                      minute: bet.matchMinute ?? liveLeg?.matchMinute ?? null,
                      startsAt:
                        bet.liveMatchStartsAt ?? liveLeg?.matchStartsAt ?? null,
                      source:
                        bet.liveMatchSource ?? liveLeg?.matchSource ?? null,
                      clockAnchor:
                        bet.matchClockAnchor ?? liveLeg?.matchClockAnchor ?? null,
                    };
                  })()
                : null
            }
          />
        </div>
      </div>

      {/* Corps du ticket combiné */}
      <div className="pointer-events-none relative z-[1] mt-2.5 block rounded-xl">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            {previewLegs.map((leg, idx) => {
              const teams = resolveLegTeams(leg);
              const legLive = leg.status === "pending" && leg.matchStatus === "live";
              const titleText = teams ? `${teams.home} – ${teams.away}` : leg.title;
              return (
                <div
                  key={`${leg.kind}-${leg.matchId ?? leg.questionId ?? idx}`}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <LegMiniStatus leg={leg} live={legLive} />
                    {teams ? (
                      <TeamAvatar name={teams.home} logo={leg.homeLogo} size="2xs" />
                    ) : (
                      <TrendingUp
                        className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                        strokeWidth={2.2}
                      />
                    )}
                    <span
                      className={cn(
                        "truncate font-display text-[11.5px] font-medium leading-snug",
                        leg.status === "lost" ? "text-mist line-through" : "text-ink"
                      )}
                    >
                      {titleText}
                    </span>
                  </div>

                  <span className="shrink-0 font-display text-[11px] font-medium tabular-nums text-mist">
                    {formatOdds(leg.odds, oddsFormat)}
                  </span>
                </div>
              );
            })}
          </div>

          <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
        </div>

        {/* Barre compacte de synthèse (même gabarit que la barre de sélection d'un pari simple) */}
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-elev px-3 py-2">
          <span className="truncate text-[10.5px] font-medium text-ink">
            {progressSummary}
            {extraCount > 0
              ? ` · +${extraCount} autre${extraCount > 1 ? "s" : ""}`
              : ""}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-display text-[10.5px] font-medium text-betclic-red">
            Détails
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </div>
      </div>

      {/* Montants en ligne (Nom en petit + valeur en grand) */}
      <div className="pointer-events-none relative z-[1] mt-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-edge pt-2.5">
        <Amount label="Mise" value={eur(bet.stake)} tone="neutral" />
        <Amount
          label="Cote"
          value={`×${formatOdds(bet.odds, oddsFormat)}`}
          tone="neutral"
        />
        {won ? (
          <Amount
            label="Gain reçu"
            value={`+${eur(bet.potentialWin)}`}
            tone="win"
            align="right"
          />
        ) : lost ? (
          <Amount
            label="Résultat"
            value={`-${eur(bet.stake)}`}
            tone="lost"
            align="right"
          />
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
          <Amount
            label="Gain max"
            value={eur(bet.potentialWin)}
            tone="pot"
            align="right"
          />
        )}
      </div>

    </article>
  );
}

function LegMiniStatus({
  leg,
  live,
}: {
  leg: ClientComboLeg;
  live: boolean;
}) {
  if (leg.status === "won") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-win text-white">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (leg.status === "lost") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-betclic-red text-white">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (leg.status === "void") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-500/20 text-amber-800">
        <RotateCcw className="h-2.5 w-2.5" strokeWidth={2.6} />
      </span>
    );
  }
  if (live) {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-betclic-red/12">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
      </span>
    );
  }
  return (
    <span className="h-2 w-2 shrink-0 rounded-full bg-ink/20" aria-hidden />
  );
}

function SingleBetTicket({
  bet,
  onShare,
}: {
  bet: ClientBet;
  onShare?: (bet: ClientBet) => void;
}) {
  const { oddsFormat } = useApp();
  const detailHref = singleBetHref(bet);
  const isPrediction = bet.kind === "prediction";
  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const live = bet.matchStatus === "live" && bet.status === "pending";

  return (
    <article
      className={cn(
        "glass-card relative cursor-pointer overflow-hidden rounded-2xl p-3.5 transition-all hover:bg-elev/20 active:bg-elev/35",
        won && "ticket-won",
        lost && "border-betclic-red/25"
      )}
    >
      <CardOverlayLink
        href={detailHref}
        label={
          isPrediction
            ? `Ouvrir le pari prédiction #${bet.id}`
            : `Ouvrir le pari #${bet.id}`
        }
        onBeforeNavigate={() => rememberSingleBet(bet)}
      />

      {/* En-tête : ligue/catégorie + date/heure + bouton partager + badge de statut */}
      <div className="pointer-events-none relative z-[1] flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-medium text-mist">
          {isPrediction ? (
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-betclic-red" strokeWidth={2.3} />
          ) : (
            <SportIcon sport={bet.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
          )}
          {!isPrediction && bet.matchSource === "manual" && (
            <span className="hidden shrink-0 rounded-md bg-emerald-600/12 px-1.5 py-0.5 font-display text-[9px] font-medium uppercase tracking-wide text-emerald-700 lg:inline-block">
              Réel
            </span>
          )}
          <span className="truncate">{bet.league}</span>
          <span
            className={cn(
              "text-dim",
              !isPrediction && bet.matchStartsAt && !live && "hidden sm:inline"
            )}
          >
            ·
          </span>
          <span
            className={cn(
              "shrink-0 text-[10px] tabular-nums text-dim",
              !isPrediction && bet.matchStartsAt && !live && "hidden sm:inline"
            )}
          >
            {formatPlacedAt(
              bet.status !== "pending" ? (bet.settledAt ?? bet.placedAt) : bet.placedAt
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!isPrediction && bet.matchStartsAt && !live && (
            <span className="text-[9.5px] font-medium tabular-nums text-dim sm:text-[10px]">
              {formatKickoff(bet.matchStartsAt)}
            </span>
          )}
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(bet)}
              aria-label="Partager ce ticket"
              className="pointer-events-auto relative z-10 inline-flex h-6 items-center gap-1 rounded-full bg-elev px-2 font-display text-[9.5px] font-medium text-mist hover:bg-edge hover:text-ink active:bg-edge active:text-ink"
            >
              <Share2 className="h-3 w-3" strokeWidth={2.2} />
              Flex
            </button>
          )}
          <StatusPill
            status={bet.status}
            live={live}
            minute={bet.matchMinute}
            clockSource={
              live
                ? {
                    matchId: bet.matchId,
                    status: "live",
                    minute: bet.matchMinute,
                    startsAt: bet.matchStartsAt,
                    source: bet.matchSource ?? null,
                    clockAnchor: bet.matchClockAnchor ?? null,
                  }
                : null
            }
          />
        </div>
      </div>

      {/* Corps du ticket simple */}
      <div className="pointer-events-none relative z-[1] mt-2.5 block rounded-xl">
        {isPrediction ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-[12px] font-medium leading-snug text-ink">
                {bet.question}
              </p>
              <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
            </div>
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[11px] font-medium text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[11.5px] font-medium tabular-nums text-ink">
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
                matchFinished &&
                bet.awayTeam != null &&
                (bet.matchAwayScore ?? 0) > (bet.matchHomeScore ?? 0);

              return (
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
                  <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
                </div>
              );
            })()}

            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-elev px-3 py-2">
              <span className="truncate pr-2 text-[11px] font-medium text-ink">
                {bet.selectionLabel}
              </span>
              <span className="shrink-0 font-display text-[11.5px] font-medium tabular-nums text-ink">
                {formatOdds(bet.odds, oddsFormat)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Montants en ligne (Nom en petit + valeur en grand) */}
      <div className="pointer-events-none relative z-[1] mt-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-edge pt-2.5">
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

    </article>
  );
}

export function TicketTeamRow({
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
          "truncate font-display font-medium leading-snug",
          compact ? "text-[11px]" : "text-[11.5px]",
          isFinished && !winner ? "text-mist" : "text-ink"
        )}
      >
        {name}
      </span>
      {score != null && (
        <span
          className={cn(
            "ml-auto min-w-[20px] rounded-md px-1.5 py-0.5 text-center font-display font-medium leading-none tabular-nums",
            compact ? "text-[11px]" : "text-[12px]",
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

export function StatusPill({
  status,
  live,
  minute,
  clockSource,
}: {
  status: ClientBet["status"];
  live: boolean;
  minute: string | null;
  clockSource?: LiveClockSource | null;
}) {
  if (status === "won") {
    return (
      <span className="shrink-0 rounded-full bg-win/12 px-2.5 py-0.5 font-display text-[10px] font-medium text-win">
        Gagné
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/12 px-2.5 py-0.5 font-display text-[10px] font-medium text-betclic-red">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
        Perdu
      </span>
    );
  }
  if (status === "cashed") {
    return (
      <span className="shrink-0 rounded-full bg-sky-500/12 px-2.5 py-0.5 font-display text-[10px] font-medium text-sky-700">
        Vendu
      </span>
    );
  }
  if (status === "void") {
    return (
      <span className="shrink-0 rounded-full bg-amber-500/12 px-2.5 py-0.5 font-display text-[10px] font-medium text-amber-800">
        Remboursé
      </span>
    );
  }
  if (live) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-betclic-red/10 px-2.5 py-0.5 font-display text-[10px] font-medium tabular-nums text-betclic-red">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
        Direct{" "}
        <LiveMatchClock
          match={clockSource}
          fallback={minute ?? "LIVE"}
        />
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-elev px-2.5 py-0.5 font-display text-[10px] font-medium text-ink">
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
    <div
      className={cn(
        "inline-flex items-baseline gap-1 whitespace-nowrap",
        align === "right" && "justify-end text-right"
      )}
    >
      <span className="text-[10px] font-medium text-dim">{label} :</span>
      <span
        className={cn(
          "font-display text-[11.5px] font-medium tabular-nums",
          tone === "win" && "text-win",
          tone === "lost" && "text-betclic-red",
          tone === "cash" && "text-sky-700",
          tone === "pot" && "text-ink",
          tone === "neutral" && "text-ink"
        )}
      >
        {value}
      </span>
    </div>
  );
}
