#!/usr/bin/env node
// Plays a room through, headless, against a running server: `node lobbycheck.js http://localhost:8799 [outdir]`.
// A host opens a game on Four Quarters with a computer, a guest finds it in the list, joins, chats and gets
// ready, the host starts, and both play a minute while every step is checked against the server. The host
// refreshes the page and comes back into the game. Then the guest leaves, which gives up their side, and the host
// plays on. Prints what each saw, and any desync or page error.
const puppeteer = require('/Users/nathan/Source/film-studio/node_modules/puppeteer-core');
const url = process.argv[2] || 'http://localhost:8799', out = process.argv[3] || '';
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--disable-speech-api', '--disable-speech-synthesis-api', '--use-angle=metal'] });
  const page = async (name, id) => {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message));
    p.on('console', m => { const t = m.text(); if (m.type() === 'error' || t.startsWith('@desync')) p.errs.push(t.slice(0, 200)); });
    await p.goto(url + '/?keep=1');
    // Check players' ids start check- so a real list never keeps them.
    await p.evaluate((n, i) => { localStorage.clear(); localStorage.setItem('dg-id', i); localStorage.setItem('dg-name', n); }, name, id);
    await p.reload();
    await p.waitForFunction('document.body.classList.contains("ready") && !document.getElementById("b-multi").hidden', { timeout: 60000 });
    return p;
  };
  const shot = async (p, n) => { if (out) await p.screenshot({ path: `${out}/${n}.png` }); };
  const host = await page('Hosta', 'check-host'), guest = await page('Guesto', 'check-guest');

  await host.click('#b-multi'); await wait(500);
  await host.type('#room-title', 'Check game');
  await host.click('#create');
  await host.waitForFunction('!document.getElementById("t-setup").hidden && window.__game && document.getElementById("setup-code").textContent', { timeout: 15000 });
  await wait(600);
  // Four Quarters, then a veteran computer in the third seat.
  await host.evaluate(() => [...document.querySelectorAll('#maps button')][1].click());
  await wait(1200);
  await host.evaluate(() => { const s = document.querySelectorAll('#slots select')[1]; s.value = 'ai:veteran'; s.dispatchEvent(new Event('change')); });
  await wait(800);
  // Unlimited resources, which both sides' games must then hold.
  await host.evaluate(() => document.querySelector('#m-res [data-v=free]').click());
  await wait(800);
  await shot(host, 'room-host');

  await guest.click('#b-multi');
  await guest.waitForFunction('document.querySelectorAll("#rooms tbody tr").length > 0', { timeout: 15000 });
  const listed = await guest.evaluate(() => [...document.querySelectorAll('#rooms tbody tr')].map(r => r.innerText.replace(/\s+/g, ' ')));
  await shot(guest, 'rooms-list');
  await guest.evaluate(() => document.querySelector('#rooms tbody tr button').click());
  await guest.waitForFunction('!document.getElementById("t-setup").hidden && document.getElementById("ready") && !document.getElementById("ready").hidden', { timeout: 15000 });
  await guest.type('#chat-in', 'ready when you are'); await guest.keyboard.press('Enter');
  await wait(500);
  const before = await host.evaluate(() => ({ why: document.getElementById('go-why').textContent, start: !document.getElementById('deploy').disabled }));
  await guest.click('#ready'); await wait(800);
  const after = await host.evaluate(() => ({ why: document.getElementById('go-why').textContent, start: !document.getElementById('deploy').disabled, chat: document.getElementById('chat-log').innerText }));
  await shot(guest, 'room-guest');
  const hit = await host.evaluate(() => { const b = document.getElementById('deploy'), r = b.getBoundingClientRect(), at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { at: at && (at.id || at.tagName), r: [r.x, r.y, r.width, r.height], inner: innerHeight }; });
  console.log('deploy', JSON.stringify(hit));
  await host.click('#deploy');
  try { await host.waitForFunction('window.__game.playing && window.__game.online', { timeout: 20000 }); }
  catch (e) {
    console.log(JSON.stringify({ after, stuck: await host.evaluate(() => ({ why: document.getElementById('go-why').textContent, title: !document.getElementById('title').hidden, inRoom: __net.inRoom, ws: __net.ws && __net.ws.readyState, view: __net.view && { phase: __net.view.phase, host: __net.view.host, slots: __net.view.slots } })), errors: { host: host.errs, guest: guest.errs } }, null, 1));
    await b.close(); process.exit(1);
  }
  await guest.waitForFunction('window.__game.playing && window.__game.online', { timeout: 20000 });
  const seen = async p => p.evaluate(() => ({ free: __game.S.free, sup: document.getElementById('sup').textContent, team: __game.team, seats: __game.S.seats, W: __game.S.map.W, tick: __game.S.tick, names: __game.names, alive: __game.S.P.map(P => P.alive) }));
  const h0 = await seen(host), g0 = await seen(guest);
  // A minute of play: each sends its humvee somewhere.
  for (const p of [host, guest]) await p.evaluate(() => { const S = __game.S, u = S.ents.find(e => e.team === __game.team && e.kind === 'humvee'); if (u) __game.order(S, __game.team, { c: 'move', ids: [u.id], x: S.map.W / 2, y: S.map.H / 2, a: false }); });
  await wait(60000);
  const h1 = await seen(host), g1 = await seen(guest);
  await shot(host, 'game-host'); await shot(guest, 'game-guest');
  // The host refreshes the page and comes back into the same side, without the lobby showing on the way.
  await host.evaluateOnNewDocument(() => {
    window.__sawLobby = false;
    const t = setInterval(() => {
      const s = document.getElementById('t-setup'), ti = document.getElementById('title');
      if (s && ti && !s.hidden && !ti.hidden) window.__sawLobby = true;
      if (window.__game && window.__game.playing) clearInterval(t);
    }, 20);
  });
  await host.reload();
  await host.waitForFunction('document.body.classList.contains("ready") && window.__game && window.__game.playing && window.__game.online', { timeout: 30000 });
  await wait(5000);
  const back = await seen(host), gNow = await seen(guest);
  back.sawLobby = await host.evaluate(() => window.__sawLobby);
  // The guest leaves; their side is given up, and the host is told.
  await host.evaluate(() => { const h = window.__hud, say = h.say; window.__said = []; h.say = (t, k) => { window.__said.push(t); return say(t, k); }; });
  await guest.evaluate(() => { document.getElementById('b-pause').click(); });
  await wait(300);
  await guest.evaluate(() => document.getElementById('quit').click());
  await wait(4000);
  const h2 = await seen(host);
  const roster = await host.evaluate(() => document.getElementById('roster').innerText);
  h2.told = await host.evaluate(() => window.__said.filter(t => /forfeit|out\./.test(t)));
  await shot(host, 'after-leave');
  console.log(JSON.stringify({ listed, before, after, start: { host: h0, guest: g0 }, minute: { host: h1, guest: g1 }, back: { team: back.team, tick: back.tick, guestTick: gNow.tick, sawLobby: back.sawLobby }, afterLeave: { alive: h2.alive, roster, told: h2.told }, errors: { host: host.errs, guest: guest.errs } }, null, 1));
  // The host leaves too, so the room closes.
  await host.evaluate(() => { document.getElementById('b-pause').click(); document.getElementById('quit').click(); });
  await wait(2500);
  await b.close();
})();
