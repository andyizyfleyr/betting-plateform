import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "@/lib/router";
import { Activity, ArrowLeft, Lock } from "@/components/icons";
import { api, type ClientMatch } from "@/lib/api";
import { getCachedMatchSnapshot } from "@/lib/entity-cache";
import { formatKickoff } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { TeamAvatar } from "@/components/team-avatar";
import {
  LiveMatchTracker,
  RealMatchStatsCard,
} from "@/components/live-match-tracker";
import {
  MARKET_CATEGORIES,
  MarketGroupAccordion,
  sanitizeMarketGroups,
  type MarketCategoryKey,
} from "@/components/market-sheet";
import { BareInfiniteSpinner } from "@/components/infinite-scroll-loader";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page Match Center dédiée `/matchs/[id]` fidèle à `src/app/(main)/matchs/[id]/page.tsx` :
 * - Hydratation 0 ms depuis `entity-cache` + polling léger `GET /api/matches/[id]` (~3 Ko)
 * - En-tête compact (`[←] Ligue` + badge direct + date/heure)
 * - Scoreboard compact avec noms complets des clubs
 * - Terrain 2D / Stats officielles repliables + tous les marchés sans « Autre score » + Chronologie.
 */
export default function MatchCenterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const matchId = Number(params.id);
  const { dataSaverMode } = useApp();

  const [match, setMatch] = useState<ClientMatch | null>(() =>
    Number.isFinite(matchId) ? getCachedMatchSnapshot(matchId) : null
  );
  const [cat, setCat] = useState<MarketCategoryKey>("all");
  const [showTracker, setShowTracker] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadMatch = useCallback(async () => {
    if (!Number.isFinite(matchId) || matchId <= 0) return;
    try {
      const res = await api.matchById(matchId);
      setMatch(res.match);
    } catch {
      // Conserve le snapshot mémoire
    }
  }, [matchId]);

  useSmartPolling(loadMatch, 5_000, {
    enabled: Number.isFinite(matchId) && matchId > 0,
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

  if (!match) {
    return (
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
          <Text style={styles.leagueTitle}>Match</Text>
        </View>
        <BareInfiniteSpinner visible />
      </View>
    );
  }

  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isReal = match.source === "manual";
  const events = match.events ?? [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadMatch();
            setRefreshing(false);
          }}
          tintColor={colors.betclicRed}
          colors={[colors.betclicRed]}
        />
      }
    >
      {/* En-tête compact */}
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
          <Text numberOfLines={1} style={styles.leagueTitle}>
            {match.league}
          </Text>
        </View>

        <View style={styles.topRight}>
          {isLive ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.livePillText}>
                {match.suspended
                  ? `Suspendu · ${match.minute ?? "LIVE"}`
                  : (match.minute ?? "LIVE")}
              </Text>
            </View>
          ) : (
            <Text style={styles.kickoffText}>
              {formatKickoff(match.startsAt)}
            </Text>
          )}
        </View>
      </View>

      {/* Scoreboard compact avec noms complets */}
      <View style={[cardSurface.glassCard, styles.scoreCard]}>
        <View style={styles.scoreTeamsRow}>
          <View style={styles.clubCol}>
            <TeamAvatar name={match.homeTeam} logo={match.homeLogo} size="md" />
            <Text style={styles.clubFullName}>{match.homeTeam}</Text>
          </View>

          <View style={styles.centerScoreBox}>
            {isLive || isFinished ? (
              <>
                <Text style={[styles.bigScore, isLive && { color: colors.betclicRed }]}>
                  {match.homeScore ?? 0} - {match.awayScore ?? 0}
                </Text>
                {typeof match.htHomeScore === "number" &&
                  typeof match.htAwayScore === "number" && (
                    <Text style={styles.htScore}>
                      MT {match.htHomeScore}-{match.htAwayScore}
                    </Text>
                  )}
              </>
            ) : (
              <Text style={styles.vsLabel}>VS</Text>
            )}
          </View>

          <View style={styles.clubCol}>
            <TeamAvatar name={match.awayTeam} logo={match.awayLogo} size="md" />
            <Text style={styles.clubFullName}>{match.awayTeam}</Text>
          </View>
        </View>

        {isLive && (
          <Pressable
            onPress={() => setShowTracker((v) => !v)}
            style={styles.trackerToggleBtn}
          >
            <Activity size={13} color={colors.ink} strokeWidth={2.3} />
            <Text style={styles.trackerToggleText}>
              {showTracker
                ? "Masquer le direct"
                : isReal
                  ? "Afficher les statistiques"
                  : "Afficher le Terrain 2D"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Terrain 2D virtuel ou statistiques officielles */}
      {isLive && showTracker && !isReal && <LiveMatchTracker match={match} />}
      {isLive && showTracker && isReal && match.realStats && (
        <RealMatchStatsCard
          stats={match.realStats}
          homeTeam={match.homeTeam}
          awayTeam={match.awayTeam}
        />
      )}

      {/* Filtres de catégories de marchés */}
      {!isFinished && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catsRow}
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

          {match.suspended && (
            <View style={styles.suspendedBanner}>
              <Lock size={14} color={colors.amber} strokeWidth={2.4} />
              <Text style={styles.suspendedBannerText}>
                Marchés momentanément suspendus suite à un fait de jeu
              </Text>
            </View>
          )}

          {visibleGroups.length <= 1 && match.marketCount && match.marketCount > 1 ? (
            <BareInfiniteSpinner visible />
          ) : null}

          <View style={{ gap: 10 }}>
            {visibleGroups.map((g, i) => (
              <MarketGroupAccordion
                key={g.key}
                match={match}
                group={g}
                defaultOpen={i < 5}
              />
            ))}
          </View>
        </>
      )}

      {/* Chronologie des faits de match */}
      {events.length > 0 && (
        <View style={[cardSurface.glassCard, styles.eventsCard]}>
          <Text style={styles.eventsTitle}>Chronologie</Text>
          {events.map((ev, idx) => (
            <View key={`${ev.min}-${idx}`} style={styles.eventRow}>
              <Text style={styles.eventMin}>{ev.min}&apos;</Text>
              <View
                style={[
                  styles.eventDot,
                  ev.type === "red"
                    ? { backgroundColor: colors.betclicRed }
                    : { backgroundColor: colors.win },
                ]}
              />
              <Text style={styles.eventText}>{ev.text}</Text>
            </View>
          ))}
        </View>
      )}

      {isFinished && (
        <Pressable
          onPress={() => router.replace(`/resultats/${match.id}`)}
          style={styles.resultBtn}
        >
          <Text style={styles.resultBtnText}>
            Voir le rapport complet du résultat
          </Text>
        </Pressable>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  topLeft: {
    flex: 1,
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
  leagueTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: colors.ink,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.12)",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.betclicRed,
  },
  livePillText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  kickoffText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.mist,
  },
  scoreCard: {
    padding: 13,
    gap: 10,
  },
  scoreTeamsRow: {
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
  clubFullName: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.ink,
    textAlign: "center",
  },
  centerScoreBox: {
    minWidth: 74,
    alignItems: "center",
    justifyContent: "center",
  },
  bigScore: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  htScore: {
    marginTop: 2,
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.dim,
  },
  vsLabel: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.dim,
  },
  trackerToggleBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.elev,
  },
  trackerToggleText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.ink,
  },
  catsRow: {
    gap: 6,
    paddingVertical: 2,
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
  suspendedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.amberSoft,
  },
  suspendedBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: colors.amber,
  },
  eventsCard: {
    padding: 12,
    gap: 8,
  },
  eventsTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.ink,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  eventMin: {
    width: 28,
    fontSize: 11.5,
    fontWeight: "800",
    color: colors.dim,
    fontVariant: ["tabular-nums"],
  },
  eventDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  eventText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "600",
    color: colors.ink,
  },
  resultBtn: {
    height: 44,
    borderRadius: 13,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  resultBtnText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.white,
  },
});
