import { desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import { appUser, bets, matches, predictionBets, predictionQuestions } from "@/db/schema";
import { computeCashOut, computePredictionCashOut } from "@/lib/cashout";
import { customMarketLabel, customMarketOdds, isKnownMarket, liveMarketOddsFor, liveOutcomeProbability, marketLabelFor, marketOddsFor, marketOutcomeSettled, minuteNumber } from "@/lib/markets";
import { settleResolvedQuestions } from "@/lib/predictions";
import { clvOf, isNearDecided, maxStakeFor, playerRiskProfile } from "@/lib/risk";
import { getAuthUserId } from "@/lib/session";
import { settleFinishedBets } from "@/lib/settle";

export const dynamic = "force-dynamic";

/** Anti-triche : limites de mise (€) et intervalle minimal entre deux paris. */
const MIN_STAKE = 0.5;
const BET_COOLDOWN_MS = 700;
/** Délai de validation des paris en direct (recotation serveur + vérification anti-but). */
const LIVE_VALIDATION_MS = 1200;

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
      closingOdds: bet.closingOdds ?? null,
      riskFlag: bet.riskFlag ?? null,
      clv: clvOf(bet.odds, bet.closingOdds),
      cashOutAmount: bet.cashOutAmount ?? null,
      cashOut:
        livePending && match && !match.suspended
          ? computeCashOut({
              stake: bet.stake,
              odds: bet.odds,
              sport: bet.sport,
              minute: match.minute ?? null,
              market: bet.market,
              selection: bet.selection,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              homeScore: match.homeScore ?? null,
              awayScore: match.awayScore ?? null,
              redHome: match.redHome ?? 0,
              redAway: match.redAway ?? 0,
              homeForm: match.homeForm ?? 1,
              awayForm: match.awayForm ?? 1,
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
    .select({ bet: predictionBets, question: predictionQuestions })
    .from(predictionBets)
    .leftJoin(predictionQuestions, eq(predictionBets.questionId, predictionQuestions.id))
    .where(eq(predictionBets.userId, uid))
    .orderBy(desc(predictionBets.placedAt));

  const predMapped = predRows.map(({ bet: pb, question: q }) => {
    const livePending = pb.status === "pending" && q && q.status === "open" && q.resolvesAt.getTime() > Date.now();
    const cashOutVal = livePending && q
      ? computePredictionCashOut({
          stake: pb.stake,
          odds: pb.odds,
          potentialWin: pb.potentialWin,
          placedAt: pb.placedAt,
          resolvesAt: q.resolvesAt,
          currentOddsYes: q.oddsYes,
          currentOddsNo: q.oddsNo,
          selection: pb.selection as "yes" | "no",
        })
      : null;

    return {
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
      closingOdds: null,
      riskFlag: null,
      clv: null,
      cashOutAmount: pb.cashOutAmount ?? null,
      cashOut: cashOutVal,
      placedAt: pb.placedAt,
      matchStatus: null,
      matchHomeScore: null,
      matchAwayScore: null,
      matchMinute: null,
      matchStartsAt: null,
    };
  });

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
  if (stake < MIN_STAKE) {
    return NextResponse.json(
      { error: `Mise hors limites (minimum ${MIN_STAKE} €)` },
      { status: 400 }
    );
  }

  // Profil joueur (ROI/CLV sur la fenêtre) → limite de mise dynamique.
  // Un profil « sharp » voit sa limite réduite (jamais bloqué).
  const recentRows = await db
    .select({ odds: bets.odds, stake: bets.stake, closingOdds: bets.closingOdds, status: bets.status })
    .from(bets)
    .where(eq(bets.userId, uid))
    .orderBy(desc(bets.placedAt))
    .limit(40);
  const profile = playerRiskProfile(
    recentRows.map((b) => ({
      odds: b.odds,
      stake: b.stake,
      payout: b.status === "won" ? Math.round(b.stake * b.odds * 100) / 100 : 0,
      closingOdds: b.closingOdds ?? null,
    }))
  );
  const maxStake = maxStakeFor(profile);
  if (stake > maxStake) {
    return NextResponse.json(
      { error: `Mise plafonnée à ${maxStake} € pour votre profil de risque` },
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

  // Capture de l'état sportif initial pour détecter un événement réel pendant la validation
  const initialHomeScore = match.homeScore ?? 0;
  const initialAwayScore = match.awayScore ?? 0;
  const initialRedHome = match.redHome ?? 0;
  const initialRedAway = match.redAway ?? 0;

  // Validation des paris en direct : recotation serveur et rejet uniquement si un
  // événement réel (but, carton rouge, suspension ou fin de match) survient pendant l'attente.
  let pricedMatch = match;
  if (match.status === "live") {
    if (match.suspended) {
      return NextResponse.json(
        { error: "Marché temporairement suspendu suite à une action de jeu" },
        { status: 400 }
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LIVE_VALIDATION_MS));
    const [freshMatch] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!freshMatch || freshMatch.status === "finished" || freshMatch.suspended) {
      return NextResponse.json(
        { error: "Pari rejeté : marché suspendu ou match terminé pendant la validation" },
        { status: 400 }
      );
    }
    if (
      (freshMatch.homeScore ?? 0) !== initialHomeScore ||
      (freshMatch.awayScore ?? 0) !== initialAwayScore ||
      (freshMatch.redHome ?? 0) !== initialRedHome ||
      (freshMatch.redAway ?? 0) !== initialRedAway
    ) {
      return NextResponse.json(
        { error: "Action décisive survenue pendant la validation — cote mise à jour, réessayez" },
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

  // Cotation fixe bookmaker (non mutualisée) : le prix dépend uniquement du match
  // et est verrouillé contractuellement sur le ticket à la validation.
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

  // Cote obsolète / pari « quasi joué » : si l'issue a une probabilité modèle
  // quasi certaine au score courant (ex. 0-0 à la 89' sur le « moins de 2,5 »),
  // on flag le pari pour revue manuelle a posteriori (latence admin-clic sur un
  // markGoal). Le modèle live est la même source que la cotation serveur.
  const liveProb =
    pricedMatch.status === "live" && pricedMatch.source !== "manual"
      ? liveOutcomeProbability(
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
      : null;
  const riskFlag =
    pricedMatch.status === "live" &&
    isNearDecided(market, selection, homeScore, awayScore, minuteNumber(pricedMatch.minute), liveProb)
      ? "stale_near_decided"
      : null;

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
        riskFlag,
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
