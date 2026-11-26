import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSettings } from "@/db/schema";

// Ré-exporte tout du module PURE (types, defaults, catalog, cache sync) afin que
// les fichiers serveur puissent importer depuis ce seul point. Ce module est
// server-only : il importe @/db (pg) statiquement et n'est jamais consommé par
// du code client (markets.ts / payments.ts utilisent getAdminSettingSync depuis
// le module pure).
export * from "@/lib/admin-settings";

import {
  ADMIN_SETTINGS_CATALOG,
  settingsCache,
  settingsAllCache,
  cachedOrDefault,
  setSettingsAllCache,
  DEFAULT_COMBO_BOOST,
  DEFAULT_MARKET_MARGINS,
  DEFAULT_CASHOUT,
  DEFAULT_WELCOME_BONUS,
  DEFAULT_PAYMENTS,
  DEFAULT_CURRENCY_RATES,
  DEFAULT_MARKETS_CATALOG,
  DEFAULT_VIRTUAL_SIMULATOR,
  DEFAULT_BRANDING,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SECURITY,
  DEFAULT_PLAYERS,
  type AdminSettingKey,
} from "@/lib/admin-settings";

const SETTINGS_CACHE_TTL_MS = 30_000;

/**
 * Lecture tolérante avec cache : retourne la valeur sauvegardée, sinon le default.
 * Réchauffe le cache pour les lectures sync (cotes, marges…).
 */
export async function getAdminSetting<K extends AdminSettingKey>(
  key: K
): Promise<Record<string, unknown>> {
  // Si le cache est déjà chaudée (même avec la valeur default), on sert sans DB.
  if (settingsCache.has(key)) {
    return cachedOrDefault(key);
  }
  let row: { value: unknown } | undefined;
  try {
    [row] = await db
      .select({ value: adminSettings.value })
      .from(adminSettings)
      .where(eq(adminSettings.settingKey, key))
      .limit(1);
  } catch {
    // Base momentanément injoignable (build, réveil de l'instance, coupure) :
    // on sert la valeur par défaut sans casser le rendu ni le prerender.
    return ADMIN_SETTINGS_CATALOG[key].default as Record<string, unknown>;
  }
  const value: Record<string, unknown> =
    row?.value && typeof row.value === "object"
      ? (row.value as Record<string, unknown>)
      : (ADMIN_SETTINGS_CATALOG[key].default as Record<string, unknown>);
  settingsCache.set(key, { at: Date.now(), value });
  return value;
}

/** Écriture atomique (upsert) avec validation de structure + rafraîchir le cache. */
export async function saveAdminSetting<K extends AdminSettingKey>(
  key: K,
  value: Record<string, unknown>
): Promise<void> {
  if (!ADMIN_SETTINGS_CATALOG[key].validate(value)) {
    throw new Error(`Paramètre invalide : ${key}`);
  }
  await db
    .insert(adminSettings)
    .values({ settingKey: key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: adminSettings.settingKey,
      set: { value, updatedAt: new Date() },
    });
  settingsCache.set(key, { at: Date.now(), value });
  setSettingsAllCache(null);
}

/** Snapshot complet pour l'admin (cache 30s). */
export async function getAllAdminSettings(): Promise<
  Record<AdminSettingKey, Record<string, unknown>>
> {
  if (
    settingsAllCache &&
    Date.now() - settingsAllCache.at < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsAllCache.value;
  }
  const rows = await db.select().from(adminSettings);
  const map = new Map(rows.map((r) => [r.settingKey, r.value as Record<string, unknown>]));
  const result = {} as Record<AdminSettingKey, Record<string, unknown>>;
  (Object.keys(ADMIN_SETTINGS_CATALOG) as AdminSettingKey[]).forEach((key) => {
    result[key] = map.get(key) ?? ADMIN_SETTINGS_CATALOG[key].default;
  });
  setSettingsAllCache({ at: Date.now(), value: result });
  return result;
}

/**
 * Réchauffe le cache de toutes les clés (1 requête SQL par clé, ~13 clés).
 * Appelé par le housekeeping du sync-throttle (toutes les 5 min) et au démarrage
 * pour garantir que les lectures sync (cotes, marges…) utilisent les réglages
 * admin sans persistance stale.
 */
export async function warmAdminSettingsCache(): Promise<void> {
  const keys = Object.keys(ADMIN_SETTINGS_CATALOG) as AdminSettingKey[];
  await Promise.all(
    keys.map(async (key) => {
      if (!settingsCache.has(key)) {
        await getAdminSetting(key);
      }
    })
  );
}

/* ------------------------------------------------------------------ */
/* Helpers de type pour les libs consommatrices (server)               */
/* ------------------------------------------------------------------ */

export async function getComboBoostSettings(): Promise<import("@/lib/admin-settings").ComboBoostSettings> {
  const raw = await getAdminSetting("combo_boost");
  return { ...DEFAULT_COMBO_BOOST, ...(raw as Partial<import("@/lib/admin-settings").ComboBoostSettings>) };
}

export async function getMarketMarginSettings(): Promise<import("@/lib/admin-settings").MarketMarginSettings> {
  const raw = await getAdminSetting("market_margins");
  return { ...DEFAULT_MARKET_MARGINS, ...(raw as Partial<import("@/lib/admin-settings").MarketMarginSettings>) };
}

export async function getCashoutSettings(): Promise<import("@/lib/admin-settings").CashoutSettings> {
  const raw = await getAdminSetting("cashout");
  return { ...DEFAULT_CASHOUT, ...(raw as Partial<import("@/lib/admin-settings").CashoutSettings>) };
}

export async function getWelcomeBonusSettings(): Promise<import("@/lib/admin-settings").WelcomeBonusSettings> {
  const raw = await getAdminSetting("welcome_bonus");
  return { ...DEFAULT_WELCOME_BONUS, ...(raw as Partial<import("@/lib/admin-settings").WelcomeBonusSettings>) };
}

export async function getPaymentSettings(): Promise<import("@/lib/admin-settings").PaymentSettings> {
  const raw = await getAdminSetting("payments");
  return { ...DEFAULT_PAYMENTS, ...(raw as Partial<import("@/lib/admin-settings").PaymentSettings>) };
}

export async function getCurrencyRatesSettings(): Promise<import("@/lib/admin-settings").CurrencyRatesSettings> {
  const raw = await getAdminSetting("currency_rates");
  return { ...DEFAULT_CURRENCY_RATES, ...(raw as Partial<import("@/lib/admin-settings").CurrencyRatesSettings>) };
}

export async function getMarketsCatalogSettings(): Promise<import("@/lib/admin-settings").MarketsCatalogSettings> {
  const raw = await getAdminSetting("markets_catalog");
  return { ...DEFAULT_MARKETS_CATALOG, ...(raw as Partial<import("@/lib/admin-settings").MarketsCatalogSettings>) };
}

export async function getVirtualSimulatorSettings(): Promise<import("@/lib/admin-settings").VirtualSimulatorSettings> {
  const raw = await getAdminSetting("virtual_simulator");
  return { ...DEFAULT_VIRTUAL_SIMULATOR, ...(raw as Partial<import("@/lib/admin-settings").VirtualSimulatorSettings>) };
}

export async function getBrandingSettings(): Promise<import("@/lib/admin-settings").BrandingSettings> {
  const raw = await getAdminSetting("branding");
  return { ...DEFAULT_BRANDING, ...(raw as Partial<import("@/lib/admin-settings").BrandingSettings>) };
}

export async function getNotificationSettings(): Promise<import("@/lib/admin-settings").NotificationSettings> {
  const raw = await getAdminSetting("notifications");
  return { ...DEFAULT_NOTIFICATIONS, ...(raw as Partial<import("@/lib/admin-settings").NotificationSettings>) };
}

export async function getSecuritySettings(): Promise<import("@/lib/admin-settings").SecuritySettings> {
  const raw = await getAdminSetting("security");
  return { ...DEFAULT_SECURITY, ...(raw as Partial<import("@/lib/admin-settings").SecuritySettings>) };
}

export async function getPlayerManagementSettings(): Promise<import("@/lib/admin-settings").PlayerManagementSettings> {
  const raw = await getAdminSetting("players");
  return { ...DEFAULT_PLAYERS, ...(raw as Partial<import("@/lib/admin-settings").PlayerManagementSettings>) };
}
