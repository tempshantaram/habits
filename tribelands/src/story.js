/* Tribelands — story moments. Each tribe meets four scenes from its own story,
   each a choice with consequences: shells, survivors, units, skills, idols,
   short-lived strength, and how every other tribe regards you (which decides
   the Final Tribal Council). The choices are meant to test the tribe's own
   question; neither option is simply "right".                                  */

// What a choice can do. Everything acts on the player's tribe (player 0).
const X = {
  cap() { return citiesOf(0).find(c => c.capital) || citiesOf(0)[0]; },
  gain(n) { S.players[0].stars = Math.max(0, S.players[0].stars + n); return (n > 0 ? '+' : '−') + Math.abs(n) + ' ' + SH; },
  pop(n) { const c = this.cap(); if (c) addPop(c, n); return `+${n} survivor${n > 1 ? 's' : ''}`; },
  unit(type, n = 1) {
    const c = this.cap(); let k = 0;
    for (let j = 0; j < n && c; j++) {
      const spot = freeLandNear(c.x, c.y, 0) || freeLandNear(...(nbrs(c.x, c.y)[0] || [c.x, c.y]), 0);
      if (!spot) break;
      const u = addUnit(type, 0, spot[0], spot[1], -1); u.hp = maxHp(u); k++;
    }
    vision();
    return k ? `+${k} ${UNITS[type].name}` : 'no room for a new unit';
  },
  learn() {
    const t = Object.keys(TECHS).filter(k => !has(0, k) && techReady(0, k) && !techForbidden(0, k)).sort((a, b) => techCost(0, a) - techCost(0, b))[0];
    if (!t) return this.gain(6);
    S.players[0].techs[t] = true; return 'learned ' + TECHS[t].name;
  },
  idol(n = 1) { S.players[0].idols += n; return `+${n} hidden immunity idol`; },
  hurt(n) { for (const u of unitsOf(0)) u.hp = Math.max(1, u.hp - n); return `your units lose ${n} HP`; },
  heal() { for (const u of unitsOf(0)) u.hp = maxHp(u); return 'every unit healed'; },
  regard(n) { regardAll(0, n); return n > 0 ? 'the other tribes think better of you' : 'the other tribes think worse of you'; },
  mod(kind, v, turns) { addMod(0, kind, v, turns); const w = { atk: 'attack', def: 'defence', income: SH + ' a day' }[kind]; return `${v > 0 ? '+' : '−'}${Math.abs(v)} ${w} for ${turns} days`; },
  reveal(r) { const c = this.cap(); if (c) reveal(c.x, c.y, r); return 'you can see further'; },
  revealFar(r) {
    const dark = [...S.tiles.keys()].filter(i => !seen(i));
    if (dark.length) { const [x, y] = XY(pick(dark)); reveal(x, y, r); }
    return 'a far stretch of the islands revealed';
  },
  walls() { const c = this.cap(); if (c) c.walls = true; return 'a palisade around your first camp'; },
  shack() {
    const c = this.cap(); if (!c) return '';
    for (const i of shuffle([...S.tiles.keys()])) { const [x, y] = XY(i); if (cheb(x, y, c.x, c.y) <= 5 && placeVillage(i)) { reveal(x, y, 1); return 'stranded castaways appear nearby'; } }
    return 'nobody else is out there';
  },
  wreck() {
    const c = this.cap(); if (!c) return '';
    for (const i of shuffle([...S.tiles.keys()])) {
      const t = S.tiles[i], [x, y] = XY(i);
      if (cheb(x, y, c.x, c.y) > 4 || cheb(x, y, c.x, c.y) < 2 || isWater(t.t) || t.cityHere >= 0 || t.ruin || t.volcano || unitAt(x, y)) continue;
      t.ruin = true; t.res = null; reveal(x, y, 1); return 'a shipwreck marked on the map';
    }
    return this.gain(6);
  },
  lose(type) { const u = unitsOf(0).find(v => v.type === type); if (!u) return ''; killUnit(u); S.players[0].lost--; return `your ${UNITS[type].name} is gone`; },
  storm() { for (const u of S.units) if (u.owner !== 0) u.hp = Math.max(1, u.hp - 3); return 'rival units lose 3 HP'; },
  rivalIdol() { const R = shuffle(S.players.filter(P => P.id && P.alive && P.idols))[0]; if (R) { R.idols--; return `${TRIBES[R.tribe].name} lose an idol`; } return this.gain(6); },
  expose(turns) { S.players[0].exposedUntil = S.turn + turns; return `rivals know where you are for ${turns} days`; },
};
const joinFx = (...parts) => parts.filter(Boolean).join(' · ');

const STORIES = {
  flight: [
    { day: 3, icon: '🚪', title: 'The hatch', text: 'In the jungle, half-buried: a steel hatch with no handle. Some of you think it is a way out. Some think it should never be opened.',
      choices: [
        { label: 'Blow it open', desc: 'Science: learn a skill, but the blast wounds your units.', fx: () => joinFx(X.learn(), X.hurt(2)) },
        { label: 'Leave it sealed', desc: 'Faith: the camp grows calmer. +2 survivors.', fx: () => X.pop(2) }] },
    { day: 8, icon: '⌨️', title: 'The button', text: 'Inside, a terminal and a note: type the numbers every day, or something terrible happens. Nobody knows if it is true.',
      choices: [
        { label: 'Keep pushing the button', desc: '−1 🐚 a day for 8 days, but +1 defence for 8 days.', fx: () => joinFx(X.mod('income', -1, 8), X.mod('def', 1, 8)) },
        { label: 'Let the timer run out', desc: 'See what happens: your units are shaken (−3 HP), and you learn something.', fx: () => joinFx(X.hurt(3), X.learn()) }] },
    { day: 15, icon: '👁️', title: 'The Others', text: 'Strangers who have been here far longer than you are watching from the treeline. They want to trade.',
      choices: [
        { label: 'Trust them', desc: '+10 🐚. Other tribes see you dealing with the Others.', fx: () => joinFx(X.gain(10), X.regard(-1)) },
        { label: 'Take a hostage', desc: 'A Blade joins you by force. Everyone hears of it.', fx: () => joinFx(X.unit('blade'), X.regard(-3)) },
        { label: 'Walk away', desc: 'Nothing gained. The other tribes respect your restraint.', fx: () => X.regard(2) }] },
    { day: 23, icon: '📻', title: 'The constant', text: 'One of you is coming unstuck in time, and needs one fixed thing to hold on to — a voice from home.',
      choices: [
        { label: 'Use the radio tower', desc: 'Reach out across the islands: reveal a far stretch, and the others hear a kind voice.', fx: () => joinFx(X.revealFar(4), X.regard(1)) },
        { label: 'Keep the island’s secret', desc: 'Say nothing to anyone. +1 hidden immunity idol.', fx: () => X.idol() }] },
  ],
  conch: [
    { day: 2, icon: '🐚', title: 'The assembly', text: 'The conch is blown and everyone gathers. Whoever holds the shell may speak. It takes all afternoon.',
      choices: [
        { label: 'Let everyone speak', desc: 'Slow, but the camp feels heard. +2 survivors.', fx: () => X.pop(2) },
        { label: 'Just decide', desc: 'Faster. +6 🐚, and the little ones go quiet.', fx: () => X.gain(6) }] },
    { day: 6, icon: '🚢', title: 'The fire went out', text: 'A ship passed on the horizon — while the fire-watchers were off hunting. Nobody saw it but you.',
      choices: [
        { label: 'Call an assembly and blame them', desc: 'It feels deserved. +1 defence for 6 days; the other tribes hear the shouting.', fx: () => joinFx(X.mod('def', 1, 6), X.regard(-1)) },
        { label: 'Relight it together', desc: 'No blame. Every unit heals.', fx: () => X.heal() }] },
    { day: 12, icon: '👓', title: 'The glasses', text: 'The lenses you light the fire with have been stolen in the night. Without them there is no fire and no rescue.',
      choices: [
        { label: 'Go and ask, with the conch', desc: 'Reason, not force. The other tribes think better of you; you learn a skill.', fx: () => joinFx(X.regard(2), X.learn()) },
        { label: 'Take them back by force', desc: '+1 attack for 5 days. Everyone sees what the Conch will do.', fx: () => joinFx(X.mod('atk', 1, 5), X.regard(-2)) }] },
    { day: 20, icon: '👹', title: 'The beast', text: 'The little ones swear there is a beast on the mountain. Fear is spreading faster than the fire.',
      choices: [
        { label: 'Climb and look', desc: 'Face it: see far across the island, but the climb is hard (−2 HP).', fx: () => joinFx(X.reveal(4), X.hurt(2)) },
        { label: 'Tell them it isn’t real', desc: 'Reason calms the camp. +2 survivors.', fx: () => X.pop(2) },
        { label: 'Leave it an offering', desc: '−4 🐚 of food on a rock. +1 hidden immunity idol.', fx: () => joinFx(X.gain(-4), X.idol()) }] },
  ],
  choir: [
    { day: 2, icon: '🎨', title: 'Paint', text: 'Clay and charcoal from the stream. Behind a painted face you feel like someone else — someone who is not afraid.',
      choices: [
        { label: 'Paint every face', desc: '+1 attack for 6 days. The other tribes find you frightening.', fx: () => joinFx(X.mod('atk', 1, 6), X.regard(-1)) },
        { label: 'Sing together instead', desc: 'Remember who you were. Every unit heals, +1 survivor.', fx: () => joinFx(X.heal(), X.pop(1)) }] },
    { day: 5, icon: '🐖', title: 'The first kill', text: 'The hunters come back bloody and proud, carrying a pig on a pole.',
      choices: [
        { label: 'Feast', desc: 'Everyone eats. +3 survivors.', fx: () => X.pop(3) },
        { label: 'Leave the head for the beast', desc: 'An offering on a sharpened stick. +1 hidden immunity idol.', fx: () => X.idol() }] },
    { day: 11, icon: '🏰', title: 'Castle Rock', text: 'A fortress of pink rock at the end of the island. Whoever holds it can drop boulders on anyone who comes.',
      choices: [
        { label: 'Fortify your first camp', desc: 'A palisade around your first camp.', fx: () => X.walls() },
        { label: 'Raid from it instead', desc: 'Two Runners, and a reputation.', fx: () => joinFx(X.unit('runner', 2), X.regard(-1)) }] },
    { day: 18, icon: '🪰', title: 'The Lord of the Flies', text: 'The pig’s head on its stick is black with flies. Alone in the clearing, you would swear it is talking to you.',
      choices: [
        { label: 'Listen to it', desc: '+1 attack for 10 days. Every tribe despises you a little more.', fx: () => joinFx(X.mod('atk', 1, 10), X.regard(-3)) },
        { label: 'Knock it down', desc: 'It is only a pig’s head. You learn something; the others think better of you.', fx: () => joinFx(X.learn(), X.regard(2)) }] },
  ],
  crusoe: [
    { day: 3, icon: '⚓', title: 'One last swim to the wreck', text: 'The ship will break up in the next storm. There is time for one more trip, and one more load. “O drug! what art thou good for?” — the coins, or the tools?',
      choices: [
        { label: 'The tools', desc: 'Learn a skill.', fx: () => X.learn() },
        { label: 'The money', desc: '+12 🐚. Crusoe took it too, in the end.', fx: () => X.gain(12) }] },
    { day: 9, icon: '👣', title: 'The footprint', text: 'A single naked footprint on the shore. Just one. You have not seen another soul in all your days here.',
      choices: [
        { label: 'Fortify, in fear', desc: 'A palisade around your first camp.', fx: () => X.walls() },
        { label: 'Look for whoever made it', desc: 'Stranded people appear nearby, ready to join you.', fx: () => X.shack() }] },
    { day: 16, icon: '🤝', title: 'A man on the beach', text: 'You save a man from those who would kill him. He kneels. It would be easy to give him a new name and call him your servant.',
      choices: [
        { label: 'Name him, and make him serve', desc: 'A Blade joins you. The other tribes see what you have become.', fx: () => joinFx(X.unit('blade'), X.regard(-2)) },
        { label: 'Ask his name, and his island’s', desc: 'He teaches you what he knows: learn a skill; the others think better of you.', fx: () => joinFx(X.learn(), X.regard(2)) }] },
    { day: 28, icon: '📅', title: 'Twenty-eight years', text: 'The calendar post is more notch than wood. You could keep counting. You could stop.',
      choices: [
        { label: 'Keep counting', desc: 'Patience: +2 🐚 a day for 10 days.', fx: () => X.mod('income', 2, 10) },
        { label: 'Burn the post', desc: 'Live here, now. Every unit heals, +2 survivors.', fx: () => joinFx(X.heal(), X.pop(2)) }] },
  ],
  lifeboat: [
    { day: 2, icon: '🐯', title: 'The tiger is hungry', text: 'The tiger paces the length of the boat. A whistle and a fish might teach it where your side is. Or you could just feed it, and hope.',
      choices: [
        { label: 'Train it', desc: 'A whistle and patience: the tiger becomes a veteran (+5 HP).', fx: () => { const t = unitsOf(0).find(u => u.type === 'tiger'); if (!t) return X.gain(4); t.vet = true; t.hp = maxHp(t); return 'the tiger is a veteran'; } },
        { label: 'Just feed it', desc: '−4 🐚, and every unit heals.', fx: () => joinFx(X.gain(-4), X.heal()) }] },
    { day: 7, icon: '🐟', title: 'Flying fish', text: 'A shoal of flying fish hits the boat like hail. There is more than enough for once.',
      choices: [
        { label: 'Eat', desc: '+3 survivors.', fx: () => X.pop(3) },
        { label: 'Dry them for later', desc: '+2 🐚 a day for 6 days.', fx: () => X.mod('income', 2, 6) }] },
    { day: 13, icon: '🌿', title: 'The floating island', text: 'An island of algae with fresh pools and a thousand meerkats. By day it is paradise. At night, the pools turn to acid.',
      choices: [
        { label: 'Stay', desc: 'Rest and food: +3 survivors, but the nights burn (−2 HP).', fx: () => joinFx(X.pop(3), X.hurt(2)) },
        { label: 'Leave at dawn', desc: 'Keep moving. Learn a skill.', fx: () => X.learn() }] },
    { day: 21, icon: '📖', title: 'Which story?', text: 'The investigators do not believe you. They want a story they can write down. You have two. Both end the same way.',
      choices: [
        { label: 'The story with the tiger', desc: 'Keep the wonder: +1 hidden immunity idol.', fx: () => X.idol() },
        { label: 'The story without', desc: 'The tiger walks into the jungle without looking back. +10 🐚, and the others believe you.', fx: () => joinFx(X.lose('tiger'), X.gain(10), X.regard(2)) }] },
  ],
  minnow: [
    { day: 3, icon: '📻', title: 'A radio made of coconuts', text: 'The Professor has built a radio from coconut shells, wire and hope. It can listen, or it can power the camp’s tools.',
      choices: [
        { label: 'Listen for rescue', desc: 'News of the islands: reveal a far stretch.', fx: () => X.revealFar(5) },
        { label: 'Power the tools', desc: '+1 🐚 a day for 8 days.', fx: () => X.mod('income', 1, 8) }] },
    { day: 8, icon: '✈️', title: 'A visitor drops in', text: 'A pilot crash-lands in the lagoon, charming and in a hurry. He swears he will send help if you pay for his fuel.',
      choices: [
        { label: 'Pay him', desc: '−5 🐚. (Visitors never come back. But you hoped.)', fx: () => joinFx(X.gain(-5), X.regard(1)) },
        { label: 'Keep him, and his plane', desc: 'He rebuilds it as a Glider for you.', fx: () => X.unit('glider') }] },
    { day: 15, icon: '🧢', title: 'A plan', text: 'Your most enthusiastic crew member has a plan. It will either work brilliantly or go very, very wrong.',
      choices: [
        { label: 'Let him try', desc: 'Half the time +12 🐚; half the time −6 🐚.', fx: () => X.gain(Math.random() < .5 ? 12 : -6) },
        { label: 'Let the Skipper lead', desc: 'Sensible: +1 defence for 6 days.', fx: () => X.mod('def', 1, 6) }] },
    { day: 24, icon: '🛳️', title: 'A ship on the horizon', text: 'A real ship, close enough to see. Every fire you have could reach it. Or you could let it pass.',
      choices: [
        { label: 'Light every fire', desc: 'It sails on regardless. But hope heals: every unit heals.', fx: () => X.heal() },
        { label: 'Let it pass', desc: 'You like it here. +1 hidden immunity idol, +2 survivors.', fx: () => joinFx(X.idol(), X.pop(2)) }] },
  ],
  beach: [
    { day: 3, icon: '🗺️', title: 'The map', text: 'A stranger’s hand-drawn map to your lagoon has turned up in a mainland hostel. Someone talked.',
      choices: [
        { label: 'Burn every copy', desc: 'The secret holds: +1 hidden immunity idol.', fx: () => X.idol() },
        { label: 'Welcome the new arrivals', desc: '+4 survivors, but rivals know where you are for 6 days.', fx: () => joinFx(X.pop(4), X.expose(6)) }] },
    { day: 9, icon: '🦈', title: 'The shark', text: 'Two of your own are badly hurt. A hospital on the mainland would save them — and tell the world you are here.',
      choices: [
        { label: 'Take them to the mainland', desc: '−6 🐚, every unit heals, rivals learn where you are for 4 days.', fx: () => joinFx(X.gain(-6), X.heal(), X.expose(4)) },
        { label: 'Leave them in the tent', desc: 'Out of sight, so paradise stays paradise. The other tribes hear.', fx: () => X.regard(-3) }] },
    { day: 16, icon: '🍚', title: 'The rice run', text: 'Supplies are low. Someone has to go to the mainland and come back without being followed.',
      choices: [
        { label: 'Go', desc: '+8 🐚, but you are seen for 5 days.', fx: () => joinFx(X.gain(8), X.expose(5)) },
        { label: 'Make do', desc: 'Hunger, but safety: +1 defence for 6 days.', fx: () => X.mod('def', 1, 6) }] },
    { day: 25, icon: '🌾', title: 'The farmers', text: 'Armed farmers share the island. They tolerate you on one condition: nobody new ever comes.',
      choices: [
        { label: 'Keep the deal', desc: '+2 defence for 8 days.', fx: () => X.mod('def', 2, 8) },
        { label: 'Refuse', desc: 'A Blade to defend yourselves, and a harder name among the tribes.', fx: () => joinFx(X.unit('blade'), X.regard(-2)) }] },
  ],
  moreau: [
    { day: 3, icon: '📜', title: 'The Law', text: '“Not to go on all-Fours; that is the Law. Are we not Men?” The Sayer of the Law chants and the others answer.',
      choices: [
        { label: 'Recite the Law', desc: 'Order: +1 defence for 6 days.', fx: () => X.mod('def', 1, 6) },
        { label: 'Let the beasts be beasts', desc: '+1 attack for 6 days. The other tribes grow uneasy.', fx: () => joinFx(X.mod('atk', 1, 6), X.regard(-1)) }] },
    { day: 8, icon: '🔪', title: 'The House of Pain', text: 'Screams from the enclosure again. The surgery can make another creature — or you could close its door for good.',
      choices: [
        { label: 'Keep the surgery going', desc: 'A new Beast-folk warrior.', fx: () => X.unit('beast') },
        { label: 'Close the door', desc: '+3 survivors. The other tribes think better of you.', fx: () => joinFx(X.pop(3), X.regard(2)) }] },
    { day: 15, icon: '🩸', title: 'The taste of blood', text: 'One of the beasts has killed and eaten. The others are watching to see what you will do.',
      choices: [
        { label: 'Hunt it down', desc: 'You lose a Beast-folk (if any). The Law holds; the others respect it.', fx: () => joinFx(X.lose('beast'), X.regard(1)) },
        { label: 'Let it run', desc: '+1 attack for 4 days. The Law is breaking.', fx: () => joinFx(X.mod('atk', 1, 4), X.regard(-1)) }] },
    { day: 24, icon: '⚰️', title: 'The doctor is dead', text: 'Moreau is dead. The beasts do not know yet. If they learn it, nothing will hold them.',
      choices: [
        { label: 'Say he watches from the House', desc: 'A useful lie: +1 hidden immunity idol.', fx: () => X.idol() },
        { label: 'Tell them the truth', desc: 'Every unit heals, +2 survivors, and the others think better of you.', fx: () => joinFx(X.heal(), X.pop(2), X.regard(1)) }] },
  ],
  engineers: [
    { day: 2, icon: '🔥', title: 'One match', text: 'Between the five of you: a single match, found in a waistcoat lining. Everything depends on what you do with it.',
      choices: [
        { label: 'Light a fire now', desc: 'Warmth and hope: +2 survivors.', fx: () => X.pop(2) },
        { label: 'Save it for the forge', desc: 'Learn a skill.', fx: () => X.learn() }] },
    { day: 8, icon: '⌚', title: 'Two watch-glasses', text: 'Two watch-glasses, sealed with clay and filled with water, make a lens. Or the watch can keep time for the work.',
      choices: [
        { label: 'Make a lens', desc: 'See far from your first camp.', fx: () => X.reveal(4) },
        { label: 'Keep time', desc: '+1 🐚 a day for 8 days.', fx: () => X.mod('income', 1, 8) }] },
    { day: 15, icon: '📦', title: 'A mysterious gift', text: 'A chest has washed up: tools, rifles, medicine. From no one. Someone on this island is helping you, and does not want to be found.',
      choices: [
        { label: 'Search for the giver', desc: 'A far stretch revealed, and +1 hidden immunity idol.', fx: () => joinFx(X.revealFar(3), X.idol()) },
        { label: 'Accept it and get to work', desc: '+10 🐚.', fx: () => X.gain(10) }] },
    { day: 24, icon: '🌋', title: 'The volcano wakes', text: 'The mountain is rumbling. You could put its heat to work — or get everyone clear.',
      choices: [
        { label: 'Harness it', desc: 'Learn a skill, but the heat wounds your units (−2 HP).', fx: () => joinFx(X.learn(), X.hurt(2)) },
        { label: 'Evacuate', desc: 'Every unit heals; +1 defence for 5 days.', fx: () => joinFx(X.heal(), X.mod('def', 1, 5)) }] },
  ],
  prospero: [
    { day: 2, icon: '🌊', title: 'The storm you made', text: 'You raised the tempest that wrecked them. Now they are scattered on your shores, and you could raise another.',
      choices: [
        { label: 'Raise another storm', desc: 'Rival units lose 3 HP. They will not forget it.', fx: () => joinFx(X.storm(), X.regard(-2)) },
        { label: 'Calm the sea', desc: '+2 survivors, and the others think better of you.', fx: () => joinFx(X.pop(2), X.regard(1)) }] },
    { day: 7, icon: '🧚', title: 'Ariel asks for freedom', text: 'Your spirit servant reminds you: you promised. Freedom, for faithful service. It has been faithful.',
      choices: [
        { label: 'Set Ariel free', desc: 'Keep your word: the other tribes think much better of you.', fx: () => X.regard(3) },
        { label: 'One more task first', desc: 'Ariel serves on as a Glider. The others hear of your broken promise.', fx: () => joinFx(X.unit('glider'), X.regard(-1)) }] },
    { day: 14, icon: '🪨', title: '“This island’s mine”', text: 'Caliban says the island was his mother’s, then his, before you came and taught him words to curse you with.',
      choices: [
        { label: 'Rule him', desc: 'A Blade serves you, unwillingly. The other tribes see it.', fx: () => joinFx(X.unit('blade'), X.regard(-2)) },
        { label: 'Give him back a share', desc: '+2 survivors, and the others think better of you.', fx: () => joinFx(X.pop(2), X.regard(2)) }] },
    { day: 22, icon: '📚', title: 'Drown the book', text: '“Now my charms are all o’erthrown.” The magic that made you master here could go into the sea with your book.',
      choices: [
        { label: 'Keep the book', desc: '+1 attack and +1 defence for 10 days.', fx: () => joinFx(X.mod('atk', 1, 10), X.mod('def', 1, 10)) },
        { label: 'Drown it', desc: 'You lose command of the weather for good. +10 🐚, and the others think much better of you.', fx: () => { S.players[0].drowned = true; return joinFx('the tempest is yours no more', X.gain(10), X.regard(3)); } }] },
  ],
  pirates: [
    { day: 2, icon: '🗺️', title: 'Flint’s map', text: 'An X, a skeleton, and three trees on Spyglass Hill. The map is worth something on its own — or it is worth following.',
      choices: [
        { label: 'Follow it', desc: 'A shipwreck is marked on your map.', fx: () => X.wreck() },
        { label: 'Sell it', desc: '+8 🐚.', fx: () => X.gain(8) }] },
    { day: 8, icon: '⚫', title: 'The black spot', text: 'The crew slip you a scrap of paper, blackened on one side. You are deposed — unless you do something.',
      choices: [
        { label: 'Pay them off', desc: '−6 🐚, +1 defence for 6 days.', fx: () => joinFx(X.gain(-6), X.mod('def', 1, 6)) },
        { label: 'Face them down', desc: 'A Scrapper walks the plank (if you have one). +1 attack for 6 days.', fx: () => joinFx(X.lose('scrapper'), X.mod('atk', 1, 6)) }] },
    { day: 15, icon: '🧀', title: 'A marooned man', text: 'A wild-eyed man, three years alone, begs for a piece of cheese. He says he knows the island.',
      choices: [
        { label: 'Share your cheese', desc: '−3 🐚. He shows you the island, and joins you.', fx: () => joinFx(X.gain(-3), X.revealFar(3), X.unit('scrapper')) },
        { label: 'Leave him', desc: 'Nothing. The other tribes think less of you.', fx: () => X.regard(-1) }] },
    { day: 24, icon: '🕳️', title: 'The empty pit', text: 'You reach the X at last. The treasure is gone. Someone got here first.',
      choices: [
        { label: 'Turn on each other', desc: '+1 attack for 5 days, and a fearsome name.', fx: () => joinFx(X.mod('atk', 1, 5), X.regard(-2)) },
        { label: 'Let it go', desc: '+2 survivors. The others think better of you.', fx: () => joinFx(X.pop(2), X.regard(1)) }] },
  ],
  lilliput: [
    { day: 3, icon: '🧍', title: 'The Man-Mountain', text: 'A giant has washed up on your beach. He is asleep. You have a great deal of thread.',
      choices: [
        { label: 'Tie him down and put him to work', desc: 'A Tiki Titan joins you, but feeding him costs 1 🐚 a day for 10 days.', fx: () => joinFx(X.unit('titan'), X.mod('income', -1, 10)) },
        { label: 'Let him go', desc: 'The other tribes think much better of you.', fx: () => X.regard(2) }] },
    { day: 9, icon: '🥚', title: 'Which end of the egg?', text: 'A decree: eggs must be broken at the little end. Half the camp breaks theirs at the big end, and always has.',
      choices: [
        { label: 'Enforce the Little End', desc: '+1 attack for 6 days. The other tribes think you ridiculous.', fx: () => joinFx(X.mod('atk', 1, 6), X.regard(-2)) },
        { label: 'Let each break eggs as they please', desc: '+1 🐚 a day for 8 days.', fx: () => X.mod('income', 1, 8) }] },
    { day: 16, icon: '🔥', title: 'Fire in the palace', text: 'The palace is burning. The giant can put it out — by a method nobody will ever speak of again.',
      choices: [
        { label: 'Let him', desc: 'The palace is saved: +3 survivors. The scandal gets around.', fx: () => joinFx(X.pop(3), X.regard(-1)) },
        { label: 'Let it burn', desc: '−5 🐚, but your dignity is intact.', fx: () => X.gain(-5) }] },
    { day: 24, icon: '⛵', title: 'The enemy fleet', text: 'The giant can wade out and drag the enemy’s whole fleet home on ropes. The Emperor wants more: the enemy’s people as slaves.',
      choices: [
        { label: 'Take the fleet and the people', desc: '+10 🐚. Every tribe thinks less of you.', fx: () => joinFx(X.gain(10), X.regard(-2)) },
        { label: 'Take the fleet, refuse the rest', desc: '“Never be an instrument of bringing a free people into slavery.” The others think much better of you.', fx: () => X.regard(3) }] },
  ],
  blindside: [
    { day: 2, icon: '🛖', title: 'First impressions', text: 'Day two. Everyone is building the shelter. Everyone is also watching who wanders off.',
      choices: [
        { label: 'Build the shelter', desc: '+2 survivors. People like you.', fx: () => joinFx(X.pop(2), X.regard(1)) },
        { label: 'Slip away and look for idols', desc: '+1 hidden immunity idol. People notice you were gone.', fx: () => joinFx(X.idol(), X.regard(-1)) }] },
    { day: 7, icon: '🔀', title: 'The swing vote', text: 'Two alliances, one vote between them — yours. One side is offering a great deal.',
      choices: [
        { label: 'Flip', desc: '+8 🐚. Nobody will trust you again soon.', fx: () => joinFx(X.gain(8), X.regard(-2)) },
        { label: 'Stay loyal', desc: 'Your word is good. The others think better of you.', fx: () => X.regard(2) }] },
    { day: 14, icon: '✉️', title: 'Letters from home', text: 'Reward: letters from home. You can read yours — or give it to the rival who hasn’t heard from anyone in weeks.',
      choices: [
        { label: 'Read it', desc: 'Every unit heals.', fx: () => X.heal() },
        { label: 'Give it away', desc: 'The others will remember this at the vote.', fx: () => X.regard(3) }] },
    { day: 21, icon: '🪵', title: 'A fake idol', text: 'A stick, some string, a carved face. It would fool someone. It would also be remembered.',
      choices: [
        { label: 'Plant it', desc: 'A rival wastes their real idol, or you gain 6 🐚. Your name suffers.', fx: () => joinFx(X.rivalIdol(), X.regard(-2)) },
        { label: 'Don’t', desc: 'Play it straight. The others think better of you.', fx: () => X.regard(1) }] },
  ],
};

// A story moment is due when its day comes and nothing else is waiting.
function queueStory() {
  const list = STORIES[TRIBES[S.players[0].tribe].key] || [];
  if (S.story.pending != null) return;
  const i = list.findIndex((e, k) => !S.story.done.includes(k) && e.day <= S.turn);
  if (i >= 0) S.story.pending = i;
}
function storyNow() {
  if (S.story.pending == null) return null;
  return (STORIES[TRIBES[S.players[0].tribe].key] || [])[S.story.pending] || null;
}
function chooseStory(ci) {
  const e = storyNow(); if (!e) return '';
  S.story.done.push(S.story.pending); S.story.pending = null;
  const msg = e.choices[ci].fx();
  logIt(`${e.title}: ${e.choices[ci].label}`);
  return msg;
}
