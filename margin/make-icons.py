"""Draws Margin's home-screen icons. Run after changing the look:  python3 make-icons.py

Uses a headless browser's canvas so the icons match the app's own colours exactly.
Writes icon-192.png and icon-512.png next to this file.
"""
import asyncio, base64, os, pathlib
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent
CHROME = os.environ.get('CHROME_PATH') or next(
    (p for p in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'] if os.path.exists(p)), None)

DRAW = """
(size) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#0E1013';                       // the app's ink
  x.fillRect(0, 0, size, size);
  // keep the mark inside the safe circle so maskable icons are never clipped
  x.fillStyle = '#FFFFFF';
  x.font = `800 ${size * 0.46}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('M', size / 2, size * 0.47);
  x.fillStyle = '#D93A25';                       // the one accent
  const w = size * 0.26, h = Math.max(2, size * 0.045);
  x.fillRect((size - w) / 2, size * 0.68, w, h);
  return c.toDataURL('image/png');
}
"""

async def main():
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())
        pg = await b.new_page()
        for size in (192, 512):
            data = await pg.evaluate(DRAW, size)
            (HERE / f'icon-{size}.png').write_bytes(base64.b64decode(data.split(',', 1)[1]))
            print(f'icon-{size}.png')
        await b.close()

asyncio.run(main())
