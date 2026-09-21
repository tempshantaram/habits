/* Subtext — the half that touches the device: the file, the picture, the
   microphone, the network and the list on screen. Everything it knows about
   subtitles themselves lives in core.js. */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const v = $('v');
  const listEl = $('list');

  /* ------------------------------------------------------------ settings -- */

  const DEFAULTS = {
    maxChars: 37, maxLines: 2, maxCps: 14, minDur: 1.2, maxDur: 6, trail: 0.4,
    sentenceCues: false, capSize: 22, theme: 'auto', fmt: 'srt',
    listenLang: 'en-GB', latency: 0.45,
    provider: 'openai', baseUrl: '', model: '', cloudLang: '', rememberKey: false, key: '',
    wModel: '', wModelChosen: false, wLang: '',
    fixNotes: '', fixModel: 'claude-opus-5', rememberFixKey: false, fixKey: ''
  };
  let S = Object.assign({}, DEFAULTS);
  try {
    const raw = localStorage.getItem('subtext.settings.v1');
    if (raw) S = Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (e) { }
  function saveSettings() {
    try {
      const keep = Object.assign({}, S);
      if (!keep.rememberKey) keep.key = '';
      if (!keep.rememberFixKey) keep.fixKey = '';
      localStorage.setItem('subtext.settings.v1', JSON.stringify(keep));
    } catch (e) { }
  }
  // The key lives here, in memory, and only reaches storage if asked.
  let apiKey = S.rememberKey ? (S.key || '') : '';

  function spot() {
    return {
      maxChars: S.maxChars, maxLines: S.maxLines, maxCps: S.maxCps,
      minDur: S.minDur, maxDur: S.maxDur, trail: S.trail,
      sentenceCues: S.sentenceCues, mediaDur: media.dur || undefined
    };
  }

  /* --------------------------------------------------------------- state -- */

  let cues = [];
  let sel = -1;                       // the cue being worked on
  let editing = false;                // its text box is open
  let media = { file: null, url: '', name: '', dur: 0 };
  let probsBy = {};                   // cue index → problems, rebuilt on render
  let scrollLock = 0;                 // don't fight the reader's own scrolling

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* --------------------------------------------------- status and toasts -- */

  let statusTimer = null;

  function openPanel() {
    return document.querySelector('.overlay:not([hidden])');
  }
  function clearPanelMsg() {
    Array.prototype.forEach.call(document.querySelectorAll('.panelmsg'), p => { p.hidden = true; });
  }

  /* Says something went wrong, where it can actually be read: inside the panel
     if one is open — which is where nearly all of these arise — and along the
     bottom of the app if none is. */
  function status(msg, keep) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (!msg) { $('status').hidden = true; clearPanelMsg(); return; }
    const panel = openPanel();
    if (panel) {
      const slot = panel.querySelector('.panelmsg');
      if (slot) {
        slot.textContent = msg;
        slot.hidden = false;
        slot.scrollIntoView({ block: 'nearest' });
        $('status').hidden = true;
        return;
      }
    }
    $('statusMsg').textContent = msg;
    $('status').hidden = false;
    if (!keep) statusTimer = setTimeout(() => { $('status').hidden = true; }, 12000);
  }
  $('statusHide').addEventListener('click', () => status(''));

  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  /* ------------------------------------------------------ the saved work -- */

  /* A phone kills a background tab without warning, and a transcript is twenty
     minutes of the day. The cues are written back after every change; the video
     itself cannot be — a browser may not hold on to a file across a reload — so
     the file is asked for again when there is work to show. */
  let saveTimer = null;
  function saveProject() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (!cues.length) { localStorage.removeItem('subtext.project.v1'); return; }
        localStorage.setItem('subtext.project.v1', JSON.stringify({
          name: media.name, dur: media.dur, at: Date.now(),
          cues: cues.map(c => ({ s: +c.s.toFixed(3), e: +c.e.toFixed(3), text: c.text }))
        }));
      } catch (e) { /* out of room: the export panel is still the way out */ }
    }, 400);
  }
  function loadProject() {
    try {
      const raw = localStorage.getItem('subtext.project.v1');
      if (!raw) return null;
      const p = JSON.parse(raw);
      return (p && p.cues && p.cues.length) ? p : null;
    } catch (e) { return null; }
  }

  /* --------------------------------------------------------- the picture -- */

  function openMedia(file) {
    if (!file) return;
    if (media.url) URL.revokeObjectURL(media.url);
    media = { file: file, url: URL.createObjectURL(file), name: file.name || 'video', dur: 0 };
    v.src = media.url;
    v.load();
    $('viewer').hidden = false;
    $('empty').hidden = true;
    $('transport').hidden = false;
    $('bar').hidden = false;
    $('transFile').textContent = media.name;
    status('');
    render();
  }

  v.addEventListener('loadedmetadata', () => {
    media.dur = isFinite(v.duration) ? v.duration : 0;
    const sound = !v.videoWidth;
    $('viewer').classList.toggle('is-sound', sound);
    $('soundOnly').hidden = !sound;
    updateClock();
    render();
  });
  v.addEventListener('error', () => {
    if (!media.file) return;
    status('This browser will not play ' + media.name + '. The subtitles can still be built from ' +
      'the audio by the service route, but there will be no picture to check them against.');
  });

  $('file').addEventListener('change', function () {
    if (this.files && this.files[0]) openMedia(this.files[0]);
    this.value = '';
  });
  const pick = () => $('file').click();
  $('pickBtn').addEventListener('click', pick);
  $('openBtn').addEventListener('click', pick);

  // Desktop: drop a video, or a subtitle file, anywhere on the page.
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
    if (!e.dataTransfer || !Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files')) return;
    e.preventDefault();
    $('app').classList.add('dropzone');
  }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
    if (ev === 'drop') e.preventDefault();
    if (ev === 'dragleave' && e.relatedTarget) return;
    $('app').classList.remove('dropzone');
  }));
  document.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/\.(srt|vtt)$/i.test(f.name)) readSubs(f);
    else openMedia(f);
  });

  /* ------------------------------------------------------------- the list -- */

  function lines(c) { return cueLines(c, spot()); }

  function flagsFor(i, c) {
    const out = [];
    const rate = cps(c);
    out.push('<span class="flag' + (rate > S.maxCps + 0.5 ? ' is-bad' : '') + '">' +
      (isFinite(rate) ? rate.toFixed(0) : '∞') + ' cps</span>');
    (probsBy[i] || []).forEach(p => {
      if (p.kind === 'fast') return;                 // already shown as the rate
      out.push('<span class="flag is-bad">' + esc(p.kind) + '</span>');
    });
    return out.join('');
  }

  // The part of a line past the limit is marked, so a too-wide line is visible
  // as a shape rather than as a number to look up.
  function lineHtml(c) {
    return lines(c).map(l => l.length > S.maxChars
      ? esc(l.slice(0, S.maxChars)) + '<em>' + esc(l.slice(S.maxChars)) + '</em>'
      : esc(l)).join('\n');
  }

  function rowHtml(i) {
    const c = cues[i];
    if (!c) return '';
    const head = '<div class="head"><span class="num">' + (i + 1) + '</span>' +
      '<span class="times">' + fmtClock(c.s) + ' → ' + fmtClock(c.e) +
      '</span><span class="flags">' + flagsFor(i, c) + '</span></div>';
    const now = i === nowRow ? ' is-now' : '';
    if (i !== sel) {
      return '<div class="cue' + now + '" data-i="' + i + '">' + head +
        '<div class="lines">' + lineHtml(c) + '</div></div>';
    }
    const body = editing
      ? '<textarea data-text="' + i + '" rows="2" spellcheck="true">' + esc(c.text) + '</textarea>'
      : '<div class="lines">' + lineHtml(c) + '</div>';
    return '<div class="cue is-sel' + now + '" data-i="' + i + '">' + head + body +
      '<div class="acts">' +
      '<input class="stamp" data-in="' + i + '" value="' + fmtStamp(c.s, '.') + '" aria-label="In">' +
      '<input class="stamp" data-out="' + i + '" value="' + fmtStamp(c.e, '.') + '" aria-label="Out">' +
      '<button class="btn tiny" data-a="play">Play</button>' +
      '<button class="btn tiny" data-a="edit">' + (editing ? 'Done' : 'Edit') + '</button>' +
      '<button class="btn tiny" data-a="split">Split</button>' +
      '<button class="btn tiny" data-a="merge"' + (i + 1 >= cues.length ? ' disabled' : '') + '>Merge ↓</button>' +
      '<button class="btn tiny" data-a="del">Delete</button>' +
      '</div></div>';
  }

  /* Redraws one row. An hour of television is fifteen hundred cues, and
     rebuilding all of them to move a highlight makes every tap feel broken on
     a phone — so only what changed is redrawn. */
  function repaintRow(i) {
    const el = listEl.querySelector('.cue[data-i="' + i + '"]');
    if (!el || !cues[i]) return;
    el.outerHTML = rowHtml(i);
  }

  function render() {
    const o = spot();
    probsBy = {};
    problems(cues, o).forEach(p => { (probsBy[p.i] = probsBy[p.i] || []).push(p); });

    $('empty').hidden = !!(cues.length || media.file);
    $('bar').hidden = !(cues.length || media.file);
    $('capbox').hidden = !cues.length;
    $('start').hidden = !(media.file && !cues.length);
    // Nothing to fix, tidy or export until there is something to fix, tidy or
    // export. An empty file offering four repair tools is four wrong answers.
    $('fixBtn2').hidden = $('exportBtn').hidden = !cues.length;
    $('fixBtn').hidden = $('reflowBtn').hidden = $('respotBtn').hidden = !cues.length;

    listEl.innerHTML = cues.map((c, i) => rowHtml(i)).join('');
    if (sel >= 0 && editing) {
      const ta = listEl.querySelector('textarea');
      if (ta) { ta.focus(); ta.style.height = (ta.scrollHeight + 4) + 'px'; }
    }
    updateCounts();
    markNow(true);
    saveProject();
  }

  function updateCounts() {
    const probs = problems(cues, spot());
    const by = {};
    probs.forEach(p => { by[p.kind] = (by[p.kind] || 0) + 1; });
    const order = ['repeat', 'fast', 'overlap', 'short', 'long', 'wide', 'lines', 'tight', 'empty'];
    const names = {
      repeat: 'repeated', fast: 'too fast', overlap: 'overlapping', short: 'too brief',
      long: 'too long', wide: 'over-wide line', lines: 'too many lines', tight: 'no gap',
      empty: 'empty'
    };
    let html = '<span class="tag is-ok">' + cues.length + ' cue' + (cues.length === 1 ? '' : 's') +
      (media.dur ? ' · ' + fmtClock(media.dur, 0) : '') + '</span>';
    let any = false;
    order.forEach(k => {
      if (!by[k]) return;
      any = true;
      html += ' <button class="tag is-bad" data-jump="' + k + '"><b>' + by[k] + '</b> ' + names[k] + '</button>';
    });
    if (!any && cues.length) html += ' <span class="tag is-ok">nothing to fix</span>';
    $('counts').innerHTML = html;
    $('derepBtn').hidden = !by.repeat;
    $('undoBtn').hidden = !undoCues;
  }

  listEl.addEventListener('scroll', () => { scrollLock = Date.now(); });

  listEl.addEventListener('click', e => {
    const act = e.target.closest('[data-a]');
    const row = e.target.closest('.cue');
    if (!row) return;
    const i = +row.getAttribute('data-i');
    if (!act) {
      if (e.target.closest('input')) return;
      if (i === sel) { setEditing(i, !editing); return; }
      select(i, true);
      return;
    }
    const a = act.getAttribute('data-a');
    if (a === 'play') { playCue(i); return; }
    if (a === 'edit') { setEditing(i, !editing); return; }
    if (a === 'split') { doSplit(i); return; }
    if (a === 'merge') { doMerge(i); return; }
    if (a === 'del') { doDelete(i); return; }
  });

  // Typing in the text box: the cue changes as you type, and its words are
  // dropped, since they no longer describe what it says.
  listEl.addEventListener('input', e => {
    const t = e.target;
    if (t.hasAttribute('data-text')) {
      const i = +t.getAttribute('data-text');
      if (!cues[i]) return;
      cues[i].text = t.value;
      cues[i].w = null;
      t.style.height = (t.scrollHeight + 4) + 'px';
      const row = t.closest('.cue');
      if (row) row.querySelector('.flags').innerHTML = flagsFor(i, cues[i]);
      updateCounts();
      saveProject();
      paintCaption();
    }
  });

  listEl.addEventListener('change', e => {
    const t = e.target;
    const inAt = t.getAttribute('data-in'), outAt = t.getAttribute('data-out');
    if (inAt == null && outAt == null) return;
    const i = +(inAt == null ? outAt : inAt);
    const secs = parseStamp(t.value);
    if (!cues[i] || secs == null) { render(); return; }
    if (inAt != null) cues[i].s = Math.min(secs, cues[i].e - 0.05);
    else cues[i].e = Math.max(secs, cues[i].s + 0.05);
    cues[i].w = null;
    sortCues();
    render();
  });

  function sortCues() {
    const keep = cues[sel];
    cues.sort((a, b) => a.s - b.s);
    if (keep) sel = cues.indexOf(keep);
  }

  function select(i, scroll) {
    const was = sel;
    sel = Math.max(-1, Math.min(cues.length - 1, i));
    editing = false;
    if (was === sel) { repaintRow(sel); }
    else { if (was >= 0) repaintRow(was); if (sel >= 0) repaintRow(sel); }
    if (scroll) showRow(sel);
  }

  function setEditing(i, on) {
    const was = sel;
    sel = i;
    editing = on;
    if (was >= 0 && was !== i) repaintRow(was);
    repaintRow(i);
    if (!on) return;
    const ta = listEl.querySelector('textarea[data-text="' + i + '"]');
    if (ta) { ta.focus(); ta.style.height = (ta.scrollHeight + 4) + 'px'; }
  }

  function showRow(i) {
    const row = listEl.querySelector('.cue[data-i="' + i + '"]');
    if (!row) return;
    const top = row.offsetTop - listEl.clientHeight / 2 + row.clientHeight / 2;
    scrollLock = 0;
    listEl.scrollTo ? listEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      : (listEl.scrollTop = Math.max(0, top));
    scrollLock = Date.now() - 4000;     // this scroll is ours, not the reader's
  }

  /* ---------------------------------------------------------- cue edits -- */

  function doSplit(i) {
    const c = cues[i];
    if (!c) return;
    // The caret is where the break goes — but only if it is actually inside the
    // line. Sitting at either end it says nothing, so the middle is used.
    let at = null;
    const ta = listEl.querySelector('textarea[data-text="' + i + '"]');
    if (ta) {
      const p = ta.selectionStart;
      if (p > 0 && p < ta.value.trim().length) at = p;
    }
    let parts = splitCue(c, at);
    if (parts.length < 2 && at !== null) parts = splitCue(c, null);
    if (parts.length < 2) { toast('Nothing to split — it is one word'); return; }
    cues.splice(i, 1, parts[0], parts[1]);
    sel = i;
    editing = false;
    render();
  }

  function doMerge(i) {
    if (!cues[i] || !cues[i + 1]) return;
    cues.splice(i, 2, mergeCue(cues[i], cues[i + 1]));
    sel = i;
    render();
  }

  function doDelete(i) {
    if (!cues[i]) return;
    cues.splice(i, 1);
    sel = Math.min(i, cues.length - 1);
    editing = false;
    render();
  }

  function addCue() {
    const t = media.file ? v.currentTime : (cues.length ? cues[cues.length - 1].e + 0.5 : 0);
    const c = { s: t, e: t + Math.max(1.2, S.minDur), text: '', w: null };
    cues.push(c);
    sortCues();
    sel = cues.indexOf(c);
    editing = true;
    render();
    showRow(sel);
  }

  $('bar').addEventListener('click', e => {
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      const kind = jump.getAttribute('data-jump');
      const hit = problems(cues, spot()).filter(p => p.kind === kind)[0];
      if (hit) {
        select(hit.i, true);
        if (media.file) v.currentTime = cues[hit.i].s;
        toast(hit.msg);
      }
      return;
    }
  });

  /* One step back, for the two actions that can throw a lot away at once. */
  let undoCues = null;
  function snapshot() { undoCues = cues.map(c => Object.assign({}, c)); }

  $('undoBtn').addEventListener('click', () => {
    if (!undoCues) return;
    cues = undoCues;
    undoCues = null;
    sel = -1;
    render();
    toast('Put back');
  });

  /* Whisper repeating itself is not a transcript, and deleting forty copies of
     "Thank you." by hand is not a task. */
  $('derepBtn').addEventListener('click', () => {
    const out = dropRepeats(cues);
    if (!out.removed) { toast('No repeats'); return; }
    snapshot();
    cues = out.cues;
    sel = -1;
    render();
    toast(out.removed + ' repeated cue' + (out.removed === 1 ? '' : 's') + ' removed');
  });

  $('addBtn').addEventListener('click', addCue);
  $('fixBtn').addEventListener('click', () => {
    cues = fixTiming(cues, spot(), media.dur);
    render();
    toast('Timings tidied');
  });
  $('reflowBtn').addEventListener('click', () => {
    // Drop manual line breaks and lay every cue out again to the current limits.
    cues = cues.map(c => Object.assign({}, c, { text: c.text.replace(/\s*\n\s*/g, ' ') }));
    render();
    toast('Lines laid out again');
  });
  $('respotBtn').addEventListener('click', () => {
    const words = [];
    let lost = false;
    cues.forEach(c => {
      if (c.w && c.w.length) c.w.forEach(w => words.push(w));
      else { lost = true; spread(c.text.replace(/\n/g, ' '), c.s, c.e).forEach(w => words.push(w)); }
    });
    if (!words.length) return;
    cues = buildCues(words, spot());
    sel = -1;
    render();
    toast(lost ? 'Re-spotted from the cue timings' : 'Re-spotted from the word timings');
  });

  /* --------------------------------------------------------- the transport -- */

  function playCue(i) {
    if (!cues[i] || !media.file) return;
    select(i);
    v.currentTime = Math.max(0, cues[i].s);
    stopAt = cues[i].e;
    v.play().catch(() => { });
  }
  let stopAt = 0;

  function updateClock() {
    $('clock').textContent = fmtClock(v.currentTime || 0) + (media.dur ? ' / ' + fmtClock(media.dur, 0) : '');
  }

  function paintCaption() {
    if (!cues.length) { $('cap').textContent = ''; return; }
    const i = cueAt(cues, v.currentTime);
    $('cap').textContent = i < 0 ? '' : lines(cues[i]).join('\n');
    $('cap').style.visibility = i < 0 ? 'hidden' : 'visible';
  }

  let nowRow = -1;
  function markNow(force) {
    const i = cues.length ? cueAt(cues, v.currentTime) : -1;
    if (i === nowRow && !force) return;
    nowRow = i;
    const was = listEl.querySelectorAll('.cue.is-now');
    Array.prototype.forEach.call(was, el => el.classList.remove('is-now'));
    if (i < 0) return;
    const row = listEl.querySelector('.cue[data-i="' + i + '"]');
    if (!row) return;
    row.classList.add('is-now');
    // Follow the playhead, unless the reader has scrolled in the last few
    // seconds — being dragged back to the playhead mid-read is maddening.
    if (!v.paused && Date.now() - scrollLock > 3500) {
      const top = row.offsetTop - listEl.clientHeight * 0.4;
      listEl.scrollTop = Math.max(0, top);
      scrollLock = Date.now() - 4000;
    }
  }

  let raf = 0;
  function tick() {
    raf = 0;
    updateClock();
    paintCaption();
    markNow();
    if (stopAt && v.currentTime >= stopAt) { v.pause(); stopAt = 0; }
    if (!v.paused) raf = requestAnimationFrame(tick);
  }
  v.addEventListener('play', () => { updatePlay(); if (!raf) raf = requestAnimationFrame(tick); });
  v.addEventListener('pause', () => { updatePlay(); tick(); });
  v.addEventListener('seeked', () => tick());
  v.addEventListener('timeupdate', () => { if (v.paused) tick(); });

  function updatePlay() {
    $('playLbl').textContent = v.paused ? 'Play' : 'Pause';
    $('playIcon').innerHTML = v.paused
      ? '<path d="M4 2.2v11.6a.6.6 0 0 0 .92.5l9.1-5.8a.6.6 0 0 0 0-1L4.92 1.7A.6.6 0 0 0 4 2.2Z"/>'
      : '<rect x="3.4" y="2.2" width="3.3" height="11.6" rx="1"/><rect x="9.3" y="2.2" width="3.3" height="11.6" rx="1"/>';
  }

  function togglePlay() {
    if (!media.file) { pick(); return; }
    stopAt = 0;
    if (v.paused) v.play().catch(() => { }); else v.pause();
  }
  $('playBtn').addEventListener('click', togglePlay);
  $('backBtn').addEventListener('click', () => { v.currentTime = Math.max(0, v.currentTime - 2); });
  $('fwdBtn').addEventListener('click', () => { v.currentTime = Math.min(media.dur || 1e9, v.currentTime + 2); });

  /* Mark in and mark out: the two gestures every subtitling tool has, because
     the ear knows where a line begins long before the eye can type a number. */
  $('markIn').addEventListener('click', () => {
    if (sel < 0) { addCue(); return; }
    cues[sel].s = Math.min(v.currentTime, cues[sel].e - 0.1);
    cues[sel].w = null;
    sortCues(); render();
  });
  $('markOut').addEventListener('click', () => {
    if (sel < 0) return;
    cues[sel].e = Math.max(v.currentTime, cues[sel].s + 0.1);
    cues[sel].w = null;
    render();
  });

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      if (!$('transOv').hidden) { closeTrans(); return; }
      if (!$('fixOv').hidden) { closeFix(); return; }
      if (!$('exportOv').hidden) { $('exportOv').hidden = true; return; }
      if (typing) { e.target.blur(); if (editing) { editing = false; render(); } return; }
    }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 2); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(media.dur || 1e9, v.currentTime + 2); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel <= 0 ? 0 : sel - 1, true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); select(sel < 0 ? 0 : sel + 1, true); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); setEditing(sel, true); }
    else if (e.key === 'i' || e.key === 'I') $('markIn').click();
    else if (e.key === 'o' || e.key === 'O') $('markOut').click();
  });

  /* ------------------------------------------------- route one: listening --
     The browser's own recogniser only ever listens to a microphone: there is no
     way to hand it a file. So the file is played out loud and the phone listens
     to itself. Crude, and completely private — nothing leaves the device.

     Two things make it workable rather than useless:
       - a phrase is timestamped when its first interim result arrives, not when
         it is finalised, which would put every cue seconds late;
       - recognition stops itself at every silence, so it is restarted for as
         long as the video runs, and each restart begins its result indices
         again — hence the segment counter in the keys below.                 */

  let rec = null, capturing = false, phrases = [], startAt = {}, segment = 0, wake = null;

  const LANGS = ['en-GB', 'en-US', 'en-AU', 'en-IN', 'ar-AE', 'ar-EG', 'fr-FR', 'de-DE',
    'es-ES', 'it-IT', 'nl-NL', 'pt-BR', 'hi-IN', 'ur-PK', 'ru-RU', 'tr-TR', 'zh-CN', 'ja-JP'];

  function recCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  function acquireWake() {
    if (!navigator.wakeLock || wake) return;
    navigator.wakeLock.request('screen').then(w => { wake = w; }).catch(() => { });
  }
  function releaseWake() {
    if (wake) { try { wake.release(); } catch (e) { } wake = null; }
  }

  function listenStart() {
    const R = recCtor();
    if (!R) {
      status('This browser has no speech recognition. On Android use Chrome; on a desktop use ' +
        'Chrome or Edge. Failing that, the service route works anywhere.', true);
      return;
    }
    if (!media.file) { pick(); return; }
    phrases = []; startAt = {}; segment = 0;
    capturing = true;
    $('listenGo').hidden = true;
    $('listenStop').hidden = false;
    $('heard').hidden = false;
    $('heard').innerHTML = '';
    $('progGrp').hidden = false;
    $('progWhat').textContent = 'Listening';

    rec = new R();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = S.listenLang;
    rec.onresult = onHeard;
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        status('The microphone was refused, so there is nothing to listen with. Allow it for this ' +
          'site, or use the service route.', true);
        listenStop(true);
      } else if (e.error === 'no-speech') {
        // Normal: it goes quiet, it gives up, onend restarts it.
      } else if (e.error === 'audio-capture') {
        status('No microphone was found.', true);
        listenStop(true);
      }
    };
    rec.onend = () => {
      if (!capturing) return;
      segment++;
      try { rec.start(); } catch (e) { setTimeout(() => { if (capturing) try { rec.start(); } catch (e2) { } }, 250); }
    };

    v.muted = false;
    v.volume = 1;
    v.playbackRate = 1;              // faster than real time and nothing is heard right
    v.currentTime = 0;
    acquireWake();
    v.play().then(() => {
      try { rec.start(); } catch (e) { }
      $('listenNote').textContent = 'Listening. Leave this page open and the volume up.';
    }).catch(() => {
      status('The browser would not start playback. Tap play once, then start listening.', true);
      listenStop(true);
    });
  }

  function onHeard(e) {
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const key = segment + ':' + i;
      if (startAt[key] === undefined) startAt[key] = Math.max(0, v.currentTime - S.latency);
      const text = (r[0] && r[0].transcript || '').trim();
      if (r.isFinal) {
        if (text) {
          const s = startAt[key];
          phrases.push({ text: text, s: s, e: Math.max(s + 0.35, v.currentTime - 0.08) });
        }
      } else if (text) live = text;
    }
    const done = phrases.slice(-6).map(p => esc(p.text)).join(' ');
    $('heard').innerHTML = done + (live ? ' <i>' + esc(live) + '</i>' : '');
    $('heard').scrollTop = $('heard').scrollHeight;
    if (media.dur) {
      const pct = Math.min(100, v.currentTime / media.dur * 100);
      $('progBar').style.width = pct + '%';
      $('progPct').textContent = fmtClock(v.currentTime, 0) + ' / ' + fmtClock(media.dur, 0);
    }
  }

  function listenStop(quiet) {
    capturing = false;
    if (rec) { try { rec.stop(); } catch (e) { } rec = null; }
    v.pause();
    releaseWake();
    $('listenGo').hidden = false;
    $('listenStop').hidden = true;
    $('progGrp').hidden = true;
    if (quiet) return;
    buildFromPhrases();
  }

  function buildFromPhrases() {
    if (!phrases.length) {
      $('listenNote').textContent = 'Nothing was heard. Check the volume, and that the microphone ' +
        'is allowed for this site.';
      return;
    }
    // Recognition hands back overlapping spans when it restarts mid-sentence;
    // a word cannot begin before the previous one ended.
    const ordered = phrases.slice().sort((a, b) => a.s - b.s);
    let words = [];
    let floor = 0;
    ordered.forEach(p => {
      const s = Math.max(p.s, floor);
      const e = Math.max(s + 0.35, p.e);
      spread(p.text, s, e).forEach(w => words.push(w));
      floor = e + 0.02;
    });
    cues = buildCues(words, spot());
    sel = -1;
    render();
    closeTrans();
    toast(cues.length + ' cues from what it heard');
    status('Heard by this device, so expect to correct it — the words are a first draft, the ' +
      'timings are close.');
  }

  $('listenGo').addEventListener('click', listenStart);
  $('listenStop').addEventListener('click', () => listenStop(false));
  v.addEventListener('ended', () => { if (capturing) listenStop(false); });

  /* --------------------------------------------- route two: a real engine --
     The audio is reduced to what a recogniser actually wants — one channel at
     16 kHz — which turns a 400 MB video into a couple of megabytes a minute,
     then cut at silences into pieces under the upload limit and sent one by
     one. Each piece's timings are shifted back by where it started, so the
     transcript comes back as one continuous run of words. */

  const CHUNK_SEC = 600;          // 10 minutes ≈ 19 MB of 16-bit 16 kHz mono
  const PRESETS = {
    openai: { base: 'https://api.openai.com/v1', model: 'whisper-1', kind: 'openai' },
    groq: { base: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', kind: 'openai' },
    deepgram: { base: 'https://api.deepgram.com/v1', model: 'nova-3', kind: 'deepgram' },
    custom: { base: '', model: 'whisper-1', kind: 'openai' }
  };
  let abort = null;

  function progress(what, frac) {
    $('progGrp').hidden = false;
    $('progWhat').textContent = what;
    $('progBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    $('progPct').textContent = frac >= 0 ? Math.round(frac * 100) + '%' : '';
  }

  /* Reading the file is not the formality it looks like. A File from a picker
     is a reference, not the bytes, and by the time it is read the bytes may not
     be there: the file lives in iCloud or Drive and was never downloaded, it
     sat on a volume that has gone, it was renamed since it was chosen, or it is
     simply too big for the browser to hand over in one piece. All of those come
     back as one NotReadableError, so the first answer to it is to ask again in
     smaller pieces, and the second is to say plainly what tends to cause it. */
  async function readWhole(file, onProgress) {
    try {
      return await file.arrayBuffer();
    } catch (e) {
      if (!/NotReadable|NotFound/i.test((e && e.name) + ' ' + (e && e.message))) throw e;
    }
    const SLICE = 32 * 1024 * 1024;
    const out = new Uint8Array(file.size);
    let at = 0;
    while (at < file.size) {
      const end = Math.min(file.size, at + SLICE);
      let part;
      try {
        part = await file.slice(at, end).arrayBuffer();
      } catch (e) {
        const err = polite('The file could not be read' +
          (at ? ' past ' + (at / 1048576).toFixed(0) + ' MB' : '') + '. ' +
          'That usually means it is not really on the device — still in iCloud or Drive and ' +
          'not downloaded — or it has been moved or renamed since you picked it, or it is on a ' +
          'drive that is no longer there. Open it again from Open, or download it locally first.');
        throw err;
      }
      out.set(new Uint8Array(part), at);
      at = end;
      if (onProgress) onProgress(at / file.size);
    }
    return out.buffer;
  }

  function polite(msg) {
    const e = new Error(msg);
    e.polite = true;
    return e;
  }

  /* The other way to get the audio out, and the only way for a big file.

     A two gigabyte video cannot be handed over in one piece: the browser
     refuses the read, and decoding it would want the whole thing in memory
     again besides. So it is played instead — silently, and as fast as the
     browser will go — and the samples are taken off the audio graph as they
     pass. Memory stays flat whatever the file's size.

     The cost is time, and it cannot be bought off: playing faster does not
     help, because the audio is time-compressed as it speeds up and the graph
     hands over a sixteenth of the samples rather than the same samples sooner.
     So this runs at ordinary speed — an hour of video takes an hour to get the
     audio out of — and is the last resort it sounds like. */
  const GRAB_WORKLET =
    'class Grab extends AudioWorkletProcessor {\n' +
    '  process(inputs) {\n' +
    '    const ch = inputs[0] && inputs[0][0];\n' +
    '    if (ch && ch.length) this.port.postMessage(ch.slice(0));\n' +
    '    return true;\n' +
    '  }\n' +
    '}\n' +
    'registerProcessor("grab", Grab);\n';

  async function decodeByPlayback(file, onProgress) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw polite('This browser cannot decode audio.');
    const el = document.createElement('video');
    const url = URL.createObjectURL(file);
    let ctx = null, timer = 0;
    const done = () => {
      if (timer) clearInterval(timer);
      try { el.pause(); } catch (e) { }
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
      if (ctx) { try { ctx.close(); } catch (e) { } }
      releaseWake();
    };
    try {
      el.src = url;
      el.preload = 'auto';
      el.playsInline = true;
      await new Promise((res, rej) => {
        el.onloadedmetadata = res;
        el.onerror = () => rej(polite('This browser will not play ' + file.name + ', so the audio ' +
          'cannot be taken out of it. MP4, M4V, MOV, WebM, M4A and MP3 are the safe ones.'));
      });
      const dur = isFinite(el.duration) ? el.duration : 0;

      try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); }
      const src = ctx.createMediaElementSource(el);
      const silent = ctx.createGain();
      silent.gain.value = 0;                 // heard by nobody, but the graph still pulls

      const parts = [];
      let frames = 0;
      let node;
      const opts = {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      };
      try {
        const mod = URL.createObjectURL(new Blob([GRAB_WORKLET], { type: 'text/javascript' }));
        await ctx.audioWorklet.addModule(mod);
        URL.revokeObjectURL(mod);
        node = new AudioWorkletNode(ctx, 'grab', opts);
        node.port.onmessage = e => { parts.push(e.data); frames += e.data.length; };
      } catch (e) {
        // Older Safari has no worklet; the deprecated node is all there is.
        node = ctx.createScriptProcessor(4096, 1, 1);
        node.channelCount = 1;
        node.channelCountMode = 'explicit';
        node.onaudioprocess = ev => {
          const ch = ev.inputBuffer.getChannelData(0);
          parts.push(new Float32Array(ch));
          frames += ch.length;
        };
      }
      src.connect(node);
      node.connect(silent);
      silent.connect(ctx.destination);

      el.playbackRate = 1;                   // see above: faster loses the samples
      el.volume = 1;
      try { await ctx.resume(); } catch (e) { }
      try {
        await el.play();
      } catch (e) {
        throw polite('The browser would not start playback, and this file has to be played to get ' +
          'the audio out of it. Press play on the video once, then start again.');
      }
      acquireWake();                         // an hour of this with the screen off is nothing
      await new Promise((res, rej) => {
        let quiet = 0;
        el.onended = res;
        timer = setInterval(() => {
          if (dur && onProgress) onProgress(el.currentTime / dur, Math.round(dur - el.currentTime));
          // Some browsers deliver no audio at all at this speed. Rather than
          // sit here to the end of the film for nothing, give up early.
          if (el.currentTime > 2 && !frames) {
            if (++quiet > 4) rej(new Error('no audio came off the graph'));
          } else quiet = 0;
          if (el.ended) res();
        }, 1000);
      });

      if (!frames) throw new Error('no audio came off the graph');
      let pcm = new Float32Array(frames);
      let at = 0;
      parts.forEach(p => { pcm.set(p, at); at += p.length; });
      const got = ctx.sampleRate;
      done();
      return got === 16000 ? pcm : resample(pcm, got, 16000);
    } catch (e) {
      done();
      throw e;
    }
  }

  /* Past this, reading the file whole is not worth attempting: a browser will
     refuse the blob, and what it does not refuse will not fit alongside the
     decoded audio.

     It is set high on purpose. Reading the whole file is seconds, and playing
     it through is the length of the film, so anything that might work should be
     tried the fast way first. An earlier version drew this line at 700 MB and
     sent perfectly readable files the slow way round for nothing. */
  const READ_LIMIT = 2048 * 1024 * 1024;

  async function decodeSpeech(file) {
    if (file.size > READ_LIMIT) {
      status('That file is ' + (file.size / 1073741824).toFixed(1) + ' GB, which is more than this ' +
        'browser will read in one piece, so the audio is being taken out by playing the file ' +
        'through. That takes as long as the video runs' +
        (media.dur ? ' — about ' + fmtClock(media.dur, 0) : '') + ', and the page has to stay in ' +
        'front of you while it does. Quicker: export the audio on its own first — a two-hour m4a ' +
        'is about a hundred megabytes, and opens here like any other file.');
      return decodeByPlayback(file, playbackProgress);
    }
    let first;
    try {
      return await decodeFromBytes(file);
    } catch (e) {
      first = e;
    }
    // Reading it whole did not work; playing it might, and usually does.
    status('Reading ' + media.name + ' did not work, so the audio is being taken out by playing ' +
      'the file through instead. That takes as long as the video runs' +
      (media.dur ? ' — about ' + fmtClock(media.dur, 0) : '') + '.');
    try {
      return await decodeByPlayback(file, playbackProgress);
    } catch (e2) {
      throw (first && first.polite) ? first : (e2 && e2.polite ? e2 : first);
    }
  }

  /* Does the audio that came out match the file it came from? A re-export that
     went wrong — VLC's transcode is the usual one — produces audio shorter or
     longer than the container claims, and everything downstream then drifts or
     repeats. Cheap to check, and it saves hunting the wrong thing. */
  function checkAudio(pcm) {
    const secs = pcm.length / 16000;
    if (!media.dur || !isFinite(media.dur) || !secs) return;
    if (Math.abs(secs - media.dur) <= Math.max(5, media.dur * 0.05)) return;
    status('This file says it runs ' + fmtClock(media.dur, 0) + ', but its audio decodes to ' +
      fmtClock(secs, 0) + '. The two should match, so the export is probably faulty — and ' +
      'subtitles made from it will drift or repeat. Re-export it with ffmpeg rather than VLC: ' +
      'ffmpeg -i film.mkv -vn -ac 1 -ar 16000 -c:a pcm_s16le out.wav');
  }

  function playbackProgress(frac, secsLeft) {
    progress('Playing the file through to get the audio' +
      (secsLeft ? ' — ' + fmtClock(secsLeft, 0) + ' left' : ''), frac * 0.5);
  }

  async function decodeFromBytes(file) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser cannot decode audio.');
    const buf = await readWhole(file, f => progress('Reading the file — ' +
      Math.round(f * 100) + '% of ' + (file.size / 1048576).toFixed(0) + ' MB', f * 0.5));
    // Asking the context for 16 kHz makes the decoder resample as it goes,
    // which is the difference between a manageable buffer and an hour of video
    // at 48 kHz stereo — half a gigabyte of floats.
    let ctx;
    try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); }
    let audio;
    try {
      audio = await ctx.decodeAudioData(buf);
    } catch (e) {
      try { ctx.close(); } catch (e2) { }
      throw new Error('This browser could not decode the audio in ' + file.name +
        '. MP4, M4A, MP3, WAV and WebM usually work; MKV often does not.');
    }
    const chans = [];
    for (let i = 0; i < audio.numberOfChannels; i++) chans.push(audio.getChannelData(i));
    let pcm = toMono(chans, audio.length);
    const rate = audio.sampleRate;
    try { ctx.close(); } catch (e) { }
    if (rate !== 16000) pcm = resample(pcm, rate, 16000);
    return pcm;
  }

  function endpoint(p) {
    const base = (p === 'custom' ? (S.baseUrl || '') : PRESETS[p].base).replace(/\/+$/, '');
    if (!base) throw new Error('Give the base URL of the service first.');
    return PRESETS[p].kind === 'deepgram' ? base + '/listen' : base + '/audio/transcriptions';
  }

  function deepgramUrl(base) {
    const q = ['model=' + encodeURIComponent(S.model || PRESETS.deepgram.model),
      'smart_format=true', 'punctuate=true'];
    if (S.cloudLang) q.push('language=' + encodeURIComponent(S.cloudLang));
    return base + '?' + q.join('&');
  }

  async function sendChunk(wav, p, signal, withWordStamps) {
    const kind = PRESETS[p].kind;
    const blob = new Blob([wav], { type: 'audio/wav' });
    let url, init;
    if (kind === 'deepgram') {
      url = deepgramUrl(endpoint(p));
      init = {
        method: 'POST', signal: signal, body: blob,
        headers: { Authorization: 'Token ' + apiKey, 'Content-Type': 'audio/wav' }
      };
    } else {
      const fd = new FormData();
      fd.append('file', blob, 'audio.wav');
      fd.append('model', (p === 'custom' ? (S.model || 'whisper-1') : PRESETS[p].model));
      fd.append('response_format', 'verbose_json');
      if (withWordStamps) fd.append('timestamp_granularities[]', 'word');
      if (S.cloudLang) fd.append('language', S.cloudLang);
      url = endpoint(p);
      init = { method: 'POST', signal: signal, body: fd, headers: { Authorization: 'Bearer ' + apiKey } };
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j.error && (j.error.message || j.error)) || j.message || j.err_msg || '';
      } catch (e) { }
      const err = new Error('The service refused it (' + res.status + ')' + (detail ? ': ' + detail : ''));
      err.status = res.status;
      err.detail = String(detail);
      throw err;
    }
    return res.json();
  }

  async function cloudRun() {
    if (!media.file) { pick(); return; }
    if (!apiKey) { status('Paste your key for the service first.', true); return; }
    const p = S.provider;
    abort = new AbortController();
    $('cloudGo').hidden = true;
    $('cloudStop').hidden = false;
    $('heard').hidden = false;
    $('heard').innerHTML = '<i>Reading the audio out of the file…</i>';
    let words = [];
    let anyUntimed = false;
    try {
      progress('Reading the audio', 0.02);
      const pcm = await decodeSpeech(media.file);
      checkAudio(pcm);
      const pts = splitPoints(pcm, 16000, CHUNK_SEC, 15);
      let wordStamps = true;
      for (let i = 0; i < pts.length; i++) {
        if (abort.signal.aborted) break;
        const from = pts[i], to = (i + 1 < pts.length) ? pts[i + 1] : pcm.length;
        progress('Piece ' + (i + 1) + ' of ' + pts.length, (i + 0.15) / pts.length);
        const wav = wavBytes(pcm.subarray(from, to), 16000);
        let json;
        try {
          json = await sendChunk(wav, p, abort.signal, wordStamps);
        } catch (e) {
          // Some OpenAI-compatible servers reject word-level stamps. Ask once
          // more without them rather than losing the whole run.
          if (wordStamps && e.status === 400 && /granularit|timestamp/i.test(e.detail || '')) {
            wordStamps = false;
            json = await sendChunk(wav, p, abort.signal, false);
          } else throw e;
        }
        const span = (to - from) / 16000;
        const got = parseTranscript(json, from / 16000, span);
        if (!got.timed) anyUntimed = true;
        words = words.concat(got.words);
        $('heard').textContent = words.slice(-60).map(w => w.w).join(' ');
        $('heard').scrollTop = $('heard').scrollHeight;
        progress('Piece ' + (i + 1) + ' of ' + pts.length, (i + 1) / pts.length);
      }
      if (!words.length) {
        status('The service returned nothing at all. Check the key and the model.', true);
      } else {
        cues = buildCues(words, spot());
        sel = -1;
        render();
        closeTrans();
        toast(cues.length + ' cues from ' + words.length + ' words');
        if (anyUntimed) {
          status('Part of that reply had no word timings, so those cues were spaced out by the ' +
            'length of the words. Check them against the picture.');
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') toast('Stopped');
      else if (e && e.polite) status(e.message, true);
      else if (e instanceof TypeError) {
        status('Could not reach the service. Either there is no connection, or the service does ' +
          'not allow calls straight from a browser. ' + (e.message || ''), true);
      } else status((e && e.message) || 'That did not work.', true);
    } finally {
      abort = null;
      $('cloudGo').hidden = false;
      $('cloudStop').hidden = true;
      $('progGrp').hidden = true;
    }
  }

  $('cloudGo').addEventListener('click', cloudRun);
  $('cloudStop').addEventListener('click', () => { if (abort) abort.abort(); });

  /* ------------------------------------------- route three: Whisper, here --
     The accurate route that still keeps the audio on the device: Whisper itself,
     compiled to run in this browser. The cost is a model download the first
     time; after that the browser has it cached and the route works offline.

     It runs in a worker built from a blob, because there is no second file to
     ship — this app is one page — and because transcription on the main thread
     would freeze everything for minutes at a stretch. WebGPU is used where the
     device has it, and the audio is fed in pieces cut at silences so there is
     honest progress to show rather than one long wait.                       */

  // How long to let WebGPU take to build the model before giving up on it.
  const GPU_PATIENCE = 240000;
  const WHISPER_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
  /* Two minutes of audio per call into the model. Longer pieces are slightly
     more efficient and much worse to sit in front of: nothing is shown until a
     piece finishes, and on a phone a five-minute piece is a very long silence. */
  const WHISPER_PIECE = 120;
  /* The plain exports cannot give a timing for each word — they were not built
     with the cross-attentions that needs — so with those the words inside a
     phrase are placed across its span instead. The "_timestamped" exports can,
     at the cost of a bigger download, and are worth trying if the cues feel
     loose. If one of them is not there any more, it says so and you pick
     another; nothing else depends on them existing. */
  const MODELS = [
    { id: 'onnx-community/whisper-tiny.en', label: 'Tiny, English only — fastest, roughest' },
    { id: 'onnx-community/whisper-base', label: 'Base — the sensible default' },
    { id: 'onnx-community/whisper-small', label: 'Small — better, several times slower' },
    { id: 'onnx-community/whisper-base_timestamped', label: 'Base, word timings — bigger download' },
    { id: 'onnx-community/whisper-tiny.en_timestamped', label: 'Tiny English, word timings' },
    { id: 'onnx-community/whisper-large-v3-turbo', label: 'Large turbo — desktop with WebGPU only' }
  ];

  let worker = null, workerUrl = '', whisperRun = null;

  /* What the run is doing, and for how long. Without this the page shows a
     number that has not moved for ten minutes, and the only thing anyone can
     conclude from that is that it has crashed. Transcription gives no progress
     of its own beyond the thirty-second windows, so the clock does the work. */
  let wPhase = '', wSince = 0, wLastWord = 0, wWindows = 0, wPieces = '', wDone = 0;
  let wTicker = 0, wFiles = {};

  function wElapsed(from) {
    const s = Math.max(0, Math.round((Date.now() - (from || wSince)) / 1000));
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }

  function wPaint() {
    let what = wPieces;
    if (wPhase === 'downloading') {
      const names = Object.keys(wFiles);
      const got = names.reduce((a, k) => a + wFiles[k].loaded, 0);
      const all = names.reduce((a, k) => a + wFiles[k].total, 0);
      // Only worth showing in megabytes once the sizes are real; the first few
      // events arrive before anything has said how big the file is.
      const big = all > 2097152;
      what = 'Downloading the model' + (big ? ' — ' + (got / 1048576).toFixed(0) + ' of ' +
        (all / 1048576).toFixed(0) + ' MB' : '');
      progress(what + ' · ' + wElapsed(), big ? got / all : 0.02);
      return;
    }
    if (wPhase === 'preparing') {
      // Downloaded, now being built. This is the one wait with nothing behind
      // it to show, so it says what it is waiting for and how long it will wait.
      const left = Math.max(0, Math.round((GPU_PATIENCE - (Date.now() - wLastWord)) / 1000));
      progress('Model downloaded — starting it up · ' + wElapsed(wLastWord) +
        (whisperDevice() === 'webgpu' && left
          ? ' · WebGPU, switching to the processor in ' + left + ' s if it does not'
          : ''), 0.99);
      return;
    }
    if (wPhase === 'transcribing') {
      progress(what + (wWindows ? ' · ' + wWindows + ' × 30 s done' : '') + ' · ' + wElapsed() +
        (wDevice ? ' · ' + (wDevice === 'webgpu' ? 'WebGPU' : 'processor') : ''), wDone);
    }
  }

  function wSetPhase(phase) {
    wPhase = phase;
    wLastWord = Date.now();
    wPaint();
  }

  function wStartTicker() {
    if (wTicker) return;
    wSince = Date.now();
    wLastWord = Date.now();
    wTicker = setInterval(() => {
      wPaint();
      /* A WebGPU pipeline that is going to work has started well before this;
         one that is going to hang — and on some devices and drivers it does,
         with no error of any kind — never starts at all. Compiling the shaders
         for a cached model is legitimately slow, though, so the wait is long
         and the screen says how long it will be. */
      if (wPhase === 'preparing' && !forceWasm && whisperDevice() === 'webgpu' &&
          Date.now() - wLastWord > GPU_PATIENCE && whisperRun) {
        whisperRun.fail(Object.assign(new Error('WebGPU did not start'), { retryWasm: true }));
      }
    }, 1000);
  }

  function wStopTicker() {
    if (wTicker) { clearInterval(wTicker); wTicker = 0; }
    wPhase = '';
    wFiles = {};
  }

  function startWorker() {
    if (worker) return worker;
    const blob = new Blob([whisperWorkerSource(WHISPER_CDN)], { type: 'text/javascript' });
    workerUrl = URL.createObjectURL(blob);
    worker = new Worker(workerUrl, { type: 'module' });
    worker.onmessage = e => {
      const m = e.data;
      if (!whisperRun) return;
      if (m.type === 'loading') {
        const p = m.p || {};
        wSetPhase(trackLoad(wFiles, p).phase);
      } else if (m.type === 'ready') {
        wDevice = m.device || '';
        wSetPhase('transcribing');
      } else if (m.type === 'phraseOnly') {
        phraseOnly = true;
      } else if (m.type === 'tick') {
        wWindows = m.windows || 0;
        wSetPhase('transcribing');
      } else if (m.type === 'result') {
        whisperRun.got(m);
      } else if (m.type === 'failed') {
        whisperRun.fail(new Error(m.message));
      }
    };
    worker.onerror = e => {
      if (whisperRun) whisperRun.fail(new Error((e && e.message) || 'The worker would not start.'));
    };
    return worker;
  }

  function stopWorker() {
    if (worker) { try { worker.terminate(); } catch (e) { } worker = null; }
    if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = ''; }
  }

  function whisperPiece(pcm, offset) {
    return new Promise((resolve, reject) => {
      whisperRun = {
        got: m => { whisperRun = null; resolve(m); },
        fail: err => { whisperRun = null; reject(err); }
      };
      const copy = pcm.slice();       // detached by the transfer, so send a copy
      startWorker().postMessage({
        type: 'run', model: S.wModel, device: whisperDevice(),
        language: S.wLang || '', pcm: copy, offset: offset
      }, [copy.buffer]);
    });
  }

  let forceWasm = false, wDevice = '', retryOnCpu = false;
  function whisperDevice() {
    return (navigator.gpu && !forceWasm) ? 'webgpu' : 'wasm';
  }

  let whisperStop = false, phraseOnly = false;

  async function whisperGo(again) {
    if (!media.file) { pick(); return; }
    if (!window.Worker) { status('This browser has no workers, so Whisper cannot run here.', true); return; }
    whisperStop = false;
    if (!again) phraseOnly = false;
    $('wGo').hidden = true;
    $('wStop').hidden = false;
    $('heard').hidden = false;
    if (!again) $('heard').innerHTML = '<i>Reading the audio out of the file…</i>';
    let words = [];
    try {
      wSetPhase('reading');
      progress('Reading the audio', 0.01);
      const pcm = await decodeSpeech(media.file);
      checkAudio(pcm);
      const pts = splitPoints(pcm, 16000, WHISPER_PIECE, 10);
      wStartTicker();
      wSetPhase('downloading');
      for (let i = 0; i < pts.length; i++) {
        if (whisperStop) break;
        const from = pts[i], to = (i + 1 < pts.length) ? pts[i + 1] : pcm.length;
        wPieces = pts.length > 1 ? 'Piece ' + (i + 1) + ' of ' + pts.length : 'Transcribing';
        wWindows = 0;
        wDone = i / pts.length;
        wPaint();
        const out = await whisperPiece(pcm.subarray(from, to), from / 16000);
        const got = parseTranscript(out, from / 16000, (to - from) / 16000);
        words = words.concat(got.words);
        $('heard').textContent = words.slice(-60).map(w => w.w).join(' ');
        $('heard').scrollTop = $('heard').scrollHeight;
        wDone = (i + 1) / pts.length;
        wPaint();
      }
      if (!words.length) {
        status(whisperStop ? 'Stopped before anything was transcribed.'
          : 'Whisper found no speech in that file.', !whisperStop);
      } else {
        cues = buildCues(words, spot());
        sel = -1;
        render();
        closeTrans();
        toast(cues.length + ' cues, transcribed on this device');
        if (phraseOnly) {
          status('This model cannot give a timing for each word — only for each phrase — so the ' +
            'words inside a line are placed across it rather than measured. The cues are right to ' +
            'within a word; nudge any that look late with In and Out.');
        }
      }
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (e && e.retryWasm) {
        // Start again on the processor. Slower, but it finishes.
        forceWasm = true;
        retryOnCpu = true;
        stopWorker();
        status('WebGPU on this device did not start the model after two and a half minutes, so it ' +
          'is running on the processor instead. Slower, but it gets there.');
      } else if (e && e.polite) {
        // Already says what it means; do not wrap it in Whisper's name.
        status(msg, true);
      } else if (/fetch|network|Failed to (load|fetch)|import/i.test(msg)) {
        status('The model could not be downloaded. It comes from the internet the first time, so ' +
          'this needs a connection — and a page served over https, not opened as a file.', true);
      } else if (!whisperStop) status('Whisper could not run here: ' + msg, true);
    } finally {
      whisperRun = null;
      wStopTicker();
      if (!retryOnCpu) {
        $('wGo').hidden = false;
        $('wStop').hidden = true;
        $('progGrp').hidden = true;
      }
    }
    if (retryOnCpu) {
      retryOnCpu = false;
      return whisperGo(true);
    }
  }

  $('wGo').addEventListener('click', whisperGo);
  $('wStop').addEventListener('click', () => {
    whisperStop = true;
    if (whisperRun) whisperRun.fail(new Error('Stopped'));
    stopWorker();                     // the model call itself cannot be interrupted
    toast('Stopped');
  });
  $('wLang').addEventListener('input', function () { S.wLang = this.value.trim(); saveSettings(); });
  $('wModel').addEventListener('change', function () {
    S.wModel = this.value;
    S.wModelChosen = true;
    stopWorker();                     // a different model means a different pipeline
    saveSettings();
    syncWhisper();
  });

  /* Without WebGPU the model runs on the processor, where base is several times
     slower than tiny and small is not worth starting on a phone. So the first
     suggestion follows the device; once a choice is made, it is kept. */
  function defaultModel() {
    return navigator.gpu ? 'onnx-community/whisper-base' : 'onnx-community/whisper-tiny.en';
  }

  function syncWhisper() {
    const big = /small|large/.test(S.wModel);
    const gpu = !!navigator.gpu;
    $('wNote').textContent =
      (gpu ? 'WebGPU here, so it will be quick. '
           : 'No WebGPU here, so it runs on the processor: about the length of the video again ' +
             'for tiny, several times that for base. ') +
      (big && !gpu ? 'This one would take hours without WebGPU — pick tiny or base. ' : '') +
      (/_timestamped$/.test(S.wModel) ? 'Times every word.' : 'Times each phrase.');
  }

  /* ------------------------------------------------------ transcribe panel -- */

  function openTrans() {
    if (!media.file) { pick(); return; }
    $('transFile').textContent = media.name +
      (media.dur ? ' · ' + fmtClock(media.dur, 0) : '') +
      (media.file && media.file.size ? ' · ' + (media.file.size / 1048576).toFixed(0) + ' MB' : '');
    clearPanelMsg();
    $('transOv').hidden = false;
    if (!recCtor()) {
      $('listenGo').disabled = true;
      $('listenNote').textContent = 'This browser has no speech recognition, so this route is not ' +
        'available here. Chrome and Edge have it.';
    }
    if (cues.length) {
      $('listenNote').textContent = 'There are already ' + cues.length + ' cues. Transcribing again ' +
        'replaces them.';
    }
  }
  function closeTrans() {
    if (capturing) listenStop(true);
    if (abort) abort.abort();
    whisperStop = true;
    $('transOv').hidden = true;
  }
  $('transBtn').addEventListener('click', openTrans);
  $('startBtn').addEventListener('click', openTrans);
  $('transClose').addEventListener('click', closeTrans);
  $('transDone').addEventListener('click', closeTrans);
  $('transOv').addEventListener('click', e => { if (e.target === $('transOv')) closeTrans(); });

  $('provider').addEventListener('change', function () {
    S.provider = this.value;
    $('customGrp').hidden = this.value !== 'custom';
    if (this.value !== 'custom') S.model = '';
    saveSettings();
  });
  $('baseUrl').addEventListener('input', function () { S.baseUrl = this.value.trim(); saveSettings(); });
  $('model').addEventListener('input', function () { S.model = this.value.trim(); saveSettings(); });
  $('cloudLang').addEventListener('input', function () { S.cloudLang = this.value.trim(); saveSettings(); });
  $('apiKey').addEventListener('input', function () {
    apiKey = this.value.trim();
    if (S.rememberKey) { S.key = apiKey; saveSettings(); }
  });
  $('rememberKey').addEventListener('click', function () {
    S.rememberKey = !S.rememberKey;
    S.key = S.rememberKey ? apiKey : '';
    this.classList.toggle('is-on', S.rememberKey);
    saveSettings();
    toast(S.rememberKey ? 'Kept on this device' : 'Forgotten when the app closes');
  });
  $('listenLang').addEventListener('change', function () { S.listenLang = this.value; saveSettings(); });
  $('latency').addEventListener('input', function () {
    S.latency = +this.value;
    $('latVal').textContent = S.latency.toFixed(2) + ' s';
    saveSettings();
  });

  /* -------------------------------------------------------- fix the words --
     A recogniser hears sounds; it does not know what it is listening to. Told
     what the programme is, Claude does, and puts back the word that was meant.

     Three ways in, all the same exchange underneath: numbered lines out,
     numbered lines back. The timings never go anywhere, so a garbled reply can
     only ever change text — and every change is shown before it is kept. */

  /* The whole file goes at once. An hour of television is about fifteen hundred
     lines, which is one ordinary paste and one ordinary request — and twenty-six
     of anything is not a thing anyone is going to do twice. Only a file past
     FIX_MAX is broken up at all, and a reply that stops early is finished off
     from where it stopped rather than by starting again. */
  const FIX_MAX = 2500;              // lines in one go before it must be split
  const FIX_CONTEXT = 0;             // none needed when the whole file is there
  let fixBatch = 0;                  // which part the paste route is showing
  let fixBefore = null;              // the cues as they were, for undo
  let fixChanges = [];
  let fixAbort = null;
  let fixKey = S.rememberFixKey ? (S.fixKey || '') : '';

  function fixBatches() { return Math.max(1, Math.ceil(cues.length / FIX_MAX)); }

  function promptFor(from, count) {
    return fixPrompt(cues, from, count === undefined ? FIX_MAX : count, S.fixNotes, from ? 4 : 0);
  }

  function showBatch() {
    const n = fixBatches();
    fixBatch = Math.max(0, Math.min(n - 1, fixBatch));
    const from = fixBatch * FIX_MAX + 1;
    const to = Math.min(cues.length, (fixBatch + 1) * FIX_MAX);
    const size = Math.round(promptFor(fixBatch * FIX_MAX).length / 1024);
    $('fixBatch').textContent = n > 1
      ? 'Lines ' + from + '–' + to + ' of ' + cues.length + ' · part ' + (fixBatch + 1) + ' of ' + n
      : 'All ' + cues.length + ' lines in one — about ' + size + ' KB to paste';
    $('fixPrev').hidden = $('fixNext').hidden = n === 1;
    $('fixPrev').disabled = fixBatch === 0;
    $('fixNext').disabled = fixBatch >= n - 1;
  }

  function claudeHere() {
    return !!(window.claude && typeof window.claude.complete === 'function');
  }

  function openFix() {
    if (!cues.length) { toast('No cues yet — transcribe something first'); return; }
    clearPanelMsg();
    $('fixOv').hidden = false;
    $('fixNotes').value = S.fixNotes || '';
    $('fixModel').value = S.fixModel || DEFAULTS.fixModel;
    $('fixKey').value = fixKey;
    $('fixRemember').classList.toggle('is-on', !!S.rememberFixKey);
    $('routeFixHere').hidden = !claudeHere();
    fixBatch = 0;
    showBatch();
    renderChanges();
  }
  function closeFix() {
    if (fixAbort) fixAbort.abort();
    $('fixOv').hidden = true;
  }
  $('fixBtn2').addEventListener('click', openFix);
  $('fixClose').addEventListener('click', closeFix);
  $('fixDone').addEventListener('click', closeFix);
  $('fixOv').addEventListener('click', e => { if (e.target === $('fixOv')) closeFix(); });
  $('fixNotes').addEventListener('input', function () { S.fixNotes = this.value; saveSettings(); });
  $('fixModel').addEventListener('input', function () { S.fixModel = this.value.trim(); saveSettings(); });
  $('fixKey').addEventListener('input', function () {
    fixKey = this.value.trim();
    if (S.rememberFixKey) { S.fixKey = fixKey; saveSettings(); }
  });
  $('fixRemember').addEventListener('click', function () {
    S.rememberFixKey = !S.rememberFixKey;
    S.fixKey = S.rememberFixKey ? fixKey : '';
    this.classList.toggle('is-on', S.rememberFixKey);
    saveSettings();
  });
  $('fixPrev').addEventListener('click', () => { fixBatch--; showBatch(); });
  $('fixNext').addEventListener('click', () => { fixBatch++; showBatch(); });

  $('fixCopy').addEventListener('click', () => {
    const text = promptFor(fixBatch * FIX_MAX);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('Copied — paste it into Claude'),
        () => toast('Could not copy; use Download instead'));
    } else toast('Could not copy; use Download instead');
  });
  $('fixSave').addEventListener('click', () => {
    const blob = new Blob([promptFor(fixBatch * FIX_MAX)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = baseName() + '-for-claude-' + (fixBatch + 1) + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  $('fixApplyBtn').addEventListener('click', () => {
    const reply = $('fixReply').value;
    if (!reply.trim()) { toast('Paste the reply first'); return; }
    const got = fixParse(reply);
    if (!Object.keys(got).length) {
      status('Nothing in that reply looked like a numbered subtitle line. It should be lines like ' +
        '"12| the corrected text".', true);
      return;
    }
    applyCorrections(got);
    $('fixReply').value = '';
  });

  function applyCorrections(byNumber) {
    if (!fixBefore) fixBefore = cues.map(c => Object.assign({}, c));
    const out = fixApply(cues, byNumber);
    cues = out.cues;
    // Keep the running list across batches, newest first.
    fixChanges = out.changed.concat(fixChanges.filter(c => !out.changed.some(n => n.i === c.i)));
    render();
    renderChanges();
    toast(out.changed.length ? out.changed.length + ' line' + (out.changed.length === 1 ? '' : 's') + ' changed'
      : 'Nothing needed changing');
  }

  function renderChanges() {
    $('fixDiffGrp').hidden = !fixChanges.length;
    $('fixUndo').hidden = !fixChanges.length;
    if (!fixChanges.length) { $('fixDiff').innerHTML = ''; return; }
    $('fixCount').textContent = fixChanges.length + ' of ' + cues.length;
    $('fixDiff').innerHTML = fixChanges.slice(0, 80).map(c =>
      '<div class="chg" data-i="' + c.i + '">' +
      '<span class="n">' + (c.i + 1) + ' · ' + fmtClock(cues[c.i] ? cues[c.i].s : 0) + '</span>' +
      '<span class="was">' + esc(c.before.replace(/\n/g, ' ')) + '</span>' +
      '<span class="now">' + esc((cues[c.i] || { text: '' }).text.replace(/\n/g, ' ')) + '</span>' +
      '<button class="btn tiny" data-revert="' + c.i + '" type="button">Put it back</button></div>'
    ).join('');
  }

  $('fixDiff').addEventListener('click', e => {
    const b = e.target.closest('[data-revert]');
    if (!b) return;
    const i = +b.getAttribute('data-revert');
    const hit = fixChanges.filter(c => c.i === i)[0];
    if (!hit || !cues[i]) return;
    cues[i] = Object.assign({}, cues[i], { text: hit.before });
    fixChanges = fixChanges.filter(c => c.i !== i);
    render();
    renderChanges();
  });

  $('fixUndo').addEventListener('click', () => {
    if (!fixBefore) return;
    cues = fixBefore.map(c => Object.assign({}, c));
    fixBefore = null;
    fixChanges = [];
    render();
    renderChanges();
    toast('Back to what the recogniser heard');
  });

  function fixProgress(what, frac) {
    $('fixProgGrp').hidden = false;
    $('fixProgWhat').textContent = what;
    $('fixProgBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    $('fixProgPct').textContent = Math.round(frac * 100) + '%';
  }

  function linesFor(from, count) {
    return 'The subtitles:\n\n' + fixLines(cues, from, count, from ? 4 : 0);
  }

  /* One pass over the whole file. The asker is handed a starting line rather
     than a batch number, because the API route puts the rules in the system
     prompt and sends only the lines, while the copy-and-paste route needs both
     together in one block.

     A reply can stop early — the model runs out of room, or simply stops — and
     the answer to that is to carry on from the last line it did answer, not to
     start again. Anything still unanswered is left exactly as it was and said
     out loud, which is the safe way to fail here. */
  async function runFix(ask) {
    let from = 0, pass = 0, total = 0;
    try {
      while (from < cues.length && pass < 5) {
        fixProgress(from ? 'Carrying on from line ' + (from + 1)
          : 'Asking about ' + cues.length + ' lines', from / cues.length);
        const reply = await ask(from, cues.length - from);
        const got = fixParse(reply);
        const before = fixChanges.length;
        applyCorrections(got);
        total += fixChanges.length - before;

        // How far it answered without a gap, which is where to pick up again.
        let answeredTo = from - 1;
        for (let i = from; i < cues.length; i++) {
          if (got[i + 1] === undefined) break;
          answeredTo = i;
        }
        if (answeredTo >= cues.length - 1) { from = cues.length; break; }
        if (answeredTo < from) {
          status('The reply did not cover line ' + (from + 1) + ' onwards, so those lines are ' +
            'untouched. Try again, or do the rest through the Claude app.', true);
          break;
        }
        from = answeredTo + 1;
        pass++;
      }
      if (from < cues.length && pass >= 5) {
        status('Lines ' + (from + 1) + ' onwards went unanswered after several attempts, and are ' +
          'unchanged.', true);
      }
      toast(total ? total + ' line' + (total === 1 ? '' : 's') + ' corrected' : 'Nothing needed changing');
    } catch (e) {
      if (e && e.name === 'AbortError') toast('Stopped — whatever came back before that is kept');
      else status((e && e.message) || 'That did not work.', true);
    } finally {
      $('fixProgGrp').hidden = true;
    }
  }

  // Inside claude.ai the page can simply ask, with no key and nothing to set up.
  $('fixHereGo').addEventListener('click', () => {
    if (!claudeHere()) { toast('Not available here'); return; }
    $('fixHereGo').disabled = true;
    runFix((from, count) => Promise.resolve(window.claude.complete(promptFor(from, count))))
      .then(() => { $('fixHereGo').disabled = false; });
  });

  /* The Claude API, straight from the browser. The key is yours and stays in
     memory unless you say otherwise; the header below is what tells the API
     this is a browser calling on purpose. */
  async function askClaude(from, count, signal, withFallbacks) {
    const lines = linesFor(from, count);
    /* Room to answer: the reply is the same lines again, so it is about the
       size of what went in. Roughly three characters to the token, half as much
       again for safety, and a floor and a ceiling. */
    const body = {
      model: S.fixModel || DEFAULTS.fixModel,
      max_tokens: Math.min(64000, Math.max(8000, Math.ceil(lines.length / 3 * 1.5))),
      system: fixSystem(S.fixNotes),
      messages: [{ role: 'user', content: lines }],
      // A whole hour of subtitles is a long answer, and a connection left idle
      // while it is written is a connection something along the way will drop.
      stream: true
    };
    if (withFallbacks) {
      body.betas = ['server-side-fallback-2026-07-01'];
      body.fallbacks = 'default';
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': fixKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && (j.error.message || j.error)) || ''; } catch (e) { }
      const err = new Error('Claude refused the request (' + res.status + ')' + (detail ? ': ' + detail : ''));
      err.status = res.status;
      err.detail = String(detail);
      throw err;
    }
    return readClaudeStream(res, from, count, signal);
  }

  /* Reads the event stream, and counts the lines as they arrive so the bar
     moves with the answer rather than sitting still until it is finished. */
  async function readClaudeStream(res, from, count, signal) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', out = '', done = 0, stop = '';
    for (;;) {
      if (signal && signal.aborted) { try { reader.cancel(); } catch (e) { } break; }
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const line of parts) {
        if (line.indexOf('data:') !== 0) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          out += ev.delta.text;
          const lines = out.split('\n').length - 1;
          if (lines > done) {
            done = lines;
            fixProgress('Line ' + Math.min(from + done, cues.length) + ' of ' + cues.length,
              (from + done) / cues.length);
          }
        } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
          stop = ev.delta.stop_reason;
        } else if (ev.type === 'error') {
          throw new Error((ev.error && ev.error.message) || 'The stream failed.');
        }
      }
    }
    if (stop === 'refusal') {
      throw new Error('Claude declined to answer. Correct these by hand, or say less in the ' +
        'description of the programme.');
    }
    // max_tokens simply means it stopped early; runFix picks up where it left off.
    return out;
  }

  $('fixKeyGo').addEventListener('click', () => {
    if (!fixKey) { status('Paste your Claude API key first.', true); return; }
    fixAbort = new AbortController();
    $('fixKeyGo').hidden = true;
    $('fixKeyStop').hidden = false;
    let fallbacks = true;
    runFix(async (from, count) => {
      try {
        return await askClaude(from, count, fixAbort.signal, fallbacks);
      } catch (e) {
        // An older or proxied endpoint may not know the fallback beta; the
        // correction matters more than the fallback, so drop it and go on.
        if (fallbacks && e.status === 400 && /beta|fallback/i.test(e.detail || '')) {
          fallbacks = false;
          return askClaude(from, count, fixAbort.signal, false);
        }
        if (e instanceof TypeError) {
          throw new Error('Could not reach Claude from this page. A browser may be blocked from ' +
            'calling the API directly — the copy-and-paste route below always works.');
        }
        throw e;
      }
    }).then(() => {
      fixAbort = null;
      $('fixKeyGo').hidden = false;
      $('fixKeyStop').hidden = true;
    });
  });
  $('fixKeyStop').addEventListener('click', () => { if (fixAbort) fixAbort.abort(); });

  /* --------------------------------------------------------------- export -- */

  function baseName() {
    return (media.name || 'subtitles').replace(/\.[^.]+$/, '') || 'subtitles';
  }
  function exportText() {
    const o = spot();
    if (S.fmt === 'vtt') return toVTT(cues, o);
    if (S.fmt === 'txt') return toText(cues);
    return toSRT(cues, o);
  }
  function openExport() {
    if (!cues.length) { toast('No cues yet — transcribe something first'); return; }
    clearPanelMsg();
    $('exportOv').hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('[data-fmt]'), b =>
      b.classList.toggle('is-on', b.getAttribute('data-fmt') === S.fmt));
    const text = exportText();
    $('out').value = text;
    $('exportNote').textContent = baseName() + '.' + S.fmt + ' · ' + cues.length + ' cues · ' +
      (text.length / 1024).toFixed(1) + ' KB' +
      (S.fmt === 'txt' ? '' : ' · lines laid out to ' + S.maxChars + ' characters');
    // Handing the transcript to the sibling app only makes sense where the
    // sibling is actually there: the same site, served over the web.
    $('readAloud').hidden = !(/^https?:$/.test(location.protocol) && !window.claude);
  }
  $('exportBtn').addEventListener('click', openExport);
  $('exportClose').addEventListener('click', () => { $('exportOv').hidden = true; });
  $('exportOv').addEventListener('click', e => { if (e.target === $('exportOv')) $('exportOv').hidden = true; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-fmt]'), b => {
    b.addEventListener('click', () => { S.fmt = b.getAttribute('data-fmt'); saveSettings(); openExport(); });
  });
  $('copyOut').addEventListener('click', () => {
    const text = $('out').value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Could not copy — use Download'));
    } else {
      $('out').select();
      toast('Copy it with the keyboard');
    }
  });
  $('saveOut').addEventListener('click', () => {
    const name = baseName() + '.' + S.fmt;
    const type = S.fmt === 'vtt' ? 'text/vtt' : (S.fmt === 'txt' ? 'text/plain' : 'application/x-subrip');
    const blob = new Blob([$('out').value], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Saved ' + name);
  });
  $('readAloud').addEventListener('click', () => {
    const text = toText(cues);
    try {
      localStorage.setItem('clearread.text', text.slice(0, 60000));
      location.href = '../clear-read/';
    } catch (e) {
      location.href = '../clear-read/?text=' + encodeURIComponent(text.slice(0, 4000));
    }
  });

  /* --------------------------------------------------------------- import -- */

  function readSubs(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const got = parseSubs(String(fr.result || ''));
      if (!got.length) { status('No subtitles were found in ' + file.name + '.', true); return; }
      cues = got;
      sel = -1;
      if (!media.name) media.name = file.name;
      render();
      $('empty').hidden = true;
      toast(got.length + ' cues read from ' + file.name);
    };
    fr.onerror = () => status('That file could not be read.', true);
    fr.readAsText(file);
  }
  $('subsFile').addEventListener('change', function () {
    if (this.files && this.files[0]) readSubs(this.files[0]);
    this.value = '';
  });
  const pickSubs = () => $('subsFile').click();
  $('importBtn').addEventListener('click', pickSubs);
  $('importBtn2').addEventListener('click', pickSubs);

  $('clearBtn').addEventListener('click', () => {
    if (cues.length && !confirm('Throw away ' + cues.length + ' cues?')) return;
    cues = []; sel = -1;
    try { localStorage.removeItem('subtext.project.v1'); } catch (e) { }
    if (media.url) URL.revokeObjectURL(media.url);
    media = { file: null, url: '', name: '', dur: 0 };
    v.removeAttribute('src'); v.load();
    $('viewer').hidden = true; $('transport').hidden = true;
    render();
    setRail(false);
  });

  /* --------------------------------------------------------- settings UI -- */

  const PROFILES = {
    broadcast: { maxChars: 37, maxLines: 2, maxCps: 15, minDur: 1, maxDur: 6, trail: 0.3, sentenceCues: false },
    easy: { maxChars: 32, maxLines: 2, maxCps: 11, minDur: 1.6, maxDur: 8, trail: 0.6, sentenceCues: false },
    sentence: { maxChars: 42, maxLines: 3, maxCps: 21, minDur: 1.4, maxDur: 12, trail: 0.5, sentenceCues: true }
  };

  function profileName() {
    for (const k in PROFILES) {
      if (Object.keys(PROFILES[k]).every(f => PROFILES[k][f] === S[f])) return k;
    }
    return '';
  }

  function syncSettings() {
    $('maxChars').value = S.maxChars; $('maxCharsVal').textContent = S.maxChars;
    $('maxCps').value = S.maxCps; $('maxCpsVal').textContent = S.maxCps + ' cps';
    $('minDur').value = S.minDur; $('minDurVal').textContent = S.minDur.toFixed(1) + ' s';
    $('maxDur').value = S.maxDur; $('maxDurVal').textContent = S.maxDur.toFixed(1) + ' s';
    $('trail').value = S.trail; $('trailVal').textContent = S.trail.toFixed(2) + ' s';
    $('capSize').value = S.capSize; $('capSizeVal').textContent = S.capSize + ' px';
    $('cap').style.fontSize = S.capSize + 'px';
    $('latency').value = S.latency; $('latVal').textContent = S.latency.toFixed(2) + ' s';
    $('provider').value = S.provider;
    $('customGrp').hidden = S.provider !== 'custom';
    $('baseUrl').value = S.baseUrl || '';
    $('model').value = S.model || '';
    $('cloudLang').value = S.cloudLang || '';
    $('apiKey').value = apiKey || '';
    $('rememberKey').classList.toggle('is-on', !!S.rememberKey);
    const prof = profileName();
    Array.prototype.forEach.call(document.querySelectorAll('[data-profile]'), b =>
      b.classList.toggle('is-on', b.getAttribute('data-profile') === prof));
    Array.prototype.forEach.call(document.querySelectorAll('[data-lines]'), b =>
      b.classList.toggle('is-on', +b.getAttribute('data-lines') === S.maxLines));
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), b =>
      b.classList.toggle('is-on', b.getAttribute('data-theme') === S.theme));
    document.documentElement.setAttribute('data-theme', S.theme === 'auto' ? '' : S.theme);
    if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  }

  // A limit changed: the cues keep their timings, but how they are laid out and
  // what counts as a problem both follow the new numbers, so re-render.
  function limitChanged() { saveSettings(); syncSettings(); render(); paintCaption(); }

  ['maxChars', 'maxCps', 'minDur', 'maxDur', 'trail', 'capSize'].forEach(id => {
    $(id).addEventListener('input', function () {
      S[id] = (id === 'maxChars' || id === 'capSize') ? +this.value : +this.value;
      limitChanged();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-lines]'), b => {
    b.addEventListener('click', () => { S.maxLines = +b.getAttribute('data-lines'); limitChanged(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-profile]'), b => {
    b.addEventListener('click', () => {
      Object.assign(S, PROFILES[b.getAttribute('data-profile')]);
      limitChanged();
      toast('Limits set. "Re-spot" rebuilds the cues to match.');
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), b => {
    b.addEventListener('click', () => { S.theme = b.getAttribute('data-theme'); limitChanged(); });
  });
  let shifted = 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-shift]'), b => {
    b.addEventListener('click', () => {
      if (!cues.length) { toast('No cues to move'); return; }
      const d = +b.getAttribute('data-shift');
      cues = shiftCues(cues, d, media.dur);
      shifted += d;
      render();
      $('shiftVal').textContent = (shifted > 0 ? '+' : '') + shifted.toFixed(1) + ' s';
    });
  });

  function setRail(open) {
    $('rail').classList.toggle('is-open', open);
    $('scrim').hidden = !open;
    $('settingsBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $('settingsBtn').addEventListener('click', () => setRail(!$('rail').classList.contains('is-open')));
  $('railClose').addEventListener('click', () => setRail(false));
  $('scrim').addEventListener('click', () => setRail(false));

  /* ------------------------------------------------------------- arrivals -- */

  /* Shared in from the phone's own share sheet. The service worker catches the
     POST, puts the file in a cache and sends us back here with ?shared=1. */
  function takeShared() {
    if (!/[?&]shared=1/.test(location.search) || !window.caches) return;
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    caches.open('subtext-share').then(c => c.match('shared-media').then(res => {
      if (!res) return;
      const name = res.headers.get('X-Name') || 'shared-video';
      res.blob().then(b => {
        openMedia(new File([b], name, { type: b.type || 'video/mp4' }));
        toast('Opened ' + name);
        c.delete('shared-media');
      });
    })).catch(() => { });
  }

  // Opened from the file manager on a desktop, where the app registers itself
  // as a handler for video files.
  if (window.launchQueue && window.launchQueue.setConsumer) {
    try {
      launchQueue.setConsumer(params => {
        if (params && params.files && params.files.length) {
          params.files[0].getFile().then(openMedia).catch(() => { });
        }
      });
    } catch (e) { }
  }

  /* ----------------------------------------------------------------- boot -- */

  LANGS.forEach(l => {
    const o = document.createElement('option');
    o.value = l; o.textContent = l;
    $('listenLang').appendChild(o);
  });
  if (LANGS.indexOf(S.listenLang) < 0) S.listenLang = 'en-GB';
  $('listenLang').value = S.listenLang;

  MODELS.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.label;
    $('wModel').appendChild(o);
  });
  if (!S.wModelChosen || !MODELS.some(m => m.id === S.wModel)) S.wModel = defaultModel();
  $('wModel').value = S.wModel;
  $('wLang').value = S.wLang || '';
  syncWhisper();

  syncSettings();
  updatePlay();

  const saved = loadProject();
  if (saved) {
    cues = saved.cues.map(c => ({ s: c.s, e: c.e, text: c.text, w: null }));
    media.name = saved.name || '';
    media.dur = saved.dur || 0;
    render();
    status('The cues from ' + (saved.name || 'last time') + ' are still here. Open the same file ' +
      'again to check them against the picture, or export them as they are.');
  } else {
    render();
  }
  takeShared();

  // A way for test/ui_test.py to run the audio paths against a real file.
  if (/[?&]probe=1/.test(location.search)) {
    window.SubtextProbe = {
      byPlayback: () => decodeByPlayback(media.file, () => { }),
      fromBytes: () => decodeFromBytes(media.file)
    };
  }

  window.addEventListener('pagehide', () => {
    capturing = false;
    if (rec) { try { rec.stop(); } catch (e) { } }
    releaseWake();
    stopWorker();
  });
})();
