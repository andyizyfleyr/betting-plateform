/**
 * Déduplication canonique, réconciliation avec le score officiel et formatage
 * des faits de match (`goal`, `red` / `red_card`).
 *
 * Module pur sans dépendance serveur/DB afin d'être partagé entre :
 * - le parseur du flux sportif réel (`src/lib/real-sports-feed.ts`),
 * - le moteur de règlement & mi-temps (`src/db/fixtures.ts`, `src/lib/markets.ts`, `src/lib/settle.ts`),
 * - la maintenance idempotente PostgreSQL (`src/db/seed.ts`),
 * - les routes API (`/api/matches`, `/api/matches/history`) et composants UI (`MatchCard`, `FeaturedMatch`, `MarketSheet`, `/resultats`, `LiveMatchTracker`).
 */

export interface GenericMatchEvent {
  type: string;
  team: string;
  minute: number;
  player?: string;
}

interface ParsedPlayerLabel {
  base: string;
  isOwnGoal: boolean;
  isPenalty: boolean;
}

const STOPPAGE_BOUNDARY_MINUTES = new Set([45, 90, 105, 120]);

function clampMinute(m: number): number {
  if (!Number.isFinite(m)) return 1;
  return Math.max(1, Math.min(120, Math.round(m)));
}

function eventCategory(type: string): "goal" | "red" | "other" {
  if (type === "goal") return "goal";
  if (type === "red" || type === "red_card") return "red";
  return "other";
}

/**
 * Extrait le nom de base du joueur et les balises réglementaires `(CSC)` / `(P)`
 * sans jamais les dupliquer.
 */
export function parsePlayerLabel(raw?: string | null): ParsedPlayerLabel {
  if (!raw) {
    return { base: "", isOwnGoal: false, isPenalty: false };
  }
  let working = raw.trim();
  let isOwnGoal = false;
  let isPenalty = false;

  if (/\(\s*(?:CSC|OG)\s*\)/i.test(working)) {
    isOwnGoal = true;
    working = working.replace(/\(\s*(?:CSC|OG)\s*\)/gi, " ");
  }
  if (/\(\s*(?:P|PEN\.?)\s*\)/i.test(working)) {
    isPenalty = true;
    working = working.replace(/\(\s*(?:P|PEN\.?)\s*\)/gi, " ");
  }

  const base = working.replace(/\s+/g, " ").trim();
  return { base, isOwnGoal, isPenalty: !isOwnGoal && isPenalty };
}

function formatPlayerWithFlags(
  base: string,
  isOwnGoal: boolean,
  isPenalty: boolean
): string | undefined {
  const clean = base.replace(/\s+/g, " ").trim();
  if (!clean) {
    if (isOwnGoal) return "(CSC)";
    if (isPenalty) return "(P)";
    return undefined;
  }
  if (isOwnGoal) return `${clean} (CSC)`;
  if (isPenalty) return `${clean} (P)`;
  return clean;
}

/**
 * Translittération latine complète (accents NFD + ligatures nordiques/germaniques/slaves)
 * pour comparer fiablement `Á. Berenguer` ↔ `Álex Berenguer`, `R. Højlund` ↔ `Rasmus Hojlund`, etc.
 */
export function foldPlayerText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/[’`´]/g, "'")
    .replace(/\bjr\.?(?=\s|$)/g, "junior")
    .replace(/\bsr\.?(?=\s|$)/g, "senior")
    .replace(/[^a-z0-9.\-'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanToken(tok: string): string {
  return tok.replace(/^\.+|\.+$/g, "");
}

function isAbbreviatedInitialToken(rawTok: string): boolean {
  const trimmed = rawTok.trim();
  if (!trimmed) return false;
  if (trimmed.includes(".")) return true;
  const bare = cleanToken(trimmed);
  return bare.length === 1;
}

function initialMatchesGivenName(shortRaw: string, fullRaw: string): boolean {
  const s = cleanToken(shortRaw).replace(/[.'-]/g, "");
  const f = cleanToken(fullRaw);
  if (!s || !f) return false;
  if (s === f.replace(/[.'-]/g, "")) return true;

  if (!isAbbreviatedInitialToken(shortRaw)) return false;

  if (s.length === 1) {
    return f.startsWith(s);
  }

  // Initiales composées : ex. "J.P." / "J.-P." face à "Jean-Philippe"
  const hyphenInitials = f
    .split("-")
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
  if (hyphenInitials && hyphenInitials.startsWith(s)) {
    return true;
  }

  return f.replace(/[.'-]/g, "").startsWith(s);
}

/**
 * Détermine si deux libellés de joueur désignent le même footballeur
 * (ex. `"Y. Berchiche"` ↔ `"Yuri Berchiche"`, `"C. Egan-Riley"` ↔ `"CJ Egan-Riley"`,
 * `"Á. Berenguer (P)"` ↔ `"Álex Berenguer"`, `"K. Lee"` ↔ `"Lee Kang-In"`),
 * tout en distinguant strictement les frères/homonymes (`"I. Williams"` ≠ `"Nico Williams"`).
 */
export function samePlayerIdentity(
  nameA?: string | null,
  nameB?: string | null
): boolean {
  const parsedA = parsePlayerLabel(nameA);
  const parsedB = parsePlayerLabel(nameB);
  if (!parsedA.base || !parsedB.base) return false;

  const foldedA = foldPlayerText(parsedA.base);
  const foldedB = foldPlayerText(parsedB.base);
  if (!foldedA || !foldedB) return false;

  const bareFullA = foldedA.replace(/\./g, "").replace(/\s+/g, " ").trim();
  const bareFullB = foldedB.replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (bareFullA === bareFullB) return true;

  const rawToksA = foldedA.split(" ").filter(Boolean);
  const rawToksB = foldedB.split(" ").filter(Boolean);
  const toksA = rawToksA.map(cleanToken).filter(Boolean);
  const toksB = rawToksB.map(cleanToken).filter(Boolean);
  if (toksA.length === 0 || toksB.length === 0) return false;

  if (toksA.length >= 2 && toksB.length >= 2) {
    const lastA = toksA[toksA.length - 1];
    const lastB = toksB[toksB.length - 1];

    // Cas standard occidental : initiale(s) du prénom + même nom de famille (y compris composé ex. De Bruyne, Egan-Riley)
    if (lastA === lastB && lastA.length >= 2) {
      const firstMatch =
        initialMatchesGivenName(rawToksA[0], rawToksB[0]) ||
        initialMatchesGivenName(rawToksB[0], rawToksA[0]);

      if (firstMatch) {
        // Si les deux noms ont des particules intermédiaires explicites non abrégées différentes, on vérifie la cohérence
        const midA = toksA.slice(1, -1);
        const midB = toksB.slice(1, -1);
        if (midA.length === 0 || midB.length === 0) return true;
        const midStrA = midA.join(" ");
        const midStrB = midB.join(" ");
        if (
          midStrA === midStrB ||
          midStrA.endsWith(midStrB) ||
          midStrB.endsWith(midStrA)
        ) {
          return true;
        }
      }
    }

    // Inversion d'ordre patronymique Asie de l'Est (ex. "K. Lee" ↔ "Lee Kang-In", "M. Kim" ↔ "Kim Min-Jae")
    if (toksA.length === 2 && toksB.length === 2) {
      if (
        toksA[1] === toksB[0] &&
        toksA[1].length >= 2 &&
        isAbbreviatedInitialToken(rawToksA[0]) &&
        initialMatchesGivenName(rawToksA[0], rawToksB[1])
      ) {
        return true;
      }
      if (
        toksB[1] === toksA[0] &&
        toksB[1].length >= 2 &&
        isAbbreviatedInitialToken(rawToksB[0]) &&
        initialMatchesGivenName(rawToksB[0], rawToksA[1])
      ) {
        return true;
      }
    }
  }

  return false;
}

function isConciseShortName(base: string): boolean {
  return /^[A-ZÀ-ÖØ-ÞŒÆ]{1,2}\.(?:-[A-ZÀ-ÖØ-ÞŒÆ]\.)?\s+\S+/u.test(base.trim());
}

/**
 * Choisit le libellé bookmaker le plus propre lors de la fusion de deux entrées du même fait de jeu
 * (privilégie le format court homogène `Y. Berchiche` tout en préservant `(CSC)` ou `(P)`).
 */
export function pickPreferredPlayerLabel(
  nameA?: string | null,
  nameB?: string | null
): string | undefined {
  const a = parsePlayerLabel(nameA);
  const b = parsePlayerLabel(nameB);
  const isOwnGoal = a.isOwnGoal || b.isOwnGoal;
  const isPenalty = !isOwnGoal && (a.isPenalty || b.isPenalty);

  let chosenBase = a.base || b.base;
  if (a.base && b.base) {
    const aShort = isConciseShortName(a.base);
    const bShort = isConciseShortName(b.base);
    if (aShort && !bShort) chosenBase = a.base;
    else if (bShort && !aShort) chosenBase = b.base;
    else chosenBase = a.base.length <= b.base.length ? a.base : b.base;
  }

  return formatPlayerWithFlags(chosenBase, isOwnGoal, isPenalty);
}

/**
 * Nettoie, déduplique et réconcilie la chronologie d'événements d'un match :
 * 1. Fusionne les doublons inter-flux (`header.details` + `keyEvents`, ex. `"5' C. Egan-Riley"` + `"5' CJ Egan-Riley"`)
 *    sur les buts comme sur les cartons rouges, sans jamais fusionner un vrai doublé (ex. `18'` et `64'`, ou `80'` et `81'`).
 * 2. Lorsque le score officiel `(homeScore, awayScore)` est connu et qu'une équipe compte encore plus d'événements
 *    `"goal"` que son score réel (but annulé par la VAR ou correction d'attribution Opta/ESPN), réconcilie
 *    déterministement la liste pour qu'un match `1:0` ne puisse jamais afficher 2 buts.
 */
export function sanitizeMatchEvents<T extends GenericMatchEvent>(
  events: readonly T[] | null | undefined,
  homeScore?: number | null,
  awayScore?: number | null
): T[] {
  if (!Array.isArray(events) || events.length === 0) return [];

  const validHomeScore =
    homeScore != null && Number.isFinite(homeScore) && homeScore >= 0
      ? Math.round(homeScore)
      : null;
  const validAwayScore =
    awayScore != null && Number.isFinite(awayScore) && awayScore >= 0
      ? Math.round(awayScore)
      : null;

  const normalized = events
    .map((raw, idx) => {
      if (!raw || typeof raw !== "object") return null;
      if (raw.team !== "home" && raw.team !== "away") return null;
      const minute = clampMinute(raw.minute);
      const parsed = parsePlayerLabel(raw.player);
      const cleanPlayer = formatPlayerWithFlags(
        parsed.base,
        parsed.isOwnGoal,
        parsed.isPenalty
      );
      const clone: T = {
        ...raw,
        minute,
      };
      if (cleanPlayer) {
        clone.player = cleanPlayer;
      } else {
        delete clone.player;
      }
      return { ev: clone, idx, parsed };
    })
    .filter((item): item is { ev: T; idx: number; parsed: ParsedPlayerLabel } => item !== null)
    .sort((a, b) => a.ev.minute - b.ev.minute || a.idx - b.idx);

  if (normalized.length === 0) return [];

  let homeGoalCount = normalized.filter(
    (x) => eventCategory(x.ev.type) === "goal" && x.ev.team === "home"
  ).length;
  let awayGoalCount = normalized.filter(
    (x) => eventCategory(x.ev.type) === "goal" && x.ev.team === "away"
  ).length;

  const sideHasExcessGoals = (team: string): boolean => {
    const limit = team === "home" ? validHomeScore : validAwayScore;
    if (limit == null) return false;
    const current = team === "home" ? homeGoalCount : awayGoalCount;
    return current > limit;
  };

  const decrementGoalCount = (team: string) => {
    if (team === "home") homeGoalCount = Math.max(0, homeGoalCount - 1);
    else awayGoalCount = Math.max(0, awayGoalCount - 1);
  };

  const deduped: Array<{ ev: T; parsed: ParsedPlayerLabel }> = [];

  for (const item of normalized) {
    const cat = eventCategory(item.ev.type);
    if (cat === "other") {
      deduped.push({ ev: item.ev, parsed: item.parsed });
      continue;
    }

    let mergedIntoExisting = false;

    for (let i = deduped.length - 1; i >= 0; i--) {
      const prev = deduped[i];
      if (eventCategory(prev.ev.type) !== cat || prev.ev.team !== item.ev.team) {
        continue;
      }

      const minDiff = Math.abs(item.ev.minute - prev.ev.minute);
      if (minDiff > 1) break;

      if (cat === "red") {
        // Un même joueur ne peut pas recevoir 2 cartons rouges dans le même match ;
        // à la même minute sans nom, c'est également le même carton.
        const sameRed =
          (prev.parsed.base &&
            item.parsed.base &&
            samePlayerIdentity(prev.ev.player, item.ev.player)) ||
          (minDiff === 0 && (!prev.parsed.base || !item.parsed.base));

        if (sameRed) {
          const mergedLabel = pickPreferredPlayerLabel(prev.ev.player, item.ev.player);
          if (mergedLabel) prev.ev.player = mergedLabel;
          prev.parsed = parsePlayerLabel(prev.ev.player);
          mergedIntoExisting = true;
          break;
        }
        continue;
      }

      // Catégorie === "goal"
      const excessOnSide = sideHasExcessGoals(item.ev.team);
      const scoreUnknown =
        (item.ev.team === "home" ? validHomeScore : validAwayScore) == null;
      const bothNamed = Boolean(prev.parsed.base && item.parsed.base);
      const samePlayer =
        bothNamed && samePlayerIdentity(prev.ev.player, item.ev.player);
      const variantSpelling =
        samePlayer &&
        foldPlayerText(prev.parsed.base) !== foldPlayerText(item.parsed.base);

      if (minDiff === 0) {
        const atStoppageBoundary = STOPPAGE_BOUNDARY_MINUTES.has(item.ev.minute);
        const unnamedDuplicate =
          (!prev.parsed.base || !item.parsed.base) &&
          (excessOnSide || scoreUnknown || !atStoppageBoundary);
        const namedDuplicate =
          samePlayer &&
          (variantSpelling ||
            excessOnSide ||
            scoreUnknown ||
            !atStoppageBoundary);

        if (namedDuplicate || unnamedDuplicate) {
          const mergedLabel = pickPreferredPlayerLabel(prev.ev.player, item.ev.player);
          if (mergedLabel) prev.ev.player = mergedLabel;
          prev.parsed = parsePlayerLabel(prev.ev.player);
          decrementGoalCount(item.ev.team);
          mergedIntoExisting = true;
          break;
        }
      } else if (minDiff === 1 && samePlayer && (variantSpelling || excessOnSide)) {
        // Écart d'arrondi d'une minute entre deux flux (ex. 23:59 -> 24' vs 23')
        const mergedLabel = pickPreferredPlayerLabel(prev.ev.player, item.ev.player);
        if (mergedLabel) prev.ev.player = mergedLabel;
        prev.parsed = parsePlayerLabel(prev.ev.player);
        decrementGoalCount(item.ev.team);
        mergedIntoExisting = true;
        break;
      }
    }

    if (!mergedIntoExisting) {
      deduped.push({ ev: item.ev, parsed: item.parsed });
    }
  }

  // Passe 2 : réconciliation stricte si le nombre de buts dépasse encore le score officiel
  // (ex. changement d'attribution Opta à la même minute ou but annulé par la VAR).
  let out = deduped.map((d) => d.ev);

  const reconcileSideGoals = (
    list: T[],
    side: "home" | "away",
    officialScore: number | null
  ): T[] => {
    if (officialScore == null) return list;
    const goalIndices: number[] = [];
    for (let i = 0; i < list.length; i++) {
      if (eventCategory(list[i].type) === "goal" && list[i].team === side) {
        goalIndices.push(i);
      }
    }
    if (goalIndices.length <= officialScore) return list;

    if (officialScore === 0) {
      return list.filter(
        (ev) => !(eventCategory(ev.type) === "goal" && ev.team === side)
      );
    }

    const dropIndices = new Set<number>();
    let remainingExcess = goalIndices.length - officialScore;

    // 2a. Fusionne d'abord deux buts inscrits exactement à la même minute (correction d'auteur du but)
    for (let k = 1; k < goalIndices.length && remainingExcess > 0; k++) {
      const prevIdx = goalIndices[k - 1];
      const curIdx = goalIndices[k];
      if (dropIndices.has(prevIdx)) continue;
      if (Math.abs(list[curIdx].minute - list[prevIdx].minute) <= 1) {
        // On conserve l'entrée la plus récente / la mieux renseignée
        if (list[curIdx].player || !list[prevIdx].player) {
          dropIndices.add(prevIdx);
        } else {
          dropIndices.add(curIdx);
        }
        remainingExcess -= 1;
      }
    }

    // 2b. Si un surplus subsiste encore (ex. dernier but annulé par la VAR), on retire les entrées excédentaires de fin
    for (let k = goalIndices.length - 1; k >= 0 && remainingExcess > 0; k--) {
      const idx = goalIndices[k];
      if (!dropIndices.has(idx)) {
        dropIndices.add(idx);
        remainingExcess -= 1;
      }
    }

    return list.filter((_, idx) => !dropIndices.has(idx));
  };

  out = reconcileSideGoals(out, "home", validHomeScore);
  out = reconcileSideGoals(out, "away", validAwayScore);

  return out;
}

/**
 * Corrige un compteur `redHome` / `redAway` qui aurait été doublé par d'anciens événements dupliqués,
 * sans jamais écraser un compteur officiel issu des statistiques d'équipe.
 */
export function reconcileRedCardCounts(
  rawEvents: readonly GenericMatchEvent[] | null | undefined,
  cleanEvents: readonly GenericMatchEvent[],
  redHome?: number | null,
  redAway?: number | null
): { redHome: number; redAway: number } {
  const rawList = Array.isArray(rawEvents) ? rawEvents : [];
  const rawRedH = rawList.filter(
    (e) => eventCategory(e.type) === "red" && e.team === "home"
  ).length;
  const rawRedA = rawList.filter(
    (e) => eventCategory(e.type) === "red" && e.team === "away"
  ).length;

  const cleanRedH = cleanEvents.filter(
    (e) => eventCategory(e.type) === "red" && e.team === "home"
  ).length;
  const cleanRedA = cleanEvents.filter(
    (e) => eventCategory(e.type) === "red" && e.team === "away"
  ).length;

  const curH = Math.max(0, Math.round(redHome ?? 0));
  const curA = Math.max(0, Math.round(redAway ?? 0));

  const nextH =
    rawRedH > cleanRedH && curH === rawRedH ? cleanRedH : Math.max(curH, cleanRedH);
  const nextA =
    rawRedA > cleanRedA && curA === rawRedA ? cleanRedA : Math.max(curA, cleanRedA);

  return { redHome: nextH, redAway: nextA };
}

/**
 * Formate les résumés de buteurs par équipe pour les cartes de match, l'affiche vedette et la fiche marchés :
 * - élimine tout doublon d'événement (`1:0` -> 1 seul but affiché),
 * - regroupe proprement les vrais doublés/triplés d'un même buteur (`18', 64' K. Mbappé`)
 *   afin que son nom ne se répète jamais inutilement tout en distinguant clairement chaque minute marquée.
 */
export function formatGoalSummaryStrings(
  events?: readonly GenericMatchEvent[] | null,
  homeScore?: number | null,
  awayScore?: number | null
): { homeGoals: string[]; awayGoals: string[] } {
  const clean = sanitizeMatchEvents(events, homeScore, awayScore);
  const goals = clean.filter((e) => e.type === "goal");

  const buildSideSummary = (side: "home" | "away"): string[] => {
    const sideGoals = goals.filter((g) => g.team === side);
    if (sideGoals.length === 0) return [];

    const groups: Array<{
      displayBase: string;
      isOwnGoal: boolean;
      entries: Array<{ minute: number; isPenalty: boolean }>;
    }> = [];

    for (const g of sideGoals) {
      const parsed = parsePlayerLabel(g.player);
      if (!parsed.base || parsed.isOwnGoal) {
        groups.push({
          displayBase: parsed.base,
          isOwnGoal: parsed.isOwnGoal,
          entries: [{ minute: g.minute, isPenalty: parsed.isPenalty }],
        });
        continue;
      }

      const existing = groups.find(
        (grp) =>
          !grp.isOwnGoal &&
          grp.displayBase &&
          samePlayerIdentity(grp.displayBase, parsed.base)
      );

      if (existing) {
        const preferred = pickPreferredPlayerLabel(existing.displayBase, parsed.base);
        if (preferred) {
          existing.displayBase = parsePlayerLabel(preferred).base || existing.displayBase;
        }
        existing.entries.push({ minute: g.minute, isPenalty: parsed.isPenalty });
      } else {
        groups.push({
          displayBase: parsed.base,
          isOwnGoal: false,
          entries: [{ minute: g.minute, isPenalty: parsed.isPenalty }],
        });
      }
    }

    return groups.map((grp) => {
      if (grp.entries.length === 1) {
        const only = grp.entries[0];
        const label = formatPlayerWithFlags(
          grp.displayBase,
          grp.isOwnGoal,
          only.isPenalty
        );
        return label ? `${only.minute}’ ${label}` : `${only.minute}’`;
      }

      const minutesStr = grp.entries
        .map((e) => (e.isPenalty ? `${e.minute}’ (P)` : `${e.minute}’`))
        .join(", ");
      return `${minutesStr} ${grp.displayBase}`;
    });
  };

  return {
    homeGoals: buildSideSummary("home"),
    awayGoals: buildSideSummary("away"),
  };
}
