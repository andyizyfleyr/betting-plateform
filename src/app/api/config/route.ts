import { NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import {
  getCurrencyRatesSettings,
  getAdminSetting,
  getBrandingSettings,
  type CurrencyPresetsSettings,
} from "@/lib/admin-settings";
import {
  getCurrencyOverrides,
  setCurrencyPresetOverrides,
  setCurrencyRateOverrides,
} from "@/lib/countries";

export const dynamic = "force-dynamic";

/**
 * GET /api/config — Configuration publique côté client (taux de change + paliers devises).
 *
 * Le client l'appelle une fois au démarrage et applique les overrides dans le cache
 * en mémoire de `countries.ts` via `setCurrencyRateOverrides` / `setCurrencyPresetOverrides`.
 * Aucune donnée sensible : seules les valeurs admin configurées pour l'affichage joueur.
 * Cache Edge court (60 s) : les changements admin apparaissent sans redéploiement.
 */
export async function GET() {
  try {
    await ensureSeeded();
    const [rates, presetsRaw, branding] = await Promise.all([
      getCurrencyRatesSettings(),
      getAdminSetting("currency_presets"),
      getBrandingSettings(),
    ]);
    const presets =
      (presetsRaw as unknown as CurrencyPresetsSettings).presets ?? {};

    // Applique aussi côté serveur (hot path) pour que les calculs serveur utilisent les overrides.
    setCurrencyRateOverrides(rates.rates);
    setCurrencyPresetOverrides(presets);

    return NextResponse.json(
      {
        currencyRates: rates.rates,
        currencyPresets: presets,
        branding,
      },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } }
    );
  } catch (err) {
    // Repli sûr : le client garde les defaults statiques.
    const current = getCurrencyOverrides();
    return NextResponse.json(
      {
        currencyRates: current.rates,
        currencyPresets: current.presets,
        degraded: true,
      },
      { headers: { "Cache-Control": "public, max-age=30" } }
    );
  }
}
