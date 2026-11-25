import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bets, comboBets, predictionBets } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import { invalidateUserCaches } from "@/lib/active-state-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Supprime un pari terminé.
 * Seul le propriétaire peut supprimer, et uniquement un pari qui n'est plus
 * « en jeu » (pending). Les paris combinés et de prédiction sont gérés
 * dans leurs tables dédiées.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const uid = auth;

  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: "Identifiant de pari invalide", code: "INVALID_ID" },
      { status: 400 }
    );
  }

  const [sportBet] = await db
    .select({ id: bets.id, status: bets.status })
    .from(bets)
    .where(and(eq(bets.id, id), eq(bets.userId, uid)))
    .limit(1);

  const [comboBet] = await db
    .select({ id: comboBets.id, status: comboBets.status })
    .from(comboBets)
    .where(and(eq(comboBets.id, id), eq(comboBets.userId, uid)))
    .limit(1);

  const [predBet] = await db
    .select({ id: predictionBets.id, status: predictionBets.status })
    .from(predictionBets)
    .where(and(eq(predictionBets.id, id), eq(predictionBets.userId, uid)))
    .limit(1);

  const row = sportBet ?? comboBet ?? predBet;
  if (!row) {
    return NextResponse.json(
      { error: "Pari introuvable", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  if (row.status === "pending") {
    return NextResponse.json(
      { error: "Ce pari est encore en jeu et ne peut pas être supprimé", code: "BET_IN_PLAY" },
      { status: 409 }
    );
  }

  if (sportBet) {
    await db.delete(bets).where(and(eq(bets.id, id), eq(bets.userId, uid)));
  } else if (comboBet) {
    await db.delete(comboBets).where(and(eq(comboBets.id, id), eq(comboBets.userId, uid)));
  } else {
    await db
      .delete(predictionBets)
      .where(and(eq(predictionBets.id, id), eq(predictionBets.userId, uid)));
  }

  invalidateUserCaches([uid]);

  return NextResponse.json({ ok: true, id });
}
