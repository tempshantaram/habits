# Margin

A single-file notes-and-reminders app that **draws on the places your life actually
arrives from** — email, calendar invites, files, shared links, your own voice — and
turns them into suggestions you accept or skip. Everything runs in the browser on
your phone. No server, no account, no sync.

New to code? Everything you need is in the three commands at the bottom.

---

## What's in the folder

| Path | What it is |
| --- | --- |
| `dist/margin.html` | **The app.** One file. Open it, or host it and add it to your home screen. |
| `src/core.js` | Dates, your areas and slots, and the parser that reads `call DEWA tmrw commute ~2m`. |
| `src/sources.js` | The new bit: turns an email, an `.ics`, a `.csv` or a pasted list into suggestions. Plus the read-only Gmail connection. |
| `src/app1.js` | Storage, items, and the screens (Today, Sources, Ahead, Lists, Notes, Review). |
| `src/app2.js` | Drawing, sheets, every button, and start-up. |
| `src/body.html`, `src/style.css` | The page skeleton and the look. |
| `build.py` | Glues `src/` into `dist/margin.html`. Run it after any change. |
| `test/` | Tests. `*.test.js` run in Node; `*.py` drive a real browser. |
| `guide/` | The printed how-it-works (2 pages, A4). `render.py` rebuilds the PDF. |
| `index.html` | The same build again, so a web host can serve this folder as the app. |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | Only used when hosted: home-screen install, share-to-Margin, and offline. `make-icons.py` redraws the icons. |

## How sources work

```
something arrives  →  Margin reads it  →  a suggestion  →  you tap Add  →  an item
 (email, invite,      (on this phone)     with a line          or Skip       that
  file, link, text)                       saying why                     remembers
                                                                        where it
                                                                        came from
```

Five ways in:

1. **Paste or forward** — copy an email (or a message, or a list) into the box on the
   Sources tab and tap *Read it*.
2. **Gmail, read-only** — give Margin an email address of its own and forward things to
   it; everything in that mailbox is fair game. Fetches quietly in the background when you
   open the app. Needs a one-time Google client ID and Margin served over `https`. The
   sign-in token is never saved.
3. **WhatsApp** — export a chat (or paste a few messages). Only the lines that ask you
   for something or carry a date become suggestions.
4. **Files** — `.ics` invites, `.csv` exports, `.txt`/`.md` lists. Pick a file, or drag
   one onto the window on a computer.
5. **Share sheet / link** — share to Margin from another app once it's installed, or
   open `…/margin.html?text=whatever`.

From an email Margin picks out the sender, subject, dates, times, amounts, reference
numbers and the lines that ask you for something; it suggests a renewal for expiry
wording, a calendar-bound item for a date with a time, a *Pay …* item for a bill, and a
*Waiting on* entry for mail you sent yourself. Nothing is added until you say so, and
the same message is never read in twice.

At most three items per message, so one email can't flood the list. By default things
file themselves and are marked as new (a red edge, and *Just arrived* on the Sources tab)
rather than queuing for approval — turn that off under Settings → Sources.

Items keep their origin: a small ✉ or ▣ on the row, the sender and a snippet
in the editor, *Open in Gmail* back to the thread itself, a source filter in Notes, and
the original text included in search.

## Handing it to Claude

Settings → **Ask Claude about it** writes a readable Markdown file: everything open, what
you're waiting on, expiry dates with days remaining, 90 days of finished work, and the
questions worth asking, already at the top. `claudeDump()` in `app2.js` builds it. The JSON
backup is for restoring Margin; this one is for reading.

## Privacy

Everything is read and stored on the device, in the browser's own storage, under the
address you open Margin from. Nothing is uploaded. With Gmail connected, the browser
talks to Google directly with a read-only token held in memory only. Turn off the saved
snippet under Settings → Sources; clear the "already seen" list with *Forget*.

## Working on it

```bash
python3 build.py            # rebuild dist/margin.html after changing anything in src/
node test/parse.test.js     # the capture parser  (35 checks)
node test/sources.test.js   # the source readers  (55 checks)
```

Two more, if you have Playwright and Chromium installed:

```bash
node test/sources_ui.test.js   # drives the Sources flow in a real browser
python3 test/ui_test.py        # walks the whole app and saves screenshots to test/shots/
```

Rules of thumb while editing:

- `src/*.js` become **one script** in the built file, so don't reuse a name that
  already exists in another file.
- `sources.js` is written so its readers can be tested in Node without a browser —
  keep the parsing half free of `document`, `fetch` and settings.
- Always run `build.py` before testing; the tests read `dist/`, not `src/`.

## Hosting it

This folder is ready to serve as-is. On **GitHub Pages**: repo Settings → Pages → Deploy
from a branch → `main` → `/ (root)` → Save. The app is then at
`https://<your-user>.github.io/habits/margin/`.

Hosting over `https` is what unlocks three things a file on disk can't do: Gmail sign-in,
sharing to Margin from other apps, and installing it to the home screen. Add that origin
(just `https://<your-user>.github.io`, no path) to your Google OAuth client's
**Authorised JavaScript origins**.

`dist/margin.html` remains a single self-contained file if you'd rather carry it around or
open it straight from disk — everything still works except those three.

Keep the same address once you start using it: your data is tied to it.
`guide/Margin-how-it-works.pdf` has the full walk-through.
