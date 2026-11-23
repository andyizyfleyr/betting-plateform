import {
  getCurrencyRatesSettings,
  getAdminSetting,
  type CurrencyPresetsSettings,
} from "@/lib/admin-settings";
import { setCurrencyPresetOverrides, setCurrencyRateOverrides } from "@/lib/countries";

/**
 * Module serveur : applique les overrides admin (taux de change + paliers par devise)
 * dans le cache en mémoire de `countries.ts`. Aucun import DB dans `countries.ts`
 * (qui est côté client) — l'application des overrides passe par ce module serveur
 * et par le endpoint public `/api/config` côté client.
 */

let applied = false;

/** Applique les taux + paliers admin dans le cache devises (1 requête par clé, cache admin). */
export async function applyCurrencyAdminOverrides(): Promise<void> {
  const [rates, presetsRaw] = await Promise.all([
    getCurrencyRatesSettings(),
    getAdminSetting("currency_presets"),
  ]);
  setCurrencyRateOverrides(rates.rates);
  setCurrencyPresetOverrides(
    (presetsRaw as unknown as CurrencyPresetsSettings).presets ?? {}
  );
  applied = true;
}

/** Applique immédiatement (sans garde-fou) — utilisé après un save admin. */
export async function refreshCurrencyAdminOverrides(): Promise<void> {
  await applyCurrencyAdminOverrides();
}

export function hasCurrencyOverridesApplied(): boolean {
  return applied;
}
