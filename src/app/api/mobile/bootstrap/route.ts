import { asc, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { appUser, predictionBets } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { publicUser } from "@/lib/auth";
import { formatServerErrorResponse } from "@/lib/db-error";
import { paymentProviders } from "@/lib/payments";
import { isManualRefreshRequest, jsonWithEtag } from "@/lib/response-cache";
import { requireUserId } from "@/lib/session";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { recordVisitorActivity } from "@/lib/visitor-activity";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/bootstrap — Agrégateur de démarrage à froid pour l'application Android Expo :
 * Réunit en 1 seul aller-retour HTTPS (`ETag` + `304 Not Modified`) :
 * - le profil complet du joueur (`user`)
 * - le compteur de paris en cours (`pendingCount`)
 * - le calque des prédictions déjà jouées (`myPredictionBets`)
 * - les prestataires de paiement actifs (`providers`)
 */
export async function GET(req: NextRequest) {
  try {
    recordVisitorActivity();
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    const manualRefresh = isManualRefreshRequest(req);
    await syncLiveMatchesThrottled(false, { manualRefresh });

    const [[user], pendingRes, predRows] = await Promise.all([
      db.select().from(appUser).where(eq(appUser.id, uid)).limit(1),
      db.execute(sql`
        SELECT (
          (SELECT COUNT(*)::int FROM "bets" WHERE "user_id" = ${uid} AND "status" = 'pending') +
          (SELECT COUNT(*)::int FROM "prediction_bets" WHERE "user_id" = ${uid} AND "status" = 'pending') +
          (SELECT COUNT(*)::int FROM "combo_bets" WHERE "user_id" = ${uid} AND "status" = 'pending')
        )::int AS "pendingCount"
      `),
      db
        .select({
          questionId: predictionBets.questionId,
          selection: predictionBets.selection,
          selectionLabel: predictionBets.selectionLabel,
          status: predictionBets.status,
          stake: predictionBets.stake,
          potentialWin: predictionBets.potentialWin,
          odds: predictionBets.odds,
          cashOutAmount: predictionBets.cashOutAmount,
        })
        .from(predictionBets)
        .where(eq(predictionBets.userId, uid))
        .orderBy(asc(predictionBets.id)),
    ]);

    if (!user) {
      return jsonWithEtag(req, { user: null });
    }

    const pendingRow = (pendingRes.rows?.[0] ?? { pendingCount: 0 }) as {
      pendingCount?: number;
    };

    const myPredictionBets: Record<
      number,
      {
        questionId: number;
        selection: string;
        selectionLabel: string;
        status: string;
        stake: number;
        potentialWin: number;
        odds: number;
        cashOutAmount: number | null;
      }
    > = {};

    for (const r of predRows) {
      myPredictionBets[r.questionId] = r;
    }

    return jsonWithEtag(req, {
      user: publicUser(user),
      pendingCount: Number(pendingRow.pendingCount ?? 0),
      myPredictionBets,
      providers: paymentProviders(),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/mobile/bootstrap");
  }
}
