import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { getAuthUserId } from "@/lib/session";
import { createPayPalOrder, findProvider, storePendingDeposit } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const provider = findProvider("paypal");
  if (!provider?.enabled) {
    return NextResponse.json({ error: "PayPal indisponible" }, { status: 503 });
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
    const order = await createPayPalOrder({
      amount: amount.toFixed(2),
      currency: "EUR",
      returnUrl: `${origin}/parametres?deposit=paypal`,
      cancelUrl: `${origin}/parametres?deposit=cancelled`,
    });

    await storePendingDeposit("paypal", order.id, uid, amount, "EUR");

    if (!order.approveUrl) {
      return NextResponse.json({ error: "Impossible d'initier le paiement" }, { status: 502 });
    }
    return NextResponse.json({ url: order.approveUrl });
  } catch {
    return NextResponse.json({ error: "PayPal indisponible pour le moment" }, { status: 502 });
  }
}