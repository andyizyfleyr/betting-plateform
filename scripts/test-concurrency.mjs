#!/usr/bin/env node
/**
 * Suite officielle de tests de concurrence financière PULSE
 *
 * Usage (sur branche Neon de test ou compte de test éphémère isolé) :
 *   BASE_URL="https://votre-domaine.vercel.app" npm run test:concurrency
 *   # ou en local :
 *   BASE_URL="http://localhost:3000" npm run test:concurrency
 *
 * Sécurité :
 *  - Crée automatiquement un compte de test jetable isolé (`pulse_concu_<ts>@test.pulse.local`)
 *    afin de ne JAMAIS toucher aux vrais joueurs ni aux vrais soldes.
 *  - Exécute les 3 scénarios critiques en parallèle massif (`Promise.all`) :
 *      1) Même pari, même `idempotencyKey`, 20 requêtes simultanées -> 1 pari créé, 1 débit, 19 `deduplicated: true`
 *      2) Cash Out simultané sur le même ticket (même clé + clés distinctes) -> 1 seul paiement crédité
 *      3) 20 paris distincts (20 clés différentes) de 10 € avec un solde exact de 10 € -> 1 accepté, 19 refusés, solde final = 0,00 €
 */

import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const PARALLEL_COUNT = 20;

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractSessionCookie(res) {
  const getSetCookie = res.headers.getSetCookie?.bind(res.headers);
  const cookies = getSetCookie ? getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  for (const raw of cookies) {
    const match = raw.match(/(__pulse_session=[^;]+)/);
    if (match) return match[1];
  }
  return null;
}

async function api(path, { method = "GET", cookie = "", body } = {}) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, res };
}

async function main() {
  console.log(`\n🧪 Test de concurrence financière sur : ${BASE_URL}\n`);

  // 0. Création d'un compte de test 100 % isolé
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = process.env.TEST_EMAIL || `pulse_concu_test_${stamp}@test.pulse.local`;
  const password = process.env.TEST_PASSWORD || `TestConcu!${stamp}`;

  if (!email.toLowerCase().includes("test")) {
    throw new Error(
      "Sécurité : TEST_EMAIL doit obligatoirement contenir 'test' pour ne jamais cibler un vrai joueur."
    );
  }

  let cookie = "";
  let initialBalance = 0;

  if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
    const login = await api("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(login.status, 200, `Échec connexion compte test : ${JSON.stringify(login.data)}`);
    cookie = extractSessionCookie(login.res) || "";
    initialBalance = round2(login.data.user.balance);
  } else {
    const reg = await api("/api/auth/register", {
      method: "POST",
      body: { name: "Test Concurrence", email, password },
    });
    assert.equal(reg.status, 200, `Échec création compte test : ${JSON.stringify(reg.data)}`);
    cookie = extractSessionCookie(reg.res) || "";
    initialBalance = round2(reg.data.user.balance);
  }

  assert.ok(cookie.startsWith("__pulse_session="), "Cookie de session introuvable");
  console.log(`✅ Compte de test isolé prêt (${email}) — Solde initial : ${initialBalance.toFixed(2)} €`);

  // Récupération des matchs à venir (cotes stables) et d'une question ouverte (pour Cash Out immédiat)
  const [{ data: matchesPayload }, { data: predCatalog }] = await Promise.all([
    api("/api/matches"),
    api("/api/predictions/catalog"),
  ]);

  const upcomingMatches = (matchesPayload?.matches || []).filter(
    (m) => m.status === "upcoming" && !m.suspended && Number(m.oddsHome) > 1.05
  );
  assert.ok(upcomingMatches.length >= 2, "Il faut au moins 2 matchs 'upcoming' ouverts pour le test.");

  const openQuestions = (predCatalog?.questions || []).filter((q) => q.status === "open");
  assert.ok(openQuestions.length >= 1, "Il faut au moins 1 prédiction ouverte pour tester le Cash Out.");

  // =========================================================================
  // TEST 1 : Même pari, même clé d'idempotence, 20 fois en parallèle
  // =========================================================================
  console.log(`\n▶ TEST 1 : Même pari (10 €), même clé d'idempotence, ${PARALLEL_COUNT} requêtes simultanées...`);
  const match1 = upcomingMatches[0];
  const sharedKey = `concu-same-key-${randomUUID()}`;
  const stake1 = 10;

  const before1 = await api("/api/bets", { cookie });
  const balanceBefore1 = round2(before1.data.balance);
  const countBefore1 = before1.data.bets.length;

  const burst1 = await Promise.all(
    Array.from({ length: PARALLEL_COUNT }, () =>
      api("/api/bets", {
        method: "POST",
        cookie,
        body: {
          matchId: match1.id,
          market: "result",
          selection: "home",
          stake: stake1,
          expectedOdds: match1.oddsHome,
          oddsChangePolicy: "any",
          idempotencyKey: sharedKey,
        },
      })
    )
  );

  const ok1 = burst1.filter((r) => r.status === 200);
  const created1 = ok1.filter((r) => !r.data?.deduplicated);
  const deduped1 = ok1.filter((r) => r.data?.deduplicated === true);
  const uniqueBetIds1 = new Set(ok1.map((r) => r.data?.bet?.id));

  const after1 = await api("/api/bets", { cookie });
  const balanceAfter1 = round2(after1.data.balance);
  const countAfter1 = after1.data.bets.length;

  assert.equal(ok1.length, PARALLEL_COUNT, `Attendu ${PARALLEL_COUNT} statuts 200, reçu ${ok1.length}`);
  assert.equal(created1.length, 1, `Attendu 1 création réelle, reçu ${created1.length}`);
  assert.equal(deduped1.length, PARALLEL_COUNT - 1, `Attendu ${PARALLEL_COUNT - 1} deduplicated: true`);
  assert.equal(uniqueBetIds1.size, 1, "Toutes les réponses doivent renvoyer exactement le même bet.id");
  assert.equal(countAfter1 - countBefore1, 1, "1 seul pari doit exister en base");
  assert.equal(
    balanceAfter1,
    round2(balanceBefore1 - stake1),
    `1 seul débit attendu (${round2(balanceBefore1 - stake1)} €), solde observé : ${balanceAfter1} €`
  );
  console.log(
    `  ✅ PASS : 1 pari créé, ${deduped1.length} dédupliqués, 1 seul débit (${balanceBefore1.toFixed(2)} € → ${balanceAfter1.toFixed(2)} €)`
  );

  await sleep(800);

  // =========================================================================
  // TEST 3 : Cash Out simultané sur le même ticket (même clé PUIS clés distinctes)
  // =========================================================================
  console.log(`\n▶ TEST 3A & 3B : Cash Out simultané sur le même ticket...`);
  const qOpen = openQuestions[0];
  const predSelection = Array.isArray(qOpen.options) && qOpen.options.length >= 2 ? qOpen.options[0].key : "yes";
  const predOdds = Array.isArray(qOpen.options) && qOpen.options.length >= 2 ? qOpen.options[0].odds : qOpen.oddsYes;

  // 3A : 10 Cash Outs simultanés avec la MÊME clé (double clic rapide)
  const placedPredA = await api("/api/predictions", {
    method: "POST",
    cookie,
    body: {
      questionId: qOpen.id,
      selection: predSelection,
      stake: 10,
      expectedOdds: predOdds,
      oddsChangePolicy: "any",
      idempotencyKey: `pred-setup-a-${randomUUID()}`,
    },
  });
  assert.equal(placedPredA.status, 200, `Échec pari prédiction 3A : ${JSON.stringify(placedPredA.data)}`);
  const betIdA = placedPredA.data.bet.id;
  const balBeforeCashA = round2(placedPredA.data.balance);

  const listForCashA = await api("/api/bets", { cookie });
  const ticketA = listForCashA.data.bets.find((b) => b.kind === "prediction" && b.id === betIdA);
  assert.ok(ticketA?.cashOut > 0, "Montant Cash Out introuvable sur le ticket 3A");

  const cashSameKey = `cashout-same-${randomUUID()}`;
  const cashBurstA = await Promise.all(
    Array.from({ length: 10 }, () =>
      api("/api/bets/cashout", {
        method: "POST",
        cookie,
        body: {
          betId: betIdA,
          kind: "prediction",
          expectedCashout: ticketA.cashOut,
          idempotencyKey: cashSameKey,
        },
      })
    )
  );
  const cashOkA = cashBurstA.filter((r) => r.status === 200);
  const cashExecA = cashOkA.filter((r) => !r.data?.deduplicated);
  const cashDedupA = cashOkA.filter((r) => r.data?.deduplicated === true);
  const meAfterCashA = await api("/api/auth/me", { cookie });
  const balAfterCashA = round2(meAfterCashA.data.user.balance);
  const paidValueA = round2(cashExecA[0]?.data?.value ?? 0);

  assert.equal(cashExecA.length, 1, "1 seul Cash Out réel doit s'exécuter (même clé)");
  assert.equal(cashDedupA.length, 9, "Les 9 autres doivent recevoir deduplicated: true");
  assert.equal(balAfterCashA, round2(balBeforeCashA + paidValueA), "Le solde ne doit être crédité qu'une seule fois (3A)");
  console.log(
    `  ✅ PASS 3A (même clé, 10×) : 1 paiement (+${paidValueA.toFixed(2)} €), 9 dédupliqués, solde = ${balAfterCashA.toFixed(2)} €`
  );

  await sleep(800);

  // 3B : 10 Cash Outs simultanés avec 10 CLÉS DIFFÉRENTES (ex. 2 onglets ouverts)
  const placedPredB = await api("/api/predictions", {
    method: "POST",
    cookie,
    body: {
      questionId: qOpen.id,
      selection: predSelection,
      stake: 10,
      expectedOdds: predOdds,
      oddsChangePolicy: "any",
      idempotencyKey: `pred-setup-b-${randomUUID()}`,
    },
  });
  assert.equal(placedPredB.status, 200, `Échec pari prédiction 3B : ${JSON.stringify(placedPredB.data)}`);
  const betIdB = placedPredB.data.bet.id;
  const balBeforeCashB = round2(placedPredB.data.balance);

  const listForCashB = await api("/api/bets", { cookie });
  const ticketB = listForCashB.data.bets.find((b) => b.kind === "prediction" && b.id === betIdB);
  assert.ok(ticketB?.cashOut > 0, "Montant Cash Out introuvable sur le ticket 3B");

  const cashBurstB = await Promise.all(
    Array.from({ length: 10 }, () =>
      api("/api/bets/cashout", {
        method: "POST",
        cookie,
        body: {
          betId: betIdB,
          kind: "prediction",
          expectedCashout: ticketB.cashOut,
          idempotencyKey: `cashout-diff-${randomUUID()}`,
        },
      })
    )
  );
  const cashWinnersB = cashBurstB.filter((r) => r.status === 200);
  const cashRejectedB = cashBurstB.filter((r) => r.status === 400);
  const meAfterCashB = await api("/api/auth/me", { cookie });
  const balAfterCashB = round2(meAfterCashB.data.user.balance);
  const paidValueB = round2(cashWinnersB[0]?.data?.value ?? 0);

  assert.equal(cashWinnersB.length, 1, `Attendu 1 seul Cash Out gagnant, reçu ${cashWinnersB.length}`);
  assert.equal(cashRejectedB.length, 9, `Attendu 9 rejets 400, reçu ${cashRejectedB.length}`);
  assert.equal(balAfterCashB, round2(balBeforeCashB + paidValueB), "Le solde ne doit être crédité qu'une seule fois (3B)");
  console.log(
    `  ✅ PASS 3B (10 clés distinctes, 10×) : 1 seul paiement (+${paidValueB.toFixed(2)} €), 9 rejetés (400), solde = ${balAfterCashB.toFixed(2)} €`
  );

  await sleep(800);

  // =========================================================================
  // TEST 2 : 20 paris différents (20 clés différentes) avec un solde de 10 €
  // =========================================================================
  console.log(`\n▶ TEST 2 : Solde ramené à 10,00 € puis ${PARALLEL_COUNT} paris distincts de 10,00 € en parallèle...`);
  const matchSetup = upcomingMatches[0];
  const match2 = upcomingMatches[1];

  const mePreSetup = await api("/api/auth/me", { cookie });
  const currentBal = round2(mePreSetup.data.user.balance);

  if (currentBal > 10) {
    const drainStake = round2(currentBal - 10);
    const drainRes = await api("/api/bets", {
      method: "POST",
      cookie,
      body: {
        matchId: matchSetup.id,
        market: "result",
        selection: "away",
        stake: drainStake,
        expectedOdds: matchSetup.oddsAway,
        oddsChangePolicy: "any",
        idempotencyKey: `drain-to-10-${randomUUID()}`,
      },
    });
    assert.equal(drainRes.status, 200, `Échec mise d'ajustement à 10 € : ${JSON.stringify(drainRes.data)}`);
    await sleep(800);
  }

  const before2 = await api("/api/bets", { cookie });
  const balanceBefore2 = round2(before2.data.balance);
  const countBefore2 = before2.data.bets.length;
  assert.equal(balanceBefore2, 10, `Le solde avant Test 2 doit être 10,00 € (observé : ${balanceBefore2} €)`);

  const burst2 = await Promise.all(
    Array.from({ length: PARALLEL_COUNT }, () =>
      api("/api/bets", {
        method: "POST",
        cookie,
        body: {
          matchId: match2.id,
          market: "result",
          selection: "home",
          stake: 10,
          expectedOdds: match2.oddsHome,
          oddsChangePolicy: "any",
          idempotencyKey: `concu-diff-key-${randomUUID()}`,
        },
      })
    )
  );

  const winners2 = burst2.filter((r) => r.status === 200);
  const rejected2 = burst2.filter((r) => r.status === 400);

  const after2 = await api("/api/bets", { cookie });
  const balanceAfter2 = round2(after2.data.balance);
  const countAfter2 = after2.data.bets.length;

  assert.equal(winners2.length, 1, `Attendu 1 seul pari accepté, reçu ${winners2.length}`);
  assert.equal(
    rejected2.length,
    PARALLEL_COUNT - 1,
    `Attendu ${PARALLEL_COUNT - 1} refus 400 (Solde insuffisant), reçu ${rejected2.length}`
  );
  assert.equal(countAfter2 - countBefore2, 1, "1 seul pari doit avoir été inséré en base");
  assert.equal(balanceAfter2, 0, `Solde final attendu : 0,00 € (observé : ${balanceAfter2} €)`);
  assert.ok(balanceAfter2 >= 0, "Le solde ne doit JAMAIS être négatif");

  console.log(
    `  ✅ PASS : 1 seul pari passé, ${rejected2.length} refusés (Solde insuffisant), solde final = ${balanceAfter2.toFixed(2)} € (jamais négatif)`
  );

  console.log(`\n🎉 TOUS LES TESTS DE CONCURRENCE (1, 2, 3A, 3B) SONT VERTS !\n`);
}

main().catch((err) => {
  console.error("\n❌ ÉCHEC DU TEST DE CONCURRENCE :", err);
  process.exit(1);
});
