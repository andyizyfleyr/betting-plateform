import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import {
  formatLocalAmount,
  getCurrencyConfig,
  localToEur,
  roundEurPivot,
} from "@/lib/countries";
import { requireUserId } from "@/lib/session";
import { getLatestRound, getUserBalance } from "@/lib/accelerator-engine";
import {
  ACCEL_CONFIG,
  advanceRound,
  cashoutRound,
  getActiveRound,
  holdStartRound,
  startRound,
} from "@/lib/accelerator-engine";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Réponse de l'état terminal de la dernière manche (cashed ou crashed). */
async function lastRoundState(uid: number) {
  const last = await getLatestRound(uid);
  if (!last) return null;
  const mult =
    Number(last.cashoutMultiplier) || Number(last.currentMultiplier) || ACCEL_CONFIG.M_MIN;
  if (last.status === "cashed") {
    return {
      status: "cashed",
      multiplier: mult,
      new_balance: await getUserBalance(uid),
      win_amount: roundEurPivot(Number(last.betAmount) * mult),
      round_id: last.id,
      jackpot: mult >= Number(last.mMax) - 1e-9,
    };
  }
  if (last.status === "crashed" || last.status === "postcrashed") {
    return { status: "crashed", multiplier: mult, round_id: last.id };
  }
  return null;
}

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;
  return json({
    status: "success",
    balance: await getUserBalance(uid),
    symbol: ACCEL_CONFIG.CURRENCY_SYMBOL,
    decimals: ACCEL_CONFIG.DECIMALS,
    min_display: ACCEL_CONFIG.BET_MIN_USD,
    max_display: ACCEL_CONFIG.BET_MAX_USD,
  });
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;

  let body: { action?: string; bet?: number; client_multiplier?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const act = body.action ?? "";

  if (act === "start_game") {
    const bet = roundEurPivot(Number(body.bet));
    const [u] = await db
      .select({ currency: appUser.currency })
      .from(appUser)
      .where(eq(appUser.id, uid))
      .limit(1);
    const userCurrency = getCurrencyConfig(u?.currency);
    const minBetEur = localToEur(userCurrency.minMiniGameLocal, userCurrency.code);
    if (!bet || bet < minBetEur - 1e-4) {
      return json(
        {
          message: `Mise minimale : ${formatLocalAmount(userCurrency.minMiniGameLocal, userCurrency.code)}`,
        },
        400
      );
    }
    const r = await startRound(uid, bet);
    if (r.status !== "success") {
      return json({ status: "error", message: r.message }, 400);
    }
    return json({
      status: "success",
      round_id: r.roundId,
      new_balance: r.newBalance,
      multiplier: r.multiplier,
      g_base: r.gBase,
      g_rate: r.gBase,
      m_max: r.mMax,
      seed_hash: r.seedHash,
    });
  }

  if (act === "hold_start") {
    const r = await holdStartRound(uid);
    if (r.status === "crashed") {
      return json({ status: "crashed", multiplier: r.multiplier, round_id: r.roundId });
    }
    if (r.status === "error") {
      return json({ status: "error", message: r.message }, 400);
    }
    return json({ status: "ok", multiplier: r.multiplier });
  }

  if (act === "tap" || act === "tap_final") {
    const row = await getActiveRound(uid);
    if (!row) {
      // Manche terminée (TTL ou crash) : on renvoie l'état terminal au lieu d'un 400
      // pour que le client affiche un résultat propre après une coupure réseau.
      const term = await lastRoundState(uid);
      if (term) return json(term);
      return json({ status: "error", message: "Aucune partie en cours" }, 400);
    }
    const r = await advanceRound(row, act);
    if (r.status === "crashed") {
      return json({ status: "crashed", multiplier: r.multiplier, round_id: r.roundId });
    }
    return json({ status: r.status, multiplier: r.multiplier });
  }

  if (act === "cashout") {
    const row = await getActiveRound(uid);
    if (!row) {
      // Rejeu idempotent : si la manche a déjà été encaissée (réponse perdue sur un
      // réseau faible), on renvoie le même résultat au lieu de dire "aucune partie".
      const term = await lastRoundState(uid);
      if (term) return json(term);
      return json({ status: "error", message: "Aucune partie en cours" }, 400);
    }
    const raw = Number(body.client_multiplier);
    const clientMult =
      typeof body.client_multiplier === "number" && Number.isFinite(raw)
        ? Math.min(ACCEL_CONFIG.M_MAX, Math.max(ACCEL_CONFIG.M_MIN, raw))
        : null;
    const r = await cashoutRound(row, clientMult);
    return json({
      status: r.status,
      multiplier: r.multiplier,
      new_balance: r.newBalance,
      win_amount: r.winAmount,
      round_id: r.roundId,
      jackpot: r.jackpot,
    });
  }

  return json({ status: "error" }, 400);
}
