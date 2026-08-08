import { and, count, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, bets, deposits, matches, predictionBets, predictionQuestions } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest): Promise<number | NextResponse> {
  await ensureSeeded();
  const uid = await getAuthUserId(req);
  if (!uid) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user || (user.role ?? "user") !== "admin") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  return uid;
}

/** Statistiques du tableau de bord + liste des données pour la gestion. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (typeof auth !== "number") return auth;

  const [totalUsers] = await db
    .select({ value: count() })
    .from(appUser);
  const [totalBets] = await db.select({ value: count() }).from(bets);
  const [totalPredBets] = await db.select({ value: count() }).from(predictionBets);
  const [totalDeposits] = await db.select({ value: count() }).from(deposits);
  const [totalStake] = await db
    .select({ value: sql<string>`COALESCE(SUM(${bets.stake}), 0)` })
    .from(bets);
  const [totalPayouts] = await db
    .select({
      value: sql<string>`COALESCE(SUM(CASE WHEN ${bets.status} = 'won' THEN ${bets.potentialWin} WHEN ${bets.status} = 'cashed' THEN ${bets.cashOutAmount} ELSE 0 END), 0)`,
    })
    .from(bets);
  const [liveMatch] = await db
    .select({ n: count() })
    .from(matches)
    .where(eq(matches.status, "live"));
  const [openQuestions] = await db
    .select({ n: count() })
    .from(predictionQuestions)
    .where(eq(predictionQuestions.status, "open"));
  const [totalBalance] = await db
    .select({ value: sql<string>`COALESCE(SUM(${appUser.balance}), 0)` })
    .from(appUser);

  const depositValue = Number(totalDeposits?.value ?? 0);
  const stake = Number(totalStake?.value ?? 0);
  const payouts = Number(totalPayouts?.value ?? 0);

  const users = await db
    .select()
    .from(appUser)
    .orderBy(desc(appUser.id));
  const betsRows = await db
    .select()
    .from(bets)
    .orderBy(desc(bets.placedAt))
    .limit(300);
  const depRows = await db
    .select()
    .from(deposits)
    .orderBy(desc(deposits.createdAt))
    .limit(200);
  const matchRows = await db
    .select()
    .from(matches)
    .orderBy(desc(matches.id))
    .limit(200);
  const questionRows = await db
    .select()
    .from(predictionQuestions)
    .orderBy(desc(predictionQuestions.id))
    .limit(200);
  const predBetsRows = await db
    .select()
    .from(predictionBets)
    .orderBy(desc(predictionBets.placedAt))
    .limit(300);

  return NextResponse.json({
    stats: {
      totalUsers: totalUsers?.value ?? 0,
      totalBets: (totalBets?.value ?? 0) + (totalPredBets?.value ?? 0),
      sportsBets: totalBets?.value ?? 0,
      predBets: totalPredBets?.value ?? 0,
      deposits: depositValue,
      stake,
      payouts,
      balance: Number(totalBalance?.value ?? 0),
      liveMatches: liveMatch?.n ?? 0,
      openQuestions: openQuestions?.n ?? 0,
      netRevenue: stake - payouts,
    },
    users: users.map(publicUser),
    bets: betsRows,
    predictionBets: predBetsRows,
    deposits: depRows,
    matches: matchRows,
    questions: questionRows.map((q) => ({
      ...q,
      resolvesAt: q.resolvesAt.toISOString(),
      resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
    })),
  });
}

type Action =
  | { action: "setBalance"; userId: number; amount: number }
  | { action: "addMatch"; home: string; away: string; league?: string; oddsHome?: number; oddsDraw?: number; oddsAway?: number }
  | { action: "deleteMatch"; matchId: number }
  | { action: "toggleMatch"; matchId: number; suspended: boolean }
  | { action: "addQuestion"; question: string; category?: string; oddsYes?: number; oddsNo?: number; hours?: number }
  | { action: "resolveQuestion"; questionId: number; resolution: "yes" | "no" }
  | { action: "deleteQuestion"; questionId: number }
  | { action: "selectAll"; from: string };

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (typeof auth !== "number") return auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const action = body.action as string;

  if (action === "setBalance") {
    const userId = Number(body.userId);
    const amount = roundNumber(body.amount);
    if (!userId || amount == null) {
      return NextResponse.json({ error: "userId et amount requis" }, { status: 400 });
    }
    const [u] = await db
      .update(appUser)
      .set({ balance: amount })
      .where(eq(appUser.id, userId))
      .returning();
    if (!u) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true, user: publicUser(u) });
  }

  if (action === "addMatch") {
    const home = String(body.home ?? "").trim();
    const away = String(body.away ?? "").trim();
    if (!home || !away) {
      return NextResponse.json({ error: "Les deux équipes sont requises" }, { status: 400 });
    }
    const league = String(body.league ?? "Football").trim();
    const oddsHome = roundNumber(body.oddsHome) ?? 1.9;
    const oddsDraw = roundNumber(body.oddsDraw) ?? 3.3;
    const oddsAway = roundNumber(body.oddsAway) ?? 3.1;
    const status = body.status === "live" ? "live" : "upcoming";
    const startsAt = status === "live" ? new Date() : new Date(Date.now() + 10 * 60_000);
    const [m] = await db
      .insert(matches)
      .values({
        sport: "football",
        league,
        homeTeam: home,
        awayTeam: away,
        homeScore: null,
        awayScore: null,
        status,
        minute: status === "live" ? "30'" : null,
        startsAt,
        oddsHome,
        oddsDraw,
        oddsAway,
        suspended: false,
        redHome: 0,
        redAway: 0,
        events: [],
        tickHistory: [],
        regime: "balanced",
        homeForm: 1,
        awayForm: 1,
        source: "manual",
      })
      .returning();
    return NextResponse.json({ ok: true, match: m });
  }

  if (action === "deleteMatch") {
    const matchId = Number(body.matchId);
    if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
    const linked = await db.select({ id: bets.id }).from(bets).where(eq(bets.matchId, matchId)).limit(1);
    if (linked[0]) {
      return NextResponse.json({ error: "Ce match a des paris liés, suppression bloquée" }, { status: 400 });
    }
    await db.delete(matches).where(eq(matches.id, matchId));
    return NextResponse.json({ ok: true });
  }

  if (action === "toggleMatch") {
    const matchId = Number(body.matchId);
    const suspended = Boolean(body.suspended);
    await db.update(matches).set({ suspended }).where(eq(matches.id, matchId));
    return NextResponse.json({ ok: true });
  }

  if (action === "addQuestion") {
    const question = String(body.question ?? "").trim();
    if (!question) return NextResponse.json({ error: "La question est requise" }, { status: 400 });
    const category = String(body.category ?? "Sport").trim();
    const oddsYes = roundNumber(body.oddsYes) ?? 1.9;
    const oddsNo = roundNumber(body.oddsNo) ?? 1.8;
    const hours = Math.max(1, Number(body.resolvesAt) || 72);
    const resolvesAt = new Date(Date.now() + hours * 3_600_000);
    const [q] = await db
      .insert(predictionQuestions)
      .values({
        question,
        category,
        status: "open",
        resolution: null,
        seedValue: Math.floor(Math.random() * 100) + 1,
        oddsYes,
        oddsNo,
        volume: 0,
        yesCount: 0,
        noCount: 0,
        resolvesAt,
      })
      .returning();
    return NextResponse.json({ ok: true, question: q });
  }

  if (action === "resolveQuestion") {
    const questionId = Number(body.questionId);
    const resolution = body.resolution === "yes" ? "yes" : "no";
    const [q] = await db
      .update(predictionQuestions)
      .set({ status: "resolved", resolution, resolvedAt: new Date() })
      .where(eq(predictionQuestions.id, questionId))
      .returning();
    if (!q) return NextResponse.json({ error: "Question introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === "deleteQuestion") {
    const questionId = Number(body.questionId);
    await db.delete(predictionQuestions).where(eq(predictionQuestions.id, questionId));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}

function roundNumber(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}