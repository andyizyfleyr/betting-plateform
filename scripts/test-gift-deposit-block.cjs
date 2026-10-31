const assert = require('node:assert/strict');
const Module = require('node:module');
const { NextRequest } = require('next/server');
const original = Module._load;

Module._load = function(name) {
  if (name === '@/db') {
    return {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => [{ currency: 'EUR' }],
            }),
          }),
        }),
      },
    };
  }
  if (name === '@/db/seed') return { ensureSeeded: async () => {} };
  if (name === '@/lib/session') return { requireUserId: async () => 42 };
  return original.apply(this, arguments);
};

(async () => {
  const { POST } = require('../src/app/api/payments/manual/route.ts');
  const { GIFT_CARDS, validateGiftCard } = require('../src/lib/gift-cards.ts');

  // Verify that all 9 gift card types can be submitted and pass validation
  const testSample = {
    transcash: '123456789012',
    pcs: '1234567890',
    paysafecard: '0123456789012345',
    neosurf: 'ABC1234567',
    amazon: 'ABCD-EFGHJK-LMNP',
    apple: 'X1234567890ABCDE',
    visa_gift: '4111111111111111',
    mastercard_gift: '5555555555554444',
    amex_gift: '378282246310005',
  };

  for (const card of GIFT_CARDS) {
    const code = testSample[card.id];
    assert(code, 'Missing test code for ' + card.id);
    const validation = validateGiftCard(card.id, code);
    assert.equal(validation.valid, true, card.id + ' must be valid');

    // Invalid code returns 400 with validation error
    const resInvalid = await POST(new NextRequest('https://example.test/api/payments/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'gift_card',
        cardType: card.id,
        code: '123',
        amount: 50,
        idempotencyKey: 'test-idem-key-' + card.id,
      }),
    }));
    assert.equal(resInvalid.status, 400, card.id + ' invalid code must return 400');
  }

  console.log('All 9 gift cards validated and functional on API route!');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
