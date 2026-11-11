// Mapmaker's War, the units drawn as a draughtsman would: convex solids projected in parallel, each part with a heavy
// outline, its inner edges in fine line and its shaded faces hatched by the light, over pale washes. No 3D engine.
// The sidebar's unit pictures come from here, and so does the study in review/axo.
const Axo = (() => {
  // ---- Vectors ------------------------------------------------------------------------------------------------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => mul(a, 1 / (len(a) || 1));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const mean = ps => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);
  const RAD = Math.PI / 180;

  // ---- Solids -------------------------------------------------------------------------------------------------
  // Every solid is a loft between two rings of matching points, so each is convex: a box, a wedge, a prism, a
  // cylinder or a cone. Its faces are the two rings and the quads between them. Side faces of a round solid are
  // marked smooth, so no line is drawn between them. o.top gives the top ring its own material, as a bin's inside.
  function loft(r0, r1, mat, o = {}) {
    const n = r0.length, faces = [{ pts: r0.slice(), cap: true }, { pts: r1.slice(), cap: true, mat: o.top }];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push({ pts: [r0[i], r0[j], r1[j], r1[i]], smooth: !!o.smooth, along: sub(r1[i], r0[i]) }); }
    return { faces, mat, b: o.b || 0 };
  }
  const rect = (x0, x1, y0, y1, z) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  // A box, its top optionally drawn in to make a wedge.
  const box = (x0, x1, y0, y1, z0, z1, mat, o = {}) => loft(rect(x0, x1, y0, y1, z0), rect(o.tx0 ?? x0, o.tx1 ?? x1, o.ty0 ?? y0, o.ty1 ?? y1, z1), mat, o);
  // Prisms of a convex outline: pz stands a plan [x, y] up from z0 to z1, py a side outline [x, z] across y.
  const pz = (pl, z0, z1, mat, o) => loft(pl.map(([x, y]) => [x, y, z0]), pl.map(([x, y]) => [x, y, z1]), mat, o);
  const py = (pl, y0, y1, mat, o) => loft(pl.map(([x, z]) => [x, y0, z]), pl.map(([x, z]) => [x, y1, z]), mat, o);
  const ringX = (x, y0, y1, z0, z1) => [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]];
  // A cylinder or cone on an axis, centred at c, of length l, radius r at its low end and r1 at its high end.
  function cyl(axis, c, r, l, mat, n = 16, r1 = r, o = {}) {
    const ring = (rr, a) => Array.from({ length: n }, (_, i) => {
      const t = i / n * 2 * Math.PI, u = Math.cos(t) * rr, v = Math.sin(t) * rr;
      return axis === 'x' ? [c[0] + a, c[1] + u, c[2] + v] : axis === 'y' ? [c[0] + u, c[1] + a, c[2] + v] : [c[0] + u, c[1] + v, c[2] + a];
    });
    return loft(ring(r, -l / 2), ring(r1, l / 2), mat, Object.assign({ smooth: true }, o));
  }
  const oct = (cx, cy, r, z, k = 8, a0 = Math.PI / 8) => Array.from({ length: k }, (_, i) => [cx + r * Math.cos(a0 + i * 2 * Math.PI / k), cy + r * Math.sin(a0 + i * 2 * Math.PI / k), z]);
  // A track run: a long six-sided outline with sloped ends, as an idler and a sprocket give it.
  const track = (x0, x1, z0, z1) => { const h = z1 - z0; return [[x0 + h * 0.45, z0], [x1 - h * 0.45, z0], [x1, z0 + h * 0.55], [x1 - h * 0.28, z1], [x0 + h * 0.28, z1], [x0, z0 + h * 0.5]]; };

  // Moving parts about: every point of each part, and the direction its sides run.
  const each = (parts, f) => { const o = f([0, 0, 0]); for (const p of parts) for (const fc of p.faces) { fc.pts = fc.pts.map(f); if (fc.along) fc.along = sub(f(fc.along), o); } return parts; };
  const move = (parts, d) => each(parts, p => add(p, d));
  function turn(parts, axis, deg, at = [0, 0, 0]) {
    const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
    return each(parts, p => {
      const [x, y, z] = sub(p, at);
      const q = axis === 'z' ? [x * c - y * s, x * s + y * c, z] : axis === 'y' ? [x * c + z * s, y, -x * s + z * c] : [x, y * c - z * s, y * s + z * c];
      return add(q, at);
    });
  }
  const mirror = parts => parts.map(p => ({ faces: p.faces.map(f => ({ ...f, pts: f.pts.map(([x, y, z]) => [x, -y, z]), along: f.along && [f.along[0], -f.along[1], f.along[2]] })), mat: p.mat, b: p.b }));
  // A seeded random, so lumps of ore fall the same each time.
  const rng = s => () => (s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), ((s >>>= 0) % 10000) / 10000);
  const wheels = (xs, y, r, w, hub = true) => xs.flatMap(x => [1, -1].flatMap(s => [cyl('y', [x, s * y, r], r, w, 'dark', 18), ...(hub ? [cyl('y', [x, s * (y + w / 2 + 0.03), r], r * 0.44, 0.05, 'metal', 10)] : [])]));
  // A rod from a to b with n sides, of radius r at a and r1 at b: a leg, a shaft, a strut or a barrel.
  function rod(a, b, r, mat, n = 4, r1 = r, o = {}) {
    const d = norm(sub(b, a)), u = norm(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross(d, u);
    const ring = (c, rr) => Array.from({ length: n }, (_, i) => { const t = (i + 0.5) / n * 2 * Math.PI; return add(c, add(mul(u, Math.cos(t) * rr), mul(v, Math.sin(t) * rr))); });
    return loft(ring(a, r), ring(b, r1), mat, Object.assign({ smooth: n > 5 }, o));
  }
  // A ball as two cones base to base, as a stone or a round shot.
  const ball = (c, r, mat) => [cyl('z', [c[0], c[1], c[2] - r * 0.35], r * 0.6, r * 0.7, mat, 10, r), cyl('z', [c[0], c[1], c[2] + r * 0.35], r, r * 0.7, mat, 10, r * 0.6)];
  // The parts of one body keep together in depth, so a far man or horse never laps a near one.
  const grp = parts => { const g = {}; for (const p of parts) p.g = g; return parts; };
  // A spoked wheel of wood on an iron hub, its spokes on the outer face.
  function spoked(x, y, r, w, mat = 'wood') {
    const s = Math.sign(y) || 1, yo = y + s * (w / 2 + 0.012);
    const p = [cyl('y', [x, y, r], r, w, mat, 18), cyl('y', [x, y + s * (w / 2 + 0.025), r], r * 0.2, 0.06, 'metal', 8, r * 0.2, { b: 0.03 })];
    for (const a of [0, 60, 120]) { const c = Math.cos(a * RAD) * r * 0.86, sn = Math.sin(a * RAD) * r * 0.86; p.push(rod([x - c, yo, r - sn], [x + c, yo, r + sn], 0.022, 'dark', 4, 0.022, { b: 0.02 })); }
    return p;
  }
  // Lumps of ore heaped on a bed from z up, the same each time for a seed.
  function lumps(x0, x1, y0, y1, z, n, seed, s0 = 0.28) {
    const p = [], r = rng(seed);
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), s = s0 + r() * s0 * 0.8;
      p.push(...turn(turn([box(x - s, x + s, y - s, y + s, z, z + s * 1.3, 'ore', { tx0: x - s * 0.5, tx1: x + s * 0.6, ty0: y - s * 0.4, ty1: y + s * 0.7 })], 'z', r() * 90, [x, y, z + 0.2]), 'x', (r() - 0.5) * 20, [x, y, z + 0.2]));
    }
    return p;
  }
  // A half round along x from x0 to x1, standing on z, as a wagon's canvas over its hoops.
  function arch(x0, x1, r, z, mat) {
    const ring = x => Array.from({ length: 9 }, (_, i) => { const a = i / 8 * Math.PI; return [x, Math.cos(a) * r, z + Math.sin(a) * r]; });
    return loft(ring(x0), ring(x1), mat, { smooth: true });
  }
  // A pennant of the side's colour on a pole at (x, y) from z0, flying back.
  const flag = (x, y, z0, h = 1.2, L = 0.62) => [rod([x, y, z0], [x, y, z0 + h], 0.025, 'wood'), py([[x, z0 + h - 0.02], [x - L, z0 + h - 0.17], [x, z0 + h - 0.38]], y - 0.02, y + 0.02, 'mark', { b: 0.05 })];
  // Hover pads at each x and y, a dark housing over a band of light.
  const hoverPads = (xs, ys, z = 0.42, r = 0.44) => xs.flatMap(x => ys.flatMap(y => [cyl('z', [x, y, z + 0.08], r, 0.22, 'dark', 12, r * 1.14), cyl('z', [x, y, z - 0.08], r * 0.86, 0.1, 'glow', 12, r * 0.95)]));

  // ---- People -------------------------------------------------------------------------------------------------
  // A standing figure facing x, 1.8 m, in o.cloth with o.legs, a helmet or o.hair, and what it carries.
  function figure(o = {}) {
    const st = o.stride ?? 0.04, cloth = o.cloth || 'cloth', legs = o.legs || cloth;
    const p = [
      box(-0.02, 0.18, 0.03, 0.18, 0, 0.86, legs), box(-0.2, -0.02 + st, -0.18, -0.03, 0, 0.86, legs),
      box(-0.03, 0.2, 0.03, 0.18, 0, 0.1, 'dark', { b: 0.01 }), box(-0.22, -0.02 + st, -0.18, -0.03, 0, 0.1, 'dark', { b: 0.01 }),
      box(-0.15, 0.13, -0.23, 0.23, 0.84, 1.44, cloth, { tx1: 0.11 }),
      cyl('z', [0.02, 0, 1.55], 0.1, 0.2, 'skin', 10),
      // o.raise lifts the right arm to throw.
      o.raise ? rod([-0.02, -0.25, 1.36], [-0.2, -0.31, 1.9], 0.06, cloth, 4, 0.05, { b: 0.06 }) : box(-0.05, 0.36, -0.31, -0.2, 1.13, 1.27, cloth, { b: 0.06 }),
      box(0.05, 0.42, 0.12, 0.22, 1.12, 1.25, cloth),
    ];
    // o.pack and o.vest may name their material. o.patch keeps the side's patch on a sleeve with no vest.
    if (o.pack !== false) p.push(box(-0.4, -0.16, -0.17, 0.17, 1.0, 1.42, typeof o.pack === 'string' ? o.pack : 'cloth', { b: -0.05 }));
    if (o.vest !== false) p.push(box(-0.18, 0.17, -0.21, 0.21, 0.98, 1.38, typeof o.vest === 'string' ? o.vest : 'hull', { b: 0.02 }));
    if (o.vest !== false || o.patch) p.push(box(-0.17, -0.12, -0.25, -0.215, 1.22, 1.34, 'mark', { b: 0.05 }));
    if (o.hair) p.push(box(-0.11, 0.08, -0.1, 0.1, 1.6, 1.69, o.hair, { tx0: -0.09, tx1: 0.05, ty0: -0.08, ty1: 0.08, b: 0.02 }));
    else if (!o.bare) p.push(cyl('z', [0.0, 0, 1.7], 0.16, 0.14, o.hat || 'cloth', 12, 0.09));
    if (o.glasses) p.push(box(0.1, 0.125, -0.09, 0.09, 1.56, 1.6, 'dark', { b: 0.05 }));
    if (o.rifle !== false) p.push(box(-0.18, 0.78, -0.035, 0.035, 1.2, 1.28, 'metal', { b: 0.08 }), box(0.25, 0.33, -0.03, 0.03, 1.04, 1.2, 'metal', { b: 0.07 }));
    return p;
  }
  const at = (parts, x, y, deg = 0) => turn(move(parts, [x, y, 0]), 'z', deg, [x, y, 0]);

  // Headgear of each age on a standing head whose crown is at 1.65 m, raised by dz and moved forward by dx: a
  // crested bronze helmet, a kettle hat, a tricorne, a brimmed steel helmet, a visored helmet, a hood, a cavalry
  // helm or a great helm. A crest or a plume is in the side's colour.
  function hat(k, dz = 0, dx = 0) {
    let p = [];
    if (k === 'crest') p = [cyl('z', [0.01, 0, 1.71], 0.15, 0.17, 'ore', 12, 0.08), box(-0.17, 0.12, -0.025, 0.025, 1.76, 1.92, 'mark', { tx0: -0.12, tx1: 0.06, b: 0.05 })];
    else if (k === 'kettle') p = [cyl('z', [0.01, 0, 1.665], 0.26, 0.03, 'metal', 16), cyl('z', [0.01, 0, 1.73], 0.13, 0.12, 'metal', 12, 0.06)];
    else if (k === 'tricorne') p = [pz([[0.25, 0], [-0.16, 0.23], [-0.16, -0.23]], 1.655, 1.72, 'dark'), cyl('z', [-0.01, 0, 1.76], 0.11, 0.09, 'dark', 10, 0.09)];
    else if (k === 'brodie') p = [cyl('z', [0.01, 0, 1.665], 0.21, 0.025, 'hull', 14), cyl('z', [0.01, 0, 1.71], 0.13, 0.08, 'hull', 12, 0.07)];
    else if (k === 'visor') p = [cyl('z', [0.01, 0, 1.6], 0.15, 0.38, 'metal', 12, 0.11), box(0.1, 0.17, -0.1, 0.1, 1.54, 1.62, 'glow', { b: 0.05 })];
    else if (k === 'hood') p = [cyl('z', [0.0, 0, 1.6], 0.16, 0.36, 'dark', 12, 0.07), box(0.11, 0.17, -0.08, 0.08, 1.55, 1.6, 'glow', { b: 0.05 })];
    else if (k === 'helm') p = [cyl('z', [0.01, 0, 1.69], 0.14, 0.18, 'metal', 12, 0.07), box(-0.2, 0.1, -0.03, 0.03, 1.74, 1.9, 'dark', { tx0: -0.14, tx1: 0.04, b: 0.05 })];
    else if (k === 'great') p = [cyl('z', [0.02, 0, 1.6], 0.135, 0.36, 'metal', 10), box(0.13, 0.165, -0.08, 0.08, 1.57, 1.6, 'dark', { b: 0.05 }), box(-0.08, 0.1, -0.03, 0.03, 1.78, 2.02, 'mark', { tx0: -0.12, tx1: 0.0, b: 0.05 })];
    return move(p, [dx, 0, dz]);
  }
  // What a soldier holds in the hands figure() puts forward at 1.2 m, the right at y -0.26 and the left at 0.17.
  function arms(k) {
    const p = [];
    if (k === 'spear') p.push(rod([0.34, -0.27, 0.1], [0.6, -0.27, 2.5], 0.03, 'wood'), rod([0.6, -0.27, 2.5], [0.64, -0.27, 2.82], 0.06, 'metal', 4, 0.004));
    else if (k === 'pike') p.push(rod([-0.9, -0.26, 0.85], [2.9, -0.26, 1.98], 0.03, 'wood'), rod([2.9, -0.26, 1.98], [3.16, -0.26, 2.05], 0.055, 'metal', 4, 0.004));
    else if (k === 'bow' || k === 'longbow') {
      // A bow in the left hand, its string, and a quiver of arrows on the back.
      const L = k === 'longbow' ? 1.85 : 1.3, pt = t => [0.47 - 0.2 * t * t, 0.17, 1.2 + t * L / 2], ts = [-1, -0.5, 0, 0.5, 1];
      for (let i = 0; i < 4; i++) p.push(rod(pt(ts[i]), pt(ts[i + 1]), 0.026, 'wood'));
      p.push(rod(pt(-1), pt(1), 0.007, 'dark'), rod([-0.2, -0.1, 0.95], [-0.32, 0.04, 1.6], 0.08, 'wood', 8));
      for (let i = 0; i < 3; i++) p.push(rod([-0.3 - i * 0.012, i * 0.03, 1.55], [-0.37 - i * 0.012, 0.03 + i * 0.03, 1.8], 0.014, 'polo'));
    } else if (k === 'xbow') {
      p.push(rod([-0.05, -0.12, 1.24], [0.72, -0.04, 1.27], 0.035, 'wood'), rod([0.7, -0.04, 1.28], [0.6, -0.42, 1.28], 0.02, 'metal'), rod([0.7, -0.04, 1.28], [0.6, 0.34, 1.28], 0.02, 'metal'));
      p.push(rod([0.6, -0.42, 1.28], [0.24, -0.07, 1.28], 0.005, 'dark'), rod([0.6, 0.34, 1.28], [0.24, -0.03, 1.28], 0.005, 'dark'));
    } else if (k === 'musket' || k === 'jaeger' || k === 'rifle' || k === 'scoped') {
      // A wooden stock and an iron barrel, a bayonet on a musket or a rifle, a sight on a marksman's.
      const n = { musket: 1.2, jaeger: 0.95, rifle: 1.0, scoped: 1.08 }[k];
      p.push(rod([-0.22, 0, 1.17], [0.42, 0, 1.25], 0.042, 'wood'), rod([0.38, 0, 1.265], [n, 0, 1.29], 0.022, 'metal', 6));
      if (k === 'musket' || k === 'rifle') p.push(rod([n, 0, 1.29], [n + (k === 'musket' ? 0.34 : 0.26), 0, 1.3], 0.013, 'metal', 4, 0.002));
      if (k === 'scoped') p.push(cyl('x', [0.3, 0, 1.36], 0.035, 0.4, 'dark', 8));
    } else if (k === 'grenade') {
      p.push(...ball([-0.21, -0.32, 2.0], 0.08, 'dark'), rod([-0.21, -0.32, 2.06], [-0.24, -0.32, 2.16], 0.012, 'polo'), box(-0.12, 0.1, -0.31, -0.21, 0.7, 0.94, 'cloth', { b: 0.04 }));
    } else if (k === 'atr') {
      p.push(rod([-0.25, 0, 1.14], [0.38, 0, 1.24], 0.05, 'wood'), rod([0.32, 0, 1.25], [1.55, 0, 1.29], 0.035, 'metal', 6), box(1.5, 1.68, -0.05, 0.05, 1.22, 1.34, 'metal'));
      p.push(rod([1.1, 0, 1.25], [1.25, -0.15, 0.92], 0.013, 'metal'), rod([1.1, 0, 1.25], [1.25, 0.15, 0.92], 0.013, 'metal'));
    } else if (k === 'pulse' || k === 'plasma' || k === 'rail') {
      // The future's guns: a dark body with a strip of light along it.
      const [x0, x1, w, h] = { pulse: [-0.12, 0.66, 0.065, 0.09], plasma: [-0.22, 0.8, 0.095, 0.13], rail: [-0.22, 1.2, 0.045, 0.06] }[k];
      p.push(box(x0, x1, -w, w, 1.22 - h, 1.22 + h, 'dark'), box(x0 + 0.2, x1 - 0.06, -w - 0.014, -w, 1.19, 1.25, 'glow', { b: 0.03 }));
      if (k === 'plasma') p.push(cyl('x', [x1 + 0.05, 0, 1.22], 0.1, 0.1, 'glow', 10, 0.07));
      if (k === 'rail') p.push(cyl('x', [0.3, 0, 1.31], 0.03, 0.34, 'dark', 8));
    }
    return p;
  }
  // A soldier of any age: figure() in its age's headgear and arms, with a shield, cross belts or shoulder plates.
  function soldier(o = {}) {
    const p = figure(Object.assign({ pack: false }, o, { rifle: false, bare: !o.hair }));
    p.push(...hat(o.hat), ...arms(o.arms));
    if (o.shield) p.push(cyl('x', [0.44, 0.2, 1.08], 0.38, 0.07, 'wood', 16, 0.38, { b: 0.08 }), cyl('x', [0.5, 0.2, 1.08], 0.1, 0.06, 'ore', 10, 0.05, { b: 0.1 }));
    if (o.belts) p.push(rod([0.15, -0.2, 1.38], [0.15, 0.2, 0.96], 0.022, 'polo', 4, 0.022, { b: 0.04 }), rod([0.15, 0.2, 1.38], [0.15, -0.2, 0.96], 0.022, 'polo', 4, 0.022, { b: 0.04 }));
    if (o.plates) p.push(box(-0.14, 0.12, -0.34, -0.18, 1.3, 1.46, 'metal', { b: 0.07 }), box(-0.14, 0.12, 0.18, 0.34, 1.3, 1.46, 'metal'));
    return p;
  }
  // A soldier from the waist up, as one stands in a chariot or a howdah.
  const upper = o => soldier(o).slice(4);
  // A squad of n of one soldier, the first ahead, as the rifle squad stands.
  const SPOTS = [[0, 0, 0, 0.04], [-1.3, 1.05, 8, -0.04], [-1.0, -1.25, -10, 0.06]];
  const squad = (n, o) => (n === 2 ? [SPOTS[0], SPOTS[2]] : SPOTS.slice(0, n)).flatMap(([x, y, d, st]) => at(grp(soldier(Object.assign({}, o, { stride: st }))), x, y, d));

  // A horse facing x with its back at 1.5 m, in o.coat, with a saddle cloth of the side's colour or a caparison.
  function horse(o = {}) {
    const c = o.coat || 'hide', st = o.stride ?? 0.12, p = [];
    for (const [x, s, k] of [[0.5, 1, 1], [0.5, -1, -1], [-0.52, 1, -1], [-0.52, -1, 1]]) {
      const fx = x + k * st;
      p.push(rod([x, s * 0.17, 0.98], [fx, s * 0.17, 0.1], 0.07, c, 4, 0.05, { b: -0.05 }), box(fx - 0.07, fx + 0.08, s * 0.17 - 0.06, s * 0.17 + 0.06, 0, 0.12, 'dark', { b: -0.04 }));
    }
    p.push(cyl('x', [0, 0, 1.22], 0.31, 1.2, c, 10), cyl('x', [0.7, 0, 1.24], 0.31, 0.2, c, 10, 0.22), cyl('x', [-0.7, 0, 1.24], 0.24, 0.2, c, 10, 0.31));
    p.push(loft(ringX(0.52, -0.12, 0.12, 1.25, 1.62), ringX(0.98, -0.08, 0.08, 1.82, 2.04), c));
    p.push(loft(ringX(0.86, -0.1, 0.1, 1.84, 2.12), ringX(1.36, -0.07, 0.07, 1.6, 1.78), c, { b: 0.02 }));
    p.push(box(0.86, 0.94, -0.08, -0.03, 2.1, 2.24, c), box(0.86, 0.94, 0.03, 0.08, 2.1, 2.24, c));
    p.push(loft(ringX(0.44, -0.035, 0.035, 1.56, 1.7), ringX(0.92, -0.035, 0.035, 2.02, 2.16), 'dark', { b: 0.03 }));
    p.push(rod([-0.78, 0, 1.42], [-1.0, 0, 0.72], 0.07, 'dark', 4, 0.03));
    if (o.caparison) p.push(box(-0.74, 0.64, -0.355, 0.355, 0.86, 1.57, o.caparison, { b: 0.04 }), box(-0.3, 0.2, -0.37, -0.355, 1.0, 1.42, 'mark', { b: 0.06 }));
    else if (o.cloth !== false) p.push(box(-0.32, 0.16, -0.345, 0.345, 1.0, 1.56, 'mark', { b: 0.04 }));
    if (o.saddle !== false) p.push(box(-0.24, 0.12, -0.17, 0.17, 1.53, 1.66, 'wood', { b: 0.05 }));
    return p;
  }
  // A rider astride a horse: legs down its flanks, a body, a head in its age's headgear, and its arms.
  function rider(o = {}) {
    const c = o.cloth || 'cloth', lg = o.legs || c, p = [];
    for (const s of [1, -1]) p.push(rod([-0.06, s * 0.16, 1.66], [0.26, s * 0.33, 1.34], 0.075, lg), rod([0.26, s * 0.33, 1.34], [0.12, s * 0.34, 0.98], 0.06, lg), box(0.06, 0.3, s * 0.34 - 0.06, s * 0.34 + 0.06, 0.92, 1.0, 'dark', { b: 0.02 }));
    p.push(box(-0.17, 0.12, -0.21, 0.21, 1.62, 2.2, c, { tx1: 0.09 }));
    if (o.vest) p.push(box(-0.19, 0.14, -0.225, 0.225, 1.74, 2.14, o.vest, { b: 0.02 }));
    p.push(cyl('z', [0.0, 0, 2.31], 0.1, 0.2, 'skin', 10), ...hat(o.hat, 0.76, -0.02));
    p.push(rod([-0.02, -0.25, 2.1], [0.3, -0.3, 1.86], 0.055, c, 4, 0.05, { b: 0.04 }), rod([-0.02, 0.25, 2.1], [0.36, 0.2, 1.8], 0.055, c));
    const k = o.arms;
    if (k === 'lance') p.push(rod([-0.9, -0.33, 1.7], [2.6, -0.33, 2.02], 0.035, 'wood', 4, 0.03, { b: 0.06 }), rod([2.6, -0.33, 2.02], [2.86, -0.33, 2.05], 0.05, 'metal', 4, 0.004), py([[2.0, 1.96], [2.45, 2.02], [2.0, 2.22]], -0.35, -0.31, 'mark', { b: 0.07 }));
    else if (k === 'sabre') p.push(rod([0.3, -0.31, 1.86], [0.56, -0.36, 2.74], 0.022, 'metal', 4, 0.007, { b: 0.06 }));
    else if (k === 'bow') {
      const L = 1.1, pt = t => [0.48 - 0.16 * t * t, 0.21, 1.86 + t * L / 2], ts = [-1, -0.5, 0, 0.5, 1];
      for (let i = 0; i < 4; i++) p.push(rod(pt(ts[i]), pt(ts[i + 1]), 0.024, 'wood'));
      p.push(rod(pt(-1), pt(1), 0.006, 'dark'));
    } else if (k === 'carbine') p.push(rod([-0.1, -0.12, 1.95], [0.4, -0.1, 1.98], 0.035, 'wood', 4, 0.035, { b: 0.06 }), rod([0.36, -0.1, 1.99], [0.86, -0.1, 2.0], 0.018, 'metal', 6, 0.018, { b: 0.06 }));
    return p;
  }
  // Three riders in a wedge, the leader ahead, each on his own horse.
  const troop = (h, r) => [[0.95, 0, 0, 0.12], [-1.15, 1.05, 4, -0.1], [-1.15, -1.05, -4, 0.04]].flatMap(([x, y, d, st]) => at(grp([...horse(Object.assign({ stride: st }, h)), ...rider(r)]), x, y, d));
  // The first motor lorries: solid tyres, a long chassis, a bonnet, a cab with a roof on posts, and the side's
  // colour on its door.
  function chassis(cab = 'hull') {
    const p = [
      ...wheels([1.5, -1.25], 0.95, 0.5, 0.22),
      box(-2.25, 2.3, -0.7, 0.7, 0.55, 0.78, 'dark'),
      box(1.4, 2.35, -0.62, 0.62, 0.78, 1.42, cab, { tx1: 2.25 }), box(2.33, 2.4, -0.55, 0.55, 0.82, 1.35, 'metal'),
      box(0.45, 1.42, -0.85, 0.85, 0.78, 1.2, cab), box(0.4, 1.48, -0.88, 0.88, 2.05, 2.13, cab),
      box(1.4, 1.44, -0.72, 0.72, 1.42, 2.0, 'glass', { b: 0.05 }),
      box(0.62, 1.22, -0.87, -0.85, 0.84, 1.14, 'mark', { b: 0.05 }),
      box(1.1, 1.9, -1.1, -0.82, 1.0, 1.06, cab, { b: 0.1 }), box(1.1, 1.9, 0.82, 1.1, 1.0, 1.06, cab),
    ];
    for (const x of [0.45, 1.42]) for (const s of [1, -1]) p.push(rod([x, s * 0.84, 1.2], [x, s * 0.84, 2.05], 0.03, 'metal'));
    return p;
  }

  // ---- The units ----------------------------------------------------------------------------------------------
  // Metres, with x forward, y to the unit's left and z up, standing on the ground at the origin. alt lifts an
  // aircraft so its shadow falls clear.
  const UNITS = {
    rifle: { name: 'Rifle Squad', spec: 'Foot · Tech I · $120', ruler: 2, build: () => [...figure(), ...at(figure({ stride: -0.04 }), -1.3, 1.05, 8), ...at(figure({ stride: 0.06 }), -1.0, -1.25, -10)] },
    rocket: { name: 'Rocket Team', spec: 'Foot · Tech I · $220', ruler: 2, build() {
      // A launcher tube on the shoulder of the first, a loader with a spare round beside him.
      const gunner = [...figure({ rifle: false }), cyl('x', [0.12, -0.24, 1.5], 0.08, 1.35, 'hull', 12), cyl('x', [0.82, -0.24, 1.5], 0.12, 0.28, 'metal', 12, 0.05), box(0.08, 0.2, -0.27, -0.21, 1.3, 1.44, 'metal')];
      const loader = [...figure({ stride: -0.05 }), cyl('x', [-0.3, 0.29, 1.15], 0.07, 0.9, 'mark', 10)];
      return [...gunner, ...at(loader, -1.2, 0.9, 12)];
    } },
    engineer: { name: 'Engineer', spec: 'Foot · Tech I · $300', ruler: 1, build() {
      return [...figure({ rifle: false, vest: false, hat: 'ore', cloth: 'cloth' }), box(0.15, 0.55, 0.22, 0.42, 0.55, 0.85, 'mark', { b: 0.1 }), box(0.3, 0.4, 0.26, 0.38, 0.85, 1.0, 'metal', { b: 0.1 }), box(0.3, 0.75, -0.3, -0.25, 1.15, 1.2, 'metal', { b: 0.1 })];
    } },
    sniper: { name: 'Sniper', spec: 'Foot · Tech II · $450', ruler: 1, build() {
      // Lying prone behind a long rifle on its bipod.
      return [
        box(-1.75, -0.95, -0.22, -0.04, 0, 0.18, 'cloth'), box(-1.75, -0.95, 0.04, 0.22, 0, 0.18, 'cloth'),
        box(-1.8, -1.68, -0.22, 0.22, 0, 0.22, 'dark', { b: 0.02 }),
        box(-0.98, -0.05, -0.25, 0.25, 0, 0.3, 'cloth', { tx1: -0.1 }),
        box(-0.85, -0.25, -0.2, 0.2, 0.28, 0.4, 'hull'),
        cyl('x', [0.08, 0, 0.3], 0.11, 0.24, 'skin', 10), cyl('x', [0.05, 0, 0.42], 0.15, 0.22, 'cloth', 12, 0.1),
        box(-0.25, 0.25, -0.38, -0.26, 0.15, 0.28, 'cloth', { b: 0.04 }), box(-0.25, 0.3, 0.26, 0.38, 0.15, 0.28, 'cloth'),
        box(0.05, 0.6, -0.04, 0.04, 0.24, 0.34, 'metal', { b: 0.06 }), cyl('x', [1.1, 0, 0.3], 0.025, 1.1, 'metal', 8),
        cyl('x', [0.35, 0, 0.42], 0.045, 0.42, 'dark', 10),
        box(1.12, 1.16, -0.12, -0.1, 0, 0.3, 'metal'), box(1.12, 1.16, 0.1, 0.12, 0, 0.3, 'metal'),
      ];
    } },
    hero: { name: 'Lightning', spec: 'Foot · Tech II · $1,200', ruler: 1, build() {
      // The hero: short dark hair, dark glasses, a cream polo and jeans, a short rifle.
      return [...figure({ cloth: 'polo', legs: 'denim', hair: 'dark', glasses: true, vest: false, pack: false, stride: 0.1 })];
    } },
    humvee: { name: 'Scout Car', spec: 'Wheeled · Tech I · $260', ruler: 2, build() {
      return [
        ...wheels([1.55, -1.55], 0.98, 0.46, 0.34),
        box(-2.25, 2.25, -1.05, 1.05, 0.5, 1.08, 'hull'),
        box(0.75, 2.3, -1.05, 1.05, 1.08, 1.3, 'hull', { tx1: 2.05 }),
        box(-1.55, 0.8, -1.0, 1.0, 1.08, 1.88, 'hull', { tx1: 0.3 }),
        box(-2.3, -1.55, -1.05, 1.05, 1.08, 1.36, 'hull'),
        box(-1.3, 0.12, -1.02, -1.0, 1.34, 1.72, 'glass', { b: 0.05 }),
        py([[0.82, 1.16], [0.88, 1.16], [0.38, 1.8], [0.32, 1.8]], -0.85, 0.85, 'glass', { b: 0.05 }),
        box(-1.25, -0.25, -1.07, -1.05, 0.6, 1.02, 'mark', { b: 0.05 }),
        cyl('z', [-0.5, 0, 1.98], 0.48, 0.2, 'hull', 18),
        box(-0.28, -0.12, -0.42, 0.42, 2.08, 2.5, 'hull', { b: 0.1 }),
        box(-0.5, 0.05, -0.09, 0.09, 2.22, 2.38, 'metal', { b: 0.12 }), cyl('x', [0.5, 0, 2.3], 0.05, 1.1, 'metal', 8, 0.05, { b: 0.12 }),
        cyl('z', [-2.0, -0.85, 2.4], 0.025, 2.1, 'metal', 6),
        box(2.25, 2.33, -0.9, 0.9, 0.62, 1.0, 'metal'),
      ];
    } },
    ifv: { name: 'Stryker IFV', spec: 'Wheeled · Tech I · $420', ruler: 2, build() {
      return [
        ...wheels([2.45, 1.25, -1.3, -2.5], 1.2, 0.55, 0.36),
        py([[-3.45, 0.55], [2.9, 0.55], [3.55, 1.25], [3.2, 2.25], [-3.45, 2.25]], -1.38, 1.38, 'hull'),
        box(-3.3, -2.6, 0.55, 1.25, 2.25, 2.5, 'metal'),
        box(-2.6, -1.3, -1.4, -1.38, 1.25, 2.0, 'mark', { b: 0.05 }),
        pz(oct(0.4, 0.35, 0.58, 0).map(p => [p[0], p[1]]), 2.25, 2.68, 'hull'),
        cyl('x', [1.95, 0.35, 2.48], 0.08, 2.6, 'metal', 8),
        cyl('z', [-1.0, -0.55, 2.31], 0.3, 0.13, 'hull', 14),
        cyl('z', [-2.9, 0.9, 2.9], 0.025, 1.6, 'metal', 6),
      ];
    } },
    truck: { name: 'Ore Truck', spec: 'Wheeled · Tech I · $700', ruler: 2, build() {
      const ore = [], r = rng(7);
      for (let i = 0; i < 9; i++) {
        const x = -2.9 + r() * 3.9, y = (r() - 0.5) * 1.9, s = 0.28 + r() * 0.22;
        ore.push(...turn(turn([box(x - s, x + s, y - s, y + s, 2.2, 2.2 + s * 1.3, 'ore', { tx0: x - s * 0.5, tx1: x + s * 0.6, ty0: y - s * 0.4, ty1: y + s * 0.7 })], 'z', r() * 90, [x, y, 2.4]), 'x', (r() - 0.5) * 20, [x, y, 2.4]));
      }
      return [
        ...wheels([2.45, -1.0, -2.3], 1.1, 0.55, 0.42),
        box(-3.4, 3.35, -0.95, 0.95, 0.65, 1.05, 'metal'),
        box(1.65, 3.45, -1.25, 1.25, 1.05, 2.75, 'hull', { tx1: 3.2 }),
        py([[3.36, 1.75], [3.42, 1.75], [3.24, 2.6], [3.18, 2.6]], -1.05, 1.05, 'glass', { b: 0.05 }),
        box(2.2, 3.0, -1.27, -1.25, 1.9, 2.5, 'glass', { b: 0.05 }),
        box(1.85, 2.95, -1.27, -1.25, 1.15, 1.75, 'mark', { b: 0.05 }),
        box(3.38, 3.58, -1.25, 1.25, 0.7, 0.95, 'ore'),
        ...ore,
        loft(rect(-3.25, 1.35, -0.95, 0.95, 1.1), rect(-3.5, 1.55, -1.32, 1.32, 2.55), 'hull', { b: -0.3, top: 'dark' }),
      ];
    } },
    tank: { name: 'Battle Tank', spec: 'Tracked · Tech II · $700', ruler: 2, build() {
      const tp = [[1.7, 0], [1.2, 1.55], [-1.9, 1.65], [-2.3, 1.2], [-2.3, -1.2], [-1.9, -1.65], [1.2, -1.55]];
      const ring = (k, z) => tp.map(([x, y]) => [-0.35 + (x + 0.35) * k, y * k, z]);
      return [
        py(track(-3.95, 3.95, 0, 0.95), 1.15, 1.85, 'dark', { b: -3 }), py(track(-3.95, 3.95, 0, 0.95), -1.85, -1.15, 'dark', { b: -3 }),
        box(-3.75, 3.5, -1.15, 1.15, 0.35, 0.95, 'hull', { b: -2 }),
        box(-3.85, 3.95, -1.88, 1.88, 0.95, 1.42, 'hull', { tx0: -3.75, tx1: 2.5 }),
        box(-3.4, 3.6, -1.92, -1.86, 0.48, 0.98, 'hull', { b: 0.2 }), box(-3.4, 3.6, 1.86, 1.92, 0.48, 0.98, 'hull'),
        box(2.0, 3.3, -1.94, -1.92, 0.58, 0.92, 'mark', { b: 0.3 }),
        loft(ring(1, 1.42), ring(0.9, 2.2), 'hull'),
        box(1.3, 1.85, -0.42, 0.42, 1.55, 2.05, 'hull', { b: 0.1 }),
        cyl('x', [3.9, 0, 1.8], 0.13, 4.2, 'metal', 12), cyl('x', [3.55, 0, 1.8], 0.2, 0.7, 'metal', 12, 0.2, { b: 0.05 }),
        box(-2.85, -2.2, -1.3, 1.3, 1.55, 2.08, 'mark', { b: -0.2 }),
        cyl('z', [-0.9, -0.65, 2.33], 0.36, 0.26, 'hull', 16),
        box(-1.05, -0.55, 0.35, 0.95, 2.18, 2.3, 'hull'),
        box(-0.3, 0.1, 0.6, 0.72, 2.3, 2.55, 'metal'), cyl('x', [0.35, 0.66, 2.5], 0.03, 0.7, 'metal', 6),
      ];
    } },
    flak: { name: 'Flak Track', spec: 'Tracked · Tech II · $520', ruler: 2, build() {
      const guns = s => turn([cyl('x', [1.1, s * 0.78, 0], 0.08, 2.4, 'metal', 10), cyl('x', [-0.05, s * 0.78, 0], 0.18, 0.6, 'metal', 12), box(-0.5, 0.25, s * 0.62, s * 0.95, -0.22, 0.22, 'hull')], 'y', -38, [0, 0, 0]);
      return [
        py(track(-3.0, 3.0, 0, 0.85), 0.95, 1.5, 'dark', { b: -3 }), py(track(-3.0, 3.0, 0, 0.85), -1.5, -0.95, 'dark', { b: -3 }),
        box(-2.9, 2.9, -0.95, 0.95, 0.35, 0.85, 'hull', { b: -2 }),
        box(-3.05, 3.15, -1.55, 1.55, 0.85, 1.35, 'hull', { tx1: 2.4 }),
        box(-2.2, -0.9, -1.57, -1.55, 0.9, 1.3, 'mark', { b: 0.1 }),
        loft(oct(-0.5, 0, 1.12, 1.35), oct(-0.5, 0, 0.96, 1.95), 'hull'),
        ...move(guns(1), [-0.25, 0, 1.8]), ...move(guns(-1), [-0.25, 0, 1.8]),
        box(-1.72, -1.58, -0.7, 0.7, 2.05, 2.85, 'metal', { b: 0.1 }), cyl('z', [-1.55, 0, 2.0], 0.06, 0.25, 'metal', 6),
      ];
    } },
    support: { name: 'Support Truck', spec: 'Wheeled · Tech II · $400', ruler: 2, build() {
      // A workshop body with its side panel, and a small crane folded over the back.
      const crane = turn([box(-0.15, 2.6, -0.12, 0.12, 0, 0.24, 'ore'), box(2.45, 2.6, -0.06, 0.06, -0.7, 0, 'metal')], 'y', -14, [0, 0, 0]);
      return [
        ...wheels([2.1, -1.4], 1.05, 0.52, 0.4),
        box(-3.0, 3.0, -0.9, 0.9, 0.6, 1.0, 'metal'),
        box(1.45, 3.1, -1.2, 1.2, 1.0, 2.5, 'hull', { tx1: 2.85 }),
        py([[3.02, 1.6], [3.08, 1.6], [2.92, 2.35], [2.86, 2.35]], -1.0, 1.0, 'glass', { b: 0.05 }),
        box(1.9, 2.6, -1.22, -1.2, 1.7, 2.2, 'glass', { b: 0.05 }),
        box(-3.1, 1.3, -1.25, 1.25, 1.0, 2.6, 'hull'),
        box(-2.6, 0.6, -1.27, -1.25, 1.25, 2.3, 'mark', { b: 0.05 }),
        box(-2.0, -1.1, -1.29, -1.27, 1.5, 2.05, 'hull', { b: 0.1 }), box(-1.7, -1.4, -1.3, -1.28, 1.6, 1.95, 'ore', { b: 0.12 }),
        cyl('z', [-2.6, 0.5, 2.75], 0.22, 0.3, 'metal', 12),
        ...move(crane, [-2.6, 0.5, 2.9]),
      ];
    } },
    mlrs: { name: 'Rocket Artillery', spec: 'Wheeled · Tech III · $850', ruler: 2, build() {
      const tubes = [];
      for (const y of [-0.75, 0, 0.75]) for (const z of [1.78, 2.28]) tubes.push(cyl('x', [0.96, y, z], 0.18, 0.14, 'dark', 12));
      const pod = [box(-3.1, 0.9, -1.2, 1.2, 1.52, 2.56, 'hull'), ...tubes, box(-2.4, -0.6, -1.22, -1.2, 1.68, 2.4, 'mark', { b: 0.05 })];
      return [
        ...wheels([2.4, -0.9, -2.2], 1.08, 0.55, 0.42),
        box(-3.3, 3.35, -0.95, 0.95, 0.65, 1.1, 'metal'),
        box(1.4, 3.4, -1.25, 1.25, 1.05, 2.6, 'hull', { tx1: 3.05, tx0: 1.5 }),
        py([[3.3, 1.65], [3.36, 1.65], [3.11, 2.45], [3.05, 2.45]], -1.05, 1.05, 'glass', { b: 0.05 }),
        box(2.0, 2.9, -1.27, -1.25, 1.8, 2.35, 'glass', { b: 0.05 }),
        box(-3.0, 0.9, -1.15, 1.15, 1.1, 1.5, 'metal'),
        ...turn(pod, 'y', -16, [-3.0, 0, 1.5]),
      ];
    } },
    heavy: { name: 'Goliath', spec: 'Tracked · Tech III · $1,500', ruler: 5, build() {
      const tp = [[2.2, 0], [1.6, 2.0], [-2.4, 2.1], [-2.9, 1.5], [-2.9, -1.5], [-2.4, -2.1], [1.6, -2.0]];
      const ring = (k, z) => tp.map(([x, y]) => [-0.6 + (x + 0.6) * k, y * k, z]);
      return [
        py(track(-4.8, 4.8, 0, 1.2), 1.45, 2.45, 'dark', { b: -3 }), py(track(-4.8, 4.8, 0, 1.2), -2.45, -1.45, 'dark', { b: -3 }),
        box(-4.6, 4.4, -1.45, 1.45, 0.45, 1.2, 'hull', { b: -2 }),
        box(-4.7, 4.9, -2.5, 2.5, 1.15, 1.85, 'hull', { tx0: -4.6, tx1: 3.3 }),
        box(-4.2, 4.4, -2.57, -2.49, 0.55, 1.2, 'hull', { b: 0.2 }), box(-4.2, 4.4, 2.49, 2.57, 0.55, 1.2, 'hull'),
        ...[-3.4, -1.9, -0.4, 1.1, 2.6].map(x => box(x, x + 1.2, -2.6, -2.57, 0.65, 1.1, 'hull', { b: 0.3 })),
        loft(ring(1, 1.85), ring(0.9, 2.85), 'hull'),
        box(1.4, 2.1, -1.0, 1.0, 2.0, 2.7, 'hull', { b: 0.1 }),
        cyl('x', [4.4, 0.45, 2.35], 0.16, 5.2, 'metal', 12), cyl('x', [4.4, -0.45, 2.35], 0.16, 5.2, 'metal', 12),
        box(-3.7, -2.95, -1.6, 1.6, 2.0, 2.72, 'mark', { b: -0.2 }),
        cyl('z', [-1.3, -0.95, 3.0], 0.45, 0.3, 'hull', 16),
        cyl('x', [-0.6, -0.95, 3.2], 0.05, 1.2, 'metal', 8),
      ];
    } },
    fpv: { name: 'FPV Drone', spec: 'Air · Tech II · $150', ruler: 1, alt: 0.9, build() {
      // Four arms on a small body, a rotor ring at each tip and a charge slung under it.
      const arms = [45, 135, 225, 315].flatMap(a => turn([box(0.05, 0.42, -0.025, 0.025, 0.1, 0.14, 'metal'), cyl('z', [0.42, 0, 0.17], 0.025, 0.06, 'metal', 8), cyl('z', [0.42, 0, 0.21], 0.22, 0.015, 'hull', 20)], 'z', a, [0, 0, 0]));
      return [box(-0.16, 0.16, -0.09, 0.09, 0.06, 0.2, 'hull'), box(0.08, 0.15, -0.035, 0.035, 0.17, 0.24, 'dark', { b: 0.02 }), box(-0.12, 0.12, -0.06, 0.06, 0.2, 0.24, 'mark', { b: 0.01 }), cyl('x', [0, 0, 0.0], 0.06, 0.32, 'ore', 12), ...arms];
    } },
    heli: { name: 'Attack Helicopter', spec: 'Air · Tech II · $1,100', ruler: 2, alt: 2.4, build() {
      const blades = [0, 90, 180, 270].map(a => turn([box(0.25, 7.2, -0.22, 0.22, 2.84, 2.88, 'metal')], 'z', 28 + a, [-0.2, 0, 0])[0]);
      return [
        loft(ringX(0.6, -0.62, 0.62, 0.8, 2.05), ringX(3.1, -0.3, 0.3, 0.88, 1.5), 'hull'),
        box(0.5, 2.4, -0.5, 0.5, 1.72, 2.32, 'glass', { tx0: 0.8, tx1: 1.9, ty0: -0.38, ty1: 0.38, b: 0.1 }),
        box(-1.7, 0.6, -0.72, 0.72, 0.75, 2.15, 'hull'),
        cyl('x', [-0.9, 0.98, 1.95], 0.36, 1.8, 'hull', 14), cyl('x', [-0.9, -0.98, 1.95], 0.36, 1.8, 'hull', 14),
        loft(ringX(-1.7, -0.38, 0.38, 1.35, 2.05), ringX(-6.4, -0.15, 0.15, 1.75, 2.05), 'hull', { b: -0.2 }),
        loft(ringX(-3.4, -0.32, 0.32, 1.47, 2.08), ringX(-4.0, -0.29, 0.29, 1.53, 2.08), 'mark', { b: -0.1 }),
        py([[-5.7, 1.9], [-6.5, 1.9], [-6.9, 3.3], [-6.45, 3.3]], -0.06, 0.06, 'hull', { b: -0.1 }),
        box(-6.6, -6.0, -1.0, 1.0, 2.0, 2.07, 'hull'),
        box(-0.75, 0.15, -2.0, 2.0, 1.45, 1.56, 'hull', { b: 0.1 }),
        cyl('x', [-0.25, 1.65, 1.22], 0.25, 1.3, 'metal', 12), cyl('x', [-0.25, -1.65, 1.22], 0.25, 1.3, 'metal', 12),
        box(-0.75, 0.3, 1.0, 1.15, 1.18, 1.45, 'metal'), box(-0.75, 0.3, -1.15, -1.0, 1.18, 1.45, 'metal'),
        cyl('z', [2.6, 0, 0.7], 0.16, 0.2, 'metal', 10), cyl('x', [3.15, 0, 0.62], 0.04, 1.0, 'metal', 6),
        cyl('y', [1.7, 0.95, 0.3], 0.3, 0.2, 'dark', 14), cyl('y', [1.7, -0.95, 0.3], 0.3, 0.2, 'dark', 14),
        box(1.62, 1.78, 0.4, 0.62, 0.3, 0.85, 'metal'), box(1.62, 1.78, -0.62, -0.4, 0.3, 0.85, 'metal'),
        cyl('y', [-6.1, 0, 1.25], 0.18, 0.12, 'dark', 10),
        cyl('z', [-0.2, 0, 2.45], 0.13, 0.6, 'metal', 10), cyl('z', [-0.2, 0, 2.78], 0.32, 0.14, 'metal', 14),
        ...blades,
      ];
    } },
    jet: { name: 'Strike Jet', spec: 'Air · Tech III · $1,500', ruler: 5, alt: 3.2, build() {
      const wing = [[1.4, 0.6], [-3.3, 4.8], [-4.3, 4.8], [-4.3, 0.6]], tail = [[-4.6, 0.6], [-6.0, 2.4], [-6.5, 2.4], [-6.4, 0.6]];
      return [
        cyl('x', [-1.4, 0, 1.2], 0.7, 8.0, 'hull', 12),
        cyl('x', [3.9, 0, 1.2], 0.7, 2.6, 'hull', 12, 0.03),
        cyl('x', [-5.8, 0, 1.2], 0.6, 0.8, 'metal', 12, 0.48),
        pz(wing, 1.0, 1.14, 'hull'), ...mirror([pz(wing, 1.0, 1.14, 'hull')]),
        pz(tail, 1.12, 1.2, 'hull'), ...mirror([pz(tail, 1.12, 1.2, 'hull')]),
        py([[-3.9, 1.8], [-5.9, 4.0], [-6.6, 4.0], [-6.4, 1.8]], -0.07, 0.07, 'hull'),
        py([[-5.2, 2.6], [-5.8, 3.3], [-6.25, 3.3], [-6.0, 2.6]], -0.1, -0.075, 'mark', { b: 0.05 }),
        box(1.0, 3.2, -0.38, 0.38, 1.72, 2.15, 'glass', { tx0: 1.5, tx1: 2.5, ty0: -0.22, ty1: 0.22, b: 0.1 }),
        box(-0.6, 1.2, -0.5, 0.5, 0.42, 0.72, 'metal', { tx1: 0.9 }),
        cyl('x', [-3.6, 4.85, 1.07], 0.08, 2.2, 'metal', 8), cyl('x', [-3.6, -4.85, 1.07], 0.08, 2.2, 'metal', 8),
      ];
    } },
  };

  // The other ages' forms, after their models. Foot of three figures for a squad of five, two for a team of three.
  const foot = (name, n, o, ruler = 2) => ({ name, ruler, build: () => n > 1 ? squad(n, o) : soldier(o) });
  Object.assign(UNITS, {
    spear: foot('Spearmen', 3, { cloth: 'cloth', vest: 'ore', hat: 'crest', arms: 'spear', shield: true }),
    pike: foot('Pikemen', 3, { cloth: 'cloth', vest: 'metal', hat: 'kettle', arms: 'pike' }),
    musket: foot('Musketeers', 3, { cloth: 'cloth', legs: 'polo', vest: false, patch: true, belts: true, hat: 'tricorne', arms: 'musket' }),
    rifleman: foot('Riflemen', 3, { cloth: 'hull', vest: 'cloth', pack: 'cloth', hat: 'brodie', arms: 'rifle' }),
    exo: foot('Exo Troopers', 3, { cloth: 'metal', legs: 'dark', vest: 'dark', pack: 'dark', plates: true, hat: 'visor', arms: 'pulse' }),
    archer: foot('Archers', 2, { cloth: 'polo', vest: false, patch: true, hat: 'crest', arms: 'bow' }),
    crossbow: foot('Crossbowmen', 2, { cloth: 'cloth', vest: 'metal', hat: 'kettle', arms: 'xbow' }),
    grenadier: foot('Grenadiers', 2, { cloth: 'denim', legs: 'polo', vest: false, patch: true, belts: true, hat: 'tricorne', arms: 'grenade', raise: true }),
    atrifle: foot('AT Riflemen', 2, { cloth: 'hull', vest: 'cloth', hat: 'brodie', arms: 'atr' }),
    lancer: foot('Plasma Lancers', 2, { cloth: 'metal', legs: 'dark', vest: 'dark', pack: 'dark', plates: true, hat: 'visor', arms: 'plasma' }),
    longbow: foot('Longbowmen', 2, { cloth: 'cloth', vest: false, patch: true, hair: 'dark', arms: 'longbow' }),
    jaeger: foot('Jägers', 1, { cloth: 'cloth', legs: 'dark', vest: false, patch: true, belts: true, hat: 'tricorne', arms: 'jaeger' }, 1),
    marksman: foot('Marksman', 1, { cloth: 'hull', vest: 'cloth', hat: 'brodie', arms: 'scoped' }, 1),
    ghost: foot('Ghost', 1, { cloth: 'dark', legs: 'dark', vest: 'cloth', hat: 'hood', arms: 'rail' }, 1),

    outrider: { name: 'Outriders', ruler: 2, build: () => troop({}, { cloth: 'cloth', hat: 'crest', arms: 'bow' }) },
    knight: { name: 'Knights', ruler: 2, build: () => troop({ caparison: 'polo' }, { cloth: 'metal', vest: 'polo', hat: 'great', arms: 'lance' }) },
    cuirassier: { name: 'Cuirassiers', ruler: 2, build: () => troop({}, { cloth: 'denim', legs: 'polo', vest: 'metal', hat: 'helm', arms: 'sabre' }) },
    dragoon: { name: 'Dragoons', ruler: 2, build: () => troop({}, { cloth: 'cloth', legs: 'polo', hat: 'tricorne', arms: 'carbine' }) },

    oxcart: { name: 'Ox Cart', ruler: 2, build() {
      // An ox under its yoke, before a two-wheeled cart of ore.
      const ox = [box(-0.35, 1.15, -0.34, 0.34, 0.68, 1.42, 'hide', { tx0: -0.3, ty0: -0.3, ty1: 0.3 })];
      for (const [x, s] of [[0.95, 1], [0.95, -1], [-0.15, 1], [-0.15, -1]]) ox.push(rod([x, s * 0.2, 0.75], [x + 0.03, s * 0.2, 0.08], 0.085, 'hide', 4, 0.065, { b: -0.05 }), box(x - 0.06, x + 0.12, s * 0.2 - 0.08, s * 0.2 + 0.08, 0, 0.1, 'dark'));
      ox.push(box(0.6, 1.1, -0.26, 0.26, 1.3, 1.6, 'hide', { tx0: 0.7, tx1: 1.0 }), loft(ringX(1.1, -0.17, 0.17, 0.85, 1.38), ringX(1.62, -0.13, 0.13, 0.72, 1.12), 'hide', { b: 0.02 }));
      ox.push(rod([1.25, -0.15, 1.3], [1.32, -0.46, 1.56], 0.035, 'polo', 4, 0.012), rod([1.25, 0.15, 1.3], [1.32, 0.46, 1.56], 0.035, 'polo', 4, 0.012), rod([-0.37, 0, 1.3], [-0.5, 0, 0.6], 0.03, 'dark'), box(0.92, 1.06, -0.5, 0.5, 1.4, 1.5, 'wood', { b: 0.05 }));
      const cart = [
        rod([1.0, 0.42, 1.42], [-0.5, 0.42, 0.8], 0.045, 'wood'), rod([1.0, -0.42, 1.42], [-0.5, -0.42, 0.8], 0.045, 'wood'),
        ...spoked(-1.45, 0.82, 0.62, 0.12), ...spoked(-1.45, -0.82, 0.62, 0.12),
        box(-2.4, -0.45, -0.68, 0.68, 0.72, 0.84, 'wood'),
        box(-2.4, -0.45, -0.72, -0.66, 0.84, 1.2, 'wood', { b: 0.05 }), box(-2.4, -0.45, 0.66, 0.72, 0.84, 1.2, 'wood'),
        box(-0.5, -0.44, -0.66, 0.66, 0.84, 1.2, 'wood'), box(-2.42, -2.36, -0.66, 0.66, 0.84, 1.2, 'wood'),
        ...lumps(-2.15, -0.75, -0.42, 0.42, 0.84, 6, 11, 0.22), ...flag(-2.38, -0.69, 1.2),
      ];
      return [...grp(ox), ...grp(cart)];
    } },
    wagon: { name: 'Ore Wagon', ruler: 2, build() {
      const team = [...at(grp(horse({ cloth: false, saddle: false })), 1.15, 0.42), ...at(grp(horse({ cloth: false, saddle: false, stride: -0.1 })), 1.15, -0.42)];
      const w = [
        ...[-0.35, -2.25].flatMap(x => [...spoked(x, 0.85, 0.5, 0.1), ...spoked(x, -0.85, 0.5, 0.1)]),
        rod([0.5, 0, 1.2], [-0.4, 0, 0.62], 0.05, 'wood'),
        box(-2.75, 0.15, -0.72, 0.72, 0.62, 0.74, 'wood'),
        box(-2.75, 0.15, -0.76, -0.7, 0.74, 1.22, 'wood', { b: 0.05 }), box(-2.75, 0.15, 0.7, 0.76, 0.74, 1.22, 'wood'),
        box(0.1, 0.16, -0.7, 0.7, 0.74, 1.22, 'wood'), box(-2.77, -2.71, -0.7, 0.7, 0.74, 1.22, 'wood'),
        ...lumps(-2.5, -0.15, -0.5, 0.5, 0.74, 8, 13, 0.24), ...flag(-2.72, -0.73, 1.22),
      ];
      return [...team, ...grp(w)];
    } },
    supcart: { name: 'Supply Cart', ruler: 2, build() {
      // A covered wagon with the side's cross on its canvas.
      const c = [
        ...spoked(-1.3, 0.85, 0.6, 0.1), ...spoked(-1.3, -0.85, 0.6, 0.1),
        rod([0.55, 0.4, 1.2], [-0.4, 0.4, 0.8], 0.04, 'wood'), rod([0.55, -0.4, 1.2], [-0.4, -0.4, 0.8], 0.04, 'wood'),
        box(-2.3, -0.35, -0.72, 0.72, 0.66, 1.0, 'wood'),
        box(-2.25, -0.4, -0.74, 0.74, 1.0, 1.5, 'polo'), arch(-2.25, -0.4, 0.74, 1.5, 'polo'),
        box(-1.4, -1.26, -0.77, -0.74, 1.04, 1.46, 'mark', { b: 0.06 }), box(-1.6, -1.06, -0.77, -0.74, 1.19, 1.31, 'mark', { b: 0.06 }),
      ];
      return [...at(grp(horse({ cloth: false, saddle: false })), 1.3, 0), ...grp(c)];
    } },
    chariot: { name: 'Chariots', ruler: 2, build() {
      // Two horses, a light car on two wheels, a driver and an archer.
      const team = [...at(grp(horse({ saddle: false })), 1.3, 0.42), ...at(grp(horse({ saddle: false, stride: -0.1 })), 1.3, -0.42)];
      const car = [
        ...spoked(-0.85, 0.84, 0.62, 0.08), ...spoked(-0.85, -0.84, 0.62, 0.08),
        rod([0.75, 0, 1.25], [-0.4, 0, 0.75], 0.05, 'wood'),
        pz([[-0.35, 0], [-0.58, 0.62], [-1.35, 0.62], [-1.35, -0.62], [-0.58, -0.62]], 0.66, 1.62, 'ore', { top: 'dark' }),
      ];
      const crew = [...at(grp(upper({ cloth: 'polo', vest: false, patch: true, hat: 'crest' })), -0.8, 0.26), ...at(grp(upper({ cloth: 'cloth', vest: false, patch: true, hat: 'crest', arms: 'bow' })), -1.05, -0.26)];
      return [...team, ...grp(car), ...move(crew, [0, 0, 0.72])];
    } },
    elephant: { name: 'War Elephants', ruler: 2, build() {
      // A great beast with tusks and a caparison bordered in the side's colour, a howdah of archers on its back.
      const p = [...[[0.95, 1], [0.95, -1], [-0.95, 1], [-0.95, -1]].map(([x, s]) => cyl('z', [x, s * 0.55, 0.75], 0.32, 1.5, 'hide', 10, 0.3, { b: -0.2 }))];
      p.push(cyl('x', [0, 0, 2.15], 0.95, 2.4, 'hide', 14), cyl('x', [-1.35, 0, 2.15], 0.7, 0.3, 'hide', 14, 0.95), rod([1.0, 0, 2.5], [1.92, 0, 2.15], 0.66, 'hide', 12, 0.42));
      p.push(cyl('y', [1.12, -0.72, 2.5], 0.5, 0.06, 'hide', 12, 0.5, { b: 0.1 }), cyl('y', [1.12, 0.72, 2.5], 0.5, 0.06, 'hide', 12));
      p.push(rod([1.95, 0, 2.2], [2.22, 0, 1.35], 0.24, 'hide', 8, 0.15, { b: 0.05 }), rod([2.22, 0, 1.35], [2.32, 0, 0.5], 0.15, 'hide', 8, 0.1, { b: 0.05 }));
      for (const s of [1, -1]) p.push(rod([1.85, s * 0.32, 1.95], [2.5, s * 0.4, 1.5], 0.08, 'polo', 6, 0.04, { b: 0.08 }), rod([2.5, s * 0.4, 1.5], [2.72, s * 0.42, 1.74], 0.04, 'polo', 6, 0.01, { b: 0.08 }));
      p.push(rod([-1.5, 0, 2.4], [-1.65, 0, 1.3], 0.04, 'dark'));
      p.push(box(-0.66, 0.62, -0.99, 0.99, 2.3, 3.12, 'polo', { b: 0.08 }), box(-0.68, 0.64, -1.0, 1.0, 2.1, 2.32, 'mark', { b: 0.08 }));
      p.push(box(-0.75, 0.6, -0.72, 0.72, 3.12, 3.6, 'wood', { top: 'dark' }));
      for (const [x, y] of [[0.55, 0.67], [0.55, -0.67], [-0.7, 0.67], [-0.7, -0.67]]) p.push(rod([x, y, 3.6], [x, y, 4.3], 0.035, 'wood'));
      p.push(box(-0.85, 0.7, -0.82, 0.82, 4.28, 4.38, 'polo'));
      // Two archers stand in the howdah, and the driver sits on the neck.
      const crew = [...at(upper({ cloth: 'cloth', vest: false, hair: 'dark', arms: 'bow' }), -0.15, -0.3), ...at(upper({ cloth: 'polo', vest: false, hair: 'dark' }), -0.35, 0.3)];
      return grp([...p, ...move(crew, [0, 0, 2.6]), ...move(at(upper({ cloth: 'polo', vest: false, hair: 'dark' }), 1.05, 0), [0, 0, 2.2])]);
    } },

    catapult: { name: 'Catapult', ruler: 2, build() {
      // A wheeled frame and a throwing arm cocked back, a stone in its cup.
      return [
        ...[1.0, -1.0].flatMap(x => [...spoked(x, 0.98, 0.42, 0.1), ...spoked(x, -0.98, 0.42, 0.1)]),
        box(-1.55, 1.45, -0.86, -0.7, 0.42, 0.6, 'wood'), box(-1.55, 1.45, 0.7, 0.86, 0.42, 0.6, 'wood'),
        box(-1.45, -1.25, -0.86, 0.86, 0.45, 0.6, 'wood'), box(1.15, 1.35, -0.86, 0.86, 0.45, 0.6, 'wood'),
        rod([0.2, -0.78, 0.6], [0.5, -0.74, 1.85], 0.07, 'wood'), rod([0.2, 0.78, 0.6], [0.5, 0.74, 1.85], 0.07, 'wood'),
        rod([0.95, -0.78, 0.6], [0.56, -0.74, 1.8], 0.055, 'wood'), rod([0.95, 0.78, 0.6], [0.56, 0.74, 1.8], 0.055, 'wood'),
        box(0.42, 0.62, -0.82, 0.82, 1.78, 1.95, 'wood'),
        cyl('y', [0.35, 0, 0.7], 0.2, 1.4, 'cloth', 10),
        rod([0.35, 0, 0.7], [-1.25, 0, 1.2], 0.075, 'wood'),
        cyl('z', [-1.3, 0, 1.28], 0.24, 0.16, 'wood', 10, 0.3, { top: 'dark' }), ...ball([-1.3, 0, 1.48], 0.2, 'metal'),
        ...flag(-1.5, -0.78, 0.6, 1.4),
      ];
    } },
    trebuchet: { name: 'Trebuchet', ruler: 5, build() {
      // A tall A-frame on a wheeled base, a long arm, a box of counterweight with the side's mark, and a sling.
      const p = [...[1.5, -1.5].flatMap(x => [...spoked(x, 1.05, 0.35, 0.1), ...spoked(x, -1.05, 0.35, 0.1)])];
      for (const s of [1, -1]) {
        p.push(box(-1.9, 1.9, s > 0 ? 0.75 : -0.95, s > 0 ? 0.95 : -0.75, 0.35, 0.58, 'wood'));
        p.push(rod([-1.15, s * 0.85, 0.58], [0, s * 0.82, 3.25], 0.07, 'wood'), rod([1.15, s * 0.85, 0.58], [0, s * 0.82, 3.25], 0.07, 'wood'));
      }
      p.push(box(-1.9, -1.7, -0.95, 0.95, 0.35, 0.58, 'wood'), box(1.7, 1.9, -0.95, 0.95, 0.35, 0.58, 'wood'), cyl('y', [0, 0, 3.2], 0.08, 1.9, 'metal', 8));
      p.push(rod([1.0, 0, 3.75], [-2.75, 0, 1.69], 0.09, 'wood'));
      p.push(box(0.6, 1.4, -0.5, 0.5, 2.5, 3.45, 'wood', { top: 'dark' }), box(0.75, 1.25, -0.52, -0.5, 2.7, 3.25, 'mark', { b: 0.05 }));
      p.push(rod([-2.75, 0, 1.69], [-2.45, 0, 0.8], 0.015, 'dark'), cyl('z', [-2.45, 0, 0.72], 0.16, 0.14, 'cloth', 8, 0.2), ...ball([-2.45, 0, 0.88], 0.14, 'metal'));
      return p;
    } },
    cannonart: { name: 'Cannon', ruler: 2, build() {
      // A black barrel on a two-wheeled carriage, its trail on the ground, round shot heaped by it.
      const barrel = turn([cyl('x', [0.35, 0, 0], 0.15, 2.1, 'dark', 12, 0.11), cyl('x', [1.42, 0, 0], 0.15, 0.1, 'dark', 12), cyl('x', [-0.72, 0, 0], 0.17, 0.12, 'dark', 12, 0.15), ...ball([-0.86, 0, 0], 0.1, 'dark')], 'y', -5, [0, 0, 0]);
      const plate = turn([box(-0.3, 0.3, -0.12, 0.12, 0, 0.025, 'mark', { b: 0.05 })], 'y', -13.3, [0, 0, 0]);
      return [
        ...spoked(0, 0.75, 0.68, 0.12), ...spoked(0, -0.75, 0.68, 0.12), cyl('y', [0, 0, 0.68], 0.06, 1.42, 'metal', 8),
        box(-0.55, 0.45, -0.28, 0.28, 0.58, 0.95, 'wood'), rod([-0.3, 0, 0.62], [-2.5, 0, 0.1], 0.2, 'wood'),
        ...move(barrel, [0, 0, 1.08]), ...move(plate, [-1.45, 0, 0.47]),
        ...ball([-1.1, -0.95, 0.12], 0.12, 'dark'), ...ball([-0.85, -1.0, 0.12], 0.12, 'dark'), ...ball([-0.98, -0.9, 0.3], 0.12, 'dark'),
      ];
    } },
    howitzer: { name: 'Howitzer', ruler: 2, build() {
      // A short heavy barrel raised behind a shield, on two wheels with its split trail spread.
      const gun = turn([cyl('x', [0.9, 0, 0], 0.11, 2.6, 'metal', 10, 0.09), cyl('x', [2.18, 0, 0], 0.13, 0.16, 'dark', 10), box(-0.6, 0.4, -0.2, 0.2, -0.22, 0.14, 'hull')], 'y', -28, [0, 0, 0]);
      const p = [...wheels([0], 0.85, 0.62, 0.2), box(-0.3, 0.3, -0.4, 0.4, 0.5, 0.85, 'hull')];
      for (const s of [1, -1]) p.push(rod([-0.2, s * 0.22, 0.6], [-2.7, s * 0.9, 0.12], 0.08, 'hull'), box(-2.85, -2.55, s * 0.9 - 0.15, s * 0.9 + 0.15, 0, 0.14, 'dark'));
      p.push(...move(gun, [0, 0, 1.05]), box(0.3, 0.36, -0.82, 0.82, 0.45, 1.5, 'hull', { tx0: 0.24, tx1: 0.3, b: 0.1 }), box(0.36, 0.38, -0.7, -0.18, 0.62, 1.05, 'mark', { tx0: 0.3, tx1: 0.32, b: 0.12 }));
      return p;
    } },

    lorry: { name: 'Steam Lorry', ruler: 2, build() {
      // A boiler and a tall chimney behind the cab, and a wooden bed of ore.
      return [
        ...chassis('cloth'), cyl('z', [-0.05, 0, 1.45], 0.4, 1.35, 'dark', 12), cyl('z', [-0.05, 0, 2.75], 0.1, 1.3, 'dark', 8), cyl('z', [-0.05, 0, 3.45], 0.17, 0.12, 'dark', 8, 0.12),
        loft(rect(-2.35, -0.55, -0.82, 0.82, 0.78), rect(-2.4, -0.5, -0.88, 0.88, 1.4), 'wood', { b: -0.3, top: 'dark' }),
        ...lumps(-2.2, -0.75, -0.55, 0.55, 1.25, 6, 17, 0.25),
      ];
    } },
    ambulance: { name: 'Field Ambulance', ruler: 2, build() {
      return [
        ...chassis('hull'), box(-2.45, 0.38, -0.88, 0.88, 0.78, 2.25, 'polo'),
        box(-1.33, -1.07, -0.9, -0.88, 1.05, 1.95, 'mark', { b: 0.05 }), box(-1.65, -0.75, -0.9, -0.88, 1.37, 1.63, 'mark', { b: 0.05 }),
      ];
    } },
    tradecart: { name: 'Trade Cart', ruler: 2, build() {
      // A horse before a cart of crates, a bale and a cask.
      const c = [
        ...spoked(-1.3, 0.85, 0.6, 0.1), ...spoked(-1.3, -0.85, 0.6, 0.1),
        rod([0.55, 0.4, 1.2], [-0.4, 0.4, 0.8], 0.04, 'wood'), rod([0.55, -0.4, 1.2], [-0.4, -0.4, 0.8], 0.04, 'wood'),
        box(-2.3, -0.35, -0.72, 0.72, 0.66, 1.0, 'wood'),
        box(-2.2, -1.5, -0.6, 0.05, 1.0, 1.55, 'wood'), box(-1.4, -0.6, 0.0, 0.62, 1.0, 1.45, 'wood'),
        cyl('y', [-1.2, 0, 1.85], 0.3, 1.3, 'cloth', 10), box(-0.6, -0.4, -0.66, -0.3, 1.0, 1.7, 'mark', { b: 0.04 }),
      ];
      return [...at(grp(horse({ cloth: false, saddle: false })), 1.3, 0), ...grp(c)];
    } },
    caravan: { name: 'Caravan', ruler: 2, build() {
      // Two horses before a long wagon of crates and bales.
      const team = [...at(grp(horse({ cloth: false, saddle: false })), 1.6, 0.42), ...at(grp(horse({ cloth: false, saddle: false, stride: -0.1 })), 1.6, -0.42)];
      const c = [
        ...spoked(-0.6, 0.85, 0.5, 0.1), ...spoked(-0.6, -0.85, 0.5, 0.1), ...spoked(-2.4, 0.85, 0.5, 0.1), ...spoked(-2.4, -0.85, 0.5, 0.1),
        box(-2.9, 0.1, -0.76, 0.76, 0.74, 1.05, 'wood'),
        box(-2.8, -2.0, -0.6, 0.05, 1.05, 1.6, 'wood'), box(-1.9, -1.1, 0.0, 0.62, 1.05, 1.5, 'wood'), box(-1.0, -0.2, -0.62, 0.0, 1.05, 1.45, 'wood'),
        cyl('y', [-0.5, 0.3, 1.75], 0.28, 0.6, 'cloth', 10), box(-2.95, -2.75, -0.7, -0.3, 0.9, 1.6, 'mark', { b: 0.04 }),
      ];
      return [...team, ...grp(c)];
    } },
    tradewagon: { name: 'Trade Wagon', ruler: 2, build() {
      // A covered wagon of goods with a cask lashed behind and the side's pennant.
      const c = [
        ...spoked(-1.3, 0.85, 0.6, 0.1), ...spoked(-1.3, -0.85, 0.6, 0.1),
        rod([0.55, 0.4, 1.2], [-0.4, 0.4, 0.8], 0.04, 'wood'), rod([0.55, -0.4, 1.2], [-0.4, -0.4, 0.8], 0.04, 'wood'),
        box(-2.3, -0.35, -0.72, 0.72, 0.66, 1.0, 'wood'),
        box(-2.25, -0.4, -0.74, 0.74, 1.0, 1.5, 'cloth'), arch(-2.25, -0.4, 0.74, 1.5, 'cloth'),
        cyl('z', [-2.55, 0.4, 1.0], 0.22, 0.4, 'wood', 10), ...flag(-2.4, -0.7, 1.5, 0.9, 0.5),
      ];
      return [...at(grp(horse({ cloth: false, saddle: false })), 1.3, 0), ...grp(c)];
    } },
    freightlorry: { name: 'Freight Lorry', ruler: 2, build() {
      return [...chassis('cloth'), box(-2.45, 0.38, -0.88, 0.88, 0.78, 1.9, 'cloth'), arch(-2.45, 0.38, 0.88, 1.9, 'cloth'), box(-1.4, -0.7, -0.9, -0.88, 1.1, 1.6, 'mark', { b: 0.05 })];
    } },
    freighter: { name: 'Freight Truck', ruler: 2, build() {
      return [...chassis('hull'), box(-2.55, 0.38, -0.9, 0.9, 0.78, 2.45, 'polo'), box(-2.5, 0.3, -0.92, -0.9, 1.6, 1.9, 'mark', { b: 0.05 })];
    } },
    hovfreight: { name: 'Hover Freighter', ruler: 2, build() {
      return [...chassis('hull'), box(-2.55, 0.38, -0.9, 0.9, 0.78, 2.2, 'hull'), box(-2.5, 0.3, -0.92, -0.9, 1.5, 1.8, 'mark', { b: 0.05 })];
    } },
    aalorry: { name: 'AA Lorry', ruler: 2, build() {
      // Twin guns raised on a pedestal in the bed.
      const guns = turn([...[1, -1].map(s => cyl('x', [0.9, s * 0.16, 0.06], 0.045, 1.9, 'dark', 8)), box(-0.4, 0.4, -0.3, 0.3, -0.18, 0.2, 'hull')], 'y', -40, [0, 0, 0]);
      return [...chassis('cloth'), box(-2.4, 0.4, -0.85, 0.85, 0.78, 1.0, 'cloth'), cyl('z', [-1.1, 0, 1.25], 0.38, 0.5, 'hull', 12, 0.3), box(-1.4, -0.8, -0.45, 0.45, 1.45, 1.6, 'hull'), ...move(guns, [-1.1, 0, 1.85])];
    } },
    motorbike: { name: 'Motorcycle Scouts', ruler: 2, build() {
      // Two machines, one with a sidecar and its gunner.
      const bike = car => {
        const p = [
          cyl('y', [0.72, 0, 0.34], 0.34, 0.12, 'dark', 14), cyl('y', [-0.68, 0, 0.34], 0.34, 0.14, 'dark', 14),
          box(-0.75, 0.45, -0.1, 0.1, 0.45, 0.62, 'metal'), box(-0.2, 0.3, -0.16, 0.16, 0.3, 0.62, 'dark'),
          box(0.0, 0.48, -0.14, 0.14, 0.62, 0.86, 'mark', { tx1: 0.38 }), box(-0.6, -0.05, -0.14, 0.14, 0.62, 0.78, 'dark'),
          rod([0.72, 0, 0.34], [0.52, 0, 1.05], 0.035, 'metal'), rod([0.5, -0.36, 1.06], [0.5, 0.36, 1.06], 0.025, 'metal'),
          box(-0.42, -0.08, -0.2, 0.2, 0.8, 1.4, 'hull', { tx0: -0.25, tx1: 0.08 }),
          cyl('z', [0.05, 0, 1.52], 0.1, 0.2, 'skin', 10), ...hat('brodie', -0.03, 0.03),
          rod([-0.12, -0.22, 1.32], [0.48, -0.34, 1.08], 0.05, 'hull'), rod([-0.12, 0.22, 1.32], [0.48, 0.34, 1.08], 0.05, 'hull'),
        ];
        for (const s of [1, -1]) p.push(rod([-0.25, s * 0.16, 0.85], [0.15, s * 0.22, 0.7], 0.07, 'hull'), rod([0.15, s * 0.22, 0.7], [0.1, s * 0.24, 0.26], 0.06, 'hull'), box(0.02, 0.26, s * 0.24 - 0.06, s * 0.24 + 0.06, 0.18, 0.28, 'dark'));
        if (car) p.push(
          cyl('y', [0.0, -0.98, 0.28], 0.28, 0.12, 'dark', 12), rod([0.0, -0.1, 0.4], [0.0, -0.9, 0.4], 0.03, 'metal'),
          box(-0.6, 0.5, -1.2, -0.6, 0.3, 0.8, 'hull', { tx1: 0.3, top: 'dark' }),
          box(-0.32, -0.02, -1.08, -0.72, 0.8, 1.3, 'hull'), cyl('z', [-0.17, -0.9, 1.42], 0.1, 0.2, 'skin', 10), ...move(hat('brodie'), [-0.19, -0.9, -0.13]),
          rod([0.4, -0.9, 0.8], [0.4, -0.9, 1.18], 0.025, 'metal'), rod([-0.05, -0.9, 1.2], [1.0, -0.9, 1.22], 0.04, 'dark', 6),
        );
        return p;
      };
      return [...at(grp(bike(true)), 0.7, 0.3), ...at(grp(bike(false)), -1.8, 1.3, 6)];
    } },
    armcar: { name: 'Armoured Car', ruler: 2, build() {
      return [
        ...wheels([1.35, -1.15], 0.95, 0.48, 0.2), box(-2.0, 2.1, -0.75, 0.75, 0.55, 0.75, 'dark'),
        py([[0.6, 0.8], [0.6, 1.35], [1.85, 1.25], [2.15, 0.9], [2.15, 0.8]], -0.62, 0.62, 'hull'),
        box(-1.9, 0.65, -0.82, 0.82, 0.8, 1.85, 'hull'), box(-1.6, -0.2, -0.84, -0.82, 1.05, 1.6, 'mark', { b: 0.05 }),
        box(0.95, 1.75, -1.08, -0.84, 0.98, 1.04, 'hull', { b: 0.1 }), box(-1.55, -0.75, -1.08, -0.84, 0.98, 1.04, 'hull', { b: 0.1 }),
        cyl('z', [-0.55, 0, 2.05], 0.62, 0.42, 'hull', 14, 0.55), box(0.0, 0.25, -0.18, 0.18, 1.9, 2.2, 'metal'), cyl('x', [0.8, 0, 2.05], 0.06, 1.2, 'metal', 8),
      ];
    } },
    halftrack: { name: 'Halftrack', ruler: 2, build() {
      return [
        ...wheels([1.55], 0.88, 0.46, 0.2),
        py(track(-2.3, -0.1, 0, 0.78), 0.52, 0.92, 'dark', { b: -3 }), py(track(-2.3, -0.1, 0, 0.78), -0.92, -0.52, 'dark', { b: -3 }),
        box(-2.35, 1.0, -0.92, 0.92, 0.78, 1.55, 'hull', { top: 'dark' }),
        py([[1.0, 0.7], [1.0, 1.55], [2.1, 1.35], [2.35, 0.95], [2.35, 0.7]], -0.72, 0.72, 'hull'),
        box(0.95, 1.0, -0.72, 0.72, 1.55, 1.92, 'glass', { b: 0.05 }), box(-1.9, -0.6, -0.94, -0.92, 0.85, 1.35, 'mark', { b: 0.05 }),
        rod([-0.6, 0, 1.2], [-0.6, 0, 2.05], 0.035, 'metal'), box(0.05, 0.1, -0.32, 0.32, 1.85, 2.35, 'hull', { b: 0.1 }), rod([-1.0, 0, 2.1], [0.75, 0, 2.12], 0.045, 'dark', 6, 0.03, { b: 0.1 }),
      ];
    } },
    landship: { name: 'Landship', ruler: 5, build() {
      // The first tank: a rhomboid with its track running round each side, and a gun in each side's sponson.
      const prof = [[-2.9, 0.3], [-1.75, 0], [1.75, 0], [3.25, 1.05], [2.6, 2.1], [-2.65, 2.1], [-3.05, 1.15]];
      const inset = prof.map(([x, z]) => [x * 0.84 + 0.04, z * 0.78 + 0.24]);
      const p = [box(-1.8, 1.6, -1.15, 1.15, 0.4, 1.95, 'hull')];
      for (const s of [1, -1]) {
        p.push(py(prof, s > 0 ? 1.15 : -1.55, s > 0 ? 1.55 : -1.15, 'dark', { b: -0.5 }), py(inset, s > 0 ? 1.55 : -1.6, s > 0 ? 1.6 : -1.55, 'hull', { b: -0.3 }));
        p.push(box(-0.55, 0.55, s > 0 ? 1.6 : -2.05, s > 0 ? 2.05 : -1.6, 0.6, 1.4, 'hull', { ty0: s > 0 ? 1.6 : -1.9, ty1: s > 0 ? 1.9 : -1.6 }), rod([0.45, s * 1.82, 1.0], [1.75, s * 1.82, 1.0], 0.07, 'metal', 6));
      }
      p.push(box(-0.35, 0.3, -2.07, -2.05, 0.75, 1.2, 'mark', { tx0: -0.3, tx1: 0.25, b: 0.05 }));
      p.push(box(-1.25, 0.4, -0.58, 0.58, 1.95, 2.6, 'hull'), cyl('z', [-1.6, 0.3, 2.6], 0.07, 1.3, 'metal', 6));
      return p;
    } },
    biplane: { name: 'Biplane', ruler: 5, alt: 2.2, build() {
      const p = [
        cyl('x', [-0.9, 0, 1.0], 0.12, 4.4, 'polo', 10, 0.45), cyl('x', [1.45, 0, 1.0], 0.5, 0.35, 'dark', 12),
        ...turn([box(1.66, 1.72, -0.09, 0.09, -0.2, 2.2, 'wood')], 'x', 30, [1.7, 0, 1.0]),
        box(-0.4, 0.9, -3.4, 3.4, 1.95, 2.05, 'polo'), box(-0.3, 1.0, -3.0, 3.0, 0.55, 0.65, 'polo'),
        cyl('z', [0.25, 2.4, 2.07], 0.45, 0.03, 'mark', 14), cyl('z', [0.25, -2.4, 2.07], 0.45, 0.03, 'mark', 14),
        box(-3.75, -3.1, -1.1, 1.1, 1.05, 1.12, 'polo'), py([[-3.2, 1.1], [-3.75, 1.1], [-3.82, 1.9], [-3.5, 1.9]], -0.04, 0.04, 'polo'),
        box(-0.4, 0.15, -0.3, 0.3, 1.45, 1.52, 'dark', { b: 0.05 }),
      ];
      for (const y of [1.2, 2.6, -1.2, -2.6]) p.push(rod([0.35, y, 0.65], [0.25, y, 1.95], 0.03, 'wood'));
      for (const s of [1, -1]) p.push(rod([0.75, s * 0.15, 0.6], [0.65, s * 0.62, -0.05], 0.03, 'metal'), cyl('y', [0.65, s * 0.66, -0.12], 0.26, 0.1, 'dark', 12));
      return p;
    } },
    hoverscout: { name: 'Hover Scout', ruler: 2, build() {
      return [
        ...hoverPads([1.1, -1.05], [0.8, -0.8]),
        py([[-1.9, 0.48], [-1.75, 1.1], [0.6, 1.2], [2.1, 0.7], [1.9, 0.48]], -0.8, 0.8, 'metal'),
        box(-1.2, 0.4, -0.82, -0.8, 0.6, 0.95, 'mark', { b: 0.05 }), box(0.7, 1.7, -0.82, -0.8, 0.66, 0.74, 'glow', { b: 0.05 }),
        cyl('z', [-0.3, 0, 1.3], 0.42, 0.22, 'dark', 12, 0.36), box(-0.1, 1.0, -0.09, 0.09, 1.3, 1.44, 'dark'), box(0.2, 0.9, -0.11, -0.09, 1.34, 1.4, 'glow', { b: 0.05 }),
      ];
    } },
    hoverapc: { name: 'Hover APC', ruler: 2, build() {
      return [
        ...hoverPads([1.45, 0, -1.45], [0.92, -0.92]),
        py([[-2.3, 0.48], [-2.2, 1.55], [0.85, 1.68], [2.38, 1.0], [2.25, 0.48]], -1.05, 1.05, 'metal'),
        box(-1.7, 0.9, -1.07, -1.05, 1.1, 1.18, 'glow', { b: 0.05 }), box(-1.9, -0.6, -1.07, -1.05, 0.65, 1.0, 'mark', { b: 0.05 }),
        cyl('z', [0.0, 0, 1.78], 0.5, 0.28, 'dark', 14, 0.45), box(-0.3, 0.45, -0.36, 0.36, 1.8, 2.1, 'metal'),
        box(0.4, 1.55, -0.1, 0.1, 1.86, 2.02, 'dark'), box(0.6, 1.45, -0.12, -0.1, 1.9, 1.98, 'glow', { b: 0.05 }),
      ];
    } },
    hauler: { name: 'Hauler', ruler: 2, build() {
      return [
        ...hoverPads([1.45, 0, -1.45], [0.98, -0.98]),
        box(-2.45, 2.45, -1.25, 1.25, 0.5, 1.0, 'dark'),
        py([[1.2, 1.0], [1.2, 2.5], [2.0, 2.5], [2.5, 1.6], [2.5, 1.0]], -1.15, 1.15, 'metal'), box(2.28, 2.32, -0.8, 0.8, 1.65, 1.95, 'glow', { tx0: 2.42, tx1: 2.46, b: 0.05 }),
        loft(rect(-2.5, 1.05, -1.15, 1.15, 1.0), rect(-2.6, 1.1, -1.25, 1.25, 2.5), 'metal', { b: -0.3, top: 'dark' }),
        box(-1.9, -0.2, -1.27, -1.25, 1.4, 2.2, 'mark', { tx0: -1.92, tx1: -0.18, b: 0.05 }),
        ...lumps(-2.3, 0.8, -0.85, 0.85, 2.35, 8, 23, 0.26),
      ];
    } },
    repairbot: { name: 'Repair Drone', ruler: 2, build() {
      // A hovering pod with two working arms and the side's cross.
      const p = [...hoverPads([0.6, -0.6], [0.5, -0.5], 0.4, 0.26), cyl('x', [0, 0, 1.25], 0.55, 1.6, 'metal', 12), cyl('x', [1.0, 0, 1.25], 0.55, 0.4, 'metal', 12, 0.28), cyl('x', [-1.0, 0, 1.25], 0.3, 0.4, 'metal', 12, 0.55)];
      for (const s of [1, -1]) p.push(rod([0.6, s * 0.5, 1.2], [1.25, s * 0.8, 1.0], 0.05, 'dark'), rod([1.25, s * 0.8, 1.0], [1.55, s * 0.8, 0.75], 0.04, 'dark'), box(1.5, 1.65, s * 0.8 - 0.05, s * 0.8 + 0.05, 0.6, 0.75, 'glow', { b: 0.05 }));
      p.push(box(-0.45, -0.17, -0.58, -0.555, 1.05, 1.55, 'mark', { b: 0.06 }), box(-0.55, -0.07, -0.58, -0.555, 1.21, 1.39, 'mark', { b: 0.06 }));
      return p;
    } },
    mech: { name: 'Mech Walker', ruler: 2, build() {
      // Two legs under a body that turns, a rail cannon on each arm.
      const p = [];
      for (const s of [1, -1]) {
        const y = s * 0.75;
        p.push(box(-0.4, 0.62, y - 0.28, y + 0.28, 0, 0.2, 'dark'), rod([0.05, y, 0.18], [-0.28, y, 1.25], 0.17, 'metal'), cyl('y', [-0.28, y, 1.25], 0.2, 0.36, 'dark', 10), rod([-0.28, y, 1.25], [0.12, y, 2.25], 0.19, 'metal'));
      }
      p.push(box(-0.45, 0.45, -0.85, 0.85, 2.1, 2.45, 'dark'), box(-0.9, 0.85, -0.8, 0.8, 2.4, 3.35, 'metal', { tx1: 0.68 }), box(0.72, 0.8, -0.5, 0.5, 2.9, 3.05, 'glow', { tx0: 0.62, tx1: 0.7, b: 0.05 }), box(-0.75, 0.0, -0.82, -0.8, 2.6, 3.15, 'mark', { b: 0.05 }));
      for (const s of [1, -1]) p.push(box(-0.35, 0.3, s > 0 ? 0.8 : -1.2, s > 0 ? 1.2 : -0.8, 2.45, 3.0, 'dark'), box(0.3, 1.95, s > 0 ? 0.93 : -1.09, s > 0 ? 1.09 : -0.93, 2.62, 2.8, 'dark'), box(0.5, 1.8, s > 0 ? 1.09 : -1.11, s > 0 ? 1.11 : -1.09, 2.68, 2.74, 'glow', { b: 0.05 }));
      return p;
    } },
    titan: { name: 'Titan', ruler: 5, build() {
      // A four-legged walking fortress with twin rails on its turret.
      const p = [];
      for (const [x, y] of [[1.75, 1.6], [1.75, -1.6], [-1.75, 1.6], [-1.75, -1.6]]) {
        p.push(box(x * 1.15 - 0.45, x * 1.15 + 0.45, y * 1.15 - 0.45, y * 1.15 + 0.45, 0, 0.25, 'dark', { b: -0.3 }), rod([x * 1.15, y * 1.15, 0.2], [x * 1.05, y * 1.05, 1.7], 0.22, 'metal', 4, 0.22, { b: -0.3 }), rod([x * 1.05, y * 1.05, 1.7], [x * 0.75, y * 0.75, 2.7], 0.26, 'metal', 4, 0.26, { b: -0.2 }));
      }
      p.push(box(-2.3, 2.3, -1.75, 1.75, 2.4, 3.6, 'dark'), box(-2.2, 2.2, -1.65, 1.65, 3.6, 3.8, 'metal'), box(-2.0, 2.0, -1.77, -1.75, 2.95, 3.05, 'glow', { b: 0.05 }), box(-1.9, -0.6, -1.77, -1.75, 2.55, 2.88, 'mark', { b: 0.05 }));
      p.push(cyl('z', [0, 0, 4.1], 1.25, 0.6, 'metal', 16, 1.12), box(-0.6, 1.3, -0.9, 0.9, 4.0, 4.75, 'dark'), box(1.28, 1.32, -0.6, 0.6, 4.3, 4.5, 'glow', { b: 0.05 }));
      for (const s of [1, -1]) p.push(box(1.0, 4.6, s > 0 ? 0.35 : -0.62, s > 0 ? 0.62 : -0.35, 4.2, 4.45, 'dark'), box(1.6, 4.4, s > 0 ? 0.62 : -0.64, s > 0 ? 0.64 : -0.62, 4.26, 4.38, 'glow', { b: 0.05 }));
      return p;
    } },
    railart: { name: 'Rail Artillery', ruler: 2, build() {
      const rails = turn([box(-1.6, 2.6, -0.32, -0.16, -0.08, 0.08, 'dark'), box(-1.6, 2.6, 0.16, 0.32, -0.08, 0.08, 'dark'), box(-1.4, 2.4, -0.16, 0.16, -0.04, 0.02, 'glow'), box(-1.8, -0.9, -0.42, 0.42, -0.3, 0.2, 'metal')], 'y', -25, [0, 0, 0]);
      return [...hoverPads([1.2, -1.2], [0.85, -0.85]), box(-1.9, 1.9, -1.1, 1.1, 0.48, 1.15, 'metal'), box(-1.6, -0.3, -1.12, -1.1, 0.6, 1.0, 'mark', { b: 0.05 }), cyl('z', [-0.3, 0, 1.3], 0.85, 0.3, 'dark', 16, 0.75), ...move(rails, [-0.3, 0, 1.75])];
    } },
    laseraa: { name: 'Laser AA', ruler: 2, build() {
      const lens = turn([cyl('x', [0.3, 0, 0], 0.28, 1.1, 'metal', 12, 0.22), cyl('x', [0.88, 0, 0], 0.24, 0.06, 'glow', 12), box(-0.4, 0.1, -0.3, 0.3, -0.3, 0.25, 'dark')], 'y', -40, [0, 0, 0]);
      return [...hoverPads([1.1, -1.1], [0.8, -0.8]), box(-1.75, 1.75, -1.02, 1.02, 0.48, 1.15, 'metal'), box(0.2, 1.4, -1.04, -1.02, 0.6, 1.0, 'mark', { b: 0.05 }), cyl('z', [-0.3, 0, 1.3], 0.62, 0.3, 'dark', 14, 0.55), box(-0.45, -0.15, -0.2, 0.2, 1.4, 2.0, 'dark'), ...move(lens, [-0.3, 0, 2.15])];
    } },
    gunship: { name: 'Gunship', ruler: 2, alt: 2.4, build() {
      // A hull between two ducted fans, stub wings, and a chin turret with a plasma gun.
      const p = [
        py([[-2.6, 0.25], [-1.75, 0.9], [1.45, 0.95], [2.6, 0.35], [2.3, -0.1], [-2.0, -0.1]], -0.75, 0.75, 'metal'),
        box(1.2, 2.25, -0.5, 0.5, 0.75, 1.05, 'glass', { tx0: 1.3, tx1: 1.9, ty0: -0.38, ty1: 0.38, b: 0.05 }),
        box(-0.7, 0.45, -2.0, 2.0, 0.35, 0.5, 'metal'),
        py([[-2.3, 0.6], [-2.95, 1.6], [-2.6, 1.6], [-1.8, 0.6]], -0.06, 0.06, 'metal'),
        box(-1.6, 0.6, -0.77, -0.75, 0.2, 0.35, 'glow', { b: 0.05 }), box(-1.3, -0.2, -0.77, -0.75, 0.42, 0.75, 'mark', { b: 0.05 }),
        cyl('z', [1.85, 0, -0.25], 0.28, 0.3, 'dark', 10, 0.22), box(1.9, 2.75, -0.06, 0.06, -0.32, -0.2, 'dark'), box(2.0, 2.65, -0.08, -0.06, -0.3, -0.24, 'glow', { b: 0.05 }),
      ];
      for (const s of [1, -1]) p.push(cyl('z', [-0.15, s * 2.35, 0.42], 0.95, 0.42, 'metal', 18, 0.95, { top: 'dark' }), box(-0.2, -0.1, s * 2.35 - 0.85, s * 2.35 + 0.85, 0.52, 0.56, 'dark', { b: 0.05 }));
      return p;
    } },
    stealth: { name: 'Stealth Bomber', ruler: 5, alt: 3.5, build() {
      // A flying wing in three convex pieces, a hump over the crew, and the side's marks on top.
      const mid = [[3.2, 0], [0.4, 2.4], [-1.4, 1.6], [-2.0, 0], [-1.4, -1.6], [0.4, -2.4]], wing = [[0.4, 2.4], [-2.0, 6.2], [-2.6, 5.9], [-1.4, 1.6]];
      return [
        pz(mid, 1.0, 1.15, 'dark'), pz(wing, 1.02, 1.12, 'dark'), ...mirror([pz(wing, 1.02, 1.12, 'dark')]),
        box(-1.2, 2.2, -0.75, 0.75, 1.15, 1.45, 'dark', { tx0: -0.9, tx1: 1.4, ty0: -0.5, ty1: 0.5 }), box(1.3, 1.9, -0.35, 0.35, 1.45, 1.52, 'glass', { b: 0.05 }),
        cyl('z', [-0.9, 3.6, 1.14], 0.42, 0.02, 'mark', 14), cyl('z', [-0.9, -3.6, 1.14], 0.42, 0.02, 'mark', 14),
      ];
    } },
    swarm: { name: 'Swarm Drone', ruler: 1, alt: 0.9, build() {
      // Three small drones flying together.
      const quad = () => [box(-0.2, 0.2, -0.12, 0.12, 0, 0.1, 'dark'), box(0.18, 0.24, -0.04, 0.04, 0.03, 0.08, 'glow', { b: 0.02 }), box(-0.1, 0.06, -0.125, -0.12, 0.02, 0.08, 'mark', { b: 0.02 }), ...[45, 135, 225, 315].flatMap(a => turn([box(0.05, 0.38, -0.025, 0.025, 0.06, 0.09, 'metal'), cyl('z', [0.38, 0, 0.1], 0.18, 0.015, 'hull', 16)], 'z', a))];
      return [...move(grp(quad()), [0.55, 0, 0.2]), ...move(grp(quad()), [-0.45, 0.6, 0]), ...move(grp(quad()), [-0.45, -0.6, 0.35])];
    } },
  });

  // ---- Views --------------------------------------------------------------------------------------------------
  // Each view is a parallel projection: P takes a point to the drawing, d points from the unit to the viewer.
  function ortho(az, el) {
    const a = az * RAD, e = el * RAD, d = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
    const r = [-Math.sin(a), Math.cos(a), 0], u = [-Math.sin(e) * Math.cos(a), -Math.sin(e) * Math.sin(a), Math.cos(e)];
    return { d, P: p => [dot(p, r), -dot(p, u)] };
  }
  // Military projection: the plan turned by a and kept true, heights stood straight up at h of their length.
  function military(a, h = 1) {
    const c = Math.cos(a * RAD), s = Math.sin(a * RAD);
    return { d: norm([h * s, -h * c, 1]), P: p => [p[0] * c + p[1] * s, p[0] * s - p[1] * c - p[2] * h] };
  }
  const VIEWS = {
    iso: { name: 'Isometric', ...ortho(-45, 35.264) },
    dim: { name: 'Dimetric', ...ortho(-24, 24) },
    mil: { name: 'Military', ...military(30, 0.9) },
  };
  // The light, from the front left and high, and the hatching each tone of face gets.
  const LIGHT = norm([-0.45, -0.55, 0.85]);
  const tone = n => { const t = dot(n, LIGHT); return t > 0.6 ? '' : t > 0.3 ? 'L' : t > 0 ? 'M' : 'D'; };
  const HATCH = { L: [3.6, 0.5], M: [2.5, 0.6], D: [1.8, 0.7] };
  const MATS = ['sheet', 'hull', 'dark', 'metal', 'glass', 'mark', 'ore', 'cloth', 'skin', 'polo', 'denim', 'wood', 'hide', 'glow'];

  // The hatching patterns, every 15 degrees, k times as wide apart and thick.
  function patterns(k = 1) {
    let s = '';
    for (const [t, [sp, w]] of Object.entries(HATCH)) for (let a = 0; a < 180; a += 15)
      s += `<pattern id="h${t}${a}" patternUnits="userSpaceOnUse" width="12" height="${sp * k}" patternTransform="rotate(${a})"><line class="hl" x1="-1" x2="13" y1="${sp * k / 2}" y2="${sp * k / 2}" stroke-width="${w * k}"/></pattern>`;
    return s + `<pattern id="hS" patternUnits="userSpaceOnUse" width="12" height="${2.6 * k}" patternTransform="rotate(-30)"><line class="shl" x1="-1" x2="13" y1="${1.3 * k}" y2="${1.3 * k}" stroke-width="${0.7 * k}"/></pattern>`;
  }
  // The drawing's style sheet from a palette: ink, and a wash for each material. Values may be colours or CSS
  // variables. ol and e are the outline and inner line widths.
  function css(pal, ol = 2.4, e = 0.7) {
    let s = `.ol{fill:${pal.ink};stroke:${pal.ink};stroke-width:${ol};stroke-linejoin:round}.e{fill:none;stroke:${pal.ink};stroke-width:${e};stroke-linejoin:round}`;
    s += `.hl{stroke:${pal.ink}}.shl{stroke:${pal.ink};stroke-opacity:.42}.shf{fill:${pal.ink}}.rul{stroke:${pal.ink};stroke-width:1;fill:none}.rult{fill:${pal.dim || pal.ink};font:10px "Courier Prime","Courier New",monospace}.sm{stroke-width:.8}`;
    for (const m of MATS) if (pal[m]) s += `.f-${m}{fill:${pal[m]}}.sm.f-${m}{stroke:${pal[m]}}`;
    return s;
  }

  function hull2(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  function newell(p) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]); }
    return [x, y, z];
  }

  // Draws one unit as SVG. o.view is a key of VIEWS, o.treat 'line', 'hatch' or 'wash', o.W and o.H the sheet's
  // size, o.ruler false to leave the metre ruler out, o.style a style sheet and o.defs patterns to put inside, so
  // the drawing stands alone as an image.
  function draw(key, o = {}) {
    const U = UNITS[key], V = VIEWS[o.view || 'iso'], treat = o.treat || 'wash', W = o.W || 360, H = o.H || 240, ruler = o.ruler !== false;
    const parts = U.build();
    if (U.alt) move(parts, [0, 0, U.alt]);
    // Each face faces out of its own solid, and only those toward the viewer are drawn.
    for (const P of parts) {
      const c = mean(P.faces.flatMap(f => f.pts));
      P.faces = P.faces.filter(f => {
        const n = newell(f.pts), l = len(n);
        if (l < 1e-8) return false;
        f.n = mul(n, 1 / l);
        if (dot(f.n, sub(mean(f.pts), c)) < 0) { f.pts.reverse(); f.n = mul(f.n, -1); }
        return true;
      });
      P.front = P.faces.filter(f => dot(f.n, V.d) > 1e-6);
      P.depth = dot(c, V.d) + P.b;
    }
    // A group sorts by the mean depth of its parts, and its parts among themselves by their own.
    const gs = new Map();
    for (const P of parts) if (P.g) { const s = gs.get(P.g) || { d: 0, n: 0 }; s.d += P.depth - P.b; s.n++; gs.set(P.g, s); }
    for (const P of parts) P.gd = P.g ? gs.get(P.g).d / gs.get(P.g).n : P.depth;
    parts.sort((a, b) => a.gd - b.gd || a.depth - b.depth);
    // The shadow on the ground, from each solid's corners pushed down along the light.
    const shade = treat !== 'line' ? parts.map(P => hull2(P.faces.flatMap(f => f.pts).map(p => V.P(sub(p, mul(LIGHT, p[2] / LIGHT[2])))))) : [];
    // Fitted to the sheet, with room for the ruler.
    const all = parts.flatMap(P => P.front.flatMap(f => f.pts.map(V.P))).concat(shade.flat());
    const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])), y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
    const pad = o.pad ?? 18, top = o.top ?? 12, foot = o.foot ?? (ruler ? 30 : 12);
    const k = Math.min((W - 2 * pad) / (x1 - x0), (H - top - foot) / (y1 - y0));
    const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = top + (H - top - foot - (y1 - y0) * k) / 2 - y0 * k;
    const S = p => { const q = V.P(p); return [q[0] * k + ox, q[1] * k + oy]; };
    const path = pts => 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z';
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${o.attrs || ''}>`;
    if (o.style) svg += `<style>${o.style}</style>`;
    if (o.defs) svg += `<defs>${o.defs}</defs>`;
    if (shade.length) {
      const sp = shade.map(h => path(h.map(q => [q[0] * k + ox, q[1] * k + oy]))).join('');
      svg += `<path class="shf" fill-opacity=".09" d="${sp}"/><path fill="url(#hS)" d="${sp}"/>`;
    }
    for (const P of parts) {
      if (!P.front.length) continue;
      const faces = P.front.map(f => ({ f, d: path(f.pts.map(S)) }));
      svg += `<path class="ol" d="${faces.map(x => x.d).join('')}"/>`;
      for (const { f, d } of faces) {
        const mat = treat === 'wash' ? f.mat || P.mat : 'sheet';
        svg += `<path class="f-${mat}${f.smooth ? ' sm' : ''}" d="${d}"/>`;
        // A sidebar's card is hatched a step lighter, so a big vehicle's faces read as drawn and not as a solid.
        const t0 = treat === 'line' ? '' : f.mat === 'dark' ? 'M' : tone(f.n), t = o.soft ? (t0 === 'D' ? 'M' : t0 === 'M' ? 'L' : t0) : t0;
        if (t) {
          // Hatching runs along the solid on its sides and along the longest edge on its ends.
          let dir;
          if (f.along) dir = f.along;
          else { let best = 0; for (let i = 0; i < f.pts.length; i++) { const e = sub(f.pts[(i + 1) % f.pts.length], f.pts[i]); if (len(e) > best) { best = len(e); dir = e; } } }
          const a = S(dir), z = S([0, 0, 0]);
          let ang = Math.atan2(a[1] - z[1], a[0] - z[0]) / RAD;
          ang = ((Math.round(ang / 15) * 15) % 180 + 180) % 180;
          svg += `<path fill="url(#h${t}${ang})" d="${d}"/>`;
          if (t === 'D') svg += `<path fill="url(#hL${(ang + 60) % 180})" d="${d}"/>`;
        }
        if (!f.smooth) svg += `<path class="e" d="${d}"/>`;
      }
    }
    if (ruler) {
      // A ruler along the unit's length, in metres.
      const n = U.ruler, a0 = S([-n / 2, 0, 0]), a1 = S([n / 2, 0, 0]), dx = a1[0] - a0[0], dy = a1[1] - a0[1];
      const bx = 14, by = H - 12 - Math.max(0, dy), ux = dx / n, uy = dy / n, nx = -uy / Math.hypot(ux, uy) * 4, ny = ux / Math.hypot(ux, uy) * 4;
      let rul = `M${bx} ${by.toFixed(1)}l${dx.toFixed(1)} ${dy.toFixed(1)}`;
      for (let i = 0; i <= n; i++) rul += `M${(bx + ux * i).toFixed(1)} ${(by + uy * i).toFixed(1)}l${nx.toFixed(1)} ${ny.toFixed(1)}`;
      svg += `<path class="rul" d="${rul}"/><text class="rult" x="${(bx + dx + 6).toFixed(1)}" y="${(by + dy + 3).toFixed(1)}">${n} m</text>`;
    }
    return svg + '</svg>';
  }

  // The sidebar's palettes: pen and ink on light paper, on dark paper, and Daylight's steel panel.
  const PALETTES = {
    light: { ink: '#1f1a16', hull: '#e6d9b6', dark: '#bdb29c', metal: '#d6cebd', glass: '#c3d2d6', ore: '#dcab4c', cloth: '#c9c39b', skin: '#e6c8a6', polo: '#efe6d0', denim: '#9fb1c6', wood: '#d4b380', hide: '#c9b49a', glow: '#bfe0ea', mix: [250, 244, 228], mixK: 0.55 },
    dark: { ink: '#e8e0cf', hull: '#3b362c', dark: '#2b2823', metal: '#35322c', glass: '#2b3739', ore: '#6f5322', cloth: '#3a3a2c', skin: '#4c3e33', polo: '#4a4538', denim: '#2e3a4a', wood: '#4a3a25', hide: '#433a30', glow: '#2b4a54', mix: [35, 32, 27], mixK: 0.6 },
    daylight: { ink: '#e6e2c8', hull: '#4a4c3c', dark: '#2a2b22', metal: '#3c3e33', glass: '#33424a', ore: '#8a6422', cloth: '#454a34', skin: '#5e4a3a', polo: '#5a5646', denim: '#33465c', wood: '#5c472c', hide: '#544739', glow: '#36606c', mix: [30, 33, 25], mixK: 0.5 },
  };
  // Whether a colour reads pink: a light red or magenta, by its hue, saturation and lightness.
  const pinkish = c => {
    const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-6) return false;
    const s = d / (1 - Math.abs(2 * l - 1)), h = (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    return (h >= 300 || h <= 15) && s > 0.25 && l > 0.55;
  };
  // A side's colour as a wash for its markings, let down toward the paper. A red let down toward light paper turns
  // pink, so its share of paper shrinks until it reads red. A wash the dark scheme's filter will turn over goes dark
  // there, so with `turned` it is let down the whole way.
  const wash = (hex, pal, turned = false) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), m = pal.mix;
    let w = c;
    for (let k = pal.mixK; k > -0.01; k -= 0.05) { w = c.map((v, i) => Math.round(v + (m[i] - v) * Math.max(0, k))); if (turned || !pinkish(w)) break; }
    return '#' + w.map(v => v.toString(16).padStart(2, '0')).join('');
  };
  // Every unit's picture for the sidebar, as image URLs, in a palette with the side's colour on the markings. The
  // brackets and quotes are escaped too, as the sidebar sets them in an unquoted CSS url(). Each set is drawn once.
  const drawn = new Map();
  function pictures(scheme, side = '#6fb0ff', W = 132, H = 88) {
    const id = [scheme, side, W, H].join();
    if (drawn.has(id)) return drawn.get(id);
    const pal = Object.assign({}, PALETTES[scheme] || PALETTES.light);
    pal.mark = wash(side, pal);
    const style = css(pal, 1.7, 0.5), defs = patterns(0.85), out = {};
    for (const key of Object.keys(UNITS)) out[key] = 'data:image/svg+xml,' + encodeURIComponent(draw(key, { W, H, ruler: false, style, defs, pad: 6, top: 4, foot: 22, soft: true })).replace(/[()']/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    drawn.set(id, out);
    return out;
  }

  return { UNITS, VIEWS, draw, patterns, css, pictures, PALETTES, wash };
})();
if (typeof module !== 'undefined') module.exports = Axo;
