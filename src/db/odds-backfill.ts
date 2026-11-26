import { sql } from "drizzle-orm";
import { db } from "@/db";
import { oddsFor } from "@/db/fixtures";

/**
 * Nettoyage unique des cotes historiques corrompues.
 *
 * Avant le correctif « archive ouverture / clôture », le moteur virtuel persistait la
 * cote live finale : un match plié finissait en base avec `1,01` (plancher) côté
 * vainqueur et `100,00` / `100,01` (plafond `LIVE_ODDS_MAX`) côté perdant.
 *
 * Les vraies cotes de clôture de ces matchs sont irrécupérables (l'ancien moteur
 * vidait `tick_history` à la fin du match). On réécrit donc ces lignes avec la cote
 * pré-match du modèle, qui reste une cote crédible, et on la recopie dans les
 * colonnes d'archive pour que la base soit cohérente avec ce qu'affiche l'UI.
 *
 * Idempotent : une seule passe, verrouillée par un marqueur dans `admin_settings`.
 */

const BACKFILL_MARKER_KEY = "odds_backfill_v1";
const ODDS_MIN = 1.05;
const ODDS_MAX = 60;
const BATCH_LIMIT = 3000;
const CHUNK = 500;

const round2 = (n: number) => Math.round(n * 100) / 100;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function backfillCorruptFinishedOdds(): Promise<void> {
  try {
    const marker = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM "admin_settings" WHERE "setting_key" = ${BACKFILL_MARKER_KEY}
      ) AS done
    `);
    if ((marker.rows?.[0] as { done?: boolean } | undefined)?.done) return;

    const corrupt = await db.execute(sql`
      SELECT "id", "home_team", "away_team"
      FROM "matches"
      WHERE "source" = 'virtual'
        AND "status" = 'finished'
        AND (
          "odds_home" < ${ODDS_MIN} OR "odds_home" > ${ODDS_MAX}
          OR "odds_away" < ${ODDS_MIN} OR "odds_away" > ${ODDS_MAX}
          OR "odds_draw" IS NULL OR "odds_draw" < ${ODDS_MIN} OR "odds_draw" > ${ODDS_MAX}
        )
      ORDER BY "id" DESC
      LIMIT ${sql.raw(String(BATCH_LIMIT))}
    `);
    const rows = (corrupt.rows ?? []) as Array<{
      id: number;
      home_team: string;
      away_team: string;
    }>;

    for (const batch of chunks(rows, CHUNK)) {
      const tuples = batch.map((row) => {
        const price = oddsFor(row.home_team, row.away_team, {
          homeForm: 1,
          awayForm: 1,
        });
        return sql`(${row.id}::int, ${round2(price.oddsHome)}::float8, ${round2(
          price.oddsDraw
        )}::float8, ${round2(price.oddsAway)}::float8)`;
      });
      if (tuples.length === 0) continue;
      await db.execute(sql`
        UPDATE "matches" AS m SET
          "odds_home" = v.h,
          "odds_draw" = v.d,
          "odds_away" = v.a,
          "open_odds_home" = COALESCE(m."open_odds_home", v.h),
          "open_odds_draw" = COALESCE(m."open_odds_draw", v.d),
          "open_odds_away" = COALESCE(m."open_odds_away", v.a),
          "close_odds_home" = COALESCE(m."close_odds_home", v.h),
          "close_odds_draw" = COALESCE(m."close_odds_draw", v.d),
          "close_odds_away" = COALESCE(m."close_odds_away", v.a)
        FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, h, d, a)
        WHERE m."id" = v.id
      `);
    }

    if (rows.length > 0) {
      console.info(`[odds backfill] ${rows.length} match(s) terminé(s) nettoyé(s)`);
    }

    await db.execute(sql`
      INSERT INTO "admin_settings" ("setting_key", "value", "updated_at")
      VALUES (${BACKFILL_MARKER_KEY}, jsonb_build_object('rows', ${rows.length}), now())
      ON CONFLICT ("setting_key") DO NOTHING
    `);
  } catch (err) {
    console.error("[odds backfill]", err);
  }
}
