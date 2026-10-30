import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, type MatchRow } from "@/db/schema";
import { sharesVirtualTeam, virtualPairKey, VIRTUAL_REMATCH_GAP_MS, VIRTUAL_MAX_LIVE } from "@/lib/virtual-fixtures";

// Le verrou transactionnel est partagé entre instances et utilisé par la création et le lancement.
export const VIRTUAL_SCHEDULE_LOCK = 781239401;
export async function claimVirtualKickoff(m: MatchRow, startMs: number, now: number): Promise<MatchRow | null> {
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${VIRTUAL_SCHEDULE_LOCK})`);
    const [current] = await tx.select().from(matches).where(eq(matches.id, m.id)).for("update");
    if (!current || current.source !== "virtual" || current.status !== "upcoming") return null;
    const conflictRows = await tx.select().from(matches).where(sql`${matches.source} = 'virtual' AND (${matches.status} = 'live' OR (${matches.status} = 'finished' AND COALESCE(${matches.finishedAt}, ${matches.startsAt} + interval '608 seconds') >= ${new Date(now - VIRTUAL_REMATCH_GAP_MS - 15 * 60_000)}))`);
    if (conflictRows.filter(row => row.status === "live").length >= VIRTUAL_MAX_LIVE) return null;
    const candidate = { home: current.homeTeam, away: current.awayTeam };
    for (const other of conflictRows) {
      if (other.status === "live" && sharesVirtualTeam(candidate, { home: other.homeTeam, away: other.awayTeam })) return null;
      const finishedAt = other.finishedAt?.getTime() ?? other.startsAt.getTime() + 608_000;
      if (other.status === "finished" && virtualPairKey(current.homeTeam, current.awayTeam) === virtualPairKey(other.homeTeam, other.awayTeam) && startMs < finishedAt + VIRTUAL_REMATCH_GAP_MS) return null;
    }
    await tx.update(matches).set({ status: "live", startsAt: new Date(startMs), homeScore: current.homeScore ?? 0, awayScore: current.awayScore ?? 0, minute: "1'" }).where(and(eq(matches.id, m.id), eq(matches.status, "upcoming")));
    return current;
  });
}
