import { createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";
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

const STALE_IN_PROGRESS_MS = 30_000;

export async function lookupIdempotencyRecord(
  executor: TxOrDb,
  userId: number,
  scope: IdempotencyScope,
  idempotencyKey: string,
  requestHash: string
): Promise<IdempotencyLookupResult> {
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
  if (row.requestHash !== requestHash) return { kind: "conflict" };

  if (row.statusCode === 0) {
    const ageMs = Date.now() - row.createdAt.getTime();
    if (ageMs < STALE_IN_PROGRESS_MS) {
      return { kind: "in_progress" };
    }
    // Verrou externe abandonné (> 30 s) : nettoyage pour autoriser un réessai propre
    await executor
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.idempotencyKey, idempotencyKey),
          eq(idempotencyKeys.statusCode, 0)
        )
      );
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
  }
): Promise<void> {
  await executor
    .insert(idempotencyKeys)
    .values({
      userId: params.userId,
      scope: params.scope,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      statusCode: params.statusCode ?? 200,
      responseBody: params.responseBody,
    })
    .onConflictDoUpdate({
      target: [
        idempotencyKeys.userId,
        idempotencyKeys.scope,
        idempotencyKeys.idempotencyKey,
      ],
      set: {
        statusCode: params.statusCode ?? 200,
        responseBody: params.responseBody,
      },
      setWhere: eq(idempotencyKeys.requestHash, params.requestHash),
    });
}

/**
 * Réservation atomique en 2 étapes pour les routes appelant un prestataire externe (Stripe / PayPal)
 * afin de ne JAMAIS garder de transaction PostgreSQL ouverte pendant un appel HTTP externe.
 */
export async function claimExternalIdempotency(params: {
  userId: number;
  scope: IdempotencyScope;
  idempotencyKey: string;
  requestHash: string;
}): Promise<IdempotencyLookupResult | { kind: "claimed" }> {
  const existing = await lookupIdempotencyRecord(
    db,
    params.userId,
    params.scope,
    params.idempotencyKey,
    params.requestHash
  );
  if (existing.kind !== "miss") return existing;

  const inserted = await db
    .insert(idempotencyKeys)
    .values({
      userId: params.userId,
      scope: params.scope,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      statusCode: 0,
      responseBody: { inProgress: true },
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.idempotencyKey });

  if (inserted.length > 0) {
    return { kind: "claimed" };
  }

  return lookupIdempotencyRecord(
    db,
    params.userId,
    params.scope,
    params.idempotencyKey,
    params.requestHash
  );
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
        eq(idempotencyKeys.statusCode, 0)
      )
    )
    .catch(() => undefined);
}

export async function pruneExpiredIdempotencyKeys(): Promise<void> {
  await db
    .execute(
      sql`DELETE FROM "idempotency_keys" WHERE "created_at" < now() - interval '7 days'`
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
