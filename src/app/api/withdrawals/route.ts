import { and, count, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser, withdrawals } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { invalidateUserCaches } from "@/lib/active-state-cache";
import {
  formatEurAsCurrency,
  formatLocalAmount,
  getCurrencyConfig,
  localToEur,
  roundEurPivot,
} from "@/lib/countries";
import { formatServerErrorResponse } from "@/lib/db-error";
import {
  computeIdempotencyHash,
  idempotencyConflictResponse,
  lookupIdempotencyRecord,
  saveIdempotencyRecord,
} from "@/lib/idempotency";
import { extractIdempotencyKey } from "@/lib/odds-lock";
import { requireUserId } from "@/lib/session";
import { computeWithdrawalEligibility } from "@/lib/wager";

export const dynamic = "force-dynamic";

const MAX_WITHDRAWAL = 5_000;
const MAX_PENDING_WITHDRAWALS = 3;
const ALLOWED_METHODS = new Set(["iban", "paypal", "card", "mobile_money"]);

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    const [rows, eligibility] = await Promise.all([
      db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.userId, uid))
        .orderBy(desc(withdrawals.createdAt))
        .limit(50),
      computeWithdrawalEligibility(uid),
    ]);

    return NextResponse.json({ withdrawals: rows, eligibility });
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/withdrawals");
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    let body: {
      method?: string;
      destination?: string;
      amount?: number;
      idempotencyKey?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const method = String(body.method ?? "").trim().toLowerCase();
    const destination = String(body.destination ?? "").trim();
    const amount = roundEurPivot(Number(body.amount));
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
        { error: "Mode de retrait non supporté" },
        { status: 400 }
      );
    }
    if (destination.length < 4 || destination.length > 120) {
      return NextResponse.json(
        { error: "Veuillez renseigner une coordonnée de réception valide" },
        { status: 400 }
      );
    }

    const [currencyUser] = await db
      .select({ currency: appUser.currency })
      .from(appUser)
      .where(eq(appUser.id, uid))
      .limit(1);
    const userCurrency = getCurrencyConfig(currencyUser?.currency);
    const minWdEur = localToEur(userCurrency.minWithdrawalLocal, userCurrency.code);
    const maxWdEur = Math.max(
      MAX_WITHDRAWAL,
      localToEur(userCurrency.maxWithdrawalLocal, userCurrency.code)
    );
    if (
      !Number.isFinite(amount) ||
      amount < minWdEur - 1e-4 ||
      amount > maxWdEur + 1e-4
    ) {
      return NextResponse.json(
        {
          error: `Montant de retrait compris entre ${formatLocalAmount(userCurrency.minWithdrawalLocal, userCurrency.code)} et ${formatLocalAmount(userCurrency.maxWithdrawalLocal, userCurrency.code)}`,
        },
        { status: 400 }
      );
    }

    const requestHash = computeIdempotencyHash({ method, destination, amount });

    const preIdem = await lookupIdempotencyRecord(
      db,
      uid,
      "withdrawal:create",
      idempotencyKey,
      requestHash
    );
    if (preIdem.kind === "conflict") {
      return idempotencyConflictResponse();
    }
    if (preIdem.kind === "hit") {
      const [u] = await db
        .select({ balance: appUser.balance })
        .from(appUser)
        .where(eq(appUser.id, uid));
      return NextResponse.json({
        ...preIdem.responseBody,
        balance: u?.balance ?? preIdem.responseBody.balance ?? 0,
        deduplicated: true,
      });
    }

    // Vérification anti-abus sur le bonus d'inscription (exigence de mise 1× à cote ≥ 1,30)
    const eligibility = await computeWithdrawalEligibility(uid);
    if (amount > eligibility.balance + 1e-5) {
      return NextResponse.json(
        { error: "Solde disponible insuffisant" },
        { status: 400 }
      );
    }
    if (amount > eligibility.withdrawable + 1e-5) {
      return NextResponse.json(
        {
          error: `Bonus d'inscription soumis à mise 1× (cote ≥ 1,30). Il vous reste ${formatEurAsCurrency(eligibility.bonusRemaining, userCurrency.code)} à miser. Solde retirable immédiatement : ${formatEurAsCurrency(eligibility.withdrawable, userCurrency.code)}`,
        },
        { status: 400 }
      );
    }

    type WithdrawalTxOutcome =
      | {
          kind: "ok";
          balance: number;
          withdrawal: typeof withdrawals.$inferSelect;
          deduplicated?: boolean;
        }
      | { kind: "idempotency_conflict" }
      | { kind: "error"; error: string };

    const txResult: WithdrawalTxOutcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);

      const [lockedUser] = await tx
        .select({ id: appUser.id, balance: appUser.balance })
        .from(appUser)
        .where(eq(appUser.id, uid))
        .for("update");

      if (!lockedUser) {
        return { kind: "error", error: "Compte introuvable" };
      }

      const inTxIdem = await lookupIdempotencyRecord(
        tx,
        uid,
        "withdrawal:create",
        idempotencyKey,
        requestHash
      );
      if (inTxIdem.kind === "conflict") {
        return { kind: "idempotency_conflict" };
      }
      if (inTxIdem.kind === "hit") {
        return {
          kind: "ok",
          balance: lockedUser.balance,
          withdrawal: inTxIdem.responseBody
            .withdrawal as typeof withdrawals.$inferSelect,
          deduplicated: true,
        };
      }

      const [existingByCol] = await tx
        .select()
        .from(withdrawals)
        .where(
          and(
            eq(withdrawals.userId, uid),
            eq(withdrawals.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      if (existingByCol) {
        if (
          existingByCol.method !== method ||
          existingByCol.destination !== destination ||
          Math.round(existingByCol.amount * 100) !== Math.round(amount * 100)
        ) {
          return { kind: "idempotency_conflict" };
        }
        return {
          kind: "ok",
          balance: lockedUser.balance,
          withdrawal: existingByCol,
          deduplicated: true,
        };
      }

      const [{ pendingCount }] = await tx
        .select({ pendingCount: count() })
        .from(withdrawals)
        .where(
          and(eq(withdrawals.userId, uid), eq(withdrawals.status, "pending"))
        );

      if ((pendingCount ?? 0) >= MAX_PENDING_WITHDRAWALS) {
        return {
          kind: "error",
          error: `Vous avez déjà ${MAX_PENDING_WITHDRAWALS} retraits en attente de validation`,
        };
      }

      if (lockedUser.balance < amount) {
        return { kind: "error", error: "Solde disponible insuffisant" };
      }

      const [debited] = await tx
        .update(appUser)
        .set({
          balance: sql`ROUND((${appUser.balance} - ${amount})::numeric, 6)::float8`,
        })
        .where(and(eq(appUser.id, uid), sql`${appUser.balance} >= ${amount}`))
        .returning({ balance: appUser.balance });

      if (!debited) {
        return { kind: "error", error: "Solde disponible insuffisant" };
      }

      const [created] = await tx
        .insert(withdrawals)
        .values({
          userId: uid,
          method,
          destination,
          amount,
          status: "pending",
          idempotencyKey,
        })
        .returning();

      await saveIdempotencyRecord(tx, {
        userId: uid,
        scope: "withdrawal:create",
        idempotencyKey,
        requestHash,
        statusCode: 200,
        responseBody: { balance: debited.balance, withdrawal: created },
      });

      return { kind: "ok", balance: debited.balance, withdrawal: created };
    });

    if (txResult.kind === "idempotency_conflict") {
      return idempotencyConflictResponse();
    }
    if (txResult.kind === "error") {
      return NextResponse.json({ error: txResult.error }, { status: 400 });
    }

    if (!txResult.deduplicated) {
      invalidateUserCaches([uid]);
    }
    return NextResponse.json({
      balance: txResult.balance,
      withdrawal: txResult.withdrawal,
      ...(txResult.deduplicated ? { deduplicated: true } : {}),
    });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/withdrawals");
  }
}

/** Annulation par le joueur d'un retrait encore « pending » : recrédit immédiat et idempotent. */
export async function PATCH(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const uid = auth;

    let body: { withdrawalId?: number; idempotencyKey?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const wid = Number(body.withdrawalId);
    const idempotencyKey = extractIdempotencyKey(
      body.idempotencyKey,
      req.headers.get("idempotency-key")
    );
    if (!Number.isInteger(wid) || wid <= 0) {
      return NextResponse.json(
        { error: "Identifiant de retrait manquant" },
        { status: 400 }
      );
    }
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Clé d'idempotence manquante ou invalide" },
        { status: 400 }
      );
    }

    const requestHash = computeIdempotencyHash({ withdrawalId: wid });

    const preIdem = await lookupIdempotencyRecord(
      db,
      uid,
      "withdrawal:cancel",
      idempotencyKey,
      requestHash
    );
    if (preIdem.kind === "conflict") {
      return idempotencyConflictResponse();
    }
    if (preIdem.kind === "hit") {
      const [u] = await db
        .select({ balance: appUser.balance })
        .from(appUser)
        .where(eq(appUser.id, uid));
      return NextResponse.json({
        ...preIdem.responseBody,
        balance: u?.balance ?? preIdem.responseBody.balance ?? 0,
        deduplicated: true,
      });
    }

    type CancelTxOutcome =
      | {
          kind: "ok";
          balance: number;
          withdrawal: typeof withdrawals.$inferSelect;
          deduplicated?: boolean;
        }
      | { kind: "idempotency_conflict" }
      | { kind: "already_processed" };

    const result: CancelTxOutcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);

      // Ordre canonique global : ligne domaine (`withdrawals`) -> `app_user` -> `idempotency_keys`
      const [lockedWd] = await tx
        .select()
        .from(withdrawals)
        .where(and(eq(withdrawals.id, wid), eq(withdrawals.userId, uid)))
        .for("update");

      const [lockedUser] = await tx
        .select({ id: appUser.id, balance: appUser.balance })
        .from(appUser)
        .where(eq(appUser.id, uid))
        .for("update");

      const inTxIdem = await lookupIdempotencyRecord(
        tx,
        uid,
        "withdrawal:cancel",
        idempotencyKey,
        requestHash
      );
      if (inTxIdem.kind === "conflict") {
        return { kind: "idempotency_conflict" };
      }
      if (inTxIdem.kind === "hit" && lockedUser) {
        return {
          kind: "ok",
          balance: lockedUser.balance,
          withdrawal: (lockedWd ??
            inTxIdem.responseBody.withdrawal) as typeof withdrawals.$inferSelect,
          deduplicated: true,
        };
      }

      if (!lockedWd || lockedWd.status !== "pending") {
        return { kind: "already_processed" };
      }

      const [updated] = await tx
        .update(withdrawals)
        .set({ status: "cancelled", processedAt: new Date() })
        .where(eq(withdrawals.id, lockedWd.id))
        .returning();

      const [user] = await tx
        .update(appUser)
        .set({
          balance: sql`ROUND((${appUser.balance} + ${roundEurPivot(updated.amount)})::numeric, 6)::float8`,
        })
        .where(eq(appUser.id, uid))
        .returning({ balance: appUser.balance });

      await saveIdempotencyRecord(tx, {
        userId: uid,
        scope: "withdrawal:cancel",
        idempotencyKey,
        requestHash,
        statusCode: 200,
        responseBody: { balance: user.balance, withdrawal: updated },
      });

      return { kind: "ok", balance: user.balance, withdrawal: updated };
    });

    if (result.kind === "idempotency_conflict") {
      return idempotencyConflictResponse();
    }
    if (result.kind === "already_processed") {
      return NextResponse.json(
        { error: "Ce retrait ne peut plus être annulé (déjà traité)" },
        { status: 400 }
      );
    }

    if (!result.deduplicated) {
      invalidateUserCaches([uid]);
    }
    return NextResponse.json({
      balance: result.balance,
      withdrawal: result.withdrawal,
      ...(result.deduplicated ? { deduplicated: true } : {}),
    });
  } catch (err) {
    return formatServerErrorResponse(err, "PATCH /api/withdrawals");
  }
}
