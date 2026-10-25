"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ChevronDown, ChevronRight, ChevronUp, Lock, Radio } from "lucide-react";
import type { ClientMatch, ClientMatchEvent } from "@/lib/api";
import { useLongPressOdds } from "@/lib/use-long-press-odds";
import type { ComboSelection } from "./combo-slip";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { KickoffCountdown } from "./kickoff-countdown";
import { LiveMatchTracker } from "./live-match-tracker";
import { hasAnyRealStats, RealMatchStatsCard } from "./real-match-stats-card";
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

export function formatGoalSummary(events?: ClientMatchEvent[]): {
  homeGoals: string[];
  awayGoals: string[];
} {
  const homeGoals: string[] = [];
  const awayGoals: string[] = [];
  if (!events || events.length === 0) return { homeGoals, awayGoals };

  for (const ev of events) {
    if (ev.type !== "goal") continue;
    const item = ev.player ? `${ev.minute}' ${ev.player}` : `${ev.minute}'`;
    if (ev.team === "home") homeGoals.push(item);
    else awayGoals.push(item);
  }
  return { homeGoals, awayGoals };
}

export function MatchCard({
  match,
  nextUp,
}: {
  match: ClientMatch;
  index?: number;
  nextUp?: boolean;
}) {
  const router = useRouter();
  const { openMarkets } = useApp();
  const [showTracker, setShowTracker] = useState(false);
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isReal = match.source === "manual";
  const realStatsAvailable = isReal && hasAnyRealStats(match.realStats);
  const marketCount = match.markets?.length ?? 0;
  const { homeGoals, awayGoals } = formatGoalSummary(match.events);
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;

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
        "glass-card relative cursor-pointer overflow-hidden rounded-2xl p-3.5 transition-colors active:bg-elev/45"
      )}
    >
      {isLive && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            isReal ? "bg-emerald-600" : "bg-betclic-red"
          )}
        />
      )}

      {/* En-tête : type de match + ligue + statut */}
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-1.5 text-mist">
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase tracking-wide",
              isReal
                ? "bg-emerald-600/12 text-emerald-700"
                : "bg-elev text-dim"
            )}
          >
            {isReal ? "Réel" : "Virtuel"}
          </span>
          <SportIcon sport={match.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
          <span className="truncate font-semibold">{match.league}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
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
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[10px] font-bold transition-colors",
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
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[10px] font-bold transition-colors",
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
            <span className="inline-flex items-center gap-0.5 rounded-md bg-elev px-2 py-0.5 font-display text-[10.5px] font-semibold text-dim">
              Terminé · Historique
              <ChevronRight className="h-3 w-3" strokeWidth={2.3} />
            </span>
          ) : isReal && match.kickoffReached ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-display text-[10px] font-bold text-amber-700">
              <Lock className="h-2.5 w-2.5" strokeWidth={2.4} />
              Coup d&apos;envoi atteint
            </span>
          ) : isReal ? (
            <span className="rounded-full bg-elev px-2.5 py-0.5 font-display text-[10.5px] font-semibold text-ink">
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
        </div>
      </div>

      {/* Équipes & scores */}
      <div className="mt-2.5 flex flex-col gap-1.5">
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

      {/* Résumé compact des buteurs lorsqu'il y a eu des buts */}
      {(isLive || isFinished) && hasGoals && (
        <div className="mt-2 flex flex-col gap-0.5 rounded-xl bg-elev/65 px-2.5 py-1.5 text-[10.5px] leading-snug text-mist">
          {homeGoals.length > 0 && (
            <p className="truncate">
              <span className="font-semibold text-ink">{match.homeTeam} :</span>{" "}
              {homeGoals.join(", ")}
            </p>
          )}
          {awayGoals.length > 0 && (
            <p className="truncate">
              <span className="font-semibold text-ink">{match.awayTeam} :</span>{" "}
              {awayGoals.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Tracker 2D virtuel ou statistiques officielles du match réel */}
      {!isReal && isLive && showTracker && <LiveMatchTracker match={match} className="mt-2.5" />}
      {isReal && isLive && showTracker && realStatsAvailable && (
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
      )}

      {/* Cotes 1x2 (V1 / X / V2) + accès aux marchés */}
      {!isFinished && (
        <div className="mt-3">
          <ResultOdds match={match} />
          {marketCount > 1 && (
            <div className="mt-2 flex items-center justify-between border-t border-edge/60 pt-2 text-[11px]">
              <span className="text-dim">Total, Double chance, Handicap, Score exact…</span>
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

function TeamRow({
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
      <TeamAvatar name={name} logo={logo} size="xs" />
      <span
        className={cn(
          "truncate font-display text-[14px] font-semibold",
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
            "ml-auto min-w-[22px] rounded-md px-1.5 py-0.5 text-center font-display text-[15px] font-bold tabular-nums",
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

function useOddsFlash(odds: number) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(odds);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const delta = odds - prev.current;
    prev.current = odds;
    if (Math.abs(delta) < 0.04) return;
    setFlash(delta > 0 ? "up" : "down");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setFlash(null), 850);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [odds]);

  return flash;
}

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
  const flash = useOddsFlash(odds);
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
        "flex h-11 items-center justify-between rounded-xl border px-3 transition-all active:scale-[0.98]",
        selected
          ? "border-betclic-red bg-betclic-red text-white shadow-xs"
          : inCombo
            ? "border-ink bg-ink text-white shadow-xs ring-2 ring-betclic-red/35"
            : "border-edge bg-elev/75 hover:border-ink/20 active:border-betclic-red/50 active:bg-betclic-red/8",
        pressing && !suspended && "scale-[0.96] ring-2 ring-betclic-red/50",
        suspended && "cursor-not-allowed opacity-50",
        !active && flash === "up" && "border-win/40 bg-win/8",
        !active && flash === "down" && "border-betclic-red/40 bg-betclic-red/8"
      )}
    >
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
        <span className="flex items-center gap-0.5">
          <span
            className={cn(
              "font-display text-[13.5px] font-bold tabular-nums",
              active ? "text-white" : isLive ? "text-betclic-red" : "text-ink"
            )}
          >
            {formatOdds(odds, oddsFormat)}
          </span>
          {!active && flash === "up" && (
            <ChevronUp className="h-3 w-3 text-win" strokeWidth={2.8} />
          )}
          {!active && flash === "down" && (
            <ChevronDown className="h-3 w-3 text-betclic-red" strokeWidth={2.8} />
          )}
        </span>
      )}
    </button>
  );
}
