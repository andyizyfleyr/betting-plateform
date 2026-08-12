import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, predictionBets, predictionQuestions } from "@/db/schema";
import { adjustOddsForExposure, netExposure, type BetLike } from "@/lib/risk";

export const PRED_MIN_STAKE = 0.5;
export const PRED_MAX_STAKE = 500;
/** Bankroll alloué à une question (€) — seuil de resserrement des cotes. */
export const PRED_BANKROLL = 1_000;
/** Plafond d'exposition nette par question (€) : au-delà, on refuse la mise. */
export const PRED_EXPOSURE_CAP = 3_000;

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
    await settleQuestion(q.id, resolution);
  }
}

/** Petite dérive des cotes après chaque pari : le marché « respire » comme un vrai book. */
export function driftOdds(oddsA: number, oddsB: number): [number, number] {
  return [
    round2(Math.max(1.05, Math.min(99, oddsA * 0.995))),
    round2(Math.max(1.05, Math.min(99, oddsB * 1.005))),
  ];
}

/**
 * Recotation par exposition (mêmes primitives que le sport) :
 * les paris en attente sur chaque côté resserrent la cote du côté surchargé.
 * Retourne les cotes affichées ET de validation pour une question.
 */
export function exposureAdjustedOdds(
  oddsYes: number,
  oddsNo: number,
  pending: BetLike[]
): { oddsYes: number; oddsNo: number } {
  const expYes = netExposure(pending, "yesno", "yes");
  const expNo = netExposure(pending, "yesno", "no");
  return {
    oddsYes: adjustOddsForExposure(oddsYes, expYes, PRED_BANKROLL),
    oddsNo: adjustOddsForExposure(oddsNo, expNo, PRED_BANKROLL),
  };
}

/**
 * Exposition nette totale du bookmaker sur une question (les deux côtés) :
 * sert de garde-fou — on refuse de nouveaux paris au-delà de PRED_EXPOSURE_CAP.
 */
export function totalExposure(pending: BetLike[]): number {
  const yes = netExposure(pending, "yesno", "yes");
  const no = netExposure(pending, "yesno", "no");
  return Math.max(0, yes) + Math.max(0, no);
}

export function netExposureWith(
  pending: BetLike[],
  oddsYes: number,
  oddsNo: number,
  newSelection: string,
  newStake: number
): number {
  const simulated: BetLike[] = [
    ...pending,
    { market: "yesno", selection: newSelection, stake: newStake, odds: newSelection === "yes" ? oddsYes : oddsNo },
  ];
  const yesExp = netExposure(simulated, "yesno", "yes");
  const noExp = netExposure(simulated, "yesno", "no");
  return Math.max(yesExp, noExp);
}
