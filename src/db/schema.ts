import {
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
});

/**
 * Paris placés par l'utilisateur.
 * status: "pending" | "won" | "lost" | "cashed"
 */
export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").references(() => matches.id),
  sport: text("sport").notNull(),
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  selection: text("selection").notNull(), // "home" | "draw" | "away"
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

export type MatchRow = typeof matches.$inferSelect;
export type BetRow = typeof bets.$inferSelect;
export type AppUserRow = typeof appUser.$inferSelect;
export type TapHistoryRow = typeof tapHistory.$inferSelect;
