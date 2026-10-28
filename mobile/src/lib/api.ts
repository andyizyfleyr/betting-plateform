import {
  seedBetsSnapshot,
  seedFinishedMatchSnapshot,
  seedFinishedMatchesSnapshot,
  seedMatchSnapshot,
  seedMatchesSnapshot,
  seedPredictionsSnapshot,
  seedSingleBetSnapshot,
  setCachedWalletSnapshot,
} from "./entity-cache";
import type { LiveClockAnchor } from "./live-clock";
import {
  ApiHttpError,
  CASHOUT_CHANGED_CODE,
  generateBetIdempotencyKey,
  generateIdempotencyKey,
  ODDS_CHANGED_CODE,
  persistAuthToken,
  requestJson,
  roundOdds2,
  type CashoutChangedDetails,
  type OddsChangedDetails,
  type OddsChangedLegDetail,
} from "./http";

export {
  ApiHttpError,
  CASHOUT_CHANGED_CODE,
  generateBetIdempotencyKey,
  generateIdempotencyKey,
  ODDS_CHANGED_CODE,
  roundOdds2,
  type CashoutChangedDetails,
  type OddsChangedDetails,
  type OddsChangedLegDetail,
};

export type MatchStatus = "live" | "upcoming" | "finished";
export type MatchSource = "virtual" | "manual";
export type BetStatus = "pending" | "won" | "lost" | "cashed" | "void";
export type BetKind = "sport" | "prediction" | "combo";
export type OddsChangePolicy = "confirm_all" | "accept_higher";
export type OddsLockPolicy = OddsChangePolicy;

export interface MarketOutcome {
  key: string;
  label: string;
  short?: string;
  shortLabel?: string;
  odds: number;
}

export interface MarketRow {
  label: string;
  outcomes: MarketOutcome[];
}

export interface MarketGroup {
  key: string;
  label: string;
  short?: string;
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

export interface MomentumBucket {
  minuteEnd: number;
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
  momentum: MomentumBucket[];
  recentHomePressure: number;
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
  offsidesHome?: number | null;
  offsidesAway?: number | null;
  savesHome?: number | null;
  savesAway?: number | null;
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
  updatedAt?: string;
}

export interface ClientMatch {
  id: number;
  sport: string;
  league: string;
  source: MatchSource;
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

export interface ClientMatchHistoryItem {
  id: number;
  sport: string;
  league: string;
  source: MatchSource;
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

export type ClientFinishedMatch = ClientMatchHistoryItem;

export interface ClientComboLeg {
  id: number;
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
  matchSource?: MatchSource | null;
  matchClockAnchor?: LiveClockAnchor | null;
  startsAt?: string | null;
  minute?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
}

export interface ClientBet {
  id: number;
  kind: BetKind;
  matchId: number | null;
  sport: string;
  league: string;
  title: string;
  subtitle: string;
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
  cashOutValue: number | null;
  placedAt: string;
  settledAt?: string | null;
  matchStatus: MatchStatus | null;
  matchHomeScore: number | null;
  matchAwayScore: number | null;
  matchMinute: string | null;
  matchStartsAt: string | null;
  matchSource?: MatchSource | null;
  matchClockAnchor?: LiveClockAnchor | null;
  liveMatchId?: number | null;
  liveMatchStartsAt?: string | null;
  liveMatchSource?: MatchSource | null;
  homeScore?: number | null;
  awayScore?: number | null;
  minute?: string | null;
  startsAt?: string | null;
}

export type ComboLegClient = ClientComboLeg;
export type UnifiedBet = ClientBet;

export interface PredictionOptionClient {
  key: string;
  label: string;
  odds: number;
}

export type ClientPredictionOption = PredictionOptionClient;

export interface ClientPrediction {
  id: number;
  question: string;
  category: string;
  status: "open" | "resolved";
  resolution: string | null;
  oddsYes: number;
  oddsNo: number;
  options?: PredictionOptionClient[] | null;
  volume?: number;
  yesCount?: number;
  noCount?: number;
  resolvesAt: string;
  resolvedAt: string | null;
  myBet?: {
    questionId?: number;
    selection: string;
    selectionLabel?: string;
    status: string;
    stake: number;
    potentialWin: number;
    odds: number;
    cashOutAmount?: number | null;
  } | null;
}

export type ClientPredictionQuestion = ClientPrediction;

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
  language?: string;
  countryCode?: string;
  currency?: string;
  liveSim?: boolean;
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

export type ClientWalletResponse = ClientWalletData;

export interface ClientSavedCouponLeg {
  uid: string;
  kind: "sport" | "prediction";
  matchId?: number;
  matchSource?: MatchSource;
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
  startsAt?: string | null;
  isLive?: boolean;
}

export interface MobileBootstrapResponse {
  user: ClientUser | null;
  pendingCount: number;
  myPredictionBets: Record<
    number,
    {
      questionId: number;
      selection: string;
      selectionLabel: string;
      status: string;
      stake: number;
      potentialWin: number;
      odds: number;
      cashOutAmount: number | null;
    }
  >;
  providers: PaymentProvider[];
  serverTime: string;
}

export interface UserPulseTicket {
  id: number;
  kind: BetKind;
  status: string;
  stake: number;
  potentialWin: number;
  title: string;
  selectionLabel: string;
}

function normalizeClientBet(raw: ClientBet): ClientBet {
  const title =
    raw.title ||
    (raw.kind === "combo"
      ? "Combiné"
      : raw.kind === "prediction"
        ? raw.question || raw.homeTeam
        : `${raw.homeTeam} – ${raw.awayTeam}`);
  const subtitle = raw.subtitle || raw.league || "";
  const legs = Array.isArray(raw.legs)
    ? raw.legs.map((l, idx) => ({
        ...l,
        id: typeof l.id === "number" ? l.id : idx + 1,
        startsAt: l.startsAt ?? l.matchStartsAt ?? null,
        minute: l.minute ?? l.matchMinute ?? null,
        homeScore: l.homeScore ?? l.matchHomeScore ?? null,
        awayScore: l.awayScore ?? l.matchAwayScore ?? null,
      }))
    : undefined;
  return {
    ...raw,
    title,
    subtitle,
    legs,
    cashOutValue: raw.cashOutValue !== undefined ? raw.cashOutValue : raw.cashOut,
    homeScore: raw.homeScore ?? raw.matchHomeScore,
    awayScore: raw.awayScore ?? raw.matchAwayScore,
    minute: raw.minute ?? raw.matchMinute,
    startsAt: raw.startsAt ?? raw.matchStartsAt,
  };
}

export interface MobileRefreshOpts {
  forceRefresh?: boolean;
}

export const api = {
  mobileBootstrap: (opts?: MobileRefreshOpts) =>
    requestJson<MobileBootstrapResponse>("/api/mobile/bootstrap", {
      ignoreUnauthorizedRedirect: true,
      forceRefresh: opts?.forceRefresh,
    }),

  auth: {
    me: () =>
      requestJson<{ user: ClientUser | null }>("/api/auth/me", {
        ignoreUnauthorizedRedirect: true,
        bypassEtag: true,
      }),
    login: async (
      emailOrPayload:
        | { email: string; password: string; rememberMe?: boolean }
        | string,
      maybePassword?: string,
      maybeRememberMe?: boolean
    ) => {
      const payload =
        typeof emailOrPayload === "string"
          ? {
              email: emailOrPayload,
              password: maybePassword ?? "",
              rememberMe: maybeRememberMe ?? true,
            }
          : emailOrPayload;
      const res = await requestJson<{ user: ClientUser; token?: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: payload,
          ignoreUnauthorizedRedirect: true,
        }
      );
      if (res.token) {
        await persistAuthToken(res.token);
      }
      return res;
    },
    geo: () =>
      requestJson<{
        detected: boolean;
        countryCode: string | null;
        currency: string | null;
      }>("/api/geo", {
        ignoreUnauthorizedRedirect: true,
        bypassEtag: true,
      }),
    register: async (
      nameOrPayload:
        | {
            name: string;
            email: string;
            password: string;
            countryCode: string;
            acceptedTerms?: boolean;
          }
        | string,
      maybeEmail?: string,
      maybePassword?: string,
      maybeAcceptedTerms?: boolean
    ) => {
      const payload =
        typeof nameOrPayload === "string"
          ? {
              name: nameOrPayload,
              email: maybeEmail ?? "",
              password: maybePassword ?? "",
              acceptedTerms: maybeAcceptedTerms ?? true,
            }
          : {
              ...nameOrPayload,
              acceptedTerms: nameOrPayload.acceptedTerms ?? true,
            };
      const res = await requestJson<{ user: ClientUser; token?: string }>(
        "/api/auth/register",
        {
          method: "POST",
          body: payload,
          ignoreUnauthorizedRedirect: true,
        }
      );
      if (res.token) {
        await persistAuthToken(res.token);
      }
      return res;
    },
    forgotPassword: async (emailOrPayload: { email: string } | string) => {
      const payload =
        typeof emailOrPayload === "string"
          ? { email: emailOrPayload }
          : emailOrPayload;
      return requestJson<{ ok: boolean; expiresInMinutes: number }>(
        "/api/auth/forgot-password",
        {
          method: "POST",
          body: payload,
          ignoreUnauthorizedRedirect: true,
        }
      );
    },
    resetPassword: async (payload: {
      email: string;
      code: string;
      password: string;
    }) => {
      const res = await requestJson<{ user: ClientUser; token?: string }>(
        "/api/auth/reset-password",
        {
          method: "POST",
          body: payload,
          ignoreUnauthorizedRedirect: true,
        }
      );
      if (res.token) {
        await persistAuthToken(res.token);
      }
      return res;
    },
    logout: async () => {
      try {
        await requestJson<{ ok: boolean }>("/api/auth/logout", {
          method: "POST",
          ignoreUnauthorizedRedirect: true,
        });
      } finally {
        await persistAuthToken(null);
      }
    },
  },

  matchesSlim: async (
    opts?: MobileRefreshOpts
  ): Promise<{ matches: ClientMatch[]; serverTime?: string }> => {
    try {
      const data = await requestJson<{ matches: ClientMatch[]; serverTime?: string }>(
        "/api/matches/slim",
        { forceRefresh: opts?.forceRefresh }
      );
      seedMatchesSnapshot(data.matches);
      return data;
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 404) {
        const fallback = await requestJson<{
          matches: ClientMatch[];
          serverTime?: string;
        }>("/api/matches", { forceRefresh: opts?.forceRefresh });
        seedMatchesSnapshot(fallback.matches);
        return fallback;
      }
      throw err;
    }
  },

  matches: async (
    opts?: MobileRefreshOpts
  ): Promise<{ matches: ClientMatch[]; serverTime?: string }> => {
    return api.matchesSlim(opts);
  },

  matchById: async (
    id: number,
    opts?: MobileRefreshOpts
  ): Promise<{ match: ClientMatch; serverTime?: string }> => {
    const data = await requestJson<{ match: ClientMatch; serverTime?: string }>(
      `/api/matches/${encodeURIComponent(String(id))}`,
      { forceRefresh: opts?.forceRefresh }
    );
    seedMatchSnapshot(data.match);
    return data;
  },

  matchHistory: async (matchId?: number, opts?: MobileRefreshOpts) => {
    const qs =
      typeof matchId === "number" && Number.isInteger(matchId) && matchId > 0
        ? `?matchId=${matchId}`
        : "";
    const data = await requestJson<{
      matches: ClientMatchHistoryItem[];
      focusedMatch: ClientMatchHistoryItem | null;
      serverTime?: string;
    }>(`/api/matches/history${qs}`, { forceRefresh: opts?.forceRefresh });
    if (!qs) {
      seedFinishedMatchesSnapshot(data.matches);
    } else if (data.focusedMatch) {
      seedFinishedMatchSnapshot(data.focusedMatch);
    }
    return data;
  },

  pulse: (opts?: MobileRefreshOpts) =>
    requestJson<{
      balance: number | null;
      pendingCount: number;
      tickets: UserPulseTicket[];
      serverTime?: string;
    }>("/api/pulse", { forceRefresh: opts?.forceRefresh }),

  realtime: () =>
    requestJson<{
      enabled: boolean;
      host: string | null;
      protocol: "ws" | "wss";
      publicRoom: string;
      userRoom: string | null;
      userToken: string | null;
    }>("/api/realtime", { bypassEtag: true }),

  bets: Object.assign(
    async (
      filter: "ongoing" | "finished" | "all" = "all",
      opts?: MobileRefreshOpts
    ) => {
      const data = await requestJson<{
        bets: ClientBet[];
        balance: number | null;
      }>(`/api/bets?filter=${filter}`, { forceRefresh: opts?.forceRefresh });
      const normalized = data.bets.map(normalizeClientBet);
      seedBetsSnapshot(normalized);
      return { bets: normalized, balance: data.balance };
    },
    {
      list: async (
        filter: "ongoing" | "finished" | "all" = "all",
        opts?: MobileRefreshOpts
      ) => {
        const data = await requestJson<{
          bets: ClientBet[];
          balance: number | null;
        }>(`/api/bets?filter=${filter}`, { forceRefresh: opts?.forceRefresh });
        const normalized = data.bets.map(normalizeClientBet);
        seedBetsSnapshot(normalized);
        return { bets: normalized, balance: data.balance };
      },
      byId: async (
        kind: "sport" | "prediction" | "combo",
        id: number,
        opts?: MobileRefreshOpts
      ) => {
        const data = await requestJson<{
          bets: ClientBet[];
          balance: number | null;
        }>(
          `/api/bets?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(
            String(id)
          )}`,
          { forceRefresh: opts?.forceRefresh }
        );
        const normalized = data.bets.map(normalizeClientBet);
        for (const b of normalized) {
          seedSingleBetSnapshot(b);
        }
        const found =
          normalized.find(
            (b) => (b.kind ?? "sport") === kind && b.id === id
          ) ?? null;
        return { bet: found, balance: data.balance };
      },
      placeSingle: (payload: {
        matchId: number;
        selection: string;
        market?: string;
        stake: number;
        expectedOdds: number;
        oddsPolicy?: OddsChangePolicy;
        idempotencyKey: string;
      }) =>
        requestJson<{ bet: ClientBet; balance: number; deduplicated?: boolean }>(
          "/api/bets",
          {
            method: "POST",
            body: payload,
          }
        ),
      placeCombo: (payload: {
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
        requestJson<{
          bet: {
            id: number;
            totalOdds: number;
            stake: number;
            potentialWin: number;
            boostPct: number;
          };
          balance: number;
          deduplicated?: boolean;
        }>("/api/bets/combo", {
          method: "POST",
          body: payload,
        }),
      cashout: (payload: {
        betId: number;
        kind?: BetKind;
        expectedCashout: number;
        idempotencyKey: string;
      }) =>
        requestJson<{ balance: number; value: number; deduplicated?: boolean }>(
          "/api/bets/cashout",
          {
            method: "POST",
            body: payload,
          }
        ),
    }
  ),

  allBets: async (opts?: MobileRefreshOpts) => {
    const data = await requestJson<{ bets: ClientBet[]; balance: number | null }>(
      "/api/bets?filter=all",
      { forceRefresh: opts?.forceRefresh }
    );
    const normalized = data.bets.map(normalizeClientBet);
    seedBetsSnapshot(normalized);
    return { bets: normalized, balance: data.balance };
  },

  placeBet: (payload: {
    matchId: number;
    selection: string;
    market?: string;
    stake: number;
    expectedOdds: number;
    oddsPolicy?: OddsChangePolicy;
    idempotencyKey: string;
  }) =>
    requestJson<{ bet: ClientBet; balance: number; deduplicated?: boolean }>(
      "/api/bets",
      {
        method: "POST",
        body: payload,
      }
    ),

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
    requestJson<{
      bet: {
        id: number;
        totalOdds: number;
        stake: number;
        potentialWin: number;
        boostPct: number;
      };
      balance: number;
      deduplicated?: boolean;
    }>("/api/bets/combo", {
      method: "POST",
      body: payload,
    }),

  cashOut: (payload: {
    betId: number;
    kind?: BetKind;
    expectedCashout: number;
    idempotencyKey: string;
  }) =>
    requestJson<{ balance: number; value: number; deduplicated?: boolean }>(
      "/api/bets/cashout",
      {
        method: "POST",
        body: payload,
      }
    ),

  saveCoupon: (legs: ClientSavedCouponLeg[]) =>
    requestJson<{ code: string }>("/api/coupons", {
      method: "POST",
      body: { legs },
    }),

  loadCoupon: (code: string) =>
    requestJson<{
      code: string;
      legs: ClientSavedCouponLeg[];
      skippedClosedCount?: number;
    }>(`/api/coupons?code=${encodeURIComponent(code)}`, {
      bypassEtag: true,
    }),

  predictionsCatalog: async (opts?: MobileRefreshOpts) => {
    const res = await requestJson<{
      questions: ClientPrediction[];
      serverTime?: string;
    }>("/api/predictions/catalog", { forceRefresh: opts?.forceRefresh });
    seedPredictionsSnapshot(res.questions);
    return res;
  },

  myPredictionBets: (opts?: MobileRefreshOpts) =>
    requestJson<{
      myBets: Record<
        number,
        NonNullable<ClientPrediction["myBet"]> & { questionId: number }
      >;
    }>("/api/predictions/my-bets", { forceRefresh: opts?.forceRefresh }),

  predictionsMine: (opts?: MobileRefreshOpts) =>
    requestJson<{
      myBets: Record<
        number,
        NonNullable<ClientPrediction["myBet"]> & { questionId: number }
      >;
    }>("/api/predictions/my-bets", { forceRefresh: opts?.forceRefresh }),

  predictions: {
    place: (payload: {
      questionId: number;
      selection: string;
      stake: number;
      expectedOdds: number;
      oddsPolicy?: OddsChangePolicy;
      idempotencyKey: string;
    }) =>
      requestJson<{
        bet: ClientPredictionBet;
        balance: number;
        deduplicated?: boolean;
      }>("/api/predictions", {
        method: "POST",
        body: payload,
      }),
    catalog: async (opts?: MobileRefreshOpts) => {
      const res = await requestJson<{
        questions: ClientPrediction[];
        serverTime?: string;
      }>("/api/predictions/catalog", { forceRefresh: opts?.forceRefresh });
      seedPredictionsSnapshot(res.questions);
      return res;
    },
    mine: (opts?: MobileRefreshOpts) =>
      requestJson<{
        myBets: Record<
          number,
          NonNullable<ClientPrediction["myBet"]> & { questionId: number }
        >;
      }>("/api/predictions/my-bets", { forceRefresh: opts?.forceRefresh }),
  },

  placePredictionBet: (payload: {
    questionId: number;
    selection: string;
    stake: number;
    expectedOdds: number;
    oddsPolicy?: OddsChangePolicy;
    idempotencyKey: string;
  }) =>
    requestJson<{
      bet: ClientPredictionBet;
      balance: number;
      deduplicated?: boolean;
    }>("/api/predictions", {
      method: "POST",
      body: payload,
    }),

  wallet: async (opts?: MobileRefreshOpts) => {
    const data = await requestJson<ClientWalletData>("/api/wallet", {
      forceRefresh: opts?.forceRefresh,
    });
    setCachedWalletSnapshot(data);
    return data;
  },

  requestWithdrawal: (payload: {
    method: string;
    destination: string;
    amount: number;
    idempotencyKey: string;
  }) =>
    requestJson<{
      withdrawal: ClientWithdrawal;
      balance: number;
      deduplicated?: boolean;
    }>("/api/withdrawals", {
      method: "POST",
      body: payload,
    }),

  cancelWithdrawal: (withdrawalId: number, idempotencyKey: string) =>
    requestJson<{
      withdrawal: ClientWithdrawal;
      balance: number;
      deduplicated?: boolean;
    }>("/api/withdrawals", {
      method: "PATCH",
      body: { withdrawalId, idempotencyKey },
    }),

  settings: () => requestJson<{ user: ClientUser }>("/api/settings"),

  patchSettings: (patch: Partial<ClientUser>) =>
    requestJson<{ user: ClientUser }>("/api/settings", {
      method: "PATCH",
      body: patch,
    }),

  payments: {
    providers: () =>
      requestJson<{ providers: PaymentProvider[] }>("/api/payments"),
    create: (
      provider: "stripe" | "paypal",
      amount: number,
      idempotencyKey: string
    ) =>
      requestJson<{ url: string; providerRef?: string; deduplicated?: boolean }>(
        `/api/payments/${provider}`,
        {
          method: "POST",
          body: { amount, idempotencyKey },
        }
      ),
    manual: (payload: {
      method: "mobile_money" | "sepa";
      reference: string;
      amount: number;
      idempotencyKey: string;
    }) =>
      requestJson<{ ok: boolean; deduplicated?: boolean }>(
        "/api/payments/manual",
        {
          method: "POST",
          body: payload,
        }
      ),
    capturePayPal: (orderId: string, idempotencyKey: string) =>
      requestJson<{ user: ClientUser; deduplicated?: boolean }>(
        "/api/payments/paypal/capture",
        {
          method: "POST",
          body: { orderId, idempotencyKey },
        }
      ),
    status: (ref: string) =>
      requestJson<{ status: string; credited: boolean }>(
        `/api/payments/status?ref=${encodeURIComponent(ref)}`
      ),
  },

  tap: {
    state: () =>
      requestJson<{ status: string; balance: number }>("/api/tap", {
        bypassEtag: true,
      }),
    startGame: (bet: number) =>
      requestJson<{
        status: string;
        multiplier?: number | string;
        factor?: number | string;
        new_balance?: number | string;
        message?: string;
      }>("/api/tap", {
        method: "POST",
        body: { action: "start_game", bet },
      }),
    tapBatch: (count: number) =>
      requestJson<{
        status: "ok" | "crashed" | "autocashout" | string;
        multiplier?: number | string;
        new_balance?: number | string;
        win_amount?: number | string;
        message?: string;
      }>("/api/tap", {
        method: "POST",
        body: { action: "tap_batch", count },
      }),
    cashout: () =>
      requestJson<{
        status: string;
        multiplier?: number | string;
        win_amount?: number | string;
        new_balance?: number | string;
        message?: string;
      }>("/api/tap", {
        method: "POST",
        body: { action: "cashout" },
      }),
    post: (body: Record<string, unknown>, timeoutMs = 10_000) =>
      requestJson<{
        status?: string;
        multiplier?: number | string;
        factor?: number | string;
        win_amount?: number | string;
        new_balance?: number | string;
        message?: string;
      }>("/api/tap", {
        method: "POST",
        body,
        timeoutMs,
      }),
  },

  accelerator: {
    state: () =>
      requestJson<{
        status: string;
        balance: number;
        min_display?: number;
        max_display?: number;
      }>("/api/accelerator", { bypassEtag: true }),
    post: (body: Record<string, unknown>, timeoutMs = 10_000) =>
      requestJson<Record<string, unknown>>("/api/accelerator", {
        method: "POST",
        body,
        timeoutMs,
      }),
  },

  admin: {
    panel: () =>
      requestJson<Record<string, unknown>>("/api/admin", { bypassEtag: true }),
    action: (body: Record<string, unknown>) =>
      requestJson<Record<string, unknown>>("/api/admin", {
        method: "POST",
        body,
      }),
  },
};
