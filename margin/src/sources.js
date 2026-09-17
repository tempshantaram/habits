/* ===================== MARGIN · sources =====================
   Margin's job is to sit between the places life arrives from — email, calendar
   invites, shared links, files, pasted lists — and your own lists.

   Everything in the first half of this file is plain text in, "candidates" out.
   A candidate is a SUGGESTION: a title, the bits Margin worked out (area, date,
   list), plus `why` it thinks so. Nothing reaches your lists until you tap Add.

   The second half (Gmail, clipboard, files) is the plumbing that fetches text
   and hands it to the first half.
==============================================================*/

// In Node (the tests) we borrow the shared helpers from core.js. In the browser
// everything is already one script, so this block is skipped.
if (typeof module !== 'undefined' && typeof window === 'undefined') {
  // parse, today, autoArea, uid, cap, ds … all come from core.js.
  Object.assign(globalThis, require('./core.js'));
}

/* ---------- the sources we know about ---------- */
const SOURCES = [
  { k: 'email', label: 'Email', mark: '✉', blurb: 'Forward or paste an email. Margin reads the subject, the dates, the amounts and the asks.' },
  { k: 'gmail', label: 'Gmail', mark: '✉', blurb: 'Read straight from your inbox, read-only. One-time setup, then one tap.' },
  { k: 'calendar', label: 'Calendar', mark: '▣', blurb: 'An .ics invite or export becomes dated items, times and all.' },
  { k: 'file', label: 'Files & lists', mark: '▤', blurb: '.txt, .md, .csv or anything pasted as a list — one line per item.' },
  { k: 'link', label: 'Links', mark: '↗', blurb: 'A link plus a line about why it matters.' },
  { k: 'share', label: 'Share sheet', mark: '⇥', blurb: 'Share to Margin from another app on your phone.' },
  { k: 'voice', label: 'Voice', mark: '◉', blurb: 'Dictated on the Today screen.' },
  { k: 'manual', label: 'Typed', mark: '', blurb: 'The capture box at the top of Today.' }
];
const SRC_LABEL = Object.fromEntries(SOURCES.map(s => [s.k, s.label]));
const SRC_MARK = Object.fromEntries(SOURCES.map(s => [s.k, s.mark]));

/* ---------- small helpers ---------- */
function hash32(s) { let h = 5381; s = String(s == null ? '' : s); for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0; return h.toString(36); }
// A stable id for "this message" so the same email never lands twice.
function fingerprint(src, title) {
  return (src.kind || 'x') + ':' + (src.ref || hash32([src.from, src.subject, src.at, title].join('|')));
}
function cleanSubject(s) {
  return String(s == null ? '' : s)
    .replace(/^\s*(?:re|fw|fwd|aw|tr)\s*(?:\[\d+\])?\s*:\s*/i, '')
    .replace(/^\s*(?:re|fw|fwd)\s*:\s*/i, '')
    .replace(/\s*[-–—|]\s*(?:gmail|outlook|inbox)\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
}
function nameOf(addr) {
  const s = String(addr == null ? '' : addr).trim();
  if (!s) return '';
  const q = s.match(/^\s*"?([^"<@]+?)"?\s*<[^>]+>/);           // "Ahmed Khan" <a@b.com>
  if (q && q[1].trim()) return q[1].trim().replace(/\s+/g, ' ').slice(0, 40);
  const e = s.match(/([\w.+-]+)@/);                              // a.khan@b.com → A Khan
  if (e) return e[1].replace(/[._+-]+/g, ' ').split(' ').filter(Boolean).map(cap).join(' ').slice(0, 40);
  return s.replace(/[<>]/g, '').slice(0, 40);
}
const emailOf = a => (String(a == null ? '' : a).match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0].toLowerCase();

const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "Mon, 14 Sep 2026 at 09:12 +0400" and friends → 2026-09-14
function hdrDate(s) {
  if (!s) return null;
  const t = String(s).replace(/\bat\b/i, ' ').replace(/\s+/g, ' ').trim();
  let m = t.match(/(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})/i);
  if (m && MON3.indexOf(m[2].slice(0, 3).toLowerCase()) >= 0) return `${m[3]}-${String(MON3.indexOf(m[2].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  m = t.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && MON3.indexOf(m[1].slice(0, 3).toLowerCase()) >= 0) return `${m[3]}-${String(MON3.indexOf(m[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const p = Date.parse(t);
  return isNaN(p) ? null : ds(new Date(p));
}

/* ---------- pulling an email apart ---------- */
const HDR_RE = /^\s*(from|to|cc|bcc|subject|date|sent|reply-to|message-id|when|where|location)\s*:\s*(.*)$/i;
function parseHeaders(text) {
  const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  let start = -1;
  for (let k = 0; k < Math.min(lines.length, 120); k++) { if (/^\s*(from|subject)\s*:\s*\S/i.test(lines[k])) { start = k; break; } }
  const h = {};
  if (start < 0) return { h, body: lines.join('\n'), hasHeaders: false };
  let end = start;
  for (let k = start; k < Math.min(lines.length, start + 30); k++) {
    const line = lines[k];
    if (!line.trim()) { if (Object.keys(h).length) break; continue; }
    const m = line.match(HDR_RE);
    if (m) { const key = m[1].toLowerCase(); if (!h[key]) h[key] = m[2].trim(); end = k; }
    else if (Object.keys(h).length >= 2) break;
    else if (/^-{3,}|^_{3,}/.test(line.trim())) continue;        // "---------- Forwarded message ----------"
    else if (Object.keys(h).length) break;
  }
  return { h, body: lines.slice(end + 1).join('\n'), hasHeaders: Object.keys(h).length >= 2 };
}
// Drop the reply chain, the signature and the legal boilerplate.
function stripQuoted(body) {
  let t = String(body == null ? '' : body).replace(/\r/g, '');
  const cuts = [
    /^\s*On .{5,120}\bwrote:\s*$/im,
    /^\s*-{2,}\s*(?:original message|forwarded message)/im,
    /^\s*_{5,}\s*$/m,
    /^\s*--\s*$/m,
    /^\s*(?:sent from my (?:iphone|ipad|android|samsung))/im,
    /^\s*(?:this (?:e-?mail|message) (?:and any attachments )?is confidential)/im,
    /^\s*unsubscribe\b/im
  ];
  for (const c of cuts) { const m = t.match(c); if (m && m.index > 40) t = t.slice(0, m.index); }
  t = t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- things worth noticing in a body of text ---------- */
const MONEY_RE = /(?:AED|USD|EUR|GBP|SAR|QAR|OMR|KWD|INR|AUD|\$|€|£)\s?\d[\d,]*(?:\.\d{2})?/gi;
const REF_RE = /\b(?:ref(?:erence)?|booking|order|invoice|policy|application|case|tracking|confirmation|permit)(?:\s+(?:ref(?:erence)?|number|no\.?|id|code))?\s*[#:]?\s*([A-Z0-9][A-Z0-9\/-]{3,})/gi;
const URL_RE = /https?:\/\/[^\s<>()"'\]]+/g;
const EXPIRY_RE = /\b(expir\w+|valid\s+(?:until|till|to|through)|renew(?:al|s|ing)?\b|due\s+for\s+renewal|before\s+it\s+lapses)\b/i;
const BOOKING_RE = /\b(booking|appointment|reservation|itinerary|confirmed for|scheduled for|check-?in|flight|your visit|consultation)\b/i;
const PAY_RE = /\b(invoice|receipt|payment|amount due|balance|outstanding|pay(?:able|ment)? by|statement|bill)\b/i;
const ASK_RE = /\b(please|kindly|could you|can you|would you|action required|reply by|respond by|rsvp|confirm|complete the|fill (?:in|out)|sign|submit|send (?:us|me|through)|we (?:need|require)|you (?:need to|must|should)|let me know|share the|bring|attach)\b/i;
const NOISE_RE = /\b(unsubscribe|privacy policy|terms and conditions|view (?:this|in browser)|do not reply|no-?reply|copyright|all rights reserved|follow us)\b/i;

const uniq = a => [...new Set(a)];
const findMoney = t => uniq((String(t).match(MONEY_RE) || []).map(x => x.replace(/\s+/g, ' ').trim())).slice(0, 3);
const findUrls = t => uniq(String(t).match(URL_RE) || []).slice(0, 4);
function findRefs(t) {
  const out = []; let m; REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(String(t))) && out.length < 3) if (/\d/.test(m[1])) out.push(m[1]);
  return uniq(out);
}
// Split into sentence-ish chunks we can run the normal capture parser over.
function segments(text) {
  return String(text == null ? '' : text).split(/\n+/).flatMap(l => l.split(/(?<=[.!?;])\s+/))
    .map(s => s.replace(/^[\s*•\-–—>\d.)\]]+/, '').replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 4 && s.length <= 220);
}
// Every date the text mentions, in the order they appear.
function findDates(segs) {
  const out = [];
  for (const s of segs) {
    if (NOISE_RE.test(s)) continue;
    let p; try { p = parse(s); } catch (e) { continue; }
    if (p.due || (p.expiry && p.expiry.date)) out.push({ due: p.due || p.expiry.date, time: p.time, hard: p.hard, text: s });
  }
  return out;
}
// Lines that read like someone asking you for something.
function askLines(text) {
  return segments(text)
    .filter(s => ASK_RE.test(s) && !NOISE_RE.test(s) && !URL_RE.test(s) && s.length >= 12 && s.length <= 160)
    .slice(0, 4);
}

/* ---------- candidates ---------- */
// One suggestion. `p` is shaped exactly like the capture parser's output, so the
// rest of the app can turn it into an item without knowing where it came from.
function mkCand(text, why, src, over) {
  let p;
  try { p = parse(String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 160)); }
  catch (e) { p = { title: String(text || '').slice(0, 120) }; }
  if (!p.title) p.title = cleanSubject(src.subject || '') || ('From ' + (src.name || 'a message'));
  if (p.title.length > 120) p.title = p.title.slice(0, 117).trim() + '…';
  Object.assign(p, over || {});
  if (!p.area) p.area = autoArea([p.title, src.subject, src.quote].filter(Boolean).join(' '));
  return { id: uid(), why, keep: true, p, src: Object.assign({}, src) };
}
// The note that travels with the item: where it came from, and the useful bits.
function provenanceNote(src, extra) {
  const L = [];
  if (src.from) L.push('From: ' + src.from);
  if (src.subject) L.push('Subject: ' + src.subject);
  if (src.at) L.push('Received: ' + src.at);
  if (extra && extra.money && extra.money.length) L.push('Amount: ' + extra.money.join(' · '));
  if (extra && extra.refs && extra.refs.length) L.push('Ref: ' + extra.refs.join(' · '));
  if (extra && extra.where) L.push('Where: ' + extra.where);
  if (src.url) L.push(src.url);
  const q = (src.quote || '').trim();
  return (L.join('\n') + (q ? '\n\n“' + q.slice(0, 400) + (q.length > 400 ? '…' : '') + '”' : '')).trim();
}
function trimCands(cands, max) {
  const seen = new Set(), out = [];
  for (const c of cands) {
    const k = (c.p.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(c);
    if (out.length >= (max || 5)) break;
  }
  return out;
}

/* ---------- source 1: an email ---------- */
function emailCandidates(text, opt) {
  opt = opt || {};
  const { h, body, hasHeaders } = parseHeaders(text);
  const clean = stripQuoted(body);
  const subject = cleanSubject(h.subject || (clean.split('\n').find(l => l.trim()) || '').slice(0, 90)) || 'Email';
  const from = (h.from || '').trim();
  const at = hdrDate(h.date || h.sent) || today();
  const src = {
    kind: opt.kind || 'email', from, name: nameOf(from) || null, subject, at,
    ref: opt.ref || (h['message-id'] || '').trim() || null,
    url: opt.url || findUrls(clean)[0] || null,
    quote: opt.keepQuote === false ? '' : clean.slice(0, 600)
  };
  const hay = subject + '\n' + clean;
  const money = findMoney(hay), refs = findRefs(hay);
  const where = h.where || h.location || null;
  const note = provenanceNote(src, { money, refs, where });
  const segs = segments(clean); segs.unshift(subject);
  const dates = findDates(segs);
  const T = today();
  const soon = dates.find(d => d.due >= T) || dates[0] || null;
  const timed = dates.find(d => d.time && d.due >= T);
  const mine = opt.myEmail && emailOf(from) && emailOf(from) === String(opt.myEmail).toLowerCase();
  const asks = askLines(clean);
  const out = [];

  if (EXPIRY_RE.test(hay) && soon) {
    out.push(mkCand('Renew ' + subject, 'Renewal wording plus a date (' + soon.due + ')', src,
      { expiry: { date: soon.due }, note, hard: true }));
  }
  if (timed && BOOKING_RE.test(hay)) {
    out.push(mkCand(subject, 'Reads like a booking: it has a date and a time', src,
      { due: timed.due, time: timed.time, hard: true, note }));
  }
  if (money.length && PAY_RE.test(hay)) {
    out.push(mkCand('Pay ' + subject, 'An amount (' + money[0] + ') and payment wording', src,
      { due: soon ? soon.due : null, note, list: null }));
  }
  if (mine) {
    out.push(mkCand(subject, 'Sent by you — park it until they come back', src,
      { list: 'waiting', person: nameOf(h.to || '') || null, note }));
  }
  // Anything that clearly IS a thing to do: a renewal, a booking, a bill, a reply to chase.
  const strong = out.length;
  asks.forEach(a => out.push(mkCand(a, 'Line in the message: “' + a.slice(0, 70) + (a.length > 70 ? '…' : '') + '”', src, { note })));

  // Otherwise (or as well, when all we found were asks) offer the thread itself.
  if (!strong) {
    const needsReply = /\?/.test(clean) || ASK_RE.test(hay);
    const title = needsReply && src.name && !out.length ? `Reply to ${src.name.split(' ')[0]} — ${subject}` : subject;
    out.push(mkCand(title, out.length ? 'The subject line, if you would rather keep the whole thread' : hasHeaders ? 'The subject line' : 'The first line of what you pasted', src,
      { due: soon ? soon.due : null, note }));
  }
  // A suggestion with no date of its own inherits the one date the message mentions.
  out.forEach(c => { if (!c.p.due && !c.p.expiry && c.p.list !== 'waiting' && soon) c.p.due = soon.due; });
  return { kind: src.kind, meta: { subject, from, at, money, refs, urls: findUrls(clean), asks: asks.length, dates: dates.length }, cands: trimCands(out, opt.max || 5) };
}

/* ---------- source 2: a calendar file (.ics) ---------- */
function unfoldIcs(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
function icsDate(v) {
  const m = String(v || '').match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return null;
  return { due: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null };
}
function icsRecur(rr) {
  const g = k => (String(rr).match(new RegExp(k + '=([^;]+)', 'i')) || [])[1];
  const f = (g('FREQ') || '').toUpperCase(), n = +(g('INTERVAL') || 1) || 1;
  const unit = { DAILY: 'd', WEEKLY: 'w', MONTHLY: 'm', YEARLY: 'y' }[f];
  if (!unit) return null;
  const rec = { kind: 'fixed', n, unit };
  const by = g('BYDAY');
  if (unit === 'w' && by) {
    const map = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const dows = by.split(',').map(x => map[x.replace(/[^A-Z]/g, '').slice(-2)]).filter(x => x != null);
    if (dows.length) rec.dows = [...new Set(dows)].sort();
  }
  return rec;
}
function icsCandidates(text, opt) {
  opt = opt || {};
  const lines = unfoldIcs(text), out = [];
  let ev = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { ev = {}; continue; }
    if (/^END:VEVENT/i.test(line)) { if (ev) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    const m = line.match(/^([A-Z-]+)[^:]*:(.*)$/i);
    if (!m) continue;
    ev[m[1].toUpperCase()] = m[2].replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
  }
  const T = today();
  const cands = out
    .map(e => {
      const d = icsDate(e.DTSTART); if (!d) return null;
      const title = (e.SUMMARY || 'Calendar event').slice(0, 120);
      const src = { kind: 'calendar', from: e.ORGANIZER ? nameOf(e.ORGANIZER.replace(/^mailto:/i, '')) : null, name: null, subject: title, at: T, ref: e.UID || null, url: findUrls(e.DESCRIPTION || '')[0] || null, quote: opt.keepQuote === false ? '' : (e.DESCRIPTION || '').slice(0, 400) };
      const note = provenanceNote(src, { where: e.LOCATION || null });
      return mkCand(title, d.time ? 'Calendar event on ' + d.due + ' at ' + d.time : 'All-day calendar event on ' + d.due, src,
        { due: d.due, time: d.time, hard: !!d.time, note, recur: e.RRULE ? icsRecur(e.RRULE) : null });
    })
    .filter(Boolean)
    .filter(c => !opt.pastToo ? c.p.due >= addDays(T, -1) : true)
    .sort((a, b) => a.p.due < b.p.due ? -1 : 1);
  return { kind: 'calendar', meta: { events: out.length, kept: cands.length }, cands: cands.slice(0, opt.max || 40) };
}

/* ---------- source 3: a list, a note, a file of lines ---------- */
function listCandidates(text, opt) {
  opt = opt || {};
  const base = { kind: opt.kind || 'file', from: opt.from || null, name: opt.name || null, subject: opt.subject || null, at: today(), ref: opt.ref || null, url: opt.url || null, quote: '' };
  const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n')
    .map(l => l.replace(/^[\s*•·\-–—]+/, '').replace(/^\[.\]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter(l => l && l.length >= 2 && !/^#{1,6}\s/.test(l) && !/^[-=_]{3,}$/.test(l));
  const cands = lines.slice(0, opt.max || 40).map((l, k) => {
    const src = Object.assign({}, base, { ref: base.ref ? base.ref + '#' + k : null, quote: opt.keepQuote === false ? '' : l.slice(0, 200) });
    return mkCand(l, opt.why || 'One line of what you pasted', src, { note: opt.note || '' });
  });
  return { kind: base.kind, meta: { lines: lines.length }, cands };
}

/* ---------- source 4: a spreadsheet export (.csv) ---------- */
function csvRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === '"' && s[k + 1] === '"') { cell += '"'; k++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
function csvCandidates(text, opt) {
  opt = opt || {};
  const rows = csvRows(text); if (!rows.length) return { kind: 'file', meta: {}, cands: [] };
  const head = rows[0].map(x => String(x).toLowerCase().trim());
  const findCol = re => head.findIndex(x => re.test(x));
  const ti = findCol(/^(task|title|item|what|todo|to do|name|description)$/), di = findCol(/^(due|date|when|deadline)$/);
  const ni = findCol(/^(note|notes|detail|details|comment)$/), ai = findCol(/^(area|category|list|project|tag)$/);
  const hasHeader = ti >= 0 || di >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  const base = { kind: 'file', from: null, name: null, subject: opt.subject || 'Spreadsheet', at: today(), ref: opt.ref || null, url: null, quote: '' };
  const cands = body.slice(0, opt.max || 60).map((r, k) => {
    const title = String(r[ti >= 0 ? ti : 0] || '').trim(); if (!title) return null;
    const when = di >= 0 ? String(r[di] || '').trim() : '';
    const note = ni >= 0 ? String(r[ni] || '').trim() : '';
    const src = Object.assign({}, base, { ref: base.ref ? base.ref + '#' + k : null, quote: opt.keepQuote === false ? '' : r.join(' · ').slice(0, 200) });
    const over = { note };
    if (when) { let d = hdrDate(when); if (!d) { try { d = parse(when).due; } catch (e) { d = null; } } if (d) over.due = d; }
    const c = mkCand(title, 'Row ' + (k + 1) + ' of the file', src, over);
    if (ai >= 0) { const a = String(r[ai] || '').toLowerCase().trim(); if (AREA_ALIAS[a]) c.p.area = AREA_ALIAS[a]; }
    return c;
  }).filter(Boolean);
  return { kind: 'file', meta: { rows: body.length, header: hasHeader }, cands };
}

/* ---------- source 5: a shared link ---------- */
function linkCandidates(o, opt) {
  opt = opt || {};
  const url = (o.url || '').trim();
  const words = [o.title, o.text].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim();
  const src = { kind: opt.kind || 'link', from: null, name: null, subject: o.title || null, at: today(), ref: url || null, url: url || null, quote: (o.text || '').slice(0, 400) };
  const title = words || (url ? 'Look at ' + url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : 'Shared item');
  return { kind: src.kind, meta: { url }, cands: [mkCand(title, url ? 'Shared link' : 'Shared text', src, { note: provenanceNote(src, {}) })] };
}

/* ---------- what did they just paste? ---------- */
function detectKind(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return 'empty';
  if (/^BEGIN:VCALENDAR/im.test(t)) return 'calendar';
  if (parseHeaders(t).hasHeaders) return 'email';
  if (/^https?:\/\/\S+$/i.test(t)) return 'link';
  const lines = t.split('\n').filter(l => l.trim());
  if (lines.length >= 2 && lines.filter(l => (l.match(/,/g) || []).length >= 2).length >= lines.length * 0.8) return 'csv';
  if (lines.length >= 2) return 'list';
  return 'list';
}
// The one entry point the app uses: text in, suggestions out.
function scan(text, opt) {
  opt = opt || {};
  const kind = opt.forceKind || detectKind(text);
  if (kind === 'empty') return { kind, meta: {}, cands: [] };
  if (kind === 'calendar') return icsCandidates(text, opt);
  if (kind === 'email') return emailCandidates(text, opt);
  if (kind === 'csv') return csvCandidates(text, opt);
  if (kind === 'link') return linkCandidates({ url: String(text).trim() }, opt);
  return listCandidates(text, opt);
}

if (typeof module !== 'undefined') module.exports = {
  scan, detectKind, emailCandidates, icsCandidates, listCandidates, csvCandidates, linkCandidates,
  parseHeaders, stripQuoted, cleanSubject, nameOf, hdrDate, findMoney, findRefs, findUrls, askLines, fingerprint, hash32
};

/* ============================================================
   Plumbing below: browser only. Fetching text from real places.
   ============================================================ */

/* ---------- the intake queue (suggestions waiting for a yes/no) ---------- */
function seenMap() { return db.meta.seen || (db.meta.seen = {}); }
function addCandidates(cands) {
  let added = 0, dup = 0;
  const seen = seenMap();
  (cands || []).forEach(c => {
    const fp = fingerprint(c.src, c.p.title);
    const known = seen[fp] || db.intake.some(x => x.fp === fp);
    if (known) { dup++; return; }
    c.fp = fp; c.at = new Date().toISOString();
    db.intake.push(c); added++;
  });
  save();
  return { added, dup };
}
function candIndex(id) { return db.intake.findIndex(c => c.id === id); }
function acceptCand(id, open) {
  const k = candIndex(id); if (k < 0) return null;
  const c = db.intake[k];
  const p = Object.assign({}, c.p, { src: c.src, note: c.p.note || '' });
  const i = itemFromParse(p);
  i.src = c.src; i.note = p.note;
  db.items.push(i);
  seenMap()[c.fp] = today();
  db.intake.splice(k, 1);
  db.meta.lastIntake = today();
  save();
  if (open) openSheet({ type: 'edit', id: i.id });
  return i;
}
function skipCand(id) {
  const k = candIndex(id); if (k < 0) return;
  seenMap()[db.intake[k].fp] = today();       // remember, so it doesn't come back
  db.intake.splice(k, 1); save();
}
function sourceCounts() {
  const m = {};
  db.items.forEach(i => { const k = (i.src && i.src.kind) || 'manual'; m[k] = (m[k] || 0) + 1; });
  return m;
}

/* ---------- reading files the user picks or drops ---------- */
function readSourceFile(f) {
  const r = new FileReader();
  r.onload = () => {
    const text = String(r.result || '');
    const forceKind = /\.ics$/i.test(f.name) ? 'calendar' : /\.eml$/i.test(f.name) ? 'email' : /\.csv$/i.test(f.name) ? 'csv' : null;
    const res = scan(text, { forceKind, subject: f.name, ref: 'file:' + f.name + ':' + hash32(text), keepQuote: S().sources.keepQuote, myEmail: S().myEmail, max: S().sources.maxPerMessage });
    const n = addCandidates(res.cands);
    ui.view = 'sources'; ui.srcSeg = 'in'; render();
    toast(n.added ? `${f.name}: ${n.added} suggestion${n.added > 1 ? 's' : ''}${n.dup ? ` · ${n.dup} already seen` : ''}` : `Nothing new in ${f.name}`);
  };
  r.onerror = () => toast('Could not read that file');
  r.readAsText(f);
}

/* ---------- Gmail, read-only, straight from the browser ----------
   Your mail never leaves the phone: Margin asks Google for the messages,
   reads them here, and keeps only what you accept. The sign-in token lives
   in memory and is gone when you close the app.                          */
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
let gmailToken = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector('script[data-src="' + src + '"]')) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.src = src;
    s.onload = () => res(); s.onerror = () => rej(new Error('No connection to Google'));
    document.head.appendChild(s);
  });
}
async function gmailAuth() {
  const cfg = S().sources.gmail;
  const id = (cfg.clientId || '').trim();
  if (!id) throw new Error('Add your Google client ID first');
  await loadScript('https://accounts.google.com/gsi/client');
  if (!(window.google && google.accounts && google.accounts.oauth2)) throw new Error('Google sign-in did not load');
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: id, scope: GMAIL_SCOPE,
      callback: r => r && r.access_token ? res(r.access_token) : rej(new Error((r && r.error) || 'Sign-in failed')),
      error_callback: e => rej(new Error((e && e.type === 'popup_closed' ? 'Sign-in window closed' : (e && e.type) || 'Sign-in failed')))
    });
    tc.requestAccessToken({ prompt: gmailToken ? '' : 'consent' });
  });
}
function b64url(s) {
  try {
    const bin = atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } catch (e) { return ''; }
}
function stripHtml(h) {
  return String(h || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function gmailBody(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body && part.body.data) return b64url(part.body.data);
  if (part.parts) { for (const p of part.parts) { const t = gmailBody(p); if (t) return t; } }
  if (part.mimeType === 'text/html' && part.body && part.body.data) return stripHtml(b64url(part.body.data));
  return '';
}
function gmailToText(m) {
  const hs = {};
  ((m.payload && m.payload.headers) || []).forEach(h => { hs[h.name.toLowerCase()] = h.value; });
  const body = gmailBody(m.payload) || m.snippet || '';
  return {
    text: `From: ${hs.from || ''}\nTo: ${hs.to || ''}\nSubject: ${hs.subject || ''}\nDate: ${hs.date || ''}\n\n${body}`,
    url: 'https://mail.google.com/mail/u/0/#all/' + m.id,
    ref: 'gmail:' + m.id
  };
}
async function gmailPull() {
  const cfg = S().sources.gmail;
  if (!gmailToken) gmailToken = await gmailAuth();
  const get = async u => {
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + gmailToken } });
    if (r.status === 401 || r.status === 403) { gmailToken = null; throw new Error('Sign-in expired — tap Fetch again'); }
    if (!r.ok) throw new Error('Gmail replied ' + r.status);
    return r.json();
  };
  const list = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${Math.min(50, +cfg.max || 10)}&q=${encodeURIComponent(cfg.query || 'newer_than:7d')}`);
  const ids = (list.messages || []).map(m => m.id);
  const out = [];
  for (const id of ids) {
    try { out.push(gmailToText(await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`))); }
    catch (e) { break; }
  }
  return out;
}
async function gmailSync() {
  const btn = document.querySelector('[data-a=gmailSync]');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }
  try {
    const msgs = await gmailPull();
    let added = 0, dup = 0;
    const st = S();
    msgs.forEach(m => {
      const res = emailCandidates(m.text, { kind: 'gmail', url: m.url, ref: m.ref, myEmail: st.myEmail, keepQuote: st.sources.keepQuote, max: st.sources.maxPerMessage });
      const n = addCandidates(res.cands); added += n.added; dup += n.dup;
    });
    S().sources.gmail.lastSync = new Date().toISOString();
    save();
    ui.srcSeg = 'in'; render();
    toast(added ? `${added} suggestion${added > 1 ? 's' : ''} from ${msgs.length} email${msgs.length > 1 ? 's' : ''}${dup ? ` · ${dup} already seen` : ''}` : `Read ${msgs.length} email${msgs.length === 1 ? '' : 's'} — nothing new`);
  } catch (e) {
    toast(String((e && e.message) || e).slice(0, 90));
    render();
  }
}
