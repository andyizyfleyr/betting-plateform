import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { creditDeposit, verifyStripeWebhook } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureSeeded();

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Signature manquante" }, { status: 400 });
  }

  const rawBody = await req.text();
  const event = await verifyStripeWebhook(rawBody, signature);
  if (!event) {
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
  }

  if (event.type === "checkout.session.completed" && event.paymentStatus === "paid" && event.objectId) {
    await creditDeposit("stripe", event.objectId);
  }

  return NextResponse.json({ received: true });
}