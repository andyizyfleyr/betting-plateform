import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { appUser, bets, matches } from "@/db/schema";
import { computeCashOut } from "@/lib/cashout";

export const dynamic = "force-dynamic";

/** Encaisse un pari en cours sur un match en direct (cash-out). */
export async function POST(req: NextRequest) {
  await ensureSeeded();
  await runLiveEngine();

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

  const [row] = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(eq(bets.id, betId));

  if (!row || !row.bet) {
    return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
  }
  const { bet, match } = row;

  if (bet.status !== "pending") {
    return NextResponse.json({ error: "Ce pari n'est plus encaissable" }, { status: 400 });
  }
  if (!match || match.status !== "live") {
    return NextResponse.json(
      { error: "Le cash-out n'est disponible que pendant le match" },
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
    .where(eq(appUser.id, 1))
    .returning({ balance: appUser.balance });

  return NextResponse.json({ balance: updatedUser.balance, value });
}
