import { timingSafeEqual } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, deposits, webhookEvents } from "@/db/schema";
import { invalidateUserCaches } from "@/lib/active-state-cache";
import {
  eurToLocal,
  getCurrencyConfig,
  roundEurPivot,
  type CurrencyCode,
} from "@/lib/countries";

export type PaymentProviderId = "stripe" | "paypal";
export type DepositStatus = "pending" | "paid" | "credited" | "failed" | "expired";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TxOrDb = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

const STRIPE_BASE = "https://api.stripe.com";
const PAYPAL_MODE = process.env.PAYPAL_MODE === "live" ? "live" : "sandbox";
const PAYPAL_BASE =
  PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export interface ProviderInfo {
  id: PaymentProviderId;
  name: string;
  enabled: boolean;
  live: boolean;
}

export interface PublicPaymentClientConfig {
  providers: ProviderInfo[];
  paypalClientId: string | null;
  paypalMode: "live" | "sandbox";
  stripePublishableKey: string | null;
}

/** Prestataires configurés via les variables d'environnement (live/sandbox). */
export function paymentProviders(): ProviderInfo[] {
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  return [
    {
      id: "stripe",
      name: "Carte bancaire",
      enabled: stripeKey.startsWith("sk_"),
      live: stripeKey.startsWith("sk_live_"),
    },
    {
      id: "paypal",
      name: "PayPal",
      enabled: !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_SECRET,
      live: PAYPAL_MODE === "live",
    },
  ];
}

export function publicPaymentClientConfig(): PublicPaymentClientConfig {
  const pk = (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    process.env.STRIPE_PUBLISHABLE_KEY ??
    ""
  ).trim();
  const ppClientId = (process.env.PAYPAL_CLIENT_ID ?? "").trim();
  return {
    providers: paymentProviders(),
    paypalClientId: ppClientId || null,
    paypalMode: PAYPAL_MODE,
    stripePublishableKey: pk.startsWith("pk_") ? pk : null,
  };
}

export function findProvider(id: PaymentProviderId): ProviderInfo | undefined {
  return paymentProviders().find((p) => p.id === id);
}

/** Clé d'idempotence déterministe côté prestataire externe, isolée par utilisateur et flux. */
export function buildGatewayIdempotencyHeader(
  userId: number,
  flow: "stripe" | "paypal" | "paypal_capture",
  idempotencyKey: string
): string {
  return `pulse_${userId}_${flow}_${idempotencyKey}`.slice(0, 108);
}

/* ------------------------------- Stripe (Checkout) ------------------------------- */

function stripeHeaders(idempotencyKey?: string): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

export interface StripeCheckout {
  id: string;
  url: string | null;
  clientSecret?: string | null;
}

export interface VerifiedStripeWebhookEvent {
  id: string;
  type: string;
  objectId?: string;
  paymentStatus?: string;
}

/** Devises officiellement sans décimales côté API Stripe (`unit_amount` en unités entières). */
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set<string>([
  "XOF",
  "XAF",
  "GNF",
  "RWF",
  "MGA",
]);

/** Devises 3 décimales non prises en charge en standard par Stripe Checkout -> repli EUR pivot. */
const STRIPE_EUR_FALLBACK_ONLY_CURRENCIES = new Set<string>(["TND"]);

async function postStripeCheckoutSession(params: {
  userId: number;
  currency: string;
  unitAmount: number;
  successUrl: string;
  cancelUrl: string;
  embedded?: boolean;
  idempotencyKey?: string;
}): Promise<Response> {
  const form = new URLSearchParams();
  form.append("mode", "payment");
  form.append("client_reference_id", String(params.userId));
  if (params.embedded) {
    form.append("ui_mode", "embedded");
    form.append("return_url", params.successUrl);
  } else {
    form.append("success_url", params.successUrl);
    form.append("cancel_url", params.cancelUrl);
  }
  form.append("line_items[0][quantity]", "1");
  form.append(
    "line_items[0][price_data][product_data][name]",
    "Recharge de solde PULSE"
  );
  form.append("line_items[0][price_data][currency]", params.currency.toLowerCase());
  form.append(
    "line_items[0][price_data][unit_amount]",
    String(Math.max(1, Math.round(params.unitAmount)))
  );
  return fetch(`${STRIPE_BASE}/v1/checkout/sessions`, {
    method: "POST",
    headers: stripeHeaders(params.idempotencyKey),
    body: form,
  });
}

/**
 * Crée une session Stripe Checkout hébergée ou intégrée (`ui_mode = "embedded"`) :
 * - Tente d'abord la devise officielle du joueur (ex. `5 000 XOF` -> `unit_amount = 5000`, `currency = "xof"`)
 *   afin d'afficher le montant local exact sur la page Stripe ;
 * - Replie automatiquement sur `EUR` (`unit_amount` en centimes) si le compte marchand Stripe
 *   refuse la devise locale (4xx), tout en conservant le montant pivot 6 décimales exact en base.
 */
export async function createStripeCheckout(opts: {
  userId: number;
  amount: number; // pivot EUR (6 décimales)
  currency: string;
  userCurrency?: CurrencyCode;
  successUrl: string;
  cancelUrl: string;
  embedded?: boolean;
  idempotencyKey?: string;
}): Promise<StripeCheckout> {
  const targetCurrency = getCurrencyConfig(opts.userCurrency ?? opts.currency).code;

  if (
    targetCurrency !== "EUR" &&
    !STRIPE_EUR_FALLBACK_ONLY_CURRENCIES.has(targetCurrency)
  ) {
    const localAmount = eurToLocal(opts.amount, targetCurrency);
    const nativeUnitAmount = STRIPE_ZERO_DECIMAL_CURRENCIES.has(targetCurrency)
      ? Math.max(1, Math.round(localAmount))
      : Math.max(50, Math.round(localAmount * 100));

    const nativeRes = await postStripeCheckoutSession({
      userId: opts.userId,
      currency: targetCurrency,
      unitAmount: nativeUnitAmount,
      successUrl: opts.successUrl,
      cancelUrl: opts.cancelUrl,
      embedded: opts.embedded,
      idempotencyKey: opts.idempotencyKey,
    });
    if (nativeRes.ok) {
      const body = (await nativeRes.json()) as {
        id: string;
        url?: string | null;
        client_secret?: string | null;
      };
      return {
        id: body.id,
        url: body.url ?? null,
        clientSecret: body.client_secret ?? null,
      };
    }
    if (nativeRes.status >= 500) {
      throw new Error(`Stripe ${nativeRes.status}`);
    }
  }

  const eurCents = Math.max(50, Math.round(opts.amount * 100));
  const fallbackKey =
    opts.idempotencyKey && targetCurrency !== "EUR"
      ? `${opts.idempotencyKey}_eur`.slice(0, 120)
      : opts.idempotencyKey;
  const res = await postStripeCheckoutSession({
    userId: opts.userId,
    currency: "EUR",
    unitAmount: eurCents,
    successUrl: opts.successUrl,
    cancelUrl: opts.cancelUrl,
    embedded: opts.embedded,
    idempotencyKey: fallbackKey,
  });
  if (!res.ok) throw new Error(`Stripe ${res.status}`);
  const body = (await res.json()) as {
    id: string;
    url?: string | null;
    client_secret?: string | null;
  };
  return {
    id: body.id,
    url: body.url ?? null,
    clientSecret: body.client_secret ?? null,
  };
}

/**
 * Vérifie la signature Stripe (HMAC SHA-256, tolérance anti-replay 300 s, support de la
 * rotation de clés `v1=` multiples, comparaison en temps constant `timingSafeEqual`)
 * et renvoie l'événement typé avec son `id` (`evt_...`) si valide.
 */
export async function verifyStripeWebhook(
  rawBody: string,
  signature: string,
  secretOverride?: string
): Promise<VerifiedStripeWebhookEvent | null> {
  const secret = secretOverride ?? process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return null;

  let timestampRaw: string | null = null;
  const v1Candidates: string[] = [];

  for (const rawPart of signature.split(",")) {
    const eqIdx = rawPart.indexOf("=");
    if (eqIdx <= 0) continue;
    const k = rawPart.slice(0, eqIdx).trim();
    const v = rawPart.slice(eqIdx + 1).trim();
    if (k === "t" && !timestampRaw) {
      timestampRaw = v;
    } else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) {
      v1Candidates.push(v);
    }
  }

  if (!timestampRaw || v1Candidates.length === 0) return null;
  const tsSeconds = Number(timestampRaw);
  if (!Number.isFinite(tsSeconds)) return null;

  const age = Math.abs(Date.now() / 1000 - tsSeconds);
  if (age > 300) return null;

  const key = new TextEncoder().encode(secret);
  const data = new TextEncoder().encode(`${timestampRaw}.${rawBody}`);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, data);
  const expectedBuf = Buffer.from(new Uint8Array(mac));

  let matched = false;
  for (const candHex of v1Candidates) {
    const candBuf = Buffer.from(candHex, "hex");
    if (candBuf.length === expectedBuf.length && timingSafeEqual(candBuf, expectedBuf)) {
      matched = true;
      break;
    }
  }
  if (!matched) return null;

  let parsed: {
    id?: unknown;
    type?: unknown;
    data?: { object?: { id?: string; payment_status?: string } };
  };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const eventId = typeof parsed?.id === "string" ? parsed.id.trim() : "";
  const eventType = typeof parsed?.type === "string" ? parsed.type.trim() : "";
  if (!eventId || !eventType) return null;

  return {
    id: eventId,
    type: eventType,
    objectId: parsed.data?.object?.id,
    paymentStatus: parsed.data?.object?.payment_status,
  };
}

/* ------------------------------- PayPal (Orders v2) ------------------------------- */

interface PayPalLink {
  rel: string;
  href: string;
}

async function paypalToken(): Promise<string> {
  const cred = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${cred}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export interface PayPalOrder {
  id: string;
  approveUrl: string | null;
}

/** Crée une commande PayPal (intent CAPTURE) et renvoie le lien « approve ». */
export async function createPayPalOrder(opts: {
  amount: string;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
}): Promise<PayPalOrder> {
  const token = await paypalToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "PayPal-Request-Id": opts.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "pulse_deposit",
          amount: { currency_code: opts.currency, value: opts.amount },
        },
      ],
      application_context: {
        brand_name: "PULSE",
        locale: "fr-FR",
        user_action: "PAY_NOW",
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    }),
  });
  if (!res.ok) throw new Error(`PayPal create ${res.status}`);
  const body = (await res.json()) as { id: string; links: PayPalLink[] };
  const approve = body.links.find((l) => l.rel === "approve") ?? null;
  return { id: body.id, approveUrl: approve?.href ?? null };
}

/**
 * Capture une commande PayPal approuvée.
 * Résilient aux pannes post-capture : si PayPal répond `422 ORDER_ALREADY_CAPTURED`
 * lors d'un réessai après crash serveur, on relit `GET /v2/checkout/orders/{id}` pour
 * vérifier que le statut officiel est bien `COMPLETED` afin de finaliser le crédit local.
 */
export async function capturePayPalOrder(
  orderId: string,
  idempotencyKey?: string
): Promise<boolean> {
  const token = await paypalToken();
  const encodedId = encodeURIComponent(orderId);
  const res = await fetch(
    `${PAYPAL_BASE}/v2/checkout/orders/${encodedId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
      },
    }
  );
  if (res.ok) {
    const body = (await res.json()) as { status?: string };
    return body.status === "COMPLETED";
  }

  if (res.status === 422) {
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodedId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (orderRes.ok) {
      const orderBody = (await orderRes.json()) as { status?: string };
      return orderBody.status === "COMPLETED";
    }
  }
  return false;
}

/* --------------------------- Enregistrement / crédit --------------------------- */

/** Enregistre un dépôt en attente (appelé à la création de la session/commande). */
export async function storePendingDeposit(
  provider: PaymentProviderId,
  providerRef: string,
  userId: number,
  amount: number,
  currency: string,
  idempotencyKey?: string,
  executor: TxOrDb = db
) {
  await executor
    .insert(deposits)
    .values({
      userId,
      provider,
      providerRef,
      amount,
      currency,
      status: "pending",
      ...(idempotencyKey ? { idempotencyKey } : {}),
    })
    .onConflictDoNothing();
}

/**
 * Exécute le crédit atomique d'un dépôt à l'intérieur d'une transaction existante
 * en respectant le DAG global de verrous : `deposits FOR UPDATE` -> `app_user FOR UPDATE`.
 */
export async function creditDepositInTx(
  tx: DbTx,
  provider: PaymentProviderId,
  providerRef: string,
  fallbackUserId = 1
): Promise<{ creditedNow: boolean; userId: number }> {
  const [lockedDep] = await tx
    .select()
    .from(deposits)
    .where(and(eq(deposits.provider, provider), eq(deposits.providerRef, providerRef)))
    .for("update");

  if (lockedDep && lockedDep.status === "credited") {
    return { creditedNow: false, userId: lockedDep.userId };
  }

  const uid = lockedDep?.userId ?? fallbackUserId;
  const amount = lockedDep ? roundEurPivot(lockedDep.amount) : 0;

  await tx
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.id, uid))
    .for("update");

  if (lockedDep) {
    await tx
      .update(deposits)
      .set({ status: "credited", updatedAt: new Date() })
      .where(eq(deposits.id, lockedDep.id));
  } else {
    await tx.insert(deposits).values({
      userId: uid,
      provider,
      providerRef,
      amount,
      currency: "EUR",
      status: "credited",
    });
  }

  if (amount > 0) {
    await tx
      .update(appUser)
      .set({
        balance: sql`ROUND((${appUser.balance} + ${amount})::numeric, 6)::float8`,
      })
      .where(eq(appUser.id, uid));
    return { creditedNow: true, userId: uid };
  }

  return { creditedNow: false, userId: uid };
}

/**
 * Crédite le solde d'un dépôt de façon strictement atomique et idempotente sous verrou SQL :
 * même si un webhook Stripe et une requête client arrivent à la même milliseconde,
 * le crédit ne peut se produire qu'une seule et unique fois.
 */
export async function creditDeposit(
  provider: PaymentProviderId,
  providerRef: string,
  fallbackUserId = 1
): Promise<boolean> {
  let creditedUserId: number | null = null;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    const res = await creditDepositInTx(tx, provider, providerRef, fallbackUserId);
    if (res.creditedNow) {
      creditedUserId = res.userId;
    }
  });

  if (creditedUserId != null) {
    invalidateUserCaches([creditedUserId]);
  }
  return true;
}

/**
 * Dédoublonne atomiquement un événement webhook Stripe par `("stripe", event.id)` dans `webhook_events`
 * ET exécute le crédit éventuel dans la MÊME transaction PostgreSQL :
 * - Rejeu d'un `event.id` déjà traité -> `ON CONFLICT DO NOTHING` renvoie 0 ligne -> ignoré immédiatement ;
 * - Erreur base/verrou transitoire -> rollback intégral (y compris `webhook_events`) pour permettre le retry Stripe.
 */
export async function processStripeWebhookEvent(
  event: VerifiedStripeWebhookEvent
): Promise<{ deduplicated: boolean; credited: boolean }> {
  let creditedUserId: number | null = null;

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);

    const insertedEvent = await tx
      .insert(webhookEvents)
      .values({
        provider: "stripe",
        eventId: event.id,
        eventType: event.type,
        objectId: event.objectId ?? null,
      })
      .onConflictDoNothing({
        target: [webhookEvents.provider, webhookEvents.eventId],
      })
      .returning({ eventId: webhookEvents.eventId });

    if (insertedEvent.length === 0) {
      return { deduplicated: true, credited: false };
    }

    if (
      event.type === "checkout.session.completed" &&
      event.paymentStatus === "paid" &&
      event.objectId
    ) {
      const creditRes = await creditDepositInTx(tx, "stripe", event.objectId);
      if (creditRes.creditedNow) {
        creditedUserId = creditRes.userId;
      }
      return { deduplicated: false, credited: creditRes.creditedNow };
    }

    return { deduplicated: false, credited: false };
  });

  if (creditedUserId != null) {
    invalidateUserCaches([creditedUserId]);
  }
  return outcome;
}

export async function getDepositStatus(providerRef: string) {
  const [dep] = await db
    .select()
    .from(deposits)
    .where(eq(deposits.providerRef, providerRef))
    .limit(1);
  if (!dep) return { status: "unknown" as DepositStatus, credited: false };

  if (
    dep.status === "pending" &&
    dep.provider === "stripe" &&
    (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_")
  ) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4_000);
      const res = await fetch(
        `${STRIPE_BASE}/v1/checkout/sessions/${encodeURIComponent(providerRef)}`,
        {
          method: "GET",
          headers: stripeHeaders(),
          signal: ctrl.signal,
        }
      ).finally(() => clearTimeout(timer));
      if (res.ok) {
        const session = (await res.json()) as { payment_status?: string };
        if (session.payment_status === "paid") {
          await creditDeposit("stripe", providerRef, dep.userId);
          return { status: "credited" as DepositStatus, credited: true };
        }
      }
    } catch {
      /* le webhook ou le prochain poll finalisera le crédit */
    }
  }

  return { status: dep.status as DepositStatus, credited: dep.status === "credited" };
}

/**
 * Expire proprement les sessions Stripe / PayPal abandonnées après 24h
 * (ne touche jamais aux demandes manuelles `pending_review` Mobile Money / SEPA).
 */
export async function expireStaleGatewayDeposits(): Promise<void> {
  await db
    .update(deposits)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      sql`${deposits.status} = 'pending' AND ${deposits.provider} IN ('stripe', 'paypal') AND ${deposits.createdAt} < now() - interval '24 hours'`
    );
}
