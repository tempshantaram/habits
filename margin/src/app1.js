/* ===================== MARGIN · app (state, items, views) ===================== */
const KEY = 'margin.v1';
const ui = { view: 'today', upSeg: 'timeline', listSeg: 'buy', notesArea: 'all', notesSrc: 'all', notesMode: 'items', q: '', effort: 'all', showTomorrow: false, showLater: false, sheet: null, step: null, flash: null, toastActs: [], undo: null, delegateTo: null, fu: null, srcSeg: 'in', gmailHelp: false };
const $ = s => document.querySelector(s);
const LIST_NAME = { buy: 'Buy', gift: 'Gifts', waiting: 'Waiting on', someday: 'Someday' };

const ICON = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16v15H4z"/><path d="M4 9h16M8 3v4M16 3v4"/><path d="M8 14l2.5 2.5L16 12" stroke-linecap="round"/></svg>',
  upcoming: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h13M12 7l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4v16"/></svg>',
  lists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 6h11M9 12h11M9 18h11" stroke-linecap="round"/><path d="M4 5h2v2H4zM4 11h2v2H4zM4 17h2v2H4z"/></svg>',
  notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 11h8M8 15h8M8 19h5" stroke-linecap="round"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8.5 11l2 2 3.5-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 13h5l1.6 2.6h4.8L16 13h5" stroke-linejoin="round"/><path d="M4.4 5h15.2l1.4 8v6H3v-6z" stroke-linejoin="round"/><path d="M8.5 8.6h7" stroke-linecap="round"/></svg>',
  snooze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h12M13 7l5 5-5 5"/></svg>',
  doodle: '<svg viewBox="0 0 120 40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 28c10-14 18 6 28-4s14-16 22-6 12 10 20 2 14-12 22-4 10 8 18 2"/><path d="M92 10l4 4 8-9" stroke-width="1.8"/></svg>'
};

/* ---------- storage ---------- */
function migrate(j) {
  const saved = j.settings || {}, savedSrc = saved.sources || {};
  j.settings = Object.assign(defaultSettings(), saved);
  j.settings.anchors = Object.assign(defaultSettings().anchors, saved.anchors || {});
  j.settings.sources = Object.assign(defaultSettings().sources, savedSrc);
  j.settings.sources.gmail = Object.assign(defaultSettings().sources.gmail, savedSrc.gmail || {});
  j.items = j.items || []; j.log = j.log || []; j.intake = j.intake || []; j.meta = j.meta || {};
  // the 'george' area was renamed 'child' — bring old data with us
  j.items.forEach(i => { if (i.src === undefined) i.src = null; if (i.area === 'george') i.area = 'child'; });
  j.log.forEach(l => { if (l.area === 'george') l.area = 'child'; });
  const L = j.settings.learned || {};
  for (const w in L) if (L[w] === 'george') L[w] = 'child';
  return j;
}
function load() {
  try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && j.v) return migrate(j); } catch (e) { }
  return null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Could not save — storage is full or blocked'); }
}

/* ---------- items ---------- */
const findItem = id => db.items.find(i => i.id === id);
function blankItem(o) {
  return Object.assign({ id: uid(), title: '', note: '', area: null, list: null, due: null, time: null, slot: null, hard: false, effort: null, recur: null, expiry: null, person: null, shop: null, src: null, snoozes: 0, status: 'open', created: new Date().toISOString(), lastDone: null, calAt: null, sentAt: null }, o || {});
}
function itemFromParse(p) {
  const i = blankItem({ title: p.title || 'Untitled', area: p.area, list: p.list, due: p.due, time: p.time, slot: p.slot, hard: p.hard, effort: p.effort, recur: p.recur, person: p.person, shop: p.shop, note: p.note || '', src: p.src || null });
  if (p.expiry) { i.expiry = { date: p.expiry.date, leads: S().leads.slice(), ack: 0, renewYears: 1 }; syncExpiry(i, true); }
  if (i.list === 'waiting') { i.sentAt = today(); if (!i.due) i.due = addDays(today(), S().followUpDays); }
  return i;
}
function sortLeads(i) { return (i.expiry.leads && i.expiry.leads.length ? i.expiry.leads : S().leads).slice().sort((a, b) => b - a); }
function syncExpiry(i, fresh) {
  if (!i.expiry) return;
  if (!i.expiry.date) { i.due = null; return; }
  const L = sortLeads(i), T = today(), E = i.expiry.date;
  if (fresh) { let a = 0; while (a + 1 < L.length && addDays(E, -L[a + 1]) <= T) a++; i.expiry.ack = a; }
  const a = i.expiry.ack || 0;
  const d = a < L.length ? addDays(E, -L[a]) : E;
  i.due = (d < T && (fresh || a < L.length)) ? T : d;
  i.needsSetup = false;
}
function reslot(i) {
  if (i.slot && i.due) { const r = resolveSlot(i.slot, i.due); if (r) { i.slot = r.slot; i.time = r.time; } }
}
const isInbox = i => i.status === 'open' && !i.area && !i.due && !i.list && !i.expiry;
const isOpen = i => i.status === 'open';
const actionable = i => isOpen(i) && i.list !== 'someday' && !i.needsSetup;

function complete(id, silent) {
  const i = findItem(id); if (!i) return;
  const snap = JSON.stringify(i), logLen = db.log.length, T = today();
  if (i.expiry) { openSheet({ type: 'renew', id }); return; }
  db.log.push({ id: i.id, title: i.title, area: i.area, at: T, list: i.list, person: i.person || null });
  i.lastDone = T; i.snoozes = 0; i.calAt = null; i.focus = null;
  let msg = 'Done';
  if (i.recur && i.list !== 'waiting') {
    const rc = i.recur;
    if (rc.kind === 'fixed') i.due = nextFixed(rc, i.due || T, T);
    else if (rc.kind === 'float') i.due = addUnit(T, rc.n, rc.unit);
    else if (rc.kind === 'season') i.due = seasonNext(rc.key, T);
    reslot(i);
    msg = 'Done · next ' + relL(i.due);
  } else { i.status = 'done'; i.doneAt = T; }
  save();
  ui.undo = { snap, logLen };
  if (!silent) toast(msg, [{ label: 'Undo', fn: doUndo }]);
}
function doUndo() {
  const u = ui.undo; if (!u) return;
  const it = JSON.parse(u.snap); const k = db.items.findIndex(x => x.id === it.id);
  if (k >= 0) db.items[k] = it; else db.items.push(it);
  if (u.logLen != null) db.log.length = u.logLen;
  ui.undo = null; save(); render(); if (ui.sheet && ui.sheet.type === 'step') renderSheet(); toast('Restored');
}
function dropItem(id, how) {
  const i = findItem(id); if (!i) return;
  ui.undo = { snap: JSON.stringify(i), logLen: null };
  if (how === 'delete') db.items = db.items.filter(x => x.id !== id); else { i.status = 'dropped'; i.doneAt = today(); }
  save(); toast(how === 'delete' ? 'Deleted' : 'Dropped', [{ label: 'Undo', fn: doUndo }]);
}
function setWhen(i, v) {
  const T = today();
  const firstSlot = d => { const a = anchorsFor(d)[isWeekend(d) ? 0 : 1]; return a; };
  if (i.list === 'someday') i.list = null;
  if (v === 'today') { i.due = T; if (i.time && i.time < nowHM() && !i.slot) i.time = null; }
  else if (v === 'tonight') { i.due = T; i.slot = 'night'; reslot(i); }
  else if (v === 'tmrw') { i.due = addDays(T, 1); reslot(i); }
  else if (v === 'weekend') { const we = S().weekend; const first = Math.min(...we.map(x => x === 0 ? 7 : x)) % 7; i.due = isWeekend(T) ? addDays(T, 1) : nextDow(T, first, false); if (!isWeekend(i.due)) i.due = nextDow(T, first, false); i.slot = 'morning'; reslot(i); }
  else if (v === 'nextweek') { i.due = nextDow(T, 1, false); reslot(i); }
  else if (v === 'someday') { i.list = 'someday'; i.due = null; i.time = null; i.slot = null; i.hard = false; }
  i.calAt = null; i.needsSetup = false;
}

/* ---------- row rendering ---------- */
function gutter(i, ctx) {
  const T = today();
  if (i.list === 'waiting' && i.status === 'open') {
    const w = Math.max(0, diff((i.sentAt || i.created.slice(0, 10)), T));
    return `<div class="gut ${i.due && i.due <= T ? 'late' : ''}">${w}d<small>waiting</small></div>`;
  }
  if (i.expiry && i.expiry.date && i.status === 'open') {
    const n = diff(T, i.expiry.date);
    return `<div class="gut ${n <= 7 ? 'late' : ''}">${n < 0 ? 'EXP' : n + 'd'}<small>${n < 0 ? 'expired' : 'to expiry'}</small></div>`;
  }
  if (i.due && i.due < T && i.status === 'open' && ctx !== 'log') return `<div class="gut late">${diff(i.due, T)}d<small>late</small></div>`;
  if ((ctx === 'today' || ctx === 'day') && i.time) return `<div class="gut">${i.time}<small>${i.slot ? esc(slotLabel(i.slot)) : (i.hard ? 'fixed' : '')}</small></div>`;
  if ((ctx === 'list' || ctx === 'notes') && i.due) return `<div class="gut">${esc(fmtD(i.due)).replace(' ', '<br>')}</div>`;
  return '<div class="gut"></div>';
}
function metaBits(i, ctx) {
  const b = [], T = today();
  b.push(`<span class="tab a-${i.area || 'none'}">${i.area ? AREA_LABEL[i.area] : 'Inbox'}</span>`);
  if (i.src && i.src.kind && i.src.kind !== 'manual') b.push(`<span class="from">${SRC_MARK[i.src.kind] || ''} ${esc(String(i.src.name || i.src.subject || SRC_LABEL[i.src.kind] || i.src.kind).slice(0, 26))}</span>`);
  if (ctx === 'log' || (ctx === 'notes' && i.due && i.due < T)) { } else if (ctx !== 'today' && ctx !== 'day' && ctx !== 'list' && ctx !== 'notes' && i.due && !i.expiry && i.list !== 'waiting') b.push(esc(relDay(i.due)) + (i.time ? ' ' + i.time : ''));
  if (i.list === 'buy') b.push('Buy' + (i.shop ? ' · ' + esc(i.shop) : ''));
  if (i.list === 'gift') b.push('Gift' + (i.person ? ' · ' + esc(i.person) : ''));
  if (i.list === 'waiting') b.push('Waiting on ' + esc(i.person || '—') + (i.due ? ' · chase ' + esc(relL(i.due)) : ''));
  if (i.list === 'someday') b.push('Someday');
  if (i.expiry) b.push(i.expiry.date ? 'Expires ' + fmtD(i.expiry.date, true) : '<span class="red">Needs expiry date</span>');
  if (i.effort) b.push('~' + i.effort);
  if (i.recur) b.push('↻ ' + esc(recurText(i.recur)));
  if (i.hard && i.status === 'open') b.push(`<span class="hardm">◆ ${i.calAt ? 'in calendar' : 'send to cal'}</span>`);
  if (i.note) b.push('¶ note');
  if (i.snoozes > 0 && i.status === 'open') b.push('pushed ×' + i.snoozes);
  if (ctx === 'log' && i.doneAt) b.push('done ' + fmtD(i.doneAt));
  return b.map(x => `<span>${x}</span>`).join('');
}
function rowHTML(i, ctx) {
  const T = today();
  const late = i.due && i.due < T && i.status === 'open' && !i.expiry ? diff(i.due, T) : 0;
  const cls = ['row', late >= 3 ? 'late3' : '', late >= 7 ? 'late7' : '', i.status !== 'open' ? 'done' : '', i.focus === T ? 'focus' : '', i.fresh ? 'new' : ''].join(' ');
  const note = ctx === 'notes' && i.note ? `<div class="note">${esc(i.note.slice(0, 200))}</div>` : '';
  const snz = i.status === 'open' ? `<button class="snz" data-a="snooze" data-id="${i.id}" aria-label="Push">${ICON.snooze}</button>` : '<div style="width:14px"></div>';
  return `<div class="${cls}" id="r-${i.id}">${gutter(i, ctx)}<button class="box" data-a="${i.status === 'open' ? 'done' : 'reopen'}" data-id="${i.id}" aria-label="Done"></button><div class="body" data-a="open" data-id="${i.id}"><div class="t">${esc(i.title)}</div>${note}<div class="m">${metaBits(i, ctx)}</div></div>${snz}<span class="stamp">DONE</span></div>`;
}
const byDue = (a, b) => (a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : (a.time || '99') < (b.time || '99') ? -1 : 1;
const byTime = (a, b) => ((b.focus === today()) - (a.focus === today())) || ((a.time || '99:99') < (b.time || '99:99') ? -1 : (a.time || '99:99') > (b.time || '99:99') ? 1 : 0);

/* ---------- banners ---------- */
function dismissed(k) { return (db.meta.dismiss || {})[k] === today(); }
function banners() {
  const T = today(), h = [];
  const setupN = db.items.filter(i => i.needsSetup && i.status === 'open').length;
  if (setupN && !db.meta.setupSeen && !dismissed('setup')) h.push(`<div class="note-card red"><button class="x" data-a="dismiss" data-v="setup">×</button><div class="sc k">Starter pack</div><h3>${setupN} starter items need a date</h3><p>Expiry dates for visas, IDs and the car, plus when the dogs last had each treatment. About 3 minutes.</p><div class="btns"><button class="btn solid" data-a="step" data-v="setup">Set up now</button></div></div>`);
  const fresh = freshItems();
  if (fresh.length) {
    const kinds = [...new Set(fresh.map(i => SRC_LABEL[(i.src || {}).kind] || 'elsewhere'))].slice(0, 3).join(', ').toLowerCase();
    h.push(`<div class="note-card"><div class="sc k">Arrived</div><h3>${fresh.length} new from ${esc(kinds)}</h3><p>Already filed and marked. Check them, or clear the marks.</p><div class="btns"><button class="btn solid" data-a="go" data-v="sources">Look</button><button class="btn ghost" data-a="freshClear">Clear marks</button></div></div>`);
  }
  if (db.intake.length && !dismissed('intake')) {
    h.push(`<div class="note-card"><button class="x" data-a="dismiss" data-v="intake">×</button><div class="sc k">Waiting</div><h3>${db.intake.length} to approve</h3><p>Auto-filing is off, so these are waiting for a yes or no.</p><div class="btns"><button class="btn solid" data-a="go" data-v="sources">Review</button></div></div>`);
  }
  const lb = db.meta.lastBackup, age = lb ? diff(lb, T) : (db.meta.created ? diff(db.meta.created.slice(0, 10), T) : 0);
  if (db.items.length && age >= 14 && !dismissed('backup')) h.push(`<div class="note-card red"><button class="x" data-a="dismiss" data-v="backup">×</button><div class="sc k">Backup</div><h3>${lb ? 'No backup for ' + age + ' days' : 'Not backed up yet'}</h3><p>Everything lives on this phone only. One tap saves a file to Downloads.</p><div class="btns"><button class="btn solid" data-a="backup">Back up now</button></div></div>`);
  if (nowHM() >= S().triageTime && db.meta.lastTriage !== T && !dismissed('triage')) {
    const ib = db.items.filter(isInbox).length, od = db.items.filter(i => actionable(i) && i.due && i.due < T).length;
    h.push(`<div class="note-card"><button class="x" data-a="dismiss" data-v="triage">×</button><div class="sc k">Evening triage · 2 min</div><h3>${ib + od ? `${ib} in inbox · ${od} overdue` : 'Quick look at tomorrow'}</h3><div class="btns"><button class="btn solid" data-a="step" data-v="triage">Start</button></div></div>`);
  }
  const lr = db.meta.lastReview, rAge = lr ? diff(lr, T) : 99;
  if (((dowOf(T) === +S().reviewDay && nowHM() >= S().reviewTime && rAge >= 3) || rAge >= 9) && db.meta.created && diff(db.meta.created.slice(0, 10), T) >= 3 && !dismissed('review'))
    h.push(`<div class="note-card"><button class="x" data-a="dismiss" data-v="review">×</button><div class="sc k">Weekly review · 10 min</div><h3>${lr ? 'Last one ' + rAge + ' days ago' : 'Your first weekly review'}</h3><div class="btns"><button class="btn solid" data-a="step" data-v="weekly">Start</button></div></div>`);
  const rs = db.meta.resurface;
  if (rs && rs.ids) {
    const its = rs.ids.map(findItem).filter(i => i && i.status === 'open' && i.list === 'someday');
    if (its.length) h.push(`<div class="note-card"><div class="sc k">From the someday pile</div><h3>Still want these?</h3><ul>${its.map(i => `<li><span>${esc(i.title)}</span><button class="btn sm" data-a="rs-keep" data-id="${i.id}">Keep</button><button class="btn sm" data-a="snooze" data-id="${i.id}">Schedule</button><button class="btn sm redb" data-a="rs-kill" data-id="${i.id}">Kill</button></li>`).join('')}</ul></div>`);
  }
  const groups = batchGroups();
  const g = groups.find(g => g.items.length >= 3 && !dismissed('batch-' + g.k));
  if (g) h.push(`<div class="note-card"><button class="x" data-a="dismiss" data-v="batch-${g.k}">×</button><div class="sc k">Batch</div><h3>${g.items.length} ${g.label} lined up</h3><p>Do them together in one sitting rather than switching back and forth.</p><div class="btns"><button class="btn solid" data-a="batch" data-v="${g.k}">Open batch</button></div></div>`);
  return h.join('');
}
function batchGroups() {
  const T = today(), lim = addDays(T, 2), m = {};
  db.items.filter(i => actionable(i) && !i.expiry && i.list !== 'waiting' && ((i.due && i.due <= lim) || (!i.due && !i.list)))
    .forEach(i => { const k = batchOf(i.title); if (k) (m[k] = m[k] || []).push(i); });
  return BATCH.filter(b => m[b.k]).map(b => ({ k: b.k, label: b.label, items: m[b.k] })).sort((a, b) => b.items.length - a.items.length);
}

/* ---------- views ---------- */
function effortBar() {
  const f = [['all', 'All'], ['2m', '2 min'], ['15m', '15 min'], ['deep', 'Deep']];
  return `<div class="filters"><span class="sc muted" style="margin-right:4px">Time I have</span>${f.map(([k, l]) => `<button class="f ${ui.effort === k ? 'on' : ''}" data-a="effort" data-v="${k}">${l}</button>`).join('')}</div>`;
}
function vToday() {
  const T = today();
  const ef = i => ui.effort === 'all' || i.effort === ui.effort;
  const open = db.items.filter(i => actionable(i) && ef(i));
  const overdue = open.filter(i => i.due && i.due < T).sort(byDue);
  const todays = open.filter(i => i.due === T).sort(byTime);
  const timed = todays.filter(i => i.time), untimed = todays.filter(i => !i.time);
  const inbox = db.items.filter(i => isInbox(i) && ef(i));
  const tmr = open.filter(i => i.due === addDays(T, 1)).sort(byTime);
  let h = banners() + effortBar();
  if (overdue.length) h += `<div class="sec"><div class="sec-h red"><h2>Overdue</h2><span class="n sc">${overdue.length}</span></div>${overdue.map(i => rowHTML(i, 'today')).join('')}</div>`;
  h += `<div class="sec"><div class="sec-h"><h2>Today</h2><span class="n sc">${todays.length}</span></div>`;
  if (!todays.length && !overdue.length) h += `<div class="empty">A clear page. Capture anything above.</div>`;
  else if (!todays.length) h += `<div class="empty">Nothing else due today.</div>`;
  h += timed.map(i => rowHTML(i, 'today')).join('');
  if (untimed.length) h += (timed.length ? '<div class="slot-h">Any time today</div>' : '') + untimed.map(i => rowHTML(i, 'today')).join('');
  h += '</div>';
  if (inbox.length) h += `<div class="sec"><div class="sec-h"><h2>Inbox</h2><span class="n sc">${inbox.length} unsorted</span><span class="act"><button class="linkbtn" data-a="step" data-v="triage">Triage</button></span></div>${inbox.slice(0, 6).map(i => rowHTML(i, 'today')).join('')}${inbox.length > 6 ? `<div class="more"><button class="linkbtn" data-a="go" data-v="notes" data-x="inbox">All ${inbox.length}</button></div>` : ''}</div>`;
  h += `<div class="sec"><div class="sec-h"><h2>Tomorrow</h2><span class="n sc">${tmr.length}</span><span class="act">${tmr.length ? `<button class="linkbtn" data-a="toggleTmr">${ui.showTomorrow ? 'Hide' : 'Show'}</button>` : ''}</span></div>${ui.showTomorrow ? tmr.map(i => rowHTML(i, 'day')).join('') : ''}</div>`;
  return h;
}
function vUpcoming() {
  const T = today();
  const seg = `<div class="seg"><button class="${ui.upSeg === 'timeline' ? 'on' : ''}" data-a="upSeg" data-v="timeline">Timeline</button><button class="${ui.upSeg === 'radar' ? 'on' : ''}" data-a="upSeg" data-v="radar">Expiry radar${radarAlert() ? '<i>●</i>' : ''}</button></div>`;
  if (ui.upSeg === 'radar') return seg + vRadar();
  const fut = db.items.filter(i => actionable(i) && i.due && i.due > T).sort(byDue);
  let h = seg;
  for (let n = 1; n <= 7; n++) {
    const d = addDays(T, n), its = fut.filter(i => i.due === d);
    h += `<div class="sec" style="padding-top:12px"><div class="sec-h"><h2 style="font-size:17px">${n === 1 ? 'Tomorrow' : DOW_N[dowOf(d)]}</h2><span class="n sc">${fmtD(d)}${isWeekend(d) ? ' · weekend' : ''}</span></div>${its.length ? its.map(i => rowHTML(i, 'day')).join('') : '<div class="row" style="min-height:30px;border-bottom:1px dotted var(--rule)"><div class="gut"></div><div class="body muted" style="padding:6px 0;font-style:italic;font-size:14px">—</div></div>'}</div>`;
  }
  const later = fut.filter(i => i.due > addDays(T, 7));
  if (later.length) {
    h += `<div class="sec"><div class="sec-h"><h2>Later</h2><span class="n sc">${later.length}</span></div>`;
    let cur = '';
    later.slice(0, ui.showLater ? 400 : 40).forEach(i => {
      const mk = i.due.slice(0, 7);
      if (mk !== cur) { cur = mk; const d = pd(i.due); h += `<div class="slot-h">${MON_N[d.getMonth()]} ${d.getFullYear()}</div>`; }
      h += rowHTML(i, 'list');
    });
    if (later.length > 40 && !ui.showLater) h += `<div class="more"><button class="linkbtn" data-a="showLater">Show all ${later.length}</button></div>`;
    h += '</div>';
  }
  return h;
}
function radarAlert() { const T = today(); return db.items.some(i => isOpen(i) && i.expiry && i.expiry.date && diff(T, i.expiry.date) <= 30); }
function radarSVG(n, leads) {
  const max = 180, x = v => 100 - Math.max(0, Math.min(max, v)) / max * 100;
  const marks = leads.filter(l => l <= max).map(l => `<line x1="${x(l)}%" y1="4" x2="${x(l)}%" y2="18" stroke="currentColor" stroke-width="1" opacity=".45"/><text x="${x(l)}%" y="22" font-size="8" text-anchor="middle" fill="currentColor" opacity=".6" font-family="ui-monospace,monospace" dy="0">${l}</text>`).join('');
  const pos = x(n), col = n <= 7 ? 'var(--red)' : n <= 30 ? 'var(--a-dogs)' : 'currentColor';
  return `<svg aria-hidden="true" style="color:var(--ink3)"><line x1="0" y1="11" x2="100%" y2="11" stroke="currentColor" stroke-width="1"/><line x1="100%" y1="5" x2="100%" y2="17" stroke="var(--red)" stroke-width="2"/>${marks}${n > max ? `<text x="0" y="8" font-size="8" fill="currentColor" font-family="ui-monospace,monospace">${max}+ days</text>` : `<line x1="${pos}%" y1="11" x2="100%" y2="11" stroke="${col}" stroke-width="3"/><circle cx="${pos}%" cy="11" r="4.5" fill="${col}"/>`}</svg>`;
}
function vRadar() {
  const T = today();
  const ex = db.items.filter(i => isOpen(i) && i.expiry);
  const dated = ex.filter(i => i.expiry.date).sort((a, b) => a.expiry.date < b.expiry.date ? -1 : 1);
  const undated = ex.filter(i => !i.expiry.date);
  let h = `<div class="legend">Track runs from 180 days out to expiry (red post). Ticks mark your warnings.</div>`;
  h += `<div class="sec"><div class="sec-h"><h2>On the radar</h2><span class="n sc">${dated.length}</span><span class="act"><button class="linkbtn" data-a="newExpiry">+ Add</button></span></div>`;
  h += dated.map(i => {
    const n = diff(T, i.expiry.date);
    return `<div class="radar-row" data-a="open" data-id="${i.id}"><div class="days ${n <= 7 ? 'red' : ''}">${n < 0 ? 'EXP' : n}<small>${n < 0 ? 'expired' : 'days'}</small></div><div class="t">${esc(i.title)}</div><div class="sc muted">${fmtD(i.expiry.date, true)} · <span class="a-${i.area || 'none'}">${i.area ? AREA_LABEL[i.area] : ''}</span> · next warning ${i.due ? relL(i.due) : '—'}</div>${radarSVG(n, sortLeads(i))}</div>`;
  }).join('') || '<div class="empty">No dated expiries yet.</div>';
  h += '</div>';
  if (undated.length) h += `<div class="sec"><div class="sec-h red"><h2>Needs a date</h2><span class="n sc">${undated.length}</span></div>${undated.map(i => `<div class="radar-row"><div class="days red">?</div><div class="t">${esc(i.title)}</div><input class="inp" type="date" data-exdate="${i.id}" aria-label="Expiry date for ${esc(i.title)}"></div>`).join('')}</div>`;
  return h;
}
function vLists() {
  const T = today(), open = db.items.filter(isOpen);
  const cnt = k => open.filter(i => i.list === k).length;
  const chaseDue = open.filter(i => i.list === 'waiting' && i.due && i.due <= T).length;
  const segs = [['buy', 'Buy'], ['gift', 'Gifts'], ['waiting', 'Waiting'], ['someday', 'Someday']];
  let h = `<div class="seg">${segs.map(([k, l]) => `<button class="${ui.listSeg === k ? 'on' : ''}" data-a="listSeg" data-v="${k}">${l} ${cnt(k)}${k === 'waiting' && chaseDue ? '<i>●</i>' : ''}</button>`).join('')}</div>`;
  const ph = { buy: 'Add: dog shampoo from amazon', gift: 'Add: gift for partner ceramic lamp', waiting: 'Add: waiting on Ahmed for pool quote', someday: 'Add: learn to sail' }[ui.listSeg];
  h += `<div class="search"><input id="listAdd" placeholder="${ph}" enterkeyhint="done" data-list="${ui.listSeg}"><button class="linkbtn" data-a="listAdd">Add</button></div>`;
  const its = open.filter(i => i.list === ui.listSeg);
  const grp = (keyFn, empty) => {
    const m = {}; its.forEach(i => { const k = keyFn(i) || empty; (m[k] = m[k] || []).push(i); });
    return Object.keys(m).sort((a, b) => a === empty ? 1 : b === empty ? -1 : a.localeCompare(b)).map(k => `<div class="slot-h">${esc(k)} · ${m[k].length}</div>` + m[k].sort(byDue).map(i => rowHTML(i, 'list')).join('')).join('');
  };
  if (ui.listSeg === 'buy') {
    h += `<div class="sec"><div class="sec-h"><h2>Buy</h2><span class="n sc">by shop</span><span class="act">${its.length ? '<button class="linkbtn" data-a="shareBuy">Share list</button>' : ''}</span></div>${grp(i => i.shop, 'Anywhere') || '<div class="empty">Nothing to buy. Start a capture with "buy…" and it lands here.</div>'}</div>`;
  } else if (ui.listSeg === 'gift') {
    h += `<div class="sec"><div class="sec-h"><h2>Gift ideas</h2><span class="n sc">by person</span></div>${grp(i => i.person, 'Unassigned') || '<div class="empty">Jot ideas the moment you hear them: "gift for Wife — that ceramic lamp".</div>'}</div>`;
  } else if (ui.listSeg === 'waiting') {
    h += `<div class="sec"><div class="sec-h"><h2>Waiting on</h2><span class="n sc">chase dates</span></div>`;
    h += its.sort(byDue).map(i => rowHTML(i, 'list') + `<div style="display:flex;gap:6px;padding:0 16px 10px calc(var(--gut) + 46px);border-bottom:1px solid var(--rule);margin-top:-1px"><button class="btn sm" data-a="chase" data-id="${i.id}">Chase on WhatsApp</button><button class="btn sm solid" data-a="done" data-id="${i.id}">Got it</button></div>`).join('') || '<div class="empty">When you send something via WhatsApp from Margin, it waits here with a chase date.</div>';
    h += '</div>';
  } else {
    h += `<div class="sec"><div class="sec-h"><h2>Someday</h2><span class="n sc">resurfaces every ${S().resurfaceEvery} days</span></div>${its.map(i => rowHTML(i, 'list')).join('') || '<div class="empty">Park ideas here with "someday". A couple come back every few weeks to keep or kill.</div>'}</div>`;
  }
  return h;
}
/* ---------- sources: intake and connections ---------- */
const GMAIL_HELP = `First: make a new Gmail address just for Margin, and forward things to it. Keep your main mailbox out of this entirely.

Then, one-time setup, about five minutes, on a computer:
1. Open console.cloud.google.com and make a new project (any name).
2. In "APIs & Services → Library", search for Gmail API and enable it.
3. In "APIs & Services → OAuth consent screen", choose External, fill in the name and your email, and add yourself as a test user.
4. In "Credentials → Create credentials → OAuth client ID", choose Web application.
5. Under "Authorised JavaScript origins" add the address you open Margin from (for a file on your phone this will not work — Margin needs to be served over https, e.g. GitHub Pages).
6. Copy the client ID that ends in .apps.googleusercontent.com and paste it above.
Margin asks for read-only access. The sign-in token is kept in memory only and disappears when you close the app.`;
const DEMO_EMAIL = `From: Ahmed Khan <ahmed@poolworks.ae>
To: me@example.com
Subject: Re: Pool maintenance quote
Date: ${fmtD(today(), true)}

Hi,

Thanks for the visit. The quote is AED 4,500 including the new pump.
Please confirm by next Thursday so we can hold the slot.
Booking reference: PW-88213

Ahmed
--
Poolworks LLC`;

function candHTML(c) {
  const p = c.p, s = c.src || {};
  const when = p.expiry ? 'Expires ' + fmtD(p.expiry.date, true) : p.due ? relDay(p.due) + (p.time ? ' · ' + p.time : '') : 'No date';
  const who = [SRC_LABEL[s.kind] || s.kind, s.name, s.at ? fmtD(s.at) : null].filter(Boolean).join(' · ');
  return `<div class="cand" id="c-${c.id}">
    <div class="k sc">${SRC_MARK[s.kind] || ''} ${esc(who)}</div>
    <input class="cand-t" data-candtitle="${c.id}" value="${esc(p.title)}" aria-label="Title">
    <div class="chips">
      <span class="chip area bl-${p.area || 'none'} tap" data-a="candArea" data-id="${c.id}">${p.area ? AREA_LABEL[p.area] : 'Inbox'}</span>
      <span class="chip ${p.hard || p.expiry ? 'hard' : ''} tap" data-a="candWhen" data-id="${c.id}">${esc(when)}</span>
      ${p.list ? `<span class="chip">${LIST_NAME[p.list]}${p.person ? ' · ' + esc(p.person) : ''}</span>` : ''}
      ${p.recur ? `<span class="chip">↻ ${esc(recurText(p.recur))}</span>` : ''}
      ${p.effort ? `<span class="chip">~${p.effort}</span>` : ''}
    </div>
    <div class="why">${esc(c.why || '')}</div>
    <div class="chips" style="margin-top:9px">
      <button class="btn sm solid" data-a="candAdd" data-id="${c.id}">Add</button>
      <button class="btn sm" data-a="candEdit" data-id="${c.id}">Add &amp; edit</button>
      <button class="btn sm ghost" data-a="candSkip" data-id="${c.id}">Skip</button>
      ${s.url ? `<button class="btn sm ghost" data-a="candOpen" data-id="${c.id}">Original</button>` : ''}
    </div>
  </div>`;
}
function vSrcIntake() {
  const fresh = freshItems();
  let h = '';
  if (ui.gmailNeedsTap) h += `<div class="note-card red"><div class="sc k">Gmail</div><h3>Tap to fetch</h3><p>Google needs a tap before it will hand over new mail.</p><div class="btns"><button class="btn redsolid" data-a="gmailSync">Fetch now</button></div></div>`;
  if (fresh.length) {
    h += `<div class="sec"><div class="sec-h"><h2>Just arrived</h2><span class="n sc">${fresh.length}</span><span class="act"><button class="linkbtn" data-a="freshClear">Clear marks</button></span></div>`;
    h += fresh.sort((a, b) => (b.created || '').localeCompare(a.created || '')).map(i => rowHTML(i, 'notes') + `<div class="fresh-act"><button class="btn sm ghost" data-a="freshDrop" data-id="${i.id}">Not wanted</button></div>`).join('');
    h += `</div>`;
  }
  h += `<section class="pastebox"><span class="lbl sc">Paste</span>
    <textarea id="srcText" rows="3" placeholder="Paste an email, an invite, a message, a list…" aria-label="Paste a source"></textarea>
    <div class="chips" style="margin-top:8px">
      <button class="btn solid" data-a="srcScan">Read it</button>
      <button class="btn" data-a="srcClip">From clipboard</button>
      <button class="btn" data-a="srcPick">Open a file</button>
      <button class="btn ghost" data-a="srcDemo">Example</button>
    </div>
    <div class="hint">Margin works out what it is — email, calendar invite, spreadsheet, chat or plain list — files it, and marks it as new. Turn that off under Settings → Sources if you would rather approve each one.</div>
  </section>`;
  if (!db.intake.length) return h + `<div class="empty">Nothing new. Anything you forward to Margin's address turns up here on its own.</div>`;
  h += `<div class="sec"><div class="sec-h"><h2>Suggestions</h2><span class="n sc">${db.intake.length}</span><span class="act"><button class="linkbtn" data-a="candAll">Add all</button></span></div>`;
  h += db.intake.map(candHTML).join('');
  h += `<div class="more"><button class="linkbtn" data-a="candClear">Skip the rest</button></div></div>`;
  return h;
}
function vSrcConnect() {
  const st = S(), g = st.sources.gmail, counts = sourceCounts();
  const base = location.href.split('#')[0].split('?')[0];
  let h = `<div class="legend">Everything happens on this phone. Margin reads what you hand it and keeps only what you accept — nothing is uploaded anywhere.</div>`;

  h += `<div class="note-card"><div class="sc k">✉ Email · by hand</div><h3>Forward or paste an email</h3>
    <p>Forward anything to yourself, copy it, and paste it into the Intake tab. Margin reads the sender, the subject, the dates, amounts, reference numbers and the lines that ask you for something.</p>
    <div class="btns"><button class="btn solid" data-a="srcSeg" data-v="in">Go to Intake</button><button class="btn" data-a="srcDemo">Try an example</button></div></div>`;

  h += `<div class="note-card"><div class="sc k">✉ Gmail · read-only</div><h3>${g.lastSync ? 'Last read ' + fmtD(g.lastSync.slice(0, 10), true) : 'Not connected'}</h3>
    <p><b>Give Margin its own email address.</b> Forward anything you want it to handle to that address; everything in that mailbox is treated as fair game. Read-only: Margin cannot send, delete or change anything. Keep your main mailbox out of it.</p>
    <div class="fld"><span class="sc">Google client ID</span><input type="text" data-set2="sources.gmail.clientId" value="${esc(g.clientId)}" placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false"></div>
    <div class="fld"><span class="sc">Which emails</span><input type="text" data-set2="sources.gmail.query" value="${esc(g.query)}" placeholder="newer_than:30d" autocomplete="off" spellcheck="false"><div class="hint">Gmail's own search language. On an address kept just for Margin, <span class="mono">newer_than:30d</span> reads everything recent. On a shared one, use <span class="mono">label:Margin</span>.</div></div>
    <div class="kv"><span>Fetch in the background</span><span class="chips">${opt(g.auto !== false, 'set-gmail', 'auto', g.auto !== false ? 'On' : 'Off')}</span></div>
    <div class="fld"><span class="sc">How many at a time</span><input type="number" min="1" max="50" data-set2="sources.gmail.max" value="${+g.max || 12}"></div>
    <div class="btns"><button class="btn redsolid" data-a="gmailSync"${g.clientId ? '' : ' disabled'}>Fetch email now</button><button class="btn ghost" data-a="gmailHelp">${ui.gmailHelp ? 'Hide the steps' : 'How do I get a client ID?'}</button></div>
    ${ui.gmailHelp ? `<div class="hint" style="white-space:pre-line;font-style:normal">${esc(GMAIL_HELP)}</div>` : ''}</div>`;

  h += `<div class="note-card"><div class="sc k">✆ WhatsApp</div><h3>The asks, not the chatter</h3>
    <p>In WhatsApp, open a chat → the ⋮ menu → <em>Export chat → Without media</em>, and share it to Margin; or just copy a few messages and paste them. Margin keeps the lines that ask you for something or carry a date, and drops the rest.</p>
    <div class="btns"><button class="btn solid" data-a="srcSeg" data-v="in">Go to Intake</button></div></div>`;

  h += `<div class="note-card"><div class="sc k">▣ Calendar · ▤ files</div><h3>Invites, exports and spreadsheets</h3>
    <p>An .ics invite becomes a dated item, times and repeats included. A .csv with a Task and Due column becomes one item per row. A .txt or .md list becomes one item per line.</p>
    <div class="btns"><button class="btn solid" data-a="srcPick">Open a file</button></div></div>`;

  h += `<div class="note-card"><div class="sc k">⇥ Share sheet</div><h3>Share into Margin from any app</h3>
    <p>Install Margin to your home screen first. On Android you can then share a page or some text straight to it. Anywhere else, this link does the same job — anything after <span class="mono">text=</span> is read as a source.</p>
    <div class="fld"><input type="text" readonly value="${esc(base)}?text=" aria-label="Share link"></div>
    <div class="btns"><button class="btn" data-a="copyShare" data-v="${esc(base)}">Copy the link</button></div></div>`;

  h += `<div class="note-card"><div class="sc k">↗ A link</div><h3>Park a link with a reason</h3>
    <div class="fld"><span class="sc">Address</span><input type="url" id="linkUrl" placeholder="https://…" autocomplete="off" spellcheck="false"></div>
    <div class="fld"><span class="sc">Why it matters</span><input type="text" id="linkWhy" placeholder="Car seat to compare"></div>
    <div class="btns"><button class="btn solid" data-a="srcLink">Add to intake</button></div></div>`;

  h += `<div class="note-card"><div class="sc k">Your own address</div><h3>Which email address is you?</h3>
    <p>Used to spot mail you sent yourself, so it lands in “Waiting on” with a chase date instead of on today's list.</p>
    <div class="fld"><input type="email" data-set2="myEmail" value="${esc(st.myEmail || '')}" placeholder="you@example.com" autocomplete="off" spellcheck="false"></div></div>`;

  const rows = SOURCES.filter(s => counts[s.k]).map(s => `<div class="kv"><span>${s.mark} ${s.label}</span><span class="mono">${counts[s.k]}</span></div>`).join('');
  h += `<div class="sec"><div class="sec-h"><h2>Where things came from</h2><span class="n sc">open items</span></div><div style="padding:0 16px 0 calc(var(--gut) + 12px)">${rows || '<div class="hint">Nothing imported yet.</div>'}
    <div class="kv"><span>Messages already seen</span><span><span class="mono">${Object.keys(db.meta.seen || {}).length}</span> <button class="btn sm ghost" data-a="forgetSeen">Forget</button></span></div></div></div>`;
  return h;
}
function vSources() {
  const n = db.intake.length;
  const seg = `<div class="seg">
    <button class="${ui.srcSeg === 'in' ? 'on' : ''}" data-a="srcSeg" data-v="in">Intake${n ? ' ' + n + '<i>●</i>' : ''}</button>
    <button class="${ui.srcSeg === 'add' ? 'on' : ''}" data-a="srcSeg" data-v="add">Add a source</button>
  </div>`;
  return seg + (ui.srcSeg === 'add' ? vSrcConnect() : vSrcIntake());
}

function vNotes() {
  const T = today();
  const q = ui.q.trim().toLowerCase();
  let h = `<div class="search"><input id="search" type="search" placeholder="Search everything, incl. done log" value="${esc(ui.q)}" autocomplete="off"></div>`;
  h += `<div class="seg"><button class="${ui.notesMode === 'items' ? 'on' : ''}" data-a="notesMode" data-v="items">Open</button><button class="${ui.notesMode === 'log' ? 'on' : ''}" data-a="notesMode" data-v="log">Done log</button></div>`;
  h += `<div id="notesBody">${notesBody()}</div>`;
  return h;
}
function notesBody() {
  const T = today(), q = ui.q.trim().toLowerCase();
  const match = i => !q || [i.title, i.note, i.person, i.shop, i.area && AREA_LABEL[i.area],
    i.src && i.src.from, i.src && i.src.name, i.src && i.src.subject, i.src && i.src.quote]
    .some(x => x && String(x).toLowerCase().includes(q));
  let h = '';
  if (q) {
    const hits = {}; db.log.filter(l => l.title.toLowerCase().includes(q)).forEach(l => { const k = l.title.toLowerCase(); (hits[k] = hits[k] || []).push(l); });
    const ks = Object.keys(hits).slice(0, 4);
    h += ks.map(k => { const ls = hits[k].sort((a, b) => a.at < b.at ? 1 : -1); return `<div class="found"><div class="sc muted">Last done</div><b>${esc(ls[0].title)}</b> — ${fmtD(ls[0].at, true)} <span class="muted">(${diff(ls[0].at, T)} days ago)</span>${ls.length > 1 ? `<div class="sc muted" style="margin-top:4px">${ls.length}× · ${ls.slice(1, 5).map(l => fmtD(l.at, true)).join(' · ')}</div>` : ''}</div>`; }).join('');
  }
  if (ui.notesMode === 'log') {
    const logs = db.log.filter(l => !q || l.title.toLowerCase().includes(q)).slice().sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 300);
    let cur = '';
    h += '<div class="sec">' + (logs.map(l => { const mk = l.at.slice(0, 7); let x = ''; if (mk !== cur) { cur = mk; const d = pd(l.at); x = `<div class="slot-h">${MON_N[d.getMonth()]} ${d.getFullYear()}</div>`; } return x + `<div class="log-row"><div class="gut">${fmtD(l.at).replace(/ \d{4}$/, '')}</div><div class="t">${esc(l.title)}</div><div class="m"><span class="a-${l.area || 'none'}">${l.area ? AREA_LABEL[l.area].toUpperCase() : 'INBOX'}</span>${l.person ? ' · ' + esc(l.person) : ''}</div></div>`; }).join('') || '<div class="empty">Finished items are logged here, so "when did I last…?" is one search.</div>') + '</div>';
    return h;
  }
  const areas = [['all', 'All'], ['inbox', 'Inbox'], ...AREAS.map(a => [a.k, a.label])];
  h += `<div class="filters">${areas.map(([k, l]) => `<button class="f ${ui.notesArea === k ? 'on' : ''}" data-a="notesArea" data-v="${k}">${l}</button>`).join('')}</div>`;
  const counts = sourceCounts();
  const srcs = [['all', 'Any source'], ...SOURCES.filter(s => counts[s.k]).map(s => [s.k, (s.mark ? s.mark + ' ' : '') + s.label])];
  if (srcs.length > 2) h += `<div class="filters">${srcs.map(([k, l]) => `<button class="f ${ui.notesSrc === k ? 'on' : ''}" data-a="notesSrc" data-v="${k}">${l}</button>`).join('')}</div>`;
  let its = db.items.filter(i => isOpen(i) && match(i));
  if (ui.notesArea === 'inbox') its = its.filter(i => !i.area); else if (ui.notesArea !== 'all') its = its.filter(i => i.area === ui.notesArea);
  if (ui.notesSrc !== 'all') its = its.filter(i => ((i.src && i.src.kind) || 'manual') === ui.notesSrc);
  its.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  h += `<div class="sec"><div class="sec-h"><h2>${ui.notesArea === 'all' ? 'Everything open' : ui.notesArea === 'inbox' ? 'Inbox' : AREA_LABEL[ui.notesArea]}</h2><span class="n sc">${its.length}</span><span class="act"><button class="linkbtn" data-a="newNote">+ Note</button></span></div>${its.slice(0, 250).map(i => rowHTML(i, 'notes')).join('') || '<div class="empty">Nothing here.</div>'}</div>`;
  return h;
}
function vReview() {
  const T = today();
  const wk = db.log.filter(l => diff(l.at, T) < 7).length;
  const od = db.items.filter(i => actionable(i) && i.due && i.due < T).length;
  const openN = db.items.filter(i => isOpen(i)).length;
  const lt = db.meta.lastTriage, lr = db.meta.lastReview, lb = db.meta.lastBackup;
  const ago = d => d ? (diff(d, T) === 0 ? 'today' : diff(d, T) + ' days ago') : 'never';
  let h = `<div class="stat"><div><b>${wk}</b><span class="sc muted">done · 7d</span></div><div class="${od ? 'red' : ''}"><b>${od}</b><span class="sc muted">overdue</span></div><div><b>${openN}</b><span class="sc muted">open</span></div></div>`;
  h += `<div class="note-card"><div class="sc k">Daily · after bedtime</div><h3>Evening triage</h3><p>2 minutes. File the inbox, decide on overdue items, glance at tomorrow. Last: ${ago(lt)}.</p><div class="btns"><button class="btn solid" data-a="step" data-v="triage">Start triage</button></div></div>`;
  h += `<div class="note-card"><div class="sc k">Weekly · ${DOW_N[+S().reviewDay]} ${S().reviewTime}</div><h3>Weekly review</h3><p>10 minutes. Stuck items, chases, the week ahead, the expiry radar, the someday pile and a backup. Last: ${ago(lr)}.</p><div class="btns"><button class="btn solid" data-a="step" data-v="weekly">Start review</button></div></div>`;
  h += `<div class="note-card"><div class="sc k">Make them stick</div><h3>Put both rituals in Google Calendar</h3><p>Two repeating events that ping you, so Margin doesn't have to.</p><div class="btns"><button class="btn" data-a="ritualCal" data-v="triage">Triage · daily ${S().triageTime}</button><button class="btn" data-a="ritualCal" data-v="weekly">Review · ${DOW_N[+S().reviewDay]} ${S().reviewTime}</button></div></div>`;
  h += `<div class="note-card ${lb && diff(lb, T) < 14 ? '' : 'red'}"><div class="sc k">Backup · auto on ${DOW_N[+S().backupDay]}s</div><h3>Last backup: ${ago(lb)}</h3><p>The first tap on your backup day saves a file to Downloads automatically.</p><div class="btns"><button class="btn" data-a="backup">Back up now</button><button class="btn ghost" data-a="import">Restore…</button></div></div>`;
  return h;
}
