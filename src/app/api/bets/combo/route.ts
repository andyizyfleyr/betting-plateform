import { desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { runLiveEngine } from "@/db/engine";
import {
  appUser,
  bets,
  comboBets,
  matches,
  predictionQuestions,
  type ComboLeg,
} from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  MIN_COMBO_LEGS,
} from "@/lib/combo-math";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import {
  customMarketLabel,
  customMarketOdds,
  isKnownMarket,
  liveMarketOddsFor,
  marketLabelFor,
  marketOddsFor,
  marketOutcomeSettled,
  minuteNumber,
} from "@/lib/markets";
import { maxStakeFor, playerRiskProfile } from "@/lib/risk";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const MIN_STAKE = 0.5;
const MAX_COMBO_STAKE = 200;
const BET_COOLDOWN_MS = 700;
const LIVE_VALIDATION_MS = 300;

interface IncomingLeg {
  kind: "sport" | "prediction";
  matchId?: number;
  questionId?: number;
  market?: string;
  selection: string;
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;
  await runLiveEngine();

  let body: { legs?: IncomingLeg[]; stake?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const rawLegs = Array.isArray(body.legs) ? body.legs : [];
  const stake = Number(body.stake);

  if (rawLegs.length < MIN_COMBO_LEGS) {
    return NextResponse.json(
      { error: `Un combiné nécessite au moins ${MIN_COMBO_LEGS} sélections` },
      { status: 400 }
    );
  }
  if (rawLegs.length > MAX_COMBO_LEGS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_COMBO_LEGS} sélections par combiné` },
      { status: 400 }
    );
  }
  if (!Number.isFinite(stake) || stake < MIN_STAKE) {
    return NextResponse.json(
      { error: `Mise minimale : ${MIN_STAKE} €` },
      { status: 400 }
    );
  }

  // Règle anti-corrélation bookmaker : 1 seule sélection par match et 1 seule par question !
  const seenMatches = new Set<number>();
  const seenQuestions = new Set<number>();

  for (const l of rawLegs) {
    if (!l || !l.selection) {
      return NextResponse.json({ error: "Sélection invalide dans le combiné" }, { status: 400 });
    }
    if (l.kind === "sport") {
      const mid = Number(l.matchId);
      if (!mid) return NextResponse.json({ error: "Match manquant" }, { status: 400 });
      if (seenMatches.has(mid)) {
        return NextResponse.json(
          { error: "Impossible de combiner deux sélections d'un même match" },
          { status: 400 }
        );
      }
      seenMatches.add(mid);
    } else if (l.kind === "prediction") {
      const qid = Number(l.questionId);
      if (!qid) return NextResponse.json({ error: "Question manquante" }, { status: 400 });
      if (seenQuestions.has(qid)) {
        return NextResponse.json(
          { error: "Impossible de combiner deux choix d'une même question" },
          { status: 400 }
        );
      }
      seenQuestions.add(qid);
    } else {
      return NextResponse.json({ error: "Type de sélection inconnu" }, { status: 400 });
    }
  }

  // Limite de mise dynamique selon le profil de risque du joueur
  const recentRows = await db
    .select({
      odds: bets.odds,
      stake: bets.stake,
      closingOdds: bets.closingOdds,
      status: bets.status,
    })
    .from(bets)
    .where(eq(bets.userId, uid))
    .orderBy(desc(bets.placedAt))
    .limit(30);

  const profile = playerRiskProfile(
    recentRows.map((b) => ({
      odds: b.odds,
      stake: b.stake,
      payout: b.status === "won" ? Math.round(b.stake * b.odds * 100) / 100 : 0,
      closingOdds: b.closingOdds ?? null,
    }))
  );
  const maxAllowed = Math.min(MAX_COMBO_STAKE, maxStakeFor(profile));
  if (stake > maxAllowed) {
    return NextResponse.json(
      { error: `Mise maximale autorisée sur ce combiné : ${maxAllowed} €` },
      { status: 400 }
    );
  }

  // Anti-spam
  const [lastCombo] = await db
    .select({ placedAt: comboBets.placedAt })
    .from(comboBets)
    .where(eq(comboBets.userId, uid))
    .orderBy(desc(comboBets.placedAt))
    .limit(1);
  if (lastCombo && Date.now() - lastCombo.placedAt.getTime() < BET_COOLDOWN_MS) {
    return NextResponse.json({ error: "Trop rapide — veuillez patienter" }, { status: 429 });
  }

  const [matchRows, questionRows] = await Promise.all([
    seenMatches.size > 0
      ? db.select().from(matches).where(inArray(matches.id, [...seenMatches]))
      : Promise.resolve([]),
    seenQuestions.size > 0
      ? db
          .select()
          .from(predictionQuestions)
          .where(inArray(predictionQuestions.id, [...seenQuestions]))
      : Promise.resolve([]),
  ]);

  let matchMap = new Map(matchRows.map((m) => [m.id, m]));
  const questionMap = new Map(questionRows.map((q) => [q.id, q]));

  // Si au moins un match du combiné est en direct, on effectue le contrôle anti-but (300 ms)
  const liveInitial = new Map<
    number,
    { homeScore: number; awayScore: number; redHome: number; redAway: number }
  >();
  for (const m of matchRows) {
    if (m.status === "live") {
      if (m.suspended || (m.source === "virtual" && minuteNumber(m.minute) >= 85)) {
        return NextResponse.json(
          { error: `Marché verrouillé sur ${m.homeTeam} – ${m.awayTeam}` },
          { status: 400 }
        );
      }
      liveInitial.set(m.id, {
        homeScore: m.homeScore ?? 0,
        awayScore: m.awayScore ?? 0,
        redHome: m.redHome ?? 0,
        redAway: m.redAway ?? 0,
      });
    }
  }

  if (liveInitial.size > 0) {
    await new Promise((r) => setTimeout(r, LIVE_VALIDATION_MS));
    await runLiveEngine();
    const freshMatches = await db
      .select()
      .from(matches)
      .where(inArray(matches.id, [...seenMatches]));
    matchMap = new Map(freshMatches.map((m) => [m.id, m]));

    for (const [mid, init] of liveInitial.entries()) {
      const fm = matchMap.get(mid);
      if (
        !fm ||
        fm.status === "finished" ||
        fm.suspended ||
        (fm.source === "virtual" && minuteNumber(fm.minute) >= 85)
      ) {
        return NextResponse.json(
          { error: "Un match en direct a été suspendu ou terminé pendant la validation" },
          { status: 400 }
        );
      }
      if (
        (fm.homeScore ?? 0) !== init.homeScore ||
        (fm.awayScore ?? 0) !== init.awayScore ||
        (fm.redHome ?? 0) !== init.redHome ||
        (fm.redAway ?? 0) !== init.redAway
      ) {
        return NextResponse.json(
          { error: "Action décisive en direct — cotes mises à jour, réessayez" },
          { status: 409 }
        );
      }
    }
  }

  // Recotation fixe serveur de chaque sélection du combiné
  const pricedLegs: ComboLeg[] = [];

  for (const leg of rawLegs) {
    if (leg.kind === "sport") {
      const m = matchMap.get(Number(leg.matchId));
      if (!m || m.status === "finished") {
        return NextResponse.json(
          { error: "L'un des matchs sélectionnés est déjà terminé" },
          { status: 400 }
        );
      }
      const market = leg.market ?? "result";
      if (!isKnownMarket(market) && !(m.source === "manual" && m.markets?.length)) {
        return NextResponse.json({ error: "Marché invalide" }, { status: 400 });
      }

      const h = m.homeScore ?? 0;
      const a = m.awayScore ?? 0;
      const min = minuteNumber(m.minute);

      if (m.status === "live" && isKnownMarket(market) && marketOutcomeSettled(market, leg.selection, h, a, min)) {
        return NextResponse.json(
          { error: `Sélection déjà décidée sur ${m.homeTeam} – ${m.awayTeam}` },
          { status: 400 }
        );
      }

      let odds: number | null = null;
      let selectionLabel: string | null = null;

      if (m.source === "manual" && m.markets && m.markets.length > 0) {
        odds = customMarketOdds(m.markets, market, leg.selection);
        selectionLabel = customMarketLabel(m.markets, market, leg.selection);
      } else {
        const formOpts = {
          homeForm: m.homeForm ?? 1,
          awayForm: m.awayForm ?? 1,
          redHome: m.redHome ?? 0,
          redAway: m.redAway ?? 0,
        };
        odds =
          m.status === "live"
            ? liveMarketOddsFor(market, leg.selection, m.homeTeam, m.awayTeam, h, a, min, formOpts)
            : marketOddsFor(market, leg.selection, m.homeTeam, m.awayTeam, formOpts);
        selectionLabel = marketLabelFor(market, leg.selection, m.homeTeam, m.awayTeam);
      }

      if (odds == null || selectionLabel == null) {
        return NextResponse.json(
          { error: `Sélection fermée sur ${m.homeTeam} – ${m.awayTeam}` },
          { status: 400 }
        );
      }
      if (m.status === "live" && m.source === "virtual" && odds <= 1.04) {
        return NextResponse.json(
          { error: `Cote verrouillée sur ${m.homeTeam} – ${m.awayTeam}` },
          { status: 400 }
        );
      }

      pricedLegs.push({
        kind: "sport",
        matchId: m.id,
        questionId: null,
        sport: m.sport,
        league: m.league,
        title: `${m.homeTeam} – ${m.awayTeam}`,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        market,
        selection: leg.selection,
        selectionLabel,
        odds,
        status: "pending",
      });
    } else {
      const q = questionMap.get(Number(leg.questionId));
      if (!q || q.status !== "open" || q.resolvesAt.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "L'une des questions sélectionnées est clôturée" },
          { status: 400 }
        );
      }

      let odds: number | null = null;
      let selectionLabel: string | null = null;
      const isMulti = Array.isArray(q.options) && q.options.length >= 2;

      if (isMulti && q.options) {
        const opt = q.options.find((o) => o.key === leg.selection);
        if (opt) {
          odds = opt.odds;
          selectionLabel = opt.label;
        }
      } else if (leg.selection === "yes" || leg.selection === "no") {
        odds = leg.selection === "yes" ? q.oddsYes : q.oddsNo;
        selectionLabel = leg.selection === "yes" ? "Oui" : "Non";
      }

      if (odds == null || selectionLabel == null) {
        return NextResponse.json(
          { error: `Choix invalide sur « ${q.question} »` },
          { status: 400 }
        );
      }

      pricedLegs.push({
        kind: "prediction",
        matchId: null,
        questionId: q.id,
        sport: "prédiction",
        league: q.category,
        title: q.question,
        market: isMulti ? "multichoice" : "yesno",
        selection: leg.selection,
        selectionLabel,
        odds,
        status: "pending",
      });
    }
  }

  const roundedStake = Math.round(stake * 100) / 100;
  const quote = computeComboQuote(
    pricedLegs.map((l) => l.odds),
    roundedStake
  );

  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user || user.balance < roundedStake) {
    return NextResponse.json({ error: "Solde insuffisant" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(comboBets)
      .values({
        userId: uid,
        legs: pricedLegs,
        baseOdds: quote.baseOdds,
        boostPct: quote.boostPct,
        totalOdds: quote.totalOdds,
        stake: roundedStake,
        potentialWin: quote.potentialWin,
        status: "pending",
      })
      .returning();

    const [updatedUser] = await tx
      .update(appUser)
      .set({ balance: sql`${appUser.balance} - ${roundedStake}` })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    // Incrémente aussi le volume statistique sur les questions incluses
    for (const l of pricedLegs) {
      if (l.kind === "prediction" && l.questionId) {
        const share = Math.round((roundedStake / pricedLegs.length) * 100) / 100;
        await tx
          .update(predictionQuestions)
          .set({ volume: sql`${predictionQuestions.volume} + ${share}` })
          .where(eq(predictionQuestions.id, l.questionId));
      }
    }

    return { bet: inserted, balance: updatedUser.balance };
  });

  invalidateHouseHealthCache();
  return NextResponse.json(result);
}
