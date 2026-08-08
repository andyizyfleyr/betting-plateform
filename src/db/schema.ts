import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Matchs de football.
 * status: "live" | "upcoming" | "finished"
 * regime: "open" | "closed" | "balanced" — ouverture du match (effet de terrain, pression).
 */
export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  status: text("status").notNull().default("upcoming"),
  minute: text("minute"),
  startsAt: timestamp("starts_at", { mode: "date" }).notNull(),
  oddsHome: doublePrecision("odds_home").notNull(),
  oddsDraw: doublePrecision("odds_draw"),
  oddsAway: doublePrecision("odds_away").notNull(),
  suspended: boolean("suspended").notNull().default(false),
  /** Horodatage réel du dernier but : blocage du marché 3 s après un but. */
  lastGoalAt: timestamp("last_goal_at", { mode: "date" }),
  /** Horodatage de fin du match (pour le nettoyage). */
  finishedAt: timestamp("finished_at", { mode: "date" }),
  /** Cartons rouges reçus (0 ou 1 par équipe en pratique). */
  redHome: integer("red_home").notNull().default(0),
  redAway: integer("red_away").notNull().default(0),
  /** Journal d'événements : [{type:"goal","team":"home","minute":23},…]. */
  events: jsonb("events").$type<Array<{ type: string; team: string; minute: number }>>().default([]),
  /** Historique des mouvements de cote : [{minute,market,selection,from,to}] */
  tickHistory: jsonb("tick_history").$type<Array<{ minute: number; market: string; selection: string; from: number; to: number }>>().default([]),
  /** Régime de match : "open" (match ouvert), "closed" (match fermé), "balanced". */
  regime: text("regime").notNull().default("balanced"),
  /** Facteur de forme EWMA : 1 = neutre, >1 équipe en forme, <1 en difficulté. */
  homeForm: doublePrecision("home_form").notNull().default(1),
  awayForm: doublePrecision("away_form").notNull().default(1),
  /** Ligne de handicap asiatique courante (null = pas de handicap). */
  asianHandicapLine: doublePrecision("asian_handicap_line"),
  /** Marqueur du moteur virtuel : seules les lignes "virtual" sont affichées. */
  source: text("source").notNull().default("virtual"),
});

/**
 * Paris placés par l'utilisateur.
 * status: "pending" | "won" | "lost" | "cashed"
 */
export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  matchId: integer("match_id").references(() => matches.id),
  sport: text("sport").notNull(),
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  market: text("market").notNull().default("result"), // clé du marché (résultat, O/U, BTTS, …)
  selection: text("selection").notNull(), // "home" | "draw" | "away" | clé d'issue du marché
  selectionLabel: text("selection_label").notNull(),
  odds: doublePrecision("odds").notNull(),
  stake: doublePrecision("stake").notNull(),
  potentialWin: doublePrecision("potential_win").notNull(),
  status: text("status").notNull().default("pending"),
  cashOutAmount: doublePrecision("cash_out_amount"),
  /** Multiplicateur de payout pour handicap asiatique (1 = gain, 0.5 = demi-gain, 0 = perte, push = 0 + remboursement). */
  payoutMultiplier: doublePrecision("payout_multiplier").notNull().default(1),
  /** Mise remboursée sur push (handicap asiatique quarter-ball). */
  stakeReturned: doublePrecision("stake_returned").notNull().default(0),
  placedAt: timestamp("placed_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Questions de prédiction (marchés Oui/Non, style Kalshi/Polymarket).
 * status: "open" | "resolved"
 * resolution: "yes" | "no" | null (null tant que non résolue)
 * seedValue: graine déterministe utilisée à la résolution (jamais exposée au client).
 */
export const predictionQuestions = pgTable("prediction_questions", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  seedValue: integer("seed_value").notNull().default(0),
  oddsYes: doublePrecision("odds_yes").notNull(),
  oddsNo: doublePrecision("odds_no").notNull(),
  volume: doublePrecision("volume").notNull().default(0),
  yesCount: integer("yes_count").notNull().default(0),
  noCount: integer("no_count").notNull().default(0),
  resolvesAt: timestamp("resolves_at", { mode: "date" }).notNull(),
  resolvedAt: timestamp("resolved_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Paris placés sur les questions de prédiction.
 * status: "pending" | "won" | "lost"
 */
export const predictionBets = pgTable("prediction_bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  questionId: integer("question_id")
    .notNull()
    .references(() => predictionQuestions.id),
  selection: text("selection").notNull(), // "yes" | "no"
  selectionLabel: text("selection_label").notNull(), // "Oui" | "Non"
  /** Instantané de la question (texte + catégorie) à la prise du pari. */
  question: text("question").notNull(),
  category: text("category").notNull(),
  odds: doublePrecision("odds").notNull(),
  stake: doublePrecision("stake").notNull(),
  potentialWin: doublePrecision("potential_win").notNull(),
  status: text("status").notNull().default("pending"),
  placedAt: timestamp("placed_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Profil + préférences utilisateur (une seule ligne, id = 1).
 */
export const appUser = pgTable("app_user", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Alex Martin"),
  balance: doublePrecision("balance").notNull().default(250),
  notifications: boolean("notifications").notNull().default(true),
  sound: boolean("sound").notNull().default(false),
  haptics: boolean("haptics").notNull().default(true),
  oddsFormat: text("odds_format").notNull().default("decimal"), // "decimal" | "fractional"
  language: text("language").notNull().default("fr"),
  liveSim: boolean("live_sim").notNull().default(true), // moteur de matchs en direct
  /** Authentification JWT. `email` est unique ; `passwordHash` = scrypt. */
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/** État du moteur de simulation live (une seule ligne, id = 1). */
export const simState = pgTable("sim_state", {
  id: serial("id").primaryKey(),
  lastTick: timestamp("last_tick", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Historique des parties du jeu Tap Win (profil joueur + santé du système).
 */
export const tapHistory = pgTable("tap_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  betAmount: doublePrecision("bet_amount").notNull(),
  targetMultiplier: doublePrecision("target_multiplier").notNull(),
  crashMultiplier: doublePrecision("crash_multiplier").notNull(),
  win: boolean("win").notNull(),
  balanceAfter: doublePrecision("balance_after").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Manches du jeu Accelerator Pro.
 * status: "active" | "autocashed" | "cashed" | "crashed" | "postcrashed"
 */
export const acceleratorRounds = pgTable("accelerator_rounds", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  betAmount: doublePrecision("bet_amount").notNull(),
  gBase: doublePrecision("g_base").notNull(),
  mMax: doublePrecision("m_max").notNull().default(2.0),
  autoTarget: doublePrecision("auto_target"),
  startedAt: timestamp("started_at", { mode: "date" }).notNull(),
  lastMs: bigint("last_ms", { mode: "number" }).notNull(),
  currentMultiplier: doublePrecision("current_multiplier").notNull().default(1.01),
  crashPoint: doublePrecision("crash_point").notNull(),
  cashoutMultiplier: doublePrecision("cashout_multiplier"),
  status: text("status").notNull().default("active"),
  serverSeed: text("server_seed"),
  seedHash: text("seed_hash"),
  endedAt: timestamp("ended_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Dépôts (rechargements) effectués via un prestataire : Stripe ou PayPal.
 * status: "pending" | "paid" | "credited" | "failed" | "expired"
 * providerRef = session Stripe (cs_...) ou PayPal order id (8-...).
 * Le crédit du solde est idempotent (status "credited" pivoté une seule fois).
 */
export const deposits = pgTable("deposits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  provider: text("provider").notNull(), // "stripe" | "paypal"
  providerRef: text("provider_ref").notNull(),
  amount: doublePrecision("amount").notNull(),
  currency: text("currency").notNull().default("EUR"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export type MatchRow = typeof matches.$inferSelect;
export type BetRow = typeof bets.$inferSelect;
export type PredictionQuestionRow = typeof predictionQuestions.$inferSelect;
export type PredictionBetRow = typeof predictionBets.$inferSelect;
export type AppUserRow = typeof appUser.$inferSelect;
export type DepositRow = typeof deposits.$inferSelect;
export type TapHistoryRow = typeof tapHistory.$inferSelect;
export type AcceleratorRoundRow = typeof acceleratorRounds.$inferSelect;
