import { and, count, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, bets, deposits, matches, predictionBets, predictionQuestions } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { marketOutcomeSettled, minuteNumber } from "@/lib/markets";
import { getAuthUserId } from "@/lib/session";
import { settleMatchBets } from "@/lib/settle";
import { MANUAL_MINUTE_REAL_MS } from "@/db/engine";
import { STALE_LATENCY_MS } from "@/lib/risk";

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
  | {
      action: "addMatch";
      home: string;
      away: string;
      league?: string;
      oddsHome?: number;
      oddsDraw?: number;
      oddsAway?: number;
      startsAt?: string;
      status?: "upcoming" | "live";
      homeLogo?: string | null;
      awayLogo?: string | null;
      markets?: unknown;
    }
  | { action: "deleteMatch"; matchId: number }
  | { action: "toggleMatch"; matchId: number; suspended: boolean }
  | { action: "markGoal"; matchId: number; team: "home" | "away"; minute?: number | string }
  | { action: "setMinute"; matchId: number; minute: string }
  | { action: "startMatch"; matchId: number }
  | { action: "finishMatch"; matchId: number; homeScore?: number; awayScore?: number }
  | { action: "reopenMatch"; matchId: number }
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
    // Date/heure de coup d'envoi saisie par l'admin (défaut : dans 10 min,
    // ou maintenant si le match est créé directement en direct).
    let startsAt = new Date(status === "live" ? Date.now() : Date.now() + 10 * 60_000);
    if (typeof body.startsAt === "string") {
      const parsed = new Date(body.startsAt);
      if (!Number.isNaN(parsed.getTime())) startsAt = parsed;
    }
    // Marchés personnalisés : validation légère + cotes par défaut si absentes.
    const rawMarkets = Array.isArray(body.markets) ? (body.markets as unknown[]) : null;
    const markets = rawMarkets
      ? rawMarkets.map((mm) => {
          const g = mm as {
            key?: string;
            label?: string;
            short?: string;
            outcomes?: unknown[];
            rows?: unknown[];
          };
          return {
            key: String(g.key ?? ""),
            label: String(g.label ?? ""),
            short: String(g.short ?? ""),
            outcomes: Array.isArray(g.outcomes)
              ? g.outcomes.map((oo) => {
                  const o = oo as { key?: string; label?: string; short?: string; odds?: number };
                  return { key: String(o.key ?? ""), label: String(o.label ?? ""), short: String(o.short ?? ""), odds: roundNumber(o.odds) ?? 2 };
                })
              : [],
            rows: Array.isArray(g.rows)
              ? g.rows.map((rr) => {
                  const r = rr as { label?: string; outcomes?: unknown[] };
                  return {
                    label: String(r.label ?? ""),
                    outcomes: Array.isArray(r.outcomes)
                      ? r.outcomes.map((oo) => {
                          const o = oo as { key?: string; label?: string; short?: string; odds?: number };
                          return { key: String(o.key ?? ""), label: String(o.label ?? ""), short: String(o.short ?? ""), odds: roundNumber(o.odds) ?? 2 };
                        })
                      : [],
                  };
                })
              : undefined,
          };
        })
      : null;

    // Synchronise les cotes 1/N/2 du match avec le marché "result" perso si présent.
    let h = oddsHome, d = oddsDraw, a = oddsAway;
    if (markets) {
      const res = markets.find((m) => m.key === "result");
      const pick = (k: string) => res?.outcomes.find((o) => o.key === k)?.odds;
      const vh = pick("home"), vd = pick("draw"), va = pick("away");
      if (vh) h = vh;
      if (vd) d = vd;
      if (va) a = va;
    }

    const [m] = await db
      .insert(matches)
      .values({
        sport: "football",
        league,
        homeTeam: home,
        awayTeam: away,
        homeLogo: typeof body.homeLogo === "string" && body.homeLogo.trim() ? body.homeLogo.trim() : null,
        awayLogo: typeof body.awayLogo === "string" && body.awayLogo.trim() ? body.awayLogo.trim() : null,
        homeScore: null,
        awayScore: null,
        status,
        minute: status === "live" ? "1'" : null,
        startsAt,
        oddsHome: h,
        oddsDraw: d,
        oddsAway: a,
        suspended: false,
        redHome: 0,
        redAway: 0,
        events: [],
        tickHistory: [],
        regime: "balanced",
        homeForm: 1,
        awayForm: 1,
        markets,
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

  if (action === "markGoal") {
    const matchId = Number(body.matchId);
    const team = body.team === "away" ? "away" : "home";
    if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });

    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
    if (m.source !== "manual") {
      return NextResponse.json({ error: "Le score d'un match virtuel est géré automatiquement" }, { status: 400 });
    }
    if (m.status === "finished") {
      return NextResponse.json({ error: "Impossible de marquer un but : match déjà terminé" }, { status: 400 });
    }

    const currentHome = m.homeScore ?? 0;
    const currentAway = m.awayScore ?? 0;
    const homeScore = team === "home" ? currentHome + 1 : currentHome;
    const awayScore = team === "away" ? currentAway + 1 : currentAway;

    let gameMinute = minuteNumber(m.minute);
    if (typeof body.minute === "number" && Number.isFinite(body.minute)) {
      gameMinute = body.minute;
    }
    gameMinute = Math.max(1, Math.min(90, Math.round(gameMinute)));

    const events = [...(m.events ?? [])];
    events.push({ type: "goal", team, minute: gameMinute });

    // But : blocage du marché (3 s) puis réouverture auto par le moteur avec cotes
    // ajustées — la suspension est levée au prochain tick une fois le délai écoulé.
    const reprice = await db
      .update(matches)
      .set({
        homeScore,
        awayScore,
        minute: `${gameMinute}'`,
        status: "live",
        lastGoalAt: new Date(),
        startsAt: backdateStartsAt(gameMinute),
        suspended: true,
        events,
      })
      .where(eq(matches.id, matchId))
      .returning();

    // Latence admin-clic : les paris « pending » placés dans la fenêtre précédant le
    // but, sur une issue que ce but vient de rendre mathématiquement décidée, sont
    // flaggés pour revue manuelle a posteriori (audit risque).
    const staleCutoff = new Date(Date.now() - STALE_LATENCY_MS);
    const staleBets = await db
      .select({ id: bets.id, market: bets.market, selection: bets.selection })
      .from(bets)
      .where(and(eq(bets.matchId, matchId), eq(bets.status, "pending"), sql`${bets.placedAt} >= ${staleCutoff}`));
    for (const sb of staleBets) {
      const settledAfterGoal = marketOutcomeSettled(sb.market, sb.selection, homeScore, awayScore, gameMinute);
      const settledBeforeGoal = marketOutcomeSettled(sb.market, sb.selection, currentHome, currentAway, gameMinute);
      if (settledAfterGoal && !settledBeforeGoal) {
        await db
          .update(bets)
          .set({ riskFlag: "stale_mark_goal" })
          .where(eq(bets.id, sb.id));
      }
    }

    return NextResponse.json({ ok: true, match: reprice[0] });
  }

  if (action === "setMinute") {
    const matchId = Number(body.matchId);
    const minuteText = String(body.minute ?? "").trim();
    if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
    if (m.source !== "manual" || m.status === "finished") {
      return NextResponse.json({ error: "Minute modifiable uniquement sur un match réel en cours" }, { status: 400 });
    }
    const target = minuteNumber(minuteText);
    const [updated] = await db
      .update(matches)
      .set({
        minute: minuteText || null,
        status: m.status === "upcoming" ? "live" : m.status,
        startsAt: target > 1 ? backdateStartsAt(target) : new Date(),
      })
      .where(eq(matches.id, matchId))
      .returning();
    return NextResponse.json({ ok: true, match: updated });
  }

  if (action === "startMatch") {
    const matchId = Number(body.matchId);
    if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
    if (m.source !== "manual") {
      return NextResponse.json({ error: "Un match virtuel débute automatiquement" }, { status: 400 });
    }
    const [updated] = await db
      .update(matches)
      .set({
        status: "live",
        minute: "1'",
        startsAt: new Date(),
        lastGoalAt: null,
      })
      .where(eq(matches.id, matchId))
      .returning();
    return NextResponse.json({ ok: true, match: updated });
  }

  if (action === "finishMatch") {
    const matchId = Number(body.matchId);
    if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
    if (m.source !== "manual") {
      return NextResponse.json({ error: "Un match virtuel se termine automatiquement" }, { status: 400 });
    }
    if (m.status === "finished") {
      return NextResponse.json({ error: "Le match est déjà terminé" }, { status: 400 });
    }

    const givenHome = roundNumber(body.homeScore);
    const givenAway = roundNumber(body.awayScore);
    const homeScore = givenHome != null ? Math.round(givenHome) : m.homeScore ?? 0;
    const awayScore = givenAway != null ? Math.round(givenAway) : m.awayScore ?? 0;

    const [updated] = await db
      .update(matches)
      .set({ status: "finished", minute: "Terminé", homeScore, awayScore, finishedAt: new Date() })
      .where(eq(matches.id, matchId))
      .returning();

    // Bascule immédiate des paris : tous les paris en cours du match sont réglés selon le score.
    await settleMatchBets(matchId);

    return NextResponse.json({ ok: true, match: updated, settled: true });
  }

  if (action === "reopenMatch") {
    const matchId = Number(body.matchId);
    if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
    if (m.source !== "manual") {
      return NextResponse.json({ error: "Un match virtuel ne peut pas être rouvert" }, { status: 400 });
    }
    if (m.status !== "finished") {
      return NextResponse.json({ error: "Seul un match terminé peut être rouvert" }, { status: 400 });
    }
    const [updated] = await db
      .update(matches)
      .set({ status: "live", minute: `${minuteNumber(m.minute) || 90}'`, finishedAt: null })
      .where(eq(matches.id, matchId))
      .returning();
    return NextResponse.json({ ok: true, match: updated });
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

/**
 * Retourne une heure de coup d'envoi telle que le moteur (1 min = MANUAL_MINUTE_REAL_MS)
 * réaffiche exactement la minute voulue à l'instant présent. Ainsi les minutes saisies
 * par l'admin et l'horloge automatique restent synchronisées.
 */
function backdateStartsAt(targetMinute: number): Date {
  const minute = Math.max(1, Math.min(90, Math.floor(targetMinute)));
  return new Date(Date.now() - (minute - 1) * MANUAL_MINUTE_REAL_MS);
}