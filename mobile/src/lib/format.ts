/**
 * Formateurs français déterministes sans dépendance à `Intl`
 * (compatible à 100 % avec le moteur JSC Android d'Expo Go SDK 42).
 */

const WEEKDAYS_SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const WEEKDAYS_LONG = [
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function eur(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const fixed = abs.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped},${decPart} €`;
}

export function decimalToFraction(decimal: number): string {
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

export function formatOdds(
  odds: number,
  format: "decimal" | "fractional" = "decimal"
): string {
  const safe = Number.isFinite(odds) ? odds : 1;
  if (format === "fractional") return decimalToFraction(safe);
  return safe.toFixed(2).replace(".", ",");
}

export function formatKickoff(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "À venir";
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

  const day = `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return `${day} · ${time}`;
}

export function formatPlacedAt(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function initials(team: string): string {
  const clean = (team || "").replace(/[^A-Za-zÀ-ÿ ]/g, "").trim();
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

export function hslClubBackground(name: string): string {
  const h = teamHue(name);
  return `hsl(${h}, 62%, 42%)`;
}

export function todayLabel(): string {
  const d = new Date();
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}
