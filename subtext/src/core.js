/* Subtext — the pure half.

   Everything here turns words-with-timings into subtitle cues, and cues into
   files. No DOM, no network, no clock: given the same input it gives the same
   output, which is why it can be run under node (see test/core.test.js) and why
   the awkward parts — line breaking, reading speed, split points — are testable
   without a browser or a video.

   The vocabulary, so the rest of the code can be terse:
     word  { w, s, e }          one spoken word, start and end in seconds
     cue   { s, e, text, w? }   one subtitle. text may hold a manual line break;
                                w is the words it came from, kept so a split
                                lands on a real word boundary. Dropped once the
                                text is edited by hand, and the code copes.
*/

/* ---------------------------------------------------------------- time ---- */

function pad(n, width) {
  let s = String(Math.floor(n));
  while (s.length < (width || 2)) s = '0' + s;
  return s;
}

// HH:MM:SS,mmm (SubRip) or HH:MM:SS.mmm (WebVTT).
function fmtStamp(t, sep) {
  t = Math.max(0, t || 0);
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms % 3600000 / 60000);
  const s = Math.floor(ms % 60000 / 1000);
  return pad(h) + ':' + pad(m) + ':' + pad(s) + (sep || ',') + pad(ms % 1000, 3);
}

// Short form for the interface: 1:02.4, or 1:01:02.4 once there is an hour.
function fmtClock(t, dec) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor(t % 3600 / 60);
  const s = t % 60;
  const ss = (s < 10 ? '0' : '') + s.toFixed(dec === undefined ? 1 : dec);
  return (h ? h + ':' + pad(m) + ':' : m + ':') + ss;
}

// Accepts HH:MM:SS,mmm, HH:MM:SS.mmm, MM:SS.mmm, and plain seconds, because
// the in/out boxes are typed into by hand and nobody types the same way twice.
function parseStamp(str) {
  if (typeof str === 'number') return isFinite(str) ? str : null;
  const s = String(str == null ? '' : str).trim().replace(',', '.');
  if (!s) return null;
  const m = s.match(/^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : 0, c = +m[3];
  // One colon means minutes:seconds, two means hours:minutes:seconds.
  return m[2] === undefined ? (m[1] ? a * 60 + c : c) : a * 3600 + b * 60 + c;
}

/* ---------------------------------------------------------------- text ---- */

const ABBR = {};
('mr mrs ms dr prof rev sr jr st vs etc eg ie approx fig no vol dept ltd inc co ' +
 'jan feb mar apr jun jul aug sept sep oct nov dec mon tue wed thu fri sat sun ' +
 'am pm hrs mins max min ph phd ave rd blvd apt cf viz').split(' ')
  .forEach(w => { ABBR[w] = true; });

// Words that must not be left dangling at the end of a line: a line break is a
// pause for the eye, and pausing after "the" or "of" costs you the phrase.
const DANGLERS = {};
('a an the and or but nor so yet of to in on at by for with from into onto as ' +
 'is are was were be been am do does did has have had will would can could ' +
 'shall should may might must not no if that which who whom whose this these ' +
 'those my your his her its our their there here than then when while because ' +
 'about after before between during over under through very more most such')
  .split(' ').forEach(w => { DANGLERS[w] = true; });

// Words worth breaking *before*: they open a clause, so the line starts cleanly.
const OPENERS = {};
('and but or because so that which who when while if although though after ' +
 'before until unless whereas however therefore then')
  .split(' ').forEach(w => { OPENERS[w] = true; });

function bare(word) {
  return String(word || '').toLowerCase().replace(/^[^\w']+|[^\w']+$/g, '');
}

function isSentenceEnd(word) {
  const w = String(word || '');
  if (!/[.!?…]["'”’)\]]*$/.test(w)) return false;
  if (/[!?…]/.test(w)) return true;
  // "Dr." and "vs." end in a full stop and no sentence with them.
  const body = w.replace(/[."'”’)\]]+$/, '').toLowerCase();
  if (ABBR[body]) return false;
  return !/^[A-Z]$/.test(body.toUpperCase()) || body.length > 1;
}

function isClauseEnd(word) {
  return /[,;:—–-]["'”’)\]]*$/.test(String(word || ''));
}

function tokenise(text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t ? t.split(' ') : [];
}

function wordsText(words) {
  return (words || []).map(w => w.w).join(' ');
}

/* A word's share of an utterance's duration. Speech is closer to constant per
   syllable than per character, so vowel groups are counted and the character
   count only breaks ties. Used when an engine gives one timing for a whole
   phrase and the words inside it have to be placed by inference. */
function weight(word) {
  const w = bare(word);
  if (!w) return 1;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  let syl = groups ? groups.length : 1;
  if (/[^aeiouy]{3,}$/.test(w)) syl += 0.5;      // consonant pile-up: "strengths"
  return Math.max(0.6, syl) + w.length / 14;
}

// One phrase with one pair of timings → a word each, placed by weight.
function spread(text, s, e) {
  const toks = tokenise(text);
  if (!toks.length) return [];
  const ws = toks.map(weight);
  const total = ws.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0.001, (e - s));
  const out = [];
  let at = s;
  for (let i = 0; i < toks.length; i++) {
    const d = span * ws[i] / total;
    out.push({ w: toks[i], s: at, e: at + d });
    at += d;
  }
  out[out.length - 1].e = e;
  return out;
}

/* ------------------------------------------------------- line breaking ---- */

/* Subtitle characters-per-second, the industry's measure of whether a line can
   actually be read in the time it is on screen. Spaces count; line breaks do
   not, because they are not read. */
function charCount(text) {
  return String(text == null ? '' : text).replace(/\n/g, '').length;
}

function cps(cue) {
  const d = (cue.e - cue.s);
  return d > 0.02 ? charCount(cue.text) / d : Infinity;
}

/* Where to break one line in two. Balance matters, but not as much as breaking
   at a joint in the sentence: after punctuation, or before a word that opens a
   clause, and never after "the". */
function bestBreak(toks, target) {
  let best = -1, bestScore = -Infinity;
  const lens = [];
  let run = 0;
  for (let i = 0; i < toks.length; i++) { run += toks[i].length + (i ? 1 : 0); lens.push(run); }
  const total = lens[lens.length - 1];
  for (let i = 0; i < toks.length - 1; i++) {
    const left = lens[i], right = total - left - 1;
    let score = -Math.abs((target || total / 2) - left) * 1.2 - Math.abs(left - right) * 0.35;
    const w = toks[i], next = toks[i + 1];
    if (isSentenceEnd(w)) score += 90;
    else if (isClauseEnd(w)) score += 55;
    if (OPENERS[bare(next)]) score += 26;
    if (DANGLERS[bare(w)]) score -= 55;
    if (/[("'“‘]$/.test(w)) score -= 70;                     // never orphan an opening quote
    if (/^\d+$/.test(bare(w)) && /^(%|per|of)/.test(bare(next))) score -= 30;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/* Lay text out over at most maxLines lines of at most maxChars. A manual break
   in the text is respected as it stands — if someone has broken a line by hand
   they had a reason, and re-flowing it behind their back is rude. */
function wrapLines(text, maxChars, maxLines) {
  const raw = String(text == null ? '' : text);
  if (raw.indexOf('\n') >= 0) return raw.split('\n').map(l => l.trim());
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return [''];
  maxChars = maxChars || 37;
  maxLines = Math.max(1, maxLines || 2);
  if (t.length <= maxChars || maxLines === 1) return [t];

  const toks = tokenise(t);
  const want = Math.min(maxLines, Math.max(2, Math.ceil(t.length / maxChars)));

  function lay(list, lines) {
    const s = list.join(' ');
    if (lines < 2 || list.length < 2 || s.length <= maxChars) return [s];
    const half = Math.floor(lines / 2);
    const target = s.length * half / lines;
    const at = bestBreak(list, target);
    if (at < 0) return [s];
    return lay(list.slice(0, at + 1), half).concat(lay(list.slice(at + 1), lines - half));
  }
  return lay(toks, want);
}

function cueLines(cue, o) {
  return wrapLines(cue.text, (o || {}).maxChars, (o || {}).maxLines);
}

/* --------------------------------------------------------- cue building ---- */

const SPOT = {
  maxChars: 37,       // characters per line
  maxLines: 2,
  minDur: 1.2,        // a cue below this flashes past unread
  maxDur: 6,
  maxCps: 14,         // reading speed ceiling; broadcast uses 15–17
  minGap: 0.1,        // blank frames between cues, so two cues never look like one
  gapSplit: 0.45,     // a silence this long is a natural cue boundary
  minChars: 12,       // don't start a new cue for a fragment shorter than this
  lead: 0.05,         // in-time a touch early
  trail: 0.4,         // out-time held into following silence, for reading time
  sentenceCues: false // one cue per sentence, however long
};

function opts(o) {
  return Object.assign({}, SPOT, o || {});
}

function cueOf(words) {
  return { s: words[0].s, e: words[words.length - 1].e, text: wordsText(words), w: words.slice() };
}

// Semantic grouping first: sentence ends and real silences only.
function groupWords(words, o) {
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = words[i + 1];
    const chars = wordsText(cur).length;
    if (!next) { out.push(cur); break; }
    const gap = next.s - words[i].e;
    let cut = false;
    if (isSentenceEnd(words[i].w) && chars >= o.minChars) cut = true;
    else if (!o.sentenceCues && gap >= o.gapSplit && chars >= o.minChars) cut = true;
    else if (chars > o.maxChars * o.maxLines * 4) cut = true;   // runaway, with no punctuation
    if (cut) { out.push(cur); cur = []; }
  }
  return out;
}

function fitsOne(words, o) {
  const text = wordsText(words);
  const dur = words[words.length - 1].e - words[0].s;
  return text.length <= o.maxChars * o.maxLines && dur <= o.maxDur;
}

/* Too long for one cue: cut it where a reader would. Punctuation and pauses
   win over the halfway mark, which is why this is not just a character count. */
function splitGroup(words, o, depth) {
  if (words.length < 2 || fitsOne(words, o) || (depth || 0) > 12) return [words];
  let best = -1, bestScore = -Infinity;
  const texts = [];
  let run = 0;
  for (let i = 0; i < words.length; i++) { run += words[i].w.length + (i ? 1 : 0); texts.push(run); }
  const total = texts[texts.length - 1];
  for (let i = 0; i < words.length - 1; i++) {
    const left = texts[i], right = total - left - 1;
    const gap = words[i + 1].s - words[i].e;
    let score = -Math.abs(left - right) * 0.3 + Math.min(gap, 1.2) * 70;
    if (isSentenceEnd(words[i].w)) score += 120;
    else if (isClauseEnd(words[i].w)) score += 70;
    if (OPENERS[bare(words[i + 1].w)]) score += 30;
    if (DANGLERS[bare(words[i].w)]) score -= 60;
    // Both halves should be worth being a cue on their own.
    if (left < o.minChars || right < o.minChars) score -= 120;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) return [words];
  return splitGroup(words.slice(0, best + 1), o, (depth || 0) + 1)
    .concat(splitGroup(words.slice(best + 1), o, (depth || 0) + 1));
}

/* The opposite problem: a three-word cue followed by another three-word cue,
   when together they would read as one line. */
function mergeShort(cues, o) {
  const out = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i], prev = out[out.length - 1];
    const joinedText = prev ? prev.text + ' ' + cue.text : '';
    const gap = prev ? cue.s - prev.e : Infinity;
    const shortOne = prev && (prev.e - prev.s < o.minDur || cue.e - cue.s < o.minDur);
    const endsSentence = prev && isSentenceEnd(prev.text.split(' ').pop());
    if (prev && shortOne && gap < o.gapSplit && !endsSentence &&
        joinedText.length <= o.maxChars * o.maxLines &&
        cue.e - prev.s <= o.maxDur) {
      prev.text = joinedText;
      prev.e = cue.e;
      prev.w = (prev.w && cue.w) ? prev.w.concat(cue.w) : null;
    } else {
      out.push(Object.assign({}, cue));
    }
  }
  return out;
}

/* Reading time. A cue that appears exactly as the word is spoken and vanishes
   exactly as it ends is technically right and hard to read, so the in-time is
   nudged a touch early and the out-time is held into whatever silence follows.

   This belongs to spotting, not to repair: it is done once, from the spoken
   times, which is why fixTiming below does not do it. Applied on every pass it
   would creep — each run lengthening every cue by another fraction. */
function readingTime(cues, o, mediaDur) {
  const cap = (mediaDur && isFinite(mediaDur)) ? mediaDur : Infinity;
  const starts = cues.map(c => Math.max(0, c.s - o.lead));
  return cues.map((c, i) => {
    const next = cues[i + 1];
    const ceil = Math.min(next ? starts[i + 1] - o.minGap : cap, cap);
    return Object.assign({}, c, { s: starts[i], e: Math.max(c.e, Math.min(c.e + o.trail, ceil)) });
  });
}

/* Repair pass: nothing overlaps, nothing flashes past unread, nothing outstays
   the ceiling, everything keeps a blank frame or two from its neighbour, and
   nothing runs off the end of the media. Safe to run after every edit — run
   twice it gives the same answer as run once. */
function fixTiming(cues, o, mediaDur) {
  o = opts(o);
  const list = cues.slice().sort((a, b) => a.s - b.s).map(c => Object.assign({}, c));
  const cap = (mediaDur && isFinite(mediaDur)) ? mediaDur : Infinity;
  for (let i = 0; i < list.length; i++) {
    const c = list[i], prev = list[i - 1], next = list[i + 1];
    const floor = prev ? prev.e + o.minGap : 0;
    const ceil = Math.min(next ? next.s - o.minGap : cap, cap);

    c.s = Math.max(0, c.s);
    if (c.s < floor) c.s = floor;

    let want = Math.min(Math.max(c.e, c.s + o.minDur), ceil);
    if (want - c.s > o.maxDur) want = c.s + o.maxDur;
    // A cue with no room left is still better shown briefly than shown over its
    // neighbour, so clamp rather than drop.
    c.e = Math.max(c.s + 0.08, want);
  }
  return list;
}

function buildCues(words, o) {
  o = opts(o);
  const clean = (words || []).filter(w => w && w.w && isFinite(w.s) && isFinite(w.e) && w.e > w.s)
    .sort((a, b) => a.s - b.s);
  if (!clean.length) return [];
  let cues = [];
  groupWords(clean, o).forEach(g => {
    splitGroup(g, o).forEach(part => { if (part.length) cues.push(cueOf(part)); });
  });
  if (!o.sentenceCues) cues = mergeShort(cues, o);
  return fixTiming(readingTime(cues, o, o.mediaDur), o, o.mediaDur);
}

/* ---------------------------------------------------------- cue editing ---- */

// Split one cue in two at a character offset in its text, putting the seam on
// the nearest word boundary and taking the time from the words if they survive.
function splitCue(cue, charIndex) {
  const text = cue.text.replace(/\n/g, ' ');
  let at = Math.max(0, Math.min(text.length, charIndex == null ? Math.round(text.length / 2) : charIndex));
  // Walk to the nearest space so a word is never cut in half.
  if (at > 0 && at < text.length && text.charAt(at) !== ' ') {
    let back = at, fwd = at;
    while (back > 0 && text.charAt(back) !== ' ') back--;
    while (fwd < text.length && text.charAt(fwd) !== ' ') fwd++;
    at = (at - back <= fwd - at) ? back : fwd;
  }
  const left = text.slice(0, at).trim(), right = text.slice(at).trim();
  if (!left || !right) return [Object.assign({}, cue)];

  const n = tokenise(left).length;
  let cut;
  if (cue.w && cue.w.length > n && cue.w.length === tokenise(text).length) {
    cut = (cue.w[n - 1].e + cue.w[n].s) / 2;
  } else {
    cut = cue.s + (cue.e - cue.s) * (left.length / (left.length + right.length));
  }
  cut = Math.min(Math.max(cut, cue.s + 0.05), cue.e - 0.05);
  const ws = cue.w && cue.w.length === tokenise(text).length ? cue.w : null;
  return [
    { s: cue.s, e: cut, text: left, w: ws ? ws.slice(0, n) : null },
    { s: cut, e: cue.e, text: right, w: ws ? ws.slice(n) : null }
  ];
}

function mergeCue(a, b) {
  return {
    s: Math.min(a.s, b.s),
    e: Math.max(a.e, b.e),
    text: (a.text.replace(/\n/g, ' ') + ' ' + b.text.replace(/\n/g, ' ')).replace(/\s+/g, ' ').trim(),
    w: (a.w && b.w) ? a.w.concat(b.w) : null
  };
}

// Whole-file sync fix: everything moves, nothing goes below zero or past the end.
function shiftCues(cues, delta, mediaDur) {
  const cap = (mediaDur && isFinite(mediaDur)) ? mediaDur : Infinity;
  return cues.map(c => {
    const d = c.e - c.s;
    let s = Math.max(0, c.s + delta);
    if (s + d > cap) s = Math.max(0, cap - d);
    return Object.assign({}, c, { s: s, e: Math.min(cap, s + d) });
  });
}

function cueAt(cues, t) {
  for (let i = 0; i < cues.length; i++) if (t >= cues[i].s && t <= cues[i].e) return i;
  return -1;
}

/* What is wrong with this file, in the order a subtitler would care. Each entry
   points at a cue, so the interface can walk you through them. */
function problems(cues, o) {
  o = opts(o);
  const out = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i], prev = cues[i - 1];
    const lines = cueLines(c, o);
    if (!c.text.trim()) out.push({ i: i, kind: 'empty', msg: 'Empty cue' });
    if (cps(c) > o.maxCps + 0.5) {
      out.push({ i: i, kind: 'fast', msg: 'Too fast to read (' + cps(c).toFixed(1) + ' cps)' });
    }
    if (c.e - c.s < o.minDur - 0.05) {
      out.push({ i: i, kind: 'short', msg: 'On screen only ' + (c.e - c.s).toFixed(2) + ' s' });
    }
    if (c.e - c.s > o.maxDur + 0.05) {
      out.push({ i: i, kind: 'long', msg: 'On screen ' + (c.e - c.s).toFixed(1) + ' s' });
    }
    if (lines.length > o.maxLines) out.push({ i: i, kind: 'lines', msg: lines.length + ' lines' });
    lines.forEach(l => {
      if (l.length > o.maxChars) out.push({ i: i, kind: 'wide', msg: 'Line of ' + l.length + ' characters' });
    });
    if (prev && c.s < prev.e - 0.001) out.push({ i: i, kind: 'overlap', msg: 'Overlaps the cue before' });
    else if (prev && c.s - prev.e < o.minGap - 0.001) out.push({ i: i, kind: 'tight', msg: 'No gap after the cue before' });
  }
  return out;
}

/* ---------------------------------------------------------------- files ---- */

function toSRT(cues, o) {
  return cues.map((c, i) =>
    (i + 1) + '\n' + fmtStamp(c.s, ',') + ' --> ' + fmtStamp(c.e, ',') + '\n' +
    cueLines(c, o).join('\n')
  ).join('\n\n') + '\n';
}

function toVTT(cues, o) {
  return 'WEBVTT\n\n' + cues.map((c, i) =>
    (i + 1) + '\n' + fmtStamp(c.s, '.') + ' --> ' + fmtStamp(c.e, '.') + '\n' +
    cueLines(c, o).join('\n')
  ).join('\n\n') + '\n';
}

/* A plain reading transcript: cues rejoined into paragraphs, a new one wherever
   the speaker left a real pause. This is the file to hand to Clear Read. */
function toText(cues, gap) {
  const paras = [];
  let cur = [];
  for (let i = 0; i < cues.length; i++) {
    cur.push(cues[i].text.replace(/\n/g, ' ').trim());
    const next = cues[i + 1];
    if (!next || next.s - cues[i].e >= (gap || 1.6)) { paras.push(cur.join(' ')); cur = []; }
  }
  return paras.filter(Boolean).join('\n\n') + '\n';
}

/* Reads back what we write, and what other tools write: SubRip and WebVTT,
   with or without cue numbers, with either decimal mark. */
function parseSubs(text) {
  const src = String(text == null ? '' : text).replace(/\r/g, '').replace(/^﻿/, '');
  const out = [];
  const blocks = src.split(/\n{2,}/);
  for (let b = 0; b < blocks.length; b++) {
    const lines = blocks[b].split('\n').filter(l => l.trim() !== '');
    if (!lines.length) continue;
    if (/^WEBVTT/.test(lines[0])) lines.shift();
    if (lines.length && /^\d+$/.test(lines[0].trim()) && lines.length > 1) lines.shift();
    if (!lines.length) continue;
    const m = lines[0].match(/^\s*(\S+)\s*-->\s*(\S+)/);
    if (!m) continue;
    const s = parseStamp(m[1]), e = parseStamp(m[2]);
    if (s == null || e == null) continue;
    const body = lines.slice(1).join('\n').trim();
    if (!body) continue;
    out.push({ s: s, e: Math.max(e, s + 0.05), text: body, w: null });
  }
  return out;
}

/* ------------------------------------------------- transcription replies ---- */

/* One reader for several services, because they all describe the same thing:
     OpenAI-compatible verbose_json — words[] {word,start,end}, else segments[]
     Deepgram                       — results.channels[].alternatives[].words[]
   A reply with text but no timings is still useful, so it comes back flagged
   rather than thrown away: the words can be spread over the chunk's own span. */
function parseTranscript(data, offset, span) {
  offset = offset || 0;
  const shift = w => ({ w: w.w, s: w.s + offset, e: w.e + offset });

  /* Whisper running in this browser (transformers.js): chunks of
     { text, timestamp: [start, end] }. The end is sometimes null — the model
     did not close the word — so it is filled from the next word's start. */
  if (data && data.chunks && data.chunks.length && data.chunks[0].timestamp) {
    const cs = data.chunks;
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      const t = cs[i].timestamp || [];
      const text = String(cs[i].text == null ? '' : cs[i].text).trim();
      const s = +t[0];
      if (!text || !isFinite(s)) continue;
      let e = +t[1];
      if (!isFinite(e) || e <= s) {
        const next = cs[i + 1] && cs[i + 1].timestamp && +cs[i + 1].timestamp[0];
        e = (isFinite(next) && next > s) ? next : s + 0.25;
      }
      out.push(shift({ w: text, s: s, e: e }));
    }
    if (out.length) return { words: out, timed: true };
  }

  if (data && data.results && data.results.channels) {
    const alt = ((data.results.channels[0] || {}).alternatives || [])[0] || {};
    if (alt.words && alt.words.length) {
      return {
        words: alt.words.map(w => shift({
          w: w.punctuated_word || w.word, s: +w.start, e: +w.end
        })), timed: true
      };
    }
    if (alt.transcript) return { words: spread(alt.transcript, offset, offset + (span || 0)), timed: false };
  }

  if (data && data.words && data.words.length && data.words[0].start !== undefined) {
    return {
      words: data.words.map(w => shift({ w: w.word || w.text, s: +w.start, e: +w.end })),
      timed: true
    };
  }

  if (data && data.segments && data.segments.length) {
    let words = [];
    let timed = false;
    data.segments.forEach(seg => {
      if (seg.words && seg.words.length && seg.words[0].start !== undefined) {
        timed = true;
        seg.words.forEach(w => words.push(shift({ w: w.word || w.text, s: +w.start, e: +w.end })));
      } else if (seg.text) {
        words = words.concat(spread(seg.text, +seg.start + offset, +seg.end + offset));
      }
    });
    if (words.length) return { words: words, timed: timed };
  }

  const plain = data && (typeof data === 'string' ? data : data.text);
  if (plain) return { words: spread(plain, offset, offset + (span || 0)), timed: false };
  return { words: [], timed: false };
}

/* ----------------------------------------------------- whisper, in here ----

   The source of the worker that runs Whisper in this browser. It lives here,
   as a string, for two reasons: this app is one file, so there is no second
   file to ship a worker in — it is built into a blob at run time — and a worker
   assembled from a string is otherwise the one piece of code nothing can check.
   From here, the test can at least hand it to a parser.                     */
function whisperWorkerSource(cdn) {
  return `import { pipeline } from "${cdn}";

let asr = null, loaded = "";

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type !== "run") return;
    // The pipeline is kept only while the model and the device both match: a
    // fallback from WebGPU to the processor has to build a new one.
    if (loaded !== m.model + "@" + m.device) {
      asr = await pipeline("automatic-speech-recognition", m.model, {
        // q4 on the decoder is the difference between running and not on a
        // phone; the encoder stays fp32 on WebGPU, where quantising it costs
        // accuracy for very little memory.
        dtype: m.device === "webgpu"
          ? { encoder_model: "fp32", decoder_model_merged: "q4" }
          : "q8",
        device: m.device,
        progress_callback: p => self.postMessage({ type: "loading", p: p })
      });
      loaded = m.model + "@" + m.device;
      self.postMessage({ type: "ready", device: m.device });
    }
    let windows = 0;
    const opts = {
      return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5,
      // Whisper works in thirty-second windows. Reporting each one as it lands
      // is the only sign of life there is during a long piece — without it the
      // page looks hung for minutes at a time, which is worse than slow.
      chunk_callback: () => self.postMessage({ type: "tick", windows: ++windows })
    };
    // An English-only model must not be told a language at all.
    if (m.language && !/\\.en$/.test(m.model)) {
      opts.language = m.language;
      opts.task = "transcribe";
    }
    const out = await asr(m.pcm, opts);
    self.postMessage({
      type: "result", offset: m.offset,
      chunks: out.chunks || [], text: out.text || ""
    });
  } catch (err) {
    self.postMessage({ type: "failed", message: String((err && err.message) || err) });
  }
};
`;
}

/* ------------------------------------------------- correcting the words ----

   Recognition mishears words that sound like other words, and no recogniser can
   know that a programme called The Traitors means "traitors" every time it hears
   "traders". A reader who knows what the programme is can, which is what this
   exchange is for: the lines go out numbered and come back numbered, so the
   timings never leave this device and a reply that garbles the format changes
   nothing it cannot account for.                                            */

function fixSystem(notes) {
  return [
    'You are correcting the text of subtitles produced by automatic speech recognition.',
    notes ? '\nWhat this is:\n' + String(notes).trim() : '',
    '',
    'Correct:',
    '- words the recogniser misheard, above all ones that sound like the word actually meant',
    '  (a programme called The Traitors says "traitors", however often "traders" was heard);',
    '- the spelling and capitalisation of names, places and terms;',
    '- obvious punctuation and sentence case.',
    '',
    'Do not:',
    '- translate, summarise, rephrase, tidy, censor or improve the wording;',
    '- change a line that is already right — return it exactly as it came;',
    '- merge, split, add, drop or renumber lines;',
    '- change the length much. Each line has a fixed time on screen.',
    '',
    'Some lines are marked "context:" — they are there to be read, not corrected,',
    'and must not appear in your reply.',
    '',
    'Reply with one line per subtitle, each as its number, a vertical bar, and the',
    'corrected text:',
    '',
    '12| the corrected text of subtitle 12',
    '',
    'Reply with nothing else — no preamble, no explanation, no code fence.'
  ].filter(l => l !== null).join('\n');
}

// One batch of lines to correct, with a few before it for context only.
function fixLines(cues, from, count, context) {
  const out = [];
  const start = Math.max(0, from - (context || 0));
  for (let i = start; i < Math.min(cues.length, from + count); i++) {
    const text = cues[i].text.replace(/\s*\n\s*/g, ' ').trim();
    out.push((i < from ? 'context: ' : '') + (i + 1) + '| ' + text);
  }
  return out.join('\n');
}

function fixPrompt(cues, from, count, notes, context) {
  return fixSystem(notes) + '\n\nThe subtitles:\n\n' + fixLines(cues, from, count, context);
}

/* Reads the reply back. Anything that is not a numbered line is ignored, which
   covers a stray "Here are the corrections:" and a fenced block alike. */
function fixParse(reply) {
  const out = {};
  String(reply == null ? '' : reply).split('\n').forEach(line => {
    const m = line.match(/^\s*(?:context:\s*)?(\d{1,6})\s*[|｜]\s?(.*)$/);
    if (!m) return;
    const n = +m[1];
    const text = m[2].replace(/\s+$/, '');
    if (!text.trim()) return;
    if (/^context:/i.test(line.trim())) return;      // it was told not to, but still
    out[n] = text.trim();
  });
  return out;
}

/* Applies a reply to the cues, and says exactly what it changed. Only the text
   moves; every in and out time is left alone. */
function fixApply(cues, byNumber) {
  const changed = [];
  const next = cues.map((c, i) => {
    const got = byNumber[i + 1];
    const was = c.text;
    if (got === undefined || got === was.replace(/\s*\n\s*/g, ' ').trim() || got === was) return c;
    changed.push({ i: i, before: was, after: got });
    return Object.assign({}, c, { text: got, w: null });
  });
  return { cues: next, changed: changed };
}

/* ---------------------------------------------------------------- audio ---- */

/* An hour of video is hundreds of megabytes and no transcription service wants
   it. What it wants is the speech: one channel, 16 kHz, 16-bit — about 2 MB a
   minute, and nothing is lost that matters, since 16 kHz keeps everything up to
   8 kHz and speech lives below that. */

function toMono(channels, length) {
  const n = channels.length;
  if (n === 1) return channels[0];
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < n; c++) sum += channels[c][i];
    out[i] = sum / n;
  }
  return out;
}

/* Box-average resampling. Picking every Nth sample instead would fold
   everything above the new Nyquist back down as aliasing noise — cheap to do
   and it makes a recogniser worse, which is the one thing we are here for. */
function resample(src, srcRate, dstRate) {
  if (!srcRate || srcRate === dstRate) return src;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const from = i * ratio, to = from + ratio;
    let a = Math.floor(from), b = Math.min(src.length, Math.ceil(to));
    let sum = 0, n = 0;
    for (let j = a; j < b; j++) { sum += src[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function wavBytes(pcm, rate) {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                 // PCM
  v.setUint16(22, 1, true);                 // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);          // byte rate
  v.setUint16(32, 2, true);                 // block align
  v.setUint16(34, 16, true);                // bits
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/* Services cap the upload, so long audio is cut into pieces — and a piece must
   not start mid-word, or the word is lost from both sides. So near each target
   boundary the quietest 100 ms in a window either side is found, and the cut is
   made there. Returns sample offsets, first to last, starting at 0. */
function splitPoints(pcm, rate, maxSec, searchSec) {
  const out = [0];
  if (!pcm.length || !rate) return out;
  const maxLen = Math.floor(maxSec * rate);
  if (pcm.length <= maxLen) return out;
  const frame = Math.max(1, Math.floor(rate * 0.1));
  const search = Math.floor((searchSec || 15) * rate);
  let at = 0;
  while (pcm.length - at > maxLen) {
    const target = at + maxLen;
    const from = Math.max(at + Math.floor(maxLen * 0.4), target - search);
    const to = Math.min(pcm.length - frame, target + Math.floor(search * 0.2));
    let bestAt = target, bestE = Infinity;
    for (let i = from; i < to; i += frame) {
      let sum = 0;
      for (let j = i; j < i + frame; j++) sum += pcm[j] * pcm[j];
      if (sum < bestE) { bestE = sum; bestAt = i + Math.floor(frame / 2); }
    }
    out.push(bestAt);
    at = bestAt;
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = {
  fmtStamp, fmtClock, parseStamp, tokenise, weight, spread, charCount, cps,
  wrapLines, cueLines, bestBreak, isSentenceEnd, isClauseEnd,
  SPOT, opts, groupWords, splitGroup, mergeShort, readingTime, fixTiming, buildCues,
  splitCue, mergeCue, shiftCues, cueAt, problems,
  toSRT, toVTT, toText, parseSubs, parseTranscript,
  fixSystem, fixLines, fixPrompt, fixParse, fixApply, whisperWorkerSource,
  toMono, resample, wavBytes, splitPoints
};
