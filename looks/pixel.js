// Pixel art: the graded picture drawn again at a low resolution, each pixel a block of the screen, its colour
// snapped to a palette, with ordered dither on the land, banded light on what stands on it, and outlines round
// units and buildings. Four variants, from 1990s VGA to a modern hi-bit, chosen by `px` on the look.
(() => {
  const MAXP = 128;
  const hex = s => s.match(/../g).map(h => parseInt(h, 16) / 255);
  const rgbOf = n => [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  const hslOf = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const hsl = (h, s, l) => { const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))); };
  const toward = (h, to, t) => { const d = ((to - h + 540) % 360) - 180; return (h + d * t + 360) % 360; };
  // A ramp of n shades through a colour, as pixel artists build one: darker shades turn toward blue-violet and
  // lighter ones toward a warm yellow, most saturated in the middle.
  function ramp(c, n, lo = 0.12, hi = 0.9) {
    const [h, s] = hslOf(rgbOf(c)), out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), hh = t < 0.5 ? toward(h, 250, (0.5 - t) * 0.4) : toward(h, 55, (t - 0.5) * 0.3);
      out.push(hsl(hh, Math.min(1, s * (1.15 - Math.abs(t - 0.5) * 0.9)), lo + (hi - lo) * t));
    }
    return out;
  }
  // The palette of a theatre: ramps through its ground, rocks, banks, roads, water and leaves, three shades of each
  // side's colour, fire, and a few greys. A few-colour palette keeps four ramps, two shades a side and four greys.
  function paletteOf(th, sides, n, few) {
    const out = [], land = few ? [th.ground[0], th.road, th.water[0], th.leaf[0]] : [th.ground[0], th.ground[1], th.patch, th.rock, th.bank, th.road, th.stain, th.water[0], th.water[1], th.leaf[0], th.leaf[1]];
    for (const c of land) out.push(...ramp(c, n));
    for (const c of sides) out.push(...(few ? ramp(c, 2, 0.3, 0.62) : ramp(c, 3, 0.25, 0.7)));
    out.push(...ramp(0xf08a1c, few ? 2 : 3, 0.4, 0.85));
    out.push(...(few ? [[0.06, 0.05, 0.08], [0.36, 0.36, 0.39], [0.66, 0.66, 0.68], [0.95, 0.94, 0.91]] : [[0.06, 0.05, 0.08], [0.28, 0.28, 0.31], [0.52, 0.52, 0.55], [0.76, 0.76, 0.78], [0.96, 0.95, 0.92]]));
    return out.slice(0, MAXP);
  }
  // The variants. P is the size of a pixel in screen pixels at 1080 lines; shades is the length of each ramp of the
  // theatre's palette, or pal a fixed palette; out is 1 for black outlines and 2 for outlines in a darker shade of
  // the thing itself; outMin the least line category outlined (units 1, buildings 0.75, trees 0.46); few keeps the
  // palette to about thirty colours.
  const VARIANTS = [
    { name: 'VGA 1996', P: 3, shades: 7, dith: 0.06, bands: 0, sat: 0.95, out: 1, outMin: 0.7 },
    { name: '16-bit', P: 4, shades: 4, dith: 0.1, bands: 4, sat: 1.15, out: 1, outMin: 0.4 },
    { name: 'Hi-bit', P: 2, shades: 6, dith: 0.04, bands: 5, sat: 1.08, out: 2, outMin: 0.4 },
    { name: '8-bit', P: 5, shades: 3, few: true, dith: 0.16, bands: 3, sat: 1.2, out: 1, outMin: 0.7 },
  ];
  const def = {
    name: 'pixel', title: 'Pixel', said: 'Pixel art.', vivid: 1, hidden: true, px: 1, variants: VARIANTS.map(v => v.name),
    // The pen and ink look's camera, so only the drawing changes.
    camera: (c, smooth) => Looks.get('ink').camera(c, smooth),
    // A clear day, as the painted Daylight, so the palette has full colour to snap.
    light: (th, SUN) => Object.assign({}, th, {
      name: th.name + ' day', sun: SUN(-0.62, 0.82), sunColor: 0xfff2dc, sunPower: 3.2, hemi: [0x8db4ee, 0x6a5a46, 1.1],
      env: [0x4f7fb2, 0xc2d6ea, 0x584a3a], haze: 0xc4d8ee, hazeK: 0.0035,
    }),
    create(K) {
      const { THREE, vs } = K;
      const pal = Array.from({ length: MAXP }, () => new THREE.Vector3());
      const low = new THREE.ShaderMaterial({ vertexShader: vs, depthTest: false, depthWrite: false, uniforms: {
        t: { value: null }, tM: { value: null }, lo: { value: new THREE.Vector2(1, 1) }, hi: { value: new THREE.Vector2(1, 1) }, P: { value: 3 },
        pal: { value: pal }, uN: { value: 0 }, uDith: { value: 0 }, uBands: { value: 0 }, uSat: { value: 1 },
        uOut: { value: 1 }, uOutMin: { value: 0.7 },
      }, fragmentShader: `
        varying vec2 vUv; uniform sampler2D t, tM; uniform vec2 lo, hi; uniform float P, uDith, uBands, uSat, uOutMin; uniform vec3 pal[${MAXP}]; uniform int uN, uOut;
        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        // The 4 by 4 ordered dither threshold of a pixel.
        float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
        // The nearest palette colour, by a distance weighted as the eye weighs the channels.
        vec3 snap(vec3 c) {
          float bd = 1e9; vec3 b = c;
          for (int i = 0; i < ${MAXP}; i++) { if (i >= uN) break; vec3 d = c - pal[i]; float e = dot(d * d, vec3(2.0, 4.0, 3.0)); if (e < bd) { bd = e; b = pal[i]; } }
          return b;
        }
        void main() {
          vec2 cell = floor(vUv * lo), suv = (cell + 0.5) * P / hi, o = 0.25 * P / hi, s = vec2(P) / hi;
          // The block's colour, from four taps of the linear picture, near enough its average.
          vec3 c = (texture2D(t, suv + vec2(-o.x, -o.y)).rgb + texture2D(t, suv + vec2(o.x, -o.y)).rgb + texture2D(t, suv + vec2(-o.x, o.y)).rgb + texture2D(t, suv + vec2(o.x, o.y)).rgb) * 0.25;
          float a = texture2D(tM, suv).a;
          float n4 = min(min(texture2D(tM, suv - vec2(s.x, 0.0)).a, texture2D(tM, suv + vec2(s.x, 0.0)).a), min(texture2D(tM, suv - vec2(0.0, s.y)).a, texture2D(tM, suv + vec2(0.0, s.y)).a));
          float obj = step(uOutMin, a), edge = obj * step(0.08, a - n4);
          float l = luma(c);
          c = clamp(mix(vec3(l), c, uSat), 0.0, 1.0);
          // What stands on the land is lit in a few flat bands, and the land is dithered between its colours.
          if (uBands > 0.0 && a > 0.4) { float lb = max(floor(l * uBands + 0.5) / uBands, 0.5 / uBands); c = clamp(c * lb / max(l, 0.03), 0.0, 1.0); }
          else c = clamp(c + (bayer4(cell) - 0.5) * uDith, 0.0, 1.0);
          c = snap(c);
          // Outlines on the edge pixels of units and buildings: black, or a dark shade of the thing's own colour.
          if (edge > 0.5) c = uOut == 1 ? vec3(0.06, 0.05, 0.08) : snap(c * 0.42 + vec3(0.0, 0.0, 0.04));
          gl_FragColor = vec4(c, 1.0);
        }` });
      const up = new THREE.ShaderMaterial({ vertexShader: vs, depthTest: false, depthWrite: false, uniforms: {
        tL: { value: null }, lo: { value: new THREE.Vector2(1, 1) }, hi: { value: new THREE.Vector2(1, 1) }, P: { value: 3 },
      }, fragmentShader: `
        varying vec2 vUv; uniform sampler2D tL; uniform vec2 lo, hi; uniform float P;
        void main() { gl_FragColor = texture2D(tL, (floor(vUv * hi / P) + 0.5) / lo); }` });
      let rt = null, shown = '';
      return {
        render(K) {
          const n = Looks.get('pixel').px, v = VARIANTS[n] || VARIANTS[1], P = Math.max(1, Math.round(v.P * K.h / 1080)), lw = Math.ceil(K.w / P), lh = Math.ceil(K.h / P);
          if (!rt || rt.width !== lw || rt.height !== lh) {
            if (rt) rt.dispose();
            rt = new THREE.WebGLRenderTarget(lw, lh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
          }
          const L = low.uniforms;
          // The palette is made again when the variant, the theatre or a side's colour changes.
          const sides = K.sides, key = n + ' ' + (K.theme && K.theme.name) + ' ' + sides.join();
          if (shown !== key && K.theme) {
            shown = key;
            const p = paletteOf(K.theme, sides, v.shades, v.few);
            p.forEach((c, i) => pal[i].set(c[0], c[1], c[2]));
            L.uN.value = p.length;
            L.uDith.value = v.dith; L.uBands.value = v.bands; L.uSat.value = v.sat; L.uOut.value = v.out; L.uOutMin.value = v.outMin;
          }
          L.t.value = K.ldr.texture; L.tM.value = K.mask(); L.lo.value.set(lw, lh); L.hi.value.set(K.w, K.h); L.P.value = P;
          K.run(low, rt);
          const U = up.uniforms;
          U.tL.value = rt.texture; U.lo.value.set(lw, lh); U.hi.value.set(K.w, K.h); U.P.value = P;
          K.run(up, null);
        },
      };
    },
  };
  Looks.add(def);
})();
