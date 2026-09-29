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
  if (anims.length || floats.length || mode === 'title') kick();
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
      const r = combat(u, e), [wx, wy] = iso(e.x, e.y), [sx, sy] = toScreen(wx, wy - 34);
      const txt = r.killed ? 'Kill' : '−' + r.dmg;
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
  if (o.undo && revealed === 0 && S.pendingRewards.length === hadRewards) {
    undoStack.push(snap);
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
  if (S.pendingRewards.length) showReward();
  else if (S.over && !S.overShown) showGameOver();
}
function undo() {
  if (busy || !undoStack.length) return;
  S = JSON.parse(undoStack.pop());
  refreshSel(); renderHud(); renderPanel(); saveGame(); kick();
}
async function endTurn() {
  if (busy || !S || S.over) return;
  busy = true;
  sel = null; undoStack = [];
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
    startTurn(0);
    revealed = 0;
    vision();
    toast('Turn ' + S.turn);
  }
  busy = false;
  afterAction();
}

// ---------- HUD and panel ----------
function renderHud() {
  const on = mode === 'game';
  $('#hud').hidden = !on;
  if (!on) return;
  const P = S.players[0];
  $('#hudDot').style.background = TRIBES[P.tribe].color;
  $('#hudStars').textContent = P.stars;
  $('#hudInc').textContent = '+' + income(0);
  $('#hudTurn').textContent = 'Turn ' + S.turn;
}
const star = '<span class="star">★</span>';
const tag = p => `<span class="tag" style="background:${colOf(p)}">${TRIBES[S.players[p].tribe].name}</span>`;
function btn(a, title, sub, on = true, go = false) {
  return `<button class="act${go ? ' go' : ''}" data-a="${a}"${on ? '' : ' disabled'}><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
}
function renderPanel() {
  const panel = $('#panel');
  panel.hidden = mode !== 'game';
  if (panel.hidden) return;
  $('#btnUndo').disabled = busy || !undoStack.length;
  $('#btnEnd').disabled = busy || !!S.over;
  const info = $('#pinfo'), acts = $('#pacts');
  if (busy && S.cur !== 0) {
    info.innerHTML = `<h3>${tag(S.cur)} is taking its turn…</h3>`;
    acts.innerHTML = '';
    return;
  }
  if (S.over) {
    info.innerHTML = `<h3>${S.over === 'win' ? 'Victory' : 'Defeat'} · Turn ${S.turn}</h3><p>Open the menu to start a new game.</p>`;
    acts.innerHTML = '';
    return;
  }
  if (!sel) {
    const ready = unitsOf(0).filter(u => !exhausted(u)).length;
    info.innerHTML = `<h3>${tag(0)} Your turn</h3><p>${ready ? ready + (ready === 1 ? ' unit' : ' units') + ' can still act. ' : ''}Tap a unit, city or tile.</p>`;
    acts.innerHTML = '';
    return;
  }
  if (sel.kind === 'unit') unitPanel(unitById(sel.id), info, acts);
  else tilePanel(sel.i, info, acts);
}
function unitPanel(u, info, acts) {
  const s = st(u), mh = maxHp(u);
  info.innerHTML = `<h3>${tag(u.owner)} ${unitName(u)}${u.vet ? ' <span style="color:var(--star)">★ Veteran</span>' : ''}</h3>
    <p><span class="hpbar"><i style="width:${u.hp / mh * 100}%"></i></span> ${u.hp}/${mh} HP · Attack ${s.atk} · Defence ${s.def} · Move ${s.mv}${s.rng > 1 ? ' · Range ' + s.rng : ''}</p>`;
  if (u.owner !== 0) {
    acts.innerHTML = '';
    const mine = unitsOf(0).find(v => sel && v.id !== u.id && targets(v).includes(u));
    acts.insertAdjacentHTML('beforeend', `<div class="hint">${mine ? 'One of your units can attack this one.' : 'An enemy unit.'}</div>`);
    return;
  }
  let h = '';
  const here = cityAtI(I(u.x, u.y));
  if (canCapture(u)) h += btn('capture', here.owner < 0 ? 'Capture village' : 'Capture city', here.owner < 0 ? 'It becomes your city' : 'Take ' + here.name, true, true);
  if (canRuin(u)) h += btn('ruin', 'Examine ruins', 'Something waits inside', true, true);
  if (canRecover(u)) h += btn('recover', 'Recover', '+' + Math.min(mh - u.hp, ownerOfI(I(u.x, u.y)) === 0 ? 4 : 2) + ' HP, ends its turn');
  if (here && here.owner === 0) h += btn('city', 'City', 'Show ' + here.name);
  h += btn('disband', 'Disband', 'Frees a unit slot');
  let hint = '';
  if (exhausted(u)) hint = 'Done for this turn.';
  else {
    const bits = [];
    if (selMoves.dests.size) bits.push('Tap a white marker to move.');
    if (selTargets.length) bits.push('Tap a red ring to attack — the label shows the damage you will do.');
    if (!bits.length && !u.moved) bits.push('Nowhere to go from here.');
    hint = bits.join(' ');
  }
  if (here && here.owner !== 0 && !canCapture(u) && !u.boat) hint = 'Capture it at the start of your next turn, if this unit survives. ' + hint;
  acts.innerHTML = h + (hint ? `<div class="hint" style="flex-basis:100%">${hint}</div>` : '');
}
function tilePanel(i, info, acts) {
  const t = S.tiles[i];
  if (!seen(i)) { info.innerHTML = '<h3>Unexplored</h3><p>Send a unit this way to see what is here.</p>'; acts.innerHTML = ''; return; }
  const c = cityAtI(i), o = ownerOfI(i);
  let h = '';
  const unit = unitAt(...XY(i));
  if (c && c.owner < 0) {
    info.innerHTML = `<h3>Village</h3><p>Move a unit here. On your next turn it can capture the village, which becomes a new city.</p>`;
  } else if (c) {
    const inc = c.level + (c.workshop ? 1 : 0) + c.parks + (c.capital ? 1 : 0);
    const pips = '<span class="pips">' + Array.from({ length: c.level + 1 }, (_, k) => `<i class="${k < c.pop ? 'on' : ''}"></i>`).join('') + '</span>';
    const extras = [c.capital && 'Capital', c.walls && 'Walls', c.workshop && 'Workshop', c.parks && 'Park'].filter(Boolean).join(' · ');
    info.innerHTML = `<h3>${tag(c.owner)} ${c.name} · Level ${c.level}</h3>
      <p>Growth ${pips} ${c.pop}/${c.level + 1} · +${inc} ${star}/turn · Units ${homeCount(c)}/${capacity(c)}${extras ? ' · ' + extras : ''}</p>`;
    if (c.owner === 0) {
      for (const k of TRAINABLE) {
        const U = UNITS[k];
        if (U.tech && !has(0, U.tech)) continue;
        let why = U.cost + ' ' + star;
        if (unitAt(c.x, c.y)) why = 'City tile is occupied';
        else if (homeCount(c) >= capacity(c)) why = 'City is full — grow it';
        h += btn('train:' + k, U.name, why, canTrain(0, c, k));
      }
      const locked = TRAINABLE.filter(k => UNITS[k].tech && !has(0, UNITS[k].tech)).length;
      if (locked) h += `<div class="hint" style="flex-basis:100%">${locked} more unit types unlock through Tech.</div>`;
    }
  } else {
    const what = [TERRAIN_NAME[t.t], t.res && RES_NAME[t.res], t.imp && IMP_NAME[t.imp], t.ruin && 'Ruins'].filter(Boolean).join(' · ');
    info.innerHTML = `<h3>${what}</h3><p>${o >= 0 ? 'Territory of ' + S.cities[t.city].name + ' (' + TRIBES[S.players[o].tribe].name + ')' : 'No one’s land'}${defNote(t)}</p>`;
    for (const k of Object.keys(WORKS)) {
      const Wk = WORKS[k];
      if (!Wk.ok(t)) continue;
      if (o !== 0) { h += btn('x', Wk.name, 'Only inside your borders', false); continue; }
      if (!has(0, Wk.tech)) { h += btn('x', Wk.name, 'Needs ' + TECHS[Wk.tech].name, false); continue; }
      const sub = (Wk.cost ? Wk.cost + ' ' + star : 'Free') + (Wk.pop ? ' · +' + Wk.pop + ' pop' : '') + (Wk.gain ? ' · +' + Wk.gain + ' ' + star : '');
      h += btn('work:' + k, Wk.name, sub, canWork(0, i, k), canWork(0, i, k));
    }
  }
  if (unit) h += btn('unit', 'Unit', 'Select the ' + UNITS[unit.type].name);
  acts.innerHTML = h;
}
function defNote(t) {
  if (t.t === FOREST) return has(0, 'archery') ? ' · Your units defend +50% here' : ' · Archery gives +50% defence here';
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
  if (a === 'capture') act(() => doCapture(u));
  else if (a === 'ruin') act(() => doRuin(u));
  else if (a === 'recover') act(() => doRecover(u), { undo: true });
  else if (a === 'disband') {
    if (confirm('Disband this ' + UNITS[u.type].name + '?')) act(() => { killUnit(u); S.players[0].lost--; }, { undo: true });
  }
  else if (a === 'city') select({ kind: 'tile', i });
  else if (a === 'unit') { const v = unitAt(...XY(i)); if (v) select({ kind: 'unit', id: v.id }); }
  else if (a === 'train') act(() => { doTrain(0, cityAtI(i), k); }, { undo: true });
  else if (a === 'work') act(() => doWork(0, i, k), { undo: true });
});
$('#btnEnd').addEventListener('click', endTurn);
$('#btnUndo').addEventListener('click', undo);

// ---------- toast ----------
let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- sheets ----------
function openSheet(html, closable = true) {
  $('#sheet').innerHTML = (closable ? '<button class="close" data-x aria-label="Close">×</button>' : '') + html;
  $('#modal').hidden = false;
  $('#modal').dataset.closable = closable ? '1' : '';
}
function closeSheet() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => {
  if (e.target.closest('[data-x]') || (e.target === $('#modal') && $('#modal').dataset.closable)) closeSheet();
});

let techSel = null;
function openTech() {
  if (busy) return;
  const P = S.players[0], col = TRIBES[P.tribe].color;
  const node = t => {
    const T = TECHS[t], done = has(0, t), avail = !T.parent || has(0, T.parent);
    const cls = done ? 'done' : avail ? '' : 'locked';
    return `<button class="tn ${cls}${techSel === t ? ' sel' : ''}" style="--c:${col}" data-t="${t}"><b>${T.name}</b><span>${done ? 'Known' : techCost(0, t) + ' ★'}</span></button>`;
  };
  let h = `<h2>Technology</h2><p class="muted">You have ${P.stars} ★. Every city you own makes research dearer.</p>`;
  for (const r of TECH_ROOTS) {
    const t2 = Object.keys(TECHS).filter(k => TECHS[k].parent === r);
    const t3 = Object.keys(TECHS).filter(k => t2.includes(TECHS[k].parent));
    h += `<div class="branch"><div class="col">${node(r)}</div><div class="arr">›</div><div class="col">${t2.map(node).join('')}</div>
      <div class="arr">${t3.length ? '›' : ''}</div><div class="col">${t3.map(node).join('')}</div></div>`;
  }
  h += '<div class="tdetail" id="tdetail"></div>';
  openSheet(h);
  techDetail();
  $('#sheet').querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => { techSel = b.dataset.t; openTech(); }));
}
function techDetail() {
  const el = $('#tdetail');
  if (!techSel) { el.innerHTML = '<p class="muted">Tap a technology to see what it unlocks.</p>'; return; }
  const T = TECHS[techSel], done = has(0, techSel), cost = techCost(0, techSel);
  let h = `<h3 style="margin:0 0 4px">${T.name}</h3><p class="muted" style="margin:0 0 10px">${T.desc}</p>`;
  if (done) h += '<p><b>Already known.</b></p>';
  else if (T.parent && !has(0, T.parent)) h += `<p class="muted">Research ${TECHS[T.parent].name} first.</p>`;
  else h += `<div class="row"><button class="big primary" id="doTech" ${canResearch(0, techSel) ? '' : 'disabled style="opacity:.5"'}>Research · ${cost} ★</button></div>`;
  el.innerHTML = h;
  const b = $('#doTech');
  if (b) b.addEventListener('click', () => {
    const t = techSel;
    closeSheet();
    act(() => { doResearch(0, t); return 'Learned ' + TECHS[t].name; }, { undo: true });
  });
}
$('#btnTech').addEventListener('click', openTech);

function showReward() {
  const cid = S.pendingRewards[0], c = S.cities[cid];
  if (!c || c.owner !== 0) { S.pendingRewards.shift(); afterAction(); return; }
  const opts = rewardChoices(c.level);
  openSheet(`<h2>${c.name} reached level ${c.level}!</h2><p class="muted">Choose how the city celebrates.</p>
    <div class="row" style="margin-top:12px">${opts.map(k => `<button class="reward" data-r="${k}"><b>${REWARDS[k].name}</b><span>${REWARDS[k].desc}</span></button>`).join('')}</div>`, false);
  centerOn(c.x, c.y); kick();
  $('#sheet').querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
    closeSheet();
    act(() => { S.pendingRewards.shift(); applyReward(c, b.dataset.r); });
  }));
}

function showGameOver() {
  S.overShown = true; saveGame();
  const P = S.players[0], win = S.over === 'win';
  openSheet(`<h2>${win ? 'Domination!' : 'Your tribe has fallen'}</h2>
    <p class="muted">${win ? `The ${TRIBES[P.tribe].name} rule every corner of the land.` : 'Another tribe has taken your last city.'}</p>
    <div class="stats"><span class="muted">Turns</span><b>${S.turn}</b>
      <span class="muted">Cities</span><b>${citiesOf(0).length}</b>
      <span class="muted">Enemy units defeated</span><b>${P.kills}</b>
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
      <li><b>Win by domination</b>: capture every rival city. Lose your last city and your tribe falls.</li>
      <li><b>Stars ★</b> arrive every turn from your cities. Spend them on technology, on working the land and on units.</li>
      <li><b>Grow cities</b>: tap a resource inside your borders and gather, hunt, fish, farm or mine it. Fill a city's growth dots and it levels up. Choose a reward each time.</li>
      <li><b>Expand</b>: move a unit onto a village. At the start of your next turn it can capture it, and you have a new city.</li>
      <li><b>Units</b>: each can move and then attack (most of them), or attack then stop. Forests and mountains end a move, and so does stepping next to an enemy.</li>
      <li><b>Combat</b>: damage depends on attack, defence and remaining health. Defenders fight back if they survive. Cities, walls, forests (Archery) and mountains (Climbing) help defence. Three kills make a veteran.</li>
      <li><b>Recover</b>: a unit that does nothing else heals 4 HP in your land, 2 HP elsewhere.</li>
      <li><b>Ruins</b> hold treasure, knowledge, maps or allies. Step on them and examine.</li>
      <li><b>Water</b>: with Fishing, build a port. A unit that walks into your port becomes a boat.</li>
      <li><b>Undo</b> takes back moves, training, research and work, until something new is revealed or a fight happens.</li>
      <li>Drag to look around, pinch or scroll to zoom. The game saves itself after every action.</li>
    </ul>`);
}
function openSettings() {
  const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openSheet(`<h2>Settings</h2>
    <h4>Computer turn speed</h4>${seg('speed', [['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']], prefs.speed)}
    <h4>Saved game</h4><p class="muted">The game saves after every action on this device.</p>
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
    <div class="tribes">${TRIBES.map((T, k) => `<button class="tribe${newOpts.tribe === k ? ' on' : ''}" style="--c:${T.color}" data-tribe="${k}"><b><i></i>${T.name}</b><span>${T.blurb}</span></button>`).join('')}</div>
    <h4>Rivals</h4>${seg('opponents', [[1, '1'], [2, '2'], [3, '3']])}
    <h4>Map size</h4>${seg('size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
    <p class="muted" style="font-size:13px">${{ small: 'Quick: about 15 minutes.', medium: 'About 30 minutes.', large: 'A long campaign: 45 minutes or more.' }[newOpts.size]}</p>
    <h4>Difficulty</h4>${seg('diff', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}
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
