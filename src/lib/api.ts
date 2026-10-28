import type { LiveMatchTelemetry } from "@/lib/live-telemetry";
import {
  calibrateServerClockOffset,
  registerLiveClockMatch,
  registerLiveClockMatches,
  type LiveClockAnchor,
  type LiveClockSource,
} from "@/lib/live-clock";
import {
  rememberBets,
  rememberMatches,
  rememberMatchHistory,
  rememberPredictions,
  rememberSingleMatch,
  rememberWallet,
} from "@/lib/client-entity-cache";
import {
  CASHOUT_CHANGED_CODE,
  type CashoutChangedDetails,
  type OddsChangePolicy,
  type OddsChangedDetails,
} from "@/lib/odds-lock";

export type MatchStatus = "live" | "upcoming" | "finished";
export type BetStatus = "pending" | "won" | "lost" | "cashed" | "void";
export type Selection = "home" | "draw" | "away";
export type BetKind = "sport" | "prediction" | "combo";

export interface ClientComboLeg {
  kind: "sport" | "prediction";
  matchId?: number | null;
  questionId?: number | null;
  sport: string;
  league: string;
  title: string;
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  status: "pending" | "won" | "lost" | "void";
  matchStatus?: MatchStatus | null;
  matchHomeScore?: number | null;
  matchAwayScore?: number | null;
  matchMinute?: string | null;
  matchStartsAt?: string | null;
  matchSource?: "virtual" | "manual" | null;
  matchClockAnchor?: LiveClockAnchor | null;
}

export interface MarketOutcome {
  key: string;
  label: string;
  short: string;
  odds: number;
}

export interface MarketRow {
  label: string;
  outcomes: MarketOutcome[];
}

export interface MarketGroup {
  key: string;
  label: string;
  short: string;
  category?: "main" | "halftime" | "goals" | "teams" | "scores";
  outcomes: MarketOutcome[];
  rows?: MarketRow[];
}

export interface ClientMatchEvent {
  type: string;
  team: string;
  minute: number;
  player?: string;
}

export interface ClientRealMatchStats {
  possessionHome: number | null;
  possessionAway: number | null;
  shotsTotalHome: number | null;
  shotsTotalAway: number | null;
  shotsOnTargetHome: number | null;
  shotsOnTargetAway: number | null;
  cornersHome: number | null;
  cornersAway: number | null;
  foulsHome: number | null;
  foulsAway: number | null;
  offsidesHome: number | null;
  offsidesAway: number | null;
  savesHome: number | null;
  savesAway: number | null;
  yellowCardsHome: number | null;
  yellowCardsAway: number | null;
  htHomeScore: number | null;
  htAwayScore: number | null;
  clockSeconds?: number | null;
  clockPeriod?: number | null;
  statSnapshots?: Array<{
    sec: number;
    sotH: number;
    sotA: number;
    shH: number;
    shA: number;
    corH: number;
    corA: number;
  }>;
  liveFeedProbs?: {
    pHome: number;
    pDraw: number;
    pAway: number;
    source: "bookmaker_live" | "espn_live" | "blended";
    updatedAtSec: number | null;
  } | null;
  feedTotalGoalsExpected?: number | null;
  updatedAt: string;
}

export interface ClientMatch {
  id: number;
  sport: string;
  league: string;
  source: "virtual" | "manual";
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  status: MatchStatus;
  minute: string | null;
  startsAt: string;
  finishedAt?: string | null;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  suspended: boolean;
  kickoffReached?: boolean;
  externalId?: string | null;
  autoSync?: boolean;
  redHome?: number;
  redAway?: number;
  events?: ClientMatchEvent[];
  telemetry?: LiveMatchTelemetry;
  realStats?: ClientRealMatchStats | null;
  clockAnchor?: LiveClockAnchor | null;
  marketCount?: number;
  markets: MarketGroup[];
}

export interface ClientBet {
  id: number;
  kind: BetKind;
  matchId: number | null;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  question?: string | null;
  questionId?: number | null;
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  baseOdds?: number;
  boostPct?: number;
  legs?: ClientComboLeg[];
  stake: number;
  potentialWin: number;
  status: BetStatus;
  cashOutAmount: number | null;
  cashOut: number | null;
  placedAt: string;
  settledAt?: string | null;
  // État actuel du match lié (score live / final)
  matchStatus: MatchStatus | null;
  matchHomeScore: number | null;
  matchAwayScore: number | null;
  matchMinute: string | null;
  matchStartsAt: string | null;
  matchSource?: "virtual" | "manual" | null;
  matchClockAnchor?: LiveClockAnchor | null;
  liveMatchId?: number | null;
  liveMatchStartsAt?: string | null;
  liveMatchSource?: "virtual" | "manual" | null;
}

export interface PredictionOptionClient {
  key: string;
  label: string;
  odds: number;
}

/** Question de prédiction (marché Oui/Non ou Choix multiples à cotes fixes). */
export interface ClientPrediction {
  id: number;
  question: string;
  category: string;
  status: "open" | "resolved";
  resolution: string | null;
  oddsYes: number;
  oddsNo: number;
  options?: PredictionOptionClient[] | null;
  volume: number;
  yesCount: number;
  noCount: number;
  resolvesAt: string;
  resolvedAt: string | null;
  myBet?: {
    selection: string;
    selectionLabel?: string;
    status: string;
    stake: number;
    potentialWin: number;
    odds: number;
  } | null;
}

export interface ClientPredictionBet {
  id: number;
  questionId: number;
  question: string;
  category: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  stake: number;
  potentialWin: number;
  status: BetStatus;
  placedAt: string;
}

export interface ClientUser {
  id: number;
  name: string;
  balance: number;
  role: string;
  notifications: boolean;
  sound: boolean;
  haptics: boolean;
  oddsFormat: "decimal" | "fractional";
  language: string;
  liveSim: boolean;
  bonusLocked?: number;
  email?: string | null;
  createdAt?: string | null;
}

export interface PaymentProvider {
  id: "stripe" | "paypal";
  name: string;
  enabled: boolean;
  live: boolean;
}

export interface ClientWithdrawal {
  id: number;
  userId: number;
  method: string;
  destination: string;
  amount: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  adminNote?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export interface ClientWalletEntry {
  id: string;
  type: "deposit" | "withdrawal" | "win" | "cashout" | "stake" | "adjustment";
  title: string;
  subtitle: string;
  amount: number;
  status: string;
  canCancel?: boolean;
  rawId?: number;
  createdAt: string;
}

export interface ClientWalletData {
  balance: number;
  summary: {
    totalDeposited: number;
    totalWithdrawn: number;
    pendingWithdrawals: number;
    pendingDeposits?: number;
    withdrawable?: number;
    bonusLocked?: number;
    qualifiedWagered?: number;
    bonusRemaining?: number;
  };
  withdrawals?: ClientWithdrawal[];
  entries: ClientWalletEntry[];
}

let redirectingToAuth = false;

const CLIENT_ETAG_CACHE_MAX = 60;
const clientEtagCache = new Map<string, { etag: string; data: unknown }>();
const inFlightGetRequests = new Map<string, Promise<unknown>>();

const lastPublicServerTime: {
  matches: string | null;
  predictions: string | null;
} = {
  matches: null,
  predictions: null,
};

export function getLastPublicServerTime(
  kind: "matches" | "predictions"
): string | null {
  return lastPublicServerTime[kind];
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: OddsChangedDetails;
  cashoutDetails?: CashoutChangedDetails;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: OddsChangedDetails,
    cashoutDetails?: CashoutChangedDetails
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.cashoutDetails = cashoutDetails;
  }
}

function isPublicEdgeGetUrl(url: string): boolean {
  return (
    url === "/api/matches" ||
    url === "/api/matches/slim" ||
    /^\/api\/matches\/[1-9]\d{0,9}$/.test(url) ||
    url === "/api/matches/history" ||
    url.startsWith("/api/matches/history?") ||
    url === "/api/predictions/catalog"
  );
}

async function executeRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method.toUpperCase() === "GET";
  const isPublicEdge = isGet && isPublicEdgeGetUrl(url);
  const cached = isGet ? clientEtagCache.get(url) : undefined;

  let mergedInit: RequestInit | undefined = isGet
    ? { ...init, cache: "no-store" }
    : init;
  if (isPublicEdge) {
    // Omet strictement les cookies sur les routes publiques afin que le CDN Edge Vercel
    // partage 1 seule réponse en cache entre des milliers de visiteurs connectés ou non.
    mergedInit = { ...mergedInit, credentials: "omit" };
  }
  if (isGet && cached?.etag) {
    const hdrs = new Headers(mergedInit?.headers);
    if (!hdrs.has("If-None-Match")) {
      hdrs.set("If-None-Match", cached.etag);
    }
    mergedInit = { ...mergedInit, headers: hdrs };
  } else if (!isGet) {
    // Toute mutation invalide les ETag clients afin de forcer une lecture fraîche immédiate
    clientEtagCache.clear();
  }

  const sentAtMs = Date.now();
  const res = await fetch(url, mergedInit);
  const rttMs = Math.max(0, Date.now() - sentAtMs);
  if (res.status === 304 && cached) {
    const nowIso = new Date().toISOString();
    if (url === "/api/matches") lastPublicServerTime.matches = nowIso;
    if (url === "/api/predictions/catalog") lastPublicServerTime.predictions = nowIso;
    return cached.data as T;
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    details?: OddsChangedDetails & CashoutChangedDetails;
    serverTime?: string;
    matches?: LiveClockSource[];
    match?: LiveClockSource;
  };
  if (!res.ok) {
    if (
      res.status === 401 &&
      !isPublicEdge &&
      typeof window !== "undefined" &&
      !url.startsWith("/api/auth/") &&
      !window.location.pathname.startsWith("/auth") &&
      !redirectingToAuth
    ) {
      redirectingToAuth = true;
      clientEtagCache.clear();
      try {
        window.localStorage.removeItem("pulsebet_cached_user_v1");
      } catch {
        /* ignore */
      }
      void fetch("/api/auth/logout", { method: "POST" })
        .catch(() => undefined)
        .finally(() => {
          window.location.replace("/auth");
        });
    }
    const fallbackMsg =
      res.status === 504
        ? "Le serveur met trop de temps à répondre — veuillez réessayer."
        : "Service temporairement indisponible — veuillez réessayer.";
    const isCashoutChanged = data.code === CASHOUT_CHANGED_CODE;
    throw new ApiRequestError(
      data.error ?? fallbackMsg,
      res.status,
      data.code,
      isCashoutChanged ? undefined : data.details,
      isCashoutChanged ? data.details : undefined
    );
  }

  if (typeof data.serverTime === "string" || res.headers.get("date")) {
    calibrateServerClockOffset({
      serverTimeIso: data.serverTime ?? null,
      ageHeader: res.headers.get("age"),
      dateHeader: res.headers.get("date"),
      rttMs,
    });
  }
  if (Array.isArray(data.matches)) {
    registerLiveClockMatches(data.matches);
  }
  if (data.match && typeof data.match === "object") {
    registerLiveClockMatch(data.match);
  }

  if (isGet) {
    if (url === "/api/matches" && typeof data.serverTime === "string") {
      lastPublicServerTime.matches = data.serverTime;
    } else if (
      url === "/api/predictions/catalog" &&
      typeof data.serverTime === "string"
    ) {
      lastPublicServerTime.predictions = data.serverTime;
    }
    const etag = res.headers.get("etag");
    if (etag) {
      if (clientEtagCache.size >= CLIENT_ETAG_CACHE_MAX) {
        const oldestKey = clientEtagCache.keys().next().value;
        if (oldestKey !== undefined) clientEtagCache.delete(oldestKey);
      }
      clientEtagCache.set(url, { etag, data });
    }
  }

  return data as T;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method.toUpperCase() === "GET";
  if (!isGet) {
    return executeRequest<T>(url, init);
  }

  // Déduplique les appels GET simultanés vers la même URL (ex. montage concurrent Providers + page)
  const existing = inFlightGetRequests.get(url);
  if (existing) {
    return existing as Promise<T>;
  }

  const p = executeRequest<T>(url, init).finally(() => {
    inFlightGetRequests.delete(url);
  });
  inFlightGetRequests.set(url, p);
  return p;
}

export interface ClientMatchHistoryItem {
  id: number;
  sport: string;
  league: string;
  source: "virtual" | "manual";
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  htHome: number | null;
  htAway: number | null;
  status: MatchStatus;
  minute: string | null;
  startsAt: string;
  finishedAt?: string | null;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  redHome: number;
  redAway: number;
  events: ClientMatchEvent[];
  telemetry?: LiveMatchTelemetry;
  realStats?: ClientRealMatchStats | null;
  clockAnchor?: LiveClockAnchor | null;
  winnerCode: "V1" | "X" | "V2" | null;
  htWinnerCode: "V1" | "X" | "V2" | null;
  totalGoals: number | null;
  btts: boolean | null;
}

export interface ClientSavedCouponLeg {
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
}

export interface RealtimeConfigResponse {
  enabled: boolean;
  host: string | null;
  protocol: "ws" | "wss";
  publicRoom: string;
  userRoom: string | null;
  userToken: string | null;
}

export const api = {
  realtime: () => request<RealtimeConfigResponse>("/api/realtime"),
  matchesSlim: () =>
    request<{ matches: ClientMatch[]; serverTime?: string }>("/api/matches/slim"),
  matches: () =>
    request<{ matches: ClientMatch[]; serverTime?: string }>("/api/matches").then(
      (res) => {
        rememberMatches(res.matches);
        return res;
      }
    ),
  matchById: (id: number) =>
    request<{ match: ClientMatch; serverTime?: string }>(`/api/matches/${id}`).then(
      (res) => {
        rememberSingleMatch(res.match);
        return res;
      }
    ),
  matchHistory: (matchId?: number) =>
    request<{
      matches: ClientMatchHistoryItem[];
      focusedMatch: ClientMatchHistoryItem | null;
      serverTime?: string;
    }>(
      typeof matchId === "number" && Number.isInteger(matchId) && matchId > 0
        ? `/api/matches/history?matchId=${matchId}`
        : "/api/matches/history"
    ).then((res) => {
      rememberMatchHistory(res.matches, res.focusedMatch);
      return res;
    }),
  bets: (filter: "ongoing" | "finished") =>
    request<{ bets: ClientBet[]; balance: number | null }>(
      `/api/bets?filter=${filter}`
    ).then((res) => {
      rememberBets(res.bets);
      return res;
    }),
  allBets: () =>
    request<{ bets: ClientBet[]; balance: number | null }>("/api/bets?filter=all").then(
      (res) => {
        rememberBets(res.bets);
        return res;
      }
    ),
  betById: (kind: "sport" | "prediction" | "combo", id: number) =>
    request<{ bets: ClientBet[]; balance: number | null }>(
      `/api/bets?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(String(id))}`
    ).then((res) => {
      rememberBets(res.bets);
      return {
        bet: res.bets.find((b) => (b.kind ?? "sport") === kind && b.id === id) ?? null,
        balance: res.balance,
      };
    }),
  pulse: () =>
    request<{
      balance: number;
      pendingCount: number;
      tickets: Array<{
        id: number;
        kind: BetKind;
        status: string;
        stake: number;
        potentialWin: number;
        title: string;
        selectionLabel: string;
      }>;
    }>("/api/pulse"),
  placeBet: (payload: {
    matchId: number;
    selection: string;
    market?: string;
    stake: number;
    expectedOdds: number;
    oddsPolicy?: OddsChangePolicy;
    idempotencyKey: string;
  }) =>
    request<{ bet: ClientBet; balance: number; deduplicated?: boolean }>("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  placeComboBet: (payload: {
    legs: Array<{
      kind: "sport" | "prediction";
      matchId?: number;
      questionId?: number;
      market?: string;
      selection: string;
      expectedOdds: number;
    }>;
    stake: number;
    expectedTotalOdds: number;
    oddsPolicy?: OddsChangePolicy;
    idempotencyKey: string;
  }) =>
    request<{
      bet: { id: number; totalOdds: number; stake: number; potentialWin: number; boostPct: number };
      balance: number;
      deduplicated?: boolean;
    }>(
      "/api/bets/combo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    ),
  cashOut: (payload: {
    betId: number;
    kind?: BetKind;
    expectedCashout: number;
    idempotencyKey: string;
  }) =>
    request<{ balance: number; value: number; deduplicated?: boolean }>(
      "/api/bets/cashout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    ),
  saveCoupon: (legs: ClientSavedCouponLeg[]) =>
    request<{ code: string }>("/api/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legs }),
    }),
  loadCoupon: (code: string) =>
    request<{ code: string; legs: ClientSavedCouponLeg[]; skippedClosedCount: number }>(
      `/api/coupons?code=${encodeURIComponent(code)}`
    ),
  wallet: () =>
    request<ClientWalletData>("/api/wallet").then((w) => {
      rememberWallet(w);
      return w;
    }),
  requestWithdrawal: (payload: {
    method: string;
    destination: string;
    amount: number;
    idempotencyKey: string;
  }) =>
    request<{ withdrawal: ClientWithdrawal; balance: number; deduplicated?: boolean }>(
      "/api/withdrawals",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    ),
  cancelWithdrawal: (withdrawalId: number, idempotencyKey: string) =>
    request<{ withdrawal: ClientWithdrawal; balance: number; deduplicated?: boolean }>(
      "/api/withdrawals",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawalId, idempotencyKey }),
      }
    ),
  predictions: () =>
    request<{ questions: ClientPrediction[] }>("/api/predictions?limit=100").then(
      (res) => {
        rememberPredictions(res.questions);
        return res;
      }
    ),
  predictionsCatalog: () =>
    request<{ questions: ClientPrediction[]; serverTime?: string }>(
      "/api/predictions/catalog"
    ).then((res) => {
      rememberPredictions(res.questions);
      return res;
    }),
  myPredictionBets: () =>
    request<{
      myBets: Record<
        number,
        NonNullable<ClientPrediction["myBet"]> & { questionId: number }
      >;
    }>("/api/predictions/my-bets"),
  placePredictionBet: (payload: {
    questionId: number;
    selection: string;
    stake: number;
    expectedOdds: number;
    oddsPolicy?: OddsChangePolicy;
    idempotencyKey: string;
  }) =>
    request<{ bet: ClientPredictionBet; balance: number; deduplicated?: boolean }>(
      "/api/predictions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    ),
  settings: () => request<{ user: ClientUser }>("/api/settings"),
  patchSettings: (patch: Partial<ClientUser>) =>
    request<{ user: ClientUser }>("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  payments: {
    providers: () =>
      request<{ providers: PaymentProvider[] }>("/api/payments"),
    create: (provider: "stripe" | "paypal", amount: number, idempotencyKey: string) =>
      request<{ url: string; deduplicated?: boolean }>(`/api/payments/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, idempotencyKey }),
      }),
    manual: (payload: {
      method: "mobile_money" | "sepa";
      reference: string;
      amount: number;
      idempotencyKey: string;
    }) =>
      request<{ ok: boolean; deduplicated?: boolean }>("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    capturePayPal: (orderId: string, idempotencyKey: string) =>
      request<{ user: ClientUser; deduplicated?: boolean }>(
        "/api/payments/paypal/capture",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, idempotencyKey }),
        }
      ),
    status: (ref: string) =>
      request<{ status: string; credited: boolean }>(
        `/api/payments/status?ref=${encodeURIComponent(ref)}`
      ),
  },
  auth: {
    login: (payload: { email: string; password: string }) =>
      request<{ user: ClientUser }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    register: (payload: { name: string; email: string; password: string }) =>
      request<{ user: ClientUser }>("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    me: () => request<{ user: ClientUser }>("/api/auth/me"),
  },
};
