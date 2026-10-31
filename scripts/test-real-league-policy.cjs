const assert = require('node:assert/strict');
const web = require('../src/lib/real-leagues.ts');
const mobile = require('../mobile/src/lib/real-leagues.ts');
const expected = ['eng.1','esp.1','ger.1','ita.1','fra.1','por.1','ned.1','uefa.champions','uefa.europa','uefa.europa.conf','fifa.cwc','fifa.world','caf.nations','uefa.euro','conmebol.america'];
for (const lib of [web,mobile]) {
 assert.deepEqual([...lib.ALLOWED_REAL_LEAGUE_SLUGS], expected);
 assert.equal(lib.OFFERED_SOCCER_LEAGUES.length, 15);
 for (const slug of expected) assert(lib.isAllowedRealLeague(slug));
 for (const slug of ['usa.1','tur.1','fifa.worldq','fifa.wwc','uefa.euroq','fifa.intercontinental_cup']) assert(!lib.isAllowedRealLeague(slug, 'Premier League'));
 assert(lib.isAllowedRealLeague(null, 'Coupe du monde des clubs'));
 assert(lib.isAllowedRealLeague(null, 'Copa America'));
 assert(!lib.isAllowedRealLeague(null, 'Coupe du monde des clubs féminine'));
 assert(!lib.isAllowedRealLeague(null, 'Championnat inconnu'));
 assert.equal(lib.resolveEspnSlugForLeague('Coupe du monde des clubs'), 'fifa.cwc');
 assert.equal(lib.resolveEspnSlugForLeague('2025 FIFA Club World Cup'), 'fifa.cwc');
 assert.equal(lib.resolveEspnSlugForLeague('MLS'), 'usa.1'); // anciens tickets
 assert(!lib.isPubliclyOfferedMatch({source:'manual',externalLeague:'usa.1',league:'Premier League'}));
 assert(lib.isPubliclyOfferedMatch({source:'virtual',league:'MLS'}));
}
console.log('Compétitions : parité mobile/web, identification exacte et anciens slugs OK.');
