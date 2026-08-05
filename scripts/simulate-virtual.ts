import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { ensureSeeded } from "../src/db/seed";
import { runLiveEngine } from "../src/db/engine";
import { matches, simState, bets, appUser } from "../src/db/schema";
import { ROUND_MS, ROUNDS, pairingsForRound, roundIndexOf, scoreAt } from "../src/db/fixtures";

const R = ROUND_MS;
let failures = 0;

function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
  if (!ok) failures++;
}

async function countMatches(status?: string) {
  const rows = await db
    .select({ status: matches.status })
    .from(matches);
  const all = rows.length;
  const byStatus = (s: string) => rows.filter((r) => r.status === s).length;
  return { all, live: byStatus("live"), upcoming: byStatus("upcoming"), finished: byStatus("finished") };
}

async function setTick(now: number, msAgo: number) {
  await db
    .update(simState)
    .set({ lastTick: new Date(now - msAgo) })
    .where(eq(simState.id, 1));
}

async function livePairingKeys() {
  const live = await db.select().from(matches).where(eq(matches.status, "live"));
  return live.map((m) => `${m.homeTeam}|${m.awayTeam}`).sort();
}

async function upcomingPairingKeys() {
  const up = await db.select().from(matches).where(eq(matches.status, "upcoming"));
  return up.map((m) => `${m.homeTeam}|${m.awayTeam}`).sort();
}

async function main() {
  // Reset complet
  await db.execute(sql`DELETE FROM bets;`);
  await db.execute(sql`DELETE FROM matches;`);
  await db.execute(sql`DELETE FROM sim_state;`);
  await db.execute(sql`DELETE FROM app_user;`);

  // Seed
  await ensureSeeded();
  let c = await countMatches();
  check("seed: 5 live + 5 upcoming + 2 finished", c.live === 5 && c.upcoming === 5 && c.finished === 2, JSON.stringify(c));

  // Premier tick du moteur : crée simState et ne casse rien
  await runLiveEngine();
  const [state] = await db.select().from(simState).where(eq(simState.id, 1));
  check("engine: simState créé", !!state);

  const now = Date.now();
  const lk0 = await livePairingKeys();
  const ek0 = pairingsForRound(0).map((p) => `${p.home}|${p.away}`).sort();
  check("round 0 en direct (seed)", JSON.stringify(lk0) === JSON.stringify(ek0));

  // +65s : journée 1 doit être live, journée 0 terminée, aucune "upcoming" terminée prématurément
  await setTick(now, 65_000);
  await runLiveEngine();
  c = await countMatches();
  const lk1 = await livePairingKeys();
  const ek1 = pairingsForRound(1).map((p) => `${p.home}|${p.away}`).sort();
  const uk1 = await upcomingPairingKeys();
  const ek2 = pairingsForRound(2).map((p) => `${p.home}|${p.away}`).sort();
  check("t+65s: 5 live journée 1", JSON.stringify(lk1) === JSON.stringify(ek1), JSON.stringify(lk1));
  check("t+65s: 5 upcoming journée 2", JSON.stringify(uk1) === JSON.stringify(ek2));
  check("t+65s: aucun upcoming terminé prématurément", c.finished === 7, JSON.stringify(c));
  check("t+65s: pas de doublons (live)", lk1.length === 5);

  // Le score d'une affiche live est déterministe (scoreAt round 1, minute ~7)
  const liveRows = await db.select().from(matches).where(eq(matches.status, "live"));
  const sample = liveRows[0];
  const s1 = scoreAt(1, 7, sample.homeTeam, sample.awayTeam);
  check("t+65s: score live = scoreAt(1, minute)", sample.homeScore === s1.home && sample.awayScore === s1.away, `${sample.homeTeam}-${sample.awayTeam} ${sample.homeScore}-${sample.awayScore} @ ${sample.minute}`);

  // +90s (elapsed ~30s) : la minute de jeu doit avancer
  await setTick(now, 90_000);
  await runLiveEngine();
  const live2 = await db.select().from(matches).where(eq(matches.status, "live"));
  const m2 = live2.find((m) => m.homeTeam === sample.homeTeam && m.awayTeam === sample.awayTeam);
  const min2 = parseInt(m2?.minute ?? "0", 10);
  check("t+90s: minute avance (>= 30)", !!(m2 && min2 >= 30), m2 ? (m2.minute ?? "absent") : "absent");

  // Boucle infinie : saut à la journée 10 (10 % 9 = 1), le moteur repart sur journée 1
  await setTick(now, 10 * R + 5_000);
  await runLiveEngine();
  const lk2 = await livePairingKeys();
  check("boucle infinie: journée 10 → round 1 live", JSON.stringify(lk2) === JSON.stringify(ek1), JSON.stringify(lk2));
  c = await countMatches();
  check("boucle infinie: toujours 5 upcoming", c.upcoming === 5, JSON.stringify(c));

  // Prune : vieux match terminé non référencé supprimé, référencé par un pari conservé
  const oldFinished = await db
    .select()
    .from(matches)
    .where(sql`status = 'finished' AND NOT EXISTS (SELECT 1 FROM bets WHERE bets.match_id = matches.id)`)
    .limit(1);
  if (oldFinished.length) {
    await db
      .update(matches)
      .set({ startsAt: new Date(now - 10 * R) })
      .where(eq(matches.id, oldFinished[0].id));
  }
  const betRef = await db.select({ matchId: bets.matchId }).from(bets).where(sql`status = 'won'`).limit(1);
  if (betRef.length && betRef[0].matchId != null) {
    await db
      .update(matches)
      .set({ startsAt: new Date(now - 10 * R) })
      .where(eq(matches.id, betRef[0].matchId));
  }
  await runLiveEngine();
  if (oldFinished.length) {
    const gone = await db.select().from(matches).where(eq(matches.id, oldFinished[0].id));
    check("prune: vieux terminé non référencé supprimé", gone.length === 0);
  } else {
    check("prune: cas test non trouvé (skip)", true);
  }
  if (betRef.length && betRef[0].matchId != null) {
    const kept = await db.select().from(matches).where(eq(matches.id, betRef[0].matchId));
    check("prune: match d'un pari gagné conservé", kept.length === 1);
  }

  // Déterminisme du score final d'un match terminé
  const finishedRows = await db.select().from(matches).where(eq(matches.status, "finished"));
  for (const f of finishedRows.slice(0, 5)) {
    const round = roundIndexOf(f.homeTeam, f.awayTeam);
    const s = scoreAt(round, 90, f.homeTeam, f.awayTeam);
    check(`déterministe: ${f.homeTeam}-${f.awayTeam} ${s.home}-${s.away}`, f.homeScore === s.home && f.awayScore === s.away, `${f.homeScore}-${f.awayScore}`);
  }

  // Récap final
  c = await countMatches();
  console.log("\nÉtat final:", JSON.stringify(c));
  console.log(failures === 0 ? "\nTOUS LES TESTS PASSENT ✓" : `\n${failures} TEST(S) EN ÉCHEC ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERREUR:", e);
  process.exit(1);
});
