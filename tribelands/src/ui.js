/* Tribelands — drawing, touch input and the screens around the map. */

const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
const TW = 64, TH = 32, LH = 6, WD = 4;          // tile size, land edge depth, water drop
const ZMIN = .45, ZMAX = 2.6;
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, z: 1 };
let mode = 'title';                               // 'title' | 'game'
let busy = false;
let sel = null, selMoves = { dests: new Set(), prev: new Map() }, selTargets = [];
let undoStack = [];
let prefs = { speed: 'normal', last: { tribe: 0, opponents: 2, size: 'medium', diff: 'normal' } };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { } };

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
function centerOn(x, y) { const [wx, wy] = iso(x, y); cam.x = wx; cam.y = wy + 30 / cam.z; clampCam(); }

// ---------- drawing primitives ----------
function poly(pts, fill) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
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

// ---------- terrain ----------
function drawGround(x, y) {
  const i = I(x, y), t = S.tiles[i];
  const [cx, cy] = iso(x, y);
  if (!seen(i)) { tile3(cx, cy, hash(x, y, 2) < .5 ? '#243045' : '#26334A', LH); return; }
  if (isWater(t.t)) {
    const c = t.t === SHALLOW ? '#5AB4D6' : '#2D6DAE';
    tile3(cx, cy + WD, shade(c, (hash(x, y, 3) - .5) * .05), 0);
    if (hash(x, y, 4) < .55) {
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.2;
      const ox = (hash(x, y, 5) - .5) * 26, oy = (hash(x, y, 6) - .5) * 10 + WD;
      ctx.beginPath(); ctx.moveTo(cx + ox - 6, cy + oy); ctx.quadraticCurveTo(cx + ox - 3, cy + oy - 2.5, cx + ox, cy + oy);
      ctx.quadraticCurveTo(cx + ox + 3, cy + oy + 2.5, cx + ox + 6, cy + oy); ctx.stroke();
    }
    return;
  }
  const pal = TRIBES[t.clim].pal;
  let top = t.t === FOREST ? shade(pal.field, -.1) : t.t === MOUNTAIN ? shade(pal.mountain, -.12) : pal.field;
  if (t.cityHere >= 0) top = S.cities[t.cityHere].owner >= 0 ? '#D9CEBB' : '#C9B387';
  top = shade(top, (hash(x, y, 1) - .5) * .08);
  tile3(cx, cy, top, LH);
  if (t.imp === 'farm') {
    ctx.save(); dpath(cx, cy, TW / 2 - 6, TH / 2 - 3); ctx.clip();
    for (let k = -4; k <= 4; k++) {
      poly([cx + k * 7 - 3, cy - 20 + 0, cx + k * 7 + 3, cy - 20, cx + k * 7 + 3 - 20, cy + 20, cx + k * 7 - 3 - 20, cy + 20],
        k % 2 ? '#E8C95A' : '#C9B04A');
    }
    ctx.restore();
  }
}

function drawRoads() {
  const n = S.n;
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? '#D8B77E' : '#8C6B42';
    ctx.lineWidth = pass ? 3 : 5.5;
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
    ctx.globalAlpha = .17; dpath(cx, cy); ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    const w = TW / 2, h = TH / 2, f = .88;
    const N = [cx, cy - h * f], E = [cx + w * f, cy], Sv = [cx, cy + h * f], Wv = [cx - w * f, cy];
    const edges = [[x, y - 1, N, E], [x + 1, y, E, Sv], [x, y + 1, Sv, Wv], [x - 1, y, Wv, N]];
    ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (const [nx, ny, a, b] of edges) {
      if (inb(nx, ny) && ownerOfI(I(nx, ny)) === o) continue;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
}

function drawTree(kind, x, y, col, s = 1) {
  if (kind === 'pine') {
    poly([x - 1, y, x + 1, y, x + 1, y - 5, x - 1, y - 5], '#5A3E2B');
    tri2(x - 7 * s, x + 7 * s, y - 4, x, y - 15 * s, col);
    tri2(x - 5 * s, x + 5 * s, y - 10 * s, x, y - 21 * s, shade(col, .06));
  } else if (kind === 'bamboo') {
    for (const d of [-4, 0, 4]) {
      const h = 18 + (d + 4) * .6;
      poly([x + d - 1, y, x + d + 1, y, x + d + 1, y - h, x + d - 1, y - h], shade(col, d < 0 ? .25 : .1));
      poly([x + d + 1, y - h + 4, x + d + 7, y - h + 1, x + d + 2, y - h + 7], shade(col, -.05));
    }
  } else if (kind === 'acacia') {
    ctx.strokeStyle = '#6B4A30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 9); ctx.stroke();
    poly([x - 11 * s, y - 10, x + 11 * s, y - 10, x + 7 * s, y - 15, x - 7 * s, y - 15], shade(col, -.08));
    poly([x - 11 * s, y - 10, x, y - 10, x, y - 15, x - 7 * s, y - 15], shade(col, .12));
  } else {
    poly([x - 1.2, y, x + 1.2, y, x + 1.2, y - 6, x - 1.2, y - 6], '#6B4A30');
    const r = 7.5 * s, cyy = y - 12 * s;
    poly([x, cyy - r, x + r * .87, cyy - r / 2, x + r * .87, cyy + r / 2, x, cyy + r, x - r * .87, cyy + r / 2, x - r * .87, cyy - r / 2], shade(col, -.1));
    poly([x, cyy - r, x, cyy + r, x - r * .87, cyy + r / 2, x - r * .87, cyy - r / 2], shade(col, .12));
  }
}
function drawMountain(cx, cy, pal) {
  const c = pal.mountain;
  poly([cx + 2, cy + 1, cx + 26, cy + 3, cx + 15, cy - 15], shade(c, -.2));
  poly([cx + 2, cy + 1, cx + 15, cy + 4, cx + 15, cy - 15], shade(c, 0));
  const ax = cx - 3, ay = cy - 27;
  poly([cx - 24, cy + 4, cx + 1, cy + 11, ax, ay], shade(c, .1));
  poly([cx + 1, cy + 11, cx + 21, cy + 5, ax, ay], shade(c, -.18));
  if (pal.snow) {
    poly([ax, ay, cx - 10, cy - 14, cx - 4, cy - 11, cx - 1, cy - 14], '#F4F6F8');
    poly([ax, ay, cx - 1, cy - 14, cx + 6, cy - 12], '#D6DCE4');
  }
}
function drawRes(t, cx, cy) {
  const r = t.res;
  if (r === 'fruit') {
    const x = cx + 8, y = cy + 2;
    poly([x - 8, y, x + 8, y, x + 6, y - 7, x, y - 10, x - 6, y - 7], '#3F8A3A');
    poly([x - 8, y, x, y, x, y - 10, x - 6, y - 7], '#55A34A');
    for (const [dx, dy] of [[-4, -5], [2, -7], [4, -3], [-1, -2]]) { ctx.fillStyle = '#E4553B'; ctx.beginPath(); ctx.arc(x + dx, y + dy, 1.6, 0, 7); ctx.fill(); }
  } else if (r === 'crop') {
    for (const [dx, dy] of [[-8, 2], [0, -2], [8, 2], [0, 6]]) tri2(cx + dx - 3, cx + dx + 3, cy + dy, cx + dx, cy + dy - 9, '#E3C04B');
  } else if (r === 'animal') {
    const x = cx + 9, y = cy + 4;
    ctx.strokeStyle = '#5E3B22'; ctx.lineWidth = 1.3;
    ctx.beginPath(); for (const lx of [-4, -2, 3, 5]) { ctx.moveTo(x + lx, y - 4); ctx.lineTo(x + lx, y); } ctx.stroke();
    poly([x - 6, y - 4, x + 6, y - 4, x + 7, y - 8, x - 5, y - 9], '#A0673A');
    poly([x + 5, y - 8, x + 9, y - 13, x + 11, y - 12, x + 8, y - 7], '#8C5830');
    ctx.beginPath(); ctx.moveTo(x + 9, y - 13); ctx.lineTo(x + 8, y - 17); ctx.moveTo(x + 10, y - 13); ctx.lineTo(x + 12, y - 17); ctx.stroke();
  } else if (r === 'ore') {
    tri2(cx - 16, cx - 8, cy + 6, cx - 12, cy - 4, '#7B6FD6');
    tri2(cx - 10, cx - 4, cy + 8, cx - 7, cy + 1, '#5FC7D9');
  } else if (r === 'fish') {
    const x = cx + 4, y = cy + WD + 1;
    poly([x - 7, y, x - 2, y - 3, x + 4, y - 2, x + 6, y, x + 4, y + 2, x - 2, y + 3], 'rgba(230,245,255,.85)');
    poly([x + 5, y, x + 10, y - 3, x + 10, y + 3], 'rgba(230,245,255,.85)');
  }
}
function drawHouse(x, y, roof, wall, s = 1, tall = 0) {
  const w = 6 * s, h = 3 * s, z = (7 + tall) * s;
  poly([x - w, y - h, x, y, x, y - z, x - w, y - h - z], shade(wall, .02));
  poly([x, y, x + w, y - h, x + w, y - h - z, x, y - z], shade(wall, -.18));
  const ay = y - z - 7 * s;
  poly([x - w - 1, y - h - z, x, y - z + 1, x, ay], shade(roof, .08));
  poly([x, y - z + 1, x + w + 1, y - h - z, x, ay], shade(roof, -.2));
}
function drawImp(t, cx, cy, owner) {
  if (t.imp === 'mine') {
    poly([cx + 1, cy + 6, cx + 9, cy + 4, cx + 8, cy - 4, cx + 3, cy - 3], '#2B2420');
    ctx.strokeStyle = '#7A5230'; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(cx + 1, cy + 6); ctx.lineTo(cx + 3, cy - 3); ctx.lineTo(cx + 8, cy - 4); ctx.lineTo(cx + 9, cy + 4); ctx.stroke();
  } else if (t.imp === 'lumber') {
    drawHouse(cx + 10, cy + 4, '#8C5A33', '#C79A68', .9);
    for (const k of [0, 1, 2]) { ctx.fillStyle = '#8A5A34'; ctx.beginPath(); ctx.ellipse(cx - 2 + k * 3, cy + 7 - k, 2.2, 1.4, 0, 0, 7); ctx.fill(); }
  } else if (t.imp === 'market') {
    const x = cx + 4, y = cy + 4;
    poly([x - 11, y - 2, x + 1, y + 4, x + 1, y - 4, x - 11, y - 10], '#C99A5E');
    poly([x + 1, y + 4, x + 11, y - 1, x + 11, y - 9, x + 1, y - 4], '#A57A45');
    for (let k = 0; k < 4; k++) {
      poly([x - 13 + k * 6, y - 11 + k * 3, x - 7 + k * 6, y - 8 + k * 3, x - 5 + k * 6, y - 15 + k * 3, x - 11 + k * 6, y - 18 + k * 3], k % 2 ? '#F4F0E6' : '#D6453D');
    }
    poly([x + 1, y - 6, x + 13, y - 12, x + 11, y - 18, x - 1, y - 12], '#E9B23A');
    for (const [dx, col] of [[-6, '#E4553B'], [-2, '#7BBF4A'], [3, '#E3C04B']]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + dx, y - 3 + dx * .3, 1.8, 0, 7); ctx.fill(); }
  } else if (t.imp === 'port') {
    const y = cy + WD;
    poly([cx - 12, y - 1, cx + 2, y - 8, cx + 14, y - 2, cx, y + 5], '#9A6B40');
    poly([cx - 12, y - 1, cx, y + 5, cx, y + 7, cx - 12, y + 1], '#6E4A2A');
    ctx.strokeStyle = '#5A3C22'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx + 6, y - 3); ctx.lineTo(cx + 6, y - 17); ctx.stroke();
    if (owner >= 0) poly([cx + 6, y - 17, cx + 14, y - 14.5, cx + 6, y - 12], colOf(owner));
  }
}
function drawRuin(cx, cy) {
  for (const [dx, h] of [[-8, 13], [4, 17], [10, 8]]) {
    poly([cx + dx - 2.5, cy + 2, cx + dx + 2.5, cy + 2, cx + dx + 2.5, cy + 2 - h, cx + dx - 2.5, cy + 2 - h], '#C9C3B6');
    poly([cx + dx, cy + 2, cx + dx + 2.5, cy + 2, cx + dx + 2.5, cy + 2 - h, cx + dx, cy + 2 - h], '#A29C90');
  }
  poly([cx - 10, cy - 12, cx + 6, cy - 16, cx + 6, cy - 13, cx - 10, cy - 9], '#BDB6A8');
  poly([cx - 3, cy + 7, cx + 5, cy + 5, cx + 6, cy + 8, cx - 2, cy + 10], '#B3AC9F');
}
const HOUSE_SPOTS = [[0, -7], [-14, -1], [14, -1], [-7, 5], [8, 5], [0, 10]];
function drawCity(c, cx, cy) {
  if (c.owner < 0) {
    drawHouse(cx - 7, cy - 1, '#B08850', '#E6D6B8', .9);
    drawHouse(cx + 8, cy + 2, '#9C7644', '#E6D6B8', .8);
    return;
  }
  const col = colOf(c.owner);
  if (c.walls) {
    ctx.lineWidth = 4; ctx.strokeStyle = '#8F8A80'; dpath(cx, cy + 1, TW / 2 - 3, TH / 2 - 1.5); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#C8C2B5'; dpath(cx, cy - 1, TW / 2 - 3, TH / 2 - 1.5); ctx.stroke();
  }
  const k = Math.min(6, 1 + c.level);
  const spots = HOUSE_SPOTS.slice(0, k).sort((a, b) => a[1] - b[1]);
  for (const [dx, dy] of spots) {
    if (c.capital && dx === 0 && dy === -7) {
      drawHouse(cx, cy - 7, shade(col, -.1), '#EFE6D4', 1.1, 12);
      ctx.strokeStyle = '#4A3A2A'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, cy - 34); ctx.lineTo(cx, cy - 46); ctx.stroke();
      poly([cx, cy - 46, cx + 10, cy - 43, cx, cy - 40], col);
      continue;
    }
    drawHouse(cx + dx, cy + dy, col, '#F1E8D8', .95);
  }
  if (c.parks) { drawTree('round', cx + 20, cy + 6, '#4E9A45', .7); }
  const w = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
  if (w) drawWonder(w, cx - 17, cy + 4, col);
}
function drawWonder(key, x, y, col) {
  if (key === 'observatory') {
    drawHouse(x, y, '#E8E4DA', '#F4F1EA', 1, 10);
    ctx.fillStyle = '#EDF3FA'; ctx.beginPath(); ctx.arc(x, y - 21, 6.5, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#9CB6D6'; ctx.beginPath(); ctx.arc(x + 1.5, y - 21, 6.5, Math.PI * 1.5, 0); ctx.lineTo(x + 1.5, y - 21); ctx.fill();
    ctx.strokeStyle = '#4A5A70'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y - 23); ctx.lineTo(x + 8, y - 31); ctx.stroke();
  } else if (key === 'greatwall') {
    poly([x - 10, y + 2, x + 10, y - 8, x + 10, y - 18, x - 10, y - 8], '#A59F92');
    poly([x - 10, y - 8, x + 10, y - 18, x + 8, y - 20, x - 12, y - 10], '#CFC8BA');
    for (let k = 0; k < 4; k++) poly([x - 9 + k * 5, y - 11 - k * 2.5, x - 6 + k * 5, y - 12.5 - k * 2.5, x - 6 + k * 5, y - 16 - k * 2.5, x - 9 + k * 5, y - 14.5 - k * 2.5], '#8F897D');
    poly([x + 10, y - 18, x + 10, y - 26, x + 16, y - 23], col);
  } else if (key === 'bazaar') {
    drawHouse(x, y, '#E9B23A', '#F4E6C8', 1.15, 4);
    ctx.fillStyle = '#E9B23A'; ctx.beginPath(); ctx.arc(x, y - 18, 5, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#B07A1A'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y - 23); ctx.lineTo(x, y - 28); ctx.stroke();
  } else if (key === 'treeoflife') {
    ctx.fillStyle = 'rgba(160,255,170,.25)'; ctx.beginPath(); ctx.arc(x, y - 14, 13, 0, 7); ctx.fill();
    drawTree('round', x, y, '#3FAE55', 1.35);
    for (const [dx, dy] of [[-4, -17], [3, -20], [5, -13]]) { ctx.fillStyle = '#FFE98A'; ctx.beginPath(); ctx.arc(x + dx, y + dy, 1.4, 0, 7); ctx.fill(); }
  } else if (key === 'heroes') {
    poly([x - 11, y - 2, x + 1, y + 4, x + 11, y - 1, x - 1, y - 7], '#D9D2C2');
    for (const dx of [-8, -3, 2, 7]) poly([x + dx - 1.2, y - 1 + dx * .1, x + dx + 1.2, y - 1 + dx * .1, x + dx + 1.2, y - 13 + dx * .1, x + dx - 1.2, y - 13 + dx * .1], '#F2EDE2');
    tri2(x - 12, x + 12, y - 12, x, y - 20, '#E9DFC8');
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - 15, 1.8, 0, 7); ctx.fill();
  }
}
function drawCloud(cx, cy, x, y) {
  if (hash(x, y, 9) > .45) return;
  ctx.fillStyle = 'rgba(210,222,240,.07)';
  const ox = (hash(x, y, 10) - .5) * 20;
  for (const [dx, dy, r] of [[-7, 0, 7], [2, -3, 9], [10, 1, 6]]) { ctx.beginPath(); ctx.arc(cx + ox + dx, cy + dy - 4, r, 0, 7); ctx.fill(); }
}

// ---------- units ----------
function figure(u, T, col) {
  const dark = shade(col, -.3);
  ctx.strokeStyle = '#3B3128'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-2.5, -4); ctx.lineTo(-3, 0); ctx.moveTo(2.5, -4); ctx.lineTo(3, 0); ctx.stroke();
  poly([-5.5, -4, 0, -4, 0, -15, -4, -15], shade(col, .08));
  poly([0, -4, 5.5, -4, 4, -15, 0, -15], dark);
  const hy = -19, r = 4.2;
  poly([0, hy - r, r * .87, hy - r / 2, r * .87, hy + r / 2, 0, hy + r, -r * .87, hy + r / 2, -r * .87, hy - r / 2], T.skin);
  poly([0, hy - r, 0, hy + r, -r * .87, hy + r / 2, -r * .87, hy - r / 2], shade(T.skin, .1));
  // what the tribe wears on its head
  if (T.hat === 'plume') {
    poly([-4.6, hy - 1, 4.6, hy - 1, 3.2, hy - 5, 0, hy - 6.2, -3.2, hy - 5], '#C9A23A');
    ctx.strokeStyle = '#D6453D'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, hy - 6); ctx.quadraticCurveTo(-5, hy - 11, -8, hy - 7); ctx.stroke();
  } else if (T.hat === 'cone') {
    tri2(-8, 8, hy - 2, 0, hy - 10, '#D8B66A');
  } else if (T.hat === 'horns') {
    poly([-4.6, hy - 1, 4.6, hy - 1, 3.4, hy - 5.5, -3.4, hy - 5.5], '#8C96A3');
    poly([-4, hy - 4, -8, hy - 10, -3, hy - 5.5], '#F2EEE4');
    poly([4, hy - 4, 8, hy - 10, 3, hy - 5.5], '#F2EEE4');
  } else if (T.hat === 'wrap') {
    poly([-4.8, hy - 1, 4.8, hy - 1, 4, hy - 5.5, 0, hy - 7, -4, hy - 5.5], shade(col, .45));
    poly([4, hy - 3, 8, hy + 3, 5.5, hy + 3], shade(col, .3));
  }
  // what it carries
  const ty = u.type;
  ctx.lineCap = 'round';
  if (ty === 'warrior' || ty === 'giant') {
    ctx.strokeStyle = '#6B4A30'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(5, -9); ctx.lineTo(9, -19); ctx.stroke();
  } else if (ty === 'archer') {
    ctx.strokeStyle = '#7A5230'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(5, -11, 7, -1.2, 1.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(7.5, -17.5); ctx.lineTo(7.5, -4.5); ctx.stroke();
  } else if (ty === 'defender') {
    poly([-10, -15, -2, -15, -2, -6, -6, -2, -10, -6], dark);
    poly([-8.5, -13.5, -3.5, -13.5, -3.5, -7, -6, -4, -8.5, -7], shade(col, .25));
  } else if (ty === 'swordsman') {
    ctx.strokeStyle = '#DDE3EA'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(6, -9); ctx.lineTo(11, -22); ctx.stroke();
    ctx.strokeStyle = '#7A5230'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(4, -11); ctx.lineTo(8.5, -9); ctx.stroke();
    poly([-9, -14, -3, -14, -3, -7, -6, -5, -9, -7], dark);
  } else if (ty === 'rider') {
    ctx.strokeStyle = '#7A5230'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(3, -6); ctx.lineTo(10, -22); ctx.stroke();
    poly([10, -22, 8.8, -18.5, 11.6, -19.2], '#DDE3EA');
  } else if (ty === 'envoy') {
    poly([4, -13, 11, -13, 11, -8, 4, -8], '#F4ECD6');
    ctx.strokeStyle = '#B08A4A'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(5.5, -11.5); ctx.lineTo(9.5, -11.5); ctx.moveTo(5.5, -9.5); ctx.lineTo(9.5, -9.5); ctx.stroke();
    ctx.fillStyle = '#C0392B'; ctx.beginPath(); ctx.arc(7.5, -7.5, 1.3, 0, 7); ctx.fill();
  } else if (ty === 'shaman') {
    ctx.strokeStyle = '#6B4A30'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(8, -24); ctx.stroke();
    ctx.fillStyle = 'rgba(130,255,150,.45)'; ctx.beginPath(); ctx.arc(8, -25, 4.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#6FE08F'; ctx.beginPath(); ctx.arc(8, -25, 2.2, 0, 7); ctx.fill();
  } else if (ty === 'eagle') {
    ctx.strokeStyle = '#7A5230'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(3, -6); ctx.lineTo(10, -20); ctx.stroke();
  } else if (ty === 'knight') {
    ctx.strokeStyle = '#C9CFD6'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(16, -16); ctx.stroke();
    poly([-8, -15, -2, -15, -2, -8, -5, -6, -8, -8], dark);
  }
}
function drawHorse(col) {
  ctx.strokeStyle = '#4B2F1C'; ctx.lineWidth = 1.6;
  ctx.beginPath(); for (const lx of [-8, -5, 4, 7]) { ctx.moveTo(lx, -5); ctx.lineTo(lx + (lx < 0 ? -1 : 1), 1); } ctx.stroke();
  poly([-10, -5, 8, -5, 9, -11, -9, -12], '#9A6537');
  poly([-10, -5, 0, -5, 0, -12, -9, -12], '#AD7443');
  poly([7, -11, 11, -19, 15, -17, 12, -10], '#8C5A30');
  poly([-9, -12, -13, -6, -11, -5], '#3E2A1C');
  poly([-6, -12, 5, -12, 4, -9, -5, -9], shade(col, -.1));
}
function drawCatapult(col) {
  ctx.fillStyle = '#3E2F22';
  for (const wx of [-7, 7]) { ctx.beginPath(); ctx.arc(wx, -2, 3, 0, 7); ctx.fill(); }
  poly([-11, -3, 11, -3, 10, -7, -10, -7], '#8C5A30');
  poly([-4, -7, 0, -7, 2, -13, -2, -13], '#7A4E2A');
  ctx.strokeStyle = '#6B4424'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -9); ctx.lineTo(9, -22); ctx.stroke();
  ctx.fillStyle = '#5A5A5A'; ctx.beginPath(); ctx.arc(9, -23, 2.6, 0, 7); ctx.fill();
  poly([-11, -7, -6, -7, -6, -11, -11, -11], col);
}
function drawBoat(u, col) {
  const big = u.boat === 'warship';
  const s = big ? 1.2 : 1;
  poly([-14 * s, -3, 14 * s, -3, 9 * s, 4, -9 * s, 4], big ? '#4E3A2A' : '#7A5230');
  poly([-14 * s, -3, 14 * s, -3, 12 * s, -1, -12 * s, -1], big ? '#6A5038' : '#9A6B40');
  ctx.strokeStyle = '#3D2B1C'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, -28 * s); ctx.stroke();
  tri2(-1, 12 * s, -6, 0, -27 * s, col);
  if (big) { tri2(-11, -2, -6, -2, -20, shade(col, .2)); ctx.fillStyle = '#2B2B2B'; ctx.fillRect(9, -4, 5, 2.4); }
}
function drawUnit(u, wx, wy) {
  const T = TRIBES[S.players[u.owner].tribe], col = T.color;
  const dim = u.owner === 0 && S.cur === 0 && exhausted(u);
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(wx, wy + 3, u.type === 'giant' ? 15 : 11, u.type === 'giant' ? 6 : 4.5, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(wx, wy + 2);
  if (dim) ctx.globalAlpha = .6;
  if (u.boat) {
    ctx.translate(0, WD);
    drawBoat(u, col);
    ctx.translate(-4, -4); ctx.scale(.75, .75); figure({ type: 'none' }, T, col);
  } else if (u.type === 'eagle') {
    const bob = Math.sin(performance.now() / 300 + u.id) * 1.5;
    ctx.translate(0, -16 + bob);
    const flap = Math.sin(performance.now() / 160 + u.id) * 4;
    poly([-2, -6, -22, -14 - flap, -12, -4], '#8A5A2E');
    poly([2, -6, 22, -14 - flap, 12, -4], '#6E4524');
    poly([-8, -2, 8, -2, 11, -7, -6, -9], '#A06A36');
    poly([8, -6, 14, -10, 16, -7, 11, -4], '#F2EEE4');
    poly([15, -8, 19, -7, 15, -6], '#E9B23A');
    poly([-8, -3, -14, 0, -12, -5], '#7A4E28');
    ctx.translate(-1, -6); ctx.scale(.85, .85); figure(u, T, col);
  } else if (u.type === 'catapult') {
    drawCatapult(col);
    ctx.translate(-13, 1); ctx.scale(.8, .8); figure(u, T, col);
  } else if (u.type === 'rider' || u.type === 'knight') {
    drawHorse(col);
    ctx.translate(-1, -8); figure(u, T, col);
  } else {
    if (u.type === 'giant') ctx.scale(1.65, 1.65);
    figure(u, T, col);
  }
  ctx.restore();
  // health badge
  const bx = wx - 14, by = wy - 2;
  ctx.fillStyle = shade(col, -.35);
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx - 7, by - 6, 15, 12, 4) : ctx.rect(bx - 7, by - 6, 15, 12); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(u.hp), bx + .5, by + .5);
  if (u.vet) { ctx.fillStyle = '#FFD24A'; ctx.font = '700 9px system-ui'; ctx.fillText('★', bx + .5, by - 11); }
}

// ---------- frame ----------
const anims = [];
let drawShot = null;                              // a ranged attack in flight, in world coordinates
let floats = [];
let raf = 0;
function kick() { if (!raf) raf = requestAnimationFrame(tick); }
function tick(now) {
  raf = 0;
  for (let k = anims.length - 1; k >= 0; k--) {
    const a = anims[k], t = Math.min(1, (now - a.t0) / a.ms);
    a.fn(t);
    if (t >= 1) { anims.splice(k, 1); a.res(); }
  }
  floats = floats.filter(f => now - f.t0 < f.ms);
  if (mode === 'title' && S) { cam.x = demoCam.x + Math.sin(now / 9000) * 70; cam.y = demoCam.y + Math.cos(now / 11000) * 30; }
  draw(now);
  const flyers = S && mode === 'game' && S.units.some(u => u.type === 'eagle' && seen(I(u.x, u.y)));
  if (anims.length || floats.length || mode === 'title' || flyers) kick();
}
function tween(ms, fn) {
  if (ms <= 0) { fn(1); return Promise.resolve(); }
  return new Promise(res => { anims.push({ t0: performance.now(), ms, fn, res }); kick(); });
}
const sleep = ms => ms > 0 ? tween(ms, () => { }) : Promise.resolve();

function draw(now) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1A2536'); g.addColorStop(1, '#101722');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (!S) return;
  const z = cam.z;
  ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z), DPR * (H / 2 - cam.y * z));
  const n = S.n;
  const vx0 = cam.x - W / 2 / z - TW, vx1 = cam.x + W / 2 / z + TW, vy0 = cam.y - H / 2 / z - 60, vy1 = cam.y + H / 2 / z + TH;
  const visible = (x, y) => { const [wx, wy] = iso(x, y); return wx > vx0 && wx < vx1 && wy > vy0 && wy < vy1; };
  for (let s = 0; s <= 2 * n - 2; s++) for (let x = Math.max(0, s - n + 1); x <= Math.min(n - 1, s); x++) {
    if (visible(x, s - x)) drawGround(x, s - x);
  }
  drawRoads();
  drawBorders();
  // selection marker sits on the ground, under everything standing on it
  if (sel) {
    const [sx, sy] = sel.kind === 'unit' ? (() => { const u = unitById(sel.id); return u ? [u.x, u.y] : [-9, -9]; })() : XY(sel.i);
    if (inb(sx, sy)) {
      const [cx, cy] = iso(sx, sy);
      const dy = isWater(tileAt(sx, sy).t) ? WD : 0;
      ctx.lineWidth = 3; ctx.strokeStyle = '#FFE27A'; dpath(cx, cy + dy, TW / 2 - 2, TH / 2 - 1); ctx.stroke();
    }
  }
  const unitMap = new Map();
  for (const u of S.units) unitMap.set(I(u.x, u.y), u);
  for (let s = 0; s <= 2 * n - 2; s++) for (let x = Math.max(0, s - n + 1); x <= Math.min(n - 1, s); x++) {
    const y = s - x;
    if (!visible(x, y)) continue;
    const i = I(x, y), t = S.tiles[i];
    const [cx, cy] = iso(x, y);
    if (!seen(i)) { drawCloud(cx, cy, x, y); continue; }
    const pal = TRIBES[t.clim].pal;
    if (t.t === MOUNTAIN) drawMountain(cx, cy, pal);
    if (t.t === FOREST) {
      const k = t.imp === 'lumber' ? 2 : 3;
      const spots = [[-12, -1], [11, -4], [-1, 7]];
      for (let q = 0; q < k; q++) drawTree(pal.tree, cx + spots[q][0] + (hash(x, y, q) - .5) * 5, cy + spots[q][1], pal.forest, .9 + hash(x, y, q + 4) * .25);
    }
    if (t.res) drawRes(t, cx, cy);
    if (t.imp) drawImp(t, cx, cy, ownerOfI(i));
    if (t.ruin) drawRuin(cx, cy);
    if (t.cityHere >= 0) drawCity(S.cities[t.cityHere], cx, cy);
    const u = unitMap.get(i);
    if (u) {
      if (u._wx !== undefined) continue;
      drawUnit(u, cx, cy);
    }
  }
  for (const u of S.units) if (u._wx !== undefined) drawUnit(u, u._wx, u._wy);
  // where the selected unit can go and what it can hit
  if (sel && sel.kind === 'unit' && !busy) {
    for (const d of selMoves.dests) {
      const [x, y] = XY(d), [cx, cy] = iso(x, y);
      const dy = isWater(S.tiles[d].t) ? WD : 0;
      ctx.fillStyle = 'rgba(255,255,255,.85)'; dpath(cx, cy + dy, 7, 3.5); ctx.fill();
      ctx.strokeStyle = 'rgba(20,30,50,.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    for (const e of selTargets) {
      const [cx, cy] = iso(e.x, e.y);
      ctx.strokeStyle = '#FF4D40'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, 19, 9.5, 0, 0, 7); ctx.stroke();
    }
  }
  // screen-space labels
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const c of S.cities) {
    if (!seen(I(c.x, c.y))) continue;
    const [wx, wy] = iso(c.x, c.y);
    const [sx, sy] = toScreen(wx, wy - 28);
    if (sx < -80 || sx > W + 80 || sy < -30 || sy > H + 30) continue;
    const label = c.owner < 0 ? 'Village' : c.name + '  ' + c.level;
    ctx.font = '700 12px system-ui,sans-serif';
    const tw = ctx.measureText(label).width + 14;
    ctx.fillStyle = c.owner < 0 ? 'rgba(40,46,58,.78)' : colOf(c.owner);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sx - tw / 2, sy - 9, tw, 18, 9) : ctx.rect(sx - tw / 2, sy - 9, tw, 18); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText((c.capital ? '♛ ' : '') + label, sx, sy + .5);
    if (c.owner >= 0) {
      const need = c.level + 1, pw = 7;
      const x0 = sx - (need * pw) / 2 + pw / 2;
      for (let k = 0; k < need; k++) {
        ctx.beginPath(); ctx.arc(x0 + k * pw, sy + 14, 2.6, 0, 7);
        ctx.fillStyle = k < c.pop ? '#7BE08F' : 'rgba(15,20,30,.55)'; ctx.fill();
      }
    }
  }
  if (sel && sel.kind === 'unit' && !busy) {
    const u = unitById(sel.id);
    if (u) for (const e of selTargets) {
      const [wx, wy] = iso(e.x, e.y), [sx, sy] = toScreen(wx, wy - 34);
      const conv = !u.boat && UNITS[u.type].convert, r = conv ? null : combat(u, e);
      const txt = conv ? 'Convert' : r.killed ? 'Kill' : '−' + r.dmg + (r.ret ? '  ↩' + r.ret : '');
      ctx.font = '800 12px system-ui'; const tw = ctx.measureText(txt).width + 12;
      ctx.fillStyle = '#E0382B'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sx - tw / 2, sy - 9, tw, 18, 9) : ctx.rect(sx - tw / 2, sy - 9, tw, 18); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, sx, sy + .5);
    }
  }
  if (drawShot) {
    const [sx, sy] = toScreen(drawShot[0], drawShot[1] - 14);
    ctx.fillStyle = '#FFF4C2'; ctx.beginPath(); ctx.arc(sx, sy, 3.5 * cam.z, 0, 7); ctx.fill();
  }
  for (const f of floats) {
    const t = (now - f.t0) / f.ms, [wx, wy] = iso(f.x, f.y), [sx, sy] = toScreen(wx, wy - 30);
    ctx.globalAlpha = 1 - t * t;
    ctx.font = '800 16px system-ui,sans-serif';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,14,22,.8)'; ctx.strokeText(f.text, sx, sy - t * 26);
    ctx.fillStyle = f.color; ctx.fillText(f.text, sx, sy - t * 26);
    ctx.globalAlpha = 1;
  }
}

// ---------- animation hooks for the rules ----------
const SPEEDS = { normal: { step: 120, pause: 140 }, fast: { step: 55, pause: 50 }, instant: { step: 0, pause: 0 } };
const spd = () => SPEEDS[prefs.speed] || SPEEDS.normal;
const onScreen = (x, y) => S && !S.demo && seen(I(x, y));
FX.move = async (u, path) => {
  const human = isHuman(u.owner);
  const ms = human ? 90 : spd().step;
  if (!ms || (!human && !onScreen(u.x, u.y) && !path.some(i => seen(i)))) return;
  let [px, py] = iso(u.x, u.y);
  for (const i of path) {
    const [x, y] = XY(i), [nx, ny] = iso(x, y);
    await tween(ms, t => { u._wx = px + (nx - px) * t; u._wy = py + (ny - py) * t - Math.sin(t * Math.PI) * 5; });
    px = nx; py = ny;
  }
  delete u._wx; delete u._wy;
};
FX.attack = async (a, d) => {
  if (!onScreen(a.x, a.y) && !onScreen(d.x, d.y)) return;
  const ms = isHuman(a.owner) ? 160 : Math.max(spd().step * 1.5, 0);
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
FX.float = (x, y, text, color) => { if (onScreen(x, y)) { floats.push({ x, y, text, color, t0: performance.now(), ms: 1100 }); kick(); } };
FX.say = (msg, p, c) => { if (!S.demo && (isHuman(p) || !c || onScreen(c.x, c.y))) toast(msg); };
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
    if (!drag.moved && Math.hypot(dx, dy) > 9) drag.moved = true;
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
  const [x, y] = screenToTile(sx, sy);
  if (!inb(x, y)) { select(null); return; }
  tapTile(x, y);
}
function tapTile(x, y) {
  const i = I(x, y);
  if (sel && sel.kind === 'unit' && !S.over) {
    const u = unitById(sel.id);
    if (u && u.owner === 0) {
      if (selMoves.dests.has(i)) { const prev = selMoves.prev; return act(() => doMove(u, i, prev), { undo: true }); }
      const tg = selTargets.find(e => e.x === x && e.y === y);
      if (tg) return act(() => doAttack(u, tg));
    }
  }
  const u = seen(i) ? unitAt(x, y) : null;
  if (u && !(sel && sel.kind === 'unit' && sel.id === u.id)) select({ kind: 'unit', id: u.id });
  else if (sel && sel.kind === 'tile' && sel.i === i) select(null);
  else select({ kind: 'tile', i });
}
function select(s) {
  sel = s;
  refreshSel();
  renderPanel();
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

// ---------- doing things ----------
// `o.undo` names the action ("move", "hunt"…) and makes it undoable.
async function act(fn, o = {}) {
  if (busy || !S || S.over) return;
  busy = true;
  const snap = JSON.stringify(S);
  revealed = 0;
  const hadRewards = S.pendingRewards.length;
  let msg;
  try { msg = await fn(); }
  catch (err) { console.error(err); }
  busy = false;
  disbandArm = null;
  if (o.undo && revealed === 0 && S.pendingRewards.length === hadRewards) {
    undoStack.push({ snap, label: o.undo });
    if (undoStack.length > 40) undoStack.shift();
  } else undoStack = [];
  if (typeof msg === 'string') toast(msg);
  afterAction();
}
function afterAction() {
  checkElims();
  saveGame();
  refreshSel();
  renderHud();
  renderPanel();
  kick();
  if (!$('#modal').hidden && $('#modal').dataset.closable === '') return;   // a choice is already open
  if (S.pendingRewards.length) showReward();
  else if (S.offer && S.offer.from != null && !S.over) showOffer();
  else if (S.event && S.event.turn === S.turn && !S.event.seen && !S.over) showEvent();
  else if (S.over && !S.overShown) showGameOver();
}
function undo() {
  if (busy || !undoStack.length) return;
  S = JSON.parse(undoStack.pop().snap);
  disbandArm = null;
  refreshSel(); renderHud(); renderPanel(); saveGame(); kick();
}
async function endTurn() {
  if (busy || !S || S.over) return;
  busy = true;
  sel = null; undoStack = []; disbandArm = null;
  refreshSel();
  for (let p = 1; p < S.players.length; p++) {
    if (!S.players[p].alive) continue;
    S.cur = p;
    renderHud(); renderPanel();
    startTurn(p);
    try { await aiTurn(p); } catch (err) { console.error(err); }
    checkElims();
    kick();
    if (S.over) break;
  }
  if (!S.over) {
    S.turn++;
    S.cur = 0;
    revealed = 0;
    beginRound();
    startTurn(0);
    vision();
    toast('Turn ' + S.turn);
  }
  busy = false;
  afterAction();
}

// ---------- HUD ----------
function renderHud() {
  const on = mode === 'game';
  $('#hud').hidden = !on;
  if (!on) return;
  const P = S.players[0];
  $('#hudDot').style.background = TRIBES[P.tribe].color;
  $('#hudStars').textContent = P.stars;
  $('#hudInc').textContent = '+' + income(0);
}
$('#btnStars').addEventListener('click', () => { if (!busy) openIncome(); });
$('#btnTribes').addEventListener('click', () => { if (!busy) openTribes(); });

// ---------- the bottom panel ----------
const star = '<span class="star">★</span>';
const tag = p => `<span class="tag" style="background:${colOf(p)}">${TRIBES[S.players[p].tribe].name}</span>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// One action button: what it is, what it does, what it costs, and — if it can't be pressed — why.
function actBtn({ a, icon, title, effect, cost, block, go, quiet, wide }) {
  const dis = !!block;
  return `<button class="act${go && !dis ? ' go' : ''}${wide ? ' wide' : ''}" data-a="${a}"${dis ? ' disabled' : ''}>
    <i>${icon}</i><span class="t"><b>${title}</b>${effect ? `<small>${effect}</small>` : ''}${dis && !quiet ? `<em>${block}</em>` : ''}</span>
    ${cost != null ? `<span class="c">${cost === 0 ? 'Free' : cost + ' ★'}</span>` : ''}</button>`;
}
const sec = t => `<div class="sec">${t}</div>`;
const hint = t => `<div class="hint">${t}</div>`;
let disbandArm = null;

function renderPanel() {
  const panel = $('#panel');
  panel.hidden = mode !== 'game';
  if (panel.hidden) return;
  const u0 = undoStack[undoStack.length - 1];
  $('#btnUndo').disabled = busy || !u0;
  $('#btnUndo').textContent = u0 ? 'Undo ' + u0.label : 'Undo';
  $('#btnEnd').disabled = busy || !!S.over;
  const info = $('#pinfo'), acts = $('#pacts');
  if (busy && S.cur !== 0) {
    info.innerHTML = `<h3>${tag(S.cur)} is taking its turn…</h3><p>Turn ${S.turn}</p>`;
    acts.innerHTML = '';
    return;
  }
  if (S.over) {
    info.innerHTML = `<h3>${S.over === 'win' ? 'Victory' : 'Defeat'} · Turn ${S.turn}</h3><p>Open the menu ☰ to start a new game.</p>`;
    acts.innerHTML = '';
    return;
  }
  if (!sel) {
    const ready = unitsOf(0).filter(u => !exhausted(u)).length;
    info.innerHTML = `<h3>${tag(0)} Turn ${S.turn}</h3><p>${ready ? `<b>${ready}</b> ${ready === 1 ? 'unit' : 'units'} can still act. ` : 'All units have acted. '}Tap a unit, city or tile.</p>`;
    acts.innerHTML = '';
    return;
  }
  if (sel.kind === 'unit') unitPanel(unitById(sel.id), info, acts);
  else tilePanel(sel.i, info, acts);
}

function unitPanel(u, info, acts) {
  const s = st(u), mh = maxHp(u), U = UNITS[u.type];
  const skills = Object.keys(SKILLS).filter(k => (u.boat ? BOATS[u.boat] : U)[k] || (k === 'escape' && !u.boat && U.escape));
  if (!u.boat && tribeIs(u.owner, 3) && (u.type === 'rider' || u.type === 'knight')) skills.push('horse');
  const chip = k => k === 'horse' ? `<span class="skill" title="Sandari trait"><b>Horse lords</b> +1 move</span>`
    : `<span class="skill"><b>${SKILLS[k][0]}</b> ${SKILLS[k][1]}</span>`;
  const stats = `<span class="stat">⚔️ ${s.atk}</span><span class="stat">🛡️ ${s.def}</span><span class="stat">👣 ${mvOf(u)}</span>${s.rng > 1 ? `<span class="stat">🎯 ${s.rng}</span>` : ''}`;
  info.innerHTML = `<h3>${tag(u.owner)} ${(u.boat ? BOATS[u.boat] : U).icon} ${unitName(u)}${u.vet ? ' <span class="vet">★ Veteran</span>' : ''}</h3>
    <p><span class="hpbar"><i style="width:${u.hp / mh * 100}%"></i></span> ${u.hp}/${mh} HP ${stats}</p>
    ${u.owner === 0 ? `<p class="status ${exhausted(u) ? 'done' : ''}">${unitStatus(u)}</p>` : ''}`;
  let h = '';
  if (skills.length) h += `<div class="skills">${skills.map(chip).join('')}</div>`;
  if (u.owner !== 0) {
    const peace = atPeace(0, u.owner);
    const mine = unitsOf(0).filter(v => targets(v).includes(u));
    h += hint(peace ? `🕊️ You are at peace with the ${tribeOf(u.owner).name} for ${peaceLeft(0, u.owner)} more turns. Neither side can attack.`
      : mine.length ? `${mine.length === 1 ? 'One of your units' : mine.length + ' of your units'} can attack it: select yours, then tap the red ring.`
        : 'An enemy unit. Bring your units within range to attack it.');
    acts.innerHTML = h;
    return;
  }
  const here = cityAtI(I(u.x, u.y));
  if (here && here.owner !== 0 && !u.boat) {
    const peace = atPeace(0, here.owner);
    h += actBtn({ a: 'capture', icon: '🚩', title: here.owner < 0 ? 'Capture village' : 'Capture ' + here.name,
      effect: here.owner < 0 ? 'It becomes your new city. Uses this unit’s turn.' : 'The city, its land and any wonder become yours.',
      block: peace ? 'You are at peace with its owner' : canCapture(u) ? '' : 'Capture works at the start of your next turn, if this unit is still here', go: true });
  }
  if (tileAt(u.x, u.y).ruin) h += actBtn({ a: 'ruin', icon: '🏛️', title: 'Examine ruins', effect: 'Treasure, knowledge, a map or an ally. Uses this unit’s turn.',
    block: canRuin(u) ? '' : 'This unit has already attacked this turn', go: true });
  if (!u.boat && U.heal) {
    const n = S.units.filter(v => v.owner === 0 && v !== u && cheb(u.x, u.y, v.x, v.y) <= 1 && v.hp < maxHp(v)).length;
    h += actBtn({ a: 'heal', icon: '🌿', title: 'Heal allies', effect: `+4 HP to ${n || 'each'} wounded ${n === 1 ? 'unit' : 'units'} next to the Shaman`,
      block: u.attacked ? 'Already acted this turn' : n ? '' : 'No wounded units next to it', go: true });
  }
  if (u.hp < mh) h += actBtn({ a: 'recover', icon: '❤️', title: 'Recover',
    effect: `Heals ${ownerOfI(I(u.x, u.y)) === 0 ? 4 : 2} HP (4 in your land, 2 elsewhere). Ends its turn.`,
    block: canRecover(u) ? '' : 'Only before it moves or attacks' });
  if (here && here.owner === 0) h += actBtn({ a: 'city', icon: '🏠', title: 'Open ' + here.name, effect: 'Train units, grow the city, build wonders' });
  h += actBtn({ a: 'disband', icon: disbandArm === u.id ? '⚠️' : '✖️', title: disbandArm === u.id ? 'Tap again to disband' : 'Disband',
    effect: disbandArm === u.id ? 'This removes the unit for good' : 'Removes the unit and frees a slot in its home city' });
  const tips = [];
  if (!exhausted(u)) {
    if (selMoves.dests.size) tips.push('⚪ Tap a white marker to move there.');
    if (selTargets.length) tips.push(U.convert && !u.boat ? '🔴 Tap a red ring to convert that unit.' : '🔴 Tap a red ring to attack. Its label shows the damage you deal, and ↩ what you take back.');
    if (!selMoves.dests.size && !selTargets.length && !u.moved) tips.push('Nowhere to move from here.');
  }
  acts.innerHTML = h + (tips.length ? hint(tips.join('<br>')) : '');
}

const RES_TIP = {
  fruit: 'Gather it for +1 population (needs Organization).',
  crop: 'Build a farm on it for +2 population (needs Farming).',
  animal: 'Hunt it for +1 population (needs Hunting).',
  fish: 'Fish it for +1 population (needs Fishing).',
  ore: 'Build a mine on it for +2 population (needs Mining).',
};
function workEffect(i, key) {
  const t = S.tiles[i], W = WORKS[key], c = t.city >= 0 ? S.cities[t.city] : null;
  if (key === 'clear') return '+1 ★ now; the forest becomes a field';
  if (key === 'road') return 'Moving from road to road (or city) costs half a step';
  if (key === 'market') return `Earns +${marketValue(i)} ★ every turn right now: +1 for each farm, mine, lumber hut or port beside it (max 4)`;
  const who = c && c.owner === 0 ? ' for ' + c.name : '';
  const lvl = c && c.owner === 0 && c.pop + W.pop >= c.level + 1 ? ' — levels the city up!' : '';
  return `+${W.pop} population${who}${lvl}${key === 'port' ? '. Units that walk in become boats' : ''}`;
}
function tilePanel(i, info, acts) {
  const t = S.tiles[i];
  if (!seen(i)) { info.innerHTML = '<h3>☁️ Unexplored</h3><p>Send a unit this way to see what is here.</p>'; acts.innerHTML = ''; return; }
  const c = cityAtI(i), o = ownerOfI(i);
  let h = '';
  const unit = unitAt(...XY(i));
  if (c && c.owner < 0) {
    info.innerHTML = `<h3>🛖 Village</h3><p>Move a unit here. At the start of your next turn it can capture the village, and it becomes your city.</p>`;
  } else if (c) cityPanel(c, info, a => h += a);
  else {
    const ICON = [ '🌱', '🌲', '⛰️', '💧', '🌊' ];
    const what = [TERRAIN_NAME[t.t], t.res && RES_NAME[t.res], t.imp && IMP_NAME[t.imp], t.road && 'Road', t.ruin && 'Ruins'].filter(Boolean).join(' · ');
    const tip = t.res ? RES_TIP[t.res] : t.imp === 'market' ? `This market earns +${marketValue(i)} ★ every turn.` : t.ruin ? 'Move a unit here, then examine the ruins.' : '';
    info.innerHTML = `<h3>${ICON[t.t]} ${what}</h3><p>${o >= 0 ? 'Land of ' + S.cities[t.city].name + ' (' + TRIBES[S.players[o].tribe].name + ')' : 'No one’s land'}${defNote(t)}</p>${tip ? `<p>${tip}</p>` : ''}`;
    for (const k of Object.keys(WORKS)) {
      const Wk = WORKS[k];
      if (!Wk.ok(t)) continue;
      if ((k === 'road' || k === 'market') && !has(0, Wk.tech)) continue;     // don't clutter every tile
      h += actBtn({ a: 'work:' + k, icon: Wk.icon, title: Wk.name, effect: workEffect(i, k), cost: workCost(0, k), block: workBlock(0, i, k), go: true });
    }
    if (o === 0 && !h) h += hint('Nothing to build here yet. New technologies open up more to do.');
  }
  if (unit) h += actBtn({ a: 'unit', icon: (unit.boat ? BOATS[unit.boat] : UNITS[unit.type]).icon, title: 'Select ' + unitName(unit), effect: 'The unit standing here' });
  acts.innerHTML = h;
}
function cityPanel(c, info, add) {
  const inc = c.level + (c.workshop ? 1 : 0) + c.parks + (c.capital ? 1 : 0);
  const pips = '<span class="pips">' + Array.from({ length: c.level + 1 }, (_, k) => `<i class="${k < c.pop ? 'on' : ''}"></i>`).join('') + '</span>';
  const w = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
  const extras = [c.capital && '♛ Capital', c.walls && '🧱 Walls', c.workshop && '🔨 Workshop', c.parks && '🌷 Park', w && WONDERS[w].icon + ' ' + WONDERS[w].name].filter(Boolean).join(' · ');
  info.innerHTML = `<h3>${tag(c.owner)} ${c.name} · Level ${c.level}</h3>
    <p>Growth ${pips} ${c.pop}/${c.level + 1} to level ${c.level + 1} · +${inc} ★/turn · Units ${homeCount(c)}/${capacity(c)}</p>${extras ? `<p>${extras}</p>` : ''}`;
  if (c.owner !== 0) return;
  add(sec('Train a unit'));
  // A reason that blocks every unit is said once, not on each button.
  const common = unitAt(c.x, c.y) ? '🚶 A unit is standing on the city. Move it off to train here.'
    : homeCount(c) >= capacity(c) ? `🏘️ ${c.name} supports ${capacity(c)} units and has ${homeCount(c)}. Grow the city (or disband one) to train more.` : '';
  if (common) add(`<div class="banner">${common}</div>`);
  for (const k of TRAINABLE) {
    const U = UNITS[k];
    if (U.tech && !has(0, U.tech)) continue;
    const sk = Object.keys(SKILLS).filter(x => U[x]).map(x => SKILLS[x][0]).join(', ');
    add(actBtn({ a: 'train:' + k, icon: U.icon, title: U.name, effect: `⚔️${U.atk} 🛡️${U.def} 👣${U.mv}${U.rng > 1 ? ' 🎯' + U.rng : ''} · ${U.hp} HP${sk ? ' · ' + sk : ''}`,
      cost: U.cost, block: trainBlock(0, c, k), quiet: !!common }));
  }
  const locked = TRAINABLE.filter(k => UNITS[k].tech && !has(0, UNITS[k].tech)).length;
  if (locked) add(hint(`🔬 ${locked} more unit types unlock through Tech.`));
  const wk = Object.keys(WONDERS).filter(k => has(0, WONDERS[k].tech) || S.wonders[k] != null);
  if (wk.length) {
    add(sec('Wonders — one of each in the whole world'));
    const holds = Object.keys(S.wonders).find(k => S.wonders[k] === c.id);
    if (holds) add(`<div class="banner">${WONDERS[holds].icon} <b>${WONDERS[holds].name}</b> stands here: ${WONDERS[holds].desc} A city holds one wonder, so raise the others elsewhere.</div>`);
    for (const k of wk) {
      if (k === holds) continue;
      const Wd = WONDERS[k], elsewhere = S.wonders[k] != null;
      const who = elsewhere ? `${TRIBES[S.players[wonderOwner(k)].tribe].name} hold it in ${S.cities[S.wonders[k]].name}` : '';
      add(actBtn({ a: 'wonder:' + k, icon: Wd.icon, title: Wd.name, effect: Wd.desc + (elsewhere ? ` <b>${who}.</b>` : ''), cost: elsewhere ? null : Wd.cost,
        block: elsewhere ? 'Taken' : wonderBlock(0, c, k), quiet: elsewhere || !!holds, go: true, wide: true }));
    }
  }
}
function defNote(t) {
  if (t.t === FOREST) return has(0, 'archery') || tribeIs(0, 2) ? ' · Your units defend +50% here' : ' · Archery gives +50% defence here';
  if (t.t === MOUNTAIN) return has(0, 'climbing') ? ' · Your units defend +50% here' : ' · Needs Climbing to enter';
  if (t.t === OCEAN) return ' · Boats need Sailing to cross';
  return '';
}
$('#pacts').addEventListener('click', e => {
  const b = e.target.closest('button[data-a]');
  if (!b || b.disabled || busy) return;
  const [a, k] = b.dataset.a.split(':');
  const u = sel && sel.kind === 'unit' ? unitById(sel.id) : null;
  const i = sel && sel.kind === 'tile' ? sel.i : u ? I(u.x, u.y) : -1;
  if (a !== 'disband') disbandArm = null;
  if (a === 'capture') act(() => doCapture(u));
  else if (a === 'ruin') act(() => doRuin(u));
  else if (a === 'heal') act(() => { const n = doHeal(u); return `The Shaman healed ${n} ${n === 1 ? 'unit' : 'units'}.`; }, { undo: 'heal' });
  else if (a === 'recover') act(() => doRecover(u), { undo: 'recover' });
  else if (a === 'disband') {
    if (disbandArm !== u.id) { disbandArm = u.id; renderPanel(); return; }
    act(() => { killUnit(u); S.players[0].lost--; }, { undo: 'disband' });
  }
  else if (a === 'city') select({ kind: 'tile', i });
  else if (a === 'unit') { const v = unitAt(...XY(i)); if (v) select({ kind: 'unit', id: v.id }); }
  else if (a === 'train') act(() => { doTrain(0, cityAtI(i), k); }, { undo: 'train' });
  else if (a === 'work') act(() => doWork(0, i, k), { undo: WORKS[k].name.toLowerCase().replace(/^build /, '') });
  else if (a === 'wonder') act(() => { doWonder(0, cityAtI(i), k); return WONDERS[k].name + ' built!'; });
});
$('#btnEnd').addEventListener('click', endTurn);
$('#btnUndo').addEventListener('click', undo);

// ---------- toast ----------
let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- sheets ----------
function openSheet(html, closable = true) {
  $('#sheet').innerHTML = (closable ? '<button class="close" data-x aria-label="Close">×</button>' : '') + html;
  $('#modal').hidden = false;
  $('#modal').dataset.closable = closable ? '1' : '';
}
function closeSheet() { $('#modal').hidden = true; $('#modal').dataset.closable = '1'; }
$('#modal').addEventListener('click', e => {
  if (e.target.closest('[data-x]') || (e.target === $('#modal') && $('#modal').dataset.closable)) {
    closeSheet();
    if (mode === 'game' && S && !busy) afterAction();          // anything queued behind this sheet
  }
});

let techSel = null;
function openTech() {
  if (busy) return;
  const P = S.players[0], col = TRIBES[P.tribe].color;
  const node = t => {
    const T = TECHS[t], done = has(0, t), avail = !T.parent || has(0, T.parent);
    const cls = done ? 'done' : avail ? (canResearch(0, t) ? 'can' : '') : 'locked';
    const sub = done ? '✓ Known' : avail ? techCost(0, t) + ' ★' : '🔒 ' + techCost(0, t) + ' ★';
    return `<button class="tn ${cls}${techSel === t ? ' sel' : ''}" style="--c:${col}" data-t="${t}"><b>${T.name}</b><span>${sub}</span></button>`;
  };
  let h = `<h2>Technology</h2><p class="muted">You have ${P.stars} ★. Tap a technology to see what it unlocks. Each city you own makes research dearer.</p>`;
  for (const r of TECH_ROOTS) {
    const t2 = Object.keys(TECHS).filter(k => TECHS[k].parent === r);
    h += `<div class="branch" style="grid-template-rows:repeat(${t2.length},auto)"><div class="root" style="grid-row:1 / span ${t2.length}">${node(r)}</div>`;
    t2.forEach((k, row) => {
      const t3 = Object.keys(TECHS).filter(j => TECHS[j].parent === k);
      h += `<div class="arr" style="grid-row:${row + 1}">›</div><div style="grid-row:${row + 1};grid-column:3">${node(k)}</div>
        <div class="arr" style="grid-row:${row + 1};grid-column:4">${t3.length ? '›' : ''}</div><div class="col" style="grid-row:${row + 1};grid-column:5">${t3.map(node).join('')}</div>`;
    });
    h += '</div>';
  }
  h += '<div class="tdetail" id="tdetail"></div>';
  openSheet(h);
  techDetail();
  $('#sheet').querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => { techSel = b.dataset.t; openTech(); $('#tdetail').scrollIntoView({ block: 'nearest' }); }));
}
function techDetail() {
  const el = $('#tdetail');
  if (!techSel) { el.innerHTML = '<p class="muted">Green-edged techs are ones you can afford now.</p>'; return; }
  const T = TECHS[techSel], done = has(0, techSel), cost = techCost(0, techSel);
  let h = `<h3 style="margin:0 0 6px">${T.name}</h3><ul class="unlocks">${T.unlocks.map(x => `<li>${x}</li>`).join('')}</ul>`;
  if (done) h += '<p><b>✓ Already known.</b></p>';
  else if (T.parent && !has(0, T.parent)) h += `<p class="muted">🔒 Research ${TECHS[T.parent].name} first.</p>`;
  else {
    const short = cost - S.players[0].stars;
    h += `<div class="row"><button class="big primary" id="doTech" ${short > 0 ? 'disabled' : ''}>${short > 0 ? `Need ${short} more ★ (costs ${cost})` : `Research for ${cost} ★`}</button></div>`;
  }
  el.innerHTML = h;
  const b = $('#doTech');
  if (b) b.addEventListener('click', () => {
    const t = techSel;
    closeSheet();
    act(() => { doResearch(0, t); return 'Learned ' + TECHS[t].name; }, { undo: 'research' });
  });
}
$('#btnTech').addEventListener('click', openTech);

function openIncome() {
  const parts = incomeParts(0);
  openSheet(`<h2>★ Stars</h2><p class="muted">You have ${S.players[0].stars} ★ and earn <b>+${income(0)}</b> at the start of each turn.</p>
    <div class="ledger">${parts.map(x => `<span>${esc(x.label)}<small>${x.why}</small></span><b>+${x.v}</b>`).join('')}</div>
    ${hint('Grow cities, pick Workshops and Parks, build Markets next to farms and mines, or raise the Grand Bazaar to earn more.')}`);
}
function openTribes() {
  const me = S.players[0], T0 = TRIBES[me.tribe];
  let h = `<h2>Tribes</h2>
    <div class="tcard" style="--c:${T0.color}"><b><i></i>You: ${T0.name}</b><span>${T0.trait.icon} <b>${T0.trait.name}</b>: ${T0.trait.desc}</span></div>`;
  for (const P of S.players.slice(1)) {
    const T = TRIBES[P.tribe], q = P.id;
    const cities = citiesOf(q).length, units = unitsOf(q).length;
    const rel = !P.alive ? 'Fallen' : atPeace(0, q) ? `🕊️ Truce, ${peaceLeft(0, q)} more turns` : '⚔️ At war';
    const ratio = strength(q) / Math.max(1, strength(0));
    const power = ratio > 1.3 ? 'Stronger than you' : ratio < .75 ? 'Weaker than you' : 'About as strong as you';
    let btn = '';
    if (P.alive && !atPeace(0, q)) {
      const cost = truceCost(0, q), asked = me.asked[q] != null && S.turn - me.asked[q] < 3;
      const block = !has(0, 'diplomacy') ? 'Research Diplomacy to offer truces' : asked ? 'They refused recently; try again in a few turns'
        : me.stars < cost ? `Need ${cost - me.stars} more ★` : '';
      btn = actBtn({ a: 'truce:' + q, icon: '🕊️', title: 'Offer a truce', effect: 'Pay them for 8 turns of peace. Weaker tribes are more willing.', cost, block, go: true });
    }
    h += `<div class="tcard" style="--c:${T.color}"><b><i></i>${T.name} <small>${rel}</small></b>
      <span>${T.trait.icon} ${T.trait.name}: ${T.trait.desc}</span>
      <span>${P.alive ? `${cities} ${cities === 1 ? 'city' : 'cities'} · ${units} units · ${power}` : 'This tribe is gone.'}</span>${btn ? `<div class="pacts1">${btn}</div>` : ''}</div>`;
  }
  const log = S.log.slice(-8).reverse();
  if (log.length) h += `<h4>Chronicle</h4><ul class="chron">${log.map(l => `<li><small>Turn ${l.t}</small> ${esc(l.msg)}</li>`).join('')}</ul>`;
  openSheet(h);
  $('#sheet').querySelectorAll('[data-a^="truce:"]').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    const q = +b.dataset.a.split(':')[1], cost = truceCost(0, q);
    if (truceAccepted(0, q)) {
      S.players[0].stars -= cost; S.players[q].stars += cost;
      makeTruce(0, q, 8);
      logIt(`${TRIBES[me.tribe].name} and ${tribeOf(q).name} agreed a truce`);
      toast(`The ${tribeOf(q).name} accept: 8 turns of peace.`);
    } else {
      me.asked[q] = S.turn;
      toast(`The ${tribeOf(q).name} refuse. They think they can win.`);
    }
    undoStack = []; afterAction(); openTribes();
  }));
}
function showOffer() {
  const o = S.offer, T = tribeOf(o.from);
  openSheet(`<h2>🕊️ The ${T.name} ask for peace</h2>
    <p class="muted">They offer <b>${o.gift} ★</b> for a truce of ${o.turns} turns. During a truce neither of you can attack the other or take each other’s cities.</p>
    <div class="row" style="margin-top:14px"><button class="big primary" data-o="yes">Accept · +${o.gift} ★</button><button class="big" data-o="no">Refuse and fight on</button></div>`, false);
  $('#sheet').querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.o === 'yes') {
      S.players[0].stars += o.gift; S.players[o.from].stars -= o.gift;
      makeTruce(0, o.from, o.turns);
      logIt(`${tribeOf(0).name} accepted peace from the ${T.name}`);
    }
    S.offer = null;
    closeSheet(); undoStack = []; afterAction();
  }));
}
function showEvent() {
  const E = EVENTS[S.event.key];
  S.event.seen = true; saveGame();
  openSheet(`<p class="muted" style="margin:0">A sign from the world · Turn ${S.turn}</p><h2>${E.icon} ${E.name}</h2><p>${E.desc}</p>
    <div class="row" style="margin-top:14px"><button class="big primary" data-x>Continue</button></div>`);
}

function showReward() {
  const cid = S.pendingRewards[0], c = S.cities[cid];
  if (!c || c.owner !== 0) { S.pendingRewards.shift(); afterAction(); return; }
  const opts = rewardChoices(c.level);
  openSheet(`<h2>🎉 ${c.name} reached level ${c.level}!</h2><p class="muted">Choose one reward. You can’t change it later.</p>
    <div class="row" style="margin-top:12px">${opts.map(k => `<button class="reward" data-r="${k}"><i>${REWARDS[k].icon}</i><b>${REWARDS[k].name}</b><span>${REWARDS[k].desc}</span></button>`).join('')}</div>`, false);
  centerOn(c.x, c.y); kick();
  $('#sheet').querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
    closeSheet();
    act(() => { S.pendingRewards.shift(); applyReward(c, b.dataset.r); });
  }));
}

function showGameOver() {
  S.overShown = true; saveGame();
  const P = S.players[0], win = S.over === 'win';
  openSheet(`<h2>${win ? '👑 Domination!' : 'Your tribe has fallen'}</h2>
    <p class="muted">${win ? `The ${TRIBES[P.tribe].name} rule every corner of the land.` : 'Another tribe has taken your last city.'}</p>
    <div class="stats"><span class="muted">Turns</span><b>${S.turn}</b>
      <span class="muted">Cities</span><b>${citiesOf(0).length}</b>
      <span class="muted">Wonders</span><b>${Object.keys(WONDERS).filter(k => hasWonder(0, k)).length}</b>
      <span class="muted">Enemy units defeated</span><b>${P.kills}</b>
      <span class="muted">Units converted</span><b>${P.converts}</b>
      <span class="muted">Units lost</span><b>${P.lost}</b></div>
    <div class="row"><button class="big primary" data-go="new">New game</button><button class="big" data-x>Look at the map</button></div>`);
  $('#sheet').querySelector('[data-go]').addEventListener('click', openNewGame);
}

function openMenu() {
  if (busy) return;
  openSheet(`<h2>Menu</h2>
    <div class="tmenu" style="max-width:none;margin-top:12px">
      <button class="big primary" data-x>Resume</button>
      <button class="big" data-m="help">How to play</button>
      <button class="big" data-m="settings">Settings</button>
      <button class="big" data-m="new">New game</button>
      <button class="big" data-m="title">Save and quit to title</button>
    </div>`);
  $('#sheet').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.m;
    if (m === 'help') openHelp();
    else if (m === 'settings') openSettings();
    else if (m === 'new') openNewGame();
    else if (m === 'title') { saveGame(); closeSheet(); toTitle(); }
  }));
}
$('#btnMenu').addEventListener('click', openMenu);

function openHelp() {
  openSheet(`<h2>How to play</h2>
    <ul class="help">
      <li>👑 <b>Win by domination</b>: capture every rival city. Lose your last city and your tribe falls.</li>
      <li>★ <b>Stars</b> arrive every turn from your cities. Tap the ★ counter to see where they come from.</li>
      <li>🌱 <b>Grow cities</b>: tap a resource inside your borders to gather, hunt, fish, farm or mine it. Fill a city’s growth dots and it levels up, and you choose a reward.</li>
      <li>🚩 <b>Expand</b>: move a unit onto a village. At the start of your next turn it can capture it.</li>
      <li>⚔️ <b>Units</b> move, then attack. Forests and mountains end a move, and so does stepping next to an enemy. Each tribe has a trait that bends one of these rules.</li>
      <li>🛡️ <b>Combat</b>: damage depends on attack, defence and remaining health. Defenders strike back if they survive. Cities, walls, forests (Archery) and mountains (Climbing) help defence. Three kills make a veteran.</li>
      <li>🛤️ <b>Roads</b>: moving from road to road costs half a step. Cities count as roads.</li>
      <li>🏛️ <b>Wonders</b>: one of each in the world. Whoever holds the city holds the wonder, so capturing it steals it.</li>
      <li>🕊️ <b>Truces</b> (Diplomacy): pay a rival for 8 turns of peace. A tribe that is losing may offer you one.</li>
      <li>🌻 <b>World events</b> strike every few turns and affect every tribe alike.</li>
      <li>📜 <b>Envoys</b> convert enemies, 🌿 <b>Shamans</b> heal, and 🦅 <b>Eagle Riders</b> fly over anything.</li>
      <li>↩️ <b>Undo</b> takes back moves, training, research and building, until something new is revealed or a fight happens.</li>
      <li>Drag to look around, pinch or scroll to zoom. The game saves after every action.</li>
    </ul>`);
}
function openSettings() {
  const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openSheet(`<h2>Settings</h2>
    <h4>Computer turn speed</h4>${seg('speed', [['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']], prefs.speed)}
    <p class="muted" style="font-size:13px">How quickly rival tribes’ moves are shown.</p>
    <h4>Saved game</h4><p class="muted">The game saves after every action, on this device only.</p>
    <div class="row"><button class="big danger" id="delSave">Delete saved game</button></div>
    <h4>About</h4><p class="muted">Tribelands ${VERSION}. Inspired by The Battle of Polytopia. Runs offline; nothing leaves this device.</p>`);
  $('#sheet').querySelectorAll('[data-seg] button').forEach(b => b.addEventListener('click', () => {
    prefs[b.parentNode.dataset.seg] = b.dataset.v; savePrefs(); openSettings();
  }));
  $('#delSave').addEventListener('click', () => {
    if (!confirm('Delete the saved game? This cannot be undone.')) return;
    clearSave(); closeSheet(); toTitle();
  });
}

const newOpts = Object.assign({}, prefs.last);
function openNewGame() {
  const seg = (name, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(newOpts[name]) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openSheet(`<h2>New game</h2>
    <h4>Your tribe</h4>
    <div class="tribes">${TRIBES.map((T, k) => `<button class="tribe${newOpts.tribe === k ? ' on' : ''}" style="--c:${T.color}" data-tribe="${k}"><b><i></i>${T.name}</b><span>${T.blurb}</span><span class="trait">${T.trait.icon} <b>${T.trait.name}</b>: ${T.trait.desc}</span></button>`).join('')}</div>
    <h4>Rivals</h4>${seg('opponents', [[1, '1'], [2, '2'], [3, '3']])}
    <h4>Map size</h4>${seg('size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
    <p class="muted" style="font-size:13px">${{ small: 'Quick: about 15 minutes.', medium: 'About 30 minutes.', large: 'A long campaign: 45 minutes or more.' }[newOpts.size]}</p>
    <h4>Difficulty</h4>${seg('diff', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}
    <p class="muted" style="font-size:13px">${{ easy: 'Rivals are hesitant and slow to attack.', normal: 'Rivals expand, gang up on cities and fight to win.', hard: 'Rivals start richer and earn +2 ★ every turn.' }[newOpts.diff]}</p>
    <div class="row" style="margin-top:18px"><button class="big primary" id="startGame">Start</button></div>`);
  $('#sheet').querySelectorAll('[data-tribe]').forEach(b => b.addEventListener('click', () => { newOpts.tribe = +b.dataset.tribe; openNewGame(); }));
  $('#sheet').querySelectorAll('[data-seg] button').forEach(b => b.addEventListener('click', () => {
    const k = b.parentNode.dataset.seg;
    newOpts[k] = k === 'opponents' ? +b.dataset.v : b.dataset.v;
    openNewGame();
  }));
  $('#startGame').addEventListener('click', () => {
    if (S && !S.demo && !S.over && mode === 'game' && !confirm('Start a new game? The current one will be replaced.')) return;
    prefs.last = Object.assign({}, newOpts); savePrefs();
    closeSheet();
    startGame(newGame(newOpts));
  });
}

function startGame(state) {
  S = state;
  mode = 'game';
  busy = false; sel = null; undoStack = [];
  $('#title').hidden = true;
  const cap = S.cities.find(c => c.owner === 0 && c.capital) || S.cities.find(c => c.owner === 0);
  cam.z = clamp(Math.min(W, H) / (TW * 4.8), .9, 1.8);
  if (cap) centerOn(cap.x, cap.y);
  refreshSel(); renderHud(); renderPanel(); saveGame(); kick();
  if (S.turn === 1 && S.cur === 0 && !S.pendingRewards.length && !S.over) toast(`You lead the ${TRIBES[S.players[0].tribe].name}. Explore, expand, conquer.`);
  if (S.pendingRewards.length) showReward();
}
const demoCam = { x: 0, y: 0 };
function toTitle() {
  mode = 'title';
  closeSheet();
  S = newGame({ tribe: rnd(4), opponents: 3, size: 'medium', diff: 'normal' });
  S.demo = true;
  S.explored.fill(1);
  for (const c of S.cities) if (c.owner < 0 && Math.random() < .5) { c.owner = rnd(4); c.level = 1 + rnd(3); claim(c); }
  for (const c of S.cities) if (c.owner >= 0) c.level = Math.max(c.level, 1 + rnd(4));
  cam.z = clamp(Math.min(W, H) / (TW * 5.5), .8, 1.5);
  const [wx, wy] = iso(S.n / 2, S.n / 2);
  demoCam.x = wx; demoCam.y = wy + H * .18 / cam.z;     // sit the land above the menu
  $('#title').hidden = false;
  renderHud(); renderPanel();
  const saved = loadSave();
  const m = $('#tmenu');
  m.innerHTML = (saved && !saved.over ? `<button class="big primary" id="tContinue">Continue · ${TRIBES[saved.players[0].tribe].name}, turn ${saved.turn}</button>` : '') +
    `<button class="big ${saved && !saved.over ? '' : 'primary'}" id="tNew">New game</button><button class="big" id="tHelp">How to play</button>`;
  $('#tver').textContent = 'Tribelands ' + VERSION;
  if ($('#tContinue')) $('#tContinue').addEventListener('click', () => startGame(saved));
  $('#tNew').addEventListener('click', openNewGame);
  $('#tHelp').addEventListener('click', openHelp);
  kick();
}

function resize() {
  DPR = Math.min(2.5, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  clampCam(); kick();
}
addEventListener('resize', resize);
resize();
toTitle();

// test hook: lets the browser tests drive the game without pixel-hunting
window.Tribelands = {
  get S() { return S; }, set S(v) { S = v; }, VERSION, tapTile, endTurn, act, select, undo, startGame, newGame,
  get busy() { return busy; }, get undoDepth() { return undoStack.length; }, moveInfo, targets, aiTurn,
};
