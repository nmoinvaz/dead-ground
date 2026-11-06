// Dead Ground, the running game. Boots the picture, plays a live battle behind the title, and steps
// the world on a fixed clock while the picture eases between steps.
const Game = (() => {
  const $ = id => document.getElementById(id);
  const VOICE = {
    buildready: ['Construction complete', ''], unitready: ['Unit ready', ''], lowpower: ['Low power', 'bad'], baseattack: ['Our base is under attack', 'bad'],
    truckattack: ['Ore truck under attack', 'bad'], nosupply: ['Insufficient supply', 'bad'], nooil: ['Insufficient oil', 'bad'], newtech: ['New technology available', ''],
    towntaken: ['Town captured', 'good'], townlost: ['Town lost', 'bad'], captured: ['Building captured', 'good'], lostbuilding: ['Building lost', 'bad'],
    siloready: ['Missile ready', 'good'], missile: ['Warning, missile launch detected', 'bad'],
  };
  // What each turn of the weather means, written and spoken.
  const SKY_SAY = {
    rain: ['Rain. Wheeled vehicles bog down off the roads.', '', 'Rain'], storm: ['Storm. All aircraft are grounded.', 'bad', 'Storm. Aircraft grounded'],
    fog: ['Fog. Sight is cut short.', '', 'Fog'], snow: ['Snow. Everything moves slower.', '', 'Snow'], stormsoon: ['A storm is coming. Aircraft will be grounded.', 'bad', 'Storm warning'],
    clear: ['The weather clears.', 'good', ''], cloud: ['Clouding over.', '', ''],
    sand: ['Dust storm. Sight is cut short, men and wheels slowed, aircraft grounded.', 'bad', 'Dust storm. Aircraft grounded'],
    sandsoon: ['A dust storm is coming. Aircraft will be grounded.', 'bad', 'Dust storm warning'],
  };
  // What a theatre's weather brings under a setting, for the set-up.
  const SKY_OF = { desert: 'Dust storms, little rain and no snow.', steppe: 'Rain, thunderstorms and fog, with a little snow.', winter: 'Deep snow and fog, and no rain.' };
  const WEATHER_OF = { random: 'In their usual measure.', mild: 'Mostly fair, with no storms of any kind.', harsh: 'Often, and the storms come hard.' };
  const weatherNote = (theme, w) => w === 'off' ? 'Fair skies all game.' : `${SKY_OF[theme] || ''} ${WEATHER_OF[w] || ''}`;

  // Sound. Effects are decoded once and played with a little pan and pitch from where they happen.
  function makeAudio(data, world) {
    let ctx = null, master = null, bank = {}, music = null, ambient = null, voiceT = 0, rainSrc = null, rainGain = null;
    const last = {}, a = {
      muted: false, ready: false,
      wake() {
        if (!ctx) {
          const C = window.AudioContext || window.webkitAudioContext;
          if (!C) return;
          ctx = new C(); master = ctx.createGain(); master.gain.value = a.muted ? 0 : 0.8; master.connect(ctx.destination);
          for (const k in data) {
            const bin = atob(data[k]), buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            ctx.decodeAudioData(buf.buffer, b => { bank[k] = b; if (k === 'music') a.music(); if (k === 'wind') a.wind(); }, () => {});
          }
        }
        if (ctx.state === 'suspended') ctx.resume();
      },
      play(name, o = {}) {
        if (!ctx || !bank[name]) return;
        const now = ctx.currentTime, gap = o.gap ?? 0.05;
        if (now - (last[name] || 0) < gap) return;
        last[name] = now;
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = bank[name]; s.playbackRate.value = (o.rate ?? 1) * (o.vary ? 1 + (Math.random() - 0.5) * o.vary : 1);
        g.gain.value = o.gain ?? 1;
        s.connect(g);
        if (ctx.createStereoPanner && o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); p.connect(master); }
        else g.connect(master);
        s.start();
      },
      // Sound in the world falls away with distance from the middle of the view.
      at(name, x, y, o = {}) {
        const c = world.cam, d = Math.hypot(x - c.x, y - c.y), reach = 22 + c.dist * 0.5, k = 1 - d / reach;
        if (k <= 0) return;
        const rx = -Math.sin(c.yaw), ry = Math.cos(c.yaw), pan = Rules.clamp(((x - c.x) * rx + (y - c.y) * ry) / reach * 1.4, -0.9, 0.9);
        a.play(name, Object.assign({}, o, { gain: (o.gain ?? 1) * k * k * Rules.clamp(50 / c.dist, 0.45, 1.1), pan }));
      },
      ui(n) { a.play(n === 'click' ? 'click' : n === 'deny' ? 'deny' : 'place', { gain: 0.5, gap: 0.03 }); },
      // Status calls in the browser's own voice, one at a time.
      voice(k, text) {
        const sp = window.speechSynthesis, now = performance.now();
        if (!sp || a.muted || !text || now < voiceT) return;
        try {
          const u = new SpeechSynthesisUtterance(text), vs = sp.getVoices();
          u.voice = vs.find(v => /Samantha|Google UK English Female|Zira|Karen|Moira/.test(v.name)) || vs.find(v => /^en/.test(v.lang)) || null;
          u.rate = 1.06; u.pitch = 0.82; u.volume = 0.85;
          sp.cancel(); sp.speak(u);
          voiceT = now + 1800;
        } catch (e) { /* no voice here */ }
      },
      ack(u, attack) { if (!u) return; a.play(attack ? 'ack2' : 'ack1', { gain: 0.34, gap: 0.5, vary: 0.08 }); },
      music() { if (music || !bank.music) return; music = ctx.createBufferSource(); music.buffer = bank.music; music.loop = true; const g = ctx.createGain(); g.gain.value = 0.3; music.connect(g); g.connect(master); music.start(); },
      wind() { if (ambient || !bank.wind) return; ambient = ctx.createBufferSource(); ambient.buffer = bank.wind; ambient.loop = true; const g = ctx.createGain(); g.gain.value = 0.22; ambient.connect(g); g.connect(master); ambient.start(); },
      // Rain under everything, as loud as it is raining.
      weather(sky) {
        if (!ctx || !bank.rain) return;
        if (!rainSrc) { rainSrc = ctx.createBufferSource(); rainSrc.buffer = bank.rain; rainSrc.loop = true; rainGain = ctx.createGain(); rainGain.gain.value = 0; rainSrc.connect(rainGain); rainGain.connect(master); rainSrc.start(); }
        rainGain.gain.value = Math.min(1, sky.rain) * (0.28 + 0.2 * sky.storm);
      },
      toggle() { a.muted = !a.muted; if (master) master.gain.value = a.muted ? 0 : 0.8; try { localStorage.setItem('dg-mute', a.muted ? '1' : ''); } catch (e) { /* no store */ } },
    };
    try { a.muted = !!localStorage.getItem('dg-mute'); } catch (e) { /* no store */ }
    return a;
  }

  function create() {
    const canvas = $('gl'), view = $('view');
    const mobile = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
    const params = new URLSearchParams(location.search);
    const world = World.create(THREE, canvas, { low: mobile, keep: params.has('keep') });
    const G = {
      S: null, team: 0, playing: false, paused: false, speed: 1, showHints: true, audio: null, world, theme: 'desert', look: 'ink', online: false, name: '',
      // Each slot's name and the map of the game being played.
      names: [], mapKey: 'duel',
      // Online the world never pauses, so the veil only offers the way out.
      togglePause() { if (!G.playing) return; if (G.online) { $('veil').hidden = !$('veil').hidden; return; } G.paused = !G.paused; $('veil').hidden = !G.paused; },
      setSpeed(d) { if (G.online) return; const i = Rules.clamp(SPEEDS.indexOf(G.speed) + d, 0, SPEEDS.length - 1); G.speed = SPEEDS[i]; hud.say(`Game speed ${G.speed}x.`); $('speed').textContent = G.speed + 'x'; },
      // Every order goes to the server online, and straight into the rules otherwise.
      order(S, team, c) { if (G.online) send({ t: 'cmd', c }); else Rules.push(S, team, c); },
      fullscreen() { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {}); },
      // Enter on the title: the first choice on the main menu, or start the game being set up.
      menuEnter() { if (!$('t-main').hidden) $('b-skirmish').click(); else if (!$('t-setup').hidden && !$('deploy').hidden && !$('deploy').disabled) $('deploy').click(); },
    };
    const SPEEDS = [0.5, 1, 1.5, 2, 3];
    const SLOT_CSS = ['#6fb0ff', '#ee3a22', '#6fd47f', '#b98af0', '#ffae52', '#4fd8d4', '#cdf044', '#c99a6c'];
    const LEVELS = ['recruit', 'regular', 'veteran'];
    const THEATRES = { desert: 'Salt Flats', steppe: 'Black Steppe', winter: 'White Pass' };
    const store = { get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* no store */ } } };
    const audio = G.audio = makeAudio(typeof SOUNDS === 'object' ? SOUNDS : {}, world);
    const hud = Hud.create(world, G);

    let dpr = 1;
    function fit() {
      const r = view.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2) * scale;
      world.resize(Math.max(2, r.width | 0), Math.max(2, r.height | 0), dpr);
      hud.layoutMini();
    }
    let scale = 1;
    window.addEventListener('resize', fit);
    new ResizeObserver(fit).observe(view);

    function begin(S, theme, team) {
      G.S = S; G.team = team;
      world.load(S, theme, team);
      fit();
    }
    // The camera over a slot's own base, looking toward the middle of the map.
    function home(S, team, d = 92) {
      const hq = S.ents.find(e => e.b && e.team === team && e.kind === 'hq') || { x: S.bases[team][0], y: S.bases[team][1] }, a = S.faces[team];
      world.cam.yaw = a;
      world.focus(hq.x + Math.cos(a) * 11.3, hq.y + Math.sin(a) * 11.3, d);
    }

    // The battle behind the title is two commanders fighting from the fourth minute on.
    function attract() {
      const S = Rules.newGame({ seed: 40 + (Date.now() / 86400000 | 0) % 40 });
      S.ais.push(AI.create(0, 'veteran'), AI.create(1, 'veteran'));
      for (let i = 0; i < 20 * 60 * 4.5; i++) { Rules.step(S); S.ev.length = 0; }
      begin(S, 'desert', -1);
      S.ev.length = 0;
      world.focus(Rules.W / 2, Rules.H / 2, 110);
    }

    // Into a game, local or online: the title goes and the view goes to the player's base.
    function enterPlay(S, theme, team) {
      $('title').hidden = true; $('end').hidden = true; $('veil').hidden = true;
      begin(S, theme, team);
      pictures();
      hud.reset();
      G.playing = true; G.paused = false; G.outcome = null;
      document.body.classList.add('in-game');
      if (team >= 0) home(S, team); else world.focus(S.map.W / 2, S.map.H / 2, 150);
      drawRoster();
      fit();
    }

    // ---- A skirmish against computers, kept in the browser ------------------------------------------------

    // The skirmish being set up: the map, its terrain, the theatre, and who sits in each slot.
    const SK = 'dg-skirmish';
    const newSeed = () => 1 + Math.floor(Math.random() * 99990);
    let sk = null;
    try { sk = JSON.parse(store.get(SK, 'null')); } catch (e) { sk = null; }
    if (!sk || !Rules.MAPS[sk.map] || !Array.isArray(sk.slots)) sk = { map: 'duel', seed: newSeed(), theme: store.get('dg-theme', 'desert'), slots: [{ kind: 'you' }, { kind: 'ai', level: store.get('dg-diff', 'regular') }] };
    if (!THEATRES[sk.theme]) sk.theme = 'desert';
    fitSlots(sk);
    // Slots to the map's number of seats, keeping the player and the computers in order, the player always in one.
    function fitSlots(o) {
      const n = Rules.MAPS[o.map].seats, keep = o.slots.filter(s => s.kind === 'you' || s.kind === 'ai');
      if (!keep.some(s => s.kind === 'you')) keep.unshift({ kind: 'you' });
      const you = keep.find(s => s.kind === 'you'), cpus = keep.filter(s => s.kind === 'ai');
      // The player's own place in the list is kept where it fits.
      const at = Math.min(o.slots.indexOf(you) >= 0 ? o.slots.indexOf(you) : 0, n - 1);
      const out = [...Array(n)].map(() => ({ kind: 'open' }));
      out[at] = you;
      let i = 0;
      for (const c of cpus) { while (i < n && out[i].kind !== 'open') i++; if (i < n) out[i] = { kind: 'ai', level: LEVELS.includes(c.level) ? c.level : 'regular' }; }
      if (!out.some(s => s.kind === 'ai')) { const j = out.findIndex(s => s.kind === 'open'); if (j >= 0) out[j] = { kind: 'ai', level: 'regular' }; }
      o.slots = out;
    }
    const saveSk = () => store.set(SK, JSON.stringify(sk));

    function startSkirmish() {
      const m = Rules.MAPS[sk.map], seats = [], you = sk.slots.findIndex(s => s.kind === 'you');
      sk.slots.forEach((s, t) => { if (s.kind === 'you' || s.kind === 'ai') seats.push(t); });
      if (seats.length < 2 || you < 0) return;
      const S = Rules.newGame({ seed: params.has('seed') ? +params.get('seed') : sk.seed, layout: m.layout, seats, shuffle: Math.random, age: sk.age || 1, theatre: sk.theme, weather: sk.weather || 'random' });
      sk.slots.forEach((s, t) => { if (s.kind === 'ai') S.ais.push(AI.create(t, s.level, S.seed + t)); });
      G.names = sk.slots.map(s => s.kind === 'you' ? (G.name || 'You') : s.kind === 'ai' ? `Computer (${Rules.DIFFICULTY[s.level].name})` : '');
      G.theme = sk.theme; G.mapKey = sk.map; G.online = false;
      clearSave();
      enterPlay(S, G.theme, you);
      saveT = 0;
      const foes = seats.length - 1;
      hud.say(`Deployed: ${m.name}, ${THEATRES[G.theme]}, the ${Rules.AGES[S.age0].name} Age. ${foes === 1 ? 'One enemy' : foes + ' enemies'} on the map. Good hunting, Commander.`);
    }

    // A game against the computer is kept in the browser, so a refresh or a closed tab loses nothing. The world, the
    // commanders' minds, the view and the control groups are written every few seconds and as the page goes.
    const SAVE = 'dg-save';
    let saveT = 0;
    function saveGame() {
      if (!G.playing || G.online || !G.S || G.S.over) return;
      const c = world.cam;
      store.set(SAVE, JSON.stringify({ v: 2, at: Date.now(), theme: G.theme, map: G.mapKey, names: G.names, team: G.team, speed: G.speed, cam: { x: c.x, y: c.y, dist: c.dist, yaw: c.yaw }, groups: hud.groupIds(), S: Rules.save(G.S), ais: G.S.ais.map(AI.save) }));
    }
    function clearSave() { store.set(SAVE, null); }
    function restore() {
      let o = null;
      try { o = JSON.parse(store.get(SAVE, 'null')); } catch (e) { /* none */ }
      if (!o || (o.v !== 1 && o.v !== 2)) return false;
      let S;
      try { S = Rules.load(o.S); S.ais = o.ais.map(AI.load); } catch (e) { clearSave(); return false; }
      G.theme = o.theme; G.speed = o.speed; $('speed').textContent = G.speed + 'x';
      G.mapKey = o.map || 'duel'; G.names = o.names || ['You', `Computer (${Rules.DIFFICULTY[o.diff || 'regular'].name})`];
      enterPlay(S, G.theme, o.team ?? 0);
      hud.setGroups(o.groups);
      Object.assign(world.cam, o.cam);
      hud.say('Resumed where you left off.');
      return true;
    }
    window.addEventListener('pagehide', saveGame);
    window.addEventListener('beforeunload', saveGame);

    // ---- How a game ends ----------------------------------------------------------------------------------

    // A side's name, marked when it is the player's own.
    const youName = t => { const n = G.names[t] || `Side ${t + 1}`; return t === G.team && n !== 'You' ? n + ' (you)' : n; };
    // Shows how things stand once a side falls or the game is won: the final report, or, for a player whose base
    // has fallen while others fight on, the report so far and a choice to watch the rest.
    function outcome() {
      const S = G.S;
      if (!S || G.outcome === 'final') return;
      const sec = S.tick / Rules.HZ | 0, map = Rules.MAPS[G.mapKey] || Rules.MAPS.duel;
      $('end-sub').textContent = `${map.name} · ${THEATRES[G.theme] || ''} · ${sec / 60 | 0}m ${String(sec % 60).padStart(2, '0')}s`;
      const me = G.team >= 0 ? S.P[G.team] : null;
      if (S.over) {
        G.outcome = 'final'; G.playing = false;
        clearSave();
        const won = S.over.winner === G.team && G.team >= 0;
        $('end-title').textContent = won ? 'Mission Accomplished' : me ? 'Mission Failed' : `${G.names[S.over.winner] || 'Nobody'} won`;
        $('end').className = won ? 'won' : 'lost';
        $('watch').hidden = true;
        audio.play(won ? 'won' : 'lost', { gain: 0.8 });
      } else if (me && !me.alive && G.outcome !== 'fallen') {
        G.outcome = 'fallen';
        $('end-title').textContent = 'Your base has fallen';
        $('end').className = 'lost';
        $('watch').hidden = false;
        audio.play('lost', { gain: 0.8 });
      } else return;
      $('again').textContent = G.online ? 'Back to the room' : 'Again';
      $('menu').textContent = G.online ? 'Leave' : 'Menu';
      $('end').hidden = false;
      Report.show($('end-report'), { S, name: youName });
    }

    // Hands what the rules did to the picture, the sound and the reports.
    const WSND = { rifle: ['rifle', 0.34, 0.04], hmg: ['hmg', 0.4, 0.06], auto: ['auto', 0.5, 0.08], cannon: ['cannon', 0.8, 0.06], flak: ['flak', 0.45, 0.08], missile: ['missile', 0.6, 0.1], rocket: ['rocket', 0.5, 0.05], rail: ['rail', 0.9, 0.1], sniper: ['sniper', 0.7, 0.1], bow: ['bow', 0.45, 0.05], xbow: ['xbow', 0.45, 0.06], longbow: ['longbow', 0.45, 0.06], clash: ['clash', 0.35, 0.06], musket: ['musket', 0.55, 0.05], catapult: ['catapult', 0.7, 0.1], pulse: ['pulse', 0.35, 0.04] };
    function drain() {
      const S = G.S, ev = S.ev;
      for (const e of ev) {
        world.event(e);
        const heard = world.visible(e.x ?? 0, e.y ?? 0);
        switch (e.t) {
          case 'shot': {
            const w = Rules.WEAPONS[e.w], s = w && WSND[w.snd];
            if (s && heard) audio.at(s[0], e.x, e.y, { gain: s[1], gap: s[2], vary: 0.14 });
            break;
          }
          case 'hit': if (heard) audio.at(Rules.WEAPONS[e.w].fx === 'rocket' ? 'boom_m' : 'boom_s', e.x, e.y, { gain: 0.6, gap: 0.05, vary: 0.2 }); break;
          case 'boom': if (heard || e.size >= 8) audio.at(e.size >= 8 ? 'boom_x' : e.size > 1.5 ? 'boom_l' : 'boom_m', e.x, e.y, { gain: e.size >= 8 ? 2 : 0.8, gap: 0.05, vary: 0.2 }); break;
          case 'die': if (heard) audio.at(e.b ? 'boom_l' : Rules.UNITS[e.kind]?.men ? 'scream' : 'boom_m', e.x, e.y, { gain: Rules.UNITS[e.kind]?.men ? 0.3 : 0.9, gap: 0.08, vary: 0.2 }); break;
          case 'say':
            // A new age has its own card, so its call names the age and leaves no line in the log.
            if (G.playing && e.team === G.team && e.line === 'newtech') audio.voice(e.line, `The ${Rules.AGES[S.P[e.team].tech].name} Age`);
            else if (G.playing && e.team === G.team) { const v = VOICE[e.line]; if (v) { hud.say(v[0] + '.', v[1]); audio.voice(e.line, v[0]); } }
            break;
          case 'alert': if (G.playing && e.team === G.team) hud.alert(e.x, e.y); break;
          case 'trade': if (G.playing && e.team === G.team) hud.pop(e.x, e.y, '+' + e.n); break;
          case 'hint': if (G.playing && e.team === G.team && e.hint === 'attrition') hud.say('Attrition: troops wear down abroad. A Support Truck stops it.', 'bad'); break;
          case 'launch': if (G.playing && e.team === G.team) audio.play('launch', { gain: 0.9 }); break;
          case 'placed': if (G.playing && e.team === G.team) audio.at('place', e.x, e.y, { gain: 0.8 }); break;
          case 'over': if (G.playing) setTimeout(outcome, 1800); drawRoster(); break;
          case 'fallen':
            if (G.playing && e.team === G.team) setTimeout(outcome, 1800);
            else if (G.playing && G.names[e.team]) hud.say(`${G.names[e.team]} is out.`, 'good');
            drawRoster();
            break;
          case 'weather': if (G.playing) { const v = SKY_SAY[e.kind]; if (v && !(e.kind === 'cloud' && e.was === 'clear')) { hud.say(v[0], v[1]); if (v[2]) audio.voice('sky', v[2]); } } break;
          case 'flood': if (G.playing) hud.say(e.on ? 'The rivers are up. The fords are closed.' : 'The rivers are down. The fords are open again.', e.on ? 'bad' : 'good'); break;
          case 'bridge': if (G.playing && G.team >= 0 && G.S.P[G.team].seen[Rules.cellOf(e.x, e.y)]) { hud.say(e.down ? 'A bridge is down.' : 'A bridge is open again.', e.down ? 'bad' : 'good'); if (e.down) audio.voice('bridge', 'Bridge destroyed'); } break;
          case 'wave': if (G.playing && e.team !== G.team) hud.say('Radar shows the enemy massing to attack.', 'bad'); break;
        }
      }
      ev.length = 0;
    }

    // The title camera drifts to wherever the fight is hottest.
    let hot = null, hotT = 0;
    function attractCam(dt) {
      const S = G.S, c = world.cam;
      hotT -= dt;
      if (hotT <= 0) {
        hotT = 9;
        const shots = S.ents.filter(e => !e.b && e.tgt && !e.d.cargo);
        if (shots.length) { const u = shots[(Math.random() * shots.length) | 0]; hot = [u.x, u.y]; }
        else hot = [Rules.W / 2 + Math.sin(S.tick * 0.001) * 20, Rules.H / 2];
      }
      c.yaw += dt * 0.012;
      if (hot) { c.x += (hot[0] - c.x) * dt * 0.28; c.y += (hot[1] - c.y) * dt * 0.28; }
      c.dist += (64 - c.dist) * dt * 0.12;
    }

    let last = 0, acc = 0, slow = 0, frames = 0;
    function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
      last = now;
      const S = G.S;
      if (S && G.online) {
        // Steps as they come from the server, keeping a step or two in hand, and catching up when behind.
        acc += dt;
        const many = net.queue.length > 4, cap = net.queue.length > 40 ? 24 : many ? 6 : 2;
        let n = 0;
        while (net.queue.length && n < cap && (acc >= Rules.DT || many)) { stepNet(); acc = Math.max(0, acc - Rules.DT); n++; }
        if (!net.queue.length) acc = Math.min(acc, Rules.DT * 0.95);
        if (net.queue.length > 600) resync();
      } else if (S && !G.paused) {
        acc += dt * (G.playing ? G.speed : 1);
        if (G.playing && (saveT -= dt) <= 0) { saveT = 8; saveGame(); }
        let n = 0;
        while (acc >= Rules.DT && n < 8) { Rules.step(S); drain(); acc -= Rules.DT; n++; }
        if (n === 8) acc = 0;
        if (!G.playing && !$('title').hidden) {
          attractCam(dt);
          if (S.over) attract();
        }
      }
      if (S) world.frame(Math.min(1, acc / Rules.DT), G.paused ? 0 : dt, now / 1000);
      hud.frame(dt);
      if (G.S) audio.weather(world.sky);
      // A slow machine gives up pixels before it gives up frames. Hitches and fast-forwards do not count.
      if (dt < 0.09 && !document.hidden) {
        frames++;
        slow += (dt - slow) * 0.02;
        if (frames > 240 && slow > 0.028 && scale > (mobile ? 0.6 : 0.75)) { scale -= 0.1; frames = 0; slow = 0.016; fit(); }
      }
    }

    // ---- The menus ----------------------------------------------------------------------------------------

    // One screen of the title at a time: the main menu, a game's set-up, or the list of games.
    function screen(name) {
      for (const id of ['t-main', 't-setup', 't-rooms']) $(id).hidden = id !== 't-' + name;
      $('title').classList.toggle('on-sheet', name !== 'main');
      if (name === 'rooms') pollRooms(); else stopPolling();
    }

    try { G.name = store.get('dg-name', ''); G.look = store.get('dg-look', G.look); G.look = { film: 'daylight', charcoal: 'ink', hudson: 'ink', hills: 'ink' }[G.look] || G.look; G.showHints = !store.get('dg-played'); } catch (e) { /* no store */ }
    if (params.get('look')) G.look = params.get('look');
    // A saved look the settings offer is kept; anything else opens as pen and ink.
    if (!Looks.all().some(l => l.name === G.look)) G.look = 'ink';
    world.setLook(G.look);
    // The paper's scheme: light unless the player picks dark or the system's, kept in the browser. It is kept under
    // a new key, so a choice made when the system's was the default does not carry over.
    const darkQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    let scheme = store.get('dg-paper', 'light');
    // The sidebar's pictures: the buildings as the engine renders them, the units as axonometric line drawings in
    // the look's own inks, with the player's side on their markings.
    // A building's card shows it in the player's age, and G.picAge says which age that was.
    let renders = null;
    function pictures() {
      if (!renders) return;
      const scheme = world.look !== 'ink' ? 'daylight' : document.body.dataset.scheme === 'dark' ? 'dark' : 'light';
      const P = G.S && G.S.P[Math.max(0, G.team || 0)], age = P ? P.tech : 5, own = {};
      for (const k in Rules.BUILDINGS) own[k] = renders[world.ageKey(k, age)] || renders[k];
      G.picAge = age;
      hud.setCameos(Object.assign({}, renders, own, Axo.pictures(scheme, SLOT_CSS[Math.max(0, G.team || 0)])));
    }
    function applyScheme() {
      const dark = scheme === 'dark' || (scheme === 'auto' && !!darkQ && darkQ.matches);
      Looks.dark = dark; document.body.dataset.scheme = dark ? 'dark' : 'light';
      $('s-scheme').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === scheme));
      if (!$('t-setup').hidden) renderSetup();
      pictures();
    }
    darkQ?.addEventListener?.('change', applyScheme);
    // The settings panel, from the gear at the top right: the look, Daylight among them, and the paper's scheme.
    $('s-look').innerHTML = Looks.all().map(l => `<button data-v="${l.name}">${l.title}</button>`).join('');
    const markLook = () => $('s-look').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === world.look));
    $('s-look').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      G.look = b.dataset.v; world.setLook(G.look); markLook(); pictures(); audio.ui('click');
      store.set('dg-look', G.look);
    }));
    $('s-scheme').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      scheme = b.dataset.v; applyScheme(); audio.ui('click');
      store.set('dg-paper', scheme);
    }));
    // A newer build on the site. The page asks a minute apart and whenever it comes back into view, and offers a
    // reload; the game in hand is saved as the page goes and comes back after it. Only a stamped page served from
    // the site asks, as a file or an artifact has no version to read.
    const myBuild = ($('build').textContent || '').replace(/^Build /, '').trim();
    let updateShown = false;
    async function checkUpdate() {
      if (updateShown || myBuild.includes('__BUILD__') || !/^https?:$/.test(location.protocol) || /claude\.ai$/.test(location.hostname)) return;
      try {
        const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const v = await r.json();
        if (v.build && v.build !== myBuild) { updateShown = true; $('update').hidden = false; }
      } catch (e) { /* offline, or no version to read */ }
    }
    $('update').addEventListener('click', () => { audio.ui('click'); location.reload(); });
    setInterval(checkUpdate, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
    setTimeout(checkUpdate, 5000);
    const setOpen = open => { $('settings').hidden = !open; $('b-set').setAttribute('aria-expanded', String(open)); if (open) markLook(); };
    $('b-set').addEventListener('click', e => { e.stopPropagation(); setOpen($('settings').hidden); audio.ui('click'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settings').hidden) setOpen(false); });
    document.addEventListener('pointerdown', e => { if (!$('settings').hidden && !$('settings').contains(e.target) && e.target !== $('b-set')) setOpen(false); });

    // The map's picture in the set-up: land by height, water, ore, towns, roads and bridges, and a numbered mark at
    // each seated slot's base in its colour. Each map is worked out once and kept.
    const previews = new Map();
    let previewWant = '';
    function drawPreview(key, seed, slots) {
      const m = Rules.MAPS[key], id = m.layout + ':' + seed + ':' + (Looks.dark ? 'd' : 'l'), cv = $('preview');
      const css = Math.max(120, cv.clientWidth || 280), px = Math.round(css * Math.min(2, devicePixelRatio || 1));
      if (cv.width !== px) { cv.width = cv.height = px; }
      const g = cv.getContext('2d');
      const paint = P => {
        g.clearRect(0, 0, px, px);
        g.imageSmoothingEnabled = true;
        g.drawImage(P.img, 0, 0, px, px);
        const k = px / P.W, seats = [];
        slots.forEach((s, t) => { if (s.kind === 'human' || s.kind === 'ai' || s.kind === 'you') seats.push(t); });
        const pos = Rules.spread(seats, P.bases.length), ink = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#1f1a16';
        const r = Math.max(7, px * 0.03);
        pos.forEach((p, t) => {
          const [x, y] = P.bases[p], on = seats.includes(t);
          g.beginPath(); g.arc(x * k, y * k, on ? r : r * 0.55, 0, Math.PI * 2);
          g.lineWidth = Math.max(1.5, px / 300); g.strokeStyle = ink;
          if (on) { g.fillStyle = SLOT_CSS[t]; g.fill(); g.stroke(); g.fillStyle = '#111'; g.font = `700 ${Math.round(r * 1.25)}px "Barlow Condensed", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(t + 1), x * k, y * k + r * 0.06); }
          else { g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); }
        });
      };
      if (previews.has(id)) { previewWant = ''; paint(previews.get(id)); return; }
      previewWant = id;
      g.clearRect(0, 0, px, px);
      setTimeout(() => {
        if (previewWant !== id) return;
        const M = Rules.mapFor(seed, m.layout), W = M.W, dark = Looks.dark;
        const img = document.createElement('canvas'); img.width = img.height = W;
        const c = img.getContext('2d'), d = c.createImageData(W, W);
        const land = dark ? [[38, 38, 36], [92, 90, 84]] : [[236, 232, 214], [198, 178, 140]], water = dark ? [40, 54, 86] : [168, 184, 222], ore = dark ? [200, 154, 70] : [214, 166, 58];
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
          const c0 = y * W + x, h = Rules.terrainAt(M, x + 0.5, y + 0.5), b = M.ground[c0], i = c0 * 4;
          let col;
          if (M.ore[c0]) col = ore;
          else if (b === 7 && h < 0.3) col = water;
          else { const t = Math.max(0, Math.min(1, h / 5)); col = land[0].map((v, j) => v + (land[1][j] - v) * t); if (b & 8) col = col.map((v, j) => v * 0.82 + (dark ? [40, 70, 40] : [120, 160, 100])[j] * 0.18); }
          d.data[i] = col[0]; d.data[i + 1] = col[1]; d.data[i + 2] = col[2]; d.data[i + 3] = 255;
        }
        c.putImageData(d, 0, 0);
        const lineC = dark ? 'rgba(220,210,190,.75)' : 'rgba(60,45,30,.7)';
        c.strokeStyle = lineC; c.lineWidth = W / 220;
        for (const rd of M.roads) { c.beginPath(); rd.forEach((p, j) => j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); }
        c.lineWidth = W / 60; c.strokeStyle = dark ? 'rgba(200,190,170,.9)' : 'rgba(90,70,50,.85)';
        for (const br of M.bridges) { c.beginPath(); c.moveTo(br.x0, br.y0); c.lineTo(br.x1, br.y1); c.stroke(); }
        c.fillStyle = dark ? '#e8e0cf' : '#3a2e22';
        for (const t of M.towns) c.fillRect(t.x - W / 90, t.y - W / 90, W / 45, W / 45);
        // The rules are set back to the game behind the title.
        if (G.S) Rules.use(G.S);
        previews.set(id, { img, bases: M.bases, W });
        if (previewWant === id) { previewWant = ''; paint(previews.get(id)); }
      }, 20);
    }

    // The set-up, for a skirmish or for a game's room. Who may change what, and how a change is made, depends on
    // which: a skirmish changes here, a room asks the server, and only its host may.
    function setupView() {
      if (net.view && net.inRoom) return Object.assign({ mode: 'room' }, net.view);
      return { mode: 'skirmish', map: sk.map, seed: sk.seed, theme: sk.theme, age: sk.age || 1, weather: sk.weather || 'random', phase: 'lobby', host: true, you: sk.slots.findIndex(s => s.kind === 'you'), slots: sk.slots.map(s => s.kind === 'you' ? { kind: 'human', name: G.name || 'You', you: true } : s), watch: [] };
    }
    function renderSetup() {
      const v = setupView(), room = v.mode === 'room', edit = v.host && v.phase === 'lobby', m = Rules.MAPS[v.map];
      $('setup-h').textContent = room ? v.title : 'Skirmish';
      $('setup-code').textContent = room ? `Room ${v.code}` : '';
      $('maps').innerHTML = '';
      for (const [k, d] of Object.entries(Rules.MAPS)) {
        const b = document.createElement('button');
        b.innerHTML = `<span></span><small>${d.seats} players</small>`; b.firstChild.textContent = d.name;
        b.classList.toggle('on', k === v.map); b.disabled = !edit && k !== v.map;
        b.addEventListener('click', () => { if (!edit || k === v.map) return; audio.ui('click'); change({ map: k }); });
        $('maps').append(b);
      }
      $('map-about').textContent = m.about;
      $('seed').textContent = '#' + v.seed;
      $('reseed').disabled = !edit;
      $('m-theme').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === v.theme); b.disabled = !edit && b.dataset.v !== v.theme; });
      $('m-age').querySelectorAll('button').forEach(b => { const on = +b.dataset.v === (v.age || 1); b.classList.toggle('on', on); b.disabled = !edit && !on; });
      $('age-about').textContent = Rules.AGES[v.age || 1].note;
      $('m-weather').querySelectorAll('button').forEach(b => { const on = b.dataset.v === (v.weather || 'random'); b.classList.toggle('on', on); b.disabled = !edit && !on; });
      $('weather-about').textContent = weatherNote(v.theme, v.weather || 'random');
      drawPreview(v.map, v.seed, v.slots);
      // The slots.
      const list = $('slots');
      list.innerHTML = '';
      v.slots.forEach((s, i) => {
        const li = document.createElement('li'), chip = document.createElement('i'), who = document.createElement('span'), acts = document.createElement('span');
        const seated = s.kind === 'human' || s.kind === 'ai';
        li.className = seated ? s.kind : s.kind; chip.className = 'chip'; who.className = 'who'; acts.className = 'acts';
        chip.style.background = seated ? SLOT_CSS[i] : 'transparent';
        const mine = room ? i === v.you : !!s.you;
        if (s.kind === 'human') {
          who.textContent = s.name || 'Commander';
          const tags = [mine && room ? 'you' : '', s.host && room ? 'host' : '', s.away ? 'away' : '', s.left ? 'left' : '', s.out && v.phase !== 'lobby' ? 'out' : ''].filter(Boolean);
          if (tags.length) { const sm = document.createElement('small'); sm.textContent = tags.join(' · '); who.append(sm); }
          if (room && v.phase === 'lobby') {
            const tag = document.createElement('span');
            tag.className = 'tag ' + (s.host || s.ready ? 'ready' : 'wait'); tag.textContent = s.host ? 'host' : s.ready ? 'ready' : 'not ready';
            acts.append(tag);
            if (v.host && !mine) acts.append(button('Remove', () => send({ t: 'slot', i, kind: 'open' })));
          }
        } else if (edit) {
          const sel = document.createElement('select');
          const opts = [['open', room ? 'Open' : 'Empty'], ...(room ? [['closed', 'Closed']] : []), ...LEVELS.map(l => ['ai:' + l, 'Computer · ' + Rules.DIFFICULTY[l].name])];
          for (const [val, label] of opts) { const o = document.createElement('option'); o.value = val; o.textContent = label; sel.append(o); }
          sel.value = s.kind === 'ai' ? 'ai:' + s.level : s.kind;
          sel.addEventListener('change', () => { const [kind, level] = sel.value.split(':'); audio.ui('click'); setSlot(i, kind, level); });
          who.append(sel);
          if (s.kind === 'open') acts.append(button(room ? 'Sit here' : 'Move here', () => seat(i)));
        } else {
          who.textContent = s.kind === 'ai' ? 'Computer' : s.kind === 'open' ? 'Open' : 'Closed';
          if (s.kind === 'ai') { const sm = document.createElement('small'); sm.textContent = Rules.DIFFICULTY[s.level].name; who.append(sm); }
          if (s.kind === 'open' && room && v.phase === 'lobby') acts.append(button('Sit here', () => seat(i)));
        }
        li.append(chip, who, acts);
        list.append(li);
      });
      $('watchers').textContent = room && v.watch.length ? 'Watching: ' + v.watch.join(', ') : room && v.you < 0 ? 'You are watching. Sit in an open seat to play.' : '';
      $('chat').hidden = !room;
      // The way forward.
      const sides = v.slots.filter(s => s.kind === 'human' || s.kind === 'ai').length, waiting = v.slots.filter(s => s.kind === 'human' && !s.host && !s.ready).length;
      let why = '', can = true;
      if (sides < 2) { why = 'A game needs at least two sides. Add a computer or open a seat.'; can = false; }
      else if (room && waiting) { why = waiting === 1 ? 'Waiting for one player to be ready.' : `Waiting for ${waiting} players to be ready.`; can = false; }
      const go = $('deploy'), ready = $('ready');
      ready.hidden = true; go.hidden = false;
      if (!room) { go.textContent = 'Start'; go.disabled = !can; }
      else if (v.phase === 'game') { go.hidden = true; why = 'This game is under way.'; }
      else if (v.phase === 'over') { go.textContent = 'New game'; go.hidden = !v.host; go.disabled = false; why = v.host ? 'The game is over. Set up the next one.' : 'The game is over. The host sets up the next one.'; }
      else if (v.host) { go.textContent = 'Start'; go.disabled = !can; }
      else {
        go.hidden = true;
        if (v.you >= 0) { ready.hidden = false; const on = v.slots[v.you].ready; ready.classList.toggle('on', on); ready.textContent = on ? 'Ready' : 'Not ready'; }
        why = why || 'The host starts the game once everyone is ready.';
      }
      $('go-why').textContent = why;
    }
    function button(text, fn) { const b = document.createElement('button'); b.textContent = text; b.addEventListener('click', () => { audio.ui('click'); fn(); }); return b; }
    // A change to the set-up: made here for a skirmish, asked of the server in a room.
    function change(o) {
      if (net.inRoom) { send(Object.assign({ t: 'set' }, o)); return; }
      Object.assign(sk, o);
      if (o.map) fitSlots(sk);
      saveSk(); renderSetup();
    }
    function setSlot(i, kind, level) {
      if (net.inRoom) { send({ t: 'slot', i, kind, level }); return; }
      if (sk.slots[i].kind === 'you') return;
      sk.slots[i] = kind === 'ai' ? { kind, level } : { kind: 'open' };
      saveSk(); renderSetup();
    }
    function seat(i) {
      if (net.inRoom) { send({ t: 'seat', i }); return; }
      const you = sk.slots.findIndex(s => s.kind === 'you');
      if (sk.slots[i].kind !== 'open' || you < 0) return;
      sk.slots[i] = sk.slots[you]; sk.slots[you] = { kind: 'open' };
      saveSk(); renderSetup();
    }

    $('m-theme').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change({ theme: b.dataset.v }); }));
    $('m-age').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change({ age: +b.dataset.v }); }));
    $('m-weather').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change({ weather: b.dataset.v }); }));
    $('reseed').addEventListener('click', () => { audio.ui('click'); change({ seed: newSeed() }); });
    $('b-skirmish').addEventListener('click', () => { audio.wake(); audio.ui('click'); net.inRoom = false; screen('setup'); renderSetup(); });
    $('setup-back').addEventListener('click', () => { audio.ui('click'); if (net.inRoom) { leaveRoom(); screen('rooms'); } else screen('main'); });
    $('deploy').addEventListener('click', () => {
      audio.wake(); audio.ui('click'); store.set('dg-played', '1');
      if (!net.inRoom) { startSkirmish(); return; }
      send({ t: net.view && net.view.phase === 'over' ? 'again' : 'start' });
    });
    $('ready').addEventListener('click', () => { audio.ui('click'); const v = net.view; if (v && v.you >= 0) send({ t: 'ready', on: !v.slots[v.you].ready }); });
    $('chat-in').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const s = $('chat-in').value.trim();
      if (s) send({ t: 'chat', s });
      $('chat-in').value = '';
    });

    // The end of a game and the pause veil.
    $('again').addEventListener('click', () => {
      audio.ui('click'); $('end').hidden = true;
      if (G.online) { backToRoom(); return; }
      startSkirmish();
    });
    // A player whose base has fallen watches the rest with the whole map in view.
    $('watch').addEventListener('click', () => { audio.ui('click'); $('end').hidden = true; world.watchAll(); hud.say('Watching the rest of the game.'); });
    $('menu').addEventListener('click', () => { $('end').hidden = true; if (G.online) leaveRoom(); toTitle(); });
    $('quit').addEventListener('click', () => { G.paused = false; $('veil').hidden = true; G.playing = false; clearSave(); if (G.online) leaveRoom(); toTitle(); });
    $('resume').addEventListener('click', () => G.togglePause());
    $('b-pause').addEventListener('click', () => G.togglePause());
    $('b-mute').addEventListener('click', () => { audio.wake(); audio.toggle(); $('b-mute').classList.toggle('off', audio.muted); });
    $('b-full').addEventListener('click', () => G.fullscreen());
    $('b-speed').addEventListener('click', () => { const i = SPEEDS.indexOf(G.speed); G.speed = SPEEDS[(i + 1) % SPEEDS.length]; $('speed').textContent = G.speed + 'x'; });
    $('b-mute').classList.toggle('off', audio.muted);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); if (G.playing && !G.paused && !G.online) G.togglePause(); } });

    // ---- Games with other people ----------------------------------------------------------------------------

    // A room on the server: its lobby, then its game. The server sends each step's commands; this copy steps the
    // same world from them, and checks it against the server's every two seconds.
    const net = { ws: null, code: '', want: false, tries: 0, queue: [], hashes: new Map(), slot: -1, theme: 'desert', map: 'duel', view: null, inRoom: false, inGame: false, resyncing: false, hello: null };
    const playerId = (() => {
      let id = store.get('dg-id', '');
      if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); store.set('dg-id', id); }
      return id;
    })();
    const ROOM = 'dg-room';
    // A ping now and then tells the room this page is still here.
    setInterval(() => send({ t: 'ping', at: Date.now() }), 15000);
    const wsUrl = code => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/room/' + code;
    function send(o) { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); }
    function joinRoom(code, create) {
      if (net.ws) { net.want = false; try { net.ws.close(); } catch (e) { /* gone */ } net.ws = null; }
      net.code = code; net.create = create || null; net.inRoom = true; net.view = null; net.tries = 0;
      $('chat-log').innerHTML = '';
      store.set(ROOM, code);
      connect();
    }
    function connect() {
      net.want = true;
      const ws = net.ws = new WebSocket(wsUrl(net.code));
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        net.tries = 0; $('net').hidden = true;
        ws.send(JSON.stringify(Object.assign({ t: 'join', id: playerId, name: G.name || 'Commander' }, net.create ? { create: true, title: net.create.title, map: net.create.map } : {})));
        // A room is opened once; joining again after a drop only finds it.
        net.create = null;
      };
      ws.onmessage = ev => onNet(ev.data).catch(e => console.log('net', e.message));
      ws.onclose = () => {
        if (net.ws !== ws) return;
        net.ws = null;
        if (!net.want) return;
        if (net.inGame) { $('net').hidden = false; $('net').textContent = 'Reconnecting'; }
        setTimeout(() => { if (net.want) connect(); }, Math.min(8000, 700 * 2 ** net.tries++));
      };
    }
    async function onNet(data) {
      if (typeof data !== 'string') {
        const text = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
        const S = Rules.load(JSON.parse(text));
        net.queue = net.queue.filter(b => b[0] >= S.tick);
        net.resyncing = false;
        enterWorld(S);
        return;
      }
      const m = JSON.parse(data);
      switch (m.t) {
        case 'room': {
          const was = net.view;
          net.view = m;
          if (G.online && G.S) G.names = m.slots.map(s => s.kind === 'human' ? s.name : s.kind === 'ai' ? `Computer (${Rules.DIFFICULTY[s.level].name})` : '');
          // The host set up the next game: everyone still in the game's picture goes back to the room.
          if (m.phase === 'lobby' && net.inGame) backToRoom();
          if (!net.inGame) { if ($('t-setup').hidden || !was) screen('setup'); renderSetup(); }
          drawRoster();
          break;
        }
        case 'chatlog': $('chat-log').innerHTML = ''; for (const c of m.list) chatLine(c.n, c.s); break;
        case 'chat': chatLine(m.n, m.s); if (G.online && net.inGame) hud.say(`${m.n}: ${m.s}`); break;
        case 'hello': net.slot = m.slot; net.theme = m.theme || 'desert'; net.map = m.map || 'duel'; net.queue = []; net.hashes.clear(); break;
        case 'ticks': for (const b of m.b) net.queue.push(b); if (m.h) net.hashes.set(m.h[0], m.h[1]); break;
        case 'gone': net.want = false; net.inRoom = false; net.view = null; store.set(ROOM, null); if (!$('title').hidden && !$('t-setup').hidden) screen('rooms'); toast('That game has closed.'); break;
        case 'taken': net.want = false; net.inRoom = false; toast('This game was opened in another window.'); break;
        case 'moved': chatLine('', 'The host moved you out of your seat. You are watching.'); break;
      }
    }
    function chatLine(n, s) {
      const log = $('chat-log'), p = document.createElement('div');
      if (n) { const b = document.createElement('b'); b.textContent = n + ':'; p.append(b, document.createTextNode(s)); }
      else { p.className = 'sys'; p.textContent = s; }
      log.append(p);
      while (log.children.length > 60) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    function toast(s) { if (!$('title').hidden) $('go-why').textContent = s; else hud.say(s, 'bad'); const n = $('rooms-none'); if (n && !$('t-rooms').hidden) n.textContent = s; }
    function stepNet() {
      const S = G.S, [tick, list] = net.queue.shift();
      if (tick < S.tick) return;
      if (tick > S.tick) { resync(); return; }
      S.cmds = list.map(([team, c]) => ({ team, c, at: tick }));
      Rules.step(S); drain();
      const h = net.hashes.get(S.tick);
      if (h !== undefined) {
        for (const k of net.hashes.keys()) if (k <= S.tick) net.hashes.delete(k);
        if (Rules.hashOf(S) !== h) { console.log('@desync at tick ' + S.tick); resync(); }
      }
    }
    function resync() {
      if (net.resyncing || !net.ws || net.ws.readyState !== 1) return;
      net.resyncing = true; net.queue = [];
      send({ t: 'resync' });
    }
    // The world from the server: a game starting, a player coming back to one, or a fresh copy after a drop.
    function enterWorld(S) {
      const first = !net.inGame;
      G.online = true; net.inGame = true;
      G.mapKey = net.map; G.theme = net.theme;
      const v = net.view;
      G.names = v ? v.slots.map(s => s.kind === 'human' ? s.name : s.kind === 'ai' ? `Computer (${Rules.DIFFICULTY[s.level].name})` : '') : [];
      $('net').hidden = true;
      document.body.classList.add('online');
      if (first) {
        clearSave();
        enterPlay(S, net.theme, net.slot);
        if (net.slot >= 0) hud.say(`${Rules.MAPS[net.map].name}. ${S.seats.length - 1 === 1 ? 'One enemy' : S.seats.length - 1 + ' enemies'} on the map. Good hunting, ${G.name || 'Commander'}.`, 'good');
        else hud.say('You are watching this game.', '');
      } else { const cam = { ...world.cam }; begin(S, net.theme, net.slot); Object.assign(world.cam, cam); }
      drawRoster();
    }
    // From a finished game back to its room, which the host sets up again.
    function backToRoom() {
      net.inGame = false; G.online = false; G.playing = false; net.queue = [];
      document.body.classList.remove('online', 'in-game');
      $('end').hidden = true; $('veil').hidden = true; $('roster').hidden = true;
      $('title').hidden = false;
      screen('setup'); renderSetup();
      attract();
    }
    function leaveRoom() {
      if (net.ws) send({ t: 'leave' });
      net.want = false; net.inRoom = false; net.inGame = false; net.view = null;
      if (net.ws) { const ws = net.ws; net.ws = null; setTimeout(() => { try { ws.close(); } catch (e) { /* gone */ } }, 200); }
      G.online = false; net.queue = [];
      store.set(ROOM, null);
      document.body.classList.remove('online');
      $('roster').hidden = true; $('net').hidden = true;
    }
    // Who holds each side of the game being played, in their colours.
    function drawRoster() {
      const box = $('roster'), S = G.S;
      if (!G.playing || !S || !S.seats || (S.seats.length < 3 && !G.online)) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = '';
      const v = G.online ? net.view : null;
      for (const t of S.seats) {
        const row = document.createElement('div'), dot = document.createElement('i'), nm = document.createElement('span'), s = v && v.slots[t];
        dot.style.background = SLOT_CSS[t];
        nm.textContent = youName(t) + (t !== G.team && s && s.left ? ' (left)' : t !== G.team && s && s.away ? ' (away)' : '');
        row.className = (S.P[t].alive ? '' : 'down ') + (G.names[t] && G.names[t].startsWith('Computer') ? 'cpu' : '');
        row.append(dot, nm); box.append(row);
      }
    }

    // The list of games, asked for every few seconds while it shows.
    let hasServer = false, pollT = null;
    function stopPolling() { if (pollT) { clearTimeout(pollT); pollT = null; } }
    async function pollRooms() {
      stopPolling();
      try {
        const r = await fetch('/api/rooms', { cache: 'no-store' }), j = await r.json();
        drawRooms(j.rooms || []);
      } catch (e) { $('rooms-none').hidden = false; $('rooms-none').textContent = 'The list of games cannot be reached just now.'; }
      if (!$('t-rooms').hidden) pollT = setTimeout(pollRooms, 3000);
    }
    function drawRooms(list) {
      const body = $('rooms').tBodies[0];
      body.innerHTML = '';
      $('rooms-none').hidden = list.length > 0;
      $('rooms-none').textContent = 'No games are open. Open one, and it shows here for others to join.';
      $('rooms').hidden = !list.length;
      for (const r of list) {
        const tr = document.createElement('tr'), cells = [r.title, r.host, r.mapName, ''].map(t => { const td = document.createElement('td'); td.textContent = t; return td; });
        cells[3].innerHTML = `${r.humans + r.ais}/${r.seats} <small>${r.phase === 'lobby' ? (r.open ? r.open + ' open' : 'full') : 'playing'}</small>`;
        const td = document.createElement('td');
        td.append(button(r.phase === 'lobby' && r.open ? 'Join' : 'Watch', () => { G.name = callsign(); joinRoom(r.code); }));
        tr.append(...cells, td); body.append(tr);
      }
    }
    const callsign = () => { const n = ($('callsign').value || '').trim().slice(0, 16) || 'Commander'; store.set('dg-name', n); return n; };
    const roomCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.random() * a.length | 0]; return s; };
    $('b-multi').addEventListener('click', () => { audio.wake(); audio.ui('click'); screen('rooms'); });
    $('rooms-back').addEventListener('click', () => { audio.ui('click'); screen('main'); });
    $('create').addEventListener('click', () => {
      audio.wake(); audio.ui('click');
      G.name = callsign();
      joinRoom(roomCode(), { title: ($('room-title').value || '').trim() || `${G.name}'s game`, map: sk.map });
    });
    $('callsign').addEventListener('change', () => { G.name = callsign(); });
    // The title offers games with other people only when this page is served by its server.
    async function probe(n = 0) {
      if (!/^https?:$/.test(location.protocol)) return;
      // A server waking up may fail the first ask, so a network error or 5xx is asked again.
      const again = () => { if (n < 4) setTimeout(() => probe(n + 1), 1500 * (n + 1)); };
      try {
        const r = await fetch('/api/hello', { cache: 'no-store' });
        if (r.status >= 500) return again();
        if (!r.ok) return;
        const j = await r.json();
        if (!j.ok) return;
        hasServer = true;
        $('b-multi').hidden = false;
        // A player who was in a room when the page went comes back to it.
        const code = store.get(ROOM, '');
        if (code && !G.playing) { G.name = G.name || 'Commander'; joinRoom(code); }
      } catch (e) { again(); }
    }

    function toTitle() {
      document.body.classList.remove('in-game');
      G.playing = false;
      $('title').hidden = false;
      screen('main');
      attract();
      fit();
    }

    function boot() {
      fit();
      applyScheme();
      if (!restore()) { attract(); screen('main'); }
      $('callsign').value = G.name;
      probe();
      const list = [
        ...Object.keys(Rules.BUILDINGS).filter(k => k !== 'hq').map(k => ({ kind: k, b: true })), { kind: 'hq', b: true },
        ...world.buildingKeys.filter(k => k.includes('@')).map(k => ({ kind: k, b: true })),
        ...Object.keys(Rules.UNITS).filter(k => !Rules.UNITS[k].men).map(k => ({ kind: k })),
        ...Object.keys(Rules.UNITS).filter(k => Rules.UNITS[k].men).map(k => ({ kind: k, man: true })),
      ];
      renders = world.cameos(list, 0);
      G.pictures = pictures;
      pictures();
      document.body.classList.add('ready');
      G.save = saveGame;
      window.__game = G; window.__hud = hud; window.__net = net;
      requestAnimationFrame(loop);
    }
    return { boot, G };
  }

  return { create };
})();

// A film-studio page expects this, though this game has a page of its own.
const DeadGround = Game;
