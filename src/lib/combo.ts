import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appUser,
  comboBets,
  matches,
  predictionQuestions,
  type ComboBetRow,
  type ComboLeg,
  type MatchRow,
  type PredictionQuestionRow,
} from "@/db/schema";
import { computeComboQuote } from "@/lib/combo-math";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import { isKnownMarket, liveOutcomeProbability, marketWin, minuteNumber } from "@/lib/markets";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Règle automatiquement tous les paris combinés en cours (`status = "pending"`) :
 * - Met à jour le statut individuel de chaque sélection (`won` / `lost` / `void`)
 * - Dès qu'une seule sélection est perdante (`lost`), le combiné passe immédiatement en `lost`
 * - Lorsque toutes les sélections sont terminées (`won` ou `void`), recalcule le gain
 *   exact sur les sélections gagnantes (remboursement si 100 % annulé) et crédite le solde.
 */
export async function settlePendingCombos(): Promise<void> {
  const pending = await db
    .select()
    .from(comboBets)
    .where(eq(comboBets.status, "pending"));

  if (pending.length === 0) return;

  const matchIds = new Set<number>();
  const questionIds = new Set<number>();

  for (const cb of pending) {
    for (const leg of cb.legs ?? []) {
      if (leg.kind === "sport" && leg.matchId) matchIds.add(leg.matchId);
      if (leg.kind === "prediction" && leg.questionId) questionIds.add(leg.questionId);
    }
  }

  const [matchRows, questionRows] = await Promise.all([
    matchIds.size > 0
      ? db.select().from(matches).where(inArray(matches.id, [...matchIds]))
      : Promise.resolve([] as MatchRow[]),
    questionIds.size > 0
      ? db
          .select()
          .from(predictionQuestions)
          .where(inArray(predictionQuestions.id, [...questionIds]))
      : Promise.resolve([] as PredictionQuestionRow[]),
  ]);

  const matchMap = new Map(matchRows.map((m) => [m.id, m]));
  const questionMap = new Map(questionRows.map((q) => [q.id, q]));

  let settledAny = false;

  for (const cb of pending) {
    let legsChanged = false;
    const nextLegs: ComboLeg[] = (cb.legs ?? []).map((leg) => {
      if (leg.status !== "pending") return leg;

      if (leg.kind === "sport") {
        const m = leg.matchId ? matchMap.get(leg.matchId) : undefined;
        if (!m) {
          legsChanged = true;
          return { ...leg, status: "void" };
        }
        if (m.status !== "finished") return leg;

        const home = m.homeScore ?? 0;
        const away = m.awayScore ?? 0;
        if (!isKnownMarket(leg.market)) {
          // Marché personnalisé manuel 1/N/2
          if (leg.market === "result") {
            const won =
              leg.selection === "home"
                ? home > away
                : leg.selection === "away"
                  ? away > home
                  : home === away;
            legsChanged = true;
            return { ...leg, status: won ? "won" : "lost" };
          }
          legsChanged = true;
          return { ...leg, status: "void" };
        }
        const won = marketWin(leg.market, leg.selection, home, away);
        legsChanged = true;
        return { ...leg, status: won ? "won" : "lost" };
      }

      // Sélection de prédiction
      const q = leg.questionId ? questionMap.get(leg.questionId) : undefined;
      if (!q) {
        legsChanged = true;
        return { ...leg, status: "void" };
      }
      if (q.status !== "resolved" || !q.resolution) return leg;

      legsChanged = true;
      return { ...leg, status: q.resolution === leg.selection ? "won" : "lost" };
    });

    const hasLost = nextLegs.some((l) => l.status === "lost");
    const allSettled = nextLegs.length > 0 && nextLegs.every((l) => l.status !== "pending");

    if (hasLost) {
      settledAny = true;
      await db
        .update(comboBets)
        .set({ legs: nextLegs, status: "lost", settledAt: new Date() })
        .where(eq(comboBets.id, cb.id));
      continue;
    }

    if (allSettled) {
      settledAny = true;
      const wonOdds = nextLegs.filter((l) => l.status === "won").map((l) => l.odds);
      const quote =
        wonOdds.length === 0
          ? null
          : computeComboQuote(wonOdds, cb.stake);
      const payout =
        quote == null
          ? round2(cb.stake) // toutes les sélections annulées → remboursement mise
          : round2(Math.min(cb.potentialWin, quote.potentialWin));

      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(comboBets)
          .set({
            legs: nextLegs,
            status: "won",
            potentialWin: payout,
            settledAt: new Date(),
          })
          .where(sql`${comboBets.id} = ${cb.id} AND ${comboBets.status} = 'pending'`)
          .returning({ id: comboBets.id });

        if (updated && payout > 0) {
          await tx
            .update(appUser)
            .set({ balance: sql`${appUser.balance} + ${payout}` })
            .where(eq(appUser.id, cb.userId));
        }
      });
      continue;
    }

    if (legsChanged) {
      await db
        .update(comboBets)
        .set({ legs: nextLegs })
        .where(eq(comboBets.id, cb.id));
    }
  }

  if (settledAny) {
    invalidateHouseHealthCache();
  }
}

/**
 * Cash-out intelligent sur un pari combiné en cours :
 * - Indisponible si un match impliqué est suspendu ou en toute fin de match (≥ 88')
 * - Évalue la probabilité jointe de réussite de toutes les sélections restantes
 *   (1,0 pour une sélection déjà gagnée, probabilité modèle live pour un match en cours,
 *   probabilité implicite sans marge pour une rencontre à venir ou prédiction ouverte)
 * - Applique une marge multi-sélections protectrice pour la maison.
 */
export function computeComboCashOut(
  cb: ComboBetRow,
  matchMap: Map<number, MatchRow>,
  questionMap: Map<number, PredictionQuestionRow>
): number | null {
  if (cb.status !== "pending") return null;
  const legs = cb.legs ?? [];
  if (legs.length === 0) return null;

  let jointProb = 1;
  let wonCount = 0;
  let hasLiveProgress = false;

  for (const leg of legs) {
    if (leg.status === "lost") return null;
    if (leg.status === "won" || leg.status === "void") {
      wonCount += 1;
      continue;
    }

    if (leg.kind === "sport") {
      const m = leg.matchId ? matchMap.get(leg.matchId) : undefined;
      if (!m) continue;
      if (m.status === "finished") return null; // en attente de règlement imminent
      if (m.status === "live") {
        if (m.suspended) return null;
        const min = minuteNumber(m.minute);
        if (min >= 88) return null;
        hasLiveProgress = true;
        const pLive = isKnownMarket(leg.market)
          ? liveOutcomeProbability(
              leg.market,
              leg.selection,
              m.homeTeam,
              m.awayTeam,
              m.homeScore ?? 0,
              m.awayScore ?? 0,
              min,
              {
                homeForm: m.homeForm ?? 1,
                awayForm: m.awayForm ?? 1,
                redHome: m.redHome ?? 0,
                redAway: m.redAway ?? 0,
              }
            )
          : null;
        if (pLive == null || pLive < 0.02) return null;
        jointProb *= pLive;
      } else {
        // Match à venir : probabilité implicite juste
        jointProb *= Math.min(0.95, 0.955 / Math.max(1.02, leg.odds));
      }
    } else {
      const q = leg.questionId ? questionMap.get(leg.questionId) : undefined;
      if (!q || q.status !== "open" || q.resolvesAt.getTime() <= Date.now()) {
        return null;
      }
      jointProb *= Math.min(0.95, 0.94 / Math.max(1.02, leg.odds));
    }
  }

  // Proposer le cash-out uniquement dès qu'au moins une sélection est gagnée ou en direct
  if (wonCount === 0 && !hasLiveProgress) return null;

  const entryJoint = Math.min(0.92, 0.95 / Math.max(1.05, cb.baseOdds));
  let spread = 0.87;
  let effectiveProb = jointProb;

  if (jointProb < entryJoint) {
    effectiveProb = Math.pow(jointProb, 1.15);
    spread = 0.83;
  } else if (wonCount >= 1 && jointProb > entryJoint * 1.35) {
    // Sélections déjà validées : offre psychologiquement attractive pour sécuriser tôt
    spread = 0.89;
  }

  // On valorise sur le gain de base hors bonus tant que le combiné n'est pas allé au bout
  const basePot = cb.stake * cb.baseOdds;
  const offer = basePot * effectiveProb * spread;
  if (offer < cb.stake * 0.08) return null;

  return round2(Math.min(cb.potentialWin * 0.92, Math.max(0.1, offer)));
}
