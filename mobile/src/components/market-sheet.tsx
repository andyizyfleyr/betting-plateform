import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronDown, ChevronUp, Lock, X } from "lucide-react-native";
import { api, type ClientMatch, type MarketGroup, type MarketOutcome } from "@/lib/api";
import { getCachedMatchSnapshot } from "@/lib/entity-cache";
import { formatKickoff, formatOdds } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";
import { TeamAvatar } from "./team-avatar";
import { OddsTrendCorner, oddsTextColor, useOddsTrend } from "./odds-trend-corner";

export const MARKET_CATEGORIES = [
  { key: "all", label: "Tous" },
  { key: "principal", label: "Principaux" },
  { key: "buts", label: "Buts" },
  { key: "mi-temps", label: "Mi-temps" },
  { key: "equipes", label: "Équipes" },
  { key: "handicap", label: "Handicap" },
  { key: "scores", label: "Scores" },
] as const;

export type MarketCategoryKey = (typeof MARKET_CATEGORIES)[number]["key"];

export function sanitizeMarketGroups(groups: MarketGroup[]): MarketGroup[] {
  return groups.map((g) => {
    if (g.key === "correct_score" || g.label.toLowerCase().includes("score exact")) {
      return {
        ...g,
        outcomes: g.outcomes.filter(
          (o) =>
            o.key !== "other" &&
            !o.label.toLowerCase().includes("autre score")
        ),
      };
    }
    return g;
  });
}

function OutcomeButton({
  outcome,
  selected,
  disabled,
  oddsFormat,
  onPress,
  onLongPress,
}: {
  outcome: MarketOutcome;
  selected: boolean;
  disabled: boolean;
  oddsFormat: "decimal" | "fractional";
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
        styles.outcomeBtn,
        selected && styles.outcomeBtnSelected,
        disabled && { opacity: 0.55 },
      ]}
    >
      <OddsTrendCorner trend={trend} selected={selected} />
      <Text
        numberOfLines={2}
        style={[
          styles.outcomeLabel,
          selected && { color: "rgba(255,255,255,0.88)" },
        ]}
      >
        {outcome.shortLabel ?? outcome.label}
      </Text>
      {disabled ? (
        <Lock size={12} color={selected ? colors.white : colors.dim} strokeWidth={2.4} />
      ) : (
        <Text
          style={[
            styles.outcomeOdds,
            { color: oddsTextColor(trend, selected) },
          ]}
        >
          {formatOdds(outcome.odds, oddsFormat)}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Accordéon de marchés réutilisé par `MarketSheet` et par `/matchs/[id]`.
 */
export function MarketGroupAccordion({
  match,
  group,
  defaultOpen = true,
  onAfterSelectSingle,
}: {
  match: ClientMatch;
  group: MarketGroup;
  defaultOpen?: boolean;
  onAfterSelectSingle?: () => void;
}) {
  const {
    oddsFormat,
    comboLegs,
    isInCombo,
    toggleComboLeg,
    openBet,
    hapticsEnabled,
    toast,
  } = useApp();
  const [open, setOpen] = useState(defaultOpen);

  const locked =
    match.status === "finished" ||
    Boolean(match.suspended) ||
    Boolean(group.suspended) ||
    (match.source === "manual" && Boolean(match.kickoffReached) && match.status !== "live");

  const cols = group.outcomes.length === 3 ? 3 : 2;

  const handleTap = (o: MarketOutcome) => {
    if (locked) return;
    if (comboLegs.length >= 1) {
      const res = toggleComboLeg({
        kind: "sport",
        matchId: match.id,
        title: `${match.homeTeam} – ${match.awayTeam}`,
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeLogo: match.homeLogo ?? null,
        awayLogo: match.awayLogo ?? null,
        market: group.key,
        selection: o.key,
        selectionLabel: `${group.label} · ${o.label}`,
        odds: o.odds,
        startsAt: match.startsAt,
        isLive: match.status === "live",
        source: match.source ?? "virtual",
      });
      if (res === "full") {
        toast({ kind: "error", title: "Maximum 8 sélections dans le Betslip" });
      }
      return;
    }

    onAfterSelectSingle?.();
    openBet({
      match,
      market: group.key,
      marketLabel: group.label,
      selection: o.key,
      selectionLabel: `${group.label} · ${o.label}`,
      odds: o.odds,
    });
  };

  const handleLongPress = (o: MarketOutcome) => {
    if (locked) return;
    const res = toggleComboLeg({
      kind: "sport",
      matchId: match.id,
      title: `${match.homeTeam} – ${match.awayTeam}`,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeLogo: match.homeLogo ?? null,
      awayLogo: match.awayLogo ?? null,
      market: group.key,
      selection: o.key,
      selectionLabel: `${group.label} · ${o.label}`,
      odds: o.odds,
      startsAt: match.startsAt,
      isLive: match.status === "live",
      source: match.source ?? "virtual",
    });
    if (res === "added") {
      toast({
        kind: "info",
        title: "Ajouté au Betslip",
        subtitle: `${match.homeTeam} – ${match.awayTeam} · ${o.label}`,
      });
    } else if (res === "full") {
      toast({ kind: "error", title: "Maximum 8 sélections dans le Betslip" });
    }
  };

  return (
    <View style={styles.groupCard}>
      <Pressable
        onPress={() => {
          triggerHaptic("light", hapticsEnabled);
          setOpen((v) => !v);
        }}
        style={styles.groupHeader}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.groupTitle}>{group.label}</Text>
          {group.hint ? <Text style={styles.groupHint}>{group.hint}</Text> : null}
        </View>
        {open ? (
          <ChevronUp size={16} color={colors.dim} strokeWidth={2.4} />
        ) : (
          <ChevronDown size={16} color={colors.dim} strokeWidth={2.4} />
        )}
      </Pressable>

      {open && (
        <View style={styles.outcomesWrap}>
          {group.outcomes.map((o) => (
            <View
              key={o.key}
              style={[
                styles.outcomeCell,
                cols === 3 ? { width: "31.8%" } : { width: "48.6%" },
              ]}
            >
              <OutcomeButton
                outcome={o}
                selected={isInCombo("sport", match.id, group.key, o.key)}
                disabled={locked}
                oddsFormat={oddsFormat}
                onPress={() => handleTap(o)}
                onLongPress={() => handleLongPress(o)}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Feuille modale `MarketSheet` :
 * - Affiche la date/heure à droite dans l'en-tête (aucun bouton Betslip rouge ni mention « Virtuel »)
 * - Affiche les noms complets des clubs sans troncature
 * - Charge tous les marchés via `GET /api/matches/[id]` (~3 Ko Edge-cached).
 */
export function MarketSheet() {
  const { marketMatchId, closeMarkets, dataSaverMode } = useApp();
  const [match, setMatch] = useState<ClientMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [cat, setCat] = useState<MarketCategoryKey>("all");

  useEffect(() => {
    if (!marketMatchId) {
      setMatch(null);
      setCat("all");
      return;
    }
    const cached = getCachedMatchSnapshot(marketMatchId);
    if (cached) setMatch(cached);
  }, [marketMatchId]);

  const loadFullMatch = useCallback(async () => {
    if (!marketMatchId) return;
    if (!match || match.markets.length <= 1) setLoading(true);
    try {
      const res = await api.matchById(marketMatchId);
      setMatch(res.match);
    } catch {
      // Conserve le cache
    } finally {
      setLoading(false);
    }
  }, [marketMatchId, match]);

  useSmartPolling(loadFullMatch, marketMatchId ? 5_000 : null, {
    enabled: Boolean(marketMatchId),
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const cleanGroups = useMemo(
    () => sanitizeMarketGroups(match?.markets ?? []),
    [match?.markets]
  );

  const visibleGroups = useMemo(
    () =>
      cat === "all"
        ? cleanGroups
        : cleanGroups.filter((g) => (g.category ?? "principal") === cat),
    [cat, cleanGroups]
  );

  return (
    <Modal
      visible={Boolean(marketMatchId)}
      transparent
      animationType="slide"
      onRequestClose={closeMarkets}
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={closeMarkets} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {match && (
            <>
              <View style={styles.topBar}>
                <Text numberOfLines={1} style={styles.leagueText}>
                  {match.league}
                </Text>
                <View style={styles.topRight}>
                  <Text style={styles.kickoffText}>
                    {match.status === "live"
                      ? (match.minute ?? "EN DIRECT")
                      : formatKickoff(match.startsAt)}
                  </Text>
                  <Pressable onPress={closeMarkets} style={styles.closeBtn}>
                    <X size={17} color={colors.ink} strokeWidth={2.4} />
                  </Pressable>
                </View>
              </View>

              {/* Clubs complets sans troncature */}
              <View style={styles.teamsCard}>
                <View style={styles.clubLine}>
                  <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="sm" />
                  <Text style={styles.clubName}>{match.homeTeam}</Text>
                  {match.status === "live" && (
                    <Text style={styles.liveScore}>{match.homeScore ?? 0}</Text>
                  )}
                </View>
                <View style={styles.clubLine}>
                  <TeamAvatar name={match.awayTeam} logo={match.awayLogo} size="sm" />
                  <Text style={styles.clubName}>{match.awayTeam}</Text>
                  {match.status === "live" && (
                    <Text style={styles.liveScore}>{match.awayScore ?? 0}</Text>
                  )}
                </View>
              </View>

              {/* Onglets catégories */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.catRow}
                style={{ flexGrow: 0 }}
              >
                {MARKET_CATEGORIES.map((c) => {
                  const active = cat === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() => setCat(c.key)}
                      style={[styles.catChip, active && styles.catChipActive]}
                    >
                      <Text
                        style={[
                          styles.catChipText,
                          active && styles.catChipTextActive,
                        ]}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <ScrollView
                style={styles.scrollBody}
                contentContainerStyle={styles.scrollContent}
              >
                {loading && visibleGroups.length <= 1 && (
                  <View style={{ paddingVertical: 16, alignItems: "center" }}>
                    <ActivityIndicator size="small" color={colors.betclicRed} />
                  </View>
                )}
                {visibleGroups.map((g, idx) => (
                  <MarketGroupAccordion
                    key={g.key}
                    match={match}
                    group={g}
                    defaultOpen={idx < 4}
                    onAfterSelectSingle={closeMarkets}
                  />
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.48)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.deep,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.edge,
    marginBottom: 8,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  leagueText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.mist,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  kickoffText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.ink,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  teamsCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.edge,
    padding: 12,
    gap: 8,
  },
  clubLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  clubName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: colors.ink,
  },
  liveScore: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  catRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 6,
  },
  catChip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  catChipActive: {
    backgroundColor: colors.betclicRed,
    borderColor: colors.betclicRed,
  },
  catChipText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.ink,
  },
  catChipTextActive: {
    color: colors.white,
  },
  scrollBody: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 28,
    gap: 10,
  },
  groupCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.edge,
    padding: 12,
    gap: 10,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  groupTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.ink,
  },
  groupHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.dim,
  },
  outcomesWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 7,
  },
  outcomeCell: {},
  outcomeBtn: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    position: "relative",
    overflow: "hidden",
  },
  outcomeBtnSelected: {
    backgroundColor: colors.betclicRed,
    borderColor: colors.betclicRed,
  },
  outcomeLabel: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.mist,
  },
  outcomeOdds: {
    fontSize: 13,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
});
