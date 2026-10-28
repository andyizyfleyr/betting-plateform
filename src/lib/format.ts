import {
  DEFAULT_CURRENCY_CODE,
  formatEurAsCurrency,
  normalizeCurrencyCode,
  type CurrencyCode,
} from "./countries";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

let activeDisplayCurrency: CurrencyCode = DEFAULT_CURRENCY_CODE;
const currencyListeners = new Set<() => void>();

export function getActiveDisplayCurrency(): CurrencyCode {
  return activeDisplayCurrency;
}

export function setActiveDisplayCurrency(next: unknown): void {
  const normalized = normalizeCurrencyCode(next, DEFAULT_CURRENCY_CODE);
  if (normalized === activeDisplayCurrency) return;
  activeDisplayCurrency = normalized;
  for (const listener of currencyListeners) {
    listener();
  }
}

export function subscribeActiveDisplayCurrency(listener: () => void): () => void {
  currencyListeners.add(listener);
  return () => {
    currencyListeners.delete(listener);
  };
}

/**
 * Formate un montant pivot interne (stocké en EUR) dans la devise officielle active du joueur
 * (ou dans `currencyOverride` si fourni explicitement).
 */
export function eur(value: number, currencyOverride?: CurrencyCode): string {
  return formatEurAsCurrency(
    value,
    currencyOverride ?? activeDisplayCurrency
  );
}

/** Formate explicitement en pivot comptable EUR (ex: reporting global Admin). */
export function eurPivot(value: number): string {
  return formatEurAsCurrency(value, "EUR");
}

export function formatOdds(odds: number, format: "decimal" | "fractional" = "decimal") {
  if (format === "fractional") return decimalToFraction(odds);
  return odds.toFixed(2).replace(".", ",");
}

/** Convertit une cote décimale en fractionnelle (ex: 1.50 -> "1/2"). */
export function decimalToFraction(decimal: number) {
  const target = decimal - 1;
  let bestN = 1;
  let bestD = 1;
  let bestErr = Infinity;
  for (let d = 1; d <= 32; d++) {
    const n = Math.round(target * d);
    const err = Math.abs(n / d - target);
    if (err < bestErr && n > 0) {
      bestErr = err;
      bestN = n;
      bestD = d;
    }
  }
  return `${bestN}/${bestD}`;
}

/** "Dans 40 s" | "Dans 2 min" | "Aujourd'hui · 21:00" | "Demain · 18:30" | "sam. 14 juin · 20:45" */
export function formatKickoff(iso: string | Date) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs > -30_000 && diffMs <= 15 * 60_000) {
    if (diffMs <= 5_000) return "Imminent";
    const secs = Math.round(diffMs / 1_000);
    if (secs < 60) return `Dans ${secs} s`;
    const mins = Math.ceil(secs / 60);
    return `Dans ${mins} min`;
  }

  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  if (diffDays === 0) return `Aujourd'hui · ${time}`;
  if (diffDays === 1) return `Demain · ${time}`;
  if (diffDays === -1) return `Hier · ${time}`;
  const day = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  return `${day} · ${time}`;
}

export function formatPlacedAt(iso: string | Date) {
  const date = new Date(iso);
  const nowMs = Date.now();
  const diff = nowMs - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function initials(team: string) {
  const clean = team.replace(/[^A-Za-zÀ-ÿ ]/g, "").trim();
  const words = clean.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + (words[1][0] ?? "")).toUpperCase();
}

/** Teinte déterministe par équipe pour les avatars dégradés. */
export function teamHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function todayLabel() {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}
