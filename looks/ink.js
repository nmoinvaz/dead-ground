// Pen and ink, after the Lightning film: the default look. A long lens nearly an axonometric, the sun turning with
// the hour, the fog of war and placement plans drawn by the pass and the overlay, and the ink pass over it all.
(() => {
  const GL = Looks.GL;
  Looks.add({
    name: 'ink', title: 'Pen and ink', said: 'Pen and ink.', panels: 'ink', hud: 'ink', sceneFog: false, ghost3d: false,
    // Blasts: no burst drawn over the scene, fire in bands of coloured ink, and scorch hatched in the pass.
    fx: 4, fxs: 2, fire: 0, burstLife: 2.5,
    // Tread marks drawn by the pass alone, with the ground left undarkened under them so they take no outline.
    treadK: 0,
    // Survey inks, each family of things in its own colour, and units drawn in their side's ink on bare paper.
    inks: 1, units: 1,
    // The lens stands back as far again as frames the same ground, so everything sized by cam.dist holds.
    camera: (c, smooth) => ({ fov: 10, near: 5, far: 1400, D: c.dist * Math.tan(13 * Math.PI / 180) / Math.tan(5 * Math.PI / 180), pitch: c.pitch + (1.4 - c.pitch) * smooth(70, 175, c.dist) }),
    sun: w => w.sunAt(w.day),
    create(K) {
      const { THREE, SH, vs } = K;
      // Pen and ink, after the Lightning film and js/ink.js: tone in seven steps of hatching on cream paper, at
      // 45 and 135 degrees, then flat and upright lines for the darkest, each line a little uneven with small gaps.
      // The ground's hatching is pinned to the map so it pans with it, the units' redraws a few times a second.
      const ink = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, tSubj: { value: null }, tHeat: { value: null }, tPaper: { value: null }, res: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uK: { value: 1 }, uOff: { value: new THREE.Vector2() }, uStyle: { value: 8 }, tNorm: { value: null }, tFogS: { value: null }, tLand: { value: null }, uSun2: { value: new THREE.Vector2(-1, 0) }, uUpV: { value: new THREE.Vector3(0, 1, 0) }, uRoad: { value: 0 }, uOre: { value: 0 }, uMarks: { value: 1 },
        uWindS: { value: new THREE.Vector2() }, uView: { value: new THREE.Vector2(1, 0) }, tFx: { value: null }, tAnc: { value: null }, uDark: { value: 0 }, uInks: { value: 0 }, uFxs: { value: 0 }, uFire: { value: 0 }, uUnits: { value: 0 }, tH: SH.tH, uHSize: { value: new THREE.Vector2(1, 1) }, uHScale: { value: 1 }, uRain: { value: 0 }, uStorm: { value: 0 }, uSnowF: { value: 0 }, uSnowC: SH.uSnowC, uFog: { value: 0 }, uMist: { value: 0 }, uNight: { value: 0 }, uWet: { value: 0 },
        uDayMul: { value: new THREE.Vector3(1, 1, 1) }, uDayAdd: { value: new THREE.Vector3() }, uWaterL: { value: -0.15 }, uCloudK: SH.uCloudK, tMarks: SH.tMarks, uMap: SH.uMap,
        uCloud: SH.uCloud, uCloudT: SH.uCloudT, uSunW: SH.uSunDir, uCloudA: { value: 0 }, uCloudG: { value: 0 }, uRayK: { value: 0 }, uSand: { value: 0 },
        uInvVP: { value: new THREE.Matrix4() }, uW2S: { value: new THREE.Vector4(1, 0, 0, 1) }, uLev: { value: 1 }, tTerr: SH.tTerr, uBorder: SH.uBorder, uMe: { value: 0 },
        // Each side's colour as the anchor pass keeps it, its hue and how coloured it is, and its inks on either paper.
        uSideKey: { value: [...Array(8)].map(() => new THREE.Vector2()) }, uSideL: { value: [...Array(8)].map(() => new THREE.Vector3()) }, uSideD: { value: [...Array(8)].map(() => new THREE.Vector3()) }, uSideB: { value: [...Array(8)].map(() => new THREE.Vector3()) } }, vertexShader: vs, depthTest: false, depthWrite: false, fragmentShader: `
        varying vec2 vUv; uniform sampler2D t, tSubj, tHeat, tPaper, tNorm, tFogS, tLand, tMarks; uniform float uMap; uniform vec2 res, uOff, uSun2, uWindS, uView, uHSize; uniform float uHScale, uFxs, uFire; uniform int uUnits, uInks; uniform float uDark; uniform sampler2D tH, tFx, tAnc; uniform vec3 uUpV, uDayMul, uDayAdd; uniform float uTime, uK, uRain, uStorm, uSnowF, uSnowC, uFog, uMist, uNight, uWet, uWaterL, uCloudK, uMarks; uniform int uStyle, uRoad, uOre;
        uniform vec2 uSideKey[8]; uniform vec3 uSideL[8], uSideD[8], uSideB[8];
        uniform sampler2D tTerr; uniform float uBorder, uMe;
        uniform vec2 uCloud; uniform vec3 uSunW; uniform float uCloudT, uCloudA, uCloudG, uRayK, uSand;
        // The clouds float at CLOUD_H over the land. cloudAt gives the cloud over a point of the land at that height,
        // taken from the same field the land pass casts their shadows with, shifted along the sun, so each cloud
        // drifts over its own shadow.
        const float CLOUD_H = 26.0;
        ${GL.CLOUD}
        // A unit's ink, from the side whose hue and colourfulness lie nearest its anchor's. Hue tells most sides
        // apart, and colourfulness tells brown from orange. A colour faded to grey, as a burning wreck's, takes the
        // paper's plain ink.
        vec3 sideInk(vec4 aw, bool dk) {
          float best = 1e9; vec3 c = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            float dh = abs(aw.z - uSideKey[i].x); dh = min(dh, 1.0 - dh) * 36.0;
            float ds = (aw.w - uSideKey[i].y) * 20.0, d = dh * dh + ds * ds;
            if (d < best) { best = d; c = dk ? uSideD[i] : uSideL[i]; }
          }
          return mix(dk ? vec3(0.88) : vec3(0.12), c, smoothstep(0.15, 0.4, aw.w));
        }
        // A unit's body tint on light paper, from the same nearest side. A colour faded to grey keeps the paper.
        vec3 sideBody(vec4 aw) {
          float best = 1e9; vec3 c = vec3(1.0);
          for (int i = 0; i < 8; i++) {
            float dh = abs(aw.z - uSideKey[i].x); dh = min(dh, 1.0 - dh) * 36.0;
            float ds = (aw.w - uSideKey[i].y) * 20.0, d = dh * dh + ds * ds;
            if (d < best) { best = d; c = uSideB[i]; }
          }
          return mix(vec3(0.949, 0.910, 0.824), c, smoothstep(0.15, 0.4, aw.w));
        }
        const vec3 PAPER = vec3(0.949, 0.910, 0.824), INK = vec3(0.122, 0.102, 0.086);
        // The soft axonometric's washes, after the atlas: speckled pale green ground, lilac water, pink paths,
        // three canopy greens, cream roofs over warm grey walls, and the ghost plan's blue-grey for what was.
        const vec3 SOFT_G = vec3(0.905, 0.935, 0.845), OLIVE = vec3(0.353, 0.431, 0.235);
        const vec3 LILAC = vec3(0.788, 0.804, 0.902), LILAC_D = vec3(0.46, 0.5, 0.7), PINK = vec3(0.863, 0.722, 0.655), PINK_D = vec3(0.588, 0.392, 0.333);
        const vec3 TREE1 = vec3(0.663, 0.78, 0.498), TREE2 = vec3(0.737, 0.831, 0.592), TREE3 = vec3(0.561, 0.706, 0.408);
        const vec3 ROOF = vec3(0.969, 0.953, 0.918), WALL_L = vec3(0.894, 0.863, 0.796), WALL_R = vec3(0.804, 0.757, 0.671);
        const vec3 WAS = vec3(0.427, 0.51, 0.678);
        // The dark scheme's own palette: warm charcoal paper and pale ink, the page's CSS paper and ink.
        const vec3 DPAPER = vec3(0.15, 0.137, 0.118), DINK = vec3(0.91, 0.88, 0.81), SLATE = vec3(0.215, 0.235, 0.27);
        ${GL.NOISE}
        float L(vec2 uv) { return dot(texture2D(t, uv).rgb, vec3(0.299, 0.587, 0.114)); }
        float A(vec2 uv) { return texture2D(tSubj, uv).a; }
        // Scenery, buildings and units only, for outlines that leave the water mesh's edge alone.
        float AS(vec2 uv) { float a = A(uv); return a * step(0.3, a); }
        // Ore, on its own value in the scenery band.
        float oA(vec2 uv) { return 1.0 - smoothstep(0.02, 0.035, abs(A(uv) - 0.55)); }
        // The water's surface, on its own band below the scenery.
        float wBand(vec2 uv) { float a = A(uv); return smoothstep(0.08, 0.15, a) * (1.0 - smoothstep(0.3, 0.37, a)); }
        float Ls(vec2 uv, vec2 k) { return (L(uv) * 2.0 + L(uv + k * vec2(2.5, 0)) + L(uv - k * vec2(2.5, 0)) + L(uv + k * vec2(0, 2.5)) + L(uv - k * vec2(0, 2.5))) / 6.0; }
        // One set of parallel lines: ang in degrees, d the spacing and w the width, in px at 1080p.
        float hatch(vec2 p, float ang, float d, float w, float seed, float gaps) {
          float a = radians(ang);
          vec2 dir = vec2(cos(a), sin(a)), nrm = vec2(-dir.y, dir.x);
          d *= uK; w *= uK;
          float along = dot(p, dir), across = dot(p, nrm), idx = floor(across / d);
          float ph = hash(vec2(idx, seed)) * 6.283, amp = (0.28 + 0.2 * hash(vec2(idx, seed + 1.0))) * uK * 0.8;
          float wob = amp * sin(along / (48.0 * uK) * 12.566 + ph) + 0.18 * uK * sin(along / (48.0 * uK) * 31.4 + ph * 2.0);
          float f = abs(fract((across + wob) / d) - 0.5) * d;
          float lw = w * (0.8 + 0.4 * hash(vec2(idx, seed + 2.0)));
          float line = 1.0 - smoothstep(lw * 0.5 - 0.55, lw * 0.5 + 0.55, f);
          float off = hash(vec2(idx, seed + 3.0)) * 6.0 * uK, piece = floor((along + off) / (6.0 * uK));
          return line * step(gaps, hash(vec2(idx * 13.3 + piece * 1.7, seed + 4.0)));
        }
        float tone(vec2 p, float n, float seed) {
          float c = 0.0;
          if (n >= 1.0 && n < 2.0) c = hatch(p, 45.0, 9.6, 0.95, seed, 0.1);
          if (n >= 2.0) c = hatch(p, 45.0, n >= 4.0 ? (n >= 6.0 ? 3.4 : n >= 5.0 ? 4.0 : 4.8) : 6.0, n >= 6.0 ? 1.4 : 1.05, seed, n < 3.0 ? 0.1 : 0.04);
          if (n >= 3.0) c = max(c, hatch(p, 135.0, n >= 6.0 ? 3.4 : n >= 5.0 ? 4.8 : n >= 4.0 ? 6.0 : 9.6, n >= 6.0 ? 1.3 : 1.0, seed + 9.0, 0.04));
          if (n >= 5.0) c = max(c, hatch(p, 0.0, n >= 6.0 ? 3.0 : 4.0, n >= 6.0 ? 1.2 : 0.95, seed + 17.0, 0.02));
          if (n >= 6.0) c = max(c, hatch(p, 90.0, 4.0, 1.1, seed + 23.0, 0.02));
          if (n >= 7.0) c = 1.0;
          return c;
        }
        ${GL.LAND}
        // The zoom as a level, for marks that keep one density on screen at any zoom, and noise on the land about
        // g px across at 1080p at any zoom, in two octaves that hand over as it shrinks.
        float gLm = 0.0, gLf = 0.0;
        mat2 gW2S = mat2(1.0);
        float landNoise(vec2 w, float g, vec2 o) { float s = g / 80.0 * exp2(gLm); return mix(noise(w / s + gLm * 17.0 + o), noise(w / (2.0 * s) + (gLm + 1.0) * 17.0 + o), gLf); }
        // Hachures down a bank, as survey plans draw a cutting or an embankment: strokes across the road's line,
        // every other one short, each thickest at the bank's top. ph counts strokes along the road, top is 1 at the
        // bank's top and 0 at its foot, and lw is the stroke's width in pixels at the top.
        float hachL(float ph, float top, float lw) {
          float f = abs(fract(ph) - 0.5) / max(fwidth(ph), 1e-4), odd = mod(floor(ph), 2.0);
          float hw = lw * mix(0.3, 1.2, top) * step(odd * 0.45, top);
          return 1.0 - smoothstep(hw - 0.5, hw + 0.5, f);
        }
        // Strokes every g pixels at the nearest zoom, halved in number a level out as the ground's marks are.
        float hachure(vec2 w, vec2 along, float top, float g, float lw) {
          float s = g / 80.0 * exp2(gLm), ph = dot(w, along);
          return mix(hachL(ph / s, top, lw), hachL(ph / (2.0 * s), top, lw), gLf);
        }
        // The land's height between its grid points as a smooth cubic, from four filtered reads of the height map.
        vec4 cubicW(float v) { vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v, s = n * n * n; float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x; return vec4(x, y, z, 6.0 - x - y - z) / 6.0; }
        float hCubic(vec2 p) {
          p -= 0.5; vec2 f = fract(p); p -= f;
          vec4 xc = cubicW(f.x), yc = cubicW(f.y), c = p.xxyy + vec2(-0.5, 1.5).xyxy, s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
          vec4 o = (c + vec4(xc.yw, yc.yw) / s) / uHSize.xxyy;
          float a = texture2D(tH, o.xz).r, b = texture2D(tH, o.yz).r, cc = texture2D(tH, o.xw).r, d = texture2D(tH, o.yw).r;
          float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
          return mix(mix(d, cc, sx), mix(b, a, sx), sy);
        }
        void main() {
          vec2 px = vUv * res, k = uK / res;
          // The mixture draws the dark scheme in its own palette, so a shadow stays darker than the light. The
          // other pen techniques turn their tones over at the end.
          bool dk = uDark > 0.5 && uStyle == 8;
          float s0 = A(vUv);
          // Units boil through three hand-drawn variants; the ground holds still and moves with the map.
          float boil = mod(floor(uTime * 6.0), 3.0);
          // Where this pixel lies on the thing it belongs to, from the thing's own middle, so its marks travel with it.
          vec2 anc = texture2D(tAnc, vUv).xy;
          float onThing = step(0.4, A(vUv));
          vec2 own = anc + vec2(2048.0, 1024.0);
          // Work whose result is weighted by nothing at a pixel is skipped there, so the open ground stays cheap.
          vec2 uv = vUv;
          if (s0 > 0.0) uv += s0 * (vec2(noise(own * 0.05 / uK + boil * 7.1), noise(own * 0.05 / uK + boil * 3.3 + 11.0)) - 0.5) * 1.2 * k;
          float l = mix(L(uv), Ls(uv, k), 0.5 * (1.0 - s0));
          float v = clamp((l - 0.03) / 0.52, 0.0, 1.0);
          // The water's flat surface shows over a strip of bank above the water line, its edge zigzagging along the
          // land's triangles. The mixture draws that strip as light bank, with no shade and no edge of its own.
          float falseW = uStyle == 8 ? wBand(vUv) * smoothstep(0.0, 0.03, texture2D(tFogS, vUv).b - 20.0 - uWaterL) : 0.0;
          v = mix(v, 0.85, falseW);
          // Mostly bare paper and single hatching, as in the film, with the dark steps kept for real shadow.
          float n = floor(pow(1.0 - v, 1.7) * 7.6);
          if (s0 > 0.5) n = max(0.0, n - 1.0);
          // Units, buildings and scenery are hatched from their own middles, the land from the map.
          vec2 p = onThing > 0.5 ? own : px - uOff;
          float seedU = s0 > 0.5 ? 50.0 : 0.0;
          float dens = 1.0 - v;
          vec2 e2 = vec2(A(uv + k * vec2(1.4, 0)) - A(uv - k * vec2(1.4, 0)), A(uv + k * vec2(0, 1.4)) - A(uv - k * vec2(0, 1.4)));
          float outline = smoothstep(0.12, 0.42, length(e2));
          vec2 e1 = vec2(Ls(uv + k * vec2(2, 0), k) - Ls(uv - k * vec2(2, 0), k), Ls(uv + k * vec2(0, 2), k) - Ls(uv - k * vec2(0, 2), k));
          float edge = smoothstep(0.09, 0.2, length(e1)) * (1.0 - s0);
          // Beside water the bank draws its own line, so the edge of the water's surface is not inked.
          if (uStyle == 8) edge *= 1.0 - max(max(wBand(uv + k * vec2(5.0, 0)), wBand(uv - k * vec2(5.0, 0))), max(max(wBand(uv + k * vec2(0, 5.0)), wBand(uv - k * vec2(0, 5.0))), wBand(uv)));
          // Fire and smoke, from their own buffer. Drawn as wash (uFxs 1) or as hatched tone (2), they take no outline.
          vec4 FX = texture2D(tFx, vUv);
          float fxHeat = smoothstep(0.25, 0.9, max(FX.r, max(FX.g, FX.b))), fxSmk = smoothstep(0.03, 0.35, FX.a) * (1.0 - fxHeat);
          if (uFxs > 0.5) edge *= 1.0 - max(fxHeat, smoothstep(0.01, 0.1, FX.a));
          vec2 e3 = vec2(L(uv + k * vec2(1, 0)) - L(uv - k * vec2(1, 0)), L(uv + k * vec2(0, 1)) - L(uv - k * vec2(0, 1)));
          float inner = smoothstep(0.05, 0.14, length(e3)) * s0;
          float lines = max(outline, max(edge * 0.85, inner * 0.8));
          float cover = 0.0;
          vec3 paperC = dk ? DPAPER : PAPER, inkC = dk ? DINK : INK;
          bool inverse = false;
          // A side's border: its line's ink and weight, and its ribbon's tint and weight, laid in by the mixture.
          vec3 brdLC = vec3(0.0), brdWC = vec3(1.0);
          float brdL = 0.0, brdW = 0.0;
          float waterK = 0.0;
          // The mixture's washes under its ink, and its lines alone, for the remembered past.
          vec3 baseC = paperC;
          float lineK = lines;
          // Ore's own outline, in brown, for the styles that do not ink it black.
          float oreL = 0.0;
          if (uStyle == 0) {
            // Lightning: tone in seven steps of hatching and crosshatching.
            cover = max(tone(p, n, seedU), lines);
          } else if (uStyle == 1) {
            // Noir: shadow goes solid black, light stays bare, one band of hatching between, heavy outlines.
            float sv = s0 > 0.5 ? v + 0.18 : v;
            cover = 1.0 - smoothstep(0.26, 0.3, sv);
            cover = max(cover, hatch(p, 45.0, 5.0, 1.4, seedU, 0.06) * step(0.3, sv) * (1.0 - step(0.5, sv)));
            float thick = smoothstep(0.05, 0.3, length(vec2(A(uv + k * vec2(2.6, 0)) - A(uv - k * vec2(2.6, 0)), A(uv + k * vec2(0, 2.6)) - A(uv - k * vec2(0, 2.6)))));
            cover = max(cover, max(thick, max(edge, inner)));
            paperC = vec3(0.96, 0.95, 0.92); inkC = vec3(0.04);
          } else if (uStyle == 2) {
            // Stipple: dots on a jittered grid, larger where it is darker.
            vec2 q = p / (3.4 * uK), ci = floor(q), f = fract(q) - 0.5 - (vec2(hash(ci + seedU), hash(ci + 7.0 + seedU)) - 0.5) * 0.5;
            float r = sqrt(clamp(dens * 1.15 - 0.08, 0.0, 1.0)) * 0.62;
            cover = 1.0 - smoothstep(r - 0.12, r + 0.04, length(f));
            cover = max(cover, max(outline, max(edge * 0.6, inner * 0.6)));
          } else if (uStyle == 3) {
            // Engraving: one family of lines that bends with the forms and swells where it is dark.
            vec2 gr = vec2(Ls(uv + k * vec2(6, 0), k) - Ls(uv - k * vec2(6, 0), k), Ls(uv + k * vec2(0, 6), k) - Ls(uv - k * vec2(0, 6), k));
            float ang = length(gr) > 0.01 ? atan(gr.y, gr.x) : 0.5;
            vec2 dir = vec2(cos(ang), sin(ang));
            float sp = 3.6 * uK, ph = dot(p, dir) / sp + noise(p / (40.0 * uK)) * 1.5;
            float fq = abs(fract(ph) - 0.5);
            float wid = clamp(dens * 1.05, 0.0, 0.96) * 0.5;
            cover = 1.0 - smoothstep(wid - 0.06, wid + 0.06, fq);
            cover = max(cover, lines);
            paperC = vec3(0.95, 0.93, 0.87); inkC = vec3(0.1, 0.09, 0.12);
          } else if (uStyle == 4) {
            // Clean line: even outlines, flat paper, shadow in a screen of fine dots.
            vec2 q = mat2(0.707, -0.707, 0.707, 0.707) * p / (3.2 * uK);
            float dots = 1.0 - smoothstep(0.26, 0.34, length(fract(q) - 0.5));
            float tone2 = step(0.45, dens) * dots + step(0.78, dens) * 0.7;
            cover = max(min(tone2, 1.0), smoothstep(0.08, 0.3, length(e2)));
            cover = max(cover, smoothstep(0.07, 0.15, length(e1)) * (1.0 - s0) + inner * 0.7);
            paperC = vec3(0.98, 0.97, 0.94); inkC = vec3(0.05);
          } else if (uStyle == 5) {
            // Scratchboard: a black board with the light scratched out in white lines.
            float sc = hatch(p, 45.0, 3.2, mix(0.2, 2.6, v), seedU, 0.02);
            float sc2 = hatch(p, 135.0, 3.6, mix(0.0, 2.0, smoothstep(0.55, 1.0, v)), seedU + 9.0, 0.02);
            cover = 1.0 - max(sc, sc2);
            cover = max(0.0, cover - max(outline * 0.9, inner * 0.6));
            cover = max(cover, edge * 0.5);
            inverse = true;
          } else if (uStyle == 6) {
            // Sumi ink and wash: soft grey washes that bleed, a brush outline that thickens and thins.
            float wash = smoothstep(0.15, 0.95, dens) * 0.85;
            wash *= 0.85 + 0.3 * texture2D(tPaper, p / (700.0 * uK)).b;
            float brush = 0.6 + 0.8 * noise(p / (22.0 * uK));
            float bout = smoothstep(0.05, 0.3 / brush, length(vec2(A(uv + k * vec2(2.4, 0) * brush) - A(uv - k * vec2(2.4, 0) * brush), A(uv + k * vec2(0, 2.4) * brush) - A(uv - k * vec2(0, 2.4) * brush))));
            cover = max(wash, max(bout, max(edge * 0.6, inner * 0.55)));
            paperC = vec3(0.95, 0.93, 0.88); inkC = vec3(0.07, 0.07, 0.08);
          } else if (uStyle == 8) {
            // The mixture: each kind of thing in its own pen technique, for contrast.
            float a = A(vUv);
            float isU = smoothstep(0.85, 0.95, a), isB = smoothstep(0.62, 0.7, a) * (1.0 - isU), isS = smoothstep(0.37, 0.45, a) * (1.0 - smoothstep(0.62, 0.7, a));
            float isW = smoothstep(0.12, 0.2, a) * (1.0 - smoothstep(0.37, 0.45, a)), isG = 1.0 - smoothstep(0.08, 0.15, a);
            // Ore and bridges sit inside the scenery band, each on its own value.
            float isO = 1.0 - smoothstep(0.02, 0.035, abs(a - 0.55)), isBr = 1.0 - smoothstep(0.02, 0.035, abs(a - 0.42));
            // Trees too, between the bridges' value and the rest of the scenery's, and life on the land above ore.
            float isT = 1.0 - smoothstep(0.01, 0.02, abs(a - 0.459)), isL = 1.0 - smoothstep(0.02, 0.035, abs(a - 0.6));
            isS = max(0.0, isS - isO - isBr - isT - isL);
            // Water is where the river bed lies under the water line. The water mesh's own edge zigzags along its
            // triangles, so it only says that something lower than scenery is here.
            float lh = texture2D(tFogS, vUv).b - 20.0, wl = uWaterL - lh, dep = max(wl, 0.0);
            // Where on the land this pixel lies, and the zoom's level for marks laid on it.
            vec2 Wl = landAt(vUv, lh);
            float lev = clamp(uLev, 0.0, 2.999);
            gLm = floor(lev); gLf = smoothstep(0.15, 0.85, lev - gLm); gW2S = mat2(uW2S.xy, uW2S.zw) / uK;
            // How far the view is drawn back, 0 at the usual view and 1 at a wide one, and for units from closer
            // in, since a unit is small on screen already at the usual view.
            float zo = smoothstep(1.9, 2.7, uLev), zU = smoothstep(1.2, 1.9, uLev);
            mat2 S2W = mat2(gW2S[1][1], -gW2S[0][1], -gW2S[1][0], gW2S[0][0]) / (gW2S[0][0] * gW2S[1][1] - gW2S[1][0] * gW2S[0][1]);
            // The ground's form as relief maps draw it: the land's height read smoothly from the map, its slopes lit
            // from the upper left of the page, and contours every third of a unit, every fifth one heavier.
            float lhS = hCubic(Wl * uHScale + 0.5);
            vec2 gJx = dFdx(Wl), gJy = dFdy(Wl);
            float hdx = dFdx(lhS), hdy = dFdy(lhS);
            float rfDark = 0.0, rfLight = 0.0, contour = 0.0, hyps = clamp(lhS / 3.2, 0.0, 1.0);
            float gDet = gJx.x * gJy.y - gJx.y * gJy.x;
            // A screen gradient turned into one on the land.
            vec2 gh = vec2(gJy.y * hdx - gJx.y * hdy, -gJy.x * hdx + gJx.x * hdy) / (gDet + sign(gDet) * 1e-9);
            // The land under the water's surface is shaded too, so the bank above the water line keeps its relief.
            if (isG + wBand(vUv) > 0.01) {
              vec2 ul = normalize(vec2(uView.x + uView.y, uView.y - uView.x));
              vec3 nrm = normalize(vec3(-gh.x * 2.2, 1.0, -gh.y * 2.2)), lit = normalize(vec3(ul.x, 1.0, ul.y));
              float sh = dot(nrm, lit) - lit.y;
              rfDark = clamp(-sh * 2.6, 0.0, 1.0); rfLight = clamp(sh * 2.6, 0.0, 1.0);
              // Line k lies at ci = k + 0.5, so floor(ci) names it on both of its sides.
              float ci = lhS / 0.33, cw = max(fwidth(ci), 1e-4), ck = floor(ci), idx = step(mod(ck, 5.0), 0.5);
              contour = (1.0 - smoothstep(0.45 * cw * uK, 1.3 * cw * uK, abs(fract(ci) - 0.5))) * mix(0.45, 0.85, idx);
              // Contours generalise as a smaller scale map's do. Where lines crowd on a steep slope the odd ones
              // go first, then the even, and the index lines hold until they nearly touch. Spacing is in px at 1080p.
              float cSp = 1.0 / (cw * uK);
              contour *= idx > 0.5 ? smoothstep(1.6, 2.8, cSp) : mod(ck, 2.0) < 0.5 ? smoothstep(4.0, 6.5, cSp) : smoothstep(7.0, 11.0, cSp);
              // Contours stop short of the water's edge, where the bank is drawn as a line of its own.
              contour *= smoothstep(0.15, 0.4, abs(wl));
            }
            float bankZone = 1.0 - smoothstep(0.15, 0.4, abs(wl));
            float low = 1.0 - smoothstep(0.3, 0.37, a), wet = smoothstep(0.0, 0.04, dep);
            isW = low * wet; isG = low * (1.0 - wet); waterK = isW;
            // Lines inside a shape, where its surface turns or steps back.
            vec4 N0 = texture2D(tNorm, vUv);
            float nE = 0.0, dE = 0.0;
            for (int i = 0; i < 4; i++) {
              vec2 o = i == 0 ? vec2(1, 0) : i == 1 ? vec2(-1, 0) : i == 2 ? vec2(0, 1) : vec2(0, -1);
              vec4 Nn = texture2D(tNorm, vUv + o * k * 0.9);
              nE = max(nE, 1.0 - dot(N0.xyz * 2.0 - 1.0, Nn.xyz * 2.0 - 1.0));
              dE = max(dE, abs(N0.w - Nn.w) / max(N0.w, 0.5));
            }
            float detail = max(smoothstep(0.08, 0.3, nE), smoothstep(0.006, 0.02, dE)) * step(0.3, a);
            // Inner lines thin out in the light.
            detail *= mix(0.55, 1.0, max(smoothstep(0.25, 0.6, dens), isBr));
            // Ground: a pale green wash speckled in olive, thicker in the middle values, with black ink only for
            // crosshatch in the deepest shade.
            float gC = dens > 0.74 ? tone(p, n - 2.0, 0.0) : 0.0;
            gC = max(gC, smoothstep(0.92, 0.96, dens));
            gC = max(gC, edge * 0.55 * (1.0 - bankZone));
            // Roads as on a map: two ruled edges, bare paper between, a broken line down the middle.
            float rd = texture2D(tLand, vUv).r, rw = max(fwidth(rd), 1e-4);
            float onRoad = 1.0 - smoothstep(1.1, 1.3, rd);
            // The way out from the road's middle on the land, and how the land rises across it. The edge away from
            // the light is ruled heavier and the lit edge finer, so the road reads as a bed raised off the land.
            vec2 rdS = vec2(dFdx(rd), dFdy(rd)), rN = vec2(gJy.y * rdS.x - gJx.y * rdS.y, -gJy.x * rdS.x + gJx.x * rdS.y) / (gDet + sign(gDet) * 1e-9);
            rN /= max(length(rN), 1e-6);
            float rLitK = dot(rN, normalize(vec2(uView.x + uView.y, uView.y - uView.x))), rShade = smoothstep(0.15, 0.7, -rLitK) * (1.0 - onRoad);
            float rXs = dot(gh, rN), eW = mix(mix(1.0, 0.65, smoothstep(0.15, 0.7, rLitK)), 1.9, rShade);
            // The breaks in a line are found only where the line is.
            float rEdge = 1.0 - smoothstep(0.45 * uK * eW, 1.2 * uK * eW, abs(rd - 1.3) / rw), rMid = 1.0 - smoothstep(0.3 * uK, 0.9 * uK, rd / rw);
            if (rEdge > 0.0) rEdge *= step(0.12, landNoise(Wl, 30.0, vec2(0.0)) + 0.1);
            // The broken middle line is a modern road's, from the Industrial Age.
            if (rMid > 0.0) rMid *= step(0.5, landNoise(Wl, 4.5, vec2(0.0))) * uMarks;
            gC = max(gC * (1.0 - onRoad * 0.9), max(rEdge * 0.9, rMid * 0.4));
            // Where the land rises beside the road it is cut into, and where it falls the road is carried on an
            // embankment. Either bank is hachured, wider the steeper the fall, a cutting's beyond a ditch.
            float bank = smoothstep(0.04, 0.14, abs(rXs)), cut = step(0.0, rXs);
            float bW = mix(0.8, 2.4, smoothstep(0.05, 0.45, abs(rXs))), bu = (rd - mix(1.4, 1.85, cut)) / bW;
            float hach = bank > 0.0 && bu > 0.0 && bu < 1.0 ? hachure(Wl, vec2(-rN.y, rN.x), mix(1.0 - bu, bu, cut), 13.0, uK * 0.85) * bank : 0.0;
            // Drawn back, the hachures pale to a light tone, so a cutting reads as a bank and not a dark band.
            hach *= mix(0.62, 0.4, zo);
            // The bank is drawn in its hachures alone, so the shade's stipple is cleared from it.
            float bankIn = bank * smoothstep(-0.08, 0.04, bu) * (1.0 - smoothstep(0.96, 1.08, bu));
            // A ditch runs beside the road wherever it is not up on an embankment, a fine broken line that holds
            // water after rain.
            float ditchK = (1.0 - smoothstep(0.03, 0.1, -rXs)) * (1.0 - onRoad);
            float ditch = (1.0 - smoothstep(0.35 * uK, 0.9 * uK, abs(rd - 1.62) / rw)) * ditchK;
            if (ditch > 0.0) ditch *= step(0.3, landNoise(Wl, 18.0, vec2(5.0)));
            float ditchW = (1.0 - smoothstep(0.08, 0.15, abs(rd - 1.62))) * ditchK * uWet;
            gC = max(gC * (1.0 - bankIn * 0.85), max(hach * 0.8, ditch * 0.55));
            // Rivers water-lined as old maps do: lines that follow the shore, close at the bank and further apart
            // toward the middle, each thinner and more broken than the last, and a heavy line at the bank.
            float wq = pow(dep / 1.15, 0.6) * 7.0, wqw = max(fwidth(wq), 1e-4), wf = fract(wq);
            float wLine = (1.0 - smoothstep(mix(0.55, 0.25, wq / 7.0) * uK, mix(1.2, 0.8, wq / 7.0) * uK, min(wf, 1.0 - wf) / wqw)) * step(0.5, wq);
            if (wLine > 0.0) wLine *= step(wq / 14.0, landNoise(Wl, 12.0, vec2(floor(wq) * 3.1)));
            // The water lines are laid in the lilac wash below, not in black. A bridge's shadow falls on the water
            // away from the sun, about its deck's height off, and is hatched there.
            float wC = 0.0, shB = 0.0;
            if (isW > 0.01) {
              float pxU = sqrt(abs(uW2S.x * uW2S.w - uW2S.y * uW2S.z));
              for (int i = 1; i <= 4; i++) shB = max(shB, 1.0 - smoothstep(0.02, 0.035, abs(A(vUv + uSun2 * pxU * 0.24 * float(i) / res) - 0.42)));
              shB *= 1.0 - isBr;
              wC = dk ? 0.0 : hatch(p, 45.0, 3.4, 0.9, 63.0, 0.06) * shB * 0.75;
            }
            // Bridges: a pink deck with one light hatch in its shade, solid in its deepest.
            float brC = isBr > 0.0 ? max(hatch(p, 45.0, 4.6, 0.8, 41.0, 0.1) * step(0.62, dens), smoothstep(0.9, 0.94, dens)) : 0.0;
            // Ore: outlined gold pebbles, hatched only on their shaded side. The other styles draw it in its wash,
            // and gold leaf keeps only its deepest shade black.
            float oC = uOre == 0 ? max(hatch(p, 45.0, 3.0, 0.9, 47.0, 0.05) * step(0.56, dens), smoothstep(0.9, 0.94, dens)) : uOre == 5 ? smoothstep(0.9, 0.94, dens) : 0.0;
            // Trees, rocks and houses: loose quick scribble.
            vec2 cell = floor(Wl / 1.2);
            float sang = 30.0 + hash(cell + 3.0) * 120.0, sC = 0.0, tC = 0.0, bC = 0.0;
            if (isS > 0.0) {
              sC = hatch(p, sang, 3.6, 1.0, hash(cell) * 40.0, 0.2) * step(0.3, dens);
              sC = max(sC, hatch(p, sang + 75.0, 3.2, 0.9, 5.0, 0.25) * step(0.6, dens));
              sC = max(sC, smoothstep(0.88, 0.92, dens));
            }
            // Trees: cutout canopies in a translucent wash, scribbled only on their shaded side.
            if (isT > 0.0) tC = max(hatch(p, sang, 3.6, 0.9, hash(cell) * 40.0, 0.3) * step(0.58, dens), smoothstep(0.9, 0.94, dens));
            // Buildings: massed in flat tones by face, so hatched only in shadow, with windows and deep shade solid.
            if (isB > 0.0) bC = max(hatch(p, 45.0, 4.4, 0.9, 0.0, 0.06) * step(0.6, dens), smoothstep(0.88, 0.92, dens));
            // Units: bright paper with one hatch for their shade and solid black for the deepest.
            // The units' shade, in the way the study asks: a 45 degree hatch with solid black in the deepest (0, 1),
            // solid black with the edges cut white (2), bare paper with line alone (3), hatched along the form (4),
            // or stippled (5).
            vec3 nVu = N0.xyz * 2.0 - 1.0;
            float uAng = degrees(atan(nVu.y, nVu.x)) + 90.0, uC = 0.0;
            // On light paper a unit's form comes from its faces' shades of its side's colour, so it is not hatched,
            // which at dusk covered a whole unit; only its blackest shadow is laid solid in a deep tone.
            if (isU <= 0.0) uC = 0.0;
            else if (!dk && uUnits == 1) uC = smoothstep(0.88, 0.94, dens) * 0.8;
            else if (uUnits == 2) uC = 1.0;
            else if (uUnits == 3) uC = 0.0;
            else if (uUnits == 4) uC = max(hatch(p, uAng, mix(5.0, 2.6, smoothstep(0.15, 0.8, dens)), 0.9, seedU, 0.04) * smoothstep(0.12, 0.22, dens), smoothstep(0.84, 0.88, dens));
            else if (uUnits == 5) { vec2 uq = p / (2.2 * uK); float ud = length(fract(uq) - 0.5 - (vec2(hash(floor(uq) + seedU), hash(floor(uq) + seedU + 7.0)) - 0.5) * 0.3), ur = smoothstep(0.1, 0.85, dens) * 0.58; uC = max((1.0 - smoothstep(ur - 0.08, ur + 0.08, ud)) * step(0.06, ur), smoothstep(0.88, 0.92, dens)); }
            // Small on screen, a unit's shade is flat rather than hatched, which at that size only scribbles over the
            // shape. On dark paper it is a tint of the side's ink. On light paper it is the ink laid solid, as a pen
            // fills a small shape, since a pale tint of red is pink.
            else uC = max(mix(hatch(p, 45.0, 3.2, 1.0, seedU, 0.04) * smoothstep(0.42, 0.46, dens), dk ? smoothstep(0.4, 0.72, dens) * 0.4 : smoothstep(0.5, 0.56, dens), zU), smoothstep(0.8, 0.84, dens));
            cover =isG * gC + isW * wC + isS * sC + isT * tC + isB * bC + isU * uC + isBr * brC + isO * oC + isL * smoothstep(0.88, 0.92, dens);
            // The bank drawn once, heavy, on whichever side of it the pixel lies.
            float bankL = 1.0 - smoothstep(0.7 * uK, 1.6 * uK, abs(dep - 0.03) / max(fwidth(dep), 1e-4));
            cover = max(cover, bankL * step(0.001, dep + 0.05) * (isG + isW) * 0.9);
            // A ring of bare paper round every unit and building, so its outline never runs into the ground's marks.
            float ring = 0.0;
            for (int i = 0; i < 8; i++) {
              float an = float(i) * 0.785;
              ring = max(ring, smoothstep(0.6, 0.7, A(vUv + vec2(cos(an), sin(an)) * k * 4.5)));
            }
            cover *= 1.0 - ring * (1.0 - smoothstep(0.55, 0.65, a)) * 0.95;
            // The outline: a building or tree from taps a stride and a fifth out, a unit from closer, so a unit's line
            // is the thinner.
            float aR = A(uv + k * vec2(1.2, 0)), aL = A(uv - k * vec2(1.2, 0)), aT = A(uv + k * vec2(0, 1.2)), aB = A(uv - k * vec2(0, 1.2));
            float unitNear = step(0.9, max(max(aR, aL), max(max(aT, aB), a)));
            float ox = unitNear > 0.5 ? 0.6 : 1.2;
            float heavy = smoothstep(0.1, 0.35, length(vec2(AS(uv + k * vec2(ox, 0)) - AS(uv - k * vec2(ox, 0)), AS(uv + k * vec2(0, ox)) - AS(uv - k * vec2(0, ox)))));
            heavy *= mix(1.0, 0.85, unitNear);
            // The outline swells on the side away from the sun: a pixel just outside a unit or building, with the
            // shape lying sunward of it, is inked.
            float swell = 0.0;
            if (a < 0.6) for (int i = 1; i <= 9; i++) { if (i > 3 && uUnits != 3) break; if (i > 2 && zU > 0.5 && uUnits != 3) break; float sa = A(uv + uSun2 * k * (float(i) * 1.15)); swell = max(swell, step(i > 3 ? 0.95 : 0.6, sa) * (i > 1 && sa > 0.9 && uUnits != 3 ? 0.0 : 1.0)); }
            cover = max(cover, max(heavy, swell * (1.0 -step(0.6, a))));
            // A small unit keeps its outline whole and its inner lines light, so it reads as a shape.
            cover = max(cover, detail * mix(0.75, mix(1.0, 0.5, zU), isU));
            // Scratchboard units: a solid body with the inner edges cut out white.
            if (uUnits == 2) cover = mix(cover, 1.0 - smoothstep(0.3, 0.7, detail), isU);
            // Ore in the soft, stippled, engraved and faceted styles is outlined thin in brown, not black.
            if (uOre >= 1 && uOre <= 4) {
              float nearO = max(max(oA(uv + k * vec2(1.6, 0)), oA(uv - k * vec2(1.6, 0))), max(max(oA(uv + k * vec2(0, 1.6)), oA(uv - k * vec2(0, 1.6))), isO));
              cover *= 1.0 - nearO;
              // A field of nuggets each ringed in brown is the busiest thing on the land, so the rings are light.
              oreL = outline * nearO * mix(0.85, 0.5, zU) * (1.0 - 0.75 * zo);
            }
            paperC = dk ? DPAPER : vec3(0.96, 0.93, 0.86);
            lineK = max(max(heavy, swell * (1.0 - step(0.6, a))), max(detail, max(edge * 0.55 * (1.0 - bankZone) * isG, max(rEdge * 0.9 * isG, bankL * step(0.001, dep + 0.05) * (isG + isW)))));
            // The washes: the land green, roads and bridge decks pink, water lilac with white ripples, canopies in
            // three greens, roofs cream and walls warm grey by which way they face.
            vec3 base = mix(paperC, dk ? vec3(0.24, 0.33, 0.22) : SOFT_G, isG);
            // Layer tints by height, pale green lowland to cream to tan upland, the slopes away from the light shaded
            // in a cool sepia and the slopes toward it lifted a little, and the contours in sepia. On dark paper the
            // tints are greys, near black in the lowland to a mid grey upland, mottled in broad patches.
            vec3 tint = hyps < 0.5 ? mix(vec3(0.84, 0.90, 0.80), vec3(0.94, 0.93, 0.82), hyps * 2.0) : mix(vec3(0.94, 0.93, 0.82), vec3(0.88, 0.80, 0.64), hyps * 2.0 - 1.0);
            if (dk) {
              // The light paper's layers in the dark: its pale green as a deep green in the lowland, lighter green
              // and olive up the slopes, and its tan as a warm earth on the heights, each rise its own shade.
              tint = hyps < 0.33 ? mix(vec3(0.2, 0.29, 0.19), vec3(0.27, 0.37, 0.25), hyps / 0.33)
                : hyps < 0.66 ? mix(vec3(0.27, 0.37, 0.25), vec3(0.38, 0.41, 0.28), (hyps - 0.33) / 0.33)
                : mix(vec3(0.38, 0.41, 0.28), vec3(0.55, 0.5, 0.37), (hyps - 0.66) / 0.34);
              tint *= 0.92 + 0.16 * (noise(Wl * 0.055) * 0.65 + noise(Wl * 0.16 + 5.0) * 0.35);
            }
            vec3 CONT = dk ? vec3(0.68, 0.66, 0.6) : vec3(0.42, 0.33, 0.24);
            // A road takes a third of the tint and the contours cross it faint, so it climbs and falls with the land
            // rather than lying flat over it.
            base = mix(base, tint, isG * (1.0 - onRoad * 0.65));
            // On dark paper a shaded slope sinks toward black and a lit one rises toward mid grey.
            base = mix(base, base * (dk ? vec3(0.36, 0.37, 0.44) : vec3(0.72, 0.70, 0.68)), rfDark * (dk ? 0.95 : 0.65) * isG);
            base = mix(base, dk ? base + vec3(0.3, 0.27, 0.21) : min(base * 1.05 + 0.03, vec3(1.0)), rfLight * (dk ? 0.85 : 0.6) * isG);
            base = mix(base, CONT, contour * isG * (1.0 - onRoad * 0.55) * (1.0 - wet));
            base = mix(base, base * vec3(0.9, 0.93, 0.97), uWet * isG * 0.7);
            // A raised road's shadow, a narrow band beyond its edge away from the light; none beside a cutting.
            float rCast = rShade * smoothstep(1.27, 1.33, rd) * (1.0 - smoothstep(1.3, 1.62, rd)) * (1.0 - cut * bank);
            base = mix(base, base * (dk ? vec3(0.55) : vec3(0.8, 0.79, 0.78)), rCast * isG * 0.85);
            // Rain standing in the ditches.
            base = mix(base, dk ? vec3(0.2, 0.26, 0.4) : LILAC, ditchW * isG * 0.8);
            // Tracks worn by traffic: beaten earth, and a hardened track drawn as a site plan draws a path, its edges
            // in dashed sepia.
            float trk = texture2D(tLand, vUv).a, onTrk = smoothstep(0.18, 0.4, trk) * (1.0 - onRoad) * isG;
            base = mix(base, mix(base, dk ? vec3(0.3, 0.29, 0.275) : vec3(0.87, 0.83, 0.72), 0.8), onTrk);
            vec2 tg = vec2(dFdx(trk), dFdy(trk));
            float tgl = max(length(tg), 1e-4);
            // The dashes run along the edge on the land, measured from a corner near by so a slight turn of the edge
            // does not throw them out.
            vec2 tw = normalize(S2W * vec2(-tg.y, tg.x));
            float tPh = dot(Wl - floor(Wl / 3.0) * 3.0, tw) / (6.0 / 80.0 * exp2(gLm));
            float tEdge = (1.0 - smoothstep(0.35 * uK, 1.0 * uK, abs(trk - 0.8) / tgl)) * mix(step(0.45, fract(tPh)), step(0.45, fract(tPh * 0.5)), gLf);
            base = mix(base, dk ? vec3(0.52, 0.5, 0.47) : vec3(0.42, 0.36, 0.28), tEdge * 0.8 * isG * (1.0 - onRoad));
            // Grass in tufts of three short strokes, leaning and stirring with the wind, thicker in the meadows.
            // Lying snow whitens the land, and the roads less.
            base = mix(base, dk ? vec3(0.48, 0.49, 0.52) : vec3(0.975, 0.975, 0.965), uSnowC * isG * (1.0 - onRoad * 0.5));
            float rH = onRoad * isG > 0.0 || isBr > 0.0 ? hatch(p, 60.0, 4.0, 0.8, 53.0, 0.1) : 0.0;
            // Roads in one of six colours: pink, sand, pale stone, bare paper, khaki or white.
            vec3 RC = uRoad == 0 ? PINK : uRoad == 1 ? vec3(0.886, 0.824, 0.675) : uRoad == 2 ? vec3(0.847, 0.835, 0.804) : uRoad == 3 ? paperC : uRoad == 4 ? vec3(0.812, 0.765, 0.573) : vec3(0.969, 0.961, 0.933);
            vec3 RD = uRoad == 0 ? PINK_D : uRoad == 1 ? vec3(0.62, 0.52, 0.34) : uRoad == 2 ? vec3(0.5, 0.49, 0.46) : uRoad == 3 ? paperC : uRoad == 4 ? vec3(0.5, 0.47, 0.3) : vec3(0.72, 0.7, 0.66);
            if (dk && uRoad != 3) RC *= 0.25;
            base = mix(base, mix(RC, RD, rH * 0.35), onRoad * isG * 0.9);
            // A bridge deck is toned and ruled, a structure over the water and not a blank gap in the map. On dark
            // paper it stands a little lighter than the land, as a roof does.
            vec3 DECK = dk ? vec3(0.36, 0.35, 0.33) : vec3(0.8, 0.765, 0.7);
            base = mix(base, mix(DECK, DECK * 0.8, rH * 0.6), isBr * 0.95);
            // The road climbs and falls with the land: its relief shading and the contours carry across it.
            float onR = onRoad * isG * (1.0 - wet);
            base = mix(base, base * vec3(0.8, 0.78, 0.76), rfDark * 0.55 * onR);
            base = mix(base, CONT, contour * 0.55 * onR);
            float rip = isW > 0.0 ? hatch(p, -12.0, 6.5, 0.9, 57.0, 0.45) : 0.0;
            // Water on dark paper is a deep blue, its lines and ripples lighter than it.
            vec3 WTR = dk ? vec3(0.115, 0.15, 0.235) : LILAC, WTR_D = dk ? vec3(0.32, 0.4, 0.6) : LILAC_D, RIP = dk ? vec3(0.4, 0.5, 0.7) : vec3(1.0);
            base = mix(base, mix(mix(WTR, WTR_D, wLine * 0.6), RIP, rip * 0.55 * (1.0 - wLine)), isW);
            base = mix(base, base * (dk ? 0.5 : 0.8), shB * isW);
            if (isT > 0.0) {
              float tn = noise(p / (60.0 * uK));
              vec3 TR = tn < 0.4 ? TREE3 : tn < 0.62 ? TREE1 : TREE2;
              if (dk) TR = tn < 0.4 ? vec3(0.13, 0.2, 0.12) : tn < 0.62 ? vec3(0.16, 0.235, 0.14) : vec3(0.19, 0.26, 0.165);
              base = mix(base, TR, isT * 0.8);
              base = mix(base, dk ? vec3(0.4, 0.42, 0.45) : vec3(0.95, 0.96, 0.97), uSnowC * isT * 0.55);
              // A burnt tree is charcoal, not green.
              base = mix(base, dk ? vec3(0.06, 0.055, 0.05) : vec3(0.27, 0.25, 0.23), isT * (1.0 - smoothstep(0.06, 0.16, L(vUv))));
            }
            vec3 nV = N0.xyz * 2.0 - 1.0;
            // Roofs palest, then the walls by which way they face, on either paper.
            vec3 face = dot(nV, uUpV) > 0.6 ? ROOF : nV.x < 0.0 ? WALL_L : WALL_R;
            if (dk) face = dot(nV, uUpV) > 0.6 ? vec3(0.3, 0.28, 0.25) : nV.x < 0.0 ? vec3(0.23, 0.21, 0.19) : vec3(0.17, 0.155, 0.14);
            // Over the faces, a light wash of what the building is made of, so from far off a base reads its age
            // by its stuff: straw thatch and mud brick, grey stone and red tile, slate and brick.
            vec3 bMat = clamp(texture2D(tSubj, vUv).rgb * 2.0, 0.0, 1.0);
            // On dark paper a product of dark faces keeps no hue, so the material lifts the face by its lightness
            // and adds its chroma.
            float bLum = dot(bMat, vec3(0.3, 0.59, 0.11));
            vec3 bWash = dk ? clamp(face * (0.7 + 0.75 * bLum) + (bMat - bLum) * 0.42, 0.0, 1.0) : min(face * (0.5 + 0.62 * bMat), vec3(1.0));
            face = mix(face, bWash, dk ? 0.9 : 0.6);
            base = mix(base, face, isB);
            base = mix(base, dk ? vec3(0.45, 0.46, 0.48) : vec3(0.99), uSnowC * isB * step(0.6, dot(nV, uUpV)));
            // Deer, cars, townsfolk and boats keep their own colours, as a light wash.
            base = mix(base, mix(min(texture2D(t, vUv).rgb * (dk ? 1.15 : 1.3), vec3(1.0)), dk ? paperC : vec3(1.0), 0.12), isL);
            // Ore in the chosen style: 1 a soft ochre wash, 2 a stippled deposit, 3 engraved, 4 faceted, 5 gold leaf.
            vec3 OCH = vec3(0.92, 0.78, 0.45), GOLD_P = vec3(0.97, 0.9, 0.66), BRN = vec3(0.45, 0.32, 0.14);
            float up = dot(nV, uUpV);
            vec3 oreC = paperC;
            if (uOre == 1) oreC = OCH * mix(1.0, 0.82, smoothstep(0.4, 0.8, dens));
            else if (uOre == 2) {
              vec2 dq = p / (2.2 * uK);
              float dt = (1.0 - smoothstep(0.18, 0.3, length(fract(dq) - 0.5))) * step(hash(floor(dq) + 71.0), 0.35 + 0.5 * dens);
              oreC = mix(GOLD_P, BRN, dt);
            }
            else if (uOre == 3) oreC = mix(GOLD_P, BRN, hatch(p, 0.0, 2.6, mix(0.5, 1.6, dens), 73.0, 0.02));
            // Far out the facets merge into one even gold, so a field reads as a patch, not a scatter.
            else if (uOre == 4) oreC = mix(up > 0.7 ? vec3(0.99, 0.86, 0.45) : nV.x < 0.0 ? vec3(0.9, 0.67, 0.27) : vec3(0.72, 0.5, 0.2), vec3(0.9, 0.74, 0.4), zo * 0.85);
            else if (uOre == 5) {
              oreC = up > 0.75 ? vec3(1.0, 0.95, 0.72) : nV.x < 0.0 ? vec3(0.98, 0.78, 0.22) : vec3(0.8, 0.56, 0.1);
              oreC = mix(oreC, vec3(1.0), step(0.985, hash(floor(p / (3.0 * uK)) + 91.0)) * step(0.5, up));
            }
            if (uOre != 0) base = mix(base, oreC, isO);
            // The stippled deposit spreads its dots onto the ground round each field.
            if (uOre == 2) {
              float halo = 0.0;
              for (int i = 0; i < 8; i++) { float an = float(i) * 0.785; halo = max(halo, oA(vUv + vec2(cos(an), sin(an)) * k * 9.0)); }
              vec2 hq = p / (2.6 * uK);
              float hd = (1.0 - smoothstep(0.15, 0.28, length(fract(hq) - 0.5))) * step(hash(floor(hq) + 83.0), 0.5);
              base = mix(base, OCH * 0.6, hd * halo * isG * (1.0 - isO));
            }
            // Far out, the ground between faceted nuggets takes a light ochre, so a field reads as one patch.
            if (uOre == 4 && zo > 0.01 && isG > 0.01) {
              float pat = 0.0;
              for (int i = 0; i < 4; i++) { float an = float(i) * 1.571 + 0.785; pat = max(pat, oA(vUv + vec2(cos(an), sin(an)) * k * 5.0)); }
              base = mix(base, mix(base, OCH, dk ? 0.3 : 0.4), pat * zo * isG * (1.0 - isO));
            }
            baseC = base;
            // The sides' borders as an old map colours them: a firm line in the side's ink along the edge, and a
            // ribbon of its colour washed along the inside, for the viewer's own side and the strongest other.
            // Read from the reach on the land under the pixel, so the line keeps its place and weight at any zoom.
            vec2 tvB = (texture2D(tTerr, Wl / uMap).rg - 0.5) * 16.0, twB = max(fwidth(tvB), vec2(1e-4));
            float whoB = floor(texture2D(tTerr, (floor(Wl) + 0.5) / uMap).b * 8.0 + 0.5);
            vec3 meI = INK, otI = INK, meT = PAPER, otT = PAPER;
            for (int i = 0; i < 8; i++) {
              if (float(i) == uMe) { meI = dk ? uSideD[i] : uSideL[i]; meT = uSideB[i]; }
              if (float(i) == whoB) { otI = dk ? uSideD[i] : uSideL[i]; otT = uSideB[i]; }
            }
            float bOn = clamp(isG + isW, 0.0, 1.0);
            float lnA = 1.0 - smoothstep(0.35 * uK, 0.95 * uK, abs(tvB.x) / twB.x), lnB = 1.0 - smoothstep(0.35 * uK, 0.95 * uK, abs(tvB.y) / twB.y);
            float rbA = step(0.0, tvB.x) * (1.0 - smoothstep(0.0, 1.8, tvB.x)), rbB = step(0.0, tvB.y) * (1.0 - smoothstep(0.0, 1.8, tvB.y));
            brdL = max(lnA, lnB) * bOn * (dk ? 1.0 : 0.85); brdLC = lnA >= lnB ? meI : otI;
            brdW = max(rbA, rbB) * bOn * min(1.0, 0.5 * uBorder);
            brdWC = dk ? (rbA >= rbB ? meI : otI) : (rbA >= rbB ? meT : otT) / PAPER;
            // Inks by what is drawn: 0 black throughout; 1 survey inks, sepia land and roads, Prussian blue water,
            // green trees, umber buildings and each side's units in its own ink; 2 sepia throughout with blue water
            // and the sides' inks; 3 blue-black iron gall throughout with the sides' inks. A line takes the ink of the
            // nearest thing it outlines.
            if (uInks > 0) {
              float aN = max(a, max(max(aR, aL), max(aT, aB)));
              // A unit's outline swells up to three px out on its side away from the sun, past these taps, so its ink is
              // looked for a little wider. Otherwise that rim took the land's ink and mixed with the side's.
              bool wide = false;
              vec2 o1 = k * vec2(2.6, 0.0), o2 = k * vec2(0.0, 2.6), o3 = uSun2 * k * 3.4;
              if (aN <= 0.9 && a < 0.6) {
                float aW = max(max(A(uv + o1), A(uv - o1)), max(max(A(uv + o2), A(uv - o2)), A(uv + o3)));
                if (aW > 0.9) { aN = aW; wide = true; }
              }
              // A side's ink is looked up only near a unit, the one place it is used.
              vec3 uInk = vec3(0.0);
              if (aN > 0.9) {
                vec4 aw = a > 0.9 ? texture2D(tAnc, vUv) : wide
                  ? max(max(texture2D(tAnc, vUv + o1), texture2D(tAnc, vUv - o1)), max(max(texture2D(tAnc, vUv + o2), texture2D(tAnc, vUv - o2)), texture2D(tAnc, vUv + o3)))
                  : max(max(texture2D(tAnc, vUv + k * vec2(1.2, 0)), texture2D(tAnc, vUv - k * vec2(1.2, 0))), max(texture2D(tAnc, vUv + k * vec2(0, 1.2)), texture2D(tAnc, vUv - k * vec2(0, 1.2))));
                uInk = sideInk(aw, dk);
              }
              // The same inks on dark paper, each as pale as the light scheme's is deep.
              vec3 landI = uInks == 3 ? (dk ? vec3(0.7, 0.75, 0.9) : vec3(0.13, 0.15, 0.27)) : (dk ? vec3(0.8, 0.7, 0.56) : vec3(0.34, 0.23, 0.14));
              vec3 waterI = uInks == 3 ? landI : (dk ? vec3(0.55, 0.68, 0.88) : vec3(0.12, 0.24, 0.44));
              vec3 treeI = uInks == 1 ? (dk ? vec3(0.58, 0.74, 0.52) : vec3(0.13, 0.26, 0.12)) : landI;
              vec3 bldI = uInks == 1 ? (dk ? vec3(0.86, 0.8, 0.7) : vec3(0.22, 0.16, 0.12)) : landI;
              float tN = 1.0 - smoothstep(0.012, 0.025, abs(aN - 0.459));
              inkC = aN > 0.9 ? uInk : aN > 0.62 ? bldI : tN > 0.5 ? treeI : isW > 0.5 ? waterI : landI;
              // On light paper a close unit's hatching is its side's ink darkened toward black, as below.
              if (!dk && a > 0.9) inkC = mix(mix(uInk, mix(uInk, INK, 0.4), 1.0 - zU), uInk, clamp(lineK / max(cover, 1e-3), 0.0, 1.0));
            }
            // On dark paper hatching is laid in a light grey, and only the outlines keep the inks. Units keep their
            // side's ink throughout.
            if (dk) inkC = mix(mix(vec3(0.6, 0.6, 0.585), inkC, isU), inkC, clamp(lineK / max(cover, 1e-3), 0.0, 1.0));
          } else {
            // Crow quill sketch: two loose passes of each line and quick scribbled hatching that turns from patch to patch.
            vec2 cell = floor(p / (26.0 * uK));
            float ang = hash(cell + 3.0) * 180.0;
            float scr = hatch(p, ang, 5.0, 1.0, seedU + hash(cell) * 40.0, 0.25) * step(0.35, dens);
            scr = max(scr, hatch(p, ang + 70.0, 4.0, 0.9, seedU + 5.0, 0.3) * step(0.62, dens));
            vec2 o2 = vec2(1.6, -1.1) * k;
            vec2 e4 = vec2(A(uv + o2 + k * vec2(1.4, 0)) - A(uv + o2 - k * vec2(1.4, 0)), A(uv + o2 + k * vec2(0, 1.4)) - A(uv + o2 - k * vec2(0, 1.4)));
            cover = max(scr, max(lines, smoothstep(0.12, 0.42, length(e4)) * 0.7));
            paperC = vec3(0.96, 0.94, 0.88);
          }
          // Light, as the film draws a lamp: bare paper with a ragged inked rim.
          vec3 hz = texture2D(tHeat, vUv).rgb;
          float hr0 = max(hz.r, max(hz.g, hz.b));
          // Heat, given a boiling edge so a fireball's outline billows as a pen would draw it.
          float hn = hr0;
          if (hr0 > 0.04) hn += (noise(px * 0.045 / uK + boil * 5.3) - 0.5) * 0.34 * smoothstep(0.04, 0.3, hr0);
          float lit = step(0.26, hn), rim = 0.0;
          if (inverse) { cover = max(cover * (1.0 - lit), 0.0); cover = max(cover, rim * 0.0); }
          else { cover *= 1.0 - lit; cover = max(cover, rim); }
          if (uFxs > 0.5 && uFxs < 1.5) cover *= 1.0 - fxSmk * 0.9;
          vec3 col = mix(uStyle == 8 ? baseC : paperC, inkC, clamp(cover, 0.0, 1.0));
          col = dk ? mix(col, col + brdWC * 0.14, brdW) : col * mix(vec3(1.0), brdWC, brdW);
          col = mix(col, brdLC, brdL);
          // A flash is bare paper on light paper, and a warm glow on dark as it heats, never a white-out.
          vec3 flashC = dk ? mix(baseC, vec3(0.72, 0.6, 0.42), smoothstep(0.45, 1.0, hn) * 0.85) : paperC;
          // Smoke as a grey wash and fire as a warm wash round a bare-paper core, for the washed effects.
          if (uFxs > 0.5 && uFxs < 1.5) {
            col = mix(col, vec3(0.56, 0.53, 0.49), fxSmk * 0.5);
            col = mix(col, vec3(1.0, 0.82, 0.52), fxHeat * (1.0 - smoothstep(0.6, 0.95, fxHeat)) * 0.7);
            col = mix(col, flashC, smoothstep(0.6, 0.95, fxHeat));
          }
          col = mix(col, dk ? vec3(0.78, 0.6, 0.3) : vec3(0.42, 0.29, 0.12), clamp(oreL, 0.0, 1.0) * 0.85);
          // Colour in the shade: a cool violet wash under the ink where the sun does not reach, warm paper in the light.
          if (uStyle == 8 || uStyle == 0) {
            // On open ground it keeps to the real shadows and is lighter, so the land stays mostly paper.
            float gw = 1.0 - smoothstep(0.08, 0.15, A(vUv));
            float shade = smoothstep(mix(0.32, 0.52, gw), mix(0.78, 0.9, gw), dens) * (1.0 - lit) * (1.0 - waterK);
            // The soft axonometric has almost no light, so the mixture keeps its shade faint on the land.
            // A unit's shade is a cool slate. Violet on cream turns rose under the dawn and dusk light.
            vec3 shW = mix(vec3(0.6, 0.64, 0.9), vec3(0.64, 0.7, 0.78), smoothstep(0.85, 0.95, s0)), shA = mix(vec3(0.03, 0.025, 0.07), vec3(0.02, 0.03, 0.05), smoothstep(0.85, 0.95, s0));
            col = mix(col, col * shW + shA, shade * (uStyle == 8 ? mix(0.6, 0.3, gw) : mix(0.85, 0.6, gw)));
            if (uStyle == 0) col = mix(col, col * vec3(1.04, 0.99, 0.9), (1.0 - smoothstep(0.05, 0.35, dens)) * 0.6);
          }
          // The sides' markings in coloured ink.
          vec3 mk = texture2D(tSubj, uv).rgb;
          float mkx = max(mk.r, max(mk.g, mk.b));
          float mark = smoothstep(0.62, 0.8, mkx) * (1.0 - smoothstep(0.12, 0.42, length(e2)));
          vec3 hue = mk / max(0.001, mkx);
          // A light wash of the side's colour over each unit's body, as watercolour over ink.
          float wash = smoothstep(0.12, 0.25, mkx) * (1.0 - smoothstep(0.62, 0.8, mkx));
          // Each side's units drawn in its own ink (1), or their marks laid solid on a black body (2).
          float nearU = smoothstep(0.85, 0.95, max(max(A(uv + k * vec2(2.4, 0.0)), A(uv - k * vec2(2.4, 0.0))), max(max(A(uv + k * vec2(0.0, 2.4)), A(uv - k * vec2(0.0, 2.4))), s0)));
          // Away from units the side's inks and body have nothing to tint.
          if (uUnits == 1 && nearU <= 0.0 && s0 <= 0.85) { mark = 0.0; wash = 0.0; }
          else if (uUnits == 1) {
            // Lines take the side's ink. On dark paper a close unit's hatching takes it as it is, and a far unit's
            // solid shade keeps it.
            vec4 aw0 = texture2D(tAnc, vUv);
            vec3 sI = sideInk(aw0, dk), hI = dk ? sI : mix(sI, mix(sI, INK, 0.4), 1.0 - smoothstep(1.2, 1.9, uLev));
            float lk = clamp(lineK / max(cover, 1e-3), 0.0, 1.0);
            vec3 tInk = mix(hI, sI, lk);
            // On light paper a unit is a coloured figure drawn in dark line, as on snow, sand and pale ground the
            // side's colour must be in the body and the drawing in the line. The body is tinted first, then the
            // lines are laid in the side's ink taken well toward black, and the shade and hatching in a deep tone
            // of the body, so the parts stay apart and the unit never fills to one flat colour.
            if (!dk) {
              // The body is massed by face in shades of the side's colour, as the buildings are: tops palest, walls
              // facing left in the side's own tint, walls facing right deeper, and dark-painted parts, as tracks,
              // wheels and guns, deepest whichever way they face. The palest stays well short of the paper, so red
              // pales to a light terracotta and never to pink.
              vec3 bodyC = sideBody(aw0), nU = texture2D(tNorm, uv).xyz * 2.0 - 1.0;
              vec3 shadeB = dot(nU, uUpV) > 0.6 ? mix(bodyC, vec3(0.949, 0.910, 0.824), 0.38) : nU.x < 0.0 ? bodyC : bodyC * 0.74;
              shadeB = mix(shadeB, bodyC * 0.5, 1.0 - smoothstep(0.05, 0.13, L(uv)));
              // A wreck has lost its side's colour and is drawn charred, its faces in shades of soot.
              float charred = 1.0 - smoothstep(0.08, 0.15, aw0.w);
              shadeB = mix(shadeB, vec3(0.4, 0.37, 0.34) * (dot(nU, uUpV) > 0.6 ? 1.2 : nU.x < 0.0 ? 0.95 : 0.75), charred);
              // Every part of the unit takes the tint and the line, marked or not, so no part is left as bare
              // paper beside its tinted neighbours.
              col *= mix(vec3(1.0), shadeB / vec3(0.949, 0.910, 0.824), smoothstep(0.85, 0.95, s0));
              tInk = mix(bodyC * 0.5, mix(sI, INK, 0.6), lk);
            }
            col = mix(col, tInk, nearU * smoothstep(0.25, 0.6, cover) * (dk ? step(0.05, mkx) : 1.0)); mark = 0.0; wash = 0.0;
          }
          if (uUnits == 2) { col = mix(col, hue * 0.85, mark * nearU); mark = 0.0; wash = 0.0; }
          // Line, hatch and stipple units keep their bodies paper, the side shown by its marks alone.
          if (uUnits >= 3 && uUnits <= 5) wash = 0.0;
          // Ore is marked gold; every side's own colour comes through as itself.
          bool gold = hue.b < 0.3 && hue.g > 0.7 && s0 < 0.85;
          vec3 wc = gold ? vec3(1.0, 0.8, 0.3) : mix(vec3(1.0), hue, 0.5);
          col = mix(col, col * wc, wash * (gold ? (uStyle == 8 && uOre != 0 ? 0.0 : 0.85) : 0.55));
          vec3 colour = hue * (dk ? 0.9 : 0.7);
          // Coloured ink laid as close crosshatching, solid only where a marking is small.
          if (mark > 0.0) {
            float ch = max(hatch(p, 45.0, 2.6, 1.3, 77.0, 0.0), hatch(p, 135.0, 3.2, 1.1, 81.0, 0.0));
            col = mix(col, colour, mark * mix(0.55, 0.95, ch));
          }
          // Scars on the ground: crater rings with hatching inside, ink splatter solid.
          vec4 F = texture2D(tFogS, vUv);
          float sc = F.a, gnd = 1.0 - step(0.5, s0);
          float scw = max(fwidth(sc), 1e-4);
          float ringS = (1.0 - smoothstep(0.7 * uK, 1.8 * uK, abs(sc - 0.28) / scw)) * step(0.05, sc);
          // The scars as rings and solid splatter (uFxs 0), as a grey smudge lightly hatched (1), or as hatched
          // patches with no ring (2).
          float scT = 0.0;
          if (uFxs < 0.5) scT = sc > 0.9 ? 1.0 : max(tone(p, sc > 0.62 ? 5.0 : sc > 0.4 ? 3.0 : 0.0, 61.0), ringS);
          else if (uFxs < 1.5) {
            col = mix(col, dk ? vec3(0.06, 0.055, 0.05) : vec3(0.38, 0.34, 0.3), smoothstep(0.08, 0.7, min(sc, 0.75)) * gnd * 0.5);
            col = mix(col, inkC, hatch(p, 45.0, 5.0, 0.8, 61.0, 0.2) * smoothstep(0.35, 0.8, min(sc, 0.8)) * gnd * 0.3);
          } else { float scs = min(sc, 0.8); scT = tone(p, scs > 0.6 ? 4.0 : scs > 0.35 ? 2.0 : scs > 0.12 ? 1.0 : 0.0, 61.0) * 0.85; }
          col = mix(col, inkC, scT * gnd * 0.9);
          // Tread marks pressed into the ground, read from the scars on the land under the pixel, so they keep their
          // place and their width on the land at every zoom. A light sepia band with a crisp edge, darker where more
          // have passed, and broken a little by the land's own grain, which is pinned to the land as well. Four reads a
          // little apart round off the corners the scars' coarse texels would leave.
          vec2 Wm = landAt(vUv, F.b - 20.0), mu = Wm / uMap, mo = vec2(0.45 / 1024.0);
          float tG = 0.25 * (texture2D(tMarks, mu + mo).g + texture2D(tMarks, mu - mo).g + texture2D(tMarks, mu + vec2(mo.x, -mo.y)).g + texture2D(tMarks, mu + vec2(-mo.x, mo.y)).g);
          float tGw = max(fwidth(tG), 1e-4), tBand = smoothstep(0.06 - tGw * 0.6, 0.06 + tGw * 0.6, tG) * gnd;
          float tGrain = mix(0.3 + 0.7 * step(0.3, noise(Wm * 5.0)), 0.8, smoothstep(0.25, 0.8, fwidth(Wm.x * 5.0)));
          col = mix(col, dk ? vec3(0.44, 0.42, 0.39) : vec3(0.55, 0.46, 0.35), tBand * (0.24 + 0.36 * smoothstep(0.1, 0.45, tG)) * tGrain);
          // Blood where men and beasts fell, in solid red ink read from the scars on the land under the pixel.
          // A flat wash inside a fine outline of darker red, as a blot of ink dries.
          float bB = texture2D(tMarks, Wm / uMap).b, bw = max(fwidth(bB), 1e-4);
          float bld = smoothstep(0.36, 0.4, bB) * gnd, bRim = (1.0 - smoothstep(0.6 * uK, 1.5 * uK, abs(bB - 0.38) / bw)) * gnd;
          vec3 bloodC = dk ? vec3(0.5, 0.05, 0.045) : vec3(0.66, 0.08, 0.06);
          col = mix(col, bloodC, bld * 0.9);
          col = mix(col, bloodC * 0.55, bRim * 0.85);
          // Fire in flat bands of coloured ink, red, orange, yellow and a pale core, inside a black boiling outline.
          vec3 c1 = vec3(0.8, 0.17, 0.09), c2 = vec3(0.98, 0.47, 0.1), c3 = vec3(1.0, 0.82, 0.24), c4 = vec3(1.0, 0.97, 0.84);
          if (hz.b > hz.r * 1.1) { c1 = vec3(0.13, 0.33, 0.8); c2 = vec3(0.3, 0.6, 0.95); c3 = vec3(0.65, 0.86, 1.0); c4 = vec3(0.93, 0.97, 1.0); }
          // Fire as the bands (uFire 0), as a warm wash round a paper core with no outline (1), or as bare paper
          // with one thin outline and a halo of hatching, as an engraver leaves a flash white (2). The bands are
          // edged in a dark red, not black, so the fire reads as colour and never as a blot of ink.
          if (lit > 0.0) {
            vec3 fc = hn < 0.62 ? c1 : hn < 1.35 ? c2 : hn < 2.7 ? c3 : c4;
            if (uFire < 0.5) fc = mix(hn < 2.7 ? fc : vec3(1.0, 0.91, 0.55), c1 * 0.5, hatch(px, 45.0, 3.4, 1.0, 91.0 + boil, 0.05) * step(hn, 0.62) * 0.65);
            else if (uFire < 1.5) fc = mix(vec3(1.0, 0.76, 0.42), c4, smoothstep(0.8, 2.2, hn));
            else fc = flashC;
            col = mix(col, fc, lit);
          }
          if (uFire > 1.5) col = mix(col, inkC, hatch(px, 60.0, 3.0, 0.9, 5.0 + boil, 0.3) * smoothstep(0.08, 0.26, hr0) * (1.0 - lit) * 0.7);
          float fw = max(fwidth(hn), 1e-4), fxO = uFire < 0.5 ? 0.85 : uFire < 1.5 ? 0.0 : 0.7;
          float o1 = (1.0 - smoothstep(0.7 * uK, 1.8 * uK, abs(hn - 0.26) / fw)) * step(0.12, hr0) * fxO;
          float o2 = max(1.0 - smoothstep(0.5 * uK, 1.4 * uK, abs(hn - 0.62) / fw), 1.0 - smoothstep(0.5 * uK, 1.4 * uK, abs(hn - 1.35) / fw)) * step(uFire, 0.5);
          col = mix(col, uFire < 0.5 ? c1 * 0.42 : inkC, o1);
          col = mix(col, c1 * 0.45, o2 * lit * 0.85);
          // Cloud shadows passing over what is seen now, as a cool wash.
          vec4 LND = texture2D(tLand, vUv);
          col = mix(col, col * vec3(0.86, 0.89, 0.97), LND.g * uCloudK * 0.85 * step(1.0, F.b));
          // Ground not seen for a while is drawn paler and without colour. Ground never seen is bare paper with the
          // faint pencil of an unfinished drawing: contour lines of the land and long construction lines.
          // The shroud's marks are laid on the land under the pixel, from the height the fog pass left, so they keep
          // their place as the view is dragged. pL measures the land in pixels at the zoom's level, pL2 at the next.
          vec2 pL = landAt(vUv, F.b - 20.0) * 80.0 * exp2(-gLm) * uK, pL2 = pL * 0.5;
          // The ragged edge moves a border by a quarter at most, so well inside what is seen it is not worked out.
          float edgeN = 0.0;
          if (F.g < 0.87 || F.r < 0.825) edgeN = (mix(noise(pL * 0.03 / uK), noise(pL2 * 0.03 / uK + 7.0), gLf) - 0.5) * 0.5;
          float seenE = smoothstep(0.38, 0.62, F.g + edgeN), visE = smoothstep(0.3, 0.7, F.r + edgeN * 0.5);
          if (uStyle == 8 && visE < 1.0) {
            // What was, as a ghost plan draws it: pale washes and dashed blue-grey line, with no tone. Each dash
            // runs along its line, found from the edge of the shape or else of the land, so a straight edge dashes
            // evenly. The side's colour stays faintly, to say whose it was.
            vec2 gd = vec2(A(vUv + k * vec2(2.5, 0)) - A(vUv - k * vec2(2.5, 0)), A(vUv + k * vec2(0, 2.5)) - A(vUv - k * vec2(0, 2.5)));
            if (length(gd) < 0.04) gd = e1;
            float dash = length(gd) > 0.02 ? step(0.42, fract(dot(p, normalize(vec2(-gd.y, gd.x))) / (6.5 * uK))) : step(0.35, hash(floor(p / (5.0 * uK)) + 17.0));
            // On dark paper what was is drawn toward the slate of ground not yet seen, half greyed, so its shades
            // hold and its earth is not taken for the brown of the heights now seen.
            vec3 past = dk ? mix(SLATE, mix(vec3(dot(baseC, vec3(0.3, 0.59, 0.11))), baseC, 0.55), 0.5) : mix(paperC, baseC, 0.4);
            // Remembered ore is the brightest thing on dark paper, so it is sunk toward the paper there, and its many
            // small rings are dashed lightly on either paper.
            float oreP = max(max(oA(vUv + k * vec2(1.6, 0)), oA(vUv - k * vec2(1.6, 0))), max(max(oA(vUv + k * vec2(0, 1.6)), oA(vUv - k * vec2(0, 1.6))), oA(vUv)));
            if (dk) past = mix(past, paperC * 1.5, oreP * 0.55);
            past = mix(past, hue * 0.8, mark * 0.3);
            past = mix(past, dk ? vec3(0.5, 0.58, 0.74) : WAS, clamp(lineK, 0.0, 1.0) * dash * 0.75 * (1.0 - 0.6 * oreP));
            col = mix(past, col, visE);
          } else if (uStyle != 8) {
            vec3 faded = mix(paperC, col, 0.55);
            faded = mix(vec3(dot(faded, vec3(0.3, 0.59, 0.11))), faded, 0.2);
            col = mix(faded, col, visE);
          }
          // Off the map there is no land, so no contours, only the guide lines.
          float onMap = step(1.0, F.b), hgt = F.b - 20.0;
          float hw = max(fwidth(hgt), 1e-4), hf = fract(hgt / 0.8);
          // Roads are pencilled in too, as two faint ruled lines.
          float rdS = texture2D(tLand, vUv).r, rdW = max(fwidth(rdS), 1e-4);
          if (seenE < 1.0) {
            float cont = (1.0 - smoothstep(0.4 * uK, 1.2 * uK, min(hf, 1.0 - hf) * 0.8 / hw)) * step(0.3, mix(noise(pL * 0.04 / uK + 3.0), noise(pL2 * 0.04 / uK + 5.0), gLf)) * onMap;
            float guide = mix(hatch(pL, 18.0, 70.0, 0.7, 3.0, 0.55) + hatch(pL, 104.0, 95.0, 0.6, 8.0, 0.6), hatch(pL2, 18.0, 70.0, 0.7, 3.0, 0.55) + hatch(pL2, 104.0, 95.0, 0.6, 8.0, 0.6), gLf);
            float rP = (1.0 - smoothstep(0.4 * uK, 1.0 * uK, abs(rdS - 1.3) / rdW)) * onMap;
            // On dark paper the ground not yet seen is a cool slate, lighter than the paper so it does not sink to
            // black, and blue so it is not taken for the brown of high ground.
            vec3 skP = dk ? SLATE : paperC;
            vec3 sketch = mix(skP, dk ? vec3(0.47, 0.51, 0.58) : vec3(0.5, 0.49, 0.47), clamp(cont * 0.42 + guide * 0.14 + rP * 0.4, 0.0, 1.0));
            col = mix(sketch, col, seenE);
          }
          // Weather over everything. Fog and morning mist lie in the low ground and drift in banks, and the fog of
          // a foggy spell veils all of it.
          float hg = F.b - 20.0, fbank = smoothstep(0.3, 0.75, LND.b);
          float veil = uFog * (0.28 + 0.3 * fbank + 0.16 * (1.0 - smoothstep(-0.5, 2.5, hg))) + uMist * 0.55 * (1.0 - smoothstep(-0.6, 1.1, hg)) * (0.35 + 0.65 * fbank);
          veil = clamp(veil * onMap, 0.0, 0.8) * (1.0 - 0.4 * step(0.85, s0));
          col = mix(col, dk ? vec3(0.25, 0.25, 0.26) : vec3(0.945, 0.94, 0.925), veil);
          float fband = veil > 0.2 ? hatch(px + vec2(uTime * 5.0 * uK, 0.0), 0.0, 10.0, 0.8, 97.0, 0.6) * smoothstep(0.2, 0.55, veil) : 0.0;
          col = mix(col, dk ? vec3(0.42, 0.44, 0.5) : vec3(0.6, 0.62, 0.67), fband * 0.2);
          // Blown sand as an ochre veil, billowing as it is carried on the wind.
          if (uSand > 0.0) {
            vec2 blw = landAt(vUv, max(hg, 0.0) + 1.5) * 0.03 + uCloud * 5.0;
            float billow = noise(blw) * 0.6 + noise(blw * 2.3 + 5.0) * 0.4, keepU = 1.0 - 0.4 * step(0.85, s0);
            float dustV = clamp(uSand * (0.3 + 0.38 * billow) * onMap, 0.0, 0.7) * keepU;
            col = mix(col, dk ? vec3(0.36, 0.3, 0.22) : vec3(0.86, 0.76, 0.58), dustV);
          }
          // Grit driven low across the page in long fine strokes.
          if (uSand > 0.01) {
            float sx = uWindS.x >= 0.0 ? 1.0 : -1.0;
            vec2 sd = normalize(vec2(sx, -0.12)), sn = vec2(-sd.y, sd.x);
            float sp = 6.0 * uK, ac = dot(px, sn), al = dot(px, sd) - uTime * 700.0 * uK, ci = floor(ac / sp), per = 220.0 * uK;
            float ph = hash(vec2(ci, 9.0)) * per, row = floor((al + ph) / per), pos = mod(al + ph, per), len = (40.0 + 30.0 * hash(vec2(ci, row + 2.0))) * uK;
            float grit = step(hash(vec2(ci, row)), uSand * 0.4) * step(pos, len) * (1.0 - smoothstep(0.2 * uK, 0.7 * uK, abs(fract(ac / sp) - 0.5) * sp));
            col = mix(col, dk ? vec3(0.66, 0.56, 0.4) : vec3(0.55, 0.42, 0.25), grit * 0.4);
          }
          // Rays of sun in broken cloud: a few broad beams fanning from a sun beyond the screen's edge on its side,
          // turning slowly, longest with the sun low, and broken wherever a cloud's shadow lies across them.
          vec2 sunH = uSunW.xz / max(uSunW.y, 0.35);
          if (uRayK > 0.01) {
            vec2 dv = px - (res * 0.5 + uSun2 * res.y * 1.4);
            float ang = atan(dv.y, dv.x), far = length(dv) / res.y;
            float bn = noise(vec2(ang * 9.0 + uTime * 0.015, 3.1)) * 0.65 + noise(vec2(ang * 23.0 - uTime * 0.01, 7.7)) * 0.35;
            float beam = smoothstep(0.5, 0.78, bn) * (1.0 - smoothstep(0.7, 2.7, far)) * (1.0 - 0.85 * LND.g);
            // On light paper the air between the beams is a shade cooler, as the beams alone would hardly show.
            if (!dk) col = mix(col, col * vec3(0.93, 0.94, 0.97), uRayK * (1.0 - beam) * 0.6 * (1.0 - smoothstep(0.7, 2.7, far)));
            col = mix(col, dk ? vec3(0.8, 0.72, 0.52) : vec3(1.0, 0.9, 0.64), uRayK * beam * (dk ? 0.32 : 0.4));
          }
          // Rain in slanted pen strokes, leaning with the wind, and rings where the drops land.
          if (uRain > 0.01) {
            vec2 rd = normalize(vec2(uWindS.x * 0.45 + 0.1, -1.0)), rn = vec2(-rd.y, rd.x);
            float sp = 7.0 * uK, ac = dot(px, rn), al = dot(px, rd) - uTime * 1000.0 * uK, ci = floor(ac / sp), per = 160.0 * uK;
            float ph = hash(vec2(ci, 3.0)) * per, row = floor((al + ph) / per), pos = mod(al + ph, per), len = (16.0 + 14.0 * uStorm) * uK;
            float drop = step(hash(vec2(ci, row)), uRain * (0.5 + 0.45 * uStorm)) * step(pos, len) * (1.0 - smoothstep(0.25 * uK, 0.8 * uK, abs(fract(ac / sp) - 0.5) * sp));
            col = mix(col, dk ? vec3(0.55, 0.62, 0.74) : vec3(0.3, 0.36, 0.48), drop * 0.45);
            vec2 sq = (px - uOff) / (20.0 * uK), si = floor(sq), sf = fract(sq) - 0.5;
            float st = fract(uTime * 1.3 + hash(si + 7.0));
            float ring = (1.0 - smoothstep(0.015, 0.05, abs(length(sf * vec2(1.0, 1.7)) - st * 0.4))) * step(hash(si + 3.0), uRain * 0.6) * (1.0 - st) * (1.0 - step(0.5, s0)) * seenE;
            col = mix(col, dk ? vec3(0.5, 0.57, 0.7) : vec3(0.35, 0.42, 0.55), ring * 0.55);
          }
          // Snow falling in two layers, each flake white with a fine blue-grey rim.
          float snowF = uSnowF;
          if (snowF > 0.01) {
            for (int L = 0; L < 2; L++) {
              float fl = float(L), sc = 15.0 + fl * 9.0;
              vec2 q = (px + vec2(sin(uTime * 0.7 + fl * 2.0) * 10.0 * uK + uTime * uWindS.x * 30.0 * uK, uTime * (45.0 + fl * 30.0) * uK)) / (sc * uK);
              vec2 qi = floor(q), qf = fract(q) - 0.5 - (vec2(hash(qi + fl * 7.0), hash(qi + 3.0 + fl)) - 0.5) * 0.6;
              float has = step(hash(qi + 11.0 + fl), min(snowF * 0.55, 0.9)), r = (1.4 + fl * 0.8) / sc, dd = length(qf);
              float inner = 1.0 - smoothstep(r * 0.55, r * 0.8, dd), rimF = (1.0 - smoothstep(r * 0.8, r * 1.1, dd)) - inner;
              col = mix(col, vec3(0.45, 0.5, 0.62), max(rimF, 0.0) * has * 0.7);
              col = mix(col, vec3(1.0), inner * has);
            }
          }
          // The clouds themselves over everything, see-through washes drifting with the wind, white in fair weather and
          // grey in foul, each edged with a light scalloped line as a drawn cloud is. They thin when the view is close
          // and over units, so nothing below is lost.
          if (uCloudA > 0.01) {
            vec2 cxz = landAt(vUv, CLOUD_H) - sunH * CLOUD_H;
            float cb = cloudAt(cxz);
            float ca = cb * uCloudA * (1.0 - 0.5 * uCloudG) * mix(0.55, 1.0, smoothstep(1.0, 2.2, uLev)) * (1.0 - 0.45 * step(0.85, s0));
            vec3 cc = dk ? mix(vec3(0.64, 0.65, 0.68), vec3(0.44, 0.45, 0.49), uCloudG) : mix(vec3(1.0, 1.0, 1.0), vec3(0.74, 0.76, 0.82), uCloudG * 0.85);
            col = mix(col, cc, ca);
            float cw = max(fwidth(cb), 1e-4), cl0 = (1.0 - smoothstep(0.6 * uK, 1.6 * uK, abs(cb - 0.5) / cw)) * step(0.15, noise(cxz * 0.9 + 3.0));
            col = mix(col, dk ? vec3(0.78, 0.79, 0.82) : vec3(0.48, 0.52, 0.6), cl0 * min(1.0, uCloudA * 1.6) * (1.0 - 0.5 * uCloudG));
          }
          // The hour: rose at dawn, amber toward dusk, and night as a blue wash over the page.
          col = col * uDayMul + uDayAdd;
          col = mix(col, col * vec3(0.6, 0.66, 0.82) + vec3(0.02, 0.03, 0.06), uNight * 0.72);
          // The other pen techniques in the dark scheme: every tone turned over and every hue kept, as the page's CSS
          // turns the overlay over with invert(0.93) and hue-rotate(180deg), so all of it agrees.
          if (uDark > 0.5 && !dk) {
            vec3 iv = mix(col, 1.0 - col, 0.93);
            col = clamp(vec3(dot(iv, vec3(-0.574, 1.43, 0.144)), dot(iv, vec3(0.426, 0.43, 0.144)), dot(iv, vec3(0.426, 1.43, -0.856))), 0.0, 1.0);
          }
          // Paper grain over everything, as js/ink.js finishes a frame.
          vec2 g = (onThing > 0.5 ? own : px - uOff) / uK;
          float grain = texture2D(tPaper, g / 900.0).r, fib = texture2D(tPaper, g / 300.0 + 0.4).b;
          col *= 0.94 + 0.05 * grain + 0.03 * fib;
          vec2 o = vUv - 0.5; col *= 1.0 - dot(o, o) * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }` });
      const look = Looks.get('ink');
      // Each side's key as the anchor pass writes it, the hue and colourfulness of its linear colour, and its inks.
      let sides = false;
      const setSides = C => {
        World.SLOT_COLORS.forEach((hex, i) => {
          const c = new THREE.Color(hex), mx = Math.max(c.r, c.g, c.b), d = mx - Math.min(c.r, c.g, c.b);
          let hh = d < 1e-4 ? 0 : mx === c.r ? ((c.g - c.b) / d + 6) % 6 : mx === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
          C.uSideKey.value[i].set(hh / 6, mx > 0 ? d / mx : 0);
          const ink = (s, v) => v.set(parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255);
          ink(World.SLOT_INKS.light[i], C.uSideL.value[i]); ink(World.SLOT_INKS.dark[i], C.uSideD.value[i]); ink(World.SLOT_INKS.body[i], C.uSideB.value[i]);
        });
        sides = true;
      };
      return {
        render(K) {
          const C = ink.uniforms, { w, h, camera, sky } = K, [CX, CY] = K.center;
          if (!C.tPaper.value) C.tPaper.value = K.paper();
          if (!sides) setSides(C);
          C.t.value = K.ldr.texture; C.tSubj.value = K.mask(); C.tNorm.value = K.norm(); C.tHeat.value = K.a0.texture;
          C.tFx.value = K.fx(); C.uFxs.value = look.fxs || 0; C.uFire.value = look.fire ?? (look.fxs || 0); C.uUnits.value = look.units || 0; C.tAnc.value = K.anchor(); C.uDark.value = Looks.dark ? 1 : 0; C.uInks.value = look.inks || 0;
          C.res.value.set(w, h); C.uTime.value = K.time; C.uK.value = h / 1080;
          C.tFogS.value = K.fog();
          // Distance to the nearest road, per pixel of the land.
          C.tLand.value = K.land();
          const q = new THREE.Vector3(CX, 1, CY).project(camera); C.uOff.value.set((q.x + 1) / 2 * w, (q.y + 1) / 2 * h);
          C.uStyle.value = K.opts.ink;
          K.landUniforms(C);
          // The pen thins as the view draws back and thickens a little close in, as a drawing at a smaller scale is
          // drawn with a finer pen. Every line, hatch and tap in the pass is measured in uK, so all of them follow.
          // Full weight at the usual view, level 1.77, and never finer than a small screen's own pixel allows.
          const kBase = h / 1080, kZoom = Math.min(1.12, Math.max(0.62, Math.pow(2, -(C.uLev.value - 1.77) * 0.65)));
          C.uK.value = Math.max(Math.min(kBase, 0.75), kBase * kZoom);
          // Which way the sun lies across the screen.
          const s = SH.uSunDir.value, q1 = new THREE.Vector3(CX + s.x * 8 / Math.hypot(s.x, s.z), 1, CY + s.z * 8 / Math.hypot(s.x, s.z)).project(camera);
          C.uSun2.value.set((q1.x - q.x) * w, (q1.y - q.y) * h).normalize();
          // The world's up in view space, to tell a building's roof from its walls.
          C.uUpV.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
          C.uRoad.value = K.opts.road; C.uOre.value = K.opts.ore; C.uMarks.value = K.marked ? 1 : 0;
          C.uRain.value = sky.rain; C.uStorm.value = sky.storm; C.uSnowF.value = sky.snow; C.uFog.value = sky.fog; C.uMist.value = sky.mist;
          C.uSand.value = sky.sand || 0; C.uCloudA.value = sky.cloudA || 0; C.uCloudG.value = sky.cloudG || 0; C.uRayK.value = sky.rayK || 0;
          C.uNight.value = sky.night; C.uWet.value = sky.wet; C.uDayMul.value.set(...sky.mul); C.uDayAdd.value.set(...sky.add);
          C.uWaterL.value = K.waterLevel; C.uWindS.value.set(sky.windS, 0);
          C.uMe.value = Math.max(0, K.viewTeam); C.uView.value.set(Math.cos(K.cam.yaw), Math.sin(K.cam.yaw)); C.uHSize.value.set(Rules.VW, Rules.VH); C.uHScale.value = Rules.RES;
          K.run(ink, null);
        },
      };
    },
  });
})();
