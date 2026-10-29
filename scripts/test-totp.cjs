const assert=require('node:assert/strict');
process.env.TOTP_ENCRYPTION_KEY='aa'.repeat(32);
const {base32,totpAt,matchingStep,encryptTotp,decryptTotp}=require('../src/lib/totp.ts');
const secret=base32(Buffer.from('12345678901234567890'));
assert.equal(totpAt(secret,1),'287082');
assert.equal(matchingStep(secret,'287082',59000),1);
const encrypted=encryptTotp(secret); assert(!encrypted.includes(secret)); assert.equal(decryptTotp(encrypted),secret);
const changed=encrypted.split('.');changed[1]=Buffer.alloc(16).toString('base64url');assert.throws(()=>decryptTotp(changed.join('.')));
console.log('TOTP RFC 6238 et chiffrement AES-GCM : OK');
