import { and, count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deposits } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set(["mobile_money", "sepa"]);
const MAX_PENDING_DEPOSITS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;

  let body: { method?: string; reference?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const method = String(body.method ?? "").trim().toLowerCase();
  const reference = String(body.reference ?? "").trim();
  const amount = round2(Number(body.amount));

  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json({ error: "Mode de dépôt non supporté" }, { status: 400 });
  }
  if (reference.length < 4 || reference.length > 100) {
    return NextResponse.json(
      { error: "Veuillez indiquer votre numéro ou référence de transaction" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount < 5 || amount > 2_000) {
    return NextResponse.json(
      { error: "Le montant doit être compris entre 5 € et 2 000 €" },
      { status: 400 }
    );
  }

  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(deposits)
    .where(and(eq(deposits.userId, uid), eq(deposits.status, "pending_review")));

  if ((pendingCount ?? 0) >= MAX_PENDING_DEPOSITS) {
    return NextResponse.json(
      { error: "Vous avez déjà 3 demandes de dépôt en cours de vérification" },
      { status: 400 }
    );
  }

  const [created] = await db
    .insert(deposits)
    .values({
      userId: uid,
      provider: method,
      providerRef: reference,
      amount,
      currency: "EUR",
      status: "pending_review",
    })
    .returning();

  return NextResponse.json({ ok: true, deposit: created });
}
