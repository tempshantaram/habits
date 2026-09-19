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
- **Again steps slower each time.** Pressing repeat because you missed something, and
  hearing it back at exactly the same speed, reproduces the same failure. Successive
  presses on one sentence go 0.85, 0.72, then 0.62 of your set speed. A slowed repeat is
  excluded from the timing calibration, since it says nothing about the voice's normal
  pace.
- **Pitch.** Worth more than it looks with a small number of electrodes: moving a voice
  up or down shifts its energy into different channels, and some will be clearer to you
  than others. Some Android voices ignore the setting; most honour it.

## Listen first

With the words on screen your eyes carry the comprehension and your ear is never really
tested. **Settings → Listen first** blurs everything from the current sentence onwards —
what you have already heard stays readable, so you keep the context and only what is
coming is a test. Tap the blurred text, or press **Show**, to check yourself.

It reads one sentence at a time while this is on, whatever the mode is set to: you
cannot check yourself if it runs ahead.

This is also what makes accent practice do its job. Reading along in ordinary English
while a respelled voice plays is not much of a test; hearing it first is.
- **Text up to 80 px**, high contrast, both themes. In landscape it will go full
  screen while reading, because the address bar costs a line or two of text.
- **The view follows the spoken word**, not just the sentence. At a large size a single
  sentence is taller than the screen, so placing the sentence once and stopping would
  leave its ending permanently out of sight.
- **Immersive**: five seconds untouched and everything but the words disappears. Any
  touch brings the controls back, and that touch does nothing else — it will not jump
  you to whatever sentence your thumb landed on. Turn it off under Settings → Screen.

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

## Accent practice

No device has an English voice with a Gulf accent — Android's Arabic voices speak
Arabic, its English voices speak English, and there is no `en-AE` in between. So this
respells what is sent to the voice instead, using the features Arabic phonology
predicts:

| | Light | Strong |
| --- | --- | --- |
| /p/ → /b/ | people → beoble | |
| /v/ → /f/ | very → fery | |
| initial s-cluster broken | school → ischool | |
| lax /ɪ/ raised | | big → beeg, this → thees |

Magic-e is left alone, so `provide` stays `brofide` rather than becoming `brofeede`.
The two `th` sounds are left exactly as they are, because Arabic has both.

**The screen keeps ordinary English throughout.** Only the voice's copy is respelled,
and each displayed word still maps to exactly one spoken word — so the highlighting
stays aligned and you can always see the word you just misheard. That is the point: it
is ear training, not a transcript.

Two honest limits. Respelling rebuilds the *sounds*; an accent is also rhythm and
stress, and those belong to the device voice — they cannot be respelled away. And these
are the features of Gulf Arabic speakers of English in general, not any one person.
Treat it as a warm-up, not a substitute for listening to the people you actually talk to.

The other approach is to point an Arabic voice at English text: **Voices → Show all
languages**. Some engines do this well and some badly; it costs nothing to listen.

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
and Edge on a desktop do. Android and iOS usually do not, so the app estimates instead.

The estimate is measured, not guessed. An utterance costs a fixed overhead — the
engine's lead-in and its trailing silence — plus a rate per syllable, and fitting only
the rate folds the overhead into it, so every syllable looks slightly slower than it is
and the error compounds along the sentence. The app therefore keeps running sums for a
least-squares fit of `duration = a + b × syllables` across sentences of differing
length, which separates the two. On a synthetic voice of 380 ms overhead and 185 ms per
syllable, fitting one parameter drifts 310 ms late by the last word of a 30-syllable
sentence; fitting both recovers the rate exactly.

**Highlight timing** in Settings is the trim on top of that, defaulting to 3% early,
because a marker slightly ahead of the voice is much easier to follow than one behind.
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
