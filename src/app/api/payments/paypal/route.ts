import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { formatServerErrorResponse } from "@/lib/db-error";
import {
  claimExternalIdempotency,
  computeIdempotencyHash,
  idempotencyConflictResponse,
  idempotencyInProgressResponse,
  releaseExternalIdempotencyClaim,
  saveIdempotencyRecord,
} from "@/lib/idempotency";
import { extractIdempotencyKey } from "@/lib/odds-lock";
import { createPayPalOrder, findProvider, storePendingDeposit } from "@/lib/payments";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const provider = findProvider("paypal");
    if (!provider?.enabled) {
      return NextResponse.json(
        { error: "PayPal indisponible" },
        { status: 503 }
      );
    }

    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;
    let body: { amount?: number; idempotencyKey?: string } = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const idempotencyKey = extractIdempotencyKey(
      body.idempotencyKey,
      req.headers.get("idempotency-key")
    );
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Clé d'idempotence manquante ou invalide" },
        { status: 400 }
      );
    }

    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!amount || amount < 5 || amount > 2000) {
      return NextResponse.json(
        { error: "Montant invalide (5 à 2000 €)" },
        { status: 400 }
      );
    }

    const requestHash = computeIdempotencyHash({
      provider: "paypal",
      amount,
    });

    const claim = await claimExternalIdempotency({
      userId: uid,
      scope: "deposit:paypal",
      idempotencyKey,
      requestHash,
    });
    if (claim.kind === "conflict") return idempotencyConflictResponse();
    if (claim.kind === "in_progress") return idempotencyInProgressResponse();
    if (claim.kind === "hit") {
      return NextResponse.json({ ...claim.responseBody, deduplicated: true });
    }

    const origin = new URL(req.url).origin;
    try {
      const order = await createPayPalOrder({
        amount: amount.toFixed(2),
        currency: "EUR",
        returnUrl: `${origin}/parametres?deposit=paypal`,
        cancelUrl: `${origin}/parametres?deposit=cancelled`,
        idempotencyKey,
      });

      if (!order.approveUrl) {
        await releaseExternalIdempotencyClaim({
          userId: uid,
          scope: "deposit:paypal",
          idempotencyKey,
        });
        return NextResponse.json(
          { error: "Impossible d'initier le paiement" },
          { status: 502 }
        );
      }

      await storePendingDeposit(
        "paypal",
        order.id,
        uid,
        amount,
        "EUR",
        idempotencyKey
      );
      await saveIdempotencyRecord(db, {
        userId: uid,
        scope: "deposit:paypal",
        idempotencyKey,
        requestHash,
        statusCode: 200,
        responseBody: { url: order.approveUrl },
      });

      return NextResponse.json({ url: order.approveUrl });
    } catch {
      await releaseExternalIdempotencyClaim({
        userId: uid,
        scope: "deposit:paypal",
        idempotencyKey,
      });
      return NextResponse.json(
        { error: "PayPal indisponible pour le moment" },
        { status: 502 }
      );
    }
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/payments/paypal");
  }
}
