import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hydrateLiveMatchRow } from "@/db/engine";
import { ensureSeeded } from "@/db/seed";
import {
  appUser,
  bets,
  comboBets,
  matches,
  predictionBets,
  predictionQuestions,
} from "@/db/schema";
import { notifyBetsSettledOrMutated } from "@/lib/active-state-cache";
import { computeCashOut, computePredictionCashOut } from "@/lib/cashout";
import { computeComboCashOut } from "@/lib/combo";
import { formatServerErrorResponse } from "@/lib/db-error";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import { verifyLiveRealMatchesBeforeBet } from "@/lib/real-sports-feed";
import { requireUserId } from "@/lib/session";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

/**
 * Encaisse un pari en cours (sportif, prédiction ou combiné).
 *
 * Ordre canonique global des verrous PostgreSQL (strictement acyclique sur toute la plateforme) :
 *   1. `matches` (`ORDER BY id FOR SHARE`)
 *   2. `prediction_questions` (`ORDER BY id FOR SHARE`)
 *   3. `bets` / `prediction_bets` / `combo_bets` (`FOR UPDATE`)
 *   4. `app_user` (`FOR UPDATE`)
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;
    await syncLiveMatchesThrottled();

    let body: { betId?: number; kind?: "sport" | "prediction" | "combo" };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const betId = Number(body.betId);
    const kind = body.kind;
    if (!betId) {
      return NextResponse.json({ error: "Pari introuvable" }, { status: 400 });
    }

    // 1. Pari combiné
    if (kind === "combo") {
      const [cb] = await db
        .select()
        .from(comboBets)
        .where(and(eq(comboBets.id, betId), eq(comboBets.userId, uid)));

      if (!cb || cb.status !== "pending") {
        return NextResponse.json(
          { error: "Ce coupon ne peut plus être vendu" },
          { status: 400 }
        );
      }

      const matchIds = [
        ...new Set(
          (cb.legs ?? [])
            .filter((l) => l.kind === "sport" && l.matchId)
            .map((l) => l.matchId as number)
        ),
      ];
      const questionIds = [
        ...new Set(
          (cb.legs ?? [])
            .filter((l) => l.kind === "prediction" && l.questionId)
            .map((l) => l.questionId as number)
        ),
      ];

      // Contrôle externe anti-but (hors transaction SQL pour garder la transaction ultra-courte)
      if (matchIds.length > 0) {
        const preMatches = await db
          .select()
          .from(matches)
          .where(inArray(matches.id, matchIds));
        const liveRealComboRows = preMatches.filter(
          (m) => m.status === "live" && m.source === "manual"
        );
        if (liveRealComboRows.length > 0) {
          const realGuard = await verifyLiveRealMatchesBeforeBet(liveRealComboRows);
          if (!realGuard.ok) {
            return NextResponse.json({ error: realGuard.error }, { status: 409 });
          }
        }
      }

      const txRes = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);

        const lockedMatches =
          matchIds.length > 0
            ? await tx
                .select()
                .from(matches)
                .where(inArray(matches.id, matchIds))
                .orderBy(asc(matches.id))
                .for("share")
            : [];

        const lockedQuestions =
          questionIds.length > 0
            ? await tx
                .select()
                .from(predictionQuestions)
                .where(inArray(predictionQuestions.id, questionIds))
                .orderBy(asc(predictionQuestions.id))
                .for("share")
            : [];

        const [lockedCb] = await tx
          .select()
          .from(comboBets)
          .where(and(eq(comboBets.id, cb.id), eq(comboBets.userId, uid)))
          .for("update");

        if (!lockedCb || lockedCb.status !== "pending") {
          return { kind: "settled" as const };
        }

        const nowCashMs = Date.now();
        const effectiveMatchMap = new Map(
          lockedMatches.map((m) => [m.id, hydrateLiveMatchRow(m, nowCashMs)])
        );
        const value = computeComboCashOut(
          lockedCb,
          effectiveMatchMap,
          new Map(lockedQuestions.map((q) => [q.id, q]))
        );
        if (value == null) {
          return { kind: "unavailable" as const };
        }

        await tx
          .select({ id: appUser.id })
          .from(appUser)
          .where(eq(appUser.id, uid))
          .for("update");

        await tx
          .update(comboBets)
          .set({ status: "cashed", cashOutAmount: value, settledAt: new Date() })
          .where(eq(comboBets.id, lockedCb.id));

        const [updatedUser] = await tx
          .update(appUser)
          .set({ balance: sql`${appUser.balance} + ${value}` })
          .where(eq(appUser.id, uid))
          .returning({ balance: appUser.balance });

        return { kind: "ok" as const, balance: updatedUser.balance, value };
      });

      if (txRes.kind === "settled") {
        return NextResponse.json(
          { error: "Ce combiné vient d'être réglé" },
          { status: 400 }
        );
      }
      if (txRes.kind === "unavailable") {
        return NextResponse.json(
          { error: "La vente du coupon est momentanément indisponible sur ce combiné" },
          { status: 400 }
        );
      }

      notifyBetsSettledOrMutated([uid]);
      invalidateHouseHealthCache();
      return NextResponse.json({ balance: txRes.balance, value: txRes.value });
    }

    // 2. Pari sportif simple
    if (!kind || kind === "sport") {
      const [sportRow] = await db
        .select({ bet: bets, match: matches })
        .from(bets)
        .leftJoin(matches, eq(bets.matchId, matches.id))
        .where(and(eq(bets.id, betId), eq(bets.userId, uid)));

      if (sportRow && sportRow.bet) {
        const { bet, match } = sportRow;
        if (bet.status !== "pending") {
          if (kind === "sport") {
            return NextResponse.json(
              { error: "Ce coupon ne peut plus être vendu" },
              { status: 400 }
            );
          }
        } else {
          if (!match || !bet.matchId) {
            return NextResponse.json(
              { error: "Match introuvable pour ce coupon" },
              { status: 400 }
            );
          }
          if (match.status === "live" && match.source === "manual") {
            const realGuard = await verifyLiveRealMatchesBeforeBet([match]);
            if (!realGuard.ok) {
              return NextResponse.json({ error: realGuard.error }, { status: 409 });
            }
          }

          const targetMatchId = bet.matchId;
          const txRes = await db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);

            const [lockedRawMatch] = await tx
              .select()
              .from(matches)
              .where(eq(matches.id, targetMatchId))
              .for("share");

            const [lockedBet] = await tx
              .select()
              .from(bets)
              .where(and(eq(bets.id, bet.id), eq(bets.userId, uid)))
              .for("update");

            if (!lockedBet || lockedBet.status !== "pending") {
              return { kind: "settled" as const };
            }

            const effectiveMatch = lockedRawMatch
              ? hydrateLiveMatchRow(lockedRawMatch, Date.now())
              : null;
            if (!effectiveMatch || effectiveMatch.status !== "live") {
              return {
                kind: "error" as const,
                error: "La vente du coupon n'est disponible que pendant le match",
              };
            }
            if (effectiveMatch.suspended) {
              return {
                kind: "error" as const,
                error: "Marché suspendu — vente du coupon indisponible",
              };
            }

            const value = computeCashOut({
              stake: lockedBet.stake,
              odds: lockedBet.odds,
              sport: lockedBet.sport,
              minute: effectiveMatch.minute,
              market: lockedBet.market,
              selection: lockedBet.selection,
              homeTeam: effectiveMatch.homeTeam,
              awayTeam: effectiveMatch.awayTeam,
              homeScore: effectiveMatch.homeScore,
              awayScore: effectiveMatch.awayScore,
              htHomeScore:
                effectiveMatch.htHomeScore ??
                effectiveMatch.realStats?.htHomeScore ??
                null,
              htAwayScore:
                effectiveMatch.htAwayScore ??
                effectiveMatch.realStats?.htAwayScore ??
                null,
              redHome: effectiveMatch.redHome,
              redAway: effectiveMatch.redAway,
              homeForm: effectiveMatch.homeForm,
              awayForm: effectiveMatch.awayForm,
              events: effectiveMatch.events ?? null,
              matchId: effectiveMatch.id,
              source: effectiveMatch.source ?? "virtual",
              externalId: effectiveMatch.externalId ?? null,
              autoSync: effectiveMatch.autoSync ?? true,
              oddsHome: effectiveMatch.oddsHome,
              oddsDraw: effectiveMatch.oddsDraw,
              oddsAway: effectiveMatch.oddsAway,
              markets: effectiveMatch.markets ?? null,
            });
            if (value == null) {
              return {
                kind: "error" as const,
                error:
                  "La vente du coupon n'est plus disponible sur ce pari actuellement",
              };
            }

            await tx
              .select({ id: appUser.id })
              .from(appUser)
              .where(eq(appUser.id, uid))
              .for("update");

            await tx
              .update(bets)
              .set({
                status: "cashed",
                cashOutAmount: value,
                settledAt: new Date(),
              })
              .where(eq(bets.id, lockedBet.id));

            const [updatedUser] = await tx
              .update(appUser)
              .set({ balance: sql`${appUser.balance} + ${value}` })
              .where(eq(appUser.id, uid))
              .returning({ balance: appUser.balance });

            return { kind: "ok" as const, balance: updatedUser.balance, value };
          });

          if (txRes.kind === "settled") {
            return NextResponse.json(
              { error: "Ce pari vient d'être réglé" },
              { status: 400 }
            );
          }
          if (txRes.kind === "error") {
            return NextResponse.json({ error: txRes.error }, { status: 400 });
          }

          notifyBetsSettledOrMutated([uid]);
          invalidateHouseHealthCache();
          return NextResponse.json({
            balance: txRes.balance,
            value: txRes.value,
          });
        }
      } else if (kind === "sport") {
        return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
      }
    }

    // 3. Pari de prédiction
    const [predRow] = await db
      .select({ bet: predictionBets })
      .from(predictionBets)
      .where(and(eq(predictionBets.id, betId), eq(predictionBets.userId, uid)));

    if (predRow && predRow.bet) {
      const { bet } = predRow;
      if (bet.status !== "pending") {
        return NextResponse.json(
          { error: "Ce coupon ne peut plus être vendu" },
          { status: 400 }
        );
      }

      const txRes = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);

        const [lockedQuestion] = await tx
          .select()
          .from(predictionQuestions)
          .where(eq(predictionQuestions.id, bet.questionId))
          .for("share");

        const [lockedBet] = await tx
          .select()
          .from(predictionBets)
          .where(and(eq(predictionBets.id, bet.id), eq(predictionBets.userId, uid)))
          .for("update");

        if (!lockedBet || lockedBet.status !== "pending") {
          return { kind: "settled" as const };
        }
        if (
          !lockedQuestion ||
          lockedQuestion.status !== "open" ||
          lockedQuestion.resolvesAt.getTime() <= Date.now()
        ) {
          return {
            kind: "error" as const,
            error:
              "La vente du coupon n'est disponible que sur les prédictions ouvertes",
          };
        }

        const value = computePredictionCashOut({
          stake: lockedBet.stake,
          odds: lockedBet.odds,
          potentialWin: lockedBet.potentialWin,
          placedAt: lockedBet.placedAt,
          resolvesAt: lockedQuestion.resolvesAt,
          currentOddsYes: lockedQuestion.oddsYes,
          currentOddsNo: lockedQuestion.oddsNo,
          options: lockedQuestion.options ?? null,
          selection: lockedBet.selection,
        });

        await tx
          .select({ id: appUser.id })
          .from(appUser)
          .where(eq(appUser.id, uid))
          .for("update");

        await tx
          .update(predictionBets)
          .set({
            status: "cashed",
            cashOutAmount: value,
            settledAt: new Date(),
          })
          .where(eq(predictionBets.id, lockedBet.id));

        const [updatedUser] = await tx
          .update(appUser)
          .set({ balance: sql`${appUser.balance} + ${value}` })
          .where(eq(appUser.id, uid))
          .returning({ balance: appUser.balance });

        return { kind: "ok" as const, balance: updatedUser.balance, value };
      });

      if (txRes.kind === "settled") {
        return NextResponse.json(
          { error: "Ce pari vient d'être réglé" },
          { status: 400 }
        );
      }
      if (txRes.kind === "error") {
        return NextResponse.json({ error: txRes.error }, { status: 400 });
      }

      notifyBetsSettledOrMutated([uid]);
      invalidateHouseHealthCache();
      return NextResponse.json({ balance: txRes.balance, value: txRes.value });
    }

    return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/bets/cashout");
  }
}
