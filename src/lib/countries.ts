/**
 * Système multi-pays & devises officielles (partagé Web, API & Android).
 *
 * Principes :
 *  1. Chaque pays est lié automatiquement et exclusivement à sa devise officielle ISO 4217.
 *  2. Toute la comptabilité interne PostgreSQL (`balance`, `stake`, `potentialWin`, `deposits.amount`,
 *     `withdrawals.amount`) reste stockée en pivot `EUR` haute précision (`roundEurPivot`, 6 décimales)
 *     afin de garantir un aller-retour local -> EUR -> local sans perte d'arrondi (0 dérive sur XOF/GNF/CDF/NGN)
 *     et des statistiques Admin / gestion du risque 100 % unifiées.
 *  3. Les paliers rapides, mises par défaut, plafonds et messages de validation s'adaptent
 *     automatiquement à la devise officielle du joueur.
 */

export type CurrencyCode =
  | "EUR"
  | "XOF"
  | "XAF"
  | "USD"
  | "CAD"
  | "GBP"
  | "CHF"
  | "MAD"
  | "DZD"
  | "TND"
  | "CDF"
  | "GNF"
  | "NGN"
  | "GHS"
  | "KES"
  | "RWF"
  | "MGA"
  | "ZAR"
  | "EGP";

export type RegionName = "Afrique" | "Europe" | "Amérique du Nord";

export interface CurrencyConfig {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimals: 0 | 2;
  /** Taux officiel : 1 EUR = `rateFromEur` unités de la devise locale. */
  rateFromEur: number;
  /** 4 paliers rapides pour les coupons de paris (simple, combiné, prédiction). */
  stakePresets: readonly [number, number, number, number];
  /** 5 paliers rapides pour les mini-jeux (/tap & /accelerator). */
  miniGamePresets: readonly [number, number, number, number, number];
  defaultStakeLocal: number;
  minStakeLocal: number;
  maxComboStakeLocal: number;
  maxPredictionStakeLocal: number;
  minMiniGameLocal: number;
  maxTapLocal: number;
  maxAccelLocal: number;
  /** Paliers & bornes de dépôt en devise locale. */
  depositPresetsLocal: readonly [number, number, number, number, number];
  defaultDepositLocal: number;
  minDepositLocal: number;
  maxDepositLocal: number;
  /** Paliers & bornes de retrait en devise locale. */
  withdrawalPresetsLocal: readonly [number, number, number];
  defaultWithdrawalLocal: number;
  minWithdrawalLocal: number;
  maxWithdrawalLocal: number;
  /** Plafond de saisie numérique dans le pavé tactile. */
  maxInputLocal: number;
  maxInputDigits: number;
}

export interface CountryConfig {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
  region: RegionName;
  currency: CurrencyCode;
  featured?: boolean;
  mobileMoneyHint: string;
}

export const DEFAULT_COUNTRY_CODE = "FR";
export const DEFAULT_CURRENCY_CODE: CurrencyCode = "EUR";

export const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  EUR: {
    code: "EUR",
    name: "Euro",
    symbol: "€",
    decimals: 2,
    rateFromEur: 1,
    stakePresets: [5, 10, 25, 50],
    miniGamePresets: [1, 2, 5, 10, 25],
    defaultStakeLocal: 10,
    minStakeLocal: 0.5,
    maxComboStakeLocal: 200,
    maxPredictionStakeLocal: 500,
    minMiniGameLocal: 0.5,
    maxTapLocal: 100,
    maxAccelLocal: 50,
    depositPresetsLocal: [10, 25, 50, 100, 250],
    defaultDepositLocal: 25,
    minDepositLocal: 5,
    maxDepositLocal: 2000,
    withdrawalPresetsLocal: [20, 50, 100],
    defaultWithdrawalLocal: 20,
    minWithdrawalLocal: 10,
    maxWithdrawalLocal: 2500,
    maxInputLocal: 99999,
    maxInputDigits: 5,
  },
  XOF: {
    code: "XOF",
    name: "Franc CFA (BCEAO)",
    symbol: "FCFA",
    decimals: 0,
    rateFromEur: 655.957,
    stakePresets: [200, 500, 1000, 5000],
    miniGamePresets: [200, 500, 1000, 2500, 5000],
    defaultStakeLocal: 500,
    minStakeLocal: 100,
    maxComboStakeLocal: 130000,
    maxPredictionStakeLocal: 325000,
    minMiniGameLocal: 100,
    maxTapLocal: 65000,
    maxAccelLocal: 32500,
    depositPresetsLocal: [1000, 2000, 5000, 10000, 25000],
    defaultDepositLocal: 5000,
    minDepositLocal: 500,
    maxDepositLocal: 1300000,
    withdrawalPresetsLocal: [2000, 5000, 10000],
    defaultWithdrawalLocal: 5000,
    minWithdrawalLocal: 1000,
    maxWithdrawalLocal: 1500000,
    maxInputLocal: 50000000,
    maxInputDigits: 8,
  },
  XAF: {
    code: "XAF",
    name: "Franc CFA (BEAC)",
    symbol: "FCFA",
    decimals: 0,
    rateFromEur: 655.957,
    stakePresets: [200, 500, 1000, 5000],
    miniGamePresets: [200, 500, 1000, 2500, 5000],
    defaultStakeLocal: 500,
    minStakeLocal: 100,
    maxComboStakeLocal: 130000,
    maxPredictionStakeLocal: 325000,
    minMiniGameLocal: 100,
    maxTapLocal: 65000,
    maxAccelLocal: 32500,
    depositPresetsLocal: [1000, 2000, 5000, 10000, 25000],
    defaultDepositLocal: 5000,
    minDepositLocal: 500,
    maxDepositLocal: 1300000,
    withdrawalPresetsLocal: [2000, 5000, 10000],
    defaultWithdrawalLocal: 5000,
    minWithdrawalLocal: 1000,
    maxWithdrawalLocal: 1500000,
    maxInputLocal: 50000000,
    maxInputDigits: 8,
  },
  USD: {
    code: "USD",
    name: "Dollar américain",
    symbol: "$",
    decimals: 2,
    rateFromEur: 1.08,
    stakePresets: [5, 10, 25, 50],
    miniGamePresets: [1, 2, 5, 10, 25],
    defaultStakeLocal: 10,
    minStakeLocal: 0.5,
    maxComboStakeLocal: 220,
    maxPredictionStakeLocal: 540,
    minMiniGameLocal: 0.5,
    maxTapLocal: 100,
    maxAccelLocal: 50,
    depositPresetsLocal: [10, 25, 50, 100, 250],
    defaultDepositLocal: 25,
    minDepositLocal: 5,
    maxDepositLocal: 2200,
    withdrawalPresetsLocal: [20, 50, 100],
    defaultWithdrawalLocal: 20,
    minWithdrawalLocal: 10,
    maxWithdrawalLocal: 2700,
    maxInputLocal: 99999,
    maxInputDigits: 5,
  },
  CAD: {
    code: "CAD",
    name: "Dollar canadien",
    symbol: "$ CA",
    decimals: 2,
    rateFromEur: 1.5,
    stakePresets: [5, 10, 25, 50],
    miniGamePresets: [1, 2, 5, 10, 25],
    defaultStakeLocal: 10,
    minStakeLocal: 1,
    maxComboStakeLocal: 300,
    maxPredictionStakeLocal: 750,
    minMiniGameLocal: 1,
    maxTapLocal: 150,
    maxAccelLocal: 75,
    depositPresetsLocal: [15, 30, 75, 150, 350],
    defaultDepositLocal: 30,
    minDepositLocal: 10,
    maxDepositLocal: 3000,
    withdrawalPresetsLocal: [25, 75, 150],
    defaultWithdrawalLocal: 25,
    minWithdrawalLocal: 15,
    maxWithdrawalLocal: 3750,
    maxInputLocal: 99999,
    maxInputDigits: 5,
  },
  GBP: {
    code: "GBP",
    name: "Livre sterling",
    symbol: "£",
    decimals: 2,
    rateFromEur: 0.85,
    stakePresets: [5, 10, 25, 50],
    miniGamePresets: [1, 2, 5, 10, 25],
    defaultStakeLocal: 10,
    minStakeLocal: 0.5,
    maxComboStakeLocal: 170,
    maxPredictionStakeLocal: 425,
    minMiniGameLocal: 0.5,
    maxTapLocal: 85,
    maxAccelLocal: 42,
    depositPresetsLocal: [10, 25, 50, 100, 200],
    defaultDepositLocal: 25,
    minDepositLocal: 5,
    maxDepositLocal: 1700,
    withdrawalPresetsLocal: [20, 50, 100],
    defaultWithdrawalLocal: 20,
    minWithdrawalLocal: 10,
    maxWithdrawalLocal: 2100,
    maxInputLocal: 99999,
    maxInputDigits: 5,
  },
  CHF: {
    code: "CHF",
    name: "Franc suisse",
    symbol: "CHF",
    decimals: 2,
    rateFromEur: 0.94,
    stakePresets: [5, 10, 25, 50],
    miniGamePresets: [1, 2, 5, 10, 25],
    defaultStakeLocal: 10,
    minStakeLocal: 0.5,
    maxComboStakeLocal: 190,
    maxPredictionStakeLocal: 470,
    minMiniGameLocal: 0.5,
    maxTapLocal: 95,
    maxAccelLocal: 47,
    depositPresetsLocal: [10, 25, 50, 100, 250],
    defaultDepositLocal: 25,
    minDepositLocal: 5,
    maxDepositLocal: 1900,
    withdrawalPresetsLocal: [20, 50, 100],
    defaultWithdrawalLocal: 20,
    minWithdrawalLocal: 10,
    maxWithdrawalLocal: 2350,
    maxInputLocal: 99999,
    maxInputDigits: 5,
  },
  MAD: {
    code: "MAD",
    name: "Dirham marocain",
    symbol: "MAD",
    decimals: 2,
    rateFromEur: 10.8,
    stakePresets: [10, 25, 50, 100],
    miniGamePresets: [5, 10, 25, 50, 100],
    defaultStakeLocal: 25,
    minStakeLocal: 5,
    maxComboStakeLocal: 2160,
    maxPredictionStakeLocal: 5400,
    minMiniGameLocal: 5,
    maxTapLocal: 1080,
    maxAccelLocal: 540,
    depositPresetsLocal: [50, 100, 250, 500, 1000],
    defaultDepositLocal: 100,
    minDepositLocal: 50,
    maxDepositLocal: 21600,
    withdrawalPresetsLocal: [100, 250, 500],
    defaultWithdrawalLocal: 100,
    minWithdrawalLocal: 100,
    maxWithdrawalLocal: 27000,
    maxInputLocal: 999999,
    maxInputDigits: 6,
  },
  DZD: {
    code: "DZD",
    name: "Dinar algérien",
    symbol: "DA",
    decimals: 0,
    rateFromEur: 146,
    stakePresets: [200, 500, 1000, 2500],
    miniGamePresets: [100, 200, 500, 1000, 2500],
    defaultStakeLocal: 500,
    minStakeLocal: 100,
    maxComboStakeLocal: 29000,
    maxPredictionStakeLocal: 73000,
    minMiniGameLocal: 100,
    maxTapLocal: 14600,
    maxAccelLocal: 7300,
    depositPresetsLocal: [1000, 2000, 5000, 10000, 25000],
    defaultDepositLocal: 2000,
    minDepositLocal: 500,
    maxDepositLocal: 290000,
    withdrawalPresetsLocal: [2000, 5000, 10000],
    defaultWithdrawalLocal: 2000,
    minWithdrawalLocal: 1500,
    maxWithdrawalLocal: 365000,
    maxInputLocal: 9999999,
    maxInputDigits: 7,
  },
  TND: {
    code: "TND",
    name: "Dinar tunisien",
    symbol: "DT",
    decimals: 2,
    rateFromEur: 3.38,
    stakePresets: [5, 10, 25, 50],
    miniGamePresets: [2, 5, 10, 25, 50],
    defaultStakeLocal: 10,
    minStakeLocal: 1,
    maxComboStakeLocal: 675,
    maxPredictionStakeLocal: 1690,
    minMiniGameLocal: 1,
    maxTapLocal: 335,
    maxAccelLocal: 168,
    depositPresetsLocal: [20, 50, 100, 250, 500],
    defaultDepositLocal: 50,
    minDepositLocal: 15,
    maxDepositLocal: 6700,
    withdrawalPresetsLocal: [50, 100, 250],
    defaultWithdrawalLocal: 50,
    minWithdrawalLocal: 30,
    maxWithdrawalLocal: 8400,
    maxInputLocal: 999999,
    maxInputDigits: 6,
  },
  CDF: {
    code: "CDF",
    name: "Franc congolais",
    symbol: "FC",
    decimals: 0,
    rateFromEur: 3050,
    stakePresets: [1000, 2500, 5000, 15000],
    miniGamePresets: [1000, 2500, 5000, 10000, 25000],
    defaultStakeLocal: 2500,
    minStakeLocal: 500,
    maxComboStakeLocal: 610000,
    maxPredictionStakeLocal: 1500000,
    minMiniGameLocal: 500,
    maxTapLocal: 305000,
    maxAccelLocal: 152500,
    depositPresetsLocal: [5000, 15000, 30000, 75000, 150000],
    defaultDepositLocal: 15000,
    minDepositLocal: 3000,
    maxDepositLocal: 6100000,
    withdrawalPresetsLocal: [15000, 30000, 75000],
    defaultWithdrawalLocal: 15000,
    minWithdrawalLocal: 5000,
    maxWithdrawalLocal: 7500000,
    maxInputLocal: 99999999,
    maxInputDigits: 8,
  },
  GNF: {
    code: "GNF",
    name: "Franc guinéen",
    symbol: "FG",
    decimals: 0,
    rateFromEur: 9300,
    stakePresets: [2000, 5000, 10000, 50000],
    miniGamePresets: [2000, 5000, 10000, 25000, 50000],
    defaultStakeLocal: 5000,
    minStakeLocal: 1000,
    maxComboStakeLocal: 1860000,
    maxPredictionStakeLocal: 4650000,
    minMiniGameLocal: 1000,
    maxTapLocal: 930000,
    maxAccelLocal: 465000,
    depositPresetsLocal: [10000, 25000, 50000, 100000, 250000],
    defaultDepositLocal: 50000,
    minDepositLocal: 10000,
    maxDepositLocal: 18600000,
    withdrawalPresetsLocal: [25000, 50000, 100000],
    defaultWithdrawalLocal: 50000,
    minWithdrawalLocal: 20000,
    maxWithdrawalLocal: 23000000,
    maxInputLocal: 99999999,
    maxInputDigits: 8,
  },
  NGN: {
    code: "NGN",
    name: "Naira nigérian",
    symbol: "₦",
    decimals: 0,
    rateFromEur: 1750,
    stakePresets: [500, 1000, 2500, 10000],
    miniGamePresets: [500, 1000, 2500, 5000, 10000],
    defaultStakeLocal: 1000,
    minStakeLocal: 200,
    maxComboStakeLocal: 350000,
    maxPredictionStakeLocal: 875000,
    minMiniGameLocal: 200,
    maxTapLocal: 175000,
    maxAccelLocal: 87500,
    depositPresetsLocal: [2000, 5000, 10000, 25000, 50000],
    defaultDepositLocal: 5000,
    minDepositLocal: 1000,
    maxDepositLocal: 3500000,
    withdrawalPresetsLocal: [5000, 10000, 25000],
    defaultWithdrawalLocal: 5000,
    minWithdrawalLocal: 2000,
    maxWithdrawalLocal: 4300000,
    maxInputLocal: 99999999,
    maxInputDigits: 8,
  },
  GHS: {
    code: "GHS",
    name: "Cedi ghanéen",
    symbol: "GH₵",
    decimals: 2,
    rateFromEur: 16.5,
    stakePresets: [10, 25, 50, 100],
    miniGamePresets: [5, 10, 25, 50, 100],
    defaultStakeLocal: 20,
    minStakeLocal: 2,
    maxComboStakeLocal: 3300,
    maxPredictionStakeLocal: 8250,
    minMiniGameLocal: 2,
    maxTapLocal: 1650,
    maxAccelLocal: 825,
    depositPresetsLocal: [50, 100, 250, 500, 1000],
    defaultDepositLocal: 100,
    minDepositLocal: 20,
    maxDepositLocal: 33000,
    withdrawalPresetsLocal: [100, 250, 500],
    defaultWithdrawalLocal: 100,
    minWithdrawalLocal: 50,
    maxWithdrawalLocal: 41000,
    maxInputLocal: 999999,
    maxInputDigits: 6,
  },
  KES: {
    code: "KES",
    name: "Shilling kényan",
    symbol: "KSh",
    decimals: 0,
    rateFromEur: 140,
    stakePresets: [100, 250, 500, 2000],
    miniGamePresets: [50, 100, 250, 500, 1000],
    defaultStakeLocal: 250,
    minStakeLocal: 50,
    maxComboStakeLocal: 28000,
    maxPredictionStakeLocal: 70000,
    minMiniGameLocal: 50,
    maxTapLocal: 14000,
    maxAccelLocal: 7000,
    depositPresetsLocal: [500, 1000, 2500, 5000, 10000],
    defaultDepositLocal: 1000,
    minDepositLocal: 200,
    maxDepositLocal: 280000,
    withdrawalPresetsLocal: [1000, 2500, 5000],
    defaultWithdrawalLocal: 1000,
    minWithdrawalLocal: 500,
    maxWithdrawalLocal: 350000,
    maxInputLocal: 9999999,
    maxInputDigits: 7,
  },
  RWF: {
    code: "RWF",
    name: "Franc rwandais",
    symbol: "FRw",
    decimals: 0,
    rateFromEur: 1480,
    stakePresets: [500, 1000, 2500, 10000],
    miniGamePresets: [500, 1000, 2500, 5000, 10000],
    defaultStakeLocal: 1000,
    minStakeLocal: 200,
    maxComboStakeLocal: 296000,
    maxPredictionStakeLocal: 740000,
    minMiniGameLocal: 200,
    maxTapLocal: 148000,
    maxAccelLocal: 74000,
    depositPresetsLocal: [2000, 5000, 10000, 25000, 50000],
    defaultDepositLocal: 5000,
    minDepositLocal: 1000,
    maxDepositLocal: 2960000,
    withdrawalPresetsLocal: [5000, 10000, 25000],
    defaultWithdrawalLocal: 5000,
    minWithdrawalLocal: 2000,
    maxWithdrawalLocal: 3700000,
    maxInputLocal: 99999999,
    maxInputDigits: 8,
  },
  MGA: {
    code: "MGA",
    name: "Ariary malgache",
    symbol: "Ar",
    decimals: 0,
    rateFromEur: 5000,
    stakePresets: [1000, 2500, 5000, 25000],
    miniGamePresets: [1000, 2500, 5000, 10000, 25000],
    defaultStakeLocal: 2500,
    minStakeLocal: 1000,
    maxComboStakeLocal: 1000000,
    maxPredictionStakeLocal: 2500000,
    minMiniGameLocal: 1000,
    maxTapLocal: 500000,
    maxAccelLocal: 250000,
    depositPresetsLocal: [5000, 10000, 25000, 50000, 100000],
    defaultDepositLocal: 25000,
    minDepositLocal: 5000,
    maxDepositLocal: 10000000,
    withdrawalPresetsLocal: [10000, 25000, 50000],
    defaultWithdrawalLocal: 25000,
    minWithdrawalLocal: 10000,
    maxWithdrawalLocal: 12500000,
    maxInputLocal: 99999999,
    maxInputDigits: 8,
  },
  ZAR: {
    code: "ZAR",
    name: "Rand sud-africain",
    symbol: "R",
    decimals: 2,
    rateFromEur: 19.5,
    stakePresets: [20, 50, 100, 250],
    miniGamePresets: [10, 20, 50, 100, 250],
    defaultStakeLocal: 50,
    minStakeLocal: 5,
    maxComboStakeLocal: 3900,
    maxPredictionStakeLocal: 9750,
    minMiniGameLocal: 5,
    maxTapLocal: 1950,
    maxAccelLocal: 975,
    depositPresetsLocal: [100, 250, 500, 1000, 2500],
    defaultDepositLocal: 250,
    minDepositLocal: 50,
    maxDepositLocal: 39000,
    withdrawalPresetsLocal: [200, 500, 1000],
    defaultWithdrawalLocal: 200,
    minWithdrawalLocal: 100,
    maxWithdrawalLocal: 48000,
    maxInputLocal: 999999,
    maxInputDigits: 6,
  },
  EGP: {
    code: "EGP",
    name: "Livre égyptienne",
    symbol: "E£",
    decimals: 0,
    rateFromEur: 53,
    stakePresets: [50, 100, 250, 1000],
    miniGamePresets: [25, 50, 100, 250, 500],
    defaultStakeLocal: 100,
    minStakeLocal: 20,
    maxComboStakeLocal: 10600,
    maxPredictionStakeLocal: 26500,
    minMiniGameLocal: 20,
    maxTapLocal: 5300,
    maxAccelLocal: 2650,
    depositPresetsLocal: [250, 500, 1000, 2500, 5000],
    defaultDepositLocal: 500,
    minDepositLocal: 100,
    maxDepositLocal: 106000,
    withdrawalPresetsLocal: [500, 1000, 2500],
    defaultWithdrawalLocal: 500,
    minWithdrawalLocal: 250,
    maxWithdrawalLocal: 132000,
    maxInputLocal: 9999999,
    maxInputDigits: 7,
  },
};

export const COUNTRIES: readonly CountryConfig[] = [
  // --- Afrique (UEMOA — XOF) ---
  {
    code: "BJ",
    name: "Bénin",
    flag: "🇧🇯",
    dialCode: "+229",
    region: "Afrique",
    currency: "XOF",
    featured: true,
    mobileMoneyHint: "MTN / Moov / Celtiis · +229 01 …",
  },
  {
    code: "CI",
    name: "Côte d'Ivoire",
    flag: "🇨🇮",
    dialCode: "+225",
    region: "Afrique",
    currency: "XOF",
    featured: true,
    mobileMoneyHint: "Orange / MTN / Wave / Moov · +225 …",
  },
  {
    code: "SN",
    name: "Sénégal",
    flag: "🇸🇳",
    dialCode: "+221",
    region: "Afrique",
    currency: "XOF",
    featured: true,
    mobileMoneyHint: "Wave / Orange Money / Free · +221 …",
  },
  {
    code: "TG",
    name: "Togo",
    flag: "🇹🇬",
    dialCode: "+228",
    region: "Afrique",
    currency: "XOF",
    featured: true,
    mobileMoneyHint: "TMoney / Flooz · +228 …",
  },
  {
    code: "BF",
    name: "Burkina Faso",
    flag: "🇧🇫",
    dialCode: "+226",
    region: "Afrique",
    currency: "XOF",
    featured: true,
    mobileMoneyHint: "Orange Money / Moov Money · +226 …",
  },
  {
    code: "ML",
    name: "Mali",
    flag: "🇲🇱",
    dialCode: "+223",
    region: "Afrique",
    currency: "XOF",
    mobileMoneyHint: "Orange Money / Moov Money · +223 …",
  },
  {
    code: "NE",
    name: "Niger",
    flag: "🇳🇪",
    dialCode: "+227",
    region: "Afrique",
    currency: "XOF",
    mobileMoneyHint: "Airtel Money / Moov / Zamani · +227 …",
  },
  {
    code: "GW",
    name: "Guinée-Bissau",
    flag: "🇬🇼",
    dialCode: "+245",
    region: "Afrique",
    currency: "XOF",
    mobileMoneyHint: "Orange Money / MTN · +245 …",
  },

  // --- Afrique (CEMAC — XAF) ---
  {
    code: "CM",
    name: "Cameroun",
    flag: "🇨🇲",
    dialCode: "+237",
    region: "Afrique",
    currency: "XAF",
    featured: true,
    mobileMoneyHint: "MTN Mobile Money / Orange Money · +237 …",
  },
  {
    code: "GA",
    name: "Gabon",
    flag: "🇬🇦",
    dialCode: "+241",
    region: "Afrique",
    currency: "XAF",
    mobileMoneyHint: "Airtel Money / Moov Money · +241 …",
  },
  {
    code: "CG",
    name: "Congo-Brazzaville",
    flag: "🇨🇬",
    dialCode: "+242",
    region: "Afrique",
    currency: "XAF",
    mobileMoneyHint: "MTN Mobile Money / Airtel Money · +242 …",
  },
  {
    code: "TD",
    name: "Tchad",
    flag: "🇹🇩",
    dialCode: "+235",
    region: "Afrique",
    currency: "XAF",
    mobileMoneyHint: "Airtel Money / Moov Money · +235 …",
  },
  {
    code: "CF",
    name: "Centrafrique",
    flag: "🇨🇫",
    dialCode: "+236",
    region: "Afrique",
    currency: "XAF",
    mobileMoneyHint: "Orange Money / Telecel · +236 …",
  },
  {
    code: "GQ",
    name: "Guinée équatoriale",
    flag: "🇬🇶",
    dialCode: "+240",
    region: "Afrique",
    currency: "XAF",
    mobileMoneyHint: "Muni Dinero / Mobile Money · +240 …",
  },

  // --- Afrique (Autres devises officielles) ---
  {
    code: "CD",
    name: "RD Congo",
    flag: "🇨🇩",
    dialCode: "+243",
    region: "Afrique",
    currency: "CDF",
    featured: true,
    mobileMoneyHint: "M-Pesa / Airtel Money / Orange · +243 …",
  },
  {
    code: "GN",
    name: "Guinée",
    flag: "🇬🇳",
    dialCode: "+224",
    region: "Afrique",
    currency: "GNF",
    mobileMoneyHint: "Orange Money / MTN MoMo · +224 …",
  },
  {
    code: "MA",
    name: "Maroc",
    flag: "🇲🇦",
    dialCode: "+212",
    region: "Afrique",
    currency: "MAD",
    featured: true,
    mobileMoneyHint: "Cash Plus / Inwi / Orange Money · +212 …",
  },
  {
    code: "DZ",
    name: "Algérie",
    flag: "🇩🇿",
    dialCode: "+213",
    region: "Afrique",
    currency: "DZD",
    mobileMoneyHint: "BaridiMob / CCP · +213 …",
  },
  {
    code: "TN",
    name: "Tunisie",
    flag: "🇹🇳",
    dialCode: "+216",
    region: "Afrique",
    currency: "TND",
    mobileMoneyHint: "D17 / Flouci · +216 …",
  },
  {
    code: "NG",
    name: "Nigeria",
    flag: "🇳🇬",
    dialCode: "+234",
    region: "Afrique",
    currency: "NGN",
    mobileMoneyHint: "OPay / PalmPay / Moniepoint · +234 …",
  },
  {
    code: "GH",
    name: "Ghana",
    flag: "🇬🇭",
    dialCode: "+233",
    region: "Afrique",
    currency: "GHS",
    mobileMoneyHint: "MTN MoMo / Telecel Cash · +233 …",
  },
  {
    code: "KE",
    name: "Kenya",
    flag: "🇰🇪",
    dialCode: "+254",
    region: "Afrique",
    currency: "KES",
    mobileMoneyHint: "M-Pesa / Airtel Money · +254 …",
  },
  {
    code: "RW",
    name: "Rwanda",
    flag: "🇷🇼",
    dialCode: "+250",
    region: "Afrique",
    currency: "RWF",
    mobileMoneyHint: "MTN MoMo / Airtel Money · +250 …",
  },
  {
    code: "MG",
    name: "Madagascar",
    flag: "🇲🇬",
    dialCode: "+261",
    region: "Afrique",
    currency: "MGA",
    mobileMoneyHint: "MVola / Orange Money / Airtel · +261 …",
  },
  {
    code: "ZA",
    name: "Afrique du Sud",
    flag: "🇿🇦",
    dialCode: "+27",
    region: "Afrique",
    currency: "ZAR",
    mobileMoneyHint: "Ozow / Capitec / Mobile Wallet · +27 …",
  },
  {
    code: "EG",
    name: "Égypte",
    flag: "🇪🇬",
    dialCode: "+20",
    region: "Afrique",
    currency: "EGP",
    mobileMoneyHint: "Vodafone Cash / InstaPay · +20 …",
  },

  // --- Europe ---
  {
    code: "FR",
    name: "France",
    flag: "🇫🇷",
    dialCode: "+33",
    region: "Europe",
    currency: "EUR",
    featured: true,
    mobileMoneyHint: "Paylib / Wero / Mobile · +33 …",
  },
  {
    code: "BE",
    name: "Belgique",
    flag: "🇧🇪",
    dialCode: "+32",
    region: "Europe",
    currency: "EUR",
    featured: true,
    mobileMoneyHint: "Payconiq / Bancontact · +32 …",
  },
  {
    code: "CH",
    name: "Suisse",
    flag: "🇨🇭",
    dialCode: "+41",
    region: "Europe",
    currency: "CHF",
    featured: true,
    mobileMoneyHint: "TWINT · +41 …",
  },
  {
    code: "LU",
    name: "Luxembourg",
    flag: "🇱🇺",
    dialCode: "+352",
    region: "Europe",
    currency: "EUR",
    mobileMoneyHint: "Payconiq · +352 …",
  },
  {
    code: "DE",
    name: "Allemagne",
    flag: "🇩🇪",
    dialCode: "+49",
    region: "Europe",
    currency: "EUR",
    mobileMoneyHint: "Wero / Giropay · +49 …",
  },
  {
    code: "ES",
    name: "Espagne",
    flag: "🇪🇸",
    dialCode: "+34",
    region: "Europe",
    currency: "EUR",
    mobileMoneyHint: "Bizum · +34 …",
  },
  {
    code: "IT",
    name: "Italie",
    flag: "🇮🇹",
    dialCode: "+39",
    region: "Europe",
    currency: "EUR",
    mobileMoneyHint: "Postepay / Bancomat Pay · +39 …",
  },
  {
    code: "PT",
    name: "Portugal",
    flag: "🇵🇹",
    dialCode: "+351",
    region: "Europe",
    currency: "EUR",
    mobileMoneyHint: "MB WAY · +351 …",
  },
  {
    code: "NL",
    name: "Pays-Bas",
    flag: "🇳🇱",
    dialCode: "+31",
    region: "Europe",
    currency: "EUR",
    mobileMoneyHint: "iDEAL / Wero · +31 …",
  },
  {
    code: "IE",
    name: "Irlande",
    flag: "🇮🇪",
    dialCode: "+353",
    region: "Europe",
    currency: "EUR",
    mobileMoneyHint: "Revolut / Mobile · +353 …",
  },
  {
    code: "GB",
    name: "Royaume-Uni",
    flag: "🇬🇧",
    dialCode: "+44",
    region: "Europe",
    currency: "GBP",
    mobileMoneyHint: "Faster Payments / Monzo · +44 …",
  },

  // --- Amérique du Nord ---
  {
    code: "CA",
    name: "Canada",
    flag: "🇨🇦",
    dialCode: "+1",
    region: "Amérique du Nord",
    currency: "CAD",
    featured: true,
    mobileMoneyHint: "Virement Interac · +1 …",
  },
  {
    code: "US",
    name: "États-Unis",
    flag: "🇺🇸",
    dialCode: "+1",
    region: "Amérique du Nord",
    currency: "USD",
    featured: true,
    mobileMoneyHint: "Cash App / Venmo / Zelle · +1 …",
  },
] as const;

const COUNTRY_BY_CODE = new Map<string, CountryConfig>(
  COUNTRIES.map((c) => [c.code, c])
);

export function isValidCountryCode(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    COUNTRY_BY_CODE.has(raw.trim().toUpperCase())
  );
}

export function normalizeCountryCode(
  raw: unknown,
  fallback: string = DEFAULT_COUNTRY_CODE
): string {
  if (typeof raw === "string") {
    const clean = raw.trim().toUpperCase();
    if (COUNTRY_BY_CODE.has(clean)) return clean;
  }
  return COUNTRY_BY_CODE.has(fallback) ? fallback : DEFAULT_COUNTRY_CODE;
}

export function getCountryConfig(raw: unknown): CountryConfig {
  const code = normalizeCountryCode(raw);
  return COUNTRY_BY_CODE.get(code) ?? COUNTRIES[0];
}

export function isValidCurrencyCode(raw: unknown): raw is CurrencyCode {
  return (
    typeof raw === "string" &&
    Object.prototype.hasOwnProperty.call(CURRENCIES, raw.trim().toUpperCase())
  );
}

export function normalizeCurrencyCode(
  raw: unknown,
  fallback: CurrencyCode = DEFAULT_CURRENCY_CODE
): CurrencyCode {
  if (typeof raw === "string") {
    const clean = raw.trim().toUpperCase();
    if (isValidCurrencyCode(clean)) return clean;
  }
  return fallback;
}

export function getOfficialCurrencyForCountry(countryCode: unknown): CurrencyCode {
  return getCountryConfig(countryCode).currency;
}

export function getCurrencyConfig(raw: unknown): CurrencyConfig {
  return CURRENCIES[normalizeCurrencyCode(raw)];
}

/**
 * Arrondi haute précision (6 décimales) du pivot interne EUR.
 * Garantit `eurToLocal(localToEur(x)) === x` sans aucune dérive d'arrondi
 * même sur les devises à fort ratio (XOF 655.957, NGN 1750, CDF 3050, GNF 9300).
 */
export function roundEurPivot(eurAmount: number): number {
  if (!Number.isFinite(eurAmount)) return 0;
  return Math.round(eurAmount * 1_000_000) / 1_000_000;
}

/** Convertit un montant pivot EUR en montant arrondi dans la devise officielle cible. */
export function eurToLocal(eurAmount: number, currency: unknown): number {
  if (!Number.isFinite(eurAmount)) return 0;
  const cfg = getCurrencyConfig(currency);
  const raw = eurAmount * cfg.rateFromEur;
  if (cfg.decimals === 0) {
    return Math.round(raw);
  }
  return Math.round(raw * 100) / 100;
}

/**
 * Montant local maximal réellement dépensable à partir d'un solde pivot EUR,
 * arrondi par défaut (avec epsilon anti-flottant) afin que le bouton « MAX »
 * ne dépasse jamais le solde réel du joueur.
 */
export function maxSpendableLocalFromEur(
  balanceEur: number,
  currency: unknown
): number {
  if (!Number.isFinite(balanceEur) || balanceEur <= 0) return 0;
  const cfg = getCurrencyConfig(currency);
  const raw = balanceEur * cfg.rateFromEur;
  if (cfg.decimals === 0) {
    return Math.max(0, Math.floor(raw + 1e-6));
  }
  return Math.max(0, Math.floor((raw + 1e-6) * 100) / 100);
}

/**
 * Convertit une saisie en devise locale vers le pivot interne EUR.
 * Si `balanceEurCap` est fourni et que la saisie correspond au solde max affiché
 * (à la sous-unité près), colle proprement à `balanceEurCap` pour éviter tout faux
 * « Solde insuffisant » dû aux décimales de taux de change.
 */
export function localToEur(
  localAmount: number,
  currency: unknown,
  balanceEurCap?: number
): number {
  if (!Number.isFinite(localAmount) || localAmount <= 0) return 0;
  const cfg = getCurrencyConfig(currency);
  const cleanLocal =
    cfg.decimals === 0
      ? Math.round(localAmount)
      : Math.round(localAmount * 100) / 100;

  if (cfg.rateFromEur === 1) {
    const exactEur = Math.round(cleanLocal * 100) / 100;
    if (
      balanceEurCap !== undefined &&
      balanceEurCap >= 0 &&
      exactEur > balanceEurCap &&
      exactEur - balanceEurCap <= 0.005
    ) {
      return roundEurPivot(balanceEurCap);
    }
    return exactEur;
  }

  const pivot = roundEurPivot(cleanLocal / cfg.rateFromEur);
  if (balanceEurCap !== undefined && balanceEurCap >= 0) {
    const unitStepEur = (cfg.decimals === 0 ? 1 : 0.01) / cfg.rateFromEur;
    if (pivot > balanceEurCap && pivot - balanceEurCap <= unitStepEur * 0.65) {
      return roundEurPivot(balanceEurCap);
    }
  }
  return pivot;
}

/** Formatage déterministe d'un montant DÉJÀ exprimé en devise locale (compatible SSR & Hermes). */
export function formatLocalAmount(
  localAmount: number,
  currency: unknown,
  opts?: { signed?: boolean; forceNoDecimalsIfInt?: boolean }
): string {
  const cfg = getCurrencyConfig(currency);
  const safe = Number.isFinite(localAmount) ? localAmount : 0;
  const rounded =
    cfg.decimals === 0
      ? Math.round(safe)
      : Math.round(safe * 100) / 100;
  const sign =
    rounded < 0 ? "-" : opts?.signed && rounded > 0 ? "+" : "";
  const abs = Math.abs(rounded);

  const showDecimals =
    cfg.decimals > 0 &&
    !(opts?.forceNoDecimalsIfInt && Number.isInteger(abs));

  const fixed = showDecimals ? abs.toFixed(cfg.decimals) : String(Math.round(abs));
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");

  if (showDecimals && decPart !== undefined) {
    return `${sign}${grouped},${decPart} ${cfg.symbol}`;
  }
  return `${sign}${grouped} ${cfg.symbol}`;
}

/** Formate un montant pivot EUR dans la devise officielle cible. */
export function formatEurAsCurrency(
  eurAmount: number,
  currency: unknown,
  opts?: { signed?: boolean }
): string {
  const cfg = getCurrencyConfig(currency);
  const safe = Number.isFinite(eurAmount) ? eurAmount : 0;
  const local = safe * cfg.rateFromEur;
  return formatLocalAmount(local, cfg.code, opts);
}

/** Formate une pastille de mise rapide (ex: « 500 FCFA », « 1 000 FCFA », « 10 € »). */
export function formatPresetChip(localAmount: number, currency: unknown): string {
  return formatLocalAmount(localAmount, currency, {
    forceNoDecimalsIfInt: true,
  });
}

/** Chaîne propre pour pré-remplir un champ de saisie locale (ex: "500" ou "12.5"). */
export function formatLocalInputString(
  localAmount: number,
  currency: unknown,
  decimalSep: "." | "," = "."
): string {
  const cfg = getCurrencyConfig(currency);
  if (!Number.isFinite(localAmount) || localAmount <= 0) return "";
  if (cfg.decimals === 0) {
    return String(Math.round(localAmount));
  }
  const rounded = Math.round(localAmount * 100) / 100;
  const str = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
  return decimalSep === "," ? str.replace(".", ",") : str;
}

const IANA_TIMEZONE_TO_COUNTRY: Record<string, string> = {
  "Africa/Porto-Novo": "BJ",
  "Africa/Cotonou": "BJ",
  "Africa/Abidjan": "CI",
  "Africa/Dakar": "SN",
  "Africa/Lome": "TG",
  "Africa/Ouagadougou": "BF",
  "Africa/Bamako": "ML",
  "Africa/Niamey": "NE",
  "Africa/Bissau": "GW",
  "Africa/Douala": "CM",
  "Africa/Libreville": "GA",
  "Africa/Brazzaville": "CG",
  "Africa/Ndjamena": "TD",
  "Africa/Bangui": "CF",
  "Africa/Malabo": "GQ",
  "Africa/Kinshasa": "CD",
  "Africa/Lubumbashi": "CD",
  "Africa/Conakry": "GN",
  "Africa/Casablanca": "MA",
  "Africa/Algiers": "DZ",
  "Africa/Tunis": "TN",
  "Africa/Lagos": "NG",
  "Africa/Accra": "GH",
  "Africa/Nairobi": "KE",
  "Africa/Kigali": "RW",
  "Indian/Antananarivo": "MG",
  "Africa/Johannesburg": "ZA",
  "Africa/Cairo": "EG",
  "Europe/Paris": "FR",
  "Europe/Brussels": "BE",
  "Europe/Luxembourg": "LU",
  "Europe/Zurich": "CH",
  "Europe/London": "GB",
  "Europe/Berlin": "DE",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Lisbon": "PT",
  "Europe/Amsterdam": "NL",
  "Europe/Dublin": "IE",
  "America/Toronto": "CA",
  "America/Montreal": "CA",
  "America/Vancouver": "CA",
  "America/Halifax": "CA",
  "America/Winnipeg": "CA",
  "America/Edmonton": "CA",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Phoenix": "US",
};

/**
 * Détecte automatiquement le pays probable de l'appareil (fuseau IANA + locale système),
 * avec repli propre sur `FR`.
 */
export function detectCountryFromDevice(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && IANA_TIMEZONE_TO_COUNTRY[tz]) {
      return IANA_TIMEZONE_TO_COUNTRY[tz];
    }
  } catch {
    // ignore
  }
  try {
    const locale =
      typeof navigator !== "undefined" && navigator.language
        ? navigator.language
        : Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) {
      const m = locale.match(/[-_]([A-Za-z]{2})\b/);
      if (m && isValidCountryCode(m[1])) {
        return m[1].toUpperCase();
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_COUNTRY_CODE;
}
