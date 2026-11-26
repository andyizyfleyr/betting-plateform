import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronDown, Loader2, Save, RotateCcw, X } from "lucide-react-native";
import { api } from "@/lib/api";
import { COLORS } from "@/theme/tokens";

/**
 * Onglet « Réglages » de l'admin mobile — miroir de l'onglet Réglages web
 * (src/components/admin/settings-tab.tsx, refonte PR #188).
 * Édition de tous les paramètres admin (bonus combiné, marges, cash out,
 * bonus, paiements, devises, marchés, simulateur, branding, notifications,
 * sécurité, joueurs) sans redéploiement.
 */

type SettingsMap = Record<string, Record<string, unknown>>;

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Catalogue : clés + labels                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

const CATALOG: Record<string, { label: string; description: string }> = {
  combo_boost: { label: "Bonus Combiné", description: "Paliers de gain des combinés et cote min éligible" },
  market_margins: { label: "Marges bookmaker", description: "Marge (%) par type de marché et par défaut" },
  cashout: { label: "Cash Out", description: "Activation, marge, plafond et matchs exclus" },
  welcome_bonus: { label: "Bonus de bienvenue", description: "Montant, wager et conditions de déblocage" },
  payments: { label: "Moyens de paiement", description: "Méthodes actives, numéros MoMo, frais et seuils" },
  currency_presets: { label: "Paliers par devise", description: "Paliers rapides et bornes dépôt/retrait par devise" },
  currency_rates: { label: "Taux de change", description: "1 EUR = rate pour chaque devise (mises à jour manuellement)" },
  markets_catalog: { label: "Marchés & ligues", description: "Marchés actifs et compétitions proposées" },
  virtual_simulator: { label: "Simulateur virtuel", description: "Nombre de matchs live simultanés et fréquence des coups d'envoi" },
  branding: { label: "Branding", description: "Nom, couleurs, hero et bannières promo" },
  notifications: { label: "Notifications", description: "Catégories actives, préfixe push et pied de page e-mail" },
  security: { label: "Sécurité", description: "Mot de passe, codes de transfert, sessions, 2FA" },
  players: { label: "Gestion joueurs", description: "Plafonds manuels et seuil VIP" },
};

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Groupes thématiques                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

const GROUPS: { title: string; description: string; keys: string[] }[] = [
  { title: "Paris & gains", description: "Bonus, marges du bookmaker et cash out", keys: ["combo_boost", "market_margins", "cashout"] },
  { title: "Bonus & offres", description: "Bonus de bienvenue et moyens de paiement", keys: ["welcome_bonus", "payments"] },
  { title: "Devises & marchés", description: "Taux de change, paliers par devise et catalogue des marchés", keys: ["currency_rates", "currency_presets", "markets_catalog"] },
  { title: "Simulateur & contenu", description: "Simulateur virtuel, branding et notifications", keys: ["virtual_simulator", "branding", "notifications"] },
  { title: "Sécurité & gestion", description: "Sécurité des comptes et gestion des joueurs", keys: ["security", "players"] },
];

const FIELD_LABELS: Record<string, { label: string; unit?: string; hint?: string }> = {
  enabled: { label: "Fonctionnel", hint: "Activer ou désactiver la fonctionnalité" },
  minEligibleOdds: { label: "Cote minimale éligible", hint: "Cote minimale pour qu'un combiné touche le bonus" },
  tiers: { label: "Paliers de bonus" },
  default: { label: "Marge par défaut", unit: "%" },
  markets: { label: "Marges par type de marché", unit: "%" },
  baseFactor: { label: "Facteur de base", hint: "Taux appliqué au cash out de base" },
  maxCapPct: { label: "Plafond du cash out", unit: "%", hint: "Pourcentage maximal du gain remboursable" },
  minMinute: { label: "Minute minimale", unit: "min" },
  maxMinute: { label: "Minute maximale", unit: "min" },
  disabledMarkets: { label: "Marchés exclus du cash out" },
  disabledMatchIds: { label: "Matchs exclus du cash out" },
  amount: { label: "Montant du bonus", unit: "€" },
  wagerMultiplier: { label: "Wager", hint: "Nombre de mises à effectuer avant retrait" },
  minOddsSingle: { label: "Cote minimale · simple" },
  minOddsCombo: { label: "Cote minimale · combiné" },
  validityDays: { label: "Validité", unit: "jours" },
  enabledMethods: { label: "Méthodes de paiement actives" },
  mobileMoneyAccounts: { label: "Comptes Mobile Money" },
  fees: { label: "Frais par méthode", hint: "Pourcentage + montant fixe par méthode" },
  minMax: { label: "Seuils par méthode", hint: "Montant min / max par méthode" },
  rates: { label: "Taux de change", hint: "1 EUR = … (mis à jour manuellement)" },
  presets: { label: "Paliers par devise", hint: "Paliers rapides et bornes dépôt/retrait" },
  activeMarkets: { label: "Marchés actifs" },
  activeLeagues: { label: "Ligues actives · codes" },
  maxLive: { label: "Matchs live simultanés", unit: "matchs" },
  kickoffGapMs: { label: "Écart entre coups d'envoi", unit: "ms" },
  siteName: { label: "Nom du site" },
  shortName: { label: "Nom court" },
  tagline: { label: "Slogan" },
  heroTitle: { label: "Titre de la bannière d'accueil" },
  heroSubtitle: { label: "Sous-titre de la bannière d'accueil" },
  primaryColor: { label: "Couleur principale", hint: "Code hexadécimal" },
  banners: { label: "Bannières promotionnelles · URLs" },
  categories: { label: "Catégories de notifications actives" },
  pushSubjectPrefix: { label: "Préfixe des notifications push" },
  emailFooter: { label: "Pied de page des e-mails" },
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

/** Marchés retirés de l'offre : non proposés à l'activation. */
const RETIRED_MARKETS: readonly string[] = ["dnb", "handicap_euro", "winning_margin"];


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

const COLOR_PRESETS = ["#e10600", "#15803d", "#1d4ed8", "#b45309", "#7c3aed", "#0f766e"];

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Toast interne                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

function useToast() {
  const [msg, setMsg] = useState<{ kind: "success" | "error"; title: string; message?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: { kind: "success" | "error"; title: string; message?: string }) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3000);
  }, []);
  const node = msg ? (
    <View style={[styles.toast, msg.kind === "success" ? styles.toastOk : styles.toastErr]}>
      <Text style={styles.toastTitle}>{msg.title}</Text>
      {msg.message ? <Text style={styles.toastMsg}>{msg.message}</Text> : null}
    </View>
  ) : null;
  return { show, node };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Composant principal                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

export function AdminSettingsTab() {
  const { show, node } = useToast();
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.admin.getSettings();
      if (r?.settings) setSettings(r.settings as SettingsMap);
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
    async (key: string, value: Record<string, unknown>) => {
      setSavingKey(key);
      try {
        await api.admin.saveSetting(key, value);
        setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
        show({ kind: "success", title: `Réglage « ${CATALOG[key]?.label ?? key} » enregistré` });
      } catch {
        show({ kind: "error", title: `Impossible d'enregistrer ${CATALOG[key]?.label ?? key}` });
      } finally {
        setSavingKey(null);
      }
    },
    [show]
  );

  const grouped = GROUPS.map((g) => {
    const map = settings ?? {};
    return { ...g, settings: g.keys.map((k) => ({ key: k, value: map[k] ?? {} })) };
  });

  return (
    <View style={styles.wrap}>
      {node}
      {loading || !settings ? (
        <View style={styles.loaderBox}>
          <ActivityIndicator color={COLORS.dim} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Réglages de la plateforme</Text>
            <Text style={styles.heroSub}>
              Configurez tous les paramètres fonctionnels sans redéploiement. Les modifications s'appliquent instantanément côté
              serveur. Chaque réglage s'enregistre indépendamment.
            </Text>
            <Pressable
              onPress={() => void load()}
              style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.9 }]}
            >
              <RotateCcw size={13} color="#ffffff" strokeWidth={2.2} />
              <Text style={styles.refreshBtnText}>Actualiser</Text>
            </Pressable>
          </View>

          {grouped.map((group) => (
            <View key={group.title} style={styles.groupWrap}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                <Text style={styles.groupDesc}>{group.description}</Text>
              </View>
              <View style={styles.groupGrid}>
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
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Carte de réglage                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

function SettingsCard({
  keyName,
  value,
  saving,
  expanded,
  onToggleExpand,
  onSave,
}: {
  keyName: string;
  value: Record<string, unknown>;
  saving: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const meta = CATALOG[keyName];
  const [draft, setDraft] = useState<Record<string, unknown>>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const set = (k: string, v: unknown) => setDraft((prev) => ({ ...prev, [k]: v }));

  const hasLongFields =
    keyName === "combo_boost" ||
    keyName === "market_margins" ||
    keyName === "payments" ||
    keyName === "currency_rates" ||
    keyName === "currency_presets" ||
    keyName === "markets_catalog" ||
    keyName === "security";

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{meta?.label ?? keyName}</Text>
        <Pressable
          disabled={saving}
          onPress={() => onSave(draft)}
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }, saving && { opacity: 0.5 }]}
        >
          {saving ? <Loader2 size={13} color="#ffffff" /> : <Save size={13} color="#ffffff" strokeWidth={2.2} />}
          <Text style={styles.saveBtnText}>Enregistrer</Text>
        </Pressable>
      </View>
      {meta ? <Text style={styles.cardDesc}>{meta.description}</Text> : null}
      <View style={styles.cardBody}>
        <SettingsBody keyName={keyName} draft={draft} set={set} expanded={expanded} />
      </View>
      {hasLongFields ? (
        <Pressable onPress={onToggleExpand} style={styles.expandBtn}>
          <ChevronDown size={13} color={COLORS.ink} strokeWidth={2.2} style={expanded ? styles.chevronUp : null} />
          <Text style={styles.expandBtnText}>{expanded ? "Réduire" : "Voir les détails"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Corps : éditeurs spécialisés                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

function SettingsBody({
  keyName,
  draft,
  set,
  expanded,
}: {
  keyName: string;
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  switch (keyName) {
    case "combo_boost":
      return <ComboBoostEditor draft={draft} set={set} expanded={expanded} />;
    case "market_margins":
      return <MarketMarginsEditor draft={draft} set={set} expanded={expanded} />;
    case "cashout":
      return <CashoutEditor draft={draft} set={set} />;
    case "welcome_bonus":
      return <WelcomeBonusEditor draft={draft} set={set} />;
    case "payments":
      return <PaymentsEditor draft={draft} set={set} expanded={expanded} />;
    case "currency_rates":
      return <CurrencyRatesEditor draft={draft} set={set} expanded={expanded} />;
    case "currency_presets":
      return <CurrencyPresetsEditor draft={draft} set={set} expanded={expanded} />;
    case "markets_catalog":
      return <MarketsCatalogEditor draft={draft} set={set} expanded={expanded} />;
    case "virtual_simulator":
      return <VirtualSimulatorEditor draft={draft} set={set} />;
    case "branding":
      return <BrandingEditor draft={draft} set={set} />;
    case "notifications":
      return <NotificationsEditor draft={draft} set={set} expanded={expanded} />;
    case "security":
      return <SecurityEditor draft={draft} set={set} expanded={expanded} />;
    case "players":
      return <PlayersEditor draft={draft} set={set} />;
    default: {
      const rows = Object.entries(draft).filter(([, v]) => !(v && typeof v === "object"));
      return (
        <View style={styles.bodyCol}>
          {rows.map(([k, v]) => (
            <GenericField key={k} k={k} value={v} onChange={(val) => set(k, val)} />
          ))}
        </View>
      );
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Champs génériques                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function AdminInput({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  keyboardType,
}: {
  label?: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  inputMode?: "decimal" | "text" | "numeric";
  keyboardType?: "decimal-pad" | "number-pad";
}) {
  return (
    <View style={styles.inputWrap}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.mist}
        inputMode={inputMode}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
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
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={Boolean(value)}
        onValueChange={(b) => onChange(keyName, b)}
        trackColor={{ false: COLORS.edge, true: COLORS.betclicRed }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

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
    <View style={styles.bodyCol}>
      <FieldLabel>
        {label}
              </FieldLabel>
      <TextInput
        value={String(value ?? "")}
        onChangeText={(s) => onChange(keyName, s === "" ? "" : Number(s))}
        inputMode="decimal"
        keyboardType="decimal-pad"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

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
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{meta.label}</Text>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: COLORS.edge, true: COLORS.betclicRed }}
          thumbColor="#ffffff"
        />
      </View>
    );
  }
  if (typeof value === "number") {
    return (
      <View style={styles.bodyCol}>
        <FieldLabel>
          {meta.label}
          
        </FieldLabel>
        <TextInput
          value={String(value)}
          onChangeText={(s) => onChange(s === "" ? "" : Number(s))}
          inputMode="decimal"
          keyboardType="decimal-pad"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        {meta.hint ? <Text style={styles.hint}>{meta.hint}</Text> : null}
      </View>
    );
  }
  if (Array.isArray(value)) {
    return <ArrayFieldEditor label={meta.label} array={value} onChange={onChange} />;
  }
  if (typeof value === "string") {
    return (
      <View style={styles.bodyCol}>
        <FieldLabel>{meta.label}</FieldLabel>
        <TextInput value={value} onChangeText={onChange} style={styles.input} />
        {meta.hint ? <Text style={styles.hint}>{meta.hint}</Text> : null}
      </View>
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
    <View style={styles.bodyCol}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="val1, val2, val3…"
        placeholderTextColor={COLORS.mist}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <Pressable
        onPress={() => {
          const arr = text
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x));
          onChange(arr);
        }}
        style={({ pressed }) => [styles.applyBtn, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.applyBtnText}>Appliquer</Text>
      </Pressable>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Éditeurs spécialisés                                                       */
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
    <View style={styles.bodyCol}>
      <ToggleRow label="Activer le bonus combiné" keyName="enabled" value={draft.enabled} onChange={set} />
      <NumberRow label="Cote minimale éligible" keyName="minEligibleOdds" value={draft.minEligibleOdds} onChange={set} />
      {expanded ? (
        <View style={styles.subBox}>
          <Text style={styles.subTitle}>Paliers de bonus</Text>
          <View style={styles.bodyCol}>
            {tiers.map((t, i) => (
              <View key={i} style={styles.tierRow}>
                <Text style={styles.tierLabel}>{t.legs} combinés</Text>
                <TextInput
                  value={String(t.pct)}
                  onChangeText={(s) => {
                    const next = [...tiers];
                    next[i] = { ...t, pct: s === "" ? 0 : Number(s) };
                    set("tiers", next);
                  }}
                  inputMode="decimal"
                  keyboardType="decimal-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, { flex: 1 }]}
                />
                <Text style={styles.tierUnit}>% de bonus</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

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
    <View style={styles.bodyCol}>
      <NumberRow label="Marge par défaut" unit="%" keyName="default" value={draft.default} onChange={set} />
      {expanded ? (
        <View style={styles.subBox}>
          <Text style={styles.subTitle}>Marges par type de marché</Text>
          <View style={styles.marketGrid}>
            {entries.map(([k, v]) => (
              <View key={k} style={styles.marketCell}>
                <Text style={styles.marketLabel}>{MARKET_LABELS[k] ?? k}</Text>
                <TextInput
                  value={String(v)}
                  onChangeText={(s) => set("markets", { ...markets, [k]: s === "" ? 0 : Number(s) })}
                  inputMode="decimal"
                  keyboardType="decimal-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CashoutEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <View style={styles.bodyCol}>
      <ToggleRow label="Activer le Cash Out" keyName="enabled" value={draft.enabled} onChange={set} />
      <NumberRow label="Facteur de base" keyName="baseFactor" value={draft.baseFactor} onChange={set} />
      <NumberRow label="Plafond du Cash Out" unit="%" keyName="maxCapPct" value={draft.maxCapPct} onChange={set} />
      <View style={styles.twoCol}>
        <NumberRow label="Minute minimale" unit="min" keyName="minMinute" value={draft.minMinute} onChange={set} />
        <NumberRow label="Minute maximale" unit="min" keyName="maxMinute" value={draft.maxMinute} onChange={set} />
      </View>
      <ArrayFieldEditor label="Marchés exclus du Cash Out" array={(draft.disabledMarkets as unknown[]) ?? []} onChange={(v) => set("disabledMarkets", v)} />
      <ArrayFieldEditor label="Matchs exclus du Cash Out" array={(draft.disabledMatchIds as unknown[]) ?? []} onChange={(v) => set("disabledMatchIds", v)} />
    </View>
  );
}

function WelcomeBonusEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <View style={styles.bodyCol}>
      <ToggleRow label="Activer le bonus de bienvenue" keyName="enabled" value={draft.enabled} onChange={set} />
      <NumberRow label="Montant du bonus" unit="€" keyName="amount" value={draft.amount} onChange={set} />
      <NumberRow label="Wager" keyName="wagerMultiplier" value={draft.wagerMultiplier} onChange={set} />
      <View style={styles.twoCol}>
        <NumberRow label="Cote minimale · simple" keyName="minOddsSingle" value={draft.minOddsSingle} onChange={set} />
        <NumberRow label="Cote minimale · combiné" keyName="minOddsCombo" value={draft.minOddsCombo} onChange={set} />
      </View>
      <NumberRow label="Validité" unit="jours" keyName="validityDays" value={draft.validityDays} onChange={set} />
    </View>
  );
}

function Badge({ active, children, onPress }: { active: boolean; children: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.badge, active ? styles.badgeActive : styles.badgeOff, pressed && { opacity: 0.85 }]}
    >
      <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{children}</Text>
    </Pressable>
  );
}

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
    <View style={styles.bodyCol}>
      <View style={styles.bodyCol}>
        <FieldLabel>Méthodes de paiement actives</FieldLabel>
        <View style={styles.badgeWrap}>
          {allMethods.map((m) => {
            const active = methods.includes(m);
            return (
              <Badge
                key={m}
                active={active}
                onPress={() => set("enabledMethods", active ? methods.filter((x) => x !== m) : [...methods, m])}
              >
                {PAYMENT_LABELS[m]}
              </Badge>
            );
          })}
        </View>
      </View>

      <View style={styles.subBox}>
        <Text style={styles.subTitle}>Comptes Mobile Money</Text>
        <View style={styles.bodyCol}>
          {accounts.map((acc, i) => (
            <View key={i} style={styles.accountBox}>
              <View style={styles.accountHead}>
                <Text style={styles.accountTitle}>{acc.label || `Compte ${i + 1}`}</Text>
                <Pressable onPress={() => set("mobileMoneyAccounts", accounts.filter((_, j) => j !== i))}>
                  <Text style={styles.deleteText}>Supprimer</Text>
                </Pressable>
              </View>
              <View style={styles.twoCol}>
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
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => set("mobileMoneyAccounts", [...accounts, { country: "", label: "", number: "" }])}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.addBtnText}>Ajouter un compte</Text>
          </Pressable>
        </View>
      </View>

      {expanded ? (
        <>
          <View style={styles.subBox}>
            <Text style={styles.subTitle}>Frais par méthode</Text>
            <View style={styles.bodyCol}>
              {Object.entries(fees).map(([m, f]) => (
                <View key={m} style={styles.feeBox}>
                  <Text style={styles.marketLabel}>{PAYMENT_LABELS[m] ?? m}</Text>
                  <View style={styles.twoCol}>
                    <AdminInput
                      label="%"
                      value={String(f.percent)}
                      inputMode="decimal"
                      keyboardType="decimal-pad"
                      onChange={(s) => set("fees", { ...fees, [m]: { ...f, percent: s === "" ? 0 : Number(s) } })}
                    />
                    <AdminInput
                      label="Fixe"
                      value={String(f.fixed)}
                      inputMode="decimal"
                      keyboardType="decimal-pad"
                      onChange={(s) => set("fees", { ...fees, [m]: { ...f, fixed: s === "" ? 0 : Number(s) } })}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.subBox}>
            <Text style={styles.subTitle}>Seuils par méthode</Text>
            <View style={styles.bodyCol}>
              {Object.entries(minMax).map(([m, mm]) => (
                <View key={m} style={styles.feeBox}>
                  <Text style={styles.marketLabel}>{PAYMENT_LABELS[m] ?? m}</Text>
                  <View style={styles.twoCol}>
                    <AdminInput
                      label="Min"
                      value={String(mm.min)}
                      inputMode="decimal"
                      keyboardType="decimal-pad"
                      onChange={(s) => set("minMax", { ...minMax, [m]: { ...mm, min: s === "" ? 0 : Number(s) } })}
                    />
                    <AdminInput
                      label="Max"
                      value={String(mm.max)}
                      inputMode="decimal"
                      keyboardType="decimal-pad"
                      onChange={(s) => set("minMax", { ...minMax, [m]: { ...mm, max: s === "" ? 0 : Number(s) } })}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function CurrencyRatesEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  expanded: boolean;
}) {
  const rates = (draft.rates as Record<string, number>) ?? {};
  const entries = Object.entries(rates);
  return (
    <View style={styles.bodyCol}>
      <Text style={styles.hint}>1 EUR =… pour chaque devise. Mise à jour manuelle.</Text>
      <View style={styles.marketGrid}>
        {entries.map(([code, rate]) => (
          <View key={code} style={styles.rateCell}>
            <Text style={styles.rateCode}>{code}</Text>
            <TextInput
              value={String(rate)}
              onChangeText={(s) => set("rates", { ...rates, [code]: s === "" ? 0 : Number(s) })}
              inputMode="decimal"
              keyboardType="decimal-pad"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

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
    <View style={styles.bodyCol}>
      <Text style={styles.hint}>Paliers rapides et bornes dépôt/retrait par devise.</Text>
      <View style={styles.bodyCol}>
        {codes.map((code) => {
          const cur = (presets[code] as Record<string, unknown>) ?? {};
          return (
            <View key={code} style={styles.presetBox}>
              <View style={styles.presetHead}>
                <Text style={styles.presetCode}>{code}</Text>
                <Pressable
                  onPress={() => {
                    const next = { ...presets };
                    delete next[code];
                    set("presets", next);
                  }}
                >
                  <Text style={styles.deleteText}>Supprimer</Text>
                </Pressable>
              </View>
              <PresetInput
                label="Paliers mises"
                value={(cur.stakePresets as unknown[])?.map((x) => String(x)).join(", ") ?? ""}
                onChange={(s) =>
                  set("presets", {
                    ...presets,
                    [code]: { ...cur, stakePresets: toNumArr(s) },
                  })
                }
              />
              <PresetInput
                label="Paliers dépôt"
                value={(cur.depositPresets as unknown[])?.map((x) => String(x)).join(", ") ?? ""}
                onChange={(s) =>
                  set("presets", {
                    ...presets,
                    [code]: { ...cur, depositPresets: toNumArr(s) },
                  })
                }
              />
              <PresetInput
                label="Paliers retrait"
                value={(cur.withdrawalPresets as unknown[])?.map((x) => String(x)).join(", ") ?? ""}
                onChange={(s) =>
                  set("presets", {
                    ...presets,
                    [code]: { ...cur, withdrawalPresets: toNumArr(s) },
                  })
                }
              />
              <PresetInput
                label="Bornes dépôt"
                value={`${(cur.minDeposit as number) ?? 0} - ${(cur.maxDeposit as number) ?? 0}`}
                onChange={(s) => {
                  const parts = s.split("-").map((x) => Number(x.trim()));
                  set("presets", {
                    ...presets,
                    [code]: { ...cur, minDeposit: parts[0] ?? 0, maxDeposit: parts[1] ?? 0 },
                  });
                }}
              />
              <PresetInput
                label="Bornes retrait"
                value={`${(cur.minWithdrawal as number) ?? 0} - ${(cur.maxWithdrawal as number) ?? 0}`}
                onChange={(s) => {
                  const parts = s.split("-").map((x) => Number(x.trim()));
                  set("presets", {
                    ...presets,
                    [code]: { ...cur, minWithdrawal: parts[0] ?? 0, maxWithdrawal: parts[1] ?? 0 },
                  });
                }}
              />
            </View>
          );
        })}
      </View>
      {expanded ? (
        <Pressable
          onPress={() => {
            Alert.prompt("Ajouter une devise", "Code devise à ajouter :", [
              { text: "Annuler" },
              {
                text: "Ajouter",
                onPress: (code?: string) => {
                  if (code) set("presets", { ...presets, [code.trim().toUpperCase()]: {} });
                },
              },
            ]);
          }}
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.9 }]}
        >
          <Text style={styles.addBtnText}>Ajouter une devise</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function toNumArr(s: string): number[] {
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => !Number.isNaN(n));
}

function PresetInput({ label, value, onChange }: { label: string; value: string; onChange: (s: string) => void }) {
  return (
    <View style={styles.inputWrap}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={onChange}
        inputMode="decimal"
        keyboardType="decimal-pad"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

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
    <View style={styles.bodyCol}>
      <View style={styles.bodyCol}>
        <FieldLabel>Marchés actifs</FieldLabel>
        <View style={styles.badgeWrap}>
          {allMarkets.map((m) => {
            const isActive = active.includes(m);
            return (
              <Badge
                key={m}
                active={isActive}
                onPress={() => set("activeMarkets", isActive ? active.filter((x) => x !== m) : [...active, m])}
              >
                {MARKET_LABELS[m] ?? m}
              </Badge>
            );
          })}
        </View>
      </View>
      {expanded ? (
        <ArrayFieldEditor label="Ligues actives · codes" array={(draft.activeLeagues as unknown[]) ?? []} onChange={(v) => set("activeLeagues", v)} />
      ) : null}
    </View>
  );
}

function VirtualSimulatorEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <View style={styles.bodyCol}>
      <ToggleRow label="Activer le simulateur virtuel" keyName="enabled" value={draft.enabled} onChange={set} />
      <NumberRow label="Matchs live simultanés" unit="matchs" keyName="maxLive" value={draft.maxLive} onChange={set} />
      <NumberRow label="Écart entre coups d'envoi" unit="ms" keyName="kickoffGapMs" value={draft.kickoffGapMs} onChange={set} />
    </View>
  );
}

function BrandingEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  const color = String(draft.primaryColor ?? "#e10600");
  return (
    <View style={styles.bodyCol}>
      <View style={styles.twoCol}>
        <AdminInput label="Nom du site" value={String(draft.siteName ?? "")} onChange={(s) => set("siteName", s)} />
        <AdminInput label="Nom court" value={String(draft.shortName ?? "")} onChange={(s) => set("shortName", s)} />
      </View>
      <AdminInput label="Slogan" value={String(draft.tagline ?? "")} onChange={(s) => set("tagline", s)} />
      <AdminInput label="Titre de la bannière d'accueil" value={String(draft.heroTitle ?? "")} onChange={(s) => set("heroTitle", s)} />
      <AdminInput label="Sous-titre de la bannière d'accueil" value={String(draft.heroSubtitle ?? "")} onChange={(s) => set("heroSubtitle", s)} />
      <View style={styles.inputWrap}>
        <FieldLabel>
          Couleur principale
          
        </FieldLabel>
        <View style={styles.colorRow}>
          {COLOR_PRESETS.map((c) => (
            <Pressable
              key={c}
              onPress={() => set("primaryColor", c)}
              style={[styles.swatch, { backgroundColor: c }, color.toLowerCase() === c.toLowerCase() && styles.swatchActive]}
            />
          ))}
          <View style={[styles.swatchPreview, { backgroundColor: color }]} />
        </View>
        <TextInput
          value={color}
          onChangeText={(s) => set("primaryColor", s)}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      <ArrayFieldEditor label="Bannières promotionnelles · URLs" array={(draft.banners as unknown[]) ?? []} onChange={(v) => set("banners", v)} />
    </View>
  );
}

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
    <View style={styles.bodyCol}>
      <ToggleRow label="Activer les notifications" keyName="enabled" value={draft.enabled} onChange={set} />
      <View style={styles.bodyCol}>
        <FieldLabel>Catégories de notifications actives</FieldLabel>
        <View style={styles.badgeWrap}>
          {allCategories.map((c) => {
            const active = categories.includes(c);
            return (
              <Badge
                key={c}
                active={active}
                onPress={() => set("categories", active ? categories.filter((x) => x !== c) : [...categories, c])}
              >
                {NOTIFICATION_LABELS[c]}
              </Badge>
            );
          })}
        </View>
      </View>
      <AdminInput label="Préfixe des notifications push" value={String(draft.pushSubjectPrefix ?? "")} onChange={(s) => set("pushSubjectPrefix", s)} />
      <AdminInput label="Pied de page des e-mails" value={String(draft.emailFooter ?? "")} onChange={(s) => set("emailFooter", s)} />
    </View>
  );
}

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
    <View style={styles.bodyCol}>
      <View style={styles.subBox}>
        <Text style={styles.subTitle}>Mots de passe & sessions</Text>
        <View style={styles.bodyCol}>
          <NumberRow label="Longueur minimale du mot de passe" unit="caractères" keyName="minPasswordLength" value={draft.minPasswordLength} onChange={set} />
          <ToggleRow label="Majuscule obligatoire" keyName="requireMixedCase" value={draft.requireMixedCase} onChange={set} />
          <ToggleRow label="Chiffre obligatoire" keyName="requireDigit" value={draft.requireDigit} onChange={set} />
          <NumberRow label="Longueur maximale du mot de passe" unit="caractères" keyName="maxPasswordLength" value={draft.maxPasswordLength} onChange={set} />
          <NumberRow label="Tentatives de connexion autorisées" unit="essais" keyName="maxLoginAttempts" value={draft.maxLoginAttempts} onChange={set} />
          <NumberRow label="Durée de session" unit="h" keyName="sessionTimeoutHours" value={draft.sessionTimeoutHours} onChange={set} />
          <ToggleRow label="Authentification à double facteur obligatoire" keyName="require2FA" value={draft.require2FA} onChange={set} />
        </View>
      </View>

      <View style={styles.subBox}>
        <Text style={styles.subTitle}>Codes de transfert</Text>
        <View style={styles.bodyCol}>
          <ToggleRow label="Activer les codes de transfert" keyName="transferCodesEnabled" value={draft.transferCodesEnabled} onChange={set} />
          {expanded ? (
            <>
              <View style={styles.twoCol}>
                <NumberRow label="Montant minimal" unit="€" keyName="transferCodeMinAmount" value={draft.transferCodeMinAmount} onChange={set} />
                <NumberRow label="Montant maximal" unit="€" keyName="transferCodeMaxAmount" value={draft.transferCodeMaxAmount} onChange={set} />
              </View>
              <NumberRow label="Durée de vie des codes" unit="min" keyName="transferCodeTtlMinutes" value={draft.transferCodeTtlMinutes} onChange={set} />
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function PlayersEditor({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <View style={styles.bodyCol}>
      <NumberRow label="Plafond de mise manuel par défaut" unit="€" keyName="defaultManualStakeLimit" value={draft.defaultManualStakeLimit} onChange={set} />
      <NumberRow
        label="Seuil VIP"
        unit="€"
        hint="Profit net minimal pour atteindre le niveau VIP"
        keyName="vipThresholdNetProfit"
        value={draft.vipThresholdNetProfit}
        onChange={set}
      />
    </View>
  );
}

function humanizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Styles                                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { paddingBottom: 24 },
  loaderBox: { paddingVertical: 48, alignItems: "center" },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 14,
  },
  heroTitle: { fontSize: 14, fontWeight: "700", color: COLORS.ink },
  heroSub: { marginTop: 6, fontSize: 11.5, lineHeight: 17, color: COLORS.dim },
  refreshBtn: {
    marginTop: 12,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(51,65,85,0.85)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  refreshBtnText: { fontSize: 11, fontWeight: "500", color: "#ffffff" },
  groupWrap: { marginTop: 20 },
  groupHead: { marginBottom: 8 },
  groupTitle: { fontSize: 12, fontWeight: "700", color: COLORS.ink },
  groupDesc: { marginTop: 2, fontSize: 10, color: COLORS.dim },
  groupGrid: { gap: 12 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 14,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 12.5, fontWeight: "700", color: COLORS.ink, flex: 1 },
  saveBtn: {
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.ink,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  saveBtnText: { fontSize: 10.5, fontWeight: "500", color: "#ffffff" },
  cardDesc: { marginTop: 4, fontSize: 10.5, lineHeight: 15, color: COLORS.dim },
  cardBody: { marginTop: 10, gap: 10 },
  expandBtn: {
    marginTop: 10,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(244,245,247,0.8)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  expandBtnText: { fontSize: 10.5, fontWeight: "500", color: COLORS.ink },
  chevronUp: { transform: [{ rotate: "180deg" }] },
  bodyCol: { gap: 8 },
  fieldLabel: { fontSize: 11, fontWeight: "500", color: COLORS.ink },
  unitInline: { fontSize: 10, fontWeight: "400", color: COLORS.dim },
  hint: { fontSize: 10, color: COLORS.dim, marginTop: -2 },
  inputWrap: { gap: 4 },
  input: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    fontSize: 12.5,
    color: COLORS.ink,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toggleLabel: { fontSize: 11.5, fontWeight: "500", color: COLORS.ink, flex: 1 },
  twoCol: { flexDirection: "row", gap: 10 },
  subBox: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(248,250,252,0.85)",
    padding: 12,
  },
  subTitle: { fontSize: 10.5, fontWeight: "600", color: COLORS.dim, marginBottom: 8 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierLabel: { fontSize: 10.5, color: COLORS.dim, width: 70 },
  tierUnit: { fontSize: 10, color: COLORS.dim },
  marketGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  marketCell: {
    width: "48%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    padding: 8,
    gap: 4,
  },
  marketLabel: { fontSize: 10, fontWeight: "500", color: COLORS.ink },
  rateCell: {
    width: "48%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    padding: 8,
    gap: 4,
  },
  rateCode: { fontSize: 10, fontWeight: "600", color: COLORS.ink },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: {
    height: 32,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeActive: { backgroundColor: "rgba(22,163,74,0.12)" },
  badgeOff: { backgroundColor: "rgba(226,232,240,0.9)" },
  badgeText: { fontSize: 10.5, fontWeight: "500", color: "rgba(87,96,106,0.9)" },
  badgeTextActive: { color: "rgba(21,128,61,0.95)" },
  accountBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(255,255,255,0.6)",
    padding: 10,
    gap: 6,
  },
  accountHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  accountTitle: { fontSize: 10.5, fontWeight: "500", color: COLORS.dim, flex: 1 },
  deleteText: { fontSize: 10, fontWeight: "600", color: "#dc2626" },
  feeBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(255,255,255,0.6)",
    padding: 10,
    gap: 6,
  },
  presetBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    padding: 10,
    gap: 6,
  },
  presetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  presetCode: { fontSize: 11, fontWeight: "600", color: COLORS.ink },
  addBtn: {
    marginTop: 6,
    height: 34,
    borderRadius: 8,
    backgroundColor: "rgba(51,65,85,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { fontSize: 10.5, fontWeight: "500", color: "#ffffff" },
  applyBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(51,65,85,0.85)",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  applyBtnText: { fontSize: 10.5, fontWeight: "500", color: "#ffffff" },
  colorRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: COLORS.edge },
  swatchActive: { borderColor: COLORS.ink },
  swatchPreview: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: COLORS.edge },
  toast: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  toastOk: { backgroundColor: "#ffffff", borderColor: "rgba(22,163,74,0.4)" },
  toastErr: { backgroundColor: "#ffffff", borderColor: "rgba(220,38,38,0.4)" },
  toastTitle: { fontSize: 11, fontWeight: "600", color: "#0f172a" },
  toastMsg: { fontSize: 10, color: COLORS.dim, marginTop: 2 },
});
