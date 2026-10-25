import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, predictionBets, predictionQuestions } from "@/db/schema";
import {
  PRED_MAX_STAKE,
  PRED_MIN_STAKE,
  round2,
  settleResolvedQuestions,
} from "@/lib/predictions";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRED_SELECTIONS = ["yes", "no"] as const;
type PredSelection = (typeof PRED_SELECTIONS)[number];

const PRED_CATEGORIES = ["Sport", "Actus", "Crypto", "Culture"] as const;

const BET_COOLDOWN_MS = 700;

export async function GET(req: NextRequest) {
  await ensureSeeded();
  await settleResolvedQuestions();

  const uid = (await getAuthUserId(req)) ?? 1;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 10));
  const status = req.nextUrl.searchParams.get("status");
  const category = req.nextUrl.searchParams.get("category");

  const filters: SQL[] = [];
  if (status === "open" || status === "resolved") {
    filters.push(eq(predictionQuestions.status, status));
  }
  if (category && (PRED_CATEGORIES as readonly string[]).includes(category)) {
    filters.push(eq(predictionQuestions.category, category));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(predictionQuestions)
    .where(where);

  const rows = await db
    .select()
    .from(predictionQuestions)
    .where(where)
    .orderBy(
      asc(sql`CASE ${predictionQuestions.status} WHEN 'open' THEN 0 ELSE 1 END`),
      asc(predictionQuestions.resolvesAt),
      desc(predictionQuestions.id)
    )
    .limit(limit)
    .offset((page - 1) * limit);

  // Paris de l'utilisateur connecté, par question (pour le badge « Votre mise »).
  const myBets = await db
    .select({
      questionId: predictionBets.questionId,
      selection: predictionBets.selection,
      status: predictionBets.status,
      stake: predictionBets.stake,
      potentialWin: predictionBets.potentialWin,
      odds: predictionBets.odds,
      cashOutAmount: predictionBets.cashOutAmount,
    })
    .from(predictionBets)
    .where(eq(predictionBets.userId, uid));

  const myBetsByQuestion = new Map<number, (typeof myBets)[number][]>();
  for (const b of myBets) {
    const arr = myBetsByQuestion.get(b.questionId) ?? [];
    arr.push(b);
    myBetsByQuestion.set(b.questionId, arr);
  }

  // Cotes fixes bookmaker : ne dépendent pas d'un pool mutuel entre joueurs.
  const questions = rows.map((q) => {
    const mine = myBetsByQuestion.get(q.id) ?? [];
    return {
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
      myBet: mine.length > 0 ? mine[mine.length - 1] : null,
    };
  });

  return NextResponse.json({
    questions,
    total,
    page,
    limit,
    hasMore: page * limit < total,
  });
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

  // Cote fixe verrouillée au moment de la validation : gain = mise × cote garanti.
  const isYes = selection === "yes";
  const odds = isYes ? question.oddsYes : question.oddsNo;
  const selectionLabel = isYes ? "Oui" : "Non";
  const roundedStakeValue = round2(stake);
  const potentialWin = round2(roundedStakeValue * odds);

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
        stake: roundedStakeValue,
        potentialWin,
        status: "pending",
      })
      .returning();

    const [updatedUser] = await tx
      .update(appUser)
      .set({ balance: sql`${appUser.balance} - ${roundedStakeValue}` })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    await tx
      .update(predictionQuestions)
      .set({
        volume: sql`${predictionQuestions.volume} + ${roundedStakeValue}`,
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
