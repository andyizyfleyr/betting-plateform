/**
 * Test unitaire du parseur (sans navigateur).
 * Lancez : npx tsx scripts/_test-parser.ts
 */
import { parseRowText } from "../src/lib/scraper";

const cases: Array<{ label: string; text: string; expect: string }> = [
  {
    label: "football classe",
    text: `Krylia Sovetov
Baltika Kaliningrad
2 - 1
67'
1.35
4.80
6.50`,
    expect: "live",
  },
  {
    label: "footer faux positif",
    text: `REGISTRATION
LOG IN
PARTNERS
SUPPORT`,
    expect: "null",
  },
  {
    label: "copyright faux positif",
    text: `Copyright © 2026 «1xBet»
24/7 SUPPORT`,
    expect: "null",
  },
  {
    label: "ligne simple à",
    text: `Paris SG
Marseille
2-1
0:1
90'`,
    expect: "live",
  },
  {
    label: "minute apis",
    text: `Lyon
Lille
0-0
45+2'`,
    expect: "live",
  },
];

let ok = 0;
let fail = 0;
for (const c of cases) {
  const r = parseRowText(c.text);
  const got = r ? r.status : "null";
  const pass = c.expect === "null" ? !r : r?.status === c.expect;
  if (pass) ok++;
  else {
    fail++;
    console.log(`✗ ${c.label}: attendu=${c.expect}, obtenu=${got}${r ? ` | ${r.homeTeam} vs ${r.awayTeam} ${r.homeScore}-${r.awayScore} @${r.minute} odds ${r.oddsHome}/${r.oddsDraw}/${r.oddsAway}` : ""}`);
  }
}
console.log(`\n${ok} ✓ / ${fail} ✗`);