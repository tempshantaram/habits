# Clear Read

Reads written text aloud in a way that survives a cochlear implant.

Built for thirteen active electrodes. With that few channels the fine pitch detail
that separates one consonant from another is mostly gone, so the app does not try to
make speech louder or slower — it changes the *shape* of the listening:

- **A real gap after every sentence** (adjustable, 0–3 s). Processing time, not slower
  words, is the single biggest comprehension gain. Long sentences are also split at
  commas and semicolons into shorter runs, with a shorter gap at those internal breaks.
- **Names and unusual words announced before the sentence arrives.** It says the word,
  spells it, then says it again — once per passage, so it never nags. Those words carry
  a dotted underline in the text, so you can see why the extra audio happened.
- **Tap any word in the sentence you are on** to hear it said, spelled, and said again.
  Tap a different sentence to jump there.
- **Word-by-word highlighting** while it reads, so your eyes carry what your ears miss.
- **Two modes.** Continuous auto-advances; One sentence stops after each line so you can
  repeat it before moving on.
- **Text up to 80 px**, high contrast, both themes. In landscape it will go full
  screen while reading, because the address bar costs a line or two of text.

## Getting text into it

1. **Paste** — one tap reads the clipboard and starts. Where the browser refuses to
   hand it over, the box opens instead.
2. **Share** — once installed, select text anywhere on the phone and tap
   *Share → Clear Read*.
3. **Email** — forward anything you want read to yourself with a marker word in the
   subject (`readaloud` by default), then tap *Email → Fetch*. Read-only: nothing is
   sent and nothing is changed. Quoted reply chains and signatures are cut off, so you
   hear the message and not the thread beneath it.
4. **Type** — Settings → *Edit the text*.

The email connection needs a one-time Google client ID, the same as Margin's. If Margin
is already reading your mail on this site, **paste the same ID** — both apps are served
from the same origin, so it needs no new set-up in Google Cloud. The sign-in token lives
in memory and is gone when the app closes; only the client ID (which is not a secret) is
stored. Email works in the installed app but not in the Claude artifact preview, whose
sandbox blocks both Google sign-in and the Gmail host.

## Installing it on a phone

Open the hosted page, then Chrome offers **Install app** (or ⋮ → *Add to Home screen*).
After that it has its own icon, runs full screen, and works with no signal. Once
installed it also appears in the Android share sheet: select text anywhere — an email, a
web page, a message — tap **Share → Clear Read**, and it opens reading that text.

Nothing leaves the device. There is no account, no network call, and no analytics. The
text you paste and your settings are stored in the browser on that phone only.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app, built. One file, no network. Do not edit by hand. |
| `src/app.html` | The source the app is built from, and the page published as a Claude artifact. **Edit this one.** |
| `src/fonts/` | Atkinson Hyperlegible, inlined into the build so it works offline. |
| `build.py` | Wraps `src/app.html` in its own document and inlines the fonts → `index.html`. |
| `make-icons.py` | Draws the thirteen-bar icon. No dependencies. |
| `sw.js` | Service worker. Network first, cache second. Scoped to this folder. |

After changing `src/app.html`, run `python3 build.py`. After changing the icon colours,
run `python3 make-icons.py`.

## Known limits

**Word-by-word highlighting depends on the browser reporting word boundaries.** Chrome
and Edge on a desktop do. Android and iOS usually do not, so the app falls back to
estimated timing that re-syncs at the start of every sentence — close, but not exact.
Sentence highlighting is always accurate.

**The audio cannot be processed.** Compression, EQ and consonant boosting would all help
someone streaming straight to a processor, but the device's built-in voices play
directly to the output and cannot be routed through Web Audio. That needs a voice engine
that returns an audio *file* — a cloud voice, or a native Android app using
`synthesizeToFile`. `speakJob()` in `src/app.html` is the seam where such an engine
would slot in.

**Android needs a speech engine installed.** On a Pixel that is *Speech Recognition and
Synthesis from Google*, under Settings → Text-to-speech output. If no voices are found
the app says so in an amber strip rather than failing silently, and **Settings → Test
sound** checks it directly.

## Credits

Atkinson Hyperlegible is by the Braille Institute of America, released under the SIL
Open Font Licence 1.1. It is the reading typeface here because its letterforms keep
the shapes people confuse most — I l 1, O 0, b d — distinct from one another.
