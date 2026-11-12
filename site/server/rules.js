// Mapmaker's War, the rules. A deterministic real-time strategy world stepped at a fixed rate, with no
// drawing, so a whole game can be played in node. Map cells are one unit wide. Heights sit on a grid
// two to the cell. A duel's map has a half turn of symmetry and the world's a quarter turn, so no side
// starts better placed.
const Rules = (() => {
  const HZ = 20, DT = 1 / HZ, RES = 2;
  // The map's size is set per game. Everything sized by it is made again when it changes.
  let W = 128, H = 128, N = W * H, VW = W * RES + 1, VH = H * RES + 1, CX = W / 2, CY = H / 2;
  // The path heap is made once for the largest map, since games of several sizes may share these rules, as
  // rooms do on the server, and each sets the size again as it steps.
  const MAXN = 256 * 256;
  let HW = Math.ceil(W / 8);
  // The flow fields' queue: each entry a cell, its distance and the next entry in its bucket. A cell is queued
  // once for each neighbour that shortens its way, so eight times the cells at most, and the goal's cells besides.
  const qC = new Int32Array(MAXN * 8 + 4096), qD = new Float32Array(MAXN * 8 + 4096), qN = new Int32Array(MAXN * 8 + 4096);
  let qHead = new Int32Array(64);
  function setSize(w) {
    if (w === W) return;
    W = H = w; N = W * H; VW = W * RES + 1; VH = H * RES + 1; CX = W / 2; CY = H / 2;
    HW = Math.ceil(W / HC);
  }
  // Sets the rules to a game's map, before its commanders think or it steps.
  const use = S => setSize(S.map.W);
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
    // Outranged by an anti-tank rocket, and of little use on a tank's armour.
    auto: { r: 9, dmg: 22, cd: 0.55, fx: 'tracer', snd: 'auto', air: true, vs: { inf: 0.7, light: 1, heavy: 0.25, bld: 0.3, air: 0.7 } },
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
    // Hand to hand: a blow that lands at once, from spear's reach or less.
    spear: { r: 1.6, dmg: 13, cd: 0.9, fx: 'melee', snd: 'clash', vs: { inf: 0.5, light: 1.3, heavy: 0.45, bld: 0.1, air: 0 } },
    pike: { r: 2, dmg: 16, cd: 0.9, fx: 'melee', snd: 'clash', vs: { inf: 0.5, light: 1.5, heavy: 0.6, bld: 0.1, air: 0 } },
    sword: { r: 1.8, dmg: 24, cd: 0.8, fx: 'melee', snd: 'clash', vs: { inf: 1.3, light: 0.6, heavy: 0.35, bld: 0.12, air: 0 } },
    sabre: { r: 1.8, dmg: 28, cd: 0.8, fx: 'melee', snd: 'clash', vs: { inf: 1, light: 0.9, heavy: 0.35, bld: 0.12, air: 0 } },
    tusk: { r: 2.2, dmg: 40, cd: 1.4, fx: 'melee', snd: 'clash', vs: { inf: 1.2, light: 1.5, heavy: 0.7, bld: 0.4, air: 0 } },
    // Arrows and bolts fly, a little high.
    bow: { r: 9, dmg: 10, cd: 0.9, fx: 'arrow', snd: 'bow', speed: 18, air: true, vs: { inf: 1, light: 0.4, heavy: 0.3, bld: 0.05, air: 0.5 } },
    horsebow: { r: 8, dmg: 7, cd: 0.9, fx: 'arrow', snd: 'bow', speed: 18, air: true, vs: { inf: 1, light: 0.5, heavy: 0.12, bld: 0.06, air: 0.4 } },
    javelin: { r: 6, dmg: 13, cd: 1.2, fx: 'arrow', snd: 'bow', speed: 15, vs: { inf: 1, light: 0.7, heavy: 0.25, bld: 0.06, air: 0 } },
    xbow: { r: 9, dmg: 22, cd: 2, fx: 'arrow', snd: 'xbow', speed: 26, air: true, vs: { inf: 1.1, light: 1.25, heavy: 0.6, bld: 0.15, air: 0.6 } },
    longbow: { r: 13, dmg: 30, cd: 1.6, fx: 'arrow', snd: 'longbow', speed: 22, vs: { inf: 1, light: 0.4, heavy: 0.1, bld: 0.05, air: 0.3 } },
    towerbow: { r: 11, dmg: 12, cd: 0.5, fx: 'arrow', snd: 'bow', speed: 20, air: true, vs: { inf: 1, light: 0.5, heavy: 0.15, bld: 0.1, air: 0.4 } },
    ballista: { r: 13, dmg: 60, cd: 3.2, fx: 'arrow', snd: 'xbow', speed: 26, vs: { inf: 0.5, light: 1, heavy: 0.8, bld: 0.5, air: 0 } },
    // Black powder: shot that hits at once in a puff of white smoke.
    musket: { r: 7.5, dmg: 13, cd: 1.7, fx: 'bullet', snd: 'musket', smoke: true, air: true, vs: { inf: 1, light: 0.7, heavy: 0.12, bld: 0.12, air: 0.4 } },
    musketv: { r: 9, dmg: 22, cd: 1.2, fx: 'bullet', snd: 'musket', smoke: true, air: true, vs: { inf: 1, light: 0.45, heavy: 0.12, bld: 0.12, air: 0.4 } },
    carbine: { r: 7, dmg: 12, cd: 1.2, fx: 'bullet', snd: 'musket', smoke: true, vs: { inf: 1, light: 0.5, heavy: 0.12, bld: 0.1, air: 0.3 } },
    jaeger: { r: 12, dmg: 55, cd: 2.2, fx: 'bullet', snd: 'musket', smoke: true, vs: { inf: 1, light: 0.3, heavy: 0.03, bld: 0.03, air: 0 } },
    atr: { r: 8.5, dmg: 45, cd: 2.4, fx: 'bullet', snd: 'sniper', vs: { inf: 0.3, light: 1.3, heavy: 1.3, bld: 0.3, air: 0.2 } },
    // Stones, grenades and shells thrown high over what is in the way.
    // Enough against horse that grenadiers stop a charge of cuirassiers.
    grenade: { r: 6, dmg: 34, cd: 2.6, fx: 'stone', snd: 'bow', speed: 9, splash: 0.9, vs: { inf: 1, light: 2.4, heavy: 0.9, bld: 0.3, air: 0 } },
    stone: { r: 18, min: 5, dmg: 70, cd: 6, fx: 'stone', snd: 'catapult', speed: 13, indirect: true, splash: 1.4, vs: { inf: 0.7, light: 0.7, heavy: 0.6, bld: 1.3, air: 0 } },
    trebstone: { r: 22, min: 6, dmg: 120, cd: 8, fx: 'stone', snd: 'catapult', speed: 13, indirect: true, splash: 1.6, vs: { inf: 0.6, light: 0.7, heavy: 0.7, bld: 1.4, air: 0 } },
    ball: { r: 15, dmg: 90, cd: 3, fx: 'shell', snd: 'cannon', speed: 30, splash: 1.4, vs: { inf: 0.7, light: 2, heavy: 1.2, bld: 0.8, air: 0 } },
    // A field gun's round shot, which cannot be brought to bear on men or horse already at its wheels.
    field: { r: 15, min: 3, dmg: 90, cd: 3, fx: 'shell', snd: 'cannon', speed: 30, splash: 1.4, vs: { inf: 0.7, light: 2, heavy: 1.2, bld: 0.8, air: 0 } },
    howitz: { r: 22, min: 6, dmg: 75, cd: 6, fx: 'stone', snd: 'cannon', speed: 20, indirect: true, splash: 1.8, vs: { inf: 1, light: 0.8, heavy: 0.5, bld: 1, air: 0 } },
    // The future's weapons: pulses of light, plasma, and rails.
    pulse: { r: 9, dmg: 12, cd: 0.45, fx: 'pulse', snd: 'pulse', air: true, vs: { inf: 1, light: 0.4, heavy: 0.15, bld: 0.2, air: 0.6 } },
    plasma: { r: 10, dmg: 70, cd: 2.4, fx: 'pulse', snd: 'pulse', air: true, vs: { inf: 0.3, light: 1, heavy: 1.1, bld: 0.6, air: 0.7 } },
    laser: { r: 18, dmg: 60, cd: 0.8, fx: 'pulse', snd: 'pulse', air: true, onlyAir: true, vs: { air: 1.2 } },
    railrifle: { r: 16, dmg: 120, cd: 3, fx: 'beam', snd: 'rail', vs: { inf: 1, light: 0.3, heavy: 0.1, bld: 0.05, air: 0 } },
    railcannon: { r: 12, dmg: 120, cd: 2.6, fx: 'beam', snd: 'rail', vs: { inf: 0.8, light: 1, heavy: 1, bld: 0.8, air: 0 } },
    twinrail: { r: 13, dmg: 170, cd: 2.8, fx: 'beam', snd: 'rail', vs: { inf: 0.45, light: 1, heavy: 1, bld: 0.8, air: 0 } },
    coil: { r: 14, dmg: 140, cd: 2.8, fx: 'beam', snd: 'rail', vs: { inf: 0.3, light: 1, heavy: 1, bld: 0.7, air: 0 } },
    railart: { r: 28, min: 7, dmg: 110, cd: 8, salvo: 3, gap: 0.3, fx: 'rocket', snd: 'rail', speed: 30, indirect: true, splash: 2, spread: 1.6, vs: { inf: 1, light: 0.8, heavy: 0.6, bld: 0.9, air: 0 } },
  };

  // Units. `cat` names the sidebar queue, `tech` the level that opens it, `need` the building it needs.
  const UNITS = {
    rifle: { name: 'Rifle Squad', cat: 'inf', sym: 'inf', cost: 120, time: 5, hp: 120, armor: 'inf', speed: 1.9, sight: 10, men: 5, r: 0.6, weapons: ['rifle'], move: 'foot', need: 'barracks', tech: 1, capture: true, note: 'Takes towns. Cheap and good against infantry.' },
    rocket: { name: 'Rocket Team', cat: 'inf', sym: 'at', cost: 220, time: 7, hp: 90, armor: 'inf', speed: 1.7, sight: 10, men: 3, r: 0.55, weapons: ['atgm'], move: 'foot', need: 'barracks', tech: 1, note: 'Guided rockets. Hurts vehicles and aircraft.' },
    engineer: { name: 'Engineer', cat: 'inf', sym: 'eng', cost: 300, time: 6, hp: 50, armor: 'inf', speed: 2, sight: 8, men: 1, r: 0.4, weapons: [], move: 'foot', need: 'barracks', tech: 1, engineer: true, note: 'Takes a damaged enemy building, or mends your own.' },
    sniper: { name: 'Sniper', cat: 'inf', sym: 'snp', cost: 450, time: 9, hp: 70, armor: 'inf', speed: 2.2, sight: 15, men: 1, r: 0.4, weapons: ['sniper'], move: 'foot', need: 'barracks', tech: 2, note: 'Very long range. Kills infantry, little else.' },
    hero: { name: 'Lightning', cat: 'inf', sym: 'hero', cost: 1200, time: 15, hp: 260, armor: 'inf', speed: 2.8, sight: 12, men: 1, r: 0.45, weapons: ['hero'], move: 'foot', need: 'barracks', tech: 2, hero: true, limit: 1, note: 'Your commando. Shreds infantry and blows up any building with C4.' },
    general: { name: 'General', cat: 'inf', sym: 'hero', cost: 600, time: 10, hp: 240, armor: 'inf', speed: 2.2, sight: 12, men: 1, r: 0.45, weapons: ['rifle'], move: 'foot', need: 'barracks', tech: 1, general: true, limit: 1, note: 'Men and machines near him fire faster and hold their nerve. In Regicide, lose him and you lose the game.' },
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

  // The other ages' units. Each belongs to a line, and a side builds the form of each line its age has reached.
  const foot = (o) => Object.assign({ cat: 'inf', sym: 'inf', time: 5, armor: 'inf', speed: 1.8, sight: 10, men: 5, r: 0.6, move: 'foot', need: 'barracks' }, o);
  const ride = (o) => Object.assign({ cat: 'veh', time: 7, armor: 'light', sight: 10, r: 0.8, move: 'wheel', need: 'factory', weapons: [] }, o);
  Object.assign(UNITS, {
    spear: foot({ name: 'Spearmen', cost: 70, time: 4, hp: 100, sight: 9, weapons: ['spear'], capture: true, note: 'Take towns, and hold the line against horse.' }),
    pike: foot({ name: 'Pikemen', cost: 85, hp: 115, speed: 1.7, weapons: ['pike'], capture: true, note: 'Long pikes that break knights. Take towns.' }),
    musket: foot({ name: 'Musketeers', cost: 100, hp: 105, weapons: ['musket'], capture: true, note: 'Volleys of shot. Take towns.' }),
    rifleman: foot({ name: 'Riflemen', cost: 110, hp: 115, speed: 1.9, weapons: ['rifle'], capture: true, note: 'Bolt-action rifles. Take towns.' }),
    exo: foot({ name: 'Exo Troopers', cost: 180, hp: 150, speed: 2.2, sight: 11, weapons: ['pulse'], capture: true, note: 'Powered armour and pulse rifles. Take towns.' }),
    archer: foot({ name: 'Archers', sym: 'at', cost: 90, hp: 70, men: 3, r: 0.55, weapons: ['bow'], note: 'Arrows from range, against men and horse.' }),
    crossbow: foot({ name: 'Crossbowmen', sym: 'at', cost: 110, hp: 85, speed: 1.7, men: 3, r: 0.55, weapons: ['xbow'], note: 'Bolts that punch through armour.' }),
    grenadier: foot({ name: 'Grenadiers', sym: 'at', cost: 140, time: 6, hp: 100, speed: 1.7, men: 3, r: 0.55, weapons: ['grenade'], note: 'Lobbed grenades, against horse and guns.' }),
    atrifle: foot({ name: 'AT Riflemen', sym: 'at', cost: 180, time: 6, hp: 90, speed: 1.7, men: 3, r: 0.55, weapons: ['atr'], note: 'Heavy rifles that pierce armour.' }),
    lancer: foot({ name: 'Plasma Lancers', sym: 'at', cost: 280, time: 7, hp: 120, speed: 2, men: 3, r: 0.55, weapons: ['plasma'], note: 'Plasma that melts armour and aircraft.' }),
    longbow: foot({ name: 'Longbowmen', sym: 'snp', cost: 160, time: 7, hp: 85, men: 3, r: 0.55, sight: 14, weapons: ['longbow'], note: 'Very long range. Thin out infantry.' }),
    jaeger: foot({ name: 'Jägers', sym: 'snp', cost: 200, time: 8, hp: 80, men: 1, r: 0.4, sight: 14, speed: 2.1, weapons: ['jaeger'], note: 'Rifled muskets from far off. Kill infantry.' }),
    marksman: foot({ name: 'Marksman', sym: 'snp', cost: 380, time: 8, hp: 70, men: 1, r: 0.4, sight: 15, speed: 2.2, weapons: ['sniper'], note: 'Very long range. Kills infantry, little else.' }),
    ghost: foot({ name: 'Ghost', sym: 'snp', cost: 550, time: 9, hp: 90, men: 1, r: 0.4, sight: 17, speed: 2.4, weapons: ['railrifle'], note: 'A rail rifle that kills men at any range it sees.' }),
    oxcart: ride({ name: 'Ox Cart', sym: 'sup', cost: 350, hp: 300, speed: 1.9, sight: 6, r: 0.9, cargo: 300, note: 'Hauls ore to the smelter.' }),
    wagon: ride({ name: 'Ore Wagon', sym: 'sup', cost: 420, time: 8, hp: 380, speed: 2.2, sight: 6, r: 0.9, cargo: 350, note: 'Hauls ore to the smelter.' }),
    lorry: ride({ name: 'Steam Lorry', sym: 'sup', cost: 550, time: 9, hp: 500, armor: 'heavy', speed: 2.4, sight: 7, r: 0.95, cargo: 420, note: 'Mines ore and hauls it to a refinery.' }),
    // Trade caravans: they run goods between their side's headquarters and the towns it holds, and are paid at
    // each post by the length of the leg they ran.
    tradecart: ride({ name: 'Trade Cart', sym: 'trade', cost: 200, time: 7, hp: 220, speed: 2.1, sight: 6, r: 0.85, trade: 1, limit: 8, note: 'Carries goods between your towns. Paid each trip, more the farther it goes.' }),
    caravan: ride({ name: 'Caravan', sym: 'trade', cost: 220, time: 7, hp: 260, speed: 2.3, sight: 6, r: 0.9, trade: 1, limit: 8, note: 'Carries goods between your towns. Paid each trip, more the farther it goes.' }),
    tradewagon: ride({ name: 'Trade Wagon', sym: 'trade', cost: 240, time: 7, hp: 300, speed: 2.5, sight: 6, r: 0.9, trade: 1, limit: 8, note: 'Carries goods between your towns. Paid each trip, more the farther it goes.' }),
    freightlorry: ride({ name: 'Freight Lorry', sym: 'trade', cost: 280, time: 8, hp: 360, armor: 'heavy', speed: 3, sight: 7, r: 0.95, trade: 1, limit: 8, note: 'Carries goods between your towns. Paid each trip, more the farther it goes.' }),
    freighter: ride({ name: 'Freight Truck', sym: 'trade', cost: 320, time: 8, hp: 420, armor: 'heavy', speed: 3.6, sight: 7, r: 0.95, trade: 1, limit: 8, note: 'Carries goods between your towns. Paid each trip, more the farther it goes.' }),
    hovfreight: ride({ name: 'Hover Freighter', sym: 'trade', cost: 360, time: 8, hp: 480, armor: 'heavy', speed: 4.2, sight: 8, r: 0.95, trade: 1, limit: 8, note: 'Carries goods between your towns. Paid each trip, more the farther it goes.' }),
    // Ships and boats, launched at a dock and kept to open water. Warships fight on the water and shoot along the
    // shore, and fishing boats work the shoals and land their catch at a dock.
    galley: { name: 'War Galley', cat: 'sea', sym: 'ship', cost: 300, time: 9, hp: 280, armor: 'light', speed: 2.8, sight: 11, r: 1.1, weapons: ['bow'], move: 'naval', need: 'dock', note: 'Oars and archers. Holds the water and shoots along the shore.' },
    cog: { name: 'War Cog', cat: 'sea', sym: 'ship', cost: 350, time: 10, hp: 380, armor: 'light', speed: 2.6, sight: 11, r: 1.2, weapons: ['ballista', 'xbow'], move: 'naval', need: 'dock', note: 'A castled ship with a ballista and crossbows.' },
    frigate: { name: 'Frigate', cat: 'sea', sym: 'ship', cost: 500, time: 12, hp: 600, armor: 'heavy', speed: 2.8, sight: 12, r: 1.3, weapons: ['ball'], move: 'naval', need: 'dock', note: 'A broadside of cannon, against ships and the shore.' },
    ironclad: { name: 'Ironclad', cat: 'sea', sym: 'ship', cost: 700, oil: 10, time: 13, hp: 900, armor: 'heavy', speed: 2.6, sight: 12, r: 1.3, weapons: ['twin', 'mg'], move: 'naval', need: 'dock', note: 'Armoured, with heavy guns fore and aft.' },
    destroyer: { name: 'Destroyer', cat: 'sea', sym: 'ship', cost: 900, oil: 20, time: 14, hp: 1000, armor: 'heavy', speed: 3.2, sight: 13, r: 1.4, weapons: ['twin', 'flak'], move: 'naval', need: 'dock', note: 'Fast, with guns against ships and flak against aircraft.' },
    corvette: { name: 'Rail Corvette', cat: 'sea', sym: 'ship', cost: 1000, oil: 30, time: 14, hp: 1100, armor: 'heavy', speed: 3.8, sight: 13, r: 1.3, weapons: ['twinrail', 'laser'], move: 'naval', need: 'dock', note: 'Rail guns and a laser against aircraft.' },
    skiff: { name: 'Fishing Skiff', cat: 'sea', sym: 'boat', cost: 150, time: 6, hp: 120, armor: 'light', speed: 2.2, sight: 6, r: 0.8, weapons: [], move: 'naval', need: 'dock', fish: 100, limit: 6, note: 'Fishes the shoals and lands the catch at your dock.' },
    smack: { name: 'Fishing Smack', cat: 'sea', sym: 'boat', cost: 170, time: 6, hp: 160, armor: 'light', speed: 2.4, sight: 6, r: 0.85, weapons: [], move: 'naval', need: 'dock', fish: 110, limit: 6, note: 'Fishes the shoals and lands the catch at your dock.' },
    trawler: { name: 'Steam Trawler', cat: 'sea', sym: 'boat', cost: 220, time: 7, hp: 220, armor: 'light', speed: 2.8, sight: 7, r: 0.9, weapons: [], move: 'naval', need: 'dock', fish: 130, limit: 6, note: 'Fishes the shoals and lands the catch at your dock.' },
    hovtrawler: { name: 'Hover Trawler', cat: 'sea', sym: 'boat', cost: 260, time: 7, hp: 260, armor: 'light', speed: 3.4, sight: 7, r: 0.9, weapons: [], move: 'naval', need: 'dock', fish: 150, limit: 6, note: 'Fishes the shoals and lands the catch at your dock.' },
    hauler: ride({ name: 'Hauler', sym: 'sup', cost: 800, time: 10, hp: 760, armor: 'heavy', speed: 3, sight: 8, r: 0.95, cargo: 600, note: 'Hover hauler. Mines ore fast.' }),
    outrider: ride({ name: 'Outriders', sym: 'rec', cost: 140, time: 5, hp: 110, speed: 4.6, sight: 13, r: 0.6, move: 'foot', weapons: ['horsebow'], note: 'Horse archers. Fast, and see far.' }),
    dragoon: ride({ name: 'Dragoons', sym: 'rec', cost: 180, time: 5, hp: 140, speed: 4.6, sight: 13, r: 0.6, move: 'foot', weapons: ['carbine'], note: 'Mounted carbines. Fast, and see far.' }),
    motorbike: ride({ name: 'Motorcycle Scouts', sym: 'rec', cost: 240, time: 5, hp: 130, speed: 5.6, sight: 14, r: 0.55, weapons: ['hmg'], note: 'Fast, see far, and gun down infantry.' }),
    hoverscout: ride({ name: 'Hover Scout', sym: 'rec', cost: 320, time: 6, hp: 230, speed: 6.4, sight: 15, r: 0.7, weapons: ['pulse'], turret: 5, note: 'Skims the ground. Sees far.' }),
    chariot: ride({ name: 'Chariots', sym: 'arm', cost: 200, time: 6, hp: 220, speed: 4, r: 0.85, weapons: ['javelin'], note: 'Fast and hard-hitting on open ground.' }),
    knight: ride({ name: 'Knights', sym: 'arm', cost: 260, hp: 300, speed: 3.6, r: 0.7, move: 'foot', weapons: ['sword'], note: 'Heavy horse that rides down infantry. Fears pikes.' }),
    cuirassier: ride({ name: 'Cuirassiers', sym: 'arm', cost: 300, hp: 320, speed: 3.8, r: 0.7, move: 'foot', weapons: ['sabre'], note: 'Armoured horse with sabres. Fear grenades.' }),
    armcar: ride({ name: 'Armoured Car', sym: 'arm', cost: 420, oil: 10, time: 9, hp: 380, speed: 4.2, r: 0.8, weapons: ['auto'], turret: 3, note: 'Fast armour with a quick-firing gun.' }),
    mech: ride({ name: 'Mech Walker', sym: 'arm', cost: 950, oil: 40, time: 13, hp: 820, armor: 'heavy', speed: 2.8, sight: 11, r: 1, move: 'track', weapons: ['railcannon'], turret: 2.4, note: 'Walks through anything. Rail cannon.' }),
    halftrack: ride({ name: 'Halftrack', sym: 'ifv', cost: 380, oil: 5, time: 8, hp: 300, speed: 3.8, sight: 11, weapons: ['hmg'], turret: 4, note: 'Carries a machine gun anywhere.' }),
    hoverapc: ride({ name: 'Hover APC', sym: 'ifv', cost: 520, oil: 20, time: 10, hp: 520, speed: 5, sight: 12, r: 0.85, weapons: ['pulse'], turret: 4, note: 'A fast hover carrier with a pulse turret.' }),
    elephant: ride({ name: 'War Elephants', sym: 'hvy', cost: 650, time: 12, hp: 800, armor: 'light', speed: 2.2, r: 1.1, move: 'foot', weapons: ['tusk'], note: 'Trample horse, men and walls. Fear spears, pikes and cannon.' }),
    landship: ride({ name: 'Landship', sym: 'hvy', cost: 950, oil: 30, time: 14, hp: 850, armor: 'heavy', speed: 1.6, r: 1.15, move: 'track', weapons: ['cannon', 'hmg'], turret: 1, note: 'The first tank. Slow, and almost unstoppable.' }),
    titan: ride({ name: 'Titan', sym: 'hvy', cost: 1900, oil: 80, time: 24, hp: 1900, armor: 'heavy', speed: 2, sight: 12, r: 1.35, move: 'track', weapons: ['twinrail', 'pulse'], turret: 1.6, note: 'A walking fortress with twin rails.' }),
    supcart: ride({ name: 'Supply Cart', sym: 'sup2', cost: 250, time: 6, hp: 200, speed: 2.4, sight: 8, repair: true, note: 'Mends nearby troops and stops attrition abroad.' }),
    ambulance: ride({ name: 'Field Ambulance', sym: 'sup2', cost: 330, hp: 240, speed: 3.2, sight: 9, repair: true, note: 'Mends nearby troops and stops attrition abroad.' }),
    repairbot: ride({ name: 'Repair Drone', sym: 'sup2', cost: 450, oil: 15, time: 8, hp: 280, speed: 4, sight: 10, repair: true, note: 'Mends nearby troops and stops attrition abroad.' }),
    catapult: ride({ name: 'Catapult', sym: 'art', cost: 350, time: 9, hp: 180, speed: 1.5, sight: 8, r: 0.9, weapons: ['stone'], note: 'Hurls stones over walls. Breaks buildings.' }),
    trebuchet: ride({ name: 'Trebuchet', sym: 'art', cost: 450, time: 11, hp: 240, speed: 1.2, sight: 8, r: 1, weapons: ['trebstone'], note: 'Throws far and breaks buildings. Needs a spotter.' }),
    cannonart: ride({ name: 'Cannon', sym: 'art', cost: 450, time: 9, hp: 260, speed: 1.8, sight: 9, r: 0.85, weapons: ['field'], note: 'Round shot against walls and armour.' }),
    howitzer: ride({ name: 'Howitzer', sym: 'art', cost: 600, oil: 15, time: 11, hp: 240, speed: 2.2, sight: 9, r: 0.9, weapons: ['howitz'], turret: 1.6, note: 'Shells from far behind the line. Needs a spotter.' }),
    railart: ride({ name: 'Rail Artillery', sym: 'art', cost: 1000, oil: 40, time: 14, hp: 300, speed: 2.8, sight: 9, r: 0.9, weapons: ['railart'], turret: 1.6, note: 'Rail-launched salvos from very far. Needs a spotter.' }),
    aalorry: ride({ name: 'AA Lorry', sym: 'aa', cost: 420, oil: 10, time: 9, hp: 260, speed: 3, sight: 11, r: 0.85, weapons: ['flak'], turret: 4, note: 'Flak against aircraft.' }),
    laseraa: ride({ name: 'Laser AA', sym: 'aa', cost: 620, oil: 20, time: 11, hp: 320, speed: 3.6, sight: 13, r: 0.85, weapons: ['laser'], turret: 5, note: 'Burns aircraft out of the sky.' }),
    biplane: { name: 'Biplane', cat: 'air', sym: 'jet', cost: 700, oil: 20, time: 12, hp: 160, armor: 'air', speed: 9, sight: 9, r: 0.9, weapons: [], move: 'jet', alt: 5, need: 'airfield', bombs: { n: 2, dmg: 220, splash: 2 }, note: 'Bombs from the air, then back to the airfield to rearm.' },
    stealth: { name: 'Stealth Bomber', cat: 'air', sym: 'jet', cost: 1800, oil: 80, time: 20, hp: 420, armor: 'air', speed: 18, sight: 10, r: 1, weapons: [], move: 'jet', alt: 7, need: 'airfield', bombs: { n: 6, dmg: 360, splash: 2.8 }, note: 'A long bombing run, then home to rearm.' },
    gunship: { name: 'Gunship', cat: 'air', sym: 'hel', cost: 1300, oil: 50, time: 16, hp: 520, armor: 'air', speed: 6.5, sight: 13, r: 1, weapons: ['plasma', 'pulse'], move: 'air', alt: 3.6, need: 'airfield', turret: 3, note: 'Hunts armour. Fears laser AA.' },
    swarm: { name: 'Swarm Drone', cat: 'air', sym: 'uav', cost: 200, oil: 6, time: 3.5, hp: 16, armor: 'air', speed: 11, sight: 8, r: 0.3, weapons: [], move: 'air', alt: 1.5, need: 'airfield', kamikaze: { dmg: 420, splash: 2.2 }, life: 45, note: 'One-way attack drone. Fast, and dies to anything.' },
    // The aircraft of a UAV Sweep or Recon Flight call, flown by the call and never trained: it flies in from its
    // side's base, circles over the target while it watches, and flies off home. It is a real aircraft, and anti-air
    // fire can bring it down.
    recon: { name: 'Recon Biplane', cat: 'air', sym: 'uav', cost: 0, time: 1, hp: 400, armor: 'air', speed: 11, sight: 14, r: 0.9, weapons: [], move: 'air', alt: 9, recon: true, tech: 4, note: 'Flies the Recon Flight call.' },
    uavp: { name: 'Recon Drone', cat: 'air', sym: 'uav', cost: 0, time: 1, hp: 400, armor: 'air', speed: 12, sight: 14, r: 0.8, weapons: [], move: 'air', alt: 10, recon: true, tech: 5, note: 'Flies the UAV Sweep call.' },
  });

  // Each line's form in each age, Ancient to Future. A line with no form of its own in an age keeps its last one.
  const LINES = {
    inf: ['spear', 'pike', 'musket', 'rifleman', 'rifle', 'exo'],
    at: ['archer', 'crossbow', 'grenadier', 'atrifle', 'rocket', 'lancer'],
    snp: [null, 'longbow', 'jaeger', 'marksman', 'sniper', 'ghost'],
    eng: ['engineer'],
    hero: [null, 'hero'],
    gen: ['general'],
    truck: ['oxcart', 'wagon', null, 'lorry', 'truck', 'hauler'],
    trade: ['tradecart', 'caravan', 'tradewagon', 'freightlorry', 'freighter', 'hovfreight'],
    ship: ['galley', 'cog', 'frigate', 'ironclad', 'destroyer', 'corvette'],
    fish: ['skiff', null, 'smack', 'trawler', null, 'hovtrawler'],
    rec: ['outrider', null, 'dragoon', 'motorbike', 'humvee', 'hoverscout'],
    mount: ['chariot', 'knight', 'cuirassier', 'armcar', 'tank', 'mech'],
    ifv: [null, null, null, 'halftrack', 'ifv', 'hoverapc'],
    heavy: ['elephant', null, null, 'landship', 'heavy', 'titan'],
    sup: ['supcart', null, null, 'ambulance', 'support', 'repairbot'],
    siege: ['catapult', 'trebuchet', 'cannonart', 'howitzer', 'mlrs', 'railart'],
    aa: [null, null, null, 'aalorry', 'flak', 'laseraa'],
    fpv: [null, null, null, null, 'fpv', 'swarm'],
    heli: [null, null, null, null, 'heli', 'gunship'],
    jet: [null, null, null, 'biplane', 'jet', 'stealth'],
  };
  // The sidebar's lines, by the building that trains them.
  const LINE_ORDER = { sea: ['fish', 'ship'], inf: ['inf', 'at', 'eng', 'snp', 'hero', 'gen'], veh: ['truck', 'trade', 'rec', 'mount', 'ifv', 'aa', 'sup', 'siege', 'heavy'], air: ['fpv', 'heli', 'jet'] };
  function formOf(line, age) {
    const L = LINES[line];
    if (!L) return null;
    for (let a = Math.min(age, L.length) - 1; a >= 0; a--) if (L[a]) return L[a];
    return null;
  }
  for (const [line, L] of Object.entries(LINES)) L.forEach((k, i) => { if (k && UNITS[k] && !UNITS[k].line) { UNITS[k].line = line; UNITS[k].age = i + 1; } });
  const lineCount = (P, line) => (LINES[line] || []).reduce((n, k, i, L) => n + (k && L.indexOf(k) === i ? P.counts[k] || 0 : 0), 0);

  // Buildings. `terr` is how far the building pushes your border, `power` what it gives or draws.
  const BUILDINGS = {
    hq: { name: 'Headquarters', sym: 'hq', w: 5, h: 5, hp: 2400, cost: 2500, time: 30, power: 20, terr: 24, sight: 22, armor: 'bld', cat: 'bld' },
    power: { name: 'Power Plant', sym: 'pwr', w: 3, h: 3, hp: 700, cost: 300, time: 5, power: 100, terr: 7, sight: 6, armor: 'bld', cat: 'bld', tech: 1, note: 'Every building draws power. Short of it, everything slows.' },
    refinery: { name: 'Ore Refinery', sym: 'ref', w: 4, h: 4, hp: 1000, cost: 1200, time: 11, power: -30, terr: 7, sight: 7, armor: 'bld', cat: 'bld', tech: 1, freeTruck: true, note: 'Turns ore into supply. Comes with a truck.' },
    dock: { name: 'Dock', sym: 'dock', w: 3, h: 3, hp: 900, cost: 450, time: 8, power: -10, terr: 7, sight: 10, armor: 'bld', cat: 'bld', tech: 1, need: 'barracks', shore: true, note: 'Built on a shore beside open water. Launches warships and fishing boats.' },
    barracks: { name: 'Barracks', sym: 'bar', w: 3, h: 3, hp: 800, cost: 400, time: 5, power: -20, terr: 7, sight: 7, armor: 'bld', cat: 'bld', tech: 1, need: 'power', note: 'Trains infantry.' },
    factory: { name: 'War Factory', sym: 'fac', w: 4, h: 4, hp: 1400, cost: 1000, time: 11, power: -30, terr: 7, sight: 7, armor: 'bld', cat: 'bld', tech: 1, need: 'refinery', note: 'Builds vehicles.' },
    radar: { name: 'Radar Station', sym: 'rad', w: 3, h: 3, hp: 800, cost: 800, time: 8, power: -40, terr: 7, sight: 16, armor: 'bld', cat: 'bld', tech: 1, need: 'refinery', note: 'Sees far and opens support calls.' },
    airfield: { name: 'Airfield', sym: 'air', w: 6, h: 4, hp: 1000, cost: 1200, time: 11, power: -30, terr: 7, sight: 8, armor: 'bld', cat: 'bld', tech: 2, need: 'factory', note: 'Launches drones, helicopters and jets.' },
    fob: { name: 'Forward Base', sym: 'fob', w: 3, h: 3, hp: 900, cost: 1000, time: 10, power: -10, terr: 18, sight: 10, armor: 'bld', cat: 'bld', tech: 2, need: 'barracks', note: 'Pushes your border far out and lets you build there.' },
    derrick: { name: 'Oil Derrick', sym: 'oil', w: 2, h: 2, hp: 500, cost: 400, time: 4, power: 0, terr: 5, sight: 6, armor: 'bld', cat: 'bld', tech: 1, well: true, yield: 1.2, note: 'Goes on an oil well in your territory. Pumps oil, which pays for armour.' },
    datacenter: { name: 'AI Data Center', sym: 'dat', w: 4, h: 3, hp: 1000, cost: 2500, time: 20, power: -100, terr: 5, sight: 6, armor: 'bld', cat: 'bld', tech: 1, need: 'radar', note: 'Research a quarter faster, the enemy\'s main army found each minute, and the weather forecast. Needs a lot of power.' },
    capitol: { name: 'Capitol', sym: 'cap', w: 5, h: 5, hp: 2000, cost: 2000, time: 24, power: -20, terr: 10, sight: 10, armor: 'bld', cat: 'bld', tech: 1, need: 'refinery', limit: 1, civic: true, note: 'The seat of government, one to a side. Your towns pay a quarter more and your borders reach a fifth farther. Opens the Levy and shelters your general.' },
    silo: { name: 'Missile Silo', sym: 'sil', w: 3, h: 3, hp: 1200, cost: 3000, time: 24, power: -100, terr: 7, sight: 6, armor: 'bld', cat: 'bld', tech: 3, need: 'radar', charge: 240, note: 'A thermobaric missile every four minutes. The enemy is warned.' },
    bunker: { name: 'MG Bunker', sym: 'bnk', w: 2, h: 2, hp: 600, cost: 350, time: 4, power: -5, terr: 5, sight: 11, armor: 'bld', cat: 'def', tech: 1, need: 'barracks', weapons: ['mg'], note: 'Holds off infantry.' },
    atgun: { name: 'AT Gun', sym: 'atg', w: 2, h: 2, hp: 550, cost: 600, time: 6, power: -10, terr: 5, sight: 13, armor: 'bld', cat: 'def', tech: 1, need: 'barracks', weapons: ['atgun'], turret: 2, note: 'Long-barrelled gun against vehicles.' },
    sam: { name: 'SAM Site', sym: 'sam', w: 2, h: 2, hp: 500, cost: 750, time: 7, power: -20, terr: 5, sight: 16, armor: 'bld', cat: 'def', tech: 2, need: 'radar', weapons: ['sam'], turret: 3, needsPower: true, note: 'Shoots down aircraft. Needs power.' },
    rail: { name: 'Railgun Tower', sym: 'rlg', w: 2, h: 2, hp: 700, cost: 1600, time: 12, power: -50, terr: 6, sight: 16, armor: 'bld', cat: 'def', tech: 3, need: 'radar', weapons: ['rail'], turret: 2, needsPower: true, note: 'One shot wrecks almost anything. Needs a lot of power.' },
  };

  // The ages a side passes through, Ancient to Future, and what reaching each costs. Power and oil come with the
  // Industrial Age.
  const AGES = [null,
    { name: 'Ancient', note: 'Spears, bows, chariots, elephants and catapults.' },
    { name: 'Medieval', cost: 600, oil: 0, time: 20, note: 'Pikes, crossbows, longbows, knights and trebuchets.' },
    { name: 'Gunpowder', cost: 1000, oil: 0, time: 25, note: 'Muskets, grenadiers, dragoons, cuirassiers and cannon.' },
    { name: 'Industrial', cost: 1500, oil: 0, time: 30, note: 'Rifles, armoured cars, landships, biplanes. Power and oil.' },
    { name: 'Modern', cost: 2000, oil: 150, time: 35, note: 'Tanks, helicopters, jets, drones and the missile silo.' },
    { name: 'Future', cost: 2800, oil: 400, time: 45, note: 'Exo troopers, mechs, hover craft, railguns and the titan.' },
  ];
  const MAX_AGE = AGES.length - 1, POWER_AGE = 4, START_SUPPLY = [0, 2000, 2400, 2800, 3200, 3500, 4000], FREE_STOCK = 99999;
  const TECH = {};
  for (let a = 2; a <= MAX_AGE; a++) TECH[a] = { name: AGES[a].name + ' Age', cost: AGES[a].cost, oil: AGES[a].oil, time: AGES[a].time, note: AGES[a].note };
  // Each building's name in each age, the age it first stands in, and a defence's weapon in each age.
  const AGE_B = {
    // The citadel, castle and fort have bows and guns on their walls. A headquarters has none.
    hq: { names: ['Citadel', 'Castle', 'Fort', 'Headquarters', 'Headquarters', 'Command Nexus'], arms: ['towerbow', 'towerbow', 'musketv', 0, 0, 0] },
    power: { age: 4, names: [0, 0, 0, 'Power Station', 'Power Plant', 'Fusion Plant'] },
    refinery: { names: ['Smelter', 'Smelter', 'Smelter', 'Ore Refinery', 'Ore Refinery', 'Ore Refinery'] },
    factory: { names: ['Stables', 'Stables', 'Foundry', 'Factory', 'War Factory', 'Fabricator'] },
    dock: { names: ['Jetty', 'Harbour', 'Dockyard', 'Shipyard', 'Naval Yard', 'Naval Yard'] },
    radar: { names: ['Watchtower', 'Watchtower', 'Signal Tower', 'Radio Station', 'Radar Station', 'Sensor Array'] },
    airfield: { age: 4, names: [0, 0, 0, 'Airfield', 'Airfield', 'Skyport'] },
    fob: { age: 2, names: [0, 'Outpost', 'Redoubt', 'Forward Base', 'Forward Base', 'Forward Base'] },
    derrick: { age: 4 },
    silo: { age: 5, names: [0, 0, 0, 0, 'Missile Silo', 'Orbital Lance'] },
    datacenter: { age: 5, names: [0, 0, 0, 0, 'AI Data Center', 'AI Core'] },
    capitol: { names: ['Senate House', 'Great Hall', 'Palace', 'Capitol', 'Capitol', 'Assembly'] },
    bunker: { names: ['Archer Tower', 'Archer Tower', 'Musket Redoubt', 'MG Nest', 'MG Bunker', 'Pulse Turret'], arms: ['towerbow', 'towerbow', 'musketv', 'mg', 'mg', 'pulse'] },
    atgun: { names: ['Ballista', 'Springald', 'Cannon Battery', 'Field Gun', 'AT Gun', 'Coil Gun'], arms: ['ballista', 'ballista', 'ball', 'atgun', 'atgun', 'coil'] },
    sam: { age: 4, names: [0, 0, 0, 'AA Battery', 'SAM Site', 'Laser AA'], arms: [0, 0, 0, 'flak', 'sam', 'laser'] },
    rail: { age: 6 },
  };
  for (const [k, o] of Object.entries(AGE_B)) { const d = BUILDINGS[k]; d.tech = o.age || 1; if (o.names) d.names = o.names; if (o.arms) d.arms = o.arms; }
  // Barracks stand before there is power to need.
  BUILDINGS.barracks.need = null;
  // A thing's name in an age, and a defence's weapon in its side's age.
  const nameOf = (kind, age) => { const d = BUILDINGS[kind] || UNITS[kind] || POWERS[kind]; return (d && d.names && d.names[Math.max(1, age) - 1]) || (d ? d.name : kind); };
  // A building with arms but no weapons of its own, as the headquarters, fires only in the ages that arm it.
  const armOf = (S, e) => (e.d.arms && e.d.arms[S.P[e.team].tech - 1]) || (e.d.weapons ? e.d.weapons[0] : null);

  // Place names by theatre, for the towns and for the rivers, hills and woods the map letters. A map's names come of
  // its seed, so every player's copy reads the same.
  const NAMES = {
    steppe: {
      town: ['Ashford', 'Millbrook', 'Thornbury', 'Oakham', 'Hollins', 'Brackenfield', 'Wexley', 'Stanmore', 'Fairholt', 'Larkhill', 'Edgecombe', 'Redwater', 'Coldridge', 'Highcroft', 'Marlow', 'Kestrel Down'],
      river: ['River Wend', 'River Arle', 'The Sallow', 'River Coln', 'River Tamsey', 'The Brede', 'River Ouse', 'River Leam'],
      hill: ['Beacon Hill', 'Grey Knoll', 'Crow Height', 'Windy Ridge', 'Hob Tor', 'Gallows Hill', 'Long Edge', 'Raven Crag'],
      wood: ['Ashwood', 'Haverholt', 'Blackthorn Wood', 'Hazel Copse', 'Fenwick Wood', 'Oak Hanger', 'Bramble Wood', 'Kings Holt'],
    },
    desert: {
      town: ['Qasr Amir', 'Bir Hasan', 'Wadi Salma', 'Ain Rafa', 'Tel Zahir', 'Ras Nuba', 'Dar Kufra', 'Sidi Barra', 'Umm Qasa', 'Hamra', 'Zawiya', 'Bir Tawil', 'Khor Anza', 'Ain Sefra', 'Tel Gharib', 'Nahla'],
      river: ['Nahr al-Abyad', 'Nahr Sahl', 'Wadi Kebir', 'Nahr Zarqa', 'Wadi Rimal', 'Nahr Hamra', 'Wadi Tamar', 'Nahr Dhahab'],
      hill: ['Jebel Sur', 'Jebel Ahmar', 'Gara Hawa', 'Jebel Nasr', 'Qarat Silm', 'Jebel Tarik', 'Gara Kabira', 'Jebel Malh'],
      wood: ['Ghaba Nakhil', 'Bustan Rafa', 'The Acacia Groves', 'Ghaba Sidr', 'Bustan Amir', 'The Thorn Groves', 'Ghaba Talh', 'Bustan Zahir'],
    },
    winter: {
      town: ['Kaltbrunn', 'Weissach', 'Hochfeld', 'Grauberg', 'Eisental', 'Tannwald', 'Schneeberg', 'Felsheim', 'Kaltenbach', 'Wolfsegg', 'Lindenhof', 'Steinach', 'Hornau', 'Gletsch', 'Firnbach', 'Rabenstein'],
      river: ['Eisbach', 'Weisse Ach', 'Grauer Inn', 'Kaltwasser', 'Firnach', 'Schmelzbach', 'Felsach', 'Wolfach'],
      hill: ['Rotkopf', 'Graues Horn', 'Adlerspitze', 'Kahler Kogel', 'Wetterstein', 'Eiskopf', 'Hohe Wand', 'Rabenhorn'],
      wood: ['Tannwald', 'Schwarzforst', 'Fichtenhain', 'Wolfsforst', 'Lärchenwald', 'Hochforst', 'Bärenwald', 'Kiefernhain'],
    },
  };
  // The n-th name of a kind for this game: the theatre's list dealt in an order its seed shuffles, with a number
  // after if a map has more than the list.
  function nameFor(S, kind, n) {
    // A map may name its own places, as the Nile names its river.
    const own = Object.values(MAPS).find(m => m.layout === S.layout), fixed = own && own.names && own.names[kind];
    if (fixed) return fixed[n % fixed.length];
    const L = (NAMES[S.theatre] || NAMES.steppe)[kind], order = L.map((_, i) => i), r = mulberry((S.seed * 7919 + kind.length * 104729) >>> 0);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return L[order[n % L.length]] + (n >= L.length ? ' ' + (Math.floor(n / L.length) + 1) : '');
  }
  const townName = (S, i) => nameFor(S, 'town', i);

  // Support calls, made from a radar station.
  const POWERS = {
    // A flare needs no radar: anyone may light the ground, most use by night.
    flare: { name: 'Flare', sym: 'flare', cost: 60, cd: 30, tech: 1, r: 8, life: 20, free: true, names: ['Fire Pots', 'Fire Pots', 'Star Shell', 'Star Shell', 'Flare', 'Light Drone'], note: 'Lights a patch of ground for twenty seconds. Most use by night.' },
    uav: { name: 'UAV Sweep', sym: 'uav', cost: 150, cd: 60, tech: 4, r: 14, life: 15, names: [0, 0, 0, 'Recon Flight', 'UAV Sweep', 'UAV Sweep'], note: 'Lights up a patch of the map for a while.' },
    barrage: { name: 'Artillery Barrage', sym: 'art', cost: 500, cd: 120, tech: 3, r: 6, names: [0, 0, 'Cannon Barrage', 'Artillery Barrage', 'Artillery Barrage', 'Orbital Barrage'], note: 'Twelve heavy shells on one spot.' },
    para: { name: 'Paradrop', sym: 'par', cost: 600, cd: 150, tech: 5, r: 4, note: 'Three squads of infantry, anywhere you can see.' },
    sat: { name: 'Satellite Constellation', sym: 'sat', cost: 2000, cd: 420, tech: 6, r: 10, life: 240, note: 'A rocket puts a constellation in orbit for four minutes. Its passes light up strips of the map, the first across where you point, and night and weather no longer shorten your units\' sight.' },
    // The levy is called from the capitol, at once, with no spot to pick.
    levy: { name: 'Levy', sym: 'levy', cost: 0, cd: 300, tech: 1, need: 'capitol', now: true, names: ['Tribute', 'Levy', 'Levy', 'War Bonds', 'War Bonds', 'Levy'], note: 'Every town you hold pays two minutes of its dues at once, then half its dues for four minutes.' },
  };
  // The building a call needs standing, and whether the side may make it now for want of that building or of power.
  for (const k in POWERS) POWERS[k].key = k;
  const callNeed = d => d.free ? null : d.need || 'radar';
  // In King of the Hill a side's calls are the ones its held points open.
  const callOff = (P, d) => { if (P.calls) return !P.calls.includes(d.key); const n = callNeed(d); return !!n && (!P.counts[n] || (n === 'radar' && !!P.low)); };

  // Upgrades, researched at a building and kept by the side. Each has three tiers, which the Ancient, Gunpowder and
  // Modern ages open, and each tier adds k again. at names the building, or 'def' for every defence. s scales the
  // tier's cost, and note says what n percent buys, n being the sum of the tiers.
  const UPGRADES = {
    range: { name: 'Range', at: 'def', k: 0.15, s: 1, names: ['Fire Arrows', 'Rifled Barrels', 'Fire Control Radar'], note: 'Defences reach {n}% farther.' },
    hard: { name: 'Hardening', at: 'def', k: 0.3, s: 1, names: ['Stone Walls', 'Earthworks', 'Reinforced Concrete'], note: 'Defences stand {n}% more damage.' },
    drill: { name: 'Drill', at: 'barracks', k: 0.2, s: 1, names: ['Drill Yard', 'Drill Sergeants', 'Boot Camp'], note: 'Infantry train {n}% faster.' },
    plate: { name: 'Armour Plate', at: 'factory', k: 0.15, s: 1.2, names: ['Barding', 'Armour Plate', 'Composite Armour'], note: 'Vehicles stand {n}% more damage.' },
    carts: { name: 'Bigger Carts', at: 'refinery', k: 0.25, s: 1, names: ['Bigger Carts', 'Ore Wagons', 'Heavy Haulers'], note: 'Carts and trucks carry {n}% more ore.' },
    relay: { name: 'Signal Relay', at: 'radar', k: 0.25, s: 0.8, names: ['Signal Fires', 'Semaphore', 'Satellite Uplink'], note: 'Support calls recharge {n}% faster.' },
    border: { name: 'Wider Border', at: 'hq', k: 0.25, s: 1.5, names: ['Boundary Stones', 'Land Survey', 'Frontier Posts'], note: 'Headquarters and forward bases push the border {n}% farther.' },
  };
  const UP_AGE = [1, 3, 5], UP_COST = [{ cost: 250, time: 20 }, { cost: 600, time: 30 }, { cost: 1200, oil: 100, time: 40 }];
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const upCost = (k, tier) => { const c = UP_COST[tier - 1], s = UPGRADES[k].s; return { cost: c.cost * s, oil: (c.oil || 0) * s, time: c.time }; };
  const upNote = (k, tier) => UPGRADES[k].note.replace('{n}', Math.round(UPGRADES[k].k * tier * 100));
  // The upgrades a kind of building offers.
  const upsAt = kind => Object.keys(UPGRADES).filter(k => UPGRADES[k].at === kind || (UPGRADES[k].at === 'def' && BUILDINGS[kind] && BUILDINGS[kind].cat === 'def'));
  // What a side's tiers of an upgrade multiply by, one with none.
  const upK = (S, team, k) => { const P = S.P[team]; return 1 + UPGRADES[k].k * ((P && P.up && P.up[k]) || 0); };
  // The most a thing stands, hardened or plated as its side has paid for.
  const hpOf = (S, team, d) => d.cat === 'def' ? Math.round(d.hp * upK(S, team, 'hard')) : d.cat === 'veh' ? Math.round(d.hp * upK(S, team, 'plate')) : d.hp;
  // A weapon's reach from what fires it, farther from a defence of a side with Range.
  const rangeOf = (S, e, wn) => WEAPONS[wn].r * (e.b && e.d.cat === 'def' ? upK(S, e.team, 'range') : 1);
  // What a cart or truck carries.
  const capOf = (S, u) => u.d.cargo * upK(S, u.team, 'carts');

  // Tracks. Ground units wear the cells they move into, tracks most and feet least. Worn ground hardens a step at a
  // time at each of these marks into a track that is quicker going and that paths prefer. Left alone it grows back.
  const WEAR = { foot: 5, wheel: 10, track: 14 }, TRACK_AT = [30, 75, 140], TRACK_GO = [1, 1.04, 1.08, 1.12];
  // Roads are quicker going, wheels most. A way costs the time it takes, and a known way, a road or a worn track,
  // a little less again, as drivers and marchers keep to the ways they know.
  const ROAD_GO = { foot: 1.15, wheel: 1.3, track: 1.2 }, HABIT = [1, 0.88, 0.8, 0.74], ROAD_HABIT = 0.75;
  const ROAD_COST = { foot: Math.fround(ROAD_HABIT / ROAD_GO.foot), veh: Math.fround(ROAD_HABIT / ROAD_GO.wheel), track: Math.fround(ROAD_HABIT / ROAD_GO.track) };
  // Each change of a track makes the shared ways be worked out again, so tracks change only every 45 seconds.
  const TRACK_COST = TRACK_GO.map((g, i) => Math.fround(HABIT[i] / g)), TRACK_EVERY = 45 * HZ;

  // The record kept for the closing report. Each side's figures are sampled every HIST_EVERY ticks. At HIST_MAX
  // samples every other one goes and the gap doubles, so a long game's record stays small.
  const HIST_EVERY = 10 * HZ, HIST_MAX = 240;
  // What a thing is worth, with oil at four times supply, as it is that much scarcer.
  const worth = d => (d.cost || 0) + 4 * (d.oil || 0);
  // The points an age is worth, from what reaching it and the ages before cost.
  const TECH_PTS = [0, 0];
  for (let a = 2; a <= MAX_AGE; a++) TECH_PTS[a] = TECH_PTS[a - 1] + worth(TECH[a]) / 10;

  // A bridge stands this much damage. A house stands less, more for each floor.
  const BRIDGE_HP = 1500;
  const houseHp = h => 260 + 220 * h.floors;
  // A held town pays its side ore and oil each second by its size: the floor of its houses still standing, a
  // damaged house by what is left of it, against the map's mean town when whole. A share of TOWN_FLOOR is paid
  // whatever the size, so a hamlet pays about half the mean and the largest towns about half as much again, while
  // a map's towns together pay what they always have. A held town mends: its damaged houses over HOUSE_MEND
  // seconds, and a ruin is rebuilt after HOUSE_REBUILD seconds held.
  const TOWN_PAY = 5, TOWN_OIL = 0.25, TOWN_FLOOR = 0.35, HOUSE_MEND = 120, HOUSE_REBUILD = 150;
  const houseFloor = h => h.w * h.h * h.floors;
  function townSizes(M) {
    if (M._tsz) return M._tsz;
    const list = M.towns.map(() => []);
    M.houses.forEach((h, i) => { if (list[h.town]) list[h.town].push(i); });
    const full = list.map(l => l.reduce((a, i) => a + houseFloor(M.houses[i]), 0));
    return (M._tsz = { list, full, mean: full.reduce((a, b) => a + b, 0) / Math.max(1, full.length) });
  }
  // A town's share of the mean town's pay, as it stands now.
  function townShare(S, ti) {
    const z = townSizes(S.map);
    if (!z.mean) return 1;
    let now = 0;
    for (const i of z.list[ti]) { const h = S.map.houses[i]; now += houseFloor(h) * clamp(S.hh[i] / houseHp(h), 0, 1); }
    return TOWN_FLOOR + (1 - TOWN_FLOOR) * now / z.mean;
  }
  // A side with a capitol standing has its towns pay CIVIC_PAY times as much and its borders reach CIVIC_REACH
  // times as far. A levy takes LEVY_NOW seconds of a town's dues at once, and the town pays LEVY_AFTER of them for
  // LEVY_FOR seconds after.
  const CIVIC_PAY = 1.25, CIVIC_REACH = 1.2, LEVY_NOW = 120, LEVY_AFTER = 0.5, LEVY_FOR = 240;
  // A town's pay a second to a side, before its houses are counted.
  function townRate(S, ti, team) {
    const P = team >= 0 ? S.P[team] : null;
    return (P ? P.income : 1) * (P && P.counts.capitol ? CIVIC_PAY : 1) * (S.towns[ti] && S.towns[ti].lv > S.tick ? LEVY_AFTER : 1);
  }
  // What a town pays a side a second, its houses standing and in all, and what it is by its size when whole: a
  // hamlet, a village or a town.
  function townPay(S, ti, team) {
    const z = townSizes(S.map), k = townShare(S, ti), inc = townRate(S, ti, team);
    const whole = z.mean ? TOWN_FLOOR + (1 - TOWN_FLOOR) * z.full[ti] / z.mean : 1;
    return { ore: TOWN_PAY * inc * k, oil: TOWN_OIL * inc * k, share: k, houses: z.list[ti].length, standing: z.list[ti].filter(i => S.hh[i] > 0).length, kind: whole < 0.75 ? 'hamlet' : whole < 1.25 ? 'village' : 'town', levied: !!(S.towns[ti] && S.towns[ti].lv > S.tick) };
  }

  const DIFFICULTY = {
    // ageEvery is the minutes between reaching for each next age, up to maxAge, and rich, if set, the supply over an
    // age's cost that sends for it up to half that early. gap is seconds between powers.
    // ramp caps the army at ramp[0] units plus ramp[1] a minute. def is the most defences it builds. ups is how many
    // lines of upgrade it buys.
    // delay is the seconds before the first wave. raid, if set, is how long a wave stays out before it goes
    // home. pulse, if set, says whether units built during a wave guard home instead of joining it.
    // Each level beats the one below about 3 games in 4. The age clock and the army cap decide most games, so the
    // levels differ in those by little.
    recruit: { think: 2, income: 0.8, wave: 2600, grow: 400, delay: 420, power: false, maxAge: 6, apm: 3, ageEvery: 5, gap: 120, silo: false, ramp: [6.5, 2], def: 3, ups: 4, name: 'Recruit' },
    regular: { think: 2, income: 0.8, wave: 2600, grow: 400, delay: 420, power: true, maxAge: 6, apm: 3, ageEvery: 5, gap: 120, silo: false, ramp: [7, 2.2], def: 3, ups: 4, name: 'Regular' },
    veteran: { think: 1.5, income: 0.85, wave: 2200, grow: 800, delay: 360, power: true, maxAge: 6, apm: 5, ageEvery: 4.75, gap: 90, silo: true, ramp: [7, 2.2], def: 3, ups: 4, name: 'Veteran' },
    // Holds a player's base while they are away: builds and defends, never sets out.
    keeper: { think: 3, income: 1, wave: 1e9, grow: 0, delay: 1e9, power: false, maxAge: 6, apm: 2, ageEvery: 6, gap: 90, silo: false, ramp: [8, 1], def: 6, stay: true, ups: 5, name: 'Keeper' },
  };

  // Seeded numbers and value noise.
  // The dice can tell where they stand and be set there again, so a saved game rolls on as it would have.
  function mulberry(a) {
    const r = () => {
      a = (a | 0) + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    r.state = () => a; r.seed = v => { a = v | 0; };
    return r;
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
  const SIZES = {
    duel: 128, quad: 192, world: 256, gulf: 128, pass: 128, lakes: 192,
    greenwood: 128, oldforest: 192, twinlakes: 128, ponds: 192, seas: 128, isles: 192, peaks: 128, highlands: 192, rivers3: 128, crater: 192, mesa: 128, nile: 128, atlantis: 192, falls: 128, summit: 128,
  };
  // The maps a game may be set on, each a layout and the most sides it seats.
  const MAPS = {
    duel: { name: 'River Duel', layout: 'duel', seats: 2, about: 'Two bases across one river, three bridges and a ford.' },
    quad: { name: 'Four Quarters', layout: 'quad', seats: 4, about: 'Four corners parted by two crossing rivers.' },
    world: { name: 'Crossed Rivers', layout: 'world', seats: 8, about: 'Eight bases round a ring, two to each quarter.' },
    gulf: { name: 'The Gulf', layout: 'gulf', seats: 2, about: 'Two bases either side of a long gulf, with land round both ends. Docks and ships hold the water.' },
    pass: { name: 'High Pass', layout: 'pass', seats: 2, koth: 3, about: 'A steep ridge between two bases, crossed only at three passes.' },
    lakes: { name: 'Lake Country', layout: 'lakes', seats: 4, about: 'Four corners round a great lake, a road all the way round its shore.' },
    greenwood: { name: 'Greenwood', layout: 'greenwood', seats: 2, about: 'Two bases in deep woods, with roads cut through and clearings round the towns. Tanks keep to the roads.' },
    oldforest: { name: 'Old Forest', layout: 'oldforest', seats: 4, about: 'Four corners in an old forest, joined by woodland roads and a ring of towns.' },
    twinlakes: { name: 'Twin Lakes', layout: 'twinlakes', seats: 2, koth: 3, about: 'Two lakes between the bases, a road between them and one round each end. Docks hold the lakes.' },
    ponds: { name: 'Thousand Lakes', layout: 'ponds', seats: 4, about: 'Four corners in a country of small lakes and ponds that break up every line of march.' },
    seas: { name: 'Two Seas', layout: 'seas', seats: 2, about: 'A broad land between two seas, each base near a coast. Ships can strike the flanks.' },
    isles: { name: 'Archipelago', layout: 'isles', seats: 4, about: 'Four islands round a great middle one, joined by long bridges. Ships hold the water between.' },
    peaks: { name: 'Twin Peaks', layout: 'peaks', seats: 2, koth: 2, about: 'Two mountains between the bases, a valley through the middle and a way round each end.' },
    highlands: { name: 'Highlands', layout: 'highlands', seats: 4, koth: 5, about: 'Ridges part four corners, crossed by passes, round a plateau each side can climb to.' },
    rivers3: { name: 'Three Rivers', layout: 'rivers3', seats: 2, about: 'Three rivers between two bases, each with its bridges and a ford. Lines to hold.' },
    crater: { name: 'Crater Lake', layout: 'crater', seats: 4, koth: 5, about: 'A lake inside a ring of mountains, entered through four gaps, with a base in each corner outside.' },
    // A map may fix its theatre, and draw its woods as other plants.
    nile: { name: 'The Nile', layout: 'nile', seats: 2, theatre: 'desert', flora: 'palm', names: { river: ['The Nile'] }, about: 'The great river runs between the two sides through the desert, a green strip of fields and palms along its banks, crossed by three long bridges. Pyramids, a temple and its obelisks stand on the sand.' },
    atlantis: { name: 'Atlantis', layout: 'atlantis', seats: 4, ruins: true, about: 'A great island of rings of land and water round a central citadel, joined by bridges, with canals cut in from the sea. Ships can sail the rings.' },
    falls: { name: 'The Falls', layout: 'falls', seats: 2, about: 'A broad river drops over a great horseshoe fall, as at Niagara, into a deep gorge between the two sides. Bridges and a ford cross above the falls, an island town stands between them, and only a high bridge spans the gorge. Docks hold each reach.' },
    mesa: { name: 'Mesa Country', layout: 'mesa', seats: 2, koth: 3, theatre: 'desert', flora: 'cactus', about: 'Open desert of dunes and sheer-sided mesas, with stands of cactus. The mesas wall off the lines of march.' },
    summit: { name: 'The Summit', layout: 'summit', seats: 2, koth: 3, about: 'One great mountain between the bases, its top far above the land, climbed on foot by four ridges, with a camp partway up each base\'s. Roads run round its foot.' },
  };
  // The theatre a game on a map is fought in: the map's own, if it fixes one, or the one chosen.
  const theatreOf = (map, chosen) => (MAPS[map] && MAPS[map].theatre) || chosen;
  // Which of a map's bases each seated slot starts at: spread evenly round the ring. In slot order, or given a
  // random draw rnd, with the ring turned a random step and the sides dealt the places in a random order.
  function spread(seats, n, rnd) {
    const pos = new Array(n).fill(-1), used = new Set(), order = seats.slice(), turn = rnd ? Math.floor(rnd() * n) : 0;
    if (rnd) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    order.forEach((t, j) => { const p = (Math.round(j * n / order.length) + turn) % n; pos[t] = p; used.add(p); });
    // The empty slots take the bases left over.
    const rest = [...Array(n).keys()].filter(p => !used.has(p));
    for (let t = 0; t < n; t++) if (pos[t] < 0) pos[t] = rest.shift();
    return pos;
  }

  // Where everything goes on a kind of map. syms are the turns that carry the map onto itself. Each
  // feature is listed with all of its images in a row, so one town's images sit side by side.
  // How wooded a map is beyond the usual: the woods' patches grow wider, start on lower ground and stand thicker.
  // Maps not named keep the usual woods.
  // How many brooks each map's part has. Every part of a map gets the same, so the map stays fair. A brook runs at
  // most BROOK_REACH cells.
  const BROOK_REACH = 90;
  // A brook's bed lies BED_D under the land. A step down of more than FALL_STEP from one point of its course to the
  // next (0.8 apart) is steep, and a run of them falling FALL_MIN or more is a waterfall.
  // The Falls' gorge water lies FALLS_DROP under the river's.
  const FALLS_DROP = 3.6;
  const BED_D = 0.35, FALL_STEP = 0.4, FALL_MIN = 0.8, FALL_MAPS = new Set(['pass', 'peaks', 'highlands']);
  const BROOKS = { duel: 2, quad: 1, world: 1, gulf: 2, pass: 2, lakes: 1, greenwood: 2, oldforest: 1, twinlakes: 2, seas: 2, peaks: 2, highlands: 1, crater: 1 };
  // The treeline: woods thin out over TREE_BAND of height round TREE_LINE and stand no higher.
  const TREE_LINE = 8.6, TREE_BAND = 1.2;
  // How thinly a map's woods are sown, a share of the usual; the desert's cactus stands are sparse.
  const THIN = { mesa: 0.35, nile: 1.6 };
  // Mountains step into benches and sheer faces from this height up, each step this high.
  const CLIFF_FROM = 4.2, CLIFF_STEP = 2.6;
  // The maps whose sea coasts stand in places as cliffs.
  const SEA_CLIFFS = new Set(['seas', 'isles', 'gulf', 'lakes', 'atlantis']);
  const WOODS = { quad: 0.7, pass: 1, lakes: 1, greenwood: 3, oldforest: 1.3, twinlakes: 0.6, ponds: 0.8, peaks: 0.6, highlands: 0.5, crater: 0.5 };
  // A point turned a quarter round the middle k times.
  const turnK = ([x, y], k) => { let dx = x - CX, dy = y - CY; for (let i = 0; i < k; i++) { const t = dx; dx = -dy; dy = t; } return [CX + dx, CY + dy]; };
  // Round lakes and ponds as a layout's water: how far a point lies past the edge of the nearest, with a bank of
  // three. The shore falls about five cells beyond each radius.
  const pools = list => (x, y) => { let d = 1e9; for (const [px, py, r] of list) d = Math.min(d, mhypot(x - px, y - py) - r); return [Math.max(0, d), 3]; };
  // Round islands in open water: how far a point lies inside the nearest island's radius, nothing out at sea. The
  // shore falls about six cells inside each radius.
  const isles = list => (x, y) => { let d = 0; for (const [px, py, r] of list) d = Math.max(d, r - mhypot(x - px, y - py)); return [d, 3]; };
  // A mountain: cliffs no vehicle climbs round a top `top` high and r across, and foothills beyond.
  const massif = (d, r, top) => top * (1 - smooth(r - 4, r + 3, d)) + 1.6 * (1 - smooth(r, r + 14, d));
  function layoutFor(kind) {
    const L = { kind, roads: [], bridges: [], towns: [], ore: [], wells: [], bases: [], fords: [] };
    const all = (list, p, extra = []) => { for (const T of L.syms) { const q = T(p); list.push([q[0], q[1], ...extra]); } };
    // A ford's images, each its middle and the unit way along the river.
    const fordAt = (p, q) => { for (const T of L.syms) { const a = T(p), b = T(q), d = mhypot(b[0] - a[0], b[1] - a[1]); L.fords.push([a[0], a[1], (b[0] - a[0]) / d, (b[1] - a[1]) / d]); } };
    const R = (a, b, wig, rep = true) => L.roads.push({ a, b, wig, rep });
    if (MORE.has(kind)) return moreLayout(kind, L, all, fordAt, R);
    // Lake Country: the four quarters round one great lake, with no rivers or bridges, a road round the shore.
    if (kind === 'lakes') {
      const rot = ([x, y], k) => { let dx = x - CX, dy = y - CY; for (let i = 0; i < k; i++) { const t = dx; dx = -dy; dy = t; } return [CX + dx, CY + dy]; };
      L.syms = [0, 1, 2, 3].map(k => p => rot(p, k));
      const sc = W / 256, polar = (r, deg) => [CX + r * sc * mcos(deg * PI / 180), CY + r * sc * msin(deg * PI / 180)], R0 = 40 * sc;
      L.lake = true;
      L.river = (x, y) => [Math.max(0, mhypot(x - CX, y - CY) - R0), 3];
      L.domain = (x, y) => x + 0.5 - CX > 0 && y + 0.5 - CY > 0;
      const C = polar(120, 45), tOut = polar(102, 67.5), tIn = polar(70, 67.5), mid = polar(98, 90);
      for (const T of L.syms) L.bases.push(T(C));
      all(L.towns, tOut); all(L.towns, tIn);
      all(L.ore, mid, [6]);
      const m = mhypot(CX - C[0], CY - C[1]), f = [(CX - C[0]) / m, (CY - C[1]) / m], s = [-f[1], f[0]];
      all(L.ore, [C[0] + f[0] * 7 + s[0] * 18, C[1] + f[1] * 7 + s[1] * 18], [7]);
      all(L.ore, [C[0] + f[0] * 7 - s[0] * 19, C[1] + f[1] * 7 - s[1] * 19], [6.5]);
      all(L.wells, [C[0] - f[0] * 4 + s[0] * 16, C[1] - f[1] * 4 + s[1] * 16]);
      all(L.wells, [C[0] - f[0] * 4 - s[0] * 16, C[1] - f[1] * 4 - s[1] * 16]);
      all(L.ore, polar(84, 67.5), [5]);
      all(L.wells, polar(80, 56)); all(L.wells, polar(80, 79));
      L.fish = []; all(L.fish, polar(20, 67.5)); all(L.fish, polar(30, 22.5));
      R(C, tOut, 2); R(tOut, tIn, 3); R(tIn, polar(70, 157.5), 4); R(C, mid, 2.5);
      return L;
    }
    // The Gulf and High Pass are drawn on the River Duel's frame, two bases mirrored across the middle.
    if (kind === 'gulf' || kind === 'pass') {
      L.syms = [p => [p[0], p[1]], mirror];
      L.domain = (x, y) => { const u = toUV(x + 0.5, y + 0.5)[0]; return u < 0 || (u === 0 && x <= y); };
      const uvp = (u, v) => toXY(u, v), B = uvp(kind === 'gulf' ? -46 : -52, 0);
      L.bases.push(B, mirror(B));
      if (kind === 'gulf') {
        // A long gulf of open water down the middle, with land round both of its ends.
        L.lake = true;
        L.river = (x, y) => { const [u, v] = toUV(x, y); return [mhypot(u, Math.max(0, Math.abs(v) - 32)), 14 + 2 * mcos(v * 0.07)]; };
        const tN = uvp(-34, 36), tS = uvp(-34, -36), tP = uvp(-8, 62);
        all(L.towns, tN); all(L.towns, tS); all(L.towns, tP);
        [[-44, 20, 7], [-44, -21, 6.5], [-46, 48, 5.5], [-50, -40, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
        [[-54, -14], [-54, 14], [-24, 50], [-26, -52]].forEach(o => all(L.wells, uvp(o[0], o[1])));
        L.fish = []; [[-4, 16], [-6, -14], [0, 0]].forEach(o => all(L.fish, uvp(o[0], o[1])));
        R(uvp(-40, 0), tN, 2); R(uvp(-40, 0), tS, 2); R(tN, tP, 3); R(tP, uvp(8, 62), 2); R(tS, uvp(-12, -66), 3);
      } else {
        // A steep ridge down the middle, broken by a pass at each end and a narrow one between the bases.
        L.river = () => [99, 0];
        L.wall = (x, y) => {
          const [u, v] = toUV(x, y), gap = Math.min(smooth(4, 9, Math.abs(v - 42)), smooth(4, 9, Math.abs(v + 42)), smooth(2, 4.5, Math.abs(v)));
          return 7.5 * (1 - smooth(3, 8, Math.abs(u))) * gap;
        };
        const tN = uvp(-24, 42), tS = uvp(-24, -42), tC = uvp(-20, 0);
        all(L.towns, tN); all(L.towns, tS); all(L.towns, tC);
        [[-50, 18, 7], [-50, -19, 6.5], [-36, 24, 5.5], [-36, -26, 5.5], [-30, 60, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
        [[-60, -16], [-60, 16], [-16, 28], [-18, -28]].forEach(o => all(L.wells, uvp(o[0], o[1])));
        R(uvp(-46, 0), tC, 2); R(tC, uvp(0, 0), 0.5); R(uvp(-46, 0), tN, 2.5); R(uvp(-46, 0), tS, 2.5);
        R(tN, uvp(0, 42), 1); R(tS, uvp(0, -42), 1);
      }
      return L;
    }
    if (kind === 'world' || kind === 'quad') {
      const rot = ([x, y], k) => { let dx = x - CX, dy = y - CY; for (let i = 0; i < k; i++) { const t = dx; dx = -dy; dy = t; } return [CX + dx, CY + dy]; };
      L.syms = [0, 1, 2, 3].map(k => p => rot(p, k));
      // Four Quarters is the world drawn smaller, with a base only in each corner. What lies round a base keeps
      // its size.
      const sc = W / 256, quad = kind === 'quad';
      const polar = (r, deg) => [CX + r * sc * mcos(deg * PI / 180), CY + r * sc * msin(deg * PI / 180)];
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
      for (const T of L.syms) { L.bases.push(T(C)); if (!quad) L.bases.push(T(E)); }
      const tOut = polar(100, 67.5), tIn = polar(52, 67.5);
      all(L.towns, tOut); all(L.towns, tIn);
      // Where the world has its second base, Four Quarters has one ore field between two corners, to fight over.
      if (quad) all(L.ore, E, [6]);
      for (const b of quad ? [C] : [C, E]) {
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
      const s1 = 45 * sc, s2 = 95 * sc, sf = 70 * sc;
      for (const s of [s1, s2]) { const [a, b] = span(rivers[0], s); for (const T of L.syms) L.bridges.push([T(a), T(b)]); }
      R(C, tOut, 2); R(E, tOut, 2); R(tOut, tIn, 3);
      R(tIn, span(rivers[0], s1)[1], 2.5); R(tIn, span(rivers[1], s1)[0], 2.5);
      R(C, span(rivers[0], s2)[1], 2.5); R(E, span(rivers[1], s2)[0], 2.5);
      for (const s of [s1, s2]) { const [a, b] = span(rivers[0], s); R(a, b, 0); }
      // A ford between the two bridges, as a middle point and the river's way there.
      fordAt(fromRiver(rivers[0], sf, riverU(sf)), fromRiver(rivers[0], sf + 1, riverU(sf + 1)));
      // Shoals in the water by each base, where the boats from its dock fish.
      L.fish = []; if (quad) { all(L.fish, [172, 120]); all(L.fish, [95, 94]); } else { all(L.fish, [230, 176]); all(L.fish, [104, 208]); all(L.fish, [127, 126]); }
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
    // Shoals in the water by each base, where the boats from its dock fish, and in every other stretch of water.
    L.fish = []; all(L.fish, [53, 68]); all(L.fish, [109, 16]);
    return L;
  }

  // ---- The second set of maps: woods, lakes, seas, islands, mountains and rivers ----
  const MORE = new Set(['greenwood', 'oldforest', 'twinlakes', 'ponds', 'seas', 'isles', 'peaks', 'highlands', 'rivers3', 'crater', 'mesa', 'nile', 'atlantis', 'falls', 'summit']);
  function moreLayout(kind, L, all, fordAt, R) {
    const dry = () => [99, 0];
    // Two sides on the River Duel's frame, mirrored through the middle.
    const duel = () => {
      L.syms = [p => [p[0], p[1]], mirror];
      L.domain = (x, y) => { const u = toUV(x + 0.5, y + 0.5)[0]; return u < 0 || (u === 0 && x <= y); };
    };
    // Four corners, each a quarter turn from the last. polar is in the 256-cell world's units.
    const sc = W / 256, polar = (r, deg) => [CX + r * sc * mcos(deg * PI / 180), CY + r * sc * msin(deg * PI / 180)];
    const quad = () => {
      L.syms = [0, 1, 2, 3].map(k => p => turnK(p, k));
      L.domain = (x, y) => x + 0.5 - CX > 0 && y + 0.5 - CY > 0;
    };
    // How far a point lies clear of what must stay open: the bases, towns, ore, wells and the roads' lines, 1 when
    // clear and 0 on them, with margins scaled by s. Read once the layout is laid.
    const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1); return mhypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
    let segs = null, keepOut = null;
    const clearK = (x, y, s = 1) => {
      if (!segs) { segs = L.roads.flatMap(r => L.syms.map(T => [T(r.a), T(r.b), r.wig])); keepOut = [...L.bases.map(b => [b[0], b[1], 26]), ...L.towns.map(t => [t[0], t[1], 12]), ...L.ore.map(o => [o[0], o[1], o[2] + 4]), ...L.wells.map(w => [w[0], w[1], 6])]; }
      let k = 1;
      for (const o of keepOut) k = Math.min(k, smooth(o[2] * s, (o[2] + 6) * s, mhypot(x - o[0], y - o[1])));
      for (const [a, b, w] of segs) k = Math.min(k, smooth(w + 4 * s, w + 9 * s, segD([x, y], a, b)));
      return k;
    };
    // A road through the middle is laid as two halves meeting there, each the other's image, so a wandering road
    // keeps the map exactly symmetric.
    const uvp = (u, v) => toXY(u, v);
    // A duel base's own ore and wells, ahead to either side and behind.
    const duelKit = (u0, v0) => {
      all(L.ore, uvp(u0 + 7, v0 + 18), [7]); all(L.ore, uvp(u0 + 8, v0 - 19), [6.5]);
      all(L.wells, uvp(u0 - 4, v0 - 16)); all(L.wells, uvp(u0 - 4, v0 + 16));
    };
    // A corner base's own ore and wells, as Four Quarters lays them.
    const quadKit = b => {
      const m = mhypot(CX - b[0], CY - b[1]), f = [(CX - b[0]) / m, (CY - b[1]) / m], s = [-f[1], f[0]];
      all(L.ore, [b[0] + f[0] * 7 + s[0] * 18, b[1] + f[1] * 7 + s[1] * 18], [7]);
      all(L.ore, [b[0] + f[0] * 7 - s[0] * 19, b[1] + f[1] * 7 - s[1] * 19], [6.5]);
      all(L.wells, [b[0] - f[0] * 4 + s[0] * 16, b[1] - f[1] * 4 + s[1] * 16]);
      all(L.wells, [b[0] - f[0] * 4 - s[0] * 16, b[1] - f[1] * 4 - s[1] * 16]);
    };
    // Four corners with two towns in each quarter, a ring of roads between them, and a contested field of ore
    // on each border, as Old Forest, Thousand Lakes and Crater Lake share.
    const ring = (tIn, inner) => {
      const C = polar(120, 45), E = polar(95, 90), tOut = polar(100, 67.5);
      for (const T of L.syms) L.bases.push(T(C));
      all(L.towns, tOut); all(L.towns, tIn);
      quadKit(C); all(L.ore, E, [6]);
      R(C, tOut, 2); R(tOut, E, 2); R(E, turnK(C, 1), 2.5);
      if (inner) { R(tOut, tIn, 3); R(tIn, turnK(tIn, 1), 4); }
      return { C, E, tOut };
    };

    if (kind === 'greenwood') {
      duel(); L.river = dry;
      L.bases.push(uvp(-52, 0), mirror(uvp(-52, 0)));
      const tN = uvp(-24, 38), tS = uvp(-26, -36), tC = uvp(-14, 8), hub = uvp(-44, 0);
      for (const t of [tN, tS, tC]) all(L.towns, t);
      duelKit(-52, 0);
      [[-30, 18, 6], [-18, -18, 5.5], [-30, 46, 5], [-34, -46, 5], [-4, 26, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
      [[-16, 28], [-28, -52], [-20, -26]].forEach(o => all(L.wells, uvp(o[0], o[1])));
      R(hub, tN, 2.5); R(hub, tS, 2.5); R(hub, tC, 2); R(tN, mirror(tS), 3); R(tC, [CX, CY], 1.5);
    } else if (kind === 'oldforest') {
      quad(); L.river = dry;
      ring(polar(52, 67.5), true);
      all(L.ore, polar(30, 67.5), [5]); all(L.ore, polar(78, 62), [5]);
      all(L.wells, polar(70, 56)); all(L.wells, polar(72, 77));
    } else if (kind === 'twinlakes' || kind === 'peaks') {
      // Two lakes, or two mountains, between the bases, with a way between them and one round each end.
      duel();
      const lakes = kind === 'twinlakes';
      const P = lakes ? uvp(0, 30) : uvp(-6, 30), Q = mirror(P);
      if (lakes) { L.lake = true; L.river = pools([[P[0], P[1], 12], [Q[0], Q[1], 12]]); L.fish = []; all(L.fish, uvp(0, 30)); all(L.fish, uvp(4, 22)); }
      else { L.river = dry; L.wall = (x, y) => Math.max(massif(mhypot(x - P[0], y - P[1]), 14, 7.5), massif(mhypot(x - Q[0], y - Q[1]), 14, 7.5)); }
      L.bases.push(uvp(-56, 0), mirror(uvp(-56, 0)));
      const tN = uvp(-16, 60), tS = uvp(-16, -60), tC = uvp(-28, 4), hub = uvp(-48, 0);
      for (const t of [tN, tS, tC]) all(L.towns, t);
      duelKit(-56, 0);
      [[-36, 30, 5.5], [-34, -30, 5.5], [-10, 4, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
      [[-26, 46], [-26, -46], [-20, -12]].forEach(o => all(L.wells, uvp(o[0], o[1])));
      R(hub, tN, 3); R(hub, tS, 3); R(hub, tC, 2); R(tN, mirror(tS), 2.5); R(tC, [CX, CY], 1);
    } else if (kind === 'ponds') {
      quad(); L.lake = true;
      const { C, E, tOut } = ring(polar(52, 67.5), true);
      all(L.ore, polar(30, 67.5), [5]); all(L.ore, polar(78, 62), [5]);
      all(L.wells, polar(70, 56)); all(L.wells, polar(72, 77));
      // Ponds wherever they leave the bases, towns, ore, wells and roads clear, a dozen to a quarter, the same
      // in every quarter. Their places are fixed; only the land round them changes with the seed.
      const rnd = mulberry(917), ponds = [], tIn = polar(52, 67.5);
      const clear = [[...C, 32], [...tOut, 14], [...tIn, 14], ...L.ore.map(o => [o[0], o[1], o[2] + 5]), ...L.wells.map(w => [w[0], w[1], 7])];
      const segs = [[C, tOut], [tOut, E], [E, turnK(C, 1)], [tOut, tIn], [tIn, turnK(tIn, 1)]].flatMap(([a, b]) => L.syms.map(T => [T(a), T(b)]));
      const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1); return mhypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
      for (let tries = 0; tries < 600 && ponds.length < 12; tries++) {
        const p = [CX + 4 + rnd() * (W / 2 - 10), CY + 4 + rnd() * (H / 2 - 10)], r = 2.5 + rnd() * 3.5;
        const imgs = L.syms.map(T => T(p));
        if (imgs.some(q => clear.some(c => mhypot(q[0] - c[0], q[1] - c[1]) < c[2] + r + 6))) continue;
        if (imgs.some(q => segs.some(([a, b]) => segD(q, a, b) < r + 10))) continue;
        if (imgs.some(q => ponds.some(o => mhypot(q[0] - o[0], q[1] - o[1]) < r + o[2] + 12))) continue;
        for (const q of imgs) ponds.push([q[0], q[1], r]);
      }
      L.river = pools(ponds);
      // Shoals in the water by each base, where the boats from its dock fish.
      L.fish = []; all(L.fish, [180, 121]); all(L.fish, [77, 7]); all(L.fish, [116, 44]);
    } else if (kind === 'seas') {
      // Land between two seas, its coasts wandering, each base nearer the one.
      duel(); L.lake = true;
      L.river = (x, y) => { const [u, v] = toUV(x, y); return [Math.max(0, 42 + 3 * mcos(u * 0.07) + 3 * Math.sign(v) * msin(u * 0.05) - Math.abs(v)), 3]; };
      L.bases.push(uvp(-50, 6), mirror(uvp(-50, 6)));
      const tN = uvp(-22, 20), tS = uvp(-26, -18), tC = uvp(-6, 4), hub = uvp(-42, 4);
      for (const t of [tN, tS, tC]) all(L.towns, t);
      all(L.ore, uvp(-40, 18), [6.5]); all(L.ore, uvp(-42, -12), [6.5]);
      all(L.wells, uvp(-58, 18)); all(L.wells, uvp(-58, -8));
      [[-28, 2, 5.5], [-12, -16, 5], [-10, 22, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
      [[-34, -24], [-16, 12]].forEach(o => all(L.wells, uvp(o[0], o[1])));
      L.fish = []; [[-12, 56], [18, 52], [0, 66]].forEach(o => all(L.fish, uvp(o[0], o[1])));
      R(hub, tN, 2.5); R(hub, tS, 2.5); R(hub, tC, 2); R(tN, mirror(tS), 3); R(tC, [CX, CY], 1);
    } else if (kind === 'isles') {
      // A great island in the middle and one at each corner, with a small one on each border, all in open sea.
      // Long bridges join each corner to the middle and to the small islands either side of it.
      quad(); L.lake = true;
      const C = polar(110, 45), T90 = polar(100, 90), T0 = polar(100, 0), O = [CX, CY];
      const rC = 30, rT = 13, rO = 28, pad = 6;
      const isl = [[...O, rO + pad]];
      for (const T of L.syms) { const c = T(C), t = T(T90); isl.push([c[0], c[1], rC + pad], [t[0], t[1], rT + pad]); }
      L.river = isles(isl);
      for (const T of L.syms) L.bases.push(T(C));
      const tO = polar(22, 67.5);
      all(L.towns, T90); all(L.towns, tO);
      quadKit(C); all(L.ore, polar(16, 22.5), [4.5]); all(L.ore, polar(28, 0), [4]);
      all(L.wells, polar(14, 30));
      L.fish = []; all(L.fish, polar(70, 70)); all(L.fish, polar(62, 22));
      // Each bridge runs between two islands, its ends four cells in from either shore.
      const span = (P, rp, Q, rq) => {
        const d = mhypot(Q[0] - P[0], Q[1] - P[1]), u = [(Q[0] - P[0]) / d, (Q[1] - P[1]) / d];
        const a = [P[0] + u[0] * (rp - 4), P[1] + u[1] * (rp - 4)], b = [Q[0] - u[0] * (rq - 4), Q[1] - u[1] * (rq - 4)];
        for (const T of L.syms) L.bridges.push([T(a), T(b)]);
        R(a, b, 0);
        return [a, b];
      };
      const [a1, b1] = span(C, rC, T90, rT), [a2, b2] = span(C, rC, T0, rT), [a3, b3] = span(C, rC, O, rO);
      R(C, a1, 1); R(C, a2, 1); R(C, a3, 1); R(b1, T90, 0.5); R(b3, tO, 1); R(tO, turnK(tO, 1), 2);
      R(b2, polar(100, 0), 0.5);
    } else if (kind === 'highlands') {
      // A plateau in the middle with a ramp up from each corner, and ridges out along the borders, each broken
      // by a pass.
      quad(); L.river = dry;
      const rp = 38 * sc, ramps = [45, 135, 225, 315].map(a => a * PI / 180);
      L.wall = (x, y) => {
        const dx = x - CX, dy = y - CY, r = mhypot(dx, dy), a = matan2(dy, dx);
        let da = 9;
        for (const q of ramps) { let e = Math.abs(a - q) % TAU; if (e > PI) e = TAU - e; da = Math.min(da, e); }
        const w = lerp(16, 5, smooth(0.14, 0.3, da)), top = 3.6 * (1 - smooth(rp - w / 2, rp + w / 2, r));
        const db = Math.min(Math.abs(dx), Math.abs(dy)), along = Math.max(Math.abs(dx), Math.abs(dy));
        const gap = 1 - smooth(86 * sc, 91 * sc, along) * (1 - smooth(104 * sc, 109 * sc, along));
        // A sharp crest that rises and falls along its length, so it reads as rock and not a raised road.
        const crest = 1 + 0.22 * msin(along * 0.31) + 0.14 * msin(along * 0.83 + 1);
        const ridge = 7 * crest * (1 - smooth(0.5, 6, db)) * smooth(42 * sc, 52 * sc, along) * gap;
        return Math.max(top, ridge);
      };
      const C = polar(120, 45), tOut = polar(100, 62), tIn = polar(24, 67.5), P90 = polar(97, 90), Q = polar(100, 22.5);
      for (const T of L.syms) L.bases.push(T(C));
      all(L.towns, tOut); all(L.towns, tIn);
      quadKit(C); all(L.ore, polar(98, 78), [5]); all(L.ore, polar(30, 22.5), [5]);
      all(L.wells, polar(70, 56)); all(L.wells, polar(74, 30));
      R(C, tOut, 2); R(tOut, P90, 2); R(turnK(P90, 3), Q, 2); R(Q, C, 2);
      R(C, polar(36, 45), 1); R(polar(36, 45), tIn, 1); R(tIn, turnK(tIn, 1), 2);
    } else if (kind === 'rivers3') {
      // Three rivers across the line between the bases, the middle one its own mirror image and the outer two
      // each other's.
      duel();
      // Shoals in the water by each base, where the boats from its dock fish.
      L.fish = []; all(L.fish, [35, 52]); all(L.fish, [84, 7]); all(L.fish, [106, 22]);
      const off = [-26, 0, 26], course = (u0, v) => u0 + (u0 ? 0.6 : 1) * riverU(v);
      L.river = (x, y) => {
        const [u, v] = toUV(x, y);
        let d = 1e9;
        for (const u0 of off) d = Math.min(d, Math.abs(u - course(u0, v)));
        return [d, 2 + 0.6 * mcos(v * 0.09)];
      };
      L.bases.push(uvp(-62, 0), mirror(uvp(-62, 0)));
      duelKit(-62, 0);
      const tA = uvp(-44, 36), tB = uvp(-13, -26), tC = uvp(-13, 30), hub = uvp(-54, 0);
      for (const t of [tA, tB, tC]) all(L.towns, t);
      [[-44, -32, 5.5], [-12, 2, 5], [-40, 52, 4.5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
      [[-36, 16], [-14, -44]].forEach(o => all(L.wells, uvp(o[0], o[1])));
      // Bridges: the middle river at the middle and either flank, the near outer river at two places, with a
      // ford between them.
      const across = (u0, v, half) => { const c = course(u0, v); return [uvp(c - half, v), uvp(c + half, v)]; };
      const keep = new Set();
      const bridge = (u0, v) => {
        const [a, b] = across(u0, v, 8.5);
        const k = Math.round(a[0] + b[0]) + ',' + Math.round(a[1] + b[1]);
        if (!keep.has(k)) { keep.add(k); L.bridges.push([a, b]); L.bridges.push([mirror(a), mirror(b)]); }
        R(a, b, 0, !(u0 === 0 && v === 0));
        return [a, b];
      };
      const [m0a] = bridge(0, 0), [m1a] = bridge(0, 40), [m2a] = bridge(0, -40);
      const [o1a, o1b] = bridge(-26, 22), [o2a, o2b] = bridge(-26, -30);
      fordAt(uvp(course(-26, -4), -4), uvp(course(-26, -3), -3));
      R(hub, tA, 2); R(tA, o1a, 2); R(o1b, tC, 1.5); R(tC, m1a, 1.5);
      R(hub, o2a, 2.5); R(o2b, tB, 1.5); R(tB, m2a, 1.5); R(tB, m0a, 2); R(tC, m0a, 2);
    } else if (kind === 'crater') {
      // A lake inside a ring of mountains, with a gap in the ring toward each corner.
      quad(); L.lake = true;
      L.river = pools([[CX, CY, 18]]);
      const rr = 50, gaps = [45, 135, 225, 315].map(a => a * PI / 180);
      L.wall = (x, y) => {
        const dx = x - CX, dy = y - CY, r = mhypot(dx, dy), a = matan2(dy, dx);
        let da = 9;
        for (const q of gaps) { let e = Math.abs(a - q) % TAU; if (e > PI) e = TAU - e; da = Math.min(da, e); }
        return 6.5 * (1 - smooth(3, 7.5, Math.abs(r - rr))) * smooth(0.14, 0.24, da);
      };
      const tIn = polar(48, 67.5);
      ring(tIn, false);
      all(L.ore, polar(50, 22.5), [4.5]); all(L.ore, polar(84, 64), [5]);
      all(L.wells, polar(82, 56)); all(L.wells, polar(86, 78)); all(L.wells, polar(46, 0));
      L.fish = []; all(L.fish, polar(10, 22.5));
      const gapIn = polar(52, 45), gapOut = polar(84, 45);
      R(polar(120, 45), gapOut, 1.5); R(gapOut, gapIn, 0.5); R(gapIn, tIn, 1.5); R(tIn, polar(50, 112.5), 2); R(polar(50, 112.5), turnK(tIn, 1), 2);
    } else if (kind === 'summit') {
      // One great mountain between the bases, after Everest, its top far above the land. A knife-edge ridge runs down
      // to each base and to each flank, its crest wide enough for men and too steep for wheels, and the faces between
      // the ridges are too steep for anything. Each base's ridge has a camp on a shelf partway up, and the camps and
      // the summit are the map's high points. Roads run round the mountain's foot to towns in the valleys.
      duel(); L.river = dry;
      // The summit's height and the radius of its flat top, how steeply a crest and a face fall a cell, the skirt's
      // height, and how far the camps stand from the top.
      const TOP = 22, CAP = 2.5, CREST = 0.86, FACE = 1.9, SKIRT = 7, CAMP = 18;
      // A crest's height t past the top's edge: an even fall, broken on a base's ridge by the camp's shelf.
      const crest = (t, shelf) => {
        if (!shelf) return TOP - CREST * t;
        const a = CAMP - CAP - 2.5;
        return TOP - CREST * Math.min(t, a) - 0.1 * clamp(t - a, 0, 5) - CREST * Math.max(0, t - a - 5);
      };
      // A crest is flat for a few cells either side of its line and its sides fall away, both wider as it comes down.
      const side = (k, t) => 1 - smooth(2 + 0.08 * t, 5 + 0.2 * t, k);
      // The base ridges wander, and the flank ridges lean toward the bases and wander, by sines of odd turn, so the
      // map stays the same under its half turn.
      const vBase = u => 2.5 * msin(0.09 * u) + 1.2 * msin(0.21 * u), uFlank = v => 0.15 * v + 2.5 * msin(0.08 * v) + 1.4 * msin(0.19 * v);
      L.wall = (x, y, sym) => {
        const [u, v] = toUV(x, y), d = mhypot(u, v), t = Math.max(0, d - CAP);
        // The faces drop sheer from the summit, rough with gullies, to a skirt that slopes gently out to the plain.
        const rough = sym ? (sym(x, y, 0.16, 3) - 0.5) * 2.4 * smooth(2, 6, t) * (1 - smooth(14, 22, t)) : 0;
        const face = Math.max(TOP - FACE * t + rough, SKIRT * (1 - smooth(6, 32, t)));
        const base = face + Math.max(0, crest(t, true) - face) * side(Math.abs(v - vBase(u)), t);
        const flank = face + Math.max(0, crest(t, false) - face) * side(Math.abs(u - uFlank(v)), t);
        return Math.max(0, base, flank) + 1.6 * (1 - smooth(30, 44, d));
      };
      // The land's own relief is calmed on the mountain, and no benches are cut in it, so its ridges are its ways up.
      L.calm = (x, y) => { const [u, v] = toUV(x, y); return smooth(30, 42, mhypot(u, v)); };
      L.noBench = (x, y) => { const [u, v] = toUV(x, y); return 1 - smooth(34, 40, mhypot(u, v)); };
      L.highs = [[CX, CY], uvp(-CAMP, vBase(-CAMP)), mirror(uvp(-CAMP, vBase(-CAMP)))];
      L.bases.push(uvp(-56, 0), mirror(uvp(-56, 0)));
      const tN = uvp(-14, 52), tS = uvp(-14, -52), tC = uvp(-36, 0), hub = uvp(-48, 0);
      for (const t of [tN, tS, tC]) all(L.towns, t);
      duelKit(-56, 0);
      [[-34, 30, 5.5], [-34, -30, 5.5], [0, 46, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
      [[-26, 46], [-26, -46], [-44, -14]].forEach(o => all(L.wells, uvp(o[0], o[1])));
      R(hub, tN, 3); R(hub, tS, 3); R(hub, tC, 2); R(tN, mirror(tS), 2.5);
    } else if (kind === 'mesa') {
      // Open desert between two bases: long dune ridges on the flanks and sheer-sided, flat-topped mesas that wall
      // off the ways across, the roads winding between them.
      duel(); L.river = dry;
      L.bases.push(uvp(-54, 0), mirror(uvp(-54, 0)));
      const tN = uvp(-22, 36), tS = uvp(-24, -38), tC = uvp(-10, 6), hub = uvp(-46, 0);
      for (const t of [tN, tS, tC]) all(L.towns, t);
      duelKit(-54, 0);
      [[-34, 22, 5.5], [-32, -24, 5.5], [-6, -14, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
      [[-24, 50], [-26, -52], [-16, -4]].forEach(o => all(L.wells, uvp(o[0], o[1])));
      R(hub, tN, 2.5); R(hub, tS, 2.5); R(hub, tC, 2); R(tN, mirror(tS), 3); R(tC, [CX, CY], 1);
      // The mesas, each a middle, a radius, a height and a turn of its ragged rim. They are laid in one half, and
      // the other half is read from its image there, so the map stays exactly the same under its half turn. Each
      // stands wherever a whole one fits on the map clear of what must stay open, tried in a fixed shuffled order.
      let mesas = null;
      const layMesas = () => {
        const order = mulberry(4242), cand = [];
        for (let u = -70; u <= -6; u += 4) for (let v = -84; v <= 84; v += 4) cand.push([u, v, order()]);
        cand.sort((p, q) => p[2] - q[2]);
        const R0 = [7, 6, 6.5, 5, 5.5, 6, 5], H0 = [5.2, 4.6, 5.6, 4.2, 4.8, 5, 4.4];
        mesas = [];
        for (const [u, v] of cand) {
          if (mesas.length >= R0.length) break;
          const r = R0[mesas.length], [x, y] = uvp(u, v);
          if (x < r + 5 || y < r + 5 || x > W - r - 5 || y > H - r - 5) continue;
          let ok = clearK(x, y) >= 1;
          for (let a = 0; ok && a < TAU; a += 0.5) ok = clearK(x + mcos(a) * (r + 3), y + msin(a) * (r + 3)) >= 0.95;
          if (!ok || mesas.some(m => mhypot(m[0] - x, m[1] - y) < m[2] + r + 10) || mhypot(x - W + x, y - H + y) < 2 * r + 10) continue;
          mesas.push([x, y, r, H0[mesas.length], mesas.length * 1.7]);
        }
      };
      L.wall = (x0, y0) => {
        const [u0, v0] = toUV(x0, y0), [x, y] = u0 > 0 || (u0 === 0 && v0 > 0) ? mirror([x0, y0]) : [x0, y0];
        if (!mesas) layMesas();
        const k = clearK(x, y);
        if (k <= 0) return 0;
        let top = 0;
        for (const [mx, my, r, hm, t] of mesas) {
          const dx = x - mx, dy = y - my, d = mhypot(dx, dy);
          if (d > r * 1.6 + 6) continue;
          const a = matan2(dy, dx), rr = r * (1 + 0.16 * msin(3 * a + t) + 0.08 * msin(7 * a + t * 2));
          // A flat top, a sheer face and a skirt of fallen rock below it.
          top = Math.max(top, hm * (1 - smooth(rr - 0.8, rr + 0.8, d)) + 1.1 * (1 - smooth(rr, rr + 5, d)));
        }
        // Dunes in long ridges on the flanks, their crests swinging a little, the same under the map's half turn.
        const [u, v] = toUV(x, y), f = 0.5 * (0.8 * u + 0.6 * v) + 0.8 * msin(0.11 * (u - v));
        const c = 0.5 + 0.5 * mcos(f), dune = 1.1 * c * c * smooth(18, 32, Math.abs(v));
        return Math.max(top, dune) * k;
      };
    } else if (kind === 'falls') {
      // The Falls: a broad river down the middle that drops over a horseshoe fall on either side of a wooded island
      // into a deep gorge. Above the falls the calm upper river is crossed by a bridge and a ford, and the island
      // by a bridge from each bank; below them the gorge's sheer walls are crossed only by a high bridge, and a ramp
      // cut down each wall reaches a landing on the gorge's water. The two banks are each other's reflection across
      // the river, so the falls stand the same to both sides. The gorge's water lies FALLS_DROP under the river's.
      // Laid square to the map, the river running down it and the banks mirrored across it, so a building's footprint
      // is the same on either bank. u is across the river, v along it, upstream positive.
      const fp = (u, v) => [CX + u, CY - v], fuv = (x, y) => [x - CX, CY - y], reflect = ([x, y]) => [W - x, y];
      L.syms = [p => [p[0], p[1]], reflect];
      L.domain = (x, y) => x + 0.5 < CX;
      const vF = 6, UW = 12, IW = 5, IC = 15, IL = 9, low = water0 => water0 - FALLS_DROP;
      // The lip of each fall bows upstream in the middle of its channel, as a horseshoe; the island's tip is a cliff.
      const sq = q => q * q, lipV = au => au >= IW && au <= UW + 0.5 ? vF + 2.5 * Math.max(0, 1 - sq((au - 8.5) / 3.5)) : vF;
      const gW = v => lerp(12.5, 4.5, smooth(vF - 6, vF - 26, v));
      const isleW = v => Math.abs(v - IC) < IL ? IW * Math.sqrt(1 - sq((v - IC) / IL)) : 0;
      L.river = (x, y) => { const [u, v] = fuv(x, y), au = Math.abs(u); return v >= lipV(au) - 0.5 ? [au, UW] : [au, gW(v)]; };
      L.low = (x, y) => { const [u, v] = fuv(x, y), au = Math.abs(u); return v < lipV(au) && au < gW(v) + 14 ? 1 : 0; };
      L.carve = (x, y, z, z0, water0) => {
        const [u, v] = fuv(x, y), au = Math.abs(u), lip = lipV(au);
        if (v >= lip) {
          // The island, and the sill at each fall's lip, just clear of the water, which nothing crosses.
          const iw = isleW(v);
          if (iw > 0 && au < iw + 2) z = Math.max(z, lerp(1.6, -1.3, smooth(iw - 1.5, iw + 1, au)));
          if (au <= UW + 0.5 && au >= iw && v < lip + 1.1) z = water0 + 0.02;
          return z;
        }
        const g = gW(v), top = Math.max(z0, 2.6);
        // A ramp down each wall to a landing just over the gorge's water.
        if (v < -38 && v > -64 && au > g - 1 && au < g + 6.5) {
          const shelf = low(water0) + 0.45, rz = lerp(top, shelf, clamp((-40 - v) / 14, 0, 1)), end = smooth(-62, -59, v);
          if (au < g + 0.3) return lerp(-6, lerp(top, rz, end), smooth(g - 0.8, g + 0.3, au));
          if (au < g + 4.3) return lerp(top, rz, end);
          return lerp(lerp(top, rz, end), top, smooth(g + 4.3, g + 5.5, au));
        }
        if (au < g + 1.4) return lerp(-6, top, smooth(g - 0.8, g + 1.4, au));
        if (au < g + 8) return Math.max(z, lerp(top, z0, smooth(g + 1.4, g + 8, au)));
        return z;
      };
      // Each fall's lip, as a line across its channel, and the way downstream, for the picture.
      const down = [0, 1];
      L.cascades = [-1, 1].map(sd => ({ pts: Array.from({ length: 15 }, (_, k) => { const au = IW + (UW + 0.5 - IW) * k / 14; return fp(sd * au, lipV(au)); }), dx: down[0], dy: down[1] }));
      L.bases.push(fp(-50, 0), reflect(fp(-50, 0)));
      const tU = fp(-30, 36), tG = fp(-30, -34), tI = fp(0, IC), hub = fp(-42, 0);
      all(L.towns, tU); all(L.towns, tG); L.towns.push(tI);
      all(L.ore, fp(-44, 18), [7]); all(L.ore, fp(-43, -19), [6.5]); all(L.wells, fp(-55, -16)); all(L.wells, fp(-55, 16));
      all(L.ore, fp(-26, 18), [5.5]); all(L.ore, fp(-27, -18), [5.5]);
      all(L.wells, fp(-20, 26)); all(L.wells, fp(-20, -24));
      // The bridges: one to the island from each bank, one over the upper river, and the high one over the gorge.
      const iA = fp(-17, IC), iB = fp(-3.5, IC), uA = fp(-17, 40), uB = fp(17, 40), gA = fp(-10, -36), gB = fp(10, -36);
      L.bridges.push([iA, iB], [reflect(iA), reflect(iB)], [uA, uB], [gA, gB, 3.0]);
      R(iA, iB, 0); R(iB, tI, 0); R(uA, uB, 0, false); R(gA, gB, 0, false);
      fordAt(fp(0, 56), fp(0, 57));
      R(hub, tU, 2.5); R(hub, tG, 2.5); R(tU, iA, 1.5); R(tU, uA, 1.5); R(tU, fp(-15, 56), 2); R(tG, gA, 1.5);
      R(tG, fp(-6.8, -40), 1); R(fp(-6.8, -40), fp(-6.8, -56), 0);
      // Shoals above the falls and in the gorge, so each reach has its fishing.
      L.fish = []; all(L.fish, fp(-6, 30)); L.fish.push(fp(0, -52));
    } else if (kind === 'nile') {
      // The Nile between two bases: a broad river crossed by three long bridges, a green strip of fields and palm
      // groves along its banks, and on the sand beyond, pyramids, a temple and its obelisks.
      duel();
      const course = v => riverU(v) * 0.8, wide = v => 4.2 + 0.8 * mcos(v * 0.09);
      L.river = (x, y) => { const [u, v] = toUV(x, y); return [Math.abs(u - course(v)), wide(v)]; };
      // Shoals in the water by each base, where the boats from its dock fish.
      L.fish = []; all(L.fish, [52, 70]);
      // Palms stand only in the green strip along the banks.
      L.grove = (x, y) => { const [d, w] = L.river(x, y); return smooth(w + 6, w + 8, d) * (1 - smooth(w + 13, w + 16, d)); };
      L.bases.push(uvp(-60, 0), mirror(uvp(-60, 0)));
      const tN = uvp(-22, 34), tS = uvp(-24, -36), tC = uvp(-28, 4), hub = uvp(-52, 0);
      for (const t of [tN, tS, tC]) all(L.towns, t);
      duelKit(-60, 0);
      [[-40, 26, 6], [-38, -26, 5.5], [-17, -12, 5]].forEach(o => all(L.ore, uvp(o[0], o[1]), [o[2]]));
      [[-40, 8], [-30, 20]].forEach(o => all(L.wells, uvp(o[0], o[1])));
      R(hub, tN, 2.5); R(hub, tS, 2.5); R(hub, tC, 2);
      for (const v of [0, 40, -40]) {
        const u0 = course(v), a = uvp(u0 - 13, v), b = uvp(u0 + 13, v);
        L.bridges.push([a, b]); if (v) L.bridges.push([mirror(a), mirror(b)]);
        R(a, b, 0, false); if (v) R(mirror(a), mirror(b), 0, false);
      }
      R(tC, uvp(course(0) - 13, 0), 1.5); R(tN, uvp(course(40) - 13, 40), 1.5); R(tS, uvp(course(-40) - 13, -40), 1.5);
      // The monuments, each a kind, a middle, a half size and a turn, laid where each fits clear of the roads, towns,
      // bases, ore and wells, in one half and copied by the half turn. Three pyramids out on the sand; a temple near
      // the green strip, facing the river, with two obelisks before its gate.
      const dry = (x, y) => { const [d, w] = L.river(x, y); return d > w + 10; };
      const fits = (x, y, r) => { if (x < r + 4 || y < r + 4 || x > W - r - 4 || y > H - r - 4 || mhypot(2 * x - W, 2 * y - H) < 2 * r + 12 || !dry(x, y)) return false; for (let a = 0; a < TAU; a += 0.5) if (clearK(x + mcos(a) * r, y + msin(a) * r, 0.55) < 0.98 || !dry(x + mcos(a) * r, y + msin(a) * r)) return false; return clearK(x, y, 0.55) >= 1; };
      // Sites over the half, tried in the order given by a score, the best that fits taken.
      const site = (r, score, ok) => {
        const cand = [];
        for (let u = -84; u <= -10; u += 2) for (let v = -84; v <= 84; v += 2) cand.push([u, v, score(u, v)]);
        cand.sort((p, q) => q[2] - p[2] || p[0] - q[0] || p[1] - q[1]);
        for (const [u, v] of cand) { const [x, y] = uvp(u, v); if (fits(x, y, r) && ok(x, y)) return [x, y, u, v]; }
        return null;
      };
      // The pyramids as far out on the sand from the river as they fit; the temple as near the green strip.
      const mons = [], P = site(7, (u, v) => Math.abs(u - course(v)), () => true);
      if (P) [[-1.5, -1, 3], [3.6, 2.6, 1.9], [-3, 4.2, 1.4]].forEach(([du, dv, r]) => mons.push(['pyramid', ...uvp(P[2] + du, P[3] + dv), r, 0.785]));
      const T = site(6, (u, v) => -Math.abs(Math.abs(u - course(v)) - 26), (x, y) => !P || mhypot(x - P[0], y - P[1]) > 24);
      if (T) {
        const [tx, ty] = uvp(T[2], T[3]), [rx, ry] = uvp(T[2] + 6, T[3]), a = matan2(ry - ty, rx - tx);
        mons.push(['temple', tx, ty, 2.6, a]);
        for (const s of [-1, 1]) { const [ox, oy] = uvp(T[2] + 4.5, T[3] + s * 1.6); mons.push(['obelisk', ox, oy, 0.4, a]); }
      }
      L.monuments = mons.flatMap(m => { const q = mirror([m[1], m[2]]); return [m, [m[0], q[0], q[1], m[3], m[4] + PI]]; });
    } else if (kind === 'atlantis') {
      // Atlantis: a citadel island in the middle, then rings of water and land, the outer land the island's own,
      // its coast round the bases. Canals run in from the sea along the borders between the quarters to the outer
      // ring of water. Bridges cross each ring and each canal. Radii are in cells; a shore falls about four and a
      // half cells inside each land's nominal edge.
      quad(); L.lake = true;
      const pc = (r, deg) => [CX + r * mcos(deg * PI / 180), CY + r * msin(deg * PI / 180)];
      const RC = 22, RM0 = 28, RM1 = 56, RO0 = 62, RE = 114, CW = 1;
      L.river = (x, y) => {
        const dx = x - CX, dy = y - CY, r = mhypot(dx, dy), ax = Math.min(Math.abs(dx), Math.abs(dy));
        const citadel = RC - r, middle = Math.min(r - RM0, RM1 - r), outer = Math.min(r - RO0, RE - r, ax - CW);
        return [Math.max(0, citadel, middle, outer), 3];
      };
      const C = pc(90, 45), tOut = pc(86, 18), tMid = pc(42, 45);
      for (const T of L.syms) L.bases.push(T(C));
      all(L.towns, tOut); all(L.towns, tMid);
      quadKit(C);
      all(L.ore, pc(43, 16), [4.5]); all(L.ore, pc(84, 72), [5]);
      all(L.wells, pc(40, 74)); all(L.wells, pc(72, 30));
      L.fish = []; all(L.fish, pc(25, 20)); all(L.fish, pc(59, 45)); all(L.fish, pc(122, 45));
      // Each bridge from land to land, its ends four cells in from either shore.
      const bridge = (a, b) => { for (const T of L.syms) L.bridges.push([T(a), T(b)]); R(a, b, 0); };
      bridge(pc(47.5, 22.5), pc(70.5, 22.5)); bridge(pc(47.5, 67.5), pc(70.5, 67.5));
      bridge(pc(36.5, 45), pc(13.5, 45));
      // Over the canal on this quarter's near border, its far end in the next quarter.
      bridge(pc(86, 7.5), pc(86, -7.5));
      R(C, tOut, 2); R(tOut, pc(86, 7.5), 1); R(C, pc(70.5, 67.5), 2); R(tOut, pc(70.5, 22.5), 2);
      R(pc(47.5, 22.5), tMid, 2); R(pc(47.5, 67.5), tMid, 2); R(tMid, pc(36.5, 45), 1);
      // The citadel at the middle, a great temple, once for all four quarters.
      L.monuments = [['temple', CX, CY, 6, PI / 4]];
    }
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
    if (L.monuments) L.monuments.forEach(m => open.push([m[1], m[2], m[3] + 2]));
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
      // A layout may calm the land's own relief where it raises its own, as on The Summit's mountain.
      const x = i / RES, y = j / RES, m = flatness(x, y) * (L.calm ? L.calm(x, y) : 1);
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
    // A layout's own walls of rock, as High Pass's ridge, raised over the ground. It may roughen them with the map's
    // noise, the same under its turns.
    if (L.wall) for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) h[j * VW + i] += L.wall(i / RES, j / RES, sym);
    // Mountains break into benches with sheer faces of rock between them, which nothing climbs, so a mountain is
    // climbed only by its ways up: spurs where the faces give out, picked by a noise the same under the map's turns,
    // and wherever a road goes. Each step is CLIFF_STEP high, its face a quarter of the rise.
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const c = j * VW + i, z = h[c], k = smooth(CLIFF_FROM, CLIFF_FROM + 1.5, z);
      if (k <= 0) continue;
      // A layout may keep the benches off ground whose ways up it lays itself.
      const x = i / RES, y = j / RES, way = smooth(0.42, 0.5, sym(x, y, 0.045, 2)) * smooth(4, 7, roadDist[c]) * (L.noBench ? 1 - L.noBench(x, y) : 1);
      if (way <= 0) continue;
      const t = (z - CLIFF_FROM) / CLIFF_STEP, f = t - Math.floor(t), terr = CLIFF_FROM + (Math.floor(t) + smooth(0.75, 0.98, f)) * CLIFF_STEP;
      h[c] = lerp(z, terr, k * way);
    }
    // How much of a ford a point is in: a strip across the river a few cells wide.
    const fordK = (x, y) => {
      let k = 0;
      for (const f of L.fords) {
        const dx = x - f[0], dy = y - f[1], a = Math.abs(dx * f[2] + dy * f[3]), b = Math.abs(dy * f[2] - dx * f[3]);
        if (a < 4.5 && b < 14) k = Math.max(k, smooth(4.5, 2.5, a));
      }
      return k;
    };
    // Where the coast's cliffs stand: the noise over its open stretches, cut so about a third of them rise. The noise
    // is averaged over the map's turns, which narrows it differently on each map, so the cut is taken from it.
    let cliffAt = 0;
    if (SEA_CLIFFS.has(kind)) {
      const vals = [];
      for (let j = 0; j < VH; j += 2) for (let i = 0; i < VW; i += 2) {
        const x = i / RES, y = j / RES, [d, width] = L.river(x, y);
        if (d > width && d < width + 3 && flatness(x, y) * smooth(5, 9, roadDist[j * VW + i]) > 0.9) vals.push(sym(x, y, 0.035, 5));
      }
      vals.sort((a, b) => a - b);
      cliffAt = vals.length ? vals[Math.floor(vals.length * 0.66)] : 0;
    }
    const hLand = L.carve ? h.slice() : null;
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const x = i / RES, y = j / RES, c = j * VW + i, [d, width] = L.river(x, y);
      // Stretches of a sea coast stand as cliffs: the land rises to a low tableland that drops sheer into deep water.
      // None by a road, a base, a town or anything else kept open.
      const cliff = cliffAt && d < width + 16 ? smooth(cliffAt, cliffAt + 0.015, sym(x, y, 0.035, 5)) * flatness(x, y) * smooth(5, 9, roadDist[c]) : 0;
      if (d < width + 7) {
        // The bed, and at a ford a shallow one with gentle banks.
        const top = Math.min(h[c], 1.4), s = smooth(width - 1, width + 7, d), deep = lerp(-1.3, top, s), fk = fordK(x, y);
        h[c] = fk > 0 ? lerp(deep, lerp(-0.3, top, s), fk) : deep;
        if (cliff > 0) h[c] = lerp(h[c], lerp(-1.3, Math.max(top, 2.7), smooth(width + 0.4, width + 1.4, d)), cliff);
      } else if (cliff > 0) h[c] = lerp(h[c], Math.max(h[c], 2.7), cliff * (1 - smooth(width + 8, width + 16, d)));
    }
    // A layout's own shaping after the rivers, from the land as it was before them, as The Falls cuts its gorge.
    if (L.carve) for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) { const c = j * VW + i; h[c] = L.carve(i / RES, j / RES, h[c], hLand[c], water); }
    // The water's level at each point of the heights' grid where a layout has water lower than the rest, as The
    // Falls' gorge, or none, when all of it stands at the one level.
    const wl = L.low ? new Float32Array(VW * VH) : null;
    if (wl) for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) wl[j * VW + i] = water - FALLS_DROP * L.low(i / RES, j / RES);
    const wlv = c => wl ? wl[c] : water, wlAt = (x, y) => wl ? wl[clamp(Math.round(y * RES), 0, VH - 1) * VW + clamp(Math.round(x * RES), 0, VW - 1)] : water;

    // Brooks. Each rises on middling ground in one part of the map and winds down to the river, a lake or the
    // map's edge, or sinks into a pool, and is copied by the map's turns. It keeps clear of the bases, towns, ore and
    // wells. A brook is shallow: men wade it, slowly, and wheels and tracks cross only at its fords, or where a road
    // carries it in a culvert. Its dice are its own, so the rest of the map draws the same numbers as before.
    const brooks = [], brookFords = [], bD = new Float32Array(VW * VH).fill(99), bF = new Uint8Array(VW * VH), bZ = new Float32Array(VW * VH);
    const falls = [], fallAt = new Uint8Array(VW * VH);
    if (BROOKS[kind]) {
      const br = mulberry((seed * 2654435761 + 0x9e37) % 4294967296);
      const hv = (x, y) => h[clamp(Math.round(y * RES), 0, VH - 1) * VW + clamp(Math.round(x * RES), 0, VW - 1)];
      const rdv = (x, y) => roadDist[clamp(Math.round(y * RES), 0, VH - 1) * VW + clamp(Math.round(x * RES), 0, VW - 1)];
      // The ground a brook keeps off: a base's yard, a town's houses, an ore field and a well, each with a margin it
      // turns away from as it nears.
      const keepOff = [...L.bases.map(p => [p[0], p[1], 22]), ...L.towns.map(p => [p[0], p[1], 9]), ...L.ore.map(p => [p[0], p[1], p[2] + 2]), ...L.wells.map(p => [p[0], p[1], 4])];
      const clear = (x, y) => keepOff.every(o => mhypot(x - o[0], y - o[1]) > o[2]);
      // The brook's way from its spring: the cheapest walk over the cells to the river, a lake or the map's edge,
      // dear uphill and dearer along a road, barred from ground it keeps off and from bridges, and made to wind by
      // noise in the going. Past BROOK_REACH cells it gives up and sinks into a pool at the lowest ground it reached.
      // The walk is then rounded into curves and laid as points a step apart.
      const route = (sx, sy) => {
        const cost = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), heap = [];
        const push = (c, v) => { heap.push([v, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
        const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
        const c0 = (sy | 0) * W + (sx | 0);
        cost[c0] = 0; push(c0, 0);
        let end = -1, kind = 'pool', low = c0;
        while (heap.length) {
          const [v, c] = pop();
          if (v > cost[c]) continue;
          const x = c % W, y = c / W | 0, z = hv(x + 0.5, y + 0.5);
          if (c !== c0 && (z < wlAt(x + 0.5, y + 0.5) + 0.05 || x === 0 || y === 0 || x === W - 1 || y === H - 1)) { end = c; kind = z < wlAt(x + 0.5, y + 0.5) + 0.05 ? 'water' : 'edge'; break; }
          if (v > 12 && z < hv(low % W + 0.5, (low / W | 0) + 0.5)) low = c;
          if (v > BROOK_REACH) continue;
          for (const [dx, dy, len] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]]) {
            const X = x + dx, Y = y + dy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const px = X + 0.5, py = Y + 0.5;
            if (!clear(px, py) || L.bridges.some(([a, b]) => mhypot(px - (a[0] + b[0]) / 2, py - (a[1] + b[1]) / 2) < 9)) continue;
            const up = Math.max(0, hv(px, py) - z), wind = 0.55 + 0.9 * fbm(px * 0.11 + 91, py * 0.11 + 37, 2);
            const nv = v + len * wind + up * 9 + (rdv(px, py) < 2.6 ? 2.5 : 0), o = Y * W + X;
            if (nv < cost[o]) { cost[o] = nv; from[o] = c; push(o, nv); }
          }
        }
        if (end < 0) end = low;
        const cells = [];
        for (let c = end; c >= 0; c = from[c]) cells.unshift(c);
        let pts = cells.map(c => [c % W + 0.5, (c / W | 0) + 0.5]);
        for (let k = 0; k < 3; k++) {
          const q = [pts[0]];
          for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); }
          q.push(pts[pts.length - 1]); pts = q;
        }
        const out = [pts[0]];
        let acc = 0;
        for (let i = 1; i < pts.length; i++) { acc += mhypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc >= 0.8) { out.push(pts[i]); acc = 0; } }
        return { pts: out, end: kind };
      };
      // The deepest single fall a course would take, its bed laid as below.
      const fallDrop = pts => {
        let low = 1e9, best = 0, run = 0;
        const bed = pts.map(p => (low = Math.max(wlAt(p[0], p[1]) + 0.1, Math.min(low, hv(p[0], p[1]) - BED_D))));
        for (let i = 0; i + 1 < bed.length; i++) { const d = bed[i] - bed[i + 1]; run = d > FALL_STEP ? run + d : 0; best = Math.max(best, run); }
        return best;
      };
      // On the maps of cliffs and high ground a spring may rise higher, and of a few courses the one with the
      // greatest fall is taken, so their brooks come down the cliffs.
      const high = FALL_MAPS.has(kind), zTop = high ? 12 : 8;
      for (let k = 0; k < BROOKS[kind]; k++) {
        let pick = null;
        for (let tries = 0, seen = 0; tries < 500 && seen < (high ? 10 : 1); tries++) {
          // A spring well in from the map's edge and back from the water, so its brook has some way to run.
          const x = 18 + br() * (W - 36), y = 18 + br() * (H - 36), z = hv(x, y);
          if (!L.domain(x | 0, y | 0) || z < 1.2 || z > zTop || !clear(x, y) || rdv(x, y) < 6 || L.river(x, y)[0] < L.river(x, y)[1] + 14) continue;
          // Not along a brook already laid.
          if (bD[clamp(Math.round(y * RES), 0, VH - 1) * VW + clamp(Math.round(x * RES), 0, VW - 1)] < 12 || brooks.some(b => b.pts.some(p => mhypot(p[0] - x, p[1] - y) < 12))) continue;
          const t = route(x, y);
          if (t.pts.length < 22) continue;
          seen++;
          t.drop = high ? fallDrop(t.pts) : 0;
          if (!pick || t.drop > pick.drop) pick = t;
        }
        if (pick) {
          const t = pick;
          // A ford part way down, and a second on a long brook, each the nearest place to its mark that is clear of a
          // road, which has its culvert.
          const n = t.pts.length, offRoad = i => roadDist[clamp(Math.round(t.pts[i][1] * RES), 0, VH - 1) * VW + clamp(Math.round(t.pts[i][0] * RES), 0, VW - 1)] > 5;
          const fordNear = f => { for (let d = 0; d < n * 0.5; d++) for (const i of [Math.round(f * (n - 1)) + d, Math.round(f * (n - 1)) - d]) if (i > 2 && i < n - 3 && offRoad(i)) return i; return -1; };
          const fords = [...new Set((n > 55 ? [0.4, 0.8] : [0.5]).map(fordNear))].filter(i => i >= 0);
          for (const T of L.syms) {
            const pts = t.pts.map(T);
            brooks.push({ pts, end: t.end });
            for (const i of fords) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = mhypot(b[0] - a[0], b[1] - a[1]) || 1; brookFords.push([pts[i][0], pts[i][1], (b[0] - a[0]) / d, (b[1] - a[1]) / d]); }
          }
        }
      }
      // Each brook's bed follows the land down, a little under it, and never climbs: where the land rises across
      // its way it cuts through, and where the land drops steeply the bed drops with it in a waterfall. A fall is
      // a run of steep steps down that falls FALL_MIN at least, away from fords and roads.
      for (const b of brooks) {
        let low = 1e9;
        b.bed = b.pts.map(p => (low = Math.max(wlAt(p[0], p[1]) + 0.1, Math.min(low, hv(p[0], p[1]) - BED_D))));
        const steep = k => b.bed[k] - b.bed[k + 1] > FALL_STEP;
        for (let k = 0; k + 1 < b.pts.length; k++) {
          if (!steep(k)) continue;
          let j = k;
          while (j + 2 < b.pts.length && steep(j + 1)) j++;
          const [x0, y0] = b.pts[k], [x1, y1] = b.pts[j + 1], z0 = b.bed[k], z1 = b.bed[j + 1];
          const nearFord = brookFords.some(f => mhypot(f[0] - x0, f[1] - y0) < 3 || mhypot(f[0] - x1, f[1] - y1) < 3);
          if (z0 - z1 >= FALL_MIN && !nearFord && rdv(x0, y0) > 3 && rdv(x1, y1) > 3) falls.push({ x0, y0, z0, x1, y1, z1 });
          k = j;
        }
      }
      // The distance from each point of the land to the nearest brook, the bed there, and whether that stretch is a
      // ford.
      for (const b of brooks) for (let k = 0; k + 1 < b.pts.length; k++) {
        const [ax, ay] = b.pts[k], [bx, by] = b.pts[k + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6, Rr = 3;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - Rr) * RES)), i1 = Math.min(VW - 1, Math.ceil((Math.max(ax, bx) + Rr) * RES));
        const j0 = Math.max(0, Math.floor((Math.min(ay, by) - Rr) * RES)), j1 = Math.min(VH - 1, Math.ceil((Math.max(ay, by) + Rr) * RES));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const qx = i / RES - ax, qy = j / RES - ay, t = clamp((qx * dx + qy * dy) / L2, 0, 1), d = mhypot(qx - dx * t, qy - dy * t), c = j * VW + i;
          if (d >= bD[c]) continue;
          bD[c] = d; bZ[c] = lerp(b.bed[k], b.bed[k + 1], t);
          const px = ax + dx * t, py = ay + dy * t;
          bF[c] = brookFords.some(f => mhypot(px - f[0], py - f[1]) < 1.6) ? 1 : 0;
        }
      }
      // Its bed: a shallow dip in the land, its floor just clear of the rivers' water, as the brook's water is drawn
      // from its course and not from the land's height. A brook's last reach, where it sinks, ends in a pool.
      for (const b of brooks) if (b.end === 'pool') {
        const [ex, ey] = b.pts[b.pts.length - 1];
        for (let j = Math.max(0, Math.floor((ey - 3) * RES)); j <= Math.min(VH - 1, Math.ceil((ey + 3) * RES)); j++) for (let i = Math.max(0, Math.floor((ex - 3) * RES)); i <= Math.min(VW - 1, Math.ceil((ex + 3) * RES)); i++) {
          const c = j * VW + i, d = Math.max(0, mhypot(i / RES - ex, j / RES - ey) - 1.2);
          if (d < bD[c]) { bD[c] = d; bZ[c] = b.bed[b.bed.length - 1]; }
        }
      }
      for (let c = 0; c < h.length; c++) if (bD[c] < 3.2) h[c] = Math.min(h[c], lerp(bZ[c], h[c], smooth(0.3, 3.2, bD[c])));
      // The falls' own ground, which nothing crosses: the brook's width down each fall and a little past either end.
      for (const f of falls) {
        const dx = f.x1 - f.x0, dy = f.y1 - f.y0, L2 = dx * dx + dy * dy || 1e-6;
        for (let j = Math.max(0, Math.floor((Math.min(f.y0, f.y1) - 2) * RES)); j <= Math.min(VH - 1, Math.ceil((Math.max(f.y0, f.y1) + 2) * RES)); j++) for (let i = Math.max(0, Math.floor((Math.min(f.x0, f.x1) - 2) * RES)); i <= Math.min(VW - 1, Math.ceil((Math.max(f.x0, f.x1) + 2) * RES)); i++) {
          const qx = i / RES - f.x0, qy = j / RES - f.y0, t = (qx * dx + qy * dy) / L2, L = Math.sqrt(L2);
          if (t * L < -0.5 || t * L > L + 0.5) continue;
          const tc = clamp(t, 0, 1);
          if (mhypot(qx - dx * tc, qy - dy * tc) < 1.0) fallAt[j * VW + i] = 1;
        }
      }
    }

    // Decks over the water. Units walk at deck height, the terrain below stays as it was.
    const deck = new Float32Array(VW * VH), bridges = [];
    // A bridge's deck stands 0.8 over the water, or as high as its layout gives, as a high bridge over a gorge.
    const addBridge = (a, b, z = 0.8) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = mhypot(dx, dy), ux = dx / len, uy = dy / len, wide = 3;
      const br = { x0: a[0], y0: a[1], x1: b[0], y1: b[1], w: wide * 2, z, len, ux, uy, verts: [], cells: [], under: [] };
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
    for (const [a, b, z] of L.bridges) {
      const k = Math.round(a[0] + b[0]) + ',' + Math.round(a[1] + b[1]);
      if (keyB.has(k)) continue;
      keyB.add(k); addBridge(a, b, z);
    }
    // A road is never under water away from a bridge or a ford. Where its carriageway dips into the water, as a
    // shore road round a lake can, it is carried on a low causeway.
    for (let c = 0; c < h.length; c++) {
      if (roadDist[c] > 2.1 || deck[c] > 0 || h[c] >= wlv(c) + 0.25) continue;
      if (fordK((c % VW) / RES, (c / VW | 0) / RES) > 0) continue;
      h[c] = wlv(c) + 0.25;
    }

    // Towns, ore and wells.
    L.towns.forEach(p => towns.push({ x: p[0], y: p[1], owner: -1, cap: 0, capTeam: -1, r: 14 }));
    towns.forEach((t, i) => { t.id = i; });
    const oreCells = new Uint16Array(N), oreRich = new Uint8Array(N), oreKind = new Uint8Array(N), oreFields = [];
    const kinds = oreKindsFor(L);
    L.ore.forEach((p, i) => {
      const R = p[2], [kind, vein] = kinds[i], field = { x: p[0], y: p[1], r: R, kind, vein };
      oreFields.push(field);
      for (let y = Math.floor(p[1] - R - 2); y <= p[1] + R + 2; y++) for (let x = Math.floor(p[0] - R - 2); x <= p[0] + R + 2; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const d = mhypot(x + 0.5 - p[0], y + 0.5 - p[1]) + (sym(x + 0.5, y + 0.5, 0.3, 2) - 0.5) * 5;
        if (d >= R) continue;
        // A vein of the second kind winds through a mixed deposit, from noise shared by every side's copy of it.
        const k = vein >= 0 && Math.abs(sym(x + 0.5, y + 0.5, 0.8, 2) - 0.5) < VEIN ? vein : kind;
        oreCells[y * W + x] = Math.round((60 + 120 * (1 - d / R)) * ORE_KINDS[k].amount); oreKind[y * W + x] = k;
      }
    });
    L.wells.forEach(p => wells.push({ x: Math.round(p[0]), y: Math.round(p[1]) }));

    // Cells. Bit 1 stops vehicles, bit 2 stops infantry, bit 4 forbids building. Bit 8 is standing woods,
    // which stop wheels, slow infantry and fall under tracks. Bit 16 is a ford, slow going for everyone. Bits 32
    // and 64 hold how hard a track worn there has become, 0 to 3, set as the world goes on.
    const hAt = (x, y) => { const i = clamp(Math.round(x * RES), 0, VW - 1), j = clamp(Math.round(y * RES), 0, VH - 1); return h[j * VW + i]; };
    const deckAt = (x, y) => { const i = clamp(Math.round(x * RES), 0, VW - 1), j = clamp(Math.round(y * RES), 0, VH - 1); return deck[j * VW + i]; };
    const ground = new Uint8Array(N), fordCells = [], wadeCells = [];
    // A cell's bits from the land alone, as if no bridge stood over it.
    const landBits = (x, y) => {
      let hi = -99, lo = 99;
      for (let b = 0; b <= 2; b++) for (let a = 0; a <= 2; a++) {
        const z = hAt(x + a / 2, y + b / 2);
        hi = Math.max(hi, z); lo = Math.min(lo, z);
      }
      // A brook, by its cells' distance from its course: wading slows men and stops wheels, but for at its fords and
      // where a road carries it in a culvert.
      const bc = (y * RES + 1) * VW + x * RES + 1;
      if (fallAt[bc]) return 7;
      if (bD[bc] < 0.75 && roadDist[bc] > 1.6) return bF[bc] ? 4 | 16 : 1 | 4 | 16;
      if (lo < wlv(bc) + 0.1) return fordK(x + 0.5, y + 0.5) > 0.85 ? 4 | 16 : 7;
      const slope = hi - lo;
      // A road's carriageway is never too steep to use, however hard it climbs. It is only kept free of building.
      if (roadDist[clamp(Math.round((y + 0.5) * RES), 0, VH - 1) * VW + clamp(Math.round((x + 0.5) * RES), 0, VW - 1)] <= 1.2) return slope > 0.5 ? 4 : 0;
      let bits = 0;
      if (slope > 0.95) bits |= 1 | 4;
      if (slope > 1.4) bits |= 2;
      if (slope > 0.5) bits |= 4;
      return bits;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const bits = deckAt(x + 0.5, y + 0.5) > 0 ? 4 : landBits(x, y);
      ground[y * W + x] = bits;
      if ((bits & 17) === 17) wadeCells.push(y * W + x);
      else if (bits & 16) fordCells.push(y * W + x);
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
      // Clear of a river's middle, or of a lake's water and the bank round it.
      const [rd, rw] = L.river(x, y);
      if (L.lake ? rd < rw + 5 : rd < 6.5) return false;
      const c = clamp(Math.round(y * RES), 0, VH - 1) * VW + clamp(Math.round(x * RES), 0, VW - 1);
      return roadDist[c] > 3 && bD[c] > 1.8;
    };
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      if (!L.domain(x, y)) continue;
      const wk = WOODS[kind] || 0, wood = sym(x, y, wk ? 0.06 / (1 + 0.6 * wk) : 0.06, 3), r = rand();
      const place = (k, s) => {
        const px = x + 0.25 + rand() * 0.5, py = y + 0.25 + rand() * 0.5;
        // Woods thin out up the mountains and stop at the treeline. Each place draws its dice as before, so the
        // rest of the map is laid as it always was, and decides once for all its copies, so the map stays fair.
        if (k === 'tree' && hAt(px, py) > TREE_LINE + ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 1024 / 1024 * TREE_BAND - TREE_BAND / 2) {
          for (let i = 0; i < L.syms.length; i++) rand();
          return;
        }
        for (const T of L.syms) {
          const [qx, qy] = T([px, py]);
          scatter.push({ k, x: qx, y: qy, s, a: rand() * TAU });
          ground[clamp(qy | 0, 0, H - 1) * W + clamp(qx | 0, 0, W - 1)] |= k === 'tree' ? 4 | 8 : 7;
        }
      };
      if (!keep(x, y)) continue;
      const w0 = wk ? 0.58 - 0.07 * wk : 0.58;
      if (wood > w0 && r < (wk ? smooth(w0, w0 + 0.1, wood) * (0.5 + 0.35 * wk) : smooth(0.58, 0.68, wood) * 0.5) * (THIN[kind] || 1) * (L.grove ? L.grove(x + 0.5, y + 0.5) : 1)) place('tree', 0.7 + rand() * 0.7);
      else if (r < 0.006) place('rock', 0.5 + rand() * 0.9);
    }

    // A monument blocks the cells under it, and nothing is built there.
    if (L.monuments) for (const [, mx, my, r] of L.monuments) for (let y = Math.floor(my - r); y <= Math.ceil(my + r); y++) for (let x = Math.floor(mx - r); x <= Math.ceil(mx + r); x++) {
      if (x >= 0 && y >= 0 && x < W && y < H && mhypot(x + 0.5 - mx, y + 0.5 - my) < r + 0.3) ground[y * W + x] |= 7;
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
    // More houses further out, so a town is more than two or three, on dice of their own so the rest of the map
    // is laid as before. Each keeps a cell clear of the houses already standing, the roads, the water and the ore.
    const hr = mulberry((seed * 2654435761 + 0x4c1d) % 4294967296), taken = c => ground[c] & 7;
    for (let i = 0; i < towns.length; i += K) {
      const t = towns[i];
      let added = 0;
      for (let k = 0; k < 14 && added < 4; k++) {
        const a = hr() * TAU, d = 7.5 + hr() * 3, w = 2 + (hr() * 2 | 0), hh = 2 + (hr() * 2 | 0), floors = 1 + (hr() * 2 | 0), tone = hr();
        const hx = Math.round(t.x + mcos(a) * d), hy = Math.round(t.y + msin(a) * d), x0 = hx - (w >> 1), y0 = hy - (hh >> 1);
        let ok = true;
        L.syms.forEach(T => {
          const p = T([x0, y0]), q = T([x0 + w, y0 + hh]);
          const px = Math.round(Math.min(p[0], q[0])), py = Math.round(Math.min(p[1], q[1])), pw = Math.round(Math.abs(q[0] - p[0])), ph = Math.round(Math.abs(q[1] - p[1]));
          for (let cy = py - 1; cy <= py + ph && ok; cy++) for (let cx = px - 1; cx <= px + pw; cx++) {
            if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1) { ok = false; break; }
            const c = cy * W + cx, v = (cy * RES) * VW + cx * RES;
            if (taken(c) || oreCells[c] || roadDist[v] < 4.5 || hAt(cx + 0.5, cy + 0.5) < wlAt(cx + 0.5, cy + 0.5) + 0.4) { ok = false; break; }
          }
        });
        if (!ok) continue;
        // Laid, then taken up again if it shuts off a base, a town or a well, as the map's checks would find.
        const put = [], was = [];
        L.syms.forEach((T, s) => {
          const p = T([x0, y0]), q = T([x0 + w, y0 + hh]);
          const px = Math.round(Math.min(p[0], q[0])), py = Math.round(Math.min(p[1], q[1])), pw = Math.round(Math.abs(q[0] - p[0])), ph = Math.round(Math.abs(q[1] - p[1]));
          put.push({ x: px, y: py, w: pw, h: ph, floors, tone, town: i + s });
          for (let cy = py; cy < py + ph; cy++) for (let cx = px; cx < px + pw; cx++) { was.push(cy * W + cx, ground[cy * W + cx]); ground[cy * W + cx] |= 7; }
        });
        if (!reachable(ground, L, towns, wells)) { for (let j = was.length - 2; j >= 0; j -= 2) ground[was[j]] = was[j + 1]; continue; }
        added++;
        houses.push(...put);
      }
    }
    const faces = L.bases.map(b => matan2(CY - b[1], CX - b[0]));
    for (const s of scatter) s.c = clamp(s.y | 0, 0, H - 1) * W + clamp(s.x | 0, 0, W - 1);
    // Open water deep enough for a ship: every corner of the cell well under the surface. Bridges stand high
    // enough for ships to pass beneath. Shoals where fishing boats fish lie in it.
    const sea = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let hi = -99;
      for (let b = 0; b <= 2; b++) for (let a = 0; a <= 2; a++) hi = Math.max(hi, hAt(x + a / 2, y + b / 2) - wlAt(x + a / 2, y + b / 2));
      if (hi < -0.3) sea[y * W + x] = 1;
    }
    const fish = (L.fish || []).map(p => ({ x: p[0], y: p[1] }));
    let seaCells = 0;
    for (let c = 0; c < N; c++) seaCells += sea[c];
    return { W, H, seed, kind, h, deck, water, ground, ore: oreCells, oreKind, oreFields, wells, towns, roads, roadDist, bridges, scatter, houses, oreRich, bases: L.bases, faces, fords: L.fords, fordCells, wadeCells, brooks, brookFords, brookDist: bD, brookFord: bF, falls, wl, cascades: L.cascades || [], sea, fish, seaCells, monuments: (L.monuments || []).map(([k, x, y, r, a]) => ({ k, x, y, r, a })), highs: L.highs || null };
  }

  // A map is kept only if vehicles can get from the first base to every other base, town and well.
  // Whether every base, town and well can be reached on foot and wheel from the first base, over the ground bits.
  function reachable(ground, L, towns, wells) {
    const pass = c => !(ground[c] & 9), a = L.bases[0], seen = new Uint8Array(N), q = [Math.floor(a[1]) * W + Math.floor(a[0]) + 4];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop(), x = c % W, y = c / W | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!seen[n] && pass(n)) { seen[n] = 1; q.push(n); }
      }
    }
    return L.bases.every(b => seen[Math.floor(b[1]) * W + Math.floor(b[0]) + 4]) && towns.every(t => seen[Math.floor(t.y) * W + Math.floor(t.x)]) && wells.every(w => seen[w.y * W + w.x + 2]);
  }
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
  // The water's level at a point: the map's one level, or where a layout has water lower than the rest, as The
  // Falls' gorge, the level there.
  function waterLevel(M, x, y) {
    if (!M.wl) return M.water;
    const fx = clamp(x * RES, 0, VW - 1.001), fy = clamp(y * RES, 0, VH - 1.001), ix = fx | 0, iy = fy | 0, u = fx - ix, v = fy - iy, c = iy * VW + ix, w = M.wl;
    return lerp(lerp(w[c], w[c + 1], u), lerp(w[c + VW], w[c + VW + 1], u), v);
  }
  // Height a ground unit stands at, which is the deck on a bridge.
  function heightAt(M, x, y) {
    const d = M.deck[hIndex(x + 0.25, y + 0.25)];
    const t = terrainAt(M, x, y);
    return d > 0 ? Math.max(d, t) : t;
  }

  // Cover. Fixed points on the land a squad is sent to hold, after Rainbow Six's team orders: the kind of place
  // says what the team does there. Found once from the map and kept on it, each with the way it faces. A squad
  // stopped within COVER_R of one is in cover, and a shot from within COVER_ARC of its facing is softened.
  const COVER_R = 1.2, COVER_ARC = 1.2217304763960306, COVER_HC = 8;
  function coverPoints(M) {
    if (M.cover) return M.cover;
    const MW = M.W, MH = M.H, pts = [];
    const put = (x, y, kind, dir) => {
      if (!(x > 1 && y > 1 && x < MW - 1 && y < MH - 1)) return;
      // Never where a man cannot stand, such as inside the house or in the river.
      if (M.ground[(y | 0) * MW + (x | 0)] & 2) return;
      pts.push({ x, y, kind, dir });
    };
    // The corners of each house's yard, where a wall or fence gives cover on two sides.
    for (const h of M.houses) for (const [cx, cy, dx, dy] of [[h.x, h.y, -1, -1], [h.x + h.w, h.y, 1, -1], [h.x + h.w, h.y + h.h, 1, 1], [h.x, h.y + h.h, -1, 1]]) put(cx + dx * 1.6, cy + dy * 1.6, 'wall', matan2(dy, dx));
    // Both ends of every bridge, facing along it.
    for (const b of M.bridges) { put(b.x0 - b.ux * 2.2, b.y0 - b.uy * 2.2, 'bridge', matan2(b.uy, b.ux)); put(b.x1 + b.ux * 2.2, b.y1 + b.uy * 2.2, 'bridge', matan2(-b.uy, -b.ux)); }
    // Both banks of every ford, facing the water. The ford runs along the river, so its banks lie across it, and
    // a bank is pushed out until it is dry ground.
    for (const [fx, fy, dx, dy] of M.fords) for (const s of [1, -1]) {
      const nx = -dy * s, ny = dx * s;
      for (let d = 3.6; d <= 9; d += 0.5) {
        const x = fx + nx * d, y = fy + ny * d;
        if (M.ground[clamp(y | 0, 0, MH - 1) * MW + clamp(x | 0, 0, MW - 1)] & 18) continue;
        put(x, y, 'ford', matan2(-ny, -nx));
        break;
      }
    }
    // The edge of a wood: a tree with few neighbours, all to one side, kept a stride from the last, with the man
    // pushed clear of the trees and facing the open.
    const trees = M.scatter.filter(o => o.k === 'tree'), edge = [];
    for (const t of trees) {
      let n = 0, sx = 0, sy = 0;
      for (const u of trees) if (u !== t && mhypot(u.x - t.x, u.y - t.y) < 3.4) { n++; sx += u.x - t.x; sy += u.y - t.y; }
      if (n < 1 || n > 4 || edge.some(e => mhypot(e.x - t.x, e.y - t.y) < 3.5)) continue;
      const a = matan2(-sy, -sx);
      edge.push(t); put(t.x + mcos(a) * 1.4, t.y + msin(a) * 1.4, 'wood', a);
    }
    // Large rocks, with the man crouched on the far side and firing over the rock.
    for (const r of M.scatter) if (r.k === 'rock' && r.s > 0.9) put(r.x + 1.2, r.y + 1.0, 'rock', matan2(-1.0, -1.2));
    // Crests: a spot higher than all the ground within six strides by more than a man's height, and above the
    // water. It faces the steepest fall, where an attacker climbs from, and is cover from every side.
    for (let y = 4; y < MH - 4; y += 3) for (let x = 4; x < MW - 4; x += 3) {
      const h0 = terrainAt(M, x, y);
      let top = true, low = h0, lx = 1, ly = 0;
      for (let dy = -6; dy <= 6 && top; dy += 2) for (let dx = -6; dx <= 6; dx += 2) {
        if (!dx && !dy) continue;
        const h = terrainAt(M, x + dx, y + dy);
        if (h > h0) { top = false; break; }
        if (h < low) { low = h; lx = dx; ly = dy; }
      }
      if (top && h0 - low > 0.9 && h0 > M.water + 0.5) put(x, y, 'crest', matan2(ly, lx));
    }
    // Buckets of eight cells, as the units' own hash, so the point by a man is found without a scan.
    const HWc = Math.ceil(MW / COVER_HC), grid = new Array(HWc * HWc);
    pts.forEach((p, i) => { const k = clamp(p.y / COVER_HC | 0, 0, HWc - 1) * HWc + clamp(p.x / COVER_HC | 0, 0, HWc - 1); (grid[k] || (grid[k] = [])).push(i); });
    M.cover = pts; M.coverGrid = grid; M.coverHW = HWc;
    return pts;
  }
  // The nearest cover point within r of a spot, or -1. `skip` holds points already given out.
  function coverNear(M, x, y, r, skip) {
    const pts = coverPoints(M), grid = M.coverGrid, HWc = M.coverHW;
    const x0 = clamp((x - r) / COVER_HC | 0, 0, HWc - 1), x1 = clamp((x + r) / COVER_HC | 0, 0, HWc - 1);
    const y0 = clamp((y - r) / COVER_HC | 0, 0, HWc - 1), y1 = clamp((y + r) / COVER_HC | 0, 0, HWc - 1);
    let best = -1, bd = r;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const b = grid[j * HWc + i];
      if (!b) continue;
      for (const k of b) {
        if (skip && skip.has(k)) continue;
        const p = pts[k], d = mhypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = k; }
      }
    }
    return best;
  }
  // What is left of a shot at a squad in cover: three fifths from the side the point faces, four fifths on a
  // crest from anywhere, and all of it otherwise. Vehicles never hold cover.
  function coverScale(S, t, by) {
    if (!(t.cov >= 0) || !by) return 1;
    const p = coverPoints(S.map)[t.cov];
    if (p.kind === 'crest') return 0.8;
    const s = S.byId.get(by);
    if (!s) return 1;
    return Math.abs(angleTo(p.dir, matan2(s.y - p.y, s.x - p.x))) <= COVER_ARC ? 0.6 : 1;
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
  const WIND = { clear: 0.45, cloud: 0.6, rain: 0.7, storm: 1, fog: 0.12, snow: 0.4, sand: 1.15 };
  // The share of spells of each kind in a hundred, by theatre: dust storms on the salt flats and deep snow in the
  // pass. `any` is the one mix every game had before theatres had their own, kept for older saves and checks.
  const SKIES = {
    any: { clear: 36, cloud: 14, rain: 16, storm: 9, fog: 14, snow: 11 },
    desert: { clear: 52, cloud: 12, rain: 6, storm: 4, fog: 4, sand: 22 },
    steppe: { clear: 32, cloud: 16, rain: 20, storm: 12, fog: 16, snow: 4 },
    winter: { clear: 28, cloud: 22, fog: 14, snow: 36 },
  };
  // A game's weather setting weighs the kinds: mild keeps the harsh ones away, harsh brings them often, and off
  // leaves the sky clear.
  const WEATHERS = {
    random: {},
    mild: { clear: 1.6, cloud: 1.3, rain: 0.7, fog: 0.6, snow: 0.5, storm: 0, sand: 0 },
    harsh: { clear: 0.4, cloud: 0.6, rain: 1.3, fog: 1.3, snow: 1.4, storm: 2, sand: 1.8 },
    off: { cloud: 0, rain: 0, storm: 0, fog: 0, snow: 0, sand: 0 },
  };
  const SKY_KINDS = ['clear', 'cloud', 'rain', 'storm', 'fog', 'snow', 'sand'];
  // The kinds a theatre and setting allow, each with the top of its share, and the whole. Whole numbers, so every
  // copy of the world picks the same.
  function skyTable(theatre, weather) {
    const base = SKIES[theatre] || SKIES.any, k = WEATHERS[weather] || WEATHERS.random, cum = [];
    let total = 0;
    for (const kd of SKY_KINDS) {
      const n = Math.round((base[kd] || 0) * (k[kd] ?? 1));
      if (n > 0) { total += n; cum.push([kd, total]); }
    }
    return { cum, total };
  }
  const ANY_SKY = skyTable('any', 'random');
  const skyOf = S => S._sky || (S._sky = skyTable(S.theatre, S.weather));
  function spellHash(seed, k) {
    let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k | 0, 0xc2b2ae35);
    h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15;
    return h >>> 0;
  }
  function rawSpell(seed, k, tab) {
    if (k < 2) return 'clear';
    const r = spellHash(seed, k) % tab.total;
    for (const [kd, top] of tab.cum) if (r < top) return kd;
    return 'clear';
  }
  // Heavy weather passes: storms, dust storms, snow and fog hold for HEAVY of their spell, then ease into the kind
  // named here, and never come two spells running, the second turning to cloud.
  const EASE = { storm: 'rain', sand: 'cloud', snow: 'cloud', fog: 'cloud' }, HEAVY = 100 * HZ;
  function spellOf(seed, k, tab = ANY_SKY) {
    const kd = rawSpell(seed, k, tab);
    return EASE[kd] && rawSpell(seed, k - 1, tab) === kd ? 'cloud' : kd;
  }
  // How much of a heavy spell is still heavy at a tick, falling across BLEND about the end of its heavy part.
  const heavyW = (k, t) => clamp((k * SPELL + HEAVY + BLEND / 2 - t) / BLEND, 0, 1);
  // Spells that keep every aircraft on the ground.
  const GROUNDING = { storm: 1, sand: 1 };
  // How much a spell holds at a tick. It rises over BLEND across its start and falls across its end, so two
  // spells of one kind in a row join without a seam.
  const spellW = (k, t) => clamp((t - (k * SPELL - BLEND / 2)) / BLEND, 0, 1) * clamp(((k + 1) * SPELL + BLEND / 2 - t) / BLEND, 0, 1);
  function weatherAt(seed, t, tab = ANY_SKY) {
    const k = Math.floor(t / SPELL), sk = spellOf(seed, k, tab);
    const o = { clear: 0, cloud: 0, rain: 0, storm: 0, fog: 0, snow: 0, sand: 0, wind: [0, 0], flood: 0, cover: 0, kind: EASE[sk] && t >= k * SPELL + HEAVY ? EASE[sk] : sk, next: spellOf(seed, k + 1, tab), left: (k + 1) * SPELL - t };
    for (let j = k - 1; j <= k + 1; j++) {
      const w = spellW(j, t);
      if (w <= 0) continue;
      const kd = spellOf(seed, j, tab), a = (spellHash(seed + 77, j) % 6283) / 1000, hv = EASE[kd] ? heavyW(j, t) : 1;
      o[kd] += w * hv;
      o.wind[0] += mcos(a) * WIND[kd] * w * hv; o.wind[1] += msin(a) * WIND[kd] * w * hv;
      if (hv < 1) { const e = EASE[kd]; o[e] += w * (1 - hv); o.wind[0] += mcos(a) * WIND[e] * w * (1 - hv); o.wind[1] += msin(a) * WIND[e] * w * (1 - hv); }
    }
    o.rain = Math.min(1, o.rain + o.storm);
    // Rivers rise through a spell of rain or storm and go down over the next one and a half. Snow lies over
    // most of its spell and melts over the next.
    for (let j = k - 3; j <= k; j++) {
      const kd = spellOf(seed, j, tab), rv = kd === 'storm' ? 1 : kd === 'rain' ? 0.55 : 0, snow = kd === 'snow';
      if (!rv && !snow) continue;
      const tau = t - j * SPELL, up = clamp(tau / (SPELL * (snow ? 0.6 : 0.8)), 0, 1), down = tau > SPELL ? clamp(1 - (tau - SPELL) / (SPELL * (snow ? 1 : 1.5)), 0, 1) : 1;
      if (snow) o.cover += up * down; else o.flood += rv * up * down;
    }
    o.cover = Math.min(1, o.cover);
    // A storm keeps every aircraft on the ground. A dust storm grounds only those under its dust, by groundedAt.
    o.grounded = o.storm > 0.5;
    return o;
  }
  const sky = S => S._wx && S._wx.at === S.tick ? S._wx : (S._wx = Object.assign(weatherAt(S.seed, S.tick, skyOf(S)), { at: S.tick }));
  // Kinds of ore. Each pays about the same while a truck digs, but a load of gold is worth most and takes longest
  // to dig, and its fields are small, while iron digs fastest and its fields last longest. So gold pays best far
  // from home, where trips are long, at the cost of trucks standing longer in the open, and iron keeps a base going.
  // worth: a load's worth to its refinery, dig: how fast a truck digs it, amount: how much a field holds.
  const ORE_KINDS = [
    { key: 'gold', name: 'Gold', worth: 1.6, dig: 0.625, amount: 0.6 },
    { key: 'silver', name: 'Silver', worth: 1.25, dig: 0.8, amount: 0.8 },
    { key: 'copper', name: 'Copper', worth: 1, dig: 1, amount: 1 },
    { key: 'iron', name: 'Iron', worth: 0.9, dig: 1 / 0.9, amount: 1.5 },
  ];
  // How wide a vein of a mixed deposit's second kind runs, in the noise that draws it.
  const VEIN = 0.035;
  // Each field's kind, by how far it lies from its nearest base, alike for every side: copper in the nearest of a
  // base's home fields and iron in the next, gold in those farthest out, and silver between. Some deposits hold a
  // second kind in veins: copper through the iron, and gold through the silver. Each is [kind, vein kind or -1].
  function oreKindsFor(L) {
    const dist = L.ore.map(p => Math.min(...L.bases.map(b => mhypot(p[0] - b[0], p[1] - b[1])))), key = (p, i) => Math.round(dist[i] * 2) / 2 + '|' + p[2];
    const classes = [...new Set(L.ore.map(key))].map(k => +k.split('|')[0]).sort((a, b) => a - b), far = Math.max(...dist);
    return L.ore.map((p, i) => {
      const d = Math.round(dist[i] * 2) / 2, rank = classes.indexOf(d);
      return d >= far * 0.85 ? [0, -1] : rank === 0 ? [2, -1] : rank === 1 ? [3, 2] : [1, 0];
    });
  }
  // Showers. Besides the weather over the whole map, rain showers and snow flurries cross part of it: each a round
  // patch drifting straight over the map for a few minutes, growing at its start and fading at its end. They come of
  // the seed and the time alone, so every copy of the world has them and a save needs none, and none sets out while
  // the whole map is wet, white or blown with sand. A lane may start one every SHOWER_EVERY ticks, rain or snow by
  // the theatre's odds and the game's weather setting. Under one, wheels bog down in rain off the roads, everyone
  // slows in snow, and sight is cut short.
  const SHOWER_EVERY = 150 * HZ, SHOWER_LIFE = 210 * HZ, SHOWER_LANES = 2;
  const SHOWER_P = { any: [0.3, 0.08], desert: [0.1, 0], steppe: [0.32, 0.05], winter: [0.08, 0.36] }, SHOWER_K = { random: 1, mild: 0.5, harsh: 1.6, off: 0 };
  // Rain and storms fall from large dark clouds over part of the map, never on the whole of it. A wet spell brings
  // RAIN_CLOUDS of them in lanes across its wind, each carried downwind over the spell and growing and fading with
  // it. A storm's clouds are the darkest, and its lightning strikes under them.
  const RAIN_CLOUDS = 3;
  function rainClouds(S, t, tab, list) {
    const k0 = Math.floor(t / SPELL);
    for (let j = k0 - 1; j <= k0 + 1; j++) {
      const kd = spellOf(S.seed, j, tab), wj = spellW(j, t);
      if ((kd !== 'rain' && kd !== 'storm') || wj <= 0) continue;
      // The spell's own wind, as weatherAt blows it, and how far through the spell, -0.5 to 0.5.
      const a = (spellHash(S.seed + 77, j) % 6283) / 1000, dx = mcos(a), dy = msin(a), tau = (t - (j + 0.5) * SPELL) / SPELL;
      const storm = kd === 'storm' ? wj * heavyW(j, t) : 0;
      for (let c = 0; c < RAIN_CLOUDS; c++) {
        const h = spellHash(S.seed + 4409 + c * 7907, j), h2 = spellHash(S.seed + 8803 + c * 6151, j);
        const rad = (24 + h % 13) * W / 128, off = (((c + 0.5) / RAIN_CLOUDS - 0.5) * 0.8 + ((h >>> 8) % 1000 / 1000 - 0.5) * 0.1) * W;
        const s = ((h2 >>> 8) % 1000 / 1000 - 0.5) * 0.24 * W + (0.3 + 0.15 * (h2 % 100) / 100) * W * tau;
        list.push({ x: CX + dx * s - dy * off, y: CY + dy * s + dx * off, r: rad, kind: 'rain', k: wj, storm, cloud: true });
      }
    }
  }
  function showersAt(S, t = S.tick) {
    if (S._sh && S._sh.at === t) return S._sh.list;
    const list = [], P = SHOWER_P[S.theatre] || SHOWER_P.any, wk = SHOWER_K[S.weather] ?? 1, tab = skyOf(S);
    rainClouds(S, t, tab, list);
    const n = Math.floor(t / SHOWER_EVERY);
    if (wk > 0) for (let j = Math.max(0, n - Math.ceil(SHOWER_LIFE / SHOWER_EVERY) - 1); j <= n; j++) for (let l = 0; l < SHOWER_LANES; l++) {
      const h = spellHash(S.seed + 911 + l * 7919, j), t0 = j * SHOWER_EVERY + h % SHOWER_EVERY, age = t - t0;
      if (age < 0 || age > SHOWER_LIFE) continue;
      const r = (h >>> 10) % 1000 / 1000, kind = r < P[0] * wk ? 'rain' : r < (P[0] + P[1]) * wk ? 'snow' : null;
      if (!kind) continue;
      const sp = spellOf(S.seed, Math.floor(t0 / SPELL), tab);
      if (sp === 'rain' || sp === 'storm' || sp === 'snow' || sp === 'sand') continue;
      const h2 = spellHash(S.seed + 3301 + l * 104729, j), a = (h2 % 6283) / 1000, off = ((h2 >>> 13) % 1000 / 1000 - 0.5) * 0.7 * W;
      const rad = (9 + (h2 >>> 3) % 9) * W / 128, span = W * 1.25 + 2 * rad, s = -span / 2 + span * age / SHOWER_LIFE, dx = mcos(a), dy = msin(a);
      const k = clamp(age / (SHOWER_LIFE * 0.15), 0, 1) * clamp((SHOWER_LIFE - age) / (SHOWER_LIFE * 0.15), 0, 1);
      list.push({ x: CX + dx * s - dy * off, y: CY + dy * s + dx * off, r: rad, kind, k });
    }
    // Only the present is kept, so a look ahead, as the forecast's, leaves the world's own reckoning untouched.
    if (t === S.tick) S._sh = { at: t, list };
    return list;
  }
  // A dust storm comes as a haboob: a wall of dust rolling across the map on its spell's wind, from beyond one edge
  // to beyond the other over the storm's heavy part, thick for DUST_D of the map behind its front and thinning over
  // DUST_F behind that as the dust settles, with clear air ahead of it.
  const DUST_D = 0.3, DUST_F = 0.3;
  // The wall at a time: the way it rolls, how far its front has come that way from the map's middle, and how strong
  // the storm is, or null with none.
  function dustWall(S, t = S.tick) {
    if (S._dw && S._dw.at === t) return S._dw.wall;
    const tab = skyOf(S), k0 = Math.floor(t / SPELL);
    let wall = null;
    for (let j = k0 - 1; j <= k0; j++) {
      if (spellOf(S.seed, j, tab) !== 'sand') continue;
      const wj = spellW(j, t);
      if (wj <= 0) continue;
      const a = (spellHash(S.seed + 77, j) % 6283) / 1000, front = (-0.75 + 1.5 * (t - j * SPELL) / HEAVY) * W;
      if (!wall || wj > wall.k) wall = { dx: mcos(a), dy: msin(a), front, k: wj };
    }
    if (t === S.tick) S._dw = { at: t, wall };
    return wall;
  }
  // How thick the dust is at a point, 0 clear to 1.
  function dustAt(S, x, y) {
    const w = dustWall(S);
    if (!w) return 0;
    const e = w.front - ((x - CX) * w.dx + (y - CY) * w.dy);
    return w.k * smooth(-2, 3, e) * (1 - smooth(DUST_D * W, (DUST_D + DUST_F) * W, e));
  }
  // Whether aircraft at a point must stay down: everywhere in a storm, and under a dust storm's dust.
  const groundedAt = (S, x, y) => sky(S).grounded || dustAt(S, x, y) > 0.5;
  // How deep under a shower or a rain cloud a point lies, 0 clear to 1 in its heart, for rain, snow and storm.
  function showerAt(S, x, y) {
    let rain = 0, snow = 0, storm = 0;
    for (const s of showersAt(S)) {
      const d = mhypot(x - s.x, y - s.y);
      if (d >= s.r) continue;
      const f = smooth(s.r, s.r * 0.55, d), v = f * s.k;
      if (s.kind === 'rain') rain = Math.max(rain, v); else snow = Math.max(snow, v);
      if (s.storm) storm = Math.max(storm, f * s.storm);
    }
    return { rain, snow, storm };
  }
  // How fast a kind of mover goes off the roads in the weather over the whole map, before any worn track. Snow
  // slows everyone. Rain and storms fall only from clouds and blown sand only under a dust storm's wall, so those
  // are found where the mover stands.
  function offGoing(move, w) {
    if (move === 'naval') return 1;
    const g = move === 'wheel' ? 1 - 0.2 * w.snow
      : move === 'track' ? 1 - 0.1 * w.snow
        : 1 - 0.18 * w.snow;
    return Math.max(0.3, g);
  }
  // The time of day, from 0 at dawn round to 1. A day lasts twenty minutes and a game starts early in the morning.
  const dayAt = t => (t / (HZ * 1200) + 0.03) % 1;
  // How dark it is, 0 by day to 1 in the dead of night, rising through dusk and falling at first light, as the
  // picture's own night does.
  function nightAt(t) {
    const d = dayAt(t);
    return d < 0.07 ? (0.07 - d) / 0.07 * 0.3 : d < 0.78 ? 0 : d < 0.85 ? (d - 0.78) / 0.07 : d < 0.94 ? 1 : 1 - (d - 0.94) / 0.06 * 0.7;
  }
  // A side's running totals. made, lost, killed and razed count units and buildings. mined is supply from
  // trucks, townIn supply from towns and oilIn oil from towns and derricks. killV and lostV are the worth of
  // what was destroyed. inf, veh and air count units made by kind, and built the buildings placed.
  const freshStats = () => ({ made: 0, lost: 0, blost: 0, killed: 0, razed: 0, mined: 0, townIn: 0, oilIn: 0, spent: 0, spentOil: 0, killV: 0, lostV: 0, inf: 0, veh: 0, air: 0, built: 0 });
  function freshPlayer(team, o = {}) {
    return {
      team, supply: o.supply || 3500, oil: o.oil || 250, tech: 1, income: 1, carried: 0,
      q: { bld: [], def: [], inf: [], veh: [], air: [], sea: [], tech: [] }, prod: 0, use: 0, low: false, vis: new Uint8Array(N), seen: new Uint8Array(N),
      counts: {}, cooldown: { flare: 0, uav: 0, barrage: 0, para: 0, sat: 0 }, stats: freshStats(), spoke: {}, hints: {}, exposed: false, up: {},
      silo: 0, alive: true, shield: 0, born: 0,
    };
  }

  // The map a seed makes, or if it fails the checks, the next one along that passes, as a game would be set on.
  function mapFor(seed, kind, debug) {
    let M = makeMap(seed, kind);
    for (let tries = 0; tries < 12 && !goodMap(M); tries++) { if (debug) console.log('map', seed, M.why); seed += 1000; M = makeMap(seed, kind); }
    return M;
  }

  // A new game. layout is 'duel' (two slots, 128 cells), 'quad' (four, 192) or 'world' (eight, 256). seats
  // lists the slots that play, every slot unless given; the others stay empty. Each seated slot starts with a
  // base unless `empty` is set, and the seated slots' bases are spread evenly round the map, dealt at random
  // when `shuffle` gives a random draw. Every side starts in the age `age`, Ancient unless given, with more
  // supply the later it starts. The game is over when one side is left.
  function newGame(o = {}) {
    const kind = o.layout || 'duel', M = mapFor(o.seed || 1, kind, o.debug), seed = M.seed;
    coverPoints(M);
    const n = M.bases.length;
    const seats = (o.seats || [...Array(n).keys()]).filter(t => t >= 0 && t < n);
    const pos = o.pos || spread(seats, n, o.shuffle);
    const S = {
      HZ, tick: 0, seed, layout: kind, map: M, rs: seed ^ 0x51ed, ents: [], next: 1, byId: new Map(), cmds: [], log: [], keepLog: !!o.log, ev: [], shots: [], fields: new Map(),
      fieldQueue: 0, occVer: 1, occ: new Int32Array(N), occLog: [], over: null, ais: [], sweeps: [], hash: [], bldHash: [], flights: [],
      terr: new Int8Array(N).fill(-1), infl: [], terrVer: 0, townOwnerVer: 0,
      ore: new Uint16Array(M.ore), oreVer: 0,
      P: [], bases: pos.map(p => M.bases[p]), faces: pos.map(p => M.faces[p]), seats, pos, _fields: new Map(), age0: clamp(o.age | 0 || 1, 1, MAX_AGE),
      // The theatre's weather and the game's setting for it. A game made without them has the one old mix.
      theatre: SKIES[o.theatre] ? o.theatre : 'any', weather: WEATHERS[o.weather] ? o.weather : 'random',
      // Unlimited: no side ever runs short of ore, oil or power, so only build times and the fighting count.
      free: !!o.free,
      // Regicide: each side has a general from the start, and a side whose general falls is out.
      regicide: !!o.regicide,
      // King of the Hill: no building, towns raise the soldiers, and the high points are fought for.
      koth: !!o.koth,
      // The ground as it now is, which woods, bridges and fords change, and what has happened to the trees,
      // bridges and houses.
      gnd: new Uint8Array(M.ground), gndVer: 0, wood: new Uint8Array(N), woodVer: 0, burn: [], crush: [],
      bridges: M.bridges.map(() => ({ hp: BRIDGE_HP, fix: 0, c4: 0 })), hh: M.houses.map(houseHp), hr: M.houses.map(() => 0), flooded: false,
      trail: new Uint8Array(N), trailSum: 0,
    };
    S.rand = rngOf(S);
    for (let t = 0; t < n; t++) {
      const P = freshPlayer(t, o);
      P.tech = S.age0; P.supply = o.supply || START_SUPPLY[S.age0];
      if (!seats.includes(t)) { P.alive = false; P.out = true; }
      S.P.push(P); S.infl.push(new Float32Array(N));
    }
    S.hist = freshHist(S);
    for (const m of M.towns) m.owner = -1;
    S.towns = M.towns.map(t => Object.assign({}, t));
    if (S.koth) {
      // No ore is dug, so the fields are left as ground.
      S.ore.fill(0);
      S.points = kothPoints(S, kothCount(S));
      S.tracks = kothTracks(S);
      S.score = S.P.map(() => KOTH_SCORE);
      if (!o.empty) for (const t of seats) spawnHome(S, t);
    } else if (!o.empty) for (const t of seats) spawnBase(S, t);
    territory(S);
    recount(S);
    vision(S);
    return S;
  }

  // The game's record. t holds the sample ticks. P holds each seated side's series, one value per sample: score,
  // army worth, units, buildings, land in tenths of a percent, supply and oil earned, towns held and the worth
  // destroyed. war holds, per sample, the fighting since the last as flat triples of attacker, target and
  // damage, which acc gathers meanwhile. marks are the moments worth showing on the timeline.
  const SERIES = ['sc', 'ar', 'un', 'bl', 'ld', 'su', 'oi', 'tw', 'kv'];
  function freshHist(S) {
    const P = S.P.map(p => p.out ? null : Object.fromEntries(SERIES.map(k => [k, []])));
    return { every: HIST_EVERY, t: [], P, war: [], acc: {}, marks: [] };
  }
  // A side's score in four parts. Military is a tenth of the worth it destroyed, economy a
  // twentieth of what it earned, technology the worth of its tech levels, and territory its towns and land.
  function scoreOf(S, team, land) {
    const P = S.P[team], s = P.stats;
    if (land === undefined) { land = 0; for (let c = 0; c < N; c++) if (S.terr[c] === team) land++; }
    const towns = S.towns.reduce((n, t) => n + (t.owner === team), 0);
    const mil = s.killV / 10, eco = (s.mined + s.townIn + 4 * s.oilIn) / 20, tec = TECH_PTS[P.tech] || 0, ter = towns * 40 + land * 1000 / N;
    return { mil: Math.round(mil), eco: Math.round(eco), tec: Math.round(tec), ter: Math.round(ter), total: Math.round(mil + eco + tec + ter), land: Math.round(land * 1000 / N), towns };
  }
  function mark(S, team, k, v) { if (S.hist) S.hist.marks.push(v === undefined ? { t: S.tick, team, k } : { t: S.tick, team, k, v }); }
  // Samples every side's figures when the gap has passed, or now when forced, at the game's end.
  function record(S, force) {
    const h = S.hist, last = h.t.length ? h.t[h.t.length - 1] : -Infinity;
    if (last === S.tick || (!force && S.tick - last < h.every)) return;
    const n = S.P.length, land = new Int32Array(n), un = new Int32Array(n), bl = new Int32Array(n), ar = new Float64Array(n);
    for (let c = 0; c < N; c++) if (S.terr[c] >= 0) land[S.terr[c]]++;
    for (const e of S.ents) if (e.hp > 0 && e.team >= 0 && e.team < n) { if (e.b) bl[e.team]++; else { un[e.team]++; if (!e.d.cargo) ar[e.team] += worth(e.d); } }
    h.t.push(S.tick);
    h.P.forEach((a, t) => {
      if (!a) return;
      const s = S.P[t].stats, sc = scoreOf(S, t, land[t]);
      // In King of the Hill the score is the hill score, which the report charts over the game.
      a.sc.push(S.koth ? S.score[t] : sc.total); a.ar.push(Math.round(ar[t])); a.un.push(un[t]); a.bl.push(bl[t]); a.ld.push(sc.land);
      a.su.push(Math.round(s.mined + s.townIn)); a.oi.push(Math.round(s.oilIn)); a.tw.push(sc.towns); a.kv.push(Math.round(s.killV));
    });
    const war = [];
    for (const k in h.acc) if (h.acc[k] >= 1) war.push(k / n | 0, k % n, Math.round(h.acc[k]));
    h.war.push(war); h.acc = {};
    // For the war map: where each side's main army stood on land, at the unit nearest the middle of its land units
    // around the densest worth of them, so the mark is on ground it holds and never out on the water, and where the
    // fighting fell. Ships and aircraft are left out. A record made before these were kept is padded to match.
    h.pos = h.pos || []; h.fight = h.fight || [];
    while (h.pos.length < h.t.length - 1) h.pos.push(null);
    while (h.fight.length < h.t.length - 1) h.fight.push(null);
    const pos = [], bins = new Map();
    for (const e of S.ents) {
      if (e.b || e.hp <= 0 || e.team < 0 || e.team >= n || e.d.cargo || e.d.trade || !armed(e) || isAir(e) || e.d.move === 'naval') continue;
      const k = e.team * 4096 + ((e.y / 12) | 0) * 64 + ((e.x / 12) | 0), v = worth(e.d);
      bins.set(k, (bins.get(k) || 0) + v);
    }
    for (let t = 0; t < n; t++) {
      let best = -1, bw = 0;
      for (const [k, v] of bins) if ((k / 4096 | 0) === t && v > bw) { bw = v; best = k; }
      if (best < 0 || bw < 300) { pos.push(null); continue; }
      const bx = (best % 64) * 12 + 6, by = ((best % 4096) / 64 | 0) * 12 + 6;
      let sx = 0, sy = 0, sw = 0;
      const body = e => !(e.b || e.hp <= 0 || e.team !== t || e.d.cargo || e.d.trade || !armed(e) || isAir(e) || e.d.move === 'naval' || mhypot(e.x - bx, e.y - by) > 16);
      for (const e of S.ents) if (body(e)) { const v = worth(e.d); sx += e.x * v; sy += e.y * v; sw += v; }
      let near = null, nd = Infinity;
      if (sw) for (const e of S.ents) if (body(e)) { const d = mhypot(e.x - sx / sw, e.y - sy / sw); if (d < nd) { nd = d; near = e; } }
      pos.push(near ? [Math.round(near.x * 2) / 2, Math.round(near.y * 2) / 2, Math.round(sw)] : null);
    }
    h.pos.push(pos);
    const fa = h.fa || [0, 0, 0];
    h.fight.push(fa[2] >= 60 ? [Math.round(fa[0] / fa[2] * 2) / 2, Math.round(fa[1] / fa[2] * 2) / 2, Math.round(fa[2])] : null);
    h.fa = [0, 0, 0];
    // Past the most samples, every other one goes, its fighting folded into the next one kept.
    if (h.t.length >= HIST_MAX) {
      const L = h.t.length, kept = i => i % 2 === 0 || i === L - 1, keep = a => a.filter((_, i) => kept(i));
      const war2 = [];
      let carry = [];
      for (let i = 0; i < h.war.length; i++) if (kept(i)) { war2.push(carry.concat(h.war[i])); carry = []; } else carry.push(...h.war[i]);
      // A dropped sample's fighting goes to the kept one after it, the larger of the two standing for both.
      const f2 = [];
      let cf = null;
      for (let i = 0; i < h.fight.length; i++) { const f = h.fight[i], big = !cf ? f : !f ? cf : cf[2] > f[2] ? [cf[0], cf[1], cf[2] + f[2]] : [f[0], f[1], cf[2] + f[2]]; if (kept(i)) { f2.push(big); cf = null; } else cf = big; }
      h.t = keep(h.t); h.war = war2; h.pos = keep(h.pos); h.fight = f2;
      for (const a of h.P) if (a) for (const k of SERIES) a[k] = keep(a[k]);
      h.every *= 2;
    }
  }

  // A headquarters and three units at a slot's own place, facing the middle of the map.
  function spawnBase(S, team) {
    const b = S.bases[team], a = S.faces[team], f = [mcos(a), msin(a)], s = [-f[1], f[0]];
    const at = (fw, sd) => [b[0] + f[0] * fw + s[0] * sd, b[1] + f[1] * fw + s[1] * sd];
    addBuilding(S, 'hq', team, Math.round(b[0] - 2.5), Math.round(b[1] - 2.5), true);
    const age = S.P[team].tech, inf = formOf('inf', age);
    spawn(S, inf, team, ...at(7.0711, -2.8284)); spawn(S, inf, team, ...at(7.0711, 2.8284)); spawn(S, formOf('rec', age), team, ...at(9.1924, -0.7071));
    if (S.regicide) spawn(S, 'general', team, ...at(4.5, 0));
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
      v: 1, seed: S.seed, layout: S.layout, seats: S.seats, pos: S.pos, age0: S.age0, theatre: S.theatre, weather: S.weather, free: S.free, regicide: S.regicide, tick: S.tick, rs: S.rs, next: S.next, occVer: S.occVer, oreVer: S.oreVer, terrVer: S.terrVer, dirty: !!S.dirty, over: S.over,
      ents: S.ents.map(plain), towns: S.towns, shots: S.shots, sweeps: S.sweeps, flights: S.flights, occLog: S.occLog,
      fields: [...S.fields].map(([k, f]) => [k, f.ver, f.used, f.made, f.reach, f.wq]),
      ore: b64.en(new Uint8Array(S.ore.buffer.slice(0))),
      P: S.P.map(P => { const o = plain(P); o.vis = bits(P.vis); o.seen = bits(P.seen); o.q = {}; for (const c in P.q) o.q[c] = P.q[c].map(it => { const j = Object.assign({}, it); delete j.cost; return j; }); return o; }),
      // The ground and the trees as pairs of cell and value, only where they differ from the map's start.
      gnd: diffs(S.gnd, S.map.ground), wood: diffs(S.wood, null), gndVer: S.gndVer, woodVer: S.woodVer, burn: S.burn, bridges: S.bridges, hh: S.hh, hr: S.hr, flooded: S.flooded,
      trail: b64.en(S.trail), trailSum: S.trailSum, hist: S.hist,
      koth: S.koth, points: S.points, score: S.score,
    };
  }
  function diffs(a, base) { const o = []; for (let c = 0; c < a.length; c++) if (a[c] !== (base ? base[c] : 0)) o.push(c, a[c]); return o; }
  function load(o) {
    const S = newGame({ seed: o.seed, layout: o.layout, seats: o.seats, pos: o.pos, age: o.age0 || 5, theatre: o.theatre, weather: o.weather, free: o.free, regicide: o.regicide, koth: o.koth, empty: true });
    if (S.seed !== o.seed) throw new Error('map seed mismatch');
    Object.assign(S, { tick: o.tick, rs: o.rs, next: o.next, occVer: o.occVer, oreVer: o.oreVer, terrVer: o.terrVer, dirty: o.dirty, over: o.over, shots: o.shots, sweeps: o.sweeps, flights: o.flights, occLog: o.occLog || [] });
    S.towns = o.towns.map(t => Object.assign({}, t));
    if (S.koth && o.points) { S.points = o.points.map(p => Object.assign({}, p)); S.score = o.score.slice(); }
    S.ore = new Uint16Array(b64.de(o.ore).buffer);
    S.fields = new Map(o.fields.map(([k, v, u, m, r, q]) => [k, { ver: v, used: u, made: m, reach: r, wq: q ?? 20 }]));
    S.P = o.P.map(p => {
      const P = Object.assign(freshPlayer(p.team), p);
      P.stats = Object.assign(freshStats(), p.stats);
      // A game saved before the ages counted three tech levels within today's world, the Modern Age.
      if (!o.age0) P.tech = 5;
      P.vis = unbits(p.vis, N); P.seen = unbits(p.seen, N);
      for (const c in P.q) P.q[c] = p.q[c].map(it => Object.assign({}, it, { cost: c === 'tech' ? TECH[it.level] : (UNITS[it.kind] || BUILDINGS[it.kind]) }));
      // A side saved before ships came has no dock's queue.
      if (!P.q.sea) P.q.sea = [];
      return P;
    });
    S.ents = o.ents.map(e => Object.assign({}, e, { d: e.b ? BUILDINGS[e.kind] : UNITS[e.kind] }));
    S.byId = new Map(S.ents.map(e => [e.id, e]));
    // A world saved before woods, bridges and fords could change keeps the map's own ground.
    const gd = o.gnd || [], wd = o.wood || [];
    for (let i = 0; i < gd.length; i += 2) S.gnd[gd[i]] = gd[i + 1];
    for (let i = 0; i < wd.length; i += 2) S.wood[wd[i]] = wd[i + 1];
    S.gndVer = o.gndVer || 0; S.woodVer = o.woodVer || 0; S.burn = o.burn || []; S.flooded = !!o.flooded;
    if (o.trail) S.trail = new Uint8Array(b64.de(o.trail)); S.trailSum = o.trailSum || 0;
    // A game saved before the record was kept starts its record now.
    if (o.hist) S.hist = o.hist;
    if (o.hh && o.hh.length === S.hh.length) S.hh = o.hh.slice();
    if (o.hr && o.hr.length === S.hh.length) S.hr = o.hr.slice();
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
      // A unit sheltering in a building still serves.
      if (e.held) P.counts[e.held.kind] = (P.counts[e.held.kind] || 0) + 1;
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
    mix(S.gndVer); mix(S.woodVer); mix(S.burn.length); mix(S.trailSum);
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
    const d = UNITS[kind], hp = hpOf(S, team, d);
    const u = {
      id: S.next++, kind, team, d, b: false, x, y, px: x, py: y, a: S.faces[team] || 0, pa: 0, ta: S.faces[team] || 0, pta: 0, v: 0, hp, max: hp,
      ord: null, tgt: 0, cd: d.weapons.map(() => 0), z: d.alt || 0, xp: 0, vet: 0, wx: x, wy: y, wpT: 0, stuck: 0, lx: x, ly: y, flash: 0, fired: 0, anim: 0, home: null, born: S.tick,
      cargo: 0, state: 0, aimT: 0, under: 0, slot: null, life: d.life || 0, salvo: 0, salvoT: 0, ammo: d.bombs ? d.bombs.n : 0, drop: 0, cov: -1,
    };
    u.pa = u.a; u.pta = u.ta;
    S.ents.push(u); S.byId.set(u.id, u);
    Object.assign(u, o);
    if (d.cargo) u.ord = { t: 'harvest' };
    if (d.trade) u.ord = { t: 'trade' };
    if (d.fish) u.ord = { t: 'fish' };
    return u;
  }

  function fits(S, team, kind, cx, cy, ignoreTerr) {
    const d = BUILDINGS[kind], M = S.map;
    if (cx < 1 || cy < 1 || cx + d.w >= W - 1 || cy + d.h >= H - 1) return false;
    if (d.well) {
      const w = M.wells.find(e => e.x === cx + 1 && e.y === cy + 1);
      if (!w) return false;
    }
    if (d.shore) return shoreFits(S, team, d, cx, cy, ignoreTerr);
    for (let y = cy; y < cy + d.h; y++) for (let x = cx; x < cx + d.w; x++) {
      const c = y * W + x;
      if (S.occ[c] || (S.gnd[c] & 4)) return false;
      if (S.ore[c] && !d.well) return false;
      if (!ignoreTerr && S.terr[c] !== team) return false;
    }
    return true;
  }
  // Where a building being placed would stand and why it could not, for the player placing it: each cell of its
  // footprint marked clear or not, and the first reason found, in plain words. It only reads, and its answer is
  // fits's own.
  function placeCheck(S, team, kind, cx, cy) {
    const d = BUILDINGS[kind], M = S.map, ok = fits(S, team, kind, cx, cy), cells = [], why = [];
    const say = s => { if (!why.includes(s)) why.push(s); };
    const house = (x, y) => M.houses.some((h, i) => S.hh[i] > 0 && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h);
    if (cx < 1 || cy < 1 || cx + d.w >= W - 1 || cy + d.h >= H - 1) say('Too near the edge of the map');
    for (let y = cy; y < cy + d.h; y++) for (let x = cx; x < cx + d.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) { cells.push([x, y, 1]); continue; }
      const c = y * W + x, v = (y * RES + 1) * VW + x * RES + 1, wv = M.wl ? M.wl[v] : M.water;
      let bad = '';
      if (S.occ[c]) bad = 'Something already stands here';
      else if (S.ore[c] && !d.well) bad = 'Ore lies here';
      else if (d.shore) {
        if (M.deck[v] > 0 || (S.gnd[c] & 16)) bad = 'On a bridge or a ford';
        else if (S.terr[c] >= 0 && S.terr[c] !== team) bad = "Inside another side's border";
      } else if (S.gnd[c] & 4) bad = house(x, y) ? 'A house stands here' : M.h[v] < wv ? 'In the water' : M.roadDist[v] <= 1.2 ? 'On a road' : M.brookDist && M.brookDist[v] < 0.75 ? 'On a brook' : 'Too steep';
      else if (S.terr[c] !== team) bad = 'Outside your border';
      cells.push([x, y, bad ? 1 : 0]);
      if (bad) say(bad);
    }
    if (!ok && d.well && !M.wells.some(e => e.x === cx + 1 && e.y === cy + 1)) say('Must stand on an oil well');
    if (!ok && d.shore && !why.length) say('Needs a bank behind it and open water before it');
    return { ok, why: ok ? '' : why[0] || 'Cannot stand here', cells };
  }

  // A dock juts off the shore, its back on the bank and its front out over the water, with open water close
  // beyond. A cliff, a ford or a bridge will not take it. It need not stand inside the border, only within
  // SHORE_REACH cells of it and outside every other side's. The ground's bits call every cell at the water's edge
  // a cliff, so the bank's own fall across each cell is measured instead.
  const SHORE_REACH = 10;
  function shoreFits(S, team, d, cx, cy, ignoreTerr) {
    const M = S.map, h = M.h;
    let dry = 0, wet = 0;
    for (let y = cy; y < cy + d.h; y++) for (let x = cx; x < cx + d.w; x++) {
      const c = y * W + x, v = (y * RES + 1) * VW + x * RES + 1;
      if (S.occ[c] || S.ore[c] || M.deck[v] > 0 || (S.gnd[c] & 16)) return false;
      if (!ignoreTerr && S.terr[c] >= 0 && S.terr[c] !== team) return false;
      const wv = M.wl ? M.wl[v] : M.water;
      if (h[v] < wv) wet++;
      else if (h[v] > wv + 0.05) {
        let hi = -99, lo = 99;
        for (let b = 0; b <= RES; b++) for (let a = 0; a <= RES; a++) { const z = h[(y * RES + b) * VW + x * RES + a]; hi = Math.max(hi, z); lo = Math.min(lo, z); }
        if (hi - lo > 1.4) return false;
        dry++;
      }
    }
    if (dry < 3 || wet < 2) return false;
    let open = 0;
    for (let y = Math.max(0, cy - 4); y < Math.min(H, cy + d.h + 4); y++) for (let x = Math.max(0, cx - 4); x < Math.min(W, cx + d.w + 4); x++) open += M.sea[y * W + x];
    if (open < 16) return false;
    if (ignoreTerr) return true;
    const R = SHORE_REACH;
    for (let y = Math.max(0, cy - R); y < Math.min(H, cy + d.h + R); y++) for (let x = Math.max(0, cx - R); x < Math.min(W, cx + d.w + R); x++) if (S.terr[y * W + x] === team) return true;
    return false;
  }

  // Lays a building on its cells. Units standing there are pushed out by the movement code.
  function addBuilding(S, kind, team, cx, cy, instant) {
    const d = BUILDINGS[kind], hp = hpOf(S, team, d);
    const e = {
      id: S.next++, kind, team, d, b: true, cx, cy, w: d.w, h: d.h, x: cx + d.w / 2, y: cy + d.h / 2, hp, max: hp, born: instant ? -1e6 : S.tick,
      repairing: false, tgt: 0, cd: d.weapons ? d.weapons.map(() => 0) : d.arms ? [0] : [], ta: S.faces[team] || 0, pta: 0, rally: null, flash: 0, fired: 0, charge: 0, under: 0, c4: 0,
    };
    S.ents.push(e); S.byId.set(e.id, e);
    const cells = [], prev = [];
    for (let y = cy; y < cy + d.h; y++) for (let x = cx; x < cx + d.w; x++) { const c = y * W + x; cells.push(c); prev.push(S.occ[c]); S.occ[c] = e.id; }
    S.occVer++;
    logOcc(S, cells, prev);
    if (d.freeTruck && !instant) {
      const [ex, ey] = exitOf(S, e);
      spawn(S, formOf('truck', S.P[team].tech), team, ex, ey);
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
      // A unit sheltering in a building still serves.
      if (e.held) P.counts[e.held.kind] = (P.counts[e.held.kind] || 0) + 1;
    }
    for (const P of S.P) {
      const was = P.low;
      P.low = !S.free && P.tech >= POWER_AGE && P.use > P.prod;
      if (P.low && !was) { ownEvent(S, P.team, 'lowpower'); P.lowFor = 0; }
      else if (!P.low && was) ownEvent(S, P.team, 'powerok');
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
    const gov = new Set();
    for (const e of S.ents) if (e.b && e.hp > 0 && e.d.civic) gov.add(e.team);
    const civ = t => gov.has(t) ? CIVIC_REACH : 1;
    for (const e of S.ents) if (e.b && e.hp > 0) stamp(S.infl[e.team], e.x, e.y, (e.kind === 'hq' || e.kind === 'fob' ? e.d.terr * upK(S, e.team, 'border') : e.d.terr) * civ(e.team));
    for (const t of S.towns) if (t.owner >= 0) stamp(S.infl[t.owner], t.x, t.y, t.r * civ(t.owner));
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

  // Whether water lies in any of the map's 8 by 8 blocks within r of a point, from the map's water, worked out once.
  function wetNear(M, x, y, r) {
    if (!M._wetB) {
      const BW = Math.ceil(W / 8), BH = Math.ceil(H / 8), b = new Uint8Array(BW * BH);
      for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) if (terrainAt(M, cx + 0.5, cy + 0.5) < waterLevel(M, cx + 0.5, cy + 0.5)) b[(cy >> 3) * BW + (cx >> 3)] = 1;
      M._wetB = { b, BW, BH };
    }
    const { b, BW, BH } = M._wetB;
    for (let by = Math.max(0, Math.floor((y - r) / 8)); by <= Math.min(BH - 1, Math.floor((y + r) / 8)); by++) for (let bx = Math.max(0, Math.floor((x - r) / 8)); bx <= Math.min(BW - 1, Math.floor((x + r) / 8)); bx++) if (b[by * BW + bx]) return true;
    return false;
  }

  // What each watcher's rays reached when it last looked, kept outside the world by who watches: buildings never
  // move and units often stand, and the ground and water sight runs over do not change in play.
  const sightOf = new WeakMap();
  // Sight runs along rays, keeping the steepest look-up angle so far, as a watcher on a hill would. Heights are the
  // water's surface where water lies, and open water, which hides nothing, is seen wk times as far: a ray goes on past
  // the sight's reach while it is over water, and stops at the far bank. One side looks, the side only, or every side.
  function vision(S, only = -1) {
    const M = S.map, mine = t => only < 0 || t === only;
    // The cells a shower hides, set below before any side looks.
    let shMask = null;
    S.P.forEach((P, t) => { if (mine(t)) P.vis.fill(0); });
    const light = (P, x, y, r, eye, air, wk = 1, who = null) => {
      const R = Math.round(r), vis = P.vis, seen = P.seen;
      const ox = x, oy = y, c0 = cellOf(ox, oy);
      vis[c0] = 1; seen[c0] = 1;
      if (air) {
        for (let cy = Math.max(0, (y - R) | 0); cy <= Math.min(H - 1, (y + R) | 0); cy++) for (let cx = Math.max(0, (x - R) | 0); cx <= Math.min(W - 1, (x + R) | 0); cx++) {
          const ex = cx + 0.5 - x, ey = cy + 0.5 - y;
          if (ex * ex + ey * ey <= r * r) { const c = cy * W + cx; if (shMask && shMask[c] && ex * ex + ey * ey > 9) continue; vis[c] = 1; seen[c] = 1; }
        }
        return;
      }
      // The eye is on a bridge's deck or the water's surface where the ground under it is lower.
      const lv = (px, py) => M.wl ? waterLevel(M, px, py) : M.water;
      const z0 = Math.max(heightAt(M, ox, oy), lv(ox, oy)) + eye;
      const RW = wk > 1 && wetNear(M, x, y, r * wk) ? Math.round(r * wk) : R;
      // The rays are cast again only when the watcher has moved or its reach has changed; else the cells they
      // reached last time are lit again, all but those a shower now hides.
      let L = who && sightOf.get(who);
      if (!L || L.x !== ox || L.y !== oy || L.z0 !== z0 || L.R !== R || L.RW !== RW || L.M !== M) {
        const cells = [], far = [];
        for (const [dx, dy] of raysFor(RW)) {
          let top = -1e9;
          for (let d = 1; d <= RW; d++) {
            const px = ox + dx * d, py = oy + dy * d;
            if (px < 0 || py < 0 || px >= W || py >= H) break;
            const t = terrainAt(M, px, py), wl = lv(px, py), wet = t < wl;
            if (d > R && !wet) break;
            const hz = wet ? wl : t, slope = (hz + 0.5 - z0) / d;
            if (slope >= top - 0.02 || d < 3) { cells.push((py | 0) * W + (px | 0)); far.push(d > 3 ? 1 : 0); }
            const block = (hz - z0) / d;
            if (block > top) top = block;
          }
        }
        L = { x: ox, y: oy, z0, R, RW, M, cells: Int32Array.from(cells), far: Uint8Array.from(far) };
        if (who) sightOf.set(who, L);
      }
      const cs = L.cells, fs = L.far;
      for (let i = 0; i < cs.length; i++) { const c = cs[i]; if (!(shMask && shMask[c] && fs[i])) { vis[c] = 1; seen[c] = 1; } }
    };
    // Fog shortens everyone's sight, and blown sand the sight of what stands in a dust storm's dust. Radar sweeps and
    // flares see through them. By night a unit sees two fifths less, a building a little less by its lamps, and a
    // building that fights not at all, by its searchlight.
    const w = sky(S), n = nightAt(S.tick), dusty = !!dustWall(S);
    const fkAt = e => Math.max(0.4, 1 - 0.45 * w.fog - (dusty ? 0.4 * dustAt(S, e.x, e.y) : 0)), faAt = e => Math.max(0.5, 1 - 0.3 * w.fog - (dusty ? 0.3 * dustAt(S, e.x, e.y) : 0));
    const nu = 1 - 0.4 * n, nb = 1 - 0.15 * n;
    // Under a shower or a rain cloud sight is cut short: what stands inside one is seen only from close by, and what
    // stands in one sees a third less itself.
    const shw = showersAt(S), mask = shw.length ? (S._shMask && S._shMask.length === N ? S._shMask.fill(0) : (S._shMask = new Uint8Array(N))) : null;
    if (mask) for (const s of shw) {
      const rr = s.r * 0.8 * s.k;
      if (rr < 2) continue;
      for (let cy = Math.max(0, Math.floor(s.y - rr)); cy <= Math.min(H - 1, Math.ceil(s.y + rr)); cy++) for (let cx = Math.max(0, Math.floor(s.x - rr)); cx <= Math.min(W - 1, Math.ceil(s.x + rr)); cx++) if (mhypot(cx + 0.5 - s.x, cy + 0.5 - s.y) < rr) mask[cy * W + cx] = 1;
    }
    shMask = mask;
    const inSh = e => mask && mask[cellOf(e.x, e.y)] ? 0.65 : 1;
    for (const e of S.ents) {
      if (e.hp <= 0 || !mine(e.team)) continue;
      const P = S.P[e.team];
      // Under a side's satellite constellation its units see as by a clear day.
      const up = satUp(S, e.team);
      if (e.b) light(P, e.x, e.y, (e.d.sight + Math.max(e.w, e.h) / 2) * (up ? 1 : fkAt(e) * (armOf(S, e) ? 1 : nb) * inSh(e)), 3, false, 1, e);
      else if (e.d.move === 'air' || e.d.move === 'jet') light(P, e.x, e.y, e.d.sight * (up ? 1 : faAt(e) * (1 - 0.3 * n) * inSh(e)), 0, true);
      // A ground unit sees a half again as far across open water, and a scout two and a half times as far. A ship's
      // sight is its own.
      else light(P, e.x, e.y, e.d.sight * (up ? 1 : fkAt(e) * nu * inSh(e)) * (e.cov >= 0 ? 1.2 : 1), 1.1, false, e.d.move === 'naval' ? 1 : canExplore(e) ? 2.5 : 1.5, e);
    }
    for (const t of S.towns) if (t.owner >= 0 && mine(t.owner)) light(S.P[t.owner], t.x, t.y, 9 * fkAt(t) * (1 - 0.25 * n), 2, false, 1, t);
    for (const s of S.sweeps) if (s.until > S.tick && mine(s.team)) light(S.P[s.team], s.x, s.y, s.r, 0, true);
    // A unit or building that has fired lately is seen by the side it fired on, wherever it stands, by its flash.
    for (const e of S.ents) if (e.hp > 0 && e.firedUntil > S.tick && S.P[e.firedOn] && mine(e.firedOn)) light(S.P[e.firedOn], e.x, e.y, e.b ? Math.max(e.w, e.h) / 2 + 0.5 : 0.8, 0, true);
    // The rays leave a lone cell dark here and there between them. A cell whose four neighbours are seen is seen.
    S.P.forEach((P, t) => {
      if (!mine(t)) return;
      const vis = P.vis, seen = P.seen;
      for (let y = 1; y < H - 1; y++) for (let x = 1, c = y * W + 1; x < W - 1; x++, c++) {
        if (!vis[c] && vis[c - 1] && vis[c + 1] && vis[c - W] && vis[c + W]) { vis[c] = 1; seen[c] = 1; }
      }
    });
  }

  // Three ways of getting about: on foot, on wheels, and on tracks, which go through woods by flattening them.
  // Each is stopped by its own ground bits.
  const BIT = { foot: 2, veh: 9, track: 1, naval: 0 };
  const clsOf = u => u.d.move === 'foot' ? 'foot' : u.d.move === 'track' ? 'track' : u.d.move === 'naval' ? 'naval' : 'veh';
  function blocked(S, cls, c, occ = S.occ, g = S.gnd) {
    // A ship keeps to open water.
    if (cls === 'naval') return !S.map.sea[c] || occ[c] !== 0;
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
  // it is made again, and at most two are made in a step, so a burst of orders is spread over steps.
  // The weather's going off the roads for a class, in twentieths, so a field is made again as the going changes.
  // A world keeps up to FIELDS_KEPT fields, dropping the one longest unused for a new one. Eight sides' squads may be
  // making for more goals at once than half that, and a field dropped and asked for again is made again.
  const FIELDS_A_STEP = 2, FIELDS_KEPT = 96;
  const goingKey = (S, cls) => Math.round(offGoing(cls === 'veh' ? 'wheel' : cls, sky(S)) * 20);
  function field(S, cls, gx, gy, need = 0) {
    const key = (cls === 'foot' ? 0 : cls === 'veh' ? 1 : cls === 'track' ? 2 : 3) * N + gy * W + gx, wq = goingKey(S, cls);
    let f = S.fields.get(key);
    if (f && f.ver < oldestOcc(S)) { S.fields.delete(key); S._fields.delete(key); f = null; }
    const enough = f && f.reach >= need;
    if (enough && ((f.ver === S.occVer && f.wq === wq) || S.fieldQueue >= FIELDS_A_STEP || S.tick - f.made < 60)) { f.used = S.tick; return built(S, key, f, cls, gx, gy); }
    if (S.fieldQueue >= FIELDS_A_STEP) return null;
    S.fieldQueue++;
    if (!f) {
      if (S.fields.size >= FIELDS_KEPT) {
        let oldest = null, age = Infinity;
        for (const [k, v] of S.fields) if (v.used < age) { age = v.used; oldest = k; }
        S.fields.delete(oldest); S._fields.delete(oldest);
      }
      f = { ver: 0, used: 0, made: 0, reach: 0, wq: 20 };
      S.fields.set(key, f);
    }
    f.reach = Math.max(f.ver === S.occVer && f.wq === wq ? f.reach : 0, Math.fround(need * 1.5 + 32));
    f.ver = S.occVer; f.used = S.tick; f.made = S.tick; f.wq = wq;
    return built(S, key, f, cls, gx, gy);
  }
  function built(S, key, f, cls, gx, gy) {
    let p = S._fields.get(key);
    if (p && p.ver === f.ver && p.reach === f.reach && p.wq === f.wq) return p;
    if (!p) { p = { dist: new Float32Array(N), dir: new Int8Array(N) }; S._fields.set(key, p); }
    p.ver = f.ver; p.reach = f.reach; p.wq = f.wq;
    const [occ, gnd] = stateAt(S, f.ver);
    fill(S, p, cls, gx, gy, occ, gnd, f.reach, f.wq, f.ver);
    return p;
  }
  // How much of a cell is road, 1 on the carriageway fading to 0 at its verge, from the distance at its middle.
  function roadW(M) {
    if (M.roadW) return M.roadW;
    const rw = M.roadW = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rw[y * W + x] = 1 - smooth(0.9, 1.6, M.roadDist[(y * RES + 1) * VW + x * RES + 1]);
    return rw;
  }
  // The distance from a point to the nearest road's middle line.
  const roadDistAt = (M, x, y) => M.roadDist[clamp(Math.round(y * RES), 0, VH - 1) * VW + clamp(Math.round(x * RES), 0, VW - 1)];
  // Dijkstra from the goal over a grid of what blocks this class, with each step costing the time it takes, so
  // roads and worn tracks are cheaper, and woods and fords dearer. Off the roads the weather's going, wq in
  // twentieths, makes open ground and young tracks dearer, while a hardened track and a road stay firm.
  // What a fill needs of the ground is made once for each class, world, version of the ground and going, and kept
  // for the fills after it, most of which share it: which of each cell's eight steps are open, and what a step
  // into each cell costs before its length. The field comes out the same to the bit as working them out step by
  // step. ver is the version occ and g stand at, or -1 for a scratch fill, which keeps nothing.
  const fillGround = {};
  function groundFor(S, cls, occ, g, ver, wq) {
    let Gd = fillGround[cls];
    if (Gd && ver >= 0 && Gd.S === S && Gd.ver === ver && Gd.wq === wq && Gd.N === N) return Gd;
    if (!Gd || Gd.N !== N) Gd = fillGround[cls] = { N, block: new Uint8Array(N), open: new Uint8Array(N), k: new Float64Array(N) };
    Gd.S = ver >= 0 ? S : null; Gd.ver = ver; Gd.wq = wq;
    const M = S.map, bit = BIT[cls], woodC = cls === 'track' ? 3 : 1.6, roadC = ROAD_COST[cls], offK = 20 / wq, naval = cls === 'naval';
    const block = Gd.block, open = Gd.open, k = Gd.k, road = roadW(M);
    if (naval) { const sea = M.sea; for (let c = 0; c < N; c++) block[c] = !sea[c] || occ[c] !== 0 ? 1 : 0; }
    else for (let c = 0; c < N; c++) block[c] = (g[c] & bit) !== 0 || occ[c] !== 0 ? 1 : 0;
    const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
    for (let y = 0, c = 0; y < H; y++) for (let x = 0; x < W; x++, c++) {
      let o = 0;
      for (let i = 0; i < 8; i++) {
        const nx = x + DX[i], ny = y + DY[i];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || block[ny * W + nx]) continue;
        if ((i & 1) && (block[y * W + nx] || block[ny * W + x])) continue;
        o |= 1 << i;
      }
      open[c] = o;
      // Open water is the same going everywhere, under a bridge's road as well.
      if (naval) k[c] = 1;
      else { const gm = g[c], rw = road[c], lv = (gm >> 5) & 3, off = lv >= 3 ? TRACK_COST[3] : TRACK_COST[lv] * offK, here = rw > 0 ? off + (roadC - off) * rw : off; k[c] = here * (gm & 8 ? woodC : 1) * (gm & 16 ? 2 : 1); }
    }
    return Gd;
  }
  function fill(S, f, cls, gx, gy, occ, g, reach = Infinity, wq = 20, ver = -1) {
    const roadC = ROAD_COST[cls], offK = 20 / wq, naval = cls === 'naval', woodC = cls === 'track' ? 3 : 1.6;
    const Gd = groundFor(S, cls, occ, g, ver, wq), open = Gd.open, k = Gd.k;
    const dist = f.dist, dir = f.dir;
    dist.fill(Infinity); dir.fill(-1);
    // The cells waiting to be settled lie in buckets by distance (Dial's queue). A bucket is narrower than the
    // cheapest step, so no cell can shorten the way to another in its own bucket, and taking each bucket whole, in
    // any order, settles every cell at its true distance. The buckets go round in a ring wide enough for the
    // dearest step. Both bounds come from the costs a step can have: the road's, a hardened track's and open
    // ground's in this weather, and at most woods and a ford on top.
    const tk = TRACK_COST, minK = naval ? 1 : Math.min(roadC, tk[3], tk[0] * offK, tk[1] * offK, tk[2] * offK);
    const maxK = naval ? 1 : Math.max(roadC, tk[3], tk[0] * offK, tk[1] * offK, tk[2] * offK) * Math.max(woodC, 1) * 2;
    const bw = minK * 0.99, inv = 1 / bw;
    let B = 8;
    while (B < Math.ceil(1.42 * maxK * inv) + 2) B <<= 1;
    const mask = B - 1;
    if (qHead.length < B) qHead = new Int32Array(B);
    qHead.fill(-1, 0, B);
    let e = 0, live = 0;
    const seeds = goalCells(S, cls, gx, gy, occ, g);
    for (const c of seeds) { dist[c] = 0; const b = Math.floor(0 * inv) & mask; qC[e] = c; qD[e] = 0; qN[e] = qHead[b]; qHead[b] = e++; live++; }
    // A step's length times the cost of the cell it goes into, rounded to the array's own precision, so a cell is
    // never queued again for the same distance.
    const OFF = [1, W + 1, W, W - 1, -1, -W - 1, -W, -W + 1], COST = [1, 1.41, 1, 1.41, 1, 1.41, 1, 1.41];
    for (let cur = 0; live > 0;) {
      const h = qHead[cur & mask];
      if (h < 0) {
        // Everything left is further than the field needs to reach.
        if (++cur * bw > reach) break;
        continue;
      }
      qHead[cur & mask] = qN[h]; live--;
      const c = qC[h], dc = qD[h];
      if (dc > dist[c] || dc > reach) continue;
      const o = open[c];
      for (let i = 0; i < 8; i++) {
        if ((o & (1 << i)) === 0) continue;
        const m = c + OFF[i], nd = Math.fround(dc + COST[i] * k[m]);
        if (nd < dist[m]) { dist[m] = nd; dir[m] = (i + 4) & 7; const b = Math.floor(nd * inv) & mask; qC[e] = m; qD[e] = nd; qN[e] = qHead[b]; qHead[b] = e++; live++; }
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
    if (far < 16 && lineClear(S, cls, u.x, u.y, tx, ty) && (far < 8 || cls === 'naval' || !waysBetween(S, u.x, u.y, tx, ty))) return [tx, ty];
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
    return lookAhead(S, f, cls, u.x, u.y);
  }
  // The farthest point along a field from a spot that a mover can reach in a straight, clear line. The look ahead
  // stops where a track's going changes, so a way that keeps to a track follows its bends. On a road it keeps
  // within the road's verge and stops where the way leaves it. Off a road it aims two cells along a road it
  // joins, so it merges at a slant.
  function lookAhead(S, f, cls, bx, by) {
    let c = cellOf(bx, by), wx = (c % W) + 0.5, wy = (c / W | 0) + 0.5;
    // A ship passing under a bridge is not on its road.
    const M = S.map, rw = roadW(M), wet = cls === 'naval', lv0 = S.gnd[c] & 96, on0 = !wet && rw[c] > 0.5, lane = on0 ? Math.max(1.2, roadDistAt(M, bx, by)) : 0;
    let joined = -1;
    for (let i = 0; i < 10; i++) {
      const dir = f.dir[c];
      if (dir < 0) break;
      const x = c % W + FDX[dir], y = (c / W | 0) + FDY[dir];
      c = y * W + x;
      const px = x + 0.5, py = y + 0.5, on = !wet && rw[c] > 0.5;
      // The next cell along the field is always taken, so a man on a bend still moves on.
      if (lineClear(S, cls, bx, by, px, py) && (!on0 || !i || laneClear(M, bx, by, px, py, lane))) { wx = px; wy = py; } else break;
      if (!wet && (S.gnd[c] & 96) !== lv0 && !on) break;
      if (on0 && !on) break;
      if (!on0 && on && joined < 0) joined = i;
      if (joined >= 0 && i >= joined + 2) break;
    }
    return [wx, wy];
  }
  // The way a unit would take to a point, as a line of points for the overlay to draw. It only reads the world: a
  // field the world holds is used as it stands, and any other is worked out into a scratch copy kept outside the
  // world, so drawing a route never changes how the game plays.
  const scratch = new Map();
  function peekField(S, cls, gx, gy, need) {
    const key = (cls === 'foot' ? 0 : cls === 'veh' ? 1 : cls === 'track' ? 2 : 3) * N + gy * W + gx, f = S.fields.get(key), p = S._fields.get(key);
    if (f && p && p.ver === f.ver && p.reach === f.reach && f.reach >= need) return p;
    const wq = goingKey(S, cls), sk = `${key}:${S.occVer}:${wq}`;
    let q = scratch.get(sk);
    if (!q || q.reach < need) {
      q = q || { dist: new Float32Array(N), dir: new Int8Array(N), reach: 0 };
      q.reach = Math.fround(need * 1.5 + 32);
      fill(S, q, cls, gx, gy, S.occ, S.gnd, q.reach, wq, S.occVer);
      scratch.set(sk, q);
      if (scratch.size > 16) scratch.delete(scratch.keys().next().value);
    }
    return q;
  }
  function route(S, u, tx, ty, max = 200) {
    const cls = clsOf(u), pts = [[u.x, u.y]];
    let x = u.x, y = u.y;
    for (let i = 0; i < max; i++) {
      const far = mhypot(tx - x, ty - y);
      if (far < 0.6) break;
      if (far < 16 && lineClear(S, cls, x, y, tx, ty) && (far < 8 || cls === 'naval' || !waysBetween(S, x, y, tx, ty))) { pts.push([tx, ty]); break; }
      const q = far > 24, gx = clamp(q ? (tx >> 2) * 4 + 2 : tx | 0, 0, W - 1), gy = clamp(q ? (ty >> 2) * 4 + 2 : ty | 0, 0, H - 1);
      const f = peekField(S, cls, gx, gy, far), c = cellOf(x, y);
      if (f.dist[c] === Infinity || (f.dir[c] < 0 && f.dist[c] !== 0)) break;
      const w = lookAhead(S, f, cls, x, y);
      if (mhypot(w[0] - x, w[1] - y) < 0.05) { if (far < 3) pts.push([tx, ty]); break; }
      pts.push(w); x = w[0]; y = w[1];
    }
    return pts;
  }
  // Whether the straight way between two points stays within `lane` of a road's middle line.
  function laneClear(M, ax, ay, bx, by, lane) {
    const n = Math.ceil(mhypot(bx - ax, by - ay) * 2);
    for (let i = 1; i <= n; i++) { const t = i / n; if (roadDistAt(M, lerp(ax, bx, t), lerp(ay, by, t)) > lane) return false; }
    return true;
  }
  // Whether a road or a worn track lies near the way between two points, so the way is found rather than taken
  // straight.
  function waysBetween(S, ax, ay, bx, by) {
    const rw = roadW(S.map);
    const x0 = Math.max(0, (Math.min(ax, bx) | 0) - 2), x1 = Math.min(W - 1, (Math.max(ax, bx) | 0) + 2);
    const y0 = Math.max(0, (Math.min(ay, by) | 0) - 2), y1 = Math.min(H - 1, (Math.max(ay, by) | 0) + 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = y * W + x; if ((S.gnd[c] & 96) || rw[c] > 0.5) return true; }
    return false;
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
    // A blow reaches to the edge of a unit, not its middle, so a big beast can be struck from all round.
    const w = WEAPONS[wn], d = gap(s.x, s.y, t) - (w.fx === 'melee' && !t.b ? t.d.r : 0);
    const up = (s.b ? terrainAt(S.map, s.x, s.y) : heightAt(S.map, s.x, s.y)) - (t.b ? terrainAt(S.map, t.x, t.y) : heightAt(S.map, t.x, t.y));
    // Height lends reach: a ground unit above its target fires a tenth farther for each unit of height it has over
    // it past the first third, up to a third farther from a hilltop.
    const reach = rangeOf(S, s, wn) * (1 + 0.1 * (isAir(s) ? 0 : clamp(up - 0.3, 0, 3.5))) + slack;
    return d <= reach && (!w.min || d >= w.min);
  }
  function clearShot(S, s, wn, t) {
    const w = WEAPONS[wn];
    if (w.indirect || isAir(s) || isAir(t)) return true;
    return los(S.map, s.x, s.y, groundZ(S, s) + (s.b ? 1 : 0.3), t.x, t.y, groundZ(S, t));
  }
  // Picks what a unit should shoot, threats first, then whatever else is near. A unit holding cover takes only
  // what it can hit from where it stands. Each weapon looks first for what it hurts most, an anti-tank gun for
  // armour and a machine gun for men, and a unit leaves a target its friends near by already have enough fire on
  // to finish, so a group spreads its fire rather than spend it on one man already falling.
  const MATCH_MIN = 0.12, MATCH_MAX = 1.4, OVERKILL_S = 1.5;
  function acquire(S, u, radius, held) {
    let best = null, score = Infinity;
    const list = u.d.weapons || [], cand = [], load = new Map();
    near(S, u.x, u.y, radius, t => {
      // Friends' fire already on each target, in damage a second.
      if (t.team === u.team) {
        if (t !== u && t.hp > 0 && t.tgt && t.d.weapons && t.d.weapons.length) {
          const g = S.byId.get(t.tgt), w = WEAPONS[t.d.weapons[0]];
          if (g && w) load.set(g.id, (load.get(g.id) || 0) + w.dmg * (w.vs[g.d.armor] ?? 1) * (w.salvo || 1) / w.cd);
        }
        return;
      }
      if (t.hp <= 0 || t.drop > 0 || atPeace(S, u.team, t.team)) return;
      const d = gap(u.x, u.y, t);
      if (d > radius) return;
      let usable = false, match = 0;
      for (const wn of list) if (canHit(wn, t) && (!held || inRange(S, u, wn, t))) { usable = true; match = Math.max(match, WEAPONS[wn].vs[t.d.armor] ?? 1); }
      if (!usable || !seenBy(S, u.team, t)) return;
      let s = d;
      if (t.b) s += armed(t) ? 6 : 14;
      else if (!armed(t)) s += 5;
      cand.push([t, s / clamp(match, MATCH_MIN, MATCH_MAX)]);
    });
    for (const [t, s0] of cand) {
      const doomed = (load.get(t.id) || 0) * OVERKILL_S, s = s0 + (doomed >= t.hp ? 8 : 3 * doomed / Math.max(1, t.hp));
      if (s < score) { score = s; best = t; }
    }
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
    dmg *= coverScale(S, t, by);
    t.hp -= dmg;
    if (t.d.men && !t.b && t.hp > 0) shaken(S, t, dmg);
    // Where the harm between sides falls, gathered for the war map's battles.
    if (S.hist && team >= 0 && team !== t.team) { const f = S.hist.fa || (S.hist.fa = [0, 0, 0]); f[0] += t.x * dmg; f[1] += t.y * dmg; f[2] += dmg; }
    t.under = S.tick;
    if (by && !t.b) t.hitBy = by;
    const P = S.P[t.team];
    if (t.b && t.team !== team) {
      ownEvent(S, t.team, 'baseattack'); S.ev.push({ t: 'alert', team: t.team, x: t.x, y: t.y });
      // The raid on the base, so units made while it lasts go to meet it.
      if (P && team >= 0) P.raid = { tick: S.tick, by: by || 0, x: t.x, y: t.y };
    }
    else if (!t.b && t.d.cargo) { ownEvent(S, t.team, 'truckattack'); S.ev.push({ t: 'alert', team: t.team, x: t.x, y: t.y }); }
    // A unit under fire with nothing better to do answers it, and so do its idle neighbours.
    // An idle unit shot at shoots back, if its weapons are any good against what shot it; otherwise it picks its
    // own target as usual, which may well be the same.
    // Men shot at by something they cannot see make for the nearest cover, if there is any close.
    if (!t.b && by && t.d.men && t.cov < 0 && t.st !== 'hold' && (!t.ord || t.ord.ans) && S.byId.get(by) && !seenBy(S, t.team, S.byId.get(by))) {
      const ci = coverNear(S.map, t.x, t.y, 6), cp = ci >= 0 ? coverPoints(S.map)[ci] : null;
      if (cp && !blocked(S, 'foot', cellOf(cp.x, cp.y))) { if (!t.home) t.home = [t.x, t.y]; t.ord = { t: 'move', x: cp.x, y: cp.y, cov: ci, stop: 0.15 }; t.tgt = 0; t.wpT = 0; t.stuck = 0; }
    }
    if (!t.b && by && !t.ord && !t.tgt && armed(t)) {
      const a = S.byId.get(by);
      if (a && (t.d.weapons || []).some(wn => canHit(wn, a) && (WEAPONS[wn].vs[a.d.armor] ?? 1) >= 0.5)) t.tgt = by;
    }
    if (by && team >= 0 && team !== t.team) answer(S, t, by);
    if (team >= 0 && t.team >= 0 && team !== t.team && S.hist) { const k = team * S.P.length + t.team; S.hist.acc[k] = (S.hist.acc[k] || 0) + Math.min(dmg, t.hp + dmg); }
    if (t.hp <= 0) {
      kill(S, t, team);
      const w = worth(t.d);
      if (S.P[team] && team !== t.team) { const s = S.P[team].stats; s[t.b ? 'razed' : 'killed']++; s.killV += w; }
      P.stats[t.b ? 'blost' : 'lost']++; P.stats.lostV += w;
      reward(S, by, t);
    }
  }

  // Answering fire. When a unit or a building is hit, every idle armed unit of its side within ANS_R of it goes
  // for whoever hit it, chases it up to ANS_LEASH from where it stood, and then goes back there. A unit given
  // an order, a squad holding cover, and one already fighting a unit keep to what they are doing. A unit that
  // gives up a chase answers nothing more for a while, so a gun out of its reach does not draw it back and forth.
  // Falling back. A unit told to fall back when hurt, once below FB_AT of its health, leaves the fight for the
  // nearest support vehicle of its side, or else the nearest headquarters, forward base, barracks or factory, and
  // mends there until whole. It then waits there for orders.
  const FB_AT = 0.25, FB_NEAR = 6;
  function fallBack(S, u) {
    // Sent off elsewhere since, and gone from its haven, it may fall back again.
    if (u.mend && !(u.ord && u.ord.t === 'move' && u.ord.x === u.mend.at[0] && u.ord.y === u.mend.at[1]) && mhypot(u.x - u.mend.at[0], u.y - u.mend.at[1]) > FB_NEAR + 2) u.mend = null;
    if (!u.fb || u.brk || u.hp >= u.max * FB_AT || u.mend || u.d.cargo || isAir(u)) return;
    let best = null, bd = Infinity;
    for (const e of S.ents) {
      if (e.team !== u.team || e.hp <= 0 || e === u) continue;
      const ok = e.b ? (e.kind === 'hq' || e.kind === 'fob' || e.kind === 'barracks' || e.kind === 'factory') : !!e.d.repair;
      if (!ok) continue;
      const dd = mhypot(e.x - u.x, e.y - u.y) - (e.b ? 0 : 4);
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best) return;
    // The place beside it on the side the unit comes from.
    const dx = u.x - best.x, dy = u.y - best.y, m = mhypot(dx, dy) || 1, off = best.b ? Math.max(best.w, best.h) / 2 + 2.5 : 2;
    const x = clamp(best.x + dx / m * off, 1, W - 1), y = clamp(best.y + dy / m * off, 1, H - 1);
    u.mend = { at: [x, y] };
    u.ord = { t: 'move', x, y }; u.tgt = 0; u.home = null; u.wpT = 0; u.stuck = 0;
    S.ev.push({ t: 'fallback', team: u.team, id: u.id, x: u.x, y: u.y });
  }
  // Exploring. A scout told to explore roams by itself: to the block of the map its side has seen least, never
  // seen before all, nearer ones first, keeping clear of the enemy defences its side has found. It makes only for
  // land it can get to, never the middle of a lake or an island it cannot reach, and counts what lies beyond its
  // reach at less than its own ground, as only a look from the shore. A block it has reached, or set out for and
  // stopped short of, is passed over for a while after. Shot at, it runs a dozen cells from whatever shot it, waits
  // a little, and goes on exploring.
  const EXP_B = 8, EXP_SAFE = 14;
  // The stretches of land a kind of mover can cross, each open cell numbered by the stretch it lies in, from the
  // ground alone. Made again when the ground changes.
  function landOf(S, cls) {
    const L = S._land || (S._land = {});
    if (L[cls] && L[cls].ver === S.gndVer) return L[cls].id;
    const none = L.none || (L.none = new Uint8Array(N)), id = new Int32Array(N).fill(-1);
    let n = 0;
    for (let c = 0; c < N; c++) if (id[c] < 0 && !blocked(S, cls, c, none)) {
      const st = [c]; id[c] = n;
      while (st.length) {
        const v = st.pop(), x = v % W, y = v / W | 0;
        for (const [dx, dy] of D8) {
          const nx = x + dx, ny = y + dy, w = ny * W + nx;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && id[w] < 0 && !blocked(S, cls, w, none)) { id[w] = n; st.push(w); }
        }
      }
      n++;
    }
    L[cls] = { ver: S.gndVer, id };
    return id;
  }
  const canExplore = u => u.d.line === 'rec';
  function exploreTick(S, u) {
    if (!u.exp) return;
    const P = S.P[u.team], o = u.ord;
    if (u.under && S.tick - u.under < 2 * HZ && u.hitBy && !(o && o.flee)) {
      const a = S.byId.get(u.hitBy);
      if (a) {
        const dx = u.x - a.x, dy = u.y - a.y, m = mhypot(dx, dy) || 1;
        u.ord = { t: 'move', x: clamp(u.x + dx / m * 12, 1, W - 1), y: clamp(u.y + dy / m * 12, 1, H - 1), exp: true, flee: true }; u.tgt = 0; u.wpT = 0; u.stuck = 0;
        u.expWait = S.tick + 6 * HZ;
        return;
      }
    }
    if (S.tick < (u.expWait || 0)) return;
    // Going somewhere still unseen, it carries on.
    if (o && o.exp && !o.flee && !P.vis[cellOf(o.x, o.y)]) return;
    if (o && !o.exp) return;
    // A block it set out for, reached or not, is passed over for its next two dozen choices.
    if (!o && u.expTo) { (u.expSkip || (u.expSkip = [])).push(u.expTo[2]); if (u.expSkip.length > 24) u.expSkip.shift(); }
    u.expTo = null;
    const danger = [];
    for (const e of S.ents) if (e.b && e.team !== u.team && e.hp > 0 && armOf(S, e) && P.seen[cellOf(e.x, e.y)]) danger.push(e);
    const nb = Math.ceil(W / EXP_B), land = landOf(S, clsOf(u));
    // The stretch of land the scout stands on, or the nearest it can step onto.
    let mine = land[cellOf(u.x, u.y)];
    for (let r = 1; mine < 0 && r <= 2; r++) for (const [dx, dy] of D8) if (mine < 0) mine = land[cellOf(clamp(u.x + dx * r, 0, W - 1), clamp(u.y + dy * r, 0, H - 1))];
    let best = null, top = 0;
    for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
      const cx = (bx + 0.5) * EXP_B, cy = (by + 0.5) * EXP_B;
      const bi = by * nb + bx;
      if (cx >= W || cy >= H || (u.expSkip && u.expSkip.includes(bi)) || danger.some(e => mhypot(e.x - cx, e.y - cy) < EXP_SAFE)) continue;
      // Its unseen ground, what the scout can reach counted whole and the rest at a third, and the reachable open
      // cell nearest its middle to make for.
      let never = 0, dark = 0, open = 0, goal = -1, gd = Infinity;
      for (let y = by * EXP_B; y < Math.min(H, (by + 1) * EXP_B); y += 2) for (let x = bx * EXP_B; x < Math.min(W, (bx + 1) * EXP_B); x += 2) {
        const c = y * W + x, mineC = land[c] === mine && !blocked(S, clsOf(u), c), k = mineC ? 1 : 1 / 3;
        if (mineC) { open++; const dd = mhypot(x + 0.5 - cx, y + 0.5 - cy); if (dd < gd) { gd = dd; goal = c; } }
        if (!P.seen[c]) never += k; else if (!P.vis[c]) dark += k;
      }
      if (open < 4) continue;
      const sc = (never * 3 + dark) / (1 + mhypot(cx - u.x, cy - u.y) / 30);
      if (sc > top) { top = sc; best = [goal % W + 0.5, (goal / W | 0) + 0.5, bi]; }
    }
    if (!best) { u.ord = null; return; }
    u.expTo = best;
    u.ord = { t: 'move', x: best[0], y: best[1], exp: true }; u.wpT = 0; u.stuck = 0; u.home = null;
  }
  // Scattering. Shells from guns firing over the hills, a barrage, a bomb or a missile give a moment's warning:
  // units on the ground where one will land run clear of where it falls, and a unit standing its post goes back
  // after. Holding ground holds through it.
  const SCAT_EVERY = 5;
  function dangerOf(S) {
    const out = [];
    for (const s of S.shots) {
      const w = WEAPONS[s.w], left = s.dur - s.t;
      if (left < 0.25) continue;
      if (s.kind === 'nuke') out.push({ x: s.tx, y: s.ty, r: 10, team: s.team });
      else if (s.kind === 'barrage') out.push({ x: s.tx, y: s.ty, r: 4, team: s.team });
      else if (s.kind === 'bomb') out.push({ x: s.tx, y: s.ty, r: (s.splash || 1.5) + 1.2, team: s.team });
      else if (w && w.indirect) out.push({ x: s.tx, y: s.ty, r: (w.splash || 1) + 1.5, team: s.team });
    }
    return out;
  }
  function scatter(S, u, danger) {
    if (u.b || isAir(u) || u.st === 'hold' || (u.ord && !u.ord.ans && !u.ord.scat && u.ord.t !== 'amove')) return;
    // Already running for a place clear of them all, it keeps on.
    if (u.ord && u.ord.scat && danger.every(z => mhypot(u.ord.x - z.x, u.ord.y - z.y) >= z.r)) return;
    // The shells falling about it, near or on it, and the way out of them all: away from their middle, then the
    // first of a fan of ways round that clears every one.
    const near = danger.filter(z => z.team !== u.team && !atPeace(S, u.team, z.team) && mhypot(u.x - z.x, u.y - z.y) < z.r + 2);
    if (!near.some(z => mhypot(u.x - z.x, u.y - z.y) < z.r)) return;
    let mx = 0, my = 0, rr = 0;
    for (const z of near) { mx += z.x; my += z.y; rr = Math.max(rr, z.r); }
    mx /= near.length; my /= near.length;
    const a0 = mhypot(u.x - mx, u.y - my) > 0.2 ? matan2(u.y - my, u.x - mx) : (u.id * 2.39996) % TAU;
    let gx = 0, gy = 0, found = false;
    for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, PI]) for (const go of [rr + 1.5, rr + 4]) {
      const x = u.x + mcos(a0 + da) * go, y = u.y + msin(a0 + da) * go;
      if (!found && danger.every(z => z.team === u.team || mhypot(x - z.x, y - z.y) >= z.r + 0.5)) { gx = x; gy = y; found = true; }
    }
    if (!found) { gx = u.x + mcos(a0) * (rr + 4); gy = u.y + msin(a0) * (rr + 4); }
    const c = goalCells(S, clsOf(u), clamp(gx | 0, 0, W - 1), clamp(gy | 0, 0, H - 1))[0];
    if (!u.home && !u.ord) u.home = [u.x, u.y];
    u.ord = { t: 'move', x: c % W + 0.5, y: (c / W | 0) + 0.5, scat: true }; u.tgt = 0; u.wpT = 0; u.stuck = 0;
  }
  // Morale. Men under fire are shaken: their suppression rises with the harm done to them, and falls again when
  // the fire stops. Above PIN they are pinned, moving and firing slower; a squad shaken through and down to half its
  // men breaks and runs for the nearest building of its side, deaf to orders, until it rallies. Cover, a formation of
  // friends about them and a hero or general near steady them, as does a veteran's nerve, and a squad told to hold
  // its ground never breaks.
  const PIN = 0.5, BREAK = 0.85, BREAK_HP = 0.5, BREAK_S = 8, RALLY_R = 8;
  function steadiness(S, u) {
    let k = 1 - 0.15 * (u.vet || 0);
    if (u.cov >= 0) k *= 0.5;
    let friends = 0, leader = false;
    near(S, u.x, u.y, RALLY_R, o => {
      if (o === u || o.team !== u.team || o.hp <= 0 || o.b) return;
      const d = mhypot(o.x - u.x, o.y - u.y);
      if ((o.d.hero || o.d.general) && d < RALLY_R) leader = true;
      else if (o.d.men && d < 4) friends++;
    });
    if (u.form && u.form !== 'loose' && friends >= 2) k *= 0.75;
    if (leader) k *= 0.5;
    return { k, leader };
  }
  function shaken(S, u, dmg) {
    const { k, leader } = steadiness(S, u);
    u.sup = Math.min(1, (u.sup || 0) + (dmg / u.max * 3 + 0.04) * k);
    if (u.brk || leader || u.st === 'hold' || u.d.hero || u.d.general) return;
    if (u.sup >= BREAK && u.hp < u.max * BREAK_HP) {
      let best = null, bd = Infinity;
      for (const e of S.ents) if (e.b && e.team === u.team && e.hp > 0) { const dd = mhypot(e.x - u.x, e.y - u.y); if (dd < bd) { bd = dd; best = e; } }
      const to = best ? [best.x + (u.x > best.x ? 1 : -1) * (best.w / 2 + 2), best.y + (u.y > best.y ? 1 : -1) * (best.h / 2 + 2)] : S.bases[u.team];
      u.brk = S.tick + BREAK_S * HZ;
      u.ord = { t: 'move', x: clamp(to[0], 1, W - 1), y: clamp(to[1], 1, H - 1), brk: true }; u.tgt = 0; u.home = null; u.wpT = 0; u.stuck = 0; u.exp = false; u.mend = null;
      S.ev.push({ t: 'broke', team: u.team, id: u.id, x: u.x, y: u.y });
    }
  }
  // A second's calm: suppression wears off, faster in cover, and a broken squad that has run its time rallies.
  function steady(S, u) {
    if (u.sup) { u.sup = Math.max(0, u.sup - (u.cov >= 0 ? 0.2 : 0.12)); if (u.sup < 0.01) u.sup = 0; }
    if (u.brk && S.tick >= u.brk && (u.sup || 0) < PIN) { u.brk = 0; if (u.ord && u.ord.brk) u.ord = null; u.v = 0; S.ev.push({ t: 'rallied', team: u.team, id: u.id, x: u.x, y: u.y }); }
  }
  const pinned = u => (u.sup || 0) >= PIN;
  // A general steadies the men near him, above, and quickens the fire of every unit of his side within GEN_R.
  const GEN_R = 9, GEN_FIRE = 0.85;
  function nearGeneral(S, u) {
    let f = false;
    near(S, u.x, u.y, GEN_R, o => { if (!f && o !== u && o.team === u.team && o.hp > 0 && o.d.general && mhypot(o.x - u.x, o.y - u.y) < GEN_R) f = true; });
    return f;
  }
  const ANS_R = 10, ANS_LEASH = 18;
  function answer(S, t, by) {
    if (S.tick - (t.ansT ?? -1e9) < HZ) return;
    const a = S.byId.get(by);
    if (!a || a.hp <= 0 || a.team === t.team || a.drop > 0) return;
    t.ansT = S.tick;
    near(S, t.x, t.y, ANS_R, o => {
      // A squad in cover holds it, unless it is aggressive or hunting.
      if (o.b || o.team !== t.team || o.hp <= 0 || o.drop > 0 || o.ord || o.brk || (o.cov >= 0 && !o.st) || (o.cov >= 0 && o.st === 'def') || o.st === 'hold' || S.tick < (o.calm || 0)) return;
      if (!armed(o) || o.d.cargo || o.d.engineer || o.d.move === 'jet' || mhypot(o.x - t.x, o.y - t.y) > ANS_R) return;
      const c = o.tgt && S.byId.get(o.tgt);
      if (c && c.hp > 0 && !c.b) return;
      if (!o.d.weapons.some(wn => canHit(wn, a))) return;
      o.home = o.home || [o.x, o.y];
      o.ord = { t: 'attack', id: a.id, ans: true }; o.tgt = a.id; o.wpT = 0; o.stuck = 0;
    });
  }

  // Sheltering. The general walks into his side's capitol and is kept on it, out of the world, until let out. A
  // capitol that falls or is taken throws him out at its door.
  function shelterGo(S, u, o) {
    const b = S.byId.get(o.id);
    if (!b || b.hp <= 0 || b.team !== u.team || !b.d.civic || b.held) { u.ord = null; u.v = 0; return; }
    if (drive(S, u, b.x, b.y, 0.1) || gap(u.x, u.y, b) < 1.1) {
      b.held = plain(u);
      b.held.ord = null; b.held.tgt = 0; b.held.oq = null; b.held.v = 0;
      u.hp = 0;
      S.ev.push({ t: 'enter', id: u.id, into: b.id, team: u.team, x: b.x, y: b.y });
      ownEvent(S, u.team, 'sheltered');
    }
  }
  function release(S, b) {
    const u = Object.assign(b.held, { d: UNITS[b.held.kind] }), [x, y] = exitOf(S, b);
    b.held = null;
    Object.assign(u, { x, y, px: x, py: y, lx: x, ly: y, wx: x, wy: y, ord: null, tgt: 0, v: 0, home: null, stuck: 0 });
    S.ents.push(u); S.byId.set(u.id, u);
    S.ev.push({ t: 'leave', id: u.id, from: b.id, team: u.team, x, y });
    return u;
  }

  function kill(S, t, team) {
    t.hp = 0;
    if (t.held) release(S, t);
    if (t.d.recon) ownEvent(S, t.team, 'reconlost');
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

  // How wet a point is: snow over the whole map, and rain or snow from a cloud over it.
  function wetAt(S, x, y) {
    const w = sky(S);
    if (!showersAt(S).length) return Math.min(1, w.snow);
    const sh = showerAt(S, x, y);
    return Math.min(1, w.snow + sh.rain + sh.snow);
  }
  // Fire in the woods. A blast among standing trees may light them, and fire spreads from tree to tree, more
  // with the wind and not at all in rain or snow, then leaves the ground burnt and open.
  function ignite(S, x, y, r, p) {
    p *= 1 - 0.8 * wetAt(S, x, y);
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
  // Lightning. In a storm it strikes under one of the storm's clouds every few seconds, and under heavy cloud with
  // no rain, on the steppe and the salt flats, now and then anywhere: dry lightning. Of three places drawn for each
  // strike it takes the highest, a tree counting a unit higher, and a standing tree it hits catches fire. In a
  // storm's rain the fire soon dies; dry lightning can burn a wood down. Strikes come of the seed and the time, not
  // the world's dice.
  const STRIKE_STORM = 0.22, STRIKE_DRY = 0.006;
  function stepLightning(S) {
    const w = sky(S), dry = S.theatre !== 'winter' && w.cloud > 0.6 && w.rain < 0.05 && w.snow < 0.05 ? STRIKE_DRY : 0;
    const p = w.storm > 0.5 ? STRIKE_STORM * w.storm : dry;
    if (!p) return;
    const h = spellHash(S.seed + 5003, S.tick);
    if ((h % 10000) / 10000 >= p) return;
    const under = dry ? [] : showersAt(S).filter(s => s.storm > 0.3);
    if (!dry && !under.length) return;
    let best = null, bz = -1e9;
    for (let k = 0; k < 3; k++) {
      const hk = spellHash(S.seed + 6007 + k * 31, S.tick);
      let x = 1 + (hk % 10007) / 10007 * (W - 2), y = 1 + ((hk >>> 14) % 10007) / 10007 * (H - 2);
      if (!dry) {
        const s = under[(hk >>> 3) % under.length], a = (hk % 6283) / 1000, d = s.r * 0.8 * Math.sqrt(((hk >>> 14) % 10007) / 10007);
        x = clamp(s.x + mcos(a) * d, 1, W - 1); y = clamp(s.y + msin(a) * d, 1, H - 1);
      }
      const c = cellOf(x, y), z = terrainAt(S.map, x, y) + ((S.gnd[c] & 8) && !S.wood[c] ? 1 : 0);
      if (z > bz) { bz = z; best = [x, y, c]; }
    }
    const [x, y, c] = best, tree = (S.gnd[c] & 8) && !S.wood[c];
    if (tree) kindle(S, c);
    S.ev.push({ t: 'strike', x, y, fire: tree, dry: !!dry });
  }
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  function stepFire(S) {
    if (!S.burn.length) return;
    const w = sky(S), out = [];
    for (let i = S.burn.length - 1; i >= 0; i--) {
      const b = S.burn[i], c = b[0], x = c % W, y = c / W | 0, wet = wetAt(S, x + 0.5, y + 0.5), spread = 0.06 * (1 - wet);
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
    // A shot gives the shooter away to the side it fired on, for a few seconds.
    if (t.team !== undefined && t.team >= 0 && t.team !== s.team) { s.firedOn = t.team; s.firedUntil = S.tick + 4 * HZ; }
    const br = t.br, z0 = groundZ(S, s) + (s.b ? 1 : 0.1), z1 = br !== undefined ? t.z : groundZ(S, t);
    const shot = { w: wn, team: s.team, by: s.id, x: s.x, y: s.y, z: z0, tx: t.x, ty: t.y, tz: z1, t: 0, dur: 0, tgt: t.id, dmg };
    if (br !== undefined) shot.br = br;
    if (w.spread) {
      shot.tx += (S.rand() - 0.5) * w.spread * 2; shot.ty += (S.rand() - 0.5) * w.spread * 2;
      shot.tz = terrainAt(S.map, shot.tx, shot.ty); shot.tgt = 0;
    }
    // Shot, beams, pulses and blows land at once; the rest fly.
    if (w.fx === 'bullet' || w.fx === 'tracer' || w.fx === 'beam' || w.fx === 'pulse' || w.fx === 'melee') {
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
      u.cd[i] = w.cd * (u.b && S.P[u.team].low ? 2 : 1) * (pinned(u) ? 1.6 : 1) * (!u.b && nearGeneral(S, u) ? GEN_FIRE : 1);
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
      if (o === u || o.b || o.drop > 0 || isAir(o) !== isAir(u) || (o.d.move === 'naval') !== (d.move === 'naval')) return;
      const ox = u.x - o.x, oy = u.y - o.y, gapD = mhypot(ox, oy) || 0.01, reach = u.d.r + o.d.r + 0.25;
      if (gapD < reach) { const k = (reach - gapD) / reach; sx += ox / gapD * k; sy += oy / gapD * k; }
    });
    // On a road a unit keeps to the carriageway when its way runs on along it. Neighbours push it along the road
    // rather than off it, and it drifts back toward the middle line, so a group marches as a column.
    const rd0 = roadDistAt(S.map, u.x, u.y), naval = d.move === 'naval';
    if (!naval && rd0 < 1.6 && roadDistAt(S.map, wx, wy) < 1.3) {
      const gx = roadDistAt(S.map, u.x + 0.5, u.y) - roadDistAt(S.map, u.x - 0.5, u.y), gy = roadDistAt(S.map, u.x, u.y + 0.5) - roadDistAt(S.map, u.x, u.y - 0.5), gm = mhypot(gx, gy);
      if (gm > 1e-3) {
        const nx = gx / gm, ny = gy / gm, across = sx * nx + sy * ny, pull = Math.max(0, rd0 - 0.35) * 0.5;
        sx -= nx * (across * 0.75 + pull); sy -= ny * (across * 0.75 + pull);
      }
    }
    dx += sx * 1.6; dy += sy * 1.6;
    const mag = mhypot(dx, dy) || 1;
    dx /= mag; dy /= mag;
    const rk = naval ? 0 : 1 - smooth(0.9, 1.6, roadDistAt(S.map, u.x, u.y)), here = naval ? 0 : S.gnd[cellOf(u.x, u.y)], w = sky(S);
    // Mud after rain bogs wheels down off the roads, snow slows everyone, and woods and fords slow what is in them.
    // A worn track is quicker going, and a hardened one is as firm as a road in the wet. The road's own going
    // fades out across its verge.
    const tl = (here >> 5) & 3;
    let going = (tl >= 3 ? 1 : offGoing(d.move, w)) * TRACK_GO[tl];
    if (rk > 0) going = lerp(going, ROAD_GO[d.move], rk);
    // Under a shower or a rain cloud: mud off the roads and worn tracks for wheels in rain, slow going for all in
    // snow, and in a storm heavy going for tracks off the roads and a heavy sea for ships.
    if (S._sh ? S._sh.list.length : showersAt(S).length) {
      const sh = showerAt(S, u.x, u.y), mud = tl >= 3 ? 0 : 1 - rk;
      if (sh.rain || sh.snow || sh.storm) going *= 1 - (d.move === 'wheel' ? 0.24 * sh.rain * mud + 0.2 * sh.snow : d.move === 'track' ? 0.12 * sh.storm * mud + 0.1 * sh.snow : d.move === 'naval' ? 0.3 * sh.storm : 0.18 * sh.snow);
    }
    // Under a dust storm's dust: blown sand off the roads slows wheels most, men less and tracks least.
    if (!naval && dustWall(S)) { const du = dustAt(S, u.x, u.y); if (du) going *= 1 - (d.move === 'wheel' ? 0.25 : d.move === 'track' ? 0.1 : 0.2) * du * (1 - rk); }
    if (here & 16) going *= 0.5;
    // Pinned men crawl.
    if (d.men && pinned(u) && !u.brk) going *= 0.45;
    if ((here & 8) && d.move === 'foot') going *= 0.75;
    const top = (u.ord && u.ord.pace ? Math.min(d.speed, u.ord.pace) : d.speed) * speedScale * going;
    const want = matan2(dy, dx), diff = angleTo(u.a, want);
    if (d.move === 'foot') {
      u.a += clamp(diff, -6 * DT * 2, 6 * DT * 2);
      u.v = top;
    } else {
      const turn = d.move === 'track' ? 2.4 : d.move === 'naval' ? 1.5 : 2.9;
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
    const cNow = cellOf(u.x, u.y);
    if (d.move === 'track' && (S.gnd[cNow] & 8) && S.wood[cNow] !== 2) { S.crush.push(cNow); u.v *= 0.55; }
    // Whatever moves into a cell off the roads wears it.
    if (cNow !== u.lc) {
      u.lc = cNow;
      if (WEAR[d.move] && S.map.roadDist[((u.y | 0) * RES) * VW + (u.x | 0) * RES] >= 2) S.trail[cNow] = Math.min(255, S.trail[cNow] + WEAR[d.move]);
    }
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
  // The ore nearest a spot, in the field nearest it. Cells in taken are passed over while any other is free, and with
  // clear, cells within two of a building, which a truck cannot reach without rubbing on its corner.
  const nearBuilding = (S, c) => {
    const x = c % W, y = (c - x) / W;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && S.occ[ny * W + nx]) return true;
    }
    return false;
  };
  // The field is the one nearest (fx, fy), the spot itself unless given.
  function nearestOre(S, x, y, team, taken = null, clear = false, fx = x, fy = y) {
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
      const d = mhypot(f.x - fx, f.y - fy);
      if (d < fd) { fd = d; fieldBest = f; }
    }
    const ax = fieldBest ? fieldBest.x : x, ay = fieldBest ? fieldBest.y : y, R = fieldBest ? fieldBest.r + 3 : 18;
    for (let cy = Math.max(1, ay - R | 0); cy <= Math.min(H - 2, ay + R | 0); cy++) for (let cx = Math.max(1, ax - R | 0); cx <= Math.min(W - 2, ax + R | 0); cx++) {
      const c = cy * W + cx;
      if (!S.ore[c] || S.occ[c] || (S.gnd[c] & 9) || (taken && taken.has(c))) continue;
      const d = mhypot(cx + 0.5 - x, cy + 0.5 - y);
      if (d < bd && !(clear && nearBuilding(S, c))) { bd = d; best = c; }
    }
    return best < 0 && (taken || clear) ? nearestOre(S, x, y, team, null, false, fx, fy) : best;
  }
  // The smelter a truck works for: the one it was sent to, or else the side's smelter with the fewest trucks working
  // for it, the nearest of those, kept until it falls.
  function smelterOf(S, u) {
    const o = u.ord, r = o.sm ? S.byId.get(o.sm) : null;
    if (r && r.hp > 0 && r.team === u.team && r.kind === 'refinery') return r;
    const n = new Map();
    for (const e of S.ents) if (!e.b && e !== u && e.team === u.team && e.hp > 0 && e.ord && e.ord.t === 'harvest' && e.ord.sm) n.set(e.ord.sm, (n.get(e.ord.sm) || 0) + 1);
    let best = null, bn = Infinity, bd = Infinity;
    for (const e of S.ents) if (e.b && e.team === u.team && e.kind === 'refinery' && e.hp > 0) {
      const k = n.get(e.id) || 0, d = mhypot(e.x - u.x, e.y - u.y);
      if (k < bn || (k === bn && d < bd)) { bn = k; bd = d; best = e; }
    }
    o.sm = best ? best.id : 0;
    return best;
  }

  function truckTick(S, u) {
    const o = u.ord, cap = capOf(S, u);
    if (o.phase === 'unload') {
      const r = S.byId.get(o.ref);
      if (!r || r.hp <= 0) { o.phase = null; return; }
      const take = Math.min(u.cargo, cap / (3 * HZ)), worth = u.cargo > 0 ? (u.cargoV ?? u.cargo) * take / u.cargo : 0;
      u.cargo -= take; u.cargoV = (u.cargoV ?? u.cargo + take) - worth;
      const P = S.P[u.team], got = worth * P.income;
      P.supply += got; P.stats.mined += got;
      if (u.cargo <= 0.1) { u.cargo = 0; u.cargoV = 0; o.phase = null; r.dockedBy = 0; }
      return;
    }
    if (u.cargo >= cap - 0.5 || (o.phase === 'return')) {
      const r = o.own ? nearestRefinery(S, u) : smelterOf(S, u);
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
      // A truck sent to a field by hand digs on near where it is. Else, setting out empty, it takes the ore nearest
      // its smelter's dock that no other truck of its side is digging, and part loaded it digs on beside where it
      // stands, so each trip starts close to home and a load is dug without running back and forth.
      const sm = o.own ? null : smelterOf(S, u), taken = new Set();
      if (sm) for (const e of S.ents) if (e !== u && !e.b && e.team === u.team && e.hp > 0 && e.ord && e.ord.t === 'harvest' && e.ord.cell >= 0) taken.add(e.ord.cell);
      const [dx, dy] = sm ? exitOf(S, sm) : [u.x, u.y];
      o.cell = !sm ? nearestOre(S, u.x, u.y, u.team) : u.cargo < 1 ? nearestOre(S, dx, dy, u.team, taken, true) : nearestOre(S, u.x, u.y, u.team, taken);
      o.next = S.tick + 10;
      if (o.cell < 0) { if (u.cargo > 0) o.phase = 'return'; return; }
    }
    const tx = o.cell % W + 0.5, ty = (o.cell / W | 0) + 0.5;
    if (drive(S, u, tx, ty, 0.9, 1)) {
      const K = ORE_KINDS[S.map.oreKind[o.cell]], rate = cap / (16 * HZ) * K.dig, take = Math.min(rate, S.ore[o.cell], cap - u.cargo);
      S.ore[o.cell] = Math.max(0, S.ore[o.cell] - Math.max(1, Math.round(take * 0.6)));
      u.cargoV = (u.cargoV ?? u.cargo) + take * K.worth;
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
    // A storm calls every run off, and a dust storm a run from under its dust or into it.
    if (u.ord && u.ord.t === 'attack' && (groundedAt(S, u.x, u.y) || groundedAt(S, u.ord.x, u.ord.y))) u.ord = null;
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

  // A recon aircraft: in to its circle, round it while its time lasts, then away home and gone past the edge of
  // what it can see, without a fall, as it was never shot down.
  const RECON_R = 9, RECON_IN = 30;
  function reconTick(S, u) {
    const d = u.d;
    u.z = d.alt + msin(S.tick * 0.05 + u.id) * 0.15;
    if (u.life > 0) {
      u.life -= DT;
      const dx = u.x - u.ox, dy = u.y - u.oy, r = mhypot(dx, dy);
      // Along the circle, leaning in when outside it and out when inside.
      if (r > RECON_R + 3) flyTo(S, u, u.ox + dx / r * RECON_R, u.oy + dy / r * RECON_R, 0.5);
      else { const h = matan2(dy, dx) + PI / 2 + clamp((r - RECON_R) * 0.2, -0.9, 0.9); flyTo(S, u, u.x + mcos(h) * 5, u.y + msin(h) * 5, 0.1); }
      return;
    }
    const b = S.bases[u.team];
    u.away = (u.away || 0) + DT;
    flyTo(S, u, b[0], b[1], 1);
    if (u.away > 6 || mhypot(u.x - b[0], u.y - b[1]) < 3) u.hp = 0;
  }
  function airTick(S, u) {
    const d = u.d, o = u.ord;
    if (d.recon) return reconTick(S, u);
    // In a storm, or under a dust storm's dust, helicopters and drones go home and set down, and a drone's flying
    // time stands still.
    if (groundedAt(S, u.x, u.y)) {
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
    // When a unit's order is done, or it is only answering fire, it takes the next it was given with Shift.
    if ((!u.ord || u.ord.ans) && u.oq && u.oq.length) nextQueued(S, u);
    if (d.move === 'jet') return jetTick(S, u);
    if (d.move === 'air') return airTick(S, u);
    // A squad that has stopped by a cover point holds it. On the move it has none.
    if (d.men) u.cov = u.v === 0 ? coverNear(S.map, u.x, u.y, COVER_R) : -1;

    // Veterans mend slowly, and a Support Truck mends anyone close.
    if (u.vet >= 2 && u.hp < u.max) u.hp = Math.min(u.max, u.hp + u.max * 0.002);
    if (S.tick % HZ === u.id % HZ) {
      if (d.men) steady(S, u);
      fallBack(S, u);
      exploreTick(S, u);
      const c = cellOf(u.x, u.y), foreign = S.terr[c] >= 0 && S.terr[c] !== u.team;
      let helped = false;
      near(S, u.x, u.y, 8, o => {
        if (o.team === u.team && o.d.repair && o.hp > 0 && mhypot(o.x - u.x, o.y - u.y) < 8) helped = true;
      });
      if (helped) u.hp = Math.min(u.max, u.hp + u.max * 0.03);
      // Back at a haven it fell back to, a unit mends until whole.
      else if (u.mend && u.mend.at && mhypot(u.x - u.mend.at[0], u.y - u.mend.at[1]) < FB_NEAR) { u.hp = Math.min(u.max, u.hp + u.max * 0.015); if (u.hp >= u.max) u.mend = null; }
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
    // A caravan with nothing else to do trades, and a fishing boat fishes.
    if (d.trade && (!u.ord || u.ord.t === 'trade')) { tradeTick(S, u); return; }
    if (d.fish && (!u.ord || u.ord.t === 'fish')) { fishTick(S, u); return; }
    if (u.ord && u.ord.t === 'bridge') return bridgeGo(S, u, u.ord);
    if (u.ord && u.ord.t === 'mend') return mendGo(S, u, u.ord);
    if (u.ord && u.ord.t === 'shelter') return shelterGo(S, u, u.ord);

    let o = u.ord;

    let t = u.tgt ? S.byId.get(u.tgt) : null;
    if (t && (t.hp <= 0 || atPeace(S, u.team, t.team) || (!seenBy(S, u.team, t) && !(o && (o.t === 'attack' || o.t === 'group'))))) { t = null; u.tgt = 0; }

    if (u.brk && t) { t = null; u.tgt = 0; }
    const free = (!o || o.t === 'amove' || o.t === 'capture') && !u.brk, st = u.st || 'def';
    if (armed(u) && free && !t && S.tick % 10 === u.id % 10) {
      const f = acquire(S, u, d.sight, (!o && u.cov >= 0 && st === 'def') || st === 'hold');
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
      // An engineer sent to mend unasked turns to the next hurt building if its own is made whole first.
      if (o.fix && t && t.hp >= t.max) { t = fixFor(S, u); if (t) o.id = t.id; }
      // A unit answering fire gives up a chase past its leash and goes home.
      if (o.ans && st === 'def' && u.home && mhypot(u.x - u.home[0], u.y - u.home[1]) > ANS_LEASH) { t = null; u.calm = S.tick + 8 * HZ; }
      // A unit on any other stance chases with no leash, but not into the dark.
      if (o.ans && st !== 'def' && t && !seenBy(S, u.team, t)) t = null;
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
        // A defensive squad in cover holds it, and so does a unit holding its ground. A defensive unit chases a
        // little, then goes back to where it stood, and an aggressive one or a hunter chases as far as it takes.
        const h = u.home || [u.x, u.y];
        if ((u.cov >= 0 && st === 'def') || st === 'hold') { u.tgt = 0; t = null; u.v = 0; }
        else if (st !== 'def' || mhypot(u.x - h[0], u.y - h[1]) < 9) drive(S, u, t.x, t.y, Math.max(WEAPONS[d.weapons[0]].r * 0.85, 1));
        else { u.tgt = 0; t = null; }
      } else if (!t && u.home && st === 'def') {
        if (drive(S, u, u.home[0], u.home[1], 0.6)) u.home = null;
      } else {
        u.v = 0;
        if (st !== 'def') u.home = null;
        if (st === 'hunt' && armed(u) && S.tick % (2 * HZ) === u.id % (2 * HZ)) seek(S, u);
      }
      return;
    }

    if (o.t === 'guard') return guardGo(S, u, o, t, shoot);

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
    if (drive(S, u, sx, sy, o.stop ?? 0.4)) {
      // A squad sent to a cover point settles on it and faces out.
      if (o.cov >= 0 && mhypot(u.x - sx, u.y - sy) < 0.5) { u.x = sx; u.y = sy; u.a = coverPoints(S.map)[o.cov].dir; u.cov = o.cov; }
      u.ord = null; u.tgt = 0; u.home = null;
    }
  }

  // Guarding. A guard keeps a place beside its charge, a unit or a building of its side, following a unit where it
  // goes, a little behind it. Whatever enemy comes within GUARD_R of the charge it fights, the nearest armed one
  // first, chasing no further than GUARD_LEASH from the charge, and then it takes its place again. It ends when
  // the charge is gone.
  const GUARD_R = 10, GUARD_LEASH = 16;
  function guardGo(S, u, o, t, shoot) {
    const g = S.byId.get(o.id), d = u.d;
    if (!g || g.hp <= 0 || g.team !== u.team) { u.ord = null; u.tgt = 0; u.v = 0; return; }
    if (t && (mhypot(t.x - g.x, t.y - g.y) > GUARD_LEASH || mhypot(u.x - g.x, u.y - g.y) > GUARD_LEASH)) { t = null; u.tgt = 0; }
    if (!t && armed(u) && S.tick % 10 === u.id % 10) {
      let best = null, bd = Infinity;
      near(S, g.x, g.y, GUARD_R, e => {
        if (e.team === u.team || e.team < 0 || e.hp <= 0 || e.drop > 0 || atPeace(S, u.team, e.team) || !seenBy(S, u.team, e)) return;
        if (!d.weapons.some(wn => canHit(wn, e))) return;
        const dd = gap(g.x, g.y, e) + (e.b ? 8 : 0) + (armed(e) ? 0 : 4);
        if (dd < GUARD_R + 8 && dd < bd) { bd = dd; best = e; }
      });
      if (best) { t = best; u.tgt = best.id; }
    }
    if (t) {
      if (shoot) { u.v = 0; return; }
      drive(S, u, t.x, t.y, Math.max(WEAPONS[d.weapons[0]].r * 0.85, 1));
      return;
    }
    // Its place: round a building, or behind a unit and to one side, by its own number so guards spread out.
    const k = ((u.id * 2.39996) % 2.4) - 1.2, r = g.b ? Math.max(g.w, g.h) / 2 + 1.6 : 1.6 + d.r + (g.d.r || 0.5);
    const a = g.b ? (u.id * 2.39996) % TAU : g.a + PI + k;
    const sx = clamp(g.x + mcos(a) * r, 1, W - 1), sy = clamp(g.y + msin(a) * r, 1, H - 1);
    if (mhypot(u.x - sx, u.y - sy) > (g.b ? 1.2 : 0.9)) drive(S, u, sx, sy, 0.5); else { u.v = 0; if (!g.b) u.a += clamp(angleTo(u.a, g.a), -3 * DT, 3 * DT); }
  }

  // The building an engineer goes to mend unasked. Its side's own within reach, at most FIX_AT whole, the worst hurt
  // first and the nearest of near equals, passing over any that another engineer is already on its way into.
  const FIX_AT = 0.75, FIX_REACH = 60;
  function fixFor(S, u) {
    const taken = new Set();
    for (const o of S.ents) if (o !== u && o.team === u.team && o.d.engineer && o.hp > 0 && o.ord && o.ord.t === 'attack') taken.add(o.ord.id);
    let best = null, bk = 1e9;
    for (const e of S.ents) {
      if (!e.b || e.team !== u.team || e.hp <= 0 || e.hp > e.max * FIX_AT || taken.has(e.id)) continue;
      const d = mhypot(e.x - u.x, e.y - u.y), k = e.hp / e.max + d / 600;
      if (d < FIX_REACH && k < bk) { bk = k; best = e; }
    }
    return best;
  }

  function engineerGo(S, u, t) {
    if (drive(S, u, t.x, t.y, 0.1) || gap(u.x, u.y, t) < 1.1) {
      if (t.team === u.team) {
        t.hp = Math.min(t.max, t.hp + t.max * 0.5);
        S.ev.push({ t: 'fixed', id: t.id, x: t.x, y: t.y });
      } else if (t.hp < t.max * 0.5) {
        const was = t.team, m = hpOf(S, u.team, t.d);
        t.team = u.team;
        t.tgt = 0;
        // It stands as its new side's hardening has it, and what it was working on is lost.
        t.hp *= m / t.max; t.max = m; t.up = null;
        if (t.held) release(S, t);
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
    const dark = e.d.needsPower && S.P[e.team].low, arm = armOf(S, e);
    if (dark || !arm) return;
    // A headquarters saved before it was armed has no gun to cool yet.
    if (!e.cd.length) e.cd = [0];
    let t = e.tgt ? S.byId.get(e.tgt) : null;
    if (t && (t.hp <= 0 || atPeace(S, e.team, t.team) || !seenBy(S, e.team, t) || !inRange(S, e, arm, t))) { t = null; e.tgt = 0; }
    if (!t && S.tick % 10 === e.id % 10) {
      let best = null, bd = Infinity;
      const wn = arm, R = rangeOf(S, e, wn);
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
      const wn = arm;
      if (e.cd[0] <= 0 && Math.abs(angleTo(e.ta, want)) < 0.15 && clearShot(S, e, wn, t)) {
        e.cd[0] = WEAPONS[wn].cd * (S.P[e.team].low ? 2 : 1);
        fire(S, e, wn, t);
      }
    }
  }

  // An upgrade under way at a building is paid for as it goes, like anything in a queue, and slowed by low power.
  function upTick(S, P, e) {
    const o = e.up, d = upCost(o.k, o.tier), rate = DT / d.time * (P.low ? 0.5 : 1) * (dataOn(S, P.team) ? DATA_RESEARCH : 1), pay = d.cost * rate, payOil = d.oil * rate;
    if (P.supply < pay || P.oil < payOil) { if (!o.short) { o.short = true; ownEvent(S, P.team, P.supply < pay ? 'nosupply' : 'nooil'); } return; }
    o.short = false;
    P.supply -= pay; P.oil -= payOil; o.paid += pay; o.paidOil += payOil; P.stats.spent += pay; P.stats.spentOil += payOil;
    o.prog += rate;
    if (o.prog >= 1) { e.up = null; upgraded(S, P, o.k, o.tier, e); }
  }
  // A tier done. What already stands of the side takes it at once, keeping its share of health.
  function upgraded(S, P, k, tier, at) {
    P.up[k] = tier;
    if (k === 'hard' || k === 'plate') {
      const cat = k === 'hard' ? 'def' : 'veh';
      for (const e of S.ents) if (e.team === P.team && e.hp > 0 && e.d.cat === cat) { const m = hpOf(S, P.team, e.d); e.hp *= m / e.max; e.max = m; }
    }
    if (k === 'border') territory(S);
    S.ev.push({ t: 'upgraded', team: P.team, k, tier, id: at.id, x: at.x, y: at.y });
  }
  // Why a building cannot start an upgrade's next tier, or null when it can. One building at a time may work on
  // each upgrade, and each building on one upgrade at a time.
  function upBlocked(S, team, k, e) {
    const P = S.P[team];
    if (!own(UPGRADES, k)) return 'No such upgrade';
    if (e && !upsAt(e.kind).includes(k)) return 'Not here';
    const tier = (P.up[k] || 0) + 1;
    if (tier > UP_AGE.length) return 'Done';
    if (P.tech < UP_AGE[tier - 1]) return 'Needs the ' + AGES[UP_AGE[tier - 1]].name + ' Age';
    if (S.ents.some(o => o.b && o.team === team && o.hp > 0 && o.up && o.up.k === k)) return 'Under way';
    if (e && e.up) return 'Busy';
    return null;
  }

  function stepBuilding(S, e) {
    const P = S.P[e.team];
    if (e.d.weapons || e.d.arms) bldTurret(S, e);
    if (e.up) upTick(S, P, e);
    if (e.repairing && e.hp < e.max) {
      const rate = e.max * 0.04 * DT, price = (e.d.cost || 2000) * 0.5 * (rate / e.max);
      if (P.supply >= price) { P.supply -= price; P.stats.spent += price; e.hp = Math.min(e.max, e.hp + rate); }
    } else e.repairing = false;
    if (e.kind === 'derrick' && S.tick % HZ === 0) { P.oil += e.d.yield * P.income; P.stats.oilIn += e.d.yield * P.income; }
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
      // A King of the Hill side's keep, the first of its home towns, is never taken.
      if (t.keep !== undefined && t.keep === t.owner) continue;
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
      // A King of the Hill side's home town, still held by it, takes three times as long.
      t.cap += 0.05 * Math.min(here[team], 3) / (t.owner >= 0 ? 1.3 : 1) * 0.5 / (t.home !== undefined && t.home === t.owner ? 3 : 1);
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

  // King of the Hill. There is no building: each side starts with a home town and a few squads, its towns raise its
  // soldiers, and the war is for the map's high points. Every KOTH_EVERY a side holding more points than another
  // takes KOTH_BLEED from that side's score for each point of the difference. A side at 0, or with no town, is out,
  // though its keep is never taken.
  const KOTH_SCORE = 750, KOTH_BLEED = 5, KOTH_EVERY = 10 * HZ, KOTH_R = 4.5;
  // The high points, found from the map's terrain. A summit is scored by its prominence, how far it stands above the
  // highest saddle joining it to higher ground. A point goes on the highest cell within six of its summit that a man
  // can stand on, off water, clear of the bases and away from the map's edges. The points come in the map's own
  // turns, so every side is as near the high ground as every other: an odd one at the very middle, when there is
  // footing there, and the rest in sets, one to each turn, whose ends stand within a cell's height of each other.
  function kothPoints(S, n) {
    const M = S.map;
    // A layout that names its high points, laid in its own turns, has those.
    if (M.highs) return M.highs.map(([x, y], i) => ({ x, y, z: terrainAt(M, x, y), id: i, owner: -1, cap: 0, capTeam: -1 }));
    const h = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) h[y * W + x] = terrainAt(M, x + 0.5, y + 0.5);
    const firm = c => !(M.ground[c] & 2) && h[c] >= waterLevel(M, c % W + 0.5, (c / W | 0) + 0.5);
    const ord = Array.from({ length: N }, (_, c) => c).sort((a, b) => h[b] - h[a] || a - b);
    const par = new Int32Array(N).fill(-1), top = new Int32Array(N), prom = new Map();
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (const c of ord) {
      par[c] = c; top[c] = c;
      const x = c % W, y = (c - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H || par[ny * W + nx] < 0) continue;
        const a = find(c), b = find(ny * W + nx);
        if (a === b) continue;
        // The lower of the two summits ends here, at this cell's height.
        const hi = h[top[a]] >= h[top[b]] ? a : b, lo = hi === a ? b : a;
        prom.set(top[lo], h[top[lo]] - h[c]);
        par[lo] = hi;
      }
    }
    prom.set(top[find(ord[0])], h[ord[0]] - h[ord[N - 1]]);
    const clear = (x, y) => x >= 8 && y >= 8 && x < W - 8 && y < H - 8 && S.bases.every(b => mhypot(b[0] - x, b[1] - y) > 24);
    const footing = (x0, y0) => {
      let best = -1;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = Math.floor(x0) + dx, y = Math.floor(y0) + dy;
        if (dx * dx + dy * dy > 36 || !clear(x + 0.5, y + 0.5)) continue;
        const c = y * W + x;
        if (firm(c) && (best < 0 || h[c] > h[best])) best = c;
      }
      return best;
    };
    const out = [];
    if (n % 2 === 1) {
      const c = Math.floor(CY) * W + Math.floor(CX);
      if (firm(c) && firm(c - 1) && firm(c - W) && firm(c - W - 1)) out.push({ x: CX, y: CY, z: terrainAt(M, CX, CY) });
    }
    const turns = S.bases.length <= 2 ? [[1, 0], [-1, 0]] : [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const summits = [...prom].filter(([c, p]) => p >= 0.8).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [c0] of summits) {
      if (out.length + turns.length > n) break;
      const c = footing(c0 % W + 0.5, (c0 / W | 0) + 0.5);
      if (c < 0) continue;
      const x = c % W + 0.5, y = (c / W | 0) + 0.5, set = turns.map(([k, s]) => ({ x: CX + (x - CX) * k - (y - CY) * s, y: CY + (x - CX) * s + (y - CY) * k }));
      if (set.some(q => { const m = cellOf(q.x, q.y); return !clear(q.x, q.y) || !firm(m) || Math.abs(h[m] - h[c]) > 1; })) continue;
      if (set.some(q => out.some(o => mhypot(o.x - q.x, o.y - q.y) < 16)) || mhypot(set[0].x - set[1].x, set[0].y - set[1].y) < 16) continue;
      for (const q of set) out.push({ x: q.x, y: q.y, z: terrainAt(M, q.x, q.y) });
    }
    return out.map((p, i) => Object.assign(p, { id: i, owner: -1, cap: 0, capTeam: -1 }));
  }
  // A mountain's top is walled by cliffs no man climbs, so each point that cannot be walked to from the first base gets
  // a footpath. It is cut through the cliffs of this game's own ground, two cells wide, along the dry way up that
  // climbs least, and the paths are kept for drawing.
  function kothTracks(S) {
    const M = S.map, g = S.gnd, h = new Float32Array(N), dry = new Uint8Array(N), out = [];
    for (let c = 0; c < N; c++) { const x = c % W + 0.5, y = (c / W | 0) + 0.5; h[c] = terrainAt(M, x, y); dry[c] = h[c] >= waterLevel(M, x, y) ? 1 : 0; }
    const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1], b0 = S.bases[0];
    for (const p of S.points) {
      const walk = new Uint8Array(N), q = [Math.floor(b0[1]) * W + Math.floor(b0[0]) + 4];
      walk[q[0]] = 1;
      while (q.length) {
        const c = q.pop(), x = c % W, y = (c - x) / W;
        for (let i = 0; i < 4; i++) {
          const nx = x + DX[i], ny = y + DY[i], k = ny * W + nx;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !walk[k] && !(g[k] & 2)) { walk[k] = 1; q.push(k); }
        }
      }
      const goal = cellOf(p.x, p.y);
      if (walk[goal]) continue;
      // Outward from the point to the nearest walkable cell. A cliff cell costs more the more it climbs.
      const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), heap = [];
      const less = (a, b) => dist[a] < dist[b] || (dist[a] === dist[b] && a < b);
      const put = c => { heap.push(c); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (!less(heap[i], heap[j])) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
      const take = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } }
        return top;
      };
      dist[goal] = 0; put(goal);
      let end = -1;
      const done = new Uint8Array(N);
      while (heap.length) {
        const c = take();
        if (done[c]) continue;
        done[c] = 1;
        if (walk[c]) { end = c; break; }
        const x = c % W, y = (c - x) / W;
        for (let i = 0; i < 4; i++) {
          const nx = x + DX[i], ny = y + DY[i], k = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !dry[k] || done[k]) continue;
          const d = dist[c] + 1 + (g[k] & 2 ? 2 + 6 * Math.abs(h[k] - h[c]) : 0);
          if (d < dist[k]) { dist[k] = d; prev[k] = c; put(k); }
        }
      }
      if (end < 0) continue;
      const path = [];
      for (let c = end; c >= 0; c = prev[c]) path.push(c);
      for (const c of path) for (const k of [c, c + 1, c + W]) if (k < N && dry[k] && (g[k] & 2) && (k !== c + 1 || k % W)) g[k] &= ~2;
      out.push({ point: p.id, cells: path });
    }
    // Every cut is made in the map's turns as well, so each side's way up is the same as every other's.
    const turns = S.bases.length <= 2 ? [[-1, 0]] : [[0, 1], [-1, 0], [0, -1]], cut = [];
    for (let c = 0; c < N; c++) if ((M.ground[c] & 2) && !(g[c] & 2)) cut.push(c);
    for (const c of cut) for (const [k, s] of turns) {
      const x = c % W + 0.5 - CX, y = (c / W | 0) + 0.5 - CY, m = cellOf(CX + x * k - y * s, CY + x * s + y * k);
      if (dry[m]) g[m] &= ~2;
    }
    return out;
  }
  // The points a map takes: its own number, or three on two seats, five on four and seven on eight.
  const kothCount = S => { const m = Object.values(MAPS).find(e => e.layout === S.layout); return m && m.koth || (S.bases.length <= 2 ? 3 : S.bases.length <= 4 ? 5 : 7); };
  // A side's home town, the one nearest its place that nobody holds, and a second where the map has three towns or more
  // to a side, and the squads it starts with in the first. Home towns are slower to take while their side holds them.
  function spawnHome(S, team) {
    const b = S.bases[team], two = S.towns.length >= 3 * S.seats.length;
    let home = null;
    for (let k = two ? 2 : 1; k > 0; k--) {
      let t0 = null;
      for (const t of S.towns) if (t.owner < 0 && (!t0 || mhypot(t.x - b[0], t.y - b[1]) < mhypot(t0.x - b[0], t0.y - b[1]))) t0 = t;
      if (!t0) break;
      t0.owner = team; t0.home = team;
      if (!home) t0.keep = team;
      home = home || t0;
    }
    if (!home) return;
    const age = S.P[team].tech, a = matan2(CY - home.y, CX - home.x), f = [mcos(a), msin(a)], s = [-f[1], f[0]];
    const at = (fw, sd) => [home.x + f[0] * fw + s[0] * sd, home.y + f[1] * fw + s[1] * sd];
    for (const [k, fw, sd] of [['inf', 5, -2.5], ['inf', 5, 2.5], ['at', 3.5, 0], ['rec', 7, 0]]) { const kind = formOf(k, age); if (kind) spawn(S, kind, team, ...at(fw, sd)); }
  }
  // Points are taken as towns are, by men standing on them, and the score bleeds. A side's held points open its calls,
  // one for each point, in the order the ages bring them.
  const KOTH_CALLS = ['flare', 'barrage', 'uav', 'para', 'sat'];
  function stepPoints(S) {
    if (!S.koth) return;
    if (S.tick % 5 === 0) for (const p of S.points) {
      const here = new Array(S.P.length).fill(0);
      near(S, p.x, p.y, KOTH_R, u => { if (!u.b && u.hp > 0 && u.d.men && u.drop <= 0 && mhypot(u.x - p.x, u.y - p.y) < KOTH_R) here[u.team]++; });
      let team = -1, sides = 0;
      for (let k = 0; k < here.length; k++) if (here[k]) { sides++; team = k; }
      if (sides > 1) continue;
      if (team < 0 || p.owner === team) { p.cap = Math.max(0, p.cap - 0.05); if (p.cap === 0) p.capTeam = -1; continue; }
      if (p.capTeam !== team && p.cap > 0) { p.cap = Math.max(0, p.cap - 0.05 * Math.min(here[team], 3)); if (p.cap === 0) p.capTeam = team; continue; }
      p.capTeam = team;
      p.cap += 0.05 * Math.min(here[team], 3) / (p.owner >= 0 ? 1.3 : 1) * 0.5;
      if (p.cap >= 1) {
        const from = p.owner;
        p.owner = team; p.cap = 0; p.capTeam = -1;
        ownEvent(S, team, 'towntaken');
        if (from >= 0) ownEvent(S, from, 'townlost');
        S.ev.push({ t: 'point', id: p.id, team, from, x: p.x, y: p.y });
      }
    }
    const held = S.P.map(P => S.points.filter(p => p.owner === P.team).length);
    for (const P of S.P) {
      P.calls = KOTH_CALLS.filter(k => POWERS[k].tech <= P.tech).slice(0, held[P.team]);
      // The levy is called once two towns are held, with no capitol to call it from.
      if (S.towns.filter(t => t.owner === P.team).length >= 2) P.calls.push('levy');
    }
    if (S.tick % KOTH_EVERY === 0 && S.tick > 0) for (const P of S.P) if (P.alive) {
      let loss = 0;
      for (const O of S.P) if (O !== P && O.alive) loss += Math.max(0, held[O.team] - held[P.team]) * KOTH_BLEED;
      if (loss) { S.score[P.team] = Math.max(0, S.score[P.team] - loss); S.ev.push({ t: 'bleed', team: P.team, n: loss, score: S.score[P.team] }); }
    }
  }
  // What a held town raises, by its size: a hamlet foot, a village horse and light vehicles too, and a town guns and
  // armour as well, and how many it trains at once. Each town held lets a side keep so many units by its size, and two
  // more for each of its houses standing, so a ruined town keeps fewer.
  const KOTH_RAISE = { hamlet: ['inf', 'at', 'snp', 'eng'], village: ['inf', 'at', 'snp', 'eng', 'hero', 'rec', 'mount', 'ifv', 'sup'], town: ['inf', 'at', 'snp', 'eng', 'hero', 'rec', 'mount', 'ifv', 'sup', 'aa', 'siege', 'heavy'] };
  const KOTH_SLOTS = { hamlet: 1, village: 2, town: 3 }, KOTH_BASE = { hamlet: 6, village: 10, town: 14 }, KOTH_PER_HOUSE = 2;
  function kothTowns(S, team) {
    const out = [];
    for (const t of S.towns) if (t.owner === team) { const p = townPay(S, t.id, team); out.push({ t, kind: p.kind, standing: p.standing }); }
    return out;
  }
  const kothCap = (S, team) => kothTowns(S, team).reduce((n, k) => n + KOTH_BASE[k.kind] + k.standing * KOTH_PER_HOUSE, 0);
  // A side's towns as trainers: one for each place in each town's queue, with the lines that town raises, the side's
  // chosen town first. A unit comes out at the edge of its town facing the middle of the map.
  function kothSlots(S, team) {
    const P = S.P[team], out = [];
    for (const k of kothTowns(S, team)) {
      const e = { x: k.t.x, y: k.t.y, cx: Math.round(k.t.x) - 1, cy: Math.round(k.t.y) - 1, w: 2, h: 2, town: k.t.id, raise: KOTH_RAISE[k.kind], rally: P.townRally && P.townRally[k.t.id] };
      for (let i = 0; i < KOTH_SLOTS[k.kind]; i++) if (P.townPick === k.t.id) out.unshift(e); else out.push(e);
    }
    return out;
  }

  // Trade. A caravan runs goods between its side's posts, the headquarters and the towns it holds, always on to the
  // post farthest from where it stands, and is paid at each by the length of the leg it ran. A post lost on the
  // way sends it to the next.
  const TRADE_K = 0.9;
  function postsOf(S, team) {
    const out = [];
    for (const e of S.ents) if (e.b && e.team === team && e.hp > 0 && (e.kind === 'hq' || e.kind === 'fob')) out.push([e.x, e.y]);
    for (const t of S.towns) if (t.owner === team) out.push([t.x, t.y]);
    return out;
  }
  function tradeTick(S, u) {
    let o = u.ord;
    if (!o || o.t !== 'trade') o = u.ord = { t: 'trade' };
    if (o.x === undefined || (S.tick % HZ === u.id % HZ && !postsOf(S, u.team).some(p => mhypot(p[0] - o.x, p[1] - o.y) < 0.5))) {
      const posts = postsOf(S, u.team);
      o.x = undefined;
      if (posts.length < 2) { u.v = 0; return; }
      let far = null, fd = -1, near = null, nd = 1e9;
      for (const p of posts) { const d = mhypot(p[0] - u.x, p[1] - u.y); if (d > fd) { fd = d; far = p; } if (d < nd) { nd = d; near = p; } }
      o.x = far[0]; o.y = far[1];
      if (o.fx === undefined) { o.fx = near[0]; o.fy = near[1]; }
    }
    if (drive(S, u, o.x, o.y, 3.5)) {
      const P = S.P[u.team], pay = Math.round(TRADE_K * mhypot(o.x - o.fx, o.y - o.fy) * P.income);
      if (pay > 0) { P.supply += pay; P.stats.townIn += pay; S.ev.push({ t: 'trade', team: u.team, x: u.x, y: u.y, n: pay }); }
      o.fx = o.x; o.fy = o.y; o.x = undefined;
    }
  }

  // The bodies of water of a map, each sea cell numbered by the water it lies in, and the water each shoal lies in,
  // worked out once for the map.
  function watersOf(M) {
    if (M._waters) return M._waters;
    const MW = M.W, MH = M.H, id = new Int32Array(MW * MH).fill(-1);
    let n = 0;
    for (let c = 0; c < MW * MH; c++) if (M.sea[c] && id[c] < 0) {
      const st = [c]; id[c] = n;
      while (st.length) {
        const v = st.pop(), x = v % MW, y = v / MW | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, u = ny * MW + nx;
          if (nx >= 0 && ny >= 0 && nx < MW && ny < MH && M.sea[u] && id[u] < 0) { id[u] = n; st.push(u); }
        }
      }
      n++;
    }
    M._waters = { id };
    M._waters.shoal = (M.fish || []).map(f => waterAt(M, f.x, f.y));
    return M._waters;
  }
  // The water at a point, or the nearest within four cells, -1 for none.
  function waterAt(M, x, y) {
    const { id } = watersOf(M), c0 = Math.floor(y) * M.W + Math.floor(x);
    if (x >= 0 && y >= 0 && x < M.W && y < M.H && M.sea[c0]) return id[c0];
    let w = -1, bd = 1e9;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy, d = dx * dx + dy * dy;
      if (cx >= 0 && cy >= 0 && cx < M.W && cy < M.H && M.sea[cy * M.W + cx] && d < bd) { bd = d; w = id[cy * M.W + cx]; }
    }
    return w;
  }
  // Whether the water at a point holds a shoal, for where a dock is worth building.
  const fishWater = (S, x, y) => { const w = waterAt(S.map, x, y); return w >= 0 && watersOf(S.map).shoal.includes(w); };
  // Fishing. A boat sails to the nearest shoal in the water it is on and fishes there a while, each boat at its own
  // place round it, then lands the catch at the nearest of its side's docks and is paid for it. A boat on water with
  // no shoal waits, and its side is told once.
  function fishTick(S, u) {
    let o = u.ord;
    if (!o || o.t !== 'fish') o = u.ord = { t: 'fish' };
    const P = S.P[u.team];
    if (!o.full) {
      if (o.x === undefined) {
        const shoal = watersOf(S.map).shoal, mine = waterAt(S.map, u.x, u.y);
        let best = null, bd = 1e9;
        (S.map.fish || []).forEach((f, i) => { const d = mhypot(f.x - u.x, f.y - u.y); if (shoal[i] === mine && d < bd) { bd = d; best = f; } });
        if (!best) {
          u.v = 0;
          if (!o.none) { o.none = true; S.ev.push({ t: 'nofish', team: u.team, id: u.id, x: u.x, y: u.y }); }
          return;
        }
        const a = (u.id * 2.39996) % TAU, c = goalCells(S, 'naval', clamp((best.x + mcos(a) * 2.5) | 0, 0, W - 1), clamp((best.y + msin(a) * 2.5) | 0, 0, H - 1))[0];
        o.x = c % W + 0.5; o.y = (c / W | 0) + 0.5; o.left = 10 * HZ;
      }
      if (drive(S, u, o.x, o.y, 1.5)) { u.v = 0; if (--o.left <= 0) { o.full = true; o.x = undefined; } }
      return;
    }
    if (o.x === undefined) {
      let best = null, bd = 1e9;
      for (const e of S.ents) if (e.b && e.team === u.team && e.kind === 'dock' && e.hp > 0) { const d = mhypot(e.x - u.x, e.y - u.y); if (d < bd) { bd = d; best = e; } }
      if (!best) { u.v = 0; return; }
      const c = goalCells(S, 'naval', best.x | 0, best.y | 0)[0];
      o.x = c % W + 0.5; o.y = (c / W | 0) + 0.5;
    }
    if (drive(S, u, o.x, o.y, 2.5)) {
      const pay = Math.round(u.d.fish * P.income);
      P.supply += pay; P.stats.mined += pay; S.ev.push({ t: 'trade', team: u.team, x: u.x, y: u.y, n: pay });
      o.full = false; o.x = undefined;
    }
  }

  // A satellite constellation. While it is up, a pass crosses the map every SAT_EVERY, its train of satellites
  // taking SAT_PASS to cross on a straight track at its own angle, the first through the point the side chose and
  // the rest through points of the middle of the map. The ground under the train is seen as it passes, and the
  // side's units see as far by night and in any weather as by a clear day.
  const SAT_RISE = 20 * HZ, SAT_EVERY = 40 * HZ, SAT_PASS = 24 * HZ, SAT_R = 10, SAT_SEE = 5 * HZ;
  const satUp = (S, team) => { const o = S.P[team] && S.P[team].sat; return !!o && S.tick >= o.start && S.tick < o.until; };
  // The pass under way at a time: its track through (px, py) along (dx, dy), its length, and how far along it the
  // train's head has come, or null between passes.
  function satPass(S, team, t = S.tick) {
    const o = S.P[team] && S.P[team].sat;
    if (!o || t < o.start || t >= o.until) return null;
    const k = Math.floor((t - o.start) / SAT_EVERY), tau = t - o.start - k * SAT_EVERY;
    if (tau > SAT_PASS) return null;
    const h = spellHash(o.h, k), a = (h % 6283) / 1000;
    const px = k === 0 ? o.x : W * (0.2 + 0.6 * ((h >>> 10) % 1000) / 1000), py = k === 0 ? o.y : H * (0.2 + 0.6 * ((h >>> 20) % 1000) / 1000);
    const L = W * 1.6;
    return { px, py, dx: mcos(a), dy: msin(a), L, s: -L / 2 + L * tau / SAT_PASS, k };
  }
  function stepSat(S) {
    if (S.tick % HZ) return;
    for (const P of S.P) {
      if (!P.sat) continue;
      if (S.tick >= P.sat.until) { P.sat = null; continue; }
      const q = satPass(S, P.team);
      if (!q) continue;
      const x = q.px + q.dx * q.s, y = q.py + q.dy * q.s;
      if (x > -SAT_R && y > -SAT_R && x < W + SAT_R && y < H + SAT_R) S.sweeps.push({ team: P.team, x, y, r: SAT_R, until: S.tick + SAT_SEE });
    }
  }

  // The AI Data Center. While a side has one standing and enough power, its research and upgrades go DATA_RESEARCH
  // as fast, and every DATA_EVERY the strongest enemy army it can find is lit up for a few seconds wherever it is,
  // with word of it, and a warning when it is near the side's base. Its weather forecast is the picture's alone.
  const DATA_RESEARCH = 1.25, DATA_EVERY = 60 * HZ, DATA_SEE = 8 * HZ;
  const dataOn = (S, team) => !!(S.P[team] && S.P[team].counts.datacenter && !S.P[team].low);
  function stepIntel(S) {
    if (S.tick % DATA_EVERY !== DATA_EVERY / 2) return;
    const armies = new Map();
    for (const e of S.ents) {
      if (e.b || e.hp <= 0 || e.team < 0 || e.d.cargo || e.d.trade || !armed(e) || isAir(e)) continue;
      const k = e.team * 4096 + ((e.y / 12) | 0) * 64 + ((e.x / 12) | 0), a = armies.get(k) || { team: e.team, sx: 0, sy: 0, v: 0 };
      const v = worth(e.d); a.sx += e.x * v; a.sy += e.y * v; a.v += v; armies.set(k, a);
    }
    for (const P of S.P) {
      if (!P.alive || !dataOn(S, P.team)) continue;
      let best = null;
      for (const a of armies.values()) if (a.team !== P.team && S.P[a.team] && S.P[a.team].alive && (!best || a.v > best.v)) best = a;
      if (!best || best.v < 300) continue;
      const x = best.sx / best.v, y = best.sy / best.v, b = S.bases[P.team];
      S.sweeps.push({ team: P.team, x, y, r: 9, until: S.tick + DATA_SEE });
      S.ev.push({ t: 'intel', team: P.team, foe: best.team, x, y, near: !!b && mhypot(x - b[0], y - b[1]) < 45 });
    }
  }

  function stepEconomy(S) {
    if (S.tick % HZ === 0) {
      // A side short of power is told again each minute it stays short.
      for (const P of S.P) if (P.low && (P.lowFor = (P.lowFor || 0) + 1) % 60 === 0) ownEvent(S, P.team, 'lowpower');
      const z = townSizes(S.map);
      for (const t of S.towns) if (t.owner >= 0) {
        const P = S.P[t.owner], k = townShare(S, t.id) * townRate(S, t.id, t.owner), ore = TOWN_PAY * k, oil = TOWN_OIL * k;
        P.supply += ore; P.oil += oil; P.stats.townIn += ore; P.stats.oilIn += oil;
        for (const i of z.list[t.id]) {
          const full = houseHp(S.map.houses[i]);
          if (S.hh[i] > 0) S.hh[i] = Math.min(full, S.hh[i] + full / HOUSE_MEND);
          else if ((S.hr[i] = (S.hr[i] || 0) + 1) >= HOUSE_REBUILD) { S.hh[i] = full; S.hr[i] = 0; }
        }
      }
    }
    for (const P of S.P) {
      const relay = upK(S, P.team, 'relay');
      for (const k in P.cooldown) if (P.cooldown[k] > 0) P.cooldown[k] -= DT * relay;
      for (const cat of ['bld', 'def', 'inf', 'veh', 'air', 'sea', 'tech']) {
        const q = P.q[cat], units = cat !== 'bld' && cat !== 'def' && cat !== 'tech';
        if (!q.length && !(units && P.repeat)) continue;
        if (units) { trainTick(S, P, cat, q); continue; }
        const item = q[0];
        if (item.prog >= 1) { if (cat === 'bld' || cat === 'def') continue; finish(S, P, cat, item); q.shift(); continue; }
        if (item.hold) continue;
        const d = item.cost;
        const rate = DT / d.time * (P.low ? 0.5 : 1) * (cat === 'tech' && dataOn(S, P.team) ? DATA_RESEARCH : 1);
        const pay = (d.cost || 0) * rate, payOil = (d.oil || 0) * rate;
        if (P.supply < pay || P.oil < payOil) { if (!item.short) { item.short = true; ownEvent(S, P.team, P.supply < pay ? 'nosupply' : 'nooil'); } continue; }
        item.short = false;
        P.supply -= pay; P.oil -= payOil; item.paid += pay; item.paidOil += payOil; P.stats.spent += pay; P.stats.spentOil += payOil;
        item.prog += rate;
        if (item.prog >= 1) {
          item.prog = 1;
          if (cat === 'bld' || cat === 'def') { ownEvent(S, P.team, 'buildready'); S.ev.push({ t: 'ready', team: P.team, cat, kind: item.kind }); }
        }
      }
    }
  }

  // Units are trained at every building that can train them at once: each building takes its own unit from the head of
  // the queue, the side's chosen building the first, and the unit comes out of the building that made it. A unit held
  // gives its place to the next. Each takes its own time and is paid for as it goes, as one at a time would be.
  function trainTick(S, P, cat, q) {
    // In King of the Hill the side's towns train, each only what its size raises.
    const halls = S.koth ? kothSlots(S, P.team) : trainersOf(S, P.team, TRAINER_OF[cat]);
    const fit = (e, line) => !S.koth || e.raise.includes(line);
    // A line set to repeat keeps one of its units queued for each building that trains it, so each stays busy.
    if (P.repeat && halls.length) for (const line in P.repeat) {
      const kind = formOf(line, P.tech);
      if (!kind || UNITS[kind].cat !== cat || q.length >= 9) continue;
      if (q.filter(i => UNITS[i.kind] && UNITS[i.kind].line === line).length >= halls.filter(e => fit(e, line)).length) continue;
      if (blockedReason(S, P.team, kind)) continue;
      q.push({ kind, cost: UNITS[kind], prog: 0, paid: 0, paidOil: 0, hold: false });
    }
    const used = new Set();
    for (let i = 0; i < q.length && used.size < halls.length; i++) {
      const item = q[i];
      if (item.hold) continue;
      const k = S.koth ? halls.findIndex((e, j) => !used.has(j) && fit(e, UNITS[item.kind].line)) : used.size;
      if (k < 0) continue;
      used.add(k);
      const by = halls[k];
      if (item.prog >= 1) { finish(S, P, cat, item, by); q.splice(i, 1); i--; continue; }
      const d = item.cost, rate = DT / d.time * (P.low ? 0.5 : 1) * (cat === 'inf' ? upK(S, P.team, 'drill') : 1);
      const pay = (d.cost || 0) * rate, payOil = (d.oil || 0) * rate;
      if (P.supply < pay || P.oil < payOil) { if (!item.short) { item.short = true; ownEvent(S, P.team, P.supply < pay ? 'nosupply' : 'nooil'); } continue; }
      item.short = false;
      P.supply -= pay; P.oil -= payOil; item.paid += pay; item.paidOil += payOil; P.stats.spent += pay; P.stats.spentOil += payOil;
      item.prog = Math.min(1, item.prog + rate);
    }
  }
  const TRAINER_OF = { inf: 'barracks', veh: 'factory', sea: 'dock', air: 'airfield' };
  // A side's standing buildings of a kind, its chosen one first.
  function trainersOf(S, team, kind) {
    const out = [];
    for (const e of S.ents) if (e.b && e.team === team && e.kind === kind && e.hp > 0) { if (e.primary) out.unshift(e); else out.push(e); }
    return out;
  }
  // The buildings units come out of, and the one a side's units of a kind come out of: the one it chose, or else its
  // first.
  const TRAINERS = ['barracks', 'factory', 'dock', 'airfield'];
  function producerOf(S, team, kind) {
    let best = null;
    for (const e of S.ents) if (e.b && e.team === team && e.kind === kind && e.hp > 0 && (!best || e.primary)) best = e;
    return best;
  }
  function makePrimary(S, team, e) {
    e.primary = true;
    for (const o of S.ents) if (o !== e && o.b && o.team === team && o.kind === e.kind) o.primary = false;
  }

  // A new age turns every unit of the side into its line's form for that age, keeping its share of health.
  function upgradeSide(S, team, age) {
    for (const u of S.ents) {
      if (u.team !== team || u.b || u.hp <= 0 || !u.d.line) continue;
      const k = formOf(u.d.line, age);
      if (!k || k === u.kind) continue;
      const d = UNITS[k], f = u.hp / u.max, m = hpOf(S, team, d);
      u.kind = k; u.d = d; u.max = m; u.hp = Math.max(1, m * f); u.cd = d.weapons.map(() => 0);
      if (d.cargo && u.cargo > capOf(S, u)) { const c = capOf(S, u); u.cargoV = (u.cargoV ?? u.cargo) * c / u.cargo; u.cargo = c; }
      if (d.bombs) u.ammo = d.bombs.n;
      if (d.alt) u.z = Math.max(u.z, d.alt * 0.5);
      S.ev.push({ t: 'upgrade', id: u.id, kind: k, team, x: u.x, y: u.y });
    }
    recount(S);
  }
  function finish(S, P, cat, item, by) {
    if (cat === 'tech') {
      P.tech = item.level;
      S.ev.push({ t: 'tech', team: P.team, level: item.level });
      mark(S, P.team, 'tech', item.level);
      ownEvent(S, P.team, 'newtech');
      upgradeSide(S, P.team, item.level);
      return;
    }
    const need = cat === 'inf' ? 'barracks' : cat === 'veh' ? 'factory' : cat === 'sea' ? 'dock' : 'airfield';
    const best = by || producerOf(S, P.team, need);
    if (!best) return;
    // A ship is launched into the open water nearest its dock.
    const [x, y] = cat === 'sea' ? (c => [c % W + 0.5, (c / W | 0) + 0.5])(goalCells(S, 'naval', best.x | 0, best.y | 0)[0]) : exitOf(S, best);
    // A unit queued before the age turned comes out in the new age's form.
    const kind = formOf(UNITS[item.kind].line, P.tech) || item.kind, u = spawn(S, kind, P.team, x, y);
    P.stats.made++; P.stats[u.d.cat === 'air' ? 'air' : u.d.cat === 'veh' ? 'veh' : 'inf']++;
    S.ev.push({ t: 'built', team: P.team, kind, id: u.id, x, y });
    ownEvent(S, P.team, 'unitready');
    if (u.d.move === 'jet') { u.ord = null; return; }
    // Trucks go to dig and fishing boats to fish at once, without waiting at the rally point.
    if (!u.d.cargo && !u.d.fish) {
      const r = best.rally, raid = P.raid && S.tick - P.raid.tick < 12 * HZ ? P.raid : null, fix = u.d.engineer && fixFor(S, u);
      // A new engineer goes straight into a hurt building of its base to mend it.
      if (fix) { u.ord = { t: 'attack', id: fix.id, fix: true }; u.tgt = fix.id; u.wpT = 0; u.stuck = 0; }
      // While the base is under attack, an armed unit goes straight out to meet the attackers, hunting on its way.
      else if (raid && armed(u) && !u.d.engineer) {
        const a = raid.by && S.byId.get(raid.by), at = a && a.hp > 0 && mhypot(a.x - raid.x, a.y - raid.y) < 20 ? a : raid;
        orderMove(S, [u], at.x, at.y, true);
      } else if (r) orderMove(S, [u], r[0], r[1], false);
      else {
        const dx = x - best.x, dy = y - best.y, m = mhypot(dx, dy) || 1;
        orderMove(S, [u], x + dx / m * 3 + (S.rand() - 0.5) * 3, y + dy / m * 3 + (S.rand() - 0.5) * 3, false);
      }
    }
  }

  // The formations a group can keep, as the selection panel offers them. Block is the one a group falls into of
  // itself; the others the player picks, and each unit keeps its own until told otherwise.
  const FORMS = ['line', 'block', 'column', 'wedge', 'square', 'loose'];
  // How a unit with no orders fights: seek and destroy, aggressive, defensive (the default) or holding its ground.
  const STANCES = ['hunt', 'aggr', 'def', 'hold'];
  // Seek and destroy: an idle hunter attack-moves on the nearest enemy its side can see and it can hurt, or else on
  // the nearest base of a side still in the game.
  function seek(S, u) {
    let best = null, bd = Infinity;
    for (const e of S.ents) {
      if (e.team === u.team || e.team < 0 || e.hp <= 0 || e.drop > 0 || atPeace(S, u.team, e.team) || !seenBy(S, u.team, e)) continue;
      if (!u.d.weapons.some(wn => canHit(wn, e))) continue;
      const dd = mhypot(e.x - u.x, e.y - u.y);
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best) for (const t of S.seats) {
      const b = S.bases[t];
      if (t === u.team || !S.P[t] || !S.P[t].alive || atPeace(S, u.team, t) || !b) continue;
      const dd = mhypot(b[0] - u.x, b[1] - u.y);
      if (dd < bd) { bd = dd; best = { x: b[0], y: b[1] }; }
    }
    if (best) { u.ord = { t: 'amove', x: best.x, y: best.y }; u.wpT = 0; u.stuck = 0; u.home = null; }
  }
  // A unit's place from front to back: 0 in front for melee and heavy armour, 2 behind, or inside a square, for
  // the unarmed, artillery and the long-ranged, and 1 between.
  function rankOf(u) {
    const ws = (u.d.weapons || []).map(n => WEAPONS[n]).filter(Boolean);
    if (!ws.length || ws.some(w => w.indirect || w.min || w.r >= 12)) return 2;
    return u.d.armor === 'heavy' || ws.some(w => w.r <= 2.5) ? 0 : 1;
  }
  // The formation a group keeps: the one most of its units were set to, and Block where none was.
  function formOfGroup(units) {
    const n = {};
    let best = 'block', most = 0;
    for (const u of units) if (u.form) { n[u.form] = (n[u.form] || 0) + 1; if (n[u.form] > most) { most = n[u.form]; best = u.form; } }
    return best;
  }
  // A formation's places in rows from the front, each place across and back from the front in spacings.
  function formRows(form, n) {
    const rows = [];
    const row = (k, back, gap) => { const r = []; for (let j = 0; j < k; j++) r.push([(j - (k - 1) / 2) * gap, back]); rows.push(r); };
    if (form === 'wedge') {
      // An arrowhead, one at its point and one more in each row back.
      for (let r = 0, left = n; left > 0; r++) { const k = Math.min(r + 1, left); row(k, r * 0.85, 1.1); left -= k; }
      return rows;
    }
    // A line is one to three deep, a column two abreast, and loose order the block's grid spread wide apart.
    const wide = form === 'line' ? Math.ceil(n / (n <= 6 ? 1 : n <= 24 ? 2 : 3)) : form === 'column' ? (n <= 3 ? 1 : 2) : Math.ceil(Math.sqrt(n * 1.4));
    const gap = form === 'loose' ? 2.2 : 1;
    for (let r = 0, left = n; left > 0; r++, left -= wide) row(Math.min(wide, left), r * gap, gap);
    return rows;
  }
  // A hollow square: the front and middle ranks round its edge, the back rank in the middle, the edge as small as
  // holds them all. The places round the edge are taken evenly and in order round it.
  function squareSlots(nOut, nIn) {
    let k = 2;
    while (4 * (k - 1) < nOut || (k - 2) * (k - 2) < nIn) k++;
    const h = (k - 1) / 2, ring = [], inner = [];
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) (i === 0 || j === 0 || i === k - 1 || j === k - 1 ? ring : inner).push([i - h, j - h]);
    const ang = p => matan2(p[1], p[0]);
    ring.sort((p, q) => ang(p) - ang(q));
    inner.sort((p, q) => (p[0] * p[0] + p[1] * p[1]) - (q[0] * q[0] + q[1] * q[1]) || ang(p) - ang(q));
    const out = [];
    for (let m = 0; m < nOut; m++) out.push(ring[Math.floor(m * ring.length / nOut)]);
    return { out, inner: inner.slice(0, nIn) };
  }
  // Goal slots around a point, so a group ends up in its formation and not a pile. face turns the formation to a
  // heading of its own, as when it forms up where it stands.
  function orderMove(S, units, x, y, attack, face) {
    const n = units.length;
    let cx = 0, cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= n; cy /= n;
    const a = face ?? matan2(y - cy, x - cx), fx = mcos(a), fy = msin(a), sx = -fy, sy = fx;
    const air = units.filter(isAir), land = units.filter(u => !isAir(u));
    const spacing = Math.max(1.5, ...land.map(u => u.d.r * 2 + 0.5)), per = Math.ceil(Math.sqrt(land.length * 1.4));
    const across = u => (u.x - cx) * sx + (u.y - cy) * sy;
    const form = land.length > 1 ? formOfGroup(land) : 'block', slot = new Map();
    if (form === 'block') {
      land.sort((p, q) => ((p.x - cx) * sx + (p.y - cy) * sy) - ((q.x - cx) * sx + (q.y - cy) * sy));
      const rows = Math.ceil(land.length / per);
      land.forEach((u, i) => {
        const row = i % rows, col = i / rows | 0;
        slot.set(u, [(col - (Math.ceil(land.length / rows) - 1) / 2) * spacing, -(row - (rows - 1) / 2) * spacing]);
      });
    } else {
      // Places are filled front to back by rank, and within a row from side to side as the units stand, so no
      // two cross on their way. The formation is centred on the point.
      const ranked = land.slice().sort((p, q) => rankOf(p) - rankOf(q) || across(p) - across(q)), put = [];
      const fill = (us, ps) => { us.sort((p, q) => across(p) - across(q)); ps = ps.slice().sort((p, q) => p[0] - q[0]); us.forEach((u, i) => put.push([u, ps[i]])); };
      if (form === 'square') {
        const back = ranked.filter(u => rankOf(u) === 2), edge = ranked.filter(u => rankOf(u) !== 2), sq = squareSlots(edge.length, back.length);
        // Round the edge in the order the units stand round their middle, from the same starting angle.
        const turn = u => matan2(-((u.x - cx) * fx + (u.y - cy) * fy), across(u));
        edge.sort((p, q) => turn(p) - turn(q)).forEach((u, i) => put.push([u, [sq.out[i][0], sq.out[i][1]]]));
        fill(back, sq.inner);
      } else {
        let i = 0;
        for (const r of formRows(form, land.length)) { fill(ranked.slice(i, i + r.length), r); i += r.length; }
      }
      let mx = 0, my = 0;
      for (const [, p] of put) { mx += p[0]; my += p[1]; }
      mx /= put.length; my /= put.length;
      for (const [u, p] of put) slot.set(u, [(p[0] - mx) * spacing, -(p[1] - my) * spacing]);
    }
    // A formation marches at its slowest unit's pace, so it holds together on the way.
    const pace = form === 'block' ? 0 : Math.min(...land.map(u => u.d.speed));
    const cover = coverPoints(S.map), given = new Set();
    for (const u of land) {
      const [ox, oy] = slot.get(u);
      let px = x + sx * ox + fx * oy, py = y + sy * ox + fy * oy;
      const cls = clsOf(u);
      // A squad whose place falls by a cover point is sent to the point itself, so an order to a point is enough.
      // A picked formation keeps its shape instead.
      let ci = u.d.men && form === 'block' ? coverNear(S.map, px, py, 1.5, given) : -1;
      if (ci >= 0 && blocked(S, cls, cellOf(cover[ci].x, cover[ci].y))) ci = -1;
      if (ci >= 0) { given.add(ci); px = cover[ci].x; py = cover[ci].y; }
      else if (blocked(S, cls, cellOf(px, py))) {
        const c = goalCells(S, cls, clamp(px | 0, 0, W - 1), clamp(py | 0, 0, H - 1))[0];
        px = c % W + 0.5; py = (c / W | 0) + 0.5;
      }
      u.ord = { t: attack ? 'amove' : 'move', x: px, y: py };
      if (ci >= 0) { u.ord.cov = ci; u.ord.stop = 0.15; }
      if (pace) u.ord.pace = pace;
      u.home = null; u.stuck = 0; u.wpT = 0;
      if (!attack) u.tgt = 0;
    }
    air.forEach((u, i) => {
      const a2 = i * 2.4, r = 1.2 * Math.sqrt(i);
      u.ord = u.d.move === 'jet' ? (u.ammo > 0 ? { t: 'attack', id: 0, x, y } : u.ord) : { t: attack ? 'amove' : 'move', x: x + mcos(a2) * r, y: y + msin(a2) * r };
      if (u.d.kamikaze && !attack) u.tgt = 0;
    });
  }

  function unitsOf(S, team, ids) {
    const out = [];
    // A broken squad hears no orders until it rallies.
    for (const id of ids) { const u = S.byId.get(id); if (u && u.team === team && !u.b && u.hp > 0 && !(u.brk && S.tick < u.brk)) out.push(u); }
    return out;
  }

  // What can be built now. Says why not as a short reason, or null when it can.
  function blockedReason(S, team, kind) {
    const P = S.P[team], d = BUILDINGS[kind] || UNITS[kind];
    if (UNITS[kind]) {
      // A unit is built in its line's form for the side's age, which an earlier form gives way to.
      const now = formOf(d.line, P.tech);
      if (now !== kind) return d.age > P.tech || !now ? 'Needs the ' + AGES[d.age].name + ' Age' : 'Now ' + UNITS[now].name;
    } else if ((d.tech || 1) > P.tech) return 'Needs the ' + AGES[d.tech].name + ' Age';
    // In King of the Hill a held town of the size for it raises a unit, up to the cap its standing houses allow.
    if (S.koth && UNITS[kind]) {
      if (!kothSlots(S, team).some(e => e.raise.includes(d.line))) return !KOTH_RAISE.town.includes(d.line) ? 'Not raised in this mode' : 'Needs a ' + (KOTH_RAISE.village.includes(d.line) ? 'village' : 'town');
      const army = S.ents.reduce((n, e) => n + (e.team === team && !e.b && e.hp > 0 ? 1 : 0), 0) + P.q.inf.length + P.q.veh.length;
      if (army >= kothCap(S, team)) return 'Army at its cap';
    } else if (d.need && !P.counts[d.need]) return 'Needs ' + nameOf(d.need, P.tech);
    if (d.shore && !S.map.seaCells) return 'Needs open water on the map';
    if (d.fish && !(S.map.fish || []).length) return 'No fishing grounds on this map';
    if (BUILDINGS[kind] && !(P.counts.hq || P.counts.fob)) return 'Needs Headquarters';
    if (d.limit) {
      const made = (P.counts[kind] || 0) + P.q[d.cat].filter(i => i.kind === kind).length;
      if (made >= d.limit) return BUILDINGS[kind] ? 'One to a side' : 'Already serving';
    }
    return null;
  }

  // Orders queued with Shift. A unit busy with an order takes a queued one after it; one with nothing to do takes
  // it at once. Any other order to units drops what was queued for them. A queued move keeps the units' spread
  // about where they stood when it was given.
  const QUEUE_MAX = 8, QUEUE_DROP = new Set(['move', 'attack', 'strike', 'guard', 'shelter', 'stop', 'capture', 'bridge', 'mend', 'harvest']);
  function queueOrder(S, team, c) {
    const us = unitsOf(S, team, c.ids);
    const busy = us.filter(u => (u.ord && u.ord.t !== 'harvest' && !u.ord.ans) || (u.oq && u.oq.length)), idle = us.filter(u => !busy.includes(u));
    let cx = 0, cy = 0;
    for (const u of busy) { cx += u.x / busy.length; cy += u.y / busy.length; }
    for (const u of busy) {
      if (u.d.cargo) continue;
      u.oq = u.oq || [];
      if (u.oq.length >= QUEUE_MAX) continue;
      u.oq.push(c.c === 'attack' ? { t: 'attack', id: c.id } : { t: 'move', x: clamp(c.x + (u.x - cx) * 0.5, 1, W - 1), y: clamp(c.y + (u.y - cy) * 0.5, 1, H - 1), a: !!c.a });
    }
    if (idle.length) apply(S, team, Object.assign({}, c, { ids: idle.map(u => u.id), queue: false }));
  }
  // A unit's next queued order, passing over any whose target has fallen or is no longer seen.
  function nextQueued(S, u) {
    while (u.oq && u.oq.length) {
      const o = u.oq.shift();
      if (o.t === 'move') { orderMove(S, [u], o.x, o.y, o.a); return; }
      const t = S.byId.get(o.id);
      if (!t || t.hp <= 0 || !seenBy(S, u.team, t) || (t.team !== u.team && shielded(S, t.team))) continue;
      if (u.d.move === 'jet') { if (u.ammo > 0 && !groundedAt(S, u.x, u.y) && !groundedAt(S, t.x, t.y)) { u.ord = { t: 'attack', id: t.id, x: t.x, y: t.y }; return; } continue; }
      u.ord = { t: 'attack', id: t.id }; u.tgt = t.id; u.wpT = 0; u.stuck = 0; u.home = null;
      return;
    }
    u.oq = null;
  }

  function apply(S, team, c) {
    const P = S.P[team];
    if (c.queue && (c.c === 'attack' || c.c === 'move') && Array.isArray(c.ids)) return queueOrder(S, team, c);
    if (QUEUE_DROP.has(c.c) && Array.isArray(c.ids)) for (const u of unitsOf(S, team, c.ids)) u.oq = null;
    // Any order to attack ends the giver's own shield.
    if (shielded(S, team)) {
      const tg = c.c === 'attack' ? S.byId.get(c.id) : null;
      const war = (tg && tg.team !== team) || c.c === 'strike' || c.c === 'bridge' || c.c === 'launch' || (c.c === 'power' && c.name === 'barrage');
      if (war) { P.shield = 0; S.ev.push({ t: 'unshield', team }); }
    }
    if (c.c === 'move') {
      const us = unitsOf(S, team, c.ids);
      if (us.length) {
        // A new order ends a stay to mend, and a scout's exploring.
        for (const u of us) { u.mend = null; u.exp = false; }
        for (const u of us) if (u.d.cargo && u.ord && u.ord.t === 'harvest') u.ord = null;
        orderMove(S, us, c.x, c.y, !!c.a);
      }
    } else if (c.c === 'form') {
      // A formation for the units, which those standing or on the move take up at once: where they stand, facing
      // as they face, or where they were going.
      if (!FORMS.includes(c.f)) return;
      const us = unitsOf(S, team, c.ids).filter(u => !isAir(u));
      for (const u of us) u.form = c.f;
      const free = us.filter(u => !u.d.cargo && (!u.ord || u.ord.t === 'move' || u.ord.t === 'amove'));
      if (free.length > 1) {
        const going = free.filter(u => u.ord);
        let tx = 0, ty = 0, hx = 0, hy = 0;
        for (const u of going.length ? going : free) { tx += going.length ? u.ord.x : u.x; ty += going.length ? u.ord.y : u.y; hx += mcos(u.a); hy += msin(u.a); }
        tx /= going.length || free.length; ty /= going.length || free.length;
        orderMove(S, free, tx, ty, going.some(u => u.ord.t === 'amove'), going.length ? undefined : matan2(hy, hx));
      }
    } else if (c.c === 'attack') {
      const t = S.byId.get(c.id);
      if (t && t.hp > 0 && !(t.team !== team && shielded(S, t.team))) for (const u of unitsOf(S, team, c.ids)) {
        if (u.d.move === 'jet') { if (u.ammo > 0 && !groundedAt(S, u.x, u.y) && !groundedAt(S, t.x, t.y)) u.ord = { t: 'attack', id: t.id, x: t.x, y: t.y }; }
        else if (u.d.cargo) continue;
        else { u.ord = { t: 'attack', id: t.id }; u.tgt = t.id; u.wpT = 0; u.stuck = 0; }
      }
    } else if (c.c === 'bridge' || c.c === 'mend') {
      // Bring a bridge down, or mend one. Engineers mend, everything armed shoots, jets bomb its middle.
      const i = c.i | 0, m = S.map.bridges[i];
      if (!m) return;
      for (const u of unitsOf(S, team, c.ids)) {
        if (c.c === 'mend') { if (u.d.engineer) { u.ord = { t: 'mend', i }; u.wpT = 0; u.stuck = 0; u.tgt = 0; } continue; }
        if (u.d.move === 'jet') { if (u.ammo > 0 && !groundedAt(S, u.x, u.y) && !groundedAt(S, (m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2)) u.ord = { t: 'attack', id: 0, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2 }; continue; }
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
    } else if (c.c === 'guard') {
      // Guard a unit or a building of the side's own.
      const g = S.byId.get(c.id);
      if (!g || g.hp <= 0 || g.team !== team) return;
      for (const u of unitsOf(S, team, c.ids)) {
        if (u === g || isAir(u) || u.d.cargo || u.d.trade || u.d.fish) continue;
        u.ord = { t: 'guard', id: g.id }; u.tgt = 0; u.home = null; u.wpT = 0; u.stuck = 0; u.mend = null; u.exp = false;
      }
    } else if (c.c === 'shelter') {
      // The general goes into the side's capitol.
      const g = S.byId.get(c.id);
      if (!g || !g.b || g.hp <= 0 || g.team !== team || !g.d.civic || g.held) return;
      for (const u of unitsOf(S, team, c.ids)) if (u.d.general) { u.ord = { t: 'shelter', id: g.id }; u.tgt = 0; u.home = null; u.stuck = 0; u.mend = null; }
    } else if (c.c === 'release') {
      const g = S.byId.get(c.id);
      if (g && g.b && g.hp > 0 && g.team === team && g.held) release(S, g);
    } else if (c.c === 'explore') {
      // Scouts set to explore, or stopped from it, where they stand.
      for (const u of unitsOf(S, team, c.ids)) { if (!canExplore(u)) continue; u.exp = !!c.on; if (u.ord && u.ord.exp) { u.ord = null; u.v = 0; } u.expWait = 0; }
    } else if (c.c === 'fallback') {
      // Whether the units fall back when badly hurt. Turned off, any going back carry on but no longer mend there.
      for (const u of unitsOf(S, team, c.ids)) { if (u.d.cargo || isAir(u)) continue; u.fb = !!c.on; if (!u.fb) u.mend = null; }
    } else if (c.c === 'stance') {
      if (!STANCES.includes(c.v)) return;
      for (const u of unitsOf(S, team, c.ids)) {
        if (u.d.cargo || isAir(u) || !armed(u)) continue;
        u.st = c.v;
        // Holding ground drops a chase in hand.
        if (c.v === 'hold' && u.ord && u.ord.ans) { u.ord = null; u.tgt = 0; }
      }
    } else if (c.c === 'stop') {
      for (const u of unitsOf(S, team, c.ids)) { u.ord = u.d.cargo ? { t: 'harvest' } : null; u.tgt = 0; u.home = null; }
    } else if (c.c === 'harvest') {
      for (const u of unitsOf(S, team, c.ids)) if (u.d.cargo) u.ord = c.cell >= 0 ? { t: 'harvest', cell: c.cell, own: true } : { t: 'harvest', sm: c.ref | 0 };
    } else if (c.c === 'capture') {
      const town = S.towns[c.town], us = unitsOf(S, team, c.ids).filter(u => u.d.men && u.kind !== 'engineer');
      us.forEach((u, i) => {
        const a = i * 2.4, r = 1 + Math.sqrt(i);
        u.ord = { t: 'capture', town: c.town, ox: mcos(a) * r, oy: msin(a) * r };
        u.wpT = 0; u.tgt = 0; u.home = null;
      });
    } else if (c.c === 'train' || c.c === 'build') {
      // A unit is ordered by its line and comes in the form of the side's age.
      const kind = c.c === 'train' && UNITS[c.kind] ? formOf(UNITS[c.kind].line, P.tech) || c.kind : c.kind;
      const d = UNITS[kind] || BUILDINGS[kind];
      // In King of the Hill a unit may be ordered from one town, which trains first from then on.
      if (S.koth && c.from >= 0 && S.towns[c.from] && S.towns[c.from].owner === team) P.townPick = c.from;
      if (!d || blockedReason(S, team, kind)) return;
      const cat = d.cat, q = P.q[cat];
      if (c.c === 'build' && q.length) return;
      if (q.length >= 9) return;
      q.push({ kind, cost: d, prog: 0, paid: 0, paidOil: 0, hold: false });
    } else if (c.c === 'repeat') {
      // A unit's line trained over and over without end, or no longer.
      const d = UNITS[c.kind];
      if (!d) return;
      P.repeat = P.repeat || {};
      if (c.on) P.repeat[d.line] = true; else delete P.repeat[d.line];
    } else if (c.c === 'research') {
      const lv = P.tech + 1, d = TECH[lv];
      if (!d || P.q.tech.length || !P.counts.hq) return;
      P.q.tech.push({ kind: 'tech' + lv, level: lv, cost: d, prog: 0, paid: 0, paidOil: 0 });
    } else if (c.c === 'upgrade') {
      const e = S.byId.get(c.id);
      if (!e || !e.b || e.team !== team || e.hp <= 0 || upBlocked(S, team, c.k, e)) return;
      e.up = { k: c.k, tier: (P.up[c.k] || 0) + 1, prog: 0, paid: 0, paidOil: 0 };
    } else if (c.c === 'unupgrade') {
      const e = S.byId.get(c.id);
      if (!e || !e.b || e.team !== team || !e.up) return;
      P.supply += e.up.paid; P.oil += e.up.paidOil; P.stats.spent -= e.up.paid; P.stats.spentOil -= e.up.paidOil;
      e.up = null;
    } else if (c.c === 'hold') {
      const it = P.q[c.cat][c.i];
      if (it && it.prog < 1) it.hold = !it.hold;
    } else if (c.c === 'cancel') {
      const q = P.q[c.cat], it = q[c.i];
      if (it) { P.supply += it.paid; P.oil += it.paidOil; P.stats.spent -= it.paid; P.stats.spentOil -= it.paidOil; q.splice(c.i, 1); }
    } else if (c.c === 'place') {
      const d = BUILDINGS[c.kind], q = P.q[d.cat], it = q[0];
      if (!it || it.kind !== c.kind || it.prog < 1) return;
      if (!fits(S, team, c.kind, c.x, c.y)) return;
      q.shift();
      addBuilding(S, c.kind, team, c.x, c.y);
      P.stats.built++;
      S.ev.push({ t: 'placed', team, kind: c.kind, x: c.x + d.w / 2, y: c.y + d.h / 2 });
    } else if (c.c === 'sell') {
      const e = S.byId.get(c.id);
      if (!e || !e.b || e.team !== team || e.hp <= 0) return;
      const P2 = S.P[team];
      P2.supply += (e.d.cost || 0) * 0.5 * (e.hp / e.max);
      // An upgrade under way is paid back in full, as a cancelled one is.
      if (e.up) { P2.supply += e.up.paid; P2.oil += e.up.paidOil; P2.stats.spent -= e.up.paid; P2.stats.spentOil -= e.up.paidOil; e.up = null; }
      e.hp = 0;
      S.ev.push({ t: 'sold', id: e.id, x: e.x, y: e.y });
      kill(S, e, team);
    } else if (c.c === 'repair') {
      const e = S.byId.get(c.id);
      if (e && e.b && e.team === team) e.repairing = !e.repairing;
    } else if (c.c === 'rally') {
      const e = S.byId.get(c.id);
      if (e && e.b && e.team === team) { e.rally = [c.x, c.y]; makePrimary(S, team, e); }
    } else if (c.c === 'primary') {
      // Units of the building's kind come out of it from now on.
      const e = S.byId.get(c.id);
      if (e && e.b && e.team === team && TRAINERS.includes(e.kind)) makePrimary(S, team, e);
    } else if (c.c === 'power') {
      callPower(S, team, c.name, c.x, c.y);
    } else if (c.c === 'income') {
      P.income = clamp(+c.v || 1, 0.3, 2);
    } else if (c.c === 'restart') {
      restartSlot(S, team, { shield: +c.shield || 0 });
    } else if (c.c === 'raze') {
      if (!S.P[team].alive) return;
      razeSlot(S, team);
      // Given up, not beaten, so the others are told so.
      S.P[team].alive = false; S.P[team].forfeit = true;
      territory(S); recount(S);
      S.ev.push({ t: 'fallen', team, forfeit: true });
      mark(S, team, 'out');
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
    mark(S, team, 'launch');
    for (const P of S.P) if (P.team !== team) { ownEvent(S, P.team, 'missile'); S.ev.push({ t: 'alert', team: P.team, x, y }); }
    S.shots.push({ w: 'nuke', kind: 'nuke', team, by: s.id, t: 0, dur, x, y, tx: x, ty: y, tz: 0 });
  }

  function callPower(S, team, name, x, y) {
    const P = S.P[team], d = POWERS[name];
    if (!d || P.cooldown[name] > 0 || P.tech < d.tech || callOff(P, d) || P.supply < d.cost) return;
    // A levy with no town held would be wasted.
    if (name === 'levy' && !S.towns.some(t => t.owner === team)) return;
    P.supply -= d.cost; P.stats.spent += d.cost;
    P.cooldown[name] = d.cd;
    if (name === 'uav') {
      // The aircraft sets off a little short of the target on the line from its base, and watches for the call's time.
      const b = S.bases[team], dd = mhypot(x - b[0], y - b[1]) || 1, k = Math.min(1, RECON_IN / dd);
      const sx = clamp(x + (b[0] - x) * k, 1, W - 1), sy = clamp(y + (b[1] - y) * k, 1, H - 1);
      const u = spawn(S, S.P[team].tech >= 5 ? 'uavp' : 'recon', team, sx, sy, { ox: x, oy: y, life: d.life, a: matan2(y - sy, x - sx) });
      u.pa = u.a;
      S.ev.push({ t: 'uav', team, x, y, dur: d.life });
      // The sides whose own ground it passes over are told it is overhead.
      for (const Q of S.P) if (Q.team !== team && !Q.out && !atPeace(S, team, Q.team) && S.ents.some(e => e.b && e.team === Q.team && e.hp > 0 && mhypot(e.x - x, e.y - y) < RECON_R + 12)) ownEvent(S, Q.team, 'reconover');
    } else if (name === 'levy') {
      // Each town held pays LEVY_NOW seconds of its dues at once, and is marked to pay less for LEVY_FOR seconds.
      let ore = 0, oil = 0, n = 0;
      for (const t of S.towns) if (t.owner === team) {
        const p = townPay(S, t.id, team);
        ore += p.ore * LEVY_NOW; oil += p.oil * LEVY_NOW; n++;
        t.lv = S.tick + LEVY_FOR * HZ;
      }
      P.supply += ore; P.oil += oil; P.stats.townIn += ore; P.stats.oilIn += oil;
      const cap = S.ents.find(e => e.b && e.team === team && e.hp > 0 && e.d.civic);
      S.ev.push({ t: 'levy', team, ore, oil, towns: n, x: cap ? cap.x : x, y: cap ? cap.y : y });
    } else if (name === 'flare') {
      S.sweeps.push({ team, x, y, r: d.r, until: S.tick + d.life * HZ, flare: S.tick });
      S.ev.push({ t: 'flare', team, x, y, dur: d.life });
    } else if (name === 'barrage') {
      for (let i = 0; i < 12; i++) {
        const delay = 1.5 + i * 0.28, a = S.rand() * TAU, r = Math.sqrt(S.rand()) * d.r, sx = x + mcos(a) * r, sy = y + msin(a) * r;
        S.shots.push({ w: 'barrage', kind: 'barrage', team, by: 0, t: 0, dur: delay, x: sx, y: sy, tx: sx, ty: sy, tz: 0 });
        S.ev.push({ t: 'incoming', x: sx, y: sy, dur: delay, team });
      }
    } else if (name === 'sat') {
      // The rocket rises from the base, and the constellation's first pass comes SAT_RISE after.
      const b = S.bases[team];
      P.sat = { start: S.tick + SAT_RISE, until: S.tick + SAT_RISE + d.life * HZ, x, y, h: spellHash(S.seed + 4007 + team * 131, S.tick) };
      S.ev.push({ t: 'satlaunch', team, x: b[0], y: b[1] });
    } else if (name === 'para') {
      const from = S.bases[team];
      S.ev.push({ t: 'plane', team, x: from[0], y: from[1], tx: x, ty: y, dur: 4 });
      const flight = mhypot(x - from[0], y - from[1]) / 26 + 1;
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU, sx = x + mcos(a) * 2, sy = y + msin(a) * 2;
        const u = spawn(S, formOf('inf', S.P[team].tech), team, sx, sy, { drop: flight + 3 + i * 0.4 });
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
        if (o.id <= u.id || o.b || o.hp <= 0 || o.drop > 0 || isAir(o) || (o.d.move === 'naval') !== (u.d.move === 'naval')) return;
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
    if (S.tick % 10 === 7) stepLightning(S);
    S.bridges.forEach((b, i) => {
      if (b.fix && S.tick >= b.fix) raiseBridge(S, i);
      if (b.c4 && S.tick >= b.c4) { const m = S.map.bridges[i]; S.ev.push({ t: 'boom', x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, size: 3 }); dropBridge(S, i); }
    });
    // Worn ground hardens a step at a time into tracks, and what is no longer used grows back over.
    if (S.tick % TRACK_EVERY === TRACK_EVERY / 2) {
      const T = S.trail, G = S.gnd, cells = [], bits = [];
      let sum = 0;
      for (let c = 0; c < N; c++) {
        let v = T[c];
        const lv = (G[c] >> 5) & 3;
        if (!v && !lv) continue;
        if (v) T[c] = v = Math.max(0, v - 2);
        sum = (sum + v) | 0;
        const nl = lv < 3 && v >= TRACK_AT[lv] ? lv + 1 : lv > 0 && v < TRACK_AT[lv - 1] * 0.6 ? lv - 1 : lv;
        if (nl !== lv) { cells.push(c); bits.push((G[c] & ~96) | (nl << 5)); }
      }
      S.trailSum = sum;
      setGround(S, cells, bits);
    }
    // After enough rain the rivers rise over the fords, and they open again as the water goes down.
    if (S.tick % 20 === 0) {
      const w = sky(S), want = S.flooded ? w.flood > 0.65 : w.flood > 0.9;
      if (want !== S.flooded) {
        S.flooded = want;
        const fc = S.map.fordCells, wc = S.map.wadeCells || [];
        setGround(S, fc.concat(wc), fc.map(() => want ? 7 : 4 | 16).concat(wc.map(() => want ? 7 : 1 | 4 | 16)));
        S.ev.push({ t: 'flood', on: want });
      }
    }
    // The sky turns at the start of a spell, and a storm is called half a minute before it comes.
    if (S.tick > 0 && S.tick % SPELL === 0) {
      const k = S.tick / SPELL, now = spellOf(S.seed, k, skyOf(S)), was = spellOf(S.seed, k - 1, skyOf(S));
      if (now !== (EASE[was] || was)) S.ev.push({ t: 'weather', kind: now, was: EASE[was] || was });
    }
    // Heavy weather passes part way through its spell.
    if (S.tick % SPELL === HEAVY) {
      const kd = spellOf(S.seed, S.tick / SPELL | 0, skyOf(S));
      if (EASE[kd]) S.ev.push({ t: 'weather', kind: EASE[kd], was: kd, passed: true });
    }
    // Half a minute's warning of weather that grounds the aircraft, as stormsoon or sandsoon.
    if ((S.tick + 30 * HZ) % SPELL === 0) {
      const k = (S.tick + 30 * HZ) / SPELL, next = spellOf(S.seed, k, skyOf(S));
      if (GROUNDING[next] && !GROUNDING[spellOf(S.seed, k - 1, skyOf(S))]) S.ev.push({ t: 'weather', kind: next + 'soon' });
    }
  }

  function step(S) {
    use(S);
    S.fieldQueue = 0;
    for (const a of S.ais) a.tick(S);
    rehash(S);
    // Unlimited: every side's stores are filled each tick before anything is paid for.
    if (S.free) for (const P of S.P) { P.supply = FREE_STOCK; P.oil = FREE_STOCK; }
    for (const q of S.cmds) {
      if (S.keepLog) S.log.push({ tick: S.tick, team: q.team, c: q.c });
      // A bad command is dropped the same way everywhere, so the world goes on.
      try { if (S.P[q.team]) apply(S, q.team, q.c); } catch (e) { S.ev.push({ t: 'badcmd', team: q.team }); }
    }
    S.cmds.length = 0;
    stepEconomy(S);
    stepIntel(S);
    stepSat(S);
    stepTowns(S);
    stepPoints(S);
    const danger = S.tick % SCAT_EVERY === 0 && S.shots.length ? dangerOf(S) : null;
    // Every other tick the units act from the last to the first, so no side's units always act first. Those made
    // during the tick act after the rest.
    const nE = S.ents.length;
    for (let j = 0; j < S.ents.length; j++) {
      const e = S.ents[S.tick & 1 && j < nE ? nE - 1 - j : j];
      if (!e || e.hp <= 0) continue;
      if (danger && danger.length) scatter(S, e, danger);
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
    // Each side looks every half second, on a tick of its own, so the sides' sight is spread over the ticks.
    for (let t = S.tick % 10; t < S.P.length; t += 10) vision(S, t);
    S.sweeps = S.sweeps.filter(s => s.until > S.tick);
    // A side whose last building falls is out, and what it had left goes with it. The last side standing wins.
    if (!S.over && S.tick % HZ === 0) {
      for (const P of S.P) if (P.alive) {
        // In King of the Hill a side's base is its towns, and its score too must last.
        const noBase = S.koth ? !S.towns.some(t => t.owner === P.team) || S.score[P.team] <= 0 : !S.ents.some(e => e.b && e.team === P.team && e.hp > 0), noGen = S.regicide && !S.ents.some(e => e.team === P.team && e.hp > 0 && (e.b ? !!e.held && !!UNITS[e.held.kind].general : e.d.general));
        if (!noBase && !noGen) continue;
        P.alive = false;
        razeSlot(S, P.team);
        territory(S); recount(S);
        S.ev.push({ t: 'fallen', team: P.team, regicide: noGen && !noBase });
        mark(S, P.team, 'out');
      }
      const left = S.P.filter(P => P.alive);
      if (left.length <= 1) {
        const winner = left.length ? left[0].team : -1;
        S.over = { winner, tick: S.tick };
        S.ev.push({ t: 'over', winner });
        if (winner >= 0) mark(S, winner, 'won');
        record(S, true);
      }
    }
    if (!S.over) record(S);
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
    HZ, DT, RES, UNITS, BUILDINGS, WEAPONS, TECH, POWERS, DIFFICULTY, LAYOUT, SIZES, MAPS, spread, use,
    AGES, MAX_AGE, POWER_AGE, LINES, LINE_ORDER, formOf, lineCount, nameOf, armOf,
    get W() { return W; }, get H() { return H; }, get VW() { return VW; }, get VH() { return VH; },
    KOTH_SCORE, KOTH_BLEED, KOTH_EVERY, KOTH_R, KOTH_RAISE, KOTH_SLOTS, KOTH_CALLS, kothTowns, kothCap, kothSlots,
    ORE_KINDS, fishWater, dustWall, dustAt, groundedAt, dataOn, satUp, satPass, newGame, step, push, spawn, addBuilding, scoreOf, worth, SERIES, pickFrom, fits, spotFor, roomy, blockedReason, near, rehash, seenBy, terrainAt, heightAt, waterLevel, townPay, townShare, callNeed, callOff, CIVIC_PAY, CIVIC_REACH, LEVY_NOW, LEVY_FOR, placeCheck, trainersOf, TRAINER_OF, los, isAir, armed, cellOf, summary, exitOf,
    mulberry, noiser, clamp, lerp, smooth, angleTo, toXY, toUV, gap, setSize, save, load, hashOf, restartSlot, razeSlot, makeMap, mapFor, layoutFor,
    msin, mcos, matan2, mhypot,
    BRIDGE_HP, SPELL, SKIES, WEATHERS, nightAt, skyOf, offGoing, route, weatherAt, sky, dayAt, spellOf, bridgeAt, clsOf, houseHp, hurtBridge, ignite, shielded,
    coverPoints, coverNear, COVER_R, COVER_ARC, FORMS, formOfGroup, STANCES,
    FB_AT, PIN, TRAINERS, producerOf, canExplore, nameFor, townName, theatreOf, UPGRADES, UP_AGE, upCost, upNote, upsAt, upK, upBlocked, hpOf, rangeOf, capOf, showersAt, showerAt,
  };
})();
if (typeof module !== 'undefined') module.exports = Rules;
