import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
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
  predictionQuestions,
  type ComboLeg,
} from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { notifyNewBetPlaced } from "@/lib/active-state-cache";
import {
  computeComboQuote,
  MAX_COMBO_LEGS,
  MIN_COMBO_LEGS,
} from "@/lib/combo-math";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import { invalidatePredictionsCatalogCache } from "@/lib/response-cache";
import {
  isKnownMarket,
  isRealMatchKickoffReached,
  liveMarketOddsFor,
  marketLabelFor,
  marketOddsFor,
  marketOutcomeSettled,
  minuteNumber,
  realMatchOddsFor,
} from "@/lib/markets";
import { maxStakeFor, playerRiskProfile } from "@/lib/risk";
import {
  checkOddsChange,
  normalizeOddsPolicy,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type OddsChangedDetails,
  type OddsChangedLegDetail,
} from "@/lib/odds-lock";
import { ensureMlLoaded, predictBatchUserMlRisk } from "@/lib/ml-engine";
import { verifyLiveRealMatchesBeforeBet } from "@/lib/real-sports-feed";
import { requireUserId } from "@/lib/session";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

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
  expectedOdds?: number;
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;
  await ensureMlLoaded();
  await syncLiveMatchesThrottled();

  let body: {
    legs?: IncomingLeg[];
    stake?: number;
    expectedTotalOdds?: number;
    oddsPolicy?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const rawLegs = Array.isArray(body.legs) ? body.legs : [];
  const stake = Number(body.stake);
  const expectedTotalOdds = Number(body.expectedTotalOdds);
  const oddsPolicy = normalizeOddsPolicy(body.oddsPolicy);

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
  if (!Number.isFinite(expectedTotalOdds) || expectedTotalOdds <= 1) {
    return NextResponse.json(
      { error: "Cote totale attendue manquante ou invalide — veuillez rafraîchir le coupon" },
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
    const legExpected = Number(l.expectedOdds);
    if (!Number.isFinite(legExpected) || legExpected <= 1) {
      return NextResponse.json(
        { error: "Cote affichée manquante sur l'une des sélections du coupon" },
        { status: 400 }
      );
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
  const mlRiskMap = await predictBatchUserMlRisk([uid]);
  const mlCeiling = mlRiskMap.get(uid)?.maxStake ?? 500;
  const maxAllowed = Math.min(MAX_COMBO_STAKE, maxStakeFor(profile), mlCeiling);
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

  const initialMatchRows =
    seenMatches.size > 0
      ? await db.select().from(matches).where(inArray(matches.id, [...seenMatches]))
      : [];

  const initialMatchMap = await checkpointVirtualMatchesForBet(initialMatchRows);
  const syncedMatchRows = [...initialMatchMap.values()];

  // Séparation stricte : interdiction absolue de mélanger des matchs réels et des matchs virtuels
  const hasRealMatch = syncedMatchRows.some((m) => m.source === "manual");
  const hasVirtualMatch = syncedMatchRows.some((m) => m.source !== "manual");
  if (hasRealMatch && hasVirtualMatch) {
    return NextResponse.json(
      {
        error:
          "Impossible de mélanger des matchs réels et des matchs virtuels dans un même pari combiné",
      },
      { status: 400 }
    );
  }

  for (const m of syncedMatchRows) {
    if (m.suspended) {
      return NextResponse.json(
        { error: `Cotes suspendues sur ${m.homeTeam} – ${m.awayTeam}` },
        { status: 400 }
      );
    }
    if (m.source === "manual" && isRealMatchKickoffReached(m)) {
      return NextResponse.json(
        { error: `Coup d'envoi dépassé sur ${m.homeTeam} – ${m.awayTeam}` },
        { status: 400 }
      );
    }
  }

  // Capture de l'état live initial et délai anti-but avant d'ouvrir la transaction SQL
  const liveInitial = new Map<
    number,
    { homeScore: number; awayScore: number; redHome: number; redAway: number }
  >();
  const liveRealRows = syncedMatchRows.filter(
    (m) => m.status === "live" && m.source === "manual"
  );
  for (const m of syncedMatchRows) {
    if (m.status === "live") {
      if (
        m.suspended ||
        (m.source === "virtual" && minuteNumber(m.minute) >= 85) ||
        (m.source === "manual" && minuteNumber(m.minute) >= 88)
      ) {
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
    if (liveRealRows.length > 0) {
      const realGuard = await verifyLiveRealMatchesBeforeBet(liveRealRows);
      if (!realGuard.ok) {
        return NextResponse.json({ error: realGuard.error }, { status: 409 });
      }
    } else {
      await new Promise((r) => setTimeout(r, LIVE_VALIDATION_MS));
      if (hasVirtualMatch) {
        await runLiveEngine();
      }
      const freshMatches = await db
        .select()
        .from(matches)
        .where(inArray(matches.id, [...seenMatches]));
      await checkpointVirtualMatchesForBet(freshMatches);
    }
  }

  const roundedStake = Math.round(stake * 100) / 100;

  type ComboTxOutcome =
    | {
        kind: "ok";
        bet: typeof comboBets.$inferSelect;
        balance: number;
        hasPredLeg: boolean;
      }
    | { kind: "error"; status: number; error: string }
    | { kind: "odds_changed"; details: OddsChangedDetails };

  // Transaction SQL atomique : verrouillage ordonné (`ORDER BY id FOR UPDATE`) des matchs,
  // des questions et du joueur, comparaison des cotes AVANT tout débit, et calcul serveur du gain.
  const txResult: ComboTxOutcome = await db.transaction(async (tx) => {
    const lockedMatchesRaw =
      seenMatches.size > 0
        ? await tx
            .select()
            .from(matches)
            .where(inArray(matches.id, [...seenMatches]))
            .orderBy(asc(matches.id))
            .for("update")
        : [];

    const lockedQuestions =
      seenQuestions.size > 0
        ? await tx
            .select()
            .from(predictionQuestions)
            .where(inArray(predictionQuestions.id, [...seenQuestions]))
            .orderBy(asc(predictionQuestions.id))
            .for("update")
        : [];

    const nowMs = Date.now();
    const txMatchMap = new Map(
      lockedMatchesRaw.map((raw) => [
        raw.id,
        raw.source === "manual" || raw.status !== "live" || raw.suspended
          ? raw
          : hydrateLiveMatchRow(raw, nowMs),
      ])
    );
    const txQuestionMap = new Map(lockedQuestions.map((q) => [q.id, q]));

    for (const [mid, init] of liveInitial.entries()) {
      const fm = txMatchMap.get(mid);
      if (
        !fm ||
        fm.status === "finished" ||
        fm.suspended ||
        (fm.source === "virtual" && minuteNumber(fm.minute) >= 85) ||
        (fm.source === "manual" && minuteNumber(fm.minute) >= 88)
      ) {
        return {
          kind: "error",
          status: 400,
          error: "Un match en direct a été suspendu ou terminé pendant la validation",
        };
      }
      if (
        (fm.homeScore ?? 0) !== init.homeScore ||
        (fm.awayScore ?? 0) !== init.awayScore ||
        (fm.redHome ?? 0) !== init.redHome ||
        (fm.redAway ?? 0) !== init.redAway
      ) {
        return {
          kind: "error",
          status: 409,
          error: "Action décisive en direct — cotes mises à jour, réessayez",
        };
      }
    }

    const pricedLegs: ComboLeg[] = [];
    const updatedLegs: OddsChangedLegDetail[] = [];
    let anyLegBlockedByPolicy = false;

    for (const leg of rawLegs) {
      const legExpectedOdds = Number(leg.expectedOdds);

      if (leg.kind === "sport") {
        const m = txMatchMap.get(Number(leg.matchId));
        if (!m || m.status === "finished") {
          return {
            kind: "error",
            status: 400,
            error: "L'un des matchs sélectionnés est déjà terminé",
          };
        }
        if (m.suspended) {
          return {
            kind: "error",
            status: 400,
            error: `Cotes suspendues sur ${m.homeTeam} – ${m.awayTeam}`,
          };
        }
        if (m.source === "manual" && isRealMatchKickoffReached(m)) {
          return {
            kind: "error",
            status: 400,
            error: `Coup d'envoi dépassé sur ${m.homeTeam} – ${m.awayTeam}`,
          };
        }

        const market = leg.market ?? "result";
        if (!isKnownMarket(market) && !(m.source === "manual" && m.markets?.length)) {
          return { kind: "error", status: 400, error: "Marché invalide" };
        }

        const h = m.homeScore ?? 0;
        const a = m.awayScore ?? 0;
        const min = minuteNumber(m.minute);
        const formOpts = {
          homeForm: m.homeForm ?? 1,
          awayForm: m.awayForm ?? 1,
          redHome: m.redHome ?? 0,
          redAway: m.redAway ?? 0,
          events: m.events ?? [],
          regime: m.regime ?? null,
          league: m.league ?? null,
          matchId: m.id,
        };

        if (
          m.status === "live" &&
          isKnownMarket(market) &&
          marketOutcomeSettled(market, leg.selection, h, a, min, formOpts)
        ) {
          return {
            kind: "error",
            status: 400,
            error: `Sélection déjà décidée sur ${m.homeTeam} – ${m.awayTeam}`,
          };
        }

        let rawOdds: number | null = null;
        let selectionLabel: string | null = null;

        if (m.source === "manual") {
          const realHit = realMatchOddsFor(m, market, leg.selection);
          if (realHit) {
            rawOdds = realHit.odds;
            selectionLabel = realHit.label;
          }
        } else {
          rawOdds =
            m.status === "live"
              ? liveMarketOddsFor(
                  market,
                  leg.selection,
                  m.homeTeam,
                  m.awayTeam,
                  h,
                  a,
                  min,
                  formOpts
                )
              : marketOddsFor(
                  market,
                  leg.selection,
                  m.homeTeam,
                  m.awayTeam,
                  formOpts
                );
          selectionLabel = marketLabelFor(
            market,
            leg.selection,
            m.homeTeam,
            m.awayTeam
          );
        }

        if (rawOdds == null || selectionLabel == null) {
          return {
            kind: "error",
            status: 400,
            error: `Sélection fermée sur ${m.homeTeam} – ${m.awayTeam}`,
          };
        }

        const serverLegOdds = roundOdds2(rawOdds);
        if (m.status === "live" && serverLegOdds <= 1.04) {
          return {
            kind: "error",
            status: 400,
            error: `Cote verrouillée sur ${m.homeTeam} – ${m.awayTeam}`,
          };
        }

        const legCheck = checkOddsChange({
          expectedOdds: legExpectedOdds,
          serverOdds: serverLegOdds,
          policy: oddsPolicy,
        });
        if (!legCheck.ok) {
          anyLegBlockedByPolicy = true;
          updatedLegs.push({
            kind: "sport",
            matchId: m.id,
            market,
            selection: leg.selection,
            previousOdds: legCheck.roundedExpectedOdds,
            currentOdds: legCheck.roundedServerOdds,
            direction: legCheck.direction,
          });
        } else if (Math.round(serverLegOdds * 100) !== Math.round(legExpectedOdds * 100)) {
          updatedLegs.push({
            kind: "sport",
            matchId: m.id,
            market,
            selection: leg.selection,
            previousOdds: roundOdds2(legExpectedOdds),
            currentOdds: serverLegOdds,
            direction: serverLegOdds >= legExpectedOdds ? "up" : "down",
          });
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
          homeLogo: teamLogo(m.homeTeam, m.homeLogo),
          awayLogo: teamLogo(m.awayTeam, m.awayLogo),
          market,
          selection: leg.selection,
          selectionLabel,
          odds: serverLegOdds,
          status: "pending",
        });
      } else {
        const q = txQuestionMap.get(Number(leg.questionId));
        if (!q || q.status !== "open" || q.resolvesAt.getTime() <= nowMs) {
          return {
            kind: "error",
            status: 400,
            error: "L'une des questions sélectionnées est clôturée",
          };
        }

        let rawOdds: number | null = null;
        let selectionLabel: string | null = null;
        const isMulti = Array.isArray(q.options) && q.options.length >= 2;

        if (isMulti && q.options) {
          const opt = q.options.find((o) => o.key === leg.selection);
          if (opt) {
            rawOdds = opt.odds;
            selectionLabel = opt.label;
          }
        } else if (leg.selection === "yes" || leg.selection === "no") {
          rawOdds = leg.selection === "yes" ? q.oddsYes : q.oddsNo;
          selectionLabel = leg.selection === "yes" ? "Oui" : "Non";
        }

        if (rawOdds == null || selectionLabel == null) {
          return {
            kind: "error",
            status: 400,
            error: `Choix invalide sur « ${q.question} »`,
          };
        }

        const serverLegOdds = roundOdds2(rawOdds);
        const marketKey = isMulti ? "multichoice" : "yesno";

        const legCheck = checkOddsChange({
          expectedOdds: legExpectedOdds,
          serverOdds: serverLegOdds,
          policy: oddsPolicy,
        });
        if (!legCheck.ok) {
          anyLegBlockedByPolicy = true;
          updatedLegs.push({
            kind: "prediction",
            questionId: q.id,
            market: marketKey,
            selection: leg.selection,
            previousOdds: legCheck.roundedExpectedOdds,
            currentOdds: legCheck.roundedServerOdds,
            direction: legCheck.direction,
          });
        } else if (Math.round(serverLegOdds * 100) !== Math.round(legExpectedOdds * 100)) {
          updatedLegs.push({
            kind: "prediction",
            questionId: q.id,
            market: marketKey,
            selection: leg.selection,
            previousOdds: roundOdds2(legExpectedOdds),
            currentOdds: serverLegOdds,
            direction: serverLegOdds >= legExpectedOdds ? "up" : "down",
          });
        }

        pricedLegs.push({
          kind: "prediction",
          matchId: null,
          questionId: q.id,
          sport: "prédiction",
          league: q.category,
          title: q.question,
          market: marketKey,
          selection: leg.selection,
          selectionLabel,
          odds: serverLegOdds,
          status: "pending",
        });
      }
    }

    // Cote totale calculée EXCLUSIVEMENT à partir des cotes serveur verrouillées
    const serverQuote = computeComboQuote(
      pricedLegs.map((l) => l.odds),
      roundedStake
    );

    const totalCheck = checkOddsChange({
      expectedOdds: expectedTotalOdds,
      serverOdds: serverQuote.totalOdds,
      policy: oddsPolicy,
    });

    if (anyLegBlockedByPolicy || !totalCheck.ok) {
      const roundedPrevTotal = roundOdds2(expectedTotalOdds);
      return {
        kind: "odds_changed",
        details: {
          previousOdds: roundedPrevTotal,
          currentOdds: serverQuote.totalOdds,
          direction: serverQuote.totalOdds >= roundedPrevTotal ? "up" : "down",
          updatedLegs,
        },
      };
    }

    const [lockedUser] = await tx
      .select({ id: appUser.id, balance: appUser.balance })
      .from(appUser)
      .where(eq(appUser.id, uid))
      .for("update");

    if (!lockedUser || lockedUser.balance < roundedStake) {
      return { kind: "error", status: 400, error: "Solde insuffisant" };
    }

    const [inserted] = await tx
      .insert(comboBets)
      .values({
        userId: uid,
        legs: pricedLegs,
        baseOdds: serverQuote.baseOdds,
        boostPct: serverQuote.boostPct,
        totalOdds: serverQuote.totalOdds,
        stake: roundedStake,
        potentialWin: serverQuote.potentialWin,
        status: "pending",
      })
      .returning();

    const [updatedUser] = await tx
      .update(appUser)
      .set({ balance: sql`${appUser.balance} - ${roundedStake}` })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    for (const l of pricedLegs) {
      if (l.kind === "prediction" && l.questionId) {
        const share = Math.round((roundedStake / pricedLegs.length) * 100) / 100;
        await tx
          .update(predictionQuestions)
          .set({ volume: sql`${predictionQuestions.volume} + ${share}` })
          .where(eq(predictionQuestions.id, l.questionId));
      }
    }

    return {
      kind: "ok",
      bet: inserted,
      balance: updatedUser.balance,
      hasPredLeg: pricedLegs.some((l) => l.kind === "prediction"),
    };
  });

  if (txResult.kind === "odds_changed") {
    const dirLabel =
      txResult.details.direction === "up" ? "augmenté" : "évolué";
    return NextResponse.json(
      {
        error: `Les cotes du coupon ont ${dirLabel} (${txResult.details.previousOdds.toFixed(2).replace(".", ",")} → ${txResult.details.currentOdds.toFixed(2).replace(".", ",")}). Confirmez pour valider.`,
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

  if (txResult.hasPredLeg) {
    invalidatePredictionsCatalogCache();
  }
  notifyNewBetPlaced({ userId: uid, kind: "combo" });
  invalidateHouseHealthCache();
  return NextResponse.json({ bet: txResult.bet, balance: txResult.balance });
}
