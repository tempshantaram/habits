"""Builds the app from src/:  python3 build.py

One self-contained index.html, with the reading typeface inlined so it works
with no network at all: the same file serves as the hosted page, the installed
app and a Claude artifact. Edit the files in src/, never index.html.
"""
import base64, pathlib, re

HERE = pathlib.Path(__file__).parent
SRC = HERE / 'src'

css = (SRC / 'style.css').read_text(encoding='utf-8')
body = (SRC / 'body.html').read_text(encoding='utf-8')
js = '\n'.join((SRC / f).read_text(encoding='utf-8') for f in ['core.js', 'app.js'])

# core.js exports itself to node for the tests; in a browser there is no module.
js = js.replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
assert '</script>' not in js, 'a script tag in the source would close this one early'


def face(weight, filename):
    b64 = base64.b64encode((SRC / 'fonts' / filename).read_bytes()).decode('ascii')
    return (
        "@font-face{font-family:'Atkinson Hyperlegible';font-style:normal;"
        f"font-weight:{weight};font-display:swap;"
        f"src:url(data:font/woff2;base64,{b64}) format('woff2')}}\n"
    )


# Atkinson Hyperlegible, by the Braille Institute of America — SIL Open Font
# Licence 1.1. The letters people confuse most (I l 1, O 0, b d) stay distinct
# from one another, which is what a caption read at a glance needs.
fonts = face(400, 'atkinson-hyperlegible-400.woff2') + face(700, 'atkinson-hyperlegible-700.woff2')

out = f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f2f4f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141922" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="description" content="Transcribes a video or audio file on this device and writes the subtitles out as .srt or .vtt, with the cues spotted, timed and line-broken the way a subtitler would.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-192.png">
<title>Subtext</title>
<style>
{fonts}img{{max-width:100%}}
{css}</style>
</head>
<body>
{body}
<script>
{js}
</script>
<script>
  if (navigator.serviceWorker) navigator.serviceWorker.register('sw.js').catch(() => {{ }});
</script>
</body>
</html>
"""

(HERE / 'index.html').write_text(out, encoding='utf-8')
print(f"index.html  {len(out.encode('utf-8')):,} bytes")
