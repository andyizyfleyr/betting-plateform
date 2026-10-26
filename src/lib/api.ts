import type { LiveMatchTelemetry } from "@/lib/live-telemetry";

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

export class ApiRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function isPublicEdgeGetUrl(url: string): boolean {
  return (
    url === "/api/matches" ||
    url === "/api/matches/history" ||
    url.startsWith("/api/matches/history?") ||
    url === "/api/predictions/catalog"
  );
}

async function executeRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method.toUpperCase() === "GET";
  const isPublicEdge = isGet && isPublicEdgeGetUrl(url);
  const cached = isGet ? clientEtagCache.get(url) : undefined;

  let mergedInit: RequestInit | undefined = init;
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

  const res = await fetch(url, mergedInit);
  if (res.status === 304 && cached) {
    return cached.data as T;
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
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
    throw new ApiRequestError(
      data.error ?? fallbackMsg,
      res.status,
      data.code
    );
  }

  if (isGet) {
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

export const api = {
  matches: () => request<{ matches: ClientMatch[] }>("/api/matches"),
  matchHistory: (matchId?: number) =>
    request<{
      matches: ClientMatchHistoryItem[];
      focusedMatch: ClientMatchHistoryItem | null;
    }>(
      matchId
        ? `/api/matches/history?matchId=${encodeURIComponent(matchId)}`
        : "/api/matches/history"
    ),
  bets: (filter: "ongoing" | "finished") =>
    request<{ bets: ClientBet[]; balance: number | null }>(`/api/bets?filter=${filter}`),
  allBets: () => request<{ bets: ClientBet[]; balance: number | null }>("/api/bets?filter=all"),
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
  }) =>
    request<{ bet: ClientBet; balance: number }>("/api/bets", {
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
    }>;
    stake: number;
  }) =>
    request<{ bet: { id: number; totalOdds: number; stake: number; potentialWin: number; boostPct: number }; balance: number }>(
      "/api/bets/combo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    ),
  cashOut: (betId: number, kind?: BetKind) =>
    request<{ balance: number; value: number }>("/api/bets/cashout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ betId, kind }),
    }),
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
  wallet: () => request<ClientWalletData>("/api/wallet"),
  requestWithdrawal: (payload: { method: string; destination: string; amount: number }) =>
    request<{ withdrawal: ClientWithdrawal; balance: number }>("/api/withdrawals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  cancelWithdrawal: (withdrawalId: number) =>
    request<{ withdrawal: ClientWithdrawal; balance: number }>("/api/withdrawals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ withdrawalId }),
    }),
  predictions: () => request<{ questions: ClientPrediction[] }>("/api/predictions?limit=100"),
  predictionsCatalog: () =>
    request<{ questions: ClientPrediction[] }>("/api/predictions/catalog"),
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
  }) =>
    request<{ bet: ClientPredictionBet; balance: number }>("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
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
    create: (provider: "stripe" | "paypal", amount: number) =>
      request<{ url: string }>(`/api/payments/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      }),
    manual: (payload: {
      method: "mobile_money" | "sepa";
      reference: string;
      amount: number;
    }) =>
      request<{ ok: boolean }>("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    capturePayPal: (orderId: string) =>
      request<{ user: ClientUser }>("/api/payments/paypal/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      }),
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
