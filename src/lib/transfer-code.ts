/** Codes financiers : le 20e chiffre est un contrôle Luhn, pas une preuve de validité du code. */
export const TRANSFER_CODE_LENGTH = 20;

/** Accepte la saisie et le collage de chiffres avec des séparateurs visuels usuels. */
export function normalizeTransferCode(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, TRANSFER_CODE_LENGTH);
}

export function formatTransferCode(value: string): string {
  return normalizeTransferCode(value).replace(/(\d{4})(?=\d)/g, "$1-");
}

/** Valide exactement 20 chiffres ; les espaces et tirets de présentation sont permis. */
export function isValidTransferCode(value: string): boolean {
  if (!/^[\d\s-]+$/.test(value)) return false;
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{20}$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if ((digits.length - 1 - i) % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
