import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import {
  eurToLocal,
  formatLocalAmount,
  getCurrencyConfig,
  localToEur,
  roundEurPivot,
} from "@/lib/countries";
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
import {
  buildGatewayIdempotencyHeader,
  createPayPalOrder,
  findProvider,
  storePendingDeposit,
} from "@/lib/payments";
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

    const amount = roundEurPivot(Number(body.amount));
    const [currencyUser] = await db
      .select({ currency: appUser.currency })
      .from(appUser)
      .where(eq(appUser.id, uid))
      .limit(1);
    const userCurrency = getCurrencyConfig(currencyUser?.currency);
    const minDepEur = Math.max(
      0.5,
      localToEur(userCurrency.minDepositLocal, userCurrency.code)
    );
    const maxDepEur = Math.max(
      2000,
      localToEur(userCurrency.maxDepositLocal, userCurrency.code)
    );
    if (!amount || amount < minDepEur - 1e-4 || amount > maxDepEur + 1e-4) {
      return NextResponse.json(
        {
          error: `Montant invalide (${formatLocalAmount(userCurrency.minDepositLocal, userCurrency.code)} à ${formatLocalAmount(userCurrency.maxDepositLocal, userCurrency.code)})`,
        },
        { status: 400 }
      );
    }

    const paypalChargeEur = Math.max(0.5, Math.round(amount * 100) / 100);
    const PAYPAL_NATIVE_CURRENCIES = new Set([
      "EUR",
      "USD",
      "CAD",
      "GBP",
      "CHF",
    ]);

    const requestHash = computeIdempotencyHash({
      provider: "paypal",
      amount,
      userCurrency: userCurrency.code,
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
    const gatewayKey = buildGatewayIdempotencyHeader(uid, "paypal", idempotencyKey);

    let order: { id: string; approveUrl: string | null };
    try {
      if (
        userCurrency.code !== "EUR" &&
        PAYPAL_NATIVE_CURRENCIES.has(userCurrency.code)
      ) {
        const localAmount = Math.max(0.5, eurToLocal(amount, userCurrency.code));
        try {
          order = await createPayPalOrder({
            amount: localAmount.toFixed(2),
            currency: userCurrency.code,
            returnUrl: `${origin}/parametres?deposit=paypal`,
            cancelUrl: `${origin}/parametres?deposit=cancelled`,
            idempotencyKey: gatewayKey,
          });
        } catch {
          order = await createPayPalOrder({
            amount: paypalChargeEur.toFixed(2),
            currency: "EUR",
            returnUrl: `${origin}/parametres?deposit=paypal`,
            cancelUrl: `${origin}/parametres?deposit=cancelled`,
            idempotencyKey: `${gatewayKey}_eur`.slice(0, 108),
          });
        }
      } else {
        order = await createPayPalOrder({
          amount: paypalChargeEur.toFixed(2),
          currency: "EUR",
          returnUrl: `${origin}/parametres?deposit=paypal`,
          cancelUrl: `${origin}/parametres?deposit=cancelled`,
          idempotencyKey: gatewayKey,
        });
      }
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

    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
      await storePendingDeposit(
        "paypal",
        order.id,
        uid,
        amount,
        "EUR",
        idempotencyKey,
        tx
      );
      await saveIdempotencyRecord(tx, {
        userId: uid,
        scope: "deposit:paypal",
        idempotencyKey,
        requestHash,
        statusCode: 200,
        responseBody: { url: order.approveUrl, providerRef: order.id },
      });
    });

    return NextResponse.json({ url: order.approveUrl, providerRef: order.id });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/payments/paypal");
  }
}
