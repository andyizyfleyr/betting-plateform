import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Check, ChevronRight, Clock, Lock } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import type { ClientMatch } from "@/lib/api";
import { formatOdds } from "@/lib/format";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";
import { KickoffCountdown } from "./kickoff-countdown";
import {
  OddsTrendCorner,
  oddsTrendTextColor,
  useOddsTrend,
} from "./odds-trend-corner";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";

function OddsCell({
  shortLabel,
  odds,
  oddsFormat,
  inCombo,
  onPress,
  onLongPress,
}: {
  shortLabel: string;
  odds: number;
  oddsFormat: "decimal" | "fractional";
  inCombo: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const trend = useOddsTrend(odds);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[
        styles.oddsBtn,
        inCombo
          ? styles.oddsBtnCombo
          : trend === "up"
            ? styles.oddsBtnUp
            : trend === "down"
              ? styles.oddsBtnDown
              : styles.oddsBtnIdle,
      ]}
    >
      <OddsTrendCorner trend={trend} inverted={inCombo} />
      <View style={styles.oddsLeft}>
        {inCombo ? (
          <Check size={12} color="#ffffff" strokeWidth={3} />
        ) : null}
        <Text
          style={[
            styles.oddsLabel,
            inCombo && { color: "rgba(255,255,255,0.85)" },
          ]}
        >
          {shortLabel}
        </Text>
      </View>
      <Text
        style={[
          styles.oddsVal,
          { color: oddsTrendTextColor(trend, inCombo) },
        ]}
      >
        {formatOdds(odds, oddsFormat)}
      </Text>
    </Pressable>
  );
}

export function MatchCard({
  match,
  width,
}: {
  match: ClientMatch;
  width?: number;
}) {
  const router = useRouter();
  const {
    openBet,
    openMarkets,
    oddsFormat,
    toggleComboLeg,
    isInCombo,
    comboQuickMode,
    toast,
  } = useApp();

  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isPostGameVerifying =
    match.source === "manual" &&
    isLive &&
    Boolean(match.suspended) &&
    match.minute === "Fin · Vérif.";

  const resultMarket = match.markets.find((g) => g.key === "result");
  const outcomes =
    resultMarket?.outcomes ?? [
      {
        key: "home",
        label: match.homeTeam,
        short: "V1",
        odds: match.oddsHome,
      },
      ...(match.oddsDraw
        ? [{ key: "draw", label: "Match nul", short: "X", odds: match.oddsDraw }]
        : []),
      {
        key: "away",
        label: match.awayTeam,
        short: "V2",
        odds: match.oddsAway,
      },
    ];

  const totalMarkets = match.marketCount ?? Math.max(18, match.markets.length);
  const extraMarkets = Math.max(0, totalMarkets - 1);
  const uid = `sport-${match.id}`;
  const redHome = match.redHome ?? 0;
  const redAway = match.redAway ?? 0;

  const recentGoals = useMemo(
    () =>
      sanitizeMatchEvents(match.events, match.homeScore, match.awayScore)
        .filter((e) => e.type === "goal")
        .slice(-3),
    [match.events, match.homeScore, match.awayScore]
  );

  const handleToggleCombo = (o: {
    key: string;
    label: string;
    short?: string;
    odds: number;
  }) => {
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
      market: "result",
      selection: o.key,
      selectionLabel: `${o.short ?? o.label} · ${o.label}`,
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
          "Impossible de combiner un match officiel et un match virtuel sur le même ticket.",
      });
    }
  };

  const detailHref = isFinished
    ? `/resultats/${match.id}`
    : `/matchs/${match.id}`;

  return (
    <View style={[styles.card, width ? { width } : null]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.push(detailHref)}
          style={styles.leaguePress}
        >
          <SportIcon sport={match.sport} size={14} color={COLORS.dim} />
          <Text numberOfLines={1} style={styles.leagueText}>
            {match.league}
          </Text>
        </Pressable>

        <View style={styles.headerRight}>
          {isPostGameVerifying ? (
            <View style={styles.verifyPill}>
              <Clock size={11} color={COLORS.amber} strokeWidth={2.3} />
              <Text style={styles.verifyText}>Fin · Vérif.</Text>
            </View>
          ) : isLive ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{match.minute ?? "LIVE"}</Text>
            </View>
          ) : isFinished ? (
            <View style={styles.finPill}>
              <Text style={styles.finText}>Terminé</Text>
            </View>
          ) : (
            <KickoffCountdown startsAt={match.startsAt} />
          )}

          {!isFinished && extraMarkets > 0 ? (
            <Pressable
              onPress={() => {
                if (match.markets.length > 1) {
                  openMarkets(match);
                } else {
                  router.push(`/matchs/${match.id}`);
                }
              }}
              style={styles.moreMarketsBtn}
            >
              <Text style={styles.moreMarketsText}>+{extraMarkets}</Text>
              <ChevronRight size={12} color={COLORS.mist} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <Pressable
        onPress={() => router.push(detailHref)}
        style={styles.teamsBlock}
      >
        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar
              name={match.homeTeam}
              logo={match.homeLogo}
              size="sm"
            />
            <Text numberOfLines={1} style={styles.teamName}>
              {match.homeTeam}
            </Text>
            {redHome > 0 ? (
              <View style={styles.redCardBadge}>
                <Text style={styles.redCardText}>{redHome}</Text>
              </View>
            ) : null}
          </View>
          {(isLive || isFinished) && match.homeScore !== null ? (
            <Text
              style={[
                styles.scoreNum,
                isLive ? { color: COLORS.ink } : { color: COLORS.mist },
              ]}
            >
              {match.homeScore}
            </Text>
          ) : null}
        </View>

        <View style={styles.teamRow}>
          <View style={styles.teamLeft}>
            <TeamAvatar
              name={match.awayTeam}
              logo={match.awayLogo}
              size="sm"
            />
            <Text numberOfLines={1} style={styles.teamName}>
              {match.awayTeam}
            </Text>
            {redAway > 0 ? (
              <View style={styles.redCardBadge}>
                <Text style={styles.redCardText}>{redAway}</Text>
              </View>
            ) : null}
          </View>
          {(isLive || isFinished) && match.awayScore !== null ? (
            <Text
              style={[
                styles.scoreNum,
                isLive ? { color: COLORS.ink } : { color: COLORS.mist },
              ]}
            >
              {match.awayScore}
            </Text>
          ) : null}
        </View>

        {isLive && recentGoals.length > 0 ? (
          <Text numberOfLines={1} style={styles.goalsSummary}>
            ⚽{" "}
            {recentGoals
              .map(
                (g) => `${g.minute}'${g.player ? ` ${g.player}` : ""}`
              )
              .join(" · ")}
          </Text>
        ) : null}
      </Pressable>

      <View style={styles.bottomArea}>
        {isPostGameVerifying ? (
          <View style={styles.verifyBanner}>
            <Clock size={13} color={COLORS.amber} strokeWidth={2.2} />
            <Text numberOfLines={1} style={styles.verifyBannerText}>
              Fin du match · vérification du score officiel…
            </Text>
          </View>
        ) : match.suspended ? (
          <View style={styles.suspendedBanner}>
            <Lock size={13} color={COLORS.dim} strokeWidth={2.2} />
            <Text style={styles.suspendedText}>Marchés suspendus</Text>
          </View>
        ) : isFinished ? (
          <View style={styles.suspendedBanner}>
            <Text style={styles.suspendedText}>Marché clôturé</Text>
          </View>
        ) : (
          <View style={styles.oddsGrid}>
            {outcomes.map((o) => {
              const shortLabel = o.short ?? o.shortLabel ?? o.label;
              const selected = isInCombo(uid, "result", o.key);
              return (
                <OddsCell
                  key={o.key}
                  shortLabel={shortLabel}
                  odds={o.odds}
                  oddsFormat={oddsFormat}
                  inCombo={selected}
                  onPress={() => {
                    if (comboQuickMode) {
                      handleToggleCombo(o);
                    } else {
                      openBet({
                        match,
                        selection: o.key,
                        odds: o.odds,
                        label: o.label,
                        market: "result",
                        marketLabel: resultMarket?.label ?? "Résultat 1X2",
                      });
                    }
                  }}
                  onLongPress={() => handleToggleCombo(o)}
                />
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 194,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 15,
    justifyContent: "space-between",
    gap: 11,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leaguePress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  leagueText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mist,
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 8,
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
    fontWeight: "800",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  verifyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.amberSoft,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  verifyText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.amber,
  },
  finPill: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  finText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
  },
  moreMarketsBtn: {
    height: 22,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingLeft: 7,
    paddingRight: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  moreMarketsText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
  teamsBlock: {
    gap: 8,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
    minWidth: 0,
  },
  teamName: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.ink,
    flexShrink: 1,
  },
  redCardBadge: {
    minWidth: 14,
    height: 16,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 3.5,
    alignItems: "center",
    justifyContent: "center",
  },
  redCardText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  scoreNum: {
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    minWidth: 20,
    textAlign: "right",
  },
  goalsSummary: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.dim,
    marginTop: 1,
  },
  bottomArea: {
    marginTop: 2,
  },
  oddsGrid: {
    flexDirection: "row",
    gap: 7,
  },
  oddsBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  oddsBtnIdle: {
    backgroundColor: COLORS.elev,
  },
  oddsBtnUp: {
    backgroundColor: "rgba(21, 128, 61, 0.09)",
  },
  oddsBtnDown: {
    backgroundColor: "rgba(225, 0, 20, 0.08)",
  },
  oddsBtnCombo: {
    backgroundColor: COLORS.outerSpace,
  },
  oddsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  oddsLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.dim,
  },
  oddsVal: {
    fontSize: 13.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  suspendedBanner: {
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  suspendedText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
  },
  verifyBanner: {
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.amberSoft,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  verifyBannerText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.amber,
  },
});
