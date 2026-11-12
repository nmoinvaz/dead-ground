// The server of Mapmaker's War: a Cloudflare Worker with two kinds of Durable Object. A Room is one game. First it is a
// lobby, where players take seats and the host picks the map, the terrain and the computers. Then it is the game,
// which the room steps twenty times a second while it runs the computers, sending each step's commands to every
// player, whose own copy of the rules steps the same world from them. The Directory lists the rooms.
import R from './rules.js';
import AI from './ai.js';

const HZ = R.HZ;
const LEVELS = ['recruit', 'regular', 'veteran'];
const THEMES = ['desert', 'steppe', 'winter'];
const WEATHERS = ['random', 'mild', 'harsh', 'off'], RESOURCES = ['std', 'free'], VICTORIES = ['conquest', 'regicide'];
// A player who drops out of a game has this long to come back before a computer takes their side over.
const GRACE = 90 * 1000;
// A room nobody is in closes after this long.
const EMPTY = 3 * 60 * 1000;

// The commands a player may send in a game and the fields each takes. 'raze' and 'income' are the server's own.
const CMDS = {
  move: ['ids', 'x', 'y', 'a'], attack: ['ids', 'id'], strike: ['ids', 'id', 'x', 'y', 'r'], stop: ['ids'], harvest: ['ids', 'cell', 'ref'],
  capture: ['ids', 'town'], train: ['kind'], build: ['kind'], research: [], hold: ['cat', 'i'], cancel: ['cat', 'i'],
  place: ['kind', 'x', 'y'], sell: ['id'], repair: ['id'], rally: ['id', 'x', 'y'], power: ['name', 'x', 'y'], launch: ['x', 'y'],
  form: ['ids', 'f'], stance: ['ids', 'v'], fallback: ['ids', 'on'], explore: ['ids', 'on'], guard: ['ids', 'id'], upgrade: ['id', 'k'], unupgrade: ['id'],
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
    else if (k === 'f') { if (!R.FORMS.includes(v)) return null; o.f = v; }
    else if (k === 'v') { if (!R.STANCES.includes(v)) return null; o.v = v; }
    else if (k === 'on') o.on = !!v;
    else if (k === 'k') { if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(R.UPGRADES, v)) return null; o.k = v; }
    else if (k === 'town') { const t = v | 0; if (t < 0 || t >= S.towns.length) return null; o.town = t; }
    // A smelter for trucks to work for, none when left out.
    else if (k === 'ref') o.ref = Number.isFinite(+v) ? +v | 0 : 0;
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
const cleanText = (s, n) => String(s || '').replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanName = s => cleanText(s, 16) || 'Commander';
const cleanId = s => String(s || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
const json = (o, status = 200) => Response.json(o, { status, headers: { 'cache-control': 'no-store' } });

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

const directory = env => env.DIR.get(env.DIR.idFromName('directory'));

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    if (p === '/api/hello') return json({ ok: true });
    if (p === '/api/rooms') return directory(env).fetch('https://dir/list');
    const m = p.match(/^\/ws\/room\/([A-Z0-9]{4,8})$/);
    if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    return env.ASSETS.fetch(req);
  },
};

// The list of rooms, as each room last told it. A room that has not spoken for a while is taken to be gone.
export class Directory {
  constructor(ctx) {
    this.ctx = ctx; this.rooms = new Map();
    ctx.blockConcurrencyWhile(async () => { this.rooms = new Map(Object.entries((await ctx.storage.get('rooms')) || {})); });
  }
  async fetch(req) {
    const url = new URL(req.url), now = Date.now();
    for (const [k, r] of this.rooms) if (now - r.at > 75000) this.rooms.delete(k);
    if (url.pathname === '/list') {
      const list = [...this.rooms.values()].sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.made - a.made);
      return json({ rooms: list });
    }
    const o = await req.json();
    if (url.pathname === '/put') this.rooms.set(o.code, Object.assign(o, { at: now }));
    else if (url.pathname === '/drop') this.rooms.delete(o.code);
    await this.ctx.storage.put('rooms', Object.fromEntries(this.rooms));
    return json({ ok: true });
  }
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.socks = new Set(); this.phase = 'none'; this.slots = []; this.chat = [];
    this.S = null; this.ais = []; this.pending = []; this.batch = []; this.hash = null; this.timer = null; this.due = 0; this.saving = false;
    this.upkeepT = null; this.emptySince = 0; this.listT = 0; this.listing = null;
    ctx.blockConcurrencyWhile(() => this.restore());
  }

  // ---- Keeping the room across a restart ----------------------------------------------------------------

  async restore() {
    const o = await this.ctx.storage.get('room');
    if (!o) return;
    Object.assign(this, { code: o.code, title: o.title, map: o.map, seed: o.seed, theme: o.theme, age: o.age || 1, weather: o.weather || 'random', res: o.res || 'std', win: o.win || 'conquest', host: o.host, slots: o.slots, phase: o.phase, made: o.made });
    if (this.phase !== 'game') { if (this.phase === 'over') this.phase = 'lobby'; return; }
    try {
      const meta = await this.ctx.storage.get('meta');
      const parts = await this.ctx.storage.get([...Array(meta.n).keys()].map(i => 'snap' + i));
      const all = new Uint8Array(meta.bytes);
      let at = 0;
      for (let i = 0; i < meta.n; i++) { const p = parts.get('snap' + i); all.set(p, at); at += p.length; }
      const snap = JSON.parse(await gunzip(all));
      this.S = R.load(snap.S);
      this.ais = snap.ais.map(a => a ? AI.load(a) : null);
      this.S.ev.length = 0;
      // Nobody is connected after a restart, so every person's side is held for them while they are away.
      const now = Date.now();
      this.slots.forEach((s, t) => { if (s.kind === 'human' && !s.left) { s.away = s.away || now; if (!this.ais[t]) this.ais[t] = AI.create(t, 'keeper', this.S.seed + t + this.S.tick); } });
    } catch (e) { console.log('restore failed', e.message); this.phase = 'lobby'; this.S = null; }
  }
  saveRoom() {
    return this.ctx.storage.put('room', { code: this.code, title: this.title, map: this.map, seed: this.seed, theme: this.theme, age: this.age, weather: this.weather, res: this.res, win: this.win, host: this.host, slots: this.slots, phase: this.phase, made: this.made });
  }
  async persist() {
    if (this.saving || !this.S) return;
    this.saving = true;
    try {
      R.use(this.S);
      const snap = { S: R.save(this.S), ais: this.ais.map(a => a ? AI.save(a) : null) };
      const bytes = await gzip(JSON.stringify(snap)), size = 120000, put = {};
      const n = Math.ceil(bytes.length / size);
      for (let i = 0; i < n; i++) put['snap' + i] = bytes.slice(i * size, (i + 1) * size);
      put.meta = { n, bytes: bytes.length };
      await this.ctx.storage.put(put);
      await this.saveRoom();
    } finally { this.saving = false; }
  }
  async close() {
    this.stop();
    this.phase = 'none';
    try { await directory(this.env).fetch('https://dir/drop', { method: 'POST', body: JSON.stringify({ code: this.code }) }); } catch (e) { /* gone */ }
    await this.ctx.storage.deleteAll();
  }

  // ---- What players see ---------------------------------------------------------------------------------

  // The room as one player sees it: everyone's seat, but nobody's id.
  view(k) {
    const mapD = R.MAPS[this.map];
    return {
      t: 'room', code: this.code, title: this.title, phase: this.phase, map: this.map, seed: this.seed, theme: this.theme, age: this.age || 1, weather: this.weather || 'random', win: this.win || 'conquest', res: this.res || 'std',
      seats: mapD.seats, you: k.slot, host: k.id === this.host,
      slots: this.slots.map(s => ({ kind: s.kind, level: s.level, name: s.kind === 'human' ? s.name : '', ready: !!s.ready, away: !!s.away, left: !!s.left, host: s.kind === 'human' && s.id === this.host, out: !!s.out })),
      watch: [...this.socks].filter(o => o.slot < 0 && o.id).map(o => o.name),
    };
  }
  tell() {
    for (const k of this.socks) if (k.id) this.send(k, JSON.stringify(this.view(k)));
    this.list();
  }
  // Tells the directory how the room stands, at most once a second.
  list() {
    if (this.listing) return;
    this.listing = setTimeout(async () => {
      this.listing = null;
      if (this.phase === 'none') return;
      // A room with nobody in it is left off the list, though a player who dropped out can still come back to it.
      if (![...this.socks].some(k => k.id)) { try { await directory(this.env).fetch('https://dir/drop', { method: 'POST', body: JSON.stringify({ code: this.code }) }); } catch (e) { /* try later */ } return; }
      const hostSlot = this.slots.find(s => s.kind === 'human' && s.id === this.host);
      const o = {
        code: this.code, title: this.title, host: hostSlot ? hostSlot.name : '', map: this.map, mapName: R.MAPS[this.map].name, phase: this.phase, made: this.made,
        seats: this.slots.length, humans: this.slots.filter(s => s.kind === 'human').length, ais: this.slots.filter(s => s.kind === 'ai').length,
        open: this.slots.filter(s => s.kind === 'open').length,
      };
      try { await directory(this.env).fetch('https://dir/put', { method: 'POST', body: JSON.stringify(o) }); } catch (e) { /* try later */ }
    }, 1000);
  }
  send(k, s) { try { k.ws.send(s); } catch (e) { /* closed */ } }
  broadcast(msg) { const s = JSON.stringify(msg); for (const k of this.socks) if (k.ready) this.send(k, s); }

  // ---- Connections --------------------------------------------------------------------------------------

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const code = url.pathname.split('/').pop();
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    server.accept();
    // pk names the connection to the others for voice; the player's own id stays private.
    const k = { ws: server, code, slot: -1, id: '', name: '', ready: false, backlog: null, n: 0, nT: 0, seen: Date.now(), pk: crypto.randomUUID().slice(0, 12), voice: false };
    this.socks.add(k);
    server.addEventListener('message', ev => { try { this.onMessage(k, ev.data); } catch (e) { console.log('message failed', e.message); } });
    server.addEventListener('close', () => this.onClose(k));
    server.addEventListener('error', () => this.onClose(k));
    if (!this.upkeepT) this.upkeepT = setInterval(() => this.upkeep(), 5000);
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(k, data) {
    if (typeof data !== 'string' || data.length > 20000) return;
    // A player may send thirty messages a second.
    const now = Date.now();
    k.seen = now;
    if (now - k.nT > 1000) { k.nT = now; k.n = 0; }
    if (++k.n > 30) return;
    const m = JSON.parse(data);
    if (m.t === 'join') { if (!k.id) this.join(k, m); return; }
    if (!k.id) return;
    const host = k.id === this.host, lobby = this.phase === 'lobby';
    switch (m.t) {
      case 'set': if (host && lobby) this.setup(m); break;
      case 'slot': if (host && lobby) this.setSlot(m.i | 0, m.kind, m.level); break;
      case 'seat': if (lobby) this.seat(k, m.i | 0); break;
      case 'ready': if (lobby && k.slot >= 0) { this.slots[k.slot].ready = !!m.on; this.tell(); } break;
      case 'chat': { const s = cleanText(m.s, 200); if (s) { this.chat.push({ n: k.name, s }); if (this.chat.length > 40) this.chat.shift(); for (const o of this.socks) if (o.id) this.send(o, JSON.stringify({ t: 'chat', n: k.name, s })); } break; }
      case 'start': if (host && lobby) this.start(); break;
      case 'again': if (host && this.phase === 'over') this.toLobby(); break;
      case 'cmd': if (this.phase === 'game' && this.mine(k)) { const c = clean(this.S, m.c); if (c) this.pending.push({ team: k.slot, c, at: this.S.tick }); } break;
      // A player who gives up loses their side at once and stays to watch.
      case 'surrender': if (this.phase === 'game' && this.mine(k) && this.S.P[k.slot].alive) { this.pending.push({ team: k.slot, c: { c: 'raze' }, at: this.S.tick }); this.slots[k.slot].out = true; this.tell(); } break;
      case 'resync': if (this.S && (this.phase === 'game' || this.phase === 'over') && k.ready) this.welcome(k); break;
      case 'leave': this.leave(k); break;
      // Voice runs between the players' own pages. The room keeps who is on it and passes the offers, answers
      // and routes between them, only between two who are both on.
      case 'voice': k.voice = !!m.on; this.voices(); break;
      case 'rtc': if (k.voice && m.d && typeof m.to === 'string') { const o = [...this.socks].find(q => q.pk === m.to && q.voice && q.id); if (o) this.send(o, JSON.stringify({ t: 'rtc', from: k.pk, d: m.d })); } break;
      case 'ping': this.send(k, JSON.stringify({ t: 'pong', tick: this.S ? this.S.tick : 0, at: m.at })); break;
    }
  }
  mine(k) { return k.slot >= 0 && this.slots[k.slot] && this.slots[k.slot].kind === 'human' && this.slots[k.slot].id === k.id; }
  // Who is on voice, told to everyone in the room.
  voices() {
    const list = [...this.socks].filter(o => o.id && o.voice).map(o => ({ pk: o.pk, slot: o.slot, n: o.name }));
    const s = JSON.stringify({ t: 'voices', list });
    for (const o of this.socks) if (o.id) this.send(o, s);
  }

  join(k, m) {
    k.id = cleanId(m.id) || crypto.randomUUID(); k.name = cleanName(m.name);
    if (this.phase === 'none') {
      // Only a player who asks to open the room may; anyone else has found a room that has closed.
      if (!m.create) { this.send(k, JSON.stringify({ t: 'gone' })); k.id = ''; return; }
      this.code = k.code; this.title = cleanText(m.title, 32) || `${k.name}'s game`; this.made = Date.now();
      this.map = R.MAPS[m.map] ? m.map : 'duel'; this.seed = (Date.now() % 99991) + 1; this.theme = 'desert'; this.age = 1; this.weather = 'random'; this.res = 'std'; this.win = 'conquest'; this.host = k.id;
      this.slots = this.blank(R.MAPS[this.map].seats);
      this.slots[1] = { kind: 'ai', level: 'regular' };
      this.phase = 'lobby';
    }
    // The same person in a second window takes over from the first.
    for (const o of this.socks) if (o !== k && o.id === k.id) { this.send(o, JSON.stringify({ t: 'taken' })); o.id = ''; o.slot = -1; try { o.ws.close(4000, 'opened elsewhere'); } catch (e) { /* gone */ } }
    // Back in the same seat, or a free one in the lobby, or watching.
    const back = this.slots.findIndex(s => s.kind === 'human' && s.id === k.id);
    if (back >= 0) {
      k.slot = back;
      const s = this.slots[back];
      s.name = k.name; s.away = 0;
      if (s.left) { s.left = false; }
      if (this.phase === 'game') this.ais[back] = null;
    } else if (this.phase === 'lobby') {
      const i = this.slots.findIndex(s => s.kind === 'open');
      if (i >= 0) { this.slots[i] = { kind: 'human', id: k.id, name: k.name, ready: false }; k.slot = i; }
    }
    if (!this.host || !this.slots.some(s => s.kind === 'human' && s.id === this.host)) this.host = k.slot >= 0 ? k.id : this.host;
    this.emptySince = 0;
    this.send(k, JSON.stringify({ t: 'chatlog', list: this.chat }));
    this.send(k, JSON.stringify({ t: 'you', pk: k.pk }));
    this.voices();
    this.tell();
    this.saveRoom();
    if (this.phase === 'game' || this.phase === 'over') { this.welcome(k); this.run(); }
  }

  leave(k) {
    // A player who leaves a game they are still in gives it up.
    if (this.phase === 'game' && this.mine(k) && this.S.P[k.slot].alive) this.pending.push({ team: k.slot, c: { c: 'raze' }, at: this.S.tick });
    if (k.slot >= 0 && this.slots[k.slot] && this.slots[k.slot].id === k.id) {
      if (this.phase === 'lobby') this.slots[k.slot] = { kind: 'open' };
      else { this.slots[k.slot].left = true; this.slots[k.slot].out = true; }
    }
    k.slot = -1; k.id = '';
    try { k.ws.close(1000, 'left'); } catch (e) { /* gone */ }
    this.socks.delete(k);
    this.afterLeaving();
  }

  onClose(k) {
    if (!this.socks.delete(k)) return;
    if (k.id && k.slot >= 0 && this.slots[k.slot] && this.slots[k.slot].id === k.id) {
      const s = this.slots[k.slot];
      if (this.phase === 'lobby') this.slots[k.slot] = { kind: 'open' };
      else if (this.phase === 'game' && !s.left) {
        // Away: a keeper holds the base, and after a while a computer plays the side on.
        s.away = Date.now();
        this.ais[k.slot] = AI.create(k.slot, 'keeper', this.S.seed + k.slot + this.S.tick);
      }
    }
    this.afterLeaving();
  }

  afterLeaving() {
    this.voices();
    const people = [...this.socks].filter(o => o.id);
    // The host's part passes to the next person seated.
    if (!people.some(o => o.id === this.host)) { const next = people.find(o => o.slot >= 0) || people[0]; if (next) this.host = next.id; }
    if (!people.length) {
      this.emptySince = Date.now();
      if (this.phase === 'lobby' || this.phase === 'over') { this.close(); return; }
      // A game with nobody left in it waits, still, for a while.
      this.stop(); this.persist();
      this.ctx.storage.setAlarm(Date.now() + EMPTY + 1000);
    }
    this.tell();
    this.saveRoom();
  }

  // ---- The lobby ----------------------------------------------------------------------------------------

  blank(n) { return [...Array(n)].map(() => ({ kind: 'open' })); }
  setup(m) {
    if (typeof m.title === 'string') this.title = cleanText(m.title, 32) || this.title;
    if (THEMES.includes(m.theme)) this.theme = m.theme;
    if (WEATHERS.includes(m.weather)) this.weather = m.weather;
    if (RESOURCES.includes(m.res)) this.res = m.res;
    if (VICTORIES.includes(m.win)) this.win = m.win;
    if (m.age !== undefined) { const a = Math.round(+m.age); if (a >= 1 && a <= R.MAX_AGE) this.age = a; }
    if (m.seed !== undefined) { const s = Math.round(+m.seed); if (s >= 1 && s <= 99999) this.seed = s; }
    if (R.MAPS[m.map] && m.map !== this.map) {
      // A new map keeps the people first, then the computers, in as many seats as it has.
      const n = R.MAPS[m.map].seats, people = this.slots.filter(s => s.kind === 'human'), cpus = this.slots.filter(s => s.kind === 'ai');
      const next = [...people, ...cpus].slice(0, n);
      while (next.length < n) next.push({ kind: 'open' });
      for (const k of this.socks) k.slot = next.findIndex(s => s.kind === 'human' && s.id === k.id);
      this.slots = next; this.map = m.map;
    }
    // A map that fixes its theatre keeps it.
    this.theme = R.theatreOf(this.map, this.theme);
    for (const s of this.slots) if (s.kind === 'human') s.ready = false;
    this.tell(); this.saveRoom();
  }
  setSlot(i, kind, level) {
    const s = this.slots[i];
    if (!s || !['open', 'closed', 'ai'].includes(kind)) return;
    if (s.kind === 'human') {
      // Opening a person's seat sends them to watch. The host cannot send themselves.
      if (s.id === this.host) return;
      for (const k of this.socks) if (k.id === s.id) { k.slot = -1; this.send(k, JSON.stringify({ t: 'moved' })); }
    }
    this.slots[i] = kind === 'ai' ? { kind, level: LEVELS.includes(level) ? level : 'regular' } : { kind };
    this.tell(); this.saveRoom();
  }
  seat(k, i) {
    const was = k.slot;
    if (i < 0) { if (was >= 0) this.slots[was] = { kind: 'open' }; k.slot = -1; this.tell(); return; }
    const s = this.slots[i];
    if (!s || s.kind !== 'open') return;
    this.slots[i] = { kind: 'human', id: k.id, name: k.name, ready: false };
    if (was >= 0) this.slots[was] = { kind: 'open' };
    k.slot = i;
    this.tell(); this.saveRoom();
  }

  start() {
    const seats = [];
    this.slots.forEach((s, t) => { if (s.kind === 'human' || s.kind === 'ai') seats.push(t); });
    const waiting = this.slots.some(s => s.kind === 'human' && s.id !== this.host && !s.ready);
    if (seats.length < 2 || waiting) return;
    this.S = R.newGame({ seed: this.seed, layout: R.MAPS[this.map].layout, seats, shuffle: Math.random, age: this.age || 1, theatre: this.theme, weather: this.weather, free: this.res === 'free', regicide: this.win === 'regicide' });
    this.S.ev.length = 0;
    this.ais = this.slots.map((s, t) => s.kind === 'ai' ? AI.create(t, s.level, this.seed + t) : null);
    for (const s of this.slots) { s.out = false; s.left = false; s.away = 0; }
    this.pending = []; this.batch = []; this.hash = null;
    this.phase = 'game';
    this.tell();
    for (const k of this.socks) if (k.id) this.welcome(k);
    this.run();
    this.persist();
  }
  toLobby() {
    this.stop();
    this.S = null; this.ais = [];
    this.phase = 'lobby';
    // Seats of those who left are opened again.
    this.slots = this.slots.map(s => s.kind === 'human' && (s.left || ![...this.socks].some(k => k.id === s.id)) ? { kind: 'open' } : Object.assign(s, { ready: false, out: false, away: 0 }));
    this.tell(); this.saveRoom();
    this.ctx.storage.delete(['meta']);
  }

  // ---- The game -----------------------------------------------------------------------------------------

  run() {
    if (this.timer || !this.S || this.phase !== 'game') return;
    this.due = Date.now();
    this.timer = setInterval(() => this.tick(), 50);
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tick() {
    const now = Date.now();
    let n = 0;
    while (this.due <= now && n < 4 && this.phase === 'game') { this.stepOnce(); this.due += 1000 / HZ; n++; }
    // Fallen far behind, as after a pause: let the lost time go.
    if (this.due < now - 1000) this.due = now;
    if (this.batch.length) this.flush();
  }

  stepOnce() {
    const S = this.S;
    R.use(S);
    for (let t = 0; t < this.ais.length; t++) if (this.ais[t] && S.P[t].alive) this.ais[t].tick(S);
    for (const q of this.pending) S.cmds.push(q);
    this.pending = [];
    const tick = S.tick, list = S.cmds.map(q => [q.team, q.c]);
    R.step(S);
    let changed = false;
    for (const e of S.ev) {
      if (e.t === 'fallen' && this.slots[e.team]) { this.slots[e.team].out = true; changed = true; }
      if (e.t === 'over') { this.phase = 'over'; changed = true; }
    }
    S.ev.length = 0;
    this.batch.push([tick, list]);
    if (S.tick % 40 === 0) this.hash = [S.tick, R.hashOf(S)];
    if (S.tick % (60 * HZ) === 0) this.persist();
    if (changed) this.tell();
    if (this.phase === 'over') { this.flush(); this.stop(); this.saveRoom(); }
  }

  flush() {
    const s = JSON.stringify({ t: 'ticks', b: this.batch, h: this.hash });
    for (const k of this.socks) {
      if (k.ready) this.send(k, s);
      else if (k.backlog) k.backlog.push(s);
    }
    this.batch = []; this.hash = null;
  }

  // The whole world as it stands, then everything since.
  async welcome(k) {
    if (!this.S) return;
    k.ready = false; k.backlog = [];
    R.use(this.S);
    const text = JSON.stringify(R.save(this.S)), tick = this.S.tick;
    this.send(k, JSON.stringify({ t: 'hello', slot: k.slot, tick, theme: this.theme, map: this.map }));
    const bytes = await gzip(text);
    try { k.ws.send(bytes); } catch (e) { return; }
    for (const s of k.backlog) this.send(k, s);
    k.backlog = null; k.ready = true;
  }

  // A room still empty when its alarm rings closes, even if it was put away in the meantime.
  async alarm() {
    if ([...this.socks].some(k => k.id)) return;
    if (this.phase === 'none') { await this.ctx.storage.deleteAll(); return; }
    await this.close();
  }

  // Every few seconds: a silent player is let go, a side away too long is played on by a computer, the directory
  // hears the room is still here, and a room long empty closes.
  upkeep() {
    const now = Date.now();
    // A player's page pings every fifteen seconds; one silent for longer than three pings is gone.
    for (const k of [...this.socks]) if (now - k.seen > 50000) { try { k.ws.close(4001, 'silent'); } catch (e) { /* gone */ } this.onClose(k); }
    if (this.phase === 'game') {
      let changed = false;
      this.slots.forEach((s, t) => {
        if (s.kind === 'human' && s.away && !s.left && now - s.away > GRACE) {
          s.left = true;
          this.ais[t] = AI.create(t, 'regular', this.S.seed + t + this.S.tick);
          changed = true;
        }
      });
      if (changed) this.tell();
    }
    if (this.phase !== 'none' && now - this.listT > 30000) { this.listT = now; this.list(); }
    if (this.emptySince && now - this.emptySince > EMPTY) { clearInterval(this.upkeepT); this.upkeepT = null; this.close(); }
  }
}
