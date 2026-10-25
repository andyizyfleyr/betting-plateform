import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { runLiveEngine } from "@/db/engine";
import {
  appUser,
  bets,
  comboBets,
  matches,
  predictionBets,
  predictionQuestions,
  type MatchRow,
  type PredictionQuestionRow,
} from "@/db/schema";
import { computeCashOut, computePredictionCashOut } from "@/lib/cashout";
import { computeComboCashOut } from "@/lib/combo";
import { customMarketLabel, customMarketOdds, isKnownMarket, liveMarketOddsFor, liveOutcomeProbability, marketLabelFor, marketOddsFor, marketOutcomeSettled, minuteNumber } from "@/lib/markets";
import { ensureMlLoaded, predictBatchUserMlRisk } from "@/lib/ml-engine";
import { clvOf, isNearDecided, maxStakeFor, playerRiskProfile } from "@/lib/risk";
import { requireUserId } from "@/lib/session";
import { syncAllSettlementsThrottled, syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

/** Anti-triche : limites de mise (€) et intervalle minimal entre deux paris. */
const MIN_STAKE = 0.5;
const BET_COOLDOWN_MS = 700;
/** Délai court de validation des paris en direct (recotation serveur + vérification anti-but). */
const LIVE_VALIDATION_MS = 300;

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;

  await syncLiveMatchesThrottled();
  await syncAllSettlementsThrottled();

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
    const resolvedLabel =
      !(match?.source === "manual" && match.markets && match.markets.length > 0) &&
      isKnownMarket(bet.market)
        ? (marketLabelFor(bet.market, bet.selection, bet.homeTeam, bet.awayTeam) ??
          bet.selectionLabel)
        : bet.selectionLabel;
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
      selectionLabel: resolvedLabel,
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
              events: match.events ?? null,
              matchId: match.id,
            })
          : null,
      placedAt: bet.placedAt,
      settledAt: bet.settledAt ?? null,
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
          options: q.options ?? null,
          selection: pb.selection,
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
      market: q?.options && q.options.length >= 2 ? "multichoice" : "yesno",
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
      settledAt: pb.settledAt ?? null,
      matchStatus: null,
      matchHomeScore: null,
      matchAwayScore: null,
      matchMinute: null,
      matchStartsAt: null,
    };
  });

  const comboRows = await db
    .select()
    .from(comboBets)
    .where(eq(comboBets.userId, uid))
    .orderBy(desc(comboBets.placedAt));

  let comboMatchMap = new Map<number, MatchRow>();
  let comboQuestionMap = new Map<number, PredictionQuestionRow>();

  if (comboRows.some((c) => c.status === "pending")) {
    const cMatchIds = new Set<number>();
    const cQuestionIds = new Set<number>();
    for (const c of comboRows) {
      if (c.status !== "pending") continue;
      for (const l of c.legs ?? []) {
        if (l.kind === "sport" && l.matchId) cMatchIds.add(l.matchId);
        if (l.kind === "prediction" && l.questionId) cQuestionIds.add(l.questionId);
      }
    }
    const [mRows, qRows] = await Promise.all([
      cMatchIds.size > 0
        ? db.select().from(matches).where(inArray(matches.id, [...cMatchIds]))
        : Promise.resolve([] as MatchRow[]),
      cQuestionIds.size > 0
        ? db
            .select()
            .from(predictionQuestions)
            .where(inArray(predictionQuestions.id, [...cQuestionIds]))
        : Promise.resolve([] as PredictionQuestionRow[]),
    ]);
    comboMatchMap = new Map(mRows.map((m) => [m.id, m]));
    comboQuestionMap = new Map(qRows.map((q) => [q.id, q]));
  }

  const comboMapped = comboRows.map((cb) => {
    const legs = (cb.legs ?? []).map((l) => {
      if (l.kind === "sport" && l.homeTeam && l.awayTeam && isKnownMarket(l.market)) {
        return {
          ...l,
          selectionLabel:
            marketLabelFor(l.market, l.selection, l.homeTeam, l.awayTeam) ?? l.selectionLabel,
        };
      }
      return l;
    });
    const liveMatch = legs
      .map((l) => (l.kind === "sport" && l.matchId ? comboMatchMap.get(l.matchId) : undefined))
      .find((m) => m?.status === "live");

    return {
      id: cb.id,
      kind: "combo" as const,
      matchId: null,
      sport: "combiné",
      league: `Pari combiné (${legs.length} événements)`,
      homeTeam: "",
      awayTeam: "",
      question: null,
      questionId: null,
      market: "combo",
      selection: "combo",
      selectionLabel: legs.map((l) => l.selectionLabel).join(" · "),
      odds: cb.totalOdds,
      baseOdds: cb.baseOdds,
      boostPct: cb.boostPct,
      legs,
      stake: cb.stake,
      potentialWin: cb.potentialWin,
      status: cb.status,
      closingOdds: null,
      riskFlag: null,
      clv: null,
      cashOutAmount: cb.cashOutAmount ?? null,
      cashOut: cb.status === "pending" ? computeComboCashOut(cb, comboMatchMap, comboQuestionMap) : null,
      placedAt: cb.placedAt,
      settledAt: cb.settledAt ?? null,
      matchStatus: liveMatch ? ("live" as const) : null,
      matchHomeScore: null,
      matchAwayScore: null,
      matchMinute: liveMatch?.minute ?? null,
      matchStartsAt: null,
    };
  });

  const combined = [...comboMapped, ...predMapped, ...mapped].sort(
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
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;
  await ensureMlLoaded();
  await runLiveEngine();

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

  // Profilage risque intelligent du joueur (détection sharp / ROI / CLV sur les 20 derniers paris)
  const recentSettled = await db
    .select({
      odds: bets.odds,
      stake: bets.stake,
      status: bets.status,
      potentialWin: bets.potentialWin,
      cashOutAmount: bets.cashOutAmount,
      closingOdds: bets.closingOdds,
    })
    .from(bets)
    .where(eq(bets.userId, uid))
    .orderBy(desc(bets.id))
    .limit(25);

  const settledHistory = recentSettled
    .filter((b) => b.status !== "pending")
    .map((b) => ({
      odds: b.odds,
      stake: b.stake,
      payout:
        b.status === "won"
          ? b.potentialWin
          : b.status === "cashed"
            ? (b.cashOutAmount ?? 0)
            : 0,
      closingOdds: b.closingOdds ?? null,
    }));
  const maxAllowedStake = maxStakeFor(playerRiskProfile(settledHistory));
  if (stake > maxAllowedStake) {
    return NextResponse.json(
      { error: `Mise maximale autorisée sur ce marché : ${maxAllowedStake} €` },
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
  const mlRiskMap = await predictBatchUserMlRisk([uid]);
  const mlCeiling = mlRiskMap.get(uid)?.maxStake ?? 500;
  const maxStake = Math.min(maxStakeFor(profile), mlCeiling);
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

  // Anti-fractionnement : plafonne l'exposition cumulée d'un même joueur sur un même match
  const [existingMatchStake] = await db
    .select({
      staked: sql<number>`COALESCE(SUM(${bets.stake}), 0)::float8`,
    })
    .from(bets)
    .where(and(eq(bets.userId, uid), eq(bets.matchId, matchId), eq(bets.status, "pending")));
  const maxMatchCumulative = Math.min(600, Math.round(maxStake * 1.5));
  if ((existingMatchStake?.staked ?? 0) + stake > maxMatchCumulative) {
    return NextResponse.json(
      {
        error: `Exposition maximale atteinte sur ce match (${maxMatchCumulative} € cumulés)`,
      },
      { status: 400 }
    );
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
    if (match.suspended || (match.source === "virtual" && minuteNumber(match.minute) >= 85)) {
      return NextResponse.json(
        { error: "Marché verrouillé (fin de match ou action en cours)" },
        { status: 400 }
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LIVE_VALIDATION_MS));
    await runLiveEngine();
    const [freshMatch] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (
      !freshMatch ||
      freshMatch.status === "finished" ||
      freshMatch.suspended ||
      (freshMatch.source === "virtual" && minuteNumber(freshMatch.minute) >= 85)
    ) {
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
  const modelOpts = {
    homeForm: pricedMatch.homeForm ?? 1,
    awayForm: pricedMatch.awayForm ?? 1,
    redHome: pricedMatch.redHome ?? 0,
    redAway: pricedMatch.redAway ?? 0,
    events: pricedMatch.events ?? [],
    matchId: pricedMatch.id,
  };

  // Anti-triche : interdiction de parier sur une issue déjà décidée (gagnée ou
  // devenue impossible) — ex. « Plus de 2,5 » avec 3 buts inscrits, « 0-0 » à 1-0, etc.
  const minute = minuteNumber(pricedMatch.minute);
  if (
    pricedMatch.status === "live" &&
    marketOutcomeSettled(market, selection, homeScore, awayScore, minute, modelOpts)
  ) {
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
            minute,
            modelOpts
          )
        : marketOddsFor(market, selection, pricedMatch.homeTeam, pricedMatch.awayTeam, modelOpts);
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
          minute,
          modelOpts
        )
      : null;
  // Bloque en direct les issues quasi certaines (scalping à 1,01–1,03 en fin de match)
  if (
    pricedMatch.status === "live" &&
    pricedMatch.source === "virtual" &&
    (odds <= 1.03 || (liveProb != null && liveProb >= 0.945))
  ) {
    return NextResponse.json(
      { error: "Marché verrouillé — issue quasi acquise" },
      { status: 400 }
    );
  }

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
