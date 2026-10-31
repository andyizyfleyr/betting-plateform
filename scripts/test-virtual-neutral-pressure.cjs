const assert = require('node:assert/strict');
const { computeDynamicStepTilts } = require('../src/db/engine.ts');
for (const pressure of [
  { tickets: [], houseTightness: 1 },
  { tickets: [{market:'result', selection:'home', stake:1000000, odds:5, riskWeight:1}], houseTightness:100 },
  { tickets: [{market:'result', selection:'away', stake:1000000, odds:5, riskWeight:1}], houseTightness:0 },
]) for (const minute of [0, 45, 80]) {
  assert.deepEqual(computeDynamicStepTilts(pressure, 0, 0, minute, 1.5, 1.5, []), {hTilt:1,aTilt:1});
}
console.log('Moteur virtuel : coefficient de pression neutre pour plusieurs expositions (pas une certification RNG).');
