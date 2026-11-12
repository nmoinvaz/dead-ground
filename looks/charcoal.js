// Charcoal, kept from an earlier round and out of the menu: the graded picture pressed into toothy paper.
(() => {
  const GL = Looks.GL;
  Looks.add({
    name: 'charcoal', title: 'Charcoal', said: 'Charcoal.', hidden: true, sceneFog: false,
    create(K) {
      const { THREE, vs } = K;
      // Charcoal: the graded picture's darkness pressed into toothy paper as charcoal, with streaked strokes, drawn
      // outlines that boil, lights lifted to bare paper, and colour kept only for fire, sunset and the sides' marks.
      const charcoal = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, tSubj: { value: null }, tHeat: { value: null }, tPaper: { value: null }, res: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uK: { value: 1 } }, vertexShader: vs, depthTest: false, depthWrite: false, fragmentShader: `
        varying vec2 vUv; uniform sampler2D t, tSubj, tHeat, tPaper; uniform vec2 res; uniform float uTime, uK;
        ${GL.NOISE}
        float L(vec2 uv) { return dot(texture2D(t, uv).rgb, vec3(0.299, 0.587, 0.114)); }
        float A(vec2 uv) { return texture2D(tSubj, uv).a; }
        // Tone softened over a few pixels, as charcoal rubbed with a finger.
        float Ls(vec2 uv, vec2 k) { return (L(uv) * 2.0 + L(uv + k * vec2(3, 0)) + L(uv - k * vec2(3, 0)) + L(uv + k * vec2(0, 3)) + L(uv - k * vec2(0, 3))) / 6.0; }
        void main() {
          vec2 px = vUv * res, k = uK / res;
          // The drawing boils: lines are redrawn with a fresh small wobble eight times a second.
          float b = floor(uTime * 8.0);
          vec2 uv = vUv + (vec2(noise(px * 0.035 / uK + b * 7.1), noise(px * 0.035 / uK + b * 3.3 + 11.0)) - 0.5) * 1.6 * k;
          float l = L(uv), ls = Ls(uv, k);
          float v = clamp((mix(l, ls, 0.55) - 0.05) / 0.6, 0.0, 1.0);
          float dens = pow(1.0 - v, 1.15) * 0.9;
          vec2 g = px / uK;
          float tooth = texture2D(tPaper, g / 1024.0).r, fine = texture2D(tPaper, g / 380.0 + 0.37).r;
          vec2 q = mat2(0.86, -0.5, 0.5, 0.86) * g;
          float streak = texture2D(tPaper, vec2(q.x / 2200.0, q.y / 14.0)).g;
          float smudge = texture2D(tPaper, g / 2600.0).b;
          // Paper tooth breaks the tone in the middle values and lets it go solid in the darks and bare in the lights.
          float mid = smoothstep(0.0, 0.35, dens) * (1.0 - smoothstep(0.6, 1.0, dens));
          float cover = dens + ((tooth - 0.5) * 0.5 + (fine - 0.5) * 0.3) * mid + (streak - 0.5) * 0.34 * mid + (smudge - 0.5) * 0.1;
          cover = smoothstep(0.03, 0.97, cover);
          // Outlines from the softened tone, and a firm one round every unit and building.
          vec2 e1 = vec2(Ls(uv + k * vec2(2, 0), k) - Ls(uv - k * vec2(2, 0), k), Ls(uv + k * vec2(0, 2), k) - Ls(uv - k * vec2(0, 2), k));
          float line = smoothstep(0.07, 0.18, length(e1)) * (0.4 + 0.6 * noise(g * 0.3 + b));
          float s0 = A(uv);
          vec2 e2 = vec2(A(uv + k * vec2(1.6, 0)) - A(uv - k * vec2(1.6, 0)), A(uv + k * vec2(0, 1.6)) - A(uv - k * vec2(0, 1.6)));
          float outline = smoothstep(0.1, 0.45, length(e2));
          // Inside a unit its own detail is drawn sharper, and it keeps a light tone so it never goes blank.
          vec2 e3 = vec2(L(uv + k * vec2(1, 0)) - L(uv - k * vec2(1, 0)), L(uv + k * vec2(0, 1)) - L(uv - k * vec2(0, 1)));
          float inner = smoothstep(0.06, 0.16, length(e3)) * s0;
          cover = mix(cover, max(cover * 0.95, 0.2 + dens * 0.5), s0);
          cover = max(cover, line * 0.7);
          cover = max(cover, inner * 0.75);
          cover = max(cover, outline * 0.95);
          // The brightest ground is lifted back to bare paper with an eraser.
          cover *= 1.0 - smoothstep(0.86, 0.98, l) * 0.9 * (1.0 - s0 * 0.7);
          vec3 paper = vec3(0.87, 0.83, 0.75) * (0.95 + 0.08 * smudge) * (0.97 + 0.05 * tooth);
          vec3 ink = vec3(0.08, 0.072, 0.066);
          vec3 col = mix(paper, ink, clamp(cover, 0.0, 1.0));
          // Pastel only for the sides' markings and for fire and flashes, the drawing's one other medium.
          vec3 mk = texture2D(tSubj, uv).rgb;
          float mark = smoothstep(0.08, 0.3, max(mk.r, max(mk.g, mk.b)));
          // Laid over the charcoal like pastel, so the drawing's shading still shows through.
          vec3 hue = mk / max(0.001, max(mk.r, max(mk.g, mk.b)));
          col = mix(col, col * mix(vec3(1.0), hue, 0.8) * 1.15 + hue * 0.06, mark * 0.9);
          vec3 hz = texture2D(tHeat, vUv).rgb;
          float hm = max(hz.r, max(hz.g, hz.b)), hot = smoothstep(0.3, 1.2, hm);
          vec3 chalk = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.88, 0.6), smoothstep(1.0, 3.0, hm));
          col = mix(col, chalk, hot * 0.85);
          col *= 0.97 + 0.05 * hash(floor(g * 0.7) + b);
          vec2 o = vUv - 0.5; col *= 1.0 - dot(o, o) * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }` });
      return {
        render(K) {
          const C = charcoal.uniforms;
          if (!C.tPaper.value) C.tPaper.value = K.paper();
          C.t.value = K.ldr.texture; C.tSubj.value = K.mask(); C.tHeat.value = K.a0.texture; C.res.value.set(K.w, K.h); C.uTime.value = K.time; C.uK.value = K.h / 1080;
          K.run(charcoal, K.out);
        },
      };
    },
  });
})();
