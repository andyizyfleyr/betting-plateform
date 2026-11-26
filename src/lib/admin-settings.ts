// Module PURE — client-safe. Types, valeurs par défaut, catalogue et cache
// sync (getAdminSettingSync). Aucun import DB : l'accès DB (pg) est isolé dans
// @/lib/admin-settings-server (server-only), consommé par les routes API.

/**
 * Système central de réglages d'administration (sans redéploiement).
 *
 * Tous les paramètres fonctionnels consommés par les libs (cotes, bonus, paiements,
 * devises, branding…) sont stockés dans la table `admin_settings` sous une clé
 * JSONB. Chaque lib lit sa valeur via `getAdminSetting` ; l'admin édite via l'API
 * `/api/admin/settings` (onglet « Réglages » du backoffice).
 *
 * L'architecture repose sur :
 *  - un `SettingsCatalog` : liste des clés avec leur type + validateur
 *  - `getAdminSetting<T>(key)` : lecture tolérante (retourne le default si absent/invalide)
 *  - `saveAdminSetting<T>(key, value)` : écriture atomique (upsert)
 *  - `getAllAdminSettings()` : snapshot complet pour l'admin
 */

export type AdminSettingKey =
  | "combo_boost"
  | "market_margins"
  | "cashout"
  | "welcome_bonus"
  | "payments"
  | "currency_presets"
  | "currency_rates"
  | "markets_catalog"
  | "virtual_simulator"
  | "branding"
  | "notifications"
  | "security"
  | "players";

/* ------------------------------------------------------------------ */
/* Typedefs et valeurs par défaut                                   */
/* ------------------------------------------------------------------ */

export interface ComboBoostTier {
  legs: number;
  pct: number;
}

export interface ComboBoostSettings {
  enabled: boolean;
  minEligibleOdds: number;
  tiers: ComboBoostTier[];
}

export const DEFAULT_COMBO_BOOST: ComboBoostSettings = {
  enabled: true,
  minEligibleOdds: 1.35,
  tiers: [
    { legs: 3, pct: 3 },
    { legs: 4, pct: 5 },
    { legs: 5, pct: 8 },
    { legs: 6, pct: 12 },
    { legs: 7, pct: 16 },
    { legs: 8, pct: 20 },
  ],
};

export interface MarketMarginSettings {
  default: number;
  markets: Record<string, number>;
}

export const DEFAULT_MARKET_MARGINS: MarketMarginSettings = {
  default: 0.075,
  markets: {
    result: 0.072,
    dnb: 0.072,
    double_chance: 0.074,
    handicap_euro: 0.084,
    btts: 0.078,
    odd_even: 0.078,
    total_ou: 0.078,
    ht_total_ou: 0.08,
    ht_result: 0.082,
    home_total: 0.082,
    away_total: 0.082,
    first_team_to_score: 0.085,
    highest_scoring_half: 0.086,
    goal_range: 0.088,
    result_total: 0.092,
    result_btts: 0.098,
    winning_margin: 0.125,
    home_to_nil: 0.13,
    away_to_nil: 0.13,
    home_clean_sheet: 0.13,
    away_clean_sheet: 0.13,
    total_exact: 0.14,
    ht_ft: 0.145,
    score_exact: 0.19,
  },
};

export interface CashoutSettings {
  enabled: boolean;
  baseFactor: number;
  maxCapPct: number;
  minMinute: number;
  maxMinute: number;
  disabledMarkets: string[];
  disabledMatchIds: number[];
}

export const DEFAULT_CASHOUT: CashoutSettings = {
  enabled: true,
  baseFactor: 0.9,
  maxCapPct: 0.94,
  minMinute: 0,
  maxMinute: 90,
  disabledMarkets: [],
  disabledMatchIds: [],
};

/**
 * Bonus de dépôt : trois paliers seulement (1er dépôt 50 %, 2e 75 %, 3e 100 %),
 * puis plus aucun bonus. Le montant est crédité sur le solde et reste verrouillé
 * jusqu'à ce que le joueur ait misé `wagerMultiplier × bonus` à cote suffisante.
 */
export interface WelcomeBonusSettings {
  enabled: boolean;
  /** Plafond du bonus par dépôt en euros (0 = aucun plafond). 152,449 € ≈ 100 000 FCFA. */
  maxBonus: number;
  wagerMultiplier: number;
  minOddsSingle: number;
  minOddsCombo: number;
  /** Anciens champs conservés pour relire les réglages déjà enregistrés. */
  amount?: number;
  validityDays?: number;
}

/** Paliers de bonus par dépôt, dans l'ordre : 1er, 2e, 3e dépôt. */
export const DEPOSIT_BONUS_PERCENTS = [50, 75, 100] as const;

export const DEFAULT_WELCOME_BONUS: WelcomeBonusSettings = {
  enabled: true,
  /** 152,449 € = 100 000 FCFA (pivot 655,957). */
  maxBonus: 152.449,
  wagerMultiplier: 4,
  minOddsSingle: 1.3,
  minOddsCombo: 1.4,
};

export type PaymentMethodId =
  | "stripe"
  | "paypal"
  | "mobile_money"
  | "sepa"
  | "gift_card";

export interface MobileMoneyAccount {
  country: string;
  label: string;
  number: string;
}

export interface PaymentFeeConfig {
  percent: number;
  fixed: number;
}

export interface PaymentSettings {
  enabledMethods: PaymentMethodId[];
  mobileMoneyAccounts: MobileMoneyAccount[];
  fees: Record<PaymentMethodId, PaymentFeeConfig>;
  minMax: Record<PaymentMethodId, { min: number; max: number }>;
}

export const DEFAULT_PAYMENTS: PaymentSettings = {
  enabledMethods: ["mobile_money", "sepa", "gift_card"],
  mobileMoneyAccounts: [
    { country: "BJ", label: "MoMo Bénin", number: "" },
  ],
  fees: {
    stripe: { percent: 0, fixed: 0 },
    paypal: { percent: 0, fixed: 0 },
    mobile_money: { percent: 0, fixed: 0 },
    sepa: { percent: 0, fixed: 0 },
    gift_card: { percent: 0, fixed: 0 },
  },
  minMax: {
    stripe: { min: 0, max: 0 },
    paypal: { min: 0, max: 0 },
    mobile_money: { min: 0, max: 0 },
    sepa: { min: 0, max: 0 },
    gift_card: { min: 0, max: 0 },
  },
};

export interface CurrencyPreset {
  stakePresets: number[];
  depositPresets: number[];
  withdrawalPresets: number[];
  defaultStake: number;
  defaultDeposit: number;
  defaultWithdrawal: number;
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
  minStake: number;
  maxStake: number;
}

export interface CurrencyPresetsSettings {
  presets: Record<string, CurrencyPreset>;
}

export interface CurrencyRatesSettings {
  rates: Record<string, number>;
}

export const DEFAULT_CURRENCY_RATES: CurrencyRatesSettings = {
  rates: {
    EUR: 1,
    XOF: 655.957,
    XAF: 655.957,
    USD: 1.08,
    CAD: 1.47,
    GBP: 0.86,
    CHF: 0.94,
    MAD: 10.8,
    DZD: 134,
    TND: 3.1,
    CDF: 2800,
    GNF: 9700,
    NGN: 1500,
    GHS: 6,
    KES: 128,
    RWF: 1300,
    MGA: 4600,
    ZAR: 18.5,
    EGP: 48,
  },
};

export interface MarketsCatalogSettings {
  activeMarkets: string[];
  activeLeagues: string[];
}

/**
 * Marchés définitivement retirés de l'offre : ils ne sont plus générés ni
 * proposés à l'activation, mais leur définition reste disponible pour régler
 * les paris déjà pris.
 */
export const RETIRED_MARKETS: readonly string[] = [
  "dnb",
  "handicap_euro",
  "winning_margin",
];

export const DEFAULT_MARKETS_CATALOG: MarketsCatalogSettings = {
  activeMarkets: [
    "result", "double_chance", "btts",
    "odd_even", "total_ou", "ht_total_ou", "ht_result",
    "home_total", "away_total", "first_team_to_score",
    "highest_scoring_half", "goal_range", "result_total",
    "result_btts", "home_to_nil", "away_to_nil",
    "home_clean_sheet", "away_clean_sheet", "total_exact", "ht_ft", "score_exact",
  ],
  activeLeagues: [],
};

export interface VirtualSimulatorSettings {
  enabled: boolean;
  maxLive: number;
  kickoffGapMs: number;
}

export const DEFAULT_VIRTUAL_SIMULATOR: VirtualSimulatorSettings = {
  enabled: true,
  maxLive: 4,
  kickoffGapMs: 48 * 60_000,
};

export interface BrandingSettings {
  siteName: string;
  shortName: string;
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  primaryColor: string;
  banners: Array<{ title: string; subtitle: string; image: string; href: string }>;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  siteName: "Pulse Bet",
  shortName: "Pulse Bet",
  tagline: "Paris sportifs & Prédictions Live",
  heroTitle: "",
  heroSubtitle: "",
  primaryColor: "#e10600",
  banners: [],
};

export interface NotificationSettings {
  enabled: boolean;
  categories: string[];
  pushSubjectPrefix: string;
  emailFooter: string;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  categories: ["bet_won", "bet_lost", "match_live", "payment", "security"],
  pushSubjectPrefix: "Pulse Bet",
  emailFooter: "",
};

export interface SecuritySettings {
  minPasswordLength: number;
  requireMixedCase: boolean;
  requireDigit: boolean;
  maxPasswordLength: number;
  transferCodesEnabled: boolean;
  transferCodeMinAmount: number;
  transferCodeMaxAmount: number;
  transferCodeTtlMinutes: number;
  maxLoginAttempts: number;
  sessionTimeoutHours: number;
  require2FA: boolean;
}

export const DEFAULT_SECURITY: SecuritySettings = {
  minPasswordLength: 8,
  requireMixedCase: false,
  requireDigit: true,
  maxPasswordLength: 128,
  transferCodesEnabled: true,
  transferCodeMinAmount: 0,
  transferCodeMaxAmount: 0,
  transferCodeTtlMinutes: 30,
  maxLoginAttempts: 5,
  sessionTimeoutHours: 72,
  require2FA: false,
};

export interface PlayerManagementSettings {
  defaultManualStakeLimit: number;
  vipThresholdNetProfit: number;
}

export const DEFAULT_PLAYERS: PlayerManagementSettings = {
  defaultManualStakeLimit: 0,
  vipThresholdNetProfit: 1000,
};

/* ------------------------------------------------------------------ */
/* Catalogue des clés avec validateurs                              */
/* ------------------------------------------------------------------ */

export const ADMIN_SETTINGS_CATALOG: Record<
  AdminSettingKey,
  { label: string; description: string; default: Record<string, unknown>; validate: (v: unknown) => boolean }
> = {
  combo_boost: {
    label: "Bonus Combiné",
    description: "Paliers de gain des combinés et cote min éligible",
    default: DEFAULT_COMBO_BOOST as unknown as Record<string, unknown>,
    validate: (v) => {
      if (!v || typeof v !== "object") return false;
      const t = (v as ComboBoostSettings).tiers;
      return Array.isArray(t) && t.every((x) => typeof x.legs === "number" && typeof x.pct === "number");
    },
  },
  market_margins: {
    label: "Marges bookmaker",
    description: "Marge par type de marché et par défaut",
    default: DEFAULT_MARKET_MARGINS as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object" && typeof (v as MarketMarginSettings).default === "number",
  },
  cashout: {
    label: "Cash Out",
    description: "Activation, marge, plafond et matchs exclus",
    default: DEFAULT_CASHOUT as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  welcome_bonus: {
    label: "Bonus de bienvenue",
    description: "Montant, wager et conditions de déblocage",
    default: DEFAULT_WELCOME_BONUS as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  payments: {
    label: "Moyens de paiement",
    description: "Méthodes actives, numéros MoMo, frais et seuils",
    default: DEFAULT_PAYMENTS as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  currency_presets: {
    label: "Paliers par devise",
    description: "Paliers rapides et bornes dépôt/retrait par devise",
    default: { presets: {} } as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  currency_rates: {
    label: "Taux de change",
    description: "1 EUR = rate pour chaque devise",
    default: DEFAULT_CURRENCY_RATES as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object" && !!(v as CurrencyRatesSettings).rates,
  },
  markets_catalog: {
    label: "Marchés & ligues",
    description: "Marchés actifs et compétitions proposées",
    default: DEFAULT_MARKETS_CATALOG as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  virtual_simulator: {
    label: "Simulateur virtuel",
    description: "Nombre de matchs live simultanés et fréquence des coups d'envoi",
    default: DEFAULT_VIRTUAL_SIMULATOR as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  branding: {
    label: "Branding",
    description: "Nom, couleurs, hero et bannières promo",
    default: DEFAULT_BRANDING as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  notifications: {
    label: "Notifications",
    description: "Catégories actives, prefix push et footer e-mail",
    default: DEFAULT_NOTIFICATIONS as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  security: {
    label: "Sécurité",
    description: "Mot de passe, codes de transfert, sessions, 2FA",
    default: DEFAULT_SECURITY as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
  players: {
    label: "Gestion joueurs",
    description: "Plafonds manuels et seuil VIP",
    default: DEFAULT_PLAYERS as unknown as Record<string, unknown>,
    validate: (v) => !!v && typeof v === "object",
  },
};

/* ------------------------------------------------------------------ */
/* Cache en mémoire (0 requête DB par lecture dans le hot path)       */
/* ------------------------------------------------------------------ */

const SETTINGS_CACHE_TTL_MS = 30_000;
export const settingsCache = new Map<AdminSettingKey, { at: number; value: Record<string, unknown> }>();
export let settingsAllCache: { at: number; value: Record<AdminSettingKey, Record<string, unknown>> } | null = null;

/** Invalide le cache (appelé après chaque écriture admin). */
export function invalidateAdminSettingsCache(): void {
  settingsCache.clear();
  settingsAllCache = null;
}

/**
 * Setter pour le cache snapshot (la réaffectation directe d'un binding importé
 * est interdite par Turbopack/ESM ; la mutation passe par cette fonction).
 */
export function setSettingsAllCache(
  value: { at: number; value: Record<AdminSettingKey, Record<string, unknown>> } | null
): void {
  settingsAllCache = value;
}


/**
 * Lecture tolérante SYNC du cache (0 requête DB). Retourne la valeur chaudée
 * si disponible, sinon le default. Les fonctions sync en hot path (calcul des
 * cotes, marges, marchés actifs…) l'utilisent ; le cache est réchauffé côté
 * serveur par `warmAdminSettingsCache` (admin-settings-server) et invalidé
 * par `saveAdminSetting`.
 */
export function cachedOrDefault<K extends AdminSettingKey>(key: K): Record<string, unknown> {
  const hit = settingsCache.get(key);
  if (hit) return hit.value;
  return ADMIN_SETTINGS_CATALOG[key].default;
}

export function defaultForKey<K extends AdminSettingKey>(key: K): Record<string, unknown> {
  return ADMIN_SETTINGS_CATALOG[key].default;
}

/** Lecture SYNC du cache (0 requête DB). Consommée côté client (markets.ts). */
export function getAdminSettingSync<K extends AdminSettingKey>(key: K): Record<string, unknown> {
  return cachedOrDefault(key);
}
