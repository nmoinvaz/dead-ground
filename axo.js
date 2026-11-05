// Dead Ground, the units drawn as a draughtsman would: convex solids projected in parallel, each part with a heavy
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
  const hoverPads = (xs, ys, z = 0.42) => xs.flatMap(x => ys.flatMap(y => [cyl('z', [x, y, z + 0.08], 0.44, 0.22, 'dark', 12, 0.5), cyl('z', [x, y, z - 0.08], 0.38, 0.1, 'glow', 12, 0.42)]));

  // ---- People -------------------------------------------------------------------------------------------------
  // A standing figure facing x, 1.8 m, in o.cloth with o.legs, a helmet or o.hair, and what it carries.
  function figure(o = {}) {
    const st = o.stride ?? 0.04, cloth = o.cloth || 'cloth', legs = o.legs || cloth;
    const p = [
      box(-0.02, 0.18, 0.03, 0.18, 0, 0.86, legs), box(-0.2, -0.02 + st, -0.18, -0.03, 0, 0.86, legs),
      box(-0.03, 0.2, 0.03, 0.18, 0, 0.1, 'dark', { b: 0.01 }), box(-0.22, -0.02 + st, -0.18, -0.03, 0, 0.1, 'dark', { b: 0.01 }),
      box(-0.15, 0.13, -0.23, 0.23, 0.84, 1.44, cloth, { tx1: 0.11 }),
      cyl('z', [0.02, 0, 1.55], 0.1, 0.2, 'skin', 10),
      box(-0.05, 0.36, -0.31, -0.2, 1.13, 1.27, cloth, { b: 0.06 }), box(0.05, 0.42, 0.12, 0.22, 1.12, 1.25, cloth),
    ];
    if (o.pack !== false) p.push(box(-0.4, -0.16, -0.17, 0.17, 1.0, 1.42, 'cloth', { b: -0.05 }));
    if (o.vest !== false) p.push(box(-0.18, 0.17, -0.21, 0.21, 0.98, 1.38, 'hull', { b: 0.02 }), box(-0.17, -0.12, -0.25, -0.215, 1.22, 1.34, 'mark', { b: 0.05 }));
    if (o.hair) p.push(box(-0.11, 0.08, -0.1, 0.1, 1.6, 1.69, o.hair, { tx0: -0.09, tx1: 0.05, ty0: -0.08, ty1: 0.08, b: 0.02 }));
    else p.push(cyl('z', [0.0, 0, 1.7], 0.16, 0.14, o.hat || 'cloth', 12, 0.09));
    if (o.glasses) p.push(box(0.1, 0.125, -0.09, 0.09, 1.56, 1.6, 'dark', { b: 0.05 }));
    if (o.rifle !== false) p.push(box(-0.18, 0.78, -0.035, 0.035, 1.2, 1.28, 'metal', { b: 0.08 }), box(0.25, 0.33, -0.03, 0.03, 1.04, 1.2, 'metal', { b: 0.07 }));
    return p;
  }
  const at = (parts, x, y, deg = 0) => turn(move(parts, [x, y, 0]), 'z', deg, [x, y, 0]);

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
  const MATS = ['sheet', 'hull', 'dark', 'metal', 'glass', 'mark', 'ore', 'cloth', 'skin', 'polo', 'denim'];

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
    parts.sort((a, b) => a.depth - b.depth);
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
        const t = treat === 'line' ? '' : f.mat === 'dark' ? 'M' : tone(f.n);
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
    light: { ink: '#1f1a16', hull: '#e6d9b6', dark: '#bdb29c', metal: '#d6cebd', glass: '#c3d2d6', ore: '#dcab4c', cloth: '#c9c39b', skin: '#e6c8a6', polo: '#efe6d0', denim: '#9fb1c6', mix: [250, 244, 228], mixK: 0.55 },
    dark: { ink: '#e8e0cf', hull: '#3b362c', dark: '#2b2823', metal: '#35322c', glass: '#2b3739', ore: '#6f5322', cloth: '#3a3a2c', skin: '#4c3e33', polo: '#4a4538', denim: '#2e3a4a', mix: [35, 32, 27], mixK: 0.6 },
    daylight: { ink: '#e6e2c8', hull: '#4a4c3c', dark: '#2a2b22', metal: '#3c3e33', glass: '#33424a', ore: '#8a6422', cloth: '#454a34', skin: '#5e4a3a', polo: '#5a5646', denim: '#33465c', mix: [30, 33, 25], mixK: 0.5 },
  };
  // A side's colour as a wash for its markings, let down toward the paper.
  const wash = (hex, pal) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), m = pal.mix, k = pal.mixK; return '#' + c.map((v, i) => Math.round(v + (m[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
  // Every unit's picture for the sidebar, as image URLs, in a palette with the side's colour on the markings. The
  // brackets and quotes are escaped too, as the sidebar sets them in an unquoted CSS url().
  function pictures(scheme, side = '#6fb0ff', W = 132, H = 88) {
    const pal = Object.assign({}, PALETTES[scheme] || PALETTES.light);
    pal.mark = wash(side, pal);
    const style = css(pal, 1.7, 0.5), defs = patterns(0.85), out = {};
    for (const key of Object.keys(UNITS)) out[key] = 'data:image/svg+xml,' + encodeURIComponent(draw(key, { W, H, ruler: false, style, defs, pad: 6, top: 4, foot: 22 })).replace(/[()']/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return out;
  }

  return { UNITS, VIEWS, draw, patterns, css, pictures, PALETTES };
})();
if (typeof module !== 'undefined') module.exports = Axo;
