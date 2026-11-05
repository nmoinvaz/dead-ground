// Dead Ground, the closing report, after Age of Empires. A summary of each side's score, a timeline of their shares
// of the field with the fighting between them, graphs of their figures over the game, and their military and
// economic totals. All of it comes from the game's own record, so every player in a room sees the same report.
const Report = (() => {
  const { HZ } = Rules;
  // The slots' colours, as on the map. Light paper takes the deeper plate colours so lines stand off it.
  const SLOT_CSS = ['#6fb0ff', '#ff7a60', '#6fd47f', '#b98af0', '#ffae52', '#4fd8d4', '#ff7ac0', '#c99a6c'];
  const SLOT_PLATE = ['#2f6fd6', '#c8402f', '#2f9a48', '#7a48c8', '#d8781a', '#1c9a98', '#c83c8a', '#7a5230'];
  const TABS = [['sum', 'Summary'], ['time', 'Timeline'], ['graph', 'Graphs'], ['mil', 'Military'], ['eco', 'Economy']];
  const SERIES = [
    { k: 'sc', name: 'Score', y: 'Score (points)' },
    { k: 'ar', name: 'Army', y: 'Army worth (supply)' },
    { k: 'un', name: 'Units', y: 'Units on the map' },
    { k: 'ld', name: 'Land', y: 'Land held (% of map)', f: v => v / 10, fmt: v => v.toFixed(1) + '%' },
    { k: 'su', name: 'Supply', y: 'Supply earned' },
    { k: 'oi', name: 'Oil', y: 'Oil pumped' },
    { k: 'tw', name: 'Towns', y: 'Towns held' },
    { k: 'kv', name: 'Destroyed', y: 'Enemy worth destroyed (supply)' },
  ];
  // An age by name, and the short name its mark on a chart carries.
  const ageName = v => (Rules.AGES[v] || {}).name || '', ageShort = v => ageName(v).slice(0, 3);
  const store = { get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* no store */ } } };
  const num = v => Math.round(v).toLocaleString('en-US');
  const clock = s => `${s / 60 | 0}:${String(s % 60 | 0).padStart(2, '0')}`;
  const short = v => Math.abs(v) >= 10000 ? (v / 1000).toFixed(v % 1000 === 0 || Math.abs(v) >= 100000 ? 0 : 1) + 'k' : num(v);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  let cur = null, tab = store.get('dg-report-tab', 'sum'), series = store.get('dg-report-series', 'sc');

  // The look's inks, read off the page so the report follows the theme it is shown in.
  function inks() {
    const b = document.body, cs = getComputedStyle(b), v = k => cs.getPropertyValue(k).trim();
    const ink = b.dataset.look === 'ink', light = ink && b.dataset.scheme !== 'dark';
    return {
      ink, light, text: v('--stencil') || '#ddd', dim: v('--dim') || '#999', accent: v('--amber') || '#fb3',
      ground: ink ? v('--paper') : '#30352a', font: v('--label') || v('--ui') || 'sans-serif', mono: v('--mono') || 'monospace',
      line: t => (light ? SLOT_PLATE : SLOT_CSS)[t], wash: t => SLOT_CSS[t],
    };
  }

  // A side's figures and how it did, from the record and its running totals.
  function sides(o) {
    const S = o.S, h = S.hist, seats = (S.seats || S.P.map((_, t) => t)).filter(t => S.P[t]);
    const out = {}, techAt = {};
    if (h) for (const m of h.marks) { if (m.k === 'out') out[m.team] = m.t; if (m.k === 'tech') (techAt[m.team] = techAt[m.team] || {})[m.v] = m.t; }
    const list = seats.map(t => ({ t, name: o.name(t), P: S.P[t], s: S.P[t].stats, sc: Rules.scoreOf(S, t), out: out[t], tech: techAt[t] || {} }));
    // The winner first, then those still standing, then by score.
    const w = S.over ? S.over.winner : -2;
    list.sort((a, b) => (b.t === w) - (a.t === w) || b.P.alive - a.P.alive || (b.out || 0) - (a.out || 0) || b.sc.total - a.sc.total);
    return list;
  }
  const result = (S, x) => S.over && S.over.winner === x.t ? 'Won' : x.out !== undefined ? 'Out ' + clock(x.out / HZ) : x.P.alive ? 'Standing' : 'Out';

  // A table of each side's figures. cols is a list of [heading, side => value].
  function table(list, cols) {
    const wrap = el('div', 'rtable'), tb = el('table'), head = el('tr');
    head.appendChild(el('th'));
    for (const [h] of cols) head.appendChild(el('th', 'n', h));
    const thead = el('thead'); thead.appendChild(head); tb.appendChild(thead);
    const body = el('tbody');
    for (const x of list) {
      const tr = el('tr'), th = el('th'), dot = el('i', 'slot');
      dot.style.background = SLOT_CSS[x.t]; dot.textContent = x.t + 1;
      th.append(dot, el('span', '', x.name));
      tr.appendChild(th);
      for (const [, f] of cols) tr.appendChild(el('td', '', f(x)));
      body.appendChild(tr);
    }
    tb.appendChild(body); wrap.appendChild(tb);
    return wrap;
  }

  // ---- Charts --------------------------------------------------------------------------------------------

  function fit(c) {
    const r = c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    return { g, w: r.width, h: r.height };
  }
  function niceStep(span, n) {
    const raw = span / n, p = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  const timeStep = span => [30, 60, 120, 300, 600, 900, 1200, 1800, 3600].find(s => span / s <= 7) || 3600;

  // The plot box, the time axis along the bottom and the grid, shared by both charts.
  function frame(g, w, h, I, t0, t1, pad) {
    const box = { x: pad.l, y: pad.t, w: w - pad.l - pad.r, h: h - pad.t - pad.b };
    const X = s => box.x + (s - t0) / Math.max(1, t1 - t0) * box.w;
    g.font = `11px ${I.mono}`; g.fillStyle = I.dim; g.textAlign = 'center'; g.textBaseline = 'top';
    const st = timeStep(t1 - t0);
    g.strokeStyle = I.dim; g.lineWidth = 1;
    for (let s = Math.ceil(t0 / st) * st; s <= t1 + 0.01; s += st) {
      const x = X(s);
      g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x, box.y + box.h); g.lineTo(x, box.y + box.h + 4); g.stroke(); g.globalAlpha = 1;
      g.textAlign = x - box.x < 16 ? 'left' : box.x + box.w - x < 16 ? 'right' : 'center';
      g.fillText(clock(s), x, box.y + box.h + 6);
    }
    g.textAlign = 'right'; g.font = `11px ${I.font}`;
    g.fillText('game time', box.x + box.w, box.y + box.h + 20);
    return { box, X };
  }
  // A small mark on a chart: a tag naming the age a side reached, an out cross, or a missile launch.
  function glyph(g, I, k, x, y, col, v) {
    g.save();
    if (k === 'tech') {
      g.font = `600 10px ${I.font}`;
      const t = ageShort(v), w = g.measureText(t).width + 8, h = 14;
      g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - h / 2, w, h, 4) : g.rect(x - w / 2, y - h / 2, w, h);
      g.fillStyle = I.ground; g.fill(); g.lineWidth = 1.5; g.strokeStyle = col; g.stroke();
      g.fillStyle = I.text; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y + 0.5);
    } else if (k === 'out') {
      g.strokeStyle = I.ground; g.lineWidth = 4.5; g.lineCap = 'round';
      const X = () => { g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke(); };
      X(); g.strokeStyle = I.text; g.lineWidth = 2; X();
    } else if (k === 'launch') {
      g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 5, y + 5); g.lineTo(x, y + 2.5); g.lineTo(x - 5, y + 5); g.closePath();
      g.fillStyle = I.accent; g.strokeStyle = I.ground; g.lineWidth = 1.5; g.fill(); g.stroke();
    }
    g.restore();
  }
  function badge(g, I, t, x, y) {
    g.beginPath(); g.arc(x, y, 7.5, 0, 6.2832); g.fillStyle = SLOT_CSS[t]; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = I.ink ? I.text : '#000'; g.stroke();
    g.fillStyle = '#111'; g.font = `700 10px ${I.font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(t + 1), x, y + 0.5);
  }
  // Moves labels apart so none overlaps, keeping their order.
  function dodge(items, gap, lo, hi) {
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + gap);
    const n = items.length;
    if (n && items[n - 1].y > hi) { items[n - 1].y = hi; for (let i = n - 2; i >= 0; i--) items[i].y = Math.min(items[i].y, items[i + 1].y - gap); }
    for (const it of items) it.y = Math.max(lo, it.y);
  }
  function tipAt(tip, pane, x, y, rows, head) {
    tip.replaceChildren(el('b', '', head));
    for (const [t, name, val] of rows) {
      const r = el('div'), dot = el('i', 'slot'); dot.style.background = SLOT_CSS[t]; dot.textContent = t + 1;
      r.append(dot, el('span', '', name), el('em', '', val)); tip.appendChild(r);
    }
    tip.hidden = false;
    const pw = pane.clientWidth, tw = tip.offsetWidth;
    tip.style.left = (x + 14 + tw > pw ? Math.max(0, x - 14 - tw) : x + 14) + 'px';
    tip.style.top = Math.max(0, y - 10) + 'px';
  }
  // Hover on a chart: draw calls the chart's own drawing with the sample under the pointer, or none.
  function hover(c, tip, pane, draw) {
    const at = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.onpointermove = c.onpointerdown = e => { const [x, y] = at(e); const rows = draw(x); if (rows) tipAt(tip, pane, c.offsetLeft + x, c.offsetTop + y, rows.rows, rows.head); else tip.hidden = true; };
    c.onpointerleave = () => { draw(null); tip.hidden = true; };
  }

  // A line for each side of one figure over the game, ended by its slot's badge.
  function lineChart(c, tip, pane, o, list, key) {
    const S = o.S, h = S.hist, def = SERIES.find(s => s.k === key) || SERIES[0], f = def.f || (v => v), fmt = def.fmt || num;
    const ts = h.t.map(t => t / HZ), t0 = ts[0], t1 = ts[ts.length - 1];
    const vals = list.map(x => (h.P[x.t] ? h.P[x.t][key] : []).map(f));
    let top = 0;
    for (const a of vals) for (const v of a) top = Math.max(top, v);
    const step = niceStep(top || 1, 4), ymax = Math.max(step, Math.ceil(top / step) * step);
    const marks = h.marks.filter(m => m.k === 'tech' || m.k === 'out');
    const draw = (hx) => {
      const I = inks(), { g, w, h: hh } = fit(c);
      g.clearRect(0, 0, w, hh);
      const { box, X } = frame(g, w, hh, I, t0, t1, { l: 44, r: 30, t: 30, b: 36 });
      const Y = v => box.y + box.h - v / ymax * box.h;
      // The measure named over its axis, and a recessive grid.
      g.font = `12px ${I.font}`; g.fillStyle = I.dim; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText(def.y, 4, 13);
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.font = `11px ${I.mono}`;
      for (let v = 0; v <= ymax + 1e-6; v += step) {
        const y = Y(v);
        g.strokeStyle = I.dim; g.globalAlpha = v ? 0.28 : 0.7; g.lineWidth = 1;
        g.setLineDash(I.ink && v ? [1, 3] : []); g.beginPath(); g.moveTo(box.x, y); g.lineTo(box.x + box.w, y); g.stroke(); g.setLineDash([]);
        g.globalAlpha = 1; g.fillStyle = I.dim; g.fillText(def.fmt ? fmt(v) : short(v), box.x - 6, y);
      }
      // The lines, the leader's last so it reads on top.
      const order = list.map((x, i) => i).reverse();
      g.lineJoin = 'round'; g.lineCap = 'round';
      for (const i of order) {
        const a = vals[i]; if (a.length < 2) continue;
        g.beginPath();
        a.forEach((v, j) => { const x = X(ts[j]), y = Y(v); if (j) g.lineTo(x, y); else g.moveTo(x, y); });
        g.strokeStyle = I.ground; g.lineWidth = 4; g.stroke();
        g.strokeStyle = I.line(list[i].t); g.lineWidth = 2; g.stroke();
      }
      // Tech levels and the moment a side was out, on its own line.
      const valAt = (a, s) => { let j = 1; while (j < ts.length - 1 && ts[j] < s) j++; const k = Math.max(0, Math.min(1, (s - ts[j - 1]) / ((ts[j] - ts[j - 1]) || 1))); return a[j - 1] + (a[j] - a[j - 1]) * k; };
      for (const m of marks) {
        const i = list.findIndex(x => x.t === m.team); if (i < 0) continue;
        const s = m.t / HZ; if (s < t0 || s > t1) continue;
        glyph(g, I, m.k, X(s), Y(valAt(vals[i], s)), I.line(m.team), m.v);
      }
      // Each line ends at its slot's badge.
      const ends = list.map((x, i) => ({ t: x.t, y: Y(vals[i][vals[i].length - 1] || 0) }));
      dodge(ends, 16, box.y, box.y + box.h);
      for (const e of ends) badge(g, I, e.t, box.x + box.w + 14, e.y);
      if (hx === null || hx === undefined || hx < box.x - 10 || hx > box.x + box.w + 10) return null;
      // The sample under the pointer, a crosshair and a dot on each line.
      let j = 0, bd = Infinity;
      ts.forEach((s, k) => { const d = Math.abs(X(s) - hx); if (d < bd) { bd = d; j = k; } });
      const x = X(ts[j]);
      g.strokeStyle = I.text; g.globalAlpha = 0.6; g.lineWidth = 1; g.beginPath(); g.moveTo(x, box.y); g.lineTo(x, box.y + box.h); g.stroke(); g.globalAlpha = 1;
      for (let i = 0; i < list.length; i++) {
        const v = vals[i][j]; if (v === undefined) continue;
        g.beginPath(); g.arc(x, Y(v), 4.5, 0, 6.2832); g.fillStyle = I.line(list[i].t); g.fill(); g.lineWidth = 2; g.strokeStyle = I.ground; g.stroke();
      }
      const rows = list.map((x, i) => [x.t, x.name, fmt(vals[i][j] || 0), vals[i][j] || 0]).sort((a, b) => b[3] - a[3]);
      return { head: `${def.name} at ${clock(ts[j])}`, rows };
    };
    draw(null);
    hover(c, tip, pane, draw);
    return draw;
  }

  // The timeline: each side a band as thick as its share of all units on the map, top to bottom by slot. Lines
  // across the bands are fighting between two sides, in the colour of the side that did the most harm.
  function timeline(c, tip, pane, o, list) {
    const S = o.S, h = S.hist, ts = h.t.map(t => t / HZ), t0 = ts[0], t1 = ts[ts.length - 1], n = S.P.length;
    const bands = list.map(x => x.t).sort((a, b) => a - b);
    const un = bands.map(t => h.P[t] ? h.P[t].un : []);
    const sum = ts.map((_, j) => un.reduce((s, a) => s + (a[j] || 0), 0));
    // Each band's top and bottom share at each sample.
    const lo = bands.map(() => []), hi = bands.map(() => []);
    ts.forEach((_, j) => { let acc = 0; bands.forEach((t, b) => { lo[b][j] = acc; acc += sum[j] ? (un[b][j] || 0) / sum[j] : 1 / bands.length; hi[b][j] = acc; }); });
    // The fighting at each sample, summed per pair of sides.
    const fights = [];
    let most = 0;
    h.war.forEach((w, j) => {
      if (!j) return;
      const pairs = {};
      for (let i = 0; i < w.length; i += 3) {
        const a = w[i], b = w[i + 1], d = w[i + 2], k = Math.min(a, b) * n + Math.max(a, b);
        const p = pairs[k] = pairs[k] || { a: Math.min(a, b), b: Math.max(a, b), d: 0, by: {} };
        p.d += d; p.by[a] = (p.by[a] || 0) + d;
      }
      for (const k in pairs) { const p = pairs[k]; most = Math.max(most, p.d); fights.push({ j, ...p }); }
    });
    const draw = (hx) => {
      const I = inks(), { g, w, h: hh } = fit(c);
      g.clearRect(0, 0, w, hh);
      const { box, X } = frame(g, w, hh, I, t0, t1, { l: 8, r: 8, t: 26, b: 36 });
      const Y = s => box.y + s * box.h;
      g.font = `12px ${I.font}`; g.fillStyle = I.dim; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('Share of all units on the map', 4, 13);
      // The bands, washed in each slot's colour and ruled apart.
      bands.forEach((t, b) => {
        g.beginPath();
        ts.forEach((s, j) => { const x = X(s), y = Y(lo[b][j]); if (j) g.lineTo(x, y); else g.moveTo(x, y); });
        for (let j = ts.length - 1; j >= 0; j--) g.lineTo(X(ts[j]), Y(hi[b][j]));
        g.closePath();
        g.globalAlpha = I.light ? 0.78 : I.ink ? 0.62 : 0.8; g.fillStyle = I.wash(t); g.fill(); g.globalAlpha = 1;
      });
      g.strokeStyle = I.light ? I.text : I.ground; g.lineWidth = I.light ? 1 : 1.5;
      bands.forEach((t, b) => { if (!b) return; g.beginPath(); ts.forEach((s, j) => { const x = X(s), y = Y(lo[b][j]); if (j) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
      g.strokeStyle = I.light ? I.text : I.dim; g.lineWidth = 1; g.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
      const mid = (b, j) => Y((lo[b][j] + hi[b][j]) / 2);
      // Fighting, the heavier the thicker. Only real clashes are drawn, not every stray shot.
      const floor = Math.max(300, most * 0.15);
      for (const f of fights) {
        if (f.d < floor) continue;
        const ba = bands.indexOf(f.a), bb = bands.indexOf(f.b); if (ba < 0 || bb < 0) continue;
        const x = X((ts[f.j - 1] + ts[f.j]) / 2), ya = (mid(ba, f.j - 1) + mid(ba, f.j)) / 2, yb = (mid(bb, f.j - 1) + mid(bb, f.j)) / 2;
        const lead = (f.by[f.a] || 0) >= (f.by[f.b] || 0) ? f.a : f.b, k = Math.min(1, Math.sqrt(f.d / most)), wd = 1 + 2 * k;
        g.lineCap = 'round'; g.globalAlpha = 0.45 + 0.55 * k;
        g.strokeStyle = I.ground; g.lineWidth = wd + 2; g.beginPath(); g.moveTo(x, ya); g.lineTo(x, yb); g.stroke();
        g.strokeStyle = I.line(lead); g.lineWidth = wd; g.stroke();
        g.globalAlpha = 1;
      }
      // Tech levels, launches and falls, on the side's own band.
      const at = s => { let j = 1; while (j < ts.length - 1 && ts[j] < s) j++; return j; };
      for (const m of h.marks) {
        const b = bands.indexOf(m.team), s = m.t / HZ; if (b < 0 || s < t0 || s > t1 || m.k === 'won') continue;
        const j = at(s), k = Math.max(0, Math.min(1, (s - ts[j - 1]) / ((ts[j] - ts[j - 1]) || 1)));
        // A side is out where its band has gone, so its cross sits where the band last was.
        const y = m.k === 'out' ? mid(b, j - 1) : mid(b, j - 1) + (mid(b, j) - mid(b, j - 1)) * k;
        glyph(g, I, m.k, X(s), y, I.line(m.team), m.v);
      }
      // Each side named on its band where the band is widest, if there is room.
      bands.forEach((t, b) => {
        let bj = 0, bw = 0;
        const name = list.find(x => x.t === t).name;
        g.font = `600 12px ${I.font}`;
        const tw = g.measureText(name).width + 24;
        ts.forEach((_, j) => { const d = (hi[b][j] - lo[b][j]) * box.h; if (d > bw && X(ts[j]) > box.x + 14 && X(ts[j]) + tw < box.x + box.w - 4) { bw = d; bj = j; } });
        if (bw < 18) return;
        const x = X(ts[bj]), y = mid(b, bj);
        badge(g, I, t, x - 2, y);
        g.font = `600 12px ${I.font}`; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.lineWidth = 3; g.strokeStyle = I.ground; g.lineJoin = 'round'; g.strokeText(name, x + 9, y + 0.5);
        g.fillStyle = I.text; g.fillText(name, x + 9, y + 0.5);
      });
      if (hx === null || hx === undefined || hx < box.x || hx > box.x + box.w) return null;
      let j = 0, bd = Infinity;
      ts.forEach((s, k) => { const d = Math.abs(X(s) - hx); if (d < bd) { bd = d; j = k; } });
      const x = X(ts[j]);
      g.strokeStyle = I.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, box.y); g.lineTo(x, box.y + box.h); g.stroke();
      const ageAt = (t, tick) => h.marks.reduce((a, m) => m.k === 'tech' && m.team === t && m.t <= tick && m.v > a ? m.v : a, S.age0 || 1);
      const rows = bands.map((t, b) => [t, list.find(y => y.t === t).name, `${un[b][j] || 0} · ${Math.round((hi[b][j] - lo[b][j]) * 100)}% · ${ageName(ageAt(t, h.t[j]))}`, un[b][j] || 0]).sort((a, b) => b[3] - a[3]);
      return { head: `Units at ${clock(ts[j])}`, rows };
    };
    draw(null);
    hover(c, tip, pane, draw);
    return draw;
  }

  // Two bars a side on one scale: the worth it destroyed, solid, and the worth it lost, hatched.
  function worthBars(list) {
    const box = el('div', 'rbars'), top = Math.max(1, ...list.map(x => Math.max(x.s.killV, x.s.lostV)));
    box.appendChild(el('p', 'rcap', 'Worth destroyed and lost (supply)'));
    for (const x of list) {
      const row = el('div', 'rbar'), dot = el('i', 'slot'); dot.style.background = SLOT_CSS[x.t]; dot.textContent = x.t + 1;
      const nm = el('span', 'nm'); nm.append(dot, el('span', '', x.name));
      const bars = el('div', 'bb');
      for (const [k, cls] of [['killV', 'kill'], ['lostV', 'lost']]) {
        const r = el('div', 'br ' + cls), b = el('i'); b.style.width = (x.s[k] / top * 100) + '%'; b.style.setProperty('--c', SLOT_CSS[x.t]);
        r.append(b, el('em', '', num(x.s[k]))); bars.appendChild(r);
      }
      row.append(nm, bars); box.appendChild(row);
    }
    const key = el('p', 'rkey');
    const k1 = el('span', 'kill'), k2 = el('span', 'lost'); k1.append(el('i'), 'destroyed'); k2.append(el('i'), 'lost');
    key.append(k1, k2); box.appendChild(key);
    return box;
  }

  // ---- The report -----------------------------------------------------------------------------------------

  // Fills root with the tabs and the chosen pane. o has the game S and name(t), a side's name.
  function show(root, o) {
    const list = sides(o), h = o.S.hist, charted = h && h.t.length >= 2;
    root.replaceChildren();
    const nav = el('nav', 'rtabs'), pane = el('div', 'rpane'), tip = el('div', 'rtip');
    tip.hidden = true;
    root.append(nav, pane);
    cur = { root, o, redraw: null };
    const open = k => {
      tab = k; store.set('dg-report-tab', k);
      for (const b of nav.children) b.classList.toggle('on', b.dataset.k === k);
      pane.replaceChildren(); tip.hidden = true; cur.redraw = null;
      const S = o.S;
      if (k === 'sum') {
        pane.appendChild(table(list, [['Score', x => num(x.sc.total)], ['Military', x => num(x.sc.mil)], ['Economy', x => num(x.sc.eco)], ['Ages', x => num(x.sc.tec)], ['Territory', x => num(x.sc.ter)], ['Reached', x => ageName(x.P.tech)], ['Result', x => result(S, x)]]));
        pane.appendChild(el('p', 'rkey', 'Military is a tenth of the enemy worth destroyed, economy a twentieth of all supply and oil earned, ages the cost of the ages reached, territory 40 a town and 10 for each percent of the map held.'));
      } else if (k === 'mil') {
        pane.appendChild(table(list, [['Made', x => num(x.s.made)], ['Infantry', x => num(x.s.inf)], ['Vehicles', x => num(x.s.veh)], ['Aircraft', x => num(x.s.air)], ['Kills', x => num(x.s.killed)], ['Razed', x => num(x.s.razed)], ['Units lost', x => num(x.s.lost)], ['Bldgs lost', x => num(x.s.blost)]]));
        pane.appendChild(worthBars(list));
      } else if (k === 'eco') {
        pane.appendChild(table(list, [['Ore mined', x => num(x.s.mined)], ['From towns', x => num(x.s.townIn)], ['Oil', x => num(x.s.oilIn)], ['Spent', x => num(x.s.spent)], ['Oil spent', x => num(x.s.spentOil)], ['Built', x => num(x.s.built)]]));
        // When each side reached each age after the one the game began in, as far as any side went.
        const a0 = S.age0 || 1, top = Math.max(...list.map(x => x.P.tech));
        if (top > a0) {
          const when = (x, v) => x.tech[v] !== undefined ? clock(x.tech[v] / HZ) : x.P.tech >= v ? 'yes' : '—', cols = [];
          for (let v = a0 + 1; v <= top; v++) cols.push([ageName(v), x => when(x, v)]);
          pane.appendChild(el('p', 'rcap', 'Ages reached, by game time'));
          pane.appendChild(table(list, cols));
        }
      } else if (!charted) {
        pane.appendChild(el('p', 'rkey', 'The game was too short to chart.'));
      } else if (k === 'time') {
        const c = el('canvas', 'rchart'); pane.append(c, tip);
        const key = el('p', 'rkey', 'Lines across the bands are fighting between two sides, in the colour of the side that did more harm. Tags name the age a side reached, triangles mark missile launches and crosses the end of a side.');
        pane.appendChild(key);
        cur.redraw = () => timeline(c, tip, pane, o, list);
      } else if (k === 'graph') {
        const pick = el('div', 'rseries');
        for (const s of SERIES) {
          const b = el('button', s.k === series ? 'on' : '', s.name);
          b.onclick = () => { series = s.k; store.set('dg-report-series', s.k); open('graph'); };
          pick.appendChild(b);
        }
        const c = el('canvas', 'rchart'); pane.append(pick, c, tip);
        cur.redraw = () => lineChart(c, tip, pane, o, list, series);
      }
      if (cur.redraw) requestAnimationFrame(() => cur && cur.redraw && cur.redraw());
    };
    for (const [k, name] of TABS) {
      const b = el('button', '', name); b.dataset.k = k; b.onclick = () => open(k);
      nav.appendChild(b);
    }
    open(TABS.some(t => t[0] === tab) ? tab : 'sum');
  }
  window.addEventListener('resize', () => { if (cur && cur.redraw && cur.root.offsetParent) cur.redraw(); });
  // Redraws after the look or its scheme changes.
  function refresh() { if (cur && cur.redraw && cur.root.offsetParent) cur.redraw(); }

  return { show, refresh, SERIES };
})();
