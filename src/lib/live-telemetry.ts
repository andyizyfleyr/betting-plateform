import { expectedGoals, hashString, mulberry32 } from "@/db/fixtures";
import { teamHue } from "@/lib/format";
import { minuteNumber } from "@/lib/markets";

function matchStepMs(matchId: number, source?: string | null): number {
  if (source === "manual") return 40_000;
  const h = hashString(`virt-tempo|${matchId}`);
  return 6_240 + (h % (6_400 - 6_240 + 1));
}

export interface MomentumBucket {
  /** Borne supérieure de la tranche de 5 minutes (5, 10, …, 90). */
  minuteEnd: number;
  /** De -100 (domination totale Extérieur) à +100 (domination totale Domicile). 0 si non jouée. */
  value: number;
  played: boolean;
}

export interface LiveMatchTelemetry {
  minute: number;
  possessionHome: number;
  possessionAway: number;
  xgHome: number;
  xgAway: number;
  shotsTotalHome: number;
  shotsTotalAway: number;
  shotsOnTargetHome: number;
  shotsOnTargetAway: number;
  dangerousAttacksHome: number;
  dangerousAttacksAway: number;
  cornersHome: number;
  cornersAway: number;
  savesHome: number;
  savesAway: number;
  /** 18 tranches de 5 minutes (0'-5' jusqu'à 85'-90'). */
  momentum: MomentumBucket[];
  /** Part de pression Domicile sur les 10 dernières minutes (0..100). */
  recentHomePressure: number;
}

export interface MatchColors {
  homePrimary: string;
  homeText: string;
  awayPrimary: string;
  awayText: string;
}

export interface TelemetryMatchInput {
  id: number;
  sport?: string | null;
  source?: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: string | null;
  startsAt: Date | string;
  oddsHome: number;
  oddsAway: number;
  suspended?: boolean;
  redHome?: number | null;
  redAway?: number | null;
  homeForm?: number | null;
  awayForm?: number | null;
  regime?: string | null;
  events?: Array<{ type: string; team: string; minute: number; player?: string }> | null;
  tickHistory?: Array<{
    minute: number;
    market: string;
    selection: string;
    from: number;
    to: number;
  }> | null;
}

interface ClubPalette {
  primary: string;
  text: string;
  alt: string;
  altText: string;
}

/**
 * Couleurs maillots lisibles sur pelouse sombre (#0e4429), avec jeu extérieur
 * authentique en cas de conflit chromatique entre les deux clubs.
 */
const CLUB_PALETTES: Record<string, ClubPalette> = {
  // Ligue 1
  "Paris SG": { primary: "#2563eb", text: "#ffffff", alt: "#f43f5e", altText: "#ffffff" },
  Marseille: { primary: "#38bdf8", text: "#082f49", alt: "#f8fafc", altText: "#0f172a" },
  Lyon: { primary: "#f8fafc", text: "#1e3a8a", alt: "#ef4444", altText: "#ffffff" },
  Monaco: { primary: "#ef4444", text: "#ffffff", alt: "#facc15", altText: "#1e293b" },
  Lille: { primary: "#e11d48", text: "#ffffff", alt: "#f8fafc", altText: "#0f172a" },
  Nice: { primary: "#dc2626", text: "#ffffff", alt: "#e2e8f0", altText: "#0f172a" },
  Lens: { primary: "#facc15", text: "#7f1d1d", alt: "#ef4444", altText: "#ffffff" },
  Rennes: { primary: "#ef4444", text: "#ffffff", alt: "#38bdf8", altText: "#082f49" },
  Brest: { primary: "#f43f5e", text: "#ffffff", alt: "#f8fafc", altText: "#0f172a" },
  Strasbourg: { primary: "#3b82f6", text: "#ffffff", alt: "#f8fafc", altText: "#1e3a8a" },
  Toulouse: { primary: "#a855f7", text: "#ffffff", alt: "#fde047", altText: "#1e1b4b" },
  Nantes: { primary: "#facc15", text: "#14532d", alt: "#f8fafc", altText: "#0f172a" },
  Reims: { primary: "#ef4444", text: "#ffffff", alt: "#e2e8f0", altText: "#0f172a" },
  Montpellier: { primary: "#f97316", text: "#ffffff", alt: "#3b82f6", altText: "#ffffff" },
  Auxerre: { primary: "#f8fafc", text: "#1d4ed8", alt: "#38bdf8", altText: "#082f49" },
  "Saint-Étienne": { primary: "#4ade80", text: "#052e16", alt: "#f8fafc", altText: "#14532d" },

  // Premier League
  Arsenal: { primary: "#ef4444", text: "#ffffff", alt: "#facc15", altText: "#0f172a" },
  "Manchester City": { primary: "#38bdf8", text: "#082f49", alt: "#f43f5e", altText: "#ffffff" },
  Liverpool: { primary: "#dc2626", text: "#ffffff", alt: "#a855f7", altText: "#ffffff" },
  Chelsea: { primary: "#2563eb", text: "#ffffff", alt: "#fde047", altText: "#0f172a" },
  "Aston Villa": { primary: "#be185d", text: "#ffffff", alt: "#38bdf8", altText: "#082f49" },
  Tottenham: { primary: "#f8fafc", text: "#0f172a", alt: "#38bdf8", altText: "#082f49" },
  Newcastle: { primary: "#e2e8f0", text: "#0f172a", alt: "#f97316", altText: "#ffffff" },
  "Manchester United": { primary: "#ef4444", text: "#ffffff", alt: "#f8fafc", altText: "#0f172a" },
  Brighton: { primary: "#3b82f6", text: "#ffffff", alt: "#facc15", altText: "#0f172a" },
  "West Ham": { primary: "#db2777", text: "#ffffff", alt: "#38bdf8", altText: "#082f49" },
  Bournemouth: { primary: "#e11d48", text: "#ffffff", alt: "#fde047", altText: "#0f172a" },

  // Liga
  "Real Madrid": { primary: "#f8fafc", text: "#0f172a", alt: "#f59e0b", altText: "#0f172a" },
  "FC Barcelone": { primary: "#2563eb", text: "#fde047", alt: "#facc15", altText: "#7f1d1d" },
  "Atlético Madrid": { primary: "#ef4444", text: "#ffffff", alt: "#38bdf8", altText: "#082f49" },
  "Athletic Bilbao": { primary: "#ef4444", text: "#ffffff", alt: "#60a5fa", altText: "#082f49" },
  Villarreal: { primary: "#facc15", text: "#0f172a", alt: "#ec4899", altText: "#ffffff" },
  "Real Sociedad": { primary: "#3b82f6", text: "#ffffff", alt: "#f59e0b", altText: "#0f172a" },
  "Real Betis": { primary: "#4ade80", text: "#052e16", alt: "#a855f7", altText: "#ffffff" },
  Gérone: { primary: "#f43f5e", text: "#ffffff", alt: "#38bdf8", altText: "#082f49" },
  "FC Séville": { primary: "#f8fafc", text: "#991b1b", alt: "#ef4444", altText: "#ffffff" },
  Valence: { primary: "#f8fafc", text: "#0f172a", alt: "#f97316", altText: "#ffffff" },

  // Bundesliga
  "Bayern Munich": { primary: "#dc2626", text: "#ffffff", alt: "#f8fafc", altText: "#7f1d1d" },
  Leverkusen: { primary: "#ef4444", text: "#ffffff", alt: "#facc15", altText: "#0f172a" },
  Dortmund: { primary: "#facc15", text: "#0f172a", alt: "#f8fafc", altText: "#0f172a" },
  "RB Leipzig": { primary: "#f8fafc", text: "#be123c", alt: "#ef4444", altText: "#ffffff" },
  Stuttgart: { primary: "#f8fafc", text: "#991b1b", alt: "#facc15", altText: "#0f172a" },
  "Eintracht Francfort": { primary: "#ef4444", text: "#ffffff", alt: "#f8fafc", altText: "#0f172a" },

  // Serie A
  "Inter Milan": { primary: "#2563eb", text: "#ffffff", alt: "#facc15", altText: "#0f172a" },
  Naples: { primary: "#0ea5e9", text: "#ffffff", alt: "#f8fafc", altText: "#0c4a6e" },
  "AC Milan": { primary: "#dc2626", text: "#ffffff", alt: "#f8fafc", altText: "#7f1d1d" },
  Juventus: { primary: "#f8fafc", text: "#0f172a", alt: "#facc15", altText: "#0f172a" },
  Atalanta: { primary: "#3b82f6", text: "#ffffff", alt: "#f97316", altText: "#ffffff" },
  "AS Rome": { primary: "#ea580c", text: "#fde047", alt: "#f8fafc", altText: "#7c2d12" },
  Latium: { primary: "#38bdf8", text: "#082f49", alt: "#facc15", altText: "#0f172a" },
  Fiorentina: { primary: "#8b5cf6", text: "#ffffff", alt: "#f8fafc", altText: "#4c1d95" },
};

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) =>
    lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot((r1 - r2) * 0.9, (g1 - g2) * 1.1, (b1 - b2) * 0.85);
}

function fallbackPalette(team: string): ClubPalette {
  let hue = teamHue(team);
  // Évite le vert gazon (95°..165°) pour que les pions ressortent toujours sur la pelouse
  if (hue >= 95 && hue <= 165) {
    hue = (hue + 95) % 360;
  }
  const altHue = (hue + 150) % 360;
  const finalAltHue = altHue >= 95 && altHue <= 165 ? (altHue + 80) % 360 : altHue;
  return {
    primary: hslToHex(hue, 82, 56),
    text: "#ffffff",
    alt: hslToHex(finalAltHue, 88, 62),
    altText: "#0f172a",
  };
}

export function resolveMatchColors(homeTeam: string, awayTeam: string): MatchColors {
  const home = CLUB_PALETTES[homeTeam] ?? fallbackPalette(homeTeam);
  const away = CLUB_PALETTES[awayTeam] ?? fallbackPalette(awayTeam);

  const clash = colorDistance(home.primary, away.primary) < 120;
  if (!clash) {
    return {
      homePrimary: home.primary,
      homeText: home.text,
      awayPrimary: away.primary,
      awayText: away.text,
    };
  }

  // Bascule l'équipe extérieure sur son maillot away (ou un cyan/or contrasté garanti)
  if (colorDistance(home.primary, away.alt) >= 115) {
    return {
      homePrimary: home.primary,
      homeText: home.text,
      awayPrimary: away.alt,
      awayText: away.altText,
    };
  }

  const emergency = colorDistance(home.primary, "#38bdf8") >= 130 ? "#38bdf8" : "#facc15";
  return {
    homePrimary: home.primary,
    homeText: home.text,
    awayPrimary: emergency,
    awayText: "#0f172a",
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Calcule les statistiques officielles et les 18 barres de Momentum (tranches de 5 min)
 * de manière 100 % déterministe et ancrée sur les vrais événements du match
 * (buts, cartons rouges, régime tactique, cotes, forme).
 */
export function computeMatchTelemetry(match: TelemetryMatchInput): LiveMatchTelemetry {
  const currentMin =
    match.status === "finished"
      ? 90
      : match.status === "upcoming"
        ? 0
        : clamp(minuteNumber(match.minute), 1, 90);

  const { lambdaHome, lambdaAway } = expectedGoals(match.homeTeam, match.awayTeam);
  const baseH = lambdaHome * (match.homeForm ?? 1);
  const baseA = lambdaAway * (match.awayForm ?? 1);

  const events = match.events ?? [];
  const tickHistory = match.tickHistory ?? [];
  const startsSeed =
    match.startsAt instanceof Date
      ? match.startsAt.getTime()
      : new Date(match.startsAt).getTime() || 0;

  let xgH = 0;
  let xgA = 0;
  let shotsTotH = 0;
  let shotsTotA = 0;
  let shotsOnH = 0;
  let shotsOnA = 0;
  let dangerH = 0;
  let dangerA = 0;
  let cornersH = 0;
  let cornersA = 0;

  let runningGoalsH = 0;
  let runningGoalsA = 0;
  let runningRedH = 0;
  let runningRedA = 0;
  let shareSum = 0;

  const bucketPressure = new Array<number>(18).fill(0);
  const bucketMinutes = new Array<number>(18).fill(0);
  const recentShares: number[] = [];

  for (let m = 1; m <= currentMin; m++) {
    const bIdx = Math.min(17, Math.floor((m - 1) / 5));

    // Événements réels inscrits à cette minute
    const minEvents = events.filter((e) => clamp(e.minute, 1, 90) === m);
    let goalHThisMin = 0;
    let goalAThisMin = 0;
    let redHThisMin = 0;
    let redAThisMin = 0;

    for (const ev of minEvents) {
      if (ev.type === "goal") {
        if (ev.team === "home") goalHThisMin += 1;
        else if (ev.team === "away") goalAThisMin += 1;
      } else if (ev.type === "red_card") {
        if (ev.team === "home") redHThisMin += 1;
        else if (ev.team === "away") redAThisMin += 1;
      }
    }

    runningRedH += redHThisMin;
    runningRedA += redAThisMin;

    // Effet du score en cours (poussée de l'équipe menée après la 58e)
    const diff = runningGoalsH - runningGoalsA;
    const chaseH = m >= 58 && diff < 0 ? 1.18 : diff >= 2 ? 0.88 : 1;
    const chaseA = m >= 58 && diff > 0 ? 1.18 : diff <= -2 ? 0.88 : 1;

    // Régime du match
    let tempo = 1;
    let regH = 1;
    let regA = 1;
    if (match.regime === "high_tempo") tempo = 1.2;
    else if (match.regime === "tactical_lock") tempo = 0.82;
    else if (match.regime === "late_drama") tempo = m >= 68 ? 1.35 : 0.88;
    else if (match.regime === "underdog_ambush") {
      if (baseH >= baseA) {
        regH = 0.88;
        regA = 1.24;
      } else {
        regH = 1.24;
        regA = 0.88;
      }
    }

    const effH =
      baseH *
      chaseH *
      regH *
      Math.pow(0.72, Math.max(runningRedH, m === currentMin ? (match.redHome ?? 0) : 0)) *
      (1 + 0.16 * runningRedA);
    const effA =
      baseA *
      chaseA *
      regA *
      Math.pow(0.72, Math.max(runningRedA, m === currentMin ? (match.redAway ?? 0) : 0)) *
      (1 + 0.16 * runningRedH);

    const rng = mulberry32(hashString(`telem-v2|${match.id}|${startsSeed}|${m}`));
    const microWave = (rng() - 0.5) * 0.22;
    const domShare = clamp(effH / Math.max(0.2, effH + effA) + microWave, 0.2, 0.8);

    shareSum += domShare;
    if (m > currentMin - 10) recentShares.push(domShare);

    // 1. Prise en compte exacte des buts réels de la minute
    for (let g = 0; g < goalHThisMin; g++) {
      const q = 0.31 + rng() * 0.29; // xG d'une vraie occasion convertie
      xgH += q;
      shotsTotH += 1;
      shotsOnH += 1;
      dangerH += 1;
    }
    for (let g = 0; g < goalAThisMin; g++) {
      const q = 0.31 + rng() * 0.29;
      xgA += q;
      shotsTotA += 1;
      shotsOnA += 1;
      dangerA += 1;
    }

    // 2. Occasions non converties, tirs hors cadre, corners & attaques dangereuses
    const attackRoll = rng();
    const sideRoll = rng();
    const qualityRoll = rng();
    const cornerRoll = rng();

    if (attackRoll < 0.56 * tempo) {
      const isHomeAtk = sideRoll < domShare;
      if (isHomeAtk) dangerH += 1;
      else dangerA += 1;

      // Environ ~24% des attaques dangereuses aboutissent à un tir hors-but
      if (goalHThisMin + goalAThisMin === 0 && qualityRoll < 0.25 * tempo) {
        const onTarget = rng() < 0.37;
        const shotXg = onTarget ? 0.08 + rng() * 0.14 : 0.03 + rng() * 0.06;
        if (isHomeAtk) {
          shotsTotH += 1;
          if (onTarget) shotsOnH += 1;
          xgH += shotXg;
        } else {
          shotsTotA += 1;
          if (onTarget) shotsOnA += 1;
          xgA += shotXg;
        }
        // Un tir repoussé ou contré génère fréquemment un corner
        if (cornerRoll < 0.42) {
          if (isHomeAtk) cornersH += 1;
          else cornersA += 1;
        }
      } else if (cornerRoll < 0.14 * tempo) {
        if (isHomeAtk) cornersH += 1;
        else cornersA += 1;
      }
    }

    // 3. Calcul du Momentum sur la minute (-100 .. +100)
    let minImpulse = (domShare - 0.5) * 145 + (rng() - 0.5) * 28;
    if (goalHThisMin > 0) minImpulse += 58;
    if (goalAThisMin > 0) minImpulse -= 58;
    if (redHThisMin > 0) minImpulse -= 35;
    if (redAThisMin > 0) minImpulse += 35;

    // Intègre aussi les baisses de cote enregistrées dans tickHistory
    for (const th of tickHistory) {
      if (th.minute === m && th.market === "result") {
        if (th.selection === "home" && th.to < th.from) minImpulse += 18;
        if (th.selection === "away" && th.to < th.from) minImpulse -= 18;
      }
    }

    bucketPressure[bIdx] += clamp(minImpulse, -100, 100);
    bucketMinutes[bIdx] += 1;

    runningGoalsH += goalHThisMin;
    runningGoalsA += goalAThisMin;
  }

  // Garantit la cohérence absolue avec le score affiché (notamment matchs manuels admin)
  const officialGoalsH = match.homeScore ?? 0;
  const officialGoalsA = match.awayScore ?? 0;
  if (shotsOnH < officialGoalsH) {
    const diff = officialGoalsH - shotsOnH;
    shotsOnH = officialGoalsH;
    shotsTotH = Math.max(shotsTotH + diff, shotsOnH);
    xgH += diff * 0.38;
  }
  if (shotsOnA < officialGoalsA) {
    const diff = officialGoalsA - shotsOnA;
    shotsOnA = officialGoalsA;
    shotsTotA = Math.max(shotsTotA + diff, shotsOnA);
    xgA += diff * 0.38;
  }
  shotsTotH = Math.max(shotsTotH, shotsOnH);
  shotsTotA = Math.max(shotsTotA, shotsOnA);
  dangerH = Math.max(dangerH, shotsTotH);
  dangerA = Math.max(dangerA, shotsTotA);

  const possessionHome =
    currentMin > 0
      ? clamp(Math.round((shareSum / currentMin) * 100), 26, 74)
      : clamp(
          Math.round(
            ((1 / Math.max(1.05, match.oddsHome)) /
              (1 / Math.max(1.05, match.oddsHome) + 1 / Math.max(1.05, match.oddsAway))) *
              100
          ),
          30,
          70
        );

  const recentHomePressure =
    recentShares.length > 0
      ? clamp(
          Math.round(
            (recentShares.reduce((s, v) => s + v, 0) / recentShares.length) * 100
          ),
          15,
          85
        )
      : possessionHome;

  const momentum: MomentumBucket[] = Array.from({ length: 18 }, (_, i) => {
    const count = bucketMinutes[i];
    if (count === 0) {
      return { minuteEnd: (i + 1) * 5, value: 0, played: false };
    }
    const avg = bucketPressure[i] / count;
    // Amplifie légèrement pour une lecture graphique nette tout en évitant le 0 plat
    const scaled = clamp(Math.round(avg * 1.25), -98, 98);
    const nonZero = scaled === 0 ? (i % 2 === 0 ? 8 : -8) : scaled;
    return {
      minuteEnd: (i + 1) * 5,
      value: nonZero,
      played: true,
    };
  });

  return {
    minute: currentMin,
    possessionHome,
    possessionAway: 100 - possessionHome,
    xgHome: Math.round(xgH * 100) / 100,
    xgAway: Math.round(xgA * 100) / 100,
    shotsTotalHome: shotsTotH,
    shotsTotalAway: shotsTotA,
    shotsOnTargetHome: shotsOnH,
    shotsOnTargetAway: shotsOnA,
    dangerousAttacksHome: dangerH,
    dangerousAttacksAway: dangerA,
    cornersHome: cornersH,
    cornersAway: cornersA,
    savesHome: Math.max(0, shotsOnA - officialGoalsA),
    savesAway: Math.max(0, shotsOnH - officialGoalsH),
    momentum,
    recentHomePressure,
  };
}

export type PlayActionKind =
  | "goal"
  | "red_card"
  | "halftime"
  | "fulltime"
  | "shot_on_target"
  | "shot_off"
  | "corner"
  | "free_kick"
  | "dangerous_attack"
  | "progression"
  | "build_up"
  | "interception";

export interface TacticalPlayerDot {
  id: string;
  team: "home" | "away";
  role: "gk" | "outfield";
  number: number;
  x: number; // 0 .. 100 (%)
  y: number; // 0 .. 100 (%)
  isCarrier: boolean;
}

export interface LivePlayFrame {
  kind: PlayActionKind;
  side: "home" | "away" | "neutral";
  label: string;
  sublabel: string;
  /** Coordonnées courantes interpolées du ballon en % du terrain (0..100). */
  ballX: number;
  ballY: number;
  /** Point de départ du ballon (passeur / tireur) pour tracer la trajectoire vectorielle. */
  fromX: number;
  fromY: number;
  /** Type de trajectoire SVG à afficher. */
  trajectory: "none" | "pass" | "shot" | "cross" | "free_kick";
  /** Position éventuelle du mur défensif (coup franc offensif). */
  wall?: { x: number; y: number; side: "home" | "away" } | null;
  /** Bandeau d'alerte plein terrain (But, Carton rouge, VAR/Suspension). */
  banner?: {
    type: "goal" | "red_card" | "suspended";
    title: string;
    subtitle: string;
    team?: "home" | "away";
  } | null;
  players: TacticalPlayerDot[];
}

interface KeyframeState {
  kind: PlayActionKind;
  side: "home" | "away" | "neutral";
  ballX: number;
  ballY: number;
  carrierId: string | null;
  label: string;
  sublabel: string;
  trajectory: "none" | "pass" | "shot" | "cross" | "free_kick";
  wall?: { x: number; y: number; side: "home" | "away" } | null;
}

function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Génère une séquence connectée de 6 temps tactiques cohérents (aucun saut brusque) :
 * 0: Relance défense (#4/#5) -> 1: Relais milieu (#6) -> 2: Progression couloir/axe (#8/#10/#7/#11)
 * -> 3: Approche 30m -> 4: Climax (Tir / Corner / Coup franc / Centre) -> 5: Récupération & transition adverse.
 */
function buildConnectedKeyframe(
  match: TelemetryMatchInput,
  telemetry: LiveMatchTelemetry,
  beatIdx: number
): KeyframeState {
  const cycleIdx = Math.floor(beatIdx / 6);
  const step = ((beatIdx % 6) + 6) % 6;

  // Détermine quelle équipe mène ce cycle offensif (en alternant naturellement selon la pression)
  const rng = mulberry32(hashString(`coh-seq-v3|${match.id}|${cycleIdx}`));
  const domShare = telemetry.recentHomePressure / 100;
  const side: "home" | "away" = rng() < domShare ? "home" : "away";
  const oppSide: "home" | "away" = side === "home" ? "away" : "home";

  const teamName = side === "home" ? match.homeTeam : match.awayTeam;
  const oppName = oppSide === "home" ? match.homeTeam : match.awayTeam;
  const prefix = side === "home" ? "h" : "a";
  const oppPrefix = oppSide === "home" ? "h" : "a";
  const ax = (prog: number) => (side === "home" ? prog : 100 - prog);

  // Choix du couloir du cycle : haut (gauche domicile), axe, ou bas (droite domicile)
  const wingRoll = rng();
  const isTopWing = wingRoll < 0.38;
  const isBottomWing = wingRoll > 0.62;
  const climaxRoll = rng();
  const stepRng = mulberry32(hashString(`coh-step-v3|${match.id}|${cycleIdx}|${step}`));

  const redCount = side === "home" ? clamp(match.redHome ?? 0, 0, 3) : clamp(match.redAway ?? 0, 0, 3);
  // Si carton(s) rouge(s), les derniers numéros offensifs (11, 9, 7) sortent : rabat sur un joueur bien présent
  const safeWingNum = (want11: boolean) => {
    if (want11 && redCount === 0) return 11;
    if (!want11 && redCount <= 2) return 7;
    return 8;
  };
  const strikerNum = redCount >= 2 ? 10 : 9;

  if (step === 0) {
    const cbNum = isTopWing ? 4 : 5;
    const y = isTopWing ? 36 + stepRng() * 6 : isBottomWing ? 58 + stepRng() * 6 : 48 + (stepRng() - 0.5) * 8;
    return {
      kind: "build_up",
      side,
      ballX: ax(23 + stepRng() * 6),
      ballY: y,
      carrierId: `${prefix}-${cbNum}`,
      label: `Relance · ${teamName}`,
      sublabel: "Sortie de balle propre",
      trajectory: "pass",
    };
  }

  if (step === 1) {
    const midNum = isTopWing ? 8 : isBottomWing ? 10 : 6;
    const y = isTopWing ? 28 + stepRng() * 8 : isBottomWing ? 64 + stepRng() * 8 : 48 + (stepRng() - 0.5) * 10;
    return {
      kind: "build_up",
      side,
      ballX: ax(41 + stepRng() * 7),
      ballY: y,
      carrierId: `${prefix}-${midNum}`,
      label: `Construction · ${teamName}`,
      sublabel: "Orientation au milieu",
      trajectory: "pass",
    };
  }

  if (step === 2) {
    const useTop = side === "home" ? isTopWing : !isTopWing;
    const carrierNum = isTopWing || isBottomWing ? safeWingNum(!useTop) : 10;
    const y = isTopWing ? 18 + stepRng() * 8 : isBottomWing ? 74 + stepRng() * 8 : 44 + stepRng() * 12;
    return {
      kind: "progression",
      side,
      ballX: ax(59 + stepRng() * 7),
      ballY: y,
      carrierId: `${prefix}-${carrierNum}`,
      label: `Progression · ${teamName}`,
      sublabel: isTopWing || isBottomWing ? "Accélération sur l'aile" : "Percée plein axe",
      trajectory: "pass",
    };
  }

  if (step === 3) {
    if (climaxRoll > 0.85) {
      const fkX = ax(75 + stepRng() * 3);
      const fkY = clamp(34 + stepRng() * 32, 30, 70);
      return {
        kind: "free_kick",
        side,
        ballX: fkX,
        ballY: fkY,
        carrierId: `${prefix}-10`,
        label: `Coup franc offensif · ${teamName}`,
        sublabel: "23m · Mur en place",
        trajectory: "none",
        wall: {
          x: ax(84.5),
          y: clamp(fkY + (50 - fkY) * 0.3, 36, 64),
          side: oppSide,
        },
      };
    }

    if (climaxRoll > 0.68) {
      const topCorner = isTopWing || (!isBottomWing && stepRng() > 0.5);
      const takerNum = safeWingNum(!topCorner);
      return {
        kind: "corner",
        side,
        ballX: ax(98),
        ballY: topCorner ? 6 : 94,
        carrierId: `${prefix}-${takerNum}`,
        label: `Corner · ${teamName}`,
        sublabel: "Joueurs montés dans la surface",
        trajectory: "none",
      };
    }

    const y = isTopWing ? 28 + stepRng() * 10 : isBottomWing ? 62 + stepRng() * 10 : 45 + stepRng() * 10;
    return {
      kind: "dangerous_attack",
      side,
      ballX: ax(74 + stepRng() * 5),
      ballY: y,
      carrierId: `${prefix}-10`,
      label: `Attaque dangereuse · ${teamName}`,
      sublabel: "30 derniers mètres",
      trajectory: "pass",
    };
  }

  if (step === 4) {
    if (climaxRoll > 0.85) {
      return {
        kind: "shot_on_target",
        side,
        ballX: ax(96.5),
        ballY: isTopWing ? 44 : 56,
        carrierId: `${oppPrefix}-1`,
        label: `Coup franc cadré · ${teamName}`,
        sublabel: "Parade du gardien",
        trajectory: "free_kick",
        wall: {
          x: ax(84.5),
          y: 50,
          side: oppSide,
        },
      };
    }

    if (climaxRoll > 0.68) {
      return {
        kind: "shot_on_target",
        side,
        ballX: ax(90 + stepRng() * 5),
        ballY: 46 + stepRng() * 8,
        carrierId: `${prefix}-${strikerNum}`,
        label: `Tête sur corner · ${teamName}`,
        sublabel: "Duel aérien au point de penalty",
        trajectory: "cross",
      };
    }

    if (climaxRoll > 0.4) {
      return {
        kind: "shot_on_target",
        side,
        ballX: ax(96.2),
        ballY: 44 + stepRng() * 12,
        carrierId: `${oppPrefix}-1`,
        label: `Tir cadré ! · ${teamName}`,
        sublabel: "Arrêt décisif du gardien",
        trajectory: "shot",
      };
    }

    return {
      kind: "shot_off",
      side,
      ballX: ax(97.5),
      ballY: isTopWing ? 36 : 64,
      carrierId: null,
      label: `Frappe · ${teamName}`,
      sublabel: "À ras du poteau",
      trajectory: "shot",
    };
  }

  // Step 5 : Récupération propre par la défense / gardien adverse et transition fluide vers le centre
  return {
    kind: "interception",
    side: oppSide,
    ballX: ax(76 - stepRng() * 8),
    ballY: 42 + stepRng() * 16,
    carrierId: `${oppPrefix}-6`,
    label: `Récupération · ${oppName}`,
    sublabel: "Transition collective",
    trajectory: "pass",
  };
}

/**
 * Structure 4-3-3 structurée : [ligne (0=Déf, 1=Mil, 2=Att), yBase %, numéro]
 * Ordre pensé pour qu'en cas de carton rouge (.slice), l'équipe retire un attaquant
 * et conserve sa ligne défensive intacte.
 */
const STRUCTURED_OUTFIELD: Array<[0 | 1 | 2, number, number]> = [
  [0, 17, 2],
  [0, 39, 4],
  [0, 61, 5],
  [0, 83, 3],
  [1, 50, 6],
  [1, 27, 8],
  [1, 73, 10],
  [2, 20, 7],
  [2, 50, 9],
  [2, 80, 11],
];

function computeFormationAtKeyframe(
  match: TelemetryMatchInput,
  kf: KeyframeState
): Map<string, { team: "home" | "away"; role: "gk" | "outfield"; number: number; x: number; y: number }> {
  const redH = clamp(match.redHome ?? 0, 0, 3);
  const redA = clamp(match.redAway ?? 0, 0, 3);
  const homeCount = Math.max(7, 10 - redH);
  const awayCount = Math.max(7, 10 - redA);

  const map = new Map<
    string,
    { team: "home" | "away"; role: "gk" | "outfield"; number: number; x: number; y: number }
  >();

  // Gardiens suivant calmement l'axe vertical du jeu
  const gkShiftY = (kf.ballY - 50) * 0.16;
  map.set("h-1", {
    team: "home",
    role: "gk",
    number: 1,
    x: kf.side === "away" && kf.ballX < 25 ? 4.2 : 5.8,
    y: clamp(50 + gkShiftY, 42, 58),
  });
  map.set("a-1", {
    team: "away",
    role: "gk",
    number: 1,
    x: kf.side === "home" && kf.ballX > 75 ? 95.8 : 94.2,
    y: clamp(50 + gkShiftY, 42, 58),
  });

  if (kf.kind === "halftime" || kf.kind === "fulltime") {
    for (let i = 0; i < homeCount; i++) {
      const [line, yBase, num] = STRUCTURED_OUTFIELD[i];
      map.set(`h-${num}`, {
        team: "home",
        role: "outfield",
        number: num,
        x: 20 + line * 12,
        y: yBase,
      });
    }
    for (let i = 0; i < awayCount; i++) {
      const [line, yBase, num] = STRUCTURED_OUTFIELD[i];
      map.set(`a-${num}`, {
        team: "away",
        role: "outfield",
        number: num,
        x: 80 - line * 12,
        y: 100 - yBase,
      });
    }
    return map;
  }

  // Hauteurs de lignes coordonnées (Défense, Milieu, Attaque coulissent en bloc harmonieux)
  const ballOffset = kf.ballX - 50; // -50 .. +50
  const latShift = (kf.ballY - 50) * 0.24;

  // Bloc Domicile (défend à gauche x=0, attaque vers la droite x=100)
  const homeAttacking = kf.side === "home";
  const homeDefLine = clamp(22 + ballOffset * 0.36 + (homeAttacking ? 4 : -3), 12, 48);
  const homeSpan = homeAttacking ? 17.5 : 12.5; // bloc étiré en possession, resserré en défense
  const homeWidthScale = homeAttacking ? 1.0 : 0.78;

  for (let i = 0; i < homeCount; i++) {
    const [line, yBase, num] = STRUCTURED_OUTFIELD[i];
    let x = homeDefLine + line * homeSpan;
    let y = 50 + (yBase - 50) * homeWidthScale + latShift;

    // Montée coordonnée dans la surface sur corner offensif Domicile
    if (kf.kind === "corner" && homeAttacking && (num === 4 || num === 5 || num === 9 || num === 10)) {
      x = num === 9 ? 89 : num === 4 ? 86 : 83;
      y = num === 4 ? 42 : num === 5 ? 58 : num === 9 ? 49 : 64;
    }

    map.set(`h-${num}`, {
      team: "home",
      role: "outfield",
      number: num,
      x: clamp(x, 9, 93),
      y: clamp(y, 9, 91),
    });
  }

  // Bloc Extérieur (défend à droite x=100, attaque vers la gauche x=0)
  const awayAttacking = kf.side === "away";
  const awayDefLine = clamp(78 + ballOffset * 0.36 + (awayAttacking ? -4 : 3), 52, 88);
  const awaySpan = awayAttacking ? 17.5 : 12.5;
  const awayWidthScale = awayAttacking ? 1.0 : 0.78;

  for (let i = 0; i < awayCount; i++) {
    const [line, yBase, num] = STRUCTURED_OUTFIELD[i];
    const my = 100 - yBase;
    let x = awayDefLine - line * awaySpan;
    let y = 50 + (my - 50) * awayWidthScale + latShift;

    // Montée coordonnée sur corner offensif Extérieur
    if (kf.kind === "corner" && awayAttacking && (num === 4 || num === 5 || num === 9 || num === 10)) {
      x = num === 9 ? 11 : num === 4 ? 14 : 17;
      y = num === 4 ? 42 : num === 5 ? 58 : num === 9 ? 51 : 36;
    }

    map.set(`a-${num}`, {
      team: "away",
      role: "outfield",
      number: num,
      x: clamp(x, 7, 91),
      y: clamp(y, 9, 91),
    });
  }

  // Le porteur désigné accompagne naturellement le ballon sans téléportation d'un autre pion
  if (kf.carrierId && map.has(kf.carrierId)) {
    const c = map.get(kf.carrierId)!;
    if (c.role !== "gk") {
      const offset = c.team === "home" ? -1.3 : 1.3;
      map.set(kf.carrierId, {
        ...c,
        x: clamp(kf.ballX + offset, 3, 97),
        y: clamp(kf.ballY, 5, 95),
      });
    }
  }

  return map;
}

/**
 * Calcule la frame radar temps réel avec interpolation C¹ continue (smoothstep)
 * entre les formations clés : aucun saut de pion, coordination collective fluide.
 */
export function computeLivePlayFrame(
  match: TelemetryMatchInput,
  telemetry: LiveMatchTelemetry,
  nowMs: number
): LivePlayFrame {
  const min = telemetry.minute;
  const events = match.events ?? [];

  // Rythme calme et lisible (~2,2 s à 2,6 s par temps de passe/action)
  const beatDurationMs =
    match.source === "manual"
      ? 2_600
      : 2_150 + (matchStepMs(match.id, match.source) % 240);
  const beatIdx = Math.floor(nowMs / beatDurationMs);
  const u = (nowMs % beatDurationMs) / beatDurationMs;
  const teamEase = smoothstep(u);
  // Le ballon voyage un peu plus vite que la course des joueurs, puis est contrôlé proprement
  const ballEase = smoothstep(clamp((u - 0.06) / 0.78, 0, 1));

  // 1. Match terminé
  if (match.status === "finished" || match.minute === "Terminé") {
    const kf: KeyframeState = {
      kind: "fulltime",
      side: "neutral",
      ballX: 50,
      ballY: 50,
      carrierId: null,
      label: `Terminé · ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`,
      sublabel: "Coup de sifflet final",
      trajectory: "none",
    };
    const form = computeFormationAtKeyframe(match, kf);
    return {
      kind: "fulltime",
      side: "neutral",
      label: kf.label,
      sublabel: kf.sublabel,
      ballX: 50,
      ballY: 50,
      fromX: 50,
      fromY: 50,
      trajectory: "none",
      players: [...form.entries()].map(([id, p]) => ({
        id,
        ...p,
        isCarrier: false,
      })),
    };
  }

  // 2. Mi-temps
  if (match.minute === "MT" || match.minute === "HT") {
    const kf: KeyframeState = {
      kind: "halftime",
      side: "neutral",
      ballX: 50,
      ballY: 50,
      carrierId: null,
      label: `Mi-temps · ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`,
      sublabel: "Pause au vestiaire",
      trajectory: "none",
    };
    const form = computeFormationAtKeyframe(match, kf);
    return {
      kind: "halftime",
      side: "neutral",
      label: kf.label,
      sublabel: kf.sublabel,
      ballX: 50,
      ballY: 50,
      fromX: 50,
      fromY: 50,
      trajectory: "none",
      players: [...form.entries()].map(([id, p]) => ({
        id,
        ...p,
        isCarrier: false,
      })),
    };
  }

  // 3. But tout juste inscrit
  const latestGoal = [...events]
    .reverse()
    .find((e) => e.type === "goal" && Math.abs(e.minute - min) <= 1);

  if (latestGoal && (match.suspended || latestGoal.minute === min)) {
    const isHome = latestGoal.team === "home";
    const teamName = isHome ? match.homeTeam : match.awayTeam;
    const scorer = latestGoal.player
      ? `${latestGoal.player} (${latestGoal.minute}')`
      : `${latestGoal.minute}'`;
    const netX = isHome ? 99 : 1;
    const shotOriginX = isHome ? 84 : 16;
    const shotOriginY = 45 + (hashString(`goal-y|${match.id}|${latestGoal.minute}`) % 11);

    const kf: KeyframeState = {
      kind: "goal",
      side: isHome ? "home" : "away",
      ballX: shotOriginX,
      ballY: shotOriginY,
      carrierId: isHome ? "h-9" : "a-9",
      label: `⚽ BUT ! ${teamName} (${scorer})`,
      sublabel: `Score ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`,
      trajectory: "shot",
    };
    const form = computeFormationAtKeyframe(match, kf);

    return {
      kind: "goal",
      side: isHome ? "home" : "away",
      label: kf.label,
      sublabel: kf.sublabel,
      ballX: netX,
      ballY: 50,
      fromX: shotOriginX,
      fromY: shotOriginY,
      trajectory: "shot",
      banner: {
        type: "goal",
        title: `⚽ BUT · ${teamName.toUpperCase()} !`,
        subtitle: `${scorer}  •  ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`,
        team: isHome ? "home" : "away",
      },
      players: [...form.entries()].map(([id, p]) => ({
        id,
        ...p,
        isCarrier: id === kf.carrierId,
      })),
    };
  }

  // 4. Interpolation continue entre l'état clé (beatIdx - 1) et l'état clé (beatIdx)
  const prevKf = buildConnectedKeyframe(match, telemetry, beatIdx - 1);
  const currKf = buildConnectedKeyframe(match, telemetry, beatIdx);

  const prevForm = computeFormationAtKeyframe(match, prevKf);
  const currForm = computeFormationAtKeyframe(match, currKf);

  const ballX = prevKf.ballX + (currKf.ballX - prevKf.ballX) * ballEase;
  const ballY = prevKf.ballY + (currKf.ballY - prevKf.ballY) * ballEase;

  const activeCarrierId = u < 0.28 ? prevKf.carrierId : currKf.carrierId;

  const players: TacticalPlayerDot[] = [];
  for (const [id, target] of currForm.entries()) {
    const start = prevForm.get(id) ?? target;
    // Respiration sinusoïdale douce et déphasée (jamais de saut aléatoire)
    const phase = (hashString(`phase|${id}`) % 628) / 100;
    const swayX = Math.sin(nowMs * 0.0015 + phase) * 0.45;
    const swayY = Math.cos(nowMs * 0.0013 + phase * 1.3) * 0.45;

    const ix = start.x + (target.x - start.x) * teamEase + (target.role === "gk" ? 0 : swayX);
    const iy = start.y + (target.y - start.y) * teamEase + (target.role === "gk" ? 0 : swayY);

    players.push({
      id,
      team: target.team,
      role: target.role,
      number: target.number,
      x: Math.round(clamp(ix, 2.5, 97.5) * 100) / 100,
      y: Math.round(clamp(iy, 5, 95) * 100) / 100,
      isCarrier: id === activeCarrierId,
    });
  }

  const latestRed = [...events]
    .reverse()
    .find((e) => e.type === "red_card" && e.minute === min);

  let banner: LivePlayFrame["banner"] = null;
  if (latestRed) {
    const redTeam = latestRed.team === "home" ? match.homeTeam : match.awayTeam;
    const remaining =
      11 -
      (latestRed.team === "home"
        ? Math.max(1, match.redHome ?? 1)
        : Math.max(1, match.redAway ?? 1));
    banner = {
      type: "red_card",
      title: `🟥 ROUGE · ${redTeam} (${remaining}j)`,
      subtitle: `${latestRed.minute}'`,
      team: latestRed.team === "home" ? "home" : "away",
    };
  } else if (match.suspended) {
    banner = {
      type: "suspended",
      title: "🔒 Cotes suspendues",
      subtitle: "Action décisive",
    };
  }

  return {
    kind: currKf.kind,
    side: currKf.side,
    label: currKf.label,
    sublabel: currKf.sublabel,
    ballX: Math.round(ballX * 100) / 100,
    ballY: Math.round(ballY * 100) / 100,
    fromX: Math.round(prevKf.ballX * 100) / 100,
    fromY: Math.round(prevKf.ballY * 100) / 100,
    trajectory: currKf.trajectory,
    wall: currKf.wall ?? null,
    banner,
    players,
  };
}
