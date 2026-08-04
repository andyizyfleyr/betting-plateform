import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, matches, simState, type MatchRow } from "@/db/schema";
import { randomFixture } from "@/db/fixtures";

/** Un tick toutes les 20 secondes : fait avancer les matchs en direct. */
const TICK_MS = 20_000;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function runLiveEngine() {
  await ensureSeeded();

  const [user] = await db
    .select({ liveSim: appUser.liveSim })
    .from(appUser)
    .where(eq(appUser.id, 1));
  if (user && !user.liveSim) return;

  const now = Date.now();
  const [state] = await db.select().from(simState).where(eq(simState.id, 1));
  if (!state) {
    await db.insert(simState).values({ id: 1, lastTick: new Date() });
    return;
  }

  let ticks = Math.floor((now - state.lastTick.getTime()) / TICK_MS);
  if (ticks <= 0) return;
  ticks = Math.min(ticks, 24);
  await db.update(simState).set({ lastTick: new Date() }).where(eq(simState.id, 1));

  const live = await db.select().from(matches).where(eq(matches.status, "live"));
  if (live.length === 0) {
    await promoteUpcoming();
    return;
  }

  const justFinished: MatchRow[] = [];

  for (let t = 0; t < ticks; t++) {
    for (const m of live) {
      if (m.status !== "live") continue;
      if (m.sport === "football") advanceFootball(m);
      else if (m.sport === "basketball") advanceBasketball(m);
      else advanceTennis(m);
      driftOdds(m);
      if ((m.status as string) === "finished") justFinished.push(m);
    }
  }

  // Persiste les changements
  for (const m of live) {
    await db
      .update(matches)
      .set({
        status: m.status,
        minute: m.minute,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        oddsHome: m.oddsHome,
        oddsDraw: m.oddsDraw,
        oddsAway: m.oddsAway,
      })
      .where(eq(matches.id, m.id));
  }

  // Chaque match terminé laisse place à une nouvelle affiche
  for (const fin of justFinished) {
    await db.insert(matches).values(randomFixture(fin.sport));
  }

  await promoteUpcoming();
}

/** Garantit au moins un match live par sport quand des affiches sont disponibles. */
async function promoteUpcoming() {
  const live = await db.select().from(matches).where(eq(matches.status, "live"));
  const upcoming = await db
    .select()
    .from(matches)
    .where(eq(matches.status, "upcoming"))
    .orderBy(asc(matches.startsAt));

  for (const sport of ["football", "basketball", "tennis"]) {
    if (live.some((m) => m.sport === sport)) continue;
    const next = upcoming.find((m) => m.sport === sport);
    if (!next) continue;
    await db
      .update(matches)
      .set({
        status: "live",
        homeScore: 0,
        awayScore: 0,
        minute:
          sport === "football" ? "1'" : sport === "basketball" ? "Q1 · 12:00" : "Set 1 · 0-0",
      })
      .where(eq(matches.id, next.id));
  }
}

// ---------------- Avance par sport ----------------

function weightedSide(m: MatchRow): "home" | "away" {
  const favHome = m.oddsHome <= m.oddsAway;
  return Math.random() < (favHome ? 0.58 : 0.42) ? "home" : "away";
}

function advanceFootball(m: MatchRow) {
  const current = parseInt(m.minute ?? "0", 10) || 0;
  let next = current + 1 + (Math.random() < 0.25 ? 1 : 0);

  if (Math.random() < 0.06 && next < 90) {
    if (weightedSide(m) === "home") m.homeScore = (m.homeScore ?? 0) + 1;
    else m.awayScore = (m.awayScore ?? 0) + 1;
  }

  if (next >= 92) {
    m.status = "finished";
    m.minute = "Terminé";
    next = 90;
  }
  if (m.status === "live") m.minute = `${next}'`;
}

function advanceBasketball(m: MatchRow) {
  const parsed = /^Q(\d)\s*·\s*(\d{1,2}):(\d{2})/.exec(m.minute ?? "");
  let quarter = parsed ? parseInt(parsed[1], 10) : 1;
  let secondsLeft = parsed ? parseInt(parsed[2], 10) * 60 + parseInt(parsed[3], 10) : 720;

  secondsLeft -= 15 + Math.floor(Math.random() * 25);

  // Possession : une équipe marque souvent
  if (Math.random() < 0.62) {
    const pts = Math.random() < 0.18 ? 3 : 2;
    if (weightedSide(m) === "home") m.homeScore = (m.homeScore ?? 0) + pts;
    else m.awayScore = (m.awayScore ?? 0) + pts;
  }

  if (secondsLeft <= 0) {
    quarter += 1;
    secondsLeft = 720;
  }

  if (quarter > 4) {
    // Évite le nul en fin de match
    if ((m.homeScore ?? 0) === (m.awayScore ?? 0)) {
      if (Math.random() < 0.5) m.homeScore = (m.homeScore ?? 0) + 2;
      else m.awayScore = (m.awayScore ?? 0) + 2;
    }
    m.status = "finished";
    m.minute = "Terminé";
    return;
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  m.minute = `Q${quarter} · ${mm}:${ss}`;
}

const TENNIS_POINTS = [
  "0-0",
  "15-0",
  "0-15",
  "30-0",
  "15-15",
  "0-30",
  "30-15",
  "15-30",
  "40-0",
  "30-30",
  "15-40",
  "40-15",
  "40-15",
  "30-40",
  "40-30",
  "40-40",
];

function advanceTennis(m: MatchRow) {
  const parsed = /^Set\s*(\d)\s*·\s*(.+)$/.exec(m.minute ?? "");
  const setNum = parsed ? parseInt(parsed[1], 10) : 1;
  const points = parsed ? parsed[2] : "0-0";
  const idx = TENNIS_POINTS.indexOf(points);

  const gamePoint = points.startsWith("40");
  const gameWon = gamePoint && Math.random() < 0.38;

  if (gameWon || idx === -1 && Math.random() < 0.3) {
    if (weightedSide(m) === "home") m.homeScore = (m.homeScore ?? 0) + 1;
    else m.awayScore = (m.awayScore ?? 0) + 1;

    if ((m.homeScore ?? 0) >= 3 || (m.awayScore ?? 0) >= 3) {
      m.status = "finished";
      m.minute = "Terminé";
      return;
    }
    m.minute = `Set ${setNum + 1} · 0-0`;
    return;
  }

  const nextIdx = Math.min(idx + (Math.random() < 0.75 ? 1 : 0), TENNIS_POINTS.length - 1);
  m.minute = `Set ${setNum} · ${TENNIS_POINTS[nextIdx]}`;
}

// ---------------- Dérive des cotes ----------------

function driftOdds(m: MatchRow) {
  const lead = (m.homeScore ?? 0) - (m.awayScore ?? 0);
  const adj = (v: number, factor: number) => clamp(round2(v * factor), 1.05, 15);

  if (lead > 0) {
    m.oddsHome = adj(m.oddsHome, 0.985);
    m.oddsAway = adj(m.oddsAway, 1.03);
    if (m.oddsDraw) m.oddsDraw = adj(m.oddsDraw, 1.02);
  } else if (lead < 0) {
    m.oddsAway = adj(m.oddsAway, 0.985);
    m.oddsHome = adj(m.oddsHome, 1.03);
    if (m.oddsDraw) m.oddsDraw = adj(m.oddsDraw, 1.02);
  } else {
    if (m.oddsDraw) m.oddsDraw = adj(m.oddsDraw, 0.995);
    m.oddsHome = adj(m.oddsHome, 1 + (Math.random() - 0.5) * 0.02);
    m.oddsAway = adj(m.oddsAway, 1 + (Math.random() - 0.5) * 0.02);
  }
}
