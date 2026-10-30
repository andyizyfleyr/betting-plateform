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
for (let i=0;i<1000;i++) {
 const candidate = {home:`Club ${i%21}`, away:`Club ${(i*7+3)%21}`};
 if(candidate.home===candidate.away) continue;
 const start=nextVirtualStart(candidate,i*150_000,d,windows);
 for(const old of windows) {
   if(sharesVirtualTeam(candidate,old)) assert(start>=old.end || start+d<=old.start);
   if(virtualPairKey(candidate.home,candidate.away)===virtualPairKey(old.home,old.away)) assert(start>=old.end+VIRTUAL_REMATCH_GAP_MS || start+d+VIRTUAL_REMATCH_GAP_MS<=old.start);
 }
 windows.push({...candidate,start,end:start+d});
}
console.log('Affiches virtuelles : conflits de clubs et délai de 30 minutes, 1 000 créneaux OK');
