const assert = require('node:assert/strict');
for (const path of ['../src/lib/transfer-code.ts', '../mobile/src/lib/transfer-code.ts']) {
  const { normalizeTransferCode, formatTransferCode, isValidTransferCode } = require(path);
  const valid = '79927398713000000008';
  assert.equal(isValidTransferCode(valid), true);
  assert.equal(isValidTransferCode('7992-7398-7130-0000-0008'), true);
  assert.equal(isValidTransferCode('79927398713000000009'), false);
  assert.equal(isValidTransferCode(`${valid}1`), false);
  assert.equal(isValidTransferCode('7992739871300000000'), false);
  assert.equal(isValidTransferCode(`${valid}x`), false);
  assert.equal(formatTransferCode(valid), '7992-7398-7130-0000-0008');
  assert.equal(normalizeTransferCode('7992-7398-7130-0000-0008'), valid);
  assert.equal(normalizeTransferCode(`${valid}999`), valid);
}
console.log('Luhn et formatage des codes 20 chiffres : parité web/mobile OK');
const { generateTransferCode, hashTransferCode } = require('../src/lib/transfer-code-crypto.ts');
const { isValidTransferCode } = require('../src/lib/transfer-code.ts');
const secret = 'a5'.repeat(32);
const generated = new Set();
for (let i = 0; i < 1000; i++) {
  const code = generateTransferCode();
  assert.match(code, /^\d{20}$/);
  assert(isValidTransferCode(code));
  generated.add(code);
  const hash = hashTransferCode(code, secret);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert(!hash.includes(code));
  assert.equal(hashTransferCode(code, secret), hash);
  assert.notEqual(hashTransferCode(code, '5a'.repeat(32)), hash);
}
assert.equal(generated.size, 1000);
assert.throws(() => hashTransferCode('79927398713000000008', ''));
assert.throws(() => hashTransferCode('79927398713000000009', secret));
console.log('Génération et HMAC avec clé explicite : OK');
