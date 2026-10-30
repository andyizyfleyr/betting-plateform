import assert from "node:assert/strict";
import { buildLiveDelta, isLiveSnapshot, type LiveMatch, type LiveSnapshot } from "../party/live-delta";

const match = (id: number, odds: number): LiveMatch => ({ id, odds, league: "Ligue", label: "Match exemple", score: [0, 0] });
const before: LiveSnapshot = { type: "MATCHES_SNAPSHOT", matches: Array.from({ length: 100 }, (_, i) => match(i + 1, 2)), serverTime: "2026-01-01T00:00:00Z" };
const after: LiveSnapshot = { type: "MATCHES_SNAPSHOT", matches: [match(101, 2), ...before.matches.filter(m => m.id !== 3).map(m => m.id === 2 ? match(2, 3) : m)], serverTime: "2026-01-01T00:00:04Z" };
assert(isLiveSnapshot(before));
assert(!isLiveSnapshot({type: "MATCHES_SNAPSHOT", matches: [match(1,2), match(1,3)]}));
const delta = buildLiveDelta(before, after, 4, 5);
assert.deepEqual(delta.matches.map(m => m.id), [101, 2]);
assert(!delta.order.includes(3));
const map = new Map(before.matches.map(m => [m.id,m]));
for (const m of delta.matches) map.set(m.id,m);
assert.deepEqual(delta.order.map(id => map.get(id)), after.matches);
assert.equal(delta.base,4); assert.equal(delta.seq,5);
const oldBytes = Buffer.byteLength(JSON.stringify(after));
const newBytes = Buffer.byteLength(JSON.stringify(delta));
assert(newBytes < oldBytes);
console.log(`Delta simulé : ${oldBytes} → ${newBytes} octets (100 matchs, 2 modifiés, 1 retiré). Ce n'est pas une mesure de transfert Neon.`);
