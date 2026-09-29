/* Tribelands — the record book: tribes to unlock, achievements, and a history of
   every game you finish. Kept on this device, apart from the saved game, so it
   survives starting over.                                                        */

const PROFILE_KEY = 'tribelands-profile-v1';
const START_TRIBES = ['flight', 'conch', 'choir', 'crusoe', 'lifeboat', 'minnow'];
// Each locked tribe is earned by a feat that suits it.
const UNLOCKS = {
  beach:     { need: 'Win any game', prog: R => [R.wins, 1] },
  lilliput:  { need: 'Finish 5 games, win or lose', prog: R => [R.played, 5] },
  moreau:    { need: 'Defeat 25 rival units, across all your games', prog: R => [R.kills, 25] },
  pirates:   { need: 'Capture 8 rival camps, across all your games', prog: R => [R.captures, 8] },
  blindside: { need: 'Win 3 challenges, across all your games', prog: R => [R.challenges, 3] },
  engineers: { need: 'Learn 15 skills in a single game', prog: R => [R.bestSkills, 15] },
  prospero:  { need: 'Win by Rescue or by the Final Tribal Council', prog: R => [(R.byHow.rescue || 0) + (R.byHow.council || 0), 1] },
};

let REC = loadRecords();
function loadRecords() {
  const blank = { played: 0, wins: 0, losses: 0, kills: 0, captures: 0, challenges: 0, bestSkills: 0, byHow: {}, byTribe: {},
    history: [], achievements: {}, unlocked: {}, unlockAll: false, endings: {} };
  try { return Object.assign(blank, JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}')); } catch (e) { return blank; }
}
function saveRecords() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(REC)); } catch (e) { } }
const isUnlocked = key => START_TRIBES.includes(key) || REC.unlockAll || !!REC.unlocked[key];

const P0 = () => S.players[0];
const tk = () => TRIBES[S.players[0].tribe].key;
// `live` achievements are checked after every action; `end` ones when a game finishes.
const ACHIEVEMENTS = [
  { id: 'firstwin', icon: '🏆', name: 'Sole survivor', desc: 'Win a game.', end: g => g.win },
  { id: 'domination', icon: '👑', name: 'Last tribe standing', desc: 'Win by conquest.', end: g => g.win && g.how === 'domination' },
  { id: 'rescued', icon: '🚢', name: 'Rescued', desc: 'Win by Rescue.', end: g => g.win && g.how === 'rescue' },
  { id: 'jury', icon: '🗳️', name: 'The jury’s choice', desc: 'Win the Final Tribal Council.', end: g => g.win && g.how === 'council' },
  { id: 'huge', icon: '🗺️', name: 'Archipelago', desc: 'Win on a Huge map.', end: g => g.win && S.size === 'huge' },
  { id: 'hard', icon: '🔥', name: 'Against the odds', desc: 'Win on Hard.', end: g => g.win && S.diff === 'hard' },
  { id: 'eight', icon: '🌊', name: 'Eight tribes enter', desc: 'Win a game against seven rivals.', end: g => g.win && S.players.length === 8 },
  { id: 'peace', icon: '🕊️', name: 'Peacemaker', desc: 'Form 3 alliances in one game.', live: () => (P0().alliances || 0) >= 3 },
  { id: 'traitor', icon: '🗡️', name: 'Blindsided them', desc: 'Break an alliance.', live: () => (P0().betrayals || 0) >= 1 },
  { id: 'landmarks', icon: '🗼', name: 'Wonders of the isles', desc: 'Hold 3 landmarks at once.', live: () => Object.keys(WONDERS).filter(k => hasWonder(0, k)).length >= 3 },
  { id: 'haven', icon: '🏝️', name: 'Haven', desc: 'Grow a camp to level 5.', live: () => citiesOf(0).some(c => c.level >= 5) },
  { id: 'story', icon: '📖', name: 'The whole story', desc: 'Live all four of your tribe’s story scenes in one game.', live: () => S.story.done.length >= 4 },
  { id: 't_flight', tribe: 'flight', icon: '🔢', name: 'Day 42', desc: 'As Flight 815, still be alive on day 42.', live: () => tk() === 'flight' && S.turn >= 42 },
  { id: 't_conch', tribe: 'conch', icon: '🐚', name: 'The fire never went out', desc: 'As the Conch, win by Rescue.', end: g => g.win && g.how === 'rescue' && tk() === 'conch' },
  { id: 't_choir', tribe: 'choir', icon: '🐖', name: 'Kill the pig', desc: 'As the Choir, defeat 20 rival units in one game.', live: () => tk() === 'choir' && P0().kills >= 20 },
  { id: 't_crusoe', tribe: 'crusoe', icon: '📅', name: 'Lord of the manor', desc: 'As the Crusoes, win without ever losing a camp.', end: g => g.win && tk() === 'crusoe' && !P0().campsLost },
  { id: 't_lifeboat', tribe: 'lifeboat', icon: '🐯', name: 'The tiger lived', desc: 'As the Lifeboat, win with the tiger still alive.', end: g => g.win && tk() === 'lifeboat' && unitsOf(0).some(u => u.type === 'tiger') },
  { id: 't_minnow', tribe: 'minnow', icon: '📻', name: 'Never leave', desc: 'As the Minnow, win the Final Tribal Council.', end: g => g.win && g.how === 'council' && tk() === 'minnow' },
  { id: 't_beach', tribe: 'beach', icon: '🤫', name: 'Small paradise', desc: 'As the Beach, win holding 4 camps or fewer.', end: g => g.win && tk() === 'beach' && citiesOf(0).length <= 4 },
  { id: 't_moreau', tribe: 'moreau', icon: '🐺', name: 'Are we not Men?', desc: 'As Moreau’s Beasts, field 5 Beast-folk at once.', live: () => tk() === 'moreau' && unitsOf(0).filter(u => u.type === 'beast').length >= 5 },
  { id: 't_engineers', tribe: 'engineers', icon: '⚙️', name: 'From nothing', desc: 'As the Engineers, learn every skill.', live: () => tk() === 'engineers' && Object.keys(TECHS).every(t => has(0, t)) },
  { id: 't_prospero', tribe: 'prospero', icon: '📚', name: 'Charms o’erthrown', desc: 'As Prospero’s Court, drown the book and still win.', end: g => g.win && tk() === 'prospero' && P0().drowned },
  { id: 't_pirates', tribe: 'pirates', icon: '💰', name: 'A king’s ransom', desc: 'As the Hispaniola, hold 100 shells at once.', live: () => tk() === 'pirates' && P0().stars >= 100 },
  { id: 't_lilliput', tribe: 'lilliput', icon: '🐜', name: 'Many hands', desc: 'As Lilliput, command 20 units at once.', live: () => tk() === 'lilliput' && unitsOf(0).length >= 20 },
  { id: 't_blindside', tribe: 'blindside', icon: '🗿', name: 'Idol hoarder', desc: 'As the Blindsiders, hold 3 idols at once.', live: () => tk() === 'blindside' && P0().idols >= 3 },
];
function earn(a) {
  if (REC.achievements[a.id]) return false;
  REC.achievements[a.id] = new Date().toISOString().slice(0, 10);
  (S.earned = S.earned || []).push(a.id);
  saveRecords();
  return true;
}
// After every action: anything earned just now gets a toast.
function checkLiveAchievements() {
  if (!S || S.demo || S.over) return;
  for (const a of ACHIEVEMENTS) if (a.live && !REC.achievements[a.id] && a.live()) { if (earn(a)) { toast(`🏆 Achievement: ${a.name}`); buzz([20, 60, 20]); } }
}
// Once, when a game ends: fold it into the records, and see what it unlocked.
function recordGame() {
  if (!S || S.demo || S.recorded) return { earned: [], unlocked: [] };
  S.recorded = true;
  const g = { win: S.over === 'win', how: S.overHow || 'domination' };
  const key = tk(), P = P0();
  const before = TRIBES.filter(T => isUnlocked(T.key)).map(T => T.key);
  REC.played++; g.win ? REC.wins++ : REC.losses++;
  REC.kills += P.kills; REC.captures += P.captures || 0; REC.challenges += P.challenges || 0;
  REC.bestSkills = Math.max(REC.bestSkills, Object.keys(P.techs).length);
  if (g.win) REC.byHow[g.how] = (REC.byHow[g.how] || 0) + 1;
  const bt = REC.byTribe[key] = REC.byTribe[key] || { played: 0, wins: 0, fastest: 0 };
  bt.played++;
  if (g.win) { bt.wins++; bt.fastest = bt.fastest ? Math.min(bt.fastest, S.turn) : S.turn; }
  REC.endings[key] = true;
  REC.history.unshift({ tribe: key, win: g.win, how: g.how, days: S.turn, rivals: S.players.length - 1, size: S.size, diff: S.diff,
    winner: S.winner >= 0 ? TRIBES[S.players[S.winner].tribe].key : null, date: new Date().toISOString().slice(0, 10) });
  REC.history = REC.history.slice(0, 40);
  const earned = (S.earned || []).slice();
  for (const a of ACHIEVEMENTS) if (a.end && !REC.achievements[a.id] && a.end(g)) { earn(a); earned.push(a.id); }
  for (const k of Object.keys(UNLOCKS)) { const [v, need] = UNLOCKS[k].prog(REC); if (v >= need) REC.unlocked[k] = REC.unlocked[k] || new Date().toISOString().slice(0, 10); }
  saveRecords();
  const unlocked = TRIBES.filter(T => isUnlocked(T.key) && !before.includes(T.key)).map(T => T.key);
  return { earned: [...new Set(earned)], unlocked };
}
