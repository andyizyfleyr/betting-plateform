import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { getUserBalance } from "@/lib/accelerator-engine";
import {
  ACCEL_CONFIG,
  advanceRound,
  cashoutRound,
  getActiveRound,
  startRound,
} from "@/lib/accelerator-engine";

export const dynamic = "force-dynamic";

const USER_ID = 1;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
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

  let body: { action?: string; bet?: number };
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

  if (act === "tap" || act === "tap_final") {
    const row = await getActiveRound(USER_ID);
    if (!row) return json({ status: "error", message: "Aucune partie en cours" }, 400);
    const r = await advanceRound(row, act);
    if (r.status === "crashed") {
      return json({ status: "crashed", multiplier: r.multiplier, round_id: r.roundId });
    }
    return json({ status: r.status, multiplier: r.multiplier });
  }

  if (act === "cashout") {
    const row = await getActiveRound(USER_ID);
    if (!row) return json({ status: "error", message: "Aucune partie en cours" }, 400);
    const r = await cashoutRound(row);
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
