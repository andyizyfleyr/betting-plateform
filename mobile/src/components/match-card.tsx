import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Lock } from "lucide-react-native";
import { useApp, type ComboSelection } from "@/context/app-context";
import type { ClientMatch, ClientMatchEvent } from "@/lib/api";
import type { LiveClockSource } from "@/lib/live-clock";
import { formatKickoff, formatOdds } from "@/lib/format";
import { formatGoalSummaryStrings } from "@/lib/match-events";
import { useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";
import { KickoffCountdown } from "./kickoff-countdown";
import { useLiveMatchClock } from "./live-match-clock";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "./odds-trend-corner";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";

export function LiveStatusBadge({
  minute,
  suspended,
  match,
}: {
  minute: string | null | undefined;
  suspended?: boolean;
  match?: LiveClockSource | null;
}) {
  const clockLabel = useLiveMatchClock(match, minute, "badge");
  const isHalfTime =
    clockLabel === "Mi-temps" || clockLabel === "MT" || clockLabel === "HT";

  if (suspended) {
    return (
      <View style={styles.suspendedPill}>
        <Lock size={10} color="#b45309" strokeWidth={2.5} />
        <Text style={[styles.suspendedText, { fontVariant: ["tabular-nums"] }]}>
          Suspendu · {clockLabel || "LIVE"}
        </Text>
      </View>
    );
  }

  if (isHalfTime) {
    return (
      <View style={styles.suspendedPill}>
        <Text style={styles.suspendedText}>Mi-temps</Text>
      </View>
    );
  }

  return (
    <View style={styles.livePill}>
      <View style={styles.liveDot} />
      <Text style={[styles.liveText, { fontVariant: ["tabular-nums"] }]}>
        {clockLabel || "LIVE"}
      </Text>
    </View>
  );
}

export function formatGoalSummary(
  events?: ClientMatchEvent[],
  homeScore?: number | null,
  awayScore?: number | null
): {
  homeGoals: string[];
  awayGoals: string[];
} {
  return formatGoalSummaryStrings(events, homeScore, awayScore);
}

function OddsCell({
  tag,
  odds,
  suspended,
  selected,
  inCombo,
  comboSelection,
  onPick,
}: {
  tag: string;
  odds: number;
  suspended: boolean;
  selected?: boolean;
  inCombo?: boolean;
  comboSelection: ComboSelection;
  onPick: () => void;
}) {
  const { oddsFormat, toggleComboLeg, toast, hapticsEnabled } = useApp();
  const trend = useOddsTrend(odds);
  const active = Boolean(selected || inCombo);

  const handleLongPress = () => {
    if (suspended) return;
    triggerHaptic("medium", hapticsEnabled);
    const res = toggleComboLeg(comboSelection);
    if (res === "full") {
      toast({
        kind: "error",
        title: "Betslip complet (8 sélections max)",
      });
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
        styles.oddsBtn,
        selected
          ? styles.oddsBtnSelected
          : inCombo
            ? styles.oddsBtnCombo
            : styles.oddsBtnIdle,
        pressed && !suspended && { opacity: 0.85 },
        suspended && { opacity: 0.5 },
      ]}
    >
      {!suspended ? (
        <OddsTrendCorner trend={trend} inverted={active} />
      ) : null}
      <Text
        style={[
          styles.oddsTag,
          active ? { color: "rgba(255,255,255,0.85)" } : { color: COLORS.dim },
        ]}
      >
        {tag}
      </Text>
      {suspended ? (
        <Lock size={14} color={COLORS.dim} strokeWidth={2.3} />
      ) : (
        <Text
          style={[
            styles.oddsVal,
            { color: oddsTrendTextColor(trend, active) },
          ]}
        >
          {formatOdds(odds, oddsFormat)}
        </Text>
      )}
    </Pressable>
  );
}

export function ResultOdds({ match }: { match: ClientMatch }) {
  const { openBet, target, isInCombo, comboQuickMode, toggleComboLeg, toast } =
    useApp();
  const comboUid = `sport-${match.id}`;

  const resGroup = match.markets?.find((g) => g.key === "result");
  const openKeys = resGroup
    ? new Set(resGroup.outcomes.map((o) => o.key))
    : null;

  const cells: Array<{
    key: string;
    tag: string;
    odds: number;
    label: string;
    closed: boolean;
  }> = [
    {
      key: "home",
      tag: "V1",
      odds: match.oddsHome,
      label: `V1 (${match.homeTeam})`,
      closed: openKeys ? !openKeys.has("home") : false,
    },
    ...(match.oddsDraw != null
      ? [
          {
            key: "draw",
            tag: "X",
            odds: match.oddsDraw,
            label: "X (Match nul)",
            closed: openKeys ? !openKeys.has("draw") : false,
          },
        ]
      : []),
    {
      key: "away",
      tag: "V2",
      odds: match.oddsAway,
      label: `V2 (${match.awayTeam})`,
      closed: openKeys ? !openKeys.has("away") : false,
    },
  ];

  return (
    <View style={styles.oddsGrid}>
      {cells.map((c) => {
        const isSelected =
          target?.match.id === match.id &&
          target?.market === "result" &&
          target?.selection === c.key;
        const inCombo = isInCombo(comboUid, "result", c.key);
        const locked = Boolean(match.suspended || c.closed);

        const comboSel: ComboSelection = {
          uid: comboUid,
          kind: "sport",
          matchId: match.id,
          matchSource: match.source,
          title: `${match.homeTeam} – ${match.awayTeam}`,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeLogo: match.homeLogo ?? null,
          awayLogo: match.awayLogo ?? null,
          league: match.league,
          market: "result",
          selection: c.key,
          selectionLabel: c.label,
          odds: c.odds,
          startsAt: match.startsAt,
          isLive: match.status === "live",
        };

        return (
          <View key={c.key} style={styles.oddsCellWrap}>
            <OddsCell
              tag={c.tag}
              odds={c.odds}
              suspended={locked}
              selected={isSelected}
              inCombo={inCombo}
              comboSelection={comboSel}
              onPick={() => {
                if (comboQuickMode) {
                  const res = toggleComboLeg(comboSel);
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
                  selection: c.key,
                  odds: c.odds,
                  label: c.label,
                  market: "result",
                  marketLabel: "1x2",
                });
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

function TeamRow({
  name,
  logo,
  score,
  redCards,
  winner,
  isLive,
}: {
  name: string;
  logo?: string | null;
  score: number | null;
  redCards: number;
  winner: boolean;
  isLive: boolean;
}) {
  const isFinished = score != null && !isLive;
  return (
    <View style={styles.teamRow}>
      <TeamAvatar name={name} logo={logo} size="sm" />
      <Text
        numberOfLines={1}
        style={[
          styles.teamName,
          isFinished && !winner ? { color: COLORS.mist } : { color: COLORS.ink },
        ]}
      >
        {name}
      </Text>

      {redCards > 0 ? (
        <View style={styles.redCardsRow}>
          {Array.from({ length: redCards }).map((_, i) => (
            <View key={i} style={styles.redCardRect} />
          ))}
        </View>
      ) : null}

      {score != null ? (
        <View
          style={[
            styles.scoreBox,
            isLive
              ? styles.scoreBoxLive
              : isFinished && winner
                ? styles.scoreBoxWinner
                : null,
          ]}
        >
          <Text
            style={[
              styles.scoreText,
              isLive
                ? { color: COLORS.betclicRed }
                : isFinished && winner
                  ? { color: COLORS.ink }
                  : { color: COLORS.mist },
            ]}
          >
            {score}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MatchCardInner({
  match,
  nextUp,
  width,
}: {
  match: ClientMatch;
  nextUp?: boolean;
  width?: number;
}) {
  const router = useRouter();
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isReal = match.source === "manual";
  const marketCount = match.marketCount ?? match.markets?.length ?? 0;

  const navigateDetail = () => {
    if (isFinished) {
      router.push(`/resultats/${match.id}`);
    } else {
      router.push(`/matchs/${match.id}`);
    }
  };

  return (
    <View
      style={[
        styles.card,
        !isFinished && styles.cardActiveMinHeight,
        width ? { width } : null,
      ]}
    >
      <Pressable
        onPress={navigateDetail}
        style={({ pressed }) => [pressed && { opacity: 0.82 }]}
      >
        {/* En-tête : ligue + statut + compteur marchés */}
        <View style={styles.headerRow}>
          <View style={styles.leagueRow}>
            <SportIcon sport={match.sport} size={16} color={COLORS.dim} />
            <Text numberOfLines={1} style={styles.leagueText}>
              {match.league}
            </Text>
          </View>

          <View style={styles.headerRight}>
            {isLive ? (
              <LiveStatusBadge
                match={match}
                minute={match.minute}
                suspended={match.suspended}
              />
            ) : isFinished ? (
              <View style={styles.finishedPill}>
                <Text style={styles.finishedText}>Terminé</Text>
                <ChevronRight size={12} color={COLORS.dim} strokeWidth={2.3} />
              </View>
            ) : isReal && match.kickoffReached ? (
              <View style={styles.suspendedPill}>
                <Lock size={10} color="#b45309" strokeWidth={2.4} />
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
                {nextUp ? (
                  <View style={styles.nextUpPill}>
                    <Text style={styles.nextUpText}>Suivant</Text>
                  </View>
                ) : null}
                <KickoffCountdown startsAt={match.startsAt} />
              </>
            )}

            {!isFinished && marketCount > 1 ? (
              <View style={styles.marketCountPill}>
                <Text style={styles.marketCountText}>+{marketCount - 1}</Text>
                <ChevronRight
                  size={10}
                  color={COLORS.betclicRed}
                  strokeWidth={2.6}
                />
              </View>
            ) : null}
          </View>
        </View>

        {/* Équipes & scores */}
        <View style={styles.teamsBlock}>
          <TeamRow
            name={match.homeTeam}
            logo={match.homeLogo}
            score={match.homeScore}
            redCards={match.redHome ?? 0}
            winner={
              isFinished && (match.homeScore ?? 0) > (match.awayScore ?? 0)
            }
            isLive={isLive}
          />
          <TeamRow
            name={match.awayTeam}
            logo={match.awayLogo}
            score={match.awayScore}
            redCards={match.redAway ?? 0}
            winner={
              isFinished && (match.awayScore ?? 0) > (match.homeScore ?? 0)
            }
            isLive={isLive}
          />
        </View>
      </Pressable>

      {/* Cotes 1X2 (V1 / X / V2) */}
      {!isFinished ? (
        <View style={styles.oddsWrap}>
          <ResultOdds match={match} />
        </View>
      ) : null}
    </View>
  );
}

export const MatchCard = memo(MatchCardInner);

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 16,
    justifyContent: "space-between",
    shadowColor: "#111827",
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardActiveMinHeight: {
    minHeight: 194,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leagueRow: {
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
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.12)",
    paddingHorizontal: 9,
    paddingVertical: 2.5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
  },
  liveText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  suspendedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  suspendedText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#b45309",
  },
  finishedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  finishedText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.dim,
  },
  kickoffPill: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  kickoffText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.ink,
  },
  nextUpPill: {
    borderRadius: 999,
    backgroundColor: "rgba(17, 24, 39, 0.08)",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  nextUpText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.ink,
  },
  marketCountPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
  },
  marketCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  teamsBlock: {
    marginTop: 14,
    gap: 10,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  teamName: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: "600",
    lineHeight: 19,
  },
  redCardsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  redCardRect: {
    width: 8,
    height: 12,
    borderRadius: 2,
    backgroundColor: COLORS.betclicRed,
  },
  scoreBox: {
    minWidth: 24,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreBoxLive: {
    backgroundColor: "rgba(225, 0, 20, 0.10)",
  },
  scoreBoxWinner: {
    backgroundColor: COLORS.elev,
  },
  scoreText: {
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  oddsWrap: {
    marginTop: "auto",
    paddingTop: 14,
  },
  oddsGrid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  oddsCellWrap: {
    flex: 1,
  },
  oddsBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  oddsBtnIdle: {
    backgroundColor: "rgba(238, 240, 244, 0.75)",
    borderColor: COLORS.edge,
  },
  oddsBtnSelected: {
    backgroundColor: COLORS.betclicRed,
    borderColor: COLORS.betclicRed,
  },
  oddsBtnCombo: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  oddsTag: {
    fontSize: 11,
    fontWeight: "700",
  },
  oddsVal: {
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
