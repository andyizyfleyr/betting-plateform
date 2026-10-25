import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, type MatchRow } from "@/db/schema";
import { extractMatchTimelineStats } from "@/db/fixtures";
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
  const hasScore = m.homeScore != null && m.awayScore != null;
  const h = m.homeScore ?? 0;
  const a = m.awayScore ?? 0;

  const stats = hasScore
    ? extractMatchTimelineStats(h, a, m.events, m.id)
    : null;

  const winnerCode: "V1" | "X" | "V2" | null = !hasScore
    ? null
    : h > a
      ? "V1"
      : h === a
        ? "X"
        : "V2";

  const htWinnerCode: "V1" | "X" | "V2" | null = !stats
    ? null
    : stats.htHome > stats.htAway
      ? "V1"
      : stats.htHome === stats.htAway
        ? "X"
        : "V2";

  const telemetry =
    m.status === "finished" || m.status === "live"
      ? computeMatchTelemetry(m)
      : undefined;

  return {
    id: m.id,
    sport: m.sport,
    league: m.league,
    source: (m.source === "manual" ? "manual" : "virtual") as "virtual" | "manual",
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: teamLogo(m.homeTeam) || m.homeLogo,
    awayLogo: teamLogo(m.awayTeam) || m.awayLogo,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    htHome: stats ? stats.htHome : null,
    htAway: stats ? stats.htAway : null,
    status: (m.status === "live" || m.status === "finished" ? m.status : "upcoming"),
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

  const finishedRows = await db
    .select()
    .from(matches)
    .where(eq(matches.status, "finished"))
    .orderBy(desc(matches.finishedAt), desc(matches.id))
    .limit(150);

  const sortedFinished = [...finishedRows].sort((a, b) => {
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
