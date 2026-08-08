import { chromium, type Browser, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { oddsFor } from "@/db/fixtures";

/**
 * Scraping Playwright des bookmakers (1xBet / bet365).
 *
 * Les deux sites sont « JS lourd » et anti-bot (Cloudflare/DataDome). Cette lib :
 * - lance Chromium en mode furtif (User-Agent, viewport, locale, flags) ;
 * - navigue vers l'URL des matchs (direct ou via `SCRAPE_URL`) ;
 * - récupère les lignes de matchs grâce aux sélecteurs configurables ;
 * - parse chaque ligne (équipes, cotes 1/N/2, score, minute, statut) ;
 * - écrit / met à jour la table `matches` (source = "scraped").
 *
 * ⚠️ Les bookmakers changent souvent leur DOM et bloquent les bots :
 * les sélecteurs par défaut sont des points de départ ; ils peuvent être
 * surchargés via les variables d'environnement `SCRAPE_*` ou l'option `selectors`.
 */

/** Ligne de match extraite d'une page. */
export interface ScrapedRow {
  homeTeam: string;
  awayTeam: string;
  league: string;
  homeScore: number | null;
  awayScore: number | null;
  minute: string | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  status: "upcoming" | "live" | "finished";
  startsAt: Date | null;
}

/** Sélecteurs DOM pour un site donné. */
export interface ScrapeSelectors {
  /** Élément racine d'une ligne de match (coupon). */
  row: string;
  /** Boutons de consentement/cookies à cliquer (facultatif). */
  accept?: string[];
}

/** Configuration d'une source. */
export interface ScrapeSiteConfig {
  id: string;
  label: string;
  /** URL par défaut (surchargée par SCRAPE_URI / option url). */
  url: string;
  sport: string;
  league: string;
  selectors: ScrapeSelectors;
}

export const SITES: Record<string, ScrapeSiteConfig> = {
  "1xbet": {
    id: "1xbet",
    label: "1xBet",
    url: "https://1xbet.com/fr/live/football/",
    sport: "football",
    league: "Direct · Football · 1xBet",
    selectors: {
      row: "div.dashboard-game-block__row, .c-events__item, .b1-pop",
      accept: ["button:has-text('Accepter')", "button:has-text('Accept')", "button:has-text('J\u2019accepte')", "#btn_cookie"],
    },
  },
  bet365: {
    id: "bet365",
    label: "bet365",
    url: "https://www.bet365.com/#/AC/B1/C1/D1/F1/",
    sport: "football",
    league: "Direct · Football · bet365",
    selectors: {
      row: "div[class*='ae-EventRow'], div[class*='sli-Market'], div[class*='ih-Item']",
      accept: ["button[aria-label*='Accept']", "#onetrust-accept-btn-handler", "button:has-text('Accept All')"],
    },
  },
};

/** Options d'un run de scraping. */
export interface ScrapeOptions {
  site?: string;
  /** URL personnalisée (outrepasse la config du site et SCRAPE_URI). */
  url?: string;
  league?: string;
  sport?: string;
  headless?: boolean;
  /** Limite max de lignes importées. */
  limit?: number;
  /** N'écrit pas en base. */
  dryRun?: boolean;
  timeoutMs?: number;
}

export interface ScrapeResult {
  site: string;
  url: string;
  startedAt: number;
  durationMs: number;
  found: number;
  rows: ScrapedRow[];
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
  /** URL réelle après redirections. */
  finalUrl?: string;
  /** Titre de la page (diagnostic anti-bot). */
  title?: string;
  /** True si une page de défi (Cloudflare/DataDome) a été détectée. */
  blocked?: boolean;
  /** Synthèse du texte de la page (diagnostic). */
  textSnippet?: string;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function inferStatus(
  minuteRaw: string | null,
  hasScore: boolean,
  forcedUpcoming = false,
): ScrapedRow["status"] {
  const m = (minuteRaw ?? "").toLowerCase();
  if (m.includes("ft") || m.includes("termin") || m.includes("full")) return "finished";
  if (forcedUpcoming) return "upcoming";
  if (/^\d+['’]?/.test(m) || hasScore) return "live";
  return "upcoming";
}

/** Mots-clés UI courants des footer/header (faux positifs à écarter). */
const UI_JUNK = new Set([
  // FR
  "régistration", "inscription", "connexion", "connexions", "sport", "sports", "live",
  "direct", "casino", "esports", "promo", "bingo", "toto", "résultats", "statistiques",
  "poker", "télévision", "jeux", "autres", "plus", "parier", "matches", "support",
  "copyright", "protégé", "tous droits réservés", "identifiant", "mot de passe", "partenaires",
  "matchs", "recommandé", "recommandé pour vous", "événements à venir", "événements", "directs",
  // EN
  "registration", "log in", "login", "sports", "esports", "promo", "bingo", "toto",
  "results", "statistics", "poker", "tv games", "other games", "more", "support",
  "copyright", "all rights reserved", "partners", "long-term bets",
]);

function isJunkName(name: string): boolean {
  const n = name.toLowerCase().trim();
  if (n.length < 2 || n.length > 45) return true;
  if (UI_JUNK.has(n)) return true;
  // Noms trop génériques, symboles, seul mot en majuscules d'une lettre, etc.
  if (/©|\[|\]|\{|\}|→|€|\$|\*|http/i.test(n)) return true;
  return false;
}

/** Parse le texte d'une ligne de coupon. Retourne null si ce n'est pas un match. */
export function parseRowText(raw: string): Partial<ScrapedRow> | null {
  if (!raw || !raw.trim()) return null;

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const scores: number[] = [];
  const odds: number[] = [];
  const names: string[] = [];
  let minuteRaw: string | null = null;
  let forcedUpcoming = false;

  for (const line of lines) {
    // Score : "2 - 1", "0-2", "1:1" (mais pas "21:00" qui est une heure).
    const scoreMatch = line.match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
    if (scoreMatch) {
      const a = parseInt(scoreMatch[1], 10);
      const b = parseInt(scoreMatch[2], 10);
      if (a <= 15 && b <= 15) {
        scores.push(a, b);
        continue;
      }
    }

    // Minute : "67'", "45+2'", "HT", "FT".
    if (/^\d{1,3}(\+\d{1,2})?['’]$/.test(line) || /^(HT|HT2|FT|ET)$/i.test(line)) {
      if (!minuteRaw) minuteRaw = line.replace("'", "'");
      continue;
    }

    // État « à venir » (1xBet FR) : "Début dans 10 minutes", "Dans 5 minutes"…
    if (/début dans|starts? in|starts? dans|commence|à venir|not started/i.test(line)) {
      forcedUpcoming = true;
      continue;
    }
    // Mi-temps / période (ligue FR) : "1ère mi-temps", "2ème mi-temps"…
    if (/1ère mi-temps|2e?(:me)? mi-temps|1st half|2nd half|half.?time|période/i.test(line)) {
      if (!minuteRaw) minuteRaw = "HT";
      continue;
    }

    const tokens = line.split(/\s+/);
    // Ligne « uniquement des nombres » : cotes (décimales) ou scores purs.
    if (tokens.every(isNumberToken)) {
      for (const t of tokens) {
        const n = parseFloat(t.replace(",", "."));
        if (n >= 1.01 && n <= 1000 && /[.,]/.test(t)) odds.push(round2(n));
      }
      continue;
    }

    if (line.startsWith("<") || line.startsWith("[") || line === "-") continue;
    names.push(line);
  }

  // Synchronisation de la minute si elle a été capturée avec apostrophe ailleurs.
  const minuteMatch = raw.match(/(\d{1,3})['’]/);
  if (!minuteRaw && minuteMatch) {
    const v = parseInt(minuteMatch[1], 10);
    if (v <= 130) minuteRaw = `${minuteMatch[1]}'`;
  }
  if (/termin|\bft\b|full.?time/i.test(raw)) minuteRaw = minuteRaw ?? "FT";

  if (names.length < 2) return null;
  const home = names[0].trim();
  const away = names[names.length - 1].trim();
  if (isJunkName(home) || isJunkName(away) || home === away) return null;

  const hasScore = scores.length >= 2;
  const status = inferStatus(minuteRaw, hasScore, forcedUpcoming);

  return {
    homeTeam: home,
    awayTeam: away,
    homeScore: hasScore ? scores[0] : null,
    awayScore: hasScore ? scores[1] : null,
    minute: minuteRaw,
    oddsHome: odds[0] ?? null,
    oddsDraw: odds[1] ?? null,
    oddsAway: odds[2] ?? null,
    status,
  };
}

/** Vrai si le jeton est un nombre pur, éventuellement décimal. */
function isNumberToken(t: string): boolean {
  return /^\d+([.,]\d{1,2})?$/.test(t);
}

/** Lance le navigateur en mode furtif. */
export async function launchBrowser(headless = true): Promise<Browser> {
  return chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
}

/** Prépare un contexte furtif (UA réaliste, locale FR, drapeaux anti-détection). */
export async function newStealthPage(browser: Browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "dark",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  return { page, context };
}

/** Ferme les bannières de cookies si elles apparaissent (meilleur effort). */
async function dismissCookies(page: Page, config: ScrapeSiteConfig) {
  for (const sel of config.selectors.accept ?? []) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click({ timeout: 1000 });
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      /* sélecteur absent — on passe au suivant */
    }
  }
}

/** Détecte une page de défi anti-bot (Cloudflare, DataDome, captcha). */
export function looksBlocked(pageTitle: string, bodyText: string): boolean {
  const hay = (pageTitle + " " + bodyText).slice(0, 4000).toLowerCase();
  return (
    /just a moment|attention required|verify you are human|cf-challenge|enable javascript and cookies to continue|access denied|blocked/i.test(hay)
  );
}

/**
 * Repli sans sélecteur : scanne tout le DOM pour trouver les « blocs match »,
 * c'est-à-dire les plus petits éléments contenant au moins 2 noms d'équipes
 * suivis de plusieurs nombres (score / minute / identifiants).
 * Indispensable car 1xBet change de classes d'un chargement à l'autre.
 */
async function scanMatchBlocks(page: Page): Promise<string[]> {
  const rows = await page.evaluate(() => {
    const out: string[] = [];
    const stack: Element[] = [document.body];
    // Parcours en profondeur : on garde le plus petit ancêtre qui ressemble à un match.
    while (stack.length) {
      const el = stack.pop();
      if (!el) continue;
      if (out.length >= 250) break;
      const t = (el as HTMLElement).innerText ?? "";
      if (!t.trim()) continue;
      const lines = t.split(/\n/).map((x) => x.trim()).filter(Boolean);
      if (lines.length < 4) continue;
      // « Nom d'équipe » = ligne sans chiffre, sans terme technique courant.
      const nameLines = lines.filter((l) => !/^\d|^\(|^http/i.test(l) && !/^[⏱|]/.test(l) && l.length >= 3);
      const digitLines = lines.filter((l) => /^\d+$/i.test(l));
      const looksMatch =
        nameLines.length >= 2 && digitLines.length >= 2 && lines.length <= 14;
      if (!looksMatch) continue;
      // Ignore les contenants trop grands (dashboard entier, colonnes larges).
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width > 1200 || rect.height > 600) continue;
      // Garde le bloc le plus petit : si un enfant est lui-même un bloc match,
      // l'ancêtre sera re-traversé ; on préfère les plus petits via longueur du texte.
      out.push(t);
    }
    // Tri par longueur croissante : les blocs « leaf » (les plus courts) d'abord,
    // puis déduplication sur les premières lignes d'équipes.
    out.sort((a, b) => a.length - b.length);
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const t of out) {
      const key = t.split(/\n/).filter((l) => !/^\d+$/i.test(l)).slice(0, 2).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(t);
    }
    return dedup.slice(0, 120);
  });
  return rows as unknown as string[];
}

/**
 * Reconstruit les « blocs match » à partir du bodyText de 1xBet.
 *
 * Le DOM 1xBet est une grille où chaque match s'affiche en lignes verticales :
 *   ligue → équipe 1 → équipe 2 → score(s) → minute / "Début dans X min".
 * On détecte : une paire de noms d'équipes suivie de chiffres (score),
 * puis on reconstitue un bloc multiligne que parseRowText saura lire.
 */
export function parseBodyText(bodyText: string): string[] {
  const lines = bodyText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];

  const isNumberOnly = (l: string) => /^\d+$/.test(l);
  const looksDigit = (l: string) => /^\d/.test(l);
  const looksTime = (l: string) => /^\d{1,2}:\d{2}/.test(l);
  const isLeagueLike = (l: string) => /(Ligue|Liga|League|Championnat|championnat|Première|Premier|División|Division|Bundesliga|Eredivisie|Serie|Ligue)/.test(l) || l.includes(". ");
  const isTeamLike = (l: string) =>
    !!l && l.length >= 3 && l.length <= 60 &&
    !looksDigit(l) && !looksTime(l) && !isJunkName(l) && !isLeagueLike(l);

  for (let i = 0; i < lines.length - 1; i++) {
    const home = lines[i];
    const away = lines[i + 1];
    if (!isTeamLike(home) || !isTeamLike(away)) continue;

    // Regarde ce qui suit : des chiffres (score) et/ou un état.
    let j = i + 2;
    const follow: string[] = [];
    let hasSignal = false;
    while (j < lines.length) {
      const t = lines[j];
      if (isNumberOnly(t) && t.length <= 3 && parseInt(t, 10) <= 130) {
        hasSignal = true;
        follow.push(t);
        j++;
        continue;
      }
      if (/début dans|starts? in|à venir|not started|commence/i.test(t)) {
        hasSignal = true;
        follow.push(t);
        j++;
        continue;
      }
      break;
    }
    if (!hasSignal) continue;

    const bloc = [home, away, ...follow];
    out.push(bloc.join("\n"));
    i = j; // passe à la séquence suivante
  }
  return out;
}

/** Récupère le texte brut des lignes détectées sur la page. */
async function collectRows(page: Page, config: ScrapeSiteConfig, timeoutMs: number): Promise<string[]> {
  const rowSel = config.selectors.row;

  // Laisse mûrir le chargement (JS lourd + lazy loading des matchs).
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  // Défile jusqu'au bas pour déclencher le chargement infini, puis remonte.
  await page.evaluate(async () => {
    const step = 400;
    const total = 12;
    for (let i = 0; i < total; i++) {
      window.scrollBy(0, step);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });

  const text = await page.evaluate((sel) => {
    const nodes = Array.from(document.querySelectorAll(sel));
    const rows = nodes
      .slice(0, 200)
      .map((el) => (el as HTMLElement).innerText ?? "")
      .filter((t) => t && t.trim());
    return rows;
  }, rowSel);

const bodyText = await page.evaluate(() => document.body?.innerText ?? "");

  // 1xBet : le bodyText expose chaque match sur des lignes propres.
  if (config.id === "1xbet") {
    const fromBody = parseBodyText(bodyText);
    if (fromBody.length > 0) return fromBody;
  }

  if (text.length > 0) return text;

  // Repli : classes volatiles → scan structurel du DOM.
  const scanned = await scanMatchBlocks(page);
  if (scanned.length > 0) return scanned;

  // Dernier recours : texte global découpé par lignes vides.
  if (bodyText.trim().length < 40) return [];
  return bodyText.split(/\n{2,}/).slice(0, 200);
}

/** Applique config, URL et flag headless depuis l'environnement. */
export function resolveSiteConfig(opts: ScrapeOptions): ScrapeSiteConfig {
  const base = SITES[opts.site?.toLowerCase() ?? ""] ?? SITES.bet365;
  return {
    ...base,
    url: opts.url ?? process.env.SCRAPE_URI ?? base.url,
    league: opts.league ?? process.env.SCRAPE_LEAGUE ?? base.league,
    sport: opts.sport ?? base.sport,
  };
}

/** Exécute un parcours de scraping complet et le synchronise en base. */
export async function runScrape(opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const config = resolveSiteConfig(opts);
  const startedAt = Date.now();
  const headless = opts.headless ?? (process.env.SCRAPE_HEADLESS !== "false");
  const timeoutMs = opts.timeoutMs ?? 45_000;

  const result: ScrapeResult = {
    site: config.id,
    url: opts.url ?? config.url,
    startedAt,
    durationMs: 0,
    found: 0,
    rows: [],
    inserted: 0,
    updated: 0,
    skipped: 0,
  };

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(headless);
    const { page, context } = await newStealthPage(browser);

    // Diagnostic : URL réelle + titre après redirections.
    result.finalUrl = page.url();
    result.title = await page.title().catch(() => "");

    try {
      await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await dismissCookies(page, config);
      result.finalUrl = page.url();
      result.title = await page.title().catch(() => "");
    } catch (e) {
      result.error = `Navigation échouée : ${e instanceof Error ? e.message : String(e)}`;
      result.durationMs = Date.now() - startedAt;
      await context.close();
      return result;
    }

    const rawTexts = await collectRows(page, config, timeoutMs);

    // Détection d'une page bloquée / défi.
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    result.textSnippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 300);
    result.blocked = looksBlocked(result.title ?? "", bodyText);

    const parsed = rawTexts
      .map(parseRowText)
      .filter((r): r is Partial<ScrapedRow> => !!r && !!(r.homeTeam && r.awayTeam));

    /** Score de richesse d'une ligne (plus il y a de champs, mieux c'est). */
    const richness = (r: Partial<ScrapedRow>) =>
      (r.homeScore != null ? 1 : 0) +
      (r.minute ? 1 : 0) +
      (r.oddsHome ? 1 : 0) +
      (r.oddsDraw ? 1 : 0) +
      (r.oddsAway ? 1 : 0);

    /** Priorité de statut : live > finished > upcoming. */
    const statusPriority = (s?: string) => (s === "live" ? 2 : s === "finished" ? 1 : 0);

    // Déduplication : une affiche peut être capturée par plusieurs sélecteurs
    // imbriqués (conteneur + enfants). On conserve la ligne la plus complète
    // par paire d'équipes, en favorisant le statut le plus avancé.
    const byKey = new Map<string, Partial<ScrapedRow>>();
    for (const r of parsed) {
      const key = `${r.homeTeam}|${r.awayTeam}`;
      const current = byKey.get(key);
      const better =
        !current ||
        statusPriority(r.status) > statusPriority(current.status) ||
        (statusPriority(r.status) === statusPriority(current.status) &&
          richness(r as Partial<ScrapedRow>) > richness(current));
      if (better) byKey.set(key, r);
    }

    const rows: ScrapedRow[] = Array.from(byKey.values()).slice(0, opts.limit ?? 40).map((r) => {
      const home = r.homeTeam!;
      const away = r.awayTeam!;
      // Cotes manquantes ? On retombe sur le modèle Poisson (fixtures) comme dégradé.
      const fallback = oddsFor(home, away);
      return {
        homeTeam: home,
        awayTeam: away,
        league: r.league ?? config.league,
        homeScore: r.homeScore ?? null,
        awayScore: r.awayScore ?? null,
        minute: r.minute ?? null,
        oddsHome: r.oddsHome ?? fallback.oddsHome,
        oddsDraw: r.oddsDraw ?? fallback.oddsDraw,
        oddsAway: r.oddsAway ?? fallback.oddsAway,
        status: r.status ?? (r.homeScore != null ? "live" : "upcoming"),
        startsAt: r.startsAt ?? null,
      };
    });

    result.found = rawTexts.length;
    result.rows = rows;

    if (!opts.dryRun && rows.length > 0) {
      const sync = await syncScrapedRows(rows, config);
      result.inserted = sync.inserted;
      result.updated = sync.updated;
      result.skipped = sync.skipped;
    }

    await context.close();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

export interface SyncStats {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Upsert des matchs scrapés dans la table `matches`.
 * Règle : on ne replie que sur des lignes `source = "scraped"` pour ne jamais
 * écraser les matchs du moteur virtuel (`source = "virtual"`). Un match scrapé
 * vivant est retrouvé par paires d'équipes et de statut (live/finished).
 */
export async function syncScrapedRows(rows: ScrapedRow[], config: ScrapeSiteConfig): Promise<SyncStats> {
  const stats: SyncStats = { inserted: 0, updated: 0, skipped: 0 };

  for (const row of rows) {
    if (!row.homeTeam || !row.awayTeam) {
      stats.skipped++;
      continue;
    }

    const scrapedAll = await db.select().from(matches).where(eq(matches.source, "scraped"));
    // Correspondance par paire d'équipes + même statut, ou transition live → finished.
    const existing = scrapedAll.find(
      (m) =>
        m.homeTeam === row.homeTeam &&
        m.awayTeam === row.awayTeam &&
        (m.status === row.status || (row.status === "finished" && m.status === "live"))
    );

    const values = {
      sport: config.sport,
      league: row.league || config.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      status: row.status,
      minute: row.status === "finished" ? "Terminé" : row.minute,
      startsAt: row.startsAt ?? new Date(),
      oddsHome: row.oddsHome ?? 1.01,
      oddsDraw: row.oddsDraw ?? null,
      oddsAway: row.oddsAway ?? 1.01,
      suspended: false,
      lastGoalAt: null,
      finishedAt: row.status === "finished" ? new Date() : null,
      redHome: 0,
      redAway: 0,
      events: [],
      tickHistory: [],
      regime: "balanced",
      homeForm: 1,
      awayForm: 1,
      asianHandicapLine: null,
      source: "scraped",
    };

    if (existing) {
      await db.update(matches).set(values).where(eq(matches.id, existing.id));
      stats.updated++;
    } else {
      await db.insert(matches).values(values);
      stats.inserted++;
    }
  }

  return stats;
}

/** Vrai si au moins une ligne scrapée est encore en cours (live/upcoming). */
export async function hasActiveScraped(): Promise<boolean> {
  const rows = await db.select({ status: matches.status }).from(matches).where(eq(matches.source, "scraped"));
  return rows.some((r) => r.status !== "finished");
}

/** Délai minimal entre deux scrapings automatiques (évite de marteler 1xBet). */
export const AUTO_SCRAPE_INTERVAL_MS = 3 * 60_000;

let lastAutoScrapeAt = 0;
let autoScrapeInFlight = false;

/**
 * Déclenche le scraping automatiquement (sans `npm run scrape`).
 * Fire-and-forget : ne bloque jamais la requête appelante. Throttlé :
 * au plus un run toutes les AUTO_SCRAPE_INTERVAL_MS, et jamais deux en parallèle.
 */
export function ensureAutoScrape(): void {
  if (autoScrapeInFlight) return;
  if (Date.now() - lastAutoScrapeAt < AUTO_SCRAPE_INTERVAL_MS) return;

  autoScrapeInFlight = true;
  void (async () => {
    try {
      await runScrape({ site: "1xbet", dryRun: false });
    } catch {
      /* silencieux : le prochain tick retentera */
    } finally {
      autoScrapeInFlight = false;
      lastAutoScrapeAt = Date.now();
    }
  })();
}