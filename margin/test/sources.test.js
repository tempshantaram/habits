/* Tests for the source readers: text in, suggestions out. Run: node test/sources.test.js */
const C = require('../src/core.js');
const S = require('../src/sources.js');
C.setNow('2026-09-16T10:00:00'); // Wed

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra == null ? '' : '\n   ' + JSON.stringify(extra)); } }

/* ---------- 1. a plain forwarded email ---------- */
const EMAIL = `From: Ahmed Khan <ahmed@poolworks.ae>
To: Sam <sam@example.com>
Subject: Re: Pool quote for the villa
Date: Mon, 14 Sep 2026 at 09:12

Hi Sam,

Thanks for the site visit. The quote is AED 4,500 including the pump.
Please confirm by 25 Sep so we can hold the slot.
Booking reference: PW-88213

Best,
Ahmed
--
Poolworks LLC
Unsubscribe here
`;
const e = S.emailCandidates(EMAIL, { myEmail: 'sam@example.com' });
ok('email: subject cleaned', e.meta.subject === 'Pool quote for the villa', e.meta.subject);
ok('email: header date', e.cands[0].src.at === '2026-09-14', e.cands[0].src.at);
ok('email: sender name', e.cands[0].src.name === 'Ahmed Khan', e.cands[0].src.name);
ok('email: amount found', e.meta.money[0].replace(/\s/g, '') === 'AED4,500', e.meta.money);
ok('email: reference found', e.meta.refs.includes('PW-88213'), e.meta.refs);
ok('email: picks up the ask', e.cands.some(c => /confirm/i.test(c.p.title)), e.cands.map(c => c.p.title));
ok('email: date on the ask', e.cands.some(c => c.p.due === '2026-09-25'), e.cands.map(c => c.p.due));
ok('email: area guessed', e.cands.every(c => c.p.area === 'home'), e.cands.map(c => c.p.area));
ok('email: note carries the facts', /AED 4,500/.test(e.cands[0].p.note) && /PW-88213/.test(e.cands[0].p.note), e.cands[0].p.note);
ok('email: note stays out of the way', !/^From:/m.test(e.cands[0].p.note), e.cands[0].p.note);
ok('email: signature dropped', !/Poolworks LLC/.test(e.cands[0].src.quote), e.cands[0].src.quote);
ok('email: every suggestion says why', e.cands.every(c => c.why && c.why.length > 5));

/* ---------- 2. an expiry notice ---------- */
const EXP = `From: no-reply@insurance.ae
Subject: Your car insurance policy expires on 3 Nov 2026
Date: 15 Sep 2026

Dear customer, your policy 44-9912 is due for renewal. Policy expires on 3 Nov 2026.`;
const x = S.emailCandidates(EXP, {});
ok('expiry: becomes a radar item', !!x.cands[0].p.expiry, x.cands[0].p);
ok('expiry: right date', x.cands[0].p.expiry && x.cands[0].p.expiry.date === '2026-11-03', x.cands[0].p.expiry);
ok('expiry: area car', x.cands[0].p.area === 'car', x.cands[0].p.area);

/* ---------- 3. an appointment ---------- */
const APPT = `From: Dubai London Clinic <bookings@dlc.ae>
Subject: Appointment confirmed
Date: 16 Sep 2026

Your appointment for the baby's vaccination is confirmed for 22 Sep 2026 at 4:30pm.`;
const a = S.emailCandidates(APPT, {});
ok('appointment: dated', a.cands[0].p.due === '2026-09-22', a.cands[0].p.due);
ok('appointment: timed', a.cands[0].p.time === '16:30', a.cands[0].p.time);
ok('appointment: hard (goes to calendar)', a.cands[0].p.hard === true);

/* ---------- 4. something you sent, waiting on a reply ---------- */
const SENT = `From: Sam <sam@example.com>
To: Nadia <nadia@school.ae>
Subject: FS1 registration paperwork
Date: 16 Sep 2026

Sending the forms through — could you confirm you have everything?`;
const w = S.emailCandidates(SENT, { myEmail: 'sam@example.com' });
ok('sent mail: waiting list', w.cands.some(c => c.p.list === 'waiting'), w.cands.map(c => c.p.list));
ok('sent mail: person is the recipient', w.cands.some(c => c.p.person === 'Nadia'), w.cands.map(c => c.p.person));

/* ---------- 5. a calendar invite ---------- */
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:abc-123@vet
SUMMARY:Dogs annual vaccination
DTSTART;TZID=Asia/Dubai:20261002T170000
LOCATION:Modern Vet\\, Al Quoz
DESCRIPTION:Bring the vaccination book
RRULE:FREQ=YEARLY
END:VEVENT
BEGIN:VEVENT
UID:old-1@vet
SUMMARY:Last year's visit
DTSTART;VALUE=DATE:20250101
END:VEVENT
END:VCALENDAR`;
const i = S.icsCandidates(ICS, {});
ok('ics: past events dropped', i.cands.length === 1, i.cands.map(c => c.p.title));
ok('ics: date + time', i.cands[0].p.due === '2026-10-02' && i.cands[0].p.time === '17:00', i.cands[0].p);
ok('ics: yearly repeat', i.cands[0].p.recur && i.cands[0].p.recur.unit === 'y', i.cands[0].p.recur);
ok('ics: location in the note', /Al Quoz/.test(i.cands[0].p.note), i.cands[0].p.note);
ok('ics: area from the words', i.cands[0].p.area === 'dogs', i.cands[0].p.area);

/* ---------- 6. a pasted list ---------- */
const LIST = `- buy dog shampoo from amazon
* call DEWA tmrw commute
1. book vet tue 5pm
[ ] learn to sail someday`;
const l = S.listCandidates(LIST, {});
ok('list: one per line', l.cands.length === 4, l.cands.length);
ok('list: bullets stripped', l.cands[0].p.title === 'Buy dog shampoo', l.cands[0].p.title);
ok('list: capture grammar still works', l.cands[0].p.shop === 'Amazon' && l.cands[3].p.list === 'someday', l.cands.map(c => c.p.list));

/* ---------- 7. a spreadsheet ---------- */
const CSV = `Task,Due,Area,Note
Renew Ejari,2026-10-01,admin,"Landlord has the papers, ask first"
Service the AC,2026-11-15,home,`;
const c = S.csvCandidates(CSV, {});
ok('csv: header understood', c.cands.length === 2, c.cands.length);
ok('csv: due date read', c.cands[0].p.due === '2026-10-01', c.cands[0].p.due);
ok('csv: area column wins', c.cands[0].p.area === 'admin', c.cands[0].p.area);
ok('csv: quoted comma survives', /Landlord has the papers, ask first/.test(c.cands[0].p.note), c.cands[0].p.note);

/* ---------- 8. detection and de-duplication ---------- */
ok('detect: email', S.detectKind(EMAIL) === 'email');
ok('detect: calendar', S.detectKind(ICS) === 'calendar');
ok('detect: csv', S.detectKind(CSV) === 'csv');
ok('detect: link', S.detectKind('https://example.com/a/b') === 'link');
ok('detect: list', S.detectKind(LIST) === 'list');
ok('detect: empty', S.detectKind('   ') === 'empty');
ok('scan routes to the right reader', S.scan(ICS, {}).kind === 'calendar');
ok('fingerprint: same message, same id',
  S.fingerprint({ kind: 'email', ref: '<a@b>' }, 'x') === S.fingerprint({ kind: 'email', ref: '<a@b>' }, 'y'));
ok('fingerprint: no id falls back to the content',
  S.fingerprint({ kind: 'email', from: 'a', subject: 'b', at: 'c' }, 't') === S.fingerprint({ kind: 'email', from: 'a', subject: 'b', at: 'c' }, 't'));

/* ---------- 9. never more than the cap ---------- */
const NOISY = `From: spammy@shop.com
Subject: Please confirm, please sign, please submit

Please confirm the order. Please sign the form. Please submit the papers.
Kindly reply by Friday. Could you send us the photos? We need the meter reading.`;
ok('cap respected', S.emailCandidates(NOISY, { max: 3 }).cands.length <= 3);

/* ---------- 10. a link shared from another app ---------- */
const sh = S.linkCandidates({ title: 'Best toddler car seats 2026', url: 'https://which.co.uk/car-seats', text: 'for the baby' }, { kind: 'share' });
ok('share: title used', /toddler car seats/i.test(sh.cands[0].p.title), sh.cands[0].p.title);
ok('share: url kept', sh.cands[0].src.url === 'https://which.co.uk/car-seats');
ok('share: area guessed from the words', sh.cands[0].p.area === 'child', sh.cands[0].p.area);

/* ---------- 11. a WhatsApp chat ---------- */
const WA = `14/09/2026, 09:12 - Ahmed: Morning!
14/09/2026, 09:12 - Ahmed: <Media omitted>
14/09/2026, 09:13 - Ahmed: Can you send the Ejari copy before Thursday?
14/09/2026, 09:20 - Me: sure
15/09/2026, 18:04 - Dogs nanny: The groomer is fully booked, shall I try Saturday?`;
const wa = S.whatsappCandidates(WA, {});
ok('whatsapp: chatter ignored', !wa.cands.some(c => /morning/i.test(c.p.title)), wa.cands.map(c => c.p.title));
ok('whatsapp: media lines ignored', !wa.cands.some(c => /omitted/i.test(c.p.title)), wa.cands.map(c => c.p.title));
ok('whatsapp: the ask survives', wa.cands.some(c => /ejari/i.test(c.p.title)), wa.cands.map(c => c.p.title));
ok('whatsapp: sender kept', wa.cands.some(c => c.src.name === 'Ahmed'), wa.cands.map(c => c.src.name));
ok('whatsapp: day comes first', wa.cands[0].src.at === '2026-09-14', wa.cands[0].src.at);
ok('whatsapp: question counts as an ask', wa.cands.some(c => /groomer/i.test(c.p.title)), wa.cands.map(c => c.p.title));
ok('detect: whatsapp', S.detectKind(WA) === 'whatsapp', S.detectKind(WA));
ok('whatsapp: iPhone export style too',
  S.whatsappMessages('[14/09/2026, 09:13:02] Ahmed Khan: please confirm').length === 1);
ok('whatsapp: nothing actionable still offers the last line',
  S.whatsappCandidates('14/09/2026, 09:12 - Ahmed: ok thanks', {}).cands.length === 1);

/* ---------- 12. a pasted email keeps a way back to Gmail ---------- */
const WITHID = `From: a@b.com
Subject: Renewal
Message-ID: <abc123@mail.gmail.com>
Date: 16 Sep 2026

Please renew before 1 Oct.`;
ok('email: message-id becomes a Gmail link',
  /rfc822msgid/.test(S.emailCandidates(WITHID, {}).cands[0].src.url || ''), S.emailCandidates(WITHID, {}).cands[0].src.url);

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
