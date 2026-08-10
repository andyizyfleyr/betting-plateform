"use client";

import { motion } from "framer-motion";
import { ChevronDown, LayoutGrid, Star } from "lucide-react";
import type { ClientMatch } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { ResultOdds } from "./match-card";
import { KickoffCountdown } from "./kickoff-countdown";
import { teamHue } from "@/lib/format";

/** Match à la une V5 — scoreboard immersif + cotes 1/N/2 ; un tap ouvre les marchés. */
export function FeaturedMatch({ match }: { match: ClientMatch }) {
  const { openMarkets } = useApp();
  const hueH = teamHue(match.homeTeam);
  const hueA = teamHue(match.awayTeam);
  const isLive = match.status === "live";

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => openMarkets(match)}
      className="glass-card relative mt-4 cursor-pointer overflow-hidden rounded-[20px] active:bg-elev"
    >
      {/* Halos aux couleurs des équipes */}
      <div
        aria-hidden
        className="breathe pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full"
        style={{
          background: `radial-gradient(closest-side, hsl(${hueH} 75% 50% / 0.26), transparent)`,
        }}
      />
      <div
        aria-hidden
        className="breathe pointer-events-none absolute -bottom-20 -right-16 h-56 w-56 rounded-full"
        style={{
          background: `radial-gradient(closest-side, hsl(${hueA} 75% 50% / 0.24), transparent)`,
          animationDelay: "-2.5s",
        }}
      />

      <div className="relative p-3.5 pb-0">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-betclic-red px-2 py-1 font-display text-[9px] font-black tracking-[0.18em] text-white">
            <Star className="h-3 w-3 fill-white" strokeWidth={0} />
            À LA UNE
          </span>
          <span className="text-[10.5px] font-medium text-mist">{match.league}</span>
        </div>

        <div className="mb-3.5 mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
          <TeamCol name={match.homeTeam} />
          <div className="flex flex-col items-center px-2">
            {isLive ? (
              <>
                <span className="glow-betclic font-display text-[32px] font-bold leading-none tabular-nums text-betclic-red">
                  {match.homeScore ?? 0}–{match.awayScore ?? 0}
                </span>
                <span className="mt-2 inline-flex items-center gap-1.5 font-display text-[10px] font-black tracking-wide text-betclic-red">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
                  LIVE {match.minute ?? ""}
                </span>
              </>
            ) : (
              <>
                <span className="ghost-num font-display text-[30px] font-bold leading-none">VS</span>
                <KickoffCountdown startsAt={match.startsAt} className="mt-2" />
              </>
            )}
          </div>
          <TeamCol name={match.awayTeam} />
        </div>
      </div>

      {/* Cotes 1/N/2 rapides + invite à ouvrir les marchés */}
      <div className="relative">
        <ResultOdds match={match} />
        <div className="flex items-center justify-center gap-1.5 border-t border-edge bg-elev py-1.5">
          <LayoutGrid className="h-3 w-3 text-betclic-red" strokeWidth={2.4} />
          <span className="font-display text-[9px] font-bold tracking-[0.18em] text-dim">
            TOUS LES MARCHÉS
          </span>
          <ChevronDown className="h-3 w-3 text-dim" strokeWidth={2.4} />
        </div>
      </div>
    </motion.section>
  );
}

function TeamCol({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <TeamAvatar name={name} size="lg" />
      <span className="font-display text-[12.5px] font-semibold leading-tight">{name}</span>
    </div>
  );
}
