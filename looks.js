// Looks: every way Mapmaker's War can be drawn, each a single definition, so a new style fits in without touching the
// rest of the game. world.js renders the scene, grades it and hands a look a kit of shared buffers. The HUD, the menu
// and the L key read the registry.
//
// Looks.add takes:
//   name, title       its key, and its name in the menu
//   said              what the HUD says when L cycles to it
//   hidden            true keeps it out of the menu and the cycle
//   panels            how the page dresses its panels: 'ink' for paper and ink, 'paint' for the default
//   hud               how the overlay draws: 'ink' for inked effects, ghost plans and the map key, 'paint' otherwise
//   camera(cam, smooth)  { fov, near, far, D, pitch } for the view, D the eye's distance from the point looked at;
//                     cam.dist is the zoom. The default is the 26 degree lens of the painted looks.
//   light(theme, SUN) the light it is lit by: a theatre with its sun, colours, sky and haze replaced. The theatre's
//                     own when absent.
//   sun(w)            the sun's direction now, given { cam, day, light, SUN, sunAt }. The light's sun when absent.
//   vivid             1 grades for clear full colour, 0 for the sunset's haze and bloom
//   sceneFog          false when the look paints the fog of war itself
//   ghost3d           false when the overlay draws a placement's plan and the 3D ghost is hidden
//   create(K)         builds its materials once from the kit K (see world.js) and returns { render(K) }, which draws
//                     the frame to the screen from K.ldr, the graded picture, and whatever buffers it asks the kit
//                     for. A look without it shows the graded picture as it is.
const Looks = (() => {
  const all = new Map();
  const base = { panels: 'paint', hud: 'paint', vivid: 0, sceneFog: true, ghost3d: true, hidden: false };
  return {
    add(def) { all.set(def.name, Object.assign({}, base, def)); },
    get(name) { return all.get(name) || all.get('ink'); },
    has(name) { return all.has(name); },
    // Every look, for the settings panel, which offers the ones the menu hides.
    all() { return [...all.values()].filter(l => l.name !== 'charcoal'); },
    // Whether the page is in its dark scheme, set from the system's or the player's choice.
    dark: false,
    list() { return [...all.values()].filter(l => !l.hidden); },
    // Paper to draw on: fine tooth in red, long streaks in green, broad smudges in blue. It tiles.
    paper(THREE) {
      const mulberry = Rules.mulberry, lerp = (a, b, t) => a + (b - a) * t;
      const n = 512, rand = mulberry(31), lat = p => { const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = rand(); return a; };
      const val = (g, p, x, y) => {
        const fx = x / n * p, fy = y / n * p, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
        const q = (a, b) => g[(((b % p) + p) % p) * p + (((a % p) + p) % p)];
        return lerp(lerp(q(ix, iy), q(ix + 1, iy), su), lerp(q(ix, iy + 1), q(ix + 1, iy + 1), su), sv);
      };
      const g1 = lat(256), g2 = lat(128), g3 = lat(64), s1 = lat(512), b1 = lat(8), b2 = lat(16), data = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const tooth = 0.45 * val(g1, 256, x, y) + 0.3 * val(g2, 128, x, y) + 0.25 * val(g3, 64, x, y);
        // Streaks run along x, long and thin, with a slow wander so they are not ruled lines.
        const streak = val(s1, 512, x * 0.04 + val(b2, 16, x, y) * 6, y);
        const blot = 0.6 * val(b1, 8, x, y) + 0.4 * val(b2, 16, x, y);
        const i = (y * n + x) * 4;
        data[i] = tooth * 255; data[i + 1] = streak * 255; data[i + 2] = blot * 255; data[i + 3] = 255;
      }
      const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
      return t;
    },
    // GLSL the passes share.
    GL: {
      // The way back from a pixel to the land, for passes that lay marks on it. The pass sets uInvVP, uW2S and uLev
      // with K.landUniforms.
      LAND: `
        uniform mat4 uInvVP; uniform vec4 uW2S; uniform float uLev;
        // The land under a pixel, where the ray from the eye meets the height the land pass left there. The ground's
        // marks are laid on it, so they keep their place on the land as the view zooms and turns.
        vec2 landAt(vec2 uv, float y) {
          vec4 a = uInvVP * vec4(uv * 2.0 - 1.0, -1.0, 1.0), b = uInvVP * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
          a.xyz /= a.w; b.xyz /= b.w;
          return mix(a.xz, b.xz, (y - a.y) / (b.y - a.y));
        }`,
      // The clouds, drawn as a cartoonist draws fair-weather cumulus: each a cluster of four round puffs, at most one
      // to a cell of 22 units, the cells drifting with the wind. uCloudT, the share of sky they cover, sets how many
      // cells hold a cloud and how big it is, and each cloud swells in or melts away as that share passes its own
      // mark. The pass declares uCloud and uCloudT.
      CLOUD: `
        float cloudAt(vec2 xz) {
          vec2 q = xz / 22.0 - uCloud * (1.0 / (0.006 * 22.0)), b = floor(q - 0.5);
          float cov = clamp((uCloudT - 0.1) * 2.0, 0.0, 1.0), d = 0.0;
          for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
            vec2 c = b + vec2(float(i), float(j));
            float h = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453), size = smoothstep(0.0, 0.15, cov - h * 0.95);
            if (size <= 0.0) continue;
            vec2 m = c + 0.5 + (vec2(fract(h * 17.31), fract(h * 41.17)) - 0.5) * 0.12;
            for (int k = 0; k < 4; k++) {
              float hk = fract(h * (13.7 + float(k) * 7.31)), r = (0.1 + 0.07 * hk) * (0.75 + 0.5 * cov) * size;
              vec2 o = (vec2(fract(hk * 23.1), fract(hk * 57.7)) - 0.5) * 0.3;
              d = max(d, 1.0 - smoothstep(r * 0.82, r, length(q - m - o)));
            }
          }
          return d;
        }`,
      // Value noise, its fractal sum, and luminance.
      NOISE: `
        float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`,
    },
  };
})();
if (typeof module !== 'undefined') module.exports = Looks;
