# Subtext

Takes a video off the phone and writes the subtitles for it: transcribe, spot, tidy,
export a `.srt` or `.vtt`. It is one HTML file, it installs to the home screen, and
nothing is uploaded unless you pick the route that uploads.

The hard part of subtitles is not the words. It is everything after them — where a cue
starts and stops, how long it stays up, and where the line breaks — and that is what
most of this app is.

## Getting the words

Three routes, chosen each time, because they trade different things.

| | Whisper, here | Listen while it plays | Send it to a service |
| --- | --- | --- | --- |
| Where the audio goes | nowhere | nowhere | to whichever service you give a key for |
| Accuracy | good | rough — expect to correct it | good, and punctuated |
| Speed | minutes, faster with WebGPU | real time: 20 min for 20 min | a few minutes for an hour |
| Needs | one model download, then nothing | a quiet room, the volume up | a key, and a connection |
| Timings | per phrase, or per word from a `_timestamped` model | derived, adjustable | word-level, from the engine |

**Whisper, here** is the one to reach for. It runs Whisper inside this browser, so
the audio never leaves the phone and there is no key and no bill — at the cost of
downloading the model the first time. Tiny, base, small and large-turbo are offered;
base is the sensible default and large-turbo is for a desktop with WebGPU. After the
first run the browser has the model cached and the route works with no signal at all.

It runs in a worker, so the interface stays alive, and the audio goes in in two-minute
pieces cut at silences, each thirty-second window reporting as it lands, so a long wait
shows what it is doing. WebGPU is used where the device has it and the processor where
it does not — on a phone that is the difference between minutes and a very long time, so
the first suggestion is tiny where there is no WebGPU and base where there is. A WebGPU
pipeline that has not started the model after four minutes is abandoned for the
processor, because on some devices it never starts and never says so.

**Listen** plays the file out loud and writes down what the browser hears. The browser's
own recogniser will only ever listen to a microphone — there is no way to hand it a file
— so the phone listens to itself. That means no headphones, and as little noise in the
room as you can manage. Nothing leaves the device, and nothing is stored.

Two details make it usable rather than a novelty. A phrase is timestamped when its
*first* result arrives, not when it is finalised, which would put every cue seconds
late; the leftover lag is the **timing offset** slider, at 0.45 s by default. And
recognition gives up at every silence, so it is restarted for as long as the video runs.

**Service** reduces the audio to what a recogniser actually wants — one channel at
16 kHz — which turns a 400 MB video into about 2 MB a minute, cuts it at silences into
pieces under the upload limit, and sends them one at a time with your key. Each piece's
timings are shifted by where it started, so what comes back is one continuous run of
words. Presets for OpenAI, Groq and Deepgram; anything OpenAI-compatible can be typed in,
including a Whisper server on your own machine — that route is accurate *and* stays in
the house.

The key is held in memory and forgotten when the app closes, unless you turn on
**Remember it on this device**. Anything a browser stores can be read by anything else
running in that browser, so it is off by default.

You can also skip transcription: open a `.srt` or `.vtt` someone else made and edit it,
or open a video and type the cues yourself with **In** and **Out** as it plays.

## Turning words into subtitles

A transcript is not subtitles. What the app does with the words:

- **Cues are cut where a reader would cut them** — at sentence ends and real silences
  first; then, if a cue is still too long, at the best interior joint, scoring
  punctuation, the length of the pause, and whether the next word opens a clause.
  Fragments too short to read are merged back into their neighbour.
- **Reading time comes out of the silence.** A cue that appears exactly as the word is
  spoken and vanishes as it ends is technically right and hard to read. In-times sit a
  touch early, out-times are held into the pause that follows — never into the next cue.
- **Lines break at a joint, not at the middle.** Breaking after "the" or "of" costs you
  the phrase, so those are penalised; punctuation and clause openers are rewarded, and
  balance only breaks the tie.
- **Everything is measured against reading speed**, in characters a second. Anything
  over the ceiling is flagged, because a line that cannot be read in the time it is up
  is not a subtitle.

Three profiles set all of it at once: **Broadcast** (37 characters, 15 cps, the usual),
**Easy read** (32 characters, 11 cps, longer on screen), and **One sentence**, which
never splits a sentence across two cues however long it runs — for reading a whole line
at a time rather than skimming.

Change a limit and the cues re-lay out and are re-checked immediately. **Re-spot**
rebuilds them from scratch to the new limits, using the word timings where they survive.

## Fixing the words with Claude

A recogniser hears sounds. It does not know what it is listening to, so a programme
called *The Traitors* comes out as traders, every time, and a name is spelled however it
sounded. Told what the programme is, Claude can put those back — which is what
**Fix words** does.

Write a sentence or two about what this is: the title, the people, the words it keeps
using. That description is the whole difference between a guess and a correction.

Then one of three ways, all the same exchange underneath:

- **Through the Claude app** — copy the prompt, paste it into Claude on the phone or in
  a browser, paste the reply back. No key, no account beyond the one you have, works
  anywhere. Long files are offered in batches so no single paste is enormous.
- **With your key** — the Claude API, called straight from the page, in batches, with a
  key you hold. The key stays in memory unless you ask it not to.
- **Inside Claude** — if the page is open as an artifact on claude.ai, it just asks.
  Nothing to set up.

What protects the file is the shape of the exchange: lines go out numbered and come back
numbered, and only text is ever taken from the reply. **No in or out time can move**, a
reply that garbles the format changes nothing it cannot account for, and every change is
listed old-against-new for you to keep, put back one at a time, or undo altogether. A
line that comes back with the same words is left exactly as it was, so a line you broke
by hand stays broken where you broke it.

The prompt tells it to correct mishearings, names and punctuation, and not to translate,
rephrase, tidy, merge, split or renumber anything. It is still worth reading the list of
changes: the thing correcting your subtitles is a language model, and a plausible
rewrite is exactly the failure it is prone to.

## Fixing what is wrong

The strip above the list counts what is wrong — too fast, overlapping, too brief,
over-wide, no gap — and each count is a button that jumps to the first one. Inside a
cue, the part of a line past the character limit is shaded, so a bad break is a shape
rather than a number to look up.

Per cue: play it, edit it, split it at the caret, merge it into the next, delete it,
type an in or out time, or set one to the playhead with **In** and **Out**. Across the
file: **Fix timings** removes overlaps and flashes, **Re-flow lines** lays every line
out again, and the shift buttons move everything for subtitles that are right but
early or late throughout.

The caption is drawn over the picture at the size you choose, so what you are checking
is what a viewer sees — including whether it fits.

## Getting a video in

1. **Open** — the file picker, on any device.
2. **Share** — once installed on Android, share a video from the gallery straight to
   Subtext.
3. **Drop** — drag a file onto the page on a desktop.
4. **Double-click** — on a desktop, the installed app registers itself as a handler for
   video files.

## Getting the subtitles out

`.srt` and `.vtt` download beside the video, named after it, with the lines broken to
your limits. `.txt` is the plain transcript, paragraphed at the pauses — and where the
apps are served from the same site, **Read it in Clear Read** hands that transcript to
[Clear Read](../clear-read/) to be read aloud.

The cues are written to the browser's storage after every change, so a tab the phone
kills in the background is not twenty minutes of work lost. The video itself cannot be
kept that way, so when you come back the cues are there and the file is asked for again.

## Installing it on a phone

Open the hosted page, then Chrome offers **Install app** (or ⋮ → *Add to Home screen*).
After that it has its own icon and runs full screen. The app itself needs no network at
all; the service route obviously does.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app, built. One file. Do not edit by hand. |
| `src/style.css`, `src/body.html` | The look and the markup. |
| `src/core.js` | Subtitles as arithmetic: spotting, line breaking, timing, file formats, audio, the correction exchange, and the Whisper worker's source. No DOM, no network. **The interesting half.** |
| `src/app.js` | The device: file, picture, microphone, network, list. |
| `src/fonts/` | Atkinson Hyperlegible, inlined into the build so it works offline. |
| `build.py` | Assembles `src/` into `index.html` and inlines the fonts. |
| `make-icons.py` | Draws the icon. No dependencies. |
| `sw.js` | Service worker: network first, cache second, and it catches shared videos. |
| `test/core.test.js` | `node test/core.test.js` — the arithmetic, without a browser. |
| `test/ui_test.py` | `python3 test/ui_test.py` — drives the built app in Chromium. Needs playwright. |

After changing anything in `src/`, run `python3 build.py`.

## Known limits

**Most Whisper exports cannot time individual words.** Word-level timings need the
model to have been exported with its cross-attentions, and the ordinary ONNX builds
were not, which the model only says when it is asked to transcribe. So the app asks
once, and where the answer is no it takes a timing per phrase instead and places the
words across it — accurate to within a word, which for subtitles is nothing. The
`_timestamped` models in the list do time every word, for a larger download.

**Whisper's first run needs the internet, and a served page.** The model comes from a
CDN, so the first run of that route needs a connection — and the page has to be served
over https, not opened as a file, for the worker to load it. Everything after the first
run is offline. If the model cannot be fetched the route says so and the other two are
still there.

**Whisper invents things in silence.** It is a known habit of the model, not of this
app: over long silence or music it will sometimes produce a polite phrase that nobody
said. Those cues are usually obvious in the list — an odd line sitting alone in a gap —
and deleting them is one tap.

**Long files are limited by memory, not by patience.** The service route decodes the
whole audio track at once, which is a few hundred megabytes of samples for an hour of
video. That is comfortable on a desktop and near the edge on a phone. Over about an
hour, do it on a computer or cut the file first.

**Not every container decodes.** MP4, M4A, MP3, WAV and WebM are reliable; MKV usually
is not, because the browser will not decode it. The app says so rather than failing
quietly.

**The listening route is a first draft.** Thirteen electrodes' worth of accuracy is not
what it gives you — it gives you a transcript with the shape right and some of the words
wrong, and the timings close enough to correct by hand. For anything you are handing to
someone else, use a real engine.

**A service must allow browser calls.** OpenAI, Groq and Deepgram do. A server that does
not send CORS headers will fail with a message saying so; that is the server's choice,
not something the app can work around.

**Speech recognition is Chrome and Edge only.** Safari and Firefox have no usable
`SpeechRecognition`, so on those the listening route is greyed out and the service route
is the one that works.

## Credits

Atkinson Hyperlegible is by the Braille Institute of America, released under the SIL
Open Font Licence 1.1. It is the caption face here because its letterforms keep the
shapes people confuse most — I l 1, O 0, b d — distinct from one another, which is what
a line read at a glance needs.
