"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, X } from "lucide-react";
import type { ClientMatch, MarketGroup, MarketOutcome } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { cn, formatKickoff, formatOdds } from "@/lib/format";

/** Feuille des marchés façon 1xbet : accordéon, un marché par ligne, options regroupées. */
export function MarketSheet() {
  const { marketMatch, closeMarkets, openBet, oddsFormat, target } = useApp();
  const dragControls = useDragControls();
  const [openKey, setOpenKey] = useState("result");
  const [prevMatchId, setPrevMatchId] = useState<number | null>(null);
  const match = marketMatch;

  // Nouveau match → l'accordéon se réinitialise sur "Résultat du match".
  if (match && match.id !== prevMatchId) {
    setPrevMatchId(match.id);
    setOpenKey("result");
  } else if (!match && prevMatchId !== null) {
    setPrevMatchId(null);
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
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-lime/70 to-transparent" />

            {/* En-tête match, collant — zone de drag pour mobile */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="shrink-0 cursor-grab border-b border-white/[0.07] px-4 pb-3 pt-1 active:cursor-grabbing"
            >
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-elev" />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-display text-[15px] font-bold tracking-tight">Marchés</p>
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
                  <span className="shrink-0 font-display text-[16px] font-bold tabular-nums text-lime">
                    {match.homeScore}–{match.awayScore}
                  </span>
                ) : (
                  <span className="shrink-0 text-right text-[10px] font-semibold leading-tight text-mist">
                    {formatKickoff(match.startsAt)}
                  </span>
                )}
              </div>
            </div>

            {/* Accordéon des marchés */}
            <div className="no-scrollbar flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-6 pt-2.5">
              {groups.map((g, i) => (
                <AccordionItem
                  key={g.key}
                  index={i + 1}
                  group={g}
                  isLive={isLive}
                  open={openKey === g.key}
                  onToggle={() => setOpenKey((k) => (k === g.key ? "none" : g.key))}
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

            <p className="shrink-0 border-t border-white/[0.06] px-4 py-2.5 text-center text-[9.5px] text-dim">
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
  index,
  isLive,
  open,
  onToggle,
  onPick,
}: {
  group: MarketGroup;
  index: number;
  isLive: boolean;
  open: boolean;
  onToggle: () => void;
  onPick: (o: MarketGroup["outcomes"][number]) => void;
}) {
  const twoCols = !group.rows && (group.outcomes.length === 2 || group.outcomes.length === 4);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border transition-colors duration-200",
        open ? "border-lime/25 bg-white/[0.04]" : "border-white/[0.07] bg-white/[0.02]"
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-white/[0.03]"
      >
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-lg font-display text-[10px] font-bold transition-colors",
            open ? "bg-lime text-ink" : "bg-white/[0.06] text-dim"
          )}
        >
          {index}
        </span>
        <span className="flex-1 font-display text-[13px] font-semibold leading-tight text-white">
          {group.label}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
          className={cn("shrink-0", open ? "text-lime" : "text-dim")}
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2.4} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {group.rows ? (
              <div className="space-y-2 border-t border-white/[0.06] px-2.5 py-2.5">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-right font-display text-[12px] font-bold tabular-nums text-mist">
                      {row.label}
                    </span>
                    <div className="grid flex-1 grid-cols-2 gap-1.5">
                      {row.outcomes.map((o) => (
                        <OutcomeCell key={o.key} o={o} isLive={isLive} onPick={() => onPick(o)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={cn(
                  "grid gap-1.5 border-t border-white/[0.06] px-2.5 py-2.5",
                  twoCols ? "grid-cols-2" : "grid-cols-3"
                )}
              >
                {group.outcomes.map((o) => (
                  <OutcomeCell key={o.key} o={o} isLive={isLive} onPick={() => onPick(o)} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OutcomeCell({
  o,
  isLive,
  onPick,
}: {
  o: MarketOutcome;
  isLive: boolean;
  onPick: () => void;
}) {
  const { oddsFormat } = useApp();

  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onPick}
      className="flex flex-col items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 transition-colors active:border-lime/60 active:bg-lime/[0.14]"
    >
      <span className="max-w-full truncate text-[9px] font-bold uppercase tracking-wider text-dim">
        {o.short}
      </span>
      <span
        className={cn(
          "font-display text-[14.5px] font-bold tabular-nums leading-none",
          isLive ? "text-lime" : "text-white"
        )}
      >
        {formatOdds(o.odds, oddsFormat)}
      </span>
    </motion.button>
  );
}
