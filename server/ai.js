// Dead Ground, the enemy commander. It sends the same commands a player can, on a clock set by its
// difficulty. It may only act on what it has seen, except that it knows where the other bases are. In
// the world it fights whichever living neighbour is nearest, counting people's bases as further off, and
// leaves alone a newcomer still shielded.
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
  const queuedIn = (P, cat, kind) => P.q[cat].filter(i => i.kind === kind).length;
  const value = u => u.d.cost + (u.d.oil || 0) * 3;
  // The enemy to fight: the nearest living base that is not shielded. Looked at again now and then.
  function foeOf(S, me) {
    if (S.tick < me.foeT && me.foe >= 0 && S.P[me.foe].alive !== false) return me.foe;
    me.foeT = S.tick + 30 * HZ;
    const b = S.bases[me.team];
    let best = -1, bd = Infinity;
    for (const P of S.P) {
      if (P.team === me.team || P.alive === false || (P.shield || 0) > S.tick) continue;
      // A person's base counts as half again as far, so computers mostly fight each other.
      const f = S.bases[P.team], d = Math.hypot(f[0] - b[0], f[1] - b[1]) * (me.people && me.people.has(P.team) ? 1.6 : 1);
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
        const spot = R.spotFor(S, me.team, it.kind, ax, ay, 26, me.rand);
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
    if (P.tech >= 2 && !has(P, 'airfield')) pref.push('airfield');
    if (P.tech >= 2 && !has(P, 'fob') && me.level !== 'recruit') pref.push('fob');
    if (P.tech >= 3 && !has(P, 'silo') && D_silo(me)) pref.push('silo');
    if (has(P, 'factory') < 2 && P.supply > 3000) pref.push('factory');
    if (has(P, 'refinery') < 3 && P.supply > 2500) pref.push('refinery');
    for (const k of pref) if (!R.blockedReason(S, me.team, k)) { R.push(S, me.team, { c: 'build', kind: k }); return; }
  }
  const D_silo = me => me.D.silo;

  function defendNext(S, me, P) {
    if (P.q.def.length) return;
    const m = (S.tick - Math.max(0, me.startTick)) / HZ / 60;
    const n = (has(P, 'bunker') + has(P, 'atgun') + has(P, 'sam') + has(P, 'rail'));
    const want = Math.min(me.D.def, (m / 2.5 | 0));
    if (n >= want || P.supply < 900) return;
    const opts = ['bunker', 'atgun', 'atgun', 'bunker'];
    if (P.tech >= 2) opts.push('sam');
    if (P.tech >= 3) opts.push('rail');
    const k = opts[n % opts.length];
    if (!R.blockedReason(S, me.team, k) && P.prod - P.use > -BUILDINGS[k].power) R.push(S, me.team, { c: 'build', kind: k });
  }

  function trainNext(S, me, P) {
    const trucks = has(P, 'truck'), refs = has(P, 'refinery');
    const m = (S.tick - Math.max(0, me.startTick)) / HZ / 60;
    // A cap on the army, and a pause in spending while saving for the next tech level.
    const count = S.ents.reduce((n, e) => n + (e.team === me.team && !e.b ? 1 : 0), 0);
    // An easier commander's army grows no faster than ramp allows, units at the start and per minute.
    if (count >= Math.min(90, me.D.ramp ? me.D.ramp[0] + me.D.ramp[1] * m : 90)) return;
    const lv = P.tech + 1, saving = lv <= me.D.tech && !P.q.tech.length && m >= techTime(me, P.tech);
    if (saving && trucks >= refs && P.supply < TECH[lv].cost + 500 && count > 12) return;
    if (has(P, 'factory') && P.q.veh.length < 2) {
      if (trucks < Math.min(refs * 2, 6) && !queuedIn(P, 'veh', 'truck')) R.push(S, me.team, { c: 'train', kind: 'truck' });
      else if (P.supply > 700) {
        const mix = P.tech >= 3 ? ['tank', 'mlrs', 'tank', 'heavy', 'flak', 'ifv'] : P.tech >= 2 ? ['tank', 'ifv', 'tank', 'flak', 'support'] : ['ifv', 'humvee', 'ifv'];
        const k = mix[me.plan++ % mix.length];
        if (!R.blockedReason(S, me.team, k)) R.push(S, me.team, { c: 'train', kind: k });
      }
    }
    if (has(P, 'barracks') && P.q.inf.length < 2 && P.supply > 300) {
      const mix = ['rifle', 'rocket', 'rifle', 'rocket', 'rifle'];
      if (P.tech >= 2) mix.push('sniper');
      R.push(S, me.team, { c: 'train', kind: mix[(me.plan * 3 + (m | 0)) % mix.length] });
    }
    if (has(P, 'airfield') && P.q.air.length < 1 && P.supply > 1500) {
      const opts = P.tech >= 3 ? ['heli', 'fpv', 'fpv', 'jet'] : ['heli', 'fpv', 'fpv'];
      R.push(S, me.team, { c: 'train', kind: opts[me.plan % opts.length] });
    }
  }

  const techTime = (me, tech) => tech === 1 ? me.D.tech1 : me.D.tech2;

  function research(S, me, P) {
    if (P.tech >= me.D.tech || P.q.tech.length) return;
    const d = TECH[P.tech + 1], m = (S.tick - Math.max(0, me.startTick)) / HZ / 60;
    if (m < techTime(me, P.tech)) return;
    if (P.supply > d.cost + 400 && P.oil >= d.oil * 0.8) R.push(S, me.team, { c: 'research' });
  }

  function towns(S, me, army) {
    const rifles = army.filter(u => u.d.capture && (!u.ord || u.ord.t === 'capture'));
    if (!rifles.length) return army;
    const b = S.bases[me.team];
    const open = S.towns.filter(t => t.owner !== me.team && (t.capTeam !== me.team)).sort((p, q) => Math.hypot(p.x - b[0], p.y - b[1]) - Math.hypot(q.x - b[0], q.y - b[1]));
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
    if (!me.D.power || !has(P, 'radar') || S.tick - me.lastPower < me.D.gap * HZ) return;
    // An easier commander calls no powers before Tech II.
    if (me.level !== 'veteran' && P.tech < 2) return;
    // A strike goes where the most of the other side has been seen together.
    const foes = S.ents.filter(e => e.team !== me.team && R.seenBy(S, me.team, e) && !((S.P[e.team].shield || 0) > S.tick));
    if (foes.length) {
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
        if (P.tech >= 2 && P.cooldown.barrage <= 0 && P.supply > 800) {
          R.push(S, me.team, { c: 'power', name: 'barrage', x: best.x, y: best.y }); me.lastPower = S.tick; return;
        }
      }
    }
    if (P.cooldown.uav <= 0 && P.supply > 1200) {
      const foe = foeOf(S, me);
      if (foe < 0) return;
      const t = S.bases[foe], a = me.rand() * 6.28, r = 6 + me.rand() * 18;
      R.push(S, me.team, { c: 'power', name: 'uav', x: t[0] + Math.cos(a) * r, y: t[1] + Math.sin(a) * r });
      me.lastPower = S.tick;
    }
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
    trainNext(S, me, P);
    repairs(S, me);
    powers(S, me, P);

    let army = S.ents.filter(e => e.team === team && !e.b && !e.d.cargo && !e.d.repair && !e.d.engineer && e.drop <= 0);
    army = towns(S, me, army);
    const fight = army.filter(u => !(u.ord && u.ord.t === 'capture') && u.d.move !== 'jet');
    const strength = fight.reduce((a, u) => a + value(u), 0);
    const foeTeam = foeOf(S, me), b = S.bases[team], foe = foeTeam >= 0 ? S.bases[foeTeam] : [S.map.W / 2, S.map.H / 2], m = (S.tick - me.startTick) / HZ;

    // Trouble at home calls everyone back.
    let trouble = null;
    for (const e of S.ents) if (e.team === team && e.b && S.tick - e.under < 3 * HZ && e.under) { trouble = e; break; }
    if (trouble) {
      const ids = fight.filter(u => !u.tgt && Math.hypot(u.x - trouble.x, u.y - trouble.y) > 10).slice(0, 10 * me.D.apm).map(u => u.id);
      if (ids.length) R.push(S, team, { c: 'move', ids, x: trouble.x, y: trouble.y, a: true });
    }

    if (me.state === 'attack') {
      if (strength < me.startStrength * 0.3 || !fight.length) {
        me.state = 'build'; me.waves++;
        const ids = fight.map(u => u.id);
        if (ids.length) R.push(S, team, { c: 'move', ids, x: me.gather[0], y: me.gather[1] });
      } else if (S.tick >= me.attackT) {
        me.attackT = S.tick + 12 * HZ;
        me.target = pickTarget(S, me);
        if (!me.target) { me.state = 'build'; return; }
        const ids = fight.filter(u => !u.tgt).map(u => u.id);
        if (ids.length) R.push(S, team, { c: 'move', ids, x: me.target[0], y: me.target[1], a: true });
      }
      return;
    }
    me.gather = [R.lerp(b[0], foe[0], 0.22), R.lerp(b[1], foe[1], 0.22)];
    if (S.tick % (8 * HZ) < me.D.think * HZ) {
      const ids = fight.filter(u => !u.ord && !u.tgt && Math.hypot(u.x - me.gather[0], u.y - me.gather[1]) > 8).map(u => u.id);
      if (ids.length) R.push(S, team, { c: 'move', ids, x: me.gather[0], y: me.gather[1], a: true });
    }
    const need = me.D.wave + me.D.grow * me.waves;
    // A keeper holds a player's base while they are away and never sets out.
    if (me.D.stay || foeTeam < 0) return;
    if (m >= me.D.delay && strength >= need) {
      me.state = 'attack'; me.startStrength = strength; me.attackT = S.tick;
      S.ev.push({ t: 'wave', team, n: me.waves + 1 });
    }
  }

  return { create };
})();
if (typeof module !== 'undefined') module.exports = AI;
