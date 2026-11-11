// Mapmaker's War, the enemy commander. It sends the same commands a player can, on a clock set by its
// difficulty. It may only act on what it has seen, except that it knows where the other bases are. With
// more than one foe it fights whichever living neighbour is nearest.
// It draws on random numbers of its own, never the world's, since on a server only the server runs it.
const AI = (() => {
  const R = typeof Rules !== 'undefined' ? Rules : require('./rules.js');
  const { HZ, UNITS, BUILDINGS, TECH, POWERS, DIFFICULTY } = R;

  function create(team, level = 'regular', seed = 1) {
    const D = DIFFICULTY[level];
    const me = {
      team, level, D, waves: 0, gather: null, nextThink: team * 7, army: [], attackT: 0, target: null, state: 'build', lastPower: 0, attackUntil: 0, plan: 0,
      rand: R.mulberry(seed * 7919 + team * 104729 + 17), foe: -1, foeT: 0, startTick: -1,
      tick(S) { if (S.tick >= me.nextThink) { me.nextThink = S.tick + Math.round(D.think * HZ); think(S, me); } },
    };
    return me;
  }

  const has = (P, k) => P.counts[k] || 0;
  const queuedIn = (P, cat, kind) => P.q[cat].filter(i => i.kind === kind || (UNITS[i.kind] && UNITS[kind] && UNITS[i.kind].line === UNITS[kind].line)).length;
  // Whether a side's age has opened a building or power.
  const opened = (P, d) => P.tech >= (d.tech || 1);
  // Each line's form in the side's age, for the lines that have one by now.
  const forms = (P, lines) => lines.map(l => R.formOf(l, P.tech)).filter(Boolean);
  const value = u => u.d.cost + (u.d.oil || 0) * 3;
  // The enemy to fight: the nearest living base that is not shielded. Looked at again now and then.
  function foeOf(S, me) {
    if (S.tick < me.foeT && me.foe >= 0 && S.P[me.foe].alive !== false) return me.foe;
    me.foeT = S.tick + 30 * HZ;
    const b = S.bases[me.team];
    let best = -1, bd = Infinity;
    for (const P of S.P) {
      if (P.team === me.team || P.alive === false || (P.shield || 0) > S.tick) continue;
      const f = S.bases[P.team], d = Math.hypot(f[0] - b[0], f[1] - b[1]);
      if (d < bd) { bd = d; best = P.team; }
    }
    return me.foe = best;
  }

  function buildNext(S, me, P) {
    // Buildings go out toward the middle of the map.
    const q = P.q.bld, b = S.bases[me.team], foe = [S.map.W / 2, S.map.H / 2];
    // A finished building goes down first.
    for (const cat of ['bld', 'def']) {
      const it = P.q[cat][0];
      if (it && it.prog >= 1) {
        const d = BUILDINGS[it.kind];
        const toward = cat === 'def' ? 0.42 : d.well ? 0 : 0.12;
        let ax = R.lerp(b[0], foe[0], toward), ay = R.lerp(b[1], foe[1], toward);
        if (it.kind === 'refinery') {
          // Beside the ore, so the run stays short.
          let best = null, bd = 1e9;
          for (const f of S.map.oreFields) {
            const dd = Math.hypot(f.x - b[0], f.y - b[1]) + S.ents.filter(e => e.b && e.kind === 'refinery' && e.team === me.team && Math.hypot(e.x - f.x, e.y - f.y) < 12).length * 30;
            if (dd < bd && S.terr[R.cellOf(f.x, f.y)] === me.team) { bd = dd; best = f; }
          }
          if (best) { ax = R.lerp(best.x, b[0], 0.3); ay = R.lerp(best.y, b[1], 0.3); }
        }
        if (it.kind === 'fob') { ax = R.lerp(b[0], foe[0], 0.3); ay = R.lerp(b[1], foe[1], 0.3); }
        me.dockT = 0;
        const spot = it.kind === 'dock' ? dockSpot(S, me) : R.spotFor(S, me.team, it.kind, ax, ay, 26, me.rand);
        if (spot) R.push(S, me.team, { c: 'place', kind: it.kind, x: spot[0], y: spot[1] });
        else R.push(S, me.team, { c: 'cancel', cat, i: 0 });
      }
    }
    if (q.length) return;
    const margin = P.prod - P.use, pref = [];
    if (margin < 40) pref.push('power');
    if (!has(P, 'refinery')) pref.push('refinery');
    if (!has(P, 'barracks')) pref.push('barracks');
    if (!has(P, 'factory')) pref.push('factory');
    if (has(P, 'refinery') < 2) pref.push('refinery');
    const reachWell = S.map.wells.some(w => R.fits(S, me.team, 'derrick', w.x - 1, w.y - 1));
    if (reachWell && has(P, 'derrick') < 4) pref.push('derrick');
    if (!has(P, 'radar')) pref.push('radar');
    if (opened(P, BUILDINGS.airfield) && !has(P, 'airfield')) pref.push('airfield');
    if (opened(P, BUILDINGS.fob) && !has(P, 'fob') && me.level !== 'recruit') pref.push('fob');
    if (opened(P, BUILDINGS.silo) && !has(P, 'silo') && D_silo(me)) pref.push('silo');
    // An AI Data Center once the side is rich, with the power for it built first.
    if (opened(P, BUILDINGS.datacenter) && !has(P, 'datacenter') && has(P, 'radar') && P.supply > 3000) pref.push(margin >= 110 ? 'datacenter' : 'power');
    if (has(P, 'factory') < 2 && P.supply > 3000) pref.push('factory');
    if (has(P, 'refinery') < 3 && P.supply > 2500) pref.push('refinery');
    if ((S.map.fish || []).length && S.map.seaCells > 300 && !has(P, 'dock') && has(P, 'factory') && P.supply > 800 && dockSpot(S, me)) pref.push('dock');
    for (const k of pref) if (!R.blockedReason(S, me.team, k)) { R.push(S, me.team, { c: 'build', kind: k }); return; }
  }
  const D_silo = me => me.D.silo;

  function defendNext(S, me, P) {
    if (P.q.def.length) return;
    const m = (S.tick - Math.max(0, me.startTick)) / HZ / 60;
    const n = (has(P, 'bunker') + has(P, 'atgun') + has(P, 'sam') + has(P, 'rail'));
    // A rich commander puts up two thirds as many defences again, so that its bank goes into holding home.
    const want = Math.min(me.D.def + (P.supply > 2500 ? me.D.def * 2 / 3 | 0 : 0), (m / 2.5 | 0));
    if (n >= want || P.supply < 900) return;
    const opts = ['bunker', 'atgun', 'atgun', 'bunker'];
    if (opened(P, BUILDINGS.sam)) opts.push('sam');
    if (opened(P, BUILDINGS.rail)) opts.push('rail');
    const k = opts[n % opts.length];
    // Before the Industrial Age there is no power to run short of.
    if (!R.blockedReason(S, me.team, k) && (P.tech < R.POWER_AGE || P.prod - P.use > -BUILDINGS[k].power)) R.push(S, me.team, { c: 'build', kind: k });
  }

  // The vehicle lines built in each age, the main line most, in the forms the age has. The Modern Age keeps the
  // mix it was tuned with.
  const VEH_MIX = [null,
    ['mount', 'heavy', 'mount', 'siege', 'rec', 'sup'],
    ['mount', 'heavy', 'mount', 'siege', 'rec', 'sup'],
    ['mount', 'siege', 'mount', 'heavy', 'rec', 'sup'],
    ['mount', 'ifv', 'heavy', 'siege', 'mount', 'aa', 'sup'],
    ['mount', 'siege', 'mount', 'heavy', 'aa', 'ifv'],
    ['mount', 'siege', 'heavy', 'ifv', 'mount', 'aa', 'sup'],
  ];
  // The dearest lines, which a rich commander buys first so that its bank goes into the field.
  const RICH = ['heavy', 'siege', 'mount'];
  const INF_MIX = ['inf', 'at', 'inf', 'at', 'inf', 'snp'], AIR_MIX = ['heli', 'fpv', 'fpv', 'jet'];
  // The share of its spending each queue should have, with an air arm and without. The queue furthest below its
  // share buys at its gate, and the others wait for AHEAD more, so the cheap barracks does not starve the rest.
  const SHARE = { inf: 0.4, veh: 0.45, air: 0.15 }, SHARE_GROUND = { inf: 0.45, veh: 0.55, air: 0 };
  const GATE = { inf: 300, veh: 600, air: 700 }, AHEAD = 700;

  function trainNext(S, me, P) {
    const trucks = R.lineCount(P, 'truck'), refs = has(P, 'refinery');
    const m = (S.tick - Math.max(0, me.startTick)) / HZ / 60;
    // A cap on the army, and a pause in spending while saving for the next tech level.
    const count = S.ents.reduce((n, e) => n + (e.team === me.team && !e.b ? 1 : 0), 0);
    // An easier commander's army grows no faster than ramp allows, units at the start and per minute.
    if (count >= Math.min(90, me.D.ramp ? me.D.ramp[0] + me.D.ramp[1] * m : 90)) return;
    const lv = P.tech + 1, saving = lv <= me.D.maxAge && !P.q.tech.length && m >= ageTime(S, me, P);
    if (saving && trucks >= refs && P.supply < TECH[lv].cost + 500 && count > 12) return;
    // What each queue has in the field and in hand, by worth, against its share.
    const held = { inf: 0, veh: 0, air: 0 };
    for (const e of S.ents) if (e.team === me.team && !e.b && !e.d.cargo) held[e.d.cat] += R.worth(e.d);
    for (const c in held) for (const it of P.q[c]) held[c] += R.worth(UNITS[it.kind]);
    const air = has(P, 'airfield') ? forms(P, AIR_MIX) : [], share = air.length ? SHARE : SHARE_GROUND;
    const total = held.inf + held.veh + held.air + 1, under = c => held[c] / total - share[c];
    const behind = ['inf', 'veh', 'air'].filter(c => share[c] > 0).sort((a, b) => under(a) - under(b))[0];
    const ready = c => P.supply > GATE[c] + (c === behind ? 0 : AHEAD);
    const buy = k => R.push(S, me.team, { c: 'train', kind: k });
    // A unit queued for each building that trains it, as each trains its own at once, and two at least.
    if (has(P, 'factory') && P.q.veh.length < Math.max(2, P.counts.factory || 0)) {
      const truck = R.formOf('truck', P.tech);
      // Caravans once there are two posts to run between, a few more for a stronger commander.
      const trade = R.formOf('trade', P.tech), posts = 1 + S.towns.filter(t => t.owner === me.team).length, want = me.level === 'veteran' ? 4 : me.level === 'regular' ? 3 : 2;
      if (trucks < Math.min(refs * 2, 6) && !queuedIn(P, 'veh', truck)) R.push(S, me.team, { c: 'train', kind: truck });
      else if (trade && posts >= 2 && R.lineCount(P, 'trade') < want && !queuedIn(P, 'veh', trade) && P.supply > 500) R.push(S, me.team, { c: 'train', kind: trade });
      else if (ready('veh')) {
        const mix = forms(P, P.supply > 3000 ? RICH : VEH_MIX[P.tech]);
        const k = mix[me.plan++ % mix.length];
        // Two support vehicles are enough to mend an army.
        if (!(UNITS[k].repair && R.lineCount(P, 'sup') >= 2) && !R.blockedReason(S, me.team, k)) buy(k);
      }
    }
    if (has(P, 'barracks') && P.q.inf.length < Math.max(2, P.counts.barracks || 0) && ready('inf')) {
      const mix = forms(P, INF_MIX);
      buy(mix[(me.plan * 3 + (m | 0)) % mix.length]);
    }
    if (air.length && P.q.air.length < Math.max(1, P.counts.airfield || 0) && ready('air')) buy(air[me.plan % air.length]);
    // At a dock: fishing boats for the shoals, then warships, a few more as the army grows.
    if (has(P, 'dock') && P.q.sea.length < Math.max(2, P.counts.dock || 0)) {
      const boat = R.formOf('fish', P.tech), ship = R.formOf('ship', P.tech), shoals = (S.map.fish || []).length;
      if (boat && shoals && R.lineCount(P, 'fish') < Math.min(3, shoals) && P.supply > 300) buy(boat);
      else if (ship && R.lineCount(P, 'ship') < Math.min(6, 1 + count / 10 | 0) && P.supply > 700 && !R.blockedReason(S, me.team, ship)) buy(ship);
    }
  }
  // Where a dock might go: a spot inside the border by the open water nearest home, looked for again now and then.
  function dockSpot(S, me) {
    if (me.dockT && S.tick < me.dockT) return me.dockAt || null;
    me.dockT = S.tick + 30 * HZ; me.dockAt = null;
    const M = S.map, b = S.bases[me.team], W = M.W, cand = [];
    // Water that holds a shoal first, so the dock's boats have somewhere to fish.
    for (let c = 0; c < W * M.H; c += 2) if (M.sea[c]) cand.push([Math.hypot(c % W - b[0], (c / W | 0) - b[1]) + (R.fishWater(S, c % W, c / W | 0) ? 0 : 1e4), c % W, c / W | 0]);
    cand.sort((p, q) => p[0] - q[0]);
    for (const [, x, y] of cand.slice(0, 60)) {
      const spot = R.spotFor(S, me.team, 'dock', x, y, 9, me.rand);
      if (spot) { me.dockAt = spot; break; }
    }
    return me.dockAt;
  }

  // The minute of the game a commander reaches for its next age, counted from the age the game began in. A game
  // begun in a later age stays longer in it, a quarter of an age's time for each age it skipped.
  const ageTime = (S, me, P) => { const a0 = S.age0 || 1; return me.D.ageEvery * (P.tech - a0 + 1 + (a0 - 1) / 4); };

  function research(S, me, P) {
    if (P.tech >= me.D.maxAge || P.q.tech.length) return;
    const d = TECH[P.tech + 1], m = (S.tick - Math.max(0, me.startTick)) / HZ / 60, due = ageTime(S, me, P);
    // A level with `rich` reaches for an age up to half an age's time early when it has that much more than it costs.
    if (m < due && !(me.D.rich && m >= due - me.D.ageEvery / 2 && P.supply > d.cost + me.D.rich)) return;
    if (P.supply > d.cost + 400 && P.oil >= d.oil * 0.8) R.push(S, me.team, { c: 'research' });
  }

  // Upgrades, one at a time, when there is supply to spare: the first `ups` lines of this order, each tier as its
  // age opens it.
  const UP_ORDER = ['carts', 'drill', 'plate', 'hard', 'range', 'border', 'relay'];
  function upgrades(S, me, P) {
    const n = me.D.ups || 0;
    if (!n || S.ents.some(e => e.b && e.team === me.team && e.up)) return;
    for (const k of UP_ORDER.slice(0, n)) {
      const at = S.ents.find(e => e.b && e.team === me.team && e.hp > 0 && !e.up && R.upsAt(e.kind).includes(k));
      if (!at || R.upBlocked(S, me.team, k, at)) continue;
      const d = R.upCost(k, (P.up[k] || 0) + 1);
      if (P.supply < d.cost + 1500 || P.oil < d.oil + 150) return;
      R.push(S, me.team, { c: 'upgrade', id: at.id, k });
      return;
    }
  }

  function towns(S, me, army) {
    const rifles = army.filter(u => u.d.capture && (!u.ord || u.ord.t === 'capture'));
    if (!rifles.length) return army;
    const b = S.bases[me.team];
    // The nearest first, a town that pays more counting as nearer.
    const cost = t => Math.hypot(t.x - b[0], t.y - b[1]) / (0.5 + 0.5 * R.townShare(S, t.id));
    const open = S.towns.filter(t => t.owner !== me.team && (t.capTeam !== me.team)).sort((p, q) => cost(p) - cost(q));
    const busy = new Set();
    for (const u of rifles) if (u.ord && u.ord.t === 'capture') busy.add(u.id);
    const free = rifles.filter(u => !busy.has(u.id));
    let i = 0;
    for (const t of open.slice(0, 2)) {
      const already = rifles.filter(u => u.ord && u.ord.t === 'capture' && u.ord.town === t.id).length;
      if (already || !free[i]) continue;
      const take = free.slice(i, i + 2).map(u => u.id);
      i += 2;
      if (take.length) R.push(S, me.team, { c: 'capture', ids: take, town: t.id });
    }
    return army.filter(u => !busy.has(u.id));
  }

  // Cover. Infantry sent to hold a place take its free cover points, nearest the place first, among those that
  // face the threat. Each squad gets its own order, which the rules settle on the point. Says who was placed.
  const COVER_FACE = 1.4;
  function toCover(S, me, squads, x, y, tx, ty, r, most) {
    if (!squads.length || most <= 0) return [];
    const pts = R.coverPoints(S.map), taken = new Set();
    for (const e of S.ents) if (e.team === me.team && !e.b && e.hp > 0 && e.d.men) { if (e.cov >= 0) taken.add(e.cov); if (e.ord && e.ord.cov >= 0) taken.add(e.ord.cov); }
    const open = [];
    pts.forEach((p, i) => {
      if (taken.has(i)) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > r || (p.kind !== 'crest' && Math.abs(R.angleTo(p.dir, Math.atan2(ty - p.y, tx - p.x))) > COVER_FACE)) return;
      open.push([d, i]);
    });
    open.sort((p, q) => p[0] - q[0]);
    const left = squads.slice(), placed = [];
    for (const [, i] of open) {
      if (!left.length || placed.length >= most) break;
      const p = pts[i];
      let bi = 0, bd = Infinity;
      left.forEach((u, k) => { const d = Math.hypot(u.x - p.x, u.y - p.y); if (d < bd) { bd = d; bi = k; } });
      const u = left.splice(bi, 1)[0];
      R.push(S, me.team, { c: 'move', ids: [u.id], x: p.x, y: p.y });
      placed.push(u);
    }
    return placed;
  }
  // Where the threat to a place is: the middle of the enemies seen near it, else the foe's base.
  function threatAt(S, me, x, y) {
    let n = 0, sx = 0, sy = 0;
    for (const e of S.ents) if (e.team !== me.team && !e.b && e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 18 && R.seenBy(S, me.team, e) && !R.shielded(S, e.team)) { n++; sx += e.x; sy += e.y; }
    if (n) return [sx / n, sy / n];
    const foe = foeOf(S, me);
    return foe >= 0 ? S.bases[foe] : [S.map.W / 2, S.map.H / 2];
  }
  // A town on the commander's own side of the field, nearer its base than the foe's.
  function homeTown(S, me, t) {
    const b = S.bases[me.team], foe = foeOf(S, me), fb = foe >= 0 ? S.bases[foe] : [S.map.W / 2, S.map.H / 2];
    return Math.hypot(t.x - b[0], t.y - b[1]) < Math.hypot(t.x - fb[0], t.y - fb[1]);
  }
  // After a capture a rifle squad stays at a home town, in cover facing the enemy, and is left out of the army.
  // Towns on the enemy's side are not held, since a squad left there is only lost to the next wave.
  const GARRISON = 1;
  function garrison(S, me, army) {
    const foe = foeOf(S, me), fb = foe >= 0 ? S.bases[foe] : [S.map.W / 2, S.map.H / 2], keep = new Set();
    for (const t of S.towns) {
      if (t.owner !== me.team || !homeTown(S, me, t)) continue;
      const here = army.filter(u => u.d.capture && Math.hypot(u.x - t.x, u.y - t.y) < 12);
      const held = here.filter(u => u.cov >= 0 || (u.ord && u.ord.cov >= 0)).slice(0, GARRISON);
      for (const u of held) keep.add(u.id);
      const idle = here.filter(u => !keep.has(u.id) && !u.ord && !u.tgt);
      for (const u of toCover(S, me, idle, t.x, t.y, fb[0], fb[1], 9, GARRISON - held.length)) keep.add(u.id);
    }
    me.garrisoned = keep.size;
    return keep.size ? army.filter(u => !keep.has(u.id)) : army;
  }
  // A home town of its own being taken draws the idle infantry near it into cover facing the attackers.
  function defendTowns(S, me, fight) {
    for (const t of S.towns) {
      if (t.owner !== me.team || t.capTeam < 0 || t.capTeam === me.team || !(t.cap > 0) || !homeTown(S, me, t)) continue;
      const dt = u => Math.hypot(u.x - t.x, u.y - t.y);
      const idle = fight.filter(u => u.d.men && !u.ord && !u.tgt && dt(u) < 40 && !(u.cov >= 0 && dt(u) < 12));
      const [tx, ty] = threatAt(S, me, t.x, t.y);
      toCover(S, me, idle, t.x, t.y, tx, ty, 10, 3);
    }
  }
  // Enemies seen at a bridge near home draw a squad to the bridge's end on its own side.
  function defendBridges(S, me, fight) {
    const b = S.bases[me.team];
    S.map.bridges.forEach((m, i) => {
      if (S.bridges[i].hp <= 0) return;
      const mx = (m.x0 + m.x1) / 2, my = (m.y0 + m.y1) / 2;
      if (Math.hypot(mx - b[0], my - b[1]) > 60) return;
      if (!S.ents.some(e => e.team !== me.team && !e.b && e.hp > 0 && !R.isAir(e) && Math.hypot(e.x - mx, e.y - my) < 14 && R.seenBy(S, me.team, e) && !R.shielded(S, e.team))) return;
      const home = Math.hypot(m.x0 - b[0], m.y0 - b[1]) < Math.hypot(m.x1 - b[0], m.y1 - b[1]);
      const end = home ? [m.x0 - m.ux * 2.2, m.y0 - m.uy * 2.2] : [m.x1 + m.ux * 2.2, m.y1 + m.uy * 2.2];
      const de = u => Math.hypot(u.x - end[0], u.y - end[1]);
      const idle = fight.filter(u => u.d.men && !u.ord && !u.tgt && de(u) < 40 && !(u.cov >= 0 && de(u) < 3));
      toCover(S, me, idle, end[0], end[1], mx, my, 3, 1);
    });
  }

  // The nearest thing of the enemy's worth going to. Its base if nothing is closer.
  function pickTarget(S, me) {
    const foe = foeOf(S, me);
    if (foe < 0) return null;
    const b = S.bases[me.team], all = S.P[foe].exposed;
    let best = null, bd = 1e9;
    for (const t of S.towns) if (t.owner === foe) {
      const d = Math.hypot(t.x - b[0], t.y - b[1]);
      if (d < bd) { bd = d; best = [t.x, t.y]; }
    }
    for (const e of S.ents) if (e.b && e.team === foe && (all || S.P[me.team].seen[R.cellOf(e.x, e.y)])) {
      const d = Math.hypot(e.x - b[0], e.y - b[1]);
      if (d < bd) { bd = d; best = [e.x, e.y]; }
    }
    return best || S.bases[foe];
  }

  function powers(S, me, P) {
    // By night a commander lights the ground ahead of its army with a flare now and then.
    if (R.nightAt(S.tick) > 0.6 && (P.cooldown.flare || 0) <= 0 && P.supply > 300 && me.rand() < 0.02) {
      const army = S.ents.filter(e => e.team === me.team && !e.b && e.hp > 0 && R.armed(e)), foe = foeOf(S, me);
      if (army.length >= 4 && foe >= 0) {
        const cx = army.reduce((a, e) => a + e.x, 0) / army.length, cy = army.reduce((a, e) => a + e.y, 0) / army.length, t = S.bases[foe], d = Math.hypot(t[0] - cx, t[1] - cy) || 1;
        R.push(S, me.team, { c: 'power', name: 'flare', x: cx + (t[0] - cx) / d * 8, y: cy + (t[1] - cy) / d * 8 });
      }
    }
    if (!me.D.power || !has(P, 'radar') || S.tick - me.lastPower < me.D.gap * HZ) return;
    // An easier commander calls no powers before it can call a barrage.
    if (me.level !== 'veteran' && !opened(P, POWERS.barrage)) return;
    // A strike goes where the most of the other side has been seen together. A shielded commander, a
    // newcomer's slot, makes no strike, since any would end its own shield.
    const foes = S.ents.filter(e => e.team !== me.team && R.seenBy(S, me.team, e) && !((S.P[e.team].shield || 0) > S.tick));
    if (foes.length && !R.shielded(S, me.team)) {
      let best = null, top = 0;
      for (const f of foes) {
        let n = 0;
        for (const o of foes) if (Math.hypot(o.x - f.x, o.y - f.y) < 6) n += o.b ? 2 : 1;
        if (n > top) { top = n; best = f; }
      }
      if (best && top >= 5) {
        if (P.silo !== undefined) {
          const silo = S.ents.find(e => e.b && e.team === me.team && e.kind === 'silo' && e.charge >= e.d.charge);
          if (silo && top >= 7) { R.push(S, me.team, { c: 'launch', x: best.x, y: best.y }); me.lastPower = S.tick; return; }
        }
        if (opened(P, POWERS.barrage) && P.cooldown.barrage <= 0 && P.supply > 800) {
          R.push(S, me.team, { c: 'power', name: 'barrage', x: best.x, y: best.y }); me.lastPower = S.tick; return;
        }
      }
    }
    // A satellite constellation once rich, its first pass over the enemy's base.
    if (POWERS.sat && opened(P, POWERS.sat) && !(P.cooldown.sat > 0) && !P.sat && P.counts.radar && P.supply > 4000) {
      const foe = foeOf(S, me);
      if (foe >= 0) { const t = S.bases[foe]; R.push(S, me.team, { c: 'power', name: 'sat', x: t[0], y: t[1] }); me.lastPower = S.tick; return; }
    }
    if (opened(P, POWERS.uav) && P.cooldown.uav <= 0 && P.supply > 1200) {
      const foe = foeOf(S, me);
      if (foe < 0) return;
      // The recon aircraft can be shot down, so of a few places about the enemy's base it takes the one with the
      // least anti-air fire it knows of, and none if every one is ringed.
      const t = S.bases[foe];
      let best = null, low = Infinity;
      for (let k = 0; k < 4; k++) {
        const a = me.rand() * 6.28, r = 6 + me.rand() * 18, x = t[0] + Math.cos(a) * r, y = t[1] + Math.sin(a) * r;
        let fire = 0;
        for (const e of S.ents) {
          if (e.team !== foe || e.hp <= 0 || !e.d.weapons || Math.hypot(e.x - x, e.y - y) > 20 || (!e.b && !R.seenBy(S, me.team, e))) continue;
          for (const wn of e.d.weapons) { const w = R.WEAPONS[wn]; if (w && w.air) fire += w.dmg * (w.vs.air ?? 1) / w.cd; }
        }
        if (fire < low) { low = fire; best = [x, y]; }
      }
      me.lastPower = S.tick;
      if (best && low < 45) R.push(S, me.team, { c: 'power', name: 'uav', x: best[0], y: best[1] });
    }
  }

  // A bridge near home that is down, badly hurt or carrying C4 gets an engineer, trained for it if need be.
  function bridges(S, me, P) {
    if (S.tick < (me.mendT || 0)) return;
    me.mendT = S.tick + 10 * HZ;
    const b = S.bases[me.team];
    let best = -1, bd = 70;
    S.bridges.forEach((st, i) => {
      if (st.fix || (st.hp > R.BRIDGE_HP * 0.5 && !st.c4)) return;
      const m = S.map.bridges[i], mx = (m.x0 + m.x1) / 2, my = (m.y0 + m.y1) / 2, d = Math.hypot(mx - b[0], my - b[1]);
      if (d < bd && P.seen[R.cellOf(mx, my)]) { bd = d; best = i; }
    });
    if (best < 0) return;
    const engs = S.ents.filter(e => e.team === me.team && e.hp > 0 && e.d.engineer);
    if (engs.some(e => e.ord && e.ord.t === 'mend' && e.ord.i === best)) return;
    const free = engs.find(e => !(e.ord && e.ord.t === 'mend'));
    if (free) R.push(S, me.team, { c: 'mend', ids: [free.id], i: best });
    else if (has(P, 'barracks') && P.supply > 700 && !queuedIn(P, 'inf', 'engineer')) R.push(S, me.team, { c: 'train', kind: 'engineer' });
  }

  function repairs(S, me) {
    for (const e of S.ents) if (e.b && e.team === me.team && e.hp < e.max * 0.6 && !e.repairing && S.P[me.team].supply > 500) {
      R.push(S, me.team, { c: 'repair', id: e.id });
      return;
    }
  }

  function think(S, me) {
    const P = S.P[me.team], team = me.team;
    // Its clock runs from when it took the slot, so a base that starts late builds up like a new one.
    if (me.startTick < 0) me.startTick = S.tick;
    // The level's income goes through a command, so every copy of the world has it.
    if (P.income !== me.D.income) R.push(S, team, { c: 'income', v: me.D.income });
    buildNext(S, me, P);
    defendNext(S, me, P);
    research(S, me, P);
    upgrades(S, me, P);
    trainNext(S, me, P);
    repairs(S, me);
    bridges(S, me, P);
    powers(S, me, P);

    let army = S.ents.filter(e => e.team === team && !e.b && !e.d.cargo && !e.d.repair && !e.d.engineer && !e.d.trade && !e.d.fish && !e.d.general && e.drop <= 0);
    army = garrison(S, me, army);
    army = towns(S, me, army);
    const fight = army.filter(u => !(u.ord && u.ord.t === 'capture') && u.d.move !== 'jet');
    const strength = fight.reduce((a, u) => a + value(u), 0);
    const foeTeam = foeOf(S, me), b = S.bases[team], foe = foeTeam >= 0 ? S.bases[foeTeam] : [S.map.W / 2, S.map.H / 2], m = (S.tick - me.startTick) / HZ;

    // Trouble at home calls everyone back. Infantry go to cover round the building, facing the attackers, and
    // the rest straight at them.
    let trouble = null;
    for (const e of S.ents) if (e.team === team && e.b && S.tick - e.under < 3 * HZ && e.under) { trouble = e; break; }
    if (trouble) {
      const far = u => Math.hypot(u.x - trouble.x, u.y - trouble.y) > 10;
      const called = fight.filter(u => !u.tgt && !(u.ord && u.ord.cov >= 0) && (far(u) || (u.d.men && !u.ord && u.cov < 0))).slice(0, 10 * me.D.apm);
      const [tx, ty] = threatAt(S, me, trouble.x, trouble.y);
      const held = new Set(toCover(S, me, called.filter(u => u.d.men), trouble.x, trouble.y, tx, ty, 10, 10 * me.D.apm).map(u => u.id));
      const ids = called.filter(u => !held.has(u.id) && far(u)).map(u => u.id);
      if (ids.length) R.push(S, team, { c: 'move', ids, x: trouble.x, y: trouble.y, a: true });
    }
    defendTowns(S, me, fight);
    defendBridges(S, me, fight);

    // With more than one foe a wave is the army that set out, and what is built meanwhile guards home, so no
    // side streams everything into one war while a second neighbour walks in. Against one foe it presses on
    // with every unit.
    // A level's `pulse` overrides that choice.
    const wave = me.waveIds ? fight.filter(u => me.waveIds.includes(u.id)) : fight;
    const guard = me.waveIds ? fight.filter(u => !me.waveIds.includes(u.id)) : [];
    if (me.state === 'attack') {
      // A wave is measured by what it has on land: ships cannot take a town, so a few left afloat do not hold a
      // spent wave open.
      const ws = wave.reduce((a, u) => a + (u.d.move === 'naval' ? 0 : value(u)), 0);
      // A wave ends when it has lost most of its worth, or when its raid time is up at a level that has one.
      if (ws < me.startStrength * 0.3 || !wave.length || (me.D.raid && S.tick >= me.attackUntil)) {
        me.state = 'build'; me.waves++; me.waveIds = null;
        const ids = wave.map(u => u.id);
        if (ids.length) R.push(S, team, { c: 'move', ids, x: me.gather[0], y: me.gather[1] });
      } else if (S.tick >= me.attackT) {
        me.attackT = S.tick + 12 * HZ;
        me.target = pickTarget(S, me);
        if (!me.target) { me.state = 'build'; me.waveIds = null; return; }
        const ids = wave.filter(u => !u.tgt).map(u => u.id);
        if (ids.length) R.push(S, team, { c: 'move', ids, x: me.target[0], y: me.target[1], a: true });
      }
      gatherAt(S, me, guard, foe);
      return;
    }
    me.gather = [R.lerp(b[0], foe[0], 0.22), R.lerp(b[1], foe[1], 0.22)];
    gatherAt(S, me, fight, foe);
    const need = me.D.wave + me.D.grow * me.waves;
    // A keeper holds a player's base while they are away and never sets out.
    if (me.D.stay || foeTeam < 0) return;
    if (m >= me.D.delay && strength >= need) {
      me.state = 'attack'; me.startStrength = fight.reduce((a, u) => a + (u.d.move === 'naval' ? 0 : value(u)), 0); me.attackT = S.tick; me.attackUntil = S.tick + (me.D.raid || 0) * HZ;
      me.waveIds = (me.D.pulse !== undefined ? me.D.pulse : (S.seats || S.P).length > 2) ? fight.map(u => u.id) : null;
      S.ev.push({ t: 'wave', team, n: me.waves + 1 });
    }
  }

  // Idle units gather at the rally point now and then. Infantry wait in cover round it, facing the enemy,
  // and the rest in the open.
  function gatherAt(S, me, units, foe) {
    if (S.tick % (8 * HZ) >= me.D.think * HZ) return;
    const dg = u => Math.hypot(u.x - me.gather[0], u.y - me.gather[1]);
    const idle = units.filter(u => !u.ord && !u.tgt && (dg(u) > 8 || (u.d.men && u.cov < 0)) && !(u.cov >= 0 && dg(u) < 16));
    const held = new Set(toCover(S, me, idle.filter(u => u.d.men), me.gather[0], me.gather[1], foe[0], foe[1], 12, 10 * me.D.apm).map(u => u.id));
    const ids = idle.filter(u => !held.has(u.id) && dg(u) > 8).map(u => u.id);
    if (ids.length) R.push(S, me.team, { c: 'move', ids, x: me.gather[0], y: me.gather[1], a: true });
  }

  // What a commander remembers, for a saved game: its plain fields and where its dice stand.
  function save(me) {
    const o = {};
    for (const k in me) if (k !== 'D' && k !== 'rand' && k !== 'tick') o[k] = me[k];
    o.rand = me.rand.state();
    return o;
  }
  function load(o) {
    const me = create(o.team, o.level), rand = me.rand;
    Object.assign(me, o);
    me.rand = rand; rand.seed(o.rand);
    return me;
  }
  return { create, save, load };
})();
if (typeof module !== 'undefined') module.exports = AI;
