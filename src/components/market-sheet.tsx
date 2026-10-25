"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, Lock, X } from "lucide-react";
import { api, type ClientMatch, type MarketGroup, type MarketOutcome } from "@/lib/api";
import { useApp } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { KickoffCountdown } from "./kickoff-countdown";
import { formatGoalSummary, LiveStatusBadge } from "./match-card";
import { cn, formatOdds } from "@/lib/format";

const POLL_INTERVAL = 4_000;

type SheetCategory = "all" | "main" | "goals" | "teams" | "scores";

const CATEGORY_TABS: Array<{ key: SheetCategory; label: string }> = [
  { key: "all", label: "Tous" },
  { key: "main", label: "Principaux" },
  { key: "goals", label: "Buts" },
  { key: "teams", label: "Équipes" },
  { key: "scores", label: "Scores" },
];

function inferCategory(g: MarketGroup): Exclude<SheetCategory, "all"> {
  if (g.category) return g.category;
  if (["result", "double_chance", "total_ou", "btts", "result_total"].includes(g.key)) {
    return "main";
  }
  if (g.key === "score_exact") return "scores";
  if (["total_exact", "odd_even"].includes(g.key)) return "goals";
  return "teams";
}

export function MarketSheet() {
  const { marketMatch, closeMarkets, openBet, oddsFormat, target } = useApp();
  const dragControls = useDragControls();
  const [category, setCategory] = useState<SheetCategory>("all");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [prevMatchId, setPrevMatchId] = useState<number | null>(null);
  const [liveMatch, setLiveMatch] = useState<ClientMatch | null>(null);

  const match =
    liveMatch && marketMatch && liveMatch.id === marketMatch.id ? liveMatch : marketMatch;

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
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [marketMatch]);

  if (match && match.id !== prevMatchId) {
    setPrevMatchId(match.id);
    setCategory("all");
    const initialOpen: Record<string, boolean> = {};
    for (const g of (match.markets ?? []).slice(0, 4)) {
      initialOpen[g.key] = true;
    }
    setOpenMap(initialOpen);
  } else if (!match && prevMatchId !== null) {
    setPrevMatchId(null);
    setOpenMap({});
  }

  useEffect(() => {
    document.body.style.overflow = match || target ? "hidden" : "";
    return () => {
      document.body.style.overflow = target ? "hidden" : "";
    };
  }, [match, target]);

  const groups = useMemo(() => match?.markets ?? [], [match]);

  const filteredGroups = useMemo(() => {
    if (category === "all") return groups;
    return groups.filter((g) => inferCategory(g) === category);
  }, [groups, category]);

  if (!match) return null;

  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const suspended = isLive && match.suspended;
  const { homeGoals, awayGoals } = formatGoalSummary(match.events);
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;

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
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
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
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-t border-edge bg-surface shadow-2xl"
          >
            {/* En-tête du match */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="shrink-0 cursor-grab border-b border-edge bg-surface px-4 pb-3 pt-2 active:cursor-grabbing"
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-edge" />

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-mist">
                  <SportIcon sport={match.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
                  <span className="truncate font-semibold">{match.league}</span>
                </div>
                <button
                  type="button"
                  onClick={closeMarkets}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elev text-mist active:scale-95"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>

              {/* Tableau d'affichage compact */}
              <div className="mt-2 rounded-2xl border border-edge/80 bg-elev/55 p-3">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-display text-[13px] font-bold text-ink">
                        {match.homeTeam}
                      </p>
                      {(match.redHome ?? 0) > 0 && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-betclic-red">
                          <span className="inline-block h-2.5 w-1.5 rounded-[1.5px] bg-betclic-red" />
                          {match.redHome} rouge
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-center px-1.5">
                    {isLive || isFinished ? (
                      <>
                        <span className="font-display text-[20px] font-bold leading-none tabular-nums text-ink">
                          {match.homeScore ?? 0} – {match.awayScore ?? 0}
                        </span>
                        <div className="mt-1">
                          {isFinished ? (
                            <span className="text-[10px] font-bold text-dim">Terminé</span>
                          ) : (
                            <LiveStatusBadge minute={match.minute} suspended={suspended} />
                          )}
                        </div>
                      </>
                    ) : (
                      <KickoffCountdown startsAt={match.startsAt} />
                    )}
                  </div>

                  <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                    <div className="min-w-0">
                      <p className="truncate font-display text-[13px] font-bold text-ink">
                        {match.awayTeam}
                      </p>
                      {(match.redAway ?? 0) > 0 && (
                        <span className="mt-0.5 inline-flex items-center justify-end gap-1 text-[10px] font-semibold text-betclic-red">
                          {match.redAway} rouge
                          <span className="inline-block h-2.5 w-1.5 rounded-[1.5px] bg-betclic-red" />
                        </span>
                      )}
                    </div>
                    <TeamAvatar name={match.awayTeam} logo={match.awayLogo} size="sm" />
                  </div>
                </div>

                {hasGoals && (
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-edge/60 pt-1.5 text-[10.5px] text-mist">
                    <div className="min-w-0 truncate">
                      {homeGoals.length > 0 ? `⚽ ${homeGoals.join(", ")}` : ""}
                    </div>
                    <div className="min-w-0 truncate text-right">
                      {awayGoals.length > 0 ? `${awayGoals.join(", ")} ⚽` : ""}
                    </div>
                  </div>
                )}
              </div>

              {suspended && (
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-500/12 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
                  <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
                  <span>Action en cours — réouverture automatique des cotes dans un instant…</span>
                </div>
              )}

              {/* Onglets de catégories */}
              {groups.length > 0 && (
                <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto">
                  {CATEGORY_TABS.map((tab) => {
                    const count =
                      tab.key === "all"
                        ? groups.length
                        : groups.filter((g) => inferCategory(g) === tab.key).length;
                    if (tab.key !== "all" && count === 0) return null;
                    const active = category === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setCategory(tab.key)}
                        className={cn(
                          "h-7.5 shrink-0 rounded-full border px-3 font-display text-[11.5px] transition-colors",
                          active
                            ? "border-ink bg-ink font-bold text-white"
                            : "border-edge bg-white font-medium text-mist active:bg-elev"
                        )}
                      >
                        {tab.label} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Liste des marchés */}
            <div className="no-scrollbar flex flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pb-6 pb-safe pt-3">
              {isFinished || filteredGroups.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-mist">
                  {isFinished
                    ? "Cette rencontre est terminée — les marchés sont clôturés."
                    : "Aucun marché ouvert dans cette catégorie pour le moment."}
                </div>
              ) : (
                filteredGroups.map((g) => {
                  const isOpen = category !== "all" ? (openMap[g.key] ?? true) : Boolean(openMap[g.key]);
                  return (
                    <AccordionItem
                      key={g.key}
                      matchId={match.id}
                      group={g}
                      isLive={isLive}
                      suspended={suspended}
                      open={isOpen}
                      oddsFormat={oddsFormat}
                      selectedKey={
                        target && target.match.id === match.id && target.market === g.key
                          ? target.selection
                          : null
                      }
                      onToggle={() =>
                        setOpenMap((prev) => ({
                          ...prev,
                          [g.key]: !(category !== "all" ? (prev[g.key] ?? true) : Boolean(prev[g.key])),
                        }))
                      }
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
                  );
                })
              )}
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
  selectedKey,
  onToggle,
  onPick,
}: {
  matchId: number;
  group: MarketGroup;
  isLive: boolean;
  suspended: boolean;
  open: boolean;
  oddsFormat: "decimal" | "fractional";
  selectedKey: string | null;
  onToggle: () => void;
  onPick: (o: MarketOutcome) => void;
}) {
  const isScoreExact = group.key === "score_exact";
  const twoCols =
    !group.rows &&
    !isScoreExact &&
    (group.outcomes.length === 2 || group.outcomes.length === 4);

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between bg-elev/45 px-3.5 py-2.5 text-left"
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
        <div className="border-t border-edge/70 p-2.5">
          {group.rows ? (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[44px_1fr_1fr] items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-dim">
                <span className="text-center">Seuil</span>
                <span className="text-center">Plus de</span>
                <span className="text-center">Moins de</span>
              </div>
              {group.rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[44px_1fr_1fr] items-center gap-1.5">
                  <span className="flex h-10 items-center justify-center rounded-lg bg-elev font-display text-[11.5px] font-bold tabular-nums text-ink">
                    {row.label}
                  </span>
                  {row.outcomes.map((o) => (
                    <OutcomeCell
                      key={o.key}
                      o={o}
                      isLive={isLive}
                      suspended={suspended}
                      selected={selectedKey === o.key}
                      oddsFormat={oddsFormat}
                      onPick={() => onPick(o)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : isScoreExact ? (
            <div className="grid grid-cols-3 gap-1.5">
              {group.outcomes.map((o) => (
                <OutcomeCell
                  key={o.key}
                  o={o}
                  isLive={isLive}
                  suspended={suspended}
                  selected={selectedKey === o.key}
                  oddsFormat={oddsFormat}
                  className={o.key === "other" ? "col-span-3" : undefined}
                  onPick={() => onPick(o)}
                />
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
                  selected={selectedKey === o.key}
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
  selected,
  oddsFormat,
  className,
  onPick,
}: {
  o: MarketOutcome;
  isLive: boolean;
  suspended: boolean;
  selected?: boolean;
  oddsFormat: "decimal" | "fractional";
  className?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={suspended ? undefined : onPick}
      aria-disabled={suspended}
      className={cn(
        "flex h-10.5 items-center justify-between gap-1.5 rounded-xl border px-2.5 transition-all active:scale-[0.98]",
        selected
          ? "border-betclic-red bg-betclic-red text-white shadow-xs"
          : "border-edge bg-elev/70 active:border-betclic-red/50 active:bg-betclic-red/8",
        suspended && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "truncate text-[11.5px] font-semibold",
          selected ? "text-white/90" : "text-mist"
        )}
      >
        {o.short}
      </span>
      {suspended ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={2.3} />
      ) : (
        <span
          className={cn(
            "shrink-0 font-display text-[13px] font-bold tabular-nums",
            selected ? "text-white" : isLive ? "text-betclic-red" : "text-ink"
          )}
        >
          {formatOdds(o.odds, oddsFormat)}
        </span>
      )}
    </button>
  );
}
