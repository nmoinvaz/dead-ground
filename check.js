#!/usr/bin/env node
// Plays AI against AI with no drawing. node check.js [--games 4] [--a regular] [--b regular]
// [--seed 1] [--limit 30] prints how each game went, and a verdict on what stalled.
// --both plays every seed from both seats, so a side's seat does not count. --quiet keeps only the table.
// --age n starts every side in age n, Ancient unless given.
// --jobs n plays the games on n threads at once. The results are the same as on one.
// --json file writes each game's numbers for a before and after comparison.
// Each game also reports, for each side, the minute of its first wave, of each age it reached and of its first
// town, its biggest bank, the minutes it was broke (under 300 supply) or hoarding (over 5000), the units it
// made by kind, the swing, the last minute the loser's army was worth more than the winner's, and the rout, the
// last minute it was worth half the winner's.
// --layout quad|world [--players n] [--level regular] plays a free-for-all of computers on that map, its first
// n slots seated, and reports who was out when and who won.
// --set 'DIFFICULTY.regular.delay=420;UNITS.tank.cost=650' patches the rules' tables before play, for sweeps.
const R = require('./rules.js');
const AI = require('./ai.js');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const args = isMainThread ? process.argv.slice(2) : workerData.args;
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; }, flag = k => args.includes('--' + k);
const games = +opt('games', 4), la = opt('a', 'regular'), lb = opt('b', 'regular'), seed0 = +opt('seed', 1), limit = +opt('limit', 30);
const both = flag('both'), quiet = flag('quiet'), jsonOut = opt('json', null), layout = opt('layout', 'duel');
const age0 = +opt('age', 1), jobs = +opt('jobs', 1);
const MIN = 60 * R.HZ;
const say = isMainThread ? s => console.log(s) : () => {};
for (const kv of (opt('set', '') || '').split(';').filter(Boolean)) {
  const [path, v] = kv.split('='), keys = path.split('.'), last = keys.pop();
  let o = R;
  for (const k of keys) o = o[k];
  o[last] = JSON.parse(v);
  say(`set ${path} = ${v}`);
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const f1 = v => Number.isFinite(v) ? v.toFixed(1) : '-';

// A free-for-all on a larger map: a computer in each seated slot, played to the last side or the limit.
function ffaRun() {
  const map = R.MAPS[layout], level = opt('level', 'regular'), n = +opt('players', map.seats);
  const seats = [...Array(map.seats).keys()].slice(0, n), rows = [];
  for (let g = 0; g < games; g++) {
    const S = R.newGame({ seed: seed0 + g, layout: map.layout, seats, age: age0 });
    for (const t of seats) S.ais.push(AI.create(t, level, seed0 + g));
    const t0 = process.hrtime.bigint(), out = [];
    while (!S.over && S.tick < limit * MIN) {
      R.step(S);
      for (const e of S.ev) if (e.t === 'fallen') out.push(`slot ${e.team} out at ${f1(S.tick / MIN)}m`);
      S.ev.length = 0;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6, len = S.tick / MIN;
    rows.push({ seed: S.seed, winner: S.over ? S.over.winner : -1, len });
    console.log(`${map.name} seed ${S.seed}, ${n} ${level}: ${S.over ? 'slot ' + S.over.winner + ' won at ' + f1(len) + ' min' : 'no result at ' + limit + ' min, ' + S.P.filter(P => P.alive).length + ' left'}, ${(ms / S.tick).toFixed(2)} ms a step. ${out.join(', ')}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ args, rows }, null, 1));
}

// The units a side made, by kind, most first.
const mixText = mix => Object.entries(mix).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} ${n}`).join(', ');
const agesText = ages => ages.map((m, a) => m >= 0 ? `A${a} ${f1(m)}m` : '').filter(Boolean).join(' ');

// One duel between two levels on one seed. Says its result and the lines it would print.
function playDuel(g, A, B) {
  const S = R.newGame({ seed: seed0 + g, age: age0 });
  S.ais.push(AI.create(0, A), AI.create(1, B));
  const t0 = process.hrtime.bigint(), lines = [];
  let peak = 0;
  const marks = [], end = limit * MIN;
  const side = [0, 1].map(() => ({ wave: -1, ages: Array(R.MAX_AGE + 1).fill(-1), town: -1, peakBank: 0, broke: 0, hoard: 0, bank: [], army: [], units: [], mix: {} }));
  for (const d of side) d.ages[age0] = 0;
  let swing = 0, rout = -1;
  while (!S.over && S.tick < end) {
    R.step(S);
    const m = S.tick / MIN;
    for (const e of S.ev) {
      if (e.team === undefined || !side[e.team]) continue;
      if (e.t === 'wave' && side[e.team].wave < 0) side[e.team].wave = m;
      if (e.t === 'tech') side[e.team].ages[e.level] = m;
      if (e.t === 'town' && side[e.team].town < 0) side[e.team].town = m;
      if (e.t === 'built') side[e.team].mix[e.kind] = (side[e.team].mix[e.kind] || 0) + 1;
    }
    S.ev.length = 0;
    peak = Math.max(peak, S.ents.length);
    if (S.tick % MIN === 0) {
      const sums = [0, 1].map(t => R.summary(S, t));
      sums.forEach((s, t) => {
        const d = side[t];
        d.bank.push(s.supply); d.army.push(s.army); d.units.push(s.units);
        d.peakBank = Math.max(d.peakBank, s.supply);
        if (s.supply < 300) d.broke++;
        if (s.supply > 5000) d.hoard++;
      });
      if (sums[0].army !== sums[1].army) swing = m;
      if (S.tick % (2 * MIN) === 0) marks.push(m + 'm ' + sums.map(s => `A${s.tech} ${s.blds}b ${s.units}u ${s.army}a ${s.towns}t ${s.supply}$ ${s.oil}o`).join(' | '));
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const a = R.summary(S, 0), b = R.summary(S, 1), len = S.tick / MIN;
  // The swing is the last minute the loser's army was worth more than the winner's.
  if (S.over) {
    const w = S.over.winner, l = 1 - w;
    swing = 0;
    rout = 0;
    for (let i = 0; i < side[w].army.length; i++) {
      if (side[l].army[i] > side[w].army[i]) swing = i + 1;
      if (side[l].army[i] * 2 >= side[w].army[i]) rout = i + 1;
    }
  } else swing = -1;
  const winLevel = S.over ? [A, B][S.over.winner] : null;
  lines.push(`game ${g} seed ${S.seed} ${A} v ${B} from age ${age0}: ${S.over ? 'side ' + S.over.winner + ' (' + winLevel + ') won at ' + len.toFixed(1) + ' min' : 'no result at ' + limit + ' min'}, swing ${swing}m, rout ${rout}m, ${(ms / S.tick).toFixed(2)} ms a step, peak ${peak} ents`);
  for (const m of marks) lines.push('   ' + m);
  [a, b].forEach((s, t) => {
    const d = side[t];
    lines.push(`   ${'AB'[t]} A${s.tech} ${s.units}u ${s.blds}b ${s.supply}$ ${s.oil}o made ${s.made} lost ${s.lost} killed ${s.killed} razed ${s.razed} mined ${Math.round(s.mined)} towns ${Math.round(s.townIn)} spent ${Math.round(s.spent)}, ${d.wave >= 0 ? 'wave ' + f1(d.wave) + 'm' : 'no wave'}, ${agesText(d.ages)}, town ${f1(d.town)}m, peak bank ${d.peakBank} broke ${d.broke} hoard ${d.hoard}`);
    lines.push(`     made: ${mixText(d.mix)}`);
  });
  return { result: { seed: S.seed, a: A, b: B, winner: S.over ? S.over.winner : -1, winLevel, len, swing, rout, side, ms: ms / S.tick, peak, sum: [a, b] }, lines };
}

async function duelRun() {
  const seats = both ? [[la, lb], [lb, la]] : [[la, lb]], list = [];
  for (let g = 0; g < games; g++) for (const [A, B] of seats) list.push([g, A, B]);
  let out;
  if (jobs > 1) {
    // Each thread takes every jobs-th game and sends back what it found.
    const parts = [...Array(Math.min(jobs, list.length)).keys()].map(j => list.map((x, i) => [i, ...x]).filter(([i]) => i % jobs === j));
    const got = await Promise.all(parts.map(part => new Promise((res, rej) => {
      const w = new Worker(__filename, { workerData: { args, part } });
      w.on('message', res); w.on('error', rej);
    })));
    out = got.flat().sort((p, q) => p.i - q.i);
  } else out = list.map(([g, A, B], i) => Object.assign(playDuel(g, A, B), { i }));
  if (!quiet) for (const o of out) for (const l of o.lines) console.log(l);
  const results = out.map(o => o.result);
  table(results);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ args, results }, null, 1));
}

// One table over all the games, by level rather than by seat.
function table(results) {
  const n = results.length, draws = results.filter(r => r.winner < 0).length, decided = results.filter(r => r.winner >= 0);
  const winsA = results.filter(r => r.winLevel === la && (la !== lb ? true : r.winner === 0)).length;
  const lens = decided.map(r => r.len), inBand = lens.filter(l => l >= 25 && l <= 40).length, early = lens.filter(l => l < 15).length;
  const bySide = {};
  for (const r of results) [[r.a, r.side[0]], [r.b, r.side[1]]].forEach(([lv, d]) => (bySide[lv] = bySide[lv] || []).push(d));
  console.log(`\n${la} v ${lb} from age ${age0}, ${n} games over ${games} seeds${both ? ' from both seats' : ''}`);
  console.log(`  ${la} won ${winsA}/${n} (${(100 * winsA / n).toFixed(0)}%), ${lb} won ${n - winsA - draws}, no result ${draws} (${(100 * draws / n).toFixed(0)}%)`);
  console.log(`  length min: median ${f1(median(lens))}, mean ${f1(mean(lens))}, range ${f1(Math.min(...lens))}-${f1(Math.max(...lens))}, in 25-40: ${inBand}/${decided.length}, under 15: ${early}`);
  console.log(`  swing (last minute the loser led in army): median ${f1(median(decided.map(r => r.swing)))}, under 5m: ${decided.filter(r => r.swing < 5).length}/${decided.length}`);
  console.log(`  rout (last minute the loser had half the winner's army): median ${f1(median(decided.map(r => r.rout)))}`);
  // A game is settled early when its swing or its rout comes before both sides reach the Industrial Age.
  if (age0 < R.POWER_AGE) {
    const before = k => decided.filter(r => r.side.some(d => d.ages[R.POWER_AGE] < 0 || d.ages[R.POWER_AGE] > r[k])).length;
    console.log(`  settled before both reached the ${R.AGES[R.POWER_AGE].name} Age: by swing ${before('swing')}/${decided.length}, by rout ${before('rout')}/${decided.length}`);
  }
  for (const lv in bySide) {
    const d = bySide[lv], w = d.map(s => s.wave).filter(v => v >= 0), tw = d.map(s => s.town).filter(v => v >= 0);
    const ages = [];
    for (let a = age0 + 1; a <= R.MAX_AGE; a++) {
      const got = d.map(s => s.ages[a]).filter(v => v >= 0);
      ages.push(`A${a} ${f1(median(got))}m (${got.length})`);
    }
    const banks = d.map(s => s.bank);
    const curve = [5, 10, 15, 20, 25, 30, 35].map(m => { const b = banks.filter(b => b.length >= m); return b.length ? `${m}m ${Math.round(median(b.map(b => b[m - 1])))}$` : ''; }).filter(Boolean).join(' ');
    const all = banks.flat();
    console.log(`  ${lv}: first wave median ${f1(median(w))}m (${w.length}/${d.length} ever), first town ${f1(median(tw))}m, ages reached ${ages.join(', ')}`);
    console.log(`    bank mean ${Math.round(mean(all))}, peak median ${Math.round(median(d.map(s => s.peakBank)))}, broke min mean ${f1(mean(d.map(s => s.broke)))}, hoard min mean ${f1(mean(d.map(s => s.hoard)))}, by minute: ${curve}`);
    const mix = {};
    for (const s of d) for (const k in s.mix) mix[k] = (mix[k] || 0) + s.mix[k];
    for (const k in mix) mix[k] = Math.round(mix[k] / d.length);
    console.log(`    made a game: ${mixText(mix)}`);
  }
}

if (!isMainThread) parentPort.postMessage(workerData.part.map(([i, g, A, B]) => Object.assign(playDuel(g, A, B), { i })));
else if (layout !== 'duel') ffaRun(); else duelRun();
