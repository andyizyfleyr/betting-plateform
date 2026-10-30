const assert = require('node:assert/strict');
const { nextVirtualStart, virtualPairKey, sharesVirtualTeam, VIRTUAL_REMATCH_GAP_MS } = require('../src/lib/virtual-fixtures.ts');
const m = 60_000, d = 10*m;
const a = {home:'Paris SG',away:'Marseille',start:0,end:d};
assert.equal(virtualPairKey(a.home,a.away),virtualPairKey('marseille','PARIS SG'));
assert(sharesVirtualTeam(a,{home:'Paris SG',away:'Lyon'}));
assert.equal(nextVirtualStart({home:'Marseille',away:'Paris SG'},d,d,[a]),d+VIRTUAL_REMATCH_GAP_MS);
assert.equal(nextVirtualStart({home:'Paris SG',away:'Lyon'},1*m,d,[a]),d);
assert.equal(nextVirtualStart({home:'Lille',away:'Lyon'},1*m,d,[a]),1*m);
const windows=[];
for (let i=0;i<250;i++) {
 const candidate = {home:`Club ${i%21}`, away:`Club ${(i*7+3)%21}`};
 if(candidate.home===candidate.away) continue;
 const start=nextVirtualStart(candidate,i*150_000,d,windows);
 for(const old of windows) {
   if(sharesVirtualTeam(candidate,old)) assert(start>=old.end || start+d<=old.start);
   if(virtualPairKey(candidate.home,candidate.away)===virtualPairKey(old.home,old.away)) assert(start>=old.end+VIRTUAL_REMATCH_GAP_MS || start+d+VIRTUAL_REMATCH_GAP_MS<=old.start);
 }
 windows.push({...candidate,start,end:start+d});
}
console.log('Affiches virtuelles : conflits de clubs et délai de sept jours, 250 créneaux OK');

assert.equal(virtualPairKey('PSG', 'Marseille'), virtualPairKey('Paris SG', 'OM'));
const { virtualClubNames } = require('../src/lib/team-logos.ts');
const { buildVirtualFixturePool, coprimeStride } = require('../src/lib/virtual-fixtures.ts');
const pool = buildVirtualFixturePool([], virtualClubNames());
assert(pool.length > 10000);
for (const n of [7, 36, 197, pool.length]) {
  const step = coprimeStride(n, 12345678); const indices = new Set();
  for (let i=0; i<n; i++) indices.add((i*step)%n);
  assert.equal(indices.size,n);
}
// Simulation de 8 jours à quatre directs décalés : chaque paire est distincte à 7 jours.
const recent = new Map(); const live = [];
let rand = 123456;
for (let i=0; i<8*24*24; i++) {
  const now = i * 150000;
  while (live.length && live[0].end <= now) live.shift();
  rand = (Math.imul(rand,1664525)+1013904223) >>> 0;
  const offset=rand % pool.length; const step=coprimeStride(pool.length,rand >>> 4);
  let chosen;
  for(let j=0;j<pool.length;j++) {
    const f=pool[(offset+j*step)%pool.length];
    if(live.some(x => sharesVirtualTeam(f,x))) continue;
    const last=recent.get(virtualPairKey(f.home,f.away));
    if(last !== undefined && now < last+VIRTUAL_REMATCH_GAP_MS) continue;
    chosen=f; break;
  }
  assert(chosen, `Catalogue épuisé après ${i} matchs`);
  const key=virtualPairKey(chosen.home,chosen.away);
  recent.set(key,now+600000); live.push({...chosen,end:now+600000});
}
console.log(`Catalogue : ${virtualClubNames().length} clubs, ${pool.length} affiches, huit jours simulés OK`);
