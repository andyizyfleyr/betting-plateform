import { expectedGoals, hashString, mulberry32 } from "@/db/fixtures";
import { teamHue } from "@/lib/format";
import { minuteNumber } from "@/lib/markets";

function matchStepMs(matchId: number, source?: string | null): number {
  if (source === "manual") return 40_000;
  const h = hashString(`virt-tempo|${matchId}`);
  return 1_520 + (h % (1_840 - 1_520 + 1));
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

interface SequenceNode {
  kind: PlayActionKind;
  side: "home" | "away";
  x: number;
  y: number;
  label: string;
  sublabel: string;
  trajectory: "none" | "pass" | "shot" | "cross" | "free_kick";
}

function buildBeatNode(
  match: TelemetryMatchInput,
  telemetry: LiveMatchTelemetry,
  beatIdx: number
): SequenceNode {
  const seqIdx = Math.floor(beatIdx / 4);
  const step = ((beatIdx % 4) + 4) % 4;
  const rng = mulberry32(hashString(`seq-v2|${match.id}|${seqIdx}`));

  const domShare = telemetry.recentHomePressure / 100;
  const side: "home" | "away" = rng() < domShare ? "home" : "away";
  const teamName = side === "home" ? match.homeTeam : match.awayTeam;
  const dir = side === "home" ? 1 : -1;
  const ax = (progressFromOwnGoal: number) =>
    side === "home" ? progressFromOwnGoal : 100 - progressFromOwnGoal;

  // Couloir principal de la séquence (haut, axe, bas)
  const laneRoll = rng();
  const baseLaneY = laneRoll < 0.34 ? 22 + rng() * 14 : laneRoll > 0.66 ? 64 + rng() * 14 : 40 + rng() * 20;
  const stepRng = mulberry32(hashString(`seq-step|${match.id}|${seqIdx}|${step}`));

  if (step === 0) {
    const x = ax(26 + stepRng() * 16);
    const y = clamp(baseLaneY + (stepRng() - 0.5) * 14, 16, 84);
    return {
      kind: "build_up",
      side,
      x,
      y,
      label: `Relance · ${teamName}`,
      sublabel: "Construction depuis le camp",
      trajectory: "pass",
    };
  }

  if (step === 1) {
    const x = ax(46 + stepRng() * 16);
    const y = clamp(baseLaneY + (stepRng() - 0.5) * 18, 12, 88);
    return {
      kind: "progression",
      side,
      x,
      y,
      label: `Progression · ${teamName}`,
      sublabel: baseLaneY < 35 || baseLaneY > 65 ? "Débordement couloir" : "Percée dans l'axe",
      trajectory: "pass",
    };
  }

  const climaxRoll = rng(); // Déterminé par la séquence pour cohérence entre step 2 et step 3

  if (step === 2) {
    if (climaxRoll > 0.86) {
      // Préparation coup franc offensif aux 24m
      const fkX = ax(75 + stepRng() * 5);
      const fkY = clamp(30 + stepRng() * 40, 26, 74);
      return {
        kind: "free_kick",
        side,
        x: fkX,
        y: fkY,
        label: `Coup franc dangereux · ${teamName}`,
        sublabel: "23m · Mur en place",
        trajectory: "none",
      };
    }
    const x = ax(68 + stepRng() * 12);
    const y = clamp(baseLaneY + (stepRng() - 0.5) * 16, 14, 86);
    return {
      kind: "dangerous_attack",
      side,
      x,
      y,
      label: `Attaque dangereuse · ${teamName}`,
      sublabel: "Entrée dans les 30 derniers mètres",
      trajectory: "pass",
    };
  }

  // Step 3 : dénouement de l'action
  if (climaxRoll > 0.86) {
    // Tir sur coup franc vers la lucarne
    const targetY = baseLaneY < 50 ? 44 : 56;
    return {
      kind: "shot_on_target",
      side,
      x: ax(96.5),
      y: targetY,
      label: `Tir sur coup franc · ${teamName}`,
      sublabel: "Parade décisive sur la ligne",
      trajectory: "free_kick",
    };
  }

  if (climaxRoll > 0.7) {
    // Corner obtenu & botté vers le point de penalty
    const topCorner = baseLaneY < 50;
    return {
      kind: "corner",
      side,
      x: ax(98.2),
      y: topCorner ? 5.5 : 94.5,
      label: `Corner · ${teamName}`,
      sublabel: topCorner ? "Côté gauche offensif" : "Côté droit offensif",
      trajectory: "cross",
    };
  }

  if (climaxRoll > 0.5) {
    // Frappe cadrée !
    return {
      kind: "shot_on_target",
      side,
      x: ax(96.8),
      y: 44 + stepRng() * 12,
      label: `Tir cadré ! · ${teamName}`,
      sublabel: "Danger immédiat dans la surface",
      trajectory: "shot",
    };
  }

  if (climaxRoll > 0.34) {
    // Frappe frôlant le poteau
    const high = baseLaneY < 50;
    return {
      kind: "shot_off",
      side,
      x: ax(98.5),
      y: high ? 35 : 65,
      label: `Frappe non cadrée · ${teamName}`,
      sublabel: "À ras du montant",
      trajectory: "shot",
    };
  }

  // Récupération défensive adverse
  const defSide = side === "home" ? "away" : "home";
  const defName = defSide === "home" ? match.homeTeam : match.awayTeam;
  return {
    kind: "interception",
    side: defSide,
    x: clamp(ax(82) - dir * 8, 12, 88),
    y: clamp(baseLaneY, 18, 82),
    label: `Récupération · ${defName}`,
    sublabel: "Transition rapide amorcée",
    trajectory: "pass",
  };
}

const HOME_BASE_OUTFIELD: Array<[number, number, number]> = [
  // [baseX %, baseY %, numéro]
  [18, 18, 2],
  [16, 38, 4],
  [16, 62, 5],
  [18, 82, 3],
  [36, 26, 8],
  [33, 50, 6],
  [36, 74, 10],
  [54, 20, 7],
  [57, 50, 9],
  [54, 80, 11],
];

function buildTacticalPlayers(
  match: TelemetryMatchInput,
  ballX: number,
  ballY: number,
  side: "home" | "away" | "neutral",
  kind: PlayActionKind,
  beatIdx: number
): TacticalPlayerDot[] {
  const redH = clamp(match.redHome ?? 0, 0, 3);
  const redA = clamp(match.redAway ?? 0, 0, 3);
  const homeOutfieldCount = Math.max(7, 10 - redH);
  const awayOutfieldCount = Math.max(7, 10 - redA);

  const dots: TacticalPlayerDot[] = [];

  // Gardiens positionnés dans leurs 6 mètres et suivant l'angle Y du ballon
  const gkHomeY = clamp(50 + (ballY - 50) * 0.18, 41, 59);
  const gkAwayY = clamp(50 + (ballY - 50) * 0.18, 41, 59);
  const gkHomeX = side === "away" && ballX < 28 ? 3.8 : 5.4;
  const gkAwayX = side === "home" && ballX > 72 ? 96.2 : 94.6;

  dots.push({
    id: "h-gk",
    team: "home",
    role: "gk",
    number: 1,
    x: gkHomeX,
    y: gkHomeY,
    isCarrier: false,
  });
  dots.push({
    id: "a-gk",
    team: "away",
    role: "gk",
    number: 1,
    x: gkAwayX,
    y: gkAwayY,
    isCarrier: false,
  });

  // Translation collective du bloc équipe en fonction de la position du ballon
  const ballShiftX = (ballX - 50) * 0.46;
  const ballShiftY = (ballY - 50) * 0.22;

  for (let i = 0; i < homeOutfieldCount; i++) {
    const [bx, by, num] = HOME_BASE_OUTFIELD[i];
    const jitter = (((hashString(`jp|h|${match.id}|${beatIdx}|${i}`) % 9) - 4) * 0.65);
    const atkBoost = side === "home" ? 7 : side === "away" ? -4 : 0;
    const x =
      kind === "halftime"
        ? 36 + (i % 3) * 4
        : clamp(bx + ballShiftX + atkBoost + jitter, 9, 92);
    const y =
      kind === "halftime"
        ? 24 + i * 5.2
        : clamp(by + ballShiftY + jitter * 0.8, 8, 92);
    dots.push({
      id: `h-${num}`,
      team: "home",
      role: "outfield",
      number: num,
      x,
      y,
      isCarrier: false,
    });
  }

  for (let i = 0; i < awayOutfieldCount; i++) {
    const [bx, by, num] = HOME_BASE_OUTFIELD[i];
    const mx = 100 - bx;
    const my = 100 - by;
    const jitter = (((hashString(`jp|a|${match.id}|${beatIdx}|${i}`) % 9) - 4) * 0.65);
    const atkBoost = side === "away" ? -7 : side === "home" ? 4 : 0;
    const x =
      kind === "halftime"
        ? 64 - (i % 3) * 4
        : clamp(mx + ballShiftX + atkBoost + jitter, 8, 91);
    const y =
      kind === "halftime"
        ? 24 + i * 5.2
        : clamp(my + ballShiftY - jitter * 0.8, 8, 92);
    dots.push({
      id: `a-${num}`,
      team: "away",
      role: "outfield",
      number: num,
      x,
      y,
      isCarrier: false,
    });
  }

  // Assigne le porteur du ballon (ou tireur de corner / coup franc) au joueur le plus proche du camp actif
  if (side !== "neutral" && kind !== "goal" && kind !== "halftime" && kind !== "fulltime") {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.team !== side || d.role === "gk") continue;
      const dist = Math.hypot(d.x - ballX, d.y - ballY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      // Sur un tir déjà parti vers les filets, le tireur reste à l'entrée de la surface
      if (kind === "shot_on_target" || kind === "shot_off") {
        dots[bestIdx] = {
          ...dots[bestIdx],
          isCarrier: true,
        };
      } else {
        dots[bestIdx] = {
          ...dots[bestIdx],
          x: clamp(ballX + (side === "home" ? -1.4 : 1.4), 3, 97),
          y: clamp(ballY, 5, 95),
          isCarrier: true,
        };
      }
    }
  }

  return dots;
}

/**
 * Calcule la frame radar temps réel (cadencée sur l'horloge réelle du match,
 * avec interpolation fluide entre deux battements tactiques).
 */
export function computeLivePlayFrame(
  match: TelemetryMatchInput,
  telemetry: LiveMatchTelemetry,
  nowMs: number
): LivePlayFrame {
  const min = telemetry.minute;
  const events = match.events ?? [];

  // Cadence alignée sur le moteur serveur (~1,35 s par phase pour suivre chaque minute virtuelle)
  const stepMs = matchStepMs(match.id, match.source);
  const beatDurationMs = match.source === "manual" ? 2_200 : Math.min(1_450, Math.max(1_150, Math.round(stepMs * 0.82)));
  const beatIdx = Math.floor(nowMs / beatDurationMs);
  const rawProgress = (nowMs % beatDurationMs) / beatDurationMs;
  // Courbe ease-out fluide
  const ease = 1 - Math.pow(1 - rawProgress, 2.4);

  // 1. Match terminé
  if (match.status === "finished" || match.minute === "Terminé") {
    return {
      kind: "fulltime",
      side: "neutral",
      label: `Coup de sifflet final · ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`,
      sublabel: "Rencontre terminée",
      ballX: 50,
      ballY: 50,
      fromX: 50,
      fromY: 50,
      trajectory: "none",
      players: buildTacticalPlayers(match, 50, 50, "neutral", "fulltime", 0),
    };
  }

  // 2. Mi-temps
  if (match.minute === "MT" || match.minute === "HT") {
    return {
      kind: "halftime",
      side: "neutral",
      label: "Mi-temps · Pause au vestiaire",
      sublabel: `Score à la pause : ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`,
      ballX: 50,
      ballY: 50,
      fromX: 50,
      fromY: 50,
      trajectory: "none",
      players: buildTacticalPlayers(match, 50, 50, "neutral", "halftime", beatIdx),
    };
  }

  // 3. But tout juste inscrit (marché suspendu après but ou minute courante)
  const latestGoal = [...events]
    .reverse()
    .find((e) => e.type === "goal" && Math.abs(e.minute - min) <= 1);

  if (latestGoal && (match.suspended || latestGoal.minute === min)) {
    const isHome = latestGoal.team === "home";
    const teamName = isHome ? match.homeTeam : match.awayTeam;
    const scorer = latestGoal.player ? `${latestGoal.player} (${latestGoal.minute}')` : `${latestGoal.minute}'`;
    const netX = isHome ? 99.1 : 0.9;
    const shotOriginX = isHome ? 84 : 16;
    const shotOriginY = 44 + (hashString(`goal-y|${match.id}|${latestGoal.minute}`) % 13);
    const players = buildTacticalPlayers(
      match,
      shotOriginX,
      shotOriginY,
      isHome ? "home" : "away",
      "goal",
      beatIdx
    );

    return {
      kind: "goal",
      side: isHome ? "home" : "away",
      label: `BUT ! ${teamName}`,
      sublabel: `${scorer} · Score ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`,
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
      players,
    };
  }

  // 4. Carton rouge récent
  const latestRed = [...events]
    .reverse()
    .find((e) => e.type === "red_card" && e.minute === min);

  // 5. Chaîne d'action continue entre beatIdx - 1 et beatIdx
  const prevNode = buildBeatNode(match, telemetry, beatIdx - 1);
  const currNode = buildBeatNode(match, telemetry, beatIdx);

  // Sur un tir ou un centre de corner, le ballon file du point précédent vers la cible
  const interpX =
    currNode.kind === "corner" || currNode.kind === "free_kick"
      ? currNode.x
      : prevNode.x + (currNode.x - prevNode.x) * ease;
  const interpY =
    currNode.kind === "corner" || currNode.kind === "free_kick"
      ? currNode.y
      : prevNode.y + (currNode.y - prevNode.y) * ease;

  const fromX =
    currNode.kind === "corner"
      ? currNode.x
      : prevNode.x;
  const fromY =
    currNode.kind === "corner"
      ? currNode.y
      : prevNode.y;

  // Mur défensif à 9m15 sur coup franc offensif
  const wall =
    currNode.kind === "free_kick" || currNode.trajectory === "free_kick"
      ? {
          x: currNode.side === "home" ? 84.5 : 15.5,
          y: clamp(fromY + (50 - fromY) * 0.32, 34, 66),
          side: (currNode.side === "home" ? "away" : "home") as "home" | "away",
        }
      : null;

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
      title: `🟥 CARTON ROUGE · ${redTeam}`,
      subtitle: `${latestRed.minute}' · Réduit à ${remaining} joueurs`,
      team: latestRed.team === "home" ? "home" : "away",
    };
  } else if (match.suspended) {
    banner = {
      type: "suspended",
      title: "🔒 Action décisive en cours",
      subtitle: "Cotes temporairement suspendues",
    };
  }

  const players = buildTacticalPlayers(
    match,
    interpX,
    interpY,
    currNode.side,
    currNode.kind,
    beatIdx
  );

  return {
    kind: currNode.kind,
    side: currNode.side,
    label: currNode.label,
    sublabel: currNode.sublabel,
    ballX: Math.round(interpX * 100) / 100,
    ballY: Math.round(interpY * 100) / 100,
    fromX: Math.round(fromX * 100) / 100,
    fromY: Math.round(fromY * 100) / 100,
    trajectory: currNode.trajectory,
    wall,
    banner,
    players,
  };
}
