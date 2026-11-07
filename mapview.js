#!/usr/bin/env node
// Draws a map as the rules see it, woods in dark green. node mapview.js seed out.png [layout]
const R = require('./rules.js');
const { createCanvas } = require('/Users/nathan/Source/film-studio/node_modules/@napi-rs/canvas');
const fs = require('fs');
const S = R.newGame({ seed: +process.argv[2] || 1, layout: process.argv[4] || 'duel' }), M = S.map, Z = R.W > 128 ? 3 : 6;
const c = createCanvas(R.W * Z, R.H * Z), g = c.getContext('2d');
for (let y = 0; y < R.H; y++) for (let x = 0; x < R.W; x++) {
  const h = R.terrainAt(M, x + .5, y + .5), b = M.ground[y * R.W + x], v = Math.max(0, Math.min(1, (h + 1) / 9)) * 255 | 0;
  g.fillStyle = b === 7 && h < 0.2 ? '#2a5a80' : (b & 8) ? '#2f5a26' : b === 7 ? '#203018' : (b & 1) ? `rgb(${v},${v * .5 | 0},${v * .4 | 0})` : (b & 4) ? `rgb(${v},${v},${v * .7 | 0})` : `rgb(${v * .8 | 0},${v | 0},${v * .7 | 0})`;
  if (M.ore[y * R.W + x]) g.fillStyle = '#e8c030';
  if (S.terr[y * R.W + x] >= 0) g.globalAlpha = 1;
  g.fillRect(x * Z, y * Z, Z, Z);
}
g.fillStyle = '#ff00ff'; for (const t of M.towns) g.fillRect(t.x * Z - 8, t.y * Z - 8, 16, 16);
g.fillStyle = '#9090ff'; for (const b of M.bridges) { g.save(); g.strokeStyle = '#c0c0ff'; g.lineWidth = b.w * Z; g.beginPath(); g.moveTo(b.x0 * Z, b.y0 * Z); g.lineTo(b.x1 * Z, b.y1 * Z); g.stroke(); g.restore(); }
g.fillStyle = '#000'; for (const w of M.wells) g.fillRect(w.x * Z - 5, w.y * Z - 5, 10, 10);
g.fillStyle = '#fff'; for (const h of M.houses) g.fillRect(h.x * Z, h.y * Z, h.w * Z, h.h * Z);
g.strokeStyle = '#f80'; g.lineWidth = 1; for (const r of M.roads) { g.beginPath(); r.forEach((p, i) => i ? g.lineTo(p[0] * Z, p[1] * Z) : g.moveTo(p[0] * Z, p[1] * Z)); g.stroke(); }
g.fillStyle = '#0ff'; for (const e of S.ents) if (e.b) g.fillRect(e.cx * Z, e.cy * Z, e.w * Z, e.h * Z);
console.log('seed', S.seed, 'why', M.why);
fs.writeFileSync(process.argv[3] || 'review/map.png', c.toBuffer('image/png'));
