import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { appUser, bets, matches } from "@/db/schema";
import { computeCashOut } from "@/lib/cashout";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const SELECTION_LABELS: Record<string, (m: typeof matches.$inferSelect) => string> = {
  home: (m) => `Victoire ${m.homeTeam}`,
  draw: () => "Match nul",
  away: (m) => `Victoire ${m.awayTeam}`,
};

/** Règle les paris en cours du joueur dont le match est terminé (déterministe, basé sur le score). */
async function settleFinishedBets(uid: number) {
  const pending = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(and(eq(bets.status, "pending"), eq(bets.userId, uid)));

  for (const { bet, match } of pending) {
    if (!match || match.status !== "finished") continue;
    const home = match.homeScore ?? 0;
    const away = match.awayScore ?? 0;
    const winner = home > away ? "home" : away > home ? "away" : "draw";
    const won = bet.selection === winner;

    await db
      .update(bets)
      .set({ status: won ? "won" : "lost" })
      .where(eq(bets.id, bet.id));

    if (won) {
      await db
        .update(appUser)
        .set({ balance: sql`${appUser.balance} + ${bet.potentialWin}` })
        .where(eq(appUser.id, uid));
    }
  }
}

export async function GET(req: NextRequest) {
  await ensureSeeded();
  await runLiveEngine();
  const uid = (await getAuthUserId(req)) ?? 1;
  await settleFinishedBets(uid);

  const filter = req.nextUrl.searchParams.get("filter") ?? "all";

  const rows = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(eq(bets.userId, uid))
    .orderBy(desc(bets.placedAt));

  const [user] = await db
    .select({ balance: appUser.balance })
    .from(appUser)
    .where(eq(appUser.id, uid));

  const mapped = rows.map(({ bet, match }) => {
    const livePending = bet.status === "pending" && match?.status === "live";
    return {
      id: bet.id,
      matchId: bet.matchId,
      sport: bet.sport,
      league: bet.league,
      homeTeam: bet.homeTeam,
      awayTeam: bet.awayTeam,
      selection: bet.selection,
      selectionLabel: bet.selectionLabel,
      odds: bet.odds,
      stake: bet.stake,
      potentialWin: bet.potentialWin,
      status: bet.status,
      cashOutAmount: bet.cashOutAmount ?? null,
      cashOut: livePending
        ? computeCashOut({
            stake: bet.stake,
            odds: bet.odds,
            sport: bet.sport,
            minute: match?.minute ?? null,
            selection: bet.selection,
            homeScore: match?.homeScore ?? null,
            awayScore: match?.awayScore ?? null,
          })
        : null,
      placedAt: bet.placedAt,
      matchStatus: match?.status ?? null,
      matchHomeScore: match?.homeScore ?? null,
      matchAwayScore: match?.awayScore ?? null,
      matchMinute: match?.minute ?? null,
      matchStartsAt: match?.startsAt ?? null,
    };
  });

  const filtered =
    filter === "ongoing"
      ? mapped.filter((b) => b.status === "pending")
      : filter === "finished"
        ? mapped.filter((b) => b.status !== "pending")
        : mapped;

  return NextResponse.json({ bets: filtered, balance: user?.balance ?? null });
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  let body: { matchId?: number; selection?: string; stake?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const { matchId, selection, stake } = body;

  if (!matchId || !selection || !stake || stake <= 0) {
    return NextResponse.json({ error: "Données du pari incomplètes" }, { status: 400 });
  }
  if (!["home", "draw", "away"].includes(selection)) {
    return NextResponse.json({ error: "Sélection invalide" }, { status: 400 });
  }

  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) {
    return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
  }
  if (match.status === "finished") {
    return NextResponse.json({ error: "Ce match est terminé" }, { status: 400 });
  }

  const odds =
    selection === "home" ? match.oddsHome : selection === "away" ? match.oddsAway : match.oddsDraw;
  if (!odds) {
    return NextResponse.json({ error: "Cote indisponible" }, { status: 400 });
  }

  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user || user.balance < stake) {
    return NextResponse.json({ error: "Solde insuffisant" }, { status: 400 });
  }

  const roundedStake = Math.round(stake * 100) / 100;
  const potentialWin = Math.round(roundedStake * odds * 100) / 100;

  const [bet] = await db
    .insert(bets)
    .values({
      userId: uid,
      matchId: match.id,
      sport: match.sport,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      selection,
      selectionLabel: SELECTION_LABELS[selection](match),
      odds,
      stake: roundedStake,
      potentialWin,
      status: "pending",
    })
    .returning();

  const [updatedUser] = await db
    .update(appUser)
    .set({ balance: sql`${appUser.balance} - ${roundedStake}` })
    .where(eq(appUser.id, uid))
    .returning({ balance: appUser.balance });

  return NextResponse.json({ bet, balance: updatedUser.balance });
}
