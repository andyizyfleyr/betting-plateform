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
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  status: "pending" | "won" | "lost" | "void";
  matchStatus?: MatchStatus | null;
  matchHomeScore?: number | null;
  matchAwayScore?: number | null;
  matchMinute?: string | null;
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
  status: MatchStatus;
  minute: string | null;
  startsAt: string;
  finishedAt?: string | null;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  suspended: boolean;
  kickoffReached?: boolean;
  redHome?: number;
  redAway?: number;
  events?: ClientMatchEvent[];
  telemetry?: LiveMatchTelemetry;
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "Une erreur est survenue");
  }
  return data as T;
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
  winnerCode: "V1" | "X" | "V2" | null;
  htWinnerCode: "V1" | "X" | "V2" | null;
  totalGoals: number | null;
  btts: boolean | null;
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
