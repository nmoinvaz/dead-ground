#!/usr/bin/env node
// Duels of one unit form against another on flat open ground, to check the counters within an age.
// node duel.js --age 2 plays every pair of the age's fighting forms and prints a table. Each cell is the row's
// result against the column, as the share of its worth left standing when the column is wiped out, or less
// than zero by the column's share when the row is. Every pair is played from both ends of the field.
// --count n sends n of each, else --budget s sends as many as s supply buys, 1800 unless given.
// --pair 'pike,knight' plays one pair and prints how it went. --siege sends each form against the age's
// defences and a barracks behind them, and says how long the razing took and what it cost.
// --forms 'spear,archer' plays only those forms. --time s ends a duel after s seconds, 150 unless given.
// --raze says how long each form takes to bring down a headquarters left alone. --claims plays the counters the
// ages are meant to have, given below, and says which hold.
const R = require('./rules.js');

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; }, flag = k => args.includes('--' + k);
const age = +opt('age', 1), count = +opt('count', 0), budget = +opt('budget', 1800), limit = +opt('time', 150) * R.HZ;
for (const kv of (opt('set', '') || '').split(';').filter(Boolean)) {
  const [path, v] = kv.split('='), keys = path.split('.'), last = keys.pop();
  let o = R;
  for (const k of keys) o = o[k];
  o[last] = JSON.parse(v);
}
const worth = k => R.worth(R.UNITS[k]);
const SKIP = new Set(['truck', 'sup', 'eng', 'hero', 'jet']);
const formsOf = a => [...new Set(Object.keys(R.LINES).filter(l => !SKIP.has(l)).map(l => R.formOf(l, a)).filter(Boolean))];
const howMany = k => count || Math.max(1, Math.round(budget / worth(k)));

// A game with no bases on flat, open, empty ground, both sides in the age.
function field() {
  const S = R.newGame({ seed: 1, empty: true, age });
  const M = S.map;
  M.h.fill(0.5); M.deck.fill(0); M.ground.fill(0); M.cover = []; M.coverGrid = []; M.houses = []; M.bridges = []; M.wells = []; M.ore.fill(0);
  S.gnd.fill(0); S.ore.fill(0); S.bridges = []; S.hh = []; S.towns = [];
  // Nobody is out for having no buildings, so the duel runs to its end.
  for (const P of S.P) { P.alive = false; P.tech = age; }
  S.over = { winner: -1 };
  return S;
}
// A block of n units of a kind, facing along x.
function block(S, kind, team, n, x, y) {
  const per = Math.ceil(Math.sqrt(n)), gapW = Math.max(1.6, R.UNITS[kind].r * 2 + 0.6), out = [];
  for (let i = 0; i < n; i++) {
    const r = i % per, c = i / per | 0;
    out.push(R.spawn(S, kind, team, x + (team ? 1 : -1) * c * gapW, y + (r - (per - 1) / 2) * gapW));
  }
  return out;
}
const alive = (S, team) => S.ents.filter(e => !e.b && e.team === team && e.hp > 0);
const left = (S, team) => alive(S, team).reduce((a, u) => a + worth(u.kind) * u.hp / u.max, 0);
function run(S, until) {
  while (S.tick < limit && !until()) { R.rehash(S); R.step(S); S.ev.length = 0; }
}

// One duel. Says the share of a's worth left when b is gone, or minus b's share when a is.
function duel(a, b, flip) {
  const S = field(), cy = S.map.H / 2, cx = S.map.W / 2, ta = flip ? 1 : 0, tb = 1 - ta;
  const na = howMany(a), nb = howMany(b);
  const A = block(S, a, ta, na, cx + (ta ? 11 : -11), cy), B = block(S, b, tb, nb, cx + (tb ? 11 : -11), cy);
  const wa = na * worth(a), wb = nb * worth(b);
  R.push(S, ta, { c: 'move', ids: A.map(u => u.id), x: cx + (ta ? -14 : 14), y: cy, a: true });
  R.push(S, tb, { c: 'move', ids: B.map(u => u.id), x: cx + (tb ? -14 : 14), y: cy, a: true });
  // Whoever reaches the far side and finds nobody is sent on to the enemy.
  let t = 0;
  run(S, () => {
    if (++t % (4 * R.HZ) === 0) for (const [team, foe] of [[ta, tb], [tb, ta]]) {
      const f = alive(S, foe), mine = alive(S, team).filter(u => !u.ord && !u.tgt);
      if (f.length && mine.length) R.push(S, team, { c: 'move', ids: mine.map(u => u.id), x: f[0].x, y: f[0].y, a: true });
    }
    return !alive(S, ta).length || !alive(S, tb).length;
  });
  const la = left(S, ta) / wa, lb = left(S, tb) / wb;
  return { r: la > 0 && lb > 0 ? la - lb : la > 0 ? la : -lb, secs: S.tick / R.HZ, na, nb, la, lb, done: !(la > 0 && lb > 0) };
}
const both = (a, b) => { const p = duel(a, b, false), q = duel(a, b, true); return { r: (p.r + q.r) / 2, p, q }; };

// Each form against the age's defences, an archer tower and a ballista or what the age has, with a barracks
// behind. Says whether they razed it all, in how long, and the share of their worth they kept.
function siege(a) {
  const S = field(), cy = S.map.H / 2, cx = S.map.W / 2;
  const n = howMany(a), A = block(S, a, 0, n, cx - 16, cy), w = n * worth(a);
  const blds = [R.addBuilding(S, 'bunker', 1, cx + 6, cy - 3, true), R.addBuilding(S, 'atgun', 1, cx + 6, cy + 2, true), R.addBuilding(S, 'barracks', 1, cx + 10, cy - 1, true)];
  const hp0 = blds.reduce((s, e) => s + e.max, 0);
  let t = 0;
  run(S, () => {
    if (t++ % (4 * R.HZ) === 0) {
      const up = blds.filter(e => e.hp > 0), mine = alive(S, 0).filter(u => !u.ord);
      if (up.length && mine.length) R.push(S, 0, { c: 'attack', ids: mine.map(u => u.id), id: up[0].id });
    }
    return !alive(S, 0).length || blds.every(e => e.hp <= 0);
  });
  const razed = blds.filter(e => e.hp <= 0).length, dmg = 1 - blds.reduce((s, e) => s + Math.max(0, e.hp), 0) / hp0;
  return { n, razed, dmg, secs: S.tick / R.HZ, kept: left(S, 0) / w };
}

// Each form against a headquarters with nothing to guard it. Says how long it took, or that it could not.
function raze(a) {
  const S = field(), cy = S.map.H / 2, cx = S.map.W / 2;
  const n = howMany(a), A = block(S, a, 0, n, cx - 12, cy), hq = R.addBuilding(S, 'hq', 1, cx + 4, cy - 2, true);
  R.push(S, 0, { c: 'attack', ids: A.map(u => u.id), id: hq.id });
  run(S, () => hq.hp <= 0);
  return { n, secs: hq.hp <= 0 ? S.tick / R.HZ : Infinity, dmg: 1 - Math.max(0, hq.hp) / hq.max };
}

// The counters each age is meant to have: the first form beats the second at equal cost. A siege claim says the
// form razes the defences sooner than any other form of its age that razes them, and keeps more of itself.
const CLAIMS = [
  [1, 'spear', 'chariot'], [1, 'spear', 'elephant'], [1, 'archer', 'spear'], [1, 'chariot', 'archer'], [1, 'chariot', 'outrider'], [1, 'elephant', 'chariot'], [1, 'siege', 'catapult'],
  [2, 'pike', 'knight'], [2, 'pike', 'elephant'], [2, 'crossbow', 'pike'], [2, 'longbow', 'pike'], [2, 'knight', 'crossbow'], [2, 'knight', 'longbow'], [2, 'elephant', 'knight'], [2, 'siege', 'trebuchet'],
  [3, 'musket', 'grenadier'], [3, 'jaeger', 'musket'], [3, 'grenadier', 'cuirassier'], [3, 'cannonart', 'cuirassier'], [3, 'cannonart', 'elephant'], [3, 'cuirassier', 'musket'], [3, 'cuirassier', 'jaeger'], [3, 'siege', 'cannonart'],
  [4, 'rifleman', 'atrifle'], [4, 'atrifle', 'armcar'], [4, 'atrifle', 'landship'], [4, 'armcar', 'rifleman'], [4, 'halftrack', 'rifleman'], [4, 'landship', 'armcar'], [4, 'aalorry', 'rifleman'], [4, 'siege', 'howitzer'],
  [5, 'rifle', 'rocket'], [5, 'rocket', 'tank'], [5, 'tank', 'rifle'], [5, 'ifv', 'rifle'], [5, 'flak', 'heli'], [5, 'heli', 'tank'], [5, 'siege', 'mlrs'],
  [6, 'exo', 'lancer'], [6, 'lancer', 'mech'], [6, 'lancer', 'titan'], [6, 'mech', 'exo'], [6, 'hoverapc', 'exo'], [6, 'laseraa', 'gunship'], [6, 'titan', 'mech'], [6, 'siege', 'railart'],
];

const pad = (s, n) => String(s).padStart(n);
const pct = v => (v >= 0 ? '+' : '') + Math.round(v * 100);
if (opt('pair')) {
  const [a, b] = opt('pair').split(',');
  const o = both(a, b);
  for (const d of [o.p, o.q]) console.log(`${d.na} ${a} v ${d.nb} ${b}: ${a} kept ${pct(d.la)}%, ${b} kept ${pct(d.lb)}%, ${d.secs.toFixed(0)} s${d.done ? '' : ', unfinished'}`);
  console.log(`result ${pct(o.r)} for ${a}`);
} else if (flag('claims')) {
  const ages = opt('ages') ? opt('ages').split(',').map(Number) : [age];
  let held = 0, all = 0;
  for (const c of CLAIMS.filter(c => ages.includes(c[0]))) {
    all++;
    if (c[1] === 'siege') {
      const S0 = field(), list = formsOf(c[0]), runs = list.map(a => [a, siege(a)]), s = runs.find(r => r[0] === c[2])[1];
      const rivals = runs.filter(r => r[0] !== c[2] && r[1].razed === 3);
      const ok = s.razed === 3 && rivals.every(r => r[1].secs >= s.secs || r[1].kept < s.kept);
      held += ok;
      console.log(`${ok ? 'holds' : 'FAILS'}  age ${c[0]} ${c[2]} breaks buildings: ${s.razed}/3 in ${s.secs.toFixed(0)} s keeping ${Math.round(s.kept * 100)}%; ${rivals.map(r => `${r[0]} ${r[1].secs.toFixed(0)} s ${Math.round(r[1].kept * 100)}%`).join(', ') || 'no other form razes them'}`);
      continue;
    }
    const o = both(c[1], c[2]), ok = o.r > 0;
    held += ok;
    console.log(`${ok ? 'holds' : 'FAILS'}  age ${c[0]} ${c[1]} beats ${c[2]}: ${pct(o.r)} (${o.p.na} v ${o.p.nb})`);
  }
  console.log(`${held}/${all} hold`);
} else if (flag('raze')) {
  const list = opt('forms') ? opt('forms').split(',') : formsOf(age);
  console.log(`age ${age}, ${count ? count + ' of each' : budget + ' supply of each'} against a lone ${R.nameOf('hq', age)}`);
  for (const a of list) { const r = raze(a); console.log(`  ${pad(a, 11)} x${pad(r.n, 2)}: ${Number.isFinite(r.secs) ? r.secs.toFixed(0) + ' s' : 'not razed, ' + Math.round(r.dmg * 100) + '%'}`); }
} else if (flag('siege')) {
  const list = opt('forms') ? opt('forms').split(',') : formsOf(age);
  const S0 = field();
  console.log(`age ${age} siege against a ${R.nameOf('bunker', age)}, a ${R.nameOf('atgun', age)} and a ${R.nameOf('barracks', age)}, ${count ? count + ' of each' : budget + ' supply of each'}`);
  for (const a of list) {
    const s = siege(a);
    console.log(`  ${pad(a, 11)} x${pad(s.n, 2)}: razed ${s.razed}/3, ${pad(Math.round(s.dmg * 100), 3)}% of the hp, ${pad(s.secs.toFixed(0), 3)} s, kept ${pad(Math.round(s.kept * 100), 3)}%`);
  }
} else {
  const list = opt('forms') ? opt('forms').split(',') : formsOf(age);
  console.log(`age ${age}, ${count ? count + ' of each' : budget + ' supply of each'}. Row against column: + is the row's worth kept, - the column's.`);
  console.log(pad('', 11) + list.map(k => pad(k.slice(0, 7), 8)).join(''));
  const M = {};
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const o = both(list[i], list[j]); M[list[i] + ',' + list[j]] = o.r; M[list[j] + ',' + list[i]] = -o.r; }
  for (const a of list) {
    const row = list.map(b => a === b ? pad('.', 8) : pad(pct(M[a + ',' + b]), 8));
    const wins = list.filter(b => b !== a && M[a + ',' + b] > 0).length;
    console.log(pad(a, 11) + row.join('') + `   wins ${wins}`);
  }
}
