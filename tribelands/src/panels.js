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
  checkLiveAchievements();
  refreshSel();
  renderHud();
  renderPanel();
  kick();
  if (!$('#modal').hidden && $('#modal').dataset.closable === '') return;   // a choice is already open
  if (S.pendingRewards.length) showReward();
  else if (S.over && !S.overShown) showGameOver();
  else if (storyNow()) showStory();
  else if (S.offer && S.offer.from != null) showOffer();
  else if (S.rescueNews && !S.rescueNews.seen) showRescueNews();
  else if (S.challenge && !S.challenge.seen) showChallenge();
  else if (S.event && S.event.turn === S.turn && !S.event.seen && !S.over) showEvent();
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
  $('#hudIdolWrap').hidden = !P.idols;
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
$('#btnMap').addEventListener('click', () => { if (!busy) openMap(); });
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
    info.innerHTML = `<h3>${tag(0)} Day ${S.turn}</h3><p>${ready ? `<b>${ready}</b> ${ready === 1 ? 'unit has' : 'units have'} moves left (green rings). Tap one, or press ▶ Next.` : 'Everyone has acted. Build, learn a skill, or end your turn.'}</p><p>🗳️ Final Tribal Council on day ${councilDay()}${S.rescue ? ` · 🔥 ${S.rescue.owner === 0 ? 'Your' : tribeOf(S.rescue.owner).name + '’s'} signal fire: rescue in ${RESCUE_DAYS - S.rescue.days} days` : ''}</p>`;
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
    ${u.owner === 0 ? `<p class="status ${canAct(u) ? '' : 'done'}">${unitStatus(u)}</p>` : ''}`;
  let h = '';
  if (skills.length) h += `<div class="skills">${skills.map(chip).join('')}</div>`;
  if (wades(u) && isWater(tileAt(u.x, u.y).t)) h += hint('🏊 Wading through the lagoon (Moku trait).');
  if (u.owner !== 0) {
    const peace = atPeace(0, u.owner);
    const mine = unitsOf(0).filter(v => targets(v).includes(u));
    h += hint(peace ? `🤝 You have a truce with ${tribeOf(u.owner).name} for ${peaceLeft(0, u.owner)} more turns. Neither side can attack.`
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
      cost: trainCost(0, k), block: trainBlock(0, c, k), quiet: !!common }));
  }
  const locked = TRAINABLE.filter(k => UNITS[k].tech && !has(0, UNITS[k].tech)).length;
  if (locked) add(hint(`🧠 ${locked} more unit types unlock through Skills.`));
  add(sec('Rescue — a peaceful way to win'));
  if (S.rescue && S.rescue.city === c.id) add(`<div class="banner">🔥 The Great Signal Fire burns here. ${RESCUE_DAYS - S.rescue.days} more unchallenged days and a ship will take you home.${S.rescue.stalled ? ` ⚠️ A rival within ${STALL_RANGE} tiles is stalling the count — drive them off!` : ''} Every rival is coming to put it out.</div>`);
  else add(actBtn({ a: 'rescue', icon: '🔥', title: 'Light the Great Signal Fire', wide: true, go: true,
    effect: `After ${RESCUE_DAYS} days burning unchallenged a ship comes: you win. A rival within ${STALL_RANGE} tiles stalls the count; taking the camp puts it out.`,
    cost: rescueCost(0), block: rescueBlock(0, c) }));
  const wk = Object.keys(WONDERS).filter(k => has(0, WONDERS[k].tech) || S.wonders[k] != null);
  if (wk.length) {
    add(sec('Landmarks — one of each in all the islands'));
    const holds = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
    if (holds) add(`<div class="banner">${WONDERS[holds].icon} <b>${WONDERS[holds].name}</b> stands here: ${WONDERS[holds].desc} A camp holds one landmark, so raise the others elsewhere.</div>`);
    for (const k of wk) {
      if (k === holds) continue;
      const Wd = WONDERS[k], elsewhere = S.wonders[k] != null;
      const who = elsewhere ? `${TRIBES[S.players[wonderOwner(k)].tribe].name} hold it in ${S.cities[S.wonders[k]].name}` : '';
      add(actBtn({ a: 'wonder:' + k, icon: Wd.icon, title: Wd.name, effect: Wd.desc + (elsewhere ? ` <b>${who}.</b>` : ''), cost: elsewhere ? null : Wd.cost,
        block: elsewhere ? 'Taken' : wonderBlock(0, c, k), quiet: elsewhere || !!holds, go: true, wide: true }));
    }
  }
}
function defNote(t) {
  if (t.t === FOREST) return (tribeIs(0, 'choir') ? ' · Jungle never slows your hunters' : '') + (has(0, 'slings') ? ' · Your units defend +50% here' : ' · Slings give +50% defence here');
  if (t.t === MOUNTAIN) return has(0, 'climbing') ? ' · Your units defend +50% here' : ' · Needs Climbing to enter';
  if (t.t === SHALLOW) return tribeIs(0, 'lifeboat') ? ' · Your units can wade here' : ' · Build a raft dock to take to the water';
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
  else if (a === 'rescue') act(() => { doRescue(0, cityAtI(i)); return `The Great Signal Fire is lit. Keep rivals ${STALL_RANGE} tiles clear of ${cityAtI(i).name} for ${RESCUE_DAYS} days.`; });
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
    const T = TECHS[t], done = has(0, t), ready = techReady(0, t), never = techForbidden(0, t);
    const cls = [done ? 'done' : never ? 'locked never' : ready ? (canResearch(0, t) ? 'can' : '') : 'locked', techSel === t && 'sel', needs.includes(t) && 'need', leads.includes(t) && 'lead'].filter(Boolean).join(' ');
    const sub = done ? '✓ Known' : never ? '✗ Not your story' : (ready ? '' : '🔒 ') + techCost(0, t) + ' ' + SH;
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
  else if (techForbidden(0, techSel)) h += `<p class="banner">✗ ${tribeOf(0).trait.icon} <b>${tribeOf(0).trait.name}</b>: ${tribeOf(0).name} will never learn this. ${tribeOf(0).trait.desc}</p>`;
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
    ${S.players[0].idols ? `<div class="row" style="margin:6px 0 10px"><button class="big" id="seeIdols">🗿 You hold ${S.players[0].idols} hidden immunity idol${S.players[0].idols > 1 ? 's' : ''}</button></div>` : ''}
    ${hint(`Grow camps, pick Toolmakers and Hammock groves, light signal fires on cliffs, build trading posts beside gardens and quarries, or raise the Floating Market.`)}`);
  const b = $('#seeIdols'); if (b) b.addEventListener('click', openIdols);
}
function openIdols() {
  const n = S.players[0].idols;
  openSheet(`<div class="bigicon">🗿</div><h2>Hidden immunity idols: ${n}</h2>
    <p>If a rival would take one of your camps, an idol is played for you automatically. The capture is cancelled, and the raider is voted off the island.</p>
    <p class="muted">Idols turn up in shipwrecks and are the prize in immunity challenges. Rival tribes can hold them too, so watch for the ⚠️ warning before you raid.</p>`);
}
let breakArm = null;
function openTribes() {
  const me = S.players[0], T0 = TRIBES[me.tribe];
  let h = `<h2>👥 Tribes</h2>
    <div class="tcard" style="--c:${T0.color}"><b><i></i>You: ${T0.name}${me.idols ? ` <small>🗿 ${me.idols} idol${me.idols > 1 ? 's' : ''}</small>` : ''}</b><span class="src">${T0.source}</span><span>${T0.trait.icon} <b>${T0.trait.name}</b>: ${T0.trait.desc}</span><span class="q">“${T0.question}”</span></div>`;
  for (const P of S.players.slice(1)) {
    const T = TRIBES[P.tribe], q = P.id;
    const cities = citiesOf(q).length, units = unitsOf(q).length;
    const rel = !P.alive ? 'Out' : atPeace(0, q) ? `🤝 Truce, ${peaceLeft(0, q)} more turns` : '⚔️ Rivals';
    const ratio = strength(q) / Math.max(1, strength(0));
    const power = ratio > 1.3 ? 'Stronger than you' : ratio < .75 ? 'Weaker than you' : 'About as strong as you';
    let btn = '';
    if (P.alive && atPeace(0, q)) {
      const armed = breakArm === q;
      btn = actBtn({ a: 'break:' + q, icon: armed ? '⚠️' : '🗡️', title: armed ? 'Tap again to break it' : 'Break the alliance',
        effect: armed ? `${T.name} will hold a grudge for 20 days, and every tribe will think less of you at the council.` : 'End the truce now and attack. Betrayal is remembered.' });
    } else if (P.alive && !atPeace(0, q)) {
      const cost = truceCost(0, q), asked = me.asked[q] != null && S.turn - me.asked[q] < 3;
      const block = techForbidden(0, 'alliances') ? `${tribeOf(0).name} never make alliances` : !has(0, 'alliances') ? 'Learn Alliances to offer truces' : grudge(q, 0) ? 'They hold a grudge and will not deal' : tribeIs(q, 'choir') ? 'The Choir never make alliances' : asked ? 'They refused recently; try again in a few turns'
        : me.stars < cost ? `Need ${cost - me.stars} more ${SH}` : '';
      btn = actBtn({ a: 'truce:' + q, icon: '🤝', title: 'Offer an alliance', effect: 'Pay them for 8 turns of peace. Weaker tribes are more willing.', cost, block, go: true });
    }
    const rg = S.regard[q][0], fo = focusOf(q);
    const notes = [grudge(q, 0) && '⚠️ Holds a grudge against you', fo >= 0 && fo !== 0 && `🎯 Fighting ${tribeOf(fo).name}`, fo === 0 && '🎯 Has you in its sights', P.betrayals && `🗡️ Has broken ${P.betrayals} alliance${P.betrayals > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
    h += `<div class="tcard" style="--c:${T.color}"><b><i></i>${T.name} <small>${rel}</small></b>
      <span class="src">${T.source}</span>
      <span>🧭 Plays: ${persona(q).style}</span>
      <span>🗳️ ${P.alive ? 'Their vote' : 'On the jury'} · their view of you: <b>${regardWord(rg)}</b> (${rg > 0 ? '+' : ''}${rg})</span>${notes ? `<span>${notes}</span>` : ''}
      <span>${T.trait.icon} ${T.trait.name}: ${T.trait.desc}</span>
      <span>${P.alive ? `${cities} ${cities === 1 ? 'camp' : 'camps'} · ${units} units${P.idols ? ` · 🗿 ${P.idols} idol${P.idols > 1 ? 's' : ''}` : ''} · ${power}` : 'This tribe has been voted off the islands.'}</span>${btn ? `<div class="pacts1">${btn}</div>` : ''}</div>`;
  }
  h += `<p class="muted" style="margin-top:14px">🗳️ On day ${councilDay()}, if no one has won, every tribe — the fallen too — votes for a winner. Attacks, kills, captures and broken promises cost you votes; alliances and kindness earn them.</p>`;
  const log = S.log.slice(-8).reverse();
  if (log.length) h += `<h4>Island diary</h4><ul class="chron">${log.map(l => `<li><small>Day ${l.t}</small> ${esc(l.msg)}</li>`).join('')}</ul>`;
  openSheet(h);
  $('#sheet').querySelectorAll('[data-a^="break:"]').forEach(b => b.addEventListener('click', () => {
    const q = +b.dataset.a.split(':')[1];
    if (breakArm !== q) { breakArm = q; buzz(10); openTribes(); return; }
    breakArm = null; breakTruce(0, q); buzz([30, 40, 30]);
    toast(`You broke your alliance with ${tribeOf(q).name}. Every tribe will remember.`);
    undoStack = []; afterAction(); openTribes();
  }));
  $('#sheet').querySelectorAll('[data-a^="truce:"]').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    const q = +b.dataset.a.split(':')[1], cost = truceCost(0, q);
    if (truceAccepted(0, q)) {
      S.players[0].stars -= cost; S.players[q].stars += cost;
      makeTruce(0, q, 8);
      logIt(`${TRIBES[me.tribe].name} and ${tribeOf(q).name} formed an alliance`);
      toast(`${tribeOf(q).name} accept: 8 turns of peace.`); buzz(20);
    } else {
      me.asked[q] = S.turn;
      toast(`${tribeOf(q).name} refuse. They think they can win.`);
    }
    undoStack = []; afterAction(); openTribes();
  }));
}
// A rival speaks. Each kind of message gets its own voice and its own choice.
function showOffer() {
  const o = S.offer, T = tribeOf(o.from), me = S.players[0];
  const col = `style="border-left:6px solid ${T.color};padding-left:12px"`;
  const btns = (yes, no) => `<div class="row" style="margin-top:14px"><button class="big primary" data-o="yes">${yes}</button>${no ? `<button class="big" data-o="no">${no}</button>` : ''}</div>`;
  const say = {
    peace: () => [`🕊️`, `${T.name} ask for peace`, `They offer <b>${o.gift} ${SH}</b> for a truce of ${o.turns} days. Neither of you could attack the other or take each other’s camps.`,
      btns(`Accept · +${o.gift} ${SH}`, 'Refuse and fight on')],
    tribute: () => [`💰`, `${T.name} demand tribute`, `“Pay us <b>${o.amount} ${SH}</b> and we leave you alone for ${o.turns} days. Refuse, and we come for you.”${me.stars < o.amount ? `<br><b>You only have ${me.stars} ${SH}.</b>` : ''}`,
      btns(me.stars >= o.amount ? `Pay ${o.amount} ${SH}` : 'You cannot pay', 'Refuse — let them come')],
    pact: () => [`🤝`, `${T.name} propose a pact`, `“${tribeOf(o.against).name} are getting too strong. Make peace with us for ${o.turns} days, and we will turn our spears on them.”`,
      btns('Agree to the pact', 'Decline')],
    gift: () => [`🎁`, `A gift from ${T.name}`, `They send <b>${o.gift} ${SH}</b> in friendship. Your alliance is worth something to them.`, btns('Thank them')],
    threat: () => [`⚠️`, `A warning from ${T.name}`, `“We have not forgotten. We never will.” They hold a grudge against you, and are coming.`, btns('So be it')],
    betrayal: () => [`🗡️`, `${T.name} broke your alliance!`, `The truce is over — they attacked it from the inside. Every tribe has heard. ${T.name} will pay for this at the Final Tribal Council, if you live to see it.`, btns('Brace for it')],
  }[o.kind || 'peace']();
  openSheet(`<div class="bigicon">${say[0]}</div><h2>${say[1]}</h2><p ${col}>${say[2]}</p>
    <p class="muted" style="font-size:14px">${T.trait.icon} ${T.name}: ${persona(o.from).style}. Their view of you: ${regardWord(S.regard[o.from][0])}.</p>${say[3]}`, false);
  $('#sheet').querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => {
    if (o.kind === 'tribute' && b.dataset.o === 'yes' && me.stars < o.amount) return;
    const msg = ['gift', 'threat', 'betrayal'].includes(o.kind) ? (S.offer = null, '') : answerOffer(b.dataset.o === 'yes');
    buzz(15); closeSheet(); undoStack = [];
    if (msg) toast(msg);
    afterAction();
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
  const res = recordGame();
  S.overShown = true; saveGame();
  const P = S.players[0], win = S.over === 'win', how = S.overHow || 'domination';
  const W = S.winner >= 0 ? tribeOf(S.winner).name : '';
  const head = { domination: win ? ['👑', 'Sole survivors!'] : ['🔥', 'The tribe has spoken'],
    rescue: win ? ['🚢', 'Rescued!'] : ['🚢', 'Left behind'], council: win ? ['🗳️', 'The jury chose you'] : ['🗳️', 'The jury has spoken'] }[how];
  const line = { domination: win ? `${TRIBES[P.tribe].name} are the last tribe standing on the Ember Isles, out of ${S.players.length}.` : 'A rival tribe has taken your last camp. Your torch is snuffed.',
    rescue: win ? 'A ship saw your Great Signal Fire and turned toward the island. You are going home.' : `A ship saw the fire of ${W} and took them home. Everyone else watched it sail away.`,
    council: win ? `The Final Tribal Council voted for ${TRIBES[P.tribe].name}. Not the strongest, perhaps — but the one they wanted to win.` : `The Final Tribal Council voted for ${W}.` }[how];
  const votes = how === 'council' && S.council ? `<h4>Reading the votes</h4><ol class="votes">${S.council.votes.map((v, k) =>
    `<li style="animation-delay:${.35 + k * .55}s">${v.fallen ? '🕯️' : '🔥'} ${tribeOf(v.juror).name}${v.juror === 0 ? ' (you)' : ''} votes for <b style="color:${colOf(v.vote)}">${tribeOf(v.vote).name}</b></li>`).join('')}</ol>` : '';
  openSheet(`<div class="bigicon">${head[0]}</div><h2>${head[1]}</h2>
    <p class="muted">${line}</p>${votes}
    <div class="stats"><span class="muted">Days survived</span><b>${S.turn}</b>
      <span class="muted">Camps</span><b>${citiesOf(0).length}</b>
      <span class="muted">Landmarks</span><b>${Object.keys(WONDERS).filter(k => hasWonder(0, k)).length}</b>
      <span class="muted">Challenges won</span><b>${P.challenges}</b>
      <span class="muted">Rival units defeated</span><b>${P.kills}</b>
      <span class="muted">Units swayed</span><b>${P.converts}</b>
      <span class="muted">Units lost</span><b>${P.lost}</b></div>
    <div class="reflect"><p>${TRIBES[P.tribe].ending}</p><p class="q">“${TRIBES[P.tribe].question}”</p><small>${TRIBES[P.tribe].source}</small></div>
    ${res.unlocked.length ? `<div class="banner">🔓 <b>New tribe${res.unlocked.length > 1 ? 's' : ''} unlocked:</b> ${res.unlocked.map(k => TRIBES.find(T => T.key === k).name).join(', ')}</div>` : ''}
    ${res.earned.length ? `<h4>Achievements this game</h4><div class="achs">${res.earned.map(id => achCard(ACHIEVEMENTS.find(a => a.id === id), true)).join('')}</div>` : ''}
    <div class="row" style="margin-top:12px"><button class="big primary" data-go="new">New game</button><button class="big" data-rec>🏆 Records</button><button class="big" data-x>Look at the map</button></div>`);
  $('#sheet').querySelector('[data-go]').addEventListener('click', openNewGame);
  $('#sheet').querySelector('[data-rec]').addEventListener('click', openRecords);
}
const achCard = (a, got) => `<div class="ach${got ? ' got' : ''}"><i>${got ? a.icon : '🔒'}</i><span><b>${a.name}</b><small>${a.desc}</small></span></div>`;
// The record book: tribes, achievements and every finished game.
function openRecords() {
  const R = REC, rate = R.played ? Math.round(R.wins / R.played * 100) : 0;
  const HOW = { domination: '👑 Conquest', rescue: '🚢 Rescue', council: '🗳️ Council' };
  const WORD = { domination: 'conquest', rescue: 'rescue', council: 'council' };
  const tribeCard = T => {
    const k = T.key, open = isUnlocked(k), b = R.byTribe[k] || { played: 0, wins: 0 }, U = UNLOCKS[k];
    let foot;
    if (open) foot = `${b.played ? `${b.wins}/${b.played} won${b.fastest ? ` · fastest ${b.fastest} days` : ''}` : 'Not played yet'}`;
    else { const [v, need] = U.prog(R); foot = `🔒 ${U.need} <span class="bar"><i style="width:${Math.min(100, v / need * 100)}%"></i></span> ${Math.min(v, need)}/${need}`; }
    return `<div class="rt${open ? '' : ' locked'}" style="--c:${T.color}"><b><i></i>${T.name}</b><small>${foot}</small></div>`;
  };
  const got = ACHIEVEMENTS.filter(a => R.achievements[a.id]).length;
  openSheet(`<h2>🏆 Records</h2>
    <div class="stats"><span class="muted">Games finished</span><b>${R.played}</b><span class="muted">Won</span><b>${R.wins} (${rate}%)</b>
      ${Object.keys(HOW).map(h => `<span class="muted">Won by ${HOW[h]}</span><b>${R.byHow[h] || 0}</b>`).join('')}
      <span class="muted">Rival units defeated</span><b>${R.kills}</b><span class="muted">Camps captured</span><b>${R.captures}</b></div>
    <h4>Tribes · ${TRIBES.filter(T => isUnlocked(T.key)).length} of ${TRIBES.length} unlocked</h4><div class="rts">${TRIBES.map(tribeCard).join('')}</div>
    <h4>Achievements · ${got} of ${ACHIEVEMENTS.length}</h4><div class="achs">${ACHIEVEMENTS.map(a => achCard(a, !!R.achievements[a.id])).join('')}</div>
    <h4>Your games</h4>${R.history.length ? `<ul class="chron">${R.history.slice(0, 15).map(h => {
      const T = TRIBES.find(X => X.key === h.tribe);
      return `<li><small>${h.date}</small> ${h.win ? '🏆' : '💀'} <b style="color:${T.color}">${T.name}</b> · ${h.win ? 'won' : 'lost'} (${WORD[h.how] || h.how}) on day ${h.days} · ${h.rivals} rival${h.rivals > 1 ? 's' : ''}, ${h.size}, ${h.diff}</li>`;
    }).join('')}</ul>` : '<p class="muted">Finish a game and it will be written here.</p>'}
    <h4>Endings you have reached</h4><p class="muted">${Object.keys(R.endings).length ? TRIBES.filter(T => R.endings[T.key]).map(T => `<b>${T.name}</b>`).join(' · ') : 'None yet: each tribe has its own.'}</p>
    <h4>Testing</h4><label class="switch"><span>Unlock every tribe (for testing)</span><input type="checkbox" id="unlockAll" ${R.unlockAll ? 'checked' : ''}></label>`);
  $('#unlockAll').addEventListener('change', e => { REC.unlockAll = e.target.checked; saveRecords(); openRecords(); });
}

// A scene from your tribe's own story: you must choose.
function showStory() {
  const e = storyNow(), T = tribeOf(0);
  buzz([15, 40, 15]);
  openSheet(`<p class="muted" style="margin:0">Day ${S.turn} · ${T.name} · <i>${T.source}</i></p><div class="bigicon">${e.icon}</div><h2>${e.title}</h2><p>${e.text}</p>
    <div class="row" style="margin-top:12px;flex-direction:column">${e.choices.map((c, k) => `<button class="reward" data-c="${k}"><b>${c.label}</b><span>${c.desc}</span></button>`).join('')}</div>`, false);
  $('#sheet').querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
    closeSheet();
    act(() => chooseStory(+b.dataset.c));
  }));
}
function showRescueNews() {
  const n = S.rescueNews, c = S.cities[n.city];
  n.seen = true; saveGame();
  openSheet(`<div class="bigicon">🔥</div><h2>${tribeOf(n.owner).name} lit the Great Signal Fire</h2>
    <p>It burns at ${c.name}. After ${RESCUE_DAYS} days of burning unchallenged, a ship will take them home — and everyone else loses.</p>
    <p class="muted">Get any unit within ${STALL_RANGE} tiles of it to stall the count, and take the camp to put it out.</p>
    <div class="row" style="margin-top:14px"><button class="big primary" data-look="r">Show me</button><button class="big" data-x>Later</button></div>`);
  $('#sheet').querySelector('[data-look]').addEventListener('click', () => { closeSheet(); centerOn(c.x, c.y); select({ kind: 'tile', i: I(c.x, c.y) }, false); afterAction(); });
}

function openMenu() {
  if (busy) return;
  openSheet(`<h2>Menu</h2>
    <div class="tmenu" style="max-width:none;margin-top:12px">
      <button class="big primary" data-x>Resume</button>
      <button class="big" data-m="help">How to play</button>
      <button class="big" data-m="records">🏆 Records</button>
      <button class="big" data-m="settings">Settings</button>
      <button class="big" data-m="new">New game</button>
      <button class="big" data-m="title">Save and quit to title</button>
    </div>`);
  $('#sheet').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.m;
    if (m === 'help') openHelp();
    else if (m === 'settings') openSettings();
    else if (m === 'records') openRecords();
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
      <li>✨ <b>Gold badges</b> float over resources you can work right now (tap the tile). <b>Dim badges</b> show the shells you still need.</li>
      <li>🟢 <b>Green rings</b> mark units that still have something they can do (a move, a rival in reach, a capture). ▶ <b>Next</b> hops to each one in turn. The yellow marker shows what you have selected.</li>
      <li>⚔️ <b>Units</b> move, then attack. Jungle and cliffs end a move, and so does stepping next to a rival. Each tribe’s trait bends one of these rules.</li>
      <li>🛡️ <b>Combat</b>: damage depends on attack, defence and health. Defenders strike back if they survive. Camps, palisades, jungle (Slings) and cliffs (Climbing) help defence. Three kills make a veteran.</li>
      <li>🏁 <b>Challenges</b>: a flag goes up somewhere fair. The first unit to reach it wins shells (reward) or a hidden immunity idol (immunity).</li>
      <li>🗿 <b>Idols</b> save a camp from capture, automatically, and vote the raider off the island.</li>
      <li>📚 <b>Thirteen tribes</b>, each from a story about castaways, each bending the rules its own way: what it can learn, how it grows, what a kill or a coconut is worth. Tap 👥 Tribes to read your rivals.</li>
      <li>🧠 <b>Skills</b> unlock by day. Later skills need two earlier ones, and some tribes’ stories rule a skill out for good.</li>
      <li>🗺️ <b>Map</b> shows the whole island chain; tap anywhere on it to fly there.</li>
      <li>🗼 <b>Landmarks</b>: one of each in all the islands. Whoever holds the camp holds the landmark.</li>
      <li>🔥 <b>Rescue</b>: light the Great Signal Fire in a level-4 camp. After 10 days of burning unchallenged, a ship comes and you win. Any rival unit within 3 tiles stalls the count; taking the camp puts the fire out.</li>
      <li>🗳️ <b>Final Tribal Council</b>: if no one has won by the council day, every tribe (the fallen too) votes. Violence and broken promises lose votes; alliances and kindness win them. Tap 👥 Tribes to see where you stand.</li>
      <li>📖 <b>Your story</b>: scenes from your tribe’s book arrive on certain days. Every choice has a cost.</li>
      <li>🤝 <b>Alliances</b>: pay a rival for 8 turns of peace. Rivals talk back: they sue for peace, demand tribute, propose pacts against the strongest tribe, send gifts to friends — and the treacherous break their word. You can break yours too, but betrayal is remembered.</li>
      <li>🧭 <b>Every rival plays its story</b>: the Choir raid without end, the Conch dig in and tend the fire, the Blindsiders ally and then blindside. The 👥 Tribes sheet says how each one plays.</li>
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
    <h4>Effects</h4>${seg('motion', [['full', 'Full'], ['off', 'Calm']], prefs.motion || 'full')}
    <p class="muted" style="font-size:14px">Full: sparks, dust, confetti, swaying palms and glinting sea. Calm: a still island, which also saves battery.</p>
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
if (!(newOpts.tribe < TRIBES.length) || !isUnlocked(TRIBES[newOpts.tribe].key)) newOpts.tribe = 0;
const SIZE_NOTE = { small: 'A handful of islets: about 15 minutes. Best for 2–3 tribes.', medium: 'About 30 minutes. Good for up to 5 tribes.',
  large: 'A long season: 45 minutes or more. Room for 8.', huge: 'An epic: an hour or more across a vast archipelago.' };
function openNewGame() {
  const seg = (name, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(newOpts[name]) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const T = TRIBES[newOpts.tribe];
  openSheet(`<h2>New game</h2>
    <h4>Choose your story</h4>
    <div class="tribes">${TRIBES.map((X, k) => `<button class="tribe${newOpts.tribe === k ? ' on' : ''}${isUnlocked(X.key) ? '' : ' locked'}" style="--c:${X.color}" data-tribe="${k}"><b><i></i>${X.name}</b><span class="src">${X.source.replace(/^after /, '')}</span><span class="trait">${isUnlocked(X.key) ? X.trait.icon + ' ' + X.trait.name : '🔒 ' + UNLOCKS[X.key].need}</span></button>`).join('')}</div>
    <div class="story" style="--c:${T.color}"><b>${T.name}</b><p>${T.blurb}</p><p>${T.trait.icon} <b>${T.trait.name}</b>: ${T.trait.desc}</p><p class="q">“${T.question}”</p><small>${T.source}</small>
      ${isUnlocked(T.key) ? '' : `<p class="banner" style="margin-top:8px">🔒 Locked. ${UNLOCKS[T.key].need} to play as ${T.name}. You may still meet them as rivals.</p>`}</div>
    <h4>Rival tribes</h4>${seg('opponents', [1, 2, 3, 4, 5, 6, 7].map(k => [k, String(k)]))}
    <p class="muted" style="font-size:14px">Rivals are drawn at random from the other ${TRIBES.length - 1} stories.</p>
    <h4>Island chain</h4>${seg('size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['huge', 'Huge']])}
    <p class="muted" style="font-size:14px">${SIZE_NOTE[newOpts.size] || ''}</p>
    <h4>Difficulty</h4>${seg('diff', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}
    <p class="muted" style="font-size:14px">${{ easy: 'Rivals are hesitant and slow to attack.', normal: 'Rivals expand, gang up on camps and play to win.', hard: `Rivals start richer and earn +2 ${SH} every day.` }[newOpts.diff]}</p>
    <div class="row" style="margin-top:18px"><button class="big primary" id="startGame" ${isUnlocked(T.key) ? '' : 'disabled'}>${isUnlocked(T.key) ? 'Wash ashore as ' + T.name : '🔒 ' + T.name + ' are locked'}</button></div>`);
  $('#sheet').querySelectorAll('[data-tribe]').forEach(b => b.addEventListener('click', () => {
    newOpts.tribe = +b.dataset.tribe; buzz(8);
    const top = $('#sheet').scrollTop; openNewGame(); $('#sheet').scrollTop = top;
    $('#sheet .story').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }));
  $('#sheet').querySelectorAll('[data-seg] button').forEach(b => b.addEventListener('click', () => {
    const k = b.parentNode.dataset.seg;
    newOpts[k] = k === 'opponents' ? +b.dataset.v : b.dataset.v;
    buzz(8); const top = $('#sheet').scrollTop; openNewGame(); $('#sheet').scrollTop = top;
  }));
  $('#startGame').addEventListener('click', () => {
    if (!isUnlocked(TRIBES[newOpts.tribe].key)) return;
    if (S && !S.demo && !S.over && mode === 'game' && !confirm('Start a new game? The current one will be replaced.')) return;
    prefs.last = Object.assign({}, newOpts); savePrefs();
    closeSheet();
    startGame(newGame(newOpts));
  });
}

// The whole island chain at a glance; tap anywhere to fly there.
function openMap() {
  const n = S.n, size = Math.min(W - 32, 540), cell = size / n;
  openSheet(`<h2>🗺️ The Ember Isles</h2><p class="muted">Tap anywhere to fly there. Your view is the white frame.</p>
    <canvas id="mini" width="${Math.round(size * DPR)}" height="${Math.round(size / 2 * DPR + 8 * DPR)}" style="width:${size}px;height:${size / 2 + 8}px;display:block;margin:10px auto;touch-action:none"></canvas>
    <div class="legend" id="miniKey"></div>`);
  const mc = $('#mini'), m = mc.getContext('2d');
  m.setTransform(DPR, 0, 0, DPR, 0, 0);
  const at = (x, y) => [size / 2 + (x - y) * cell / 2, 4 + (x + y) * cell / 4];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = I(x, y), t = S.tiles[i], [cx, cy] = at(x, y);
    let col;
    if (!seen(i)) col = '#1D3445';
    else if (isWater(t.t)) col = t.t === SHALLOW ? '#4CC3C9' : '#1F6F9E';
    else { const o = ownerOfI(i); col = o >= 0 ? colOf(o) : t.t === MOUNTAIN ? '#7A7470' : t.t === FOREST ? '#3E8A50' : '#9DCF62'; }
    m.fillStyle = col;
    m.beginPath(); m.moveTo(cx, cy - cell / 4); m.lineTo(cx + cell / 2, cy); m.lineTo(cx, cy + cell / 4); m.lineTo(cx - cell / 2, cy); m.closePath(); m.fill();
  }
  for (const c of S.cities) {
    if (!seen(I(c.x, c.y))) continue;
    const [cx, cy] = at(c.x, c.y);
    m.fillStyle = c.owner >= 0 ? '#fff' : '#E8D59A'; m.beginPath(); m.arc(cx, cy, Math.max(2.5, cell * .28), 0, 7); m.fill();
    if (c.owner >= 0) { m.fillStyle = colOf(c.owner); m.beginPath(); m.arc(cx, cy, Math.max(1.6, cell * .18), 0, 7); m.fill(); }
  }
  if (S.challenge) { const [cx, cy] = at(...XY(S.challenge.i)); m.font = `${Math.max(10, cell)}px system-ui`; m.textAlign = 'center'; m.fillText('🏁', cx, cy); }
  // the part of the map on screen now
  const corners = [[0, 70], [W, 70], [W, H - panelH()], [0, H - panelH()]].map(([sx, sy]) => screenToTile(sx, sy));
  m.strokeStyle = '#fff'; m.lineWidth = 2; m.beginPath();
  corners.forEach(([x, y], k) => { const [cx, cy] = at(x, y); k ? m.lineTo(cx, cy) : m.moveTo(cx, cy); }); m.closePath(); m.stroke();
  $('#miniKey').innerHTML = S.players.filter(P => P.alive).map(P => `<span style="white-space:nowrap;margin-right:10px"><b style="background:${TRIBES[P.tribe].color}"></b>${TRIBES[P.tribe].name}${P.id === 0 ? ' (you)' : ''}</span>`).join(' ');
  mc.addEventListener('click', e => {
    const r = mc.getBoundingClientRect(), px = e.clientX - r.left - size / 2, py = e.clientY - r.top - 4;
    const a = px / (cell / 2), b2 = py / (cell / 4);
    const x = clamp(Math.round((a + b2) / 2), 0, n - 1), y = clamp(Math.round((b2 - a) / 2), 0, n - 1);
    closeSheet(); centerOn(x, y); buzz(10); kick(); afterAction();
  });
}

function startGame(state) {
  S = state;
  mode = 'game';
  busy = false; sel = null; undoStack = [];
  $('#title').hidden = true;
  refreshSel(); renderHud(); renderPanel();
  const cap = S.cities.find(c => c.owner === 0 && c.capital) || S.cities.find(c => c.owner === 0);
  cam.z = clamp(Math.min(W, H) / (TW * 4.3), 1, 2.2);
  if (cap) centerOn(cap.x, cap.y);
  refreshSel(); saveGame(); kick();
  if (S.turn === 1 && S.cur === 0 && !S.pendingRewards.length && !S.over) {
    const T = TRIBES[S.players[0].tribe];
    openSheet(`<div class="bigicon">🏝️</div><h2>${T.name} wash ashore</h2>
      <p class="muted" style="margin-top:0">${T.source}</p>
      <p>${T.blurb}</p>
      <p>A storm has stranded ${S.players.length} tribes on the Ember Isles. Only one will be left standing.</p>
      <p>${T.trait.icon} <b>${T.trait.name}</b>: ${T.trait.desc}</p>
      <p class="q">Something to carry with you: “${T.question}”</p>
      <ul class="help"><li>Tap your unit (the green ring), then a white marker to move.</li><li>Tap resources in your land to grow your camp.</li><li>Tap 🧠 Skills to learn new ways to survive.</li></ul>
      <div class="row"><button class="big primary" data-x>Let’s survive</button></div>`);
  } else afterAction();
}
const demoCam = { x: 0, y: 0 };
function toTitle() {
  mode = 'title';
  closeSheet();
  S = newGame({ tribe: rnd(TRIBES.length), opponents: 6, size: 'medium', diff: 'normal' });
  S.demo = true;
  S.explored.fill(1);
  for (const c of S.cities) if (c.owner < 0 && Math.random() < .5) { c.owner = rnd(S.players.length); c.level = 1 + rnd(3); claim(c); }
  for (const c of S.cities) if (c.owner >= 0) c.level = Math.max(c.level, 1 + rnd(4));
  cam.z = clamp(Math.min(W, H) / (TW * 5.2), .8, 1.6);
  const [wx, wy] = iso(S.n / 2, S.n / 2);
  demoCam.x = wx; demoCam.y = wy + H * .18 / cam.z;     // sit the islands above the menu
  $('#title').hidden = false;
  renderHud(); renderPanel();
  const saved = loadSave();
  const m = $('#tmenu');
  m.innerHTML = (saved && !saved.over ? `<button class="big primary" id="tContinue">Continue · ${TRIBES[saved.players[0].tribe].name}, day ${saved.turn}</button>` : '') +
    `<button class="big ${saved && !saved.over ? '' : 'primary'}" id="tNew">New game</button><button class="big" id="tRec">🏆 Records</button><button class="big" id="tHelp">How to play</button>`;
  $('#tver').textContent = 'Tribelands ' + VERSION;
  if ($('#tContinue')) $('#tContinue').addEventListener('click', () => startGame(saved));
  $('#tNew').addEventListener('click', openNewGame);
  $('#tHelp').addEventListener('click', openHelp);
  $('#tRec').addEventListener('click', openRecords);
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
  get busy() { return busy; }, get readyIds() { return readyIds; }, get workMarks() { return workMarks; }, refreshSel, get undoDepth() { return undoStack.length; }, moveInfo, targets, aiTurn,
};
