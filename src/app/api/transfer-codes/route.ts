import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { ensureTransferSchema } from "@/db/transfer-schema";
import { requireUserId } from "@/lib/session";
import { createTransfer, redeemTransfer, cancelTransfer } from "@/lib/transfer-code-engine";
import { decryptTransferCode } from "@/lib/transfer-code-crypto";
import { invalidateUserCaches } from "@/lib/active-state-cache";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function enabled() { return process.env.TRANSFER_CODES_ENABLED === "true" && /^[a-fA-F0-9]{64}$/.test(process.env.TRANSFER_CODE_SECRET ?? ""); }

export async function GET(req: NextRequest) {
  if (!enabled()) return reply({ error: "Service indisponible" }, 503);
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    await ensureTransferSchema();
    const before = req.nextUrl.searchParams.get("before");
    if (before !== null && !/^[1-9]\d{0,17}$/.test(before)) return reply({ error: "Demande invalide" }, 400);
    const result = await db.execute(sql`SELECT id::text, amount::float8, status, created_at, updated_at,
      CASE WHEN owner_id=${uid} THEN 'withdrawal' ELSE 'deposit' END AS type,
      CASE WHEN owner_id=${uid} THEN code_ciphertext ELSE NULL END AS encrypted_code,
      CASE WHEN owner_id=${uid} THEN code_hash ELSE NULL END AS private_hash
      FROM transfer_codes WHERE (owner_id=${uid} OR redeemed_by=${uid})
      AND (${before}::text IS NULL OR id < ${before}::bigint) ORDER BY transfer_codes.id DESC LIMIT 51`);
    const transfers = result.rows.slice(0, 50).map(raw => {
      const { encrypted_code, private_hash, ...entry } = raw as { id: string; [key: string]: unknown };
      let code: string | null = null;
      if (typeof encrypted_code === "string" && typeof private_hash === "string") {
        try { code = decryptTransferCode(encrypted_code, process.env.TRANSFER_CODE_SECRET!, uid, private_hash); } catch { /* ancienne clé ou enveloppe invalide */ }
      }
      return { ...entry, code };
    });
    const last = transfers[transfers.length - 1] as { id: string } | undefined;
    return reply({ transfers, nextCursor: result.rows.length > 50 ? last?.id : null });
  } catch {
    return reply({ error: "Service indisponible" }, 503);
  }
}

export async function POST(req: NextRequest) {
  if (!enabled()) return reply({ error: "Service indisponible" }, 503);
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    await ensureTransferSchema();
    if (Number(req.headers.get("content-length") ?? 0) > 4096) return reply({ error: "Demande invalide" }, 400);
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Demande invalide" }, 400);
    const { action, amount, code, key, id } = body as Record<string, unknown>;
    const secret = process.env.TRANSFER_CODE_SECRET!;
    if (action === "create" && typeof amount === "number" && typeof key === "string") {
      const result = await createTransfer(uid, amount, key, secret);
      invalidateUserCaches([uid]);
      return reply(result);
    }
    if (action === "redeem" && typeof code === "string" && code.length <= 64 && typeof key === "string") {
      const result = await redeemTransfer(uid, code, key, secret);
      if (result.kind === "blocked") return reply({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);
      if (result.kind !== "ok") return reply({ error: "Code invalide ou indisponible." }, 400);
      invalidateUserCaches([uid]);
      return reply(result);
    }
    if (action === "cancel" && typeof id === "string") {
      const result = await cancelTransfer(uid, id);
      if (result.kind !== "ok") return reply({ error: "Opération indisponible." }, 400);
      invalidateUserCaches([uid]);
      return reply(result);
    }
    return reply({ error: "Demande invalide" }, 400);
  } catch (error) {
    // Ne jamais journaliser la requête, le code, la clé ou une erreur brute de base de données.
    const message = error instanceof Error ? error.message : "";
    const allowed = ["Solde transférable insuffisant", "Montant hors limites", "Clé déjà utilisée pour un autre montant", "Demande invalide"];
    return allowed.includes(message) ? reply({ error: message }, 400) : reply({ error: "Service indisponible" }, 503);
  }
}
