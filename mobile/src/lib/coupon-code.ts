import AsyncStorage from "@react-native-async-storage/async-storage";

const LOCAL_COUPONS_KEY = "pulsebet_saved_coupons_v1";
const MAX_LOCAL_COUPONS = 25;

export interface SavedCouponSelection {
  uid: string;
  kind: "sport" | "prediction";
  matchId?: number;
  matchSource?: "virtual" | "manual";
  questionId?: number;
  title: string;
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  league: string;
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  startsAt?: string | null;
  isLive?: boolean;
}

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

export async function cacheCouponLocally(
  code: string,
  legs: SavedCouponSelection[]
): Promise<void> {
  try {
    const norm = normalizeCouponCode(code);
    if (!norm) return;
    const raw = await AsyncStorage.getItem(LOCAL_COUPONS_KEY);
    const map: Record<string, SavedCouponSelection[]> = raw ? JSON.parse(raw) : {};
    delete map[norm];
    map[norm] = legs;
    const keys = Object.keys(map);
    while (keys.length > MAX_LOCAL_COUPONS) {
      const oldest = keys.shift();
      if (oldest) delete map[oldest];
    }
    await AsyncStorage.setItem(LOCAL_COUPONS_KEY, JSON.stringify(map));
  } catch {
    /* silencieux */
  }
}

export async function getLocalCachedCoupon(
  code: string
): Promise<SavedCouponSelection[] | null> {
  try {
    const norm = normalizeCouponCode(code);
    if (!norm) return null;
    const raw = await AsyncStorage.getItem(LOCAL_COUPONS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, SavedCouponSelection[]>;
    const found = map[norm];
    return Array.isArray(found) && found.length > 0 ? found : null;
  } catch {
    return null;
  }
}
