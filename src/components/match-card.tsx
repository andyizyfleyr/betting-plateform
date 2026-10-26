"use client";

import { memo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ChevronRight, Lock, Radio } from "lucide-react";
import type { ClientMatch, ClientMatchEvent } from "@/lib/api";
import { useLongPressOdds } from "@/lib/use-long-press-odds";
import type { ComboSelection } from "./combo-slip";
import { OddsTrendCorner, useOddsTrend } from "./odds-trend-corner";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { KickoffCountdown } from "./kickoff-countdown";
import { LiveMatchTracker } from "./live-match-tracker";
import { hasAnyRealStats, RealMatchStatsCard } from "./real-match-stats-card";
import { formatGoalSummaryStrings } from "@/lib/match-events";
import { cn, formatKickoff, formatOdds } from "@/lib/format";

export function LiveStatusBadge({
  minute,
  suspended,
}: {
  minute: string | null;
  suspended?: boolean;
}) {
  const isHalfTime = minute === "MT" || minute === "HT";

  if (suspended) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-display text-[10.5px] font-bold text-amber-700">
        <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />
        Suspendu · {minute ?? "LIVE"}
      </span>
    );
  }

  if (isHalfTime) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-display text-[10.5px] font-bold text-amber-700">
        Mi-temps
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-betclic-red/12 px-2.5 py-0.5 font-display text-[10.5px] font-bold tabular-nums text-betclic-red">
      <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
      {minute ?? "LIVE"}
    </span>
  );
}

export function formatGoalSummary(
  events?: ClientMatchEvent[],
  homeScore?: number | null,
  awayScore?: number | null
): {
  homeGoals: string[];
  awayGoals: string[];
} {
  return formatGoalSummaryStrings(events, homeScore, awayScore);
}

function MatchCardInner({
  match,
  nextUp,
  className,
}: {
  match: ClientMatch;
  index?: number;
  nextUp?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { openMarkets } = useApp();
  const [showTracker, setShowTracker] = useState(false);
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isReal = match.source === "manual";
  const realStatsAvailable = isReal && hasAnyRealStats(match.realStats);
  const marketCount = match.markets?.length ?? 0;

  return (
    <article
      onClick={() => {
        if (isFinished) {
          router.push(`/resultats?match=${match.id}`);
        } else {
          openMarkets(match);
        }
      }}
      className={cn(
        "glass-card relative flex cursor-pointer flex-col overflow-hidden rounded-2xl p-4 transition-colors active:bg-elev/45 lg:p-3.5",
        !isFinished && "max-lg:min-h-[194px]",
        className
      )}
    >
      {(isLive || isReal) && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            isReal
              ? isLive
                ? "bg-emerald-600"
                : "bg-emerald-600/55"
              : "bg-betclic-red"
          )}
        />
      )}

      {/* En-tête : ligue + statut (compact sur mobile, sans bouton Stats mobile) */}
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-1.5 text-mist">
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase tracking-wide",
              isReal
                ? "hidden bg-emerald-600/12 text-emerald-700 lg:inline-block"
                : "inline-block bg-betclic-red/10 text-betclic-red lg:bg-elev lg:text-dim"
            )}
          >
            {isReal ? "Réel" : "Virtuel"}
          </span>
          <SportIcon sport={match.sport} className="h-4 w-4 shrink-0 text-dim lg:h-3.5 lg:w-3.5" />
          <span className="truncate font-semibold">{match.league}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isLive ? (
            <>
              {isReal ? (
                realStatsAvailable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTracker((s) => !s);
                    }}
                    className={cn(
                      "hidden items-center gap-1 rounded-full px-2 py-0.5 font-display text-[10px] font-bold transition-colors lg:inline-flex",
                      showTracker ? "bg-emerald-700 text-white" : "bg-elev text-mist"
                    )}
                  >
                    <BarChart3 className="h-2.5 w-2.5" strokeWidth={2.4} />
                    Stats
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTracker((s) => !s);
                  }}
                  className={cn(
                    "hidden items-center gap-1 rounded-full px-2 py-0.5 font-display text-[10px] font-bold transition-colors lg:inline-flex",
                    showTracker ? "bg-emerald-700 text-white" : "bg-elev text-mist"
                  )}
                >
                  <Radio className="h-2.5 w-2.5" strokeWidth={2.4} />
                  2D
                </button>
              )}
              <LiveStatusBadge minute={match.minute} suspended={match.suspended} />
            </>
          ) : isFinished ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-elev px-2 py-0.5 font-display text-[10px] font-semibold text-dim">
              Terminé
              <ChevronRight className="h-3 w-3" strokeWidth={2.3} />
            </span>
          ) : isReal && match.kickoffReached ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-display text-[10px] font-bold text-amber-700">
              <Lock className="h-2.5 w-2.5" strokeWidth={2.4} />
              Coup d&apos;envoi atteint
            </span>
          ) : isReal ? (
            <span className="rounded-full bg-elev px-2 py-0.5 font-display text-[10px] font-semibold text-ink">
              {formatKickoff(match.startsAt)}
            </span>
          ) : (
            <>
              {nextUp && (
                <span className="rounded-full bg-ink/8 px-2 py-0.5 font-display text-[10px] font-bold text-ink">
                  Suivant
                </span>
              )}
              <KickoffCountdown startsAt={match.startsAt} />
            </>
          )}

          {!isFinished && marketCount > 1 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-elev px-1.5 py-0.5 font-display text-[10px] font-bold text-ink lg:hidden">
              +{marketCount - 1}
              <ChevronRight className="h-2.5 w-2.5 text-betclic-red" strokeWidth={2.6} />
            </span>
          )}
        </div>
      </div>

      {/* Équipes & scores aérés */}
      <div className="mt-3.5 flex flex-col gap-2.5 lg:mt-2.5 lg:gap-1.5">
        <TeamRow
          name={match.homeTeam}
          logo={match.homeLogo}
          score={match.homeScore}
          redCards={match.redHome ?? 0}
          winner={isFinished && (match.homeScore ?? 0) > (match.awayScore ?? 0)}
          isLive={isLive}
        />
        <TeamRow
          name={match.awayTeam}
          logo={match.awayLogo}
          score={match.awayScore}
          redCards={match.redAway ?? 0}
          winner={isFinished && (match.awayScore ?? 0) > (match.homeScore ?? 0)}
          isLive={isLive}
        />
      </div>

      {/* Tracker 2D virtuel ou statistiques officielles (desktop uniquement) */}
      {!isReal && isLive && showTracker && (
        <div className="hidden lg:block">
          <LiveMatchTracker match={match} className="mt-2.5" />
        </div>
      )}
      {isReal && isLive && showTracker && realStatsAvailable && (
        <div className="hidden lg:block">
          <RealMatchStatsCard
            stats={match.realStats}
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homeLogo={match.homeLogo}
            awayLogo={match.awayLogo}
            htHomeScore={match.htHomeScore}
            htAwayScore={match.htAwayScore}
            compact
            className="mt-2.5"
          />
        </div>
      )}

      {/* Cotes 1x2 (V1 / X / V2) + accès aux marchés sur desktop */}
      {!isFinished && (
        <div className="mt-auto pt-3.5 lg:pt-3">
          <ResultOdds match={match} />
          {marketCount > 1 && (
            <div className="mt-2 hidden items-center justify-between gap-2 border-t border-edge/60 pt-1.5 text-[11px] lg:flex">
              <span className="truncate text-dim">
                Total, Double chance, Handicap, Score exact…
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 font-display font-bold text-ink">
                +{marketCount - 1} marchés
                <ChevronRight className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
              </span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function areMatchCardPropsEqual(
  prev: { match: ClientMatch; index?: number; nextUp?: boolean; className?: string },
  next: { match: ClientMatch; index?: number; nextUp?: boolean; className?: string }
): boolean {
  if (prev.nextUp !== next.nextUp || prev.className !== next.className) return false;
  const a = prev.match;
  const b = next.match;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.minute === b.minute &&
    a.homeScore === b.homeScore &&
    a.awayScore === b.awayScore &&
    a.oddsHome === b.oddsHome &&
    a.oddsDraw === b.oddsDraw &&
    a.oddsAway === b.oddsAway &&
    a.suspended === b.suspended &&
    a.kickoffReached === b.kickoffReached &&
    a.startsAt === b.startsAt &&
    a.redHome === b.redHome &&
    a.redAway === b.redAway &&
    a.homeTeam === b.homeTeam &&
    a.awayTeam === b.awayTeam &&
    a.homeLogo === b.homeLogo &&
    a.awayLogo === b.awayLogo &&
    (a.markets?.length ?? 0) === (b.markets?.length ?? 0) &&
    (a.events?.length ?? 0) === (b.events?.length ?? 0) &&
    a.realStats?.updatedAt === b.realStats?.updatedAt
  );
}

export const MatchCard = memo(MatchCardInner, areMatchCardPropsEqual);

const TeamRow = memo(function TeamRow({
  name,
  logo,
  score,
  redCards,
  winner,
  isLive,
}: {
  name: string;
  logo?: string | null;
  score: number | null;
  redCards: number;
  winner: boolean;
  isLive: boolean;
}) {
  const isFinished = score != null && !isLive;
  return (
    <div className="flex items-center gap-2.5">
      <TeamAvatar name={name} logo={logo} size="sm" className="lg:h-7 lg:w-7" />
      <span
        className={cn(
          "truncate font-display text-[14.5px] font-semibold leading-snug lg:text-[14px]",
          isFinished && !winner ? "text-mist" : "text-ink"
        )}
      >
        {name}
      </span>

      {redCards > 0 && (
        <span className="inline-flex shrink-0 items-center gap-0.5" title={`${redCards} carton(s) rouge(s)`}>
          {Array.from({ length: redCards }).map((_, i) => (
            <span
              key={i}
              className="inline-block h-3 w-2 rounded-[2px] bg-betclic-red shadow-xs"
            />
          ))}
        </span>
      )}

      {score != null && (
        <span
          className={cn(
            "ml-auto min-w-[24px] rounded-md px-1.5 py-0.5 text-center font-display text-[15px] font-bold leading-none tabular-nums",
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
});

export function ResultOdds({ match }: { match: ClientMatch }) {
  const { openBet, target, isInCombo, comboQuickMode, toggleComboLeg, toast } = useApp();
  const comboUid = `sport-${match.id}`;

  // Si en fin de match une issue 1x2 est déjà fermée dans markets, on reflète exactement les issues ouvertes
  const resGroup = match.markets?.find((g) => g.key === "result");
  const openKeys = resGroup ? new Set(resGroup.outcomes.map((o) => o.key)) : null;

  const cells: { key: string; tag: string; odds: number; label: string; closed: boolean }[] = [
    {
      key: "home",
      tag: "V1",
      odds: match.oddsHome,
      label: `V1 (${match.homeTeam})`,
      closed: openKeys ? !openKeys.has("home") : false,
    },
    ...(match.oddsDraw != null
      ? [
          {
            key: "draw",
            tag: "X",
            odds: match.oddsDraw,
            label: "X (Match nul)",
            closed: openKeys ? !openKeys.has("draw") : false,
          },
        ]
      : []),
    {
      key: "away",
      tag: "V2",
      odds: match.oddsAway,
      label: `V2 (${match.awayTeam})`,
      closed: openKeys ? !openKeys.has("away") : false,
    },
  ];

  return (
    <div className={cn("grid gap-1.5", cells.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {cells.map((c) => {
        const isSelected =
          target?.match.id === match.id &&
          target?.market === "result" &&
          target?.selection === c.key;
        const inCombo = isInCombo(comboUid, "result", c.key);
        const locked = match.suspended || c.closed;

        const comboSel: ComboSelection = {
          uid: comboUid,
          kind: "sport",
          matchId: match.id,
          matchSource: match.source,
          title: `${match.homeTeam} – ${match.awayTeam}`,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeLogo: match.homeLogo,
          awayLogo: match.awayLogo,
          league: match.league,
          market: "result",
          selection: c.key,
          selectionLabel: c.label,
          odds: c.odds,
        };

        return (
          <OddsCell
            key={c.key}
            tag={c.tag}
            odds={c.odds}
            isLive={match.status === "live"}
            suspended={locked}
            selected={isSelected}
            inCombo={inCombo}
            comboSelection={comboSel}
            onPick={() => {
              if (comboQuickMode) {
                const res = toggleComboLeg(comboSel);
                if (res === "full") {
                  toast({ kind: "error", title: "Betslip complet (8 sélections max)" });
                } else if (res === "source_conflict") {
                  toast({
                    kind: "error",
                    title: "Mélange interdit",
                    description: "Impossible de mélanger match réel et match virtuel.",
                  });
                }
                return;
              }
              openBet({
                match,
                selection: c.key,
                odds: c.odds,
                label: c.label,
                market: "result",
                marketLabel: "1x2",
              });
            }}
          />
        );
      })}
    </div>
  );
}

function OddsCell({
  tag,
  odds,
  isLive,
  suspended,
  selected,
  inCombo,
  comboSelection,
  onPick,
}: {
  tag: string;
  odds: number;
  isLive: boolean;
  suspended: boolean;
  selected?: boolean;
  inCombo?: boolean;
  comboSelection: ComboSelection;
  onPick: () => void;
}) {
  const { oddsFormat } = useApp();
  const trend = useOddsTrend(odds);
  const active = selected || inCombo;
  const { pressing, handlers, style } = useLongPressOdds({
    disabled: suspended,
    comboSelection,
    onTap: () => onPick(),
  });

  return (
    <button
      type="button"
      {...handlers}
      style={style}
      aria-disabled={suspended}
      className={cn(
        "relative flex h-11 items-center justify-between rounded-xl border px-3 transition-all active:scale-[0.98] lg:h-10.5",
        selected
          ? "border-betclic-red bg-betclic-red text-white shadow-xs"
          : inCombo
            ? "border-ink bg-ink text-white shadow-xs ring-2 ring-betclic-red/35"
            : "border-edge bg-elev/75 hover:border-ink/20 active:border-betclic-red/50 active:bg-betclic-red/8",
        pressing && !suspended && "scale-[0.96] ring-2 ring-betclic-red/50",
        suspended && "cursor-not-allowed opacity-50"
      )}
    >
      {!suspended && <OddsTrendCorner trend={trend} inverted={active} />}
      <span
        className={cn(
          "font-display text-[11px] font-bold",
          active ? "text-white/85" : "text-dim"
        )}
      >
        {tag}
      </span>
      {suspended ? (
        <Lock className="h-3.5 w-3.5 text-dim" strokeWidth={2.3} />
      ) : (
        <span
          className={cn(
            "font-display text-[14px] font-bold tabular-nums lg:text-[13.5px]",
            active ? "text-white" : isLive ? "text-betclic-red" : "text-ink"
          )}
        >
          {formatOdds(odds, oddsFormat)}
        </span>
      )}
    </button>
  );
}
