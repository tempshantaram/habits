import asyncio, json, os, pathlib, sys
from playwright.async_api import async_playwright
APP = 'file://' + str((pathlib.Path(__file__).parent.parent / 'dist' / 'margin.html').resolve())
OUTD = str(pathlib.Path(__file__).parent / 'shots')
# Some machines keep Chromium outside Playwright's own folder; point at it if so.
CHROME = os.environ.get('CHROME_PATH') or next((p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'] if os.path.exists(p)), None)
LAUNCH = {'executable_path': CHROME} if CHROME else {}
URL = APP
OUT = OUTD
os.makedirs(OUT, exist_ok=True)
errors = []
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH)
        ctx = await b.new_context(viewport={'width':412,'height':915}, device_scale_factor=2, accept_downloads=True, has_touch=True)
        page = await ctx.new_page()
        page.on('console', lambda m: errors.append('console:'+m.text) if m.type=='error' else None)
        page.on('pageerror', lambda e: errors.append('pageerror:'+str(e)))
        await page.goto(URL); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/01_first_run.png')
        # capture
        q = page.locator('#q')
        await q.fill('Call DEWA tmrw commute ~2m'); await page.wait_for_timeout(100)
        print('preview:', await page.locator('#pv').inner_text())
        await page.screenshot(path=f'{OUT}/02_preview.png')
        await q.press('Enter'); await page.wait_for_timeout(200)
        for t in ['vet for dogs tue 5pm','call plumber today','call bank today ~2m','call school about fees today','waiting on Ahmed for pool quote','buy dog shampoo from amazon','buy nappies on noon','gift for George wooden blocks','learn to sail someday','renew car insurance expires in 20 days','text builder when home','random thought about holidays','meeting prep today at 23:50 !']:
            await q.fill(t); await q.press('Enter'); await page.wait_for_timeout(80)
        await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/03_today.png', full_page=True)
        # setup stepper
        await page.locator('[data-a=step][data-v=setup]').first.click(); await page.wait_for_timeout(300)
        d = page.locator('input[data-exdate]').first
        await d.fill('2027-01-20'); await d.dispatch_event('change'); await page.wait_for_timeout(100)
        await page.screenshot(path=f'{OUT}/04_setup1.png')
        await page.locator('[data-a=stepNext]').click(); await page.wait_for_timeout(150)
        await page.locator('[data-a=lastDone][data-v="14"]').first.click(); await page.wait_for_timeout(100)
        await page.screenshot(path=f'{OUT}/05_setup2.png')
        await page.locator('[data-a=stepNext]').click(); await page.wait_for_timeout(150)
        await page.locator('[data-a=stepFinish]').click(); await page.wait_for_timeout(300)
        # done a row
        await page.locator('.row .box').first.click(); await page.wait_for_timeout(250)
        await page.screenshot(path=f'{OUT}/06_stamp.png')
        await page.wait_for_timeout(900)
        # snooze
        await page.locator('.row .snz').first.click(); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/07_snooze.png')
        await page.locator('[data-a=snz]').first.click(); await page.wait_for_timeout(300)
        # editor
        await page.locator('.row .body').first.click(); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/08_editor.png', full_page=False)
        await page.locator('#sheet [data-a=closeSheet]').click(); await page.wait_for_timeout(300)
        # batch
        if await page.locator('[data-a=batch]').count():
            await page.locator('[data-a=batch]').first.click(); await page.wait_for_timeout(300)
            await page.screenshot(path=f'{OUT}/09_batch.png')
            await page.locator('#sheet [data-a=closeSheet]').click(); await page.wait_for_timeout(300)
        else: errors.append('no batch banner')
        # delegate
        await page.locator('.row .body').first.click(); await page.wait_for_timeout(250)
        await page.locator('#sheet [data-a=delegate]').click(); await page.wait_for_timeout(250)
        await page.screenshot(path=f'{OUT}/10_delegate.png')
        async with ctx.expect_page() as newp:
            await page.locator('[data-a=dg-send]').click()
        np = await newp.value; print('wa url:', np.url[:120]); await np.close()
        await page.wait_for_timeout(300)
        # views
        for v in ['upcoming','lists','notes','review']:
            await page.evaluate(f"go('{v}')"); await page.wait_for_timeout(250)
            await page.screenshot(path=f'{OUT}/11_{v}.png', full_page=True)
        await page.locator('nav [data-v=upcoming]').click(); await page.locator('[data-a=upSeg][data-v=radar]').click(); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{OUT}/12_radar.png', full_page=True)
        await page.locator('nav [data-v=lists]').click(); await page.locator('[data-a=listSeg][data-v=waiting]').click(); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{OUT}/13_waiting.png', full_page=True)
        await page.locator('nav [data-v=notes]').click(); await page.locator('#search').fill('dewa'); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{OUT}/14_search.png')
        await page.locator('[data-a=notesMode][data-v=log]').click(); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{OUT}/15_log.png')
        # weekly review
        await page.evaluate("go('review')")
        await page.locator('[data-a=step][data-v=weekly]').first.click(); await page.wait_for_timeout(250)
        await page.screenshot(path=f'{OUT}/16_weekly.png')
        for k in range(5):
            await page.locator('[data-a=stepNext]').click(); await page.wait_for_timeout(120)
        async with page.expect_download() as dl:
            await page.locator('#sheet [data-a=backup]').click()
        d = await dl.value; path = await d.path(); data = json.load(open(path)); print('backup items', len(data['items']))
        await page.locator('[data-a=stepFinish]').click(); await page.wait_for_timeout(300)
        # settings
        await page.locator('[data-a=settings]').click(); await page.wait_for_timeout(250)
        await page.screenshot(path=f'{OUT}/17_settings.png')
        await page.locator('[data-a=set-theme][data-v=dark]').click(); await page.wait_for_timeout(200)
        await page.locator('#sheet [data-a=closeSheet]').click(); await page.wait_for_timeout(300)
        await page.locator('nav [data-v=today]').click(); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{OUT}/18_dark_today.png', full_page=True)
        # reload persistence
        n1 = await page.evaluate('db.items.length'); await page.reload(); await page.wait_for_timeout(300)
        n2 = await page.evaluate('db.items.length'); print('persist', n1, n2)
        st = await page.evaluate('JSON.stringify(db.items.map(i=>[i.title,i.area,i.list,i.due,i.time,i.status]))')
        print(st)
        # overflow check
        ow = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth'); print('overflow px', ow)
        await b.close()
asyncio.run(main())
print('ERRORS:', errors)
