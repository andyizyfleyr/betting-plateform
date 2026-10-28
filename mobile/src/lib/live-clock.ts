import { AppState, type AppStateStatus } from "react-native";

export type LiveClockPhase =
  | "1H"
  | "1H_STOPPAGE"
  | "HT"
  | "2H"
  | "2H_STOPPAGE"
  | "PAUSED";

export interface LiveClockAnchor {
  mode: "virtual" | "real";
  startsAt: string;
  stepMs: number;
  anchorSeconds?: number | null;
  syncedAtMs?: number | null;
  exactSync?: boolean;
  phase: LiveClockPhase;
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
}

export interface LiveClockSnapshot {
  display: string;
  badgeLabel: string;
  isHalfTime: boolean;
  isPaused: boolean;
  progressPct: number;
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

export function stepMsForVirtualMatch(matchId: number): number {
  const h = hashDjb2(`virt-tempo|${matchId}`);
  const span = VIRTUAL_STEP_MAX_MS - VIRTUAL_STEP_MIN_MS;
  return VIRTUAL_STEP_MIN_MS + (h % (span + 1));
}

export function formatMinuteOnlyLabel(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "LIVE";
  if (isHalfTimeLabel(trimmed)) return "MT";
  if (isStaticStatusLabel(trimmed)) return trimmed;

  const stopMatch = /^(\d{1,3})\s*['’]?\s*\+\s*(\d{1,2})(?::\d{1,2})?\s*['’]?$/.exec(
    trimmed
  );
  if (stopMatch) {
    const base = Number(stopMatch[1]);
    const added = Math.max(1, Number(stopMatch[2]));
    return `${base}+${added}’`;
  }

  const regMatch = /^(\d{1,3})(?::\d{1,2})?\s*['’]?$/.exec(trimmed);
  if (regMatch) {
    const min = Math.max(1, Number(regMatch[1]));
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
  minute: string | null | undefined
): ParsedMinuteInfo | null {
  if (!minute) return null;
  const trimmed = minute.trim();
  if (!trimmed || isStaticStatusLabel(trimmed)) return null;

  const stopMatch = /^(\d{1,3})\s*['’]?\s*\+\s*(\d{1,2})\s*['’]?$/.exec(trimmed);
  if (stopMatch) {
    const baseMin = Number(stopMatch[1]);
    const addedMin = Math.max(1, Number(stopMatch[2]));
    if (baseMin <= 45) {
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

  const regMatch = /^(\d{1,3})(?::(\d{1,2}))?\s*['’]?$/.exec(trimmed);
  if (regMatch) {
    const minInt = Math.max(1, Number(regMatch[1]));
    const secInt = regMatch[2] != null ? Math.min(59, Number(regMatch[2])) : null;
    if (secInt != null) {
      const exactSec = minInt * 60 + secInt;
      const half: 1 | 2 = minInt >= 45 ? 2 : 1;
      return {
        baseMin: Math.min(90, minInt + 1),
        addedMin: null,
        half,
        phase: half === 1 ? "1H" : "2H",
        expectedFloorSeconds: exactSec,
      };
    }
    const half: 1 | 2 = minInt > 45 ? 2 : 1;
    return {
      baseMin: Math.min(90, minInt),
      addedMin: null,
      half,
      phase: minInt > 90 ? "2H_STOPPAGE" : half === 1 ? "1H" : "2H",
      expectedFloorSeconds: Math.max(0, (minInt - 1) * 60),
    };
  }

  return null;
}

let serverOffsetMs = 0;
let hasCalibratedOffset = false;
let monotonicAlignedNow = 0;

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

export function registerLiveClockMatch(
  match: LiveClockSource | null | undefined
): void {
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
    minute:
      match.minute !== undefined
        ? (match.minute ?? null)
        : (prev?.minute ?? null),
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

  if (exactStep < 93) {
    const secIn2H = Math.min(
      2699,
      Math.max(0, Math.floor((exactStep - 48) * 60))
    );
    const totalSimSec = 2700 + secIn2H;
    const gameMinute = Math.min(
      90,
      Math.max(46, Math.floor(exactStep - 48) + 46)
    );
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

  if (anchor?.phase === "PAUSED" || isStaticStatusLabel(rawMin)) {
    const label = formatMinuteOnlyLabel(rawMin);
    return {
      display: label,
      badgeLabel: label,
      isHalfTime: false,
      isPaused: true,
      progressPct: label.toLowerCase().startsWith("fin") ? 100 : 50,
      gameMinute: label.toLowerCase().startsWith("fin") ? 90 : 45,
    };
  }

  const parsed = parseMatchMinuteLabel(rawMin);
  const half: 1 | 2 =
    anchor?.phase === "2H" || anchor?.phase === "2H_STOPPAGE"
      ? 2
      : anchor?.phase === "1H" || anchor?.phase === "1H_STOPPAGE"
        ? 1
        : (parsed?.half ?? 1);

  let serverTargetSec: number;
  if (anchor?.anchorSeconds != null && Number.isFinite(anchor.anchorSeconds)) {
    const elapsedSec =
      anchor.syncedAtMs != null && Number.isFinite(anchor.syncedAtMs)
        ? Math.min(
            180,
            Math.max(0, Math.floor((nowMs - anchor.syncedAtMs) / 1000))
          )
        : 0;
    serverTargetSec = anchor.anchorSeconds + elapsedSec;
  } else if (parsed) {
    serverTargetSec = parsed.expectedFloorSeconds;
  } else {
    const label = formatMinuteOnlyLabel(rawMin);
    return {
      display: label,
      badgeLabel: label,
      isHalfTime: false,
      isPaused: true,
      progressPct: 2,
      gameMinute: 1,
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
        existing.baseSec +
        Math.max(0, Math.floor((nowMs - existing.baseNowMs) / 1000));
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
    (anchor?.mode === "real"
      ? "manual"
      : anchor?.mode === "virtual"
        ? "virtual"
        : undefined) ??
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

  if (source === "manual" || !startsAt || id <= 0) {
    return computeRealLiveSnapshot(id, minute, anchor, nowMs);
  }

  return computeVirtualLiveSnapshot(
    id,
    startsAt,
    minute,
    anchor?.stepMs ?? null,
    nowMs
  );
}

export function isVirtualClockInput(
  input: LiveClockSource | null | undefined
): boolean {
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

const fastListeners = new Set<() => void>();
const realListeners = new Set<() => void>();
let fastTimer: ReturnType<typeof setInterval> | null = null;
let realTimer: ReturnType<typeof setInterval> | null = null;
let appStateBound = false;
let currentAppState: AppStateStatus = AppState.currentState || "active";

function notifySet(set: Set<() => void>) {
  for (const fn of set) {
    fn();
  }
}

function syncSchedulerTimers() {
  if (!appStateBound) {
    appStateBound = true;
    AppState.addEventListener("change", (nextState) => {
      currentAppState = nextState;
      syncSchedulerTimers();
      if (nextState === "active") {
        notifySet(fastListeners);
        notifySet(realListeners);
      }
    });
  }

  const active = currentAppState === "active";

  if (fastListeners.size > 0 && active) {
    if (!fastTimer) {
      fastTimer = setInterval(() => {
        notifySet(fastListeners);
      }, 500);
    }
  } else if (fastTimer) {
    clearInterval(fastTimer);
    fastTimer = null;
  }

  if (realListeners.size > 0 && active) {
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
