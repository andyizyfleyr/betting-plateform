import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, ChevronDown, Lock, X } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import {
  api,
  type ClientMatch,
  type MarketGroup,
  type MarketOutcome,
} from "@/lib/api";
import { formatOdds } from "@/lib/format";
import { COLORS } from "@/theme/tokens";
import { KickoffCountdown } from "./kickoff-countdown";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "./odds-trend-corner";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";

const CATEGORIES = [
  { key: "all", label: "Tous" },
  { key: "main", label: "Principaux" },
  { key: "goals", label: "Buts" },
  { key: "halftime", label: "Mi-temps" },
  { key: "teams", label: "Équipes" },
  { key: "scores", label: "Score exact" },
] as const;

export function filterExactScoreOutcomes(
  groupKey: string,
  outcomes: MarketOutcome[]
): MarketOutcome[] {
  if (groupKey !== "correct_score" && groupKey !== "exact_score") {
    return outcomes;
  }
  return outcomes.filter(
    (o) =>
      o.key !== "other" &&
      !o.label.toLowerCase().includes("autre score") &&
      !o.label.toLowerCase().includes("autre")
  );
}

export function MarketOutcomeButton({
  outcome,
  oddsFormat,
  selected,
  disabled,
  onPress,
  onLongPress,
}: {
  outcome: MarketOutcome;
  oddsFormat: "decimal" | "fractional";
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const trend = useOddsTrend(outcome.odds);
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[
        styles.outBtn,
        selected ? styles.outBtnSelected : styles.outBtnIdle,
        disabled && { opacity: 0.55 },
      ]}
    >
      <OddsTrendCorner trend={trend} inverted={selected} />
      <View style={styles.outLabelWrap}>
        {selected ? (
          <Check size={12} color="#ffffff" strokeWidth={3} />
        ) : null}
        <Text
          numberOfLines={2}
          style={[
            styles.outLabel,
            selected && { color: "rgba(255,255,255,0.88)" },
          ]}
        >
          {outcome.short ?? outcome.shortLabel ?? outcome.label}
        </Text>
      </View>
      <Text
        style={[
          styles.outOdds,
          { color: oddsTrendTextColor(trend, selected) },
        ]}
      >
        {formatOdds(outcome.odds, oddsFormat)}
      </Text>
    </Pressable>
  );
}

export function MarketGroupAccordion({
  match,
  group,
}: {
  match: ClientMatch;
  group: MarketGroup;
}) {
  const {
    oddsFormat,
    openBet,
    closeMarkets,
    toggleComboLeg,
    isInCombo,
    comboQuickMode,
    toast,
  } = useApp();
  const [open, setOpen] = useState(true);
  const uid = `sport-${match.id}`;

  const cleanOutcomes = useMemo(
    () => filterExactScoreOutcomes(group.key, group.outcomes),
    [group.key, group.outcomes]
  );

  const handleCombo = (o: MarketOutcome) => {
    const res = toggleComboLeg({
      uid,
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
      selectionLabel: `${group.short ?? group.label} · ${o.label}`,
      odds: o.odds,
      startsAt: match.startsAt,
      isLive: match.status === "live",
    });
    if (res === "full") {
      toast({
        kind: "error",
        title: "Combiné complet",
        description: "Maximum 8 sélections par ticket combiné.",
      });
    } else if (res === "source_conflict") {
      toast({
        kind: "error",
        title: "Mélange interdit",
        description:
          "Impossible de combiner un match officiel et un match virtuel.",
      });
    }
  };

  const handlePress = (o: MarketOutcome) => {
    if (comboQuickMode) {
      handleCombo(o);
      return;
    }
    closeMarkets();
    openBet({
      match,
      selection: o.key,
      odds: o.odds,
      label: o.label,
      market: group.key,
      marketLabel: group.label,
    });
  };

  return (
    <View style={styles.groupCard}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.groupHead}>
        <Text style={styles.groupTitle}>{group.label}</Text>
        <ChevronDown
          size={16}
          color={COLORS.dim}
          strokeWidth={2.2}
          style={open ? { transform: [{ rotate: "180deg" }] } : undefined}
        />
      </Pressable>

      {open ? (
        <View style={styles.groupBody}>
          {group.rows && group.rows.length > 0 ? (
            group.rows.map((row, idx) => (
              <View key={idx} style={styles.subRowWrap}>
                <Text style={styles.subRowLabel}>{row.label}</Text>
                <View style={styles.gridRow}>
                  {row.outcomes.map((o) => (
                    <View key={o.key} style={styles.gridCellHalf}>
                      <MarketOutcomeButton
                        outcome={o}
                        oddsFormat={oddsFormat}
                        selected={isInCombo(uid, group.key, o.key)}
                        disabled={match.suspended}
                        onPress={() => handlePress(o)}
                        onLongPress={() => handleCombo(o)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <View style={styles.gridWrap}>
              {cleanOutcomes.map((o) => {
                const cols =
                  cleanOutcomes.length === 3
                    ? "31.5%"
                    : cleanOutcomes.length >= 6
                      ? "31.5%"
                      : "48.5%";
                return (
                  <View key={o.key} style={{ width: cols }}>
                    <MarketOutcomeButton
                      outcome={o}
                      oddsFormat={oddsFormat}
                      selected={isInCombo(uid, group.key, o.key)}
                      disabled={match.suspended}
                      onPress={() => handlePress(o)}
                      onLongPress={() => handleCombo(o)}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function MarketSheet() {
  const { marketMatch, closeMarkets, feedMatches } = useApp();
  const [fullMatch, setFullMatch] = useState<ClientMatch | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [cat, setCat] = useState<string>("all");

  useEffect(() => {
    if (!marketMatch) {
      setFullMatch(null);
      setCat("all");
      return;
    }
    setFullMatch(marketMatch);
    if (marketMatch.markets.length <= 1) {
      setLoadingFull(true);
      api
        .matchById(marketMatch.id)
        .then((res) => setFullMatch(res.match))
        .catch(() => {})
        .finally(() => setLoadingFull(false));
    }
  }, [marketMatch]);

  const match = useMemo(() => {
    if (!fullMatch) return null;
    const live = feedMatches?.find((m) => m.id === fullMatch.id);
    if (!live) return fullMatch;
    return fullMatch.markets.length > live.markets.length
      ? {
          ...fullMatch,
          status: live.status,
          minute: live.minute,
          homeScore: live.homeScore,
          awayScore: live.awayScore,
          suspended: live.suspended,
        }
      : live;
  }, [feedMatches, fullMatch]);

  if (!marketMatch || !match) return null;

  const filteredGroups = match.markets.filter(
    (g) => cat === "all" || g.category === cat
  );

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={closeMarkets}
    >
      <Pressable style={styles.backdrop} onPress={closeMarkets}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.grabber} />

          {/* En-tête : ligue (sans badge « Virtuel ») + date/heure du match (aucun bouton Betslip rouge) */}
          <View style={styles.topRow}>
            <View style={styles.leagueInfo}>
              <SportIcon sport={match.sport} size={14} color={COLORS.dim} />
              <Text numberOfLines={1} style={styles.leagueText}>
                {match.league}
              </Text>
            </View>
            <View style={styles.topRight}>
              {match.status === "live" ? (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>{match.minute ?? "LIVE"}</Text>
                </View>
              ) : (
                <KickoffCountdown startsAt={match.startsAt} />
              )}
              <Pressable onPress={closeMarkets} style={styles.closeBtn}>
                <X size={17} color={COLORS.mist} strokeWidth={2.2} />
              </Pressable>
            </View>
          </View>

          {/* Noms complets des clubs sans troncature */}
          <View style={styles.teamsCard}>
            <View style={styles.teamLine}>
              <View style={styles.teamLeft}>
                <TeamAvatar
                  name={match.homeTeam}
                  logo={match.homeLogo}
                  size="sm"
                />
                <Text style={styles.fullClubName}>{match.homeTeam}</Text>
              </View>
              {match.homeScore !== null ? (
                <Text style={styles.scoreVal}>{match.homeScore}</Text>
              ) : null}
            </View>
            <View style={styles.teamLine}>
              <View style={styles.teamLeft}>
                <TeamAvatar
                  name={match.awayTeam}
                  logo={match.awayLogo}
                  size="sm"
                />
                <Text style={styles.fullClubName}>{match.awayTeam}</Text>
              </View>
              {match.awayScore !== null ? (
                <Text style={styles.scoreVal}>{match.awayScore}</Text>
              ) : null}
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catsRow}
          >
            {CATEGORIES.map((c) => {
              const active = cat === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setCat(c.key)}
                  style={[styles.catPill, active && styles.catPillActive]}
                >
                  <Text
                    style={[styles.catText, active && styles.catTextActive]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {match.suspended ? (
            <View style={styles.suspendedNotice}>
              <Lock size={14} color={COLORS.amber} strokeWidth={2.2} />
              <Text style={styles.suspendedText}>
                Cotes momentanément suspendues en direct
              </Text>
            </View>
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.groupsList}
          >
            {loadingFull ? (
              <View style={styles.loaderBox}>
                <ActivityIndicator size="small" color={COLORS.betclicRed} />
              </View>
            ) : (
              filteredGroups.map((group) => (
                <MarketGroupAccordion
                  key={group.key}
                  match={match}
                  group={group}
                />
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.deep,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 20,
    maxHeight: "92%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.edge,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  leagueInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  leagueText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.mist,
    flexShrink: 1,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
  },
  liveText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: COLORS.betclicRed,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  teamsCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 12,
    gap: 8,
    marginBottom: 10,
  },
  teamLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  teamLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
  },
  fullClubName: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
    flex: 1,
  },
  scoreVal: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  catsRow: {
    flexDirection: "row",
    gap: 7,
    paddingBottom: 10,
  },
  catPill: {
    height: 34,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.pillDefault,
    alignItems: "center",
    justifyContent: "center",
  },
  catPillActive: {
    backgroundColor: COLORS.betclicRed,
  },
  catText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  catTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  suspendedNotice: {
    borderRadius: 10,
    backgroundColor: COLORS.amberSoft,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  suspendedText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.amber,
  },
  groupsList: {
    gap: 10,
    paddingBottom: 18,
  },
  loaderBox: {
    paddingVertical: 28,
    alignItems: "center",
  },
  groupCard: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    overflow: "hidden",
  },
  groupHead: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    flex: 1,
  },
  groupBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
  },
  subRowWrap: {
    gap: 6,
  },
  subRowLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.dim,
  },
  gridRow: {
    flexDirection: "row",
    gap: 8,
  },
  gridCellHalf: {
    flex: 1,
  },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 7,
  },
  outBtn: {
    minHeight: 44,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    position: "relative",
    overflow: "hidden",
  },
  outBtnIdle: {
    backgroundColor: COLORS.elev,
  },
  outBtnSelected: {
    backgroundColor: COLORS.outerSpace,
  },
  outLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  outLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mist,
    flexShrink: 1,
  },
  outOdds: {
    fontSize: 13.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
});
