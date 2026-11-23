"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import {
  ADMIN_SETTINGS_CATALOG,
  type AdminSettingKey,
} from "@/lib/admin-settings";
import { AdminInput, AdminToggle } from "@/components/admin/admin-ui";

/**
 * Onglet « Réglages » du backoffice : édition de tous les paramètres admin
 * (bonus combiné, marges, cash out, bonus, paiements, devises, marchés,
 * virtuel, branding, notifications, sécurité, joueurs) sans redéploiement.
 */

type SettingsMap = Record<AdminSettingKey, Record<string, unknown>>;

const SECTION_ORDER: AdminSettingKey[] = [
  "combo_boost",
  "market_margins",
  "cashout",
  "welcome_bonus",
  "payments",
  "currency_rates",
  "currency_presets",
  "markets_catalog",
  "virtual_simulator",
  "branding",
  "notifications",
  "security",
  "players",
];

interface SettingsTabProps {}

/**
 * Toast interne simple (le composant admin n'expose pas de `toast` global).
 */
function useToast() {
  const [msg, setMsg] = useState<{
    kind: "success" | "error";
    title: string;
    message?: string;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (m: { kind: "success" | "error"; title: string; message?: string }) => {
      setMsg(m);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 3000);
    },
    []
  );
  const node = msg ? (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-edge bg-white px-4 py-2.5 shadow-lg",
        msg.kind === "success" ? "text-emerald-700" : "text-red-600"
      )}
    >
      <p className="font-display text-[11px] font-medium">{msg.title}</p>
      {msg.message && <p className="text-[10px] text-dim">{msg.message}</p>}
    </div>
  ) : null;
  return { show, node };
}

export function SettingsTab(_: SettingsTabProps) {
  const { show, node } = useToast();
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<AdminSettingKey | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.admin.getSettings();
      if (r?.settings) {
        setSettings(r.settings as SettingsMap);
      }
    } catch {
      show({ kind: "error", title: "Impossible de charger les réglages" });
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (key: AdminSettingKey, value: Record<string, unknown>) => {
      setSavingKey(key);
      try {
        await api.admin.saveSetting(key, value);
        setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
        show({ kind: "success", title: `Réglage « ${ADMIN_SETTINGS_CATALOG[key].label} » enregistré` });
      } catch {
        show({ kind: "error", title: `Impossible d'enregistrer ${ADMIN_SETTINGS_CATALOG[key].label}` });
      } finally {
        setSavingKey(null);
      }
    },
    [show]
  );

  return (
    <div className="relative">
      {node}
      {loading || !settings ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-dim" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="glass-card rounded-2xl p-4">
            <h2 className="font-display text-[13px] font-medium text-ink">
              Réglages de la plateforme
            </h2>
            <p className="mt-1 text-[11px] text-dim">
              Éditez les paramètres fonctionnels (cotes, bonus, paiements, devises,
              branding…) sans redéploiement. Les modifications s&apos;appliquent
              instantanément côté serveur.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-700/80 px-3 text-[11px] font-medium text-white active:scale-95"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Actualiser
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {SECTION_ORDER.map((key) => (
              <SettingsSection
                key={key}
                keyName={key}
                value={settings[key]}
                saving={savingKey === key}
                onSave={(v) => void save(key, v)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsSection({
  keyName,
  value,
  saving,
  onSave,
}: {
  keyName: AdminSettingKey;
  value: Record<string, unknown>;
  saving: boolean;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const meta = ADMIN_SETTINGS_CATALOG[keyName];
  // Clone local mutable du réglage (pour éditer sans toucher au state global).
  const [draft, setDraft] = useState<Record<string, unknown>>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const set = (k: string, v: unknown) => {
    setDraft((prev) => ({ ...prev, [k]: v }));
  };

  const isToggleField = (k: string): boolean => {
    const v = draft[k];
    return typeof v === "boolean";
  };

  const isNumberField = (k: string): boolean => {
    const v = draft[k];
    return typeof v === "number";
  };

  const isArrayField = (k: string): boolean => Array.isArray(draft[k]);
  const isStringField = (k: string): boolean => typeof draft[k] === "string";

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[12.5px] font-medium text-ink">
          {meta.label}
        </h3>
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 font-display text-[10.5px] font-medium text-white active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Enregistrer
        </button>
      </div>
      <p className="mt-1 text-[10.5px] text-dim">{meta.description}</p>

      <div className="mt-3 flex flex-col gap-2.5">
        {Object.entries(draft).map(([k, v]) => {
          // Skip nested objects (tiers, tiers array, markets, etc.) — handled specially.
          if (v && typeof v === "object" && !Array.isArray(v)) {
            return null;
          }
          if (isToggleField(k)) {
            return (
              <div key={k} className="flex items-center justify-between">
                <label className="text-[11px] text-ink">{humanizeKey(k)}</label>
                <AdminToggle
                  checked={Boolean(v)}
                  onChange={(b) => set(k, b)}
                />
              </div>
            );
          }
          if (isNumberField(k)) {
            return (
              <div key={k} className="flex flex-col gap-1">
                <label className="text-[11px] text-ink">{humanizeKey(k)}</label>
                <AdminInput
                  type="text"
                  inputMode="decimal"
                  value={String(v ?? "")}
                  onChange={(s) => set(k, s === "" ? "" : Number(s))}
                />
              </div>
            );
          }
          if (isArrayField(k)) {
            return (
              <ArrayFieldEditor
                key={k}
                label={humanizeKey(k)}
                array={v as unknown[]}
                onChange={(arr) => set(k, arr)}
              />
            );
          }
          if (isStringField(k)) {
            return (
              <div key={k} className="flex flex-col gap-1">
                <label className="text-[11px] text-ink">{humanizeKey(k)}</label>
                <AdminInput
                  type="text"
                  value={String(v ?? "")}
                  onChange={(s) => set(k, s)}
                />
              </div>
            );
          }
          return null;
        })}

        {/* Sécurité : champs spécialisés */}
        {keyName === "security" && (
          <SecurityFields draft={draft} set={set} />
        )}
        {/* Payments : méthodes actives */}
        {keyName === "payments" && (
          <PaymentsFields draft={draft} set={set} />
        )}
      </div>
    </div>
  );
}

function SecurityFields({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <div className="mt-1 rounded-xl border border-edge bg-slate-50/50 p-3">
      <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">
        Mot de passe & sessions
      </p>
      <div className="flex flex-col gap-2.5">
        <NumberRow label="Longueur min du mot de passe" keyName="minPasswordLength" value={draft.minPasswordLength} onChange={set} />
        <ToggleRow label="Majuscule obligatoire" keyName="requireMixedCase" value={draft.requireMixedCase} onChange={set} />
        <ToggleRow label="Chiffre obligatoire" keyName="requireDigit" value={draft.requireDigit} onChange={set} />
        <NumberRow label="Longueur max du mot de passe" keyName="maxPasswordLength" value={draft.maxPasswordLength} onChange={set} />
        <NumberRow label="Tentatives de connexion max" keyName="maxLoginAttempts" value={draft.maxLoginAttempts} onChange={set} />
        <NumberRow label="Durée de session (heures)" keyName="sessionTimeoutHours" value={draft.sessionTimeoutHours} onChange={set} />
        <ToggleRow label="2FA obligatoire" keyName="require2FA" value={draft.require2FA} onChange={set} />
      </div>
    </div>
  );
}

function PaymentsFields({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  const methods = draft.enabledMethods as string[];
  const allMethods = ["stripe", "paypal", "mobile_money", "sepa", "gift_card"];
  return (
    <div className="mt-1 rounded-xl border border-edge bg-slate-50/50 p-3">
      <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">
        Méthodes de paiement actives
      </p>
      <div className="flex flex-wrap gap-2">
        {allMethods.map((m) => {
          const active = methods.includes(m);
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                const next = active
                  ? methods.filter((x) => x !== m)
                  : [...methods, m];
                set("enabledMethods", next);
              }}
              className={cn(
                "h-8 rounded-lg px-3 font-display text-[10.5px] font-medium active:scale-95",
                active
                  ? "bg-emerald-600/12 text-emerald-700"
                  : "bg-slate-200 text-slate-500"
              )}
            >
              {m}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberRow({
  label,
  keyName,
  value,
  onChange,
}: {
  label: string;
  keyName: string;
  value: unknown;
  onChange: (k: string, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-ink">{label}</label>
      <AdminInput
        type="text"
        inputMode="decimal"
        value={String(value ?? "")}
        onChange={(s) => onChange(keyName, s === "" ? "" : Number(s))}
      />
    </div>
  );
}

function ToggleRow({
  label,
  keyName,
  value,
  onChange,
}: {
  label: string;
  keyName: string;
  value: unknown;
  onChange: (k: string, v: unknown) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-[11px] text-ink">{label}</label>
      <AdminToggle checked={Boolean(value)} onChange={(b) => onChange(keyName, b)} />
    </div>
  );
}

function ArrayFieldEditor({
  label,
  array,
  onChange,
}: {
  label: string;
  array: unknown[];
  onChange: (arr: unknown[]) => void;
}) {
  const [text, setText] = useState(array.map((x) => String(x)).join(", "));
  useEffect(() => {
    setText(array.map((x) => String(x)).join(", "));
  }, [array]);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-ink">{label}</label>
      <AdminInput
        type="text"
        value={text}
        placeholder="val1, val2, val3…"
        onChange={(s) => setText(s)}
      />
      <button
        type="button"
        onClick={() => {
          const arr = text
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x));
          onChange(arr);
        }}
        className="mt-1 h-8 rounded-lg bg-slate-700/80 px-3 font-display text-[10.5px] font-medium text-white active:scale-95"
      >
        Appliquer
      </button>
    </div>
  );
}

function humanizeKey(k: string): string {
  const map: Record<string, string> = {
    minEligibleOdds: "Cote min éligible au bonus",
    tiers: "Paliers de bonus",
    default: "Marge par défaut (%)",
    markets: "Marges par marché",
    enabled: "Activé",
    baseFactor: "Facteur de base Cash Out",
    maxCapPct: "Plafond Cash Out (%)",
    minMinute: "Minute min",
    maxMinute: "Minute max",
    disabledMarkets: "Marchés exclus",
    disabledMatchIds: "Matchs exclus",
    amount: "Montant du bonus (€)",
    wagerMultiplier: "Wager (×)",
    minOddsSingle: "Cote min simple",
    minOddsCombo: "Cote min combiné",
    validityDays: "Validité (jours)",
    enabledMethods: "Méthodes actives",
    mobileMoneyAccounts: "Comptes Mobile Money",
    fees: "Frais par méthode",
    minMax: "Seuils par méthode",
    rates: "Taux (1 EUR = …)",
    presets: "Paliers par devise",
    activeMarkets: "Marchés actifs",
    activeLeagues: "Ligues actives",
    maxLive: "Matchs live simultanés",
    kickoffGapMs: "Écart coups d'envoi (ms)",
    siteName: "Nom du site",
    shortName: "Nom court",
    tagline: "Slogan",
    heroTitle: "Titre hero",
    heroSubtitle: "Sous-titre hero",
    primaryColor: "Couleur principale",
    banners: "Bannières promo",
    categories: "Catégories actives",
    pushSubjectPrefix: "Préfixe push",
    emailFooter: "Footer e-mail",
    minPasswordLength: "Longueur min mot de passe",
    requireMixedCase: "Majuscule obligatoire",
    requireDigit: "Chiffre obligatoire",
    maxPasswordLength: "Longueur max mot de passe",
    transferCodesEnabled: "Codes de transfert",
    transferCodeMinAmount: "Montant min transfert",
    transferCodeMaxAmount: "Montant max transfert",
    transferCodeTtlMinutes: "Durée code transfert (min)",
    maxLoginAttempts: "Tentatives de connexion max",
    sessionTimeoutHours: "Durée session (h)",
    require2FA: "2FA obligatoire",
    defaultManualStakeLimit: "Plafond manuel par défaut",
    vipThresholdNetProfit: "Seuil VIP (profit net)",
  };
  return map[k] ?? k;
}
