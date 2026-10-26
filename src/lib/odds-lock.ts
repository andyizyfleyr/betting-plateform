/**
 * Verrouillage transactionnel des cotes (partagé entre client et serveur, 0 dépendance Node/DB).
 *
 * Règles de sécurité bookmaker :
 *  1. Le serveur ne fait JAMAIS confiance à `expectedOdds` pour calculer un gain (`potentialWin`) :
 *     `expectedOdds` sert exclusivement à détecter qu'une cote affichée au joueur a bougé.
 *  2. Comparaison en centièmes entiers (`Math.round(odds * 100)`) avec tolérance stricte de `0,01`
 *     (`1` centième) afin d'éliminer 100 % des faux `409` liés aux flottants IEEE-754.
 *  3. Toute baisse (`< -0,01`) exige systématiquement la confirmation du joueur (`409 ODDS_CHANGED`).
 *  4. Toute hausse (`> +0,01`) exige également la confirmation par défaut (`confirm_all`), sauf si
 *     le joueur a activé l'option « Accepter automatiquement les hausses de cotes » (`accept_higher`).
 */

export type OddsChangePolicy = "confirm_all" | "accept_higher";

export const ODDS_CHANGED_CODE = "ODDS_CHANGED" as const;
export const CASHOUT_CHANGED_CODE = "CASHOUT_CHANGED" as const;
export const IDEMPOTENCY_CONFLICT_CODE = "IDEMPOTENCY_KEY_CONFLICT" as const;

/** Tolérance de 1 centième (0,01) sur cotes arrondies à 2 décimales des deux côtés. */
export const ODDS_LOCK_TOLERANCE_CENTS = 1;

const ODDS_POLICY_STORAGE_KEY = "pulse_odds_change_policy_v1";
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{12,128}$/;

/**
 * Génère une clé d'idempotence unique côté navigateur avec préfixe typé (`bet`, `co`, `wd`, `dep`).
 */
export function generateIdempotencyKey(prefix = "idem"): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "idem";
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${safePrefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  const rand = Math.random().toString(36).slice(2, 12);
  const rand2 = Math.random().toString(36).slice(2, 12);
  return `${safePrefix}_${Date.now().toString(36)}_${rand}${rand2}`;
}

/**
 * Génère une clé d'idempotence unique côté navigateur pour chaque intention de pari.
 * Protège contre les doubles clics rapides et les réessais réseau automatiques.
 */
export function generateBetIdempotencyKey(): string {
  return generateIdempotencyKey("bet");
}

export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return IDEMPOTENCY_KEY_RE.test(trimmed) ? trimmed : null;
}

/**
 * Extrait la clé d'idempotence soit du corps JSON (`body.idempotencyKey`),
 * soit de l'en-tête HTTP standard `Idempotency-Key`.
 */
export function extractIdempotencyKey(
  bodyKey: unknown,
  headerKey?: string | null
): string | null {
  return normalizeIdempotencyKey(bodyKey) ?? normalizeIdempotencyKey(headerKey);
}

export function roundOdds2(odds: number): number {
  return Math.round(odds * 100) / 100;
}

export function normalizeOddsPolicy(raw: unknown): OddsChangePolicy {
  return raw === "accept_higher" ? "accept_higher" : "confirm_all";
}

export type OddsCheckResult =
  | {
      ok: true;
      roundedServerOdds: number;
    }
  | {
      ok: false;
      roundedExpectedOdds: number;
      roundedServerOdds: number;
      direction: "up" | "down";
    };

export function checkOddsChange(params: {
  expectedOdds: number;
  serverOdds: number;
  policy?: OddsChangePolicy;
}): OddsCheckResult {
  const expectedCents = Math.round(params.expectedOdds * 100);
  const serverCents = Math.round(params.serverOdds * 100);
  const roundedExpectedOdds = expectedCents / 100;
  const roundedServerOdds = serverCents / 100;
  const diffCents = serverCents - expectedCents;

  if (Math.abs(diffCents) <= ODDS_LOCK_TOLERANCE_CENTS) {
    return { ok: true, roundedServerOdds };
  }

  const direction: "up" | "down" = diffCents > 0 ? "up" : "down";
  if (direction === "up" && params.policy === "accept_higher") {
    return { ok: true, roundedServerOdds };
  }

  return {
    ok: false,
    roundedExpectedOdds,
    roundedServerOdds,
    direction,
  };
}

export interface OddsChangedLegDetail {
  kind: "sport" | "prediction";
  matchId?: number;
  questionId?: number;
  market: string;
  selection: string;
  previousOdds: number;
  currentOdds: number;
  direction: "up" | "down";
}

export interface OddsChangedDetails {
  previousOdds: number;
  currentOdds: number;
  direction: "up" | "down";
  updatedLegs?: OddsChangedLegDetail[];
}

export interface CashoutChangedDetails {
  previousCashout: number;
  currentCashout: number;
}

export type CashoutCheckResult =
  | {
      ok: true;
      roundedServerCashout: number;
    }
  | {
      ok: false;
      previousCashout: number;
      currentCashout: number;
    };

/**
 * Vérifie dans la transaction SQL que le montant réel de Cash Out calculé par le serveur
 * n'a pas baissé par rapport au montant affiché au joueur (`expectedCashout`).
 * Comparaison exacte en centimes entiers (`Math.round(x * 100)`) :
 *  - Si `serverCents < expectedCents` -> refus `409 CASHOUT_CHANGED` sans aucun paiement.
 *  - Si `serverCents >= expectedCents` -> accepté au montant serveur autoritaire.
 */
export function checkCashoutChange(params: {
  expectedCashout: number;
  serverCashout: number;
}): CashoutCheckResult {
  const expectedCents = Math.round(params.expectedCashout * 100);
  const serverCents = Math.round(params.serverCashout * 100);
  const previousCashout = expectedCents / 100;
  const currentCashout = serverCents / 100;

  if (serverCents < expectedCents) {
    return {
      ok: false,
      previousCashout,
      currentCashout,
    };
  }

  return {
    ok: true,
    roundedServerCashout: currentCashout,
  };
}

export function readStoredOddsPolicy(): OddsChangePolicy {
  if (typeof window === "undefined") return "confirm_all";
  try {
    const val = window.localStorage.getItem(ODDS_POLICY_STORAGE_KEY);
    return normalizeOddsPolicy(val);
  } catch {
    return "confirm_all";
  }
}

export function writeStoredOddsPolicy(policy: OddsChangePolicy): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ODDS_POLICY_STORAGE_KEY, policy);
  } catch {
    /* silencieux en navigation privée */
  }
}

/**
 * Formate l'âge réel d'un flux public à partir du `serverTime` renvoyé par le serveur/CDN.
 * Compense un léger décalage d'horloge client en bornant l'âge minimal à 0 s.
 */
export function formatFeedAge(
  serverTimeIso: string | null | undefined,
  nowMs: number
): { label: string; ageSeconds: number; isStale: boolean } | null {
  if (!serverTimeIso) return null;
  const parsed = Date.parse(serverTimeIso);
  if (!Number.isFinite(parsed)) return null;
  const ageSeconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  const isStale = ageSeconds >= 12;
  const label =
    ageSeconds <= 1
      ? "Cotes mises à jour à l'instant"
      : ageSeconds < 60
        ? `Cotes mises à jour il y a ${ageSeconds} s`
        : `Cotes mises à jour il y a ${Math.floor(ageSeconds / 60)} min`;
  return { label, ageSeconds, isStale };
}
