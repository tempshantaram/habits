"""Builds the installable game from src/:  python3 build.py

src/body.html, src/style.css, src/core.js (rules, map, computer tribes),
src/ui.js (drawing the islands, touch input) and src/panels.js (HUD, panel,
sheets) are stitched into one self-contained
index.html — no fonts, images or scripts from anywhere else, so it runs with
no network at all and can be sent on as a single file.
"""
import pathlib, re

HERE = pathlib.Path(__file__).parent
SRC = HERE / 'src'
css = (SRC / 'style.css').read_text(encoding='utf-8')
body = (SRC / 'body.html').read_text(encoding='utf-8').strip()
js = '\n'.join((SRC / f).read_text(encoding='utf-8') for f in ('core.js', 'story.js', 'ui.js', 'progress.js', 'panels.js'))
version = re.search(r"const VERSION = '([^']+)'", js).group(1)

out = f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#16202E">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="description" content="A turn-based strategy game: explore, grow cities, research and conquer. Runs offline on this device.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
<title>Tribelands</title>
<style>
{css}</style>
</head>
<body>
{body}
<script>
{js}
</script>
<script>
  if (navigator.serviceWorker && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {{ }});
</script>
</body>
</html>
"""

(HERE / 'index.html').write_text(out, encoding='utf-8')
print(f"index.html  {len(out.encode('utf-8')):,} bytes  ({version})")
