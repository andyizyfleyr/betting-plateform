const assert = require('node:assert/strict');
const {
  GIFT_CARDS,
  validateGiftCard,
  formatGiftCardDisplay,
  cleanGiftCardCode,
} = require('../src/lib/gift-cards.ts');

console.log('Testing Gift Cards validation for all 9 cards...');

// 1. Transcash (12 chiffres)
assert.equal(validateGiftCard('transcash', '1234 5678 9012').valid, true);
assert.equal(validateGiftCard('transcash', '123456789012').valid, true);
assert.equal(validateGiftCard('transcash', '12345678901').valid, false); // 11
assert.equal(validateGiftCard('transcash', '1234567890123').valid, false); // 13
assert.equal(validateGiftCard('transcash', '12345678901A').valid, false); // letter

// 2. PCS (10 chiffres)
assert.equal(validateGiftCard('pcs', '1234 5678 90').valid, true);
assert.equal(validateGiftCard('pcs', '1234567890').valid, true);
assert.equal(validateGiftCard('pcs', '123456789').valid, false); // 9
assert.equal(validateGiftCard('pcs', '12345678901').valid, false); // 11

// 3. Paysafecard (16 chiffres)
assert.equal(validateGiftCard('paysafecard', '0123 4567 8901 2345').valid, true);
assert.equal(validateGiftCard('paysafecard', '0123456789012345').valid, true);
assert.equal(validateGiftCard('paysafecard', '012345678901234').valid, false); // 15
assert.equal(validateGiftCard('paysafecard', '01234567890123456').valid, false); // 17

// 4. Neosurf (10 caractères alphanumériques)
assert.equal(validateGiftCard('neosurf', 'ABC1234567').valid, true);
assert.equal(validateGiftCard('neosurf', 'abc1234567').valid, true); // lower to upper
assert.equal(validateGiftCard('neosurf', 'ABC123456').valid, false); // 9
assert.equal(validateGiftCard('neosurf', 'ABC12345678').valid, false); // 11

// 5. Amazon (14 ou 15 caractères)
assert.equal(validateGiftCard('amazon', 'ABCD-EFGHJK-LMNP').valid, true); // 14
assert.equal(validateGiftCard('amazon', 'ABCDEFGHJKLMNPQ').valid, true); // 15
assert.equal(validateGiftCard('amazon', 'ABCDEFGHIJKLM').valid, false); // 13
assert.equal(validateGiftCard('amazon', 'ABCDEFGHJKLMNPQR').valid, false); // 16

// 6. Apple (16 caractères)
assert.equal(validateGiftCard('apple', 'X1234567890ABCDE').valid, true); // 16
assert.equal(validateGiftCard('apple', 'X1234567890ABCD').valid, false); // 15
assert.equal(validateGiftCard('apple', 'X1234567890ABCDEF').valid, false); // 17

// 7. Visa Gift Card (16 chiffres, Luhn)
// 4111 1111 1111 1111 is standard valid Luhn Visa
assert.equal(validateGiftCard('visa_gift', '4111 1111 1111 1111').valid, true);
assert.equal(validateGiftCard('visa_gift', '4111 1111 1111 1112').valid, false); // bad luhn
assert.equal(validateGiftCard('visa_gift', '4111 1111 1111 111').valid, false); // 15 digits

// 8. Mastercard Gift Card (16 chiffres, Luhn)
// 5555 5555 5555 4444 is standard valid Luhn Mastercard
assert.equal(validateGiftCard('mastercard_gift', '5555 5555 5555 4444').valid, true);
assert.equal(validateGiftCard('mastercard_gift', '5555 5555 5555 4445').valid, false); // bad luhn

// 9. American Express Gift Card (15 chiffres, Luhn)
// 3782 822463 10005 is standard valid Luhn Amex
assert.equal(validateGiftCard('amex_gift', '3782 822463 10005').valid, true);
assert.equal(validateGiftCard('amex_gift', '3782 822463 10006').valid, false); // bad luhn
assert.equal(validateGiftCard('amex_gift', '3782 822463 1000').valid, false); // 14 digits

console.log('All 9 Gift Cards validated successfully with exact length and digit verification!');
