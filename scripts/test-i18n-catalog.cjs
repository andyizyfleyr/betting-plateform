const assert = require('node:assert/strict');
const fs = require('node:fs');
const catalog = require('../src/lib/i18n/catalog.ts');
const { COUNTRIES } = require('../src/lib/countries.ts');
const keys = ['matches','predictions','betslip','myBets','account','mainNavigation','language','emailAddress','password','forgotPassword','signIn','confirmPassword','newPassword','sixDigitCode','minimumEightCharacters','repeatPassword','hidePassword','showPassword','backToSignIn','backToMatches','resendCode','invalidEmail','passwordRequired','signInFailed','passwordRequirements','passwordMismatch','ageAndRulesRequired','registrationFailed','verificationCodeRequired'];
assert.equal(fs.readFileSync('src/lib/i18n/catalog.ts','utf8'), fs.readFileSync('mobile/src/lib/i18n/catalog.ts','utf8'), 'web et Android désynchronisés');
assert.equal(COUNTRIES.length, 39);
for (const country of COUNTRIES) {
  const suggestions = catalog.suggestedLanguagesForCountry(country.code);
  assert(suggestions.length > 0);
  for (const lang of suggestions) assert(catalog.isLanguage(lang));
}
for (const lang of Object.keys(catalog.LANGUAGE_NAMES)) for (const key of keys) {
  assert.equal(typeof catalog.translate(lang,key), 'string');
  assert(catalog.translate(lang,key).trim());
}
assert.deepEqual(catalog.suggestedLanguagesForCountry('ng'), ['en']);
assert.deepEqual(catalog.suggestedLanguagesForCountry('GW'), ['pt']);
assert.equal(catalog.resolveReleasedLanguage('en'), 'fr');
assert.equal(catalog.resolveReleasedLanguage('__proto__'), 'fr');
assert.equal(catalog.languageDirection('ar'), 'rtl');
assert.equal(catalog.languageDirection('fr'), 'ltr');
console.log('i18n : 39 pays, catalogue web/Android cohérent, langues non terminées désactivées.');
