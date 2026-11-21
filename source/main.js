import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export function runApp() {
const M = window.__META;
const R = M.RES, NX = M.nx, NY = M.ny;
const W = (NX - 1) * R, H = (NY - 1) * R;
const $ = id => document.getElementById(id);

// ---------- heights ----------
const HGT = window.__HGT;
var BASE_Y = 1e9; for (let i = 0; i < HGT.length; i += 7) BASE_Y = Math.min(BASE_Y, HGT[i]); BASE_Y -= 250;
function hAt(i, j) { i = Math.max(0, Math.min(NX - 1, i)); j = Math.max(0, Math.min(NY - 1, j)); return HGT[j * NX + i]; }
function heightAt(x, z) {
  const fx = (x + W / 2) / R, fz = (z + H / 2) / R;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = hAt(i, j), b = hAt(i + 1, j), c = hAt(i, j + 1), d = hAt(i + 1, j + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
const STEP = 2, MR = R * STEP;
const cols = Math.floor((NX - 1) / STEP) + 1, rows = Math.floor((NY - 1) / STEP) + 1;
function mAt(c, r) { return hAt(Math.min(c, cols - 1) * STEP, Math.min(r, rows - 1) * STEP); }
// height on the rendered (40 m) mesh surface – same triangulation as the mesh
function meshHeight(x, z) {
  const fx = Math.max(0, Math.min(cols - 1.0001, (x + W / 2) / MR)), fz = Math.max(0, Math.min(rows - 1.0001, (z + H / 2) / MR));
  const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
  const a = mAt(c, r), b = mAt(c + 1, r), d = mAt(c, r + 1), e = mAt(c + 1, r + 1);
  return (u + v <= 1) ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
}
function inside(x, z) { return Math.abs(x) <= W / 2 && Math.abs(z) <= H / 2; }
function slopeAt(x, z) {
  const d = R;
  const dzdx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d);
  const dzdz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
  const g = Math.hypot(dzdx, dzdz);
  let bearing = Math.atan2(-dzdx, dzdz) * 180 / Math.PI; if (bearing < 0) bearing += 360;
  return { deg: Math.atan(g) * 180 / Math.PI, pct: g * 100, bearing };
}
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const dirName = b => DIRS[Math.round(b / 45) % 8];
const toXZ = (lon, lat) => [(lon - M.B.w) * M.mlon - W / 2, (M.B.n - lat) * M.mlat - H / 2];
const degOf = p => Math.round(Math.atan(Math.abs(p) / 100) * 180 / Math.PI);
const fmtLen = L => L >= 1000 ? (L / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(L) + ' m';

// ---------- colors ----------
function pctColor(p) {
  p = Math.abs(p);
  if (p < 25) return new THREE.Color(0x3fb37f);
  if (p < 40) return new THREE.Color(0xf2c230);
  if (p < 60) return new THREE.Color(0xf08a24);
  if (p < 80) return new THREE.Color(0xd8352a);
  if (p < 100) return new THREE.Color(0xa52a8a);
  return new THREE.Color(0x4b2391);
}
const pctCss = p => '#' + pctColor(p).getHexString();
const DIFF = {
  novice: { c: 0x2e9d4f, de: 'Übungsgelände' }, easy: { c: 0x1f6fd1, de: 'Leicht (blau)' },
  intermediate: { c: 0xd7262b, de: 'Mittel (rot)' }, advanced: { c: 0x15171a, de: 'Schwer (schwarz)' },
  expert: { c: 0x15171a, de: 'Sehr schwer' }, freeride: { c: 0xf08a24, de: 'Skiroute' }, '': { c: 0x7b8794, de: 'ohne Angabe' },
};
const diff = c => DIFF[c] || DIFF[''];
const LIFT_DE = { cable_car: 'Pendelbahn', gondola: 'Gondelbahn', chair_lift: 'Sessellift', mixed_lift: 'Kombibahn', 't-bar': 'Schlepplift', 'j-bar': 'Schlepplift', platter: 'Tellerlift', rope_tow: 'Seillift', magic_carpet: 'Förderband' };
const AERIAL = new Set(['cable_car', 'gondola', 'chair_lift', 'mixed_lift']);

// ---------- renderer / scene ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 24000 * Math.max(1, W / 17000), 60000 * Math.max(1, W / 17000));
const camera = new THREE.PerspectiveCamera(45, 1, 20, 120000);

// terrain
const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const i = c * STEP, j = r * STEP, k = r * cols + c;
  pos[k * 3] = i * R - W / 2; pos[k * 3 + 1] = hAt(i, j); pos[k * 3 + 2] = j * R - H / 2;
  uv[k * 2] = i / (NX - 1); uv[k * 2 + 1] = 1 - j / (NY - 1);
}
const idx = new Uint32Array((cols - 1) * (rows - 1) * 6); let p = 0;
for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
  const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
  idx[p++] = a; idx[p++] = d; idx[p++] = b; idx[p++] = b; idx[p++] = d; idx[p++] = e;
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
geo.setIndex(new THREE.BufferAttribute(idx, 1));
const loader = new THREE.TextureLoader();
function tex(id) { const t = loader.load($(id).src, () => render()); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }
const texBase = tex('img-base'), texSlope = tex('img-slope');
const mat = new THREE.MeshBasicMaterial({ map: texBase, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
scene.add(new THREE.Mesh(geo, mat));
{ // diorama walls
  const wp = [], wc = [], top = new THREE.Color(0x4a5866), bot = new THREE.Color(0x1d2630);
  const edge = pts => { for (let k = 0; k < pts.length - 1; k++) { const [x1, z1] = pts[k], [x2, z2] = pts[k + 1]; const y1 = meshHeight(x1, z1), y2 = meshHeight(x2, z2);
    wp.push(x1, y1, z1, x1, BASE_Y, z1, x2, y2, z2, x2, y2, z2, x1, BASE_Y, z1, x2, BASE_Y, z2); for (const c of [top, bot, top, top, bot, bot]) wc.push(c.r, c.g, c.b); } };
  const N = [], S = [], E = [], Wp = [];
  for (let c = 0; c < cols; c++) { const x = c * MR - W / 2; N.push([x, -H / 2]); S.push([x, (rows - 1) * MR - H / 2]); }
  for (let r = 0; r < rows; r++) { const z = r * MR - H / 2; Wp.push([-W / 2, z]); E.push([(cols - 1) * MR - W / 2, z]); }
  edge(N); edge(S); edge(E); edge(Wp);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
}

// ---------- data: runs & lifts ----------
const FEATS = window.__FEATS;
const runs = [], lifts = [];
for (const [k, name, ref, cls, ex, ll] of FEATS) {
  const xz = ll.map(([lo, la]) => toXZ(lo, la));
  if (k === 'r') runs.push({ name, ref, cls, xz }); else lifts.push({ name, ref, cls, cap: ex, xz });
}
function densify(xz, step) {
  const out = []; let d = 0;
  for (let k = 0; k < xz.length - 1; k++) {
    const [x1, z1] = xz[k], [x2, z2] = xz[k + 1], L = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.ceil(L / step));
    for (let s = (k === 0 ? 0 : 1); s <= n; s++) { const t = s / n; out.push({ x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, d: d + L * t }); }
    d += L;
  }
  if (xz.length === 1) out.push({ x: xz[0][0], z: xz[0][1], d: 0 });
  return out;
}
function gradients(s) {
  for (const q of s) q.h = heightAt(q.x, q.z);
  for (let i = 0; i < s.length; i++) {
    let a = i, b = i; while (a > 0 && s[i].d - s[a].d < 20) a--; while (b < s.length - 1 && s[b].d - s[i].d < 20) b++;
    s[i].g = s[b].d > s[a].d ? (s[b].h - s[a].h) / (s[b].d - s[a].d) * 100 : 0;
  }
  return s;
}
for (const r of runs) {
  r.s = gradients(densify(r.xz, 10));
  if (r.s.length > 1 && r.s[r.s.length - 1].h > r.s[0].h + 2) { // orient downhill
    const L = r.s[r.s.length - 1].d; r.s.reverse(); r.s.forEach(q => { q.d = L - q.d; q.g = -q.g; });
  }
  r.len = r.s[r.s.length - 1].d;
  r.key = (r.name || r.ref) ? r.name + '|' + r.ref : null;
}

// ---------- piste lines ----------
const lineMats = [];
function makeLineMat(width, opts = {}) { const m = new LineMaterial({ linewidth: width, vertexColors: !opts.color, color: opts.color ?? 0xffffff, transparent: !!opts.opacity, opacity: opts.opacity ?? 1, depthTest: opts.depthTest ?? true }); lineMats.push(m); return m; }
const runPos = [], runIdx = [];
runs.forEach((r, ri) => { for (let i = 0; i < r.s.length - 1; i++) { const a = r.s[i], b = r.s[i + 1];
  runPos.push(a.x, meshHeight(a.x, a.z) + 4, a.z, b.x, meshHeight(b.x, b.z) + 4, b.z); runIdx.push([ri, i]); } });
const runGeo = new LineSegmentsGeometry(); runGeo.setPositions(runPos);
const haloGeo = new LineSegmentsGeometry(); haloGeo.setPositions(runPos);
const runHalo = new LineSegments2(haloGeo, makeLineMat(5.5, { color: 0xffffff })); runHalo.material.depthWrite = false;
const runLines = new LineSegments2(runGeo, makeLineMat(2.8));
runHalo.renderOrder = 1; runLines.renderOrder = 2;
scene.add(runHalo, runLines);
var mode = 'pisten';
function colorRuns() {
  const col = [];
  for (const [ri, i] of runIdx) {
    const r = runs[ri];
    const ca = mode === 'pisten' ? new THREE.Color(diff(r.cls).c) : pctColor(r.s[i].g);
    const cb = mode === 'pisten' ? ca : pctColor(r.s[i + 1].g);
    col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
  }
  runGeo.setColors(col); render();
}
colorRuns();

// highlight
var hl = null;
function highlight(segs) {
  if (hl) { scene.remove(hl); hl.geometry.dispose(); hl = null; }
  if (!segs) return;
  const ps = [];
  for (const s of segs) for (let i = 0; i < s.length - 1; i++) ps.push(s[i].x, meshHeight(s[i].x, s[i].z) + 6, s[i].z, s[i + 1].x, meshHeight(s[i + 1].x, s[i + 1].z) + 6, s[i + 1].z);
  const g = new LineSegmentsGeometry(); g.setPositions(ps);
  hl = new LineSegments2(g, makeLineMat(10, { color: 0x0b1a2a, opacity: 0.5 })); hl.material.depthWrite = false;
  hl.renderOrder = 0; scene.add(hl); resize();
}

// ---------- lifts ----------
const liftGroup = new THREE.Group(); scene.add(liftGroup);
const cablePos = [];
const anim = [];
for (const l of lifts) {
  const aerial = AERIAL.has(l.cls);
  // node heights: stations low, pylons higher
  const nodes = l.xz.map(([x, z], i) => { const end = i === 0 || i === l.xz.length - 1; return { x, z, y: meshHeight(x, z) + (aerial ? (end ? 8 : 18) : 2) }; });
  const path = []; let d = 0;
  for (let k = 0; k < nodes.length - 1; k++) {
    const a = nodes[k], b = nodes[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 25));
    for (let s = (k === 0 ? 0 : 1); s <= n; s++) { const t = s / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = Math.max(a.y + (b.y - a.y) * t, meshHeight(x, z) + (aerial ? 8 : 2)); path.push({ x, y, z, d: d + L * t }); }
    d += L;
  }
  l.path = path; l.len = d;
  l.h0 = heightAt(nodes[0].x, nodes[0].z); l.h1 = heightAt(nodes[nodes.length - 1].x, nodes[nodes.length - 1].z);
  for (let i = 0; i < path.length - 1; i++) cablePos.push(path[i].x, path[i].y, path[i].z, path[i + 1].x, path[i + 1].y, path[i + 1].z);
  if (aerial) anim.push(l);
}
const cableGeo = new LineSegmentsGeometry(); cableGeo.setPositions(cablePos);
const cables = new LineSegments2(cableGeo, makeLineMat(2.2, { color: 0x2b2f36 })); cables.renderOrder = 3; liftGroup.add(cables);
// stations
{
  const sp = [];
  for (const l of lifts) if (AERIAL.has(l.cls)) for (const q of [l.path[0], l.path[l.path.length - 1]]) sp.push(q);
  const g = new THREE.BoxGeometry(1, 1, 1);
  const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x39424d }), sp.length);
  const m4 = new THREE.Matrix4();
  sp.forEach((q, i) => { m4.compose(new THREE.Vector3(q.x, q.y - 4, q.z), new THREE.Quaternion(), new THREE.Vector3(34, 16, 34)); im.setMatrixAt(i, m4); });
  liftGroup.add(im);
}
// moving cabins
const CAB = {
  gondola: { sp: 6, gap: 110, col: 0xe2382f, size: [1, 1.15, 1] },
  mixed_lift: { sp: 6, gap: 90, col: 0xe2382f, size: [1, 1.15, 1] },
  chair_lift: { sp: 5, gap: 55, col: 0x1b2330, size: [1.5, 0.5, 0.7] },
  cable_car: { sp: 10, gap: 0, col: 0xf2c230, size: [1.8, 1.6, 1.8] },
};
const cabinSlots = [];
for (const l of anim) {
  const c = CAB[l.cls];
  if (l.cls === 'cable_car') { cabinSlots.push({ l, c, shuttle: 0 }, { l, c, shuttle: 1 }); continue; }
  const n = Math.max(2, Math.floor(l.len / c.gap));
  for (let i = 0; i < n; i++) for (const dir of [0, 1]) cabinSlots.push({ l, c, off: i / n, dir });
}
const cabMeshes = {};
for (const t of Object.keys(CAB)) {
  const cnt = cabinSlots.filter(s => s.l.cls === t).length; if (!cnt) continue;
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: CAB[t].col }), cnt);
  im.frustumCulled = false; liftGroup.add(im); cabMeshes[t] = { im, n: 0 };
}
function pathAt(l, d) {
  const P = l.path; d = Math.max(0, Math.min(l.len, d));
  let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].d <= d) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, b.x - a.x, b.z - a.z];
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const TIME_X = 3;
function updateCabins(t, camDist) {
  const k = THREE.MathUtils.clamp(camDist * 0.0011, 3, 22);
  for (const key in cabMeshes) cabMeshes[key].n = 0;
  for (const s of cabinSlots) {
    const l = s.l, c = s.c, cm = cabMeshes[l.cls];
    let d, side;
    if (s.shuttle !== undefined) { const T = l.len / c.sp, ph = ((t * TIME_X / T) + s.shuttle) % 2; const f = ph < 1 ? ph : 2 - ph; d = (s.shuttle ? 1 - f : f) * l.len; side = s.shuttle ? 1 : -1; }
    else { const f = ((s.off + t * TIME_X * c.sp / l.len) % 1); d = s.dir ? (1 - f) * l.len : f * l.len; side = s.dir ? 1 : -1; }
    const [x, y, z, dx, dz] = pathAt(l, d);
    const ang = Math.atan2(dx, dz), off = side * (2 + k * 0.35);
    _v.set(x + Math.cos(ang) * off, y - k * c.size[1] * 0.6, z - Math.sin(ang) * off);
    _q.setFromAxisAngle(_up, ang); _s.set(c.size[0] * k, c.size[1] * k, c.size[2] * k);
    _m.compose(_v, _q, _s); cm.im.setMatrixAt(cm.n++, _m);
  }
  for (const key in cabMeshes) cabMeshes[key].im.instanceMatrix.needsUpdate = true;
}

// ---------- labels ----------
const labels = [];
function addLabel(text, x, z, y, cls) {
  const el = document.createElement('div'); el.className = 'lbl ' + (cls || ''); el.textContent = text;
  $('labels').appendChild(el); labels.push({ el, v: new THREE.Vector3(x, y, z) });
}
for (const l of lifts) if ((l.cls === 'gondola' || l.cls === 'cable_car') && l.name && l.len > 900) {
  const q = l.path[l.path.length - 1]; addLabel(l.name, q.x, q.z, q.y + 30, 'lift');
}

// ---------- controls ----------
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 400; controls.maxDistance = Math.max(45000, W * 2.5);
const VIEW = window.__VIEW; const [mx, mz] = toXZ(VIEW.lon, VIEW.lat); const vk = THREE.MathUtils.clamp(VIEW.size / 9000, 0.5, 3.5);
function resetView() { const ty = heightAt(mx, mz); controls.target.set(mx, ty, mz); camera.position.set(mx + 7800 * vk, ty + 6800 * vk, mz + 6200 * vk); controls.update(); }
resetView();
controls.addEventListener('change', () => render());

// ---------- UI ----------
const ui = { info: $('info'), prof: $('profile'), hint: $('hint') };
var measuring = false, pts = [];
const measureGroup = new THREE.Group(); scene.add(measureGroup);
const pinGroup = new THREE.Group(); scene.add(pinGroup);
const markerGeo = new THREE.SphereGeometry(1, 16, 12);
function closePanels() { ui.info.classList.add('hidden'); ui.prof.classList.add('hidden'); pinGroup.clear(); highlight(null); render(); }

function drawProfile(s, opts) {
  ui.info.classList.add('hidden'); ui.prof.classList.remove('hidden');
  const len = s[s.length - 1].d;
  let up = 0, dn = 0, maxG = 0, maxAt = 0, maxT = 0;
  for (let i = 1; i < s.length; i++) { const dh = s[i].h - s[i - 1].h; if (dh > 0) up += dh; else dn -= dh; }
  for (const q of s) { if (Math.abs(q.g) > maxG) { maxG = Math.abs(q.g); maxAt = q.d; } if (q.t !== undefined) maxT = Math.max(maxT, q.t); }
  const avg = Math.abs(s[s.length - 1].h - s[0].h) / len * 100;
  $('pr-head').innerHTML = opts.head || '';
  $('pr-head').classList.toggle('hidden', !opts.head);
  $('st-len').textContent = fmtLen(len);
  $('st-hm').textContent = `↓${Math.round(dn)} ↑${Math.round(up)} m`;
  $('st-avg').textContent = `${Math.round(avg)} %`;
  const mg = $('st-max'); mg.textContent = `${Math.round(maxG)} % · ${degOf(maxG)}°`; mg.style.color = pctCss(maxG);
  $('st-max-l').textContent = opts.maxLabel;
  const fall = $('st-fall-box');
  if (opts.showFall) { fall.classList.remove('hidden'); const mt = $('st-fall'); mt.textContent = `${Math.round(maxT)} % · ${degOf(maxT)}°`; mt.style.color = pctCss(maxT); }
  else { fall.classList.remove('hidden'); $('st-fall-l').textContent = 'Steilste Stelle'; const mt = $('st-fall'); mt.innerHTML = `nach ${fmtLen(maxAt)} <span class="sm">auf ${Math.round(s.find(q => q.d >= maxAt)?.h ?? 0)} m</span>`; mt.style.color = ''; }
  if (opts.showFall) $('st-fall-l').textContent = 'Steilster Hang unter der Linie';

  const cv = $('pc'), dpr = Math.min(2, window.devicePixelRatio || 1), cw = cv.clientWidth, ch = cv.clientHeight;
  cv.width = cw * dpr; cv.height = ch * dpr; const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, cw, ch);
  let hmin = Infinity, hmax = -Infinity; for (const q of s) { hmin = Math.min(hmin, q.h); hmax = Math.max(hmax, q.h); }
  const pad = Math.max(15, (hmax - hmin) * 0.12); hmin -= pad; hmax += pad;
  const L = 34, Rr = 8, T = 8, B = 18;
  const X = d => L + d / len * (cw - L - Rr), Y = h => T + (1 - (h - hmin) / (hmax - hmin)) * (ch - T - B);
  ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = '#6b7c8c'; ctx.strokeStyle = 'rgba(120,140,160,.25)';
  for (let k = 0; k <= 3; k++) { const h = hmin + (hmax - hmin) * k / 3, y = Y(h); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(cw - Rr, y); ctx.stroke(); ctx.fillText(Math.round(h), 2, y + 3); }
  ctx.fillText('0', L, ch - 4); const lt = fmtLen(len); ctx.fillText(lt, cw - Rr - ctx.measureText(lt).width, ch - 4);
  for (let i = 1; i < s.length; i++) { const a = s[i - 1], b = s[i]; ctx.fillStyle = pctCss(b.g);
    ctx.beginPath(); ctx.moveTo(X(a.d), Y(a.h)); ctx.lineTo(X(b.d), Y(b.h)); ctx.lineTo(X(b.d), ch - B); ctx.lineTo(X(a.d), ch - B); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = '#0b1a2a'; ctx.lineWidth = 1.6; ctx.beginPath(); s.forEach((q, i) => i ? ctx.lineTo(X(q.d), Y(q.h)) : ctx.moveTo(X(q.d), Y(q.h))); ctx.stroke();
  const xm = X(maxAt); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xm, T); ctx.lineTo(xm, ch - B); ctx.stroke(); ctx.setLineDash([]);
  render();
}

// --- piste selection: chain all segments of the same named piste
function chainFor(run) {
  const group = run.key ? runs.filter(r => r.key === run.key) : [run];
  // greedy chain from the highest start
  const used = new Set(); const startH = r => r.s[0].h;
  let cur = group.slice().sort((a, b) => startH(b) - startH(a))[0];
  const chain = [];
  while (cur && !used.has(cur)) {
    used.add(cur); chain.push(cur);
    const e = cur.s[cur.s.length - 1];
    let best = null, bd = 40;
    for (const r of group) if (!used.has(r)) { const d = Math.hypot(r.s[0].x - e.x, r.s[0].z - e.z); if (d < bd) { bd = d; best = r; } }
    cur = best;
  }
  if (!chain.includes(run)) return { segs: group.map(r => r.s), prof: run.s, group };
  const prof = []; let off = 0;
  for (const r of chain) { for (const q of r.s) prof.push({ ...q, d: q.d + off }); off += r.len; }
  return { segs: group.map(r => r.s), prof, group };
}
function showRun(run) {
  const { segs, prof, group } = chainFor(run);
  highlight(segs);
  const ORDER = ['', 'novice', 'easy', 'intermediate', 'advanced', 'expert'];
  const cls = group.reduce((a, r) => ORDER.indexOf(r.cls) > ORDER.indexOf(a) ? r.cls : a, run.cls);
  const dcol = '#' + new THREE.Color(diff(cls).c).getHexString();
  const title = run.name || (run.ref ? 'Piste ' + run.ref : 'Piste ohne Namen');
  const head = `<div class="ph"><span class="badge" style="background:${dcol}">${run.ref || '–'}</span><div><div class="pt">${title}</div><div class="ps">${diff(cls).de}${group.length > 1 ? ' · ' + group.length + ' Abschnitte' : ''}</div></div></div>`;
  drawProfile(prof, { head, maxLabel: 'Max. Gefälle auf der Piste', showFall: false });
}
function showLift(l) {
  highlight([l.path.map(q => ({ x: q.x, z: q.z }))]);
  const dh = Math.round(Math.abs(l.h1 - l.h0)), L = Math.hypot(l.len, l.h1 - l.h0);
  ui.prof.classList.add('hidden');
  ui.info.innerHTML = `<div class="ph"><span class="badge lift">${liftIcon(l.cls)}</span><div><div class="pt">${l.name || LIFT_DE[l.cls] || 'Lift'}</div><div class="ps">${LIFT_DE[l.cls] || l.cls}</div></div></div>
    <div class="i-row"><span>Länge ~${fmtLen(L)}</span><span>Höhenunterschied ${dh} m</span><span>Tal ${Math.round(Math.min(l.h0, l.h1))} m · Berg ${Math.round(Math.max(l.h0, l.h1))} m</span>${l.cap ? `<span>Kapazität ${l.cap} P/h</span>` : ''}</div>`;
  ui.info.classList.remove('hidden'); render();
}
const liftIcon = c => c === 'chair_lift' ? '🪑' : (c === 'gondola' || c === 'mixed_lift') ? '🚡' : c === 'cable_car' ? '🚠' : '⛷';

function showInfo(x, z) {
  highlight(null); pinGroup.clear();
  const s = slopeAt(x, z), h = heightAt(x, z);
  const pin = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: pctColor(s.pct) }));
  pin.scale.setScalar(Math.max(15, camera.position.distanceTo(controls.target) * 0.003));
  pin.position.set(x, meshHeight(x, z) + 10, z); pinGroup.add(pin);
  ui.prof.classList.add('hidden');
  ui.info.innerHTML = `<div class="i-big" style="color:${pctCss(s.pct)}">${Math.round(s.pct)} %<span> · ${s.deg.toFixed(0)}°</span></div>
    <div class="i-row"><span>Hangneigung Gelände</span><span>Höhe ${Math.round(h)} m</span><span>Exposition ${dirName(s.bearing)}</span></div>`;
  ui.info.classList.remove('hidden'); render();
}

// measuring
function samplePath() {
  const s = densify(pts, 10); gradients(s);
  for (const q of s) q.t = slopeAt(q.x, q.z).pct; return s;
}
function rebuildMeasure() {
  measureGroup.clear();
  const sc = Math.max(12, camera.position.distanceTo(controls.target) * 0.0025);
  for (const [x, z] of pts) { const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0x0b1a2a })); m.scale.setScalar(sc); m.position.set(x, meshHeight(x, z) + 8, z); measureGroup.add(m); }
  if (pts.length < 2) { ui.prof.classList.add('hidden'); render(); return; }
  const s = samplePath();
  const ps = [], cs = [];
  for (let i = 0; i < s.length - 1; i++) { const a = s[i], b = s[i + 1]; ps.push(a.x, meshHeight(a.x, a.z) + 7, a.z, b.x, meshHeight(b.x, b.z) + 7, b.z);
    const ca = pctColor(a.g), cb = pctColor(b.g); cs.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b); }
  const g = new LineSegmentsGeometry(); g.setPositions(ps); g.setColors(cs);
  const g2 = new LineSegmentsGeometry(); g2.setPositions(ps);
  const halo = new LineSegments2(g2, makeLineMat(8, { color: 0x0b1a2a })); halo.renderOrder = 4; halo.material.depthWrite = false;
  const line = new LineSegments2(g, makeLineMat(4.5)); line.renderOrder = 5;
  measureGroup.add(halo, line); resize();
  drawProfile(s, { head: '', maxLabel: 'Max. Gefälle entlang Linie', showFall: true });
}

// picking
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  ndc.set((cx - rect.left) / rect.width * 2 - 1, -(cy - rect.top) / rect.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction; let prev = 0;
  for (let t = 0; t < 120000; t += 15) {
    const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
    if (!inside(x, z)) { prev = t; continue; }
    if (y <= meshHeight(x, z)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= meshHeight(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
      return [o.x + d.x * hi, o.z + d.z * hi];
    }
    prev = t;
  }
  return null;
}
function nearest(x, z) {
  const thr = Math.max(25, camera.position.distanceTo(controls.target) * 0.006);
  let best = null, bd = thr;
  for (const r of runs) for (const q of r.s) { const dd = Math.hypot(q.x - x, q.z - z); if (dd < bd) { bd = dd; best = { run: r }; } }
  for (const l of lifts) for (const q of l.path) { const dd = Math.hypot(q.x - x, q.z - z) * 1.15; if (dd < bd) { bd = dd; best = { lift: l }; } }
  return best;
}
var down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() } });
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
  if (moved > 8 || dt > 500) return;
  const hit = pick(e.clientX, e.clientY); if (!hit) return;
  if (routing) { routeTap(hit[0], hit[1]); return; }
  if (measuring) { pts.push(hit); rebuildMeasure(); updateUi(); return; }
  const n = nearest(hit[0], hit[1]);
  if (n?.run) { pinGroup.clear(); showRun(n.run); }
  else if (n?.lift) { pinGroup.clear(); showLift(n.lift); }
  else showInfo(hit[0], hit[1]);
});

// ---------- ROUTING ----------
const RANK = { novice: 1, easy: 1, '': 1, intermediate: 2, advanced: 3, expert: 3, freeride: 4 };
const LIFT_SPEED = { gondola: 5.5, mixed_lift: 5, cable_car: 10, chair_lift: 4.5, 't-bar': 3, 'j-bar': 3, platter: 3, rope_tow: 2, magic_carpet: 0.6 };
const LIFT_WAIT = { cable_car: 300, gondola: 90, mixed_lift: 90, chair_lift: 90 };
const SKI_V = 7;      // m/s ≈ 25 km/h Durchschnitt inkl. Schwüngen
const WALK_V = 1.2;   // m/s schieben / queren
const G = { nodes: [], adj: [] };
function addNode(x, z, h) { G.nodes.push({ x, z, h }); G.adj.push([]); return G.nodes.length - 1; }
function addEdge(a, b, e) { G.adj[a].push({ to: b, ...e }); }
// grid index
const CELL = 60, grid = new Map();
const gkey = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
function gridAdd(id) { const n = G.nodes[id], k = gkey(n.x, n.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); }
function near(x, z, r) {
  const out = [], c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), r0 = Math.floor((z - r) / CELL), r1 = Math.floor((z + r) / CELL);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) { const a = grid.get(i + ',' + j); if (a) for (const id of a) { const n = G.nodes[id], d = Math.hypot(n.x - x, n.z - z); if (d <= r) out.push([id, d]); } }
  return out;
}
const nodeOwner = [];  // which run / lift a node belongs to
runs.forEach((r, ri) => {
  r.nodes = r.s.map(q => { const id = addNode(q.x, q.z, q.h); nodeOwner[id] = 'r' + ri; gridAdd(id); return id; });
  const flat = Math.abs(r.s[0].h - r.s[r.s.length - 1].h) < 8;
  for (let i = 0; i < r.nodes.length - 1; i++) {
    const d = r.s[i + 1].d - r.s[i].d, e = { kind: 'run', id: ri, d, t: d / SKI_V, g: Math.max(Math.abs(r.s[i].g), Math.abs(r.s[i + 1].g)) };
    addEdge(r.nodes[i], r.nodes[i + 1], e);
    if (flat) addEdge(r.nodes[i + 1], r.nodes[i], { ...e, t: d / (SKI_V * 0.4) });
  }
});
// connectors between runs: from every run endpoint to the nearest node of each other run
function connect(from, radius, allowUp) {
  const n = G.nodes[from], best = new Map();
  for (const [id, d] of near(n.x, n.z, radius)) { const o = nodeOwner[id]; if (o === nodeOwner[from]) continue; if (!best.has(o) || best.get(o)[1] > d) best.set(o, [id, d]); }
  for (const [id, d] of best.values()) {
    const m = G.nodes[id];
    if (m.h - n.h < allowUp) addEdge(from, id, { kind: 'walk', d, t: d / WALK_V + 5 });
    if (n.h - m.h < allowUp) addEdge(id, from, { kind: 'walk', d, t: d / WALK_V + 5 });
  }
}
runs.forEach(r => { connect(r.nodes[0], 35, 10); connect(r.nodes[r.nodes.length - 1], 35, 10); });
// lifts: bottom -> top (and optional downhill ride for gondolas / cable cars)
lifts.forEach((l, li) => {
  let a = l.path[0], b = l.path[l.path.length - 1];
  let ha = heightAt(a.x, a.z), hb = heightAt(b.x, b.z);
  if (ha > hb) { [a, b] = [b, a]; [ha, hb] = [hb, ha]; }
  l.bottom = addNode(a.x, a.z, ha); l.top = addNode(b.x, b.z, hb);
  nodeOwner[l.bottom] = nodeOwner[l.top] = 'l' + li;
  const t = l.len / (LIFT_SPEED[l.cls] || 3) + (LIFT_WAIT[l.cls] || 30);
  addEdge(l.bottom, l.top, { kind: 'lift', id: li, d: l.len, t, up: true });
  if (l.cls === 'gondola' || l.cls === 'cable_car') addEdge(l.top, l.bottom, { kind: 'lift', id: li, d: l.len, t, up: false, down: true });
  gridAdd(l.bottom); gridAdd(l.top);
  connect(l.bottom, 90, 15); connect(l.top, 90, 15);
});

// walking links between nearby lift stations (e.g. Penkenbahn ↔ Ahornbahn im Ort)
var VALLEY_H = Math.min(...lifts.map(l => G.nodes[l.bottom].h)) + 350;
for (let i = 0; i < lifts.length; i++) for (let j = 0; j < lifts.length; j++) if (i !== j) for (const a of [lifts[i].bottom, lifts[i].top]) for (const b of [lifts[j].bottom, lifts[j].top]) {
  const A = G.nodes[a], B = G.nodes[b], d = Math.hypot(A.x - B.x, A.z - B.z);
  if (d > 90 && d < 600 && Math.abs(A.h - B.h) < 30 && A.h < VALLEY_H && B.h < VALLEY_H) addEdge(a, b, { kind: 'walk', d, t: d / WALK_V + 60, far: true });
}
function dijkstra(src, dst, maxRank, allowDown) {
  const N = G.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), pe = new Array(N);
  const heap = [[0, src]]; dist[src] = 0;
  const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist[u]) continue; if (u === dst) break;
    for (const e of G.adj[u]) {
      if (e.kind === 'run' && (RANK[runs[e.id].cls] ?? 2) > maxRank) continue;
      if (e.down && !allowDown) continue;
      const nd = d + e.t; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; pe[e.to] = e; push([nd, e.to]); }
    }
  }
  if (!isFinite(dist[dst])) return null;
  const path = []; for (let v = dst; v !== src; v = prev[v]) path.push({ from: prev[v], to: v, e: pe[v] });
  return { time: dist[dst], edges: path.reverse() };
}

function snap(x, z) {
  const r = Math.max(120, camera.position.distanceTo(controls.target) * 0.025);
  let best = null, bd = r;
  for (const [id, d] of near(x, z, r)) if (d < bd) { bd = d; best = id; }
  return best;
}

// route state & drawing
const route = { a: null, b: null, rank: 2, allowDown: true, res: null };
const routeGroup = new THREE.Group(); scene.add(routeGroup);
var routing = false;
function marker(id, color, label) {
  const n = G.nodes[id], y = meshHeight(n.x, n.z);
  const s = Math.max(14, camera.position.distanceTo(controls.target) * 0.0028);
  const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color })); m.scale.setScalar(s); m.position.set(n.x, y + s * 0.8, n.z);
  m.renderOrder = 7; routeGroup.add(m);
  const L = label === 'Start' ? startLbl : goalLbl; L.v.set(n.x, y + s * 2.2, n.z); L.el.style.visibility = '';
}
addLabel('Start', 0, 0, 0, 'rt rt-a'); const startLbl = labels[labels.length - 1];
addLabel('Ziel', 0, 0, 0, 'rt rt-b'); const goalLbl = labels[labels.length - 1];
startLbl.el.style.visibility = goalLbl.el.style.visibility = 'hidden';
function drawRoute() {
  routeGroup.clear(); startLbl.el.style.visibility = goalLbl.el.style.visibility = 'hidden';
  if (route.a !== null) marker(route.a, 0x1a9e55, 'Start');
  if (route.b !== null) marker(route.b, 0xd7262b, 'Ziel');
  const res = route.res; if (!res) { render(); return; }
  const ps = [], cs = [];
  const yOf = id => { const n = G.nodes[id]; return meshHeight(n.x, n.z) + 9; };
  for (const { from, to, e } of res.edges) {
    let a = G.nodes[from], b = G.nodes[to], col;
    if (e.kind === 'lift') {
      const l = lifts[e.id]; let P = l.path; if (!e.up !== (P[0].y > P[P.length - 1].y)) P = P.slice().reverse();
      for (let i = 0; i < P.length - 1; i++) { ps.push(P[i].x, P[i].y + 4, P[i].z, P[i + 1].x, P[i + 1].y + 4, P[i + 1].z); cs.push(0.12, 0.13, 0.16, 0.12, 0.13, 0.16); }
      continue;
    }
    col = e.kind === 'run' ? new THREE.Color(diff(runs[e.id].cls).c) : new THREE.Color(0x7b8794);
    ps.push(a.x, yOf(from), a.z, b.x, yOf(to), b.z); cs.push(col.r, col.g, col.b, col.r, col.g, col.b);
  }
  const g = new LineSegmentsGeometry(); g.setPositions(ps); g.setColors(cs);
  const g2 = new LineSegmentsGeometry(); g2.setPositions(ps);
  const halo = new LineSegments2(g2, makeLineMat(13, { color: 0xffe14d })); halo.material.depthWrite = false; halo.renderOrder = 4;
  const line = new LineSegments2(g, makeLineMat(6)); line.renderOrder = 5;
  routeGroup.add(halo, line); resize();
}

function buildSteps(res) {
  const steps = [];
  for (const { e } of res.edges) {
    let key, item;
    if (e.kind === 'lift') { key = 'l' + e.id + (e.up ? 'u' : 'd'); }
    else if (e.kind === 'run') { const r = runs[e.id]; key = r.key ? 'r' + r.key : 'u' + r.cls; }
    else key = 'walk';
    const last = steps[steps.length - 1];
    if (last && last.key === key) { last.d += e.d; last.t += e.t; last.g = Math.max(last.g, e.g || 0); continue; }
    if (e.kind === 'walk' && last && e.d < 60) { last.t += e.t; continue; }
    steps.push({ key, kind: e.kind, id: e.id, up: e.up, d: e.d, t: e.t, g: e.g || 0 });
  }
  return steps.filter(s => !(s.kind === 'walk' && s.d < 25));
}
const fmtMin = t => { const m = Math.max(1, Math.round(t / 60)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
function renderRoutePanel() {
  const P = $('route'); P.classList.remove('hidden'); ui.info.classList.add('hidden'); ui.prof.classList.add('hidden');
  document.querySelectorAll('#rt-seg button').forEach(b => b.classList.toggle('on', +b.dataset.r === route.rank));
  $('rt-down').classList.toggle('on', route.allowDown);
  const sum = $('rt-sum'), list = $('rt-steps');
  list.innerHTML = '';
  if (route.a === null) { sum.innerHTML = '<div class="rt-hint">Tippe auf der Karte, wo du gerade bist.</div>'; return; }
  if (route.b === null) { sum.innerHTML = '<div class="rt-hint">Jetzt tippe das Ziel, z. B. den Treffpunkt mit deinen Freunden.</div>'; return; }
  const res = route.res;
  if (!res) {
    let alt = '';
    for (let rk = route.rank + 1; rk <= 3 && !alt; rk++) { const r2 = dijkstra(route.a, route.b, rk, route.allowDown); if (r2) alt = ` Mit „${rk === 2 ? 'Bis rot' : 'Auch schwarz'}“ geht es in ca. ${fmtMin(r2.time)}.`; }
    sum.innerHTML = `<div class="rt-hint warn">Mit dieser Schwierigkeit habe ich keine Verbindung gefunden.${alt}</div>`; return;
  }
  const st = buildSteps(res);
  const ski = st.filter(s => s.kind === 'run').reduce((a, s) => a + s.d, 0);
  const nl = st.filter(s => s.kind === 'lift').length;
  const maxG = st.filter(s => s.kind === 'run').reduce((a, s) => Math.max(a, s.g), 0);
  sum.innerHTML = `<div class="rt-big">ca. ${fmtMin(res.time)}</div>
    <div class="i-row"><span>${fmtLen(ski)} Piste</span><span>${nl} ${nl === 1 ? 'Lift' : 'Lifte'}</span><span>steilste Stelle <b style="color:${pctCss(maxG)}">${Math.round(maxG)} %</b></span></div>`;
  for (const s of st) {
    const li = document.createElement('li');
    if (s.kind === 'lift') {
      const l = lifts[s.id];
      li.innerHTML = `<span class="ic lift">${liftIcon(l.cls)}</span><div><b>${l.name || LIFT_DE[l.cls]}</b> ${s.up ? 'hoch' : '<span class="dn">talwärts</span>'}<small>${LIFT_DE[l.cls] || ''} · ${fmtMin(s.t)}${s.up ? '' : ' · Talfahrt vorher prüfen'}</small></div>`;
    } else if (s.kind === 'run') {
      const r = runs[s.id], c = '#' + new THREE.Color(diff(r.cls).c).getHexString();
      const title = r.name ? (r.ref ? r.ref + ' · ' : '') + r.name : (r.ref ? 'Piste ' + r.ref : 'Verbindung');
      li.innerHTML = `<span class="ic" style="background:${c}"></span><div><b>${title}</b><small>${diff(r.cls).de} · ${fmtLen(s.d)} · max. <span style="color:${pctCss(s.g)}">${Math.round(s.g)} %</span></small></div>`;
    } else {
      li.innerHTML = s.d > 150 ? `<span class="ic walk">🚶</span><div><b>Zu Fuß zum nächsten Lift</b><small>ca. ${fmtLen(s.d)} · ${fmtMin(s.t)}</small></div>` : `<span class="ic walk">⋯</span><div><b>Kurz queren/schieben</b><small>ca. ${fmtLen(s.d)}</small></div>`;
    }
    list.appendChild(li);
  }
}
function fitRoute(res) {
  renderRoutePanel();
  fitNodes([G.nodes[res.edges[0].from], ...res.edges.map(e => G.nodes[e.to])].filter((_, i, arr) => i % 4 === 0 || i === arr.length - 1));
}
function fitNodes(P) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, hs = 0;
  for (const q of P) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); hs += q.h; }
  const tgt = new THREE.Vector3((x0 + x1) / 2, hs / P.length, (z0 + z1) / 2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  const w = window.innerWidth, h = window.innerHeight;
  const panelTop = $('route').getBoundingClientRect().top, topLim = 100, botLim = panelTop - 20;
  const off = Math.round(Math.max(0, h - panelTop - 90) * 0.5);
  if (off > 0) camera.setViewOffset(w, h, 0, off, w, h);
  let dist = Math.max(x1 - x0, z1 - z0, 1200) * 1.2;
  const v = new THREE.Vector3();
  for (let it = 0; it < 25; it++) {
    camera.position.copy(tgt).addScaledVector(dir, dist); camera.lookAt(tgt); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    let ok = true;
    for (const q of P) { v.set(q.x, q.h, q.z).project(camera); const px = (v.x + 1) / 2 * w, py = (1 - v.y) / 2 * h; if (px < 20 || px > w - 20 || py < topLim || py > botLim || v.z > 1) { ok = false; break; } }
    if (ok) break; dist *= 1.15;
  }
  controls.target.copy(tgt); controls.update();
}
function computeRoute(fit = true) {
  route.res = (route.a !== null && route.b !== null) ? dijkstra(route.a, route.b, route.rank, route.allowDown) : null;
  if (route.res && fit) fitRoute(route.res);
  drawRoute(); renderRoutePanel(); render();
}
function routeTap(x, z) {
  if (tab === 'meet') return meetTap(x, z);
  const id = snap(x, z);
  if (id === null) { $('rt-sum').innerHTML = '<div class="rt-hint warn">Bitte näher an einer Piste oder einem Lift tippen.</div>'; return; }
  if (route.a === null || route.b !== null) { route.a = id; route.b = null; }
  else route.b = id;
  computeRoute();
}
document.querySelectorAll('#rt-seg button').forEach(b => b.onclick = () => { route.rank = +b.dataset.r; computeRoute(); });
$('rt-down').onclick = () => { route.allowDown = !route.allowDown; if (tab === 'meet') computeMeet(false); else computeRoute(); };
$('rt-swap').onclick = () => { [route.a, route.b] = [route.b, route.a]; computeRoute(); };
$('rt-close').onclick = () => { setRouting(false); };
function setRouting(on) {
  routing = on; if (on) { measuring = false; pts = []; rebuildMeasure(); closePanels(); setTab(tab); }
  else { route.a = route.b = null; route.res = null; drawRoute(); meetGroup.visible = false; meetLbls.forEach(L => L.el.classList.add('hidden')); $('route').classList.add('hidden'); }
  updateUi();
}

// ---------- TREFFPUNKT ----------
function sssp(src, maxRank, allowDown) {
  const N = G.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), pe = new Array(N);
  const heap = [[0, src]]; dist[src] = 0;
  const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist[u]) continue;
    for (const e of G.adj[u]) {
      if (e.kind === 'run' && (RANK[runs[e.id].cls] ?? 2) > maxRank) continue;
      if (e.down && !allowDown) continue;
      const nd = d + e.t; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; pe[e.to] = e; push([nd, e.to]); }
    }
  }
  return { src, dist, prev, pe };
}
function pathTo(sp, dst) {
  if (!isFinite(sp.dist[dst])) return null;
  const path = []; for (let v = dst; v !== sp.src; v = sp.prev[v]) path.push({ from: sp.prev[v], to: v, e: sp.pe[v] });
  return { time: sp.dist[dst], edges: path.reverse() };
}
const stationOf = new Map();
lifts.forEach(l => { stationOf.set(l.top, { l, top: true }); stationOf.set(l.bottom, { l, top: false }); });
function placeName(id) {
  const st = stationOf.get(id), n = G.nodes[id];
  if (st) return (st.top ? 'Bergstation ' : 'Talstation ') + (st.l.name || LIFT_DE[st.l.cls] || 'Lift');
  const o = nodeOwner[id];
  if (o && o[0] === 'r') { const r = runs[+o.slice(1)]; const t = r.name ? (r.ref ? r.ref + ' · ' : '') + r.name : (r.ref ? 'Piste ' + r.ref : 'Piste'); return t + ' (' + Math.round(n.h) + ' m)'; }
  return Math.round(n.h) + ' m';
}
const P_COL = ['#7c3aed', '#f97316', '#0891b2', '#db2777'];
const meet = { node: null, people: [{ name: 'Du', rank: 2, node: null }, { name: 'Freund 1', rank: 1, node: null }], target: 'meet', fairMsg: '' };
var tab = 'route';
const meetGroup = new THREE.Group(); scene.add(meetGroup);
const meetLbls = [];
for (let i = 0; i < 5; i++) { addLabel('', 0, 0, 0, 'rt mt'); const L = labels[labels.length - 1]; L.el.style.visibility = 'hidden'; meetLbls.push(L); }
function chainText(res) {
  const out = [];
  for (const s of buildSteps(res)) {
    let t;
    if (s.kind === 'lift') { const l = lifts[s.id]; t = (l.name || LIFT_DE[l.cls]) + (s.up ? ' ↑' : ' ↓'); }
    else if (s.kind === 'run') { const r = runs[s.id]; t = r.ref ? 'Piste ' + r.ref : (r.name || null); }
    else if (s.d > 150) t = 'zu Fuß';
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out.join(' → ');
}
function computeMeet(fit = true) {
  for (const p of meet.people) {
    p.res = null; p.err = false;
    if (p.node !== null && meet.node !== null) {
      p.res = p.node === meet.node ? { time: 0, edges: [] } : pathTo(sssp(p.node, p.rank, route.allowDown), meet.node);
      p.err = !p.res;
    }
  }
  drawMeet(); renderMeetPanel();
  if (fit) { const pts = []; for (const p of meet.people) if (p.res) for (const e of p.res.edges) pts.push(G.nodes[e.to]);
    for (const p of meet.people) if (p.node !== null) pts.push(G.nodes[p.node]); if (meet.node !== null) pts.push(G.nodes[meet.node]);
    if (pts.length > 1) fitNodes(pts.filter((_, i) => i % 3 === 0 || i >= pts.length - 6)); }
  render();
}
function drawMeet() {
  meetGroup.clear(); meetLbls.forEach(L => L.el.style.visibility = 'hidden');
  const s = Math.max(14, camera.position.distanceTo(controls.target) * 0.0028);
  const put = (id, col, L, text, cls) => { const n = G.nodes[id], y = meshHeight(n.x, n.z);
    const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: col })); m.scale.setScalar(s); m.position.set(n.x, y + s * 0.8, n.z); m.renderOrder = 7; meetGroup.add(m);
    L.v.set(n.x, y + s * 2.2, n.z); L.el.textContent = text; L.el.style.visibility = ''; L.el.style.background = typeof col === 'string' ? col : '#0b1a2a'; L.el.style.setProperty('--c', L.el.style.background); };
  meet.people.forEach((p, i) => {
    if (p.res) {
      const ps = [];
      for (const { from, to, e } of p.res.edges) {
        if (e.kind === 'lift') { const l = lifts[e.id]; let P = l.path; if (!e.up !== (P[0].y > P[P.length - 1].y)) P = P.slice().reverse();
          for (let k = 0; k < P.length - 1; k++) ps.push(P[k].x, P[k].y + 4, P[k].z, P[k + 1].x, P[k + 1].y + 4, P[k + 1].z); continue; }
        const a = G.nodes[from], b = G.nodes[to]; ps.push(a.x, meshHeight(a.x, a.z) + 9 + i * 2, a.z, b.x, meshHeight(b.x, b.z) + 9 + i * 2, b.z);
      }
      if (ps.length) {
        const g = new LineSegmentsGeometry(); g.setPositions(ps); const g2 = new LineSegmentsGeometry(); g2.setPositions(ps);
        const halo = new LineSegments2(g2, makeLineMat(11, { color: 0xffffff })); halo.material.depthWrite = false; halo.renderOrder = 4;
        const line = new LineSegments2(g, makeLineMat(5.5, { color: new THREE.Color(P_COL[i]).getHex() })); line.renderOrder = 5 + i;
        meetGroup.add(halo, line);
      }
    }
    if (p.node !== null) put(p.node, P_COL[i], meetLbls[i], p.name);
  });
  if (meet.node !== null) put(meet.node, 0x0b1a2a, meetLbls[4], '📍 Treffpunkt');
  resize();
}
function rankDots(p, i) {
  return [1, 2, 3].map(r => `<button class="rk rk${r}${p.rank === r ? ' on' : ''}" data-i="${i}" data-r="${r}" title="${['', 'nur blau', 'bis rot', 'auch schwarz'][r]}"></button>`).join('');
}
function renderMeetPanel() {
  const P = $('route'); P.classList.remove('hidden'); ui.info.classList.add('hidden'); ui.prof.classList.add('hidden');
  $('rt-down').classList.toggle('on', route.allowDown);
  const tgtName = meet.target === null ? null : meet.target === 'meet' ? 'den Treffpunkt' : 'den Standort von ' + meet.people[meet.target].name;
  $('mt-point').innerHTML = `<div class="mt-pt${meet.target === 'meet' ? ' active' : ''}" data-t="meet"><span class="pin">📍</span><div><b>Treffpunkt</b><small>${meet.node !== null ? placeName(meet.node) : 'noch nicht gesetzt'}</small></div></div>
    <div class="mt-tap">${tgtName ? '👆 Tippe jetzt auf der Karte ' + tgtName : 'Zum Verschieben: Person oder Treffpunkt antippen, dann auf die Karte.'}</div>${meet.fairMsg ? `<div class="mt-fair">${meet.fairMsg}</div>` : ''}`;
  const list = $('mt-list'); list.innerHTML = '';
  meet.people.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'mt-row' + (meet.target === i ? ' active' : ''); row.dataset.t = i;
    let res = '<span class="mut">Standort tippen</span>';
    if (p.node !== null && meet.node === null) res = '<span class="mut">wartet auf Treffpunkt</span>';
    if (p.err) res = '<span class="warn">Mit dieser Schwierigkeit keine Verbindung</span>';
    if (p.res) { const st = buildSteps(p.res); const nl = st.filter(s => s.kind === 'lift').length; const mg = st.filter(s => s.kind === 'run').reduce((a, s) => Math.max(a, s.g), 0);
      res = p.res.time === 0 ? '<b>ist schon da</b>' : `<b>ca. ${fmtMin(p.res.time)}</b> · ${nl} ${nl === 1 ? 'Lift' : 'Lifte'} · steilste <span style="color:${pctCss(mg)}">${Math.round(mg)} %</span><div class="mt-chain">${chainText(p.res)}</div>`; }
    row.innerHTML = `<span class="dot" style="background:${P_COL[i]}"></span><div class="mt-main"><div class="mt-name">${p.name} <small>${['', 'nur blau', 'bis rot', 'auch schwarz'][p.rank]}${p.node !== null ? ' · ' + placeName(p.node) : ''}</small></div><div class="mt-res">${res}</div></div>
      <div class="rks">${rankDots(p, i)}</div>${i > 0 ? `<button class="mt-x" data-i="${i}" aria-label="Entfernen">×</button>` : ''}`;
    list.appendChild(row);
  });
  const done = meet.people.filter(p => p.res);
  $('mt-all').innerHTML = done.length >= 2 && done.length === meet.people.filter(p => p.node !== null).length
    ? `Alle da nach ca. <b>${fmtMin(Math.max(...done.map(p => p.res.time)))}</b>` : '';
  $('mt-add').classList.toggle('hidden', meet.people.length >= 4);
  $('mt-fair').disabled = meet.people.filter(p => p.node !== null).length < 2;
  // handlers
  list.querySelectorAll('.mt-row').forEach(r => r.onclick = ev => { if (ev.target.closest('button')) return; meet.target = +r.dataset.t; renderMeetPanel(); updateUi(); });
  $('mt-point').querySelector('.mt-pt').onclick = () => { meet.target = 'meet'; renderMeetPanel(); updateUi(); };
  list.querySelectorAll('.rk').forEach(b => b.onclick = () => { meet.people[+b.dataset.i].rank = +b.dataset.r; computeMeet(false); });
  list.querySelectorAll('.mt-x').forEach(b => b.onclick = () => { meet.people.splice(+b.dataset.i, 1); meet.target = 'meet'; meet.fairMsg = ''; computeMeet(false); });
}
function nextTarget() {
  if (meet.node === null) return 'meet';
  const i = meet.people.findIndex(p => p.node === null); return i >= 0 ? i : null;
}
function meetTap(x, z) {
  const id = snap(x, z);
  if (id === null) { $('mt-point').querySelector('.mt-tap').textContent = 'Bitte näher an einer Piste oder einem Lift tippen.'; return; }
  if (meet.target === null) return;
  if (meet.target === 'meet') { meet.node = id; meet.fairMsg = ''; } else meet.people[meet.target].node = id;
  meet.target = nextTarget(); computeMeet(); updateUi();
}
function fairMeet() {
  const ps = meet.people.filter(p => p.node !== null); if (ps.length < 2) return;
  const sps = ps.map(p => sssp(p.node, p.rank, route.allowDown));
  let best = null, bt = Infinity, bs = Infinity;
  for (const l of lifts) for (const c of [l.top, l.bottom]) {
    let mx = 0, sum = 0; for (const sp of sps) { const d = sp.dist[c]; mx = Math.max(mx, d); sum += d; }
    if (mx < bt - 30 || (Math.abs(mx - bt) <= 30 && sum < bs)) { bt = mx; bs = sum; best = c; }
  }
  if (best === null || !isFinite(bt)) { meet.fairMsg = 'Keine Liftstation gefunden, die alle mit ihrer Schwierigkeit erreichen.'; renderMeetPanel(); return; }
  meet.node = best; meet.fairMsg = `Fairster Treffpunkt: alle sind spätestens nach ca. ${fmtMin(bt)} dort.`;
  meet.target = nextTarget(); computeMeet();
}
async function copyMeet() {
  const lines = [`Treffpunkt: ${meet.node !== null ? placeName(meet.node) : '–'}`];
  for (const p of meet.people) if (p.res) lines.push(`${p.name}: ca. ${fmtMin(p.res.time)} – ${chainText(p.res) || 'schon da'}`);
  const done = meet.people.filter(p => p.res); if (done.length) lines.push(`Alle da nach ca. ${fmtMin(Math.max(...done.map(p => p.res.time)))}.`);
  const txt = lines.join('\n'), b = $('mt-copy');
  try { await navigator.clipboard.writeText(txt); b.textContent = 'Kopiert ✓'; }
  catch { b.textContent = 'Kopieren nicht erlaubt'; }
  setTimeout(() => b.textContent = 'Text kopieren', 1800);
}
$('mt-add').onclick = () => { const n = meet.people.length; meet.people.push({ name: 'Freund ' + n, rank: 2, node: null }); meet.target = n; renderMeetPanel(); updateUi(); };
$('mt-fair').onclick = fairMeet;
$('mt-copy').onclick = copyMeet;
function setTab(t) {
  tab = t;
  document.querySelectorAll('#rt-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('rt-route-body').classList.toggle('hidden', t !== 'route'); $('rt-meet-body').classList.toggle('hidden', t !== 'meet');
  routeGroup.visible = t === 'route'; meetGroup.visible = t === 'meet';
  startLbl.el.classList.toggle('hidden', t !== 'route'); goalLbl.el.classList.toggle('hidden', t !== 'route');
  meetLbls.forEach(L => L.el.classList.toggle('hidden', t !== 'meet'));
  if (t === 'route') renderRoutePanel(); else renderMeetPanel();
  updateUi(); render();
}
document.querySelectorAll('#rt-tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));

// mode buttons & legend
var terrainSlope = false;
function updateUi() {
  $('btn-pisten').classList.toggle('on', mode === 'pisten' && !measuring);
  $('btn-steil').classList.toggle('on', mode === 'steil' && !measuring);
  $('btn-measure').classList.toggle('on', measuring);
  $('btn-route').classList.toggle('on', routing);
  if (routing) { $('btn-pisten').classList.remove('on'); $('btn-steil').classList.remove('on'); }
  $('btn-undo').classList.toggle('hidden', !measuring || !pts.length);
  $('btn-clear').classList.toggle('hidden', !measuring || !pts.length);
  $('legend').classList.toggle('hidden', routing);
  $('lg-pisten').classList.toggle('hidden', mode !== 'pisten');
  $('lg-steil').classList.toggle('hidden', mode !== 'steil' && !terrainSlope && !measuring);
  $('tg-slope').classList.toggle('on', terrainSlope);
  ui.hint.textContent = measuring
    ? (pts.length === 0 ? 'Tippe den Startpunkt deiner Linie' : 'Weitere Punkte entlang der Linie setzen')
    : routing ? (tab === 'meet' ? '' : route.a === null ? 'Tippe deinen Standort' : route.b === null ? 'Tippe dein Ziel' : 'Neu tippen = neuer Start')
    : 'Tippe auf eine Piste, einen Lift oder ins Gelände';
}
function setMode(m) { mode = m; measuring = false; if (routing) setRouting(false); colorRuns(); updateUi(); }
$('btn-pisten').onclick = () => { setMode('pisten'); };
$('btn-steil').onclick = () => { setMode('steil'); };
$('btn-route').onclick = () => setRouting(!routing);
$('btn-measure').onclick = () => { if (routing) setRouting(false); measuring = !measuring; closePanels(); if (!measuring) { pts = []; rebuildMeasure(); } updateUi(); };
$('btn-undo').onclick = () => { pts.pop(); rebuildMeasure(); updateUi(); };
$('btn-clear').onclick = () => { pts = []; rebuildMeasure(); updateUi(); };
$('tg-slope').onclick = () => { terrainSlope = !terrainSlope; mat.map = terrainSlope ? texSlope : texBase; mat.needsUpdate = true; updateUi(); render(); };
$('btn-reset').onclick = () => { resetView(); render(); };
$('pr-close').onclick = () => { closePanels(); };
updateUi();

// ---------- loop ----------
const tmp = new THREE.Vector3();
var needs = true;
function render() { needs = true; }
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  for (const m of lineMats) m.resolution.set(w, h);
  render();
}
window.addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
var last = 0;
function loop() {
  requestAnimationFrame(loop);
  const moving = controls.update();
  const t = clock.getElapsedTime();
  if (!needs && !moving && t - last < 1 / 30) return;
  last = t; needs = false;
  { // keep the 3D focus above whatever bottom panel is open
    let ph = 0; for (const id of ['route', 'profile', 'info']) { const el = $(id); if (!el.classList.contains('hidden')) ph = Math.max(ph, window.innerHeight - el.getBoundingClientRect().top - 90); }
    const w = window.innerWidth, h = window.innerHeight, off = Math.round(ph * 0.5);
    if (camera.view?.offsetY !== off) { if (off > 0) camera.setViewOffset(w, h, 0, off, w, h); else camera.clearViewOffset(); }
  }
  const dist = camera.position.distanceTo(controls.target);
  updateCabins(t, dist);
  renderer.render(scene, camera);
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of labels) {
    tmp.copy(l.v).project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05 && (l.el.classList.contains('town') || l.el.classList.contains('rt') || dist < 9000);
    l.el.style.display = vis ? '' : 'none';
    if (vis) l.el.style.transform = `translate(${(tmp.x + 1) / 2 * w}px, ${(1 - tmp.y) / 2 * h}px) translate(-50%,-100%)`;
  }
  const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  $('compass-needle').style.transform = `rotate(${az * 180 / Math.PI}deg)`;
}
loop();

window.__app = { camera, runs, lifts, showRun, showLift, setMode, G, route, computeRoute, setRouting, buildSteps, meet, computeMeet, setTab, fairMeet, placeName };

}
