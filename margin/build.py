import pathlib
src = pathlib.Path('src')
css = (src/'style.css').read_text()
body = (src/'body.html').read_text()
js = '\n'.join((src/f).read_text() for f in ['core.js','sources.js','app1.js','app2.js'])
js = js.replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
html = f'''<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F3EEE3">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="description" content="Margin — reminders, notes and life-admin radar. Runs entirely on this device.">
<title>Margin</title>
<style>
{css}
</style>
</head>
<body>
{body}
<script>
{js}
</script>
</body>
</html>
'''
assert '</script>' not in js
pathlib.Path('dist/margin.html').write_text(html)
# The same file again as index.html, so a host (GitHub Pages) can serve this folder.
pathlib.Path('index.html').write_text(html)
print(len(html)//1024, 'KB  → dist/margin.html + index.html')
