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
      advanceFootball(m);
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

  if (!live.some((m) => m.sport === "football")) {
    const next = upcoming.find((m) => m.sport === "football");
    if (!next) return;
    await db
      .update(matches)
      .set({
        status: "live",
        homeScore: 0,
        awayScore: 0,
        minute: "1'",
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
