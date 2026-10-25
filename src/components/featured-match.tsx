"use client";

import { ChevronRight } from "lucide-react";
import type { ClientMatch } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { ResultOdds } from "./match-card";
import { KickoffCountdown } from "./kickoff-countdown";

export function FeaturedMatch({ match }: { match: ClientMatch }) {
  const { openMarkets } = useApp();
  const isLive = match.status === "live";
  const marketCount = match.markets?.length ?? 0;

  return (
    <section
      onClick={() => openMarkets(match)}
      className="glass-card cursor-pointer overflow-hidden rounded-2xl p-4 transition-colors active:bg-elev/40"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-betclic-red px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-white">
            À la une
          </span>
          <span className="truncate text-[11.5px] font-medium text-mist">{match.league}</span>
        </div>

        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-mist">
          {marketCount > 0 ? `${marketCount} marchés` : "Marchés"}
          <ChevronRight className="h-3.5 w-3.5 text-dim" strokeWidth={2.2} />
        </span>
      </div>

      <div className="my-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamCol name={match.homeTeam} logo={match.homeLogo} />

        <div className="flex flex-col items-center px-2">
          {isLive ? (
            <>
              <span className="font-display text-[28px] font-bold leading-none tabular-nums text-ink">
                {match.homeScore ?? 0}
                <span className="mx-1 text-dim">–</span>
                {match.awayScore ?? 0}
              </span>
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-betclic-red/10 px-2.5 py-0.5 font-display text-[10.5px] font-bold text-betclic-red">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                {match.minute ?? "LIVE"}
              </span>
            </>
          ) : (
            <>
              <span className="font-display text-[14px] font-bold text-dim">VS</span>
              <KickoffCountdown startsAt={match.startsAt} className="mt-1" />
            </>
          )}
        </div>

        <TeamCol name={match.awayTeam} logo={match.awayLogo} />
      </div>

      <ResultOdds match={match} />
    </section>
  );
}

function TeamCol({ name, logo }: { name: string; logo?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <TeamAvatar name={name} logo={logo} size="md" />
      <span className="line-clamp-2 font-display text-[12.5px] font-semibold leading-tight text-ink">
        {name}
      </span>
    </div>
  );
}
