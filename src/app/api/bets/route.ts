import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { appUser, bets, matches, predictionBets } from "@/db/schema";
import { computeCashOut } from "@/lib/cashout";
import { customMarketLabel, customMarketOdds, isKnownMarket, liveMarketOddsFor, marketLabelFor, marketOddsFor, marketOutcomeSettled, minuteNumber } from "@/lib/markets";
import { settleResolvedQuestions } from "@/lib/predictions";
import { getAuthUserId } from "@/lib/session";
import { settleFinishedBets } from "@/lib/settle";

export const dynamic = "force-dynamic";

/** Anti-triche : limites de mise (€) et intervalle minimal entre deux paris. */
const MIN_STAKE = 0.5;
const MAX_STAKE = 500;
const BET_COOLDOWN_MS = 700;
/** Délai de validation des paris en direct (recotation serveur + état du marché). */
const LIVE_VALIDATION_MS = 2500;

export async function GET(req: NextRequest) {
  await ensureSeeded();
  await runLiveEngine();
  const uid = (await getAuthUserId(req)) ?? 1;
  await settleFinishedBets();
  await settleResolvedQuestions();

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
      kind: "sport" as const,
      matchId: bet.matchId,
      sport: bet.sport,
      league: bet.league,
      homeTeam: bet.homeTeam,
      awayTeam: bet.awayTeam,
      question: null,
      questionId: null,
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

  const predRows = await db
    .select()
    .from(predictionBets)
    .where(eq(predictionBets.userId, uid))
    .orderBy(desc(predictionBets.placedAt));

  const predMapped = predRows.map((pb) => ({
    id: pb.id,
    kind: "prediction" as const,
    matchId: null,
    sport: "prédiction",
    league: pb.category,
    homeTeam: "",
    awayTeam: "",
    question: pb.question,
    questionId: pb.questionId,
    market: "yesno",
    selection: pb.selection,
    selectionLabel: pb.selectionLabel,
    odds: pb.odds,
    stake: pb.stake,
    potentialWin: pb.potentialWin,
    status: pb.status,
    cashOutAmount: null,
    cashOut: null,
    placedAt: pb.placedAt,
    matchStatus: null,
    matchHomeScore: null,
    matchAwayScore: null,
    matchMinute: null,
    matchStartsAt: null,
  }));

  const combined = [...predMapped, ...mapped].sort(
    (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()
  );

  const filtered =
    filter === "ongoing"
      ? combined.filter((b) => b.status === "pending")
      : filter === "finished"
        ? combined.filter((b) => b.status !== "pending")
        : combined;

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
  if (stake < MIN_STAKE || stake > MAX_STAKE) {
    return NextResponse.json(
      { error: `Mise hors limites (${MIN_STAKE} € – ${MAX_STAKE} €)` },
      { status: 400 }
    );
  }

  // Anti-spam : une mise toutes les 700 ms maximum (pas de machine-gun de paris).
  const [lastBet] = await db
    .select({ placedAt: bets.placedAt })
    .from(bets)
    .where(eq(bets.userId, uid))
    .orderBy(desc(bets.placedAt))
    .limit(1);
  if (lastBet && Date.now() - lastBet.placedAt.getTime() < BET_COOLDOWN_MS) {
    return NextResponse.json({ error: "Trop rapide — veuillez patienter" }, { status: 429 });
  }

  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) {
    return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
  }
  if (match.status === "finished") {
    return NextResponse.json({ error: "Ce match est terminé" }, { status: 400 });
  }

  // Capture initial state for race condition detection
  const initialHomeScore = match.homeScore ?? 0;
  const initialAwayScore = match.awayScore ?? 0;
  const initialMinute = match.minute;
  const initialSuspended = match.suspended;

  // Délai de validation des paris en direct : on recote AU MOMENT de la validation
  // (marché suspendu, score/minutes à jour) — la cote envoyée par le client n'est
  // jamais utilisée, c'est le serveur qui fixe le prix.
  let pricedMatch = match;
  if (match.status === "live") {
    await new Promise((resolve) => setTimeout(resolve, LIVE_VALIDATION_MS));
    const [freshMatch] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!freshMatch || freshMatch.status === "finished" || freshMatch.suspended) {
      return NextResponse.json(
        { error: "Pari rejeté : marché suspendu ou événement en cours lors de la validation" },
        { status: 400 }
      );
    }
    // Race condition check: if score changed during wait, reject
    if (
      (freshMatch.homeScore ?? 0) !== initialHomeScore ||
      (freshMatch.awayScore ?? 0) !== initialAwayScore ||
      freshMatch.minute !== initialMinute ||
      freshMatch.suspended !== initialSuspended
    ) {
      return NextResponse.json(
        { error: "Événement survenu pendant la validation — réessayez" },
        { status: 409 }
      );
    }
    pricedMatch = freshMatch;
  }

  const homeScore = pricedMatch.homeScore ?? 0;
  const awayScore = pricedMatch.awayScore ?? 0;

  // Anti-triche : interdiction de parier sur une issue déjà décidée (gagnée ou
  // devenue impossible) — ex. « Plus de 2,5 » avec 3 buts inscrits, « 0-0 » à 1-0, etc.
  const minute = minuteNumber(pricedMatch.minute);
  if (pricedMatch.status === "live" && marketOutcomeSettled(market, selection, homeScore, awayScore, minute)) {
    return NextResponse.json({ error: "Ce marché est déjà décidé" }, { status: 400 });
  }

  // Recotation serveur : en direct = grille de scores finaux, sinon cotes d'avant-match.
  // Match manuel = marchés/cotes personnalisés saisis par l'admin, utilisés tels quels.
  let odds: number | null = null;
  let selectionLabel: string | null = null;
  if (pricedMatch.source === "manual" && pricedMatch.markets && pricedMatch.markets.length > 0) {
    odds = customMarketOdds(pricedMatch.markets, market, selection);
    selectionLabel = customMarketLabel(pricedMatch.markets, market, selection);
    if (odds == null || selectionLabel == null) {
      return NextResponse.json({ error: "Sélection invalide" }, { status: 400 });
    }
  } else {
    odds =
      pricedMatch.status === "live"
        ? liveMarketOddsFor(
            market,
            selection,
            pricedMatch.homeTeam,
            pricedMatch.awayTeam,
            homeScore,
            awayScore,
            minuteNumber(pricedMatch.minute),
            {
              homeForm: pricedMatch.homeForm ?? 1,
              awayForm: pricedMatch.awayForm ?? 1,
              redHome: pricedMatch.redHome ?? 0,
              redAway: pricedMatch.redAway ?? 0,
            }
          )
        : marketOddsFor(market, selection, pricedMatch.homeTeam, pricedMatch.awayTeam);
    selectionLabel = marketLabelFor(market, selection, pricedMatch.homeTeam, pricedMatch.awayTeam);
    if (odds == null || selectionLabel == null) {
      return NextResponse.json({ error: "Sélection invalide" }, { status: 400 });
    }
  }

  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user || user.balance < stake) {
    return NextResponse.json({ error: "Solde insuffisant" }, { status: 400 });
  }

  const roundedStake = Math.round(stake * 100) / 100;
  const potentialWin = Math.round(roundedStake * odds * 100) / 100;

  // Transaction pour atomicité : pari + débit solde
  const result = await db.transaction(async (tx) => {
    const [bet] = await tx
      .insert(bets)
      .values({
        userId: uid,
        matchId: pricedMatch.id,
        sport: pricedMatch.sport,
        league: pricedMatch.league,
        homeTeam: pricedMatch.homeTeam,
        awayTeam: pricedMatch.awayTeam,
        market,
        selection,
        selectionLabel,
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

    return { bet, balance: updatedUser.balance };
  });

  return NextResponse.json(result);
}
