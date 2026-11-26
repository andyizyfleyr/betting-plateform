import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  DEPOSIT_BONUS_PERCENTS,
  getAdminSettingSync,
  type WelcomeBonusSettings,
} from "@/lib/admin-settings";
import { roundEurPivot } from "@/lib/countries";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Réglages du bonus de dépôt, avec repli sur les valeurs par défaut. */
export function depositBonusSettings(): WelcomeBonusSettings {
  const raw = getAdminSettingSync("welcome_bonus") as unknown as WelcomeBonusSettings;
  // Ancien réglage « bonus d'inscription » (montant fixe + wager 1×) : on repart
  // des valeurs du bonus par palier de dépôt au lieu d'appliquer 1×.
  const legacy = !!raw && raw.maxBonus === undefined && raw.amount !== undefined;
  const source: Partial<WelcomeBonusSettings> = legacy ? {} : (raw ?? {});
  return {
    enabled: raw?.enabled !== false,
    maxBonus:
      Number.isFinite(source.maxBonus) && Number(source.maxBonus) > 0 ? Number(source.maxBonus) : 0,
    wagerMultiplier:
      Number.isFinite(source.wagerMultiplier) && Number(source.wagerMultiplier) > 0
        ? Number(source.wagerMultiplier)
        : 4,
    minOddsSingle:
      Number.isFinite(source.minOddsSingle) && Number(source.minOddsSingle) > 1
        ? Number(source.minOddsSingle)
        : 1.3,
    minOddsCombo:
      Number.isFinite(source.minOddsCombo) && Number(source.minOddsCombo) > 1
        ? Number(source.minOddsCombo)
        : 1.4,
  };
}

/** Pourcentage de bonus du palier `stage` (0 = 1er dépôt), null après le 3e. */
export function depositBonusPercent(stage: number): number | null {
  if (!Number.isInteger(stage) || stage < 0 || stage >= DEPOSIT_BONUS_PERCENTS.length) return null;
  return DEPOSIT_BONUS_PERCENTS[stage];
}

/** Montant du bonus pour un dépôt donné, plafonné si l'admin a fixé un plafond. */
export function depositBonusAmount(
  depositEur: number,
  stage: number,
  settings: WelcomeBonusSettings = depositBonusSettings()
): number {
  if (!settings.enabled || !(depositEur > 0)) return 0;
  const percent = depositBonusPercent(stage);
  if (percent == null) return 0;
  const raw = roundEurPivot((depositEur * percent) / 100);
  const capped = settings.maxBonus > 0 ? Math.min(raw, settings.maxBonus) : raw;
  return roundEurPivot(capped);
}

export interface DepositBonusGrant {
  /** Bonus crédité sur le solde (0 si aucun palier ne s'applique plus). */
  granted: number;
  /** Palier appliqué (1, 2 ou 3), 0 si aucun bonus accordé. */
  stage: number;
  /** Pourcentage appliqué (50, 75 ou 100), 0 si aucun bonus accordé. */
  percent: number;
}

/**
 * Accorde le bonus du dépôt qui vient d'être crédité, dans la transaction du crédit :
 * - 1er dépôt : 50 % · 2e : 75 % · 3e : 100 % · au-delà : plus rien ;
 * - le bonus est ajouté au solde (donc jouable) ET au montant verrouillé ;
 * - l'exigence de mise démarre au premier bonus accordé.
 */
export async function grantDepositBonusInTx(
  tx: DbTx,
  uid: number,
  depositEur: number
): Promise<DepositBonusGrant> {
  const settings = depositBonusSettings();
  if (!settings.enabled || !(depositEur > 0)) return { granted: 0, stage: 0, percent: 0 };

  const lock = await tx.execute(sql`
    SELECT COALESCE("bonus_stage", 0)::int AS stage
    FROM "app_user" WHERE "id" = ${uid} FOR UPDATE
  `);
  const stage = Number((lock.rows?.[0] as { stage?: number } | undefined)?.stage ?? 0);
  const percent = depositBonusPercent(stage);
  if (percent == null) return { granted: 0, stage: 0, percent: 0 };

  const bonus = depositBonusAmount(depositEur, stage, settings);
  if (!(bonus > 0)) return { granted: 0, stage: 0, percent: 0 };

  await tx.execute(sql`
    UPDATE "app_user" SET
      "balance" = ROUND(("balance" + ${bonus})::numeric, 6)::float8,
      "bonus_locked" = ROUND(("bonus_locked" + ${bonus})::numeric, 6)::float8,
      "bonus_granted" = ROUND(("bonus_granted" + ${bonus})::numeric, 6)::float8,
      "bonus_stage" = ${stage + 1},
      "bonus_wager_start" = COALESCE("bonus_wager_start", now())
    WHERE "id" = ${uid}
  `);

  return { granted: bonus, stage: stage + 1, percent };
}

/**
 * Le joueur renonce à son bonus restant pour retirer l'intégralité de son solde.
 * Le palier n'est pas remboursé : un bonus annulé ne sera pas réattribué.
 */
export async function forfeitDepositBonusInTx(tx: DbTx, uid: number): Promise<number> {
  const rows = await tx.execute(sql`
    WITH before AS (
      SELECT "bonus_locked" AS locked FROM "app_user" WHERE "id" = ${uid} FOR UPDATE
    )
    UPDATE "app_user"
    SET "bonus_locked" = 0, "bonus_granted" = 0
    FROM before
    WHERE "app_user"."id" = ${uid} AND before.locked > 0
    RETURNING before.locked AS forfeited
  `);
  const row = rows.rows?.[0] as { forfeited?: number } | undefined;
  return row ? Number(row.forfeited ?? 0) : 0;
}
