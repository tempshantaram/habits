/* ===================== MARGIN · core (dates, defaults, parser) ===================== */
'use strict';
var __now = null;
const NOW = () => (__now ? new Date(__now) : new Date());
const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ds(NOW());
const nowHM = () => { const d = NOW(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const addMonths = (s, n) => {
  const d = pd(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return ds(d);
};
const addUnit = (s, n, u) => u === 'd' ? addDays(s, n) : u === 'w' ? addDays(s, 7 * n) : u === 'm' ? addMonths(s, n) : addMonths(s, 12 * n);
const diff = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const dowOf = s => pd(s).getDay();
const MON_N = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_N = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtD = (s, withYear) => { if (!s) return ''; const d = pd(s); const y = withYear || d.getFullYear() !== NOW().getFullYear(); return `${d.getDate()} ${MON_N[d.getMonth()]}${y ? ' ' + d.getFullYear() : ''}`; };
const fmtDay = s => `${DOW_N[dowOf(s)]} ${fmtD(s)}`;
const relDay = s => {
  const n = diff(today(), s);
  if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return DOW_N[dowOf(s)] + ' ' + fmtD(s);
  return fmtD(s);
};
const relL = s => { const r = relDay(s); return /^(Today|Tomorrow|Yesterday)$/.test(r) ? r.toLowerCase() : r; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------- areas ---------- */
const AREAS = [
  { k: 'child', label: 'Child' }, { k: 'dogs', label: 'Dogs' }, { k: 'home', label: 'Home' },
  { k: 'admin', label: 'Admin' }, { k: 'car', label: 'Car' }, { k: 'work', label: 'Work' }, { k: 'me', label: 'Me' }
];
const AREA_LABEL = Object.fromEntries(AREAS.map(a => [a.k, a.label]));
const AREA_ALIAS = { child: 'child', kid: 'child', kids: 'child', baby: 'child', son: 'child', daughter: 'child', dogs: 'dogs', dog: 'dogs', pets: 'dogs', home: 'home', house: 'home', admin: 'admin', paperwork: 'admin', car: 'car', work: 'work', office: 'work', me: 'me', personal: 'me' };
const AREA_WORDS = {
  dogs: ['dog', 'dogs', 'poodle', 'doodle', 'goldendoodle', 'vet', 'vets', 'groom', 'groomer', 'grooming', 'kibble', 'flea', 'fleas', 'tick', 'deworm', 'deworming', 'worming', 'wormer', 'leash', 'lead', 'harness', 'rabies', 'microchip', 'kennel', 'puppy', 'bravecto', 'nexgard', 'dog walk', 'walker', 'pet', 'pets'],
  child: ['baby', 'kid', 'kids', 'child', 'nursery', 'paediatrician', 'pediatrician', 'paed', 'nappies', 'nappy', 'diapers', 'formula', 'stroller', 'pram', 'cot', 'floor bed', 'playdate', 'school', 'schools', 'fs1', 'toddler', 'vaccination', 'vaccinations', 'teething', 'weaning', 'car seat', 'birthday party', 'swim class', 'baby class'],
  admin: ['emirates id', 'eid', 'visa', 'visas', 'passport', 'passports', 'ejari', 'tenancy', 'dewa', 'du', 'etisalat', 'bank', 'bill', 'bills', 'insurance', 'renew', 'renewal', 'tax', 'amer', 'gdrfa', 'icp', 'attestation', 'notary', 'lawyer', 'fine', 'fines', 'salik', 'licence', 'license', 'pension', 'super', 'superannuation', 'ato', 'medicare', 'mygov', 'invoice', 'statement', 'subscription', 'refund', 'warranty', 'will'],
  car: ['car', 'car insurance', 'car registration', 'car service', 'mulkiya', 'rta', 'tyre', 'tyres', 'tire', 'tires', 'petrol', 'fuel', 'parking', 'adnoc', 'enoc', 'tesla', 'ev', 'charger', 'car wash', 'oil change', 'windscreen', 'tint', 'dashcam'],
  home: ['ac', 'a/c', 'aircon', 'filter', 'filters', 'pool', 'spa', 'pest', 'plumber', 'electrician', 'handyman', 'garden', 'gardener', 'cleaning', 'cleaner', 'dishwasher', 'fridge', 'washing machine', 'water tank', 'bulb', 'bulbs', 'furniture', 'ikea', 'curtains', 'restock', 'groceries', 'grocery', 'kitchen', 'villa', 'maintenance', 'smart home', 'router', 'wifi', 'lights', 'paint', 'nanny', 'nannies', 'contractor'],
  work: ['meeting', 'deck', 'slides', 'boss', 'client', 'deal', 'm&a', 'report', 'colleague', 'board', 'memo', 'team', 'recruiter', 'cv', 'linkedin', 'offsite', 'budget', 'model', 'term sheet', 'diligence'],
  me: ['gym', 'haircut', 'barber', 'doctor', 'dentist', 'optometrist', 'glasses', 'frames', 'run', 'swim', 'read', 'book club', 'shirt', 'shirts', 'suit', 'tailor', 'clothes', 'shoes', 'physio', 'massage', 'training', 'workout', 'breathing']
};
const AREA_ORDER = ['dogs', 'child', 'car', 'admin', 'home', 'work', 'me'];

/* ---------- defaults ---------- */
function defaultSettings() {
  return {
    anchors: {
      wd: [
        { k: 'wake', label: 'Wake', t: '07:30' }, { k: 'commute', label: 'Commute', t: '08:00' },
        { k: 'office', label: 'At office', t: '08:45' }, { k: 'lunch', label: 'Lunch', t: '12:30' },
        { k: 'leave', label: 'Leaving', t: '16:50' }, { k: 'home', label: 'Home', t: '17:30' },
        { k: 'night', label: 'After bedtime', t: '20:00' }
      ],
      we: [
        { k: 'morning', label: 'Morning', t: '09:00' }, { k: 'midday', label: 'Midday', t: '12:00' },
        { k: 'afternoon', label: 'Afternoon', t: '15:00' }, { k: 'evening', label: 'Evening', t: '20:00' }
      ]
    },
    weekend: [6, 0],
    triageTime: '20:00',
    reviewDay: 0, reviewTime: '09:30',
    backupDay: 0,
    followUpDays: 3,
    leads: [60, 30, 7],
    calMethod: 'gcal',
    voiceLang: 'en-AU',
    autoAddVoice: false,
    focusOnOpen: true,
    theme: 'auto',
    resurfaceEvery: 21,
    myEmail: '',
    sources: {
      keepQuote: true,          // keep a snippet of the original alongside the item
      maxPerMessage: 3,         // never take more than this from one message
      autoFile: true,           // a dedicated mailbox means everything in it is fair game:
                                // file it straight away and mark it as new, rather than asking
      gmail: { enabled: false, clientId: '', query: 'newer_than:30d', max: 12, auto: true, lastSync: null }
    },
    contacts: [
      { id: 'c1', name: 'Partner', phone: '' },
      { id: 'c2', name: "Child's nanny", phone: '' },
      { id: 'c3', name: 'Dogs’ nanny', phone: '' }
    ],
    learned: {}
  };
}
var db = { v: 1, items: [], log: [], intake: [], settings: defaultSettings(), meta: {} };
const S = () => db.settings;

const isWeekend = d => S().weekend.includes(dowOf(d));
const anchorsFor = d => isWeekend(d) ? S().anchors.we : S().anchors.wd;
const SLOT_MAP = {
  wd: { wake: 'wake', commute: 'commute', office: 'office', lunch: 'lunch', leave: 'leave', home: 'home', night: 'night', evening: 'night', morning: 'office', afternoon: 'lunch', midday: 'lunch' },
  we: { wake: 'morning', commute: 'morning', office: 'morning', morning: 'morning', lunch: 'midday', midday: 'midday', afternoon: 'afternoon', leave: 'afternoon', home: 'afternoon', night: 'evening', evening: 'evening' }
};
function resolveSlot(generic, d) {
  const key = SLOT_MAP[isWeekend(d) ? 'we' : 'wd'][generic] || generic;
  const a = anchorsFor(d).find(x => x.k === key) || S().anchors.wd.concat(S().anchors.we).find(x => x.k === key);
  return a ? { slot: a.k, time: a.t, label: a.label } : null;
}
function slotLabel(k) { const a = S().anchors.wd.concat(S().anchors.we).find(x => x.k === k); return a ? a.label : ''; }

/* ---------- seasons ---------- */
// Ramadan start dates are approximate (moon sighting can shift by a day).
const RAMADAN = ['2026-02-18', '2027-02-08', '2028-01-28', '2029-01-16', '2030-01-05', '2030-12-26', '2031-12-15', '2032-12-04', '2033-11-23', '2034-11-12'];
const SEASONS = {
  summer: { label: 'Before summer', md: '05-15', words: ['before summer', 'summer'] },
  summerbreak: { label: 'Summer break', md: '07-01', words: ['summer break', 'summer holidays', 'summer hols'] },
  school: { label: 'Back to school', md: '08-20', words: ['back to school', 'school starts', 'new school year'] },
  ramadan: { label: 'Before Ramadan', words: ['before ramadan', 'ramadan'] },
  cooler: { label: 'Cooler months', md: '11-01', words: ['cooler months', 'cooler weather', 'winter'] },
  yearend: { label: 'Year end', md: '12-01', words: ['end of the year', 'end of year', 'year end', 'year-end', 'eoy'] }
};
function seasonNext(key, after) {
  after = after || today();
  if (key === 'ramadan') {
    const d = RAMADAN.map(r => addDays(r, -14)).find(x => x > after);
    return d || addDays(after, 354);
  }
  const s = SEASONS[key]; const y = pd(after).getFullYear();
  let d = `${y}-${s.md}`; if (d <= after) d = `${y + 1}-${s.md}`; return d;
}

/* ---------- auto-sort ---------- */
function autoArea(text) {
  const t = ' ' + text.toLowerCase().replace(/[^a-z0-9&'/\s-]/g, ' ') + ' ';
  const score = {};
  for (const k of AREA_ORDER) {
    for (const w of AREA_WORDS[k]) {
      const re = new RegExp('(^|[\\s])' + w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(?=[\\s])');
      if (re.test(t)) score[k] = (score[k] || 0) + 2 + (w.includes(' ') ? 1 : 0);
    }
  }
  const L = S().learned || {};
  for (const w of t.split(/\s+/)) if (w && L[w]) score[L[w]] = (score[L[w]] || 0) + 1.5;
  let best = null, bs = 0;
  for (const k of AREA_ORDER) if ((score[k] || 0) > bs) { bs = score[k]; best = k; }
  return best;
}
const STOP = new Set('the and for with from that this then than into onto about call text email book order renew check get buy pay send make sort need needs want some more before after next every week month year today tomorrow tonight'.split(' '));
function learnArea(title, area) {
  const L = S().learned || (S().learned = {});
  const kw = new Set(Object.values(AREA_WORDS).flat());
  title.toLowerCase().replace(/[^a-z0-9&\s-]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w) && !kw.has(w) && !/^\d+$/.test(w))
    .forEach(w => { L[w] = area; });
}

/* ---------- effort & batch ---------- */
function guessEffort(title) {
  const w = (title.toLowerCase().match(/^[a-z']+/) || [''])[0];
  if (/^(call|ring|phone|text|message|msg|whatsapp|email|reply|check|confirm|ask|remind|tell|ping)$/.test(w)) return '2m';
  if (/^(book|order|buy|pay|schedule|renew|fill|transfer|cancel|return|print|sign|submit|top)$/.test(w)) return '15m';
  if (/^(plan|research|write|draft|review|sort|organise|organize|fix|build|design|prepare|prep|learn|compare|clean|clear|declutter)$/.test(w)) return 'deep';
  return null;
}
const BATCH = [
  { k: 'calls', label: 'calls', re: /^(call|ring|phone)\b/i },
  { k: 'msgs', label: 'messages', re: /^(text|message|msg|whatsapp|wa|ping|tell|ask)\b/i },
  { k: 'emails', label: 'emails', re: /^(email|reply|e-mail)\b/i },
  { k: 'buys', label: 'orders', re: /^(buy|order|get|pick up|restock)\b/i },
  { k: 'books', label: 'bookings', re: /^(book|schedule|reserve)\b/i },
  { k: 'pays', label: 'payments & renewals', re: /^(pay|transfer|renew|top up)\b/i },
  { k: 'fixes', label: 'fixes', re: /^(fix|repair|replace|change)\b/i }
];
const batchOf = title => { const b = BATCH.find(b => b.re.test(title.trim())); return b ? b.k : null; };

/* ---------- natural-language parser ---------- */
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DOW_FULL = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thur?s?|fri)';
const DOW_ANY = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thur?s?|fri|sat|sun)';
const DOW_IDX = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
const dIdx = w => DOW_IDX[w.slice(0, 3).toLowerCase()];
const monIdx = w => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3).toLowerCase());
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, other: 2 };
const numOf = w => w == null ? 1 : (/^\d+$/.test(w) ? +w : (NUMW[w.toLowerCase()] || 1));
const UNIT = { day: 'd', days: 'd', d: 'd', week: 'w', weeks: 'w', w: 'w', month: 'm', months: 'm', m: 'm', year: 'y', years: 'y', y: 'y' };
const SHOPS = { 'amazon.ae': 'Amazon', amazon: 'Amazon', noon: 'Noon', carrefour: 'Carrefour', talabat: 'Talabat', careem: 'Careem', kibsons: 'Kibsons', ikea: 'IKEA', ace: 'ACE', 'home centre': 'Home Centre', 'homecentre': 'Home Centre', lulu: 'Lulu', spinneys: 'Spinneys', waitrose: 'Waitrose', 'sharaf dg': 'Sharaf DG', decathlon: 'Decathlon', 'pottery barn': 'Pottery Barn', 'dragon mart': 'Dragon Mart', 'instashop': 'InstaShop' };
const SHOP_RE = '(amazon\\.ae|amazon|noon|carrefour|talabat|careem|kibsons|ikea|ace|home ?centre|lulu|spinneys|waitrose|sharaf dg|decathlon|pottery barn|dragon mart|instashop)';

function nextDow(from, idx, includeToday) {
  const d0 = dowOf(from); let n = (idx - d0 + 7) % 7; if (n === 0 && !includeToday) n = 7; return addDays(from, n);
}
function mkDate(y, m, d) {
  const dt = new Date(y, m, d); if (dt.getMonth() !== m) return null; return ds(dt);
}

function parse(raw, opt) {
  opt = opt || {};
  const T = today();
  let s = ' ' + String(raw || '').replace(/\s+/g, ' ') + ' ';
  const r = { title: '', due: null, time: null, slot: null, hard: false, area: null, list: null, effort: null, recur: null, expiry: null, person: null, shop: null, season: null, seasonRecur: false, effortGuess: false, bang: false };
  let genericSlot = null, float = false, explicitTime = false;
  const take = (re, fn) => {
    const m = s.match(re); if (!m) return false;
    const res = fn(m); if (res === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); return true;
  };
  const loop = (re, fn) => { let g = 0; while (g++ < 8 && take(re, fn)); };

  // leading filler
  take(/^\s*(?:remind me to|remember to|don'?t forget to|reminder:|todo:|to do:)\s+/i, () => { });
  // hard flag
  loop(/!+(?=\s)/, () => { r.hard = true; r.bang = true; });
  // effort
  take(/\s~\s?(\d{1,3})\s?(?:m|min|mins|minutes)?(?=\s)/i, m => { const n = +m[1]; r.effort = n <= 5 ? '2m' : n <= 30 ? '15m' : 'deep'; });
  take(/\s~\s?(deep|quick|long|\d+h)(?=\s)/i, m => { r.effort = /quick/i.test(m[1]) ? '2m' : 'deep'; });
  // #area / #list
  loop(/\s#([\w-]+)(?=\s)/, m => {
    const w = m[1].toLowerCase();
    if (AREA_ALIAS[w]) r.area = AREA_ALIAS[w];
    else if (/^(buy|shop|shopping)$/.test(w)) r.list = 'buy';
    else if (/^gifts?$/.test(w)) r.list = 'gift';
    else if (/^(wait|waiting|wo)$/.test(w)) r.list = 'waiting';
    else if (/^(someday|maybe|later)$/.test(w)) r.list = 'someday';
    else if (/^note$/.test(w)) r.list = null;
    else return false;
  });
  // @person
  take(/\s@([\w'’-]+)(?=\s)/, m => { r.person = cap(m[1]); });

  // lists by phrase
  take(/^\s*(?:waiting\s+(?:on|for)|wo:|chase)\s+(?:([A-Z][\w'’-]*|the\s+\w+)\s+(?:for|to\s+send|to|re:?|about|on)\s+)?/i, m => {
    r.list = 'waiting'; if (m[1]) r.person = r.person || cap(m[1].replace(/^the\s+/i, ''));
  });
  take(/^\s*(?:gift|present)(?:\s+ideas?)?\s*(?:for\s+([\w'’-]+))?\s*[:\-–]?\s+/i, m => { r.list = 'gift'; if (m[1]) r.person = r.person || cap(m[1]); });
  if (!r.list) take(/\s(?:gift|present)\s+(?:idea\s+)?for\s+([\w'’-]+)(?=\s)/i, m => { r.list = 'gift'; r.person = r.person || cap(m[1]); return false; });
  if (r.list === 'gift' && !r.person) take(/\sgift\s+for\s+([\w'’-]+)(?=\s)/i, m => { r.person = cap(m[1]); });
  take(/\s(?:someday|some day|one day|maybe later)(?=\s)/i, () => { r.list = 'someday'; });
  if (!r.list && /^\s*(buy|order|restock|get more|pick up)\s/i.test(s)) r.list = 'buy';
  take(new RegExp('\\s(?:(?:from|at|on|via)\\s+)?' + SHOP_RE + '(?=[\\s,.])', 'i'), m => {
    if (r.list !== 'buy' && !/^(from|at|on|via)/i.test(m[0].trim())) return false;
    r.shop = SHOPS[m[1].toLowerCase().replace(/\s+/, ' ')] || cap(m[1]);
    if (!r.list) r.list = 'buy';
  });

  // expiry
  take(/\s(?:expires?|expiring|expiry(?:\s+date)?|exp\.?|valid\s+(?:till|until|to))(?:\s+(?:on|at))?(?=\s)/i, () => { r.expiry = { date: null }; });

  // recurrence
  take(/\s(?:after\s+(?:done|doing|i\s+do\s+it|completion|each\s+time|last(?:\s+time)?)|from\s+(?:done|last(?:\s+time)?)|since\s+last(?:\s+time)?)(?=\s)/i, () => { float = true; });
  take(new RegExp('\\s(?:every|each)\\s+' + DOW_ANY + '((?:\\s*(?:,|and|&|\\+)\\s*' + DOW_ANY + ')*)(?=\\s)', 'i'), m => {
    const ds_ = (m[0].match(new RegExp(DOW_ANY, 'gi')) || []).map(dIdx);
    r.recur = { kind: 'fixed', n: 1, unit: 'w', dows: [...new Set(ds_)].sort() };
  });
  take(/\s(?:every|each)\s+(weekday|workday|weekend)s?(?=\s)/i, m => {
    const we = S().weekend;
    r.recur = { kind: 'fixed', n: 1, unit: 'w', dows: /weekend/i.test(m[1]) ? [...we].sort() : [0, 1, 2, 3, 4, 5, 6].filter(x => !we.includes(x)) };
  });
  take(/\s(?:every|each)\s+(?:(\d+|other|a|two|three|four|five|six|eight|ten|twelve)\s+)?(day|week|fortnight|month|quarter|year)s?(?=\s)/i, m => {
    let n = numOf(m[1]), u = m[2].toLowerCase();
    if (u === 'fortnight') { n *= 2; u = 'week'; } if (u === 'quarter') { n *= 3; u = 'month'; }
    r.recur = { kind: 'fixed', n, unit: UNIT[u] };
  });
  take(/\s(?:every|each)\s+(\d+)\s?(d|w|m|y)(?=\s)/i, m => { r.recur = { kind: 'fixed', n: +m[1], unit: m[2].toLowerCase() }; });
  take(/\s(daily|weekly|fortnightly|monthly|quarterly|yearly|annually)(?=\s)/i, m => {
    const w = m[1].toLowerCase();
    const map = { daily: [1, 'd'], weekly: [1, 'w'], fortnightly: [2, 'w'], monthly: [1, 'm'], quarterly: [3, 'm'], yearly: [1, 'y'], annually: [1, 'y'] };
    r.recur = { kind: 'fixed', n: map[w][0], unit: map[w][1] };
  });

  // seasons
  const phrases = [];
  for (const k in SEASONS) for (const w of SEASONS[k].words) phrases.push([w, k]);
  phrases.sort((a, b) => b[0].length - a[0].length);
  {
    const re = new RegExp('\\s(every\\s+|each\\s+|yearly\\s+)?(before\\s+|by\\s+|for\\s+|in\\s+)?(' + phrases.map(p => p[0].replace(/[-]/g, '\\-')).join('|') + ')(?=\\s)', 'gi');
    const AMBIG = new Set(['summer', 'winter', 'ramadan']);
    let pick = null, m;
    while ((m = re.exec(s))) {
      const w = m[3].toLowerCase();
      if (AMBIG.has(w) && !m[1] && !m[2]) { re.lastIndex = m.index + 1; continue; }
      pick = m; break;
    }
    if (pick) {
      const hit = phrases.find(p => p[0] === pick[3].toLowerCase());
      r.season = hit[1]; if (pick[1]) r.seasonRecur = true;
      s = s.slice(0, pick.index) + ' ' + s.slice(pick.index + pick[0].length);
    }
  }

  // relative dates
  take(/\sin\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|fortnight|month|year)s?(?=\s)/i, m => {
    let n = numOf(m[1]), u = m[2].toLowerCase(); if (u === 'fortnight') { n *= 2; u = 'week'; }
    r.due = addUnit(T, n, UNIT[u]);
  });
  take(/\s(?:the\s+)?day\s+after\s+tomorrow(?=\s)/i, () => { r.due = addDays(T, 2); });
  take(/\s(?:today|tdy)(?=\s)/i, () => { r.due = T; });
  take(/\stonight(?=\s)/i, () => { r.due = r.due || T; genericSlot = genericSlot || 'night'; });
  take(/\s(?:tomorrow|tmrw|tmr|tomoz|2moro|2morrow)(?:\s+(morning|afternoon|evening|night|lunch))?(?=\s)/i, m => { r.due = addDays(T, 1); if (m[1]) genericSlot = m[1].toLowerCase(); });
  take(/\s(this\s+|next\s+)?weekend(?=\s)/i, m => {
    const we = S().weekend, isWE = we.includes(dowOf(T)); const first = Math.min(...we.map(x => x === 0 ? 7 : x)) % 7;
    let d = isWE ? T : nextDow(T, first, false);
    if (m[1] && /next/i.test(m[1]) && isWE) d = nextDow(addDays(T, 1), first, true);
    r.due = d; genericSlot = genericSlot || 'morning';
  });
  take(/\snext\s+week(?=\s)/i, () => { r.due = nextDow(T, 1, false); });
  take(/\s(?:(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+)?week|eow)(?=\s)/i, () => { r.due = nextDow(T, 5, true); });
  take(/\s(?:(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+)?month|eom)(?=\s)/i, () => { const d = pd(T); r.due = ds(new Date(d.getFullYear(), d.getMonth() + 1, 0)); });
  take(/\snext\s+month(?=\s)/i, () => { const d = pd(T); r.due = ds(new Date(d.getFullYear(), d.getMonth() + 1, 1)); });

  // absolute dates
  const setAbs = (y, mo, d) => {
    const hasY = y != null;
    if (hasY && y < 100) y += 2000;
    let yy = hasY ? y : pd(T).getFullYear();
    let out = mkDate(yy, mo, d); if (!out) return false;
    if (!hasY && out < T) out = mkDate(yy + 1, mo, d);
    r.due = out;
  };
  take(/\s(?:on\s+|by\s+|due\s+|till\s+|until\s+)?(\d{4})-(\d{2})-(\d{2})(?=\s)/, m => setAbs(+m[1], +m[2] - 1, +m[3]));
  take(new RegExp('\\s(?:on\\s+|by\\s+|due\\s+|till\\s+|until\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON_RE + '\\.?(?:,?\\s+(\\d{4}))?(?=[\\s,.])', 'i'), m => setAbs(m[3] ? +m[3] : null, monIdx(m[2]), +m[1]));
  take(new RegExp('\\s(?:on\\s+|by\\s+|due\\s+|till\\s+|until\\s+)?' + MON_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=[\\s,.])', 'i'), m => setAbs(m[3] ? +m[3] : null, monIdx(m[1]), +m[2]));
  take(new RegExp('\\s(?:in\\s+|by\\s+)?' + MON_RE + '\\.?\\s+(\\d{4})(?=[\\s,.])', 'i'), m => setAbs(+m[2], monIdx(m[1]), 1));
  take(/\s(?:on\s+|by\s+|due\s+|till\s+|until\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=[\s,.])/, m => setAbs(m[3] ? +m[3] : null, +m[2] - 1, +m[1]));
  if (r.expiry && !r.due) take(/\s(\d{1,2})\/(\d{2}|\d{4})(?=[\s,.])/, m => { const mo = +m[1] - 1; if (mo < 0 || mo > 11) return false; let y = +m[2]; if (y < 100) y += 2000; r.due = mkDate(y, mo, 1); });
  // weekdays (ambiguous short "sat"/"sun" need a lead word)
  take(new RegExp('\\s(?:(on|by|next|this|till|until|due)\\s+)?(?:(next|this)\\s+)?' + DOW_ANY + '(?:\\s+(morning|afternoon|evening|night|lunch))?(?=[\\s,.])', 'i'), m => {
    const w = m[3].toLowerCase(), lead = (m[1] || '') + ' ' + (m[2] || '');
    if ((w === 'sat' || w === 'sun') && !lead.trim() && !m[4]) return false;
    const idx = dIdx(w);
    let d = nextDow(T, idx, false);
    if (/next/i.test(lead)) { const mon = nextDow(T, 1, false); d = addDays(mon, (idx + 6) % 7); }
    else if (/this/i.test(lead)) d = nextDow(T, idx, true);
    r.due = d; if (m[4]) genericSlot = m[4].toLowerCase();
  });

  // times
  take(/\s(?:at\s+|@\s*|by\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.]|$)/i, m => {
    let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; if (+m[1] > 12) return false;
    r.time = `${pad(h)}:${m[2] || '00'}`; explicitTime = true;
  });
  take(/\s(?:at\s+|@\s*|by\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?=[\s,]|$)/, m => { r.time = `${pad(+m[1])}:${m[2]}`; explicitTime = true; });
  take(/\sat\s+(\d{1,2})(?=\s)(?!\s*(?:day|week|month|year|min|%|\/|km|kg|people|pm|am))/i, m => {
    let h = +m[1]; if (h > 23) return false; if (h >= 1 && h <= 7) h += 12;
    r.time = `${pad(h)}:00`; explicitTime = true;
  });
  take(/\s(?:at\s+)?noon(?=\s)/i, () => { r.time = '12:00'; explicitTime = true; });

  // anchors (soft slots)
  take(/\s(?:on\s+(?:the\s+|my\s+)?|during\s+(?:the\s+|my\s+)?)?(?:commute|drive\s+in)(?=\s)/i, () => { genericSlot = 'commute'; });
  take(/\s(?:(?:at|in)\s+(?:the\s+)?)(?:office|work)(?=\s)/i, () => { genericSlot = 'office'; });
  take(/\s(?:at\s+|over\s+)lunch(?:time)?(?=\s)|\slunchtime(?=\s)/i, () => { genericSlot = 'lunch'; });
  take(/\s(?:(?:when|before)\s+leaving(?:\s+work|\s+the\s+office)?|on\s+the\s+(?:way|drive)\s+home|drive\s+home)(?=\s)/i, () => { genericSlot = 'leave'; });
  take(/\s(?:when\s+(?:i(?:'m|\s+am|\s+get)\s+)?home|home\s+time|at\s+home\s+time)(?=\s)/i, () => { genericSlot = 'home'; });
  take(/\s(?:after\s+(?:bedtime|bed\s*time|(?:the\s+)?(?:kids?|baby|little\s+one)(?:'s)?\s+(?:is\s+|are\s+)?(?:down|asleep|in\s+bed))|late\s+evening)(?=\s)/i, () => { genericSlot = 'night'; });
  take(/\s(?:this\s+|in\s+the\s+)?evening(?=\s)/i, () => { genericSlot = genericSlot || 'evening'; });
  take(/\s(?:this\s+|in\s+the\s+)?morning(?=\s)/i, () => { genericSlot = genericSlot || 'morning'; });
  take(/\s(?:this\s+|in\s+the\s+)?afternoon(?=\s)/i, () => { genericSlot = genericSlot || 'afternoon'; });
  take(/\s(?:at\s+)?midday(?=\s)/i, () => { genericSlot = genericSlot || 'midday'; });
  take(/\s(?:first\s+thing|when\s+i\s+wake(?:\s+up)?)(?=\s)/i, () => { genericSlot = 'wake'; });

  // ---- title cleanup
  let t = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) t = t.replace(/[\s,;:–-]*\b(?:on|at|by|in|for|and|due|from|every|each|before|the|to|until|till|via)$/i, '').replace(/[\s,;:–—-]+$/, '').trim();
  t = t.replace(/^[\s,;:–-]+/, '');
  r.title = cap(t);

  // ---- resolve
  if (r.expiry) {
    r.expiry.date = r.due; r.due = null; r.time = null; genericSlot = null; explicitTime = false;
    if (!r.area) r.area = autoArea(r.title) || 'admin';
    r.hard = true;
  }
  if (r.season) {
    if (!r.due) r.due = seasonNext(r.season);
    if (r.seasonRecur || (r.recur && r.recur.unit === 'y' && r.recur.n === 1)) r.recur = { kind: 'season', key: r.season };
  }
  if (r.recur && float && r.recur.kind === 'fixed' && !r.recur.dows) r.recur.kind = 'float';
  if (r.recur && r.recur.dows && !r.due) {
    const tNow = nowHM();
    const cand = [0, 1, 2, 3, 4, 5, 6].map(n => addDays(T, n)).find(d => r.recur.dows.includes(dowOf(d)) && (d !== T || !r.time || r.time > tNow));
    r.due = cand || T;
  }
  if (r.recur && !r.due) r.due = T;
  if (genericSlot && !r.list) {
    let d = r.due || T;
    let res = resolveSlot(genericSlot, d);
    if (!r.due && res && res.time <= nowHM()) { d = addDays(T, 1); res = resolveSlot(genericSlot, d); }
    if (res) { r.due = d; r.slot = res.slot; if (!explicitTime) r.time = res.time; }
  } else if (genericSlot && r.list !== 'someday') {
    const d = r.due || T; const res = resolveSlot(genericSlot, d);
    if (res) { r.due = d; r.slot = res.slot; if (!explicitTime) r.time = res.time; }
  }
  if (r.time && !r.due) r.due = r.time > nowHM() ? T : addDays(T, 1);
  if (explicitTime) { r.hard = true; if (r.slot) r.slot = null; }
  if (r.list === 'someday') { r.due = null; r.time = null; r.slot = null; r.hard = false; r.recur = null; }
  if (!r.area) r.area = autoArea(r.title + ' ' + (r.person || ''));
  if (!r.effort) { r.effort = guessEffort(r.title); r.effortGuess = !!r.effort; }
  if (opt.list && !r.list) r.list = opt.list;
  return r;
}

function recurText(rc) {
  if (!rc) return '';
  if (rc.kind === 'season') return 'yearly · ' + (SEASONS[rc.key] ? SEASONS[rc.key].label.toLowerCase() : rc.key);
  const U = { d: 'day', w: 'week', m: 'month', y: 'year' };
  if (rc.dows && rc.dows.length) {
    const we = S().weekend.slice().sort().join(), wd = [0, 1, 2, 3, 4, 5, 6].filter(x => !S().weekend.includes(x)).join();
    const j = rc.dows.slice().sort().join();
    if (j === wd) return 'weekdays'; if (j === we) return 'weekends';
    return 'every ' + rc.dows.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(x => DOW_N[x]).join(', ');
  }
  const base = rc.n === 1 ? ({ d: 'daily', w: 'weekly', m: 'monthly', y: 'yearly' })[rc.unit] : `every ${rc.n} ${U[rc.unit]}s`;
  return rc.kind === 'float' ? (rc.n === 1 ? `1 ${U[rc.unit]}` : `${rc.n} ${U[rc.unit]}s`) + ' after done' : base;
}

function nextFixed(rc, from, T) {
  // next occurrence strictly after max(from, T - 1)
  if (rc.dows && rc.dows.length) {
    let d = addDays(from > T ? from : T, 1);
    for (let i = 0; i < 8; i++) { if (rc.dows.includes(dowOf(d))) return d; d = addDays(d, 1); }
    return d;
  }
  let d = addUnit(from, rc.n, rc.unit), g = 0;
  while (d <= T && g++ < 500) d = addUnit(d, rc.n, rc.unit);
  return d;
}

if (typeof module !== 'undefined') module.exports = { parse, setNow: v => { __now = v; }, today, addDays, addUnit, recurText, nextFixed, seasonNext, autoArea, guessEffort, cap, AREA_ALIAS, uid, ds, pd, diff, get db() { return db; } };
