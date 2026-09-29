'use strict';
/* Tribelands — rules, map generation and the computer tribes.
   Everything the game knows lives in S, a plain object that goes straight to
   JSON: that is the autosave, and a copy of it is what Undo steps back to.   */

const VERSION = 'v23';
const SAVE_KEY = 'tribelands-save-v1';
const PREF_KEY = 'tribelands-prefs-v1';

const FIELD = 0, FOREST = 1, MOUNTAIN = 2, SHALLOW = 3, OCEAN = 4;
const TERRAIN_NAME = ['Field', 'Forest', 'Mountain', 'Shallow water', 'Ocean'];
const isWater = t => t === SHALLOW || t === OCEAN;

const TRIBES = [
  { name: 'Aurel', color: '#E7B23A', skin: '#F2D0AE', tech: 'organization', start: 'warrior', hat: 'plume',
    blurb: 'Orchard folk of the golden meadows. Start with Organization, so fruit can be gathered from turn one.',
    land: { forest: .24, mountain: .14 }, res: { fruit: .34, crop: .22, animal: .38, ore: .35 },
    pal: { field: '#A9C95B', forest: '#5C9B3F', mountain: '#A4A79F', tree: 'round', snow: true },
    syl: ['au', 'rel', 'lo', 'ria', 'ven', 'ta', 'mer', 'ol', 'ca', 'sa', 'tri', 'no', 'ae', 'lis'] },
  { name: 'Kiro', color: '#D9473A', skin: '#EBC39B', tech: 'climbing', start: 'warrior', hat: 'cone',
    blurb: 'Highland builders among the peaks. Start with Climbing: cross mountains and defend them well.',
    land: { forest: .2, mountain: .36 }, res: { fruit: .28, crop: .18, animal: .32, ore: .6 },
    pal: { field: '#8FC580', forest: '#3F8F6C', mountain: '#BBA99F', tree: 'bamboo', snow: true },
    syl: ['ki', 'ro', 'shi', 'ta', 'ka', 'mo', 'ren', 'yu', 'ha', 'zen', 'to', 'mi', 'sa', 'no'] },
  { name: 'Thane', color: '#3C7ED3', skin: '#F6DCC8', tech: 'hunting', start: 'warrior', hat: 'horns',
    blurb: 'Hunters of the deep pine forests. Start with Hunting, so wild animals are food from turn one.',
    land: { forest: .48, mountain: .15 }, res: { fruit: .22, crop: .15, animal: .52, ore: .35 },
    pal: { field: '#80B06B', forest: '#2F6D4C', mountain: '#8F98A9', tree: 'pine', snow: true },
    syl: ['thor', 'ga', 'hel', 'vik', 'run', 'sten', 'ul', 'fa', 'bjor', 'nar', 'dal', 'ey', 'grim', 'ska'] },
  { name: 'Sandari', color: '#9A5ACF', skin: '#C8915E', tech: 'riding', start: 'rider', hat: 'wrap',
    blurb: 'Riders of the open savanna. Start with Riding, and with a Rider instead of a Warrior.',
    land: { forest: .14, mountain: .13 }, res: { fruit: .3, crop: .3, animal: .38, ore: .3 },
    pal: { field: '#D5BF77', forest: '#8BA54C', mountain: '#BD9E75', tree: 'acacia', snow: false },
    syl: ['sa', 'han', 'ka', 'du', 'ri', 'ma', 'zi', 'ba', 'nu', 'ta', 'ol', 'ke', 'mar', 'ish'] },
];

const TECHS = {
  riding:       { name: 'Riding',       tier: 1, parent: null,           desc: 'Train Riders: they move two tiles and can move again after attacking.' },
  shields:      { name: 'Shields',      tier: 2, parent: 'riding',       desc: 'Train Defenders: 15 HP and defence 3, for holding cities.' },
  chivalry:     { name: 'Chivalry',     tier: 3, parent: 'shields',      desc: 'Train Knights: they move three tiles, and after a kill they may attack again.' },
  organization: { name: 'Organization', tier: 1, parent: null,           desc: 'Gather fruit: +1 population for 2 ★.' },
  farming:      { name: 'Farming',      tier: 2, parent: 'organization', desc: 'Build farms on crops: +2 population for 5 ★.' },
  mathematics:  { name: 'Mathematics',  tier: 3, parent: 'farming',      desc: 'Train Catapults: attack 4 from three tiles away, but fragile.' },
  climbing:     { name: 'Climbing',     tier: 1, parent: null,           desc: 'Move onto mountains. Units on mountains defend 50% better.' },
  mining:       { name: 'Mining',       tier: 2, parent: 'climbing',     desc: 'Build mines on ore: +2 population for 5 ★.' },
  smithery:     { name: 'Smithery',     tier: 3, parent: 'mining',       desc: 'Train Swordsmen: attack 3, defence 3, 15 HP.' },
  hunting:      { name: 'Hunting',      tier: 1, parent: null,           desc: 'Hunt wild animals: +1 population for 2 ★.' },
  archery:      { name: 'Archery',      tier: 2, parent: 'hunting',      desc: 'Train Archers, which shoot two tiles. Units in forests defend 50% better.' },
  forestry:     { name: 'Forestry',     tier: 2, parent: 'hunting',      desc: 'Build lumber huts (+1 population for 3 ★) and clear forest for +1 ★.' },
  fishing:      { name: 'Fishing',      tier: 1, parent: null,           desc: 'Catch fish (+1 population for 2 ★) and build ports. A unit that enters a port becomes a boat.' },
  sailing:      { name: 'Sailing',      tier: 2, parent: 'fishing',      desc: 'Boats can cross the deep ocean.' },
  navigation:   { name: 'Navigation',   tier: 3, parent: 'sailing',      desc: 'Boats become Warships: attack 3, defence 2, move 3.' },
};
const TECH_ROOTS = ['riding', 'organization', 'climbing', 'hunting', 'fishing'];

const UNITS = {
  warrior:   { name: 'Warrior',   cost: 2, hp: 10, atk: 2,   def: 2, mv: 1, rng: 1, tech: null,          dash: 1 },
  rider:     { name: 'Rider',     cost: 3, hp: 10, atk: 2,   def: 1, mv: 2, rng: 1, tech: 'riding',      dash: 1, escape: 1 },
  archer:    { name: 'Archer',    cost: 3, hp: 10, atk: 2,   def: 1, mv: 1, rng: 2, tech: 'archery',     dash: 1 },
  defender:  { name: 'Defender',  cost: 3, hp: 15, atk: 1,   def: 3, mv: 1, rng: 1, tech: 'shields' },
  swordsman: { name: 'Swordsman', cost: 5, hp: 15, atk: 3,   def: 3, mv: 1, rng: 1, tech: 'smithery',    dash: 1 },
  catapult:  { name: 'Catapult',  cost: 8, hp: 10, atk: 4,   def: 0, mv: 1, rng: 3, tech: 'mathematics' },
  knight:    { name: 'Knight',    cost: 8, hp: 10, atk: 3.5, def: 1, mv: 3, rng: 1, tech: 'chivalry',    dash: 1, persist: 1 },
  giant:     { name: 'Giant',     cost: 0, hp: 40, atk: 5,   def: 4, mv: 1, rng: 1, tech: '-',           dash: 1 },
};
const TRAINABLE = ['warrior', 'rider', 'archer', 'defender', 'swordsman', 'catapult', 'knight'];
const BOATS = {
  boat:    { name: 'Boat',    atk: 1, def: 1, mv: 2, rng: 2, dash: 1 },
  warship: { name: 'Warship', atk: 3, def: 2, mv: 3, rng: 2, dash: 1 },
};

// Work you can do on a tile inside your borders. No unit needed, only stars.
const WORKS = {
  fruit:  { name: 'Gather fruit', tech: 'organization', cost: 2, pop: 1, ok: t => t.res === 'fruit' },
  animal: { name: 'Hunt',         tech: 'hunting',      cost: 2, pop: 1, ok: t => t.res === 'animal' },
  fish:   { name: 'Fish',         tech: 'fishing',      cost: 2, pop: 1, ok: t => t.res === 'fish' },
  farm:   { name: 'Farm',         tech: 'farming',      cost: 5, pop: 2, ok: t => t.res === 'crop' },
  mine:   { name: 'Mine',         tech: 'mining',       cost: 5, pop: 2, ok: t => t.res === 'ore' },
  lumber: { name: 'Lumber hut',   tech: 'forestry',     cost: 3, pop: 1, ok: t => t.t === FOREST && !t.res && !t.imp },
  clear:  { name: 'Clear forest', tech: 'forestry',     cost: 0, pop: 0, gain: 1, ok: t => t.t === FOREST && !t.imp },
  port:   { name: 'Port',         tech: 'fishing',      cost: 7, pop: 1, ok: t => t.t === SHALLOW && !t.imp && !t.res },
};
const RES_NAME = { fruit: 'Fruit', crop: 'Crop', animal: 'Wild animal', fish: 'Fish', ore: 'Ore' };
const IMP_NAME = { farm: 'Farm', mine: 'Mine', lumber: 'Lumber hut', port: 'Port' };

const REWARDS = {
  workshop:  { name: 'Workshop',          desc: '+1 ★ every turn.' },
  explorer:  { name: 'Explorer',          desc: 'Scouts out and reveals a long stretch of the map.' },
  walls:     { name: 'City wall',         desc: 'Units in this city defend four times as well.' },
  resources: { name: 'Resources',         desc: '+5 ★ right now.' },
  popgrowth: { name: 'Population growth', desc: '+3 population, which may level the city again.' },
  border:    { name: 'Border growth',     desc: 'Territory grows from 3×3 to 5×5.' },
  giant:     { name: 'Giant',             desc: 'A super unit: 40 HP, attack 5, defence 4.' },
  park:      { name: 'Park',              desc: '+1 ★ every turn, and a lovely place to be.' },
};
function rewardChoices(level) {
  if (level === 2) return ['workshop', 'explorer'];
  if (level === 3) return ['walls', 'resources'];
  if (level === 4) return ['popgrowth', 'border'];
  return ['giant', 'park'];
}

// ---------- small helpers ----------
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function hash(x, y, k = 0) {
  let h = Math.imul(x + 1013, 374761393) ^ Math.imul(y + 7, 668265263) ^ Math.imul(k + 3, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

let S = null;                        // the game
const I = (x, y) => y * S.n + x;
const XY = i => [i % S.n, (i / S.n) | 0];
const inb = (x, y) => x >= 0 && y >= 0 && x < S.n && y < S.n;
const tileAt = (x, y) => S.tiles[I(x, y)];
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
function nbrs(x, y) {
  const r = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (inb(nx, ny)) r.push([nx, ny]);
  }
  return r;
}
function unitAt(x, y) { for (const u of S.units) if (u.x === x && u.y === y) return u; return null; }
function unitById(id) { for (const u of S.units) if (u.id === id) return u; return null; }
function cityAtI(i) { const c = S.tiles[i].cityHere; return c >= 0 ? S.cities[c] : null; }
function ownerOfI(i) { const c = S.tiles[i].city; return c >= 0 ? S.cities[c].owner : -1; }
const has = (p, t) => !!S.players[p].techs[t];
const tribeOf = p => TRIBES[S.players[p].tribe];
const citiesOf = p => S.cities.filter(c => c.owner === p);
const unitsOf = p => S.units.filter(u => u.owner === p);
const isHuman = p => S.players[p].human;

function st(u) { return u.boat ? BOATS[u.boat] : UNITS[u.type]; }
function maxHp(u) { return UNITS[u.type].hp + (u.vet ? 5 : 0); }
function unitName(u) { return u.boat ? BOATS[u.boat].name + ' (' + UNITS[u.type].name + ')' : UNITS[u.type].name; }

function techCost(p, t) { return TECHS[t].tier * Math.max(1, citiesOf(p).length) + 4; }
function canResearch(p, t) {
  const T = TECHS[t];
  return !has(p, t) && (!T.parent || has(p, T.parent)) && S.players[p].stars >= techCost(p, t);
}
function income(p) {
  let s = 0;
  for (const c of S.cities) if (c.owner === p) s += c.level + (c.workshop ? 1 : 0) + c.parks + (c.capital ? 1 : 0);
  if (!isHuman(p) && S.diff === 'hard') s += 2;
  return s;
}
function homeCount(c) { let k = 0; for (const u of S.units) if (u.home === c.id) k++; return k; }
function capacity(c) { return c.level + 1; }

// ---------- vision (only the human player has fog) ----------
let revealed = 0;                    // tiles newly revealed since the last reset — an undo barrier
function reveal(x, y, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!inb(nx, ny)) continue;
    const i = I(nx, ny);
    if (!S.explored[i]) { S.explored[i] = 1; revealed++; }
  }
}
function vision() {
  for (const u of S.units) if (isHuman(u.owner)) reveal(u.x, u.y, tileAt(u.x, u.y).t === MOUNTAIN ? 2 : 1);
  for (const c of S.cities) if (c.owner >= 0 && isHuman(c.owner)) reveal(c.x, c.y, c.radius + 1);
}
const seen = i => S.explored[i] === 1;

// ---------- map generation ----------
function cityName(tribe) {
  const syl = TRIBES[tribe].syl;
  for (let k = 0; k < 40; k++) {
    let s = pick(syl) + pick(syl);
    if (Math.random() < .3) s += pick(syl);
    s = s[0].toUpperCase() + s.slice(1);
    if (s.length <= 10 && !S.cities.some(c => c.name === s)) return s;
  }
  return 'Town ' + (S.cities.length + 1);
}

function newGame(opts) {
  const n = { small: 11, medium: 14, large: 18 }[opts.size] || 14;
  const tribes = [opts.tribe, ...shuffle([0, 1, 2, 3].filter(t => t !== opts.tribe)).slice(0, opts.opponents)];
  S = {
    v: 1, n, turn: 1, cur: 0, diff: opts.diff, size: opts.size, over: null, nextId: 1,
    players: tribes.map((t, i) => ({ id: i, tribe: t, human: i === 0, stars: 5 + (i && opts.diff === 'hard' ? 3 : 0),
      techs: { [TRIBES[t].tech]: true }, alive: true, kills: 0, lost: 0 })),
    tiles: [], cities: [], units: [], explored: new Array(n * n).fill(0), pendingRewards: [],
  };
  genMap(tribes);
  revealed = 0;
  vision();
  return S;
}

function placeCapitals(n, k) {
  const m = n <= 11 ? 2 : 3;
  const spots = shuffle([[m, m], [n - 1 - m, n - 1 - m], [n - 1 - m, m], [m, n - 1 - m]]);
  // two players sit on opposite corners, not neighbouring ones
  if (k === 2) {
    const a = spots[0];
    const b = spots.find(s => s[0] !== a[0] && s[1] !== a[1]);
    spots.splice(0, 4, a, b);
  }
  return spots.slice(0, k).map(([x, y]) => [clamp(x + rnd(3) - 1, 1, n - 2), clamp(y + rnd(3) - 1, 1, n - 2)]);
}

function genMap(tribes) {
  const n = S.n, N = n * n;
  const caps = placeCapitals(n, tribes.length);
  // smooth value noise for the coastline
  const G = 3, gw = Math.ceil(n / G) + 2, g = Array.from({ length: gw * gw }, () => Math.random());
  const sm = t => t * t * (3 - 2 * t);
  const vn = (x, y) => {
    const fx = x / G, fy = y / G, x0 = Math.floor(fx), y0 = Math.floor(fy), u = sm(fx - x0), v = sm(fy - y0);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const land = new Array(N).fill(false), clim = new Array(N).fill(0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let best = 0, bd = 1e9;
    caps.forEach(([cx, cy], k) => { const d = (cx - x) ** 2 + (cy - y) ** 2 + Math.random() * 3; if (d < bd) { bd = d; best = k; } });
    clim[I(x, y)] = tribes[best];
    const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
    const h = vn(x, y) * .72 + Math.random() * .28 + (edge < 1 ? -.32 : edge < 2 ? -.1 : 0) + Math.min(.12, bd < 9 ? .12 : 0);
    land[I(x, y)] = h > .44;
  }
  for (const [cx, cy] of caps) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = cx + dx, y = cy + dy;
    if (inb(x, y) && (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 || Math.random() < .6)) land[I(x, y)] = true;
  }
  // every capital must be reachable on foot from every other
  const comp = () => {
    const c = new Array(N).fill(-1); let id = 0;
    for (let s = 0; s < N; s++) {
      if (!land[s] || c[s] >= 0) continue;
      const q = [s]; c[s] = id;
      for (let h = 0; h < q.length; h++) {
        const [x, y] = XY(q[h]);
        for (const [nx, ny] of nbrs(x, y)) { const j = I(nx, ny); if (land[j] && c[j] < 0) { c[j] = id; q.push(j); } }
      }
      id++;
    }
    return c;
  };
  for (let k = 1; k < caps.length; k++) {
    let c = comp();
    const target = c[I(...caps[0])];
    let [x, y] = caps[k];
    let guard = 0;
    while (c[I(x, y)] !== target && guard++ < 200) {
      const [tx, ty] = caps[0];
      if (Math.random() < .75) { x += Math.sign(tx - x); y += Math.sign(ty - y); }
      else { x = clamp(x + rnd(3) - 1, 1, n - 2); y = clamp(y + rnd(3) - 1, 1, n - 2); }
      if (!land[I(x, y)]) { land[I(x, y)] = true; c = comp(); }
    }
  }
  for (let i = 0; i < N; i++) {
    const [x, y] = XY(i);
    const T = TRIBES[clim[i]];
    let t;
    if (land[i]) {
      const r = Math.random();
      t = r < T.land.mountain ? MOUNTAIN : r < T.land.mountain + T.land.forest ? FOREST : FIELD;
    } else {
      t = nbrs(x, y).some(([nx, ny]) => land[I(nx, ny)]) ? SHALLOW : OCEAN;
    }
    S.tiles.push({ t, clim: clim[i], res: null, imp: null, city: -1, cityHere: -1, ruin: false });
  }
  // capitals
  caps.forEach(([x, y], p) => {
    const t = tileAt(x, y); t.t = FIELD;
    const c = addCity(x, y, p, true);
    const tribe = tribes[p];
    // a fair start: something to eat next to every capital
    const around = shuffle(nbrs(x, y).filter(([nx, ny]) => !isWater(tileAt(nx, ny).t)));
    const want = tribe === 2 ? ['animal', 'animal', 'fruit'] : tribe === 0 ? ['fruit', 'fruit', 'animal'] : tribe === 1 ? ['fruit', 'animal', 'ore'] : ['fruit', 'animal', 'crop'];
    want.forEach((r, k) => {
      const a = around[k]; if (!a) return;
      const tt = tileAt(a[0], a[1]);
      tt.t = r === 'animal' ? FOREST : r === 'ore' ? MOUNTAIN : FIELD;
      tt.res = r;
    });
    const u = addUnit(TRIBES[tribe].start, p, x, y, c.id);
    u.moved = u.attacked = false;
  });
  // villages
  const cand = shuffle([...Array(N).keys()].filter(i => {
    const t = S.tiles[i]; if (isWater(t.t) || t.t === MOUNTAIN) return false;
    const [x, y] = XY(i); return x > 0 && y > 0 && x < n - 1 && y < n - 1;
  }));
  const target = Math.round(N / 15);
  let made = 0;
  for (const i of cand) {
    if (made >= target) break;
    const [x, y] = XY(i);
    if (S.cities.some(c => cheb(c.x, c.y, x, y) < 3)) continue;
    S.tiles[i].t = FIELD; S.tiles[i].res = null;
    addCity(x, y, -1, false); made++;
  }
  // resources
  for (let i = 0; i < N; i++) {
    const t = S.tiles[i]; if (t.cityHere >= 0 || t.res) continue;
    const [x, y] = XY(i);
    const near = S.cities.some(c => cheb(c.x, c.y, x, y) <= 2) ? 1 : .45;
    const R = TRIBES[t.clim].res, r = Math.random() / near;
    if (t.t === FIELD) t.res = r < R.fruit ? 'fruit' : r < R.fruit + R.crop ? 'crop' : null;
    else if (t.t === FOREST) t.res = r < R.animal ? 'animal' : null;
    else if (t.t === MOUNTAIN) t.res = r < R.ore ? 'ore' : null;
    else if (t.t === SHALLOW) t.res = r < .3 ? 'fish' : null;
  }
  // ruins
  const rc = Math.max(2, Math.round(N / 45));
  let rm = 0;
  for (const i of shuffle([...Array(N).keys()])) {
    if (rm >= rc) break;
    const t = S.tiles[i], [x, y] = XY(i);
    if (t.cityHere >= 0 || t.t === SHALLOW) continue;
    if (S.cities.some(c => cheb(c.x, c.y, x, y) < (c.owner >= 0 ? 3 : 1))) continue;
    t.ruin = true; t.res = null; rm++;
  }
}

function addCity(x, y, owner, capital) {
  const i = I(x, y);
  const tribe = owner >= 0 ? S.players[owner].tribe : S.tiles[i].clim;
  const c = { id: S.cities.length, x, y, owner, level: owner >= 0 ? 1 : 0, pop: 0, name: cityName(tribe),
    capital, walls: false, workshop: false, parks: 0, radius: 1 };
  S.cities.push(c);
  S.tiles[i].cityHere = c.id;
  S.tiles[i].res = null; S.tiles[i].imp = null; S.tiles[i].ruin = false;
  if (owner >= 0) claim(c);
  return c;
}
function claim(c) {
  for (let dy = -c.radius; dy <= c.radius; dy++) for (let dx = -c.radius; dx <= c.radius; dx++) {
    const x = c.x + dx, y = c.y + dy;
    if (!inb(x, y)) continue;
    const t = tileAt(x, y);
    if (t.city === -1 && (t.cityHere === -1 || t.cityHere === c.id)) t.city = c.id;
  }
}
function addUnit(type, owner, x, y, home) {
  const u = { id: S.nextId++, type, owner, x, y, hp: UNITS[type].hp, moved: true, attacked: true,
    home: home == null ? -1 : home, boat: null, kills: 0, vet: false };
  S.units.push(u);
  return u;
}

// ---------- movement ----------
// One step from (fx,fy) into (x,y): null if it cannot be done, else whether it ends the move.
function step(u, x, y) {
  const p = u.owner, i = I(x, y), t = S.tiles[i];
  if (isHuman(p) && !seen(i)) return null;
  if (u.boat) {
    if (isWater(t.t)) return t.t === OCEAN && !has(p, 'sailing') ? null : { end: false };
    if (t.t === MOUNTAIN && !has(p, 'climbing')) return null;
    return { end: true };                                // landing ends the turn
  }
  if (isWater(t.t)) return t.imp === 'port' && ownerOfI(i) === p ? { end: true } : null;
  if (t.t === MOUNTAIN) return has(p, 'climbing') ? { end: true } : null;
  if (t.t === FOREST) return { end: true };
  return { end: false };
}
function enemyNear(x, y, p, r = 1) {
  for (const e of S.units) {
    if (e.owner === p || cheb(x, y, e.x, e.y) > r) continue;
    if (isHuman(p) && !seen(I(e.x, e.y))) continue;
    return true;
  }
  return false;
}
function moveInfo(u) {
  const dests = new Set(), prev = new Map(), best = new Map();
  if (u.moved) return { dests, prev };
  const start = I(u.x, u.y);
  best.set(start, st(u).mv);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], r = best.get(cur);
    if (r <= 0) continue;
    const [cx, cy] = XY(cur);
    for (const [nx, ny] of nbrs(cx, cy)) {
      const ni = I(nx, ny);
      if (ni === start) continue;
      const s = step(u, nx, ny);
      if (!s) continue;
      const occ = unitAt(nx, ny);
      if (occ && occ.owner !== u.owner) continue;
      let nr = s.end ? 0 : r - 1;
      if (nr > 0 && enemyNear(nx, ny, u.owner)) nr = 0;       // zone of control
      if (best.has(ni) && best.get(ni) >= nr) continue;
      best.set(ni, nr); prev.set(ni, cur); q.push(ni);
      if (!occ) dests.add(ni);
    }
  }
  return { dests, prev };
}
function pathTo(u, prev, dest) {
  const path = [dest], start = I(u.x, u.y);
  let k = dest;
  while (prev.has(k) && prev.get(k) !== start) { k = prev.get(k); path.unshift(k); }
  return path;
}

// ---------- combat ----------
function defBonus(u) {
  const i = I(u.x, u.y), t = S.tiles[i], c = cityAtI(i);
  if (c && c.owner === u.owner) return c.walls ? 4 : 1.5;
  if (u.boat) return 1;
  if (t.t === FOREST && has(u.owner, 'archery')) return 1.5;
  if (t.t === MOUNTAIN && has(u.owner, 'climbing')) return 1.5;
  return 1;
}
function combat(a, d) {
  const sa = st(a), sd = st(d);
  const aF = sa.atk * a.hp / maxHp(a);
  const dF = sd.def * d.hp / maxHp(d) * defBonus(d);
  const tot = aF + dF;
  const dmg = Math.round(aF / tot * sa.atk * 4.5);
  const killed = dmg >= d.hp;
  const inRange = cheb(a.x, a.y, d.x, d.y) <= sd.rng;
  const ret = killed || !inRange ? 0 : Math.round(dF / tot * sd.def * 4.5);
  return { dmg, ret, killed };
}
function targets(u) {
  if (u.attacked) return [];
  const s = st(u);
  if (u.moved && !s.dash) return [];
  return S.units.filter(e => e.owner !== u.owner && cheb(u.x, u.y, e.x, e.y) <= s.rng && (!isHuman(u.owner) || seen(I(e.x, e.y))));
}
function exhausted(u) {
  if (u.attacked) return u.moved;
  return u.moved && !st(u).dash;
}

// ---------- actions (shared by the player and the computer) ----------
// Hooks the UI fills in to animate and announce. Defaults do nothing.
const FX = {
  move: async () => { }, attack: async () => { }, float: () => { }, say: () => { }, pause: async () => { },
};

async function doMove(u, dest, prev) {
  const path = pathTo(u, prev, dest);
  await FX.move(u, path);
  const [x, y] = XY(dest);
  u.x = x; u.y = y; u.moved = true;
  const t = S.tiles[dest];
  if (!u.boat && isWater(t.t)) { u.boat = has(u.owner, 'navigation') ? 'warship' : 'boat'; u.attacked = true; }
  else if (u.boat && !isWater(t.t)) { u.boat = null; u.attacked = true; }
  if (isHuman(u.owner)) vision();
}

async function doAttack(a, d) {
  const r = combat(a, d);
  await FX.attack(a, d, r);
  d.hp -= r.dmg;
  FX.float(d.x, d.y, '−' + r.dmg, '#ff5a4e');
  const sa = st(a);
  if (d.hp <= 0) {
    killUnit(d, a.owner);
    a.kills++;
    if (a.kills >= 3 && !a.vet) { a.vet = true; a.hp = maxHp(a); FX.float(a.x, a.y, 'Veteran!', '#ffd24a'); }
    if (sa.rng === 1 && !unitAt(d.x, d.y)) {
      const s = step(a, d.x, d.y);
      const t = tileAt(d.x, d.y);
      if (s && !(!a.boat && isWater(t.t))) {
        await FX.move(a, [I(d.x, d.y)]);
        a.x = d.x; a.y = d.y;
        if (a.boat && !isWater(t.t)) a.boat = null;
        if (isHuman(a.owner)) vision();
      }
    }
  } else if (r.ret > 0) {
    a.hp -= r.ret;
    FX.float(a.x, a.y, '−' + r.ret, '#ff5a4e');
    if (a.hp <= 0) killUnit(a, d.owner);
  }
  a.attacked = true;
  if (!sa.escape) a.moved = true;
  if (sa.persist && r.killed && a.hp > 0) a.attacked = false;
  return r;
}
function killUnit(u, by) {
  const k = S.units.indexOf(u);
  if (k >= 0) S.units.splice(k, 1);
  S.players[u.owner].lost++;
  if (by != null && by >= 0) S.players[by].kills++;
}

function canCapture(u) {
  if (u.moved || u.attacked || u.boat) return false;
  const c = cityAtI(I(u.x, u.y));
  return !!c && c.owner !== u.owner;
}
function doCapture(u) {
  const c = cityAtI(I(u.x, u.y));
  const old = c.owner;
  c.owner = u.owner;
  if (old < 0) { c.level = 1; c.pop = 0; FX.say(`${tribeOf(u.owner).name} founded ${c.name}`, u.owner, c); }
  else {
    c.capital = false;
    for (const v of S.units) if (v.home === c.id && v.owner !== u.owner) v.home = -1;
    FX.say(`${tribeOf(u.owner).name} captured ${c.name}!`, u.owner, c);
  }
  claim(c);
  u.moved = u.attacked = true;
  if (u.home < 0 || !S.cities[u.home] || S.cities[u.home].owner !== u.owner) u.home = c.id;
  if (isHuman(u.owner)) vision();
  checkElims();
}
function canRuin(u) { return !u.attacked && tileAt(u.x, u.y).ruin; }
function doRuin(u) {
  const t = tileAt(u.x, u.y), p = u.owner, P = S.players[p];
  t.ruin = false;
  u.moved = u.attacked = true;
  const opts = ['stars', 'tech', 'unit', 'pop'];
  if (isHuman(p)) opts.push('map');
  const kind = pick(opts);
  const avail = Object.keys(TECHS).filter(k => !has(p, k) && (!TECHS[k].parent || has(p, TECHS[k].parent)));
  if (kind === 'tech' && avail.length) {
    const k = avail.sort((a, b) => TECHS[a].tier - TECHS[b].tier)[0];
    P.techs[k] = true; FX.float(u.x, u.y, TECHS[k].name + '!', '#9fd8ff');
    return 'The ruins held knowledge: you learned ' + TECHS[k].name + '.';
  }
  if (kind === 'unit') {
    const spot = freeLandNear(u.x, u.y, p);
    if (spot) {
      addUnit('swordsman', p, spot[0], spot[1], -1);
      if (isHuman(p)) vision();
      return 'A Swordsman in the ruins has joined your tribe.';
    }
  }
  if (kind === 'map') {
    reveal(u.x, u.y, 4);
    return 'An old map in the ruins shows the lands around.';
  }
  if (kind === 'pop') {
    const c = citiesOf(p).sort((a, b) => cheb(a.x, a.y, u.x, u.y) - cheb(b.x, b.y, u.x, u.y))[0];
    if (c) { addPop(c, 3); return 'Wanderers from the ruins settled in ' + c.name + ' (+3 population).'; }
  }
  P.stars += 10; FX.float(u.x, u.y, '+10 ★', '#ffd24a');
  return 'The ruins held treasure: +10 ★.';
}
function freeLandNear(x, y, p) {
  const opts = [[x, y], ...shuffle(nbrs(x, y))];
  for (const [nx, ny] of opts) {
    const t = tileAt(nx, ny);
    if (isWater(t.t) || unitAt(nx, ny)) continue;
    if (t.t === MOUNTAIN && !has(p, 'climbing')) continue;
    return [nx, ny];
  }
  return null;
}
function canRecover(u) { return !u.moved && !u.attacked && u.hp < maxHp(u); }
function doRecover(u) {
  const own = ownerOfI(I(u.x, u.y)) === u.owner;
  const gain = Math.min(maxHp(u) - u.hp, own ? 4 : 2);
  u.hp += gain;
  u.moved = u.attacked = true;
  FX.float(u.x, u.y, '+' + gain, '#6fe08f');
}
function canTrain(p, c, type) {
  const U = UNITS[type];
  if (c.owner !== p || unitAt(c.x, c.y)) return false;
  if (U.tech && !has(p, U.tech)) return false;
  return homeCount(c) < capacity(c) && S.players[p].stars >= U.cost;
}
function doTrain(p, c, type) {
  S.players[p].stars -= UNITS[type].cost;
  return addUnit(type, p, c.x, c.y, c.id);
}
function doResearch(p, t) {
  S.players[p].stars -= techCost(p, t);
  S.players[p].techs[t] = true;
  // boats already at sea are refitted the moment Navigation is known
  if (t === 'navigation') for (const u of S.units) if (u.owner === p && u.boat) u.boat = 'warship';
}
function canWork(p, i, key) {
  const t = S.tiles[i], W = WORKS[key];
  if (ownerOfI(i) !== p || t.cityHere >= 0 || !W.ok(t) || !has(p, W.tech)) return false;
  const e = unitAt(...XY(i));
  if (e && e.owner !== p) return false;
  return S.players[p].stars >= W.cost;
}
function doWork(p, i, key) {
  const t = S.tiles[i], W = WORKS[key], P = S.players[p];
  P.stars -= W.cost;
  if (key === 'fruit' || key === 'animal' || key === 'fish') t.res = null;
  else if (key === 'farm' || key === 'mine') { t.res = null; t.imp = key; }
  else if (key === 'lumber' || key === 'port') t.imp = key;
  else if (key === 'clear') { t.t = FIELD; t.res = null; P.stars += W.gain; }
  const [x, y] = XY(i);
  if (W.pop) { FX.float(x, y, '+' + W.pop + ' pop', '#bff38a'); addPop(S.cities[t.city], W.pop); }
  if (W.gain) FX.float(x, y, '+' + W.gain + ' ★', '#ffd24a');
}
function addPop(c, k) {
  c.pop += k;
  while (c.pop >= c.level + 1) {
    c.pop -= c.level + 1;
    c.level++;
    if (isHuman(c.owner)) S.pendingRewards.push(c.id);
    else aiReward(c);
  }
}
function applyReward(c, key) {
  const P = S.players[c.owner];
  if (key === 'workshop') c.workshop = true;
  else if (key === 'walls') c.walls = true;
  else if (key === 'resources') P.stars += 5;
  else if (key === 'popgrowth') addPop(c, 3);
  else if (key === 'border') { c.radius = 2; claim(c); if (isHuman(c.owner)) vision(); }
  else if (key === 'park') c.parks++;
  else if (key === 'giant') {
    const spot = freeLandNear(c.x, c.y, c.owner);
    if (spot) addUnit('giant', c.owner, spot[0], spot[1], c.id); else P.stars += 5;
  } else if (key === 'explorer') {
    let x = c.x, y = c.y;
    for (let k = 0; k < 22; k++) {
      const opts = nbrs(x, y);
      const fresh = opts.filter(([nx, ny]) => !seen(I(nx, ny)));
      [x, y] = fresh.length && Math.random() < .8 ? pick(fresh) : pick(opts);
      reveal(x, y, 1);
    }
  }
}

function startTurn(p) {
  const P = S.players[p];
  if (S.turn > 1) P.stars += income(p);          // nobody earns on the first turn
  for (const u of S.units) if (u.owner === p) { u.moved = false; u.attacked = false; }
}
function checkElims() {
  for (const P of S.players) {
    if (!P.alive) continue;
    if (!S.cities.some(c => c.owner === P.id)) {
      P.alive = false;
      S.units = S.units.filter(u => u.owner !== P.id);
      FX.say(`The ${TRIBES[P.tribe].name} tribe has fallen.`, P.id);
    }
  }
  if (!S.players[0].alive) S.over = 'lose';
  else if (S.players.every(P => P.human || !P.alive)) S.over = 'win';
}

// ---------- the computer tribes ----------
function aiReward(c) {
  const lv = c.level;
  const key = lv === 2 ? 'workshop' : lv === 3 ? (enemyNear(c.x, c.y, c.owner, 4) ? 'walls' : 'resources')
    : lv === 4 ? 'popgrowth' : 'giant';
  applyReward(c, key);
}

// Every tile a computer unit could want to reach, by breadth-first flood over land.
function goalField(p, goals) {
  const N = S.n * S.n, dist = new Array(N).fill(1e9), src = new Array(N).fill(-1), q = [];
  for (const g of goals) if (dist[g] > 0) { dist[g] = 0; src[g] = g; q.push(g); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], [x, y] = XY(i);
    for (const [nx, ny] of nbrs(x, y)) {
      const j = I(nx, ny);
      if (dist[j] <= dist[i] + 1) continue;
      const t = S.tiles[j];
      if (isWater(t.t) || (t.t === MOUNTAIN && !has(p, 'climbing'))) continue;
      dist[j] = dist[i] + 1; src[j] = src[i]; q.push(j);
    }
  }
  return { dist, src };
}

function techUseful(p, t) {
  const inLand = f => S.tiles.some((tt, i) => ownerOfI(i) === p && f(tt));
  switch (t) {
    case 'organization': return inLand(tt => tt.res === 'fruit' || tt.res === 'crop');
    case 'farming': return inLand(tt => tt.res === 'crop');
    case 'hunting': return inLand(tt => tt.res === 'animal' || tt.t === FOREST);
    case 'forestry': return inLand(tt => tt.t === FOREST && !tt.res);
    case 'fishing': return inLand(tt => tt.res === 'fish');
    case 'climbing': return inLand(tt => tt.t === MOUNTAIN);
    case 'mining': return inLand(tt => tt.res === 'ore');
    case 'sailing': case 'navigation': return false;
    default: return S.turn > 3;
  }
}
function aiResearch(p, reserve) {
  const P = S.players[p];
  const order = ['organization', 'hunting', 'farming', 'riding', 'climbing', 'mining', 'archery', 'shields',
    'fishing', 'forestry', 'smithery', 'chivalry', 'mathematics'];
  const useful = t => techUseful(p, t) || Object.keys(TECHS).some(k => TECHS[k].parent === t && !has(p, k) && techUseful(p, k));
  for (const t of order) {
    if (has(p, t) || (TECHS[t].parent && !has(p, TECHS[t].parent)) || !useful(t)) continue;
    if (P.stars - techCost(p, t) >= reserve) { doResearch(p, t); return true; }
    return false;                      // save up for the one that matters most
  }
  return false;
}
function aiEconomy(p, reserve) {
  const P = S.players[p];
  for (let guard = 0; guard < 40; guard++) {
    let best = null, bv = -1;
    for (let i = 0; i < S.tiles.length; i++) {
      if (ownerOfI(i) !== p) continue;
      for (const key of ['fruit', 'animal', 'fish', 'farm', 'mine', 'lumber']) {
        if (!canWork(p, i, key)) continue;
        const W = WORKS[key];
        if (P.stars - W.cost < reserve) continue;
        const c = S.cities[S.tiles[i].city];
        let v = W.pop / W.cost + (c.pop + W.pop >= c.level + 1 ? .6 : 0) + Math.random() * .05;
        if (v > bv) { bv = v; best = [i, key]; }
      }
    }
    if (!best) return;
    doWork(p, best[0], best[1]);
  }
}
function aiPickUnit(p, threat) {
  const P = S.players[p];
  const w = { warrior: 3, rider: 4, archer: 3, defender: threat ? 5 : 1, swordsman: 6, catapult: threat ? 3 : 1, knight: 6 };
  const avail = TRAINABLE.filter(k => (!UNITS[k].tech || has(p, UNITS[k].tech)) && UNITS[k].cost <= P.stars);
  if (!avail.length) return null;
  let tot = 0; for (const k of avail) tot += w[k];
  let r = Math.random() * tot;
  for (const k of avail) { r -= w[k]; if (r <= 0) return k; }
  return avail[0];
}
function aiTrain(p, want) {
  let made = 0;
  for (const c of shuffle(citiesOf(p))) {
    if (made >= want) break;
    if (unitAt(c.x, c.y) || homeCount(c) >= capacity(c)) continue;
    const threat = enemyNear(c.x, c.y, p, 4);
    const k = aiPickUnit(p, threat);
    if (!k || !canTrain(p, c, k)) continue;
    doTrain(p, c, k); made++;
  }
  return made;
}
async function aiAttack(u) {
  for (let guard = 0; guard < 4; guard++) {
    if (!S.units.includes(u)) return;
    let best = null, bs = 0;
    for (const e of targets(u)) {
      const r = combat(u, e);
      let s = r.dmg + (r.killed ? 5 + UNITS[e.type].cost : 0) - r.ret * 1.1 - (r.ret >= u.hp ? 40 : 0);
      const c = cityAtI(I(e.x, e.y));
      if (c && c.owner === u.owner) s += 4;             // throw invaders out of our cities
      else if (c && S.diff !== 'easy' && r.ret < u.hp) {
        // a garrison never falls to one attacker: gang up, as a player would
        const friends = S.units.filter(v => v.owner === u.owner && v !== u && cheb(v.x, v.y, e.x, e.y) <= 1).length;
        s += 2 + friends * 2.5;
      }
      if (s > bs) { bs = s; best = e; }
    }
    if (!best) return;
    if (S.diff === 'easy' && Math.random() < .35) return;
    await doAttack(u, best);
    if (u.attacked) return;
  }
}
async function aiUnit(u, claimed) {
  if (!S.units.includes(u) || S.over) return;
  const p = u.owner;
  if (canCapture(u)) { doCapture(u); await FX.pause(u); return; }
  if (canRuin(u)) { doRuin(u); return; }
  if (exhausted(u)) return;
  if (u.hp < maxHp(u) * .45 && canRecover(u) && !enemyNear(u.x, u.y, p)) { doRecover(u); return; }
  await aiAttack(u);
  if (!S.units.includes(u) || u.moved || u.boat) return;
  const here = I(u.x, u.y), hc = cityAtI(here);
  if (hc && hc.owner !== p) return;                          // hold it and capture next turn
  if (hc && hc.owner === p && enemyNear(u.x, u.y, p, 2)) return;   // garrison
  const goals = [];
  for (const c of S.cities) {
    const gi = I(c.x, c.y);
    if (claimed.has(gi)) continue;
    if (c.owner !== p) goals.push(gi);
    else if (!unitAt(c.x, c.y) && enemyNear(c.x, c.y, p, 3)) goals.push(gi);
  }
  for (let i = 0; i < S.tiles.length; i++) if (S.tiles[i].ruin && !claimed.has(i) && !isWater(S.tiles[i].t)) goals.push(i);
  for (const e of S.units) if (e.owner !== p) goals.push(I(e.x, e.y));
  const { dist, src } = goalField(p, goals);
  const { dests, prev } = moveInfo(u);
  let best = here, bd = dist[here];
  for (const d of dests) {
    let v = dist[d];
    const t = S.tiles[d];
    if ((t.t === FOREST && has(p, 'archery')) || (t.t === MOUNTAIN && has(p, 'climbing'))) v -= .2;
    if (S.diff === 'easy') v += Math.random() * 1.5;
    if (v < bd) { bd = v; best = d; }
  }
  if (best !== here) {
    if (src[best] >= 0 && dist[best] <= 4) claimed.add(src[best]);
    await doMove(u, best, prev);
    await FX.pause(u);
    const bc = cityAtI(best);
    if (bc && bc.owner !== p) claimed.add(best);
    await aiAttack(u);
  } else if (canRecover(u)) doRecover(u);
}
async function aiTurn(p) {
  const P = S.players[p];
  const mine = citiesOf(p);
  const threat = mine.some(c => enemyNear(c.x, c.y, p, 3));
  const units = unitsOf(p).length;
  const desired = mine.reduce((s, c) => s + c.level, 0) + (threat ? 2 : 0) + (S.diff === 'hard' ? 1 : 0);
  if (units < Math.max(2, desired * (S.diff === 'easy' ? .6 : 1))) aiTrain(p, threat ? 3 : 1);
  aiResearch(p, S.diff === 'easy' ? 2 : 0);
  aiEconomy(p, threat ? 3 : 0);
  const claimed = new Set();
  const list = unitsOf(p).sort((a, b) => (canCapture(b) ? 1 : 0) - (canCapture(a) ? 1 : 0));
  for (const u of list) {
    await aiUnit(u, claimed);
    if (S.over) return;
  }
  if (P.stars >= 6) aiTrain(p, 2);
}

// ---------- saving ----------
function saveGame() {
  if (!S || S.demo) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.v === 1 && Array.isArray(s.tiles) ? s : null;
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }
