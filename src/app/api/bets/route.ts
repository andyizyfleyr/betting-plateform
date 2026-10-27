import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import {
  checkpointVirtualMatchesForBet,
  hydrateLiveMatchRow,
  runLiveEngine,
} from "@/db/engine";
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
import {
  getCachedMatchById,
  getCachedUserBetsResponse,
  notifyNewBetPlaced,
  setCachedUserBetsResponse,
} from "@/lib/active-state-cache";
import { computeCashOut, computePredictionCashOut } from "@/lib/cashout";
import { computeComboCashOut, resolveComboLegStatus } from "@/lib/combo";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import {
  isKnownMarket,
  isRealMatchKickoffReached,
  isRealMatchPostIncidentSuspended,
  liveMarketOddsFor,
  liveOutcomeProbability,
  marketLabelFor,
  marketOddsFor,
  marketOutcomeSettled,
  minuteNumber,
  realMatchOddsFor,
} from "@/lib/markets";
import { ensureMlLoaded, predictBatchUserMlRisk } from "@/lib/ml-engine";
import {
  isRealMatchFeedStale,
  verifyLiveRealMatchesBeforeBet,
} from "@/lib/real-sports-feed";
import { clvOf, isNearDecided, maxStakeFor, playerRiskProfile } from "@/lib/risk";
import {
  checkOddsChange,
  extractIdempotencyKey,
  normalizeOddsPolicy,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
} from "@/lib/odds-lock";
import {
  computeIdempotencyHash,
  idempotencyConflictResponse,
  lookupIdempotencyRecord,
  saveIdempotencyRecord,
} from "@/lib/idempotency";
import { requireUserId } from "@/lib/session";
import { formatServerErrorResponse } from "@/lib/db-error";
import { jsonWithEtag } from "@/lib/response-cache";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Anti-triche : limites de mise (€) et intervalle minimal entre deux paris. */
const MIN_STAKE = 0.5;
const BET_COOLDOWN_MS = 700;
/** Délai court de validation des paris en direct (recotation serveur + vérification anti-but). */
const LIVE_VALIDATION_MS = 300;

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    await syncLiveMatchesThrottled();

  const filter = req.nextUrl.searchParams.get("filter") ?? "all";
  const cachedResp = getCachedUserBetsResponse(uid, filter);
  if (cachedResp) {
    return jsonWithEtag(req, null, cachedResp);
  }

  const SETTLED_HISTORY_LIMIT = 60;
  const nowMs = Date.now();

  // Projection SQL ultra-légère pour les paris déjà réglés : n'extrait AUCUN JSONB (`markets`,
  // `scripted_events`, `tick_history`, `real_stats`, `events`) des matchs terminés !
  const settledMatchScalarCols = {
    id: matches.id,
    status: matches.status,
    homeTeam: matches.homeTeam,
    awayTeam: matches.awayTeam,
    homeScore: matches.homeScore,
    awayScore: matches.awayScore,
    homeLogo: matches.homeLogo,
    awayLogo: matches.awayLogo,
    minute: matches.minute,
    startsAt: matches.startsAt,
    source: matches.source,
    oddsHome: matches.oddsHome,
    oddsDraw: matches.oddsDraw,
    oddsAway: matches.oddsAway,
    suspended: matches.suspended,
  };

  // Exécution groupée en 1 seule vague parallèle
  const [
    pendingSportRows,
    settledSportRawRows,
    pendingPredRows,
    settledPredRows,
    pendingComboRows,
    settledComboRows,
    [user],
  ] = await Promise.all([
    filter === "finished"
      ? Promise.resolve([])
      : db
          .select({ bet: bets, match: matches })
          .from(bets)
          .leftJoin(matches, eq(bets.matchId, matches.id))
          .where(and(eq(bets.userId, uid), eq(bets.status, "pending")))
          .orderBy(desc(bets.placedAt)),
    filter === "ongoing"
      ? Promise.resolve([])
      : db
          .select({ bet: bets, match: settledMatchScalarCols })
          .from(bets)
          .leftJoin(matches, eq(bets.matchId, matches.id))
          .where(and(eq(bets.userId, uid), ne(bets.status, "pending")))
          .orderBy(sql`${bets.settledAt} DESC NULLS LAST`, desc(bets.placedAt))
          .limit(SETTLED_HISTORY_LIMIT),
    filter === "finished"
      ? Promise.resolve([])
      : db
          .select({ bet: predictionBets, question: predictionQuestions })
          .from(predictionBets)
          .leftJoin(predictionQuestions, eq(predictionBets.questionId, predictionQuestions.id))
          .where(and(eq(predictionBets.userId, uid), eq(predictionBets.status, "pending")))
          .orderBy(desc(predictionBets.placedAt)),
    filter === "ongoing"
      ? Promise.resolve([])
      : db
          .select({ bet: predictionBets, question: predictionQuestions })
          .from(predictionBets)
          .leftJoin(predictionQuestions, eq(predictionBets.questionId, predictionQuestions.id))
          .where(and(eq(predictionBets.userId, uid), ne(predictionBets.status, "pending")))
          .orderBy(
            sql`${predictionBets.settledAt} DESC NULLS LAST`,
            desc(predictionBets.placedAt)
          )
          .limit(SETTLED_HISTORY_LIMIT),
    filter === "finished"
      ? Promise.resolve([])
      : db
          .select()
          .from(comboBets)
          .where(and(eq(comboBets.userId, uid), eq(comboBets.status, "pending")))
          .orderBy(desc(comboBets.placedAt)),
    filter === "ongoing"
      ? Promise.resolve([])
      : db
          .select()
          .from(comboBets)
          .where(and(eq(comboBets.userId, uid), ne(comboBets.status, "pending")))
          .orderBy(sql`${comboBets.settledAt} DESC NULLS LAST`, desc(comboBets.placedAt))
          .limit(SETTLED_HISTORY_LIMIT),
    db
      .select({ balance: appUser.balance })
      .from(appUser)
      .where(eq(appUser.id, uid)),
  ]);
  const hydratedPendingSportRows = pendingSportRows.map((r) => ({
    bet: r.bet,
    match: r.match ? hydrateLiveMatchRow(r.match, nowMs) : null,
  }));
  const settledSportRows = settledSportRawRows.map((r) => ({
    bet: r.bet,
    match: (r.match ? (r.match as unknown as MatchRow) : null),
  }));

  const rows = [...hydratedPendingSportRows, ...settledSportRows];
  const predRows = [...pendingPredRows, ...settledPredRows];
  const comboRows = [...pendingComboRows, ...settledComboRows];

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
      homeLogo: teamLogo(bet.homeTeam, match?.homeLogo),
      awayLogo: teamLogo(bet.awayTeam, match?.awayLogo),
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
        livePending &&
        match &&
        !match.suspended &&
        !(
          match.source === "manual" &&
          (isRealMatchPostIncidentSuspended(match) || isRealMatchFeedStale(match))
        )
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
              htHomeScore: match.htHomeScore ?? match.realStats?.htHomeScore ?? null,
              htAwayScore: match.htAwayScore ?? match.realStats?.htAwayScore ?? null,
              redHome: match.redHome ?? 0,
              redAway: match.redAway ?? 0,
              homeForm: match.homeForm ?? 1,
              awayForm: match.awayForm ?? 1,
              events: match.events ?? null,
              matchId: match.id,
              source: match.source ?? "virtual",
              externalId: match.externalId ?? null,
              autoSync: match.autoSync ?? true,
              oddsHome: match.oddsHome,
              oddsDraw: match.oddsDraw,
              oddsAway: match.oddsAway,
              markets: match.markets ?? null,
            })
          : null,
      placedAt: bet.placedAt,
      settledAt: bet.settledAt ?? null,
      matchStatus: match
        ? (match.status === "live" || match.status === "finished" ? match.status : "upcoming")
        : null,
      matchHomeScore: match?.homeScore ?? null,
      matchAwayScore: match?.awayScore ?? null,
      matchMinute: match?.minute ?? null,
      matchStartsAt: match?.startsAt ?? null,
      matchSource: match ? (match.source === "manual" ? "manual" : "virtual") : null,
    };
  });

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

  const comboMatchMap = new Map<number, MatchRow>();
  const comboQuestionMap = new Map<number, PredictionQuestionRow>();

  if (comboRows.length > 0) {
    for (const r of rows) {
      if (r.match) comboMatchMap.set(r.match.id, r.match);
    }
    for (const pr of predRows) {
      if (pr.question) comboQuestionMap.set(pr.question.id, pr.question);
    }

    const missingMatchIds = new Set<number>();
    const missingQuestionIds = new Set<number>();
    for (const c of comboRows) {
      for (const l of c.legs ?? []) {
        if (l.kind === "sport" && l.matchId && !comboMatchMap.has(l.matchId)) {
          missingMatchIds.add(l.matchId);
        }
        if (l.kind === "prediction" && l.questionId && !comboQuestionMap.has(l.questionId)) {
          missingQuestionIds.add(l.questionId);
        }
      }
    }

    if (missingMatchIds.size > 0 || missingQuestionIds.size > 0) {
      // Cherche d'abord dans la RAM (0 SQL pour les matchs actifs ou récents !)
      const stillMissingMatches: number[] = [];
      for (const mid of missingMatchIds) {
        const fromRam = getCachedMatchById(mid);
        if (fromRam) {
          comboMatchMap.set(mid, hydrateLiveMatchRow(fromRam, nowMs));
        } else {
          stillMissingMatches.push(mid);
        }
      }

      const [mRows, qRows] = await Promise.all([
        stillMissingMatches.length > 0
          ? db.select().from(matches).where(inArray(matches.id, stillMissingMatches))
          : Promise.resolve([] as MatchRow[]),
        missingQuestionIds.size > 0
          ? db
              .select()
              .from(predictionQuestions)
              .where(inArray(predictionQuestions.id, [...missingQuestionIds]))
          : Promise.resolve([] as PredictionQuestionRow[]),
      ]);
      for (const m of mRows) comboMatchMap.set(m.id, hydrateLiveMatchRow(m, nowMs));
      for (const q of qRows) comboQuestionMap.set(q.id, q);
    }
  }

  const comboMapped = comboRows.map((cb) => {
    const rawLegs = (cb.legs ?? []).map((l) => {
      const resolvedStatus = resolveComboLegStatus(l, comboMatchMap, comboQuestionMap);
      const m = l.kind === "sport" && l.matchId ? comboMatchMap.get(l.matchId) : undefined;
      const q =
        l.kind === "prediction" && l.questionId
          ? comboQuestionMap.get(l.questionId)
          : undefined;
      const titleParts =
        l.kind === "sport" && (!l.homeTeam || !l.awayTeam) && l.title.includes("–")
          ? l.title.split("–").map((s) => s.trim())
          : null;
      const homeTeam =
        l.kind === "sport"
          ? (l.homeTeam || m?.homeTeam || titleParts?.[0] || undefined)
          : l.homeTeam;
      const awayTeam =
        l.kind === "sport"
          ? (l.awayTeam || m?.awayTeam || titleParts?.[1] || undefined)
          : l.awayTeam;
      const resolvedSelLabel =
        l.kind === "sport" && homeTeam && awayTeam && isKnownMarket(l.market)
          ? (marketLabelFor(l.market, l.selection, homeTeam, awayTeam) ?? l.selectionLabel)
          : l.selectionLabel;

      const startsAtIso = m?.startsAt
        ? m.startsAt.toISOString()
        : q?.resolvesAt
          ? q.resolvesAt.toISOString()
          : null;

      return {
        ...l,
        homeTeam,
        awayTeam,
        homeLogo:
          l.kind === "sport" ? teamLogo(homeTeam, l.homeLogo ?? m?.homeLogo) : null,
        awayLogo:
          l.kind === "sport" ? teamLogo(awayTeam, l.awayLogo ?? m?.awayLogo) : null,
        status: resolvedStatus,
        selectionLabel: resolvedSelLabel,
        matchStatus: m
          ? (m.status === "live" || m.status === "finished" ? m.status : "upcoming")
          : q
            ? (q.status === "open" ? "upcoming" : "finished")
            : null,
        matchHomeScore: m?.homeScore ?? null,
        matchAwayScore: m?.awayScore ?? null,
        matchMinute: m?.minute ?? null,
        matchStartsAt: startsAtIso,
        matchSource: m ? (m.source === "manual" ? "manual" : "virtual") : null,
      };
    });
    const legs = sortComboBetLegsChronologically(rawLegs);
    const liveMatch = legs
      .map((l) => (l.kind === "sport" && l.matchId ? comboMatchMap.get(l.matchId) : undefined))
      .find((m) => m?.status === "live");

    return {
      id: cb.id,
      kind: "combo" as const,
      matchId: null,
      sport: "combiné",
      league: `Combiné (${legs.length})`,
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

  const payload = { bets: filtered, balance: user?.balance ?? null };
  const entry = setCachedUserBetsResponse(uid, filter, payload);
  return jsonWithEtag(req, null, entry);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/bets");
  }
}

export async function POST(req: NextRequest) {
  try {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;
  await ensureMlLoaded();
  await syncLiveMatchesThrottled();

  let body: {
    matchId?: number;
    selection?: string;
    market?: string;
    stake?: number;
    expectedOdds?: number;
    oddsPolicy?: string;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const { matchId, selection, stake } = body;
  const expectedOdds = Number(body.expectedOdds);
  const oddsPolicy = normalizeOddsPolicy(body.oddsPolicy);
  const idempotencyKey = extractIdempotencyKey(
    body.idempotencyKey,
    req.headers.get("idempotency-key")
  );
  const market = body.market ?? "result";

  if (!matchId || !selection || !stake || stake <= 0) {
    return NextResponse.json({ error: "Données du pari incomplètes" }, { status: 400 });
  }
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "Clé d'idempotence manquante ou invalide" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(expectedOdds) || expectedOdds <= 1) {
    return NextResponse.json(
      { error: "Cote affichée manquante ou invalide — veuillez rafraîchir le coupon" },
      { status: 400 }
    );
  }
  if (stake < MIN_STAKE) {
    return NextResponse.json(
      { error: `Mise hors limites (minimum ${MIN_STAKE} €)` },
      { status: 400 }
    );
  }

  const roundedInputStake = Math.round(Number(stake) * 100) / 100;
  const requestHash = computeIdempotencyHash({
    matchId: Number(matchId),
    market,
    selection,
    stake: roundedInputStake,
    expectedOdds: roundOdds2(expectedOdds),
  });

  // 1) Vérification O(1) du registre d'idempotence (avec refus 409 si contenu différent)
  const preIdem = await lookupIdempotencyRecord(
    db,
    uid,
    "bet:sport",
    idempotencyKey,
    requestHash
  );
  if (preIdem.kind === "conflict") {
    return idempotencyConflictResponse();
  }
  if (preIdem.kind === "hit") {
    const [u] = await db
      .select({ balance: appUser.balance })
      .from(appUser)
      .where(eq(appUser.id, uid));
    return NextResponse.json({
      ...preIdem.responseBody,
      balance: u?.balance ?? preIdem.responseBody.balance ?? 0,
      deduplicated: true,
    });
  }

  // Fallback O(1) sur la colonne `bets.idempotency_key` (rétrocompatibilité)
  const [alreadyPlaced] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.userId, uid), eq(bets.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (alreadyPlaced) {
    if (
      alreadyPlaced.matchId !== Number(matchId) ||
      alreadyPlaced.market !== market ||
      alreadyPlaced.selection !== selection ||
      Math.round(alreadyPlaced.stake * 100) !== Math.round(roundedInputStake * 100)
    ) {
      return idempotencyConflictResponse();
    }
    const [u] = await db
      .select({ balance: appUser.balance })
      .from(appUser)
      .where(eq(appUser.id, uid));
    return NextResponse.json({
      bet: alreadyPlaced,
      balance: u?.balance ?? 0,
      deduplicated: true,
    });
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

  const [rawMatch] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!rawMatch) {
    return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
  }
  const checkpointMap = await checkpointVirtualMatchesForBet([rawMatch]);
  const match = checkpointMap.get(rawMatch.id) ?? rawMatch;
  if (!isKnownMarket(market) && !(match.source === "manual" && match.markets?.length)) {
    return NextResponse.json({ error: "Marché invalide" }, { status: 400 });
  }
  if (match.status === "finished") {
    return NextResponse.json({ error: "Ce match est terminé" }, { status: 400 });
  }
  if (match.suspended) {
    return NextResponse.json({ error: "Les cotes de ce match sont actuellement suspendues" }, { status: 400 });
  }
  if (match.source === "manual" && isRealMatchKickoffReached(match)) {
    return NextResponse.json(
      { error: "Coup d'envoi dépassé — paris pré-match clôturés en attente du direct" },
      { status: 400 }
    );
  }

  // Anti-fractionnement : plafonne l'exposition cumulée d'un même joueur sur un même match
  // (exclut la clé courante afin qu'un réessai idempotent parallèle ne se bloque jamais lui-même).
  const [existingMatchStake] = await db
    .select({
      staked: sql<number>`COALESCE(SUM(${bets.stake}), 0)::float8`,
    })
    .from(bets)
    .where(
      and(
        eq(bets.userId, uid),
        eq(bets.matchId, matchId),
        eq(bets.status, "pending"),
        sql`${bets.idempotencyKey} IS DISTINCT FROM ${idempotencyKey}`
      )
    );
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
    if (
      match.suspended ||
      (match.source === "virtual" && minuteNumber(match.minute) >= 85) ||
      (match.source === "manual" && minuteNumber(match.minute) >= 88)
    ) {
      return NextResponse.json(
        { error: "Marché verrouillé (fin de match ou action en cours)" },
        { status: 400 }
      );
    }

    if (match.source === "manual") {
      // Garde-fou anti-late-bet sur match réel : synchronisation fraîche + délai live + détection but/carton
      const realGuard = await verifyLiveRealMatchesBeforeBet([match]);
      if (!realGuard.ok) {
        return NextResponse.json(
          { error: realGuard.error },
          { status: 409 }
        );
      }
      pricedMatch = realGuard.refreshedMap.get(match.id) ?? match;
    } else {
      await new Promise((resolve) => setTimeout(resolve, LIVE_VALIDATION_MS));
      await runLiveEngine();
      const [freshRaw] = await db.select().from(matches).where(eq(matches.id, matchId));
      const freshMap = freshRaw
        ? await checkpointVirtualMatchesForBet([freshRaw])
        : new Map<number, MatchRow>();
      const freshMatch = freshRaw ? (freshMap.get(freshRaw.id) ?? freshRaw) : null;
      if (
        !freshMatch ||
        freshMatch.status === "finished" ||
        freshMatch.suspended ||
        minuteNumber(freshMatch.minute) >= 85
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
  }

  const homeScore = pricedMatch.homeScore ?? 0;
  const awayScore = pricedMatch.awayScore ?? 0;
  const modelOpts = {
    homeForm: pricedMatch.homeForm ?? 1,
    awayForm: pricedMatch.awayForm ?? 1,
    redHome: pricedMatch.redHome ?? 0,
    redAway: pricedMatch.redAway ?? 0,
    events: pricedMatch.events ?? [],
    regime: pricedMatch.regime ?? null,
    league: pricedMatch.league ?? null,
    matchId: pricedMatch.id,
  };

  // Anti-triche : interdiction de parier sur une issue déjà décidée (gagnée ou
  // devenue impossible) — ex. « Plus de 2,5 » avec 3 buts inscrits, « 0-0 » à 1-0, etc.
  const minute = minuteNumber(pricedMatch.minute);
  if (
    pricedMatch.status === "live" &&
    isKnownMarket(market) &&
    marketOutcomeSettled(market, selection, homeScore, awayScore, minute, modelOpts)
  ) {
    return NextResponse.json({ error: "Ce marché est déjà décidé" }, { status: 400 });
  }

  // Cotation fixe bookmaker totalement séparée entre Matchs Réels et Matchs Virtuels
  let odds: number | null = null;
  let selectionLabel: string | null = null;
  if (pricedMatch.source === "manual") {
    const realHit = realMatchOddsFor(pricedMatch, market, selection);
    if (!realHit) {
      return NextResponse.json({ error: "Sélection fermée ou invalide" }, { status: 400 });
    }
    odds = realHit.odds;
    selectionLabel = realHit.label;
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

  const roundedStake = Math.round(stake * 100) / 100;

  // Transaction courte purement SQL (0 appel externe) :
  //  1) `SET LOCAL lock_timeout = '2500ms'` pour éviter toute file d'attente infinie
  //  2) `FOR SHARE` sur `matches` (500 parieurs simultanés ne se bloquent pas entre eux,
  //     tout en bloquant une mutation concurrente du score/statut)
  //  3) Comparaison `expectedOdds` AVANT tout débit
  //  4) `FOR UPDATE` sur `app_user` (ordre global : `matches` -> `prediction_questions` -> `app_user`)
  //  5) Déduplication atomique `idempotencyKey` contre tout double clic simultané
  type TxOutcome =
    | {
        kind: "ok";
        bet: typeof bets.$inferSelect;
        balance: number;
        deduplicated?: boolean;
      }
    | { kind: "idempotency_conflict" }
    | { kind: "error"; status: number; error: string }
    | { kind: "odds_changed"; details: OddsChangedDetails };

  const txResult: TxOutcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5000ms'`);

    const [lockedRaw] = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("share");

    if (!lockedRaw) {
      return { kind: "error", status: 404, error: "Match introuvable" };
    }

    const [lockedUser] = await tx
      .select({ id: appUser.id, balance: appUser.balance })
      .from(appUser)
      .where(eq(appUser.id, uid))
      .for("update");

    if (!lockedUser) {
      return { kind: "error", status: 404, error: "Compte introuvable" };
    }

    // Déduplication atomique AVANT les contrôles dynamiques de cote/suspension :
    // 20 requêtes identiques envoyées en parallèle retournent 1 création + 19 `deduplicated: true`.
    const inTxIdem = await lookupIdempotencyRecord(
      tx,
      uid,
      "bet:sport",
      idempotencyKey,
      requestHash
    );
    if (inTxIdem.kind === "conflict") {
      return { kind: "idempotency_conflict" };
    }
    if (inTxIdem.kind === "hit" && inTxIdem.responseBody.bet) {
      return {
        kind: "ok",
        bet: inTxIdem.responseBody.bet as typeof bets.$inferSelect,
        balance: lockedUser.balance,
        deduplicated: true,
      };
    }

    const [concurrentExisting] = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.userId, uid), eq(bets.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (concurrentExisting) {
      if (
        concurrentExisting.matchId !== lockedRaw.id ||
        concurrentExisting.market !== market ||
        concurrentExisting.selection !== selection ||
        Math.round(concurrentExisting.stake * 100) !== Math.round(roundedStake * 100)
      ) {
        return { kind: "idempotency_conflict" };
      }
      return {
        kind: "ok",
        bet: concurrentExisting,
        balance: lockedUser.balance,
        deduplicated: true,
      };
    }

    const lockedMatch =
      lockedRaw.source === "manual" ||
      lockedRaw.status !== "live" ||
      lockedRaw.suspended
        ? lockedRaw
        : hydrateLiveMatchRow(lockedRaw, Date.now());

    if (lockedMatch.status === "finished") {
      return { kind: "error", status: 400, error: "Ce match est terminé" };
    }
    if (lockedMatch.suspended) {
      return {
        kind: "error",
        status: 400,
        error: "Les cotes de ce match sont actuellement suspendues",
      };
    }
    if (lockedMatch.source === "manual" && isRealMatchKickoffReached(lockedMatch)) {
      return {
        kind: "error",
        status: 400,
        error: "Coup d'envoi dépassé — paris pré-match clôturés en attente du direct",
      };
    }

    const txMinute = minuteNumber(lockedMatch.minute);
    const txHomeScore = lockedMatch.homeScore ?? 0;
    const txAwayScore = lockedMatch.awayScore ?? 0;

    if (lockedMatch.status === "live") {
      if (
        (lockedMatch.source === "virtual" && txMinute >= 85) ||
        (lockedMatch.source === "manual" && txMinute >= 88)
      ) {
        return {
          kind: "error",
          status: 400,
          error: "Marché verrouillé (fin de match ou action en cours)",
        };
      }
      if (
        txHomeScore !== initialHomeScore ||
        txAwayScore !== initialAwayScore ||
        (lockedMatch.redHome ?? 0) !== initialRedHome ||
        (lockedMatch.redAway ?? 0) !== initialRedAway
      ) {
        return {
          kind: "error",
          status: 409,
          error: "Action décisive survenue pendant la validation — cote mise à jour, réessayez",
        };
      }
    }

    const txModelOpts = {
      homeForm: lockedMatch.homeForm ?? 1,
      awayForm: lockedMatch.awayForm ?? 1,
      redHome: lockedMatch.redHome ?? 0,
      redAway: lockedMatch.redAway ?? 0,
      events: lockedMatch.events ?? [],
      regime: lockedMatch.regime ?? null,
      league: lockedMatch.league ?? null,
      matchId: lockedMatch.id,
    };

    if (
      lockedMatch.status === "live" &&
      isKnownMarket(market) &&
      marketOutcomeSettled(market, selection, txHomeScore, txAwayScore, txMinute, txModelOpts)
    ) {
      return { kind: "error", status: 400, error: "Ce marché est déjà décidé" };
    }

    let rawServerOdds: number | null = null;
    let txSelectionLabel: string | null = null;
    if (lockedMatch.source === "manual") {
      const realHit = realMatchOddsFor(lockedMatch, market, selection);
      if (!realHit) {
        return { kind: "error", status: 400, error: "Sélection fermée ou invalide" };
      }
      rawServerOdds = realHit.odds;
      txSelectionLabel = realHit.label;
    } else {
      rawServerOdds =
        lockedMatch.status === "live"
          ? liveMarketOddsFor(
              market,
              selection,
              lockedMatch.homeTeam,
              lockedMatch.awayTeam,
              txHomeScore,
              txAwayScore,
              txMinute,
              txModelOpts
            )
          : marketOddsFor(
              market,
              selection,
              lockedMatch.homeTeam,
              lockedMatch.awayTeam,
              txModelOpts
            );
      txSelectionLabel = marketLabelFor(
        market,
        selection,
        lockedMatch.homeTeam,
        lockedMatch.awayTeam
      );
      if (rawServerOdds == null || txSelectionLabel == null) {
        return { kind: "error", status: 400, error: "Sélection invalide" };
      }
    }

    const serverOdds = roundOdds2(rawServerOdds);

    const txLiveProb =
      lockedMatch.status === "live" && lockedMatch.source !== "manual"
        ? liveOutcomeProbability(
            market,
            selection,
            lockedMatch.homeTeam,
            lockedMatch.awayTeam,
            txHomeScore,
            txAwayScore,
            txMinute,
            txModelOpts
          )
        : null;

    if (
      lockedMatch.status === "live" &&
      (serverOdds <= 1.03 || (txLiveProb != null && txLiveProb >= 0.945))
    ) {
      return {
        kind: "error",
        status: 400,
        error: "Marché verrouillé — issue quasi acquise",
      };
    }

    // Contrôle strict de variation de cote AVANT tout débit (ne fait JAMAIS confiance à expectedOdds pour le gain)
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

    if (lockedUser.balance < roundedStake) {
      return { kind: "error", status: 400, error: "Solde insuffisant" };
    }

    // Anti-spam sous verrou `app_user FOR UPDATE` (après contrôle idempotence et solde) :
    // bloque les rafales de paris distincts quand le solde permettrait d'en enchaîner plusieurs en < 700 ms.
    const [lastBetInTx] = await tx
      .select({ placedAt: bets.placedAt })
      .from(bets)
      .where(eq(bets.userId, uid))
      .orderBy(desc(bets.placedAt))
      .limit(1);
    if (lastBetInTx && Date.now() - lastBetInTx.placedAt.getTime() < BET_COOLDOWN_MS) {
      return { kind: "error", status: 429, error: "Trop rapide — veuillez patienter" };
    }

    const txRiskFlag =
      lockedMatch.status === "live" &&
      isNearDecided(
        market,
        selection,
        txHomeScore,
        txAwayScore,
        txMinute,
        txLiveProb
      )
        ? "stale_near_decided"
        : null;

    // Gain potentiel calculé EXCLUSIVEMENT avec `serverOdds`
    const potentialWin = Math.round(roundedStake * serverOdds * 100) / 100;

    const [bet] = await tx
      .insert(bets)
      .values({
        userId: uid,
        matchId: lockedMatch.id,
        sport: lockedMatch.sport,
        league: lockedMatch.league,
        homeTeam: lockedMatch.homeTeam,
        awayTeam: lockedMatch.awayTeam,
        market,
        selection,
        selectionLabel: txSelectionLabel,
        odds: serverOdds,
        stake: roundedStake,
        potentialWin,
        status: "pending",
        riskFlag: txRiskFlag,
        idempotencyKey,
      })
      .returning();

    const [updatedUser] = await tx
      .update(appUser)
      .set({
        balance: sql`ROUND((${appUser.balance} - ${roundedStake})::numeric, 2)::float8`,
      })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    await saveIdempotencyRecord(tx, {
      userId: uid,
      scope: "bet:sport",
      idempotencyKey,
      requestHash,
      statusCode: 200,
      responseBody: { bet, balance: updatedUser.balance },
    });

    return { kind: "ok", bet, balance: updatedUser.balance };
  });

  if (txResult.kind === "idempotency_conflict") {
    return idempotencyConflictResponse();
  }

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

  if (!txResult.deduplicated) {
    notifyNewBetPlaced({ userId: uid, kind: "sport" });
  }
  return NextResponse.json({
    bet: txResult.bet,
    balance: txResult.balance,
    ...(txResult.deduplicated ? { deduplicated: true } : {}),
  });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/bets");
  }
}
