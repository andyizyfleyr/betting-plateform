/**
 * Moteur universel de minute live sportive (format minute uniquement : 88’, 45+2’, MT).
 *
 * Sans dépendance React ni Node serveur : peut être importé à la fois par les routes API /
 * sérialiseurs (`match-serializer`, `/api/bets`, `real-sports-feed`) et par les composants
 * clients Web (`src/components/live-match-clock.tsx`).
 */

export type LiveClockPhase =
  | "1H"
  | "1H_STOPPAGE"
  | "HT"
  | "2H"
  | "2H_STOPPAGE"
  | "PAUSED";

export interface LiveClockAnchor {
  /** "virtual" (5 min accéléré déterministe) | "real" (temps réel 1s = 1s) */
  mode: "virtual" | "real";
  /** Coup d'envoi ISO */
  startsAt: string;
  /** Durée réelle (ms) d'une minute de match (3120..3200 ms en virtuel ≈ 5 min, 60000 ms en réel) */
  stepMs: number;
  /** Secondes cumulées exactes du match réel au moment `syncedAtMs` */
  anchorSeconds?: number | null;
  /** Horodatage serveur (ms UTC) de la mesure `anchorSeconds` */
  syncedAtMs?: number | null;
  /** Vrai si `syncedAtMs` provient d'un horodatage exact du flux (ESPN / action admin) */
  exactSync?: boolean;
  /** Phase réglementaire connue */
  phase: LiveClockPhase;
  /** Minutes additionnelles annoncées (ex. 2 pour "45+2'") */
  stoppageAdded?: number | null;
}

export interface LiveClockSource {
  id?: number | null;
  matchId?: number | null;
  status?: string | null;
  minute?: string | null;
  startsAt?: string | Date | null;
  source?: "virtual" | "manual" | string | null;
  clockAnchor?: LiveClockAnchor | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  realStats?: {
    clockSeconds?: number | null;
    clockPeriod?: number | null;
    htHomeScore?: number | null;
    htAwayScore?: number | null;
  } | null;
}

export interface LiveClockSnapshot {
  /** Affichage minute seule sans secondes : "23’", "45+2’", "MT", "88’", "90+2’" */
  display: string;
  /** Variante badge : "Mi-temps" lorsque `isHalfTime`, sinon identique à `display` */
  badgeLabel: string;
  isHalfTime: boolean;
  isPaused: boolean;
  /** Progression continue 0..100 pour la frise 0’→90’ */
  progressPct: number;
  /** Minute entière courante (1..90) */
  gameMinute: number;
}

const VIRTUAL_STEP_MIN_MS = 3_120;
const VIRTUAL_STEP_MAX_MS = 3_200;

function hashDjb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/** Strictement identique à `stepMsForMatch(matchId, "virtual")` dans `src/db/engine.ts` (95 pas ≈ 5 min). */
export function stepMsForVirtualMatch(matchId: number): number {
  const h = hashDjb2(`virt-tempo|${matchId}`);
  const span = VIRTUAL_STEP_MAX_MS - VIRTUAL_STEP_MIN_MS;
  return VIRTUAL_STEP_MIN_MS + (h % (span + 1));
}

/**
 * Normalise tout libellé de temps de match en affichant uniquement la minute (`88’`, `45+2’`, `MT`)
 * et jamais les secondes (`88:34` -> `88’`), en tenant compte de la 2e mi-temps (`periodHint === 2` :
 * `0:15` / `0'` / `1'` -> `46’`..`90+’`).
 */
export function formatMinuteOnlyLabel(
  raw: string | null | undefined,
  periodHint?: 1 | 2 | null
): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return periodHint === 2 ? "46’" : "LIVE";
  if (isHalfTimeLabel(trimmed)) return "MT";
  if (isStaticStatusLabel(trimmed)) return trimmed;

  const stopMatch = /^(\d{1,3})\s*['’]?\s*\+\s*(\d{1,2})(?:[:.]\d{1,2})?\s*['’"]?$/.exec(
    trimmed
  );
  if (stopMatch) {
    const baseRaw = Number(stopMatch[1]);
    const base = periodHint === 2 && baseRaw <= 45 ? 90 : baseRaw;
    const added = Math.max(1, Number(stopMatch[2]));
    return `${base}+${added}’`;
  }

  const regMatch = /^(\d{1,3})(?:([:.])(\d{1,2}))?\s*['’"]?$/.exec(trimmed);
  if (regMatch) {
    const rawMin = Number(regMatch[1]);
    const sep = regMatch[2];
    if (periodHint === 2 && rawMin <= 45) {
      if (rawMin < 45) {
        const eff = sep === ":" ? 45 + rawMin + 1 : rawMin === 0 ? 46 : 45 + rawMin;
        return `${Math.min(90, eff)}’`;
      }
      return "46’";
    }
    const min = Math.max(1, sep === ":" ? rawMin + 1 : rawMin);
    return `${min}’`;
  }

  return trimmed.replace(/'/g, "’");
}

function isHalfTimeLabel(raw: string): boolean {
  const u = raw.trim().toUpperCase();
  return u === "MT" || u === "HT" || u === "MI-TEMPS";
}

function isStaticStatusLabel(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (isHalfTimeLabel(t)) return true;
  const lower = t.toLowerCase();
  return (
    lower.startsWith("fin") ||
    lower.startsWith("termin") ||
    lower.startsWith("report") ||
    lower.startsWith("interromp") ||
    lower.startsWith("annul") ||
    lower.startsWith("suspend")
  );
}

interface ParsedMinuteInfo {
  baseMin: number;
  addedMin: number | null;
  half: 1 | 2;
  phase: LiveClockPhase;
  expectedFloorSeconds: number;
}

export function parseMatchMinuteLabel(
  minute: string | null | undefined,
  periodHint?: 1 | 2 | null
): ParsedMinuteInfo | null {
  if (!minute) return null;
  const trimmed = minute.trim();
  if (!trimmed || isStaticStatusLabel(trimmed)) return null;

  const stopMatch = /^(\d{1,3})\s*['’]?\s*\+\s*(\d{1,2})(?:[:.]\d{1,2})?\s*['’"]?$/.exec(
    trimmed
  );
  if (stopMatch) {
    const baseMin = Number(stopMatch[1]);
    const addedMin = Math.max(1, Number(stopMatch[2]));
    if (baseMin <= 45 && periodHint !== 2) {
      return {
        baseMin: 45,
        addedMin,
        half: 1,
        phase: "1H_STOPPAGE",
        expectedFloorSeconds: 2700 + (addedMin - 1) * 60,
      };
    }
    return {
      baseMin: 90,
      addedMin,
      half: 2,
      phase: "2H_STOPPAGE",
      expectedFloorSeconds: 5400 + (addedMin - 1) * 60,
    };
  }

  const regMatch = /^(\d{1,3})(?:([:.])(\d{1,2}))?\s*['’"]?$/.exec(trimmed);
  if (regMatch) {
    const rawMin = Number(regMatch[1]);
    const sep = regMatch[2];
    const secInt =
      sep === ":" && regMatch[3] != null
        ? Math.min(59, Number(regMatch[3]))
        : null;

    // En 2e mi-temps (`periodHint === 2`), toute valeur 0..45 issue d'un flux périodique
    // correspond au temps écoulé depuis la reprise (45:00 = 2700 s -> 46’..90’).
    if (periodHint === 2 && rawMin <= 45) {
      if (rawMin < 45) {
        if (secInt != null) {
          const exactSec = 2700 + rawMin * 60 + secInt;
          return {
            baseMin: Math.min(90, 46 + rawMin),
            addedMin: null,
            half: 2,
            phase: "2H",
            expectedFloorSeconds: exactSec,
          };
        }
        const effMin = Math.min(90, rawMin === 0 ? 46 : 45 + rawMin);
        return {
          baseMin: effMin,
          addedMin: null,
          half: 2,
          phase: "2H",
          expectedFloorSeconds: (effMin - 1) * 60,
        };
      }
      const exactAt45 = 2700 + (secInt ?? 0);
      return {
        baseMin: 46,
        addedMin: null,
        half: 2,
        phase: "2H",
        expectedFloorSeconds: exactAt45,
      };
    }

    if (secInt != null) {
      const exactSec = rawMin * 60 + secInt;
      const half: 1 | 2 = rawMin >= 45 ? 2 : 1;
      return {
        baseMin: Math.min(90, Math.max(1, rawMin + 1)),
        addedMin: null,
        half,
        phase: half === 1 ? "1H" : "2H",
        expectedFloorSeconds: exactSec,
      };
    }
    const minInt = Math.max(1, rawMin);
    const half: 1 | 2 = minInt > 45 ? 2 : 1;
    return {
      baseMin: Math.min(90, minInt),
      addedMin: null,
      half,
      phase:
        minInt > 90
          ? "2H_STOPPAGE"
          : half === 1
            ? "1H"
            : "2H",
      expectedFloorSeconds: Math.max(0, (minInt - 1) * 60),
    };
  }

  return null;
}

/**
 * Convertit l'horloge brute ESPN (`status.clock` en secondes + `period` + `displayClock`)
 * en secondes cumulées exactes de match (0..6000+), en garantissant >= 2700 s (46’+) en 2e MT.
 */
export function normalizeEspnLiveClockSeconds(
  rawClockSeconds: number | null | undefined,
  period: number | null | undefined,
  displayMinute: string | null | undefined
): number | null {
  const isSecondHalf = (period ?? 1) >= 2;
  const periodHint: 1 | 2 = isSecondHalf ? 2 : 1;
  const parsed = parseMatchMinuteLabel(displayMinute, periodHint);

  const hasValidRaw =
    rawClockSeconds != null &&
    Number.isFinite(rawClockSeconds) &&
    rawClockSeconds >= 0;
  const rawFloor = hasValidRaw ? Math.floor(rawClockSeconds!) : null;

  if (!parsed) {
    if (rawFloor == null) return isSecondHalf ? 2700 : null;
    if (isSecondHalf && rawFloor < 2700) return 2700 + rawFloor;
    return rawFloor;
  }

  const expected = isSecondHalf
    ? Math.max(2700, parsed.expectedFloorSeconds)
    : parsed.expectedFloorSeconds;
  if (rawFloor == null) {
    return expected;
  }

  const candidates = isSecondHalf
    ? [rawFloor < 2700 ? 2700 + rawFloor : rawFloor]
    : [rawFloor];

  let best: number | null = null;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(c - expected);
    if (diff <= 180 && diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }

  return best ?? expected;
}

function inferRowSecondHalf(row: {
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  events?: ReadonlyArray<{ minute?: number }> | null;
  realStats?: {
    clockSeconds?: number | null;
    clockPeriod?: number | null;
    htHomeScore?: number | null;
    htAwayScore?: number | null;
    updatedAt?: string | null;
  } | null;
}): boolean {
  if ((row.realStats?.clockPeriod ?? 1) >= 2) return true;
  if ((row.realStats?.clockSeconds ?? 0) >= 2700) return true;
  if (row.htHomeScore != null || row.htAwayScore != null) return true;
  if (row.realStats?.htHomeScore != null || row.realStats?.htAwayScore != null) {
    return true;
  }
  if (
    Array.isArray(row.events) &&
    row.events.some((e) => (e.minute ?? 0) > 45)
  ) {
    return true;
  }
  return false;
}

/**
 * Normalise le libellé `minute` d'une ligne réelle live pour garantir qu'en 2e mi-temps
 * aucun flux ni ancienne ligne en base n'affiche `0`..`45` ou `LIVE` au lieu de `46’`..`90+’`.
 */
export function normalizeRealLiveMinuteLabel(
  row: {
    status: string;
    source?: string | null;
    minute?: string | null;
    startsAt?: Date | string | null;
    feedSyncedAt?: Date | string | null;
    htHomeScore?: number | null;
    htAwayScore?: number | null;
    events?: ReadonlyArray<{ minute?: number }> | null;
    realStats?: {
      clockSeconds?: number | null;
      clockPeriod?: number | null;
      htHomeScore?: number | null;
      htAwayScore?: number | null;
      updatedAt?: string | null;
    } | null;
  },
  nowMs = Date.now()
): string | null {
  if (row.source !== "manual" || row.status !== "live") {
    return row.minute ?? null;
  }
  const minTrim = (row.minute ?? "").trim();
  if (isHalfTimeLabel(minTrim)) return "MT";
  if (isStaticStatusLabel(minTrim)) return minTrim;

  const secondHalf = inferRowSecondHalf(row);
  const periodHint: 1 | 2 = secondHalf ? 2 : 1;
  const parsed = parseMatchMinuteLabel(minTrim, periodHint);

  if (parsed) {
    if (parsed.phase === "1H_STOPPAGE") {
      return `45+${parsed.addedMin ?? 1}’`;
    }
    if (parsed.phase === "2H_STOPPAGE") {
      return `90+${parsed.addedMin ?? 1}’`;
    }
    const minVal = secondHalf ? Math.max(46, parsed.baseMin) : parsed.baseMin;
    return `${minVal}’`;
  }

  const startsAtMs = row.startsAt
    ? Date.parse(
        row.startsAt instanceof Date
          ? row.startsAt.toISOString()
          : String(row.startsAt)
      )
    : NaN;
  const rawStatsSec = row.realStats?.clockSeconds;
  if (rawStatsSec != null && Number.isFinite(rawStatsSec) && rawStatsSec >= 0) {
    const sec = secondHalf && rawStatsSec < 2700 ? 2700 + rawStatsSec : rawStatsSec;
    if (secondHalf && sec >= 5400) {
      return `90+${Math.max(1, Math.floor((sec - 5400) / 60) + 1)}’`;
    }
    if (!secondHalf && sec >= 2700) {
      return `45+${Math.max(1, Math.floor((sec - 2700) / 60) + 1)}’`;
    }
    const gMin = secondHalf
      ? Math.min(90, Math.max(46, Math.floor(sec / 60) + 1))
      : Math.min(45, Math.max(1, Math.floor(sec / 60) + 1));
    return `${gMin}’`;
  }

  if (Number.isFinite(startsAtMs)) {
    const wallSec = Math.max(0, Math.floor((nowMs - startsAtMs) / 1000));
    if (secondHalf) {
      const estSec = Math.min(5400, Math.max(2700, wallSec - 900));
      return `${Math.min(90, Math.max(46, Math.floor(estSec / 60) + 1))}’`;
    }
    const estSec = Math.min(2699, wallSec);
    return `${Math.min(45, Math.max(1, Math.floor(estSec / 60) + 1))}’`;
  }

  return secondHalf ? "46’" : "1’";
}

/**
 * Construit côté serveur le descripteur `LiveClockAnchor` sérialisé dans `ClientMatch` et `ClientBet`.
 */
export function buildServerClockAnchor(
  row: {
    id: number;
    status: string;
    source?: string | null;
    minute?: string | null;
    startsAt: Date | string;
    htHomeScore?: number | null;
    htAwayScore?: number | null;
    events?: ReadonlyArray<{ minute: number }> | null;
    feedSyncedAt?: Date | string | null;
    realStats?: {
      clockSeconds?: number | null;
      clockPeriod?: number | null;
      htHomeScore?: number | null;
      htAwayScore?: number | null;
      updatedAt?: string | null;
    } | null;
  },
  nowMs = Date.now()
): LiveClockAnchor | null {
  if (row.status !== "live") return null;

  const startsAtIso =
    row.startsAt instanceof Date
      ? row.startsAt.toISOString()
      : String(row.startsAt);
  const startsAtMs = Date.parse(startsAtIso);

  if (row.source !== "manual") {
    const stepMs = stepMsForVirtualMatch(row.id);
    const elapsed = Number.isFinite(startsAtMs)
      ? Math.max(0, nowMs - startsAtMs)
      : 0;
    const step = Math.floor(elapsed / stepMs) + 1;
    const phase: LiveClockPhase =
      step <= 45
        ? "1H"
        : step === 46
          ? "1H_STOPPAGE"
          : step <= 48
            ? "HT"
            : step <= 93
              ? "2H"
              : "2H_STOPPAGE";
    return {
      mode: "virtual",
      startsAt: startsAtIso,
      stepMs,
      phase,
    };
  }

  const minTrim = (row.minute ?? "").trim();
  if (isHalfTimeLabel(minTrim)) {
    return {
      mode: "real",
      startsAt: startsAtIso,
      stepMs: 60_000,
      phase: "HT",
    };
  }
  if (isStaticStatusLabel(minTrim)) {
    return {
      mode: "real",
      startsAt: startsAtIso,
      stepMs: 60_000,
      phase: "PAUSED",
    };
  }

  const secondHalf = inferRowSecondHalf(row);
  const periodHint: 1 | 2 = secondHalf ? 2 : 1;
  const parsed = parseMatchMinuteLabel(minTrim, periodHint);
  if (!parsed) {
    const rawStatsSec = row.realStats?.clockSeconds;
    const fallbackSec =
      rawStatsSec != null && Number.isFinite(rawStatsSec) && rawStatsSec >= 0
        ? secondHalf && rawStatsSec < 2700
          ? 2700 + Math.floor(rawStatsSec)
          : Math.floor(rawStatsSec)
        : Number.isFinite(startsAtMs)
          ? secondHalf
            ? Math.min(5400, Math.max(2700, Math.floor((nowMs - startsAtMs) / 1000) - 900))
            : Math.min(2699, Math.max(0, Math.floor((nowMs - startsAtMs) / 1000)))
          : secondHalf
            ? 2700
            : 0;
    return {
      mode: "real",
      startsAt: startsAtIso,
      stepMs: 60_000,
      anchorSeconds: fallbackSec,
      syncedAtMs: nowMs,
      exactSync: false,
      phase: secondHalf ? "2H" : "1H",
    };
  }

  const effectivePeriod = secondHalf || parsed.half === 2 ? 2 : 1;
  const statsSec = row.realStats?.clockSeconds;
  const rawAnchorSec =
    normalizeEspnLiveClockSeconds(statsSec, effectivePeriod, minTrim) ??
    parsed.expectedFloorSeconds;
  const anchorSeconds =
    effectivePeriod === 2 ? Math.max(2700, rawAnchorSec) : rawAnchorSec;
  const effectivePhase: LiveClockPhase =
    effectivePeriod === 2 &&
    (parsed.phase === "1H" || parsed.phase === "1H_STOPPAGE")
      ? parsed.phase === "1H_STOPPAGE"
        ? "2H_STOPPAGE"
        : "2H"
      : parsed.phase;

  const statsUpdatedMs = row.realStats?.updatedAt
    ? Date.parse(row.realStats.updatedAt)
    : NaN;
  const feedSyncedMs =
    row.feedSyncedAt instanceof Date
      ? row.feedSyncedAt.getTime()
      : row.feedSyncedAt
        ? Date.parse(String(row.feedSyncedAt))
        : NaN;

  const hasExactSync =
    Number.isFinite(statsUpdatedMs) || Number.isFinite(feedSyncedMs);
  const syncedAtMs = Number.isFinite(statsUpdatedMs)
    ? statsUpdatedMs
    : Number.isFinite(feedSyncedMs)
      ? feedSyncedMs
      : nowMs;

  return {
    mode: "real",
    startsAt: startsAtIso,
    stepMs: 60_000,
    anchorSeconds,
    syncedAtMs,
    exactSync: hasExactSync,
    phase: effectivePhase,
    stoppageAdded: parsed.addedMin,
  };
}

/* ============================================================================
 *  CALIBRATION HORLOGE SERVEUR & REGISTRE CLIENT GLOBAL (ZÉRO RE-RENDER PARENT)
 * ============================================================================ */

let serverOffsetMs = 0;
let hasCalibratedOffset = false;
let monotonicAlignedNow = 0;

/**
 * Calibre le décalage d'horloge client ↔ serveur en tenant compte de l'âge CDN (`Age` header)
 * et du demi-RTT réseau, sans jamais faire reculer l'horloge locale.
 */
export function calibrateServerClockOffset(params: {
  serverTimeIso?: string | null;
  ageHeader?: string | null;
  dateHeader?: string | null;
  rttMs?: number;
}): void {
  const now = Date.now();
  const halfRtt = Math.min(1_500, Math.max(0, (params.rttMs ?? 0) / 2));
  const ageSec = params.ageHeader ? Number(params.ageHeader) : 0;
  const ageMs = Number.isFinite(ageSec) && ageSec > 0 ? ageSec * 1_000 : 0;

  let estimatedServerNow = NaN;
  if (params.serverTimeIso) {
    const parsed = Date.parse(params.serverTimeIso);
    if (Number.isFinite(parsed)) {
      estimatedServerNow = parsed + ageMs + halfRtt;
    }
  }
  if (!Number.isFinite(estimatedServerNow) && params.dateHeader) {
    const parsedDate = Date.parse(params.dateHeader);
    if (Number.isFinite(parsedDate)) {
      estimatedServerNow = parsedDate + ageMs + halfRtt;
    }
  }
  if (!Number.isFinite(estimatedServerNow)) return;

  const candidateOffset = estimatedServerNow - now;
  // Ignore les réponses CDN dont l'âge est imprécis sauf si l'horloge appareil dérive > 4s
  if (!hasCalibratedOffset) {
    if (ageMs === 0 || Math.abs(candidateOffset) > 4_000) {
      serverOffsetMs = candidateOffset;
      hasCalibratedOffset = true;
    }
    return;
  }

  if (ageMs === 0) {
    const delta = candidateOffset - serverOffsetMs;
    if (Math.abs(delta) > 5_000) {
      serverOffsetMs = candidateOffset;
    } else {
      serverOffsetMs = Math.round(serverOffsetMs * 0.8 + candidateOffset * 0.2);
    }
  }
}

export function getAlignedServerNow(): number {
  const raw = Date.now() + serverOffsetMs;
  if (raw > monotonicAlignedNow) {
    monotonicAlignedNow = raw;
  } else if (monotonicAlignedNow - raw > 10_000) {
    // Correction si l'horloge système a été recalée manuellement
    monotonicAlignedNow = raw;
  }
  return monotonicAlignedNow;
}

interface StoredClockEntry {
  id: number;
  status: string;
  minute: string | null;
  startsAt: string | null;
  source: "virtual" | "manual";
  clockAnchor: LiveClockAnchor | null;
}

interface RealMonotonicTracker {
  baseSec: number;
  baseNowMs: number;
  half: 1 | 2;
}

const clockRegistry = new Map<number, StoredClockEntry>();
const realTrackers = new Map<number, RealMonotonicTracker>();

export function registerLiveClockMatch(match: LiveClockSource | null | undefined): void {
  if (!match) return;
  const id = Number(match.id ?? match.matchId ?? 0);
  if (!Number.isFinite(id) || id <= 0) return;

  if (match.status && match.status !== "live") {
    clockRegistry.delete(id);
    realTrackers.delete(id);
    return;
  }

  const prev = clockRegistry.get(id);
  const startsAt =
    match.startsAt instanceof Date
      ? match.startsAt.toISOString()
      : typeof match.startsAt === "string" && match.startsAt.length > 0
        ? match.startsAt
        : prev?.startsAt ?? null;
  const source: "virtual" | "manual" =
    match.source === "manual" || match.clockAnchor?.mode === "real"
      ? "manual"
      : prev?.source === "manual" && !match.source
        ? "manual"
        : "virtual";

  clockRegistry.set(id, {
    id,
    status: match.status ?? prev?.status ?? "live",
    minute: match.minute !== undefined ? (match.minute ?? null) : (prev?.minute ?? null),
    startsAt,
    source,
    clockAnchor:
      match.clockAnchor !== undefined
        ? (match.clockAnchor ?? null)
        : (prev?.clockAnchor ?? null),
  });
}

export function registerLiveClockMatches(
  list: ReadonlyArray<LiveClockSource> | null | undefined
): void {
  if (!Array.isArray(list)) return;
  for (const m of list) {
    registerLiveClockMatch(m);
  }
}

function computeVirtualLiveSnapshot(
  matchId: number,
  startsAtIso: string | null,
  fallbackMinute: string | null,
  customStepMs?: number | null,
  nowMs = getAlignedServerNow()
): LiveClockSnapshot {
  const startsAtMs = startsAtIso ? Date.parse(startsAtIso) : NaN;
  if (!Number.isFinite(startsAtMs)) {
    const label = formatMinuteOnlyLabel(fallbackMinute);
    const ht = isHalfTimeLabel(label);
    return {
      display: ht ? "MT" : label,
      badgeLabel: ht ? "Mi-temps" : label,
      isHalfTime: ht,
      isPaused: ht,
      progressPct: 50,
      gameMinute: 45,
    };
  }

  const stepMs =
    customStepMs && customStepMs >= 1_000
      ? customStepMs
      : stepMsForVirtualMatch(matchId);
  const elapsedMs = Math.max(0, nowMs - startsAtMs);
  const exactStep = elapsedMs / stepMs;

  // 1re mi-temps : 1’ → 45’ (pas 0..45)
  if (exactStep < 45) {
    const totalSimSec = Math.min(2699, Math.max(0, Math.floor(exactStep * 60)));
    const gameMinute = Math.min(45, Math.max(1, Math.floor(exactStep) + 1));
    const display = `${gameMinute}’`;
    return {
      display,
      badgeLabel: display,
      isHalfTime: false,
      isPaused: false,
      progressPct: Math.min(50, Math.max(1.5, (totalSimSec / 5400) * 100)),
      gameMinute,
    };
  }

  // Temps additionnel 1re MT : 45+1’ → 45+2’ (pas 45..46)
  if (exactStep < 46) {
    const stopM = Math.max(1, Math.min(2, Math.floor((exactStep - 45) * 2) + 1));
    const display = `45+${stopM}’`;
    return {
      display,
      badgeLabel: display,
      isHalfTime: false,
      isPaused: false,
      progressPct: 50,
      gameMinute: 45,
    };
  }

  // Pause Mi-temps (pas 46..48)
  if (exactStep < 48) {
    return {
      display: "MT",
      badgeLabel: "Mi-temps",
      isHalfTime: true,
      isPaused: true,
      progressPct: 50,
      gameMinute: 45,
    };
  }

  // 2e mi-temps : 46’ → 90’ (pas 48..93)
  if (exactStep < 93) {
    const secIn2H = Math.min(2699, Math.max(0, Math.floor((exactStep - 48) * 60)));
    const totalSimSec = 2700 + secIn2H;
    const gameMinute = Math.min(90, Math.max(46, Math.floor(exactStep - 48) + 46));
    const display = `${gameMinute}’`;
    return {
      display,
      badgeLabel: display,
      isHalfTime: false,
      isPaused: false,
      progressPct: Math.min(99.5, Math.max(50, (totalSimSec / 5400) * 100)),
      gameMinute,
    };
  }

  // Temps additionnel 2e MT : 90+1’ → 90+3’ (plafonné avant "Terminé" tant que le serveur est "live")
  const stopM = Math.max(
    1,
    Math.min(3, Math.floor(((exactStep - 93) / 2) * 3) + 1)
  );
  const display = `90+${stopM}’`;
  return {
    display,
    badgeLabel: display,
    isHalfTime: false,
    isPaused: false,
    progressPct: 100,
    gameMinute: 90,
  };
}

function computeRealLiveSnapshot(
  matchId: number,
  minute: string | null,
  anchor: LiveClockAnchor | null,
  secondHalfHint = false,
  nowMs = getAlignedServerNow()
): LiveClockSnapshot {
  const rawMin = (minute ?? "").trim();

  if (anchor?.phase === "HT" || isHalfTimeLabel(rawMin)) {
    if (matchId > 0) realTrackers.delete(matchId);
    return {
      display: "MT",
      badgeLabel: "Mi-temps",
      isHalfTime: true,
      isPaused: true,
      progressPct: 50,
      gameMinute: 45,
    };
  }

  const is2HAnchor =
    secondHalfHint ||
    anchor?.phase === "2H" ||
    anchor?.phase === "2H_STOPPAGE" ||
    (anchor?.anchorSeconds ?? 0) >= 2700;
  const periodHint: 1 | 2 = is2HAnchor ? 2 : 1;

  if (anchor?.phase === "PAUSED" || isStaticStatusLabel(rawMin)) {
    const label = formatMinuteOnlyLabel(rawMin, periodHint);
    return {
      display: label,
      badgeLabel: label,
      isHalfTime: false,
      isPaused: true,
      progressPct: label.toLowerCase().startsWith("fin") ? 100 : 50,
      gameMinute: label.toLowerCase().startsWith("fin") ? 90 : 45,
    };
  }

  const parsed = parseMatchMinuteLabel(rawMin, periodHint);
  const half: 1 | 2 =
    is2HAnchor || parsed?.half === 2
      ? 2
      : 1;

  let serverTargetSec: number;
  if (anchor?.anchorSeconds != null && Number.isFinite(anchor.anchorSeconds)) {
    const baseAnchorSec =
      half === 2 && anchor.anchorSeconds < 2700
        ? 2700 + anchor.anchorSeconds
        : anchor.anchorSeconds;
    const elapsedSec =
      anchor.syncedAtMs != null && Number.isFinite(anchor.syncedAtMs)
        ? Math.min(180, Math.max(0, Math.floor((nowMs - anchor.syncedAtMs) / 1000)))
        : 0;
    serverTargetSec = baseAnchorSec + elapsedSec;
  } else if (parsed) {
    serverTargetSec =
      half === 2
        ? Math.max(2700, parsed.expectedFloorSeconds)
        : parsed.expectedFloorSeconds;
  } else {
    const label = formatMinuteOnlyLabel(rawMin, periodHint);
    return {
      display: label === "LIVE" && half === 2 ? "46’" : label,
      badgeLabel: label === "LIVE" && half === 2 ? "46’" : label,
      isHalfTime: false,
      isPaused: true,
      progressPct: half === 2 ? 52 : 2,
      gameMinute: half === 2 ? 46 : 1,
    };
  }

  let currentSec = serverTargetSec;
  if (matchId > 0) {
    const existing = realTrackers.get(matchId);
    if (!existing || existing.half !== half) {
      realTrackers.set(matchId, {
        baseSec: serverTargetSec,
        baseNowMs: nowMs,
        half,
      });
      currentSec = serverTargetSec;
    } else {
      const localSec =
        existing.baseSec + Math.max(0, Math.floor((nowMs - existing.baseNowMs) / 1000));
      const drift = serverTargetSec - localSec;
      const maxSilentDrift = anchor?.exactSync ? 22 : 70;
      if (drift > maxSilentDrift || drift < -65) {
        realTrackers.set(matchId, {
          baseSec: serverTargetSec,
          baseNowMs: nowMs,
          half,
        });
        currentSec = serverTargetSec;
      } else {
        currentSec = localSec;
      }
    }
  }

  const forceFirstHalfStoppage =
    anchor?.phase === "1H_STOPPAGE" || parsed?.phase === "1H_STOPPAGE";
  const forceSecondHalfStoppage =
    anchor?.phase === "2H_STOPPAGE" || parsed?.phase === "2H_STOPPAGE";

  if (half === 1) {
    if (currentSec >= 2700 || forceFirstHalfStoppage) {
      const stopSec = Math.max(0, currentSec - 2700);
      const stopM = Math.max(
        anchor?.stoppageAdded ?? 1,
        Math.floor(stopSec / 60) + 1
      );
      const display = `45+${stopM}’`;
      return {
        display,
        badgeLabel: display,
        isHalfTime: false,
        isPaused: false,
        progressPct: 50,
        gameMinute: 45,
      };
    }
    const gameMinute = Math.min(45, Math.max(1, Math.floor(currentSec / 60) + 1));
    const display = `${gameMinute}’`;
    return {
      display,
      badgeLabel: display,
      isHalfTime: false,
      isPaused: false,
      progressPct: Math.min(50, Math.max(1.5, (currentSec / 5400) * 100)),
      gameMinute,
    };
  }

  const sec2H = Math.max(2700, currentSec);
  if (sec2H >= 5400 || forceSecondHalfStoppage) {
    const stopSec = Math.max(0, sec2H - 5400);
    const stopM = Math.max(
      anchor?.stoppageAdded ?? 1,
      Math.floor(stopSec / 60) + 1
    );
    const display = `90+${stopM}’`;
    return {
      display,
      badgeLabel: display,
      isHalfTime: false,
      isPaused: false,
      progressPct: 100,
      gameMinute: 90,
    };
  }

  const gameMinute = Math.min(90, Math.max(46, Math.floor(sec2H / 60) + 1));
  const display = `${gameMinute}’`;
  return {
    display,
    badgeLabel: display,
    isHalfTime: false,
    isPaused: false,
    progressPct: Math.min(99.5, Math.max(50, (sec2H / 5400) * 100)),
    gameMinute,
  };
}

/**
 * Calcule l'état instantané du chronomètre d'un match en combinant les props passées
 * et le registre mémoire global (`clockRegistry`).
 */
export function computeLiveClockSnapshot(
  input: LiveClockSource | null | undefined,
  fallbackMinute?: string | null,
  nowMs = getAlignedServerNow()
): LiveClockSnapshot {
  const id = Number(input?.id ?? input?.matchId ?? 0);
  const reg = id > 0 ? clockRegistry.get(id) : undefined;

  const status = input?.status ?? reg?.status ?? "live";
  const minute = input?.minute ?? fallbackMinute ?? reg?.minute ?? null;

  if (status !== "live") {
    const label = minute?.trim() ? formatMinuteOnlyLabel(minute) : "Terminé";
    return {
      display: label,
      badgeLabel: label,
      isHalfTime: false,
      isPaused: true,
      progressPct: status === "finished" ? 100 : 0,
      gameMinute: status === "finished" ? 90 : 0,
    };
  }

  const anchor = input?.clockAnchor ?? reg?.clockAnchor ?? null;
  const source =
    input?.source ??
    (anchor?.mode === "real" ? "manual" : anchor?.mode === "virtual" ? "virtual" : undefined) ??
    reg?.source ??
    (minute && isStaticStatusLabel(minute) ? "manual" : undefined);

  const startsAt =
    input?.startsAt instanceof Date
      ? input.startsAt.toISOString()
      : typeof input?.startsAt === "string" && input.startsAt.length > 0
        ? input.startsAt
        : anchor?.startsAt ?? reg?.startsAt ?? null;

  if (source === "virtual" && id > 0 && startsAt) {
    return computeVirtualLiveSnapshot(
      id,
      startsAt,
      minute,
      anchor?.stepMs ?? null,
      nowMs
    );
  }

  const secondHalfHint =
    (input?.realStats?.clockPeriod ?? 1) >= 2 ||
    (input?.realStats?.clockSeconds ?? 0) >= 2700 ||
    input?.htHomeScore != null ||
    input?.htAwayScore != null ||
    input?.realStats?.htHomeScore != null ||
    input?.realStats?.htAwayScore != null;

  if (source === "manual" || !startsAt || id <= 0) {
    return computeRealLiveSnapshot(id, minute, anchor, secondHalfHint, nowMs);
  }

  return computeVirtualLiveSnapshot(id, startsAt, minute, anchor?.stepMs ?? null, nowMs);
}

export function isVirtualClockInput(input: LiveClockSource | null | undefined): boolean {
  if (!input) return false;
  if (input.clockAnchor?.mode === "virtual") return true;
  if (input.clockAnchor?.mode === "real") return false;
  if (input.source === "virtual") return true;
  if (input.source === "manual") return false;
  const id = Number(input.id ?? input.matchId ?? 0);
  if (id > 0) {
    const reg = clockRegistry.get(id);
    if (reg) return reg.source === "virtual";
  }
  return false;
}

/* ============================================================================
 *  ORDONNANCEUR UNIQUE PARTAGÉ (1 SEUL TIMER GLOBAL PAR VITESSE)
 * ============================================================================ */

const fastListeners = new Set<() => void>();
const realListeners = new Set<() => void>();
let fastTimer: ReturnType<typeof setInterval> | null = null;
let realTimer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function notifySet(set: Set<() => void>) {
  for (const fn of set) {
    fn();
  }
}

function syncSchedulerTimers() {
  if (typeof window === "undefined") return;

  if (!visibilityBound && typeof document !== "undefined") {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      syncSchedulerTimers();
      if (!isDocumentHidden()) {
        notifySet(fastListeners);
        notifySet(realListeners);
      }
    });
  }

  const hidden = isDocumentHidden();

  if (fastListeners.size > 0 && !hidden) {
    if (!fastTimer) {
      fastTimer = setInterval(() => {
        notifySet(fastListeners);
      }, 500);
    }
  } else if (fastTimer) {
    clearInterval(fastTimer);
    fastTimer = null;
  }

  if (realListeners.size > 0 && !hidden) {
    if (!realTimer) {
      realTimer = setInterval(() => {
        notifySet(realListeners);
      }, 1_000);
    }
  } else if (realTimer) {
    clearInterval(realTimer);
    realTimer = null;
  }
}

export function subscribeLiveClock(
  mode: "fast" | "real",
  listener: () => void
): () => void {
  const bucket = mode === "fast" ? fastListeners : realListeners;
  bucket.add(listener);
  syncSchedulerTimers();
  return () => {
    bucket.delete(listener);
    syncSchedulerTimers();
  };
}
