"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, LayoutGrid, Lock } from "lucide-react";
import type { ClientMatch } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { cn, formatKickoff, formatOdds } from "@/lib/format";

/** Carte de match V5 — scoreboard + cotes 1/N/2 rapides ; un tap ouvre les marchés. */
export function MatchCard({ match, index = 0 }: { match: ClientMatch; index?: number }) {
  const { openMarkets } = useApp();
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.35), ease: [0.22, 1, 0.36, 1] }}
      onClick={() => !isFinished && openMarkets(match)}
      className="glass-card relative cursor-pointer overflow-hidden rounded-[18px] active:bg-elev"
    >
      {isLive && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-live via-live/60 to-transparent"
        />
      )}

      {/* En-tête */}
      <div className="relative flex items-center gap-1.5 px-3 pt-2">
        <SportIcon sport={match.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
        <span className="truncate text-[10.5px] font-medium text-mist">{match.league}</span>
        {isLive ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-display text-[10px] font-black tracking-wide text-live">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
            LIVE {match.minute}
          </span>
        ) : (
          <span className="ml-auto shrink-0 font-display text-[10px] font-semibold tracking-[0.08em] text-mist">
            {isFinished ? "TERMINÉ" : formatKickoff(match.startsAt).toUpperCase()}
          </span>
        )}
      </div>

      {/* Équipes */}
      <div className="relative flex flex-col gap-1.5 px-3 pb-2.5 pt-2">
        <TeamRow
          name={match.homeTeam}
          score={match.homeScore}
          winner={isFinished && (match.homeScore ?? 0) > (match.awayScore ?? 0)}
          isLive={isLive}
        />
        <TeamRow
          name={match.awayTeam}
          score={match.awayScore}
          winner={isFinished && (match.awayScore ?? 0) > (match.homeScore ?? 0)}
          isLive={isLive}
        />
      </div>

      {/* Cotes 1/N/2 rapides */}
      {!isFinished && <ResultOdds match={match} />}

      {/* Invite à ouvrir les marchés */}
      {!isFinished && (
        <div className="flex items-center justify-center gap-1.5 border-t border-white/[0.06] bg-white/[0.02] py-1.5">
          <LayoutGrid className="h-3 w-3 text-lime" strokeWidth={2.4} />
          <span className="font-display text-[9px] font-bold tracking-[0.18em] text-dim">
            TOUS LES MARCHÉS
          </span>
          <ChevronDown className="h-3 w-3 text-dim" strokeWidth={2.4} />
        </div>
      )}
    </motion.article>
  );
}

function TeamRow({
  name,
  score,
  winner,
  isLive,
}: {
  name: string;
  score: number | null;
  winner: boolean;
  isLive: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <TeamAvatar name={name} size="xs" />
      <span
        className={cn(
          "font-display text-[14px] font-semibold tracking-tight",
          winner ? "text-white" : score != null && !winner ? "text-mist" : "text-white"
        )}
      >
        {name}
      </span>
      {score != null && (
        <motion.span
          key={score}
          initial={{ scale: 1.6, opacity: 0.25 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 17 }}
          className={cn(
            "ml-auto font-display text-[16px] font-bold tabular-nums",
            isLive ? "glow-lime text-lime" : winner ? "text-white" : "text-mist"
          )}
        >
          {score}
        </motion.span>
      )}
    </div>
  );
}

/** Flèche de tendance quand la cote évolue en direct. */
function useOddsFlash(odds: number) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(odds);

  useEffect(() => {
    if (odds === prev.current) return;
    setFlash(odds > prev.current ? "up" : "down");
    prev.current = odds;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [odds]);

  return flash;
}

/** Rangée de cotes 1 / N / 2 (marché résultat) en pied de carte. */
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
    <div
      className={cn(
        "relative grid border-t border-white/[0.06] bg-white/[0.02]",
        cells.length === 3 ? "grid-cols-3" : "grid-cols-2"
      )}
    >
      {cells.map((c, i) => (
        <OddsCell
          key={c.key}
          tag={c.tag}
          odds={c.odds}
          isLive={match.status === "live"}
          suspended={match.suspended}
          borderLeft={i > 0}
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
  borderLeft,
  onPick,
}: {
  tag: string;
  odds: number;
  isLive: boolean;
  suspended: boolean;
  borderLeft: boolean;
  onPick: (e: React.MouseEvent) => void;
}) {
  const { oddsFormat } = useApp();
  const flash = useOddsFlash(odds);

  return (
    <motion.button
      whileTap={suspended ? undefined : { scale: 0.96 }}
      onClick={suspended ? (e) => e.stopPropagation() : onPick}
      aria-disabled={suspended}
      className={cn(
        "relative flex h-11 flex-col items-center justify-center transition-colors duration-500",
        borderLeft && "border-l border-white/[0.06]",
        suspended && "cursor-not-allowed",
        flash === "up" && "bg-lime/[0.13]",
        flash === "down" && "bg-live/[0.13]"
      )}
    >
      <span className="text-[8.5px] font-semibold tracking-[0.2em] text-dim">{tag}</span>
      {suspended ? (
        <Lock className="h-3 w-3 text-dim" strokeWidth={2.6} />
      ) : (
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "font-display text-[14px] font-bold tabular-nums",
              isLive ? "text-lime" : "text-white"
            )}
          >
            {formatOdds(odds, oddsFormat)}
          </span>
          {flash === "up" && <ChevronUp className="h-3 w-3 text-lime" strokeWidth={3} />}
          {flash === "down" && <ChevronDown className="h-3 w-3 text-live" strokeWidth={3} />}
        </span>
      )}
    </motion.button>
  );
}
