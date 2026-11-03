// Dead Ground's shared world: a Cloudflare Worker with one Durable Object. The object steps the world twenty
// times a second while anyone is connected, runs a computer commander in every slot no person holds, and
// sends each step's commands to every player, whose own copy of the rules steps the same world from them.
// A newcomer is sent the whole world once, saved and gzipped, then the steps that follow. Every two seconds
// a check of the world goes out too, and a player whose copy differs asks for the world again.
import R from './rules.js';
import AI from './ai.js';

const HZ = R.HZ, SEED = 4;
// A newcomer's base is left alone by the computers for five minutes. A player away for two hours gives up
// the slot. A computer's fallen base comes back after a minute.
const SHIELD = 300, AWAY = 2 * 3600 * 1000, RESPAWN = 60;
const LEVEL = 'regular';

// The commands a player may send and the fields each takes. 'restart', 'raze' and 'income' are the
// server's own and never come from a player.
const CMDS = {
  move: ['ids', 'x', 'y', 'a'], attack: ['ids', 'id'], strike: ['ids', 'id', 'x', 'y', 'r'], stop: ['ids'], harvest: ['ids', 'cell'],
  capture: ['ids', 'town'], train: ['kind'], build: ['kind'], research: [], hold: ['cat', 'i'], cancel: ['cat', 'i'],
  place: ['kind', 'x', 'y'], sell: ['id'], repair: ['id'], rally: ['id', 'x', 'y'], power: ['name', 'x', 'y'], launch: ['x', 'y'],
};
const CATS = ['bld', 'def', 'inf', 'veh', 'air', 'tech'];
function clean(S, c) {
  if (!c || typeof c !== 'object' || !Object.prototype.hasOwnProperty.call(CMDS, c.c)) return null;
  const o = { c: c.c }, W = S.map.W;
  for (const k of CMDS[c.c]) {
    const v = c[k];
    if (k === 'ids') { if (!Array.isArray(v)) return null; o.ids = v.slice(0, 200).map(n => n | 0); }
    else if (k === 'a') o.a = !!v;
    else if (k === 'kind') { if (typeof v !== 'string' || !(R.UNITS[v] || R.BUILDINGS[v])) return null; o.kind = v; }
    else if (k === 'cat') { if (!CATS.includes(v)) return null; o.cat = v; }
    else if (k === 'name') { if (!R.POWERS[v]) return null; o.name = v; }
    else if (k === 'town') { const t = v | 0; if (t < 0 || t >= S.towns.length) return null; o.town = t; }
    else {
      const n = +v;
      if (!Number.isFinite(n)) return null;
      if (k === 'x' || k === 'y') o[k] = c.c === 'place' ? Math.max(0, Math.min(W - 1, n | 0)) : Math.max(0, Math.min(W, n));
      else if (k === 'r') o.r = Math.max(0, Math.min(12, n));
      else if (k === 'cell') o.cell = n < 0 ? -1 : Math.min(W * W - 1, n | 0);
      else o[k] = n | 0;
    }
  }
  return o;
}
const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 16) || 'Commander';
const cleanId = s => String(s || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);

async function gzip(text) {
  const cs = new CompressionStream('gzip'), w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(text)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip'), w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Response(ds.readable).text();
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' || url.pathname.startsWith('/api/')) return env.WORLD.get(env.WORLD.idFromName('world')).fetch(req);
    return env.ASSETS.fetch(req);
  },
};

export class World {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.socks = new Set(); this.pending = []; this.batch = []; this.hash = null; this.timer = null; this.due = 0; this.saving = false;
    ctx.blockConcurrencyWhile(() => this.restore());
  }

  // The world as last saved, or a new one with a computer in every slot.
  async restore() {
    const meta = await this.ctx.storage.get('meta');
    if (meta) {
      try {
        const parts = await this.ctx.storage.get([...Array(meta.n).keys()].map(i => 'snap' + i));
        const all = new Uint8Array(meta.bytes);
        let at = 0;
        for (let i = 0; i < meta.n; i++) { const p = parts.get('snap' + i); all.set(p, at); at += p.length; }
        this.S = R.load(JSON.parse(await gunzip(all)));
        this.roster = meta.roster;
      } catch (e) { console.log('restore failed, starting a new world', e.message); this.S = null; }
    }
    if (!this.S) {
      this.S = R.newGame({ seed: SEED, layout: 'world' });
      this.roster = this.S.P.map(() => ({ kind: 'ai' }));
    }
    this.S.ev.length = 0;
    this.respawnAt = this.S.P.map(() => 0);
    // Nobody is connected after a restart, so every person's slot is held for them while away.
    this.ais = this.roster.map((r, t) => {
      if (r.kind === 'human') { r.kind = 'away'; r.since = r.since || Date.now(); }
      return AI.create(t, r.kind === 'away' ? 'keeper' : LEVEL, this.S.seed + t);
    });
  }

  async persist() {
    if (this.saving) return;
    this.saving = true;
    try {
      const bytes = await gzip(JSON.stringify(R.save(this.S))), size = 120000, put = {};
      const n = Math.ceil(bytes.length / size);
      for (let i = 0; i < n; i++) put['snap' + i] = bytes.slice(i * size, (i + 1) * size);
      put.meta = { n, bytes: bytes.length, roster: this.roster, tick: this.S.tick };
      await this.ctx.storage.put(put);
    } finally { this.saving = false; }
  }

  humans() { return this.roster.filter(r => r.kind === 'human').length; }
  rosterView() {
    return this.roster.map((r, t) => ({ slot: t, kind: r.kind, name: r.kind === 'ai' ? 'Computer' : r.name, alive: this.S.P[t].alive !== false }));
  }
  broadcast(msg) { const s = JSON.stringify(msg); for (const k of this.socks) if (k.ready) this.send(k, s); }
  send(k, s) { try { k.ws.send(s); } catch (e) { /* closed */ } }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/hello') return Response.json({ ok: true, players: this.humans(), slots: this.roster.length, roster: this.rosterView() }, { headers: { 'cache-control': 'no-store' } });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    server.accept();
    const k = { ws: server, slot: -1, id: '', name: '', ready: false, backlog: null, n: 0, nT: 0 };
    this.socks.add(k);
    server.addEventListener('message', ev => { try { this.onMessage(k, ev.data); } catch (e) { console.log('message failed', e.message); } });
    server.addEventListener('close', () => this.onClose(k));
    server.addEventListener('error', () => this.onClose(k));
    this.run();
    return new Response(null, { status: 101, webSocket: client });
  }

  run() {
    if (this.timer) return;
    this.due = Date.now();
    this.timer = setInterval(() => this.tick(), 50);
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tick() {
    const now = Date.now();
    let n = 0;
    while (this.due <= now && n < 4) { this.stepOnce(); this.due += 1000 / HZ; n++; }
    // Fallen far behind, as after a pause: let the lost time go.
    if (this.due < now - 1000) this.due = now;
    if (this.batch.length) this.flush();
  }

  stepOnce() {
    const S = this.S;
    for (let t = 0; t < this.ais.length; t++) if (this.ais[t] && S.P[t].alive) this.ais[t].tick(S);
    for (const q of this.pending) S.cmds.push(q);
    this.pending = [];
    const tick = S.tick, list = S.cmds.map(q => [q.team, q.c]);
    R.step(S);
    for (const e of S.ev) if (e.t === 'fallen') this.onFallen(e.team);
    S.ev.length = 0;
    this.batch.push([tick, list]);
    if (S.tick % 40 === 0) this.hash = [S.tick, R.hashOf(S)];
    if (S.tick % HZ === 0) this.upkeep();
    if (S.tick % (60 * HZ) === 0) this.persist();
  }

  flush() {
    const s = JSON.stringify({ t: 'ticks', b: this.batch, h: this.hash });
    for (const k of this.socks) {
      if (k.ready) this.send(k, s);
      else if (k.backlog) k.backlog.push(s);
    }
    this.batch = []; this.hash = null;
  }

  // Slots without a person: a fallen computer comes back after a while, and a person long away gives
  // their slot up to a computer.
  upkeep() {
    const S = this.S, now = Date.now();
    let changed = false;
    this.roster.forEach((r, t) => {
      if (r.kind === 'away' && now - r.since > AWAY) { this.roster[t] = r = { kind: 'ai' }; this.ais[t] = AI.create(t, LEVEL, S.seed + t + S.tick); changed = true; }
      if (r.kind === 'ai' && !S.P[t].alive) {
        if (!this.respawnAt[t]) this.respawnAt[t] = S.tick + RESPAWN * HZ;
        else if (S.tick >= this.respawnAt[t]) {
          this.respawnAt[t] = 0;
          this.pending.push({ team: t, c: { c: 'restart', shield: 0 }, at: S.tick }, { team: t, c: { c: 'income', v: R.DIFFICULTY[LEVEL].income }, at: S.tick });
          this.ais[t] = AI.create(t, LEVEL, S.seed + t + S.tick);
          changed = true;
        }
      }
    });
    if (changed) this.broadcast({ t: 'roster', r: this.rosterView() });
  }

  onFallen(t) {
    const r = this.roster[t];
    if (r.kind === 'human') for (const k of this.socks) if (k.slot === t) this.send(k, JSON.stringify({ t: 'fallen' }));
    if (r.kind === 'away') this.roster[t] = { kind: 'ai' };
    this.broadcast({ t: 'roster', r: this.rosterView() });
  }

  // A slot for a newcomer: their own if they were here before and it still stands, else a fallen one,
  // else the weakest computer's, whose base is cleared for them.
  pickSlot(id) {
    const S = this.S, mine = this.roster.findIndex(r => r.id === id && (r.kind === 'away' || r.kind === 'human'));
    if (mine >= 0 && S.P[mine].alive) return { slot: mine, fresh: false };
    if (mine >= 0) return { slot: mine, fresh: true };
    let best = -1, bs = Infinity;
    this.roster.forEach((r, t) => {
      if (r.kind !== 'ai') return;
      const score = S.P[t].alive ? S.ents.filter(e => e.team === t && e.b).length : -1;
      if (score < bs) { bs = score; best = t; }
    });
    return best >= 0 ? { slot: best, fresh: true } : { slot: -1, fresh: false };
  }

  async join(k, msg) {
    const S = this.S;
    k.id = cleanId(msg.id) || crypto.randomUUID(); k.name = cleanName(msg.name);
    // The same person in a second tab takes the slot over from the first.
    for (const o of this.socks) if (o !== k && o.id === k.id && o.slot >= 0) { o.slot = -1; this.send(o, JSON.stringify({ t: 'taken' })); try { o.ws.close(4000, 'opened elsewhere'); } catch (e) { /* gone */ } }
    const { slot, fresh } = this.pickSlot(k.id);
    k.slot = slot;
    if (slot >= 0) {
      this.roster[slot] = { kind: 'human', id: k.id, name: k.name, since: Date.now() };
      this.ais[slot] = null;
      this.respawnAt[slot] = 0;
      if (fresh) this.pending.push({ team: slot, c: { c: 'restart', shield: SHIELD }, at: S.tick });
      this.pending.push({ team: slot, c: { c: 'income', v: 1 }, at: S.tick });
    }
    await this.welcome(k);
    this.broadcast({ t: 'roster', r: this.rosterView() });
  }

  // The whole world as it stands, then everything since.
  async welcome(k) {
    k.ready = false; k.backlog = [];
    const text = JSON.stringify(R.save(this.S)), tick = this.S.tick;
    this.send(k, JSON.stringify({ t: 'hello', slot: k.slot, tick, theme: 'desert', roster: this.rosterView() }));
    const bytes = await gzip(text);
    try { k.ws.send(bytes); } catch (e) { return; }
    for (const s of k.backlog) this.send(k, s);
    k.backlog = null; k.ready = true;
  }

  onMessage(k, data) {
    if (typeof data !== 'string' || data.length > 20000) return;
    // A player may send thirty messages a second.
    const now = Date.now();
    if (now - k.nT > 1000) { k.nT = now; k.n = 0; }
    if (++k.n > 30) return;
    const msg = JSON.parse(data);
    if (msg.t === 'join' && !k.id) this.join(k, msg);
    else if (msg.t === 'cmd' && k.slot >= 0) { const c = clean(this.S, msg.c); if (c) this.pending.push({ team: k.slot, c, at: this.S.tick }); }
    else if (msg.t === 'respawn' && k.slot >= 0 && !this.S.P[k.slot].alive) {
      this.pending.push({ team: k.slot, c: { c: 'restart', shield: SHIELD }, at: this.S.tick }, { team: k.slot, c: { c: 'income', v: 1 }, at: this.S.tick });
    }
    else if (msg.t === 'resync' && k.id && k.ready) this.welcome(k);
    else if (msg.t === 'ping') this.send(k, JSON.stringify({ t: 'pong', tick: this.S.tick, at: msg.at }));
  }

  onClose(k) {
    if (!this.socks.delete(k)) return;
    const t = k.slot;
    if (t >= 0 && this.roster[t].id === k.id && ![...this.socks].some(o => o.slot === t)) {
      this.roster[t] = { kind: 'away', id: k.id, name: k.name, since: Date.now() };
      this.ais[t] = AI.create(t, 'keeper', this.S.seed + t + this.S.tick);
      this.broadcast({ t: 'roster', r: this.rosterView() });
    }
    if (!this.socks.size) { this.stop(); this.persist(); }
  }
}
