"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, Lock, X } from "lucide-react";
import type { ClientMatch, MarketGroup, MarketOutcome } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { cn, formatKickoff, formatOdds } from "@/lib/format";

/** Feuille des marchés façon 1xbet : accordéon mobile avec market-box / market-head / odd-btn. */
export function MarketSheet() {
  const { marketMatch, closeMarkets, openBet, oddsFormat, target } = useApp();
  const dragControls = useDragControls();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [prevMatchId, setPrevMatchId] = useState<number | null>(null);
  const match = marketMatch;

  if (match && match.id !== prevMatchId) {
    setPrevMatchId(match.id);
    const groups = match.markets ?? [];
    setOpenKey(groups.length > 0 ? groups[0].key : "result");
  } else if (!match && prevMatchId !== null) {
    setPrevMatchId(null);
    setOpenKey(null);
  }

  useEffect(() => {
    document.body.style.overflow = match || target ? "hidden" : "";
    return () => {
      document.body.style.overflow = target ? "hidden" : "";
    };
  }, [match, target]);

  if (!match) return null;

  const groups = match.markets ?? [];
  const isLive = match.status === "live";
  const suspended = isLive && match.suspended;

  return (
    <AnimatePresence>
      {match && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={closeMarkets}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <motion.div
            initial={{ y: "102%" }}
            animate={{ y: 0 }}
            exit={{ y: "102%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 130 || info.velocity.y > 600) closeMarkets();
            }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[94dvh] w-full max-w-[27.5rem] flex-col overflow-hidden rounded-t-[24px] border-t border-white/10 bg-surface shadow-[0_-20px_80px_-20px_rgba(0,0,0,0.9)]"
          >
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-betclic-red/70 to-transparent" />

            {/* En-tête match, collant — zone de drag pour mobile */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="shrink-0 cursor-grab border-b border-white/[0.07] px-4 pb-3 pt-1 active:cursor-grabbing"
            >
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-elev" />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-display text-[16px] font-bold tracking-tight">Marchés</p>
                  <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-display text-[9.5px] font-bold text-mist">
                    {groups.length}
                  </span>
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={closeMarkets}
                  className="glass-pill grid h-8 w-8 place-items-center rounded-full text-mist active:scale-90"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </motion.button>
              </div>

              <div className="mt-2.5 flex items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <div className="flex shrink-0 -space-x-2">
                  <TeamAvatar name={match.homeTeam} size="sm" className="ring-2 ring-card" />
                  <TeamAvatar name={match.awayTeam} size="sm" className="ring-2 ring-card" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[12.5px] font-semibold leading-tight">
                    {match.homeTeam} <span className="text-dim">–</span> {match.awayTeam}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] font-medium text-mist">
                    <SportIcon sport={match.sport} className="h-3 w-3 shrink-0 text-dim" />
                    {match.league}
                  </p>
                </div>
                {isLive ? (
                  <span className="shrink-0 font-display text-[16px] font-bold tabular-nums text-betclic-yellow">
                    {match.homeScore ?? 0}–{match.awayScore ?? 0}
                  </span>
                ) : (
                  <span className="shrink-0 text-right text-[10px] font-semibold leading-tight text-mist">
                    {formatKickoff(match.startsAt)}
                  </span>
                )}
              </div>
            </div>

            {/* Accordéon des marchés – style market-box */}
            <div className="no-scrollbar flex flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-4 pt-2.5">
              {groups.map((g, i) => (
                <AccordionItem
                  key={g.key}
                  group={g}
                  isLive={isLive}
                  suspended={suspended}
                  open={openKey === g.key}
                  onToggle={() => setOpenKey((k) => (k === g.key ? null : g.key))}
                  onPick={(outcome) =>
                    openBet({
                      match,
                      selection: outcome.key,
                      odds: outcome.odds,
                      label: outcome.label,
                      market: g.key,
                      marketLabel: g.label,
                    })
                  }
                />
              ))}
            </div>

            <p className="shrink-0 border-t border-white/[0.06] px-4 py-2 text-center text-[9.5px] text-dim">
              Cotes fournies à titre indicatif · 18+ · Jouez de manière responsable.
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function AccordionItem({
  group,
  isLive,
  suspended,
  open,
  onToggle,
  onPick,
}: {
  group: MarketGroup;
  isLive: boolean;
  suspended: boolean;
  open: boolean;
  onToggle: () => void;
  onPick: (o: MarketGroup["outcomes"][number]) => void;
}) {
  const twoCols = !group.rows && (group.outcomes.length === 2 || group.outcomes.length === 4);

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-2.5 transition-colors duration-200",
        open && "border-betclic-red/20 bg-white/[0.04]",
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="relative mb-1.5 flex w-full items-center pr-[30px] text-left"
      >
        <span className="text-[11px] font-bold leading-tight tracking-tight text-white">
          {group.label}
        </span>
        <ChevronDown
          className={cn(
            "absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 transition-transform duration-300",
            open ? "text-betclic-red" : "-rotate-90 text-dim",
          )}
          strokeWidth={2.5}
        />
      </button>

      {group.rows ? (
        <div
          className={cn(
            "flex flex-col gap-[5px] overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out",
            open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
          )}
        >
          {group.rows.map((row) => (
            <div key={row.label} className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-right font-display text-[9.5px] font-bold tabular-nums text-mist">
                {row.label}
              </span>
              <div className="grid flex-1 grid-cols-2 gap-[5px]">
                {row.outcomes.map((o) => (
                  <OutcomeCell key={o.key} o={o} isLive={isLive} suspended={suspended} onPick={() => onPick(o)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-[5px] overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out",
            open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
            twoCols ? "grid-cols-2" : "grid-cols-3",
          )}
        >
          {group.outcomes.map((o) => (
            <OutcomeCell key={o.key} o={o} isLive={isLive} suspended={suspended} onPick={() => onPick(o)} />
          ))}
        </div>
      )}
    </div>
  );
}

function OutcomeCell({
  o,
  isLive,
  suspended,
  onPick,
}: {
  o: MarketOutcome;
  isLive: boolean;
  suspended: boolean;
  onPick: () => void;
}) {
  const { oddsFormat } = useApp();

  return (
    <motion.button
      whileTap={suspended ? undefined : { scale: 0.97 }}
      onClick={suspended ? undefined : onPick}
      aria-disabled={suspended}
      className={cn(
        "flex h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-1 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors active:border-betclic-red/60 active:bg-betclic-red/[0.14]",
        suspended && "cursor-not-allowed opacity-50"
      )}
    >
      <span className="max-w-full truncate text-[9.5px] font-semibold uppercase tracking-wider text-dim">
        {o.short}
      </span>
      {suspended ? (
        <Lock className="h-3.5 w-3.5 text-dim" strokeWidth={2.6} />
      ) : (
        <span
          className={cn(
            "font-display text-[13px] font-extrabold tabular-nums leading-none",
            isLive ? "text-betclic-yellow" : "text-white"
          )}
        >
          {formatOdds(o.odds, oddsFormat)}
        </span>
      )}
    </motion.button>
  );
}
