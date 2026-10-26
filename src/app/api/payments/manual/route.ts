import { and, count, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser, deposits } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { formatServerErrorResponse } from "@/lib/db-error";
import {
  computeIdempotencyHash,
  idempotencyConflictResponse,
  lookupIdempotencyRecord,
  saveIdempotencyRecord,
} from "@/lib/idempotency";
import { extractIdempotencyKey } from "@/lib/odds-lock";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set(["mobile_money", "sepa"]);
const MAX_PENDING_DEPOSITS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    let body: {
      method?: string;
      reference?: string;
      amount?: number;
      idempotencyKey?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const method = String(body.method ?? "").trim().toLowerCase();
    const reference = String(body.reference ?? "").trim();
    const amount = round2(Number(body.amount));
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
    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        { error: "Mode de dépôt non supporté" },
        { status: 400 }
      );
    }
    if (reference.length < 4 || reference.length > 100) {
      return NextResponse.json(
        { error: "Veuillez indiquer votre numéro ou référence de transaction" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(amount) || amount < 5 || amount > 2_000) {
      return NextResponse.json(
        { error: "Le montant doit être compris entre 5 € et 2 000 €" },
        { status: 400 }
      );
    }

    const requestHash = computeIdempotencyHash({ method, reference, amount });

    const preIdem = await lookupIdempotencyRecord(
      db,
      uid,
      "deposit:manual",
      idempotencyKey,
      requestHash
    );
    if (preIdem.kind === "conflict") {
      return idempotencyConflictResponse();
    }
    if (preIdem.kind === "hit") {
      return NextResponse.json({
        ...preIdem.responseBody,
        deduplicated: true,
      });
    }

    type ManualDepTxOutcome =
      | {
          kind: "ok";
          deposit: typeof deposits.$inferSelect;
          deduplicated?: boolean;
        }
      | { kind: "idempotency_conflict" }
      | { kind: "error"; error: string };

    const txRes: ManualDepTxOutcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);

      await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(eq(appUser.id, uid))
        .for("update");

      const inTxIdem = await lookupIdempotencyRecord(
        tx,
        uid,
        "deposit:manual",
        idempotencyKey,
        requestHash
      );
      if (inTxIdem.kind === "conflict") {
        return { kind: "idempotency_conflict" };
      }
      if (inTxIdem.kind === "hit") {
        return {
          kind: "ok",
          deposit: inTxIdem.responseBody.deposit as typeof deposits.$inferSelect,
          deduplicated: true,
        };
      }

      const [existingByCol] = await tx
        .select()
        .from(deposits)
        .where(
          and(
            eq(deposits.userId, uid),
            eq(deposits.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      if (existingByCol) {
        if (
          existingByCol.provider !== method ||
          existingByCol.providerRef !== reference ||
          Math.round(existingByCol.amount * 100) !== Math.round(amount * 100)
        ) {
          return { kind: "idempotency_conflict" };
        }
        return { kind: "ok", deposit: existingByCol, deduplicated: true };
      }

      const [{ pendingCount }] = await tx
        .select({ pendingCount: count() })
        .from(deposits)
        .where(
          and(eq(deposits.userId, uid), eq(deposits.status, "pending_review"))
        );

      if ((pendingCount ?? 0) >= MAX_PENDING_DEPOSITS) {
        return {
          kind: "error",
          error: "Vous avez déjà 3 demandes de dépôt en cours de vérification",
        };
      }

      const [created] = await tx
        .insert(deposits)
        .values({
          userId: uid,
          provider: method,
          providerRef: reference,
          amount,
          currency: "EUR",
          status: "pending_review",
          idempotencyKey,
        })
        .returning();

      await saveIdempotencyRecord(tx, {
        userId: uid,
        scope: "deposit:manual",
        idempotencyKey,
        requestHash,
        statusCode: 200,
        responseBody: { ok: true, deposit: created },
      });

      return { kind: "ok", deposit: created };
    });

    if (txRes.kind === "idempotency_conflict") {
      return idempotencyConflictResponse();
    }
    if (txRes.kind === "error") {
      return NextResponse.json({ error: txRes.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      deposit: txRes.deposit,
      ...(txRes.deduplicated ? { deduplicated: true } : {}),
    });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/payments/manual");
  }
}
