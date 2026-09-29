'use strict';
/* Tribelands — castaway tribes on a volcanic island chain.
   Rules, map generation and the computer tribes. Everything the game knows
   lives in S, a plain object that goes straight to JSON: that is the
   autosave, and a copy of it is what Undo steps back to.                    */

const VERSION = 'v23';
const SAVE_KEY = 'tribelands-save-v1';
const PREF_KEY = 'tribelands-prefs-v1';
const SH = '🐚';                                  // shells: the island's currency

const FIELD = 0, FOREST = 1, MOUNTAIN = 2, SHALLOW = 3, OCEAN = 4;
const TERRAIN_NAME = ['Grassland', 'Jungle', 'Cliffs', 'Lagoon', 'Deep sea'];
const TERRAIN_ICON = ['🌱', '🌴', '🪨', '🏝️', '🌊'];
const isWater = t => t === SHALLOW || t === OCEAN;
const LEVEL_NAME = ['Shack', 'Shelter', 'Camp', 'Village', 'Town', 'Haven'];
const levelName = l => LEVEL_NAME[Math.min(l, 5)];

const TRIBES = [
  { name: 'Tala', color: '#EE7440', skin: '#E9B48A', tech: 'forage', start: 'scrapper', hat: 'flower',
    blurb: 'Coconut coast. They wash up knowing how to forage.',
    trait: { name: 'Coconut crackers', icon: '🥥', desc: `Cracking coconuts costs 1 ${SH} instead of 2.` },
    land: { forest: .22, mountain: .12 }, res: { coconut: .36, taro: .22, boar: .35, obsidian: .35 },
    pal: { field: '#9DCF62', forest: '#3F9A55', mountain: '#857C77', tree: 'palm' },
    syl: ['ta', 'la', 'ko', 'mai', 'ri', 'nu', 'hi', 'po', 'ea', 'lo', 'ki', 'wa', 'ma', 'le'] },
  { name: 'Moku', color: '#16A39D', skin: '#D9A578', tech: 'fishing', start: 'scrapper', hat: 'bandana',
    blurb: 'Lagoon folk. They wash up spear in hand.',
    trait: { name: 'Lagoon born', icon: '🏊', desc: 'Your units wade through lagoons (shallow water) as if it were land.' },
    land: { forest: .2, mountain: .12 }, res: { coconut: .3, taro: .2, boar: .3, obsidian: .3 },
    pal: { field: '#8FD08A', forest: '#2E8F6A', mountain: '#7E8288', tree: 'banana' },
    syl: ['mo', 'ku', 'ai', 'na', 'pe', 'wai', 'ho', 'li', 'ke', 'ua', 'mi', 'lu', 'ha', 'o'] },
  { name: 'Vaka', color: '#D23F3A', skin: '#C98E60', tech: 'climbing', start: 'scrapper', hat: 'feather',
    blurb: 'Cliff dwellers of the black basalt. They wash up climbing.',
    trait: { name: 'Cliff runners', icon: '🧗', desc: 'Cliffs never stop your units’ movement.' },
    land: { forest: .18, mountain: .34 }, res: { coconut: .28, taro: .18, boar: .3, obsidian: .6 },
    pal: { field: '#B4C865', forest: '#5A8F3A', mountain: '#5E5A62', tree: 'bamboo' },
    syl: ['va', 'ka', 'tu', 'ro', 'fe', 'ga', 'si', 'mo', 'te', 'ra', 'pu', 'ne', 'ti', 'ho'] },
  { name: 'Nalu', color: '#8E58D0', skin: '#F0C9A6', tech: 'tracking', start: 'scrapper', hat: 'leaf',
    blurb: 'Jungle trackers. They wash up hunting.',
    trait: { name: 'Jungle ghosts', icon: '🌿', desc: 'Jungle never stops your units, and they always defend +50% in it.' },
    land: { forest: .46, mountain: .13 }, res: { coconut: .22, taro: .15, boar: .52, obsidian: .35 },
    pal: { field: '#7FBF63', forest: '#23704A', mountain: '#7B7E86', tree: 'jungle' },
    syl: ['na', 'lu', 'ki', 'ra', 'ze', 'mu', 'ta', 'vi', 'ol', 'sa', 'ni', 'ko', 'ya', 'ri'] },
];

// The skill web. Skills unlock by survival day, and later ones need two earlier ones.
const TECHS = {
  forage:    { name: 'Foraging',         icon: '🥥', tier: 1, needs: [], unlocks: ['🥥 Crack coconuts: +1 survivor'] },
  fishing:   { name: 'Spearfishing',     icon: '🐟', tier: 1, needs: [], unlocks: ['🐟 Spear fish: +1 survivor', '⚓ Raft docks: units that walk in become rafts'] },
  tracking:  { name: 'Tracking',         icon: '🐾', tier: 1, needs: [], unlocks: ['🐗 Hunt wild boar: +1 survivor'] },
  climbing:  { name: 'Climbing',         icon: '🧗', tier: 1, needs: [], unlocks: ['🪨 Walk onto cliffs', 'Units on cliffs defend +50%'] },
  fire:      { name: 'Firemaking',       icon: '🔥', tier: 1, needs: [], unlocks: [`🔥 Signal fires on cliffs: see far, +1 ${SH} a turn from passing traders`, `🔥 Slash and burn jungle for +1 ${SH}`] },
  slings:    { name: 'Slings',           icon: '🪨', tier: 2, needs: ['tracking'], unlocks: ['🪨 Slinger: hits from 2 tiles away', 'Units in jungle defend +50%'] },
  sprinting: { name: 'Sprinting',        icon: '🏃', tier: 2, needs: ['tracking'], unlocks: ['🏃 Runner: moves 2, can move again after attacking'] },
  gardening: { name: 'Gardening',        icon: '🌱', tier: 2, needs: ['forage'], unlocks: ['🌱 Taro gardens: +2 survivors'] },
  trails:    { name: 'Trailblazing',     icon: '🪓', tier: 2, needs: ['forage'], unlocks: ['🪓 Machete trails: moving trail to trail costs half', 'Camps count as trail ends'] },
  weaving:   { name: 'Weaving',          icon: '🧺', tier: 2, needs: ['forage'], unlocks: ['🛖 Bamboo huts in jungle: +1 survivor'] },
  quarrying: { name: 'Quarrying',        icon: '⛏️', tier: 2, needs: ['climbing'], unlocks: ['⛏️ Obsidian quarries: +2 survivors'] },
  shells:    { name: 'Turtle shells',    icon: '🐢', tier: 2, needs: ['fishing'], unlocks: ['🐢 Shieldbearer: 15 HP, defence 3', '🗿 Stone Totems landmark'] },
  rafting:   { name: 'Rafting',          icon: '🛶', tier: 2, needs: ['fishing'], unlocks: ['🛶 Rafts cross the deep sea', '🗼 Lighthouse landmark'] },
  alliances: { name: 'Alliances',        icon: '🤝', tier: 2, needs: ['fire'], unlocks: ['🤝 Offer truces to rival tribes', '🗣️ Schemer: talks an adjacent enemy into joining you'] },
  obsidian:  { name: 'Obsidian blades',  icon: '🗡️', tier: 3, needs: ['quarrying'], unlocks: ['🗡️ Blade: attack 3, defence 3, 15 HP', '🔥 Fire Throne landmark'] },
  boars:     { name: 'Boar taming',      icon: '🐗', tier: 3, needs: ['sprinting', 'trails'], unlocks: ['🐗 Boar Rider: moves 3, attacks again after each kill'] },
  catapult:  { name: 'Coconut catapult', icon: '🎯', tier: 3, needs: ['gardening', 'weaving'], unlocks: ['🎯 Coconut Catapult: attack 4 from 3 tiles, but fragile'] },
  trading:   { name: 'Trading',          icon: '🏪', tier: 3, needs: ['gardening', 'rafting'], unlocks: [`🏪 Trading posts: +1 ${SH} a turn for each garden, quarry, hut or dock beside them`, '🛍️ Floating Market landmark'] },
  gliding:   { name: 'Gliding',          icon: '🪂', tier: 3, needs: ['weaving', 'climbing'], unlocks: ['🪂 Glider: flies over sea, cliffs and enemy lines'] },
  medicine:  { name: 'Bush medicine',    icon: '🌿', tier: 3, needs: ['gardening', 'fire'], unlocks: ['🌿 Healer: heals every friendly unit around it', '💧 Sacred Spring landmark'] },
  canoes:    { name: 'War canoes',       icon: '⛵', tier: 3, needs: ['rafting', 'slings'], unlocks: ['⛵ Rafts become War Canoes: attack 3, move 3'] },
};
const DAYS = { 1: 'Day 1', 2: 'Day 10', 3: 'Day 30' };
const techReady = (p, t) => TECHS[t].needs.every(n => has(p, n));

const UNITS = {
  scrapper:     { name: 'Scrapper',         icon: '🏏', cost: 2, hp: 10, atk: 2,   def: 2, mv: 1, rng: 1, tech: null,        dash: 1 },
  runner:       { name: 'Runner',           icon: '🏃', cost: 3, hp: 10, atk: 2,   def: 1, mv: 2, rng: 1, tech: 'sprinting', dash: 1, escape: 1 },
  slinger:      { name: 'Slinger',          icon: '🪨', cost: 3, hp: 10, atk: 2,   def: 1, mv: 1, rng: 2, tech: 'slings',    dash: 1 },
  shieldbearer: { name: 'Shieldbearer',     icon: '🐢', cost: 3, hp: 15, atk: 1,   def: 3, mv: 1, rng: 1, tech: 'shells' },
  healer:       { name: 'Healer',           icon: '🌿', cost: 4, hp: 10, atk: 1,   def: 1, mv: 1, rng: 1, tech: 'medicine',  heal: 1 },
  schemer:      { name: 'Schemer',          icon: '🗣️', cost: 5, hp: 10, atk: 0,   def: 1, mv: 1, rng: 1, tech: 'alliances', convert: 1 },
  blade:        { name: 'Blade',            icon: '🗡️', cost: 5, hp: 15, atk: 3,   def: 3, mv: 1, rng: 1, tech: 'obsidian',  dash: 1 },
  glider:       { name: 'Glider',           icon: '🪂', cost: 7, hp: 10, atk: 2,   def: 1, mv: 3, rng: 1, tech: 'gliding',   dash: 1, fly: 1 },
  catapult:     { name: 'Coconut Catapult', icon: '🎯', cost: 8, hp: 10, atk: 4,   def: 0, mv: 1, rng: 3, tech: 'catapult' },
  boarrider:    { name: 'Boar Rider',       icon: '🐗', cost: 8, hp: 10, atk: 3.5, def: 1, mv: 3, rng: 1, tech: 'boars',     dash: 1, persist: 1 },
  titan:        { name: 'Tiki Titan',       icon: '🗿', cost: 0, hp: 40, atk: 5,   def: 4, mv: 1, rng: 1, tech: '-',         dash: 1 },
};
const TRAINABLE = ['scrapper', 'runner', 'slinger', 'shieldbearer', 'healer', 'schemer', 'blade', 'glider', 'catapult', 'boarrider'];
const BOATS = {
  raft:  { name: 'Raft',      icon: '🛶', atk: 1, def: 1, mv: 2, rng: 2, dash: 1 },
  canoe: { name: 'War Canoe', icon: '⛵', atk: 3, def: 2, mv: 3, rng: 2, dash: 1 },
};
// Plain-words abilities, for the unit panel.
const SKILLS = {
  dash: ['Dash', 'can attack after moving'],
  escape: ['Escape', 'can move again after attacking'],
  persist: ['Rampage', 'attacks again after every kill'],
  fly: ['Flying', 'ignores terrain, sea and enemy lines'],
  heal: ['Heal', 'restores 4 HP to every friendly unit next to it'],
  convert: ['Sway', 'talks an adjacent enemy into joining you instead of fighting'],
};

// Work you can do on a tile inside your borders. No unit needed, only shells.
const WORKS = {
  coconut: { name: 'Crack coconuts',  icon: '🥥', tech: 'forage',    cost: 2, pop: 1, ok: t => t.res === 'coconut' },
  boar:    { name: 'Hunt boar',       icon: '🐗', tech: 'tracking',  cost: 2, pop: 1, ok: t => t.res === 'boar' },
  fish:    { name: 'Spear fish',      icon: '🐟', tech: 'fishing',   cost: 2, pop: 1, ok: t => t.res === 'fish' },
  garden:  { name: 'Taro garden',     icon: '🌱', tech: 'gardening', cost: 5, pop: 2, ok: t => t.res === 'taro' },
  quarry:  { name: 'Obsidian quarry', icon: '⛏️', tech: 'quarrying', cost: 5, pop: 2, ok: t => t.res === 'obsidian' },
  hut:     { name: 'Bamboo hut',      icon: '🛖', tech: 'weaving',   cost: 3, pop: 1, ok: t => t.t === FOREST && !t.res && !t.imp },
  burn:    { name: 'Slash and burn',  icon: '🔥', tech: 'fire',      cost: 0, pop: 0, gain: 1, ok: t => t.t === FOREST && !t.imp },
  signal:  { name: 'Signal fire',     icon: '🔥', tech: 'fire',      cost: 4, pop: 0, ok: t => t.t === MOUNTAIN && !t.res && !t.imp && !t.volcano },
  post:    { name: 'Trading post',    icon: '🏪', tech: 'trading',   cost: 6, pop: 0, ok: t => t.t === FIELD && !t.res && !t.imp },
  dock:    { name: 'Raft dock',       icon: '⚓', tech: 'fishing',   cost: 7, pop: 1, ok: t => t.t === SHALLOW && !t.imp && !t.res },
  trail:   { name: 'Machete trail',   icon: '🪓', tech: 'trails',    cost: 2, pop: 0, ok: t => !isWater(t.t) && !t.road },
};
const RES_NAME = { coconut: 'Coconut palm', taro: 'Wild taro', boar: 'Wild boar', fish: 'Fish', obsidian: 'Obsidian' };
const IMP_NAME = { garden: 'Taro garden', quarry: 'Obsidian quarry', hut: 'Bamboo hut', dock: 'Raft dock', post: 'Trading post', signal: 'Signal fire' };
const POST_FEEDERS = ['garden', 'quarry', 'hut', 'dock'];

// Landmarks: one of each per island chain. Whoever holds the camp holds the landmark.
const WONDERS = {
  lighthouse: { name: 'Lighthouse',      icon: '🗼', tech: 'rafting',  cost: 14, desc: `Reveals every island at once, and +1 ${SH} every turn.` },
  totems:     { name: 'Stone Totems',    icon: '🗿', tech: 'shells',   cost: 16, desc: 'Your camps defend ×2.5 instead of ×1.5 (palisades still ×4).' },
  market:     { name: 'Floating Market', icon: '🛍️', tech: 'trading',  cost: 18, desc: `+1 ${SH} every turn for each camp you own.` },
  spring:     { name: 'Sacred Spring',   icon: '💧', tech: 'medicine', cost: 15, desc: 'All your units heal 2 HP at the start of every turn.' },
  throne:     { name: 'Fire Throne',     icon: '🔥', tech: 'obsidian', cost: 16, desc: 'Every unit you train starts as a veteran (+5 HP).' },
};

const REWARDS = {
  workshop:  { name: 'Toolmaker',     icon: '🔨', desc: `+1 ${SH} every turn.` },
  explorer:  { name: 'Scout canoe',   icon: '🧭', desc: 'Paddles off and reveals a long stretch of the islands.' },
  walls:     { name: 'Palisade',      icon: '🪵', desc: 'Units in this camp defend four times as well.' },
  resources: { name: 'Supply cache',  icon: '📦', desc: `+5 ${SH} right now.` },
  popgrowth: { name: 'Newcomers',     icon: '👪', desc: '+3 survivors, which may level the camp again.' },
  border:    { name: 'Claim the cove', icon: '🗺️', desc: 'Territory grows from 3×3 to 5×5 tiles.' },
  giant:     { name: 'Tiki Titan',    icon: '🗿', desc: 'A living idol: 40 HP, attack 5, defence 4.' },
  park:      { name: 'Hammock grove', icon: '🏝️', desc: `+1 ${SH} every turn, and very relaxing.` },
};
function rewardChoices(level) {
  if (level === 2) return ['workshop', 'explorer'];
  if (level === 3) return ['walls', 'resources'];
  if (level === 4) return ['popgrowth', 'border'];
  return ['giant', 'park'];
}

// Every few turns the island itself does something. Fair: it hits every tribe.
const EVENTS = {
  drop:     { name: 'Supply drop',            icon: '📦', desc: `Crates wash up: every tribe gets 3 ${SH}.` },
  rain:     { name: 'Rainy season',           icon: '🌧️', desc: 'Every camp gains 1 survivor.' },
  storm:    { name: 'Tropical storm',         icon: '🌀', desc: 'Units at sea lose 3 HP, everyone else 1 (nobody dies of it).' },
  washed:   { name: 'Castaways wash ashore',  icon: '🏕️', desc: 'Two new stranded shacks appear, ready to recruit.' },
  stampede: { name: 'Boar stampede',          icon: '🐗', desc: 'Wild boar return to many jungles.' },
  eruption: { name: 'The volcano erupts',     icon: '🌋', desc: 'Units within 2 tiles of it lose 4 HP (nobody dies of it). Fresh obsidian cools on the cliffs around.' },
  moon:     { name: 'Full moon',              icon: '🌕', desc: 'Its light reveals a stretch of the unknown.' },
};
const CHALLENGES = {
  reward:   { name: 'Reward challenge',   icon: '🏁', desc: `The first unit to reach the flag wins 10 ${SH}.` },
  immunity: { name: 'Immunity challenge', icon: '🗿', desc: 'The first unit to reach the flag wins a hidden immunity idol.' },
};

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
const tribeIs = (p, k) => S.players[p].tribe === k;
const citiesOf = p => S.cities.filter(c => c.owner === p);
const unitsOf = p => S.units.filter(u => u.owner === p);
const isHuman = p => S.players[p].human;

function st(u) { return u.boat ? BOATS[u.boat] : UNITS[u.type]; }
function maxHp(u) { return UNITS[u.type].hp + (u.vet ? 5 : 0); }
function unitName(u) { return u.boat ? BOATS[u.boat].name + ' (' + UNITS[u.type].name + ')' : UNITS[u.type].name; }
const mvOf = u => st(u).mv;
const flies = u => !u.boat && !!UNITS[u.type].fly;
const wades = u => !u.boat && !flies(u) && tribeIs(u.owner, 1);
const atSea = u => !!u.boat || (wades(u) && isWater(tileAt(u.x, u.y).t));

// ---------- alliances ----------
const peaceKey = (a, b) => Math.min(a, b) + '-' + Math.max(a, b);
function atPeace(a, b) { return a !== b && a >= 0 && b >= 0 && (S.truce[peaceKey(a, b)] || 0) >= S.turn; }
function peaceLeft(a, b) { return Math.max(0, (S.truce[peaceKey(a, b)] || 0) - S.turn + 1); }
const hostile = (a, b) => a !== b && !atPeace(a, b);
function strength(p) {
  let s = 0;
  for (const u of S.units) if (u.owner === p) s += (st(u).atk + st(u).def) * u.hp / 10;
  return s + citiesOf(p).length * 3;
}
function truceCost(p, q) { return 4 + 2 * citiesOf(q).length; }
function truceAccepted(p, q) { return strength(q) < strength(p) * 1.25 || Math.random() < .25; }
function makeTruce(a, b, turns) { S.truce[peaceKey(a, b)] = S.turn + turns; }

// ---------- economy ----------
function techCost(p, t) { return TECHS[t].tier * Math.max(1, citiesOf(p).length) + 4; }
function canResearch(p, t) { return !has(p, t) && techReady(p, t) && S.players[p].stars >= techCost(p, t); }
function wonderOwner(key) { const c = S.wonders[key]; return c == null ? -1 : S.cities[c].owner; }
const hasWonder = (p, key) => wonderOwner(key) === p;
function postValue(i) {
  const [x, y] = XY(i);
  let k = 0;
  for (const [nx, ny] of nbrs(x, y)) if (POST_FEEDERS.includes(tileAt(nx, ny).imp)) k++;
  return Math.min(4, k);
}
function cityIncome(c) { return c.level + (c.workshop ? 1 : 0) + c.parks + (c.capital ? 1 : 0); }
// Every source of shells, so the HUD can explain the total.
function incomeParts(p) {
  const parts = [];
  for (const c of S.cities) {
    if (c.owner !== p) continue;
    const why = ['level ' + c.level, c.capital && 'first camp +1', c.workshop && 'toolmaker +1', c.parks && 'hammocks +' + c.parks].filter(Boolean).join(', ');
    parts.push({ label: c.name, why, v: cityIncome(c) });
  }
  let m = 0, mk = 0, sig = 0;
  for (let i = 0; i < S.tiles.length; i++) {
    if (ownerOfI(i) !== p) continue;
    if (S.tiles[i].imp === 'post') { m += postValue(i); mk++; }
    if (S.tiles[i].imp === 'signal') sig++;
  }
  if (mk) parts.push({ label: 'Trading posts', why: mk + (mk === 1 ? ' post' : ' posts'), v: m });
  if (sig) parts.push({ label: 'Signal fires', why: 'passing traders', v: sig });
  if (hasWonder(p, 'lighthouse')) parts.push({ label: 'Lighthouse', why: 'landmark', v: 1 });
  if (hasWonder(p, 'market')) parts.push({ label: 'Floating Market', why: '+1 per camp', v: citiesOf(p).length });
  if (!isHuman(p) && S.diff === 'hard') parts.push({ label: 'Hard mode', why: 'computer bonus', v: 2 });
  return parts;
}
function income(p) { return incomeParts(p).reduce((s, x) => s + x.v, 0); }
function homeCount(c) { let k = 0; for (const u of S.units) if (u.home === c.id) k++; return k; }
function capacity(c) { return c.level + 1; }
function workCost(p, key) { return key === 'coconut' && tribeIs(p, 0) ? 1 : WORKS[key].cost; }

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
  for (const u of S.units) if (isHuman(u.owner)) reveal(u.x, u.y, tileAt(u.x, u.y).t === MOUNTAIN || flies(u) ? 2 : 1);
  for (const c of S.cities) if (c.owner >= 0 && isHuman(c.owner)) reveal(c.x, c.y, c.radius + 1);
  for (let i = 0; i < S.tiles.length; i++) if (S.tiles[i].imp === 'signal' && ownerOfI(i) >= 0 && isHuman(ownerOfI(i))) reveal(...XY(i), 3);
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
  return 'Camp ' + (S.cities.length + 1);
}

function newGame(opts) {
  const n = { small: 11, medium: 14, large: 18 }[opts.size] || 14;
  const tribes = [opts.tribe, ...shuffle([0, 1, 2, 3].filter(t => t !== opts.tribe)).slice(0, opts.opponents)];
  S = {
    v: 3, n, turn: 1, cur: 0, diff: opts.diff, size: opts.size, over: null, nextId: 1,
    players: tribes.map((t, i) => ({ id: i, tribe: t, human: i === 0, stars: 5 + (i && opts.diff === 'hard' ? 3 : 0),
      techs: { [TRIBES[t].tech]: true }, alive: true, kills: 0, lost: 0, converts: 0, idols: 0, challenges: 0, asked: {} })),
    tiles: [], cities: [], units: [], explored: new Array(n * n).fill(0), pendingRewards: [],
    wonders: {}, truce: {}, nextEvent: 5 + rnd(3), event: null, offer: null, log: [],
    challenge: null, nextChallenge: 3 + rnd(3), volcano: -1,
  };
  genMap(tribes);
  revealed = 0;
  vision();
  return S;
}

function placeCapitals(n, k) {
  const m = n <= 11 ? 2 : 3;
  const spots = shuffle([[m, m], [n - 1 - m, n - 1 - m], [n - 1 - m, m], [m, n - 1 - m]]);
  if (k === 2) {                                 // two tribes wash up on opposite corners
    const a = spots[0];
    const b = spots.find(s => s[0] !== a[0] && s[1] !== a[1]);
    spots.splice(0, 4, a, b);
  }
  return spots.slice(0, k).map(([x, y]) => [clamp(x + rnd(3) - 1, 1, n - 2), clamp(y + rnd(3) - 1, 1, n - 2)]);
}

function genMap(tribes) {
  const n = S.n, N = n * n;
  const caps = placeCapitals(n, tribes.length);
  const G = 3, gw = Math.ceil(n / G) + 2, g = Array.from({ length: gw * gw }, () => Math.random());
  const sm = t => t * t * (3 - 2 * t);
  const vn = (x, y) => {
    const fx = x / G, fy = y / G, x0 = Math.floor(fx), y0 = Math.floor(fy), u = sm(fx - x0), v = sm(fy - y0);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const land = new Array(N).fill(false), clim = new Array(N).fill(0);
  const cx0 = (n - 1) / 2, cy0 = (n - 1) / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let best = 0, bd = 1e9;
    caps.forEach(([cx, cy], k) => { const d = (cx - x) ** 2 + (cy - y) ** 2 + Math.random() * 3; if (d < bd) { bd = d; best = k; } });
    clim[I(x, y)] = tribes[best];
    const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
    const centre = Math.hypot(x - cx0, y - cy0) < 1.6 ? .3 : 0;               // the volcano's island
    const h = vn(x, y) * .75 + Math.random() * .25 + (edge < 1 ? -.34 : edge < 2 ? -.12 : 0) + (bd < 9 ? .12 : 0) + centre;
    land[I(x, y)] = h > .5;                                                    // an archipelago: more sea
  }
  for (const [cx, cy] of caps) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = cx + dx, y = cy + dy;
    if (inb(x, y) && (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 || Math.random() < .5)) land[I(x, y)] = true;
  }
  // sandbars: every camp must be reachable on foot from every other
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
  const vi = I(Math.round(cx0), Math.round(cy0));
  land[vi] = true;
  const anchors = [vi, ...caps.map(([x, y]) => I(x, y))];
  for (let k = 1; k < anchors.length; k++) {
    let c = comp();
    let [x, y] = XY(anchors[k]);
    const [tx, ty] = XY(anchors[0]);
    let guard = 0;
    while (c[I(x, y)] !== c[anchors[0]] && guard++ < 200) {
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
    S.tiles.push({ t, clim: clim[i], res: null, imp: null, road: false, city: -1, cityHere: -1, ruin: false, volcano: false });
  }
  S.tiles[vi].t = MOUNTAIN; S.tiles[vi].volcano = true; S.volcano = vi;
  caps.forEach(([x, y], p) => {
    tileAt(x, y).t = FIELD;
    const c = addCity(x, y, p, true);
    const tribe = tribes[p];
    // a fair start: something to eat beside every first camp, matching the tribe's first skill
    const around = shuffle(nbrs(x, y).filter(([nx, ny]) => !isWater(tileAt(nx, ny).t) && !tileAt(nx, ny).volcano));
    const want = [['coconut', 'coconut', 'boar'], ['coconut', 'boar', 'taro'], ['coconut', 'boar', 'obsidian'], ['boar', 'boar', 'coconut']][tribe];
    want.forEach((r, k) => {
      const a = around[k]; if (!a) return;
      const tt = tileAt(a[0], a[1]);
      tt.t = r === 'boar' ? FOREST : r === 'obsidian' ? MOUNTAIN : FIELD;
      tt.res = r;
    });
    if (tribe === 1) {                                 // Moku always have fish in reach
      const w = nbrs(x, y).map(([nx, ny]) => I(nx, ny)).find(j => S.tiles[j].t === SHALLOW);
      if (w != null) S.tiles[w].res = 'fish';
    }
    const u = addUnit(TRIBES[tribe].start, p, x, y, c.id);
    u.moved = u.attacked = false;
  });
  const target = Math.round(N / 15);
  let made = 0;
  for (const i of shuffle([...Array(N).keys()])) {
    if (made >= target) break;
    if (placeVillage(i)) made++;
  }
  for (let i = 0; i < N; i++) {
    const t = S.tiles[i]; if (t.cityHere >= 0 || t.res || t.volcano) continue;
    const [x, y] = XY(i);
    const near = S.cities.some(c => cheb(c.x, c.y, x, y) <= 2) ? 1 : .45;
    const R = TRIBES[t.clim].res, r = Math.random() / near;
    if (t.t === FIELD) t.res = r < R.coconut ? 'coconut' : r < R.coconut + R.taro ? 'taro' : null;
    else if (t.t === FOREST) t.res = r < R.boar ? 'boar' : null;
    else if (t.t === MOUNTAIN) t.res = r < R.obsidian ? 'obsidian' : null;
    else if (t.t === SHALLOW) t.res = r < .32 ? 'fish' : null;
  }
  const rc = Math.max(2, Math.round(N / 40));
  let rm = 0;
  for (const i of shuffle([...Array(N).keys()])) {
    if (rm >= rc) break;
    const t = S.tiles[i], [x, y] = XY(i);
    if (t.cityHere >= 0 || t.t === SHALLOW || t.volcano) continue;
    if (S.cities.some(c => cheb(c.x, c.y, x, y) < (c.owner >= 0 ? 3 : 1))) continue;
    t.ruin = true; t.res = null; rm++;
  }
}
function placeVillage(i) {
  const t = S.tiles[i], [x, y] = XY(i), n = S.n;
  if (isWater(t.t) || t.t === MOUNTAIN || t.cityHere >= 0 || t.city >= 0 || t.ruin || t.volcano) return false;
  if (x < 1 || y < 1 || x > n - 2 || y > n - 2 || unitAt(x, y)) return false;
  if (S.cities.some(c => cheb(c.x, c.y, x, y) < 3)) return false;
  if (S.challenge && S.challenge.i === i) return false;
  t.t = FIELD; t.res = null;
  addCity(x, y, -1, false);
  return true;
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
// Movement is counted in half-steps so that trails can cost half.
const roadish = i => S.tiles[i].road || S.tiles[i].cityHere >= 0;
function step(u, from, to) {
  const p = u.owner, t = S.tiles[to];
  if (isHuman(p) && !seen(to)) return null;
  if (flies(u)) return { cost: 2, end: false };
  if (u.boat) {
    if (isWater(t.t)) return t.t === OCEAN && !has(p, 'rafting') ? null : { cost: 2, end: false };
    if (t.t === MOUNTAIN && !has(p, 'climbing')) return null;
    return { cost: 2, end: true };                       // landing ends the turn
  }
  if (isWater(t.t)) {
    if (t.imp === 'dock' && ownerOfI(to) === p) return { cost: 2, end: true };
    return t.t === SHALLOW && tribeIs(p, 1) ? { cost: 2, end: false } : null;
  }
  const cost = roadish(from) && roadish(to) ? 1 : 2;
  if (t.t === MOUNTAIN) return has(p, 'climbing') ? { cost, end: !tribeIs(p, 2) } : null;
  if (t.t === FOREST) return { cost, end: !tribeIs(p, 3) };
  return { cost, end: false };
}
function canStand(u, i) {
  const t = S.tiles[i];
  if (flies(u) || u.boat) return true;
  if (isWater(t.t)) return t.t === SHALLOW && wades(u);
  return t.t !== MOUNTAIN || has(u.owner, 'climbing');
}
function enemyNear(x, y, p, r = 1) {
  for (const e of S.units) {
    if (!hostile(p, e.owner) || cheb(x, y, e.x, e.y) > r) continue;
    if (isHuman(p) && !seen(I(e.x, e.y))) continue;
    return true;
  }
  return false;
}
function moveInfo(u) {
  const dests = new Set(), prev = new Map(), best = new Map();
  if (u.moved) return { dests, prev };
  const start = I(u.x, u.y), fly = flies(u);
  best.set(start, mvOf(u) * 2);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], r = best.get(cur);
    if (r <= 0) continue;
    const [cx, cy] = XY(cur);
    for (const [nx, ny] of nbrs(cx, cy)) {
      const ni = I(nx, ny);
      if (ni === start) continue;
      const s = step(u, cur, ni);
      if (!s || r < s.cost) continue;
      const occ = unitAt(nx, ny);
      if (occ && occ.owner !== u.owner) continue;
      let nr = s.end ? 0 : r - s.cost;
      if (nr > 0 && !fly && enemyNear(nx, ny, u.owner)) nr = 0;   // zone of control
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
  if (c && c.owner === u.owner) return c.walls ? 4 : hasWonder(u.owner, 'totems') ? 2.5 : 1.5;
  if (u.boat || flies(u)) return 1;
  if (t.t === FOREST && (has(u.owner, 'slings') || tribeIs(u.owner, 3))) return 1.5;
  if (t.t === MOUNTAIN && has(u.owner, 'climbing')) return 1.5;
  return 1;
}
function combat(a, d) {
  const sa = st(a), sd = st(d);
  const aF = sa.atk * a.hp / maxHp(a);
  const dF = sd.def * d.hp / maxHp(d) * defBonus(d);
  const tot = aF + dF || 1;
  const dmg = Math.round(aF / tot * sa.atk * 4.5);
  const killed = dmg >= d.hp;
  const inRange = cheb(a.x, a.y, d.x, d.y) <= sd.rng;
  const ret = killed || !inRange ? 0 : Math.round(dF / tot * sd.def * 4.5);
  return { dmg, ret, killed };
}
function targets(u) {
  if (u.attacked) return [];
  const s = st(u);
  if (u.moved && !s.dash && !UNITS[u.type].convert) return [];
  if (!u.boat && UNITS[u.type].heal) return [];
  const conv = !u.boat && UNITS[u.type].convert;
  return S.units.filter(e => hostile(u.owner, e.owner) && cheb(u.x, u.y, e.x, e.y) <= s.rng
    && (!conv || e.type !== 'titan') && (!isHuman(u.owner) || seen(I(e.x, e.y))));
}
function exhausted(u) {
  if (u.attacked) return u.moved;
  return u.moved && !st(u).dash && !UNITS[u.type].heal && !UNITS[u.type].convert;
}
function unitStatus(u) {
  if (exhausted(u)) return 'Done for this turn';
  if (!u.moved && !u.attacked) return 'Ready: can move and act';
  if (u.moved) return 'Moved: can still attack';
  return 'Attacked: can still move';
}

// ---------- actions (shared by the player and the computer) ----------
// Hooks the UI fills in to animate and announce. Defaults do nothing.
const FX = {
  move: async () => { }, attack: async () => { }, float: () => { }, say: () => { }, pause: async () => { },
};
function logIt(msg) { S.log.push({ t: S.turn, msg }); if (S.log.length > 60) S.log.shift(); }

function checkChallenge(u) {
  const ch = S.challenge;
  if (!ch || I(u.x, u.y) !== ch.i) return;
  const P = S.players[u.owner];
  if (ch.kind === 'reward') { P.stars += 10; FX.float(u.x, u.y, '+10 ' + SH, '#ffd24a'); }
  else { P.idols++; FX.float(u.x, u.y, 'Idol!', '#ffd24a'); }
  P.challenges++;
  FX.say(`The ${tribeOf(u.owner).name} won the ${CHALLENGES[ch.kind].name.toLowerCase()}!`, u.owner, null, true);
  logIt(`The ${tribeOf(u.owner).name} won the ${CHALLENGES[ch.kind].name.toLowerCase()}`);
  S.challenge = null;
  S.nextChallenge = S.turn + 6 + rnd(4);
}

async function doMove(u, dest, prev) {
  const path = pathTo(u, prev, dest);
  await FX.move(u, path);
  const [x, y] = XY(dest);
  u.x = x; u.y = y; u.moved = true;
  const t = S.tiles[dest];
  if (!flies(u)) {
    if (!u.boat && isWater(t.t) && t.imp === 'dock') { u.boat = has(u.owner, 'canoes') ? 'canoe' : 'raft'; u.attacked = true; }
    else if (u.boat && !isWater(t.t)) { u.boat = null; u.attacked = true; }
  }
  checkChallenge(u);
  if (isHuman(u.owner)) vision();
}

async function doAttack(a, d) {
  if (!a.boat && UNITS[a.type].convert) return doConvert(a, d);
  const r = combat(a, d);
  await FX.attack(a, d, r);
  d.hp -= r.dmg;
  FX.float(d.x, d.y, '−' + r.dmg, '#ff5a4e');
  const sa = st(a);
  if (d.hp <= 0) {
    killUnit(d, a.owner);
    a.kills++;
    if (a.kills >= 3 && !a.vet) { a.vet = true; a.hp = maxHp(a); FX.float(a.x, a.y, 'Veteran!', '#ffd24a'); }
    const di = I(d.x, d.y);
    if (sa.rng === 1 && !unitAt(d.x, d.y) && canStand(a, di) && !(a.boat && !isWater(S.tiles[di].t)) && (!isHuman(a.owner) || seen(di))) {
      await FX.move(a, [di]);
      a.x = d.x; a.y = d.y;
      checkChallenge(a);
      if (isHuman(a.owner)) vision();
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
async function doConvert(a, d) {
  await FX.attack(a, d, null);
  const old = d.owner;
  d.owner = a.owner; d.home = -1; d.moved = d.attacked = true;
  // a wader swayed to a tribe that cannot wade takes to a raft rather than drown
  if (!d.boat && !canStand(d, I(d.x, d.y))) d.boat = has(d.owner, 'canoes') ? 'canoe' : 'raft';
  a.moved = a.attacked = true;
  S.players[a.owner].converts++;
  S.players[old].lost++;
  FX.float(d.x, d.y, 'Swayed!', '#b89cff');
  if (isHuman(a.owner) || isHuman(old)) FX.say(`A ${UNITS[d.type].name} has flipped to the ${tribeOf(a.owner).name}!`, a.owner);
  if (isHuman(a.owner)) vision();
  return { converted: true };
}
function killUnit(u, by) {
  const k = S.units.indexOf(u);
  if (k >= 0) S.units.splice(k, 1);
  S.players[u.owner].lost++;
  if (by != null && by >= 0) S.players[by].kills++;
}
function canHeal(u) {
  if (u.boat || !UNITS[u.type].heal || u.attacked) return false;
  return S.units.some(v => v.owner === u.owner && v !== u && cheb(u.x, u.y, v.x, v.y) <= 1 && v.hp < maxHp(v));
}
function doHeal(u) {
  let k = 0;
  for (const v of S.units) {
    if (v.owner !== u.owner || v === u || cheb(u.x, u.y, v.x, v.y) > 1 || v.hp >= maxHp(v)) continue;
    const g = Math.min(4, maxHp(v) - v.hp);
    v.hp += g; k++;
    FX.float(v.x, v.y, '+' + g, '#6fe08f');
  }
  u.moved = u.attacked = true;
  return k;
}

function canCapture(u) {
  if (u.moved || u.attacked || u.boat) return false;
  const c = cityAtI(I(u.x, u.y));
  return !!c && c.owner !== u.owner && !atPeace(u.owner, c.owner);
}
function doCapture(u) {
  const c = cityAtI(I(u.x, u.y));
  const old = c.owner;
  // a hidden immunity idol cancels the capture and votes the raider off the island
  if (old >= 0 && S.players[old].idols > 0) {
    S.players[old].idols--;
    FX.float(c.x, c.y, 'Idol played!', '#ffd24a');
    FX.say(`The ${tribeOf(old).name} played a hidden immunity idol! ${c.name} is safe, and the raider is voted off the island.`, u.owner, c, true);
    logIt(`The ${tribeOf(old).name} played an idol to save ${c.name}`);
    killUnit(u, old);
    return 'idol';
  }
  c.owner = u.owner;
  if (old < 0) { c.level = 1; c.pop = 0; FX.say(`The ${tribeOf(u.owner).name} recruited the castaways of ${c.name}`, u.owner, c); }
  else {
    c.capital = false;
    for (const v of S.units) if (v.home === c.id && v.owner !== u.owner) v.home = -1;
    const w = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
    FX.say(`The ${tribeOf(u.owner).name} took ${c.name}${w ? ' and its ' + WONDERS[w].name : ''}!`, u.owner, c);
    logIt(`The ${tribeOf(u.owner).name} took ${c.name} from the ${TRIBES[S.players[old].tribe].name}`);
    if (w === 'lighthouse' && isHuman(u.owner)) S.explored.fill(1);
  }
  claim(c);
  u.moved = u.attacked = true;
  if (u.home < 0 || !S.cities[u.home] || S.cities[u.home].owner !== u.owner) u.home = c.id;
  if (isHuman(u.owner)) vision();
  checkElims();
}
function canRuin(u) { return !u.attacked && tileAt(u.x, u.y).ruin; }
// Salvage a shipwreck.
function doRuin(u) {
  const t = tileAt(u.x, u.y), p = u.owner, P = S.players[p];
  t.ruin = false;
  u.moved = u.attacked = true;
  const opts = ['stars', 'tech', 'unit', 'pop', 'idol'];
  if (isHuman(p)) opts.push('map');
  const kind = pick(opts);
  const avail = Object.keys(TECHS).filter(k => !has(p, k) && techReady(p, k));
  if (kind === 'idol') {
    P.idols++; FX.float(u.x, u.y, 'Idol!', '#ffd24a');
    return 'Wrapped in sailcloth in the wreck: a hidden immunity idol! It will save one of your camps from capture.';
  }
  if (kind === 'tech' && avail.length) {
    const k = avail.sort((a, b) => TECHS[a].tier - TECHS[b].tier)[0];
    P.techs[k] = true; FX.float(u.x, u.y, TECHS[k].name + '!', '#9fd8ff');
    return 'A survival manual in the wreck taught you ' + TECHS[k].name + '.';
  }
  if (kind === 'unit') {
    const spot = freeLandNear(u.x, u.y, p);
    if (spot) {
      addUnit('blade', p, spot[0], spot[1], -1);
      if (isHuman(p)) vision();
      return 'A sailor with an obsidian blade survived the wreck and joins your tribe.';
    }
  }
  if (kind === 'map') {
    reveal(u.x, u.y, 4);
    return 'A message in a bottle holds a map of the islands around.';
  }
  if (kind === 'pop') {
    const c = citiesOf(p).sort((a, b) => cheb(a.x, a.y, u.x, u.y) - cheb(b.x, b.y, u.x, u.y))[0];
    if (c) { addPop(c, 3); return 'Survivors of the wreck settle in ' + c.name + ' (+3 survivors).'; }
  }
  P.stars += 10; FX.float(u.x, u.y, '+10 ' + SH, '#ffd24a');
  return `The wreck's strongbox holds 10 ${SH}.`;
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
  const gain = Math.min(maxHp(u) - u.hp, ownerOfI(I(u.x, u.y)) === u.owner ? 4 : 2);
  u.hp += gain;
  u.moved = u.attacked = true;
  FX.float(u.x, u.y, '+' + gain, '#6fe08f');
}
// Why a unit cannot be trained here, or '' if it can.
function trainBlock(p, c, type) {
  const U = UNITS[type];
  if (c.owner !== p) return 'Not your camp';
  if (U.tech && !has(p, U.tech)) return 'Learn ' + TECHS[U.tech].name;
  if (unitAt(c.x, c.y)) return 'Move the unit off the camp first';
  if (homeCount(c) >= capacity(c)) return `Camp full (${homeCount(c)}/${capacity(c)})`;
  const short = U.cost - S.players[p].stars;
  if (short > 0) return `Need ${short} more ${SH}`;
  return '';
}
function canTrain(p, c, type) { return !trainBlock(p, c, type); }
function doTrain(p, c, type) {
  S.players[p].stars -= UNITS[type].cost;
  const u = addUnit(type, p, c.x, c.y, c.id);
  if (hasWonder(p, 'throne')) { u.vet = true; u.hp = maxHp(u); }
  return u;
}
function doResearch(p, t) {
  S.players[p].stars -= techCost(p, t);
  S.players[p].techs[t] = true;
  if (t === 'canoes') for (const u of S.units) if (u.owner === p && u.boat) u.boat = 'canoe';
}
// Why this work cannot be done here, or '' if it can.
function workBlock(p, i, key) {
  const t = S.tiles[i], W = WORKS[key];
  if (!W.ok(t) || t.cityHere >= 0) return 'Not possible here';
  if (ownerOfI(i) !== p) return 'Only inside your borders';
  if (!has(p, W.tech)) return 'Learn ' + TECHS[W.tech].name;
  const e = unitAt(...XY(i));
  if (e && e.owner !== p) return 'An enemy is standing on it';
  const short = workCost(p, key) - S.players[p].stars;
  if (short > 0) return `Need ${short} more ${SH}`;
  return '';
}
function canWork(p, i, key) { return !workBlock(p, i, key); }
function doWork(p, i, key) {
  const t = S.tiles[i], W = WORKS[key], P = S.players[p];
  P.stars -= workCost(p, key);
  if (key === 'coconut' || key === 'boar' || key === 'fish') t.res = null;
  else if (key === 'garden' || key === 'quarry') { t.res = null; t.imp = key; }
  else if (key === 'hut' || key === 'dock' || key === 'post' || key === 'signal') t.imp = key;
  else if (key === 'trail') t.road = true;
  else if (key === 'burn') { t.t = FIELD; t.res = null; P.stars += W.gain; }
  const [x, y] = XY(i);
  if (W.pop) { FX.float(x, y, '+' + W.pop + ' survivor' + (W.pop > 1 ? 's' : ''), '#bff38a'); addPop(S.cities[t.city], W.pop); }
  if (W.gain) FX.float(x, y, '+' + W.gain + ' ' + SH, '#ffd24a');
  if (key === 'signal' && isHuman(p)) reveal(x, y, 3);
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
    if (spot) addUnit('titan', c.owner, spot[0], spot[1], c.id); else P.stars += 5;
  } else if (key === 'explorer') {
    let x = c.x, y = c.y;
    for (let k = 0; k < 24; k++) {
      const opts = nbrs(x, y);
      const fresh = opts.filter(([nx, ny]) => !seen(I(nx, ny)));
      [x, y] = fresh.length && Math.random() < .8 ? pick(fresh) : pick(opts);
      reveal(x, y, 1);
    }
  }
}
function wonderBlock(p, c, key) {
  const Wd = WONDERS[key];
  if (S.wonders[key] != null) return 'Already raised in ' + S.cities[S.wonders[key]].name;
  if (!has(p, Wd.tech)) return 'Learn ' + TECHS[Wd.tech].name;
  if (Object.values(S.wonders).includes(c.id)) return 'This camp already has a landmark';
  const short = Wd.cost - S.players[p].stars;
  if (short > 0) return `Need ${short} more ${SH}`;
  return '';
}
function doWonder(p, c, key) {
  S.players[p].stars -= WONDERS[key].cost;
  S.wonders[key] = c.id;
  if (key === 'lighthouse' && isHuman(p)) S.explored.fill(1);
  FX.say(`The ${tribeOf(p).name} raised the ${WONDERS[key].name} in ${c.name}`, p);
  logIt(`The ${tribeOf(p).name} raised the ${WONDERS[key].name} in ${c.name}`);
}

// ---------- the island ----------
function worldEvent() {
  const key = pick(Object.keys(EVENTS));
  if (key === 'rain') for (const c of S.cities) if (c.owner >= 0) addPop(c, 1);
  else if (key === 'drop') for (const P of S.players) if (P.alive) P.stars += 3;
  else if (key === 'storm') for (const u of S.units) u.hp = Math.max(1, u.hp - (atSea(u) ? 3 : 1));
  else if (key === 'washed') {
    let k = 0;
    for (const i of shuffle([...S.tiles.keys()])) { if (k >= 2) break; if (placeVillage(i)) k++; }
  } else if (key === 'stampede') {
    for (const t of S.tiles) if (t.t === FOREST && !t.res && !t.imp && t.cityHere < 0 && Math.random() < .35) t.res = 'boar';
  } else if (key === 'eruption') {
    const [vx, vy] = XY(S.volcano);
    for (const u of S.units) if (cheb(u.x, u.y, vx, vy) <= 2) u.hp = Math.max(1, u.hp - 4);
    for (const [nx, ny] of nbrs(vx, vy)) { const t = tileAt(nx, ny); if (t.t === MOUNTAIN && !t.imp && !t.res) t.res = 'obsidian'; }
    if (!seen(S.volcano)) reveal(vx, vy, 1);
  } else if (key === 'moon') {
    const dark = [...S.tiles.keys()].filter(i => !seen(i));
    if (dark.length) { const [x, y] = XY(pick(dark)); reveal(x, y, 3); }
  }
  S.event = { key, turn: S.turn };
  logIt(EVENTS[key].name + ': ' + EVENTS[key].desc);
}
// A flag goes up somewhere fair: about as far from every tribe's camps.
function spawnChallenge() {
  const cand = [];
  const alive = S.players.filter(P => P.alive && citiesOf(P.id).length);
  for (let i = 0; i < S.tiles.length; i++) {
    const t = S.tiles[i];
    if (isWater(t.t) || t.cityHere >= 0 || t.ruin || t.volcano || unitAt(...XY(i))) continue;
    const [x, y] = XY(i);
    const per = alive.map(P => Math.min(...citiesOf(P.id).map(c => cheb(c.x, c.y, x, y))));
    if (!per.length || Math.min(...per) < 2) continue;
    cand.push({ i, spread: Math.max(...per) - Math.min(...per) + Math.random() });
  }
  if (!cand.length) return;
  cand.sort((a, b) => a.spread - b.spread);
  const c = pick(cand.slice(0, 4));
  S.challenge = { i: c.i, kind: Math.random() < .5 ? 'reward' : 'immunity', until: S.turn + 6, turn: S.turn, seen: false };
  S.explored[c.i] = 1;
  logIt(`${CHALLENGES[S.challenge.kind].name} announced`);
}
// Called once each time the turn counter moves on.
function beginRound() {
  if (S.challenge && S.turn > S.challenge.until) {
    logIt(`Nobody reached the ${CHALLENGES[S.challenge.kind].name.toLowerCase()} in time`);
    S.challenge = null; S.nextChallenge = S.turn + 4 + rnd(3);
  }
  if (!S.challenge && S.turn >= S.nextChallenge) spawnChallenge();
  else if (S.turn >= S.nextEvent) { worldEvent(); S.nextEvent = S.turn + 5 + rnd(4); }
}
function startTurn(p) {
  const P = S.players[p];
  if (S.turn > 1) P.stars += income(p);          // nobody earns on the first turn
  const spring = hasWonder(p, 'spring');
  for (const u of S.units) if (u.owner === p) {
    u.moved = false; u.attacked = false;
    if (spring && u.hp < maxHp(u)) u.hp = Math.min(maxHp(u), u.hp + 2);
  }
}
function checkElims() {
  for (const P of S.players) {
    if (!P.alive) continue;
    if (!S.cities.some(c => c.owner === P.id)) {
      P.alive = false;
      S.units = S.units.filter(u => u.owner !== P.id);
      FX.say(`The ${TRIBES[P.tribe].name} tribe has been voted off the islands.`, P.id, null, true);
      logIt(`The ${TRIBES[P.tribe].name} tribe is out`);
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
function goalField(p, goals, fly) {
  const N = S.n * S.n, dist = new Array(N).fill(1e9), src = new Array(N).fill(-1), q = [];
  const wade = tribeIs(p, 1);
  for (const g of goals) if (dist[g] > 0) { dist[g] = 0; src[g] = g; q.push(g); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], [x, y] = XY(i);
    for (const [nx, ny] of nbrs(x, y)) {
      const j = I(nx, ny);
      if (dist[j] <= dist[i] + 1) continue;
      const t = S.tiles[j];
      if (!fly) {
        if (t.t === OCEAN || (t.t === SHALLOW && !wade)) continue;
        if (t.t === MOUNTAIN && !has(p, 'climbing')) continue;
      }
      dist[j] = dist[i] + 1; src[j] = src[i]; q.push(j);
    }
  }
  return { dist, src };
}
function techUseful(p, t) {
  const inLand = f => S.tiles.some((tt, i) => ownerOfI(i) === p && f(tt));
  switch (t) {
    case 'forage': return inLand(tt => tt.res === 'coconut' || tt.res === 'taro');
    case 'gardening': return inLand(tt => tt.res === 'taro');
    case 'tracking': return inLand(tt => tt.res === 'boar' || tt.t === FOREST);
    case 'weaving': return inLand(tt => tt.t === FOREST && !tt.res);
    case 'fishing': return inLand(tt => tt.res === 'fish');
    case 'climbing': case 'fire': return inLand(tt => tt.t === MOUNTAIN);
    case 'quarrying': return inLand(tt => tt.res === 'obsidian');
    case 'trading': return inLand(tt => POST_FEEDERS.includes(tt.imp));
    case 'trails': case 'rafting': case 'canoes': return false;
    default: return S.turn > 3;
  }
}
function aiResearch(p, reserve) {
  const P = S.players[p];
  const order = ['forage', 'tracking', 'gardening', 'sprinting', 'climbing', 'quarrying', 'slings', 'fishing', 'shells',
    'weaving', 'obsidian', 'fire', 'alliances', 'trails', 'boars', 'gliding', 'medicine', 'catapult', 'rafting', 'trading'];
  const useful = t => techUseful(p, t) || Object.keys(TECHS).some(k => TECHS[k].needs.includes(t) && !has(p, k) && techUseful(p, k));
  for (const t of order) {
    if (has(p, t) || !techReady(p, t) || !useful(t)) continue;
    if (P.stars - techCost(p, t) >= reserve) { doResearch(p, t); return true; }
    return false;
  }
  return false;
}
function aiEconomy(p, reserve) {
  const P = S.players[p];
  for (let guard = 0; guard < 40; guard++) {
    let best = null, bv = -1;
    for (let i = 0; i < S.tiles.length; i++) {
      if (ownerOfI(i) !== p) continue;
      for (const key of ['coconut', 'boar', 'fish', 'garden', 'quarry', 'hut', 'post', 'signal']) {
        if (!canWork(p, i, key)) continue;
        const W = WORKS[key], cost = workCost(p, key);
        if (P.stars - cost < reserve) continue;
        let v;
        if (key === 'post') { const m = postValue(i); if (m < 2) continue; v = m / 5; }
        else if (key === 'signal') v = .22;
        else {
          const c = S.cities[S.tiles[i].city];
          v = W.pop / cost + (c.pop + W.pop >= c.level + 1 ? .6 : 0);
        }
        v += Math.random() * .05;
        if (v > bv) { bv = v; best = [i, key]; }
      }
    }
    if (!best) return;
    doWork(p, best[0], best[1]);
  }
}
function aiWonder(p) {
  const P = S.players[p];
  if (S.turn < 8 || Math.random() < .5) return;
  for (const key of shuffle(Object.keys(WONDERS))) {
    for (const c of citiesOf(p)) {
      if (wonderBlock(p, c, key) || P.stars < WONDERS[key].cost + 3) continue;
      doWonder(p, c, key);
      return;
    }
  }
}
function aiPickUnit(p, threat) {
  const P = S.players[p];
  const w = { scrapper: 3, runner: 4, slinger: 3, shieldbearer: threat ? 5 : 1, healer: threat ? 1 : 0, schemer: threat ? 2 : .5,
    blade: 6, glider: 4, catapult: threat ? 3 : 1, boarrider: 6 };
  const avail = TRAINABLE.filter(k => (!UNITS[k].tech || has(p, UNITS[k].tech)) && UNITS[k].cost <= P.stars && w[k] > 0);
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
    const k = aiPickUnit(p, enemyNear(c.x, c.y, p, 4));
    if (!k || !canTrain(p, c, k)) continue;
    doTrain(p, c, k); made++;
  }
  return made;
}
async function aiAttack(u) {
  for (let guard = 0; guard < 4; guard++) {
    if (!S.units.includes(u)) return;
    let best = null, bs = 0;
    const conv = !u.boat && UNITS[u.type].convert;
    for (const e of targets(u)) {
      let s;
      if (conv) s = UNITS[e.type].cost + e.hp / 3;
      else {
        const r = combat(u, e);
        s = r.dmg + (r.killed ? 5 + UNITS[e.type].cost : 0) - r.ret * 1.1 - (r.ret >= u.hp ? 40 : 0);
        const c = cityAtI(I(e.x, e.y));
        if (c && c.owner === u.owner) s += 4;
        else if (c && r.ret < u.hp) {
          // a garrison never falls to one attacker: gang up, as a player would
          const friends = S.units.filter(v => v.owner === u.owner && v !== u && cheb(v.x, v.y, e.x, e.y) <= 1).length;
          s += S.diff === 'easy' ? 1 + friends * 1.5 : 2 + friends * 2.5;
        }
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
  if (canHeal(u)) { doHeal(u); return; }
  if (u.hp < maxHp(u) * .45 && canRecover(u) && !enemyNear(u.x, u.y, p)) { doRecover(u); return; }
  await aiAttack(u);
  if (!S.units.includes(u) || u.moved || u.boat) return;
  const here = I(u.x, u.y), hc = cityAtI(here);
  if (hc && hc.owner !== p && !atPeace(p, hc.owner)) return;       // hold it and capture next turn
  if (hc && hc.owner === p && enemyNear(u.x, u.y, p, 2)) return;   // garrison
  const goals = [];
  if (UNITS[u.type].heal) {
    for (const v of S.units) if (v.owner === p && v !== u && v.hp < maxHp(v)) goals.push(I(v.x, v.y));
  } else {
    for (const c of S.cities) {
      const gi = I(c.x, c.y);
      if (claimed.has(gi) || atPeace(p, c.owner)) continue;
      if (c.owner !== p) goals.push(gi);
      else if (!unitAt(c.x, c.y) && enemyNear(c.x, c.y, p, 3)) goals.push(gi);
    }
    for (let i = 0; i < S.tiles.length; i++) if (S.tiles[i].ruin && !claimed.has(i) && !isWater(S.tiles[i].t)) goals.push(i);
    if (S.challenge && !claimed.has(S.challenge.i)) goals.push(S.challenge.i);
    for (const e of S.units) if (hostile(p, e.owner)) goals.push(I(e.x, e.y));
  }
  const { dist, src } = goalField(p, goals, flies(u));
  const { dests, prev } = moveInfo(u);
  let best = here, bd = dist[here];
  for (const d of dests) {
    const t = S.tiles[d];
    if (!canStand(u, d)) continue;
    let v = dist[d];
    if (S.challenge && d === S.challenge.i) v -= 3;
    if ((t.t === FOREST && (has(p, 'slings') || tribeIs(p, 3))) || (t.t === MOUNTAIN && has(p, 'climbing'))) v -= .2;
    if (S.diff === 'easy') v += Math.random() * 1.5;
    if (v < bd) { bd = v; best = d; }
  }
  if (best !== here) {
    if (src[best] >= 0 && dist[best] <= 4) claimed.add(src[best]);
    await doMove(u, best, prev);
    await FX.pause(u);
    const bc = cityAtI(best);
    if (bc && bc.owner !== p) claimed.add(best);
    if (canHeal(u)) { doHeal(u); return; }
    await aiAttack(u);
  } else if (canRecover(u)) doRecover(u);
}
function aiDiplomacy(p) {
  if (S.offer || !S.players[0].alive || atPeace(p, 0) || S.turn < 6) return;
  const theirs = citiesOf(p), near = theirs.some(c => S.units.some(e => e.owner === 0 && cheb(c.x, c.y, e.x, e.y) <= 3));
  if (near && strength(p) < strength(0) * .6 && Math.random() < .25) {
    const gift = Math.min(S.players[p].stars, 2 + theirs.length * 2);
    S.offer = { from: p, gift, turns: 6 };
  }
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
  aiWonder(p);
  const claimed = new Set();
  const list = unitsOf(p).sort((a, b) => (canCapture(b) ? 1 : 0) - (canCapture(a) ? 1 : 0));
  for (const u of list) {
    await aiUnit(u, claimed);
    if (S.over) return;
  }
  if (P.stars >= 6) aiTrain(p, 2);
  aiDiplomacy(p);
}

// ---------- saving ----------
function saveGame() {
  if (!S || S.demo) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { }
}
// Games saved before the islands (v1, v2) used different units and skills, so they cannot be resumed.
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.v === 3 && Array.isArray(s.tiles) ? s : null;
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }
