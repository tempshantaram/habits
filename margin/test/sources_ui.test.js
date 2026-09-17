/* Drives the built app in a real browser and walks the Sources flow.
   Run: node test/sources_ui.test.js   (needs playwright + chromium)  */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../dist/margin.html');
const SHOTS = path.resolve(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

const EMAIL = `From: Ahmed Khan <ahmed@poolworks.ae>
To: me@example.com
Subject: Re: Pool quote for the villa
Date: 14 Sep 2026

Hi, the quote is AED 4,500 including the pump.
Please confirm by 25 Sep so we can hold the slot.
Booking reference: PW-88213`;

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:vet-1@margin
SUMMARY:Dogs annual vaccination
DTSTART;TZID=Asia/Dubai:20991002T170000
LOCATION:Modern Vet
END:VEVENT
END:VCALENDAR`;

const errors = [];
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);

  // the Sources tab exists and is reachable
  await page.click('nav [data-v=sources]'); await page.waitForTimeout(250);
  ok('sources tab opens', await page.locator('#srcText').count() === 1);
  await page.screenshot({ path: `${SHOTS}/20_sources_empty.png`, fullPage: true });

  // paste an email → suggestions
  await page.fill('#srcText', EMAIL);
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(300);
  const cands = await page.locator('.cand').count();
  ok('email produced suggestions', cands >= 1, cands);
  ok('sender shown on the card', /ahmed khan/i.test(await page.locator('.cand .k').first().innerText()));
  await page.screenshot({ path: `${SHOTS}/21_intake_email.png`, fullPage: true });

  // the same email again is recognised as already seen
  await page.fill('#srcText', EMAIL);
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(250);
  ok('duplicate email ignored', await page.locator('.cand').count() === cands, await page.locator('.cand').count());

  // edit a title, then accept
  await page.fill('.cand .cand-t >> nth=0', 'Confirm the pool quote');
  await page.click('[data-a=candAdd] >> nth=0'); await page.waitForTimeout(300);
  const added = await page.evaluate(() => db.items.filter(i => i.src && i.src.kind === 'email').map(i => [i.title, i.area, i.due, (i.note || '').slice(0, 30)]));
  ok('accepted item keeps the edited title', added.some(a => a[0] === 'Confirm the pool quote'), added);
  ok('accepted item carries the source note', added.some(a => /From: Ahmed Khan/.test(a[3])), added);
  ok('accepted item is filed', added.every(a => a[1] === 'home'), added);

  // provenance shows in the editor
  await page.click('nav [data-v=notes]'); await page.waitForTimeout(200);
  await page.click('.row .body >> nth=0'); await page.waitForTimeout(300);
  ok('editor shows where it came from', await page.locator('.srcbox').count() === 1);
  await page.screenshot({ path: `${SHOTS}/22_provenance.png` });
  await page.click('#sheet [data-a=closeSheet]'); await page.waitForTimeout(250);

  // a calendar invite
  await page.click('nav [data-v=sources]'); await page.waitForTimeout(200);
  await page.fill('#srcText', ICS);
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(300);
  const ics = await page.evaluate(() => db.intake.map(c => [c.src.kind, c.p.title, c.p.due, c.p.time]));
  ok('ics becomes a dated suggestion', ics.some(c => c[0] === 'calendar' && c[3] === '17:00'), ics);
  await page.screenshot({ path: `${SHOTS}/23_intake_ics.png`, fullPage: true });

  // a plain list
  await page.fill('#srcText', 'buy dog shampoo from amazon\ncall DEWA tmrw commute\nlearn to sail someday');
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(300);
  const list = await page.evaluate(() => db.intake.filter(c => c.src.kind === 'file').length);
  ok('a pasted list becomes one suggestion per line', list === 3, list);

  // add all, then check the source filter in Notes
  await page.click('[data-a=candAll]'); await page.waitForTimeout(400);
  ok('intake emptied', await page.evaluate(() => db.intake.length) === 0);
  await page.click('nav [data-v=notes]'); await page.waitForTimeout(250);
  ok('source filter offered', await page.locator('[data-a=notesSrc]').count() >= 3);
  await page.click('[data-a=notesSrc][data-v=calendar]'); await page.waitForTimeout(200);
  ok('filtering by source works', await page.locator('.row').count() === 1, await page.locator('.row').count());
  await page.screenshot({ path: `${SHOTS}/24_notes_by_source.png`, fullPage: true });

  // the connect tab renders
  await page.click('nav [data-v=sources]'); await page.waitForTimeout(150);
  await page.click('[data-a=srcSeg][data-v=add]'); await page.waitForTimeout(250);
  ok('gmail card present', await page.locator('[data-a=gmailSync]').count() === 1);
  ok('fetch disabled without a client id', await page.locator('[data-a=gmailSync]').isDisabled());
  await page.click('[data-a=gmailHelp]'); await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/25_connect.png`, fullPage: true });

  // shared in through the URL
  await page.goto(URL + '?text=' + encodeURIComponent('Best toddler car seats') + '&url=' + encodeURIComponent('https://which.co.uk/car-seats'));
  await page.waitForTimeout(600);
  const shared = await page.evaluate(() => db.intake.map(c => [c.src.kind, c.p.title, c.src.url]));
  ok('share link lands in the intake', shared.some(c => c[0] === 'share' && /car seats/i.test(c[1])), shared);

  // everything survives a reload
  const before = await page.evaluate(() => [db.items.length, db.intake.length]);
  await page.reload(); await page.waitForTimeout(400);
  const after = await page.evaluate(() => [db.items.length, db.intake.length]);
  ok('saved across a reload', JSON.stringify(before) === JSON.stringify(after), { before, after });

  // nothing spills sideways on a narrow phone
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('no sideways scroll', overflow <= 0, overflow);
  await page.setViewportSize({ width: 320, height: 720 }); await page.waitForTimeout(200);
  ok('no sideways scroll at 320px', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0);
  await page.screenshot({ path: `${SHOTS}/26_narrow.png`, fullPage: true });

  await b.close();
  ok('no javascript errors', errors.length === 0, errors);
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
