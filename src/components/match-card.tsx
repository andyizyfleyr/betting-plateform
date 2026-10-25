"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Lock } from "lucide-react";
import type { ClientMatch } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { KickoffCountdown } from "./kickoff-countdown";
import { cn, formatOdds } from "@/lib/format";

export function MatchCard({ match }: { match: ClientMatch; index?: number }) {
  const { openMarkets } = useApp();
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const marketCount = match.markets?.length ?? 0;

  return (
    <article
      onClick={() => !isFinished && openMarkets(match)}
      className={cn(
        "glass-card relative overflow-hidden rounded-2xl p-3.5 transition-colors",
        !isFinished && "cursor-pointer active:bg-elev/50"
      )}
    >
      {isLive && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-betclic-red"
        />
      )}

      {/* En-tête : ligue + statut + nombre de marchés */}
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-1.5 text-mist">
          <SportIcon sport={match.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
          <span className="truncate font-medium">{match.league}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-betclic-red/10 px-2 py-0.5 font-display text-[10.5px] font-bold text-betclic-red">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
              {match.minute ?? "LIVE"}
            </span>
          ) : isFinished ? (
            <span className="text-[11px] font-medium text-dim">Terminé</span>
          ) : (
            <KickoffCountdown startsAt={match.startsAt} />
          )}

          {!isFinished && marketCount > 1 && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-elev px-1.5 py-0.5 font-display text-[10px] font-semibold text-mist">
              +{marketCount - 1}
              <ChevronRight className="h-3 w-3 text-dim" strokeWidth={2.2} />
            </span>
          )}
        </div>
      </div>

      {/* Équipes & scores */}
      <div className="mt-2.5 flex flex-col gap-1.5">
        <TeamRow
          name={match.homeTeam}
          logo={match.homeLogo}
          score={match.homeScore}
          winner={isFinished && (match.homeScore ?? 0) > (match.awayScore ?? 0)}
          isLive={isLive}
        />
        <TeamRow
          name={match.awayTeam}
          logo={match.awayLogo}
          score={match.awayScore}
          winner={isFinished && (match.awayScore ?? 0) > (match.homeScore ?? 0)}
          isLive={isLive}
        />
      </div>

      {/* Cotes 1 / N / 2 */}
      {!isFinished && (
        <div className="mt-3">
          <ResultOdds match={match} />
        </div>
      )}
    </article>
  );
}

function TeamRow({
  name,
  logo,
  score,
  winner,
  isLive,
}: {
  name: string;
  logo?: string | null;
  score: number | null;
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
      {score != null && (
        <span
          className={cn(
            "ml-auto font-display text-[15.5px] font-bold tabular-nums",
            isLive ? "text-betclic-red" : isFinished && !winner ? "text-mist" : "text-ink"
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
    if (odds === prev.current) return;
    setFlash(odds > prev.current ? "up" : "down");
    prev.current = odds;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setFlash(null), 900);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [odds]);

  return flash;
}

export function ResultOdds({ match }: { match: ClientMatch }) {
  const { openBet } = useApp();

  const cells: { key: string; tag: string; odds: number; label: string }[] = [
    { key: "home", tag: "1", odds: match.oddsHome, label: `Victoire ${match.homeTeam}` },
    ...(match.oddsDraw != null
      ? [{ key: "draw" as const, tag: "N", odds: match.oddsDraw, label: "Match nul" }]
      : []),
    { key: "away", tag: "2", odds: match.oddsAway, label: `Victoire ${match.awayTeam}` },
  ];

  return (
    <div className={cn("grid gap-1.5", cells.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {cells.map((c) => (
        <OddsCell
          key={c.key}
          tag={c.tag}
          odds={c.odds}
          isLive={match.status === "live"}
          suspended={match.suspended}
          onPick={(e) => {
            e.stopPropagation();
            openBet({
              match,
              selection: c.key,
              odds: c.odds,
              label: c.label,
              market: "result",
              marketLabel: "Résultat du match",
            });
          }}
        />
      ))}
    </div>
  );
}

function OddsCell({
  tag,
  odds,
  isLive,
  suspended,
  onPick,
}: {
  tag: string;
  odds: number;
  isLive: boolean;
  suspended: boolean;
  onPick: (e: React.MouseEvent) => void;
}) {
  const { oddsFormat } = useApp();
  const flash = useOddsFlash(odds);

  return (
    <button
      type="button"
      onClick={suspended ? (e) => e.stopPropagation() : onPick}
      aria-disabled={suspended}
      className={cn(
        "flex h-11 items-center justify-between rounded-xl border border-edge bg-elev/70 px-3 transition-colors active:scale-[0.98] active:border-betclic-red/50 active:bg-betclic-red/8",
        suspended && "cursor-not-allowed opacity-55",
        flash === "up" && "border-win/40 bg-win/8",
        flash === "down" && "border-betclic-red/40 bg-betclic-red/8"
      )}
    >
      <span className="font-display text-[11px] font-semibold text-dim">{tag}</span>
      {suspended ? (
        <Lock className="h-3.5 w-3.5 text-dim" strokeWidth={2.3} />
      ) : (
        <span className="flex items-center gap-0.5">
          <span
            className={cn(
              "font-display text-[13.5px] font-bold tabular-nums",
              isLive ? "text-betclic-red" : "text-ink"
            )}
          >
            {formatOdds(odds, oddsFormat)}
          </span>
          {flash === "up" && <ChevronUp className="h-3 w-3 text-win" strokeWidth={2.8} />}
          {flash === "down" && <ChevronDown className="h-3 w-3 text-betclic-red" strokeWidth={2.8} />}
        </span>
      )}
    </button>
  );
}
