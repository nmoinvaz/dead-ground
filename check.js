#!/usr/bin/env node
// Plays AI against AI with no drawing. node check.js [--games 4] [--a regular] [--b regular]
// [--seed 1] [--limit 30] prints how each game went, and a verdict on what stalled.
// --both plays every seed from both seats, so a side's seat does not count. --quiet keeps only the table.
// --json file writes each game's numbers for a before and after comparison.
// Each game also reports, for each side, the minute of its first wave, of Tech II and III and of its first
// town, its biggest bank, the minutes it was broke (under 300 supply) or hoarding (over 5000), and the swing,
// the last minute the loser's army was worth more than the winner's.
// --layout quad|world [--players n] [--level regular] plays a free-for-all of computers on that map, its first
// n slots seated, and reports who was out when and who won.
// --set 'DIFFICULTY.regular.delay=420;UNITS.tank.cost=650' patches the rules' tables before play, for sweeps.
const R = require('./rules.js');
const AI = require('./ai.js');
const fs = require('fs');

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; }, flag = k => args.includes('--' + k);
const games = +opt('games', 4), la = opt('a', 'regular'), lb = opt('b', 'regular'), seed0 = +opt('seed', 1), limit = +opt('limit', 30);
const both = flag('both'), quiet = flag('quiet'), jsonOut = opt('json', null), layout = opt('layout', 'duel');
const MIN = 60 * R.HZ;
for (const kv of (opt('set', '') || '').split(';').filter(Boolean)) {
  const [path, v] = kv.split('='), keys = path.split('.'), last = keys.pop();
  let o = R;
  for (const k of keys) o = o[k];
  o[last] = JSON.parse(v);
  console.log(`set ${path} = ${v}`);
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const f1 = v => Number.isFinite(v) ? v.toFixed(1) : '-';

// A free-for-all on a larger map: a computer in each seated slot, played to the last side or the limit.
function ffaRun() {
  const map = R.MAPS[layout], level = opt('level', 'regular'), n = +opt('players', map.seats);
  const seats = [...Array(map.seats).keys()].slice(0, n), rows = [];
  for (let g = 0; g < games; g++) {
    const S = R.newGame({ seed: seed0 + g, layout: map.layout, seats });
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

function duelRun() {
  const results = [];
  const seats = both ? [[la, lb], [lb, la]] : [[la, lb]];
  for (let g = 0; g < games; g++) for (const [A, B] of seats) {
    const S = R.newGame({ seed: seed0 + g });
    S.ais.push(AI.create(0, A), AI.create(1, B));
    const t0 = process.hrtime.bigint();
    let peak = 0, marks = [];
    const end = limit * MIN;
    const side = [0, 1].map(() => ({ wave: -1, tech2: -1, tech3: -1, town: -1, peakBank: 0, broke: 0, hoard: 0, bank: [], army: [], units: [] }));
    let swing = 0;
    while (!S.over && S.tick < end) {
      R.step(S);
      const m = S.tick / MIN;
      for (const e of S.ev) {
        if (e.t === 'wave' && side[e.team].wave < 0) side[e.team].wave = m;
        if (e.t === 'tech') side[e.team][e.level === 2 ? 'tech2' : 'tech3'] = m;
        if (e.t === 'town' && side[e.team].town < 0) side[e.team].town = m;
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
        if (S.tick % (2 * MIN) === 0) marks.push(m + 'm ' + sums.map(s => `T${s.tech} ${s.blds}b ${s.units}u ${s.army}a ${s.towns}t ${s.supply}$`).join(' | '));
      }
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const a = R.summary(S, 0), b = R.summary(S, 1), len = S.tick / MIN;
    // The swing is the last minute the loser's army was worth more than the winner's.
    if (S.over) {
      const w = S.over.winner, l = 1 - w;
      swing = 0;
      for (let i = 0; i < side[w].army.length; i++) if (side[l].army[i] > side[w].army[i]) swing = i + 1;
    } else swing = -1;
    const winLevel = S.over ? [A, B][S.over.winner] : null;
    results.push({ seed: S.seed, a: A, b: B, winner: S.over ? S.over.winner : -1, winLevel, len, swing, side, ms: ms / S.tick, peak, sum: [a, b] });
    if (!quiet) {
      console.log(`game ${g} seed ${S.seed} ${A} v ${B}: ${S.over ? 'side ' + S.over.winner + ' (' + winLevel + ') won at ' + len.toFixed(1) + ' min' : 'no result at ' + limit + ' min'}, swing ${swing}m, ${(ms / S.tick).toFixed(2)} ms a step, peak ${peak} ents`);
      for (const m of marks) console.log('   ' + m);
      console.log('   A', JSON.stringify(a), side[0].wave >= 0 ? `wave ${f1(side[0].wave)}m` : 'no wave', `tech2 ${f1(side[0].tech2)}m town ${f1(side[0].town)}m peak bank ${side[0].peakBank} broke ${side[0].broke} hoard ${side[0].hoard}`);
      console.log('   B', JSON.stringify(b), side[1].wave >= 0 ? `wave ${f1(side[1].wave)}m` : 'no wave', `tech2 ${f1(side[1].tech2)}m town ${f1(side[1].town)}m peak bank ${side[1].peakBank} broke ${side[1].broke} hoard ${side[1].hoard}`);
    }
  }
  table(results);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ args, results }, null, 1));
}

// One table over all the games, by level rather than by seat.
function table(results) {
  const n = results.length, draws = results.filter(r => r.winner < 0).length, decided = results.filter(r => r.winner >= 0);
  const winsA = results.filter(r => r.winLevel === la && (la !== lb ? true : r.winner === 0)).length;
  const lens = decided.map(r => r.len), inBand = lens.filter(l => l >= 15 && l <= 25).length, early = lens.filter(l => l < 10).length;
  const bySide = {};
  for (const r of results) [[r.a, r.side[0]], [r.b, r.side[1]]].forEach(([lv, d]) => (bySide[lv] = bySide[lv] || []).push(d));
  console.log(`\n${la} v ${lb}, ${n} games over ${games} seeds${both ? ' from both seats' : ''}`);
  console.log(`  ${la} won ${winsA}/${n} (${(100 * winsA / n).toFixed(0)}%), ${lb} won ${n - winsA - draws}, no result ${draws} (${(100 * draws / n).toFixed(0)}%)`);
  console.log(`  length min: median ${f1(median(lens))}, mean ${f1(mean(lens))}, range ${f1(Math.min(...lens))}-${f1(Math.max(...lens))}, in 15-25: ${inBand}/${decided.length}, under 10: ${early}`);
  console.log(`  swing (last minute the loser led in army): median ${f1(median(decided.map(r => r.swing)))}, under 5m: ${decided.filter(r => r.swing < 5).length}/${decided.length}`);
  for (const lv in bySide) {
    const d = bySide[lv], w = d.map(s => s.wave).filter(v => v >= 0), t2 = d.map(s => s.tech2).filter(v => v >= 0), tw = d.map(s => s.town).filter(v => v >= 0);
    const banks = d.map(s => s.bank);
    const curve = [5, 10, 15, 20].map(m => `${m}m ${Math.round(median(banks.filter(b => b.length >= m).map(b => b[m - 1])))}$`).join(' ');
    console.log(`  ${lv}: first wave median ${f1(median(w))}m (${w.length}/${d.length} ever), tech2 median ${f1(median(t2))}m (${t2.length}), first town ${f1(median(tw))}m, peak bank median ${Math.round(median(d.map(s => s.peakBank)))}, broke min mean ${f1(mean(d.map(s => s.broke)))}, hoard min mean ${f1(mean(d.map(s => s.hoard)))}`);
    console.log(`    bank median by minute: ${curve}`);
  }
}

if (layout !== 'duel') ffaRun(); else duelRun();
