/* ===================== MARGIN · app (render, sheets, actions, boot) ===================== */
const VIEWS = { today: vToday, sources: vSources, upcoming: vUpcoming, lists: vLists, notes: vNotes, review: vReview };
const NAV = [['today', 'Today'], ['sources', 'Sources'], ['upcoming', 'Ahead'], ['lists', 'Lists'], ['notes', 'Notes'], ['review', 'Review']];

function render() {
  const T = today();
  $('#mastDate').innerHTML = `${DOW_N[dowOf(T)]}<b>${fmtD(T)}</b>`;
  const open = db.items.filter(actionable);
  const od = open.filter(i => i.due && i.due < T).length, td = open.filter(i => i.due === T).length;
  const wait = db.items.filter(i => isOpen(i) && i.list === 'waiting' && i.due && i.due <= T).length;
  $('#tally').innerHTML = `<span>Today <b>${td}</b></span>${od ? `<span class="late">Overdue <b>${od}</b></span>` : ''}${wait ? `<span>To chase <b>${wait}</b></span>` : ''}<span>Inbox <b>${db.items.filter(isInbox).length}</b></span>`;
  $('#cap').classList.toggle('hide', ui.view !== 'today');
  const revDue = (nowHM() >= S().triageTime && db.meta.lastTriage !== T);
  const badges = { today: od, lists: wait, review: revDue ? '•' : 0, upcoming: radarAlert() ? '•' : 0, sources: db.intake.length };
  $('#nav').innerHTML = NAV.map(([k, l]) => `<button class="${ui.view === k ? 'on' : ''}" data-a="go" data-v="${k}">${ICON[k]}<span>${l}</span>${badges[k] ? `<b class="dot">${badges[k]}</b>` : ''}</button>`).join('');
  $('#main').innerHTML = VIEWS[ui.view]();
  if (ui.flash) { const el = document.getElementById('r-' + ui.flash); if (el) { el.classList.add('focus'); setTimeout(() => el.classList.remove('focus'), 1400); } ui.flash = null; }
}
function go(v) { ui.view = v; render(); window.scrollTo(0, 0); }

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, acts) {
  ui.toastActs = acts || [];
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${ui.toastActs.map((a, k) => `<button class="btn sm ${a.cls || ''}" data-a="toast" data-v="${k}">${esc(a.label)}</button>`).join('')}`;
  el.classList.add('on'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), acts && acts.length ? 6500 : 2600);
}

/* ---------- capture ---------- */
const TPLS = [
  { label: 'Call', ins: 'Call ' }, { label: 'Buy', ins: 'Buy ' }, { label: 'Pay / renew', ins: 'Pay ' },
  { label: 'Book', ins: 'Book ' }, { label: 'Waiting on', ins: 'Waiting on ' }, { label: 'Gift idea', ins: 'Gift for ' },
  { label: 'Expiry', ins: ' expires ', tail: true }, { label: 'Every N days', ins: ' every 30 days after done', tail: true },
  { label: 'Idea', note: '', list: 'someday', title: 'Idea' },
  { label: 'Purchase research', note: 'Options\n1. \n2. \n3. \n\nBudget:\nMust-haves:\nDeal-breakers:\n\nDecision:', title: 'Research: ' },
  { label: 'Meeting note', note: 'With:\nPurpose:\n\nNotes\n\nDecisions\n\nActions\n- ', area: 'work', title: 'Meeting: ' },
  { label: 'Delegate', ins: '', delegate: true }
];
const PLACEHOLDERS = ['Call DEWA tmrw commute', 'Vet for dogs tue 5pm', 'Buy shampoo on noon', 'Chase Ahmed re quote', 'Text builder when home', 'Passport expires 3/27', 'Learn to sail someday', 'AC filter every 3 months'];
function renderTpls() { $('#tpls').innerHTML = TPLS.map((t, k) => `<button class="tpl" data-a="tpl" data-v="${k}">${t.label}</button>`).join(''); }
function autosize() { const q = $('#q'); q.style.height = 'auto'; q.style.height = Math.min(160, q.scrollHeight + 2) + 'px'; }
function previewChips(p) {
  const c = [];
  if (p.area) c.push(`<span class="chip area bl-${p.area} tap" data-a="pvArea">${AREA_LABEL[p.area]}</span>`); else c.push(`<span class="chip area bl-none tap" data-a="pvArea">Inbox</span>`);
  if (p.list) c.push(`<span class="chip">${LIST_NAME[p.list]}${p.shop ? ' · ' + esc(p.shop) : ''}${p.person ? ' · ' + esc(p.person) : ''}</span>`);
  else if (p.person) c.push(`<span class="chip">@${esc(p.person)}</span>`);
  if (p.expiry) c.push(`<span class="chip hard">Expires ${p.expiry.date ? fmtD(p.expiry.date, true) : '— add a date'}</span>`);
  else if (p.due) c.push(`<span class="chip ${p.hard ? 'hard' : ''}">${relDay(p.due)}${p.time ? ' · ' + (p.slot ? slotLabel(p.slot) + ' ' : '') + p.time : ''}</span>`);
  if (p.recur) c.push(`<span class="chip">↻ ${esc(recurText(p.recur))}</span>`);
  if (p.effort) c.push(`<span class="chip">~${p.effort}${p.effortGuess ? '?' : ''}</span>`);
  if (p.hard) c.push(`<span class="chip hard">◆ hard → calendar</span>`);
  return c.join('');
}
let pvArea = undefined;
function renderPreview() {
  const v = $('#q').value.trim();
  if (!v) { $('#pv').innerHTML = ''; pvArea = undefined; return; }
  const p = parse(v); if (pvArea !== undefined) p.area = pvArea;
  $('#pv').innerHTML = `<span class="chip" style="border:0;padding-left:0;color:var(--ink)">“${esc(p.title)}”</span>` + previewChips(p);
}
function addFromCapture() {
  const q = $('#q'), v = q.value.trim(); if (!v) { q.focus(); return; }
  const p = parse(v);
  if (pvArea !== undefined) { p.area = pvArea; if (pvArea) learnArea(p.title, pvArea); }
  const i = itemFromParse(p);
  if (ui.viaVoice) { i.src = { kind: 'voice', from: null, name: null, subject: null, at: today(), ref: null, url: null, quote: v.slice(0, 200) }; ui.viaVoice = false; }
  if (ui.pendingDelegate) { ui.pendingDelegate = false; db.items.push(i); save(); q.value = ''; renderPreview(); autosize(); render(); openSheet({ type: 'delegate', id: i.id }); return; }
  db.items.push(i); save();
  q.value = ''; pvArea = undefined; renderPreview(); autosize();
  ui.flash = i.id; ui.undo = { snap: null, addId: i.id };
  if (ui.view !== 'today') ui.view = 'today';
  render();
  const undo = { label: 'Undo', fn: () => { db.items = db.items.filter(x => x.id !== i.id); save(); render(); } };
  if (i.hard && i.due) toast(`Added · ${i.expiry ? 'expiry' : relL(i.due) + (i.time ? ' ' + i.time : '')}`, [{ label: '→ Calendar', cls: 'redsolid', fn: () => sendCal(i.id) }, undo]);
  else if (i.expiry && !i.expiry.date) toast('Added to radar — needs a date', [{ label: 'Set date', fn: () => openSheet({ type: 'edit', id: i.id }) }]);
  else if (i.list) toast(`Added to ${LIST_NAME[i.list]}`, [undo]);
  else toast(i.due ? `Added · ${relL(i.due)}${i.time ? ' ' + i.time : ''}` : `Added to ${i.area ? AREA_LABEL[i.area] : 'Inbox'}`, [undo]);
}

/* ---------- voice ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function toggleMic() {
  if (!SR) { toast('Voice not supported here — use the keyboard mic'); return; }
  if (rec) { rec.stop(); return; }
  const q = $('#q'), base = q.value ? q.value.trim() + ' ' : '';
  rec = new SR(); rec.lang = S().voiceLang; rec.interimResults = true; rec.continuous = false;
  let final = '';
  rec.onresult = e => {
    let interim = ''; final = '';
    for (const r of e.results) { if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; }
    q.value = base + (final || interim); ui.viaVoice = true; autosize(); renderPreview();
  };
  rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Mic: ' + e.error); };
  rec.onend = () => { rec = null; $('#mic').classList.remove('live'); if (final && S().autoAddVoice) addFromCapture(); };
  try { rec.start(); $('#mic').classList.add('live'); } catch (e) { rec = null; }
}

/* ---------- calendar ---------- */
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai'; } catch (e) { return 'Asia/Dubai'; } })();
const compact = d => d.replace(/-/g, '');
function addMin(d, t, m) { const [h, mm] = t.split(':').map(Number); const x = pd(d); x.setHours(h, mm + m); return `${ds(x)}T${pad(x.getHours())}${pad(x.getMinutes())}00`; }
function rrule(i) {
  const rc = i.recur; if (!rc) return null;
  if (rc.kind === 'season') return rc.key === 'ramadan' ? null : 'RRULE:FREQ=YEARLY';
  if (rc.kind !== 'fixed') return null;
  const F = { d: 'DAILY', w: 'WEEKLY', m: 'MONTHLY', y: 'YEARLY' }[rc.unit];
  let r = `RRULE:FREQ=${F}`; if (rc.n > 1) r += `;INTERVAL=${rc.n}`;
  if (rc.dows && rc.dows.length) r += ';BYDAY=' + rc.dows.map(x => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][x]).join(',');
  return r;
}
function calTitle(i) { return i.expiry && i.expiry.date ? `${i.title} — expires ${fmtD(i.expiry.date, true)} (${diff(i.due || today(), i.expiry.date)}d warning)` : i.title; }
function calLink(ev) {
  const p = new URLSearchParams();
  if (S().calMethod !== 'gcal2') p.set('action', 'TEMPLATE');
  p.set('text', ev.title); p.set('dates', ev.dates); p.set('details', ev.details); p.set('ctz', TZ);
  if (ev.rrule) p.set('recur', ev.rrule);
  return (S().calMethod === 'gcal2' ? 'https://calendar.google.com/calendar/r/eventedit?' : 'https://calendar.google.com/calendar/render?') + p.toString();
}
function icsFile(ev, allDay, start, end) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Margin//EN', 'BEGIN:VEVENT', `UID:${uid()}@margin`, `DTSTAMP:${compact(ds(new Date()))}T000000Z`,
    allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART;TZID=${TZ}:${start}`, allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND;TZID=${TZ}:${end}`,
    `SUMMARY:${ev.title.replace(/[,;]/g, m => '\\' + m)}`, `DESCRIPTION:${ev.details.replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m)}`];
  if (ev.rrule) L.push(ev.rrule);
  L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', allDay ? 'TRIGGER:-PT15H' : 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  return L.join('\r\n');
}
function openEvent(ev) {
  const allDay = !ev.time, d = ev.date;
  const start = allDay ? compact(d) : `${compact(d)}T${ev.time.replace(':', '')}00`;
  const end = allDay ? compact(addDays(d, 1)) : addMin(d, ev.time, ev.mins || 30).replace(/-/g, '');
  ev.dates = `${start}/${end}`;
  if (S().calMethod === 'ics') download(`${ev.title.slice(0, 40).replace(/[^\w]+/g, '-')}.ics`, icsFile(ev, allDay, start, end), 'text/calendar');
  else openURL(calLink(ev));
}
function sendCal(id) {
  const i = findItem(id); if (!i) return;
  const d = i.due || today();
  openEvent({ title: calTitle(i), date: d, time: i.time, details: [i.note, `Area: ${i.area ? AREA_LABEL[i.area] : 'Inbox'}`, '— sent from Margin'].filter(Boolean).join('\n\n'), rrule: rrule(i) });
  i.calAt = today(); save(); render(); if (ui.sheet && ui.sheet.type === 'edit') renderSheet();
}
function openURL(u) { const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
function download(name, text, type) {
  const b = new Blob([text], { type: type || 'application/octet-stream' }); const u = URL.createObjectURL(b);
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

/* ---------- WhatsApp ---------- */
const waURL = (phone, text) => `https://wa.me/${(phone || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`;
const greet = name => !name || /wife|husband|nanny|partner|mum|dad/i.test(name) ? 'Hi' : `Hi ${name.split(' ')[0]}`;
const lowerFirst = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
const VERBS = /^(call|ring|book|buy|order|pay|pick|collect|drop|take|walk|feed|clean|wash|check|send|bring|get|fix|give|make|prepare|prep|put|remind|text|message|email|sort|organise|organize|schedule|arrange|renew|return|restock|tidy|bath|bathe|cook|change|charge|fill|top|water|find|ask|tell|confirm|cancel|print|post|pack|unpack|move|help|look|follow|chase|update|reply|let)\b/i;
function delegateMsg(i, c) { const what = VERBS.test(i.title) ? lowerFirst(i.title) : `take care of this: ${i.title}`; return `${greet(c && c.name)}, could you please ${what}${i.due ? ` by ${relL(i.due)}${i.time ? ' ' + i.time : ''}` : ''}? Thank you!`; }

/* ---------- backup ---------- */
function doBackup(auto) {
  const T = today();
  download(`margin-backup-${T}.json`, JSON.stringify(db, null, 1), 'application/json');
  db.meta.lastBackup = T; save();
  toast(auto ? 'Weekly backup saved to Downloads' : 'Backup saved to Downloads');
  render();
}
function armAutoBackup() {
  const T = today(), lb = db.meta.lastBackup;
  if (!db.items.length) return;
  const due = (dowOf(T) === +S().backupDay && lb !== T) || (lb && diff(lb, T) >= 7);
  if (!due) return;
  const h = () => { document.removeEventListener('click', h, true); setTimeout(() => doBackup(true), 50); };
  document.addEventListener('click', h, true);
}
function importFile(f) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result); if (!j || !j.v || !Array.isArray(j.items)) throw 0;
      ui.pendingImport = j; openSheet({ type: 'import' });
    } catch (e) { toast('That file isn\u2019t a Margin backup'); }
  };
  r.readAsText(f);
}

/* ---------- sheets ---------- */
function openSheet(s) { ui.sheet = s; renderSheet(); $('#sheet').classList.add('on'); $('#scrim').classList.add('on'); $('#sheet').scrollTop = 0; }
function closeSheet() {
  const s = ui.sheet;
  if (s && s.type === 'edit') { const i = findItem(s.id); if (i && !i.title.trim()) db.items = db.items.filter(x => x.id !== i.id); save(); }
  if (s && s.type === 'step' && s.finished) { }
  ui.sheet = null; $('#sheet').classList.remove('on', 'full'); $('#scrim').classList.remove('on');
  render();
}
function renderSheet() {
  const s = ui.sheet; if (!s) return;
  const el = $('#sheet'); const st = el.scrollTop;
  el.classList.toggle('full', s.type === 'step' || s.type === 'settings');
  const fn = { edit: shEdit, snooze: shSnooze, decide: shDecide, delegate: shDelegate, renew: shRenew, settings: shSettings, batch: shBatch, step: shStep, import: shImport }[s.type];
  el.innerHTML = `<div class="perf"></div><div class="sh">${fn(s)}</div>`;
  el.scrollTop = st;
}
const head = (t, extra) => `<div class="sh-h"><h3>${t}</h3>${extra || ''}<button class="close" data-a="closeSheet" aria-label="Close">×</button></div>`;
const opt = (on, a, v, label, cls) => `<button class="opt ${cls || 'plain'} ${on ? 'on' : ''}" data-a="${a}" data-v="${esc(v)}">${label}</button>`;

function shEdit(s) {
  const i = findItem(s.id); if (!i) return head('Gone');
  const T = today(), rc = i.recur || {};
  const rkind = i.recur ? i.recur.kind : 'none';
  const slots = i.due ? anchorsFor(i.due) : S().anchors.wd;
  let h = head(i.status === 'open' ? (i.expiry ? 'Expiry' : 'Item') : 'Finished item');
  h += `<div class="fld"><input type="text" class="title-in" data-f="title" value="${esc(i.title)}" placeholder="What is it?" ${i.title ? '' : 'autofocus'}></div>`;
  h += `<div class="fld"><span class="sc">Area</span><div class="chips">${AREAS.map(a => opt(i.area === a.k, 'ed-area', a.k, a.label, 'bl-' + a.k)).join('')}${opt(!i.area, 'ed-area', '', 'Inbox', 'bl-none')}</div></div>`;
  if (!i.expiry) {
    h += `<div class="fld"><span class="sc">When</span><div class="chips" style="margin-bottom:8px">${[['today', 'Today'], ['tonight', 'Tonight'], ['tmrw', 'Tomorrow'], ['weekend', 'Weekend'], ['nextweek', 'Next week'], ['clear', 'No date']].map(([k, l]) => opt(false, 'ed-when', k, l)).join('')}</div>
      <div class="two"><input type="date" data-f="due" value="${i.due || ''}" aria-label="Date"><input type="time" data-f="time" value="${i.time || ''}" aria-label="Time"></div></div>`;
    if (i.due) h += `<div class="fld"><span class="sc">Slot · ${isWeekend(i.due) ? 'weekend' : 'weekday'}</span><div class="chips">${slots.map(a => opt(i.slot === a.k, 'ed-slot', a.k, `${a.label} ${a.t}`)).join('')}</div></div>`;
    h += `<div class="fld"><span class="sc">Alert</span><div class="chips">${opt(!i.hard, 'ed-hard', '0', 'Soft · in app')}${opt(i.hard, 'ed-hard', '1', '◆ Hard · calendar')}${i.hard ? `<button class="btn sm redsolid" data-a="cal" data-id="${i.id}">${i.calAt ? 'Re-send' : 'Send'} to calendar</button>` : ''}</div></div>`;
  } else {
    const L = sortLeads(i);
    h += `<div class="fld"><span class="sc">Expires on</span><input type="date" data-f="exdate" value="${i.expiry.date || ''}"></div>
      <div class="two"><div class="fld"><span class="sc">Warn me (days before)</span><input type="text" data-f="exleads" value="${L.join(', ')}" inputmode="numeric"></div><div class="fld"><span class="sc">Renews for (years)</span><input type="number" min="1" max="10" data-f="exyears" value="${i.expiry.renewYears || 1}"></div></div>`;
    if (i.expiry.date) h += `<div class="fld"><span class="sc">Next warning</span><div>${i.due ? fmtDay(i.due) : '—'} <span class="muted">· ${diff(T, i.expiry.date)} days to expiry</span></div><div class="chips" style="margin-top:8px"><button class="btn sm redsolid" data-a="cal" data-id="${i.id}">${i.calAt ? 'Re-send' : 'Send'} warning to calendar</button></div></div>`;
  }
  h += `<div class="fld"><span class="sc">Effort</span><div class="chips">${[['2m', '2 min'], ['15m', '15 min'], ['deep', 'Deep'], ['', 'None']].map(([k, l]) => opt((i.effort || '') === k, 'ed-effort', k, l)).join('')}</div></div>`;
  if (!i.expiry) {
    h += `<div class="fld"><span class="sc">Repeat</span><select data-f="rkind"><option value="none" ${rkind === 'none' ? 'selected' : ''}>Doesn't repeat</option><option value="fixed" ${rkind === 'fixed' ? 'selected' : ''}>On a fixed schedule</option><option value="float" ${rkind === 'float' ? 'selected' : ''}>A set time after I last did it</option><option value="season" ${rkind === 'season' ? 'selected' : ''}>Every year, by season</option></select>`;
    if (rkind === 'fixed' || rkind === 'float') {
      h += `<div class="two" style="margin-top:8px"><input type="number" min="1" max="365" data-f="rn" value="${rc.n || 1}" aria-label="Every"><select data-f="runit">${[['d', 'days'], ['w', 'weeks'], ['m', 'months'], ['y', 'years']].map(([k, l]) => `<option value="${k}" ${rc.unit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      if (rkind === 'fixed' && rc.unit === 'w') h += `<div class="chips" style="margin-top:8px">${[1, 2, 3, 4, 5, 6, 0].map(d => opt((rc.dows || []).includes(d), 'ed-dow', d, DOW_N[d])).join('')}</div>`;
    }
    if (rkind === 'season') h += `<select data-f="rseason" style="margin-top:8px">${Object.keys(SEASONS).map(k => `<option value="${k}" ${rc.key === k ? 'selected' : ''}>${SEASONS[k].label}${k === 'ramadan' ? ' (approx. dates)' : ` · ${fmtD('2027-' + SEASONS[k].md).replace(' 2027', '')}`}</option>`).join('')}</select>`;
    h += `</div>`;
    h += `<div class="fld"><span class="sc">List</span><div class="chips">${[['', 'None'], ['buy', 'Buy'], ['gift', 'Gift'], ['waiting', 'Waiting on'], ['someday', 'Someday']].map(([k, l]) => opt((i.list || '') === k, 'ed-list', k, l)).join('')}</div></div>`;
    if (i.list === 'buy') h += `<div class="fld"><span class="sc">Shop</span><input type="text" data-f="shop" value="${esc(i.shop || '')}" list="shops" placeholder="Amazon, Noon, Carrefour…"><datalist id="shops">${[...new Set(Object.values(SHOPS))].map(x => `<option value="${x}">`).join('')}</datalist></div>`;
    if (i.list === 'gift' || i.list === 'waiting') h += `<div class="fld"><span class="sc">${i.list === 'gift' ? 'For' : 'Who'}</span><input type="text" data-f="person" value="${esc(i.person || '')}" list="ppl"><datalist id="ppl">${S().contacts.map(c => `<option value="${esc(c.name)}">`).join('')}<option value="George"></datalist></div>`;
  }
  h += `<div class="fld"><span class="sc">Note</span><textarea data-f="note" placeholder="Details, links, numbers…">${esc(i.note || '')}</textarea></div>`;
  h += srcBlock(i);
  if (i.lastDone) h += `<div class="sc muted" style="margin:-4px 0 12px">Last done ${fmtD(i.lastDone, true)} · ${db.log.filter(l => l.id === i.id).length}× total</div>`;
  h += `<div class="acts">`;
  if (i.status === 'open') {
    h += `<button class="btn solid" data-a="done" data-id="${i.id}">${i.expiry ? 'Renewed' : 'Done'}</button>`;
    if (!i.expiry && i.list !== 'waiting') h += `<button class="btn" data-a="delegate" data-id="${i.id}">Send via WhatsApp</button>`;
    if (!i.expiry && i.list !== 'someday') h += `<button class="btn" data-a="ed-someday" data-id="${i.id}">Someday</button>`;
    h += `<button class="btn ghost" data-a="ed-drop" data-id="${i.id}">Drop</button>`;
  } else h += `<button class="btn solid" data-a="reopen" data-id="${i.id}">Reopen</button>`;
  h += `<button class="btn redb" data-a="ed-delete" data-id="${i.id}" style="margin-left:auto">Delete</button></div>`;
  return h;
}
// Where an item came from, kept with the item so you can always check the original.
function srcBlock(i) {
  const s = i.src; if (!s || !s.kind || s.kind === 'manual') return '';
  const L = [s.from || s.name, s.subject, s.at ? fmtD(s.at, true) : null].filter(Boolean);
  return `<div class="srcbox"><div class="sc k">${SRC_MARK[s.kind] || ''} From ${esc(SRC_LABEL[s.kind] || s.kind)}</div>
    <div>${L.map(x => esc(String(x))).join('<br>')}</div>
    ${s.quote ? `<div class="quote">${esc(s.quote.slice(0, 400))}${s.quote.length > 400 ? '…' : ''}</div>` : ''}
    <div class="chips" style="margin-top:8px">${s.url ? `<button class="btn sm" data-a="openUrl" data-v="${esc(s.url)}">Open the original</button>` : ''}<button class="btn sm ghost" data-a="ed-unsrc" data-id="${i.id}">Forget where this came from</button></div></div>`;
}
function snoozeOpts(i) {
  const T = today(), now = nowHM(), o = [];
  const nextToday = anchorsFor(T).find(a => a.t > now && (!i.time || a.t > i.time || i.due !== T));
  if (nextToday) o.push({ b: 'Later today', s: `${nextToday.label} ${nextToday.t}`, d: T, slot: nextToday.k });
  const tm = addDays(T, 1), ta = anchorsFor(tm);
  const tFirst = ta[isWeekend(tm) ? 0 : 1];
  o.push({ b: 'Tomorrow', s: `${tFirst.label} ${tFirst.t}`, d: tm, slot: tFirst.k });
  const tEve = ta[ta.length - 1];
  o.push({ b: 'Tomorrow eve', s: `${tEve.label} ${tEve.t}`, d: tm, slot: tEve.k });
  const we = S().weekend, first = Math.min(...we.map(x => x === 0 ? 7 : x)) % 7;
  let wd = isWeekend(T) ? nextDow(T, first, false) : nextDow(T, first, false); if (wd === tm && !isWeekend(T)) wd = nextDow(T, first, false);
  const wa = anchorsFor(wd)[0];
  o.push({ b: 'Weekend', s: `${DOW_N[dowOf(wd)]} ${fmtD(wd)} · ${wa.t}`, d: wd, slot: wa.k });
  const nw = nextDow(T, 1, false), na = anchorsFor(nw)[1] || anchorsFor(nw)[0];
  o.push({ b: 'Next week', s: `Mon ${fmtD(nw)} · ${na.t}`, d: nw, slot: na.k });
  o.push({ b: 'In a month', s: fmtD(addMonths(T, 1)), d: addMonths(T, 1), slot: null });
  return o;
}
function shSnooze(s) {
  const i = findItem(s.id); if (!i) return head('Gone');
  let h = head('Push it', '');
  h += `<div style="margin:-4px 0 12px;font-size:16px">${esc(i.title)}${i.snoozes ? ` <span class="sc red">pushed ×${i.snoozes}</span>` : ''}</div>`;
  if (i.expiry && i.expiry.date) {
    const L = sortLeads(i), a = i.expiry.ack || 0;
    const nx = a + 1 < L.length ? `${L[a + 1]}-day warning · ${fmtD(addDays(i.expiry.date, -L[a + 1]))}` : `On expiry day · ${fmtD(i.expiry.date)}`;
    h += `<div class="snz-list" style="margin-bottom:10px"><button data-a="exnext" data-id="${i.id}"><b>Next warning</b><small>${nx}</small></button><button data-a="done" data-id="${i.id}"><b>Renewed</b><small>set new expiry</small></button></div>`;
  }
  h += `<div class="snz-list">${snoozeOpts(i).map((o, k) => `<button data-a="snz" data-id="${i.id}" data-v="${k}"><b>${o.b}</b><small>${esc(o.s)}</small></button>`).join('')}</div>`;
  h += `<div class="fld" style="margin-top:14px"><span class="sc">Pick a date</span><input type="date" data-snzdate="${i.id}" min="${today()}"></div>`;
  h += `<div class="acts"><button class="btn" data-a="snzSomeday" data-id="${i.id}">Someday</button>${i.list !== 'waiting' && !i.expiry ? `<button class="btn" data-a="delegate" data-id="${i.id}">Delegate</button>` : ''}<button class="btn ghost" data-a="ed-drop" data-id="${i.id}">Drop</button></div>`;
  return h;
}
function shDecide(s) {
  const i = findItem(s.id); if (!i) return head('Gone');
  return head('Decide') + `<div class="decide">You've pushed <b>${esc(i.title)}</b> ${i.snoozes} times. Pushing again won't help. Pick one:</div>
  <div class="snz-list">
    <button data-a="dc-now" data-id="${i.id}"><b>Do it now</b><small>pin to top of today</small></button>
    <button data-a="delegate" data-id="${i.id}"><b>Delegate</b><small>WhatsApp + chase date</small></button>
    <button data-a="dc-firm" data-id="${i.id}"><b>Firm date</b><small>hard + calendar</small></button>
    <button data-a="snzSomeday" data-id="${i.id}"><b>Someday</b><small>park it, resurfaces later</small></button>
    <button data-a="ed-drop" data-id="${i.id}"><b>Drop it</b><small>it doesn't matter</small></button>
    <button data-a="dc-snooze" data-id="${i.id}"><b>Push anyway</b><small>just this once</small></button>
  </div>`;
}
function shDelegate(s) {
  const i = findItem(s.id); if (!i) return head('Gone');
  const cs = S().contacts;
  const c = cs.find(x => x.id === ui.delegateTo) || null;
  if (ui.fu == null) ui.fu = S().followUpDays;
  if (s.msg == null || s.lastTo !== ui.delegateTo) { s.msg = delegateMsg(i, c); s.lastTo = ui.delegateTo; }
  return head('Send via WhatsApp') + `<div class="fld"><span class="sc">To</span><div class="chips">${cs.map(x => opt(ui.delegateTo === x.id, 'dg-to', x.id, esc(x.name) + (x.phone ? '' : ' ·'))).join('')}${opt(!ui.delegateTo, 'dg-to', '', 'Choose in WhatsApp')}</div>${c && !c.phone ? '<div class="hint">No number saved for this contact, so WhatsApp will ask who to send it to. Add numbers in Settings.</div>' : ''}</div>
  <div class="fld"><span class="sc">Message</span><textarea class="wa-text" data-dgmsg>${esc(s.msg)}</textarea></div>
  <div class="fld"><span class="sc">Chase me in</span><div class="chips">${[1, 2, 3, 5, 7, 14].map(n => opt(ui.fu === n, 'dg-fu', n, n + 'd')).join('')}</div></div>
  <div class="acts"><button class="btn redsolid" data-a="dg-send" data-id="${i.id}">Open WhatsApp</button><span class="hint">The item moves to Waiting on, with a chase date.</span></div>`;
}
function shRenew(s) {
  const i = findItem(s.id); if (!i) return head('Gone');
  const base = i.expiry.date && i.expiry.date > today() ? i.expiry.date : today();
  const sug = addMonths(base, 12 * (i.expiry.renewYears || 1));
  return head('Renewed') + `<div style="margin-bottom:12px;font-size:17px">${esc(i.title)}</div><div class="fld"><span class="sc">New expiry date</span><input type="date" id="renewDate" value="${sug}"></div><div class="hint" style="margin:-6px 0 12px">Suggested: ${i.expiry.renewYears || 1} year(s) on. Check the actual date on the document.</div><div class="acts"><button class="btn solid" data-a="renewSave" data-id="${i.id}">Save & log</button><button class="btn ghost" data-a="renewNone" data-id="${i.id}">No longer needed</button></div>`;
}
function shBatch(s) {
  const g = batchGroups().find(x => x.k === s.k);
  const its = g ? g.items : [];
  return head(`Batch · ${g ? g.label : ''}`) + `<div class="step-sub">Do these in one go. Tick each one as you finish it.</div>${its.map(i => rowHTML(i, 'list')).join('') || '<div class="empty">All done.</div>'}`;
}
function shImport() {
  const j = ui.pendingImport;
  return head('Restore backup') + `<p>The backup has <b>${j.items.length}</b> items and <b>${j.log.length}</b> done-log entries. Restoring replaces everything on this phone.</p><div class="acts"><button class="btn redsolid" data-a="importGo">Replace with backup</button><button class="btn ghost" data-a="closeSheet">Cancel</button></div>`;
}
function shSettings() {
  const st = S();
  const an = (grp, lbl) => `<div class="set-p">${lbl}</div>` + st.anchors[grp].map((a, k) => `<div class="kv"><input type="text" class="short" data-anchorlbl="${grp}.${k}" value="${esc(a.label)}" style="border:0;background:transparent;font-size:16px;padding:0;flex:1;min-width:0"><input type="time" data-anchor="${grp}.${k}" value="${a.t}"></div>`).join('');
  let h = head('Settings');
  h += `<div class="set-h">Your day</div><div class="set-p">These times are the one-tap slots and the times behind "commute", "when home" and "after bedtime".</div>${an('wd', 'Weekdays')}${an('we', 'Weekends')}`;
  h += `<div class="kv"><span>Weekend days</span><span class="chips">${[5, 6, 0].map(d => opt(st.weekend.includes(d), 'set-we', d, DOW_N[d])).join('')}</span></div>`;
  h += `<div class="set-h">Rituals</div><div class="kv"><span>Evening triage from</span><input type="time" data-set="triageTime" value="${st.triageTime}"></div>
    <div class="kv"><span>Weekly review</span><span><select data-set="reviewDay" data-num="1" style="border:0;background:transparent">${[0, 1, 2, 3, 4, 5, 6].map(d => `<option value="${d}" ${+st.reviewDay === d ? 'selected' : ''}>${DOW_N[d]}</option>`).join('')}</select> <input type="time" data-set="reviewTime" value="${st.reviewTime}"></span></div>
    <div class="kv"><span>Someday resurfaces every</span><select data-set="resurfaceEvery" data-num="1" style="border:0;background:transparent">${[7, 14, 21, 30, 60].map(n => `<option value="${n}" ${+st.resurfaceEvery === n ? 'selected' : ''}>${n} days</option>`).join('')}</select></div>`;
  h += `<div class="set-h">Alerts</div><div class="set-p">Hard items (a clock time, a "!" or an expiry) get a Calendar button, and your phone's calendar sends the alert. Set a default notification in Google Calendar settings, e.g. 10 minutes before, or 09:00 the day before for all-day events.</div>
    <div class="kv"><span>Send to</span><select data-set="calMethod" style="border:0;background:transparent;max-width:55%"><option value="gcal" ${st.calMethod === 'gcal' ? 'selected' : ''}>Google Calendar</option><option value="gcal2" ${st.calMethod === 'gcal2' ? 'selected' : ''}>Google Calendar (alt link)</option><option value="ics" ${st.calMethod === 'ics' ? 'selected' : ''}>.ics file (Outlook, etc.)</option></select></div>
    <div class="kv"><span>Expiry warnings (days)</span><input type="text" class="short" data-set="leads" value="${st.leads.join(', ')}" style="border:0;border-bottom:1px solid var(--ink2);background:transparent;text-align:right;font-family:var(--mono)"></div>
    <div class="kv"><span>Default chase after sending</span><select data-set="followUpDays" data-num="1" style="border:0;background:transparent">${[1, 2, 3, 5, 7].map(n => `<option value="${n}" ${+st.followUpDays === n ? 'selected' : ''}>${n} days</option>`).join('')}</select></div>`;
  h += `<div class="set-h">WhatsApp contacts</div><div class="set-p">Add numbers with country code (e.g. 9715…) to skip the contact picker.</div>${st.contacts.map((c, k) => `<div class="contact"><input data-contact="${k}.name" value="${esc(c.name)}" placeholder="Name"><input data-contact="${k}.phone" value="${esc(c.phone)}" placeholder="9715…" inputmode="tel"><button data-a="delContact" data-v="${k}" aria-label="Remove">×</button></div>`).join('')}<button class="btn sm" data-a="addContact" style="margin-top:8px">+ Contact</button>`;
  h += `<div class="set-h">Capture</div><div class="kv"><span>Voice language</span><select data-set="voiceLang" style="border:0;background:transparent">${[['en-AU', 'English (AU)'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['ar-AE', 'Arabic (UAE)']].map(([k, l]) => `<option value="${k}" ${st.voiceLang === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="kv"><span>Add straight after dictation</span><span class="chips">${opt(st.autoAddVoice, 'set-bool', 'autoAddVoice', st.autoAddVoice ? 'On' : 'Off')}</span></div>
    <div class="kv"><span>Open keyboard on launch</span><span class="chips">${opt(st.focusOnOpen, 'set-bool', 'focusOnOpen', st.focusOnOpen ? 'On' : 'Off')}</span></div>
    <div class="kv"><span>Learned area words</span><span><span class="sc muted">${Object.keys(st.learned || {}).length}</span> <button class="btn sm ghost" data-a="clearLearned">Clear</button></span></div>`;
  h += `<div class="set-h">Sources</div><div class="set-p">Email, calendar invites, files and links arrive in the Sources tab as suggestions you accept or skip. Everything is read on this phone; nothing is uploaded.</div>
    <div class="kv"><span>Your email address</span><input type="email" class="short" data-set2="myEmail" value="${esc(st.myEmail || '')}" placeholder="you@example.com" style="border:0;border-bottom:1px solid var(--ink2);background:transparent;text-align:right"></div>
    <div class="kv"><span>Keep a snippet of the original</span><span class="chips">${opt(st.sources.keepQuote, 'set-src', 'keepQuote', st.sources.keepQuote ? 'On' : 'Off')}</span></div>
    <div class="kv"><span>Most suggestions per message</span><select data-set2="sources.maxPerMessage" style="border:0;background:transparent">${[1, 3, 5, 8].map(n => `<option value="${n}" ${+st.sources.maxPerMessage === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="chips" style="margin-top:10px"><button class="btn" data-a="go" data-v="sources">Open Sources</button></div>`;
  h += `<div class="set-h">Look</div><div class="kv"><span>Theme</span><span class="chips">${[['auto', 'Auto'], ['light', 'Paper'], ['dark', 'Night']].map(([k, l]) => opt(st.theme === k, 'set-theme', k, l)).join('')}</span></div>`;
  h += `<div class="set-h">Data</div><div class="set-p">Stored on this phone only. A backup file downloads automatically on the first tap each <select data-set="backupDay" data-num="1" style="border:0;background:transparent;font:inherit;text-decoration:underline">${[0, 1, 2, 3, 4, 5, 6].map(d => `<option value="${d}" ${+st.backupDay === d ? 'selected' : ''}>${DOW_N[d]}</option>`).join('')}</select>. Last: ${db.meta.lastBackup ? fmtD(db.meta.lastBackup, true) : 'never'}.</div>
    <div class="chips"><button class="btn" data-a="backup">Back up now</button><button class="btn" data-a="import">Restore from file</button><button class="btn redb" data-a="wipe">${ui.wipeArm ? 'Tap again to erase all' : 'Erase everything'}</button></div>
    <div class="hint" style="margin-top:18px">Margin · ${db.items.length} items · ${db.log.length} log entries</div>`;
  return h;
}

/* ---------- guided steps ---------- */
function triRow(i, extra) {
  const T = today();
  const areaChips = !i.area ? `<div class="chips" style="margin-bottom:6px">${AREAS.map(a => `<button class="opt bl-${a.k}" data-a="qd" data-id="${i.id}" data-v="area:${a.k}">${a.label}</button>`).join('')}</div>` : '';
  return `<div class="tri"><div class="t">${esc(i.title)} <span class="sc muted">${i.area ? AREA_LABEL[i.area] : ''}${i.due && i.due < T ? ' · ' + diff(i.due, T) + 'd late' : ''}${i.snoozes ? ' · pushed ×' + i.snoozes : ''}</span></div>${areaChips}<div class="chips">${extra || ''}${[['today', 'Today'], ['tmrw', 'Tmrw'], ['weekend', 'Weekend'], ['nextweek', 'Next wk'], ['someday', 'Someday'], ['done', '✓ Done'], ['drop', 'Drop']].map(([k, l]) => `<button class="opt plain" data-a="qd" data-id="${i.id}" data-v="${k}">${l}</button>`).join('')}<button class="opt plain" data-a="delegate" data-id="${i.id}">Delegate</button></div></div>`;
}
const STEPS = {
  triage: {
    title: 'Evening triage', done: () => { db.meta.lastTriage = today(); }, steps: [
      () => ({ h: 'What arrived', sub: 'Suggestions from email, invites, files and links. Add what matters, skip the rest.', body: db.intake.map(candHTML).join('') || '<div class="empty">Nothing arrived from your sources today.</div>' }),
      () => { const its = db.items.filter(isInbox); return { h: 'Empty the inbox', sub: 'Give each item an area and a when. Or drop it.', body: its.map(i => triRow(i)).join('') || '<div class="empty">Inbox is empty.</div>' }; },
      () => { const T = today(); const its = db.items.filter(i => actionable(i) && i.due && i.due < T).sort(byDue); return { h: 'Overdue', sub: 'Move each one to a real day, park it, or let it go.', body: its.map(i => triRow(i)).join('') || '<div class="empty">Nothing overdue.</div>' }; },
      () => { const d = addDays(today(), 1); const its = db.items.filter(i => actionable(i) && i.due === d).sort(byTime); return { h: 'Tomorrow · ' + fmtDay(d), sub: its.length > 6 ? `That's ${its.length} items. Push a few now rather than tomorrow.` : 'Anything missing? Capture it below.', body: its.map(i => rowHTML(i, 'day')).join('') + `<div class="search" style="margin:12px 0 0"><input id="stepAdd" placeholder="Add for tomorrow…" enterkeyhint="done"><button class="linkbtn" data-a="stepAdd">Add</button></div>` }; }
    ]
  },
  weekly: {
    title: 'Weekly review', done: () => { db.meta.lastReview = today(); }, steps: [
      () => { const T = today(); const its = db.items.filter(i => actionable(i) && ((i.due && i.due < T) || i.snoozes >= 2)).sort(byDue); return { h: 'Stuck items', sub: 'Overdue, or pushed twice or more. Decide on each one now.', body: its.map(i => triRow(i)).join('') || '<div class="empty">Nothing stuck. Good week.</div>' }; },
      () => { const its = db.items.filter(i => isOpen(i) && i.list === 'waiting').sort(byDue); return { h: 'Waiting on', sub: 'Chase what\u2019s late, close what arrived.', body: its.map(i => rowHTML(i, 'list') + `<div class="chips" style="padding:0 0 10px calc(var(--gut) + 46px)"><button class="btn sm" data-a="chase" data-id="${i.id}">Chase</button><button class="btn sm solid" data-a="done" data-id="${i.id}">Got it</button></div>`).join('') || '<div class="empty">Not waiting on anyone.</div>' }; },
      () => { const T = today(); const its = db.items.filter(i => actionable(i) && i.due && i.due >= T && i.due <= addDays(T, 7)).sort(byDue); const heavy = {}; its.forEach(i => heavy[i.due] = (heavy[i.due] || 0) + 1); const hv = Object.keys(heavy).filter(k => heavy[k] >= 6); return { h: 'The next 7 days', sub: hv.length ? `Heavy day${hv.length > 1 ? 's' : ''}: ${hv.map(fmtDay).join(', ')}. Spread items out.` : 'Scan the week. Tap any item to move it.', body: its.map(i => rowHTML(i, 'list')).join('') || '<div class="empty">A quiet week ahead.</div>' }; },
      () => { const T = today(); const its = db.items.filter(i => isOpen(i) && i.expiry && (!i.expiry.date || diff(T, i.expiry.date) <= 90)).sort((a, b) => (a.expiry.date || '0') < (b.expiry.date || '0') ? -1 : 1); return { h: 'Expiry radar · 90 days', sub: 'Anything close to expiry, or still missing a date.', body: its.map(i => i.expiry.date ? rowHTML(i, 'list') : `<div class="tri"><div class="t">${esc(i.title)} <span class="sc red">needs date</span></div><input class="inp" type="date" data-exdate="${i.id}"></div>`).join('') || '<div class="empty">Nothing expiring within 90 days.</div>' }; },
      () => { const its = db.items.filter(i => isOpen(i) && i.list === 'someday'); return { h: 'Someday pile', sub: 'Keep, schedule or kill. Aim to kill one.', body: its.map(i => `<div class="tri"><div class="t">${esc(i.title)}</div><div class="chips"><button class="opt plain" data-a="qd" data-id="${i.id}" data-v="nextweek">Next week</button><button class="opt plain" data-a="qd" data-id="${i.id}" data-v="weekend">Weekend</button><button class="opt plain" data-a="qd" data-id="${i.id}" data-v="drop">Kill</button></div></div>`).join('') || '<div class="empty">Pile is empty.</div>' }; },
      () => { const lb = db.meta.lastBackup; return { h: 'Back up', sub: 'Everything lives on this phone. Save a copy.', body: `<p>Last backup: <b>${lb ? fmtD(lb, true) + ' (' + diff(lb, today()) + ' days ago)' : 'never'}</b></p><button class="btn solid" data-a="backup">Save backup file</button>` }; }
    ]
  },
  setup: {
    title: 'Starter pack', done: () => { db.meta.setupSeen = today(); }, steps: [
      () => { const its = db.items.filter(i => i.needsSetup && i.expiry); return { h: 'Expiry dates', sub: 'Enter the dates you have to hand. Skip the rest; they wait on the radar under "Needs a date".', body: its.map(i => `<div class="tri"><div class="t">${esc(i.title)} <span class="sc a-${i.area}">${AREA_LABEL[i.area]}</span></div>${i.note ? `<div class="hint" style="margin:-4px 0 6px">${esc(i.note)}</div>` : ''}<input class="inp" type="date" data-exdate="${i.id}"><div class="chips" style="margin-top:6px"><button class="opt plain" data-a="qd" data-id="${i.id}" data-v="delete">Not relevant — delete</button></div></div>`).join('') || '<div class="empty">All dated.</div>' }; },
      () => { const its = db.items.filter(i => i.needsSetup && i.recur && i.recur.kind === 'float'); return { h: 'Dog care: when was it last done?', sub: 'The next date is worked out from your answer. Edit the interval later if your products differ.', body: its.map(i => `<div class="tri"><div class="t">${esc(i.title)} <span class="sc muted">↻ ${esc(recurText(i.recur))}</span></div>${i.note ? `<div class="hint" style="margin:-4px 0 6px">${esc(i.note)}</div>` : ''}<div class="chips">${[['0', 'This week'], ['14', '2 weeks ago'], ['30', 'A month ago'], ['75', '2–3 months ago'], ['x', 'Not sure → today']].map(([k, l]) => `<button class="opt plain" data-a="lastDone" data-id="${i.id}" data-v="${k}">${l}</button>`).join('')}<button class="opt plain" data-a="qd" data-id="${i.id}" data-v="delete">Delete</button></div></div>`).join('') || '<div class="empty">All set.</div>' }; },
      () => { const its = db.items.filter(i => i.needsSetup && !i.expiry && !(i.recur && i.recur.kind === 'float')); return { h: 'George: next appointments', sub: 'Add a date if one is booked. Anything left blank goes on tomorrow\u2019s list as a reminder to book it.', body: its.map(i => `<div class="tri"><div class="t">${esc(i.title)}</div>${i.note ? `<div class="hint" style="margin:-4px 0 6px">${esc(i.note)}</div>` : ''}<div class="two"><input class="inp" type="date" data-setdue="${i.id}"><input class="inp" type="time" data-settime="${i.id}"></div><div class="chips" style="margin-top:6px"><button class="opt plain" data-a="qd" data-id="${i.id}" data-v="delete">Delete</button></div></div>`).join('') || '<div class="empty">All set.</div>' }; }
    ]
  }
};
function shStep(s) {
  const def = STEPS[s.kind], k = s.i, n = def.steps.length;
  const st = def.steps[k]();
  return head(def.title) + `<div class="step-bar">${def.steps.map((_, j) => `<i class="${j <= k ? 'on' : ''}"></i>`).join('')}</div><h3 style="margin:4px 0 8px;font-size:19px">${k + 1}. ${st.h}</h3><div class="step-sub">${st.sub}</div><div>${st.body}</div><div class="acts" style="position:sticky;bottom:0;background:var(--paper);padding-bottom:8px">${k > 0 ? '<button class="btn ghost" data-a="stepPrev">Back</button>' : ''}<button class="btn solid" data-a="${k + 1 < n ? 'stepNext' : 'stepFinish'}" style="margin-left:auto">${k + 1 < n ? 'Next' : 'Finish'}</button></div>`;
}

/* ---------- actions ---------- */
function edItem() { return ui.sheet && findItem(ui.sheet.id); }
function afterChange() { save(); if (ui.sheet) renderSheet(); render(); }
const A = {
  go: el => { if (el.dataset.x === 'inbox') ui.notesArea = 'inbox'; go(el.dataset.v); },
  add: () => addFromCapture(),
  mic: () => toggleMic(),
  settings: () => openSheet({ type: 'settings' }),
  closeSheet: () => closeSheet(),
  toast: el => { const a = ui.toastActs[+el.dataset.v]; $('#toast').classList.remove('on'); if (a) a.fn(); },
  tpl: el => {
    const t = TPLS[+el.dataset.v], q = $('#q');
    if (t.delegate) { ui.pendingDelegate = true; q.focus(); toast('Type the task, then tap +. WhatsApp opens next'); return; }
    if (t.note != null) {
      const cur = q.value.trim();
      const i = blankItem({ title: cur ? parse(cur).title : (t.title === 'Idea' ? '' : t.title), note: t.note, list: t.list || null, area: t.area || (cur ? autoArea(cur) : null) });
      db.items.push(i); save(); q.value = ''; renderPreview(); openSheet({ type: 'edit', id: i.id });
      setTimeout(() => { const f = document.querySelector('[data-f=title]'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 280);
      return;
    }
    const v = q.value.trim();
    if (t.tail) { q.value = (v || '…') + t.ins; } else q.value = t.ins + v;
    q.focus(); autosize(); renderPreview();
    if (t.tail && !v) { q.setSelectionRange(0, 1); } else if (t.tail) { q.setSelectionRange(q.value.length, q.value.length); } else q.setSelectionRange(t.ins.length + v.length, t.ins.length + v.length);
  },
  pvArea: () => {
    const p = parse($('#q').value); const cur = pvArea !== undefined ? pvArea : p.area;
    const order = [...AREAS.map(a => a.k), null]; pvArea = order[(order.indexOf(cur) + 1) % order.length]; renderPreview();
  },
  done: (el, e) => {
    const id = el.dataset.id, i = findItem(id); if (!i) return;
    if (i.expiry) { openSheet({ type: 'renew', id }); return; }
    const row = document.getElementById('r-' + id);
    const inSheet = ui.sheet && ui.sheet.type !== 'edit';
    if (ui.sheet && ui.sheet.type === 'edit') closeSheetQuiet();
    if (row && !inSheet) {
      row.classList.add('done', 'stamped');
      setTimeout(() => { row.classList.add('gone'); }, 520);
      setTimeout(() => { complete(id); render(); }, 760);
    } else { complete(id); if (ui.sheet) renderSheet(); render(); }
  },
  reopen: el => { const i = findItem(el.dataset.id); if (!i) return; i.status = 'open'; i.doneAt = null; afterChange(); toast('Reopened'); },
  open: el => openSheet({ type: 'edit', id: el.dataset.id }),
  snooze: el => { const i = findItem(el.dataset.id); if (!i) return; openSheet({ type: i.snoozes >= 3 && !i.expiry && i.list !== 'someday' ? 'decide' : 'snooze', id: i.id }); },
  snz: el => {
    const i = findItem(el.dataset.id), o = snoozeOpts(i)[+el.dataset.v];
    const wasHard = i.hard && i.calAt;
    if (i.list === 'someday') i.list = null;
    i.due = o.d; if (o.slot) { const rs = resolveSlot(o.slot, o.d); if (rs) { i.slot = rs.slot; i.time = rs.time; } } else if (!i.hard) { i.slot = null; i.time = null; } i.snoozes = (i.snoozes || 0) + 1; i.calAt = null;
    save(); closeSheet();
    toast(`Pushed to ${relL(i.due)}${i.time ? ' ' + i.time : ''}`, i.hard ? [{ label: wasHard ? 'Update calendar' : '→ Calendar', cls: 'redsolid', fn: () => sendCal(i.id) }] : []);
  },
  dismiss: el => { db.meta.dismiss = db.meta.dismiss || {}; db.meta.dismiss[el.dataset.v] = today(); save(); render(); },
  exnext: el => { const i = findItem(el.dataset.id); i.expiry.ack = (i.expiry.ack || 0) + 1; syncExpiry(i); i.calAt = null; save(); closeSheet(); toast('Next warning ' + relL(i.due)); },
  snzSomeday: el => { const i = findItem(el.dataset.id); setWhen(i, 'someday'); i.snoozes = 0; save(); closeSheet(); toast('Parked in Someday'); },
  'dc-now': el => { const i = findItem(el.dataset.id); i.due = today(); i.focus = today(); i.snoozes = 0; save(); closeSheet(); go('today'); toast('Pinned to the top of today'); },
  'dc-firm': el => { const i = findItem(el.dataset.id); i.hard = true; i.snoozes = 0; openSheet({ type: 'edit', id: i.id }); },
  'dc-snooze': el => openSheet({ type: 'snooze', id: el.dataset.id }),
  delegate: el => {
    const it = findItem(el.dataset.id), cs = S().contacts;
    const pick = it && it.area === 'dogs' ? cs.find(c => /dog/i.test(c.name)) : it && it.area === 'george' ? cs.find(c => /george|nanny/i.test(c.name)) : null;
    ui.delegateTo = (pick || cs[0] || {}).id || null; ui.fu = S().followUpDays; openSheet({ type: 'delegate', id: el.dataset.id }); },
  'dg-to': el => { ui.delegateTo = el.dataset.v || null; renderSheet(); },
  'dg-fu': el => { ui.fu = +el.dataset.v; const m = document.querySelector('[data-dgmsg]'); if (m) ui.sheet.msg = m.value; renderSheet(); },
  'dg-send': el => {
    const i = findItem(el.dataset.id), c = S().contacts.find(x => x.id === ui.delegateTo);
    const msg = (document.querySelector('[data-dgmsg]') || {}).value || delegateMsg(i, c);
    openURL(waURL(c && c.phone, msg));
    const T = today();
    i.list = 'waiting'; i.person = c ? c.name : (i.person || 'someone'); i.sentAt = T; i.due = addDays(T, ui.fu || S().followUpDays); i.time = null; i.slot = null; i.hard = false; i.snoozes = 0; i.focus = null;
    if (i.recur && i.recur.kind !== 'fixed') i.recur = i.recur; // keep
    save(); closeSheet(); toast(`Waiting on ${i.person} · chase ${relL(i.due)}`);
  },
  chase: el => {
    const i = findItem(el.dataset.id); const c = S().contacts.find(x => x.name === i.person);
    openURL(waURL(c && c.phone, `${greet(i.person)}, just checking in on this: ${lowerFirst(i.title)}. Thanks!`));
    i.due = addDays(today(), S().followUpDays); i.chased = (i.chased || 0) + 1; save(); render(); if (ui.sheet) renderSheet();
    toast('Chased · next check ' + relL(i.due));
  },
  cal: el => sendCal(el.dataset.id),
  renewSave: el => {
    const i = findItem(el.dataset.id), d = ($('#renewDate') || {}).value; if (!d) { toast('Pick the new expiry date'); return; }
    ui.undo = { snap: JSON.stringify(i), logLen: db.log.length };
    db.log.push({ id: i.id, title: i.title + ' — renewed', area: i.area, at: today(), list: null });
    i.lastDone = today(); i.expiry.date = d; i.calAt = null; i.snoozes = 0; syncExpiry(i, true); save(); closeSheet();
    toast(`Logged · next warning ${relL(i.due)}`, [{ label: 'Undo', fn: doUndo }]);
  },
  renewNone: el => { const i = findItem(el.dataset.id); db.log.push({ id: i.id, title: i.title + ' — closed', area: i.area, at: today() }); i.status = 'done'; i.doneAt = today(); save(); closeSheet(); },
  'ed-area': el => { const i = edItem(); i.area = el.dataset.v || null; if (i.area) learnArea(i.title, i.area); afterChange(); },
  'ed-when': el => { const i = edItem(); if (el.dataset.v === 'clear') { i.due = null; i.time = null; i.slot = null; i.calAt = null; } else setWhen(i, el.dataset.v); afterChange(); },
  'ed-slot': el => { const i = edItem(); if (i.slot === el.dataset.v) { i.slot = null; i.time = null; } else { i.slot = el.dataset.v; reslot(i); } i.calAt = null; afterChange(); },
  'ed-hard': el => { const i = edItem(); i.hard = el.dataset.v === '1'; if (i.hard && !i.due) { i.due = today(); } afterChange(); },
  'ed-effort': el => { const i = edItem(); i.effort = el.dataset.v || null; afterChange(); },
  'ed-list': el => {
    const i = edItem(), v = el.dataset.v || null; i.list = v;
    if (v === 'someday') setWhen(i, 'someday');
    if (v === 'waiting') { i.sentAt = i.sentAt || today(); if (!i.due) i.due = addDays(today(), S().followUpDays); }
    afterChange();
  },
  'ed-dow': el => { const i = edItem(), d = +el.dataset.v; const s = new Set(i.recur.dows || []); s.has(d) ? s.delete(d) : s.add(d); i.recur.dows = [...s].sort(); if (!i.recur.dows.length) delete i.recur.dows; afterChange(); },
  'ed-someday': el => { const i = findItem(el.dataset.id); setWhen(i, 'someday'); afterChange(); toast('Parked in Someday'); },
  'ed-drop': el => { dropItem(el.dataset.id, 'drop'); closeSheet(); },
  'ed-delete': el => { dropItem(el.dataset.id, 'delete'); closeSheet(); },
  qd: el => {
    const i = findItem(el.dataset.id), v = el.dataset.v; if (!i) return;
    if (v.startsWith('area:')) { i.area = v.slice(5); learnArea(i.title, i.area); }
    else if (v === 'done') { complete(i.id); }
    else if (v === 'drop') { dropItem(i.id, 'drop'); }
    else if (v === 'delete') { db.items = db.items.filter(x => x.id !== i.id); }
    else { setWhen(i, v); i.snoozes = 0; }
    if (v !== 'done' && v !== 'drop' && isInbox(i) === false && !i.area && !v.startsWith('area:')) { }
    save(); renderSheet(); render();
  },
  lastDone: el => {
    const i = findItem(el.dataset.id), v = el.dataset.v, T = today();
    if (v === 'x') i.due = T; else { const ld = addDays(T, -+v); i.lastDone = ld; i.due = addUnit(ld, i.recur.n, i.recur.unit); if (i.due < T) i.due = T; }
    i.needsSetup = false; save(); renderSheet(); render();
  },
  step: el => { ui.step = null; openSheet({ type: 'step', kind: el.dataset.v, i: 0 }); },
  stepNext: () => { ui.sheet.i++; renderSheet(); $('#sheet').scrollTop = 0; },
  stepPrev: () => { ui.sheet.i--; renderSheet(); $('#sheet').scrollTop = 0; },
  stepFinish: () => {
    const k = ui.sheet.kind; STEPS[k].done();
    if (k === 'setup') db.items.filter(i => i.needsSetup && !i.expiry).forEach(i => { i.needsSetup = false; if (!i.due) i.due = (i.recur && i.recur.kind === 'float') ? today() : addDays(today(), 1); });
    save(); closeSheet();
    toast({ triage: 'Triage done. See you tomorrow', weekly: 'Review done. The week is set', setup: 'Starter pack set up' }[k]);
  },
  stepAdd: () => { const inp = $('#stepAdd'); if (!inp || !inp.value.trim()) return; const p = parse(inp.value); if (!p.due) p.due = addDays(today(), 1); db.items.push(itemFromParse(p)); save(); renderSheet(); render(); },
  batch: el => openSheet({ type: 'batch', k: el.dataset.v }),
  effort: el => { ui.effort = el.dataset.v; render(); },
  toggleTmr: () => { ui.showTomorrow = !ui.showTomorrow; render(); },
  showLater: () => { ui.showLater = true; render(); },
  upSeg: el => { ui.upSeg = el.dataset.v; render(); },
  listSeg: el => { ui.listSeg = el.dataset.v; render(); },
  notesMode: el => { ui.notesMode = el.dataset.v; render(); },
  notesArea: el => { ui.notesArea = el.dataset.v; $('#notesBody').innerHTML = notesBody(); },
  notesSrc: el => { ui.notesSrc = el.dataset.v; $('#notesBody').innerHTML = notesBody(); },
  listAdd: () => { const inp = $('#listAdd'); if (!inp || !inp.value.trim()) return; const L = inp.dataset.list; const p = parse(inp.value, { list: L }); p.list = L; if (L === 'someday') { p.due = null; p.time = null; p.hard = false; } const i = itemFromParse(p); db.items.push(i); save(); ui.flash = i.id; render(); const n = $('#listAdd'); if (n) n.focus(); },
  shareBuy: () => {
    const its = db.items.filter(i => isOpen(i) && i.list === 'buy'); const m = {};
    its.forEach(i => (m[i.shop || 'Anywhere'] = m[i.shop || 'Anywhere'] || []).push(i.title.replace(/^(buy|order|get)\s+/i, '')));
    openURL(waURL('', 'Shopping list\n' + Object.keys(m).map(k => `\n*${k}*\n` + m[k].map(t => '• ' + cap(t)).join('\n')).join('\n')));
  },
  newExpiry: () => { const i = blankItem({ expiry: { date: null, leads: S().leads.slice(), ack: 0, renewYears: 1 }, area: 'admin', hard: true }); db.items.push(i); save(); openSheet({ type: 'edit', id: i.id }); },
  newNote: () => { const i = blankItem({ area: ['all', 'inbox'].includes(ui.notesArea) ? null : ui.notesArea }); db.items.push(i); save(); openSheet({ type: 'edit', id: i.id }); },
  'rs-keep': el => { const r = db.meta.resurface; r.ids = r.ids.filter(x => x !== el.dataset.id); save(); render(); },
  'rs-kill': el => { dropItem(el.dataset.id, 'drop'); const r = db.meta.resurface; r.ids = r.ids.filter(x => x !== el.dataset.id); save(); render(); },
  ritualCal: el => {
    const st = S();
    if (el.dataset.v === 'triage') openEvent({ title: 'Margin · evening triage (2 min)', date: today(), time: st.triageTime, mins: 5, details: 'Open Margin → Review → Evening triage.', rrule: 'RRULE:FREQ=DAILY' });
    else { const d = nextDow(today(), +st.reviewDay, true); openEvent({ title: 'Margin · weekly review (10 min)', date: d, time: st.reviewTime, mins: 15, details: 'Open Margin → Review → Weekly review.', rrule: 'RRULE:FREQ=WEEKLY' }); }
  },
  backup: () => doBackup(false),
  import: () => $('#importFile').click(),
  importGo: () => { const j = migrate(ui.pendingImport); db = j; save(); ui.pendingImport = null; closeSheet(); applyTheme(); toast('Backup restored'); },
  wipe: () => { if (!ui.wipeArm) { ui.wipeArm = true; renderSheet(); setTimeout(() => { ui.wipeArm = false; }, 4000); return; } localStorage.removeItem(KEY); location.reload(); },
  addContact: () => { S().contacts.push({ id: uid(), name: '', phone: '' }); afterChange(); },
  delContact: el => { S().contacts.splice(+el.dataset.v, 1); afterChange(); },
  'set-we': el => { const d = +el.dataset.v, s = new Set(S().weekend); s.has(d) ? s.delete(d) : s.add(d); S().weekend = [...s]; afterChange(); },
  'set-bool': el => { const k = el.dataset.v; S()[k] = !S()[k]; afterChange(); },
  'set-src': el => { const k = el.dataset.v; S().sources[k] = !S().sources[k]; afterChange(); },
  'set-theme': el => { S().theme = el.dataset.v; applyTheme(); afterChange(); },
  clearLearned: () => { S().learned = {}; afterChange(); toast('Learned words cleared'); },
  openUrl: el => openURL(el.dataset.v),
  'ed-unsrc': el => { const i = findItem(el.dataset.id); if (i) { i.src = null; afterChange(); } },

  /* ---- sources ---- */
  srcSeg: el => { ui.srcSeg = el.dataset.v; go('sources'); },
  srcScan: () => {
    const t = (($('#srcText') || {}).value || '');
    if (!t.trim()) { toast('Paste something in the box first'); const b = $('#srcText'); if (b) b.focus(); return; }
    scanText(t, {});
  },
  srcClip: () => {
    if (!navigator.clipboard || !navigator.clipboard.readText) { const b = $('#srcText'); if (b) b.focus(); toast('Long-press the box and choose Paste'); return; }
    navigator.clipboard.readText()
      .then(t => { if (!t || !t.trim()) { toast('The clipboard is empty'); return; } scanText(t, {}); })
      .catch(() => { const b = $('#srcText'); if (b) b.focus(); toast('Your browser wants you to paste it yourself — long-press the box'); });
  },
  srcPick: () => $('#srcFile').click(),
  srcDemo: () => {
    ui.view = 'sources'; ui.srcSeg = 'in'; render();
    const b = $('#srcText'); if (b) { b.value = DEMO_EMAIL; b.focus(); b.setSelectionRange(0, 0); }
    toast('An example email. Tap “Read it” to see what Margin makes of it');
  },
  srcLink: () => {
    const u = (($('#linkUrl') || {}).value || '').trim(), why = (($('#linkWhy') || {}).value || '').trim();
    if (!u && !why) { toast('Add a link or a line about it'); return; }
    const res = linkCandidates({ url: u, title: why }, { kind: 'link' });
    const n = addCandidates(res.cands);
    ui.srcSeg = 'in'; render();
    toast(n.added ? 'Added to intake' : 'You already have that one');
  },
  copyShare: el => {
    const link = el.dataset.v + '?text=';
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => toast('Link copied'), () => toast(link));
    else toast(link);
  },
  gmailSync: () => gmailSync(),
  gmailHelp: () => { ui.gmailHelp = !ui.gmailHelp; render(); },
  forgetSeen: () => { db.meta.seen = {}; save(); render(); toast('Forgotten — old messages can come in again'); },

  /* ---- suggestions waiting in the intake ---- */
  candAdd: el => {
    const i = acceptCand(el.dataset.id); afterCand();
    if (i) toast(`Added · ${i.expiry ? 'on the radar' : i.due ? relL(i.due) : (i.area ? AREA_LABEL[i.area] : 'Inbox')}`, [{ label: 'Open', fn: () => openSheet({ type: 'edit', id: i.id }) }]);
  },
  candEdit: el => { acceptCand(el.dataset.id, true); afterCand(); },
  candSkip: el => { skipCand(el.dataset.id); afterCand(); toast('Skipped — it won’t come back'); },
  candAll: () => { const n = db.intake.length; db.intake.slice().forEach(c => acceptCand(c.id)); afterCand(); toast(`${n} added`); },
  candClear: () => { const n = db.intake.length; db.intake.slice().forEach(c => skipCand(c.id)); afterCand(); toast(`${n} skipped`); },
  candOpen: el => { const c = db.intake.find(x => x.id === el.dataset.id); if (c && c.src.url) openURL(c.src.url); },
  candArea: el => {
    const c = db.intake.find(x => x.id === el.dataset.id); if (!c) return;
    const order = [...AREAS.map(a => a.k), null];
    c.p.area = order[(order.indexOf(c.p.area) + 1) % order.length];
    save(); afterCand();
  },
  candWhen: el => {
    const c = db.intake.find(x => x.id === el.dataset.id); if (!c) return;
    if (c.p.expiry) { toast('Expiry dates are set on the radar, after you add it'); return; }
    const T = today();
    const cycle = [c.p.due && c.p.due !== T ? c.p.due : null, T, addDays(T, 1), nextDow(T, 1, false), null].filter((v, k, a) => a.indexOf(v) === k);
    const next = cycle[(cycle.indexOf(c.p.due) + 1) % cycle.length];
    c.p.due = next; if (!next) { c.p.time = null; c.p.slot = null; c.p.hard = false; }
    save(); afterCand();
  }
};
function afterCand() { if (ui.sheet && ui.sheet.type === 'step') renderSheet(); render(); }
// Paste anything → suggestions. One door for every source.
function scanText(text, opt) {
  const st = S();
  const res = scan(text, Object.assign({ myEmail: st.myEmail, keepQuote: st.sources.keepQuote, max: st.sources.maxPerMessage }, opt || {}));
  if (!res.cands.length) { toast('Nothing in there looks like something to do'); return; }
  const n = addCandidates(res.cands);
  const box = $('#srcText'); if (box && n.added) box.value = '';
  ui.view = 'sources'; ui.srcSeg = 'in'; render();
  toast(n.added
    ? `${n.added} suggestion${n.added > 1 ? 's' : ''} from ${(SRC_LABEL[res.kind] || res.kind).toLowerCase()}${n.dup ? ` · ${n.dup} already seen` : ''}`
    : 'Seen that one before — nothing new');
}
function closeSheetQuiet() { ui.sheet = null; $('#sheet').classList.remove('on', 'full'); $('#scrim').classList.remove('on'); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  fn(el, e);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { autosize(); renderPreview(); return; }
  if (t.id === 'search') { ui.q = t.value; $('#notesBody').innerHTML = notesBody(); return; }
  if (t.dataset.dgmsg != null && ui.sheet) { ui.sheet.msg = t.value; return; }
  if (t.dataset.candtitle) { const c = db.intake.find(x => x.id === t.dataset.candtitle); if (c) { c.p.title = t.value; save(); } return; }
  if (t.dataset.set2) {                                   // settings that live inside another setting
    const path = t.dataset.set2.split('.'); let o = S();
    for (let k = 0; k < path.length - 1; k++) o = o[path[k]] || (o[path[k]] = {});
    o[path[path.length - 1]] = (t.type === 'number' || /^\d+$/.test(t.value)) ? +t.value : t.value;
    save(); return;
  }
  const f = t.dataset.f, i = edItem();
  if (f && i) {
    if (f === 'title') i.title = t.value;
    else if (f === 'note') i.note = t.value;
    else if (f === 'shop') i.shop = t.value || null;
    else if (f === 'person') i.person = t.value || null;
    save();
  }
  if (t.dataset.contact) { const [k, key] = t.dataset.contact.split('.'); S().contacts[+k][key] = t.value; save(); }
  if (t.dataset.anchorlbl) { const [g, k] = t.dataset.anchorlbl.split('.'); S().anchors[g][+k].label = t.value; save(); }
});
document.addEventListener('change', e => {
  const t = e.target, i = edItem(), f = t.dataset.f;
  if (f && i) {
    if (f === 'due') { i.due = t.value || null; if (!i.due) { i.time = null; i.slot = null; } else reslot(i); i.calAt = null; }
    else if (f === 'time') { i.time = t.value || null; i.slot = null; if (i.time) { i.hard = true; if (!i.due) i.due = today(); } i.calAt = null; }
    else if (f === 'rkind') {
      const v = t.value;
      if (v === 'none') i.recur = null;
      else if (v === 'season') { i.recur = { kind: 'season', key: 'summer' }; i.due = i.due || seasonNext('summer'); }
      else { i.recur = Object.assign({ n: 1, unit: 'w' }, i.recur && i.recur.kind !== 'season' ? i.recur : {}, { kind: v }); if (v === 'float') delete i.recur.dows; if (!i.due) i.due = today(); }
    }
    else if (f === 'rn') i.recur.n = Math.max(1, +t.value || 1);
    else if (f === 'runit') { i.recur.unit = t.value; if (t.value !== 'w') delete i.recur.dows; }
    else if (f === 'rseason') { i.recur.key = t.value; i.due = seasonNext(t.value); }
    else if (f === 'exdate') { i.expiry.date = t.value || null; i.calAt = null; syncExpiry(i, true); }
    else if (f === 'exleads') { i.expiry.leads = t.value.split(/[^\d]+/).map(Number).filter(n => n > 0); syncExpiry(i, true); }
    else if (f === 'exyears') i.expiry.renewYears = Math.max(1, +t.value || 1);
    else return;
    afterChange(); return;
  }
  if (t.dataset.exdate) { const it = findItem(t.dataset.exdate); if (it && t.value) { it.expiry.date = t.value; syncExpiry(it, true); save(); toast(`${it.title}: first warning ${relL(it.due)}`); if (ui.sheet) renderSheet(); render(); } return; }
  if (t.dataset.setdue) { const it = findItem(t.dataset.setdue); if (it && t.value) { it.due = t.value; it.needsSetup = false; save(); render(); } return; }
  if (t.dataset.settime) { const it = findItem(t.dataset.settime); if (it && t.value) { it.time = t.value; it.hard = true; if (!it.due) it.due = today(); it.needsSetup = false; save(); render(); } return; }
  if (t.dataset.snzdate) { const it = findItem(t.dataset.snzdate); if (it && t.value) { if (it.list === 'someday') it.list = null; it.due = t.value; reslot(it); it.snoozes = (it.snoozes || 0) + 1; it.calAt = null; save(); closeSheet(); toast('Moved to ' + relL(it.due)); } return; }
  if (t.dataset.anchor) { const [g, k] = t.dataset.anchor.split('.'); S().anchors[g][+k].t = t.value; save(); return; }
  if (t.dataset.set) {
    const k = t.dataset.set; let v = t.value;
    if (k === 'leads') v = v.split(/[^\d]+/).map(Number).filter(n => n > 0).sort((a, b) => b - a);
    else if (t.dataset.num) v = +v;
    S()[k] = v; save(); if (ui.sheet) renderSheet(); render(); return;
  }
  if (t.id === 'importFile' && t.files[0]) { importFile(t.files[0]); t.value = ''; return; }
  if (t.id === 'srcFile' && t.files[0]) { readSourceFile(t.files[0]); t.value = ''; return; }
  if (t.dataset.set2) { save(); if (ui.view === 'sources') render(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  if (e.target.id === 'q') { e.preventDefault(); addFromCapture(); }
  else if (e.target.id === 'listAdd') { e.preventDefault(); A.listAdd(); }
  else if (e.target.id === 'stepAdd') { e.preventDefault(); A.stepAdd(); }
  else if (e.target.dataset && e.target.dataset.f === 'title') { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });

/* ---------- seed ---------- */
function seed() {
  const d = { v: 1, items: [], log: [], intake: [], settings: defaultSettings(), meta: { created: new Date().toISOString() } };
  const L = d.settings.leads;
  const E = (title, area, o) => blankItem({ title, area, hard: true, needsSetup: true, note: (o && o.note) || '', expiry: { date: null, leads: (o && o.leads) || L.slice(), ack: 0, renewYears: (o && o.ry) || 1 } });
  const F = (title, area, n, unit, o) => blankItem({ title, area, needsSetup: true, recur: { kind: 'float', n, unit }, effort: (o && o.effort) || '15m', note: (o && o.note) || '' });
  const O = (title, area, o) => blankItem(Object.assign({ title, area, needsSetup: true }, o || {}));
  d.items = [
    E('Visa & Emirates ID — Calvin', 'admin', { ry: 2, note: 'Start at the 60-day warning. Renewal can need a medical and biometrics appointment.' }),
    E('Visa & Emirates ID — wife', 'admin', { ry: 2 }),
    E('Visa & Emirates ID — George', 'admin', { ry: 2 }),
    E('Passport — Calvin', 'admin', { ry: 10, note: 'Holding two passports? Add the second one as its own item.' }),
    E('Passport — wife', 'admin', { ry: 10 }),
    E('Passport — George', 'admin', { ry: 5, note: 'Children\u2019s passports usually have shorter validity.' }),
    E('UAE driving licence', 'car', { ry: 5 }),
    E('Car registration (Mulkiya)', 'car', { ry: 1, note: 'Check the insurance is valid first. Registration renewal needs it.' }),
    E('Car insurance', 'car', { ry: 1 }),
    E('Health insurance — family', 'admin', { ry: 1 }),
    E('Home insurance', 'home', { ry: 1 }),
    E('Tenancy contract / Ejari', 'admin', { ry: 1, note: 'Delete this if you own the villa.' }),
    E('Dog vaccinations — both dogs', 'dogs', { ry: 1, leads: [30, 7] }),
    E('Pet registration — check renewal', 'dogs', { ry: 1, leads: [30, 7] }),
    F('Flea & tick treatment — both dogs', 'dogs', 1, 'm', { effort: '2m', note: 'Using a 12-week product? Change the interval to 3 months.' }),
    F('Deworming — both dogs', 'dogs', 3, 'm', { effort: '2m' }),
    F('Grooming appointment — both dogs', 'dogs', 6, 'w', { effort: '2m', note: 'Book it. Delegate it to the dogs\u2019 nanny if she handles drop-off.' }),
    F('Senior wellness check — Poodle', 'dogs', 6, 'm', { note: 'Twice-yearly checks are common advice for older dogs. Confirm with your vet.' }),
    O('Book next vaccination — George', 'george', { effort: '15m', note: 'Once booked, set the appointment date and time here and send it to Calendar.' }),
    O('Book next check-up — George', 'george', { effort: '15m' }),
    O('George\u2019s first birthday — plan', 'george', { effort: 'deep', note: 'Around December. Capture gift ideas with "gift for George …".' }),
    blankItem({ title: 'Check FS1 registration windows for shortlisted schools', area: 'george', list: 'someday', effort: 'deep' })
  ];
  d.meta.lastResurface = ds(new Date());
  return d;
}

/* ---------- theme, manifest, boot ---------- */
function applyTheme() {
  const t = S().theme; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  let m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#1B1A17' : '#F3EEE3';
}
function iconPNG(size) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
    x.fillStyle = '#F3EEE3'; x.fillRect(0, 0, size, size);
    x.strokeStyle = 'rgba(94,128,158,.35)'; x.lineWidth = size / 128;
    for (let y = size * .18; y < size; y += size * .13) { x.beginPath(); x.moveTo(0, y); x.lineTo(size, y); x.stroke(); }
    x.fillStyle = '#C23F2C'; x.fillRect(size * .26, 0, size * .025, size);
    x.fillStyle = '#1D1A15'; x.font = `italic 600 ${size * .62}px Georgia, "Noto Serif", serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('M', size * .6, size * .56);
    return c.toDataURL('image/png');
  } catch (e) { return ''; }
}
function setupManifest() {
  const base = location.href.split('#')[0];
  const i192 = iconPNG(192), i512 = iconPNG(512);
  const m = {
    name: 'Margin', short_name: 'Margin', start_url: base, scope: base.replace(/[^/]*$/, ''), display: 'standalone', background_color: '#F3EEE3', theme_color: '#F3EEE3',
    icons: [{ src: i192, sizes: '192x192', type: 'image/png' }, { src: i512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    shortcuts: [{ name: 'Voice capture', url: base + '#voice' }, { name: 'Paste a source', url: base + '#sources' }, { name: 'Buy list', url: base + '#lists' }, { name: 'Expiry radar', url: base + '#radar' }],
    // Lets other apps share text, a page or a link straight into Margin's intake.
    share_target: { action: base, method: 'GET', params: { title: 'title', text: 'text', url: 'url' } }
  };
  const add = (rel, href, extra) => { const l = document.createElement('link'); l.rel = rel; l.href = href; Object.assign(l, extra || {}); document.head.appendChild(l); };
  add('manifest', 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(m)));
  if (i192) { add('icon', i192); add('apple-touch-icon', i192); }
}
function maybeResurface() {
  const T = today(), some = db.items.filter(i => isOpen(i) && i.list === 'someday');
  if (!some.length) return;
  const last = db.meta.lastResurface;
  if (last && diff(last, T) < (+S().resurfaceEvery || 21)) return;
  const pool = some.filter(i => !i.surfacedAt || diff(i.surfacedAt, T) > 45);
  const pick = (pool.length ? pool : some).sort(() => Math.random() - .5).slice(0, 2);
  pick.forEach(i => i.surfacedAt = T);
  db.meta.resurface = { date: T, ids: pick.map(i => i.id) };
  db.meta.lastResurface = T; save();
}
// Something shared in from another app (the share sheet, or a ?text= link).
function handleIncoming() {
  let p; try { p = new URLSearchParams(location.search); } catch (e) { return false; }
  const title = p.get('title'), text = p.get('text'), url = p.get('url');
  if (!title && !text && !url) return false;
  const st = S();
  const opts = { kind: 'share', url: url || null, myEmail: st.myEmail, keepQuote: st.sources.keepQuote, max: st.sources.maxPerMessage };
  const res = (text && detectKind(text) !== 'list')
    ? scan(text, opts)
    : linkCandidates({ title, text, url }, opts);
  const n = addCandidates(res.cands);
  ui.view = 'sources'; ui.srcSeg = 'in';
  try { history.replaceState({}, '', location.pathname + location.hash); } catch (e) { }
  setTimeout(() => toast(n.added ? `${n.added} suggestion${n.added > 1 ? 's' : ''} shared in` : 'You already have that one'), 500);
  return true;
}
function armDropZone() {
  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  document.addEventListener('dragover', e => { stop(e); document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', e => {
    stop(e); document.body.classList.remove('dragging');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { readSourceFile(f); return; }
    const t = e.dataTransfer && e.dataTransfer.getData('text');
    if (t && t.trim()) scanText(t, {});
  });
}
function handleHash() {
  const h = location.hash.replace('#', '');
  if (h === 'voice') { ui.view = 'today'; setTimeout(() => { toggleMic(); }, 300); }
  else if (h === 'sources' || h === 'intake') { ui.view = 'sources'; ui.srcSeg = 'in'; }
  else if (h === 'lists') { ui.view = 'lists'; ui.listSeg = 'buy'; }
  else if (h === 'radar') { ui.view = 'upcoming'; ui.upSeg = 'radar'; }
  else if (h === 'review') ui.view = 'review';
}
function boot() {
  db = load() || seed();
  save();
  applyTheme();
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  setupManifest();
  renderTpls();
  if (!SR) $('#mic').classList.add('hide');
  $('#q').placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
  maybeResurface();
  handleHash();
  const shared = handleIncoming();
  render();
  armAutoBackup();
  armDropZone();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
  if (S().focusOnOpen && ui.view === 'today' && !location.hash && !shared) setTimeout(() => $('#q').focus(), 150);
  // refresh when returning to the app (date may have rolled over)
  let lastDay = today();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (today() !== lastDay) { lastDay = today(); maybeResurface(); armAutoBackup(); } if (!ui.sheet) render(); } });
  setInterval(() => { const ae = document.activeElement; if (!ui.sheet && !document.hidden && !(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) render(); }, 60000);
}
boot();
