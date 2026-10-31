export type GiftCardId =
  | "transcash"
  | "pcs"
  | "paysafecard"
  | "neosurf"
  | "amazon"
  | "apple"
  | "visa_gift"
  | "mastercard_gift"
  | "amex_gift";

export interface GiftCardDefinition {
  id: GiftCardId;
  label: string;
  shortLabel: string;
  expectedDigits: number;
  minDigits?: number;
  maxDigits?: number;
  isNumericOnly: boolean;
  placeholder: string;
  hint: string;
  brandColor: string;
}

export const GIFT_CARDS: GiftCardDefinition[] = [
  {
    id: "transcash",
    label: "Transcash (TC)",
    shortLabel: "Transcash",
    expectedDigits: 12,
    isNumericOnly: true,
    placeholder: "1234 5678 9012",
    hint: "12 chiffres",
    brandColor: "#e60014",
  },
  {
    id: "pcs",
    label: "PCS Mastercard",
    shortLabel: "PCS",
    expectedDigits: 10,
    isNumericOnly: true,
    placeholder: "1234 5678 90",
    hint: "10 chiffres",
    brandColor: "#00a3e0",
  },
  {
    id: "paysafecard",
    label: "Paysafecard",
    shortLabel: "Paysafecard",
    expectedDigits: 16,
    isNumericOnly: true,
    placeholder: "0123 4567 8901 2345",
    hint: "16 chiffres",
    brandColor: "#0075c9",
  },
  {
    id: "neosurf",
    label: "Neosurf",
    shortLabel: "Neosurf",
    expectedDigits: 10,
    isNumericOnly: false,
    placeholder: "ABC1234567",
    hint: "10 caractères",
    brandColor: "#00833e",
  },
  {
    id: "amazon",
    label: "Amazon Gift Card",
    shortLabel: "Amazon",
    expectedDigits: 14,
    minDigits: 14,
    maxDigits: 15,
    isNumericOnly: false,
    placeholder: "XXXX-XXXXXX-XXXX",
    hint: "14 ou 15 caractères",
    brandColor: "#ff9900",
  },
  {
    id: "apple",
    label: "Apple Gift Card",
    shortLabel: "Apple",
    expectedDigits: 16,
    isNumericOnly: false,
    placeholder: "X123 4567 89AB CDEF",
    hint: "16 caractères",
    brandColor: "#000000",
  },
  {
    id: "visa_gift",
    label: "Visa Gift Card",
    shortLabel: "Visa Gift",
    expectedDigits: 16,
    isNumericOnly: true,
    placeholder: "4123 4567 8901 2345",
    hint: "16 chiffres",
    brandColor: "#1a1f71",
  },
  {
    id: "mastercard_gift",
    label: "Mastercard Gift Card",
    shortLabel: "Mastercard",
    expectedDigits: 16,
    isNumericOnly: true,
    placeholder: "5123 4567 8901 2345",
    hint: "16 chiffres",
    brandColor: "#eb001b",
  },
  {
    id: "amex_gift",
    label: "American Express Gift Card",
    shortLabel: "Amex Gift",
    expectedDigits: 15,
    isNumericOnly: true,
    placeholder: "3712 345678 90123",
    hint: "15 chiffres",
    brandColor: "#006fcf",
  },
];

export function getGiftCardDef(id: GiftCardId | string): GiftCardDefinition {
  return (
    GIFT_CARDS.find((c) => c.id === id) ??
    GIFT_CARDS[0]
  );
}

export function cleanGiftCardCode(raw: string): string {
  return raw.replace(/[\s\-_.]/g, "").toUpperCase();
}

export function luhnCheck(numStr: string): boolean {
  if (!/^\d+$/.test(numStr)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let digit = parseInt(numStr.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function formatGiftCardDisplay(cardId: GiftCardId, cleaned: string): string {
  if (!cleaned) return "";
  if (cardId === "transcash") {
    return cleaned.match(/.{1,4}/g)?.join(" ") ?? cleaned;
  }
  if (cardId === "pcs") {
    if (cleaned.length <= 4) return cleaned;
    if (cleaned.length <= 8) return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 8)} ${cleaned.slice(8)}`;
  }
  if (cardId === "paysafecard" || cardId === "visa_gift" || cardId === "mastercard_gift" || cardId === "apple") {
    return cleaned.match(/.{1,4}/g)?.join(" ") ?? cleaned;
  }
  if (cardId === "amex_gift") {
    if (cleaned.length <= 4) return cleaned;
    if (cleaned.length <= 10) return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 10)} ${cleaned.slice(10)}`;
  }
  if (cardId === "amazon") {
    if (cleaned.length <= 4) return cleaned;
    if (cleaned.length <= 10) return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 10)}-${cleaned.slice(10)}`;
  }
  return cleaned;
}

export interface GiftCardValidationResult {
  valid: boolean;
  cleaned: string;
  formatted: string;
  error?: string;
  currentLength: number;
  expectedLengthLabel: string;
}

export function validateGiftCard(cardId: GiftCardId, rawCode: string): GiftCardValidationResult {
  const def = getGiftCardDef(cardId);
  const cleaned = cleanGiftCardCode(rawCode);
  const currentLength = cleaned.length;
  const isNumericOnly = def.isNumericOnly;
  const unit = isNumericOnly ? "chiffres" : "caractères";
  const expectedLabel = def.minDigits && def.maxDigits
    ? `${def.minDigits} ou ${def.maxDigits} ${unit}`
    : `${def.expectedDigits} ${unit}`;

  const formatted = formatGiftCardDisplay(cardId, cleaned);

  if (currentLength === 0) {
    return {
      valid: false,
      cleaned,
      formatted,
      error: `Veuillez saisir votre code (${expectedLabel})`,
      currentLength: 0,
      expectedLengthLabel: expectedLabel,
    };
  }

  if (isNumericOnly && !/^\d+$/.test(cleaned)) {
    return {
      valid: false,
      cleaned,
      formatted,
      error: `Ce code ne doit contenir que des chiffres (0-9)`,
      currentLength,
      expectedLengthLabel: expectedLabel,
    };
  }

  if (!isNumericOnly && !/^[A-Z0-9]+$/.test(cleaned)) {
    return {
      valid: false,
      cleaned,
      formatted,
      error: `Ce code ne doit contenir que des lettres et des chiffres`,
      currentLength,
      expectedLengthLabel: expectedLabel,
    };
  }

  if (def.minDigits && def.maxDigits) {
    if (currentLength < def.minDigits) {
      return {
        valid: false,
        cleaned,
        formatted,
        error: `Code incomplet : ${currentLength}/${def.minDigits} caractères requis`,
        currentLength,
        expectedLengthLabel: expectedLabel,
      };
    }
    if (currentLength > def.maxDigits) {
      return {
        valid: false,
        cleaned,
        formatted,
        error: `Code trop long : ${currentLength} caractères (maximum ${def.maxDigits})`,
        currentLength,
        expectedLengthLabel: expectedLabel,
      };
    }
  } else {
    if (currentLength < def.expectedDigits) {
      return {
        valid: false,
        cleaned,
        formatted,
        error: `Code incomplet : ${currentLength}/${def.expectedDigits} ${unit} requis`,
        currentLength,
        expectedLengthLabel: expectedLabel,
      };
    }
    if (currentLength > def.expectedDigits) {
      return {
        valid: false,
        cleaned,
        formatted,
        error: `Code trop long : ${currentLength} ${unit} (exactement ${def.expectedDigits} requis)`,
        currentLength,
        expectedLengthLabel: expectedLabel,
      };
    }
  }

  if (cardId === "visa_gift" || cardId === "mastercard_gift" || cardId === "amex_gift") {
    if (!luhnCheck(cleaned)) {
      return {
        valid: false,
        cleaned,
        formatted,
        error: `Numéro de carte invalide (somme de contrôle Luhn incorrecte)`,
        currentLength,
        expectedLengthLabel: expectedLabel,
      };
    }
  }

  return {
    valid: true,
    cleaned,
    formatted,
    currentLength,
    expectedLengthLabel: expectedLabel,
  };
}

export function isGiftCardProvider(provider?: string | null): boolean {
  if (!provider) return false;
  return (
    provider === "gift_card" ||
    provider.startsWith("gift_card:") ||
    GIFT_CARDS.some((c) => c.id === provider)
  );
}

export function parseGiftCardProvider(provider?: string | null): {
  isGiftCard: boolean;
  cardDef?: GiftCardDefinition;
} {
  if (!provider) return { isGiftCard: false };
  if (provider === "gift_card") return { isGiftCard: true, cardDef: undefined };
  if (provider.startsWith("gift_card:")) {
    const cardId = provider.replace("gift_card:", "") as GiftCardId;
    return { isGiftCard: true, cardDef: getGiftCardDef(cardId) };
  }
  const found = GIFT_CARDS.find((c) => c.id === provider);
  if (found) return { isGiftCard: true, cardDef: found };
  return { isGiftCard: false };
}

