import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import {
  getCachedUserPulse,
  setCachedUserPulse,
  type UserPulsePayload,
  type UserPulseTicketItem,
} from "@/lib/active-state-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { isManualRefreshRequest, jsonWithEtag } from "@/lib/response-cache";
import { requireUserId } from "@/lib/session";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

/**
 * GET /api/pulse — Pulsation globale ultra-légère (~150 octets au lieu de ~60 Ko) :
 * - Sert depuis le cache mémoire joueur (invalidé instantanément dès qu'un pari est
 *   placé, vendu ou réglé).
 * - Lorsqu'une lecture SQL a lieu, exécute UNE SEULE requête compacte sans aucun `JOIN` JSONB
 *   ni historique ancien : renvoie uniquement `balance`, les tickets `pending` et les tickets
 *   réglés dans les 60 dernières secondes (pour déclencher les toasts de gain/remboursement).
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    const manualRefresh = isManualRefreshRequest(req);
    await syncLiveMatchesThrottled(false, { manualRefresh });

    if (!manualRefresh) {
      const cached = getCachedUserPulse(uid);
      if (cached) {
        return jsonWithEtag(req, null, cached);
      }
    }

    const res = await db.execute(sql`
      SELECT
        u."balance"::float8 AS balance,
        COALESCE(
          (
            SELECT json_agg(t)
            FROM (
              SELECT
                b."id"::int AS id,
                'sport'::text AS kind,
                b."status"::text AS status,
                b."stake"::float8 AS stake,
                b."potential_win"::float8 AS "potentialWin",
                (b."home_team" || ' – ' || b."away_team")::text AS title,
                b."selection_label"::text AS "selectionLabel"
              FROM "bets" b
              WHERE b."user_id" = ${uid}
                AND (b."status" = 'pending' OR b."settled_at" > now() - interval '60 seconds')
              UNION ALL
              SELECT
                pb."id"::int AS id,
                'prediction'::text AS kind,
                pb."status"::text AS status,
                pb."stake"::float8 AS stake,
                pb."potential_win"::float8 AS "potentialWin",
                pb."question"::text AS title,
                pb."selection_label"::text AS "selectionLabel"
              FROM "prediction_bets" pb
              WHERE pb."user_id" = ${uid}
                AND (pb."status" = 'pending' OR pb."settled_at" > now() - interval '60 seconds')
              UNION ALL
              SELECT
                cb."id"::int AS id,
                'combo'::text AS kind,
                cb."status"::text AS status,
                cb."stake"::float8 AS stake,
                cb."potential_win"::float8 AS "potentialWin",
                ('Combiné (' || jsonb_array_length(cb."legs")::text || ' sélections)')::text AS title,
                ''::text AS "selectionLabel"
              FROM "combo_bets" cb
              WHERE cb."user_id" = ${uid}
                AND (cb."status" = 'pending' OR cb."settled_at" > now() - interval '60 seconds')
            ) t
          ),
          '[]'::json
        ) AS tickets
      FROM "app_user" u
      WHERE u."id" = ${uid}
      LIMIT 1
    `);

    const row = (res.rows?.[0] ?? {}) as {
      balance?: number;
      tickets?: UserPulseTicketItem[] | string;
    };

    const tickets: UserPulseTicketItem[] = Array.isArray(row.tickets)
      ? row.tickets
      : typeof row.tickets === "string"
        ? (JSON.parse(row.tickets) as UserPulseTicketItem[])
        : [];

    const pendingCount = tickets.filter((t) => t.status === "pending").length;
    const payload: UserPulsePayload = {
      balance: typeof row.balance === "number" ? row.balance : 0,
      pendingCount,
      tickets,
    };

    const entry = setCachedUserPulse(uid, payload);
    return jsonWithEtag(req, null, entry);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/pulse");
  }
}
