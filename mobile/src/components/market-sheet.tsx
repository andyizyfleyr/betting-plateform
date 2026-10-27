import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BarChart3, ChevronDown, Lock, Radio, X } from "lucide-react-native";
import { useApp, type ComboSelection } from "@/context/app-context";
import {
  api,
  type ClientMatch,
  type MarketGroup,
  type MarketOutcome,
} from "@/lib/api";
import { formatOdds } from "@/lib/format";
import { COLORS, triggerHaptic } from "@/theme/tokens";
import { LiveMatchTracker } from "./live-match-tracker";
import { formatGoalSummary, LiveStatusBadge } from "./match-card";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "./odds-trend-corner";
import { hasAnyRealStats, RealMatchStatsCard } from "./real-match-stats-card";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";

const POLL_INTERVAL = 4_000;

export type SheetCategory =
  | "all"
  | "main"
  | "halftime"
  | "goals"
  | "teams"
  | "scores";

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

const SHORT_MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

export function formatMatchDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} · ${hh}:${mm}`;
}

export function inferCategory(g: MarketGroup): Exclude<SheetCategory, "all"> {
  if (
    g.category &&
    (g.category === "main" ||
      g.category === "halftime" ||
      g.category === "goals" ||
      g.category === "teams" ||
      g.category === "scores")
  ) {
    return g.category;
  }
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
  if (
    [
      "score_exact",
      "correct_score",
      "exact_score",
      "winning_margin",
      "ht_ft",
    ].includes(g.key)
  ) {
    return "scores";
  }
  if (["total_exact", "odd_even", "goal_range"].includes(g.key)) return "goals";
  return "teams";
}

export function sanitizeMatchMarkets(
  raw: MarketGroup[] | undefined
): MarketGroup[] {
  if (!raw) return [];
  return raw
    .map((g) =>
      g.key === "score_exact" ||
      g.key === "correct_score" ||
      g.key === "exact_score"
        ? {
            ...g,
            outcomes: g.outcomes.filter(
              (o) =>
                o.key !== "other" &&
                !o.label.toLowerCase().includes("autre score")
            ),
          }
        : g
    )
    .filter((g) => (g.rows ? g.rows.length > 0 : g.outcomes.length > 0));
}

function OutcomeCell({
  o,
  suspended,
  selected,
  inCombo,
  oddsFormat,
  comboSelection,
  onPick,
}: {
  o: MarketOutcome;
  suspended: boolean;
  selected?: boolean;
  inCombo?: boolean;
  oddsFormat: "decimal" | "fractional";
  comboSelection: ComboSelection;
  onPick: () => void;
}) {
  const { toggleComboLeg, toast, hapticsEnabled } = useApp();
  const active = Boolean(selected || inCombo);
  const trend = useOddsTrend(o.odds);

  const handleLongPress = () => {
    if (suspended) return;
    triggerHaptic("medium", hapticsEnabled);
    const res = toggleComboLeg(comboSelection);
    if (res === "full") {
      toast({ kind: "error", title: "Betslip complet (8 sélections max)" });
    } else if (res === "source_conflict") {
      toast({
        kind: "error",
        title: "Mélange interdit",
        description: "Impossible de mélanger match réel et match virtuel.",
      });
    } else if (res === "added" || res === "replaced") {
      toast({
        kind: "success",
        title:
          res === "replaced"
            ? "Sélection remplacée dans le coupon"
            : "Ajouté au coupon de pari",
        description: `${comboSelection.title} · ${comboSelection.selectionLabel}`,
      });
    } else if (res === "removed") {
      toast({ kind: "info", title: "Retiré du coupon" });
    }
  };

  return (
    <Pressable
      disabled={suspended}
      onPress={() => {
        if (suspended) return;
        triggerHaptic("light", hapticsEnabled);
        onPick();
      }}
      onLongPress={handleLongPress}
      delayLongPress={260}
      style={({ pressed }) => [
        styles.outcomeBtn,
        selected
          ? styles.outcomeBtnSelected
          : inCombo
            ? styles.outcomeBtnCombo
            : styles.outcomeBtnIdle,
        pressed && !suspended && { transform: [{ scale: 0.98 }] },
        suspended && { opacity: 0.5 },
      ]}
    >
      {!suspended ? <OddsTrendCorner trend={trend} inverted={active} /> : null}
      <Text
        numberOfLines={1}
        style={[
          styles.outcomeShort,
          active ? { color: "rgba(255,255,255,0.9)" } : { color: COLORS.mist },
        ]}
      >
        {o.short ?? o.shortLabel ?? o.label}
      </Text>
      {suspended ? (
        <Lock size={12} color={COLORS.dim} strokeWidth={2.3} />
      ) : (
        <Text
          style={[
            styles.outcomeOdds,
            { color: oddsTrendTextColor(trend, active) },
          ]}
        >
          {formatOdds(o.odds, oddsFormat)}
        </Text>
      )}
    </Pressable>
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
  const isScoreExact =
    group.key === "score_exact" ||
    group.key === "correct_score" ||
    group.key === "exact_score";
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
    homeLogo: match.homeLogo ?? null,
    awayLogo: match.awayLogo ?? null,
    league: match.league,
    market: group.key,
    selection: o.key,
    selectionLabel: o.label,
    odds: o.odds,
    startsAt: match.startsAt,
    isLive: match.status === "live",
  });

  // Chunk flat outcomes into rows of 2 or 3 for crisp flex rows
  const chunkSize = twoCols ? 2 : 3;
  const outcomeRows: MarketOutcome[][] = [];
  if (!group.rows) {
    for (let i = 0; i < group.outcomes.length; i += chunkSize) {
      outcomeRows.push(group.outcomes.slice(i, i + chunkSize));
    }
  }

  return (
    <View style={styles.accCard}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.accHeader,
          open ? styles.accHeaderOpen : styles.accHeaderClosed,
          pressed && { backgroundColor: COLORS.elev },
        ]}
      >
        <Text style={styles.accTitle}>{group.label}</Text>
        <ChevronDown
          size={14}
          color={open ? COLORS.ink : COLORS.dim}
          strokeWidth={2.2}
          style={open ? { transform: [{ rotate: "180deg" }] } : undefined}
        />
      </Pressable>

      {open ? (
        <View style={styles.accBody}>
          {group.rows && group.rows.length > 0 ? (
            <View style={{ gap: 6 }}>
              {(group.rows[0]?.outcomes.length ?? 2) === 3 ? (
                <View style={styles.tableHeadRow}>
                  <Text style={styles.tableHeadLabelCol}>HCAP</Text>
                  <Text style={styles.tableHeadCol}>V1</Text>
                  <Text style={styles.tableHeadCol}>X</Text>
                  <Text style={styles.tableHeadCol}>V2</Text>
                </View>
              ) : (
                <View style={styles.tableHeadRow}>
                  <Text style={styles.tableHeadLabelCol}>TOTAL</Text>
                  <Text style={styles.tableHeadCol}>PLUS DE</Text>
                  <Text style={styles.tableHeadCol}>MOINS DE</Text>
                </View>
              )}

              {group.rows.map((row) => (
                <View key={row.label} style={styles.tableDataRow}>
                  <View style={styles.rowLineBox}>
                    <Text style={styles.rowLineText}>{row.label}</Text>
                  </View>
                  {row.outcomes.map((o) => (
                    <View key={o.key} style={{ flex: 1 }}>
                      <OutcomeCell
                        o={o}
                        suspended={suspended}
                        selected={selectedKey === o.key}
                        inCombo={comboSelectedKey === o.key}
                        oddsFormat={oddsFormat}
                        comboSelection={makeComboSelection(o)}
                        onPick={() => onPick(o)}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              {outcomeRows.map((rowItems, rIdx) => (
                <View key={rIdx} style={styles.flatRow}>
                  {rowItems.map((o) => (
                    <View key={o.key} style={{ flex: 1 }}>
                      <OutcomeCell
                        o={o}
                        suspended={suspended}
                        selected={selectedKey === o.key}
                        inCombo={comboSelectedKey === o.key}
                        oddsFormat={oddsFormat}
                        comboSelection={makeComboSelection(o)}
                        onPick={() => onPick(o)}
                      />
                    </View>
                  ))}
                  {!twoCols &&
                    rowItems.length < 3 &&
                    Array.from({ length: 3 - rowItems.length }).map((_, k) => (
                      <View key={`spacer-${k}`} style={{ flex: 1 }} />
                    ))}
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function MarketSheet() {
  const {
    marketMatch,
    closeMarkets,
    openBet,
    oddsFormat,
    target,
    feedMatches,
    comboLegs,
    comboQuickMode,
    toggleComboLeg,
    toast,
  } = useApp();

  const [category, setCategory] = useState<SheetCategory>("all");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [prevMatchId, setPrevMatchId] = useState<number | null>(null);
  const [liveMatch, setLiveMatch] = useState<ClientMatch | null>(null);
  const [showTracker, setShowTracker] = useState(false);

  const sharedFromFeed = useMemo(
    () =>
      marketMatch && feedMatches
        ? feedMatches.find((m) => m.id === marketMatch.id) ?? null
        : null,
    [marketMatch, feedMatches]
  );

  const match =
    sharedFromFeed ??
    (liveMatch && marketMatch && liveMatch.id === marketMatch.id
      ? liveMatch
      : marketMatch);

  useEffect(() => {
    if (!marketMatch) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await api.matchById(marketMatch.id);
        if (!active) return;
        if (r.match) setLiveMatch(r.match);
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

  const effectiveSource =
    liveMatch && marketMatch && liveMatch.id === marketMatch.id
      ? liveMatch
      : match;

  if (effectiveSource && effectiveSource.id !== prevMatchId) {
    setPrevMatchId(effectiveSource.id);
    setCategory("all");
    setShowTracker(false);
    const groups = effectiveSource.markets ?? [];
    const initialOpen: Record<string, boolean> = {};
    for (const key of ["result", "total_ou"]) {
      if (groups.some((g) => g.key === key)) initialOpen[key] = true;
    }
    if (Object.keys(initialOpen).length === 0) {
      for (const g of groups.slice(0, 2)) initialOpen[g.key] = true;
    }
    setOpenMap(initialOpen);
  } else if (!effectiveSource && prevMatchId !== null) {
    setPrevMatchId(null);
    setOpenMap({});
  }

  const groups = useMemo(
    () => sanitizeMatchMarkets(effectiveSource?.markets),
    [effectiveSource]
  );

  const filteredGroups = useMemo(() => {
    if (category === "all") return groups;
    return groups.filter((g) => inferCategory(g) === category);
  }, [groups, category]);

  if (!effectiveSource) return null;

  const isLive = effectiveSource.status === "live";
  const isFinished = effectiveSource.status === "finished";
  const isReal = effectiveSource.source === "manual";
  const realStatsAvailable =
    isReal && hasAnyRealStats(effectiveSource.realStats);
  const suspended = Boolean(effectiveSource.suspended);
  const { homeGoals, awayGoals } = formatGoalSummary(
    effectiveSource.events,
    effectiveSource.homeScore,
    effectiveSource.awayScore
  );
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;

  return (
    <Modal
      visible={Boolean(effectiveSource)}
      transparent
      animationType="slide"
      onRequestClose={closeMarkets}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={closeMarkets} />

        <View style={styles.sheet}>
          <View style={styles.fixedTop}>
            <View style={styles.grabber} />

            <View style={styles.topRow}>
              <View style={styles.leagueInfo}>
                <SportIcon
                  sport={effectiveSource.sport}
                  size={14}
                  color={COLORS.dim}
                />
                <Text numberOfLines={1} style={styles.leagueText}>
                  {effectiveSource.league}
                </Text>
              </View>

              <View style={styles.topActions}>
                <View style={styles.datePill}>
                  <Text style={styles.datePillText}>
                    {formatMatchDateTime(effectiveSource.startsAt)}
                  </Text>
                </View>

                {(isLive || isFinished) &&
                (isReal ? realStatsAvailable : true) ? (
                  <Pressable
                    onPress={() => setShowTracker((s) => !s)}
                    style={[
                      styles.trackerPill,
                      showTracker && styles.trackerPillActive,
                    ]}
                  >
                    {isReal ? (
                      <BarChart3
                        size={12}
                        color={showTracker ? "#ffffff" : COLORS.mist}
                        strokeWidth={2.4}
                      />
                    ) : (
                      <Radio
                        size={12}
                        color={showTracker ? "#ffffff" : COLORS.mist}
                        strokeWidth={2.4}
                      />
                    )}
                    <Text
                      style={[
                        styles.trackerPillText,
                        showTracker && { color: "#ffffff" },
                      ]}
                    >
                      {isReal
                        ? isLive
                          ? "Stats live"
                          : "Stats"
                        : isLive
                          ? "Terrain 2D"
                          : "Stats"}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable onPress={closeMarkets} style={styles.closeBtn}>
                  <X size={16} color={COLORS.mist} strokeWidth={2.2} />
                </Pressable>
              </View>
            </View>

            {/* Scoreboard avec noms complets */}
            <View style={styles.scoreCard}>
              <View style={styles.scoreGrid}>
                <View style={styles.homeSide}>
                  <TeamAvatar
                    name={effectiveSource.homeTeam}
                    logo={effectiveSource.homeLogo}
                    size="sm"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clubName}>
                      {effectiveSource.homeTeam}
                    </Text>
                    {(effectiveSource.redHome ?? 0) > 0 ? (
                      <Text style={styles.redLabel}>
                        🟥 {effectiveSource.redHome} rouge
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.centerScore}>
                  {isLive || isFinished ? (
                    <>
                      <Text style={styles.scoreDigits}>
                        {effectiveSource.homeScore ?? 0} –{" "}
                        {effectiveSource.awayScore ?? 0}
                      </Text>
                      {isReal &&
                      effectiveSource.htHomeScore != null &&
                      effectiveSource.htAwayScore != null ? (
                        <Text style={styles.htText}>
                          MT {effectiveSource.htHomeScore} -{" "}
                          {effectiveSource.htAwayScore}
                        </Text>
                      ) : null}
                      <View style={{ marginTop: 4 }}>
                        {isFinished ? (
                          <Text style={styles.finSmall}>Terminé</Text>
                        ) : (
                          <LiveStatusBadge
                            minute={effectiveSource.minute}
                            suspended={suspended}
                          />
                        )}
                      </View>
                    </>
                  ) : (
                    <Text style={styles.vsText}>VS</Text>
                  )}
                </View>

                <View style={styles.awaySide}>
                  <View style={{ flex: 1, alignItems: "flex-end" }}>
                    <Text style={[styles.clubName, { textAlign: "right" }]}>
                      {effectiveSource.awayTeam}
                    </Text>
                    {(effectiveSource.redAway ?? 0) > 0 ? (
                      <Text style={styles.redLabel}>
                        {effectiveSource.redAway} rouge 🟥
                      </Text>
                    ) : null}
                  </View>
                  <TeamAvatar
                    name={effectiveSource.awayTeam}
                    logo={effectiveSource.awayLogo}
                    size="sm"
                  />
                </View>
              </View>

              {hasGoals ? (
                <View style={styles.goalsRow}>
                  <Text numberOfLines={1} style={styles.goalText}>
                    {homeGoals.length > 0 ? `⚽ ${homeGoals.join(", ")}` : ""}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.goalText, { textAlign: "right" }]}
                  >
                    {awayGoals.length > 0 ? `${awayGoals.join(", ")} ⚽` : ""}
                  </Text>
                </View>
              ) : null}
            </View>

            {suspended ? (
              <View style={styles.suspendedBanner}>
                <Lock size={14} color="#92400e" strokeWidth={2.3} />
                <Text style={styles.suspendedBannerText}>
                  {isReal && !isLive && effectiveSource.kickoffReached
                    ? "Coup d'envoi officiel atteint — paris pré-match clôturés en attente du direct."
                    : isReal && isLive
                      ? "Action décisive ou actualisation en direct — cotes momentanément suspendues."
                      : isReal
                        ? "Marchés temporairement suspendus par l'opérateur."
                        : "Action en cours — réouverture automatique des cotes…"}
                </Text>
              </View>
            ) : null}

            {groups.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.catRow}
              >
                {CATEGORY_TABS.map((tab) => {
                  const count =
                    tab.key === "all"
                      ? groups.length
                      : groups.filter((g) => inferCategory(g) === tab.key)
                          .length;
                  if (tab.key !== "all" && count === 0) return null;
                  const active = category === tab.key;
                  return (
                    <Pressable
                      key={tab.key}
                      onPress={() => setCategory(tab.key)}
                      style={[styles.catPill, active && styles.catPillActive]}
                    >
                      <Text
                        style={[
                          styles.catLabel,
                          active && styles.catLabelActive,
                        ]}
                      >
                        {tab.label}
                      </Text>
                      <Text
                        style={[
                          styles.catCount,
                          active && styles.catCountActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {!isReal && (isLive || isFinished) && showTracker ? (
              <View style={{ marginBottom: 12 }}>
                <LiveMatchTracker match={effectiveSource} />
              </View>
            ) : null}
            {isReal &&
            (isLive || isFinished) &&
            showTracker &&
            realStatsAvailable ? (
              <View style={{ marginBottom: 12 }}>
                <RealMatchStatsCard
                  stats={effectiveSource.realStats}
                  homeTeam={effectiveSource.homeTeam}
                  awayTeam={effectiveSource.awayTeam}
                  homeLogo={effectiveSource.homeLogo}
                  awayLogo={effectiveSource.awayLogo}
                  htHomeScore={effectiveSource.htHomeScore}
                  htAwayScore={effectiveSource.htAwayScore}
                  compact
                />
              </View>
            ) : null}

            {isFinished || filteredGroups.length === 0 ? (
              <Text style={styles.emptyText}>
                {isFinished
                  ? "Cette rencontre est terminée — les marchés sont clôturés."
                  : "Aucun marché ouvert dans cette catégorie pour le moment."}
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {filteredGroups.map((g) => {
                  const isOpen =
                    category !== "all"
                      ? (openMap[g.key] ?? true)
                      : Boolean(openMap[g.key]);
                  const comboSelectedKey =
                    comboLegs.find(
                      (l) =>
                        l.uid === `sport-${effectiveSource.id}` &&
                        l.market === g.key
                    )?.selection ?? null;

                  return (
                    <AccordionItem
                      key={g.key}
                      match={effectiveSource}
                      group={g}
                      suspended={suspended}
                      open={isOpen}
                      oddsFormat={oddsFormat}
                      selectedKey={
                        target &&
                        target.match.id === effectiveSource.id &&
                        target.market === g.key
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
                            uid: `sport-${effectiveSource.id}`,
                            kind: "sport",
                            matchId: effectiveSource.id,
                            matchSource: effectiveSource.source,
                            title: `${effectiveSource.homeTeam} – ${effectiveSource.awayTeam}`,
                            homeTeam: effectiveSource.homeTeam,
                            awayTeam: effectiveSource.awayTeam,
                            homeLogo: effectiveSource.homeLogo ?? null,
                            awayLogo: effectiveSource.awayLogo ?? null,
                            league: effectiveSource.league,
                            market: g.key,
                            selection: outcome.key,
                            selectionLabel: outcome.label,
                            odds: outcome.odds,
                            startsAt: effectiveSource.startsAt,
                            isLive: effectiveSource.status === "live",
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
                        closeMarkets();
                        openBet({
                          match: effectiveSource,
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
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  fixedTop: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edge,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: COLORS.edge,
    alignSelf: "center",
  },
  topRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leagueInfo: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  leagueText: {
    flexShrink: 1,
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.mist,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  datePill: {
    height: 28,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  datePillText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  trackerPill: {
    height: 28,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  trackerPillActive: {
    backgroundColor: "#047857",
  },
  trackerPillText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.mist,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreCard: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(228,230,235,0.8)",
    backgroundColor: "rgba(238,240,244,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scoreGrid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  homeSide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  awaySide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  clubName: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    lineHeight: 16,
  },
  redLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.betclicRed,
  },
  centerScore: {
    alignItems: "center",
    paddingHorizontal: 4,
  },
  scoreDigits: {
    fontSize: 19,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  htText: {
    marginTop: 2,
    fontSize: 9.5,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  finSmall: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.dim,
  },
  vsText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.dim,
  },
  goalsRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(228,230,235,0.6)",
    paddingTop: 6,
    flexDirection: "row",
    gap: 8,
  },
  goalText: {
    flex: 1,
    fontSize: 10.5,
    color: COLORS.mist,
  },
  suspendedBanner: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  suspendedBannerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: "#92400e",
  },
  catRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
  },
  catPill: {
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  catPillActive: {
    borderColor: COLORS.ink,
    backgroundColor: COLORS.ink,
  },
  catLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.mist,
  },
  catLabelActive: {
    fontWeight: "700",
    color: "#ffffff",
  },
  catCount: {
    fontSize: 10,
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  catCountActive: {
    color: "rgba(255,255,255,0.75)",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 32,
  },
  emptyText: {
    paddingVertical: 40,
    textAlign: "center",
    fontSize: 13,
    color: COLORS.mist,
  },
  accCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  accHeader: {
    minHeight: 38,
    backgroundColor: "rgba(238,240,244,0.4)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accHeaderOpen: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(228,230,235,0.7)",
  },
  accHeaderClosed: {},
  accTitle: {
    flex: 1,
    paddingRight: 8,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  accBody: {
    backgroundColor: "#ffffff",
    padding: 8,
  },
  tableHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  tableHeadLabelCol: {
    width: 44,
    textAlign: "center",
    fontSize: 9.5,
    fontWeight: "700",
    color: COLORS.dim,
  },
  tableHeadCol: {
    flex: 1,
    textAlign: "center",
    fontSize: 9.5,
    fontWeight: "700",
    color: COLORS.dim,
  },
  tableDataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowLineBox: {
    width: 44,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLineText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  flatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  outcomeBtn: {
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    position: "relative",
    overflow: "hidden",
  },
  outcomeBtnIdle: {
    backgroundColor: "rgba(238,240,244,0.65)",
    borderColor: COLORS.edge,
  },
  outcomeBtnSelected: {
    backgroundColor: COLORS.betclicRed,
    borderColor: COLORS.betclicRed,
  },
  outcomeBtnCombo: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  outcomeShort: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
  },
  outcomeOdds: {
    fontSize: 12.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
