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

/** Probabilité implicite de « Oui » (normalisée, hors marge de la bookmaker). */
export function impliedYes(oddsYes: number, oddsNo: number) {
  const pYes = 1 / oddsYes;
  const pNo = 1 / oddsNo;
  return pYes / (pYes + pNo);
}

/** Issue déterministe d'une question échue, cohérente avec les cotes affichées. */
export function resolveQuestion(q: {
  seedValue: number;
  oddsYes: number;
  oddsNo: number;
}): "yes" | "no" {
  return mulberry32(q.seedValue)() < impliedYes(q.oddsYes, q.oddsNo) ? "yes" : "no";
}

/**
 * Résout les questions échues (resolvesAt dépassé) et règle les paris en attente.
 * Transactionnel : statut question, statut des paris et crédit des gains atomiques.
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
    await db.transaction(async (tx) => {
      await tx
        .update(predictionQuestions)
        .set({ status: "resolved", resolution, resolvedAt: new Date() })
        .where(eq(predictionQuestions.id, q.id));

      const pending = await tx
        .select()
        .from(predictionBets)
        .where(
          and(
            eq(predictionBets.questionId, q.id),
            eq(predictionBets.status, "pending")
          )
        );

      for (const b of pending) {
        const won = b.selection === resolution;
        await tx
          .update(predictionBets)
          .set({ status: won ? "won" : "lost" })
          .where(eq(predictionBets.id, b.id));
        if (won) {
          await tx
            .update(appUser)
            .set({ balance: sql`${appUser.balance} + ${b.potentialWin}` })
            .where(eq(appUser.id, b.userId));
        }
      }
    });
  }
}

/** Petite dérive des cotes après chaque pari : le marché « respire » comme un vrai book. */
export function driftOdds(oddsA: number, oddsB: number): [number, number] {
  return [
    round2(Math.max(1.05, Math.min(99, oddsA * 0.995))),
    round2(Math.max(1.05, Math.min(99, oddsB * 1.005))),
  ];
}
