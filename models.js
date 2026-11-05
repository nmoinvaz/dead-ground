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
      // Upper arms hang from the shoulders, forearms come forward to the weapon.
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
      if (o.tool) { g.box(0.05, 0.1, 0.09, 0.02, hip - 0.02, 0.095, P.yellow); }
      return g;
    }
    const figure = (o, cloth) => [part('body', body(o)), part('leg', legs(cloth ?? o.cloth))];
    const man = {
      rifle: figure({ rifle: 0.22, pack: P.gear }),
      rocket: figure({ tube: true, rifle: 0, pack: P.gear }),
      engineer: figure({ cloth: 0x8a7a55, vest: P.yellow, vestT: 0, tool: true, helmetC: P.yellow, pack: P.gear }),
      sniper: figure({ cloth: 0x4b4f38, vest: 0x3f4430, rifle: 0.34, helmet: false, hair: 0x4b4f38 }),
      hero: [part('body', body({ cloth: 0xe7ddc4, sleeve: 0xe7ddc4, vest: 0, helmet: false, hair: 0x1d1612, glasses: true, rifle: 0.2 })), part('leg', legs(0x34506e))],
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
      const r = G();
      r.add(new THREE.DodecahedronGeometry(0.5, 0), 0, 0.26, 0, 0xffffff, { sy: 0.7 });
      r.add(new THREE.DodecahedronGeometry(0.3, 0), 0.34, 0.14, 0.14, 0xe0e0e0, { sy: 0.7, ry: 1 });
      scenery.rock = r.finish();
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
      scenery.deck = w.finish();
      const pier = G();
      pier.box(0.4, 2.4, 1.2, 0, -2.2, 0, P.concDk);
      scenery.pier = pier.finish();
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
      // A small car, along x, with dark glass and wheels.
      const car = G();
      car.box(1.0, 0.26, 0.5, 0, 0.1, 0, 0xffffff);
      car.box(0.52, 0.22, 0.46, -0.06, 0.36, 0, 0xffffff);
      car.box(0.02, 0.16, 0.4, 0.21, 0.39, 0, 0x404650, { rz: -0.5 });
      car.box(0.02, 0.16, 0.4, -0.33, 0.39, 0, 0x404650, { rz: 0.5 });
      for (const [x, z] of [[0.32, 0.26], [0.32, -0.26], [-0.32, 0.26], [-0.32, -0.26]]) car.cyl(0.1, 0.1, 0.06, x, 0.1, z, 0x2a2a2a, { axis: 'z', seg: 8 });
      scenery.car = car.finish();
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
    const soldier = (o) => {
      const b = body(Object.assign({ helmet: false, rifle: 0 }, o));
      hat(b, o.hat, o.crest);
      arms(b, o.arms);
      if (o.shield) SHIELD(b, o.shield);
      if (o.sash) b.box(0.02, 0.2, 0.16, 0.06, MAN_H * 0.5, 0, o.sash, { rx: 0.6 });
      return [part('body', b), part('leg', legs(o.legs ?? o.cloth))];
    };
    Object.assign(man, {
      spear: soldier({ cloth: A.tunic, vest: A.bronze, vestT: 0.4, hat: 'crest', arms: 'spear', shield: A.coatR }),
      pike: soldier({ cloth: A.tunic2, vest: A.mail, vestT: 0.3, hat: 'kettle', arms: 'pike' }),
      musket: soldier({ cloth: A.coatR, vest: A.white, vestT: 0, hat: 'tricorne', arms: 'musket', legs: A.white }),
      rifleman: soldier({ cloth: A.khaki, vest: A.field, hat: 'brodie', arms: 'musket', legs: A.khaki, pack: A.field }),
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

    // A horse along x, standing on the ground at (x, z). A lean saddle-cloth carries the side's colour.
    function horse(g, x, z, coat, o = {}) {
      g.box(0.44, 0.16, 0.15, x, 0.3, z, coat);
      g.sph(0.09, x + 0.19, 0.39, z, coat, { seg: 8, rings: 6 }); g.sph(0.09, x - 0.19, 0.39, z, coat, { seg: 8, rings: 6 });
      g.box(0.08, 0.22, 0.08, x + 0.27, 0.38, z, coat, { rz: -0.55 });
      g.box(0.16, 0.07, 0.07, x + 0.38, 0.55, z, coat, { rz: -0.45 });
      for (const [dx, dz] of [[0.17, 0.05], [0.17, -0.05], [-0.17, 0.05], [-0.17, -0.05]]) g.cyl(0.022, 0.018, 0.32, x + dx, 0.16, z + dz, coat, { seg: 5 });
      g.box(0.03, 0.18, 0.03, x - 0.26, 0.26, z, 0x2a2018, { rz: 0.45 });
      g.box(0.05, 0.12, 0.02, x + 0.24, 0.47, z, 0x2a2018, { rz: -0.55 });
      if (o.cloth !== false) g.box(0.24, 0.12, 0.17, x - 0.02, 0.36, z, o.cloth || A.coatR, o.armour ? { t: 0.6 } : TB);
    }
    // A rider seated on a horse at (x, z): body, head and hat, and what he carries.
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
      if (o.arms === 'lance') g.cyl(0.008, 0.012, 0.9, x + 0.22, y + 0.2, z - 0.06, A.woodDk, { axis: 'x', seg: 5 });
      if (o.arms === 'sword' || o.arms === 'sabre') g.box(0.014, 0.24, 0.03, x + 0.08, y + 0.26, z - 0.06, A.mail, { rz: -0.5 });
      if (o.arms === 'bow') for (let i = -2; i <= 2; i++) g.box(0.01, 0.07, 0.01, x + 0.1 - Math.abs(i) * 0.012, y + 0.16 + i * 0.07, z - 0.07, A.woodDk, { rz: i * 0.25 });
      if (o.arms === 'carbine') g.box(0.3, 0.016, 0.012, x + 0.1, y + 0.1, z - 0.07, A.wood);
      if (o.shield) g.cyl(0.08, 0.08, 0.014, x, y + 0.14, z + 0.09, o.shield, { axis: 'z', seg: 12, t: 0.5 });
    }
    // Riders three abreast in a wedge, the leader ahead.
    function troop(o, coat) {
      const g = G();
      for (const [x, z] of [[0.2, 0], [-0.25, 0.3], [-0.25, -0.3]]) { horse(g, x, z, coat, o); rider(g, x - 0.02, z, o); }
      return g;
    }
    units.outrider = [part('hull', troop({ cloth: A.tunic, arms: 'bow', hat: 'crest', cloth2: false }, 0x8a6a4a))];
    units.knight = [part('hull', troop({ cloth: A.mail, vest: A.coatR, hat: 'knight', arms: 'lance', shield: A.white, armour: true }, 0x5a4a3a))];
    units.cuirassier = [part('hull', troop({ cloth: A.coatB, vest: A.mail, hat: 'helm', arms: 'sabre', legs: A.white }, 0x3a2a20))];
    units.dragoon = [part('hull', troop({ cloth: A.coatG, hat: 'tricorne', arms: 'carbine', legs: A.white }, 0x6b4a32))];

    // Wheels of wood, spoked.
    function cartWheel(g, x, z, r = 0.2, w = 0.04) {
      g.cyl(r, r, w, x, r, z, A.woodDk, { axis: 'z', seg: 14 });
      g.cyl(r * 0.25, r * 0.25, w + 0.03, x, r, z, A.iron, { axis: 'z', seg: 8 });
      for (let i = 0; i < 4; i++) g.box(0.012, r * 1.8, w + 0.01, x, r - r * 0.9, z, A.wood, { rz: i * 0.785 });
    }
    // An ox, stockier than a horse, with horns.
    function ox(g, x, z) {
      g.box(0.46, 0.2, 0.2, x, 0.24, z, A.ox); g.sph(0.11, x + 0.2, 0.36, z, A.ox, { seg: 8, rings: 6 });
      g.box(0.14, 0.1, 0.1, x + 0.32, 0.32, z, A.ox, { rz: -0.3 });
      for (const s of [-1, 1]) g.cyl(0.008, 0.012, 0.1, x + 0.3, 0.42, z + s * 0.07, A.ivory, { rx: s * 1.1, seg: 4 });
      for (const [dx, dz] of [[0.17, 0.07], [0.17, -0.07], [-0.17, 0.07], [-0.17, -0.07]]) g.cyl(0.03, 0.025, 0.26, x + dx, 0.13, z + dz, A.ox, { seg: 5 });
    }
    // A load of ore that shows while it is carried.
    const oreLoad = (pts, y) => { const l = G(); for (const r of pts) l.add(new THREE.DodecahedronGeometry(r[2], 0), r[0], y, r[1], P.ore, { ry: r[0] * 7, g: 0.12 }); return l; };

    // Ox cart: an ox before a two-wheeled cart.
    {
      const b = G();
      ox(b, 0.32, 0);
      cartWheel(b, -0.3, 0.28, 0.2); cartWheel(b, -0.3, -0.28, 0.2);
      b.box(0.62, 0.05, 0.48, -0.3, 0.28, 0, A.wood, T);
      for (const s of [-1, 1]) b.box(0.62, 0.12, 0.03, -0.3, 0.33, s * 0.24, A.woodDk, T);
      for (const s of [-1, 1]) b.box(0.5, 0.025, 0.025, 0.12, 0.3, s * 0.12, A.woodDk);
      mark(b, 0.2, 0.3, -0.5, 0.45, 0);
      units.oxcart = [part('hull', b), part('load', oreLoad([[-0.42, 0.1, 0.1], [-0.2, -0.08, 0.12], [-0.3, 0.12, 0.09]], 0.4), { pivot: [0, 0, 0], load: true })];
    }
    // Ore wagon: two horses before a four-wheeled wagon.
    {
      const b = G();
      horse(b, 0.62, 0.12, 0x6b4a32, { cloth: false }); horse(b, 0.62, -0.12, 0x3a2a20, { cloth: false });
      for (const x of [-0.08, -0.62]) for (const s of [-1, 1]) cartWheel(b, x, s * 0.3, 0.17);
      b.box(0.8, 0.06, 0.5, -0.35, 0.3, 0, A.wood, T);
      for (const s of [-1, 1]) b.box(0.8, 0.16, 0.03, -0.35, 0.36, s * 0.25, A.woodDk, T);
      b.box(0.03, 0.16, 0.5, 0.05, 0.36, 0, A.woodDk, T);
      mark(b, 0.2, 0.3, -0.75, 0.52, 0);
      units.wagon = [part('hull', b), part('load', oreLoad([[-0.55, 0.1, 0.12], [-0.3, -0.1, 0.13], [-0.12, 0.08, 0.11], [-0.42, -0.02, 0.1]], 0.45), { pivot: [0, 0, 0], load: true })];
    }
    // Supply cart: a covered wagon with the side's cross on its canvas.
    {
      const b = G();
      horse(b, 0.55, 0, 0x8a6a4a, { cloth: false });
      for (const s of [-1, 1]) cartWheel(b, -0.3, s * 0.27, 0.2);
      b.box(0.66, 0.06, 0.46, -0.3, 0.28, 0, A.wood);
      b.cyl(0.23, 0.23, 0.62, -0.3, 0.36, 0, A.canvas, { axis: 'x', seg: 12, sy: 1.15 });
      for (const s of [-1, 1]) { b.box(0.04, 0.14, 0.012, -0.3, 0.42, s * 0.235, P.red, TB); b.box(0.14, 0.04, 0.012, -0.3, 0.47, s * 0.235, P.red, TB); }
      units.supcart = [part('hull', b)];
    }
    // Chariot: two horses and a light car with a driver and an archer.
    {
      const b = G();
      horse(b, 0.42, 0.13, 0x6b4a32); horse(b, 0.42, -0.13, 0x8a6a4a);
      for (const s of [-1, 1]) cartWheel(b, -0.22, s * 0.24, 0.17, 0.03);
      b.box(0.26, 0.05, 0.4, -0.2, 0.26, 0, A.wood, T);
      b.prism([[-0.34, 0], [-0.34, 0.16], [-0.06, 0.2], [-0.04, 0]], 0.4, 0, 0.3, 0, A.bronze, T);
      b.box(0.5, 0.02, 0.02, 0.1, 0.3, 0, A.woodDk);
      rider(b, -0.22, 0.08, { cloth: A.linen, hat: 'crest' }); rider(b, -0.22, -0.08, { cloth: A.tunic, hat: 'crest', arms: 'bow' });
      units.chariot = [part('hull', b)];
    }
    // War elephant: a great beast with tusks and a howdah of archers, its cloth in the side's colour.
    {
      const b = G();
      b.sph(0.42, 0, 0.72, 0, A.hide, { seg: 12, rings: 8, sx: 1.35, sz: 0.8 });
      for (const [dx, dz] of [[0.32, 0.18], [0.32, -0.18], [-0.32, 0.18], [-0.32, -0.18]]) b.cyl(0.09, 0.085, 0.5, dx, 0.25, dz, A.hide, { seg: 8 });
      b.sph(0.22, 0.58, 0.86, 0, A.hide, { seg: 10, rings: 8 });
      for (const s of [-1, 1]) b.cyl(0.16, 0.16, 0.02, 0.5, 0.88, s * 0.2, A.hide, { axis: 'z', seg: 10, sx: 0.8 });
      b.cyl(0.05, 0.03, 0.5, 0.78, 0.62, 0, A.hide, { seg: 7, rz: 0.25 });
      for (const s of [-1, 1]) b.cyl(0.012, 0.02, 0.3, 0.76, 0.66, s * 0.08, A.ivory, { seg: 5, rz: -1.1 });
      b.box(0.7, 0.3, 0.7, -0.05, 0.92, 0, A.coatR, TB);
      b.box(0.5, 0.2, 0.5, -0.05, 1.1, 0, A.wood, T);
      for (const [dx, dz] of [[0.2, 0.2], [0.2, -0.2], [-0.25, 0.2], [-0.25, -0.2]]) b.box(0.025, 0.24, 0.025, dx, 1.3, dz, A.woodDk);
      b.box(0.56, 0.03, 0.56, -0.05, 1.54, 0, A.canvas, T);
      b.cyl(0.04, 0.035, 0.14, -0.05, 1.37, 0.08, A.tunic, { seg: 6 }); b.sph(0.035, -0.05, 1.47, 0.08, P.skin, { seg: 6, rings: 4 });
      b.cyl(0.04, 0.035, 0.14, -0.05, 1.37, -0.1, A.linen, { seg: 6 }); b.sph(0.035, -0.05, 1.47, -0.1, P.skin, { seg: 6, rings: 4 });
      b.box(0.03, 0.18, 0.03, -0.54, 0.62, 0, 0x3a3634, { rz: 0.4 });
      units.elephant = [part('hull', b)];
    }
    // Catapult: a wheeled frame and a throwing arm cocked back, a stone in its cup.
    {
      const b = G();
      for (const x of [0.28, -0.3]) for (const s of [-1, 1]) cartWheel(b, x, s * 0.3, 0.14, 0.04);
      for (const s of [-1, 1]) b.box(0.9, 0.06, 0.06, 0, 0.22, s * 0.24, A.wood, T);
      for (const x of [-0.36, 0.34]) b.box(0.06, 0.05, 0.54, x, 0.24, 0, A.wood);
      for (const s of [-1, 1]) b.box(0.06, 0.34, 0.05, 0.12, 0.26, s * 0.2, A.woodDk, { rz: -0.15 });
      b.box(0.06, 0.06, 0.44, 0.14, 0.58, 0, A.woodDk);
      b.box(0.72, 0.045, 0.045, -0.12, 0.34, 0, A.wood, { rz: -0.42 });
      b.cyl(0.07, 0.05, 0.06, -0.42, 0.24, 0, A.woodDk, { seg: 8 }); b.sph(0.06, -0.42, 0.3, 0, 0x9a9488, { seg: 6, rings: 4 });
      b.cyl(0.05, 0.05, 0.44, 0.0, 0.3, 0, A.rope, { axis: 'z', seg: 8 });
      mark(b, 0.16, 0.16, 0.38, 0.29, 0);
      units.catapult = [part('hull', b)];
    }
    // Trebuchet: a tall A-frame, a long arm and a box of counterweight.
    {
      const b = G();
      for (const x of [0.4, -0.4]) for (const s of [-1, 1]) cartWheel(b, x, s * 0.34, 0.13, 0.04);
      for (const s of [-1, 1]) { b.box(1.0, 0.07, 0.07, 0, 0.2, s * 0.28, A.wood, T); b.box(0.07, 0.95, 0.07, 0.14, 0.24, s * 0.26, A.woodDk, { rz: -0.32 }); b.box(0.07, 0.95, 0.07, -0.14, 0.24, s * 0.26, A.woodDk, { rz: 0.32 }); }
      b.cyl(0.035, 0.035, 0.6, 0, 1.08, 0, A.iron, { axis: 'z', seg: 6 });
      b.box(1.5, 0.06, 0.06, -0.1, 1.04, 0, A.wood, { rz: 0.42 });
      b.box(0.3, 0.28, 0.3, 0.42, 1.04, 0, A.woodDk, T);
      b.box(0.02, 0.5, 0.02, -0.74, 0.62, 0, A.rope, { rz: 0.1 });
      mark(b, 0.2, 0.2, 0.42, 1.33, 0);
      units.trebuchet = [part('hull', b)];
    }
    // Cannon: a black barrel on a two-wheeled carriage with its trail on the ground.
    {
      const b = G();
      for (const s of [-1, 1]) cartWheel(b, 0, s * 0.24, 0.22, 0.05);
      b.box(0.8, 0.07, 0.24, -0.25, 0.14, 0, A.wood, Object.assign({ rz: 0.18 }, T));
      b.cyl(0.07, 0.085, 0.72, 0.22, 0.34, 0, 0x2a2826, { axis: 'x', seg: 12 });
      b.cyl(0.095, 0.095, 0.04, 0.58, 0.34, 0, 0x2a2826, { axis: 'x', seg: 12 });
      b.sph(0.08, -0.15, 0.34, 0, 0x2a2826, { seg: 8, rings: 6 });
      for (const [x, z] of [[-0.5, 0.18], [-0.56, 0.08]]) b.sph(0.05, x, 0.06, z, 0x2a2826, { seg: 6, rings: 4 });
      mark(b, 0.16, 0.16, -0.36, 0.26, 0, { rz: 0.18 });
      units.cannonart = [part('hull', b)];
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
      for (const s of [-1, 1]) {
        b.box(0.34, 0.06, 0.2, 0.04, 0, s * 0.26, A.exoDk);
        b.box(0.1, 0.4, 0.12, -0.02, 0.06, s * 0.26, A.exo, Object.assign({ rz: 0.18 }, T));
        b.box(0.12, 0.36, 0.14, 0.02, 0.42, s * 0.26, A.exo, Object.assign({ rz: -0.22 }, T));
        b.sph(0.08, 0.06, 0.44, s * 0.26, A.exoDk, { seg: 8, rings: 6 });
      }
      b.box(0.3, 0.12, 0.5, 0, 0.74, 0, A.exoDk);
      const t = G();
      t.box(0.6, 0.32, 0.56, -0.02, 0, 0, A.exo, T);
      t.box(0.02, 0.08, 0.36, 0.29, 0.18, 0, A.glow, GLOW);
      mark(t, 0.3, 0.3, -0.1, 0.32, 0);
      for (const s of [-1, 1]) { t.box(0.2, 0.18, 0.12, 0.04, 0.06, s * 0.36, A.exoDk); t.box(0.56, 0.05, 0.05, 0.36, 0.14, s * 0.36, A.exoDk); t.box(0.3, 0.014, 0.054, 0.4, 0.17, s * 0.36, A.glow, GLOW); }
      units.mech = [part('hull', b), part('turret', t, { pivot: [0, 0.82, 0], aim: true })];
    }
    // Titan: a four-legged walking fortress with twin rails and a pulse gun.
    {
      const b = G();
      for (const [x, z] of [[0.6, 0.55], [0.6, -0.55], [-0.6, 0.55], [-0.6, -0.55]]) {
        b.box(0.3, 0.08, 0.3, x * 1.15, 0, z * 1.15, A.exoDk);
        b.box(0.14, 0.62, 0.14, x * 1.05, 0.06, z * 1.05, A.exo, Object.assign({ rz: x * 0.25, rx: -z * 0.25 }, T));
        b.box(0.18, 0.5, 0.18, x * 0.8, 0.6, z * 0.8, A.exo, Object.assign({ rz: -x * 0.3, rx: z * 0.3 }, T));
      }
      b.box(1.6, 0.42, 1.2, 0, 0.9, 0, A.exoDk);
      b.box(1.5, 0.08, 1.1, 0, 1.32, 0, A.exo, T);
      for (const s of [-1, 1]) b.box(1.4, 0.04, 0.02, 0, 1.1, s * 0.61, A.glow, GLOW);
      mark(b, 0.5, 0.5, -0.4, 1.4, 0);
      const t = G();
      t.cyl(0.42, 0.46, 0.22, 0, 0, 0, A.exo, T); t.box(0.7, 0.26, 0.6, 0.08, 0.1, 0, A.exoDk);
      t.box(0.02, 0.08, 0.4, 0.43, 0.22, 0, A.glow, GLOW);
      const gn = G(); for (const s of [-1, 1]) { gn.box(1.2, 0.08, 0.08, 0.6, 0, s * 0.16, A.exoDk); gn.box(0.8, 0.02, 0.09, 0.66, 0.05, s * 0.16, A.glow, GLOW); }
      units.titan = [part('hull', b), part('turret', t, { pivot: [0, 1.38, 0], aim: true }), part('gun', gn, { parent: 'turret', pivot: [0.3, 0.18, 0], recoil: 0.08 })];
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

    return { units, buildings, man, chute, scenery };
  }

  return { make, P };
})();
if (typeof module !== 'undefined') module.exports = Models;
