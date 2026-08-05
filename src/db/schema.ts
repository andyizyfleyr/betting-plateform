import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Matchs de football.
 * status: "live" | "upcoming" | "finished"
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

export type MatchRow = typeof matches.$inferSelect;
export type BetRow = typeof bets.$inferSelect;
export type AppUserRow = typeof appUser.$inferSelect;
export type TapHistoryRow = typeof tapHistory.$inferSelect;
export type AcceleratorRoundRow = typeof acceleratorRounds.$inferSelect;
