const DAYS_SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const DAYS_LONG = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];
const MONTHS_SHORT = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
const MONTHS_LONG = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

import {
  DEFAULT_CURRENCY_CODE,
  formatEurAsCurrency,
  normalizeCurrencyCode,
  type CurrencyCode,
} from "./countries";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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

export function eur(value: number, currencyOverride?: CurrencyCode): string {
  return formatEurAsCurrency(
    value,
    currencyOverride ?? activeDisplayCurrency
  );
}

export function eurPivot(value: number): string {
  return formatEurAsCurrency(value, "EUR");
}

export function formatOdds(
  odds: number,
  format: "decimal" | "fractional" = "decimal"
): string {
  const safe = Number.isFinite(odds) ? odds : 1;
  if (format === "fractional") return decimalToFraction(safe);
  return safe.toFixed(2).replace(".", ",");
}

export function decimalToFraction(decimal: number): string {
  const target = Math.max(0.01, decimal - 1);
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

export function formatKickoff(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs > -30_000 && diffMs <= 15 * 60_000) {
    if (diffMs <= 5_000) return "Imminent";
    const secs = Math.round(diffMs / 1_000);
    if (secs < 60) return `Dans ${secs} s`;
    const mins = Math.ceil(secs / 60);
    return `Dans ${mins} min`;
  }

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  if (diffDays === 0) return `Aujourd'hui · ${time}`;
  if (diffDays === 1) return `Demain · ${time}`;
  if (diffDays === -1) return `Hier · ${time}`;
  return `${DAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} · ${time}`;
}

export function formatMatchDateTimeShort(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} · ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatPlacedAt(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatFullDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} · ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function initials(team: string): string {
  const clean = team.replace(/[^A-Za-zÀ-ÿ ]/g, "").trim();
  if (!clean) return "FC";
  const words = clean.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + (words[1][0] ?? "")).toUpperCase();
}

export function teamHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

export function todayLabel(): string {
  const d = new Date();
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

export function formatDayHeading(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "Récemment";
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === -1) return "Hier";
  if (diffDays === 1) return "Demain";
  return `${DAYS_LONG[date.getDay()]} ${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`;
}
