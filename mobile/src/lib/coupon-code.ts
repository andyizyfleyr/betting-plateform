export function normalizeCouponCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const urlMatch = /[?&]code=([A-Za-z0-9_-]+)/i.exec(trimmed);
  const candidate = (urlMatch ? urlMatch[1] : trimmed).trim();

  if (/^BX1-[A-Za-z0-9_-]+$/i.test(candidate)) {
    const [, payload] = candidate.split("-", 2);
    return `BX1-${payload}`;
  }

  // Les nouveaux codes ont cinq caractères sans préfixe ; les anciens restent valides.
  if (/^[A-Za-z0-9]{5}$/.test(candidate)) return candidate.toUpperCase();

  const embeddedCode = /\bBX-?([A-Z0-9]{4,8})\b/i.exec(candidate);
  if (embeddedCode) {
    return `BX-${embeddedCode[1].toUpperCase()}`;
  }

  const alphaNum = candidate.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!alphaNum) return "";
  if (alphaNum.startsWith("BX") && alphaNum.length >= 6) {
    return `BX-${alphaNum.slice(2, 10)}`;
  }
  return `BX-${alphaNum.slice(0, 8)}`;
}
