import { and, count, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser, withdrawals } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const MIN_WITHDRAWAL = 10;
const MAX_WITHDRAWAL = 5_000;
const MAX_PENDING_WITHDRAWALS = 3;
const ALLOWED_METHODS = new Set(["iban", "paypal", "card"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  const rows = await db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.userId, uid))
    .orderBy(desc(withdrawals.createdAt))
    .limit(50);

  return NextResponse.json({ withdrawals: rows });
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  let body: { method?: string; destination?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const method = String(body.method ?? "").trim().toLowerCase();
  const destination = String(body.destination ?? "").trim();
  const amount = round2(Number(body.amount));

  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json({ error: "Mode de retrait non supporté" }, { status: 400 });
  }
  if (destination.length < 4 || destination.length > 120) {
    return NextResponse.json(
      { error: "Veuillez renseigner une coordonnée de réception valide" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
    return NextResponse.json(
      { error: `Montant de retrait compris entre ${MIN_WITHDRAWAL} € et ${MAX_WITHDRAWAL} €` },
      { status: 400 }
    );
  }

  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, uid), eq(withdrawals.status, "pending")));

  if ((pendingCount ?? 0) >= MAX_PENDING_WITHDRAWALS) {
    return NextResponse.json(
      { error: `Vous avez déjà ${MAX_PENDING_WITHDRAWALS} retraits en attente de validation` },
      { status: 400 }
    );
  }

  const txResult = await db.transaction(async (tx) => {
    const [debited] = await tx
      .update(appUser)
      .set({ balance: sql`ROUND((${appUser.balance} - ${amount})::numeric, 2)::float8` })
      .where(and(eq(appUser.id, uid), sql`${appUser.balance} >= ${amount}`))
      .returning({ balance: appUser.balance });

    if (!debited) return null;

    const [created] = await tx
      .insert(withdrawals)
      .values({
        userId: uid,
        method,
        destination,
        amount,
        status: "pending",
      })
      .returning();

    return { withdrawal: created, balance: debited.balance };
  });

  if (!txResult) {
    return NextResponse.json({ error: "Solde disponible insuffisant" }, { status: 400 });
  }

  return NextResponse.json(txResult);
}

/** Annulation par le joueur d'une demande de retrait encore en attente → remboursement immédiat. */
export async function PATCH(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  let body: { withdrawalId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const wid = Number(body.withdrawalId);
  if (!wid) {
    return NextResponse.json({ error: "Retrait introuvable" }, { status: 400 });
  }

  const txResult = await db.transaction(async (tx) => {
    const [cancelled] = await tx
      .update(withdrawals)
      .set({ status: "cancelled", processedAt: new Date() })
      .where(
        and(
          eq(withdrawals.id, wid),
          eq(withdrawals.userId, uid),
          eq(withdrawals.status, "pending")
        )
      )
      .returning();

    if (!cancelled) return null;

    const [refundedUser] = await tx
      .update(appUser)
      .set({
        balance: sql`ROUND((${appUser.balance} + ${round2(cancelled.amount)})::numeric, 2)::float8`,
      })
      .where(eq(appUser.id, uid))
      .returning({ balance: appUser.balance });

    return { withdrawal: cancelled, balance: refundedUser.balance };
  });

  if (!txResult) {
    return NextResponse.json(
      { error: "Ce retrait a déjà été traité ou annulé" },
      { status: 400 }
    );
  }

  return NextResponse.json(txResult);
}
