// Dead Ground, the rules. A deterministic real-time strategy world stepped at a fixed rate, with no
// drawing, so a whole game can be played in node. Map cells are one unit wide. Heights sit on a grid
// two to the cell. A duel's map has a half turn of symmetry and the world's a quarter turn, so no side
// starts better placed.
const Rules = (() => {
  const HZ = 20, DT = 1 / HZ, RES = 2;
  // The map's size is set per game. Everything sized by it is made again when it changes.
  let W = 128, H = 128, N = W * H, VW = W * RES + 1, VH = H * RES + 1, CX = W / 2, CY = H / 2;
  let HW = Math.ceil(W / 8), heapC = new Int32Array(N * 8), heapD = new Float32Array(N * 8);
  function setSize(w) {
    if (w === W) return;
    W = H = w; N = W * H; VW = W * RES + 1; VH = H * RES + 1; CX = W / 2; CY = H / 2;
    HW = Math.ceil(W / HC); heapC = new Int32Array(N * 8); heapD = new Float32Array(N * 8);
  }
  const PI = 3.141592653589793, TAU = 6.283185307179586, HALF = 1.5707963267948966;
  // Sine, cosine and arctangent from + - * / and the square root alone, which IEEE fixes to the bit, so
  // every browser and the server step the same world. The engines' own may differ in the last place.
  function msin(x) {
    x -= TAU * Math.round(x / TAU);
    if (x > HALF) x = PI - x; else if (x < -HALF) x = -PI - x;
    const q = x * x;
    return x * (1 + q * (-1 / 6 + q * (1 / 120 + q * (-1 / 5040 + q * (1 / 362880 + q * (-1 / 39916800 + q * (1 / 6227020800 + q * (-1 / 1307674368000))))))));
  }
  const mcos = x => msin(x + HALF);
  function matan(z) {
    let s = 1;
    if (z < 0) { z = -z; s = -1; }
    const inv = z > 1;
    if (inv) z = 1 / z;
    // atan z = pi/6 + atan((z sqrt3 - 1) / (sqrt3 + z)) brings z within 0.27 of naught.
    let add = 0;
    if (z > 0.2679491924311227) { z = (z * 1.7320508075688772 - 1) / (1.7320508075688772 + z); add = PI / 6; }
    const q = z * z;
    let r = z * (1 + q * (-1 / 3 + q * (1 / 5 + q * (-1 / 7 + q * (1 / 9 + q * (-1 / 11 + q * (1 / 13 + q * (-1 / 15 + q * (1 / 17 + q * (-1 / 19))))))))));
    r += add;
    return s * (inv ? HALF - r : r);
  }
  function matan2(y, x) {
    if (x > 0) return matan(y / x);
    if (x < 0) return y >= 0 ? matan(y / x) + PI : matan(y / x) - PI;
    return y > 0 ? HALF : y < 0 ? -HALF : 0;
  }
  const mhypot = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angleTo = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };

  // Armour classes are inf, light, heavy, bld and air. `vs` scales a weapon's damage by class.
  const WEAPONS = {
    rifle: { r: 7.5, dmg: 7, cd: 0.7, fx: 'bullet', snd: 'rifle', air: true, vs: { inf: 1, light: 0.3, heavy: 0.06, bld: 0.12, air: 0.3 } },
    sniper: { r: 14, dmg: 95, cd: 3, fx: 'bullet', snd: 'sniper', vs: { inf: 1, light: 0.1, heavy: 0.02, bld: 0.02, air: 0 } },
    hero: { r: 9.5, dmg: 42, cd: 0.45, fx: 'bullet', snd: 'rifle', air: true, vs: { inf: 1, light: 0.35, heavy: 0.1, bld: 0.1, air: 0.4 } },
    atgm: { r: 9.5, dmg: 55, cd: 2.6, fx: 'missile', snd: 'missile', speed: 14, air: true, vs: { inf: 0.25, light: 1, heavy: 1, bld: 0.5, air: 0.6 } },
    hmg: { r: 8.5, dmg: 9, cd: 0.25, fx: 'bullet', snd: 'hmg', air: true, vs: { inf: 1, light: 0.5, heavy: 0.1, bld: 0.15, air: 0.5 } },
    auto: { r: 10, dmg: 22, cd: 0.55, fx: 'tracer', snd: 'auto', air: true, vs: { inf: 0.7, light: 1, heavy: 0.35, bld: 0.3, air: 0.7 } },
    cannon: { r: 11, dmg: 75, cd: 2.6, fx: 'shell', snd: 'cannon', speed: 42, splash: 1, vs: { inf: 0.4, light: 1, heavy: 1, bld: 0.7, air: 0 } },
    twin: { r: 12, dmg: 110, cd: 2.8, fx: 'shell', snd: 'cannon', speed: 42, splash: 1.3, vs: { inf: 0.45, light: 1, heavy: 1, bld: 0.8, air: 0 } },
    flak: { r: 12, dmg: 20, cd: 0.35, fx: 'tracer', snd: 'flak', air: true, vs: { inf: 0.5, light: 0.25, heavy: 0.05, bld: 0.05, air: 1.4 } },
    mlrs: { r: 24, min: 6, dmg: 60, cd: 9, salvo: 6, gap: 0.15, fx: 'rocket', snd: 'rocket', speed: 22, indirect: true, splash: 2.2, spread: 2, vs: { inf: 1, light: 0.8, heavy: 0.5, bld: 0.9, air: 0 } },
    hell: { r: 10, dmg: 120, cd: 3.5, fx: 'missile', snd: 'missile', speed: 18, air: true, vs: { inf: 0.3, light: 1, heavy: 1.1, bld: 0.7, air: 0.3 } },
    chain: { r: 8.5, dmg: 14, cd: 0.22, fx: 'tracer', snd: 'hmg', vs: { inf: 1, light: 0.6, heavy: 0.15, bld: 0.2, air: 0 } },
    mg: { r: 10, dmg: 12, cd: 0.3, fx: 'bullet', snd: 'hmg', air: true, vs: { inf: 1, light: 0.5, heavy: 0.1, bld: 0.15, air: 0.5 } },
    atgun: { r: 13, dmg: 110, cd: 3, fx: 'shell', snd: 'cannon', speed: 46, vs: { inf: 0.3, light: 1, heavy: 1, bld: 0.7, air: 0 } },
    sam: { r: 17, dmg: 130, cd: 2.2, fx: 'missile', snd: 'missile', speed: 24, air: true, onlyAir: true, vs: { air: 1 } },
    rail: { r: 16, dmg: 700, cd: 5, fx: 'beam', snd: 'rail', vs: { inf: 1, light: 1, heavy: 1, bld: 0.8, air: 0 } },
  };

  // Units. `cat` names the sidebar queue, `tech` the level that opens it, `need` the building it needs.
  const UNITS = {
    rifle: { name: 'Rifle Squad', cat: 'inf', sym: 'inf', cost: 120, time: 5, hp: 120, armor: 'inf', speed: 1.9, sight: 10, men: 5, r: 0.6, weapons: ['rifle'], move: 'foot', need: 'barracks', tech: 1, capture: true, note: 'Takes towns. Cheap and good against infantry.' },
    rocket: { name: 'Rocket Team', cat: 'inf', sym: 'at', cost: 220, time: 7, hp: 90, armor: 'inf', speed: 1.7, sight: 10, men: 3, r: 0.55, weapons: ['atgm'], move: 'foot', need: 'barracks', tech: 1, note: 'Guided rockets. Hurts vehicles and aircraft.' },
    engineer: { name: 'Engineer', cat: 'inf', sym: 'eng', cost: 300, time: 6, hp: 50, armor: 'inf', speed: 2, sight: 8, men: 1, r: 0.4, weapons: [], move: 'foot', need: 'barracks', tech: 1, engineer: true, note: 'Takes a damaged enemy building, or mends your own.' },
    sniper: { name: 'Sniper', cat: 'inf', sym: 'snp', cost: 450, time: 9, hp: 70, armor: 'inf', speed: 2.2, sight: 15, men: 1, r: 0.4, weapons: ['sniper'], move: 'foot', need: 'barracks', tech: 2, note: 'Very long range. Kills infantry, little else.' },
    hero: { name: 'Lightning', cat: 'inf', sym: 'hero', cost: 1200, time: 15, hp: 260, armor: 'inf', speed: 2.8, sight: 12, men: 1, r: 0.45, weapons: ['hero'], move: 'foot', need: 'barracks', tech: 2, hero: true, limit: 1, note: 'Your commando. Shreds infantry and blows up any building with C4.' },
    truck: { name: 'Ore Truck', cat: 'veh', sym: 'sup', cost: 700, time: 10, hp: 620, armor: 'heavy', speed: 2.6, sight: 7, r: 0.95, weapons: [], move: 'wheel', need: 'factory', tech: 1, cargo: 500, note: 'Mines ore and hauls it to a refinery.' },
    humvee: { name: 'Scout Car', cat: 'veh', sym: 'rec', cost: 260, time: 6, hp: 180, armor: 'light', speed: 5.2, sight: 14, r: 0.7, weapons: ['hmg'], move: 'wheel', need: 'factory', tech: 1, turret: 5, note: 'Fast, sees far, and guns down infantry.' },
    ifv: { name: 'Stryker IFV', cat: 'veh', sym: 'ifv', cost: 420, time: 9, hp: 320, armor: 'light', speed: 4, sight: 11, r: 0.8, weapons: ['auto'], move: 'wheel', need: 'factory', tech: 1, turret: 4, note: 'Autocannon that fights anything, a little.' },
    tank: { name: 'Battle Tank', cat: 'veh', sym: 'arm', cost: 700, oil: 25, time: 12, hp: 620, armor: 'heavy', speed: 2.9, sight: 10, r: 0.95, weapons: ['cannon'], move: 'track', need: 'factory', tech: 2, turret: 2.2, note: 'The main line. Beats vehicles, weak against rockets.' },
    flak: { name: 'Flak Track', cat: 'veh', sym: 'aa', cost: 520, oil: 15, time: 10, hp: 280, armor: 'light', speed: 3.4, sight: 11, r: 0.85, weapons: ['flak'], move: 'track', need: 'factory', tech: 2, turret: 4, note: 'Tears aircraft apart and clears infantry.' },
    support: { name: 'Support Truck', cat: 'veh', sym: 'sup2', cost: 400, oil: 10, time: 8, hp: 260, armor: 'light', speed: 3.6, sight: 9, r: 0.8, weapons: [], move: 'wheel', need: 'factory', tech: 2, repair: true, note: 'Mends nearby troops and stops attrition abroad.' },
    mlrs: { name: 'Rocket Artillery', cat: 'veh', sym: 'art', cost: 850, oil: 30, time: 13, hp: 220, armor: 'light', speed: 3, sight: 9, r: 0.9, weapons: ['mlrs'], move: 'wheel', need: 'factory', tech: 3, turret: 1.6, note: 'Salvos from far behind the line. Needs a spotter.' },
    heavy: { name: 'Goliath', cat: 'veh', sym: 'hvy', cost: 1500, oil: 60, time: 22, hp: 1500, armor: 'heavy', speed: 2, sight: 11, r: 1.25, weapons: ['twin', 'hmg'], move: 'track', need: 'factory', tech: 3, turret: 1.6, note: 'Twin-gun super heavy tank.' },
    fpv: { name: 'FPV Drone', cat: 'air', sym: 'uav', cost: 150, oil: 5, time: 3.5, hp: 12, armor: 'air', speed: 9.5, sight: 7, r: 0.3, weapons: [], move: 'air', alt: 1.5, need: 'airfield', tech: 2, kamikaze: { dmg: 340, splash: 1.8 }, life: 40, note: 'One-way attack drone. Cheap, fast, dies to anything.' },
    heli: { name: 'Attack Helicopter', cat: 'air', sym: 'hel', cost: 1100, oil: 45, time: 15, hp: 420, armor: 'air', speed: 6, sight: 12, r: 0.9, weapons: ['hell', 'chain'], move: 'air', alt: 3.4, need: 'airfield', tech: 2, turret: 3, note: 'Hunts armour and trucks. Fears flak and SAMs.' },
    jet: { name: 'Strike Jet', cat: 'air', sym: 'jet', cost: 1500, oil: 60, time: 18, hp: 300, armor: 'air', speed: 16, sight: 10, r: 0.9, weapons: [], move: 'jet', alt: 6, need: 'airfield', tech: 3, bombs: { n: 4, dmg: 320, splash: 2.6 }, note: 'Flies a bombing run, then rearms on its airfield.' },
  };

  // Buildings. `terr` is how far the building pushes your border, `power` what it gives or draws.
  const BUILDINGS = {
    hq: { name: 'Headquarters', sym: 'hq', w: 5, h: 5, hp: 2400, cost: 2500, time: 30, power: 20, terr: 24, sight: 22, armor: 'bld', cat: 'bld' },
    power: { name: 'Power Plant', sym: 'pwr', w: 3, h: 3, hp: 700, cost: 300, time: 5, power: 100, terr: 7, sight: 6, armor: 'bld', cat: 'bld', tech: 1, note: 'Every building draws power. Short of it, everything slows.' },
    refinery: { name: 'Ore Refinery', sym: 'ref', w: 4, h: 4, hp: 1000, cost: 1200, time: 11, power: -30, terr: 7, sight: 7, armor: 'bld', cat: 'bld', tech: 1, freeTruck: true, note: 'Turns ore into supply. Comes with a truck.' },
    barracks: { name: 'Barracks', sym: 'bar', w: 3, h: 3, hp: 800, cost: 400, time: 5, power: -20, terr: 7, sight: 7, armor: 'bld', cat: 'bld', tech: 1, need: 'power', note: 'Trains infantry.' },
    factory: { name: 'War Factory', sym: 'fac', w: 4, h: 4, hp: 1400, cost: 1000, time: 11, power: -30, terr: 7, sight: 7, armor: 'bld', cat: 'bld', tech: 1, need: 'refinery', note: 'Builds vehicles.' },
    radar: { name: 'Radar Station', sym: 'rad', w: 3, h: 3, hp: 800, cost: 800, time: 8, power: -40, terr: 7, sight: 16, armor: 'bld', cat: 'bld', tech: 1, need: 'refinery', note: 'Sees far and opens support calls.' },
    airfield: { name: 'Airfield', sym: 'air', w: 6, h: 4, hp: 1000, cost: 1200, time: 11, power: -30, terr: 7, sight: 8, armor: 'bld', cat: 'bld', tech: 2, need: 'factory', note: 'Launches drones, helicopters and jets.' },
    fob: { name: 'Forward Base', sym: 'fob', w: 3, h: 3, hp: 900, cost: 1000, time: 10, power: -10, terr: 18, sight: 10, armor: 'bld', cat: 'bld', tech: 2, need: 'barracks', note: 'Pushes your border far out and lets you build there.' },
    derrick: { name: 'Oil Derrick', sym: 'oil', w: 2, h: 2, hp: 500, cost: 400, time: 4, power: 0, terr: 5, sight: 6, armor: 'bld', cat: 'bld', tech: 1, well: true, yield: 1.2, note: 'Goes on an oil well in your territory. Pumps oil, which pays for armour.' },
    silo: { name: 'Missile Silo', sym: 'sil', w: 3, h: 3, hp: 1200, cost: 3000, time: 24, power: -100, terr: 7, sight: 6, armor: 'bld', cat: 'bld', tech: 3, need: 'radar', charge: 240, note: 'A thermobaric missile every four minutes. The enemy is warned.' },
    bunker: { name: 'MG Bunker', sym: 'bnk', w: 2, h: 2, hp: 600, cost: 350, time: 4, power: -5, terr: 5, sight: 11, armor: 'bld', cat: 'def', tech: 1, need: 'barracks', weapons: ['mg'], note: 'Holds off infantry.' },
    atgun: { name: 'AT Gun', sym: 'atg', w: 2, h: 2, hp: 550, cost: 600, time: 6, power: -10, terr: 5, sight: 13, armor: 'bld', cat: 'def', tech: 1, need: 'barracks', weapons: ['atgun'], turret: 2, note: 'Long-barrelled gun against vehicles.' },
    sam: { name: 'SAM Site', sym: 'sam', w: 2, h: 2, hp: 500, cost: 750, time: 7, power: -20, terr: 5, sight: 16, armor: 'bld', cat: 'def', tech: 2, need: 'radar', weapons: ['sam'], turret: 3, needsPower: true, note: 'Shoots down aircraft. Needs power.' },
    rail: { name: 'Railgun Tower', sym: 'rlg', w: 2, h: 2, hp: 700, cost: 1600, time: 12, power: -50, terr: 6, sight: 16, armor: 'bld', cat: 'def', tech: 3, need: 'radar', weapons: ['rail'], turret: 2, needsPower: true, note: 'One shot wrecks almost anything. Needs a lot of power.' },
  };

  const TECH = {
    2: { name: 'Tech Level II', cost: 1000, oil: 150, time: 20, note: 'Tanks, aircraft, Forward Bases.' },
    3: { name: 'Tech Level III', cost: 1800, oil: 400, time: 30, note: 'Artillery, Goliaths, jets, railguns, the Silo.' },
  };

  // Support calls, made from a radar station.
  const POWERS = {
    uav: { name: 'UAV Sweep', sym: 'uav', cost: 150, cd: 60, tech: 1, r: 14, life: 15, note: 'Lights up a patch of the map for a while.' },
    barrage: { name: 'Artillery Barrage', sym: 'art', cost: 500, cd: 120, tech: 2, r: 6, note: 'Twelve heavy shells on one spot.' },
    para: { name: 'Paradrop', sym: 'par', cost: 600, cd: 150, tech: 2, r: 4, note: 'Three rifle squads, anywhere you can see.' },
  };

  // A bridge stands this much damage. A house stands less, more for each floor.
  const BRIDGE_HP = 1500;
  const houseHp = h => 260 + 220 * h.floors;

  const DIFFICULTY = {
    // tech1 and tech2 are the minutes before reaching for Tech II and Tech III. gap is seconds between powers.
    // ramp caps the army at ramp[0] units plus ramp[1] a minute. def is the most defences it builds.
    recruit: { think: 4, income: 0.55, wave: 2600, grow: 300, delay: 720, power: false, tech: 2, apm: 1, tech1: 12, tech2: 99, gap: 90, silo: false, ramp: [4, 0.8], def: 2, name: 'Recruit' },
    regular: { think: 3, income: 0.7, wave: 2600, grow: 400, delay: 600, power: true, tech: 3, apm: 2, tech1: 10, tech2: 22, gap: 120, silo: false, ramp: [5, 1.2], def: 3, name: 'Regular' },
    veteran: { think: 0.75, income: 1.25, wave: 1500, grow: 1100, delay: 110, power: true, tech: 3, apm: 8, tech1: 3, tech2: 8, gap: 20, silo: true, def: 8, name: 'Veteran' },
    // Holds a player's base while they are away: builds and defends, never sets out.
    keeper: { think: 3, income: 1, wave: 1e9, grow: 0, delay: 1e9, power: false, tech: 2, apm: 2, tech1: 10, tech2: 99, gap: 90, silo: false, ramp: [8, 1], def: 6, stay: true, name: 'Keeper' },
  };

  // Seeded numbers and value noise.
  function mulberry(a) {
    return () => {
      a = (a | 0) + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function noiser(rand) {
    const g = new Float32Array(65536);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    const at = (x, y) => g[((x & 255) << 8) | (y & 255)];
    const n = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      return lerp(lerp(at(ix, iy), at(ix + 1, iy), u), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), u), v);
    };
    return (x, y, oct = 4) => {
      let s = 0, a = 0.5, f = 1;
      for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); a *= 0.5; f *= 2.03; }
      let p = 1;
      for (let i = 0; i < oct; i++) p *= 0.5;
      return s / (1 - p);
    };
  }

  // A duel's frame: u runs along the line between the bases and v across it, both from the map's middle.
  const RT = Math.SQRT1_2;
  const toXY = (u, v) => [CX + (u + v) * RT, CY + (u - v) * RT];
  const toUV = (x, y) => [(x - CX + y - CY) * RT, (x - CX - (y - CY)) * RT];
  const mirror = ([x, y]) => [W - x, H - y];
  const riverU = v => 5 * msin(v * 0.06) + 3 * msin(v * 0.13);

  // Layout of one half of a duel in (u, v). The other half is the same turned about the middle.
  const LAYOUT = {
    base: [-60, 0],
    towns: [[-22, 40], [-26, -38], [-16, 6]],
    ore: [[-53, 18, 7], [-52, -19, 6.5], [-30, 18, 6], [-18, -18, 5.5], [-30, 44, 5], [-32, -46, 5]],
    wells: [[-64, -16], [-64, 16], [-16, 28], [-26, -50], [-20, -26]],
    bridges: [0, 40, -40],
  };
  const SIZES = { duel: 128, world: 256 };

  // Where everything goes on a kind of map. syms are the turns that carry the map onto itself. Each
  // feature is listed with all of its images in a row, so one town's images sit side by side.
  function layoutFor(kind) {
    const L = { kind, roads: [], bridges: [], towns: [], ore: [], wells: [], bases: [], fords: [] };
    const all = (list, p, extra = []) => { for (const T of L.syms) { const q = T(p); list.push([q[0], q[1], ...extra]); } };
    // A ford's images, each its middle and the unit way along the river.
    const fordAt = (p, q) => { for (const T of L.syms) { const a = T(p), b = T(q), d = mhypot(b[0] - a[0], b[1] - a[1]); L.fords.push([a[0], a[1], (b[0] - a[0]) / d, (b[1] - a[1]) / d]); } };
    const R = (a, b, wig, rep = true) => L.roads.push({ a, b, wig, rep });
    if (kind === 'world') {
      const rot = ([x, y], k) => { let dx = x - CX, dy = y - CY; for (let i = 0; i < k; i++) { const t = dx; dx = -dy; dy = t; } return [CX + dx, CY + dy]; };
      L.syms = [0, 1, 2, 3].map(k => p => rot(p, k));
      const polar = (r, deg) => [CX + r * mcos(deg * PI / 180), CY + r * msin(deg * PI / 180)];
      // Two rivers cross at the middle, at 22.5 and 112.5 degrees, and part the land into quarters.
      const rivers = [22.5 * PI / 180, 22.5 * PI / 180 + HALF].map(a => [mcos(a), msin(a)]);
      const along = ([dx, dy], x, y) => { const px = x - CX, py = y - CY; return [px * dx + py * dy, -px * dy + py * dx]; };
      const fromRiver = ([dx, dy], s, t) => [CX + s * dx - t * dy, CY + s * dy + t * dx];
      L.river = (x, y) => {
        let best = 1e9, wd = 3;
        for (const r of rivers) { const [s, t] = along(r, x, y), d = Math.abs(t - riverU(s)); if (d < best) { best = d; wd = 2.2 + 0.8 * mcos(s * 0.09); } }
        return [best, wd];
      };
      L.domain = (x, y) => x + 0.5 - CX > 0 && y + 0.5 - CY > 0;
      // One quarter holds a base in the corner and one at the edge, and two towns, one between them and one
      // toward the middle. Slots run round the ring.
      const C = polar(120, 45), E = polar(95, 90);
      for (const T of L.syms) L.bases.push(T(C), T(E));
      const tOut = polar(100, 67.5), tIn = polar(52, 67.5);
      all(L.towns, tOut); all(L.towns, tIn);
      for (const b of [C, E]) {
        const m = mhypot(CX - b[0], CY - b[1]), f = [(CX - b[0]) / m, (CY - b[1]) / m], s = [-f[1], f[0]];
        all(L.ore, [b[0] + f[0] * 7 + s[0] * 18, b[1] + f[1] * 7 + s[1] * 18], [7]);
        all(L.ore, [b[0] + f[0] * 7 - s[0] * 19, b[1] + f[1] * 7 - s[1] * 19], [6.5]);
        all(L.wells, [b[0] - f[0] * 4 + s[0] * 16, b[1] - f[1] * 4 + s[1] * 16]);
        all(L.wells, [b[0] - f[0] * 4 - s[0] * 16, b[1] - f[1] * 4 - s[1] * 16]);
      }
      all(L.ore, polar(78, 67.5), [5.5]); all(L.ore, polar(30, 67.5), [5]);
      all(L.wells, polar(70, 56)); all(L.wells, polar(70, 79));
      // Two bridges on the quarter's own half river. A bridge's + end is on this quarter's side of the 22.5
      // degree river, its - end on this quarter's side of the 112.5 degree one.
      const span = (r, s) => [fromRiver(r, s, riverU(s) - 8.5), fromRiver(r, s, riverU(s) + 8.5)];
      for (const s of [45, 95]) { const [a, b] = span(rivers[0], s); for (const T of L.syms) L.bridges.push([T(a), T(b)]); }
      R(C, tOut, 2); R(E, tOut, 2); R(tOut, tIn, 3);
      R(tIn, span(rivers[0], 45)[1], 2.5); R(tIn, span(rivers[1], 45)[0], 2.5);
      R(C, span(rivers[0], 95)[1], 2.5); R(E, span(rivers[1], 95)[0], 2.5);
      for (const s of [45, 95]) { const [a, b] = span(rivers[0], s); R(a, b, 0); }
      // A ford between the two bridges, as a middle point and the river's way there.
      fordAt(fromRiver(rivers[0], 70, riverU(70)), fromRiver(rivers[0], 71, riverU(71)));
      return L;
    }
    L.syms = [p => [p[0], p[1]], mirror];
    L.river = (x, y) => { const [u, v] = toUV(x, y); return [Math.abs(u - riverU(v)), 2.2 + 0.8 * mcos(v * 0.09)]; };
    L.domain = (x, y) => { const u = toUV(x + 0.5, y + 0.5)[0]; return u < 0 || (u === 0 && x <= y); };
    const uvp = (u, v) => toXY(u, v), bu = LAYOUT.base;
    L.bases.push(uvp(bu[0], bu[1]), mirror(uvp(bu[0], bu[1])));
    LAYOUT.towns.forEach(t => all(L.towns, uvp(t[0], t[1])));
    LAYOUT.ore.forEach(t => all(L.ore, uvp(t[0], t[1]), [t[2]]));
    LAYOUT.wells.forEach(t => all(L.wells, uvp(t[0], t[1])));
    for (const v of LAYOUT.bridges) {
      const u0 = riverU(v);
      R(uvp(bu[0] + 8, v * 0.3), uvp(u0 - 8, v), 2.5);
      // The span itself, drawn once since it is its own mirror image or has a twin.
      const a = uvp(u0 - 8, v), b = uvp(u0 + 8, v);
      R(a, b, 0, false);
      if (v) R(mirror(a), mirror(b), 0, false);
    }
    R(uvp(-14, 40), uvp(-22, 40), 1); R(uvp(-14, -40), uvp(-26, -38), 1);
    R(uvp(bu[0] + 6, 0), uvp(-46, 20), 2); R(uvp(-46, 20), uvp(-22, 40), 3);
    R(uvp(bu[0] + 6, 0), uvp(-44, -18), 2); R(uvp(-44, -18), uvp(-26, -38), 3);
    for (const v of LAYOUT.bridges) {
      const u0 = riverU(v), a = uvp(u0 - 8.5, v), b = uvp(u0 + 8.5, v);
      L.bridges.push([a, b]);
      if (v) L.bridges.push([mirror(a), mirror(b)]);
    }
    fordAt(uvp(riverU(20), 20), uvp(riverU(21), 21));
    return L;
  }

  function makeMap(seed, kind = 'duel') {
    setSize(SIZES[kind]);
    const L = layoutFor(kind), K = L.syms.length;
    const rand = mulberry(seed * 2654435761 % 4294967296);
    const fbm = noiser(rand);
    const sym = (x, y, s, o) => { let t = 0; for (const T of L.syms) { const [a, b] = T([x, y]); t += fbm(a * s + 31, b * s + 17, o); } return t / K; };
    const towns = [], ore = [], wells = [], roads = [];

    // Keep hills off the places that have to stay open.
    const open = [];
    L.bases.forEach(p => open.push([p[0], p[1], 30]));
    L.towns.forEach(p => open.push([p[0], p[1], 11]));
    L.ore.forEach(p => open.push([p[0], p[1], p[2] + 3]));
    L.wells.forEach(p => open.push([p[0], p[1], 5]));
    const flatness = (x, y) => { let m = 1; for (const o of open) m = Math.min(m, smooth(o[2] * 0.75, o[2] * 1.5, mhypot(x - o[0], y - o[1]))); return m; };

    // Roads join each base to its bridges and towns.
    const road = (a, b, wig) => {
      const pts = [], len = mhypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(len / 2);
      const seedA = rand() * 100, nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
      for (let i = 0; i <= n; i++) {
        const t = i / n, s = msin(t * PI), off = wig * s * (msin(t * 7 + seedA) + 0.6 * msin(t * 13 + seedA * 2));
        pts.push([lerp(a[0], b[0], t) + nx * off, lerp(a[1], b[1], t) + ny * off]);
      }
      return pts;
    };
    for (const sp of L.roads) {
      const r = road(sp.a, sp.b, sp.wig);
      roads.push(r);
      if (sp.rep) for (let k = 1; k < K; k++) roads.push(r.map(L.syms[k]));
    }

    // Distance to the nearest road, measured to its segments so a road has straight clean edges.
    const roadDist = new Float32Array(VW * VH).fill(99);
    for (const r of roads) for (let k = 0; k + 1 < r.length; k++) {
      const [ax, ay] = r[k], [bx, by] = r[k + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6, Rr = 7;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - Rr) * RES)), i1 = Math.min(VW - 1, Math.ceil((Math.max(ax, bx) + Rr) * RES));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - Rr) * RES)), j1 = Math.min(VH - 1, Math.ceil((Math.max(ay, by) + Rr) * RES));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = i / RES - ax, py = j / RES - ay, t = clamp((px * dx + py * dy) / L2, 0, 1), d = mhypot(px - dx * t, py - dy * t), c = j * VW + i;
        if (d < roadDist[c]) roadDist[c] = d;
      }
    }

    // Height. Rolling ground, ridges that make dead ground, then the river and its banks.
    const h = new Float32Array(VW * VH), water = -0.15;
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const x = i / RES, y = j / RES, m = flatness(x, y);
      const roll = (sym(x, y, 0.035, 4) - 0.5) * 3.2;
      const big = sym(x, y, 0.024, 3);
      const rd = 1 - Math.abs(sym(x, y, 0.03, 3) - 0.5) * 7;
      const ridge = Math.max(0, rd) * Math.max(0, rd) * smooth(0.38, 0.54, big) * 7.5;
      const knoll = Math.max(0, sym(x, y, 0.07, 3) - 0.56) * 9;
      h[j * VW + i] = 1 + roll * (0.45 + 0.75 * m) + (ridge + knoll + Math.max(0, big - 0.5) * 13) * m;
    }
    // Blur a copy so roads can settle into it.
    const blur = new Float32Array(h), tmp = new Float32Array(h.length);
    for (let pass = 0; pass < 6; pass++) {
      for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
        const l = Math.max(0, i - 2), r = Math.min(VW - 1, i + 2);
        tmp[j * VW + i] = (blur[j * VW + l] + blur[j * VW + i] * 2 + blur[j * VW + r]) / 4;
      }
      for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
        const u = Math.max(0, j - 2), d = Math.min(VH - 1, j + 2);
        blur[j * VW + i] = (tmp[u * VW + i] + tmp[j * VW + i] * 2 + tmp[d * VW + i]) / 4;
      }
    }
    for (let c = 0; c < h.length; c++) h[c] = lerp(h[c], blur[c], smooth(5.5, 2, roadDist[c]));
    // How much of a ford a point is in: a strip across the river a few cells wide.
    const fordK = (x, y) => {
      let k = 0;
      for (const f of L.fords) {
        const dx = x - f[0], dy = y - f[1], a = Math.abs(dx * f[2] + dy * f[3]), b = Math.abs(dy * f[2] - dx * f[3]);
        if (a < 4.5 && b < 14) k = Math.max(k, smooth(4.5, 2.5, a));
      }
      return k;
    };
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const x = i / RES, y = j / RES, c = j * VW + i, [d, width] = L.river(x, y);
      if (d < width + 7) {
        // The bed, and at a ford a shallow one with gentle banks.
        const top = Math.min(h[c], 1.4), s = smooth(width - 1, width + 7, d), deep = lerp(-1.3, top, s), fk = fordK(x, y);
        h[c] = fk > 0 ? lerp(deep, lerp(-0.3, top, s), fk) : deep;
      }
    }

    // Decks over the water. Units walk at deck height, the terrain below stays as it was.
    const deck = new Float32Array(VW * VH), bridges = [];
    const addBridge = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = mhypot(dx, dy), ux = dx / len, uy = dy / len, wide = 3;
      const z = 0.8, br = { x0: a[0], y0: a[1], x1: b[0], y1: b[1], w: wide * 2, z, len, ux, uy, verts: [], cells: [], under: [] };
      bridges.push(br);
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - 5) * RES)), i1 = Math.min(VW - 1, Math.ceil((Math.max(a[0], b[0]) + 5) * RES));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - 5) * RES)), j1 = Math.min(VH - 1, Math.ceil((Math.max(a[1], b[1]) + 5) * RES));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i / RES - a[0], y = j / RES - a[1], t = x * ux + y * uy, s = Math.abs(-x * uy + y * ux);
        if (t >= -1 && t <= len + 1 && s <= wide) {
          const c = j * VW + i;
          deck[c] = Math.max(deck[c], z);
          br.verts.push(c);
        }
      }
    };
    // A duel lists its outer bridges twice, once as each other's mirror image. Each is kept once.
    const keyB = new Set();
    for (const [a, b] of L.bridges) {
      const k = Math.round(a[0] + b[0]) + ',' + Math.round(a[1] + b[1]);
      if (keyB.has(k)) continue;
      keyB.add(k); addBridge(a, b);
    }

    // Towns, ore and wells.
    L.towns.forEach(p => towns.push({ x: p[0], y: p[1], owner: -1, cap: 0, capTeam: -1, r: 14 }));
    towns.forEach((t, i) => { t.id = i; });
    const oreCells = new Uint16Array(N), oreRich = new Uint8Array(N), oreFields = [];
    L.ore.forEach(p => {
      const R = p[2], field = { x: p[0], y: p[1], r: R };
      oreFields.push(field);
      for (let y = Math.floor(p[1] - R - 2); y <= p[1] + R + 2; y++) for (let x = Math.floor(p[0] - R - 2); x <= p[0] + R + 2; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const d = mhypot(x + 0.5 - p[0], y + 0.5 - p[1]) + (sym(x + 0.5, y + 0.5, 0.3, 2) - 0.5) * 5;
        if (d < R) oreCells[y * W + x] = 60 + Math.round(120 * (1 - d / R));
      }
    });
    L.wells.forEach(p => wells.push({ x: Math.round(p[0]), y: Math.round(p[1]) }));

    // Cells. Bit 1 stops vehicles, bit 2 stops infantry, bit 4 forbids building. Bit 8 is standing woods,
    // which stop wheels, slow infantry and fall under tracks. Bit 16 is a ford, slow going for everyone.
    const hAt = (x, y) => { const i = clamp(Math.round(x * RES), 0, VW - 1), j = clamp(Math.round(y * RES), 0, VH - 1); return h[j * VW + i]; };
    const deckAt = (x, y) => { const i = clamp(Math.round(x * RES), 0, VW - 1), j = clamp(Math.round(y * RES), 0, VH - 1); return deck[j * VW + i]; };
    const ground = new Uint8Array(N), fordCells = [];
    // A cell's bits from the land alone, as if no bridge stood over it.
    const landBits = (x, y) => {
      let hi = -99, lo = 99;
      for (let b = 0; b <= 2; b++) for (let a = 0; a <= 2; a++) {
        const z = hAt(x + a / 2, y + b / 2);
        hi = Math.max(hi, z); lo = Math.min(lo, z);
      }
      if (lo < water + 0.1) return fordK(x + 0.5, y + 0.5) > 0.85 ? 4 | 16 : 7;
      const slope = hi - lo;
      let bits = 0;
      if (slope > 0.95) bits |= 1 | 4;
      if (slope > 1.4) bits |= 2;
      if (slope > 0.5) bits |= 4;
      return bits;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const bits = deckAt(x + 0.5, y + 0.5) > 0 ? 4 : landBits(x, y);
      ground[y * W + x] = bits;
      if (bits & 16) fordCells.push(y * W + x);
    }
    // Each bridge's cells, and what lies under them, for when it falls.
    for (const br of bridges) {
      for (let y = Math.max(0, Math.floor(Math.min(br.y0, br.y1) - 5)); y <= Math.min(H - 1, Math.ceil(Math.max(br.y0, br.y1) + 5)); y++) for (let x = Math.max(0, Math.floor(Math.min(br.x0, br.x1) - 5)); x <= Math.min(W - 1, Math.ceil(Math.max(br.x0, br.x1) + 5)); x++) {
        if (deckAt(x + 0.5, y + 0.5) <= 0) continue;
        const px = x + 0.5 - br.x0, py = y + 0.5 - br.y0, t = px * br.ux + py * br.uy, s = Math.abs(-px * br.uy + py * br.ux);
        if (t < -2 || t > br.len + 2 || s > 4) continue;
        br.cells.push(y * W + x); br.under.push(landBits(x, y));
      }
    }

    // Trees and rocks stand in woods on the slopes, never on roads or in the open places. Each is placed in
    // one part of the map and copied by the map's turns.
    const scatter = [];
    const keep = (x, y, pad = 0) => {
      for (const o of open) if (mhypot(x - o[0], y - o[1]) < o[2] * 0.85 + pad) return false;
      if (L.river(x, y)[0] < 6.5) return false;
      const c = clamp(Math.round(y * RES), 0, VH - 1) * VW + clamp(Math.round(x * RES), 0, VW - 1);
      return roadDist[c] > 3;
    };
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      if (!L.domain(x, y)) continue;
      const wood = sym(x, y, 0.06, 3), r = rand();
      const place = (k, s) => {
        const px = x + 0.25 + rand() * 0.5, py = y + 0.25 + rand() * 0.5;
        for (const T of L.syms) {
          const [qx, qy] = T([px, py]);
          scatter.push({ k, x: qx, y: qy, s, a: rand() * TAU });
          ground[clamp(qy | 0, 0, H - 1) * W + clamp(qx | 0, 0, W - 1)] |= k === 'tree' ? 4 | 8 : 7;
        }
      };
      if (!keep(x, y)) continue;
      if (wood > 0.58 && r < smooth(0.58, 0.68, wood) * 0.5) place('tree', 0.7 + rand() * 0.7);
      else if (r < 0.006) place('rock', 0.5 + rand() * 0.9);
    }

    // Town houses block their cells. A town's middle stays clear around its flag.
    const houses = [];
    for (let i = 0; i < towns.length; i += K) {
      const t = towns[i], n = 6;
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + rand() * 0.4, d = 5 + rand() * 2.2;
        const w = 2 + (rand() * 2 | 0), hh = 2 + (rand() * 2 | 0), floors = 1 + (rand() * 2.4 | 0);
        const hx = Math.round(t.x + mcos(a) * d), hy = Math.round(t.y + msin(a) * d), tone = rand();
        // Never on a road, or a town could shut a bridge.
        const rc = (hy * RES) * VW + hx * RES;
        if (roadDist[rc] < 4.5) continue;
        const x0 = hx - (w >> 1), y0 = hy - (hh >> 1);
        L.syms.forEach((T, s) => {
          const p = T([x0, y0]), q = T([x0 + w, y0 + hh]);
          const px = Math.round(Math.min(p[0], q[0])), py = Math.round(Math.min(p[1], q[1])), pw = Math.round(Math.abs(q[0] - p[0])), ph = Math.round(Math.abs(q[1] - p[1]));
          houses.push({ x: px, y: py, w: pw, h: ph, floors, tone, town: i + s });
          for (let cy = py; cy < py + ph; cy++) for (let cx = px; cx < px + pw; cx++) {
            if (cx >= 0 && cy >= 0 && cx < W && cy < H) ground[cy * W + cx] |= 7;
          }
        });
      }
    }
    const faces = L.bases.map(b => matan2(CY - b[1], CX - b[0]));
    for (const s of scatter) s.c = clamp(s.y | 0, 0, H - 1) * W + clamp(s.x | 0, 0, W - 1);
    return { W, H, seed, kind, h, deck, water, ground, ore: oreCells, oreFields, wells, towns, roads, roadDist, bridges, scatter, houses, oreRich, bases: L.bases, faces, fords: L.fords, fordCells };
  }

  // A map is kept only if vehicles can get from the first base to every other base, town and well.
  function goodMap(M) {
    const pass = new Uint8Array(N);
    for (let c = 0; c < N; c++) pass[c] = (M.ground[c] & 9) ? 0 : 1;
    const a = M.bases[0];
    const seen = new Uint8Array(N), q = [Math.floor(a[1]) * W + Math.floor(a[0]) + 4];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop(), x = c % W, y = c / W | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!seen[n] && pass[n]) { seen[n] = 1; q.push(n); }
      }
    }
    M.why = '';
    for (const b of M.bases) if (!seen[Math.floor(b[1]) * W + Math.floor(b[0]) + 4]) M.why = 'base';
    for (const t of M.towns) if (!seen[Math.floor(t.y) * W + Math.floor(t.x)]) M.why = 'town';
    for (const w of M.wells) if (!seen[w.y * W + w.x + 2]) M.why = 'well';
    return !M.why;
  }

  const hIndex = (x, y) => clamp(Math.floor(y * RES), 0, VH - 2) * VW + clamp(Math.floor(x * RES), 0, VW - 2);
  // Bilinear height of the land itself.
  function terrainAt(M, x, y) {
    const fx = clamp(x * RES, 0, VW - 1.001), fy = clamp(y * RES, 0, VH - 1.001), ix = fx | 0, iy = fy | 0, u = fx - ix, v = fy - iy, c = iy * VW + ix;
    const h = M.h;
    return lerp(lerp(h[c], h[c + 1], u), lerp(h[c + VW], h[c + VW + 1], u), v);
  }
  // Height a ground unit stands at, which is the deck on a bridge.
  function heightAt(M, x, y) {
    const d = M.deck[hIndex(x + 0.25, y + 0.25)];
    const t = terrainAt(M, x, y);
    return d > 0 ? Math.max(d, t) : t;
  }

  // The world's own random numbers, kept as one number in S so a saved world goes on the same way.
  function rngOf(S) {
    return () => {
      const a = S.rs = (S.rs | 0) + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Weather comes in spells of three minutes. A spell's kind follows from the seed and its number alone, so
  // every copy of the world has the same sky and nothing about it is saved. A game's first two are clear.
  const SPELL = 180 * HZ, BLEND = 24 * HZ;
  const WIND = { clear: 0.45, cloud: 0.6, rain: 0.7, storm: 1, fog: 0.12, snow: 0.4 };
  function spellHash(seed, k) {
    let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k | 0, 0xc2b2ae35);
    h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15;
    return h >>> 0;
  }
  function spellOf(seed, k) {
    if (k < 2) return 'clear';
    const r = spellHash(seed, k) % 100;
    return r < 36 ? 'clear' : r < 50 ? 'cloud' : r < 66 ? 'rain' : r < 75 ? 'storm' : r < 89 ? 'fog' : 'snow';
  }
  // How much a spell holds at a tick. It rises over BLEND across its start and falls across its end, so two
  // spells of one kind in a row join without a seam.
  const spellW = (k, t) => clamp((t - (k * SPELL - BLEND / 2)) / BLEND, 0, 1) * clamp(((k + 1) * SPELL + BLEND / 2 - t) / BLEND, 0, 1);
  function weatherAt(seed, t) {
    const k = Math.floor(t / SPELL), o = { clear: 0, cloud: 0, rain: 0, storm: 0, fog: 0, snow: 0, wind: [0, 0], flood: 0, cover: 0, kind: spellOf(seed, k), next: spellOf(seed, k + 1), left: (k + 1) * SPELL - t };
    for (let j = k - 1; j <= k + 1; j++) {
      const w = spellW(j, t);
      if (w <= 0) continue;
      const kd = spellOf(seed, j), a = (spellHash(seed + 77, j) % 6283) / 1000;
      o[kd] += w;
      o.wind[0] += mcos(a) * WIND[kd] * w; o.wind[1] += msin(a) * WIND[kd] * w;
    }
    o.rain = Math.min(1, o.rain + o.storm);
    // Rivers rise through a spell of rain or storm and go down over the next one and a half. Snow lies over
    // most of its spell and melts over the next.
    for (let j = k - 3; j <= k; j++) {
      const kd = spellOf(seed, j), rv = kd === 'storm' ? 1 : kd === 'rain' ? 0.55 : 0, snow = kd === 'snow';
      if (!rv && !snow) continue;
      const tau = t - j * SPELL, up = clamp(tau / (SPELL * (snow ? 0.6 : 0.8)), 0, 1), down = tau > SPELL ? clamp(1 - (tau - SPELL) / (SPELL * (snow ? 1 : 1.5)), 0, 1) : 1;
      if (snow) o.cover += up * down; else o.flood += rv * up * down;
    }
    o.cover = Math.min(1, o.cover);
    // A storm keeps every aircraft on the ground.
    o.grounded = o.storm > 0.5;
    return o;
  }
  const sky = S => S._wx && S._wx.at === S.tick ? S._wx : (S._wx = Object.assign(weatherAt(S.seed, S.tick), { at: S.tick }));
  // The time of day, from 0 at dawn round to 1. A day lasts twenty minutes and a game starts early in the morning.
  const dayAt = t => (t / (HZ * 1200) + 0.03) % 1;
  function freshPlayer(team, o = {}) {
    return {
      team, supply: o.supply || 3500, oil: o.oil || 250, tech: 1, income: 1, carried: 0,
      q: { bld: [], def: [], inf: [], veh: [], air: [], tech: [] }, prod: 0, use: 0, low: false, vis: new Uint8Array(N), seen: new Uint8Array(N),
      counts: {}, cooldown: { uav: 0, barrage: 0, para: 0 }, stats: { made: 0, lost: 0, killed: 0, razed: 0, mined: 0 }, spoke: {}, hints: {}, exposed: false,
      silo: 0, alive: true, shield: 0, born: 0,
    };
  }

  // A new game. layout is 'duel' (two sides, 128 cells) or 'world' (eight slots, 256 cells). Every slot
  // starts with a base unless `empty` is set.
  function newGame(o = {}) {
    const kind = o.layout || 'duel';
    let seed = o.seed || 1, M = makeMap(seed, kind);
    for (let tries = 0; tries < 12 && !goodMap(M); tries++) { if (o.debug) console.log('map', seed, M.why); seed += 1000; M = makeMap(seed, kind); }
    const n = M.bases.length;
    const S = {
      HZ, tick: 0, seed, layout: kind, map: M, rs: seed ^ 0x51ed, ents: [], next: 1, byId: new Map(), cmds: [], log: [], keepLog: !!o.log, ev: [], shots: [], fields: new Map(),
      fieldQueue: 0, occVer: 1, occ: new Int32Array(N), occLog: [], over: null, ais: [], sweeps: [], hash: [], bldHash: [], flights: [],
      terr: new Int8Array(N).fill(-1), infl: [], terrVer: 0, townOwnerVer: 0,
      ore: new Uint16Array(M.ore), oreVer: 0,
      P: [], bases: M.bases, faces: M.faces, _fields: new Map(),
      // The ground as it now is, which woods, bridges and fords change, and what has happened to the trees,
      // bridges and houses.
      gnd: new Uint8Array(M.ground), gndVer: 0, wood: new Uint8Array(N), woodVer: 0, burn: [], crush: [],
      bridges: M.bridges.map(() => ({ hp: BRIDGE_HP, fix: 0, c4: 0 })), hh: M.houses.map(houseHp), flooded: false,
    };
    S.rand = rngOf(S);
    for (let t = 0; t < n; t++) { S.P.push(freshPlayer(t, o)); S.infl.push(new Float32Array(N)); }
    for (const m of M.towns) m.owner = -1;
    S.towns = M.towns.map(t => Object.assign({}, t));
    if (!o.empty) for (let t = 0; t < n; t++) spawnBase(S, t);
    territory(S);
    recount(S);
    vision(S);
    return S;
  }

  // A headquarters and three units at a slot's own place, facing the middle of the map.
  function spawnBase(S, team) {
    const b = S.bases[team], a = S.faces[team], f = [mcos(a), msin(a)], s = [-f[1], f[0]];
    const at = (fw, sd) => [b[0] + f[0] * fw + s[0] * sd, b[1] + f[1] * fw + s[1] * sd];
    addBuilding(S, 'hq', team, Math.round(b[0] - 2.5), Math.round(b[1] - 2.5), true);
    spawn(S, 'rifle', team, ...at(7.0711, -2.8284)); spawn(S, 'rifle', team, ...at(7.0711, 2.8284)); spawn(S, 'humvee', team, ...at(9.1924, -0.7071));
  }
  // Everything a slot has goes, and it starts again from nothing at its place. Quietly, with no wrecks or
  // craters, when the slot is cleared for someone new.
  function razeSlot(S, team, quiet = false) {
    for (const e of S.ents) if (e.team === team && e.hp > 0) {
      e.hp = 0;
      if (!quiet) { kill(S, e, -1); continue; }
      if (!e.b) continue;
      const cells = [], prev = [];
      for (let y = e.cy; y < e.cy + e.h; y++) for (let x = e.cx; x < e.cx + e.w; x++) if (S.occ[y * W + x] === e.id) { cells.push(y * W + x); prev.push(e.id); S.occ[y * W + x] = 0; }
      S.occVer++;
      logOcc(S, cells, prev);
    }
    S.ents = S.ents.filter(e => { if (e.hp > 0) return true; S.byId.delete(e.id); return false; });
    for (const t of S.towns) { if (t.owner === team) t.owner = -1; if (t.capTeam === team) { t.capTeam = -1; t.cap = 0; } }
    S.sweeps = S.sweeps.filter(w => w.team !== team);
    S.dirty = true;
  }
  function restartSlot(S, team, o = {}) {
    razeSlot(S, team, true);
    const was = S.P[team];
    S.P[team] = freshPlayer(team, o);
    S.P[team].born = S.tick;
    S.P[team].shield = S.tick + (o.shield || 0) * HZ;
    S.P[team].vis = was.vis.fill(0); S.P[team].seen = was.seen.fill(0);
    spawnBase(S, team);
    // Armies of other sides standing on the new base's ground march off it.
    if (o.shield) {
      const b = S.bases[team];
      for (const u of S.ents) {
        if (u.b || u.team === team || u.hp <= 0 || isAir(u)) continue;
        const dx = u.x - b[0], dy = u.y - b[1], d = mhypot(dx, dy);
        if (d > 28) continue;
        const k = 34 / (d || 1), tx = clamp(b[0] + (d ? dx : 1) * k, 2, W - 2), ty = clamp(b[1] + (d ? dy : 0) * k, 2, H - 2);
        u.ord = { t: 'move', x: tx, y: ty }; u.tgt = 0; u.home = null; u.wpT = 0; u.stuck = 0;
      }
    }
    territory(S); recount(S); vision(S);
    S.ev.push({ t: 'spawned', team });
  }

  // Saving and loading a running world, for a player who joins part way through. What can be worked out
  // again from the rest is left out: the map, the occupancy grid, borders, counts and the flow fields'
  // arrays.
  const b64 = typeof Buffer !== 'undefined' ? { en: u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64'), de: s => new Uint8Array(Buffer.from(s, 'base64')) }
    : { en: u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); }, de: s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } };
  const bits = a => { const o = new Uint8Array((a.length + 7) >> 3); for (let i = 0; i < a.length; i++) if (a[i]) o[i >> 3] |= 1 << (i & 7); return b64.en(o); };
  const unbits = (s, n) => { const o = b64.de(s), a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (o[i >> 3] >> (i & 7)) & 1; return a; };
  const plain = e => { const o = {}; for (const k in e) if (k !== 'd' && k[0] !== '_') o[k] = e[k]; return o; };
  function save(S) {
    return {
      v: 1, seed: S.seed, layout: S.layout, tick: S.tick, rs: S.rs, next: S.next, occVer: S.occVer, oreVer: S.oreVer, terrVer: S.terrVer, dirty: !!S.dirty, over: S.over,
      ents: S.ents.map(plain), towns: S.towns, shots: S.shots, sweeps: S.sweeps, flights: S.flights, occLog: S.occLog,
      fields: [...S.fields].map(([k, f]) => [k, f.ver, f.used, f.made, f.reach]),
      ore: b64.en(new Uint8Array(S.ore.buffer.slice(0))),
      P: S.P.map(P => { const o = plain(P); o.vis = bits(P.vis); o.seen = bits(P.seen); o.q = {}; for (const c in P.q) o.q[c] = P.q[c].map(it => { const j = Object.assign({}, it); delete j.cost; return j; }); return o; }),
      // The ground and the trees as pairs of cell and value, only where they differ from the map's start.
      gnd: diffs(S.gnd, S.map.ground), wood: diffs(S.wood, null), gndVer: S.gndVer, woodVer: S.woodVer, burn: S.burn, bridges: S.bridges, hh: S.hh, flooded: S.flooded,
    };
  }
  function diffs(a, base) { const o = []; for (let c = 0; c < a.length; c++) if (a[c] !== (base ? base[c] : 0)) o.push(c, a[c]); return o; }
  function load(o) {
    const S = newGame({ seed: o.seed, layout: o.layout, empty: true });
    if (S.seed !== o.seed) throw new Error('map seed mismatch');
    Object.assign(S, { tick: o.tick, rs: o.rs, next: o.next, occVer: o.occVer, oreVer: o.oreVer, terrVer: o.terrVer, dirty: o.dirty, over: o.over, shots: o.shots, sweeps: o.sweeps, flights: o.flights, occLog: o.occLog || [] });
    S.towns = o.towns.map(t => Object.assign({}, t));
    S.ore = new Uint16Array(b64.de(o.ore).buffer);
    S.fields = new Map(o.fields.map(([k, v, u, m, r]) => [k, { ver: v, used: u, made: m, reach: r }]));
    S.P = o.P.map(p => {
      const P = Object.assign(freshPlayer(p.team), p);
      P.vis = unbits(p.vis, N); P.seen = unbits(p.seen, N);
      for (const c in P.q) P.q[c] = p.q[c].map(it => Object.assign({}, it, { cost: c === 'tech' ? TECH[it.level] : (UNITS[it.kind] || BUILDINGS[it.kind]) }));
      return P;
    });
    S.ents = o.ents.map(e => Object.assign({}, e, { d: e.b ? BUILDINGS[e.kind] : UNITS[e.kind] }));
    S.byId = new Map(S.ents.map(e => [e.id, e]));
    // A world saved before woods, bridges and fords could change keeps the map's own ground.
    const gd = o.gnd || [], wd = o.wood || [];
    for (let i = 0; i < gd.length; i += 2) S.gnd[gd[i]] = gd[i + 1];
    for (let i = 0; i < wd.length; i += 2) S.wood[wd[i]] = wd[i + 1];
    S.gndVer = o.gndVer || 0; S.woodVer = o.woodVer || 0; S.burn = o.burn || []; S.flooded = !!o.flooded;
    if (o.hh && o.hh.length === S.hh.length) S.hh = o.hh.slice();
    if (o.bridges && o.bridges.length === S.bridges.length) S.bridges = o.bridges.map(b => Object.assign({}, b));
    S.bridges.forEach((b, i) => { if (b.hp <= 0) for (const v of S.map.bridges[i].verts) S.map.deck[v] = 0; });
    S.occ.fill(0);
    for (const e of S.ents) if (e.b && e.hp > 0) for (let y = e.cy; y < e.cy + e.h; y++) for (let x = e.cx; x < e.cx + e.w; x++) S.occ[y * W + x] = e.id;
    const terrVer = S.terrVer;
    territory(S); S.terrVer = terrVer;
    for (const P of S.P) { P.counts = {}; P.prod = 0; P.use = 0; P.silo = 0; }
    for (const e of S.ents) {
      if (e.hp <= 0) continue;
      const P = S.P[e.team];
      P.counts[e.kind] = (P.counts[e.kind] || 0) + 1;
      if (e.b) { if (e.d.power > 0) P.prod += e.d.power; else P.use -= e.d.power; }
    }
    S.ev.length = 0;
    return S;
  }
  // A short check of the whole state, so a player's copy can be compared with the server's.
  function hashOf(S) {
    let h = 2166136261 >>> 0;
    const mix = v => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    mix(S.tick); mix(S.rs); mix(S.next); mix(S.ents.length);
    for (const e of S.ents) { mix(e.id); mix(e.team); mix(e.x * 1024); mix(e.y * 1024); mix(e.hp * 64); }
    for (const P of S.P) { mix(P.supply * 16); mix(P.oil * 16); mix(P.tech); }
    for (const t of S.towns) { mix(t.owner); mix(t.cap * 1024); }
    mix(S.gndVer); mix(S.woodVer); mix(S.burn.length);
    for (const b of S.bridges) mix(b.hp * 16);
    return h;
  }

  function cellOf(x, y) { return clamp(y | 0, 0, H - 1) * W + clamp(x | 0, 0, W - 1); }
  function ownEvent(S, team, line) {
    const P = S.P[team], key = line, last = P.spoke[key] || -1e9;
    if (S.tick - last < 15 * HZ) return;
    P.spoke[key] = S.tick;
    S.ev.push({ t: 'say', team, line });
  }

  function spawn(S, kind, team, x, y, o = {}) {
    const d = UNITS[kind];
    const u = {
      id: S.next++, kind, team, d, b: false, x, y, px: x, py: y, a: S.faces[team] || 0, pa: 0, ta: S.faces[team] || 0, pta: 0, v: 0, hp: d.hp, max: d.hp,
      ord: null, tgt: 0, cd: d.weapons.map(() => 0), z: d.alt || 0, xp: 0, vet: 0, wx: x, wy: y, wpT: 0, stuck: 0, lx: x, ly: y, flash: 0, fired: 0, anim: 0, home: null, born: S.tick,
      cargo: 0, state: 0, aimT: 0, under: 0, slot: null, life: d.life || 0, salvo: 0, salvoT: 0, ammo: d.bombs ? d.bombs.n : 0, drop: 0,
    };
    u.pa = u.a; u.pta = u.ta;
    S.ents.push(u); S.byId.set(u.id, u);
    Object.assign(u, o);
    if (d.cargo) u.ord = { t: 'harvest' };
    return u;
  }

  function fits(S, team, kind, cx, cy, ignoreTerr) {
    const d = BUILDINGS[kind], M = S.map;
    if (cx < 1 || cy < 1 || cx + d.w >= W - 1 || cy + d.h >= H - 1) return false;
    if (d.well) {
      const w = M.wells.find(e => e.x === cx + 1 && e.y === cy + 1);
      if (!w) return false;
    }
    for (let y = cy; y < cy + d.h; y++) for (let x = cx; x < cx + d.w; x++) {
      const c = y * W + x;
      if (S.occ[c] || (S.gnd[c] & 4)) return false;
      if (S.ore[c] && !d.well) return false;
      if (!ignoreTerr && S.terr[c] !== team) return false;
    }
    return true;
  }

  // Lays a building on its cells. Units standing there are pushed out by the movement code.
  function addBuilding(S, kind, team, cx, cy, instant) {
    const d = BUILDINGS[kind];
    const e = {
      id: S.next++, kind, team, d, b: true, cx, cy, w: d.w, h: d.h, x: cx + d.w / 2, y: cy + d.h / 2, hp: d.hp, max: d.hp, born: instant ? -1e6 : S.tick,
      repairing: false, tgt: 0, cd: (d.weapons || []).map(() => 0), ta: S.faces[team] || 0, pta: 0, rally: null, flash: 0, fired: 0, charge: 0, under: 0, c4: 0,
    };
    S.ents.push(e); S.byId.set(e.id, e);
    const cells = [], prev = [];
    for (let y = cy; y < cy + d.h; y++) for (let x = cx; x < cx + d.w; x++) { const c = y * W + x; cells.push(c); prev.push(S.occ[c]); S.occ[c] = e.id; }
    S.occVer++;
    logOcc(S, cells, prev);
    if (d.freeTruck && !instant) {
      const [ex, ey] = exitOf(S, e);
      spawn(S, 'truck', team, ex, ey);
    }
    territory(S); recount(S);
    return e;
  }

  // The place a unit leaves a building, and where a truck docks at a refinery. Each side's buildings
  // face the middle of the map.
  function exitOf(S, e) {
    const dx = CX - e.x, dy = CY - e.y;
    const p = Math.abs(dx) > Math.abs(dy) ? [dx > 0 ? e.cx + e.w + 0.6 : e.cx - 0.6, e.y] : [e.x, dy > 0 ? e.cy + e.h + 0.6 : e.cy - 0.6];
    if (!blocked(S, 'veh', cellOf(p[0], p[1]))) return p;
    // Something was built across the door, so use the nearest free ground.
    const c = goalCells(S, 'veh', clamp(p[0] | 0, 0, W - 1), clamp(p[1] | 0, 0, H - 1))[0];
    return [c % W + 0.5, (c / W | 0) + 0.5];
  }

  function recount(S) {
    for (const P of S.P) { P.counts = {}; P.prod = 0; P.use = 0; P.silo = 0; }
    for (const e of S.ents) {
      if (e.hp <= 0) continue;
      const P = S.P[e.team];
      P.counts[e.kind] = (P.counts[e.kind] || 0) + 1;
      if (e.b) { if (e.d.power > 0) P.prod += e.d.power; else P.use -= e.d.power; }
    }
    for (const P of S.P) {
      const was = P.low;
      P.low = P.use > P.prod;
      if (P.low && !was) ownEvent(S, P.team, 'lowpower');
    }
  }

  // Borders are the greatest reach of any source, compared side by side.
  function territory(S) {
    for (const A of S.infl) A.fill(0);
    const stamp = (A, x, y, r) => {
      const R = Math.ceil(r);
      for (let cy = Math.max(0, (y | 0) - R); cy <= Math.min(H - 1, (y | 0) + R); cy++) for (let cx = Math.max(0, (x | 0) - R); cx <= Math.min(W - 1, (x | 0) + R); cx++) {
        const v = r - mhypot(cx + 0.5 - x, cy + 0.5 - y), c = cy * W + cx;
        if (v > A[c]) A[c] = v;
      }
    };
    for (const e of S.ents) if (e.b && e.hp > 0) stamp(S.infl[e.team], e.x, e.y, e.d.terr);
    for (const t of S.towns) if (t.owner >= 0) stamp(S.infl[t.owner], t.x, t.y, t.r);
    // A cell is a side's where its reach is greatest. A tie between the greatest is nobody's.
    const n = S.infl.length, I = S.infl;
    for (let c = 0; c < N; c++) {
      let best = -1, top = 0, tie = false;
      for (let t = 0; t < n; t++) { const v = I[t][c]; if (v > top) { top = v; best = t; tie = false; } else if (v === top && v > 0) tie = true; }
      S.terr[c] = tie ? -1 : best;
    }
    S.terrVer++;
  }

  // Line of sight over the land. Dead ground is whatever this says cannot be seen.
  function los(M, ax, ay, az, bx, by, bz) {
    const d = mhypot(bx - ax, by - ay), n = Math.ceil(d / 1.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (terrainAt(M, lerp(ax, bx, t), lerp(ay, by, t)) > lerp(az, bz, t) + 0.1) return false;
    }
    return true;
  }

  const RAYS = {};
  function raysFor(r) {
    const R = Math.round(r);
    if (RAYS[R]) return RAYS[R];
    const n = Math.ceil(TAU * R * 1.1), out = [];
    for (let i = 0; i < n; i++) out.push([mcos(i / n * TAU), msin(i / n * TAU)]);
    return RAYS[R] = out;
  }

  // Sight runs along rays, keeping the steepest look-up angle so far, as a watcher on a hill would.
  function vision(S) {
    const M = S.map;
    for (const P of S.P) P.vis.fill(0);
    const light = (P, x, y, r, eye, air) => {
      const R = Math.round(r), vis = P.vis, seen = P.seen;
      const ox = x, oy = y, c0 = cellOf(ox, oy);
      vis[c0] = 1; seen[c0] = 1;
      if (air) {
        for (let cy = Math.max(0, (y - R) | 0); cy <= Math.min(H - 1, (y + R) | 0); cy++) for (let cx = Math.max(0, (x - R) | 0); cx <= Math.min(W - 1, (x + R) | 0); cx++) {
          const ex = cx + 0.5 - x, ey = cy + 0.5 - y;
          if (ex * ex + ey * ey <= r * r) { const c = cy * W + cx; vis[c] = 1; seen[c] = 1; }
        }
        return;
      }
      const z0 = terrainAt(M, ox, oy) + eye;
      for (const [dx, dy] of raysFor(r)) {
        let top = -1e9;
        for (let d = 1; d <= R; d++) {
          const px = ox + dx * d, py = oy + dy * d;
          if (px < 0 || py < 0 || px >= W || py >= H) break;
          const hz = terrainAt(M, px, py), slope = (hz + 0.5 - z0) / d;
          if (slope >= top - 0.02 || d < 3) { const c = (py | 0) * W + (px | 0); vis[c] = 1; seen[c] = 1; }
          const block = (hz - z0) / d;
          if (block > top) top = block;
        }
      }
    };
    // Fog and storm shorten everyone's sight. Radar sweeps see through them.
    const w = sky(S), fk = 1 - 0.45 * w.fog - 0.12 * w.storm, fa = 1 - 0.3 * w.fog;
    for (const e of S.ents) {
      if (e.hp <= 0) continue;
      const P = S.P[e.team];
      if (e.b) light(P, e.x, e.y, (e.d.sight + Math.max(e.w, e.h) / 2) * fk, 3, false);
      else if (e.d.move === 'air' || e.d.move === 'jet') light(P, e.x, e.y, e.d.sight * fa, 0, true);
      else light(P, e.x, e.y, e.d.sight * fk, 1.1, false);
    }
    for (const t of S.towns) if (t.owner >= 0) light(S.P[t.owner], t.x, t.y, 9 * fk, 2, false);
    for (const s of S.sweeps) if (s.until > S.tick) light(S.P[s.team], s.x, s.y, s.r, 0, true);
  }

  // Three ways of getting about: on foot, on wheels, and on tracks, which go through woods by flattening them.
  // Each is stopped by its own ground bits.
  const BIT = { foot: 2, veh: 9, track: 1 };
  const clsOf = u => u.d.move === 'foot' ? 'foot' : u.d.move === 'track' ? 'track' : 'veh';
  function blocked(S, cls, c, occ = S.occ, g = S.gnd) {
    return (g[c] & BIT[cls]) !== 0 || occ[c] !== 0;
  }
  // Each change to who stands where, or to the ground, is kept a while, so a flow field can be worked out
  // again against the ground as it was when the field was made. A player who joins part way has the fields'
  // list but not their arrays, and makes them again from this.
  function logOcc(S, cells, prev, g, gp) {
    S.occLog.push(g ? { v: S.occVer, c: cells, p: prev, g, gp } : { v: S.occVer, c: cells, p: prev });
    if (S.occLog.length > 96) S.occLog.shift();
  }
  function setGround(S, cells, bits) {
    if (!cells.length) return;
    const prev = [];
    for (let i = 0; i < cells.length; i++) { prev.push(S.gnd[cells[i]]); S.gnd[cells[i]] = bits[i]; }
    S.occVer++; S.gndVer++;
    logOcc(S, [], [], cells.slice(), prev);
  }
  const oldestOcc = S => S.occLog.length ? S.occLog[0].v - 1 : S.occVer;
  // Who stood where and what the ground was, at an earlier version.
  function stateAt(S, ver) {
    if (ver === S.occVer) return [S.occ, S.gnd];
    const o = new Int32Array(S.occ), g = new Uint8Array(S.gnd);
    for (let i = S.occLog.length - 1; i >= 0 && S.occLog[i].v > ver; i--) {
      const L = S.occLog[i];
      for (let k = 0; k < L.c.length; k++) o[L.c[k]] = L.p[k];
      if (L.g) for (let k = 0; k < L.g.length; k++) g[L.g[k]] = L.gp[k];
    }
    return [o, g];
  }
  // Flow fields. One field per class and goal, shared by everyone going there. Which fields exist, how old
  // and when last used is part of the world; their arrays are not, and are made when first needed.
  // need is how far from the goal the asker stands. A field reaches some way past that and is made again,
  // further out, for someone beyond it. After the ground changes a field is kept three seconds more before
  // it is made again, and at most four are made in a step.
  function field(S, cls, gx, gy, need = 0) {
    const key = (cls === 'foot' ? 0 : cls === 'veh' ? 1 : 2) * N + gy * W + gx;
    let f = S.fields.get(key);
    if (f && f.ver < oldestOcc(S)) { S.fields.delete(key); S._fields.delete(key); f = null; }
    const enough = f && f.reach >= need;
    if (enough && (f.ver === S.occVer || S.fieldQueue >= 4 || S.tick - f.made < 60)) { f.used = S.tick; return built(S, key, f, cls, gx, gy); }
    if (S.fieldQueue >= 4) return null;
    S.fieldQueue++;
    if (!f) {
      if (S.fields.size >= 48) {
        let oldest = null, age = Infinity;
        for (const [k, v] of S.fields) if (v.used < age) { age = v.used; oldest = k; }
        S.fields.delete(oldest); S._fields.delete(oldest);
      }
      f = { ver: 0, used: 0, made: 0, reach: 0 };
      S.fields.set(key, f);
    }
    f.reach = Math.max(f.ver === S.occVer ? f.reach : 0, Math.fround(need * 1.5 + 32));
    f.ver = S.occVer; f.used = S.tick; f.made = S.tick;
    return built(S, key, f, cls, gx, gy);
  }
  function built(S, key, f, cls, gx, gy) {
    let p = S._fields.get(key);
    if (p && p.ver === f.ver && p.reach === f.reach) return p;
    if (!p) { p = { dist: new Float32Array(N), dir: new Int8Array(N) }; S._fields.set(key, p); }
    p.ver = f.ver; p.reach = f.reach;
    const [occ, gnd] = stateAt(S, f.ver);
    fill(S, p, cls, gx, gy, occ, gnd, f.reach);
    return p;
  }
  // Dijkstra from the goal over a grid of what blocks this class, with roads a little cheaper, and woods
  // and fords dearer.
  let fillBlock = null;
  function fill(S, f, cls, gx, gy, occ, g, reach = Infinity) {
    const M = S.map, bit = BIT[cls], woodC = cls === 'track' ? 3 : 1.6;
    if (!M.roadCell) { M.roadCell = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) M.roadCell[y * W + x] = M.roadDist[(y * RES) * VW + x * RES] < 2 ? 1 : 0; }
    if (!fillBlock || fillBlock.length !== N) fillBlock = new Uint8Array(N);
    const block = fillBlock, road = M.roadCell;
    for (let c = 0; c < N; c++) block[c] = (g[c] & bit) !== 0 || occ[c] !== 0 ? 1 : 0;
    const dist = f.dist, dir = f.dir;
    dist.fill(Infinity); dir.fill(-1);
    let n = 0;
    const push = (c, d) => {
      let i = n++;
      while (i > 0) { const p = (i - 1) >> 1; if (heapD[p] <= d) break; heapD[i] = heapD[p]; heapC[i] = heapC[p]; i = p; }
      heapD[i] = d; heapC[i] = c;
    };
    const pop = () => {
      const top = heapC[0], d = heapD[--n], c = heapC[n];
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= n) break;
        if (k + 1 < n && heapD[k + 1] < heapD[k]) k++;
        if (heapD[k] >= d) break;
        heapD[i] = heapD[k]; heapC[i] = heapC[k]; i = k;
      }
      heapD[i] = d; heapC[i] = c;
      return top;
    };
    const seeds = goalCells(S, cls, gx, gy, occ, g);
    for (const c of seeds) { dist[c] = 0; push(c, 0); }
    const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
    const COST = [1, 1.41, 1, 1.41, 1, 1.41, 1, 1.41];
    while (n > 0) {
      const dTop = heapD[0];
      // Everything left is further than the field needs to reach.
      if (dTop > reach) break;
      const c = pop();
      if (dTop > dist[c]) continue;
      const x = c % W, y = (c - x) / W, dc = dist[c];
      for (let i = 0; i < 8; i++) {
        const nx = x + DX[i], ny = y + DY[i];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const m = ny * W + nx;
        if (block[m]) continue;
        if ((i & 1) && (block[y * W + nx] || block[ny * W + x])) continue;
        // Rounded to the array's own precision, so a cell is never queued again for the same distance.
        const gm = g[m], nd = Math.fround(dc + COST[i] * (road[m] ? 0.8 : 1) * (gm & 8 ? woodC : 1) * (gm & 16 ? 2 : 1));
        if (nd < dist[m]) { dist[m] = nd; dir[m] = (i + 4) & 7; push(m, nd); }
      }
    }
  }
  // A goal on something solid means the free cells around it.
  function goalCells(S, cls, gx, gy, occ = S.occ, g = S.gnd) {
    const c = gy * W + gx;
    if (!blocked(S, cls, c, occ, g)) return [c];
    for (let r = 1; r < 24; r++) {
      const out = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const m = y * W + x;
        if (!blocked(S, cls, m, occ, g)) out.push(m);
      }
      if (out.length) return out;
    }
    return [c];
  }
  function lineClear(S, cls, ax, ay, bx, by) {
    const d = mhypot(bx - ax, by - ay), n = Math.ceil(d * 2);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (blocked(S, cls, cellOf(lerp(ax, bx, t), lerp(ay, by, t)))) return false;
    }
    return true;
  }
  const FDX = [1, 1, 0, -1, -1, -1, 0, 1], FDY = [0, 1, 1, 1, 0, -1, -1, -1];
  // Looks ahead along the field for the farthest point in a straight, clear line.
  function waypoint(S, u, tx, ty) {
    const cls = clsOf(u), far = mhypot(tx - u.x, ty - u.y);
    if (far < 16 && lineClear(S, cls, u.x, u.y, tx, ty)) return [tx, ty];
    // From afar the way leads to the middle of the goal's block of four by four cells, so a group and
    // anyone going near the same place share one field. Close in it leads to the goal's own cell.
    const q = far > 24;
    const gx = clamp(q ? (tx >> 2) * 4 + 2 : tx | 0, 0, W - 1), gy = clamp(q ? (ty >> 2) * 4 + 2 : ty | 0, 0, H - 1);
    let f = field(S, cls, gx, gy, far);
    if (!f) return [u.x, u.y];
    // Beyond the field's reach by the way round, so ask for one that reaches further.
    if (f.dist[cellOf(u.x, u.y)] === Infinity && f.reach < 2048) f = field(S, cls, gx, gy, f.reach * 2) || f;
    let c = cellOf(u.x, u.y);
    if (f.dir[c] < 0 && f.dist[c] !== 0) {
      // Standing somewhere the field never reached, so walk to the best neighbour.
      let best = -1, bd = Infinity, x = c % W, y = c / W | 0;
      for (let r = 1; r < 6 && best < 0; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const m = ny * W + nx;
        if (f.dist[m] < bd) { bd = f.dist[m]; best = m; }
      }
      if (best < 0) return null;
      return [best % W + 0.5, (best / W | 0) + 0.5];
    }
    let bx = u.x, by = u.y, wx = (c % W) + 0.5, wy = (c / W | 0) + 0.5;
    for (let i = 0; i < 10; i++) {
      const dir = f.dir[c];
      if (dir < 0) break;
      const x = c % W + FDX[dir], y = (c / W | 0) + FDY[dir];
      c = y * W + x;
      const px = x + 0.5, py = y + 0.5;
      if (lineClear(S, cls, bx, by, px, py)) { wx = px; wy = py; } else break;
    }
    return [wx, wy];
  }

  // Grid of who is where, for neighbours and targets.
  const HC = 8;
  function rehash(S) {
    const h = S.hash;
    for (let i = 0; i < HW * HW; i++) { if (h[i]) h[i].length = 0; else h[i] = []; }
    for (const e of S.ents) {
      if (e.hp <= 0 || e.drop > 0) continue;
      const i = clamp(e.y / HC | 0, 0, HW - 1) * HW + clamp(e.x / HC | 0, 0, HW - 1);
      h[i].push(e);
    }
  }
  function near(S, x, y, r, fn) {
    const x0 = clamp((x - r - 4) / HC | 0, 0, HW - 1), x1 = clamp((x + r + 4) / HC | 0, 0, HW - 1);
    const y0 = clamp((y - r - 4) / HC | 0, 0, HW - 1), y1 = clamp((y + r + 4) / HC | 0, 0, HW - 1);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const b = S.hash[j * HW + i];
      for (let k = 0; k < b.length; k++) fn(b[k]);
    }
  }
  // Distance from a point to a unit's middle, or to a building's nearest edge.
  function gap(x, y, t) {
    if (!t.b) return mhypot(t.x - x, t.y - y);
    const dx = Math.max(t.cx - x, 0, x - (t.cx + t.w)), dy = Math.max(t.cy - y, 0, y - (t.cy + t.h));
    return mhypot(dx, dy);
  }
  const isAir = e => !e.b && (e.d.move === 'air' || e.d.move === 'jet');
  const groundZ = (S, e) => e.b ? terrainAt(S.map, e.x, e.y) + 1.2 : heightAt(S.map, e.x, e.y) + (isAir(e) ? e.z : 0.7);
  const armed = e => (e.d.weapons || []).length > 0 || e.d.kamikaze;
  function canHit(wn, t) {
    const w = WEAPONS[wn];
    if (isAir(t)) return !!w.air;
    return !w.onlyAir;
  }
  function seenBy(S, team, t) {
    const vis = S.P[team].vis;
    if (!t.b) return vis[cellOf(t.x, t.y)] === 1;
    for (let y = t.cy; y < t.cy + t.h; y++) for (let x = t.cx; x < t.cx + t.w; x++) if (vis[y * W + x]) return true;
    return false;
  }
  function inRange(S, s, wn, t, slack = 0) {
    const w = WEAPONS[wn], d = gap(s.x, s.y, t);
    const up = (s.b ? terrainAt(S.map, s.x, s.y) : heightAt(S.map, s.x, s.y)) - (t.b ? terrainAt(S.map, t.x, t.y) : heightAt(S.map, t.x, t.y));
    const reach = w.r * (up > 1 && !isAir(s) ? 1.15 : 1) + slack;
    return d <= reach && (!w.min || d >= w.min);
  }
  function clearShot(S, s, wn, t) {
    const w = WEAPONS[wn];
    if (w.indirect || isAir(s) || isAir(t)) return true;
    return los(S.map, s.x, s.y, groundZ(S, s) + (s.b ? 1 : 0.3), t.x, t.y, groundZ(S, t));
  }
  // Picks what a unit should shoot, threats first, then whatever else is near.
  function acquire(S, u, radius) {
    let best = null, score = Infinity;
    const list = u.d.weapons || [];
    near(S, u.x, u.y, radius, t => {
      if (t.team === u.team || t.hp <= 0 || t.drop > 0 || atPeace(S, u.team, t.team)) return;
      const d = gap(u.x, u.y, t);
      if (d > radius) return;
      let usable = false;
      for (const wn of list) if (canHit(wn, t)) usable = true;
      if (!usable || !seenBy(S, u.team, t)) return;
      let s = d;
      if (t.b) s += armed(t) ? 6 : 14;
      else if (!armed(t)) s += 5;
      if (s < score) { score = s; best = t; }
    });
    return best;
  }

  // The best of a marked group for this unit: what its weapons hurt most, near, and not already well covered.
  function pickFrom(S, u, ids, load) {
    let best = 0, top = 0;
    for (const id of ids) {
      const t = S.byId.get(id);
      if (!t || t.hp <= 0 || t.team === u.team || t.drop > 0 || shielded(S, t.team)) continue;
      let eff = 0;
      for (const wn of u.d.weapons || []) if (canHit(wn, t)) { const w = WEAPONS[wn]; eff = Math.max(eff, (w.vs[t.d.armor] ?? 1) * w.dmg * (w.salvo || 1) / w.cd); }
      if (u.d.kamikaze) eff = t.b ? 0.2 : t.d.armor === 'inf' ? 0.4 : 1;
      if (!eff) continue;
      const share = load ? (load.get(id) || 0) / Math.max(60, t.hp) : 0;
      const score = eff / (1 + 0.04 * gap(u.x, u.y, t)) / (1 + share);
      if (score > top) { top = score; best = id; }
    }
    return best;
  }

  function reward(S, by, t) {
    const a = S.byId.get(by);
    if (!a || a.b) return;
    a.xp += (t.d.cost || 200) / (a.d.cost || 200);
    const v = a.xp >= 6 ? 3 : a.xp >= 3 ? 2 : a.xp >= 1.2 ? 1 : 0;
    if (v > a.vet) { a.vet = v; a.hp = Math.min(a.max, a.hp + a.max * 0.25); S.ev.push({ t: 'vet', id: a.id, team: a.team, x: a.x, y: a.y, v }); }
  }

  // A newcomer is shielded for a while, and the peace runs both ways: nothing of theirs aims at or hurts another
  // side, and nothing of another side's aims at or hurts theirs. It ends early when they give an order to attack.
  const shielded = (S, team) => team >= 0 && !!S.P[team] && (S.P[team].shield || 0) > S.tick;
  const atPeace = (S, a, b) => a !== b && (shielded(S, a) || shielded(S, b));
  function hurt(S, t, dmg, team, by) {
    if (t.hp <= 0) return;
    if (team >= 0 && atPeace(S, team, t.team)) return;
    t.hp -= dmg;
    t.under = S.tick;
    const P = S.P[t.team];
    if (t.b && t.team !== team) { ownEvent(S, t.team, 'baseattack'); S.ev.push({ t: 'alert', team: t.team, x: t.x, y: t.y }); }
    else if (!t.b && t.d.cargo) { ownEvent(S, t.team, 'truckattack'); S.ev.push({ t: 'alert', team: t.team, x: t.x, y: t.y }); }
    // A unit under fire with nothing better to do answers it.
    if (!t.b && by && !t.ord && !t.tgt && armed(t)) t.tgt = by;
    if (t.hp <= 0) {
      kill(S, t, team);
      if (S.P[team] && team !== t.team) S.P[team].stats[t.b ? 'razed' : 'killed']++;
      P.stats.lost++;
      reward(S, by, t);
    }
  }

  function kill(S, t, team) {
    t.hp = 0;
    S.ev.push({ t: 'die', id: t.id, kind: t.kind, team: t.team, x: t.x, y: t.y, b: t.b, z: isAir(t) ? t.z : 0, a: t.a, w: t.w, h: t.h, vet: t.vet });
    if (t.b) {
      const cells = [], prev = [];
      for (let y = t.cy; y < t.cy + t.h; y++) for (let x = t.cx; x < t.cx + t.w; x++) if (S.occ[y * W + x] === t.id) { cells.push(y * W + x); prev.push(t.id); S.occ[y * W + x] = 0; }
      S.occVer++;
      logOcc(S, cells, prev);
      S.dirty = true;
      S.ev.push({ t: 'crater', x: t.x, y: t.y, r: Math.max(t.w, t.h) * 0.8, b: true, w: t.w, h: t.h, cx: t.cx, cy: t.cy });
      if (t.kind === 'hq') S.P[t.team].exposed = true;
    } else if (!t.d.men && (S.gnd[cellOf(t.x, t.y)] & 8)) ignite(S, t.x, t.y, 1.2, 0.45);
  }

  function blast(S, x, y, r, dmg, wvs, team, by, friendly, spareBridge = -1) {
    near(S, x, y, r, t => {
      if (t.hp <= 0 || (!friendly && t.team === team) || isAir(t)) return;
      const d = gap(x, y, t);
      if (d > r) return;
      const f = 1 - 0.6 * d / r;
      hurt(S, t, dmg * f * (wvs ? (wvs[t.d.armor] ?? 1) : 1), team, by);
    });
    // A blast on a bridge wears it down a little, and one among houses knocks them about.
    const bld = (wvs ? (wvs.bld ?? 1) : 1) * dmg;
    S.map.bridges.forEach((m, i) => {
      if (i === spareBridge || S.bridges[i].hp <= 0) return;
      const px = x - m.x0, py = y - m.y0, t = px * m.ux + py * m.uy, s = Math.abs(-px * m.uy + py * m.ux);
      if (t > -r && t < m.len + r && s < m.w / 2 + r * 0.5) hurtBridge(S, i, bld * 0.35, team);
    });
    const hs = S.map.houses;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (S.hh[i] <= 0 || x < h.x - r || x > h.x + h.w + r || y < h.y - r || y > h.y + h.h + r) continue;
      S.hh[i] -= bld * 0.5;
      if (S.hh[i] <= 0) { S.hh[i] = 0; S.ev.push({ t: 'ruin', i, x: h.x + h.w / 2, y: h.y + h.h / 2 }); }
    }
  }

  // Bridges. One is brought down by enough damage, or at once by C4, and an engineer rebuilds it in twenty
  // seconds. Whoever is on it when it falls goes into the river.
  function hurtBridge(S, i, dmg, team) {
    const b = S.bridges[i];
    if (b.hp <= 0 || dmg <= 0) return;
    b.hp -= dmg; b.under = S.tick;
    if (b.hp <= 0) dropBridge(S, i);
  }
  function dropBridge(S, i) {
    const b = S.bridges[i], m = S.map.bridges[i];
    b.hp = 0; b.fix = 0; b.c4 = 0;
    for (const v of m.verts) S.map.deck[v] = 0;
    setGround(S, m.cells, m.under);
    const on = new Set(m.cells);
    for (const u of S.ents) if (!u.b && u.hp > 0 && !isAir(u) && !(u.drop > 0) && on.has(cellOf(u.x, u.y)) && blocked(S, clsOf(u), cellOf(u.x, u.y))) hurt(S, u, 1e6, -1, 0);
    S.ev.push({ t: 'bridge', i, down: true, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2 });
  }
  function raiseBridge(S, i) {
    const b = S.bridges[i], m = S.map.bridges[i];
    b.hp = BRIDGE_HP; b.fix = 0;
    for (const v of m.verts) S.map.deck[v] = m.z;
    setGround(S, m.cells, m.cells.map(() => 4));
    S.ev.push({ t: 'bridge', i, down: false, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2 });
  }
  // The bridge whose deck covers a point, or -1.
  function bridgeAt(S, x, y) {
    const B = S.map.bridges;
    for (let i = 0; i < B.length; i++) {
      const m = B[i], px = x - m.x0, py = y - m.y0, t = px * m.ux + py * m.uy, s = Math.abs(-px * m.uy + py * m.ux);
      if (t > -1 && t < m.len + 1 && s < m.w / 2 + 0.6) return i;
    }
    return -1;
  }
  // What a gun aims at to hit a bridge: the middle of its deck, dressed as a building of no side.
  function bridgeMark(S, i) {
    const m = S.map.bridges[i];
    return { id: 0, br: i, b: true, team: -1, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, cx: (m.x0 + m.x1) / 2 - 1, cy: (m.y0 + m.y1) / 2 - 1, w: 2, h: 2, hp: S.bridges[i].hp, d: { armor: 'bld' }, z: m.z + 0.3 };
  }
  // The end of a bridge nearer a point, a little way onto the land.
  function bridgeEnd(S, i, x, y) {
    const m = S.map.bridges[i], a = mhypot(x - m.x0, y - m.y0) < mhypot(x - m.x1, y - m.y1);
    return a ? [m.x0 - m.ux * 1.5, m.y0 - m.uy * 1.5] : [m.x1 + m.ux * 1.5, m.y1 + m.uy * 1.5];
  }

  // Fire in the woods. A blast among standing trees may light them, and fire spreads from tree to tree, more
  // with the wind and not at all in rain or snow, then leaves the ground burnt and open.
  function ignite(S, x, y, r, p) {
    const w = sky(S);
    p *= 1 - 0.8 * Math.min(1, w.rain + w.snow);
    if (p <= 0 || S.burn.length >= 400) return;
    for (let cy = Math.max(0, (y - r) | 0); cy <= Math.min(H - 1, (y + r) | 0); cy++) for (let cx = Math.max(0, (x - r) | 0); cx <= Math.min(W - 1, (x + r) | 0); cx++) {
      const c = cy * W + cx;
      if ((S.gnd[c] & 8) && !S.wood[c] && S.rand() < p) kindle(S, c);
    }
  }
  function kindle(S, c) {
    S.wood[c] = 2; S.woodVer++;
    S.burn.push([c, 500 + (S.rand() * 300 | 0)]);
  }
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  function stepFire(S) {
    if (!S.burn.length) return;
    const w = sky(S), wet = Math.min(1, w.rain + w.snow), spread = 0.06 * (1 - wet), out = [];
    for (let i = S.burn.length - 1; i >= 0; i--) {
      const b = S.burn[i], c = b[0], x = c % W, y = c / W | 0;
      b[1] -= 10 * (1 + wet * 3);
      if (spread > 0 && S.burn.length < 400) for (const [dx, dy] of D8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if ((S.gnd[n] & 8) && !S.wood[n] && S.rand() < spread * (1 + (dx * w.wind[0] + dy * w.wind[1]) * 0.9)) kindle(S, n);
      }
      // What stands in the fire is burnt.
      near(S, x + 0.5, y + 0.5, 1.5, u => { if (!u.b && u.hp > 0 && !isAir(u) && cellOf(u.x, u.y) === c) hurt(S, u, u.d.men ? 4 : 2.5, -1, 0); });
      if (b[1] <= 0) { S.burn.splice(i, 1); S.wood[c] = 3; S.woodVer++; out.push(c); }
    }
    setGround(S, out, out.map(c => S.gnd[c] & ~8));
  }

  function fire(S, s, wn, t, slot) {
    const w = WEAPONS[wn];
    const vetScale = 1 + 0.15 * (s.vet || 0);
    const up = (s.b ? terrainAt(S.map, s.x, s.y) : heightAt(S.map, s.x, s.y)) - (t.b ? terrainAt(S.map, t.x, t.y) : heightAt(S.map, t.x, t.y));
    const dmg = w.dmg * vetScale * (up > 1 ? 1.1 : 1);
    s.flash = S.tick; s.fired = S.tick;
    const br = t.br, z0 = groundZ(S, s) + (s.b ? 1 : 0.1), z1 = br !== undefined ? t.z : groundZ(S, t);
    const shot = { w: wn, team: s.team, by: s.id, x: s.x, y: s.y, z: z0, tx: t.x, ty: t.y, tz: z1, t: 0, dur: 0, tgt: t.id, dmg };
    if (br !== undefined) shot.br = br;
    if (w.spread) {
      shot.tx += (S.rand() - 0.5) * w.spread * 2; shot.ty += (S.rand() - 0.5) * w.spread * 2;
      shot.tz = terrainAt(S.map, shot.tx, shot.ty); shot.tgt = 0;
    }
    if (w.fx === 'bullet' || w.fx === 'tracer' || w.fx === 'beam') {
      if (br !== undefined) hurtBridge(S, br, dmg * (w.vs.bld ?? 1), s.team);
      else hurt(S, t, dmg * (w.vs[t.d.armor] ?? 1), s.team, s.id);
      S.ev.push({ t: 'shot', w: wn, x: s.x, y: s.y, z: z0, tx: t.x, ty: t.y, tz: z1, team: s.team, dur: 0, id: s.id });
      return;
    }
    shot.dur = Math.max(0.1, mhypot(shot.tx - s.x, shot.ty - s.y) / w.speed);
    S.shots.push(shot);
    S.ev.push({ t: 'shot', w: wn, x: s.x, y: s.y, z: z0, tx: shot.tx, ty: shot.ty, tz: shot.tz, team: s.team, dur: shot.dur, tgt: shot.tgt, id: s.id });
  }

  function stepShots(S) {
    for (let i = S.shots.length - 1; i >= 0; i--) {
      const s = S.shots[i];
      s.t += DT;
      const t = s.tgt ? S.byId.get(s.tgt) : null;
      if (t && t.hp > 0) { s.tx = t.x; s.ty = t.y; s.tz = groundZ(S, t); }
      if (s.t < s.dur) continue;
      S.shots.splice(i, 1);
      if (s.kind) { landShot(S, s); continue; }
      const w = WEAPONS[s.w];
      S.ev.push({ t: 'hit', w: s.w, x: s.tx, y: s.ty, z: s.tz, team: s.team });
      // A shot laid on a bridge strikes it whole, and its blast spares it the second time.
      if (s.br !== undefined) {
        const m = S.map.bridges[s.br], px = s.tx - m.x0, py = s.ty - m.y0, along = px * m.ux + py * m.uy, off = Math.abs(-px * m.uy + py * m.ux);
        if (along > -1 && along < m.len + 1 && off < m.w / 2 + 1) hurtBridge(S, s.br, s.dmg * (w.vs.bld ?? 1), s.team);
      }
      if (w.splash) {
        blast(S, s.tx, s.ty, w.splash, s.dmg, w.vs, s.team, s.by, false, s.br ?? -1);
        if (S.gnd[cellOf(s.tx, s.ty)] & 8) ignite(S, s.tx, s.ty, w.splash, 0.2);
      } else if (t && t.hp > 0) hurt(S, t, s.dmg * (w.vs[t.d.armor] ?? 1), s.team, s.by);
    }
  }

  function aimAndFire(S, u) {
    const t = u.tgt ? S.byId.get(u.tgt) : null;
    if (!t || t.hp <= 0) return false;
    let readyAny = false;
    const list = u.d.weapons || [];
    for (let i = 0; i < list.length; i++) {
      const wn = list[i], w = WEAPONS[wn];
      if (!canHit(wn, t) || !inRange(S, u, wn, t)) continue;
      if (u.salvo > 0) continue;
      readyAny = true;
      if (u.cd[i] > 0) continue;
      if (u.d.turret && Math.abs(angleTo(u.ta, matan2(t.y - u.y, t.x - u.x))) > 0.12) continue;
      if (!clearShot(S, u, wn, t)) { readyAny = false; continue; }
      u.cd[i] = w.cd * (u.b && S.P[u.team].low ? 2 : 1);
      if (w.salvo) { u.salvo = w.salvo; u.salvoT = 0; u.salvoW = wn; u.salvoBr = -1; }
      else fire(S, u, wn, t, i);
    }
    return readyAny;
  }

  function stepSalvo(S, u) {
    if (!u.salvo) return;
    u.salvoT -= DT;
    if (u.salvoT > 0) return;
    const t = u.salvoBr >= 0 ? bridgeMark(S, u.salvoBr) : S.byId.get(u.tgt);
    if (!t || t.hp <= 0) { u.salvo = 0; return; }
    u.salvo--;
    u.salvoT = WEAPONS[u.salvoW].gap;
    fire(S, u, u.salvoW, t);
  }

  // Steps a vehicle or a man toward a point, leaning away from neighbours.
  function steer(S, u, wx, wy, speedScale = 1) {
    const d = u.d, dx0 = wx - u.x, dy0 = wy - u.y, dist = mhypot(dx0, dy0) || 1e-4;
    let dx = dx0 / dist, dy = dy0 / dist;
    let sx = 0, sy = 0;
    near(S, u.x, u.y, 2.5, o => {
      if (o === u || o.b || o.drop > 0 || isAir(o) !== isAir(u)) return;
      const ox = u.x - o.x, oy = u.y - o.y, gapD = mhypot(ox, oy) || 0.01, reach = u.d.r + o.d.r + 0.25;
      if (gapD < reach) { const k = (reach - gapD) / reach; sx += ox / gapD * k; sy += oy / gapD * k; }
    });
    dx += sx * 1.6; dy += sy * 1.6;
    const mag = mhypot(dx, dy) || 1;
    dx /= mag; dy /= mag;
    const onRoad = S.map.roadDist[((u.y | 0) * RES) * VW + (u.x | 0) * RES] < 2, here = S.gnd[cellOf(u.x, u.y)], w = sky(S);
    // Mud after rain bogs wheels down off the roads, snow slows everyone, and woods and fords slow what is in them.
    let going = onRoad ? 1.15 : d.move === 'wheel' ? 1 - 0.24 * w.rain - 0.2 * w.snow : d.move === 'track' ? 1 - 0.12 * w.storm - 0.1 * w.snow : 1 - 0.18 * w.snow;
    if (here & 16) going *= 0.5;
    if ((here & 8) && d.move === 'foot') going *= 0.75;
    const top = d.speed * speedScale * going;
    const want = matan2(dy, dx), diff = angleTo(u.a, want);
    if (d.move === 'foot') {
      u.a += clamp(diff, -6 * DT * 2, 6 * DT * 2);
      u.v = top;
    } else {
      const turn = d.move === 'track' ? 2.4 : 2.9;
      u.a += clamp(diff, -turn * DT, turn * DT);
      const ab = Math.abs(diff);
      const align = d.move === 'track' ? clamp(1 - ab / 1.1, 0, 1) : clamp(1 - ab / 1.8, 0.25, 1);
      const goal = top * align * clamp(dist / 1.2, 0.3, 1);
      u.v += clamp(goal - u.v, -5 * DT, 2.5 * DT);
    }
    const cls = clsOf(u);
    const hx = d.move === 'foot' ? dx : mcos(u.a), hy = d.move === 'foot' ? dy : msin(u.a);
    const nx = u.x + hx * u.v * DT, ny = u.y + hy * u.v * DT;
    if (!blocked(S, cls, cellOf(nx, ny))) { u.x = nx; u.y = ny; }
    else if (!blocked(S, cls, cellOf(nx, u.y))) { u.x = nx; u.v *= 0.8; }
    else if (!blocked(S, cls, cellOf(u.x, ny))) { u.y = ny; u.v *= 0.8; }
    else u.v *= 0.3;
    u.x = clamp(u.x, 0.5, W - 0.5); u.y = clamp(u.y, 0.5, H - 0.5);
    u.anim += u.v * DT;
    // Tracks flatten the trees they drive into, and slow doing it.
    if (d.move === 'track') { const c = cellOf(u.x, u.y); if ((S.gnd[c] & 8) && S.wood[c] !== 2) { S.crush.push(c); u.v *= 0.55; } }
  }

  // Drives toward a goal. Says true on arrival within `stop`, and gives up when truly stuck.
  function drive(S, u, tx, ty, stop = 0.4, scale = 1) {
    const dist = mhypot(tx - u.x, ty - u.y);
    if (dist <= stop) { u.v = 0; return true; }
    if (S.tick >= u.wpT) {
      u.wpT = S.tick + 5 + (u.id & 3);
      const wp = waypoint(S, u, tx, ty);
      if (!wp) { u.v = 0; return true; }
      u.wx = wp[0]; u.wy = wp[1];
      // Progress check, so a man penned in behind friends stops trying.
      const moved = mhypot(u.x - u.lx, u.y - u.ly);
      if (S.tick % 20 < 8) { if (moved < 0.25) u.stuck++; else u.stuck = 0; u.lx = u.x; u.ly = u.y; }
    }
    if (u.stuck > 6 && dist < 7) { u.stuck = 0; u.v = 0; return true; }
    steer(S, u, u.wx, u.wy, scale);
    return false;
  }

  function flyTo(S, u, tx, ty, stop, scale = 1) {
    const dx = tx - u.x, dy = ty - u.y, d = mhypot(dx, dy);
    if (d <= stop) { u.v = Math.max(0, u.v - 8 * DT); return true; }
    let vx = dx / d, vy = dy / d, sx = 0, sy = 0;
    near(S, u.x, u.y, 2.4, o => {
      if (o === u || !isAir(o) || o.d.move === 'jet') return;
      const ox = u.x - o.x, oy = u.y - o.y, g = mhypot(ox, oy) || 0.01;
      if (g < 1.8) { sx += ox / g; sy += oy / g; }
    });
    vx += sx * 0.8; vy += sy * 0.8;
    const want = matan2(vy, vx);
    u.a += clamp(angleTo(u.a, want), -3.4 * DT, 3.4 * DT);
    u.v += clamp(u.d.speed * scale - u.v, -8 * DT, 6 * DT);
    u.x = clamp(u.x + mcos(want) * u.v * DT, 0, W);
    u.y = clamp(u.y + msin(want) * u.v * DT, 0, H);
    return false;
  }

  function nearestRefinery(S, u) {
    let best = null, bd = Infinity;
    for (const e of S.ents) if (e.b && e.team === u.team && e.kind === 'refinery' && e.hp > 0) {
      const d = mhypot(e.x - u.x, e.y - u.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function nearestOre(S, x, y, team) {
    let best = -1, bd = Infinity;
    const P = S.P[team];
    // Fields first, so trucks go to a whole field rather than the last crumb near home.
    let fieldBest = null, fd = Infinity;
    for (const f of S.map.oreFields) {
      let left = 0;
      for (let r = 0; r < 12 && !left; r++) { const c = cellOf(f.x + mcos(r) * r * 0.6, f.y + msin(r) * r * 0.6); left = S.ore[c]; }
      if (!left) continue;
      if (!P.seen[cellOf(f.x, f.y)]) continue;
      const owner = S.terr[cellOf(f.x, f.y)];
      if (owner >= 0 && owner !== team) continue;
      const d = mhypot(f.x - x, f.y - y);
      if (d < fd) { fd = d; fieldBest = f; }
    }
    const ax = fieldBest ? fieldBest.x : x, ay = fieldBest ? fieldBest.y : y, R = fieldBest ? fieldBest.r + 3 : 18;
    for (let cy = Math.max(1, ay - R | 0); cy <= Math.min(H - 2, ay + R | 0); cy++) for (let cx = Math.max(1, ax - R | 0); cx <= Math.min(W - 2, ax + R | 0); cx++) {
      const c = cy * W + cx;
      if (!S.ore[c] || S.occ[c] || (S.gnd[c] & 9)) continue;
      const d = mhypot(cx + 0.5 - x, cy + 0.5 - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function truckTick(S, u) {
    const o = u.ord, cap = u.d.cargo;
    if (o.phase === 'unload') {
      const r = S.byId.get(o.ref);
      if (!r || r.hp <= 0) { o.phase = null; return; }
      const take = Math.min(u.cargo, cap / (3 * HZ));
      u.cargo -= take;
      const P = S.P[u.team], got = take * P.income;
      P.supply += got; P.stats.mined += got;
      if (u.cargo <= 0.1) { u.cargo = 0; o.phase = null; r.dockedBy = 0; }
      return;
    }
    if (u.cargo >= cap - 0.5 || (o.phase === 'return')) {
      const r = nearestRefinery(S, u);
      if (!r) return;
      o.phase = 'return';
      const [ex, ey] = exitOf(S, r);
      if (drive(S, u, ex, ey, 1.4)) {
        if (!r.dockedBy || !S.byId.get(r.dockedBy) || S.byId.get(r.dockedBy).ord?.ref !== r.id) {
          r.dockedBy = u.id; o.phase = 'unload'; o.ref = r.id; u.v = 0;
          u.a = matan2(r.y - u.y, r.x - u.x);
        }
      }
      return;
    }
    if (o.cell === undefined || o.cell < 0 || !S.ore[o.cell]) {
      if (S.tick < (o.next || 0)) return;
      o.cell = nearestOre(S, u.x, u.y, u.team);
      o.next = S.tick + 10;
      if (o.cell < 0) { if (u.cargo > 0) o.phase = 'return'; return; }
    }
    const tx = o.cell % W + 0.5, ty = (o.cell / W | 0) + 0.5;
    if (drive(S, u, tx, ty, 0.9, 1)) {
      const rate = cap / (16 * HZ), take = Math.min(rate, S.ore[o.cell], cap - u.cargo);
      S.ore[o.cell] = Math.max(0, S.ore[o.cell] - Math.max(1, Math.round(take * 0.6)));
      u.cargo += take;
      u.mining = S.tick;
      S.oreVer++;
    }
  }

  function dropBomb(S, x, y, u) {
    const b = u.d.bombs;
    S.ev.push({ t: 'shot', w: 'bomb', x, y, z: u.z + 4, tx: x, ty: y, tz: terrainAt(S.map, x, y), team: u.team, dur: 0.6, id: u.id });
    S.shots.push({ w: 'bomb', kind: 'bomb', team: u.team, by: u.id, t: 0, dur: 0.6, x, y, tx: x, ty: y, tz: 0, splash: b.splash, dmg: b.dmg });
  }
  // Bombs, missiles and shells that land on a spot rather than on a target.
  function landShot(S, s) {
    const x = s.x, y = s.y;
    if (s.kind === 'bomb') {
      S.ev.push({ t: 'boom', x, y, size: 2.2 });
      S.ev.push({ t: 'crater', x, y, r: 1.8 });
      blast(S, x, y, s.splash, s.dmg, { inf: 1, light: 1, heavy: 0.8, bld: 0.9 }, s.team, s.by);
      ignite(S, x, y, 2, 0.5);
    } else if (s.kind === 'nuke') {
      S.ev.push({ t: 'boom', x, y, size: 9 });
      S.ev.push({ t: 'crater', x, y, r: 9 });
      blast(S, x, y, 10, 1400, { inf: 1.5, light: 1, heavy: 0.8, bld: 0.8 }, s.team, s.by, true);
      ignite(S, x, y, 10, 0.7);
    } else if (s.kind === 'barrage') {
      S.ev.push({ t: 'boom', x, y, size: 1.8 });
      S.ev.push({ t: 'crater', x, y, r: 1.4 });
      blast(S, x, y, 2.2, 180, { inf: 1, light: 1, heavy: 0.6, bld: 0.7 }, s.team, 0);
      ignite(S, x, y, 1.6, 0.35);
    }
  }
  // An airfield's pad for an aircraft waiting out a storm.
  function padFor(S, u) {
    const home = S.ents.find(e => e.b && e.team === u.team && e.kind === 'airfield' && e.hp > 0);
    if (!home) return [u.x, u.y];
    const k = u.id % 6;
    return [home.x - 2.2 + (k % 3) * 2.2, home.y + (k < 3 ? -2.6 : 2.6)];
  }

  function jetTick(S, u) {
    // Parked at the airfield until told. A run flies over the target and home again.
    const home = S.ents.find(e => e.b && e.team === u.team && e.kind === 'airfield' && e.hp > 0);
    // A storm calls every run off.
    if (sky(S).grounded && u.ord && u.ord.t === 'attack') u.ord = null;
    const o = u.ord;
    if (o && o.t === 'attack' && u.ammo > 0) {
      const t = S.byId.get(o.id), tx = t ? t.x : o.x, ty = t ? t.y : o.y;
      if (t && t.hp > 0) { o.x = t.x; o.y = t.y; }
      if (!t && o.id) u.ord = null;
      u.z = Math.min(6, u.z + 4 * DT);
      if (flyTo(S, u, tx, ty, 1.2)) o.pass = true;
      if (mhypot(tx - u.x, ty - u.y) < 3.2 && S.tick >= (u.dropT || 0)) {
        u.dropT = S.tick + 3; u.ammo--;
        dropBomb(S, u.x, u.y, u);
        if (u.ammo <= 0) u.ord = { t: 'rearm' };
      }
      return;
    }
    if (!home) { u.hp = 0; kill(S, u, -1); return; }
    const [hx, hy] = [home.x, home.y];
    const park = u.pad ?? (u.pad = (u.id % 2));
    const px = hx - 1.5 + park * 3, py = hy;
    if (u.ammo >= u.d.bombs.n && !o) {
      if (mhypot(px - u.x, py - u.y) < 0.6) { u.z = Math.max(0.4, u.z - 3 * DT); u.v = 0; return; }
    }
    if (flyTo(S, u, px, py, 0.5)) {
      u.z = Math.max(0.4, u.z - 3 * DT);
      if (u.z <= 0.5) { u.ammo = Math.min(u.d.bombs.n, u.ammo + DT * 0.5); if (u.ammo >= u.d.bombs.n) { u.ammo = u.d.bombs.n; u.ord = null; } }
    } else u.z = Math.min(6, u.z + 4 * DT);
  }

  function airTick(S, u) {
    const d = u.d, o = u.ord;
    // In a storm helicopters and drones go home and set down, and a drone's flying time stands still.
    if (sky(S).grounded) {
      u.ord = null; u.tgt = 0;
      const [px, py] = padFor(S, u);
      if (flyTo(S, u, px, py, 0.6)) u.z = Math.max(0.3, u.z - 2 * DT);
      else u.z = Math.min(d.alt, u.z + 2 * DT);
      return;
    }
    // Back up to height after setting down.
    const alt = d.alt + msin(S.tick * 0.05 + u.id) * 0.12;
    u.z = u.z < alt - 0.2 && !d.kamikaze ? u.z + 2 * DT : alt;
    if (d.kamikaze) {
      u.life -= DT;
      if (u.life <= 0) { kill(S, u, -1); return; }
      let t = u.tgt ? S.byId.get(u.tgt) : null;
      if (t && (t.hp <= 0 || atPeace(S, u.team, t.team))) { t = null; u.tgt = 0; }
      if (!t && (!o || o.t !== 'move')) {
        if (o && o.t === 'attack') t = S.byId.get(o.id);
        if (!t || t.hp <= 0) t = acquireAny(S, u, 14);
        if (t) u.tgt = t.id;
      }
      if (t) {
        u.z = lerp(u.z, 1, 0.1);
        if (flyTo(S, u, t.x, t.y, 0.5) || gap(u.x, u.y, t) < 0.7) {
          const k = d.kamikaze;
          S.ev.push({ t: 'boom', x: u.x, y: u.y, size: 1.1 });
          S.ev.push({ t: 'crater', x: u.x, y: u.y, r: 0.8 });
          blast(S, u.x, u.y, k.splash, k.dmg, { inf: 0.6, light: 1, heavy: 1, bld: 0.5 }, u.team, u.id);
          hurt(S, u, 999, -1, 0);
        }
        return;
      }
      if (o && (o.t === 'move' || o.t === 'amove')) { if (flyTo(S, u, o.x, o.y, 1)) u.ord = null; }
      return;
    }
    // Helicopters hold station and shoot at what they are near.
    let t = u.tgt ? S.byId.get(u.tgt) : null;
    if (t && (t.hp <= 0 || atPeace(S, u.team, t.team))) { t = null; u.tgt = 0; }
    if (o && o.t === 'attack') {
      t = S.byId.get(o.id);
      if (!t || t.hp <= 0 || atPeace(S, u.team, t.team)) { u.ord = null; t = null; }
      else u.tgt = t.id;
    }
    if (!t && S.tick % 10 === u.id % 10 && (!o || o.t !== 'move')) {
      const f = acquire(S, u, d.sight);
      if (f) { t = f; u.tgt = f.id; }
    }
    if (t) {
      const want = matan2(t.y - u.y, t.x - u.x);
      u.ta += clamp(angleTo(u.ta, want), -d.turret * DT, d.turret * DT);
      aimAndFire(S, u);
      if (o && o.t === 'attack') flyTo(S, u, t.x, t.y, WEAPONS[d.weapons[0]].r * 0.8);
      else if (o && o.t === 'amove') { if (gap(u.x, u.y, t) > WEAPONS[d.weapons[0]].r * 0.85) flyTo(S, u, t.x, t.y, 2); }
      else if (!o) { u.a += clamp(angleTo(u.a, want), -2 * DT, 2 * DT); if (gap(u.x, u.y, t) > WEAPONS[d.weapons[0]].r * 0.9) flyTo(S, u, t.x, t.y, 2); }
    }
    if (o && (o.t === 'move' || o.t === 'amove') && !(t && o.t === 'amove' && gap(u.x, u.y, t) < d.sight)) {
      if (flyTo(S, u, o.x, o.y, 0.8)) u.ord = null;
    }
  }

  function acquireAny(S, u, r) {
    let best = null, bd = Infinity;
    near(S, u.x, u.y, r, t => {
      if (t.team === u.team || t.hp <= 0 || t.b || isAir(t) || atPeace(S, u.team, t.team) || !seenBy(S, u.team, t)) return;
      const d = mhypot(t.x - u.x, t.y - u.y) - (t.d.armor === 'inf' ? -4 : 0);
      if (d < bd) { bd = d; best = t; }
    });
    return best;
  }

  function stepUnit(S, u) {
    const d = u.d, P = S.P[u.team];
    u.px = u.x; u.py = u.y; u.pa = u.a; u.pta = u.ta;
    for (let i = 0; i < u.cd.length; i++) if (u.cd[i] > 0) u.cd[i] -= DT;
    if (u.drop > 0) {
      u.drop -= DT;
      return;
    }
    stepSalvo(S, u);
    if (d.move === 'jet') return jetTick(S, u);
    if (d.move === 'air') return airTick(S, u);

    // Veterans mend slowly, and a Support Truck mends anyone close.
    if (u.vet >= 2 && u.hp < u.max) u.hp = Math.min(u.max, u.hp + u.max * 0.002);
    if (S.tick % HZ === u.id % HZ) {
      const c = cellOf(u.x, u.y), foreign = S.terr[c] >= 0 && S.terr[c] !== u.team;
      let helped = false;
      near(S, u.x, u.y, 8, o => {
        if (o.team === u.team && o.d.repair && o.hp > 0 && mhypot(o.x - u.x, o.y - u.y) < 8) helped = true;
      });
      if (helped) u.hp = Math.min(u.max, u.hp + u.max * 0.03);
      else if (foreign && u.hp > u.max * 0.35) {
        u.hp -= u.max * 0.005;
        u.attrition = S.tick;
        if (!P.hints.attrition) { P.hints.attrition = true; S.ev.push({ t: 'hint', team: u.team, hint: 'attrition' }); }
      }
    }

    // Standing on something that was just built. Walk off it.
    const cls = clsOf(u);
    if (blocked(S, cls, cellOf(u.x, u.y))) {
      const c = goalCells(S, cls, u.x | 0, u.y | 0)[0];
      u.x += clamp((c % W) + 0.5 - u.x, -0.15, 0.15);
      u.y += clamp(((c / W) | 0) + 0.5 - u.y, -0.15, 0.15);
      return;
    }

    if (d.cargo && u.ord && u.ord.t === 'harvest') { truckTick(S, u); return; }
    if (u.ord && u.ord.t === 'bridge') return bridgeGo(S, u, u.ord);
    if (u.ord && u.ord.t === 'mend') return mendGo(S, u, u.ord);

    let o = u.ord;

    let t = u.tgt ? S.byId.get(u.tgt) : null;
    if (t && (t.hp <= 0 || atPeace(S, u.team, t.team) || (!seenBy(S, u.team, t) && !(o && (o.t === 'attack' || o.t === 'group'))))) { t = null; u.tgt = 0; }

    const free = !o || o.t === 'amove' || o.t === 'capture';
    if (armed(u) && free && !t && S.tick % 10 === u.id % 10) {
      const f = acquire(S, u, d.sight);
      if (f) { t = f; u.tgt = f.id; if (!o && !u.home) u.home = [u.x, u.y]; }
    }
    // Vehicles with a turret shoot on the move at what they pass.
    if (o && o.t === 'move' && d.turret && S.tick % 10 === u.id % 10) {
      const f = acquire(S, u, d.sight * 0.9);
      u.tgt = f ? f.id : 0; t = f;
    }

    if (o && o.t === 'group') {
      let g = S.byId.get(o.id);
      if (!g || g.hp <= 0) { o.id = pickFrom(S, u, o.list, null); g = S.byId.get(o.id); }
      if (!g || g.hp <= 0) { u.ord = null; u.tgt = 0; t = null; o = null; }
      else { t = g; u.tgt = g.id; }
    }
    if (o && o.t === 'attack') {
      t = S.byId.get(o.id);
      if (!t || t.hp <= 0 || (t.team === u.team && !d.engineer) || atPeace(S, u.team, t.team)) { u.ord = null; u.tgt = 0; t = null; o = null; }
      else u.tgt = t.id;
    }

    // Turret tracks the target, or comes back to the bow.
    if (d.turret) {
      const want = t ? matan2(t.y - u.y, t.x - u.x) : u.a;
      u.ta += clamp(angleTo(u.ta, want), -d.turret * DT, d.turret * DT);
    }

    const shoot = t && armed(u) ? aimAndFire(S, u) : false;
    if (t && armed(u) && !d.turret && gap(u.x, u.y, t) < d.sight) {
      const a = matan2(t.y - u.y, t.x - u.x);
      if (shoot || (o && (o.t === 'attack' || o.t === 'group'))) u.a += clamp(angleTo(u.a, a), -5 * DT, 5 * DT);
    }

    if (!o) {
      if (t && !armed(u)) { u.tgt = 0; u.v = 0; }
      else if (t && !shoot) {
        // Chase a little, then go back to where it stood.
        const h = u.home || [u.x, u.y];
        if (mhypot(u.x - h[0], u.y - h[1]) < 9) drive(S, u, t.x, t.y, Math.max(WEAPONS[d.weapons[0]].r * 0.85, 1));
        else { u.tgt = 0; t = null; }
      } else if (!t && u.home) {
        if (drive(S, u, u.home[0], u.home[1], 0.6)) u.home = null;
      } else u.v = 0;
      return;
    }

    if (o.t === 'attack' || o.t === 'group') {
      if (o.t === 'attack' && d.engineer) return engineerGo(S, u, t);
      if (o.t === 'attack' && d.hero && t.b) return heroC4(S, u, t);
      if (!shoot && armed(u)) drive(S, u, t.x, t.y, 1.2); else u.v = 0;
      return;
    }

    if (o.t === 'amove' || o.t === 'capture') {
      if (t && (o.t === 'amove' || (armed(u) && gap(u.x, u.y, t) < 8))) {
        if (shoot) { u.v = 0; return; }
        const stop = d.weapons.length ? WEAPONS[d.weapons[0]].r * 0.85 : 1;
        if (gap(u.x, u.y, t) > stop || !clearShot(S, u, d.weapons[0], t)) drive(S, u, t.x, t.y, 1);
        return;
      }
    }

    if (o.t === 'capture') {
      const town = S.towns[o.town];
      if (town.owner === u.team && !town.capTeam) { u.ord = null; return; }
      if (drive(S, u, town.x + o.ox, town.y + o.oy, 0.8)) { if (town.owner === u.team && town.cap <= 0) u.ord = null; }
      return;
    }

    const sx = o.sx ?? o.x, sy = o.sy ?? o.y;
    if (drive(S, u, sx, sy, o.stop ?? 0.4)) { u.ord = null; u.tgt = 0; u.home = null; }
  }

  function engineerGo(S, u, t) {
    if (drive(S, u, t.x, t.y, 0.1) || gap(u.x, u.y, t) < 1.1) {
      if (t.team === u.team) {
        t.hp = Math.min(t.max, t.hp + t.max * 0.5);
        S.ev.push({ t: 'fixed', id: t.id, x: t.x, y: t.y });
      } else if (t.hp < t.max * 0.5) {
        const was = t.team;
        t.team = u.team;
        t.tgt = 0;
        S.ev.push({ t: 'captured', id: t.id, x: t.x, y: t.y, team: u.team, from: was });
        ownEvent(S, u.team, 'captured'); ownEvent(S, was, 'lostbuilding');
        territory(S); recount(S);
      } else hurt(S, t, t.max * 0.3, u.team, u.id);
      u.hp = 0;
      S.ev.push({ t: 'enter', id: u.id });
    }
  }

  // Told to bring a bridge down: close to range of its deck and shoot it, or, for the commando, set C4 on it.
  function bridgeGo(S, u, o) {
    const b = S.bridges[o.i], d = u.d;
    if (!b || b.hp <= 0) { u.ord = null; u.v = 0; return; }
    const T = bridgeMark(S, o.i);
    if (d.hero) {
      const [ex, ey] = bridgeEnd(S, o.i, u.x, u.y);
      if (drive(S, u, ex, ey, 1) || mhypot(ex - u.x, ey - u.y) < 2.5) {
        u.ord = null; u.v = 0;
        if (!b.c4) { b.c4 = S.tick + 4 * HZ; b.c4by = u.team; S.ev.push({ t: 'c4', x: T.x, y: T.y, team: u.team, br: o.i }); }
      }
      return;
    }
    const want = matan2(T.y - u.y, T.x - u.x), far = mhypot(T.x - u.x, T.y - u.y) - 2;
    if (d.turret) u.ta += clamp(angleTo(u.ta, want), -d.turret * DT, d.turret * DT);
    let ready = false;
    const list = d.weapons || [];
    for (let i = 0; i < list.length; i++) {
      const wn = list[i], w = WEAPONS[wn];
      if (w.onlyAir || far > w.r || (w.min && far < w.min)) continue;
      ready = true;
      if (u.cd[i] > 0 || u.salvo > 0) continue;
      if (d.turret ? Math.abs(angleTo(u.ta, want)) > 0.12 : Math.abs(angleTo(u.a, want)) > 0.3) continue;
      u.cd[i] = w.cd;
      if (w.salvo) { u.salvo = w.salvo; u.salvoT = 0; u.salvoW = wn; u.salvoBr = o.i; }
      else fire(S, u, wn, T, i);
    }
    if (!list.length) { u.ord = null; return; }
    if (!ready) drive(S, u, T.x, T.y, 1.5);
    else { u.v = 0; if (!d.turret) u.a += clamp(angleTo(u.a, want), -5 * DT, 5 * DT); }
  }
  // An engineer at a bridge's end mends its damage and pulls out any C4, or, if it is down, starts it being
  // rebuilt. He goes into the work.
  function mendGo(S, u, o) {
    const b = S.bridges[o.i];
    if (!b || b.fix || (b.hp >= BRIDGE_HP && !b.c4)) { u.ord = null; u.v = 0; return; }
    const [ex, ey] = bridgeEnd(S, o.i, u.x, u.y);
    if (drive(S, u, ex, ey, 1) || mhypot(ex - u.x, ey - u.y) < 3) {
      if (b.hp <= 0) b.fix = S.tick + 20 * HZ; else b.hp = BRIDGE_HP;
      b.c4 = 0;
      const m = S.map.bridges[o.i];
      S.ev.push({ t: 'fixed', br: o.i, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, team: u.team });
      u.hp = 0;
      S.ev.push({ t: 'enter', id: u.id });
    }
  }

  function heroC4(S, u, t) {
    if (drive(S, u, t.x, t.y, 0.1) || gap(u.x, u.y, t) < 1.1) {
      u.ord = null; u.tgt = 0; u.v = 0;
      if (t.c4) return;
      t.c4 = S.tick + 4 * HZ; t.c4by = u.team; t.c4id = u.id;
      S.ev.push({ t: 'c4', id: t.id, x: t.x, y: t.y, team: u.team });
    }
  }

  function bldTurret(S, e) {
    e.pta = e.ta;
    for (let i = 0; i < e.cd.length; i++) if (e.cd[i] > 0) e.cd[i] -= DT;
    const dark = e.d.needsPower && S.P[e.team].low;
    if (dark) return;
    let t = e.tgt ? S.byId.get(e.tgt) : null;
    if (t && (t.hp <= 0 || atPeace(S, e.team, t.team) || !seenBy(S, e.team, t) || !inRange(S, e, e.d.weapons[0], t))) { t = null; e.tgt = 0; }
    if (!t && S.tick % 10 === e.id % 10) {
      let best = null, bd = Infinity;
      const wn = e.d.weapons[0], R = WEAPONS[wn].r;
      near(S, e.x, e.y, R + 1, o => {
        if (o.team === e.team || o.hp <= 0 || o.drop > 0 || atPeace(S, e.team, o.team) || !canHit(wn, o) || !seenBy(S, e.team, o)) return;
        const d = gap(e.x, e.y, o);
        if (d > R) return;
        const s = d + (o.b ? 8 : 0);
        if (s < bd && clearShot(S, e, wn, o)) { bd = s; best = o; }
      });
      if (best) { t = best; e.tgt = best.id; }
    }
    if (t) {
      const want = matan2(t.y - e.y, t.x - e.x), rate = e.d.turret || 6;
      e.ta += clamp(angleTo(e.ta, want), -rate * DT, rate * DT);
      const wn = e.d.weapons[0];
      if (e.cd[0] <= 0 && Math.abs(angleTo(e.ta, want)) < 0.15 && clearShot(S, e, wn, t)) {
        e.cd[0] = WEAPONS[wn].cd * (S.P[e.team].low ? 2 : 1);
        fire(S, e, wn, t);
      }
    }
  }

  function stepBuilding(S, e) {
    const P = S.P[e.team];
    if (e.d.weapons) bldTurret(S, e);
    if (e.repairing && e.hp < e.max) {
      const rate = e.max * 0.04 * DT, price = (e.d.cost || 2000) * 0.5 * (rate / e.max);
      if (P.supply >= price) { P.supply -= price; e.hp = Math.min(e.max, e.hp + rate); }
    } else e.repairing = false;
    if (e.kind === 'derrick' && S.tick % HZ === 0) P.oil += e.d.yield * P.income;
    if (e.d.charge && !P.low) { e.charge = Math.min(e.d.charge, e.charge + DT); if (e.charge >= e.d.charge && !e.told) { e.told = true; ownEvent(S, e.team, 'siloready'); S.ev.push({ t: 'hint', team: e.team, hint: 'silo' }); } }
    if (e.c4 && S.tick >= e.c4) {
      e.c4 = 0;
      S.ev.push({ t: 'boom', x: e.x, y: e.y, size: 3 });
      hurt(S, e, e.max * 2, e.c4by, e.c4id);
    }
  }

  function stepTowns(S) {
    if (S.tick % 5) return;
    let changed = false;
    for (const t of S.towns) {
      const here = new Array(S.P.length).fill(0);
      near(S, t.x, t.y, 7, u => {
        if (u.b || u.hp <= 0 || !u.d.men || u.drop > 0) return;
        if (mhypot(u.x - t.x, u.y - t.y) < 7) here[u.team] += u.kind === 'engineer' ? 0 : 1;
      });
      let team = -1, sides = 0;
      for (let k = 0; k < here.length; k++) if (here[k]) { sides++; team = k; }
      if (sides > 1) continue;
      if (team < 0) { t.cap = Math.max(0, t.cap - 0.02); if (t.cap === 0) t.capTeam = -1; continue; }
      if (t.owner === team) { t.cap = Math.max(0, t.cap - 0.1); if (t.cap === 0) t.capTeam = -1; continue; }
      if (t.capTeam !== team && t.cap > 0) { t.cap = Math.max(0, t.cap - 0.05 * Math.min(here[team], 3)); if (t.cap === 0) t.capTeam = team; continue; }
      t.capTeam = team;
      t.cap += 0.05 * Math.min(here[team], 3) / (t.owner >= 0 ? 1.3 : 1) * 0.5;
      if (t.cap >= 1) {
        const from = t.owner;
        t.owner = team; t.cap = 0; t.capTeam = -1; changed = true;
        ownEvent(S, team, 'towntaken');
        if (from >= 0) ownEvent(S, from, 'townlost');
        S.ev.push({ t: 'town', id: t.id, team, x: t.x, y: t.y });
      }
    }
    if (changed) territory(S);
  }

  function stepEconomy(S) {
    if (S.tick % HZ === 0) {
      for (const t of S.towns) if (t.owner >= 0) { const P = S.P[t.owner]; P.supply += 5 * P.income; P.oil += 0.25 * P.income; }
    }
    for (const P of S.P) {
      for (const k in P.cooldown) if (P.cooldown[k] > 0) P.cooldown[k] -= DT;
      for (const cat of ['bld', 'def', 'inf', 'veh', 'air', 'tech']) {
        const q = P.q[cat];
        const item = q[0];
        if (!item) continue;
        if (item.prog >= 1) { if (cat === 'bld' || cat === 'def') continue; finish(S, P, cat, item); q.shift(); continue; }
        if (item.hold) continue;
        const d = item.cost;
        const c = cat === 'tech' ? 1 : cat === 'bld' || cat === 'def' ? 1 : producers(S, P, cat);
        if (c <= 0) continue;
        const rate = DT / d.time * (1 + 0.5 * (c - 1)) * (P.low ? 0.5 : 1);
        const pay = (d.cost || 0) * rate, payOil = (d.oil || 0) * rate;
        if (P.supply < pay || P.oil < payOil) { if (!item.short) { item.short = true; ownEvent(S, P.team, P.supply < pay ? 'nosupply' : 'nooil'); } continue; }
        item.short = false;
        P.supply -= pay; P.oil -= payOil; item.paid += pay; item.paidOil += payOil;
        item.prog += rate;
        if (item.prog >= 1) {
          item.prog = 1;
          if (cat === 'bld' || cat === 'def') { ownEvent(S, P.team, 'buildready'); S.ev.push({ t: 'ready', team: P.team, cat, kind: item.kind }); }
        }
      }
    }
  }

  function producers(S, P, cat) {
    const k = cat === 'inf' ? 'barracks' : cat === 'veh' ? 'factory' : 'airfield';
    return P.counts[k] || 0;
  }

  function finish(S, P, cat, item) {
    if (cat === 'tech') {
      P.tech = item.level;
      S.ev.push({ t: 'tech', team: P.team, level: item.level });
      ownEvent(S, P.team, 'newtech');
      return;
    }
    const need = cat === 'inf' ? 'barracks' : cat === 'veh' ? 'factory' : 'airfield';
    let best = null, n = 0;
    for (const e of S.ents) if (e.b && e.team === P.team && e.kind === need && e.hp > 0) { n++; if (!best || e.primary) best = e; }
    if (!best) return;
    const [x, y] = exitOf(S, best);
    const kind = item.kind, u = spawn(S, kind, P.team, x, y);
    P.stats.made++;
    S.ev.push({ t: 'built', team: P.team, kind, id: u.id, x, y });
    ownEvent(S, P.team, 'unitready');
    if (u.d.move === 'jet') { u.ord = null; return; }
    if (!u.d.cargo) {
      const r = best.rally;
      if (r) orderMove(S, [u], r[0], r[1], false);
      else {
        const dx = x - best.x, dy = y - best.y, m = mhypot(dx, dy) || 1;
        orderMove(S, [u], x + dx / m * 3 + (S.rand() - 0.5) * 3, y + dy / m * 3 + (S.rand() - 0.5) * 3, false);
      }
    }
  }

  // Goal slots around a point, so a group ends up as a block and not a pile.
  function orderMove(S, units, x, y, attack) {
    const n = units.length;
    let cx = 0, cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= n; cy /= n;
    const a = matan2(y - cy, x - cx), fx = mcos(a), fy = msin(a), sx = -fy, sy = fx;
    const air = units.filter(isAir), land = units.filter(u => !isAir(u));
    const spacing = Math.max(1.5, ...land.map(u => u.d.r * 2 + 0.5)), per = Math.ceil(Math.sqrt(land.length * 1.4));
    land.sort((p, q) => ((p.x - cx) * sx + (p.y - cy) * sy) - ((q.x - cx) * sx + (q.y - cy) * sy));
    const rows = Math.ceil(land.length / per);
    land.forEach((u, i) => {
      const row = i % rows, col = i / rows | 0;
      const ox = (col - (Math.ceil(land.length / rows) - 1) / 2) * spacing, oy = -(row - (rows - 1) / 2) * spacing;
      let px = x + sx * ox + fx * oy, py = y + sy * ox + fy * oy;
      const cls = clsOf(u);
      if (blocked(S, cls, cellOf(px, py))) {
        const c = goalCells(S, cls, clamp(px | 0, 0, W - 1), clamp(py | 0, 0, H - 1))[0];
        px = c % W + 0.5; py = (c / W | 0) + 0.5;
      }
      u.ord = { t: attack ? 'amove' : 'move', x: px, y: py };
      u.home = null; u.stuck = 0; u.wpT = 0;
      if (!attack) u.tgt = 0;
    });
    air.forEach((u, i) => {
      const a2 = i * 2.4, r = 1.2 * Math.sqrt(i);
      u.ord = u.d.move === 'jet' ? (u.ammo > 0 ? { t: 'attack', id: 0, x, y } : u.ord) : { t: attack ? 'amove' : 'move', x: x + mcos(a2) * r, y: y + msin(a2) * r };
      if (u.d.kamikaze && !attack) u.tgt = 0;
    });
  }

  function unitsOf(S, team, ids) {
    const out = [];
    for (const id of ids) { const u = S.byId.get(id); if (u && u.team === team && !u.b && u.hp > 0) out.push(u); }
    return out;
  }

  // What can be built now. Says why not as a short reason, or null when it can.
  function blockedReason(S, team, kind) {
    const P = S.P[team], d = BUILDINGS[kind] || UNITS[kind];
    if ((d.tech || 1) > P.tech) return 'Needs Tech ' + 'I'.repeat(d.tech);
    if (d.need && !P.counts[d.need]) return 'Needs ' + BUILDINGS[d.need].name;
    if (BUILDINGS[kind] && !(P.counts.hq || P.counts.fob)) return 'Needs Headquarters';
    if (d.limit) {
      const made = (P.counts[kind] || 0) + P.q[d.cat].filter(i => i.kind === kind).length;
      if (made >= d.limit) return 'Already serving';
    }
    return null;
  }

  function apply(S, team, c) {
    const P = S.P[team];
    // Any order to attack ends the giver's own shield.
    if (shielded(S, team)) {
      const tg = c.c === 'attack' ? S.byId.get(c.id) : null;
      const war = (tg && tg.team !== team) || c.c === 'strike' || c.c === 'bridge' || c.c === 'launch' || (c.c === 'power' && c.name === 'barrage');
      if (war) { P.shield = 0; S.ev.push({ t: 'unshield', team }); }
    }
    if (c.c === 'move') {
      const us = unitsOf(S, team, c.ids);
      if (us.length) {
        for (const u of us) if (u.d.cargo && u.ord && u.ord.t === 'harvest') u.ord = null;
        orderMove(S, us, c.x, c.y, !!c.a);
      }
    } else if (c.c === 'attack') {
      const t = S.byId.get(c.id);
      if (t && t.hp > 0 && !(t.team !== team && shielded(S, t.team))) for (const u of unitsOf(S, team, c.ids)) {
        if (u.d.move === 'jet') { if (u.ammo > 0 && !sky(S).grounded) u.ord = { t: 'attack', id: t.id, x: t.x, y: t.y }; }
        else if (u.d.cargo) continue;
        else { u.ord = { t: 'attack', id: t.id }; u.tgt = t.id; u.wpT = 0; u.stuck = 0; }
      }
    } else if (c.c === 'bridge' || c.c === 'mend') {
      // Bring a bridge down, or mend one. Engineers mend, everything armed shoots, jets bomb its middle.
      const i = c.i | 0, m = S.map.bridges[i];
      if (!m) return;
      for (const u of unitsOf(S, team, c.ids)) {
        if (c.c === 'mend') { if (u.d.engineer) { u.ord = { t: 'mend', i }; u.wpT = 0; u.stuck = 0; u.tgt = 0; } continue; }
        if (u.d.move === 'jet') { if (u.ammo > 0 && !sky(S).grounded) u.ord = { t: 'attack', id: 0, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2 }; continue; }
        if (u.d.cargo || u.d.engineer || isAir(u) || !(armed(u) || u.d.hero)) continue;
        u.ord = { t: 'bridge', i }; u.tgt = 0; u.wpT = 0; u.stuck = 0; u.home = null;
      }
    } else if (c.c === 'strike') {
      // Marks every enemy seen within r of a point, and shares them out among the units.
      const us = unitsOf(S, team, c.ids).filter(u => (armed(u) || u.d.kamikaze) && !u.d.cargo);
      const list = [], first = S.byId.get(c.id);
      if (first && first.hp > 0 && first.team !== team && !shielded(S, first.team)) list.push(first);
      near(S, c.x, c.y, c.r, t => { if (t !== first && t.team !== team && t.hp > 0 && !(t.drop > 0) && !shielded(S, t.team) && gap(c.x, c.y, t) <= c.r && seenBy(S, team, t)) list.push(t); });
      if (!list.length || !us.length) return;
      const ids = list.map(t => t.id), load = new Map();
      for (const u of us) {
        const pick = pickFrom(S, u, ids, load);
        if (!pick) continue;
        load.set(pick, (load.get(pick) || 0) + (u.d.cost || 200) * 0.4);
        if (u.d.move === 'jet') { if (u.ammo > 0) { const t = S.byId.get(pick); u.ord = { t: 'attack', id: pick, x: t.x, y: t.y }; } continue; }
        u.ord = isAir(u) ? { t: 'attack', id: pick } : { t: 'group', list: ids, id: pick };
        u.tgt = pick; u.wpT = 0; u.stuck = 0; u.home = null;
      }
      S.ev.push({ t: 'marked', team, ids, x: c.x, y: c.y, r: c.r });
    } else if (c.c === 'stop') {
      for (const u of unitsOf(S, team, c.ids)) { u.ord = u.d.cargo ? { t: 'harvest' } : null; u.tgt = 0; u.home = null; }
    } else if (c.c === 'harvest') {
      for (const u of unitsOf(S, team, c.ids)) if (u.d.cargo) u.ord = { t: 'harvest', cell: c.cell };
    } else if (c.c === 'capture') {
      const town = S.towns[c.town], us = unitsOf(S, team, c.ids).filter(u => u.d.men && u.kind !== 'engineer');
      us.forEach((u, i) => {
        const a = i * 2.4, r = 1 + Math.sqrt(i);
        u.ord = { t: 'capture', town: c.town, ox: mcos(a) * r, oy: msin(a) * r };
        u.wpT = 0; u.tgt = 0; u.home = null;
      });
    } else if (c.c === 'train' || c.c === 'build') {
      const d = UNITS[c.kind] || BUILDINGS[c.kind];
      if (!d || blockedReason(S, team, c.kind)) return;
      const cat = d.cat, q = P.q[cat];
      if (c.c === 'build' && q.length) return;
      if (q.length >= 9) return;
      q.push({ kind: c.kind, cost: d, prog: 0, paid: 0, paidOil: 0, hold: false });
    } else if (c.c === 'research') {
      const lv = P.tech + 1, d = TECH[lv];
      if (!d || P.q.tech.length || !P.counts.hq) return;
      P.q.tech.push({ kind: 'tech' + lv, level: lv, cost: d, prog: 0, paid: 0, paidOil: 0 });
    } else if (c.c === 'hold') {
      const it = P.q[c.cat][c.i];
      if (it && it.prog < 1) it.hold = !it.hold;
    } else if (c.c === 'cancel') {
      const q = P.q[c.cat], it = q[c.i];
      if (it) { P.supply += it.paid; P.oil += it.paidOil; q.splice(c.i, 1); }
    } else if (c.c === 'place') {
      const d = BUILDINGS[c.kind], q = P.q[d.cat], it = q[0];
      if (!it || it.kind !== c.kind || it.prog < 1) return;
      if (!fits(S, team, c.kind, c.x, c.y)) return;
      q.shift();
      addBuilding(S, c.kind, team, c.x, c.y);
      S.ev.push({ t: 'placed', team, kind: c.kind, x: c.x + d.w / 2, y: c.y + d.h / 2 });
    } else if (c.c === 'sell') {
      const e = S.byId.get(c.id);
      if (!e || !e.b || e.team !== team || e.hp <= 0) return;
      const P2 = S.P[team];
      P2.supply += (e.d.cost || 0) * 0.5 * (e.hp / e.max);
      e.hp = 0;
      S.ev.push({ t: 'sold', id: e.id, x: e.x, y: e.y });
      kill(S, e, team);
    } else if (c.c === 'repair') {
      const e = S.byId.get(c.id);
      if (e && e.b && e.team === team) e.repairing = !e.repairing;
    } else if (c.c === 'rally') {
      const e = S.byId.get(c.id);
      if (e && e.b && e.team === team) { e.rally = [c.x, c.y]; e.primary = true; for (const o of S.ents) if (o !== e && o.b && o.team === team && o.kind === e.kind) o.primary = false; }
    } else if (c.c === 'power') {
      callPower(S, team, c.name, c.x, c.y);
    } else if (c.c === 'income') {
      P.income = clamp(+c.v || 1, 0.3, 2);
    } else if (c.c === 'restart') {
      restartSlot(S, team, { shield: +c.shield || 0 });
    } else if (c.c === 'raze') {
      razeSlot(S, team);
      S.P[team].alive = false;
      territory(S); recount(S);
    } else if (c.c === 'launch') {
      const s = S.ents.find(e => e.b && e.team === team && e.kind === 'silo' && e.hp > 0 && e.charge >= e.d.charge);
      if (!s) return;
      s.charge = 0; s.told = false;
      launch(S, team, s, c.x, c.y);
    }
  }

  function launch(S, team, s, x, y) {
    const dur = 11;
    S.ev.push({ t: 'launch', team, x: s.x, y: s.y, tx: x, ty: y, dur });
    for (const P of S.P) if (P.team !== team) { ownEvent(S, P.team, 'missile'); S.ev.push({ t: 'alert', team: P.team, x, y }); }
    S.shots.push({ w: 'nuke', kind: 'nuke', team, by: s.id, t: 0, dur, x, y, tx: x, ty: y, tz: 0 });
  }

  function callPower(S, team, name, x, y) {
    const P = S.P[team], d = POWERS[name];
    if (!d || P.cooldown[name] > 0 || P.tech < d.tech || !P.counts.radar || P.low || P.supply < d.cost) return;
    P.supply -= d.cost;
    P.cooldown[name] = d.cd;
    if (name === 'uav') {
      S.sweeps.push({ team, x, y, r: d.r, until: S.tick + d.life * HZ });
      S.ev.push({ t: 'uav', team, x, y, dur: d.life });
    } else if (name === 'barrage') {
      for (let i = 0; i < 12; i++) {
        const delay = 1.5 + i * 0.28, a = S.rand() * TAU, r = Math.sqrt(S.rand()) * d.r, sx = x + mcos(a) * r, sy = y + msin(a) * r;
        S.shots.push({ w: 'barrage', kind: 'barrage', team, by: 0, t: 0, dur: delay, x: sx, y: sy, tx: sx, ty: sy, tz: 0 });
        S.ev.push({ t: 'incoming', x: sx, y: sy, dur: delay, team });
      }
    } else if (name === 'para') {
      const from = S.bases[team];
      S.ev.push({ t: 'plane', team, x: from[0], y: from[1], tx: x, ty: y, dur: 4 });
      const flight = mhypot(x - from[0], y - from[1]) / 26 + 1;
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU, sx = x + mcos(a) * 2, sy = y + msin(a) * 2;
        const u = spawn(S, 'rifle', team, sx, sy, { drop: flight + 3 + i * 0.4 });
        const c = goalCells(S, 'foot', clamp(sx | 0, 0, W - 1), clamp(sy | 0, 0, H - 1))[0];
        u.x = u.px = c % W + 0.5; u.y = u.py = (c / W | 0) + 0.5;
      }
    }
  }

  function push(S, team, c) { S.cmds.push({ team, c, at: S.tick }); }

  function separate(S) {
    // Solid bodies. Heavier units shove lighter ones, and nothing ends up inside another.
    for (const u of S.ents) {
      if (u.b || u.hp <= 0 || u.drop > 0 || isAir(u)) continue;
      near(S, u.x, u.y, 2, o => {
        if (o.id <= u.id || o.b || o.hp <= 0 || o.drop > 0 || isAir(o)) return;
        const dx = u.x - o.x, dy = u.y - o.y, d = mhypot(dx, dy) || 0.01, min = (u.d.r + o.d.r) * (u.d.men && o.d.men ? 0.9 : 0.95);
        if (d >= min) return;
        const push = (min - d) * 0.5, nx = dx / d, ny = dy / d;
        const mu = u.d.r, mo = o.d.r, ku = mo / (mu + mo), ko = mu / (mu + mo);
        const cu = clsOf(u), co = clsOf(o);
        const ax = u.x + nx * push * ku * 2, ay = u.y + ny * push * ku * 2;
        if (!blocked(S, cu, cellOf(ax, ay))) { u.x = ax; u.y = ay; }
        const bx = o.x - nx * push * ko * 2, by = o.y - ny * push * ko * 2;
        if (!blocked(S, co, cellOf(bx, by))) { o.x = bx; o.y = by; }
      });
    }
  }

  // The land's own changes in a step: trees flattened, fires, bridges rebuilt or blown, the fords, the sky.
  function stepLand(S) {
    if (S.crush.length) {
      const cells = [...new Set(S.crush)].filter(c => (S.gnd[c] & 8) && S.wood[c] !== 2);
      S.crush.length = 0;
      for (const c of cells) S.wood[c] = 1;
      if (cells.length) { S.woodVer++; setGround(S, cells, cells.map(c => S.gnd[c] & ~8)); }
    }
    if (S.tick % 10 === 5) stepFire(S);
    S.bridges.forEach((b, i) => {
      if (b.fix && S.tick >= b.fix) raiseBridge(S, i);
      if (b.c4 && S.tick >= b.c4) { const m = S.map.bridges[i]; S.ev.push({ t: 'boom', x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, size: 3 }); dropBridge(S, i); }
    });
    // After enough rain the rivers rise over the fords, and they open again as the water goes down.
    if (S.tick % 20 === 0) {
      const w = sky(S), want = S.flooded ? w.flood > 0.65 : w.flood > 0.9;
      if (want !== S.flooded) {
        S.flooded = want;
        const fc = S.map.fordCells;
        setGround(S, fc, fc.map(() => want ? 7 : 4 | 16));
        S.ev.push({ t: 'flood', on: want });
      }
    }
    // The sky turns at the start of a spell, and a storm is called half a minute before it comes.
    if (S.tick > 0 && S.tick % SPELL === 0) {
      const k = S.tick / SPELL, now = spellOf(S.seed, k), was = spellOf(S.seed, k - 1);
      if (now !== was) S.ev.push({ t: 'weather', kind: now, was });
    }
    if ((S.tick + 30 * HZ) % SPELL === 0) {
      const k = (S.tick + 30 * HZ) / SPELL;
      if (spellOf(S.seed, k) === 'storm' && spellOf(S.seed, k - 1) !== 'storm') S.ev.push({ t: 'weather', kind: 'stormsoon' });
    }
  }

  function step(S) {
    S.fieldQueue = 0;
    for (const a of S.ais) a.tick(S);
    rehash(S);
    for (const q of S.cmds) {
      if (S.keepLog) S.log.push({ tick: S.tick, team: q.team, c: q.c });
      // A bad command is dropped the same way everywhere, so the world goes on.
      try { if (S.P[q.team]) apply(S, q.team, q.c); } catch (e) { S.ev.push({ t: 'badcmd', team: q.team }); }
    }
    S.cmds.length = 0;
    stepEconomy(S);
    stepTowns(S);
    for (let i = 0; i < S.ents.length; i++) {
      const e = S.ents[i];
      if (e.hp <= 0) continue;
      if (e.b) stepBuilding(S, e); else stepUnit(S, e);
    }
    stepShots(S);
    separate(S);
    stepLand(S);
    // Trucks in the ore, a little growth on what is left.
    if (S.tick % (HZ * 4) === 0) {
      const f = S.map.oreFields[S.tick / (HZ * 4) % S.map.oreFields.length];
      for (let i = 0; i < 40; i++) {
        const c = cellOf(f.x + (S.rand() - 0.5) * f.r * 1.6, f.y + (S.rand() - 0.5) * f.r * 1.6);
        if (S.map.ore[c] && S.ore[c] < S.map.ore[c]) { S.ore[c] = Math.min(S.map.ore[c], S.ore[c] + 18); S.oreVer++; }
      }
    }
    if (S.ents.some(e => e.hp <= 0)) {
      let dirty = false;
      S.ents = S.ents.filter(e => {
        if (e.hp > 0) return true;
        S.byId.delete(e.id);
        if (e.b) dirty = true;
        return false;
      });
      recount(S);
      if (dirty || S.dirty) { S.dirty = false; territory(S); }
    }
    if (S.tick % 10 === 0) vision(S);
    S.sweeps = S.sweeps.filter(s => s.until > S.tick);
    if (S.layout === 'duel' && !S.over && S.tick % HZ === 0) {
      for (const team of [0, 1]) {
        const left = S.ents.some(e => e.b && e.team === team);
        if (!left) { S.over = { loser: team, winner: 1 - team, tick: S.tick }; S.ev.push({ t: 'over', winner: 1 - team }); break; }
      }
    }
    // In the world a slot whose last building falls is out. What it had left goes with it.
    if (S.layout !== 'duel' && S.tick % HZ === 0) {
      for (const P of S.P) if (P.alive && !S.ents.some(e => e.b && e.team === P.team && e.hp > 0)) {
        P.alive = false;
        razeSlot(S, P.team);
        territory(S); recount(S);
        S.ev.push({ t: 'fallen', team: P.team });
      }
    }
    S.tick++;
  }

  // The ground a player may build on, for the AI and for the placement ghost.
  function spotFor(S, team, kind, ax, ay, rMax = 26, rnd = Math.random) {
    const d = BUILDINGS[kind];
    if (d.well) {
      let best = null, bd = Infinity;
      for (const w of S.map.wells) {
        if (!fits(S, team, kind, w.x - 1, w.y - 1)) continue;
        const dd = mhypot(w.x - ax, w.y - ay);
        if (dd < bd) { bd = dd; best = [w.x - 1, w.y - 1]; }
      }
      return best;
    }
    for (let r = 2; r < rMax; r += 1) {
      const n = Math.max(8, r * 6 | 0), start = rnd() * TAU;
      for (let i = 0; i < n; i++) {
        const a = start + i / n * TAU, cx = Math.round(ax + mcos(a) * r - d.w / 2), cy = Math.round(ay + msin(a) * r - d.h / 2);
        if (fits(S, team, kind, cx, cy) && roomy(S, kind, cx, cy)) return [cx, cy];
      }
    }
    return null;
  }
  // Leaves lanes between buildings so nobody gets boxed in.
  function roomy(S, kind, cx, cy) {
    const d = BUILDINGS[kind], m = kind === 'factory' || kind === 'refinery' || kind === 'airfield' || kind === 'barracks' ? 3 : 2;
    for (let y = cy - m; y < cy + d.h + m; y++) for (let x = cx - m; x < cx + d.w + m; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      if (S.occ[y * W + x]) return false;
    }
    return true;
  }

  function summary(S, team) {
    const P = S.P[team], units = S.ents.filter(e => e.team === team && !e.b), blds = S.ents.filter(e => e.team === team && e.b);
    return { team, supply: P.supply | 0, oil: P.oil | 0, tech: P.tech, units: units.length, blds: blds.length, army: units.reduce((a, u) => a + (u.d.cargo ? 0 : u.d.cost), 0), towns: S.towns.filter(t => t.owner === team).length, ...P.stats };
  }

  return {
    HZ, DT, RES, UNITS, BUILDINGS, WEAPONS, TECH, POWERS, DIFFICULTY, LAYOUT, SIZES,
    get W() { return W; }, get H() { return H; }, get VW() { return VW; }, get VH() { return VH; },
    newGame, step, push, spawn, addBuilding, pickFrom, fits, spotFor, roomy, blockedReason, near, rehash, seenBy, terrainAt, heightAt, los, isAir, armed, cellOf, summary, exitOf,
    mulberry, noiser, clamp, lerp, smooth, angleTo, toXY, toUV, gap, setSize, save, load, hashOf, restartSlot, razeSlot, makeMap, layoutFor,
    msin, mcos, matan2, mhypot,
    BRIDGE_HP, SPELL, weatherAt, sky, dayAt, spellOf, bridgeAt, clsOf, houseHp, hurtBridge, ignite, shielded,
  };
})();
if (typeof module !== 'undefined') module.exports = Rules;
