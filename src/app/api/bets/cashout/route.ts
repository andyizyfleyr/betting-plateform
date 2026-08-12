import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { appUser, bets, matches, predictionBets, predictionQuestions } from "@/db/schema";
import { computeCashOut, computePredictionCashOut } from "@/lib/cashout";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Encaisse un pari en cours sur un match en direct (cash-out). */
export async function POST(req: NextRequest) {
  await ensureSeeded();
  await runLiveEngine();
  const uid = (await getAuthUserId(req)) ?? 1;

  let body: { betId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const betId = Number(body.betId);
  if (!betId) {
    return NextResponse.json({ error: "Pari introuvable" }, { status: 400 });
  }

  // 1. Essayer de trouver un pari sportif
  const [sportRow] = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(and(eq(bets.id, betId), eq(bets.userId, uid)));

  if (sportRow && sportRow.bet) {
    const { bet, match } = sportRow;
    if (bet.status !== "pending") {
      return NextResponse.json({ error: "Ce pari n'est plus encaissable" }, { status: 400 });
    }
    if (!match || match.status !== "live") {
      return NextResponse.json(
        { error: "Le cash-out n'est disponible que pendant le match" },
        { status: 400 }
      );
    }
    if (match.suspended) {
      return NextResponse.json(
        { error: "Marché suspendu — cash-out indisponible" },
        { status: 400 }
      );
    }
    if (bet.market !== "result") {
      return NextResponse.json(
        { error: "Le cash-out n'est pas disponible pour ce marché" },
        { status: 400 }
      );
    }

    const value = computeCashOut({
      stake: bet.stake,
      odds: bet.odds,
      sport: bet.sport,
      minute: match.minute,
      selection: bet.selection,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    });

    await db
      .update(bets)
      .set({ status: "cashed", cashOutAmount: value })
      .where(eq(bets.id, bet.id));

    const [updatedUser] = await db
      .update(appUser)
      .set({ balance: sql`${appUser.balance} + ${value}` })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    return NextResponse.json({ balance: updatedUser.balance, value });
  }

  // 2. Sinon, essayer de trouver un pari de prédiction
  const [predRow] = await db
    .select({ bet: predictionBets, question: predictionQuestions })
    .from(predictionBets)
    .leftJoin(predictionQuestions, eq(predictionBets.questionId, predictionQuestions.id))
    .where(and(eq(predictionBets.id, betId), eq(predictionBets.userId, uid)));

  if (predRow && predRow.bet) {
    const { bet, question } = predRow;
    if (bet.status !== "pending") {
      return NextResponse.json({ error: "Ce pari n'est plus encaissable" }, { status: 400 });
    }
    if (!question || question.status !== "open" || question.resolvesAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Le cash-out n'est disponible que sur les prédictions ouvertes" },
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
      selection: bet.selection as "yes" | "no",
    });

    await db
      .update(predictionBets)
      .set({ status: "cashed", cashOutAmount: value })
      .where(eq(predictionBets.id, bet.id));

    const [updatedUser] = await db
      .update(appUser)
      .set({ balance: sql`${appUser.balance} + ${value}` })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    return NextResponse.json({ balance: updatedUser.balance, value });
  }

  return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
}
