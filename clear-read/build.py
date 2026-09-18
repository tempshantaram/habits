"""Builds the installable app from src/app.html:  python3 build.py

src/app.html is the page exactly as it is published as a Claude artifact, where the
platform supplies the document skeleton and Google Fonts is reachable. An installed
app has neither, so this wraps the page in its own document and inlines the reading
typeface, leaving one self-contained index.html that runs with no network at all.
"""
import base64, pathlib, re

HERE = pathlib.Path(__file__).parent
src = (HERE / 'src' / 'app.html').read_text(encoding='utf-8')

title = re.search(r'<title>(.*?)</title>', src, re.S).group(1).strip()
src = re.sub(r'<title>.*?</title>\s*', '', src, count=1, flags=re.S)
src = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>\s*', '', src, count=1)

style = re.search(r'<style>(.*?)</style>', src, re.S)
app_css = style.group(1)
body = (src[:style.start()] + src[style.end():]).strip()


def face(weight, filename):
    b64 = base64.b64encode((HERE / 'src' / 'fonts' / filename).read_bytes()).decode('ascii')
    return (
        "@font-face{font-family:'Atkinson Hyperlegible';font-style:normal;"
        f"font-weight:{weight};font-display:swap;"
        f"src:url(data:font/woff2;base64,{b64}) format('woff2')}}\n"
    )


# Atkinson Hyperlegible, by the Braille Institute of America — SIL Open Font
# Licence 1.1. Drawn so that letters people confuse most (I l 1, O 0, b d) stay
# distinct, which is the whole reason it is the reading face here.
fonts = face(400, 'atkinson-hyperlegible-400.woff2') + face(700, 'atkinson-hyperlegible-700.woff2')

# What the artifact platform would otherwise provide.
base = """
  :root{
    color-scheme:light dark;
    padding-top:env(safe-area-inset-top,0px);
    padding-bottom:env(safe-area-inset-bottom,0px);
  }
  img{max-width:100%}
  [hidden]{display:none!important}
"""

out = f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f1f5f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151d1a" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="description" content="Reads written text aloud one sentence at a time, with real gaps, spelled-out names and word-by-word highlighting. Runs entirely on this device.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-192.png">
<title>{title}</title>
<style>
{fonts}{base}{app_css}</style>
</head>
<body>
{body}
<script>
  if (navigator.serviceWorker) navigator.serviceWorker.register('sw.js').catch(() => {{ }});
</script>
</body>
</html>
"""

(HERE / 'index.html').write_text(out, encoding='utf-8')
print(f"index.html  {len(out.encode('utf-8')):,} bytes")
