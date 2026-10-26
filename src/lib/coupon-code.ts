import type { ComboSelection } from "@/components/combo-slip";

const LOCAL_COUPONS_KEY = "pulsebet_saved_coupons_v1";
const MAX_LOCAL_COUPONS = 25;

/**
 * Normalise toute saisie utilisateur (ex. « bx84k2 », « 84K2 », « BX-84K2 » ou
 * un lien complet WhatsApp contenant `?code=BX-84K2`) vers un code canonique `BX-XXXX`.
 */
export function normalizeCouponCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const urlMatch = /[?&]code=([A-Za-z0-9_-]+)/i.exec(trimmed);
  const candidate = (urlMatch ? urlMatch[1] : trimmed).trim();

  if (/^BX1-[A-Za-z0-9_-]+$/i.test(candidate)) {
    const [, payload] = candidate.split("-", 2);
    return `BX1-${payload}`;
  }

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

export function cacheCouponLocally(code: string, legs: ComboSelection[]): void {
  if (typeof window === "undefined") return;
  try {
    const norm = normalizeCouponCode(code);
    if (!norm) return;
    const raw = localStorage.getItem(LOCAL_COUPONS_KEY);
    const map: Record<string, ComboSelection[]> = raw ? JSON.parse(raw) : {};
    delete map[norm];
    map[norm] = legs;
    const keys = Object.keys(map);
    while (keys.length > MAX_LOCAL_COUPONS) {
      const oldest = keys.shift();
      if (oldest) delete map[oldest];
    }
    localStorage.setItem(LOCAL_COUPONS_KEY, JSON.stringify(map));
  } catch {
    /* silencieux */
  }
}

export function getLocalCachedCoupon(code: string): ComboSelection[] | null {
  if (typeof window === "undefined") return null;
  try {
    const norm = normalizeCouponCode(code);
    if (!norm) return null;
    const raw = localStorage.getItem(LOCAL_COUPONS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, ComboSelection[]>;
    const found = map[norm];
    return Array.isArray(found) && found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

export function encodeSharePayload(legs: ComboSelection[]): string {
  try {
    const json = JSON.stringify(legs);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return "";
  }
}

export function decodeSharePayload(token: string | null | undefined): ComboSelection[] | null {
  if (!token) return null;
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as ComboSelection[]) : null;
  } catch {
    return null;
  }
}

