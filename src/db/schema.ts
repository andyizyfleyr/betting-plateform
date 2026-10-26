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

/** Statistiques officielles d'un match réel récupérées gratuitement depuis le flux sportif public. */
export interface RealMatchStats {
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
  /** Journal d'événements : [{type:"goal","team":"home","minute":23,"player":"O. Dembélé"},…]. */
  events: jsonb("events").$type<Array<{ type: string; team: string; minute: number; player?: string }>>().default([]),
  /** Historique des mouvements de cote : [{minute,market,selection,from,to}] */
  tickHistory: jsonb("tick_history").$type<Array<{ minute: number; market: string; selection: string; from: number; to: number }>>().default([]),
  /** Régime de match : "open" (match ouvert), "closed" (match fermé), "balanced". */
  regime: text("regime").notNull().default("balanced"),
  /** Facteur de forme EWMA : 1 = neutre, >1 équipe en forme, <1 en difficulté. */
  homeForm: doublePrecision("home_form").notNull().default(1),
  awayForm: doublePrecision("away_form").notNull().default(1),
  /** Ligne de handicap asiatique courante (null = pas de handicap). */
  asianHandicapLine: doublePrecision("asian_handicap_line"),
  /** Logo du club à domicile (URL d'image, optionnel). */
  homeLogo: text("home_logo"),
  /** Logo du club à l'extérieur (URL d'image, optionnel). */
  awayLogo: text("away_logo"),
  /**
   * Marchés personnalisés (source = "manual") saisis par l'admin :
   * cotes libres sur des marchés existants. Si présent, ce tableau est
   * servi tel quel au client — sinon on construit les marchés au Poisson.
   */
  markets: jsonb("markets").$type<
    Array<{
      key: string;
      label: string;
      short: string;
      outcomes: Array<{ key: string; label: string; short: string; odds: number }>;
      rows?: Array<{ label: string; outcomes: Array<{ key: string; label: string; short: string; odds: number }> }>;
    }>
  >(),
  /** Marqueur du moteur virtuel : seules les lignes "virtual" sont affichées. */
  source: text("source").notNull().default("virtual"),
  /** Verrouillage individuel du scénario final (Mode 1 verrouillé ou score forcé par l'admin). */
  scenarioLocked: boolean("scenario_locked").notNull().default(false),
  /** Nonce incrémenté lorsque l'admin relance un tirage de scénario avant/pendant le match. */
  scenarioNonce: integer("scenario_nonce").notNull().default(0),
  /** Chronologie pré-calculée ou forcée (buts & cartons rouges minute par minute, strictement serveur). */
  scriptedEvents: jsonb("scripted_events").$type<
    Array<{ type: string; team: string; minute: number; player?: string }>
  >(),
  /** Identifiant officiel externe du match réel (ex. événement ESPN public sans clé API). */
  externalId: text("external_id"),
  /** Code ligue externe officiel (ex. "uefa.champions", "eng.1", "fra.1"). */
  externalLeague: text("external_league"),
  /** Active la synchronisation automatique du direct, des stats et du score final sur un match réel. */
  autoSync: boolean("auto_sync").notNull().default(true),
  /** Score officiel à la mi-temps (lorsqu'il est connu / remonté par le flux réel). */
  htHomeScore: integer("ht_home_score"),
  htAwayScore: integer("ht_away_score"),
  /** Vraies statistiques officielles du match réel (possession, tirs, corners, fautes, arrêts…). */
  realStats: jsonb("real_stats").$type<RealMatchStats | null>(),
  /** Horodatage de la dernière synchronisation réussie depuis le flux sportif public. */
  feedSyncedAt: timestamp("feed_synced_at", { mode: "date" }),
  /** Premier horodatage où la fin officielle du match a été détectée (fenêtre anti-VAR). */
  feedFinishedAt: timestamp("feed_finished_at", { mode: "date" }),
  /** Note d'état du flux officiel affichée dans l'administration. */
  feedStatusNote: text("feed_status_note"),
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
  /** Cote de clôture du marché au moment du règlement (CLV tracking). */
  closingOdds: doublePrecision("closing_odds"),
  /** Flag risque (latence admin-clic, marché quasi décidé…) pour revue manuelle. */
  riskFlag: text("risk_flag"),
  /** Clé d'idempotence client unique par joueur (empêche tout double débit sur double clic / retry réseau). */
  idempotencyKey: text("idempotency_key"),
  placedAt: timestamp("placed_at", { mode: "date" }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { mode: "date" }),
});

export interface PredictionOption {
  key: string;
  label: string;
  odds: number;
}

/**
 * Questions de prédiction (marchés Oui/Non ou Choix multiples à cotes fixes).
 * status: "open" | "resolved"
 * resolution: "yes" | "no" | clé d'option gagnante | null (null tant que non résolue)
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
  /** Options pour les questions à choix multiples (null = question binaire Oui/Non). */
  options: jsonb("options").$type<PredictionOption[] | null>(),
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
  cashOutAmount: doublePrecision("cash_out_amount"),
  idempotencyKey: text("idempotency_key"),
  placedAt: timestamp("placed_at", { mode: "date" }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { mode: "date" }),
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
  /** Rôle du compte : "user" (joueur) ou "admin" (espace d'administration). */
  role: text("role").notNull().default("user"),
  /** Montant de bonus initial soumis à exigence de mise (wager 1× à cote ≥ 1,30) avant retrait. */
  bonusLocked: doublePrecision("bonus_locked").notNull().default(0),
  /** Version du jeton JWT : incrémentée à la déconnexion pour invalider les anciens cookies partout. */
  tokenVersion: integer("token_version").notNull().default(0),
  /** Authentification JWT. `email` est unique ; `passwordHash` = scrypt. */
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
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

export interface ComboLeg {
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
}

/**
 * Paris combinés (2 à 8 sélections : matchs sportifs et/ou questions de prédiction).
 * status: "pending" | "won" | "lost" | "cashed"
 */
export const comboBets = pgTable("combo_bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  legs: jsonb("legs").$type<ComboLeg[]>().notNull(),
  baseOdds: doublePrecision("base_odds").notNull(),
  boostPct: doublePrecision("boost_pct").notNull().default(0),
  totalOdds: doublePrecision("total_odds").notNull(),
  stake: doublePrecision("stake").notNull(),
  potentialWin: doublePrecision("potential_win").notNull(),
  status: text("status").notNull().default("pending"),
  cashOutAmount: doublePrecision("cash_out_amount"),
  idempotencyKey: text("idempotency_key"),
  placedAt: timestamp("placed_at", { mode: "date" }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { mode: "date" }),
});

/**
 * Demandes de retrait effectuées par les joueurs.
 * status: "pending" | "approved" | "rejected" | "cancelled"
 */
export const withdrawals = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().default(1),
  method: text("method").notNull(), // "iban" | "paypal" | "card"
  destination: text("destination").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { mode: "date" }),
});

/**
 * Journal des ajustements manuels de solde par l'administration (traçabilité portefeuille).
 */
export const walletAdjustments = pgTable("wallet_adjustments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: doublePrecision("amount").notNull(), // positif = crédit, négatif = débit
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Persistance des modèles de Machine Learning auto-apprenants :
 * - "sharp_detector"    : Régression logistique en ligne + Z-score ajusté de la chance
 * - "market_calibrator" : Calibration bayésienne empirique & auto-correction de marge par segment
 * - "glicko_clubs"      : Forces dynamiques Attaque / Défense / Volatilité (Glicko-2 Poisson)
 * - "recommender_meta"  : Statistiques globales d'affinité & popularité pour la recommandation IA
 */
export const mlModels = pgTable("ml_models", {
  modelKey: text("model_key").primaryKey(),
  version: integer("version").notNull().default(1),
  samplesCount: integer("samples_count").notNull().default(0),
  brierScore: doublePrecision("brier_score").notNull().default(0.21),
  logLoss: doublePrecision("log_loss").notNull().default(0.61),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Paramètres globaux d'administration (ex. mode des scénarios de matchs : "dynamic" | "locked").
 */
export const adminSettings = pgTable("admin_settings", {
  settingKey: text("setting_key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Codes courts de partage de coupons (« Enregistrer / Charger le coupon » type 1xBet, ex. BX-84K2).
 */
export interface SavedCouponLegRecord {
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

export const savedCoupons = pgTable("saved_coupons", {
  code: text("code").primaryKey(),
  legs: jsonb("legs").$type<SavedCouponLegRecord[]>().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export type MatchRow = typeof matches.$inferSelect;
export type BetRow = typeof bets.$inferSelect;
export type PredictionQuestionRow = typeof predictionQuestions.$inferSelect;
export type PredictionBetRow = typeof predictionBets.$inferSelect;
export type ComboBetRow = typeof comboBets.$inferSelect;
export type WithdrawalRow = typeof withdrawals.$inferSelect;
export type WalletAdjustmentRow = typeof walletAdjustments.$inferSelect;
export type MlModelRow = typeof mlModels.$inferSelect;
export type AppUserRow = typeof appUser.$inferSelect;
export type DepositRow = typeof deposits.$inferSelect;
export type TapHistoryRow = typeof tapHistory.$inferSelect;
export type AcceleratorRoundRow = typeof acceleratorRounds.$inferSelect;
