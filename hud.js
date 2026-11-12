// Mapmaker's War, the commander's desk. The sidebar, the minimap, what is drawn over the picture, and
// every way of giving an order, by mouse, keys or fingers.
const Hud = (() => {
  const { HZ, UNITS, BUILDINGS, TECH, POWERS, clamp, terrainAt } = Rules;
  // The map's size is read from the world being shown, since a duel and the shared world differ.
  let W = 128, H = 128;
  // Each slot's colour on the overlay and its plate behind a pictogram, light enough to read on dark ground.
  const SLOT_CSS = ['#6fb0ff', '#ee3a22', '#6fd47f', '#b98af0', '#ffae52', '#4fd8d4', '#cdf044', '#c99a6c'];
  const SLOT_PLATE = ['#2f6fd6', '#c8402f', '#2f9a48', '#7a48c8', '#d8781a', '#1c9a98', '#9a9612', '#7a5230'];
  const $ = id => document.getElementById(id);
  const fmt = n => Math.floor(n).toLocaleString('en-US');

  // Tactical map symbols, friendly in a rectangle and hostile in a diamond, as on a real overlay.
  function symbol(g, x, y, s, sym, hostile, color) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = color; g.lineWidth = Math.max(1, s * 0.1); g.lineJoin = 'round';
    g.fillStyle = 'rgba(8,10,8,0.62)';
    const w = s, h = s * 0.68;
    g.beginPath();
    if (hostile) { g.moveTo(0, -s * 0.72); g.lineTo(s * 0.85, 0); g.lineTo(0, s * 0.72); g.lineTo(-s * 0.85, 0); g.closePath(); }
    else g.rect(-w, -h, w * 2, h * 2);
    g.fill(); g.stroke();
    const k = hostile ? 0.55 : 0.8, a = w * k, b = h * k;
    g.beginPath();
    const cross = () => { g.moveTo(-a, -b); g.lineTo(a, b); g.moveTo(a, -b); g.lineTo(-a, b); };
    const oval = () => g.ellipse(0, 0, a * 0.72, b * 0.62, 0, 0, 6.3);
    const dot = r => { g.moveTo(r, 0); g.arc(0, 0, r, 0, 6.3); };
    switch (sym) {
      case 'inf': cross(); break;
      case 'at': cross(); g.moveTo(-a * 0.5, b); g.lineTo(0, -b); g.lineTo(a * 0.5, b); break;
      case 'eng': g.moveTo(-a, -b * 0.4); g.lineTo(a, -b * 0.4); g.moveTo(-a, -b * 0.4); g.lineTo(-a, b); g.moveTo(0, -b * 0.4); g.lineTo(0, b); g.moveTo(a, -b * 0.4); g.lineTo(a, b); break;
      case 'snp': cross(); dot(b * 0.3); break;
      case 'hero': g.moveTo(-a * 0.3, -b); g.lineTo(a * 0.5, -b * 0.1); g.lineTo(-a * 0.1, b * 0.1); g.lineTo(a * 0.3, b); break;
      case 'ship': g.moveTo(-a, -b * 0.1); g.lineTo(a * 0.7, -b * 0.1); g.lineTo(a, -b * 0.5); g.moveTo(-a, -b * 0.1); g.lineTo(-a * 0.7, b * 0.5); g.lineTo(a * 0.6, b * 0.5); g.lineTo(a * 0.7, -b * 0.1); g.moveTo(-a * 0.1, -b * 0.1); g.lineTo(-a * 0.1, -b); break;
      case 'boat': g.moveTo(-a * 0.8, 0); g.lineTo(a * 0.8, 0); g.lineTo(a * 0.5, b * 0.5); g.lineTo(-a * 0.5, b * 0.5); g.closePath(); g.moveTo(0, 0); g.lineTo(0, -b * 0.9); g.lineTo(a * 0.5, -b * 0.1); break;
      case 'dock': g.rect(-a * 0.8, -b * 0.2, a * 1.6, b * 0.5); g.moveTo(-a * 0.5, -b * 0.2); g.lineTo(-a * 0.5, -b * 0.9); g.lineTo(a * 0.5, -b * 0.9); break;
      case 'trade': g.rect(-a * 0.7, -b * 0.4, a * 1.4, b * 0.9); g.moveTo(-a * 0.7, -b * 0.4); g.lineTo(a * 0.7, b * 0.5); g.moveTo(a * 0.7, -b * 0.4); g.lineTo(-a * 0.7, b * 0.5); break;
      case 'sup': case 'sup2': g.moveTo(-a, b * 0.5); g.lineTo(a, b * 0.5); if (sym === 'sup2') { g.moveTo(0, -b); g.lineTo(0, b * 0.2); g.moveTo(-a * 0.4, -b * 0.4); g.lineTo(a * 0.4, -b * 0.4); } break;
      case 'rec': g.moveTo(-a, b); g.lineTo(a, -b); break;
      case 'ifv': oval(); g.moveTo(-a * 0.7, 0); g.lineTo(a * 0.7, 0); break;
      case 'arm': oval(); break;
      case 'hvy': oval(); g.moveTo(-a * 0.36, -b * 0.5); g.lineTo(-a * 0.36, b * 0.5); g.moveTo(a * 0.36, -b * 0.5); g.lineTo(a * 0.36, b * 0.5); break;
      case 'aa': g.arc(0, b * 0.9, b * 1.3, Math.PI * 1.15, Math.PI * 1.85); break;
      case 'art': dot(b * 0.36); break;
      case 'hel': g.moveTo(-a, -b); g.lineTo(a, b); g.lineTo(a, -b); g.lineTo(-a, b); g.closePath(); break;
      case 'jet': g.moveTo(0, -b); g.lineTo(a, b * 0.6); g.lineTo(0, b * 0.1); g.lineTo(-a, b * 0.6); g.closePath(); break;
      case 'uav': g.moveTo(-a, -b * 0.6); g.lineTo(0, b * 0.6); g.lineTo(a, -b * 0.6); break;
      case 'sat': g.rect(-a * 0.18, -b * 0.3, a * 0.36, b * 0.6); g.rect(-a, -b * 0.22, a * 0.66, b * 0.44); g.rect(a * 0.34, -b * 0.22, a * 0.66, b * 0.44); break;
      case 'dat': for (let i = -1; i <= 1; i++) { g.moveTo(-a * 0.6, i * b * 0.45); g.lineTo(a * 0.6, i * b * 0.45); } break;
      case 'flare': for (let i = 0; i < 8; i++) { const an = i * 0.785; g.moveTo(Math.cos(an) * a * 0.3, Math.sin(an) * b * 0.3); g.lineTo(Math.cos(an) * a, Math.sin(an) * b); } break;
      case 'par': g.arc(0, 0, a * 0.7, Math.PI, 0); g.moveTo(-a * 0.7, 0); g.lineTo(0, b); g.lineTo(a * 0.7, 0); break;
      // A dome over columns, and a stack of coins.
      case 'cap': g.arc(0, -b * 0.1, a * 0.45, Math.PI, 0); for (let i = -2; i <= 2; i++) { g.moveTo(i * a * 0.3, -b * 0.1); g.lineTo(i * a * 0.3, b * 0.7); } g.moveTo(-a * 0.75, b * 0.7); g.lineTo(a * 0.75, b * 0.7); break;
      case 'levy': for (let i = 0; i < 3; i++) { g.moveTo(a * 0.55, b * (0.6 - i * 0.5)); g.ellipse(0, b * (0.6 - i * 0.5), a * 0.55, b * 0.22, 0, 0, Math.PI * 2); } break;
      default: g.rect(-a * 0.5, -b * 0.5, a, b);
    }
    g.stroke();
    g.restore();
  }

  // How far round a clicked enemy the marking reaches, in cells.
  const STRIKE_R = 6;

  // Small pictures of each kind of unit for when the models are too small, drawn in fg on a ground of bg in a
  // space ten units to s. A unit's picture follows its form, so a horse archer is a horseman and not a car.
  const PIC = { spear: 'spear', pike: 'spear', archer: 'bow', longbow: 'bow', crossbow: 'bow', grenadier: 'gren', outrider: 'horse', dragoon: 'horse', knight: 'horse', cuirassier: 'horse', chariot: 'chariot', elephant: 'elephant', oxcart: 'cart', wagon: 'cart', supcart: 'cart2', catapult: 'siege', trebuchet: 'siege', motorbike: 'bike', mech: 'walker', titan: 'walker', biplane: 'biplane' };
  const picOf = e => PIC[e.kind] || e.d.sym;
  function glyph(g, sym, fg, bg) {
    g.fillStyle = fg; g.strokeStyle = fg; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 1.4;
    const box = (a, b, c, d) => g.fillRect(a, b, c, d);
    const ln = (pts) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); };
    const dot = (a, b, rr) => { g.beginPath(); g.arc(a, b, rr, 0, 6.3); g.fill(); };
    const ring = (a, b, rr) => { g.beginPath(); g.arc(a, b, rr, 0, 6.3); g.stroke(); };
    const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); };
    const man = (dx = 0) => { dot(dx, -4.6, 1.5); ln([[dx, -3], [dx, 2]]); ln([[dx, 2], [dx - 1.8, 6]]); ln([[dx, 2], [dx + 1.8, 6]]); ln([[dx - 2.2, -1], [dx + 2.2, -1]]); };
    // A beast side on, facing right, its body at (x, y) and w long: a horse, an ox or a team.
    const beast = (x, y, w, h = 1.8) => { g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 6.3); g.fill(); for (const k of [-0.8, -0.45, 0.45, 0.8]) ln([[x + k * w, y + h * 0.6], [x + k * w, y + h + 3.6]]); poly([[x + w * 0.7, y - h * 0.4], [x + w + 1.6, y - h - 2.6], [x + w + 3.2, y - h - 1.8], [x + w + 2.6, y - h - 0.9], [x + w + 1.2, y - h * 0.2]]); ln([[x - w, y - h * 0.3], [x - w - 1.4, y + h + 0.6]]); };
    switch (sym) {
      case 'inf': man(-2.5); man(2.5); ln([[-0.5, -2.5], [4.5, -4.5]]); break;
      case 'spear': man(-2.5); man(2.5); ln([[-0.3, 5], [-0.3, -7.5]]); ln([[4.7, 5], [4.7, -7.5]]); break;
      case 'at': man(-1); g.lineWidth = 2.2; ln([[-5, -3.5], [5, -1.5]]); break;
      case 'bow': man(-2.5); g.beginPath(); g.arc(1.4, -1, 4.6, -1.15, 1.15); g.stroke(); g.lineWidth = 0.7; ln([[3.4, -5.2], [3.4, 3.2]]); break;
      case 'gren': man(-2); dot(3.6, -4.6, 2); ln([[4.6, -6.3], [5.6, -7.4]]); break;
      case 'eng': man(0); ln([[2.5, 0], [6, -3.5]]); ln([[5, -4.5], [7, -2.5]]); break;
      case 'snp': man(-1.5); ln([[0, -1.6], [8, -3.6]]); dot(3, -3, 1); break;
      case 'hero': g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 2.6 : 6; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.fill(); break;
      case 'horse': beast(-1, 0.6, 4.2); dot(-1.2, -5.6, 1.4); ln([[-1.2, -4.2], [-1.2, -1]]); break;
      case 'chariot': beast(3.4, 0.2, 2.6, 1.4); box(-7.2, -2.2, 5.4, 3); ring(-4.6, 3, 2.4); ln([[-1.8, -0.6], [1, -0.2]]); dot(-4.6, -4.8, 1.3); ln([[-4.6, -3.5], [-4.6, -2.2]]); break;
      case 'elephant': g.beginPath(); g.ellipse(-1.5, -0.4, 5.6, 3.4, 0, 0, 6.3); g.fill(); for (const x of [-5.4, -2.2, 1.4]) box(x, 1.5, 2.2, 4.3); dot(4.6, -1.4, 2.8); g.lineWidth = 1.8; ln([[6.8, -0.4], [7.8, 2.6], [7.2, 5.4]]); g.lineWidth = 1.1; ln([[5.6, 1.2], [8.2, 1.6]]); box(-4, -6.6, 4.8, 2.2); break;
      case 'cart': case 'cart2': beast(4.2, 0, 2.4, 1.3); box(-7.6, -2.6, 7.2, 3.6); ring(-4, 3, 2.4); ln([[-0.4, -0.6], [2, -0.6]]); if (sym === 'cart2') { g.fillStyle = bg; box(-5.4, -1.3, 3, 1); box(-4.4, -2.3, 1, 3); } break;
      case 'ship': poly([[-8, 0], [6, 0], [8, -2.5], [-8, -1]]); poly([[-7, 1], [6, 1], [4, 4], [-6, 4]]); ln([[-1, -1], [-1, -7]]); ln([[-1, -6.5], [3.5, -2]]); break;
      case 'boat': poly([[-6, 1], [6, 1], [4, 4], [-4, 4]]); ln([[0, 1], [0, -6]]); ln([[0, -5.5], [4, -0.5]]); break;
      case 'trade': box(-7, -3, 6, 5); box(0, -1.5, 5, 3.5); dot(-4.5, 3.5, 1.6); dot(2.5, 3.5, 1.6); ln([[5.5, 0], [8, 0]]); break;
      case 'sup': box(-7, -3, 9, 5); box(2.5, -1, 4.5, 3); dot(-4.5, 3.5, 1.6); dot(4, 3.5, 1.6); break;
      case 'sup2': box(-7, -3, 9, 5); box(2.5, -1, 4.5, 3); dot(-4.5, 3.5, 1.6); dot(4, 3.5, 1.6); g.fillStyle = bg; box(-4, -2.4, 3, 0.9); box(-3, -3.4, 0.9, 3); break;
      case 'rec': box(-6, -1.5, 12, 4); box(-2.5, -4, 4, 2.5); ln([[0, -3], [6, -4]]); dot(-3.5, 3.5, 1.5); dot(3.5, 3.5, 1.5); break;
      case 'bike': ring(-4.6, 3, 2.5); ring(4.6, 3, 2.5); ln([[-4.6, 3], [-1, -0.5], [3, -0.5], [4.6, 3]]); dot(-0.8, -5.2, 1.4); ln([[-0.8, -3.8], [-1.6, -0.6]]); ln([[-0.8, -3.2], [3, -2]]); break;
      case 'ifv': box(-6.5, -2, 13, 4.5); box(-2, -4.5, 4, 2.5); ln([[1, -3.5], [7, -3.5]]); for (const xx of [-4.5, -1.5, 1.5, 4.5]) dot(xx, 3.6, 1.2); break;
      case 'arm': box(-7, -0.5, 14, 4); box(-3.5, -3.5, 6, 3); ln([[2, -2], [8.5, -2]]); break;
      case 'hvy': box(-7.5, -0.5, 15, 4.5); box(-4, -4, 7, 3.5); ln([[2, -3], [9, -3]]); ln([[2, -1.5], [9, -1.5]]); break;
      case 'walker': box(-4, -6.5, 8, 4.4); ln([[-2.4, -2], [-4.4, 1.6], [-2.8, 6]]); ln([[2.4, -2], [4.4, 1.6], [2.8, 6]]); g.lineWidth = 1.8; ln([[3.6, -4.4], [8.6, -4.4]]); break;
      case 'aa': box(-6.5, 0, 13, 3.5); box(-2.5, -2.5, 5, 2.5); ln([[0, -2], [5, -7]]); ln([[1.5, -2], [6.5, -7]]); break;
      case 'art': box(-7, 0, 14, 3); dot(-4.5, 4, 1.4); dot(4.5, 4, 1.4); g.save(); g.rotate(-0.45); box(-5, -4.5, 9, 3.5); g.restore(); break;
      case 'siege': ln([[-7, 5], [7, 5]]); ln([[-4.5, 5], [-0.5, -3], [3.5, 5]]); g.lineWidth = 1.8; ln([[-6, -5.4], [5, 1.4]]); dot(-6, -5.6, 1.8); dot(-5, 5, 1.4); dot(5, 5, 1.4); break;
      case 'flare': for (let i = 0; i < 8; i++) { const an = i * 0.785, r0 = 1.6, r1 = i % 2 ? 4.5 : 6.5; ln([[Math.cos(an) * r0, Math.sin(an) * r0], [Math.cos(an) * r1, Math.sin(an) * r1]]); } dot(0, 0, 1.4); break;
      case 'uav': ln([[-5, -4], [5, 4]]); ln([[5, -4], [-5, 4]]); for (const [a, b] of [[-5, -4], [5, 4], [5, -4], [-5, 4]]) dot(a, b, 1.6); break;
      case 'hel': ln([[-7.5, -4], [7.5, -4]]); ln([[0, -4], [0, -2]]); g.beginPath(); g.ellipse(1, 0.5, 4, 2.4, 0, 0, 6.3); g.fill(); ln([[-2.5, 0.5], [-7.5, -1.5]]); break;
      case 'jet': poly([[7.5, 0], [-5, -6], [-3, 0], [-5, 6]]); break;
      case 'biplane': box(-7.5, -3.6, 15, 1.4); box(-6.5, 1.6, 13, 1.4); ln([[-4, -2.2], [-4, 1.6]]); ln([[4, -2.2], [4, 1.6]]); dot(0, -0.2, 2.2); ln([[0, -5.6], [0, 5.2]]); break;
      default: box(-4, -4, 8, 8);
    }
  }
  // A tag over a group of one side's units: a plate with each kind's picture and how many there are. Ours is a
  // plate with square ends, an enemy's has pointed ends. In pen and ink it is paper washed in the side's colour
  // with the pictures in ink, a chosen group ruled twice. Otherwise the pictures are white on the side's plate.
  function tagPlate(g, x, y, s, items, o) {
    const cw = s * 2.3, nw = s * 0.95, h = s * 0.82, pt = o.foe ? h * 0.9 : 0;
    const w = items.reduce((a, it) => a + cw + (it.n > 1 ? nw : 0), 0), x0 = x - w / 2;
    g.save();
    g.globalAlpha = o.alpha;
    const path = (grow) => {
      const l = x0 - grow, r = x0 + w + grow, t = y - h - grow, b = y + h + grow;
      g.beginPath();
      if (o.foe) { g.moveTo(l, t); g.lineTo(r, t); g.lineTo(r + pt, y); g.lineTo(r, b); g.lineTo(l, b); g.lineTo(l - pt, y); g.closePath(); }
      else if (g.roundRect) g.roundRect(l, t, r - l, b - t, s * 0.22);
      else g.rect(l, t, r - l, b - t);
    };
    path(0);
    g.fillStyle = o.fill; g.fill();
    g.strokeStyle = o.line; g.lineWidth = Math.max(1, s * (o.ink ? 0.13 : 0.09)); g.stroke();
    if (o.on && o.ink) { path(s * 0.32); g.lineWidth = Math.max(1, s * 0.11); g.stroke(); }
    let cx = x0;
    for (const it of items) {
      g.save(); g.translate(cx + cw / 2, y); g.scale(s / 10, s / 10); glyph(g, it.sym, o.fg, o.fill); g.restore();
      cx += cw;
      if (it.n > 1) {
        g.fillStyle = o.fg; g.font = `700 ${Math.round(s * 1.25)}px ${o.mono}`; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(String(it.n), cx - s * 0.15, y + s * 0.12); cx += nw;
      }
    }
    g.restore();
    return [x0 - pt, y - h, w + 2 * pt, 2 * h];
  }
  // Each building's mark on the map in each age, after its name in that age.
  const SHORT = { hq: 'HQ', power: 'PWR', refinery: 'ORE', barracks: 'BAR', factory: 'FAC', radar: 'RAD', airfield: 'AIR', fob: 'FOB', derrick: 'OIL', silo: 'SILO', capitol: 'CAP', bunker: 'MG', atgun: 'AT', sam: 'SAM', rail: 'RAIL' };
  const SHORT_NAME = {
    Citadel: 'CIT', Castle: 'CAS', Fort: 'FORT', 'Command Nexus': 'CMD', 'Fusion Plant': 'FUS', Smelter: 'SMLT', Stables: 'STBL', Foundry: 'FDRY', Fabricator: 'FAB',
    Watchtower: 'WTCH', 'Signal Tower': 'SIG', 'Radio Station': 'RAD', 'Sensor Array': 'SENS', Skyport: 'SKY', Outpost: 'OUT', Redoubt: 'RDT', 'Orbital Lance': 'LNCE',
    'Archer Tower': 'TWR', 'Musket Redoubt': 'MSKT', 'MG Nest': 'MG', 'Pulse Turret': 'PLS', Ballista: 'BAL', Springald: 'SPR', 'Cannon Battery': 'CAN', 'Field Gun': 'GUN', 'Coil Gun': 'COIL', 'AA Battery': 'AA', 'Laser AA': 'LAS',
  };
  const shortOf = (kind, age) => SHORT_NAME[Rules.nameOf(kind, age)] || SHORT[kind] || '';

  function create(world, game) {
    // Whether the look draws the overlay in ink: inked effects, ghost plans and the map key.
    const inked = () => world.style.hud === 'ink';
    const view = $('view'), gl = $('gl'), ov = $('ov'), og = ov.getContext('2d');
    const mini = $('map'), mg = mini.getContext('2d');
    const state = {
      tab: 'bld', sel: [], groups: {}, mode: null, drag: null, hover: null, hoverTown: -1, alerts: [], marks: [], lastAlert: null, attackMove: false, tipKind: null, seenTabs: {},
      keys: new Set(), mouse: { x: 0, y: 0, in: false }, touches: new Map(), pinch: null, lastTap: 0, cams: {}, camAt: {}, cameos: {}, hintShown: 0, side: 0, touchUsed: false, ping: 0,
    };
    const S = () => game.S, team = () => Math.max(0, game.team), P = () => game.S.P[team()];

    const TABS = [
      { id: 'bld', label: 'Base', key: 'Z' }, { id: 'def', label: 'Defence', key: 'X' }, { id: 'inf', label: 'Men', key: 'C' },
      { id: 'veh', label: 'Armor', key: 'V' }, { id: 'air', label: 'Air', key: 'B' }, { id: 'sea', label: 'Sea', key: ',' }, { id: 'pow', label: 'Calls', key: 'N' },
    ];
    // Everything a side may come to build; the sidebar shows what its age has opened.
    const ALL = {
      bld: ['power', 'refinery', 'barracks', 'factory', 'radar', 'derrick', 'fob', 'airfield', 'dock', 'silo', 'datacenter', 'capitol'],
      def: ['bunker', 'atgun', 'sam', 'rail'],
      pow: ['tech', 'flare', 'uav', 'barrage', 'para', 'sat', 'launch', 'levy'],
    };
    const LISTS = { bld: [], def: [], inf: [], veh: [], air: [], sea: [], pow: [] };
    // The build keys run along the top row, past P, which pauses, to [ for a tenth picture.
    const KEYS = 'QWERTYUIO[';
    // The cards show only what the side's age has opened: one card for each line, in its form for that age, and
    // the buildings, defences and calls of that age.
    const sameLine = (a, b) => a === b || (!!UNITS[a] && !!UNITS[b] && UNITS[a].line === UNITS[b].line);
    let listAge = 0, listFish = null;
    function lineLists(age) {
      // A map with no fishing grounds has no fishing boats to offer.
      const fish = !!(game.S && (game.S.map.fish || []).length);
      if (age === listAge && fish === listFish) return;
      listAge = age; listFish = fish;
      for (const cat of ['inf', 'veh', 'air', 'sea']) LISTS[cat] = Rules.LINE_ORDER[cat].filter(l => fish || l !== 'fish').map(l => Rules.formOf(l, age)).filter(Boolean);
      const opened = k => k === 'tech' || ((k === 'launch' ? BUILDINGS.silo : BUILDINGS[k] || POWERS[k]).tech || 1) <= age;
      for (const cat in ALL) LISTS[cat] = ALL[cat].filter(opened);
    }

    const tabs = $('tabs');
    TABS.forEach(t => {
      const b = document.createElement('button');
      b.id = 'tab-' + t.id; b.className = 'tab'; b.innerHTML = `<span>${t.label}</span><i></i>`;
      b.title = `${t.label} (${t.key})`;
      b.addEventListener('click', () => { pickTab(t.id); game.audio.ui('click'); });
      tabs.appendChild(b);
    });
    function pickTab(id) {
      // The Sea tab shows only on a map with open water, and the Dock only there too.
      const wet = !!(S() && S().map.seaCells > 200), koth = !!(S() && S().koth);
      $('tab-sea').hidden = !wet || koth;
      if (id === 'sea' && !wet) id = 'bld';
      // In King of the Hill nothing is built and no aircraft or ships are raised, so the towns' recruits come first.
      for (const k of ['bld', 'def', 'air']) $('tab-' + k).hidden = koth;
      if (koth && (id === 'bld' || id === 'def' || id === 'air' || id === 'sea')) id = 'inf';
      $('kraise').hidden = !koth;
      state.tab = id;
      lineLists(P() ? P().tech : 1);
      for (const t of TABS) $('tab-' + t.id).classList.toggle('on', t.id === id);
      buildCams();
    }

    function camInfo(k) {
      if (k === 'tech') { const lv = P().tech + 1, d = TECH[lv]; return d ? { name: 'To the ' + d.name, cost: d.cost, oil: d.oil, note: d.note + ' Every unit you have takes its new form.', sym: 'hq', time: d.time } : { name: 'The last age', note: 'Every age is reached.', sym: 'hq' }; }
      if (k === 'launch') return { name: 'Launch Missile', note: 'Fire the silo at any point on the map.', sym: 'sil' };
      const d = POWERS[k] || UNITS[k] || BUILDINGS[k];
      // Buildings and calls go by their age's names.
      return d && d.names ? Object.assign({}, d, { name: Rules.nameOf(k, P() ? P().tech : 1) }) : d;
    }

    // Every picture is a drawing in the look's own inks, the units' line drawings and the models inked alike.
    const axoImg = k => state.cameos[k] ? ' class="axo"' : '';
    // A building's picture in its owner's age, anything else's by its kind.
    const picKey = e => { const P = e.b && game.S.P[e.team], k = P ? world.ageKey(e.kind, P.tech) : e.kind; return state.cameos[k] ? k : e.kind; };
    function buildCams() {
      const box = $('cams');
      box.textContent = '';
      state.cams = {};
      LISTS[state.tab].forEach((k, i) => {
        const b = document.createElement('button'), info = camInfo(k), img = state.cameos[k];
        b.className = 'cam'; b.dataset.kind = k;
        b.innerHTML = `<canvas width="4" height="3"></canvas><b class="nm"></b><em class="ct"></em><u class="qty"></u><s class="key">${KEYS[i] || ''}</s><span class="state"></span>`;
        // A card a new age brought is drawn in, after those before it, and marked new for a few seconds.
        if (state.fresh && state.fresh.has(k) && performance.now() < state.freshUntil) {
          b.classList.add('fresh'); b.style.animationDelay = `${i * 70}ms`;
          const n = document.createElement('i'); n.className = 'new'; n.textContent = 'new'; b.append(n);
        }
        b.querySelector('.nm').textContent = info.name;
        const c = b.querySelector('canvas');
        if (img) b.style.setProperty('--img', `url(${img})`);
        else { c.width = 132; c.height = 88; symbol(c.getContext('2d'), 66, 44, 26, info.sym, false, '#e8d9a8'); b.style.setProperty('--img', `url(${c.toDataURL()})`); }
        // Every picture is already in the look's inks, so it is laid on as it is.
        if (img) b.classList.add('axo');
        c.remove();
        // Alt-click, Option on a Mac, sets a unit to be trained over and over without end, or stops it.
        b.addEventListener('click', e => { e.preventDefault(); if (e.altKey && UNITS[k]) camRepeat(k); else camClick(k, e.shiftKey ? 5 : 1); });
        b.addEventListener('contextmenu', e => { e.preventDefault(); camCancel(k); });
        b.addEventListener('pointerenter', () => { state.tipKind = k; drawTip(); });
        b.addEventListener('pointerleave', () => { if (state.tipKind === k) { state.tipKind = null; drawTip(); } });
        // A held finger cancels, as a right click does.
        let hold = 0;
        b.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') { state.tipKind = k; drawTip(); hold = setTimeout(() => { camCancel(k); hold = -1; }, 500); } });
        for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => { if (hold > 0) clearTimeout(hold); });
        box.appendChild(b);
        state.cams[k] = b;
      });
      updateCams(true);
    }

    function queueOf(k) {
      const d = UNITS[k] || BUILDINGS[k];
      return d && d.cat ? P().q[d.cat] : null;
    }

    function camClick(k, n = 1) {
      const s = S(), t = team(), p = P();
      if (s.over) return;
      if (k === 'tech') { if (p.q.tech.length) return; if (TECH[p.tech + 1]) { game.order(s, t, { c: 'research' }); game.audio.ui('click'); } return; }
      if (k === 'launch') { const si = s.ents.find(e => e.b && e.team === t && e.kind === 'silo' && e.charge >= e.d.charge); if (si) enter({ type: 'launch' }); return; }
      if (POWERS[k]) {
        const d = POWERS[k];
        if (p.cooldown[k] > 0 || p.tech < d.tech || Rules.callOff(p, d) || p.supply < d.cost) { game.audio.ui('deny'); return; }
        // A call with no spot to pick goes at once.
        if (d.now) {
          if (k === 'levy' && !s.towns.some(q => q.owner === t)) { say('Hold a town to levy it.'); game.audio.ui('deny'); return; }
          game.order(s, t, { c: 'power', name: k }); game.audio.ui('click');
          return;
        }
        enter({ type: 'power', name: k });
        return;
      }
      const why = Rules.blockedReason(s, t, k), q = queueOf(k);
      if (BUILDINGS[k]) {
        const head = q[0];
        if (head && head.kind === k && head.prog >= 1) { enter({ type: 'place', kind: k }); return; }
        if (head && head.kind === k) { game.order(s, t, { c: 'hold', cat: BUILDINGS[k].cat, i: 0 }); return; }
        if (head) { say('One structure at a time. Place or cancel the current one.'); game.audio.ui('deny'); return; }
        if (why) { say(why + '.'); game.audio.ui('deny'); return; }
        game.order(s, t, { c: 'build', kind: k });
        game.audio.ui('click');
        return;
      }
      if (why) { say(why + '.'); game.audio.ui('deny'); return; }
      // In King of the Hill the town chosen on the map trains first.
      for (let i = 0; i < n; i++) game.order(s, t, s.koth && state.townPick >= 0 ? { c: 'train', kind: k, from: state.townPick } : { c: 'train', kind: k });
      game.audio.ui('click');
    }
    const repeating = k => { const p = P(), d = UNITS[k]; return !!(p && d && p.repeat && p.repeat[d.line]); };
    function camRepeat(k) {
      const s = S(), on = !repeating(k), why = Rules.blockedReason(s, team(), k);
      if (on && why) { say(why + '.'); game.audio.ui('deny'); return; }
      game.order(s, team(), { c: 'repeat', kind: k, on });
      say(on ? `${UNITS[k].name}: trained over and over. Alt-click the card again to stop.` : `${UNITS[k].name}: no longer repeated.`);
      game.audio.ui('click');
    }
    function camCancel(k) {
      const q = queueOf(k);
      if (!q) return;
      for (let i = q.length - 1; i >= 0; i--) if (sameLine(q[i].kind, k)) { game.order(S(), team(), { c: 'cancel', cat: (UNITS[k] || BUILDINGS[k]).cat, i }); game.audio.ui('click'); return; }
    }

    let camClock = 0;
    function updateCams(force) {
      const now = performance.now();
      if (!force && now - camClock < 110) return;
      camClock = now;
      if (!S()) return;
      const s = S(), t = team(), p = P();
      for (const k in state.cams) {
        const b = state.cams[k], st = b.querySelector('.state'), qty = b.querySelector('.qty'), ct = b.querySelector('.ct');
        const info = camInfo(k);
        let off = false, ready = false, prog = 0, label = '', count = 0;
        const inHand = [];
        if (k === 'tech') {
          const q = p.q.tech[0];
          off = !TECH[p.tech + 1];
          if (q) { prog = q.prog; label = 'RESEARCH'; }
          b.querySelector('.nm').textContent = info.name;
        } else if (k === 'launch') {
          const si = s.ents.find(e => e.b && e.team === t && e.kind === 'silo');
          off = !si; if (si) { prog = si.charge / si.d.charge; ready = prog >= 1; if (ready) prog = 0; label = ready ? 'FIRE' : si ? Math.ceil(si.d.charge - si.charge) + 's' : ''; }
        } else if (POWERS[k]) {
          const cd = p.cooldown[k], d = POWERS[k];
          off = Rules.callOff(p, d) || p.tech < d.tech;
          if (cd > 0) { prog = 1 - cd / d.cd; label = Math.ceil(cd) + 's'; }
        } else {
          off = !!Rules.blockedReason(s, t, k);
          const q = queueOf(k);
          for (const it of q) if (sameLine(it.kind, k)) count++;
          // The units of this line in hand at once: the rules give each building that trains them the next item in
          // the queue not held, its chosen building first.
          if (UNITS[k]) {
            const halls = Rules.trainersOf(s, t, Rules.TRAINER_OF[UNITS[k].cat]);
            let slot = 0;
            for (const it of q) { if (slot >= halls.length) break; if (it.hold) continue; const by = halls[slot++]; if (sameLine(it.kind, k)) inHand.push([it.prog, by]); }
          }
          // Units are trained at several buildings at once, so a unit's card shows the one of its kind furthest on.
          let head = q[0];
          if (UNITS[k]) for (const it of q) if (sameLine(it.kind, k) && (!sameLine(head.kind, k) || it.prog > head.prog)) head = it;
          if (head && sameLine(head.kind, k)) { prog = head.prog; if (head.prog >= 1 && BUILDINGS[k]) { ready = true; prog = 0; label = 'READY'; } else if (head.hold) label = 'HOLD'; else if (head.short) label = 'FUNDS'; }
          else if (head && BUILDINGS[k]) off = true;
          if (count) off = false;
        }
        // While power is short: work under way says it goes at half speed, the silo's and the data center's cards
        // that they have none, and the power plant's card is marked as the thing to build.
        if (p.low) {
          if ((k === 'launch' && p.counts.silo) || (k === 'datacenter' && p.counts.datacenter)) label = 'NO POWER';
          else if (prog > 0 && !ready && !label && !POWERS[k] && k !== 'launch') label = '½ SPEED';
        }
        b.classList.toggle('wanted', !!p.low && k === 'power');
        b.classList.toggle('off', off);
        b.classList.toggle('ready', ready);
        b.style.setProperty('--p', (prog * 360).toFixed(1) + 'deg');
        b.classList.toggle('busy', prog > 0);
        if (st.textContent !== label) st.textContent = label;
        // A line set to repeat is marked with a looping arrow beside its count. Several in hand at once read as ×n,
        // with those still waiting after, a thin bar for each along the card's foot, and the buildings at work named
        // in its note.
        const many = inHand.length > 1;
        const show = (many ? `×${inHand.length}` + (count > inHand.length ? ` +${count - inHand.length}` : '') : count > 1 && UNITS[k] ? count : '') + (UNITS[k] && repeating(k) ? ' ↻' : '');
        if (qty.textContent !== String(show)) qty.textContent = show;
        let ln = b.querySelector('.lanes');
        if (many || ln) {
          if (!ln) { ln = document.createElement('span'); ln.className = 'lanes'; b.append(ln); }
          const n = many ? inHand.length : 0;
          while (ln.children.length < n) ln.append(document.createElement('i'));
          while (ln.children.length > n) ln.lastChild.remove();
          inHand.slice(0, n).forEach(([pg], i) => { const w = (pg * 100).toFixed(1) + '%'; if (ln.children[i].style.width !== w) ln.children[i].style.width = w; });
        }
        state.camAt[k] = many ? 'In training at ' + inHand.map(([, by]) => Rules.nameOf(by.kind, p.tech) + (by.primary ? ' (chosen)' : '')).join(', ') : '';
        const price = info.cost ? '$' + info.cost + (info.oil ? ' · ' + info.oil + ' oil' : '') : '';
        if (ct.textContent !== price) ct.textContent = price;
      }
      // A tab with something ready shows a light.
      for (const c of ['bld', 'def']) $('tab-' + c).classList.toggle('lit', !!(p.q[c][0] && p.q[c][0].prog >= 1));
      const silo = s.ents.some(e => e.b && e.team === t && e.kind === 'silo' && e.charge >= e.d.charge);
      $('tab-pow').classList.toggle('lit', silo);
      drawTip();
    }

    function drawTip() {
      const tip = $('tip'), k = state.tipKind;
      if (!k) { if (tip.dataset.k) { tip.dataset.k = ''; tip.innerHTML = '<p class="idle">Hover a picture for what it does.</p>'; } return; }
      // A call names the building it waits on.
      const pw = POWERS[k], need = pw && P() && !P().counts[Rules.callNeed(pw)] ? Rules.callNeed(pw) : null;
      const info = camInfo(k), why = UNITS[k] || BUILDINGS[k] ? Rules.blockedReason(S(), team(), k) : need ? 'Needs ' + Rules.nameOf(need, P().tech) : null;
      const at = state.camAt[k];
      const html = `<h3>${info.name}</h3><p class="price">${info.cost ? '$' + info.cost : ''}${info.oil ? ' &middot; ' + info.oil + ' oil' : ''}${info.power ? ' &middot; ' + (info.power > 0 ? '+' : '') + info.power + ' power' : ''}</p><p>${info.note || ''}</p>${at ? `<p class="at">${at}</p>` : ''}${why ? `<p class="why">${why}</p>` : ''}`;
      if (tip.innerHTML !== html) tip.innerHTML = html;
      tip.dataset.k = k;
    }

    function enter(mode) {
      state.mode = mode;
      if (mode.type === 'place') { state.ghost = null; moveGhost(); }
      view.classList.add('aiming');
      showBanner(mode.type === 'place' ? `Place ${BUILDINGS[mode.kind].name} inside your border` : mode.type === 'launch' ? 'Pick a target for the missile' : `Pick a spot for ${POWERS[mode.name].name}`, true);
    }
    function leave() {
      state.mode = null; state.attackMove = false;
      world.setGhost(null);
      view.classList.remove('aiming');
      showBanner('');
    }
    function moveGhost() {
      const m = state.mode;
      if (!m || m.type !== 'place') return;
      const d = BUILDINGS[m.kind], p = world.pick(state.mouse.x, state.mouse.y);
      if (!p) return;
      let x = Math.round(p.x - d.w / 2), y = Math.round(p.y - d.h / 2);
      if (d.well) {
        let best = null, bd = 9;
        for (const w of S().map.wells) { const r = Math.hypot(w.x - p.x, w.y - p.y); if (r < bd) { bd = r; best = w; } }
        if (best) { x = best.x - 1; y = best.y - 1; }
      }
      // A dock finds the water's edge itself: the nearest place within three cells that takes it.
      if (d.shore && !Rules.fits(S(), team(), m.kind, x, y)) {
        let bd = 99, bx = x, by = y;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const r = dx * dx + dy * dy;
          if (r < bd && Rules.fits(S(), team(), m.kind, x + dx, y + dy)) { bd = r; bx = x + dx; by = y + dy; }
        }
        x = bx; y = by;
      }
      const pc = Rules.placeCheck(S(), team(), m.kind, x, y), pl = P();
      // A building that draws power, placed now, would leave the side short: said before it is placed.
      const after = pl.prod - pl.use + Math.min(0, d.power || 0), short = !S().free && pl.tech >= Rules.POWER_AGE && d.power < 0 && after < 0;
      world.setGhost({ kind: m.kind, x, y, ok: pc.ok, why: pc.why, cells: pc.cells, power: short ? `Power will run short: ${pl.use - (d.power || 0)}/${pl.prod}` : '' });
      state.ghost = { x, y };
    }

    let bannerText = '';
    function showBanner(t, stay) {
      if (t === bannerText) return;
      bannerText = t;
      const b = $('banner');
      b.textContent = t; b.hidden = !t;
    }

    // Short reports. Each stays at least four seconds so it can be read.
    function say(text, kind = '') {
      const log = $('log');
      for (const c of log.children) if (c.textContent === text) { c.remove(); break; }
      const d = document.createElement('div');
      d.className = 'line ' + kind; d.textContent = text;
      log.appendChild(d);
      while (log.children.length > 4) log.firstChild.remove();
      setTimeout(() => d.classList.add('gone'), 5000);
      setTimeout(() => d.remove(), 5800);
    }

    function select(list, add) {
      if (!add) state.sel = [];
      for (const e of list) if (!state.sel.includes(e)) state.sel.push(e);
      state.selDirty = true;
    }
    const alive = e => e.hp > 0 && S().byId.get(e.id) === e;

    function entAt(px, py) {
      let best = null, bd = 1e9;
      // Pulled far back a unit is a few pixels across, so it is found within a wider reach.
      const reach = state.plates && state.plates.length ? 18 : 13;
      for (const o of world.onScreen) {
        const r = Math.max(reach, o.r * 1.15), d = Math.hypot(o.x - px, o.y - py);
        if (!o.e.b && d < r && d < bd) { bd = d; best = o.e; }
      }
      if (best) return best;
      // A click on a group's plate is a click on the unit of that group nearest it, the chosen plates drawn last
      // and so on top checked first.
      const H = (state.plateH || 12) / 2 + 2;
      for (let i = (state.plates || []).length - 1; i >= 0; i--) {
        const q = state.plates[i];
        if (Math.abs(px - q.x) > q.w / 2 + 3 || Math.abs(py - q.y) > H) continue;
        let near = null, nd = 1e9;
        for (const o of q.ents) { const d = Math.hypot(o.x - px, o.y - py); if (o.e.hp > 0 && d < nd) { nd = d; near = o.e; } }
        if (near) return near;
      }
      const p = world.pick(px, py);
      if (!p) return null;
      const c = Rules.cellOf(p.x, p.y), id = S().occ[c], e = id ? S().byId.get(id) : null;
      if (e && (e.team === team() || world.onScreen.some(o => o.e === e))) return e;
      return null;
    }

    function clickSelect(px, py, add, dbl) {
      const e = entAt(px, py);
      if (dbl && e && !e.b && e.team === team()) {
        select(world.onScreen.filter(o => o.e.team === team() && o.e.kind === e.kind).map(o => o.e), add);
        return;
      }
      if (e) {
        if (add && state.sel.includes(e)) { state.sel = state.sel.filter(q => q !== e); state.selDirty = true; return; }
        select([e], add && e.team === team() && !e.b);
        if (e.team === team() && !e.b) game.audio.ack(e);
        if (e.b && e.team === team()) { const tab = e.kind === 'barracks' ? 'inf' : e.kind === 'factory' ? 'veh' : e.kind === 'airfield' ? 'air' : e.kind === 'radar' || e.kind === 'silo' || e.kind === 'capitol' ? 'pow' : e.kind === 'hq' ? 'bld' : null; if (tab && tab !== state.tab) pickTab(tab); }
      } else if (!add) { select([]); pickTown(px, py); }
    }
    // King of the Hill: a click on the ground in one of the side's own towns makes it the one that recruits.
    function pickTown(px, py) {
      const s = S(), g = s && s.koth && world.pick(px, py);
      if (!g) return;
      let best = null, bd = 7;
      for (const n of s.towns) if (n.owner === team() && Math.hypot(n.x - g.x, n.y - g.y) < bd) { bd = Math.hypot(n.x - g.x, n.y - g.y); best = n; }
      if (!best || state.townPick === best.id) return;
      state.townPick = best.id;
      say(`${Rules.townName(s, best.id)} recruits now.`);
      game.audio.ui('click');
      updateCams(true);
    }

    function boxSelect(x0, y0, x1, y1, add) {
      const a = Math.min(x0, x1), b = Math.min(y0, y1), c = Math.max(x0, x1), d = Math.max(y0, y1);
      let got = world.onScreen.filter(o => !o.e.b && o.e.team === team() && o.x >= a && o.x <= c && o.y >= b && o.y <= d).map(o => o.e);
      const fighters = got.filter(u => !u.d.cargo);
      if (fighters.length) got = fighters;
      select(got, add);
      if (got.length) game.audio.ack(got[0]);
    }

    function orderIds() { return state.sel.filter(e => alive(e) && !e.b && e.team === team()).map(e => e.id); }
    function marker(x, y, color) { state.marks.push({ x, y, t: 0, color }); }
    // A sum that rises from where it was earned, as a caravan's pay at a post.
    function pop(x, y, text) { (state.pops || (state.pops = [])).push({ x, y, text, t: 0 }); }

    function smart(px, py, forceAttack) {
      const s = S(), t = team();
      if (s.over) return;
      const ids = orderIds(), g = world.pick(px, py);
      if (!g) return;
      const blds = state.sel.filter(e => alive(e) && e.b && e.team === t);
      if (!ids.length) {
        if (blds.length) { for (const b of blds) game.order(s, t, { c: 'rally', id: b.id, x: g.x, y: g.y }); marker(g.x, g.y, '#7fe0a0'); game.audio.ui('click'); }
        return;
      }
      const e = entAt(px, py), us = state.sel.filter(u => alive(u) && !u.b);
      if (e && e.team !== t) {
        // Marks the enemy and every enemy seen near it. Alt picks the one alone, and Shift adds it to those the units
        // are to take in turn.
        if (state.shift) { game.order(s, t, { c: 'attack', ids, id: e.id, queue: true }); say('Target added.'); }
        else if (state.alt) game.order(s, t, { c: 'attack', ids, id: e.id });
        else game.order(s, t, { c: 'strike', ids, id: e.id, x: e.x, y: e.y, r: STRIKE_R });
        marker(e.x, e.y, '#ff5a40');
        game.audio.ack(us[0], true);
        return;
      }
      // The general shelters in the side's capitol, and any sent with him guard it.
      if (e && e.b && e.team === t && e.d.civic && us.some(u => u.d.general)) {
        const gen = us.filter(u => u.d.general), rest = us.filter(u => !u.d.general && !Rules.isAir(u) && !u.d.cargo).map(u => u.id);
        game.order(s, t, { c: 'shelter', ids: gen.map(u => u.id), id: e.id });
        if (rest.length) game.order(s, t, { c: 'guard', ids: rest, id: e.id });
        marker(e.x, e.y, '#7fc0ff'); game.audio.ack(gen[0]);
        say(`The general goes into the ${Rules.nameOf(e.kind, s.P[t].tech)}.`);
        return;
      }
      if (e && e.b && e.team === t && us.some(u => u.d.engineer)) { game.order(s, t, { c: 'attack', ids: us.filter(u => u.d.engineer).map(u => u.id), id: e.id }); marker(e.x, e.y, '#7fe0a0'); return; }
      // One of the side's own, a unit not among those sent or a building: they guard it.
      if (e && e.team === t && !(e.b && e.kind === 'refinery' && us.some(u => u.d.cargo)) && !ids.includes(e.id)) {
        const gs = us.filter(u => !Rules.isAir(u) && !u.d.cargo && u.id !== e.id).map(u => u.id);
        if (gs.length) {
          game.order(s, t, { c: 'guard', ids: gs, id: e.id }); marker(e.x, e.y, '#7fc0ff'); game.audio.ack(us[0]);
          say(`Guarding the ${(e.b ? Rules.nameOf(e.kind, s.P[t].tech) : e.d.name).toLowerCase()}.`);
          return;
        }
      }
      // A bridge: engineers mend or rebuild it, and an attack order on it brings it down.
      const bi = e ? -1 : Rules.bridgeAt(s, g.x, g.y);
      if (bi >= 0) {
        const st = s.bridges[bi], eng = us.filter(u => u.d.engineer);
        if (eng.length && !st.fix && (st.hp < Rules.BRIDGE_HP || st.c4)) {
          game.order(s, t, { c: 'mend', ids: eng.map(u => u.id), i: bi }); marker(g.x, g.y, '#7fe0a0'); game.audio.ack(eng[0]);
          say(st.hp > 0 ? 'Engineer sent to mend the bridge.' : 'Engineer sent to rebuild the bridge.');
          return;
        }
        if (forceAttack && st.hp > 0) { game.order(s, t, { c: 'bridge', ids, i: bi }); marker(g.x, g.y, '#ff5a40'); game.audio.ack(us[0], true); say('Bringing the bridge down.'); return; }
      }
      const town = s.towns.find(n => Math.hypot(n.x - g.x, n.y - g.y) < 3.5);
      if (town && town.owner !== t && us.some(u => u.d.capture)) {
        const rest = us.filter(u => !u.d.capture).map(u => u.id);
        game.order(s, t, { c: 'capture', ids: us.filter(u => u.d.capture).map(u => u.id), town: town.id });
        if (rest.length) game.order(s, t, { c: 'move', ids: rest, x: g.x, y: g.y, a: true });
        marker(town.x, town.y, '#ffd34d'); game.audio.ack(us[0]);
        return;
      }
      if (us.every(u => u.d.cargo) && s.ore[Rules.cellOf(g.x, g.y)]) { game.order(s, t, { c: 'harvest', ids, cell: Rules.cellOf(g.x, g.y) }); marker(g.x, g.y, '#ffd34d'); game.audio.ack(us[0]); return; }
      if (e && e.kind === 'refinery' && us.some(u => u.d.cargo)) { game.order(s, t, { c: 'harvest', ids, cell: -1, ref: e.id }); return; }
      // Infantry sent near a cover point go to the point itself.
      const snap = us.some(u => u.d.men) ? tacSnap(s, g.x, g.y) : null;
      if (snap) { g.x = snap.x; g.y = snap.y; }
      game.order(s, t, { c: 'move', ids, x: g.x, y: g.y, a: !!forceAttack, queue: !!state.shift });
      marker(g.x, g.y, forceAttack ? '#ffa040' : '#7fe0a0');
      game.audio.ack(us[0], forceAttack);
    }

    function useMode(px, py) {
      const m = state.mode, g = world.pick(px, py);
      if (!g) return;
      if (m.type === 'place') {
        moveGhost();
        const q = state.ghost;
        if (q && Rules.fits(S(), team(), m.kind, q.x, q.y)) {
          game.order(S(), team(), { c: 'place', kind: m.kind, x: q.x, y: q.y });
          game.audio.ui('place');
          leave();
        } else { game.audio.ui('deny'); say(BUILDINGS[m.kind].shore ? 'A dock goes at the water\'s edge by open water, near your border.' : 'That ground will not take it. Stay inside your border, on flat open ground.'); }
      } else if (m.type === 'power') {
        game.order(S(), team(), { c: 'power', name: m.name, x: g.x, y: g.y }); marker(g.x, g.y, '#ffa040'); game.audio.ui('click'); leave();
      } else if (m.type === 'launch') {
        game.order(S(), team(), { c: 'launch', x: g.x, y: g.y }); marker(g.x, g.y, '#ff5a40'); leave();
      } else if (m.type === 'amove') {
        smart(px, py, true); leave();
      }
    }

    // Mouse and touch share one path through pointer events.
    const rect = () => view.getBoundingClientRect();
    const local = e => { const r = rect(); return [e.clientX - r.left, e.clientY - r.top]; };

    function down(e) {
      // The top bar and the notes live inside the view. A press on them is theirs, not the map's.
      if (e.target !== view && e.target !== gl && e.target !== ov) return;
      state.alt = e.altKey; state.shift = e.shiftKey;
      if (!game.playing) return;
      e.preventDefault();
      game.audio.wake();
      const [x, y] = local(e);
      view.setPointerCapture?.(e.pointerId);
      if (e.pointerType === 'touch') {
        state.touchUsed = true;
        state.touches.set(e.pointerId, { x, y, x0: x, y0: y, t: performance.now(), moved: false });
        if (state.touches.size === 2) {
          const [a, b] = [...state.touches.values()];
          state.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), dist: world.cam.dist, yaw: world.cam.yaw };
          clearTimeout(state.lp); state.drag = null;
        } else {
          state.lp = setTimeout(() => {
            const t = state.touches.get(e.pointerId);
            if (t && !t.moved && state.touches.size === 1) { state.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y, box: true, touch: true }; navigator.vibrate?.(10); }
          }, 320);
        }
        return;
      }
      state.mouse.x = x; state.mouse.y = y;
      // A middle button is a mouse's, so its wheel zooms from here on.
      if (e.button === 1) { pad = false; state.pan = { x, y, cx: world.cam.x, cy: world.cam.y, yaw: world.cam.yaw }; return; }
      if (e.button === 2) { if (state.mode) { leave(); return; } state.rdown = { x, y, moved: false }; return; }
      if (state.mode) { useMode(x, y); return; }
      state.drag = { x0: x, y0: y, x1: x, y1: y, box: false, add: e.shiftKey };
    }

    function moveView(dx, dy) {
      // Screen drag moves the ground under the finger.
      const c = world.cam, k = c.dist * 2 * Math.tan(13 * Math.PI / 180) / world.vh;
      const rx = -Math.sin(c.yaw), ry = Math.cos(c.yaw), fx = Math.cos(c.yaw), fy = Math.sin(c.yaw);
      c.x += (-dx * rx + dy * fx / Math.sin(c.pitchNow || c.pitch)) * k;
      c.y += (-dx * ry + dy * fy / Math.sin(c.pitchNow || c.pitch)) * k;
    }

    function move(e) {
      const [x, y] = local(e);
      if (e.pointerType === 'touch') {
        const t = state.touches.get(e.pointerId);
        if (!t) return;
        const dx = x - t.x, dy = y - t.y;
        t.x = x; t.y = y;
        if (Math.hypot(t.x - t.x0, t.y - t.y0) > 10) { if (!t.moved) clearTimeout(state.lp); t.moved = true; }
        if (state.touches.size === 2 && state.pinch) {
          const [a, b] = [...state.touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), c = world.cam;
          c.dist = clamp(state.pinch.dist * state.pinch.d / d, c.minD, c.maxD);
          c.yaw = state.pinch.yaw - (ang - state.pinch.ang);
          moveView(dx / 2, dy / 2);
          return;
        }
        if (state.drag && state.drag.box) { state.drag.x1 = x; state.drag.y1 = y; return; }
        state.mouse.x = x; state.mouse.y = y;
        if (state.mode && state.mode.type === 'place') moveGhost();
        else if (t.moved) moveView(dx, dy);
        return;
      }
      state.mouse.x = x; state.mouse.y = y; state.mouse.in = true;
      if (state.pan) {
        const c = world.cam;
        if (e.altKey || e.ctrlKey) c.yaw = state.pan.yaw + (x - state.pan.x) * 0.006;
        else { moveView(e.movementX, e.movementY); }
      }
      if (state.rdown && Math.hypot(x - state.rdown.x, y - state.rdown.y) > 6) { state.rdown.moved = true; moveView(e.movementX, e.movementY); }
      if (state.drag) {
        state.drag.x1 = x; state.drag.y1 = y;
        if (Math.hypot(x - state.drag.x0, y - state.drag.y0) > 6) state.drag.box = true;
      }
      if (state.mode) moveGhost();
    }

    function up(e) {
      const [x, y] = local(e);
      if (e.pointerType === 'touch') {
        const t = state.touches.get(e.pointerId);
        state.touches.delete(e.pointerId);
        clearTimeout(state.lp);
        if (state.touches.size < 2) state.pinch = null;
        if (state.drag && state.drag.box) { boxSelect(state.drag.x0, state.drag.y0, state.drag.x1, state.drag.y1); state.drag = null; return; }
        if (!t || t.moved) return;
        const now = performance.now(), dbl = now - state.lastTap < 300;
        state.lastTap = now;
        if (state.mode) { state.mouse.x = x; state.mouse.y = y; useMode(x, y); return; }
        const ee = entAt(x, y);
        // A tap on your own unit selects it. With units chosen, a tap anywhere else is an order.
        if (ee && ee.team === team()) { clickSelect(x, y, false, dbl); return; }
        if (orderIds().length) { smart(x, y, state.attackMove); return; }
        if (state.sel.some(q => q.b && q.team === team())) { select([]); return; }
        clickSelect(x, y, false, false);
        return;
      }
      if (e.button === 1) { state.pan = null; return; }
      if (e.button === 2) { const r = state.rdown; state.rdown = null; if (r && !r.moved && !state.mode) smart(x, y); return; }
      if (state.drag) {
        const d = state.drag; state.drag = null;
        if (d.box) boxSelect(d.x0, d.y0, x, y, d.add);
        else {
          const now = performance.now(), dbl = now - state.lastTap < 280;
          state.lastTap = now;
          clickSelect(x, y, d.add, dbl);
        }
      }
    }

    view.addEventListener('pointerdown', down);
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', e => { state.touches.delete(e.pointerId); state.drag = null; state.rdown = null; state.pan = null; });
    view.addEventListener('pointerleave', () => { state.mouse.in = false; });
    view.addEventListener('contextmenu', e => e.preventDefault());
    // Zooms about a screen point, so the ground under the cursor or the fingers stays put.
    function zoomAt(px, py, factor) {
      const c = world.cam, before = world.pick(px, py);
      c.dist = clamp(c.dist * factor, c.minD, c.maxD);
      world.place();
      const after = before && world.pick(px, py);
      if (after) { c.x += before.x - after.x; c.y += before.y - after.y; world.place(); }
    }
    // A trackpad pinch reaches Chrome and Firefox as a wheel with ctrl held, and zooms. A two-finger swipe pans. A mouse
    // wheel zooms by a step a notch. A wheel moves in lines, or on a Mac in fractional accelerated steps, or elsewhere
    // in whole notches of a hundred or so after a pause. A trackpad moves in whole steps, nearly always with some
    // sideways movement. A step that shows neither follows the last device seen, and a mouse until a trackpad shows.
    let pad = false, lastWheel = -1e9;
    const wheelKind = e => {
      const now = performance.now(), gap = now - lastWheel;
      lastWheel = now;
      if (e.ctrlKey) return 'pinch';
      if (e.deltaMode !== 0) return (pad = false, 'wheel');
      if (e.deltaX !== 0 && !e.shiftKey) return (pad = true, 'pad');
      if (!Number.isInteger(e.deltaY)) return (pad = false, 'wheel');
      if (Math.abs(e.deltaY) >= 50 && gap > 250) return (pad = false, 'wheel');
      return pad ? 'pad' : 'wheel';
    };
    state.wheelKind = wheelKind;
    view.addEventListener('wheel', e => {
      e.preventDefault();
      if (!game.playing) return;
      const [x, y] = local(e), kind = wheelKind(e);
      if (kind === 'pinch') { pad = true; zoomAt(x, y, Math.exp(clamp(e.deltaY, -120, 120) * 0.009)); return; }
      if (kind === 'pad') { moveView(-e.deltaX, -e.deltaY); if (state.mode) moveGhost(); return; }
      // A notch zooms a tenth at least, however small the step the system reports for it.
      const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (px) zoomAt(x, y, Math.exp(Math.sign(px) * clamp(Math.abs(px) * 0.0015, 0.1, 0.25)));
    }, { passive: false });
    // Safari sends a pinch as gesture events, with a scale since the start and a twist in degrees.
    let gesture = null;
    view.addEventListener('gesturestart', e => { e.preventDefault(); trackpad = true; gesture = { dist: world.cam.dist, yaw: world.cam.yaw }; });
    view.addEventListener('gesturechange', e => {
      e.preventDefault();
      if (!gesture || !game.playing) return;
      const [x, y] = local(e);
      zoomAt(x, y, gesture.dist / Math.max(0.05, e.scale) / world.cam.dist);
      world.cam.yaw = gesture.yaw - (e.rotation || 0) * Math.PI / 180;
    });
    view.addEventListener('gestureend', e => { e.preventDefault(); gesture = null; });
    // Outside the picture a pinch would zoom the page itself, which only blurs it.
    document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());

    function keyDown(e) {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (!game.playing) { if (e.code === 'Enter' && !$('title').hidden) game.menuEnter(); return; }
      const k = e.code, s = S(), t = team();
      state.keys.add(k);
      if (/^Digit[1-9]$/.test(k)) {
        const n = k[5];
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); state.groups[n] = state.sel.filter(alive); say(`Group ${n} set, ${state.groups[n].length} units.`); return; }
        const g = (state.groups[n] || []).filter(alive);
        if (g.length) {
          const again = state.sel.length === g.length && state.sel.every(q => g.includes(q)) && performance.now() - (state.groupT || 0) < 400;
          state.groupT = performance.now();
          select(g);
          if (again) world.focus(g[0].x, g[0].y);
        }
        return;
      }
      const tabKey = { KeyZ: 'bld', KeyX: 'def', KeyC: 'inf', KeyV: 'veh', KeyB: 'air', Comma: 'sea', KeyN: 'pow' }[k];
      if (tabKey) { pickTab(tabKey); return; }
      const slot = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3, KeyT: 4, KeyY: 5, KeyU: 6, KeyI: 7, KeyO: 8, BracketLeft: 9 }[k];
      if (slot !== undefined) { const c = LISTS[state.tab][slot]; if (c) camClick(c, e.shiftKey ? 5 : 1); return; }
      if (k === 'KeyA') { if (orderIds().length) enter({ type: 'amove' }), showBanner('Attack-move: click a spot', true); return; }
      if (k === 'KeyS') { const ids = orderIds(); if (ids.length) game.order(s, t, { c: 'stop', ids }); return; }
      // D steps through the formations, Shift+D back.
      if (k === 'KeyD') {
        const us = formUnits(), F = Rules.FORMS;
        if (us.length > 1) setForm(F[(F.indexOf(Rules.formOfGroup(us)) + (e.shiftKey ? F.length - 1 : 1)) % F.length]);
        return;
      }
      // J turns falling back when hurt on or off; Shift+J sets the selected scouts exploring, or stops them.
      if (k === 'KeyJ') { if (e.shiftKey) toggleExplore(); else toggleFallBack(); return; }
      // L steps through the stances, Shift+L back.
      if (k === 'KeyL') {
        const us = stanceUnits(), T = Rules.STANCES;
        if (us.length) setStance(T[(T.indexOf(us[0].st || 'def') + (e.shiftKey ? T.length - 1 : 1)) % T.length]);
        return;
      }
      if (k === 'KeyG') { const b = state.sel.find(q => alive(q) && q.b); if (b) game.order(s, t, { c: 'repair', id: b.id }); return; }
      if (k === 'Delete') { const b = state.sel.find(q => alive(q) && q.b); if (b) game.order(s, t, { c: 'sell', id: b.id }); return; }
      if (k === 'Space') { e.preventDefault(); const a = state.lastAlert; if (a) world.focus(a.x, a.y); return; }
      if (k === 'KeyH') { const hq = s.ents.find(q => q.b && q.team === t && q.kind === 'hq'); if (hq) { world.focus(hq.x, hq.y); select([hq]); } return; }
      if (k === 'Escape') { if (state.mode) leave(); else if (state.sel.length) select([]); else game.togglePause(); return; }
      if (k === 'KeyP') { game.togglePause(); return; }
      if (k === 'KeyM') { game.audio.toggle(); say(game.audio.muted ? 'Sound off.' : 'Sound on.'); return; }
      if (k === 'KeyF') { game.fullscreen(); return; }
      if (k === 'KeyK') {
        const names = ['Lightning crosshatch', 'Noir', 'Stipple', 'Engraving', 'Clean line', 'Scratchboard', 'Ink and wash', 'Crow quill', 'Mixed pen and ink'];
        game.inkStyle = ((game.inkStyle ?? 8) + 1) % names.length;
        game.look = 'ink'; world.setLook('ink'); world.setInk(game.inkStyle);
        say(names[game.inkStyle] + '.');
        return;
      }
      if (k === 'Equal' || k === 'NumpadAdd') { game.setSpeed(1); return; }
      if (k === 'Minus' || k === 'NumpadSubtract') { game.setSpeed(-1); return; }
      if (k === 'Comma') { world.cam.yaw -= Math.PI / 12; return; }
      if (k === 'Period') { world.cam.yaw += Math.PI / 12; return; }
      if (k.startsWith('Arrow')) e.preventDefault();
    }
    document.addEventListener('keydown', keyDown);
    document.addEventListener('keyup', e => state.keys.delete(e.code));
    window.addEventListener('blur', () => state.keys.clear());

    function scroll(dt) {
      const c = world.cam, k = c.dist * 1.1 * dt;
      let dx = 0, dy = 0;
      const K = state.keys;
      if (K.has('ArrowLeft')) dx -= 1; if (K.has('ArrowRight')) dx += 1; if (K.has('ArrowUp')) dy += 1; if (K.has('ArrowDown')) dy -= 1;
      if (state.mouse.in && !state.drag && !state.touchUsed && document.hasFocus()) {
        const m = state.mouse, e = 8;
        if (m.x < e) dx -= 1; if (m.x > world.vw - e) dx += 1; if (m.y < e) dy += 1; if (m.y > world.vh - e) dy -= 1;
      }
      if (dx || dy) {
        c.x += (dx * -Math.sin(c.yaw) + dy * Math.cos(c.yaw)) * k;
        c.y += (dx * Math.cos(c.yaw) + dy * Math.sin(c.yaw)) * k;
        if (state.mode) moveGhost();
      }
    }

    // The picture overlay.
    // Pen-and-ink motion: stars at muzzles, bursts with action lines at blasts, speed lines behind what is fast.
    const rnd = (seed, i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
    function star(x, y, R, seed, n, outer, inner, lines) {
      og.save(); og.translate(x, y); og.lineJoin = 'round';
      const pts = r0 => { og.beginPath(); for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * 6.283 + seed, rr = i % 2 ? r0 * 0.42 : r0 * (0.75 + 0.5 * rnd(seed, i)); og.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } og.closePath(); };
      pts(R); og.fillStyle = outer; og.fill(); og.strokeStyle = '#1a1512'; og.lineWidth = Math.max(1, R * 0.08); og.stroke();
      pts(R * 0.55); og.fillStyle = inner; og.fill();
      if (lines) {
        og.strokeStyle = '#1a1512'; og.lineWidth = Math.max(1, R * 0.05); og.lineCap = 'round'; og.beginPath();
        for (let i = 0; i < lines; i++) { const a = i / lines * 6.283 + seed * 2 + rnd(seed, i + 40) * 0.3, r0 = R * (1.15 + 0.2 * rnd(seed, i + 7)), r1 = r0 + R * (0.4 + 0.5 * rnd(seed, i + 9)); og.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); og.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); }
        og.stroke();
      }
      og.restore();
    }
    // Twenty more ways to draw a blast, each from the point, with R the burst's radius on screen, k how far through
    // its life it is, grow its first swell, seed its own die, and mz true for a muzzle flash. The canvas is already
    // at the point. Soft ones (WASHY) sit on washed fire and smudged scorch; the rest on white fire and hatching.
    // On dark paper the overlay is turned over by a filter, so a paper fill would land as a black blot over the
    // picture's own bright flash. There the blasts leave their paper out and let the flash under them show.
    let blastDark = false, PAPER_C = '#f3ecdc';
    const INK_C = '#1a1512', pap = a => blastDark ? 'rgba(0,0,0,0)' : 'rgba(243,236,220,' + a + ')';
    const WASHY = new Set([2, 4, 6, 11, 12, 16, 17, 18, 19, 22, 26, 30]);
    const BLAST = {
      // 5 Woodcut: bold black wedges round a paper core.
      5(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 5 : 9; og.fillStyle = INK_C; for (let i = 0; i < n; i++) { const a = i / n * 6.283 + seed, w = 0.18 + 0.12 * rr(i), r0 = R * 0.3, r1 = R * (0.9 + 0.5 * rr(i + 9)) * (0.5 + 0.5 * grow); og.beginPath(); og.moveTo(Math.cos(a - w) * r0, Math.sin(a - w) * r0); og.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); og.lineTo(Math.cos(a + w) * r0, Math.sin(a + w) * r0); og.closePath(); og.fill(); } og.fillStyle = PAPER_C; og.beginPath(); og.arc(0, 0, R * 0.28, 0, 6.283); og.fill(); },
      // 6 Stipple cloud: dots thickest at the heart, lifting as it goes.
      6(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 40 : 260; og.fillStyle = INK_C; for (let i = 0; i < n; i++) { const a = rr(i) * 6.283, d = Math.sqrt(rr(i + 500)) * R * 1.3 * (0.6 + 0.4 * grow); og.globalAlpha = fade * Math.max(0, 1 - d / (R * 1.4)) * 0.9; og.beginPath(); og.arc(Math.cos(a) * d, Math.sin(a) * d * 0.8 - R * 0.4 * k * (0.5 + rr(i + 900)), 0.8 + 1.4 * rr(i + 300), 0, 6.283); og.fill(); } },
      // 7 Engraved column: nested loops of smoke stacked upward, hatched.
      7(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 2 : 5; og.strokeStyle = INK_C; for (let i = 0; i < n; i++) { const t = i / n, cy = -R * (0.2 + 1.3 * t) * (0.4 + 0.6 * k), rx = R * (0.35 + 0.35 * t) * (0.6 + 0.4 * grow), ry = rx * 0.6, cx = (rr(i) - 0.5) * R * 0.3; og.save(); og.lineWidth = Math.max(1, R * 0.015); og.beginPath(); og.ellipse(cx, cy, rx, ry, 0, 0, 6.283); og.stroke(); og.clip(); og.lineWidth = Math.max(0.8, R * 0.01); og.globalAlpha = fade * 0.6; og.beginPath(); for (let h = -rx * 1.5; h < rx * 1.5; h += Math.max(2.5, R * 0.06)) { og.moveTo(cx + h - ry, cy + ry); og.lineTo(cx + h + ry * 0.5, cy - ry); } og.stroke(); og.restore(); } og.globalAlpha = fade; og.fillStyle = PAPER_C; og.beginPath(); og.arc(0, 0, R * 0.25, 0, 6.283); og.fill(); },
      // 8 Spatter: ink flicked from a brush, streaks that end in drops.
      8(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 10 : 44; og.strokeStyle = INK_C; og.fillStyle = INK_C; og.lineCap = 'round'; for (let i = 0; i < n; i++) { const a = rr(i) * 6.283, r0 = R * (0.2 + 0.4 * rr(i + 50)), len = R * (0.3 + 1.2 * rr(i + 100)) * grow, w = Math.max(0.6, R * (0.004 + 0.012 * rr(i + 150))); og.lineWidth = w; og.beginPath(); og.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); og.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len)); og.stroke(); og.beginPath(); og.arc(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len), w * 1.6, 0, 6.283); og.fill(); } },
      // 9 Shock rings: thin circles running outward, as a diagram of the blast wave.
      9(R, k, grow, fade, seed, mz) { og.strokeStyle = INK_C; for (let i = 0; i < 3; i++) { og.globalAlpha = fade * (1 - i * 0.25) * (1 - k * 0.5); og.lineWidth = Math.max(0.8, R * (0.02 - 0.005 * i)); og.beginPath(); og.arc(0, 0, R * (0.35 + 0.45 * i) * (0.3 + 0.9 * k), 0, 6.283); og.stroke(); } og.globalAlpha = fade; og.fillStyle = PAPER_C; og.beginPath(); og.arc(0, 0, R * 0.2 * (1 - k * 0.5), 0, 6.283); og.fill(); },
      // 10 Impact lines: strokes converging on the point from outside, as manga draws a hit.
      10(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 8 : 26; og.strokeStyle = INK_C; og.lineCap = 'round'; for (let i = 0; i < n; i++) { const a = i / n * 6.283 + seed + rr(i) * 0.2, r0 = R * (0.5 + 0.3 * rr(i + 7)), r1 = R * (1.4 + 1.2 * rr(i + 13)); og.lineWidth = Math.max(0.6, R * (0.006 + 0.02 * rr(i + 20))); og.beginPath(); og.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); og.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); og.stroke(); } },
      // 11 Sumi splash: one wet blot with dry-brush flares.
      11(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i); og.fillStyle = 'rgba(30,24,20,0.55)'; og.beginPath(); for (let i = 0; i <= 40; i++) { const a = i / 40 * 6.283, r = R * (0.6 + 0.5 * rr(i % 40 + 3)) * (0.5 + 0.5 * grow); og.lineTo(Math.cos(a) * r, Math.sin(a) * r); } og.closePath(); og.fill(); og.strokeStyle = 'rgba(30,24,20,0.7)'; og.lineCap = 'butt'; for (let i = 0; i < (mz ? 3 : 7); i++) { const a = rr(i + 60) * 6.283, r1 = R * (1.2 + 0.9 * rr(i + 70)); og.lineWidth = Math.max(1, R * 0.05 * (1 - 0.5 * rr(i + 80))); og.setLineDash([Math.max(2, R * 0.05), Math.max(1, R * 0.03 * rr(i + 90))]); og.beginPath(); og.moveTo(Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7); og.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); og.stroke(); } og.setLineDash([]); },
      // 12 White-out: the paper bleached round the point, with a faint grey ring.
      12(R, k, grow, fade, seed, mz) { const g = og.createRadialGradient(0, 0, 0, 0, 0, R * 1.5); g.addColorStop(0, pap(1)); g.addColorStop(0.5, pap(0.9)); g.addColorStop(1, pap(0)); og.fillStyle = g; og.beginPath(); og.arc(0, 0, R * 1.5, 0, 6.283); og.fill(); og.strokeStyle = 'rgba(80,70,60,0.5)'; og.lineWidth = Math.max(1, R * 0.02); og.beginPath(); og.arc(0, 0, R * (0.9 + 0.4 * k), 0, 6.283); og.stroke(); },
      // 13 Crosshatch blot: a ragged disc of nothing but hatching in three directions.
      13(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i); og.save(); og.beginPath(); for (let i = 0; i <= 30; i++) { const a = i / 30 * 6.283, r = R * (0.75 + 0.3 * rr(i % 30 + 11)) * (0.5 + 0.5 * grow); og.lineTo(Math.cos(a) * r, Math.sin(a) * r); } og.closePath(); og.clip(); og.strokeStyle = INK_C; og.lineWidth = Math.max(0.8, R * 0.012); const sp = Math.max(2.5, R * 0.07); for (const ang of [0.6, 2.0, 1.3]) { og.save(); og.rotate(ang); og.beginPath(); for (let h = -R * 1.5; h <= R * 1.5; h += sp) { og.moveTo(h, -R * 1.5); og.lineTo(h, R * 1.5); } og.stroke(); og.restore(); } og.restore(); if (!mz) { og.fillStyle = PAPER_C; og.beginPath(); og.arc(0, 0, R * 0.2, 0, 6.283); og.fill(); } },
      // 14 Scribble: a frantic line thrown round the point, rising.
      14(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 20 : 70; og.strokeStyle = INK_C; og.lineWidth = Math.max(0.8, R * 0.012); og.beginPath(); og.moveTo(0, 0); for (let i = 0; i < n; i++) { const a = rr(i) * 6.283, d = Math.sqrt(rr(i + 200)) * R * (0.4 + 0.6 * grow); og.lineTo(Math.cos(a) * d, Math.sin(a) * d * 0.8 - R * 0.5 * k); } og.stroke(); },
      // 15 Debris arcs: dotted paths of fragments flung out, each ending in a lump.
      15(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 3 : 8; og.strokeStyle = INK_C; og.fillStyle = INK_C; og.setLineDash([2, Math.max(2, R * 0.04)]); og.lineWidth = Math.max(0.8, R * 0.012); for (let i = 0; i < n; i++) { const a = i / n * 6.283 + seed + rr(i) * 0.4, dist = R * (0.9 + 0.9 * rr(i + 9)) * grow, up = R * (0.5 + 0.6 * rr(i + 19)), ex = Math.cos(a) * dist, ey = Math.sin(a) * dist * 0.6; og.beginPath(); og.moveTo(0, 0); og.quadraticCurveTo(ex * 0.5, ey * 0.5 - up, ex, ey); og.stroke(); og.beginPath(); og.arc(ex, ey, Math.max(1, R * 0.03), 0, 6.283); og.fill(); } og.setLineDash([]); },
      // 16 Ink bleed: a blot with a fibrous fringe, as ink spreads in wet paper.
      16(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 20 : 90, r0 = R * 0.55 * (0.5 + 0.5 * grow); og.fillStyle = 'rgba(40,32,26,0.6)'; og.beginPath(); og.arc(0, 0, r0 * 1.1, 0, 6.283); og.fill(); og.strokeStyle = 'rgba(40,32,26,0.55)'; og.lineWidth = Math.max(0.6, R * 0.008); og.beginPath(); for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rr(i) * 0.1, r1 = r0 + R * (0.1 + 0.5 * rr(i + 40)) * grow; og.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); og.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); } og.stroke(); },
      // 17 Dust puff: a pale cloud low and wide, outlined, stippled inside, and no fire.
      17(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), w = R * (1.0 + 0.6 * k), h = R * 0.5; og.fillStyle = pap(0.9); og.strokeStyle = INK_C; og.lineWidth = Math.max(0.8, R * 0.012); og.beginPath(); for (let i = 0; i <= 24; i++) { const a = i / 24 * 6.283, r = 1 + 0.18 * rr(i % 24 + 5); og.lineTo(Math.cos(a) * w * r, Math.sin(a) * h * r - R * 0.15); } og.closePath(); og.fill(); og.stroke(); og.fillStyle = INK_C; for (let i = 0; i < (mz ? 10 : 50); i++) { const a = rr(i + 300) * 6.283, d = Math.sqrt(rr(i + 400)); og.beginPath(); og.arc(Math.cos(a) * d * w * 0.9, Math.sin(a) * d * h * 0.9 - R * 0.15, Math.max(0.5, R * 0.012), 0, 6.283); og.fill(); } },
      // 18 Halftone: a printed disc of dots, large at the heart and vanishing outward.
      18(R, k, grow, fade, seed, mz) { og.fillStyle = INK_C; const sp = Math.max(3, R * 0.1), Rm = R * 1.3 * (0.5 + 0.5 * grow); for (let gx = -Rm; gx <= Rm; gx += sp) for (let gy = -Rm; gy <= Rm; gy += sp) { const d = Math.hypot(gx, gy) / Rm; if (d > 1) continue; const r = sp * 0.5 * (1 - d) * (1 - k * 0.5); if (r < 0.4) continue; og.beginPath(); og.arc(gx, gy, r, 0, 6.283); og.fill(); } },
      // 19 Charcoal smudge: a soft dark cloud with the finger dragged through it.
      19(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), g = og.createRadialGradient(0, 0, 0, 0, 0, R * 1.2); g.addColorStop(0, 'rgba(50,44,40,0.75)'); g.addColorStop(0.6, 'rgba(50,44,40,0.35)'); g.addColorStop(1, 'rgba(50,44,40,0)'); og.fillStyle = g; og.beginPath(); og.arc(0, 0, R * 1.2, 0, 6.283); og.fill(); og.strokeStyle = 'rgba(50,44,40,0.25)'; og.lineCap = 'round'; og.lineWidth = Math.max(2, R * 0.12); for (let i = 0; i < (mz ? 3 : 9); i++) { const yy = (rr(i) - 0.5) * R * 1.4, len = R * (0.8 + 0.8 * rr(i + 9)); og.beginPath(); og.moveTo(-len * 0.3, yy); og.lineTo(len * 0.9, yy - len * 0.15); og.stroke(); } },
      // 20 Cracked ground: a web of cracks running out from the point, with a dark heart.
      20(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 4 : 9; og.strokeStyle = INK_C; og.lineCap = 'round'; og.lineWidth = Math.max(0.8, R * 0.02); for (let i = 0; i < n; i++) { let a = i / n * 6.283 + seed + rr(i) * 0.3, px = 0, py = 0; og.beginPath(); og.moveTo(0, 0); for (let s2 = 1; s2 <= 4; s2++) { const len = R * (0.25 + 0.25 * rr(i * 7 + s2)) * (0.5 + 0.5 * grow); a += (rr(i * 11 + s2) - 0.5) * 0.8; px += Math.cos(a) * len; py += Math.sin(a) * len * 0.7; og.lineTo(px, py); if (s2 === 2) { const b = a + (rr(i + 50) - 0.5) * 2; og.lineTo(px + Math.cos(b) * len * 0.6, py + Math.sin(b) * len * 0.4); og.moveTo(px, py); } } og.stroke(); } og.fillStyle = INK_C; og.beginPath(); og.arc(0, 0, R * 0.12, 0, 6.283); og.fill(); },
      // 21 Negative cut: a pool of ink with the burst cut out of it white.
      21(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i); og.fillStyle = INK_C; og.beginPath(); og.arc(0, 0, R * 1.1 * (0.6 + 0.4 * grow), 0, 6.283); og.fill(); og.fillStyle = PAPER_C; og.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 + seed, r = i % 2 ? R * 0.3 : R * (0.8 + 0.2 * rr(i)); og.lineTo(Math.cos(a) * r, Math.sin(a) * r); } og.closePath(); og.fill(); },
      // 22 Spiral smoke: one line unwinding upward from the point.
      22(R, k, grow, fade, seed, mz) { og.strokeStyle = INK_C; og.lineCap = 'round'; og.lineWidth = Math.max(0.8, R * 0.012); og.beginPath(); for (let i = 0; i <= 80; i++) { const t = i / 80, a = t * 2.5 * 6.283 + seed, r = R * (0.1 + 0.6 * t) * (0.5 + 0.5 * grow); og.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.5 - R * 1.6 * t * k); } og.stroke(); },
      // 23 Flames in line: tongues drawn in outline alone, no fill.
      23(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 2 : 5; og.strokeStyle = INK_C; og.lineWidth = Math.max(0.8, R * 0.015); for (let i = 0; i < n; i++) { const bx = (n > 1 ? i / (n - 1) - 0.5 : 0) * R * 1.1, h = R * (0.8 + 0.7 * rr(i + 3 + Math.floor(k * 6))), w = R * 0.25; og.beginPath(); og.moveTo(bx - w, 0); og.quadraticCurveTo(bx - w * 0.6, -h * 0.5, bx + (rr(i + 30) - 0.5) * w, -h); og.quadraticCurveTo(bx + w * 0.7, -h * 0.4, bx + w, 0); og.stroke(); } },
      // 25 Hergé cloud: a cumulus of round puffs under one clean outline, growing and lifting.
      25(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 3 : 8, cs = []; for (let i = 0; i < n; i++) { const a = rr(i) * 6.283, d = R * 0.45 * Math.sqrt(rr(i + 9)) * (0.4 + 0.6 * grow); cs.push([Math.cos(a) * d, Math.sin(a) * d * 0.7 - R * 0.5 * k, R * (0.28 + 0.3 * rr(i + 19)) * (0.5 + 0.5 * grow)]); } og.strokeStyle = INK_C; og.lineWidth = Math.max(2, R * 0.03); for (const [x, y, r] of cs) { og.beginPath(); og.arc(x, y, r, 0, 6.283); og.stroke(); } og.fillStyle = PAPER_C; for (const [x, y, r] of cs) { og.beginPath(); og.arc(x, y, r, 0, 6.283); og.fill(); } },
      // 26 Akira dome: a thin edge racing outward with the inside bleached, and a second edge behind it.
      26(R, k, grow, fade, seed, mz) { const r1 = R * (0.3 + 1.4 * k), r2 = R * (0.1 + 1.0 * k); og.fillStyle = pap((0.9 * (1 - k)).toFixed(2)); og.beginPath(); og.arc(0, 0, r1, 0, 6.283); og.fill(); og.strokeStyle = INK_C; og.lineWidth = Math.max(0.8, R * 0.012); og.beginPath(); og.arc(0, 0, r1, 0, 6.283); og.stroke(); og.globalAlpha = fade * 0.5; og.beginPath(); og.arc(0, 0, r2, 0, 6.283); og.stroke(); },
      // 27 Kirby krackle: a ring of black dots of every size round a paper core.
      27(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 10 : 40; og.fillStyle = PAPER_C; og.beginPath(); og.arc(0, 0, R * 0.45 * grow, 0, 6.283); og.fill(); og.fillStyle = INK_C; for (let i = 0; i < n; i++) { const a = rr(i) * 6.283, d = R * (0.5 + 0.75 * rr(i + 50)) * grow, r = R * (0.03 + 0.09 * rr(i + 100) * rr(i + 100)); og.beginPath(); og.arc(Math.cos(a) * d, Math.sin(a) * d * 0.9, r, 0, 6.283); og.fill(); } },
      // 28 Callot smoke: small spirals piled above the point, as the old battle etchings curl their smoke.
      28(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 2 : 7; og.strokeStyle = INK_C; og.lineWidth = Math.max(0.8, R * 0.012); og.lineCap = 'round'; for (let i = 0; i < n; i++) { const cx = (rr(i) - 0.5) * R * 1.1, cy = -R * (0.1 + 0.9 * rr(i + 9)) * (0.3 + 0.7 * k) - R * 0.3 * k, sr = R * (0.12 + 0.16 * rr(i + 19)) * (0.5 + 0.5 * grow), dirn = rr(i + 29) < 0.5 ? 1 : -1; og.beginPath(); for (let j = 0; j <= 30; j++) { const t = j / 30, a = dirn * t * 2.2 * 6.283, r = sr * (0.15 + 0.85 * t); og.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8); } og.stroke(); } og.fillStyle = PAPER_C; og.beginPath(); og.arc(0, 0, R * 0.2, 0, 6.283); og.fill(); },
      // 29 Mignola cut: one flat black jagged shape with a white jag cut inside it.
      29(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), jag = (rad, off, fill) => { og.fillStyle = fill; og.beginPath(); for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283 + seed, r = rad * (i % 2 ? 0.55 : 0.85 + 0.3 * rr(i + off)); og.lineTo(Math.cos(a) * r, Math.sin(a) * r); } og.closePath(); og.fill(); }; jag(R * 1.1 * (0.5 + 0.5 * grow), 0, INK_C); jag(R * 0.55 * (0.5 + 0.5 * grow), 30, PAPER_C); },
      // 30 Effects bloom: a flash, then a crown with a scalloped edge on a stem, then puffs that part and go.
      30(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i); og.strokeStyle = INK_C; og.lineWidth = Math.max(1, R * 0.015); if (k < 0.12) { og.fillStyle = PAPER_C; og.beginPath(); og.arc(0, 0, R * 1.3, 0, 6.283); og.fill(); return; } if (k < 0.55) { const t = (k - 0.12) / 0.43, cy = -R * 0.6 * t, cr = R * (0.5 + 0.5 * t); og.fillStyle = PAPER_C; og.beginPath(); for (let i = 0; i < 7; i++) { const a = Math.PI + i / 6 * Math.PI; og.arc(Math.cos(a) * cr * 0.8, cy + Math.sin(a) * cr * 0.6, cr * 0.32, 0, 6.283); } og.fill(); og.beginPath(); for (let i = 0; i < 7; i++) { const a = Math.PI + i / 6 * Math.PI; og.moveTo(Math.cos(a) * cr * 0.8 + cr * 0.32, cy + Math.sin(a) * cr * 0.6); og.arc(Math.cos(a) * cr * 0.8, cy + Math.sin(a) * cr * 0.6, cr * 0.32, 0, 6.283); } og.stroke(); og.beginPath(); og.moveTo(-cr * 0.25, 0); og.lineTo(-cr * 0.2, cy); og.moveTo(cr * 0.25, 0); og.lineTo(cr * 0.2, cy); og.stroke(); return; } const t = (k - 0.55) / 0.45; for (let i = 0; i < (mz ? 2 : 4); i++) { const a = rr(i) * 6.283, d = R * (0.3 + 0.6 * t) * (0.5 + rr(i + 9)), pr = R * 0.3 * (1 - t) * (0.7 + 0.6 * rr(i + 19)); if (pr < 1) continue; const px = Math.cos(a) * d, py = -R * 0.6 - R * 0.8 * t + Math.sin(a) * d * 0.5; og.fillStyle = PAPER_C; og.beginPath(); og.arc(px, py, pr, 0, 6.283); og.fill(); og.beginPath(); og.arc(px, py, pr, 0, 6.283); og.stroke(); } },
      // 31 Scratch: quick scratchy strokes every way, and bits of debris thrown clear.
      31(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 10 : 34; og.strokeStyle = INK_C; og.lineCap = 'round'; for (let i = 0; i < n; i++) { const a = rr(i) * 6.283, d = R * 0.9 * rr(i + 50) * grow, len = R * (0.15 + 0.45 * rr(i + 100)), b = rr(i + 150) * 6.283; og.lineWidth = Math.max(0.6, R * (0.006 + 0.018 * rr(i + 200))); og.beginPath(); og.moveTo(Math.cos(a) * d, Math.sin(a) * d); og.lineTo(Math.cos(a) * d + Math.cos(b) * len, Math.sin(a) * d + Math.sin(b) * len); og.stroke(); } og.fillStyle = INK_C; for (let i = 0; i < (mz ? 3 : 12); i++) { const a = rr(i + 300) * 6.283, d = R * (1.0 + 1.2 * k) * (0.5 + 0.5 * rr(i + 400)); og.beginPath(); og.arc(Math.cos(a) * d, Math.sin(a) * d * 0.8 - R * 0.6 * k * rr(i + 500), Math.max(0.8, R * 0.025), 0, 6.283); og.fill(); } },
      // 32 Ring and skirt: a thin blast ring running out, a low hatched skirt of dust spreading, and a stem.
      32(R, k, grow, fade, seed, mz) { og.strokeStyle = INK_C; og.lineWidth = Math.max(0.8, R * 0.012); og.beginPath(); og.arc(0, 0, R * (0.4 + 1.3 * k), 0, 6.283); og.stroke(); const w = R * (0.6 + 0.9 * k), h = w * 0.35; og.save(); og.beginPath(); og.ellipse(0, R * 0.1, w, h, 0, 0, 6.283); og.clip(); og.lineWidth = Math.max(0.6, R * 0.008); og.globalAlpha = fade * 0.7; og.beginPath(); for (let x = -w; x <= w; x += Math.max(2.5, R * 0.06)) { og.moveTo(x - h, R * 0.1 + h); og.lineTo(x + h, R * 0.1 - h); } og.stroke(); og.restore(); og.globalAlpha = fade; og.beginPath(); og.ellipse(0, R * 0.1, w, h, 0, 0, 6.283); og.stroke(); if (!mz) { og.beginPath(); for (let i = -1; i <= 1; i++) { og.moveTo(i * R * 0.12, 0); og.lineTo(i * R * 0.18, -R * (0.6 + 0.6 * k)); } og.stroke(); } },
      // 24 Fragments: small asterisks flung outward, the pieces of what went up.
      24(R, k, grow, fade, seed, mz) { const rr = i => rnd(seed, i), n = mz ? 4 : 14; og.strokeStyle = INK_C; og.lineCap = 'round'; og.lineWidth = Math.max(0.8, R * 0.012); for (let i = 0; i < n; i++) { const a = rr(i) * 6.283, d = R * (0.5 + 0.9 * rr(i + 9)) * grow, s2 = R * (0.06 + 0.06 * rr(i + 19)), cx = Math.cos(a) * d, cy = Math.sin(a) * d * 0.8 - R * 0.3 * k; og.beginPath(); for (let j = 0; j < 3; j++) { const b = j * 1.047 + rr(i + 29); og.moveTo(cx - Math.cos(b) * s2, cy - Math.sin(b) * s2); og.lineTo(cx + Math.cos(b) * s2, cy + Math.sin(b) * s2); } og.stroke(); } },
    };
    // The cover points the rules hold, one list a map, with a kind and the way each faces.
    const tacPoints = s => Rules.coverPoints(s.map);
    const TAC_NAMES = { wall: 'hold the yard corner', bridge: 'hold the bridge end', ford: 'cover the ford', wood: 'lie in the tree line', rock: 'take cover at the rock', crest: 'overwatch from the crest' };
    function tacSymbol(kind, px, py, r, dir) {
      og.beginPath();
      if (kind === 'wall') { og.moveTo(px - r, py + r * 0.2); og.lineTo(px - r, py - r); og.lineTo(px + r * 0.2, py - r); }
      else if (kind === 'bridge') { og.moveTo(px - r * 0.4, py - r); og.lineTo(px - r * 0.4, py + r); og.moveTo(px + r * 0.4, py - r); og.lineTo(px + r * 0.4, py + r); }
      else if (kind === 'ford') { og.moveTo(px - r, py); og.quadraticCurveTo(px - r * 0.5, py - r, px, py); og.quadraticCurveTo(px + r * 0.5, py + r, px + r, py); }
      else if (kind === 'wood') { for (let i = -1; i <= 1; i++) { og.moveTo(px + i * r * 0.7, py + r); og.lineTo(px + i * r * 0.7, py - r * (i ? 0.6 : 1)); } }
      else if (kind === 'rock') { og.moveTo(px - r, py + r * 0.7); og.lineTo(px, py - r); og.lineTo(px + r, py + r * 0.7); og.closePath(); }
      else { og.moveTo(px - r, py + r * 0.6); og.lineTo(px, py - r); og.lineTo(px + r, py + r * 0.6); }
      og.stroke();
    }
    // The point an order near the cursor would snap to, within a stride and a half on the land.
    function tacSnap(s, gx, gy) {
      let best = null, bd = 1.5;
      for (const q of tacPoints(s)) { const d = Math.hypot(q.x - gx, q.y - gy); if (d < bd) { bd = d; best = q; } }
      return best;
    }
    // While infantry are chosen, the points near the cursor show, fading with distance. The one the order would
    // snap to is ringed, the chosen squad's order runs to it, and the order it would be is written beside it.
    function drawTactical(s, t) {
      const v = 2, inf = state.sel.filter(e => !e.b && e.team === t && e.d && e.d.men);
      if (!inf.length || !state.mouse.in || state.mode) return;
      const pts = tacPoints(s), m = state.mouse, SEP = '#5a4636';
      let best = null, bd = 1e9;
      og.save(); og.setLineDash([]); og.lineCap = 'round'; og.lineJoin = 'round';
      for (const q of pts) {
        const [px, py] = world.project(q.x, terrainAt(s.map, q.x, q.y) + 0.05, q.y);
        if (!onView(px, py, 20)) continue;
        q.px = px; q.py = py;
        const dm = Math.hypot(px - m.x, py - m.y);
        if (dm < bd) { bd = dm; best = q; }
      }
      for (const q of pts) {
        if (q.px === undefined || !onView(q.px, q.py, 20)) continue;
        const dm = Math.hypot(q.px - m.x, q.py - m.y), u = world.ppu(q.x, 0, q.y);
        let a = 0.85;
        if (v === 2) { a = 1 - smoothstepJ(u * 5, u * 9, dm); if (a <= 0) continue; }
        og.globalAlpha = a; og.strokeStyle = SEP; og.lineWidth = 1.4;
        tacSymbol(q.kind, q.px, q.py, 6, q.dir);
        og.fillStyle = SEP; og.beginPath(); og.arc(q.px, q.py + 9, 1.2, 0, 6.283); og.fill();
        if (v === 3) {
          // The arc the point faces, as a light hatch between two radii.
          const r = u * 5, a0 = q.dir - 0.6, a1 = q.dir + 0.6;
          og.save(); og.globalAlpha = a * 0.5; og.beginPath(); og.moveTo(q.px, q.py); og.arc(q.px, q.py, r, a0, a1); og.closePath(); og.clip();
          og.lineWidth = 0.8; og.beginPath(); for (let h = -r; h <= r; h += 4) { og.moveTo(q.px + h - r, q.py + r); og.lineTo(q.px + h + r, q.py - r); } og.stroke(); og.restore();
          og.beginPath(); og.arc(q.px, q.py, r, a0, a1); og.stroke();
        }
      }
      og.globalAlpha = 1;
      const g = world.pick(m.x, m.y), snap = g && tacSnap(s, g.x, g.y);
      if (snap && snap.px !== undefined) best = snap; else best = null;
      if (best) {
        // The snapped point: a dashed ring, the order line from the squad, and what the order would be.
        og.strokeStyle = PLAN; og.setLineDash([3, 3]); og.lineWidth = 1.5; og.beginPath(); og.arc(best.px, best.py, 13, 0, 6.283); og.stroke();
        const e = inf[0], [ex, ey] = world.project(e.x, terrainAt(s.map, e.x, e.y) + 0.3, e.y);
        dotted(); og.strokeStyle = PLAN; og.beginPath(); og.moveTo(ex, ey); og.lineTo(best.px, best.py); og.stroke();
        og.setLineDash([]); og.font = `italic 14px ${labelFont()}`; og.fillStyle = '#1a1512'; og.textAlign = 'left'; og.textBaseline = 'middle';
        const label = TAC_NAMES[best.kind], tw = og.measureText(label).width;
        og.fillStyle = 'rgba(243,236,220,0.9)'; og.fillRect(best.px + 16, best.py - 10, tw + 10, 20);
        og.fillStyle = '#1a1512'; og.fillText(label, best.px + 21, best.py);
      }
      og.restore();
    }
    const smoothstepJ = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // A small shell's burst as a pen draws one: a ragged star of flame for a moment, then a little scalloped cloud
    // that swells, rises and thins. Ground bursts are a pale brown smoke, air bursts the black of flak.
    // Text along a line on the screen, each letter turned to the line, read left to right, centred on its middle.
    function textAlong(text, pts, size, color, spacing) {
      if (pts.length < 2) return;
      if (pts[pts.length - 1][0] < pts[0][0]) pts = pts.slice().reverse();
      const L = [0];
      for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const ws = [...text].map(ch => og.measureText(ch).width + spacing), total = ws.reduce((a, b) => a + b, 0) - spacing;
      if (total > L[L.length - 1] * 0.9) return;
      let s = (L[L.length - 1] - total) / 2;
      const at = d => { let k = 1; while (k < L.length - 1 && L[k] < d) k++; const t = (d - L[k - 1]) / Math.max(1e-6, L[k] - L[k - 1]), a = pts[k - 1], b = pts[k]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])]; };
      [...text].forEach((ch, i) => {
        const [x, y, a] = at(s + ws[i] / 2);
        og.save(); og.translate(x, y); og.rotate(a);
        og.strokeText(ch, 0, 0); og.fillStyle = color; og.fillText(ch, 0, 0);
        og.restore();
        s += ws[i];
      });
    }
    function drawNames(s, P) {
      const dist = world.cam.dist, k = smoothstepJS(38, 70, dist);
      if (k <= 0) return;
      // The dark scheme turns the overlay over, so these are the light paper's colours either way.
      const N = world.names, seen = (x, y) => !P || P.seen[Rules.cellOf(x, y)];
      const fs = Math.round(12 + smoothstepJS(70, 200, dist) * 5);
      og.save(); og.globalAlpha = k; og.setLineDash([]); og.textAlign = 'center'; og.textBaseline = 'middle'; og.lineJoin = 'round';
      og.strokeStyle = 'rgba(250,244,228,0.9)'; og.lineWidth = 3;
      og.font = `italic 500 ${fs + 1}px ${labelFont()}`;
      for (const r of N.rivers) {
        if (!r.pts.some(p => seen(p[0], p[1]))) continue;
        // Lettered along the longest stretch of it on the screen, twice where that stretch is long.
        const sp = r.pts.map(p => world.project(p[0], s.map.water, p[1])), on = q => q[0] > 30 && q[1] > 30 && q[0] < world.vw - 30 && q[1] < world.vh - 30;
        let best = [], run = [];
        for (const q of sp) { if (on(q)) run.push(q); else { if (run.length > best.length) best = run; run = []; } }
        if (run.length > best.length) best = run;
        let len = 0;
        for (let i = 1; i < best.length; i++) len += Math.hypot(best[i][0] - best[i - 1][0], best[i][1] - best[i - 1][1]);
        const n = len > 900 ? 2 : 1;
        for (let j = 0; j < n; j++) textAlong(r.name, best.slice(Math.floor(j * best.length / n), Math.floor((j + 1) * best.length / n)), fs + 1, '#23458c', fs * 0.35);
      }
      og.font = `italic 500 ${fs}px ${labelFont()}`;
      for (const h of N.hills) {
        if (!seen(h.x, h.y)) continue;
        const [x, y] = world.project(h.x, terrainAt(s.map, h.x, h.y), h.y);
        og.fillStyle = '#5a4632';
        og.beginPath(); og.moveTo(x, y - 4); og.lineTo(x + 3.5, y + 2); og.lineTo(x - 3.5, y + 2); og.closePath(); og.fill();
        og.strokeText(h.name, x, y + fs * 0.95); og.fillText(h.name, x, y + fs * 0.95);
        const spot = String(Math.round(h.z * 52 + 120));
        og.font = `500 ${fs - 3}px ${labelFont()}`; og.strokeText(spot, x + 14, y - 2); og.fillText(spot, x + 14, y - 2); og.font = `italic 500 ${fs}px ${labelFont()}`;
      }
      og.fillStyle = '#3a5a2e';
      for (const w of N.woods) {
        if (!seen(w.x, w.y)) continue;
        const [x, y] = world.project(w.x, terrainAt(s.map, w.x, w.y) + 1.5, w.y);
        og.strokeText(w.name, x, y); og.fillText(w.name, x, y);
      }
      og.restore();
    }
    // Drawn back, the map is framed as a survey sheet: a neat line round it with a heavy border outside, ticks every
    // sixteen cells, and in the corner a cartouche with the map's name, its theatre, a scale bar and a north arrow.
    // Everything is in the light paper's colours, as the dark scheme turns the overlay over.
    const SHEET_THEATRE = { desert: 'Salt Flats', steppe: 'Black Steppe', winter: 'White Pass', any: 'Black Steppe' };
    function drawSheet(s) {
      const dist = world.cam.dist, k = smoothstepJS(78, 115, dist);
      if (k <= 0) return;
      const M = s.map, Wm = M.W, Hm = M.H, z = 1, c = [[0, 0], [Wm, 0], [Wm, Hm], [0, Hm]].map(([x, y]) => world.project(x, z, y));
      const cx = c.reduce((a, p) => a + p[0], 0) / 4, cy = c.reduce((a, p) => a + p[1], 0) / 4;
      const out = d => c.map(([x, y]) => { const dx = x - cx, dy = y - cy, m = Math.hypot(dx, dy) || 1; return [x + dx / m * d, y + dy / m * d]; });
      const poly = (pts, w) => { og.lineWidth = w; og.beginPath(); pts.forEach(([x, y], i) => i ? og.lineTo(x, y) : og.moveTo(x, y)); og.closePath(); og.stroke(); };
      og.save(); og.globalAlpha = k; og.setLineDash([]); og.strokeStyle = INK; og.lineJoin = 'miter';
      poly(c, 1); poly(out(9), 0.8); poly(out(15), 3);
      // Ticks along each edge, every sixteen cells, from the neat line out to the inner border.
      og.lineWidth = 1;
      for (let e = 0; e < 4; e++) {
        const a = [[0, 0], [Wm, 0], [Wm, Hm], [0, Hm]][e], b = [[Wm, 0], [Wm, Hm], [0, Hm], [0, 0]][e], n = Math.round((e % 2 ? Hm : Wm) / 16);
        for (let i = 1; i < n; i++) {
          const t = i / n, p = world.project(a[0] + (b[0] - a[0]) * t, z, a[1] + (b[1] - a[1]) * t), dx = p[0] - cx, dy = p[1] - cy, m = Math.hypot(dx, dy) || 1;
          og.beginPath(); og.moveTo(p[0], p[1]); og.lineTo(p[0] + dx / m * 9, p[1] + dy / m * 9); og.stroke();
        }
      }
      // The cartouche, in the corner left of the key.
      const bw = 236, bh = 92, bx = world.vw - 118 - 12 - bw, by = world.vh - bh - 14;
      og.fillStyle = 'rgba(250,244,228,0.94)'; og.fillRect(bx, by, bw, bh);
      og.lineWidth = 1; og.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1); og.lineWidth = 2; og.strokeRect(bx + 3.5, by + 3.5, bw - 7, bh - 7);
      og.fillStyle = INK; og.textAlign = 'left'; og.textBaseline = 'alphabetic';
      const map = Rules.MAPS[Object.keys(Rules.MAPS).find(kk => Rules.MAPS[kk].layout === s.layout)] || { name: s.layout };
      og.font = `600 17px ${getComputedStyle(document.body).getPropertyValue('--display').trim() || 'serif'}`;
      og.fillText(map.name.toUpperCase(), bx + 14, by + 26);
      og.font = `italic 13px ${labelFont()}`;
      og.fillText(`${SHEET_THEATRE[s.theatre] || ''} · Sheet ${s.seed % 1000}`, bx + 14, by + 44);
      // The scale bar: half a kilometre a side of it, at fifty metres a cell, measured at the view's middle.
      const u = world.ppu(world.cam.x, z, world.cam.y), seg = 5 * u, sx = bx + 14, sy = by + 62;
      if (seg * 4 < bw - 70) {
        for (let i = 0; i < 4; i++) { og.fillStyle = i % 2 ? '#faf4e4' : INK; og.fillRect(sx + i * seg, sy, seg, 5); }
        og.lineWidth = 1; og.strokeRect(sx + 0.5, sy + 0.5, seg * 4, 5);
        og.fillStyle = INK; og.font = `11px ${labelFont()}`; og.textAlign = 'center';
        og.fillText('0', sx, sy + 17); og.fillText('500', sx + seg * 2, sy + 17); og.fillText('1000 m', sx + seg * 4 + 10, sy + 17);
      }
      // North: the way up the map, wherever the view is turned.
      const p0 = world.project(Wm / 2, z, Hm / 2), p1 = world.project(Wm / 2, z, Hm / 2 - 10), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), ax = bx + bw - 30, ay = by + bh / 2 + 4;
      og.save(); og.translate(ax, ay); og.rotate(ang + Math.PI / 2);
      og.fillStyle = INK; og.beginPath(); og.moveTo(0, -24); og.lineTo(7, 12); og.lineTo(0, 6); og.closePath(); og.fill();
      og.fillStyle = '#faf4e4'; og.lineWidth = 1; og.beginPath(); og.moveTo(0, -24); og.lineTo(-7, 12); og.lineTo(0, 6); og.closePath(); og.fill(); og.stroke();
      og.restore();
      og.fillStyle = INK; og.font = `600 12px ${labelFont()}`; og.textAlign = 'center'; og.fillText('N', ax + Math.cos(ang) * 32, ay + Math.sin(ang) * 32 + 4);
      og.restore();
    }
    let puffC = null;
    const puffSheet = n => { if (!puffC || puffC.width < n) { puffC = document.createElement('canvas'); puffC.width = puffC.height = Math.max(n, 64); } return puffC; };
    function drawPuff(f) {
      const k = f.t / f.life, [x, y] = world.project(f.x, f.y + f.s * 0.5 * k, f.z);
      if (x < -60 || y < -60 || x > world.vw + 60 || y > world.vh + 60) return;
      const u = world.ppu(f.x, f.y, f.z), R = Math.min(60, f.s * u * (f.air ? 0.42 : 0.6)) * (0.55 + 0.45 * Math.min(1, k / 0.12)) * (1 + 0.5 * k);
      if (!(R > 1)) return;
      og.save(); og.translate(x, y); og.setLineDash([]);
      if (k < 0.12) { og.globalAlpha = 1 - k / 0.12; star(0, 0, R * 1.1, f.seed, 7, '#e8471c', '#ffd84a', 0); }
      // The cloud is drawn whole on a scratch sheet, then laid down faded, so its inner outlines never show through.
      const n = 5 + (f.seed * 7 % 3 | 0), lobes = [], S2 = Math.ceil(R * 2.6), c = puffSheet(S2), g = c.getContext('2d');
      for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rnd(f.seed, i) * 0.9, d = R * (0.35 + 0.3 * rnd(f.seed, i + 5)); lobes.push([Math.cos(a) * d, Math.sin(a) * d * 0.8 - R * 0.1, R * (0.42 + 0.25 * rnd(f.seed, i + 9))]); }
      lobes.push([0, 0, R * 0.55]);
      // The dark scheme turns the overlay over, so the cloud is drawn in the light paper's colours either way.
      const fill = f.air ? '#4a4540' : '#cdc3b2', line = f.air ? '#1a1512' : '#2a221c';
      g.clearRect(0, 0, S2, S2); g.save(); g.translate(S2 / 2, S2 / 2);
      g.strokeStyle = line; g.lineWidth = Math.max(1.2, R * 0.08);
      for (const [cx, cy, r] of lobes) { g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke(); }
      g.fillStyle = fill;
      for (const [cx, cy, r] of lobes) { g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill(); }
      // A few strokes of shade on the side away from the light.
      g.lineWidth = Math.max(0.7, R * 0.035); g.globalAlpha = 0.55;
      for (let i = 0; i < 4; i++) { const yy = R * (0.05 + i * 0.13); g.beginPath(); g.moveTo(R * 0.05, yy); g.lineTo(R * (0.45 - i * 0.06), yy - R * 0.18); g.stroke(); }
      g.restore();
      og.globalAlpha = (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45) * 0.95;
      og.drawImage(c, 0, 0, S2, S2, -S2 / 2, -S2 / 2, S2, S2);
      og.restore(); og.globalAlpha = 1;
    }
    // One cloud of a furnace's, forge's or beacon's plume: small and grey, ringed in ink, rising and leaning with the
    // wind as it swells and thins. In the light paper's colours, as the dark scheme turns the overlay over.
    function drawFume(f) {
      const k = f.t / f.life, t = f.t, fx = f.x + f.wx * t * 0.5, fy = f.y + t * 0.45, fz = f.z + f.wz * t * 0.5;
      const [x, y] = world.project(fx, fy, fz);
      if (x < -40 || y < -40 || x > world.vw + 40 || y > world.vh + 40) return;
      const R = Math.min(40, f.s * world.ppu(fx, fy, fz) * (0.1 + 0.32 * Math.sqrt(k)));
      if (!(R > 0.8)) return;
      const n = 3 + (f.seed * 7 % 2 | 0), S2 = Math.ceil(R * 2.8), c = puffSheet(S2), g = c.getContext('2d'), lobes = [[0, 0, R * 0.6]];
      for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rnd(f.seed, i) * 0.9; lobes.push([Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.3, R * (0.38 + 0.18 * rnd(f.seed, i + 3))]); }
      // Drawn whole on the scratch sheet first, so the lobes' inner outlines never show through the fade.
      g.clearRect(0, 0, S2, S2); g.save(); g.translate(S2 / 2, S2 / 2);
      g.strokeStyle = '#3a322a'; g.lineWidth = Math.max(0.8, R * 0.07);
      for (const [cx, cy, r] of lobes) { g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke(); }
      g.fillStyle = '#d6cfc2';
      for (const [cx, cy, r] of lobes) { g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill(); }
      g.restore();
      og.save(); og.globalAlpha = (k < 0.1 ? k / 0.1 : k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5) * 0.85;
      og.drawImage(c, 0, 0, S2, S2, x - S2 / 2, y - S2 / 2, S2, S2);
      og.restore();
    }
    function drawInk(s, t) {
      // The blasts, in the manner the look asks for: 0 the comic burst, 1 an engraver's rays and scribbled smoke, 2 an
      // ink blot with flung drops, 3 a plan's dashed circle of the blast, 4 nothing drawn over the scene.
      blastDark = world.look === 'ink' && document.body.dataset.scheme === 'dark';
      PAPER_C = blastDark ? 'rgba(0,0,0,0)' : '#f3ecdc';
      const INKC = '#1a1512', PAPERC = PAPER_C;
      for (const f of world.inkFx) {
        if (f.k === 'puff') { drawPuff(f); continue; }
        if (f.k === 'fume') { drawFume(f); continue; }
        // A whale's spout: a plume of spray rising and spreading from the blowhole, drawn as small white clouds ringed
        // in fine blue, in the light paper's colours, as the dark scheme turns the overlay over.
        if (f.k === 'spout') {
          const [x, y] = world.project(f.x, f.y, f.z);
          if (x < -60 || y < -60 || x > world.vw + 60 || y > world.vh + 60) continue;
          const u = world.ppu(f.x, f.y, f.z), k = f.t / f.life, h = u * 1.3 * Math.min(1, k / 0.3), fade = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1;
          og.save(); og.globalAlpha = fade; og.lineWidth = 1; og.strokeStyle = '#4a6a9a'; og.fillStyle = '#fbfcfd';
          for (let i = 0; i < 11; i++) {
            const q = i / 10, side = (i % 2 ? 1 : -1) * q * u * 0.36 * (0.4 + k), cy = y - h * (0.15 + 0.85 * q), r = u * (0.025 + 0.05 * q) * (0.7 + 0.6 * k);
            og.beginPath(); og.arc(x + side + Math.sin(f.seed + i) * u * 0.04, cy, r, 0, 6.283); og.fill(); og.stroke();
          }
          og.restore(); continue;
        }
        // A burst carries the style of what went up, unless the look draws none; a muzzle flash is always a few rays.
        const fx = f.k === 'star' ? 1 : world.style.fx === 4 ? 4 : f.fx !== undefined ? f.fx : (world.style.fx || 0);
        if (fx === 4) continue;
        const [x, y] = world.project(f.x, f.y, f.z);
        if (x < -60 || y < -60 || x > world.vw + 60 || y > world.vh + 60) continue;
        const u = world.ppu(f.x, f.y, f.z), k = f.t / f.life, grow = Math.min(1, k / 0.25), fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        const muzzle = f.k === 'star', R = muzzle ? f.s * u * (0.5 + 0.5 * grow) : Math.min(f.s * u * 0.95, 140) * (0.4 + 0.6 * grow);
        if (!(R > 0.5)) continue;
        og.globalAlpha = fade;
        if (fx === 0) { if (muzzle) star(x, y, R, f.seed, 6, '#ff9a1e', '#ffe680', 0); else star(x, y, R, f.seed, 9, '#e8471c', '#ffd84a', 10); }
        else if (fx === 1) {
          og.save(); og.translate(x, y); og.strokeStyle = INKC; og.lineCap = 'round';
          if (!muzzle) { og.fillStyle = PAPERC; og.beginPath(); og.arc(0, 0, R * 0.32, 0, 6.283); og.fill(); }
          const n = muzzle ? 4 : 16;
          for (let i = 0; i < n; i++) {
            const a = i / n * 6.283 + f.seed + rnd(f.seed, i) * 0.25, r0 = R * (muzzle ? 0.2 : 0.36 + 0.1 * rnd(f.seed, i + 3)), r1 = r0 + R * (muzzle ? 0.9 : 0.5 + 0.9 * rnd(f.seed, i + 9)) * (0.6 + 0.4 * grow);
            og.lineWidth = Math.max(1, R * (i % 2 ? 0.012 : 0.02)); og.beginPath(); og.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); og.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); og.stroke();
          }
          // Smoke as an engraver scribbles it: loops piled above the burst, rising as it dies.
          if (!muzzle && k > 0.2) {
            og.lineWidth = Math.max(0.8, R * 0.01); og.globalAlpha = fade * 0.8;
            for (let i = 0; i < 6; i++) { const q = rnd(f.seed, i + 20), cx = (q - 0.5) * R * 0.9, cy = -R * (0.3 + 0.9 * k) - rnd(f.seed, i + 30) * R * 0.5, rr = R * (0.18 + 0.2 * rnd(f.seed, i + 40)) * (0.5 + k);
              og.beginPath(); for (let j = 0; j < 3; j++) og.ellipse(cx + (rnd(f.seed, i * 3 + j) - 0.5) * rr * 0.5, cy + (rnd(f.seed, i * 5 + j) - 0.5) * rr * 0.3, rr, rr * 0.7, j, 0, 6.283); og.stroke(); }
          }
          og.restore();
        } else if (fx === 2) {
          og.save(); og.translate(x, y);
          const g = og.createRadialGradient(0, 0, 0, 0, 0, R * 1.3);
          g.addColorStop(0, 'rgba(40,32,26,0.1)'); g.addColorStop(0.35, 'rgba(40,32,26,0.55)'); g.addColorStop(1, 'rgba(40,32,26,0)');
          og.fillStyle = g; og.beginPath(); og.arc(0, 0, R * 1.3, 0, 6.283); og.fill();
          if (!muzzle) { og.fillStyle = PAPERC; og.globalAlpha = fade * (1 - grow * 0.6); og.beginPath(); og.arc(0, 0, R * 0.25, 0, 6.283); og.fill(); og.globalAlpha = fade; }
          og.fillStyle = 'rgba(40,32,26,0.8)';
          for (let i = 0; i < (muzzle ? 3 : 9); i++) { const a = rnd(f.seed, i) * 6.283, d = R * (1.1 + 0.9 * rnd(f.seed, i + 11)) * grow, rr = R * (0.03 + 0.05 * rnd(f.seed, i + 23)); og.beginPath(); og.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, 6.283); og.fill(); }
          og.restore();
        } else if (fx === 3) {
          og.save(); og.translate(x, y); og.strokeStyle = INKC; og.lineWidth = Math.max(1, R * 0.012); og.lineCap = 'butt';
          og.setLineDash([Math.max(2, R * 0.08), Math.max(2, R * 0.06)]); og.beginPath(); og.arc(0, 0, R, 0, 6.283); og.stroke();
          if (!muzzle) { og.setLineDash([1, Math.max(2, R * 0.05)]); og.beginPath(); og.arc(0, 0, R * 0.5, 0, 6.283); og.stroke(); }
          og.setLineDash([]);
          for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; og.beginPath(); og.moveTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92); og.lineTo(Math.cos(a) * R * 1.1, Math.sin(a) * R * 1.1); og.stroke(); }
          const c = R * 0.14; og.lineWidth = Math.max(1, R * 0.02); og.beginPath(); og.moveTo(-c, -c); og.lineTo(c, c); og.moveTo(c, -c); og.lineTo(-c, c); og.stroke();
          og.restore();
        } else if (BLAST[fx]) {
          og.save(); og.translate(x, y); og.lineJoin = 'round'; og.setLineDash([]);
          BLAST[fx](R, k, grow, fade, f.seed, muzzle);
          og.restore();
        }
        og.globalAlpha = 1;
      }
      // Study 6: pulled back, a unit becomes a plan's tag, a paper plate with a hand letter, square for ours and
      // a lozenge for theirs, in the side's ink.
      if (world.style.units === 6 && world.cam.dist > 100) {
        const TAG = { tank: 'T', heavy: 'H', ifv: 'I', humvee: 'J', truck: 'Tk', flak: 'AA', support: 'S', mlrs: 'R', rifle: 'i', rocket: 'at', engineer: 'e', sniper: 's', hero: 'h', heli: 'He', jet: 'Jt', fpv: 'd' };
        og.save(); og.setLineDash([]); og.font = `italic 11px ${labelFont()}`; og.textAlign = 'center'; og.textBaseline = 'middle';
        for (const o of world.onScreen) {
          const e = o.e; if (e.b || !e.d) continue;
          const own = e.team === t, c = world.teamCol[Math.max(0, e.team)], ink = own ? '#1f3f8a' : '#8a2a1e', s2 = 8;
          og.fillStyle = '#f3ecdc'; og.strokeStyle = ink; og.lineWidth = 1.2; og.beginPath();
          if (own) og.rect(o.x - s2, o.y - s2 * 0.7, s2 * 2, s2 * 1.4); else { og.moveTo(o.x, o.y - s2); og.lineTo(o.x + s2 * 1.2, o.y); og.lineTo(o.x, o.y + s2); og.lineTo(o.x - s2 * 1.2, o.y); og.closePath(); }
          og.fill(); og.stroke(); og.fillStyle = ink; og.fillText(TAG[e.kind] || '?', o.x, o.y + 0.5);
        }
        og.restore();
      }
      if (world.cam.dist > 140) return;
      og.strokeStyle = 'rgba(26,21,18,0.75)'; og.lineCap = 'round';
      for (const o of world.onScreen) {
        const e = o.e;
        if (e.b || !e.d) continue;
        const air = Rules.isAir(e), fast = e.d.move === 'jet' ? e.z > 1 : e.d.kamikaze ? true : air ? e.v > 3 : e.v > 3.6;
        if (!fast) continue;
        const h = Rules.heightAt(s.map, Rules.clamp(e.x, 0, W), Rules.clamp(e.y, 0, H)) + (air ? e.z : 0.5);
        const L = 1.2 + e.v * 0.12, [bx, by] = world.project(e.x - Math.cos(e.a) * L, h, e.y - Math.sin(e.a) * L), [ax, ay] = world.project(e.x, h, e.y);
        let dx = bx - ax, dy = by - ay; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const nx = -dy, ny = dx, r = Math.max(5, o.r * 0.8);
        og.lineWidth = 1.3; og.beginPath();
        for (let i = -1; i <= 1; i++) {
          const sx = o.x + dx * r + nx * i * r * 0.55, sy = o.y + dy * r + ny * i * r * 0.55, ln = len * (0.7 + 0.3 * rnd(e.id, i + Math.floor(performance.now() / 120)));
          og.moveTo(sx, sy); og.lineTo(sx + dx * ln, sy + dy * ln);
        }
        og.stroke();
      }
    }
    // The ghost plan, in pen and ink: what is planned in dotted orange, what was in dashed blue-grey, and a building
    // being placed in green or red.
    // The plan's orange is a burnt orange, between the first pale one and the darkest, dotted close enough to read
    // on cream paper without weighing on the map.
    const PLAN = '#d0602a', WAS = '#5a71a0';
    const INK_OF = { '#7fe0a0': '#1f6b34', '#ffa040': '#b4400e', '#ff8a70': '#a8200e' };
    const dotted = () => { og.setLineDash([0.5, 3.6]); og.lineCap = 'round'; og.lineWidth = 2.1; };
    const dashed = () => { og.setLineDash([6, 4]); og.lineCap = 'butt'; og.lineWidth = 1.4; };
    // A box standing on the ground over cells x..x+w, y..y+h, ht tall, as a wireframe.
    function box3(s, x, y, w, h, ht) {
      const g = terrainAt(s.map, clamp(x + w / 2, 0, W), clamp(y + h / 2, 0, H)) + 0.05;
      const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const lo = c.map(([a, b]) => world.project(a, g, b)), hi = c.map(([a, b]) => world.project(a, g + ht, b));
      og.beginPath();
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        og.moveTo(lo[i][0], lo[i][1]); og.lineTo(lo[j][0], lo[j][1]);
        og.moveTo(hi[i][0], hi[i][1]); og.lineTo(hi[j][0], hi[j][1]);
        og.moveTo(lo[i][0], lo[i][1]); og.lineTo(hi[i][0], hi[i][1]);
      }
      og.stroke();
    }
    // Each chosen unit's way to its goal, traced from the rules' own pathing, kept a quarter second at a time and
    // traced again sooner when the goal moves.
    const routes = new Map();
    // The routes are drawn on a sheet of their own, and every unit on screen is cut out of it before it is laid on
    // the overlay, so a route passes under the units it crosses and not over them.
    let planC = null, pg = null;
    function routeOf(s, e, tx, ty) {
      const now = performance.now(), key = `${tx.toFixed(1)},${ty.toFixed(1)}`, r = routes.get(e.id);
      if (r && r.key === key && now - r.at < 250) return r.pts;
      const pts = Rules.route(s, e, tx, ty);
      routes.set(e.id, { key, at: now, pts });
      if (routes.size > 400) for (const id of routes.keys()) { routes.delete(id); if (routes.size <= 200) break; }
      return pts;
    }
    function drawGhostPlan(s, t, selected) {
      og.save();
      // What was: a building destroyed in sight stays a minute as its dashed outline.
      og.strokeStyle = WAS; dashed();
      for (const b of world.pastBoxes) { og.globalAlpha = Math.min(1, (b.life - b.t) / 15) * 0.9; box3(s, b.x, b.y, b.w, b.h, b.ht); }
      og.globalAlpha = 1;
      // What is planned: the building being placed, and where the chosen units are bound.
      const g = world.ghostState;
      if (g) {
        // A building being placed: each cell of its footprint washed green where it is clear and red where it is
        // not, and its box ruled solid in green when it fits, dashed in red when it does not. Dark paper turns the
        // whole overlay, so these inks serve both.
        const fit = '#3d7a3a', nofit = '#b8301a';
        og.save(); og.setLineDash([]);
        for (const [x, y, bad] of g.cells || []) {
          const q = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([a, b]) => world.project(a, terrainAt(s.map, clamp(a, 0, W), clamp(b, 0, H)) + 0.04, b));
          og.globalAlpha = bad ? 0.34 : 0.22; og.fillStyle = bad ? nofit : fit;
          og.beginPath(); og.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) og.lineTo(q[i][0], q[i][1]); og.closePath(); og.fill();
        }
        og.restore();
        og.strokeStyle = g.ok ? fit : nofit;
        if (g.ok) { og.setLineDash([]); og.lineCap = 'round'; og.lineWidth = 1.8; } else dashed();
        const d = BUILDINGS[g.kind]; box3(s, g.x, g.y, d.w, d.h, world.bHeight(g.kind));
      }
      if (!planC || planC.width !== ov.width || planC.height !== ov.height) { planC = planC || document.createElement('canvas'); planC.width = ov.width; planC.height = ov.height; pg = planC.getContext('2d'); }
      pg.setTransform(1, 0, 0, 1, 0, 0); pg.clearRect(0, 0, planC.width, planC.height); pg.setTransform(og.getTransform());
      pg.strokeStyle = PLAN; pg.setLineDash([0.5, 3.6]); pg.lineCap = 'round'; pg.lineWidth = 2.1;
      og.strokeStyle = PLAN; dotted();
      const ends = [], shared = new Set(), nums = [];
      let byId = null, drawn = 0;
      for (const e of selected) {
        if (!e || e.b || e.team !== t || e.hp <= 0 || !e.ord) continue;
        const o = e.ord;
        let tx, ty;
        if (o.t === 'move' || o.t === 'amove') { tx = o.x; ty = o.y; }
        else if (o.id !== undefined) {
          byId = byId || new Map(s.ents.map(u => [u.id, u]));
          const v = byId.get(o.id);
          if (v && v.hp > 0 && Rules.seenBy(s, t, v)) { tx = v.x; ty = v.y; } else if (o.x !== undefined) { tx = o.x; ty = o.y; }
        } else if (o.t === 'capture' && s.towns[o.town]) { tx = s.towns[o.town].x; ty = s.towns[o.town].y; }
        if (tx === undefined) continue;
        tx = clamp(tx, 0, W); ty = clamp(ty, 0, H);
        const air = Rules.isAir(e);
        const [ax, ay] = world.project(e.x, Rules.heightAt(s.map, clamp(e.x, 0, W), clamp(e.y, 0, H)) + (air ? e.z : 0.2), e.y);
        const [bx, by] = world.project(tx, Rules.heightAt(s.map, tx, ty) + 0.2, ty);
        pg.beginPath(); pg.moveTo(ax, ay); drawn++;
        // A ground unit's line follows the way it will take, roads and tracks and all; an aircraft's flies straight.
        // A stretch that units share is drawn once, so a column's lines stay one dotted line, not a solid stripe.
        // Stretches are matched to the half cell, either way along, so near and reversed copies count as shared.
        if (!air) {
          let px0 = e.x, py0 = e.y;
          const hc = v => Math.round(v * 2);
          for (const [px, py] of routeOf(s, e, tx, ty).slice(1)) {
            const a = `${hc(px0)},${hc(py0)}`, b = `${hc(px)},${hc(py)}`, k = a < b ? a + '>' + b : b + '>' + a;
            const [qx, qy] = world.project(px, Rules.heightAt(s.map, px, py) + 0.2, py);
            if (shared.has(k) || a === b) pg.moveTo(qx, qy); else { shared.add(k); pg.lineTo(qx, qy); }
            px0 = px; py0 = py;
          }
        }
        pg.lineTo(bx, by); pg.stroke();
        if (!ends.some(p => Math.abs(p[0] - bx) < 8 && Math.abs(p[1] - by) < 8)) ends.push([bx, by]);
        // Orders queued with Shift: on from there through each in turn, each numbered.
        if (e.oq && e.oq.length) {
          let qx0 = bx, qy0 = by;
          nums.push([bx, by, 1]);
          e.oq.forEach((q, i) => {
            let px2 = q.x, py2 = q.y;
            if (q.t === 'attack') { byId = byId || new Map(s.ents.map(u => [u.id, u])); const v = byId.get(q.id); if (!v || v.hp <= 0 || !Rules.seenBy(s, t, v)) return; px2 = v.x; py2 = v.y; }
            px2 = clamp(px2, 0, W); py2 = clamp(py2, 0, H);
            const [sx, sy] = world.project(px2, Rules.heightAt(s.map, px2, py2) + 0.2, py2);
            pg.beginPath(); pg.moveTo(qx0, qy0); pg.lineTo(sx, sy); pg.stroke();
            if (!ends.some(p => Math.abs(p[0] - sx) < 8 && Math.abs(p[1] - sy) < 8)) ends.push([sx, sy]);
            nums.push([sx, sy, i + 2]);
            qx0 = sx; qy0 = sy;
          });
        }
      }
      if (drawn) {
        pg.globalCompositeOperation = 'destination-out'; pg.setLineDash([]);
        for (const o of world.onScreen) { if (o.e.b) continue; pg.beginPath(); pg.arc(o.x, o.y, Math.max(4, o.r * 1.15), 0, 6.3); pg.fill(); }
        pg.globalCompositeOperation = 'source-over';
        og.save(); og.setTransform(1, 0, 0, 1, 0, 0); og.globalAlpha = 1; og.drawImage(planC, 0, 0); og.restore();
      }
      for (const [x, y] of ends) { og.beginPath(); og.ellipse(x, y, 9, 5.5, 0, 0, 6.3); og.stroke(); }
      if (nums.length) {
        og.fillStyle = PLAN; og.font = 'italic 600 12px Georgia, serif'; og.textAlign = 'left'; og.textBaseline = 'bottom';
        const put = new Set();
        for (const [x, y, n] of nums) { const key = `${Math.round(x / 6)},${Math.round(y / 6)}`; if (put.has(key)) continue; put.add(key); og.fillText(String(n), x + 9, y - 5); }
      }
      og.restore();
    }
    // A key to the plan, as the atlas's ghost plan carries one, in the corner the selection panel leaves free.
    function drawKey() {
      const x = world.vw - 118, y = world.vh - 72;
      og.save(); og.setLineDash([]);
      og.fillStyle = 'rgba(250,244,228,0.9)'; og.strokeStyle = 'rgba(31,26,22,0.85)'; og.lineWidth = 1;
      og.fillRect(x, y, 104, 58); og.strokeRect(x + 0.5, y + 0.5, 103, 57);
      og.font = `italic 14px ${labelFont()}`; og.textBaseline = 'middle'; og.textAlign = 'left';
      const row = (i, label, draw) => { const yy = y + 12 + i * 17; draw(x + 10, yy); og.setLineDash([]); og.fillStyle = '#3d352c'; og.fillText(label, x + 46, yy + 1); };
      row(0, 'was', (a, b) => { og.strokeStyle = WAS; dashed(); og.beginPath(); og.moveTo(a, b); og.lineTo(a + 28, b); og.stroke(); });
      row(1, 'planned', (a, b) => { og.strokeStyle = PLAN; dotted(); og.beginPath(); og.moveTo(a, b); og.lineTo(a + 28, b); og.stroke(); });
      row(2, 'now', (a, b) => { og.fillStyle = '#cdc1ab'; og.fillRect(a + 7, b - 5, 14, 10); og.strokeStyle = '#1f1a16'; og.lineWidth = 1.2; og.strokeRect(a + 7, b - 5, 14, 10); });
      og.restore();
    }
    const smoothstepJS = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
    // The overlay's ink, and a side's colour let down toward the paper as a wash, never so far that a red turns pink.
    // The dark scheme turns the whole overlay over with a filter, so these are always the light paper's, and there a
    // pale red wash turns dark red, so it is let down the whole way.
    const INK = '#1f1a16', washOf = team => Axo.wash(SLOT_CSS[team] || '#d9d4c3', { mix: [250, 244, 228], mixK: 0.45 }, Looks.dark);
    const onView = (x, y, m = 80) => x > -m && y > -m && x < world.vw + m && y < world.vh + m;
    // Lamps at night: warm light round lived-in houses and every building in sight, and cars' headlights.
    function drawLamps(s) {
      const sk = world.sky, L = world.life, k = sk.night;
      if (!inked() || k < 0.15) return;
      og.save();
      const pool = (x, y, z, r, a) => {
        const [px, py] = world.project(x, y, z);
        if (!onView(px, py)) return;
        const R = r * world.ppu(x, y, z), g = og.createRadialGradient(px, py, 0, px, py, R);
        g.addColorStop(0, `rgba(255,212,130,${a * k})`); g.addColorStop(1, 'rgba(255,212,130,0)');
        og.fillStyle = g; og.fillRect(px - R, py - R, R * 2, R * 2);
      };
      s.map.houses.forEach((h, i) => { const x = h.x + h.w / 2, y = h.y + h.h / 2; if (s.hh[i] > 0 && world.visible(x, y)) pool(x, terrainAt(s.map, x, y) + 0.8, y, 2.4, 0.36); });
      for (const o of world.onScreen) if (o.e.b) pool(o.e.x, terrainAt(s.map, o.e.x, o.e.y) + 1, o.e.y, Math.max(o.e.w, o.e.h) * 0.75, 0.24);
      if (L) for (const c of L.cars) {
        if (!world.visible(c.x, c.y) || c.wait > 0) continue;
        const ca = Math.cos(c.a), sa = Math.sin(c.a), g0 = Rules.heightAt(s.map, c.x, c.y) + 0.2;
        const [ax, ay] = world.project(c.x + ca * 0.5, g0, c.y + sa * 0.5), [bx, by] = world.project(c.x + ca * 4.5 - sa * 1.3, g0, c.y + sa * 4.5 + ca * 1.3), [cx, cy] = world.project(c.x + ca * 4.5 + sa * 1.3, g0, c.y + sa * 4.5 - ca * 1.3);
        if (!onView(ax, ay)) continue;
        const g = og.createLinearGradient(ax, ay, (bx + cx) / 2, (by + cy) / 2);
        g.addColorStop(0, `rgba(255,240,180,${0.5 * k})`); g.addColorStop(1, 'rgba(255,240,180,0)');
        og.fillStyle = g; og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx, by); og.lineTo(cx, cy); og.closePath(); og.fill();
      }
      og.restore();
    }
    // Trees on fire, in pen and ink: tongues of flat red, orange and yellow ink in a flickering black outline.
    function drawFires() {
      const F = world.fireSpots;
      if (!F || !F.length || !inked()) return;
      const now = performance.now() / 1000;
      og.save(); og.setLineDash([]); og.lineJoin = 'round'; og.strokeStyle = '#1a1512';
      for (const f of F) {
        const [x, y] = world.project(f.x, f.y, f.z);
        if (!onView(x, y, 40)) continue;
        const u = world.ppu(f.x, f.y, f.z) * f.s * 0.8, k = Math.floor(now * 7 + f.c) % 3;
        const tongue = (h, w, col, lw) => {
          og.beginPath(); og.moveTo(x - w, y);
          for (let i = 0; i < 3; i++) {
            const cx = x - w + w * (i + 0.5) * 2 / 3, tip = h * (0.7 + 0.3 * ((i * 7 + k * 3 + f.c) % 5) / 4);
            og.quadraticCurveTo(cx - w * 0.3, y - tip * 0.5, cx + (k - 1) * w * 0.12, y - tip);
            og.quadraticCurveTo(cx + w * 0.3, y - tip * 0.45, x - w + w * (i + 1) * 2 / 3, y - h * 0.18);
          }
          og.quadraticCurveTo(x + w * 0.6, y + h * 0.12, x - w, y); og.closePath();
          og.fillStyle = col; og.fill(); if (lw) { og.lineWidth = lw; og.stroke(); }
        };
        // Flames in the look's manner: filled bands, flicks of line alone, or a warm wash.
        const fx = world.style.fx || 0;
        if (fx === 0) { tongue(u * 0.95, u * 0.42, '#d8401c', Math.max(1, u * 0.05)); tongue(u * 0.62, u * 0.3, '#f5891e', 0); tongue(u * 0.32, u * 0.17, '#ffd84a', 0); }
        else if (WASHY.has(fx)) { tongue(u * 0.95, u * 0.42, 'rgba(232,110,40,0.45)', 0); tongue(u * 0.55, u * 0.26, 'rgba(255,200,90,0.6)', 0); }
        else { tongue(u * 0.95, u * 0.42, 'rgba(0,0,0,0)', Math.max(1, u * 0.05)); tongue(u * 0.55, u * 0.22, 'rgba(0,0,0,0)', Math.max(0.8, u * 0.035)); }
      }
      og.restore();
    }
    // Telegraph wires from pole to pole, sagging a little between, over ground the side has seen.
    function drawWires() {
      const ws = world.roadWires();
      if (!ws.length) return;
      og.save(); og.strokeStyle = 'rgba(31,26,22,0.55)'; og.lineWidth = 0.8; og.setLineDash([]);
      og.beginPath();
      for (const [a, b] of ws) {
        if (!world.known(a[0], a[2]) || !world.known(b[0], b[2])) continue;
        const p = world.project(a[0], a[1], a[2]), q = world.project(b[0], b[1], b[2]);
        if (!onView(p[0], p[1], 40) && !onView(q[0], q[1], 40)) continue;
        // The curve passes through the sagging middle.
        const m = world.project((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.3, (a[2] + b[2]) / 2);
        og.moveTo(p[0], p[1]); og.quadraticCurveTo(2 * m[0] - (p[0] + q[0]) / 2, 2 * m[1] - (p[1] + q[1]) / 2, q[0], q[1]);
      }
      og.stroke(); og.restore();
    }
    // Birds as two quick strokes each, wings rising and falling.
    function drawBirds() {
      const L = world.life;
      if (!L || !L.birds.length) return;
      og.save(); og.strokeStyle = 'rgba(31,26,22,0.85)'; og.lineCap = 'round'; og.lineJoin = 'round'; og.setLineDash([]);
      for (const b of L.birds) {
        if (!world.visible(b.x, b.z)) continue;
        const [x, y] = world.project(b.x, b.y, b.z);
        if (!onView(x, y, 20)) continue;
        const sz = clamp(world.ppu(b.x, b.y, b.z) * 0.32, 2.5, 8), f = Math.sin(b.flap);
        og.lineWidth = Math.max(1, sz * 0.2);
        og.beginPath(); og.moveTo(x - sz, y - sz * 0.4 * f); og.quadraticCurveTo(x - sz * 0.45, y - sz * 0.45 - sz * 0.3 * f, x, y);
        og.quadraticCurveTo(x + sz * 0.45, y - sz * 0.45 - sz * 0.3 * f, x + sz, y - sz * 0.4 * f); og.stroke();
      }
      og.restore();
    }
    // The AI Data Center's forecast: where the rain clouds and a dust storm's front will be a minute from now, as
    // dashed outlines on the land lettered with what is coming.
    const FORECAST = 60 * Rules.HZ;
    function drawForecast(s) {
      const M = s.map, at = (x, y) => world.project(x, Rules.terrainAt(M, Math.max(0, Math.min(M.W - 1, x)), Math.max(0, Math.min(M.H - 1, y))), y), t1 = s.tick + FORECAST;
      og.save(); og.setLineDash([7, 5]); og.lineWidth = 1.6; og.font = `italic 600 12px ${labelFont()}`; og.textAlign = 'center'; og.textBaseline = 'middle';
      const word = (text, x, y, col) => { og.lineWidth = 3; og.strokeStyle = 'rgba(246,240,226,0.9)'; og.strokeText(text, x, y); og.fillStyle = col; og.fillText(text, x, y); og.lineWidth = 1.6; };
      for (const c of Rules.showersAt(s, t1)) {
        if (c.k < 0.3) continue;
        const col = c.kind === 'snow' ? 'rgba(90,110,150,0.85)' : c.storm > 0.3 ? 'rgba(60,64,96,0.9)' : 'rgba(64,92,140,0.85)';
        og.strokeStyle = col; og.beginPath();
        for (let i = 0; i <= 32; i++) { const a = i / 32 * 6.283, [x, y] = at(c.x + Math.cos(a) * c.r * 0.8, c.y + Math.sin(a) * c.r * 0.8); i ? og.lineTo(x, y) : og.moveTo(x, y); }
        og.stroke();
        const [lx, ly] = at(c.x, c.y);
        if (lx > 0 && ly > 0 && lx < world.vw && ly < world.vh) word(c.kind === 'snow' ? 'Snow in a minute' : c.storm > 0.3 ? 'Storm in a minute' : 'Rain in a minute', lx, ly, col);
      }
      const dw = Rules.dustWall(s, t1);
      if (dw && dw.k > 0.3) {
        // The front, a line across the map at right angles to the wind, from edge to edge.
        const cx = M.W / 2 + dw.dx * dw.front, cy = M.H / 2 + dw.dy * dw.front, col = 'rgba(150,104,52,0.9)';
        og.strokeStyle = col; og.beginPath();
        for (let i = 0; i <= 40; i++) { const k = (i / 40 - 0.5) * M.W * 1.5, [x, y] = at(cx - dw.dy * k, cy + dw.dx * k); i ? og.lineTo(x, y) : og.moveTo(x, y); }
        og.stroke();
        const [lx, ly] = at(cx, cy);
        if (lx > 0 && ly > 0 && lx < world.vw && ly < world.vh) word('Dust storm front in a minute', lx, ly, col);
      }
      og.restore();
    }
    // A satellite constellation's pass: a train of twelve small satellites high over the map on a straight track,
    // each a pale body with two blue solar panels edged in ink, some catching the sun. The side that launched it
    // also sees the dashed ground track and the pale swath of ground the pass lights up.
    function drawSatPass(s, team, own) {
      const q = Rules.satPass(s, team);
      if (!q) return;
      const M = s.map, clampW = v => Math.max(0, Math.min(M.W - 1, v)), clampH = v => Math.max(0, Math.min(M.H - 1, v));
      const at = (sv, off = 0, up = 0) => { const x = q.px + q.dx * sv - q.dy * off, y = q.py + q.dy * sv + q.dx * off; return world.project(x, Rules.terrainAt(M, clampW(x), clampH(y)) + up, y); };
      const inMap = sv => { const x = q.px + q.dx * sv, y = q.py + q.dy * sv; return x > -6 && y > -6 && x < M.W + 6 && y < M.H + 6; };
      const from = Math.max(-q.L / 2, q.s - 90), to = q.s;
      og.save();
      if (own && to > from) {
        // The swath already passed over, fading behind the train.
        og.beginPath();
        for (let sv = from; sv <= to; sv += 3) { const [x, y] = at(sv, 10); sv === from ? og.moveTo(x, y) : og.lineTo(x, y); }
        for (let sv = to; sv >= from; sv -= 3) { const [x, y] = at(sv, -10); og.lineTo(x, y); }
        og.closePath(); og.fillStyle = 'rgba(250,247,236,0.32)'; og.fill();
        og.setLineDash([3, 5]); og.strokeStyle = 'rgba(60,80,120,0.5)'; og.lineWidth = 1;
        for (const sg of [10, -10]) { og.beginPath(); for (let sv = from; sv <= to; sv += 2) { const [x, y] = at(sv, sg); sv === from ? og.moveTo(x, y) : og.lineTo(x, y); } og.stroke(); }
        og.setLineDash([10, 6]); og.strokeStyle = 'rgba(40,60,110,0.65)'; og.lineWidth = 1.4; og.beginPath();
        for (let sv = from; sv <= to + 40; sv += 2) { const [x, y] = at(sv); sv === from ? og.moveTo(x, y) : og.lineTo(x, y); }
        og.stroke(); og.setLineDash([]);
      }
      const [h0x, h0y] = at(q.s, 0, 26), [h1x, h1y] = at(q.s + 4, 0, 26), dir = Math.atan2(h1y - h0y, h1x - h0x);
      for (let i = 0; i < 12; i++) {
        const sv = q.s - i * 6;
        if (!inMap(sv)) continue;
        const [px, py] = at(sv, 0, 26), k = 1.6 - i * 0.04;
        og.save(); og.translate(px, py); og.rotate(dir + Math.PI / 2); og.scale(k, k); og.lineWidth = 1.1; og.strokeStyle = '#1f1a16';
        for (const sx of [-1, 1]) {
          const x0 = sx < 0 ? -11.5 : 3.5;
          og.fillStyle = '#3c5c8c'; og.beginPath(); og.rect(x0, -2.6, 8, 5.2); og.fill(); og.stroke();
          og.strokeStyle = 'rgba(230,236,250,0.7)'; og.lineWidth = 0.6; og.beginPath(); for (let c = 1; c < 4; c++) { og.moveTo(x0 + c * 2, -2.4); og.lineTo(x0 + c * 2, 2.4); } og.stroke(); og.strokeStyle = '#1f1a16'; og.lineWidth = 1.1;
        }
        og.fillStyle = '#f2ede0'; og.beginPath(); og.rect(-3.2, -3.2, 6.4, 6.4); og.fill(); og.stroke();
        og.restore();
        if (i % 4 === 1) { og.strokeStyle = 'rgba(255,250,220,0.95)'; og.lineWidth = 1.2; og.beginPath(); og.moveTo(px - 5, py); og.lineTo(px + 5, py); og.moveTo(px, py - 5); og.lineTo(px, py + 5); og.stroke(); }
      }
      og.restore();
    }
    // Lightning, a jagged bolt for a moment, with thunder after, later the farther off it falls. A strike the rules
    // make comes down where it lands; in a storm, now and then, one falls under a storm cloud in the view.
    let bolt = null, boltT = 8;
    function boltTo(x, y) {
      const x0 = x + (Math.random() - 0.5) * 120, pts = [[x0, -10]];
      for (let i = 1; i <= 8; i++) { const k = i / 8; pts.push([x0 + (x - x0) * k + (i < 8 ? (Math.random() - 0.5) * 46 * (1 - k * 0.5) : 0), -10 + (y + 10) * k]); }
      bolt = { pts, t: 0 };
    }
    function strike(e) {
      const s = game.S, [x, y] = world.project(e.x, Rules.terrainAt(s.map, e.x, e.y), e.y), c = world.cam;
      const on = x > -20 && y > 0 && x < world.vw + 20 && y < world.vh + 20, far = Math.hypot(e.x - c.x, e.y - c.y);
      if (on && !bolt) boltTo(x, y);
      if (far < 90) setTimeout(() => game.audio.play('thunder', { gain: Math.max(0.25, 1 - far / 110), vary: 0.2 }), 150 + far * 28);
    }
    function drawLightning(dt) {
      const sk = world.sky;
      boltT -= dt;
      if (sk.storm > 0.6 && boltT <= 0 && !bolt) {
        boltT = 10 + Math.random() * 14;
        const under = Rules.showersAt(game.S).filter(c => c.storm > 0.3), c = under[Math.floor(Math.random() * under.length)];
        if (c) {
          const a = Math.random() * 6.283, d = c.r * 0.7 * Math.sqrt(Math.random()), wx = c.x + Math.cos(a) * d, wy = c.y + Math.sin(a) * d;
          const [x, y] = world.project(wx, Rules.terrainAt(game.S.map, wx, wy), wy);
          if (x > world.vw * 0.05 && x < world.vw * 0.95 && y > world.vh * 0.2 && y < world.vh * 0.95) {
            boltTo(x, y);
            setTimeout(() => game.audio.play('thunder', { gain: 0.9, vary: 0.2 }), 400 + Math.random() * 1600);
          }
        }
      }
      if (!bolt) return;
      bolt.t += dt;
      if (bolt.t > 0.24) { bolt = null; return; }
      og.save(); og.setLineDash([]); og.lineJoin = 'miter';
      og.globalAlpha = bolt.t < 0.06 || (bolt.t > 0.11 && bolt.t < 0.16) ? 1 : 0.45;
      const line = (w, col) => { og.strokeStyle = col; og.lineWidth = w; og.beginPath(); bolt.pts.forEach(([a, b], i) => i ? og.lineTo(a, b) : og.moveTo(a, b)); og.stroke(); };
      line(8, 'rgba(255,246,190,0.75)'); line(2.2, '#1f1a16');
      const [ex, ey] = bolt.pts[bolt.pts.length - 1];
      star(ex, ey, 16, bolt.pts[1][0], 9, '#fff2a0', '#ffffff', 8);
      og.restore();
    }
    // The face for notes written on the map, as the page's --label sets it, looked up again each second.
    let labelF = 'Georgia, serif', labelT = -1e9;
    function labelFont() {
      const now = performance.now();
      if (now - labelT > 1000) { labelT = now; labelF = getComputedStyle(document.body).getPropertyValue('--label').trim() || labelF; }
      return labelF;
    }
    // The weather and the hour in a corner, with what the weather does, and a word of what is coming.
    const SKY_NAME = { clear: 'Fair', cloud: 'Overcast', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow', sand: 'Dust storm' };
    const SKY_NOTE = { rain: 'Wheels bog down under the clouds', storm: 'Aircraft grounded', fog: 'Sight cut short', snow: 'Everyone slowed', sand: 'Sight cut and aircraft down under the dust' };
    const hourName = d => d < 0.05 || d >= 0.95 ? 'Dawn' : d < 0.3 ? 'Morning' : d < 0.5 ? 'Midday' : d < 0.7 ? 'Afternoon' : d < 0.8 ? 'Dusk' : 'Night';
    function drawSkyNote(s) {
      const w = Rules.sky(s), ink = inked();
      let note = SKY_NOTE[w.kind] || (Rules.nightAt(s.tick) > 0.5 ? 'Night: sight cut short, flares light the way' : '');
      if (s.flooded) note = note ? note + '. Fords flooded' : 'Fords flooded';
      if (Rules.capDown(s)) note = note ? note + '. Cloud on the heights' : 'Cloud on the heights hides them';
      if (w.next !== w.kind && w.left < 40 * HZ) note = (SKY_NAME[w.next] || w.next) + ' coming';
      // A newcomer's protection, counting down.
      const me = game.team >= 0 ? s.P[game.team] : null, left = me && me.shield > s.tick ? Math.ceil((me.shield - s.tick) / HZ) : 0;
      if (left) note = `Protected ${left / 60 | 0}:${String(left % 60).padStart(2, '0')} · until you attack`;
      const top = `${SKY_NAME[w.kind] || ''} · ${hourName(world.sky.day)}`, x = world.vw - 12, y = 52;
      og.save(); og.setLineDash([]); og.textAlign = 'right'; og.textBaseline = 'middle';
      const f1 = ink ? `italic 16px ${labelFont()}` : '600 14px "Barlow Condensed", system-ui, sans-serif', f2 = ink ? `italic 13px ${labelFont()}` : '500 12px "Barlow Condensed", system-ui, sans-serif';
      og.font = f1; let tw = og.measureText(top).width;
      og.font = f2; if (note) tw = Math.max(tw, og.measureText(note).width);
      const bh = note ? 40 : 24;
      og.fillStyle = ink ? 'rgba(250,244,228,0.92)' : 'rgba(20,22,15,0.8)'; og.fillRect(x - tw - 14, y, tw + 14, bh);
      if (ink) { og.strokeStyle = 'rgba(31,26,22,0.85)'; og.lineWidth = 1; og.strokeRect(x - tw - 13.5, y + 0.5, tw + 13, bh - 1); }
      og.fillStyle = ink ? '#2a231c' : '#e8e0c8'; og.font = f1; og.fillText(top, x - 7, y + 12);
      if (note) { og.fillStyle = ink ? '#8a3a22' : '#f0b060'; og.font = f2; og.fillText(note, x - 7, y + 29); }
      og.restore();
    }
    // Light after dark, on either paper. Light paper takes it added to the page. The dark scheme turns the ink overlay
    // over, so there a light is laid on as the colour the turning makes it, the inverse of invert(.93) and a half
    // turn of hue.
    const HUE_HALF = [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]];
    const nightDark = () => inked() && document.body.dataset.scheme === 'dark';
    function lit(r, g, b, a) {
      if (!nightDark()) return `rgba(${r},${g},${b},${a})`;
      const c = HUE_HALF.map(row => { const u = clamp((row[0] * r + row[1] * g + row[2] * b) / 255, 0, 1); return Math.round(255 * clamp((0.93 - u) / 0.86, 0, 1)); });
      return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    }
    const glow = (x, y, r, a, c0, c1, sy = 0.8) => {
      const gr = og.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, lit(...c0, a)); gr.addColorStop(0.55, lit(...c1, a * 0.38)); gr.addColorStop(1, lit(...c1, 0));
      og.fillStyle = gr; og.beginPath(); og.ellipse(x, y, r, r * sy, 0, 0, 6.283); og.fill();
    };
    // Night: a flare burns as a bright star over a pool of warm light, and each building that fights sweeps a
    // searchlight round it. Windows are lit in the towns and the buildings, a campfire burns by each headquarters
    // and barracks, and carts carry lanterns, cars headlamps and boats a light at the stern. All show only as the
    // dark comes on.
    function drawNight(s, t) {
      const n = Rules.nightAt(s.tick);
      if (n < 0.05) return;
      const now = performance.now() / 1000, P0 = t >= 0 ? s.P[t] : null, seenAt = (x, y) => !P0 || P0.seen[Rules.cellOf(x, y)], visAt = (x, y) => !P0 || P0.vis[Rules.cellOf(x, y)];
      og.save(); og.globalCompositeOperation = nightDark() ? 'source-over' : 'lighter';
      for (const w of s.sweeps) {
        if (!w.flare || w.until <= s.tick || (t >= 0 && w.team !== t && !(s.P[t] && s.P[t].vis[Rules.cellOf(w.x, w.y)]))) continue;
        const left = (w.until - s.tick) / (20 * HZ), [x, y] = world.project(w.x, Rules.heightAt(s.map, w.x, w.y), w.y), r = w.r * world.ppu(w.x, 0, w.y);
        const fl = 0.85 + 0.15 * Math.sin(performance.now() / 70 + w.flare), a = n * Math.min(1, left * 4) * fl;
        glow(x, y, r, 0.42 * a, [255, 214, 140], [255, 170, 90]);
        // The flare itself hangs over the pool and sinks as it burns.
        const [fx, fy] = world.project(w.x, Rules.heightAt(s.map, w.x, w.y) + 3 + 5 * left, w.y);
        og.fillStyle = lit(255, 240, 200, 0.9 * a); og.beginPath(); og.arc(fx, fy, 3.2, 0, 6.283); og.fill();
      }
      for (const o of world.onScreen) {
        const e = o.e;
        if (!e.b || e.hp <= 0 || !Rules.armOf(s, e)) continue;
        const reach = (e.d.sight || 8) * 0.9, sweep = performance.now() / 2600 + e.id * 1.7, an = Math.sin(sweep) * 1.6 + e.id;
        const ex = e.x + Math.cos(an) * reach, ey = e.y + Math.sin(an) * reach, [bx, by] = world.project(ex, Rules.heightAt(s.map, ex, ey), ey);
        const [ax, ay] = world.project(e.x, Rules.heightAt(s.map, e.x, e.y) + 1.5, e.y), half = 0.22 * reach * world.ppu(ex, 0, ey);
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * half, ny = dx / L * half;
        const gr = og.createLinearGradient(ax, ay, bx, by);
        gr.addColorStop(0, lit(255, 236, 190, 0.3 * n)); gr.addColorStop(1, lit(255, 236, 190, 0.05 * n));
        og.fillStyle = gr; og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx + nx, by + ny); og.lineTo(bx - nx, by - ny); og.closePath(); og.fill();
        og.fillStyle = lit(255, 236, 190, 0.18 * n); og.beginPath(); og.ellipse(bx, by, half, half * 0.7, 0, 0, 6.283); og.fill();
      }
      // Windows on the faces of a box turned toward the viewer, a face's middle lying lower on the screen than the
      // box's own. Some stay dark, and a lamp now and then gutters.
      const windows = (cx, cy, w, h, z, k, seed) => {
        const [mx, my] = world.project(cx, z, cy);
        if (!onView(mx, my, 60)) return;
        const u = world.ppu(cx, z, cy);
        for (const [fx, fy, ax, ay, len] of [[0, -h / 2, 1, 0, w], [0, h / 2, 1, 0, w], [-w / 2, 0, 0, 1, h], [w / 2, 0, 0, 1, h]]) {
          if (world.project(cx + fx, z, cy + fy)[1] <= my) continue;
          const m = Math.max(1, Math.round(len / 1.4));
          for (let i = 0; i < m; i++) {
            const hs = ((seed * 9301 + (i + fx * 3 + fy * 7) * 49297) % 233280) / 233280;
            if (Math.abs(hs) > k) continue;
            const f = (i + 0.5) / m - 0.5, wx = cx + fx * 1.02 + ax * f * len, wy = cy + fy * 1.02 + ay * f * len;
            const [px, py] = world.project(wx, z, wy), fl = 0.88 + 0.12 * Math.sin(now * (3 + hs * 4) + seed);
            glow(px, py, u * 1.1, 0.42 * n * fl, [255, 200, 120], [255, 160, 80], 0.9);
            og.fillStyle = lit(255, 230, 160, 0.95 * n * fl); og.fillRect(px - u * 0.09, py - u * 0.12, u * 0.18, u * 0.22);
          }
        }
      };
      s.map.houses.forEach((h, i) => { if (s.hh[i] > 0 && seenAt(h.x + h.w / 2, h.y + h.h / 2)) windows(h.x + h.w / 2, h.y + h.h / 2, h.w, h.h, Rules.heightAt(s.map, h.x + h.w / 2, h.y + h.h / 2) + 0.55, 0.78, i + 1); });
      for (const o of world.onScreen) {
        const e = o.e;
        // A headquarters that fights in the early ages is lived in all the same.
        if (!e.b || e.hp <= 0 || e.d.shore || (Rules.armOf(s, e) && e.kind !== 'hq')) continue;
        windows(e.x, e.y, e.w, e.h, Rules.heightAt(s.map, e.x, e.y) + 0.8, 0.5, e.id);
        // A campfire outside the headquarters and the barracks, at the corner toward the viewer: a glow on the
        // ground, a flame that leaps and sparks.
        if (e.kind !== 'hq' && e.kind !== 'barracks') continue;
        let fx = e.x, fy = e.y, low = -1e9;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const qx = e.x + sx * (e.w / 2 + 1.1), qy = e.y + sy * (e.h / 2 + 1.1), q = world.project(qx, 0, qy)[1]; if (q > low) { low = q; fx = qx; fy = qy; } }
        const z = Rules.heightAt(s.map, fx, fy), [px, py] = world.project(fx, z, fy), u = world.ppu(fx, z, fy);
        const fl = 0.8 + 0.2 * Math.sin(now * 9 + e.id) * Math.sin(now * 13.7 + e.id * 2);
        glow(px, py, u * 2.6, 0.4 * n * fl, [255, 190, 100], [255, 130, 60]);
        const fh = u * (0.42 + 0.12 * fl);
        og.fillStyle = lit(255, 150, 60, 0.9 * n); og.beginPath(); og.moveTo(px - u * 0.16, py); og.quadraticCurveTo(px - u * 0.1, py - fh * 0.6, px + Math.sin(now * 7 + e.id) * u * 0.05, py - fh); og.quadraticCurveTo(px + u * 0.1, py - fh * 0.6, px + u * 0.16, py); og.closePath(); og.fill();
        og.fillStyle = lit(255, 232, 150, 0.9 * n); og.beginPath(); og.ellipse(px, py - fh * 0.3, u * 0.07, fh * 0.28, 0, 0, 6.283); og.fill();
        for (let k = 0; k < 3; k++) { const ph = (now * 0.7 + k / 3 + e.id * 0.13) % 1; og.fillStyle = lit(255, 200, 110, n * (1 - ph)); og.fillRect(px + Math.sin(ph * 9 + k * 2) * u * 0.18, py - fh - ph * u * 1.2, 1.6, 1.6); }
      }
      // Lamps on the roads and the water: a cart's lantern, a car's two headlamps throwing light ahead, a boat's.
      const L = world.lamps();
      for (const c of L.cars) {
        if (!visAt(c.x, c.y)) continue;
        const z = Rules.heightAt(s.map, c.x, c.y), [px, py] = world.project(c.x, z + 0.5, c.y);
        if (!onView(px, py, 40)) continue;
        const u = world.ppu(c.x, z, c.y);
        if (!L.motor) { glow(px, py, u * 0.9, 0.5 * n, [255, 214, 130], [255, 170, 80]); continue; }
        const hx = c.x + Math.cos(c.a) * 3.2, hy = c.y + Math.sin(c.a) * 3.2, [bx, by] = world.project(hx, Rules.heightAt(s.map, hx, hy), hy), [ax, ay] = world.project(c.x + Math.cos(c.a) * 0.5, z + 0.2, c.y + Math.sin(c.a) * 0.5);
        const dx = bx - ax, dy = by - ay, D = Math.hypot(dx, dy) || 1, nx = -dy / D * u * 0.7, ny = dx / D * u * 0.7;
        const gr = og.createLinearGradient(ax, ay, bx, by);
        gr.addColorStop(0, lit(255, 244, 210, 0.38 * n)); gr.addColorStop(1, lit(255, 244, 210, 0));
        og.fillStyle = gr; og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx + nx, by + ny); og.lineTo(bx - nx, by - ny); og.closePath(); og.fill();
      }
      for (const b of L.boats) {
        if (!visAt(b.x, b.y)) continue;
        const [px, py] = world.project(b.x, s.map.water + 0.5, b.y);
        if (onView(px, py, 40)) glow(px, py, world.ppu(b.x, 0, b.y) * 0.8, 0.5 * n, [255, 214, 130], [255, 170, 80]);
      }
      og.restore();
    }
    // A fallen bridge: its outline as what was, dotted orange while it is being rebuilt, and C4 counting down.
    function drawBridges(s, t) {
      const P0 = t >= 0 ? s.P[t] : null, ink = inked();
      s.map.bridges.forEach((m, i) => {
        const st = s.bridges[i], mx = (m.x0 + m.x1) / 2, my = (m.y0 + m.y1) / 2;
        if ((st.hp > 0 && !st.c4) || (P0 && !P0.seen[Rules.cellOf(mx, my)])) return;
        const [cx, cy] = world.project(mx, m.z + 0.6, my);
        if (!onView(cx, cy, 200)) return;
        og.save();
        if (st.hp <= 0 && (st.fix || ink)) {
          const nx = -m.uy * m.w / 2, ny = m.ux * m.w / 2, z = m.z + 0.1;
          const c = [[m.x0 - m.ux + nx, m.y0 - m.uy + ny], [m.x1 + m.ux + nx, m.y1 + m.uy + ny], [m.x1 + m.ux - nx, m.y1 + m.uy - ny], [m.x0 - m.ux - nx, m.y0 - m.uy - ny]].map(([a, b]) => world.project(a, z, b));
          if (st.fix) { og.strokeStyle = PLAN; dotted(); } else { og.strokeStyle = WAS; dashed(); }
          og.beginPath(); c.forEach(([a, b], k) => k ? og.lineTo(a, b) : og.moveTo(a, b)); og.closePath(); og.stroke();
          if (st.fix) { og.setLineDash([]); og.fillStyle = PLAN; og.font = `italic 14px ${labelFont()}`; og.textAlign = 'center'; og.fillText(`rebuilding, ${Math.max(0, Math.ceil((st.fix - s.tick) / HZ))}s`, cx, cy - 14); }
        }
        if (st.c4) { og.setLineDash([]); og.fillStyle = '#ff5040'; og.font = '700 13px "Share Tech Mono", monospace'; og.textAlign = 'center'; og.fillText('C4 ' + Math.max(0, Math.ceil((st.c4 - s.tick) / HZ)), cx, cy - 14); }
        og.restore();
      });
    }
    // What the ground under the pointer is, when it is a bridge or a ford.
    let groundT = 0, groundAt = null;
    function drawGroundTip(s, dt) {
      groundT -= dt;
      if (groundT <= 0) { groundT = 0.12; groundAt = state.mouse.in && !state.hover && !state.drag && world.cam.dist < 150 ? world.pick(state.mouse.x, state.mouse.y) : null; }
      if (!groundAt || state.hover) return;
      const g = groundAt, bi = Rules.bridgeAt(s, g.x, g.y), us = state.sel.filter(u => alive(u) && !u.b && u.team === team());
      let text = '';
      if (bi >= 0) {
        const st = s.bridges[bi];
        text = st.hp > 0 ? `Bridge, ${Math.round(st.hp / Rules.BRIDGE_HP * 100)}%` : st.fix ? 'Bridge, being rebuilt' : 'Bridge down';
        if (us.some(u => u.d.engineer) && !st.fix && st.hp < Rules.BRIDGE_HP) text += st.hp > 0 ? ' · right-click to mend' : ' · right-click to rebuild';
        else if (us.length && st.hp > 0) text += ' · A, then click, to blow it';
      } else {
        if (!state.fords || state.fords.W !== W) { state.fords = new Set(s.map.fordCells); state.fords.W = W; }
        if (state.fords.has(Rules.cellOf(g.x, g.y))) text = s.flooded ? 'Ford, under water' : 'Ford, slow going';
      }
      if (!text) return;
      og.save(); og.setLineDash([]); og.font = '600 13px "Barlow Condensed", system-ui, sans-serif'; og.textAlign = 'center';
      const tw = og.measureText(text).width + 12, x = state.mouse.x, yy = state.mouse.y - 26;
      og.fillStyle = 'rgba(20,18,14,0.86)'; og.fillRect(x - tw / 2, yy - 11, tw, 18);
      og.fillStyle = '#f2e8d2'; og.fillText(text, x, yy + 2); og.restore();
    }
    // King of the Hill: each hill a dashed ring on the ground as wide as the men who take it must stand, in its
    // holder's colour, a flag on a pole over it, the taking under way as an arc round the flag, and its name, a spot
    // height as a survey sheet letters one.
    function drawPoints(s, ink) {
      if (!s.koth) return;
      const R0 = Rules.KOTH_R, M = s.map;
      // The footpaths cut up to hills walled by cliffs, a fine dashed line as a survey sheet draws a path, eased over
      // three cells so its steps from cell to cell do not show.
      og.save(); og.lineJoin = 'round'; og.lineCap = 'round'; og.setLineDash([3, 4]); og.lineWidth = 1.6;
      og.strokeStyle = ink ? INK : 'rgba(250,244,228,0.85)';
      for (const tr of s.tracks || []) {
        const at = tr.cells.map(c => [c % M.W + 0.5, Math.floor(c / M.W) + 0.5]);
        og.beginPath();
        at.forEach((q, i) => {
          const a = at[Math.max(0, i - 1)], b = at[Math.min(at.length - 1, i + 1)], gx = (a[0] + q[0] + b[0]) / 3, gy = (a[1] + q[1] + b[1]) / 3;
          const [px, py] = world.project(gx, terrainAt(M, gx, gy) + 0.15, gy);
          if (i) og.lineTo(px, py); else og.moveTo(px, py);
        });
        og.stroke();
      }
      og.restore();
      for (const p of s.points) {
        const z = terrainAt(M, p.x, p.y), [x, y] = world.project(p.x, z, p.y), [, yt] = world.project(p.x, z + 3.4, p.y);
        if (x < -60 || y < -60 || x > world.vw + 60 || y > world.vh + 60) continue;
        const col = p.owner < 0 ? INK : ink ? SLOT_PLATE[p.owner] : SLOT_CSS[p.owner];
        og.save(); og.lineJoin = 'round'; og.lineCap = 'round';
        og.setLineDash([7, 5]); og.lineWidth = 2; og.strokeStyle = col; og.beginPath();
        for (let i = 0; i <= 36; i++) {
          const a = i / 36 * 6.2832, gx = p.x + Math.cos(a) * R0, gy = p.y + Math.sin(a) * R0, q = world.project(gx, terrainAt(M, gx, gy) + 0.1, gy);
          if (i) og.lineTo(q[0], q[1]); else og.moveTo(q[0], q[1]);
        }
        og.stroke(); og.setLineDash([]);
        og.strokeStyle = INK; og.lineWidth = 2; og.beginPath(); og.moveTo(x, y); og.lineTo(x, yt); og.stroke();
        og.fillStyle = p.owner < 0 ? '#faf4e4' : ink ? washOf(p.owner) : SLOT_CSS[p.owner]; og.lineWidth = 1.4;
        og.beginPath(); og.moveTo(x, yt); og.lineTo(x + 18, yt + 6); og.lineTo(x, yt + 12); og.closePath(); og.fill(); og.stroke();
        if (p.cap > 0) {
          og.lineWidth = 3; og.strokeStyle = 'rgba(250,244,228,0.9)'; og.beginPath(); og.arc(x + 6, yt + 6, 17, 0, 6.3); og.stroke();
          og.strokeStyle = p.capTeam >= 0 ? (ink ? SLOT_PLATE[p.capTeam] : SLOT_CSS[p.capTeam]) : '#d9d4c3'; og.beginPath(); og.arc(x + 6, yt + 6, 17, -1.57, -1.57 + p.cap * 6.283); og.stroke();
        }
        const name = 'Hill ' + Math.round(100 + p.z * 10);
        og.font = `italic 600 13px ${labelFont()}`; og.textAlign = 'left'; og.textBaseline = 'middle';
        og.strokeStyle = 'rgba(250,244,228,0.95)'; og.lineWidth = 3.5; og.strokeText(name, x + 24, yt + 6);
        og.fillStyle = INK; og.fillText(name, x + 24, yt + 6);
        og.restore();
      }
    }

    function drawOverlay(dt) {
      // The overlay is drawn at the canvas's own device pixels where the page knows them, so its lines and words are
      // never stretched by the browser.
      const dpr = Math.min(2, devicePixelRatio || 1), w = world.vw, h = world.vh, op = world.ovPx;
      const pw = op ? op[0] : Math.round(w * dpr), ph = op ? op[1] : Math.round(h * dpr);
      if (ov.width !== pw || ov.height !== ph) { ov.width = pw; ov.height = ph; }
      og.setTransform(pw / w, 0, 0, ph / h, 0, 0);
      og.clearRect(0, 0, w, h);
      const s = S(), t = game.team, far = world.cam.dist > 150;
      if (!s) return;
      const selected = new Set(state.sel);
      const P0 = t >= 0 ? s.P[t] : null;
      if (t >= 0 && Rules.dataOn(s, t)) drawForecast(s);
      for (let tm = 0; tm < s.P.length; tm++) if (Rules.satUp(s, tm)) drawSatPass(s, tm, tm === t);
      // With a building that trains units selected, the one its kind comes out of is lettered, where there is a
      // choice of them.
      const trainAt = new Set();
      for (const q of state.sel) if (q.b && q.team === t && q.hp > 0 && Rules.TRAINERS.includes(q.kind) && (P0.counts[q.kind] || 0) > 1) trainAt.add(Rules.producerOf(s, t, q.kind));
      drawLamps(s);

      // The map's own names, as a survey sheet letters them, once the view is drawn back far enough to want them:
      // rivers in spaced blue italics along their courses, hills in sepia beside a spot height, woods in green.
      if (inked() && world.names) drawNames(s, t >= 0 ? s.P[t] : null);
      if (inked() && game.sheet !== false) drawSheet(s);
      // Towns show who holds them and how a capture is going. In pen and ink each is a pennant in its holder's
      // wash and a name lettered on the paper, a little larger as the view pulls back.
      const ink = inked(), dist = world.cam.dist;
      for (const n of s.towns) {
        const seen = t < 0 || P0.seen[Rules.cellOf(n.x, n.y)];
        if (!seen) continue;
        const [x, y] = world.project(n.x, terrainAt(s.map, n.x, n.y) + 2.8, n.y);
        const col = n.owner < 0 ? '#d9d4c3' : SLOT_CSS[n.owner];
        if (n.cap > 0) {
          og.lineWidth = 3; og.strokeStyle = ink ? 'rgba(250,244,228,0.9)' : 'rgba(0,0,0,0.5)'; og.beginPath(); og.arc(x, y, 13, 0, 6.3); og.stroke();
          og.strokeStyle = n.capTeam >= 0 ? (ink ? SLOT_PLATE[n.capTeam] : SLOT_CSS[n.capTeam]) : '#d9d4c3'; og.beginPath(); og.arc(x, y, 13, -1.57, -1.57 + n.cap * 6.283); og.stroke();
        }
        // A King of the Hill side's keep, which is never taken, says so after its name.
        const name = Rules.townName(s, n.id) + (s.koth && n.keep !== undefined && n.keep === n.owner ? ', keep' : '');
        if (ink) {
          const fs = Math.round(12 + smoothstepJS(110, 200, dist) * 3), yy = y - 17;
          og.save(); og.setLineDash([]); og.lineJoin = 'round'; og.lineCap = 'round';
          og.font = `italic 500 ${fs}px ${labelFont()}`; og.textAlign = 'left'; og.textBaseline = 'middle';
          const tw = og.measureText(name).width, x0 = x - (tw + 12) / 2;
          og.fillStyle = n.owner < 0 ? '#faf4e4' : washOf(n.owner); og.strokeStyle = INK; og.lineWidth = 1.2;
          og.beginPath(); og.moveTo(x0, yy - fs * 0.62); og.lineTo(x0 + 8, yy - fs * 0.38); og.lineTo(x0, yy - fs * 0.12); og.closePath(); og.fill(); og.stroke();
          og.beginPath(); og.moveTo(x0, yy - fs * 0.66); og.lineTo(x0, yy + fs * 0.5); og.stroke();
          og.strokeStyle = 'rgba(250,244,228,0.95)'; og.lineWidth = 3.5; og.strokeText(name, x0 + 11, yy + 1);
          og.fillStyle = INK; og.fillText(name, x0 + 11, yy + 1);
          og.restore();
        } else {
          og.save(); og.font = `600 ${Math.round(13 + smoothstepJS(110, 200, dist) * 2)}px "Barlow Condensed", system-ui, sans-serif`; og.textAlign = 'center'; og.lineJoin = 'round';
          og.strokeStyle = 'rgba(10,12,8,0.85)'; og.lineWidth = 3; og.strokeText(name.toUpperCase(), x, y - 18);
          og.fillStyle = col; og.fillText(name.toUpperCase(), x, y - 18); og.restore();
        }
      }
      drawPoints(s, ink);

      // Pictograms come in as the view pulls back past the play distance, and take the units' places at the
      // farthest. Units of one side close together on screen share one tag that counts each kind, so a bunched
      // army reads as one group and not a heap of plates. Buildings get a mark of their name in their age.
      const tag = smoothstepJS(98, 122, dist), big = smoothstepJS(130, 170, dist), sz = 6.5 + big * 3.5, groups = [], labels = [];
      for (const o of world.onScreen) {
        const e = o.e, mine = e.team === t || (t < 0 && e.team === 0), col = SLOT_CSS[e.team] || '#d9d4c3', on = selected.has(e), hov = state.hover === e;
        if (tag > 0 && !e.b && !(e.drop > 0)) {
          const ax = o.x, ay = o.y - (1 - big) * (o.r + sz * 1.6), key = e.team * 2 + (on ? 1 : 0);
          let q = null;
          for (const g of groups) if (g.key === key && Math.abs(g.x - ax) < sz * 2.6 && Math.abs(g.y - ay) < sz * 1.9) { q = g; break; }
          if (!q) groups.push(q = { key, team: e.team, on, x: ax, y: ay, n: 0, sx: 0, sy: 0, kinds: {}, ents: [] });
          q.n++; q.sx += ax; q.sy += ay; q.x = q.sx / q.n; q.y = q.sy / q.n; q.ents.push(o);
          const k = picOf(e); q.kinds[k] = (q.kinds[k] || 0) + 1;
        }
        if (tag > 0 && e.b) labels.push(o);
        if (hov && !far) {
          const name = e.b ? Rules.nameOf(e.kind, s.P[e.team] ? s.P[e.team].tech : 1) : e.d.name, foe = e.team !== t && t >= 0;
          og.save(); og.textAlign = 'center';
          og.font = ink ? `500 14px ${labelFont()}` : '600 13px "Barlow Condensed", system-ui, sans-serif';
          const text = name + (foe ? (ink ? ', enemy' : ' (enemy)') : ''), tw = og.measureText(text).width + 12, yy = o.y - (e.b ? Math.max(e.w, e.h) * o.scale * 0.6 : o.r * 1.4) - 22;
          og.fillStyle = ink ? 'rgba(250,244,228,0.95)' : 'rgba(20,18,14,0.86)'; og.fillRect(o.x - tw / 2, yy - 11, tw, 18);
          if (ink) { og.strokeStyle = INK; og.lineWidth = 1; og.setLineDash([]); og.strokeRect(o.x - tw / 2 + 0.5, yy - 10.5, tw - 1, 17); }
          og.fillStyle = ink ? SLOT_PLATE[e.team] || INK : col; og.fillRect(o.x - tw / 2, yy + 5, tw, 2);
          og.fillStyle = ink ? INK : '#f2e8d2'; og.fillText(text, o.x, yy + 2); og.restore();
        }
        // Where tags stand in for the units, a chosen unit is shown by its group's plate, not a ring and a bar each.
        const tagged = !e.b && big > 0.5 && !hov;
        if ((on || hov) && !tagged) {
          const r = e.b ? Math.max(e.w, e.h) * 0.74 * o.scale : Math.max(10, o.r * 1.25);
          og.strokeStyle = on ? (mine ? (ink ? INK : '#a9f0c0') : (ink ? '#a3301e' : '#ff8a70')) : (ink ? 'rgba(31,26,22,0.45)' : 'rgba(255,255,255,0.5)'); og.lineWidth = 1.4; og.setLineDash([]);
          if (e.b) {
            const [ax, ay] = world.project(e.cx, terrainAt(s.map, e.x, e.y) + 0.1, e.cy), [bx, by] = world.project(e.cx + e.w, terrainAt(s.map, e.x, e.y) + 0.1, e.cy), [cx, cy] = world.project(e.cx + e.w, terrainAt(s.map, e.x, e.y) + 0.1, e.cy + e.h), [dx, dy] = world.project(e.cx, terrainAt(s.map, e.x, e.y) + 0.1, e.cy + e.h);
            og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx, by); og.lineTo(cx, cy); og.lineTo(dx, dy); og.closePath(); og.stroke();
          } else { og.beginPath(); og.ellipse(o.x, o.y + o.r * 0.3, r, r * 0.62, 0, 0, 6.3); og.stroke(); }
        }
        const damaged = e.hp < e.max * 0.995;
        if (!tagged && (on || hov || (damaged && mine && s.tick - e.under < 4 * HZ && o.scale > 8))) {
          const bw = e.b ? Math.min(90, Math.max(e.w, e.h) * o.scale * 0.9) : Math.max(18, o.r * 1.8), by = o.y - (e.b ? o.r * 0.9 : o.r * 1.1 + 6), f = e.hp / e.max;
          og.fillStyle = 'rgba(0,0,0,0.62)'; og.fillRect(o.x - bw / 2 - 1, by - 1, bw + 2, 4);
          og.fillStyle = f > 0.55 ? '#58d068' : f > 0.28 ? '#f0c040' : '#f05040'; og.fillRect(o.x - bw / 2, by, bw * f, 2);
          if (e.vet) { og.fillStyle = '#ffd34d'; og.font = '9px system-ui'; og.textAlign = 'left'; og.fillText('★'.repeat(e.vet), o.x - bw / 2, by - 2); }
          if (e.repairing) { og.fillStyle = '#7fe0a0'; og.font = '10px system-ui'; og.textAlign = 'center'; og.fillText('+', o.x + bw / 2 + 5, by + 4); }
        }
        // A squad's nerve, lettered over its head as a map notes a thing: pinned under fire, or broken and running,
        // in red with a small white flag.
        if (!e.b && e.d.men && !tagged && o.scale > 5 && ((e.sup || 0) >= Rules.PIN || e.brk)) {
          const hy = o.y - o.r * 1.1 - 16, word = e.brk ? 'broken' : 'pinned', c = e.brk ? (ink ? '#a3301e' : '#ff8a70') : (ink ? '#1a1512' : '#f2ead8');
          og.save(); og.setLineDash([]); og.textAlign = 'center'; og.textBaseline = 'middle';
          og.font = ink ? `italic 600 13px ${labelFont()}` : 'italic 600 12px system-ui';
          og.lineJoin = 'round'; og.lineWidth = 3.5; og.strokeStyle = ink ? 'rgba(250,244,228,0.92)' : 'rgba(0,0,0,0.7)'; og.strokeText(word, o.x, hy);
          og.fillStyle = c; og.fillText(word, o.x, hy);
          if (e.brk) {
            const fx = o.x + og.measureText(word).width / 2 + 6;
            og.lineWidth = 1.4; og.strokeStyle = c; og.beginPath(); og.moveTo(fx, hy + 7); og.lineTo(fx, hy - 7); og.stroke();
            og.fillStyle = '#f8f4ea'; og.beginPath(); og.moveTo(fx, hy - 7); og.lineTo(fx + 9, hy - 4.5); og.lineTo(fx, hy - 2); og.closePath(); og.fill(); og.stroke();
          }
          og.restore();
        }
        if (e.b && on && e.rally && mine) {
          const [rx, ry] = world.project(e.rally[0], terrainAt(s.map, e.rally[0], e.rally[1]) + 0.1, e.rally[1]);
          if (inked()) { og.strokeStyle = PLAN; dotted(); } else { og.strokeStyle = '#7fe0a0'; og.setLineDash([5, 4]); og.lineWidth = 1; }
          og.beginPath(); og.moveTo(o.x, o.y); og.lineTo(rx, ry); og.stroke(); og.setLineDash([]); og.lineCap = 'butt';
        }
        if (trainAt.has(e)) {
          const hy = o.y - o.r * 0.9 - 12;
          og.save(); og.setLineDash([]); og.textAlign = 'center'; og.textBaseline = 'middle';
          og.font = ink ? `italic 600 13px ${labelFont()}` : 'italic 600 12px system-ui';
          og.lineJoin = 'round'; og.lineWidth = 3.5; og.strokeStyle = ink ? 'rgba(250,244,228,0.92)' : 'rgba(0,0,0,0.7)'; og.strokeText('trains here', o.x, hy);
          og.fillStyle = ink ? '#1a1512' : '#f2ead8'; og.fillText('trains here', o.x, hy);
          og.restore();
        }
        if (e.b && e.c4) { og.fillStyle = '#ff5040'; og.font = '700 12px "Share Tech Mono", monospace'; og.textAlign = 'center'; og.fillText(Math.ceil((e.c4 - s.tick) / HZ) + '', o.x, o.y - 18); }
      }

      state.plates = [];
      if (tag > 0) {
        // Buildings first, the headquarters and the largest ahead, each mark left out where it would cover one
        // already made. In pen and ink a mark is lettered on the paper and underlined in the side's colour.
        const taken = [], free = r => !taken.some(q => r[0] < q[0] + q[2] && q[0] < r[0] + r[2] && r[1] < q[1] + q[3] && q[1] < r[1] + r[3]);
        labels.sort((a, b) => (b.e.kind === 'hq') - (a.e.kind === 'hq') || b.e.w * b.e.h - a.e.w * a.e.h);
        og.save(); og.globalAlpha = tag; og.setLineDash([]); og.textAlign = 'center'; og.textBaseline = 'middle'; og.lineJoin = 'round';
        const fs = Math.round(10 + big * 3);
        og.font = ink ? `600 ${fs}px ${labelFont()}` : `700 ${fs}px "Barlow Condensed", system-ui, sans-serif`;
        for (const o of labels) {
          const e = o.e, label = shortOf(e.kind, s.P[e.team] ? s.P[e.team].tech : 1);
          if (!label) continue;
          const tw = og.measureText(label).width + 8, th = fs + 4, r = [o.x - tw / 2 - 2, o.y - th / 2 - 1, tw + 4, th + 4];
          if (!free(r)) continue;
          taken.push(r);
          if (ink) {
            og.strokeStyle = 'rgba(250,244,228,0.95)'; og.lineWidth = 3.5; og.strokeText(label, o.x, o.y);
            og.fillStyle = INK; og.fillText(label, o.x, o.y);
            og.fillStyle = SLOT_PLATE[e.team] || INK; og.fillRect(o.x - tw / 2 + 3, o.y + fs * 0.55, tw - 6, 2);
          } else {
            og.fillStyle = SLOT_PLATE[e.team] || '#555'; og.strokeStyle = 'rgba(20,16,12,0.9)'; og.lineWidth = 1;
            og.beginPath(); og.roundRect ? og.roundRect(o.x - tw / 2, o.y - th / 2, tw, th, 3) : og.rect(o.x - tw / 2, o.y - th / 2, tw, th); og.fill(); og.stroke();
            og.fillStyle = '#fff'; og.fillText(label, o.x, o.y + 1);
          }
        }
        og.restore();
        // Then the units' tags. A side's groups whose plates would touch become one, so a bunched army has one
        // plate. The enemy's go under ours and the chosen on top, each moved off any other side's it would cover.
        const ht = sz * 1.64, size = q => {
          q.items = Object.entries(q.kinds).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([sym, n]) => ({ sym, n }));
          q.foe = t >= 0 && q.team !== t; q.w = q.items.reduce((a, it) => a + sz * 2.3 + (it.n > 1 ? sz * 0.95 : 0), 0) + (q.foe ? sz * 1.5 : 0);
        };
        const touch = (p, q) => Math.abs(p.x - q.x) < (p.w + q.w) / 2 + 2 && Math.abs(p.y - q.y) < ht + 2;
        groups.forEach(size);
        // A group that grows is checked again against the rest, and a pass that merged any is made again.
        for (let merged = true; merged;) {
          merged = false;
          for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length;) {
            const p = groups[i], q = groups[j];
            if (p.key !== q.key || !touch(p, q)) { j++; continue; }
            p.sx += q.sx; p.sy += q.sy; p.n += q.n; p.x = p.sx / p.n; p.y = p.sy / p.n; p.ents.push(...q.ents);
            for (const k in q.kinds) p.kinds[k] = (p.kinds[k] || 0) + q.kinds[k];
            size(p); groups.splice(j, 1); j = i + 1; merged = true;
          }
        }
        groups.sort((a, b) => (a.team === t) - (b.team === t) || a.on - b.on);
        const plates = [];
        // Where each plate stands, so a click on a plate is a click on its units.
        state.plates = tag > 0.3 ? plates : [];
        state.plateH = ht;
        for (const q of groups) {
          for (let pass = 0; pass < 3; pass++) for (const p of plates) if (touch(p, q)) q.y = p.y + (q.y >= p.y ? 1 : -1) * (ht + 2);
          plates.push(q);
          tagPlate(og, q.x, q.y, sz, q.items, ink
            ? { foe: q.foe, on: q.on, ink, alpha: tag, fill: washOf(q.team), line: INK, fg: INK, mono: '"Courier Prime", "Courier New", monospace' }
            : { foe: q.foe, on: q.on, ink, alpha: tag, fill: q.on ? '#e0a020' : SLOT_PLATE[q.team] || '#555', line: 'rgba(20,16,12,0.9)', fg: '#fff', mono: '"Share Tech Mono", monospace' });
        }
      }

      // Brackets on every enemy your units have marked, solid on those being fired at now.
      const marked = new Set(), aimed = new Set();
      for (const u of s.ents) if (u.team === t && !u.b && u.ord && u.ord.t === 'group') { for (const id of u.ord.list) marked.add(id); aimed.add(u.ord.id); }
      const brackets = (x, y, r, solid, col) => {
        const q = r * 0.42;
        og.strokeStyle = col; og.lineWidth = solid ? 2.4 : 1.8;
        og.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { og.moveTo(x + sx * r, y + sy * (r - q)); og.lineTo(x + sx * r, y + sy * r); og.lineTo(x + sx * (r - q), y + sy * r); }
        og.stroke();
      };
      if (marked.size) for (const o of world.onScreen) if (marked.has(o.e.id)) brackets(o.x, o.y, Math.max(9, o.e.b ? Math.max(o.e.w, o.e.h) * o.scale * 0.5 : o.r * 1.3), aimed.has(o.e.id), aimed.has(o.e.id) ? '#ff5a40' : 'rgba(255,120,90,0.75)');
      const hv = state.hover;
      if (hv && hv.team !== t && t >= 0 && state.sel.some(u => alive(u) && !u.b && u.team === t) && !state.mode && !state.alt) {
        for (const o of world.onScreen) if (o.e.team !== t && (o.e === hv || Rules.gap(hv.x, hv.y, o.e) <= STRIKE_R) && Rules.seenBy(s, t, o.e)) brackets(o.x, o.y, Math.max(9, o.e.b ? Math.max(o.e.w, o.e.h) * o.scale * 0.5 : o.r * 1.3), o.e === hv, o.e === hv ? '#ff5a40' : 'rgba(255,110,80,0.85)');
      }

      if (inked()) { drawGhostPlan(s, t, selected); drawKey(); drawInk(s, t); drawTactical(s, t); }
      drawNight(s, t); drawBridges(s, t); drawWires(); drawFires(); drawBirds(); drawLightning(dt);
      if (game.playing) { drawSkyNote(s); drawGroundTip(s, dt); }

      for (let i = (state.pops || []).length - 1; i >= 0; i--) {
        const q = state.pops[i];
        q.t += dt;
        if (q.t > 1.8) { state.pops.splice(i, 1); continue; }
        const [x, y] = world.project(q.x, Rules.heightAt(s.map, q.x, q.y) + 1.5, q.y), ink = inked();
        og.save(); og.globalAlpha = Math.min(1, (1.8 - q.t) / 0.5); og.textAlign = 'center'; og.font = ink ? `600 15px ${labelFont()}` : '700 15px "Barlow Condensed", system-ui, sans-serif';
        og.lineWidth = 3; og.strokeStyle = ink ? 'rgba(250,244,228,0.95)' : 'rgba(0,0,0,0.7)'; og.strokeText(q.text, x, y - q.t * 18);
        og.fillStyle = ink ? '#1f6b34' : '#7fe0a0'; og.fillText(q.text, x, y - q.t * 18); og.restore();
      }
      for (let i = state.marks.length - 1; i >= 0; i--) {
        const m = state.marks[i];
        m.t += dt;
        if (m.t > 0.5) { state.marks.splice(i, 1); continue; }
        const [x, y] = world.project(m.x, Rules.heightAt(s.map, m.x, m.y), m.y), k = 1 - m.t / 0.5;
        // On paper the bright screen greens and oranges are drawn in their dark inks, so they show on cream.
        og.strokeStyle = inked() ? (INK_OF[m.color] || m.color) : m.color; og.globalAlpha = k; og.lineWidth = inked() ? 2.2 : 1.6;
        og.beginPath(); og.ellipse(x, y, 16 * k + 2, (16 * k + 2) * 0.6, 0, 0, 6.3); og.stroke();
        og.beginPath(); og.ellipse(x, y, 6 * k + 1, (6 * k + 1) * 0.6, 0, 0, 6.3); og.stroke();
        og.globalAlpha = 1;
      }

      const m = state.mode;
      if (m && (m.type === 'power' || m.type === 'launch')) {
        const g = world.pick(state.mouse.x, state.mouse.y);
        if (g) {
          const r = m.type === 'launch' ? 10 : POWERS[m.name].r, [x, y] = [state.mouse.x, state.mouse.y], sc = world.vh / (2 * Math.tan(13 * Math.PI / 180) * world.cam.dist);
          if (inked()) { og.strokeStyle = PLAN; dotted(); } else { og.strokeStyle = '#ffa040'; og.lineWidth = 1.5; og.setLineDash([8, 5]); }
          og.beginPath(); og.ellipse(x, y, r * sc, r * sc * 0.82, 0, 0, 6.3); og.stroke(); og.setLineDash([]); og.lineCap = 'butt';
        }
      }

      const d = state.drag;
      if (d && d.box) {
        // The selection box: pale green on the painted looks, the player's blue ink on paper.
        if (inked()) { og.strokeStyle = '#1d3f8c'; og.lineWidth = 1.8; og.fillStyle = 'rgba(29,63,140,0.1)'; }
        else { og.strokeStyle = '#a9f0c0'; og.lineWidth = 1; og.fillStyle = 'rgba(120,240,160,0.08)'; }
        og.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); og.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      }
    }

    // The minimap stands on its corner with the viewer's base at the foot, as the camera first sees it.
    function miniTurn() { const s = S(), f = s && s.faces ? s.faces[Math.max(0, game.team)] : Math.PI / 4; return -(f + Math.PI / 2); }
    function drawMini(dt) {
      const s = S(), size = mini.width, t = team();
      if (!s || !world.baseImage) return;
      state.miniT = (state.miniT || 0) - dt;
      if (state.miniT > 0) return;
      state.miniT = 0.2;
      const P0 = t >= 0 ? s.P[t] : null, g = mg;
      // In pen and ink the map is printed on the paper: the land in sepia, the unknown left blank.
      // On dark paper the page's filter turns the map over, so its paper is a grey that lands on the panel's own
      // and its land is printed paler, to land near that paper.
      const ink = inked(), dkm = ink && Looks.dark, blank = ink ? (dkm ? [233, 229, 224] : [242, 232, 210]) : [0, 0, 0];
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = ink ? (dkm ? '#e9e5e0' : '#f2e8d2') : '#10130f'; g.fillRect(0, 0, size, size);
      // The map stands on its corner, your base at the foot, as the camera sees it.
      const k = size / Math.SQRT2 / W;
      g.translate(size / 2, size / 2); g.rotate(miniTurn()); g.scale(k, k); g.translate(-W / 2, -H / 2);
      if (ink) g.filter = dkm ? 'grayscale(1) sepia(0.3) contrast(1.15) brightness(1.45)' : 'grayscale(1) sepia(0.55) contrast(1.15) brightness(1.3)';
      g.drawImage(world.baseImage, 0, 0, W, H);
      g.filter = 'none';
      if (P0) {
        if (state.fogC && state.fogC.width !== W) state.fogC = null;
        if (!state.fogC) { state.fogC = document.createElement('canvas'); state.fogC.width = W; state.fogC.height = H; state.fogG = state.fogC.getContext('2d'); state.fogI = state.fogG.createImageData(W, H); }
        const dt0 = state.fogI.data;
        for (let c = 0; c < W * H; c++) { dt0[c * 4] = blank[0]; dt0[c * 4 + 1] = blank[1]; dt0[c * 4 + 2] = blank[2]; dt0[c * 4 + 3] = !P0.seen[c] ? 255 : P0.vis[c] ? 0 : (ink ? 110 : 130); }
        state.fogG.putImageData(state.fogI, 0, 0);
        g.drawImage(state.fogC, 0, 0, W, H);
      }
      for (const n of s.towns) {
        if (P0 && !P0.seen[Rules.cellOf(n.x, n.y)]) continue;
        g.fillStyle = n.owner < 0 ? (ink ? '#6b6052' : '#e8e0c8') : ink ? SLOT_PLATE[n.owner] : SLOT_CSS[n.owner];
        g.fillRect(n.x - 2, n.y - 2, 4, 4);
      }
      // King of the Hill: each hill a diamond in its holder's colour, ringed in ink, every hill known from the start.
      if (s.koth) for (const p of s.points) {
        const r = Math.max(3, s.map.W / 34);
        g.fillStyle = p.owner < 0 ? (ink ? '#faf4e4' : '#e8e0c8') : ink ? SLOT_PLATE[p.owner] : SLOT_CSS[p.owner];
        g.strokeStyle = ink ? '#2a221b' : 'rgba(0,0,0,0.85)'; g.lineWidth = r * 0.3;
        g.beginPath(); g.moveTo(p.x, p.y - r); g.lineTo(p.x + r, p.y); g.lineTo(p.x, p.y + r); g.lineTo(p.x - r, p.y); g.closePath(); g.fill(); g.stroke();
      }
      // Units are dots of a fixed size on the panel, whatever the map's size, each ringed in ink so it stands off
      // the land. Each side is one path, filled then stroked.
      const ur = size * 0.0085 / k, ring = ink ? '#2a221b' : 'rgba(0,0,0,0.8)', dots = new Map();
      g.lineWidth = size * 0.0032 / k; g.strokeStyle = ring;
      for (const e of s.ents) {
        const mine = e.team === t || (t < 0 && e.team === 0);
        if (!mine && P0) { if (e.b ? !P0.seen[Rules.cellOf(e.x, e.y)] : !P0.vis[Rules.cellOf(e.x, e.y)]) continue; }
        if (e.b) {
          g.fillStyle = ink ? SLOT_PLATE[e.team] : SLOT_CSS[e.team];
          g.fillRect(e.cx, e.cy, e.w, e.h); g.strokeRect(e.cx, e.cy, e.w, e.h);
          continue;
        }
        let p = dots.get(e.team); if (!p) dots.set(e.team, p = new Path2D());
        p.moveTo(e.x + ur, e.y); p.arc(e.x, e.y, ur, 0, 6.2832);
      }
      for (const [tm, p] of dots) { g.fillStyle = ink ? SLOT_PLATE[tm] : SLOT_CSS[tm]; g.fill(p); g.stroke(p); }
      // The view as a shape on the ground.
      const corners = [[0, 0], [world.vw, 0], [world.vw, world.vh], [0, world.vh]].map(([x, y]) => groundUnder(x, y));
      if (corners.every(Boolean)) {
        g.strokeStyle = ink ? '#1f1a16' : '#ffffff'; g.lineWidth = 0.6; g.beginPath();
        corners.forEach((c, i) => i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1])); g.closePath(); g.stroke();
      }
      for (let i = state.alerts.length - 1; i >= 0; i--) {
        const a = state.alerts[i];
        a.t += 0.2;
        if (a.t > 3) { state.alerts.splice(i, 1); continue; }
        g.strokeStyle = '#ff5040'; g.lineWidth = 0.9; g.beginPath(); g.arc(a.x, a.y, 2 + (a.t * 3 % 4) * 2, 0, 6.3); g.stroke();
      }
    }
    // Where a screen corner lands on a flat ground plane, for the view shape on the map.
    function groundUnder(px, py) {
      const THREE_ = window.THREE, cam = world.camera, v = new THREE_.Vector3(px / world.vw * 2 - 1, 1 - py / world.vh * 2, 0.5).unproject(cam).sub(cam.position).normalize();
      if (v.y >= -0.01) return null;
      const t = (cam.position.y - 1) / -v.y;
      return [cam.position.x + v.x * t, cam.position.z + v.z * t];
    }
    function miniTo(e) {
      const r = mini.getBoundingClientRect(), a = (e.clientX - r.left) / r.width * mini.width - mini.width / 2, b = (e.clientY - r.top) / r.height * mini.height - mini.height / 2;
      const c = Math.cos(-miniTurn()), si = Math.sin(-miniTurn()), k = mini.width / Math.SQRT2 / W;
      return [(a * c - b * si) / k + W / 2, (a * si + b * c) / k + H / 2];
    }
    let miniDown = false;
    mini.addEventListener('pointerdown', e => {
      e.preventDefault();
      const [x, y] = miniTo(e);
      if (e.button === 2) {
        const ids = orderIds();
        if (ids.length) { game.order(S(), team(), { c: 'move', ids, x, y, a: false }); marker(x, y, '#7fe0a0'); }
        return;
      }
      miniDown = true; mini.setPointerCapture?.(e.pointerId); world.focus(x, y);
    });
    mini.addEventListener('pointermove', e => { if (miniDown) { const [x, y] = miniTo(e); world.focus(x, y); } });
    mini.addEventListener('pointerup', () => { miniDown = false; });
    mini.addEventListener('contextmenu', e => e.preventDefault());

    let ro = { sup: -1, oil: -1 }, roClock = 0;
    function updateReadouts() {
      const now = performance.now();
      if (now - roClock < 100) return;
      roClock = now;
      const s = S(), p = P();
      const shownS = ro.sup < 0 ? p.supply : ro.sup + (p.supply - ro.sup) * 0.5, shownO = ro.oil < 0 ? p.oil : ro.oil + (p.oil - ro.oil) * 0.5;
      ro.sup = shownS; ro.oil = shownO;
      // Unlimited stores read as such, not as the stock the rules keep them at.
      $('sup').textContent = s.free ? '∞' : fmt(shownS); $('oil').textContent = s.free ? '∞' : fmt(shownO);
      $('sup').classList.toggle('inf', !!s.free); $('oil').classList.toggle('inf', !!s.free);
      const left = p.prod ? clamp(p.use / p.prod, 0, 1.2) : 1;
      const bar = $('pwrbar');
      bar.style.width = Math.min(100, left * 100) + '%';
      bar.className = p.low ? 'low' : left > 0.85 ? 'tight' : '';
      $('pwr').textContent = `${p.use}/${p.prod}`;
      const sec = s.tick / HZ | 0;
      $('clock').textContent = `${String(sec / 60 | 0).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      if ($('techlv').textContent !== Rules.AGES[p.tech].name) { $('techlv').textContent = Rules.AGES[p.tech].name; $('agecell').title = `The ${Rules.AGES[p.tech].name} Age, ${p.tech} of ${Rules.MAX_AGE}`; }
      // A new age brings the lines' new forms to the cards, its buildings' pictures, and power to run short of.
      const picStale = !!game.pictures && p.tech !== game.picAge;
      if (p.tech !== listAge || picStale) {
        const was = listAge;
        lineLists(p.tech);
        if (was > 0 && p.tech > was) freshen(was, p.tech);
        if (picStale) game.pictures(); else buildCams();
        if (was > 0 && p.tech > was && game.team >= 0) ageCard(p.tech);
      }
      // King of the Hill: every side's score, this side's first, and the hills it holds, in place of the power gauge,
      // as nothing is built to run on power. Under the tabs, where its recruits come out, what that town raises, and
      // its army against the cap its houses set.
      const kg = $('kgauge');
      kg.hidden = !s.koth; $('pwr').parentElement.hidden = !!s.koth;
      if (s.koth) {
        const me = game.team, order = s.P.filter(Q => !Q.out).map(Q => Q.team).sort((a, b) => (b === me) - (a === me) || a - b);
        const key = order.map(k => s.score[k]).join(',');
        if (kg.dataset.k !== key) {
          kg.dataset.k = key;
          const box = $('kscore'); box.textContent = '';
          order.forEach((k, i) => { if (i) box.append(' · '); const b = document.createElement('b'); b.style.color = SLOT_CSS[k]; b.textContent = s.score[k]; box.append(b); });
        }
        const held = me >= 0 ? s.points.filter(q => q.owner === me).length : 0, ht = `${held}/${s.points.length}`;
        if ($('kheld').textContent !== ht) $('kheld').textContent = ht;
        if (me >= 0) {
          const towns = s.towns.filter(n => n.owner === me), pick = towns.find(n => n.id === state.townPick) || towns.find(n => n.id === p.townPick) || towns[0];
          const RAISE = { hamlet: 'foot', village: 'foot, horse and light vehicles', town: 'foot, horse, guns and armour' };
          const army = s.ents.reduce((n, e) => n + (e.team === me && !e.b && e.hp > 0 ? 1 : 0), 0);
          const text = pick ? `${Rules.townName(s, pick.id)}, a ${Rules.townPay(s, pick.id, me).kind}, raises ${RAISE[Rules.townPay(s, pick.id, me).kind]}. Army ${army} of ${Rules.kothCap(s, me)}.` : 'No town left to raise an army.';
          if ($('kraise').textContent !== text) $('kraise').textContent = text;
        }
      }
      $('pwr').parentElement.classList.toggle('off', p.tech < Rules.POWER_AGE);
      if (p.tech < Rules.POWER_AGE) $('pwr').textContent = '—';
      // Short of power: a mark beside the gauge gives the shortfall, and both say what it costs now, naming only
      // what this side has.
      const gauge = $('pwr').parentElement, warn = $('pwrwarn');
      if (p.low) {
        warn.textContent = `Low power −${p.use - p.prod}`;
        const costs = ['Training and building at half speed', 'Upgrades and research at half speed'];
        if (p.counts.silo) costs.push('Missile silo not charging');
        if (p.counts.datacenter) costs.push('AI Data Center off');
        const calls = Object.keys(POWERS).filter(k => Rules.callNeed(POWERS[k]) === 'radar' && POWERS[k].tech <= p.tech).map(k => Rules.nameOf(k, p.tech));
        if (p.counts.radar && calls.length) costs.push(`Calls unavailable: ${calls.join(', ')}`);
        const note = `Low power: ${p.use - p.prod} short. Build a power plant.\n` + costs.join('\n');
        if (gauge.title !== note) { gauge.title = note; warn.title = note; }
        warn.hidden = false;
      } else {
        if (gauge.title) { gauge.title = 'Power used of power made'; warn.title = ''; }
        warn.hidden = true;
      }
      const towns = s.towns.filter(t => t.owner === team()).length;
      $('towns').textContent = `${towns}/${s.towns.length}`;
      updateSelPanel();
      updateObjective();
    }

    // A new age is a moment: a card in the readout strip's gap with the age's name, what it brings and its new
    // forms, held four seconds and let go, and the sidebar's new cards drawn in one after another.
    const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    // The lines whose new forms the card shows first, the heavy hitters ahead.
    const SHOW = ['mount', 'heavy', 'inf', 'jet', 'heli', 'at', 'siege', 'snp', 'rec', 'ifv', 'aa', 'fpv', 'hero', 'truck', 'sup'];
    const newForms = (was, age) => SHOW.map(l => Rules.formOf(l, age)).filter((k, i) => k && k !== Rules.formOf(SHOW[i], was));
    let ageT = [];
    function ageCard(age) {
      const card = $('agecard'), A = Rules.AGES[age];
      card.innerHTML = `<small>Age ${ROMAN[age]} of ${ROMAN[Rules.MAX_AGE]}</small><h2>The <em></em> Age</h2><p></p><div class="forms"></div>`;
      card.querySelector('em').textContent = A.name;
      card.querySelector('p').textContent = A.note;
      const row = card.querySelector('.forms');
      for (const k of newForms(age - 1, age).slice(0, 6)) {
        const f = document.createElement('figure'), img = document.createElement('img'), c = document.createElement('figcaption');
        img.src = state.cameos[k] || ''; img.alt = ''; c.textContent = UNITS[k].name;
        f.append(img, c); row.append(f);
      }
      // It stands centred in the gap between the readouts and the tools, or under the strip where there is none.
      const vr = view.getBoundingClientRect(), a = $('top').querySelector('.gauge.grow'), b = $('top').querySelector('.tools');
      const l = a && a.offsetParent ? a.getBoundingClientRect().right : vr.left, r = b ? b.getBoundingClientRect().left : vr.right, room = r - l - 16;
      card.classList.toggle('under', room < 330);
      card.style.left = room < 330 ? '' : `${(l + r) / 2 - vr.left}px`;
      card.style.width = room < 330 ? '' : `${Math.min(460, room)}px`;
      ageT.forEach(clearTimeout);
      card.hidden = false; card.classList.remove('show', 'gone'); void card.offsetWidth; card.classList.add('show');
      // It stays twelve seconds, long enough to read the new forms through, then fades.
      ageT = [setTimeout(() => card.classList.add('gone'), 12000), setTimeout(() => { card.hidden = true; card.classList.remove('show', 'gone'); }, 12700)];
    }
    // The cards an age brings: the lines' new forms, and the buildings and calls it opens.
    function freshen(was, age) {
      const f = new Set(['tech', ...Object.keys(Rules.LINES).map(l => Rules.formOf(l, age)).filter((k, i) => k && k !== Rules.formOf(Object.keys(Rules.LINES)[i], was))]);
      for (const k of [...ALL.bld, ...ALL.def, ...ALL.pow]) { const d = k === 'launch' ? BUILDINGS.silo : BUILDINGS[k] || POWERS[k]; if (d && (d.tech || 1) > was && (d.tech || 1) <= age) f.add(k); }
      state.fresh = f; state.freshUntil = performance.now() + 9000;
      setTimeout(() => { for (const n of document.querySelectorAll('#cams .new')) n.remove(); }, 9000);
    }

    // The formations, drawn as the places they lay out, front at the top.
    const FORM_NAME = { line: 'Line', block: 'Block', column: 'Column', wedge: 'Wedge', square: 'Square', loose: 'Loose order' };
    const dots = pts => `<svg viewBox="0 0 24 16" aria-hidden="true">${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7"/>`).join('')}</svg>`;
    const FORM_ICON = {
      line: dots([[3, 6], [7.5, 6], [12, 6], [16.5, 6], [21, 6], [3, 11], [7.5, 11], [12, 11], [16.5, 11], [21, 11]]),
      block: dots([[7, 3], [12, 3], [17, 3], [7, 8], [12, 8], [17, 8], [7, 13], [12, 13], [17, 13]]),
      column: dots([[9.5, 2], [14.5, 2], [9.5, 6], [14.5, 6], [9.5, 10], [14.5, 10], [9.5, 14], [14.5, 14]]),
      wedge: dots([[12, 2.5], [9, 7], [15, 7], [6, 11.5], [12, 11.5], [18, 11.5]]),
      square: dots([[6, 3], [12, 3], [18, 3], [6, 8], [18, 8], [6, 13], [12, 13], [18, 13]]).replace('</svg>', '<circle cx="12" cy="8" r="1.4" fill="none" stroke="currentColor" stroke-width="1"/></svg>'),
      loose: dots([[3, 3], [12, 2.5], [21, 3.5], [7, 8.5], [17, 8], [3, 13.5], [12, 13], [21, 13.5]]),
    };
    // The stances, how a unit with no orders fights, drawn as a sight, a charge, a shield and a planted flag.
    const STANCE_NAME = { hunt: 'Seek and destroy', aggr: 'Aggressive', def: 'Defensive', hold: 'Hold ground' };
    const STANCE_NOTE = { hunt: 'hunts down the nearest enemy, anywhere', aggr: 'chases what it sees as far as it takes', def: 'chases a little, then goes back to its post', hold: 'fires from where it stands and never moves to fight' };
    const line = d => `<svg viewBox="0 0 24 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    // Exploring, drawn as a spyglass.
    const EXP_ICON = '<svg viewBox="0 0 24 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 15 4.5M6 13.5 17 6.5M4 11.5l2 2M15 4.5l2 2M17.5 4 20 2.5"/></svg>';
    // Falling back, drawn as a cross on a shield-like tent and an arrow home.
    const FB_ICON = '<svg viewBox="0 0 24 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8H3M6 5 3 8l3 3"/><path d="M12 3h8v10h-8z"/><path d="M16 5.5v5M13.5 8h5"/></svg>';
    const STANCE_ICON = {
      hunt: line('<circle cx="12" cy="8" r="4.5"/><path d="M12 1.5v3M12 11.5v3M5.5 8h3M15.5 8h3"/>'),
      aggr: line('<path d="M7 9.5 12 4.5l5 5M7 13.5 12 8.5l5 5"/>'),
      def: line('<path d="M12 2 17.5 4v4.2c0 3-2.4 5.2-5.5 6.3-3.1-1.1-5.5-3.3-5.5-6.3V4z"/>'),
      hold: line('<path d="M10 14.5V2l6 2.6-6 2.6M6 14.5h10"/>'),
    };
    // The selected units a stance takes in: the player's own armed units on the ground or the water.
    const stanceUnits = () => state.sel.filter(e => alive(e) && !e.b && e.team === team() && !Rules.isAir(e) && !e.d.cargo && (e.d.weapons || []).length);
    function setStance(v) {
      const us = stanceUnits();
      if (!us.length) return;
      game.order(S(), team(), { c: 'stance', ids: us.map(u => u.id), v });
      say(`${STANCE_NAME[v]}.`);
    }
    // Exploring, for the selected scouts: on for all if any were off.
    const expUnits = () => state.sel.filter(e => alive(e) && !e.b && e.team === team() && Rules.canExplore(e));
    function toggleExplore() {
      const us = expUnits();
      if (!us.length) return;
      const on = !us.every(u => u.exp);
      game.order(S(), team(), { c: 'explore', ids: us.map(u => u.id), on });
      say(on ? 'Scouting ahead.' : 'Scouting stopped.');
    }
    // Falling back when badly hurt, on or off for the selected units: on for all if any were off.
    const fbUnits = () => state.sel.filter(e => alive(e) && !e.b && e.team === team() && !Rules.isAir(e) && !e.d.cargo);
    function toggleFallBack() {
      const us = fbUnits();
      if (!us.length) return;
      const on = !us.every(u => u.fb);
      game.order(S(), team(), { c: 'fallback', ids: us.map(u => u.id), on });
      say(on ? 'Falling back when badly hurt.' : 'Fighting on when hurt.');
    }
    // The selected units a formation takes in: the player's own, on the ground.
    const formUnits = () => state.sel.filter(e => alive(e) && !e.b && e.team === team() && !Rules.isAir(e));
    function setForm(f) {
      const us = formUnits();
      if (us.length < 2) return;
      game.order(S(), team(), { c: 'form', ids: us.map(u => u.id), f });
      say(`${FORM_NAME[f]} formation.`);
    }
    // The upgrades a building of the player's offers, each as its next tier: what it costs, or how far along it is
    // here, or why it cannot start. A tier at work here is cancelled by a second click.
    function upState(e) {
      const p = P();
      return Rules.upsAt(e.kind).map(k => {
        const tier = (p.up[k] || 0) + 1, here = e.up && e.up.k === k;
        return { k, tier, here, why: here ? null : Rules.upBlocked(S(), team(), k, e) };
      });
    }
    function upsHtml(e) {
      const ups = upState(e);
      if (!ups.length) return '';
      const btn = u => {
        const d = Rules.UPGRADES[u.k];
        if (u.why === 'Done') return `<button disabled title="${d.name}: ${Rules.upNote(u.k, 3)}"><b>${d.names[2]}</b><span>Done</span></button>`;
        const c = Rules.upCost(u.k, u.tier), name = d.names[u.tier - 1], note = Rules.upNote(u.k, u.tier);
        const cost = `${fmt(c.cost)}${c.oil ? ` · ${fmt(c.oil)} oil` : ''}`;
        const why = u.why === 'Under way' ? 'Under way elsewhere' : u.why && u.why.startsWith('Needs the') ? u.why.slice(10) : u.why;
        return `<button data-up="${u.k}" class="${u.here ? 'busy' : ''}"${u.why ? ' disabled' : ''} title="${d.name}, tier ${u.tier} of 3: ${note}${u.here ? ' Click to cancel.' : ''}"><b>${name}</b><span>${u.here ? 'Cancel' : why || cost}</span></button>`;
      };
      return `<div class="ups"><h4>Upgrades</h4>${ups.map(btn).join('')}</div>`;
    }
    function updateSelPanel() {
      state.sel = state.sel.filter(alive);
      const fu = formUnits(), form = fu.length > 1 ? Rules.formOfGroup(fu) : '';
      // The stance the selection shares, or none when it is mixed.
      const su = stanceUnits(), stance = su.length ? (su.every(u => (u.st || 'def') === (su[0].st || 'def')) ? su[0].st || 'def' : 'mixed') : '';
      // A building of the player's alone shows its upgrades, which redraw as any changes state.
      const one = state.sel.length === 1 && state.sel[0].b && state.sel[0].team === team() ? state.sel[0] : null;
      const ups = one ? upState(one).map(u => u.tier + (u.here ? 'h' : '') + (u.why || '')).join() : '';
      // A side with more than one building of a kind that trains units chooses which they come out of.
      const trains = !!one && Rules.TRAINERS.includes(one.kind) && (S().P[one.team].counts[one.kind] || 0) > 1;
      const here = trains && Rules.producerOf(S(), one.team, one.kind) === one;
      const fbu = fbUnits(), fb = fbu.length ? (fbu.every(u => u.fb) ? 'on' : fbu.some(u => u.fb) ? 'some' : 'off') : '';
      const exu = expUnits(), ex = exu.length ? (exu.every(u => u.exp) ? 'on' : 'off') : '';
      const box = $('sel'), list = state.sel, key = list.map(e => e.id).join() + (list[0] ? (list[0].repairing ? 'r' : '') + (list[0].team) : '') + form + stance + ups + fb + ex + (trains ? (here ? 'T' : 't') : '') + (one && one.held ? 'H' : '');
      if (key !== state.selKey) {
        state.selKey = key;
        box.hidden = !list.length;
        if (list.length) {
          const groups = {};
          for (const e of list) (groups[e.kind] = groups[e.kind] || []).push(e);
          const kinds = Object.keys(groups), first = list[0], mine = first.team === team();
          let html = '<div class="who">';
          if (kinds.length === 1 && list.length === 1) {
            html += `<div class="one"><img src="${state.cameos[picKey(first)] || ''}"${axoImg(first.kind)} alt=""><div><h3>${Rules.nameOf(first.kind, S().P[first.team] ? S().P[first.team].tech : 1)}</h3><div class="hp"><i id="hp1"></i></div><p id="stat1"></p></div></div>`;
          } else {
            html += '<div class="many">' + kinds.map(k => `<button data-k="${k}"><img src="${state.cameos[picKey(groups[k][0])] || ''}"${axoImg(k)} alt=""><b>${groups[k].length}</b></button>`).join('') + '</div>';
          }
          html += '</div><div class="acts">';
          if (mine) {
            if (first.b) {
              html += `<button id="a-rep" class="${first.repairing ? 'on' : ''}">Repair <kbd>G</kbd></button>`;
              if (first.kind !== 'hq') html += '<button id="a-sell">Sell <kbd>Del</kbd></button>';
              if (first.held) html += '<button id="a-out" title="The general steps out at the door">Let the general out</button>';
              if (trains) html += `<button id="a-train" class="${here ? 'on' : ''}" title="Units of this kind come out of this building">Train here</button>`;
            } else {
              html += `<button id="a-move" class="${state.attackMove ? 'on' : ''}">Attack-move <kbd>A</kbd></button><button id="a-stop">Stop <kbd>S</kbd></button>`;
            }
            html += '<button id="a-clear">Clear</button>';
          }
          html += '</div>';
          if (one) html += upsHtml(one);
          if (stance) html += `<div class="forms stances"><h4>Stance <kbd>L</kbd></h4><div>${Rules.STANCES.map(v => `<button data-st="${v}" class="${v === stance ? 'on' : ''}" title="${STANCE_NAME[v]}: ${STANCE_NOTE[v]}" aria-label="${STANCE_NAME[v]}">${STANCE_ICON[v]}</button>`).join('')}</div></div>`;
          if (ex) html += `<div class="forms fallback"><h4>Explore <kbd>⇧J</kbd></h4><div><button data-ex class="${ex === 'on' ? 'on' : ''}" title="Explore: roam the map by itself to what is least seen, clear of known defences, running when shot at" aria-label="Explore">${EXP_ICON}</button></div></div>`;
          if (fb) html += `<div class="forms fallback"><h4>Fall back <kbd>J</kbd></h4><div><button data-fb class="${fb === 'on' ? 'on' : ''}" title="Fall back when badly hurt: below a quarter of their health they go back to a support vehicle or a base building and mend there" aria-label="Fall back when badly hurt">${FB_ICON}</button></div></div>`;
          if (form) html += `<div class="forms"><h4>Formation <kbd>D</kbd></h4><div>${Rules.FORMS.map(f => `<button data-f="${f}" class="${f === form ? 'on' : ''}" title="${FORM_NAME[f]}" aria-label="${FORM_NAME[f]}">${FORM_ICON[f]}</button>`).join('')}</div></div>`;
          box.innerHTML = html;
          box.querySelectorAll('.forms button').forEach(b => b.addEventListener('click', () => b.dataset.ex !== undefined ? toggleExplore() : b.dataset.fb !== undefined ? toggleFallBack() : b.dataset.st ? setStance(b.dataset.st) : setForm(b.dataset.f)));
          box.querySelectorAll('.many button').forEach(b => b.addEventListener('click', () => select(state.sel.filter(e => e.kind === b.dataset.k))));
          box.querySelectorAll('.ups button[data-up]').forEach(b => b.addEventListener('click', () => {
            if (b.classList.contains('busy')) game.order(S(), team(), { c: 'unupgrade', id: first.id });
            else { game.order(S(), team(), { c: 'upgrade', id: first.id, k: b.dataset.up }); game.audio.ui('click'); }
          }));
          const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
          on('a-rep', () => game.order(S(), team(), { c: 'repair', id: first.id }));
          on('a-sell', () => { game.order(S(), team(), { c: 'sell', id: first.id }); select([]); });
          on('a-out', () => { game.order(S(), team(), { c: 'release', id: first.id }); game.audio.ui('click'); });
          on('a-train', () => { game.order(S(), team(), { c: 'primary', id: first.id }); game.audio.ui('click'); });
          on('a-stop', () => game.order(S(), team(), { c: 'stop', ids: orderIds() }));
          on('a-move', () => { if (state.touchUsed) { state.attackMove = !state.attackMove; state.selKey = ''; } else enter({ type: 'amove' }); });
          on('a-clear', () => select([]));
        }
      }
      if (list.length === 1) {
        const e = list[0], hp = $('hp1'), st = $('stat1');
        if (hp) hp.style.width = e.hp / e.max * 100 + '%';
        if (st) {
          let t = `${Math.ceil(e.hp)}/${e.max}`;
          if (e.d.cargo) t += ` · load ${Math.round(e.cargo)}/${Math.round(Rules.capOf(S(), e))}`;
          if (e.vet) t += ` · ${'★'.repeat(e.vet)}`;
          if (e.brk) t += ' · broken'; else if ((e.sup || 0) >= Rules.PIN) t += ' · pinned';
          if (e.b && e.d.power) t += ` · ${e.d.power > 0 ? '+' : ''}${e.d.power} pw`;
          if (e.held && e.team === team()) t += ' · general inside';
          if (st.textContent !== t) st.textContent = t;
        }
        const busy = e.up && box.querySelector('.ups .busy');
        if (busy) busy.style.setProperty('--p', (e.up.prog * 100).toFixed(1) + '%');
      }
    }

    const OBJECTIVES = [
      { done: p => p.counts.power || p.tech < Rules.POWER_AGE, text: 'Open <b>Base</b>, click <b>Power Plant</b>, wait for READY, click it again, then click inside your blue border.' },
      { done: p => p.counts.refinery, text: p => `Open <b>Base</b> and build a <b>${Rules.nameOf('refinery', p.tech)}</b> by the gold ore: click it, wait for READY, click again, then click inside your border. It brings a ${UNITS[Rules.formOf('truck', p.tech)].name.toLowerCase()} that mines by itself.` },
      { done: p => p.counts.barracks, text: p => `Build <b>Barracks</b>, then train <b>${UNITS[Rules.formOf('inf', p.tech)].name}</b> under the Men tab.` },
      { done: (p, S, t) => S.towns.some(n => n.owner === t), text: 'Select a squad and right-click a <b>town flag</b>. Towns pay out and push your border.' },
      { done: p => p.counts.factory, text: p => `Build <b>${Rules.nameOf('factory', p.tech)}</b> for horse and engines, and a <b>${Rules.nameOf('radar', p.tech)}</b> to see far.` },
      { done: (p, S) => p.tech > (S.age0 || 1) || p.tech >= Rules.MAX_AGE, text: p => `Advance to the <b>${Rules.AGES[Math.min(Rules.MAX_AGE, p.tech + 1)].name} Age</b> under Calls. Every unit you have takes its new form.` },
      { done: () => false, text: 'Destroy every enemy building.' },
    ];
    function updateObjective() {
      const o = $('objective'), p = P(), s = S();
      if (!game.showHints || !p) { o.hidden = true; return; }
      const next = OBJECTIVES.find(q => !q.done(p, s, team()));
      if (!next) { o.hidden = true; return; }
      const text = typeof next.text === 'function' ? next.text(p, s) : next.text;
      if (o.dataset.t !== text) { o.dataset.t = text; o.innerHTML = text; o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash'); }
      o.hidden = false;
    }

    function layoutMini() {
      const r = mini.getBoundingClientRect(), n = Math.round(r.width * Math.min(2, devicePixelRatio || 1));
      if (n > 0 && mini.width !== n) { mini.width = mini.height = n; }
    }

    // The make-up of the ore field under the pointer, each kind's share of what is left in it, in a note that follows
    // the pointer. Worked out again only when the field or what is left of it changes.
    const oreTip = document.createElement('div');
    oreTip.id = 'oretip'; oreTip.hidden = true; view.append(oreTip);
    let tipKey = '';
    function oreTipAt(px, py) {
      const s = S(), g = world.pick(px, py), c = g ? Rules.cellOf(g.x, g.y) : -1;
      let f = null, fd = 1e9;
      if (c >= 0 && s.ore[c] && s.P[team()].seen[c]) for (const q of s.map.oreFields) { const d = Math.hypot(g.x - q.x, g.y - q.y); if (d < q.r + 3 && d < fd) { fd = d; f = q; } }
      if (!f) { oreTip.hidden = true; tipKey = ''; return; }
      const key = f.x + ',' + f.y + ':' + s.oreVer;
      if (key !== tipKey) {
        tipKey = key;
        const left = Rules.ORE_KINDS.map(() => 0), W = s.map.W, R = f.r + 3;
        for (let y = Math.max(0, Math.floor(f.y - R)); y <= Math.min(s.map.H - 1, f.y + R); y++) for (let x = Math.max(0, Math.floor(f.x - R)); x <= Math.min(W - 1, f.x + R); x++) {
          const cc = y * W + x;
          if (s.ore[cc] && Math.hypot(x + 0.5 - f.x, y + 0.5 - f.y) < R) left[s.map.oreKind[cc]] += s.ore[cc];
        }
        const all = left.reduce((a, b) => a + b, 0) || 1;
        // Whole percents that add up to a hundred, the largest first.
        const shares = left.map((v, k) => ({ k, p: v / all * 100 })).filter(o => o.p > 0).sort((a, b) => b.p - a.p);
        const whole = shares.map(o => Math.floor(o.p)), short = 100 - whole.reduce((a, b) => a + b, 0);
        shares.map((o, i) => [o.p - whole[i], i]).sort((a, b) => b[0] - a[0]).slice(0, short).forEach(([, i]) => whole[i]++);
        oreTip.innerHTML = shares.map((o, i) => `<b class="k-${Rules.ORE_KINDS[o.k].key}">${Rules.ORE_KINDS[o.k].name}</b> ${whole[i]}%`).join(' &middot; ');
      }
      oreTip.style.left = (px + 12) + 'px'; oreTip.style.top = (py + 14) + 'px';
      oreTip.hidden = false;
    }
    // A town under the pointer, once seen: its name, who holds it, its houses, and what it pays a minute, or would
    // pay the player, by its size and what of it still stands. Shown in the ore's note, built of text nodes only, as
    // a side's name is a player's own and is never read as markup.
    function townTipAt(px, py) {
      const s = S(), g = world.pick(px, py), me = team();
      if (!g || !s.P[me]) return false;
      let t = null, td = 10;
      for (const q of s.towns) { const d = Math.hypot(g.x - q.x, g.y - q.y); if (d < td) { td = d; t = q; } }
      if (!t || !s.P[me].seen[Rules.cellOf(t.x, t.y)]) return false;
      const pay = Rules.townPay(s, t.id, me), ore = Math.round(pay.ore * 60), oil = Math.round(pay.oil * 60), ruins = pay.houses - pay.standing;
      const civic = !!s.P[me].counts.capitol, key = `town${t.id}:${t.owner}:${ore}:${oil}:${ruins}:${civic}:${pay.levied}`;
      if (key !== tipKey) {
        tipKey = key;
        const holder = t.owner < 0 ? 'held by no one' : t.owner === me ? 'yours' : `held by ${String((game.names && game.names[t.owner]) || `Side ${t.owner + 1}`)}`;
        const size = pay.houses ? `a ${pay.kind} of ${pay.houses} house${pay.houses === 1 ? '' : 's'}${ruins ? `, ${ruins} in ruins` : ''}` : 'no houses';
        const bold = text => { const b = document.createElement('b'); b.textContent = text; return b; };
        const dot = ' · ';
        // What raises or lowers the pay: the side's capitol, and a levy the town is still paying off.
        const why = [civic && 'a quarter more for your capitol', pay.levied && 'half while levied'].filter(Boolean).join(', ');
        oreTip.replaceChildren(bold(Rules.townName(s, t.id)), dot + holder + dot + size + dot + (t.owner === me ? 'pays ' : 'would pay you '), bold(`$${ore}`), ' and ', bold(`${oil} oil`), ' a minute' + (why ? ` (${why})` : ''));
      }
      oreTip.style.left = (px + 12) + 'px'; oreTip.style.top = (py + 14) + 'px';
      oreTip.hidden = false;
      return true;
    }

    return {
      state, pickTab, say, symbol, enter, leave, select, layoutMini, pop, strike,
      reset() {
        state.sel = []; state.groups = {}; state.mode = null; state.marks = []; state.alerts = []; state.lastAlert = null; state.selKey = null; state.fogC = null; ro = { sup: -1, oil: -1 }; state.townPick = -1;
        world.setGhost(null); showBanner(''); $('log').textContent = '';
        pickTab('bld');
      },
      alert(x, y) { state.alerts.push({ x, y, t: 0 }); state.lastAlert = { x, y }; },
      frame(dt) {
        if (game.S) { W = game.S.map.W; H = game.S.map.H; }
        if (game.playing) { scroll(dt); updateCams(); updateReadouts(); drawMini(dt); }
        const hover = game.playing && state.mouse.in && !state.drag ? entAt(state.mouse.x, state.mouse.y) : null;
        state.hover = hover;
        const gh = world.ghostState;
        if (game.playing && state.mouse.in && !state.drag && !hover && !state.mode) { if (!townTipAt(state.mouse.x, state.mouse.y)) oreTipAt(state.mouse.x, state.mouse.y); }
        else if (game.playing && state.mouse.in && state.mode && state.mode.type === 'place' && gh && (!gh.ok || gh.power)) {
          // Why the building being placed cannot stand where it is, and whether it would leave power short.
          const text = [gh.ok ? '' : gh.why, gh.power].filter(Boolean).join(' \u00b7 ');
          if (tipKey !== 'why:' + text) { tipKey = 'why:' + text; oreTip.textContent = text; }
          oreTip.style.left = (state.mouse.x + 12) + 'px'; oreTip.style.top = (state.mouse.y + 14) + 'px'; oreTip.hidden = false;
        } else if (!oreTip.hidden) { oreTip.hidden = true; tipKey = ''; }
        if (game.playing) {
          const m = state.mode, en = hover && hover.team !== team(), mine = state.sel.some(e => !e.b && e.team === team());
          view.dataset.cur = m ? (m.type === 'place' ? 'place' : 'aim') : en && mine ? 'attack' : mine ? 'order' : hover ? 'pick' : '';
        }
        drawOverlay(dt);
      },
      setCameos(c) { state.cameos = c; buildCams(); },
      // The control groups as unit ids, for a saved game, and back.
      groupIds() { const o = {}; for (const n in state.groups) o[n] = state.groups[n].map(e => e.id); return o; },
      setGroups(g) { state.groups = {}; for (const n in g || {}) state.groups[n] = g[n].map(id => game.S.byId.get(id)).filter(Boolean); },
    };
  }

  return { create, symbol };
})();
