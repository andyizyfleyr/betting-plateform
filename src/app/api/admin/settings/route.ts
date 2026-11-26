import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { clearAuthCookie, getAuthUserId } from "@/lib/session";
import {
  getAllAdminSettings,
  saveAdminSetting,
  invalidateAdminSettingsCache,
  ADMIN_SETTINGS_CATALOG,
  RETIRED_MARKETS,
  type AdminSettingKey,
} from "@/lib/admin-settings-server";
import {
  applyCurrencyAdminOverrides,
  refreshCurrencyAdminOverrides,
} from "@/lib/currency-admin";

export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest): Promise<number | NextResponse> {
  await ensureSeeded();
  const uid = await getAuthUserId(req);
  if (!uid) {
    const res = NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    clearAuthCookie(res);
    return res;
  }
  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user || (user.role ?? "user") !== "admin") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  return uid;
}

/**
 * GET /api/admin/settings — Snapshot complet des réglages admin.
 * GET /api/admin/settings?key=cashout — Lecture d'une seule clé.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireAdmin(req);
    if (typeof auth !== "number") return auth;

    const keyParam = req.nextUrl.searchParams.get("key");
    if (keyParam && keyParam in ADMIN_SETTINGS_CATALOG) {
      const all = await getAllAdminSettings();
      return NextResponse.json({ settings: all[keyParam as AdminSettingKey] });
    }
    const all = await getAllAdminSettings();
    const catalog = Object.fromEntries(
      Object.entries(ADMIN_SETTINGS_CATALOG).map(([k, v]) => [
        k,
        { label: v.label, description: v.description },
      ])
    );
    return NextResponse.json({ settings: all, catalog });
  } catch (err) {
    return NextResponse.json(
      { error: "Impossible de charger les réglages" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/settings
 * Corps : { key: "cashout", value: {...} }
 * Sauvegarde un paramètre, invalide le cache et rafraîchit les overrides devises.
 */
export async function PUT(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireAdmin(req);
    if (typeof auth !== "number") return auth;

    const body = await req.json();
    const key = String(body.key ?? "");
    if (!(key in ADMIN_SETTINGS_CATALOG)) {
      return NextResponse.json({ error: "Clé de réglage inconnue" }, { status: 400 });
    }
    const value = body.value;
    if (!value || typeof value !== "object") {
      return NextResponse.json({ error: "Valeur invalide" }, { status: 400 });
    }
    // Marchés retirés : jamais réactivables, même via une requête forgée.
    if (key === "markets_catalog" && Array.isArray((value as { activeMarkets?: unknown }).activeMarkets)) {
      (value as { activeMarkets: string[] }).activeMarkets = (
        (value as { activeMarkets: string[] }).activeMarkets
      ).filter((m) => !RETIRED_MARKETS.includes(m));
    }
    await saveAdminSetting(key as AdminSettingKey, value);
    invalidateAdminSettingsCache();
    // Rafraîchit immédiatement les overrides devises (taux + paliers).
    await refreshCurrencyAdminOverrides().catch(() => undefined);
    return NextResponse.json({ ok: true, key, value });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * POST /api/admin/settings/warm
 * Réchauffe le cache des réglages (utile après un déploiement).
 */
export async function POST() {
  try {
    await ensureSeeded();
    await applyCurrencyAdminOverrides();
    invalidateAdminSettingsCache();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Impossible de réchauffer" }, { status: 500 });
  }
}
