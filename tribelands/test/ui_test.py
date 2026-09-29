"""Drives the built game in a real browser:  python3 test/ui_test.py

Starts a game through the menus, moves and trains through the panel, runs
computer turns, checks undo, autosave and resume, and fails on any console
error. Screenshots land in test/shots/.
Needs playwright (pip install playwright). CHROME_PATH overrides the browser.
"""
import asyncio, os, pathlib, sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent
APP = 'file://' + str((HERE.parent / 'index.html').resolve())
OUT = HERE / 'shots'
OUT.mkdir(exist_ok=True)
CHROME = os.environ.get('CHROME_PATH') or next(
    (p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
                 '/opt/pw-browsers/chromium/chrome-linux/chrome'] if os.path.exists(p)), None)
LAUNCH = {'executable_path': CHROME} if CHROME else {}
PHONE = {'width': 412, 'height': 915}

fails = []
def ok(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond: fails.append(what)

async def settle(page):
    """Answers whatever sheet the game put up: rewards, events, peace offers."""
    for _ in range(8):
        if await page.is_hidden('#modal'): return
        if await page.is_visible('.reward'): await page.click('.reward')
        elif await page.is_visible('[data-o="no"]'): await page.click('[data-o="no"]')
        elif await page.is_visible('#sheet [data-x].big'): await page.click('#sheet [data-x].big')
        else: return
        await page.wait_for_timeout(150)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(**LAUNCH)
        ctx = await b.new_context(viewport=PHONE, device_scale_factor=2, has_touch=True)
        page = await ctx.new_page()
        errors = []
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(APP)
        await page.wait_for_timeout(600)
        await page.screenshot(path=str(OUT / '01-title.png'))
        ok(await page.is_visible('#tNew'), 'title shows New game')
        ok('v23' in await page.inner_text('#tver'), 'version shown on title')

        await page.click('#tNew')
        await page.click('[data-tribe="2"]')
        await page.click('[data-seg="opponents"] [data-v="4"]')
        ok('Lord of the Flies' in await page.inner_text('#sheet .story'), 'picker shows the tribe’s story')
        await page.click('[data-seg="opponents"] [data-v="2"]')
        await page.click('[data-seg="size"] [data-v="small"]')
        await page.screenshot(path=str(OUT / '02-newgame.png'))
        await page.click('#startGame')
        await page.wait_for_timeout(500)
        ok(await page.is_visible('#hud'), 'HUD visible in game')
        ok(await page.evaluate('Tribelands.S.players[0].tribe') == 2, 'playing as The Choir')
        await settle(page)
        await page.evaluate("document.querySelector('#toast').classList.remove('show')")
        await page.screenshot(path=str(OUT / '03-start.png'))

        # select our starting unit by tapping its tile on screen
        ux, uy = await page.evaluate('[Tribelands.S.units.find(u=>u.owner===0).x, Tribelands.S.units.find(u=>u.owner===0).y]')
        await page.evaluate(f'Tribelands.tapTile({ux},{uy})')
        await page.wait_for_timeout(100)
        dests = await page.evaluate('[...Tribelands.moveInfo(Tribelands.S.units.find(u=>u.owner===0)).dests]')
        ok(len(dests) > 0, f'starting unit has {len(dests)} moves')
        await page.screenshot(path=str(OUT / '04-unit-selected.png'))

        # hunt something in our land (Thane start with Hunting)
        i = await page.evaluate("Tribelands.S.tiles.findIndex((t,i)=>t.res==='boar' && t.city>=0 && Tribelands.S.cities[t.city].owner===0)")
        if i >= 0:
            await page.evaluate(f'Tribelands.select({{kind:"tile", i:{i}}})')
            stars0 = await page.evaluate('Tribelands.S.players[0].stars')
            await page.click('button[data-a="work:boar"]')
            await page.wait_for_timeout(300)
            ok(await page.evaluate('Tribelands.S.players[0].stars') == stars0 - 2, 'hunting cost 2 stars')
            ok(await page.evaluate('Tribelands.undoDepth') == 1, 'hunting is undoable')
            await page.click('#btnUndo')
            ok(await page.evaluate('Tribelands.S.players[0].stars') == stars0, 'undo restored stars')
            await page.evaluate(f'Tribelands.select({{kind:"tile", i:{i}}})')
            await page.click('button[data-a="work:boar"]')
            await page.wait_for_timeout(300)
        else:
            ok(False, 'a boar to hunt next to the first camp')

        await page.click('#btnTech')
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(OUT / '05-tech.png'))
        await page.click('.close')

        # move the unit
        await page.evaluate(f'Tribelands.tapTile({ux},{uy})')
        d = dests[0]
        n = await page.evaluate('Tribelands.S.n')
        await page.evaluate(f'Tribelands.tapTile({d % n},{d // n})')
        await page.wait_for_timeout(700)
        pos = await page.evaluate('[Tribelands.S.units.find(u=>u.owner===0).x, Tribelands.S.units.find(u=>u.owner===0).y]')
        ok(pos == [d % n, d // n], 'unit moved where tapped')

        # play some turns (computer at its normal, animated speed)
        for t in range(12):
            # a simple stand-in player: capture, train, gather, march at the nearest village
            await page.evaluate("""(async () => {
              const T = Tribelands, S = T.S;
              for (const u of S.units.filter(u => u.owner === 0)) {
                const c = S.cities.find(c => c.x === u.x && c.y === u.y && c.owner !== 0);
                if (c && !u.moved) { T.select({kind:'unit', id:u.id}); const b = document.querySelector('button[data-a="capture"]'); if (b) { b.click(); await new Promise(r=>setTimeout(r,50)); } continue; }
                const m = T.moveInfo(u); if (!m.dests.size) continue;
                const goal = S.cities.filter(c => c.owner !== 0).sort((a,b)=>Math.max(Math.abs(a.x-u.x),Math.abs(a.y-u.y))-Math.max(Math.abs(b.x-u.x),Math.abs(b.y-u.y)))[0];
                if (!goal) continue;
                let best = null, bd = 1e9;
                for (const d of m.dests) { const x = d % S.n, y = (d / S.n) | 0; const dd = Math.max(Math.abs(goal.x-x), Math.abs(goal.y-y)); if (dd < bd) { bd = dd; best = [x,y]; } }
                if (best) { T.select({kind:'unit', id:u.id}); T.tapTile(best[0], best[1]); await new Promise(r=>setTimeout(r,450)); }
              }
              for (const c of S.cities.filter(c => c.owner === 0)) {
                T.select({kind:'tile', i: c.y*S.n + c.x});
                const b = document.querySelector('button[data-a="train:scrapper"]:not(:disabled)'); if (b) { b.click(); await new Promise(r=>setTimeout(r,50)); }
              }
              T.select(null);
            })()""")
            await settle(page)
            if await page.evaluate('!!Tribelands.S.over'): break
            await page.click('#btnEnd')
            await page.wait_for_function('!Tribelands.busy', timeout=30000)
            await page.wait_for_timeout(200)
            await settle(page)
        turn = await page.evaluate('Tribelands.S.turn')
        ok(turn >= 8 or await page.evaluate('!!Tribelands.S.over'), f'reached turn {turn}')
        await page.evaluate("document.querySelector('#toast').classList.remove('show')")
        await page.screenshot(path=str(OUT / '06-midgame.png'))
        mine = await page.evaluate('Tribelands.S.cities.filter(c=>c.owner===0).length')
        print(f'  info  turn {turn}, our cities {mine}, units {await page.evaluate("Tribelands.S.units.length")}')

        if await page.evaluate('!!Tribelands.S.over'):
            ok(await page.evaluate('!!Tribelands.S.overShown'), 'game-over sheet shown')
            if await page.is_visible('text=Look at the map'):
                await page.screenshot(path=str(OUT / '06b-gameover.png'))
                await page.click('text=Look at the map')

        # a city panel
        c = await page.evaluate('(()=>{const c=Tribelands.S.cities.find(c=>c.owner===0); return c ? c.y*Tribelands.S.n+c.x : -1})()')
        if c >= 0:
            await page.evaluate(f'Tribelands.select({{kind:"tile", i:{c}}})')
            await page.screenshot(path=str(OUT / '07-city.png'))

        # autosave + resume
        await page.reload()
        await page.wait_for_timeout(500)
        ok(await page.is_visible('#tContinue') or await page.evaluate("!!JSON.parse(localStorage.getItem('tribelands-save-v1')).over"), 'Continue offered after reload')
        if await page.is_visible('#tContinue'):
            await page.click('#tContinue')
            await page.wait_for_timeout(300)
            ok(await page.evaluate('Tribelands.S.turn') == turn, 'resumed on the same turn')

        # the new sheets: stars, tribes (with a truce), tech details, wonders, events
        await page.evaluate("document.querySelector('#modal').hidden || document.querySelector('[data-x]')?.click()")
        await page.click('#btnStars')
        ok('earn' in await page.inner_text('#sheet'), 'income sheet explains shells')
        await page.screenshot(path=str(OUT / '08a-income.png'))
        await page.click('.close')
        await page.evaluate("(()=>{const S=Tribelands.S; S.players[0].techs.diplomacy=true; S.players[0].stars+=40;})()")
        await page.click('#btnTribes')
        ok(await page.is_visible('text=Offer an alliance') or 'Fallen' in await page.inner_text('#sheet'), 'tribes sheet offers an alliance')
        await page.screenshot(path=str(OUT / '08b-tribes.png'))
        tb = page.locator('[data-a^="truce:"]:not([disabled])').first
        if await tb.count():
            await tb.click(); await page.wait_for_timeout(200)
            ok(await page.evaluate("Object.keys(Tribelands.S.truce).length>0 || Object.keys(Tribelands.S.players[0].asked).length>0"), 'truce offer answered')
        await page.click('.close')
        await page.click('#btnTech'); await page.click('[data-t="gliding"]')
        ok('Glider' in await page.inner_text('#tdetail'), 'tech detail lists what it unlocks')
        await page.screenshot(path=str(OUT / '08c-tech-detail.png'))
        await page.click('.close')
        await page.evaluate("(()=>{const S=Tribelands.S; Object.assign(S.players[0].techs,{rafting:true,trails:true,fishing:true}); S.players[0].stars+=40;})()")
        c = await page.evaluate('(()=>{const c=Tribelands.S.cities.find(c=>c.owner===0); return c ? c.y*Tribelands.S.n+c.x : -1})()')
        if c >= 0:
            await page.evaluate(f'Tribelands.select({{kind:"tile", i:{c}}})')
            await page.screenshot(path=str(OUT / '08d-city-wonders.png'))
            wb = page.locator('button[data-a="wonder:lighthouse"]:not([disabled])')
            if await wb.count():
                await wb.click(); await page.wait_for_timeout(300)
                ok(await page.evaluate("Tribelands.S.explored.every(x=>x===1)"), 'Lighthouse reveals the map')
        # a road, undo label
        ri = await page.evaluate("Tribelands.S.tiles.findIndex((t,i)=>!t.road && t.t<3 && t.cityHere<0 && t.city>=0 && Tribelands.S.cities[t.city].owner===0)")
        if ri >= 0:
            await page.evaluate(f'Tribelands.select({{kind:"tile", i:{ri}}})')
            await page.click('button[data-a="work:trail"]'); await page.wait_for_timeout(200)
            ok((await page.inner_text('#undoLbl')).lower().startswith('undo machete trail'), 'undo button names the action')
        await page.screenshot(path=str(OUT / '08e-road.png'))
        # a world event sheet
        await page.evaluate("(()=>{const S=Tribelands.S; S.nextEvent=S.turn+1; S.challenge=null; S.nextChallenge=999;})()")
        if await page.evaluate('!Tribelands.S.over'):
            await page.click('#btnEnd')
            await page.wait_for_function('!Tribelands.busy', timeout=30000)
            await page.wait_for_timeout(300)
            while await page.is_visible('.reward'):
                await page.click('.reward'); await page.wait_for_timeout(150)
            ok(await page.is_visible('text=The island stirs') or await page.evaluate('!!Tribelands.S.over') or await page.is_visible('text=want an alliance') or await page.is_visible('text=Come on in'), 'island event or challenge announced')
            await page.screenshot(path=str(OUT / '08f-event.png'))
            await page.evaluate("document.querySelector('#modal').hidden || document.querySelector('[data-x], [data-o=\"no\"]')?.click()")

        # the island map
        await page.evaluate("document.querySelector('#modal').hidden || document.querySelector('#sheet [data-x]')?.click()")
        await page.click('#btnMap'); await page.wait_for_timeout(200)
        ok(await page.is_visible('#mini'), 'island map opens')
        await page.screenshot(path=str(OUT / '08g-map.png'))
        await page.click('#mini', position={'x': 60, 'y': 40}); await page.wait_for_timeout(200)
        ok(await page.is_hidden('#modal'), 'tapping the map flies there')

        # settings shows the version
        await page.click('#btnMenu'); await page.click('[data-m="settings"]')
        ok('v23' in await page.inner_text('#sheet'), 'version in settings')
        await page.screenshot(path=str(OUT / '08-settings.png'))
        await page.click('.close')

        # desktop layout
        await page.set_viewport_size({'width': 1280, 'height': 800})
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / '09-desktop.png'))

        ok(not errors, 'no console errors' + ('' if not errors else ': ' + ' | '.join(errors[:5])))
        await b.close()
    print('\nFAILED: ' + '; '.join(fails) if fails else '\nall passed')
    sys.exit(1 if fails else 0)

asyncio.run(main())
