export type MatchStatus = "live" | "upcoming" | "finished";
export type BetStatus = "pending" | "won" | "lost" | "cashed";
export type Selection = "home" | "draw" | "away";
export type BetKind = "sport" | "prediction";

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
  category?: "main" | "goals" | "teams" | "scores";
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
  redHome?: number;
  redAway?: number;
  events?: ClientMatchEvent[];
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
  stake: number;
  potentialWin: number;
  status: BetStatus;
  cashOutAmount: number | null;
  cashOut: number | null;
  placedAt: string;
  // État actuel du match lié (score live / final)
  matchStatus: MatchStatus | null;
  matchHomeScore: number | null;
  matchAwayScore: number | null;
  matchMinute: string | null;
  matchStartsAt: string | null;
}

/** Question de prédiction (marché Oui/Non). */
export interface ClientPrediction {
  id: number;
  question: string;
  category: string;
  status: "open" | "resolved";
  resolution: "yes" | "no" | null;
  oddsYes: number;
  oddsNo: number;
  volume: number;
  yesCount: number;
  noCount: number;
  resolvesAt: string;
  resolvedAt: string | null;
  myBet?: {
    selection: string;
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
  selection: "yes" | "no";
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
  email?: string | null;
  createdAt?: string | null;
}

export interface PaymentProvider {
  id: "stripe" | "paypal";
  name: string;
  enabled: boolean;
  live: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "Une erreur est survenue");
  }
  return data as T;
}

export const api = {
  matches: () => request<{ matches: ClientMatch[] }>("/api/matches"),
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
  cashOut: (betId: number) =>
    request<{ balance: number; value: number }>("/api/bets/cashout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ betId }),
    }),
  predictions: () => request<{ questions: ClientPrediction[] }>("/api/predictions?limit=50"),
  placePredictionBet: (payload: {
    questionId: number;
    selection: "yes" | "no";
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
