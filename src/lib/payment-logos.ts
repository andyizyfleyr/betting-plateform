/**
 * Logos des moyens de paiement.
 *
 * Les marques restent la propriété de leurs titulaires. Les fichiers sont
 * servis localement depuis `public/images/payments` afin d'éviter toute
 * dépendance à un CDN externe et de fonctionner hors ligne dans l'app mobile.
 */
export type PaymentBrandId =
  | "paypal"
  | "visa"
  | "mastercard"
  | "amex"
  | "stripe"
  | "sepa"
  | "transcash"
  | "pcs"
  | "paysafecard"
  | "neosurf"
  | "amazon"
  | "apple"
  | "orange_money"
  | "mtn_momo"
  | "moov_money"
  | "wave"
  | "free_money"
  | "airtel_money"
  | "m_pesa"
  | "telecel"
  | "tmoney"
  | "flooz"
  | "celtiis"
  | "zamani"
  | "muni_dinero"
  | "cash_plus"
  | "inwi"
  | "baridimob"
  | "d17"
  | "flouci"
  | "opay"
  | "palmpay"
  | "moniepoint"
  | "mvola"
  | "ozow"
  | "capitec"
  | "vodafone_cash"
  | "instapay"
  | "paylib"
  | "wero"
  | "payconiq"
  | "bancontact"
  | "twint"
  | "giropay"
  | "bizum"
  | "postepay"
  | "bancomat_pay"
  | "mb_way"
  | "ideal"
  | "revolut"
  | "monzo"
  | "interac"
  | "cash_app"
  | "venmo"
  | "zelle"
  | "faster_payments";

export const PAYMENT_BRAND_LABELS: Record<PaymentBrandId, string> = {
  paypal: "PayPal",
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  stripe: "Stripe",
  sepa: "SEPA",
  transcash: "Transcash",
  pcs: "PCS",
  paysafecard: "Paysafecard",
  neosurf: "Neosurf",
  amazon: "Amazon",
  apple: "Apple",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov_money: "Moov Money",
  wave: "Wave",
  free_money: "Free Money",
  airtel_money: "Airtel Money",
  m_pesa: "M-Pesa",
  telecel: "Telecel Cash",
  tmoney: "TMoney",
  flooz: "Flooz",
  celtiis: "Celtiis",
  zamani: "Zamani",
  muni_dinero: "Muni Dinero",
  cash_plus: "Cash Plus",
  inwi: "Inwi",
  baridimob: "BaridiMob",
  d17: "D17",
  flouci: "Flouci",
  opay: "OPay",
  palmpay: "PalmPay",
  moniepoint: "Moniepoint",
  mvola: "MVola",
  ozow: "Ozow",
  capitec: "Capitec",
  vodafone_cash: "Vodafone Cash",
  instapay: "InstaPay",
  paylib: "Paylib",
  wero: "Wero",
  payconiq: "Payconiq",
  bancontact: "Bancontact",
  twint: "TWINT",
  giropay: "Giropay",
  bizum: "Bizum",
  postepay: "Postepay",
  bancomat_pay: "Bancomat Pay",
  mb_way: "MB WAY",
  ideal: "iDEAL",
  revolut: "Revolut",
  monzo: "Monzo",
  interac: "Interac",
  cash_app: "Cash App",
  venmo: "Venmo",
  zelle: "Zelle",
  faster_payments: "Faster Payments",
};

/**
 * Opérateurs Mobile Money réellement proposés dans chaque pays, dans l'ordre
 * d'affichage. Les codes correspondent aux pays de `countries.ts`.
 */
export const MOBILE_MONEY_BRANDS_BY_COUNTRY: Record<string, PaymentBrandId[]> = {
  BJ: ["mtn_momo", "moov_money", "celtiis"],
  CI: ["orange_money", "mtn_momo", "wave", "moov_money"],
  SN: ["wave", "orange_money", "free_money"],
  TG: ["tmoney", "flooz"],
  BF: ["orange_money", "moov_money"],
  ML: ["orange_money", "moov_money"],
  NE: ["airtel_money", "moov_money", "zamani"],
  GW: ["orange_money", "mtn_momo"],
  CM: ["mtn_momo", "orange_money"],
  GA: ["airtel_money", "moov_money"],
  CG: ["mtn_momo", "airtel_money"],
  TD: ["airtel_money", "moov_money"],
  CF: ["orange_money", "telecel"],
  GQ: ["muni_dinero"],
  CD: ["m_pesa", "airtel_money", "orange_money"],
  GN: ["orange_money", "mtn_momo"],
  MA: ["cash_plus", "inwi", "orange_money"],
  DZ: ["baridimob"],
  TN: ["d17", "flouci"],
  NG: ["opay", "palmpay", "moniepoint"],
  GH: ["mtn_momo", "telecel"],
  KE: ["m_pesa", "airtel_money"],
  RW: ["mtn_momo", "airtel_money"],
  MG: ["mvola", "orange_money", "airtel_money"],
  ZA: ["ozow", "capitec"],
  EG: ["vodafone_cash", "instapay"],
  FR: ["paylib", "wero"],
  BE: ["payconiq", "bancontact"],
  CH: ["twint"],
  LU: ["payconiq"],
  DE: ["wero", "giropay"],
  ES: ["bizum"],
  IT: ["postepay", "bancomat_pay"],
  PT: ["mb_way"],
  NL: ["ideal", "wero"],
  IE: ["revolut"],
  GB: ["faster_payments", "monzo"],
  CA: ["interac"],
  US: ["cash_app", "venmo", "zelle"],
};

export function mobileMoneyBrands(countryCode?: string | null): PaymentBrandId[] {
  if (!countryCode) return [];
  return MOBILE_MONEY_BRANDS_BY_COUNTRY[countryCode.toUpperCase()] ?? [];
}

/** Logos à afficher dans la carte d'un moyen de paiement. */
export function paymentBrandsForMethod(
  method: string,
  countryCode?: string | null
): PaymentBrandId[] {
  switch (method) {
    case "paypal":
      return ["paypal"];
    case "stripe":
    case "card":
      return ["visa", "mastercard", "amex"];
    case "sepa":
    case "iban":
    case "bank":
      return ["sepa"];
    case "gift_card":
      // Les logos des cartes cadeaux sont affichés dans le sélecteur dédié,
      // où ils restent lisibles. La carte de méthode garde l’icône cadeau.
      return [];
    case "mobile_money":
      return mobileMoneyBrands(countryCode);
    default:
      return [];
  }
}

/** Logo associé à une carte cadeau. */
export function giftCardBrand(giftCardId: string): PaymentBrandId | null {
  switch (giftCardId) {
    case "transcash":
      return "transcash";
    case "pcs":
      return "pcs";
    case "paysafecard":
      return "paysafecard";
    case "neosurf":
      return "neosurf";
    case "amazon":
      return "amazon";
    case "apple":
      return "apple";
    case "visa_gift":
      return "visa";
    case "mastercard_gift":
      return "mastercard";
    case "amex_gift":
      return "amex";
    default:
      return null;
  }
}
