/* Tribelands — drawing the islands, touch input and the screens around the map. */

const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
const TW = 64, TH = 32, LH = 6, WD = 4;          // tile size, land edge depth, water drop
const ZMIN = .5, ZMAX = 3;
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, z: 1 };
let mode = 'title';                               // 'title' | 'game'
let busy = false;
let sel = null, selMoves = { dests: new Set(), prev: new Map() }, selTargets = [];
let undoStack = [];
let prefs = { speed: 'normal', haptics: true, last: { tribe: 0, opponents: 2, size: 'medium', diff: 'normal' } };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { }
if (prefs.last && prefs.last.tribe > 3) prefs.last.tribe = 0;
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { } };
// A small buzz under the thumb, on phones that have one.
function buzz(p) { try { if (prefs.haptics && navigator.vibrate) navigator.vibrate(p); } catch (e) { } }

// ---------- colour ----------
const _shade = new Map();
function shade(hex, amt) {
  const key = hex + amt;
  let v = _shade.get(key);
  if (v) return v;
  let r, g, b;
  if (hex[0] === '#') { const n = parseInt(hex.slice(1), 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
  else [r, g, b] = hex.match(/\d+/g).map(Number);         // an rgb() this function made earlier
  const f = c => amt < 0 ? c * (1 + amt) : c + (255 - c) * amt;
  v = `rgb(${f(r) | 0},${f(g) | 0},${f(b) | 0})`;
  _shade.set(key, v);
  return v;
}
const colOf = p => TRIBES[S.players[p].tribe].color;

// ---------- geometry ----------
const iso = (x, y) => [(x - y) * TW / 2, (x + y) * TH / 2];
function screenToTile(sx, sy) {
  const wx = (sx - W / 2) / cam.z + cam.x, wy = (sy - H / 2) / cam.z + cam.y;
  const a = wx / (TW / 2), b = wy / (TH / 2);
  return [Math.round((a + b) / 2), Math.round((b - a) / 2)];
}
const toScreen = (wx, wy) => [(wx - cam.x) * cam.z + W / 2, (wy - cam.y) * cam.z + H / 2];
function clampCam() {
  if (!S) return;
  const n = S.n;
  cam.z = clamp(cam.z, ZMIN, ZMAX);
  cam.x = clamp(cam.x, -n * TW / 2, n * TW / 2);
  cam.y = clamp(cam.y, -TH, n * TH);
}
const panelH = () => mode === 'game' && !$('#panel').hidden ? $('#panel').offsetHeight + 80 : 0;
// Where on screen a focused tile should sit: in the clear space between the HUD and the panel.
function focusY() { return (70 + (H - panelH())) / 2; }
function centerOn(x, y) { const [wx, wy] = iso(x, y); cam.x = wx; cam.y = wy - (focusY() - H / 2) / cam.z; clampCam(); }
// Glide the camera so a tile is not hidden under the HUD or the panel.
function ensureVisible(x, y) {
  const [wx, wy] = iso(x, y), [sx, sy] = toScreen(wx, wy);
  if (sy > 90 && sy < H - panelH() - 20 && sx > 30 && sx < W - 30) return;
  const fx = cam.x, fy = cam.y;
  const tx = wx, ty = wy - (focusY() - H / 2) / cam.z;
  tween(260, t => { const e = 1 - (1 - t) ** 3; cam.x = fx + (tx - fx) * e; cam.y = fy + (ty - fy) * e; clampCam(); });
}

// ---------- drawing primitives ----------
function poly(pts, fill) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function dot(x, y, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function line(x1, y1, x2, y2, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function dpath(cx, cy, w = TW / 2, h = TH / 2) {
  ctx.beginPath(); ctx.moveTo(cx, cy - h); ctx.lineTo(cx + w, cy); ctx.lineTo(cx, cy + h); ctx.lineTo(cx - w, cy); ctx.closePath();
}
// A triangle split down its apex into a lit and a shaded facet — the low-poly look.
function tri2(xl, xr, yb, xa, ya, col) {
  poly([xl, yb, xa, yb + 1, xa, ya], shade(col, .14));
  poly([xa, yb + 1, xr, yb, xa, ya], shade(col, -.12));
}
function tile3(cx, cy, top, side) {
  const w = TW / 2 + .5, h = TH / 2 + .25;
  if (side) {
    poly([cx - w, cy, cx, cy + h, cx, cy + h + side, cx - w, cy + side], shade(top, -.28));
    poly([cx, cy + h, cx + w, cy, cx + w, cy + side, cx, cy + h + side], shade(top, -.42));
  }
  poly([cx, cy - h, cx + w, cy, cx, cy + h, cx - w, cy], top);
  poly([cx, cy - h, cx, cy + h, cx - w, cy], shade(top, .05));
}
// An upright box: two walls and a lighter top — used for huts, basalt columns and totems.
function box(x, y, w, d, h, col) {
  poly([x - w, y - d, x, y, x, y - h, x - w, y - d - h], shade(col, .04));
  poly([x, y, x + w, y - d, x + w, y - d - h, x, y - h], shade(col, -.2));
  poly([x - w, y - d - h, x, y - h, x + w, y - d - h, x, y - 2 * d - h], shade(col, .22));
}

// ---------- terrain ----------
const SAND = '#E8D59A';
function coastal(x, y) { for (const [nx, ny] of nbrs(x, y)) if (isWater(tileAt(nx, ny).t)) return true; return false; }
function drawGround(x, y) {
  const i = I(x, y), t = S.tiles[i];
  const [cx, cy] = iso(x, y);
  if (!seen(i)) { tile3(cx, cy, hash(x, y, 2) < .5 ? '#1D3445' : '#20394B', LH); return; }
  if (isWater(t.t)) {
    const c = t.t === SHALLOW ? '#4CC3C9' : '#1F6F9E';
    tile3(cx, cy + WD, shade(c, (hash(x, y, 3) - .5) * .05), 0);
    // surf where the lagoon meets the land
    if (t.t === SHALLOW && [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => inb(x + dx, y + dy) && !isWater(tileAt(x + dx, y + dy).t))) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; dpath(cx, cy + WD, TW / 2 - 4, TH / 2 - 2); ctx.stroke();
    }
    if (hash(x, y, 4) < .5) {
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.3;
      const ox = (hash(x, y, 5) - .5) * 26, oy = (hash(x, y, 6) - .5) * 10 + WD;
      ctx.beginPath(); ctx.moveTo(cx + ox - 6, cy + oy); ctx.quadraticCurveTo(cx + ox - 3, cy + oy - 2.5, cx + ox, cy + oy);
      ctx.quadraticCurveTo(cx + ox + 3, cy + oy + 2.5, cx + ox + 6, cy + oy); ctx.stroke();
    }
    return;
  }
  const pal = TRIBES[t.clim].pal;
  let top;
  if (t.cityHere >= 0) top = S.cities[t.cityHere].owner >= 0 ? '#E3CFA0' : SAND;
  else if (t.t === FOREST) top = shade(pal.forest, .25);
  else if (t.t === MOUNTAIN) top = shade(pal.mountain, .1);
  else top = coastal(x, y) ? SAND : pal.field;
  top = shade(top, (hash(x, y, 1) - .5) * .08);
  tile3(cx, cy, top, LH);
  if (t.imp === 'garden') {
    ctx.save(); dpath(cx, cy, TW / 2 - 7, TH / 2 - 3.5); ctx.clip();
    poly([cx - 40, cy - 30, cx + 40, cy - 30, cx + 40, cy + 30, cx - 40, cy + 30], '#8A6440');
    for (let k = -4; k <= 4; k++) for (let j = -3; j <= 3; j++) {
      const px = cx + k * 7 + j * 3.5, py = cy + j * 3.5 - k * 1.2;
      poly([px - 2.5, py, px, py - 4, px + 2.5, py], '#5FAE45');
    }
    ctx.restore();
  }
}
function drawRoads() {
  const n = S.n;
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? '#D9BE86' : '#8C6B42';
    ctx.lineWidth = pass ? 3.5 : 6;
    for (let i = 0; i < n * n; i++) {
      const t = S.tiles[i];
      if (!t.road || !seen(i)) continue;
      const [x, y] = XY(i), [cx, cy] = iso(x, y);
      let any = false;
      ctx.beginPath();
      for (const [nx, ny] of nbrs(x, y)) {
        const j = I(nx, ny);
        if (!roadish(j) || !seen(j)) continue;
        const [ox, oy] = iso(nx, ny);
        ctx.moveTo(cx, cy); ctx.lineTo((cx + ox) / 2, (cy + oy) / 2); any = true;
      }
      if (!any) { ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); }
      ctx.stroke();
    }
  }
}
function drawBorders() {
  const n = S.n;
  for (let i = 0; i < n * n; i++) {
    if (!seen(i)) continue;
    const o = ownerOfI(i);
    if (o < 0) continue;
    const [x, y] = XY(i), t = S.tiles[i];
    let [cx, cy] = iso(x, y);
    if (isWater(t.t)) cy += WD;
    const col = colOf(o);
    ctx.globalAlpha = .16; dpath(cx, cy); ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    const w = TW / 2, h = TH / 2, f = .88;
    const N = [cx, cy - h * f], E = [cx + w * f, cy], Sv = [cx, cy + h * f], Wv = [cx - w * f, cy];
    const edges = [[x, y - 1, N, E], [x + 1, y, E, Sv], [x, y + 1, Sv, Wv], [x - 1, y, Wv, N]];
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const [nx, ny, a, b] of edges) {
      if (inb(nx, ny) && ownerOfI(I(nx, ny)) === o) continue;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
}

function drawTree(kind, x, y, col, s = 1, nuts = false) {
  if (kind === 'palm') {
    const lean = (hash(x | 0, y | 0, 7) - .5) * 8;
    ctx.strokeStyle = '#8A6A45'; ctx.lineWidth = 2.6 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * .2, y - 10 * s, x + lean, y - 19 * s); ctx.stroke();
    const tx = x + lean, ty = y - 19 * s;
    for (const [a, l] of [[-2.7, 11], [-2.1, 12], [-.9, 12], [-.4, 11], [-1.55, 9]]) {
      const ex = tx + Math.cos(a) * l * s, ey = ty + Math.sin(a) * l * s + 5;
      poly([tx, ty, ex, ey, tx + Math.cos(a + .35) * l * .5 * s, ty + Math.sin(a + .35) * l * .5 * s + 1], a < -1.5 ? shade(col, .12) : shade(col, -.08));
    }
    if (nuts) { dot(tx - 2, ty + 2, 2.2, '#6B4A2A'); dot(tx + 2, ty + 2.5, 2.2, '#5A3D22'); dot(tx, ty + 4, 2.2, '#7A5530'); }
  } else if (kind === 'banana') {
    line(x, y, x, y - 9 * s, '#6E7F3A', 2.4 * s);
    for (const [dx, dy, r] of [[-7, -12, -.6], [7, -12, .6], [0, -15, 0]]) {
      ctx.save(); ctx.translate(x + dx * s * .6, y + dy * s); ctx.rotate(r);
      ctx.fillStyle = r < 0 ? shade(col, .15) : shade(col, -.05);
      ctx.beginPath(); ctx.ellipse(0, 0, 3.5 * s, 8 * s, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  } else if (kind === 'bamboo') {
    for (const d of [-4, 0, 4]) {
      const h = (18 + (d + 4) * .6) * s;
      poly([x + d - 1, y, x + d + 1, y, x + d + 1, y - h, x + d - 1, y - h], shade(col, d < 0 ? .3 : .12));
      poly([x + d + 1, y - h + 4, x + d + 7, y - h + 1, x + d + 2, y - h + 7], shade(col, -.05));
    }
  } else {                                         // dense jungle: broad crowns and a vine
    line(x, y, x, y - 7, '#4A3524', 2.2);
    const r = 8 * s;
    dot(x - 3, y - 12 * s, r * .8, shade(col, -.15));
    dot(x + 3, y - 14 * s, r * .85, col);
    dot(x - 1, y - 17 * s, r * .6, shade(col, .15));
    ctx.strokeStyle = shade(col, .3); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 5, y - 12); ctx.quadraticCurveTo(x + 7, y - 6, x + 5, y - 2); ctx.stroke();
  }
}
// Cliffs are faceted volcanic boulders, mossy on top.
function rock(x, y, w, h, col) {
  const L = [x - w, y], LS = [x - w * .8, y - h * .55], TL = [x - w * .3, y - h], TR = [x + w * .35, y - h * .9],
    RS = [x + w * .85, y - h * .45], R = [x + w, y], B = [x, y + h * .16], M = [x - w * .05, y - h * .45];
  poly([...L, ...LS, ...TL, ...M, ...B], shade(col, .12));
  poly([...TL, ...TR, ...RS, ...R, ...B, ...M], shade(col, -.16));
  poly([...TL, ...TR, x + w * .1, y - h * .7, ...M], shade(col, .02));
  poly([TL[0] + 1, TL[1] + 1, TR[0] - 1, TR[1] + 1, x + w * .05, y - h * .78], '#5E9A48');
}
function drawCliffs(cx, cy, pal, x, y) {
  const c = pal.mountain, j = hash(x, y, 21);
  rock(cx + 7, cy - 1, 15, 24 + j * 6, c);
  rock(cx - 10, cy + 4, 13, 16 + j * 5, shade(c, -.06));
  rock(cx + 3, cy + 9, 8, 8, shade(c, .06));
}
function drawVolcano(cx, cy, now) {
  poly([cx - 30, cy + 6, cx + 2, cy + 13, cx - 6, cy - 30], '#4B3F3E');
  poly([cx + 2, cy + 13, cx + 30, cy + 5, cx + 6, cy - 30], '#332A2A');
  poly([cx - 6, cy - 30, cx + 6, cy - 30, cx + 3, cy - 26, cx - 4, cy - 26], '#FF7A2E');
  ctx.fillStyle = 'rgba(255,120,40,.35)'; ctx.beginPath(); ctx.ellipse(cx, cy - 29, 10, 4, 0, 0, 7); ctx.fill();
  poly([cx - 4, cy - 26, cx - 1, cy - 26, cx - 6, cy - 12, cx - 9, cy - 10], '#E0551F');
  const t = now / 1400;
  for (let k = 0; k < 3; k++) {
    const p = (t + k / 3) % 1;
    ctx.fillStyle = `rgba(200,200,205,${.45 * (1 - p)})`;
    ctx.beginPath(); ctx.arc(cx + Math.sin(p * 5 + k) * 4 + p * 6, cy - 34 - p * 26, 4 + p * 7, 0, 7); ctx.fill();
  }
}
function drawRes(t, cx, cy, pal) {
  const r = t.res;
  if (r === 'coconut') drawTree('palm', cx + 9, cy + 5, '#3F9A55', .95, true);
  else if (r === 'taro') {
    for (const [dx, dy] of [[-8, 3], [3, -1], [8, 5]]) {
      line(cx + dx, cy + dy, cx + dx, cy + dy - 7, '#5E8F3A', 1.4);
      ctx.fillStyle = '#4FA24A'; ctx.beginPath(); ctx.moveTo(cx + dx, cy + dy - 6);
      ctx.bezierCurveTo(cx + dx - 8, cy + dy - 12, cx + dx - 3, cy + dy - 17, cx + dx, cy + dy - 12);
      ctx.bezierCurveTo(cx + dx + 3, cy + dy - 17, cx + dx + 8, cy + dy - 12, cx + dx, cy + dy - 6); ctx.fill();
    }
  } else if (r === 'boar') {
    const x = cx + 9, y = cy + 5;
    ctx.strokeStyle = '#2E2019'; ctx.lineWidth = 1.5;
    ctx.beginPath(); for (const lx of [-4, -2, 3, 5]) { ctx.moveTo(x + lx, y - 3); ctx.lineTo(x + lx, y + 1); } ctx.stroke();
    poly([x - 7, y - 3, x + 6, y - 3, x + 8, y - 8, x - 6, y - 10], '#5B4033');
    poly([x - 5, y - 10, x + 5, y - 9, x + 3, y - 12, x - 3, y - 12], '#3E2C22');
    poly([x + 6, y - 8, x + 12, y - 6, x + 11, y - 3, x + 6, y - 3], '#6B4B3B');
    poly([x + 10, y - 5, x + 13, y - 8, x + 11, y - 5], '#F2EEE4');
  } else if (r === 'obsidian') {
    tri2(cx - 18, cx - 8, cy + 8, cx - 13, cy - 6, '#2A2433');
    tri2(cx - 10, cx - 3, cy + 10, cx - 7, cy + 1, '#3D2F55');
    ctx.strokeStyle = 'rgba(190,160,255,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 14, cy - 3); ctx.lineTo(cx - 12, cy + 4); ctx.stroke();
  } else if (r === 'fish') {
    const x = cx + 4, y = cy + WD + 1;
    poly([x - 7, y, x - 2, y - 3, x + 4, y - 2, x + 6, y, x + 4, y + 2, x - 2, y + 3], 'rgba(255,245,230,.9)');
    poly([x + 5, y, x + 10, y - 3, x + 10, y + 3], 'rgba(255,245,230,.9)');
  }
}
// A thatched round hut: wooden walls, a straw cone, a band in the tribe's colour.
function drawHut(x, y, band, s = 1, tall = 0) {
  box(x, y, 6 * s, 3 * s, (6 + tall) * s, '#C79A63');
  const top = y - (6 + tall) * s - 3 * s;
  poly([x - 8 * s, top + 1, x, top + 5 * s, x, top - 10 * s], '#E2C27A');
  poly([x, top + 5 * s, x + 8 * s, top + 1, x, top - 10 * s], '#BF9A52');
  if (band) poly([x - 7 * s, top + 1, x, top + 4.5 * s, x, top + 2 * s, x - 5.5 * s, top - 1], band);
}
function drawImp(t, cx, cy, owner, now) {
  if (t.imp === 'quarry') {
    for (const [dx, dy] of [[-6, 6], [2, 8], [-2, 2]]) box(cx + dx, cy + dy, 4, 2, 3, '#6E6A74');
    poly([cx + 6, cy + 3, cx + 12, cy + 1, cx + 10, cy - 5], '#2A2433');
  } else if (t.imp === 'hut') {
    for (const k of [-5, 0, 5]) line(cx + 8 + k * .8, cy + 6, cx + 8 + k * .8, cy + 1, '#6B4A2A', 1.4);
    drawHut(cx + 8, cy + 1, null, .95);
  } else if (t.imp === 'post') {
    const x = cx + 4, y = cy + 4;
    box(x, y, 10, 5, 6, '#B98A55');
    for (let k = 0; k < 4; k++) poly([x - 12 + k * 6, y - 12 + k * 3, x - 6 + k * 6, y - 9 + k * 3, x - 4 + k * 6, y - 15 + k * 3, x - 10 + k * 6, y - 18 + k * 3], k % 2 ? '#F4F0E6' : '#1FA39C');
    dot(x - 5, y - 8, 1.8, '#E4553B'); dot(x - 1, y - 7, 1.8, '#E3C04B'); dot(x + 3, y - 6, 1.8, '#7BBF4A');
  } else if (t.imp === 'signal') {
    const x = cx + 10, y = cy + 2;
    line(x - 5, y, x + 5, y - 3, '#5A3C22', 2.4); line(x - 5, y - 3, x + 5, y, '#6B4A2A', 2.4);
    const f = 1 + Math.sin(now / 120 + cx) * .12;
    ctx.fillStyle = 'rgba(255,170,60,.3)'; ctx.beginPath(); ctx.arc(x, y - 8, 11 * f, 0, 7); ctx.fill();
    poly([x - 5, y - 2, x + 5, y - 2, x + 1, y - 17 * f], '#FF8A2A');
    poly([x - 2.5, y - 2, x + 3, y - 2, x + .5, y - 11 * f], '#FFD24A');
  } else if (t.imp === 'dock') {
    const y = cy + WD;
    poly([cx - 13, y - 1, cx + 2, y - 8, cx + 14, y - 2, cx, y + 5], '#A5764A');
    for (let k = -2; k <= 2; k++) line(cx - 10 + k * 5 + 8, y - 5 + k * 1.5, cx - 4 + k * 5, y + 2 + k * 1.5, 'rgba(90,60,34,.5)', 1);
    line(cx + 6, y - 3, cx + 6, y - 18, '#5A3C22', 1.6);
    if (owner >= 0) poly([cx + 6, y - 18, cx + 14, y - 15.5, cx + 6, y - 13], colOf(owner));
  }
}
function drawWreck(cx, cy) {
  poly([cx - 16, cy - 2, cx + 12, cy - 9, cx + 16, cy - 2, cx - 10, cy + 6], '#6B4A2E');
  poly([cx - 16, cy - 2, cx - 10, cy + 6, cx - 9, cy + 2, cx - 14, cy - 3], '#4E3521');
  for (let k = 0; k < 4; k++) line(cx - 10 + k * 6, cy - 3 - k * 1.5, cx - 7 + k * 6, cy + 3 - k * 1.5, '#3B2819', 1.2);
  line(cx + 2, cy - 5, cx - 6, cy - 24, '#5A3C22', 2);
  poly([cx - 6, cy - 23, cx + 6, cy - 19, cx - 2, cy - 12], 'rgba(240,232,210,.85)');
}
const HOUSE_SPOTS = [[0, -6], [-14, -1], [14, -1], [-7, 5], [8, 5], [0, 10]];
function drawCity(c, cx, cy, now) {
  if (c.owner < 0) {                                  // a stranded castaways' shack, with an SOS flag
    box(cx - 5, cy + 2, 7, 3.5, 6, '#A58456');
    poly([cx - 13, cy - 5, cx - 5, cy - 1, cx + 3, cy - 5, cx - 5, cy - 11], '#C9A86A');
    line(cx + 9, cy + 4, cx + 9, cy - 18, '#6B4A2A', 1.5);
    poly([cx + 9, cy - 18, cx + 19, cy - 16, cx + 9, cy - 12], '#F4F0E6');
    return;
  }
  const col = colOf(c.owner);
  if (c.walls) {                                      // palisade of sharpened stakes
    const w = TW / 2 - 4, h = TH / 2 - 2;
    for (let k = 0; k <= 16; k++) {
      const a = k / 16 * Math.PI * 2, px = cx + Math.cos(a) * w * .95, py = cy + Math.sin(a) * h * .95;
      if (Math.sin(a) < -.2) line(px, py, px, py - 7, '#7A5530', 2.2);
    }
  }
  // the fire at the heart of camp
  const f = 1 + Math.sin(now / 140 + c.id) * .15;
  ctx.fillStyle = 'rgba(255,160,60,.28)'; ctx.beginPath(); ctx.arc(cx, cy + 2, 8 * f, 0, 7); ctx.fill();
  const k = Math.min(6, 1 + c.level);
  const spots = HOUSE_SPOTS.slice(0, k).sort((a, b) => a[1] - b[1]);
  for (const [dx, dy] of spots) {
    if (c.capital && dx === 0 && dy === -6) {         // the first camp's totem pole
      for (let j = 0; j < 4; j++) box(cx, cy - 6 - j * 7, 3.5, 1.8, 7, j % 2 ? col : '#8A6440');
      poly([cx - 9, cy - 34, cx + 9, cy - 34, cx, cy - 38], '#E2C27A');
      continue;
    }
    drawHut(cx + dx, cy + dy, col, .95);
  }
  line(cx - 3, cy + 5, cx + 3, cy + 3, '#5A3C22', 2); line(cx - 3, cy + 3, cx + 3, cy + 5, '#5A3C22', 2);
  poly([cx - 3, cy + 4, cx + 3, cy + 4, cx, cy - 5 * f], '#FF8A2A');
  if (c.parks) { line(cx + 18, cy + 4, cx + 26, cy + 2, '#E8D8B0', 1.4); drawTree('palm', cx + 17, cy + 6, '#3F9A55', .6); drawTree('palm', cx + 27, cy + 3, '#3F9A55', .6); }
  const w = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
  if (w) drawWonder(w, cx - 18, cy + 4, col, now);
}
function drawWonder(key, x, y, col, now) {
  if (key === 'lighthouse') {
    for (let j = 0; j < 4; j++) box(x, y - j * 7, 4.5 - j * .4, 2.2, 7, j % 2 ? '#D23F3A' : '#F4F1EA');
    const beam = (Math.sin(now / 600) + 1) / 2;
    ctx.fillStyle = `rgba(255,236,150,${.25 + beam * .35})`; ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x - 26 + beam * 52, y - 42); ctx.lineTo(x - 22 + beam * 52, y - 34); ctx.fill();
    dot(x, y - 31, 3, '#FFE98A');
  } else if (key === 'totems') {
    for (const dx of [-6, 6]) {
      box(x + dx, y + (dx > 0 ? 2 : 0), 3.5, 1.8, 16, '#8C8A84');
      dot(x + dx - 1.5, y - 10 + (dx > 0 ? 2 : 0), 1, '#222'); dot(x + dx + .5, y - 10 + (dx > 0 ? 2 : 0), 1, '#222');
    }
  } else if (key === 'market') {
    ctx.fillStyle = 'rgba(40,160,200,.5)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 14, 6, 0, 0, 7); ctx.fill();
    box(x, y, 10, 5, 3, '#A5764A');
    poly([x - 10, y - 8, x, y - 3, x + 10, y - 8, x, y - 16], '#E7B23A');
  } else if (key === 'spring') {
    ctx.fillStyle = '#6FD0E0'; ctx.beginPath(); ctx.ellipse(x, y, 11, 5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(x, y, 7 + Math.sin(now / 300) * 2, 3, 0, 0, 7); ctx.stroke();
    for (const dx of [-9, 9]) box(x + dx, y - 2, 2, 1, 8, '#CFC8BA');
  } else if (key === 'throne') {
    box(x, y, 8, 4, 4, '#2A2433');
    poly([x - 6, y - 8, x + 6, y - 8, x + 4, y - 22, x - 4, y - 22], '#3D2F55');
    const f = 1 + Math.sin(now / 110) * .15;
    poly([x - 3, y - 22, x + 3, y - 22, x, y - 30 * f], '#FF8A2A');
  }
}
function drawChallenge(ch, cx, cy, now) {
  const C = CHALLENGES[ch.kind], gold = ch.kind === 'immunity';
  const p = (Math.sin(now / 300) + 1) / 2;
  ctx.strokeStyle = gold ? `rgba(255,210,74,${.5 + p * .5})` : `rgba(90,200,255,${.5 + p * .5})`;
  ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(cx, cy + 1, 20 + p * 4, 10 + p * 2, 0, 0, 7); ctx.stroke();
  box(cx, cy + 3, 7, 3.5, 3, '#E8D8B0');
  for (let j = 0; j < 6; j++) line(cx, cy - j * 5, cx, cy - j * 5 - 5, j % 2 ? '#fff' : '#D23F3A', 2);
  const wave = Math.sin(now / 200) * 2;
  poly([cx, cy - 30, cx + 16, cy - 27 + wave, cx, cy - 22], gold ? '#FFD24A' : '#3FB7F0');
  void C;
}
function drawCloud(cx, cy, x, y) {
  if (hash(x, y, 9) > .45) return;
  ctx.fillStyle = 'rgba(210,230,240,.08)';
  const ox = (hash(x, y, 10) - .5) * 20;
  for (const [dx, dy, r] of [[-7, 0, 7], [2, -3, 9], [10, 1, 6]]) { ctx.beginPath(); ctx.arc(cx + ox + dx, cy + dy - 4, r, 0, 7); ctx.fill(); }
}

// ---------- units ----------
function hat(kind, hy, col) {
  if (kind === 'flower') {
    for (const [dx, dy] of [[-3, -4], [0, -5], [3, -4]]) dot(dx, hy + dy, 1.9, '#FF5A7A');
    dot(-4, hy - 1, 2.6, '#FF5A7A'); dot(-4, hy - 1, 1, '#FFE066');
    for (let k = -3; k <= 3; k++) dot(k * 1.4, -14.5 + Math.abs(k) * -.3, 1.2, k % 2 ? '#FF9EC0' : '#FFE066');
  } else if (kind === 'buff') {
    poly([-4.8, hy - 2, 4.8, hy - 2, 4, hy - 5.5, -4, hy - 5.5], col);
    poly([4, hy - 3, 8, hy - 1, 7, hy + 1.5], shade(col, -.2));
  } else if (kind === 'cap') {                       // a pilot's cap with a gold badge
    poly([-4.8, hy - 2, 4.8, hy - 2, 4.2, hy - 6.5, -4.2, hy - 6.5], '#1F2F4A');
    poly([-5.5, hy - 2, 6.5, hy - 2, 5.5, hy - .8, -5.5, hy - .8], '#111A2A');
    dot(0, hy - 4.2, 1.1, '#FFD24A');
  } else if (kind === 'school') {                    // a striped school cap
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, hy - 2.5, 4.8, Math.PI, 0); ctx.fill();
    line(-4.6, hy - 3.6, 4.6, hy - 3.6, '#fff', .9);
    poly([1, hy - 2.5, 8, hy - 2, 7, hy - .8, 1, hy - 1.4], shade(col, -.25));
  } else if (kind === 'paint') {                     // war paint, no hat
    line(-3.4, hy - 1.5, 3.4, hy - 2.5, '#D8322A', 1.4);
    line(-3.4, hy + 1, 3.4, hy + .2, '#F4F0E6', 1.1);
    poly([-4.4, hy - 3, 4.4, hy - 3, 3.4, hy - 5.8, -3.4, hy - 5.8], '#2A1E16');
  } else if (kind === 'fur') {                       // Crusoe's tall goatskin hat
    poly([-5, hy - 2, 5, hy - 2, 2.5, hy - 12, -2.5, hy - 12], '#8A6A45');
    for (let k = 0; k < 4; k++) line(-4 + k * 2.6, hy - 2, -3 + k * 2, hy - 10, '#6E5234', .7);
  } else if (kind === 'sun') {                       // a wide straw sun hat
    ctx.fillStyle = '#E8C77A'; ctx.beginPath(); ctx.ellipse(0, hy - 2.5, 8.5, 2.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#D9B25E'; ctx.beginPath(); ctx.arc(0, hy - 3, 3.8, Math.PI, 0); ctx.fill();
  } else if (kind === 'sailor') {                    // a white sailor's cap
    ctx.fillStyle = '#F7F7F2'; ctx.beginPath(); ctx.ellipse(0, hy - 3.2, 5.5, 2.6, 0, 0, 7); ctx.fill();
    line(-5.2, hy - 2.4, 5.2, hy - 2.4, '#2D5DA8', 1.1);
  } else if (kind === 'ears') {                      // the Beast-folk: pointed ears and a muzzle
    poly([-4.5, hy - 1, -2, hy - 3, -5.5, hy - 8], '#6E4A2E');
    poly([4.5, hy - 1, 2, hy - 3, 5.5, hy - 8], '#6E4A2E');
    poly([-1.8, hy + 1, 1.8, hy + 1, 0, hy + 3.5], '#3A2618');
  } else if (kind === 'goggles') {                   // aviator goggles pushed up
    poly([-4.6, hy - 2.2, 4.6, hy - 2.2, 4.4, hy - 3.6, -4.4, hy - 3.6], '#6B4A2A');
    dot(-2, hy - 3, 1.8, '#8FD3F4'); dot(2, hy - 3, 1.8, '#8FD3F4');
    ctx.strokeStyle = '#4A4A4A'; ctx.lineWidth = .7; ctx.beginPath(); ctx.arc(-2, hy - 3, 1.8, 0, 7); ctx.arc(2, hy - 3, 1.8, 0, 7); ctx.stroke();
  } else if (kind === 'wizard') {                    // a magician's pointed hat, starred
    poly([-6, hy - 2, 6, hy - 2, 1, hy - 15], '#2B3380');
    poly([-6.5, hy - 2, 6.5, hy - 2, 5.5, hy - .8, -5.5, hy - .8], '#1E2460');
    dot(-1, hy - 7, .9, '#FFE066'); dot(1.5, hy - 10, .8, '#FFE066');
  } else if (kind === 'tricorn') {                   // a pirate's tricorn
    poly([-7, hy - 2, 7, hy - 2, 4, hy - 7, 0, hy - 5, -4, hy - 7], '#1E1E1E');
    line(-6, hy - 2.3, 6, hy - 2.3, '#C9A23A', .9);
  } else if (kind === 'tiny') {                      // a Lilliputian's plumed courtier's hat
    poly([-4.6, hy - 2, 4.6, hy - 2, 3.4, hy - 5.5, -3.4, hy - 5.5], shade(col, -.2));
    ctx.strokeStyle = '#F4F0E6'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(2, hy - 5); ctx.quadraticCurveTo(6, hy - 10, 8, hy - 6); ctx.stroke();
  }
}
function figure(u, T, col) {
  const dark = shade(col, -.3);
  ctx.strokeStyle = '#3B2A1E'; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(-2.5, -4); ctx.lineTo(-3, 0); ctx.moveTo(2.5, -4); ctx.lineTo(3, 0); ctx.stroke();
  poly([-5.5, -4, 0, -4, 0, -15, -4, -15], shade(col, .08));
  poly([0, -4, 5.5, -4, 4, -15, 0, -15], dark);
  poly([-5.5, -4, 5.5, -4, 5, -6.5, -5, -6.5], '#E8D8B0');            // grass skirt band
  const hy = -19, r = 4.3;
  const skin = u.type === 'beast' ? '#9A6B45' : T.skin;
  poly([0, hy - r, r * .87, hy - r / 2, r * .87, hy + r / 2, 0, hy + r, -r * .87, hy + r / 2, -r * .87, hy - r / 2], skin);
  poly([0, hy - r, 0, hy + r, -r * .87, hy + r / 2, -r * .87, hy - r / 2], shade(skin, .1));
  hat(u.type === 'beast' ? 'ears' : T.hat, hy, col);
  const ty = u.type;
  ctx.lineCap = 'round';
  if (ty === 'beast') {
    for (const k of [0, 1.6, 3.2]) line(5 + k * .5, -9, 8 + k, -13, '#EDE3D0', .9);
  } else if (ty === 'scrapper' || ty === 'titan') {
    line(5, -9, 9, -20, '#6B4A30', 2.6); dot(9, -20, 2.3, '#6B4A30');
  } else if (ty === 'slinger') {
    ctx.strokeStyle = '#8A6A45'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(5, -12); ctx.quadraticCurveTo(12, -22, 8, -26); ctx.stroke();
    dot(8, -26, 2, '#8C8A84');
  } else if (ty === 'shieldbearer') {
    ctx.fillStyle = '#5E7A3A'; ctx.beginPath(); ctx.ellipse(-6, -10, 5.5, 7, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#9DBA62'; ctx.lineWidth = .9;
    ctx.beginPath(); ctx.moveTo(-6, -16); ctx.lineTo(-6, -4); ctx.moveTo(-10.5, -10); ctx.lineTo(-1.5, -10); ctx.stroke();
  } else if (ty === 'blade') {
    line(6, -9, 11, -23, '#2A2433', 2.6);
    line(6.5, -12, 10, -21, '#8C7AB8', .8);
    line(4, -11, 8.5, -9, '#7A5230', 1.6);
  } else if (ty === 'runner') {
    poly([-4.8, hy - 2, 4.8, hy - 2, 4.6, hy - 3.4, -4.6, hy - 3.4], col);
  } else if (ty === 'healer') {
    line(6, -2, 8, -24, '#6B4A30', 1.8);
    dot(8, -25, 4.5, 'rgba(130,255,150,.45)'); dot(8, -25, 2.2, '#6FE08F');
  } else if (ty === 'schemer') {                     // carries a tiki torch
    line(6, -2, 8, -22, '#8A6A45', 1.8);
    poly([5.5, -22, 10.5, -22, 9.5, -25, 6.5, -25], '#C9A86A');
    const f = 1 + Math.sin(performance.now() / 110) * .15;
    poly([6, -25, 10, -25, 8, -32 * f], '#FF8A2A');
  } else if (ty === 'boarrider') {
    line(-2, -8, 16, -16, '#2A2433', 1.8);
  }
}
function drawBoar(col) {
  ctx.strokeStyle = '#2E2019'; ctx.lineWidth = 1.8;
  ctx.beginPath(); for (const lx of [-8, -5, 4, 7]) { ctx.moveTo(lx, -5); ctx.lineTo(lx, 1); } ctx.stroke();
  poly([-11, -5, 9, -5, 11, -12, -10, -13], '#5B4033');
  poly([-9, -13, 7, -13, 5, -16, -7, -16], '#3E2C22');
  poly([9, -12, 16, -9, 15, -5, 9, -5], '#6B4B3B');
  poly([14, -8, 18, -12, 15, -7], '#F2EEE4');
  poly([-6, -13, 5, -13, 4, -10, -5, -10], shade(col, -.1));
}
function drawTiger() {
  ctx.strokeStyle = '#3A2410'; ctx.lineWidth = 2.2;
  ctx.beginPath(); for (const lx of [-10, -6, 6, 10]) { ctx.moveTo(lx, -6); ctx.lineTo(lx + (lx < 0 ? -1 : 1), 1); } ctx.stroke();
  poly([-14, -6, 11, -6, 13, -14, -12, -15], '#E27A22');
  poly([-12, -15, 11, -14, 9, -17, -10, -17], '#F29A45');
  for (const k of [-9, -4, 1, 6]) poly([k, -17, k + 2, -17, k + 1, -9], '#231612');
  poly([10, -15, 19, -14, 19, -7, 11, -6], '#E8842C');
  poly([13, -9, 19, -9, 18, -6, 13, -6], '#F4E6D0');
  poly([12, -15, 13, -19, 15, -15], '#E27A22'); poly([16, -15, 18, -19, 19, -14], '#E27A22');
  dot(16.5, -12, .9, '#1A1A1A');
  ctx.strokeStyle = '#E27A22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-13, -12); ctx.quadraticCurveTo(-20, -14, -18, -22); ctx.stroke();
}
function drawCatapult(col) {
  ctx.fillStyle = '#3E2F22';
  for (const wx of [-7, 7]) { ctx.beginPath(); ctx.arc(wx, -2, 3, 0, 7); ctx.fill(); }
  poly([-11, -3, 11, -3, 10, -7, -10, -7], '#C9A86A');
  line(-8, -9, 9, -22, '#A5864E', 2.2);
  line(-3, -7, 1, -14, '#A5864E', 2);
  dot(9, -23, 3.2, '#6B4A2A'); dot(8.2, -23.6, 1, '#3E2F22');
  poly([-11, -7, -6, -7, -6, -11, -11, -11], col);
}
function drawBoat(u, col) {
  if (u.boat === 'canoe') {
    poly([-18, -3, 18, -3, 14, 3, -14, 3], '#6B4A2E');
    poly([-18, -3, 18, -3, 16, -1, -16, -1], '#8A6440');
    line(-10, -4, -12, 7, '#5A3C22', 1.4); line(-12, 7, 12, 7, '#5A3C22', 1.4); line(10, -4, 12, 7, '#5A3C22', 1.4);
    line(0, -3, 0, -30, '#3D2B1C', 1.5);
    poly([1, -29, 1, -8, 14, -9], col);
    poly([-1, -26, -1, -9, -11, -10], shade(col, .25));
    return;
  }
  for (let k = -2; k <= 2; k++) poly([-13 + k * 1.2, -1 + k * 2.2, 13 + k * 1.2, -1 + k * 2.2, 13 + k * 1.2, 1.4 + k * 2.2, -13 + k * 1.2, 1.4 + k * 2.2], k % 2 ? '#9A7A4E' : '#B38E5C');
  line(0, -2, 0, -24, '#3D2B1C', 1.4);
  poly([1, -23, 1, -6, 12, -7], 'rgba(240,232,210,.95)');
  poly([1, -20, 1, -16, 6, -17], col);
}
function drawTitan(col) {
  box(0, 0, 9, 4.5, 30, '#7E7B74');
  poly([-8, -22, -1, -19, -1, -16, -8, -19], '#2E2C28');
  poly([1, -19, 8, -22, 8, -19, 1, -16], '#2E2C28');
  poly([-2, -15, 2, -15, 1, -9, -1, -9], '#6E6B64');
  poly([-6, -7, 6, -7, 5, -4, -5, -4], '#2E2C28');
  poly([-9, -34, 9, -34, 9, -31, -9, -31], col);
}
function drawUnit(u, wx, wy, now, lift = 0) {
  const T = TRIBES[S.players[u.owner].tribe], col = T.color;
  const mine = u.owner === 0 && S.cur === 0 && !S.demo;
  const dim = mine && exhausted(u);
  const wading = !u.boat && !flies(u) && isWater(tileAt(u.x, u.y).t) && u._wx === undefined;
  if (mine && !dim && !busy) {                        // a soft green ring: this one can still act
    const p = (Math.sin(now / 350 + u.id) + 1) / 2;
    ctx.strokeStyle = `rgba(110,240,140,${.45 + p * .4})`; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.ellipse(wx, wy + 3, 14, 7, 0, 0, 7); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(wx, wy + 3, u.type === 'titan' ? 16 : 11, u.type === 'titan' ? 6.5 : 4.5, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(wx, wy + 2 - lift);
  const sz = T.key === 'lilliput' && !u.boat ? .85 : 1.15;
  ctx.scale(sz, sz);
  if (dim) ctx.globalAlpha = .55;
  if (u.boat) {
    ctx.translate(0, WD);
    drawBoat(u, col);
    ctx.translate(-5, -4); ctx.scale(.75, .75); figure({ type: 'none' }, T, col);
  } else if (u.type === 'catapult') {
    drawCatapult(col);
    ctx.translate(-13, 1); ctx.scale(.8, .8); figure(u, T, col);
  } else if (u.type === 'boarrider') {
    drawBoar(col);
    ctx.translate(-1, -9); figure(u, T, col);
  } else if (u.type === 'titan') {
    ctx.scale(1.1, 1.1); drawTitan(col);
  } else if (u.type === 'tiger') {
    drawTiger();
  } else if (u.type === 'glider') {
    const bob = Math.sin(now / 320 + u.id) * 1.5;
    ctx.translate(0, -16 + bob);
    poly([0, -30, -24, -18, 24, -18], col);
    poly([0, -30, -24, -18, 0, -21], shade(col, .2));
    line(-24, -18, 24, -18, '#8A6A45', 1.4); line(0, -30, 0, -14, '#8A6A45', 1.2);
    ctx.translate(0, 2); figure(u, T, col);
  } else {
    if (wading) {
      ctx.save(); ctx.beginPath(); ctx.rect(-20, -60, 40, 55); ctx.clip();
      ctx.translate(0, 5); figure(u, T, col); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(0, -1, 8 + Math.sin(now / 250) * 1.5, 3, 0, 0, 7); ctx.stroke();
    } else figure(u, T, col);
  }
  ctx.restore();
  // health badge
  const bx = wx - 16, by = wy - 1 - lift;
  ctx.fillStyle = shade(col, -.35);
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx - 9, by - 7.5, 19, 15, 5) : ctx.rect(bx - 9, by - 7.5, 19, 15); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '800 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(u.hp), bx + .5, by + .5);
  if (u.vet) { ctx.fillStyle = '#FFD24A'; ctx.font = '800 11px system-ui'; ctx.fillText('★', bx + .5, by - 13); }
}

// ---------- frame ----------
const anims = [];
let drawShot = null;                              // a ranged attack in flight, in world coordinates
let floats = [], ripples = [];
let raf = 0, lastAmbient = 0;
function kick() { if (!raf) raf = requestAnimationFrame(tick); }
function ambient() {
  if (!S) return false;
  if (mode === 'title') return true;
  return !!sel || S.cur === 0 || !!S.challenge || S.units.some(u => u.type === 'glider');
}
function tick(now) {
  raf = 0;
  const live = anims.length || floats.length || ripples.length;
  // idle shimmer (fires, rings, the selection pulse) runs at about 30 frames a second to spare the battery
  if (!live && ambient() && now - lastAmbient < 32) { kick(); return; }
  lastAmbient = now;
  for (let k = anims.length - 1; k >= 0; k--) {
    const a = anims[k], t = Math.min(1, (now - a.t0) / a.ms);
    a.fn(t);
    if (t >= 1) { anims.splice(k, 1); a.res(); }
  }
  floats = floats.filter(f => now - f.t0 < f.ms);
  ripples = ripples.filter(r => now - r.t0 < 380);
  if (mode === 'title' && S) { cam.x = demoCam.x + Math.sin(now / 9000) * 70; cam.y = demoCam.y + Math.cos(now / 11000) * 30; }
  draw(now);
  if (live || ambient()) kick();
}
function tween(ms, fn) {
  if (ms <= 0) { fn(1); return Promise.resolve(); }
  return new Promise(res => { anims.push({ t0: performance.now(), ms, fn, res }); kick(); });
}
const sleep = ms => ms > 0 ? tween(ms, () => { }) : Promise.resolve();

function selectedTile() {
  if (!sel) return null;
  if (sel.kind === 'unit') { const u = unitById(sel.id); return u ? [u.x, u.y] : null; }
  return XY(sel.i);
}
function pill(sx, sy, txt, bg, size = 13) {
  ctx.font = `800 ${size}px system-ui,sans-serif`;
  const tw = ctx.measureText(txt).width + size, h = size + 9;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sx - tw / 2, sy - h / 2, tw, h, h / 2) : ctx.rect(sx - tw / 2, sy - h / 2, tw, h); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(txt, sx, sy + .5);
}
function draw(now) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#12384C'); g.addColorStop(1, '#0B2230');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (!S) return;
  const z = cam.z;
  ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z), DPR * (H / 2 - cam.y * z));
  const n = S.n;
  const vx0 = cam.x - W / 2 / z - TW, vx1 = cam.x + W / 2 / z + TW, vy0 = cam.y - H / 2 / z - 70, vy1 = cam.y + H / 2 / z + TH;
  const visible = (x, y) => { const [wx, wy] = iso(x, y); return wx > vx0 && wx < vx1 && wy > vy0 && wy < vy1; };
  for (let s = 0; s <= 2 * n - 2; s++) for (let x = Math.max(0, s - n + 1); x <= Math.min(n - 1, s); x++) {
    if (visible(x, s - x)) drawGround(x, s - x);
  }
  drawRoads();
  drawBorders();
  // the selection glows on the ground, under whatever stands there
  const st0 = selectedTile();
  if (st0 && inb(...st0)) {
    const [cx, cy] = iso(...st0), dy = isWater(tileAt(...st0).t) ? WD : 0;
    const p = (Math.sin(now / 220) + 1) / 2;
    ctx.fillStyle = `rgba(255,226,122,${.18 + p * .14})`; dpath(cx, cy + dy); ctx.fill();
    ctx.lineWidth = 3 + p * 2; ctx.strokeStyle = '#FFE27A'; dpath(cx, cy + dy, TW / 2 - 2, TH / 2 - 1); ctx.stroke();
  }
  const unitMap = new Map();
  for (const u of S.units) unitMap.set(I(u.x, u.y), u);
  const selU = sel && sel.kind === 'unit' ? sel.id : -1;
  for (let s = 0; s <= 2 * n - 2; s++) for (let x = Math.max(0, s - n + 1); x <= Math.min(n - 1, s); x++) {
    const y = s - x;
    if (!visible(x, y)) continue;
    const i = I(x, y), t = S.tiles[i];
    const [cx, cy] = iso(x, y);
    if (!seen(i)) { drawCloud(cx, cy, x, y); continue; }
    const pal = TRIBES[t.clim].pal;
    if (t.volcano) drawVolcano(cx, cy, now);
    else if (t.t === MOUNTAIN) drawCliffs(cx, cy, pal, x, y);
    if (t.t === FOREST) {
      const k = t.imp === 'hut' ? 2 : 3;
      const spots = [[-12, -1], [11, -4], [-1, 7]];
      for (let q = 0; q < k; q++) drawTree(pal.tree, cx + spots[q][0] + (hash(x, y, q) - .5) * 5, cy + spots[q][1], pal.forest, .9 + hash(x, y, q + 4) * .25);
    }
    if (t.res) drawRes(t, cx, cy, pal);
    if (t.imp) drawImp(t, cx, cy, ownerOfI(i), now);
    if (t.ruin) drawWreck(cx, cy);
    if (t.cityHere >= 0) drawCity(S.cities[t.cityHere], cx, cy, now);
    if (S.challenge && S.challenge.i === i) drawChallenge(S.challenge, cx, cy, now);
    const u = unitMap.get(i);
    if (u && u._wx === undefined) drawUnit(u, cx, cy, now, u.id === selU ? 3 : 0);
  }
  for (const u of S.units) if (u._wx !== undefined) drawUnit(u, u._wx, u._wy, now);
  // where the selected unit can go and what it can hit
  if (sel && sel.kind === 'unit' && !busy) {
    for (const d of selMoves.dests) {
      const [x, y] = XY(d), [cx, cy] = iso(x, y);
      const dy = isWater(S.tiles[d].t) ? WD : 0;
      ctx.fillStyle = 'rgba(0,0,0,.2)'; dpath(cx, cy + dy + 1.5, 11, 5.5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.95)'; dpath(cx, cy + dy, 11, 5.5); ctx.fill();
      ctx.strokeStyle = 'rgba(30,60,80,.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    const p = (Math.sin(now / 200) + 1) / 2;
    for (const e of selTargets) {
      const [cx, cy] = iso(e.x, e.y);
      ctx.strokeStyle = `rgba(255,70,55,${.7 + p * .3})`; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, 21 + p * 3, 10.5 + p * 1.5, 0, 0, 7); ctx.stroke();
    }
  }
  // ---- screen-space overlay ----
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const c of S.cities) {
    if (!seen(I(c.x, c.y))) continue;
    const [wx, wy] = iso(c.x, c.y);
    // lift the name clear of anyone standing in the camp
    const [sx, sy] = toScreen(wx, wy - (unitMap.has(I(c.x, c.y)) ? 62 : 30));
    if (sx < -90 || sx > W + 90 || sy < -30 || sy > H + 30) continue;
    const label = c.owner < 0 ? '🆘 Castaways' : (c.capital ? '♛ ' : '') + c.name + '  ' + c.level;
    pill(sx, sy, label, c.owner < 0 ? 'rgba(30,40,48,.8)' : colOf(c.owner), 13.5);
    if (c.owner >= 0) {
      const need = c.level + 1, pw = 9;
      const x0 = sx - (need * pw) / 2 + pw / 2;
      for (let k = 0; k < need; k++) {
        ctx.beginPath(); ctx.arc(x0 + k * pw, sy + 17, 3.4, 0, 7);
        ctx.fillStyle = k < c.pop ? '#7BE08F' : 'rgba(10,20,26,.6)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  if (S.challenge && seen(S.challenge.i)) {
    const [wx, wy] = iso(...XY(S.challenge.i)), [sx, sy] = toScreen(wx, wy - 44);
    const left = S.challenge.until - S.turn + 1;
    pill(sx, sy, `${CHALLENGES[S.challenge.kind].icon} ${S.challenge.kind === 'immunity' ? 'Immunity' : 'Reward'} · ${left} ${left === 1 ? 'turn' : 'turns'}`, S.challenge.kind === 'immunity' ? '#9A6A12' : '#1C7FB0', 13);
  }
  if (sel && sel.kind === 'unit' && !busy) {
    const u = unitById(sel.id);
    if (u) for (const e of selTargets) {
      const [wx, wy] = iso(e.x, e.y), [sx, sy] = toScreen(wx, wy - 36);
      const conv = !u.boat && UNITS[u.type].convert, r = conv ? null : combat(u, e);
      const txt = conv ? 'Sway' : r.killed ? '💀 Kill' : '−' + r.dmg + (r.ret ? '  ↩' + r.ret : '');
      pill(sx, sy, txt, '#E0382B', 14);
    }
  }
  // a bouncing marker over whatever is selected, so it is obvious at a glance
  if (st0 && inb(...st0) && !busy) {
    const [wx, wy] = iso(...st0), stI = I(...st0);
    const labelled = S.tiles[stI].cityHere >= 0, occupied = unitMap.has(stI);
    const [sx, sy0] = toScreen(wx, wy - (labelled ? (occupied ? 62 : 30) : 0));
    const sy = sy0 - (labelled ? 24 : 52 * Math.max(.8, cam.z)) - Math.abs(Math.sin(now / 260)) * 8;
    ctx.fillStyle = '#FFE27A'; ctx.strokeStyle = 'rgba(20,30,40,.85)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(sx - 10, sy - 8); ctx.lineTo(sx + 10, sy - 8); ctx.lineTo(sx, sy + 5); ctx.closePath(); ctx.stroke(); ctx.fill();
  }
  if (drawShot) {
    const [sx, sy] = toScreen(drawShot[0], drawShot[1] - 14);
    dot(sx, sy, 4 * cam.z, '#8A6A45');
  }
  for (const r of ripples) {
    const t = (now - r.t0) / 380;
    ctx.strokeStyle = `rgba(255,255,255,${.7 * (1 - t)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, 8 + t * 26, 0, 7); ctx.stroke();
  }
  for (const f of floats) {
    const t = (now - f.t0) / f.ms, [wx, wy] = iso(f.x, f.y), [sx, sy] = toScreen(wx, wy - 30);
    ctx.globalAlpha = 1 - t * t;
    ctx.font = '850 19px system-ui,sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,14,22,.85)'; ctx.strokeText(f.text, sx, sy - t * 30);
    ctx.fillStyle = f.color; ctx.fillText(f.text, sx, sy - t * 30);
    ctx.globalAlpha = 1;
  }
}

// ---------- animation hooks for the rules ----------
const SPEEDS = { normal: { step: 120, pause: 140 }, fast: { step: 55, pause: 50 }, instant: { step: 0, pause: 0 } };
const spd = () => SPEEDS[prefs.speed] || SPEEDS.normal;
const onScreen = (x, y) => S && !S.demo && seen(I(x, y));
FX.move = async (u, path) => {
  const human = isHuman(u.owner);
  const ms = human ? 95 : spd().step;
  if (!ms || (!human && !onScreen(u.x, u.y) && !path.some(i => seen(i)))) return;
  let [px, py] = iso(u.x, u.y);
  for (const i of path) {
    const [x, y] = XY(i), [nx, ny] = iso(x, y);
    await tween(ms, t => { u._wx = px + (nx - px) * t; u._wy = py + (ny - py) * t - Math.sin(t * Math.PI) * 6; });
    px = nx; py = ny;
  }
  delete u._wx; delete u._wy;
};
FX.attack = async (a, d) => {
  if (!onScreen(a.x, a.y) && !onScreen(d.x, d.y)) return;
  const ms = isHuman(a.owner) ? 170 : Math.max(spd().step * 1.5, 0);
  if (isHuman(a.owner) || isHuman(d.owner)) buzz([25, 40, 25]);
  if (!ms) return;
  const [ax, ay] = iso(a.x, a.y), [dx, dy] = iso(d.x, d.y);
  if (st(a).rng > 1) {
    await tween(ms * 1.4, t => { drawShot = [ax + (dx - ax) * t, ay + (dy - ay) * t - Math.sin(t * Math.PI) * 30]; });
    drawShot = null;
  } else {
    await tween(ms, t => { const k = Math.sin(t * Math.PI) * .45; a._wx = ax + (dx - ax) * k; a._wy = ay + (dy - ay) * k; });
    delete a._wx; delete a._wy;
  }
};
FX.float = (x, y, text, color) => { if (onScreen(x, y)) { floats.push({ x, y, text, color, t0: performance.now(), ms: 1200 }); kick(); } };
FX.say = (msg, p, c, always) => { if (!S.demo && (always || isHuman(p) || !c || onScreen(c.x, c.y))) toast(msg); };
FX.pause = async u => { if (onScreen(u.x, u.y)) await sleep(spd().pause); };

// ---------- input ----------
const ptrs = new Map();
let drag = null, pinch = null;
cv.addEventListener('pointerdown', e => {
  try { cv.setPointerCapture(e.pointerId); } catch (_) { }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.x, cy: cam.y };
    if (drag) drag.moved = true;
  }
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || mode !== 'game') return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const z = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, ZMIN, ZMAX);
    const wx = (pinch.mx - W / 2) / pinch.z + pinch.cx, wy = (pinch.my - H / 2) / pinch.z + pinch.cy;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.z = z; cam.x = wx - (mx - W / 2) / z; cam.y = wy - (my - H / 2) / z;
    clampCam(); kick();
  } else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 10) drag.moved = true;
    if (drag.moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; clampCam(); kick(); }
  }
});
function endPointer(e) {
  const tap = e.type === 'pointerup' && drag && !drag.moved && ptrs.size === 1;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 1) { const [r] = [...ptrs.values()]; drag = { x: r.x, y: r.y, cx: cam.x, cy: cam.y, moved: true }; }
  else if (!ptrs.size) drag = null;
  if (tap) onTap(e.clientX, e.clientY);
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', e => {
  if (mode !== 'game') return;
  e.preventDefault();
  const wx = (e.clientX - W / 2) / cam.z + cam.x, wy = (e.clientY - H / 2) / cam.z + cam.y;
  cam.z = clamp(cam.z * Math.exp(-e.deltaY * .0015), ZMIN, ZMAX);
  cam.x = wx - (e.clientX - W / 2) / cam.z; cam.y = wy - (e.clientY - H / 2) / cam.z;
  clampCam(); kick();
}, { passive: false });
addEventListener('keydown', e => {
  if (mode !== 'game' || !$('#modal').hidden) return;
  if (e.key === 'Escape') select(null);
  else if (e.key === 'n' || e.key === 'Tab') { e.preventDefault(); nextUnit(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  else if (e.key.startsWith('Arrow')) {
    const d = 40 / cam.z;
    cam.x += e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
    cam.y += e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    clampCam(); kick();
  }
});

function onTap(sx, sy) {
  if (mode !== 'game' || busy || !$('#modal').hidden) return;
  ripples.push({ x: sx, y: sy, t0: performance.now() }); kick();
  const [x, y] = screenToTile(sx, sy);
  if (!inb(x, y)) { select(null); return; }
  tapTile(x, y);
}
function tapTile(x, y) {
  const i = I(x, y);
  if (sel && sel.kind === 'unit' && !S.over) {
    const u = unitById(sel.id);
    if (u && u.owner === 0) {
      if (selMoves.dests.has(i)) { buzz(15); const prev = selMoves.prev; return act(() => doMove(u, i, prev), { undo: 'move' }); }
      const tg = selTargets.find(e => e.x === x && e.y === y);
      if (tg) return act(() => doAttack(u, tg));
    }
  }
  const u = seen(i) ? unitAt(x, y) : null;
  if (u && !(sel && sel.kind === 'unit' && sel.id === u.id)) select({ kind: 'unit', id: u.id });
  else if (sel && sel.kind === 'tile' && sel.i === i) select(null);
  else select({ kind: 'tile', i });
}
function select(s, pan = true) {
  sel = s;
  refreshSel();
  renderPanel();
  if (sel) { buzz(8); if (pan) { const t = selectedTile(); if (t) ensureVisible(...t); } }
  kick();
}
function refreshSel() {
  selMoves = { dests: new Set(), prev: new Map() }; selTargets = [];
  if (!sel || !S) return;
  if (sel.kind === 'unit') {
    const u = unitById(sel.id);
    if (!u) { sel = null; return; }
    if (u.owner === 0 && S.cur === 0) { selMoves = moveInfo(u); selTargets = targets(u); }
  }
}
const readyUnits = () => S ? unitsOf(0).filter(u => !exhausted(u)) : [];
// Hop to the next unit that still has something to do.
function nextUnit() {
  if (busy || !S || S.over) return;
  const list = readyUnits();
  if (!list.length) {
    toast('Everyone has acted. Tap End turn when you are ready.');
    $('#btnEnd').classList.add('nudge'); buzz(20);
    return;
  }
  const cur = sel && sel.kind === 'unit' ? list.findIndex(u => u.id === sel.id) : -1;
  const u = list[(cur + 1) % list.length];
  select({ kind: 'unit', id: u.id }, false);
  const [wx, wy] = iso(u.x, u.y), fx = cam.x, fy = cam.y, ty = wy - (focusY() - H / 2) / cam.z;
  tween(280, t => { const e = 1 - (1 - t) ** 3; cam.x = fx + (wx - fx) * e; cam.y = fy + (ty - fy) * e; clampCam(); });
}

