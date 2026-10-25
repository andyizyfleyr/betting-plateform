import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { matches, type MatchRow } from "@/db/schema";
import { extractMatchTimelineStats, hasVerifiedGoalTimeline } from "@/db/fixtures";
import { ensureSeeded } from "@/db/seed";
import { computeMatchTelemetry } from "@/lib/live-telemetry";
import { ensureMlLoaded } from "@/lib/ml-engine";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";
import { settlePendingCombos } from "@/lib/combo";
import type { ClientMatchHistoryItem } from "@/lib/api";

export const dynamic = "force-dynamic";

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  return v.toISOString();
}

function mapHistoryItem(m: MatchRow): ClientMatchHistoryItem {
  const isReal = m.source === "manual";
  const hasScore = m.homeScore != null && m.awayScore != null;
  const h = m.homeScore ?? 0;
  const a = m.awayScore ?? 0;

  // Sur un match réel, la mi-temps est affichée dès que le score MT officiel (`htHomeScore`/`htAwayScore`)
  // ou la chronologie complète des buts est connue (jamais d'estimation pseudo-aléatoire).
  const hasExplicitHt =
    isReal && m.htHomeScore != null && m.htAwayScore != null;
  const canComputeHt =
    hasScore &&
    (!isReal ||
      hasExplicitHt ||
      hasVerifiedGoalTimeline(h, a, m.events, m.htHomeScore, m.htAwayScore));

  const timelineStats =
    canComputeHt && !hasExplicitHt
      ? extractMatchTimelineStats(h, a, m.events, m.id)
      : null;

  const htHome = hasExplicitHt ? m.htHomeScore! : (timelineStats?.htHome ?? null);
  const htAway = hasExplicitHt ? m.htAwayScore! : (timelineStats?.htAway ?? null);

  const winnerCode: "V1" | "X" | "V2" | null = !hasScore
    ? null
    : h > a
      ? "V1"
      : h === a
        ? "X"
        : "V2";

  const htWinnerCode: "V1" | "X" | "V2" | null =
    htHome == null || htAway == null
      ? null
      : htHome > htAway
        ? "V1"
        : htHome === htAway
          ? "X"
          : "V2";

  // La télémétrie simulée est réservée aux matchs virtuels ; les matchs réels exposent `realStats`
  const telemetry =
    !isReal && (m.status === "finished" || m.status === "live")
      ? computeMatchTelemetry(m)
      : undefined;

  return {
    id: m.id,
    sport: m.sport,
    league: m.league,
    source: isReal ? "manual" : "virtual",
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: teamLogo(m.homeTeam, m.homeLogo),
    awayLogo: teamLogo(m.awayTeam, m.awayLogo),
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    htHome,
    htAway,
    status: m.status === "live" || m.status === "finished" ? m.status : "upcoming",
    minute: m.minute,
    startsAt: toIso(m.startsAt) ?? new Date().toISOString(),
    finishedAt: toIso(m.finishedAt),
    oddsHome: m.oddsHome,
    oddsDraw: m.oddsDraw,
    oddsAway: m.oddsAway,
    redHome: m.redHome ?? 0,
    redAway: m.redAway ?? 0,
    events: m.events ?? [],
    telemetry,
    realStats: isReal ? (m.realStats ?? null) : null,
    winnerCode,
    htWinnerCode,
    totalGoals: hasScore ? h + a : null,
    btts: hasScore ? h > 0 && a > 0 : null,
  };
}

export async function GET(req: NextRequest) {
  await ensureSeeded();
  await ensureMlLoaded();
  await syncLiveMatchesThrottled();
  await settlePendingCombos();

  const matchIdParam = req.nextUrl.searchParams.get("matchId");
  const requestedMatchId = matchIdParam ? Number(matchIdParam) : NaN;

  // Quotas séparés pour que les matchs virtuels (toutes les 2-3 min) n'effacent jamais l'historique réel
  const [manualFinished, virtualFinished] = await Promise.all([
    db
      .select()
      .from(matches)
      .where(and(eq(matches.status, "finished"), eq(matches.source, "manual")))
      .orderBy(desc(matches.finishedAt), desc(matches.id))
      .limit(120),
    db
      .select()
      .from(matches)
      .where(and(eq(matches.status, "finished"), ne(matches.source, "manual")))
      .orderBy(desc(matches.finishedAt), desc(matches.id))
      .limit(120),
  ]);

  const sortedFinished = [...manualFinished, ...virtualFinished].sort((a, b) => {
    const ta = a.finishedAt ? a.finishedAt.getTime() : a.startsAt.getTime();
    const tb = b.finishedAt ? b.finishedAt.getTime() : b.startsAt.getTime();
    return tb - ta || b.id - a.id;
  });

  const mapped = sortedFinished.map(mapHistoryItem);

  let focusedMatch: ClientMatchHistoryItem | null = null;
  if (Number.isInteger(requestedMatchId) && requestedMatchId > 0) {
    focusedMatch = mapped.find((m) => m.id === requestedMatchId) ?? null;
    if (!focusedMatch) {
      const [row] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, requestedMatchId))
        .limit(1);
      if (row) {
        focusedMatch = mapHistoryItem(row);
      }
    }
  }

  return NextResponse.json({
    matches: mapped,
    focusedMatch,
  });
}
