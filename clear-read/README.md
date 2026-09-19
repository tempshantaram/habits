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
   subject (`readaloud` by default), then tap *Email → Fetch*. Read-only throughout:
   nothing is sent and nothing is changed.
4. **Type** — Settings → *Edit the text*.

### The two email routes

The page picks whichever is available, so one source file serves both:

| Where it runs | Route | Set-up |
| --- | --- | --- |
| Installed app | Google sign-in from the browser | a one-time Google client ID |
| Inside claude.ai | the viewer's own Gmail connector | none at all |

The installed app uses the same OAuth approach as Margin. If Margin already reads your
mail on this site, **paste the same client ID** — both apps are served from the same
origin, so it needs no new set-up in Google Cloud. The token lives in memory and is gone
when the app closes; only the client ID, which is not a secret, is stored.

Run as a Claude artifact, the page instead calls the Gmail connector you already have,
with your credentials, and the code never sees a token. Nothing to configure.

### Getting the article out of the email

A forwarded article arrives wrapped in furniture, and one piece of it does real damage:
plain-text mail is hard-wrapped at about 75 characters, and a line break is **not** a
paragraph break. Treat it as one and every sentence is chopped mid-clause.

So the text is reassembled before it is read:

- the forward's own header block (`---------- Forwarded message ---------` and the
  `From:` / `Date:` / `Subject:` / `To:` lines beneath it) is skipped;
- bare link lines, unsubscribe lines, copyright and confidentiality footers are dropped;
- quoted reply chains and signature blocks are cut;
- wrapped lines are rejoined into whole paragraphs. The wrap width is measured from the
  message itself, and only lines close to it count as continuations — so a 58-character
  headline stays a headline while a 75-character wrapped line is joined to what follows.

For mail that is HTML only, blocks are scored by text density and link density — the
trick Reader Mode uses — and the densest run of prose wins. Marketing mail is mostly
tables, so `td` counts as a candidate.

Neither the sender nor the subject is read aloud; it goes straight into the article.

Rules cannot win every time, so there is a manual way out: step to the first real
sentence and tap **Settings → Start from this sentence**, which cuts everything above
it. *Undo trim* puts it back.

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
