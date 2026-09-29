// Plays whole games with the computer in every seat and checks the rules hold:
//   node test/core.test.js [games]
// No browser needed: core.js has no DOM in it.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
const ctx = { console, Math, JSON, localStorage: { getItem: () => null, setItem() { }, removeItem() { } } };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.api = { newGame, aiTurn, startTurn, checkElims, beginRound, flies, WONDERS, moveInfo, combat, get S(){return S}, set S(v){S=v}, UNITS, isWater, tileAt, I, has };', ctx);
const A = ctx.api;

function check(S, where) {
  const seen = new Set();
  for (const u of S.units) {
    const k = u.x + ',' + u.y;
    if (seen.has(k)) throw new Error(where + ': two units on ' + k);
    seen.add(k);
    if (u.hp <= 0) throw new Error(where + ': dead unit left on map');
    if (u.hp > A.UNITS[u.type].hp + (u.vet ? 5 : 0)) throw new Error(where + ': overhealed ' + u.type);
    const t = S.tiles[u.y * S.n + u.x];
    if (!u.boat && !A.flies(u) && A.isWater(t.t)) throw new Error(where + ': land unit in water');
    if (u.boat && !A.isWater(t.t)) throw new Error(where + ': boat on land');
    if (!S.players[u.owner].alive) throw new Error(where + ': unit of fallen tribe');
  }
  for (const P of S.players) if (P.stars < 0) throw new Error(where + ': negative stars ' + P.stars);
  for (const c of S.cities) if (c.owner >= 0 && c.pop > c.level) throw new Error(where + ': city pop overflow');
}

(async () => {
  const games = +process.argv[2] || 24;
  const tally = { finished: 0, turns: [] };
  const used = {};
  const bump = k => used[k] = (used[k] || 0) + 1;
  for (let g = 0; g < games; g++) {
    const opts = { tribe: g % 4, opponents: 1 + g % 3, size: ['small', 'medium', 'large'][g % 3], diff: ['easy', 'normal', 'hard'][g % 3] };
    const S = A.newGame(opts);
    S.players[0].human = false;              // let the computer play our seat too
    check(S, 'start');
    let turn = 0;
    for (; turn < 120 && !S.over; turn++) {
      for (let p = 0; p < S.players.length && !S.over; p++) {
        if (!S.players[p].alive) continue;
        S.cur = p;
        A.startTurn(p);
        await A.aiTurn(p);
        A.checkElims();
        check(S, `game ${g} turn ${S.turn} p${p}`);
      }
      S.turn++;
      A.beginRound();
      if (S.offer) S.offer = null;              // nobody to answer peace offers
      // with no human seat, "over" means one tribe left
      const alive = S.players.filter(P => P.alive).length;
      if (alive <= 1) break;
      S.over = null;
    }
    for (const k of Object.keys(S.wonders)) bump('wonder:' + k);
    for (const u of S.units) if (['envoy', 'eagle', 'shaman'].includes(u.type)) bump(u.type);
    for (const t of S.tiles) if (t.imp === 'market') bump('market');
    for (const P of S.players) if (P.converts) bump('converts');
    if (S.log.some(l => /: /.test(l.msg))) bump('events');
    const alive = S.players.filter(P => P.alive).length;
    if (alive <= 1) { tally.finished++; tally.turns.push(S.turn); }
    const cities = S.players.map(P => S.cities.filter(c => c.owner === P.id).length).join('/');
    console.log(`game ${g} ${opts.size} ${opts.opponents + 1}p ${opts.diff}: turn ${S.turn}, alive ${alive}, cities ${cities}, units ${S.units.length}, villages left ${S.cities.filter(c => c.owner < 0).length}`);
  }
  console.log('\nused across all games: ' + Object.entries(used).map(([k, v]) => k + ' ' + v).join(', '));
  console.log(`\n${tally.finished}/${games} games ended in domination; turns ${tally.turns.sort((a, b) => a - b).join(',')}`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
