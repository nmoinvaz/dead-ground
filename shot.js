#!/usr/bin/env node
// Opens the built page in a real Chrome window and saves pictures of it. node shot.js dist/index.html
// out-prefix [script.js], where the script runs in the page and may return later moments to take.
const puppeteer = require('/Users/nathan/Source/film-studio/node_modules/puppeteer-core');
const path = require('path');
(async () => {
  const file = path.resolve(process.argv[2] || 'dist/index.html'), out = process.argv[3] || 'review/shot';
  const steps = process.argv[4] ? require(path.resolve(process.argv[4])) : [{ wait: 2500, name: 'title' }];
  // Headless on the GPU, so no window opens on the desktop. SHOW=1 opens a visible one, for timing frames.
  const show = !!process.env.SHOW;
  const b = await puppeteer.launch({ headless: show ? false : 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--window-size=1500,960', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check'], defaultViewport: null });
  const p = (await b.pages())[0];
  await p.setViewport({ width: 1440, height: 860, deviceScaleFactor: 2 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') { if (!/GPU stall|GL Driver Message/.test(t)) errs.push(m.type() + ': ' + t); } else if (t.startsWith('@')) console.log(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  await p.goto('file://' + file + '?keep=1' + (process.env.Q ? '&' + process.env.Q : ''));
  await p.waitForFunction('document.body.classList.contains("ready") || window.__fail', { timeout: 60000 }).catch(e => errs.push('never ready: ' + e.message));
  for (const s of steps) {
    if (s.run) { const r = await p.evaluate(s.run); if (r !== undefined && s.log) console.log(s.name || 'run', JSON.stringify(r)); }
    if (s.fn) await s.fn(p);
    if (s.wait) await new Promise(r => setTimeout(r, s.wait));
    if (s.name && !s.nopic) { await p.screenshot({ path: `${out}-${s.name}.png` }); console.log('saved', `${out}-${s.name}.png`); }
  }
  console.log(errs.length ? 'ERRORS\n' + [...new Set(errs)].slice(0, 12).join('\n') : 'no errors');
  await b.close();
})();
