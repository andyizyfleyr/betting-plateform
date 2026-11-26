"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, RotateCcw, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import {
  ADMIN_SETTINGS_CATALOG,
  RETIRED_MARKETS,
  type AdminSettingKey,
} from "@/lib/admin-settings";
import { AdminInput, AdminToggle } from "@/components/admin/admin-ui";

/**
 * Onglet « Réglages » du backoffice : édition de tous les paramètres admin
 * (bonus combiné, marges, cash out, bonus, paiements, devises, marchés,
 * virtuel, branding, notifications, sécurité, joueurs) sans redéploiement.
 *
 * Structure : sections thématiques (groupées), chaque réglage dans une carte
 * avec des éditeurs spécialisés et des labels humains (avec unités).
 */

type SettingsMap = Record<AdminSettingKey, Record<string, unknown>>;

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Groupes thématiques — l'ordre d'affichage des sections                    */
/* ─────────────────────────────────────────────────────────────────────────── */

const GROUPS: { title: string; description: string; keys: AdminSettingKey[] }[] = [
  {
    title: "Paris & gains",
    description: "Bonus, marges du bookmaker et cash out",
    keys: ["combo_boost", "market_margins", "cashout"],
  },
  {
    title: "Bonus & offres",
    description: "Bonus de bienvenue et moyens de paiement",
    keys: ["welcome_bonus", "payments"],
  },
  {
    title: "Devises & marchés",
    description: "Taux de change, paliers par devise et catalogue des marchés",
    keys: ["currency_rates", "currency_presets", "markets_catalog"],
  },
  {
    title: "Simulateur & contenu",
    description: "Simulateur virtuel, branding et notifications",
    keys: ["virtual_simulator", "branding", "notifications"],
  },
  {
    title: "Sécurité & gestion",
    description: "Sécurité des comptes et gestion des joueurs",
    keys: ["security", "players"],
  },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Labels humains + unités                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

const FIELD_LABELS: Record<string, { label: string; unit?: string; hint?: string }> = {
  // Combo boost
  enabled: { label: "Fonctionnel", hint: "Activer ou désactiver la fonctionnalité" },
  minEligibleOdds: { label: "Cote minimale éligible", hint: "Cote minimale pour qu'un combiné touche le bonus" },
  tiers: { label: "Paliers de bonus" },
  // Margins
  default: { label: "Marge par défaut", unit: "%" },
  markets: { label: "Marges par type de marché", unit: "%" },
  // Cashout
  baseFactor: { label: "Facteur de base", hint: "Taux appliqué au cash out de base" },
  maxCapPct: { label: "Plafond du cash out", unit: "%", hint: "Pourcentage maximal du gain remboursable" },
  minMinute: { label: "Minute minimale", unit: "min" },
  maxMinute: { label: "Minute maximale", unit: "min" },
  disabledMarkets: { label: "Marchés exclus du cash out" },
  disabledMatchIds: { label: "Matchs exclus du cash out" },
  // Welcome bonus
  amount: { label: "Montant du bonus", unit: "€" },
  wagerMultiplier: { label: "Wager", hint: "Nombre de mises à effectuer avant retrait" },
  minOddsSingle: { label: "Cote minimale · simple" },
  minOddsCombo: { label: "Cote minimale · combiné" },
  validityDays: { label: "Validité", unit: "jours" },
  // Payments
  enabledMethods: { label: "Méthodes de paiement actives" },
  mobileMoneyAccounts: { label: "Comptes Mobile Money" },
  fees: { label: "Frais par méthode", hint: "Pourcentage + montant fixe par méthode" },
  minMax: { label: "Seuils par méthode", hint: "Montant min / max par méthode" },
  // Currency
  rates: { label: "Taux de change", hint: "1 EUR = … (mis à jour manuellement)" },
  presets: { label: "Paliers par devise", hint: "Paliers rapides et bornes dépôt/retrait" },
  // Markets catalog
  activeMarkets: { label: "Marchés actifs" },
  activeLeagues: { label: "Ligues actives · codes" },
  // Virtual simulator
  maxLive: { label: "Matchs live simultanés", unit: "matchs" },
  kickoffGapMs: { label: "Écart entre coups d'envoi", unit: "ms" },
  // Branding
  siteName: { label: "Nom du site" },
  shortName: { label: "Nom court" },
  tagline: { label: "Slogan" },
  heroTitle: { label: "Titre de la bannière d'accueil" },
  heroSubtitle: { label: "Sous-titre de la bannière d'accueil" },
  primaryColor: { label: "Couleur principale", hint: "Code hexadécimal" },
  banners: { label: "Bannières promotionnelles · URLs" },
  // Notifications
  categories: { label: "Catégories de notifications actives" },
  pushSubjectPrefix: { label: "Préfixe des notifications push" },
  emailFooter: { label: "Pied de page des e-mails" },
  // Security
  minPasswordLength: { label: "Longueur minimale du mot de passe", unit: "caractères" },
  requireMixedCase: { label: "Majuscule obligatoire" },
  requireDigit: { label: "Chiffre obligatoire" },
  maxPasswordLength: { label: "Longueur maximale du mot de passe", unit: "caractères" },
  transferCodesEnabled: { label: "Codes de transfert" },
  transferCodeMinAmount: { label: "Montant minimal des codes de transfert", unit: "€" },
  transferCodeMaxAmount: { label: "Montant maximal des codes de transfert", unit: "€" },
  transferCodeTtlMinutes: { label: "Durée de vie des codes", unit: "min" },
  maxLoginAttempts: { label: "Tentatives de connexion autorisées", unit: "essais" },
  sessionTimeoutHours: { label: "Durée de session", unit: "h" },
  require2FA: { label: "Authentification à double facteur obligatoire" },
  // Players
  defaultManualStakeLimit: { label: "Plafond de mise manuel par défaut", unit: "€" },
  vipThresholdNetProfit: { label: "Seuil VIP", hint: "Profit net minimal pour atteindre le VIP", unit: "€" },
};

const MARKET_LABELS: Record<string, string> = {
  result: "1N2 (Résultat)",
  dnb: "Double chance",
  double_chance: "Double chance",
  handicap_euro: "Handicap européen",
  btts: "Plus/Moins de buts",
  odd_even: "Pair/Impair",
  total_ou: "Total buts",
  ht_total_ou: "Total 1er temps",
  ht_result: "Résultat 1er temps",
  home_total: "Total équipe à domicile",
  away_total: "Total équipe à l'extérieur",
  first_team_to_score: "Premier buteur",
  highest_scoring_half: "Mi-temps le plus golu",
  goal_range: "Plage de buts",
  result_total: "Résultat + Total",
  result_btts: "Résultat + Plus/Moins",
  winning_margin: "Marge de victoire",
  home_to_nil: "Victoire à domicile sans encaisser",
  away_to_nil: "Victoire à l'extérieur sans encaisser",
  home_clean_sheet: "Feuille propre à domicile",
  away_clean_sheet: "Feuille propre à l'extérieur",
  total_exact: "Total exact",
  ht_ft: "Score 1er temps / Dernier temps",
  score_exact: "Score exact",
};

const PAYMENT_LABELS: Record<string, string> = {
  stripe: "Carte bancaire (Stripe)",
  paypal: "PayPal",
  mobile_money: "Mobile Money",
  sepa: "Virement SEPA",
  gift_card: "Carte cadeau",
};

const NOTIFICATION_LABELS: Record<string, string> = {
  bet_won: "Paris gagnants",
  bet_lost: "Paris perdants",
  match_live: "Matchs en direct",
  payment: "Paiements",
  security: "Sécurité",
};

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Toast interne                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Composant principal                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

export function SettingsTab() {
  const { show, node } = useToast();
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<AdminSettingKey | null>(null);
  const [expanded, setExpanded] = useState<AdminSettingKey | null>(null);

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

  const grouped = useMemo(() => {
    const map = new Map<AdminSettingKey, Record<string, unknown>>();
    if (settings) for (const k of Object.keys(settings) as AdminSettingKey[]) map.set(k, settings[k]);
    return GROUPS.map((g) => ({ ...g, settings: g.keys.map((k) => ({ key: k, value: map.get(k) ?? {} })) }));
  }, [settings]);

  return (
    <div className="relative">
      {node}
      {loading || !settings ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-dim" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="glass-card rounded-2xl p-4">
            <h2 className="font-display text-[14px] font-semibold text-ink">Réglages de la plateforme</h2>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">
              Configurez tous les paramètres fonctionnels sans redéploiement. Les modifications s&apos;appliquent instantanément
              côté serveur. Chaque réglage s&apos;enregistre indépendamment.
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

          {grouped.map((group) => (
            <div key={group.title}>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="font-display text-[12px] font-semibold uppercase tracking-wider text-ink">
                  {group.title}
                </h3>
                <span className="text-[10px] text-dim">{group.description}</span>
              </div>
              <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                {group.settings.map(({ key, value }) => (
                  <SettingsCard
                    key={key}
                    keyName={key}
                    value={value}
                    saving={savingKey === key}
                    expanded={expanded === key}
                    onToggleExpand={() => setExpanded((p) => (p === key ? null : key))}
                    onSave={(v) => void save(key, v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Carte de réglage (avec dépliement pour les réglages longs)                */
/* ─────────────────────────────────────────────────────────────────────────── */

function SettingsCard({
  keyName,
  value,
  saving,
  expanded,
  onToggleExpand,
  onSave,
}: {
  keyName: AdminSettingKey;
  value: Record<string, unknown>;
  saving: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const meta = ADMIN_SETTINGS_CATALOG[keyName];
  const [draft, setDraft] = useState<Record<string, unknown>>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const set = (k: string, v: unknown) => {
    setDraft((prev) => ({ ...prev, [k]: v }));
  };

  const hasLongFields =
    keyName === "combo_boost" ||
    keyName === "market_margins" ||
    keyName === "payments" ||
    keyName === "currency_rates" ||
    keyName === "currency_presets" ||
    keyName === "markets_catalog" ||
    keyName === "security";

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-display text-[12.5px] font-semibold text-ink">{meta.label}</h4>
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={saving}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 font-display text-[10.5px] font-medium text-white active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Enregistrer
        </button>
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-dim">{meta.description}</p>

      <div className="mt-3 flex flex-col gap-3">
        <SettingsBody keyName={keyName} draft={draft} set={set} expanded={expanded} />
      </div>

      {hasLongFields && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg text-[10.5px] font-medium text-ink/70 transition-colors hover:bg-slate-100"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Réduire" : "Voir les détails"}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Corps d'un réglage : éditeurs spécialisés par type                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function SettingsBody({
  keyName,
  draft,
  set,
  expanded,
}: {
  keyName: AdminSettingKey;
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const rows = useMemo(() => {
    return Object.entries(draft).filter(([, v]) => !(v && typeof v === "object"));
  }, [draft]);

  /* Réglages avec éditeurs spécialisés (affichés en entier si déplié) */
  const hasSpecialized = [
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
  ].includes(keyName);

  if (hasSpecialized) {
    return (
      <>
        {keyName === "combo_boost" && (
          <ComboBoostEditor draft={draft} set={set} expanded={expanded} />
        )}
        {keyName === "market_margins" && (
          <MarketMarginsEditor draft={draft} set={set} expanded={expanded} />
        )}
        {keyName === "cashout" && <CashoutEditor draft={draft} set={set} />}
        {keyName === "welcome_bonus" && <WelcomeBonusEditor draft={draft} set={set} />}
        {keyName === "payments" && <PaymentsEditor draft={draft} set={set} expanded={expanded} />}
        {keyName === "currency_rates" && <CurrencyRatesEditor draft={draft} set={set} expanded={expanded} />}
        {keyName === "currency_presets" && <CurrencyPresetsEditor draft={draft} set={set} expanded={expanded} />}
        {keyName === "markets_catalog" && <MarketsCatalogEditor draft={draft} set={set} expanded={expanded} />}
        {keyName === "virtual_simulator" && <VirtualSimulatorEditor draft={draft} set={set} />}
        {keyName === "branding" && <BrandingEditor draft={draft} set={set} />}
        {keyName === "notifications" && <NotificationsEditor draft={draft} set={set} expanded={expanded} />}
        {keyName === "security" && <SecurityEditor draft={draft} set={set} expanded={expanded} />}
        {keyName === "players" && <PlayersEditor draft={draft} set={set} />}
      </>
    );
  }

  /* Réglages simples : rows génériques */
  return (
    <>
      {rows.map(([k, v]) => (
        <GenericField key={k} k={k} value={v} onChange={(val) => set(k, val)} />
      ))}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Champ générique (bool / nombre / texte / tableau)                         */
/* ─────────────────────────────────────────────────────────────────────────── */

function GenericField({
  k,
  value,
  onChange,
}: {
  k: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const meta = FIELD_LABELS[k] ?? { label: humanizeKey(k) };

  if (typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between rounded-xl border border-edge bg-elev/40 px-3 py-2.5">
        <label className="text-[11.5px] text-ink">{meta.label}</label>
        <AdminToggle checked={value} onChange={onChange} />
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-ink">
          {meta.label}{meta.unit ? ` · ${meta.unit}` : ""}
        </label>
        <AdminInput
          type="text"
          inputMode="decimal"
          value={String(value)}
          onChange={(s) => onChange(s === "" ? "" : Number(s))}
        />
        {meta.hint && <p className="text-[10px] text-dim">{meta.hint}</p>}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return <ArrayFieldEditor label={meta.label} array={value} onChange={onChange} />;
  }

  if (typeof value === "string") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-ink">{meta.label}</label>
        <AdminInput type="text" value={value} onChange={onChange} />
        {meta.hint && <p className="text-[10px] text-dim">{meta.hint}</p>}
      </div>
    );
  }

  return null;
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
    <div className="flex flex-col gap-1.5">
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
        className="h-8 self-start rounded-lg bg-slate-700/80 px-3 font-display text-[10.5px] font-medium text-white active:scale-95"
      >
        Appliquer
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Bonus combiné                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function ComboBoostEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const tiers = (draft.tiers as { legs: number; pct: number }[] | undefined) ?? [];
  return (
    <>
      <ToggleRow label="Activer le bonus combiné" value={draft.enabled as boolean} onChange={set} keyName="enabled" />
      <NumberRow label="Cote minimale éligible" value={draft.minEligibleOdds as number} onChange={set} keyName="minEligibleOdds" />
      {expanded && (
        <div className="mt-2 rounded-xl border border-edge bg-slate-50/50 p-3">
          <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">Paliers de bonus</p>
          <div className="flex flex-col gap-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-20 text-[10.5px] text-dim">{t.legs} combinés</span>
                <AdminInput
                  type="text"
                  inputMode="decimal"
                  value={String(t.pct)}
                  onChange={(s) => {
                    const next = [...tiers];
                    next[i] = { ...t, pct: s === "" ? 0 : Number(s) };
                    set("tiers", next);
                  }}
                />
                <span className="text-[10px] text-dim">% de bonus</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Marges bookmaker                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function MarketMarginsEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const markets = (draft.markets as Record<string, number> | undefined) ?? {};
  const entries = Object.entries(markets);
  return (
    <>
      <NumberRow label="Marge par défaut" unit="%" value={draft.default as number} onChange={set} keyName="default" />
      {expanded && (
        <div className="mt-2 rounded-xl border border-edge bg-slate-50/50 p-3">
          <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">Marges par type de marché</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {entries.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1">
                <label className="text-[10px] text-dim">{MARKET_LABELS[k] ?? k}</label>
                <AdminInput
                  type="text"
                  inputMode="decimal"
                  value={String(v)}
                  onChange={(s) => set("markets", { ...markets, [k]: s === "" ? 0 : Number(s) })}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Cash Out                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function CashoutEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <ToggleRow label="Activer le Cash Out" value={draft.enabled as boolean} onChange={set} keyName="enabled" />
      <NumberRow label="Facteur de base" value={draft.baseFactor as number} onChange={set} keyName="baseFactor" />
      <NumberRow label="Plafond du Cash Out" unit="%" value={draft.maxCapPct as number} onChange={set} keyName="maxCapPct" />
      <div className="grid grid-cols-2 gap-3">
        <NumberRow label="Minute minimale" unit="min" value={draft.minMinute as number} onChange={set} keyName="minMinute" />
        <NumberRow label="Minute maximale" unit="min" value={draft.maxMinute as number} onChange={set} keyName="maxMinute" />
      </div>
      <ArrayFieldEditor label="Marchés exclus du Cash Out" array={(draft.disabledMarkets as unknown[]) ?? []} onChange={(v) => set("disabledMarkets", v)} />
      <ArrayFieldEditor label="Matchs exclus du Cash Out" array={(draft.disabledMatchIds as unknown[]) ?? []} onChange={(v) => set("disabledMatchIds", v)} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Bonus de bienvenue                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

function WelcomeBonusEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <ToggleRow label="Activer le bonus de bienvenue" value={draft.enabled as boolean} onChange={set} keyName="enabled" />
      <NumberRow label="Montant du bonus" unit="€" value={draft.amount as number} onChange={set} keyName="amount" />
      <NumberRow label="Wager" value={draft.wagerMultiplier as number} onChange={set} keyName="wagerMultiplier" />
      <div className="grid grid-cols-2 gap-3">
        <NumberRow label="Cote minimale · simple" value={draft.minOddsSingle as number} onChange={set} keyName="minOddsSingle" />
        <NumberRow label="Cote minimale · combiné" value={draft.minOddsCombo as number} onChange={set} keyName="minOddsCombo" />
      </div>
      <NumberRow label="Validité" unit="jours" value={draft.validityDays as number} onChange={set} keyName="validityDays" />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Moyens de paiement                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

function PaymentsEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const methods = (draft.enabledMethods as string[]) ?? [];
  const allMethods = Object.keys(PAYMENT_LABELS);
  const accounts = (draft.mobileMoneyAccounts as { country: string; label: string; number: string }[]) ?? [];
  const fees = (draft.fees as Record<string, { percent: number; fixed: number }>) ?? {};
  const minMax = (draft.minMax as Record<string, { min: number; max: number }>) ?? {};

  return (
    <>
      <div>
        <label className="mb-2 block text-[11px] text-ink">Méthodes de paiement actives</label>
        <div className="flex flex-wrap gap-2">
          {allMethods.map((m) => {
            const active = methods.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  const next = active ? methods.filter((x) => x !== m) : [...methods, m];
                  set("enabledMethods", next);
                }}
                className={cn(
                  "h-8 rounded-lg px-3 font-display text-[10.5px] font-medium active:scale-95",
                  active ? "bg-emerald-600/12 text-emerald-700" : "bg-slate-200 text-slate-500"
                )}
              >
                {PAYMENT_LABELS[m]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-slate-50/50 p-3">
        <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">Comptes Mobile Money</p>
        <div className="flex flex-col gap-2">
          {accounts.map((acc, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-white/60 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-dim">{acc.label || `Compte ${i + 1}`}</span>
                <button
                  type="button"
                  onClick={() => set("mobileMoneyAccounts", accounts.filter((_, j) => j !== i))}
                  className="text-[10px] font-medium text-red-500"
                >
                  Supprimer
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <AdminInput
                  label="Pays"
                  value={acc.country}
                  onChange={(s) => {
                    const next = [...accounts];
                    next[i] = { ...acc, country: s };
                    set("mobileMoneyAccounts", next);
                  }}
                />
                <AdminInput
                  label="Numéro"
                  value={acc.number}
                  onChange={(s) => {
                    const next = [...accounts];
                    next[i] = { ...acc, number: s };
                    set("mobileMoneyAccounts", next);
                  }}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set("mobileMoneyAccounts", [...accounts, { country: "", label: "", number: "" }])}
            className="h-8 rounded-lg bg-slate-700/80 px-3 font-display text-[10.5px] font-medium text-white active:scale-95"
          >
            Ajouter un compte
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="rounded-xl border border-edge bg-slate-50/50 p-3">
            <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">Frais par méthode</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(fees).map(([m, f]) => (
                <div key={m} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-white/60 p-2">
                  <label className="text-[10px] text-dim">{PAYMENT_LABELS[m] ?? m}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <AdminInput
                      label="%"
                      type="text"
                      inputMode="decimal"
                      value={String(f.percent)}
                      onChange={(s) => set("fees", { ...fees, [m]: { ...f, percent: s === "" ? 0 : Number(s) } })}
                    />
                    <AdminInput
                      label="Fixe"
                      type="text"
                      inputMode="decimal"
                      value={String(f.fixed)}
                      onChange={(s) => set("fees", { ...fees, [m]: { ...f, fixed: s === "" ? 0 : Number(s) } })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-slate-50/50 p-3">
            <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">Seuils par méthode</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(minMax).map(([m, mm]) => (
                <div key={m} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-white/60 p-2">
                  <label className="text-[10px] text-dim">{PAYMENT_LABELS[m] ?? m}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <AdminInput
                      label="Min"
                      type="text"
                      inputMode="decimal"
                      value={String(mm.min)}
                      onChange={(s) => set("minMax", { ...minMax, [m]: { ...mm, min: s === "" ? 0 : Number(s) } })}
                    />
                    <AdminInput
                      label="Max"
                      type="text"
                      inputMode="decimal"
                      value={String(mm.max)}
                      onChange={(s) => set("minMax", { ...minMax, [m]: { ...mm, max: s === "" ? 0 : Number(s) } })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Taux de change                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

function CurrencyRatesEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const rates = (draft.rates as Record<string, number>) ?? {};
  const entries = Object.entries(rates);
  return (
    <div>
      <p className="mb-2 text-[10.5px] text-dim">1 EUR =… pour chaque devise. Mise à jour manuelle.</p>
      <div className={cn("grid grid-cols-2 gap-2 lg:grid-cols-3", !expanded && "max-h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]")}>
        {entries.map(([code, rate]) => (
          <div key={code} className="flex flex-col gap-1 rounded-lg border border-edge bg-elev/40 p-2">
            <label className="text-[10px] font-medium text-ink">{code}</label>
            <AdminInput
              type="text"
              inputMode="decimal"
              value={String(rate)}
              onChange={(s) => set("rates", { ...rates, [code]: s === "" ? 0 : Number(s) })}
            />
          </div>
        ))}
      </div>
      {expanded && (
        <p className="mt-2 text-[10px] text-dim">Taux affichés pour toutes les devises supportées.</p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Paliers par devise                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

function CurrencyPresetsEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const presets = (draft.presets as Record<string, unknown>) ?? {};
  const codes = Object.keys(presets);
  return (
    <div>
      <p className="mb-2 text-[10.5px] text-dim">Paliers rapides et bornes dépôt/retrait par devise.</p>
      <div className={cn("flex flex-col gap-2", !expanded && "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]")}>
        {codes.map((code) => (
          <div key={code} className="rounded-lg border border-edge bg-elev/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink">{code}</span>
              <button
                type="button"
                onClick={() => {
                  const next = { ...presets };
                  delete next[code];
                  set("presets", next);
                }}
                className="text-[10px] font-medium text-red-500"
              >
                Supprimer
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <AdminInput
                label="Paliers mises"
                type="text"
                value={String((presets[code] as { stakePresets?: unknown[] })?.stakePresets?.join(", ") ?? "")}
                onChange={(s) => {
                  const cur = (presets[code] as { stakePresets?: number[] }) ?? {};
                  set("presets", {
                    ...presets,
                    [code]: {
                      ...cur,
                      stakePresets: s.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)),
                    },
                  });
                }}
              />
              <AdminInput
                label="Paliers dépôt"
                type="text"
                value={String((presets[code] as { depositPresets?: unknown[] })?.depositPresets?.join(", ") ?? "")}
                onChange={(s) => {
                  const cur = (presets[code] as { depositPresets?: number[] }) ?? {};
                  set("presets", {
                    ...presets,
                    [code]: {
                      ...cur,
                      depositPresets: s.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)),
                    },
                  });
                }}
              />
              <AdminInput
                label="Paliers retrait"
                type="text"
                value={String((presets[code] as { withdrawalPresets?: unknown[] })?.withdrawalPresets?.join(", ") ?? "")}
                onChange={(s) => {
                  const cur = (presets[code] as { withdrawalPresets?: number[] }) ?? {};
                  set("presets", {
                    ...presets,
                    [code]: {
                      ...cur,
                      withdrawalPresets: s.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)),
                    },
                  });
                }}
              />
              <AdminInput
                label="Bornes dépôt"
                type="text"
                value={String(`${(presets[code] as { minDeposit?: number })?.minDeposit ?? 0} - ${(presets[code] as { maxDeposit?: number })?.maxDeposit ?? 0}`)}
                onChange={(s) => {
                  const parts = s.split("-").map((x) => Number(x.trim()));
                  const cur = (presets[code] as { minDeposit?: number; maxDeposit?: number }) ?? {};
                  set("presets", {
                    ...presets,
                    [code]: {
                      ...cur,
                      minDeposit: parts[0] ?? 0,
                      maxDeposit: parts[1] ?? 0,
                    },
                  });
                }}
              />
              <AdminInput
                label="Bornes retrait"
                type="text"
                value={String(`${(presets[code] as { minWithdrawal?: number })?.minWithdrawal ?? 0} - ${(presets[code] as { maxWithdrawal?: number })?.maxWithdrawal ?? 0}`)}
                onChange={(s) => {
                  const parts = s.split("-").map((x) => Number(x.trim()));
                  const cur = (presets[code] as { minWithdrawal?: number; maxWithdrawal?: number }) ?? {};
                  set("presets", {
                    ...presets,
                    [code]: {
                      ...cur,
                      minWithdrawal: parts[0] ?? 0,
                      maxWithdrawal: parts[1] ?? 0,
                    },
                  });
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {expanded && (
        <button
          type="button"
          onClick={() => {
            const code = prompt("Code devise à ajouter :");
            if (code) set("presets", { ...presets, [code.trim().toUpperCase()]: {} });
          }}
          className="mt-2 h-8 rounded-lg bg-slate-700/80 px-3 font-display text-[10.5px] font-medium text-white active:scale-95"
        >
          Ajouter une devise
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Marchés & ligues                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function MarketsCatalogEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const active = (draft.activeMarkets as string[]) ?? [];
  const allMarkets = Object.keys(MARKET_LABELS).filter((m) => !RETIRED_MARKETS.includes(m));
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-2 block text-[11px] text-ink">Marchés actifs</label>
        <div className="flex flex-wrap gap-2">
          {allMarkets.map((m) => {
            const isActive = active.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  const next = isActive ? active.filter((x) => x !== m) : [...active, m];
                  set("activeMarkets", next);
                }}
                className={cn(
                  "h-8 rounded-lg px-3 font-display text-[10.5px] font-medium active:scale-95",
                  isActive ? "bg-emerald-600/12 text-emerald-700" : "bg-slate-200 text-slate-500"
                )}
              >
                {MARKET_LABELS[m] ?? m}
              </button>
            );
          })}
        </div>
      </div>
      {expanded && (
        <ArrayFieldEditor label="Ligues actives · codes" array={(draft.activeLeagues as unknown[]) ?? []} onChange={(v) => set("activeLeagues", v)} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Simulateur virtuel                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

function VirtualSimulatorEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <ToggleRow label="Activer le simulateur virtuel" value={draft.enabled as boolean} onChange={set} keyName="enabled" />
      <NumberRow label="Matchs live simultanés" unit="matchs" value={draft.maxLive as number} onChange={set} keyName="maxLive" />
      <NumberRow label="Écart entre coups d'envoi" unit="ms" value={draft.kickoffGapMs as number} onChange={set} keyName="kickoffGapMs" />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Branding                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function BrandingEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <AdminInput label="Nom du site" value={String(draft.siteName ?? "")} onChange={(s) => set("siteName", s)} />
        <AdminInput label="Nom court" value={String(draft.shortName ?? "")} onChange={(s) => set("shortName", s)} />
      </div>
      <AdminInput label="Slogan" value={String(draft.tagline ?? "")} onChange={(s) => set("tagline", s)} />
      <AdminInput label="Titre de la bannière d'accueil" value={String(draft.heroTitle ?? "")} onChange={(s) => set("heroTitle", s)} />
      <AdminInput label="Sous-titre de la bannière d'accueil" value={String(draft.heroSubtitle ?? "")} onChange={(s) => set("heroSubtitle", s)} />
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-ink">
          Couleur principale
          
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={String(draft.primaryColor ?? "#e10600")}
            onChange={(e) => set("primaryColor", e.target.value)}
            className="h-11 w-14 cursor-pointer rounded-xl border border-edge bg-white"
          />
          <AdminInput type="text" value={String(draft.primaryColor ?? "")} onChange={(s) => set("primaryColor", s)} />
        </div>
      </div>
      <ArrayFieldEditor label="Bannières promotionnelles · URLs" array={(draft.banners as unknown[]) ?? []} onChange={(v) => set("banners", v)} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Notifications                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

function NotificationsEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const categories = (draft.categories as string[]) ?? [];
  const allCategories = Object.keys(NOTIFICATION_LABELS);
  return (
    <>
      <ToggleRow label="Activer les notifications" value={draft.enabled as boolean} onChange={set} keyName="enabled" />
      <div>
        <label className="mb-2 block text-[11px] text-ink">Catégories de notifications actives</label>
        <div className="flex flex-wrap gap-2">
          {allCategories.map((c) => {
            const active = categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const next = active ? categories.filter((x) => x !== c) : [...categories, c];
                  set("categories", next);
                }}
                className={cn(
                  "h-8 rounded-lg px-3 font-display text-[10.5px] font-medium active:scale-95",
                  active ? "bg-emerald-600/12 text-emerald-700" : "bg-slate-200 text-slate-500"
                )}
              >
                {NOTIFICATION_LABELS[c] ?? c}
              </button>
            );
          })}
        </div>
      </div>
      <AdminInput label="Préfixe des notifications push" value={String(draft.pushSubjectPrefix ?? "")} onChange={(s) => set("pushSubjectPrefix", s)} />
      {expanded && (
        <AdminInput label="Pied de page des e-mails" value={String(draft.emailFooter ?? "")} onChange={(s) => set("emailFooter", s)} />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Sécurité                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function SecurityEditor({
  draft,
  set,
  expanded,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  return (
    <>
      <div className="rounded-xl border border-edge bg-slate-50/50 p-3">
        <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">Mots de passe & sessions</p>
        <div className="flex flex-col gap-2.5">
          <NumberRow label="Longueur minimale du mot de passe" unit="caractères" value={draft.minPasswordLength as number} onChange={set} keyName="minPasswordLength" />
          <ToggleRow label="Majuscule obligatoire" value={draft.requireMixedCase as boolean} onChange={set} keyName="requireMixedCase" />
          <ToggleRow label="Chiffre obligatoire" value={draft.requireDigit as boolean} onChange={set} keyName="requireDigit" />
          <NumberRow label="Longueur maximale du mot de passe" unit="caractères" value={draft.maxPasswordLength as number} onChange={set} keyName="maxPasswordLength" />
          <NumberRow label="Tentatives de connexion autorisées" unit="essais" value={draft.maxLoginAttempts as number} onChange={set} keyName="maxLoginAttempts" />
          <NumberRow label="Durée de session" unit="h" value={draft.sessionTimeoutHours as number} onChange={set} keyName="sessionTimeoutHours" />
          <ToggleRow label="Authentification à double facteur obligatoire" value={draft.require2FA as boolean} onChange={set} keyName="require2FA" />
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-slate-50/50 p-3">
        <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-dim">Codes de transfert</p>
        <div className="flex flex-col gap-2.5">
          <ToggleRow label="Activer les codes de transfert" value={draft.transferCodesEnabled as boolean} onChange={set} keyName="transferCodesEnabled" />
          {expanded && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <NumberRow label="Montant minimal" unit="€" value={draft.transferCodeMinAmount as number} onChange={set} keyName="transferCodeMinAmount" />
                <NumberRow label="Montant maximal" unit="€" value={draft.transferCodeMaxAmount as number} onChange={set} keyName="transferCodeMaxAmount" />
              </div>
              <NumberRow label="Durée de vie des codes" unit="min" value={draft.transferCodeTtlMinutes as number} onChange={set} keyName="transferCodeTtlMinutes" />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeur : Gestion des joueurs                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function PlayersEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <NumberRow label="Plafond de mise manuel par défaut" unit="€" value={draft.defaultManualStakeLimit as number} onChange={set} keyName="defaultManualStakeLimit" />
      <NumberRow
        label="Seuil VIP"
        unit="€"
        hint="Profit net minimal pour atteindre le niveau VIP"
        value={draft.vipThresholdNetProfit as number}
        onChange={set}
        keyName="vipThresholdNetProfit"
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Rows utilitaires                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

function NumberRow({
  label,
  unit,
  hint,
  keyName,
  value,
  onChange,
}: {
  label: string;
  unit?: string;
  hint?: string;
  keyName: string;
  value: unknown;
  onChange: (k: string, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-ink">
        {label}{unit ? ` · ${unit}` : ""}
      </label>
      <AdminInput
        type="text"
        inputMode="decimal"
        value={String(value ?? "")}
        onChange={(s) => onChange(keyName, s === "" ? "" : Number(s))}
      />
      {hint && <p className="text-[10px] text-dim">{hint}</p>}
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
    <div className="flex items-center justify-between rounded-xl border border-edge bg-elev/40 px-3 py-2.5">
      <label className="text-[11.5px] text-ink">{label}</label>
      <AdminToggle checked={Boolean(value)} onChange={(b) => onChange(keyName, b)} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Fallback pour les clés non listées                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function humanizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
