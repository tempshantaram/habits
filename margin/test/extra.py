import asyncio, os, pathlib
from playwright.async_api import async_playwright
APP = 'file://' + str((pathlib.Path(__file__).parent.parent / 'dist' / 'margin.html').resolve())
OUTD = str(pathlib.Path(__file__).parent / 'shots')
# Some machines keep Chromium outside Playwright's own folder; point at it if so.
CHROME = os.environ.get('CHROME_PATH') or next((p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'] if os.path.exists(p)), None)
LAUNCH = {'executable_path': CHROME} if CHROME else {}
errs=[]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**LAUNCH)
        ctx = await b.new_context(viewport={'width':412,'height':915})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP); await pg.wait_for_timeout(300)
        await pg.fill('#q','call bank today'); await pg.press('#q','Enter')
        await pg.evaluate("db.items.find(i=>i.title==='Call bank').snoozes=3; save(); render()")
        await pg.locator('#r-'+await pg.evaluate("db.items.find(i=>i.title==='Call bank').id")+' .snz').click()
        await pg.wait_for_timeout(250)
        print('decide sheet:', 'Decide' in await pg.locator('#sheet').inner_text())
        await pg.locator('[data-a=dc-now]').click(); await pg.wait_for_timeout(200)
        print('focus pinned:', await pg.evaluate("db.items.find(i=>i.title==='Call bank').focus===today()"))
        # expiry + renew
        await pg.fill('#q','passport expires in 10 days'); await pg.press('#q','Enter'); await pg.wait_for_timeout(200)
        pid = await pg.evaluate("db.items.find(i=>i.title==='Passport').id")
        print('passport due', await pg.evaluate(f"findItem('{pid}').due"), 'ack', await pg.evaluate(f"findItem('{pid}').expiry.ack"))
        await pg.locator(f'#r-{pid} .box').click(); await pg.wait_for_timeout(250)
        print('renew sheet:', 'Renewed' in await pg.locator('#sheet').inner_text())
        await pg.locator('[data-a=renewSave]').click(); await pg.wait_for_timeout(200)
        print('after renew', await pg.evaluate(f"JSON.stringify([findItem('{pid}').expiry, findItem('{pid}').due])"))
        # cal links
        print(await pg.evaluate("(()=>{const i=itemFromParse(parse('gym every mon and thu at 6am')); return calLink({title:i.title,dates:'x/y',details:'d',rrule:rrule(i)})})()"))
        print(await pg.evaluate("(()=>{const i=itemFromParse(parse('vet tue 5pm')); const ev={title:i.title,date:i.due,time:i.time,details:'d'}; const allDay=!ev.time; const start=`${compact(ev.date)}T${ev.time.replace(':','')}00`; return start+' / '+addMin(ev.date,ev.time,30).replace(/-/g,'')})()"))
        # float completion
        await pg.fill('#q','flea tick every 30 days after done'); await pg.press('#q','Enter')
        fid = await pg.evaluate("db.items.find(i=>i.title==='Flea tick').id")
        await pg.evaluate(f"complete('{fid}')")
        print('float next', await pg.evaluate(f"findItem('{fid}').due"), 'log', await pg.evaluate("db.log.length"))
        # fixed weekly completion
        await pg.fill('#q','bins out every mon and thu'); await pg.press('#q','Enter')
        bid = await pg.evaluate("db.items.find(i=>i.title==='Bins out').id")
        d0 = await pg.evaluate(f"findItem('{bid}').due"); await pg.evaluate(f"complete('{bid}')")
        print('fixed', d0, '->', await pg.evaluate(f"findItem('{bid}').due"))
        # import roundtrip
        n = await pg.evaluate("(()=>{const j=JSON.parse(JSON.stringify(db)); ui.pendingImport=j; A.importGo(); return db.items.length})()")
        print('import ok', n)
        await b.close()
asyncio.run(main()); print('errors', errs)
