import {
  seedBetsSnapshot,
  seedFinishedMatchSnapshot,
  seedFinishedMatchesSnapshot,
  seedMatchSnapshot,
  seedMatchesSnapshot,
  seedPredictionsSnapshot,
  setCachedWalletSnapshot,
} from "./entity-cache";
import {
  ApiHttpError,
  generateIdempotencyKey,
  persistAuthToken,
  requestJson,
} from "./http";

export { ApiHttpError, generateIdempotencyKey };

export type MatchStatus = "upcoming" | "live" | "finished";
export type MatchSource = "virtual" | "manual";
export type BetStatus = "pending" | "won" | "lost" | "cashed_out" | "void";
export type BetKind = "sport" | "prediction" | "combo";
export type OddsLockPolicy = "strict" | "accept_higher" | "accept_any";

export interface MarketOutcome {
  key: string;
  label: string;
  shortLabel?: string;
  odds: number;
}

export interface MarketGroup {
  key: string;
  label: string;
  category?: "principal" | "buts" | "mi-temps" | "equipes" | "handicap" | "scores";
  hint?: string;
  suspended?: boolean;
  outcomes: MarketOutcome[];
}

export interface ClientMatchEvent {
  min: number;
  team: "home" | "away";
  type?: "goal" | "red";
  text: string;
}

export interface LiveMatchTelemetry {
  phase:
    | "kickoff"
    | "build_up"
    | "attack_home"
    | "attack_away"
    | "danger_home"
    | "danger_away"
    | "goal_home"
    | "goal_away"
    | "red_home"
    | "red_away"
    | "halftime"
    | "fulltime";
  ballX: number;
  ballY: number;
  possessionHome: number;
  possessionAway: number;
  shotsHome: number;
  shotsAway: number;
  shotsOnTargetHome: number;
  shotsOnTargetAway: number;
  cornersHome: number;
  cornersAway: number;
  xgHome: number;
  xgAway: number;
  momentum: number;
  commentary: string;
}

export interface ClientRealMatchStats {
  possessionHome?: number | null;
  possessionAway?: number | null;
  shotsHome?: number | null;
  shotsAway?: number | null;
  shotsOnTargetHome?: number | null;
  shotsOnTargetAway?: number | null;
  cornersHome?: number | null;
  cornersAway?: number | null;
  foulsHome?: number | null;
  foulsAway?: number | null;
  yellowHome?: number | null;
  yellowAway?: number | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  venue?: string | null;
  statusDetail?: string | null;
}

export interface ClientMatch {
  id: number;
  sport: string;
  league: string;
  source?: MatchSource;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
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
  marketCount?: number;
  markets: MarketGroup[];
}

export interface ClientFinishedMatch {
  id: number;
  sport: string;
  league: string;
  source: MatchSource;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number;
  awayScore: number;
  htHomeScore: number | null;
  htAwayScore: number | null;
  startsAt: string;
  finishedAt: string;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  redHome: number;
  redAway: number;
  events: ClientMatchEvent[];
  realStats: ClientRealMatchStats | null;
  winner: "home" | "draw" | "away";
  totalGoals: number;
  btts: boolean;
}

export interface ClientComboLeg {
  kind: "sport" | "prediction";
  matchId?: number;
  questionId?: number;
  title: string;
  league: string;
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
  closingOdds?: number | null;
  clv?: number | null;
  cashOutAmount?: number | null;
  cashOut: number | null;
  placedAt: string;
  settledAt: string | null;
  matchStatus: MatchStatus | null;
  matchHomeScore: number | null;
  matchAwayScore: number | null;
  matchMinute: string | null;
  matchStartsAt?: string | null;
  matchSource?: MatchSource | null;
}

export interface ClientPredictionOption {
  key: string;
  label: string;
  odds: number;
  impliedPct: number;
}

export interface ClientPredictionQuestion {
  id: number;
  category: string;
  question: string;
  description: string | null;
  oddsYes: number;
  oddsNo: number;
  impliedYesPct: number;
  options: ClientPredictionOption[] | null;
  status: "open" | "resolved";
  outcome: string | null;
  resolvesAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  myBet: {
    questionId?: number;
    selection: string;
    selectionLabel: string;
    status: string;
    stake: number;
    potentialWin: number;
    odds: number;
    cashOutAmount: number | null;
  } | null;
}

export interface ClientUser {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
  balance: number;
  oddsFormat: "decimal" | "fractional";
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  stakePresets: number[];
}

export interface PaymentProviderInfo {
  id: "stripe" | "paypal" | "mobile_money" | "sepa";
  label: string;
  subtitle: string;
  instant: boolean;
  liveConfigured: boolean;
  manualInstructions?: {
    beneficiary: string;
    account: string;
    note: string;
  };
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

export interface ClientWalletResponse {
  balance: number;
  summary: {
    totalDeposited: number;
    totalWithdrawn: number;
    pendingWithdrawals: number;
    pendingDeposits: number;
    withdrawable: number;
    bonusLocked: number;
    qualifiedWagered: number;
    bonusRemaining: number;
  };
  entries: ClientWalletEntry[];
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
  providers: PaymentProviderInfo[];
  serverTime: string;
}

export interface UserPulseTicket {
  id: number;
  kind: BetKind;
  status: BetStatus;
  stake: number;
  potentialWin: number;
  title: string;
  selectionLabel: string;
}

export const api = {
  mobileBootstrap: () =>
    requestJson<MobileBootstrapResponse>("/api/mobile/bootstrap", {
      ignoreUnauthorizedRedirect: true,
    }),

  auth: {
    me: () =>
      requestJson<{ user: ClientUser | null }>("/api/auth/me", {
        ignoreUnauthorizedRedirect: true,
        bypassEtag: true,
      }),
    login: async (email: string, password: string) => {
      const res = await requestJson<{ user: ClientUser; token?: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: { email, password },
          ignoreUnauthorizedRedirect: true,
        }
      );
      if (res.token) {
        await persistAuthToken(res.token);
      }
      return res;
    },
    register: async (name: string, email: string, password: string) => {
      const res = await requestJson<{ user: ClientUser; token?: string }>(
        "/api/auth/register",
        {
          method: "POST",
          body: { name, email, password },
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

  /**
   * Flux mobile optimisé (~88 % d'octets économisés) avec repli transparent sur `/api/matches`
   * au cas où l'instance distante n'a pas encore déployé `/api/matches/slim`.
   */
  matchesSlim: async (): Promise<{ matches: ClientMatch[]; serverTime: string }> => {
    try {
      const data = await requestJson<{ matches: ClientMatch[]; serverTime: string }>(
        "/api/matches/slim"
      );
      seedMatchesSnapshot(data.matches);
      return data;
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 404) {
        const fallback = await requestJson<{ matches: ClientMatch[]; serverTime: string }>(
          "/api/matches"
        );
        seedMatchesSnapshot(fallback.matches);
        return fallback;
      }
      throw err;
    }
  },

  matchById: async (id: number): Promise<{ match: ClientMatch; serverTime: string }> => {
    const data = await requestJson<{ match: ClientMatch; serverTime: string }>(
      `/api/matches/${encodeURIComponent(String(id))}`
    );
    seedMatchSnapshot(data.match);
    return data;
  },

  finishedMatches: async (matchId?: number | null) => {
    const qs = matchId && matchId > 0 ? `?match=${matchId}` : "";
    const data = await requestJson<{
      matches: ClientFinishedMatch[];
      focusedMatch: ClientFinishedMatch | null;
      serverTime: string;
    }>(`/api/matches/history${qs}`);
    if (!qs) {
      seedFinishedMatchesSnapshot(data.matches);
    } else if (data.focusedMatch) {
      seedFinishedMatchSnapshot(data.focusedMatch);
    }
    return data;
  },

  pulse: () =>
    requestJson<{
      balance: number | null;
      pendingCount: number;
      tickets: UserPulseTicket[];
      serverTime: string;
    }>("/api/pulse"),

  bets: async (filter: "all" | "ongoing" | "finished" = "all") => {
    const data = await requestJson<{ bets: ClientBet[]; balance: number }>(
      `/api/bets?filter=${filter}`
    );
    seedBetsSnapshot(data.bets);
    return data;
  },

  placeBet: (body: {
    matchId: number;
    market: string;
    selection: string;
    selectionLabel?: string;
    odds: number;
    expectedOdds?: number;
    oddsPolicy?: OddsLockPolicy;
    stake: number;
    idempotencyKey?: string;
  }) =>
    requestJson<{ bet: ClientBet; balance: number }>("/api/bets", {
      method: "POST",
      body: {
        ...body,
        idempotencyKey: body.idempotencyKey ?? generateIdempotencyKey("bet"),
      },
    }),

  placeComboBet: (body: {
    legs: Array<{
      kind: "sport" | "prediction";
      matchId?: number;
      questionId?: number;
      market: string;
      selection: string;
      selectionLabel: string;
      odds: number;
      expectedOdds?: number;
    }>;
    stake: number;
    oddsPolicy?: OddsLockPolicy;
    idempotencyKey?: string;
  }) =>
    requestJson<{ bet: ClientBet; balance: number }>("/api/bets/combo", {
      method: "POST",
      body: {
        ...body,
        idempotencyKey: body.idempotencyKey ?? generateIdempotencyKey("cmb"),
      },
    }),

  cashOut: (
    betId: number,
    kind: BetKind = "sport",
    expectedCashOut?: number,
    idempotencyKey?: string
  ) =>
    requestJson<{ cashOutAmount: number; balance: number }>("/api/bets/cashout", {
      method: "POST",
      body: {
        betId,
        kind,
        ...(typeof expectedCashOut === "number" ? { expectedCashOut } : {}),
        idempotencyKey: idempotencyKey ?? generateIdempotencyKey("co"),
      },
    }),

  predictions: async (authed = true) => {
    const [catalog, overlay] = await Promise.all([
      requestJson<{ questions: ClientPredictionQuestion[] }>(
        "/api/predictions/catalog"
      ),
      authed
        ? requestJson<{
            myBets: Record<
              number,
              NonNullable<ClientPredictionQuestion["myBet"]>
            >;
          }>("/api/predictions/my-bets").catch(() => ({ myBets: {} }))
        : Promise.resolve({ myBets: {} }),
    ]);

    const myBetsMap = overlay.myBets as Record<
      number,
      NonNullable<ClientPredictionQuestion["myBet"]>
    >;
    const enriched = catalog.questions.map((q) => ({
      ...q,
      myBet: myBetsMap[q.id] ?? null,
    }));
    seedPredictionsSnapshot(enriched);
    return { questions: enriched };
  },

  placePredictionBet: (body: {
    questionId: number;
    selection: string;
    stake: number;
    expectedOdds?: number;
    oddsPolicy?: OddsLockPolicy;
    idempotencyKey?: string;
  }) =>
    requestJson<{ balance: number; potentialWin: number }>("/api/predictions", {
      method: "POST",
      body: {
        ...body,
        idempotencyKey: body.idempotencyKey ?? generateIdempotencyKey("prd"),
      },
    }),

  coupons: {
    save: (legs: unknown[], defaultStake: number) =>
      requestJson<{ code: string; legsCount: number }>("/api/coupons", {
        method: "POST",
        body: { legs, defaultStake },
      }),
    load: (code: string) =>
      requestJson<{
        code: string;
        defaultStake: number;
        legs: Array<{
          kind: "sport" | "prediction";
          matchId?: number;
          questionId?: number;
          title: string;
          league: string;
          homeTeam?: string;
          awayTeam?: string;
          homeLogo?: string | null;
          awayLogo?: string | null;
          market: string;
          selection: string;
          selectionLabel: string;
          odds: number;
          liveOdds: number;
          closed: boolean;
          startsAt?: string | null;
          isLive?: boolean;
        }>;
      }>(`/api/coupons?code=${encodeURIComponent(code.trim().toUpperCase())}`, {
        bypassEtag: true,
      }),
  },

  payments: {
    providers: () =>
      requestJson<{ providers: PaymentProviderInfo[] }>("/api/payments"),
    stripeCheckout: (amount: number, idempotencyKey?: string) =>
      requestJson<{
        mode: "live_redirect" | "simulated_instant";
        url?: string;
        depositId: number;
        balance?: number;
      }>("/api/payments/stripe", {
        method: "POST",
        body: {
          amount,
          idempotencyKey: idempotencyKey ?? generateIdempotencyKey("strp"),
        },
      }),
    paypalOrder: (amount: number, idempotencyKey?: string) =>
      requestJson<{
        mode: "live_redirect" | "simulated_instant";
        url?: string;
        orderId?: string;
        depositId: number;
        balance?: number;
      }>("/api/payments/paypal", {
        method: "POST",
        body: {
          amount,
          idempotencyKey: idempotencyKey ?? generateIdempotencyKey("ppal"),
        },
      }),
    manualRequest: (body: {
      provider: "mobile_money" | "sepa";
      amount: number;
      senderRef: string;
      phoneOrIban?: string;
      idempotencyKey?: string;
    }) =>
      requestJson<{ depositId: number; status: string; message: string }>(
        "/api/payments/manual",
        {
          method: "POST",
          body: {
            ...body,
            idempotencyKey: body.idempotencyKey ?? generateIdempotencyKey("mdep"),
          },
        }
      ),
  },

  wallet: async () => {
    const data = await requestJson<ClientWalletResponse>("/api/wallet");
    setCachedWalletSnapshot(data);
    return data;
  },

  withdrawals: {
    request: (body: {
      amount: number;
      method: "sepa" | "paypal" | "mobile_money";
      destination: string;
      accountHolder?: string;
      idempotencyKey?: string;
    }) =>
      requestJson<{
        withdrawal: { id: number; amount: number; status: string };
        balance: number;
      }>("/api/withdrawals", {
        method: "POST",
        body: {
          ...body,
          idempotencyKey: body.idempotencyKey ?? generateIdempotencyKey("wd"),
        },
      }),
    cancel: (withdrawalId: number) =>
      requestJson<{ ok: boolean; balance: number }>("/api/withdrawals", {
        method: "PATCH",
        body: { withdrawalId },
      }),
  },

  updateSettings: (
    patch: Partial<
      Pick<
        ClientUser,
        "name" | "oddsFormat" | "soundEnabled" | "hapticsEnabled" | "stakePresets"
      >
    >
  ) =>
    requestJson<{ user: ClientUser }>("/api/settings", {
      method: "PATCH",
      body: patch,
    }),

  tap: {
    state: () =>
      requestJson<{ status: string; balance: number }>("/api/tap", {
        bypassEtag: true,
      }),
    startGame: (bet: number) =>
      requestJson<{
        status: "success";
        multiplier: number;
        factor: number;
        new_balance: number;
      }>("/api/tap", {
        method: "POST",
        body: { action: "start_game", bet },
      }),
    tapBatch: (count: number) =>
      requestJson<{
        status: "ok" | "crashed" | "autocashout";
        multiplier: number;
        new_balance?: number;
        win_amount?: number;
      }>("/api/tap", {
        method: "POST",
        body: { action: "tap_batch", count },
      }),
    cashout: () =>
      requestJson<{
        status: "success";
        win_amount: number;
        new_balance: number;
      }>("/api/tap", {
        method: "POST",
        body: { action: "cashout" },
      }),
  },

  accelerator: {
    state: () =>
      requestJson<{
        status: "success";
        balance: number;
        min_display: number;
        max_display: number;
      }>("/api/accelerator", { bypassEtag: true }),
    startGame: (bet: number) =>
      requestJson<{
        status: "success";
        round_id: number;
        new_balance: number;
        multiplier: number;
        g_base: number;
        g_rate: number;
        m_max: number;
        seed_hash: string;
      }>("/api/accelerator", {
        method: "POST",
        body: { action: "start_game", bet },
      }),
    holdStart: () =>
      requestJson<{
        status: "ok" | "crashed";
        multiplier: number;
        round_id?: number;
      }>("/api/accelerator", {
        method: "POST",
        body: { action: "hold_start" },
      }),
    tickHold: (final = false) =>
      requestJson<{
        status: "ok" | "crashed" | "cashed";
        multiplier: number;
        new_balance?: number;
        win_amount?: number;
        round_id?: number;
      }>("/api/accelerator", {
        method: "POST",
        body: { action: final ? "tap_final" : "tap" },
      }),
    cashout: (clientMultiplier: number) =>
      requestJson<{
        status: "cashed" | "crashed";
        multiplier: number;
        new_balance?: number;
        win_amount?: number;
        round_id?: number;
        jackpot?: boolean;
      }>("/api/accelerator", {
        method: "POST",
        body: { action: "cashout", client_multiplier: clientMultiplier },
      }),
  },

  admin: {
    dashboard: () => requestJson<Record<string, unknown>>("/api/admin", { bypassEtag: true }),
    action: (body: Record<string, unknown>) =>
      requestJson<Record<string, unknown>>("/api/admin", {
        method: "POST",
        body,
      }),
  },
};
