// Dead Ground, the picture. Terrain is baked once. Units are instanced by part. Fog, borders and
// battle scars live in small textures every material reads. Fire and smoke are GPU particles.
const World = (() => {
  const { RES, HZ, UNITS, BUILDINGS, clamp, lerp, smooth, terrainAt, heightAt, mulberry, noiser } = Rules;
  // The map's size comes with each world loaded: a duel is 128 cells across, the shared world 256.
  let W = Rules.W, H = Rules.H, VW = Rules.VW, VH = Rules.VH;

  // Every theatre is shot at sunset. The sun sits low off the left of the screen, so shadows run long
  // across the ground, and the shade is lit by a violet sky and warm bounce from the earth.
  const SUN = (az, el) => { const x = Math.cos(az), z = Math.sin(az), c = Math.cos(el); return [x * c, Math.sin(el), z * c]; };
  // Each theatre's trees, the height up the slopes where conifers take over from them, the height above which
  // snow lies the year round, and its beasts: the herds in their shares, the wolf packs, and whether ducks swim.
  const THEMES = {
    desert: {
      name: 'Salt Flats', tree: 'acacia', pine: 6, snow: 10.8, fauna: [['camel', 2], ['gazelle', 3], ['goat', 1]], wolves: 0, ducks: false, sun: SUN(-0.46, 0.3), sunColor: 0xffb36e, sunPower: 3.9,
      hemi: [0x5e6cb4, 0x7a4c34, 0.9], env: [0x34437e, 0xffa866, 0x3e2a22], haze: 0xf0a878, hazeK: 0.008, shroud: 0x100a0a,
      ground: [0xd2b08a, 0xbf9670], patch: 0xa69a6a, rock: 0xa86a52, bank: 0x8a7058, road: 0x76604e, stain: 0x9a5a30,
      water: [0x3f8c96, 0x17404e], leaf: [0x6a7438, 0x8a8440], dust: [0.95, 0.74, 0.55], smoke: [0.17, 0.13, 0.12], ripple: 1,
    },
    steppe: {
      name: 'Black Steppe', tree: 'broad', pine: 5, snow: 9, fauna: [['deer', 2], ['horse', 2], ['sheep', 2]], wolves: 1, ducks: true, sun: SUN(-0.5, 0.27), sunColor: 0xffa862, sunPower: 3.8,
      hemi: [0x5a66ae, 0x6e4a30, 0.88], env: [0x32407a, 0xff9e5c, 0x34241a], haze: 0xe8a07a, hazeK: 0.008, shroud: 0x0f0a09,
      ground: [0xb59a62, 0x8e744a], patch: 0xcaa860, rock: 0x7e6252, bank: 0x5e4c3c, road: 0x5e4a3a, stain: 0x8a4e28,
      water: [0x3b7a80, 0x163a46], leaf: [0x56622c, 0x84702c], dust: [0.8, 0.66, 0.5], smoke: [0.15, 0.12, 0.11], ripple: 0,
    },
    winter: {
      name: 'White Pass', tree: 'conifer', snow: 6.5, fauna: [['elk', 3], ['goat', 2], ['deer', 1]], wolves: 2, ducks: true, sun: SUN(-0.42, 0.25), sunColor: 0xffae80, sunPower: 3.3,
      hemi: [0x6c74c0, 0x9a7a74, 0.92], env: [0x3e4a8c, 0xffb084, 0x584450], haze: 0xf0b49c, hazeK: 0.008, shroud: 0x0f0b0e,
      ground: [0xf0e6e2, 0xdcd0cc], patch: 0xc8bcb8, rock: 0x7a6466, bank: 0x8a7a7a, road: 0x6c5e5a, stain: 0x8a5e48,
      water: [0x4a8494, 0x1c3e50], leaf: [0x2e4436, 0x42583e], dust: [0.96, 0.92, 0.92], smoke: [0.17, 0.15, 0.16], ripple: 0,
    },
  };

  let CX = W / 2, CY = H / 2;
  // A colour for each of the eight slots. A duel uses the first two. Blue, red, green, violet, orange, teal,
  // citron and brown, with no pink, which is only a light red.
  const SLOT_COLORS = [0x2f7ef0, 0xe03a24, 0x2fa84a, 0x8a4fd8, 0xf08a1c, 0x1fb3b3, 0xc8d42a, 0x7a5230];
  // Each slot's ink in the pen and ink look, a deep one for light paper and a bright one for dark. Red leans a
  // little to vermilion, so its soft edges on cream stay red, and orange leans to amber, clear of it. On dark paper
  // red keeps a middle lightness, since a light red is pink. The nearest two inks on either paper are about 0.1
  // apart in OKLab.
  const SLOT_INKS = {
    light: ['#1d4fc4', '#a82a0a', '#1e7a32', '#6a2fb0', '#c07000', '#0a7480', '#7f7c00', '#6a4020'],
    dark: ['#68a8ff', '#ee3a22', '#56cc6c', '#b088f2', '#ff7a1a', '#3fd0cc', '#cdf044', '#a8805a'],
    // A unit's body on light paper, tinted in its side's colour so it stands out from the ground. Red is a
    // terracotta, as a light red on cream reads as pink.
    body: ['#8aa8e6', '#cf7a4c', '#7db874', '#9a84d2', '#e2aa48', '#64b9b5', '#bfc552', '#a9845c'],
  };

  function create(THREE, canvas, opt = {}) {
    const low = !!opt.low;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opt.keep });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = true;
    const MODELS = Models.make(THREE);
    // Each building's model in each age, by kind and then age, so a base is drawn in its owner's age.
    const AGE_KEYS = {};
    for (const k in BUILDINGS) AGE_KEYS[k] = [0, 1, 2, 3, 4, 5, 6].map(a => MODELS.ageKey(k, a));
    const ageKey = (kind, age) => (AGE_KEYS[kind] && AGE_KEYS[kind][age]) || kind;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 2, 500);
    const cam = { x: 40, y: 40, dist: 92, yaw: Math.PI / 4, pitch: 0.98, shake: 0, minD: 30, maxD: 190 };

    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); black.needsUpdate = true;
    const farBrook = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); farBrook.needsUpdate = true;
    const SH = {
      tFog: { value: white }, tDetail: { value: null }, tTerr: { value: white }, tH: { value: white }, tMarks: { value: white }, uTime: { value: 0 },
      uTeam0: { value: new THREE.Color(0x3f8cff) }, uTeams: { value: SLOT_COLORS.map(c => new THREE.Color(c).offsetHSL(0, 0, 0.06)) }, uFogOn: { value: 1 }, uBorder: { value: 1 }, uMap: { value: 128 },
      uHaze: { value: new THREE.Color(0xf29a5e) }, uHazeK: { value: 0.012 }, uHazeFrom: { value: 80 }, uShroud: { value: new THREE.Color(0x120907) }, uSunDir: { value: new THREE.Vector3(1, 0.3, 0) },
      // The wind on the ground, how far it has carried the clouds, how overcast it is, and lying snow.
      uWind: { value: new THREE.Vector2(0.3, 0.1) }, uCloud: { value: new THREE.Vector2() }, uCloudK: { value: 0.2 }, uCloudT: { value: 0.3 }, uSnowC: { value: 0 },
      // The height above which snow lies on the heights in any weather.
      uSnowLine: { value: 99 },
      // The way the rivers run, from buildFlow, and how far each point lies from a brook and whether at its ford.
      tFlow: { value: black }, tBrook: { value: farBrook },
      // The land's cover from buildFields: the beaches in red, and the farmland round the towns, its extent in green,
      // its town's turn of the plots in blue and how far out from the town in alpha.
      tCover: { value: black },
      // The farmland as the world's age lays it out: how far out it reaches, a row's depth, a plot's length and the
      // share of its edges hedged, then the shares walled, in orchard and in meadow.
      uFieldK: { value: new THREE.Vector4() }, uFieldK2: { value: new THREE.Vector4() },
      // The theatre's wild flowers: 1 the steppe's, 2 the salt flats', 3 the snowy pass's heather.
      uFlora: { value: 0 },
      // Up to four showers over the map: x, y, radius, and strength, negative for snow.
      uShow: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      // Up to sixteen town parks: x, y, radius and the turn of their paths.
      uPark: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
      // The kind of the bridges: 0 timber, 1 stone, 2 iron, 3 concrete.
      uBridgeKind: { value: 3 },
      // How far tread marks darken the ground, none where the look draws them itself.
      uTreadK: { value: 0.34 },
      // How hard the track worn into each cell has become, in red.
      tTrail: { value: black },
    };
    // Trees lean with the wind and stir in it, more toward their tops. Shared by every pass that draws them.
    const SWAY = `
      vec2 sway(vec2 at, float h) {
        float s = h * h * 0.05, ph = uTime * 1.7 + at.x * 0.31 + at.y * 0.23;
        return uWind * s * (0.6 + 0.4 * sin(ph)) + vec2(-uWind.y, uWind.x) * s * 0.2 * sin(ph * 1.9 + 1.3);
      }`;

    function patch(mat, o = {}) {
      const key = 'dg' + (o.plain ? 'p' : '') + (o.terrain ? 't' : '') + (o.tint ? 'i' : '') + (o.sway ? 's' : '');
      mat.customProgramCacheKey = () => key;
      mat.onBeforeCompile = s => {
        Object.assign(s.uniforms, SH);
        let v = s.vertexShader, f = s.fragmentShader;
        v = v.replace('#include <common>', `#include <common>
          varying vec3 vW; varying vec3 vL; varying float vGlow; varying vec3 vTint;
          uniform vec2 uWind; uniform float uTime;
          ${SWAY}
          ${o.plain ? '' : 'attribute float aTeam; attribute float aGlow;'}`);
        if (!o.plain && !o.tint) {
          v = v.replace('#include <color_vertex>', `
            vColor = vec3(1.0);
            #ifdef USE_COLOR
              vColor *= color;
            #endif
            vTint = vec3(0.0);
            #ifdef USE_INSTANCING_COLOR
              vColor = mix(vColor, vColor * instanceColor.xyz, aTeam);
              vTint = instanceColor.xyz * aTeam;
            #endif`);
        }
        v = v.replace('#include <project_vertex>', `#include <project_vertex>
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp; vW = wp.xyz; vL = position;
          vGlow = ${o.plain ? '0.0' : 'aGlow'};`);
        if (o.sway) v = v.replace('#include <project_vertex>', `
          vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          mvPosition.xz += sway(mvPosition.xz, position.y);
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
        f = f.replace('#include <common>', `#include <common>
          uniform sampler2D tFog, tDetail, tTerr, tMarks, tTrail; uniform float uTreadK, uTime, uFogOn, uBorder, uHazeK, uHazeFrom, uMap, uCloudK, uSnowC; uniform vec3 uTeam0, uTeams[8], uHaze, uShroud, uSunDir; uniform vec2 uCloud;
          varying vec3 vW; varying vec3 vL; varying float vGlow; varying vec3 vTint;`);
        if (o.plain || o.tint) v = v.replace('vGlow = ', 'vTint = vec3(0.0); vGlow = ');
        if (o.terrain) {
          f = f.replace('#include <map_fragment>', `#include <map_fragment>
            float d1 = texture2D(tDetail, vW.xz * 0.27).r, d2 = texture2D(tDetail, vW.xz * 1.6).g;
            diffuseColor.rgb *= 0.82 + 0.26 * d1 + 0.1 * d2;
            vec4 mk = texture2D(tMarks, vW.xz / uMap);
            diffuseColor.rgb *= 1.0 - mk.r * 0.86;
            diffuseColor.rgb *= 1.0 - mk.g * uTreadK;
            // Blood, a deep red soaked into the ground.
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.018, 0.016), smoothstep(0.32, 0.45, mk.b) * 0.9);
            // Worn tracks, bare earth.
            float trk = texture2D(tTrail, vW.xz / uMap).r;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.84, 0.74) + vec3(0.05, 0.04, 0.02), smoothstep(0.2, 0.6, trk) * 0.7);`);
          f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            vec4 dn = texture2D(tDetail, vW.xz * 0.8), dn2 = texture2D(tDetail, vW.xz * 0.19);
            vec3 wn = vec3((dn.b - 0.5) * 0.35 + (dn2.b - 0.5) * 1.2, 0.0, (dn.a - 0.5) * 0.35 + (dn2.a - 0.5) * 1.2);
            normal = normalize(normal + mat3(viewMatrix) * wn * 0.45);`);
        } else {
          f = f.replace('#include <color_fragment>', `#include <color_fragment>
            float gr = texture2D(tDetail, vL.xz * 1.1 + vL.yy * vec2(0.7, 1.1)).r;
            diffuseColor.rgb *= 0.72 + 0.56 * gr;`);
          f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance += diffuseColor.rgb * vGlow * 3.4 + vTint * vTint * 0.0;`);
        }
        const border = o.terrain ? `
            // Red holds the viewer's own reach and green the strongest other side's, each signed so its
            // border is a zero crossing; blue says which side that other is, read from the nearest cell.
            vec2 tv = (texture2D(tTerr, vW.xz / uMap).rg - 0.5) * 16.0;
            float who = floor(texture2D(tTerr, (floor(vW.xz) + 0.5) / uMap).b * 8.0 + 0.5);
            vec3 other = uTeams[0];
            for (int i = 1; i < 8; i++) if (float(i) == who) other = uTeams[i];
            float la = abs(tv.x), lb = abs(tv.y), w = 0.09 + fwidth(tv.x) * 0.8;
            float ia = (1.0 - smoothstep(0.0, 4.0, tv.x)) * step(0.0, tv.x), ib = (1.0 - smoothstep(0.0, 4.0, tv.y)) * step(0.0, tv.y);
            vec3 bc = gl_FragColor.rgb;
            bc = mix(bc, bc * 0.7 + uTeam0 * 0.25, ia * 0.42 * uBorder);
            bc = mix(bc, bc * 0.7 + other * 0.25, ib * 0.42 * uBorder);
            bc += uTeam0 * 0.85 * smoothstep(w, 0.0, la) * uBorder;
            bc += other * 0.85 * smoothstep(w, 0.0, lb) * uBorder;
            gl_FragColor.rgb = bc;` : '';
        f = f.replace('#include <opaque_fragment>', `#include <opaque_fragment>
          // Cloud shadows go by on the wind, darker the more overcast it is. Snow lies on whatever faces up.
          float cl = texture2D(tDetail, vW.xz * 0.006 + uCloud).r;
          gl_FragColor.rgb *= mix(0.9 - 0.25 * uCloudK, 1.03, smoothstep(0.3, 0.7, cl));
          ${o.terrain || o.tint ? `vec3 fN = normalize(cross(dFdx(vW), dFdy(vW)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.94, 0.97) * (0.55 + 0.5 * max(dot(fN, uSunDir), 0.0)), uSnowC * smoothstep(0.55, 0.85, abs(fN.y)));` : ''}
          ${border}
          // Warm air thickens with distance, brightest toward the sun.
          vec3 vd = normalize(vW - cameraPosition);
          float hz = 1.0 - exp(-max(length(vW - cameraPosition) - uHazeFrom, 0.0) * uHazeK);
          vec3 air = uHaze * (0.5 + 0.7 * pow(max(dot(vd, uSunDir), 0.0), 3.0));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, air, hz * 0.38);
          vec2 fg = mix(vec2(1.0), texture2D(tFog, vW.xz / uMap).rg, uFogOn);
          float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 dimmed = mix(gl_FragColor.rgb, vec3(lum), 0.45) * vec3(0.46, 0.4, 0.38);
          gl_FragColor.rgb = mix(uShroud, mix(dimmed, gl_FragColor.rgb, fg.r), fg.g);
          vec2 ed = abs(vW.xz / uMap - 0.5) * 2.0;
          gl_FragColor.rgb = mix(uShroud, gl_FragColor.rgb, (1.0 - smoothstep(0.985, 1.002, max(ed.x, ed.y))));`);
        s.vertexShader = v; s.fragmentShader = f;
      };
      return mat;
    }

    const paint = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.22, envMapIntensity: 1 }));
    const plainTint = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 }), { tint: true });
    const treeTint = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 }), { tint: true, sway: true });

    // A tiling noise texture, height in red, grain in green, and its slope in blue and alpha.
    function makeDetail() {
      const n = 256, rand = mulberry(77), lat = (p) => { const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = rand(); return a; };
      const octs = [[8, 0.5], [16, 0.26], [32, 0.14], [64, 0.07], [128, 0.03]].map(([p, a]) => ({ p, a, g: lat(p) }));
      const hgt = new Float32Array(n * n), grain = lat(n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let s = 0;
        for (const o of octs) {
          const fx = x / n * o.p, fy = y / n * o.p, ix = fx | 0, iy = fy | 0, u = fx - ix, v = fy - iy, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
          const q = (a, b) => o.g[((b + o.p) % o.p) * o.p + ((a + o.p) % o.p)];
          s += o.a * lerp(lerp(q(ix, iy), q(ix + 1, iy), su), lerp(q(ix, iy + 1), q(ix + 1, iy + 1), su), sv);
        }
        hgt[y * n + x] = s;
      }
      let lo = 9, hi = -9;
      for (const v of hgt) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const data = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const c = y * n + x, h = (hgt[c] - lo) / (hi - lo);
        const dx = hgt[y * n + (x + 1) % n] - hgt[y * n + (x + n - 1) % n], dy = hgt[((y + 1) % n) * n + x] - hgt[((y + n - 1) % n) * n + x];
        data[c * 4] = h * 255; data[c * 4 + 1] = (grain[c] * 0.6 + h * 0.4) * 255;
        data[c * 4 + 2] = clamp(0.5 - dx * 6, 0, 1) * 255; data[c * 4 + 3] = clamp(0.5 - dy * 6, 0, 1) * 255;
      }
      const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
      return t;
    }
    SH.tDetail.value = makeDetail();

    let style = Looks.get('ink'), inkStyle = 8, roadStyle = 3, oreStyle = 4;
    // The kind of thing being drawn into the line passes, shared with the pass's material, and whether it sways.
    const catU = { value: 1 }, catRef = { mat: null, norm: null }, swayU = { value: 0 };
    const maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // The full-screen passes: bloom in two sizes, then the grade.
    const pp = (() => {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
      const qs = new THREE.Scene(); qs.add(quad); quad.frustumCulled = false;
      const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
      const bright = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: vs, depthTest: false, depthWrite: false, fragmentShader: `
        varying vec2 vUv; uniform sampler2D t;
        void main(){ vec3 c = min(texture2D(t, vUv).rgb, vec3(24.0)); float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(1.0, 2.2, l), 1.0); }` });
      const blur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: vs, depthTest: false, depthWrite: false, fragmentShader: `
        varying vec2 vUv; uniform sampler2D t; uniform vec2 d;
        void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227;
          c += (texture2D(t, vUv + d * 1.385).rgb + texture2D(t, vUv - d * 1.385).rgb) * 0.316;
          c += (texture2D(t, vUv + d * 3.231).rgb + texture2D(t, vUv - d * 3.231).rgb) * 0.07;
          gl_FragColor = vec4(c, 1.0); }` });
      const grade = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, b1: { value: null }, b2: { value: null }, uTime: { value: 0 }, uFlash: { value: 0 }, uBloom: { value: 0.6 }, uGlow: { value: new THREE.Vector2(-0.2, 0.9) }, uGlowC: { value: new THREE.Color(0xff9550) }, uAspect: { value: 1.6 }, uVivid: { value: 0 } }, vertexShader: vs, depthTest: false, depthWrite: false, fragmentShader: `
        varying vec2 vUv; uniform sampler2D t, b1, b2; uniform float uTime, uFlash, uBloom, uAspect, uVivid; uniform vec2 uGlow; uniform vec3 uGlowC;
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main(){
          // Daylight (uVivid) keeps only a touch of bloom and of the sun's spill, and none of the haze's lift.
          vec3 c = texture2D(t, vUv).rgb + (texture2D(b1, vUv).rgb * 0.55 + texture2D(b2, vUv).rgb * 0.45) * uBloom * mix(1.0, 0.3, uVivid);
          c += vec3(uFlash * 6.0, uFlash * 5.6, uFlash * 5.0);
          // Light from the low sun spills in from its side of the frame.
          vec2 gq = (vUv - uGlow) * vec2(uAspect, 1.0);
          c += uGlowC * (exp(-length(gq) * 1.8) * 0.2 + exp(-length(gq) * 4.5) * 0.18) * (1.0 - uVivid);
          vec2 q = vUv - 0.5; float vig = 1.0 - dot(q, q) * mix(0.7, 0.45, uVivid);
          c = aces(c * mix(0.86, 0.8, uVivid) * vig);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= mix(vec3(0.9, 0.9, 1.06), vec3(1.04, 1.0, 0.92), smoothstep(0.05, 0.6, l) * (1.0 - uVivid * 0.6));
          // Colour held full through the lights, and a firm contrast in the middle values.
          c = mix(vec3(l), c, mix(1.06, 1.18, uVivid));
          c = mix(c, c * c * (3.0 - 2.0 * c), 0.22 * uVivid);
          c += vec3(0.012, 0.008, 0.014) * (1.0 - l) * (1.0 - uVivid);
          c = pow(max(c, 0.0), vec3(1.0 / 2.2));
          float n = fract(sin(dot(vUv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor = vec4(c + (n - 0.5) * 0.018, 1.0); }` });
      // The units and buildings for the outlines: white where they stand, their side's colour on their markings.
      // A building's own stuff, thatch, tile, stone or brick, goes in at half strength, below any marking's, as do
      // the colours of life on the land.
      const markMat = catRef.mat = new THREE.ShaderMaterial({ vertexColors: true, uniforms: { uCat: catU, uSwayOn: swayU, uTime: SH.uTime, uWind: SH.uWind }, vertexShader: `
        attribute float aTeam; varying vec3 vC; varying vec3 vM; varying float vT; uniform float uSwayOn, uTime; uniform vec2 uWind;
        ${SWAY}
        void main() {
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          p.xz += sway(p.xz, position.y) * uSwayOn;
          #ifdef USE_INSTANCING_COLOR
            vC = instanceColor;
          #else
            vC = vec3(0.0);
          #endif
          #ifdef USE_COLOR
            vM = color;
          #else
            vM = vec3(0.0);
          #endif
          vT = aTeam;
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }`, fragmentShader: `uniform float uCat; varying vec3 vC; varying vec3 vM; varying float vT; void main() { vec3 c = uCat > 0.6 ? vC * (vT > 0.9 ? 1.0 : uCat > 0.9 ? 0.45 : 0.0) : uCat > 0.52 && uCat < 0.58 ? vec3(0.5, 0.4, 0.1) : vec3(0.0);
          // Life, beasts, cars and people, gives its own colours at half strength, for the ink to wash it by.
          if (uCat > 0.58 && uCat < 0.62) c = vC * vM * 0.5;
          if (uCat > 0.7 && uCat < 0.8 && vT <= 0.9) c = vM * 0.5;
          gl_FragColor = vec4(c, uCat); }` });
      // Surface direction and distance of everything drawn in line, for the lines inside a shape.
      const normMat = catRef.norm = new THREE.ShaderMaterial({ uniforms: { uSwayOn: swayU, uTime: SH.uTime, uWind: SH.uWind }, vertexShader: `
        varying vec3 vN; varying float vD; uniform float uSwayOn, uTime; uniform vec2 uWind;
        ${SWAY}
        void main() {
          vec4 p = vec4(position, 1.0); vec3 n = normal;
          #ifdef USE_INSTANCING
            p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
          #endif
          p.xz += sway(p.xz, position.y) * uSwayOn;
          vec4 mv = modelViewMatrix * p;
          vN = normalize(normalMatrix * n); vD = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`, fragmentShader: `varying vec3 vN; varying float vD; void main() { gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, vD); }` });
      // Each thing drawn in line, as offsets from its own middle on the screen, so a pass can hatch every unit,
      // building and tree from its own origin and the hatching travels with it.
      const anchorRes = { value: new THREE.Vector2(1, 1) };
      const anchorMat = new THREE.ShaderMaterial({ uniforms: { uSwayOn: swayU, uTime: SH.uTime, uWind: SH.uWind, uRes: anchorRes }, vertexShader: `
        varying vec2 vO; varying vec3 vC; uniform float uSwayOn, uTime; uniform vec2 uWind, uRes;
        ${SWAY}
        void main() {
          vec4 p = vec4(position, 1.0), o = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING_COLOR
            vC = instanceColor;
          #else
            vC = vec3(0.0);
          #endif
          #ifdef USE_INSTANCING
            p = instanceMatrix * p; o = instanceMatrix * o;
          #endif
          p.xz += sway(p.xz, position.y) * uSwayOn;
          vec4 oc = projectionMatrix * modelViewMatrix * o;
          vO = (oc.xy / oc.w * 0.5 + 0.5) * uRes;
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }`, fragmentShader: `varying vec2 vO; varying vec3 vC;
        // Blue is the offset from the thing's middle; z is its colour's hue and w how coloured it is.
        void main() {
          float mx = max(vC.r, max(vC.g, vC.b)), mn = min(vC.r, min(vC.g, vC.b)), d = mx - mn, h = 0.0;
          if (d > 1e-4) h = mx == vC.r ? mod((vC.g - vC.b) / d, 6.0) : mx == vC.g ? (vC.b - vC.r) / d + 2.0 : (vC.r - vC.g) / d + 4.0;
          gl_FragColor = vec4(gl_FragCoord.xy - vO, h / 6.0, mx > 0.0 ? d / mx : 0.0);
        }` });
      // The land alone, for passes that need it: visible, seen, height, and scars.
      const fogPassMat = new THREE.ShaderMaterial({ uniforms: { tFog: SH.tFog, tMarks: SH.tMarks, uFogOn: SH.uFogOn, uMap: SH.uMap }, vertexShader: `
        varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`, fragmentShader: `
        uniform sampler2D tFog, tMarks; uniform float uFogOn, uMap; varying vec3 vW;
        void main() {
          vec2 f = mix(vec2(1.0), texture2D(tFog, vW.xz / uMap).rg, uFogOn);
          vec4 m = texture2D(tMarks, vW.xz / uMap);
          gl_FragColor = vec4(f.r, f.g, vW.y + 20.0, min(m.r, 0.99));
        }` });
      // The land alone again, for the distance to the nearest road.
      // Green is the shadow of a passing cloud and blue the banks fog drifts in, both carried on the wind. Alpha is
      // how hard the track worn there has become.
      const landMat = new THREE.ShaderMaterial({ uniforms: { tDetail: SH.tDetail, uCloud: SH.uCloud, uCloudT: SH.uCloudT, tTrail: SH.tTrail, uMap: SH.uMap }, vertexShader: `
        attribute float aRoad; varying float vR; varying vec3 vW;
        void main() { vR = aRoad; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`, fragmentShader: `
        uniform sampler2D tDetail, tTrail; uniform vec2 uCloud; uniform float uMap, uCloudT; varying float vR; varying vec3 vW;
        ${Looks.GL.CLOUD}
        void main() {
          float cl = cloudAt(vW.xz);
          float fb = texture2D(tDetail, vW.xz * 0.013 + uCloud * 0.7 + 0.37).g;
          gl_FragColor = vec4(min(vR, 20.0), cl, fb, texture2D(tTrail, vW.xz / uMap).r);
        }` });
      let ldr = null, maskRT = null, normRT = null, fogRT = null, landRT = null, fxRT = null, anchorRT = null;
      let rt, a0, a1, b0, b1, w = 1, h = 1;
      // Screen-sized targets a look keeps for itself, by name.
      const targets = new Map();
      function size(wp, hp) {
        w = wp; h = hp;
        for (const r of [rt, a0, a1, b0, b1, ldr, maskRT, normRT, fogRT, landRT, fxRT, anchorRT, ...targets.values()]) if (r) r.dispose();
        anchorRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        fxRT = new THREE.WebGLRenderTarget(w >> 1, h >> 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        targets.clear();
        fogRT = new THREE.WebGLRenderTarget(w >> 1, h >> 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        landRT = new THREE.WebGLRenderTarget(w >> 1, h >> 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        normRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        ldr = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
        maskRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
        // A look that paints over the picture draws its own lines from the masks, so its scene is not multisampled.
        rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: low || style.create ? 0 : 4, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
        a0 = new THREE.WebGLRenderTarget(qw, qh, opts); a1 = new THREE.WebGLRenderTarget(qw, qh, opts);
        b0 = new THREE.WebGLRenderTarget(qw >> 1, qh >> 1, opts); b1 = new THREE.WebGLRenderTarget(qw >> 1, qh >> 1, opts);
      }
      // Marks laid on the land need the way back from a pixel to the land, how a step on the land shows on screen,
      // and the zoom as a level, at 80 px at 1080p to a land unit for level 0.
      function landUniforms(C) {
        C.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
        const ty = cam.ty || 1, o = new THREE.Vector3(cam.x, ty, cam.y).project(camera);
        const ex = new THREE.Vector3(cam.x + 1, ty, cam.y).project(camera), ez = new THREE.Vector3(cam.x, ty, cam.y + 1).project(camera);
        const ax = (ex.x - o.x) / 2 * w, ay = (ex.y - o.y) / 2 * h, bx = (ez.x - o.x) / 2 * w, by = (ez.y - o.y) / 2 * h;
        C.uW2S.value.set(ax, ay, bx, by);
        C.uLev.value = Math.log2(80 * (h / 1080) / Math.sqrt(Math.abs(ax * by - ay * bx)));
      }
      const run = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(qs, qc); };
      const pass = (src, dst, dx, dy) => { blur.uniforms.t.value = src; blur.uniforms.d.value.set(dx, dy); run(blur, dst); };
      // The scene drawn again into a buffer of its own, with an override material or a camera layer.
      function drawInto(target, clear, alpha, layer, material) {
        const was = camera.layers.mask;
        if (layer !== undefined) camera.layers.set(layer);
        scene.overrideMaterial = material;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(target); renderer.setClearColor(clear, alpha); renderer.clear(); renderer.render(scene, camera);
        renderer.shadowMap.autoUpdate = true;
        scene.overrideMaterial = null; camera.layers.mask = was;
        renderer.setClearColor(theme ? theme.shroud : 0, 1);
        return target.texture;
      }
      // The land alone, drawn with a material of a pass's own.
      function landInto(material, target) {
        if (!terrainMesh) return target.texture;
        const keep = terrainMesh.material;
        terrainMesh.material = material;
        renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear();
        renderer.render(terrainMesh, camera);
        terrainMesh.material = keep;
        renderer.setClearColor(theme ? theme.shroud : 0, 1);
        return target.texture;
      }
      let paperTex = null;
      // The kit a look draws with. Buffers are drawn when asked for:
      //   mask()   units, buildings and scenery in their line categories (alpha), with the sides' markings, and a
      //            building's own colours at half strength
      //   norm()   surface direction and view distance of everything drawn in line
      //   fog()    the land alone: visible, seen, height + 20, scars and tread marks
      //   land()   the land alone: road distance, cloud shadow, fog banks, track hardness
      //   fx()     the fire and smoke alone, bright where hot and covered where smoky
      //   anchor() each thing drawn in line as offsets in pixels from its own middle on the screen, with the hue
      //            and saturation of its colour, which for a unit is its side's
      // and ldr is the graded picture, a0 and a1 quarter-size buffers free once the grade has run.
      const K = {
        THREE, SH, vs, renderer, run, blur: pass,
        get w() { return w; }, get h() { return h; }, get ldr() { return ldr; }, get a0() { return a0; }, get a1() { return a1; },
        get time() { return SH.uTime.value; }, get camera() { return camera; }, get cam() { return cam; }, get sky() { return sky; },
        get theme() { return theme; }, get viewTeam() { return viewTeam; }, get center() { return [CX, CY]; }, get waterLevel() { return (M ? M.water : -0.15) + waterRise.value; },
        get opts() { return { ink: inkStyle, road: roadStyle, ore: oreStyle }; },
        // Each side's colour, as numbers.
        get sides() { return teamCol.map(c => c.getHex()); },
        // Whether roads carry modern markings, from the Industrial Age.
        get marked() { return worldAge() >= MOTOR_AGE; },
        // The age the world is seen in, for looks that draw things by it.
        get age() { return worldAge(); },
        // Where the low sun's light comes in from, across the screen.
        get glow() { return grade.uniforms.uGlow.value; },
        mask: () => drawInto(maskRT, 0x000000, 0, 1, markMat),
        norm: () => drawInto(normRT, 0x808080, 0, 1, normMat),
        fog: () => landInto(fogPassMat, fogRT),
        land: () => landInto(landMat, landRT),
        fx: () => drawInto(fxRT, 0x000000, 0, 2, null),
        anchor: () => { anchorRes.value.set(w, h); return drawInto(anchorRT, 0x000000, 0, 1, anchorMat); },
        landUniforms,
        paper: () => paperTex || (paperTex = Looks.paper(THREE)),
        target(name) {
          if (!targets.has(name)) targets.set(name, new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }));
          return targets.get(name);
        },
      };
      const painters = new Map();
      function render() {
        // A look that paints the fog of war itself has the scene drawn without it.
        const own = style.sceneFog === false && viewTeam >= 0;
        if (own) SH.uFogOn.value = 0;
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
        if (own) SH.uFogOn.value = 1;
        bright.uniforms.t.value = rt.texture;
        run(bright, a0);
        pass(a0.texture, a1, 1 / a0.width, 0); pass(a1.texture, a0, 0, 1 / a0.height);
        pass(a0.texture, b0, 1 / b0.width * 1.2, 0); pass(b0.texture, b1, 0, 1 / b0.height * 1.2);
        pass(b1.texture, b0, 1 / b0.width * 2, 0); pass(b0.texture, b1, 0, 1 / b0.height * 2);
        const u = grade.uniforms;
        u.t.value = rt.texture; u.b1.value = a0.texture; u.b2.value = b1.texture; u.uTime.value = SH.uTime.value;
        if (!style.create) { run(grade, null); return; }
        run(grade, ldr);
        if (!painters.has(style.name)) painters.set(style.name, style.create(K));
        painters.get(style.name).render(K);
      }
      // The buffers made again at their size, as when a look that wants multisampling takes over from one that does not.
      const remake = () => { if (rt) size(w, h); };
      return { size, render, grade, remake };
    })();

    // Particle tiles, drawn once: smoke, fire, a glow, a spark, a ring, a shard.
    function makeAtlas() {
      const T = 128, n = 4, c = document.createElement('canvas');
      c.width = c.height = T * n;
      const g = c.getContext('2d'), img = g.createImageData(T * n, T * n), d = img.data, fbm = noiser(mulberry(9));
      const put = (tx, ty, fn) => {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const u = (x + 0.5) / T * 2 - 1, v = (y + 0.5) / T * 2 - 1, [r, gg, b, a] = fn(u, v, Math.hypot(u, v));
          const i = ((ty * T + y) * T * n + tx * T + x) * 4;
          d[i] = r * 255; d[i + 1] = gg * 255; d[i + 2] = b * 255; d[i + 3] = a * 255;
        }
      };
      for (let k = 0; k < 4; k++) {
        const ox = k * 17.3, oy = k * 9.1;
        put(k, 0, (u, v, r) => {
          const w = fbm(u * 1.6 + ox, v * 1.6 + oy, 4), a = smooth(1, 0.35, r + (w - 0.5) * 1.25);
          // Lit from the upper left, so a puff reads as a round body and not a flat disc.
          const lit = 0.56 + 0.4 * clamp((-u * 0.6 - v * 0.8) * 0.9 + 0.25 * (w - 0.5) * 4, -1, 1);
          return [lit, lit, lit, a * a * 0.92];
        });
        put(k, 1, (u, v, r) => {
          const w = fbm(u * 2.4 + ox + 40, v * 2.4 + oy, 4), core = smooth(0.95, 0.1, r + (w - 0.5) * 1.5), hot = core * core;
          return [1, 0.5 + 0.5 * hot, 0.12 + 0.75 * hot * hot, core];
        });
      }
      put(0, 2, (u, v, r) => { const a = smooth(1, 0, r); return [1, 1, 1, a * a]; });
      put(1, 2, (u, v, r) => { const a = smooth(0.34, 0, Math.abs(u) * 2.6 + Math.abs(v) * 0.5 + r * 0.35); return [1, 1, 1, a]; });
      put(2, 2, (u, v, r) => { const a = smooth(0.1, 0, Math.abs(r - 0.82)); return [1, 1, 1, a]; });
      put(3, 2, (u, v) => { const a = (Math.abs(u) + Math.abs(v) * 1.5 < 0.5 + fbm(u * 3, v * 3, 2) * 0.5) ? 1 : 0; return [0.25, 0.23, 0.2, a]; });
      put(0, 3, (u, v, r) => { const a = Math.max(smooth(0.12, 0, Math.abs(v)) * smooth(1, 0, Math.abs(u)), smooth(0.12, 0, Math.abs(u)) * smooth(1, 0, Math.abs(v)), smooth(0.5, 0, r)); return [1, 1, 1, a]; });
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      return t;
    }
    const atlas = makeAtlas();

    const STRIDE = 28;
    function particles(cap, blending) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const arr = new Float32Array(cap * STRIDE), buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE);
      buf.setUsage(THREE.DynamicDrawUsage);
      const at = (name, size, off) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, size, off));
      at('aPos', 3, 0); at('aVel', 3, 3); at('aTime', 4, 6); at('aC0', 4, 10); at('aC1', 4, 14); at('aMisc', 4, 18); at('aTile', 1, 22); at('aC2', 4, 23); at('aMid', 1, 27);
      g.instanceCount = cap;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending,
        uniforms: { tAtlas: { value: atlas }, uTime: SH.uTime, tFog: SH.tFog, uFogOn: SH.uFogOn, uMap: SH.uMap },
        vertexShader: `
          attribute vec3 aPos, aVel; attribute vec4 aTime, aC0, aC1, aC2, aMisc; attribute float aTile, aMid;
          uniform float uTime; varying vec2 vU; varying vec4 vC; varying vec3 vW;
          void main(){
            float t = uTime - aTime.x, k = t / aTime.y;
            if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            float drag = aMisc.z, m = drag > 0.0 ? (1.0 - exp(-drag * t)) / drag : t;
            vec3 p = aPos + aVel * m; p.y += aMisc.w * t * t * 0.5;
            vW = p;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            float ek = 1.0 - (1.0 - k) * (1.0 - k), sz = mix(aTime.z, aTime.w, ek);
            float r = aMisc.x + aMisc.y * t, c = cos(r), s = sin(r);
            mv.xy += mat2(c, s, -s, c) * position.xy * sz;
            gl_Position = projectionMatrix * mv;
            float tx = mod(aTile, 4.0), ty = floor(aTile / 4.0);
            vU = vec2(tx + position.x + 0.5, ty + 0.5 - position.y) / 4.0; vU.y = 1.0 - vU.y;
            vC = k < aMid ? mix(aC0, aC1, k / aMid) : mix(aC1, aC2, (k - aMid) / max(1.0 - aMid, 0.001));
          }`,
        fragmentShader: `
          uniform sampler2D tAtlas, tFog; uniform float uFogOn, uMap; varying vec2 vU; varying vec4 vC; varying vec3 vW;
          void main(){
            vec4 t = texture2D(tAtlas, vU);
            float f = mix(1.0, texture2D(tFog, vW.xz / uMap).r, uFogOn);
            gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a * f);
            if (gl_FragColor.a < 0.003) discard;
          }`,
      });
      const mesh = new THREE.Mesh(g, mat);
      // Drawn again alone, into the effects buffer the looks read fire and smoke from.
      mesh.layers.enable(2);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      scene.add(mesh);
      let head = 0, lo = 1e9, hi = -1;
      return {
        mesh,
        add(px, py, pz, vx, vy, vz, life, s0, s1, c0, c1, tile, o = {}) {
          const i = head * STRIDE;
          arr[i] = px; arr[i + 1] = py; arr[i + 2] = pz; arr[i + 3] = vx; arr[i + 4] = vy; arr[i + 5] = vz;
          arr[i + 6] = SH.uTime.value + (o.delay || 0); arr[i + 7] = life; arr[i + 8] = s0; arr[i + 9] = s1;
          arr[i + 10] = c0[0]; arr[i + 11] = c0[1]; arr[i + 12] = c0[2]; arr[i + 13] = c0[3];
          arr[i + 14] = c1[0]; arr[i + 15] = c1[1]; arr[i + 16] = c1[2]; arr[i + 17] = c1[3];
          arr[i + 18] = o.rot ?? (tile < 4 ? (Math.random() - 0.5) * 0.8 : Math.random() * 6.28); arr[i + 19] = o.spin ?? 0; arr[i + 20] = o.drag ?? 0; arr[i + 21] = o.grav ?? 0; arr[i + 22] = tile;
          // A third colour, from the mid point on, for fire that cools into smoke.
          const c2 = o.c2 || c1;
          arr[i + 23] = c2[0]; arr[i + 24] = c2[1]; arr[i + 25] = c2[2]; arr[i + 26] = c2[3]; arr[i + 27] = o.c2 ? (o.mid ?? 0.3) : 1;
          lo = Math.min(lo, i); hi = Math.max(hi, i + STRIDE);
          head = (head + 1) % cap;
          if (head === 0) { buf.updateRange = { offset: 0, count: -1 }; buf.needsUpdate = true; lo = 1e9; hi = -1; }
        },
        // Gives the newest particle a colour that swells in its middle years, for motes.
        tint(c) {
          const i = ((head + cap - 1) % cap) * STRIDE;
          arr[i + 10] = c[0]; arr[i + 11] = c[1]; arr[i + 12] = c[2]; arr[i + 13] = c[3];
          arr[i + 14] = c[0] * 0.3; arr[i + 15] = c[1] * 0.3; arr[i + 16] = c[2] * 0.3; arr[i + 17] = 0;
          arr[i + 23] = arr[i + 14]; arr[i + 24] = arr[i + 15]; arr[i + 25] = arr[i + 16]; arr[i + 26] = 0; arr[i + 27] = 1;
          lo = Math.min(lo, i); hi = Math.max(hi, i + STRIDE);
        },
        flush() { if (hi > lo) { buf.updateRange = { offset: lo, count: hi - lo }; buf.needsUpdate = true; lo = 1e9; hi = -1; } },
      };
    }
    const smoke = particles(low ? 1800 : 5200, THREE.NormalBlending);
    const glow = particles(low ? 1400 : 4000, THREE.AdditiveBlending);

    // Tracers are quads stretched along their flight.
    const streak = (() => {
      const cap = low ? 500 : 1500, S = 12;
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const arr = new Float32Array(cap * S), buf = new THREE.InstancedInterleavedBuffer(arr, S);
      buf.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aA', new THREE.InterleavedBufferAttribute(buf, 3, 0));
      g.setAttribute('aB', new THREE.InterleavedBufferAttribute(buf, 3, 3));
      g.setAttribute('aT', new THREE.InterleavedBufferAttribute(buf, 3, 6));
      g.setAttribute('aC', new THREE.InterleavedBufferAttribute(buf, 3, 9));
      g.instanceCount = cap;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: SH.uTime, tFog: SH.tFog, uFogOn: SH.uFogOn, uMap: SH.uMap },
        vertexShader: `
          attribute vec3 aA, aB, aT, aC; uniform float uTime; varying vec3 vC; varying vec2 vU; varying float vF; varying vec3 vW;
          void main(){
            float k = (uTime - aT.x) / aT.y;
            if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            float len = 0.26;
            vec3 h = mix(aA, aB, min(1.0, k + len)), tl = mix(aA, aB, max(0.0, k - len * 0.5));
            vec4 a = viewMatrix * vec4(tl, 1.0), b = viewMatrix * vec4(h, 1.0);
            vec2 d = normalize((b.xy / -b.z) - (a.xy / -a.z)); vec2 n = vec2(-d.y, d.x);
            vec4 p = mix(a, b, position.x); p.xy += n * position.y * aT.z;
            gl_Position = projectionMatrix * p;
            vW = mix(tl, h, position.x);
            vC = aC; vU = vec2(position.x, position.y * 2.0);
          }`,
        fragmentShader: `
          uniform sampler2D tFog; uniform float uFogOn, uMap; varying vec3 vC; varying vec2 vU; varying vec3 vW;
          void main(){ float a = (1.0 - vU.y * vU.y) * vU.x; gl_FragColor = vec4(vC * a * mix(1.0, texture2D(tFog, vW.xz / uMap).r, uFogOn), a); }`,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 11;
      scene.add(mesh);
      let head = 0;
      return {
        add(ax, ay, az, bx, by, bz, life, width, c) {
          const i = head * S;
          arr[i] = ax; arr[i + 1] = ay; arr[i + 2] = az; arr[i + 3] = bx; arr[i + 4] = by; arr[i + 5] = bz;
          arr[i + 6] = SH.uTime.value; arr[i + 7] = life; arr[i + 8] = width; arr[i + 9] = c[0]; arr[i + 10] = c[1]; arr[i + 11] = c[2];
          head = (head + 1) % cap;
          buf.needsUpdate = true;
        },
      };
    })();

    // Shock rings lie on the ground.
    const rings = (() => {
      const pool = [], geo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
      for (let i = 0; i < (low ? 4 : 10); i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0, depthWrite: false }));
        m.visible = false; m.renderOrder = 9; scene.add(m);
        pool.push({ m, t: 0, life: 0, r: 0 });
      }
      let i = 0;
      return {
        add(x, y, z, r, life = 0.5, color = 0xffe0b0) { const p = pool[i++ % pool.length]; p.t = 0; p.life = life; p.r = r; p.m.position.set(x, y + 0.1, z); p.m.material.color.set(color); p.m.visible = true; },
        step(dt) { for (const p of pool) if (p.m.visible) { p.t += dt; const k = p.t / p.life; if (k >= 1) { p.m.visible = false; continue; } const s = p.r * (1 - (1 - k) ** 3); p.m.scale.set(s, 1, s); p.m.material.opacity = (1 - k) * (1 - k) * 0.42; } },
      };
    })();

    // A few real lights for the biggest flashes.
    const flashes = [];
    for (let i = 0; i < (low ? 0 : 3); i++) {
      const l = new THREE.PointLight(0xffb060, 0, 22, 1.8);
      l.position.set(0, -50, 0); scene.add(l);
      flashes.push({ l, t: 1, p: 0 });
    }
    let flashI = 0;
    const flash = (x, y, z, power) => {
      if (!flashes.length) return;
      const f = flashes[flashI++ % flashes.length];
      f.l.position.set(x, y + 1.2, z); f.p = power; f.t = 0;
    };

    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(low ? 2048 : 4096, low ? 2048 : 4096);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.2);
    scene.add(hemi);

    let S = null, M = null, theme = null, viewTeam = 0, sets = {}, terrainMesh = null, waterMesh = null, statics = [], baseImage = null;
    const rs = new Map();
    let wrecks = [], corpses = [], bleeds = [], flyers = [], planes = [], falls = [], marks = null, marksTex = null, marksDirty = false, marksLast = 0, treadFade = 0;
    let fogTex = null, fogData = null, fogR = null, fogG = null, terrTex = null, terrData = null, terrSeen = -1, hTex = null, flowTex = null, brookTex = null, beachTex = null, beachMap = null, riverLines = [], names = null;
    // A number as a half float, for heights within a few units of the ground.
    const halfBuf = new Float32Array(1), halfBits = new Uint32Array(halfBuf.buffer);
    function toHalf(v) {
      halfBuf[0] = v;
      const x = halfBits[0], sign = (x >>> 16) & 0x8000, exp = ((x >>> 23) & 0xff) - 112;
      return exp <= 0 ? sign : exp >= 31 ? sign | 0x7c00 : sign | (exp << 10) | ((x & 0x7fffff) >>> 13);
    }
    let ore = null, oreSeen = -1, flagMeshes = [], ghost = null, ghostCells = null;
    // How far the rivers stand above their usual line.
    const waterRise = { value: 0 };
    const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), m3 = new THREE.Matrix4(), mOut = new THREE.Matrix4();
    const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e1 = new THREE.Euler(0, 0, 0, 'YXZ'), p1 = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), s2 = new THREE.Vector3(1, 1, 1);
    const axisZ = new THREE.Vector3(0, 0, 1), axisY = new THREE.Vector3(0, 1, 0), axisX = new THREE.Vector3(1, 0, 0);
    const colA = new THREE.Color(), teamCol = SLOT_COLORS.map(c => new THREE.Color(c)), burnt = new THREE.Color(0x141414), neutral = new THREE.Color(0xc9c5b6);

    function clearWorld() {
      for (const o of statics) { scene.remove(o); if (o.geometry && o.isInstancedMesh) o.dispose?.(); }
      statics = [];
      for (const k in sets) for (const p of sets[k]) { scene.remove(p.mesh); p.mesh.dispose(); }
      sets = {};
      rs.clear(); wrecks = []; corpses = []; bleeds = []; flyers = []; planes = []; falls = []; inkFx.length = 0; pastBoxes.length = 0; stuckArrows.length = 0; strokes.length = 0; scen = null; life = null;
    }
    const add = o => { scene.add(o); statics.push(o); return o; };
    function lineCat(mesh, cat, sway = false) {
      mesh.layers.enable(1);
      const sw = sway ? 1 : 0;
      mesh.onBeforeRender = () => {
        if (catU.value !== cat || swayU.value !== sw) {
          catU.value = cat; swayU.value = sw;
          if (catRef.mat) catRef.mat.uniformsNeedUpdate = true;
          if (catRef.norm) catRef.norm.uniformsNeedUpdate = true;
        }
      };
      return mesh;
    }

    function terrainTexture() {
      const size = low ? 1024 : 2048, data = new Uint8Array(size * size * 4), th = theme, t0 = performance.now();
      const rgb = hex => { const c = new THREE.Color(hex); c.convertLinearToSRGB(); return [c.r, c.g, c.b]; };
      const fbm = noiser(mulberry(M.seed + 5));
      const g0 = rgb(th.ground[0]), g1 = rgb(th.ground[1]), pat = rgb(th.patch), rock = rgb(th.rock), bank = rgb(th.bank), road = rgb(th.road), stain = rgb(th.stain);

      // Sun shadow and hollows, worked out coarsely and spread by bilinear lookup.
      const SS = 256, shade = new Float32Array(SS * SS), sd = new THREE.Vector3(...th.sun).normalize();
      for (let y = 0; y < SS; y++) for (let x = 0; x < SS; x++) {
        const wx = (x + 0.5) / SS * W, wy = (y + 0.5) / SS * H, h0 = terrainAt(M, wx, wy);
        let lit = 1;
        for (let k = 1; k < 26; k++) {
          const d = k * 0.9, px = wx + sd.x * d, py = wy + sd.z * d;
          if (px < 0 || py < 0 || px >= W || py >= H) break;
          const over = terrainAt(M, px, py) - (h0 + sd.y * d / Math.hypot(sd.x, sd.z));
          if (over > 0) { lit = Math.min(lit, 1 - clamp(over * 1.2, 0, 0.42)); }
        }
        let hol = 0;
        for (const [ax, ay] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]]) hol += Math.max(0, terrainAt(M, wx + ax, wy + ay) - h0);
        shade[y * SS + x] = lit * (1 - clamp(hol * 0.05, 0, 0.3));
      }
      const shadeAt = (u, v) => {
        const fx = clamp(u * SS - 0.5, 0, SS - 1.001), fy = clamp(v * SS - 0.5, 0, SS - 1.001), ix = fx | 0, iy = fy | 0, a = fx - ix, b = fy - iy;
        return lerp(lerp(shade[iy * SS + ix], shade[iy * SS + ix + 1], a), lerp(shade[(iy + 1) * SS + ix], shade[(iy + 1) * SS + ix + 1], a), b);
      };
      const oreNear = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M.ore[y * W + x]) {
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
          const c = clamp(y + b, 0, H - 1) * W + clamp(x + a, 0, W - 1);
          oreNear[c] = Math.max(oreNear[c], 1 - Math.hypot(a, b) / 3);
        }
      }
      const out = [0, 0, 0];
      const mix3 = (a, b, t) => { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); return out; };
      for (let j = 0; j < size; j++) {
        const v = (j + 0.5) / size, wy = v * H;
        for (let i = 0; i < size; i++) {
          const u = (i + 0.5) / size, wx = u * W;
          const h = terrainAt(M, wx, wy), hx = terrainAt(M, wx + 0.5, wy) - terrainAt(M, wx - 0.5, wy), hy = terrainAt(M, wx, wy + 0.5) - terrainAt(M, wx, wy - 0.5), slope = Math.hypot(hx, hy);
          const n1 = fbm(wx * 0.05, wy * 0.05, 4), n2 = fbm(wx * 0.17 + 9, wy * 0.17, 3), n3 = fbm(wx * 0.9, wy * 0.9, 2);
          let c = mix3(g0, g1, smooth(0.36, 0.64, n1));
          let r = c[0], g = c[1], b = c[2];
          if (th.ripple) { const rp = Math.sin(wx * 2.2 + wy * 1.1 + n2 * 9) * 0.5 + 0.5, k = 0.05 * smooth(0.3, 0.7, n1); r *= 1 - k + rp * k; g *= 1 - k + rp * k; b *= 1 - k * 1.2 + rp * k * 1.2; }
          const pt = smooth(0.54, 0.66, n2 + (n1 - 0.5) * 0.4);
          r = lerp(r, pat[0], pt * 0.72); g = lerp(g, pat[1], pt * 0.72); b = lerp(b, pat[2], pt * 0.72);
          const rk = smooth(0.34, 0.7, slope + (n3 - 0.5) * 0.3);
          r = lerp(r, rock[0], rk); g = lerp(g, rock[1], rk); b = lerp(b, rock[2], rk);
          const wet = smooth(1.05, 0.22, h + (n3 - 0.5) * 0.3);
          r = lerp(r, bank[0], wet); g = lerp(g, bank[1], wet); b = lerp(b, bank[2], wet);
          const ox = clamp(wx - 0.5, 0, W - 1.001), oy = clamp(wy - 0.5, 0, H - 1.001), oi = ox | 0, oj = oy | 0, oa = ox - oi, ob = oy - oj, oq = oj * W + oi;
          const st = lerp(lerp(oreNear[oq], oreNear[oq + 1], oa), lerp(oreNear[oq + W], oreNear[oq + W + 1], oa), ob);
          if (st > 0) { const s = st * 0.7; r = lerp(r, stain[0], s); g = lerp(g, stain[1], s); b = lerp(b, stain[2], s); }
          const fx = clamp(wx * RES, 0, VW - 1.001), fy = clamp(wy * RES, 0, VH - 1.001), ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, q = iy * VW + ix, RD = M.roadDist;
          const rd = lerp(lerp(RD[q], RD[q + 1], ax), lerp(RD[q + VW], RD[q + VW + 1], ax), ay);
          const rm = smooth(1.75, 0.95, rd + (n3 - 0.5) * 0.9) * 0.84;
          if (rm > 0) {
            const rut = 1 + 0.16 * Math.cos(rd * 6.4) * smooth(1.4, 0.5, rd);
            r = lerp(r, road[0] * rut, rm); g = lerp(g, road[1] * rut, rm); b = lerp(b, road[2] * rut, rm);
          }
          const sh = shadeAt(u, v), tone = 0.62 + 0.38 * sh;
          const k = (j * size + i) * 4;
          data[k] = clamp(r * tone, 0, 1) * 255; data[k + 1] = clamp(g * tone, 0, 1) * 255; data[k + 2] = clamp(b * tone * (0.94 + 0.06 * sh), 0, 1) * 255; data[k + 3] = 255;
        }
      }
      const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.anisotropy = 16; t.needsUpdate = true;
      console.log('@bake ' + size + ' in ' + Math.round(performance.now() - t0) + ' ms');
      world.debugBake = () => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), im = g.createImageData(size, size); im.data.set(data); g.putImageData(im, 0, 0); return c.toDataURL('image/png'); };
      // The minimap starts from this picture.
      const mc = document.createElement('canvas'); mc.width = mc.height = 256;
      const mg = mc.getContext('2d'), im = mg.createImageData(256, 256), st = size / 256;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const k = (Math.floor(y * st) * size + Math.floor(x * st)) * 4, o = (y * 256 + x) * 4;
        const wh = terrainAt(M, (x + 0.5) / 256 * W, (y + 0.5) / 256 * H);
        const wet = wh < M.water;
        im.data[o] = wet ? 26 : data[k] * 0.72; im.data[o + 1] = wet ? 58 : data[k + 1] * 0.72; im.data[o + 2] = wet ? 74 : data[k + 2] * 0.72; im.data[o + 3] = 255;
      }
      mg.putImageData(im, 0, 0);
      baseImage = mc;
      return t;
    }

    function buildTerrain() {
      const pos = new Float32Array(VW * VH * 3), nor = new Float32Array(VW * VH * 3), uv = new Float32Array(VW * VH * 2), h = M.h;
      for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
        const c = j * VW + i, l = h[j * VW + Math.max(0, i - 1)], r = h[j * VW + Math.min(VW - 1, i + 1)], u = h[Math.max(0, j - 1) * VW + i], d = h[Math.min(VH - 1, j + 1) * VW + i];
        pos[c * 3] = i / RES; pos[c * 3 + 1] = h[c]; pos[c * 3 + 2] = j / RES;
        const nx = (l - r) * RES / 2, nz = (u - d) * RES / 2, len = Math.hypot(nx, 1, nz);
        nor[c * 3] = nx / len; nor[c * 3 + 1] = 1 / len; nor[c * 3 + 2] = nz / len;
        uv[c * 2] = i / (VW - 1); uv[c * 2 + 1] = j / (VH - 1);
      }
      const idx = new Uint32Array((VW - 1) * (VH - 1) * 6);
      let n = 0;
      for (let j = 0; j < VH - 1; j++) for (let i = 0; i < VW - 1; i++) {
        const a = j * VW + i, b = a + 1, c = a + VW, d = c + 1;
        idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('aRoad', new THREE.BufferAttribute(Float32Array.from(M.roadDist), 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const tex = terrainTexture();
      tex.flipY = false;
      const mat = patch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, envMapIntensity: 0.55 }), { plain: true, terrain: true });
      terrainMesh = add(new THREE.Mesh(g, mat));
      terrainMesh.receiveShadow = true; terrainMesh.castShadow = false; terrainMesh.frustumCulled = false;
    }

    function buildWater() {
      const th = theme, R2 = 2, n = W * R2 + 1, verts = [], depth = [], index = [], map = new Int32Array(n * n).fill(-1), wl = M.water;
      const dep = (i, j) => wl - terrainAt(M, i / R2, j / R2);
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        if (Math.max(dep(i, j), dep(i + 1, j), dep(i, j + 1), dep(i + 1, j + 1)) < -0.7) continue;
        const ids = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, b]) => {
          const c = b * n + a;
          if (map[c] < 0) { map[c] = verts.length / 3; verts.push(a / R2, wl, b / R2); depth.push(dep(a, b)); }
          return map[c];
        });
        index.push(ids[0], ids[2], ids[1], ids[1], ids[2], ids[3]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
      g.setIndex(index);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
          tFog: SH.tFog, tDetail: SH.tDetail, uTime: SH.uTime, uFogOn: SH.uFogOn, uMap: SH.uMap, uSun: { value: new THREE.Vector3(...th.sun).normalize() }, uRise: waterRise,
          uSunC: { value: new THREE.Color(th.sunColor) }, uShallow: { value: new THREE.Color(th.water[0]) }, uDeep: { value: new THREE.Color(th.water[1]) }, uSky: { value: new THREE.Color(th.env[1]) }, uZen: { value: new THREE.Color(th.env[0]) }, uShroud: SH.uShroud,
        },
        // The water stands higher when the rivers are up, over banks it left bare before.
        vertexShader: `attribute float aDepth; uniform float uRise; varying float vD; varying vec3 vW;
          void main(){ vD = aDepth + uRise; vW = position + vec3(0.0, uRise, 0.0); gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
        fragmentShader: `
          uniform sampler2D tFog, tDetail; uniform float uTime, uFogOn, uMap; uniform vec3 uSun, uSunC, uShallow, uDeep, uSky, uZen, uShroud; varying float vD; varying vec3 vW;
          void main(){
            if (vD < -0.02) discard;
            vec2 a = texture2D(tDetail, vW.xz * 0.11 + uTime * vec2(0.012, 0.007)).ba - 0.5;
            vec2 b = texture2D(tDetail, vW.xz * 0.31 - uTime * vec2(0.016, 0.02)).ba - 0.5;
            vec3 n = normalize(vec3((a.x + b.x) * 0.6, 1.0, (a.y + b.y) * 0.6));
            vec3 v = normalize(cameraPosition - vW);
            float fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
            vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 0.8, vD));
            vec3 r = reflect(-v, n);
            vec3 sky = mix(uSky, uZen, smoothstep(0.0, 0.8, r.y));
            col = mix(col, sky * 1.1, 0.18 + 0.7 * fres);
            col += uSunC * (pow(max(dot(r, uSun), 0.0), 90.0) * 5.0 + pow(max(dot(r, uSun), 0.0), 6.0) * 0.5);
            float foam = (1.0 - smoothstep(0.0, 0.1, vD + (texture2D(tDetail, vW.xz * 0.9 + uTime * 0.03).r - 0.5) * 0.14));
            col = mix(col, vec3(0.9), foam * 0.55);
            vec2 fg = mix(vec2(1.0), texture2D(tFog, vW.xz / uMap).rg, uFogOn);
            col = mix(uShroud, mix(col * vec3(0.46, 0.4, 0.38), col, fg.r), fg.g);
            gl_FragColor = vec4(col, smoothstep(0.0, 0.14, vD) * 0.62 + 0.36);
          }`,
      });
      waterMesh = add(new THREE.Mesh(g, mat));
      waterMesh.renderOrder = 2; waterMesh.frustumCulled = false;
      lineCat(waterMesh, 0.25);
    }

    function instanced(geo, mat, list, shadow = true) {
      const im = lineCat(new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)), 0.5);
      im.count = list.length; im.frustumCulled = false;
      im.castShadow = shadow; im.receiveShadow = true;
      list.forEach((o, i) => setInst(im, i, o));
      return add(im);
    }
    // One instance from a plain description: place, turn, size and colour. Hidden draws it at no size.
    function setInst(im, i, o, hide = false) {
      q1.setFromEuler(e1.set(o.rx || 0, o.a || 0, o.rz || 0));
      const k = hide ? 0 : 1;
      m1.compose(p1.set(o.x, o.y, o.z), q1, s1.set((o.sx ?? o.s ?? 1) * k, (o.sy ?? o.s ?? 1) * k, (o.sz ?? o.s ?? 1) * k));
      im.setMatrixAt(i, m1);
      im.setColorAt(i, colA.set(o.c ?? 0xffffff));
    }
    const dirty = im => { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; };
    // Scenery that changes: trees by their cells, houses brought to ruin, bridges down and up, the fords'
    // stepping stones and garden fences.
    let scen = null;

    // The way each river runs, for the ink look's water lines to drift down it. Water in a channel no wider than a
    // river that meets the map's edge in two places or more flows from the end met first going round the edge, down
    // its course. Lakes, ponds the edge cuts off, and the sea lie still. A cell holds how far down its river it lies
    // as the cosine and sine of a FLOW_P cycle, which reads back smoothly between cells, whether it flows, and its
    // distance from the bank in twelfths of FLOW_BANK cells.
    const FLOW_P = 48, FLOW_BANK = 12;
    function buildFlow() {
      const n = W * H, wet = new Uint8Array(n), D = new Float32Array(n), comp = new Int32Array(n).fill(-1), data = new Uint8Array(n * 4);
      for (let c = 0; c < n; c++) { wet[c] = terrainAt(M, c % W + 0.5, (c / W | 0) + 0.5) < M.water ? 1 : 0; D[c] = wet[c] ? 1e9 : 0; data[c * 4] = data[c * 4 + 1] = 128; data[c * 4 + 3] = 255; }
      // A brook runs from its spring, so its cells take their way from how far down it they lie, and are kept out of
      // the rivers' reckoning. Its mouth, in the river's own deep water, is the river's.
      const bArc = new Float32Array(n).fill(-1), bDist = new Float32Array(n).fill(9);
      for (const b of M.brooks || []) {
        let a = 0;
        b.pts.forEach((p, i) => {
          if (i) a += Math.hypot(p[0] - b.pts[i - 1][0], p[1] - b.pts[i - 1][1]);
          for (let y = Math.max(0, Math.floor(p[1] - 2)); y <= Math.min(H - 1, Math.floor(p[1] + 2)); y++) for (let x = Math.max(0, Math.floor(p[0] - 2)); x <= Math.min(W - 1, Math.floor(p[0] + 2)); x++) {
            const c = y * W + x, d = Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]);
            if (!wet[c] && d < 1.6 && d < bDist[c]) { bDist[c] = d; bArc[c] = a; }
          }
        });
      }
      for (let c = 0; c < n; c++) if (bArc[c] >= 0) {
        const ang = bArc[c] / FLOW_P * Math.PI * 2;
        data[c * 4] = Math.round(127.5 + 127.5 * Math.cos(ang)); data[c * 4 + 1] = Math.round(127.5 + 127.5 * Math.sin(ang)); data[c * 4 + 2] = 255; data[c * 4 + 3] = 20;
        wet[c] = 0; D[c] = 0;
      }
      // Distance to the bank through the water, in two chamfer passes.
      const relax = (c, o, k) => { if (D[o] + k < D[c]) D[c] = D[o] + k; };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = y * W + x; if (!wet[c]) continue; if (x > 0) relax(c, c - 1, 1); if (y > 0) { relax(c, c - W, 1); if (x > 0) relax(c, c - W - 1, 1.414); if (x < W - 1) relax(c, c - W + 1, 1.414); } }
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const c = y * W + x; if (!wet[c]) continue; if (x < W - 1) relax(c, c + 1, 1); if (y < H - 1) { relax(c, c + W, 1); if (x < W - 1) relax(c, c + W + 1, 1.414); if (x > 0) relax(c, c + W - 1, 1.414); } }
      // The distance smoothed, so rows laid by it run round and not in the chamfer's corners.
      const Ds = new Float32Array(D);
      for (let pass = 0; pass < 3; pass++) {
        const src = pass ? Ds.slice() : D;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const c = y * W + x;
          if (!wet[c]) continue;
          let t = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += src[c + j * W + i];
          Ds[c] = t / 9;
        }
      }
      // A cell's place going clockwise round the map's edge from the top left corner.
      const rim = (x, y) => y === 0 ? x : x === W - 1 ? W + y : y === H - 1 ? 2 * W + H - x : x === 0 ? 2 * W + 2 * H - y : -1;
      const N8 = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [-1, 1, 14], [1, -1, 14], [-1, -1, 14]];
      let ci = 0;
      const still = [];
      riverLines = [];
      for (let c0 = 0; c0 < n; c0++) {
        if (!wet[c0] || comp[c0] >= 0) continue;
        const cells = [c0];
        comp[c0] = ci;
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i], x = c % W, y = c / W | 0;
          for (const [dx, dy] of N8) { const X = x + dx, Y = y + dy, o = Y * W + X; if (X >= 0 && Y >= 0 && X < W && Y < H && wet[o] && comp[o] < 0) { comp[o] = ci; cells.push(o); } }
        }
        ci++;
        let wide = 0;
        const ends = [];
        for (const c of cells) { wide = Math.max(wide, D[c]); const r = rim(c % W, c / W | 0); if (r >= 0) ends.push(r); }
        ends.sort((a, b) => a - b);
        // The stretches of edge it meets, one where a stretch runs on past the top left corner.
        const runs = [];
        for (const r of ends) { const last = runs[runs.length - 1]; if (last && r - last[1] <= 4) last[1] = r; else runs.push([r, r]); }
        const P = 2 * (W + H);
        if (runs.length > 1 && runs[0][0] + P - runs[runs.length - 1][1] <= 4) runs[runs.length - 1][1] = runs.shift()[1] + P;
        if (runs.length < 2 || wide > 9) { still.push(...cells); continue; }
        const [first, upTo] = runs[0];
        // Distance down the river from the end met first, in tenths of a cell along eight ways, by buckets.
        const G = new Map(), Q = [];
        const at = (c, g) => { if (G.has(c) && G.get(c) <= g) return; G.set(c, g); (Q[g] || (Q[g] = [])).push(c); };
        for (const c of cells) { const r = rim(c % W, c / W | 0); if (r >= 0 && ((r >= first && r <= upTo) || (r + P >= first && r + P <= upTo))) at(c, 0); }
        for (let g = 0; g < Q.length; g++) for (const c of Q[g] || []) {
          if (G.get(c) !== g) continue;
          const x = c % W, y = c / W | 0;
          for (const [dx, dy, k] of N8) { const X = x + dx, Y = y + dy, o = Y * W + X; if (X >= 0 && Y >= 0 && X < W && Y < H && comp[o] === comp[c]) at(o, g + k); }
        }
        // The river's middle line, for its name: in each three cells down its course, the point furthest from its banks.
        const bins = new Map();
        for (const [c, g] of G) { const b = Math.floor(g / 30), cur = bins.get(b); if (cur === undefined || D[c] > D[cur]) bins.set(b, c); }
        let line = [...bins.keys()].sort((a, b) => a - b).map(k => { const c = bins.get(k); return [c % W + 0.5, (c / W | 0) + 0.5]; });
        for (let k = 0; k < 3; k++) line = line.map((p, i) => i === 0 || i === line.length - 1 ? p : [(line[i - 1][0] + p[0] * 2 + line[i + 1][0]) / 4, (line[i - 1][1] + p[1] * 2 + line[i + 1][1]) / 4]);
        if (line.length > 6) riverLines.push(line);
        for (const [c, g] of G) { const a = g / 10 / FLOW_P * Math.PI * 2; data[c * 4] = Math.round(127.5 + 127.5 * Math.cos(a)); data[c * 4 + 1] = Math.round(127.5 + 127.5 * Math.sin(a)); data[c * 4 + 2] = 255; data[c * 4 + 3] = Math.round(Math.min(Ds[c], FLOW_BANK) / FLOW_BANK * 255); }
      }
      if (flowTex) flowTex.dispose();
      flowTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
      flowTex.magFilter = flowTex.minFilter = THREE.LinearFilter; flowTex.needsUpdate = true;
      SH.tFlow.value = flowTex;
      // Beaches: the low, gentle ground beside still water, a lake's or the sea's, never a river's. Each dry cell
      // within BEACH_W of still water that stands less than a unit and a half over it and is not steep is beach, fullest at the
      // water's edge.
      const BEACH_W = 4.5, beach = new Uint8Array(n), bd = new Float32Array(n).fill(1e9), q = [];
      for (const c of still) { bd[c] = 0; q.push(c); }
      for (let i = 0; i < q.length; i++) {
        const c = q[i], x = c % W, y = c / W | 0;
        for (const [dx, dy, len] of N8) {
          const X = x + dx, Y = y + dy, o = Y * W + X;
          if (X < 0 || Y < 0 || X >= W || Y >= H || wet[o] || bd[c] + len / 10 >= bd[o] || bd[c] + len / 10 > BEACH_W) continue;
          bd[o] = bd[c] + len / 10; q.push(o);
        }
      }
      for (let c = 0; c < n; c++) {
        if (wet[c] || bd[c] > BEACH_W) continue;
        const x = c % W + 0.5, y = (c / W | 0) + 0.5, z = terrainAt(M, x, y) - M.water;
        const sl = Math.hypot(terrainAt(M, x + 1, y) - terrainAt(M, x - 1, y), terrainAt(M, x, y + 1) - terrainAt(M, x, y - 1)) / 2;
        beach[c] = Math.round(255 * Math.max(0, 1 - bd[c] / BEACH_W) ** 0.6 * clamp((1.4 - z) / 0.6, 0, 1) * clamp((0.75 - sl) / 0.3, 0, 1));
      }
      beachMap = beach;
    }

    // Farmland round each town, its plots' middles out to FIELD_R and their far ends to FIELD_OUT: open, dry, gentle
    // ground clear of woods, ore, houses, parks, brooks and bases. Where two towns' land would meet a lane is left
    // between them, so each keeps its own lie of plots. The ink look lays the plots out from this, with the beaches,
    // in one texture.
    const FIELD_R = 15, FIELD_OUT = 20;
    function buildFields() {
      const n = W * H, cov = new Uint8Array(n * 4), rand = mulberry(M.seed + 59), turn = M.towns.map(() => 1 + Math.floor(rand() * 254)), BD = M.brookDist;
      for (let c = 0; c < n; c++) {
        cov[c * 4] = beachMap ? beachMap[c] : 0;
        const x = c % W + 0.5, y = (c / W | 0) + 0.5;
        let d1 = 1e9, d2 = 1e9, ti = -1;
        M.towns.forEach((t, i) => { const d = Math.hypot(t.x - x, t.y - y); if (d < d1) { d2 = d1; d1 = d; ti = i; } else if (d < d2) d2 = d; });
        if (ti < 0) continue;
        cov[c * 4 + 2] = turn[ti]; cov[c * 4 + 3] = Math.round(Math.min(1, d1 / FIELD_OUT) * 255);
        if (d1 > FIELD_OUT || d1 < 3.5 || d2 - d1 < 2.5) continue;
        const z = terrainAt(M, x, y), v = Math.round(y * RES) * VW + Math.round(x * RES);
        const sl = Math.hypot(terrainAt(M, x + 1, y) - terrainAt(M, x - 1, y), terrainAt(M, x, y + 1) - terrainAt(M, x, y - 1)) / 2;
        if ((M.ground[c] & 27) || M.ore[c] || z < M.water + 0.35 || sl > 0.6 || (beachMap && beachMap[c] > 30) || (BD && BD[v] < 1.2) || M.roadDist[v] < 1.2) continue;
        if (M.houses.some(h => x > h.x - 1.5 && x < h.x + h.w + 1.5 && y > h.y - 1.5 && y < h.y + h.h + 1.5)) continue;
        if (parks.some(p => Math.hypot(p.x - x, p.y - y) < p.r + 1) || S.bases.some(b => Math.hypot(b[0] - x, b[1] - y) < 22)) continue;
        cov[c * 4 + 1] = 255;
      }
      if (beachTex) beachTex.dispose();
      beachTex = new THREE.DataTexture(cov, W, H, THREE.RGBAFormat);
      beachTex.magFilter = beachTex.minFilter = THREE.LinearFilter; beachTex.needsUpdate = true;
      SH.tCover.value = beachTex;
      fieldAge = 0;
    }
    // The farmland by the ages: small strips near the town in the Ancient Age, the open strip fields of the Medieval,
    // hedged enclosures from the Gunpowder Age, and the large fields of the Modern. Walls stand in for hedges in the
    // snowy pass and on the salt flats, where orchards are groves.
    const FIELDS = [null,
      [0.55, 1.5, 5.5, 0, 0.1, 0.05, 0.25], [0.7, 1.7, 7.5, 0.15, 0.15, 0.08, 0.25], [0.82, 3.0, 4.5, 0.55, 0.2, 0.12, 0.3],
      [0.92, 3.4, 5.0, 0.5, 0.25, 0.12, 0.3], [1, 4.6, 7.5, 0.3, 0.1, 0.1, 0.2], [1, 4.6, 7.5, 0.25, 0.1, 0.1, 0.2]];
    let fieldAge = 0;
    function updateFields() {
      const age = Math.max(1, Math.min(6, worldAge()));
      if (age === fieldAge) return;
      fieldAge = age;
      const [reach, rowH, plotW, hedge0, wall0, orch0, mead0] = FIELDS[age], bare = theme.tree === 'conifer' || theme.tree === 'acacia';
      const hedge = bare ? hedge0 * 0.25 : hedge0, wall = bare ? wall0 + hedge0 * 0.75 : wall0;
      SH.uFieldK.value.set(reach * FIELD_R / FIELD_OUT, rowH, plotW, hedge);
      SH.uFieldK2.value.set(wall, theme.tree === 'acacia' ? orch0 * 1.5 : orch0, theme.tree === 'conifer' ? mead0 + 0.2 : mead0, 0);
    }

    // What the map letters: the rivers by their courses, the highest hills, and the largest woods, each named from
    // the theatre's list. Bases are left unnamed.
    function buildNames() {
      const hills = [], woods = [], far = (x, y, list, d) => list.every(p => Math.hypot(p.x - x, p.y - y) > d) && S.bases.every(b => Math.hypot(b[0] - x, b[1] - y) > 18);
      // Hills: tops higher than all about them within eight cells, the highest first.
      const tops = [];
      for (let y = 6; y < H - 6; y += 3) for (let x = 6; x < W - 6; x += 3) {
        const z = terrainAt(M, x, y);
        if (z < 3.2) continue;
        let top = true;
        for (let j = -8; j <= 8 && top; j += 2) for (let i = -8; i <= 8; i += 2) if ((i || j) && terrainAt(M, x + i, y + j) > z) { top = false; break; }
        if (top) tops.push({ x, y, z });
      }
      tops.sort((a, b) => b.z - a.z);
      for (const t of tops) if (hills.length < Math.round(5 * W / 128) && far(t.x, t.y, hills, 24)) hills.push(t);
      // Woods: the largest stands, by their cells joined side to side.
      const seen = new Uint8Array(W * H);
      const stands = [];
      for (let c0 = 0; c0 < W * H; c0++) {
        if (!(M.ground[c0] & 8) || seen[c0]) continue;
        const q = [c0]; seen[c0] = 1; let sx = 0, sy = 0;
        for (let i = 0; i < q.length; i++) { const c = q[i], x = c % W, y = c / W | 0; sx += x; sy += y; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) { const X = x + dx, Y = y + dy, o = Y * W + X; if (X >= 0 && Y >= 0 && X < W && Y < H && !seen[o] && (M.ground[o] & 8)) { seen[o] = 1; q.push(o); } } }
        if (q.length >= 60) stands.push({ x: sx / q.length + 0.5, y: sy / q.length + 0.5, n: q.length });
      }
      stands.sort((a, b) => b.n - a.n);
      for (const s of stands) if (woods.length < Math.round(5 * W / 128) && far(s.x, s.y, woods.concat(hills), 18)) woods.push(s);
      const rivers = riverLines.map(pts => ({ pts }));
      rivers.forEach((r, i) => { r.name = Rules.nameFor(S, 'river', i); });
      hills.forEach((h, i) => { h.name = Rules.nameFor(S, 'hill', i); });
      woods.forEach((w, i) => { w.name = Rules.nameFor(S, 'wood', i); });
      names = { rivers, hills, woods };
    }

    function buildScenery() {
      const th = theme, rand = mulberry(M.seed + 11), sc = MODELS.scenery;
      const trees = M.scatter.filter(s => s.k === 'tree'), rocks = M.scatter.filter(s => s.k === 'rock');
      const lf = th.leaf.map(c => new THREE.Color(c));
      scen = { trees: null, houses: null, bridges: null, fords: null, fences: null, fireT: 0, houseT: 0, fenceT: 0 };
      // Trees get their own line category, so the ink pass can wash their canopies, and sway in the wind. Up the
      // high slopes conifers take over from the theatre's own trees, mixed through a band of height.
      const pf = THEMES.winter.leaf.map(c => new THREE.Color(c));
      const tl = trees.map(t => {
        const g = terrainAt(M, t.x, t.y), hi = th.pine !== undefined && g > th.pine + (rand() - 0.5) * 2.4, L = hi ? pf : lf;
        return { x: t.x, y: g - 0.04, z: t.y, s: t.s * 1.1, a: t.a, c: colA.copy(L[0]).lerp(L[1], rand()).getHex(), cell: t.c, hi };
      });
      const meshes = [];
      for (const [geo, list] of [[sc[th.tree], tl.filter(t => !t.hi)], [sc.conifer, tl.filter(t => t.hi)]]) {
        if (!list.length) continue;
        const m = lineCat(instanced(geo, treeTint, list), 0.459, true);
        list.forEach((t, i) => { t.m = m; t.i = i; });
        meshes.push(m);
      }
      const byCell = new Map();
      tl.forEach((t, i) => { if (!byCell.has(t.cell)) byCell.set(t.cell, []); byCell.get(t.cell).push(i); });
      scen.trees = { meshes, list: tl, state: new Uint8Array(tl.length), seen: -1, byCell };
      const rc = new THREE.Color(th.rock);
      instanced(sc.rock, plainTint, rocks.map(t => ({ x: t.x, y: terrainAt(M, t.x, t.y) - 0.06, z: t.y, s: t.s * 1.2, a: t.a, c: colA.copy(rc).multiplyScalar(0.62 + rand() * 0.3).getHex() })));

      // Houses, plaster walls under pitched roofs, and in each town its other buildings: the biggest a church with a
      // tower and spire at one end, a long one a barn of dark boards under a broad roof, a square one a market hall
      // over open arches, and a small one a windmill. Some houses have hipped roofs, and most a chimney. What a
      // building is comes of the map alone, so every player sees the same town; the rules know only houses.
      const wall = [0xcfc4ae, 0xb9ad96, 0xd8d0be, 0xa89a82], roofC = [0x8a4a34, 0x6e4032, 0x5c5a58, 0x7a5a42];
      const hb = [], hr = [], win = [], hrub = [], kind = M.houses.map(() => 'house');
      const byTown = new Map();
      M.houses.forEach((h, i) => { if (!byTown.has(h.town)) byTown.set(h.town, []); byTown.get(h.town).push(i); });
      for (const list of byTown.values()) {
        const area = i => M.houses[i].w * M.houses[i].h, free = list.slice().sort((a, b) => area(b) - area(a) || a - b);
        const take = (f, k) => { const j = free.findIndex(f); if (j >= 0) { kind[free[j]] = k; free.splice(j, 1); } };
        take(i => area(i) >= 6, 'church');
        take(i => M.houses[i].w !== M.houses[i].h && area(i) >= 6, 'barn');
        take(i => M.houses[i].w === M.houses[i].h && area(i) >= 9, 'hall');
        take(i => area(i) <= 4, 'mill');
      }
      const extra = { block: [], spire: [], mill: [], millcap: [], sails: [], hip: [] };
      for (const [hi, h] of M.houses.entries()) {
        const cx = h.x + h.w / 2, cz = h.y + h.h / 2, g = Math.min(terrainAt(M, h.x, h.y), terrainAt(M, h.x + h.w, h.y + h.h)) - 0.12;
        const tall = 0.62 * h.floors + 0.2, along = h.w >= h.h, k = kind[hi], r = (hi * 2654435761 >>> 0) / 4294967296;
        const body = { x: cx, y: g, z: cz, sx: h.w - 0.3, sy: tall + 0.2, sz: h.h - 0.3, c: wall[h.tone * 4 | 0] };
        const roof = { x: cx, y: g + tall + 0.08, z: cz, sx: (along ? h.h : h.w) - 0.1, sy: 0.9, sz: (along ? h.w : h.h) - 0.1, a: along ? Math.PI / 2 : 0, c: roofC[h.tone * 3.99 | 0] };
        let floors0 = 0, wins = true;
        if (k === 'church') {
          // The tower at the end of the long side, twice the nave's height, and its spire.
          const ex = along ? h.x + 0.75 : cx, ez = along ? cz : h.y + 0.75, th = tall * 1.6 + 1.2;
          extra.block.push({ x: ex, y: g, z: ez, sx: 1.2, sy: th, sz: 1.2, c: 0xd8d0be, h: hi });
          extra.spire.push({ x: ex, y: g + th, z: ez, sx: 1.25, sy: 1.8, sz: 1.25, c: 0x5c5a58, h: hi });
          body.c = 0xd8d0be;
        } else if (k === 'barn') {
          body.sy = 0.75; body.c = 0x7a4a36; roof.y = g + 0.63; roof.sy = 1.3; roof.c = 0x5a5650; wins = false;
          extra.block.push({ x: along ? cx : cx + (h.w / 2 - 0.13), y: g, z: along ? cz + (h.h / 2 - 0.13) : cz, sx: along ? 0.9 : 0.04, sy: 0.6, sz: along ? 0.04 : 0.9, c: 0x3a2a20, h: hi });
        } else if (k === 'hall') {
          // An upper floor over open arches: the body lifted, a pillar at each corner and between.
          body.y = g + 0.62; body.sy = tall - 0.42; floors0 = 1;
          for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) extra.block.push({ x: cx + px * (h.w / 2 - 0.3), y: g, z: cz + pz * (h.h / 2 - 0.3), sx: 0.24, sy: 0.64, sz: 0.24, c: body.c, h: hi });
        } else if (k === 'mill') {
          const mh = 1.9;
          extra.mill.push({ x: cx, y: g, z: cz, sx: 1.5, sy: mh, sz: 1.5, c: 0xd8d0be, h: hi });
          extra.millcap.push({ x: cx, y: g + mh, z: cz, sx: 1.3, sy: 1.2, sz: 1.3, c: 0x6e4032, h: hi });
          extra.sails.push({ x: cx + 0.62, y: g + mh - 0.05, z: cz, s: 1.35, a: Math.PI / 2 - 0.4, c: 0xffffff, h: hi, mill: true, ph: r * 6.28 });
          body.sx = body.sz = 0.01; body.sy = 0.01; roof.sx = roof.sz = roof.sy = 0.001; wins = false;
        } else {
          // A hipped roof on a square house now and then, and a chimney on most.
          if (h.w === h.h && r < 0.5) { extra.hip.push({ x: cx, y: g + tall + 0.08, z: cz, sx: h.w * 1.02, sy: 2, sz: h.h * 1.02, c: roof.c, h: hi }); roof.sx = roof.sz = roof.sy = 0.001; }
          if (r > 0.25) extra.block.push({ x: cx + (along ? (r - 0.6) * h.w * 0.6 : 0.2), y: g + tall + 0.1, z: cz + (along ? 0.2 : (r - 0.6) * h.h * 0.6), sx: 0.26, sy: 0.75, sz: 0.26, c: 0x8a6a56, h: hi });
        }
        hb.push(body); hr.push(roof);
        if (wins) for (let f = floors0; f < h.floors; f++) {
          const wy = g + 0.42 + f * 0.62;
          for (const s of [-1, 1]) for (let k = 0; k < Math.max(1, h.w - 1); k++) win.push({ x: h.x + 0.7 + k * (h.w - 1.4) / Math.max(1, h.w - 2 || 1), y: wy, z: cz + s * (h.h / 2 - 0.14), sx: 0.26, sy: 0.3, sz: 0.03, c: 0x2a2c30, h: hi });
          for (const s of [-1, 1]) for (let k = 0; k < Math.max(1, h.h - 1); k++) win.push({ x: cx + s * (h.w / 2 - 0.14), y: wy, z: h.y + 0.7 + k * (h.h - 1.4) / Math.max(1, h.h - 2 || 1), sx: 0.03, sy: 0.3, sz: 0.26, c: 0x2a2c30, h: hi });
        }
        // Rubble kept hidden until the house falls.
        for (let k = 0; k < 3; k++) hrub.push({ x: cx + (k - 1) * h.w * 0.28, y: g + 0.1, z: cz + ((k * 7) % 3 - 1) * h.h * 0.22, s: 0.9 + 0.3 * k, a: k * 2.1, c: 0x8c8478, h: hi });
      }
      const hbm = instanced(sc.block, plainTint, hb), hrm = instanced(sc.roof, plainTint, hr), wm = instanced(sc.block, plainTint, win, false), rm = instanced(sc.rubble, plainTint, hrub);
      hrub.forEach((o, i) => setInst(rm, i, o, true)); dirty(rm);
      const xm = {};
      for (const [m, list] of Object.entries(extra)) if (list.length) xm[m] = { mesh: instanced(sc[m], plainTint, list), list };
      scen.houses = { hb, hr, win, hrub, hbm, hrm, wm, rm, xm, kind, ruined: new Uint8Array(M.houses.length) };
      buildFences();
      buildRoadside();
      buildPlants();
      buildParks();
      buildFields();

      // Wellheads in a black stain, each bridge on its piers.
      instanced(sc.well, paint, M.wells.map(w => ({ x: w.x, y: terrainAt(M, w.x, w.y), z: w.y })));
      const dk = [], pier = [], brub = [];
      for (const b of M.bridges) {
        const dx = b.x1 - b.x0, dy = b.y1 - b.y0, len = Math.hypot(dx, dy) + 2, a = -Math.atan2(dy, dx), mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
        // The whole deck, and a second piece kept for when it lies broken in two.
        dk.push({ x: mx, y: b.z - 0.1, z: my, sx: len, sy: 1, sz: b.w + 0.3, a, c: 0x5e5d59 }, { x: mx, y: b.z - 0.1, z: my, sx: len, sy: 1, sz: b.w + 0.3, a, c: 0x5e5d59 });
        for (let k = 0; k < 4; k++) brub.push({ x: mx + dx / len * (k - 1.5) * 2.2 + (k % 2 - 0.5) * 1.2, y: M.water - 0.25, z: my + dy / len * (k - 1.5) * 2.2, s: 1.3, a: k * 1.7, c: 0x6a675f });
        // Piers stand in the river, across the deck and out past both its sides, pointed up and down stream, so
        // from far off the bridge reads by its piers on the water as an old map draws one.
        for (let i = -3; i <= 3; i++) {
          const t = i * 2.6, px = mx + dx / len * t, py = my + dy / len * t;
          if (terrainAt(M, px, py) > M.water - 0.05) continue;
          pier.push({ x: px, y: b.z - 0.1, z: py, a, sx: 0.7, sy: b.z - M.water + 1.2, sz: b.w + 1.7, c: 0x77746c });
        }
      }
      // Each kind of bridge, of which the one the world's age has stands: timber trestles, stone, iron trusses on
      // stone piers, or the concrete of today. All share the decks' places, and fall alike.
      const KIND_DECK = { wood: ['deckWood', 0x8a6a4a], stone: ['deckStone', 0xb8b0a0], iron: ['deckIron', 0x5a5e66], concrete: ['deck', 0x5e5d59] };
      const KIND_PIER = { wood: ['trestle', 0x6a5038, 0.35], stone: ['cutwater', 0xa8a090, 1], iron: ['cutwater', 0x8a8478, 0.8], concrete: ['cutwater', 0x77746c, 1] };
      const kinds = {};
      for (const k of Object.keys(KIND_DECK)) {
        const dkk = dk.map(o => Object.assign({}, o, { c: KIND_DECK[k][1], sy: k === 'iron' ? 1.4 : 1 }));
        const m = lineCat(instanced(sc[KIND_DECK[k][0]], plainTint, dkk), 0.42);
        dkk.forEach((o, i) => { if (i % 2) setInst(m, i, o, true); }); dirty(m);
        const pm = pier.length ? lineCat(instanced(sc[KIND_PIER[k][0]], plainTint, pier.map(o => Object.assign({}, o, { c: KIND_PIER[k][1], sx: o.sx * KIND_PIER[k][2] }))), 0.42) : null;
        kinds[k] = { dm: m, dk: dkk, pm };
      }
      const dm = kinds.concrete.dm;
      const lane = [];
      M.bridges.forEach((b, bi) => {
        const dx = b.x1 - b.x0, dy = b.y1 - b.y0, len = Math.hypot(dx, dy), a = -Math.atan2(dy, dx), n = Math.floor(len / 2);
        for (let i = 0; i <= n; i++) { const t = i / n; lane.push({ x: lerp(b.x0, b.x1, t), y: b.z + 0.11, z: lerp(b.y0, b.y1, t), sx: 0.9, sy: 0.01, sz: 0.1, a, c: 0xd8d4c4, b: bi, t }); }
      });
      const lm = lineCat(instanced(sc.block, plainTint, lane, false), 0.42);
      const bm = lineCat(instanced(sc.rubble, plainTint, brub), 0.42);
      brub.forEach((o, i) => setInst(bm, i, o, true)); dirty(bm);
      scen.bridges = { dk, lane, brub, dm, lm, bm, kinds, kind: '', shown: M.bridges.map(() => 'up') };
      // Stepping stones across each ford, under water when the river is up.
      const stones = [];
      for (const f of M.fords || []) for (let j = -6; j <= 6; j++) {
        const k = j * 1.1, o = j % 2 ? 0.25 : -0.25, x = f[0] - f[3] * k + f[2] * o, y = f[1] + f[2] * k + f[3] * o;
        if (terrainAt(M, x, y) < M.water - 0.05) stones.push({ x, y: terrainAt(M, x, y) + 0.12, z: y, sx: 0.55, sy: 0.35, sz: 0.5, a: k, c: 0xa8a090 });
      }
      // A few across each brook's ford.
      for (const f of M.brookFords || []) for (let j = -1; j <= 1; j++) {
        const k = j * 0.42, o = j % 2 ? 0.16 : -0.16, x = f[0] - f[3] * k + f[2] * o, y = f[1] + f[2] * k + f[3] * o;
        stones.push({ x, y: terrainAt(M, x, y) + 0.04, z: y, sx: 0.3, sy: 0.22, sz: 0.28, a: k, c: 0xa8a090 });
      }
      scen.fords = { mesh: stones.length ? instanced(sc.stone, plainTint, stones) : null, list: stones, under: false };

      // Ore lies on its cells as nuggets, scaled by what is left.
      const cells = [];
      for (let c = 0; c < W * H; c++) if (M.ore[c]) cells.push(c);
      const per = low ? 1 : 2, cap = cells.length * per;
      const nug = new THREE.InstancedMesh(sc.ore, patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4, emissive: 0x3a2400, emissiveIntensity: 0.0, envMapIntensity: 0.55 }), { tint: true }), cap);
      nug.frustumCulled = false; nug.castShadow = !low; nug.receiveShadow = true;
      ore = { mesh: nug, cells, per, seen: new Uint16Array(cells.length).fill(65535), rnd: [] };
      const rr = mulberry(M.seed + 3);
      for (let i = 0; i < cap; i++) { ore.rnd.push([rr() * 0.8 + 0.1, rr() * 0.8 + 0.1, rr() * 6.28, 0.8 + rr() * 0.8]); nug.setColorAt(i, colA.setHSL(0.1 + rr() * 0.035, 0.74, 0.5 + rr() * 0.16)); }
      add(nug);
      lineCat(nug, 0.55);
      oreSeen = -1;

      // Town flags, one mesh each so they can change colour.
      flagMeshes = [];
      for (const t of S.towns) {
        const g = terrainAt(M, t.x, t.y), pole = add(new THREE.Mesh(sc.pole, paint));
        pole.position.set(t.x, g, t.y); pole.castShadow = true;
        const flag = new THREE.InstancedMesh(sc.flag, paint, 1);
        flag.setMatrixAt(0, m1.makeTranslation(0, 0, 0)); flag.setColorAt(0, neutral); flag.position.set(t.x, g + 2.1, t.y); flag.frustumCulled = false; flag.castShadow = true;
        add(flag); flagMeshes.push(flag);
      }
    }

    // Garden fences round each house's plot, open on the side toward the town's middle. Vehicles flatten them
    // and blasts throw them down. Only the picture keeps them.
    const railOf = (f, hgt, down) => down ? { x: f.mx + Math.sin(f.a) * hgt, y: f.g + 0.03, z: f.my + Math.cos(f.a) * hgt, sx: 1, a: f.a + 0.2 - hgt, c: 0x7a6a54 } : { x: f.mx, y: f.g + hgt, z: f.my, sx: 1.02, a: f.a, c: 0x9a8a70 };
    const postOf = (f, down) => ({ x: f.x0, y: f.g, z: f.y0, a: f.a, rx: down ? 1.45 : 0, c: 0x6a5a48 });
    function buildFences() {
      const sc = MODELS.scenery, segs = [], taken = new Set(), RD = M.roadDist;
      M.houses.forEach(h => {
        const t = M.towns[h.town] || { x: h.x, y: h.y };
        const x0 = h.x - 1, y0 = h.y - 1, x1 = h.x + h.w + 1, y1 = h.y + h.h + 1;
        const sides = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
        // The gate is the stretch nearest the town's middle.
        let gate = [t.x, t.y], gd = 1e9;
        for (const [ax, ay, bx, by] of sides) {
          const n = Math.round(Math.hypot(bx - ax, by - ay));
          for (let i = 0; i < n; i++) { const mx = ax + (bx - ax) * (i + 0.5) / n, my = ay + (by - ay) * (i + 0.5) / n, d = Math.hypot(mx - t.x, my - t.y); if (d < gd) { gd = d; gate = [mx, my]; } }
        }
        for (const [ax, ay, bx, by] of sides) {
          const n = Math.round(Math.hypot(bx - ax, by - ay));
          for (let i = 0; i < n; i++) {
            const sx = ax + (bx - ax) * i / n, sy = ay + (by - ay) * i / n, ex = ax + (bx - ax) * (i + 1) / n, ey = ay + (by - ay) * (i + 1) / n, mx = (sx + ex) / 2, my = (sy + ey) / 2;
            const key = Math.round(mx * 2) + ',' + Math.round(my * 2);
            if (taken.has(key) || Math.hypot(mx - gate[0], my - gate[1]) < 1.2 || mx < 1 || my < 1 || mx > W - 1 || my > H - 1) continue;
            if (RD[Math.round(my * RES) * VW + Math.round(mx * RES)] < 2 || (S.gnd[Rules.cellOf(mx, my)] & 3) || terrainAt(M, mx, my) < M.water + 0.2) continue;
            taken.add(key);
            segs.push({ x0: sx, y0: sy, mx, my, g: terrainAt(M, mx, my), a: -Math.atan2(ey - sy, ex - sx), down: 0 });
          }
        }
      });
      const rails = [], posts = [];
      for (const f of segs) { rails.push(railOf(f, 0.2), railOf(f, 0.38)); posts.push(postOf(f)); }
      const grid = new Map();
      segs.forEach((f, i) => { const k = (f.my | 0) * W + (f.mx | 0); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
      scen.fences = { segs, grid, rm: segs.length ? instanced(sc.rail, plainTint, rails, false) : null, pm: segs.length ? instanced(sc.post, plainTint, posts, false) : null, dirty: false };
    }
    function flatten(x, y, r) {
      const F = scen && scen.fences;
      if (!scen) return;
      if (F && F.rm) for (let cy = Math.floor(y - r - 1); cy <= Math.floor(y + r + 1); cy++) for (let cx = Math.floor(x - r - 1); cx <= Math.floor(x + r + 1); cx++) {
        const list = F.grid.get(cy * W + cx);
        if (!list) continue;
        for (const i of list) {
          const f = F.segs[i];
          if (f.down || Math.hypot(f.mx - x, f.my - y) > r + 0.5) continue;
          f.down = 1; F.dirty = true;
          setInst(F.rm, i * 2, railOf(f, 0.2, true)); setInst(F.rm, i * 2 + 1, railOf(f, 0.38, true)); setInst(F.pm, i, postOf(f, true));
        }
      }
      const R = scen.roadside;
      if (!R) return;
      for (let cy = Math.floor(y - r - 1); cy <= Math.floor(y + r + 1); cy++) for (let cx = Math.floor(x - r - 1); cx <= Math.floor(x + r + 1); cx++) {
        const list = R.grid.get(cy * W + cx);
        if (list) for (const n of list) { const it = R.items[n]; if (!it.down && Math.hypot(it.x - x, it.y - y) <= r + 0.4) { it.down = 1; poseRoadside(it); } }
      }
    }

    // Lesser plants, for the picture alone, by the theatre: shrubs on the slopes, the banks and at the woods' edges,
    // and by the water reeds, or on the salt flats a palm now and then. None stands on a road or in a wood, and one a
    // building comes to stand over goes while it stands. The same map grows the same plants.
    function buildPlants() {
      const th = theme, rand = mulberry(M.seed + 23), sc = MODELS.scenery, g = M.ground, BD = M.brookDist;
      const shrubM = th.tree === 'acacia' ? 'scrub' : th.tree === 'conifer' ? 'juniper' : 'bush', desert = th.tree === 'acacia';
      const dry = (x, y) => terrainAt(M, x, y) >= M.water;
      const shrubs = [], wet = [];
      for (let c = 0; c < W * H; c++) {
        const cx = c % W, cy = c / W | 0, x = cx + 0.15 + rand() * 0.7, y = cy + 0.15 + rand() * 0.7, r = rand(), z = terrainAt(M, x, y);
        const v = Math.round(y * RES) * VW + Math.round(x * RES), bd = BD ? BD[v] : 99;
        if (M.roadDist[v] < 2.5 || (g[c] & 8) || z < M.water + 0.1 || bd < 0.65) continue;
        // At the edge of the water, a river's, a lake's or a brook's.
        const bank = bd < 1.5 || (z < M.water + 0.7 && (!dry(x + 1, y) || !dry(x - 1, y) || !dry(x, y + 1) || !dry(x, y - 1)));
        // No reeds on a beach.
        if (bank && beachMap && beachMap[c] > 70) continue;
        if (bank) { if (r < (desert ? 0.035 : 0.5)) wet.push({ x, y: z - 0.04, z: y, s: (desert ? 0.9 : 0.8) + rand() * 0.5, a: rand() * 6.28, c: desert ? 0x5e7a3a : [0xa8a46a, 0x8a9a58, 0xb8ac78][rand() * 3 | 0], cell: c }); continue; }
        let edge = false;
        for (let j = -1; j <= 1 && !edge; j++) for (let i = -1; i <= 1; i++) { const X = cx + i, Y = cy + j; if (X >= 0 && Y >= 0 && X < W && Y < H && (g[Y * W + X] & 8)) { edge = true; break; } }
        if (r < (edge ? 0.3 : g[c] & 4 ? 0.08 : 0.02)) shrubs.push({ x, y: z - 0.03, z: y, s: 0.7 + rand() * 0.7, a: rand() * 6.28, c: colA.copy(new THREE.Color(th.leaf[0])).lerp(new THREE.Color(th.leaf[1]), rand()).multiplyScalar(0.9 + rand() * 0.25).getHex(), cell: c });
      }
      const list = shrubs.slice(0, 2600).concat(wet.slice(0, 2600));
      const sm = shrubs.length ? lineCat(instanced(sc[shrubM], treeTint, shrubs.slice(0, 2600)), 0.459, true) : null;
      const wm = wet.length ? lineCat(instanced(sc[desert ? 'palm' : 'reed'], treeTint, wet.slice(0, 2600)), 0.459, true) : null;
      shrubs.slice(0, 2600).forEach((p, i) => { p.m = sm; p.i = i; });
      wet.slice(0, 2600).forEach((p, i) => { p.m = wm; p.i = i; });
      scen.plants = { list, seen: -1 };
    }
    // A park beside each town that has room for one: a round lawn with gravel paths and a hedge, drawn by the ink
    // look, a fountain at its middle, benches and a few trees. Its furniture goes while a building stands over it.
    let parks = [];
    function buildParks() {
      const rand = mulberry(M.seed + 41), sc = MODELS.scenery, th = theme, lf = th.leaf.map(c => new THREE.Color(c));
      parks = [];
      M.towns.forEach((t, ti) => {
        if (parks.length >= 16) return;
        for (let k = 0; k < 24; k++) {
          const a = rand() * 6.28, d = 9.5 + rand() * 3, r = 3.6 + rand() * 0.8, x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d;
          if (x < r + 2 || y < r + 2 || x > W - r - 2 || y > H - r - 2) continue;
          let ok = true;
          for (let j = -r; j <= r && ok; j += 0.8) for (let i = -r; i <= r && ok; i += 0.8) {
            if (i * i + j * j > r * r) continue;
            const px = x + i, py = y + j, c = Rules.cellOf(px, py), z = terrainAt(M, px, py);
            if (M.ground[c] || M.ore[c] || z < M.water + 0.3 || M.roadDist[Math.round(py * RES) * VW + Math.round(px * RES)] < 1.8) ok = false;
          }
          if (ok && M.houses.some(h => Math.hypot(h.x + h.w / 2 - x, h.y + h.h / 2 - y) < r + 2.5)) ok = false;
          if (ok && S.bases.some(b => Math.hypot(b[0] - x, b[1] - y) < 26)) ok = false;
          if (ok && parks.some(p => Math.hypot(p.x - x, p.y - y) < p.r + r + 3)) ok = false;
          if (ok) { parks.push({ x, y, r, a: rand() * 1.57, town: ti }); break; }
        }
      });
      parks.forEach((p, i) => SH.uPark.value[i].set(p.x, p.y, p.r, p.a));
      for (let i = parks.length; i < 16; i++) SH.uPark.value[i].set(0, 0, 0, 0);
      const fount = [], bench = [], tree = [];
      for (const p of parks) {
        const g = terrainAt(M, p.x, p.y);
        fount.push({ x: p.x, y: g - 0.02, z: p.y, s: 0.5, a: p.a, c: 0xffffff, cell: Rules.cellOf(p.x, p.y) });
        // Benches face the fountain from the ring path, and the theatre's trees stand round the lawn's edge.
        for (let k = 0; k < 4; k++) {
          const a = p.a + Math.PI / 4 + k * Math.PI / 2, rb = p.r * 0.55 + 0.4, bx = p.x + Math.cos(a) * rb, by = p.y + Math.sin(a) * rb;
          bench.push({ x: bx, y: terrainAt(M, bx, by), z: by, s: 0.8, a: -a - Math.PI / 2, c: 0xffffff, cell: Rules.cellOf(bx, by) });
        }
        const nt = Math.round(p.r * 2.2);
        for (let k = 0; k < nt; k++) {
          const a = p.a + (k + 0.5) / nt * 6.28, rt = p.r - 0.45, tx = p.x + Math.cos(a) * rt, ty = p.y + Math.sin(a) * rt;
          if (k % 4 === 0) continue;
          tree.push({ x: tx, y: terrainAt(M, tx, ty) - 0.04, z: ty, s: 0.5 + rand() * 0.12, a: rand() * 6.28, c: colA.copy(lf[0]).lerp(lf[1], rand()).getHex(), cell: Rules.cellOf(tx, ty) });
        }
      }
      const fm = fount.length ? lineCat(instanced(sc.fountain, plainTint, fount), 0.5) : null, bm = bench.length ? lineCat(instanced(sc.bench, plainTint, bench), 0.5) : null;
      const tm = tree.length ? lineCat(instanced(sc[th.tree], treeTint, tree), 0.459, true) : null;
      fount.forEach((o, i) => { o.m = fm; o.i = i; }); bench.forEach((o, i) => { o.m = bm; o.i = i; }); tree.forEach((o, i) => { o.m = tm; o.i = i; });
      scen.plants.list.push(...fount, ...bench, ...tree);
    }
    // A plant under a building goes while the building stands.
    function updatePlants() {
      const P = scen && scen.plants;
      if (!P || P.seen === S.occVer) return;
      P.seen = S.occVer;
      const ms = new Set();
      for (const p of P.list) { const hid = S.occ[p.cell] ? 1 : 0; if (hid !== (p.hid || 0)) { p.hid = hid; setInst(p.m, p.i, p, !!hid); ms.add(p.m); } }
      ms.forEach(dirty);
    }
    // The age the world is seen in: the side being shown, or the most advanced side when watching them all.
    // Motor cars, telegraph lines and road markings belong to the Industrial Age and after.
    const MOTOR_AGE = 4;
    const worldAge = () => !S ? 5 : viewTeam >= 0 && S.P[viewTeam] ? S.P[viewTeam].tech : Math.max(1, ...S.P.filter(P => !P.out).map(P => P.tech));
    // Furniture along the roads: telegraph poles down one side of each road with wires between them, drawn on the
    // overlay, a milestone now and then on the other side, and at each junction a signpost with an arm for each
    // road. Vehicles and blasts knock them down and buildings put over them hide them. Only the picture keeps them.
    function buildRoadside() {
      const sc = MODELS.scenery, RD = M.roadDist, taken = new Set(), items = [], poles = [], miles = [], posts = [], arms = [], spans = [];
      const rd = (x, y) => RD[Math.round(clamp(y, 0, H) * RES) * VW + Math.round(clamp(x, 0, W) * RES)];
      const ok = (x, y, near = 1.7) => x > 1 && y > 1 && x < W - 1 && y < H - 1 && rd(x, y) > near && terrainAt(M, x, y) > M.water + 0.25 && !(S.gnd[Rules.cellOf(x, y)] & 3)
        && Rules.bridgeAt(S, x, y) < 0 && !M.houses.some(h => x > h.x - 0.8 && x < h.x + h.w + 0.8 && y > h.y - 0.8 && y < h.y + h.h + 0.8);
      const free = (x, y, r) => { const k = Math.round(x / r) + ',' + Math.round(y / r); if (taken.has(k)) return false; taken.add(k); return true; };
      const clear = (x, y) => !items.some(it => Math.hypot(it.x - x, it.y - y) < 1.6);
      // Points every step along a road, with the road's direction there.
      const along = (pts, step, f) => {
        let acc = step * 0.5;
        for (let k = 1; k < pts.length; k++) {
          const [ax, ay] = pts[k - 1], [bx, by] = pts[k], L = Math.hypot(bx - ax, by - ay);
          if (L < 1e-6) continue;
          while (acc <= L) { const t = acc / L; f(ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / L, (by - ay) / L); acc += step; }
          acc -= L;
        }
      };
      for (const r of M.roads) {
        let last = null;
        along(r, 5.2, (x, y, dx, dy) => {
          const px = x - dy * 2.15, py = y + dx * 2.15;
          if (!ok(px, py) || !free(px, py, 2.5)) { last = null; return; }
          const g = terrainAt(M, px, py), a = -Math.atan2(dy, dx), o = { x: px, y: g - 0.02, z: py, a, c: 0x6a5a48 };
          const pole = { kind: 'pole', i: poles.length, o, x: px, y: py, g, dx, dy, down: 0, hid: 0 };
          poles.push(o); items.push(pole);
          if (last && Math.hypot(last.x - px, last.y - py) < 8) spans.push([last, pole]);
          last = pole;
        });
        along(r, 17, (x, y, dx, dy) => {
          const px = x + dy * 1.95, py = y - dx * 1.95;
          if (!ok(px, py) || !free(px, py, 4)) return;
          const o = { x: px, y: terrainAt(M, px, py) - 0.02, z: py, a: -Math.atan2(dy, dx), c: 0xd8d0be };
          miles.push(o); items.push({ kind: 'mile', i: miles.length - 1, o, x: px, y: py, down: 0, hid: 0 });
        });
      }
      // Junctions: where three or more road ends meet, as at the forks before a bridge.
      const ends = [];
      for (const r of M.roads) if (r.length > 1) {
        for (const [p, q] of [[r[0], r[1]], [r[r.length - 1], r[r.length - 2]]]) ends.push({ x: p[0], y: p[1], a: Math.atan2(q[1] - p[1], q[0] - p[0]) });
      }
      const used = new Set();
      ends.forEach((e, i) => {
        if (used.has(i)) return;
        const group = [];
        ends.forEach((f, j) => { if (!used.has(j) && Math.hypot(f.x - e.x, f.y - e.y) < 1.5) { group.push(f); used.add(j); } });
        const cx = group.reduce((s, f) => s + f.x, 0) / group.length, cy = group.reduce((s, f) => s + f.y, 0) / group.length;
        // Roads leaving the same way, as a bridge's piece and the road beyond it do, count once.
        const as = [];
        for (const a of group.map(f => f.a).sort((a, b) => a - b)) if (!as.some(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.35)) as.push(a);
        if (as.length < 3) return;
        // The gaps between the roads, widest first; the post goes in the first that is dry land clear of them all,
        // far enough in to clear both roads beside it.
        const gaps = as.map((a, k) => { const d = (k + 1 < as.length ? as[k + 1] : as[0] + Math.PI * 2) - a; return { d, mid: a + d / 2 }; }).sort((u, v) => v.d - u.d);
        let px = 0, py = 0, found = false;
        for (const { d, mid } of gaps) {
          const r = Math.min(4.5, 2.1 / Math.sin(Math.min(d, Math.PI) / 2));
          px = cx + Math.cos(mid) * r; py = cy + Math.sin(mid) * r;
          if (ok(px, py, 1.6) && clear(px, py)) { found = true; break; }
        }
        if (!found) return;
        const g = terrainAt(M, px, py), o = { x: px, y: g - 0.02, z: py, c: 0x6a5a48 }, post = { kind: 'post', i: posts.length, o, x: px, y: py, down: 0, hid: 0, arms: [] };
        posts.push(o); items.push(post);
        as.forEach((a, k) => { const ao = { x: px, y: g + 1.42 - k * 0.14, z: py, a: -a, c: 0xf2eee2 }; post.arms.push(arms.length); arms.push(ao); });
      });
      // A fingerpost where the road passes each town, on the town's side, pointing both ways along the road.
      for (const t of M.towns) {
        let best = null, bd = 1e9;
        for (const r of M.roads) for (let k = 1; k < r.length; k++) {
          const [ax, ay] = r[k - 1], [bx, by] = r[k], L2 = (bx - ax) ** 2 + (by - ay) ** 2;
          if (L2 < 1e-6) continue;
          const u = clamp(((t.x - ax) * (bx - ax) + (t.y - ay) * (by - ay)) / L2, 0, 1), x = ax + (bx - ax) * u, y = ay + (by - ay) * u, d = Math.hypot(t.x - x, t.y - y);
          if (d < bd) { bd = d; const L = Math.sqrt(L2); best = { x, y, dx: (bx - ax) / L, dy: (by - ay) / L }; }
        }
        if (!best || bd > 14) continue;
        const side = Math.sign((t.x - best.x) * -best.dy + (t.y - best.y) * best.dx) || 1;
        let placed = false;
        for (const sd of [side, -side]) for (const off of [0, 1.5, -1.5, 3, -3]) {
          if (placed) break;
          const px = best.x + best.dx * off - best.dy * 2.2 * sd, py = best.y + best.dy * off + best.dx * 2.2 * sd;
          if (!ok(px, py, 1.6) || !clear(px, py)) continue;
          const g = terrainAt(M, px, py), o = { x: px, y: g - 0.02, z: py, c: 0x6a5a48 }, post = { kind: 'post', i: posts.length, o, x: px, y: py, down: 0, hid: 0, arms: [] };
          posts.push(o); items.push(post);
          [Math.atan2(best.dy, best.dx), Math.atan2(-best.dy, -best.dx)].forEach((a, k) => { post.arms.push(arms.length); arms.push({ x: px, y: g + 1.42 - k * 0.14, z: py, a: -a, c: 0xf2eee2 }); });
          placed = true;
        }
      }
      const grid = new Map();
      items.forEach((it, n) => { const k = (it.y | 0) * W + (it.x | 0); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); });
      scen.roadside = {
        items, spans, grid, arms, dirty: false, occ: -1,
        pm: poles.length ? instanced(sc.tpole, plainTint, poles) : null, mm: miles.length ? instanced(sc.mile, plainTint, miles) : null,
        sm: posts.length ? instanced(sc.signpost, plainTint, posts) : null, am: arms.length ? instanced(sc.arm, plainTint, arms) : null,
      };
    }
    // How a piece of roadside furniture stands: upright, knocked down, or hidden under a building. Telegraph
    // poles stand only once the world has reached the Industrial Age.
    function poseRoadside(it) {
      const R = scen.roadside, hide = !!it.hid || (it.kind === 'pole' && !!R.noPoles), o = it.down ? Object.assign({}, it.o, it.kind === 'mile' ? { rz: 0.7 } : { rx: 1.45, y: it.o.y + 0.06 }) : it.o;
      const mesh = it.kind === 'pole' ? R.pm : it.kind === 'mile' ? R.mm : R.sm;
      setInst(mesh, it.i, o, hide);
      if (it.arms) for (const a of it.arms) setInst(R.am, a, R.arms[a], hide || !!it.down);
      R.dirty = true;
    }
    // The wires between standing poles, two to a span from the crossarm's ends, for the overlay.
    function roadWires() {
      const R = scen && scen.roadside;
      if (!R || R.noPoles) return [];
      const out = [];
      for (const [a, b] of R.spans) {
        if (a.down || b.down || a.hid || b.hid) continue;
        for (const s of [-0.32, 0.32]) {
          const top = p => [p.x - p.dy * s, p.g + 2.53, p.y + p.dx * s];
          out.push([top(a), top(b)]);
        }
      }
      return out;
    }

    // Keeps the changing scenery in step with the rules.
    const fireSpots = [];
    const treePose = (t, st) => st === 1 ? Object.assign({}, t, { y: t.y + 0.05, rx: 1.45, c: colA.set(t.c).multiplyScalar(0.72).getHex() })
      : st === 2 ? Object.assign({}, t, { c: 0x4a3420 })
      : st === 3 ? Object.assign({}, t, { sx: t.s * 0.16, sz: t.s * 0.16, sy: t.s * 0.62, c: 0x0c0a08 })
      : t;
    function updateScenery(dt) {
      if (!scen) return;
      // Trees: standing, flattened by tracks, on fire, or burnt to black sticks.
      updatePlants();
      const T = scen.trees;
      if (T.seen !== S.woodVer) {
        const first = T.seen < 0;
        T.seen = S.woodVer;
        let ch = false;
        T.list.forEach((t, i) => {
          const st = S.wood[t.cell], was = T.state[i];
          if (st === was) return;
          T.state[i] = st; ch = true;
          setInst(t.m, t.i, treePose(t, st));
          if (st === 3) scorch(t.x, t.z, 0.9, 0.5);
          if (st === 1 && !first && VIS(t.x, t.z)) dustPuff(t.x, t.y + 0.3, t.z, 1.2);
        });
        if (ch) T.meshes.forEach(dirty);
      }
      // Flames in the burning trees in sight, and where they are for the overlay's inked flames.
      fireSpots.length = 0;
      for (const b of S.burn) {
        if (fireSpots.length >= 80) break;
        const c = b[0], x = c % W + 0.5, y = (c / W | 0) + 0.5, ids = T.byCell.get(c), t = ids ? T.list[ids[0]] : null;
        if (VIS(x, y)) fireSpots.push(t ? { x: t.x, y: t.y + 1.0 * t.s, z: t.z, s: t.s, c } : { x, y: terrainAt(M, x, y) + 0.4, z: y, s: 0.8, c });
      }
      scen.fireT -= dt;
      if (scen.fireT <= 0 && S.burn.length) {
        scen.fireT = 0.12;
        let n = 0;
        for (const b of S.burn) {
          const c = b[0], x = c % W + 0.5, y = (c / W | 0) + 0.5;
          if (Math.abs(x - cam.x) > cam.dist * 0.8 || Math.abs(y - cam.y) > cam.dist * 0.8 || Math.random() > 0.45 || !VIS(x, y)) continue;
          const ids = T.byCell.get(c), t = ids ? T.list[ids[0]] : { x, y: terrainAt(M, x, y), z: y, s: 1 };
          burn(t.x + (Math.random() - 0.5) * 0.4, t.y + 1.1 * t.s, t.z + (Math.random() - 0.5) * 0.4, 1.1, true);
          if (++n > 14) break;
        }
      }
      // Houses: a ruin is a low broken shell with no roof, its rubble about it.
      scen.houseT -= dt;
      if (scen.houseT <= 0) {
        scen.houseT = 0.25;
        const Hh = scen.houses, first = !Hh.ready;
        Hh.ready = true;
        let ch = false;
        for (let i = 0; i < Hh.ruined.length; i++) {
          const r = S.hh[i] <= 0 ? 1 : 0;
          if (r === Hh.ruined[i]) continue;
          Hh.ruined[i] = r; ch = true;
          const b = Hh.hb[i];
          setInst(Hh.hbm, i, r ? Object.assign({}, b, { sy: b.sy * 0.42, c: 0x7a7064 }) : b);
          setInst(Hh.hrm, i, Hh.hr[i], !!r);
          if (r && !first && VIS(b.x, b.z)) { explosion(b.x, b.y + 0.8, b.z, 1.2, 30); for (let k = 0; k < 5; k++) dustPuff(b.x + (Math.random() - 0.5) * 2, b.y + 0.3, b.z + (Math.random() - 0.5) * 2, 1.6); }
        }
        if (ch) {
          Hh.win.forEach((w, j) => setInst(Hh.wm, j, w, !!Hh.ruined[w.h]));
          Hh.hrub.forEach((o, j) => setInst(Hh.rm, j, o, !Hh.ruined[o.h]));
          dirty(Hh.hbm); dirty(Hh.hrm); dirty(Hh.wm); dirty(Hh.rm);
          for (const X of Object.values(Hh.xm)) { X.list.forEach((o, j) => setInst(X.mesh, j, o, !!Hh.ruined[o.h])); dirty(X.mesh); }
        }
      }
      // Windmill sails turn with the wind, faster the harder it blows.
      const Sm = scen.houses.xm.sails;
      if (Sm) {
        const turn = 0.25 + 0.6 * Math.min(1, Math.hypot(SH.uWind.value.x, SH.uWind.value.y));
        Sm.list.forEach((o, j) => { if (scen.houses.ruined[o.h] || !VIS(o.x, o.z)) return; o.rz = SH.uTime.value * turn + o.ph; setInst(Sm.mesh, j, o); });
        dirty(Sm.mesh);
      }
      // Bridges: a fallen one is two stubs from the banks with its middle in the river.
      const B = scen.bridges;
      M.bridges.forEach((b, i) => {
        const now = S.bridges[i].hp > 0 ? 'up' : 'down';
        if (B.shown[i] === now) return;
        B.shown[i] = now;
        const len = b.len + 2, piece = len * 0.27, off = (len - piece) / 2;
        for (const K of Object.values(B.kinds)) {
          const main = K.dk[i * 2];
          if (now === 'up') { setInst(K.dm, i * 2, main); setInst(K.dm, i * 2 + 1, main, true); }
          else {
            setInst(K.dm, i * 2, Object.assign({}, main, { x: main.x - b.ux * off, z: main.z - b.uy * off, sx: piece, rz: -0.08 }));
            setInst(K.dm, i * 2 + 1, Object.assign({}, main, { x: main.x + b.ux * off, z: main.z + b.uy * off, sx: piece, rz: 0.08 }));
          }
          dirty(K.dm);
        }
        B.lane.forEach((o, j) => { if (o.b === i) setInst(B.lm, j, o, now === 'down' && o.t > 0.22 && o.t < 0.78); });
        B.brub.forEach((o, j) => { if ((j >> 2) === i) setInst(B.bm, j, o, now === 'up'); });
        dirty(B.dm); dirty(B.lm); dirty(B.bm);
      });
      // The fords' stones go under when the river is up.
      // A bridge's lane marks are a modern road's, from the Industrial Age. Its kind is the world's age's.
      B.lm.visible = worldAge() >= MOTOR_AGE;
      const age = worldAge(), kind = age <= 2 ? 'wood' : age === 3 ? 'stone' : age === 4 ? 'iron' : 'concrete';
      if (kind !== B.kind) { B.kind = kind; for (const [k, K] of Object.entries(B.kinds)) { K.dm.visible = k === kind; if (K.pm) K.pm.visible = k === kind; } SH.uBridgeKind.value = ['wood', 'stone', 'iron', 'concrete'].indexOf(kind); }
      updateFields();
      const Fd = scen.fords, under = S.flooded || waterRise.value > 0.12;
      if (Fd.mesh && under !== Fd.under) { Fd.under = under; Fd.list.forEach((o, i) => setInst(Fd.mesh, i, o, under)); dirty(Fd.mesh); }
      // Fences under whatever drives over them.
      const F = scen.fences;
      scen.fenceT -= dt;
      if ((F.rm || scen.roadside) && scen.fenceT <= 0) {
        scen.fenceT = 0.1;
        for (const e of S.ents) if (!e.b && e.hp > 0 && !e.d.men && e.v > 0.3 && !Rules.isAir(e)) flatten(e.x, e.y, e.d.r * 0.9);
      }
      if (F.dirty) { F.dirty = false; dirty(F.rm); dirty(F.pm); }
      // Roadside furniture under a building is hidden while the building stands.
      const RS = scen.roadside;
      if (RS && RS.occ !== S.occVer) {
        RS.occ = S.occVer;
        for (const it of RS.items) { const hid = S.occ[Rules.cellOf(it.x, it.y)] ? 1 : 0; if (hid !== it.hid) { it.hid = hid; poseRoadside(it); } }
      }
      const noPoles = worldAge() < MOTOR_AGE;
      if (RS && RS.noPoles !== noPoles) { RS.noPoles = noPoles; for (const it of RS.items) if (it.kind === 'pole') poseRoadside(it); }
      if (RS && RS.dirty) { RS.dirty = false; for (const m of [RS.pm, RS.mm, RS.sm, RS.am]) if (m) dirty(m); }
    }

    // Life on the land, for the picture alone: deer in the meadows, birds over the woods, cars on the roads,
    // people about the towns and boats on the rivers. Each keeps away from the fighting.
    let life = null;
    const lerpA = (a, b, t) => a + Rules.angleTo(a, b) * Math.min(1, t);
    const openAt = (x, y) => x > 1 && y > 1 && x < W - 1 && y < H - 1 && !(S.gnd[Rules.cellOf(x, y)] & 3) && terrainAt(M, x, y) > M.water + 0.2;
    // The beasts: the model, the colours a herd's members take, how many go together, how far apart, how fast they
    // walk, how fast the herd drifts as it grazes, how fast they run, and their size. A line goes in single file, a
    // pack hunts the grazing herds, and the high keep to the hills and climb what men and horses cannot.
    const BEASTS = {
      deer: { m: 'deer', col: [0x8a6a4c], n: [3, 6], spread: 3.2, walk: 0.9, roam: 0.35, run: 7, s: 0.85 },
      gazelle: { m: 'deer', col: [0xc8a070, 0xd6b486], n: [4, 8], spread: 3.6, walk: 1, roam: 0.4, run: 9, s: 0.68 },
      horse: { m: 'horse', col: [0x6a4a32, 0x3a2a20, 0x8a6a4a, 0xd8ccb8, 0x4a3a2e], n: [4, 7], spread: 4.4, walk: 1.1, roam: 0.45, run: 8.5, s: 1 },
      sheep: { m: 'sheep', col: [0xeee8dc, 0xe4dccc, 0xdcd4c4, 0x3a3430], n: [7, 12], spread: 4, walk: 0.6, roam: 0.25, run: 4, s: 0.78 },
      camel: { m: 'camel', col: [0xc8a070, 0xb8905e, 0xd8b888], n: [2, 4], spread: 1.6, walk: 0.8, roam: 0.3, run: 4.5, s: 1, line: true },
      goat: { m: 'goat', col: [0xe8e0d4, 0x6a5a4a, 0x3a3028, 0xb8a890], n: [3, 6], spread: 2.6, walk: 0.8, roam: 0.3, run: 5.5, s: 0.75, high: true },
      elk: { m: 'elk', col: [0x6a5444, 0x5a4638, 0x7a6450], n: [2, 5], spread: 3.6, walk: 0.9, roam: 0.3, run: 6.5, s: 1.05 },
      wolf: { m: 'wolf', col: [0x8a8478, 0x6a645c, 0xa8a094, 0x4a4640], n: [3, 5], spread: 2.6, walk: 1.3, roam: 0.9, run: 7.5, s: 0.8, pack: true },
    };
    const PREY = new Set(['deer', 'gazelle', 'sheep', 'goat', 'elk']);
    // Where a beast may tread: open ground, and for a climber the steep ground too, but never a cliff or the water.
    const openFor = (B, x, y) => B && B.high ? x > 1 && y > 1 && x < W - 1 && y < H - 1 && !(S.gnd[Rules.cellOf(x, y)] & 2) && terrainAt(M, x, y) > M.water + 0.2 : openAt(x, y);
    // A quiet open place away from bases, towns and buildings, for a climber up in the hills.
    function meadow(loose, high) {
      for (let k = 0; k < 300; k++) {
        const x = 3 + Math.random() * (W - 6), y = 3 + Math.random() * (H - 6);
        if (high && (terrainAt(M, x, y) < (k < 200 ? 4 : 2.5) || (S.gnd[Rules.cellOf(x, y)] & 2))) continue;
        if (!loose && !high && (S.gnd[Rules.cellOf(x, y)] || M.roadDist[Math.round(y * RES) * VW + Math.round(x * RES)] < 3)) continue;
        if (S.bases.some(b => Math.hypot(b[0] - x, b[1] - y) < 30) || M.towns.some(t => Math.hypot(t.x - x, t.y - y) < 12)) continue;
        if (S.ents.some(e => e.b && e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 20)) continue;
        return [x, y];
      }
      return null;
    }
    const newHerd = (p, kind = 'deer') => {
      const B = BEASTS[kind], n = B.n[0] + (Math.random() * (B.n[1] - B.n[0] + 1) | 0);
      return { kind, x: p[0], y: p[1], tx: p[0], ty: p[1], hd: Math.random() * 6.28, flee: 0, fx: 0, fy: 0, wander: 0, hunt: null, rest: 0,
        deer: Array.from({ length: n }, (_, i) => ({ ox: B.line ? -i * B.spread : (Math.random() - 0.5) * B.spread, oy: B.line ? 0 : (Math.random() - 0.5) * B.spread, x: p[0], y: p[1], a: Math.random() * 6.28, v: 0, ph: Math.random() * 6, graze: Math.random() * 6, col: B.col[Math.random() * B.col.length | 0] })) };
    };
    // Ducks in a raft on still or slow water, near enough the bank.
    function duckWater() {
      for (let k = 0; k < 400; k++) {
        const x = 3 + Math.random() * (W - 6), y = 3 + Math.random() * (H - 6), d = M.water - terrainAt(M, x, y);
        if (d > 0.25 && d < 1 && Rules.bridgeAt(S, x, y) < 0) return [x, y];
      }
      return null;
    }
    const newFlock = p => ({ cx: p[0], cy: p[1], x: p[0], y: p[1], r: 4 + Math.random() * 6, alt: 7 + Math.random() * 4, w: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2), t: Math.random() * 9, fly: 0, go: false, vx: 0, vy: 0, n: 5 + (Math.random() * 5 | 0), off: Array.from({ length: 10 }, () => [Math.random() * 6.28, Math.random() * 1.6, Math.random() * 6.28]) });
    function buildLife() {
      const sc = MODELS.scenery, R = Math.random, scale = W / 128;
      const mk = (geo, cap) => {
        const m = lineCat(new THREE.InstancedMesh(geo, plainTint, cap), 0.6);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.count = 0;
        m.setColorAt(0, neutral); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        return add(m);
      };
      life = { herds: [], rafts: [], cars: [], folk: [], boats: [], flocks: [], birds: [], alarm: [], danger: [], rise: [], scanT: 0, beastM: {}, carM: mk(sc.car, 32), cartM: mk(sc.cart, 32), folkM: mk(sc.folk, 400), stallM: mk(sc.stall, 24), fairs: [], boatM: mk(sc.boat, 12), armM: mk(new THREE.BoxGeometry(0.62, 0.035, 0.035), 60) };
      // The theatre's herds by their shares, its wolf packs, and its ducks.
      // The kinds dealt out in proportion to their shares, in a shuffled order, so each comes.
      const deal = (theme.fauna || [['deer', 1]]).flatMap(([k, w]) => Array(w).fill(k)).sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.round(6 * scale); i++) {
        const kind = deal[i % deal.length], p = meadow(false, BEASTS[kind].high);
        if (p) life.herds.push(newHerd(p, kind));
      }
      for (let i = 0; i < Math.round((theme.wolves || 0) * scale); i++) { const p = meadow(); if (p) life.herds.push(newHerd(p, 'wolf')); }
      for (const h of life.herds) { const m = BEASTS[h.kind].m; if (!life.beastM[m]) life.beastM[m] = mk(sc[m], 90); }
      if (theme.ducks) for (let i = 0; i < Math.round(3 * scale); i++) {
        const p = duckWater();
        if (p) life.rafts.push({ x: p[0], y: p[1], a: Math.random() * 6.28, v: 0.12, flee: 0, ph: Math.random() * 6, ducks: Array.from({ length: 4 + (Math.random() * 5 | 0) }, () => ({ ox: (Math.random() - 0.5) * 2.4, oy: (Math.random() - 0.5) * 2.4, a: Math.random() * 6.28, ph: Math.random() * 6, col: Math.random() < 0.5 ? 0x8a7a64 : 0xb0a490 })) });
      }
      if (life.rafts.length) life.beastM.duck = mk(sc.duck, 60);
      for (let i = 0; i < Math.round(3 * scale); i++) { const p = meadow(true); if (p) life.flocks.push(newFlock(p)); }
      // The roads come in pieces that meet at junctions and at the ends of bridges. Each piece knows which others
      // begin or end within a stride of each of its ends, so a car can drive on from one to the next.
      life.roads = M.roads.map(r => { const L = [0]; for (let k = 1; k < r.length; k++) L.push(L[k - 1] + Math.hypot(r[k][0] - r[k - 1][0], r[k][1] - r[k - 1][1])); return { pts: r, L, len: L[L.length - 1], on: [[], []] }; }).filter(r => r.len > 1);
      for (const r of life.roads) for (let e = 0; e < 2; e++) {
        const p = e ? r.pts[r.pts.length - 1] : r.pts[0];
        for (const q of life.roads) if (q !== r) {
          if (Math.hypot(q.pts[0][0] - p[0], q.pts[0][1] - p[1]) < 1.5) r.on[e].push({ r: q, s: 0, dir: 1 });
          const z = q.pts[q.pts.length - 1];
          if (Math.hypot(z[0] - p[0], z[1] - p[1]) < 1.5) r.on[e].push({ r: q, s: q.len, dir: -1 });
        }
      }
      const CARS = [0xb8402e, 0x2f5a8a, 0xe8e0cc, 0x5d7a46, 0x3a3a3a, 0xe0b040], long = life.roads.filter(r => r.len > 14);
      for (let i = 0; i < Math.min(long.length, Math.round(8 * scale)); i++) { const r = long[(i * 7) % long.length]; life.cars.push({ r, s: R() * r.len, dir: R() < 0.5 ? 1 : -1, v: 0, wait: R() * 3, col: CARS[i % CARS.length], x: r.pts[0][0], y: r.pts[0][1], a: 0, turn: false, careless: R() < 0.3 }); }
      M.towns.forEach((t, ti) => { for (let k = 0; k < TOWNFOLK; k++) life.folk.push({ town: ti, x: t.x + (R() - 0.5) * 5, y: t.y + (R() - 0.5) * 5, tx: t.x, ty: t.y, v: 0, wait: R() * 4, hide: 0, col: SHIRTS[(ti * 5 + k) % SHIRTS.length], a: R() * 6.28, ph: R() * 6 }); });
      for (let tries = 0; life.boats.length < Math.round(2 * scale) && tries < 4000; tries++) {
        const x = 2 + R() * (W - 4), y = 2 + R() * (H - 4);
        if (terrainAt(M, x, y) < -1.0 && Rules.bridgeAt(S, x, y) < 0) life.boats.push({ x, y, a: R() * 6.28, v: 1, ph: R() * 6 });
      }
    }
    // Something loud at a point: deer bolt, birds lift, cars turn back, and a town nearby empties for a while.
    function startle(x, y, r) {
      if (!life) return;
      for (const h of life.herds) { const d = Math.hypot(h.x - x, h.y - y); if (d < r + 5 && h.flee < 1) { h.flee = 4 + Math.random() * 3; h.fx = (h.x - x) / (d || 1); h.fy = (h.y - y) / (d || 1); h.hunt = null; } }
      for (const f of life.rafts) { const d = Math.hypot(f.x - x, f.y - y); if (d < r + 8) { f.flee = 4; f.a = Math.atan2(f.y - y, f.x - x); } }
      for (const f of life.flocks) { const d = Math.hypot(f.x - x, f.y - y); if (d < r + 10 && f.fly <= 0) { f.fly = 5 + Math.random() * 2; f.go = false; f.vx = (f.x - x) / (d || 1) * 8; f.vy = (f.y - y) / (d || 1) * 8; } }
      for (const c of life.cars) if (Math.hypot(c.x - x, c.y - y) < r + 7 && Math.cos(c.a) * (x - c.x) + Math.sin(c.a) * (y - c.y) > 0) c.turn = true;
      if (life.alarm.length < 60) life.alarm.push({ x, y, r: r + 6, t: 10 });
    }
    // Two cars meet: both slew round and stop in a cloud of dust and sparks, one now and then on fire, and the
    // drivers of a car that is not burning often get out and fight it out between the wrecks.
    const DRIVER_SHIRTS = [0xf4f0e4, 0x3a3a3a, 0x5a7ab0, 0xc84a3a, 0x8a6a4c];
    const SHIRTS = [0xf4f0e4, 0xc84a3a, 0x5a7ab0, 0xe0c060, 0x7a9a5a, 0xd8a0a0];
    // People living in each town, and how many more come to its market day.
    const TOWNFOLK = 12, FAIR_EXTRA = 24;
    // Market awnings in faded canvas: cream, rust, slate, ochre and sage.
    const STALL_C = [0xe0d6c0, 0xb88a72, 0xa0aab4, 0xc8b88c, 0xa8b098];
    function crash(c, o) {
      const burn = Math.random() < 0.25, R = Math.random;
      for (const [k, q] of [[1, c], [-1, o]]) { q.crash = { t: 22 + R() * 14, spin: k * (0.45 + R() * 0.7), roll: (R() - 0.5) * 0.3, burn: burn && q === c, smokeT: 0 }; q.v = 0; }
      const mx = (c.x + o.x) / 2, my = (c.y + o.y) / 2, g = heightAt(M, mx, my);
      if (VIS(mx, my)) {
        dustBurst(mx, g, my, 0.55);
        for (let i = 0; i < 10; i++) { const a = R() * 6.28, sp = 2 + R() * 3; glow.add(mx, g + 0.4, my, Math.cos(a) * sp, 1.5 + R() * 3, Math.sin(a) * sp, 0.35 + R() * 0.3, 0.06, 0.03, [10, 6, 2, 1], [5, 1.2, 0.1, 0], 9, { grav: -12, drag: 0.8 }); }
      }
      if (burn || R() > 0.7) return;
      const fs = [c, o].map(q => {
        const sd = Math.random() < 0.5 ? 1 : -1, x = q.x - Math.sin(q.a) * 1.1 * sd, y = q.y + Math.cos(q.a) * 1.1 * sd;
        const f = { town: -1, driver: true, x, y, tx: x, ty: y, v: 0, wait: 0, hide: 0, a: q.a, ph: 0, life: 6 + R() * 4, col: DRIVER_SHIRTS[R() * DRIVER_SHIRTS.length | 0] };
        life.folk.push(f);
        return f;
      });
      startBrawl(fs[0], fs[1], 1.2);
    }
    // Two people come to blows: they close, square up and trade swings for a few seconds, until one goes down.
    function startBrawl(a, b, delay = 0) {
      const t = 4 + Math.random() * 4;
      a.brawl = { foe: b, t, ph: 0, lead: true, on: false, delay };
      b.brawl = { foe: a, t, ph: 0, lead: false, on: false, delay };
    }
    function stepBrawl(f, dt) {
      const b = f.brawl, o = b.foe;
      if (!o.brawl || o.brawl.foe !== f) { f.brawl = null; return; }
      if (b.delay > 0) { b.delay -= dt; f.v = 0; return; }
      const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy) || 1e-3;
      f.a = Math.atan2(dy, dx);
      if (!b.on) {
        if (d > 0.8) {
          f.v = 1.8; f.ph += dt * 13;
          const nx = f.x + dx / d * f.v * dt, ny = f.y + dy / d * f.v * dt;
          if (openAt(nx, ny) || f.driver) { f.x = nx; f.y = ny; }
          return;
        }
        b.on = o.brawl.on = true;
      }
      f.v = 0; b.ph += dt;
      if (Math.random() < dt * 2.5 && VIS(f.x, f.y)) { const d2 = dustC(); smoke.add(f.x, heightAt(M, f.x, f.y) + 0.05, f.y, (Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8, 0.8, 0.2, 0.6, [d2[0], d2[1], d2[2], 0.45], [d2[0], d2[1], d2[2], 0], Math.random() * 4 | 0, { drag: 2 }); }
      if (b.lead && (b.t -= dt) <= 0) {
        const lose = Math.random() < 0.5 ? f : o, win = lose === f ? o : f;
        lose.down = 2.5 + Math.random() * 2.5; win.wait = 1.5 + Math.random() * 2;
        f.brawl = o.brawl = null;
      }
    }
    // A town's people turn on soldiers of a side other than the town's own, or, in a town held by nobody, on the
    // side taking it, or on anyone fighting there.
    function townFoe(ti, u) {
      const t = S.towns[ti];
      return t.owner >= 0 ? u.team !== t.owner : t.capTeam >= 0 ? u.team === t.capTeam : true;
    }
    function nearFoe(ti, x, y, r) {
      let best = null, bd = r;
      Rules.near(S, x, y, r, u => { if (u.hp > 0 && !u.b && !Rules.isAir(u) && townFoe(ti, u)) { const d = Math.hypot(u.x - x, u.y - y); if (d < bd) { bd = d; best = u; } } });
      return best;
    }
    // A townsman up in arms runs at the nearest foe and goes at it, with a musket from the Gunpowder Age on and a
    // pitchfork or club before. Nothing he does reaches the rules, but the fire round him may take him, and he
    // lies where he fell. When the fight moves off or his nerve goes, he is back indoors.
    function stepFight(f, dt) {
      const g = f.fight;
      if (g.delay > 0) { g.delay -= dt; f.v = 0; return; }
      g.t -= dt;
      let u = S.byId.get(g.foe);
      if (!u || u.hp <= 0 || Math.hypot(u.x - f.x, u.y - f.y) > 16) { u = nearFoe(f.town, f.x, f.y, 14); g.foe = u ? u.id : 0; }
      if (!u || g.t <= 0) { f.fight = null; f.hide = 4; return; }
      const dx = u.x - f.x, dy = u.y - f.y, d = Math.hypot(dx, dy) || 1e-3, reach = g.gun ? 4.5 : 0.75 + (u.d.r || 0.5);
      f.a = Math.atan2(dy, dx);
      if (d > reach) {
        f.v = 2.2; f.ph += dt * 14; g.swing = 0;
        const nx = f.x + dx / d * f.v * dt, ny = f.y + dy / d * f.v * dt;
        if (openAt(nx, ny)) { f.x = nx; f.y = ny; } else { const sx = f.x - dy / d * f.v * dt, sy = f.y + dx / d * f.v * dt; if (openAt(sx, sy)) { f.x = sx; f.y = sy; } }
      } else {
        f.v = 0; g.swing += dt;
        if ((g.shotT -= dt) <= 0 && VIS(f.x, f.y)) {
          const up = heightAt(M, f.x, f.y) + 0.5, cA = Math.cos(f.a), sA = Math.sin(f.a);
          if (g.gun) {
            g.shotT = 1.4 + Math.random() * 2;
            const mx = f.x + cA * 0.45, my = f.y + sA * 0.45;
            muzzle(mx, up, my, 0.22); inkAdd({ k: 'star', x: mx, y: up, z: my, life: 0.08, s: 0.24 });
            for (let i = 0; i < 2; i++) smoke.add(mx, up, my, cA * (0.6 + i * 0.5), 0.3, sA * (0.6 + i * 0.5), 2, 0.18, 0.8, [2.6, 2.6, 2.5, 0.55], [2.6, 2.6, 2.5, 0], i, { drag: 2.5 });
            streak.add(mx, up, my, u.x + (Math.random() - 0.5) * 0.6, heightAt(M, u.x, u.y) + 0.4, u.y + (Math.random() - 0.5) * 0.6, 0.1, 0.025, FX.bullet);
          } else { g.shotT = 0.5 + Math.random() * 0.5; inkAdd({ k: 'star', x: u.x - cA * 0.3, y: up, z: u.y - sA * 0.3, life: 0.09, s: 0.22 }); }
        }
      }
      // Caught in the fire. Closer in, the likelier.
      if (Math.random() < dt * (d < 3 ? 0.06 : 0.025)) { f.fight = null; f.dead = 30; }
    }
    function roadAt(r, s) {
      s = clamp(s, 0, r.len);
      let k = 1;
      while (k < r.L.length - 1 && r.L[k] < s) k++;
      const a = r.pts[k - 1], b = r.pts[k], t = (s - r.L[k - 1]) / Math.max(1e-6, r.L[k] - r.L[k - 1]);
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), Math.atan2(b[1] - a[1], b[0] - a[0])];
    }
    function stepLife(dt) {
      // The rules' grid of who is where is made by the first step.
      if (!life || !S.hash.length) return;
      const L = life, night = sky.night, storm = sky.storm;
      for (let i = L.alarm.length - 1; i >= 0; i--) { L.alarm[i].t -= dt; if (L.alarm[i].t <= 0) L.alarm.splice(i, 1); }
      // A slower look round for trouble.
      L.scanT -= dt;
      L.scanNow = L.scanT <= 0;
      if (L.scanNow) {
        L.scanT = 0.4;
        for (const h of L.herds) {
          if (h.flee <= 0) {
            let th = null;
            Rules.near(S, h.x, h.y, 14, u => { if (!th && u.hp > 0 && !(u.drop > 0) && !(Rules.isAir(u) && u.z > 4) && Rules.gap(h.x, h.y, u) < (u.b ? 14 : 9)) th = u; });
            if (th) { const d = Math.hypot(h.x - th.x, h.y - th.y) || 1; h.flee = 4 + Math.random() * 3; h.fx = (h.x - th.x) / d; h.fy = (h.y - th.y) / d; }
          }
          // A herd driven among buildings, out of sight, finds somewhere quieter.
          if (!VIS(h.x, h.y) && S.ents.some(e => e.b && e.hp > 0 && Math.hypot(e.x - h.x, e.y - h.y) < 18)) {
            const p = meadow(false, BEASTS[h.kind].high);
            if (p && !VIS(p[0], p[1])) { h.x = h.tx = p[0]; h.y = h.ty = p[1]; h.flee = 0; h.hunt = null; for (const e of h.deer) { e.x = p[0] + e.ox; e.y = p[1] + e.oy; } }
          }
          // A pack not resting goes after a grazing herd it comes near, and a herd that sees it close bolts.
          if (h.kind === 'wolf' && h.flee <= 0) {
            if (!h.hunt && h.rest <= 0) {
              let best = null, bd = 24;
              for (const o of L.herds) if (PREY.has(o.kind)) { const d = Math.hypot(o.x - h.x, o.y - h.y); if (d < bd) { bd = d; best = o; } }
              if (best) h.hunt = { prey: best, t: 9 + Math.random() * 5 };
            }
            const q = h.hunt && h.hunt.prey, d = q ? Math.hypot(q.x - h.x, q.y - h.y) : 99;
            if (q && d < 8 && q.flee <= 0) { q.flee = 5 + Math.random() * 3; q.fx = (q.x - h.x) / (d || 1); q.fy = (q.y - h.y) / (d || 1); }
          }
        }
        L.danger = M.towns.map(t => {
          let d = false;
          Rules.near(S, t.x, t.y, 11, u => { if (!d && u.hp > 0 && !u.b && Math.hypot(u.x - t.x, u.y - t.y) < 11) d = true; });
          return d || L.alarm.some(a => Math.hypot(a.x - t.x, a.y - t.y) < a.r + 6);
        });
        for (const c of L.cars) {
          const ax = c.x + Math.cos(c.a) * 7, ay = c.y + Math.sin(c.a) * 7;
          Rules.near(S, ax, ay, 9, e => { if (e.hp > 0 && (e.b || e.tgt) && Rules.gap(ax, ay, e) < 8) c.turn = true; });
        }
        // When soldiers fight in a town, now and then a few of its people come out with what arms they have and
        // join in. A town rises at most once in a while, and only by day and out of a storm. A town with people
        // gone refills, slowly, once it is quiet.
        const ageNow = Math.max(...S.P.map(P => P.tech));
        M.towns.forEach((t, ti) => {
          L.rise[ti] = Math.max(0, (L.rise[ti] || 0) - 0.4);
          const folk = L.folk.filter(f => f.town === ti);
          if (!L.danger[ti]) {
            if (folk.length < TOWNFOLK && Math.random() < 0.02) L.folk.push({ town: ti, x: t.x, y: t.y, tx: t.x, ty: t.y, v: 0, wait: 2, hide: 0, col: SHIRTS[(ti * 5 + folk.length) % SHIRTS.length], a: Math.random() * 6.28, ph: 0 });
            return;
          }
          if (L.rise[ti] > 0 || night > 0.6 || storm > 0.5) return;
          let fight = false;
          Rules.near(S, t.x, t.y, 14, u => { if (!fight && u.hp > 0 && !u.b && u.tgt && townFoe(ti, u)) fight = true; });
          if (!fight) return;
          L.rise[ti] = 40 + Math.random() * 30;
          if (Math.random() > 0.5) return;
          const up = folk.filter(f => !f.fight && !(f.dead > 0));
          for (const f of up.slice(0, 2 + (Math.random() * 3 | 0))) {
            const u = nearFoe(ti, f.x, f.y, 16);
            if (!u) continue;
            f.hide = 0; f.brawl = null; f.down = 0; f.watch = 0;
            f.fight = { foe: u.id, t: 18 + Math.random() * 14, delay: 0.5 + Math.random() * 2.5, swing: 0, shotT: Math.random(), gun: ageNow >= 3 };
          }
        });
        // Now and then two townsfolk fall out and come to blows, and those near by stop to watch.
        if (night < 0.6 && storm < 0.5) M.towns.forEach((t, ti) => {
          if (L.danger[ti] || Math.random() > 0.4 / 80) return;
          const out = L.folk.filter(f => f.town === ti && !f.brawl && !(f.down > 0) && !(f.hide > 0));
          if (out.length < 2) return;
          const a = out[Math.random() * out.length | 0], rest = out.filter(f => f !== a);
          rest.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
          const b = rest[0];
          startBrawl(a, b);
          for (const f of rest.slice(1)) if (Math.hypot(f.x - a.x, f.y - a.y) < 7) { f.watch = 9; f.watchAt = [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
        });
      }
      // Herds graze, wander a little, and bolt from trouble, each kind at its own pace. A pack roams wide and runs
      // down the herd it hunts until it tires, then rests a while.
      for (const h of L.herds) {
        const B = BEASTS[h.kind], ox0 = h.x, oy0 = h.y;
        h.rest = Math.max(0, h.rest - dt);
        if (h.flee > 0) {
          h.flee -= dt;
          const sp = B.run * 0.78, nx = h.x + h.fx * sp * dt, ny = h.y + h.fy * sp * dt;
          if (openFor(B, nx, ny)) { h.x = nx; h.y = ny; } else { const a = Math.atan2(h.fy, h.fx) + (Math.random() < 0.5 ? 1 : -1) * 1.1; h.fx = Math.cos(a); h.fy = Math.sin(a); }
          h.tx = h.x; h.ty = h.y;
        } else if (h.hunt) {
          const q = h.hunt.prey;
          h.hunt.t -= dt;
          if (h.hunt.t <= 0 || !L.herds.includes(q)) { h.hunt = null; h.rest = 18 + Math.random() * 12; }
          else {
            const dx = q.x - h.x, dy = q.y - h.y, d = Math.hypot(dx, dy) || 1, sp = B.run * 0.7, nx = h.x + dx / d * sp * dt, ny = h.y + dy / d * sp * dt;
            if (d > 1.5 && openFor(B, nx, ny)) { h.x = nx; h.y = ny; }
            h.tx = h.x; h.ty = h.y;
          }
        } else {
          h.wander -= dt;
          if (h.wander <= 0) { h.wander = 6 + Math.random() * 10; const a = Math.random() * 6.28, r = (B.pack ? 6 : 2) + Math.random() * (B.pack ? 12 : 6), tx = h.x + Math.cos(a) * r, ty = h.y + Math.sin(a) * r; if (openFor(B, tx, ty)) { h.tx = tx; h.ty = ty; } }
          const dx = h.tx - h.x, dy = h.ty - h.y, d = Math.hypot(dx, dy);
          if (d > 0.1) { h.x += dx / d * Math.min(d, B.roam * dt); h.y += dy / d * Math.min(d, B.roam * dt); }
        }
        if (Math.hypot(h.x - ox0, h.y - oy0) > 1e-3) h.hd = lerpA(h.hd, Math.atan2(h.y - oy0, h.x - ox0), dt * 2);
        const run = h.flee > 0 || !!h.hunt, ch = Math.cos(h.hd), sh = Math.sin(h.hd);
        for (const e of h.deer) {
          // A line's places trail along the way the herd goes; the rest stand about it as they please.
          const px = B.line ? h.x + e.ox * ch - e.oy * sh : h.x + e.ox, py = B.line ? h.y + e.ox * sh + e.oy * ch : h.y + e.oy;
          const dx = px - e.x, dy = py - e.y, d = Math.hypot(dx, dy), want = run ? Math.min(B.run, d * 3 + B.run * 0.64) : d > 0.6 ? B.walk : 0;
          e.v += (want - e.v) * Math.min(1, dt * 3);
          if (d > 0.05 && e.v > 0.05) {
            e.a = lerpA(e.a, Math.atan2(dy, dx), dt * 5);
            const nx = e.x + Math.cos(e.a) * e.v * dt, ny = e.y + Math.sin(e.a) * e.v * dt;
            if (openFor(B, nx, ny)) { e.x = nx; e.y = ny; }
          }
          e.ph += dt * (run ? 13 : 3) * (B.run > 8 ? 1.1 : B.run < 5 ? 0.8 : 1); e.graze += dt;
        }
        // Each keeps a body's room from the next.
        const room = 0.75 * B.s;
        for (let i = 0; i < h.deer.length; i++) for (let j = i + 1; j < h.deer.length; j++) {
          const a = h.deer[i], b = h.deer[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d < room && d > 1e-4) { const k = (room - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
        }
      }
      // Ducks paddle about their water, turn from the bank, and make off from trouble.
      for (const f of L.rafts) {
        f.flee = Math.max(0, f.flee - dt);
        const sp = f.flee > 0 ? 1.4 : 0.12, ahead = M.water - terrainAt(M, f.x + Math.cos(f.a) * 2.5, f.y + Math.sin(f.a) * 2.5);
        if (ahead < 0.25 || Rules.bridgeAt(S, f.x + Math.cos(f.a) * 2.5, f.y + Math.sin(f.a) * 2.5) >= 0) f.a += 1.6 * dt;
        else if (Math.random() < dt * 0.1) f.a += (Math.random() - 0.5) * 1.5;
        const nx = f.x + Math.cos(f.a) * sp * dt, ny = f.y + Math.sin(f.a) * sp * dt;
        if (M.water - terrainAt(M, nx, ny) > 0.2) { f.x = nx; f.y = ny; }
        f.ph += dt;
        if (L.scanNow) Rules.near(S, f.x, f.y, 7, u => { if (u.hp > 0 && f.flee <= 0 && Math.hypot(u.x - f.x, u.y - f.y) < 6) { f.flee = 4; f.a = Math.atan2(f.y - u.y, f.x - u.x); } });
      }
      // Cars run up and down the roads, stop for what is in the way, and turn back from fighting and broken bridges.
      // On a bridge a car drives on to the end rather than turning, and one blocked for long turns back.
      // A car coming up behind a slower one brakes for it, and a careless driver runs into it. Two passing head on
      // now and then swerve into each other. A wreck stands a while, smoking if it burns, and is then towed away.
      for (const c of L.cars) {
        if (c.crash || c.wait > 0 || !(c.v > 0.5)) continue;
        for (const o of L.cars) {
          if (o === c) continue;
          const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy);
          if (d > 2.4 || d < 1e-3 || (dx * Math.cos(c.a) + dy * Math.sin(c.a)) / d < 0.6) continue;
          const same = Math.cos(o.a - c.a);
          if (same > 0.5) { if (d < 1.3 && c.v > 1.2 && c.careless) crash(c, o); else c.brake = true; }
          else if (same < -0.5 && d < 1.5 && !o.crash && !(c.met && c.met.get(o) > SH.uTime.value - 5)) {
            (c.met || (c.met = new Map())).set(o, SH.uTime.value); (o.met || (o.met = new Map())).set(c, SH.uTime.value);
            if (Math.random() < 0.12) crash(c, o);
          }
          if (c.crash) break;
        }
      }
      for (const c of L.cars) {
        if (c.crash) {
          const k = c.crash; k.t -= dt; c.v = 0;
          if (k.burn && VIS(c.x, c.y) && (k.smokeT -= dt) <= 0) {
            k.smokeT = 0.22;
            const g = heightAt(M, c.x, c.y), R = Math.random;
            glow.add(c.x + (R() - 0.5) * 0.4, g + 0.35, c.y + (R() - 0.5) * 0.4, (R() - 0.5) * 0.3, 1.1, (R() - 0.5) * 0.3, 0.55, 0.35, 0.9, [4, 1.7, 0.35, 1], [1.2, 0.25, 0.03, 0], 8, { drag: 1 });
            smoke.add(c.x, g + 0.6, c.y, 0.2 + (R() - 0.5) * 0.3, 0.9 + R() * 0.5, (R() - 0.5) * 0.3, 2.6, 0.4, 1.6, [0.1, 0.09, 0.08, 0.7], [0.3, 0.29, 0.28, 0], R() * 4 | 0, { drag: 0.4 });
          }
          if (k.t <= 0) {
            const rs = L.roads.filter(q => q.len > 14), r = rs[Math.floor(Math.random() * rs.length)], s2 = Math.random() * r.len, [rx, ry] = roadAt(r, s2);
            Object.assign(c, { r, s: s2, x: rx, y: ry, dir: Math.random() < 0.5 ? 1 : -1, v: 0, wait: 15 + Math.random() * 20, turn: false, held: 0, crash: null });
          }
          continue;
        }
        if (c.wait > 0) { c.wait -= dt; c.v = 0; continue; }
        const [x, y, a] = roadAt(c.r, c.s), ah = c.dir > 0 ? a : a + Math.PI;
        c.x = x + Math.sin(ah) * 0.55; c.y = y - Math.cos(ah) * 0.55; c.a = ah;
        const [nx, ny] = roadAt(c.r, c.s + c.dir * 1.6), onBridge = Rules.bridgeAt(S, x, y) >= 0;
        // A car on a bridge that falls goes with it, and comes back on another road later.
        if (onBridge && heightAt(M, x, y) < M.water + 0.3) {
          const rs = L.roads.filter(q => q.len > 14), r = rs[Math.floor(Math.random() * rs.length)], s2 = Math.random() * r.len, [rx, ry] = roadAt(r, s2);
          Object.assign(c, { r, s: s2, x: rx, y: ry, dir: Math.random() < 0.5 ? 1 : -1, v: 0, wait: 20 + Math.random() * 20, turn: false, held: 0 });
          continue;
        }
        if (!onBridge && (c.turn || heightAt(M, nx, ny) < M.water + 0.3)) { c.turn = false; c.dir *= -1; c.wait = 1 + Math.random() * 2; continue; }
        c.turn = false;
        let block = false;
        const bx = c.x + Math.cos(ah) * 2, by = c.y + Math.sin(ah) * 2;
        Rules.near(S, bx, by, 2.6, u => { if (u.hp > 0 && !u.b && !Rules.isAir(u) && Math.hypot(u.x - bx, u.y - by) < 2.2) block = true; });
        if (c.brake) { block = true; c.brake = false; }
        c.held = block ? (c.held || 0) + dt : 0;
        if (c.held > 6 && !onBridge) { c.held = 0; c.dir *= -1; c.wait = 1 + Math.random() * 2; continue; }
        c.v += ((block ? 0 : worldAge() < MOTOR_AGE ? 1.6 : 3.4) - c.v) * Math.min(1, dt * (block ? 6 : 1.4));
        c.s += c.dir * c.v * dt;
        if (c.s <= 0 || c.s >= c.r.len) {
          // At the end of a piece a car drives on along one that joins it, and only turns back at a dead end.
          const on = c.r.on[c.s <= 0 ? 0 : 1], over = Math.max(0, c.s <= 0 ? -c.s : c.s - c.r.len);
          if (on.length) { const j = on[Math.floor(Math.random() * on.length)]; c.r = j.r; c.dir = j.dir; c.s = clamp(j.s + j.dir * over, 0, j.r.len); }
          else { c.s = clamp(c.s, 0, c.r.len); c.dir *= -1; c.wait = 2 + Math.random() * 4; }
        }
      }
      // Townsfolk stroll between the houses and go indoors when soldiers come, at night and in a storm.
      for (const f of L.folk) {
        if (f.dead > 0) { f.v = 0; if ((f.dead -= dt) <= 0) f.gone = true; continue; }
        if (f.fight) { stepFight(f, dt); continue; }
        if (!f.driver) {
          const inside = L.danger[f.town] || night > 0.6 || storm > 0.5;
          if (f.hide > 0 || inside) { f.hide = inside ? Math.max(f.hide, 4) : f.hide - dt; f.brawl = null; f.down = 0; f.watch = 0; continue; }
        }
        if (f.down > 0) { f.down -= dt; f.v = 0; continue; }
        if (f.brawl) { stepBrawl(f, dt); continue; }
        // A driver stands by the wreck a little after the fight, then is gone with it.
        if (f.driver) { f.v = 0; if ((f.life -= dt) <= 0) f.gone = true; continue; }
        if (f.watch > 0) { f.watch -= dt; f.v = 0; f.a = Math.atan2(f.watchAt[1] - f.y, f.watchAt[0] - f.x); continue; }
        const t = M.towns[f.town], fair = L.fairs.find(q => q.town === f.town), park = parks.find(q => q.town === f.town);
        if (f.wait > 0) { f.wait -= dt; f.v = 0; if (fair) f.a = lerpA(f.a, Math.atan2(fair.y - f.y, fair.x - f.x), dt); continue; }
        const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
        if (d < 0.3) {
          f.wait = 2 + Math.random() * 6;
          // On a market day the town comes to the park and mills about the stalls; otherwise a stroll about the
          // houses, or now and then in the park.
          const P = fair || (park && Math.random() < 0.3 ? park : null), cx = P ? P.x : t.x, cy = P ? P.y : t.y, rr = P ? (fair ? 1.2 + Math.random() * 3.2 : 1 + Math.random() * P.r * 0.8) : 1.5 + Math.random() * 6.5;
          for (let k = 0; k < 10; k++) { const a = Math.random() * 6.28, r = k ? rr : rr, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (openAt(x, y)) { f.tx = x; f.ty = y; break; } }
          continue;
        }
        f.v = 0.8; f.a = Math.atan2(dy, dx); f.ph += dt * 8;
        const nx = f.x + dx / d * f.v * dt, ny = f.y + dy / d * f.v * dt;
        if (openAt(nx, ny)) { f.x = nx; f.y = ny; } else { f.tx = f.x; f.ty = f.y; }
      }
      if (L.folk.some(f => f.gone)) L.folk = L.folk.filter(f => !f.gone);
      // Market days. Now and then, by day and in peace, a town with a park holds a market there for a few minutes:
      // stalls go up round the fountain, its people crowd in, and more come from round about. Trouble ends it at once.
      for (let i = L.fairs.length - 1; i >= 0; i--) { const q = L.fairs[i]; q.t -= dt; if (q.t <= 0 || L.danger[q.town] || night > 0.6 || storm > 0.5) L.fairs.splice(i, 1); }
      if (night < 0.4 && storm < 0.3 && Math.random() < dt / 70) {
        const free = parks.filter(p => !L.danger[p.town] && !L.fairs.some(q => q.town === p.town));
        const p = free[Math.random() * free.length | 0];
        if (p) {
          const ns = 4 + (Math.random() * 3 | 0);
          L.fairs.push({ town: p.town, x: p.x, y: p.y, t: 90 + Math.random() * 90, stalls: Array.from({ length: ns }, (_, k) => ({ a: p.a + k / ns * 6.28 + 0.3, col: STALL_C[k % STALL_C.length] })) });
          const t = M.towns[p.town];
          for (let k = 0; k < FAIR_EXTRA; k++) L.folk.push({ town: p.town, visitor: 120 + Math.random() * 60, x: t.x + (Math.random() - 0.5) * 8, y: t.y + (Math.random() - 0.5) * 8, tx: p.x, ty: p.y, v: 0, wait: Math.random() * 3, hide: 0, col: SHIRTS[(k * 7) % SHIRTS.length], a: Math.random() * 6.28, ph: Math.random() * 6 });
        }
      }
      // Visitors go home when the market ends.
      for (const f of L.folk) if (f.visitor) { f.visitor -= dt; if (f.visitor <= 0 || !L.fairs.some(q => q.town === f.town)) f.gone = true; }
      // Boats keep to deep water, turning from the shallows, the fords and the banks.
      for (const b of L.boats) {
        const ahead = da => terrainAt(M, b.x + Math.cos(b.a + da) * 2.2, b.y + Math.sin(b.a + da) * 2.2);
        if (ahead(0) > -0.75) { b.a += (ahead(0.6) < ahead(-0.6) ? 1 : -1) * 1.5 * dt; b.v = Math.max(0.3, b.v - dt); }
        else b.v += (1.1 - b.v) * dt;
        const nx = b.x + Math.cos(b.a) * b.v * dt, ny = b.y + Math.sin(b.a) * b.v * dt;
        if (terrainAt(M, nx, ny) < -0.5) { b.x = nx; b.y = ny; } else b.a += 2 * dt;
        b.ph += dt;
      }
      // Birds wheel over one place, scatter at a noise, and settle somewhere else.
      L.birds.length = 0;
      for (const f of L.flocks) {
        f.t += dt;
        if (f.fly > 0) {
          f.fly -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.alt = Math.min(15, f.alt + dt * 2);
          if (f.fly <= 0 || f.x < 0 || f.y < 0 || f.x > W || f.y > H) { f.fly = 0; const p = meadow(true) || [W / 2, H / 2]; f.tx = p[0]; f.ty = p[1]; f.go = true; }
        } else if (f.go) {
          const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
          if (d < 1) { f.go = false; f.cx = f.x; f.cy = f.y; } else { f.x += dx / d * 6 * dt; f.y += dy / d * 6 * dt; }
          f.alt += (8 - f.alt) * dt * 0.3;
        } else { f.x = f.cx; f.y = f.cy; }
        if (night > 0.5 || storm > 0.5) continue;
        const moving = f.fly > 0 || f.go, hd = f.fly > 0 ? Math.atan2(f.vy, f.vx) : Math.atan2(f.ty - f.y, f.tx - f.x);
        for (let i = 0; i < f.n; i++) {
          const o = f.off[i];
          let bx, by;
          if (moving) { bx = f.x + Math.cos(o[0]) * (0.6 + o[1]) * 1.4; by = f.y + Math.sin(o[0]) * (0.6 + o[1]) * 1.4; }
          else { const an = f.t * f.w + o[0]; bx = f.cx + Math.cos(an) * (f.r + o[1]); by = f.cy + Math.sin(an) * (f.r + o[1]); }
          const dir = moving ? hd : f.t * f.w + o[0] + Math.sign(f.w) * 1.57;
          L.birds.push({ x: bx, y: f.alt + Math.sin(f.t * 0.7 + o[2]) * 0.6, z: by, flap: f.t * (moving ? 16 : 7) + o[2] * 3, dir });
        }
      }
      drawLife();
    }
    function drawLife() {
      const L = life;
      let n = 0;
      const used = {};
      for (const k in L.beastM) used[k] = 0;
      for (const h of L.herds) {
        const B = BEASTS[h.kind], BM = L.beastM[B.m], run = h.flee > 0 || !!h.hunt;
        for (const e of h.deer) {
          if (used[B.m] >= 90 || !VIS(e.x, e.y)) continue;
          const g = heightAt(M, e.x, e.y), bound = run ? Math.abs(Math.sin(e.ph)) * 0.22 * B.s : 0;
          const nod = run ? Math.sin(e.ph) * 0.12 : e.v < 0.2 && !B.pack ? -0.34 * smooth(0.2, 0.8, Math.sin(e.graze * 0.5) * 0.5 + 0.5) : 0;
          compose(m1, e.x, g + bound, e.y, -e.a, nod, 0, B.s);
          BM.setMatrixAt(used[B.m], m1); BM.setColorAt(used[B.m], colA.set(e.col)); used[B.m]++;
        }
      }
      for (const f of L.rafts) for (const d of f.ducks) {
        if (used.duck >= 60) break;
        const x = f.x + d.ox, y = f.y + d.oy;
        if (!VIS(x, y) || M.water - terrainAt(M, x, y) < 0.1) continue;
        d.a = lerpA(d.a, f.a + Math.sin(f.ph * 0.7 + d.ph) * 0.6, 0.05);
        compose(m1, x, M.water + waterRise.value + 0.02 + Math.sin(f.ph * 2 + d.ph) * 0.015, y, -d.a, 0, 0, 1);
        L.beastM.duck.setMatrixAt(used.duck, m1); L.beastM.duck.setColorAt(used.duck, colA.set(d.col)); used.duck++;
      }
      for (const k in L.beastM) { L.beastM[k].count = used[k]; dirty(L.beastM[k]); }
      n = 0;
      // Motor cars from the Industrial Age, horse carts before it.
      const motor = worldAge() >= MOTOR_AGE, CM = motor ? L.carM : L.cartM;
      for (const c of L.cars) {
        if (n >= 32 || !VIS(c.x, c.y)) continue;
        const k = c.crash;
        compose(m1, c.x, heightAt(M, c.x, c.y) + 0.02, c.y, -(c.a + (k ? k.spin : 0)), 0, k ? k.roll : 0, 0.9);
        colA.set(motor ? c.col : 0xffffff);
        if (k && k.burn) colA.multiplyScalar(0.3);
        CM.setMatrixAt(n, m1); CM.setColorAt(n, colA); n++;
      }
      CM.count = n; dirty(CM);
      (motor ? L.cartM : L.carM).count = 0;
      n = 0;
      let na = 0;
      for (const f of L.folk) {
        if (n >= 400 || !VIS(f.x, f.y)) continue;
        if (!f.fight && !(f.dead > 0) && (f.hide > 0 || L.danger[f.town])) continue;
        let px = f.x, py = f.y, lean = 0, roll = 0, hop = f.v > 0 ? Math.abs(Math.sin(f.ph)) * 0.03 : 0;
        // Arms carried at the port, run with, and swung or levelled at the foe.
        if (f.fight && na < 60) {
          const g = f.fight, k = g.gun ? 0 : Math.max(0, Math.sin(g.swing * 9));
          const tilt = g.delay > 0 ? 1.1 : f.v > 0 ? 0.7 : g.gun ? 0.05 : 0.9 - k * 1.1;
          if (!g.gun && f.v === 0) { px += Math.cos(f.a) * k * 0.1; py += Math.sin(f.a) * k * 0.1; lean = -k * 0.3; }
          compose(m1, px + Math.cos(f.a) * 0.1, heightAt(M, px, py) + 0.45 + hop, py + Math.sin(f.a) * 0.1, -f.a, tilt, 0, 1);
          L.armM.setMatrixAt(na, m1); L.armM.setColorAt(na, colA.set(g.gun ? 0x3a2e24 : 0x7a5a3a)); na++;
        }
        if (f.dead > 0) roll = 1.45;
        // A swing throws the body forward and back, with a little bounce on the feet.
        if (f.brawl && f.brawl.on) {
          const k = Math.max(0, Math.sin(f.brawl.ph * 7 + (f.brawl.lead ? 0 : 2.2)));
          px += Math.cos(f.a) * k * 0.14; py += Math.sin(f.a) * k * 0.14; lean = -k * 0.4; hop = Math.abs(Math.sin(f.brawl.ph * 5)) * 0.04;
        }
        // Down on the ground, and getting up in the last half second.
        if (f.down > 0) roll = 1.45 * Math.min(1, f.down / 0.5);
        compose(m1, px, heightAt(M, px, py) + hop, py, -f.a, lean, roll, 1);
        L.folkM.setMatrixAt(n, m1); L.folkM.setColorAt(n, colA.set(f.col)); n++;
      }
      L.folkM.count = n; dirty(L.folkM);
      // The stalls of a market day, round the park's fountain.
      let ns = 0;
      for (const q of L.fairs) for (const s of q.stalls) {
        if (ns >= 24) break;
        const p = parks.find(o => o.town === q.town), rr = p ? p.r * 0.3 + 0.6 : 2, x = q.x + Math.cos(s.a) * rr, y = q.y + Math.sin(s.a) * rr;
        if (!VIS(x, y)) continue;
        compose(m1, x, heightAt(M, x, y), y, -s.a + Math.PI / 2, 0, 0, 0.75);
        L.stallM.setMatrixAt(ns, m1); L.stallM.setColorAt(ns, colA.set(s.col)); ns++;
      }
      L.stallM.count = ns; dirty(L.stallM);
      L.armM.count = na; dirty(L.armM);
      n = 0;
      for (const b of L.boats) {
        if (n >= 12 || !VIS(b.x, b.y)) continue;
        compose(m1, b.x, M.water + waterRise.value + 0.04 + Math.sin(b.ph * 2.1) * 0.02, b.y, -b.a, 0, Math.sin(b.ph * 1.3) * 0.05, 1);
        L.boatM.setMatrixAt(n, m1); L.boatM.setColorAt(n, colA.set(0xf4efe2)); n++;
      }
      L.boatM.count = n; dirty(L.boatM);
    }

    // The sky: weather from the rules, eased so a change comes over a few seconds, and the hour.
    const sky = { clear: 1, rain: 0, storm: 0, fog: 0, snow: 0, sand: 0, cloud: 0, cover: 0, flood: 0, wet: 0, cloudA: 0, cloudG: 0, rayK: 0, night: 0, mist: 0, day: 0.3, kind: 'clear', windS: 0, sun: [0, 1, 0], mul: [1, 1, 1], add: [0, 0, 0] };
    const DAY = [
      // time of day, colour multiplied, colour added, night
      [0.00, [1.0, 0.92, 0.93], [0.02, 0.0, 0.02], 0.2],
      [0.07, [1.0, 0.98, 0.97], [0, 0, 0], 0],
      [0.4, [1, 1, 1], [0, 0, 0], 0],
      [0.62, [1.02, 0.99, 0.94], [0.01, 0.004, 0], 0],
      [0.72, [1.04, 0.95, 0.86], [0.02, 0.006, 0], 0],
      [0.79, [0.99, 0.88, 0.88], [0.02, 0.0, 0.02], 0.3],
      [0.85, [1, 1, 1], [0, 0, 0], 1],
      [0.94, [1, 1, 1], [0, 0, 0], 1],
      [1.0, [1.0, 0.92, 0.93], [0.02, 0.0, 0.02], 0.2],
    ];
    // The sun climbs from the east at dawn and sets in the west at dusk. By night the moon stands still.
    function sunAt(d) {
      const t = clamp(d / 0.8, 0, 1), s = SUN(-2.0 + t * 2.9, 0.12 + 0.8 * Math.sin(Math.PI * t)), moon = SUN(0.4, 0.8), dawn = SUN(-2.0, 0.12);
      const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
      return d < 0.8 ? s : d < 0.86 ? mix3(s, moon, (d - 0.8) / 0.06) : d < 0.95 ? moon : mix3(moon, dawn, (d - 0.95) / 0.05);
    }
    const right3 = new THREE.Vector3();
    // For studies, weather and an hour laid over the picture alone.
    let studySky = null;
    function updateSky(dt) {
      if (!S) return;
      const w = studySky ? Object.assign({}, Rules.sky(S), studySky) : Rules.sky(S), k = studySky ? 1 : 1 - Math.exp(-dt * 0.8);
      for (const key of ['clear', 'rain', 'storm', 'fog', 'snow', 'sand', 'cloud', 'cover', 'flood']) sky[key] += (w[key] - sky[key]) * k;
      const shw = Rules.showersAt(S);
      for (let i = 0; i < 4; i++) { const s = shw[i]; SH.uShow.value[i].set(s ? s.x : 0, s ? s.y : 0, s ? s.r : 0, s ? (s.kind === 'snow' ? -s.k : s.k) : 0); }
      sky.kind = w.kind;
      // The ground stays wet a while after the rain.
      sky.wet += ((w.rain > 0.2 ? 1 : 0) - sky.wet) * (studySky ? 1 : 1 - Math.exp(-dt * (w.rain > 0.2 ? 0.15 : 0.012)));
      const U = SH.uWind.value;
      U.x += (w.wind[0] - U.x) * k; U.y += (w.wind[1] - U.y) * k;
      SH.uCloud.value.x += (U.x * 0.008 + 0.0004) * dt; SH.uCloud.value.y += U.y * 0.008 * dt;
      SH.uCloudK.value = clamp(0.35 + 0.45 * sky.cloud + 0.6 * sky.rain + 0.2 * sky.fog + 0.3 * sky.snow + 0.2 * sky.sand, 0, 1);
      // How much of the sky the clouds cover: a few in fair weather, broken cloud when overcast, a lid in rain.
      SH.uCloudT.value = clamp(0.2 + 0.18 * sky.cloud + 0.3 * sky.rain + 0.1 * sky.fog + 0.22 * sky.snow + 0.05 * sky.sand, 0.15, 0.55);
      SH.uSnowC.value = sky.cover;
      waterRise.value = Math.min(1.25, sky.flood) * 0.26;
      right3.setFromMatrixColumn(camera.matrixWorld, 0);
      sky.windS = right3.x * U.x + right3.z * U.y;
      // The hour. Pen and ink follows it; the painted looks keep their own light.
      const d = sky.day = studySky && studySky.day !== undefined ? studySky.day : Rules.dayAt(S.tick);
      let i = 0;
      while (i < DAY.length - 2 && DAY[i + 1][0] <= d) i++;
      const a = DAY[i], b = DAY[i + 1], f = smooth(a[0], b[0], d);
      sky.mul = [0, 1, 2].map(j => lerp(a[1][j], b[1][j], f)); sky.add = [0, 1, 2].map(j => lerp(a[2][j], b[2][j], f));
      sky.night = lerp(a[3], b[3], f);
      // Mist in the low ground at first light, burnt off by mid morning, and gone in rain or a strong wind.
      sky.mist = Math.max(1 - smooth(0.05, 0.17, d), smooth(0.9, 1.0, d) * 0.6) * (1 - 0.7 * sky.rain) * (1 - 0.4 * Math.min(1, Math.hypot(U.x, U.y)));
      // The look's own sun, or its light's, or the hour's.
      sky.sun = style.sun ? style.sun({ cam, day: d, light, SUN, sunAt }) : light ? light.sun : sunAt(d);
      // The clouds as seen from above, see-through, greyer as the weather worsens and hidden in fog or blown sand.
      sky.cloudA = clamp(0.42 + 0.15 * sky.cloud + 0.15 * sky.rain + 0.1 * sky.snow - 0.35 * sky.fog - 0.3 * sky.sand, 0, 0.5) * (1 - 0.5 * sky.night);
      sky.cloudG = clamp(sky.rain + 0.5 * sky.storm + 0.3 * sky.snow, 0, 1);
      // Shafts of sun through gaps in broken cloud, longest and strongest with the sun low, none by night.
      const up = sky.sun[1] / Math.hypot(...sky.sun), sunUp = clamp(up * 4, 0, 1) * (1 - 0.45 * smooth(0.55, 0.9, up)) * (1 - sky.night);
      sky.rayK = sunUp * clamp(0.5 * sky.clear + sky.cloud + 0.25 * sky.rain - 0.8 * sky.fog - 0.8 * sky.sand - 0.3 * sky.storm, 0, 1);
    }

    function buildSets() {
      // A part another model shares, as legs of one make and wooden wheels are, draws into one mesh for all of them,
      // through a stand-in that keeps the model's own description of the part.
      const shared = {};
      const put = (key, parts, cap) => {
        sets[key] = parts.map(p => {
          if (p.share && shared[p.share]) { const o = shared[p.share]; return { def: p, get mesh() { return o.mesh; }, get n() { return o.n; }, set n(v) { o.n = v; }, get cap() { return o.cap; } }; }
          const n = p.share ? 3000 : cap * (p.mult || 1), mesh = new THREE.InstancedMesh(p.geo, paint, n);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.count = 0;
          mesh.setColorAt(0, neutral); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
          scene.add(mesh);
          lineCat(mesh, MODELS.buildings[key] || key === 'rubble' ? 0.75 : 1);
          const o = { def: p, mesh, n: 0, cap: n };
          if (p.share) shared[p.share] = o;
          return o;
        });
        sets[key].gait = parts.gait;
      };
      for (const k in MODELS.units) put(k, MODELS.units[k], k === 'plane' ? 4 : 72);
      for (const k in MODELS.buildings) put(k, MODELS.buildings[k], 24);
      for (const k in MODELS.man) put('man' + k, MODELS.man[k].map(p => Object.assign({}, p, { mult: p.id === 'leg' ? 2 : 1 })), UNITS[k] && UNITS[k].line === 'inf' ? 300 : k === 'hero' ? 8 : 120);
      put('chute', [{ id: 'c', geo: MODELS.chute }], 24);
      put('rubble', [{ id: 'r', geo: MODELS.scenery.rubble }], 700);
      // Arrows, thrown stones and strokes of the pen, drawn in line as units are. Strokes cast no shadow.
      put('arrow', [{ id: 'a', geo: MODELS.fx.arrow }], 500);
      put('ball', [{ id: 'b', geo: MODELS.fx.ball }], 80);
      put('stroke', [{ id: 's', geo: MODELS.fx.stroke }], 1600);
      put('tstroke', [{ id: 's', geo: MODELS.fx.tstroke }], 1600);
      sets.stroke[0].mesh.castShadow = sets.tstroke[0].mesh.castShadow = false;
    }

    // Each look may bring its own light, in place of the theatre's.
    let light = null;
    function applyLight() {
      if (!theme) return;
      const L = light = style.light ? style.light(theme, SUN) : theme;
      sun.color.set(L.sunColor); sun.intensity = L.sunPower;
      sun.position.set(...L.sun);
      hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2];
      scene.environment = skyEnv(L);
      SH.uHaze.value.set(L.haze); SH.uHazeK.value = L.hazeK; SH.uSunDir.value.set(...L.sun).normalize();
      pp.grade.uniforms.uGlowC.value.set(L.sunColor); pp.grade.uniforms.uVivid.value = style.vivid;
      if (waterMesh) {
        const u = waterMesh.material.uniforms;
        u.uSun.value.set(...L.sun).normalize(); u.uSunC.value.set(L.sunColor); u.uSky.value.set(L.env[1]); u.uZen.value.set(L.env[0]);
      }
    }

    function load(state, themeName, team) {
      clearWorld();
      S = state; M = S.map; theme = THEMES[themeName] || THEMES.desert; viewTeam = team;
      Rules.setSize(M.W);
      W = M.W; H = M.H; VW = Rules.VW; VH = Rules.VH; CX = W / 2; CY = H / 2;
      SH.uMap.value = W;
      SH.uTeam0.value.copy(teamCol[Math.max(0, team)]).offsetHSL(0, 0, 0.06);
      SH.uFogOn.value = team < 0 ? 0 : 1;
      applyLight();
      SH.uShroud.value.set(theme.shroud);
      // Snow lies only on a map with mountains: a hilltop or two just over the line would read as ponds.
      let over = 0;
      if (theme.snow !== undefined) for (let i = 0; i < M.h.length; i++) over += M.h[i] > theme.snow;
      SH.uSnowLine.value = over > M.h.length * 0.015 ? theme.snow : 99;
      SH.uFlora.value = theme.tree === 'broad' ? 1 : theme.tree === 'acacia' ? 2 : 3;
      renderer.setClearColor(theme.shroud, 1);

      fogData = new Uint8Array(W * H * 4); fogR = new Float32Array(W * H); fogG = new Float32Array(W * H);
      if (fogTex) fogTex.dispose();
      fogTex = new THREE.DataTexture(fogData, W, H, THREE.RGBAFormat);
      fogTex.magFilter = fogTex.minFilter = THREE.LinearFilter; fogTex.wrapS = fogTex.wrapT = THREE.ClampToEdgeWrapping; fogTex.needsUpdate = true;
      SH.tFog.value = fogTex;
      terrData = new Uint8Array(W * H * 4);
      if (terrTex) terrTex.dispose();
      terrTex = new THREE.DataTexture(terrData, W, H, THREE.RGBAFormat);
      terrTex.magFilter = terrTex.minFilter = THREE.LinearFilter; terrTex.needsUpdate = true;
      SH.tTerr.value = terrTex; terrSeen = -1;
      trailData = new Uint8Array(W * H * 4);
      if (trailTex) trailTex.dispose();
      trailTex = new THREE.DataTexture(trailData, W, H, THREE.RGBAFormat);
      trailTex.magFilter = trailTex.minFilter = THREE.LinearFilter; trailTex.needsUpdate = true;
      SH.tTrail.value = trailTex; trailT = 0;

      const mk = low ? 512 : 1024;
      if (!marks) { marks = document.createElement('canvas'); marks.width = marks.height = mk; marks.ctx = marks.getContext('2d'); marksTex = new THREE.CanvasTexture(marks); marksTex.magFilter = THREE.LinearFilter; marksTex.minFilter = THREE.LinearFilter; marksTex.generateMipmaps = false; marksTex.flipY = false; SH.tMarks.value = marksTex; }
      marks.ctx.globalCompositeOperation = 'source-over';
      marks.ctx.fillStyle = '#000'; marks.ctx.fillRect(0, 0, mk, mk); marksTex.needsUpdate = true;

      buildTerrain(); buildWater(); buildFlow(); buildNames(); buildScenery(); buildSets(); buildLife(); applyLight();
      // The land's heights as a texture, for passes that draw the ground's form.
      if (hTex) hTex.dispose();
      const hd = new Uint16Array(M.h.length);
      for (let i = 0; i < hd.length; i++) hd[i] = toHalf(M.h[i]);
      hTex = new THREE.DataTexture(hd, VW, VH, THREE.RedFormat, THREE.HalfFloatType);
      hTex.magFilter = hTex.minFilter = THREE.LinearFilter; hTex.wrapS = hTex.wrapT = THREE.ClampToEdgeWrapping; hTex.needsUpdate = true;
      SH.tH.value = hTex;
      // The brooks' distance map on the heights' grid: four cells at most, and the fords.
      if (brookTex) brookTex.dispose();
      const bk = new Uint8Array(M.h.length * 4);
      for (let i = 0; i < M.h.length; i++) { bk[i * 4] = M.brookDist ? Math.round(Math.min(M.brookDist[i], 4) / 4 * 255) : 255; bk[i * 4 + 1] = M.brookFord && M.brookFord[i] ? 255 : 0; bk[i * 4 + 3] = 255; }
      brookTex = new THREE.DataTexture(bk, VW, VH, THREE.RGBAFormat);
      brookTex.magFilter = brookTex.minFilter = THREE.LinearFilter; brookTex.wrapS = brookTex.wrapT = THREE.ClampToEdgeWrapping; brookTex.needsUpdate = true;
      SH.tBrook.value = brookTex;
      for (const k in sky) if (typeof sky[k] === 'number') sky[k] = 0;
      Object.assign(sky, Rules.sky(S), { wind: undefined });
      sky.wet = 0; sky.day = Rules.dayAt(S.tick); waterRise.value = Math.min(1.25, sky.flood) * 0.26;
      if (ghost) { scene.remove(ghost); ghost = null; }
    }

    let envCache = {};
    function skyEnv(th) {
      if (envCache[th.name]) return envCache[th.name];
      const s = new THREE.Scene(), top = new THREE.Color(th.env[0]), bot = new THREE.Color(th.env[1]), gr = new THREE.Color(th.env[2]);
      s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.ShaderMaterial({
        side: THREE.BackSide, uniforms: { a: { value: top }, b: { value: bot }, c: { value: gr }, d: { value: new THREE.Vector3(...th.sun).normalize() }, sc: { value: new THREE.Color(th.sunColor) } },
        vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec3 v; uniform vec3 a, b, c, d, sc;
          void main(){ float y = normalize(v).y; vec3 col = y > 0.0 ? mix(b, a, pow(y, 0.55)) : mix(b * 0.7, c, (1.0 - smoothstep(-0.3, 0.0, y)));
            col += sc * (pow(max(dot(normalize(v), d), 0.0), 60.0) * 4.0 + pow(max(dot(normalize(v), d), 0.0), 4.0) * 0.5); gl_FragColor = vec4(col, 1.0); }`,
      })));
      const pm = new THREE.PMREMGenerator(renderer), t = pm.fromScene(s, 0.03).texture;
      pm.dispose();
      return envCache[th.name] = t;
    }

    // Fog and borders. Fog eases toward what the rules say, so edges drift and do not snap.
    function updateFog(dt) {
      const team = viewTeam;
      if (team >= 0) {
        const P = S.P[team], vis = P.vis, seen = P.seen, k = 1 - Math.exp(-dt * 7), d = fogData;
        for (let c = 0; c < W * H; c++) {
          fogR[c] += (vis[c] - fogR[c]) * k;
          fogG[c] += (seen[c] - fogG[c]) * k;
          d[c * 4] = fogR[c] * 255; d[c * 4 + 1] = fogG[c] * 255;
        }
        fogTex.needsUpdate = true;
      }
      if (terrSeen !== S.terrVer) {
        terrSeen = S.terrVer;
        // Signed reach of the viewer's side and of the strongest other side, so a border is a smooth zero
        // crossing, and which side that other is. Reach below -8 never shows, so each source stamps only near.
        const me = Math.max(0, viewTeam), A = new Float32Array(W * H).fill(-40), B = new Float32Array(W * H).fill(-40), O = new Uint8Array(W * H);
        const stamp = (team, x, y, r) => {
          const F = team === me ? A : B, R = Math.ceil(r + 9);
          for (let cy = Math.max(0, (y | 0) - R); cy <= Math.min(H - 1, (y | 0) + R); cy++) for (let cx = Math.max(0, (x | 0) - R); cx <= Math.min(W - 1, (x | 0) + R); cx++) {
            const v = r - Math.hypot(cx + 0.5 - x, cy + 0.5 - y), c = cy * W + cx;
            if (v > F[c]) { F[c] = v; if (team !== me) O[c] = team; }
          }
        };
        for (const e of S.ents) if (e.b && e.hp > 0) stamp(e.team, e.x, e.y, e.d.terr);
        for (const t of S.towns) if (t.owner >= 0) stamp(t.owner, t.x, t.y, t.r);
        for (let c = 0; c < W * H; c++) {
          const ta = Math.min(A[c], A[c] - Math.max(B[c], 0)), tb = Math.min(B[c], B[c] - Math.max(A[c], 0));
          terrData[c * 4] = clamp(0.5 + ta / 16, 0, 1) * 255; terrData[c * 4 + 1] = clamp(0.5 + tb / 16, 0, 1) * 255; terrData[c * 4 + 2] = O[c] / 8 * 255;
        }
        terrTex.needsUpdate = true;
        S.towns.forEach((t, i) => { flagMeshes[i].setColorAt(0, t.owner >= 0 ? teamCol[t.owner] : neutral); flagMeshes[i].instanceColor.needsUpdate = true; });
      }
    }

    // The tracks the rules have worn, twice a second.
    let trailData = null, trailTex = null, trailT = 0;
    function updateTrail(dt) {
      trailT -= dt;
      if (trailT > 0 || !trailData) return;
      trailT = 0.5;
      const G = S.gnd, T = S.trail, d = trailData;
      for (let c = 0; c < W * H; c++) { d[c * 4] = ((G[c] >> 5) & 3) * 85; d[c * 4 + 1] = T[c]; }
      trailTex.needsUpdate = true;
    }

    function updateOre() {
      if (S.oreVer === oreSeen) return;
      oreSeen = S.oreVer;
      const { mesh, cells, per, seen, rnd } = ore;
      let dirty = false;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], left = S.ore[c];
        if (seen[i] === left) continue;
        seen[i] = left; dirty = true;
        const x = c % W, y = c / W | 0, k = Math.min(1, left / 90);
        for (let n = 0; n < per; n++) {
          const r = rnd[i * per + n], px = x + r[0], pz = y + r[1], s = left ? (0.35 + 0.6 * k) * r[3] : 0;
          e1.set(0, r[2], 0); q1.setFromEuler(e1);
          m1.compose(p1.set(px, terrainAt(M, px, pz) - 0.02, pz), q1, s1.set(s, s, s));
          mesh.setMatrixAt(i * per + n, m1);
        }
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }

    const VIS = (x, y) => viewTeam < 0 || S.P[viewTeam].vis[Rules.cellOf(x, y)] === 1;

    // Writes every part but legs, for a beast lying down.
    const putNoLegs = (p, m, c) => p.def.rig === 'leg' || p.def.rig === 'shin' ? false : put(p, m, c);
    // Writes one instance, returning false when its set is full.
    function put(p, matrix, color) {
      if (p.n >= p.cap) return false;
      p.mesh.setMatrixAt(p.n, matrix);
      p.mesh.setColorAt(p.n, color);
      p.n++;
      return true;
    }
    function compose(m, x, y, z, yaw, pitch, roll, s = 1) {
      e1.set(roll, yaw, pitch, 'YXZ');
      // Order is yaw about y, then the tilt of the ground.
      q1.setFromEuler(e1);
      m.compose(p1.set(x, y, z), q1, s2.set(s, s, s));
      return m;
    }

    // How a unit moves this frame: its gait's phase and strength, how far its wheels have turned, and how long since its
    // weapon last struck and how long that weapon takes. Kept on the unit's picture state r.
    const REST = { gp: 0, amp: 0, roll: 0, since: 99, cd: 1, eng: 0, kick: 0, speed: 0, gi: 3 };
    function poseOf(e, r, parts, dt, alpha) {
      const P = r.pose || (r.pose = { gp: 0, amp: 0, roll: 0, prev: null, since: 99, cd: 1, eng: 0, kick: 0, speed: 0, g: null });
      const at = e.anim - e.v / HZ * (1 - alpha), step = P.prev === null ? 0 : clamp(at - P.prev, 0, 1);
      P.prev = at; P.roll += step / US; P.speed = e.v;
      P.amp += ((e.v > 0.1 ? 1 : 0) - P.amp) * Math.min(1, dt * 7);
      const G = parts && parts.gait;
      // The gait by speed, and which of a hip's phases it uses: walk, trot or run.
      if (G) { P.g = G.run && e.v > G.runAt ? G.run : G.trot && e.v > G.trotAt ? G.trot : G.walk; P.gi = P.g === G.run ? 5 : P.g === G.trot ? 4 : 3; P.gp += step / P.g.cycle; }
      const w = e.d.weapons && e.d.weapons[0] && Rules.WEAPONS[e.d.weapons[0]];
      P.cd = w ? w.cd : 1;
      P.since = e.fired ? (S.tick - e.fired + alpha) / HZ : 99;
      P.eng = P.since < P.cd * 1.6 ? 1 : 0;
      return P;
    }
    // A leg's swing at the hip and fold at the knee at phase p of gait g: back along the ground while its foot is down,
    // then lifted, folded and carried forward.
    function legPose(p, g, out) {
      p -= Math.floor(p);
      if (p < g.duty) { const s = p / g.duty; out[0] = g.fwd - (g.fwd + g.back) * s; out[1] = -0.08 * Math.sin(Math.PI * s); }
      else { const s = (p - g.duty) / (1 - g.duty), e = s * s * (3 - 2 * s); out[0] = -g.back + (g.fwd + g.back) * e; out[1] = -g.knee * Math.sin(Math.PI * s); }
      return out;
    }
    const lp = [0, 0];
    // A blow's moment: k from 0 to 1 and back over a lunge, sharp out and slower home.
    const lunge = t => t < 0 ? 0 : t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / 0.3);
    // A throwing engine's arm: the swing at a moment since it threw, and whether it holds a stone.
    const THROWS = { catapult: { fire: -1.78, snap: 0.15, hold: 0.35, wind: 3 }, trebuchet: { fire: -2.4, snap: 0.5, hold: 0.6, wind: 4.2 } };
    function throwAt(T, t) {
      const s0 = T.snap, s1 = s0 + T.hold, s2 = s1 + T.wind;
      if (t < s0) { const k = t / s0; return [T.fire * k * k, false]; }
      if (t < s1) return [T.fire * (1 + 0.04 * Math.sin((t - s0) * 30) * (1 - (t - s0) / T.hold)), false];
      if (t < s2) { const k = (t - s1) / T.wind; return [T.fire * (1 - k), false]; }
      return [0, t > s2 + 0.25];
    }
    // A weapon held in a fight, as a turn about the shoulder (z) and a push forward (x): a thrust of a spear or lance,
    // a sabre's chop, a bow raised and drawn, a gun's kick, or a grenade thrown overarm. P is the unit's pose and o an
    // offset in seconds, so the men of a squad are not all in step.
    function heldPose(kind, P, o, out) {
      out[0] = 0; out[1] = 0;
      if (!P.eng) return out;
      const t = P.since - o, left = P.cd - t;
      if (kind === 'thrust') { const k = lunge(t), w = left < 0.25 && left > 0 ? 1 - left / 0.25 : 0; out[0] = -0.22 * k + 0.12 * w; out[1] = 0.07 * k - 0.04 * w; }
      else if (kind === 'chop') { const k = lunge(t), w = left < 0.3 && left > 0 ? 1 - left / 0.3 : 0; out[0] = -1.1 * k + 0.7 * w; }
      else if (kind === 'draw') { const up = left < 0.5 ? clamp(1 - left / 0.5, 0, 1) : t < 0.25 ? 1 - t / 0.25 : 0; out[0] = 0.42 * up; out[1] = -0.03 * up; }
      else if (kind === 'throw') {
        // The arm goes back over the shoulder, whips forward and down as the grenade leaves, and comes home.
        if (left > 0 && left < 0.45) out[0] = 1.6 * (1 - left / 0.45);
        else if (t >= 0 && t < 0.3) out[0] = t < 0.06 ? 1.6 - 2.1 * t / 0.06 : -0.5 * (1 - (t - 0.06) / 0.24);
      } else {
        // A gun kicks up and back. One slow to load is lowered while it is loaded and brought up to present.
        const k = t >= 0 && t < 0.25 ? (1 - t / 0.25) ** 2 : 0;
        out[0] = 0.14 * k; out[1] = -0.035 * k;
        if (P.cd >= 1.2) { const low = clamp((t - 0.25) / 0.2, 0, 1) * clamp((left - 0.3) / 0.25, 0, 1); out[0] -= 0.4 * low; }
      }
      return out;
    }
    const hp2 = [0, 0];

    // Draws a model's parts on its base matrix. emit takes each part's instance, put by default.
    function drawParts(parts, base, color, ent, r, now, emit = put) {
      const P = r.pose || REST;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i], d = p.def;
        if (d.id === 'hull' || d.id === 'body') { emit(p, base, color); continue; }
        if (d.rig) {
          if (d.rig === 'leg') {
            // Each hip in turn: swing at the hip, lean out by its splay, then the lower leg from the knee, which the
            // next part draws.
            const lower = parts[i + 1], g = P.g || (parts.gait && parts.gait.walk), rest = g && g.rest, un = g && g.unsplay || 0;
            for (const h of d.hips) {
              const ph = h[P.gi || 3];
              if (g && P.amp > 0.01) legPose(P.gp + ph, g, lp); else { lp[0] = 0; lp[1] = 0; }
              const hipA = lp[0] * P.amp + (rest ? rest[0] : 0), kneeA = lp[1] * P.amp + (rest ? rest[1] : 0);
              m2.makeTranslation(h[0], h[1], h[2]);
              m3.makeRotationZ(hipA + (h[6] || 0)); m2.multiply(m3);
              if (h[7]) { m3.makeRotationX(h[7]); m2.multiply(m3); }
              mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
              m3.makeTranslation(0, -d.L1, 0); m2.multiply(m3);
              if (un) { if (h[7]) { m3.makeRotationX(-h[7] * un); m2.multiply(m3); } m3.makeRotationZ(-(h[6] || 0) * un); m2.multiply(m3); }
              m3.makeRotationZ(kneeA); m2.multiply(m3);
              mOut.multiplyMatrices(base, m2); if (lower) emit(lower, mOut, color);
            }
            i++;
          } else if (d.rig === 'wheel') {
            // Wheels roll with the ground covered, and run back with a gun's recoil.
            for (const w of d.wheels) {
              m2.makeTranslation(w[0], w[1], w[2]);
              m3.makeRotationZ(-(P.roll - P.kick) / w[1]); m2.multiply(m3);
              m3.makeScale(w[1], w[1], w[3]); m2.multiply(m3);
              mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
            }
          } else if (d.rig === 'held') {
            d.at.forEach((a, j) => {
              heldPose(d.blow, P, j * 0.05, hp2);
              m2.makeTranslation(a[0] + hp2[1], a[1], a[2]);
              m3.makeRotationZ(hp2[0]); m2.multiply(m3);
              mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
            });
          } else if (d.rig === 'head') {
            // A beast's head nods as it walks and swings down and up to gore.
            const k = P.eng ? lunge(P.since) : 0, nod = Math.sin(P.gp * 6.283 * 2) * 0.05 * P.amp;
            // The gore also thrusts the head forward, as a dip alone barely shows from the camera's height.
            m2.makeTranslation(d.pivot[0] + 0.16 * k, d.pivot[1], d.pivot[2]);
            m3.makeRotationZ(nod - 0.4 * k); m2.multiply(m3);
            mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
          } else if (d.rig === 'throw') {
            // An engine's arm, and what hangs from it or lies in its cup, which the parts after it draw.
            const T = THROWS[d.throw], [ang, loaded] = P.since < 90 ? throwAt(T, P.since) : [0, true];
            m2.makeTranslation(d.pivot[0], d.pivot[1], d.pivot[2]);
            m3.makeRotationZ(ang); m2.multiply(m3);
            mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
            r.armM = r.armM || new THREE.Matrix4(); r.armM.copy(mOut); r.armA = ang; r.loaded = loaded;
          } else if (d.rig === 'loaded') {
            if (r.loaded !== false && r.armM) emit(p, r.armM, color);
          } else if (d.rig === 'hang') {
            if (d.loaded && r.loaded === false) continue;
            m2.copy(r.armM || base);
            m3.makeTranslation(d.at[0], d.at[1], d.at[2]); m2.multiply(m3);
            m3.makeRotationZ(-(r.armA || 0)); m2.multiply(m3);
            emit(p, m2, color);
          }
          continue;
        }
        const pv = d.pivot || [0, 0, 0];
        m2.makeTranslation(pv[0], pv[1], pv[2]);
        if (d.aim) {
          const rel = -(lerpAngle(ent.pta ?? ent.ta, ent.ta, r.alpha)) - r.yaw;
          m3.makeRotationY(rel); m2.multiply(m3);
          mOut.multiplyMatrices(base, m2);
          r.tm = r.tm || new THREE.Matrix4(); r.tm.copy(mOut);
          emit(p, mOut, color);
        } else if (d.parent) {
          m2.copy(r.tm || base);
          m3.makeTranslation(pv[0], pv[1], pv[2]); m2.multiply(m3);
          if (d.tilt) { m3.makeRotationZ(d.tilt); m2.multiply(m3); }
          const since = (S.tick - (ent.fired || -99)) / HZ, kick = since < 0.5 ? (d.recoil || 0) * (1 - since / 0.5) ** 2 : 0;
          if (kick) { m3.makeTranslation(-kick, 0, 0); m2.multiply(m3); }
          emit(p, m2, color);
        } else if (d.spin) {
          const a = now * d.rate;
          m3.makeRotationAxis(d.spin === 'y' ? axisY : d.spin === 'x' ? axisX : axisZ, a); m2.multiply(m3);
          mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
        } else if (d.nod) {
          m3.makeRotationZ(Math.sin(now * 1.8) * 0.26); m2.multiply(m3);
          mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
        } else if (d.door) {
          const open = ent.d.charge ? clamp((ent.charge / ent.d.charge - 0.9) * 10, 0, 1) : 0;
          m3.makeTranslation(d.door * open * 1.1, 0, 0); m2.multiply(m3);
          mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
        } else if (d.load) {
          const k = Math.min(1, (ent.cargo || 0) / (Rules.capOf(S, ent) || 1));
          if (k < 0.06) continue;
          m3.makeTranslation(0, 0.86 * (1 - k * 0.0), 0); m2.multiply(m3);
          m3.makeScale(1, 0.4 + 0.8 * k, 1); m2.multiply(m3);
          m3.makeTranslation(0, -0.9, 0); m2.multiply(m3);
          mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
        } else {
          mOut.multiplyMatrices(base, m2); emit(p, mOut, color);
        }
      }
    }
    const lerpAngle = (a, b, t) => a + Rules.angleTo(a, b) * t;

    // A squad stands in ranks, forward along x and across along y: five as three in front and two behind, three
    // abreast. Each place is a little off the line, as men stand. The last place is the first to fall.
    const SQUADS = {
      1: [[0, 0]],
      3: [[0.05, -0.35], [0.11, 0.01], [0.03, 0.36]],
      5: [[0.21, -0.39], [0.24, 0.0], [0.19, 0.4], [-0.17, -0.2], [-0.15, 0.21]],
    };
    // Where a squad's man i stands on the land, its middle at (x, y) and facing yaw.
    const manAt = (men, i, x, y, yaw, k = 1.2) => { const o = SQUADS[men][i] || [0, 0], c = Math.cos(yaw), s = Math.sin(yaw); return [x + (c * o[0] + s * o[1]) * k, y + (-s * o[0] + c * o[1]) * k]; };

    // Units are drawn a quarter larger than the rules' cells, so each reads by its shape.
    const US = 1.25;
    // A man: body, two legs that swing as he walks, and for the soldiers of the older ages and the future, arms that
    // swing from the shoulders as he fights, by P, his squad's pose, and i, his place in it. A thrust leans him into it.
    function drawMan(set, x, y, z, yaw, phase, moving, color, fallen = 0, P = null, i = 0) {
      const body = set[0], leg = set[1], arms = set[2];
      // The stance, from the squad's pose: crouched on the move, kneeling with the hip at half height, the front foot
      // well forward and the back knee on the ground, or flat on the ground face down with the arms brought round to aim along it.
      const c = P && !fallen ? P.crouch || 0 : 0, k = P && !fallen ? P.kneel || 0 : 0, q = P && !fallen ? P.prone || 0 : 0;
      const bob = moving ? Math.abs(Math.sin(phase)) * 0.018 * (1 - 0.5 * c) : 0;
      if (arms && P && !fallen) heldPose(arms.def.blow, P, i * 0.04, hp2); else { hp2[0] = 0; hp2[1] = 0; }
      const lean = arms && arms.def.blow === 'thrust' ? Math.max(0, -hp2[0]) * 1.1 : 0;
      compose(m1, x, y + bob + (-0.06 * c - 0.16 * k + 0.04 * q) * US, z, yaw, -fallen * 1.5 - lean - 0.22 * c - 0.1 * k - 1.47 * q, 0, US);
      put(body, m1, color);
      const sw = moving ? Math.sin(phase) * 0.62 * (1 - k - q) : 0;
      for (const s of [-1, 1]) {
        m2.makeTranslation(0, 0.31, s * 0.042);
        m3.makeRotationZ(s * sw + k * (s > 0 ? 0.9 : -0.2)); m2.multiply(m3);
        m3.makeScale(1, 1 - 0.18 * c - k * (s > 0 ? 0.22 : 0.51), 1); m2.multiply(m3);
        mOut.multiplyMatrices(m1, m2);
        put(leg, mOut, color);
      }
      if (arms) {
        const pv = arms.def.pivot;
        m2.makeTranslation(pv[0] + hp2[1], pv[1], pv[2]);
        m3.makeRotationZ(hp2[0] + 1.47 * q); m2.multiply(m3);
        m3.makeTranslation(-pv[0], -pv[1], -pv[2]); m2.multiply(m3);
        mOut.multiplyMatrices(m1, m2);
        put(arms, mOut, color);
      }
    }

    function drawEntities(alpha, dt, now) {
      for (const k in sets) for (const p of sets[k]) p.n = 0;
      const onScreen = world.onScreen;
      onScreen.length = 0;
      const vw = world.vw, vh = world.vh;
      const P = viewTeam >= 0 ? S.P[viewTeam] : null;
      for (const e of S.ents) {
        if (e.hp <= 0) continue;
        let r = rs.get(e.id);
        if (!r) { r = { pitch: 0, roll: 0, yaw: 0, alive: e.d.men || 0, dust: 0, smoke: 0, seen: false, tx: null, tz: null, stepT: 0 }; rs.set(e.id, r); }
        r.alpha = alpha;
        const color = teamCol[e.team];
        if (e.b) {
          if (!r.seen && (viewTeam < 0 || e.team === viewTeam || Rules.seenBy(S, viewTeam, e))) r.seen = true;
          if (!r.seen) continue;
          if (r.y0 === undefined) {
            r.y0 = terrainAt(M, e.x, e.y) + 0.02;
            let lo = 99;
            for (let cy = e.cy; cy <= e.cy + e.h; cy += e.h) for (let cx = e.cx; cx <= e.cx + e.w; cx += e.w) lo = Math.min(lo, terrainAt(M, cx, cy));
            r.y0 = Math.max(lo + 0.04, r.y0 - 0.1);
            // A dock's deck stands on its piles clear of the water it juts over.
            if (e.d.shore) r.y0 = Math.max(r.y0, M.water + 0.12);
            const dx = CX - e.x, dy = CY - e.y, wide = e.w === e.h && !e.d.weapons;
            r.yaw = !wide ? (dx < 0 ? Math.PI : 0) : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : Math.PI) : (dy > 0 ? -Math.PI / 2 : Math.PI / 2);
            if (e.d.weapons) r.yaw = 0;
          }
          const age = (S.tick - e.born) / HZ, up = clamp(age / 2.2, 0, 1), ease = 1 - (1 - up) ** 3;
          compose(m1, e.x, r.y0 - (1 - ease) * 2.4, e.y, r.yaw, 0, 0);
          if (up < 1) { m3.makeScale(1, 0.4 + 0.6 * ease, 1); m1.multiply(m3); r.dust -= dt; if (r.dust <= 0) { r.dust = 0.05; const a = Math.random() * 6.28, q = Math.max(e.w, e.h) * 0.6; dustPuff(e.x + Math.cos(a) * q, r.y0 + 0.1, e.y + Math.sin(a) * q, 1.4); } }
          drawParts(sets[bkey(e.kind, e.team)], m1, color, e, r, now);
          // Damage shows as smoke, then fire.
          const f = e.hp / e.max;
          if (f < 0.55 && VIS(e.x, e.y)) {
            r.smoke -= dt;
            if (r.smoke <= 0) {
              r.smoke = f < 0.28 ? 0.1 : 0.22;
              const ox = (Math.random() - 0.5) * e.w * 0.7, oz = (Math.random() - 0.5) * e.h * 0.7;
              burn(e.x + ox, r.y0 + 1.1, e.y + oz, f < 0.28 ? 1.5 : 0.9, f < 0.28);
            }
          }
          if (e.kind === 'power' && VIS(e.x, e.y)) { r.dust -= dt; if (r.dust <= 0) { r.dust = 0.5; const a = r.yaw, cx = Math.cos(-a), sx = Math.sin(-a), ox = cx * -0.55 + sx * 0.5, oz = sx * -0.55 - cx * 0.5; steam(e.x + ox, r.y0 + 1.9, e.y + oz); } }
          pushScreen(onScreen, e, e.x, r.y0 + 0.6, e.y, Math.max(e.w, e.h) * 0.5);
          continue;
        }

        const vis = viewTeam < 0 || e.team === viewTeam || P.vis[Rules.cellOf(e.x, e.y)] === 1;
        const x = lerp(e.px, e.x, alpha), y = lerp(e.py, e.y, alpha), yaw = -lerpAngle(e.pa, e.a, alpha);
        r.yaw = yaw;
        const gh = heightAt(M, x, y);
        // Men die one at a time out of a squad.
        if (e.d.men) {
          const alive = Math.ceil(e.hp / e.max * e.d.men);
          if (alive < r.alive && vis) {
            const [cx, cz] = manAt(e.d.men, alive, x, y, yaw);
            corpses.push({ kind: e.kind, x: cx, y: heightAt(M, cx, cz), z: cz, yaw, t: 0, color });
            bleed(cx, cz, -yaw);
          }
          r.alive = alive;
        }
        if (!vis) continue;
        if (e.d.men) {
          const set = sets['man' + e.kind];
          if (e.drop > 0) {
            const z = gh + e.drop * 2.4;
            for (let i = 0; i < r.alive; i++) {
              const off = SQUADS[e.d.men][i];
              drawMan(set, x + off[0] * 2, z, y + off[1] * 2, yaw, 0, false, color);
              compose(m1, x + off[0] * 2, z + 0.1, y + off[1] * 2, 0, 0, 0, 0.7); put(sets.chute[0], m1, colA.copy(color).lerp(burnt, -1.2));
            }
            pushScreen(onScreen, e, x, z + 0.3, y, 0.5);
            continue;
          }
          const moving = e.v > 0.1, ph = e.anim * 7, Pz = poseOf(e, r, null, dt, alpha);
          // In a melee the ranks press forward into the enemy and jostle, so a fight reads as a scrum.
          const w0 = e.d.weapons[0] && Rules.WEAPONS[e.d.weapons[0]], scrum = Pz.eng && w0 && w0.fx === 'melee' ? 1 : 0;
          // How the men stand. Gunmen lie flat in cover or when pinned and kneel to shoot; others kneel in cover or
          // when pinned. Any squad crouches as it moves under fire. Each eases into its stance over a fifth of a second.
          const gun = !set[2] || set[2].def.blow === 'shot', pin = (e.sup || 0) >= Rules.PIN, held = !moving && !scrum;
          const cov = e.cov >= 0, tP = held && gun && (cov || pin) ? 1 : 0, tK = held && !tP && ((gun && (Pz.eng || e.tgt)) || cov || pin) ? 1 : 0;
          const tC = moving && (Pz.eng || (e.sup || 0) > 0.1) ? 1 : 0, sk = Math.min(1, dt * 5);
          Pz.prone = (Pz.prone || 0) + (tP - (Pz.prone || 0)) * sk; Pz.kneel = (Pz.kneel || 0) + (tK - (Pz.kneel || 0)) * sk; Pz.crouch = (Pz.crouch || 0) + (tC - (Pz.crouch || 0)) * sk;
          const fx = Math.cos(-yaw), fz = Math.sin(-yaw);
          for (let i = 0; i < r.alive; i++) {
            let [px, pz] = manAt(e.d.men, i, x, y, yaw, scrum ? 1.05 : 1.2);
            if (scrum) { const j = Math.sin(now * 5.3 + i * 2.1) * 0.05, f = 0.12 + Math.sin(now * 3.7 + i * 1.3) * 0.04; px += fx * f - fz * j; pz += fz * f + fx * j; }
            drawMan(set, px, heightAt(M, px, pz), pz, yaw, ph + i * 1.9, moving, color, 0, Pz, i);
          }
          // A squad on the move leaves a faint trodden line.
          if (moving) trackMark(r, x, y, yaw, 0.08, 0.16);
          pushScreen(onScreen, e, x, gh + 0.4, y, 0.6);
          continue;
        }
        const air = Rules.isAir(e), naval = e.d.move === 'naval', L = e.d.r * 0.9;
        // A ship rides on the water, rising and falling a little with the swell.
        const z = air ? gh * 0 + Math.max(gh, M.water) + e.z : naval ? M.water + waterRise.value + 0.04 * Math.sin(now * 1.6 + e.id) : gh;
        if (!air) {
          const cA = Math.cos(-yaw), sA = Math.sin(-yaw);
          // A unit leans with the ground under its four sides. On a bridge, a side past the deck's edge is taken
          // as level with the deck, not the bank below, and no unit leans more than a fifth of a right angle each way.
          const deck = gh > terrainAt(M, x, y) + 0.05, hAt = (px, py) => { const v = heightAt(M, px, py); return deck && v < gh - 0.1 ? gh : v; };
          const hf = hAt(x + cA * L, y + sA * L), hb = hAt(x - cA * L, y - sA * L), hl = hAt(x - sA * L * 0.7, y + cA * L * 0.7), hr = hAt(x + sA * L * 0.7, y - cA * L * 0.7);
          const k = 1 - Math.exp(-dt * 10), lim = v => clamp(v, -0.35, 0.35);
          const tp = naval ? 0.03 * Math.sin(now * 1.3 + e.id) : lim(Math.atan2(hf - hb, L * 2)), tr = naval ? 0.05 * Math.sin(now * 1.05 + e.id * 2) : lim(Math.atan2(hl - hr, L * 1.4));
          r.pitch += (tp - r.pitch) * k; r.roll += (tr - r.roll) * k;
          compose(m1, x, z, y, yaw, r.pitch, -r.roll, US);
          // A beast or walker rides up and down on its stride, and a gallop rocks it fore and aft. A gun runs back as
          // it fires, and its wheels with it.
          const meta = MODELS.units[e.kind], Pz = poseOf(e, r, meta, dt, alpha);
          if (Pz.g && Pz.amp > 0.01) {
            const g = Pz.g, ph = Pz.gp * 6.283;
            m3.makeTranslation(0, g.bob * Pz.amp * (0.5 - 0.5 * Math.cos(ph * 2)), 0); m1.multiply(m3);
            if (g.rock) { m3.makeRotationZ(g.rock * Pz.amp * Math.sin(ph)); m1.multiply(m3); }
          }
          Pz.kick = meta && meta.kick && Pz.since < 0.6 ? meta.kick * (1 - Pz.since / 0.6) ** 2 : 0;
          if (Pz.kick) { m3.makeTranslation(-Pz.kick, 0, 0); m1.multiply(m3); m3.makeRotationZ(Pz.kick * 0.5); m1.multiply(m3); }
        } else {
          const bank = clamp(Rules.angleTo(e.pa, e.a) * 8, -0.5, 0.5), nose = e.d.move === 'air' ? -clamp(e.v / e.d.speed, 0, 1) * 0.2 : 0;
          r.pitch += (nose - r.pitch) * 0.1; r.roll += (bank - r.roll) * 0.1;
          compose(m1, x, z, y, yaw, r.pitch, r.roll, US);
        }
        // Just changed to its new age's form, it rises into it out of its dust.
        if (r.morph !== undefined && r.morph < 0.45) { r.morph += dt; const k = Math.min(1, r.morph / 0.45); m3.makeScale(1, 0.55 + 0.45 * (1 - (1 - k) ** 3), 1); m1.multiply(m3); }
        drawParts(sets[e.kind], m1, color, e, r, now);
        if (!air) {
          // Dust behind what moves on land, and tracks in the ground.
          if (e.v > 0.8 && !naval) {
            r.dust -= dt;
            if (r.dust <= 0) {
              r.dust = 0.13;
              const cA = Math.cos(-yaw), sA = Math.sin(-yaw);
              dustPuff(x - cA * L + (Math.random() - 0.5) * 0.5, z + 0.1, y - sA * L + (Math.random() - 0.5) * 0.5, 0.5 + e.d.r * 0.4);
            }
            trackMark(r, x, y, yaw, e.d.move === 'track' ? 0.36 : 0.3, e.d.move === 'track' ? 0.5 : 0.28);
          }
        } else if (e.d.move === 'air' && e.d.alt > 2) {
          r.dust -= dt;
          if (r.dust <= 0) { r.dust = 0.3; dustPuff(x + (Math.random() - 0.5) * 2, gh + 0.1, y + (Math.random() - 0.5) * 2, 0.9); }
        } else if (e.d.move === 'jet' && e.z > 1) {
          r.dust -= dt;
          if (r.dust <= 0) { r.dust = 0.03; const cA = Math.cos(-yaw), sA = Math.sin(-yaw); glow.add(x - cA * 1.1, z + 0.05, y - sA * 1.1, 0, 0, 0, 0.14, 0.5, 0.15, [3, 2.2, 1.2, 0.9], [2, 0.6, 0.1, 0], 8); }
        }
        pushScreen(onScreen, e, x, z + (air ? 0 : 0.5), y, e.d.r * US);
      }

      // A destroyed building shakes, leans and sinks into its own dust before the rubble shows.
      for (let i = falls.length - 1; i >= 0; i--) {
        const f = falls[i];
        f.t += dt;
        const k = f.t / 2.1;
        if (k >= 1) { falls.splice(i, 1); continue; }
        const set = sets[f.kind];
        if (!set) continue;
        const shake = k < 0.3 ? (Math.random() - 0.5) * 0.12 : 0, fall = Math.max(0, k - 0.12) / 0.88, g2 = fall * fall;
        compose(m1, f.x + shake, f.y0 - g2 * 2.6, f.z + shake, f.yaw, f.dir * 0.32 * g2, f.dir * 0.12 * g2);
        m3.makeScale(1, 1 - 0.55 * g2, 1); m1.multiply(m3);
        const fr = f.r || (f.r = { alpha: 1, yaw: f.yaw }), fe = f.e || (f.e = { pta: 0, ta: 0, fired: -1e9, d: BUILDINGS[f.base], charge: 0, cargo: 0 });
        drawParts(set, m1, colA.copy(teamCol[f.team]).lerp(burnt, Math.min(1, k * 1.4)), fe, fr, now);
        f.dust -= dt;
        if (f.dust <= 0 && fall > 0) {
          f.dust = 0.05;
          const a = Math.random() * 6.28, q = Math.max(f.w, f.h) * 0.55;
          dustPuff(f.x + Math.cos(a) * q, f.y0 + 0.1, f.z + Math.sin(a) * q, 1.6 + fall);
          smoke.add(f.x + (Math.random() - 0.5) * f.w, f.y0 + 1.4 * (1 - g2), f.z + (Math.random() - 0.5) * f.h, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.9, 0.12, 0.18, [0.2, 0.18, 0.16, 1], [0.2, 0.18, 0.16, 0.9], 11, { grav: -12, spin: 6 });
        }
      }
      for (let i = bleeds.length - 1; i >= 0; i--) {
        const b = bleeds[i];
        b.t += dt;
        if (b.n === 0 && b.t > 0.5) { pool(b, 0.7); b.n = 1; } else if (b.n === 1 && b.t > 1.8) { pool(b, 1); bleeds.splice(i, 1); }
      }
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i];
        c.t += dt;
        if (c.t > 9) { corpses.splice(i, 1); continue; }
        const k = Math.min(1, c.t / 0.45), sink = c.t > 7.5 ? (c.t - 7.5) * 0.3 : 0;
        drawMan(sets['man' + c.kind], c.x, c.y - sink, c.z, c.yaw, 0, false, c.color, k * k);
      }
      for (let i = wrecks.length - 1; i >= 0; i--) {
        const w = wrecks[i];
        w.t += dt;
        if (w.t < 0) continue;
        // Wrecks and rubble stay for the rest of the game. Only those given up, the oldest past a cap or what a new
        // building now stands on, sink away over four seconds.
        if (w.gone !== undefined) { w.gone += dt; if (w.gone > 4) { wrecks.splice(i, 1); continue; } }
        const set = sets[w.kind], sink = w.gone !== undefined ? w.gone * 0.4 : 0;
        if (w.rubble) {
          compose(m1, w.x, w.y - sink, w.z, w.yaw, 0, 0, w.s);
          put(sets.rubble[0], m1, colA.setRGB(0.5, 0.48, 0.44));
        } else {
          compose(m1, w.x, w.y - sink, w.z, w.yaw, w.pitch, 0, US);
          if (set.some(p => p.def.rig)) {
            // A model with moving parts lies at rest. A fallen beast sinks down on its folded legs.
            const beast = OLD(w.kind) && MODELS.units[w.kind].gait;
            if (beast) { m3.makeTranslation(0, -0.2, 0); m1.multiply(m3); }
            drawParts(set, m1, burnt, w.e || (w.e = { pta: 0, ta: 0, fired: 0, d: UNITS[w.kind], cargo: 0, charge: 0 }), w.r || (w.r = { alpha: 1, yaw: 0 }), now, beast ? putNoLegs : put);
          } else {
            put(set[0], m1, burnt);
            if (set[1] && set[1].def.pivot) { m2.makeTranslation(...set[1].def.pivot); m3.makeRotationZ(0.3); m2.multiply(m3); mOut.multiplyMatrices(m1, m2); put(set[1], mOut, burnt); }
          }
        }
        w.smoke -= dt;
        if (w.smoke <= 0 && w.t < 26 && VIS(w.x, w.z)) { w.smoke = 0.14 + w.t * 0.012; burn(w.x, w.y + 0.5, w.z, 0.9 + (w.rubble ? 0.4 : 0), w.t < 10); }
      }

    }
    // An empty set is hidden, so the many models nobody draws this frame cost no draw calls.
    function finishSets() {
      for (const k in sets) for (const p of sets[k]) {
        p.mesh.count = p.n; p.mesh.visible = p.n > 0;
        if (p.n) { p.mesh.instanceMatrix.needsUpdate = true; p.mesh.instanceColor.needsUpdate = true; }
      }
    }

    function pushScreen(list, e, x, y, z, r) {
      p1.set(x, y, z).project(camera);
      if (p1.z > 1) return;
      const sx = (p1.x + 1) / 2 * world.vw, sy = (1 - p1.y) / 2 * world.vh;
      if (sx < -80 || sy < -80 || sx > world.vw + 80 || sy > world.vh + 80) return;
      // Pixels to the unit at this depth, for the size of a ring or a bar.
      const scale = world.vh / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.distanceTo(p1.set(x, y, z)));
      list.push({ e, x: sx, y: sy, r: r * scale, scale });
    }

    // Effects.
    const dustC = () => theme.dust;
    function dustPuff(x, y, z, size) {
      const d = dustC(), a = 0.2;
      smoke.add(x, y, z, (Math.random() - 0.5) * 0.3, 0.32, (Math.random() - 0.5) * 0.3, 1.5 + Math.random(), size * 0.6, size * 2.2, [d[0], d[1], d[2], a], [d[0], d[1], d[2], 0], Math.random() * 4 | 0, { drag: 1.4, spin: 0.3 });
    }
    function burn(x, y, z, size, fire) {
      const s = theme.smoke;
      smoke.add(x, y, z, 0.3 + (Math.random() - 0.5) * 0.25, 1.6, 0.1 + (Math.random() - 0.5) * 0.25, 4.2, size * 0.7, size * 4, fire ? [4, 1.8, 0.5, 0.8] : [s[0], s[1], s[2], 0.7], [s[0], s[1], s[2], 0.68], Math.random() * 4 | 0, { drag: 0.28, spin: 0.2, c2: [s[0] * 2.4, s[1] * 2.3, s[2] * 2.2, 0], mid: 0.12 });
      if (fire) glow.add(x, y - 0.3, z, 0, 0.9, 0, 0.5 + Math.random() * 0.3, size * 0.7, size * 0.2, [3.4, 1.7, 0.5, 0.9], [1.6, 0.3, 0.05, 0], 4 + (Math.random() * 4 | 0), { spin: 1 });
    }
    function steam(x, y, z) { smoke.add(x, y, z, 0.25, 0.9, 0.1, 4, 0.8, 3.2, [0.92, 0.92, 0.92, 0.3], [1, 1, 1, 0], Math.random() * 4 | 0, { drag: 0.2 }); }
    function muzzle(x, y, z, size) {
      glow.add(x, y, z, 0, 0, 0, 0.07, size, size * 0.6, [7, 5, 2.6, 1], [4, 1.8, 0.3, 0], 12);
      glow.add(x, y, z, 0, 0, 0, 0.1, size * 1.8, size * 2.4, [2.2, 1.1, 0.4, 0.6], [0.8, 0.2, 0, 0], 8);
    }
    // Which of the overlay's blast drawings a thing goes up in, by what it is: a tank in woodcut wedges, a refinery
    // in an engraved column of smoke, a shell hit in quick scratches, a missile in converging lines, and so on. The
    // numbers are the HUD's BLAST table.
    const BLAST_OF = {
      tank: 5, heavy: 21, ifv: 13, humvee: 31, truck: 17, flak: 27, support: 32, mlrs: 8, fpv: 10, heli: 30, jet: 26,
      rifle: 24, rocket: 24, engineer: 24, sniper: 24, hero: 24,
      hq: 30, power: 12, refinery: 7, barracks: 25, factory: 7, radar: 9, airfield: 15, fob: 25, derrick: 7, silo: 26, bunker: 20, atgun: 31, sam: 27, rail: 9,
    };
    const HIT_OF = { shell: 31, rocket: 8, missile: 10, beam: 9, bullet: 24, tracer: 24, stone: 6, pulse: 9 };
    // Men, beasts and wooden engines go down in dust, not fire.
    const OLD = k => UNITS[k] && UNITS[k].age <= 3 && UNITS[k].cat !== 'air';
    function dustBurst(x, y, z, size) {
      const d = dustC(), R = () => Math.random();
      for (let i = 0; i < Math.round(6 + size * 6); i++) { const a = R() * 6.28, sp = (0.6 + R() * 1.4) * size; smoke.add(x, y + 0.15, z, Math.cos(a) * sp, 0.6 + R() * 0.8, Math.sin(a) * sp, 1.4 + R(), size * 0.5, size * 1.8, [d[0], d[1], d[2], 0.6], [d[0], d[1], d[2], 0], R() * 4 | 0, { drag: 2.2 }); }
      inkAdd({ k: 'burst', x, y: y + 0.3, z, life: 0.25, s: size * 0.7, fx: 6 });
    }
    // A small burst, as a light shell, an autocannon round or a flak shell makes: a quick flash and a little cloud of
    // dark smoke, in a few uneven puffs that drift and thin. High up, as flak bursts, the cloud is darker.
    function puff(x, y, z, size, air) {
      const R = () => Math.random(), sm = theme.smoke, k = air ? 0.55 : 1;
      // The pen-and-ink look draws the cloud itself, a scalloped puff that swells and thins.
      inkAdd({ k: 'puff', x, y, z, life: 1.3 + R() * 0.7, s: size, air: !!air });
      glow.add(x, y, z, 0, 0, 0, 0.07, size * 0.5, size * 1.1, [9, 6, 3, 1], [4, 1.5, 0.3, 0], 12, { rot: R() * 6 });
      // A small ragged flame, two or three lobes that burn out in a quarter of a second.
      const a0 = R() * 6.28;
      for (let i = 0, n = 2 + (R() * 2 | 0); i < n; i++) {
        const a = a0 + (R() - 0.5) * 2.4, d = size * R() * 0.3;
        glow.add(x + Math.cos(a) * d, y + R() * 0.15 * size, z + Math.sin(a) * d, 0, 0.6 * size, 0, 0.18 + R() * 0.14, size * (0.28 + R() * 0.2), size * (0.55 + R() * 0.3), [6, 3.4, 1.2, 1], [2, 0.45, 0.08, 0], 8, { rot: R() * 6, delay: i * 0.02 });
      }
      // Then the cloud: a few uneven puffs of smoke, dense at first.
      for (let i = 0, n = 4 + (R() * 3 | 0); i < n; i++) {
        const a = R() * 6.28, d = size * (0.1 + R() * 0.4);
        smoke.add(x + Math.cos(a) * d, y + R() * 0.25 * size, z + Math.sin(a) * d, Math.cos(a) * 0.4 + 0.2, 0.25 + R() * 0.35, Math.sin(a) * 0.4,
          1.6 + R() * 1.4, size * (0.45 + R() * 0.3), size * (1.1 + R() * 0.7), [sm[0] * 1.2 * k, sm[1] * 1.15 * k, sm[2] * 1.15 * k, 1], [sm[0] * 3, sm[1] * 3, sm[2] * 3, 0], R() * 4 | 0, { drag: 1.1, spin: (R() - 0.5) * 0.8, delay: 0.06 + i * 0.03 });
      }
      if (!air) for (let i = 0; i < 4; i++) { const a = R() * 6.28, sp = 1.5 + R() * 2; smoke.add(x, y + 0.05, z, Math.cos(a) * sp, 2 + R() * 2, Math.sin(a) * sp, 0.6 + R() * 0.4, 0.08, 0.12, [0.16, 0.13, 0.11, 1], [0.16, 0.13, 0.11, 0.9], 11, { grav: -12, spin: 6 }); }
    }
    function explosion(x, y, z, size, fx) {
      inkAdd({ k: 'burst', x, y: y + 0.4 * size, z, life: (0.16 + size * 0.05) * (style.burstLife || 1), s: size, fx });
      const sm = theme.smoke, d = dustC(), n = Math.round(6 + size * 7), R = () => Math.random();
      const smoke1 = [sm[0] * 1.6, sm[1] * 1.5, sm[2] * 1.5, 0.82], smoke0 = [sm[0] * 3.4, sm[1] * 3.2, sm[2] * 3.1, 0];
      // The flash, white at its heart.
      glow.add(x, y + 0.4 * size, z, 0, 0, 0, 0.1, size * 2.6, size * 4.6, [7, 5, 3, 0.9], [3, 1.2, 0.2, 0], 8);
      // Where the look draws fire in bands of coloured ink, a fireball that swells and burns down from yellow through
      // orange to red over half a second, so the blast is seen in colour with nothing drawn over it.
      // The fire is a cluster of lobes, never one round ball: thrown more to one side than the other, of unequal
      // size, some rising as tongues, some lighting a moment later, so no two blasts have the same shape.
      if (style.fire === 0) {
        const a0 = R() * 6.28, nl = Math.min(9, 3 + Math.round(size * 2.5));
        for (let i = 0; i < nl; i++) {
          const a = a0 + (R() - 0.5) * 2.6, d = size * (0.15 + R() * 0.8) * (i ? 1 : 0.25), tongue = R() < 0.3, rs = size * (0.45 + R() * 0.7) * (i ? 1 : 1.15);
          glow.add(x + Math.cos(a) * d, y + 0.25 * size + R() * 0.4 * size, z + Math.sin(a) * d, Math.cos(a) * 0.5 * size, (tongue ? 2 + R() : 0.5 + R()) * size, Math.sin(a) * 0.5 * size,
            0.28 + R() * 0.45, rs * (tongue ? 0.6 : 0.9), rs * (tongue ? 1.4 : 1.9 + R()), [6, 3.4, 1.2, 1], [2, 0.45, 0.08, 0], 8, { rot: R() * 6, delay: i ? R() * 0.09 * Math.sqrt(size) : 0, drag: 1.4 });
        }
      }
      glow.add(x + (R() - 0.5) * size * 0.4, y + 0.2, z + (R() - 0.5) * size * 0.4, 0, 0, 0, 0.06, size * (1 + R() * 0.6), size * 1.8, [9, 7, 4.5, 1], [4, 2, 0.6, 0], 12, { rot: R() * 6 });
      // The fireball: puffs that leave hot, swell and roll upward, and cool to brown smoke.
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, up = 0.6 + R() * 1.6, sp = (0.6 + R() * 1.6) * size;
        smoke.add(x + Math.cos(a) * 0.2 * size, y + 0.2 + R() * 0.4 * size, z + Math.sin(a) * 0.2 * size, Math.cos(a) * sp, up * size * 1.4, Math.sin(a) * sp,
          1.6 + R() * 1.4, size * (0.7 + R() * 0.4), size * (2.6 + R() * 1.4), [5.6, 3, 1, 1], [2.4, 0.8, 0.2, 0.95], R() * 4 | 0,
          { drag: 2.6, spin: (R() - 0.5) * 1.4, c2: smoke0, mid: 0.16 + R() * 0.08 });
      }
      // A slower body of smoke that rises after it, drifting with the wind.
      for (let i = 0; i < Math.round(3 + size * 3); i++) {
        const a = R() * 6.28, r = R() * size * 0.8;
        smoke.add(x + Math.cos(a) * r, y + 0.4 * size, z + Math.sin(a) * r, 0.3 + (R() - 0.5) * 0.6, 0.9 + R() * 0.9, (R() - 0.5) * 0.6,
          3.5 + R() * 2.5, size * 1.2, size * 3.8, [sm[0], sm[1], sm[2], 0], smoke1, R() * 4 | 0, { drag: 0.5, spin: 0.15, c2: smoke0, mid: 0.25, delay: 0.15 + R() * 0.2 });
      }
      // Dirt thrown up in a cone, falling back.
      for (let i = 0; i < Math.round(5 + size * 6); i++) {
        const a = R() * 6.28, sp = (1.5 + R() * 3) * Math.sqrt(size), up = (3 + R() * 6) * Math.sqrt(size);
        smoke.add(x, y + 0.1, z, Math.cos(a) * sp, up, Math.sin(a) * sp, 0.9 + R() * 0.6, 0.18 * size, 0.6 * size, [d[0] * 0.7, d[1] * 0.6, d[2] * 0.5, 0.9], [d[0], d[1], d[2], 0], R() * 4 | 0, { grav: -11, drag: 0.6 });
      }
      // Shards and hot sparks.
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, sp = (2 + R() * 4) * Math.sqrt(size);
        smoke.add(x, y + 0.2, z, Math.cos(a) * sp, 3 + R() * 5 * Math.sqrt(size), Math.sin(a) * sp, 0.8 + R() * 0.5, 0.1, 0.14, [0.16, 0.13, 0.11, 1], [0.16, 0.13, 0.11, 0.9], 11, { grav: -14, spin: 8 });
        glow.add(x, y + 0.3, z, Math.cos(a) * sp * 1.6, 2 + R() * 7, Math.sin(a) * sp * 1.6, 0.5 + R() * 0.6, 0.07, 0.03, [12, 6, 2, 1], [6, 1.2, 0.1, 0], 9, { grav: -13, drag: 0.8 });
      }
      // Dust driven out along the ground.
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28 + R() * 0.4; smoke.add(x, y + 0.1, z, Math.cos(a) * 3.4 * size, 0.25, Math.sin(a) * 3.4 * size, 1.6, size * 0.7, size * 2.6, [d[0], d[1], d[2], 0.42], [d[0], d[1], d[2], 0], i % 4, { drag: 2.6 }); }
      if (size >= 0.9) rings.add(x, y, z, size * 2.6, 0.5, new THREE.Color(...dustC()).multiplyScalar(0.9).getHex());
      flash(x, y, z, size * 30);
      if (size > 1.5) cam.shake = Math.max(cam.shake, Math.min(0.8, size * 0.12) * nearView(x, z));
    }
    // How near a spot lies to the view, 1 within it and 0 beyond a view's width and a half from its middle, for
    // the shakes and white-outs that should not reach a player looking elsewhere.
    const nearView = (x, z) => clamp(1.5 - Math.hypot(x - cam.x, z - cam.y) / (cam.dist * 0.72), 0, 1);
    function bigBlast(x, y, z, size) {
      // The thermobaric fireball, stem and cap. The white-out and the shake reach only a view near the blast.
      const near = nearView(x, z);
      explosion(x, y, z, size * 0.5, 26);
      flash(x, y, z, 900);
      pp.grade.uniforms.uFlash.value = Math.max(pp.grade.uniforms.uFlash.value, 0.5 * near);
      cam.shake = Math.max(cam.shake, 1.4 * near);
      const s = theme.smoke;
      // The fireball is kept to its middle and short, so it never blanks the view.
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * 6.28, r = Math.random() * size * 0.6, up = 2 + Math.random() * size * 0.9;
        if (i % 3 === 0) glow.add(x + Math.cos(a) * r * 0.6, y + Math.random() * 3, z + Math.sin(a) * r * 0.6, Math.cos(a) * 3, up, Math.sin(a) * 3, 0.8 + Math.random() * 0.7, size * 0.3, size * 0.5, [7, 3.2, 1, 1], [1.2, 0.2, 0.03, 0], 4 + (i % 4), { drag: 1.1, spin: 1, delay: Math.random() * 0.6 });
        smoke.add(x + Math.cos(a) * r * 0.5, y + 1, z + Math.sin(a) * r * 0.5, Math.cos(a) * 1.2, 2 + up * 0.8, Math.sin(a) * 1.2, 7 + Math.random() * 5, size * 0.6, size * 1.6, [s[0], s[1], s[2], 0.82], [s[0] * 3, s[1] * 3, s[2] * 3, 0], i % 4, { drag: 0.42, spin: 0.1, delay: Math.random() * 1.6 });
      }
      for (let i = 0; i < 80; i++) {
        const a = Math.random() * 6.28, sp = size * (1 + Math.random());
        smoke.add(x, y + 0.2, z, Math.cos(a) * sp * 2, 0.4, Math.sin(a) * sp * 2, 3, size * 0.4, size * 1.1, [theme.dust[0], theme.dust[1], theme.dust[2], 0.56], [theme.dust[0], theme.dust[1], theme.dust[2], 0], i % 4, { drag: 1.7 });
      }
      rings.add(x, y, z, size * 3.2, 1.2, 0xfff0d0);
      rings.add(x, y, z, size * 2, 0.8);
    }
    // What a new building is placed over is cleared away, and past a cap the oldest wrecks and rubble go: twenty of a
    // kind of vehicle, since they share its instances, and six hundred pieces of rubble.
    function clearWrecks(x, y, r) { for (const w of wrecks) if (w.gone === undefined && Math.abs(w.x - x) < r && Math.abs(w.z - y) < r) w.gone = 0; }
    function capWrecks(kind) {
      const live = wrecks.filter(w => w.gone === undefined && (kind ? w.kind === kind && !w.rubble : w.rubble));
      for (let i = 0; i < live.length - (kind ? 20 : 600); i++) live[i].gone = 0;
    }
    function scorch(x, y, r, strong = 1) {
      const c = marks.ctx, k = marks.width / W, g = c.createRadialGradient(x * k, y * k, 0, x * k, y * k, r * k);
      c.globalCompositeOperation = 'lighter';
      g.addColorStop(0, `rgba(${200 * strong | 0},0,0,1)`); g.addColorStop(0.55, `rgba(${110 * strong | 0},0,0,1)`); g.addColorStop(1, 'rgba(0,0,0,1)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x * k, y * k, r * k, 0, 6.3); c.fill();
      marksDirty = true;
    }
    // Ink flung from a big blast: drops and streaks round where it hit, solid in the scars layer.
    function splatter(x, y, r) {
      const c = marks.ctx, k = marks.width / W, n = 8 + (r * 5 | 0);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgb(255,0,0)'; c.strokeStyle = 'rgb(255,0,0)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, d = r * (0.7 + Math.random() * 1.3), q = (0.05 + Math.random() * 0.14) * r;
        const px = (x + Math.cos(a) * d) * k, py = (y + Math.sin(a) * d) * k;
        c.moveTo(px + q * k, py); c.arc(px, py, q * k, 0, 6.3);
      }
      c.fill();
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * 6.28, d0 = r * 0.5, d1 = r * (1.1 + Math.random() * 0.6);
        c.lineWidth = Math.max(1, r * 0.08 * k);
        c.beginPath(); c.moveTo((x + Math.cos(a) * d0) * k, (y + Math.sin(a) * d0) * k); c.lineTo((x + Math.cos(a) * d1) * k, (y + Math.sin(a) * d1) * k); c.stroke();
      }
      marksDirty = true;
    }
    // Blood where a man or a beast falls on dry ground, in the scars layer's blue: a few drops flung out at once,
    // then a pool that spreads from under the body over two seconds, longest along the way it lay.
    function bleed(x, y, a, r = 0.17) {
      const t = terrainAt(M, x, y);
      if (t < M.water + 0.05 || heightAt(M, x, y) > t + 0.1) return;
      const b = { x, y, a, r, t: 0, n: 0 }, c = marks.ctx, k = marks.width / W, q0 = 0.8 / k;
      bleeds.push(b);
      c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgb(0,0,160)';
      c.beginPath();
      for (let i = 0, n = 2 + (Math.random() * 4 | 0); i < n; i++) {
        const a2 = Math.random() * 6.28, d = r * (0.9 + Math.random() * 1.3), q = Math.max(q0, r * (0.12 + Math.random() * 0.12));
        const px = (x + Math.cos(a2) * d) * k, py = (y + Math.sin(a2) * d) * k;
        c.moveTo(px + q * k, py); c.arc(px, py, q * k, 0, 6.3);
      }
      c.fill();
      pool(b, 0.45);
    }
    function pool(b, s) {
      const c = marks.ctx, k = marks.width / W, ca = Math.cos(b.a), sa = Math.sin(b.a);
      c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgb(0,0,110)';
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const along = (Math.random() - 0.5) * b.r * 1.5 * s, across = (Math.random() - 0.5) * b.r * 0.6 * s, q = Math.max(0.8 / k, b.r * s * (0.5 + Math.random() * 0.3));
        const px = (b.x + ca * along - sa * across) * k, py = (b.y + sa * along + ca * across) * k;
        c.moveTo(px + q * k, py); c.arc(px, py, q * k, 0, 6.3);
      }
      c.fill();
      marksDirty = true;
    }
    function trackMark(r, x, y, yaw, half, a) {
      const dist = r.tx === null ? 0 : Math.hypot(x - r.tx, y - r.tz);
      if (r.tx !== null && dist < 0.5) return;
      if (r.tx !== null && dist < 3) {
        const c = marks.ctx, k = marks.width / W, cA = Math.cos(-yaw), sA = Math.sin(-yaw), ox = -sA * half, oy = cA * half;
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = `rgba(0,${a * 58 | 0},0,1)`; c.lineWidth = Math.max(1.4, 0.2 * k);
        for (const s of [-1, 1]) { c.beginPath(); c.moveTo((r.tx + ox * s) * k, (r.tz + oy * s) * k); c.lineTo((x + ox * s) * k, (y + oy * s) * k); c.stroke(); }
        marksDirty = true;
      }
      r.tx = x; r.tz = y;
    }

    const FX = {
      bullet: [8, 6.4, 2.6], tracer: [9, 6, 2], hot: [10, 8, 5], pulse: [2, 6, 14], plasma: [8, 3, 14],
    };
    // Inked shapes the overlay draws in the pen-and-ink look: stars at muzzles, bursts at blasts.
    const inkFx = [];
    const inkAdd = o => { if (inkFx.length < 400) inkFx.push(Object.assign({ t: 0, seed: Math.random() * 1000 }, o)); };
    function shotFX(e) {
      if (e.w === 'bomb') { flyers.push({ w: 'bomb', x0: e.x, y0: e.z, z0: e.y, x1: e.tx, y1: e.tz + 0.2, z1: e.ty, t: 0, dur: e.dur, arc: 0 }); return; }
      const w = Rules.WEAPONS[e.w];
      const a = Math.atan2(e.ty - e.y, e.tx - e.x), cA = Math.cos(a), sA = Math.sin(a), s = VIS(e.x, e.y) || VIS(e.tx, e.ty);
      if (!s) return;
      const up = e.z, big = w.fx === 'shell' || w.fx === 'rocket';
      // A blow: a glint where it lands, nothing in the air.
      if (w.fx === 'melee') { inkAdd({ k: 'star', x: e.tx, y: e.tz + 0.35, z: e.ty, life: 0.09, s: 0.28 }); return; }
      // A pulse: a bolt of coloured light.
      if (w.fx === 'pulse') {
        const mx2 = e.x + cA * 0.6, my2 = e.y + sA * 0.6, c = e.w === 'plasma' ? FX.plasma : FX.pulse;
        muzzle(mx2, up, my2, 0.3);
        streak.add(mx2, up, my2, e.tx, e.tz, e.ty, 0.12, e.w === 'plasma' ? 0.12 : 0.06, c);
        glow.add(e.tx, e.tz, e.ty, 0, 0.4, 0, 0.2, 0.3, 0.1, [c[0] * 0.4, c[1] * 0.4, c[2] * 0.4, 1], [0.2, 0.4, 1, 0], 9);
        return;
      }
      const reach = big ? 1.3 : w.fx === 'tracer' ? 0.9 : 0.5;
      const mx = e.x + cA * reach, my = e.y + sA * reach;
      if (w.fx === 'bullet' || w.fx === 'tracer') {
        const jx = (Math.random() - 0.5) * 0.4, jy = (Math.random() - 0.5) * 0.4, wd = w.fx === 'tracer' ? 0.05 : 0.03;
        // Black powder leaves a white cloud hanging where it fired.
        if (w.smoke) for (let i = 0; i < 3; i++) smoke.add(mx, up, my, cA * (0.8 + i * 0.5), 0.3, sA * (0.8 + i * 0.5), 2.2, 0.2, 0.9, [2.6, 2.6, 2.5, 0.6], [2.6, 2.6, 2.5, 0], i, { drag: 2.5 });
        muzzle(mx, up, my, w.fx === 'tracer' ? 0.5 : 0.28);
        inkAdd({ k: 'star', x: mx, y: up, z: my, life: 0.08, s: w.fx === 'tracer' ? 0.42 : 0.3 });
        streak.add(mx, up, my, e.tx + jx, e.tz, e.ty + jy, 0.1, wd, FX[w.fx]);
        if (Math.random() < 0.3) glow.add(e.tx + jx, e.tz, e.ty + jy, (Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2, 0.14, 0.18, 0.04, [6, 3.6, 1.4, 1], [3, 1, 0.2, 0], 9, { grav: -8 });
        // Explosive rounds burst where they strike: flak in a black puff in the air, an autocannon's shells in a
        // small cloud on the ground.
        if (e.w === 'flak' || e.w === 'auto') {
          const air = e.tz - heightAt(M, e.tx, e.ty) > 1.5, ox = (Math.random() - 0.5) * (air ? 1.4 : 0.5), oy = (Math.random() - 0.5) * (air ? 1.4 : 0.5);
          if (VIS(e.tx, e.ty) && (air || Math.random() < 0.6)) puff(e.tx + ox, e.tz + (air ? (Math.random() - 0.3) * 0.8 : 0.15), e.ty + oy, air ? 0.75 : 0.45, air);
        }
        return;
      }
      if (w.fx === 'beam') {
        muzzle(mx, up, my, 1.6);
        for (let i = 0; i < 3; i++) streak.add(mx, up, my, e.tx, e.tz, e.ty, 0.08 + i * 0.05, 0.22 - i * 0.05, [3, 6, 14]);
        const dist = Math.hypot(e.tx - mx, e.ty - my);
        for (let i = 0; i < dist * 2; i++) { const t = i / dist / 2; glow.add(lerp(mx, e.tx, t), lerp(up, e.tz, t), lerp(my, e.ty, t), 0, 0.2, 0, 0.5, 0.26, 0.5, [0.6, 1.4, 3, 0.8], [0.1, 0.2, 0.8, 0], 8); }
        explosion(e.tx, e.tz, e.ty, 0.8, 11);
        return;
      }
      if (w.fx === 'shell') {
        muzzle(mx, up, my, 1.1);
        inkAdd({ k: 'star', x: mx, y: up, z: my, life: 0.14, s: 0.9 });
        const s0 = theme.dust;
        for (let i = 0; i < 4; i++) smoke.add(mx, up, my, cA * (3 + i), 0.3, sA * (3 + i), 1, 0.3, 1.2, [s0[0], s0[1], s0[2], 0.34], [s0[0], s0[1], s0[2], 0], i, { drag: 3 });
        streak.add(mx, up, my, e.tx, e.tz, e.ty, Math.max(0.08, e.dur), 0.07, FX.hot);
        return;
      }
      const dist = Math.hypot(e.tx - e.x, e.ty - e.y);
      const arc = w.fx === 'rocket' ? 2.2 + dist * 0.24 : w.fx === 'arrow' ? 0.4 + dist * 0.09 : w.fx === 'stone' ? 1.2 + dist * 0.22 : 0.5 + dist * 0.05;
      const src = S.byId.get(e.id), r = src && rs.get(e.id);
      if (w.fx === 'arrow') {
        // A volley: an arrow from each man of a squad, the first at the mark and the rest about it, where they stick.
        const men = src && src.d.men && r ? Math.max(1, r.alive) : 1, k = ARROWS[e.w] || 1;
        for (let i = 0; i < men; i++) {
          let x0 = mx, y0 = up + 0.3, z0 = my;
          if (src && src.d.men && r) { const [px, pz] = manAt(src.d.men, i, src.x, src.y, r.yaw); x0 = px + cA * 0.12; z0 = pz + sA * 0.12; y0 = heightAt(M, px, pz) + 0.62; }
          else if (src && !src.b) y0 = heightAt(M, e.x, e.y) + 0.7;
          const off = i ? 0.3 + Math.random() * 0.6 : 0, oa = Math.random() * 6.28, tx = e.tx + Math.cos(oa) * off, ty = e.ty + Math.sin(oa) * off;
          flyers.push({ w: e.w, fx: 'arrow', x0, y0, z0, x1: tx, y1: i ? heightAt(M, tx, ty) : e.tz, z1: ty, t: -i * 0.045, dur: e.dur * (0.94 + Math.random() * 0.12), arc: arc * (0.9 + Math.random() * 0.2), tgt: i ? 0 : e.tgt, stick: i > 0 || !e.tgt, k });
        }
        return;
      }
      // A thrown stone leaves from the engine's arm, a grenade from the thrower's hand.
      const thrown = w.fx === 'stone' && w.snd !== 'cannon', rel = src && MODELS.units[src.kind] && MODELS.units[src.kind].release;
      let x0 = mx, y0 = up, z0 = my;
      if (thrown && rel && r) { const c = Math.cos(-r.yaw), sn = Math.sin(-r.yaw); x0 = src.x + c * rel[0] * US; z0 = src.y + sn * rel[0] * US; y0 = heightAt(M, src.x, src.y) + rel[1] * US; }
      else if (thrown) y0 = up + 0.55;
      // An engine's stone leaves as its arm comes up, and lands when the rules say it does.
      const T = rel && THROWS[src.kind], delay = T ? T.snap * 0.85 : 0;
      flyers.push({ w: e.w, fx: w.fx, x0, y0, z0, x1: e.tx, y1: e.tz, z1: e.ty, t: -delay, dur: Math.max(0.2, e.dur - delay), arc, tgt: e.tgt, trail: 0, px: x0, py: y0, pz: z0, k: BALLS[e.w] || 1, spin: Math.random() * 6 });
      if (thrown) { if (rel) dustPuff(src.x, heightAt(M, src.x, src.y) + 0.06, src.y, 0.45); return; }
      muzzle(mx, up, my, w.fx === 'stone' ? 0.3 : 0.5);
      inkAdd({ k: 'star', x: mx, y: up, z: my, life: 0.1, s: w.fx === 'stone' ? 0.4 : 0.55 });
    }
    // How large each kind of arrow and thrown thing is drawn: a bolt shorter, a javelin and a ballista's bolt longer.
    const ARROWS = { xbow: 0.8, longbow: 1.15, javelin: 1.5, ballista: 2.2 };
    const BALLS = { stone: 1, trebstone: 1.35, grenade: 0.4, howitz: 0.55 };
    // Arrows and bolts stuck where they fell, and strokes of the pen: trails behind thrown stones and sketched marks.
    const stuckArrows = [], strokes = [];
    const s3 = new THREE.Vector3();
    // A stroke from a to b, w thick, as a set's instance.
    function strokeAt(set, ax, ay, az, bx, by, bz, w, color) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
      if (len < 1e-4 || w <= 0) return;
      q1.setFromEuler(e1.set(0, Math.atan2(-dz, dx), Math.asin(dy / len), 'YXZ'));
      mOut.compose(p1.set(ax, ay, az), q1, s3.set(len, w, w));
      put(set, mOut, color);
    }
    // A thing along x, at (x, y, z) and heading along (dx, dy, dz), scaled by k, and by w across.
    function alongAt(set, x, y, z, dx, dy, dz, k, w, color, roll = 0) {
      const len = Math.hypot(dx, dy, dz) || 1;
      q1.setFromEuler(e1.set(roll, Math.atan2(-dz, dx), Math.asin(clamp(dy / len, -1, 1)), 'YXZ'));
      mOut.compose(p1.set(x, y, z), q1, s3.set(k, k * w, k * w));
      put(set, mOut, color);
    }
    // Strokes added with a life: drawn on over grow seconds from wait, held, then thinned away over its last fade.
    const addStroke = o => { if (strokes.length < 1500) strokes.push(Object.assign({ t: 0, wait: 0, grow: 0, fade: 0.2, team: -1 }, o)); };
    const inkBlack = new THREE.Color(0x000000);
    function drawStrokes(dt) {
      let j = 0;
      for (const st of strokes) {
        st.t += dt;
        if (st.t >= st.life) continue;
        strokes[j++] = st;
        const t = st.t - st.wait;
        if (t < 0) continue;
        const g = st.grow > 0 ? Math.min(1, t / st.grow) : 1, f = Math.min(1, (st.life - st.t) / st.fade);
        const bx = st.ax + (st.bx - st.ax) * g, by = st.ay + (st.by - st.ay) * g, bz = st.az + (st.bz - st.az) * g;
        if (st.team >= 0) strokeAt(sets.tstroke[0], st.ax, st.ay, st.az, bx, by, bz, st.w * f, teamCol[st.team]);
        else strokeAt(sets.stroke[0], st.ax, st.ay, st.az, bx, by, bz, st.w * f, inkBlack);
      }
      strokes.length = j;
      // Arrows stand where they fell for a few seconds, then sink away.
      j = 0;
      const set = sets.arrow[0];
      for (const a of stuckArrows) {
        a.t += dt;
        if (a.t > 4.5) continue;
        stuckArrows[j++] = a;
        if (!VIS(a.x, a.z)) continue;
        const sink = a.t > 4 ? (a.t - 4) * 0.5 : 0;
        alongAt(set, a.x - a.dx * 0.13 * a.k, a.y - a.dy * 0.13 * a.k - sink, a.z - a.dz * 0.13 * a.k, a.dx, a.dy, a.dz, a.k, a.w, inkBlack, a.roll);
      }
      stuckArrows.length = j;
    }

    function stepFlyers(dt) {
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i];
        f.t += dt;
        if (f.t < 0) continue;
        const k = Math.min(1, f.t / f.dur);
        if (f.tgt) { const t = S.byId.get(f.tgt); if (t) { f.x1 = t.x; f.z1 = t.y; f.y1 = t.b ? f.y1 : heightAt(M, t.x, t.y) + (Rules.isAir(t) ? t.z : 0.5); } }
        const x = lerp(f.x0, f.x1, k), z = lerp(f.z0, f.z1, k), y = lerp(f.y0, f.y1, k) + f.arc * 4 * k * (1 - k);
        if (f.w === 'bomb') { smoke.add(x, y, z, 0, 0, 0, 0.1, 0.14, 0.1, [0.1, 0.1, 0.1, 1], [0.1, 0.1, 0.1, 0], 11); }
        // An arrow is a shaft along its flight, inked as the units are, a little thicker as the view draws back so a
        // volley still reads. One that misses stays stuck in the ground.
        else if (f.fx === 'arrow') {
          const vx = f.x1 - f.x0, vz = f.z1 - f.z0, vy = f.y1 - f.y0 + f.arc * 4 * (1 - 2 * k), wk = clamp(cam.dist / 92, 1, 2.2);
          if (VIS(x, z)) alongAt(sets.arrow[0], x, y, z, vx, vy, vz, f.k, wk, inkBlack);
          if (f.t >= f.dur && f.stick) { const n = Math.hypot(vx, vy, vz) || 1; if (stuckArrows.length < 240) stuckArrows.push({ x, y, z, dx: vx / n, dy: vy / n, dz: vz / n, k: f.k, w: wk, roll: Math.random() * 3, t: 0 }); }
        }
        // A stone tumbles along its arc, and in ink a trail of the pen follows it, so the throw reads as a curve.
        else if (f.fx === 'stone') {
          f.spin += dt * 9;
          if (VIS(x, z)) {
            q1.setFromEuler(e1.set(f.spin, f.spin * 0.6, f.spin * 0.3));
            mOut.compose(p1.set(x, y, z), q1, s3.set(f.k, f.k, f.k)); put(sets.ball[0], mOut, inkBlack);
            if (style.hud === 'ink' && f.k > 0.5) addStroke({ ax: f.px, ay: f.py, az: f.pz, bx: x, by: y, bz: z, w: 0.035 * clamp(cam.dist / 92, 0.8, 2.2) * f.k, life: 0.3, fade: 0.3 });
          }
          f.px = x; f.py = y; f.pz = z;
        }
        else if (f.w === 'nuke') {
          const hot = k > 0.8 ? 0 : 1;
          glow.add(x, y, z, 0, 0, 0, 0.12, 1.6, 0.4, [9, 6, 3, 1], [4, 1.4, 0.2, 0], 8);
          f.trail -= dt;
          if (f.trail <= 0 && hot) { f.trail = 0.02; smoke.add(x, y, z, 0, 0.1, 0, 5, 0.6, 2.2, [0.86, 0.86, 0.84, 0.7], [0.9, 0.9, 0.88, 0], (Math.random() * 4) | 0, { drag: 0.5 }); }
        } else {
          glow.add(x, y, z, 0, 0, 0, 0.06, 0.5, 0.2, [14, 8, 3, 1], [5, 1.4, 0.1, 0], 12, { rot: Math.random() * 6 });
          glow.add(x, y, z, 0, 0, 0, 0.12, 0.3, 0.1, [6, 3, 1, 0.8], [2, 0.5, 0.05, 0], 8);
          f.trail -= dt;
          if (f.trail <= 0) { f.trail = 0.016; smoke.add(x, y, z, (Math.random() - 0.5) * 0.15, 0.15, (Math.random() - 0.5) * 0.15, 1.6 + Math.random() * 1.2, 0.16, 0.95, [1.6, 1.3, 1, 0.62], [0.82, 0.78, 0.74, 0.3], (Math.random() * 4) | 0, { drag: 0.8, c2: [0.86, 0.82, 0.78, 0], mid: 0.2 }); }
        }
        if (f.t >= f.dur) flyers.splice(i, 1);
      }
      for (let i = planes.length - 1; i >= 0; i--) {
        const p = planes[i];
        p.t += dt;
        const x = p.x + p.dx * p.t, z = p.z + p.dz * p.t;
        if (x < -30 || z < -30 || x > W + 30 || z > H + 30) { planes.splice(i, 1); continue; }
        const set = sets.plane[0];
        compose(m1, x, 9, z, -Math.atan2(p.dz, p.dx), 0, 0, 1.3);
        if (set.n < set.cap) { put(set, m1, neutral); set.mesh.count = set.n; set.mesh.instanceMatrix.needsUpdate = true; set.mesh.instanceColor.needsUpdate = true; }
      }
    }

    function event(e) {
      switch (e.t) {
        case 'shot': shotFX(e); startle(e.x, e.y, 4); break;
        // Lightning leaves a burn where it strikes and startles everything near.
        case 'strike': scorch(e.x, e.y, 0.7, 0.6); startle(e.x, e.y, 10); break;
        case 'hit': {
          const w = Rules.WEAPONS[e.w];
          startle(e.x, e.y, 8); flatten(e.x, e.y, w.splash || 0.6);
          if (!VIS(e.x, e.y) || w.fx === 'arrow' || w.fx === 'melee') break;
          if (w.fx === 'stone') { dustBurst(e.x, e.z, e.y, (w.splash || 1) * 0.7); scorch(e.x, e.y, 0.6, 0.4); break; }
          // A light shell bursts in a small cloud; a rocket, a missile or a heavy shell with a wide blast in fire.
          if (w.fx === 'shell' && (w.splash || 0) <= 1.1) puff(e.x, e.z + 0.2, e.y, 0.9);
          else explosion(e.x, e.z, e.y, w.fx === 'rocket' ? 1.1 : w.fx === 'shell' ? 0.62 : 0.5, HIT_OF[w.fx]);
          if (w.fx === 'rocket' || w.fx === 'shell') scorch(e.x, e.y, w.fx === 'rocket' ? 1.1 : 0.7, 0.8);
          break;
        }
        case 'boom': {
          const y = heightAt(M, e.x, e.y);
          startle(e.x, e.y, 10 + e.size * 3); flatten(e.x, e.y, e.size * 0.8);
          if (e.size >= 8) bigBlast(e.x, y, e.y, e.size); else if (VIS(e.x, e.y)) explosion(e.x, y, e.y, e.size, e.size >= 2.5 ? 16 : 10);
          if (e.size >= 1.5) splatter(e.x, e.y, Math.min(4, e.size * 0.9));
          break;
        }
        case 'crater': if (!e.b) scorch(e.x, e.y, e.r); break;
        case 'placed': clearWrecks(e.x, e.y, (BUILDINGS[e.kind] ? Math.max(BUILDINGS[e.kind].w, BUILDINGS[e.kind].h) : 2) * 0.75); break;
        case 'launch': flyers.push({ w: 'nuke', x0: e.x, y0: terrainAt(M, e.x, e.y) + 1, z0: e.y, x1: e.tx, y1: terrainAt(M, e.tx, e.ty), z1: e.ty, t: 0, dur: e.dur, arc: 46, trail: 0 }); break;
        case 'die': onDeath(e); startle(e.x, e.y, 6); break;
        case 'upgrade': {
          // A squad that takes a new form keeps the men it has, so none fall when the count of its form differs.
          const r = rs.get(e.id), u = S.byId.get(e.id);
          if (r && u) { r.alive = u.d.men ? Math.ceil(u.hp / u.max * u.d.men) : 0; r.tm = null; r.armM = null; r.pose = null; r.morph = 0; }
          if (u && VIS(u.x, u.y)) ageMark(u.x, u.y, u.d.men ? 1 : Math.max(0.95, u.d.r * 1.45), u.team, null);
          break;
        }
        case 'tech':
          // Every building of the side takes its new age's form, each marked where it stands.
          for (const b of S.ents) if (b.b && b.team === e.team && b.hp > 0) { const r = rs.get(b.id); if (r && r.seen && VIS(b.x, b.y)) ageMark(b.x, b.y, 0, e.team, b); }
          break;
        case 'bridge': if (e.down) {
          // The span breaks along its middle and drops into the river.
          const m = M.bridges[e.i];
          for (let k = 0; k < 6; k++) {
            const t = 0.25 + k * 0.1, x = lerp(m.x0, m.x1, t), y = lerp(m.y0, m.y1, t);
            if (!VIS(x, y)) continue;
            setTimeout(() => { explosion(x, m.z, y, 1.1, 17); for (let j = 0; j < 3; j++) steam(x + (Math.random() - 0.5) * 2, M.water + 0.1, y + (Math.random() - 0.5) * 2); }, k * 120);
          }
          startle(e.x, e.y, 16);
        } break;
        case 'plane': {
          const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy) || 1;
          planes.push({ x: e.x, z: e.y, dx: dx / d * 26, dz: dy / d * 26, t: 0 });
          break;
        }
        case 'uav': if (VIS(e.x, e.y)) rings.add(e.x, heightAt(M, e.x, e.y), e.y, 14, 1.2, 0x8fd0ff); break;
        case 'incoming': if (VIS(e.x, e.y)) rings.add(e.x, heightAt(M, e.x, e.y), e.y, 1.4, 1.2, 0xff8050); break;
      }
    }

    // A thing that has just taken its new age's form: dust thrown up round its foot and, in ink, a quick loop of the
    // pen in its side's colour drawn round it and lifted, or round a building's plot a sketched frame. Daylight shows
    // a pale ring on the ground in the side's colour instead.
    function ageMark(x, y, R, team, b) {
      const g = heightAt(M, x, y), d = dustC(), n = b ? 14 : 7, rr = b ? Math.max(b.w, b.h) * 0.55 : R;
      for (let i = 0; i < n; i++) { const a = i / n * 6.283 + Math.random() * 0.5, q = rr * (0.8 + Math.random() * 0.3); smoke.add(x + Math.cos(a) * q, g + 0.08, y + Math.sin(a) * q, Math.cos(a) * 0.5, 0.35, Math.sin(a) * 0.5, 1.1 + Math.random() * 0.5, 0.35 + rr * 0.2, 1 + rr * 0.6, [d[0], d[1], d[2], 0.32], [d[0], d[1], d[2], 0], i % 4, { drag: 1.6, delay: Math.random() * 0.15 }); }
      if (style.hud !== 'ink') { rings.add(x, g, y, rr * 1.5, 0.7, teamCol[team].getHex()); return; }
      const wk = (b ? 0.034 : 0.04) * clamp(cam.dist / 92, 0.8, 2.2), lift = 0.06, life = 1.25;
      const seg = (ax, az, bx, bz, wait) => addStroke({ ax, ay: heightAt(M, ax, az) + lift, az, bx, by: heightAt(M, bx, bz) + lift, bz, w: wk, wait, grow: 0.025, life, fade: 0.4, team });
      if (b) {
        // The plot's frame, each side run a little past its corner as a draughtsman's quick lines are.
        const hx = b.w / 2 + 0.35, hz = b.h / 2 + 0.35, o = 0.3;
        const c = [[x - hx, y - hz], [x + hx, y - hz], [x + hx, y + hz], [x - hx, y + hz]];
        for (let k = 0; k < 4; k++) {
          const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, m = Math.ceil(L / 0.7);
          for (let j = 0; j < m; j++) { const t0 = j / m * (L + o * 2) - o, t1 = (j + 1) / m * (L + o * 2) - o; seg(ax + ux * t0, az + uz * t0, ax + ux * t1, az + uz * t1, k * 0.08 + j * 0.012); }
        }
        return;
      }
      // Two turns of the loop, the second a little wider and unclosed, as a pen goes round twice.
      const a0 = Math.random() * 6.283, m = 22;
      for (let j = 0; j < m * 1.75; j++) {
        const t0 = j / m, t1 = (j + 1) / m, r0 = R * (1 + 0.1 * t0), r1 = R * (1 + 0.1 * t1);
        seg(x + Math.cos(a0 + t0 * 6.283) * r0, y + Math.sin(a0 + t0 * 6.283) * r0, x + Math.cos(a0 + t1 * 6.283) * r1, y + Math.sin(a0 + t1 * 6.283) * r1, j * 0.011);
      }
    }

    function onDeath(e) {
      const r = rs.get(e.id);
      rs.delete(e.id);
      if (!VIS(e.x, e.y) && !(e.b && r && r.seen)) return;
      const y = e.b ? terrainAt(M, e.x, e.y) : heightAt(M, e.x, e.y);
      if (e.b) {
        // It falls as it stood, in its owner's age.
        const key = bkey(e.kind, e.team);
        if (r && r.y0 !== undefined) falls.push({ kind: key, base: e.kind, x: e.x, y0: r.y0, z: e.y, yaw: r.yaw, team: e.team, t: 0, dir: Math.random() < 0.5 ? -1 : 1, w: e.w, h: e.h, dust: 0 });
        pastBoxes.push({ x: e.cx, y: e.cy, w: e.w, h: e.h, ht: topOf(key), t: 0, life: 60 });
        splatter(e.x, e.y, Math.max(e.w, e.h) * 0.6);
        scorch(e.x, e.y, Math.max(e.w, e.h) * 0.9, 1);
        const n = Math.max(e.w, e.h) + 2;
        for (let i = 0; i < n; i++) {
          const ox = (Math.random() - 0.5) * e.w, oz = (Math.random() - 0.5) * e.h;
          setTimeout(() => explosion(e.x + ox, y + Math.random(), e.y + oz, 1.2 + Math.random(), BLAST_OF[e.kind]), i * 170);
        }
        explosion(e.x, y + 0.6, e.y, Math.max(e.w, e.h) * 0.7, BLAST_OF[e.kind]);
        // A ring of broken walls on the building's own outline, with gaps where it fell in.
        const per = 2 * (e.w + e.h);
        for (let s = 0; s < per; s += 0.75) {
          if (Math.random() < 0.3) continue;
          const a = s < e.w ? [e.cx + s, e.cy] : s < e.w + e.h ? [e.cx + e.w, e.cy + s - e.w] : s < 2 * e.w + e.h ? [e.cx + 2 * e.w + e.h - s, e.cy + e.h] : [e.cx, e.cy + per - s];
          wrecks.push({ rubble: true, wall: true, x: a[0], y: heightAt(M, a[0], a[1]) + 0.03, z: a[1], yaw: (s < e.w || (s >= e.w + e.h && s < 2 * e.w + e.h) ? 0 : 1.571) + (Math.random() - 0.5) * 0.4, s: 0.55 + Math.random() * 0.5, t: -1.2 - Math.random() * 0.6, smoke: 9 });
        }
        for (let i = 0; i < e.w * e.h / 2; i++) wrecks.push({ rubble: true, x: e.x + (Math.random() - 0.5) * e.w * 0.9, y: y + 0.03, z: e.y + (Math.random() - 0.5) * e.h * 0.9, yaw: Math.random() * 6.28, s: 0.7 + Math.random() * 0.9, t: -1.4 - Math.random() * 0.5, smoke: 0.2 + Math.random() * 2 });
        capWrecks();
      } else if (e.z > 0 && UNITS[e.kind].move !== 'foot') {
        explosion(e.x, y + e.z, e.y, UNITS[e.kind].hp > 200 ? 1.2 : 0.4, BLAST_OF[e.kind]);
      } else if (UNITS[e.kind].men) {
        const kept = r ? r.alive : 0;
        for (let i = 0; i < (kept || 1); i++) { const [cx, cz] = manAt(UNITS[e.kind].men, i, e.x, e.y, -e.a); corpses.push({ kind: e.kind, x: cx, y: heightAt(M, cx, cz), z: cz, yaw: -e.a, t: 0, color: teamCol[e.team] }); bleed(cx, cz, e.a); }
      } else if (OLD(e.kind)) {
        dustBurst(e.x, y, e.y, UNITS[e.kind].hp > 500 ? 1.4 : 1);
        if (MODELS.units[e.kind] && MODELS.units[e.kind].gait) bleed(e.x, e.y, e.a, 0.34);
        wrecks.push({ kind: e.kind, x: e.x, y, z: e.y, yaw: -e.a, pitch: 0, t: 0, smoke: 0 }); capWrecks(e.kind);
      } else {
        explosion(e.x, y + 0.4, e.y, UNITS[e.kind].hp > 500 ? 1.4 : 0.9, BLAST_OF[e.kind]);
        scorch(e.x, e.y, 1.1);
        wrecks.push({ kind: e.kind, x: e.x, y, z: e.y, yaw: -e.a, pitch: 0, t: 0, smoke: 0 }); capWrecks(e.kind);
      }
    }

    let motes = 0;
    // Dust in the low sun. Colour rises from nothing and falls again over the mote's life.
    function moteColor() {
      // The last particle written holds the mote. Its start and end colours are set to fade in and out.
      const c = new THREE.Color((light || theme).sunColor);
      glow.tint([c.r * 1.6, c.g * 1.4, c.b * 1.1, 0.5]);
    }
    // The view as the look frames it, by default the painted looks' 26 degree lens. cam.dist stays the distance that
    // lens would stand at, so everything sized by it holds whatever lens a look uses.
    const paintCam = (c, smooth) => ({ fov: 26, near: 2, far: 500, D: c.dist, pitch: c.pitch + (1.4 - c.pitch) * smooth(70, 175, c.dist) });
    function placeCamera() {
      const c = cam, v = (style.camera || paintCam)(c, smooth);
      if (camera.fov !== v.fov || camera.near !== v.near || camera.far !== v.far) { camera.fov = v.fov; camera.near = v.near; camera.far = v.far; camera.updateProjectionMatrix(); }
      const D = c.D = v.D;
      c.pitchNow = v.pitch;
      const cp = Math.cos(c.pitchNow), sp = Math.sin(c.pitchNow);
      const h = c.ty = M ? Math.max(terrainAt(M, clamp(c.x, 0, W), clamp(c.y, 0, H)), 0.5) * 0.4 + 0.6 : 1;
      const sx = c.shake ? (Math.random() - 0.5) * c.shake : 0, sy = c.shake ? (Math.random() - 0.5) * c.shake : 0;
      camera.position.set(c.x - Math.cos(c.yaw) * cp * D + sx, h + sp * D + sy, c.y - Math.sin(c.yaw) * cp * D);
      camera.lookAt(c.x + sx, h + sy, c.y);
      camera.updateMatrixWorld();
    }

    // A machine that has had to give up the most pixels it may (scale under 0.8) also gets the smaller shadow map.
    // px is the drawing's size in pixels and ovPx the overlay's, each the canvas's own device pixels where the page
    // knows them, so a picture at full size is shown pixel for pixel and not stretched by the browser.
    function resize(w, h, dpr, scale = 1, px = null, ovPx = null) {
      const sm = low || scale < 0.8 ? 2048 : 4096;
      if (sun.shadow.mapSize.x !== sm) { sun.shadow.mapSize.set(sm, sm); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
      const bw = px ? px[0] : Math.round(w * dpr), bh = px ? px[1] : Math.round(h * dpr);
      world.vw = w; world.vh = h; world.ovPx = ovPx;
      renderer.setPixelRatio(1);
      renderer.setSize(bw, bh, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      pp.size(bw, bh);
    }

    function frame(alpha, dt, now) {
      SH.uTime.value += dt;
      updateSky(dt);
      cam.x = clamp(cam.x, 2, W - 2); cam.y = clamp(cam.y, 2, H - 2);
      cam.shake *= Math.exp(-dt * 7); if (cam.shake < 0.01) cam.shake = 0;
      placeCamera();
      const c = cam, half = c.dist * 0.72;
      sun.target.position.set(c.x + Math.cos(c.yaw) * half * 0.15, 1, c.y + Math.sin(c.yaw) * half * 0.15);
      const dir = new THREE.Vector3(...sky.sun).normalize();
      SH.uSunDir.value.copy(dir);
      const texel = half * 2 / sun.shadow.mapSize.x;
      sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
      sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;
      sun.position.copy(sun.target.position).addScaledVector(dir, 90);
      const sc = sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 10; sc.far = 190; sc.updateProjectionMatrix();

      const sv = new THREE.Vector3(...sky.sun).applyMatrix3(new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse));
      const g2 = new THREE.Vector2(sv.x, sv.y);
      if (g2.lengthSq() < 1e-4) g2.set(-1, 0.3);
      g2.normalize();
      pp.grade.uniforms.uGlow.value.set(0.5 + g2.x * 0.78, 0.5 + g2.y * 0.62);
      pp.grade.uniforms.uAspect.value = camera.aspect;
      SH.uHazeFrom.value = (cam.D || cam.dist) - cam.dist * 0.15;
      motes -= dt;
      while (motes < 0) {
        motes += 0.03;
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * cam.dist * 0.5, mx = cam.x + Math.cos(a) * r, mz = cam.y + Math.sin(a) * r;
        glow.add(mx, (M ? heightAt(M, clamp(mx, 0, W), clamp(mz, 0, H)) : 1) + 0.6 + Math.random() * 5, mz, 0.25 + Math.random() * 0.2, 0.05, (Math.random() - 0.5) * 0.3, 7, 0.09, 0.09, [0, 0, 0, 0], [0, 0, 0, 0], 8, { delay: 0 });
        moteColor();
      }
      updateFog(dt); updateOre(); updateTrail(dt); updateScenery(dt); stepLife(dt);
      drawEntities(alpha, dt, now);
      stepFlyers(dt);
      drawStrokes(dt);
      finishSets();
      rings.step(dt);
      let j = 0;
      for (let i = 0; i < inkFx.length; i++) { const f = inkFx[i]; f.t += dt; if (f.t < f.life) inkFx[j++] = f; }
      inkFx.length = j;
      j = 0;
      for (const b of pastBoxes) { b.t += dt; if (b.t < b.life) pastBoxes[j++] = b; }
      pastBoxes.length = j;
      for (const f of flashes) { f.t += dt; f.l.intensity = f.p * Math.max(0, 1 - f.t / 0.3) ** 2; }
      const u = pp.grade.uniforms.uFlash;
      if (u.value > 0) u.value = Math.max(0, u.value - dt * 0.9);
      marksLast += dt;
      // Tread marks weather away: every five seconds the scars' green is scaled down a tenth, so one pass is gone in a
      // minute and a well-used way lasts longer. In lying snow they keep three times as long, and in mud twice, while
      // falling snow fills them a little faster than that. Scorch and blood stay.
      treadFade += dt;
      if (marks && treadFade > 5) {
        treadFade = 0;
        const c = marks.ctx, keep = sky.snow > 0.3 ? 0.93 : sky.cover > 0.3 ? 0.966 : sky.wet > 0.3 ? 0.95 : 0.9;
        c.globalCompositeOperation = 'multiply'; c.fillStyle = `rgb(255,${Math.round(255 * keep)},255)`; c.fillRect(0, 0, marks.width, marks.height);
        c.globalCompositeOperation = 'lighter'; marksDirty = true;
      }
      if (marksDirty && marksLast > 0.5) { marksTex.needsUpdate = true; marksDirty = false; marksLast = 0; }
      smoke.flush(); glow.flush();
      updateGhost();
      pp.render();
    }

    // A building's model in its side's age. A side not playing, or no game, sees the modern one.
    function bkey(kind, team) { const P = S && team >= 0 ? S.P[team] : null; return ageKey(kind, P ? P.tech : 5); }
    // A model's height, from its top, for the ghost plan's wireframes. bHeight gives a kind's in the viewer's age.
    const tops = {};
    function topOf(key) {
      if (tops[key] === undefined) {
        let top = 1;
        for (const p of MODELS.buildings[key] || []) { p.geo.computeBoundingBox(); top = Math.max(top, p.geo.boundingBox.max.y + (p.pivot ? p.pivot[1] : 0)); }
        tops[key] = top;
      }
      return tops[key];
    }
    const bHeight = kind => topOf(bkey(kind, viewTeam));
    // Buildings destroyed in sight, kept a minute as what was.
    const pastBoxes = [];

    // The building being placed shows as a pale model over cells marked good or bad.
    let ghostState = null;
    function setGhost(g) { ghostState = g; }
    function updateGhost() {
      if (!ghostCells) {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
        ghostCells = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), mat, 64);
        ghostCells.setColorAt(0, neutral);
        ghostCells.renderOrder = 12; ghostCells.frustumCulled = false; scene.add(ghostCells);
      }
      if (!ghostState) { ghostCells.count = 0; if (ghost) ghost.visible = false; SH.uBorder.value = 1; return; }
      SH.uBorder.value = 1.8;
      // A look that draws placement in its overlay, as pen and ink's ghost plan does, hides it.
      if (style.ghost3d === false) { ghostCells.count = 0; if (ghost) ghost.visible = false; return; }
      const g = ghostState, d = BUILDINGS[g.kind];
      let n = 0;
      for (let y = g.y; y < g.y + d.h; y++) for (let x = g.x; x < g.x + d.w; x++) {
        const ok = g.ok;
        m1.makeTranslation(x + 0.5, terrainAt(M, x + 0.5, y + 0.5) + 0.18, y + 0.5);
        ghostCells.setMatrixAt(n, m1); ghostCells.setColorAt(n, colA.set(ok ? 0x40ff80 : 0xff3030)); n++;
      }
      ghostCells.count = n; ghostCells.instanceMatrix.needsUpdate = true; ghostCells.instanceColor.needsUpdate = true;
      const gk = bkey(g.kind, viewTeam);
      if (!ghost || ghost.kind !== gk) {
        if (ghost) scene.remove(ghost);
        ghost = new THREE.Group(); ghost.kind = gk;
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.62, roughness: 0.6, emissive: 0x204060, emissiveIntensity: 0.5 });
        for (const p of MODELS.buildings[gk]) { const m = new THREE.Mesh(p.geo, mat); if (p.pivot) m.position.set(...p.pivot); ghost.add(m); }
        scene.add(ghost);
      }
      ghost.visible = true;
      ghost.position.set(g.x + d.w / 2, terrainAt(M, g.x + d.w / 2, g.y + d.h / 2) + 0.06, g.y + d.h / 2);
    }

    const ray = new THREE.Vector3(), ro = new THREE.Vector3();
    // Where a screen point meets the ground, by marching down the ray.
    function pick(px, py) {
      ro.set(px / world.vw * 2 - 1, 1 - py / world.vh * 2, 0.5).unproject(camera);
      ray.copy(ro).sub(camera.position).normalize();
      const o = camera.position;
      // The march starts just above the highest ground, since a long lens stands far back.
      let t = ray.y < 0 ? Math.max(0, (o.y - 30) / -ray.y) : 0, step = 1.2;
      for (let i = 0; i < 600; i++) {
        const x = o.x + ray.x * t, y = o.y + ray.y * t, z = o.z + ray.z * t;
        const h = x >= 0 && z >= 0 && x <= W && z <= H ? heightAt(M, x, z) : 0.8;
        if (y <= h) {
          if (step < 0.1) return { x, y: z };
          t -= step; step *= 0.5;
        }
        t += step;
      }
      return null;
    }

    function project(x, y, z) {
      p1.set(x, y, z).project(camera);
      return [(p1.x + 1) / 2 * world.vw, (1 - p1.y) / 2 * world.vh];
    }

    // The sidebar's pictures are the models themselves, rendered once on a plain ground.
    const GAMMA = new Uint8Array(256);
    for (let i = 0; i < 256; i++) GAMMA[i] = Math.round(255 * Math.pow(i / 255, 1 / 2.2));
    function cameos(list, team, w = 132, h = 88) {
      const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { samples: 4, type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace });
      const sc = new THREE.Scene(), cm = new THREE.PerspectiveCamera(24, w / h, 0.1, 100);
      const lamp = new THREE.DirectionalLight(0xfff0dc, 3.6); lamp.position.set(-3, 5, 4); sc.add(lamp);
      sc.add(new THREE.HemisphereLight(0xb8c8d8, 0x4a4436, 1.6));
      sc.environment = scene.environment;
      const out = {}, was = SH.uFogOn.value, oldEnv = renderer.getRenderTarget(), pix = new Uint8Array(w * h * 16);
      SH.uFogOn.value = 0;
      const oc = document.createElement('canvas'); oc.width = w * 2; oc.height = h * 2;
      const og = oc.getContext('2d');
      for (const it of list) {
        const group = new THREE.Group(), meshes = [];
        const parts = it.man ? MODELS.man[it.kind] : it.b ? MODELS.buildings[it.kind] : MODELS.units[it.kind];
        const addMesh = (geo, matrix) => { const m = new THREE.InstancedMesh(geo, paint, 1); m.setMatrixAt(0, matrix); m.setColorAt(0, teamCol[team]); m.frustumCulled = false; group.add(m); meshes.push(m); };
        if (it.man) {
          addMesh(parts[0].geo, new THREE.Matrix4());
          for (const s of [-1, 1]) addMesh(parts[1].geo, new THREE.Matrix4().makeTranslation(0, 0.31, s * 0.042));
          if (parts[2]) addMesh(parts[2].geo, new THREE.Matrix4());
        } else if (parts.some(p => p.rig)) {
          // A model with moving parts is drawn at rest, as the field draws it standing.
          const ps = parts.map(def => ({ def })); ps.gait = parts.gait;
          drawParts(ps, new THREE.Matrix4(), null, { pta: 0, ta: 0, fired: 0, d: UNITS[it.kind] || {}, cargo: 0, charge: 0 }, { alpha: 1, yaw: 0 }, 0, (p, m) => addMesh(p.def.geo, m.clone()));
        } else for (const p of parts) {
          const pv = p.pivot || [0, 0, 0], m = new THREE.Matrix4();
          if (p.parent) { const pp2 = parts.find(q => q.id === p.parent); m.makeTranslation(pp2.pivot[0] + pv[0], pp2.pivot[1] + pv[1], pp2.pivot[2] + pv[2]); if (p.tilt) m.multiply(new THREE.Matrix4().makeRotationZ(p.tilt)); }
          else m.makeTranslation(pv[0], pv[1], pv[2]);
          addMesh(p.geo, m);
        }
        sc.add(group);
        group.position.set(64, 0, 64);
        const box = new THREE.Box3();
        for (const mesh of meshes) { const g = mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox.clone().applyMatrix4(mesh.instanceMatrix ? new THREE.Matrix4().fromArray(mesh.instanceMatrix.array) : new THREE.Matrix4()); box.union(b); }
        const c = box.getCenter(new THREE.Vector3()).add(group.position), R = box.getSize(new THREE.Vector3()).length() / 2;
        const D = R / Math.sin(cm.fov * Math.PI / 360) * (it.man ? 1.04 : 0.92);
        cm.position.set(c.x + D * 0.62, c.y + D * 0.5, c.z + D * 0.62); cm.lookAt(c);
        renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cm);
        renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, pix);
        const im = og.createImageData(w * 2, h * 2);
        for (let y = 0; y < h * 2; y++) im.data.set(pix.subarray((h * 2 - 1 - y) * w * 8, (h * 2 - y) * w * 8), y * w * 8);
        // The target holds linear light, so the picture is encoded here.
        for (let i = 0; i < im.data.length; i += 4) for (let c = 0; c < 3; c++) im.data[i + c] = GAMMA[im.data[i + c]];
        og.putImageData(im, 0, 0);
        out[it.kind] = oc.toDataURL('image/png');
        sc.remove(group);
        for (const m of meshes) m.dispose();
      }
      renderer.setClearColor(0x000000, 1); renderer.setRenderTarget(oldEnv);
      SH.uFogOn.value = was; rt.dispose();
      return out;
    }

    // The units and buildings alone, white on clear, as a canvas the size of the picture. For style studies.
    function subjectCanvas() {
      const w = renderer.domElement.width, h = renderer.domElement.height, rt = new THREE.WebGLRenderTarget(w, h);
      const keep = new Set();
      for (const k in sets) for (const p of sets[k]) keep.add(p.mesh);
      const hidden = [];
      scene.traverse(o => { if ((o.isMesh || o.isPoints) && !keep.has(o) && o.visible) { o.visible = false; hidden.push(o); } });
      scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
      const px = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
      renderer.setRenderTarget(null); renderer.setClearColor(theme.shroud, 1); renderer.shadowMap.autoUpdate = true;
      scene.overrideMaterial = null;
      for (const o of hidden) o.visible = true;
      rt.dispose();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'), im = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = px[((h - 1 - y) * w + x) * 4]; const i = (y * w + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = a; }
      g.putImageData(im, 0, 0);
      return c;
    }

    const world = {
      subjectCanvas, inkFx, pastBoxes, bHeight, sky,
      get life() { return life; }, fireSpots,
      get ghostState() { return ghostState; },
      // Screen pixels to a world unit at a point, for sizing drawn marks.
      ppu(x, y, z) { p1.set(x, y, z); return world.vh / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.distanceTo(p1)); },
      setLook(name) {
        const aa = !style.create;
        style = Looks.get(name);
        if (aa !== !style.create) pp.remake();
        // A painted look draws a blast's fire from its own glow, and the flash lights cost every lit pixel every
        // frame while adding nothing it shows, so only the plain look keeps them.
        for (const f of flashes) f.l.visible = !style.create;
        SH.uTreadK.value = style.treadK ?? 0.34;
        applyLight();
        // The page dresses its panels to match.
        if (typeof document !== 'undefined') document.body.dataset.look = style.panels;
      },
      setInk(n) { inkStyle = n; },
      setRoad(n) { roadStyle = n; },
      setOre(n) { oreStyle = n; },
      study(o) { studySky = o; },
      get look() { return style.name; },
      get style() { return style; },
      cam, vw: 1, vh: 1, onScreen: [], load, frame, event, resize, pick, project, setGhost, cameos, renderer, camera, scene, place: placeCamera,
      teamCol, THEMES,
      // A building's model key in an age, and every building model's key, for the sidebar's pictures.
      ageKey, buildingKeys: Object.keys(MODELS.buildings),
      get baseImage() { return baseImage; },
      get viewTeam() { return viewTeam; },
      // Sees the whole map with no fog, as one watching a game does.
      watchAll() { viewTeam = -1; SH.uFogOn.value = 0; },
      // Where one herd of each kind stands, and a raft of ducks, for checks.
      lifeAll() { return life ? life.herds.map(h => h.kind) : []; },
      // What carries a lamp after dark: the carts or cars on the roads, which by the age, and the boats.
      lamps() { return { cars: life ? life.cars : [], boats: life ? life.boats : [], motor: worldAge() >= MOTOR_AGE }; },
      get names() { return names; },
      // The parks, and a market day called now at one of them, for checks.
      parksDebug() { return parks.map(p => ({ x: p.x, y: p.y, r: p.r, town: p.town })); },
      fairNow(i) { const p = parks[i]; if (!p || !life) return; life.fairs = life.fairs.filter(q => q.town !== p.town); const t0 = life.fairs.length; life.fairs.push({ town: p.town, x: p.x, y: p.y, t: 120, stalls: Array.from({ length: 5 }, (_, k) => ({ a: p.a + k / 5 * 6.28 + 0.3, col: STALL_C[k] })) }); const t = M.towns[p.town]; for (let k = 0; k < 24; k++) life.folk.push({ town: p.town, visitor: 120, x: t.x + (Math.random() - 0.5) * 8, y: t.y + (Math.random() - 0.5) * 8, tx: p.x, ty: p.y, v: 0, wait: Math.random() * 3, hide: 0, col: [0xf4f0e4, 0xc84a3a, 0x5a7ab0, 0xe0c060, 0x7a9a5a, 0xd8a0a0][k % 6], a: 0, ph: 0 }); for (const f of life.folk) if (f.town === p.town) { f.tx = p.x + (Math.random() - 0.5) * 4; f.ty = p.y + (Math.random() - 0.5) * 4; f.wait = 0; } return t0; },
      lifeDebug() { if (!life) return []; const out = [], seen = new Set(); for (const h of life.herds) if (!seen.has(h.kind)) { seen.add(h.kind); out.push({ kind: h.kind, x: h.deer[0].x, y: h.deer[0].y, n: h.deer.length }); } if (life.rafts[0]) out.push({ kind: 'duck', x: life.rafts[0].x, y: life.rafts[0].y, n: life.rafts[0].ducks.length }); return out; },
      visible: VIS,
      // Whether a point has been seen by the side being shown, so what is remembered there is drawn.
      known: (x, y) => viewTeam < 0 || S.P[viewTeam].seen[Rules.cellOf(x, y)] === 1,
      roadWires,
      // The roadside furniture, for checks.
      get roadside() { return scen && scen.roadside; },
      // How a unit is posed and what is in the air and on the ground, for checks.
      probe(id) { const r = rs.get(id); return { pose: r && r.pose, armA: r && r.armA, loaded: r && r.loaded, flyers: flyers.length, arrows: flyers.filter(f => f.fx === 'arrow').length, stuck: stuckArrows.length, strokes: strokes.length }; },
      focus(x, y, d) { cam.x = x; cam.y = y; if (d) cam.dist = d; },
    };
    return world;
  }

  return { create, THEMES, SLOT_COLORS, SLOT_INKS };
})();
