import { desc, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  acceleratorRounds,
  bets,
  comboBets,
  deposits,
  predictionBets,
  tapHistory,
  walletAdjustments,
  withdrawals,
} from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { roundEurPivot } from "@/lib/countries";
import { isKnownMarket, marketLabelFor } from "@/lib/markets";
import { jsonWithEtag } from "@/lib/response-cache";
import { requireUserId } from "@/lib/session";
import { syncAllSettlementsThrottled } from "@/lib/sync-throttle";
import { computeWithdrawalEligibility } from "@/lib/wager";

export const dynamic = "force-dynamic";

export interface WalletLedgerEntry {
  id: string;
  type: "deposit" | "withdrawal" | "win" | "cashout" | "stake" | "adjustment";
  title: string;
  subtitle: string;
  amount: number; // positif = crédit, négatif = débit
  status: string;
  canCancel?: boolean;
  rawId?: number;
  createdAt: string;
}

function round2(n: number): number {
  return roundEurPivot(n);
}

const METHOD_LABELS: Record<string, string> = {
  iban: "Virement SEPA",
  paypal: "PayPal",
  card: "Carte bancaire",
  mobile_money: "Mobile Money",
  sepa: "Virement SEPA",
};

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;

  await syncAllSettlementsThrottled();

  const [
    eligibility,
    depRows,
    wdRows,
    sportRows,
    predRows,
    comboRows,
    tapRows,
    accelRows,
    adjRows,
    depositTotals,
    withdrawalTotals,
  ] = await Promise.all([
    computeWithdrawalEligibility(uid),
    db
      .select({
        id: deposits.id,
        provider: deposits.provider,
        providerRef: deposits.providerRef,
        amount: deposits.amount,
        status: deposits.status,
        createdAt: deposits.createdAt,
      })
      .from(deposits)
      .where(eq(deposits.userId, uid))
      .orderBy(desc(deposits.createdAt))
      .limit(35),
    db
      .select({
        id: withdrawals.id,
        method: withdrawals.method,
        destination: withdrawals.destination,
        status: withdrawals.status,
        adminNote: withdrawals.adminNote,
        amount: withdrawals.amount,
        createdAt: withdrawals.createdAt,
      })
      .from(withdrawals)
      .where(eq(withdrawals.userId, uid))
      .orderBy(desc(withdrawals.createdAt))
      .limit(35),
    db
      .select({
        id: bets.id,
        market: bets.market,
        selection: bets.selection,
        homeTeam: bets.homeTeam,
        awayTeam: bets.awayTeam,
        selectionLabel: bets.selectionLabel,
        odds: bets.odds,
        stake: bets.stake,
        status: bets.status,
        placedAt: bets.placedAt,
        settledAt: bets.settledAt,
        potentialWin: bets.potentialWin,
        cashOutAmount: bets.cashOutAmount,
      })
      .from(bets)
      .where(eq(bets.userId, uid))
      .orderBy(desc(bets.placedAt))
      .limit(30),
    db
      .select({
        id: predictionBets.id,
        question: predictionBets.question,
        selectionLabel: predictionBets.selectionLabel,
        stake: predictionBets.stake,
        status: predictionBets.status,
        placedAt: predictionBets.placedAt,
        settledAt: predictionBets.settledAt,
        potentialWin: predictionBets.potentialWin,
        cashOutAmount: predictionBets.cashOutAmount,
      })
      .from(predictionBets)
      .where(eq(predictionBets.userId, uid))
      .orderBy(desc(predictionBets.placedAt))
      .limit(30),
    db
      .select({
        id: comboBets.id,
        totalOdds: comboBets.totalOdds,
        stake: comboBets.stake,
        status: comboBets.status,
        placedAt: comboBets.placedAt,
        settledAt: comboBets.settledAt,
        potentialWin: comboBets.potentialWin,
        cashOutAmount: comboBets.cashOutAmount,
        legCount: sql<number>`case when jsonb_typeof(${comboBets.legs}) = 'array' then jsonb_array_length(${comboBets.legs}) else 0 end`,
      })
      .from(comboBets)
      .where(eq(comboBets.userId, uid))
      .orderBy(desc(comboBets.placedAt))
      .limit(30),
    db
      .select({
        id: tapHistory.id,
        win: tapHistory.win,
        betAmount: tapHistory.betAmount,
        targetMultiplier: tapHistory.targetMultiplier,
        crashMultiplier: tapHistory.crashMultiplier,
        createdAt: tapHistory.createdAt,
      })
      .from(tapHistory)
      .where(eq(tapHistory.userId, uid))
      .orderBy(desc(tapHistory.createdAt))
      .limit(25),
    db
      .select({
        id: acceleratorRounds.id,
        status: acceleratorRounds.status,
        cashoutMultiplier: acceleratorRounds.cashoutMultiplier,
        betAmount: acceleratorRounds.betAmount,
        crashPoint: acceleratorRounds.crashPoint,
        endedAt: acceleratorRounds.endedAt,
        createdAt: acceleratorRounds.createdAt,
      })
      .from(acceleratorRounds)
      .where(eq(acceleratorRounds.userId, uid))
      .orderBy(desc(acceleratorRounds.createdAt))
      .limit(25),
    db
      .select({
        id: walletAdjustments.id,
        amount: walletAdjustments.amount,
        reason: walletAdjustments.reason,
        createdAt: walletAdjustments.createdAt,
      })
      .from(walletAdjustments)
      .where(eq(walletAdjustments.userId, uid))
      .orderBy(desc(walletAdjustments.createdAt))
      .limit(20),
    db.select({
      deposited: sql<number>`coalesce(sum(${deposits.amount}) filter (where ${deposits.status} in ('credited', 'paid')), 0)`,
      pending: sql<number>`coalesce(sum(${deposits.amount}) filter (where ${deposits.status} = 'pending_review'), 0)`,
    }).from(deposits).where(eq(deposits.userId, uid)),
    db.select({
      withdrawn: sql<number>`coalesce(sum(${withdrawals.amount}) filter (where ${withdrawals.status} = 'approved'), 0)`,
      pending: sql<number>`coalesce(sum(${withdrawals.amount}) filter (where ${withdrawals.status} = 'pending'), 0)`,
    }).from(withdrawals).where(eq(withdrawals.userId, uid)),
  ]);

  const entries: WalletLedgerEntry[] = [];

  // 1. Dépôts (Stripe, PayPal, Mobile Money, Virement)
  for (const d of depRows) {
    if (d.status === "failed" || d.status === "expired") continue;
    const providerLabel =
      d.provider === "paypal"
        ? "PayPal"
        : d.provider === "mobile_money"
          ? "Mobile Money"
          : d.provider === "sepa"
            ? "Virement SEPA"
            : "Carte Stripe";
    const sub =
      d.status === "credited" || d.status === "paid"
        ? "Crédité sur le solde"
        : d.status === "rejected"
          ? `Refusé · Réf. ${d.providerRef}`
          : `En attente de validation · ${d.providerRef}`;
    entries.push({
      id: `dep-${d.id}`,
      type: "deposit",
      title: `Dépôt ${providerLabel}`,
      subtitle: sub,
      amount: d.status === "rejected" ? 0 : round2(d.amount),
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    });
  }

  // 2. Retraits
  for (const w of wdRows) {
    const methodLabel = METHOD_LABELS[w.method] ?? w.method.toUpperCase();
    const statusText =
      w.status === "pending"
        ? `En attente · ${w.destination}`
        : w.status === "approved"
          ? `Envoyé · ${w.destination}`
          : w.status === "rejected"
            ? `Refusé (remboursé)${w.adminNote ? ` · ${w.adminNote}` : ""}`
            : "Annulé (remboursé)";
    entries.push({
      id: `wd-${w.id}`,
      type: "withdrawal",
      title: `Retrait ${methodLabel}`,
      subtitle: statusText,
      amount: w.status === "rejected" || w.status === "cancelled" ? 0 : -round2(w.amount),
      status: w.status,
      canCancel: w.status === "pending",
      rawId: w.id,
      createdAt: w.createdAt.toISOString(),
    });
  }

  // 3. Paris sportifs : trace à la fois le débit (-Mise à placedAt) ET le crédit (+Gain/+Cash-out à settledAt)
  for (const b of sportRows) {
    const resolvedSel = isKnownMarket(b.market)
      ? (marketLabelFor(b.market, b.selection, b.homeTeam, b.awayTeam) ?? b.selectionLabel)
      : b.selectionLabel;
    entries.push({
      id: `sb-st-${b.id}`,
      type: "stake",
      title: `Mise · ${b.homeTeam} – ${b.awayTeam}`,
      subtitle: `${resolvedSel} (${b.odds.toFixed(2)})`,
      amount: -round2(b.stake),
      status: b.status,
      createdAt: b.placedAt.toISOString(),
    });
    const settledIso = (b.settledAt ?? new Date(b.placedAt.getTime() + 1_000)).toISOString();
    if (b.status === "won") {
      entries.push({
        id: `sb-win-${b.id}`,
        type: "win",
        title: `Gain · ${b.homeTeam} – ${b.awayTeam}`,
        subtitle: resolvedSel,
        amount: round2(b.potentialWin),
        status: "won",
        createdAt: settledIso,
      });
    } else if (b.status === "cashed" && b.cashOutAmount) {
      entries.push({
        id: `sb-co-${b.id}`,
        type: "cashout",
        title: `Vente du coupon · ${b.homeTeam} – ${b.awayTeam}`,
        subtitle: resolvedSel,
        amount: round2(b.cashOutAmount),
        status: "cashed",
        createdAt: settledIso,
      });
    } else if (b.status === "void") {
      entries.push({
        id: `sb-void-${b.id}`,
        type: "cashout",
        title: `Remboursement · ${b.homeTeam} – ${b.awayTeam}`,
        subtitle: resolvedSel,
        amount: round2(b.stake),
        status: "void",
        createdAt: settledIso,
      });
    }
  }

  // 4. Prédictions : débit (-Mise) + crédit éventuel (+Gain / +Vente du coupon)
  for (const p of predRows) {
    entries.push({
      id: `pb-st-${p.id}`,
      type: "stake",
      title: "Mise Prédiction",
      subtitle: `${p.question} · ${p.selectionLabel}`,
      amount: -round2(p.stake),
      status: p.status,
      createdAt: p.placedAt.toISOString(),
    });
    const settledIso = (p.settledAt ?? new Date(p.placedAt.getTime() + 1_000)).toISOString();
    if (p.status === "won") {
      entries.push({
        id: `pb-win-${p.id}`,
        type: "win",
        title: "Gain Prédiction",
        subtitle: `${p.question} · ${p.selectionLabel}`,
        amount: round2(p.potentialWin),
        status: "won",
        createdAt: settledIso,
      });
    } else if (p.status === "cashed" && p.cashOutAmount) {
      entries.push({
        id: `pb-co-${p.id}`,
        type: "cashout",
        title: "Vente du coupon · Prédiction",
        subtitle: `${p.question} · ${p.selectionLabel}`,
        amount: round2(p.cashOutAmount),
        status: "cashed",
        createdAt: settledIso,
      });
    }
  }

  // 5. Combinés : débit (-Mise) + crédit éventuel (+Gain / +Vente du coupon)
  for (const c of comboRows) {
    const legCount = c.legCount;
    entries.push({
      id: `cb-st-${c.id}`,
      type: "stake",
      title: `Mise Pari combiné (${legCount} sél.)`,
      subtitle: `Cote ${c.totalOdds.toFixed(2)}`,
      amount: -round2(c.stake),
      status: c.status,
      createdAt: c.placedAt.toISOString(),
    });
    const settledIso = (c.settledAt ?? new Date(c.placedAt.getTime() + 1_000)).toISOString();
    if (c.status === "won") {
      entries.push({
        id: `cb-win-${c.id}`,
        type: "win",
        title: `Gain Pari combiné (${legCount} sél.)`,
        subtitle: `Cote ${c.totalOdds.toFixed(2)}`,
        amount: round2(c.potentialWin),
        status: "won",
        createdAt: settledIso,
      });
    } else if (c.status === "cashed" && c.cashOutAmount) {
      entries.push({
        id: `cb-co-${c.id}`,
        type: "cashout",
        title: `Vente du coupon · Combiné (${legCount} sél.)`,
        subtitle: `Cote ${c.totalOdds.toFixed(2)}`,
        amount: round2(c.cashOutAmount),
        status: "cashed",
        createdAt: settledIso,
      });
    } else if (c.status === "void") {
      entries.push({
        id: `cb-void-${c.id}`,
        type: "cashout",
        title: `Remboursement Combiné (${legCount} sél.)`,
        subtitle: `Mise restituée`,
        amount: round2(c.stake),
        status: "void",
        createdAt: settledIso,
      });
    }
  }

  // 6. Mini-jeu Tap Win (lecture seule depuis tap_history sans toucher à /tap)
  for (const t of tapRows) {
    const netWin = t.win ? round2(t.betAmount * t.targetMultiplier - t.betAmount) : -round2(t.betAmount);
    entries.push({
      id: `tap-${t.id}`,
      type: t.win ? "win" : "stake",
      title: t.win ? "Gain Tap Win" : "Mise Tap Win",
      subtitle: `Cible ×${t.targetMultiplier.toFixed(2)} (crash ×${t.crashMultiplier.toFixed(2)})`,
      amount: netWin,
      status: t.win ? "won" : "lost",
      createdAt: t.createdAt.toISOString(),
    });
  }

  // 7. Mini-jeu Accelerator Pro (manches terminées)
  for (const a of accelRows) {
    if (a.status === "active") continue;
    const won =
      (a.status === "cashed" || a.status === "autocashed") &&
      a.cashoutMultiplier != null &&
      a.cashoutMultiplier > 1;
    const payout = won ? round2(a.betAmount * (a.cashoutMultiplier ?? 1) - a.betAmount) : -round2(a.betAmount);
    entries.push({
      id: `acc-${a.id}`,
      type: won ? "win" : "stake",
      title: won ? "Gain Accelerator" : "Mise Accelerator",
      subtitle: won
        ? `Encaissé à ×${(a.cashoutMultiplier ?? 1).toFixed(2)}`
        : `Crash à ×${a.crashPoint.toFixed(2)}`,
      amount: payout,
      status: won ? "won" : "lost",
      createdAt: (a.endedAt ?? a.createdAt).toISOString(),
    });
  }

  // 8. Ajustements administrateur
  for (const adj of adjRows) {
    entries.push({
      id: `adj-${adj.id}`,
      type: "adjustment",
      title: adj.amount >= 0 ? "Crédit administrateur" : "Ajustement administrateur",
      subtitle: adj.reason,
      amount: round2(adj.amount),
      status: "credited",
      createdAt: adj.createdAt.toISOString(),
    });
  }

  entries.sort((a, b) =>
    a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1
  );

  // Ces totaux couvrent tout l'historique, et non uniquement les 35 dernières lignes.
  const totalDeposited = round2(Number(depositTotals[0]?.deposited ?? 0));
  const totalWithdrawn = round2(Number(withdrawalTotals[0]?.withdrawn ?? 0));
  const pendingWithdrawals = round2(Number(withdrawalTotals[0]?.pending ?? 0));
  const pendingDeposits = round2(Number(depositTotals[0]?.pending ?? 0));

  return jsonWithEtag(req, {
    balance: eligibility.balance,
    summary: {
      totalDeposited,
      totalWithdrawn,
      pendingWithdrawals,
      pendingDeposits,
      withdrawable: eligibility.withdrawable,
      bonusLocked: eligibility.bonusLocked,
      qualifiedWagered: eligibility.qualifiedWagered,
      bonusRemaining: eligibility.bonusRemaining,
    },
    entries: entries.slice(0, 60),
  });
}
