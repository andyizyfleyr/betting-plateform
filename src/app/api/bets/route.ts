import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { appUser, bets, matches } from "@/db/schema";
import { computeCashOut } from "@/lib/cashout";
import { isKnownMarket, marketLabelFor, marketOddsFor, marketWin } from "@/lib/markets";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

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
    const won = marketWin(bet.market, bet.selection, home, away);

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
      market: bet.market,
      selection: bet.selection,
      selectionLabel: bet.selectionLabel,
      odds: bet.odds,
      stake: bet.stake,
      potentialWin: bet.potentialWin,
      status: bet.status,
      cashOutAmount: bet.cashOutAmount ?? null,
      cashOut:
        livePending && bet.market === "result"
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

  let body: { matchId?: number; selection?: string; market?: string; stake?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const { matchId, selection, stake } = body;
  const market = body.market ?? "result";

  if (!matchId || !selection || !stake || stake <= 0) {
    return NextResponse.json({ error: "Données du pari incomplètes" }, { status: 400 });
  }
  if (!isKnownMarket(market)) {
    return NextResponse.json({ error: "Marché invalide" }, { status: 400 });
  }

  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) {
    return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
  }
  if (match.status === "finished") {
    return NextResponse.json({ error: "Ce match est terminé" }, { status: 400 });
  }

  // Délai de validation de pari pour les matchs en direct (sécurité bookmaker pro)
  if (match.status === "live") {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const [freshMatch] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!freshMatch || freshMatch.status === "finished" || freshMatch.suspended) {
      return NextResponse.json(
        { error: "Pari rejeté : marché suspendu ou événement en cours lors de la validation" },
        { status: 400 }
      );
    }
  }

  const odds = marketOddsFor(market, selection, match.homeTeam, match.awayTeam);
  const selectionLabel = marketLabelFor(market, selection, match.homeTeam, match.awayTeam);
  if (odds == null || selectionLabel == null) {
    return NextResponse.json({ error: "Sélection invalide" }, { status: 400 });
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
      market,
      selection,
      selectionLabel,
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
