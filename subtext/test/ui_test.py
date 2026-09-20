"""Drives the built app in a real browser:  python3 test/ui_test.py

Walks the paths a person actually takes — open subtitles, edit a cue, split it,
merge it back, change the limits, export the file, open an audio file, come back
after a reload — and fails on any console error along the way. Screenshots land
in test/shots/.

Needs playwright (pip install playwright). CHROME_PATH overrides the browser.
"""
import asyncio, os, pathlib, struct, sys, wave
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent
APP = 'file://' + str((HERE.parent / 'index.html').resolve())
OUT = HERE / 'shots'
TMP = HERE / 'tmp'
CHROME = os.environ.get('CHROME_PATH') or next(
    (p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
                 '/opt/pw-browsers/chromium/chrome-linux/chrome'] if os.path.exists(p)), None)
LAUNCH = {'executable_path': CHROME} if CHROME else {}

OUT.mkdir(exist_ok=True)
TMP.mkdir(exist_ok=True)

SRT = """1
00:00:01,000 --> 00:00:03,200
The harbour was empty by then.

2
00:00:03,600 --> 00:00:06,000
Every boat had gone out on the tide before dawn, which was the whole point of it.

3
00:00:07,000 --> 00:00:09,500
Nobody had told the one man
who needed telling.
"""
(TMP / 'sample.srt').write_text(SRT, encoding='utf-8')

# A four-second tone, so there is something with a real duration to open.
with wave.open(str(TMP / 'sample.wav'), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    frames = bytearray()
    for i in range(16000 * 4):
        frames += struct.pack('<h', int(8000 * ((i % 200) / 100 - 1)))
    w.writeframes(bytes(frames))

problems = []
checks = {'pass': 0, 'fail': 0}


def ok(name, cond, detail=''):
    if cond:
        checks['pass'] += 1
    else:
        checks['fail'] += 1
        print('FAIL  ' + name + (('\n      ' + str(detail)) if detail else ''))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH)
        ctx = await b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2,
                                  accept_downloads=True, has_touch=True)
        page = await ctx.new_page()
        page.on('console', lambda m: problems.append('console: ' + m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: problems.append('pageerror: ' + str(e)))

        await page.goto(APP)
        await page.wait_for_timeout(300)
        ok('opens on the empty state', await page.locator('#empty').is_visible())
        ok('the transport is hidden until there is a file', await page.locator('#transport').is_hidden())
        ok('nothing to fix or export yet, so neither is offered',
           await page.locator('#fixBtn2').is_hidden() and await page.locator('#exportBtn').is_hidden())
        await page.screenshot(path=f'{OUT}/01_empty.png')

        # ---- read an existing subtitle file ----
        await page.locator('#subsFile').set_input_files(str(TMP / 'sample.srt'))
        await page.wait_for_timeout(300)
        rows = page.locator('.cue')
        ok('three cues read from the srt', await rows.count() == 3, await rows.count())
        counts = await page.locator('#counts').inner_text()
        ok('the strip counts them', '3 cues' in counts, counts)
        ok('the over-long cue is flagged', 'fast' in counts or 'over-wide' in counts, counts)
        await page.screenshot(path=f'{OUT}/02_cues.png', full_page=True)

        # The second cue is far too much text for its two and a half seconds.
        second = await rows.nth(1).inner_text()
        ok('a long cue is laid out over more than one line', '\n' in second.strip(), repr(second))

        # ---- select, edit, split, merge ----
        await rows.nth(1).click()
        await page.wait_for_timeout(150)
        ok('selecting a cue shows its controls', await page.locator('.cue.is-sel .acts').count() == 1)
        ok('its in and out times are editable', await page.locator('.cue.is-sel .stamp').count() == 2)
        await page.screenshot(path=f'{OUT}/03_selected.png')

        await page.locator('.cue.is-sel [data-a=edit]').click()
        await page.wait_for_timeout(150)
        ta = page.locator('.cue.is-sel textarea')
        ok('editing opens a text box', await ta.count() == 1)
        await ta.fill('Every boat had gone out on the tide.')
        await page.wait_for_timeout(200)

        await page.locator('.cue.is-sel [data-a=split]').click()
        await page.wait_for_timeout(200)
        ok('split makes a fourth cue', await rows.count() == 4, await rows.count())
        texts = [await rows.nth(i).inner_text() for i in range(4)]
        ok('the split kept every word', 'tide' in ' '.join(texts), texts)

        await rows.nth(1).click()
        await page.wait_for_timeout(120)
        await page.locator('.cue.is-sel [data-a=merge]').click()
        await page.wait_for_timeout(200)
        ok('merge puts it back to three', await rows.count() == 3, await rows.count())

        # ---- typing a timestamp by hand ----
        await rows.nth(0).click()
        await page.wait_for_timeout(120)
        await page.locator('.cue.is-sel .stamp').first.fill('00:00:00.500')
        await page.locator('.cue.is-sel .stamp').first.dispatch_event('change')
        await page.wait_for_timeout(200)
        head = await rows.nth(0).inner_text()
        ok('a typed in-time is taken', '0:00.5' in head, head)

        # ---- the limits ----
        await page.locator('#settingsBtn').click()
        await page.wait_for_timeout(250)
        await page.locator('[data-profile=easy]').click()
        await page.wait_for_timeout(250)
        ok('the fine tuning starts folded away',
           await page.locator('#maxChars').is_hidden())
        await page.locator('details.fold summary', has_text='Fine tuning').click()
        await page.wait_for_timeout(200)
        ok('the easy-read profile narrows the lines',
           await page.locator('#maxCharsVal').inner_text() == '32',
           await page.locator('#maxCharsVal').inner_text())
        await page.screenshot(path=f'{OUT}/04_settings.png')
        await page.locator('details.fold summary', has_text='Sync the whole file').click()
        await page.wait_for_timeout(200)
        await page.locator('[data-shift="0.1"]').click()
        await page.wait_for_timeout(200)
        ok('a shift moves everything', '+0.1' in await page.locator('#shiftVal').inner_text(),
           await page.locator('#shiftVal').inner_text())
        await page.locator('#railClose').click()
        await page.wait_for_timeout(200)

        await page.locator('#fixBtn').click()
        await page.wait_for_timeout(200)
        await page.locator('#reflowBtn').click()
        await page.wait_for_timeout(200)
        ok('still three cues after tidying', await rows.count() == 3, await rows.count())

        # ---- export ----
        await page.locator('#exportBtn').click()
        await page.wait_for_timeout(250)
        srt = await page.locator('#out').input_value()
        # 0.5 s was typed into the first cue, then everything was shifted +0.1.
        ok('exports srt with a comma in the stamp, and the shift in the numbers',
           srt.startswith('1\n00:00:00,600 --> '), srt[:80])
        ok('exports every cue', srt.strip().split('\n\n').__len__() == 3, srt)
        await page.screenshot(path=f'{OUT}/05_export.png')
        await page.locator('[data-fmt=vtt]').click()
        await page.wait_for_timeout(200)
        vtt = await page.locator('#out').input_value()
        ok('exports vtt with its header', vtt.startswith('WEBVTT'), vtt[:40])
        await page.locator('[data-fmt=txt]').click()
        await page.wait_for_timeout(200)
        txt = await page.locator('#out').input_value()
        ok('the transcript has no timings', '-->' not in txt, txt[:80])

        await page.locator('[data-fmt=srt]').click()
        await page.wait_for_timeout(150)
        async with page.expect_download() as dl:
            await page.locator('#saveOut').click()
        saved = await dl.value
        ok('the download is named after the file', saved.suggested_filename.endswith('.srt'),
           saved.suggested_filename)
        await page.locator('#exportClose').click()
        await page.wait_for_timeout(150)

        # ---- open a real file, with a real duration ----
        await page.locator('#file').set_input_files(str(TMP / 'sample.wav'))
        await page.wait_for_timeout(700)
        ok('the viewer appears', await page.locator('#viewer').is_visible())
        ok('sound-only files say so', await page.locator('#soundOnly').is_visible())
        clock = await page.locator('#clock').inner_text()
        ok('the duration is read off the file', '0:04' in clock, clock)
        await page.screenshot(path=f'{OUT}/06_media.png')

        await page.locator('#playBtn').click()
        await page.wait_for_timeout(900)
        ok('play starts', await page.locator('#playLbl').inner_text() == 'Pause',
           await page.locator('#playLbl').inner_text())
        cap = await page.locator('#cap').inner_text()
        ok('the caption on the picture follows the playhead', len(cap) > 0, repr(cap))
        ok('the cue under the playhead is marked', await page.locator('.cue.is-now').count() == 1)
        await page.screenshot(path=f'{OUT}/07_playing.png')
        await page.locator('#playBtn').click()
        await page.wait_for_timeout(200)

        # In and out from the transport.
        await rows.nth(2).click()
        await page.wait_for_timeout(150)
        before = await rows.nth(2).inner_text()
        await page.locator('#markIn').click()
        await page.wait_for_timeout(250)
        ok('in = now moves the cue', before != await page.locator('.cue.is-sel').inner_text())

        # ---- the transcribe panel ----
        await page.locator('#transBtn').click()
        await page.wait_for_timeout(250)
        ok('the free on-device route is the one in front of you',
           await page.locator('#routeWhisper').is_visible())
        ok('the paid one is there but folded away',
           await page.locator('#routeCloud').is_visible()
           and await page.locator('#provider').is_hidden())
        await page.locator('#routeCloud summary').click()
        await page.wait_for_timeout(200)
        ok('and opens when asked for', await page.locator('#provider').is_visible())
        await page.locator('#provider').select_option('custom')
        await page.wait_for_timeout(200)
        ok('a custom service asks for its URL', await page.locator('#customGrp').is_visible())
        await page.screenshot(path=f'{OUT}/08_transcribe.png', full_page=True)
        ok('whisper is offered as a third route', await page.locator('#routeWhisper').is_visible())
        models = await page.locator('#wModel option').count()
        ok('with models to choose from', models >= 3, models)

        # The model is fetched from a CDN, which is not reachable in a test (nor
        # on a train). What matters here is that it fails like a tool and not
        # like a hang: a message, and the button back where it was.
        await page.locator('#wGo').scroll_into_view_if_needed()
        await page.locator('#wGo').click()
        try:
            await page.wait_for_selector('#transOv .panelmsg:visible', timeout=45000)
            ok('an unreachable model is reported, not hung', True)
            msg = await page.locator('#transOv .panelmsg').inner_text()
            ok('and the message says what to do about it',
               'download' in msg.lower() or 'connection' in msg.lower() or 'whisper' in msg.lower(), msg)
        except Exception as e:
            ok('an unreachable model is reported, not hung', False, str(e)[:120])
        ok('the start button comes back', await page.locator('#wGo').is_visible())
        ok('and the stop button goes away', await page.locator('#wStop').is_hidden())
        await page.locator('#cloudGo').click()          # no key: must complain, not crash
        await page.wait_for_timeout(300)
        ok('no key is a message, not a failure, and it is said inside the panel',
           await page.locator('#transOv .panelmsg').is_visible(), 'no message appeared')
        await page.locator('#transClose').click()
        await page.wait_for_timeout(200)

        # ---- fixing the words with Claude ----
        await page.locator('#fixBtn2').click()
        await page.wait_for_timeout(250)
        ok('the paste route is always there', await page.locator('#routeFixPaste').is_visible())
        ok('the in-page route is hidden outside Claude', await page.locator('#routeFixHere').is_hidden())
        await page.locator('#fixNotes').fill('The Traitors — a game show. Players are Traitors or Faithful.')
        await page.wait_for_timeout(200)
        batch = await page.locator('#fixBatch').inner_text()
        ok('the whole file goes in one paste', 'All 3 lines in one' in batch, batch)
        ok('with no batch stepping to do', await page.locator('#fixNext').is_hidden())
        await page.screenshot(path=f'{OUT}/10_fix.png', full_page=True)

        # The prompt itself: the notes, the rules, and numbered lines.
        prompt = await page.evaluate(
            "() => fixPrompt([{s:0,e:2,text:'The traders are among us'}], 0, 60,"
            " document.getElementById('fixNotes').value, 6)")
        ok('the prompt carries the description', 'The Traitors' in prompt, prompt[:120])
        ok('the prompt forbids retiming and renumbering', 'renumber' in prompt, prompt[:400])
        ok('the prompt numbers the lines', '1| The traders are among us' in prompt, prompt[-200:])

        # A reply pasted back changes words and nothing else.
        times_before = await page.evaluate(
            "() => Array.from(document.querySelectorAll('.cue .times')).map(e => e.textContent)")
        await page.locator('#fixReply').fill(
            'Here you go:\n\n1| The Traitors were empty by then.\n2| Every boat had gone out on the tide.')
        await page.locator('#fixApplyBtn').click()
        await page.wait_for_timeout(350)
        ok('the change is listed for review', await page.locator('.chg').count() >= 1,
           await page.locator('.chg').count())
        first = await page.locator('.cue').nth(0).inner_text()
        ok('the corrected words are in the cue', 'Traitors' in first, first)
        times_after = await page.evaluate(
            "() => Array.from(document.querySelectorAll('.cue .times')).map(e => e.textContent)")
        ok('not one timing moved', times_before == times_after, f'{times_before} → {times_after}')

        await page.locator('.chg [data-revert]').first.click()
        await page.wait_for_timeout(250)
        ok('a single change can be put back',
           'Traitors' not in await page.locator('.cue').nth(0).inner_text())

        await page.locator('#fixReply').fill('1| The Traitors were empty by then.')
        await page.locator('#fixApplyBtn').click()
        await page.wait_for_timeout(300)
        await page.locator('#fixUndo').click()
        await page.wait_for_timeout(300)
        ok('undo puts everything back',
           'Traitors' not in await page.locator('.cue').nth(0).inner_text())
        ok('and the review list empties', await page.locator('.chg').count() == 0)

        # A reply that is not in the format must not silently do anything.
        await page.locator('#fixReply').fill('I am afraid I cannot do that.')
        await page.locator('#fixApplyBtn').click()
        await page.wait_for_timeout(250)
        ok('a useless reply says so rather than changing things',
           await page.locator('#fixOv .panelmsg').is_visible())
        await page.locator('#fixClose').click()
        await page.wait_for_timeout(200)

        # ---- the work survives a reload ----
        await page.reload()
        await page.wait_for_timeout(500)
        ok('the cues come back', await page.locator('.cue').count() == 3, await page.locator('.cue').count())
        ok('and it says why there is no picture', await page.locator('#status').is_visible())
        await page.screenshot(path=f'{OUT}/09_reloaded.png')

        # ---- the first thing to do with a fresh file ----
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await page.locator('#settingsBtn').click()
        await page.wait_for_timeout(200)
        await page.locator('#clearBtn').click()
        await page.wait_for_timeout(400)
        ok('starting again empties the list', await page.locator('.cue').count() == 0)
        await page.locator('#file').set_input_files(str(TMP / 'sample.wav'))
        await page.wait_for_timeout(700)
        ok('a file with no cues offers the one thing to do next',
           await page.locator('#start').is_visible())
        await page.screenshot(path=f'{OUT}/11_next_step.png')
        await page.locator('#startBtn').click()
        await page.wait_for_timeout(300)
        ok('and it opens the transcribe panel', await page.locator('#transOv').is_visible())
        await page.locator('#transClose').click()
        await page.wait_for_timeout(200)

        await b.close()

    for e in problems:
        print('ERROR ' + e)
    ok('no console or page errors', not problems, problems)
    print(f"{checks['pass']}/{checks['pass'] + checks['fail']} passed")
    return 1 if checks['fail'] else 0


sys.exit(asyncio.run(main()))
