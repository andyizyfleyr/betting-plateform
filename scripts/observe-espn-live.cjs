#!/usr/bin/env node
/* Observational only. Never feeds quotes into pricing or accepts wagers. */
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

function parseMatch(s) {
  const m = /^([a-z0-9]+(?:\.[a-z0-9]+)*):(\d{5,15})$/.exec(s);
  if (!m) throw new Error('Match invalide : utiliser ligue:id, par ex. eng.1:401879248');
  return { league: m[1], id: m[2] };
}
function decimal(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!m || Number(m[2]) === 0) return null;
  const n = 1 + Number(m[1]) / Number(m[2]);
  return Number.isFinite(n) && n > 1 && n <= 10000 ? Math.round(n * 10000) / 10000 : null;
}
function optionalTime(v) {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function statusFrom(summary, id) {
  const competition = summary?.header?.competitions?.find(c => String(c.id) === id);
  const sides = competition?.competitors;
  if (!Array.isArray(sides)) throw new Error('Identité de compétition manquante');
  const home = sides.find(c => c.homeAway === 'home');
  const away = sides.find(c => c.homeAway === 'away');
  const score = side => {
    const raw = typeof side?.score === 'object' ? side.score.displayValue : side?.score;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    if (!/^\d+$/.test(String(raw))) return null;
    const n = Number(raw); return Number.isSafeInteger(n) && n <= 50 ? n : null;
  };
  if (!home?.id || !away?.id) throw new Error('Équipes manquantes');
  const state = competition.status?.type?.state ?? null;
  const redCards = id => {
    const team = summary?.boxscore?.teams?.find(t => String(t.team?.id) === id);
    const raw = team?.statistics?.find(v => v.name === "redCards")?.displayValue;
    return typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
  };
  return { state, period: competition.status?.period ?? null,
    clock: competition.status?.displayClock ?? null,
    homeId: String(home.id), awayId: String(away.id),
    homeScore: score(home), awayScore: score(away),
    redHome: redCards(String(home.id)), redAway: redCards(String(away.id)) };
}
function quotesFrom(data, game) {
  const quotes = [];
  for (const item of Array.isArray(data?.items) ? data.items : []) {
    const t = item?.bettingOdds?.teamOdds;
    if (!t || !item?.provider?.id) continue;
    const homeId = /\/teams\/(\d+)/.exec(item.bettingOdds?.homeTeam?.$ref ?? '')?.[1];
    const awayId = /\/teams\/(\d+)/.exec(item.bettingOdds?.awayTeam?.$ref ?? '')?.[1];
    if (homeId !== game.homeId || awayId !== game.awayId) continue;
    const entry = k => decimal(t[k]?.value);
    const result = { home: entry('liveFullTimeResultHome'), draw: entry('liveFullTimeResultDraw'), away: entry('liveFullTimeResultAway') };
    const over = entry('liveGoalLineOver'), under = entry('liveGoalLineUnder');
    const rawLine = t.liveOverUnderHandicap?.value;
    const line = typeof rawLine === 'string' && /^\d+(?:\.\d+)?$/.test(rawLine) ? Number(rawLine) : null;
    const doubleChance = { homeOrDraw: entry('liveDoubleChanceHomeOrDraw'), homeOrAway: entry('liveDoubleChanceHomeOrAway'), drawOrAway: entry('liveDoubleChanceDrawOrAway') };
    const sourceUpdatedAt = optionalTime(item.lastUpdated ?? item.updatedAt ?? item.lastUpdatedAt);
    if (Object.values(result).some(v => v !== null) || over !== null || under !== null || Object.values(doubleChance).some(v => v !== null)) {
      quotes.push({ providerId: String(item.provider.id), provider: String(item.provider.name ?? '').slice(0, 80), sourceUpdatedAt, result, total: { line, over, under }, doubleChance });
    }
  }
  return quotes;
}
async function json(url, fetcher = fetch) {
  const res = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (Buffer.byteLength(text) > 2_000_000) throw new Error('Réponse trop volumineuse');
  return JSON.parse(text);
}
async function sample(match, fetcher = fetch) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${match.league}/summary?event=${match.id}`;
  const odds = `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${match.league}/events/${match.id}/competitions/${match.id}/odds`;
  const startedAt = new Date().toISOString();
  // Score is sampled before and after the odds. Discard prices around score/period/status changes.
  const before = statusFrom(await json(base, fetcher), match.id);
  const oddsJson = await json(odds, fetcher);
  const after = statusFrom(await json(base, fetcher), match.id);
  const receivedAt = new Date().toISOString();
  const consistent = before.state === 'in' && after.state === 'in' && before.homeScore !== null && before.awayScore !== null &&
    ['state', 'period', 'homeId', 'awayId', 'homeScore', 'awayScore', 'redHome', 'redAway'].every(k => before[k] === after[k]);
  return { version: 1, match, startedAt, receivedAt, before, after, consistent,
    quotes: consistent ? quotesFrom(oddsJson, after) : [] };
}
async function main() {
  const [matchArg, output, roundsArg = '20', intervalArg = '30'] = process.argv.slice(2);
  if (!matchArg || !output) throw new Error('Usage: node scripts/observe-espn-live.cjs eng.1:401879248 observations.jsonl [tours] [secondes]');
  const matches = matchArg.split(',').map(parseMatch);
  const rounds = Number(roundsArg), interval = Number(intervalArg);
  if (!matches.length || matches.length > 5 || !Number.isInteger(rounds) || rounds < 1 || rounds > 60 || !Number.isInteger(interval) || interval < 15 || interval > 300) throw new Error('Limites : 1–5 matchs, 1–60 tours, intervalle 15–300 secondes.');
  // Append-only, no HTTP endpoints or user data. Avoid silently replacing existing observations.
  for (let round = 0; round < rounds; round++) {
    for (const match of matches) {
      try {
        const row = await sample(match);
        fs.appendFileSync(output, JSON.stringify(row) + '\n', { mode: 0o600 });
        console.log(`${row.receivedAt} ${match.league}:${match.id} ${row.after.state} coherent=${row.consistent} fournisseurs=${row.quotes.length}`);
      } catch (error) {
        fs.appendFileSync(output, JSON.stringify({ version: 1, match, receivedAt: new Date().toISOString(), error: String(error.message).slice(0, 200) }) + '\n', { mode: 0o600 });
        console.error(`${match.league}:${match.id} : ${error.message}`);
      }
    }
    if (round + 1 < rounds) await delay(interval * 1000);
  }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { parseMatch, decimal, statusFrom, quotesFrom, sample };
