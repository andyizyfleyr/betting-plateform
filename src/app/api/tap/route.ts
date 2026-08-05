import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { getAuthUserId } from "@/lib/session";
import {
  analyzePlayerProfile,
  calcMultSafe,
  finalizeRound,
  getSession,
  getSmartCrashValue,
  getSystemHealthModifier,
  setSession,
  TAP_CONFIG,
  type TapSession,
} from "@/lib/tap-engine";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function getUserBalance(uid: number): Promise<number> {
  const [u] = await db
    .select({ balance: appUser.balance })
    .from(appUser)
    .where(eq(appUser.id, uid));
  return u?.balance ?? 0;
}

async function setUserBalance(uid: number, balance: number) {
  await db
    .update(appUser)
    .set({ balance: round2(balance) })
    .where(eq(appUser.id, uid));
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;
  const balance = await getUserBalance(uid);
  return json({ status: "success", balance });
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  let body: { action?: string; bet?: number; count?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const act = body.action ?? "";

  // ---- start_game : mise + déduction + point de crash ----
  if (act === "start_game") {
    const betInput = Number(body.bet);
    if (!betInput || betInput < TAP_CONFIG.MIN_BET) {
      return json(
        { message: `Mise minimale : ${TAP_CONFIG.MIN_BET} ${TAP_CONFIG.CURRENCY_SYMBOL}` },
        400
      );
    }
    const betUsd = Math.min(TAP_CONFIG.BET_MAX_USD, betInput);
    const balance = await getUserBalance(uid);
    if (betUsd > balance) {
      return json({ message: "Solde insuffisant" }, 400);
    }

    await setUserBalance(uid, balance - betUsd);

    const systemHealth = await getSystemHealthModifier();
    const profile = await analyzePlayerProfile(uid, betUsd);
    const crashPoint = getSmartCrashValue(betUsd, profile, systemHealth);

    const session: TapSession = {
      active: true,
      bet: betUsd,
      multiplier: TAP_CONFIG.INITIAL_MULTIPLIER,
      clicks: 0,
      mMax: TAP_CONFIG.MAX_MULTIPLIER,
      crashPoint,
      initialMult: TAP_CONFIG.INITIAL_MULTIPLIER,
      mFactor: TAP_CONFIG.GROWTH_FACTOR,
      riskType: profile.type,
    };
    setSession(uid, session);

    return json({
      status: "success",
      multiplier: TAP_CONFIG.INITIAL_MULTIPLIER,
      factor: TAP_CONFIG.GROWTH_FACTOR,
      new_balance: round2(balance - betUsd),
    });
  }

  // ---- tap_batch : avance les clics, vérifie crash / auto-win ----
  if (act === "tap_batch") {
    const s = getSession(uid);
    if (!s || !s.active) return json({ status: "error" }, 400);

    const count = Math.max(1, Math.floor(Number(body.count) || 0));
    const total = s.clicks + count;
    const mult = calcMultSafe(s.initialMult, s.mFactor, total);

    if (mult >= s.crashPoint) {
      s.multiplier = s.crashPoint;
      const balance = await getUserBalance(uid);
      const r = await finalizeRound(uid, s, false, "Crash", balance);
      await setUserBalance(uid, r.bal);
      return json({ status: "crashed", multiplier: s.crashPoint, new_balance: r.bal });
    }
    if (mult >= s.mMax) {
      s.multiplier = s.mMax;
      const balance = await getUserBalance(uid);
      const r = await finalizeRound(uid, s, true, "Auto Win", balance);
      await setUserBalance(uid, r.bal);
      return json({
        status: "autocashout",
        multiplier: s.mMax,
        new_balance: r.bal,
        win_amount: r.win,
      });
    }

    s.clicks = total;
    s.multiplier = mult;
    setSession(uid, s);
    return json({ status: "ok", multiplier: mult });
  }

  // ---- cashout : encaisse le multiplicateur courant ----
  if (act === "cashout") {
    const s = getSession(uid);
    if (!s || !s.active) return json({ message: "Jeu inactif" }, 400);

    const balance = await getUserBalance(uid);
    const r = await finalizeRound(uid, s, true, "Cashout", balance);
    await setUserBalance(uid, r.bal);
    return json({ status: "success", win_amount: r.win, new_balance: r.bal });
  }

  // ---- fetch_balance ----
  if (act === "fetch_balance") {
    const balance = await getUserBalance(uid);
    return json({ status: "success", balance });
  }

  return json({ status: "error" }, 400);
}