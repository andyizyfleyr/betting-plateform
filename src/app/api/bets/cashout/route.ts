import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  checkpointVirtualMatchesForBet,
  hydrateLiveMatchRow,
  runLiveEngine,
} from "@/db/engine";
import { ensureSeeded } from "@/db/seed";
import {
  appUser,
  bets,
  comboBets,
  matches,
  predictionBets,
  predictionQuestions,
  type MatchRow,
} from "@/db/schema";
import { notifyBetsSettledOrMutated } from "@/lib/active-state-cache";
import {
  checkLiveMatchCashOutGuard,
  computeCashOut,
  computePredictionCashOut,
  type LiveIncidentSnapshot,
} from "@/lib/cashout";
import { computeComboCashOut } from "@/lib/combo";
import { formatServerErrorResponse } from "@/lib/db-error";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import {
  computeIdempotencyHash,
  idempotencyConflictResponse,
  lookupIdempotencyRecord,
  saveIdempotencyRecord,
} from "@/lib/idempotency";
import {
  CASHOUT_CHANGED_CODE,
  checkCashoutChange,
  extractIdempotencyKey,
  type CashoutChangedDetails,
} from "@/lib/odds-lock";
import { verifyLiveRealMatchesBeforeBet } from "@/lib/real-sports-feed";
import { requireUserId } from "@/lib/session";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

/** Fenêtre de validation live identique à la prise de pari (`POST /api/bets` & `POST /api/bets/combo`). */
const LIVE_VALIDATION_MS = 300;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cashoutChangedResponse(details: CashoutChangedDetails): NextResponse {
  return NextResponse.json(
    {
      error: `Le montant du Cash Out a baissé (${details.previousCashout.toFixed(2).replace(".", ",")} € → ${details.currentCashout.toFixed(2).replace(".", ",")} €). Confirmez le nouveau montant pour vendre le coupon.`,
      code: CASHOUT_CHANGED_CODE,
      details,
    },
    { status: 409 }
  );
}

/**
 * Applique exactement le même protocole anti-but & anti-carton rouge hors transaction
 * que `POST /api/bets` et `POST /api/bets/combo` avant d'ouvrir la transaction PostgreSQL :
 *  1. Checkpoint mémoire -> SQL des matchs virtuels ciblés ;
 *  2. Vérification immédiate `suspended`, `isRealMatchPostIncidentSuspended` (but/rouge < 18 s),
 *     `isRealMatchFeedStale` et verrou de fin de match (`85'` virtuel / `88'` réel) ;
 *  3. Empreinte `{ homeScore, awayScore, redHome, redAway }` de chaque match live ;
 *  4. Délai d'acceptation live (`verifyLiveRealMatchesBeforeBet` 3 s sur réel,
 *     `LIVE_VALIDATION_MS` 300 ms + `runLiveEngine` + `checkpointVirtualMatchesForBet` sur virtuel)
 *     puis comparaison score + cartons rouges.
 */
async function verifyLiveMatchesBeforeCashOut(
  rawMatchRows: MatchRow[]
): Promise<
  | { ok: true; liveSnapshots: Map<number, LiveIncidentSnapshot> }
  | { ok: false; status: 400 | 409; error: string }
> {
  if (rawMatchRows.length === 0) {
    return { ok: true, liveSnapshots: new Map() };
  }

  const checkpointedMap = await checkpointVirtualMatchesForBet(rawMatchRows);
  const syncedRows = [...checkpointedMap.values()];
  const now0 = Date.now();

  const liveSnapshots = new Map<number, LiveIncidentSnapshot>();
  const liveRealRows: MatchRow[] = [];
  const liveVirtualIds: number[] = [];

  for (const raw of syncedRows) {
    const m = hydrateLiveMatchRow(raw, now0);
    if (m.status !== "live") continue;

    const guard0 = checkLiveMatchCashOutGuard(m, now0);
    if (!guard0.ok) return guard0;

    liveSnapshots.set(m.id, {
      homeScore: m.homeScore ?? 0,
      awayScore: m.awayScore ?? 0,
      redHome: m.redHome ?? 0,
      redAway: m.redAway ?? 0,
    });

    if (m.source === "manual") {
      liveRealRows.push(m);
    } else {
      liveVirtualIds.push(m.id);
    }
  }

  if (liveSnapshots.size === 0) {
    return { ok: true, liveSnapshots };
  }

  if (liveRealRows.length > 0) {
    const realGuard = await verifyLiveRealMatchesBeforeBet(liveRealRows);
    if (!realGuard.ok) {
      return { ok: false, status: 409, error: realGuard.error };
    }
    const nowReal = Date.now();
    for (const [mid, refreshed] of realGuard.refreshedMap.entries()) {
      const snap = liveSnapshots.get(mid);
      if (!snap) continue;
      const postGuard = checkLiveMatchCashOutGuard(refreshed, nowReal, snap);
      if (!postGuard.ok) return postGuard;
    }
  }

  if (liveVirtualIds.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, LIVE_VALIDATION_MS));
    await runLiveEngine();
    const freshVirtualRows = await db
      .select()
      .from(matches)
      .where(inArray(matches.id, liveVirtualIds));
    const freshMap = await checkpointVirtualMatchesForBet(freshVirtualRows);
    const nowVirt = Date.now();
    for (const mid of liveVirtualIds) {
      const freshRow = freshMap.get(mid);
      if (!freshRow) {
        return { ok: false, status: 400, error: "Match introuvable" };
      }
      const hydrated = hydrateLiveMatchRow(freshRow, nowVirt);
      const snap = liveSnapshots.get(mid);
      const postGuard = checkLiveMatchCashOutGuard(hydrated, nowVirt, snap);
      if (!postGuard.ok) return postGuard;
    }
  }

  return { ok: true, liveSnapshots };
}

/**
 * Encaisse un pari en cours (sportif, prédiction ou combiné) avec :
 *  - Suspension anti-but & anti-carton rouge strictement identique aux paris (hors tx + sous verrou `FOR SHARE`)
 *  - Verrou transactionnel sur `expectedCashout` (`409 CASHOUT_CHANGED` sans paiement si baisse)
 *  - Idempotence complète + refus `409 IDEMPOTENCY_KEY_CONFLICT` si la clé est réutilisée avec un autre contenu
 *  - Ordre canonique global acyclique des verrous PostgreSQL :
 *      1. `matches` (`ORDER BY id FOR SHARE`)
 *      2. `prediction_questions` (`ORDER BY id FOR SHARE`)
 *      3. `bets` / `prediction_bets` / `combo_bets` (`FOR UPDATE`)
 *      4. `app_user` (`FOR UPDATE`)
 *      5. `idempotency_keys`
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;
    await syncLiveMatchesThrottled();

    let body: {
      betId?: number;
      kind?: "sport" | "prediction" | "combo";
      expectedCashout?: number;
      idempotencyKey?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const betId = Number(body.betId);
    const kind = body.kind;
    const expectedCashout = Number(body.expectedCashout);
    const idempotencyKey = extractIdempotencyKey(
      body.idempotencyKey,
      req.headers.get("idempotency-key")
    );

    if (!Number.isInteger(betId) || betId <= 0) {
      return NextResponse.json({ error: "Pari introuvable" }, { status: 400 });
    }
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Clé d'idempotence manquante ou invalide" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(expectedCashout) || expectedCashout <= 0) {
      return NextResponse.json(
        { error: "Montant de Cash Out attendu manquant ou invalide" },
        { status: 400 }
      );
    }

    const requestHash = computeIdempotencyHash({
      betId,
      kind: kind ?? "sport_or_prediction",
      expectedCashout: round2(expectedCashout),
    });

    // Court-circuit O(1) hors transaction (réessai réseau ou conflit d'idempotence)
    const preIdem = await lookupIdempotencyRecord(
      db,
      uid,
      "cashout",
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

    type CashoutTxResult =
      | { kind: "ok"; balance: number; value: number; deduplicated?: boolean }
      | { kind: "idempotency_conflict" }
      | { kind: "cashout_changed"; details: CashoutChangedDetails }
      | { kind: "live_incident"; error: string }
      | { kind: "settled" }
      | { kind: "error"; error: string };

    // 1. Pari combiné
    if (kind === "combo") {
      const [cb] = await db
        .select()
        .from(comboBets)
        .where(and(eq(comboBets.id, betId), eq(comboBets.userId, uid)));

      if (!cb) {
        return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
      }
      if (cb.status !== "pending" && cb.cashoutIdempotencyKey !== idempotencyKey) {
        return NextResponse.json(
          { error: "Ce coupon ne peut plus être vendu" },
          { status: 400 }
        );
      }

      const pendingSportMatchIds = [
        ...new Set(
          (cb.legs ?? [])
            .filter((l) => l.kind === "sport" && l.status === "pending" && l.matchId)
            .map((l) => l.matchId as number)
        ),
      ];
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

      let liveSnapshots = new Map<number, LiveIncidentSnapshot>();
      if (cb.status === "pending" && pendingSportMatchIds.length > 0) {
        const preMatches = await db
          .select()
          .from(matches)
          .where(inArray(matches.id, pendingSportMatchIds));
        const liveGuard = await verifyLiveMatchesBeforeCashOut(preMatches);
        if (!liveGuard.ok) {
          return NextResponse.json(
            { error: liveGuard.error },
            { status: liveGuard.status }
          );
        }
        liveSnapshots = liveGuard.liveSnapshots;
      }

      const pendingMatchIdSet = new Set(pendingSportMatchIds);

      const txRes: CashoutTxResult = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5000ms'`);

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

        const [lockedUser] = await tx
          .select({ id: appUser.id, balance: appUser.balance })
          .from(appUser)
          .where(eq(appUser.id, uid))
          .for("update");

        if (!lockedUser) {
          return { kind: "error", error: "Compte introuvable" };
        }

        const inTxIdem = await lookupIdempotencyRecord(
          tx,
          uid,
          "cashout",
          idempotencyKey,
          requestHash
        );
        if (inTxIdem.kind === "conflict") {
          return { kind: "idempotency_conflict" };
        }
        if (inTxIdem.kind === "hit") {
          return {
            kind: "ok",
            balance: lockedUser.balance,
            value: Number(inTxIdem.responseBody.value ?? lockedCb?.cashOutAmount ?? 0),
            deduplicated: true,
          };
        }

        if (!lockedCb || lockedCb.status !== "pending") {
          return { kind: "settled" };
        }

        const nowCashMs = Date.now();
        const effectiveMatchMap = new Map(
          lockedMatches.map((m) => [m.id, hydrateLiveMatchRow(m, nowCashMs)])
        );

        // Vérification anti-but & anti-carton rouge sous verrou `FOR SHARE` sur chaque sélection en cours
        for (const mid of pendingMatchIdSet) {
          const eff = effectiveMatchMap.get(mid);
          if (!eff) continue;
          const inTxGuard = checkLiveMatchCashOutGuard(
            eff,
            nowCashMs,
            liveSnapshots.get(mid)
          );
          if (!inTxGuard.ok) {
            return inTxGuard.status === 409
              ? { kind: "live_incident", error: inTxGuard.error }
              : { kind: "error", error: inTxGuard.error };
          }
        }

        const value = computeComboCashOut(
          lockedCb,
          effectiveMatchMap,
          new Map(lockedQuestions.map((q) => [q.id, q]))
        );
        if (value == null) {
          return {
            kind: "error",
            error: "La vente du coupon est momentanément indisponible sur ce combiné",
          };
        }

        // Comparaison transactionnelle AVANT toute écriture / paiement
        const cashoutCheck = checkCashoutChange({
          expectedCashout,
          serverCashout: value,
        });
        if (!cashoutCheck.ok) {
          return {
            kind: "cashout_changed",
            details: {
              previousCashout: cashoutCheck.previousCashout,
              currentCashout: cashoutCheck.currentCashout,
            },
          };
        }

        const finalValue = cashoutCheck.roundedServerCashout;

        await tx
          .update(comboBets)
          .set({
            status: "cashed",
            cashOutAmount: finalValue,
            cashoutIdempotencyKey: idempotencyKey,
            settledAt: new Date(),
          })
          .where(eq(comboBets.id, lockedCb.id));

        const [updatedUser] = await tx
          .update(appUser)
          .set({
            balance: sql`ROUND((${appUser.balance} + ${finalValue})::numeric, 2)::float8`,
          })
          .where(eq(appUser.id, uid))
          .returning({ balance: appUser.balance });

        await saveIdempotencyRecord(tx, {
          userId: uid,
          scope: "cashout",
          idempotencyKey,
          requestHash,
          statusCode: 200,
          responseBody: { balance: updatedUser.balance, value: finalValue },
        });

        return { kind: "ok", balance: updatedUser.balance, value: finalValue };
      });

      if (txRes.kind === "idempotency_conflict") return idempotencyConflictResponse();
      if (txRes.kind === "cashout_changed") return cashoutChangedResponse(txRes.details);
      if (txRes.kind === "live_incident") {
        return NextResponse.json({ error: txRes.error }, { status: 409 });
      }
      if (txRes.kind === "settled") {
        return NextResponse.json(
          { error: "Ce combiné vient d'être réglé" },
          { status: 400 }
        );
      }
      if (txRes.kind === "error") {
        return NextResponse.json({ error: txRes.error }, { status: 400 });
      }

      if (!txRes.deduplicated) {
        notifyBetsSettledOrMutated([uid]);
        invalidateHouseHealthCache();
      }
      return NextResponse.json({
        balance: txRes.balance,
        value: txRes.value,
        ...(txRes.deduplicated ? { deduplicated: true } : {}),
      });
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
        if (bet.status !== "pending" && bet.cashoutIdempotencyKey !== idempotencyKey) {
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

          let singleLiveSnapshots = new Map<number, LiveIncidentSnapshot>();
          if (bet.status === "pending") {
            if (match.status !== "live") {
              return NextResponse.json(
                { error: "La vente du coupon n'est disponible que pendant le match" },
                { status: 400 }
              );
            }
            const liveGuard = await verifyLiveMatchesBeforeCashOut([match]);
            if (!liveGuard.ok) {
              return NextResponse.json(
                { error: liveGuard.error },
                { status: liveGuard.status }
              );
            }
            singleLiveSnapshots = liveGuard.liveSnapshots;
          }

          const targetMatchId = bet.matchId;
          const txRes: CashoutTxResult = await db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL lock_timeout = '5000ms'`);

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

            const [lockedUser] = await tx
              .select({ id: appUser.id, balance: appUser.balance })
              .from(appUser)
              .where(eq(appUser.id, uid))
              .for("update");

            if (!lockedUser) {
              return { kind: "error", error: "Compte introuvable" };
            }

            const inTxIdem = await lookupIdempotencyRecord(
              tx,
              uid,
              "cashout",
              idempotencyKey,
              requestHash
            );
            if (inTxIdem.kind === "conflict") {
              return { kind: "idempotency_conflict" };
            }
            if (inTxIdem.kind === "hit") {
              return {
                kind: "ok",
                balance: lockedUser.balance,
                value: Number(inTxIdem.responseBody.value ?? lockedBet?.cashOutAmount ?? 0),
                deduplicated: true,
              };
            }

            if (!lockedBet || lockedBet.status !== "pending") {
              return { kind: "settled" };
            }

            const nowCashMs = Date.now();
            const effectiveMatch = lockedRawMatch
              ? hydrateLiveMatchRow(lockedRawMatch, nowCashMs)
              : null;
            if (!effectiveMatch || effectiveMatch.status !== "live") {
              return {
                kind: "error",
                error: "La vente du coupon n'est disponible que pendant le match",
              };
            }

            const inTxGuard = checkLiveMatchCashOutGuard(
              effectiveMatch,
              nowCashMs,
              singleLiveSnapshots.get(effectiveMatch.id)
            );
            if (!inTxGuard.ok) {
              return inTxGuard.status === 409
                ? { kind: "live_incident", error: inTxGuard.error }
                : { kind: "error", error: inTxGuard.error };
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
                effectiveMatch.realStats?.htAwayScore !== undefined
                  ? (effectiveMatch.htHomeScore ??
                    effectiveMatch.realStats?.htHomeScore ??
                    null)
                  : null,
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
              realStats: effectiveMatch.realStats ?? null,
              markets: effectiveMatch.markets ?? null,
            });
            if (value == null) {
              return {
                kind: "error",
                error:
                  "La vente du coupon n'est plus disponible sur ce pari actuellement",
              };
            }

            const cashoutCheck = checkCashoutChange({
              expectedCashout,
              serverCashout: value,
            });
            if (!cashoutCheck.ok) {
              return {
                kind: "cashout_changed",
                details: {
                  previousCashout: cashoutCheck.previousCashout,
                  currentCashout: cashoutCheck.currentCashout,
                },
              };
            }

            const finalValue = cashoutCheck.roundedServerCashout;

            await tx
              .update(bets)
              .set({
                status: "cashed",
                cashOutAmount: finalValue,
                cashoutIdempotencyKey: idempotencyKey,
                settledAt: new Date(),
              })
              .where(eq(bets.id, lockedBet.id));

            const [updatedUser] = await tx
              .update(appUser)
              .set({
                balance: sql`ROUND((${appUser.balance} + ${finalValue})::numeric, 2)::float8`,
              })
              .where(eq(appUser.id, uid))
              .returning({ balance: appUser.balance });

            await saveIdempotencyRecord(tx, {
              userId: uid,
              scope: "cashout",
              idempotencyKey,
              requestHash,
              statusCode: 200,
              responseBody: { balance: updatedUser.balance, value: finalValue },
            });

            return { kind: "ok", balance: updatedUser.balance, value: finalValue };
          });

          if (txRes.kind === "idempotency_conflict") return idempotencyConflictResponse();
          if (txRes.kind === "cashout_changed") return cashoutChangedResponse(txRes.details);
          if (txRes.kind === "live_incident") {
            return NextResponse.json({ error: txRes.error }, { status: 409 });
          }
          if (txRes.kind === "settled") {
            return NextResponse.json(
              { error: "Ce pari vient d'être réglé" },
              { status: 400 }
            );
          }
          if (txRes.kind === "error") {
            return NextResponse.json({ error: txRes.error }, { status: 400 });
          }

          if (!txRes.deduplicated) {
            notifyBetsSettledOrMutated([uid]);
            invalidateHouseHealthCache();
          }
          return NextResponse.json({
            balance: txRes.balance,
            value: txRes.value,
            ...(txRes.deduplicated ? { deduplicated: true } : {}),
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
      if (bet.status !== "pending" && bet.cashoutIdempotencyKey !== idempotencyKey) {
        return NextResponse.json(
          { error: "Ce coupon ne peut plus être vendu" },
          { status: 400 }
        );
      }

      const txRes: CashoutTxResult = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5000ms'`);

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

        const [lockedUser] = await tx
          .select({ id: appUser.id, balance: appUser.balance })
          .from(appUser)
          .where(eq(appUser.id, uid))
          .for("update");

        if (!lockedUser) {
          return { kind: "error", error: "Compte introuvable" };
        }

        const inTxIdem = await lookupIdempotencyRecord(
          tx,
          uid,
          "cashout",
          idempotencyKey,
          requestHash
        );
        if (inTxIdem.kind === "conflict") {
          return { kind: "idempotency_conflict" };
        }
        if (inTxIdem.kind === "hit") {
          return {
            kind: "ok",
            balance: lockedUser.balance,
            value: Number(inTxIdem.responseBody.value ?? lockedBet?.cashOutAmount ?? 0),
            deduplicated: true,
          };
        }

        if (!lockedBet || lockedBet.status !== "pending") {
          return { kind: "settled" };
        }
        if (
          !lockedQuestion ||
          lockedQuestion.status !== "open" ||
          lockedQuestion.resolvesAt.getTime() <= Date.now()
        ) {
          return {
            kind: "error",
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

        const cashoutCheck = checkCashoutChange({
          expectedCashout,
          serverCashout: value,
        });
        if (!cashoutCheck.ok) {
          return {
            kind: "cashout_changed",
            details: {
              previousCashout: cashoutCheck.previousCashout,
              currentCashout: cashoutCheck.currentCashout,
            },
          };
        }

        const finalValue = cashoutCheck.roundedServerCashout;

        await tx
          .update(predictionBets)
          .set({
            status: "cashed",
            cashOutAmount: finalValue,
            cashoutIdempotencyKey: idempotencyKey,
            settledAt: new Date(),
          })
          .where(eq(predictionBets.id, lockedBet.id));

        const [updatedUser] = await tx
          .update(appUser)
          .set({
            balance: sql`ROUND((${appUser.balance} + ${finalValue})::numeric, 2)::float8`,
          })
          .where(eq(appUser.id, uid))
          .returning({ balance: appUser.balance });

        await saveIdempotencyRecord(tx, {
          userId: uid,
          scope: "cashout",
          idempotencyKey,
          requestHash,
          statusCode: 200,
          responseBody: { balance: updatedUser.balance, value: finalValue },
        });

        return { kind: "ok", balance: updatedUser.balance, value: finalValue };
      });

      if (txRes.kind === "idempotency_conflict") return idempotencyConflictResponse();
      if (txRes.kind === "cashout_changed") return cashoutChangedResponse(txRes.details);
      if (txRes.kind === "settled") {
        return NextResponse.json(
          { error: "Ce pari vient d'être réglé" },
          { status: 400 }
        );
      }
      if (txRes.kind === "error") {
        return NextResponse.json({ error: txRes.error }, { status: 400 });
      }

      if (!txRes.deduplicated) {
        notifyBetsSettledOrMutated([uid]);
        invalidateHouseHealthCache();
      }
      return NextResponse.json({
        balance: txRes.balance,
        value: txRes.value,
        ...(txRes.deduplicated ? { deduplicated: true } : {}),
      });
    }

    return NextResponse.json({ error: "Pari introuvable" }, { status: 404 });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/bets/cashout");
  }
}
