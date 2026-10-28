import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  bets,
  comboBets,
  matches,
  predictionBets,
  predictionQuestions,
  type MatchRow,
} from "@/db/schema";
import {
  computeWeakEtag,
  invalidatePublicApiCaches,
  type CachedJsonPayload,
} from "@/lib/response-cache";
import {
  PARTY_LIVE_MATCHES_ROOM,
  publishPartyRoomEvent,
  publishUserRealtimeInvalidation,
} from "@/lib/partykit";

export interface CachedPendingMatchTicket {
  userId: number;
  market: string;
  selection: string;
  stake: number;
  odds: number;
}

export interface UserPulseTicketItem {
  id: number;
  kind: "sport" | "prediction" | "combo";
  status: string;
  stake: number;
  potentialWin: number;
  title: string;
  selectionLabel: string;
}

export interface UserPulsePayload {
  balance: number;
  pendingCount: number;
  tickets: UserPulseTicketItem[];
}

interface PlatformMemoryState {
  matchesHydratedAt: number;
  manualRefreshedAt: number;
  hydratePromise: Promise<void> | null;
  openVirtual: Map<number, MatchRow>;
  finishedVirtual: MatchRow[];
  openManual: Map<number, MatchRow>;
  finishedManual: MatchRow[];

  pendingFlagsHydratedAt: number;
  pendingBookHydratedAt: number;
  hasPendingSportBets: boolean;
  hasPendingComboBets: boolean;
  hasPendingPredBets: boolean;
  sportTicketsByMatch: Map<number, CachedPendingMatchTicket[]>;
  comboLegsByMatch: Map<number, CachedPendingMatchTicket[]>;

  nextQuestionResolveAtMs: number;
  questionScheduleCheckedAt: number;

  userPulseCache: Map<number, { at: number; entry: CachedJsonPayload }>;
  userBetsCache: Map<string, CachedJsonPayload>;
}

const MAX_FINISHED_VIRTUAL_RAM = 12;
const MAX_FINISHED_MANUAL_RAM = 20;
const MULTI_INSTANCE_RECONCILE_MS = 2_500;
const PENDING_FLAGS_SAFETY_TTL_MS = 15_000;
const PENDING_BOOK_TTL_MS = 15_000;
const QUESTION_SCHEDULE_MAX_TTL_MS = 30_000;
const USER_PULSE_CACHE_TTL_MS = 1_200;
const USER_BETS_CACHE_TTL_MS = 1_200;

const globalStore = globalThis as typeof globalThis & {
  __pulseMemoryStateV1?: PlatformMemoryState;
};

function getState(): PlatformMemoryState {
  if (!globalStore.__pulseMemoryStateV1) {
    globalStore.__pulseMemoryStateV1 = {
      matchesHydratedAt: 0,
      manualRefreshedAt: 0,
      hydratePromise: null,
      openVirtual: new Map(),
      finishedVirtual: [],
      openManual: new Map(),
      finishedManual: [],

      pendingFlagsHydratedAt: 0,
      pendingBookHydratedAt: 0,
      hasPendingSportBets: false,
      hasPendingComboBets: false,
      hasPendingPredBets: false,
      sportTicketsByMatch: new Map(),
      comboLegsByMatch: new Map(),

      nextQuestionResolveAtMs: 0,
      questionScheduleCheckedAt: 0,

      userPulseCache: new Map(),
      userBetsCache: new Map(),
    };
  }
  return globalStore.__pulseMemoryStateV1;
}

function sortFinishedDesc(list: MatchRow[], limit: number): MatchRow[] {
  return [...list]
    .sort((a, b) => {
      const fa = a.finishedAt ? a.finishedAt.getTime() : 0;
      const fb = b.finishedAt ? b.finishedAt.getTime() : 0;
      return fb - fa || b.id - a.id;
    })
    .slice(0, limit);
}

function parseVirtualMinuteInt(minute: string | null | undefined): number {
  if (!minute) return 0;
  const trimmed = minute.trim();
  if (trimmed === "MT" || trimmed === "HT" || trimmed === "Mi-temps") return 45;
  const m = /(\d+)/.exec(trimmed);
  return m ? Number(m[1]) : 0;
}

function pickMonotonicVirtualOpenRow(
  dbRow: MatchRow,
  ramRow: MatchRow | undefined
): MatchRow {
  if (!ramRow) return dbRow;
  if (dbRow.status === "live" && ramRow.status === "upcoming") return dbRow;
  if (ramRow.status === "live" && dbRow.status === "upcoming") {
    if (ramRow.startsAt.getTime() === dbRow.startsAt.getTime()) return ramRow;
    return dbRow;
  }
  if (ramRow.status === "live" && dbRow.status === "live") {
    if (ramRow.startsAt.getTime() !== dbRow.startsAt.getTime()) return dbRow;
    const ramScore = (ramRow.homeScore ?? 0) + (ramRow.awayScore ?? 0);
    const dbScore = (dbRow.homeScore ?? 0) + (dbRow.awayScore ?? 0);
    if (ramScore !== dbScore) return ramScore > dbScore ? ramRow : dbRow;
    const ramEvs = ramRow.events?.length ?? 0;
    const dbEvs = dbRow.events?.length ?? 0;
    if (ramEvs !== dbEvs) return ramEvs > dbEvs ? ramRow : dbRow;
    const ramMin = parseVirtualMinuteInt(ramRow.minute);
    const dbMin = parseVirtualMinuteInt(dbRow.minute);
    return ramMin >= dbMin ? ramRow : dbRow;
  }
  return dbRow;
}

/**
 * Hydrate et réconcilie en UNE SEULE requête SQL `UNION ALL` l'état actif complet
 * des matchs entre toutes les instances Serverless Vercel :
 * - Réconciliation multi-instance attendue (`await`) toutes les `2,5 s` max (coalescée via
 *   Singleflight `st.hydratePromise`) et forcée immédiatement sur tout refresh manuel (`force = true`).
 * - Préservation monotone des matchs virtuels déjà avancés en RAM entre deux jalons SQL.
 */
export async function ensureMatchStoreHydrated(force = false): Promise<void> {
  const st = getState();
  const now = Date.now();

  if (
    !force &&
    st.matchesHydratedAt > 0 &&
    now - st.matchesHydratedAt < MULTI_INSTANCE_RECONCILE_MS
  ) {
    return;
  }

  if (st.hydratePromise) {
    await st.hydratePromise;
    if (!force) return;
  }

  st.hydratePromise = (async () => {
    try {
      const qActive = db
        .select()
        .from(matches)
        .where(ne(matches.status, "finished"))
        .orderBy(
          asc(sql`CASE ${matches.status} WHEN 'live' THEN 0 ELSE 1 END`),
          asc(matches.startsAt),
          desc(matches.id)
        )
        .limit(120);

      const qFinManual = db
        .select()
        .from(matches)
        .where(and(eq(matches.source, "manual"), eq(matches.status, "finished")))
        .orderBy(sql`${matches.finishedAt} DESC NULLS LAST`, desc(matches.id))
        .limit(MAX_FINISHED_MANUAL_RAM);

      const qFinVirtual = db
        .select()
        .from(matches)
        .where(and(ne(matches.source, "manual"), eq(matches.status, "finished")))
        .orderBy(sql`${matches.finishedAt} DESC NULLS LAST`, desc(matches.id))
        .limit(MAX_FINISHED_VIRTUAL_RAM);

      const rows = await unionAll(qActive, qFinManual, qFinVirtual);

      const prevOpenVirtual = st.openVirtual;
      const prevFinVirtualById = new Map(
        st.finishedVirtual.map((m) => [m.id, m] as const)
      );

      const nextOpenVirtual = new Map<number, MatchRow>();
      const nextOpenManual = new Map<number, MatchRow>();
      const nextFinVirtualMap = new Map<number, MatchRow>();
      const nextFinManual: MatchRow[] = [];

      for (const r of rows) {
        if (r.source === "manual") {
          if (r.status === "finished") nextFinManual.push(r);
          else nextOpenManual.set(r.id, r);
        } else {
          if (r.status === "finished") {
            nextFinVirtualMap.set(r.id, r);
          } else {
            const alreadyFinInRam = prevFinVirtualById.get(r.id);
            if (alreadyFinInRam) {
              nextFinVirtualMap.set(r.id, alreadyFinInRam);
            } else {
              nextOpenVirtual.set(
                r.id,
                pickMonotonicVirtualOpenRow(r, prevOpenVirtual.get(r.id))
              );
            }
          }
        }
      }

      st.openVirtual = nextOpenVirtual;
      st.openManual = nextOpenManual;
      st.finishedVirtual = sortFinishedDesc(
        [...nextFinVirtualMap.values()],
        MAX_FINISHED_VIRTUAL_RAM
      );
      st.finishedManual = sortFinishedDesc(nextFinManual, MAX_FINISHED_MANUAL_RAM);
      st.matchesHydratedAt = Date.now();
      st.manualRefreshedAt = st.matchesHydratedAt;
    } finally {
      st.hydratePromise = null;
    }
  })();

  await st.hydratePromise;
}

export function isMatchStoreHydrated(): boolean {
  return getState().matchesHydratedAt > 0;
}

export function getCachedActiveVirtualMatches(): MatchRow[] {
  return [...getState().openVirtual.values()];
}

export function getCachedOpenManualMatches(): MatchRow[] {
  return [...getState().openManual.values()];
}

export function hasLiveActiveMatches(): boolean {
  const st = getState();
  for (const m of st.openVirtual.values()) {
    if (m.status === "live") return true;
  }
  for (const m of st.openManual.values()) {
    if (m.status === "live") return true;
  }
  return false;
}

export function getCachedMatchById(id: number): MatchRow | null {
  const st = getState();
  return (
    st.openVirtual.get(id) ??
    st.openManual.get(id) ??
    st.finishedVirtual.find((m) => m.id === id) ??
    st.finishedManual.find((m) => m.id === id) ??
    null
  );
}

/**
 * Retourne l'ensemble ordonné des matchs actifs et récemment terminés depuis la RAM
 * (exactement la même structure que l'ancien `UNION ALL` de `GET /api/matches`, avec 0 requête SQL).
 */
export function getCachedAllMatchesForFeed(): MatchRow[] {
  const st = getState();
  const sortActive = (arr: MatchRow[]) =>
    arr.sort((a, b) => {
      const rankA = a.status === "live" ? 0 : 1;
      const rankB = b.status === "live" ? 0 : 1;
      if (rankA !== rankB) return rankA - rankB;
      return a.startsAt.getTime() - b.startsAt.getTime() || b.id - a.id;
    });

  const activeManual = sortActive([...st.openManual.values()]);
  const activeVirtual = sortActive([...st.openVirtual.values()]);

  return [
    ...activeManual,
    ...st.finishedManual,
    ...activeVirtual,
    ...st.finishedVirtual,
  ];
}

export function upsertCachedMatches(rows: MatchRow[]): void {
  if (rows.length === 0) return;
  const st = getState();
  if (st.matchesHydratedAt === 0) return;

  let virtualFinChanged = false;
  let manualFinChanged = false;

  for (const r of rows) {
    if (r.source === "manual") {
      if (r.status === "finished") {
        st.openManual.delete(r.id);
        st.finishedManual = [
          r,
          ...st.finishedManual.filter((x) => x.id !== r.id),
        ];
        manualFinChanged = true;
      } else {
        st.openManual.set(r.id, r);
      }
    } else {
      if (r.status === "finished") {
        st.openVirtual.delete(r.id);
        // Nettoie les champs lourds inutiles une fois le match terminé en RAM
        const cleanFin: MatchRow = {
          ...r,
          scriptedEvents: null,
          tickHistory: [],
        };
        st.finishedVirtual = [
          cleanFin,
          ...st.finishedVirtual.filter((x) => x.id !== r.id),
        ];
        virtualFinChanged = true;
      } else {
        st.openVirtual.set(r.id, r);
      }
    }
  }

  if (virtualFinChanged) {
    st.finishedVirtual = sortFinishedDesc(st.finishedVirtual, MAX_FINISHED_VIRTUAL_RAM);
  }
  if (manualFinChanged) {
    st.finishedManual = sortFinishedDesc(st.finishedManual, MAX_FINISHED_MANUAL_RAM);
  }
  invalidatePublicApiCaches();
  publishPartyRoomEvent(PARTY_LIVE_MATCHES_ROOM, {
    type: "MATCHES_INVALIDATE",
    matchIds: rows.map((r) => r.id),
    ts: Date.now(),
  });
}

export function removeCachedMatch(matchId: number): void {
  const st = getState();
  st.openVirtual.delete(matchId);
  st.openManual.delete(matchId);
  st.finishedVirtual = st.finishedVirtual.filter((m) => m.id !== matchId);
  st.finishedManual = st.finishedManual.filter((m) => m.id !== matchId);
  invalidatePublicApiCaches();
  publishPartyRoomEvent(PARTY_LIVE_MATCHES_ROOM, {
    type: "MATCHES_INVALIDATE",
    matchIds: [matchId],
    ts: Date.now(),
  });
}

export function invalidateAllActiveCaches(purgeEdge = true): void {
  const st = getState();
  st.matchesHydratedAt = 0;
  st.manualRefreshedAt = 0;
  st.pendingFlagsHydratedAt = 0;
  st.pendingBookHydratedAt = 0;
  st.questionScheduleCheckedAt = 0;
  st.nextQuestionResolveAtMs = 0;
  st.userPulseCache.clear();
  st.userBetsCache.clear();
  invalidatePublicApiCaches(purgeEdge);
  publishPartyRoomEvent(PARTY_LIVE_MATCHES_ROOM, {
    type: "MATCHES_INVALIDATE",
    ts: Date.now(),
  });
}

/* ============================================================================
 *  GARDES LÉGERS DE PARIS EN ATTENTE & D'ÉCHÉANCE DES PRÉDICTIONS (0 SQL AU REPOS)
 * ============================================================================ */

export async function ensurePendingBetFlags(): Promise<{
  hasPendingSportBets: boolean;
  hasPendingComboBets: boolean;
  hasPendingPredBets: boolean;
}> {
  const st = getState();
  const now = Date.now();
  if (
    st.pendingFlagsHydratedAt > 0 &&
    now - st.pendingFlagsHydratedAt < PENDING_FLAGS_SAFETY_TTL_MS
  ) {
    return {
      hasPendingSportBets: st.hasPendingSportBets,
      hasPendingComboBets: st.hasPendingComboBets,
      hasPendingPredBets: st.hasPendingPredBets,
    };
  }

  const res = await db.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM "bets" WHERE "status" = 'pending') AS has_sport,
      EXISTS (
        SELECT 1 FROM "combo_bets"
        WHERE "status" = 'pending' OR "legs" @> '[{"status":"pending"}]'::jsonb
      ) AS has_combo,
      EXISTS (SELECT 1 FROM "prediction_bets" WHERE "status" = 'pending') AS has_pred
  `);
  const row = (res.rows?.[0] ?? {}) as {
    has_sport?: boolean;
    has_combo?: boolean;
    has_pred?: boolean;
  };

  st.hasPendingSportBets = Boolean(row.has_sport);
  st.hasPendingComboBets = Boolean(row.has_combo);
  st.hasPendingPredBets = Boolean(row.has_pred);
  st.pendingFlagsHydratedAt = Date.now();

  if (!st.hasPendingSportBets) st.sportTicketsByMatch.clear();
  if (!st.hasPendingComboBets) st.comboLegsByMatch.clear();

  return {
    hasPendingSportBets: st.hasPendingSportBets,
    hasPendingComboBets: st.hasPendingComboBets,
    hasPendingPredBets: st.hasPendingPredBets,
  };
}

export async function getCachedPendingBookForMatches(
  openMatchIds: number[]
): Promise<{
  sportTickets: Array<CachedPendingMatchTicket & { matchId: number }>;
  comboTickets: Array<CachedPendingMatchTicket & { matchId: number }>;
}> {
  const flags = await ensurePendingBetFlags();
  if (!flags.hasPendingSportBets && !flags.hasPendingComboBets) {
    return { sportTickets: [], comboTickets: [] };
  }

  const st = getState();
  const now = Date.now();
  if (now - st.pendingBookHydratedAt >= PENDING_BOOK_TTL_MS) {
    const [pSport, pCombos] = await Promise.all([
      flags.hasPendingSportBets
        ? db
            .select({
              userId: bets.userId,
              matchId: bets.matchId,
              market: bets.market,
              selection: bets.selection,
              stake: bets.stake,
              odds: bets.odds,
            })
            .from(bets)
            .where(eq(bets.status, "pending"))
        : Promise.resolve([]),
      flags.hasPendingComboBets
        ? db
            .select({
              userId: comboBets.userId,
              stake: comboBets.stake,
              baseOdds: comboBets.baseOdds,
              legs: comboBets.legs,
            })
            .from(comboBets)
            .where(eq(comboBets.status, "pending"))
        : Promise.resolve([]),
    ]);

    const nextSportMap = new Map<number, CachedPendingMatchTicket[]>();
    for (const b of pSport) {
      if (b.matchId == null) continue;
      const list = nextSportMap.get(b.matchId) ?? [];
      list.push({
        userId: b.userId,
        market: b.market,
        selection: b.selection,
        stake: b.stake,
        odds: b.odds,
      });
      nextSportMap.set(b.matchId, list);
    }

    const nextComboMap = new Map<number, CachedPendingMatchTicket[]>();
    for (const cb of pCombos) {
      for (const leg of cb.legs ?? []) {
        if (leg.kind !== "sport" || !leg.matchId || leg.status !== "pending") continue;
        const list = nextComboMap.get(leg.matchId) ?? [];
        const effectiveOdds = Math.min(
          25,
          leg.odds * Math.pow(Math.max(1, cb.baseOdds / Math.max(1.01, leg.odds)), 0.35)
        );
        list.push({
          userId: cb.userId,
          market: leg.market,
          selection: leg.selection,
          stake: cb.stake,
          odds: effectiveOdds,
        });
        nextComboMap.set(leg.matchId, list);
      }
    }

    st.sportTicketsByMatch = nextSportMap;
    st.comboLegsByMatch = nextComboMap;
    st.hasPendingSportBets = pSport.length > 0;
    st.hasPendingComboBets = pCombos.length > 0;
    st.pendingBookHydratedAt = Date.now();
  }

  const openSet = new Set(openMatchIds);
  const sportTickets: Array<CachedPendingMatchTicket & { matchId: number }> = [];
  const comboTickets: Array<CachedPendingMatchTicket & { matchId: number }> = [];

  for (const mid of openSet) {
    for (const t of st.sportTicketsByMatch.get(mid) ?? []) {
      sportTickets.push({ ...t, matchId: mid });
    }
    for (const t of st.comboLegsByMatch.get(mid) ?? []) {
      comboTickets.push({ ...t, matchId: mid });
    }
  }

  return { sportTickets, comboTickets };
}

export async function isAnyQuestionDueNow(nowMs = Date.now()): Promise<boolean> {
  const st = getState();
  if (
    st.questionScheduleCheckedAt > 0 &&
    nowMs - st.questionScheduleCheckedAt < QUESTION_SCHEDULE_MAX_TTL_MS &&
    nowMs < st.nextQuestionResolveAtMs
  ) {
    return false;
  }

  const [row] = await db
    .select({
      minResolvesAt: sql<Date | string | null>`MIN(${predictionQuestions.resolvesAt})`,
    })
    .from(predictionQuestions)
    .where(eq(predictionQuestions.status, "open"));

  st.questionScheduleCheckedAt = nowMs;
  if (!row?.minResolvesAt) {
    st.nextQuestionResolveAtMs = nowMs + QUESTION_SCHEDULE_MAX_TTL_MS;
    return false;
  }

  const nextMs = new Date(row.minResolvesAt).getTime();
  st.nextQuestionResolveAtMs = Number.isFinite(nextMs)
    ? nextMs
    : nowMs + QUESTION_SCHEDULE_MAX_TTL_MS;

  return nowMs >= st.nextQuestionResolveAtMs;
}

export function invalidateQuestionScheduleCache(): void {
  const st = getState();
  st.questionScheduleCheckedAt = 0;
  st.nextQuestionResolveAtMs = 0;
  publishPartyRoomEvent(PARTY_LIVE_MATCHES_ROOM, {
    type: "PREDICTIONS_INVALIDATE",
    ts: Date.now(),
  });
}

export function invalidateUserCaches(userIds?: number[]): void {
  const st = getState();
  if (!userIds || userIds.length === 0) {
    st.userPulseCache.clear();
    st.userBetsCache.clear();
    publishUserRealtimeInvalidation(undefined, "global_user_cache_reset");
    return;
  }
  for (const uid of userIds) {
    st.userPulseCache.delete(uid);
    for (const key of st.userBetsCache.keys()) {
      if (key.startsWith(`${uid}:`)) {
        st.userBetsCache.delete(key);
      }
    }
  }
  publishUserRealtimeInvalidation(userIds, "user_cache_invalidate");
}

export function notifyNewBetPlaced(opts: {
  userId: number;
  kind: "sport" | "combo" | "prediction";
}): void {
  const st = getState();
  if (opts.kind === "sport") st.hasPendingSportBets = true;
  if (opts.kind === "combo") st.hasPendingComboBets = true;
  if (opts.kind === "prediction") st.hasPendingPredBets = true;
  st.pendingFlagsHydratedAt = Date.now();
  // Force un rafraîchissement propre du carnet d'exposition au prochain jalon
  st.pendingBookHydratedAt = 0;
  invalidateUserCaches([opts.userId]);
}

export function notifyBetsSettledOrMutated(userIds?: number[]): void {
  const st = getState();
  st.pendingFlagsHydratedAt = 0;
  st.pendingBookHydratedAt = 0;
  invalidateUserCaches(userIds);
}

/* ============================================================================
 *  CACHE MÉMOIRE ULTRA-COURT PAR JOUEUR (`/api/pulse` & `/api/bets`)
 * ============================================================================ */

export function getCachedUserPulse(userId: number): CachedJsonPayload | null {
  const hit = getState().userPulseCache.get(userId);
  if (hit && Date.now() - hit.at < USER_PULSE_CACHE_TTL_MS) {
    return hit.entry;
  }
  return null;
}

export function setCachedUserPulse(
  userId: number,
  payload: UserPulsePayload
): CachedJsonPayload {
  const json = JSON.stringify(payload);
  const entry: CachedJsonPayload = {
    json,
    etag: computeWeakEtag(json),
    at: Date.now(),
  };
  getState().userPulseCache.set(userId, { at: entry.at, entry });
  return entry;
}

export function getCachedUserBetsResponse(
  userId: number,
  filter: string
): CachedJsonPayload | null {
  const key = `${userId}:${filter}`;
  const hit = getState().userBetsCache.get(key);
  if (hit && Date.now() - hit.at < USER_BETS_CACHE_TTL_MS) {
    return hit;
  }
  return null;
}

export function setCachedUserBetsResponse(
  userId: number,
  filter: string,
  data: unknown
): CachedJsonPayload {
  const key = `${userId}:${filter}`;
  const json = JSON.stringify(data);
  const entry: CachedJsonPayload = {
    json,
    etag: computeWeakEtag(json),
    at: Date.now(),
  };
  getState().userBetsCache.set(key, entry);
  return entry;
}
