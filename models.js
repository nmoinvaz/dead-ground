// Dead Ground, the models. Everything is built from primitives into one mesh per moving part, with
// a colour on every vertex, a team weight saying how much takes the side's colour, and a glow weight
// for lamps. Models face +x, stand on y = 0, and are sized in map cells.
const Models = (() => {
  const P = {
    hull: 0x9c9884, hull2: 0xb8b39c, hullDk: 0x6e6b5c, bld: 0xd2d3d0, bld2: 0xb6b8b4, bldDk: 0x8b8e8b,
    steel: 0x3a3e42, steelDk: 0x24272a, rubber: 0x17181a, track: 0x232324,
    conc: 0xa8a497, concDk: 0x77746b, concLt: 0xc4c0b2, asphalt: 0x3a3b3d, tarmac: 0x4a4b4c,
    sand: 0xb7a27a, bag: 0xa8966f, canvas: 0x7c7a5c, olive: 0x5c6146, wood: 0x6a5238,
    glass: 0x1c2a33, white: 0xe6e4dc, yellow: 0xdba722, red: 0xb5302a, rust: 0x7a4a2e,
    skin: 0xc99a78, boots: 0x25211d, gear: 0x3f4235, ore: 0xd6a436,
  };

  function make(THREE) {
    const col = new THREE.Color(), m4 = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();

    class Geo {
      constructor() { this.p = []; this.n = []; this.c = []; this.t = []; this.g = []; }
      // Adds a primitive placed at (x, y, z). o gives rx, ry, rz, sx, sy, sz, t (team) and g (glow).
      add(geo, x, y, z, hex, o = {}) {
        const g = geo.index ? geo.toNonIndexed() : geo;
        const pos = g.attributes.position, nor = g.attributes.normal;
        e.set(o.rx || 0, o.ry || 0, o.rz || 0);
        m4.compose(v.set(x, y, z), q.setFromEuler(e), s.set(o.sx || 1, o.sy || 1, o.sz || 1));
        const nm = new THREE.Matrix3().getNormalMatrix(m4);
        col.set(hex);
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        const t = o.t ?? 0, gl = o.g ?? 0;
        for (let i = 0; i < pos.count; i++) {
          a.fromBufferAttribute(pos, i).applyMatrix4(m4);
          b.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
          this.p.push(a.x, a.y, a.z); this.n.push(b.x, b.y, b.z); this.c.push(col.r, col.g, col.b); this.t.push(t); this.g.push(gl);
        }
        return this;
      }
      box(w, h, d, x, y, z, c, o) { return this.add(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, c, o); }
      cyl(rt, rb, h, x, y, z, c, o = {}) {
        const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 12, 1, o.open);
        const r = o.axis === 'x' ? { rz: Math.PI / 2 } : o.axis === 'z' ? { rx: Math.PI / 2 } : {};
        return this.add(g, x, y, z, c, Object.assign({}, o, r));
      }
      // A ball, or with o.top half a ball.
      sph(r, x, y, z, c, o = {}) {
        const g = new THREE.SphereGeometry(r, o.seg || 12, o.rings || 8, 0, Math.PI * 2, 0, o.top ? Math.PI / 2 : Math.PI);
        return this.add(g, x, y, z, c, o);
      }
      // A polygon in the XY plane pushed along z, centred on z. Hull profiles and turret plans.
      prism(pts, depth, x, y, z, c, o = {}) {
        const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
        const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
        g.translate(0, 0, -depth / 2);
        return this.add(g, x, y, z, c, o);
      }
      // A plan seen from above, pushed up by h. Points are (x, z).
      plate(pts, h, x, y, z, c, o = {}) {
        const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1])));
        const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        return this.add(g, x, y, z, c, o);
      }
      // Copies another builder's triangles in, scaled by s, turned by ry about y and moved to (x, y, z).
      merge(src, x, y, z, ry = 0, s = 1) {
        const c = Math.cos(ry), sn = Math.sin(ry), P = src.p, N = src.n;
        for (let i = 0; i < P.length; i += 3) {
          const px = P[i] * s, pz = P[i + 2] * s;
          this.p.push(x + px * c + pz * sn, y + P[i + 1] * s, z - px * sn + pz * c);
          this.n.push(N[i] * c + N[i + 2] * sn, N[i + 1], -N[i] * sn + N[i + 2] * c);
        }
        for (const v of src.c) this.c.push(v);
        for (const v of src.t) this.t.push(v);
        for (const v of src.g) this.g.push(v);
        return this;
      }
      finish() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
        g.setAttribute('aTeam', new THREE.Float32BufferAttribute(this.t, 1));
        g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.g, 1));
        return g;
      }
    }
    const G = () => new Geo();
    const part = (id, geo, o = {}) => Object.assign({ id, geo: geo.finish ? geo.finish() : geo }, o);
    // Paint takes a little of the side's colour, markings take all of it.
    const T = { t: 0.32 }, TB = { t: 1 };
    const mark = (g, w, d, x, y, z, o = {}) => g.box(w, 0.014, d, x, y, z, P.white, Object.assign({ t: 1 }, o));

    // Running gear shared by the tracked vehicles.
    function tracks(g, L, W, y = 0, h = 0.3, wheels = 6) {
      for (const side of [-1, 1]) {
        const z = side * (W / 2 - 0.1);
        g.prism([[-L / 2, 0.04], [-L / 2 + 0.1, 0], [L / 2 - 0.1, 0], [L / 2 + 0.02, 0.1], [L / 2 - 0.04, h], [-L / 2 + 0.04, h]], 0.2, 0, y, z, P.track);
        for (let i = 0; i < wheels; i++) g.cyl(0.11, 0.11, 0.22, -L / 2 + 0.2 + i * (L - 0.4) / (wheels - 1), y + 0.13, z, P.steel, { axis: 'z', seg: 10 });
      }
    }
    function wheel(g, x, z, r = 0.16, w = 0.13) {
      g.cyl(r, r, w, x, r, z, P.rubber, { axis: 'z', seg: 12 });
      g.cyl(r * 0.55, r * 0.55, w + 0.02, x, r, z, P.steel, { axis: 'z', seg: 8 });
    }
    function antenna(g, x, y, z, h = 0.5) { g.cyl(0.006, 0.012, h, x, y + h / 2, z, P.steelDk, { seg: 4 }); }

    const units = {};

    // Main battle tank.
    {
      const b = G();
      tracks(b, 1.72, 0.92, 0, 0.3, 7);
      b.prism([[-0.84, 0.2], [-0.8, 0.46], [0.3, 0.5], [0.86, 0.3], [0.8, 0.16], [-0.8, 0.16]], 0.6, 0, 0, 0, P.hull, T);
      for (const s of [-1, 1]) {
        b.prism([[-0.82, 0.3], [-0.8, 0.44], [0.8, 0.44], [0.86, 0.3]], 0.2, 0, 0, s * 0.38, P.hull2, T);
        b.box(1.5, 0.15, 0.03, -0.02, 0.19, s * 0.47, P.hullDk, T);
        b.cyl(0.03, 0.03, 0.04, -0.75, 0.42, s * 0.3, P.steel, { axis: 'x', seg: 6 });
      }
      b.box(0.5, 0.04, 0.5, -0.5, 0.48, 0, P.steelDk);
      for (let i = 0; i < 4; i++) b.box(0.42, 0.02, 0.05, -0.5, 0.52, -0.16 + i * 0.1, P.steel);
      b.box(0.2, 0.04, 0.12, 0.52, 0.4, 0, P.steel, { rz: -0.33 });
      const t = G();
      t.plate([[-0.46, -0.3], [-0.2, -0.36], [0.26, -0.3], [0.46, -0.1], [0.46, 0.1], [0.26, 0.3], [-0.2, 0.36], [-0.46, 0.3]], 0.2, 0, 0, 0, P.hull, T);
      t.plate([[-0.42, -0.28], [0.22, -0.26], [0.4, -0.08], [0.4, 0.08], [0.22, 0.26], [-0.42, 0.28]], 0.04, 0, 0.2, 0, P.hull2, T);
      t.box(0.24, 0.12, 0.52, -0.5, 0.03, 0, P.gear);
      t.cyl(0.08, 0.09, 0.05, -0.1, 0.25, 0.14, P.hullDk, T);
      t.cyl(0.09, 0.09, 0.03, 0.08, 0.25, -0.14, P.steel);
      t.box(0.14, 0.05, 0.03, 0.08, 0.27, -0.14, P.glass, { g: 0.2 });
      t.box(0.16, 0.08, 0.08, 0.3, 0.2, -0.2, P.steelDk);
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) t.cyl(0.018, 0.018, 0.08, 0.28, 0.1 + i * 0.03, s * (0.34 - i * 0.005), P.steel, { axis: 'x', seg: 5, ry: s * 0.4 });
      t.cyl(0.012, 0.012, 0.3, -0.1, 0.34, 0.14, P.steelDk, { axis: 'x', seg: 5 });
      antenna(t, -0.36, 0.24, 0.2, 0.55); antenna(t, -0.36, 0.24, -0.2, 0.4);
      const g = G();
      g.cyl(0.062, 0.068, 0.3, 0.15, 0, 0, P.hull2, { axis: 'x', seg: 10, t: 0.32 });
      g.cyl(0.04, 0.05, 1.1, 0.8, 0, 0, P.hullDk, { axis: 'x', seg: 10, t: 0.15 });
      g.cyl(0.056, 0.056, 0.16, 0.8, 0, 0, P.hullDk, { axis: 'x', seg: 10, t: 0.15 });
      g.cyl(0.048, 0.044, 0.06, 1.34, 0, 0, P.steelDk, { axis: 'x', seg: 10 });
      mark(t, 0.34, 0.3, -0.12, 0.24, 0); mark(b, 0.06, 0.62, -0.7, 0.465, 0); mark(b, 0.06, 0.62, -0.32, 0.5, 0, { rz: 0.04 });
      // Running gear: sprocket and idler at the ends, return rollers, shoes on the top run, bins on the fenders.
      for (const sd of [-1, 1]) {
        const z = sd * 0.36;
        b.cyl(0.13, 0.13, 0.2, -0.78, 0.17, z, P.steelDk, { axis: 'z', seg: 12 });
        for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283; b.box(0.04, 0.04, 0.21, -0.78 + Math.cos(a) * 0.13, 0.15 + Math.sin(a) * 0.13, z, P.steel, { rz: a }); }
        b.cyl(0.1, 0.1, 0.2, 0.8, 0.19, z, P.steelDk, { axis: 'z', seg: 10 });
        for (let i = 0; i < 3; i++) b.cyl(0.04, 0.04, 0.2, -0.4 + i * 0.4, 0.3, z, P.steel, { axis: 'z', seg: 6 });
        for (let i = 0; i < 16; i++) b.box(0.03, 0.012, 0.2, -0.78 + i * 0.105, 0.305, z, P.steelDk);
        b.box(0.34, 0.1, 0.12, -0.45, 0.44, sd * 0.4, P.hull2, T); b.box(0.22, 0.1, 0.12, 0.0, 0.44, sd * 0.4, P.hull2, T);
        b.box(0.05, 0.05, 0.07, 0.8, 0.3, sd * 0.33, P.white, { g: 0.8 });
        b.box(0.06, 0.04, 0.04, 0.86, 0.2, sd * 0.2, P.steelDk);
        b.box(0.06, 0.14, 0.1, -0.87, 0.26, sd * 0.2, P.olive);
      }
      for (let i = 0; i < 6; i++) b.box(0.035, 0.012, 0.4, -0.62 + i * 0.07, 0.5, 0, P.steelDk);
      // Turret: armour blocks on the cheeks, a bustle rack, the commander's sight, the gunner's sight, a hatch.
      for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) t.box(0.07, 0.06, 0.07, 0.36 - i * 0.075, 0.04 + j * 0.07, sd * (0.27 + i * 0.02), P.hull2, { ry: sd * 0.5, t: 0.32 });
      t.box(0.02, 0.1, 0.56, -0.68, 0.12, 0, P.steelDk);
      for (const z of [-0.28, 0.28]) t.box(0.24, 0.1, 0.02, -0.57, 0.12, z, P.steelDk);
      t.box(0.22, 0.012, 0.56, -0.57, 0.06, 0, P.steelDk);
      t.box(0.12, 0.1, 0.1, 0.06, 0.24, 0.14, P.steelDk); t.box(0.03, 0.06, 0.08, 0.13, 0.27, 0.14, P.glass, { g: 0.3 });
      t.cyl(0.08, 0.08, 0.03, -0.08, 0.255, -0.18, P.hullDk, { seg: 10 });
      t.box(0.12, 0.06, 0.1, 0.3, 0.2, 0.08, P.steel); t.box(0.02, 0.04, 0.08, 0.36, 0.21, 0.08, P.glass, { g: 0.4 });
      for (let i = 0; i < 4; i++) g.cyl(0.054, 0.054, 0.025, 0.42 + i * 0.22, 0, 0, P.steelDk, { axis: 'x', seg: 10 });
      g.box(0.05, 0.04, 0.04, 1.22, 0.06, 0, P.steelDk);
      units.tank = [part('hull', b), part('turret', t, { pivot: [-0.04, 0.5, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.36, 0.12, 0], recoil: 0.2 })];
    }

    // Goliath, a super heavy with two guns and a mine plough.
    {
      const b = G();
      tracks(b, 2.3, 1.4, 0, 0.38, 8);
      for (const s of [-1, 1]) tracks(b, 1.2, 0.34, 0, 0.3, 4), b.box(1.2, 0.3, 0.2, -0.5, 0.02, s * 0.74, P.track);
      b.prism([[-1.12, 0.24], [-1.08, 0.58], [0.42, 0.64], [1.16, 0.36], [1.06, 0.2], [-1.08, 0.2]], 1.02, 0, 0, 0, P.hull, T);
      for (const s of [-1, 1]) b.box(1.9, 0.2, 0.05, -0.06, 0.3, s * 0.72, P.hull2, T);
      b.box(0.1, 0.34, 1.44, 1.28, 0.05, 0, P.steel, { rz: -0.3 });
      b.box(0.62, 0.05, 0.7, -0.68, 0.6, 0, P.steelDk);
      for (const s of [-1, 1]) b.cyl(0.07, 0.07, 0.34, -1.12, 0.46, s * 0.3, P.steelDk, { axis: 'x', seg: 8 });
      const t = G();
      t.plate([[-0.62, -0.44], [-0.2, -0.54], [0.36, -0.46], [0.6, -0.2], [0.6, 0.2], [0.36, 0.46], [-0.2, 0.54], [-0.62, 0.44]], 0.3, 0, 0, 0, P.hull, T);
      t.plate([[-0.56, -0.4], [0.3, -0.38], [0.52, -0.14], [0.52, 0.14], [0.3, 0.38], [-0.56, 0.4]], 0.05, 0, 0.3, 0, P.hull2, T);
      t.box(0.3, 0.16, 0.74, -0.7, 0.05, 0, P.gear);
      t.cyl(0.11, 0.12, 0.08, -0.16, 0.35, -0.2, P.hullDk, T);
      t.cyl(0.015, 0.015, 0.34, -0.1, 0.48, -0.2, P.steelDk, { axis: 'x', seg: 5 });
      antenna(t, -0.5, 0.35, 0.28, 0.7);
      const g = G();
      for (const s of [-1, 1]) {
        g.cyl(0.07, 0.08, 0.3, 0.16, 0, s * 0.17, P.hull2, { axis: 'x', seg: 10, t: 0.32 });
        g.cyl(0.046, 0.056, 1.3, 0.9, 0, s * 0.17, P.hullDk, { axis: 'x', seg: 10, t: 0.15 });
        g.cyl(0.065, 0.065, 0.2, 0.9, 0, s * 0.17, P.hullDk, { axis: 'x', seg: 10, t: 0.15 });
        g.cyl(0.06, 0.05, 0.08, 1.54, 0, s * 0.17, P.steelDk, { axis: 'x', seg: 10 });
      }
      mark(t, 0.46, 0.42, -0.14, 0.35, 0.06); mark(b, 0.08, 0.9, -0.95, 0.6, 0);
      for (const sd of [-1, 1]) {
        for (let i = 0; i < 6; i++) b.box(0.16, 0.12, 0.05, -0.8 + i * 0.3, 0.36, sd * 0.76, P.hull2, { t: 0.32 });
        b.box(0.06, 0.06, 0.08, 1.1, 0.4, sd * 0.4, P.white, { g: 0.8 });
        for (let i = 0; i < 4; i++) t.box(0.09, 0.08, 0.09, 0.46 - i * 0.1, 0.06, sd * (0.4 + i * 0.03), P.hull2, { ry: sd * 0.5, t: 0.32 });
      }
      t.box(0.02, 0.12, 0.8, -0.86, 0.16, 0, P.steelDk);
      for (const z of [-0.4, 0.4]) t.box(0.24, 0.12, 0.02, -0.75, 0.16, z, P.steelDk);
      for (let i = 0; i < 8; i++) b.box(0.04, 0.014, 0.5, -0.9 + i * 0.07, 0.64, 0, P.steelDk);
      units.heavy = [part('hull', b), part('turret', t, { pivot: [-0.1, 0.64, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.5, 0.16, 0], recoil: 0.24 })];
    }

    // Flak track, twin guns and a search radar.
    {
      const b = G();
      tracks(b, 1.56, 0.86, 0, 0.28, 6);
      b.prism([[-0.76, 0.18], [-0.74, 0.44], [0.38, 0.46], [0.78, 0.26], [0.74, 0.14], [-0.74, 0.14]], 0.58, 0, 0, 0, P.hull, T);
      for (const s of [-1, 1]) b.box(1.4, 0.13, 0.03, 0, 0.18, s * 0.44, P.hullDk, T);
      const t = G();
      t.plate([[-0.34, -0.3], [0.2, -0.3], [0.34, -0.12], [0.34, 0.12], [0.2, 0.3], [-0.34, 0.3]], 0.26, 0, 0, 0, P.hull, T);
      t.box(0.1, 0.2, 0.34, -0.3, 0.26, 0, P.steel);
      t.box(0.03, 0.24, 0.44, -0.36, 0.42, 0, P.white, { rz: 0.2 });
      t.box(0.14, 0.1, 0.1, 0.22, 0.26, 0.18, P.steelDk);
      const g = G();
      for (const s of [-1, 1]) {
        g.box(0.3, 0.1, 0.08, 0.1, -0.05, s * 0.2, P.steelDk);
        g.cyl(0.016, 0.022, 0.84, 0.62, 0, s * 0.2, P.steel, { axis: 'x', seg: 6 });
      }
      mark(t, 0.28, 0.3, -0.02, 0.26, 0); mark(b, 0.36, 0.06, -0.4, 0.45, 0.2); mark(b, 0.36, 0.06, -0.4, 0.45, -0.2);
      for (const sd of [-1, 1]) { b.box(0.05, 0.05, 0.07, 0.74, 0.3, sd * 0.3, P.white, { g: 0.8 }); b.box(0.3, 0.09, 0.1, -0.35, 0.44, sd * 0.38, P.hull2, T); }
      t.cyl(0.1, 0.1, 0.06, 0.1, 0.29, -0.16, P.steelDk, { seg: 10 }); t.box(0.08, 0.06, 0.06, 0.24, 0.26, -0.16, P.glass, { g: 0.4 });
      units.flak = [part('hull', b), part('turret', t, { pivot: [0, 0.46, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.2, 0.16, 0], recoil: 0.05, tilt: 0.35 })];
    }

    // Eight-wheeled infantry fighting vehicle.
    {
      const b = G();
      for (const s of [-1, 1]) for (const x of [-0.56, -0.2, 0.2, 0.56]) wheel(b, x, s * 0.4, 0.17, 0.16);
      b.prism([[-0.86, 0.2], [-0.84, 0.56], [0.26, 0.6], [0.9, 0.34], [0.82, 0.16], [-0.8, 0.16]], 0.72, 0, 0, 0, P.hull, T);
      for (const s of [-1, 1]) {
        b.prism([[-0.84, 0.26], [-0.82, 0.56], [0.24, 0.6], [0.88, 0.34], [0.8, 0.26]], 0.05, 0, 0, s * 0.37, P.hull2, T);
        for (let i = 0; i < 3; i++) b.box(0.12, 0.05, 0.02, -0.4 + i * 0.3, 0.46, s * 0.4, P.glass);
      }
      b.box(0.3, 0.05, 0.5, -0.6, 0.58, 0, P.hull2, T);
      b.box(0.24, 0.05, 0.2, 0.4, 0.46, 0.18, P.steel, { rz: -0.3 });
      antenna(b, -0.7, 0.58, 0.28, 0.7);
      const t = G();
      t.plate([[-0.24, -0.2], [0.14, -0.2], [0.26, -0.08], [0.26, 0.08], [0.14, 0.2], [-0.24, 0.2]], 0.16, 0, 0, 0, P.hull2, T);
      t.box(0.1, 0.1, 0.1, -0.1, 0.16, -0.08, P.steel);
      const g = G();
      g.cyl(0.05, 0.05, 0.16, 0.1, 0, 0, P.steel, { axis: 'x', seg: 8 });
      g.cyl(0.018, 0.024, 0.72, 0.5, 0, 0, P.steelDk, { axis: 'x', seg: 6 });
      g.cyl(0.028, 0.028, 0.1, 0.84, 0, 0, P.steelDk, { axis: 'x', seg: 6 });
      mark(b, 0.4, 0.5, -0.4, 0.6, 0); mark(t, 0.2, 0.22, -0.04, 0.16, 0);
      for (const sd of [-1, 1]) {
        b.box(0.05, 0.05, 0.07, 0.86, 0.36, sd * 0.26, P.white, { g: 0.8 });
        b.box(0.3, 0.08, 0.04, 0.0, 0.48, sd * 0.38, P.hullDk, T);
        for (const x of [-0.56, -0.2, 0.2, 0.56]) b.cyl(0.07, 0.07, 0.02, x, 0.17, sd * 0.49, P.steelDk, { axis: 'z', seg: 8 });
        b.box(1.5, 0.02, 0.02, 0, 0.35, sd * 0.375, P.steelDk);
      }
      b.box(0.02, 0.3, 0.42, -0.865, 0.24, 0, P.hullDk);
      for (const x of [-0.52, -0.26]) b.cyl(0.08, 0.08, 0.025, x, 0.6, 0.14, P.hullDk, { seg: 10 });
      for (let i = 0; i < 4; i++) b.box(0.04, 0.04, 0.03, 0.18 - i * 0.08, 0.58, 0.27, P.glass, { g: 0.3 });
      b.box(0.18, 0.05, 0.12, 0.0, 0.585, -0.24, P.steelDk);
      t.box(0.26, 0.1, 0.08, -0.04, 0.08, -0.24, P.hull2, T); t.cyl(0.03, 0.03, 0.06, 0.12, 0.13, -0.24, P.white, { axis: 'x', seg: 6 });
      for (let i = 0; i < 3; i++) t.cyl(0.016, 0.016, 0.06, 0.2, 0.05 + i * 0.03, 0.2, P.steel, { axis: 'x', seg: 5 });
      units.ifv = [part('hull', b), part('turret', t, { pivot: [-0.1, 0.6, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.2, 0.09, 0], recoil: 0.08 })];
    }

    // Scout car.
    {
      const b = G();
      for (const s of [-1, 1]) for (const x of [-0.42, 0.44]) wheel(b, x, s * 0.31, 0.15, 0.12);
      b.prism([[-0.66, 0.18], [-0.66, 0.42], [-0.1, 0.44], [0.08, 0.64], [-0.44, 0.66], [-0.52, 0.44]], 0.01, 0, 0, 0, P.hull);
      b.prism([[-0.66, 0.18], [-0.66, 0.42], [0.66, 0.42], [0.7, 0.3], [0.66, 0.18]], 0.58, 0, 0, 0, P.hull, T);
      b.prism([[-0.46, 0.42], [-0.4, 0.66], [0.1, 0.66], [0.3, 0.42]], 0.5, 0, 0, 0, P.hull2, T);
      b.prism([[0.1, 0.65], [0.29, 0.43], [0.31, 0.43], [0.12, 0.65]], 0.46, 0, 0, 0, P.glass);
      for (const s of [-1, 1]) b.box(0.36, 0.13, 0.01, -0.1, 0.48, s * 0.255, P.glass);
      b.box(0.1, 0.06, 0.42, 0.68, 0.24, 0, P.steelDk);
      b.box(0.4, 0.06, 0.5, -0.46, 0.42, 0, P.gear);
      antenna(b, -0.6, 0.42, 0.22, 0.6);
      const t = G();
      t.cyl(0.14, 0.15, 0.1, 0, 0, 0, P.hullDk, T);
      t.box(0.16, 0.12, 0.2, 0.08, 0.06, 0, P.steel);
      const g = G();
      g.cyl(0.012, 0.018, 0.46, 0.26, 0, 0, P.steelDk, { axis: 'x', seg: 6 });
      g.box(0.16, 0.05, 0.05, 0.02, -0.02, 0, P.steelDk);
      mark(b, 0.34, 0.34, -0.18, 0.665, 0); mark(b, 0.06, 0.5, 0.5, 0.42, 0);
      for (const sd of [-1, 1]) { b.box(0.03, 0.05, 0.07, 0.7, 0.36, sd * 0.22, P.white, { g: 0.8 }); b.box(0.04, 0.06, 0.03, 0.12, 0.56, sd * 0.3, P.steelDk); b.box(0.52, 0.03, 0.04, 0.32, 0.42, sd * 0.3, P.hullDk); }
      for (let i = 0; i < 5; i++) b.box(0.012, 0.12, 0.012, 0.705, 0.24, -0.12 + i * 0.06, P.steelDk);
      b.cyl(0.13, 0.13, 0.08, -0.7, 0.38, 0, P.rubber, { axis: 'x', seg: 12 });
      t.box(0.02, 0.14, 0.26, 0.17, 0.08, 0, P.hullDk, T);
      units.humvee = [part('hull', b), part('turret', t, { pivot: [-0.1, 0.66, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.1, 0.13, 0], recoil: 0.03 })];
    }

    // Ore truck, a six-wheeled dumper. Its load shows through the open bed.
    {
      const b = G();
      for (const s of [-1, 1]) for (const x of [-0.66, -0.3, 0.66]) wheel(b, x, s * 0.46, 0.22, 0.2);
      b.box(1.8, 0.14, 0.52, 0, 0.26, 0, P.steel);
      b.prism([[0.4, 0.4], [0.4, 0.98], [0.76, 0.98], [0.96, 0.62], [0.96, 0.4]], 0.84, 0, 0, 0, P.hull, T);
      b.prism([[0.74, 0.96], [0.93, 0.63], [0.95, 0.63], [0.76, 0.96]], 0.76, 0, 0, 0, P.glass, { g: 0.05 });
      for (const s of [-1, 1]) b.box(0.26, 0.2, 0.01, 0.6, 0.68, s * 0.425, P.glass);
      b.box(0.1, 0.1, 0.8, 0.98, 0.34, 0, P.yellow);
      for (const s of [-1, 1]) { b.box(0.08, 0.2, 0.02, 1.0, 0.72, s * 0.45, P.rubber); b.cyl(0.04, 0.05, 0.06, 0.82, 1, s * 0.3, P.yellow, { g: 1.2, seg: 6 }); }
      b.prism([[-0.92, 0.42], [-0.96, 0.92], [0.34, 0.92], [0.34, 0.42]], 0.96, 0, 0, 0, P.hull, T);
      b.box(1.2, 0.02, 0.8, -0.3, 0.9, 0, P.steelDk);
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.box(0.04, 0.46, 0.02, -0.82 + i * 0.26, 0.44, s * 0.49, P.hull2, T);
      b.box(0.8, 0.14, 0.02, -0.3, 0.7, 0.5, P.yellow);
      b.box(0.8, 0.14, 0.02, -0.3, 0.7, -0.5, P.yellow);
      const load = G();
      const rocks = [[-0.7, 0, 0.16], [-0.46, 0.22, 0.2], [-0.2, -0.16, 0.22], [0.04, 0.14, 0.18], [-0.34, -0.1, 0.24], [-0.62, -0.22, 0.14], [-0.02, -0.24, 0.13], [-0.2, 0.26, 0.14]];
      for (const r of rocks) load.add(new THREE.DodecahedronGeometry(r[2], 0), r[0], 0.9, r[1], P.ore, { ry: r[0] * 7, g: 0.12 });
      mark(b, 0.3, 0.66, 0.58, 0.98, 0);
      for (const sd of [-1, 1]) {
        b.box(0.03, 0.06, 0.1, 0.97, 0.48, sd * 0.32, P.white, { g: 0.9 });
        b.box(0.04, 0.14, 0.04, 0.86, 0.86, sd * 0.47, P.steelDk);
        b.box(0.3, 0.12, 0.12, 0.2, 0.3, sd * 0.38, P.steel);
        b.box(0.02, 0.16, 0.14, 0.3, 0.24, sd * 0.48, P.rubber);
      }
      for (let i = 0; i < 6; i++) b.box(0.012, 0.16, 0.012, 0.965, 0.52, -0.2 + i * 0.08, P.steelDk);
      b.cyl(0.03, 0.03, 0.5, 0.42, 0.98, 0.36, P.steelDk, { seg: 6 });
      units.truck = [part('hull', b), part('load', load, { pivot: [0, 0, 0], load: true })];
    }

    // Support truck, a flatbed with a crane and a workshop box.
    {
      const b = G();
      for (const s of [-1, 1]) for (const x of [-0.5, -0.16, 0.5]) wheel(b, x, s * 0.36, 0.17, 0.15);
      b.box(1.5, 0.1, 0.5, 0, 0.2, 0, P.steel);
      b.prism([[0.26, 0.3], [0.26, 0.76], [0.54, 0.76], [0.72, 0.5], [0.72, 0.3]], 0.66, 0, 0, 0, P.hull, T);
      b.prism([[0.52, 0.75], [0.69, 0.51], [0.71, 0.51], [0.54, 0.75]], 0.6, 0, 0, 0, P.glass);
      b.box(0.92, 0.5, 0.7, -0.26, 0.3, 0, P.hull, T);
      b.box(0.5, 0.2, 0.01, -0.3, 0.46, 0.355, P.white);
      b.box(0.2, 0.06, 0.012, -0.3, 0.53, 0.36, P.red); b.box(0.06, 0.16, 0.012, -0.3, 0.48, 0.36, P.red);
      b.box(0.5, 0.2, 0.01, -0.3, 0.46, -0.355, P.white);
      b.box(0.2, 0.06, 0.012, -0.3, 0.53, -0.36, P.red); b.box(0.06, 0.16, 0.012, -0.3, 0.48, -0.36, P.red);
      b.cyl(0.06, 0.08, 0.2, 0.05, 0.9, 0.18, P.yellow);
      b.box(0.8, 0.05, 0.05, -0.3, 0.96, 0.18, P.yellow, { rz: 0.25 });
      b.cyl(0.04, 0.05, 0.05, 0.54, 0.78, 0.2, P.yellow, { g: 1.2, seg: 6 });
      mark(b, 0.6, 0.42, -0.26, 0.8, 0);
      for (const sd of [-1, 1]) b.box(0.03, 0.05, 0.08, 0.73, 0.38, sd * 0.24, P.white, { g: 0.9 });
      for (let i = 0; i < 4; i++) b.box(0.012, 0.12, 0.012, 0.725, 0.4, -0.1 + i * 0.07, P.steelDk);
      units.support = [part('hull', b)];
    }

    // Rocket artillery on a truck chassis, with a pod that rises to fire.
    {
      const b = G();
      for (const s of [-1, 1]) for (const x of [-0.72, -0.34, 0.1, 0.7]) wheel(b, x, s * 0.42, 0.17, 0.15);
      b.box(1.86, 0.1, 0.5, 0, 0.22, 0, P.steel);
      b.prism([[0.42, 0.32], [0.42, 0.78], [0.76, 0.78], [0.94, 0.54], [0.94, 0.32]], 0.76, 0, 0, 0, P.hull, T);
      b.prism([[0.74, 0.77], [0.91, 0.55], [0.93, 0.55], [0.76, 0.77]], 0.7, 0, 0, 0, P.glass);
      b.box(1.2, 0.08, 0.74, -0.3, 0.32, 0, P.hull2, T);
      for (const s of [-1, 1]) b.box(0.05, 0.3, 0.06, -0.86, 0.02, s * 0.36, P.steelDk);
      const t = G();
      t.box(0.3, 0.08, 0.5, -0.1, 0, 0, P.steelDk);
      const g = G();
      g.box(1.1, 0.34, 0.64, 0.3, -0.04, 0, P.hull, T);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
        g.cyl(0.05, 0.05, 0.02, 0.86, 0.05 + i * 0.15, -0.21 + j * 0.14, P.steelDk, { axis: 'x', seg: 8 });
        g.cyl(0.03, 0.04, 0.05, 0.87, 0.05 + i * 0.15, -0.21 + j * 0.14, P.white, { axis: 'x', seg: 6 });
      }
      mark(g, 0.8, 0.3, 0.3, 0.3, 0); mark(b, 0.3, 0.6, 0.6, 0.78, 0);
      for (const sd of [-1, 1]) { b.box(0.03, 0.05, 0.08, 0.95, 0.4, sd * 0.28, P.white, { g: 0.9 }); b.box(0.04, 0.12, 0.04, 0.82, 0.7, sd * 0.42, P.steelDk); }
      for (let i = 0; i < 5; i++) b.box(0.012, 0.14, 0.012, 0.945, 0.42, -0.14 + i * 0.07, P.steelDk);
      units.mlrs = [part('hull', b), part('turret', t, { pivot: [-0.3, 0.42, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [-0.2, 0.08, 0], tilt: 0.55, recoil: 0.04 })];
    }

    // Attack helicopter.
    {
      const b = G();
      b.prism([[-0.3, -0.16], [-0.44, 0.1], [-0.2, 0.2], [0.34, 0.28], [0.72, 0.08], [0.86, -0.06], [0.6, -0.18]], 0.3, 0, 0, 0, P.hull, T);
      b.prism([[0.62, 0.18], [0.83, -0.03], [0.87, -0.08], [0.72, -0.06], [0.5, 0.1]], 0.2, 0, 0, 0, P.glass, { g: 0.06 });
      b.prism([[0.2, 0.3], [0.36, 0.42], [0.1, 0.42], [-0.04, 0.26]], 0.2, 0, -0.02, 0, P.glass);
      b.prism([[-0.3, -0.06], [-1.7, 0.1], [-1.72, 0.18], [-0.34, 0.16]], 0.13, 0, 0, 0, P.hull, T);
      b.prism([[-1.5, 0.12], [-1.8, 0.56], [-1.66, 0.56], [-1.42, 0.18]], 0.04, 0, 0, 0, P.hull2, T);
      b.box(0.3, 0.02, 0.7, -1.5, 0.1, 0, P.hull2, T);
      b.cyl(0.1, 0.12, 0.2, -0.04, 0.36, 0, P.steelDk);
      for (const s of [-1, 1]) {
        b.box(0.26, 0.03, 0.56, 0.02, 0.05, s * 0.36, P.hullDk, T);
        b.cyl(0.05, 0.05, 0.32, -0.02, -0.03, s * 0.52, P.steel, { axis: 'x', seg: 8 });
        for (const x of [-0.08, 0.08]) b.cyl(0.03, 0.03, 0.38, 0.05, -0.05, s * (0.28 + (x + 0.08) * 0.7), P.white, { axis: 'x', seg: 6 });
        b.box(0.06, 0.2, 0.03, 0.3, -0.34, s * 0.26, P.steelDk);
        b.box(0.3, 0.04, 0.06, 0.28, -0.36, s * 0.26, P.rubber);
        b.cyl(0.07, 0.09, 0.32, -0.14, 0.22, s * 0.2, P.hull2, { axis: 'x', seg: 8, t: 0.32 });
      }
      b.cyl(0.05, 0.06, 0.12, 0.66, -0.2, 0, P.steelDk);
      b.cyl(0.012, 0.02, 0.32, 0.86, -0.24, 0, P.steelDk, { axis: 'x', seg: 5 });
      const r = G();
      for (let i = 0; i < 4; i++) r.box(1.56, 0.01, 0.07, Math.cos(i * Math.PI / 2) * 0.78, 0, -Math.sin(i * Math.PI / 2) * 0.78, P.steelDk, { ry: i * Math.PI / 2 });
      r.cyl(0.06, 0.08, 0.06, 0, 0.02, 0, P.steel);
      const tr = G();
      for (let i = 0; i < 2; i++) tr.box(0.02, 0.5, 0.05, 0, 0, 0, P.steelDk, { rx: i * Math.PI / 2 });
      mark(b, 0.4, 0.22, 0.05, 0.27, 0, { rz: -0.05 }); for (const s of [-1, 1]) mark(b, 0.22, 0.2, 0.02, 0.08, s * 0.42);
      for (const sd of [-1, 1]) b.cyl(0.05, 0.04, 0.12, -0.32, 0.22, sd * 0.2, P.steelDk, { axis: 'x', seg: 8 });
      b.cyl(0.03, 0.03, 0.06, -1.62, -0.06, 0, P.rubber, { axis: 'z', seg: 8 });
      b.box(0.02, 0.1, 0.02, -1.62, 0.0, 0, P.steelDk);
      r.sph(0.1, 0, 0.12, 0, P.hull2, { seg: 10, rings: 6, t: 0.32 });
      r.cyl(0.03, 0.03, 0.1, 0, 0.06, 0, P.steelDk, { seg: 6 });
      units.heli = [part('hull', b), part('rotor', r, { pivot: [-0.04, 0.48, 0], spin: 'y', rate: 34 }), part('tail', tr, { pivot: [-1.72, 0.4, 0.04], spin: 'z', rate: 44 })];
    }

    // Strike jet.
    {
      const b = G();
      b.prism([[-1.1, 0.02], [-0.9, 0.14], [0.2, 0.2], [0.72, 0.12], [1.3, 0.02], [0.7, -0.06], [-1.1, -0.04]], 0.3, 0, 0, 0, P.hull, T);
      b.prism([[0.2, 0.16], [0.36, 0.28], [0.68, 0.14]], 0.16, 0, 0, 0, P.glass, { g: 0.2 });
      b.plate([[0.3, -0.14], [-0.5, -1.2], [-0.76, -1.2], [-0.5, -0.14], [-0.5, 0.14], [-0.76, 1.2], [-0.5, 1.2], [0.3, 0.14]], 0.03, 0, 0.02, 0, P.hull2, T);
      b.plate([[-0.76, -0.14], [-1.14, -0.5], [-1.26, -0.5], [-1.1, -0.14], [-1.1, 0.14], [-1.26, 0.5], [-1.14, 0.5], [-0.76, 0.14]], 0.02, 0, 0.04, 0, P.hull2, T);
      for (const s of [-1, 1]) b.prism([[-0.8, 0.14], [-1.14, 0.62], [-1, 0.62], [-0.56, 0.14]], 0.03, 0, 0, s * 0.1, P.hull2, Object.assign({ rx: s * 0.2 }, T));
      for (const s of [-1, 1]) {
        b.cyl(0.05, 0.05, 0.24, -0.1, -0.06, s * 0.54, P.steel, { axis: 'x', seg: 8 });
        b.cyl(0.05, 0.05, 0.24, -0.2, -0.06, s * 0.86, P.steel, { axis: 'x', seg: 8 });
      }
      b.cyl(0.1, 0.1, 0.04, -1.12, 0.05, 0, P.white, { axis: 'x', g: 3, seg: 10 });
      for (const s of [-1, 1]) mark(b, 0.34, 0.3, -0.38, 0.055, s * 0.72, { ry: s * -0.35 });
      units.jet = [part('hull', b)];
    }

    // First-person attack drone, an X of carbon with a charge slung under it.
    {
      const b = G();
      for (const a of [0.78, 2.36]) b.box(0.56, 0.015, 0.04, 0, 0, 0, P.steelDk, { ry: a });
      b.box(0.16, 0.05, 0.1, 0, 0, 0, P.hull, T);
      b.cyl(0.04, 0.05, 0.2, 0.04, -0.06, 0, P.white, { axis: 'x', seg: 8 });
      b.box(0.03, 0.02, 0.03, 0.08, 0.05, 0, P.red, { g: 3 });
      const r = G();
      for (const [x, z] of [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) r.cyl(0.1, 0.1, 0.004, x, 0.03, z, P.hullDk, { seg: 10 });
      units.fpv = [part('hull', b), part('rotor', r, { pivot: [0, 0, 0] })];
    }

    // Transport for the paradrop, drawn only as an effect.
    {
      const b = G();
      b.cyl(0.32, 0.32, 3.4, 0, 0, 0, P.hullDk, { axis: 'x', seg: 12 });
      b.prism([[1.7, 0.32], [2.1, 0.06], [2.05, -0.1], [1.7, -0.3]], 0.62, 0, 0, 0, P.hullDk);
      b.prism([[-1.7, 0.3], [-2.5, 0.28], [-2.5, 0.18], [-1.7, -0.28]], 0.5, 0, 0, 0, P.hullDk);
      b.box(1, 0.06, 5.8, 0.3, 0.24, 0, P.hull2);
      b.prism([[-2, 0.3], [-2.56, 1.2], [-2.3, 1.2], [-1.76, 0.3]], 0.05, 0, 0, 0, P.hull2);
      b.box(0.7, 0.05, 2, -2.4, 0.3, 0, P.hull2);
      for (const s of [1.2, 2.3]) for (const k of [-1, 1]) b.cyl(0.14, 0.14, 0.6, 0.4, 0.2, k * s, P.steel, { axis: 'x', seg: 10 });
      units.plane = [part('hull', b)];
    }

    // Figures, true to the body at one and a half times the vehicles' scale. A man is a body that holds
    // his arms and weapon, and two legs that swing from the hip.
    const MAN_H = 0.62, head = MAN_H / 7.5;
    const legs = (cloth = P.olive) => {
      const g = G(), L = MAN_H * 0.47;
      g.cyl(0.042, 0.03, L * 0.52, 0, -L * 0.26, 0, cloth, { seg: 7 });
      g.cyl(0.03, 0.022, L * 0.5, 0, -L * 0.74, 0, cloth, { seg: 7 });
      g.box(0.09, 0.03, 0.05, 0.016, -L - 0.02, 0, P.boots);
      return g;
    };
    function body(o) {
      const g = G(), hip = MAN_H * 0.5, c = o.cloth || P.olive, v = o.vest ?? P.gear, shoulder = hip + MAN_H * 0.3;
      g.cyl(0.058, 0.05, 0.05, 0, hip + 0.02, 0, c, { seg: 7, sz: 1.3 });
      g.cyl(0.068, 0.058, MAN_H * 0.26, 0, hip + MAN_H * 0.16, 0, c, { seg: 8, sz: 1.3 });
      if (v) { g.cyl(0.074, 0.066, MAN_H * 0.2, 0.002, hip + MAN_H * 0.17, 0, v, { seg: 8, sz: 1.32, t: o.vestT ?? 0.55 }); }
      if (o.pack) g.box(0.07, 0.13, 0.11, -0.085, hip + 0.09, 0, o.pack);
      g.cyl(0.018, 0.022, 0.03, 0, shoulder + 0.02, 0, P.skin, { seg: 6 });
      const hy = shoulder + 0.03 + head * 0.5;
      g.sph(head * 0.5, 0.006, hy, 0, P.skin, { seg: 8, rings: 6, sy: 1.12 });
      if (o.hair) { g.sph(head * 0.53, -0.004, hy + 0.012, 0, o.hair, { seg: 8, rings: 5, top: true, sy: 0.82 }); }
      else if (o.helmet !== false) g.sph(head * 0.62, -0.002, hy + 0.008, 0, o.helmetC ?? c, { seg: 8, rings: 5, top: true, sy: 0.95, t: 0.15 });
      if (o.cap) { g.box(0.05, 0.008, 0.07, 0.04, hy + 0.024, 0, o.cap); }
      if (o.glasses) { g.box(0.006, 0.012, 0.062, head * 0.5 + 0.004, hy + 0.004, 0, 0x101010); }
      if (!o.noArms) armsInto(g, o);
      if (o.tool) { g.box(0.05, 0.1, 0.09, 0.02, hip - 0.02, 0.095, P.yellow); }
      return g;
    }
    // Upper arms hang from the shoulders, forearms come forward to the weapon. A soldier of the older ages and the
    // future carries these as a part of their own, which swings from the shoulders as he fights.
    function armsInto(g, o) {
      const c = o.cloth || P.olive, shoulder = MAN_H * 0.8;
      for (const s of [-1, 1]) {
        const z = s * 0.08;
        g.cyl(0.021, 0.018, 0.1, 0.01, shoulder - 0.055, z, o.sleeve ?? c, { seg: 6, rx: s * 0.1, rz: 0.25 });
      }
      g.cyl(0.018, 0.014, 0.1, 0.075, shoulder - 0.095, 0.07, o.sleeve ?? c, { seg: 6, rz: 1.3, rx: 0.3 });
      g.cyl(0.018, 0.014, 0.12, 0.09, shoulder - 0.095, -0.07, o.sleeve ?? c, { seg: 6, rz: 1.35, rx: -0.5 });
      g.sph(0.017, 0.13, shoulder - 0.085, 0.02, P.skin, { seg: 6, rings: 4 });
      g.sph(0.017, 0.15, shoulder - 0.09, -0.03, P.skin, { seg: 6, rings: 4 });
      if (o.tube) g.cyl(0.03, 0.03, 0.46, 0.02, shoulder + 0.03, 0.08, P.olive, { axis: 'x', seg: 8 });
      if (o.rifle) {
        const ry = shoulder - 0.075, n = o.rifle;
        g.box(n, 0.02, 0.014, 0.1 + n / 2 - 0.1, ry, -0.01, P.steelDk);
        g.box(0.03, 0.04, 0.012, 0.11, ry - 0.03, -0.01, P.steelDk);
        g.box(0.06, 0.03, 0.014, 0.0, ry - 0.015, -0.01, P.steelDk);
      }
      return g;
    }
    // A figure for the field: body and legs, and his arms with what he carries as a third part pivoted at the
    // shoulders, so a stance can bring them round and a shot kick them.
    const figure = (o, cloth) => {
      const a = G(); armsInto(a, o);
      return [part('body', body(Object.assign({}, o, { noArms: true }))), part('leg', legs(cloth ?? o.cloth)), part('arms', a, { pivot: [0, MAN_H * 0.8, 0], blow: 'shot' })];
    };
    const man = {
      rifle: figure({ rifle: 0.22, pack: P.gear }),
      rocket: figure({ tube: true, rifle: 0, pack: P.gear }),
      engineer: figure({ cloth: 0x8a7a55, vest: P.yellow, vestT: 0, tool: true, helmetC: P.yellow, pack: P.gear }),
      sniper: figure({ cloth: 0x4b4f38, vest: 0x3f4430, rifle: 0.34, helmet: false, hair: 0x4b4f38 }),
      hero: figure({ cloth: 0xe7ddc4, sleeve: 0xe7ddc4, vest: 0, helmet: false, hair: 0x1d1612, glasses: true, rifle: 0.2 }, 0x34506e),
    };

    const chute = (() => {
      const g = G();
      g.sph(0.7, 0, 1.25, 0, P.white, { top: true, sy: 0.55, seg: 14, t: 0.4 });
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; g.box(0.008, 1.3, 0.008, Math.cos(a) * 0.34, 0.32, Math.sin(a) * 0.34, P.white, { rz: Math.cos(a) * 0.5, rx: -Math.sin(a) * 0.5 }); }
      return g.finish();
    })();

    const sand = (g, cx, cz, w, d, rows = 2) => {
      // A ring of sandbags round a rectangle.
      for (let r = 0; r < rows; r++) {
        const y = 0.02 + r * 0.1, n = Math.round(w / 0.3);
        for (let i = 0; i < n; i++) for (const s of [-1, 1]) g.cyl(0.075, 0.08, 0.3, cx - w / 2 + (i + 0.5 + (r % 2) * 0.3) * w / n, y + 0.05, cz + s * d / 2, P.bag, { axis: 'x', seg: 6, sy: 0.75 });
        const m = Math.round(d / 0.3);
        for (let i = 0; i < m; i++) for (const s of [-1, 1]) g.cyl(0.075, 0.08, 0.3, cx + s * w / 2, y + 0.05, cz - d / 2 + (i + 0.5 + (r % 2) * 0.3) * d / m, P.bag, { axis: 'z', seg: 6, sy: 0.75 });
      }
    };
    const pad = (g, w, d, c = P.conc) => {
      g.box(w, 0.5, d, 0, -0.42, 0, c);
      g.box(w - 0.02, 0.04, 0.05, 0, 0.08, d / 2 - 0.15, P.yellow);
      g.box(w - 0.02, 0.04, 0.05, 0, 0.08, -d / 2 + 0.15, P.yellow);
    };
    const lights = (g, pts, c = P.red) => pts.forEach(p => g.sph(0.05, p[0], p[1], p[2], c, { g: 4, seg: 6, rings: 4 }));
    const windows = (g, x, y, z, w, h, n, axis, o = {}) => {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        if (axis === 'x') g.box(w / n * 0.68, h, 0.02, x + t * w, y, z, P.glass, { g: o.g ?? 0.9 });
        else g.box(0.02, h, w / n * 0.68, x, y, z + t * w, P.glass, { g: o.g ?? 0.9 });
      }
    };

    const buildings = {};

    // Headquarters, a two-storey command block with a helipad and a mast.
    {
      const b = G();
      pad(b, 5, 5);
      b.box(4.2, 1, 3.5, -0.1, 0.08, 0, P.conc);
      b.box(4.3, 0.1, 3.6, -0.1, 1.06, 0, P.concDk);
      b.box(4.3, 0.16, 0.02, -0.1, 0.84, 1.8, P.bld, TB); b.box(4.3, 0.16, 0.02, -0.1, 0.84, -1.8, P.bld, TB);
      b.box(0.02, 0.16, 3.6, 2.04, 0.84, 0, P.bld, TB);
      windows(b, -0.1, 0.42, 1.76, 3.8, 0.26, 9, 'x'); windows(b, -0.1, 0.42, -1.76, 3.8, 0.26, 9, 'x'); windows(b, 2, 0.42, 0, 3.1, 0.26, 7, 'z');
      b.box(2.6, 0.72, 2.3, -0.5, 1.14, 0.1, P.concLt);
      windows(b, -0.5, 1.46, 1.26, 2.3, 0.2, 6, 'x'); windows(b, 0.82, 1.46, 0.1, 2, 0.2, 5, 'z');
      b.box(2.7, 0.08, 2.4, -0.5, 1.84, 0.1, P.concDk);
      b.box(0.7, 0.5, 1, 2.1, 0.08, 0, P.concDk);
      b.box(0.5, 0.38, 0.62, 2.48, 0.08, 0, P.glass, { g: 0.6 });
      b.cyl(0.5, 0.5, 0.04, 1.2, 1.1, -0.9, P.tarmac, { seg: 18 });
      b.box(0.34, 0.01, 0.06, 1.2, 1.13, -0.9, P.white); b.box(0.06, 0.01, 0.34, 1.05, 1.13, -0.9, P.white); b.box(0.06, 0.01, 0.34, 1.35, 1.13, -0.9, P.white);
      b.cyl(0.03, 0.06, 1.7, -1.3, 2.7, 0.7, P.steel, { seg: 6 });
      b.cyl(0.25, 0.04, 0.12, -1.1, 2.0, -0.3, P.white, { seg: 12 });
      b.box(0.3, 0.3, 0.4, -1.4, 1.92, -0.5, P.steel); b.box(0.3, 0.2, 0.5, 0.2, 1.92, 0.6, P.steel);
      lights(b, [[-1.3, 3.56, 0.7]]);
      const d = G();
      d.sph(0.34, 0, 0, 0, P.white, { top: true, sy: 0.4, rx: -1.3, seg: 12 });
      d.cyl(0.02, 0.02, 0.26, 0.14, 0.05, 0, P.steel, { axis: 'x', seg: 5 });
      buildings.hq = [part('body', b), part('dish', d, { pivot: [-0.2, 2.1, 0.8], spin: 'y', rate: 0.5 })];
    }

    // Power plant, a cooling tower beside a turbine hall.
    {
      const b = G();
      pad(b, 3, 3);
      const n = [[0.74, 0], [0.62, 0.34], [0.5, 0.86], [0.46, 1.2], [0.5, 1.56], [0.56, 1.76]].map(p => new THREE.Vector2(p[0], p[1]));
      b.add(new THREE.LatheGeometry(n, 18), -0.55, 0.06, -0.5, P.concLt);
      b.cyl(0.52, 0.52, 0.02, -0.55, 1.7, -0.5, P.steelDk, { seg: 16 });
      b.box(1.4, 0.72, 1, 0.5, 0.08, 0.76, P.conc);
      b.box(1.5, 0.08, 1.1, 0.5, 0.8, 0.76, P.concDk);
      b.box(1.4, 0.16, 0.02, 0.5, 0.58, 1.27, P.bld, TB);
      windows(b, 0.5, 0.26, 1.27, 1.2, 0.2, 5, 'x');
      for (const x of [0.92, 1.16]) { b.cyl(0.07, 0.09, 1.3, x, 0.7, -0.5, P.concDk, { seg: 8 }); b.box(0.2, 0.08, 0.2, x, 1.33, -0.5, P.red); }
      b.box(0.9, 0.34, 0.5, 0.86, 0.08, -0.1, P.steel);
      for (let i = 0; i < 5; i++) b.box(0.04, 0.3, 0.46, 0.5 + i * 0.18, 0.1, -0.1, P.bldDk);
      for (const z of [0.3, 0.9]) { b.box(0.4, 0.5, 0.3, -1, 0.08, z, P.steel); for (let k = 0; k < 3; k++) b.cyl(0.03, 0.05, 0.3, -0.88 - k * 0.1, 0.7, z, P.concLt, { seg: 6 }); }
      lights(b, [[-0.55, 1.86, -1.0]]);
      buildings.power = [part('body', b)];
    }

    // Ore refinery, a crusher hall, silos and a conveyor down to the dock.
    {
      const b = G();
      pad(b, 4, 4, P.concDk);
      b.box(1.7, 1.14, 2, -0.8, 0.08, 0.4, P.conc);
      b.prism([[-0.9, 1.2], [0, 1.6], [0.9, 1.2]], 2.04, -0.8, 0, 0.4, P.bld2, TB);
      windows(b, 0.06, 0.7, 0.4, 1.7, 0.2, 5, 'z');
      for (const [x, z, r] of [[-1.15, -1.3, 0.48], [-0.25, -1.3, 0.42]]) {
        b.cyl(r, r, 1.3, x, 0.75, z, P.bld, { t: 1, seg: 16 });
        b.sph(r, x, 1.4, z, P.bld2, { top: true, sy: 0.4, seg: 16, t: 1 });
        b.box(r * 2.02, 0.1, 0.02, x, 0.86, z + r - 0.01, P.yellow);
      }
      b.box(2.2, 0.06, 0.06, 0.0, 1.2, -0.86, P.steel);
      b.box(1.8, 0.1, 0.5, 0.85, 0.8, 0.4, P.steel, { rz: -0.42 });
      b.box(1.6, 0.03, 0.4, 0.85, 0.87, 0.4, P.ore, { rz: -0.42 });
      for (const x of [0.5, 1.1]) b.box(0.08, 0.8 - x * 0.4, 0.08, x, 0.08, 0.4, P.steelDk);
      b.box(1.2, 0.03, 1.5, 1.2, 0.08, 0.4, P.asphalt);
      for (let i = 0; i < 6; i++) b.box(0.2, 0.012, 0.08, 1.7, 0.1, -0.2 + i * 0.24, i % 2 ? P.yellow : P.steelDk);
      b.box(0.9, 0.3, 0.4, 1.3, 0.08, -1.3, P.steel);
      lights(b, [[-0.8, 1.68, 0.4]], P.yellow);
      buildings.refinery = [part('body', b)];
    }

    // Barracks, two arched huts behind sandbags.
    {
      const b = G();
      pad(b, 3, 3);
      const hut = (z, w, L) => {
        b.add(new THREE.CylinderGeometry(w / 2, w / 2, L, 12, 1, false, 0, Math.PI), 0, 0.1, z, P.canvas, { rx: 0, rz: Math.PI / 2, ry: Math.PI / 2 * 0 , t: 0.5 });
        b.box(0.02, 0.28, 0.2, L / 2 + 0.01, 0.1, z, P.wood);
      };
      hut(-0.55, 0.9, 2.3); hut(0.55, 0.9, 2.3);
      b.box(0.9, 0.02, 0.5, 0, 0.56, -0.55, P.bld, TB);
      b.box(0.9, 0.02, 0.5, 0, 0.56, 0.55, P.bld, TB);
      sand(b, 1.34, 0, 0.2, 1.3, 2);
      b.cyl(0.02, 0.02, 1.5, -1.24, 0.82, 1.24, P.steel, { seg: 6 });
      b.box(0.5, 0.28, 0.01, -0.98, 1.3, 1.24, P.bld, TB);
      buildings.barracks = [part('body', b)];
    }

    // War factory, a sawtooth roof over a big roller door.
    {
      const b = G();
      pad(b, 4, 4, P.concDk);
      b.box(3.1, 1.2, 3.2, -0.34, 0.08, 0, P.conc);
      for (let i = 0; i < 4; i++) b.prism([[0, 1.28], [0.76, 1.28], [0, 1.74]], 3.3, -1.86 + i * 0.76, 0, 0, P.bld, { t: 1 });
      for (let i = 0; i < 4; i++) b.prism([[0.74, 1.28], [0.76, 1.28], [0.02, 1.74], [0, 1.72]], 3.2, -1.86 + i * 0.76, 0, 0, P.glass, { g: 0.7 });
      b.box(0.04, 0.84, 2.1, 1.23, 0.1, 0, P.steelDk);
      for (let i = 0; i < 7; i++) b.box(0.03, 0.04, 2, 1.25, 0.16 + i * 0.11, 0, P.steel);
      for (let i = 0; i < 8; i++) b.box(0.05, 0.1, 0.26, 1.26, 1.04, -1.05 + i * 0.3, i % 2 ? P.yellow : P.steelDk);
      b.box(1.1, 0.02, 2.2, 1.76, 0.07, 0, P.asphalt);
      for (const s of [-1, 1]) b.box(1.1, 0.02, 0.06, 1.76, 0.09, s * 1.1, P.yellow);
      b.box(0.1, 1.5, 0.1, -1.5, 0.08, 1.7, P.yellow);
      b.box(1.4, 0.08, 0.08, -0.9, 1.56, 1.7, P.yellow);
      b.box(0.02, 0.5, 0.02, -0.4, 1.08, 1.7, P.steelDk);
      lights(b, [[1.3, 1.26, 1.1], [1.3, 1.26, -1.1]], P.yellow);
      buildings.factory = [part('body', b)];
    }

    // Radar station, a mast with a slow turning bar under a dome.
    {
      const b = G();
      pad(b, 3, 3);
      b.box(1.5, 0.66, 1.3, 0.3, 0.08, 0.5, P.conc);
      windows(b, 0.3, 0.3, 1.16, 1.2, 0.18, 4, 'x');
      b.box(1.56, 0.12, 0.02, 0.3, 0.56, 1.16, P.bld, TB);
      for (const [x, z] of [[-0.9, -0.5], [-0.5, -0.9], [-0.9, -0.9], [-0.5, -0.5]]) b.box(0.05, 1.2, 0.05, x, 0.08, z, P.steel);
      for (const y of [0.4, 0.8]) b.box(0.5, 0.03, 0.5, -0.7, y, -0.7, P.steelDk);
      b.box(0.6, 0.06, 0.6, -0.7, 1.27, -0.7, P.steel);
      b.sph(0.46, 0.6, 0.72, 0.5, P.white, { top: true, seg: 14, sy: 1 });
      lights(b, [[-0.7, 2.2, -0.7]]);
      const d = G();
      d.box(1.4, 0.22, 0.05, 0, 0, 0, P.white);
      d.box(0.1, 0.1, 0.2, 0, -0.02, 0.1, P.steelDk);
      for (let i = -3; i <= 3; i++) d.box(0.02, 0.2, 0.02, i * 0.2, 0, -0.03, P.steel);
      buildings.radar = [part('body', b), part('dish', d, { pivot: [-0.7, 1.56, -0.7], spin: 'y', rate: 1.2 })];
    }

    // Airfield, two painted pads, a hangar and a small tower.
    {
      const b = G();
      pad(b, 6, 4, P.tarmac);
      for (const x of [-1.5, 1.5]) {
        b.cyl(1.05, 1.05, 0.02, x, 0.1, -0.1, 0x55565a, { seg: 22 });
        b.cyl(1.02, 1.02, 0.02, x, 0.105, -0.1, P.yellow, { seg: 22, sy: 0.5 });
        b.cyl(0.96, 0.96, 0.02, x, 0.11, -0.1, 0x55565a, { seg: 22 });
        b.box(0.6, 0.01, 0.1, x, 0.125, -0.1, P.white); b.box(0.1, 0.01, 0.6, x - 0.26, 0.125, -0.1, P.white); b.box(0.1, 0.01, 0.6, x + 0.26, 0.125, -0.1, P.white);
      }
      b.box(4.6, 0.56, 0.7, -0.4, 0.08, 1.5, P.conc);
      b.box(4.7, 0.05, 0.8, -0.4, 0.64, 1.5, P.bld, TB);
      for (let i = 0; i < 6; i++) b.box(0.6, 0.34, 0.02, -2.4 + i * 0.8, 0.08, 1.14, P.steel);
      b.box(0.5, 1.2, 0.5, 2.5, 0.08, 1.4, P.conc);
      b.box(0.8, 0.26, 0.8, 2.5, 1.28, 1.4, P.glass, { g: 0.9 });
      b.box(0.9, 0.05, 0.9, 2.5, 1.54, 1.4, P.concDk);
      b.cyl(0.015, 0.02, 0.6, 2.5, 1.9, 1.4, P.steel, { seg: 5 });
      b.cyl(0.015, 0.015, 0.9, -2.8, 0.5, 1.8, P.steel, { seg: 5 });
      b.cyl(0.03, 0.08, 0.3, -2.66, 0.9, 1.8, P.yellow, { axis: 'x', seg: 6 });
      lights(b, [[2.5, 2.22, 1.4]]);
      for (let i = 0; i < 8; i++) lights(b, [[-2.8 + i * 0.8, 0.12, -1.78]], P.white);
      buildings.airfield = [part('body', b)];
    }

    // Forward base, containers and tents in a sandbag ring.
    {
      const b = G();
      b.box(3, 0.5, 3, 0, -0.42, 0, P.sand);
      sand(b, 0, 0, 2.7, 2.7, 3);
      b.box(1.2, 0.46, 0.5, -0.5, 0.08, -0.7, P.olive, { t: 0.4 });
      b.box(1.2, 0.46, 0.5, -0.5, 0.54, -0.7, P.bld, TB);
      b.add(new THREE.CylinderGeometry(0.42, 0.42, 1.2, 10, 1, false, 0, Math.PI), 0.3, 0.1, 0.6, P.canvas, { rz: Math.PI / 2, ry: 0 });
      b.box(0.5, 0.4, 0.5, 0.8, 0.08, -0.6, P.steel);
      b.cyl(0.02, 0.03, 2, -1.05, 1.08, 1.05, P.steel, { seg: 6 });
      b.box(0.5, 0.28, 0.01, -0.79, 1.82, 1.05, P.bld, TB);
      b.cyl(0.03, 0.05, 1.4, 1.0, 0.78, 1.0, P.steelDk, { seg: 5 });
      b.cyl(0.22, 0.05, 0.1, 1.0, 1.5, 1.0, P.white, { seg: 10, rz: 0.5 });
      lights(b, [[1.0, 1.54, 1.0]]);
      buildings.fob = [part('body', b)];
    }

    // Oil derrick, a pump jack that nods.
    {
      const b = G();
      b.box(2, 0.4, 2, 0, -0.34, 0, P.concDk);
      b.box(1.5, 0.08, 0.4, 0, 0.06, 0, P.steel);
      for (const s of [-1, 1]) b.box(0.05, 0.85, 0.06, 0, 0.1, s * 0.12, P.bld, { t: 1, rz: 0 });
      b.box(0.3, 0.3, 0.3, -0.56, 0.1, 0, P.steel);
      b.cyl(0.16, 0.16, 0.26, -0.3, 0.32, 0, P.bldDk, { axis: 'z', seg: 12, t: 1 });
      b.cyl(0.08, 0.08, 0.4, 0.65, 0.3, 0, P.steelDk, { seg: 8 });
      b.cyl(0.04, 0.04, 0.9, 0.65, 0.7, 0, P.steel, { seg: 6 });
      lights(b, [[-0.56, 0.5, 0]], P.yellow);
      const d = G();
      d.box(1.46, 0.1, 0.1, 0.04, -0.05, 0, P.bld, TB);
      d.prism([[0.7, -0.22], [0.76, 0.2], [0.86, 0.18], [0.92, -0.16]], 0.14, 0, 0, 0, P.yellow);
      d.box(0.1, 0.34, 0.24, -0.66, -0.3, 0, P.steelDk);
      buildings.derrick = [part('body', b), part('beam', d, { pivot: [0, 0.96, 0], nod: true })];
    }

    // Missile silo, a heavy lid over a shaft. The doors open as it charges.
    {
      const b = G();
      pad(b, 3, 3, P.concDk);
      b.box(2.4, 0.4, 2.4, 0, 0.08, 0, P.conc);
      for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) lights(b, [[x, 0.54, z]]);
      for (let i = 0; i < 12; i++) b.box(0.2, 0.012, 0.1, -1.1 + i * 0.2, 0.49, 1.15, i % 2 ? P.yellow : P.steelDk);
      for (let i = 0; i < 12; i++) b.box(0.2, 0.012, 0.1, -1.1 + i * 0.2, 0.49, -1.15, i % 2 ? P.yellow : P.steelDk);
      b.cyl(0.9, 0.9, 0.04, 0, 0.5, 0, P.steelDk, { seg: 24 });
      b.sph(0.34, 0, 0.32, 0, P.white, { top: true, sy: 1.5, seg: 12, t: 0.4 });
      b.box(0.5, 0.24, 0.4, 1.4, 0.08, 1.2, P.steel);
      const l = G();
      l.box(1, 0.1, 2, -0.5, 0, 0, P.bld2, TB);
      l.box(0.05, 0.02, 1.8, -0.1, 0.1, 0, P.yellow);
      const r = G();
      r.box(1, 0.1, 2, 0.5, 0, 0, P.bld2, TB);
      r.box(0.05, 0.02, 1.8, 0.1, 0.1, 0, P.yellow);
      buildings.silo = [part('body', b), part('doorL', l, { pivot: [0, 0.5, 0], door: -1 }), part('doorR', r, { pivot: [0, 0.5, 0], door: 1 })];
    }

    // Defences. Each is a footing and a mount that turns.
    {
      const b = G();
      b.box(2, 0.4, 2, 0, -0.34, 0, P.sand);
      sand(b, 0, 0, 1.8, 1.8, 2);
      b.cyl(0.74, 0.84, 0.56, 0, 0.34, 0, P.conc, { seg: 10 });
      b.cyl(0.8, 0.74, 0.1, 0, 0.66, 0, P.concDk, { seg: 10, t: 0.5 });
      const t = G();
      t.box(0.42, 0.22, 0.62, 0.6, 0.14, 0, P.steelDk);
      const g = G();
      g.cyl(0.014, 0.02, 0.62, 0.3, 0, 0, P.steelDk, { axis: 'x', seg: 6 });
      buildings.bunker = [part('body', b), part('turret', t, { pivot: [0, 0.1, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.7, 0.26, 0], recoil: 0.04 })];
    }
    // Dock: a plank quay on the shore with a crane, bollards, stacked crates and a boathouse under the side's mark.
    // Piles round its edge carry it out over the water; on the bank they go into the ground.
    {
      const b = G(), wood = 0x6a5238, woodDk = 0x4e3a26;
      b.box(3, 0.3, 3, 0, -0.1, 0, wood);
      const ps = [-1.4, -0.47, 0.47, 1.4];
      for (const x of ps) for (const z of ps) if (Math.abs(x) > 1 || Math.abs(z) > 1) b.cyl(0.08, 0.09, 1.6, x, -0.9, z, woodDk, { seg: 6 });
      for (let i = 0; i < 6; i++) b.box(3, 0.012, 0.03, 0, 0.2, -1.25 + i * 0.5, woodDk);
      for (const [x, z] of [[1.3, 1.3], [1.3, -1.3], [-1.3, 1.3], [-1.3, -1.3], [1.3, 0], [-1.3, 0]]) b.cyl(0.07, 0.08, 0.2, x, 0.3, z, woodDk, { seg: 8 });
      b.box(1.3, 0.62, 1.0, -0.6, 0.2, -0.75, woodDk, T);
      b.prism([[-0.7, 0], [0, 0.42], [0.7, 0], [0.7, 0.04], [0, 0.46], [-0.7, 0.04]], 1.06, -0.6, 0.82, -0.75, P.rust);
      b.cyl(0.06, 0.08, 1.3, 0.7, 0.85, 0.6, P.steelDk, { seg: 8 }); b.box(1.3, 0.07, 0.07, 1.05, 1.45, 0.6, P.steelDk, { rz: 0.2 });
      for (const [x, z, h] of [[0.2, 0.9, 0.28], [0.5, 0.95, 0.22], [0.3, 0.55, 0.24]]) b.box(0.28, h, 0.28, x, 0.2, z, P.sand);
      mark(b, 0.6, 0.6, -0.6, 0.83, -0.75);
      buildings.dock = [part('body', b)];
    }
    {
      const b = G();
      b.box(2, 0.4, 2, 0, -0.34, 0, P.sand);
      sand(b, 0, 0, 1.8, 1.8, 3);
      b.cyl(0.2, 0.34, 0.3, 0, 0.21, 0, P.steel, { seg: 10 });
      const t = G();
      t.prism([[-0.32, 0], [-0.3, 0.26], [0.18, 0.34], [0.34, 0.2], [0.34, 0]], 0.5, 0, 0, 0, P.bld, TB);
      const g = G();
      g.cyl(0.03, 0.05, 1.5, 0.8, 0, 0, P.bldDk, { axis: 'x', seg: 8, t: 0.7 });
      g.cyl(0.05, 0.05, 0.1, 1.54, 0, 0, P.steelDk, { axis: 'x', seg: 8 });
      buildings.atgun = [part('body', b), part('turret', t, { pivot: [0, 0.34, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.3, 0.16, 0], recoil: 0.16 })];
    }
    {
      const b = G();
      b.box(2, 0.5, 2, 0, -0.42, 0, P.conc);
      b.cyl(0.42, 0.58, 0.28, 0, 0.22, 0, P.steel, { seg: 10 });
      b.box(0.5, 0.26, 0.36, 0.7, 0.08, 0.66, P.steelDk);
      lights(b, [[0.7, 0.4, 0.66]]);
      const t = G();
      t.cyl(0.26, 0.3, 0.14, 0, 0.07, 0, P.bld, { t: 1, seg: 10 });
      const g = G();
      for (const s of [-1, 1]) for (const k of [-1, 1]) {
        g.cyl(0.075, 0.075, 1.2, 0.26, k * 0.1, s * 0.26 + s * 0.1, P.bld, { axis: 'x', seg: 8, t: 1 });
        g.add(new THREE.ConeGeometry(0.07, 0.14, 8), 0.93, k * 0.1, s * 0.36, P.white, { rz: -Math.PI / 2 });
      }
      g.box(0.12, 0.3, 0.14, -0.06, -0.15, 0, P.steel);
      buildings.sam = [part('body', b), part('turret', t, { pivot: [0, 0.36, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0, 0.34, 0], tilt: 0.6, recoil: 0 })];
    }
    {
      const b = G();
      b.box(2, 0.5, 2, 0, -0.42, 0, P.concDk);
      b.cyl(0.46, 0.7, 0.8, 0, 0.48, 0, P.conc, { seg: 8 });
      for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.78; b.box(0.26, 0.74, 0.18, Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.72, P.steel, { ry: -a }); b.box(0.14, 0.5, 0.2, Math.cos(a) * 0.72, 0.18, Math.sin(a) * 0.72, 0x3aa0ff, { ry: -a, g: 2.2 }); }
      const t = G();
      t.cyl(0.42, 0.46, 0.34, 0, 0.17, 0, P.bld, { t: 1, seg: 10 });
      t.box(0.5, 0.2, 0.74, -0.2, 0.3, 0, P.bld2, TB);
      const g = G();
      for (const s of [-1, 1]) {
        g.box(2.2, 0.08, 0.06, 0.92, -0.04, s * 0.09, P.steel);
        g.box(1.9, 0.02, 0.012, 0.92, 0, s * 0.055, 0x3aa0ff, { g: 3 });
      }
      for (let i = 0; i < 5; i++) g.box(0.1, 0.16, 0.3, 0.1 + i * 0.4, -0.08, 0, P.steelDk);
      buildings.rail = [part('body', b), part('turret', t, { pivot: [0, 0.86, 0], aim: true }), part('gun', g, { parent: 'turret', pivot: [0.1, 0.3, 0], recoil: 0.14 })];
    }

    // The world's fixed things.
    const scenery = {};
    {
      const t = G();
      t.cyl(0.05, 0.09, 0.9, 0, 0.45, 0, 0x4a3a2c, { seg: 6 });
      t.add(new THREE.ConeGeometry(0.62, 1, 7), 0, 1.05, 0, 0xffffff);
      t.add(new THREE.ConeGeometry(0.48, 0.86, 7), 0, 1.5, 0, 0xe8e8e8, { ry: 0.5 });
      t.add(new THREE.ConeGeometry(0.32, 0.7, 7), 0, 1.92, 0, 0xd8d8d8, { ry: 1 });
      scenery.conifer = t.finish();
      const a = G();
      a.cyl(0.06, 0.11, 0.8, 0, 0.4, 0, 0x4a3a2c, { seg: 6 });
      for (const [x, y, z, r] of [[0, 1.05, 0, 0.56], [0.34, 0.9, 0.1, 0.36], [-0.26, 0.92, -0.2, 0.4], [0.06, 0.94, 0.34, 0.34], [-0.1, 1.3, 0.04, 0.34]]) a.add(new THREE.IcosahedronGeometry(r, 1), x, y, z, 0xffffff, { sy: 0.74 });
      scenery.broad = a.finish();
      const k = G();
      k.cyl(0.05, 0.08, 0.8, 0, 0.4, 0, 0x5b4632, { seg: 5 });
      for (let i = 0; i < 4; i++) { const an = i * 1.57 + 0.4; k.cyl(0.015, 0.04, 0.6, Math.cos(an) * 0.18, 0.95, Math.sin(an) * 0.18, 0x5b4632, { seg: 4, rz: -Math.cos(an) * 0.7, rx: Math.sin(an) * 0.7 }); }
      k.add(new THREE.IcosahedronGeometry(0.62, 1), 0, 1.3, 0, 0xffffff, { sy: 0.28 });
      scenery.acacia = k.finish();
      // Lesser plants, in white where the instance colours them. A bush of a few round clumps, a low scrub, a
      // juniper of small cones, a bed of reeds with their brown heads, and a palm with its fronds bowed out.
      const bush = G();
      for (const [x, y, z, r] of [[0, 0.24, 0, 0.3], [0.2, 0.18, 0.12, 0.22], [-0.18, 0.2, -0.1, 0.24], [0.04, 0.4, -0.04, 0.2]]) bush.add(new THREE.IcosahedronGeometry(r, 0), x, y, z, 0xffffff, { sy: 0.85 });
      scenery.bush = bush.finish();
      const scrub = G();
      for (const [x, z, r] of [[0, 0, 0.26], [0.24, 0.1, 0.18], [-0.2, 0.14, 0.2], [0.08, -0.22, 0.17]]) scrub.add(new THREE.IcosahedronGeometry(r, 0), x, r * 0.45, z, 0xffffff, { sy: 0.5 });
      for (let i = 0; i < 5; i++) { const an = i * 1.26; scrub.cyl(0.008, 0.012, 0.32, Math.cos(an) * 0.2, 0.22, Math.sin(an) * 0.2, 0x7a6a52, { seg: 3, rz: -Math.cos(an) * 0.6, rx: Math.sin(an) * 0.6 }); }
      scenery.scrub = scrub.finish();
      const jun = G();
      jun.add(new THREE.ConeGeometry(0.26, 0.62, 6), 0, 0.31, 0, 0xffffff);
      jun.add(new THREE.ConeGeometry(0.2, 0.46, 6), 0.22, 0.23, 0.08, 0xeeeeee, { ry: 0.4 });
      jun.add(new THREE.ConeGeometry(0.18, 0.4, 6), -0.16, 0.2, -0.14, 0xe4e4e4, { ry: 0.9 });
      scenery.juniper = jun.finish();
      const reed = G();
      for (let i = 0; i < 9; i++) {
        const an = i * 2.4, r = 0.06 + (i % 3) * 0.08, x = Math.cos(an) * r, z = Math.sin(an) * r, h = 0.55 + (i * 37 % 10) * 0.035;
        reed.box(0.022, h, 0.022, x, 0, z, 0xffffff, { rz: -x * 0.9, rx: z * 0.9 });
        if (i % 3 === 0) reed.box(0.04, 0.1, 0.04, x - x * 0.9 * h * 0.5, h - 0.04, z + z * 0.9 * h * 0.5, 0x6a4a2e);
      }
      scenery.reed = reed.finish();
      const palm = G();
      for (let i = 0; i < 5; i++) palm.cyl(0.07 - i * 0.006, 0.08 - i * 0.006, 0.4, i * i * 0.012, 0.2 + i * 0.4, 0, 0x8a7458, { seg: 6, rz: -i * 0.06 });
      for (let i = 0; i < 7; i++) { const an = i * 0.9; palm.box(0.7, 0.03, 0.14, 0.16 + Math.cos(an) * 0.34, 1.95, Math.sin(an) * 0.34, 0xffffff, { ry: -an, rz: -0.45 }); }
      scenery.palm = palm.finish();
      // A park's furniture: a fountain of a round stone basin with water in it and a column in the middle, and a
      // bench of a seat, a back and two ends.
      const fount = G();
      fount.cyl(0.8, 0.85, 0.24, 0, 0.12, 0, 0xd8d0c0, { seg: 16 });
      fount.cyl(0.68, 0.68, 0.02, 0, 0.23, 0, 0x8aa0c8, { seg: 16 });
      fount.cyl(0.1, 0.13, 0.75, 0, 0.5, 0, 0xd8d0c0, { seg: 8 });
      fount.cyl(0.3, 0.12, 0.1, 0, 0.88, 0, 0xd8d0c0, { seg: 10 });
      scenery.fountain = fount.finish();
      const bench = G();
      bench.box(0.62, 0.05, 0.18, 0, 0.18, 0, 0x8a6a46);
      bench.box(0.62, 0.16, 0.04, 0, 0.26, -0.08, 0x8a6a46);
      for (const x of [-0.27, 0.27]) bench.box(0.05, 0.2, 0.18, x, 0, 0, 0x4a4038);
      scenery.bench = bench.finish();
      // A market stall: a table under a striped awning on four poles, the awning coloured per instance.
      const stall = G();
      stall.box(0.9, 0.06, 0.5, 0, 0.42, 0, 0x8a6a46);
      for (const [x, z] of [[-0.42, -0.24], [0.42, -0.24], [-0.42, 0.24], [0.42, 0.24]]) stall.box(0.04, 0.85, 0.04, x, 0, z, 0x5a4632);
      stall.box(1.0, 0.04, 0.62, 0, 0.86, 0, 0xffffff, { rx: 0.18 });
      scenery.stall = stall.finish();
      // An outcrop of a few weathered stones of unequal size, each a solid knocked out of true, so it reads as stone
      // and not as a cut solid, and keeps a broken outline when it is small.
      const stone = (rad, seed) => {
        const g = new THREE.IcosahedronGeometry(rad, 0).toNonIndexed(), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i), h = Math.sin(x * 91.7 + y * 47.3 + z * 13.1 + seed * 7.7) * 43758.5;
          const k = 0.78 + 0.4 * (h - Math.floor(h));
          p.setXYZ(i, x * k, y * k * (y < 0 ? 0.5 : 1), z * k);
        }
        g.computeVertexNormals();
        return g;
      };
      const r = G();
      r.add(stone(0.46, 1), 0, 0.2, 0, 0xffffff, { sy: 0.62, ry: 0.3 });
      r.add(stone(0.28, 2), 0.42, 0.1, 0.18, 0xe4e2dc, { sy: 0.7, ry: 1 });
      r.add(stone(0.2, 3), -0.3, 0.07, 0.36, 0xd6d4ce, { sy: 0.66, ry: 2 });
      r.add(stone(0.13, 4), 0.12, 0.05, -0.42, 0xe0ded8, { sy: 0.8 });
      scenery.rock = r.finish();
      // A single flat stone, for a ford's stepping stones.
      scenery.stone = G().add(stone(0.5, 5), 0, 0.2, 0, 0xffffff, { sy: 0.7 }).finish();
      const n = G();
      n.add(new THREE.DodecahedronGeometry(0.2, 0), 0, 0.1, 0, 0xffffff, { sy: 0.8 });
      n.add(new THREE.OctahedronGeometry(0.15, 0), 0.14, 0.18, 0.04, 0xffffff, { sy: 1.5, rx: 0.3 });
      n.add(new THREE.OctahedronGeometry(0.11, 0), -0.1, 0.14, 0.1, 0xffffff, { sy: 1.4, rz: 0.4 });
      scenery.ore = n.finish();
      const h = G();
      h.box(1, 1, 1, 0, 0, 0, 0xffffff);
      scenery.block = h.finish();
      const roof = G();
      roof.prism([[-0.5, 0], [0, 0.42], [0.5, 0]], 1.04, 0, 0, 0, 0xffffff);
      scenery.roof = roof.finish();
      // A church's spire, four-sided, from y = 0 to 1; a windmill's tapering tower and its cap; its four sails about
      // an axle along z; and a hipped roof, sloping on all four sides.
      const spire = G();
      spire.add(new THREE.ConeGeometry(0.7071, 1, 4), 0, 0.5, 0, 0xffffff, { ry: Math.PI / 4 });
      scenery.spire = spire.finish();
      const mill = G();
      mill.add(new THREE.CylinderGeometry(0.36, 0.55, 1, 8), 0, 0.5, 0, 0xffffff);
      scenery.mill = mill.finish();
      const mcap = G();
      mcap.add(new THREE.ConeGeometry(0.46, 0.5, 8), 0, 0.25, 0, 0xffffff);
      scenery.millcap = mcap.finish();
      const sails = G();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2, cx = Math.cos(a) * 0.62, cy = Math.sin(a) * 0.62;
        sails.box(0.05, 1.2, 0.03, cx, cy - 0.6, 0, 0x6a5440, { rz: a - Math.PI / 2 });
        sails.box(0.28, 1.0, 0.012, cx + Math.cos(a + Math.PI / 2) * 0.13, cy + Math.sin(a + Math.PI / 2) * 0.13 - 0.5, 0, 0xf2eee2, { rz: a - Math.PI / 2 });
      }
      sails.cyl(0.06, 0.06, 0.1, 0, 0, 0, 0x4a3a2c, { axis: 'z', seg: 8 });
      scenery.sails = sails.finish();
      const hip = G();
      hip.add(new THREE.ConeGeometry(0.7071, 0.42, 4), 0, 0.21, 0, 0xffffff, { ry: Math.PI / 4 });
      scenery.hip = hip.finish();
      const well = G();
      well.cyl(0.08, 0.1, 0.34, 0, 0.17, 0, P.steelDk, { seg: 8 });
      well.cyl(0.14, 0.14, 0.04, 0, 0.34, 0, P.steelDk, { seg: 8 });
      for (const a of [0, 2.1, 4.2]) well.box(0.04, 0.46, 0.04, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, P.rust, { rz: Math.cos(a) * 0.3, rx: -Math.sin(a) * 0.3 });
      scenery.well = well.finish();
      const pole = G();
      pole.cyl(0.02, 0.03, 2.4, 0, 1.2, 0, P.steel, { seg: 6 });
      pole.sph(0.04, 0, 2.42, 0, P.yellow, { seg: 6, rings: 4 });
      scenery.pole = pole.finish();
      // By the roads, each along x for the road's line: a telegraph pole with its crossarm across the road and two
      // insulators, a milestone, and a signpost with one white arm, set once for each road leaving a junction.
      const tp = G();
      tp.cyl(0.035, 0.055, 2.7, 0, 1.35, 0, 0x6a5a48, { seg: 6 });
      tp.box(0.07, 0.07, 0.8, 0, 2.38, 0, 0x6a5a48);
      for (const z of [-0.32, 0.32]) tp.cyl(0.028, 0.028, 0.09, 0, 2.5, z, 0xe8e0cc, { seg: 5 });
      scenery.tpole = tp.finish();
      const ms = G();
      ms.box(0.14, 0.32, 0.26, 0, 0, 0, 0xd8d0be);
      ms.cyl(0.13, 0.13, 0.14, 0, 0.32, 0, 0xd8d0be, { axis: 'x', seg: 10 });
      scenery.mile = ms.finish();
      const sp = G();
      sp.cyl(0.03, 0.04, 1.6, 0, 0.8, 0, 0x6a5a48, { seg: 6 });
      sp.cyl(0.045, 0.045, 0.05, 0, 1.62, 0, 0x6a5a48, { seg: 6 });
      scenery.signpost = sp.finish();
      const arm = G();
      arm.box(0.55, 0.13, 0.07, 0.32, -0.065, 0, 0xf2eee2);
      arm.prism([[0, -0.065], [0.11, 0], [0, 0.065]], 0.07, 0.595, 0, 0, 0xf2eee2);
      scenery.arm = arm.finish();
      const flag = G();
      flag.box(0.8, 0.46, 0.012, 0.4, 0, 0, P.white, { t: 1 });
      scenery.flag = flag.finish();
      const w = G();
      w.box(1, 0.2, 1, 0, 0, 0, 0xffffff);
      w.box(1, 0.18, 0.05, 0, 0.2, 0.47, 0xdddddd);
      w.box(1, 0.18, 0.05, 0, 0.2, -0.47, 0xdddddd);
      // Seams across the deck between its parapets, so a long bridge reads as one and not as a blank slab.
      for (let i = 1; i < 18; i++) w.box(0.008, 0.016, 0.88, -0.5 + i / 18, 0.2, 0, 0x4a4844);
      scenery.deck = w.finish();
      // The older bridges, each a deck one unit long, scaled to the span. A timber bridge of planks between low rails
      // on posts; a stone one with solid parapets and a coping; an iron one carried by a truss on either side.
      const wd = G();
      wd.box(1, 0.16, 1, 0, 0.04, 0, 0xffffff);
      for (let i = 1; i < 30; i++) wd.box(0.006, 0.012, 0.98, -0.5 + i / 30, 0.2, 0, 0x4a3a2c);
      for (const z of [-0.47, 0.47]) { wd.box(1, 0.03, 0.03, 0, 0.42, z, 0xffffff); for (let i = 0; i <= 12; i++) wd.box(0.02, 0.24, 0.02, -0.5 + i / 12, 0.2, z, 0xffffff); }
      scenery.deckWood = wd.finish();
      const sd = G();
      sd.box(1, 0.2, 1, 0, 0, 0, 0xffffff);
      // Paved in setts, course by course, each course's joints set off from the last's.
      for (let i = 1; i < 24; i++) sd.box(0.005, 0.012, 0.8, -0.5 + i / 24, 0.2, 0, 0x5a554c);
      for (let r = 0; r < 6; r++) for (let i = 0; i < 24; i++) sd.box(0.042, 0.012, 0.005, -0.5 + (i + (r % 2) * 0.5 + 0.5) / 24, 0.2, -0.4 + (r + 0.5) * 0.8 / 6 - 0.4 / 6 + 0.067, 0x5a554c);
      for (const z of [-0.44, 0.44]) { sd.box(1, 0.26, 0.12, 0, 0.2, z, 0xffffff); sd.box(1, 0.05, 0.16, 0, 0.46, z, 0xeeeeee); }
      scenery.deckStone = sd.finish();
      const id = G();
      id.box(1, 0.16, 1, 0, 0.02, 0, 0xffffff);
      for (const z of [-0.48, 0.48]) {
        id.box(1, 0.05, 0.06, 0, 0.9, z, 0xffffff);
        for (let i = 0; i <= 8; i++) id.box(0.014, 0.72, 0.02, -0.5 + i / 8, 0.18, z, 0xffffff);
        for (let i = 0; i < 8; i++) id.box(0.155, 0.014, 0.018, -0.5 + (i + 0.5) / 8, 0.54, z, 0xffffff, { rz: (i % 2 ? 1 : -1) * 1.05 });
      }
      for (let i = 0; i <= 8; i += 2) id.box(0.014, 0.02, 0.96, -0.5 + i / 8, 0.92, 0, 0xffffff);
      // Overhead, a cross brace in each panel between the top chords, which reads from above.
      for (let i = 0; i < 4; i++) for (const sg of [1, -1]) id.box(Math.hypot(0.25, 0.96), 0.016, 0.018, -0.5 + (i + 0.5) / 4, 0.93, 0, 0xffffff, { ry: sg * Math.atan2(0.96, 0.25) });
      scenery.deckIron = id.finish();
      // A timber trestle across the deck, its top at y = 0: posts in a row, a cap beam and a cross brace.
      const tr = G();
      for (const z of [-0.42, -0.14, 0.14, 0.42]) tr.box(0.12, 1, 0.12, 0, -1, z, 0xffffff);
      tr.box(0.16, 0.08, 1, 0, -0.08, 0, 0xffffff);
      tr.box(0.05, 0.05, 1.15, 0, -0.55, 0, 0xffffff, { rx: 0.7 });
      scenery.trestle = tr.finish();
      const pier = G();
      pier.box(0.4, 2.4, 1.2, 0, -2.2, 0, P.concDk);
      scenery.pier = pier.finish();
      // A river pier across a bridge, one long, its ends pointed upstream and down as cutwaters, its top at y = 0.
      const cut = G();
      cut.prism([[0.5, -0.42], [0, -0.5], [-0.5, -0.42], [-0.5, 0.42], [0, 0.5], [0.5, 0.42]], 1, 0, -0.5, 0, P.concDk, { rx: Math.PI / 2 });
      scenery.cutwater = cut.finish();
      const rub = G();
      for (const [x, z, s] of [[0, 0, 0.42], [0.5, 0.2, 0.3], [-0.4, 0.3, 0.34], [0.2, -0.46, 0.26], [-0.34, -0.34, 0.3]]) rub.add(new THREE.BoxGeometry(s * 1.4, s, s), x, s * 0.34, z, P.concDk, { ry: x * 5, rz: z * 0.7 });
      scenery.rubble = rub.finish();

      // Life on the land, each in white where its colour is given per instance. A deer, along x.
      const deer = G();
      deer.box(0.86, 0.26, 0.24, 0, 0.4, 0, 0xffffff);
      deer.box(0.16, 0.3, 0.13, 0.42, 0.55, 0, 0xffffff, { rz: -0.6 });
      deer.box(0.24, 0.12, 0.11, 0.58, 0.76, 0, 0xffffff, { rz: 0.25 });
      for (const [x, z] of [[0.32, 0.08], [0.32, -0.08], [-0.32, 0.08], [-0.32, -0.08]]) deer.box(0.06, 0.42, 0.06, x, 0, z, 0xd8ccbc);
      deer.box(0.1, 0.07, 0.08, -0.45, 0.52, 0, 0xf4f0e8);
      for (const s of [-1, 1]) deer.box(0.03, 0.18, 0.02, 0.54, 0.84, s * 0.06, 0x5a4632, { rz: -0.3, rx: s * 0.4 });
      scenery.deer = deer.finish();
      // The other beasts, each along x and in white where the instance colours it, sized from life beside the deer.
      // A horse, taller and longer, its mane, tail and lower legs dark.
      const horse = G();
      horse.box(0.98, 0.34, 0.28, 0, 0.52, 0, 0xffffff);
      horse.box(0.18, 0.44, 0.16, 0.5, 0.66, 0, 0xffffff, { rz: -0.6 });
      horse.box(0.32, 0.14, 0.13, 0.74, 0.92, 0, 0xffffff, { rz: 0.55 });
      horse.box(0.3, 0.07, 0.05, 0.5, 0.92, 0, 0x2a2018, { rz: -0.6 });
      for (const [x, z] of [[0.36, 0.08], [0.36, -0.08], [-0.36, 0.08], [-0.36, -0.08]]) { horse.box(0.08, 0.3, 0.08, x, 0.24, z, 0xffffff); horse.box(0.07, 0.25, 0.07, x, 0, z, 0x3a2e24); }
      horse.box(0.08, 0.4, 0.07, -0.56, 0.38, 0, 0x2a2018, { rz: -0.3 });
      scenery.horse = horse.finish();
      // A sheep, a short woolly block with a dark face and legs.
      const sheep = G();
      sheep.box(0.58, 0.32, 0.38, 0, 0.22, 0, 0xffffff);
      sheep.box(0.17, 0.17, 0.15, 0.36, 0.38, 0, 0x2e2a26, { rz: 0.3 });
      for (const [x, z] of [[0.18, 0.1], [0.18, -0.1], [-0.18, 0.1], [-0.18, -0.1]]) sheep.box(0.05, 0.24, 0.05, x, 0, z, 0x2e2a26);
      scenery.sheep = sheep.finish();
      // A camel, a dromedary, high on long legs, with one hump and its neck carried out and up.
      const camel = G();
      camel.box(0.92, 0.34, 0.3, 0, 0.8, 0, 0xffffff);
      camel.box(0.4, 0.24, 0.26, -0.04, 1.08, 0, 0xffffff);
      camel.box(0.14, 0.56, 0.12, 0.56, 0.72, 0, 0xffffff, { rz: -1.0 });
      camel.box(0.14, 0.34, 0.12, 0.8, 0.98, 0, 0xffffff, { rz: 0.2 });
      camel.box(0.28, 0.12, 0.12, 0.88, 1.28, 0, 0xffffff);
      for (const [x, z] of [[0.34, 0.09], [0.34, -0.09], [-0.34, 0.09], [-0.34, -0.09]]) camel.box(0.07, 0.8, 0.07, x, 0, z, 0xffffff);
      camel.box(0.05, 0.3, 0.04, -0.5, 0.62, 0, 0x5a4632, { rz: -0.2 });
      scenery.camel = camel.finish();
      // A goat, smaller than a deer, with horns swept back and a beard.
      const goat = G();
      goat.box(0.6, 0.24, 0.22, 0, 0.34, 0, 0xffffff);
      goat.box(0.13, 0.24, 0.11, 0.3, 0.48, 0, 0xffffff, { rz: -0.5 });
      goat.box(0.2, 0.11, 0.1, 0.44, 0.66, 0, 0xffffff, { rz: 0.35 });
      for (const s of [-1, 1]) goat.box(0.03, 0.18, 0.03, 0.38, 0.76, s * 0.04, 0x3a3028, { rz: 0.9 });
      goat.box(0.04, 0.09, 0.04, 0.5, 0.56, 0, 0x3a3028);
      for (const [x, z] of [[0.22, 0.07], [0.22, -0.07], [-0.22, 0.07], [-0.22, -0.07]]) goat.box(0.05, 0.34, 0.05, x, 0, z, 0xd8ccbc);
      goat.box(0.08, 0.1, 0.06, -0.32, 0.5, 0, 0xffffff, { rz: 0.6 });
      scenery.goat = goat.finish();
      // A wolf, long and low, head and snout forward, ears up, its tail hung.
      const wolf = G();
      wolf.box(0.76, 0.22, 0.2, 0, 0.36, 0, 0xffffff);
      wolf.box(0.24, 0.2, 0.18, 0.46, 0.44, 0, 0xffffff);
      wolf.box(0.17, 0.09, 0.09, 0.64, 0.46, 0, 0xffffff);
      for (const s of [-1, 1]) wolf.box(0.04, 0.09, 0.04, 0.44, 0.64, s * 0.05, 0xffffff);
      wolf.box(0.36, 0.07, 0.07, -0.5, 0.26, 0, 0xffffff, { rz: 0.55 });
      for (const [x, z] of [[0.27, 0.07], [0.27, -0.07], [-0.27, 0.07], [-0.27, -0.07]]) wolf.box(0.05, 0.36, 0.05, x, 0, z, 0xffffff);
      scenery.wolf = wolf.finish();
      // An elk of the snows, a big deer with broad flat antlers.
      const elk = G();
      elk.box(0.96, 0.32, 0.28, 0, 0.5, 0, 0xffffff);
      elk.box(0.18, 0.36, 0.15, 0.48, 0.66, 0, 0xffffff, { rz: -0.5 });
      elk.box(0.3, 0.14, 0.13, 0.68, 0.9, 0, 0xffffff, { rz: 0.3 });
      for (const s of [-1, 1]) { elk.box(0.03, 0.1, 0.03, 0.62, 1.0, s * 0.06, 0x8a7458); elk.box(0.14, 0.03, 0.1, 0.6, 1.08, s * 0.12, 0xb8a488, { rx: s * 0.4 }); }
      for (const [x, z] of [[0.34, 0.08], [0.34, -0.08], [-0.34, 0.08], [-0.34, -0.08]]) elk.box(0.07, 0.5, 0.07, x, 0, z, 0x4a3c30);
      scenery.elk = elk.finish();
      // A duck on the water, sitting low, its head green and its bill yellow.
      const duck = G();
      duck.box(0.3, 0.12, 0.15, 0, 0, 0, 0xffffff);
      duck.box(0.08, 0.06, 0.1, -0.15, 0.06, 0, 0xffffff, { rz: 0.5 });
      duck.box(0.1, 0.12, 0.09, 0.12, 0.1, 0, 0x2e5a3a);
      duck.box(0.07, 0.03, 0.05, 0.2, 0.15, 0, 0xd8a838);
      scenery.duck = duck.finish();
      // A small car, along x, with dark glass and wheels.
      const car = G();
      car.box(1.0, 0.26, 0.5, 0, 0.1, 0, 0xffffff);
      car.box(0.52, 0.22, 0.46, -0.06, 0.36, 0, 0xffffff);
      car.box(0.02, 0.16, 0.4, 0.21, 0.39, 0, 0x404650, { rz: -0.5 });
      car.box(0.02, 0.16, 0.4, -0.33, 0.39, 0, 0x404650, { rz: 0.5 });
      for (const [x, z] of [[0.32, 0.26], [0.32, -0.26], [-0.32, 0.26], [-0.32, -0.26]]) car.cyl(0.1, 0.1, 0.06, x, 0.1, z, 0x2a2a2a, { axis: 'z', seg: 8 });
      scenery.car = car.finish();
      // Before the motor car, a horse and a two-wheeled cart, in their own colours.
      const cart = G();
      cart.box(0.36, 0.12, 0.12, 0.3, 0.24, 0, 0x6b4a32); cart.box(0.12, 0.06, 0.06, 0.52, 0.36, 0, 0x6b4a32, { rz: -0.5 });
      for (const [x, z] of [[0.42, 0.04], [0.42, -0.04], [0.18, 0.04], [0.18, -0.04]]) cart.cyl(0.015, 0.012, 0.24, x, 0.12, z, 0x6b4a32, { seg: 4 });
      cart.box(0.46, 0.12, 0.38, -0.2, 0.18, 0, 0x8a6a46); cart.box(0.46, 0.05, 0.38, -0.2, 0.3, 0, 0xc8b48a);
      for (const z of [0.21, -0.21]) cart.cyl(0.13, 0.13, 0.03, -0.2, 0.13, z, 0x4e3a26, { axis: 'z', seg: 10 });
      cart.box(0.4, 0.02, 0.02, 0.08, 0.22, 0.08, 0x4e3a26); cart.box(0.4, 0.02, 0.02, 0.08, 0.22, -0.08, 0x4e3a26);
      scenery.cart = cart.finish();
      // Someone in a town: legs, a shirt the instance colours, a head.
      const folk = G();
      folk.cyl(0.05, 0.06, 0.32, 0, 0.16, 0, 0x5a5650, { seg: 6 });
      folk.cyl(0.07, 0.08, 0.3, 0, 0.47, 0, 0xffffff, { seg: 6 });
      folk.sph(0.06, 0, 0.69, 0, 0xf0d8c0, { seg: 6, rings: 4 });
      scenery.folk = folk.finish();
      // A fishing boat, along x: a pointed hull, a wheelhouse, a short mast.
      const boat = G();
      boat.prism([[-0.75, 0], [0.6, 0], [0.85, 0.26], [-0.8, 0.26]], 0.5, 0, -0.06, 0, 0xffffff);
      boat.box(0.36, 0.3, 0.32, -0.3, 0.2, 0, 0xf2eee4);
      boat.cyl(0.015, 0.02, 0.7, 0.2, 0.5, 0, 0x5a4632, { seg: 4 });
      scenery.boat = boat.finish();
      // A whale, along x, about as long as a fishing boat: a long dark back, a paler throat, two flippers, a small
      // dorsal fin and the flukes spread flat at the tail.
      const whale = G();
      whale.sph(0.2, 0, 0, 0, 0x55636f, { seg: 12, rings: 8, sx: 3.1, sy: 0.62 });
      whale.sph(0.16, 0.22, -0.05, 0, 0x8a949c, { seg: 10, rings: 6, sx: 2.4, sy: 0.4 });
      for (const s of [-1, 1]) whale.box(0.22, 0.02, 0.1, 0.18, -0.06, s * 0.22, 0x55636f, { ry: s * 0.5, rx: s * 0.3 });
      whale.box(0.1, 0.07, 0.02, -0.2, 0.12, 0, 0x55636f, { rz: 0.5 });
      whale.box(0.18, 0.06, 0.07, -0.66, 0, 0, 0x55636f);
      for (const s of [-1, 1]) whale.prism([[0, 0], [-0.22, 0.2], [-0.14, 0.02]], 0.02, -0.72, 0.01, 0, 0x55636f, { rx: s * Math.PI / 2 });
      scenery.whale = whale.finish();
      // A garden fence: one rail, and its post.
      const rail = G();
      rail.box(1, 0.05, 0.04, 0, -0.025, 0, 0xffffff);
      scenery.rail = rail.finish();
      const post = G();
      post.box(0.07, 0.46, 0.07, 0, 0, 0, 0xffffff);
      scenery.post = post.finish();
    }

    // ---- The other ages -------------------------------------------------------------------------------------
    // Colours of the older ages and the future, then the soldiers, the horse and its riders, the engines of war,
    // the first motors, and the future's machines.
    const A = {
      tunic: 0xa8865a, tunic2: 0x8c6e4c, linen: 0xd8ccb0, bronze: 0xb07e3c, iron: 0x6a6c6e, mail: 0x8a8c8e, wood: 0x7a5a3a,
      woodDk: 0x4e3a26, rope: 0xb8a272, coatR: 0x8a2c26, coatB: 0x2c3a5a, coatG: 0x4a5a3a, khaki: 0x8a8058, field: 0x6a6a4e,
      plume: 0xc8a050, canvas: 0xd8d0b8, coal: 0x2a2826, brass: 0xc09a3e, white: 0xece6d6, exo: 0x8e959c, exoDk: 0x454b52,
      glow: 0x7fd6ff, plasma: 0xb07aff, hover: 0x5e6670, ivory: 0xe8dcc0, hide: 0x7a7470, ox: 0x6a4c34,
    };
    const shoulder = MAN_H * 0.8, hy = shoulder + 0.03 + head * 0.5, GLOW = { g: 1.6 };
    // Headgear by age: a crested bronze helmet, a kettle hat, a tricorne, a brimmed steel helmet, a visored helm,
    // or a hood.
    function hat(g, k, c) {
      if (k === 'crest') { g.sph(head * 0.62, -0.002, hy + 0.008, 0, A.bronze, { seg: 8, rings: 5, top: true, sy: 1.05 }); g.box(0.12, 0.05, 0.016, -0.01, hy + 0.05, 0, c || A.coatR, TB); }
      else if (k === 'kettle') { g.sph(head * 0.6, -0.002, hy + 0.01, 0, A.iron, { seg: 8, rings: 5, top: true }); g.cyl(0.075, 0.075, 0.008, 0, hy + 0.012, 0, A.iron, { seg: 10 }); }
      else if (k === 'tricorne') { g.cyl(0.08, 0.08, 0.016, 0, hy + 0.03, 0, 0x1e1c1a, { seg: 3, ry: 0.5 }); g.cyl(0.04, 0.045, 0.04, 0, hy + 0.05, 0, 0x1e1c1a, { seg: 8 }); }
      else if (k === 'brodie') { g.sph(head * 0.6, -0.002, hy + 0.012, 0, A.field, { seg: 8, rings: 4, top: true, sy: 0.6 }); g.cyl(0.085, 0.085, 0.006, 0, hy + 0.012, 0, A.field, { seg: 12 }); }
      else if (k === 'visor') { g.sph(head * 0.66, -0.002, hy + 0.008, 0, A.exoDk, { seg: 8, rings: 5, top: true, sy: 1.1 }); g.box(0.012, 0.022, 0.07, head * 0.5 + 0.008, hy - 0.004, 0, A.glow, GLOW); }
      else if (k === 'hood') { g.sph(head * 0.66, -0.006, hy + 0.004, 0, 0x2e3236, { seg: 8, rings: 5, top: true, sy: 1.2 }); g.box(0.012, 0.016, 0.06, head * 0.5 + 0.006, hy - 0.002, 0, A.glow, GLOW); }
    }
    // What a soldier carries in his hands, held forward at the right hand.
    function arms(g, k) {
      const hx = 0.14, hyy = shoulder - 0.09;
      if (k === 'spear' || k === 'pike') {
        // A rod through the hand, two thirds of it ahead, leaning forward; a pike is lowered nearly level.
        const L = k === 'pike' ? 1.3 : 0.86, a = k === 'pike' ? -1.15 : -0.3, dx = -Math.sin(a), dy = Math.cos(a);
        const cx = hx + dx * L / 6, cy = hyy + dy * L / 6;
        g.cyl(0.007, 0.008, L, cx, cy, -0.03, A.wood, { seg: 5, rz: a });
        g.cyl(0, 0.016, 0.08, cx + dx * (L / 2 + 0.03), cy + dy * (L / 2 + 0.03), -0.03, A.iron, { seg: 5, rz: a });
      } else if (k === 'bow' || k === 'longbow') {
        const L = k === 'longbow' ? 0.5 : 0.36;
        for (let i = -2; i <= 2; i++) g.box(0.01, L / 5, 0.01, hx + 0.02 - Math.abs(i) * 0.012, hyy - 0.02 + i * L / 5 - L / 10, -0.03, A.woodDk, { rz: i * 0.25 });
        g.box(0.004, L * 0.95, 0.004, hx - 0.03, hyy - L * 0.5, -0.03, A.linen);
        g.box(0.05, 0.12, 0.05, -0.08, shoulder - 0.12, 0.05, A.tunic2);
      } else if (k === 'xbow') {
        g.box(0.26, 0.02, 0.02, hx + 0.02, hyy, -0.01, A.wood); g.box(0.02, 0.012, 0.2, hx + 0.13, hyy + 0.01, -0.01, A.iron);
      } else if (k === 'musket' || k === 'jaeger') {
        const n = k === 'jaeger' ? 0.34 : 0.4;
        g.box(n, 0.018, 0.014, n / 2, hyy, -0.01, A.wood); g.box(n * 0.7, 0.012, 0.01, n * 0.65, hyy + 0.012, -0.01, A.iron);
        if (k === 'musket') g.box(0.08, 0.006, 0.006, n + 0.04, hyy + 0.012, -0.01, A.iron);
      } else if (k === 'grenade') {
        g.sph(0.024, hx + 0.01, hyy + 0.02, 0.02, 0x2a2826, { seg: 6, rings: 4 }); g.box(0.07, 0.07, 0.04, 0.02, MAN_H * 0.45, 0.07, A.tunic2);
      } else if (k === 'atr') {
        g.box(0.46, 0.022, 0.016, 0.21, hyy, -0.01, A.iron); g.box(0.12, 0.04, 0.018, 0.02, hyy - 0.015, -0.01, A.wood);
      } else if (k === 'pulse' || k === 'plasma' || k === 'rail') {
        const n = k === 'rail' ? 0.4 : 0.26, t = k === 'plasma' ? 0.04 : 0.028;
        g.box(n, t, 0.03, n / 2 + 0.02, hyy, -0.01, A.exoDk); g.box(n * 0.5, 0.01, 0.032, n / 2 + 0.05, hyy + t * 0.6, -0.01, k === 'plasma' ? A.plasma : A.glow, GLOW);
      } else if (k === 'sword') {
        g.box(0.012, 0.22, 0.03, hx + 0.02, hyy, -0.03, A.mail, { rz: -0.4 });
      }
    }
    const SHIELD = (g, c) => { g.cyl(0.075, 0.075, 0.014, 0.06, MAN_H * 0.62, 0.1, c, { axis: 'z', seg: 12, t: 0.45 }); g.sph(0.018, 0.06, MAN_H * 0.62, 0.11, A.bronze, { seg: 6, rings: 4 }); };
    const soldierGeo = (o) => {
      const b = body(Object.assign({ helmet: false, rifle: 0 }, o));
      hat(b, o.hat, o.crest);
      arms(b, o.arms);
      if (o.shield) SHIELD(b, o.shield);
      if (o.sash) b.box(0.02, 0.2, 0.16, 0.06, MAN_H * 0.5, 0, o.sash, { rx: 0.6 });
      return [b, legs(o.legs ?? o.cloth)];
    };
    // A soldier for the field: body and legs, and his arms with what he carries as a third part, its pivot at the
    // shoulders, and how it moves when he fights: a thrust, a draw of the bow, a shot or a throw.
    const BLOWS = { spear: 'thrust', pike: 'thrust', sword: 'thrust', bow: 'draw', longbow: 'draw', grenade: 'throw' };
    const soldier = (o) => {
      const b = body(Object.assign({ helmet: false, rifle: 0, noArms: true }, o));
      hat(b, o.hat, o.crest);
      if (o.shield) SHIELD(b, o.shield);
      if (o.sash) b.box(0.02, 0.2, 0.16, 0.06, MAN_H * 0.5, 0, o.sash, { rx: 0.6 });
      const a = G(); armsInto(a, Object.assign({ rifle: 0 }, o)); arms(a, o.arms);
      return [part('body', b), part('leg', legs(o.legs ?? o.cloth)), part('arms', a, { pivot: [0, MAN_H * 0.8, 0], blow: BLOWS[o.arms] || 'shot' })];
    };
    Object.assign(man, {
      spear: soldier({ cloth: A.tunic, vest: A.bronze, vestT: 0.4, hat: 'crest', arms: 'spear', shield: A.coatR }),
      pike: soldier({ cloth: A.tunic2, vest: A.mail, vestT: 0.3, hat: 'kettle', arms: 'pike' }),
      musket: soldier({ cloth: A.coatR, vest: A.white, vestT: 0, hat: 'tricorne', arms: 'musket', legs: A.white }),
      rifleman: soldier({ cloth: A.khaki, vest: A.field, hat: 'brodie', arms: 'musket', legs: A.khaki, pack: A.field }),
      // A general: a dark coat with a red sash and a tricorne, his sword drawn.
      general: soldier({ cloth: 0x2a2e3e, vest: 0x2a2e3e, vestT: 0, hat: 'tricorne', arms: 'sword', legs: 0xd8d0be, sash: 0xb02a20 }),
      exo: soldier({ cloth: A.exo, vest: A.exoDk, vestT: 0.5, hat: 'visor', arms: 'pulse', legs: A.exoDk, pack: A.exoDk }),
      archer: soldier({ cloth: A.linen, vest: A.tunic2, vestT: 0, hat: 'crest', crest: A.tunic2, arms: 'bow' }),
      crossbow: soldier({ cloth: A.tunic, vest: A.mail, vestT: 0.3, hat: 'kettle', arms: 'xbow' }),
      grenadier: soldier({ cloth: A.coatB, vest: A.white, vestT: 0, hat: 'tricorne', arms: 'grenade', legs: A.white }),
      atrifle: soldier({ cloth: A.khaki, vest: A.field, hat: 'brodie', arms: 'atr', legs: A.khaki }),
      lancer: soldier({ cloth: A.exo, vest: A.exoDk, vestT: 0.5, hat: 'visor', arms: 'plasma', legs: A.exoDk }),
      longbow: soldier({ cloth: A.coatG, vest: A.tunic2, vestT: 0, hat: false, hair: 0x5a4632, arms: 'longbow' }),
      jaeger: soldier({ cloth: A.coatG, vest: A.coatG, vestT: 0, hat: 'tricorne', arms: 'jaeger', legs: 0x3a3a2c }),
      marksman: soldier({ cloth: A.khaki, vest: A.field, hat: 'brodie', arms: 'jaeger', legs: A.khaki }),
      ghost: soldier({ cloth: 0x3a3e42, vest: 0x2a2e32, vestT: 0, hat: 'hood', arms: 'rail', legs: 0x2a2e32 }),
    });

    // Legs that walk: an upper part from the hip and a lower from the knee, each one mesh shared by every model whose
    // legs are of the same make, and placed once per hip. A hip is [x, y, z, walk, trot, run, splay x, splay z], its
    // place, its phase in each gait, and how far the leg leans out from under the body.
    const legMakes = {};
    function legRig(make, hips, gait, L1, L2, r1, r2, coat, foot, coat2) {
      if (!legMakes[make]) {
        const u = G(); u.cyl(r1, r1 * 0.85, L1 + r1, 0, -L1 / 2 + r1 / 2, 0, coat, { seg: 6 });
        const l = G(); l.cyl(r2, r2 * 0.85, L2 + r2 * 0.5, 0, -L2 / 2 + r2 * 0.25, 0, coat2 ?? coat, { seg: 6 });
        if (foot) foot(l, L2);
        legMakes[make] = [u.finish(), l.finish()];
      }
      const [gu, gl] = legMakes[make];
      return [part('legU', gu, { rig: 'leg', share: 'legU:' + make, hips, gait, L1 }), part('legL', gl, { rig: 'shin', share: 'legL:' + make })];
    }
    // Gaits: a cycle is how far a step of every leg carries it, in cells, duty the share of it a foot is down, fwd and
    // back how far a leg reaches each way, knee how far the lower leg folds as it swings, bob and rock how the body
    // rides, and rest the legs' angles standing. Horses walk, trot and gallop by speed.
    const GAIT = {
      horse: { walk: { cycle: 0.8, duty: 0.62, fwd: 0.3, back: 0.26, knee: 0.8, bob: 0.008 }, trot: { cycle: 1.15, duty: 0.46, fwd: 0.42, back: 0.36, knee: 1.15, bob: 0.016 }, run: { cycle: 1.7, duty: 0.36, fwd: 0.62, back: 0.55, knee: 1.4, bob: 0.02, rock: 0.05 }, trotAt: 1.4, runAt: 3 },
      ox: { walk: { cycle: 0.7, duty: 0.64, fwd: 0.26, back: 0.24, knee: 0.7, bob: 0.008 } },
      elephant: { walk: { cycle: 1.25, duty: 0.66, fwd: 0.24, back: 0.22, knee: 0.45, bob: 0.014 } },
      mech: { walk: { cycle: 1.2, duty: 0.6, fwd: 0.42, back: 0.36, knee: 0.95, bob: 0.03, rest: [0.2, -0.4] } },
      titan: { walk: { cycle: 1.5, duty: 0.74, fwd: 0.3, back: 0.28, knee: 0.7, bob: 0.025, unsplay: 1.5 } },
    };
    // A four-legged beast's hips about (x, z), front and hind dx out and dz across, each animal off by off in phase:
    // a walk sets its feet down hind, fore, hind, fore round the body, a trot by diagonal pairs, a gallop hind pair
    // then fore pair.
    const quad = (x, z, dx, dz, y, off = 0, sx = 0, sz = 0) => [
      [x + dx, y, z + dz, 0.25 + off, 0 + off, 0.42 + off, sx, -sz], [x + dx, y, z - dz, 0.75 + off, 0.5 + off, 0.52 + off, sx, sz],
      [x - dx, y, z + dz, 0 + off, 0.5 + off, 0 + off, -sx, -sz], [x - dx, y, z - dz, 0.5 + off, 0 + off, 0.1 + off, -sx, sz],
    ];
    const hoof = (l, L2) => l.box(0.044, 0.022, 0.04, 0.008, -L2 - 0.022, 0, 0x2a2018);
    // A horse along x, standing on the ground at (x, z). A lean saddle-cloth carries the side's colour. With o.rig its
    // legs are left out and its hips are added to that list, for legs that move.
    function horse(g, x, z, coat, o = {}) {
      g.box(0.44, 0.16, 0.15, x, 0.3, z, coat);
      g.sph(0.09, x + 0.19, 0.39, z, coat, { seg: 8, rings: 6 }); g.sph(0.09, x - 0.19, 0.39, z, coat, { seg: 8, rings: 6 });
      g.box(0.08, 0.22, 0.08, x + 0.27, 0.38, z, coat, { rz: -0.55 });
      g.box(0.16, 0.07, 0.07, x + 0.38, 0.55, z, coat, { rz: -0.45 });
      if (o.rig) o.rig.push(...quad(x, z, 0.17, 0.05, 0.34, o.off || 0));
      else for (const [dx, dz] of [[0.17, 0.05], [0.17, -0.05], [-0.17, 0.05], [-0.17, -0.05]]) g.cyl(0.022, 0.018, 0.32, x + dx, 0.16, z + dz, coat, { seg: 5 });
      g.box(0.03, 0.18, 0.03, x - 0.26, 0.26, z, 0x2a2018, { rz: 0.45 });
      g.box(0.05, 0.12, 0.02, x + 0.24, 0.47, z, 0x2a2018, { rz: -0.55 });
      if (o.cloth !== false) g.box(0.24, 0.12, 0.17, x - 0.02, 0.36, z, o.cloth || A.coatR, o.armour ? { t: 0.6 } : TB);
    }
    // The legs of horses of one coat, from the hips gathered for them.
    const horseLegs = (coat, hips) => legRig('horse' + coat.toString(16), hips, GAIT.horse, 0.17, 0.15, 0.024, 0.019, coat, hoof);
    // What a rider carries, its grip at his shoulder (x, y, z): a couched lance, a sabre raised, a bow or a carbine.
    function weaponAt(g, k, x, y, z) {
      if (k === 'lance') g.cyl(0.008, 0.012, 0.9, x + 0.22, y, z, A.woodDk, { axis: 'x', seg: 5 });
      if (k === 'sword' || k === 'sabre') g.box(0.014, 0.24, 0.03, x + 0.08, y + 0.06, z, A.mail, { rz: -0.5 });
      if (k === 'bow') for (let i = -2; i <= 2; i++) g.box(0.01, 0.07, 0.01, x + 0.1 - Math.abs(i) * 0.012, y - 0.04 + i * 0.07, z - 0.01, A.woodDk, { rz: i * 0.25 });
      if (k === 'carbine') g.box(0.3, 0.016, 0.012, x + 0.1, y - 0.1, z - 0.01, A.wood);
    }
    // How each rider's weapon moves in a fight.
    const RBLOW = { lance: 'thrust', sword: 'chop', sabre: 'chop', bow: 'draw', carbine: 'shot' };
    // A rider seated on a horse at (x, z): body, head and hat, and what he carries, unless o.held takes the weapon
    // to a part of its own, adding his shoulder to that list.
    function rider(g, x, z, o) {
      const y = 0.46, c = o.cloth || A.tunic;
      g.cyl(0.055, 0.05, 0.2, x - 0.02, y + 0.12, z, c, { seg: 7 });
      if (o.vest) g.cyl(0.06, 0.056, 0.13, x - 0.02, y + 0.13, z, o.vest, { seg: 7 });
      for (const s of [-1, 1]) g.cyl(0.024, 0.02, 0.18, x + 0.02, y + 0.02, z + s * 0.07, o.legs || c, { seg: 5, rz: 0.9 });
      const hy2 = y + 0.27;
      g.sph(head * 0.5, x - 0.01, hy2, z, P.skin, { seg: 8, rings: 6, sy: 1.1 });
      if (o.hat === 'crest' || o.hat === 'knight') g.sph(head * 0.64, x - 0.01, hy2 + 0.008, z, o.hat === 'knight' ? A.mail : A.bronze, { seg: 8, rings: 5, top: !!(o.hat === 'crest'), sy: 1.1 });
      if (o.hat === 'crest') g.box(0.1, 0.04, 0.014, x - 0.02, hy2 + 0.05, z, A.coatR, TB);
      if (o.hat === 'knight') g.box(0.06, 0.06, 0.012, x - 0.02, hy2 + 0.07, z, o.plume || A.plume, TB);
      if (o.hat === 'tricorne') { g.cyl(0.08, 0.08, 0.016, x - 0.01, hy2 + 0.035, z, 0x1e1c1a, { seg: 3, ry: 0.5 }); }
      if (o.hat === 'helm') g.sph(head * 0.66, x - 0.01, hy2 + 0.01, z, A.mail, { seg: 8, rings: 5, top: true, sy: 1.2 });
      if (o.held && o.arms) o.held.push([x, y + 0.2, z - 0.06]);
      else weaponAt(g, o.arms, x, y + 0.2, z - 0.06);
      if (o.shield) g.cyl(0.08, 0.08, 0.014, x, y + 0.14, z + 0.09, o.shield, { axis: 'z', seg: 12, t: 0.5 });
    }
    // A rider's weapon as a part of its own, one for each shoulder in the list.
    const heldPart = (k, at) => { const g = G(); weaponAt(g, k, 0, 0, 0); return part('held', g, { rig: 'held', at, blow: RBLOW[k] || 'shot' }); };
    // Riders three abreast in a wedge, the leader ahead, on horses whose legs move and with weapons that strike.
    function troop(o, coat) {
      const g = G(), hips = [], held = [];
      [[0.2, 0], [-0.25, 0.3], [-0.25, -0.3]].forEach(([x, z], i) => { horse(g, x, z, coat, Object.assign({}, o, { rig: hips, off: i * 0.37 })); rider(g, x - 0.02, z, Object.assign({}, o, { held })); });
      const parts = [part('hull', g), ...horseLegs(coat, hips)];
      if (held.length) parts.push(heldPart(o.arms, held));
      parts.gait = GAIT.horse;
      return parts;
    }
    units.outrider = troop({ cloth: A.tunic, arms: 'bow', hat: 'crest', cloth2: false }, 0x8a6a4a);
    units.knight = troop({ cloth: A.mail, vest: A.coatR, hat: 'knight', arms: 'lance', shield: A.white, armour: true }, 0x5a4a3a);
    units.cuirassier = troop({ cloth: A.coatB, vest: A.mail, hat: 'helm', arms: 'sabre', legs: A.white }, 0x3a2a20);
    units.dragoon = troop({ cloth: A.coatG, hat: 'tricorne', arms: 'carbine', legs: A.white }, 0x6b4a32);

    // Wheels of wood, spoked. With a list the wheel is left out and added to it as [x, r, z, w], for wheels that roll.
    function cartWheel(g, x, z, r = 0.2, w = 0.04, list) {
      if (list) { list.push([x, r, z, w]); return; }
      g.cyl(r, r, w, x, r, z, A.woodDk, { axis: 'z', seg: 14 });
      g.cyl(r * 0.25, r * 0.25, w + 0.03, x, r, z, A.iron, { axis: 'z', seg: 8 });
      for (let i = 0; i < 4; i++) g.box(0.012, r * 1.8, w + 0.01, x, r - r * 0.9, z, A.wood, { rz: i * 0.785 });
    }
    // One wooden wheel of radius and width one, about its hub, shared by everything that rolls on them.
    const wheelGeo = (() => {
      const g = G();
      g.cyl(1, 1, 1, 0, 0, 0, A.woodDk, { axis: 'z', seg: 14 });
      g.cyl(0.25, 0.25, 1.75, 0, 0, 0, A.iron, { axis: 'z', seg: 8 });
      for (let i = 0; i < 4; i++) g.box(0.06, 1.8, 1.25, 0, -0.9, 0, A.wood, { rz: i * 0.785 });
      return g.finish();
    })();
    const wheelPart = list => part('wheels', wheelGeo, { rig: 'wheel', share: 'wheel', wheels: list });
    // An ox, stockier than a horse, with horns. With o.rig its legs are left out and its hips added to that list.
    function ox(g, x, z, o = {}) {
      g.box(0.46, 0.2, 0.2, x, 0.24, z, A.ox); g.sph(0.11, x + 0.2, 0.36, z, A.ox, { seg: 8, rings: 6 });
      g.box(0.14, 0.1, 0.1, x + 0.32, 0.32, z, A.ox, { rz: -0.3 });
      for (const s of [-1, 1]) g.cyl(0.008, 0.012, 0.1, x + 0.3, 0.42, z + s * 0.07, A.ivory, { rx: s * 1.1, seg: 4 });
      if (o.rig) o.rig.push(...quad(x, z, 0.17, 0.07, 0.3));
      else for (const [dx, dz] of [[0.17, 0.07], [0.17, -0.07], [-0.17, 0.07], [-0.17, -0.07]]) g.cyl(0.03, 0.025, 0.26, x + dx, 0.13, z + dz, A.ox, { seg: 5 });
    }
    // A load of ore that shows while it is carried.
    const oreLoad = (pts, y) => { const l = G(); for (const r of pts) l.add(new THREE.DodecahedronGeometry(r[2], 0), r[0], y, r[1], P.ore, { ry: r[0] * 7, g: 0.12 }); return l; };

    // Ox cart: an ox before a two-wheeled cart.
    {
      const b = G(), hips = [], wh = [];
      ox(b, 0.32, 0, { rig: hips });
      cartWheel(b, -0.3, 0.28, 0.2, 0.04, wh); cartWheel(b, -0.3, -0.28, 0.2, 0.04, wh);
      b.box(0.62, 0.05, 0.48, -0.3, 0.28, 0, A.wood, T);
      for (const s of [-1, 1]) b.box(0.62, 0.12, 0.03, -0.3, 0.33, s * 0.24, A.woodDk, T);
      for (const s of [-1, 1]) b.box(0.5, 0.025, 0.025, 0.12, 0.3, s * 0.12, A.woodDk);
      mark(b, 0.2, 0.3, -0.5, 0.45, 0);
      units.oxcart = [part('hull', b), ...legRig('ox', hips, GAIT.ox, 0.15, 0.13, 0.03, 0.025, A.ox, hoof), wheelPart(wh), part('load', oreLoad([[-0.42, 0.1, 0.1], [-0.2, -0.08, 0.12], [-0.3, 0.12, 0.09]], 0.4), { pivot: [0, 0, 0], load: true })];
      units.oxcart.gait = GAIT.ox;
    }
    // Ore wagon: two horses before a four-wheeled wagon.
    {
      const b = G(), h1 = [], h2 = [], wh = [];
      horse(b, 0.62, 0.12, 0x6b4a32, { cloth: false, rig: h1 }); horse(b, 0.62, -0.12, 0x3a2a20, { cloth: false, rig: h2, off: 0.5 });
      for (const x of [-0.08, -0.62]) for (const s of [-1, 1]) cartWheel(b, x, s * 0.3, 0.17, 0.04, wh);
      b.box(0.8, 0.06, 0.5, -0.35, 0.3, 0, A.wood, T);
      for (const s of [-1, 1]) b.box(0.8, 0.16, 0.03, -0.35, 0.36, s * 0.25, A.woodDk, T);
      b.box(0.03, 0.16, 0.5, 0.05, 0.36, 0, A.woodDk, T);
      mark(b, 0.2, 0.3, -0.75, 0.52, 0);
      units.wagon = [part('hull', b), ...horseLegs(0x6b4a32, h1), ...horseLegs(0x3a2a20, h2), wheelPart(wh), part('load', oreLoad([[-0.55, 0.1, 0.12], [-0.3, -0.1, 0.13], [-0.12, 0.08, 0.11], [-0.42, -0.02, 0.1]], 0.45), { pivot: [0, 0, 0], load: true })];
      units.wagon.gait = GAIT.horse;
    }
    // Supply cart: a covered wagon with the side's cross on its canvas.
    {
      const b = G(), hips = [], wh = [];
      horse(b, 0.55, 0, 0x8a6a4a, { cloth: false, rig: hips });
      for (const s of [-1, 1]) cartWheel(b, -0.3, s * 0.27, 0.2, 0.04, wh);
      b.box(0.66, 0.06, 0.46, -0.3, 0.28, 0, A.wood);
      b.cyl(0.23, 0.23, 0.62, -0.3, 0.36, 0, A.canvas, { axis: 'x', seg: 12, sy: 1.15 });
      for (const s of [-1, 1]) { b.box(0.04, 0.14, 0.012, -0.3, 0.42, s * 0.235, P.red, TB); b.box(0.14, 0.04, 0.012, -0.3, 0.47, s * 0.235, P.red, TB); }
      units.supcart = [part('hull', b), ...horseLegs(0x8a6a4a, hips), wheelPart(wh)];
      units.supcart.gait = GAIT.horse;
    }
    // Chariot: two horses and a light car with a driver and an archer.
    {
      const b = G(), h1 = [], h2 = [], wh = [], held = [];
      horse(b, 0.42, 0.13, 0x6b4a32, { rig: h1 }); horse(b, 0.42, -0.13, 0x8a6a4a, { rig: h2, off: 0.06 });
      for (const s of [-1, 1]) cartWheel(b, -0.22, s * 0.24, 0.17, 0.03, wh);
      b.box(0.26, 0.05, 0.4, -0.2, 0.26, 0, A.wood, T);
      b.prism([[-0.34, 0], [-0.34, 0.16], [-0.06, 0.2], [-0.04, 0]], 0.4, 0, 0.3, 0, A.bronze, T);
      b.box(0.5, 0.02, 0.02, 0.1, 0.3, 0, A.woodDk);
      rider(b, -0.22, 0.08, { cloth: A.linen, hat: 'crest' }); rider(b, -0.22, -0.08, { cloth: A.tunic, hat: 'crest', arms: 'bow', held });
      units.chariot = [part('hull', b), ...horseLegs(0x6b4a32, h1), ...horseLegs(0x8a6a4a, h2), wheelPart(wh), heldPart('bow', held)];
      units.chariot.gait = GAIT.horse;
    }
    // War elephant: a great beast with tusks and a howdah of archers, its cloth in the side's colour. Its legs walk
    // and its head, with trunk and tusks, swings down and up to gore.
    {
      const b = G(), hips = [];
      b.sph(0.42, 0, 0.72, 0, A.hide, { seg: 12, rings: 8, sx: 1.35, sz: 0.8 });
      hips.push(...quad(0, 0, 0.32, 0.18, 0.56));
      b.box(0.7, 0.3, 0.7, -0.05, 0.92, 0, A.coatR, TB);
      b.box(0.5, 0.2, 0.5, -0.05, 1.1, 0, A.wood, T);
      for (const [dx, dz] of [[0.2, 0.2], [0.2, -0.2], [-0.25, 0.2], [-0.25, -0.2]]) b.box(0.025, 0.24, 0.025, dx, 1.3, dz, A.woodDk);
      b.box(0.56, 0.03, 0.56, -0.05, 1.54, 0, A.canvas, T);
      b.cyl(0.04, 0.035, 0.14, -0.05, 1.37, 0.08, A.tunic, { seg: 6 }); b.sph(0.035, -0.05, 1.47, 0.08, P.skin, { seg: 6, rings: 4 });
      b.cyl(0.04, 0.035, 0.14, -0.05, 1.37, -0.1, A.linen, { seg: 6 }); b.sph(0.035, -0.05, 1.47, -0.1, P.skin, { seg: 6, rings: 4 });
      b.box(0.03, 0.18, 0.03, -0.54, 0.62, 0, 0x3a3634, { rz: 0.4 });
      // The head about its neck at (0.42, 0.84).
      const h = G(), hx = -0.42, hy0 = -0.84;
      h.sph(0.22, 0.58 + hx, 0.86 + hy0, 0, A.hide, { seg: 10, rings: 8 });
      for (const s of [-1, 1]) h.cyl(0.16, 0.16, 0.02, 0.5 + hx, 0.88 + hy0, s * 0.2, A.hide, { axis: 'z', seg: 10, sx: 0.8 });
      h.cyl(0.05, 0.03, 0.5, 0.78 + hx, 0.62 + hy0, 0, A.hide, { seg: 7, rz: 0.25 });
      for (const s of [-1, 1]) h.cyl(0.012, 0.02, 0.3, 0.76 + hx, 0.66 + hy0, s * 0.08, A.ivory, { seg: 5, rz: -1.1 });
      units.elephant = [part('hull', b), ...legRig('elephant', hips, GAIT.elephant, 0.28, 0.26, 0.09, 0.085, A.hide, (l, L2) => l.cyl(0.1, 0.1, 0.03, 0, -L2 - 0.015, 0, 0x5a5652, { seg: 8 })), part('head', h, { rig: 'head', pivot: [0.42, 0.84, 0] })];
      units.elephant.gait = GAIT.elephant;
    }
    // Catapult: a wheeled frame and a throwing arm that lies back on the frame, its cup and stone behind, and that
    // swings up against the crossbar to throw, then is winched down again and loaded.
    {
      const b = G(), wh = [];
      for (const x of [0.28, -0.3]) for (const s of [-1, 1]) cartWheel(b, x, s * 0.3, 0.14, 0.04, wh);
      for (const s of [-1, 1]) b.box(0.9, 0.06, 0.06, 0, 0.22, s * 0.24, A.wood, T);
      for (const x of [-0.36, 0.34]) b.box(0.06, 0.05, 0.54, x, 0.24, 0, A.wood);
      for (const s of [-1, 1]) b.box(0.06, 0.38, 0.05, 0.14, 0.26, s * 0.2, A.woodDk, { rz: -0.15 });
      b.box(0.06, 0.06, 0.44, 0.1, 0.62, 0, A.woodDk);
      b.cyl(0.05, 0.05, 0.44, 0.0, 0.3, 0, A.rope, { axis: 'z', seg: 8 });
      mark(b, 0.16, 0.16, 0.38, 0.29, 0);
      // The arm about the skein at (0, 0.3), lying back toward its cup.
      const a = G();
      a.box(0.54, 0.045, 0.045, -0.21, -0.0225, 0, A.wood, { rz: 0.08 });
      a.cyl(0.07, 0.05, 0.06, -0.46, -0.03, 0, A.woodDk, { seg: 8, rz: 0.08 });
      const st = G(); st.sph(0.06, -0.46, 0.03, 0, 0x9a9488, { seg: 6, rings: 4 });
      units.catapult = [part('hull', b), wheelPart(wh), part('arm', a, { rig: 'throw', pivot: [0, 0.3, 0], throw: 'catapult' }), part('stone', st, { rig: 'loaded' })];
      units.catapult.release = [0.12, 0.76];
    }
    // Trebuchet: a tall A-frame, a long arm with its sling at the back and a box of counterweight hung at the front.
    // The weight drops, the arm whips up and over to throw, and is hauled down again.
    {
      const b = G(), wh = [];
      for (const x of [0.4, -0.4]) for (const s of [-1, 1]) cartWheel(b, x, s * 0.34, 0.13, 0.04, wh);
      for (const s of [-1, 1]) { b.box(1.0, 0.07, 0.07, 0, 0.2, s * 0.28, A.wood, T); b.box(0.07, 0.95, 0.07, 0.14, 0.24, s * 0.26, A.woodDk, { rz: -0.32 }); b.box(0.07, 0.95, 0.07, -0.14, 0.24, s * 0.26, A.woodDk, { rz: 0.32 }); }
      b.cyl(0.035, 0.035, 0.6, 0, 1.08, 0, A.iron, { axis: 'z', seg: 6 });
      // The arm about the axle at (0, 1.08), its long end down at the back.
      const a = G(), th = 0.42, cs = Math.cos(th), sn = Math.sin(th);
      a.box(1.5, 0.06, 0.06, -0.25 * cs, -0.25 * sn - 0.03, 0, A.wood, { rz: th });
      const cw = G(); cw.box(0.3, 0.28, 0.3, 0, -0.33, 0, A.woodDk, T); cw.box(0.02, 0.06, 0.02, 0, -0.06, 0, A.iron); mark(cw, 0.2, 0.2, 0, -0.04, 0);
      const sl = G(); sl.box(0.02, 0.36, 0.02, 0, -0.36, 0, A.rope);
      const st = G(); st.sph(0.07, 0, -0.4, 0, 0x9a9488, { seg: 6, rings: 4 });
      units.trebuchet = [part('hull', b), wheelPart(wh), part('arm', a, { rig: 'throw', pivot: [0, 1.08, 0], throw: 'trebuchet' }),
        part('weight', cw, { rig: 'hang', at: [0.5 * cs, 0.5 * sn, 0] }), part('sling', sl, { rig: 'hang', at: [-1.0 * cs, -1.0 * sn, 0] }), part('stone', st, { rig: 'hang', at: [-1.0 * cs, -1.0 * sn, 0], loaded: true })];
      units.trebuchet.release = [0.4, 1.95];
    }
    // Cannon: a black barrel on a two-wheeled carriage with its trail on the ground. It runs back as it fires.
    {
      const b = G(), wh = [];
      for (const s of [-1, 1]) cartWheel(b, 0, s * 0.24, 0.22, 0.05, wh);
      b.box(0.8, 0.07, 0.24, -0.25, 0.14, 0, A.wood, Object.assign({ rz: 0.18 }, T));
      b.cyl(0.07, 0.085, 0.72, 0.22, 0.34, 0, 0x2a2826, { axis: 'x', seg: 12 });
      b.cyl(0.095, 0.095, 0.04, 0.58, 0.34, 0, 0x2a2826, { axis: 'x', seg: 12 });
      b.sph(0.08, -0.15, 0.34, 0, 0x2a2826, { seg: 8, rings: 6 });
      for (const [x, z] of [[-0.5, 0.18], [-0.56, 0.08]]) b.sph(0.05, x, 0.06, z, 0x2a2826, { seg: 6, rings: 4 });
      mark(b, 0.16, 0.16, -0.36, 0.26, 0, { rz: 0.18 });
      units.cannonart = [part('hull', b), wheelPart(wh)];
      units.cannonart.kick = 0.16;
    }
    // Howitzer: a short heavy barrel behind a shield on two wheels, its split trail spread on the ground.
    {
      const b = G();
      for (const s2 of [-1, 1]) { b.cyl(0.2, 0.2, 0.08, 0, 0.2, s2 * 0.3, 0x2a2826, { axis: 'z', seg: 12 }); b.cyl(0.09, 0.09, 0.09, 0, 0.2, s2 * 0.3, A.iron, { axis: 'z', seg: 8 }); }
      for (const s2 of [-1, 1]) b.box(0.8, 0.06, 0.07, -0.4, 0.12, s2 * 0.16, A.field, Object.assign({ ry: s2 * 0.2, rz: 0.12 }, T));
      b.box(0.3, 0.12, 0.5, 0, 0.26, 0, A.field, T);
      mark(b, 0.2, 0.2, -0.5, 0.2, 0, { rz: 0.12 });
      const t = G(); t.box(0.04, 0.34, 0.56, 0.16, -0.06, 0, A.field, T); t.box(0.3, 0.14, 0.2, -0.02, 0, 0, A.iron);
      const gn = G(); gn.cyl(0.05, 0.065, 0.66, 0.3, 0, 0, 0x3a3e42, { axis: 'x', seg: 10 }); gn.cyl(0.075, 0.075, 0.08, 0.64, 0, 0, 0x2a2826, { axis: 'x', seg: 10 });
      units.howitzer = [part('hull', b), part('turret', t, { pivot: [0, 0.36, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.02, 0.07, 0], tilt: 0.5, recoil: 0.08 })];
    }
    // A lorry chassis of the first motors: a cab, solid-tyred wheels and a long bed.
    function lorry(g, cab = A.field) {
      for (const x of [0.52, -0.42]) for (const s of [-1, 1]) { g.cyl(0.17, 0.17, 0.08, x, 0.17, s * 0.34, 0x2a2826, { axis: 'z', seg: 12 }); g.cyl(0.08, 0.08, 0.09, x, 0.17, s * 0.34, A.iron, { axis: 'z', seg: 8 }); }
      g.box(1.5, 0.08, 0.5, 0, 0.24, 0, 0x2a2826);
      g.box(0.36, 0.24, 0.56, 0.58, 0.3, 0, cab, T);
      g.box(0.3, 0.3, 0.58, 0.28, 0.32, 0, cab, T);
      g.box(0.02, 0.14, 0.44, 0.44, 0.44, 0, P.glass);
      g.box(0.36, 0.03, 0.62, 0.28, 0.62, 0, cab, T);
    }
    // Steam lorry: a boiler and a tall chimney behind the cab, and an ore bed.
    {
      const b = G();
      lorry(b, A.coatG);
      b.cyl(0.13, 0.13, 0.36, 0.06, 0.48, 0, 0x2a2826, { seg: 12 }); b.cyl(0.035, 0.04, 0.4, 0.06, 0.84, 0, 0x2a2826, { seg: 8 });
      b.box(0.62, 0.22, 0.56, -0.42, 0.32, 0, A.wood, T);
      mark(b, 0.3, 0.3, -0.42, 0.545, 0);
      units.lorry = [part('hull', b), part('load', oreLoad([[-0.58, 0.1, 0.13], [-0.3, -0.12, 0.14], [-0.4, 0.12, 0.11]], 0.5), { pivot: [0, 0, 0], load: true })];
    }
    // Field ambulance: a box body with the side's red cross.
    {
      const b = G();
      lorry(b, A.khaki);
      b.box(0.74, 0.42, 0.6, -0.36, 0.32, 0, A.white, T);
      for (const s of [-1, 1]) { b.box(0.06, 0.22, 0.01, -0.36, 0.42, s * 0.305, P.red, TB); b.box(0.22, 0.06, 0.01, -0.36, 0.5, s * 0.305, P.red, TB); }
      units.ambulance = [part('hull', b)];
    }
    // Trade caravans, which run goods between a side's towns: a cart, a wagon train and a covered wagon of crates,
    // bales and casks, then a lorry under a canvas tilt and a box truck. Each carries the side's mark.
    const goods = (g, x, y) => {
      g.box(0.2, 0.16, 0.18, x - 0.14, y + 0.08, -0.11, A.wood, T); g.box(0.18, 0.14, 0.16, x + 0.1, y + 0.07, 0.11, A.woodDk, T);
      g.cyl(0.08, 0.08, 0.32, x + 0.02, y + 0.2, 0, A.canvas, { axis: 'z', seg: 8 });
      g.cyl(0.07, 0.07, 0.14, x + 0.2, y + 0.08, -0.12, A.woodDk, { seg: 8 });
    };
    {
      const b = G(), hips = [], wh = [];
      horse(b, 0.55, 0, 0x8a6a4a, { cloth: false, rig: hips });
      for (const s of [-1, 1]) cartWheel(b, -0.3, s * 0.27, 0.2, 0.04, wh);
      b.box(0.66, 0.06, 0.46, -0.3, 0.28, 0, A.wood);
      goods(b, -0.32, 0.31); mark(b, 0.14, 0.2, -0.62, 0.42, 0);
      units.tradecart = [part('hull', b), ...horseLegs(0x8a6a4a, hips), wheelPart(wh)];
      units.tradecart.gait = GAIT.horse;
    }
    {
      const b = G(), h1 = [], h2 = [], wh = [];
      horse(b, 0.62, 0.12, 0x6b4a32, { cloth: false, rig: h1 }); horse(b, 0.62, -0.12, 0x3a2a20, { cloth: false, rig: h2, off: 0.5 });
      for (const x of [-0.08, -0.62]) for (const s of [-1, 1]) cartWheel(b, x, s * 0.3, 0.17, 0.04, wh);
      b.box(0.8, 0.06, 0.5, -0.35, 0.3, 0, A.wood, T);
      goods(b, -0.2, 0.33); goods(b, -0.52, 0.33); mark(b, 0.14, 0.2, -0.76, 0.45, 0);
      units.caravan = [part('hull', b), ...horseLegs(0x6b4a32, h1), ...horseLegs(0x3a2a20, h2), wheelPart(wh)];
      units.caravan.gait = GAIT.horse;
    }
    {
      const b = G(), hips = [], wh = [];
      horse(b, 0.55, 0, 0x6b4a32, { cloth: false, rig: hips });
      for (const s of [-1, 1]) cartWheel(b, -0.3, s * 0.27, 0.2, 0.04, wh);
      b.box(0.66, 0.06, 0.46, -0.3, 0.28, 0, A.wood);
      b.cyl(0.23, 0.23, 0.62, -0.3, 0.36, 0, A.canvas, { axis: 'x', seg: 12, sy: 1.15 });
      b.cyl(0.07, 0.07, 0.14, -0.68, 0.36, 0.12, A.woodDk, { seg: 8 }); mark(b, 0.12, 0.18, -0.3, 0.6, 0);
      units.tradewagon = [part('hull', b), ...horseLegs(0x6b4a32, hips), wheelPart(wh)];
      units.tradewagon.gait = GAIT.horse;
    }
    {
      const b = G();
      lorry(b, A.field);
      b.box(0.74, 0.34, 0.6, -0.36, 0.38, 0, A.canvas, T); b.cyl(0.3, 0.3, 0.74, -0.36, 0.52, 0, A.canvas, { axis: 'x', seg: 12, sy: 0.45 });
      mark(b, 0.2, 0.3, -0.36, 0.67, 0);
      units.freightlorry = [part('hull', b)];
    }
    {
      const b = G();
      lorry(b, A.khaki);
      b.box(0.8, 0.5, 0.62, -0.38, 0.4, 0, A.white, T); b.box(0.82, 0.08, 0.64, -0.38, 0.36, 0, A.khaki);
      mark(b, 0.3, 0.3, -0.38, 0.655, 0);
      units.freighter = [part('hull', b)];
    }
    // AA lorry: twin guns on a pedestal in its bed.
    {
      const b = G();
      lorry(b, A.field);
      b.box(0.7, 0.1, 0.58, -0.38, 0.32, 0, A.field, T);
      const t = G(); t.cyl(0.13, 0.15, 0.1, 0, 0, 0, A.field, T); t.box(0.14, 0.12, 0.22, 0.02, 0.08, 0, 0x3a3e42);
      const gn = G(); for (const s of [-1, 1]) gn.cyl(0.018, 0.022, 0.5, 0.25, 0, s * 0.05, 0x2a2826, { axis: 'x', seg: 6 });
      units.aalorry = [part('hull', b), part('turret', t, { pivot: [-0.38, 0.44, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.06, 0.12, 0], tilt: 0.6, recoil: 0.03 })];
    }
    // Motorcycle scouts: two bikes, one with a sidecar and a gunner.
    {
      const b = G();
      for (const [x, z, car] of [[0.18, -0.14, true], [-0.26, 0.2, false]]) {
        for (const dx of [0.22, -0.2]) b.cyl(0.11, 0.11, 0.04, x + dx, 0.11, z, 0x2a2826, { axis: 'z', seg: 12 });
        b.box(0.42, 0.1, 0.06, x, 0.22, z, A.field, T); b.box(0.12, 0.04, 0.12, x + 0.2, 0.38, z, 0x2a2826);
        b.cyl(0.05, 0.045, 0.18, x - 0.02, 0.42, z, A.khaki, { seg: 6 }); b.sph(0.04, x - 0.01, 0.56, z, P.skin, { seg: 6, rings: 4 }); b.sph(0.05, x - 0.01, 0.57, z, A.field, { seg: 6, rings: 4, top: true, sy: 0.6 });
        if (car) { b.box(0.36, 0.16, 0.18, x, 0.12, z + 0.2, A.field, T); b.cyl(0.08, 0.08, 0.03, x - 0.02, 0.1, z + 0.32, 0x2a2826, { axis: 'z', seg: 10 }); b.box(0.3, 0.02, 0.02, x + 0.18, 0.34, z + 0.2, 0x2a2826); b.cyl(0.045, 0.04, 0.14, x - 0.06, 0.34, z + 0.2, A.khaki, { seg: 6 }); b.sph(0.04, x - 0.06, 0.46, z + 0.2, P.skin, { seg: 6, rings: 4 }); }
      }
      units.motorbike = [part('hull', b)];
    }
    // Armoured car: a long bonnet, a riveted box and a round turret with its gun.
    {
      const b = G();
      for (const x of [0.46, -0.4]) for (const s of [-1, 1]) { b.cyl(0.16, 0.16, 0.08, x, 0.16, s * 0.32, 0x2a2826, { axis: 'z', seg: 12 }); b.cyl(0.07, 0.07, 0.09, x, 0.16, s * 0.32, A.iron, { axis: 'z', seg: 8 }); }
      b.box(1.3, 0.08, 0.5, 0, 0.22, 0, 0x2a2826);
      b.prism([[0.2, 0.28], [0.2, 0.46], [0.62, 0.42], [0.7, 0.3], [0.7, 0.28]], 0.42, 0, 0, 0, A.field, T);
      b.box(0.74, 0.36, 0.56, -0.18, 0.28, 0, A.field, T);
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.sph(0.012, -0.5 + i * 0.16, 0.6, s * 0.285, A.iron, { seg: 4, rings: 3 });
      mark(b, 0.3, 0.3, -0.18, 0.645, 0);
      const t = G(); t.cyl(0.19, 0.2, 0.16, 0, 0, 0, A.field, T); t.sph(0.19, 0, 0.08, 0, A.field, Object.assign({ seg: 10, rings: 5, top: true, sy: 0.4 }, T));
      const gn = G(); gn.cyl(0.02, 0.026, 0.42, 0.28, 0, 0, 0x2a2826, { axis: 'x', seg: 6 }); gn.box(0.12, 0.08, 0.1, 0.06, -0.04, 0, A.iron);
      units.armcar = [part('hull', b), part('turret', t, { pivot: [-0.18, 0.64, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.12, 0.05, 0], recoil: 0.05 })];
    }
    // Halftrack: wheels in front, tracks behind, an open bed and a gun on a pintle.
    {
      const b = G();
      for (const s of [-1, 1]) { b.cyl(0.15, 0.15, 0.08, 0.5, 0.15, s * 0.3, 0x2a2826, { axis: 'z', seg: 12 }); }
      tracks(b, 0.9, 0.7, 0, 0.24, 4);
      b.box(1.4, 0.3, 0.56, -0.05, 0.22, 0, A.field, T);
      b.prism([[0.3, 0.52], [0.66, 0.42], [0.66, 0.3], [0.3, 0.3]], 0.5, 0, 0, 0, A.field, T);
      b.box(0.02, 0.12, 0.46, 0.3, 0.52, 0, P.glass);
      mark(b, 0.3, 0.3, -0.35, 0.525, 0);
      const t = G(); t.cyl(0.04, 0.05, 0.1, 0, 0, 0, 0x2a2826); t.box(0.06, 0.12, 0.2, 0.04, 0.02, 0, A.field, T);
      const gn = G(); gn.cyl(0.014, 0.018, 0.4, 0.22, 0, 0, 0x2a2826, { axis: 'x', seg: 6 }); gn.box(0.12, 0.05, 0.05, 0.02, -0.02, 0, 0x2a2826);
      units.halftrack = [part('hull', b), part('turret', t, { pivot: [-0.1, 0.56, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.06, 0.08, 0], recoil: 0.03 })];
    }
    // Landship: the first tank, a rhomboid with its tracks running round it and guns in side sponsons.
    {
      const b = G();
      const prof = [[-1.0, 0.1], [-0.6, 0], [0.6, 0], [1.12, 0.36], [0.9, 0.72], [-0.92, 0.72], [-1.06, 0.4]];
      for (const s of [-1, 1]) { b.prism(prof, 0.16, 0, 0, s * 0.42, A.field, T); b.prism(prof.map(([x, y]) => [x * 0.98, y * 0.96 + 0.01]), 0.04, 0, 0, s * 0.51, 0x2a2826); }
      b.box(1.5, 0.5, 0.68, -0.05, 0.12, 0, A.field, T);
      b.box(0.56, 0.26, 0.4, -0.15, 0.62, 0, A.field, T);
      for (const s of [-1, 1]) { b.box(0.36, 0.26, 0.16, 0.0, 0.3, s * 0.58, A.field, T); b.cyl(0.03, 0.035, 0.42, 0.34, 0.43, s * 0.62, 0x2a2826, { axis: 'x', seg: 6 }); }
      b.cyl(0.03, 0.035, 0.32, -0.6, 0.86, 0.1, 0x2a2826, { seg: 6 });
      mark(b, 0.3, 0.3, -0.15, 0.885, 0);
      units.landship = [part('hull', b)];
    }
    // Biplane: two wings on struts, a round engine and a propeller that spins.
    {
      const b = G();
      b.cyl(0.13, 0.08, 1.2, 0, 0, 0, A.canvas, { axis: 'x', seg: 10, t: 0.4 });
      b.cyl(0.14, 0.14, 0.12, 0.6, 0, 0, 0x2a2826, { axis: 'x', seg: 10 });
      for (const y of [0.2, -0.12]) b.box(0.42, 0.03, 2.0, 0.18, y, 0, A.canvas, T);
      for (const z of [-0.8, -0.4, 0.4, 0.8]) b.box(0.02, 0.32, 0.02, 0.18, -0.1, z, A.woodDk);
      b.box(0.3, 0.03, 0.7, -0.56, 0.02, 0, A.canvas, T); b.prism([[-0.5, 0], [-0.7, 0.28], [-0.62, 0.28], [-0.42, 0]], 0.02, 0, 0, 0, A.canvas, T);
      for (const z of [-0.6, 0.6]) mark(b, 0.26, 0.26, 0.18, 0.22, z);
      const r = G(); r.box(0.02, 0.5, 0.05, 0, 0, 0, A.woodDk); r.box(0.02, 0.05, 0.5, 0, 0, 0, A.woodDk);
      units.biplane = [part('hull', b), part('rotor', r, { pivot: [0.68, 0, 0], spin: 'x', rate: 40 })];
    }

    // The future: hover pads that glow underneath, and machines in light grey with blue light.
    const pads = (g, xs, zs, y = 0.12) => { for (const x of xs) for (const z of zs) { g.cyl(0.14, 0.17, 0.06, x, y, z, A.exoDk, { seg: 10 }); g.cyl(0.12, 0.12, 0.01, x, y - 0.035, z, A.glow, { seg: 10, g: 2 }); } };
    // Hover scout: a low wedge on four pads with a small pulse turret.
    {
      const b = G();
      pads(b, [0.38, -0.36], [-0.28, 0.28]);
      b.prism([[-0.66, 0.16], [-0.6, 0.38], [0.2, 0.42], [0.72, 0.24], [0.66, 0.16]], 0.56, 0, 0, 0, A.exo, T);
      b.box(0.02, 0.1, 0.4, 0.5, 0.3, 0, A.glow, GLOW);
      mark(b, 0.3, 0.3, -0.28, 0.4, 0);
      const t = G(); t.cyl(0.13, 0.15, 0.08, 0, 0, 0, A.exoDk, T);
      const gn = G(); gn.box(0.32, 0.04, 0.06, 0.16, 0, 0, A.exoDk); gn.box(0.18, 0.012, 0.064, 0.18, 0.02, 0, A.glow, GLOW);
      units.hoverscout = [part('hull', b), part('turret', t, { pivot: [-0.1, 0.42, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.06, 0.06, 0], recoil: 0.02 })];
    }
    // Hover APC: a long hull on six pads with a pulse turret.
    {
      const b = G();
      pads(b, [0.5, 0, -0.5], [-0.32, 0.32]);
      b.prism([[-0.8, 0.16], [-0.76, 0.54], [0.3, 0.58], [0.82, 0.34], [0.78, 0.16]], 0.72, 0, 0, 0, A.exo, T);
      for (const s of [-1, 1]) b.box(0.9, 0.04, 0.02, -0.1, 0.4, s * 0.365, A.glow, GLOW);
      mark(b, 0.36, 0.36, -0.36, 0.56, 0);
      const t = G(); t.cyl(0.16, 0.18, 0.1, 0, 0, 0, A.exoDk, T); t.box(0.2, 0.1, 0.24, 0.06, 0.04, 0, A.exo, T);
      const gn = G(); gn.box(0.4, 0.05, 0.07, 0.2, 0, 0, A.exoDk); gn.box(0.22, 0.014, 0.074, 0.22, 0.03, 0, A.glow, GLOW);
      units.hoverapc = [part('hull', b), part('turret', t, { pivot: [0.0, 0.58, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.12, 0.08, 0], recoil: 0.03 })];
    }
    // Mech walker: two legs under a body that turns, a rail cannon on each arm.
    {
      const b = G();
      b.box(0.3, 0.12, 0.5, 0, 0.74, 0, A.exoDk);
      // Legs that step: a thigh from the hip, and a shin from the knee with its foot laid flat at rest.
      if (!legMakes.mech) {
        const u = G(); u.box(0.12, 0.4, 0.14, 0, -0.38, 0, A.exo, T);
        const l = G(); l.sph(0.08, 0, 0, 0, A.exoDk, { seg: 8, rings: 6 }); l.box(0.1, 0.4, 0.12, 0, -0.38, 0, A.exo, T); l.box(0.34, 0.06, 0.2, 0.04, -0.47, 0, A.exoDk, { rz: 0.2 });
        legMakes.mech = [u.finish(), l.finish()];
      }
      const legsM = legRig('mech', [[0, 0.8, 0.26, 0, 0, 0, 0, 0], [0, 0.8, -0.26, 0.5, 0.5, 0.5, 0, 0]], GAIT.mech, 0.36, 0.38);
      const t = G();
      t.box(0.6, 0.32, 0.56, -0.02, 0, 0, A.exo, T);
      t.box(0.02, 0.08, 0.36, 0.29, 0.18, 0, A.glow, GLOW);
      mark(t, 0.3, 0.3, -0.1, 0.32, 0);
      for (const s of [-1, 1]) { t.box(0.2, 0.18, 0.12, 0.04, 0.06, s * 0.36, A.exoDk); t.box(0.56, 0.05, 0.05, 0.36, 0.14, s * 0.36, A.exoDk); t.box(0.3, 0.014, 0.054, 0.4, 0.17, s * 0.36, A.glow, GLOW); }
      units.mech = [part('hull', b), ...legsM, part('turret', t, { pivot: [0, 0.82, 0], aim: true })];
      units.mech.gait = GAIT.mech;
    }
    // Titan: a four-legged walking fortress with twin rails and a pulse gun.
    {
      const b = G();
      // Four legs that step one at a time, each splayed out from under the body and its foot brought back in.
      if (!legMakes.titan) {
        const u = G(); u.box(0.18, 0.56, 0.18, 0, -0.5, 0, A.exo, T);
        const l = G(); l.box(0.14, 0.62, 0.14, 0, -0.58, 0, A.exo, T); l.box(0.3, 0.08, 0.3, 0, -0.66, 0, A.exoDk);
        legMakes.titan = [u.finish(), l.finish()];
      }
      const hipsT = quad(0, 0, 0.5, 0.46, 1.12, 0, 0.3, 0.3).map((h, i) => { h[3] = [0, 0.5, 0.75, 0.25][i]; return h; });
      const legsT = legRig('titan', hipsT, GAIT.titan, 0.5, 0.58);
      b.box(1.6, 0.42, 1.2, 0, 0.9, 0, A.exoDk);
      b.box(1.5, 0.08, 1.1, 0, 1.32, 0, A.exo, T);
      for (const s of [-1, 1]) b.box(1.4, 0.04, 0.02, 0, 1.1, s * 0.61, A.glow, GLOW);
      mark(b, 0.5, 0.5, -0.4, 1.4, 0);
      const t = G();
      t.cyl(0.42, 0.46, 0.22, 0, 0, 0, A.exo, T); t.box(0.7, 0.26, 0.6, 0.08, 0.1, 0, A.exoDk);
      t.box(0.02, 0.08, 0.4, 0.43, 0.22, 0, A.glow, GLOW);
      const gn = G(); for (const s of [-1, 1]) { gn.box(1.2, 0.08, 0.08, 0.6, 0, s * 0.16, A.exoDk); gn.box(0.8, 0.02, 0.09, 0.66, 0.05, s * 0.16, A.glow, GLOW); }
      units.titan = [part('hull', b), ...legsT, part('turret', t, { pivot: [0, 1.38, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.3, 0.18, 0], recoil: 0.08 })];
      units.titan.gait = GAIT.titan;
    }
    // Repair drone: a hovering pod with two arms and the side's cross.
    {
      const b = G();
      pads(b, [0.22, -0.22], [-0.2, 0.2], 0.16);
      b.sph(0.32, 0, 0.42, 0, A.exo, Object.assign({ seg: 12, rings: 8, sy: 0.6, sx: 1.3 }, T));
      for (const s of [-1, 1]) { b.box(0.04, 0.04, 0.3, 0.22, 0.42, s * 0.28, A.exoDk); b.box(0.12, 0.03, 0.03, 0.34, 0.4, s * 0.42, A.glow, GLOW); }
      b.box(0.06, 0.02, 0.2, 0, 0.62, 0, P.red, TB); b.box(0.2, 0.02, 0.06, 0, 0.62, 0, P.red, TB);
      units.repairbot = [part('hull', b)];
    }
    // Hauler: a hover barge with a deep bin.
    {
      const b = G();
      pads(b, [0.5, 0, -0.5], [-0.34, 0.34]);
      b.box(1.7, 0.2, 0.86, 0, 0.2, 0, A.exoDk);
      b.prism([[0.42, 0.4], [0.42, 0.86], [0.7, 0.86], [0.86, 0.56], [0.86, 0.4]], 0.8, 0, 0, 0, A.exo, T);
      b.box(0.02, 0.16, 0.6, 0.8, 0.62, 0, A.glow, GLOW);
      b.prism([[-0.86, 0.4], [-0.9, 0.86], [0.36, 0.86], [0.36, 0.4]], 0.86, 0, 0, 0, A.exo, T);
      mark(b, 0.3, 0.6, 0.56, 0.865, 0);
      units.hauler = [part('hull', b), part('load', oreLoad([[-0.6, 0.12, 0.17], [-0.3, -0.14, 0.2], [-0.04, 0.12, 0.16], [-0.42, -0.2, 0.13]], 0.86), { pivot: [0, 0, 0], load: true })];
      // Hover freighter: the hauler's barge with a sealed cargo pod on its bin.
      const c = G(); c.box(1.1, 0.36, 0.7, -0.3, 1.04, 0, A.exo, T); c.box(1.12, 0.04, 0.72, -0.3, 1.0, 0, A.glow, GLOW); mark(c, 0.3, 0.4, -0.3, 1.225, 0);
      units.hovfreight = [part('hull', b), part('pod', c)];
    }
    // Ships and boats, their waterline at 0. A hull is a plan with a pointed bow pushed up from the water, and a
    // deck laid on it; masts carry square sails that take the side's mark.
    const hull = (g, L, Wd, h, c, deck = A.wood) => {
      const plan = (k, e) => [[L / 2 - e, 0], [L / 2 - Wd * 0.9, Wd / 2 * k - e], [-L / 2 + e, Wd / 2 * 0.85 * k - e], [-L / 2 + e, -(Wd / 2 * 0.85 * k - e)], [L / 2 - Wd * 0.9, -(Wd / 2 * k - e)]];
      g.plate(plan(1, 0), h, 0, -0.08, 0, c);
      g.plate(plan(1, 0.05), 0.02, 0, h - 0.08, 0, deck);
    };
    const mast = (g, x, hgt, w, y0) => { g.cyl(0.025, 0.035, hgt, x, y0 + hgt / 2, 0, A.woodDk, { seg: 6 }); g.box(0.03, hgt * 0.55, w, x + 0.03, y0 + hgt * 0.3, 0, A.canvas, T); };
    {
      // War galley: a long low hull, a bronze ram, a bank of oars a side and one square sail.
      const b = G();
      hull(b, 2.1, 0.5, 0.22, A.wood);
      b.box(0.24, 0.07, 0.07, 1.1, -0.02, 0, A.bronze);
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.box(0.035, 0.02, 0.44, 0.55 - i * 0.24, 0.08, s * 0.42, A.woodDk, { ry: s * 0.25 });
      b.box(0.1, 0.3, 0.1, -1.0, 0.14, 0, A.woodDk);
      mast(b, 0.05, 0.9, 0.72, 0.14); mark(b, 0.3, 0.26, -0.6, 0.15, 0);
      units.galley = [part('hull', b)];
    }
    {
      // War cog: a round tubby hull with a castle at each end and one great square sail.
      const b = G();
      hull(b, 1.8, 0.7, 0.34, A.wood);
      b.box(0.42, 0.22, 0.62, 0.55, 0.26, 0, A.woodDk, T); b.box(0.5, 0.32, 0.64, -0.62, 0.26, 0, A.woodDk, T);
      mast(b, 0, 1.25, 0.86, 0.26);
      units.cog = [part('hull', b)];
    }
    {
      // Frigate: a long dark hull with a row of gunports and three masts under sail.
      const b = G();
      hull(b, 2.6, 0.72, 0.38, A.woodDk, A.wood);
      b.box(1.7, 0.07, 0.74, -0.1, 0.16, 0, 0x2a2826);
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.box(0.08, 0.06, 0.02, 0.55 - i * 0.26, 0.17, s * 0.375, A.ivory);
      mast(b, 0.75, 1.25, 0.72, 0.3); mast(b, 0, 1.5, 0.86, 0.3); mast(b, -0.78, 1.15, 0.66, 0.3);
      units.frigate = [part('hull', b)];
    }
    {
      // Ironclad: a low iron hull, an armoured casemate with a gun at each end, and a tall funnel.
      const b = G();
      hull(b, 2.4, 0.78, 0.22, P.steel, P.steelDk);
      b.plate([[0.6, 0.26], [-0.6, 0.26], [-0.8, 0], [-0.6, -0.26], [0.6, -0.26], [0.8, 0]], 0.26, -0.05, 0.14, 0, P.steel, T);
      for (const x of [0.9, -0.95]) b.cyl(0.03, 0.035, 0.46, x, 0.28, 0, P.steelDk, { axis: 'x', seg: 6 });
      b.cyl(0.09, 0.1, 0.62, -0.05, 0.62, 0, A.coal, { seg: 10 }); mark(b, 0.32, 0.3, -0.05, 0.41, 0);
      units.ironclad = [part('hull', b)];
    }
    {
      // Destroyer: a long grey hull, a bridge and mast amidships, a gun turret fore and aft and a raked funnel.
      const b = G(), grey = 0x8c9196, dark = 0x5d6267;
      hull(b, 2.9, 0.6, 0.3, grey, dark);
      b.box(0.62, 0.36, 0.42, 0.25, 0.22, 0, grey, T); b.box(0.5, 0.06, 0.44, 0.25, 0.58, 0, dark);
      b.cyl(0.02, 0.025, 0.7, 0.2, 0.9, 0, dark, { seg: 6 });
      b.cyl(0.08, 0.1, 0.42, -0.35, 0.4, 0, dark, { seg: 10, rz: 0.15 });
      for (const [x, r] of [[0.95, 1], [-0.95, -1]]) { b.cyl(0.13, 0.15, 0.12, x, 0.28, 0, grey, { seg: 10 }); b.cyl(0.022, 0.026, 0.42, x + r * 0.26, 0.31, 0, dark, { axis: 'x', seg: 6 }); }
      mark(b, 0.36, 0.3, -0.85, 0.231, 0);
      units.destroyer = [part('hull', b)];
    }
    {
      // Rail corvette: an angular composite hull, a sealed pod, a long rail gun and a strip of blue light.
      const b = G();
      b.plate([[1.4, 0], [0.4, 0.34], [-1.3, 0.3], [-1.3, -0.3], [0.4, -0.34]], 0.26, 0, -0.08, 0, A.exo);
      b.plate([[0.5, 0.2], [-0.8, 0.22], [-0.9, 0], [-0.8, -0.22], [0.5, -0.2], [0.8, 0]], 0.24, 0, 0.18, 0, A.exoDk, T);
      b.box(1.6, 0.05, 0.08, 0.35, 0.44, 0, A.exoDk); b.box(1.5, 0.02, 0.04, 0.35, 0.49, 0, A.glow, GLOW);
      b.box(0.02, 0.06, 0.62, -1.3, 0.06, 0, A.glow, GLOW); mark(b, 0.34, 0.3, -0.45, 0.425, 0);
      units.corvette = [part('hull', b)];
    }
    {
      // Fishing boats: a skiff under one sail, a two-masted smack, a steam trawler with its wheelhouse and boom,
      // and a hover trawler. Each carries a net at the stern.
      const net = (g, x, y) => g.sph(0.12, x, y, 0, A.rope, { seg: 8, rings: 5, sy: 0.6 });
      { const b = G(); hull(b, 1.0, 0.36, 0.15, A.wood); mast(b, 0.08, 0.62, 0.42, 0.1); net(b, -0.32, 0.12); mark(b, 0.16, 0.16, -0.2, 0.08, 0); units.skiff = [part('hull', b)]; }
      { const b = G(); hull(b, 1.35, 0.46, 0.2, A.coatB, A.wood); mast(b, 0.3, 0.8, 0.46, 0.14); mast(b, -0.25, 0.65, 0.4, 0.14); net(b, -0.52, 0.17); units.smack = [part('hull', b)]; }
      { const b = G(); hull(b, 1.55, 0.52, 0.24, A.coatR, A.woodDk); b.box(0.36, 0.3, 0.36, 0.2, 0.17, 0, A.white, T); b.cyl(0.05, 0.06, 0.34, 0.0, 0.5, 0, A.coal, { seg: 8 });
        b.cyl(0.02, 0.02, 0.8, -0.35, 0.45, 0, A.woodDk, { seg: 6, rz: 0.7 }); net(b, -0.6, 0.2); units.trawler = [part('hull', b)]; }
      { const b = G(); b.plate([[0.8, 0], [0.3, 0.27], [-0.7, 0.26], [-0.7, -0.26], [0.3, -0.27]], 0.2, 0, -0.06, 0, A.exo); b.box(0.36, 0.22, 0.34, 0.15, 0.14, 0, A.exoDk, T);
        b.box(0.02, 0.04, 0.5, -0.7, 0.06, 0, A.glow, GLOW); net(b, -0.45, 0.16); units.hovtrawler = [part('hull', b)]; }
    }
    // Rail artillery: a hover sled with a long rail on a turntable.
    {
      const b = G();
      pads(b, [0.42, -0.42], [-0.3, 0.3]);
      b.box(1.3, 0.24, 0.76, 0, 0.18, 0, A.exo, T);
      mark(b, 0.3, 0.3, -0.4, 0.425, 0);
      const t = G(); t.cyl(0.26, 0.3, 0.12, 0, 0, 0, A.exoDk, T);
      const gn = G(); for (const s of [-1, 1]) gn.box(1.3, 0.05, 0.05, 0.5, 0, s * 0.08, A.exoDk); gn.box(1.1, 0.016, 0.1, 0.55, 0.03, 0, A.glow, GLOW); gn.box(0.3, 0.18, 0.3, -0.1, -0.06, 0, A.exo, T);
      units.railart = [part('hull', b), part('turret', t, { pivot: [-0.1, 0.42, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0, 0.14, 0], tilt: 0.5, recoil: 0.06 })];
    }
    // Laser AA: a hover sled with a lens on a mount.
    {
      const b = G();
      pads(b, [0.38, -0.38], [-0.28, 0.28]);
      b.box(1.2, 0.24, 0.7, 0, 0.18, 0, A.exo, T);
      mark(b, 0.3, 0.3, 0.38, 0.425, 0);
      const t = G(); t.cyl(0.2, 0.24, 0.12, 0, 0, 0, A.exoDk, T); t.box(0.1, 0.3, 0.12, 0, 0.06, 0, A.exoDk);
      const gn = G(); gn.cyl(0.07, 0.1, 0.36, 0.16, 0, 0, A.exo, { axis: 'x', seg: 10 }); gn.cyl(0.06, 0.06, 0.02, 0.35, 0, 0, A.glow, { axis: 'x', seg: 10, g: 2 });
      units.laseraa = [part('hull', b), part('turret', t, { pivot: [-0.1, 0.42, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0, 0.3, 0], tilt: 0.7, recoil: 0.02 })];
    }
    // Swarm drone: three small drones flying together.
    {
      const b = G(), r = G();
      for (const [x, z] of [[0.18, 0], [-0.14, 0.2], [-0.14, -0.2]]) {
        b.box(0.12, 0.04, 0.07, x, 0.0, z, A.exoDk); b.box(0.02, 0.02, 0.02, x + 0.06, 0.03, z, A.glow, { g: 3 });
        for (const [dx, dz] of [[0.07, 0.07], [-0.07, 0.07], [0.07, -0.07], [-0.07, -0.07]]) r.cyl(0.04, 0.04, 0.004, x + dx, 0.03, z + dz, A.exo, { seg: 8 });
      }
      units.swarm = [part('hull', b), part('rotor', r, { pivot: [0, 0, 0] })];
    }
    // Gunship: a hull between two ducted fans that spin, and a chin turret.
    {
      const b = G();
      b.prism([[-0.9, 0.0], [-0.6, 0.22], [0.5, 0.24], [0.9, 0.04], [0.8, -0.12], [-0.7, -0.12]], 0.44, 0, 0, 0, A.exoDk, T);
      b.box(0.3, 0.12, 0.34, 0.5, 0.2, 0, P.glass);
      for (const s of [-1, 1]) { b.box(0.4, 0.05, 0.5, -0.05, 0.08, s * 0.4, A.exo, T); b.cyl(0.32, 0.32, 0.14, -0.05, 0.12, s * 0.8, A.exo, { seg: 14, open: true }); }
      b.prism([[-0.8, 0.1], [-1.0, 0.42], [-0.88, 0.42], [-0.62, 0.1]], 0.04, 0, 0, 0, A.exo, T);
      mark(b, 0.3, 0.3, -0.25, 0.25, 0);
      const r = G(); for (const s of [-1, 1]) { r.box(0.56, 0.01, 0.06, 0, 0, s * 0.8, A.exoDk); r.box(0.06, 0.01, 0.56, 0, 0, s * 0.8, A.exoDk); }
      const t = G(); t.sph(0.1, 0, 0, 0, A.exoDk, { seg: 8, rings: 6 }); t.box(0.3, 0.04, 0.04, 0.18, 0, 0, A.exoDk); t.box(0.16, 0.012, 0.044, 0.22, 0.02, 0, A.plasma, GLOW);
      units.gunship = [part('hull', b), part('rotor', r, { pivot: [-0.05, 0.14, 0], spin: 'y', rate: 30 }), part('turret', t, { pivot: [0.62, -0.16, 0], aim: true })];
    }
    // Stealth bomber: a dark flying wing.
    {
      const b = G();
      b.plate([[1.0, 0], [-0.4, 1.4], [-0.6, 1.2], [-0.36, 0.5], [-0.6, 0.3], [-0.6, -0.3], [-0.36, -0.5], [-0.6, -1.2], [-0.4, -1.4]], 0.08, 0, -0.04, 0, 0x3a3e44, T);
      b.prism([[-0.4, 0], [-0.2, 0.12], [0.5, 0.1], [0.8, 0.0]], 0.5, 0, 0, 0, 0x2e3236, T);
      b.box(0.24, 0.04, 0.2, 0.42, 0.08, 0, P.glass);
      for (const z of [-0.8, 0.8]) mark(b, 0.24, 0.3, -0.2, 0.045, z);
      units.stealth = [part('hull', b)];
    }

    // ---- Buildings of the older ages ---------------------------------------------------------------------------
    // Each age builds in its own stuff. The first builds in mud brick, timber and thatch, the second in stone with
    // crenels, the third in brick and earthwork bastions, and the fourth in brick, slate and corrugated iron. The
    // models keep the modern ones' footprints and moving parts, and are keyed kind@age. An age without a model of
    // its own uses the modern one.
    const B = {
      earth: 0xa48c68, earthDk: 0x988468, mud: 0xc2a27c, mudDk: 0x9a7c5c, thatch: 0xc9a85e, thatchDk: 0x8f7442,
      tile: 0xa65b3d, stone: 0xbcb5a7, stoneDk: 0x8a8478, stoneLt: 0xd8d1c3, plaster: 0xe6dcc6, slate: 0x50555c,
      brick: 0x9c5940, brickDk: 0x6e3c2c, turf: 0x8c8a5a, gravel: 0x9c9586, iron: 0x868b8f, ironDk: 0x55595d,
      cinder: 0x67635c, coal: 0x2a2826, fire: 0xffa040,
    };
    const R90 = Math.PI / 2, RT = Math.SQRT1_2;
    const bset = (kind, age, parts) => { buildings[kind + '@' + age] = parts; };
    // The ground a building stands on, its top at the pads' height.
    const yard = (g, w, d, c) => g.box(w, 0.5, d, 0, -0.42, 0, c);
    // A pitched roof h high over L by w, its ridge along x, or along z with o.alongZ.
    const gable = (g, L, w, h, x, y, z, c, o = {}) => g.prism([[-w / 2, 0], [0, h], [w / 2, 0]], L, x, y, z, c, Object.assign({ ry: o.alongZ ? 0 : R90 }, o));
    // Triangles given corner by corner, flat shaded.
    const tris = v => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3)); g.computeVertexNormals(); return g; };
    // A hipped roof h high over L by w with its ridge along x, a pyramid when L equals w.
    function hipRoof(g, L, w, h, x, y, z, c, o) {
      const r = Math.max(0, (L - w) / 2), a = [-L / 2, 0, -w / 2], b = [L / 2, 0, -w / 2], d = [L / 2, 0, w / 2], f = [-L / 2, 0, w / 2], r1 = [-r, h, 0], r2 = [r, h, 0];
      return g.add(tris([a, r2, b, a, r1, r2, d, r1, f, d, r2, r1, b, r2, d, f, r1, a]), x, y, z, c, o);
    }
    // A square stack h high tapering from w0 to w1 on a side.
    function stack(g, w0, w1, h, x, y, z, c, o) {
      const s = new THREE.CylinderGeometry(w1 * RT, w0 * RT, h, 4, 1, false, Math.PI / 4).toNonIndexed();
      s.computeVertexNormals();
      return g.add(s, x, y + h / 2, z, c, o);
    }
    // A square strut t thick from point a to point b.
    const qS = new THREE.Quaternion(), eS = new THREE.Euler(), yUp = new THREE.Vector3(0, 1, 0), dS = new THREE.Vector3();
    function strut(g, a, b, t, c, o = {}) {
      dS.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const L = dS.length();
      qS.setFromUnitVectors(yUp, dS.normalize()); eS.setFromQuaternion(qS, 'XYZ');
      return g.box(t, L, t, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - L / 2, (a[2] + b[2]) / 2, c, Object.assign({ rx: eS.x, ry: eS.y, rz: eS.z }, o));
    }
    const along = (x0, z0, x1, z1) => -Math.atan2(z1 - z0, x1 - x0);
    // A wall h high and t thick from (x0, z0) to (x1, z1).
    const wall = (g, x0, z0, x1, z1, h, t, c, y = 0.08) => g.box(Math.hypot(x1 - x0, z1 - z0), h, t, (x0 + x1) / 2, y, (z0 + z1) / 2, c, { ry: along(x0, z0, x1, z1) });
    // Merlons along a wall's top from y, s on a side.
    function merlons(g, x0, z0, x1, z1, y, c, s = 0.14) {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / (s * 2))), ry = along(x0, z0, x1, z1);
      for (let i = 0; i < n; i++) { const k = (i + 0.5) / n; g.box(s, s, s * 1.1, x0 + (x1 - x0) * k, y, z0 + (z1 - z0) * k, c, { ry }); }
    }
    // Merlons round a rectangle's top, and round a tower's.
    function crenRect(g, x, z, w, d, y, c, s) {
      const a = [x - w / 2, z - d / 2], b = [x + w / 2, z - d / 2], e2 = [x + w / 2, z + d / 2], f = [x - w / 2, z + d / 2];
      for (const [p, q2] of [[a, b], [b, e2], [e2, f], [f, a]]) merlons(g, p[0], p[1], q2[0], q2[1], y, c, s);
    }
    function crenRing(g, x, z, r, y, c, n = 8, s = 0.13) {
      for (let i = 0; i < n; i++) { const a = i / n * 6.283; g.box(s, s, s * 1.2, x + Math.cos(a) * r, y, z + Math.sin(a) * r, c, { ry: -a }); }
    }
    // A palisade of pointed stakes from (x0, z0) to (x1, z1), cut as one board.
    function palisade(g, x0, z0, x1, z1, h = 0.56, c = A.wood) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 0.13)), s = L / n, pts = [[-L / 2, 0], [L / 2, 0]];
      for (let i = n; i > 0; i--) { const x = -L / 2 + i * s; pts.push([x, h], [x - s / 2, h + 0.11]); }
      pts.push([-L / 2, h]);
      g.prism(pts, 0.09, (x0 + x1) / 2, 0.04, (z0 + z1) / 2, c, { ry: along(x0, z0, x1, z1) });
    }
    // A post and rail fence.
    function fence(g, x0, z0, x1, z1, h = 0.36, c = A.wood) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 0.5)), ry = along(x0, z0, x1, z1);
      for (let i = 0; i <= n; i++) g.box(0.05, h, 0.05, x0 + (x1 - x0) * i / n, 0.08, z0 + (z1 - z0) * i / n, c, { ry });
      for (const k of [0.45, 0.85]) g.box(L, 0.035, 0.03, (x0 + x1) / 2, 0.08 + h * k, (z0 + z1) / 2, c, { ry });
    }
    // A pole with a pennant, or with a flag, in the side's colour, flying toward +x.
    function pennant(g, x, y, z, h = 0.8, L = 0.36) {
      g.cyl(0.013, 0.017, h, x, y + h / 2, z, A.woodDk, { seg: 5 });
      g.prism([[0, -0.07], [L, 0], [0, 0.07]], 0.014, x, y + h - 0.09, z, P.white, TB);
    }
    function flagpole(g, x, y, z, h = 1.2, w = 0.46, fh = 0.3, pole = A.woodDk) {
      g.cyl(0.014, 0.02, h, x, y + h / 2, z, pole, { seg: 5 });
      g.box(w, fh, 0.014, x + w / 2 + 0.015, y + h - fh - 0.02, z, P.white, TB);
    }
    // A cloth in the side's colour hung flat on a wall facing +x, or +z with faceZ, its top at y.
    const hang = (g, x, y, z, w, h, faceZ) => faceZ ? g.box(w, h, 0.016, x, y - h, z, P.white, TB) : g.box(0.016, h, w, x, y - h, z, P.white, TB);
    // A row of n dark openings across w, along x on a face at z, or along z on a face at x with alongZ.
    function slots(g, x, y, z, w, h, n, alongZ, ww = 0.1, c = B.coal) {
      for (let i = 0; i < n; i++) { const u = ((i + 0.5) / n - 0.5) * w; if (alongZ) g.box(0.02, h, ww, x, y, z + u, c); else g.box(ww, h, 0.02, x + u, y, z, c); }
    }
    // Corrugation as ribs down both slopes of a gable roof, its ridge along x, or along z with alongZ.
    function ribs(g, L, w, h, x, y, z, c, alongZ, step = 0.13) {
      const a = Math.atan2(h, w / 2), s = Math.hypot(h, w / 2), n = Math.round(L / step);
      for (let i = 0; i < n; i++) {
        const u = -L / 2 + (i + 0.5) * L / n;
        for (const k of [-1, 1]) {
          if (alongZ) g.box(s, 0.022, 0.022, x + k * w / 4, y + h / 2 + 0.006, z + u, c, { rz: -k * a });
          else g.box(0.022, 0.022, s, x + u, y + h / 2 + 0.006, z + k * w / 4, c, { rx: k * a });
        }
      }
    }
    // A half barrel of corrugated iron along x on the ground, with its hoops.
    function ironHut(g, x, z, r, L, hoops = 6) {
      g.add(new THREE.CylinderGeometry(r, r, L, 12, 1, false, 0, Math.PI), x, 0.08, z, B.iron, { rz: R90 });
      for (let i = 0; i < hoops; i++) g.add(new THREE.TorusGeometry(r + 0.008, 0.012, 3, 10, Math.PI), x - L / 2 + 0.1 + i * (L - 0.2) / (hoops - 1), 0.08, z, B.ironDk, { ry: R90 });
      g.box(0.02, r * 0.85, r * 0.7, x + L / 2 + 0.01, 0.08, z, A.woodDk);
    }
    // A water tower of four iron legs, a riveted tank and a shallow cone of a roof.
    function waterTower(g, x, z, h = 1.3, r = 0.3) {
      const q2 = r * 0.62;
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(0.05, h, 0.05, x + dx * q2, 0.08, z + dz * q2, B.ironDk);
      for (const k of [-1, 1]) { g.box(q2 * 2, 0.03, 0.03, x, 0.08 + h * 0.5, z + k * q2, B.ironDk); g.box(0.03, 0.03, q2 * 2, x + k * q2, 0.08 + h * 0.5, z, B.ironDk); }
      g.cyl(r, r, r * 1.3, x, 0.08 + h + r * 0.65, z, B.iron, { seg: 12 });
      g.cyl(r * 1.03, r * 1.03, 0.03, x, 0.08 + h + r * 0.4, z, B.ironDk, { seg: 12 });
      g.cyl(0, r * 1.08, r * 0.45, x, 0.08 + h + r * 1.3 + r * 0.225, z, B.ironDk, { seg: 12 });
    }
    // A round brick chimney h tall with a dark band at its head.
    function chimney(g, x, z, h, r = 0.14, y = 0.08) {
      g.cyl(r * 0.78, r, h, x, y + h / 2, z, B.brick, { seg: 10 });
      g.cyl(r * 0.84, r * 0.84, 0.12, x, y + h - 0.1, z, B.coal, { seg: 10 });
    }
    // Wicker baskets of earth, along a line from (x0, z0) to (x1, z1).
    function gabions(g, x0, z0, x1, z1, y, n) {
      for (let i = 0; i < n; i++) { const k = (i + 0.5) / n; g.cyl(0.085, 0.085, 0.22, x0 + (x1 - x0) * k, y + 0.11, z0 + (z1 - z0) * k, B.thatchDk, { seg: 7 }); }
    }
    // A water wheel of two rims, spokes and paddles on an axle along z.
    function waterWheel(r = 0.48, w = 0.16) {
      const g = G();
      for (const k of [-1, 1]) g.add(new THREE.TorusGeometry(r, 0.025, 4, 16), 0, 0, k * w / 2, A.woodDk);
      for (let i = 0; i < 4; i++) g.box(r * 2, 0.03, w, 0, -0.015, 0, A.wood, { rz: i * Math.PI / 4 });
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; g.box(0.16, 0.03, w + 0.04, Math.cos(a) * r, Math.sin(a) * r - 0.015, 0, A.wood, { rz: a }); }
      g.cyl(0.05, 0.05, w + 0.16, 0, 0, 0, B.ironDk, { axis: 'z', seg: 8 });
      return g;
    }
    // A soldier standing at (x, y, z) facing ry, at the units' scale.
    function figureInto(g, o, x, y, z, ry = 0, s = 1.25) {
      const [b, l] = soldierGeo(o), c = Math.cos(ry), sn = Math.sin(ry);
      g.merge(b, x, y, z, ry, s);
      for (const k of [-1, 1]) { const lz = k * 0.042 * s; g.merge(l, x + lz * sn, y + 0.31 * s, z + lz * c, ry, s); }
    }
    // A horse standing at (x, y, z) facing ry, in the side's saddle-cloth unless o.cloth is false.
    function horseInto(g, x, y, z, ry, coat, o = {}) { const h = G(); horse(h, 0, 0, coat, o); g.merge(h, x, y, z, ry, 1.25); }
    const ore = (g, list) => { for (const [x, z, r] of list) g.add(new THREE.DodecahedronGeometry(r, 0), x, 0.08 + r * 0.6, z, P.ore, { ry: x * 7 + z * 3, g: 0.12 }); };
    const bolt = () => { const g = G(); g.cyl(0.012, 0.012, 0.7, 0.1, 0, 0, A.woodDk, { axis: 'x', seg: 5 }); g.cyl(0, 0.026, 0.09, 0.49, 0, 0, A.iron, { rz: -R90, seg: 5 }); g.box(0.1, 0.05, 0.005, -0.22, 0, 0, A.linen); return g; };

    // Headquarters ----------------------------------------------------------------------------------------------
    // Citadel, a mud-brick enceinte with stepped merlons and a gate between towers, a palace on its terrace under a
    // tiled roof with a frieze in the side's colour, a tower over it with the standard, and two granaries.
    {
      const b = G();
      yard(b, 5, 5, B.earth);
      const E = 2.15, gt = 0.42;
      for (const [x0, z0, x1, z1] of [[-E, -E, E, -E], [-E, E, E, E], [-E, -E, -E, E], [E, -E, E, -gt], [E, gt, E, E]]) { wall(b, x0, z0, x1, z1, 0.5, 0.18, B.mud); merlons(b, x0, z0, x1, z1, 0.58, B.mud, 0.15); }
      for (const [x, z] of [[-E, -E], [E, -E], [E, E], [-E, E]]) { b.box(0.52, 0.8, 0.52, x, 0.08, z, B.mud); b.box(0.6, 0.06, 0.6, x, 0.88, z, B.mudDk); }
      for (const k of [-1, 1]) { b.box(0.5, 1.0, 0.46, E, 0.08, k * (gt + 0.2), B.mud); b.box(0.56, 0.06, 0.52, E, 1.08, k * (gt + 0.2), B.mudDk); pennant(b, E + 0.1, 1.14, k * (gt + 0.2), 0.55, 0.3); }
      b.box(0.26, 0.14, gt * 2 + 0.2, E, 0.7, 0, A.woodDk);
      b.box(3.0, 0.34, 2.8, -0.45, 0.08, 0, B.mudDk);
      b.prism([[0, 0], [0, 0.34], [0.5, 0]], 0.9, 1.05, 0.08, 0, B.mud);
      b.box(2.0, 0.76, 1.8, -0.55, 0.42, 0, B.mud);
      b.box(2.04, 0.1, 1.84, -0.55, 1.04, 0, P.white, TB);
      for (let i = 0; i < 4; i++) b.cyl(0.05, 0.06, 0.76, 0.66, 0.8, -0.66 + i * 0.44, A.wood, { seg: 6 });
      b.box(0.42, 0.06, 1.9, 0.66, 1.18, 0, A.woodDk);
      b.box(0.03, 0.5, 0.36, 0.46, 0.42, 0, A.woodDk);
      hipRoof(b, 2.5, 2.2, 0.55, -0.45, 1.18, 0, B.tile);
      b.box(0.8, 1.9, 0.8, -1.55, 0.42, -1.05, B.mud);
      crenRect(b, -1.55, -1.05, 0.8, 0.8, 2.32, B.mud, 0.14);
      flagpole(b, -1.55, 2.32, -1.05, 0.8, 0.5, 0.3);
      for (const z of [-1.35, 1.35]) { b.cyl(0.34, 0.36, 0.5, 1.35, 0.33, z, B.mud, { seg: 10 }); b.cyl(0, 0.46, 0.42, 1.35, 0.79, z, B.thatch, { seg: 10 }); }
      bset('hq', 1, [part('body', b)]);
    }
    // Castle, crenellated curtain walls, round towers under conical roofs, a gatehouse, a keep with corner turrets
    // hung with the side's banners, and a hall against the wall.
    {
      const b = G();
      yard(b, 5, 5, B.earthDk);
      const E = 2.0, gt = 0.5;
      for (const [x0, z0, x1, z1] of [[-E, -E, E, -E], [-E, E, E, E], [-E, -E, -E, E], [E, -E, E, -gt], [E, gt, E, E]]) { wall(b, x0, z0, x1, z1, 0.8, 0.24, B.stone); merlons(b, x0, z0, x1, z1, 0.88, B.stone, 0.14); }
      for (const [x, z] of [[-E, -E], [E, -E], [E, E], [-E, E]]) {
        b.cyl(0.4, 0.44, 1.2, x, 0.68, z, B.stone, { seg: 12 });
        b.cyl(0.47, 0.47, 0.08, x, 1.32, z, B.stoneDk, { seg: 12 });
        b.cyl(0, 0.5, 0.9, x, 1.81, z, B.slate, { seg: 12 });
      }
      pennant(b, E, 2.2, E, 0.42, 0.3); pennant(b, -E, 2.2, -E, 0.42, 0.3);
      b.box(0.8, 1.3, 1.5, E, 0.08, 0, B.stone);
      crenRect(b, E, 0, 0.8, 1.5, 1.38, B.stone, 0.14);
      b.box(0.03, 0.56, 0.5, E + 0.41, 0.08, 0, A.woodDk);
      slots(b, E + 0.41, 0.85, 0, 1.0, 0.22, 2, true, 0.05);
      const kx = -0.55, kz = -0.25, ks = 1.7, kh = 2.1;
      b.box(ks, kh, ks, kx, 0.08, kz, B.stoneLt);
      b.box(ks + 0.08, 0.08, ks + 0.08, kx, 0.08 + kh - 0.06, kz, B.stoneDk);
      crenRect(b, kx, kz, ks, ks, 0.1 + kh, B.stoneLt, 0.15);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = kx + dx * ks / 2, z = kz + dz * ks / 2;
        b.cyl(0.17, 0.17, 0.5, x, 0.08 + kh + 0.2, z, B.stoneLt, { seg: 8 });
        b.cyl(0, 0.21, 0.5, x, 0.08 + kh + 0.7, z, B.slate, { seg: 8 });
      }
      for (const y of [0.7, 1.4]) { slots(b, kx + ks / 2 + 0.01, y, kz, 1.0, 0.24, 2, true, 0.05); slots(b, kx, y, kz + ks / 2 + 0.01, 1.0, 0.24, 2, false, 0.05); }
      hang(b, kx + ks / 2 + 0.012, 1.9, kz, 0.34, 0.66); hang(b, kx, 1.9, kz + ks / 2 + 0.012, 0.34, 0.66, true);
      flagpole(b, kx, 0.08 + kh, kz, 0.95, 0.56, 0.34);
      b.box(2.3, 0.72, 0.8, 0.15, 0.08, 1.4, B.plaster);
      for (let i = 0; i < 6; i++) b.box(0.05, 0.72, 0.02, -0.9 + i * 0.42, 0.08, 1.0, A.woodDk);
      gable(b, 2.4, 1.0, 0.5, 0.15, 0.8, 1.4, B.slate);
      bset('hq', 2, [part('body', b)]);
    }
    // Fort, a star of brick-faced ramparts with a bastion at each corner and a gun on each, a gate and its ramp,
    // the commandant's house under slate, a vaulted magazine, and a tall flag.
    {
      const b = G();
      yard(b, 5, 5, B.turf);
      const q4 = [[1.4, 0.8], [1.7, 0.8], [2.36, 2.36], [0.8, 1.7], [0.8, 1.4]], star = [];
      for (let k = 0; k < 4; k++) for (const [x, z] of q4) { let px = x, pz = z; for (let i = 0; i < k; i++) [px, pz] = [-pz, px]; star.push([px, pz]); }
      b.plate(star, 0.42, 0, 0.08, 0, B.brick);
      b.plate(star.map(([x, z]) => [x * 0.97, z * 0.97]), 0.06, 0, 0.5, 0, B.turf);
      for (let i = 0; i < star.length; i++) { const [x0, z0] = star[i], [x1, z1] = star[(i + 1) % star.length]; wall(b, x0 * 0.92, z0 * 0.92, x1 * 0.92, z1 * 0.92, 0.14, 0.1, B.earth, 0.56); }
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * R90, c = Math.cos(a), s2 = Math.sin(a);
        b.box(0.3, 0.1, 0.22, c * 2.3, 0.56, s2 * 2.3, A.wood, { ry: -a });
        b.cyl(0.065, 0.05, 0.5, c * 2.6, 0.72, s2 * 2.6, B.coal, { axis: 'x', seg: 8, ry: -a });
      }
      b.box(0.34, 0.64, 0.8, 1.42, 0.08, 0, B.brickDk);
      b.box(0.03, 0.4, 0.4, 1.6, 0.08, 0, A.woodDk);
      b.prism([[0, 0], [0, 0.42], [0.85, 0]], 0.56, 1.6, 0.08, 0, A.wood);
      b.box(1.7, 0.66, 1.1, -0.35, 0.56, -0.2, B.plaster);
      hipRoof(b, 1.86, 1.26, 0.45, -0.35, 1.22, -0.2, B.slate);
      slots(b, 0.51, 0.84, -0.2, 0.8, 0.24, 3, true, 0.12);
      slots(b, -0.35, 0.84, 0.36, 1.3, 0.24, 4, false, 0.12);
      for (const x of [-0.85, 0.15]) b.box(0.14, 0.34, 0.2, x, 1.4, -0.2, B.brick);
      b.box(0.8, 0.4, 0.6, -0.5, 0.56, 1.0, B.brick);
      b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 10, 1, false, 0, Math.PI), -0.5, 0.96, 1.0, B.brick, { rz: R90 });
      flagpole(b, 0.9, 0.56, -1.0, 1.7, 0.66, 0.4, B.stoneDk);
      bset('hq', 3, [part('body', b)]);
    }
    // Headquarters of the first industrial wars, a brick block of two storeys under a hipped slate roof, a clock
    // tower with the flag, a lower wing, chimneys and railings.
    {
      const b = G();
      yard(b, 5, 5, B.cinder);
      b.box(2.0, 1.26, 3.6, -0.5, 0.08, 0, B.brick);
      b.box(2.06, 0.06, 3.66, -0.5, 0.68, 0, B.stoneLt);
      b.box(2.1, 0.08, 3.7, -0.5, 1.3, 0, B.stoneLt);
      for (const y of [0.22, 0.84]) {
        windows(b, 0.51, y, 0, 3.3, 0.3, 8, 'z', { g: 0.35 });
        for (const k of [-1, 1]) windows(b, -0.5, y, k * 1.81, 1.7, 0.3, 4, 'x', { g: 0.35 });
      }
      hipRoof(b, 3.8, 2.2, 0.62, -0.5, 1.38, 0, B.slate, { ry: R90 });
      for (const z of [-1.3, 0, 1.3]) b.box(0.22, 0.6, 0.36, -0.5, 1.6, z, B.brickDk);
      b.box(1.0, 0.72, 2.4, -1.95, 0.08, 0, B.brick);
      gable(b, 2.5, 1.1, 0.4, -1.95, 0.8, 0, B.slate, { alongZ: true });
      b.box(0.8, 2.3, 0.8, 0.72, 0.08, 0, B.brick);
      b.box(0.86, 0.08, 0.86, 0.72, 2.38, 0, B.stoneLt);
      b.cyl(0.24, 0.24, 0.03, 1.13, 1.95, 0, B.plaster, { axis: 'x', seg: 16 });
      b.cyl(0.24, 0.24, 0.03, 0.72, 1.95, 0.41, B.plaster, { axis: 'z', seg: 16 });
      hipRoof(b, 0.9, 0.9, 0.7, 0.72, 2.46, 0, B.slate);
      flagpole(b, 0.72, 3.0, 0, 0.9, 0.6, 0.36, B.ironDk);
      b.box(0.03, 0.62, 0.4, 1.13, 0.08, 0, A.woodDk);
      b.box(0.03, 0.16, 0.62, 1.135, 0.8, 0, P.white, TB);
      for (const k of [-1, 1]) {
        b.box(0.03, 0.05, 1.8, 2.25, 0.42, k * 1.3, B.ironDk);
        for (let i = 0; i < 7; i++) b.box(0.025, 0.4, 0.025, 2.25, 0.08, k * (0.5 + i * 0.27), B.ironDk);
        b.box(0.16, 0.62, 0.16, 2.25, 0.08, k * 0.42, B.stoneLt);
      }
      bset('hq', 4, [part('body', b)]);
    }

    // Refineries ------------------------------------------------------------------------------------------------
    // Smelter of the first ages, clay furnaces glowing at their mouths, a thatched shed on posts over the casting
    // floor, a charcoal heap, and ore piled in the yard where the carts tip.
    {
      const b = G();
      yard(b, 4, 4, B.earth);
      for (const [x, z, s] of [[-1.2, -1.15, 1], [-0.35, -1.25, 0.8]]) {
        b.cyl(0.18 * s, 0.34 * s, 0.95 * s, x, 0.08 + 0.475 * s, z, B.mud, { seg: 10 });
        b.cyl(0.15 * s, 0.15 * s, 0.03, x, 0.08 + 0.95 * s, z, B.fire, { seg: 8, g: 1.6 });
        b.box(0.06, 0.16 * s, 0.16 * s, x + 0.33 * s, 0.08, z, B.fire, { g: 2 });
      }
      for (const x of [-1.7, -0.75, 0.2]) for (const z of [0.15, 1.45]) b.cyl(0.04, 0.05, 0.9, x, 0.53, z, A.wood, { seg: 6 });
      gable(b, 2.3, 1.7, 0.62, -0.75, 0.98, 0.8, B.thatch);
      b.box(0.9, 0.3, 0.4, -1.0, 0.08, 0.8, A.woodDk);
      for (let i = 0; i < 5; i++) b.box(0.12, 0.05, 0.22, -1.32 + i * 0.16, 0.38, 0.8, A.bronze);
      wall(b, -1.9, -1.88, 0.5, -1.88, 0.36, 0.16, B.mud);
      b.cyl(0, 0.46, 0.4, 0.95, 0.28, 1.3, B.coal, { seg: 10 });
      ore(b, [[1.0, -1.0, 0.24], [1.3, -0.8, 0.2], [1.15, -1.3, 0.18], [0.75, -1.25, 0.16], [1.45, -1.2, 0.15]]);
      flagpole(b, 0.5, 0.08, -1.7, 1.3, 0.44, 0.28);
      pennant(b, -1.85, 1.6, 0.8, 0.5, 0.3);
      bset('refinery', 1, [part('body', b)]);
    }
    // Medieval smelter, a stone furnace house under tiles with its stack, a water wheel that works the bellows, a
    // timber-framed workshop under thatch, and the ore yard.
    {
      const b = G();
      yard(b, 4, 4, B.earthDk);
      b.box(1.7, 0.9, 1.3, -0.95, 0.08, -0.75, B.stone);
      gable(b, 1.85, 1.5, 0.55, -0.95, 0.98, -0.75, B.tile);
      stack(b, 0.62, 0.4, 1.95, -1.45, 0.08, -1.05, B.stoneDk);
      b.box(0.04, 0.24, 0.28, -0.09, 0.08, -1.05, B.fire, { g: 2 });
      b.box(0.04, 0.5, 0.34, -0.09, 0.08, -0.45, A.woodDk);
      b.box(1.0, 0.1, 0.2, -1.5, 1.0, 0.08, A.wood);
      b.box(0.08, 0.92, 0.08, -1.95, 0.08, 0.08, A.woodDk);
      b.box(1.5, 0.62, 0.9, -0.9, 0.08, 1.25, B.plaster);
      for (let i = 0; i < 5; i++) b.box(0.05, 0.62, 0.02, -1.6 + i * 0.35, 0.08, 0.79, A.woodDk);
      b.box(1.5, 0.05, 0.02, -0.9, 0.38, 0.79, A.woodDk);
      gable(b, 1.65, 1.1, 0.6, -0.9, 0.7, 1.25, B.thatch);
      ore(b, [[1.0, -1.0, 0.24], [1.3, -0.75, 0.2], [1.2, -1.3, 0.18], [0.8, -1.3, 0.16]]);
      b.cyl(0, 0.4, 0.36, 1.25, 0.26, 1.35, B.coal, { seg: 10 });
      pennant(b, -0.95, 1.53, -0.15, 0.55, 0.32);
      flagpole(b, 0.6, 0.08, 1.6, 1.3, 0.44, 0.28);
      bset('refinery', 2, [part('body', b), part('wheel', waterWheel(0.48, 0.16), { pivot: [-1.0, 0.56, 0.08], spin: 'z', rate: 1.1 })]);
    }
    // Gunpowder smelter, a tapering stone blast furnace glowing at its throat, the charging bridge, a casting shed
    // under tiles, a water wheel for the bellows, a charcoal barn and pigs of iron in the yard.
    {
      const b = G();
      yard(b, 4, 4, B.gravel);
      stack(b, 1.3, 0.8, 1.6, -1.0, 0.08, -0.75, B.stone);
      b.box(0.86, 0.34, 0.86, -1.0, 1.68, -0.75, B.brick);
      b.cyl(0.22, 0.22, 0.04, -1.0, 2.04, -0.75, B.fire, { seg: 8, g: 1.4 });
      b.box(0.04, 0.32, 0.3, -0.33, 0.08, -0.75, B.fire, { g: 2 });
      b.box(0.36, 0.08, 0.95, -1.0, 1.68, -1.6, A.wood);
      for (const z of [-1.4, -1.85]) b.box(0.08, 1.6, 0.08, -1.0, 0.08, z, A.woodDk);
      for (const [x, z] of [[-0.4, -1.4], [0.6, -1.4], [-0.4, -0.1], [0.6, -0.1]]) b.box(0.07, 0.72, 0.07, x, 0.08, z, A.woodDk);
      gable(b, 1.5, 1.2, 0.42, 0.1, 0.8, -0.75, B.tile, { alongZ: true });
      b.box(1.3, 0.55, 0.85, -0.9, 0.08, 1.35, B.plaster);
      gable(b, 1.45, 1.05, 0.45, -0.9, 0.63, 1.35, B.tile);
      b.box(0.9, 0.1, 0.2, -1.55, 0.98, 0.12, A.wood);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4 - i; j++) b.box(0.42, 0.06, 0.08, 0.95, 0.08 + i * 0.06, 0.95 + j * 0.1 + i * 0.05, B.ironDk);
      ore(b, [[1.15, -1.0, 0.22], [1.4, -0.75, 0.2], [1.3, -1.3, 0.17], [0.9, -1.35, 0.15]]);
      flagpole(b, 1.6, 0.08, 1.6, 1.35, 0.46, 0.3);
      bset('refinery', 3, [part('body', b), part('wheel', waterWheel(0.46, 0.16), { pivot: [-1.0, 0.54, 0.12], spin: 'z', rate: 1.2 })]);
    }
    // Industrial refinery, a brick crusher hall under corrugated iron with its name board, two tall chimneys, a
    // riveted ore bin on legs, an incline down to the cobbled dock, and a water tower.
    {
      const b = G();
      yard(b, 4, 4, B.cinder);
      b.box(1.7, 1.1, 2.0, -0.8, 0.08, 0.4, B.brick);
      gable(b, 2.1, 1.86, 0.5, -0.8, 1.18, 0.4, B.iron, { alongZ: true });
      ribs(b, 2.1, 1.86, 0.5, -0.8, 1.18, 0.4, B.ironDk, true);
      windows(b, 0.06, 0.5, 0.4, 1.7, 0.3, 5, 'z', { g: 0.3 });
      b.box(0.03, 0.18, 1.1, 0.07, 0.88, 0.4, P.white, TB);
      chimney(b, -1.5, -1.45, 2.8, 0.17); chimney(b, -0.95, -1.55, 2.2, 0.13);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(0.06, 0.6, 0.06, 0.25 + dx * 0.3, 0.08, -1.2 + dz * 0.3, B.ironDk);
      b.cyl(0.42, 0.42, 0.6, 0.25, 0.98, -1.2, B.iron, { seg: 12 });
      b.cyl(0.42, 0.1, 0.3, 0.25, 0.53, -1.2, B.iron, { seg: 12 });
      b.box(0.86, 0.03, 0.86, 0.25, 1.28, -1.2, B.ironDk);
      b.box(1.8, 0.1, 0.5, 0.85, 0.8, 0.4, B.ironDk, { rz: -0.42 });
      b.box(1.6, 0.03, 0.4, 0.85, 0.87, 0.4, P.ore, { rz: -0.42 });
      for (const x of [0.5, 1.1]) b.box(0.08, 0.8 - x * 0.4, 0.08, x, 0.08, 0.4, A.woodDk);
      b.box(1.2, 0.03, 1.5, 1.2, 0.08, 0.4, B.gravel);
      waterTower(b, 1.4, -1.3, 1.1, 0.28);
      bset('refinery', 4, [part('body', b)]);
    }

    // Barracks --------------------------------------------------------------------------------------------------
    // Barracks of the first ages, a mud-brick longhouse under thatch hung with the side's shields, a palisaded
    // drill yard with a spear rack and an archery butt, and a standard.
    {
      const b = G();
      yard(b, 3, 3, B.earth);
      b.box(2.3, 0.55, 1.1, -0.25, 0.08, -0.6, B.mud);
      gable(b, 2.5, 1.4, 0.72, -0.25, 0.63, -0.6, B.thatch);
      b.box(0.34, 0.44, 0.03, 0.15, 0.08, -0.04, A.woodDk);
      for (const x of [-1.0, -0.55, 0.62]) b.cyl(0.11, 0.11, 0.02, x, 0.38, -0.04, P.white, { axis: 'z', seg: 10, t: 1 });
      palisade(b, -1.4, 1.38, 1.0, 1.38); palisade(b, -1.4, 0.05, -1.4, 1.38);
      for (const z of [0.5, 1.0]) b.box(0.05, 0.5, 0.05, 0.4, 0.08, z, A.woodDk);
      b.box(0.04, 0.04, 0.56, 0.4, 0.5, 0.75, A.woodDk);
      for (let i = 0; i < 4; i++) b.cyl(0.01, 0.012, 0.8, 0.33, 0.47, 0.56 + i * 0.13, A.wood, { seg: 4, rz: 0.15 });
      for (const z of [0.66, 0.84]) b.box(0.04, 0.32, 0.04, 1.08, 0.08, z, A.woodDk);
      b.cyl(0.2, 0.2, 0.14, 1.05, 0.48, 0.75, B.thatch, { axis: 'x', seg: 12 });
      flagpole(b, 1.2, 0.08, -1.2, 1.35, 0.46, 0.3);
      bset('barracks', 1, [part('body', b)]);
    }
    // Medieval barracks, a hall of stone below and timber frame above under a steep tiled roof, the side's
    // banners on it, a tilting yard with a quintain, and a pennant.
    {
      const b = G();
      yard(b, 3, 3, B.earthDk);
      b.box(2.3, 0.45, 1.15, -0.2, 0.08, -0.65, B.stone);
      b.box(2.42, 0.55, 1.27, -0.2, 0.53, -0.65, B.plaster);
      for (let i = 0; i < 7; i++) b.box(0.05, 0.55, 0.02, -1.38 + i * 0.393, 0.53, -0.005, A.woodDk);
      for (const k of [-1, 1]) b.box(0.05, 0.6, 0.02, -0.2 + k * 0.6, 0.5, -0.005, A.woodDk, { rz: k * 0.75 });
      b.box(2.42, 0.05, 0.02, -0.2, 0.8, -0.005, A.woodDk);
      gable(b, 2.62, 1.5, 0.85, -0.2, 1.08, -0.65, B.tile);
      stack(b, 0.28, 0.26, 1.25, -1.15, 1.0, -0.65, B.stoneDk);
      slots(b, -0.2, 0.2, -0.07, 1.6, 0.2, 4, false);
      b.box(0.34, 0.42, 0.03, 0.75, 0.08, -0.06, A.woodDk);
      hang(b, -0.85, 1.04, 0.0, 0.26, 0.42, true); hang(b, 0.45, 1.04, 0.0, 0.26, 0.42, true);
      fence(b, -1.35, 1.35, 1.35, 1.35); fence(b, -1.35, 0.3, -1.35, 1.35);
      b.box(0.07, 0.7, 0.07, 0.6, 0.08, 0.8, A.woodDk); b.box(0.6, 0.05, 0.05, 0.6, 0.72, 0.8, A.wood); b.box(0.04, 0.22, 0.14, 0.88, 0.5, 0.8, P.white, TB);
      pennant(b, 1.2, 0.08, -1.2, 1.4, 0.42);
      bset('barracks', 2, [part('body', b)]);
    }
    // Gunpowder barracks, a lime-washed block of two storeys under a hipped slate roof with a cupola, a parade
    // ground with the flag, stacked muskets and a sentry box in the side's paint.
    {
      const b = G();
      yard(b, 3, 3, B.gravel);
      b.box(2.5, 1.0, 1.1, -0.15, 0.08, -0.7, B.plaster);
      b.box(2.56, 0.06, 1.16, -0.15, 0.56, -0.7, B.stoneDk);
      hipRoof(b, 2.7, 1.3, 0.5, -0.15, 1.08, -0.7, B.slate);
      for (const y of [0.2, 0.68]) slots(b, -0.15, y, -0.14, 2.2, 0.26, 7, false, 0.14);
      b.box(0.3, 0.44, 0.03, -0.15, 0.08, -0.13, A.woodDk);
      b.box(0.22, 0.26, 0.22, -0.15, 1.4, -0.7, B.plaster);
      b.cyl(0, 0.2, 0.24, -0.15, 1.78, -0.7, B.slate, { seg: 8 });
      for (const x of [-1.1, 0.8]) b.box(0.16, 0.4, 0.22, x, 1.26, -0.7, B.brick);
      flagpole(b, 0.95, 0.08, 0.85, 1.7, 0.6, 0.38, B.stoneDk);
      for (const [x, z] of [[-0.9, 0.5], [-0.4, 0.5], [0.1, 0.5]]) for (let i = 0; i < 3; i++) { const a = i * 2.094; b.cyl(0.008, 0.012, 0.5, x + Math.cos(a) * 0.05, 0.31, z + Math.sin(a) * 0.05, A.woodDk, { seg: 4, rz: Math.cos(a) * 0.2, rx: -Math.sin(a) * 0.2 }); }
      b.box(0.3, 0.6, 0.3, 1.15, 0.08, -0.2, P.white, { t: 0.6 });
      b.box(0.02, 0.4, 0.2, 1.31, 0.12, -0.2, B.coal);
      hipRoof(b, 0.38, 0.38, 0.2, 1.15, 0.68, -0.2, B.slate);
      bset('barracks', 3, [part('body', b)]);
    }
    // Industrial barracks, a long brick block under slate with chimney stacks, a corrugated iron hut, and a flag.
    {
      const b = G();
      yard(b, 3, 3, B.cinder);
      b.box(2.5, 0.72, 1.0, -0.15, 0.08, -0.85, B.brick);
      gable(b, 2.62, 1.2, 0.42, -0.15, 0.8, -0.85, B.slate);
      windows(b, -0.15, 0.3, -0.34, 2.2, 0.28, 6, 'x', { g: 0.3 });
      b.box(0.6, 0.14, 0.02, 0.75, 0.6, -0.33, P.white, TB);
      for (const x of [-1.05, -0.15, 0.75]) b.box(0.14, 0.34, 0.2, x, 1.02, -0.85, B.brickDk);
      ironHut(b, -0.3, 0.65, 0.46, 1.9, 7);
      flagpole(b, 1.15, 0.08, 0.9, 1.6, 0.56, 0.34, B.ironDk);
      bset('barracks', 4, [part('body', b)]);
    }

    // Factories -------------------------------------------------------------------------------------------------
    // Stables of the first ages, a long mud and timber stable under thatch with open stalls on a fenced paddock,
    // horses in the side's saddle-cloths, hay ricks and a trough.
    {
      const b = G();
      yard(b, 4, 4, B.earth);
      b.box(1.2, 0.68, 3.3, -1.25, 0.08, 0, B.mud);
      gable(b, 3.5, 1.6, 0.72, -1.25, 0.76, 0, B.thatch, { alongZ: true });
      for (let i = 0; i < 5; i++) b.box(0.03, 0.46, 0.4, -0.64, 0.08, -1.3 + i * 0.65, A.woodDk);
      for (let i = 0; i < 6; i++) b.cyl(0.04, 0.05, 0.7, -0.5, 0.43, -1.62 + i * 0.65, A.wood, { seg: 6 });
      fence(b, -0.35, -1.85, 1.85, -1.85); fence(b, 1.85, -1.85, 1.85, -0.6); fence(b, 1.85, 0.6, 1.85, 1.85); fence(b, -0.35, 1.85, 1.85, 1.85);
      horseInto(b, 0.5, 0.08, -0.9, 0.5, 0x6b4a32); horseInto(b, 0.9, 0.08, 0.95, -2.3, 0x3a2a20);
      b.sph(0.36, 1.3, 0.08, -1.3, B.thatch, { top: true, seg: 10, sy: 0.9 }); b.sph(0.28, 1.5, 0.08, -0.85, B.thatch, { top: true, seg: 10, sy: 0.9 });
      b.box(0.7, 0.18, 0.22, 0.3, 0.08, 1.5, A.woodDk);
      flagpole(b, -0.35, 0.08, 1.75, 1.4, 0.46, 0.3);
      bset('factory', 1, [part('body', b)]);
    }
    // Medieval stables, a long stable of stone below and timber frame above under tiles, a smithy wing with its
    // forge and stack, a fenced yard of knights' horses in the side's colours, and a pennant.
    {
      const b = G();
      yard(b, 4, 4, B.earthDk);
      b.box(1.1, 0.4, 3.4, -1.35, 0.08, 0, B.stone);
      b.box(1.1, 0.4, 3.4, -1.35, 0.48, 0, B.plaster);
      for (let i = 0; i < 8; i++) b.box(0.02, 0.4, 0.05, -0.79, 0.48, -1.6 + i * 0.457, A.woodDk);
      gable(b, 3.6, 1.4, 0.8, -1.35, 0.88, 0, B.tile, { alongZ: true });
      for (let i = 0; i < 4; i++) b.box(0.03, 0.36, 0.42, -0.79, 0.08, -1.2 + i * 0.8, A.woodDk);
      b.box(1.7, 0.7, 0.9, 0.35, 0.08, -1.45, B.stone);
      gable(b, 1.85, 1.1, 0.55, 0.35, 0.78, -1.45, B.tile);
      stack(b, 0.34, 0.28, 1.6, 1.0, 0.08, -1.55, B.stoneDk);
      b.box(0.26, 0.22, 0.03, 0.85, 0.12, -0.99, B.fire, { g: 2 });
      fence(b, -0.7, 1.85, 1.85, 1.85); fence(b, 1.85, 1.85, 1.85, 0.55); fence(b, 1.85, -0.55, 1.85, -0.95);
      horseInto(b, 0.4, 0.08, 0.9, 0.3, 0x5a4a3a, { armour: true }); horseInto(b, 0.95, 0.08, -0.25, -2.6, 0x8a6a4a, { armour: true });
      pennant(b, -1.35, 1.66, 1.75, 0.5, 0.34);
      flagpole(b, 1.75, 0.08, 1.75, 1.3, 0.44, 0.28);
      bset('factory', 2, [part('body', b)]);
    }
    // Foundry, a brick casting hall under tiles with a louvred ridge and doors in the side's paint, a tall stack,
    // cast barrels on skids, a pile of shot and the flag.
    {
      const b = G();
      yard(b, 4, 4, B.gravel);
      b.box(2.4, 1.1, 2.9, -0.7, 0.08, 0, B.brick);
      gable(b, 2.6, 3.1, 0.85, -0.7, 1.18, 0, B.tile);
      b.box(1.2, 0.22, 0.4, -0.7, 1.95, 0, B.brickDk);
      gable(b, 1.3, 0.56, 0.18, -0.7, 2.17, 0, B.tile);
      b.box(0.04, 0.82, 1.3, 0.51, 0.08, 0, A.woodDk, T);
      slots(b, -0.7, 0.5, 1.46, 1.8, 0.34, 4, false, 0.2);
      slots(b, -0.7, 0.5, -1.46, 1.8, 0.34, 4, false, 0.2);
      stack(b, 0.6, 0.42, 3.0, -1.55, 0.08, -1.2, B.brick);
      for (const x of [0.95, 1.6]) b.box(0.08, 0.06, 1.0, x, 0.08, -1.0, A.wood);
      for (const z of [-1.3, -1.0, -0.7]) b.cyl(0.09, 0.07, 0.95, 1.27, 0.23, z, B.coal, { axis: 'x', seg: 10 });
      for (const [x, z, y] of [[1.15, 1.2, 0], [1.31, 1.2, 0], [1.47, 1.2, 0], [1.23, 1.34, 0], [1.39, 1.34, 0], [1.31, 1.27, 0.12]]) b.sph(0.08, x, 0.16 + y, z, B.coal, { seg: 8, rings: 6 });
      for (const k of [-1, 1]) strut(b, [1.0, 0.08, 0.35 + k * 0.3], [1.3, 1.3, 0.35], 0.05, A.woodDk);
      strut(b, [1.75, 0.08, 0.35], [1.3, 1.3, 0.35], 0.05, A.woodDk);
      flagpole(b, 1.7, 0.08, 1.7, 1.5, 0.5, 0.32);
      bset('factory', 3, [part('body', b)]);
    }
    // Industrial factory, a brick hall under a sawtooth roof of iron and north lights, a big door in the side's
    // paint under its name board, a tall chimney and a water tower.
    {
      const b = G();
      yard(b, 4, 4, B.cinder);
      b.box(3.0, 1.0, 3.2, -0.4, 0.08, 0, B.brick);
      for (let i = 0; i < 4; i++) {
        const x = -1.9 + i * 0.75;
        b.prism([[0, 1.08], [0.75, 1.08], [0, 1.52]], 3.24, x, 0, 0, B.iron);
        b.box(0.02, 0.38, 3.1, x - 0.01, 1.1, 0, P.glass, { g: 0.4 });
      }
      b.box(0.04, 0.8, 1.6, 1.11, 0.08, 0, B.ironDk, T);
      for (let i = 0; i < 6; i++) b.box(0.03, 0.03, 1.6, 1.13, 0.2 + i * 0.12, 0, B.iron);
      b.box(0.03, 0.2, 2.6, 1.12, 0.92, 0, P.white, TB);
      for (const k of [-1, 1]) windows(b, -0.4, 0.4, k * 1.61, 2.6, 0.36, 6, 'x', { g: 0.3 });
      chimney(b, -1.55, 1.55, 3.2, 0.2);
      waterTower(b, 1.5, -1.45, 1.1, 0.28);
      bset('factory', 4, [part('body', b)]);
    }

    // Lookouts and signals -------------------------------------------------------------------------------------
    // Watchtower of the first ages, a tall timber tower on splayed, braced legs, a lookout under its thatched roof, a
    // beacon basket, and a mud-brick hut at its foot.
    {
      const b = G();
      yard(b, 3, 3, B.earth);
      const tx = -0.45, tz = -0.45, H = 2.1, C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [dx, dz] of C4) strut(b, [tx + dx * 0.44, 0.06, tz + dz * 0.44], [tx + dx * 0.34, H + 0.06, tz + dz * 0.34], 0.08, A.wood);
      for (let i = 0; i < 4; i++) {
        const [ax, az] = C4[i], [bx, bz] = C4[(i + 1) % 4];
        strut(b, [tx + ax * 0.41, 0.5, tz + az * 0.41], [tx + bx * 0.37, 1.5, tz + bz * 0.37], 0.04, A.woodDk);
        strut(b, [tx + bx * 0.41, 0.5, tz + bz * 0.41], [tx + ax * 0.37, 1.5, tz + az * 0.37], 0.04, A.woodDk);
      }
      b.box(0.9, 0.08, 0.9, tx, H, tz, A.wood);
      for (const [dx, dz] of C4) b.box(0.05, 0.9, 0.05, tx + dx * 0.4, H + 0.08, tz + dz * 0.4, A.woodDk);
      for (let i = 0; i < 4; i++) { const [ax, az] = C4[i], [bx, bz] = C4[(i + 1) % 4]; wall(b, tx + ax * 0.4, tz + az * 0.4, tx + bx * 0.4, tz + bz * 0.4, 0.04, 0.04, A.wood, H + 0.4); }
      hipRoof(b, 1.1, 1.1, 0.5, tx, H + 0.98, tz, B.thatch);
      figureInto(b, { cloth: A.tunic, vest: A.bronze, vestT: 0.5, hat: 'crest', arms: 'spear' }, tx, H + 0.08, tz, 0.6);
      pennant(b, tx, H + 1.46, tz, 0.45, 0.3);
      strut(b, [tx + 0.4, H + 0.3, tz + 0.4], [tx + 0.62, H + 0.55, tz + 0.62], 0.04, A.woodDk);
      b.cyl(0.11, 0.07, 0.14, tx + 0.64, H + 0.62, tz + 0.64, B.ironDk, { seg: 8, open: true });
      b.sph(0.09, tx + 0.64, H + 0.68, tz + 0.64, B.fire, { seg: 8, rings: 5, g: 2 });
      b.box(0.9, 0.5, 0.8, 0.6, 0.08, 0.65, B.mud);
      b.box(0.96, 0.05, 0.86, 0.6, 0.58, 0.65, B.mudDk);
      b.box(0.03, 0.38, 0.26, 1.06, 0.08, 0.65, A.woodDk);
      bset('radar', 1, [part('body', b)]);
    }
    // Medieval watchtower, a tall round tower of stone with slits, a corbelled crenellated top and a beacon
    // burning on it, a pennant, and a guardhouse under slate.
    {
      const b = G();
      yard(b, 3, 3, B.earthDk);
      const tx = -0.4, tz = -0.4;
      b.cyl(0.48, 0.56, 2.3, tx, 1.23, tz, B.stone, { seg: 12 });
      b.cyl(0.6, 0.5, 0.2, tx, 2.48, tz, B.stoneDk, { seg: 12 });
      crenRing(b, tx, tz, 0.54, 2.58, B.stone, 10, 0.15);
      b.cyl(0.14, 0.08, 0.16, tx, 2.66, tz, B.ironDk, { seg: 8 });
      b.sph(0.11, tx, 2.78, tz, B.fire, { seg: 8, rings: 5, g: 2 });
      pennant(b, tx + 0.3, 2.58, tz + 0.3, 0.75, 0.36);
      for (const [a, y] of [[0, 0.8], [0, 1.7], [-R90, 1.25], [-0.8, 2.0]]) b.box(0.05, 0.28, 0.06, tx + Math.cos(a) * 0.52, y, tz - Math.sin(a) * 0.52, B.coal, { ry: a });
      b.box(0.05, 0.5, 0.3, tx + 0.55, 0.08, tz, A.woodDk);
      b.box(1.1, 0.6, 0.8, 0.6, 0.08, 0.7, B.stone);
      gable(b, 1.2, 1.0, 0.45, 0.6, 0.68, 0.7, B.slate);
      b.box(0.03, 0.42, 0.26, 1.16, 0.08, 0.7, A.woodDk);
      hang(b, 0.6, 0.62, 1.11, 0.3, 0.36, true);
      bset('radar', 2, [part('body', b)]);
    }
    // Signal tower, a plastered tower under a low roof carrying a semaphore mast whose regulator and arms rock as
    // it signals, the keeper's house, and the flag.
    {
      const b = G();
      yard(b, 3, 3, B.gravel);
      const tx = -0.45, tz = -0.45;
      b.box(1.0, 1.5, 1.0, tx, 0.08, tz, B.plaster);
      b.box(1.06, 0.06, 1.06, tx, 1.58, tz, B.stoneDk);
      hipRoof(b, 1.16, 1.16, 0.3, tx, 1.64, tz, B.slate);
      slots(b, tx + 0.51, 0.95, tz, 0.5, 0.3, 2, true, 0.14); slots(b, tx, 0.95, tz + 0.51, 0.5, 0.3, 2, false, 0.14);
      b.box(0.03, 0.5, 0.3, tx + 0.51, 0.08, tz, A.woodDk);
      b.box(0.07, 1.3, 0.07, tx, 1.7, tz, A.woodDk);
      for (const k of [-1, 1]) strut(b, [tx + k * 0.3, 1.86, tz], [tx, 2.5, tz], 0.03, A.woodDk);
      const s = G();
      s.box(1.1, 0.08, 0.04, 0, -0.04, 0, B.coal, T);
      for (const k of [-1, 1]) s.box(0.05, 0.38, 0.035, k * 0.6, -0.04, 0.035, B.coal, { rz: k * 0.6 });
      s.box(0.07, 0.07, 0.12, 0, -0.035, 0, B.ironDk);
      b.box(1.1, 0.55, 0.8, 0.65, 0.08, 0.65, B.plaster);
      gable(b, 1.2, 0.96, 0.4, 0.65, 0.63, 0.65, B.tile);
      b.box(0.03, 0.4, 0.24, 1.21, 0.08, 0.65, A.woodDk);
      flagpole(b, 1.25, 0.08, -0.9, 1.3, 0.46, 0.3);
      bset('radar', 3, [part('body', b), part('arm', s, { pivot: [tx, 2.86, tz + 0.06], nod: true })]);
    }
    // Radio station, a guyed lattice mast with a lamp at its head, a short mast with the aerial strung between
    // them, and a brick wireless hut with a direction-finding loop turning on its roof.
    {
      const b = G();
      yard(b, 3, 3, B.cinder);
      const mx = -0.75, mz = -0.75, H = 3.0, r0 = 0.28, r1 = 0.05, n = 6, C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const at = (i, [dx, dz]) => { const r = r0 + (r1 - r0) * i / n; return [mx + dx * r, 0.08 + H * i / n, mz + dz * r]; };
      for (const c of C4) strut(b, at(0, c), at(n, c), 0.035, B.ironDk);
      for (let i = 1; i <= n; i++) for (let k = 0; k < 4; k++) {
        if (i < n) strut(b, at(i, C4[k]), at(i, C4[(k + 1) % 4]), 0.02, B.ironDk);
        strut(b, at(i - 1, C4[k]), at(i, C4[(k + 1) % 4]), 0.016, B.ironDk);
      }
      b.sph(0.05, mx, 0.08 + H + 0.05, mz, P.red, { seg: 6, rings: 4, g: 4 });
      for (const [x, z] of [[1.35, -1.35], [-1.35, 1.35], [-1.4, -1.4]]) strut(b, [mx, 0.08 + H * 0.68, mz], [x, 0.08, z], 0.01, B.coal);
      b.cyl(0.03, 0.045, 2.0, 1.1, 1.08, -1.1, A.woodDk, { seg: 6 });
      strut(b, [mx, 0.08 + H * 0.93, mz], [1.1, 2.04, -1.1], 0.01, B.coal);
      strut(b, [0.2, 2.45, -0.93], [0.4, 0.62, 0.24], 0.01, B.coal);
      b.box(1.2, 0.6, 0.9, 0.45, 0.08, 0.7, B.brick);
      gable(b, 1.32, 1.06, 0.38, 0.45, 0.68, 0.7, B.slate);
      windows(b, 0.45, 0.32, 1.16, 1.0, 0.24, 3, 'x', { g: 0.3 });
      b.box(0.03, 0.44, 0.26, 1.06, 0.08, 0.7, A.woodDk);
      b.box(0.03, 0.14, 0.5, 1.065, 0.52, 0.7, P.white, TB);
      flagpole(b, -1.25, 0.08, 1.15, 1.3, 0.46, 0.3, B.ironDk);
      const d = G();
      d.cyl(0.02, 0.02, 0.24, 0, 0.12, 0, B.ironDk, { seg: 5 });
      for (const [w, h, y, z] of [[0.04, 0.4, 0.24, 0.2], [0.04, 0.4, 0.24, -0.2], [0.04, 0.04, 0.64, 0], [0.04, 0.04, 0.24, 0]]) d.box(w, h, w === h ? 0.44 : 0.04, 0, y, z, B.ironDk);
      bset('radar', 4, [part('body', b), part('dish', d, { pivot: [0.6, 1.0, 0.7], spin: 'y', rate: 0.8 })]);
    }

    // Forward bases --------------------------------------------------------------------------------------------
    // Outpost, a palisade round a little motte with a timber tower and its hoarding, a pavilion tent peaked in the
    // side's colour, and a pennant.
    {
      const b = G();
      yard(b, 3, 3, B.earthDk);
      const E = 1.32;
      palisade(b, -E, -E, E, -E); palisade(b, -E, E, E, E); palisade(b, -E, -E, -E, E); palisade(b, E, -E, E, -0.35); palisade(b, E, 0.35, E, E);
      for (const k of [-1, 1]) b.box(0.1, 0.85, 0.1, E, 0.04, k * 0.38, A.woodDk);
      b.cyl(0.42, 0.8, 0.42, -0.45, 0.29, -0.45, B.turf, { seg: 12 });
      b.box(0.6, 0.75, 0.6, -0.45, 0.5, -0.45, A.wood);
      b.box(0.72, 0.06, 0.72, -0.45, 1.25, -0.45, A.woodDk);
      crenRect(b, -0.45, -0.45, 0.68, 0.68, 1.31, A.wood, 0.12);
      pennant(b, -0.45, 1.31, -0.45, 0.8, 0.4);
      b.cyl(0.42, 0.42, 0.45, 0.6, 0.305, 0.6, A.canvas, { seg: 10 });
      b.cyl(0, 0.5, 0.42, 0.6, 0.74, 0.6, P.white, { seg: 10, t: 1 });
      b.cyl(0.012, 0.012, 0.3, 0.6, 1.04, 0.6, A.woodDk, { seg: 4 });
      b.cyl(0.14, 0.16, 0.06, 0.5, 0.11, -0.6, B.stoneDk, { seg: 8 });
      bset('fob', 2, [part('body', b)]);
    }
    // Redoubt, a square of earth ramparts with gabions along their crests, a gun at two corners, a wall tent and the
    // flag.
    {
      const b = G();
      yard(b, 3, 3, B.turf);
      const E = 1.12, prof = [[-0.3, 0], [0.32, 0], [0.12, 0.42], [-0.18, 0.42]];
      b.prism(prof, 2 * E + 0.62, -E, 0.08, 0, B.earth, { ry: Math.PI });
      b.prism(prof, 2 * E + 0.62, 0, 0.08, E, B.earth, { ry: -R90 });
      b.prism(prof, 2 * E + 0.62, 0, 0.08, -E, B.earth, { ry: R90 });
      for (const k of [-1, 1]) b.prism(prof, E - 0.3 + 0.31, E, 0.08, k * (E + 0.31 + 0.3) / 2, B.earth);
      gabions(b, -E - 0.02, -E, -E - 0.02, E, 0.5, 8); gabions(b, -E, E + 0.02, E, E + 0.02, 0.5, 8); gabions(b, -E, -E - 0.02, E, -E - 0.02, 0.5, 8);
      for (const k of [-1, 1]) gabions(b, E + 0.02, k * 0.36, E + 0.02, k * E, 0.5, 3);
      for (const [x, z, a] of [[E - 0.15, -E + 0.15, -Math.PI / 4], [-E + 0.15, E - 0.15, Math.PI * 0.75]]) {
        b.box(0.3, 0.1, 0.2, x, 0.5, z, A.wood, { ry: -a });
        b.cyl(0.06, 0.045, 0.5, x + Math.cos(a) * 0.3, 0.66, z + Math.sin(a) * 0.3, B.coal, { axis: 'x', seg: 8, ry: -a });
      }
      b.box(0.62, 0.26, 0.5, -0.3, 0.08, -0.25, A.canvas);
      gable(b, 0.66, 0.56, 0.3, -0.3, 0.34, -0.25, A.canvas);
      for (const [x, z] of [[0.15, -0.55], [0.3, -0.48]]) b.cyl(0.08, 0.08, 0.18, x, 0.17, z, A.woodDk, { seg: 8 });
      flagpole(b, 0.3, 0.08, 0.4, 1.6, 0.56, 0.34);
      bset('fob', 3, [part('body', b)]);
    }
    // Forward base of the first motors, a sandbag ring, a corrugated iron hut, a bell tent, crates, a telephone pole
    // and the flag.
    {
      const b = G();
      yard(b, 3, 3, B.earth);
      sand(b, 0, 0, 2.6, 2.6, 2);
      ironHut(b, -0.35, -0.5, 0.42, 1.3, 5);
      b.cyl(0, 0.44, 0.72, 0.55, 0.44, 0.55, A.canvas, { seg: 10 });
      b.cyl(0.01, 0.01, 0.16, 0.55, 0.86, 0.55, A.woodDk, { seg: 4 });
      for (const [x, z, y] of [[0.75, -0.6, 0], [0.75, -0.95, 0], [0.75, -0.78, 0.2]]) b.box(0.3, 0.2, 0.3, x, 0.08 + y, z, A.wood);
      b.cyl(0.025, 0.035, 1.9, 1.0, 1.03, 0.9, A.woodDk, { seg: 5 });
      b.box(0.04, 0.04, 0.42, 1.0, 1.82, 0.9, A.woodDk);
      flagpole(b, -0.9, 0.08, 0.85, 1.5, 0.54, 0.34, B.ironDk);
      bset('fob', 4, [part('body', b)]);
    }

    // Defences --------------------------------------------------------------------------------------------------
    // Archer tower of the first ages, a battered mud-brick tower with a timber gallery and stepped merlons, the
    // side's cloths on its faces, and an archer on top who turns to his mark.
    {
      const b = G();
      yard(b, 2, 2, B.earth);
      stack(b, 1.2, 1.0, 1.1, 0, 0.08, 0, B.mud);
      b.box(1.16, 0.06, 1.16, 0, 1.18, 0, A.woodDk);
      crenRect(b, 0, 0, 1.06, 1.06, 1.24, B.mud, 0.14);
      for (let i = 0; i < 4; i++) { b.box(0.12, 0.06, 0.06, 0.58, 1.08, -0.36 + i * 0.24, A.woodDk); b.box(0.06, 0.06, 0.12, -0.36 + i * 0.24, 1.08, 0.58, A.woodDk); }
      hang(b, 0.57, 1.02, 0.14, 0.26, 0.46); hang(b, 0.14, 1.02, 0.57, 0.26, 0.46, true);
      b.box(0.03, 0.4, 0.24, 0.6, 0.08, -0.25, A.woodDk);
      const t = G();
      figureInto(t, { cloth: A.linen, vest: A.tunic2, vestT: 0.6, hat: 'crest', crest: A.tunic2, arms: 'bow' }, 0, 0, 0);
      bset('bunker', 1, [part('body', b), part('turret', t, { pivot: [0, 1.24, 0], aim: true })]);
    }
    // Medieval archer tower, a round stone tower with slits, a corbelled crenellated top, a pennant, and a
    // longbowman on top who turns to his mark.
    {
      const b = G();
      yard(b, 2, 2, B.earthDk);
      b.cyl(0.54, 0.62, 1.2, 0, 0.68, 0, B.stone, { seg: 12 });
      b.cyl(0.66, 0.56, 0.14, 0, 1.35, 0, B.stoneDk, { seg: 12 });
      crenRing(b, 0, 0, 0.6, 1.42, B.stone, 10, 0.15);
      for (const [a, y] of [[0.3, 0.75], [-R90 - 0.3, 0.75], [-0.6, 0.95], [-1.0, 0.55]]) b.box(0.05, 0.26, 0.06, Math.cos(a) * 0.6, y, -Math.sin(a) * 0.6, B.coal, { ry: a });
      b.box(0.05, 0.44, 0.26, 0.6, 0.08, 0, A.woodDk);
      pennant(b, -0.42, 1.42, -0.42, 0.7, 0.36);
      const t = G();
      figureInto(t, { cloth: A.coatG, vest: A.tunic2, vestT: 0.6, hat: false, hair: 0x5a4632, arms: 'longbow' }, 0, 0, 0);
      bset('bunker', 2, [part('body', b), part('turret', t, { pivot: [0, 1.42, 0], aim: true })]);
    }
    // Musket redoubt, a low eight-sided earthwork crowned with gabions, a firing step of planks, the flag, and two
    // musketeers who turn to their mark.
    {
      const b = G();
      yard(b, 2, 2, B.turf);
      b.cyl(0.72, 0.94, 0.42, 0, 0.29, 0, B.earth, { seg: 8 });
      b.cyl(0.62, 0.62, 0.05, 0, 0.5, 0, A.wood, { seg: 8 });
      for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283 + 0.35; b.cyl(0.085, 0.085, 0.22, Math.cos(a) * 0.7, 0.61, Math.sin(a) * 0.7, B.thatchDk, { seg: 7 }); }
      flagpole(b, -0.5, 0.5, -0.5, 1.1, 0.4, 0.26);
      const t = G();
      for (const z of [-0.14, 0.14]) figureInto(t, { cloth: A.coatR, vest: A.white, vestT: 0.6, hat: 'tricorne', arms: 'musket', legs: A.white }, 0, 0, z);
      bset('bunker', 3, [part('body', b), part('turret', t, { pivot: [0, 0.53, 0], aim: true })]);
    }
    // Machine-gun nest, a ring of sandbags on duckboards with a sheet of corrugated iron over the back, and a
    // water-cooled gun on its pedestal with the gunner behind it.
    {
      const b = G();
      yard(b, 2, 2, B.earth);
      sand(b, 0, 0, 1.5, 1.5, 3);
      b.box(1.3, 0.04, 1.3, 0, 0.08, 0, A.wood);
      for (const z of [-0.62, 0.62]) b.box(0.06, 0.92, 0.06, -0.66, 0.08, z, A.woodDk);
      b.box(0.36, 0.03, 1.4, -0.6, 0.96, 0, B.iron, { rz: 0.15 });
      pennant(b, 0.55, 0.38, -0.55, 0.5, 0.26);
      const t = G();
      t.cyl(0.03, 0.04, 0.4, 0, 0.2, 0, B.ironDk, { seg: 6 });
      for (let i = 0; i < 3; i++) { const a = i * 2.094; strut(t, [0, 0.16, 0], [Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], 0.022, B.ironDk); }
      figureInto(t, { cloth: A.khaki, vest: A.field, vestT: 0.5, hat: 'brodie', legs: A.khaki, pack: A.field }, -0.34, 0, 0);
      const gn = G();
      gn.cyl(0.05, 0.05, 0.4, 0.2, 0, 0, A.field, { axis: 'x', seg: 10 });
      gn.cyl(0.014, 0.014, 0.12, 0.45, 0, 0, B.coal, { axis: 'x', seg: 5 });
      gn.box(0.2, 0.09, 0.08, -0.08, -0.045, 0, B.ironDk);
      gn.box(0.1, 0.07, 0.08, -0.06, -0.09, 0.09, A.wood);
      bset('bunker', 4, [part('body', b), part('turret', t, { pivot: [0, 0.1, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.02, 0.46, 0], recoil: 0.04 })]);
    }
    // Ballista, a mud-brick platform with a timber deck and a rack of bolts, and a bolt-thrower on a post that
    // turns, its arms drawn back on twisted sinew.
    {
      const b = G();
      yard(b, 2, 2, B.earth);
      b.box(1.5, 0.26, 1.5, 0, 0.08, 0, B.mud);
      b.box(1.4, 0.03, 1.4, 0, 0.34, 0, A.wood);
      for (let i = 0; i < 4; i++) b.cyl(0.012, 0.012, 0.6, -0.5, 0.42 + i * 0.03, -0.45 + i * 0.05, A.woodDk, { axis: 'x', seg: 4 });
      pennant(b, -0.62, 0.37, 0.62, 0.75, 0.32);
      const t = G();
      t.cyl(0.07, 0.09, 0.3, 0, 0.15, 0, A.woodDk, { seg: 6 });
      t.box(0.95, 0.07, 0.12, 0.05, 0.3, 0, A.wood, T);
      t.box(0.08, 0.22, 0.36, 0.38, 0.22, 0, A.woodDk);
      for (const k of [-1, 1]) {
        t.cyl(0.05, 0.05, 0.26, 0.38, 0.33, k * 0.13, A.rope, { seg: 8 });
        strut(t, [0.38, 0.38, k * 0.13], [0.16, 0.38, k * 0.48], 0.035, A.woodDk);
        strut(t, [0.16, 0.38, k * 0.48], [-0.32, 0.38, 0], 0.008, A.linen);
      }
      bset('atgun', 1, [part('body', b), part('turret', t, { pivot: [0, 0.37, 0], aim: true }), part('gun', bolt(), { parent: 'turret', pivot: [0, 0.39, 0], recoil: 0.16 })]);
    }
    // Springald, a crenellated stone platform and a timber frame that turns, two skeins of rope with arms drawn
    // back between them, and the bolt in its trough.
    {
      const b = G();
      yard(b, 2, 2, B.earthDk);
      b.box(1.6, 0.34, 1.6, 0, 0.08, 0, B.stone);
      crenRect(b, 0, 0, 1.5, 1.5, 0.42, B.stone, 0.14);
      pennant(b, -0.66, 0.42, -0.66, 0.8, 0.34);
      const t = G();
      t.box(0.5, 0.06, 0.5, 0, 0, 0, A.woodDk);
      for (const k of [-1, 1]) {
        t.box(0.07, 0.5, 0.07, 0.1, 0.06, k * 0.22, A.wood, T);
        t.cyl(0.055, 0.055, 0.42, 0.1, 0.33, k * 0.13, A.rope, { seg: 8 });
        strut(t, [0.1, 0.44, k * 0.13], [-0.16, 0.5, k * 0.36], 0.04, A.woodDk);
        strut(t, [-0.16, 0.5, k * 0.36], [-0.36, 0.36, 0], 0.008, A.linen);
      }
      for (const y of [0.06, 0.56]) t.box(0.1, 0.06, 0.52, 0.1, y, 0, A.wood);
      t.box(0.9, 0.06, 0.1, 0.0, 0.3, 0, A.wood, T);
      bset('atgun', 2, [part('body', b), part('turret', t, { pivot: [0, 0.42, 0], aim: true }), part('gun', bolt(), { parent: 'turret', pivot: [0.05, 0.37, 0], recoil: 0.16 })]);
    }
    // Cannon battery, a plank platform in a ring of gabions with powder barrels, the flag, and a gun on its
    // wheeled carriage that turns and runs back as it fires.
    {
      const b = G();
      yard(b, 2, 2, B.turf);
      b.box(1.3, 0.05, 1.3, 0, 0.08, 0, A.wood);
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; b.cyl(0.085, 0.085, 0.22, Math.cos(a) * 0.82, 0.19, Math.sin(a) * 0.82, B.thatchDk, { seg: 7 }); }
      for (const [x, z] of [[-0.45, 0.45], [-0.3, 0.55]]) b.cyl(0.08, 0.08, 0.18, x, 0.22, z, A.woodDk, { seg: 8 });
      flagpole(b, -0.6, 0.08, -0.6, 1.3, 0.42, 0.26);
      const t = G();
      for (const k of [-1, 1]) { t.box(0.62, 0.18, 0.05, -0.05, 0.04, k * 0.11, A.wood, T); cartWheel(t, 0.06, k * 0.22, 0.17, 0.04); }
      t.cyl(0.03, 0.03, 0.5, 0.06, 0.17, 0, A.iron, { axis: 'z', seg: 6 });
      t.box(0.5, 0.06, 0.14, -0.42, 0.02, 0, A.wood, Object.assign({ rz: 0.25 }, T));
      const gn = G();
      gn.cyl(0.085, 0.065, 0.85, 0.3, 0, 0, B.coal, { axis: 'x', seg: 12 });
      gn.cyl(0.08, 0.08, 0.05, 0.7, 0, 0, B.coal, { axis: 'x', seg: 12 });
      gn.sph(0.06, -0.15, 0, 0, B.coal, { seg: 8, rings: 6 });
      bset('atgun', 3, [part('body', b), part('turret', t, { pivot: [0, 0.13, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0, 0.3, 0], recoil: 0.16 })]);
    }
    // Field gun, a sandbagged pit with ammunition boxes, and a gun behind its shield on two wheels with a split
    // trail, its long barrel over a recuperator.
    {
      const b = G();
      yard(b, 2, 2, B.earth);
      sand(b, 0, 0, 1.6, 1.6, 2);
      for (const [x, z] of [[-0.5, 0.45], [-0.5, 0.25]]) b.box(0.3, 0.14, 0.17, x, 0.08, z, A.wood);
      const t = G();
      for (const k of [-1, 1]) {
        t.cyl(0.18, 0.18, 0.05, 0.02, 0.18, k * 0.27, B.coal, { axis: 'z', seg: 12 });
        t.cyl(0.07, 0.07, 0.06, 0.02, 0.18, k * 0.27, A.iron, { axis: 'z', seg: 8 });
        strut(t, [-0.05, 0.16, k * 0.1], [-0.72, 0.02, k * 0.26], 0.05, A.field, T);
      }
      t.cyl(0.025, 0.025, 0.54, 0.02, 0.18, 0, A.iron, { axis: 'z', seg: 6 });
      t.box(0.04, 0.36, 0.52, 0.17, 0.12, 0, A.field, T);
      t.box(0.24, 0.12, 0.16, 0.0, 0.16, 0, A.field, T);
      const gn = G();
      gn.cyl(0.035, 0.045, 1.0, 0.45, 0, 0, 0x3a3e42, { axis: 'x', seg: 10 });
      gn.cyl(0.03, 0.03, 0.5, 0.15, -0.06, 0, A.field, { axis: 'x', seg: 8 });
      gn.box(0.16, 0.1, 0.1, -0.06, -0.05, 0, A.iron);
      bset('atgun', 4, [part('body', b), part('turret', t, { pivot: [0, 0.1, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.05, 0.3, 0], recoil: 0.16 })]);
    }

    // The future's buildings are the modern models refitted in pale composite and gunmetal, with blue glass, hazard
    // bands lit softly in the future's blue, and the side's markings, lamps and ore kept. The larger ones gain slim
    // light pylons at their corners, the command post a ringed spire, the sensors a ringed mast and the fabricator
    // a gantry over its yard.
    {
      const lin = hex => new THREE.Color(hex), near = (v, k) => Math.abs(v[0] - k.r) + Math.abs(v[1] - k.g) + Math.abs(v[2] - k.b) < 0.02;
      const GLASS = lin(P.glass), YEL = lin(P.yellow), KEEP = [lin(P.ore), lin(P.red)], GL = lin(A.glow), BLUE = lin(0x1d4660), LT = lin(0xd6dadf), DK = lin(0x343a42);
      const FOOT = { hq: 5, power: 3, refinery: 4, barracks: 3, factory: 4, radar: 3, airfield: [6, 4], fob: 3, silo: 3 }, LIT = { g: 0.8 };
      const rings = (g, x, y0, z, h, rs) => rs.forEach((r, i) => g.add(new THREE.TorusGeometry(r, 0.018, 4, 18), x, y0 + h * (i + 1) / (rs.length + 1), z, A.glow, { rx: R90, g: 0.4 }));
      const SIGN = {
        hq: g => { g.cyl(0.02, 0.13, 1.6, -0.5, 2.72, 0.1, A.exo, { seg: 8 }); rings(g, -0.5, 1.92, 0.1, 1.4, [0.34, 0.24, 0.15]); },
        radar: g => { g.cyl(0.025, 0.04, 1.1, 0.6, 1.73, 0.5, A.exoDk, { seg: 6 }); rings(g, 0.6, 1.18, 0.5, 1.1, [0.22, 0.16, 0.1]); },
        factory: g => { for (const s2 of [-1, 1]) g.box(0.1, 1.6, 0.1, 1.85, 0.08, s2 * 1.25, A.exoDk); g.box(0.14, 0.12, 2.6, 1.85, 1.68, 0, A.exo); g.box(0.15, 0.03, 2.4, 1.85, 1.66, 0, A.glow, LIT); },
      };
      const NAMES = ['position', 'normal', 'color', 'aTeam', 'aGlow'];
      const concat = (a, b) => {
        const g = new THREE.BufferGeometry();
        for (const n of NAMES) { const x = a.attributes[n].array, y = b.attributes[n].array, arr = new Float32Array(x.length + y.length); arr.set(x); arr.set(y, x.length); g.setAttribute(n, new THREE.Float32BufferAttribute(arr, a.attributes[n].itemSize)); }
        return g;
      };
      for (const k of ['hq', 'power', 'refinery', 'barracks', 'factory', 'radar', 'airfield', 'fob', 'derrick', 'silo', 'bunker', 'atgun', 'sam']) {
        buildings[k + '@6'] = buildings[k].map(p => {
          let g = p.geo.clone();
          const c = g.attributes.color, gl = g.attributes.aGlow, tm = g.attributes.aTeam, v = [0, 0, 0];
          for (let j = 0; j < c.count; j++) {
            v[0] = c.getX(j); v[1] = c.getY(j); v[2] = c.getZ(j);
            if (tm.getX(j) > 0.9 || gl.getX(j) > 1 || KEEP.some(q2 => near(v, q2))) continue;
            if (near(v, GLASS)) { c.setXYZ(j, BLUE.r, BLUE.g, BLUE.b); continue; }
            if (near(v, YEL)) { c.setXYZ(j, GL.r, GL.g, GL.b); gl.setX(j, 0.35); continue; }
            const l = Math.min(1, Math.pow(0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2], 0.55) * 1.1);
            c.setXYZ(j, DK.r + (LT.r - DK.r) * l, DK.g + (LT.g - DK.g) * l, DK.b + (LT.b - DK.b) * l);
          }
          if (p.id === 'body' && FOOT[k]) {
            const [w, d] = [].concat(FOOT[k], FOOT[k]), add = G();
            for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = sx * (w / 2 - 0.12), z = sz * (d / 2 - 0.12); add.box(0.07, 0.62, 0.07, x, 0.08, z, A.exoDk); add.box(0.09, 0.05, 0.09, x, 0.7, z, A.glow, LIT); }
            if (SIGN[k]) SIGN[k](add);
            g = concat(g, add.finish());
          }
          return Object.assign({}, p, { geo: g });
        });
      }
    }

    // A building's model in an age is its own for that age if it has one, else the modern one.
    const ageKey = (kind, age) => buildings[kind + '@' + age] ? kind + '@' + age : kind;

    // Things in flight and marks of the pen, drawn in line as the units are: an arrow along x from its middle, a
    // thrown stone, and a stroke one long along x from its start, dark, or white to take the side's colour.
    const fx = {};
    {
      const a = G();
      a.box(0.4, 0.014, 0.014, -0.01, -0.007, 0, 0x2e251c);
      a.add(new THREE.ConeGeometry(0.024, 0.07, 5), 0.22, 0, 0, A.iron, { rz: -Math.PI / 2 });
      a.box(0.08, 0.05, 0.004, -0.17, -0.025, 0, A.linen); a.box(0.08, 0.004, 0.05, -0.17, -0.002, 0, A.linen);
      fx.arrow = a.finish();
      const s = new THREE.IcosahedronGeometry(0.11, 0).toNonIndexed(), sp = s.attributes.position;
      for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i), h = Math.sin(x * 71.3 + y * 37.9 + z * 19.7) * 43758.5, k = 0.8 + 0.35 * (h - Math.floor(h)); sp.setXYZ(i, x * k, y * k, z * k); }
      s.computeVertexNormals();
      fx.ball = G().add(s, 0, 0, 0, 0x7e786c).finish();
      fx.stroke = G().box(1, 1, 1, 0.5, -0.5, 0, 0x1e1a16).finish();
      fx.tstroke = G().box(1, 1, 1, 0.5, -0.5, 0, 0xffffff, { t: 1 }).finish();
    }

    return { units, buildings, man, chute, scenery, fx, ageKey };
  }

  return { make, P };
})();
if (typeof module !== 'undefined') module.exports = Models;
