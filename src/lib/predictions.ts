import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appUser,
  predictionBets,
  predictionQuestions,
  type PredictionOption,
} from "@/db/schema";
import { getGlobalHouseHealth, invalidateHouseHealthCache } from "./house-brain";

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

/**
 * Résolution bookmaker intelligente (« rusée ») :
 * - Respecte strictement les probabilités implicites des cotes fixes comme base
 * - Pondère finement l'exposition nette sur chaque issue lorsque des mises massives
 *   déséquilibrées menacent la banque, sans jamais rendre une issue impossible.
 */
export function resolveQuestion(
  q: {
    seedValue: number;
    oddsYes: number;
    oddsNo: number;
    options?: PredictionOption[] | null;
  },
  pendingOnQuestion: Array<{ selection: string; stake: number; odds: number }> = [],
  houseTightness = 1.0
): string {
  const candidates: Array<{ key: string; baseProb: number }> =
    q.options && q.options.length >= 2
      ? (() => {
          const probs = impliedOptionProbs(q.options);
          return q.options.map((o, i) => ({ key: o.key, baseProb: probs[i] }));
        })()
      : (() => {
          const pY = impliedYes(q.oddsYes, q.oddsNo);
          return [
            { key: "yes", baseProb: pY },
            { key: "no", baseProb: 1 - pY },
          ];
        })();

  const totalStaked = pendingOnQuestion.reduce((s, b) => s + b.stake, 0);
  const payoutByKey = new Map<string, number>();
  for (const b of pendingOnQuestion) {
    payoutByKey.set(b.selection, (payoutByKey.get(b.selection) ?? 0) + b.stake * b.odds);
  }

  // Pondération douce anti-baleine : pénalise exponentiellement une perte sèche disproportionnée
  // tout en conservant un plancher de 32 % de la probabilité initiale pour garder le jeu vivant.
  const bankRef = Math.max(85, 130 * houseTightness);
  const adjusted = candidates.map((c) => {
    const liability = (payoutByKey.get(c.key) ?? 0) - totalStaked;
    if (liability <= 8) return c.baseProb;
    const shield = Math.max(0.32, Math.exp(-liability / bankRef));
    return c.baseProb * shield;
  });

  const sumW = adjusted.reduce((a, b) => a + b, 0) || 1;
  const stakeSalt = Math.round(totalStaked * 100) * 2654435761;
  const u = mulberry32((q.seedValue ^ stakeSalt) >>> 0)();

  let cumul = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumul += adjusted[i] / sumW;
    if (u < cumul) return candidates[i].key;
  }
  return candidates[candidates.length - 1].key;
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
  invalidateHouseHealthCache();
}

/**
 * Réouverture propre d'une question par l'administrateur :
 * - Annule les gains déjà versés sur les tickets « won »
 * - Remet les tickets « won » et « lost » en « pending »
 * - Repousse l'échéance si elle était déjà dépassée pour éviter une re-clôture immédiate.
 */
export async function reopenSettledQuestion(questionId: number): Promise<boolean> {
  let found = false;
  await db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(predictionQuestions)
      .where(eq(predictionQuestions.id, questionId));
    if (!q) return;
    found = true;

    const settledBets = await tx
      .select()
      .from(predictionBets)
      .where(
        and(
          eq(predictionBets.questionId, questionId),
          inArray(predictionBets.status, ["won", "lost"])
        )
      );

    for (const b of settledBets) {
      if (b.status === "won") {
        const clawback = round2(b.potentialWin);
        await tx
          .update(appUser)
          .set({ balance: sql`GREATEST(0, ${appUser.balance} - ${clawback})` })
          .where(eq(appUser.id, b.userId));
      }
      await tx
        .update(predictionBets)
        .set({ status: "pending", potentialWin: round2(b.stake * b.odds) })
        .where(eq(predictionBets.id, b.id));
    }

    const nextResolvesAt =
      q.resolvesAt.getTime() <= Date.now() + 60_000
        ? new Date(Date.now() + 24 * 3_600_000)
        : q.resolvesAt;

    await tx
      .update(predictionQuestions)
      .set({
        status: "open",
        resolution: null,
        resolvedAt: null,
        resolvesAt: nextResolvesAt,
      })
      .where(eq(predictionQuestions.id, questionId));
  });
  invalidateHouseHealthCache();
  return found;
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

  if (due.length === 0) return;

  const dueIds = due.map((q) => q.id);
  const [allPending, health] = await Promise.all([
    db
      .select({
        questionId: predictionBets.questionId,
        selection: predictionBets.selection,
        stake: predictionBets.stake,
        odds: predictionBets.odds,
      })
      .from(predictionBets)
      .where(
        and(
          inArray(predictionBets.questionId, dueIds),
          eq(predictionBets.status, "pending")
        )
      ),
    getGlobalHouseHealth(),
  ]);

  const byQ = new Map<number, Array<{ selection: string; stake: number; odds: number }>>();
  for (const b of allPending) {
    const list = byQ.get(b.questionId) ?? [];
    list.push(b);
    byQ.set(b.questionId, list);
  }

  for (const q of due) {
    const resolution = resolveQuestion(q, byQ.get(q.id) ?? [], health.tightness);
    await settleQuestion(q.id, resolution);
  }
}
