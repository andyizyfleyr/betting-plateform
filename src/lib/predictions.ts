import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appUser,
  predictionBets,
  predictionQuestions,
  type PredictionOption,
} from "@/db/schema";

export const PRED_MIN_STAKE = 0.5;
export const PRED_MAX_STAKE = 500;

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Génère un identifiant propre pour une option à choix multiple. */
export function slugifyOptionKey(label: string, idx: number): string {
  const base = label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return base ? `${base}` : `opt_${idx + 1}`;
}

/** PRNG déterministe (mulberry32) : résolution stable, non déductible depuis l'UI. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Probabilité implicite de « Oui » (normalisée à partir des cotes fixes). */
export function impliedYes(oddsYes: number, oddsNo: number) {
  const pYes = 1 / oddsYes;
  const pNo = 1 / oddsNo;
  return pYes / (pYes + pNo);
}

/** Probabilités implicites normalisées d'une liste d'options à cotes fixes. */
export function impliedOptionProbs(options: PredictionOption[]): number[] {
  const weights = options.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => w / sum);
}

/** Issue déterministe d'une question échue (binaire Oui/Non ou choix multiples). */
export function resolveQuestion(q: {
  seedValue: number;
  oddsYes: number;
  oddsNo: number;
  options?: PredictionOption[] | null;
}): string {
  const u = mulberry32(q.seedValue)();
  if (q.options && q.options.length >= 2) {
    const probs = impliedOptionProbs(q.options);
    let cumul = 0;
    for (let i = 0; i < q.options.length; i++) {
      cumul += probs[i];
      if (u < cumul) return q.options[i].key;
    }
    return q.options[q.options.length - 1].key;
  }
  return u < impliedYes(q.oddsYes, q.oddsNo) ? "yes" : "no";
}

/**
 * Règlement à cotes fixes (non mutualisé), compatible Oui/Non et choix multiples :
 * Chaque ticket gagnant touche exactement son gain garanti `mise × cote`
 * verrouillé au moment de la validation du pari.
 */
export async function settleQuestion(questionId: number, resolution: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(predictionQuestions)
      .set({ status: "resolved", resolution, resolvedAt: new Date() })
      .where(eq(predictionQuestions.id, questionId));

    const pending = await tx
      .select()
      .from(predictionBets)
      .where(
        and(
          eq(predictionBets.questionId, questionId),
          eq(predictionBets.status, "pending")
        )
      );

    for (const b of pending) {
      const won = b.selection === resolution;
      if (won) {
        const payout = round2(b.stake * b.odds);
        await tx
          .update(predictionBets)
          .set({ status: "won", potentialWin: payout })
          .where(eq(predictionBets.id, b.id));
        await tx
          .update(appUser)
          .set({ balance: sql`${appUser.balance} + ${payout}` })
          .where(eq(appUser.id, b.userId));
      } else {
        await tx
          .update(predictionBets)
          .set({ status: "lost" })
          .where(eq(predictionBets.id, b.id));
      }
    }
  });
}

/**
 * Résout les questions échues (resolvesAt dépassé) et règle les paris en attente
 * selon leurs cotes fixes individuelles.
 */
export async function settleResolvedQuestions() {
  const due = await db
    .select()
    .from(predictionQuestions)
    .where(
      and(
        eq(predictionQuestions.status, "open"),
        sql`${predictionQuestions.resolvesAt} <= now()`
      )
    );

  for (const q of due) {
    const resolution = resolveQuestion(q);
    await settleQuestion(q.id, resolution);
  }
}
