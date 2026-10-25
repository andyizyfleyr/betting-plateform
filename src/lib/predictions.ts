import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appUser,
  comboBets,
  predictionBets,
  predictionQuestions,
  type PredictionOption,
} from "@/db/schema";
import { settlePendingCombos } from "./combo";
import { getGlobalHouseHealth, invalidateHouseHealthCache } from "./house-brain";
import { createServerRng } from "./server-rng";

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

  // Pondération anti-baleine : pénalise exponentiellement une perte sèche disproportionnée
  // tout en conservant un plancher de 28 % de la probabilité initiale pour garder le jeu vivant.
  const bankRef = Math.max(70, 115 * houseTightness);
  const adjusted = candidates.map((c) => {
    const liability = (payoutByKey.get(c.key) ?? 0) - totalStaked;
    if (liability <= 6) return c.baseProb;
    const shield = Math.max(0.28, Math.exp(-liability / bankRef));
    return c.baseProb * shield;
  });

  const sumW = adjusted.reduce((a, b) => a + b, 0) || 1;
  // Graine HMAC-SHA256 secrète côté serveur : impossible à rétro-concevoir depuis l'extérieur
  const u = createServerRng(
    `pred-resolve-v4|${q.seedValue}|${Math.round(totalStaked * 100)}`
  )();

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
export async function settleQuestion(
  questionId: number,
  resolution: string,
  effectiveAt?: Date
) {
  const nowMs = Date.now();
  const resolvedAt =
    effectiveAt && effectiveAt.getTime() <= nowMs ? effectiveAt : new Date(nowMs);

  await db.transaction(async (tx) => {
    await tx
      .update(predictionQuestions)
      .set({ status: "resolved", resolution, resolvedAt })
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
      const minSettledMs = b.placedAt ? b.placedAt.getTime() + 1_000 : 0;
      const settledAt = new Date(
        Math.min(nowMs, Math.max(minSettledMs, resolvedAt.getTime()))
      );
      const won = b.selection === resolution;
      if (won) {
        const payout = round2(b.stake * b.odds);
        await tx
          .update(predictionBets)
          .set({ status: "won", potentialWin: payout, settledAt })
          .where(eq(predictionBets.id, b.id));
        await tx
          .update(appUser)
          .set({ balance: sql`${appUser.balance} + ${payout}` })
          .where(eq(appUser.id, b.userId));
      } else {
        await tx
          .update(predictionBets)
          .set({ status: "lost", settledAt })
          .where(eq(predictionBets.id, b.id));
      }
    }
  });
  await settlePendingCombos();
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
  const dueSet = new Set(dueIds);
  const [allPending, pendingCombos, health] = await Promise.all([
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
    db
      .select({
        stake: comboBets.stake,
        baseOdds: comboBets.baseOdds,
        legs: comboBets.legs,
      })
      .from(comboBets)
      .where(eq(comboBets.status, "pending")),
    getGlobalHouseHealth(),
  ]);

  const byQ = new Map<number, Array<{ selection: string; stake: number; odds: number }>>();
  for (const b of allPending) {
    const list = byQ.get(b.questionId) ?? [];
    list.push(b);
    byQ.set(b.questionId, list);
  }
  for (const cb of pendingCombos) {
    for (const leg of cb.legs ?? []) {
      if (leg.kind !== "prediction" || !leg.questionId || leg.status !== "pending") continue;
      if (!dueSet.has(leg.questionId)) continue;
      const list = byQ.get(leg.questionId) ?? [];
      const effOdds = Math.min(20, leg.odds * Math.pow(Math.max(1, cb.baseOdds / Math.max(1.01, leg.odds)), 0.3));
      list.push({ selection: leg.selection, stake: cb.stake, odds: effOdds });
      byQ.set(leg.questionId, list);
    }
  }

  for (const q of due) {
    const resolution = resolveQuestion(q, byQ.get(q.id) ?? [], health.tightness);
    await settleQuestion(q.id, resolution, q.resolvesAt);
  }
}

const MIN_OPEN_PREDICTIONS = 12;

const ROLLING_PREDICTION_TEMPLATES: Array<{
  category: string;
  buildTitle: (label: string) => string;
  oddsYes: number;
  oddsNo: number;
  hoursAhead: number;
  options?: PredictionOption[];
}> = [
  {
    category: "Sport",
    buildTitle: (lbl) => `Quel championnat produira le plus de buts lors de la session ${lbl} ?`,
    oddsYes: 2.0,
    oddsNo: 2.0,
    hoursAhead: 36,
    options: [
      { key: "premier_league", label: "Premier League", odds: 2.65 },
      { key: "bundesliga", label: "Bundesliga", odds: 2.9 },
      { key: "liga", label: "Liga", odds: 4.1 },
      { key: "ligue_1", label: "Ligue 1", odds: 4.8 },
    ],
  },
  {
    category: "Crypto",
    buildTitle: (lbl) => `Le Bitcoin clôturera-t-il en hausse sur la fenêtre ${lbl} ?`,
    oddsYes: 1.86,
    oddsNo: 1.96,
    hoursAhead: 24,
  },
  {
    category: "Sport",
    buildTitle: (lbl) => `Un club outsider (cote > 3,20) s'imposera-t-il sur la série ${lbl} ?`,
    oddsYes: 1.78,
    oddsNo: 2.05,
    hoursAhead: 18,
  },
  {
    category: "Actus",
    buildTitle: (lbl) => `Quel secteur dominera les marchés tech sur l'échéance ${lbl} ?`,
    oddsYes: 2.0,
    oddsNo: 2.0,
    hoursAhead: 48,
    options: [
      { key: "ia_cloud", label: "IA & Cloud", odds: 2.15 },
      { key: "semiconducteurs", label: "Semi-conducteurs", odds: 2.85 },
      { key: "cybersecurite", label: "Cybersécurité", odds: 4.4 },
      { key: "robotique", label: "Robotique", odds: 5.8 },
    ],
  },
  {
    category: "Culture",
    buildTitle: (lbl) => `Une sortie streaming dépassera-t-elle 25 M de vues sur la période ${lbl} ?`,
    oddsYes: 1.74,
    oddsNo: 2.1,
    hoursAhead: 60,
  },
];

/**
 * Maintient automatiquement un vivier actif de questions ouvertes même si
 * personne ne visite le site ou l'interface admin pendant plusieurs jours.
 */
export async function ensureOpenPredictions(now = Date.now()): Promise<void> {
  const [{ openCount }] = await db
    .select({ openCount: sql<number>`count(*)::int` })
    .from(predictionQuestions)
    .where(
      and(
        eq(predictionQuestions.status, "open"),
        sql`${predictionQuestions.resolvesAt} > now()`
      )
    );

  if (openCount >= MIN_OPEN_PREDICTIONS) return;

  const needed = Math.min(5, MIN_OPEN_PREDICTIONS - openCount);
  const slotId = Math.floor(now / (12 * 3_600_000));
  const dateObj = new Date(now);
  const label = `${String(dateObj.getUTCDate()).padStart(2, "0")}/${String(
    dateObj.getUTCMonth() + 1
  ).padStart(2, "0")} #${slotId % 100}`;

  for (let i = 0; i < needed; i++) {
    const tpl =
      ROLLING_PREDICTION_TEMPLATES[(slotId + i) % ROLLING_PREDICTION_TEMPLATES.length];
    const title = tpl.buildTitle(label);
    const seedValue = ((slotId * 7919 + i * 104729) >>> 0) % 1_000_000 + 1000;
    const resolvesAt = new Date(now + tpl.hoursAhead * 3_600_000 + i * 3_600_000);

    await db
      .insert(predictionQuestions)
      .values({
        question: title,
        category: tpl.category,
        status: "open",
        seedValue,
        oddsYes: tpl.oddsYes,
        oddsNo: tpl.oddsNo,
        options: tpl.options ?? null,
        volume: 0,
        yesCount: 0,
        noCount: 0,
        resolvesAt,
      })
      .onConflictDoNothing();
  }
}
