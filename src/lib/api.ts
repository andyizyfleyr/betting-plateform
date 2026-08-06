export type MatchStatus = "live" | "upcoming" | "finished";
export type BetStatus = "pending" | "won" | "lost" | "cashed";
export type Selection = "home" | "draw" | "away";

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
  outcomes: MarketOutcome[];
  rows?: MarketRow[];
}

export interface ClientMatch {
  id: number;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  minute: string | null;
  startsAt: string;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  suspended: boolean;
  markets: MarketGroup[];
}

export interface ClientBet {
  id: number;
  matchId: number | null;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  selection: Selection;
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

export interface ClientUser {
  id: number;
  name: string;
  balance: number;
  notifications: boolean;
  sound: boolean;
  haptics: boolean;
  oddsFormat: "decimal" | "fractional";
  language: string;
  liveSim: boolean;
  email?: string | null;
  createdAt?: string | null;
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
    request<{ bets: ClientBet[] }>(`/api/bets?filter=${filter}`),
  allBets: () => request<{ bets: ClientBet[] }>("/api/bets?filter=all"),
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
  settings: () => request<{ user: ClientUser }>("/api/settings"),
  patchSettings: (patch: Partial<ClientUser> | { action: "deposit"; amount: number }) =>
    request<{ user: ClientUser }>("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
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
