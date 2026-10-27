"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ChevronRight, Lock, Radio } from "lucide-react";
import type { ClientMatch } from "@/lib/api";
import { TeamAvatar } from "./team-avatar";
import { formatGoalSummary, LiveStatusBadge, ResultOdds } from "./match-card";
import { KickoffCountdown } from "./kickoff-countdown";
import { LiveMatchTracker } from "./live-match-tracker";
import { hasAnyRealStats, RealMatchStatsCard } from "./real-match-stats-card";
import { cn, formatKickoff } from "@/lib/format";

export function FeaturedMatch({ match }: { match: ClientMatch }) {
  const router = useRouter();
  const [showTracker, setShowTracker] = useState(true);
  const isLive = match.status === "live";
  const isReal = match.source === "manual";
  const realStatsAvailable = isReal && hasAnyRealStats(match.realStats);
  const marketCount = match.markets?.length ?? 0;
  const { homeGoals, awayGoals } = formatGoalSummary(
    match.events,
    match.homeScore,
    match.awayScore
  );
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;

  const hasLiveSidePanel =
    isLive && showTracker && (isReal ? realStatsAvailable : true);

  return (
    <section
      onClick={() => router.push(`/matchs/${match.id}`)}
      className="glass-card relative cursor-pointer overflow-hidden rounded-2xl border-edge p-4 transition-colors hover:border-ink/15 active:bg-elev/40 lg:p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-white",
              isReal ? "bg-emerald-600" : "bg-betclic-red"
            )}
          >
            {isReal ? "Match réel" : "Virtuel · Direct"}
          </span>
          <span className="truncate text-[11.5px] font-semibold text-mist">{match.league}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isLive && (isReal ? realStatsAvailable : true) && (
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
              {isReal ? (
                <>
                  <BarChart3 className="h-3 w-3" strokeWidth={2.4} />
                  Stats
                </>
              ) : (
                <>
                  <Radio className="h-3 w-3" strokeWidth={2.4} />
                  Terrain 2D
                </>
              )}
            </button>
          )}
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-elev px-2.5 py-0.5 font-display text-[11px] font-bold text-ink">
            {marketCount > 0 ? `${marketCount} marchés` : "Marchés"}
            <ChevronRight className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
          </span>
        </div>
      </div>

      <div
        className={cn(
          hasLiveSidePanel && "xl:mt-4 xl:grid xl:grid-cols-2 xl:items-center xl:gap-6"
        )}
      >
        <div>
          <div className="my-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 xl:my-3">
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
                    <LiveStatusBadge
                      match={match}
                      minute={match.minute}
                      suspended={match.suspended}
                    />
                  </div>
                </>
              ) : isReal && match.kickoffReached ? (
                <>
                  <span className="rounded-lg bg-elev px-2.5 py-1 font-display text-[12px] font-bold text-dim">
                    VS
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 font-display text-[10px] font-bold text-amber-700">
                    <Lock className="h-2.5 w-2.5" strokeWidth={2.4} />
                    Coup d&apos;envoi atteint
                  </span>
                </>
              ) : isReal ? (
                <>
                  <span className="rounded-lg bg-elev px-2.5 py-1 font-display text-[12px] font-bold text-dim">
                    VS
                  </span>
                  <span className="mt-2 rounded-full bg-elev px-2.5 py-0.5 font-display text-[11px] font-semibold text-ink">
                    {formatKickoff(match.startsAt)}
                  </span>
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
            <div className="mb-3 hidden grid-cols-2 gap-2 rounded-xl bg-elev/65 px-3 py-2 text-[10.5px] text-mist lg:grid">
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

          <div className="hidden xl:block">
            <ResultOdds match={match} />
          </div>
        </div>

        <div>
          {!isReal && isLive && showTracker && (
            <LiveMatchTracker match={match} className="mb-3 xl:mb-0" />
          )}
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
              className="mb-3 xl:mb-0"
            />
          )}

          <div className="xl:hidden">
            <ResultOdds match={match} />
          </div>
        </div>
      </div>
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
