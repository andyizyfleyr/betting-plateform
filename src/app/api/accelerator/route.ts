import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
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

const USER_ID = 1;
const round2 = (n: number) => Math.round(n * 100) / 100;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Réponse de l'état terminal de la dernière manche (cashed ou crashed). */
async function lastRoundState() {
  const last = await getLatestRound(USER_ID);
  if (!last) return null;
  const mult =
    Number(last.cashoutMultiplier) || Number(last.currentMultiplier) || ACCEL_CONFIG.M_MIN;
  if (last.status === "cashed") {
    return {
      status: "cashed",
      multiplier: mult,
      new_balance: await getUserBalance(USER_ID),
      win_amount: round2(Number(last.betAmount) * mult),
      round_id: last.id,
      jackpot: mult >= Number(last.mMax) - 1e-9,
    };
  }
  if (last.status === "crashed" || last.status === "postcrashed") {
    return { status: "crashed", multiplier: mult, round_id: last.id };
  }
  return null;
}

export async function GET() {
  await ensureSeeded();
  return json({
    status: "success",
    balance: await getUserBalance(USER_ID),
    symbol: ACCEL_CONFIG.CURRENCY_SYMBOL,
    decimals: ACCEL_CONFIG.DECIMALS,
    min_display: ACCEL_CONFIG.BET_MIN_USD,
    max_display: ACCEL_CONFIG.BET_MAX_USD,
  });
}

export async function POST(req: NextRequest) {
  await ensureSeeded();

  let body: { action?: string; bet?: number; client_multiplier?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const act = body.action ?? "";

  if (act === "start_game") {
    const bet = Number(body.bet);
    if (!bet || bet < ACCEL_CONFIG.BET_MIN_USD) {
      return json(
        { message: `Mise minimale : ${ACCEL_CONFIG.BET_MIN_USD} ${ACCEL_CONFIG.CURRENCY_SYMBOL}` },
        400
      );
    }
    const r = await startRound(USER_ID, bet);
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
    const r = await holdStartRound(USER_ID);
    if (r.status === "crashed") {
      return json({ status: "crashed", multiplier: r.multiplier, round_id: r.roundId });
    }
    if (r.status === "error") {
      return json({ status: "error", message: r.message }, 400);
    }
    return json({ status: "ok", multiplier: r.multiplier });
  }

  if (act === "tap" || act === "tap_final") {
    const row = await getActiveRound(USER_ID);
    if (!row) {
      // Manche terminée (TTL ou crash) : on renvoie l'état terminal au lieu d'un 400
      // pour que le client affiche un résultat propre après une coupure réseau.
      const term = await lastRoundState();
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
    const row = await getActiveRound(USER_ID);
    if (!row) {
      // Rejeu idempotent : si la manche a déjà été encaissée (réponse perdue sur un
      // réseau faible), on renvoie le même résultat au lieu de dire "aucune partie".
      const term = await lastRoundState();
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
