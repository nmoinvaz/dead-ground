#!/usr/bin/env node
// Chat and voice in a game with another player, headless, against a running server:
// `node voicecheck.js http://localhost:8799 [outdir]`. A host opens a game with a guest, both start it, the host
// says a line in the game and the guest sees it, then both go on voice with a tone standing in for the
// microphone, which headless Chrome cannot open, and each
// checks that sound arrives from the other and that the roster marks them as on voice.
const puppeteer = require('/Users/nathan/Source/film-studio/node_modules/puppeteer-core');
const url = process.argv[2] || 'http://localhost:8799', out = process.argv[3] || '';
const wait = ms => new Promise(r => setTimeout(r, ms));
const title = 'Voice check ' + (Date.now() % 100000);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--disable-speech-api', '--disable-speech-synthesis-api', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const page = async (name, id) => {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    // A tone in place of the microphone.
    await p.evaluateOnNewDocument(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain(), d = ac.createMediaStreamDestination();
        o.frequency.value = 440; g.gain.value = 0.5; o.connect(g).connect(d); o.start();
        return d.stream;
      };
    });
    await p.setViewport({ width: 1280, height: 800 });
    p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message));
    p.on('console', m => { const t = m.text(); if (m.type() === 'error' || t.startsWith('voice') || t.startsWith('@desync')) p.errs.push(t.slice(0, 200)); });
    await p.goto(url + '/?keep=1');
    await p.evaluate((n, i) => { localStorage.clear(); localStorage.setItem('dg-id', i); localStorage.setItem('dg-name', n); }, name, id);
    await p.reload();
    await p.waitForFunction('document.body.classList.contains("ready") && !document.getElementById("b-multi").hidden', { timeout: 60000 });
    return p;
  };
  const host = await page('Hosta', 'check-vhost'), guest = await page('Guesto', 'check-vguest');
  await host.click('#b-multi'); await wait(500);
  await host.type('#room-title', title);
  await host.click('#create');
  await host.waitForFunction('!document.getElementById("t-setup").hidden && document.getElementById("setup-code").textContent', { timeout: 15000 });
  // The second seat starts with a computer in it; the host opens it for the guest.
  await wait(600);
  await host.evaluate(() => { const s = document.querySelectorAll('#slots select')[0]; s.value = 'open'; s.dispatchEvent(new Event('change')); });
  await wait(800);
  await guest.click('#b-multi');
  await guest.waitForFunction(t => [...document.querySelectorAll('#rooms tbody tr')].some(r => r.innerText.includes(t)), { timeout: 25000 }, title);
  await guest.evaluate(t => [...document.querySelectorAll('#rooms tbody tr')].find(r => r.innerText.includes(t)).querySelector('button').click(), title);
  await guest.waitForFunction('!document.getElementById("t-setup").hidden && !document.getElementById("ready").hidden', { timeout: 15000 });
  await guest.click('#ready'); await wait(800);
  await host.click('#deploy');
  for (const p of [host, guest]) await p.waitForFunction('window.__game.playing && window.__game.online', { timeout: 30000 });
  await wait(1500);
  // A line said in the game, by Enter, reaches the other.
  await host.keyboard.press('Enter'); await wait(200);
  const opened = await host.evaluate(() => !document.getElementById('gchat-in').hidden && document.activeElement.id === 'gchat-in');
  await host.keyboard.type('flank them by the river'); await host.keyboard.press('Enter');
  await wait(1200);
  const heard = await guest.evaluate(() => document.getElementById('gchat-log').innerText);
  // Both on voice.
  for (const p of [host, guest]) { await p.evaluate(() => document.getElementById('b-voice').click()); await wait(400); }
  await wait(6000);
  const state = p => p.evaluate(async () => {
    const out = [];
    for (const [pk, q] of __voice.peers) {
      let inB = 0;
      (await q.pc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') inB = r.bytesReceived; });
      out.push({ pk, state: q.pc.connectionState, inBytes: inB });
    }
    return { on: __voice.on, me: __voice.me, list: __voice.list.map(v => v.n), peers: out, mics: document.querySelectorAll('#roster .mic').length, talking: document.querySelectorAll('#roster .mic.talk').length };
  });
  const h = await state(host), g = await state(guest);
  if (out) { await host.screenshot({ path: `${out}/voice-host.png` }); }
  // The guest goes off voice; the host's link to them closes.
  await guest.evaluate(() => document.getElementById('b-voice').click()); await wait(1500);
  const hAfter = await host.evaluate(() => ({ peers: __voice.peers.size, list: __voice.list.map(v => v.n) }));
  console.log(JSON.stringify({ chat: { opened, heard }, voice: { host: h, guest: g }, guestOff: hAfter, errors: { host: host.errs, guest: guest.errs } }, null, 1));
  for (const p of [host, guest]) await p.evaluate(() => { document.getElementById('b-exit').click(); document.getElementById('quit').click(); });
  await wait(800);
  await b.close();
})();
