"""Drives the built app in a real browser:  python3 test/ui_test.py

Headless Chromium has no voices, so a stand-in speech engine is installed
before the page loads. It behaves the way Android's does in the ways that
matter here: it fires start and end, it never reports word boundaries (so the
timing estimator is what gets exercised), and cancelling an utterance fires an
'interrupted' error on it, which is what the cancellation guards exist for.

Fails on any console error. Screenshots land in test/shots/.
Needs playwright (pip install playwright). CHROME_PATH overrides the browser.
"""
import asyncio, json, os, pathlib, sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent
APP = 'file://' + str((HERE.parent / 'index.html').resolve())
OUT = HERE / 'shots'
OUT.mkdir(exist_ok=True)
CHROME = os.environ.get('CHROME_PATH') or next(
    (p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
                 '/opt/pw-browsers/chromium/chrome-linux/chrome'] if os.path.exists(p)), None)
LAUNCH = {'executable_path': CHROME} if CHROME else {}

PORTRAIT = {'width': 412, 'height': 915}
LANDSCAPE = {'width': 915, 'height': 412}

FAKE_TTS = r"""
(() => {
  const cfg = window.__tts = { scale: %(scale)s, log: [] };
  const voices = [
    { name: 'Test Voice GB', lang: 'en-GB', voiceURI: 'gb', default: true,  localService: true },
    { name: 'Test Voice US', lang: 'en-US', voiceURI: 'us', default: false, localService: true },
    { name: 'Test Arabic',   lang: 'ar-XA', voiceURI: 'ar', default: false, localService: true },
  ];
  const Q = []; let cur = null, tStart = null, tEnd = null;
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices() { return voices.slice(); },
    speak(u) { Q.push(u); next(); },
    cancel() {
      Q.length = 0;
      if (cur) {
        clearTimeout(tStart); clearTimeout(tEnd);
        const u = cur; cur = null; synth.speaking = false;
        setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0);
      }
    },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  function next() {
    if (cur || !Q.length) return;
    cur = Q.shift(); synth.speaking = true;
    const u = cur;
    tStart = setTimeout(() => {
      if (cur !== u) return;
      if (u.text.trim()) cfg.log.push({ text: u.text, rate: u.rate, pitch: u.pitch, at: performance.now() });
      u.onstart && u.onstart({});
      const dur = Math.max(60, u.text.length * cfg.scale / (u.rate || 1));
      tEnd = setTimeout(() => {
        if (cur !== u) return;
        cur = null; synth.speaking = false;
        u.onend && u.onend({});
        next();
      }, dur);
    }, 25);
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) {
    this.text = String(text); this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; this.lang = '';
  };
})();
"""

SEED = r"""
(() => {
  const seed = %(seed)s;
  try {
    Object.keys(seed).forEach(k => {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, seed[k]);
    });
  } catch (e) {}
})();
"""

failures = []
def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        failures.append(msg)


async def open_app(browser, viewport=PORTRAIT, scale=8, settings=None, text=None, extra=None):
    ctx = await browser.new_context(viewport=viewport, has_touch=True)
    seed = {}
    s = {'immersive': False}
    s.update(settings or {})
    seed['clearread.settings.v2'] = json.dumps(s)
    if text is not None:
        seed['clearread.text'] = text
    seed.update(extra or {})
    await ctx.add_init_script(FAKE_TTS % {'scale': scale})
    await ctx.add_init_script(SEED % {'seed': json.dumps(seed)})
    page = await ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    await page.goto(APP)
    await page.wait_for_timeout(400)
    return ctx, page, errors


async def spoken(page):
    return await page.evaluate('window.__tts.log.slice()')

async def counter(page):
    return (await page.text_content('#counter')).strip()

async def pos(page):
    return int(await page.get_attribute('#counter', 'data-i'))

async def open_rail(page):
    if not await page.evaluate("document.getElementById('rail').classList.contains('is-open')"):
        await page.click('#settingsBtn')
        await page.wait_for_timeout(250)

async def close_rail(page):
    await page.click('#railClose')
    await page.wait_for_timeout(250)


# ---------------------------------------------------------------- scenarios

async def t_load(browser):
    print('load')
    ctx, page, errors = await open_app(browser)
    check(await pos(page) == 1, 'counter shows the first sentence')
    closed_rail = await page.evaluate("getComputedStyle(document.getElementById('rail')).visibility")
    check(closed_rail == 'hidden', 'the closed settings panel is not reachable by touch or focus')
    folded = not await page.is_visible('#pitch')
    check(folded, 'less-used settings start folded away')
    n = await page.evaluate("document.querySelectorAll('.s').length")
    check(n >= 8, f'sample passage rendered ({n} sentences)')
    wide = await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    await page.evaluate("window.scrollTo(300, 0)")
    panned = await page.evaluate("scrollX")
    check(wide and panned == 0, f'no sideways scroll at phone width (panned {panned}px)')
    await page.screenshot(path=str(OUT / 'portrait.png'))
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_play_advance(browser):
    print('play and advance')
    ctx, page, errors = await open_app(browser)
    await page.click('#playBtn')
    await page.wait_for_function("window.__tts.log.length >= 1", timeout=5000)
    log = await spoken(page)
    check(abs(log[0]['rate'] - 0.85) < 0.001, f"reads at the set speed ({log[0]['rate']:.3f})")
    saw_word = False
    for _ in range(20):
        if await page.evaluate("!!document.querySelector('.word.is-current')"):
            saw_word = True; break
        await page.wait_for_timeout(50)
    check(saw_word, 'a word is highlighted while speaking')
    await page.wait_for_function("document.getElementById('counter').dataset.i === '2'", timeout=8000)
    check(True, 'advances to sentence 2 by itself')
    await page.click('#playBtn')                                  # pause
    await page.wait_for_timeout(300)
    lbl = (await page.text_content('#playLbl')).strip()
    check(lbl in ('Continue', 'Read'), f'pause stops reading (button says {lbl!r})')
    before = len(await spoken(page))
    await page.wait_for_timeout(1500)
    check(len(await spoken(page)) == before, 'nothing more is spoken after pause')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_repeat_ladder(browser):
    print('repeat steps slower')
    ctx, page, errors = await open_app(browser, settings={'mode': 'step'})
    rates = []
    for _ in range(4):
        n = len(await spoken(page))
        await page.click('#repeatBtn')
        await page.wait_for_function(f"window.__tts.log.length > {n}", timeout=5000)
        rates.append((await spoken(page))[-1]['rate'])
        await page.wait_for_timeout(100)
    want = [0.85 * 0.85, 0.85 * 0.72, 0.85 * 0.62, 0.85 * 0.62]
    check(all(abs(a - b) < 0.002 for a, b in zip(rates, want)),
          'Again goes 0.85, 0.72, 0.62, then holds: ' + ', '.join(f'{r:.3f}' for r in rates))
    check('slower' in await counter(page), 'counter says the repeat is slowed')
    await page.wait_for_function("document.getElementById('playLbl').textContent !== 'Pause'", timeout=8000)
    n = len(await spoken(page))
    await page.click('#nextBtn')
    await page.click('#playBtn')
    await page.wait_for_function(f"window.__tts.log.length > {n}", timeout=5000)
    r = (await spoken(page))[-1]['rate']
    check(abs(r - 0.85) < 0.002, f'moving on resets to the set speed ({r:.3f})')
    check('slower' not in await counter(page), 'and the counter stops saying slower')
    cal = json.loads(await page.evaluate("localStorage.getItem('clearread.cal') || '{}'"))
    samples = sum(v.get('n', 0) for v in cal.values())
    check(samples <= 1, f'slowed repeats are kept out of the timing calibration ({samples} sample(s) learned)')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_listen_first(browser):
    print('listen first')
    ctx, page, errors = await open_app(browser, settings={'listenFirst': True})
    v0 = await page.evaluate("document.querySelector('.s[data-i=\"0\"]').classList.contains('is-veiled')")
    v3 = await page.evaluate("document.querySelector('.s[data-i=\"3\"]').classList.contains('is-veiled')")
    check(v0 and v3, 'current and later sentences are veiled')
    check(await page.is_visible('#showBtn'), 'Show button appears')
    await page.click('#playBtn')
    await page.wait_for_function("window.__tts.log.length >= 1", timeout=5000)
    await page.wait_for_timeout(3000)
    check(await pos(page) == 1, 'does not run ahead while veiled')
    n = len(await spoken(page))
    await page.click('.s[data-i="0"]')
    await page.wait_for_timeout(400)
    v0 = await page.evaluate("document.querySelector('.s[data-i=\"0\"]').classList.contains('is-veiled')")
    check(not v0, 'tapping the veiled sentence reveals it')
    check(len(await spoken(page)) == n, 'and does not start speech')
    await page.click('#nextBtn')
    await page.wait_for_timeout(200)
    v1 = await page.evaluate("document.querySelector('.s[data-i=\"1\"]').classList.contains('is-veiled')")
    v0 = await page.evaluate("document.querySelector('.s[data-i=\"0\"]').classList.contains('is-veiled')")
    check(v1 and not v0, 'next sentence veiled, the heard one stays readable')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_immersive(browser):
    print('immersive')
    ctx, page, errors = await open_app(browser, settings={'immersive': True})
    await page.wait_for_timeout(5600)
    hid = await page.evaluate("document.querySelector('.app').classList.contains('immersive')")
    check(hid, 'controls hide after five seconds untouched')
    check(not await page.is_visible('#playBtn'), 'transport is gone')
    await page.screenshot(path=str(OUT / 'immersive.png'))
    n = len(await spoken(page))
    await page.click('.s[data-i="3"]')
    await page.wait_for_timeout(400)
    hid = await page.evaluate("document.querySelector('.app').classList.contains('immersive')")
    check(not hid, 'a tap brings the controls back')
    check(await pos(page) == 1, 'and that tap did not jump sentences')
    check(len(await spoken(page)) == n, 'nor start speech')
    await page.wait_for_timeout(600)
    await page.click('.s[data-i="3"]')
    await page.wait_for_timeout(400)
    check(await pos(page) == 4, 'a second tap does jump')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_settings_close(browser):
    print('settings panel closes')
    ctx, page, errors = await open_app(browser)
    await open_rail(page)
    check(await page.is_visible('#scrim'), 'scrim appears behind the panel')
    await page.screenshot(path=str(OUT / 'settings.png'))
    await page.mouse.click(12, 400)
    await page.wait_for_timeout(300)
    open_ = await page.evaluate("document.getElementById('rail').classList.contains('is-open')")
    check(not open_, 'tapping off the panel closes it')
    check(not await page.is_visible('#scrim'), 'and removes the scrim')
    await open_rail(page)
    await page.keyboard.press('Escape')
    await page.wait_for_timeout(300)
    open_ = await page.evaluate("document.getElementById('rail').classList.contains('is-open')")
    check(not open_, 'Escape closes it')
    await open_rail(page)
    await close_rail(page)
    open_ = await page.evaluate("document.getElementById('rail').classList.contains('is-open')")
    check(not open_, 'Done closes it')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


LONG = ' '.join([
    "The committee met on Thursday morning to review the proposal in detail and agreed that the timetable was ambitious but achievable if every department delivered its share on time.",
    "Several members asked whether the budget would stretch to cover the additional training that staff would need during the first three months of the new arrangements.",
    "After a long discussion the chair proposed that a smaller working group should meet each fortnight and report back to the full committee before the end of the year.",
    "Everyone present agreed to the proposal and the meeting closed shortly before lunch with a short vote of thanks to the officers who had prepared the papers.",
])

async def follow_scroll(browser, viewport, size, label, settings=None):
    s = {'size': size, 'rate': 1.4, 'mode': 'continuous', 'pause': 200}
    s.update(settings or {})
    ctx, page, errors = await open_app(browser, viewport=viewport, scale=54, settings=s, text=LONG)
    await page.click('#playBtn')
    await page.wait_for_function("window.__tts.log.length >= 1", timeout=5000)
    worst = run = samples = out = 0
    for _ in range(140):
        r = await page.evaluate("""() => {
          const w = document.querySelector('.word.is-current'), rd = document.getElementById('reader');
          if (!w) return null;
          const a = w.getBoundingClientRect(), b = rd.getBoundingClientRect();
          return { out: a.bottom > b.bottom + 2 || a.top < b.top - 2 };
        }""")
        if r is not None:
            samples += 1
            if r['out']:
                out += 1; run += 1; worst = max(worst, run)
            else:
                run = 0
        await page.wait_for_timeout(100)
    await page.screenshot(path=str(OUT / f'scroll-{label}.png'))
    check(samples > 20, f'{label}: highlight sampled {samples} times')
    check(worst <= 4, f'{label}: highlighted word off screen {out}/{samples} samples, longest {worst * 100} ms')
    check(not errors, f'{label}: no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()

async def t_scroll(browser):
    print('the view follows the spoken word')
    await follow_scroll(browser, LANDSCAPE, 46, 'landscape-46px')
    await follow_scroll(browser, PORTRAIT, 46, 'portrait-46px')
    await follow_scroll(browser, LANDSCAPE, 46, 'landscape-listen-first', settings={'listenFirst': True, 'mode': 'continuous'})


async def t_word_marker_off(browser):
    print('word highlight off')
    s = {'size': 46, 'rate': 1.4, 'mode': 'continuous', 'pause': 200, 'wordHl': False}
    ctx, page, errors = await open_app(browser, viewport=LANDSCAPE, scale=54, settings=s, text=LONG)
    await page.click('#playBtn')
    await page.wait_for_function("window.__tts.log.length >= 1", timeout=5000)
    marked = False
    top0 = await page.evaluate("document.getElementById('reader').scrollTop")
    for _ in range(60):
        if await page.evaluate("!!document.querySelector('.word.is-current')"):
            marked = True
        await page.wait_for_timeout(100)
    top1 = await page.evaluate("document.getElementById('reader').scrollTop")
    check(not marked, 'no word is marked')
    check(top1 > top0 + 40, f'but the view still follows the reading (scrolled {top1 - top0:.0f}px)')
    band = await page.evaluate("!!document.querySelector('.s.is-current')")
    check(band, 'and the sentence band is still shown')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_paste(browser):
    print('paste in one tap')
    ctx, page, errors = await open_app(browser)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate("navigator.clipboard.writeText('Hello there. This came from the clipboard.')")
    await page.click('#textBtn')
    await page.wait_for_timeout(600)
    txt = await page.text_content('#doc')
    check('clipboard' in txt, 'Paste reads the clipboard straight in')
    check('/ 2' in await counter(page), 'and splits it into two sentences')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_accent(browser):
    print('accent practice')
    ctx, page, errors = await open_app(browser, settings={'accent': 'light'})
    await page.click('#playBtn')
    await page.wait_for_function("window.__tts.log.length >= 1", timeout=5000)
    said = (await spoken(page))[0]['text']
    shown = await page.text_content('.s[data-i="0"]')
    check('brocessor' in said, 'the voice gets the respelling')
    check('processor' in shown and 'brocessor' not in shown, 'the screen keeps ordinary English')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_persist(browser):
    print('comes back as it was left')
    ctx, page, errors = await open_app(browser, text=LONG)
    await page.evaluate("""() => { const r = document.getElementById('rate'); r.value = '1.1';
                                   r.dispatchEvent(new Event('input')); }""")
    await page.click('.s[data-i="2"]')
    await page.wait_for_timeout(300)
    await page.click('#playBtn')
    await page.wait_for_timeout(200)
    await page.reload()
    await page.wait_for_timeout(500)
    v = await page.evaluate("document.getElementById('rate').value")
    check(v == '1.1', f'speed survives a reload ({v})')
    check('committee' in await page.text_content('#doc'), 'text survives a reload')
    c = await pos(page)
    check(c == 3, f'position survives a reload (sentence {c})')
    lbl = (await page.text_content('#playLbl')).strip()
    check(lbl == 'Continue', f'and the button offers to continue ({lbl!r})')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def t_large_doc(browser):
    print('a long document')
    big = ' '.join(['This is sentence number %d of a very long document, and it keeps going for a while.' % i
                    for i in range(1, 3001)])
    ctx, page, errors = await open_app(browser, text=None)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate("t => navigator.clipboard.writeText(t)", big)
    t0 = await page.evaluate('performance.now()')
    await page.click('#textBtn')
    await page.wait_for_function("document.querySelectorAll('.s').length > 2000", timeout=20000)
    t1 = await page.evaluate('performance.now()')
    check(True, f'{len(big):,} characters loaded in {t1 - t0:.0f} ms')
    await page.reload()
    await page.wait_for_timeout(800)
    n = await page.evaluate("document.querySelectorAll('.s').length")
    check(n >= 3000, f'all of it is still there after a reload ({n} sentences)')
    c = await counter(page)
    check('min left' in c, f'says how long it will take ({c!r})')
    check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors)))
    await ctx.close()


async def main():
    only = sys.argv[1:]
    tests = [t_load, t_play_advance, t_repeat_ladder, t_listen_first, t_immersive,
             t_settings_close, t_scroll, t_word_marker_off, t_paste, t_accent, t_persist, t_large_doc]
    async with async_playwright() as p:
        browser = await p.chromium.launch(**LAUNCH)
        for t in tests:
            if only and t.__name__ not in only:
                continue
            try:
                await t(browser)
            except Exception as e:
                check(False, f'{t.__name__} crashed: {e}')
        await browser.close()
    print()
    print('%d failure(s)' % len(failures) if failures else 'all passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
