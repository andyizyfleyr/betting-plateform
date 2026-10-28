import assert from "node:assert/strict";
import { settlementPayout } from "../src/lib/settlement-payout";
import { CURRENCIES, eurToLocal, localToEur, type CurrencyCode } from "../src/lib/countries";
import { DEFAULT_BETTING_LIMITS, limitsForCurrency, validateBettingLimits } from "../src/lib/betting-limits-shared";
import { limitsForCurrency as mobileLimits } from "../mobile/src/lib/betting-limits-shared";
import { computeComboQuote as webQuote } from "../src/lib/combo-math";
import { computeComboQuote as mobileQuote } from "../mobile/src/lib/combo-math";

assert.equal(Object.keys(CURRENCIES).length, 19);
for (const code of Object.keys(CURRENCIES) as CurrencyCode[]) {
  const l = limitsForCurrency(DEFAULT_BETTING_LIMITS, code);
  assert.deepEqual(mobileLimits(DEFAULT_BETTING_LIMITS, code), l, code);
  assert.equal(l.minLocal, Math.max(CURRENCIES[code].decimals ? .01 : 1, eurToLocal(localToEur(100, "XOF"), code)), code);
  assert.equal(l.maxLocal, eurToLocal(localToEur(10_000_000, "XOF"), code), code);
  assert.equal(localToEur(l.minLocal, code), l.minEur, code);
  assert.equal(localToEur(l.maxLocal, code), l.maxEur, code);
  assert.equal(eurToLocal(localToEur(5000, code), code), 5000, code);
}
assert.equal(limitsForCurrency(DEFAULT_BETTING_LIMITS, "XOF").minLocal, 100);
assert.equal(limitsForCurrency(DEFAULT_BETTING_LIMITS, "XOF").maxLocal, 10_000_000);
assert.equal(validateBettingLimits({ ...DEFAULT_BETTING_LIMITS, maxComboLegs: 31 }), null);
assert.equal(validateBettingLimits({ ...DEFAULT_BETTING_LIMITS, maxPayoutXof: 99 }), null);
assert.deepEqual(validateBettingLimits(DEFAULT_BETTING_LIMITS), DEFAULT_BETTING_LIMITS);
for (const cap of [100, 1000, localToEur(10_000_000, "XOF")]) {
  const odds = Array(30).fill(2);
  const web = webQuote(odds, 1, cap), mobile = mobileQuote(odds, 1, cap);
  assert.equal(web.baseOdds, 2 ** 30);
  assert.equal(web.potentialWin, cap);
  assert.equal(web.capped, true);
  assert.equal(mobile.totalOdds, web.totalOdds);
  assert.equal(mobile.potentialWin, web.potentialWin);
}
assert.equal(webQuote([2, 2], 1, 100).potentialWin, 4);
console.log("19 devises, limites et parité des cotes web/mobile : OK");

// Le plafond inscrit au placement est conservé, même si l'admin le modifie ensuite.
assert.equal(settlementPayout({ stake: 100, odds: 100, potentialWin: 500 }, true, false), 500);
assert.equal(settlementPayout({ stake: 100, odds: 2, potentialWin: 200 }, true, false), 200);
assert.equal(settlementPayout({ stake: 100, odds: 2, potentialWin: 200, payoutMultiplier: 0.5, stakeReturned: 50 }, true, false), 150);
assert.equal(settlementPayout({ stake: 100, odds: 100, potentialWin: 500 }, false, true), 100);
assert.equal(settlementPayout({ stake: 100, odds: 100, potentialWin: 500 }, false, false), 0);
console.log("Règlement plafonné, historique, annulation et perte : OK");
