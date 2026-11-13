// Mapmaker's War, the running game. Boots the picture, plays a live battle behind the title, and steps
// the world on a fixed clock while the picture eases between steps.
const Game = (() => {
  const $ = id => document.getElementById(id);
  // Each call: what is written in the log, its tone, and what is spoken when that differs, as a recorded line.
  const VOICE = {
    buildready: ['Construction complete', ''], unitready: ['Unit ready', ''], lowpower: ['Low power, build a power plant', 'bad', 'Low power'], powerok: ['Power restored', 'good'], reconlost: ['Recon aircraft lost', 'bad'], reconover: ['Enemy recon aircraft overhead', 'bad'], sheltered: ['The general is safe in the capitol', 'good', 'General sheltered'], baseattack: ['Our base is under attack', 'bad'],
    truckattack: ['Ore truck under attack', 'bad'], nosupply: ['Insufficient supply', 'bad'], nooil: ['Insufficient oil', 'bad'], newtech: ['New technology available', ''],
    towntaken: ['Town captured', 'good'], townlost: ['Town lost', 'bad'], captured: ['Building captured', 'good'], lostbuilding: ['Building lost', 'bad'],
    siloready: ['Missile ready', 'good'], missile: ['Warning, missile launch detected', 'bad'], upgraded: ['Upgrade complete', 'good'],
  };
  // The same calls before the Industrial Age, as a herald or a captain would give them, so the early ages do not
  // speak like a radio.
  const VOICE_OLD = {
    buildready: ['The work is done', ''], unitready: ['At your command', ''], baseattack: ['To arms, we are attacked', 'bad'],
    truckattack: ['Our carts are attacked', 'bad'], nosupply: ['We lack the supplies', 'bad'], newtech: ['New learning is ours', ''],
    towntaken: ['The town is ours', 'good'], townlost: ['The town is lost', 'bad'], captured: ['It is ours now', 'good'], lostbuilding: ['A building has fallen', 'bad'],
    sheltered: ['Our general is within the walls', 'good'],
    upgraded: ['Our craft is bettered', 'good'],
  };
  // What each turn of the weather means, written and spoken.
  const SKY_SAY = {
    rain: ['Rain clouds. Wheeled vehicles bog down off the roads under them.', '', 'Rain'], storm: ['Storm. All aircraft are grounded.', 'bad', 'Storm. Aircraft grounded'],
    fog: ['Fog. Sight is cut short.', '', 'Fog'], snow: ['Snow. Everything moves slower.', '', 'Snow'], stormsoon: ['A storm is coming. Aircraft will be grounded.', 'bad', 'Storm warning'],
    clear: ['The weather clears.', 'good', ''], cloud: ['Clouding over.', '', ''],
    sand: ['A dust storm sweeps in on the wind. Under its dust sight is cut short, men and wheels slow and aircraft stay down.', 'bad', 'Dust storm'],
    sandsoon: ['A dust storm is coming on the wind.', 'bad', 'Dust storm warning'],
  };
  // What is said as heavy weather passes part way through its spell.
  const SKY_PASS = {
    storm: ['The storm passes. Aircraft can fly again.', 'good', 'Storm passing'], sand: ['The dust storm passes. Aircraft can fly again.', 'good', 'Dust storm passing'],
    snow: ['The snow stops.', 'good', ''], fog: ['The fog lifts.', 'good', ''],
  };
  // What a theatre's weather brings under a setting, for the set-up.
  const SKY_OF = { desert: 'Dust storms, little rain and no snow.', steppe: 'Rain, thunderstorms and fog, with a little snow.', winter: 'Deep snow and fog, and no rain.' };
  const WEATHER_OF = { random: 'In their usual measure.', mild: 'Mostly fair, with no storms of any kind.', harsh: 'Often, and the storms come hard.' };
  // What each choice of resources means, for the set-up.
  const WIN_NOTE = { conquest: 'A side is out when its last building falls.', regicide: 'Each side starts with a general. A side is out when its general falls, or its last building.',
    koth: `Nothing is built. Each side starts with a home town, its keep, which is never taken, and the towns it holds raise its soldiers. Footpaths climb to hills walled by cliffs. Each side starts with ${Rules.KOTH_SCORE}, and every 10 seconds a side holding more hills than another takes 5 from its score for each hill more. A side at 0 is out. A side holding every hill and every town but the others' keeps for ${Rules.KOTH_HOLD / Rules.HZ} seconds wins. Played on ${Object.values(Rules.MAPS).filter(m => m.koth).map(m => m.name).join(', ')}.` };
  const RES_NOTE = { std: 'Ore, oil and power are dug, pumped and built for, and everything costs.', free: 'Nothing costs a thing and power never runs short. Only build times and the fighting count.' };
  const weatherNote = (theme, w) => w === 'off' ? 'Fair skies all game.' : `${SKY_OF[theme] || ''} ${WEATHER_OF[w] || ''}`;

  function bestVoice(vs) {
    const score = v => {
      const n = v.name;
      if (!/^en/i.test(v.lang || '')) return -99;
      let s = /en[-_](GB|US)/i.test(v.lang) ? 1 : 0;
      if (/Natural|Neural|Online|Premium|Enhanced/i.test(n)) s += 6;
      if (/Google/i.test(n)) s += 4;
      if (/Samantha|Ava|Allison|Susan|Serena|Daniel|Karen|Moira|Tessa|Aria|Jenny|Libby|Sonia|Guy|Ryan/i.test(n)) s += 2;
      if (/Desktop|Compact|eSpeak|Zarvox|Trinoids|Whisper|Bells|Boing|Bubbles|Cellos|Organ|Jester|Wobble|Bahh|Albert|Fred|Ralph|Junior|Superstar|Bad News|Good News|Grandma|Grandpa|Rocko|Shelley|Flo|Eddy|Reed|Sandy/i.test(n)) s -= 10;
      return s;
    };
    let best = null, bs = -99;
    for (const v of vs) { const s = score(v); if (s > bs) { bs = s; best = v; } }
    return best;
  }

  // Sound. Effects are decoded once and played with a little pan and pitch from where they happen. A browser driven
  // by a test harness stays silent, sound and voice alike.
  function makeAudio(data, world) {
    let ctx = null, master = null, bank = {}, ambient = null, voiceT = 0, rainSrc = null, rainGain = null, held = false;
    const robot = !!navigator.webdriver;
    // A sound is in the page, or on the site as a file of its own, fetched when it is first wanted.
    const files = typeof SOUND_FILES === 'object' && SOUND_FILES ? SOUND_FILES : {}, has = k => !!(data[k] || files[k]);
    const decode = (k, then, fail) => {
      const no = fail || (() => {});
      if (!data[k]) { if (files[k]) fetch(files[k]).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(b => ctx.decodeAudioData(b, then, no)).catch(no); else no(); return; }
      const bin = atob(data[k]), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      ctx.decodeAudioData(buf.buffer, then, no);
    };
    // The score: pieces that take turns, each played through once and faded into a quiet spell of wind. A quiet
    // field gets a calm piece and fighting in view a battle piece, which cuts in on a calm one. Iron, heavy metal,
    // waits for the Industrial Age. A piece is decoded only when it is due and let go when it ends, as a whole score
    // decoded at once would hold 100 MB.
    const PIECES = [
      { k: 'm_dust' }, { k: 'm_vigil' }, { k: 'm_steppe' },
      { k: 'm_siege', war: true }, { k: 'm_charge', war: true }, { k: 'm_assault', war: true }, { k: 'm_iron', war: true, age: 4 },
    ].filter(p => has(p.k));
    const lazy = k => PIECES.some(p => p.k === k);
    const MUSIC_GAIN = 0.36, sc = { cur: null, last: '', next: 1, heat: 0, loading: false };
    function fadeOut(c, d, gap) {
      const now = ctx.currentTime;
      c.g.gain.cancelScheduledValues(now); c.g.gain.setValueAtTime(c.g.gain.value, now); c.g.gain.linearRampToValueAtTime(0, now + d);
      c.src.stop(now + d + 0.05);
      sc.cur = null; sc.next = now + d + gap;
    }
    function startPiece(p, b) {
      const now = ctx.currentTime, src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = b;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(MUSIC_GAIN, now + 3);
      src.connect(g); g.connect(master); src.start(now);
      sc.cur = { p, src, g, t0: now, end: now + b.duration }; sc.last = p.k;
    }
    function scoreTick() {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime, c = sc.cur;
      // Heat is the fighting heard of late, half gone in ten seconds.
      sc.heat *= 0.933;
      const war = sc.heat > 4;
      if (!a.musicOn || a.muted) { if (c) fadeOut(c, 1.5, 1); return; }
      if (c) {
        if (war && !c.p.war && now - c.t0 > 15) fadeOut(c, 3, 0.5);
        else if (now >= c.end - 5) fadeOut(c, 5, war ? 3 + Math.random() * 5 : 25 + Math.random() * 45);
        return;
      }
      if (now < sc.next || sc.loading || !PIECES.length) return;
      const pool = PIECES.filter(p => !!p.war === war && (p.age || 0) <= a.age && p.k !== sc.last);
      const p = pool[Math.floor(Math.random() * pool.length)] || PIECES.find(q => q.k !== sc.last) || PIECES[0];
      sc.loading = true;
      decode(p.k, b => { sc.loading = false; if (a.musicOn && !a.muted && !sc.cur) startPiece(p, b); }, () => { sc.loading = false; sc.next = ctx.currentTime + 30; });
    }
    const last = {}, a = {
      muted: false, ready: false, musicOn: true, age: 1,
      wake() {
        if (robot) return;
        if (!ctx) {
          const C = window.AudioContext || window.webkitAudioContext;
          if (!C) return;
          ctx = new C(); master = ctx.createGain(); master.gain.value = a.muted ? 0 : 0.8; master.connect(ctx.destination);
          for (const k of new Set([...Object.keys(data), ...Object.keys(files)])) if (!lazy(k)) decode(k, b => { bank[k] = b; if (k === 'wind') a.wind(); });
          setInterval(scoreTick, 1000);
        }
        if (ctx.state === 'suspended' && !held) ctx.resume();
      },
      // A paused game is silent: the whole sound stops where it is, music, wind, rain and effects alike, and takes
      // up again from there on resume. Nothing new is queued meanwhile, nor spoken.
      hold(on) {
        if (on === held) return;
        held = on;
        if (on) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* no voice here */ } }
        if (ctx) on ? ctx.suspend() : ctx.resume();
      },
      // Fighting heard, which turns the score to battle.
      fight(n = 1) { sc.heat = Math.min(40, sc.heat + n); },
      // What the score is doing, for tests.
      score() { return { piece: sc.cur ? sc.cur.p.k : null, heat: Math.round(sc.heat * 10) / 10, t: ctx ? Math.round(ctx.currentTime) : 0, next: Math.round(sc.next), pieces: PIECES.map(p => p.k) }; },
      setMusic(on) { a.musicOn = on; try { localStorage.setItem('dg-music', on ? '' : 'off'); } catch (e) { /* no store */ } scoreTick(); },
      play(name, o = {}) {
        if (!ctx || !bank[name] || held) return;
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
      // Status calls, one at a time. A call recorded by voices.py is played as it is: a herald's before the
      // Industrial Age (old) and a radio operator's after. Any other is spoken in the browser's own voice at its own
      // pitch and pace, the most natural English voice the machine has: a neural, online or premium one first, and
      // never a novelty or an old desktop voice, which sound robotic.
      voice(k, text, old) {
        const sp = window.speechSynthesis, now = performance.now();
        if (robot || a.muted || held || !text || now < voiceT) return;
        const clip = `v_${old ? 'h' : 'r'}_${text.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')}`;
        if (ctx && bank[clip]) { a.play(clip, { gain: 0.9, gap: 0 }); voiceT = now + 1800; return; }
        if (!sp) return;
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.voice = bestVoice(sp.getVoices());
          u.rate = 1; u.pitch = 1; u.volume = 0.85;
          sp.cancel(); sp.speak(u);
          voiceT = now + 1800;
        } catch (e) { /* no voice here */ }
      },
      ack(u, attack) { if (!u) return; a.play(attack ? 'ack2' : 'ack1', { gain: 0.34, gap: 0.5, vary: 0.08 }); },
      wind() { if (ambient || !bank.wind) return; ambient = ctx.createBufferSource(); ambient.buffer = bank.wind; ambient.loop = true; const g = ctx.createGain(); g.gain.value = 0.22; ambient.connect(g); g.connect(master); ambient.start(); },
      // Rain under everything, as loud as it is raining where the view is.
      weather(sky) {
        if (!ctx || !bank.rain) return;
        if (!rainSrc) { rainSrc = ctx.createBufferSource(); rainSrc.buffer = bank.rain; rainSrc.loop = true; rainGain = ctx.createGain(); rainGain.gain.value = 0; rainSrc.connect(rainGain); rainGain.connect(master); rainSrc.start(); }
        rainGain.gain.value = Math.min(1, sky.rainV) * (0.28 + 0.2 * sky.stormV);
      },
      toggle() { a.muted = !a.muted; if (master) master.gain.value = a.muted ? 0 : 0.8; try { localStorage.setItem('dg-mute', a.muted ? '1' : ''); } catch (e) { /* no store */ } },
    };
    try { a.muted = !!localStorage.getItem('dg-mute'); a.musicOn = localStorage.getItem('dg-music') !== 'off'; } catch (e) { /* no store */ }
    // A browser lets sound start only on a click or a key. Any first one does, so a game taken up again from its
    // save, or rejoined, has its sound and music back without a menu button being pressed.
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => a.wake(), { capture: true });
    return a;
  }

  function create() {
    const canvas = $('gl'), view = $('view');
    const mobile = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
    const params = new URLSearchParams(location.search);
    const world = World.create(THREE, canvas, { low: mobile, keep: params.has('keep') });
    // The veil's words, for a pause or for leaving. Online nothing waits, so it does not say paused, and a player
    // still in the fight who leaves forfeits, so it says that.
    function veilFor(leave) {
      const forfeits = G.online && G.S && G.team >= 0 && G.S.P[G.team] && G.S.P[G.team].alive;
      $('veil-h').textContent = leave ? (forfeits ? 'Forfeit the game?' : 'Leave the game?') : G.online ? 'The battle goes on' : 'Paused';
      $('resume').textContent = leave ? 'Keep playing' : 'Resume';
      $('quit').textContent = forfeits ? 'Forfeit' : leave ? 'Leave' : 'Quit to menu';
    }
    const G = {
      S: null, team: 0, playing: false, paused: false, speed: 1, showHints: true, audio: null, world, theme: 'desert', look: 'ink', online: false, name: '',
      // Each slot's name and the map of the game being played.
      names: [], mapKey: 'duel',
      // Online the world never pauses, so the veil only offers the way out.
      togglePause() { if (!G.playing) return; veilFor(false); if (G.online) { $('veil').hidden = !$('veil').hidden; return; } G.paused = !G.paused; $('veil').hidden = !G.paused; G.audio.hold(G.paused); },
      // The way out from the bar, one click and a confirmation. A skirmish waits while it is asked.
      askLeave() { if (!G.playing) return; veilFor(true); if (!G.online) { G.paused = true; G.audio.hold(true); } $('veil').hidden = false; },
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

    // A resize clears the canvas, so a size is only applied at the top of a frame, just before it is drawn, and never
    // when nothing has changed. Shown between a resize and a draw, the cleared canvas flashes.
    let scale = 1, over = 1, overNew = true, fitDue = true, fitKey = '', sizeAt = '', settleT = 0;
    const OVER_PX = 3840 * 2160;
    function fit() { fitDue = true; }
    // The canvas's own size in device pixels, as the browser lays it out. The CSS size times the pixel ratio can miss
    // it by a pixel at a ratio like 1.25, and the browser then stretches the whole picture by that pixel, which
    // softens every pen line. A browser that cannot say gets the CSS size times the ratio.
    let devPx = null;
    try {
      new ResizeObserver(es => {
        const s = es[es.length - 1].devicePixelContentBoxSize;
        if (s && s[0]) { devPx = [s[0].inlineSize, s[0].blockSize]; fit(); }
      }).observe(canvas, { box: 'device-pixel-content-box' });
    } catch (e) { /* not offered */ }
    // A graphics card or its driver may drop the drawing under load. The page asks for it back, which three.js answers
    // by making everything again, and this machine draws at the screen's own pixels from then on. If it does not come
    // back, the page says so, as otherwise only the labels over the picture would be left.
    let lostT = 0;
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      store.set('dg-over', 'off'); over = 1; scale = 1; fitKey = ''; fit();
      clearTimeout(lostT);
      lostT = setTimeout(() => {
        $('loading-word').textContent = 'PICTURE LOST';
        $('loading-note').textContent = 'The graphics card dropped the picture and has not given it back. Reload the page to draw it again.';
        document.body.classList.add('lost');
      }, 4000);
    });
    canvas.addEventListener('webglcontextrestored', () => { clearTimeout(lostT); document.body.classList.remove('lost'); fitKey = ''; fit(); });
    function applyFit() {
      fitDue = false;
      const r = view.getBoundingClientRect(), w = Math.max(2, r.width), h = Math.max(2, r.height), dpr = devicePixelRatio || 1;
      // Past a ratio of 2 the picture is drawn at 2 and stretched, as more pixels than that cost more than they show.
      const base = Math.min(dpr, 2), known = devPx && Math.abs(devPx[0] - w * dpr) < 3 && Math.abs(devPx[1] - h * dpr) < 3;
      const ovPx = known ? devPx.map(v => Math.max(2, Math.round(v * base / dpr))) : [Math.round(w * base), Math.round(h * base)];
      // A Sharp picture on a screen of under 2 is drawn at up to 2 and shrunk onto the canvas, as at the screen's own
      // pixels the pen lines and edges step. It is held to a 4K screen's pixels, and to the screen's own on a machine
      // whose graphics have dropped the picture. It starts at the screen's own pixels and earns the rest by frames that
      // keep pace, so a weak graphics card is never handed them all at once.
      over = picture === 'fast' || store.get('dg-over') === 'off' ? 1 : Math.max(1, Math.min(2 / base, Math.sqrt(OVER_PX / (ovPx[0] * ovPx[1]))));
      if (over > 1 && overNew) { overNew = false; scale = 1 / over; }
      const k = over * scale, px = ovPx.map(v => Math.max(2, Math.round(v * k))), key = `${w}x${h}:${px}:${ovPx}`;
      if (key === fitKey) return;
      // While the view's size keeps changing, as a window is dragged, the camera follows at once and the buffers are
      // made again only once the size has held for a moment, as making them every frame stalls a slow driver.
      const sizeKey = `${w}x${h}:${ovPx}`;
      if (fitKey && sizeKey !== sizeAt) {
        sizeAt = sizeKey; world.reshape(w, h, ovPx); hud.layoutMini();
        clearTimeout(settleT); settleT = setTimeout(fit, 180);
        return;
      }
      fitKey = key; sizeAt = sizeKey;
      // A screen of under 2 whose picture is drawn at under half again its pixels has its edges smoothed, as the
      // shrink alone leaves them stepped there.
      const aa = base < 2 && k < 1.5;
      // The share of full size drawn, k, tells the world a machine that gave up pixels.
      world.resize(w, h, px[0] / w, k, px, ovPx, aa);
      hud.layoutMini();
      $('s-pic-note').textContent = `Drawn at ${px[0]} by ${px[1]}${k > 1.01 ? `, ${k.toFixed(1)} times the screen's own pixels` : k < 0.99 ? `, ${Math.round(k * 100)}% of full size` : ', full size'}${aa ? ', edges smoothed' : ''}.`;
    }
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
    // It is played forward in slices of a frame's time, so the title is up at once and stays answering. In the pen and
    // ink look the first battle is shown at once and drawn in as it is played forward, so the drawing is the page's
    // sign of loading: its land pencilled and inked as the battle is made ready, and its units and buildings inked
    // once it is. Otherwise the battle shows when it has caught up, fading in over the paper the first time.
    const AHEAD = 20 * 60 * 4.5;
    let ahead = null, ovDraw = false;
    function attract() {
      const S = Rules.newGame({ seed: 40 + (Date.now() / 86400000 | 0) % 40 });
      S.ais.push(AI.create(0, 'veteran'), AI.create(1, 'veteran'));
      ahead = { S, n: 0 };
      if (G.S || world.look !== 'ink') return;
      ahead.draw = true;
      begin(S, 'desert', -1);
      world.focus(Rules.W / 2, Rules.H / 2, 110);
      world.drawIn(0, 0, 0);
      ovDraw = true; $('ov').style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => $('view').classList.remove('dawn')));
    }
    // The labels over the map come in as the last of the land is drawn.
    function drawOv() {
      if (!ovDraw) return;
      const d = world.drawn;
      $('ov').style.opacity = d >= 1 ? '' : String(Rules.clamp((d - 0.6) / 0.4, 0, 1));
      if (d >= 1) ovDraw = false;
    }
    function attractAhead() {
      if (!ahead) return;
      if (G.playing) { ahead = null; return; }
      const S = ahead.S, t0 = performance.now(), slice = G.S && !ahead.draw ? 14 : 30;
      while (ahead.n < AHEAD && performance.now() - t0 < slice) { Rules.step(S); S.ev.length = 0; ahead.n++; }
      // The drawing keeps pace with the battle made ready, and is finished, with its units and buildings, when it is.
      if (ahead.draw) world.drawIn(ahead.n < AHEAD ? 0.97 * ahead.n / AHEAD : 1, ahead.n < AHEAD ? 0 : 1);
      if (ahead.n < AHEAD) return;
      if (ahead.draw) { ahead = null; setTimeout(() => { cameoDue = true; }, 1200); return; }
      ahead = null;
      const first = !G.S;
      begin(S, 'desert', -1);
      S.ev.length = 0;
      world.focus(Rules.W / 2, Rules.H / 2, 110);
      if (first) { requestAnimationFrame(() => $('view').classList.remove('dawn')); setTimeout(() => { cameoDue = true; }, 1200); }
    }

    // Into a game, local or online: the title goes and the view goes to the player's base.
    function enterPlay(S, theme, team) {
      $('title').hidden = true; $('end').hidden = true; $('veil').hidden = true;
      $('view').classList.remove('dawn');
      // A game begun while the title's map is still being drawn in is shown whole at once.
      world.drawIn(1, 1, 1); ovDraw = false; $('ov').style.opacity = '';
      begin(S, theme, team);
      cameoDue = true; cameos();
      pictures();
      hud.reset();
      G.playing = true; G.paused = false; G.outcome = null; G.falls = {}; G.plate = null;
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
    sk.theme = Rules.theatreOf(sk.map, sk.theme);
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
      const S = Rules.newGame({ seed: params.has('seed') ? +params.get('seed') : sk.seed, layout: m.layout, seats, shuffle: Math.random, age: sk.age || 1, theatre: sk.theme, weather: sk.weather || 'random', free: sk.res === 'free', regicide: sk.win === 'regicide', koth: sk.win === 'koth' && !!m.koth });
      sk.slots.forEach((s, t) => { if (s.kind === 'ai') S.ais.push(AI.create(t, s.level, S.seed + t)); });
      G.names = sk.slots.map(s => s.kind === 'you' ? (G.name || 'You') : s.kind === 'ai' ? `Computer (${Rules.DIFFICULTY[s.level].name})` : '');
      G.theme = sk.theme; G.mapKey = sk.map; G.online = false;
      clearSave();
      enterPlay(S, G.theme, you);
      saveT = 0;
      const foes = seats.length - 1;
      hud.say(`Deployed: ${m.name}, ${THEATRES[G.theme]}, the ${Rules.AGES[S.age0].name} Age${S.free ? ', unlimited resources' : ''}${S.regicide ? ', Regicide' : ''}${S.koth ? ', King of the Hill' : ''}. ${foes === 1 ? 'One enemy' : foes + ' enemies'} on the map. Good hunting, Commander.`);
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
      // The sound and the music as they were left, where the browser lets sound start before a click.
      audio.wake();
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
    // The plate's caption, worded as a history book words one: who fell, what, near which town, in which age and
    // how far into the fighting.
    function plateOf(p) {
      const S = G.S;
      if (!p || !S) return null;
      const P = S.P[p.team], age = Rules.AGES[P ? P.tech : 1].name, m = Math.max(1, Math.round(p.tick / Rules.HZ / 60));
      let ti = 0, td = 1e9;
      S.map.towns.forEach((t, i) => { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < td) { td = d; ti = i; } });
      const who = p.team === G.team ? 'your' : `${G.names[p.team] || `Side ${p.team + 1}`}'s`;
      const what = p.regicide ? 'general' : p.kind ? Rules.nameOf(p.kind, P ? P.tech : 1).toLowerCase() : 'last stand';
      return { url: p.url, caption: `The fall of ${who} ${what} near ${Rules.townName(S, ti)}, in the ${age} Age, ${m} minute${m === 1 ? '' : 's'} into the fighting.` };
    }
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
        // Sides that gave up are named, so a win by forfeit reads as one.
        const quit = S.P.filter(P => P.forfeit && P.team !== G.team).map(P => G.names[P.team]).filter(Boolean);
        if (quit.length) $('end-sub').textContent = `${quit.join(', ')} forfeited · ` + $('end-sub').textContent;
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
      Report.show($('end-report'), { S, name: youName, plate: plateOf(G.plate), mapPicture });
    }

    // Hands what the rules did to the picture, the sound and the reports.
    const WSND = { rifle: ['rifle', 0.34, 0.04], hmg: ['hmg', 0.4, 0.06], auto: ['auto', 0.5, 0.08], cannon: ['cannon', 0.8, 0.06], flak: ['flak', 0.45, 0.08], missile: ['missile', 0.6, 0.1], rocket: ['rocket', 0.5, 0.05], rail: ['rail', 0.9, 0.1], sniper: ['sniper', 0.7, 0.1], bow: ['bow', 0.45, 0.05], xbow: ['xbow', 0.45, 0.06], longbow: ['longbow', 0.45, 0.06], clash: ['clash', 0.35, 0.06], musket: ['musket', 0.55, 0.05], catapult: ['catapult', 0.7, 0.1], pulse: ['pulse', 0.35, 0.04] };
    // Whether the player's side is still before the Industrial Age, when the calls come from a herald, not a radio.
    const oldAge = () => !!(G.S && G.S.P[Math.max(0, G.team)] && G.S.P[Math.max(0, G.team)].tech < Rules.POWER_AGE);
    // The game a little way back, saved every PAST_EVERY ticks and kept for PAST_KEEP of them, so the report's plate of a
    // fall can show the fight a quarter of a minute before it.
    const PAST_EVERY = 5 * Rules.HZ, PAST_KEEP = 5, PAST_BACK = 15 * Rules.HZ, PLATE_DIST = 52;
    let past = [];
    function keepPast(S) {
      if (!G.playing || S.tick % PAST_EVERY || (past.length && past[past.length - 1].tick === S.tick)) return;
      if (past.length && past[0].S !== S) past = [];
      past.push({ tick: S.tick, S, o: Rules.save(S) });
      if (past.length > PAST_KEEP) past.shift();
    }
    // The game as it stood about PAST_BACK before now, loaded beside it on the same map, or null.
    function pastState(S) {
      const want = S.tick - PAST_BACK, at = past.filter(p => p.S === S && p.tick <= want).pop() || past.find(p => p.S === S);
      try { return at ? Rules.load(at.o, S.map) : null; } catch (e) { return null; }
    }
    function drain() {
      const S = G.S, ev = S.ev;
      keepPast(S);
      if (S.P[Math.max(0, G.team)]) audio.age = S.P[Math.max(0, G.team)].tech;
      for (const e of ev) {
        world.event(e);
        const heard = world.visible(e.x ?? 0, e.y ?? 0);
        switch (e.t) {
          case 'shot': {
            const w = Rules.WEAPONS[e.w], s = w && WSND[w.snd];
            if (s && heard) { audio.at(s[0], e.x, e.y, { gain: s[1], gap: s[2], vary: 0.14 }); audio.fight(); }
            break;
          }
          case 'hit': if (heard) audio.at(Rules.WEAPONS[e.w].fx === 'rocket' ? 'boom_m' : 'boom_s', e.x, e.y, { gain: 0.6, gap: 0.05, vary: 0.2 }); break;
          case 'boom': if (heard || e.size >= 8) audio.at(e.size >= 8 ? 'boom_x' : e.size > 1.5 ? 'boom_l' : 'boom_m', e.x, e.y, { gain: e.size >= 8 ? 2 : 0.8, gap: 0.05, vary: 0.2 }); break;
          case 'die': if ((e.b || e.kind === 'general') && e.team >= 0) G.falls[e.team] = { x: e.x, y: e.y, kind: e.kind }; if (heard) audio.at(e.b ? 'boom_l' : Rules.UNITS[e.kind]?.men ? 'scream' : 'boom_m', e.x, e.y, { gain: Rules.UNITS[e.kind]?.men ? 0.3 : 0.9, gap: 0.08, vary: 0.2 }); break;
          case 'say':
            // A new age has its own card, so its call names the age and leaves no line in the log.
            if (G.playing && e.team === G.team && e.line === 'newtech') audio.voice(e.line, `The ${Rules.AGES[S.P[e.team].tech].name} Age`, oldAge());
            else if (G.playing && e.team === G.team) { const v = (oldAge() && VOICE_OLD[e.line]) || VOICE[e.line]; if (v) { hud.say(v[0] + '.', v[1]); audio.voice(e.line, v[2] || v[0], oldAge()); } }
            break;
          case 'alert': if (G.playing && e.team === G.team) hud.alert(e.x, e.y); break;
          // A finished tier names itself and what the side now has, and the call says only that it is done.
          case 'upgraded': if (G.playing && e.team === G.team) { const v = (oldAge() && VOICE_OLD.upgraded) || VOICE.upgraded; hud.say(`${Rules.UPGRADES[e.k].names[e.tier - 1]}. ${Rules.upNote(e.k, e.tier)}`, 'good'); audio.voice('upgraded', v[0], oldAge()); } break;
          case 'trade': if (G.playing && e.team === G.team) hud.pop(e.x, e.y, '+' + e.n); break;
          // A levy names what it raised, and that the towns pay half for a while after.
          case 'levy':
            if (G.playing && e.team === G.team) {
              const ore = Math.round(e.ore), oil = Math.round(e.oil), name = Rules.nameOf('levy', S.P[e.team].tech);
              hud.pop(e.x, e.y, '+' + ore);
              hud.say(`${name}: $${ore.toLocaleString()}${oil ? ` and ${oil} oil` : ''} from ${e.towns} ${e.towns === 1 ? 'town' : 'towns'}, which pay half for four minutes.`, 'good');
              audio.voice('levy', oldAge() ? 'The tribute is gathered' : 'Funds raised', oldAge());
            }
            break;
          case 'hint': if (G.playing && e.team === G.team && e.hint === 'attrition') hud.say('Attrition: troops wear down abroad. A Support Truck stops it.', 'bad'); break;
          case 'dambreak': if (G.playing) hud.say('The dam has broken. The valley below floods and its bridges are swept away.', 'bad'); break;
          case 'tide': if (G.playing) hud.say(e.low ? 'Low tide: the sands are open to the island.' : 'The tide is in over the sands.'); break;
          // King of the Hill: a side holds every hill and every town but the keeps, and the others yield in a minute.
          case 'field':
            if (G.playing && G.team >= 0) hud.say(e.team === G.team ? `You hold the whole field. Keep it ${Rules.KOTH_HOLD / Rules.HZ} seconds and the enemy yields.` : `${G.names[e.team] || 'The enemy'} holds the whole field. Take a hill or a town back within ${Rules.KOTH_HOLD / Rules.HZ} seconds.`, e.team === G.team ? 'good' : 'bad');
            break;
          case 'launch': if (G.playing && e.team === G.team) audio.play('launch', { gain: 0.9 }); break;
          case 'placed': if (G.playing && e.team === G.team) audio.at('place', e.x, e.y, { gain: 0.8 }); break;
          case 'over': if (G.playing) setTimeout(outcome, 1800); drawRoster(); break;
          case 'fallen': {
            // A plate of the fall for the report: where the side's last building went down, or else its base, drawn back
            // to take in the fight round it, as it stood a quarter of a minute before.
            const at = G.falls[e.team] || (S.bases[e.team] ? { x: S.bases[e.team][0], y: S.bases[e.team][1] } : null);
            if (at && !e.forfeit) { const then = pastState(S); world.plate(at.x, at.y, url => { G.plate = { url, team: e.team, kind: at.kind, tick: then ? then.tick : S.tick, x: at.x, y: at.y, regicide: e.regicide }; }, PLATE_DIST, true, then); }
            if (G.playing && e.team === G.team) setTimeout(outcome, 1800);
            else if (G.playing && G.names[e.team]) hud.say(e.forfeit ? `${G.names[e.team]} has forfeited the game.` : e.regicide ? `${G.names[e.team]}'s general has fallen. They are out.` : `${G.names[e.team]} is out.`, 'good');
            drawRoster();
            break;
          }
          case 'weather': if (G.playing) { const v = e.passed ? SKY_PASS[e.was] : SKY_SAY[e.kind]; if (v && !(e.kind === 'cloud' && e.was === 'clear')) { hud.say(v[0], v[1]); if (v[2]) audio.voice('sky', v[2], oldAge()); } } break;
          // A satellite constellation launched: the side's own word, and a warning to the others.
          case 'satlaunch': if (G.playing) { if (e.team === G.team) hud.say('The constellation is on its way to orbit. Its first pass comes in twenty seconds.', 'good'); else hud.say('An enemy rocket has put a satellite constellation in orbit.', 'bad'); } break;
          // The AI Data Center's word of the enemy's main army, and its warning when that army is near the base.
          case 'intel': if (G.playing && e.team === G.team) {
            let near = null, nd = 1e9; for (const tw of S.towns) { const d = Math.hypot(tw.x - e.x, tw.y - e.y); if (d < nd) { nd = d; near = tw; } }
            const where = near && nd < 30 ? ` near ${Rules.townName(S, near.id)}` : '';
            if (e.near) { hud.say(`Intelligence: a large enemy force is close to your base${where}.`, 'bad'); hud.alert(e.x, e.y); }
            else hud.say(`Intelligence: the enemy's main army is${where || ' marked on the map'}.`);
          } break;
          // One of the player's fishing boats on water with no fishing ground, said once a minute at most.
          case 'nofish': if (G.playing && e.team === G.team && S.tick - (G.lastNoFish ?? -1e9) > 60 * Rules.HZ) { G.lastNoFish = S.tick; hud.say('A fishing boat has no fishing grounds in its water. Build its dock on other water.', 'bad'); } break;
          // One of the player's squads breaking, said now and then, not for every squad.
          case 'broke': if (G.playing && e.team === G.team && S.tick - (G.lastBroke ?? -1e9) > 20 * Rules.HZ) { G.lastBroke = S.tick; hud.say('A squad has broken and is running.', 'bad'); } break;
          // Lightning, and a fire it lights in a wood the player can see.
          case 'strike':
            if (G.playing) hud.strike(e);
            if (G.playing && e.fire && G.team >= 0 && S.P[G.team].seen[Rules.cellOf(e.x, e.y)] && S.tick - (G.lastWildfire ?? -1e9) > 60 * Rules.HZ) { G.lastWildfire = S.tick; hud.say(e.dry ? 'Dry lightning has set a wood alight.' : 'Lightning has struck a tree.', 'bad'); }
            break;
          case 'flood': if (G.playing) hud.say(e.on ? 'The rivers are up. The fords are closed.' : 'The rivers are down. The fords are open again.', e.on ? 'bad' : 'good'); break;
          case 'bridge': if (G.playing && G.team >= 0 && G.S.P[G.team].seen[Rules.cellOf(e.x, e.y)]) { hud.say(e.down ? 'A bridge is down.' : 'A bridge is open again.', e.down ? 'bad' : 'good'); if (e.down) audio.voice('bridge', 'Bridge destroyed', oldAge()); } break;
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

    // The picture is drawn at full size unless the player picks Faster in the settings, kept in the browser; a phone
    // starts on Faster. Then the resolution follows the machine. Slow frames are taken as held up by drawing, so the
    // picture gives up pixels a step at a time; frames that keep pace win them back, up to just under the size found
    // too slow, and a while later past it. Frames filled by the page's own work are a slow processor's, and fewer
    // pixels would not help it.
    let picture = store.get('dg-picture', mobile ? 'fast' : 'sharp');
    const RES = { ft: 1 / 60, wk: 0, t: 0, ceil: 1, calm: 0 };
    function setPicture(v) {
      picture = v; store.set('dg-picture', v);
      Object.assign(RES, { t: 0, ceil: 1, calm: 0 });
      scale = 1; overNew = true; fit();
      $('s-pic').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === picture));
    }
    // A Sharp picture drawn past the screen's own pixels gives up those over them on a machine too slow for them.
    function tune(dt, work) {
      if ((picture !== 'fast' && over <= 1) || dt > 0.5 || document.hidden) return;
      RES.ft += (dt - RES.ft) * 0.05; RES.wk += (work - RES.wk) * 0.05;
      RES.t += dt; RES.calm += dt;
      if (RES.calm > 45 && RES.ceil < 1) { RES.ceil = Math.min(1, RES.ceil + 0.1); RES.calm = 0; }
      // Two seconds after a change, so the averages hold the new size.
      if (RES.t < 2) return;
      // Never under three fifths of full size, or a Sharp picture under the screen's own pixels, and only once the
      // frame rate falls under about 33, a twentieth or a tenth at a time.
      const lo = picture === 'fast' ? 0.6 : 1 / over, was = scale;
      if (RES.ft > 0.03 && RES.wk < RES.ft * 0.85 && scale > lo) {
        scale = Math.max(lo, Math.round(scale * Math.max(0.9, Math.sqrt(0.025 / RES.ft)) * 20) / 20);
        RES.ceil = Math.max(lo, was - 0.05); RES.calm = 0;
      // Pixels are won back while frames keep pace, or while the page's own work fills them, as the drawing then has
      // time to spare.
      } else if ((RES.ft < 0.0185 || RES.wk > RES.ft * 0.85) && scale < RES.ceil) scale = Math.min(RES.ceil, scale + 0.1);
      if (scale !== was) { RES.t = 0; fit(); }
    }

    let last = 0, acc = 0;
    function loop(now) {
      requestAnimationFrame(loop);
      const t0 = performance.now(), dt = Math.min(0.1, (now - last) / 1000 || 0.016), gap = (now - last) / 1000;
      last = now;
      if (fitDue) applyFit();
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
          if (S.over && !ahead) attract();
        }
      }
      attractAhead();
      if (cameoDue && !renders) cameos(3);
      if (S) world.frame(Math.min(1, acc / Rules.DT), G.paused ? 0 : dt, now / 1000);
      drawOv();
      // The sound is held exactly while a game stands paused, however it came to be paused or let go.
      audio.hold(G.playing && G.paused);
      hud.frame(dt);
      if (G.S) audio.weather(world.sky);
      if (gap > 0) tune(gap, (performance.now() - t0) / 1000);
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
    let renders = null, cameoList = null, cameoPart = null, cameoN = 0, cameoDue = false, cameoBusy = false;
    // The engine's pictures are drawn once a world is loaded: a few a frame after the title is up, and any left all
    // at once as a game begins. Their pixels come back a frame or two after they are drawn, so one batch is out at a
    // time, and the cards take them when all are in.
    function cameos(n = Infinity) {
      if (renders || !G.S || !cameoList || cameoBusy) return;
      cameoPart = cameoPart || {};
      const end = Math.min(cameoList.length, cameoN + n), batch = cameoList.slice(cameoN, end);
      cameoN = end; cameoBusy = true;
      world.cameos(batch, 0).then(o => {
        cameoBusy = false;
        Object.assign(cameoPart, o);
        if (cameoN >= cameoList.length) { renders = cameoPart; cameoPart = null; pictures(); }
      });
    }
    function pictures() {
      if (!renders) return;
      const scheme = world.look !== 'ink' ? 'daylight' : document.body.dataset.scheme === 'dark' ? 'dark' : 'light';
      const P = G.S && G.S.P[Math.max(0, G.team || 0)], age = P ? P.tech : 5, own = {}, base = {};
      // Each drawing on the paper it was inked for: the dark paper's where one was made, else the light's.
      const pic = k => (scheme === 'dark' && renders[k + '|dark']) || renders[k];
      for (const k in renders) if (!k.endsWith('|dark')) base[k] = pic(k);
      for (const k in Rules.BUILDINGS) own[k] = pic(world.ageKey(k, age)) || pic(k);
      G.picAge = age;
      hud.setCameos(Object.assign({}, base, own, Axo.pictures(scheme, SLOT_CSS[Math.max(0, G.team || 0)])));
    }
    // Night blue and graphite are themes of the dark paper.
    const TONES = { night: 1, graphite: 2 };
    function applyScheme() {
      const tone = TONES[scheme] || 0, dark = scheme === 'dark' || !!tone || (scheme === 'auto' && !!darkQ && darkQ.matches);
      Looks.dark = dark; Looks.tone = tone; document.body.dataset.scheme = dark ? 'dark' : 'light';
      document.body.dataset.tone = tone ? scheme : '';
      $('s-scheme').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === scheme));
      if (!$('t-setup').hidden) renderSetup();
      pictures();
    }
    darkQ?.addEventListener?.('change', applyScheme);
    // The settings panel, from the gear at the top right: the paper's scheme and the picture's size.
    $('s-scheme').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      scheme = b.dataset.v; applyScheme(); audio.ui('click');
      store.set('dg-paper', scheme);
    }));
    // Picking Sharp again lets a machine that once dropped the picture try the extra pixels again.
    $('s-pic').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.dataset.v === 'sharp') store.set('dg-over', null); setPicture(b.dataset.v); audio.ui('click'); }));
    // Ore, oil and power stand in the top bar or in the sidebar, as the player chooses, the top bar unless told. An
    // upright phone or a short window has no room for them in its sidebar, so there they keep to the top bar.
    let gauges = store.get('dg-gauges', 'top');
    const cramped = matchMedia('(max-aspect-ratio: 1/1), (max-height: 520px)');
    function placeGauges() {
      const side = gauges === 'side' && !cramped.matches, list = [...document.querySelectorAll('.gauge')];
      if (side) $('res').append(...list); else $('top').prepend(...list);
      $('res').hidden = !side;
      $('s-gauges').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === gauges));
    }
    cramped.addEventListener?.('change', placeGauges);
    $('s-gauges').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { gauges = b.dataset.v; store.set('dg-gauges', gauges); placeGauges(); audio.ui('click'); }));
    placeGauges();
    // The survey sheet's frame round the map when drawn back, on unless turned off.
    G.sheet = store.get('dg-sheet', 'on') !== 'off';
    const showSheet = () => $('s-sheet').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'on') === G.sheet));
    $('s-sheet').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { G.sheet = b.dataset.v === 'on'; store.set('dg-sheet', G.sheet ? null : 'off'); showSheet(); audio.ui('click'); }));
    showSheet();
    // Shadows on the land in pen hatching unless set to a wash.
    let shadeHatch = store.get('dg-shade', 'hatch') !== 'wash';
    const showShade = () => $('s-shade').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'hatch') === shadeHatch));
    $('s-shade').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { shadeHatch = b.dataset.v === 'hatch'; store.set('dg-shade', shadeHatch ? null : 'wash'); world.setShadeHatch(shadeHatch); showShade(); audio.ui('click'); }));
    world.setShadeHatch(shadeHatch); showShade();
    // How strong the cast shadows are: full, lighter, or none, when the sun's shadow map is not drawn at all. Light
    // is 0.7, since hatching at half its ink all but vanishes on the paper.
    const SHADOW_K = { full: 1, light: 0.7, off: 0 };
    let shadowLvl = store.get('dg-shadow', 'full');
    if (!(shadowLvl in SHADOW_K)) shadowLvl = 'full';
    const showShadow = () => $('s-shadow').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === shadowLvl));
    $('s-shadow').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { shadowLvl = b.dataset.v; store.set('dg-shadow', shadowLvl === 'full' ? null : shadowLvl); world.setShadowK(SHADOW_K[shadowLvl]); showShadow(); audio.ui('click'); }));
    world.setShadowK(SHADOW_K[shadowLvl]); showShadow();
    // Edge lines drawn the quick way, from a brightness buffer made once a frame, unless the exact way is chosen.
    let quickEdges = store.get('dg-edges', 'quick') !== 'exact';
    const showEdges = () => $('s-edges').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'quick') === quickEdges));
    $('s-edges').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { quickEdges = b.dataset.v === 'quick'; store.set('dg-edges', quickEdges ? null : 'exact'); world.setQuickEdges(quickEdges); showEdges(); audio.ui('click'); }));
    world.setQuickEdges(quickEdges); showEdges();
    // The score on or off, apart from the sound button, which silences everything.
    const showMusic = () => $('s-music').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'on') === audio.musicOn));
    $('s-music').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { audio.wake(); audio.setMusic(b.dataset.v === 'on'); showMusic(); audio.ui('click'); }));
    showMusic();
    setPicture(picture);
    // A newer build on the site. The page asks a minute apart and whenever it comes back into view, and offers a
    // reload; the game in hand is saved as the page goes and comes back after it. Only a stamped page served from
    // the site asks, as a file or an artifact has no version to read.
    const myBuild = ($('build').textContent || '').replace(/^Build /, '').trim();
    // The build on the lobby pages too, when the page has one.
    if (!myBuild.includes('__BUILD__')) document.querySelectorAll('.ver').forEach(e => { e.textContent = (e.closest('#credit') ? ' · ' : '') + 'Build ' + myBuild; });
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
    const setOpen = open => { $('settings').hidden = !open; $('b-set').setAttribute('aria-expanded', String(open)); };
    $('b-set').addEventListener('click', e => { e.stopPropagation(); setOpen($('settings').hidden); audio.ui('click'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settings').hidden) setOpen(false); });
    document.addEventListener('pointerdown', e => { if (!$('settings').hidden && !$('settings').contains(e.target) && e.target !== $('b-set')) setOpen(false); });

    // A map drawn as the pen and ink look draws the land, at px pixels square: layer tints by height lit from the upper
    // left, contours every two thirds of a unit, water lined at its bank, brooks, woods stippled, ore, roads with ruled
    // edges, bridges, the town houses and the wells.
    function mapPicture(M, px, dark) {
      const W = M.W, k = W / px, cv = document.createElement('canvas'); cv.width = cv.height = px;
      const g = cv.getContext('2d'), im = g.createImageData(px, px), d = im.data, hs = new Float32Array(px * px);
      for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) hs[j * px + i] = Rules.terrainAt(M, (i + 0.5) * k, (j + 0.5) * k);
      const VW = Rules.VW, RES = Rules.RES, BD = M.brookDist, ink = dark ? [0.68, 0.66, 0.6] : [0.42, 0.33, 0.24];
      const tint = t => dark
        ? (t < 0.5 ? [0.2 + 0.14 * t, 0.29 + 0.16 * t, 0.19 + 0.12 * t] : [0.27 + 0.56 * (t - 0.5), 0.37 + 0.26 * (t - 0.5), 0.25 + 0.24 * (t - 0.5)])
        : (t < 0.5 ? [0.84 + 0.2 * t, 0.9 + 0.06 * t, 0.8 + 0.04 * t] : [0.94 - 0.12 * (t - 0.5), 0.93 - 0.26 * (t - 0.5), 0.82 - 0.36 * (t - 0.5)]);
      const WTR = dark ? [0.115, 0.15, 0.235] : [0.788, 0.804, 0.902], BANK = dark ? [0.4, 0.5, 0.75] : [0.3, 0.36, 0.6];
      // Ore by its kind: gold, silver, copper and iron.
      const ORES = dark ? [[0.84, 0.64, 0.22], [0.74, 0.76, 0.8], [0.8, 0.46, 0.28], [0.6, 0.4, 0.32]] : [[0.96, 0.76, 0.24], [0.8, 0.82, 0.87], [0.88, 0.5, 0.3], [0.64, 0.4, 0.3]], WOOD = dark ? [0.16, 0.26, 0.15] : [0.62, 0.74, 0.55], DOT = dark ? [0.4, 0.55, 0.36] : [0.3, 0.45, 0.28];
      const wetAt = (i, j) => { const h = hs[j * px + i]; if (h < M.water) return true; if (!BD) return false; const v = Math.round((j + 0.5) * k * RES) * VW + Math.round((i + 0.5) * k * RES); return BD[v] < 0.48 && M.roadDist[v] > 1.4; };
      const ci = (i, j) => Math.floor(hs[j * px + i] / 0.66);
      for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
        const o = (j * px + i) * 4, x = (i + 0.5) * k, y = (j + 0.5) * k, c = Math.min(W - 1, y | 0) * W + Math.min(W - 1, x | 0), h = hs[j * px + i];
        let col;
        if (wetAt(i, j)) {
          col = WTR.slice();
          const edge = (i > 0 && !wetAt(i - 1, j)) || (j > 0 && !wetAt(i, j - 1)) || (i < px - 1 && !wetAt(i + 1, j)) || (j < px - 1 && !wetAt(i, j + 1));
          if (edge) col = BANK;
        } else {
          col = tint(Math.max(0, Math.min(1, h / 3.2)));
          // Lit from the upper left: the fall of the land toward the lower right shades it, the rise lifts it.
          const hx = hs[j * px + Math.min(px - 1, i + 1)] - hs[j * px + Math.max(0, i - 1)], hy = hs[Math.min(px - 1, j + 1) * px + i] - hs[Math.max(0, j - 1) * px + i];
          const sh = Math.max(-1, Math.min(1, -(hx + hy) / (2 * k) * 0.9));
          col = col.map(v => v * (sh < 0 ? 1 + sh * (dark ? 0.55 : 0.28) : 1 + sh * 0.06));
          if (M.ground[c] & 8) { col = col.map((v, n) => v * 0.45 + WOOD[n] * 0.55); if (((i * 7 + j * 13) % 11) === 0 || ((i * 3 + j * 5) % 17) === 0) col = DOT; }
          if (M.ore[c]) { const O = ORES[M.oreKind ? M.oreKind[c] : 0]; col = col.map((v, n) => v * 0.35 + O[n] * 0.65); }
          const cnt = (i < px - 1 && ci(i + 1, j) !== ci(i, j)) || (j < px - 1 && ci(i, j + 1) !== ci(i, j));
          if (cnt) { const idx = ci(i, j) % 5 === 0 ? 0.75 : 0.4; col = col.map((v, n) => v + (ink[n] - v) * idx); }
        }
        d[o] = col[0] * 255; d[o + 1] = col[1] * 255; d[o + 2] = col[2] * 255; d[o + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      g.scale(1 / k, 1 / k);
      const line = dark ? 'rgba(232,224,207,.85)' : 'rgba(70,52,36,.85)', paper = dark ? '#2b2722' : '#faf4e4';
      // Roads: a paper band between two ruled edges.
      g.lineCap = g.lineJoin = 'round';
      for (const [w, c] of [[1.5, line], [0.75, paper]]) { g.strokeStyle = c; g.lineWidth = w; for (const rd of M.roads) { g.beginPath(); rd.forEach((p, n) => n ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); } }
      // Bridges, a deck with its ends ruled across.
      g.lineCap = 'butt';
      for (const br of M.bridges) { g.strokeStyle = line; g.lineWidth = br.w + 0.6; g.beginPath(); g.moveTo(br.x0, br.y0); g.lineTo(br.x1, br.y1); g.stroke(); g.strokeStyle = dark ? '#5a554d' : '#d8cfbc'; g.lineWidth = br.w - 0.6; g.beginPath(); g.moveTo(br.x0, br.y0); g.lineTo(br.x1, br.y1); g.stroke(); }
      // The houses of the towns, and the wells.
      g.fillStyle = dark ? '#cfc6b4' : '#6a5440';
      for (const hz of M.houses || []) g.fillRect(hz.x + 0.15, hz.y + 0.15, hz.w - 0.3, hz.h - 0.3);
      g.fillStyle = dark ? '#e8e0cf' : '#1f1a16';
      for (const w of M.wells) { g.beginPath(); g.arc(w.x + 1, w.y + 1, 0.9, 0, Math.PI * 2); g.fill(); }
      return cv;
    }

    // The map's picture in the set-up: land by height, water, ore, towns, roads and bridges, and a numbered mark at
    // each seated slot's base in its colour. Each map is worked out once and kept.
    const previews = new Map();
    let previewWant = '';
    function drawPreview(key, seed, slots) {
      const m = Rules.MAPS[key], cv = $('preview');
      const css = Math.max(120, cv.clientWidth || 280), px = Math.round(css * Math.min(2, devicePixelRatio || 1)), id = m.layout + ':' + seed + ':' + (Looks.dark ? 'd' : 'l') + ':' + px;
      // A canvas starts 300 by 150, so a 300 pixel column must still set its height.
      if (cv.width !== px || cv.height !== px) { cv.width = cv.height = px; }
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
        const M = Rules.mapFor(seed, m.layout), W = M.W, dark = Looks.dark, img = mapPicture(M, px, dark);
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
      return { mode: 'skirmish', map: sk.map, seed: sk.seed, theme: sk.theme, age: sk.age || 1, weather: sk.weather || 'random', res: sk.res || 'std', win: sk.win || 'conquest', phase: 'lobby', host: true, you: sk.slots.findIndex(s => s.kind === 'you'), slots: sk.slots.map(s => s.kind === 'you' ? { kind: 'human', name: G.name || 'You', you: true } : s), watch: [] };
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
        b.addEventListener('click', () => { if (!edit || k === v.map) return; audio.ui('click'); change(net.inRoom ? { map: k } : { map: k, picked: true }); });
        $('maps').append(b);
      }
      $('map-about').textContent = m.about;
      $('seed').textContent = '#' + v.seed;
      $('reseed').disabled = !edit;
      $('m-theme').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === v.theme); b.disabled = (!edit || !!m.theatre) && b.dataset.v !== v.theme; });
      $('m-age').querySelectorAll('button').forEach(b => { const on = +b.dataset.v === (v.age || 1); b.classList.toggle('on', on); b.disabled = !edit && !on; });
      $('age-about').textContent = Rules.AGES[v.age || 1].note;
      $('m-weather').querySelectorAll('button').forEach(b => { const on = b.dataset.v === (v.weather || 'random'); b.classList.toggle('on', on); b.disabled = !edit && !on; });
      $('weather-about').textContent = weatherNote(v.theme, v.weather || 'random');
      $('m-res').querySelectorAll('button').forEach(b => { const on = b.dataset.v === (v.res || 'std'); b.classList.toggle('on', on); b.disabled = !edit && !on; });
      $('res-about').textContent = RES_NOTE[v.res || 'std'];
      // King of the Hill is played only on maps with high points, and falls back to Conquest elsewhere.
      const win = v.win === 'koth' && !m.koth ? 'conquest' : v.win || 'conquest';
      $('m-win').querySelectorAll('button').forEach(b => { const on = b.dataset.v === win; b.classList.toggle('on', on); b.disabled = (!edit && !on) || (b.dataset.v === 'koth' && !m.koth); });
      $('win-about').textContent = WIN_NOTE[win] + (v.win === 'koth' && !m.koth ? ' King of the Hill is not played on this map.' : '');
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
      // A map that fixes its theatre keeps it, and any other is in the player's own.
      sk.theme = Rules.theatreOf(sk.map, sk.myTheme || sk.theme);
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

    $('m-theme').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change(net.inRoom ? { theme: b.dataset.v } : { theme: b.dataset.v, myTheme: b.dataset.v }); }));
    $('m-age').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change({ age: +b.dataset.v }); }));
    $('m-weather').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change({ weather: b.dataset.v }); }));
    $('m-res').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change({ res: b.dataset.v }); }));
    $('m-win').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; audio.ui('click'); change({ win: b.dataset.v }); }));
    $('reseed').addEventListener('click', () => { audio.ui('click'); change({ seed: newSeed() }); });
    // Until the player picks a map by hand, the set-up opens on one of the two-player maps at random, in the
    // player's own theatre unless the map has one of its own.
    function pickMap() {
      if (!sk.myTheme) sk.myTheme = sk.theme;
      const two = Object.keys(Rules.MAPS).filter(k => Rules.MAPS[k].seats === 2);
      sk.map = two[Math.floor(Math.random() * two.length)];
      fitSlots(sk);
      sk.theme = Rules.theatreOf(sk.map, sk.myTheme || sk.theme);
      saveSk();
    }
    $('b-skirmish').addEventListener('click', () => { audio.wake(); audio.ui('click'); net.inRoom = false; if (!sk.picked) pickMap(); screen('setup'); renderSetup(); });
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
    $('b-exit').addEventListener('click', () => { audio.ui('click'); G.askLeave(); });
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
          // A room already at war sends its world next, so the lobby is not shown on the way back in.
          if (!net.inGame && m.phase !== 'lobby') rejoining(true);
          else if (!net.inGame) { rejoining(false); if ($('t-setup').hidden || !was) screen('setup'); renderSetup(); }
          drawRoster();
          break;
        }
        case 'chatlog': $('chat-log').innerHTML = ''; for (const c of m.list) chatLine(c.n, c.s); break;
        case 'chat': chatLine(m.n, m.s); if (G.online && net.inGame) gameChat(m.n, m.s); break;
        case 'you': vc.me = m.pk; if (vc.on) { for (const pk of [...vc.peers.keys()]) dropPeer(pk); send({ t: 'voice', on: true }); } break;
        case 'voices': onVoices(m.list || []); break;
        case 'rtc': onRtc(m.from, m.d); break;
        case 'hello': net.slot = m.slot; net.theme = m.theme || 'desert'; net.map = m.map || 'duel'; net.queue = []; net.hashes.clear(); break;
        case 'ticks': for (const b of m.b) net.queue.push(b); if (m.h) net.hashes.set(m.h[0], m.h[1]); break;
        case 'gone': rejoining(false); net.want = false; net.inRoom = false; net.view = null; store.set(ROOM, null); if (!$('title').hidden && !$('t-setup').hidden) screen('rooms'); toast('That game has closed.'); break;
        case 'taken': rejoining(false); net.want = false; net.inRoom = false; toast('This game was opened in another window.'); break;
        case 'moved': chatLine('', 'The host moved you out of your seat. You are watching.'); break;
      }
    }
    // ---- Chat and voice in a game ----

    // Lines said in a game show under the log a little longer than its notes. Enter, or the bar's button, opens a
    // line to say one.
    function gameChat(n, s) {
      const log = $('gchat-log'), d = document.createElement('div'), b = document.createElement('b');
      d.className = 'line'; b.textContent = n + ':'; d.append(b, document.createTextNode(s));
      log.append(d);
      while (log.children.length > 6) log.firstChild.remove();
      setTimeout(() => d.classList.add('gone'), 15000);
      setTimeout(() => d.remove(), 15800);
    }
    function openChat() { if (!G.online || !G.playing) return; const i = $('gchat-in'); i.hidden = false; i.focus(); }
    function closeChat() { const i = $('gchat-in'); i.value = ''; i.hidden = true; i.blur(); }
    $('gchat-in').addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const s = $('gchat-in').value.trim(); if (s) send({ t: 'chat', s }); closeChat(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
    });
    $('gchat-in').addEventListener('blur', () => { if (!$('gchat-in').value) $('gchat-in').hidden = true; });
    $('b-chat').addEventListener('click', () => { audio.ui('click'); openChat(); });
    document.addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'Enter' && G.online && G.playing) { e.preventDefault(); openChat(); }
    });

    // Voice runs between the players' own pages. Each player on voice is linked to every other who is, and of two,
    // the one whose key sorts first calls. Routes are found through a public STUN server with no relay, so two
    // players both behind strict firewalls may not hear each other.
    const RTC = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
    const MIC_SVG = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.8 7.5a4.2 4.2 0 0 0 8.4 0M8 11.7V14"/></svg>';
    const vc = { on: false, stream: null, me: '', list: [], peers: new Map(), ctx: null, mine: null };
    async function voiceToggle() {
      if (vc.on) { voiceOff(); hud.say('Voice off.'); return; }
      try { vc.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { hud.say('There is no microphone to speak with, or it was not allowed.', 'bad'); return; }
      vc.on = true; $('b-voice').classList.add('on'); $('b-voice').setAttribute('aria-pressed', 'true');
      vc.mine = { an: null }; listen(vc.mine, vc.stream);
      send({ t: 'voice', on: true });
      hud.say('Voice on. Everyone else on voice can hear you.', 'good');
    }
    function voiceOff() {
      if (!vc.on) return;
      vc.on = false; send({ t: 'voice', on: false });
      for (const pk of [...vc.peers.keys()]) dropPeer(pk);
      if (vc.stream) for (const t of vc.stream.getTracks()) t.stop();
      vc.stream = null; vc.mine = null;
      $('b-voice').classList.remove('on'); $('b-voice').setAttribute('aria-pressed', 'false');
      drawRoster();
    }
    function peerFor(pk) {
      let p = vc.peers.get(pk);
      if (p) return p;
      const pc = new RTCPeerConnection(RTC);
      p = { pc, audio: new Audio(), an: null, chain: Promise.resolve() };
      p.audio.autoplay = true;
      vc.peers.set(pk, p);
      for (const t of vc.stream.getTracks()) pc.addTrack(t, vc.stream);
      pc.onicecandidate = e => { if (e.candidate) send({ t: 'rtc', to: pk, d: { c: e.candidate.toJSON() } }); };
      pc.ontrack = e => { p.audio.srcObject = e.streams[0]; p.audio.play().catch(() => { /* waits for a gesture */ }); listen(p, e.streams[0]); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && vc.peers.get(pk) === p) dropPeer(pk); };
      return p;
    }
    function dropPeer(pk) {
      const p = vc.peers.get(pk);
      if (!p) return;
      try { p.pc.close(); } catch (e) { /* closed */ }
      p.audio.srcObject = null;
      vc.peers.delete(pk);
    }
    async function call(pk) {
      const p = peerFor(pk);
      await p.pc.setLocalDescription(await p.pc.createOffer());
      send({ t: 'rtc', to: pk, d: { sdp: p.pc.localDescription.toJSON() } });
    }
    // Each peer's messages are taken in turn, so a route never comes before the offer it belongs to.
    function onRtc(from, d) {
      if (!vc.on || !d || !vc.list.some(v => v.pk === from)) return;
      const p = peerFor(from);
      p.chain = p.chain.then(async () => {
        if (d.sdp) {
          await p.pc.setRemoteDescription(d.sdp);
          if (d.sdp.type === 'offer') { await p.pc.setLocalDescription(await p.pc.createAnswer()); send({ t: 'rtc', to: from, d: { sdp: p.pc.localDescription.toJSON() } }); }
        } else if (d.c) await p.pc.addIceCandidate(d.c).catch(() => { /* stale */ });
      }).catch(e => console.log('voice', e.message));
    }
    function onVoices(list) {
      vc.list = list;
      if (vc.on && vc.me) {
        for (const pk of [...vc.peers.keys()]) if (!list.some(v => v.pk === pk)) dropPeer(pk);
        for (const v of list) if (v.pk !== vc.me && !vc.peers.has(v.pk) && vc.me < v.pk) call(v.pk).catch(e => console.log('voice', e.message));
      }
      drawRoster();
    }
    // Who is speaking, from the loudness of each voice, shown by their name in the roster.
    function listen(p, stream) {
      try {
        vc.ctx = vc.ctx || new AudioContext();
        const an = vc.ctx.createAnalyser();
        an.fftSize = 512; vc.ctx.createMediaStreamSource(stream).connect(an);
        p.an = an; p.buf = new Uint8Array(an.fftSize);
      } catch (e) { /* no meter */ }
    }
    const loud = p => { if (!p || !p.an) return false; p.an.getByteTimeDomainData(p.buf); let s = 0; for (const v of p.buf) s += (v - 128) ** 2; return Math.sqrt(s / p.buf.length) > 6; };
    setInterval(() => {
      if (!vc.on) return;
      for (const el of document.querySelectorAll('#roster .mic')) {
        const pk = el.dataset.pk;
        el.classList.toggle('talk', pk === vc.me ? loud(vc.mine) : loud(vc.peers.get(pk)));
      }
    }, 200);
    $('b-voice').addEventListener('click', () => { audio.ui('click'); voiceToggle(); });

    function chatLine(n, s) {
      const log = $('chat-log'), p = document.createElement('div');
      if (n) { const b = document.createElement('b'); b.textContent = n + ':'; p.append(b, document.createTextNode(s)); }
      else { p.className = 'sys'; p.textContent = s; }
      log.append(p);
      while (log.children.length > 60) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    // A plain card over the title while a game is found again, so neither the title nor the lobby flashes by.
    // If no world comes, the room's own screen shows after a while.
    let rejoinT = 0;
    function rejoining(on) {
      clearTimeout(rejoinT);
      document.body.classList.toggle('rejoining', on);
      $('loading-word').textContent = on ? 'REJOINING' : 'DEPLOYING';
      if (on) rejoinT = setTimeout(() => { rejoining(false); if (net.inRoom && !net.inGame && net.view) { screen('setup'); renderSetup(); } }, 15000);
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
      rejoining(false);
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
      voiceOff();
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
        nm.textContent = youName(t) + (S.P[t].forfeit ? ' (forfeited)' : t !== G.team && s && s.left ? ' (left)' : t !== G.team && s && s.away ? ' (away)' : '');
        row.className = (S.P[t].alive ? '' : 'down ') + (G.names[t] && G.names[t].startsWith('Computer') ? 'cpu' : '');
        row.append(dot, nm);
        // A small microphone by each name on voice, lit while they speak.
        const on = G.online && vc.list.find(q => q.slot === t);
        if (on) { const mic = document.createElement('span'); mic.className = 'mic'; mic.dataset.pk = on.pk; mic.innerHTML = MIC_SVG; mic.title = 'On voice'; row.append(mic); }
        box.append(row);
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
        if (r.status >= 500) return n < 4 ? again() : rejoining(false);
        if (!r.ok) return rejoining(false);
        const j = await r.json();
        if (!j.ok) return rejoining(false);
        hasServer = true;
        $('b-multi').hidden = false;
        // A player who was in a room when the page went comes back to it.
        const code = store.get(ROOM, '');
        if (code && !G.playing) { G.name = G.name || 'Commander'; joinRoom(code); }
      } catch (e) { if (n < 4) again(); else rejoining(false); }
    }

    function toTitle() {
      document.body.classList.remove('in-game');
      G.playing = false;
      $('title').hidden = false;
      screen('main');
      attract();
      fit();
    }

    // The loading bar's share, never going back from where its own creeping has brought it.
    function loaded(k) {
      const bar = document.querySelector('#loading .lbar'), i = bar && bar.firstElementChild;
      if (!i) return;
      const m = getComputedStyle(i).transform.match(/matrix\(([^,]+)/), now = m ? +m[1] : 0;
      // Set at once, with no easing, as a transition begun before a long step would start again from where it began.
      bar.classList.add('known'); i.style.transform = `scaleX(${Math.max(now, k)})`;
    }
    // A moment for the page to draw the bar between the heavy steps of setting up.
    const breathe = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    async function boot() {
      loaded(0.62); await breathe();
      fit();
      applyScheme();
      loaded(0.7); await breathe();
      cameoList = [
        ...Object.keys(Rules.BUILDINGS).filter(k => k !== 'hq').map(k => ({ kind: k, b: true })), { kind: 'hq', b: true },
        ...world.buildingKeys.filter(k => k.includes('@')).map(k => ({ kind: k, b: true })),
        // A unit with a line drawing of its own takes that, so only the rest are inked from their models.
        ...Object.keys(Rules.UNITS).filter(k => !Rules.UNITS[k].men && !Axo.UNITS[k]).map(k => ({ kind: k })),
        ...Object.keys(Rules.UNITS).filter(k => Rules.UNITS[k].men && !Axo.UNITS[k]).map(k => ({ kind: k, man: true })),
      ];
      G.pictures = pictures;
      if (!restore()) { $('view').classList.add('dawn'); attract(); screen('main'); }
      loaded(0.84); await breathe();
      if (store.get(ROOM, '') && !G.playing && /^https?:$/.test(location.protocol)) rejoining(true);
      $('callsign').value = G.name;
      probe();
      loaded(1); await breathe();
      document.body.classList.add('ready');
      G.save = saveGame;
      window.__game = G; window.__hud = hud; window.__net = net; window.__voice = vc;
      requestAnimationFrame(loop);
    }
    return { boot, G };
  }

  return { create };
})();

// A film-studio page expects this, though this game has a page of its own.
const MapmakersWar = Game;
