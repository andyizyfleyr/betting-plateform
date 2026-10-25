"use client";

import { useState } from "react";
import { ChevronRight, Radio } from "lucide-react";
import type { ClientMatch } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { formatGoalSummary, LiveStatusBadge, ResultOdds } from "./match-card";
import { KickoffCountdown } from "./kickoff-countdown";
import { LiveMatchTracker } from "./live-match-tracker";
import { cn } from "@/lib/format";

export function FeaturedMatch({ match }: { match: ClientMatch }) {
  const { openMarkets } = useApp();
  const [showTracker, setShowTracker] = useState(true);
  const isLive = match.status === "live";
  const marketCount = match.markets?.length ?? 0;
  const { homeGoals, awayGoals } = formatGoalSummary(match.events);
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;

  return (
    <section
      onClick={() => openMarkets(match)}
      className="glass-card relative cursor-pointer overflow-hidden rounded-2xl border-edge p-4 transition-colors active:bg-elev/40"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-betclic-red px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-white">
            À la une
          </span>
          <span className="truncate text-[11.5px] font-semibold text-mist">{match.league}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isLive && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowTracker((s) => !s);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-display text-[10.5px] font-bold transition-colors",
                showTracker
                  ? "bg-emerald-700 text-white"
                  : "bg-elev text-mist"
              )}
            >
              <Radio className="h-3 w-3" strokeWidth={2.4} />
              Terrain 2D
            </button>
          )}
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-elev px-2.5 py-0.5 font-display text-[11px] font-bold text-ink">
            {marketCount > 0 ? `${marketCount} marchés` : "Marchés"}
            <ChevronRight className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
          </span>
        </div>
      </div>

      <div className="my-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamCol
          name={match.homeTeam}
          logo={match.homeLogo}
          redCards={match.redHome ?? 0}
        />

        <div className="flex flex-col items-center px-2">
          {isLive ? (
            <>
              <div className="flex items-center gap-1.5 rounded-2xl bg-elev/80 px-3.5 py-1.5">
                <span className="font-display text-[26px] font-bold leading-none tabular-nums text-ink">
                  {match.homeScore ?? 0}
                </span>
                <span className="font-display text-[18px] font-bold text-dim">:</span>
                <span className="font-display text-[26px] font-bold leading-none tabular-nums text-ink">
                  {match.awayScore ?? 0}
                </span>
              </div>
              <div className="mt-2">
                <LiveStatusBadge minute={match.minute} suspended={match.suspended} />
              </div>
            </>
          ) : (
            <>
              <span className="rounded-lg bg-elev px-2.5 py-1 font-display text-[12px] font-bold text-dim">
                VS
              </span>
              <KickoffCountdown startsAt={match.startsAt} className="mt-2" />
            </>
          )}
        </div>

        <TeamCol
          name={match.awayTeam}
          logo={match.awayLogo}
          redCards={match.redAway ?? 0}
        />
      </div>

      {isLive && hasGoals && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-elev/65 px-3 py-2 text-[10.5px] text-mist">
          <div className="min-w-0">
            {homeGoals.map((g, i) => (
              <p key={i} className="truncate font-medium text-ink">
                ⚽ {g}
              </p>
            ))}
          </div>
          <div className="min-w-0 text-right">
            {awayGoals.map((g, i) => (
              <p key={i} className="truncate font-medium text-ink">
                {g} ⚽
              </p>
            ))}
          </div>
        </div>
      )}

      {isLive && showTracker && <LiveMatchTracker match={match} className="mb-3" />}

      <ResultOdds match={match} />
    </section>
  );
}

function TeamCol({
  name,
  logo,
  redCards,
}: {
  name: string;
  logo?: string | null;
  redCards: number;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <TeamAvatar name={name} logo={logo} size="md" />
      <div className="flex max-w-full items-center justify-center gap-1">
        <span className="line-clamp-2 font-display text-[12.5px] font-bold leading-tight text-ink">
          {name}
        </span>
        {redCards > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5">
            {Array.from({ length: redCards }).map((_, i) => (
              <span
                key={i}
                className="inline-block h-3 w-2 rounded-[2px] bg-betclic-red"
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
