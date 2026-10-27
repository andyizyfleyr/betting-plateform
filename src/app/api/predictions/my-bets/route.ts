import { asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { predictionBets } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import {
  getCachedUserBetsResponse,
  setCachedUserBetsResponse,
} from "@/lib/active-state-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { jsonWithEtag } from "@/lib/response-cache";
import { requireUserId } from "@/lib/session";
import { recordVisitorActivity } from "@/lib/visitor-activity";

export const dynamic = "force-dynamic";

/**
 * GET /api/predictions/my-bets — Micro-calque strictement PRIVÉ (~100 octets) :
 * - Authentifié par JWT (`requireUserId`), jamais stocké au CDN (`CDN-Cache-Control: private, no-store`, `Vary: Cookie`).
 * - Renvoie uniquement les mises du joueur connecté par `questionId` pour enrichir
 *   localement le catalogue public partagé (`/api/predictions/catalog`).
 */
export async function GET(req: NextRequest) {
  try {
    recordVisitorActivity();
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    const cached = getCachedUserBetsResponse(uid, "pred_overlay");
    if (cached) {
      return jsonWithEtag(req, null, cached);
    }

    const rows = await db
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
      .orderBy(asc(predictionBets.id));

    const myBets: Record<
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

    for (const r of rows) {
      myBets[r.questionId] = r;
    }

    const entry = setCachedUserBetsResponse(uid, "pred_overlay", { myBets });
    return jsonWithEtag(req, null, entry);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/predictions/my-bets");
  }
}
