import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { getAuthUserId } from "@/lib/session";
import { createStripeCheckout, findProvider, storePendingDeposit } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const provider = findProvider("stripe");
  if (!provider?.enabled) {
    return NextResponse.json({ error: "Paiement par carte indisponible" }, { status: 503 });
  }

  const uid = (await getAuthUserId(req)) ?? 1;
  let body: { amount?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!amount || amount < 5 || amount > 2000) {
    return NextResponse.json({ error: "Montant invalide (5 à 2000 €)" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  try {
    const session = await createStripeCheckout({
      userId: uid,
      amount,
      currency: "EUR",
      successUrl: `${origin}/parametres?deposit=stripe&ref={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/parametres?deposit=cancelled`,
    });

    await storePendingDeposit("stripe", session.id, uid, amount, "EUR");

    if (!session.url) {
      return NextResponse.json({ error: "Impossible d'initier le paiement" }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Paiement indisponible pour le moment" }, { status: 502 });
  }
}