import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { formatServerErrorResponse } from "@/lib/db-error";
import { processStripeWebhookEvent, verifyStripeWebhook } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
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

    const result = await processStripeWebhookEvent(event);

    return NextResponse.json({
      received: true,
      eventId: event.id,
      deduplicated: result.deduplicated,
    });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/payments/stripe/webhook");
  }
}
