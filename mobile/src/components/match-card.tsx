import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "@/lib/router";
import { ChevronRight, Lock } from "@/components/icons";
import type { ClientMatch } from "@/lib/api";
import { formatKickoff, formatOdds } from "@/lib/format";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";
import { TeamAvatar } from "./team-avatar";
import { SportIcon } from "./sport-icon";
import { KickoffCountdown } from "./kickoff-countdown";
import {
  OddsTrendCorner,
  oddsTextColor,
  useOddsTrend,
} from "./odds-trend-corner";

function LiveStatusBadge({
  minute,
  suspended,
}: {
  minute: string | null;
  suspended?: boolean;
}) {
  const isHalfTime = minute === "MT" || minute === "HT";

  if (suspended) {
    return (
      <View style={styles.suspendedBadge}>
        <Lock size={10} color={colors.amber} strokeWidth={2.5} />
        <Text style={styles.suspendedText}>Suspendu · {minute ?? "LIVE"}</Text>
      </View>
    );
  }

  if (isHalfTime) {
    return (
      <View style={styles.suspendedBadge}>
        <Text style={styles.suspendedText}>Mi-temps</Text>
      </View>
    );
  }

  return (
    <View style={styles.liveBadge}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>{minute ?? "LIVE"}</Text>
    </View>
  );
}

function OddsPill({
  label,
  odds,
  selected,
  disabled,
  oddsFormat,
  onPress,
  onLongPress,
}: {
  label: string;
  odds: number;
  selected: boolean;
  disabled: boolean;
  oddsFormat: "decimal" | "fractional";
  onPress: () => void;
  onLongPress: () => void;
}) {
  const trend = useOddsTrend(odds);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      disabled={disabled}
      style={[
        styles.oddsBtn,
        selected && styles.oddsBtnSelected,
        disabled && styles.oddsBtnDisabled,
      ]}
    >
      <OddsTrendCorner trend={trend} selected={selected} />
      <Text style={[styles.oddsLabel, selected && styles.oddsLabelSelected]}>
        {label}
      </Text>
      {disabled ? (
        <Lock
          size={12}
          color={selected ? colors.white : colors.dim}
          strokeWidth={2.4}
        />
      ) : (
        <Text
          style={[
            styles.oddsVal,
            { color: oddsTextColor(trend, selected) },
          ]}
        >
          {formatOdds(odds, oddsFormat)}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Carte match mobile identique à `src/components/match-card.tsx` :
 * - Aucun liseré latéral gauche
 * - Aucun badge « Virtuel » à côté de la ligue
 * - Clic sur la carte -> `/matchs/[id]` (ou `/resultats/[id]` si terminé)
 * - Clic court sur cote -> `BetModal` (ou ajout direct au Betslip si ≥ 1 sélection déjà présente)
 * - Appui long sur cote -> bascule la sélection dans le Betslip combiné.
 */
export function MatchCard({
  match,
  nextUp = false,
  width,
}: {
  match: ClientMatch;
  nextUp?: boolean;
  width?: number;
}) {
  const router = useRouter();
  const {
    oddsFormat,
    comboLegs,
    isInCombo,
    toggleComboLeg,
    openBet,
    openMarkets,
    hapticsEnabled,
    toast,
  } = useApp();

  const isReal = match.source === "manual";
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const marketCount = match.marketCount ?? match.markets.length;
  const locked =
    isFinished ||
    Boolean(match.suspended) ||
    (isReal && Boolean(match.kickoffReached) && !isLive);

  const handleOutcomeTap = (
    selection: "home" | "draw" | "away",
    selectionLabel: string,
    odds: number
  ) => {
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
        market: "result",
        selection,
        selectionLabel,
        odds,
        startsAt: match.startsAt,
        isLive,
        source: match.source ?? "virtual",
      });
      if (res === "full") {
        toast({ kind: "error", title: "Maximum 8 sélections dans le Betslip" });
      }
      return;
    }

    openBet({
      match,
      market: "result",
      marketLabel: "Résultat 1X2",
      selection,
      selectionLabel,
      odds,
    });
  };

  const handleOutcomeLongPress = (
    selection: "home" | "draw" | "away",
    selectionLabel: string,
    odds: number
  ) => {
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
      market: "result",
      selection,
      selectionLabel,
      odds,
      startsAt: match.startsAt,
      isLive,
      source: match.source ?? "virtual",
    });
    if (res === "added") {
      toast({
        kind: "info",
        title: "Ajouté au Betslip",
        subtitle: `${match.homeTeam} – ${match.awayTeam} · ${selectionLabel}`,
      });
    } else if (res === "full") {
      toast({ kind: "error", title: "Maximum 8 sélections dans le Betslip" });
    }
  };

  return (
    <Pressable
      onPress={() => {
        triggerHaptic("light", hapticsEnabled);
        if (isFinished) {
          router.push(`/resultats/${match.id}`);
        } else {
          router.push(`/matchs/${match.id}`);
        }
      }}
      style={[
        cardSurface.glassCard,
        styles.card,
        !isFinished && styles.cardMinHeight,
        width ? { width } : null,
      ]}
    >
      {/* En-tête : ligue + statut */}
      <View style={styles.headerRow}>
        <View style={styles.leagueRow}>
          <SportIcon sport={match.sport} size={14} color={colors.dim} />
          <Text numberOfLines={1} style={styles.leagueText}>
            {match.league}
          </Text>
        </View>

        <View style={styles.statusRow}>
          {isLive ? (
            <LiveStatusBadge minute={match.minute} suspended={match.suspended} />
          ) : isFinished ? (
            <View style={styles.finishedPill}>
              <Text style={styles.finishedText}>Terminé</Text>
              <ChevronRight size={12} color={colors.dim} strokeWidth={2.3} />
            </View>
          ) : isReal && match.kickoffReached ? (
            <View style={styles.suspendedBadge}>
              <Lock size={10} color={colors.amber} strokeWidth={2.4} />
              <Text style={styles.suspendedText}>Coup d&apos;envoi atteint</Text>
            </View>
          ) : isReal ? (
            <View style={styles.kickoffPill}>
              <Text style={styles.kickoffText}>
                {formatKickoff(match.startsAt)}
              </Text>
            </View>
          ) : (
            <>
              {nextUp && (
                <View style={styles.nextPill}>
                  <Text style={styles.nextText}>Suivant</Text>
                </View>
              )}
              <KickoffCountdown startsAt={match.startsAt} />
            </>
          )}

          {!isFinished && marketCount > 1 && (
            <Pressable
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation();
                openMarkets(match);
              }}
              style={styles.moreMarketsPill}
            >
              <Text style={styles.moreMarketsText}>+{marketCount - 1}</Text>
              <ChevronRight
                size={11}
                color={colors.betclicRed}
                strokeWidth={2.6}
              />
            </Pressable>
          )}
        </View>
      </View>

      {/* Équipes & scores */}
      <View style={styles.teamsBlock}>
        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="sm" />
            <Text
              numberOfLines={1}
              style={[
                styles.teamName,
                isFinished &&
                  (match.homeScore ?? 0) > (match.awayScore ?? 0) &&
                  styles.teamWinner,
              ]}
            >
              {match.homeTeam}
            </Text>
            {(match.redHome ?? 0) > 0 && (
              <View style={styles.redCardBadge}>
                <Text style={styles.redCardText}>{match.redHome}</Text>
              </View>
            )}
          </View>
          {(isLive || isFinished) && (
            <Text style={[styles.score, isLive && styles.scoreLive]}>
              {match.homeScore ?? 0}
            </Text>
          )}
        </View>

        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar name={match.awayTeam} logo={match.awayLogo} size="sm" />
            <Text
              numberOfLines={1}
              style={[
                styles.teamName,
                isFinished &&
                  (match.awayScore ?? 0) > (match.homeScore ?? 0) &&
                  styles.teamWinner,
              ]}
            >
              {match.awayTeam}
            </Text>
            {(match.redAway ?? 0) > 0 && (
              <View style={styles.redCardBadge}>
                <Text style={styles.redCardText}>{match.redAway}</Text>
              </View>
            )}
          </View>
          {(isLive || isFinished) && (
            <Text style={[styles.score, isLive && styles.scoreLive]}>
              {match.awayScore ?? 0}
            </Text>
          )}
        </View>
      </View>

      {/* Grille de cotes 1 / X / 2 */}
      {!isFinished && (
        <View style={styles.oddsRow}>
          <OddsPill
            label="1"
            odds={match.oddsHome}
            selected={isInCombo("sport", match.id, "result", "home")}
            disabled={locked}
            oddsFormat={oddsFormat}
            onPress={() =>
              handleOutcomeTap("home", match.homeTeam, match.oddsHome)
            }
            onLongPress={() =>
              handleOutcomeLongPress("home", match.homeTeam, match.oddsHome)
            }
          />
          {match.oddsDraw !== null && (
            <OddsPill
              label="X"
              odds={match.oddsDraw}
              selected={isInCombo("sport", match.id, "result", "draw")}
              disabled={locked}
              oddsFormat={oddsFormat}
              onPress={() =>
                handleOutcomeTap("draw", "Match nul", match.oddsDraw ?? 3.1)
              }
              onLongPress={() =>
                handleOutcomeLongPress(
                  "draw",
                  "Match nul",
                  match.oddsDraw ?? 3.1
                )
              }
            />
          )}
          <OddsPill
            label="2"
            odds={match.oddsAway}
            selected={isInCombo("sport", match.id, "result", "away")}
            disabled={locked}
            oddsFormat={oddsFormat}
            onPress={() =>
              handleOutcomeTap("away", match.awayTeam, match.oddsAway)
            }
            onLongPress={() =>
              handleOutcomeLongPress("away", match.awayTeam, match.oddsAway)
            }
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 15,
    justifyContent: "space-between",
  },
  cardMinHeight: {
    minHeight: 192,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leagueRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  leagueText: {
    flexShrink: 1,
    fontSize: 11.5,
    fontWeight: "600",
    color: colors.mist,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.12)",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.betclicRed,
  },
  liveText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: colors.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  suspendedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.amberSoft,
  },
  suspendedText: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.amber,
  },
  finishedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: colors.elev,
  },
  finishedText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.dim,
  },
  kickoffPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.elev,
  },
  kickoffText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.ink,
  },
  nextPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(17, 24, 39, 0.08)",
  },
  nextText: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.ink,
  },
  moreMarketsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.elev,
  },
  moreMarketsText: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.ink,
  },
  teamsBlock: {
    marginTop: 13,
    gap: 9,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  teamName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
  },
  teamWinner: {
    fontWeight: "900",
  },
  redCardBadge: {
    minWidth: 14,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: 3,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  redCardText: {
    fontSize: 9.5,
    fontWeight: "900",
    color: colors.white,
  },
  score: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  scoreLive: {
    color: colors.betclicRed,
  },
  oddsRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  oddsBtn: {
    flex: 1,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  oddsBtnSelected: {
    backgroundColor: colors.betclicRed,
    borderColor: colors.betclicRed,
  },
  oddsBtnDisabled: {
    opacity: 0.55,
  },
  oddsLabel: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.dim,
  },
  oddsLabelSelected: {
    color: "rgba(255,255,255,0.85)",
  },
  oddsVal: {
    fontSize: 13.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
});
