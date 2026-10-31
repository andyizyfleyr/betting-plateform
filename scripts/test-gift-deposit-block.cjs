const assert = require('node:assert/strict');
const Module = require('node:module');
const { NextRequest } = require('next/server');
const original = Module._load;
let databaseCalls = 0;
Module._load = function(name) {
  if (name === '@/db') return { db: { select() { databaseCalls++; throw new Error('unexpected database access'); } } };
  if (name === '@/db/seed') return { ensureSeeded: async () => {} };
  if (name === '@/lib/session') return { requireUserId: async () => 42 };
  return original.apply(this, arguments);
};
(async () => {
  const { POST } = require('../src/app/api/payments/manual/route.ts');
  const { GIFT_CARDS } = require('../src/lib/gift-cards.ts');
  for (const method of ['gift_card', ...GIFT_CARDS.map((c) => c.id), 'PAYSAFECARD']) {
    const response = await POST(new NextRequest('https://example.test/api/payments/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, code: 'TEST-NOT-A-REAL-CODE', amount: 10 }),
    }));
    assert.equal(response.status, 503, `${method} doit être bloqué`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert(!JSON.stringify(await response.json()).includes('TEST-NOT-A-REAL-CODE'));
  }
  assert.equal(databaseCalls, 0, 'aucune lecture ou écriture de code');
  const normal = await POST(new NextRequest('https://example.test/api/payments/manual', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'mobile_money', reference: '1234', amount: 10 }),
  }));
  assert.equal(normal.status, 400, 'validation habituelle de la clé idempotente');
  console.log('Cartes cadeaux : tous les alias bloqués avant accès à la base ; Mobile Money conserve sa validation.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
