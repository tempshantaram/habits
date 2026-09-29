/* Tribelands — the HUD, the bottom panel, the floating buttons and every sheet. */

// ---------- doing things ----------
// `o.undo` names the action ("move", "hunt"…) and makes it undoable.
async function act(fn, o = {}) {
  if (busy || !S || S.over) return;
  busy = true;
  const snap = JSON.stringify(S);
  revealed = 0;
  const hadRewards = S.pendingRewards.length;
  let msg;
  try { msg = await fn(); }
  catch (err) { console.error(err); }
  busy = false;
  disbandArm = null;
  if (o.undo && revealed === 0 && S.pendingRewards.length === hadRewards) {
    undoStack.push({ snap, label: o.undo });
    if (undoStack.length > 40) undoStack.shift();
  } else undoStack = [];
  if (typeof msg === 'string' && msg !== 'idol') toast(msg);
  afterAction();
}
function afterAction() {
  checkElims();
  saveGame();
  refreshSel();
  renderHud();
  renderPanel();
  kick();
  if (!$('#modal').hidden && $('#modal').dataset.closable === '') return;   // a choice is already open
  if (S.pendingRewards.length) showReward();
  else if (S.offer && S.offer.from != null && !S.over) showOffer();
  else if (S.challenge && !S.challenge.seen && !S.over) showChallenge();
  else if (S.event && S.event.turn === S.turn && !S.event.seen && !S.over) showEvent();
  else if (S.over && !S.overShown) showGameOver();
}
function undo() {
  if (busy || !undoStack.length) return;
  S = JSON.parse(undoStack.pop().snap);
  disbandArm = null; buzz(10);
  refreshSel(); renderHud(); renderPanel(); saveGame(); kick();
}
async function endTurn() {
  if (busy || !S || S.over) return;
  buzz(20);
  busy = true;
  sel = null; undoStack = []; disbandArm = null;
  $('#btnEnd').classList.remove('nudge');
  refreshSel();
  for (let p = 1; p < S.players.length; p++) {
    if (!S.players[p].alive) continue;
    S.cur = p;
    renderHud(); renderPanel();
    startTurn(p);
    try { await aiTurn(p); } catch (err) { console.error(err); }
    checkElims();
    kick();
    if (S.over) break;
  }
  if (!S.over) {
    S.turn++;
    S.cur = 0;
    revealed = 0;
    beginRound();
    startTurn(0);
    vision();
    toast(`Day ${S.turn} · +${income(0)} ${SH}`);
  }
  busy = false;
  afterAction();
}

// ---------- HUD and floating buttons ----------
function renderHud() {
  const on = mode === 'game';
  $('#hud').hidden = !on; $('#fabs').hidden = !on;
  if (!on) return;
  const P = S.players[0];
  $('#hudDot').style.background = TRIBES[P.tribe].color;
  $('#hudStars').textContent = P.stars;
  $('#hudInc').textContent = '+' + income(0);
  $('#btnIdols').hidden = !P.idols;
  $('#hudIdols').textContent = P.idols;
  const u0 = undoStack[undoStack.length - 1];
  $('#btnUndo').disabled = busy || !u0;
  $('#undoLbl').textContent = u0 ? 'Undo ' + u0.label : 'Undo';
  $('#btnEnd').disabled = busy || !!S.over;
  const ready = S.cur === 0 && !busy ? readyUnits().length : 0;
  $('#nextCount').textContent = ready;
  $('#btnNext').classList.toggle('none', !ready);
  $('#btnNext').disabled = busy || !!S.over;
  if (ready) $('#btnEnd').classList.remove('nudge');
}
$('#btnStars').addEventListener('click', () => { if (!busy) openIncome(); });
$('#btnIdols').addEventListener('click', () => { if (!busy) openIdols(); });
$('#btnTribes').addEventListener('click', () => { if (!busy) openTribes(); });
$('#btnEnd').addEventListener('click', endTurn);
$('#btnUndo').addEventListener('click', undo);
$('#btnNext').addEventListener('click', nextUnit);
// keep the floating buttons just above the panel, whatever its height
new ResizeObserver(() => document.documentElement.style.setProperty('--ph', $('#panel').hidden ? '0px' : $('#panel').offsetHeight + 'px')).observe($('#panel'));

// ---------- the bottom panel ----------
const tag = p => `<span class="tag" style="background:${colOf(p)}">${TRIBES[S.players[p].tribe].name}</span>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// One action button: what it is, what it does, what it costs, and — if it can't be pressed — why.
function actBtn({ a, icon, title, effect, cost, block, go, quiet, wide }) {
  const dis = !!block;
  return `<button class="act${go && !dis ? ' go' : ''}${wide ? ' wide' : ''}" data-a="${a}"${dis ? ' disabled' : ''}>
    <i>${icon}</i><span class="t"><span class="hd"><b>${title}</b>${cost != null ? `<span class="c">${cost === 0 ? 'Free' : cost + ' ' + SH}</span>` : ''}</span>${effect ? `<small>${effect}</small>` : ''}${dis && !quiet ? `<em>${block}</em>` : ''}</span></button>`;
}
const sec = t => `<div class="sec">${t}</div>`;
const hint = t => `<div class="hint">${t}</div>`;
let disbandArm = null;

function renderPanel() {
  const panel = $('#panel');
  panel.hidden = mode !== 'game';
  if (panel.hidden) return;
  renderHud();
  const info = $('#pinfo'), acts = $('#pacts');
  panel.style.setProperty('--selc', 'transparent');
  if (busy && S.cur !== 0) {
    info.innerHTML = `<h3>${tag(S.cur)} is on the move…</h3><p>Day ${S.turn}. Rival tribes are taking their turns.</p>`;
    acts.innerHTML = '';
    return;
  }
  if (S.over) {
    info.innerHTML = `<h3>${S.over === 'win' ? '👑 Sole survivors' : 'Voted off'} · Day ${S.turn}</h3><p>Open the menu ☰ to start a new game.</p>`;
    acts.innerHTML = '';
    return;
  }
  if (!sel) {
    const ready = readyUnits().length;
    info.innerHTML = `<h3>${tag(0)} Day ${S.turn}</h3><p>${ready ? `<b>${ready}</b> ${ready === 1 ? 'unit has' : 'units have'} moves left (green rings). Tap one, or press ▶ Next.` : 'Everyone has acted. Build, learn a skill, or end your turn.'}</p>`;
    acts.innerHTML = '';
    return;
  }
  if (sel.kind === 'unit') unitPanel(unitById(sel.id), info, acts);
  else tilePanel(sel.i, info, acts);
}

function unitPanel(u, info, acts) {
  const s = st(u), mh = maxHp(u), U = UNITS[u.type];
  $('#panel').style.setProperty('--selc', colOf(u.owner));
  const skills = Object.keys(SKILLS).filter(k => (u.boat ? BOATS[u.boat] : U)[k]);
  const chip = k => `<span class="skill"><b>${SKILLS[k][0]}</b> ${SKILLS[k][1]}</span>`;
  const stats = `<span class="stat">⚔️ ${s.atk}</span><span class="stat">🛡️ ${s.def}</span><span class="stat">👣 ${mvOf(u)}</span>${s.rng > 1 ? `<span class="stat">🎯 ${s.rng}</span>` : ''}`;
  info.innerHTML = `<div class="selwhat">Selected unit${u.owner === 0 ? '' : ' · rival'}</div>
    <h3>${tag(u.owner)} ${(u.boat ? BOATS[u.boat] : U).icon} ${unitName(u)}${u.vet ? ' <span class="vet">★ Veteran</span>' : ''}</h3>
    <p><span class="hpbar"><i style="width:${u.hp / mh * 100}%"></i></span> ${u.hp}/${mh} HP ${stats}</p>
    ${u.owner === 0 ? `<p class="status ${exhausted(u) ? 'done' : ''}">${unitStatus(u)}</p>` : ''}`;
  let h = '';
  if (skills.length) h += `<div class="skills">${skills.map(chip).join('')}</div>`;
  if (wades(u) && isWater(tileAt(u.x, u.y).t)) h += hint('🏊 Wading through the lagoon (Moku trait).');
  if (u.owner !== 0) {
    const peace = atPeace(0, u.owner);
    const mine = unitsOf(0).filter(v => targets(v).includes(u));
    h += hint(peace ? `🤝 You have a truce with the ${tribeOf(u.owner).name} for ${peaceLeft(0, u.owner)} more turns. Neither side can attack.`
      : mine.length ? `${mine.length === 1 ? 'One of your units' : mine.length + ' of your units'} can attack it: select yours, then tap the red ring.`
        : 'A rival unit. Bring your units within range to attack it.');
    acts.innerHTML = h;
    return;
  }
  const here = cityAtI(I(u.x, u.y));
  if (here && here.owner !== 0 && !u.boat) {
    const peace = atPeace(0, here.owner);
    const idolRisk = here.owner >= 0 && S.players[here.owner].idols > 0;
    h += actBtn({ a: 'capture', icon: '🚩', title: here.owner < 0 ? 'Recruit the castaways' : 'Take ' + here.name,
      effect: here.owner < 0 ? 'The shack becomes your new camp. Uses this unit’s turn.' : 'The camp, its land and any landmark become yours.' + (idolRisk ? ' ⚠️ They hold an idol: it would cancel this and vote your unit off.' : ''),
      block: peace ? 'You have a truce with its owner' : canCapture(u) ? '' : 'Works at the start of your next turn, if this unit is still here', go: true, wide: true });
  }
  if (tileAt(u.x, u.y).ruin) h += actBtn({ a: 'ruin', icon: '⚓', title: 'Salvage the wreck', effect: 'Shells, a survival manual, a map, a survivor… or a hidden idol. Uses this unit’s turn.',
    block: canRuin(u) ? '' : 'This unit has already attacked this turn', go: true, wide: true });
  if (!u.boat && U.heal) {
    const n = S.units.filter(v => v.owner === 0 && v !== u && cheb(u.x, u.y, v.x, v.y) <= 1 && v.hp < maxHp(v)).length;
    h += actBtn({ a: 'heal', icon: '🌿', title: 'Heal allies', effect: `+4 HP to ${n || 'each'} wounded ${n === 1 ? 'unit' : 'units'} next to the Healer`,
      block: u.attacked ? 'Already acted this turn' : n ? '' : 'No wounded units next to it', go: true });
  }
  if (u.hp < mh) h += actBtn({ a: 'recover', icon: '❤️', title: 'Rest',
    effect: `Heals ${ownerOfI(I(u.x, u.y)) === 0 ? 4 : 2} HP (4 in your land, 2 elsewhere). Ends its turn.`,
    block: canRecover(u) ? '' : 'Only before it moves or attacks' });
  if (here && here.owner === 0) h += actBtn({ a: 'city', icon: '🏕️', title: 'Open ' + here.name, effect: 'Train units, grow the camp, raise landmarks' });
  h += actBtn({ a: 'disband', icon: disbandArm === u.id ? '⚠️' : '👋', title: disbandArm === u.id ? 'Tap again to send home' : 'Send home',
    effect: disbandArm === u.id ? 'This removes the unit for good' : 'Removes the unit and frees a slot in its camp' });
  const tips = [];
  if (!exhausted(u)) {
    if (selMoves.dests.size) tips.push('⬜ Tap a white marker to move there.');
    if (selTargets.length) tips.push(U.convert && !u.boat ? '🔴 Tap a red ring to sway that unit to your side.' : '🔴 Tap a red ring to attack. The label shows the damage you deal, and ↩ what you take back.');
    if (!selMoves.dests.size && !selTargets.length && !u.moved) tips.push('Nowhere to move from here.');
  }
  acts.innerHTML = h + (tips.length ? hint(tips.join('<br>')) : '');
}

const RES_TIP = {
  coconut: `Crack them for +1 survivor (needs Foraging).`,
  taro: 'Plant a garden here for +2 survivors (needs Gardening).',
  boar: 'Hunt it for +1 survivor (needs Tracking).',
  fish: 'Spear them for +1 survivor (needs Spearfishing).',
  obsidian: 'Quarry it for +2 survivors (needs Quarrying).',
};
function workEffect(i, key) {
  const t = S.tiles[i], W = WORKS[key], c = t.city >= 0 ? S.cities[t.city] : null;
  if (key === 'burn') return `+1 ${SH} now; the jungle becomes grassland`;
  if (key === 'trail') return 'Moving from trail to trail (or camp) costs half a step';
  if (key === 'signal') return `+1 ${SH} every turn from passing traders, and you see 3 tiles around it`;
  if (key === 'post') return `Earns +${postValue(i)} ${SH} every turn right now: +1 for each garden, quarry, hut or dock beside it (max 4)`;
  const who = c && c.owner === 0 ? ' for ' + c.name : '';
  const lvl = c && c.owner === 0 && c.pop + W.pop >= c.level + 1 ? ' — levels the camp up!' : '';
  return `+${W.pop} survivor${W.pop > 1 ? 's' : ''}${who}${lvl}${key === 'dock' ? '. Units that walk in become rafts' : ''}`;
}
function tilePanel(i, info, acts) {
  const t = S.tiles[i];
  if (!seen(i)) { info.innerHTML = '<div class="selwhat">Selected tile</div><h3>☁️ Unexplored</h3><p>Send a unit this way to see what is here.</p>'; acts.innerHTML = ''; return; }
  const c = cityAtI(i), o = ownerOfI(i);
  if (o >= 0) $('#panel').style.setProperty('--selc', colOf(o));
  let h = '';
  const unit = unitAt(...XY(i));
  if (S.challenge && S.challenge.i === i) {
    const C = CHALLENGES[S.challenge.kind];
    info.innerHTML = `<div class="selwhat">Selected tile</div><h3>${C.icon} ${C.name}</h3><p>${C.desc} ${S.challenge.until - S.turn + 1} turns left.</p>`;
  } else if (c && c.owner < 0) {
    info.innerHTML = `<div class="selwhat">Selected tile</div><h3>🆘 Stranded castaways</h3><p>Move a unit here. At the start of your next turn it can recruit them, and the shack becomes your camp.</p>`;
  } else if (c) cityPanel(c, info, a => h += a);
  else {
    const what = [TERRAIN_NAME[t.t], t.volcano && 'Volcano', t.res && RES_NAME[t.res], t.imp && IMP_NAME[t.imp], t.road && 'Trail', t.ruin && 'Shipwreck'].filter(Boolean).join(' · ');
    const tip = t.volcano ? 'It smoulders. When it erupts, units within 2 tiles are hurt and fresh obsidian cools on the cliffs.'
      : t.res ? RES_TIP[t.res] : t.imp === 'post' ? `This trading post earns +${postValue(i)} ${SH} every turn.` : t.ruin ? 'Move a unit here, then salvage the wreck.' : '';
    info.innerHTML = `<div class="selwhat">Selected tile</div><h3>${TERRAIN_ICON[t.t]} ${what}</h3><p>${o >= 0 ? 'Land of ' + S.cities[t.city].name + ' (' + TRIBES[S.players[o].tribe].name + ')' : 'No one’s land'}${defNote(t)}</p>${tip ? `<p>${tip}</p>` : ''}`;
    for (const k of Object.keys(WORKS)) {
      const Wk = WORKS[k];
      if (!Wk.ok(t)) continue;
      if ((k === 'trail' || k === 'post' || k === 'signal') && !has(0, Wk.tech)) continue;     // don't clutter every tile
      h += actBtn({ a: 'work:' + k, icon: Wk.icon, title: Wk.name, effect: workEffect(i, k), cost: workCost(0, k), block: workBlock(0, i, k), go: true });
    }
    if (o === 0 && !h) h += hint('Nothing to build here yet. New skills open up more to do.');
  }
  if (unit) h += actBtn({ a: 'unit', icon: (unit.boat ? BOATS[unit.boat] : UNITS[unit.type]).icon, title: 'Select ' + unitName(unit), effect: 'The unit standing here' });
  acts.innerHTML = h;
}
function cityPanel(c, info, add) {
  const pips = '<span class="pips">' + Array.from({ length: c.level + 1 }, (_, k) => `<i class="${k < c.pop ? 'on' : ''}"></i>`).join('') + '</span>';
  const w = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
  const extras = [c.capital && '♛ First camp', c.walls && '🪵 Palisade', c.workshop && '🔨 Toolmaker', c.parks && '🏝️ Hammocks', w && WONDERS[w].icon + ' ' + WONDERS[w].name].filter(Boolean).join(' · ');
  info.innerHTML = `<div class="selwhat">Selected camp</div><h3>${tag(c.owner)} ${c.name} · ${levelName(c.level)} (level ${c.level})</h3>
    <p>Survivors ${pips} ${c.pop}/${c.level + 1} to level ${c.level + 1} · +${cityIncome(c)} ${SH}/turn · Units ${homeCount(c)}/${capacity(c)}</p>${extras ? `<p>${extras}</p>` : ''}`;
  if (c.owner !== 0) return;
  add(sec('Train a unit'));
  // A reason that blocks every unit is said once, not on each button.
  const common = unitAt(c.x, c.y) ? '🚶 A unit is standing in the camp. Move it off to train here.'
    : homeCount(c) >= capacity(c) ? `🏕️ ${c.name} can support ${capacity(c)} units and has ${homeCount(c)}. Grow the camp (or send a unit home) to train more.` : '';
  if (common) add(`<div class="banner">${common}</div>`);
  for (const k of TRAINABLE) {
    const U = UNITS[k];
    if (U.tech && !has(0, U.tech)) continue;
    const sk = Object.keys(SKILLS).filter(x => U[x]).map(x => SKILLS[x][0]).join(', ');
    add(actBtn({ a: 'train:' + k, icon: U.icon, title: U.name, effect: `⚔️${U.atk} 🛡️${U.def} 👣${U.mv}${U.rng > 1 ? ' 🎯' + U.rng : ''} · ${U.hp} HP${sk ? ' · ' + sk : ''}`,
      cost: U.cost, block: trainBlock(0, c, k), quiet: !!common }));
  }
  const locked = TRAINABLE.filter(k => UNITS[k].tech && !has(0, UNITS[k].tech)).length;
  if (locked) add(hint(`🧠 ${locked} more unit types unlock through Skills.`));
  const wk = Object.keys(WONDERS).filter(k => has(0, WONDERS[k].tech) || S.wonders[k] != null);
  if (wk.length) {
    add(sec('Landmarks — one of each in all the islands'));
    const holds = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
    if (holds) add(`<div class="banner">${WONDERS[holds].icon} <b>${WONDERS[holds].name}</b> stands here: ${WONDERS[holds].desc} A camp holds one landmark, so raise the others elsewhere.</div>`);
    for (const k of wk) {
      if (k === holds) continue;
      const Wd = WONDERS[k], elsewhere = S.wonders[k] != null;
      const who = elsewhere ? `The ${TRIBES[S.players[wonderOwner(k)].tribe].name} hold it in ${S.cities[S.wonders[k]].name}` : '';
      add(actBtn({ a: 'wonder:' + k, icon: Wd.icon, title: Wd.name, effect: Wd.desc + (elsewhere ? ` <b>${who}.</b>` : ''), cost: elsewhere ? null : Wd.cost,
        block: elsewhere ? 'Taken' : wonderBlock(0, c, k), quiet: elsewhere || !!holds, go: true, wide: true }));
    }
  }
}
function defNote(t) {
  if (t.t === FOREST) return has(0, 'slings') || tribeIs(0, 3) ? ' · Your units defend +50% here' : ' · Slings give +50% defence here';
  if (t.t === MOUNTAIN) return has(0, 'climbing') ? ' · Your units defend +50% here' : ' · Needs Climbing to enter';
  if (t.t === SHALLOW) return tribeIs(0, 1) ? ' · Your units can wade here' : ' · Build a raft dock to take to the water';
  if (t.t === OCEAN) return ' · Rafts need Rafting to cross';
  return '';
}
$('#pacts').addEventListener('click', e => {
  const b = e.target.closest('button[data-a]');
  if (!b || b.disabled || busy) return;
  const [a, k] = b.dataset.a.split(':');
  const u = sel && sel.kind === 'unit' ? unitById(sel.id) : null;
  const i = sel && sel.kind === 'tile' ? sel.i : u ? I(u.x, u.y) : -1;
  if (a !== 'disband') disbandArm = null;
  buzz(12);
  if (a === 'capture') act(() => doCapture(u));
  else if (a === 'ruin') act(() => doRuin(u));
  else if (a === 'heal') act(() => { const n = doHeal(u); return `The Healer tended ${n} ${n === 1 ? 'unit' : 'units'}.`; }, { undo: 'heal' });
  else if (a === 'recover') act(() => doRecover(u), { undo: 'rest' });
  else if (a === 'disband') {
    if (disbandArm !== u.id) { disbandArm = u.id; renderPanel(); return; }
    act(() => { killUnit(u); S.players[0].lost--; }, { undo: 'send home' });
  }
  else if (a === 'city') select({ kind: 'tile', i });
  else if (a === 'unit') { const v = unitAt(...XY(i)); if (v) select({ kind: 'unit', id: v.id }); }
  else if (a === 'train') act(() => { doTrain(0, cityAtI(i), k); }, { undo: 'train' });
  else if (a === 'work') act(() => doWork(0, i, k), { undo: WORKS[k].name.toLowerCase() });
  else if (a === 'wonder') act(() => { doWonder(0, cityAtI(i), k); return WONDERS[k].name + ' raised!'; });
});

// ---------- toast ----------
let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2800);
}

// ---------- sheets ----------
function openSheet(html, closable = true) {
  $('#sheet').innerHTML = (closable ? '<button class="close" data-x aria-label="Close">×</button>' : '') + html;
  $('#modal').hidden = false;
  $('#modal').dataset.closable = closable ? '1' : '';
  $('#sheet').scrollTop = 0;
}
function closeSheet() { $('#modal').hidden = true; $('#modal').dataset.closable = '1'; }
$('#modal').addEventListener('click', e => {
  if (e.target.closest('[data-x]') || (e.target === $('#modal') && $('#modal').dataset.closable)) {
    closeSheet();
    if (mode === 'game' && S && !busy) afterAction();          // anything queued behind this sheet
  }
});

// The skill web: three columns by survival day; picking a skill lights up what it needs and what it leads to.
let techSel = null;
function openTech() {
  if (busy) return;
  const P = S.players[0], col = TRIBES[P.tribe].color;
  const needs = techSel ? TECHS[techSel].needs : [];
  const leads = techSel ? Object.keys(TECHS).filter(k => TECHS[k].needs.includes(techSel)) : [];
  const node = t => {
    const T = TECHS[t], done = has(0, t), ready = techReady(0, t);
    const cls = [done ? 'done' : ready ? (canResearch(0, t) ? 'can' : '') : 'locked', techSel === t && 'sel', needs.includes(t) && 'need', leads.includes(t) && 'lead'].filter(Boolean).join(' ');
    const sub = done ? '✓ Known' : (ready ? '' : '🔒 ') + techCost(0, t) + ' ' + SH;
    return `<button class="tn ${cls}" style="--c:${col}" data-t="${t}"><i>${T.icon}</i><b>${T.name}</b><span>${sub}</span></button>`;
  };
  let h = `<h2>🧠 Skills</h2><p class="muted">You have ${P.stars} ${SH}. Later skills need two earlier ones. Tap a skill to see what it teaches and what it needs. Every camp you own makes learning dearer.</p><div class="web">`;
  for (const d of [1, 2, 3]) h += `<div class="day">${DAYS[d]}</div>`;
  for (const d of [1, 2, 3]) h += `<div class="col">${Object.keys(TECHS).filter(k => TECHS[k].tier === d).map(node).join('')}</div>`;
  h += `</div><div class="legend"><b style="border:3px solid var(--good)"></b>affordable now · <b style="border:3px dashed #3C8CE7"></b>needed by your pick · <b style="border:3px dotted #9B6BE0"></b>it leads to</div><div class="tdetail" id="tdetail"></div>`;
  openSheet(h);
  techDetail();
  $('#sheet').querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    techSel = b.dataset.t; buzz(8);
    const top = $('#sheet').scrollTop; openTech(); $('#sheet').scrollTop = top;
    $('#tdetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }));
}
function techDetail() {
  const el = $('#tdetail');
  if (!techSel) { el.innerHTML = '<p class="muted">Nothing picked yet. Green-edged skills are ones you can afford now.</p>'; return; }
  const T = TECHS[techSel], done = has(0, techSel), cost = techCost(0, techSel);
  let h = `<h3 style="margin:0 0 6px;font-size:20px">${T.icon} ${T.name} <small class="muted" style="font-weight:600">· ${DAYS[T.tier]}</small></h3><ul class="unlocks">${T.unlocks.map(x => `<li>${x}</li>`).join('')}</ul>`;
  if (T.needs.length) h += `<p class="muted">Needs: ${T.needs.map(n => (has(0, n) ? '✓ ' : '✗ ') + TECHS[n].name).join(' and ')}</p>`;
  if (done) h += '<p><b>✓ Your tribe already knows this.</b></p>';
  else if (!techReady(0, techSel)) h += `<p class="muted">🔒 Learn ${T.needs.filter(n => !has(0, n)).map(n => TECHS[n].name).join(' and ')} first.</p>`;
  else {
    const short = cost - S.players[0].stars;
    h += `<div class="row"><button class="big primary" id="doTech" ${short > 0 ? 'disabled' : ''}>${short > 0 ? `Need ${short} more ${SH} (costs ${cost})` : `Learn for ${cost} ${SH}`}</button></div>`;
  }
  el.innerHTML = h;
  const b = $('#doTech');
  if (b) b.addEventListener('click', () => {
    const t = techSel;
    closeSheet(); buzz(20);
    act(() => { doResearch(0, t); return 'Learned ' + TECHS[t].name; }, { undo: 'learn' });
  });
}
$('#btnTech').addEventListener('click', openTech);

function openIncome() {
  const parts = incomeParts(0);
  openSheet(`<h2>${SH} Shells</h2><p class="muted">You have ${S.players[0].stars} ${SH} and earn <b>+${income(0)}</b> at the start of each day.</p>
    <div class="ledger">${parts.map(x => `<span>${esc(x.label)}<small>${x.why}</small></span><b>+${x.v}</b>`).join('')}</div>
    ${hint(`Grow camps, pick Toolmakers and Hammock groves, light signal fires on cliffs, build trading posts beside gardens and quarries, or raise the Floating Market.`)}`);
}
function openIdols() {
  const n = S.players[0].idols;
  openSheet(`<div class="bigicon">🗿</div><h2>Hidden immunity idols: ${n}</h2>
    <p>If a rival would take one of your camps, an idol is played for you automatically. The capture is cancelled, and the raider is voted off the island.</p>
    <p class="muted">Idols turn up in shipwrecks and are the prize in immunity challenges. Rival tribes can hold them too, so watch for the ⚠️ warning before you raid.</p>`);
}
function openTribes() {
  const me = S.players[0], T0 = TRIBES[me.tribe];
  let h = `<h2>👥 Tribes</h2>
    <div class="tcard" style="--c:${T0.color}"><b><i></i>You: ${T0.name}${me.idols ? ` <small>🗿 ${me.idols} idol${me.idols > 1 ? 's' : ''}</small>` : ''}</b><span>${T0.trait.icon} <b>${T0.trait.name}</b>: ${T0.trait.desc}</span></div>`;
  for (const P of S.players.slice(1)) {
    const T = TRIBES[P.tribe], q = P.id;
    const cities = citiesOf(q).length, units = unitsOf(q).length;
    const rel = !P.alive ? 'Out' : atPeace(0, q) ? `🤝 Truce, ${peaceLeft(0, q)} more turns` : '⚔️ Rivals';
    const ratio = strength(q) / Math.max(1, strength(0));
    const power = ratio > 1.3 ? 'Stronger than you' : ratio < .75 ? 'Weaker than you' : 'About as strong as you';
    let btn = '';
    if (P.alive && !atPeace(0, q)) {
      const cost = truceCost(0, q), asked = me.asked[q] != null && S.turn - me.asked[q] < 3;
      const block = !has(0, 'alliances') ? 'Learn Alliances to offer truces' : asked ? 'They refused recently; try again in a few turns'
        : me.stars < cost ? `Need ${cost - me.stars} more ${SH}` : '';
      btn = actBtn({ a: 'truce:' + q, icon: '🤝', title: 'Offer an alliance', effect: 'Pay them for 8 turns of peace. Weaker tribes are more willing.', cost, block, go: true });
    }
    h += `<div class="tcard" style="--c:${T.color}"><b><i></i>${T.name} <small>${rel}</small></b>
      <span>${T.trait.icon} ${T.trait.name}: ${T.trait.desc}</span>
      <span>${P.alive ? `${cities} ${cities === 1 ? 'camp' : 'camps'} · ${units} units${P.idols ? ` · 🗿 ${P.idols} idol${P.idols > 1 ? 's' : ''}` : ''} · ${power}` : 'This tribe has been voted off the islands.'}</span>${btn ? `<div class="pacts1">${btn}</div>` : ''}</div>`;
  }
  const log = S.log.slice(-8).reverse();
  if (log.length) h += `<h4>Island diary</h4><ul class="chron">${log.map(l => `<li><small>Day ${l.t}</small> ${esc(l.msg)}</li>`).join('')}</ul>`;
  openSheet(h);
  $('#sheet').querySelectorAll('[data-a^="truce:"]').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    const q = +b.dataset.a.split(':')[1], cost = truceCost(0, q);
    if (truceAccepted(0, q)) {
      S.players[0].stars -= cost; S.players[q].stars += cost;
      makeTruce(0, q, 8);
      logIt(`The ${TRIBES[me.tribe].name} and the ${tribeOf(q).name} formed an alliance`);
      toast(`The ${tribeOf(q).name} accept: 8 turns of peace.`); buzz(20);
    } else {
      me.asked[q] = S.turn;
      toast(`The ${tribeOf(q).name} refuse. They think they can win.`);
    }
    undoStack = []; afterAction(); openTribes();
  }));
}
function showOffer() {
  const o = S.offer, T = tribeOf(o.from);
  openSheet(`<div class="bigicon">🤝</div><h2>The ${T.name} want an alliance</h2>
    <p class="muted">They offer <b>${o.gift} ${SH}</b> for a truce of ${o.turns} turns. During a truce neither of you can attack the other or take each other’s camps.</p>
    <div class="row" style="margin-top:14px"><button class="big primary" data-o="yes">Accept · +${o.gift} ${SH}</button><button class="big" data-o="no">Refuse and fight on</button></div>`, false);
  $('#sheet').querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.o === 'yes') {
      S.players[0].stars += o.gift; S.players[o.from].stars -= o.gift;
      makeTruce(0, o.from, o.turns);
      logIt(`The ${tribeOf(0).name} accepted an alliance from the ${T.name}`);
    }
    S.offer = null;
    closeSheet(); undoStack = []; afterAction();
  }));
}
function showEvent() {
  const E = EVENTS[S.event.key];
  S.event.seen = true; saveGame();
  const volc = S.event.key === 'eruption';
  openSheet(`<p class="muted" style="margin:0">The island stirs · Day ${S.turn}</p><div class="bigicon">${E.icon}</div><h2>${E.name}</h2><p>${E.desc}</p>
    <div class="row" style="margin-top:14px">${volc ? '<button class="big" data-look="v">Show me the volcano</button>' : ''}<button class="big primary" data-x>Continue</button></div>`);
  const b = $('#sheet').querySelector('[data-look]');
  if (b) b.addEventListener('click', () => { closeSheet(); centerOn(...XY(S.volcano)); kick(); afterAction(); });
}
function showChallenge() {
  const ch = S.challenge, C = CHALLENGES[ch.kind];
  ch.seen = true; saveGame();
  openSheet(`<p class="muted" style="margin:0">Come on in, castaways · Day ${S.turn}</p><div class="bigicon">${C.icon}</div><h2>${C.name}!</h2>
    <p>${C.desc} Every tribe is racing for it, and it lasts ${ch.until - ch.turn + 1} turns.</p>
    <div class="row" style="margin-top:14px"><button class="big primary" data-look="c">Show me the flag</button><button class="big" data-x>Later</button></div>`);
  $('#sheet').querySelector('[data-look]').addEventListener('click', () => {
    closeSheet(); centerOn(...XY(ch.i)); select({ kind: 'tile', i: ch.i }, false); afterAction();
  });
}
function showReward() {
  const cid = S.pendingRewards[0], c = S.cities[cid];
  if (!c || c.owner !== 0) { S.pendingRewards.shift(); afterAction(); return; }
  const opts = rewardChoices(c.level);
  buzz([20, 50, 20]);
  openSheet(`<h2>🎉 ${c.name} is now a ${levelName(c.level)} (level ${c.level})!</h2><p class="muted">Choose one reward. You can’t change it later.</p>
    <div class="row" style="margin-top:12px">${opts.map(k => `<button class="reward" data-r="${k}"><i>${REWARDS[k].icon}</i><b>${REWARDS[k].name}</b><span>${REWARDS[k].desc}</span></button>`).join('')}</div>`, false);
  centerOn(c.x, c.y); kick();
  $('#sheet').querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
    closeSheet();
    act(() => { S.pendingRewards.shift(); applyReward(c, b.dataset.r); });
  }));
}
function showGameOver() {
  S.overShown = true; saveGame();
  const P = S.players[0], win = S.over === 'win';
  openSheet(`<div class="bigicon">${win ? '👑' : '🔥'}</div><h2>${win ? 'Sole survivors!' : 'The tribe has spoken'}</h2>
    <p class="muted">${win ? `The ${TRIBES[P.tribe].name} are the last tribe standing on the Ember Isles.` : 'A rival tribe has taken your last camp. Your torch is snuffed.'}</p>
    <div class="stats"><span class="muted">Days survived</span><b>${S.turn}</b>
      <span class="muted">Camps</span><b>${citiesOf(0).length}</b>
      <span class="muted">Landmarks</span><b>${Object.keys(WONDERS).filter(k => hasWonder(0, k)).length}</b>
      <span class="muted">Challenges won</span><b>${P.challenges}</b>
      <span class="muted">Rival units defeated</span><b>${P.kills}</b>
      <span class="muted">Units swayed</span><b>${P.converts}</b>
      <span class="muted">Units lost</span><b>${P.lost}</b></div>
    <div class="row"><button class="big primary" data-go="new">New game</button><button class="big" data-x>Look at the map</button></div>`);
  $('#sheet').querySelector('[data-go]').addEventListener('click', openNewGame);
}

function openMenu() {
  if (busy) return;
  openSheet(`<h2>Menu</h2>
    <div class="tmenu" style="max-width:none;margin-top:12px">
      <button class="big primary" data-x>Resume</button>
      <button class="big" data-m="help">How to play</button>
      <button class="big" data-m="settings">Settings</button>
      <button class="big" data-m="new">New game</button>
      <button class="big" data-m="title">Save and quit to title</button>
    </div>`);
  $('#sheet').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.m;
    if (m === 'help') openHelp();
    else if (m === 'settings') openSettings();
    else if (m === 'new') openNewGame();
    else if (m === 'title') { saveGame(); closeSheet(); toTitle(); }
  }));
}
$('#btnMenu').addEventListener('click', openMenu);

function openHelp() {
  openSheet(`<h2>How to play</h2>
    <ul class="help">
      <li>👑 <b>Be the last tribe standing</b>: take every rival camp. Lose your last camp and your tribe is voted off.</li>
      <li>${SH} <b>Shells</b> arrive every day from your camps. Tap the ${SH} counter to see where they come from.</li>
      <li>🥥 <b>Grow camps</b>: tap a resource inside your borders (coconuts, boar, fish, taro, obsidian) and work it. Fill a camp’s survivor dots and it levels up, and you choose a reward.</li>
      <li>🆘 <b>Recruit castaways</b>: move a unit onto a stranded shack. At the start of your next turn it can recruit them as a new camp.</li>
      <li>🟢 <b>Green rings</b> mark units that can still act. ▶ <b>Next</b> hops to each one in turn. The yellow marker shows what you have selected.</li>
      <li>⚔️ <b>Units</b> move, then attack. Jungle and cliffs end a move, and so does stepping next to a rival. Each tribe’s trait bends one of these rules.</li>
      <li>🛡️ <b>Combat</b>: damage depends on attack, defence and health. Defenders strike back if they survive. Camps, palisades, jungle (Slings) and cliffs (Climbing) help defence. Three kills make a veteran.</li>
      <li>🏁 <b>Challenges</b>: a flag goes up somewhere fair. The first unit to reach it wins shells (reward) or a hidden immunity idol (immunity).</li>
      <li>🗿 <b>Idols</b> save a camp from capture, automatically, and vote the raider off the island.</li>
      <li>🧠 <b>Skills</b> unlock by day. Later skills need two earlier ones.</li>
      <li>🗼 <b>Landmarks</b>: one of each in all the islands. Whoever holds the camp holds the landmark.</li>
      <li>🤝 <b>Alliances</b>: pay a rival for 8 turns of peace. A tribe that is losing may offer you one.</li>
      <li>🌋 <b>The island</b> stirs every few days: storms, supply drops, eruptions, castaways washing ashore.</li>
      <li>↩ <b>Undo</b> takes back moves, training, learning and building, until something new is revealed or a fight happens.</li>
      <li>Drag to look around, pinch to zoom. The game saves after every action.</li>
    </ul>`);
}
function openSettings() {
  const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openSheet(`<h2>Settings</h2>
    <h4>Rival turn speed</h4>${seg('speed', [['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']], prefs.speed)}
    <p class="muted" style="font-size:14px">How quickly rival tribes’ moves are shown.</p>
    <h4>Feel</h4><label class="switch"><span>Vibrate on taps and hits</span><input type="checkbox" id="hapt" ${prefs.haptics ? 'checked' : ''}></label>
    <h4>Saved game</h4><p class="muted">The game saves after every action, on this device only.</p>
    <div class="row"><button class="big danger" id="delSave">Delete saved game</button></div>
    <h4>About</h4><p class="muted">Tribelands ${VERSION}. A castaway strategy game in the spirit of The Battle of Polytopia. Runs offline; nothing leaves this device.</p>`);
  $('#sheet').querySelectorAll('[data-seg] button').forEach(b => b.addEventListener('click', () => {
    prefs[b.parentNode.dataset.seg] = b.dataset.v; savePrefs(); openSettings();
  }));
  $('#hapt').addEventListener('change', e => { prefs.haptics = e.target.checked; savePrefs(); buzz(20); });
  $('#delSave').addEventListener('click', () => {
    if (!confirm('Delete the saved game? This cannot be undone.')) return;
    clearSave(); closeSheet(); toTitle();
  });
}

const newOpts = Object.assign({}, prefs.last);
function openNewGame() {
  const seg = (name, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(newOpts[name]) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openSheet(`<h2>New game</h2>
    <h4>Your tribe</h4>
    <div class="tribes">${TRIBES.map((T, k) => `<button class="tribe${newOpts.tribe === k ? ' on' : ''}" style="--c:${T.color}" data-tribe="${k}"><b><i></i>${T.name}</b><span>${T.blurb}</span><span class="trait">${T.trait.icon} <b>${T.trait.name}</b>: ${T.trait.desc}</span></button>`).join('')}</div>
    <h4>Rival tribes</h4>${seg('opponents', [[1, '1'], [2, '2'], [3, '3']])}
    <h4>Island chain</h4>${seg('size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
    <p class="muted" style="font-size:14px">${{ small: 'Quick: about 15 minutes.', medium: 'About 30 minutes.', large: 'A long season: 45 minutes or more.' }[newOpts.size]}</p>
    <h4>Difficulty</h4>${seg('diff', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}
    <p class="muted" style="font-size:14px">${{ easy: 'Rivals are hesitant and slow to attack.', normal: 'Rivals expand, gang up on camps and play to win.', hard: `Rivals start richer and earn +2 ${SH} every day.` }[newOpts.diff]}</p>
    <div class="row" style="margin-top:18px"><button class="big primary" id="startGame">Wash ashore</button></div>`);
  $('#sheet').querySelectorAll('[data-tribe]').forEach(b => b.addEventListener('click', () => { newOpts.tribe = +b.dataset.tribe; buzz(8); const top = $('#sheet').scrollTop; openNewGame(); $('#sheet').scrollTop = top; }));
  $('#sheet').querySelectorAll('[data-seg] button').forEach(b => b.addEventListener('click', () => {
    const k = b.parentNode.dataset.seg;
    newOpts[k] = k === 'opponents' ? +b.dataset.v : b.dataset.v;
    buzz(8); const top = $('#sheet').scrollTop; openNewGame(); $('#sheet').scrollTop = top;
  }));
  $('#startGame').addEventListener('click', () => {
    if (S && !S.demo && !S.over && mode === 'game' && !confirm('Start a new game? The current one will be replaced.')) return;
    prefs.last = Object.assign({}, newOpts); savePrefs();
    closeSheet();
    startGame(newGame(newOpts));
  });
}

function startGame(state) {
  S = state;
  mode = 'game';
  busy = false; sel = null; undoStack = [];
  $('#title').hidden = true;
  renderHud(); renderPanel();
  const cap = S.cities.find(c => c.owner === 0 && c.capital) || S.cities.find(c => c.owner === 0);
  cam.z = clamp(Math.min(W, H) / (TW * 4.3), 1, 2.2);
  if (cap) centerOn(cap.x, cap.y);
  refreshSel(); saveGame(); kick();
  if (S.turn === 1 && S.cur === 0 && !S.pendingRewards.length && !S.over) {
    const T = TRIBES[S.players[0].tribe];
    openSheet(`<div class="bigicon">🏝️</div><h2>The ${T.name} wash ashore</h2>
      <p>A storm wrecked the ships. Four tribes are stranded on the Ember Isles, and only one will be left standing.</p>
      <p class="muted">${T.trait.icon} <b>${T.trait.name}</b>: ${T.trait.desc}</p>
      <ul class="help"><li>Tap your unit (the green ring), then a white marker to move.</li><li>Tap resources in your land to grow your camp.</li><li>Tap 🧠 Skills to learn new ways to survive.</li></ul>
      <div class="row"><button class="big primary" data-x>Let’s survive</button></div>`);
  } else afterAction();
}
const demoCam = { x: 0, y: 0 };
function toTitle() {
  mode = 'title';
  closeSheet();
  S = newGame({ tribe: rnd(4), opponents: 3, size: 'medium', diff: 'normal' });
  S.demo = true;
  S.explored.fill(1);
  for (const c of S.cities) if (c.owner < 0 && Math.random() < .5) { c.owner = rnd(4); c.level = 1 + rnd(3); claim(c); }
  for (const c of S.cities) if (c.owner >= 0) c.level = Math.max(c.level, 1 + rnd(4));
  cam.z = clamp(Math.min(W, H) / (TW * 5.2), .8, 1.6);
  const [wx, wy] = iso(S.n / 2, S.n / 2);
  demoCam.x = wx; demoCam.y = wy + H * .18 / cam.z;     // sit the islands above the menu
  $('#title').hidden = false;
  renderHud(); renderPanel();
  const saved = loadSave();
  const m = $('#tmenu');
  m.innerHTML = (saved && !saved.over ? `<button class="big primary" id="tContinue">Continue · ${TRIBES[saved.players[0].tribe].name}, day ${saved.turn}</button>` : '') +
    `<button class="big ${saved && !saved.over ? '' : 'primary'}" id="tNew">New game</button><button class="big" id="tHelp">How to play</button>`;
  $('#tver').textContent = 'Tribelands ' + VERSION;
  if ($('#tContinue')) $('#tContinue').addEventListener('click', () => startGame(saved));
  $('#tNew').addEventListener('click', openNewGame);
  $('#tHelp').addEventListener('click', openHelp);
  kick();
}

function resize() {
  DPR = Math.min(2.5, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  clampCam(); kick();
}
addEventListener('resize', resize);
resize();
toTitle();

// test hook: lets the browser tests drive the game without pixel-hunting
window.Tribelands = {
  get S() { return S; }, set S(v) { S = v; }, VERSION, tapTile, endTurn, act, select, undo, startGame, newGame, nextUnit,
  get busy() { return busy; }, get undoDepth() { return undoStack.length; }, moveInfo, targets, aiTurn,
};
