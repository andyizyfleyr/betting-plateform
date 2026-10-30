import { sql } from "drizzle-orm";
import { db } from "@/db";

export type BetHistoryKind = "sport" | "prediction" | "combo";
export interface HistoryCursor { decision: string; placed: string; kind: BetHistoryKind; id: number }
export interface HistoryKey extends HistoryCursor {}
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}$/;

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export function decodeHistoryCursor(raw: string): HistoryCursor | null {
  if (!raw || raw.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(raw)) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as HistoryCursor;
    if (!c || typeof c.decision !== "string" || !STAMP.test(c.decision) ||
        typeof c.placed !== "string" || !STAMP.test(c.placed) ||
        !["sport", "prediction", "combo"].includes(c.kind) ||
        !Number.isSafeInteger(c.id) || c.id <= 0 || c.id > 2147483647) return null;
    // En plus du format, vérifier les dates avant de les transmettre à PostgreSQL.
    const isValidDate = (stamp: string) => {
      const date = new Date(stamp.slice(0, 23) + "Z");
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 23) === stamp.slice(0, 23);
    };
    if (!isValidDate(c.decision) || !isValidDate(c.placed)) return null;
    return c;
  } catch { return null; }
}

/** Page keyset stable entre les trois tables, séparée par joueur. Les microsecondes
 * restent des chaînes : une conversion Date JS pourrait sauter des lignes. */
export async function getFinishedBetPageKeys(uid: number, cursor: HistoryCursor | null, pageSize = 20) {
  // Pousser le curseur et la limite dans chaque branche : les index partiels
  // peuvent limiter les candidats remontés de chaque table avant la fusion globale.
  const condition = (kind: BetHistoryKind) => cursor
    ? sql`AND (COALESCE(settled_at, placed_at), placed_at, ${kind}::text, id) <
        (${cursor.decision}::timestamp, ${cursor.placed}::timestamp, ${cursor.kind}::text, ${cursor.id}::int)`
    : sql``;
  const result = await db.execute(sql`
    SELECT id, kind,
      to_char(decision, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS decision,
      to_char(placed, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS placed
    FROM (
      (SELECT id, 'sport'::text AS kind, COALESCE(settled_at, placed_at) AS decision, placed_at AS placed
        FROM bets WHERE user_id = ${uid} AND status <> 'pending' ${condition("sport")}
        ORDER BY COALESCE(settled_at, placed_at) DESC, placed_at DESC, id DESC LIMIT ${pageSize + 1})
      UNION ALL
      (SELECT id, 'prediction'::text, COALESCE(settled_at, placed_at), placed_at
        FROM prediction_bets WHERE user_id = ${uid} AND status <> 'pending' ${condition("prediction")}
        ORDER BY COALESCE(settled_at, placed_at) DESC, placed_at DESC, id DESC LIMIT ${pageSize + 1})
      UNION ALL
      (SELECT id, 'combo'::text, COALESCE(settled_at, placed_at), placed_at
        FROM combo_bets WHERE user_id = ${uid} AND status <> 'pending' ${condition("combo")}
        ORDER BY COALESCE(settled_at, placed_at) DESC, placed_at DESC, id DESC LIMIT ${pageSize + 1})
    ) AS history
    ORDER BY decision DESC, placed DESC, kind DESC, id DESC
    LIMIT ${pageSize + 1}
  `);
  const rows = result.rows as unknown as HistoryKey[];
  const keys = rows.slice(0, pageSize);
  return { keys, nextCursor: rows.length > pageSize ? encodeHistoryCursor(keys[keys.length - 1]) : null };
}
