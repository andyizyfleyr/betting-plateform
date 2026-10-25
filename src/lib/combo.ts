import { eq, inArray, ne, and, sql } from "drizzle-orm";
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
import {
  isKnownMarket,
  isRealMatchPostIncidentSuspended,
  liveOutcomeProbability,
  marketSettle,
  minuteNumber,
  realMatchLiveProbability,
  realMatchSettle,
  tryEarlyLiveSettle,
} from "@/lib/markets";
import {
  getRealMatchSettlementMode,
  isRealMatchFeedStale,
  type RealMatchSettlementMode,
} from "@/lib/real-sports-feed";

const REAL_COMBO_GOAL_CONFIRM_MS = 90_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcule le statut réel d'une sélection de combiné à partir de l'état actuel
 * du match ou de la question de prédiction associée.
 */
export function resolveComboLegStatus(
  leg: ComboLeg,
  matchMap: Map<number, MatchRow>,
  questionMap: Map<number, PredictionQuestionRow>,
  opts?: { realSettlementMode?: RealMatchSettlementMode; nowMs?: number }
): "pending" | "won" | "lost" | "void" {
  if (leg.status !== "pending") return leg.status;

  if (leg.kind === "sport") {
    const m = leg.matchId ? matchMap.get(leg.matchId) : undefined;
    if (!m) return "void";
    if (m.feedStatusNote === "VOIDED") return "void";

    if (m.status === "live") {
      if (m.feedStatusNote?.startsWith("POSTPONED")) return "pending";
      const isManual = m.source === "manual";
      const realMode = opts?.realSettlementMode ?? "auto";
      if (isManual && realMode !== "auto") return "pending";

      const early = tryEarlyLiveSettle(leg.market, leg.selection, {
        source: isManual ? "manual" : "virtual",
        status: m.status,
        minute: m.minute,
        homeScore: m.homeScore ?? 0,
        awayScore: m.awayScore ?? 0,
        htHomeScore: m.htHomeScore ?? m.realStats?.htHomeScore ?? null,
        htAwayScore: m.htAwayScore ?? m.realStats?.htAwayScore ?? null,
        events: m.events ?? null,
        matchId: m.id,
      });
      if (!early) return "pending";

      const nowMs = opts?.nowMs ?? Date.now();
      const isSecondHalfInPlay = minuteNumber(m.minute) >= 46;
      const isPureFirstHalfMarket =
        leg.market === "ht_result" || leg.market === "ht_total_ou" || leg.market === "ht_ft";

      if (isManual && early.dependsOnGoals && !(isSecondHalfInPlay && isPureFirstHalfMarket)) {
        if (m.suspended) return "pending";
        if (m.lastGoalAt && nowMs - m.lastGoalAt.getTime() < REAL_COMBO_GOAL_CONFIRM_MS) {
          return "pending";
        }
      }
      return early.voided ? "void" : early.won ? "won" : "lost";
    }

    if (m.status !== "finished") return "pending";

    const home = m.homeScore ?? 0;
    const away = m.awayScore ?? 0;
    if (!isKnownMarket(leg.market)) {
      if (leg.market === "result") {
        const won =
          leg.selection === "home"
            ? home > away
            : leg.selection === "away"
              ? away > home
              : home === away;
        return won ? "won" : "lost";
      }
      return "void";
    }
    const { won, voided } =
      m.source === "manual"
        ? realMatchSettle(
            leg.market,
            leg.selection,
            home,
            away,
            m.events ?? null,
            m.id,
            m.htHomeScore ?? null,
            m.htAwayScore ?? null
          )
        : marketSettle(
            leg.market,
            leg.selection,
            home,
            away,
            m.events ?? null,
            m.id
          );
    return voided ? "void" : won ? "won" : "lost";
  }

  const q = leg.questionId ? questionMap.get(leg.questionId) : undefined;
  if (!q) return "void";
  if (q.status !== "resolved" || !q.resolution) return "pending";
  return q.resolution === leg.selection ? "won" : "lost";
}

/**
 * Règle automatiquement tous les paris combinés en cours (`status = "pending"`)
 * ET met également à jour le statut final des sélections restantes sur les combinés
 * déjà classés (`lost` / `cashed`) dès que leurs matchs se terminent :
 * - Met à jour le statut individuel de chaque sélection (`won` / `lost` / `void`)
 * - Dès qu'une seule sélection est perdante (`lost`), le combiné passe immédiatement en `lost`
 * - Lorsque toutes les sélections sont terminées (`won` ou `void`), recalcule le gain
 *   exact sur les sélections gagnantes (remboursement si 100 % annulé) et crédite le solde.
 */
export async function settlePendingCombos(): Promise<void> {
  // 1 seule requête SQL couverte par l'index partiel `combo_bets_open_legs_idx`
  // (remplace les 2 requêtes séparées et le `legs::text LIKE` qui scannait toute la table).
  const openLegRows = await db
    .select()
    .from(comboBets)
    .where(
      sql`${comboBets.status} = 'pending' OR ${comboBets.legs} @> '[{"status":"pending"}]'::jsonb`
    );

  if (openLegRows.length === 0) return;

  const pending = openLegRows.filter((cb) => cb.status === "pending");
  const settledWithPendingLegs = openLegRows.filter((cb) => cb.status !== "pending");

  const matchIds = new Set<number>();
  const questionIds = new Set<number>();

  for (const cb of openLegRows) {
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
  const hasLiveManual = matchRows.some((m) => m.status === "live" && m.source === "manual");
  const realSettlementMode: RealMatchSettlementMode = hasLiveManual
    ? await getRealMatchSettlementMode()
    : "auto";
  const evalNowMs = Date.now();
  const legOpts = { realSettlementMode, nowMs: evalNowMs };

  interface LegsOnlyPatch {
    id: number;
    legsJson: string;
  }
  interface StatusTransitionPatch {
    id: number;
    legsJson: string;
    status: "lost" | "won" | "void";
    potentialWin: number;
    payout: number;
    settledAtIso: string;
  }

  const legsOnlyPatches: LegsOnlyPatch[] = [];
  const statusPatches: StatusTransitionPatch[] = [];

  // 1. Collecte les sélections désormais terminées sur les combinés déjà réglés (ex. perdus tôt)
  for (const cb of settledWithPendingLegs) {
    let changed = false;
    const updatedLegs: ComboLeg[] = (cb.legs ?? []).map((leg) => {
      if (leg.status !== "pending") return leg;
      const nextStatus = resolveComboLegStatus(leg, matchMap, questionMap, legOpts);
      if (nextStatus !== leg.status) {
        changed = true;
        return { ...leg, status: nextStatus };
      }
      return leg;
    });
    if (changed) {
      legsOnlyPatches.push({
        id: cb.id,
        legsJson: JSON.stringify(updatedLegs),
      });
    }
  }

  const legResolvedMs = (leg: ComboLeg): number | null => {
    if (leg.kind === "sport" && leg.matchId) {
      const m = matchMap.get(leg.matchId);
      return m?.finishedAt ? m.finishedAt.getTime() : null;
    }
    if (leg.kind === "prediction" && leg.questionId) {
      const q = questionMap.get(leg.questionId);
      const dt = q?.resolvedAt ?? q?.resolvesAt ?? null;
      return dt ? dt.getTime() : null;
    }
    return null;
  };

  for (const cb of pending) {
    let legsChanged = false;
    const nextLegs: ComboLeg[] = (cb.legs ?? []).map((leg) => {
      if (leg.status !== "pending") return leg;
      const nextStatus = resolveComboLegStatus(leg, matchMap, questionMap, legOpts);
      if (nextStatus !== leg.status) {
        legsChanged = true;
        return { ...leg, status: nextStatus };
      }
      return leg;
    });

    const hasLost = nextLegs.some((l) => l.status === "lost");
    const allSettled = nextLegs.length > 0 && nextLegs.every((l) => l.status !== "pending");
    const minSettledMs = cb.placedAt ? cb.placedAt.getTime() + 1_000 : 0;

    if (hasLost) {
      const lostTimes = nextLegs
        .filter((l) => l.status === "lost")
        .map(legResolvedMs)
        .filter((t): t is number => t != null);
      const rawLostMs = lostTimes.length > 0 ? Math.min(...lostTimes) : evalNowMs;
      const settledAt = new Date(Math.min(evalNowMs, Math.max(minSettledMs, rawLostMs)));

      statusPatches.push({
        id: cb.id,
        legsJson: JSON.stringify(nextLegs),
        status: "lost",
        potentialWin: cb.potentialWin,
        payout: 0,
        settledAtIso: settledAt.toISOString(),
      });
      continue;
    }

    if (allSettled) {
      const allTimes = nextLegs
        .map(legResolvedMs)
        .filter((t): t is number => t != null);
      const rawWonMs = allTimes.length > 0 ? Math.max(...allTimes) : evalNowMs;
      const settledAt = new Date(Math.min(evalNowMs, Math.max(minSettledMs, rawWonMs)));

      const wonOdds = nextLegs.filter((l) => l.status === "won").map((l) => l.odds);
      const allVoid = wonOdds.length === 0;
      const quote = allVoid ? null : computeComboQuote(wonOdds, cb.stake);
      const payout =
        quote == null
          ? round2(cb.stake)
          : round2(Math.min(cb.potentialWin, quote.potentialWin));

      statusPatches.push({
        id: cb.id,
        legsJson: JSON.stringify(nextLegs),
        status: allVoid ? "void" : "won",
        potentialWin: payout,
        payout,
        settledAtIso: settledAt.toISOString(),
      });
      continue;
    }

    if (legsChanged) {
      legsOnlyPatches.push({
        id: cb.id,
        legsJson: JSON.stringify(nextLegs),
      });
    }
  }

  // Exécute les mises à jour de `legs` (sans transition de statut) en 1 seul lot SQL
  if (legsOnlyPatches.length > 0) {
    const legValues = sql.join(
      legsOnlyPatches.map((p) => sql`(${p.id}::int, ${p.legsJson}::jsonb)`),
      sql`, `
    );
    await db.execute(sql`
      UPDATE "combo_bets" AS cb
      SET "legs" = v.legs
      FROM (VALUES ${legValues}) AS v(id, legs)
      WHERE cb."id" = v.id
    `);
  }

  // Exécute tous les règlements finaux de combinés + crédits groupés de soldes en 1 seule requête SQL CTE atomique
  if (statusPatches.length > 0) {
    const settleValues = sql.join(
      statusPatches.map(
        (p) =>
          sql`(${p.id}::int, ${p.legsJson}::jsonb, ${p.status}::text, ${p.potentialWin}::float8, ${p.payout}::float8, ${p.settledAtIso}::timestamptz::timestamp)`
      ),
      sql`, `
    );
    await db.execute(sql`
      WITH updated AS (
        UPDATE "combo_bets" AS cb
        SET
          "legs" = v.legs,
          "status" = v.status,
          "potential_win" = v.potential_win,
          "settled_at" = v.settled_at
        FROM (VALUES ${settleValues}) AS v(id, legs, status, potential_win, payout, settled_at)
        WHERE cb."id" = v.id
          AND cb."status" = 'pending'
        RETURNING cb."user_id", v.payout
      )
      UPDATE "app_user" AS u
      SET "balance" = u."balance" + agg.total_payout
      FROM (
        SELECT "user_id", SUM(payout)::float8 AS total_payout
        FROM updated
        WHERE payout > 0
        GROUP BY "user_id"
      ) AS agg
      WHERE u."id" = agg."user_id"
    `);
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
    if (leg.status === "won") {
      wonCount += 1;
      continue;
    }
    if (leg.status === "void") {
      jointProb *= 1 / Math.max(1.01, leg.odds);
      wonCount += 1;
      continue;
    }

    if (leg.kind === "sport") {
      const m = leg.matchId ? matchMap.get(leg.matchId) : undefined;
      if (!m) continue;
      if (m.status === "finished") return null; // en attente de règlement imminent
      if (m.status === "live") {
        if (m.suspended) return null;
        if (
          m.source === "manual" &&
          (isRealMatchPostIncidentSuspended(m) || isRealMatchFeedStale(m))
        ) {
          return null;
        }
        const min = minuteNumber(m.minute);
        if (min >= 88) return null;
        if (
          tryEarlyLiveSettle(leg.market, leg.selection, {
            source: m.source === "manual" ? "manual" : "virtual",
            status: m.status,
            minute: m.minute,
            homeScore: m.homeScore ?? 0,
            awayScore: m.awayScore ?? 0,
            htHomeScore: m.htHomeScore ?? m.realStats?.htHomeScore ?? null,
            htAwayScore: m.htAwayScore ?? m.realStats?.htAwayScore ?? null,
            events: m.events ?? null,
            matchId: m.id,
          }) != null
        ) {
          return null; // sélection déjà tranchée — règlement imminent
        }
        hasLiveProgress = true;
        const pLive =
          m.source === "manual"
            ? realMatchLiveProbability(m, leg.market, leg.selection)
            : isKnownMarket(leg.market)
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
                    events: m.events ?? null,
                    matchId: m.id,
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
