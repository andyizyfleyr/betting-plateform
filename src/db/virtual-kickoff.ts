import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { virtualTeamAliases } from "@/lib/team-logos";
import { matches, type MatchRow } from "@/db/schema";
import { sharesVirtualTeam, virtualPairKey, VIRTUAL_REMATCH_GAP_MS, VIRTUAL_MAX_LIVE, VIRTUAL_KICKOFF_GAP_MS } from "@/lib/virtual-fixtures";

// Le verrou transactionnel est partagé entre instances et utilisé par la création et le lancement.
export const VIRTUAL_SCHEDULE_LOCK = 781239401;
export interface ClaimVirtualKickoffOptions {
  /** Autorise l’avance d’un match planifié dans quelques minutes pour remplir un canal libre. */
  allowEarly?: boolean;
  /** Ignore l’espacement global des coups d’envoi ; le plafond de 4 directs reste actif. */
  ignoreRecentGap?: boolean;
}
export async function claimVirtualKickoff(
  m: MatchRow,
  now: number,
  options?: ClaimVirtualKickoffOptions
): Promise<MatchRow | null> {
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${VIRTUAL_SCHEDULE_LOCK})`);
    const [current] = await tx.select().from(matches).where(eq(matches.id, m.id)).for("update");
    if (!current || current.source !== "virtual" || current.status !== "upcoming") return null;
    // Le départ est toujours horodaté à `now` (jamais antidaté). Un match peut
    // toutefois être avancé de quelques minutes pour remplir un canal libre.
    if (!options?.allowEarly && current.startsAt.getTime() > now) return null;
    if (!options?.ignoreRecentGap) {
      const [recentKickoff] = await tx.select({ id: matches.id }).from(matches).where(sql`${matches.source} = 'virtual' AND ${matches.status} IN ('live', 'finished') AND ${matches.startsAt} > ${new Date(now - VIRTUAL_KICKOFF_GAP_MS)}`).limit(1);
      if (recentKickoff) return null;
    }
    const homeAliases = virtualTeamAliases(current.homeTeam).map(t => t.toLowerCase().trim());
    const awayAliases = virtualTeamAliases(current.awayTeam).map(t => t.toLowerCase().trim());
    const h = sql.join(homeAliases.map(t => sql`${t}`), sql`, `);
    const a = sql.join(awayAliases.map(t => sql`${t}`), sql`, `);
    const conflictRows = await tx.select({ status: matches.status, homeTeam: matches.homeTeam, awayTeam: matches.awayTeam, startsAt: matches.startsAt, finishedAt: matches.finishedAt }).from(matches).where(sql`${matches.source} = 'virtual' AND (${matches.status} = 'live' OR (${matches.status} = 'finished' AND COALESCE(${matches.finishedAt}, ${matches.startsAt} + interval '608 seconds') >= ${new Date(now - VIRTUAL_REMATCH_GAP_MS - 60 * 60_000)} AND ((lower(trim(${matches.homeTeam})) IN (${h}) AND lower(trim(${matches.awayTeam})) IN (${a})) OR (lower(trim(${matches.homeTeam})) IN (${a}) AND lower(trim(${matches.awayTeam})) IN (${h})))))`);
    if (conflictRows.filter(row => row.status === "live").length >= VIRTUAL_MAX_LIVE) return null;
    const candidate = { home: current.homeTeam, away: current.awayTeam };
    for (const other of conflictRows) {
      if (other.status === "live" && sharesVirtualTeam(candidate, { home: other.homeTeam, away: other.awayTeam })) return null;
      const finishedAt = other.finishedAt?.getTime() ?? other.startsAt.getTime() + 608_000;
      if (other.status === "finished" && virtualPairKey(current.homeTeam, current.awayTeam) === virtualPairKey(other.homeTeam, other.awayTeam) && now < finishedAt + VIRTUAL_REMATCH_GAP_MS) return null;
    }
    await tx.update(matches).set({ status: "live", startsAt: new Date(now), homeScore: current.homeScore ?? 0, awayScore: current.awayScore ?? 0, minute: "1'" }).where(and(eq(matches.id, m.id), eq(matches.status, "upcoming")));
    return current;
  });
}
