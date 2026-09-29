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

// Island biomes: how a stretch of land looks and what grows there. Tribes wash up in one.
const BIOMES = {
  palms:  { field: '#9DCF62', forest: '#3F9A55', mountain: '#857C77', tree: 'palm' },
  banana: { field: '#8FD08A', forest: '#2E8F6A', mountain: '#7E8288', tree: 'banana' },
  basalt: { field: '#B4C865', forest: '#5A8F3A', mountain: '#5E5A62', tree: 'bamboo' },
  jungle: { field: '#7FBF63', forest: '#23704A', mountain: '#7B7E86', tree: 'jungle' },
};
const LAND = {
  even:   { land: { forest: .24, mountain: .14 }, res: { coconut: .32, taro: .2, boar: .35, obsidian: .35 } },
  jungle: { land: { forest: .44, mountain: .13 }, res: { coconut: .22, taro: .15, boar: .5, obsidian: .35 } },
  rocky:  { land: { forest: .18, mountain: .32 }, res: { coconut: .26, taro: .16, boar: .3, obsidian: .6 } },
  lush:   { land: { forest: .2, mountain: .1 }, res: { coconut: .4, taro: .3, boar: .3, obsidian: .3 } },
};
const NAME_SYL = ['ta', 'lo', 'ki', 'ma', 'ri', 'nu', 'va', 'se', 'ho', 'la', 'mo', 'ne'];

/* The tribes. Each is a story about castaways, and each bends the rules the way
   its story would: the tech it can or cannot learn, how it grows, what a kill
   or a coconut is worth. Quotes are only taken from works long out of copyright;
   the rest are allusions in our own words.                                      */
const TRIBES = [
  { key: 'flight', name: 'Flight 815', color: '#2E86C1', skin: '#E9C39E', tech: 'fishing', start: 'scrapper', hat: 'cap', biome: 'palms', ground: 'even',
    source: 'after Lost (2004–2010)',
    blurb: 'Survivors of a flight that never landed. A string of numbers keeps coming back.',
    trait: { name: 'The Numbers', icon: '🔢', desc: 'On days 4, 8, 15, 16, 23 and 42 your tribe learns its cheapest available skill for free. The wreck of the plane lies beside your first camp.' },
    question: 'If it was always going to happen, did you choose it?',
    ending: 'The numbers came up on schedule. Whether they meant anything is a question the island never answers — only whether you were counting.',
    camps: ['Fuselage', 'Tail Section', 'Swan', 'Pearl', 'Barracks', 'Hydra', 'Flame', 'Arrow', 'Orchid', 'Looking Glass'] },
  { key: 'conch', name: 'The Conch', color: '#E3A92A', skin: '#F2D3B3', tech: 'fire', start: 'scrapper', hat: 'school', biome: 'palms', ground: 'lush',
    source: 'after Lord of the Flies (William Golding, 1954)',
    blurb: 'Schoolboys who hold assemblies, keep a signal fire and still believe in rules.',
    trait: { name: 'Keep the fire going', icon: '🔥', desc: 'Every signal fire you tend makes skills 1 🐚 cheaper (up to 3). Your tribe will not forge Obsidian blades.' },
    question: 'Do rules survive when nobody grown-up is watching?',
    ending: 'Golding’s boys were rescued by a naval officer who was himself at war. Order held here — but look at what it took to hold it.',
    camps: ['Assembly', 'Platform', 'Bathing Pool', 'Signal Hill', 'The Scar', 'Shelters', 'Conch Rock', 'Fruit Trees'] },
  { key: 'choir', name: 'The Choir', color: '#B83227', skin: '#EDC7A5', tech: 'tracking', start: 'scrapper', hat: 'paint', biome: 'jungle', ground: 'jungle',
    source: 'after Lord of the Flies (William Golding, 1954)',
    blurb: 'They were a choir once. Now they paint their faces and hunt.',
    trait: { name: 'Kill the pig', icon: '🎨', desc: 'Every kill feeds the tribe: +1 survivor in your nearest camp. Jungle never slows you. Your tribe never learns Alliances.' },
    question: 'When the paint goes on, who is still underneath it?',
    ending: 'The hunt only ends in the book when someone bigger arrives — and they are hunting too. You were the someone bigger here.',
    camps: ['Castle Rock', 'Hunting Ground', 'Pig Run', 'Painted Rock', 'Choir Stalls', 'Drum Hollow', 'Thicket', 'The Offering'] },
  { key: 'crusoe', name: 'The Crusoes', color: '#9C7A5B', skin: '#E7BE96', tech: 'forage', start: 'scrapper', hat: 'fur', biome: 'banana', ground: 'even',
    source: 'after Robinson Crusoe (Daniel Defoe, 1719)',
    blurb: 'One castaway, a salvaged knife and a post he notches every day.',
    trait: { name: 'Notches on a post', icon: '📅', desc: 'Patience pays: +1 🐚 a day for every 10 days you survive. Shipwrecks you salvage give double shells.' },
    question: 'Crusoe called the island his kingdom. Whose island was it before he came?',
    ending: '“I was lord of the whole manor,” Crusoe wrote. Twenty-eight years of notches — and still he never asked who else had called it home.',
    camps: ['The Castle', 'Bower', 'Goat Pen', 'Calendar Post', 'The Cave', 'Wreck Point', 'Parrot Hill', 'Harvest Field'] },
  { key: 'lifeboat', name: 'The Lifeboat', color: '#E6792B', skin: '#C98E60', tech: 'fishing', start: 'tiger', hat: 'sun', biome: 'banana', ground: 'lush',
    source: 'after Life of Pi (Yann Martel, 2001)',
    blurb: 'Two hundred and twenty-seven days adrift, with a tiger aboard.',
    trait: { name: 'The tiger in the boat', icon: '🐯', desc: 'You start with the tiger, a fearsome hero instead of a Scrapper, who eats 1 🐚 a day. Your units wade through lagoons.' },
    question: 'Two stories, the same ending. Which one would you rather believe?',
    ending: 'Somewhere between the two stories is what really happened. You chose which one to live in; most survivors do.',
    camps: ['The Raft', 'Tarpaulin', 'Algae Island', 'Meerkat Bay', 'The Stern', 'Oar Point', 'Turtle Rock', 'Flying Fish'] },
  { key: 'minnow', name: 'The Minnow', color: '#18A0B0', skin: '#EFC9A8', tech: 'forage', start: 'scrapper', hat: 'sailor', biome: 'palms', ground: 'lush',
    source: 'after Gilligan’s Island (1964–1967)',
    blurb: 'Seven passengers from a three-hour tour. The Professor can build anything except a boat.',
    trait: { name: 'A three-hour tour', icon: '📻', desc: 'Every coconut you crack also pays 1 🐚 (the Professor rigs a radio from it). But your tribe can never learn Rafting.' },
    question: 'If rescue came tomorrow, would you really want to go?',
    ending: 'Ninety-eight episodes and nobody got off the island. Maybe the island was never the problem.',
    camps: ['Hut Row', 'The Lagoon', 'Radio Shack', 'Supply Trunk', 'Coconut Grove', 'Skipper’s Point', 'Bamboo Bay', 'The Cove'] },
  { key: 'beach', name: 'The Beach', color: '#E0679A', skin: '#F0C9A6', tech: 'forage', start: 'scrapper', hat: 'flower', biome: 'jungle', ground: 'lush',
    source: 'after The Beach (Alex Garland, 1996)',
    blurb: 'Travellers guarding a hidden paradise that only stays paradise while it stays secret.',
    trait: { name: 'Never tell anyone', icon: '🤫', desc: 'Rival tribes do not come for your camps unless one of their units is within 2 tiles. Isolation costs you: every skill is 1 🐚 dearer.' },
    question: 'What would you give up to keep a paradise to yourself?',
    ending: 'The secret held, and so did the paradise. Garland’s travellers learned what it cost them to keep it that way.',
    camps: ['The Lagoon', 'Longhouse', 'Waterfall', 'Rice Field', 'Cliff Dive', 'Hammocks', 'Map Rock', 'Hidden Cove'] },
  { key: 'moreau', name: 'Moreau’s Beasts', color: '#7A3E9D', skin: '#B08A6A', tech: 'tracking', start: 'scrapper', hat: 'ears', biome: 'jungle', ground: 'jungle',
    source: 'after The Island of Doctor Moreau (H. G. Wells, 1896)',
    blurb: '“Are we not Men?” Beasts taught to walk upright and to recite the Law.',
    trait: { name: 'The House of Pain', icon: '🐗', desc: 'Hunting a boar does not feed a camp — it gives you a Beast-folk warrior instead (attack 3, moves 2). Your camps must grow from other food.' },
    question: 'Where does the animal end and the person begin?',
    ending: 'Wells ended with his narrator back in London, unable to stop seeing the beast in every face. What did winning make of your tribe?',
    camps: ['House of Pain', 'The Enclosure', 'Ravine', 'The Lair', 'Hut of the Law', 'Kennel', 'Hollow', 'Stockade'] },
  { key: 'engineers', name: 'The Engineers', color: '#5F7D8C', skin: '#EBC7A3', tech: 'climbing', start: 'scrapper', hat: 'goggles', biome: 'basalt', ground: 'rocky',
    source: 'after The Mysterious Island (Jules Verne, 1875)',
    blurb: 'Five balloonists who fell from the sky and rebuilt civilisation from nothing.',
    trait: { name: 'Granite House', icon: '⚙️', desc: 'Skills never get dearer as your tribe grows. Cliffs never stop your units.' },
    question: 'Is progress something you carry with you, or something you find?',
    ending: 'Verne’s engineers built a whole world out of a matchstick and a watch-glass. And yet: they had help they never knew about.',
    camps: ['Granite House', 'The Chimneys', 'Forge', 'Kiln', 'Lake Grant', 'Balloon Harbour', 'The Mill', 'Signal Point'] },
  { key: 'prospero', name: 'Prospero’s Court', color: '#4A56B8', skin: '#EFD2B6', tech: 'fire', start: 'scrapper', hat: 'wizard', biome: 'banana', ground: 'even',
    source: 'after The Tempest (William Shakespeare, 1611)',
    blurb: '“We are such stuff as dreams are made on.” A magician who commands the weather.',
    trait: { name: 'Master of the tempest', icon: '🌀', desc: 'The island’s storms, fevers and eruptions never touch your units, and its gifts come to you twice over.' },
    question: 'Prospero drowns his books at the end. What power would you be willing to give up?',
    ending: '“Now my charms are all o’erthrown.” Prospero set his servants free before he sailed. Will you?',
    camps: ['The Cell', 'Sycorax Grove', 'Ariel’s Pine', 'The Masque', 'Cave of Books', 'Tempest Point', 'Lime Grove', 'Caliban’s Rock'] },
  { key: 'pirates', name: 'The Hispaniola', color: '#2F3A40', skin: '#D9A77E', tech: 'fishing', start: 'scrapper', hat: 'tricorn', biome: 'basalt', ground: 'rocky',
    source: 'after Treasure Island (Robert Louis Stevenson, 1883)',
    blurb: '“Pieces of eight!” Buccaneers who came for treasure, not to settle.',
    trait: { name: 'Pieces of eight', icon: '🏴‍☠️', desc: 'Every kill pays 2 🐚 and every camp you take pays 5 🐚. Pirates do not trade: no trading posts.' },
    question: 'Is it treasure if someone else had to lose it?',
    ending: 'Stevenson’s treasure was never all dug up; “the bar silver and the arms still lie where Flint buried them.” Some of it is here.',
    camps: ['The Stockade', 'Spyglass Hill', 'Skeleton Island', 'Admiral Benbow', 'Rum Cove', 'Black Spot', 'Doubloon Bay', 'Mizzen Point'] },
  { key: 'lilliput', name: 'Lilliput', color: '#3E9B47', skin: '#F2D3B3', tech: 'forage', start: 'scrapper', hat: 'tiny', biome: 'palms', ground: 'even',
    source: 'after Gulliver’s Travels (Jonathan Swift, 1726)',
    blurb: 'People six inches tall, who do everything in great numbers.',
    trait: { name: 'Many hands', icon: '🔍', desc: 'Units cost 1 🐚 less and every camp supports one more of them, but each unit has 3 fewer HP.' },
    question: 'Which end of the egg do you break — and would you go to war over it?',
    ending: 'Swift’s little people went to war over which end to crack an egg. Look back at why your tribe fought.',
    camps: ['Mildendo', 'Blefuscu', 'Egg Hall', 'Little End', 'Big End', 'Tramecksan', 'Slamecksan', 'Flimnap'] },
  { key: 'blindside', name: 'The Blindsiders', color: '#0E9FC0', skin: '#E3B48C', tech: 'fire', start: 'scrapper', hat: 'buff', biome: 'jungle', ground: 'even',
    source: 'after island reality-TV contests (2000–)',
    blurb: 'Contestants who came to win a game. Alliances are tools; idols are everything.',
    trait: { name: 'Idol hunters', icon: '🗿', desc: 'You wash ashore holding an idol, and every shipwreck you salvage hides another. Schemers cost you just 2 🐚.' },
    question: 'Is it betrayal if everyone agreed to play the game?',
    ending: 'The tribe has spoken. Somewhere a jury of everyone you blindsided is deciding whether you played well, or just played them.',
    camps: ['Tribal Council', 'Ponderosa', 'Exile Island', 'Loved Ones', 'Final Four', 'Jury Villa', 'Idol Hollow', 'Fire Pit'] },
];
TRIBES.forEach(T => { T.pal = BIOMES[T.biome]; Object.assign(T, LAND[T.ground]); });
const TRIBE_KEYS = TRIBES.map(T => T.key);

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
  tiger:        { name: 'The Tiger',        icon: '🐯', cost: 0, hp: 18, atk: 3.5, def: 2, mv: 1, rng: 1, tech: '-',         dash: 1 },
  beast:        { name: 'Beast-folk',       icon: '🐺', cost: 0, hp: 10, atk: 3,   def: 1, mv: 2, rng: 1, tech: '-',         dash: 1 },
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
const tribeIs = (p, k) => TRIBES[S.players[p].tribe].key === k;
const citiesOf = p => S.cities.filter(c => c.owner === p);
const unitsOf = p => S.units.filter(u => u.owner === p);
const isHuman = p => S.players[p].human;

function st(u) { return u.boat ? BOATS[u.boat] : UNITS[u.type]; }
function maxHp(u) { return UNITS[u.type].hp + (u.vet ? 5 : 0) - (tribeIs(u.owner, 'lilliput') ? 3 : 0); }
function unitName(u) { return u.boat ? BOATS[u.boat].name + ' (' + UNITS[u.type].name + ')' : UNITS[u.type].name; }
const mvOf = u => st(u).mv;
const flies = u => !u.boat && !!UNITS[u.type].fly;
const wades = u => !u.boat && !flies(u) && tribeIs(u.owner, 'lifeboat');
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
function makeTruce(a, b, turns) { S.truce[peaceKey(a, b)] = S.turn + turns; regard(a, b, 2); regard(b, a, 2); }

// ---------- regard: how each tribe feels about each other tribe ----------
// It decides the Final Tribal Council, so the way you win counts, not just whether.
function regard(judge, judged, d) {
  if (judge === judged || judge < 0 || judged < 0) return;
  S.regard[judge][judged] = clamp(S.regard[judge][judged] + d, -20, 20);
}
function regardAll(judged, d) { for (const P of S.players) regard(P.id, judged, d); }
const regardWord = v => v >= 6 ? 'admires you' : v >= 2 ? 'likes you' : v > -2 ? 'is wary of you' : v > -6 ? 'resents you' : 'despises you';

// Short-lived strengths and weaknesses that story choices leave behind.
function modV(p, kind) { return (S.players[p].mods || []).reduce((s, m) => s + (m.kind === kind && m.until >= S.turn ? m.v : 0), 0); }
function addMod(p, kind, v, turns) { S.players[p].mods.push({ kind, v, until: S.turn + turns - 1 }); }

// ---------- economy ----------
const signalFires = p => S.tiles.reduce((k, t, i) => k + (t.imp === 'signal' && ownerOfI(i) === p ? 1 : 0), 0);
function techCost(p, t) {
  const camps = tribeIs(p, 'engineers') ? 1 : Math.max(1, citiesOf(p).length);   // Granite House: never dearer
  let c = TECHS[t].tier * camps + 4;
  if (tribeIs(p, 'conch')) c -= Math.min(3, signalFires(p));
  if (tribeIs(p, 'beach')) c += 1;
  return Math.max(1, c);
}
// Skills a tribe's story rules out for good.
const FORBIDDEN = { conch: ['obsidian'], choir: ['alliances'], minnow: ['rafting', 'canoes', 'trading'] };
function techForbidden(p, t) { return (FORBIDDEN[TRIBES[S.players[p].tribe].key] || []).includes(t); }
function canResearch(p, t) { return !has(p, t) && !techForbidden(p, t) && techReady(p, t) && S.players[p].stars >= techCost(p, t); }
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
  if (tribeIs(p, 'crusoe') && S.turn >= 10) parts.push({ label: 'Notches on the post', why: Math.floor(S.turn / 10) * 10 + ' days survived', v: Math.floor(S.turn / 10) });
  const sm = modV(p, 'income');
  if (sm) parts.push({ label: 'Story', why: 'your recent choices', v: sm });
  if (!isHuman(p) && S.diff === 'hard') parts.push({ label: 'Hard mode', why: 'computer bonus', v: 2 });
  return parts;
}
function income(p) { return Math.max(0, incomeParts(p).reduce((s, x) => s + x.v, 0)); }
function homeCount(c) { let k = 0; for (const u of S.units) if (u.home === c.id) k++; return k; }
function capacity(c) { return c.level + 1 + (c.owner >= 0 && tribeIs(c.owner, 'lilliput') ? 1 : 0); }
function workCost(p, key) { return WORKS[key].cost; }
function trainCost(p, type) {
  let c = UNITS[type].cost;
  if (type === 'schemer' && tribeIs(p, 'blindside')) c = 2;
  if (tribeIs(p, 'lilliput')) c = Math.max(1, c - 1);
  return c;
}

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
  const fresh = TRIBES[tribe].camps.filter(n => !S.cities.some(c => c.name === n));
  if (fresh.length) return pick(fresh);
  for (let k = 0; k < 40; k++) {
    let s = pick(NAME_SYL) + pick(NAME_SYL) + (Math.random() < .4 ? pick(NAME_SYL) : '');
    s = s[0].toUpperCase() + s.slice(1);
    if (!S.cities.some(c => c.name === s)) return s;
  }
  return 'Camp ' + (S.cities.length + 1);
}

const MAP_SIZES = { small: 12, medium: 16, large: 20, huge: 24 };
function newGame(opts) {
  const n = MAP_SIZES[opts.size] || 16;
  const others = shuffle(TRIBES.map((_, k) => k).filter(t => t !== opts.tribe));
  const tribes = [opts.tribe, ...others.slice(0, clamp(opts.opponents, 1, 7))];
  S = {
    v: 5, n, turn: 1, cur: 0, diff: opts.diff, size: opts.size, over: null, nextId: 1,
    players: tribes.map((t, i) => ({ id: i, tribe: t, human: i === 0, stars: 5 + (i && opts.diff === 'hard' ? 3 : 0),
      techs: { [TRIBES[t].tech]: true }, alive: true, kills: 0, lost: 0, converts: 0, idols: TRIBES[t].key === 'blindside' ? 1 : 0, challenges: 0, asked: {}, mods: [], drowned: false, exposedUntil: 0 })),
    tiles: [], cities: [], units: [], explored: new Array(n * n).fill(0), pendingRewards: [],
    wonders: {}, truce: {}, nextEvent: 5 + rnd(3), event: null, offer: null, log: [],
    challenge: null, nextChallenge: 3 + rnd(3), volcano: -1,
    regard: tribes.map(() => tribes.map(() => 0)), rescue: null, rescueNews: null, council: null, overHow: null, winner: -1,
    story: { done: [], pending: null },
  };
  genMap(tribes);
  revealed = 0;
  vision();
  return S;
}

function placeCapitals(n, k) {
  const m = 2, cand = [];
  for (let y = m; y < n - m; y++) for (let x = m; x < n - m; x++) cand.push([x, y]);
  const chosen = [pick(cand)];
  while (chosen.length < k) {
    let best = null, bd = -1;
    for (const c of cand) {
      const d = Math.min(...chosen.map(o => cheb(o[0], o[1], c[0], c[1]))) + Math.random() * .9;
      if (d > bd) { bd = d; best = c; }
    }
    chosen.push(best);
  }
  return shuffle(chosen);
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
    const first = TRIBES[tribe].tech;
    const want = first === 'tracking' ? ['boar', 'boar', 'coconut'] : first === 'climbing' ? ['coconut', 'boar', 'obsidian']
      : first === 'fire' ? ['coconut', 'boar', 'cliff'] : ['coconut', 'coconut', 'boar'];
    want.forEach((r, k) => {
      const a = around[k]; if (!a) return;
      const tt = tileAt(a[0], a[1]);
      tt.t = r === 'boar' ? FOREST : r === 'obsidian' || r === 'cliff' ? MOUNTAIN : FIELD;
      tt.res = r === 'cliff' ? null : r;                 // a bare cliff, for a signal fire
    });
    if (first === 'fishing') {                          // fishing tribes always have fish in reach
      let w = nbrs(x, y).map(([nx, ny]) => I(nx, ny)).find(j => S.tiles[j].t === SHALLOW);
      if (w == null) {
        const spot = around[3] || around[0];
        if (spot) { w = I(spot[0], spot[1]); S.tiles[w].t = SHALLOW; S.tiles[w].res = null; }
      }
      if (w != null) S.tiles[w].res = 'fish';
    }
    if (TRIBES[tribe].key === 'flight') {               // the fuselage, still smoking
      const spot = around.find(([ax, ay]) => !tileAt(ax, ay).res) || around[around.length - 1];
      if (spot) { const tt = tileAt(spot[0], spot[1]); tt.ruin = true; tt.res = null; if (tt.t === MOUNTAIN) tt.t = FIELD; }
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
  const u = { id: S.nextId++, type, owner, x, y, hp: UNITS[type].hp - (tribeIs(owner, 'lilliput') ? 3 : 0), moved: true, attacked: true,
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
    return t.t === SHALLOW && tribeIs(p, 'lifeboat') ? { cost: 2, end: false } : null;
  }
  const cost = roadish(from) && roadish(to) ? 1 : 2;
  if (t.t === MOUNTAIN) return has(p, 'climbing') ? { cost, end: !tribeIs(p, 'engineers') } : null;
  if (t.t === FOREST) return { cost, end: !tribeIs(p, 'choir') };
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
  if (c && c.owner === u.owner) return S.rescue && S.rescue.city === c.id ? 1.5 : c.walls ? 4 : hasWonder(u.owner, 'totems') ? 2.5 : 1.5;   // a pyre can't hide behind walls
  if (u.boat || flies(u)) return 1;
  if (t.t === FOREST && has(u.owner, 'slings')) return 1.5;
  if (t.t === MOUNTAIN && has(u.owner, 'climbing')) return 1.5;
  return 1;
}
function combat(a, d) {
  const sa = st(a), sd = st(d);
  const atk = Math.max(0, sa.atk + (sa.atk ? modV(a.owner, 'atk') : 0)), def = Math.max(0, sd.def + modV(d.owner, 'def'));
  const aF = atk * a.hp / maxHp(a);
  const dF = def * d.hp / maxHp(d) * defBonus(d);
  const tot = aF + dF || 1;
  const dmg = Math.round(aF / tot * atk * 4.5);
  const killed = dmg >= d.hp;
  const inRange = cheb(a.x, a.y, d.x, d.y) <= sd.rng;
  const ret = killed || !inRange ? 0 : Math.round(dF / tot * def * 4.5);
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
// Whether a unit has anything it can really do now — not just a turn it has not spent.
// A unit that has moved "could still attack", but only counts if someone is in reach.
function canAct(u) {
  if (exhausted(u)) return false;
  if (canCapture(u) || canRuin(u) || canHeal(u) || canRecover(u)) return true;
  if (targets(u).length) return true;
  return !u.moved && moveInfo(u).dests.size > 0;
}
function unitStatus(u) {
  if (!canAct(u)) return exhausted(u) ? 'Done for this turn' : 'Nothing more it can do this turn';
  if (!u.moved && !u.attacked) return 'Ready: can move and act';
  if (u.moved) return 'Moved: a rival is in reach to attack';
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
  FX.say(`${tribeOf(u.owner).name} won the ${CHALLENGES[ch.kind].name.toLowerCase()}!`, u.owner, null, true);
  logIt(`${tribeOf(u.owner).name} won the ${CHALLENGES[ch.kind].name.toLowerCase()}`);
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
  regard(d.owner, a.owner, r.dmg >= d.hp ? -2 : -1);
  const sa = st(a);
  if (d.hp <= 0) {
    killUnit(d, a.owner);
    a.kills++;
    onKill(a.owner, d);
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
  regard(old, a.owner, -2);
  d.owner = a.owner; d.home = -1; d.moved = d.attacked = true;
  // a wader swayed to a tribe that cannot wade takes to a raft rather than drown
  if (!d.boat && !canStand(d, I(d.x, d.y))) d.boat = has(d.owner, 'canoes') ? 'canoe' : 'raft';
  a.moved = a.attacked = true;
  S.players[a.owner].converts++;
  S.players[old].lost++;
  FX.float(d.x, d.y, 'Swayed!', '#b89cff');
  if (isHuman(a.owner) || isHuman(old)) FX.say(`A ${UNITS[d.type].name} has flipped to ${tribeOf(a.owner).name}!`, a.owner);
  if (isHuman(a.owner)) vision();
  return { converted: true };
}
// What a kill is worth, by tribe.
function onKill(p, victim) {
  if (tribeIs(p, 'pirates')) { S.players[p].stars += 2; FX.float(victim.x, victim.y, '+2 ' + SH, '#ffd24a'); }
  if (tribeIs(p, 'choir')) {
    const c = citiesOf(p).sort((a, b) => cheb(a.x, a.y, victim.x, victim.y) - cheb(b.x, b.y, victim.x, victim.y))[0];
    if (c) { addPop(c, 1); FX.float(c.x, c.y, '+1 survivor', '#bff38a'); }
  }
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
    FX.say(`${tribeOf(old).name} played a hidden immunity idol! ${c.name} is safe, and the raider is voted off the island.`, u.owner, c, true);
    logIt(`${tribeOf(old).name} played an idol to save ${c.name}`);
    killUnit(u, old);
    return 'idol';
  }
  if (old >= 0) regard(old, u.owner, -4);
  if (S.rescue && S.rescue.city === c.id) {
    FX.say(`The Great Signal Fire at ${c.name} has been put out.`, u.owner, c, true);
    logIt(`The Great Signal Fire at ${c.name} was put out`);
    S.rescue = null; S.rescueCool = S.turn + 8;
  }
  c.owner = u.owner;
  if (old < 0) { c.level = 1; c.pop = 0; FX.say(`${tribeOf(u.owner).name} recruited the castaways of ${c.name}`, u.owner, c); }
  else {
    c.capital = false;
    for (const v of S.units) if (v.home === c.id && v.owner !== u.owner) v.home = -1;
    const w = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
    FX.say(`${tribeOf(u.owner).name} took ${c.name}${w ? ' and its ' + WONDERS[w].name : ''}!`, u.owner, c);
    if (tribeIs(u.owner, 'pirates')) { S.players[u.owner].stars += 5; FX.float(c.x, c.y, '+5 ' + SH, '#ffd24a'); }
    logIt(`${tribeOf(u.owner).name} took ${c.name} from ${TRIBES[S.players[old].tribe].name}`);
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
  const kind = tribeIs(p, 'blindside') ? 'idol' : pick(opts);
  const avail = Object.keys(TECHS).filter(k => !has(p, k) && techReady(p, k) && !techForbidden(p, k));
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
  const haul = tribeIs(p, 'crusoe') ? 20 : 10;
  P.stars += haul; FX.float(u.x, u.y, '+' + haul + ' ' + SH, '#ffd24a');
  return `The wreck's strongbox holds ${haul} ${SH}.`;
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
  const short = trainCost(p, type) - S.players[p].stars;
  if (short > 0) return `Need ${short} more ${SH}`;
  return '';
}
function canTrain(p, c, type) { return !trainBlock(p, c, type); }
function doTrain(p, c, type) {
  S.players[p].stars -= trainCost(p, type);
  const u = addUnit(type, p, c.x, c.y, c.id);
  u.hp = maxHp(u);
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
  if (key === 'post' && tribeIs(p, 'pirates')) return 'Pirates do not trade';
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
  if (key === 'coconut' && tribeIs(p, 'minnow')) { P.stars += 1; FX.float(x, y, '+1 ' + SH, '#ffd24a'); }
  if (key === 'boar' && tribeIs(p, 'moreau')) {
    const spot = freeLandNear(x, y, p);
    if (spot) {
      addUnit('beast', p, spot[0], spot[1], -1);
      FX.float(x, y, 'Beast-folk!', '#d9b3ff');
      if (isHuman(p)) vision();
      return;
    }
  }
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
  FX.say(`${tribeOf(p).name} raised ${WONDERS[key].name} in ${c.name}`, p);
  logIt(`${tribeOf(p).name} raised ${WONDERS[key].name} in ${c.name}`);
}

// ---------- the island ----------
function worldEvent() {
  const key = pick(Object.keys(EVENTS));
  const magus = p => p >= 0 && tribeIs(p, 'prospero') && !S.players[p].drowned;
  if (key === 'rain') for (const c of S.cities) { if (c.owner >= 0) addPop(c, magus(c.owner) ? 2 : 1); }
  else if (key === 'drop') for (const P of S.players) { if (P.alive) P.stars += magus(P.id) ? 6 : 3; }
  else if (key === 'storm') for (const u of S.units) { if (!magus(u.owner)) u.hp = Math.max(1, u.hp - (atSea(u) ? 3 : 1)); }
  else if (key === 'washed') {
    let k = 0;
    for (const i of shuffle([...S.tiles.keys()])) { if (k >= 2) break; if (placeVillage(i)) k++; }
  } else if (key === 'stampede') {
    for (const t of S.tiles) if (t.t === FOREST && !t.res && !t.imp && t.cityHere < 0 && Math.random() < .35) t.res = 'boar';
  } else if (key === 'eruption') {
    const [vx, vy] = XY(S.volcano);
    for (const u of S.units) if (cheb(u.x, u.y, vx, vy) <= 2 && !magus(u.owner)) u.hp = Math.max(1, u.hp - 4);
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
// ---------- ways the game can end besides conquest ----------
const RESCUE_DAYS = 10;
const STALL_RANGE = 3;
function rescueCost(p) { return tribeIs(p, 'conch') ? 12 : 25; }
// Why this camp cannot light the Great Signal Fire, or '' if it can.
function rescueBlock(p, c) {
  if (tribeIs(p, 'minnow')) return 'The Minnow are never rescued — would they even want to be?';
  if (S.rescue) return S.rescue.city === c.id ? 'It is burning here' : 'A Great Signal Fire already burns elsewhere';
  if ((S.rescueCool || 0) > S.turn) return `The last fire was put out; the ashes are still warm (${S.rescueCool - S.turn} days)`;
  if (!has(p, 'fire')) return 'Learn Firemaking';
  if (c.level < 4) return 'Grow this camp to level 4';
  const short = rescueCost(p) - S.players[p].stars;
  return short > 0 ? `Need ${short} more ${SH}` : '';
}
function doRescue(p, c) {
  S.players[p].stars -= rescueCost(p);
  S.rescue = { city: c.id, owner: p, lit: S.turn, days: 0 };
  logIt(`${tribeOf(p).name} lit the Great Signal Fire at ${c.name}`);
  if (!isHuman(p)) S.rescueNews = { owner: p, city: c.id, seen: false };
  S.explored[I(c.x, c.y)] = 1;
}
function tickRescue(p) {
  if (!S.rescue || S.rescue.owner !== p || S.over) return;
  const c = S.cities[S.rescue.city];
  if (c.owner !== p) { S.rescue = null; S.rescueCool = S.turn + 8; return; }
  // the ship only sees a fire that burns unchallenged: a rival within 2 tiles stalls the count
  S.rescue.stalled = S.units.some(u => hostile(p, u.owner) && cheb(u.x, u.y, c.x, c.y) <= STALL_RANGE);
  if (S.rescue.stalled) return;
  S.rescue.days++;
  if (S.rescue.days >= RESCUE_DAYS) {
    S.over = p === 0 ? 'win' : 'lose'; S.overHow = 'rescue'; S.winner = p;
    logIt(`A ship saw the fire at ${c.name}. ${tribeOf(p).name} were rescued`);
  }
}
const COUNCIL_DAY = { small: 40, medium: 50, large: 60, huge: 70 };
const councilDay = () => COUNCIL_DAY[S.size] || 50;
// Every tribe, fallen or not, votes for a winner — but never for itself.
function runCouncil() {
  const cands = S.players.filter(P => P.alive).map(P => P.id);
  const votes = [];
  for (const J of S.players) {
    const opts = cands.filter(c => c !== J.id);
    if (!opts.length) continue;
    let best = opts[0], bv = -1e9;
    for (const c of opts) {
      const v = S.regard[J.id][c] + .4 * citiesOf(c).length + Math.random() * .3;
      if (v > bv) { bv = v; best = c; }
    }
    votes.push({ juror: J.id, vote: best, fallen: !J.alive });
  }
  const tally = {};
  for (const v of votes) tally[v.vote] = (tally[v.vote] || 0) + 1;
  const winner = cands.slice().sort((a, b) => (tally[b] || 0) - (tally[a] || 0) || citiesOf(b).length - citiesOf(a).length)[0];
  S.council = { votes, tally, winner };
  S.over = winner === 0 ? 'win' : 'lose'; S.overHow = 'council'; S.winner = winner;
  logIt(`Final Tribal Council: ${tribeOf(winner).name} won the vote`);
}
function aiRescue(p) {
  if (S.rescue || S.turn < 25 || (S.rescueCool || 0) > S.turn || !has(p, 'fire') || tribeIs(p, 'minnow')) return;
  const P = S.players[p];
  // an underdog's gamble: only worth it when someone else is clearly winning the war
  if (!S.players.some(Q => Q.alive && Q.id !== p && strength(Q.id) > strength(p) * 1.3)) return;
  const c = citiesOf(p).filter(c => c.level >= 4 && !enemyNear(c.x, c.y, p, 4)).sort((a, b) => b.level - a.level)[0];
  if (c && P.stars >= rescueCost(p) + 6 && Math.random() < .2) doRescue(p, c);
}

// Called once each time the turn counter moves on.
function beginRound() {
  if (!S.over && S.turn >= councilDay()) { runCouncil(); return; }
  if (S.challenge && S.turn > S.challenge.until) {
    logIt(`Nobody reached the ${CHALLENGES[S.challenge.kind].name.toLowerCase()} in time`);
    S.challenge = null; S.nextChallenge = S.turn + 4 + rnd(3);
  }
  if (!S.challenge && S.turn >= S.nextChallenge) spawnChallenge();
  else if (S.turn >= S.nextEvent) { worldEvent(); S.nextEvent = S.turn + 5 + rnd(4); }
}
const NUMBERS = [4, 8, 15, 16, 23, 42];
function startTurn(p) {
  const P = S.players[p];
  if (S.turn > 1) P.stars += income(p);          // nobody earns on the first turn
  if (tribeIs(p, 'flight') && NUMBERS.includes(S.turn)) {
    const t = Object.keys(TECHS).filter(k => !has(p, k) && techReady(p, k) && !techForbidden(p, k)).sort((a, b) => techCost(p, a) - techCost(p, b))[0];
    if (t) { P.techs[t] = true; if (isHuman(p)) FX.say(`Day ${S.turn}. The numbers come up again, and your tribe simply knows ${TECHS[t].name}.`, p, null, true); }
  }
  const tiger = S.units.find(u => u.owner === p && u.type === 'tiger');
  if (tiger && S.turn > 1) {                     // the tiger must be fed
    if (P.stars > 0) P.stars--; else tiger.hp = Math.max(1, tiger.hp - 2);
  }
  tickRescue(p);
  if (isHuman(p) && typeof STORIES !== 'undefined') queueStory();
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
      FX.say(`${TRIBES[P.tribe].name}: voted off the islands.`, P.id, null, true);
      logIt(`${TRIBES[P.tribe].name} are out`);
    }
  }
  if (S.over) return;
  if (!S.players[0].alive) { S.over = 'lose'; S.overHow = 'domination'; }
  else if (S.players.every(P => P.human || !P.alive)) { S.over = 'win'; S.overHow = 'domination'; S.winner = 0; }
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
  const wade = tribeIs(p, 'lifeboat');
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
    if (has(p, t) || !techReady(p, t) || techForbidden(p, t) || !useful(t)) continue;
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
  const avail = TRAINABLE.filter(k => (!UNITS[k].tech || has(p, UNITS[k].tech)) && trainCost(p, k) <= P.stars && w[k] > 0);
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
      if (c.owner >= 0 && c.owner !== p && tribeIs(c.owner, 'beach') && S.players[c.owner].exposedUntil < S.turn && !(S.rescue && S.rescue.city === c.id)
        && !S.units.some(v => v.owner === p && cheb(v.x, v.y, c.x, c.y) <= 2)) continue;
      if (c.owner !== p) goals.push(gi);
      else if (!unitAt(c.x, c.y) && enemyNear(c.x, c.y, p, 3)) goals.push(gi);
    }
    for (let i = 0; i < S.tiles.length; i++) if (S.tiles[i].ruin && !claimed.has(i) && !isWater(S.tiles[i].t)) goals.push(i);
    if (S.challenge && !claimed.has(S.challenge.i)) goals.push(S.challenge.i);
    for (const e of S.units) if (hostile(p, e.owner)) goals.push(I(e.x, e.y));
    if (S.rescue && S.rescue.owner !== p && !atPeace(p, S.rescue.owner)) {
      // a rival's rescue fire trumps everything: every fighter heads for it
      const rc = S.cities[S.rescue.city];
      goals.length = 0; goals.push(I(rc.x, rc.y));
      for (const e of S.units) if (e.owner === S.rescue.owner && cheb(e.x, e.y, rc.x, rc.y) <= 1) goals.push(I(e.x, e.y));
    }
  }
  const { dist, src } = goalField(p, goals, flies(u));
  const { dests, prev } = moveInfo(u);
  let best = here, bd = dist[here];
  for (const d of dests) {
    const t = S.tiles[d];
    if (!canStand(u, d)) continue;
    let v = dist[d];
    if (S.challenge && d === S.challenge.i) v -= 3;
    if (S.rescue && S.rescue.owner !== p) { const rc = S.cities[S.rescue.city]; v -= Math.max(0, 3 - cheb(rc.x, rc.y, ...XY(d)) * .5); }
    if ((t.t === FOREST && has(p, 'slings')) || (t.t === MOUNTAIN && has(p, 'climbing'))) v -= .2;
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
  aiRescue(p);
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
// Games saved by earlier versions used different tribes and units, so they cannot be resumed.
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.v === 5 && Array.isArray(s.tiles) ? s : null;
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }
