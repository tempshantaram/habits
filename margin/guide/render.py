import asyncio, os, pathlib
from playwright.async_api import async_playwright

# Some machines keep Chromium outside Playwright's own folder; point at it if so.
CHROME = os.environ.get('CHROME_PATH') or next(
    (p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'] if os.path.exists(p)), None)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()
        pg = await b.new_page()
        await pg.goto('file://' + str(pathlib.Path(__file__).parent / 'guide.html')); await pg.wait_for_timeout(300)
        # overflow check per page
        o = await pg.evaluate("[...document.querySelectorAll('.pg')].map(p=>{const f=p.querySelector('.foot').getBoundingClientRect().top; const kids=[...p.children].filter(c=>!c.classList.contains('foot')); const last=kids[kids.length-1].getBoundingClientRect().bottom; return [Math.round(last), Math.round(f)]})")
        print('content bottom vs footer top:', o)
        await pg.pdf(path=str(pathlib.Path(__file__).parent / 'Margin-quick-start.pdf'), format='A4', print_background=True, margin={'top':'0','bottom':'0','left':'0','right':'0'}, prefer_css_page_size=True)
        await b.close()
asyncio.run(main())
