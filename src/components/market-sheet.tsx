"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, Lock, X } from "lucide-react";
import { api, type ClientMatch, type MarketGroup, type MarketOutcome } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { KickoffCountdown } from "./kickoff-countdown";
import { cn, formatOdds } from "@/lib/format";

const POLL_INTERVAL = 5_000;

export function MarketSheet() {
  const { marketMatch, closeMarkets, openBet, oddsFormat, target } = useApp();
  const dragControls = useDragControls();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [prevMatchId, setPrevMatchId] = useState<number | null>(null);
  const [liveMatch, setLiveMatch] = useState<ClientMatch | null>(null);
  const match = liveMatch && marketMatch && liveMatch.id === marketMatch.id ? liveMatch : marketMatch;

  useEffect(() => {
    if (!marketMatch) return;
    let active = true;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await api.matches();
        if (!active) return;
        const fresh = r.matches.find((m) => m.id === marketMatch.id);
        if (fresh) setLiveMatch(fresh);
      } catch {
        /* silencieux */
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [marketMatch]);

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
            transition={{ duration: 0.2 }}
            onClick={closeMarkets}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 550) closeMarkets();
            }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-t border-edge bg-surface shadow-2xl"
          >
            {/* En-tête match */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="shrink-0 cursor-grab border-b border-edge px-4 pb-3 pt-2 active:cursor-grabbing"
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-edge" />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-[16px] font-bold tracking-tight text-ink">
                    Tous les marchés
                  </h2>
                  <span className="rounded-full bg-elev px-2 py-0.5 font-display text-[10.5px] font-bold text-mist">
                    {groups.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={closeMarkets}
                  className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist active:scale-95"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>

              <div className="mt-2.5 flex items-center gap-3 rounded-2xl bg-elev/70 px-3 py-2.5">
                <div className="flex shrink-0 -space-x-2">
                  <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="sm" className="ring-2 ring-white" />
                  <TeamAvatar name={match.awayTeam} logo={match.awayLogo} size="sm" className="ring-2 ring-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[13px] font-semibold text-ink">
                    {match.homeTeam} – {match.awayTeam}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-mist">
                    <SportIcon sport={match.sport} className="h-3 w-3 shrink-0 text-dim" />
                    {match.league}
                  </p>
                </div>
                {isLive ? (
                  <div className="shrink-0 text-right">
                    <p className="font-display text-[16px] font-bold tabular-nums text-betclic-red">
                      {match.homeScore ?? 0}–{match.awayScore ?? 0}
                    </p>
                    <p className="text-[10px] font-bold text-betclic-red">{match.minute ?? "LIVE"}</p>
                  </div>
                ) : (
                  <KickoffCountdown startsAt={match.startsAt} />
                )}
              </div>
            </div>

            {/* Liste des marchés */}
            <div className="no-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-5 pb-safe pt-3">
              {groups.map((g) => (
                <AccordionItem
                  key={g.key}
                  group={g}
                  isLive={isLive}
                  suspended={suspended}
                  open={openKey === g.key}
                  oddsFormat={oddsFormat}
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
  oddsFormat,
  onToggle,
  onPick,
}: {
  group: MarketGroup;
  isLive: boolean;
  suspended: boolean;
  open: boolean;
  oddsFormat: "decimal" | "fractional";
  onToggle: () => void;
  onPick: (o: MarketOutcome) => void;
}) {
  const twoCols = !group.rows && (group.outcomes.length === 2 || group.outcomes.length === 4);

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-elev/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-3 text-left"
      >
        <span className="font-display text-[12.5px] font-bold text-ink">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-dim transition-transform duration-200",
            open && "rotate-180 text-ink"
          )}
          strokeWidth={2.2}
        />
      </button>

      {open && (
        <div className="border-t border-edge/70 bg-white p-2.5">
          {group.rows ? (
            <div className="flex flex-col gap-1.5">
              {group.rows.map((row) => (
                <div key={row.label} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-right font-display text-[11px] font-bold tabular-nums text-mist">
                    {row.label}
                  </span>
                  <div className="grid flex-1 grid-cols-2 gap-1.5">
                    {row.outcomes.map((o) => (
                      <OutcomeCell
                        key={o.key}
                        o={o}
                        isLive={isLive}
                        suspended={suspended}
                        oddsFormat={oddsFormat}
                        onPick={() => onPick(o)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={cn("grid gap-1.5", twoCols ? "grid-cols-2" : "grid-cols-3")}>
              {group.outcomes.map((o) => (
                <OutcomeCell
                  key={o.key}
                  o={o}
                  isLive={isLive}
                  suspended={suspended}
                  oddsFormat={oddsFormat}
                  onPick={() => onPick(o)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OutcomeCell({
  o,
  isLive,
  suspended,
  oddsFormat,
  onPick,
}: {
  o: MarketOutcome;
  isLive: boolean;
  suspended: boolean;
  oddsFormat: "decimal" | "fractional";
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={suspended ? undefined : onPick}
      aria-disabled={suspended}
      className={cn(
        "flex h-11 items-center justify-between rounded-xl border border-edge bg-elev/70 px-2.5 transition-colors active:scale-[0.98] active:border-betclic-red/50 active:bg-betclic-red/8",
        suspended && "cursor-not-allowed opacity-50"
      )}
    >
      <span className="truncate pr-1 text-[11px] font-semibold text-mist">{o.short}</span>
      {suspended ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={2.3} />
      ) : (
        <span
          className={cn(
            "shrink-0 font-display text-[13px] font-bold tabular-nums",
            isLive ? "text-betclic-red" : "text-ink"
          )}
        >
          {formatOdds(o.odds, oddsFormat)}
        </span>
      )}
    </button>
  );
}
