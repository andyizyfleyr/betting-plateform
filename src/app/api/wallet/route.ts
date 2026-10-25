import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  appUser,
  bets,
  comboBets,
  deposits,
  predictionBets,
  withdrawals,
} from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { settlePendingCombos } from "@/lib/combo";
import { settleResolvedQuestions } from "@/lib/predictions";
import { getAuthUserId } from "@/lib/session";
import { settleFinishedBets } from "@/lib/settle";

export const dynamic = "force-dynamic";

export interface WalletLedgerEntry {
  id: string;
  type: "deposit" | "withdrawal" | "win" | "cashout" | "stake";
  title: string;
  subtitle: string;
  amount: number; // positif = crédit, négatif = débit
  status: string;
  canCancel?: boolean;
  rawId?: number;
  createdAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const METHOD_LABELS: Record<string, string> = {
  iban: "Virement SEPA",
  paypal: "PayPal",
  card: "Carte bancaire",
};

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  await Promise.all([
    settleFinishedBets(),
    settleResolvedQuestions(),
    settlePendingCombos(),
  ]);

  const [[user], depRows, wdRows, sportRows, predRows, comboRows] = await Promise.all([
    db.select({ balance: appUser.balance }).from(appUser).where(eq(appUser.id, uid)),
    db
      .select()
      .from(deposits)
      .where(eq(deposits.userId, uid))
      .orderBy(desc(deposits.createdAt))
      .limit(30),
    db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, uid))
      .orderBy(desc(withdrawals.createdAt))
      .limit(30),
    db
      .select()
      .from(bets)
      .where(eq(bets.userId, uid))
      .orderBy(desc(bets.placedAt))
      .limit(25),
    db
      .select()
      .from(predictionBets)
      .where(eq(predictionBets.userId, uid))
      .orderBy(desc(predictionBets.placedAt))
      .limit(25),
    db
      .select()
      .from(comboBets)
      .where(eq(comboBets.userId, uid))
      .orderBy(desc(comboBets.placedAt))
      .limit(25),
  ]);

  const entries: WalletLedgerEntry[] = [];

  for (const d of depRows) {
    if (d.status !== "credited" && d.status !== "paid" && d.status !== "pending") continue;
    entries.push({
      id: `dep-${d.id}`,
      type: "deposit",
      title: `Dépôt ${d.provider === "paypal" ? "PayPal" : "Carte Stripe"}`,
      subtitle: d.status === "credited" ? "Crédité sur le solde" : "En cours de validation",
      amount: round2(d.amount),
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    });
  }

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

  for (const b of sportRows) {
    if (b.status === "won") {
      entries.push({
        id: `sb-win-${b.id}`,
        type: "win",
        title: `Gain · ${b.homeTeam} – ${b.awayTeam}`,
        subtitle: b.selectionLabel,
        amount: round2(b.potentialWin),
        status: "won",
        createdAt: b.placedAt.toISOString(),
      });
    } else if (b.status === "cashed" && b.cashOutAmount) {
      entries.push({
        id: `sb-co-${b.id}`,
        type: "cashout",
        title: `Cash-out · ${b.homeTeam} – ${b.awayTeam}`,
        subtitle: b.selectionLabel,
        amount: round2(b.cashOutAmount),
        status: "cashed",
        createdAt: b.placedAt.toISOString(),
      });
    } else {
      entries.push({
        id: `sb-st-${b.id}`,
        type: "stake",
        title: `Mise · ${b.homeTeam} – ${b.awayTeam}`,
        subtitle: b.selectionLabel,
        amount: -round2(b.stake),
        status: b.status,
        createdAt: b.placedAt.toISOString(),
      });
    }
  }

  for (const p of predRows) {
    if (p.status === "won") {
      entries.push({
        id: `pb-win-${p.id}`,
        type: "win",
        title: "Gain Prédiction",
        subtitle: `${p.question} · ${p.selectionLabel}`,
        amount: round2(p.potentialWin),
        status: "won",
        createdAt: p.placedAt.toISOString(),
      });
    } else if (p.status === "cashed" && p.cashOutAmount) {
      entries.push({
        id: `pb-co-${p.id}`,
        type: "cashout",
        title: "Cash-out Prédiction",
        subtitle: `${p.question} · ${p.selectionLabel}`,
        amount: round2(p.cashOutAmount),
        status: "cashed",
        createdAt: p.placedAt.toISOString(),
      });
    } else {
      entries.push({
        id: `pb-st-${p.id}`,
        type: "stake",
        title: "Mise Prédiction",
        subtitle: `${p.question} · ${p.selectionLabel}`,
        amount: -round2(p.stake),
        status: p.status,
        createdAt: p.placedAt.toISOString(),
      });
    }
  }

  for (const c of comboRows) {
    const legCount = (c.legs ?? []).length;
    if (c.status === "won") {
      entries.push({
        id: `cb-win-${c.id}`,
        type: "win",
        title: `Gain Combiné (${legCount} sél.)`,
        subtitle: `Cote ${c.totalOdds.toFixed(2)}`,
        amount: round2(c.potentialWin),
        status: "won",
        createdAt: c.placedAt.toISOString(),
      });
    } else if (c.status === "cashed" && c.cashOutAmount) {
      entries.push({
        id: `cb-co-${c.id}`,
        type: "cashout",
        title: `Cash-out Combiné (${legCount} sél.)`,
        subtitle: `Cote ${c.totalOdds.toFixed(2)}`,
        amount: round2(c.cashOutAmount),
        status: "cashed",
        createdAt: c.placedAt.toISOString(),
      });
    } else {
      entries.push({
        id: `cb-st-${c.id}`,
        type: "stake",
        title: `Mise Combiné (${legCount} sél.)`,
        subtitle: `Cote ${c.totalOdds.toFixed(2)}`,
        amount: -round2(c.stake),
        status: c.status,
        createdAt: c.placedAt.toISOString(),
      });
    }
  }

  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalDeposited = round2(
    depRows.filter((d) => d.status === "credited").reduce((s, d) => s + d.amount, 0)
  );
  const totalWithdrawn = round2(
    wdRows.filter((w) => w.status === "approved").reduce((s, w) => s + w.amount, 0)
  );
  const pendingWithdrawals = round2(
    wdRows.filter((w) => w.status === "pending").reduce((s, w) => s + w.amount, 0)
  );

  return NextResponse.json({
    balance: user?.balance ?? 0,
    summary: {
      totalDeposited,
      totalWithdrawn,
      pendingWithdrawals,
    },
    withdrawals: wdRows,
    entries: entries.slice(0, 45),
  });
}
