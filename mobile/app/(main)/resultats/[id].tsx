import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { ArrowLeft, CheckCircle2 } from "@/components/icons";
import { api, type ClientFinishedMatch } from "@/lib/api";
import { getCachedFinishedMatchSnapshot } from "@/lib/entity-cache";
import { formatOdds, formatPlacedAt } from "@/lib/format";
import { TeamAvatar } from "@/components/team-avatar";
import { RealMatchStatsCard } from "@/components/live-match-tracker";
import { BareInfiniteSpinner } from "@/components/infinite-scroll-loader";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page dédiée `/resultats/[id]` fidèle à `src/app/(main)/resultats/[id]/page.tsx`.
 */
export default function ResultDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const matchId = Number(params.id);
  const { oddsFormat } = useApp();

  const [match, setMatch] = useState<ClientFinishedMatch | null>(() =>
    Number.isFinite(matchId) ? getCachedFinishedMatchSnapshot(matchId) : null
  );

  useEffect(() => {
    if (!Number.isFinite(matchId) || matchId <= 0) return;
    let active = true;
    (async () => {
      try {
        const res = await api.finishedMatches(matchId);
        if (!active) return;
        const found =
          res.focusedMatch ??
          res.matches.find((m) => m.id === matchId) ??
          null;
        if (found) setMatch(found);
      } catch {
        // Conserve le snapshot
      }
    })();
    return () => {
      active = false;
    };
  }, [matchId]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {match?.league ?? "Résultat"}
        </Text>
      </View>

      {!match ? (
        <BareInfiniteSpinner visible />
      ) : (
        <>
          <View style={[cardSurface.glassCard, styles.scoreCard]}>
            <View style={styles.teamsRow}>
              <View style={styles.clubCol}>
                <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="md" />
                <Text style={styles.clubName}>{match.homeTeam}</Text>
              </View>

              <View style={styles.scoreCenter}>
                <Text style={styles.ftBadge}>TERMINÉ</Text>
                <Text style={styles.ftScore}>
                  {match.homeScore} - {match.awayScore}
                </Text>
                {typeof match.htHomeScore === "number" &&
                  typeof match.htAwayScore === "number" && (
                    <Text style={styles.htScore}>
                      MT {match.htHomeScore}-{match.htAwayScore}
                    </Text>
                  )}
              </View>

              <View style={styles.clubCol}>
                <TeamAvatar name={match.awayTeam} logo={match.awayLogo} size="md" />
                <Text style={styles.clubName}>{match.awayTeam}</Text>
              </View>
            </View>

            <Text style={styles.finishedAtText}>
              Terminé {formatPlacedAt(match.finishedAt)}
            </Text>
          </View>

          {/* Marchés réglés */}
          <View style={[cardSurface.glassCard, styles.settledCard]}>
            <Text style={styles.sectionTitle}>Marchés réglés</Text>

            <View style={styles.oddsRow}>
              <View
                style={[
                  styles.closingPill,
                  match.winner === "home" && styles.closingPillWon,
                ]}
              >
                <Text style={styles.closingLabel}>1</Text>
                <Text style={styles.closingVal}>
                  {formatOdds(match.oddsHome, oddsFormat)}
                </Text>
              </View>
              {match.oddsDraw !== null && (
                <View
                  style={[
                    styles.closingPill,
                    match.winner === "draw" && styles.closingPillWon,
                  ]}
                >
                  <Text style={styles.closingLabel}>X</Text>
                  <Text style={styles.closingVal}>
                    {formatOdds(match.oddsDraw, oddsFormat)}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.closingPill,
                  match.winner === "away" && styles.closingPillWon,
                ]}
              >
                <Text style={styles.closingLabel}>2</Text>
                <Text style={styles.closingVal}>
                  {formatOdds(match.oddsAway, oddsFormat)}
                </Text>
              </View>
            </View>

            <View style={styles.settledChips}>
              <View style={styles.settledChip}>
                <CheckCircle2 size={13} color={colors.win} strokeWidth={2.4} />
                <Text style={styles.settledChipText}>
                  {match.totalGoals >= 3
                    ? "Plus de 2,5 buts"
                    : "Moins de 2,5 buts"}{" "}
                  ({match.totalGoals})
                </Text>
              </View>
              <View style={styles.settledChip}>
                <CheckCircle2 size={13} color={colors.win} strokeWidth={2.4} />
                <Text style={styles.settledChipText}>
                  BTTS : {match.btts ? "Oui" : "Non"}
                </Text>
              </View>
            </View>
          </View>

          {match.realStats && (
            <RealMatchStatsCard
              stats={match.realStats}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
            />
          )}

          {match.events.length > 0 && (
            <View style={[cardSurface.glassCard, styles.settledCard]}>
              <Text style={styles.sectionTitle}>Faits de match</Text>
              {match.events.map((ev, idx) => (
                <View key={`${ev.min}-${idx}`} style={styles.evRow}>
                  <Text style={styles.evMin}>{ev.min}&apos;</Text>
                  <Text style={styles.evText}>{ev.text}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 11,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
    color: colors.ink,
  },
  scoreCard: {
    padding: 14,
    gap: 8,
  },
  teamsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  clubCol: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  clubName: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
    textAlign: "center",
  },
  scoreCenter: {
    alignItems: "center",
  },
  ftBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.dim,
  },
  ftScore: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  htScore: {
    fontSize: 10.5,
    fontWeight: "600",
    color: colors.dim,
  },
  finishedAtText: {
    textAlign: "center",
    fontSize: 11,
    color: colors.dim,
    fontWeight: "600",
  },
  settledCard: {
    padding: 13,
    gap: 9,
  },
  sectionTitle: {
    fontSize: 13.5,
    fontWeight: "900",
    color: colors.ink,
  },
  oddsRow: {
    flexDirection: "row",
    gap: 7,
  },
  closingPill: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closingPillWon: {
    backgroundColor: "#dcfce7",
    borderWidth: 1,
    borderColor: "rgba(21,128,61,0.35)",
  },
  closingLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.mist,
  },
  closingVal: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.ink,
  },
  settledChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  settledChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#f0fdf4",
  },
  settledChipText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.win,
  },
  evRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  evMin: {
    width: 28,
    fontSize: 11.5,
    fontWeight: "800",
    color: colors.dim,
  },
  evText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "600",
    color: colors.ink,
  },
});
