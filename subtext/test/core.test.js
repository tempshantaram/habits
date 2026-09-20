/* node test/core.test.js — the pure half, without a browser or a video.

   Everything awkward about subtitles is in here: where a line breaks, how long
   a cue has to stay up to be readable, what happens when an engine hands back
   words with no timings, and where you may cut an hour of audio in half. */

const C = require('../src/core.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(name, a === b, 'got  ' + a + '\n      want ' + b);
}
function near(name, got, want, tol) {
  ok(name, Math.abs(got - want) <= (tol || 0.005), 'got ' + got + ' want ' + want);
}

/* ---- timestamps ---- */
eq('srt stamp', C.fmtStamp(3661.5, ','), '01:01:01,500');
eq('vtt stamp', C.fmtStamp(0.004, '.'), '00:00:00.004');
eq('stamp rounds, does not truncate', C.fmtStamp(1.9999, ','), '00:00:02,000');
eq('clock under an hour', C.fmtClock(62.35), '1:02.4');
eq('clock over an hour', C.fmtClock(3723), '1:02:03.0');
near('parse srt stamp', C.parseStamp('01:01:01,500'), 3661.5);
near('parse vtt stamp', C.parseStamp('00:00:02.250'), 2.25);
near('parse mm:ss', C.parseStamp('2:30'), 150);
near('parse bare seconds', C.parseStamp('12.5'), 12.5);
eq('parse rubbish', C.parseStamp('later on'), null);

/* ---- line breaking ---- */
eq('short text stays on one line', C.wrapLines('Hello there', 37, 2), ['Hello there']);
eq('breaks after the comma, not at the middle',
  C.wrapLines('When the tide went out, the whole bay was mud', 30, 2),
  ['When the tide went out,', 'the whole bay was mud']);
eq('breaks before a conjunction',
  C.wrapLines('She checked the mooring lines and then went below', 30, 2),
  ['She checked the mooring lines', 'and then went below']);
ok('never leaves an article dangling', (function () {
  const lines = C.wrapLines('He handed over the last of the ropes to the boy', 26, 2);
  return !/\b(the|a|an|of|to)$/i.test(lines[0]);
})(), JSON.stringify(C.wrapLines('He handed over the last of the ropes to the boy', 26, 2)));
eq('a manual break is left alone', C.wrapLines('one line\nsecond line', 37, 2), ['one line', 'second line']);
ok('three lines when allowed', C.wrapLines(
  'A much longer stretch of speech that cannot possibly sit on two short lines at all', 24, 3).length === 3);
ok('one line when only one is allowed',
  C.wrapLines('A much longer stretch of speech here', 12, 1).length === 1);

/* ---- word helpers ---- */
eq('sentence end', [C.isSentenceEnd('out.'), C.isSentenceEnd('Dr.'), C.isSentenceEnd('now!'),
  C.isSentenceEnd('and')], [true, false, true, false]);
eq('clause end', [C.isClauseEnd('out,'), C.isClauseEnd('out')], [true, false]);
ok('spread places words across the span and lands on the end', (function () {
  const w = C.spread('the quick brown fox', 10, 12);
  return w.length === 4 && Math.abs(w[0].s - 10) < 1e-9 && Math.abs(w[3].e - 12) < 1e-9 &&
    w.every((x, i) => i === 0 || x.s >= w[i - 1].e - 1e-9);
})());
ok('longer words get more of the span',
  C.weight('extraordinary') > C.weight('cat'));

/* ---- cue building ---- */
// A line of speech with real timings: 2 words a second, a pause at the full stop.
function say(text, from, wordDur, gapAfterStop) {
  const out = [];
  let t = from;
  text.split(' ').forEach(w => {
    out.push({ w: w, s: t, e: t + wordDur });
    t += wordDur;
    if (/[.!?]$/.test(w)) t += (gapAfterStop === undefined ? 0.6 : gapAfterStop);
  });
  return out;
}

const speech = say('The harbour was empty by then. Every boat had gone out on the tide before dawn.', 0, 0.42);
const cues = C.buildCues(speech, { mediaDur: 60 });
ok('splits at the sentence end', cues.length >= 2, JSON.stringify(cues.map(c => c.text)));
ok('first cue is the first sentence', /^The harbour was empty by then\.$/.test(cues[0].text), cues[0].text);
ok('no cue is longer than the ceiling', cues.every(c => c.e - c.s <= C.SPOT.maxDur + 0.01));
ok('every cue fits two lines', cues.every(c => C.cueLines(c, C.SPOT).length <= 2),
  JSON.stringify(cues.map(c => C.cueLines(c, C.SPOT))));
ok('no line is over the character limit',
  cues.every(c => C.cueLines(c, C.SPOT).every(l => l.length <= C.SPOT.maxChars)),
  JSON.stringify(cues.map(c => C.cueLines(c, C.SPOT))));
ok('cues do not overlap', cues.every((c, i) => i === 0 || c.s >= cues[i - 1].e - 1e-9));
ok('there is a gap between cues',
  cues.every((c, i) => i === 0 || c.s - cues[i - 1].e >= C.SPOT.minGap - 1e-9));
ok('nothing starts before zero', cues.every(c => c.s >= 0));
eq('no words in, no cues out', C.buildCues([], {}), []);
eq('rubbish words are dropped', C.buildCues([{ w: 'x', s: 5, e: 1 }, { w: '', s: 0, e: 1 }], {}), []);

// A very long sentence with no punctuation at all must still be cut up.
const runOn = say(('and then we walked along the wall past the boats and the nets and the ' +
  'sheds and the ice house and the crane and the empty slipway and the water').trim(), 0, 0.3);
const runCues = C.buildCues(runOn, { mediaDur: 60 });
ok('a run-on sentence is still broken into cues', runCues.length >= 3, String(runCues.length));
ok('no line over the limit in a run-on',
  runCues.every(c => C.cueLines(c, C.SPOT).every(l => l.length <= C.SPOT.maxChars)),
  JSON.stringify(runCues.map(c => C.cueLines(c, C.SPOT))));

// Three quick words on their own should join the line next to them.
const stubs = [
  { w: 'Yes.', s: 0, e: 0.3 },
  { w: 'I', s: 0.4, e: 0.5 }, { w: 'think', s: 0.5, e: 0.8 }, { w: 'so.', s: 0.8, e: 1.0 }
];
ok('fragments are merged rather than flashed', C.buildCues(stubs, { mediaDur: 10 }).length === 1,
  JSON.stringify(C.buildCues(stubs, { mediaDur: 10 }).map(c => c.text)));

// One cue per sentence, however long, for people who read the whole line.
const sentenceMode = C.buildCues(speech, { sentenceCues: true, maxDur: 30, mediaDur: 60 });
eq('sentence mode gives one cue per sentence', sentenceMode.length, 2);

/* ---- timing pass ---- */
const tight = [
  { s: 1, e: 1.2, text: 'Barely there' },
  { s: 1.25, e: 1.4, text: 'And another' },
  { s: 30, e: 60, text: 'Far too long to leave up' }
];
const fixed = C.fixTiming(tight, {}, 40);
ok('a short cue is held to the minimum where there is room',
  fixed[1].e - fixed[1].s >= C.SPOT.minDur - 0.001 || fixed[1].e <= fixed[2].s,
  JSON.stringify(fixed));
ok('the overlap is gone', fixed[1].s >= fixed[0].e - 1e-9, JSON.stringify(fixed));
near('a long cue is capped', fixed[2].e - fixed[2].s, C.SPOT.maxDur);
ok('nothing runs past the end of the media', fixed.every(c => c.e <= 40 + 1e-9));
ok('timing pass is idempotent',
  JSON.stringify(C.fixTiming(fixed, {}, 40)) === JSON.stringify(fixed));

/* ---- problems ---- */
const bad = [
  { s: 0, e: 0.5, text: 'A whole great long line of words squeezed into half a second' },
  { s: 0.4, e: 3, text: 'Overlapping the one above' }
];
const probs = C.problems(bad, {});
ok('spots the unreadable speed', probs.some(p => p.kind === 'fast'), JSON.stringify(probs));
ok('spots the overlap', probs.some(p => p.kind === 'overlap'));
ok('spots the flash', probs.some(p => p.kind === 'short'));
eq('a clean file has no problems', C.problems(cues, C.SPOT).length, 0,
  JSON.stringify(C.problems(cues, C.SPOT)));

/* ---- editing ---- */
const one = { s: 10, e: 14, text: 'The harbour was empty and every boat had gone', w: null };
const two = C.splitCue(one, 25);
eq('split puts the seam on a word boundary', [two[0].text, two[1].text],
  ['The harbour was empty and', 'every boat had gone']);
ok('split times are in order and inside the original',
  two[0].s === 10 && two[1].e === 14 && two[0].e === two[1].s &&
  two[0].e > 10 && two[0].e < 14, JSON.stringify(two));
eq('split with nowhere to cut returns the cue', C.splitCue({ s: 0, e: 1, text: 'Word', w: null }, 0).length, 1);
const timedCue = C.buildCues(say('One two three four five six seven eight.', 0, 0.4), { mediaDur: 20 })[0];
ok('split lands on the real word timing when the words survive', (function () {
  const halves = C.splitCue(timedCue, Math.round(timedCue.text.length / 2));
  return halves.length === 2 && halves[0].w && halves[0].w.length === C.tokenise(halves[0].text).length;
})());
eq('merge joins the text and spans both', (function () {
  const m = C.mergeCue(two[0], two[1]);
  return [m.text, m.s, m.e];
})(), ['The harbour was empty and every boat had gone', 10, 14]);
ok('shift moves everything and clamps at zero',
  C.shiftCues([{ s: 1, e: 2, text: 'x' }], -5, 60)[0].s === 0);
ok('shift does not run past the end',
  C.shiftCues([{ s: 50, e: 55, text: 'x' }], 20, 60)[0].e <= 60);
eq('cueAt finds the cue under the playhead', C.cueAt([{ s: 0, e: 1, text: 'a' }, { s: 2, e: 3, text: 'b' }], 2.5), 1);
eq('cueAt in a gap', C.cueAt([{ s: 0, e: 1, text: 'a' }, { s: 2, e: 3, text: 'b' }], 1.5), -1);

/* ---- files ---- */
const srt = C.toSRT([{ s: 0, e: 2.5, text: 'First line' }, { s: 3, e: 4, text: 'Second' }]);
eq('srt shape', srt.split('\n').slice(0, 3), ['1', '00:00:00,000 --> 00:00:02,500', 'First line']);
ok('srt numbers its cues', /\n\n2\n/.test(srt), JSON.stringify(srt));
ok('vtt has its header and dots', /^WEBVTT\n\n1\n00:00:00\.000 --> /.test(C.toVTT([{ s: 0, e: 1, text: 'x' }])));
ok('a long cue is broken into two lines in the file', (function () {
  const out = C.toSRT([{ s: 0, e: 4, text: 'When the tide went out, the whole bay was mud' }], { maxChars: 30 });
  return out.split('\n').length >= 4;
})());
eq('round trip through srt', (function () {
  const back = C.parseSubs(srt);
  return [back.length, back[0].text, back[0].s, back[1].e];
})(), [2, 'First line', 0, 4]);
eq('round trip through vtt', C.parseSubs(C.toVTT(cues)).length, cues.length);
eq('reads a vtt with no cue numbers',
  C.parseSubs('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n').length, 1);
eq('reads srt with windows line endings and a bom',
  C.parseSubs('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n').length, 1);
eq('ignores a block with no timing line', C.parseSubs('just some notes\n\nand more').length, 0);
eq('transcript paragraphs break on a real pause',
  C.toText([{ s: 0, e: 1, text: 'One.' }, { s: 1.2, e: 2, text: 'Two.' }, { s: 9, e: 10, text: 'Three.' }])
    .trim().split('\n\n'), ['One. Two.', 'Three.']);

/* ---- transcription replies ---- */
eq('openai words', C.parseTranscript({
  text: 'hello there', words: [{ word: 'hello', start: 0.1, end: 0.4 }, { word: 'there', start: 0.4, end: 0.9 }]
}, 10).words, [{ w: 'hello', s: 10.1, e: 10.4 }, { w: 'there', s: 10.4, e: 10.9 }]);
eq('openai segments without words are spread over the segment', (function () {
  const r = C.parseTranscript({ segments: [{ start: 0, end: 2, text: 'two words' }] }, 0);
  return [r.timed, r.words.length, r.words[0].s, r.words[1].e];
})(), [false, 2, 0, 2]);
eq('deepgram words', C.parseTranscript({
  results: { channels: [{ alternatives: [{ words: [{ punctuated_word: 'Hello.', word: 'hello', start: 1, end: 1.5 }] }] }] }
}, 0).words, [{ w: 'Hello.', s: 1, e: 1.5 }]);
eq('a reply with text but no timings is spread over the chunk', (function () {
  const r = C.parseTranscript({ text: 'one two three' }, 30, 3);
  return [r.timed, r.words.length, r.words[0].s, r.words[2].e];
})(), [false, 3, 30, 33]);
eq('an empty reply', C.parseTranscript({}, 0).words, []);
eq('whisper in the browser: word chunks', C.parseTranscript({
  text: ' Hello there', chunks: [{ text: ' Hello', timestamp: [0.2, 0.6] }, { text: ' there', timestamp: [0.6, 1.1] }]
}, 5).words, [{ w: 'Hello', s: 5.2, e: 5.6 }, { w: 'there', s: 5.6, e: 6.1 }]);
eq('an unclosed word takes the next word\'s start', (function () {
  const r = C.parseTranscript({
    chunks: [{ text: 'one', timestamp: [1, null] }, { text: 'two', timestamp: [1.4, 1.9] }]
  }, 0);
  return [r.words[0].e, r.timed];
})(), [1.4, true]);
eq('a last unclosed word is given a length', C.parseTranscript({
  chunks: [{ text: 'end', timestamp: [3, null] }]
}, 0).words[0].e, 3.25);

/* ---- correcting the words ---- */
const draft = [
  { s: 0, e: 2, text: 'The traders are among us', w: null },
  { s: 2.2, e: 4, text: 'and one of them is lying.', w: null },
  { s: 4.2, e: 6, text: 'Who do you\nsuspect?', w: null }
];
ok('the prompt carries the notes', C.fixPrompt(draft, 0, 3, 'The Traitors, a BBC series').indexOf('The Traitors, a BBC series') > 0);
ok('the prompt forbids retiming', /not[\s\S]*renumber/i.test(C.fixPrompt(draft, 0, 3, '')));
eq('lines go out numbered from one', C.fixLines(draft, 0, 2, 0),
  '1| The traders are among us\n2| and one of them is lying.');
eq('a manual line break is flattened for the trip', C.fixLines(draft, 2, 1, 0), '3| Who do you suspect?');
eq('context lines are marked and start before the batch', C.fixLines(draft, 1, 2, 1),
  'context: 1| The traders are among us\n2| and one of them is lying.\n3| Who do you suspect?');

const reply = 'Here are the corrections:\n\n1| The Traitors are among us\n2| and one of them is lying.\n3| Who do you suspect?';
eq('the reply is read back by number', C.fixParse(reply),
  { 1: 'The Traitors are among us', 2: 'and one of them is lying.', 3: 'Who do you suspect?' });
eq('prose around the reply is ignored', Object.keys(C.fixParse('Sure! I fixed two words.\n\n4| Fixed line')), ['4']);
eq('a context line in the reply is ignored', C.fixParse('context: 1| something\n2| kept'), { 2: 'kept' });
eq('an empty correction is ignored', C.fixParse('1|   \n2| kept'), { 2: 'kept' });
eq('nothing usable in the reply', C.fixParse('I cannot help with that.'), {});

const applied = C.fixApply(draft, C.fixParse(reply));
eq('only the line that really changed is reported', applied.changed.map(c => c.i), [0]);
eq('a line returned with the same words keeps its manual break',
  applied.cues[2].text, 'Who do you\nsuspect?');
eq('the change is described both ways', [applied.changed[0].before, applied.changed[0].after],
  ['The traders are among us', 'The Traitors are among us']);
eq('the corrected text is in', applied.cues[0].text, 'The Traitors are among us');
ok('the timings are untouched', applied.cues.every((c, i) => c.s === draft[i].s && c.e === draft[i].e));
eq('a reply about lines that do not exist changes nothing',
  C.fixApply(draft, { 99: 'nonsense' }).changed.length, 0);
eq('an empty reply changes nothing', C.fixApply(draft, {}).changed.length, 0);

/* ---- the whisper worker ----
   It is built from a string at run time, so nothing else would ever parse it.
   Hand it to node's own parser, and check the parts that are easy to get
   wrong and silent when they are. */
(function () {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { execFileSync } = require('child_process');
  const src = C.whisperWorkerSource('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'subtext-')), 'worker.mjs');
  fs.writeFileSync(file, src);
  let err = '';
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (e) { err = String(e.stderr || e); }
  ok('the worker source parses as a module', !err, err.split('\n').slice(0, 4).join('\n'));
  ok('it imports from the cdn it was given', src.indexOf('@huggingface/transformers@3') > 0);
  ok('it asks for word timestamps', /return_timestamps:\s*"word"/.test(src));
  ok('it never sends a language to an English-only model', /\.en\$/.test(src));
  ok('it reports failures rather than dying quietly', /type:\s*"failed"/.test(src));
  fs.unlinkSync(file);
})();

/* ---- audio ---- */
eq('mono of one channel is itself', C.toMono([new Float32Array([1, 2])], 2)[1], 2);
near('channels are averaged',
  C.toMono([new Float32Array([1, 1]), new Float32Array([0, 0])], 2)[0], 0.5);
ok('resample halves the length', C.resample(new Float32Array(1000), 32000, 16000).length === 500);
ok('resample of the right rate is a no-op', (function () {
  const a = new Float32Array([0.5]);
  return C.resample(a, 16000, 16000) === a;
})());
ok('resample averages rather than picking every Nth sample', (function () {
  // Alternating +1/-1 is pure Nyquist noise: averaging pairs must cancel it.
  const src = new Float32Array(64);
  for (let i = 0; i < src.length; i++) src[i] = i % 2 ? 1 : -1;
  const out = C.resample(src, 32000, 16000);
  return out.every(v => Math.abs(v) < 1e-6);
})());
const wav = C.wavBytes(new Float32Array([0, 1, -1]), 16000);
eq('wav is riff/wave', String.fromCharCode(wav[0], wav[1], wav[2], wav[3]) + String.fromCharCode(wav[8], wav[9], wav[10], wav[11]), 'RIFFWAVE');
eq('wav header length', wav.length, 44 + 6);
eq('wav sample rate', new DataView(wav.buffer).getUint32(24, true), 16000);
eq('wav is mono 16-bit', [new DataView(wav.buffer).getUint16(22, true), new DataView(wav.buffer).getUint16(34, true)], [1, 16]);
eq('full scale does not wrap round', new DataView(wav.buffer).getInt16(46, true), 32767);
eq('negative full scale', new DataView(wav.buffer).getInt16(48, true), -32768);

ok('short audio is not split', C.splitPoints(new Float32Array(16000 * 10), 16000, 600).length === 1);
ok('long audio is split, and at the quiet part', (function () {
  const rate = 16000, secs = 1300;
  const pcm = new Float32Array(rate * secs);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 8) * 0.5;
  // A deliberate silence 20 s before the 600 s target boundary.
  const hole = Math.floor(rate * 580);
  for (let i = hole; i < hole + rate; i++) pcm[i] = 0;
  const pts = C.splitPoints(pcm, rate, 600, 30);
  return pts.length >= 2 && Math.abs(pts[1] - (hole + rate / 2)) < rate * 1.2;
})(), JSON.stringify(C.splitPoints((function () {
  const p = new Float32Array(16000 * 1300); return p;
})(), 16000, 600, 30).slice(0, 3)));
ok('split points are in order and inside the audio', (function () {
  const pcm = new Float32Array(16000 * 2000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.random() - 0.5;
  const pts = C.splitPoints(pcm, 16000, 600, 15);
  return pts[0] === 0 && pts.every((p, i) => i === 0 || (p > pts[i - 1] && p < pcm.length));
})());

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
