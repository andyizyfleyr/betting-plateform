import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { requireUserId } from "@/lib/session";
import { capturePayPalOrder, creditDeposit } from "@/lib/payments";
import { publicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const auth = await requireUserId(req);
  if (typeof auth !== "number") return auth;
  const uid = auth;

  let body: { orderId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const orderId = body.orderId;
  if (!orderId) {
    return NextResponse.json({ error: "Commande manquante" }, { status: 400 });
  }

  const captured = await capturePayPalOrder(orderId);
  if (!captured) {
    return NextResponse.json({ error: "Le paiement n'a pas été confirmé" }, { status: 400 });
  }

  await creditDeposit("paypal", orderId, uid);

  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  return NextResponse.json({ user: user ? publicUser(user) : null });
}