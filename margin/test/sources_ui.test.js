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

  // paste an email → filed straight away (the default)
  await page.fill('#srcText', EMAIL);
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(300);
  const added = await page.evaluate(() => db.items.filter(i => i.src && i.src.kind === 'email').map(i => [i.title, i.area, i.due, (i.note || ''), !!i.fresh, i.src.from]));
  ok('email filed itself', added.length >= 1, added);
  ok('filed item remembers the sender', added.every(a => /Ahmed Khan/.test(a[5])), added);
  ok('filed item keeps the useful facts', added.some(a => /AED 4,500/.test(a[3]) && /PW-88213/.test(a[3])), added.map(a => a[3]));
  ok('filed item is filed into an area', added.every(a => a[1] === 'home'), added);
  ok('filed item is marked as new', added.every(a => a[4]), added);
  ok('"just arrived" section shown', /just arrived/i.test(await page.locator('#main').innerText()));
  ok('arrivals offer keep / change / bin', await page.locator('[data-a=freshKeep]').count() >= 1);
  await page.screenshot({ path: `${SHOTS}/21_intake_email.png`, fullPage: true });

  // the same email again is not read twice
  const n1 = await page.evaluate(() => db.items.length);
  await page.fill('#srcText', EMAIL);
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(250);
  ok('duplicate email ignored', await page.evaluate(() => db.items.length) === n1, await page.evaluate(() => db.items.length));

  // the new mark can be cleared
  await page.click('[data-a=freshClear]'); await page.waitForTimeout(250);
  ok('marks cleared', await page.evaluate(() => db.items.every(i => !i.fresh)));

  // provenance shows in the editor
  await page.click('[data-v=search]'); await page.waitForTimeout(200);
  await page.click('.row .body >> nth=0'); await page.waitForTimeout(300);
  ok('editor shows where it came from', await page.locator('.srcbox').count() === 1);
  await page.screenshot({ path: `${SHOTS}/22_provenance.png` });
  await page.click('#sheet [data-a=closeSheet]'); await page.waitForTimeout(250);

  // a calendar invite
  await page.click('nav [data-v=sources]'); await page.waitForTimeout(200);
  await page.fill('#srcText', ICS);
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(300);
  const ics = await page.evaluate(() => db.items.filter(i => i.src && i.src.kind === 'calendar').map(i => [i.title, i.due, i.time]));
  ok('ics becomes a dated item', ics.some(c => c[2] === '17:00'), ics);
  await page.screenshot({ path: `${SHOTS}/23_intake_ics.png`, fullPage: true });

  // a plain list
  await page.fill('#srcText', 'buy dog shampoo from amazon\ncall DEWA tmrw commute\nlearn to sail someday');
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(300);
  const list = await page.evaluate(() => db.items.filter(i => i.src && i.src.kind === 'file').length);
  ok('a pasted list becomes one item per line', list === 3, list);

  // the source filter in Notes
  await page.click('[data-v=search]'); await page.waitForTimeout(250);
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
  const shared = await page.evaluate(() => db.items.filter(i => i.src && i.src.kind === 'share').map(i => [i.title, i.src.url]));
  ok('share link is filed', shared.some(c => /car seats/i.test(c[0])), shared);

  // with auto-filing off, things wait for a yes or no
  await page.evaluate(() => { S().sources.autoFile = false; save(); ui.view = 'sources'; ui.srcSeg = 'in'; render(); });
  await page.fill('#srcText', 'ring the vet about the booking on friday');
  await page.click('[data-a=srcScan]'); await page.waitForTimeout(300);
  ok('suggestion waits when auto-filing is off', await page.locator('.cand').count() === 1, await page.locator('.cand').count());
  await page.fill('.cand .cand-t >> nth=0', 'Ring the vet');
  await page.click('[data-a=candAdd] >> nth=0'); await page.waitForTimeout(300);
  ok('edited title is kept on Add', await page.evaluate(() => db.items.some(i => i.title === 'Ring the vet')));
  await page.evaluate(() => { S().sources.autoFile = true; save(); });

  // finishing something must not put it out of reach
  await page.evaluate(() => { const i = db.items.find(x => x.status === 'open' && !x.expiry && !x.recur); complete(i.id, true); render(); });
  await page.click('[data-v=search]'); await page.waitForTimeout(250);
  await page.click('[data-a=notesMode][data-v=done]'); await page.waitForTimeout(250);
  ok('finished items are listed', await page.locator('.row').count() >= 1, await page.locator('.row').count());
  await page.click('.row .body >> nth=0'); await page.waitForTimeout(300);
  ok('a finished item still opens', await page.locator('#sheet [data-a=reopen]').count() === 1);
  await page.click('#sheet [data-a=reopen]'); await page.waitForTimeout(300);
  ok('and can be put back', await page.evaluate(() => db.items.some(i => i.status === 'open')));
  await page.click('#sheet [data-a=closeSheet]').catch(() => { }); await page.waitForTimeout(200);

  // the export Claude can read
  const dump = await page.evaluate(() => claudeDump());
  ok('claude export has the headings', /# Margin/.test(dump) && /## Snapshot/.test(dump) && /## Overdue/.test(dump));
  ok('claude export names sources', /from email/.test(dump), dump.slice(0, 400));
  ok('claude export includes the done log section', /Finished, last 90 days/.test(dump));

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
