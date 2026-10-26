import { createHash } from "crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { IDEMPOTENCY_CONFLICT_CODE } from "@/lib/odds-lock";

export type IdempotencyScope =
  | "bet:sport"
  | "bet:prediction"
  | "bet:combo"
  | "cashout"
  | "withdrawal:create"
  | "withdrawal:cancel"
  | "deposit:manual"
  | "deposit:stripe"
  | "deposit:paypal"
  | "deposit:paypal_capture";

export type IdempotencyStatus = "processing" | "completed";

/** Bail court pendant un appel HTTP externe (Stripe / PayPal) : auto-récupérable après crash. */
export const IDEMPOTENCY_PROCESSING_TTL_MS = 45_000;
/** Rétention standard d'une clé complétée (alignée sur la fenêtre 24 h de Stripe). */
export const IDEMPOTENCY_COMPLETED_TTL_MS = 24 * 60 * 60_000;

type TxOrDb = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

function canonicalizeValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "number") {
    return Number.isFinite(val) ? String(val) : "null";
  }
  if (typeof val === "boolean" || typeof val === "string") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map((item) => canonicalizeValue(item)).join(",")}]`;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalizeValue(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(val));
}

/**
 * Calcule une empreinte SHA-256 déterministe (clés triées récursivement) du contenu métier
 * d'une requête financière pour rejeter toute réutilisation d'une même `idempotencyKey`
 * avec des paramètres différents (`409 IDEMPOTENCY_KEY_CONFLICT`).
 */
export function computeIdempotencyHash(payload: unknown): string {
  return createHash("sha256").update(canonicalizeValue(payload)).digest("hex");
}

export type IdempotencyLookupResult =
  | { kind: "miss" }
  | { kind: "conflict" }
  | { kind: "in_progress" }
  | {
      kind: "hit";
      statusCode: number;
      responseBody: Record<string, unknown>;
    };

export async function lookupIdempotencyRecord(
  executor: TxOrDb,
  userId: number,
  scope: IdempotencyScope,
  idempotencyKey: string,
  requestHash: string
): Promise<IdempotencyLookupResult> {
  const now = new Date();
  const [row] = await executor
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.scope, scope),
        eq(idempotencyKeys.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);

  if (!row) return { kind: "miss" };

  // Clé complétée dont le TTL (24 h) est expiré : purgée et traitée comme nouvelle clé
  if (row.status === "completed" && row.expiresAt.getTime() <= now.getTime()) {
    await executor
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.idempotencyKey, idempotencyKey),
          eq(idempotencyKeys.status, "completed"),
          lte(idempotencyKeys.expiresAt, now)
        )
      );
    return { kind: "miss" };
  }

  // Toute réutilisation d'une clé active avec un payload différent est rejetée en 409
  if (row.requestHash !== requestHash) return { kind: "conflict" };

  if (row.status === "processing") {
    if (row.expiresAt.getTime() > now.getTime()) {
      return { kind: "in_progress" };
    }
    return { kind: "miss" };
  }

  return {
    kind: "hit",
    statusCode: row.statusCode,
    responseBody: row.responseBody,
  };
}

export async function saveIdempotencyRecord(
  executor: TxOrDb,
  params: {
    userId: number;
    scope: IdempotencyScope;
    idempotencyKey: string;
    requestHash: string;
    statusCode?: number;
    responseBody: Record<string, unknown>;
    ttlMs?: number;
  }
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (params.ttlMs ?? IDEMPOTENCY_COMPLETED_TTL_MS)
  );
  await executor
    .insert(idempotencyKeys)
    .values({
      userId: params.userId,
      scope: params.scope,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      status: "completed",
      statusCode: params.statusCode ?? 200,
      responseBody: params.responseBody,
      expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        idempotencyKeys.userId,
        idempotencyKeys.scope,
        idempotencyKeys.idempotencyKey,
      ],
      set: {
        status: "completed",
        statusCode: params.statusCode ?? 200,
        responseBody: params.responseBody,
        expiresAt,
        updatedAt: now,
      },
      setWhere: eq(idempotencyKeys.requestHash, params.requestHash),
    });
}

/**
 * Réservation atomique en 2 étapes avec `status = 'processing'` et bail `expires_at`
 * pour les routes appelant un prestataire externe (Stripe / PayPal) :
 * - Aucune transaction PostgreSQL ne reste ouverte pendant l'appel réseau externe ;
 * - Si l'instance serverless crashe entre la réservation (`processing`) et la finalisation
 *   (`completed`), le bail expire au bout de 45 s (`expires_at <= now()`) et un unique
 *   réessai avec le même `request_hash` reprend atomiquement le bail par `UPDATE ... RETURNING`.
 */
export async function claimExternalIdempotency(params: {
  userId: number;
  scope: IdempotencyScope;
  idempotencyKey: string;
  requestHash: string;
  processingTtlMs?: number;
}): Promise<IdempotencyLookupResult | { kind: "claimed" }> {
  const now = new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + (params.processingTtlMs ?? IDEMPOTENCY_PROCESSING_TTL_MS)
  );

  // Nettoie au préalable une éventuelle clé `completed` déjà expirée (> 24 h)
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, params.userId),
        eq(idempotencyKeys.scope, params.scope),
        eq(idempotencyKeys.idempotencyKey, params.idempotencyKey),
        eq(idempotencyKeys.status, "completed"),
        lte(idempotencyKeys.expiresAt, now)
      )
    );

  // 1) Tentative d'insertion initiale en `status = 'processing'`
  const inserted = await db
    .insert(idempotencyKeys)
    .values({
      userId: params.userId,
      scope: params.scope,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      status: "processing",
      statusCode: 0,
      responseBody: { status: "processing" },
      expiresAt: leaseExpiresAt,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.idempotencyKey });

  if (inserted.length > 0) {
    return { kind: "claimed" };
  }

  // 2) La clé existe déjà : inspecte son empreinte, son statut et son expiration
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, params.userId),
        eq(idempotencyKeys.scope, params.scope),
        eq(idempotencyKeys.idempotencyKey, params.idempotencyKey)
      )
    )
    .limit(1);

  if (!row) {
    return { kind: "in_progress" };
  }
  if (row.requestHash !== params.requestHash) {
    return { kind: "conflict" };
  }
  if (row.status === "completed") {
    return {
      kind: "hit",
      statusCode: row.statusCode,
      responseBody: row.responseBody,
    };
  }
  if (row.expiresAt.getTime() > now.getTime()) {
    return { kind: "in_progress" };
  }

  // 3) Reprise atomique sur crash (`status = 'processing'` ET `expires_at <= now`) :
  //    un seul worker concurrent peut gagner l'UPDATE conditionnel.
  const reclaimed = await db
    .update(idempotencyKeys)
    .set({
      expiresAt: leaseExpiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(idempotencyKeys.userId, params.userId),
        eq(idempotencyKeys.scope, params.scope),
        eq(idempotencyKeys.idempotencyKey, params.idempotencyKey),
        eq(idempotencyKeys.requestHash, params.requestHash),
        eq(idempotencyKeys.status, "processing"),
        lte(idempotencyKeys.expiresAt, now)
      )
    )
    .returning({ key: idempotencyKeys.idempotencyKey });

  if (reclaimed.length > 0) {
    return { kind: "claimed" };
  }

  // Un autre réessai concurrent vient de reprendre ou de finaliser la clé
  const [afterRace] = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, params.userId),
        eq(idempotencyKeys.scope, params.scope),
        eq(idempotencyKeys.idempotencyKey, params.idempotencyKey),
        gt(idempotencyKeys.expiresAt, now)
      )
    )
    .limit(1);

  if (afterRace && afterRace.requestHash !== params.requestHash) {
    return { kind: "conflict" };
  }
  if (afterRace && afterRace.status === "completed") {
    return {
      kind: "hit",
      statusCode: afterRace.statusCode,
      responseBody: afterRace.responseBody,
    };
  }
  return { kind: "in_progress" };
}

export async function releaseExternalIdempotencyClaim(params: {
  userId: number;
  scope: IdempotencyScope;
  idempotencyKey: string;
}): Promise<void> {
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, params.userId),
        eq(idempotencyKeys.scope, params.scope),
        eq(idempotencyKeys.idempotencyKey, params.idempotencyKey),
        eq(idempotencyKeys.status, "processing")
      )
    )
    .catch(() => undefined);
}

export async function pruneExpiredIdempotencyKeys(): Promise<void> {
  await db
    .execute(
      sql`DELETE FROM "idempotency_keys" WHERE "expires_at" <= now()`
    )
    .catch(() => undefined);
}

export function idempotencyConflictResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Cette clé d'idempotence a déjà été utilisée avec un contenu de requête différent.",
      code: IDEMPOTENCY_CONFLICT_CODE,
    },
    { status: 409 }
  );
}

export function idempotencyInProgressResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Une opération identique est déjà en cours de traitement.",
      code: "IDEMPOTENCY_IN_PROGRESS",
    },
    { status: 409 }
  );
}
