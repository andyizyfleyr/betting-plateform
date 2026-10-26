import { and, asc, desc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { notifyNewBetPlaced } from "@/lib/active-state-cache";
import { appUser, predictionBets, predictionQuestions } from "@/db/schema";
import {
  PRED_MAX_STAKE,
  PRED_MIN_STAKE,
  round2,
} from "@/lib/predictions";
import {
  checkOddsChange,
  normalizeOddsPolicy,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/odds-lock";
import { formatServerErrorResponse } from "@/lib/db-error";
import {
  invalidatePredictionsCatalogCache,
  jsonWithEtag,
} from "@/lib/response-cache";
import { requireUserId } from "@/lib/session";
import { syncAllSettlementsThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PRED_SELECTIONS = ["yes", "no"] as const;
type PredSelection = (typeof PRED_SELECTIONS)[number];

const PRED_CATEGORIES = ["Sport", "Actus", "Crypto", "Culture"] as const;

const BET_COOLDOWN_MS = 700;

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

  await syncAllSettlementsThrottled();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
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

  // 1 seule requête SQL avec `COUNT(*) OVER()::int` (fusionne le count total + la page courante)
  const rowsWithTotal = await db
    .select({
      ...getTableColumns(predictionQuestions),
      totalCount: sql<number>`COUNT(*) OVER()::int`,
    })
    .from(predictionQuestions)
    .where(where)
    .orderBy(
      asc(sql`CASE ${predictionQuestions.status} WHEN 'open' THEN 0 ELSE 1 END`),
      asc(predictionQuestions.resolvesAt),
      desc(predictionQuestions.id)
    )
    .limit(limit)
    .offset((page - 1) * limit);

  let total = rowsWithTotal[0]?.totalCount ?? 0;
  if (rowsWithTotal.length === 0 && page > 1) {
    const [cnt] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(predictionQuestions)
      .where(where);
    total = cnt?.total ?? 0;
  }

  // Ne charge les paris de l'utilisateur QUE pour les questions affichées sur la page courante
  const pageIds = rowsWithTotal.map((r) => r.id);
  const myBets =
    pageIds.length > 0
      ? await db
          .select({
            questionId: predictionBets.questionId,
            selection: predictionBets.selection,
            selectionLabel: predictionBets.selectionLabel,
            status: predictionBets.status,
            stake: predictionBets.stake,
            potentialWin: predictionBets.potentialWin,
            odds: predictionBets.odds,
            cashOutAmount: predictionBets.cashOutAmount,
          })
          .from(predictionBets)
          .where(
            and(
              eq(predictionBets.userId, uid),
              inArray(predictionBets.questionId, pageIds)
            )
          )
      : [];

  const myBetsByQuestion = new Map<number, (typeof myBets)[number][]>();
  for (const b of myBets) {
    const arr = myBetsByQuestion.get(b.questionId) ?? [];
    arr.push(b);
    myBetsByQuestion.set(b.questionId, arr);
  }

  // Cotes fixes bookmaker : ne dépendent pas d'un pool mutuel entre joueurs.
  // Filet de sécurité anti-doublon d'affichage (au cas où deux intitulés proches existeraient).
  const seenTitles = new Set<string>();
  const dedupedRows = rowsWithTotal.filter((q) => {
    const k = q.question.trim().toLowerCase();
    if (seenTitles.has(k)) return false;
    seenTitles.add(k);
    return true;
  });

  const questions = dedupedRows.map((q) => {
    const mine = myBetsByQuestion.get(q.id) ?? [];
    return {
      id: q.id,
      question: q.question,
      category: q.category,
      status: q.status,
      resolution: q.resolution,
      oddsYes: q.oddsYes,
      oddsNo: q.oddsNo,
      options: q.options ?? null,
      volume: q.volume,
      yesCount: q.yesCount,
      noCount: q.noCount,
      resolvesAt: q.resolvesAt.toISOString(),
      resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
      myBet: mine.length > 0 ? mine[mine.length - 1] : null,
    };
  });

  return jsonWithEtag(req, {
    questions,
    total,
    page,
    limit,
    hasMore: page * limit < total,
  });
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/predictions");
  }
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;

  let body: {
    questionId?: number;
    selection?: string;
    stake?: number;
    expectedOdds?: number;
    oddsPolicy?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const { questionId, selection, stake } = body;
  const expectedOdds = Number(body.expectedOdds);
  const oddsPolicy = normalizeOddsPolicy(body.oddsPolicy);

  if (!questionId || !selection || !stake || stake <= 0) {
    return NextResponse.json({ error: "Données du pari incomplètes" }, { status: 400 });
  }
  if (!Number.isFinite(expectedOdds) || expectedOdds <= 1) {
    return NextResponse.json(
      { error: "Cote affichée manquante ou invalide — veuillez rafraîchir la question" },
      { status: 400 }
    );
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

  const roundedStakeValue = round2(stake);

  type PredTxOutcome =
    | { kind: "ok"; bet: typeof predictionBets.$inferSelect; balance: number }
    | { kind: "error"; status: number; error: string }
    | { kind: "odds_changed"; details: OddsChangedDetails };

  const txResult: PredTxOutcome = await db.transaction(async (tx) => {
    const [question] = await tx
      .select()
      .from(predictionQuestions)
      .where(eq(predictionQuestions.id, questionId))
      .for("update");

    if (!question) {
      return { kind: "error", status: 404, error: "Question introuvable" };
    }
    if (question.status !== "open") {
      return { kind: "error", status: 400, error: "Cette question est résolue" };
    }
    if (question.resolvesAt.getTime() <= Date.now()) {
      return {
        kind: "error",
        status: 400,
        error: "Les paris sont clos sur cette question",
      };
    }

    const isMultiChoice =
      Array.isArray(question.options) && question.options.length >= 2;
    let rawServerOdds: number;
    let selectionLabel: string;
    let incYes = 0;
    let incNo = 0;

    if (isMultiChoice && question.options) {
      const matched = question.options.find((opt) => opt.key === selection);
      if (!matched) {
        return { kind: "error", status: 400, error: "Sélection invalide" };
      }
      rawServerOdds = matched.odds;
      selectionLabel = matched.label;
      incYes = 1;
    } else {
      if (!PRED_SELECTIONS.includes(selection as PredSelection)) {
        return { kind: "error", status: 400, error: "Sélection invalide" };
      }
      const isYes = selection === "yes";
      rawServerOdds = isYes ? question.oddsYes : question.oddsNo;
      selectionLabel = isYes ? "Oui" : "Non";
      incYes = isYes ? 1 : 0;
      incNo = isYes ? 0 : 1;
    }

    const serverOdds = roundOdds2(rawServerOdds);

    // Vérification de la cote dans la même transaction AVANT tout débit
    const oddsCheck = checkOddsChange({
      expectedOdds,
      serverOdds,
      policy: oddsPolicy,
    });
    if (!oddsCheck.ok) {
      return {
        kind: "odds_changed",
        details: {
          previousOdds: oddsCheck.roundedExpectedOdds,
          currentOdds: oddsCheck.roundedServerOdds,
          direction: oddsCheck.direction,
        },
      };
    }

    const [lockedUser] = await tx
      .select({ id: appUser.id, balance: appUser.balance })
      .from(appUser)
      .where(eq(appUser.id, uid))
      .for("update");

    if (!lockedUser || lockedUser.balance < roundedStakeValue) {
      return { kind: "error", status: 400, error: "Solde insuffisant" };
    }

    // Gain calculé EXCLUSIVEMENT avec `serverOdds`
    const potentialWin = round2(roundedStakeValue * serverOdds);

    const [bet] = await tx
      .insert(predictionBets)
      .values({
        userId: uid,
        questionId: question.id,
        selection,
        selectionLabel,
        question: question.question,
        category: question.category,
        odds: serverOdds,
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
        yesCount: sql`${predictionQuestions.yesCount} + ${incYes}`,
        noCount: sql`${predictionQuestions.noCount} + ${incNo}`,
      })
      .where(eq(predictionQuestions.id, question.id));

    return { kind: "ok", bet, balance: updatedUser.balance };
  });

  if (txResult.kind === "odds_changed") {
    const dirLabel =
      txResult.details.direction === "up" ? "augmenté" : "évolué";
    return NextResponse.json(
      {
        error: `La cote a ${dirLabel} (${txResult.details.previousOdds.toFixed(2).replace(".", ",")} → ${txResult.details.currentOdds.toFixed(2).replace(".", ",")}). Confirmez la nouvelle cote pour valider.`,
        code: ODDS_CHANGED_CODE,
        details: txResult.details,
      },
      { status: 409 }
    );
  }

  if (txResult.kind === "error") {
    return NextResponse.json(
      { error: txResult.error },
      { status: txResult.status }
    );
  }

  invalidatePredictionsCatalogCache();
  notifyNewBetPlaced({ userId: uid, kind: "prediction" });
  return NextResponse.json({
    bet: {
      id: txResult.bet.id,
      questionId: txResult.bet.questionId,
      question: txResult.bet.question,
      category: txResult.bet.category,
      selection: txResult.bet.selection,
      selectionLabel: txResult.bet.selectionLabel,
      odds: txResult.bet.odds,
      stake: txResult.bet.stake,
      potentialWin: txResult.bet.potentialWin,
      status: txResult.bet.status,
      placedAt: txResult.bet.placedAt.toISOString(),
    },
    balance: txResult.balance,
  });
}
