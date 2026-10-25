import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, predictionBets, predictionQuestions } from "@/db/schema";

export const PRED_MIN_STAKE = 0.5;
export const PRED_MAX_STAKE = 500;

export function round2(n: number) {
  return Math.round(n * 100) / 100;
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

/** Issue déterministe d'une question échue, cohérente avec les cotes fixes affichées. */
export function resolveQuestion(q: {
  seedValue: number;
  oddsYes: number;
  oddsNo: number;
}): "yes" | "no" {
  return mulberry32(q.seedValue)() < impliedYes(q.oddsYes, q.oddsNo) ? "yes" : "no";
}

/**
 * Règlement à cotes fixes (non mutualisé) :
 * Chaque ticket gagnant touche exactement son gain garanti `mise × cote`
 * verrouillé au moment de la validation du pari (`b.potentialWin`).
 */
export async function settleQuestion(questionId: number, resolution: "yes" | "no") {
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
