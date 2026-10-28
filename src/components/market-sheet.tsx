"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { BarChart3, ChevronDown, Lock, Radio, X } from "lucide-react";
import type { ClientMatch, MarketGroup, MarketOutcome } from "@/lib/api";
import { useMatchDetailQuery } from "@/lib/party-realtime";
import { useLongPressOdds } from "@/lib/use-long-press-odds";
import type { ComboSelection } from "./combo-slip";
import {
  OddsTrendCorner,
  oddsTrendTextClass,
  useOddsTrend,
} from "./odds-trend-corner";
import { useApp, useFeedMatches } from "./providers";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { LiveMatchTracker } from "./live-match-tracker";
import { hasAnyRealStats, RealMatchStatsCard } from "./real-match-stats-card";
import { formatGoalSummary, LiveStatusBadge } from "./match-card";
import { cn, formatOdds } from "@/lib/format";

export type SheetCategory = "all" | "main" | "halftime" | "goals" | "teams" | "scores";

export const CATEGORY_TABS: Array<{ key: SheetCategory; label: string }> = [
  { key: "all", label: "Tous" },
  { key: "main", label: "Principaux" },
  { key: "halftime", label: "1ère mi-temps" },
  { key: "goals", label: "Buts" },
  { key: "teams", label: "Équipes" },
  { key: "scores", label: "Scores" },
];

const TWO_COL_MARKETS = new Set([
  "dnb",
  "btts",
  "odd_even",
  "result_total",
  "result_btts",
  "goal_range",
  "winning_margin",
  "home_to_nil",
  "away_to_nil",
  "home_clean_sheet",
  "away_clean_sheet",
]);

export function formatMatchDateTime(iso: string | Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(date);
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${day} · ${time}`;
}

export function inferCategory(g: MarketGroup): Exclude<SheetCategory, "all"> {
  if (g.category) return g.category;
  if (
    [
      "result",
      "dnb",
      "double_chance",
      "handicap_euro",
      "total_ou",
      "btts",
      "result_total",
      "result_btts",
    ].includes(g.key)
  ) {
    return "main";
  }
  if (["ht_result", "ht_total_ou", "highest_scoring_half"].includes(g.key)) {
    return "halftime";
  }
  if (["score_exact", "winning_margin", "ht_ft"].includes(g.key)) return "scores";
  if (["total_exact", "odd_even", "goal_range"].includes(g.key)) return "goals";
  return "teams";
}

export function sanitizeMatchMarkets(raw: MarketGroup[] | undefined): MarketGroup[] {
  if (!raw) return [];
  return raw
    .map((g) =>
      g.key === "score_exact"
        ? { ...g, outcomes: g.outcomes.filter((o) => o.key !== "other") }
        : g
    )
    .filter((g) => (g.rows ? g.rows.length > 0 : g.outcomes.length > 0));
}

export function MarketSheet() {
  const {
    marketMatch,
    closeMarkets,
    openBet,
    oddsFormat,
    target,
    comboLegs,
    comboQuickMode,
    toggleComboLeg,
    toast,
  } = useApp();
  const feedMatches = useFeedMatches();
  const dragControls = useDragControls();
  const [category, setCategory] = useState<SheetCategory>("all");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [prevMatchId, setPrevMatchId] = useState<number | null>(null);
  const [showTracker, setShowTracker] = useState(false);

  const sharedFromFeed = useMemo(
    () =>
      marketMatch && feedMatches
        ? feedMatches.find((m) => m.id === marketMatch.id) ?? null
        : null,
    [marketMatch, feedMatches]
  );

  const detailQuery = useMatchDetailQuery(marketMatch?.id ?? 0, {
    enabled: Boolean(marketMatch),
    initialMatch:
      marketMatch &&
      (marketMatch.status === "finished" ||
        (marketMatch.markets?.length ?? 0) > 1)
        ? marketMatch
        : null,
    isFinished:
      marketMatch?.status === "finished" ||
      sharedFromFeed?.status === "finished",
  });

  const match = useMemo(() => {
    if (!marketMatch) return null;
    const fetched = detailQuery.data?.match;
    if (fetched && fetched.id === marketMatch.id) return fetched;
    return sharedFromFeed ?? marketMatch;
  }, [detailQuery.data?.match, marketMatch, sharedFromFeed]);

  const hasAnyOpen = Object.keys(openMap).length > 0;
  if (match && match.id !== prevMatchId) {
    setPrevMatchId(match.id);
    setCategory("all");
    setShowTracker(
      typeof window !== "undefined" && window.innerWidth >= 1024
    );
    const groups = match.markets ?? [];
    const initialOpen: Record<string, boolean> = {};
    // Ouvre par défaut Résultat + Total de buts (ou les 2 premiers marchés disponibles)
    for (const key of ["result", "total_ou"]) {
      if (groups.some((g) => g.key === key)) initialOpen[key] = true;
    }
    if (Object.keys(initialOpen).length === 0) {
      for (const g of groups.slice(0, 2)) initialOpen[g.key] = true;
    }
    setOpenMap(initialOpen);
  } else if (match && !hasAnyOpen && (match.markets?.length ?? 0) > 1) {
    const groups = match.markets ?? [];
    const initialOpen: Record<string, boolean> = {};
    for (const key of ["result", "total_ou"]) {
      if (groups.some((g) => g.key === key)) initialOpen[key] = true;
    }
    if (Object.keys(initialOpen).length === 0) {
      for (const g of groups.slice(0, 2)) initialOpen[g.key] = true;
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

  const groups = useMemo(() => sanitizeMatchMarkets(match?.markets), [match]);

  const filteredGroups = useMemo(() => {
    if (category === "all") return groups;
    return groups.filter((g) => inferCategory(g) === category);
  }, [groups, category]);

  if (!match) return null;

  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isReal = match.source === "manual";
  const realStatsAvailable = isReal && hasAnyRealStats(match.realStats);
  const suspended = Boolean(match.suspended);
  const { homeGoals, awayGoals } = formatGoalSummary(
    match.events,
    match.homeScore,
    match.awayScore
  );
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
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-[85dvh] lg:max-h-[820px] lg:max-w-[780px] lg:rounded-3xl lg:border"
          >
            {/* En-tête fixe de la feuille */}
            <div className="shrink-0 rounded-t-3xl border-b border-edge bg-surface px-4 pb-2.5 pt-2 lg:px-6 lg:pt-3.5">
              {/* Zone de glissement vertical uniquement sur la barre supérieure */}
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="touch-none cursor-grab pb-1 active:cursor-grabbing lg:cursor-default"
              >
                <div className="mx-auto h-1 w-10 rounded-full bg-edge lg:hidden" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-mist">
                    {isReal && (
                      <span className="hidden shrink-0 rounded-md bg-emerald-600/12 px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase tracking-wide text-emerald-700 lg:inline-block">
                        Match réel
                      </span>
                    )}
                    <SportIcon sport={match.sport} className="h-3.5 w-3.5 shrink-0 text-dim" />
                    <span className="truncate font-semibold">{match.league}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="inline-flex h-7 items-center rounded-full bg-elev px-2.5 font-display text-[10.5px] font-semibold tabular-nums text-ink">
                      {formatMatchDateTime(match.startsAt)}
                    </span>
                    {(isLive || isFinished) && (isReal ? realStatsAvailable : true) && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setShowTracker((s) => !s)}
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-display text-[10.5px] font-bold transition-colors",
                          showTracker ? "bg-emerald-700 text-white" : "bg-elev text-mist"
                        )}
                      >
                        {isReal ? (
                          <>
                            <BarChart3 className="h-3 w-3" strokeWidth={2.4} />
                            {isLive ? "Stats live" : "Stats"}
                          </>
                        ) : (
                          <>
                            <Radio className="h-3 w-3" strokeWidth={2.4} />
                            {isLive ? "Terrain 2D" : "Stats"}
                          </>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={closeMarkets}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elev text-mist active:scale-95"
                      aria-label="Fermer"
                    >
                      <X className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Tableau de score avec affichage complet des noms de clubs */}
              <div className="mt-1.5 rounded-2xl border border-edge/80 bg-elev/55 px-3 py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="sm" />
                    <div className="min-w-0">
                      <p className="font-display text-[13px] font-bold leading-tight break-words text-ink lg:text-[14px]">
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

                  <div className="flex flex-col items-center px-1">
                    {isLive || isFinished ? (
                      <>
                        <span className="font-display text-[19px] font-bold leading-none tabular-nums text-ink">
                          {match.homeScore ?? 0} – {match.awayScore ?? 0}
                        </span>
                        {isReal &&
                          match.htHomeScore != null &&
                          match.htAwayScore != null && (
                            <span className="mt-0.5 text-[9.5px] font-semibold tabular-nums text-dim">
                              MT {match.htHomeScore} - {match.htAwayScore}
                            </span>
                          )}
                        <div className="mt-1">
                          {isFinished ? (
                            <span className="text-[10px] font-bold text-dim">Terminé</span>
                          ) : (
                            <LiveStatusBadge
                              match={match}
                              minute={match.minute}
                              suspended={suspended}
                            />
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="font-display text-[11px] font-bold uppercase tracking-wide text-dim">
                        vs
                      </span>
                    )}
                  </div>

                  <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                    <div className="min-w-0">
                      <p className="font-display text-[13px] font-bold leading-tight break-words text-ink lg:text-[14px]">
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
                  <span>
                    {isReal && !isLive && match.kickoffReached
                      ? "Coup d'envoi officiel atteint — paris pré-match clôturés en attente du direct."
                      : isReal && isLive
                        ? "Action décisive ou actualisation en direct — cotes momentanément suspendues."
                        : isReal
                          ? "Marchés temporairement suspendus par l'opérateur."
                          : "Action en cours — réouverture automatique des cotes…"}
                  </span>
                </div>
              )}

              {/* Onglets de catégories horizontaux fluides */}
              {groups.length > 0 && (
                <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto py-0.5">
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
                          "flex h-7.5 shrink-0 items-center gap-1 rounded-full border px-2.5 font-display text-[11px] transition-colors",
                          active
                            ? "border-ink bg-ink font-bold text-white"
                            : "border-edge bg-white font-semibold text-mist active:bg-elev"
                        )}
                      >
                        <span>{tab.label}</span>
                        <span className={cn("text-[10px]", active ? "text-white/75" : "text-dim")}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Zone scrollable en bloc standard : aucune compression verticale possible */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-8 pt-3">
              {!isReal && (isLive || isFinished) && showTracker && (
                <LiveMatchTracker
                  key={match.id}
                  match={match}
                  defaultTab={isFinished ? "stats" : "pitch"}
                  className="mb-3"
                />
              )}
              {isReal && (isLive || isFinished) && showTracker && realStatsAvailable && (
                <RealMatchStatsCard
                  key={`real-stats-${match.id}`}
                  stats={match.realStats}
                  homeTeam={match.homeTeam}
                  awayTeam={match.awayTeam}
                  homeLogo={match.homeLogo}
                  awayLogo={match.awayLogo}
                  htHomeScore={match.htHomeScore}
                  htAwayScore={match.htAwayScore}
                  className="mb-3"
                />
              )}
              {isFinished || filteredGroups.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-mist">
                  {isFinished
                    ? "Cette rencontre est terminée — les marchés sont clôturés."
                    : "Aucun marché ouvert dans cette catégorie pour le moment."}
                </div>
              ) : (
                <div className="space-y-2.5 pb-safe lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                  {filteredGroups.map((g) => {
                    const isOpen =
                      category !== "all" ? (openMap[g.key] ?? true) : Boolean(openMap[g.key]);
                    const comboSelectedKey =
                      comboLegs.find(
                        (l) => l.uid === `sport-${match.id}` && l.market === g.key
                      )?.selection ?? null;
                    return (
                      <AccordionItem
                        key={g.key}
                        match={match}
                        group={g}
                        suspended={suspended}
                        open={isOpen}
                        oddsFormat={oddsFormat}
                        selectedKey={
                          target && target.match.id === match.id && target.market === g.key
                            ? target.selection
                            : null
                        }
                        comboSelectedKey={comboSelectedKey}
                        onToggle={() =>
                          setOpenMap((prev) => ({
                            ...prev,
                            [g.key]: !(category !== "all"
                              ? (prev[g.key] ?? true)
                              : Boolean(prev[g.key])),
                          }))
                        }
                        onPick={(outcome) => {
                          if (comboQuickMode) {
                            const res = toggleComboLeg({
                              uid: `sport-${match.id}`,
                              kind: "sport",
                              matchId: match.id,
                              matchSource: match.source,
                              title: `${match.homeTeam} – ${match.awayTeam}`,
                              homeTeam: match.homeTeam,
                              awayTeam: match.awayTeam,
                              homeLogo: match.homeLogo,
                              awayLogo: match.awayLogo,
                              league: match.league,
                              market: g.key,
                              selection: outcome.key,
                              selectionLabel: outcome.label,
                              odds: outcome.odds,
                              startsAt: match.startsAt,
                              isLive: match.status === "live",
                            });
                            if (res === "full") {
                              toast({
                                kind: "error",
                                title: "Betslip complet (8 sélections max)",
                              });
                            } else if (res === "source_conflict") {
                              toast({
                                kind: "error",
                                title: "Mélange interdit",
                                description:
                                  "Impossible de mélanger match réel et match virtuel.",
                              });
                            }
                            return;
                          }
                          openBet({
                            match,
                            selection: outcome.key,
                            odds: outcome.odds,
                            label: outcome.label,
                            market: g.key,
                            marketLabel: g.label,
                          });
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function AccordionItem({
  match,
  group,
  suspended,
  open,
  oddsFormat,
  selectedKey,
  comboSelectedKey,
  onToggle,
  onPick,
}: {
  match: ClientMatch;
  group: MarketGroup;
  suspended: boolean;
  open: boolean;
  oddsFormat: "decimal" | "fractional";
  selectedKey: string | null;
  comboSelectedKey: string | null;
  onToggle: () => void;
  onPick: (o: MarketOutcome) => void;
}) {
  const isScoreExact = group.key === "score_exact";
  const twoCols =
    !group.rows &&
    !isScoreExact &&
    (TWO_COL_MARKETS.has(group.key) || group.outcomes.length <= 2);

  const makeComboSelection = (o: MarketOutcome): ComboSelection => ({
    uid: `sport-${match.id}`,
    kind: "sport",
    matchId: match.id,
    matchSource: match.source,
    title: `${match.homeTeam} – ${match.awayTeam}`,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeLogo: match.homeLogo,
    awayLogo: match.awayLogo,
    league: match.league,
    market: group.key,
    selection: o.key,
    selectionLabel: o.label,
    odds: o.odds,
    startsAt: match.startsAt,
    isLive: match.status === "live",
  });

  return (
    <div className="rounded-xl border border-edge bg-white lg:rounded-2xl">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex min-h-[38px] w-full items-center justify-between bg-elev/40 px-3 py-2 text-left transition-colors active:bg-elev/80 lg:min-h-[46px] lg:px-3.5 lg:py-2.5",
          open ? "rounded-t-xl lg:rounded-t-2xl" : "rounded-xl lg:rounded-2xl"
        )}
      >
        <span className="pr-2 font-display text-[12px] font-bold leading-snug text-ink lg:text-[13px]">
          {group.label}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-dim transition-transform duration-200 lg:h-4 lg:w-4",
            open && "rotate-180 text-ink"
          )}
          strokeWidth={2.2}
        />
      </button>

      {open && (
        <div className="rounded-b-xl border-t border-edge/70 bg-white p-2 lg:rounded-b-2xl lg:p-3">
          {group.rows ? (
            <div className="space-y-1.5 lg:space-y-2">
              {(group.rows[0]?.outcomes.length ?? 2) === 3 ? (
                <div className="grid grid-cols-[44px_1fr_1fr_1fr] items-center gap-1.5 px-1 text-[9.5px] font-bold uppercase tracking-wider text-dim lg:grid-cols-[50px_1fr_1fr_1fr] lg:gap-2 lg:text-[10px]">
                  <span className="text-center">Hcap</span>
                  <span className="text-center">V1</span>
                  <span className="text-center">X</span>
                  <span className="text-center">V2</span>
                </div>
              ) : (
                <div className="grid grid-cols-[44px_1fr_1fr] items-center gap-1.5 px-1 text-[9.5px] font-bold uppercase tracking-wider text-dim lg:grid-cols-[50px_1fr_1fr] lg:gap-2 lg:text-[10px]">
                  <span className="text-center">Total</span>
                  <span className="text-center">Plus de</span>
                  <span className="text-center">Moins de</span>
                </div>
              )}
              {group.rows.map((row) => (
                <div
                  key={row.label}
                  className={cn(
                    "grid items-center gap-1.5 lg:gap-2",
                    row.outcomes.length === 3
                      ? "grid-cols-[44px_1fr_1fr_1fr] lg:grid-cols-[50px_1fr_1fr_1fr]"
                      : "grid-cols-[44px_1fr_1fr] lg:grid-cols-[50px_1fr_1fr]"
                  )}
                >
                  <span className="flex h-9 items-center justify-center rounded-lg bg-elev font-display text-[11px] font-bold tabular-nums text-ink lg:h-11 lg:rounded-xl lg:text-[12px]">
                    {row.label}
                  </span>
                  {row.outcomes.map((o) => (
                    <OutcomeCell
                      key={o.key}
                      o={o}
                      suspended={suspended}
                      selected={selectedKey === o.key}
                      inCombo={comboSelectedKey === o.key}
                      oddsFormat={oddsFormat}
                      comboSelection={makeComboSelection(o)}
                      onPick={() => onPick(o)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : isScoreExact ? (
            <div className="grid grid-cols-3 gap-1.5 lg:gap-2">
              {group.outcomes.map((o) => (
                <OutcomeCell
                  key={o.key}
                  o={o}
                  suspended={suspended}
                  selected={selectedKey === o.key}
                  inCombo={comboSelectedKey === o.key}
                  oddsFormat={oddsFormat}
                  comboSelection={makeComboSelection(o)}
                  onPick={() => onPick(o)}
                />
              ))}
            </div>
          ) : (
            <div className={cn("grid gap-1.5 lg:gap-2", twoCols ? "grid-cols-2" : "grid-cols-3")}>
              {group.outcomes.map((o, idx) => {
                // Si marché à 2 colonnes avec un nombre impair d'issues ouvertes, la dernière prend toute la ligne
                const spanFull =
                  twoCols &&
                  group.outcomes.length > 2 &&
                  group.outcomes.length % 2 === 1 &&
                  idx === group.outcomes.length - 1;
                return (
                  <OutcomeCell
                    key={o.key}
                    o={o}
                    suspended={suspended}
                    selected={selectedKey === o.key}
                    inCombo={comboSelectedKey === o.key}
                    oddsFormat={oddsFormat}
                    className={spanFull ? "col-span-2" : undefined}
                    comboSelection={makeComboSelection(o)}
                    onPick={() => onPick(o)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OutcomeCell({
  o,
  suspended,
  selected,
  inCombo,
  oddsFormat,
  className,
  comboSelection,
  onPick,
}: {
  o: MarketOutcome;
  suspended: boolean;
  selected?: boolean;
  inCombo?: boolean;
  oddsFormat: "decimal" | "fractional";
  className?: string;
  comboSelection: ComboSelection;
  onPick: () => void;
}) {
  const active = selected || inCombo;
  const trend = useOddsTrend(o.odds);
  const { pressing, handlers, style } = useLongPressOdds({
    disabled: suspended,
    comboSelection,
    onTap: () => onPick(),
  });
  return (
    <button
      type="button"
      {...handlers}
      style={style}
      aria-disabled={suspended}
      className={cn(
        "relative flex h-9 items-center justify-between gap-1.5 rounded-lg border px-2.5 transition-colors lg:h-11 lg:gap-2 lg:rounded-xl lg:px-3",
        selected
          ? "border-betclic-red bg-betclic-red text-white shadow-xs"
          : inCombo
            ? "border-ink bg-ink text-white shadow-xs ring-2 ring-betclic-red/35"
            : "border-edge bg-elev/65 active:border-betclic-red/50 active:bg-betclic-red/8",
        pressing && !suspended && "ring-2 ring-betclic-red/50",
        suspended && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {!suspended && <OddsTrendCorner trend={trend} inverted={active} />}
      <span
        className={cn(
          "truncate text-[11px] font-semibold lg:text-[12px]",
          active ? "text-white/90" : "text-mist"
        )}
      >
        {o.short}
      </span>
      {suspended ? (
        <Lock className="h-3 w-3 shrink-0 text-dim lg:h-3.5 lg:w-3.5" strokeWidth={2.3} />
      ) : (
        <span
          className={cn(
            "shrink-0 font-display text-[12.5px] font-bold tabular-nums transition-colors duration-200 lg:text-[13.5px]",
            oddsTrendTextClass(trend, active)
          )}
        >
          {formatOdds(o.odds, oddsFormat)}
        </span>
      )}
    </button>
  );
}
