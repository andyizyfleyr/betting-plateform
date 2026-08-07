import { asc, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, predictionBets, predictionQuestions } from "@/db/schema";
import {
  driftOdds,
  PRED_MAX_STAKE,
  PRED_MIN_STAKE,
  round2,
  settleResolvedQuestions,
} from "@/lib/predictions";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRED_SELECTIONS = ["yes", "no"] as const;
type PredSelection = (typeof PRED_SELECTIONS)[number];

/** Anti-triche : intervalle minimal entre deux paris (mêmes valeurs que les paris sportifs). */
const BET_COOLDOWN_MS = 700;

export async function GET() {
  await ensureSeeded();
  await settleResolvedQuestions();

  const rows = await db
    .select()
    .from(predictionQuestions)
    .orderBy(
      asc(
        sql`CASE ${predictionQuestions.status} WHEN 'open' THEN 0 ELSE 1 END`
      ),
      asc(predictionQuestions.resolvesAt),
      desc(predictionQuestions.id)
    );

  const questions = rows.map((q) => ({
    id: q.id,
    question: q.question,
    category: q.category,
    status: q.status,
    resolution: q.resolution,
    oddsYes: q.oddsYes,
    oddsNo: q.oddsNo,
    volume: q.volume,
    yesCount: q.yesCount,
    noCount: q.noCount,
    resolvesAt: q.resolvesAt.toISOString(),
    resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
  }));

  return NextResponse.json({ questions });
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  let body: { questionId?: number; selection?: string; stake?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const { questionId, selection, stake } = body;
  if (!questionId || !selection || !stake || stake <= 0) {
    return NextResponse.json({ error: "Données du pari incomplètes" }, { status: 400 });
  }
  if (!PRED_SELECTIONS.includes(selection as PredSelection)) {
    return NextResponse.json({ error: "Sélection invalide" }, { status: 400 });
  }
  if (stake < PRED_MIN_STAKE || stake > PRED_MAX_STAKE) {
    return NextResponse.json(
      { error: `Mise hors limites (${PRED_MIN_STAKE} € – ${PRED_MAX_STAKE} €)` },
      { status: 400 }
    );
  }

  // Anti-spam : une mise toutes les 700 ms maximum.
  const [lastBet] = await db
    .select({ placedAt: predictionBets.placedAt })
    .from(predictionBets)
    .where(eq(predictionBets.userId, uid))
    .orderBy(desc(predictionBets.placedAt))
    .limit(1);
  if (lastBet && Date.now() - lastBet.placedAt.getTime() < BET_COOLDOWN_MS) {
    return NextResponse.json({ error: "Trop rapide — veuillez patienter" }, { status: 429 });
  }

  const [question] = await db
    .select()
    .from(predictionQuestions)
    .where(eq(predictionQuestions.id, questionId));
  if (!question) {
    return NextResponse.json({ error: "Question introuvable" }, { status: 404 });
  }
  if (question.status !== "open") {
    return NextResponse.json({ error: "Cette question est résolue" }, { status: 400 });
  }
  if (question.resolvesAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Les paris sont clos sur cette question" }, { status: 400 });
  }

  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user || user.balance < stake) {
    return NextResponse.json({ error: "Solde insuffisant" }, { status: 400 });
  }

  // Recotation serveur : la cote est toujours lue depuis la base, jamais celle du client.
  const isYes = selection === "yes";
  const odds = isYes ? question.oddsYes : question.oddsNo;
  const selectionLabel = isYes ? "Oui" : "Non";
  const roundedStake = round2(stake);
  const potentialWin = round2(roundedStake * odds);

  // Transaction : pari + débit solde + mise à jour du marché (volume, compteurs, cotes).
  const result = await db.transaction(async (tx) => {
    const [bet] = await tx
      .insert(predictionBets)
      .values({
        userId: uid,
        questionId: question.id,
        selection,
        selectionLabel,
        question: question.question,
        category: question.category,
        odds,
        stake: roundedStake,
        potentialWin,
        status: "pending",
      })
      .returning();

    const [updatedUser] = await tx
      .update(appUser)
      .set({ balance: sql`${appUser.balance} - ${roundedStake}` })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    const [aOdds, bOdds] = isYes
      ? driftOdds(question.oddsYes, question.oddsNo)
      : driftOdds(question.oddsNo, question.oddsYes);
    await tx
      .update(predictionQuestions)
      .set({
        oddsYes: isYes ? aOdds : bOdds,
        oddsNo: isYes ? bOdds : aOdds,
        volume: sql`${predictionQuestions.volume} + ${roundedStake}`,
        yesCount: sql`${predictionQuestions.yesCount} + ${isYes ? 1 : 0}`,
        noCount: sql`${predictionQuestions.noCount} + ${isYes ? 0 : 1}`,
      })
      .where(eq(predictionQuestions.id, question.id));

    return { bet, balance: updatedUser.balance };
  });

  return NextResponse.json({
    bet: {
      id: result.bet.id,
      questionId: result.bet.questionId,
      question: result.bet.question,
      category: result.bet.category,
      selection: result.bet.selection,
      selectionLabel: result.bet.selectionLabel,
      odds: result.bet.odds,
      stake: result.bet.stake,
      potentialWin: result.bet.potentialWin,
      status: result.bet.status,
      placedAt: result.bet.placedAt.toISOString(),
    },
    balance: result.balance,
  });
}
