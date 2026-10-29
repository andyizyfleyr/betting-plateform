import { schedulePushNotifications } from "@/lib/push-notifications";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { invalidateUserCaches } from "@/lib/active-state-cache";
import { publicUser } from "@/lib/auth";
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
  capturePayPalOrder,
  creditDepositInTx,
} from "@/lib/payments";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    let body: { orderId?: string; idempotencyKey?: string } = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const orderId = String(body.orderId ?? "").trim();
    const idempotencyKey = extractIdempotencyKey(
      body.idempotencyKey,
      req.headers.get("idempotency-key")
    );
    if (!orderId) {
      return NextResponse.json({ error: "Commande manquante" }, { status: 400 });
    }
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Clé d'idempotence manquante ou invalide" },
        { status: 400 }
      );
    }

    const requestHash = computeIdempotencyHash({ orderId });

    const claim = await claimExternalIdempotency({
      userId: uid,
      scope: "deposit:paypal_capture",
      idempotencyKey,
      requestHash,
    });
    if (claim.kind === "conflict") return idempotencyConflictResponse();
    if (claim.kind === "in_progress") return idempotencyInProgressResponse();
    if (claim.kind === "hit") {
      const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
      return NextResponse.json({
        user: user ? publicUser(user) : claim.responseBody.user ?? null,
        deduplicated: true,
      });
    }

    const gatewayKey = buildGatewayIdempotencyHeader(
      uid,
      "paypal_capture",
      idempotencyKey
    );

    let captured = false;
    try {
      captured = await capturePayPalOrder(orderId, gatewayKey);
    } catch {
      await releaseExternalIdempotencyClaim({
        userId: uid,
        scope: "deposit:paypal_capture",
        idempotencyKey,
      });
      return NextResponse.json(
        { error: "PayPal indisponible pour le moment" },
        { status: 502 }
      );
    }

    if (!captured) {
      await releaseExternalIdempotencyClaim({
        userId: uid,
        scope: "deposit:paypal_capture",
        idempotencyKey,
      });
      return NextResponse.json(
        { error: "Le paiement n'a pas été confirmé" },
        { status: 400 }
      );
    }

    let creditedNow = false;
    const pub = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
      const creditRes = await creditDepositInTx(tx, "paypal", orderId, uid);
      creditedNow = creditRes.creditedNow;
      const [user] = await tx.select().from(appUser).where(eq(appUser.id, uid));
      const publicProfile = user ? publicUser(user) : null;

      await saveIdempotencyRecord(tx, {
        userId: uid,
        scope: "deposit:paypal_capture",
        idempotencyKey,
        requestHash,
        statusCode: 200,
        responseBody: { user: publicProfile },
      });

      return publicProfile;
    });

    if (creditedNow) {
      invalidateUserCaches([uid]);
      schedulePushNotifications();
    }

    return NextResponse.json({ user: pub });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/payments/paypal/capture");
  }
}
