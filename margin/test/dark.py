import asyncio, os, pathlib
from playwright.async_api import async_playwright
APP = 'file://' + str((pathlib.Path(__file__).parent.parent / 'dist' / 'margin.html').resolve())
OUTD = str(pathlib.Path(__file__).parent / 'shots')
# Some machines keep Chromium outside Playwright's own folder; point at it if so.
CHROME = os.environ.get('CHROME_PATH') or next((p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'] if os.path.exists(p)), None)
LAUNCH = {'executable_path': CHROME} if CHROME else {}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH)
        for scheme in ['dark','light']:
            ctx = await b.new_context(viewport={'width':412,'height':915}, device_scale_factor=2, color_scheme=scheme)
            pg = await ctx.new_page()
            await pg.goto(APP); await pg.wait_for_timeout(300)
            for t in ['Call DEWA tmrw commute ~2m','call plumber today','vet for dogs today 5pm','pay school fees today','haircut 3 days ago']:
                await pg.fill('#q', t); await pg.press('#q','Enter')
            # make one overdue
            await pg.evaluate("db.items.find(i=>i.title==='Pay school fees').due=addDays(today(),-4); save(); render()")
            await pg.evaluate("document.getElementById('toast').classList.remove('on')")
            await pg.evaluate("window.scrollTo(0, 700)")
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'test/shots/v_{scheme}.png')
            await ctx.close()
        await b.close()
asyncio.run(main())
