const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
for (const file of ['src/components/bet-ticket.tsx', 'mobile/src/components/bet-ticket.tsx']) {
 const source = read(file);
 assert(!source.includes('SlideToCashOut'), `${file}: no list action`);
 assert(!source.includes('api.cashOut('), `${file}: no sale from list`);
 assert(source.includes('/paris/combine/'), `${file}: combo detail link`);
 assert(source.includes('/paris/simple/'), `${file}: simple detail link`);
}
for (const file of [
 'src/app/(main)/paris/simple/[id]/page.tsx', 'src/app/(main)/paris/combine/[id]/page.tsx',
 'mobile/app/(main)/paris/simple/[id].tsx', 'mobile/app/(main)/paris/combine/[id].tsx',
]) {
 const source = read(file);
 assert(source.includes('<SlideToCashOut'), `${file}: detail action retained`);
 assert(source.includes('expectedCashout'), `${file}: quote check retained`);
 assert(source.includes('idempotencyKey'), `${file}: idempotency retained`);
}
console.log('Cash Out : masqué dans la liste, conservé dans les détails simples et combinés (web/mobile).');
