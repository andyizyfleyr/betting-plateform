import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hydrateLiveMatchRow } from "@/db/engine";
import { ensureSeeded } from "@/db/seed";
import {
  appUser,
  bets,
  comboBets,
  matches,
  predictionBets,
  predictionQuestions,
  type MatchRow,
  type PredictionQuestionRow,
} from "@/db/schema";
import { notifyBetsSettledOrMutated } from "@/lib/active-state-cache";
import { computeCashOut, computePredictionCashOut } from "@/lib/cashout";
import { computeComboCashOut } from "@/lib/combo";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import { verifyLiveRealMatchesBeforeBet } from "@/lib/real-sports-feed";
import { requireUserId } from "@/lib/session";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

/** Encaisse un pari en cours (sportif, prédiction ou combiné). */
export async function POST(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;
  await syncLiveMatchesThrottled();

  let body: { betId?: number; kind?: "sport" | "prediction" | "combo" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const betId = Number(body.betId);
  const kind = body.kind;
  if (!betId) {
    return NextResponse.json({ error: "Pari introuvable" }, { status: 400 });
  }

  // 1. Pari combiné
  if (kind === "combo") {
    const [cb] = await db
      .select()
      .from(comboBets)
      .where(and(eq(comboBets.id, betId), eq(comboBets.userId, uid)));

    if (!cb || cb.status !== "pending") {
      return NextResponse.json({ error: "Ce coupon ne peut plus être vendu" }, { status: 400 });
    }

    const matchIds = (cb.legs ?? [])
      .filter((l) => l.kind === "sport" && l.matchId)
      .map((l) => l.matchId as number);
    const questionIds = (cb.legs ?? [])
      .filter((l) => l.kind === "prediction" && l.questionId)
      .map((l) => l.questionId as number);

    const [mRows, qRows] = await Promise.all([
      matchIds.length > 0
        ? db.select().from(matches).where(inArray(matches.id, matchIds))
        : Promise.resolve([] as MatchRow[]),
      questionIds.length > 0
        ? db
            .select()
            .from(predictionQuestions)
            .where(inArray(predictionQuestions.id, questionIds))
        : Promise.resolve([] as PredictionQuestionRow[]),
    ]);

    const liveRealComboRows = mRows.filter(
      (m) => m.status === "live" && m.source === "manual"
    );
    const nowCashMs = Date.now();
    const effectiveMatchMap = new Map(
      mRows.map((m) => [m.id, hydrateLiveMatchRow(m, nowCashMs)])
    );
    if (liveRealComboRows.length > 0) {
      const realGuard = await verifyLiveRealMatchesBeforeBet(liveRealComboRows);
      if (!realGuard.ok) {
        return NextResponse.json(
          { error: realGuard.error },
          { status: 409 }
        );
      }
      for (const [mid, freshRow] of realGuard.refreshedMap.entries()) {
        effectiveMatchMap.set(mid, freshRow);
      }
    }

    const value = computeComboCashOut(
      cb,
      effectiveMatchMap,
      new Map(qRows.map((q) => [q.id, q]))
    );
    if (value == null) {
      return NextResponse.json(
        { error: "La vente du coupon est momentanément indisponible sur ce combiné" },
        { status: 400 }
      );
    }

    const balance = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(comboBets)
        .set({ status: "cashed", cashOutAmount: value, settledAt: new Date() })
        .where(and(eq(comboBets.id, cb.id), eq(comboBets.status, "pending")))
        .returning({ id: comboBets.id });
      if (!u) return null;

      const [updatedUser] = await tx
        .update(appUser)
        .set({ balance: sql`${appUser.balance} + ${value}` })
        .where(eq(appUser.id, uid))
        .returning({ balance: appUser.balance });
      return updatedUser.balance;
    });

    if (balance == null) {
      return NextResponse.json({ error: "Ce combiné vient d'être réglé" }, { status: 400 });
    }
    notifyBetsSettledOrMutated([uid]);
    invalidateHouseHealthCache();
    return NextResponse.json({ balance, value });
  }

  // 2. Pari sportif simple
  if (!kind || kind === "sport") {
    const [sportRow] = await db
      .select({ bet: bets, match: matches })
      .from(bets)
      .leftJoin(matches, eq(bets.matchId, matches.id))
      .where(and(eq(bets.id, betId), eq(bets.userId, uid)));

    if (sportRow && sportRow.bet) {
      const { bet, match } = sportRow;
      if (bet.status !== "pending") {
        if (kind === "sport") {
          return NextResponse.json({ error: "Ce coupon ne peut plus être vendu" }, { status: 400 });
        }
      } else {
        const syncedSportMatch = match ? hydrateLiveMatchRow(match) : null;
        if (!syncedSportMatch || syncedSportMatch.status !== "live") {
          return NextResponse.json(
            { error: "La vente du coupon n'est disponible que pendant le match" },
            { status: 400 }
          );
        }
        if (syncedSportMatch.suspended) {
          return NextResponse.json(
            { error: "Marché suspendu — vente du coupon indisponible" },
            { status: 400 }
          );
        }
        let effectiveMatch = syncedSportMatch;
        if (syncedSportMatch.source === "manual") {
          const realGuard = await verifyLiveRealMatchesBeforeBet([syncedSportMatch]);
          if (!realGuard.ok) {
            return NextResponse.json(
              { error: realGuard.error },
              { status: 409 }
            );
          }
          effectiveMatch =
            realGuard.refreshedMap.get(syncedSportMatch.id) ?? syncedSportMatch;
        }
        const value = computeCashOut({
          stake: bet.stake,
          odds: bet.odds,
          sport: bet.sport,
          minute: effectiveMatch.minute,
          market: bet.market,
          selection: bet.selection,
          homeTeam: effectiveMatch.homeTeam,
          awayTeam: effectiveMatch.awayTeam,
          homeScore: effectiveMatch.homeScore,
          awayScore: effectiveMatch.awayScore,
          htHomeScore:
            effectiveMatch.htHomeScore ?? effectiveMatch.realStats?.htHomeScore ?? null,
          htAwayScore:
            effectiveMatch.htAwayScore ?? effectiveMatch.realStats?.htAwayScore ?? null,
          redHome: effectiveMatch.redHome,
          redAway: effectiveMatch.redAway,
          homeForm: effectiveMatch.homeForm,
          awayForm: effectiveMatch.awayForm,
          events: effectiveMatch.events ?? null,
          matchId: effectiveMatch.id,
          source: effectiveMatch.source ?? "virtual",
          externalId: effectiveMatch.externalId ?? null,
          autoSync: effectiveMatch.autoSync ?? true,
          oddsHome: effectiveMatch.oddsHome,
          oddsDraw: effectiveMatch.oddsDraw,
          oddsAway: effectiveMatch.oddsAway,
          markets: effectiveMatch.markets ?? null,
        });
        if (value == null) {
          return NextResponse.json(
            { error: "La vente du coupon n'est plus disponible sur ce pari actuellement" },
            { status: 400 }
          );
        }

        const balance = await db.transaction(async (tx) => {
          const [u] = await tx
            .update(bets)
            .set({ status: "cashed", cashOutAmount: value, settledAt: new Date() })
            .where(and(eq(bets.id, bet.id), eq(bets.status, "pending")))
            .returning({ id: bets.id });
          if (!u) return null;

          const [updatedUser] = await tx
            .update(appUser)
            .set({ balance: sql`${appUser.balance} + ${value}` })
            .where(eq(appUser.id, uid))
            .returning({ balance: appUser.balance });
          return updatedUser.balance;
        });

        if (balance == null) {
          return NextResponse.json({ error: "Ce pari vient d'être réglé" }, { status: 400 });
        }
        notifyBetsSettledOrMutated([uid]);
        invalidateHouseHealthCache();
        return NextResponse.json({ balance, value });
      }
    } else if (kind === "sport") {
      return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
    }
  }

  // 3. Pari de prédiction
  const [predRow] = await db
    .select({ bet: predictionBets, question: predictionQuestions })
    .from(predictionBets)
    .leftJoin(predictionQuestions, eq(predictionBets.questionId, predictionQuestions.id))
    .where(and(eq(predictionBets.id, betId), eq(predictionBets.userId, uid)));

  if (predRow && predRow.bet) {
    const { bet, question } = predRow;
    if (bet.status !== "pending") {
      return NextResponse.json({ error: "Ce coupon ne peut plus être vendu" }, { status: 400 });
    }
    if (!question || question.status !== "open" || question.resolvesAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "La vente du coupon n'est disponible que sur les prédictions ouvertes" },
        { status: 400 }
      );
    }

    const value = computePredictionCashOut({
      stake: bet.stake,
      odds: bet.odds,
      potentialWin: bet.potentialWin,
      placedAt: bet.placedAt,
      resolvesAt: question.resolvesAt,
      currentOddsYes: question.oddsYes,
      currentOddsNo: question.oddsNo,
      options: question.options ?? null,
      selection: bet.selection,
    });

    const balance = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(predictionBets)
        .set({ status: "cashed", cashOutAmount: value, settledAt: new Date() })
        .where(and(eq(predictionBets.id, bet.id), eq(predictionBets.status, "pending")))
        .returning({ id: predictionBets.id });
      if (!u) return null;

      const [updatedUser] = await tx
        .update(appUser)
        .set({ balance: sql`${appUser.balance} + ${value}` })
        .where(eq(appUser.id, uid))
        .returning({ balance: appUser.balance });
      return updatedUser.balance;
    });

    if (balance == null) {
      return NextResponse.json({ error: "Ce pari vient d'être réglé" }, { status: 400 });
    }
    notifyBetsSettledOrMutated([uid]);
    invalidateHouseHealthCache();
    return NextResponse.json({ balance, value });
  }

  return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
}
