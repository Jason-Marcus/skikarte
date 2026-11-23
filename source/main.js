import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
// lighting for 3D objects (sun from north-west like the baked hillshade)
scene.add(new THREE.HemisphereLight(0xe8f1fb, 0x5a6672, 1.6));
{ const sun = new THREE.DirectionalLight(0xfff6e8, 2.0); const a = 315 * Math.PI / 180, el = 38 * Math.PI / 180; sun.position.set(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)); scene.add(sun); }
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
const runLines = new LineSegments2(runGeo, makeLineMat(2.6));
runLines.renderOrder = 2;
// groomed piste bands: white centre, difficulty-coloured edges, draped on the terrain
const RIB_W = 15, RIB_EDGE = 3.2;
const ribPos = [], ribIdx = [], ribOwner = [];
runs.forEach((r, ri) => {
  const s0 = r.s; if (s0.length < 2) return;
  const base = ribPos.length / 3;
  for (let i = 0; i < s0.length; i++) {
    const a = s0[Math.max(0, i - 1)], b = s0[Math.min(s0.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;
    for (const o of [-RIB_W, -RIB_W + RIB_EDGE, RIB_W - RIB_EDGE, RIB_W]) { const x = s0[i].x + nx * o, z = s0[i].z + nz * o; ribPos.push(x, meshHeight(x, z) + 1.6, z); ribOwner.push(ri, i); }
  }
  for (let i = 0; i < s0.length - 1; i++) for (let c = 0; c < 3; c++) { const a = base + i * 4 + c, b = a + 1, d = a + 4, e = d + 1; ribIdx.push(a, d, b, b, d, e); }
});
const ribGeo = new THREE.BufferGeometry();
ribGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribPos, 3));
ribGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ribPos.length), 3));
ribGeo.setIndex(ribIdx);
const ribMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
const ribbons = new THREE.Mesh(ribGeo, ribMat); ribbons.renderOrder = 1;
scene.add(ribbons, runLines);
var mode = 'pisten';
function colorRuns() {
  const col = [];
  for (const [ri, i] of runIdx) {
    const r = runs[ri];
    const ca = mode === 'pisten' ? new THREE.Color(diff(r.cls).c) : pctColor(r.s[i].g);
    const cb = mode === 'pisten' ? ca : pctColor(r.s[i + 1].g);
    col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
  }
  runGeo.setColors(col);
  const rc = ribGeo.attributes.color.array, groom = new THREE.Color(0xf7f9fc);
  for (let v = 0; v < ribOwner.length / 2; v++) {
    const ri = ribOwner[v * 2], i = ribOwner[v * 2 + 1], edge = (v % 4 === 0 || v % 4 === 3);
    const c = !edge ? groom : mode === 'pisten' ? new THREE.Color(diff(runs[ri].cls).c) : pctColor(runs[ri].s[i].g);
    rc[v * 3] = c.r; rc[v * 3 + 1] = c.g; rc[v * 3 + 2] = c.b;
  }
  ribGeo.attributes.color.needsUpdate = true; render();
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
const DRAG = new Set(['t-bar', 'j-bar', 'platter', 'rope_tow']);
const pylonM4 = [], stationM4 = [], hutM4 = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
for (const l of lifts) {
  const aerial = AERIAL.has(l.cls), drag = DRAG.has(l.cls), carpet = l.cls === 'magic_carpet';
  const CAB_H = l.cls === 'cable_car' ? 22 : l.cls === 'gondola' || l.cls === 'mixed_lift' ? 16 : 12;
  const clear = aerial ? CAB_H : drag ? 6 : 0.8;
  // OSM nodes: first/last = stations, inner nodes = pylons
  let nodes = l.xz.map(([x, z], i) => ({ x, z, g: meshHeight(x, z), end: i === 0 || i === l.xz.length - 1 }));
  if (aerial && nodes.length === 2) { // no pylons mapped: put one every ~220 m
    const [A, B] = nodes, L = Math.hypot(B.x - A.x, B.z - A.z), n = Math.floor(L / 220);
    const mid = []; for (let k = 1; k <= n; k++) { const t = k / (n + 1), x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t; mid.push({ x, z, g: meshHeight(x, z), end: false }); }
    nodes = [A, ...mid, B];
  }
  for (const nd of nodes) nd.y = nd.g + (nd.end ? (aerial ? 9 : drag ? 5 : 0.8) : clear);
  const path = []; let d = 0;
  for (let k = 0; k < nodes.length - 1; k++) {
    const a = nodes[k], b = nodes[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 25));
    for (let s = (k === 0 ? 0 : 1); s <= n; s++) { const t = s / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const sag = aerial ? Math.sin(t * Math.PI) * Math.min(18, L * 0.025) : 0;
      const y = Math.max(a.y + (b.y - a.y) * t - sag, meshHeight(x, z) + (aerial ? 7 : drag ? 3 : 0.8)); path.push({ x, y, z, d: d + L * t }); }
    d += L;
  }
  l.path = path; l.len = d;
  l.h0 = heightAt(nodes[0].x, nodes[0].z); l.h1 = heightAt(nodes[nodes.length - 1].x, nodes[nodes.length - 1].z);
  l.gauge = aerial ? (l.cls === 'cable_car' ? 5.5 : l.cls === 'chair_lift' ? 3.2 : 3.6) : drag ? 1.8 : 0;
  if (!carpet) for (const side of (aerial || drag ? [-1, 1] : [0])) for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ox = (b.z - a.z) / L * l.gauge * side, oz = -(b.x - a.x) / L * l.gauge * side;
    cablePos.push(a.x + ox, a.y, a.z + oz, b.x + ox, b.y, b.z + oz);
  }
  // pylons
  for (let k = 1; k < nodes.length - 1; k++) {
    const nd = nodes[k], a = nodes[k - 1], b = nodes[k + 1], ang = Math.atan2(b.x - a.x, b.z - a.z), hgt = nd.y - nd.g;
    _q.setFromAxisAngle(_up, ang); _m.compose(_v.set(nd.x, nd.g, nd.z), _q, _s.set(aerial || drag ? l.gauge / 3.6 : 0.6, hgt, aerial ? 1 : 0.6)); pylonM4.push(_m.clone());
  }
  // stations
  const A = nodes[0], B = nodes[1], Z = nodes[nodes.length - 1], Y = nodes[nodes.length - 2];
  for (const [p, q] of [[A, B], [Z, Y]]) {
    const ang = Math.atan2(q.x - p.x, q.z - p.z); _q.setFromAxisAngle(_up, ang);
    if (aerial) { const sc = l.cls === 'chair_lift' ? [16, 9, 26] : l.cls === 'cable_car' ? [26, 16, 34] : [22, 12, 32]; _m.compose(_v.set(p.x, p.g - 2, p.z), _q, _s.set(...sc)); stationM4.push(_m.clone()); }
    else if (!carpet) { _m.compose(_v.set(p.x, p.g - 1, p.z), _q, _s.set(5, 4, 6)); hutM4.push(_m.clone()); }
  }
  if (aerial || (drag && l.cls !== 'rope_tow')) anim.push(l);
}
const cableGeo = new LineSegmentsGeometry(); cableGeo.setPositions(cablePos);
const cables = new LineSegments2(cableGeo, makeLineMat(1.8, { color: 0x2b2f36 })); cables.renderOrder = 3; liftGroup.add(cables);
// geometry helpers (unit-sized parts with vertex colours)
function part(g, color, tx = 0, ty = 0, tz = 0) { g.translate(tx, ty, tz); const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.index ? g.toNonIndexed() : g; }
const objMat = new THREE.MeshLambertMaterial({ vertexColors: true });
function instanced(geo, list) { if (!list.length) return null; const im = new THREE.InstancedMesh(geo, objMat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.computeBoundingSphere(); liftGroup.add(im); return im; }
// pylon: lattice-like mast (scaled to height) + cross arm
const pylonGeo = mergeGeometries([part(new THREE.BoxGeometry(1.6, 1, 1.6), 0x8b96a3, 0, 0.5, 0), part(new THREE.BoxGeometry(9, 0.05, 0.6), 0x6d7884, 0, 0.985, 0), part(new THREE.BoxGeometry(0.5, 0.06, 0.5), 0x4a525c, -3.8, 0.96, 0), part(new THREE.BoxGeometry(0.5, 0.06, 0.5), 0x4a525c, 3.8, 0.96, 0)]);
instanced(pylonGeo, pylonM4);
// station: building with gabled roof (unit size, scaled per type)
const roof = new THREE.CylinderGeometry(0.62, 0.62, 1.04, 3, 1); roof.rotateZ(Math.PI / 2); roof.rotateY(Math.PI / 2); roof.scale(1, 0.55, 1);
const stationGeo = mergeGeometries([part(new THREE.BoxGeometry(1, 0.7, 1), 0xdfe3e8, 0, 0.35, 0), part(new THREE.BoxGeometry(1.02, 0.18, 0.12), 0x34414f, 0, 0.45, 0.5), part(roof, 0x9c3b2e, 0, 0.82, 0)]);
instanced(stationGeo, stationM4);
instanced(mergeGeometries([part(new THREE.BoxGeometry(1, 0.8, 1), 0xc9a27a, 0, 0.4, 0), part(roof.clone(), 0x6b4a36, 0, 0.95, 0)]), hutM4);
// cabins per lift type (unit size ≈ 1 m, scaled with zoom)
const CAB = {
  gondola: { sp: 6, gap: 110, geo: mergeGeometries([part(new THREE.BoxGeometry(2.0, 2.0, 2.2), 0xd8322b, 0, -2.6, 0), part(new THREE.BoxGeometry(2.05, 0.7, 2.25), 0x23303d, 0, -2.2, 0), part(new THREE.BoxGeometry(1.4, 0.25, 1.4), 0x9aa4ae, 0, -1.45, 0), part(new THREE.BoxGeometry(0.15, 1.4, 0.15), 0x4a525c, 0, -0.7, 0)]) },
  chair_lift: { sp: 5, gap: 45, geo: mergeGeometries([part(new THREE.BoxGeometry(3.2, 0.25, 1.0), 0x2c3e57, 0, -2.6, 0.2), part(new THREE.BoxGeometry(3.2, 1.0, 0.2), 0x2c3e57, 0, -2.1, -0.3), part(new THREE.BoxGeometry(3.2, 0.12, 0.12), 0xf2a33a, 0, -1.7, 0.75), part(new THREE.BoxGeometry(0.15, 2.4, 0.15), 0x4a525c, 0, -1.2, -0.3)]) },
  cable_car: { sp: 10, gap: 0, geo: mergeGeometries([part(new THREE.BoxGeometry(4.2, 3.0, 5.6), 0xe8b52e, 0, -4.4, 0), part(new THREE.BoxGeometry(4.25, 1.0, 5.65), 0x23303d, 0, -3.9, 0), part(new THREE.BoxGeometry(1.8, 1.2, 3.0), 0x7d8792, 0, -2.0, 0), part(new THREE.BoxGeometry(0.2, 1.6, 0.2), 0x4a525c, 0, -0.8, 0)]) },
  drag: { sp: 3, gap: 14, geo: mergeGeometries([part(new THREE.BoxGeometry(0.08, 2.6, 0.08), 0x59626c, 0, -1.3, 0), part(new THREE.BoxGeometry(1.1, 0.12, 0.12), 0xf2a33a, 0, -2.6, 0)]) },
};
CAB.mixed_lift = CAB.gondola;
const cabKey = l => DRAG.has(l.cls) ? 'drag' : l.cls === 'mixed_lift' ? 'gondola' : l.cls;
const cabinSlots = [];
for (const l of anim) {
  const key = cabKey(l), c = CAB[key];
  if (l.cls === 'cable_car') { cabinSlots.push({ l, c, key, shuttle: 0 }, { l, c, key, shuttle: 1 }); continue; }
  const n = Math.max(2, Math.floor(l.len / c.gap));
  for (let i = 0; i < n; i++) { cabinSlots.push({ l, c, key, off: i / n, dir: 0 }, { l, c, key, off: (i + 0.5) / n, dir: 1 }); }
}
const cabMeshes = {};
for (const key of ['gondola', 'chair_lift', 'cable_car', 'drag']) {
  const cnt = cabinSlots.filter(s => s.key === key).length; if (!cnt) continue;
  const im = new THREE.InstancedMesh(CAB[key].geo, objMat, cnt);
  im.frustumCulled = false; liftGroup.add(im); cabMeshes[key] = { im, n: 0 };
}
function pathAt(l, d) {
  const P = l.path; d = Math.max(0, Math.min(l.len, d));
  let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].d <= d) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, b.x - a.x, b.z - a.z];
}
const TIME_X = 3;
function updateCabins(t, camDist) {
  const k = THREE.MathUtils.clamp(camDist * 0.0009, 1.4, 16);
  for (const key in cabMeshes) cabMeshes[key].n = 0;
  for (const s of cabinSlots) {
    const l = s.l, c = s.c, cm = cabMeshes[s.key];
    let d, side;
    if (s.shuttle !== undefined) { const T = l.len / c.sp, ph = (t * TIME_X / T) % 2; const f = ph < 1 ? ph : 2 - ph; d = (s.shuttle ? 1 - f : f) * l.len; side = s.shuttle ? 1 : -1; }   // the two cabins always travel in opposite directions
    else { const f = ((s.off + t * TIME_X * c.sp / l.len) % 1); d = s.dir ? (1 - f) * l.len : f * l.len; side = s.dir ? 1 : -1; }
    const [x, y, z, dx, dz] = pathAt(l, d);
    const ang = Math.atan2(dx, dz), off = side * l.gauge;
    _v.set(x + Math.cos(ang) * off, y, z - Math.sin(ang) * off);
    _q.setFromAxisAngle(_up, ang + (s.dir && s.shuttle === undefined ? Math.PI : 0)); _s.set(k, k, k);
    _m.compose(_v, _q, _s); cm.im.setMatrixAt(cm.n++, _m);
  }
  for (const key in cabMeshes) cabMeshes[key].im.instanceMatrix.needsUpdate = true;
}

// ---------- trees ----------
const FOREST = window.__FOREST;
const treeGroup = new THREE.Group(); scene.add(treeGroup);
{
  const fAt = (x, z) => { const i = Math.round((x + W / 2) / R), j = Math.round((z + H / 2) / R); return (i < 0 || j < 0 || i >= NX || j >= NY) ? 0 : FOREST[j * NX + i] / 255; };
  // keep pistes and lift lines free of trees
  const CL = 30, clearGrid = new Set(), ck = (x, z) => Math.floor(x / CL) + ',' + Math.floor(z / CL);
  for (const r of runs) for (const q of r.s) for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) clearGrid.add(ck(q.x + dx * 14, q.z + dz * 14));
  for (const l of lifts) for (const q of l.path) clearGrid.add(ck(q.x, q.z));
  const blocked = (x, z) => clearGrid.has(ck(x, z));
  const TARGET = 42000;
  let forestCells = 0; for (let k = 0; k < FOREST.length; k += 4) if (FOREST[k] > 60) forestCells++;
  const forestArea = forestCells * 4 * R * R;
  const cell = Math.max(14, Math.sqrt(forestArea / TARGET));
  const rnd = (i, j, s) => { let h = (i * 73856093 ^ j * 19349663 ^ s * 83492791) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return (h >>> 0) / 4294967296; };
  const CH = 1500, chunks = new Map();
  const nI = Math.floor(W / cell), nJ = Math.floor(H / cell);
  for (let j = 0; j < nJ; j++) for (let i = 0; i < nI; i++) {
    const x = -W / 2 + (i + rnd(i, j, 1)) * cell, z = -H / 2 + (j + rnd(i, j, 2)) * cell;
    const f = fAt(x, z); if (f < 0.12 || rnd(i, j, 3) > f * 1.25) continue;
    if (blocked(x, z)) continue;
    const key = Math.floor((x + W / 2) / CH) + ',' + Math.floor((z + H / 2) / CH);
    if (!chunks.has(key)) chunks.set(key, []);
    const sc = (0.85 + rnd(i, j, 4) * 0.6) * THREE.MathUtils.clamp(cell / 30, 1, 1.6);
    _m.compose(_v.set(x, meshHeight(x, z) - 0.5, z), _q.setFromAxisAngle(_up, rnd(i, j, 5) * 6.28), _s.set(sc, sc * (0.9 + rnd(i, j, 6) * 0.3), sc));
    chunks.get(key).push(_m.clone());
  }
  // low-poly snowy spruce, ~20 m (slightly exaggerated so it reads on a phone)
  const treeGeo = mergeGeometries([
    part(new THREE.CylinderGeometry(0.5, 0.7, 4, 5), 0x5b4334, 0, 2, 0),
    part(new THREE.ConeGeometry(5.2, 9, 6), 0x2f5a46, 0, 7.5, 0),
    part(new THREE.ConeGeometry(4.0, 7.5, 6), 0x376851, 0, 12, 0),
    part(new THREE.ConeGeometry(2.6, 5.5, 6), 0x3f7559, 0, 16, 0),
    part(new THREE.ConeGeometry(1.2, 2.4, 6), 0xf2f5f8, 0, 18.6, 0),
  ]);
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const list of chunks.values()) { const im = new THREE.InstancedMesh(treeGeo, treeMat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.computeBoundingSphere(); treeGroup.add(im); }
}
function updateTrees() { // only draw tree chunks near the camera (saves battery)
  const lim = 9000; for (const im of treeGroup.children) { const c = im.boundingSphere.center; im.visible = camera.position.distanceTo(c) < lim + im.boundingSphere.radius; }
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
  if (showHuts) for (const h of huts) { const dd = Math.hypot(h.x - x, h.z - z) * 0.7; if (dd < bd) { bd = dd; best = { hut: h }; } }
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
  if (n?.hut) { showHut(n.hut); }
  else if (n?.run) { pinGroup.clear(); showRun(n.run); }
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

function snap(x, z, rr) {
  const r = rr || Math.max(120, camera.position.distanceTo(controls.target) * 0.025);
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
  res.edges.forEach(({ e }, ei) => {
    let key;
    if (e.kind === 'lift') { key = 'l' + e.id + (e.up ? 'u' : 'd'); }
    else if (e.kind === 'run') { const r = runs[e.id]; key = r.key ? 'r' + r.key : 'u' + r.cls; }
    else key = 'walk';
    const last = steps[steps.length - 1];
    if (last && last.key === key) { last.d += e.d; last.t += e.t; last.g = Math.max(last.g, e.g || 0); last.i1 = ei; return; }
    if (e.kind === 'walk' && last && e.d < 60) { last.t += e.t; last.i1 = ei; return; }
    steps.push({ key, kind: e.kind, id: e.id, up: e.up, d: e.d, t: e.t, g: e.g || 0, i0: ei, i1: ei });
  });
  const out = []; let carry = null;
  for (const st of steps) {
    if (st.kind === 'walk' && st.d < 25) { if (out.length) { out[out.length - 1].i1 = st.i1; out[out.length - 1].t += st.t; } else carry = st; continue; }
    if (carry) { st.i0 = carry.i0; st.t += carry.t; carry = null; }
    out.push(st);
  }
  if (carry && !out.length) out.push(carry);
  return out;
}
const fmtMin = t => { const m = Math.max(1, Math.round(t / 60)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
function renderRoutePanel() {
  const P = $('route'); P.classList.remove('hidden'); ui.info.classList.add('hidden'); ui.prof.classList.add('hidden');
  document.querySelectorAll('#rt-seg button').forEach(b => b.classList.toggle('on', +b.dataset.r === route.rank));
  $('rt-down').classList.toggle('on', route.allowDown);
  const sum = $('rt-sum'), list = $('rt-steps');
  list.innerHTML = ''; $('rt-navrow').classList.add('hidden');
  if (route.a === null) { sum.innerHTML = '<div class="rt-hint">Tippe auf der Karte, wo du gerade bist.</div>'; return; }
  if (route.b === null) { sum.innerHTML = '<div class="rt-hint">Jetzt tippe das Ziel, z. B. den Treffpunkt mit deinen Freunden.</div>'; return; }
  const res = route.res;
  if (!res) {
    let alt = '';
    for (let rk = route.rank + 1; rk <= 3 && !alt; rk++) { const r2 = dijkstra(route.a, route.b, rk, route.allowDown); if (r2) alt = ` Mit „${rk === 2 ? 'Bis rot' : 'Auch schwarz'}“ geht es in ca. ${fmtMin(r2.time)}.`; }
    sum.innerHTML = `<div class="rt-hint warn">Mit dieser Schwierigkeit habe ich keine Verbindung gefunden.${alt}</div>`; return;
  }
  $('rt-navrow').classList.remove('hidden');
  const st = buildSteps(res);
  const ski = st.filter(s => s.kind === 'run').reduce((a, s) => a + s.d, 0);
  const nl = st.filter(s => s.kind === 'lift').length;
  const maxG = st.filter(s => s.kind === 'run').reduce((a, s) => Math.max(a, s.g), 0);
  sum.innerHTML = `<div class="rt-big">ca. ${fmtMin(res.time)}</div>
    <div class="i-row"><span>${fmtLen(ski)} Piste</span><span>${nl} ${nl === 1 ? 'Lift' : 'Lifte'}</span><span>steilste Stelle <b style="color:${pctCss(maxG)}">${Math.round(maxG)} %</b></span></div>`;
  for (const s of st) {
    const li = document.createElement('li'); li.onclick = () => focusStep(res, s, li);
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
function fitNodes(P, animate = true) {
  const startPos = camera.position.clone(), startTgt = controls.target.clone();
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
  if (!animate) { controls.target.copy(tgt); controls.update(); return; }
  const endPos = camera.position.clone();
  camera.position.copy(startPos); camera.lookAt(startTgt); controls.target.copy(startTgt);
  startTween(endPos, tgt);
}
var tween = null;
function startTween(pos, tgt, dur = 900) { tween = { t0: performance.now(), dur, p0: camera.position.clone(), q0: controls.target.clone(), p1: pos.clone(), q1: tgt.clone() }; render(); }
function stepTween() {
  if (!tween) return false;
  let t = Math.min(1, (performance.now() - tween.t0) / tween.dur); const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.q0, tween.q1, e); camera.lookAt(controls.target);
  if (t >= 1) { tween = null; controls.update(); }
  return true;
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
  if (route.a === null && route.b !== null) route.a = id;
  else if (route.a === null || route.b !== null) { route.a = id; route.b = null; }
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
  const hu = hutAtNode.get(id); if (hu) return (HUT_IC[hu.type] || '🍴') + ' ' + (hu.name || HUT_DE[hu.type] || 'Hütte');
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
  $('mt-time').value = meet.time || '';
  $('mt-point').innerHTML = `${meet.shared ? `<div class="mt-shared">📨 Geteilter Treffpunkt${meet.shared.p ? ': ' + esc(meet.shared.p) : ''}${meet.time ? ' · <b>' + esc(meet.time) + ' Uhr</b>' : ''}</div>` : ''}<div class="mt-pt${meet.target === 'meet' ? ' active' : ''}" data-t="meet"><span class="pin">📍</span><div><b>Treffpunkt</b><small>${meet.node !== null ? esc(placeName(meet.node)) : 'noch nicht gesetzt'}</small></div></div>
    <div class="mt-tap">${tgtName ? '👆 Tippe jetzt auf der Karte ' + tgtName : 'Zum Verschieben: Person oder Treffpunkt antippen, dann auf die Karte.'}</div>${meet.fairMsg ? `<div class="mt-fair">${meet.fairMsg}</div>` : ''}`;
  const list = $('mt-list'); list.innerHTML = '';
  meet.people.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'mt-row' + (meet.target === i ? ' active' : ''); row.dataset.t = i;
    let res = '<span class="mut">Standort tippen</span>';
    if (p.node !== null && meet.node === null) res = '<span class="mut">wartet auf Treffpunkt</span>';
    if (p.err) res = '<span class="warn">Mit dieser Schwierigkeit keine Verbindung</span>';
    if (p.res) { const st = buildSteps(p.res); const nl = st.filter(s => s.kind === 'lift').length; const mg = st.filter(s => s.kind === 'run').reduce((a, s) => Math.max(a, s.g), 0);
      let leave = '';
      if (meet.time && /^\d{1,2}:\d{2}$/.test(meet.time) && p.res.time > 0) { const [hh, mm] = meet.time.split(':').map(Number); const t = new Date(); t.setHours(hh, mm, 0, 0); t.setMinutes(t.getMinutes() - Math.ceil(p.res.time / 60) - 5); leave = ` · <b class="leave">losfahren bis ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</b>`; }
      res = p.res.time === 0 ? '<b>ist schon da</b>' : `<b>ca. ${fmtMin(p.res.time)}</b>${leave} · ${nl} ${nl === 1 ? 'Lift' : 'Lifte'} · steilste <span style="color:${pctCss(mg)}">${Math.round(mg)} %</span><div class="mt-chain">${chainText(p.res)}</div>`; }
    row.innerHTML = `<span class="dot" style="background:${P_COL[i]}"></span><div class="mt-main"><div class="mt-name">${p.name} <small>${['', 'nur blau', 'bis rot', 'auch schwarz'][p.rank]}${p.node !== null ? ' · ' + placeName(p.node) : ''}</small></div><div class="mt-res">${res}</div></div>
      <div class="rks">${i === 0 ? '<button class="mt-me" title="Mein Standort">📍</button>' : ''}${rankDots(p, i)}</div>${i > 0 ? `<button class="mt-x" data-i="${i}" aria-label="Entfernen">×</button>` : ''}`;
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
  list.querySelectorAll('.mt-me').forEach(b => b.onclick = () => { if (!gps.xz) { startGps(false); window.__toast && window.__toast('Suche deinen Standort … danach nochmal tippen.'); return; } const a = meNode(); if (a !== null) { meet.people[0].node = a; meet.target = nextTarget(); computeMeet(); } });
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
  const cands = []; for (const l of lifts) cands.push([l.top, 0], [l.bottom, 0]); for (const h of huts) cands.push([h.node, -90]);   // huts: up to 1.5 min bonus
  for (const [c, bonus] of cands) {
    let mx = bonus, sum = 0; for (const sp of sps) { const d = sp.dist[c]; mx = Math.max(mx, d + bonus); sum += d; }
    if (mx < bt - 30 || (Math.abs(mx - bt) <= 30 && sum < bs)) { bt = mx; bs = sum; best = c; }
  }
  if (best === null || !isFinite(bt)) { meet.fairMsg = 'Keine Liftstation gefunden, die alle mit ihrer Schwierigkeit erreichen.'; renderMeetPanel(); return; }
  meet.node = best; meet.fairMsg = `Fairster Treffpunkt: alle sind spätestens nach ca. ${fmtMin(bt + (hutAtNode.has(best) ? 90 : 0))} dort.`;
  meet.target = nextTarget(); computeMeet();
}
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xzToLonLat = (x, z) => [M.B.w + (x + W / 2) / M.mlon, M.B.n - (z + H / 2) / M.mlat];
// ---- share the meeting point as a link ----
function meetLink() {
  const n = G.nodes[meet.node], hu = hutAtNode.get(meet.node);
  const [lon, lat] = hu ? [hu.lon, hu.lat] : xzToLonLat(n.x, n.z);
  const area = window.__AREA || {};
  const q = new URLSearchParams({ g: area.id || '', lat: lat.toFixed(5), lon: lon.toFixed(5), p: placeName(meet.node).replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '').slice(0, 60) });
  if (meet.time) q.set('t', meet.time);
  const base = location.protocol === 'https:' ? location.origin + location.pathname : 'https://jason-marcus.github.io/skikarte/';
  return base + '?' + q.toString();
}
async function shareMeet() {
  if (meet.node === null) { window.__toast && window.__toast('Erst einen Treffpunkt setzen.'); return; }
  const area = window.__AREA || {}, place = placeName(meet.node);
  const url = meetLink();
  const text = `⛷ Treffpunkt: ${place}${meet.time ? ' um ' + meet.time + ' Uhr' : ''} (${area.name || 'Skigebiet'}). Öffne den Link – die App zeigt dir deinen Weg dorthin:`;
  const b = $('mt-share');
  try {
    if (navigator.share) { await navigator.share({ title: 'Treffpunkt', text, url }); return; }
    await navigator.clipboard.writeText(text + '\n' + url); b.textContent = 'Link kopiert ✓';
  } catch (e) {
    if (e && e.name === 'AbortError') return;      // user closed the share sheet
    $('mt-linkbox').classList.remove('hidden'); $('mt-linkbox').value = text + '\n' + url; $('mt-linkbox').select(); b.textContent = 'Link unten kopieren';
  }
  setTimeout(() => b.textContent = 'Treffpunkt teilen', 2200);
}
// ---- receiving a shared meeting point ----
function applySharedMeet(sh) {
  const [x, z] = toXZ(sh.lon, sh.lat);
  const node = inside(x, z) ? snap(x, z, 400) : null;
  if (node === null) { window.__toast && window.__toast('Der geteilte Treffpunkt liegt nicht in diesem Skigebiet.'); return; }
  setRouting(true); setTab('meet');
  meet.node = node; meet.time = sh.t || ''; meet.people = [{ name: 'Du', rank: 2, node: null }];
  meet.shared = sh; meet.fairMsg = ''; meet.target = 0;
  computeMeet(false); updateUi();
  flyTo(x, z, 2600);
  // find my own position automatically
  startGps(false);
  const wait = setInterval(() => {
    if (gps.xz) { clearInterval(wait); const a = meNode(); if (a !== null && meet.people[0].node === null) { meet.people[0].node = a; meet.target = null; computeMeet(); } }
  }, 800);
  setTimeout(() => clearInterval(wait), 45000);
}
$('mt-add').onclick = () => { const n = meet.people.length; meet.people.push({ name: 'Freund ' + n, rank: 2, node: null }); meet.target = n; renderMeetPanel(); updateUi(); };
$('mt-fair').onclick = fairMeet;
$('mt-share').onclick = shareMeet;
$('mt-time').onchange = () => { meet.time = $('mt-time').value; renderMeetPanel(); };
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

// ---------- PISTE NUMBERS ON THE MAP ----------
const badgeGroup = new THREE.Group(); scene.add(badgeGroup);
{
  const groups = new Map();
  for (const r of runs) { if (!r.ref && !r.name) continue; const k = r.key; if (!groups.has(k) || groups.get(k).len < r.len) groups.set(k, r); }
  const texCache = new Map();
  for (const r of groups.values()) {
    const label = r.ref || (r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name);
    const col = '#' + new THREE.Color(diff(r.cls).c).getHexString(), key = label + col;
    if (!texCache.has(key)) {
      const c = document.createElement('canvas'), fs = 44, ctx = c.getContext('2d'); ctx.font = `700 ${fs}px system-ui, sans-serif`;
      const tw = Math.ceil(ctx.measureText(label).width), w = Math.max(fs * 1.5, tw + fs * 0.9), h = fs * 1.5;
      c.width = w + 8; c.height = h + 8; ctx.font = `700 ${fs}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(2, 2, w + 4, h + 4, h / 2 + 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(6, 6, w - 4, h - 4, h / 2 - 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, c.width / 2, c.height / 2 + 2);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache.set(key, { t, a: c.width / c.height });
    }
    const { t, a } = texCache.get(key), q = r.s[Math.floor(r.s.length / 2)];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthWrite: false, depthTest: false, transparent: true }));
    sp.position.set(q.x, meshHeight(q.x, q.z) + 18, q.z); sp.scale.set(0.034 * a, 0.034, 1); sp.renderOrder = 10;
    sp.userData = { run: r, a, prio: (r.ref ? 2e6 : 0) + r.len };
    badgeGroup.add(sp);
  }
}
var badgeT = 0, badgeCam = new THREE.Vector3(), badgeTgt = new THREE.Vector3();
const _bp = new THREE.Vector3();
function occluded(p) { // is the terrain between camera and point p?
  const c = camera.position;
  for (let i = 1; i < 24; i++) { const t = i / 24, x = c.x + (p.x - c.x) * t, y = c.y + (p.y - c.y) * t, z = c.z + (p.z - c.z) * t; if (inside(x, z) && y < meshHeight(x, z) - 3) return true; }
  return false;
}
function updateBadges(dist) {
  const show = !nav.active && dist < 9000; badgeGroup.visible = show; if (!show) return;
  const now = performance.now();
  if (now - badgeT < 160 && badgeCam.distanceTo(camera.position) < 1 && badgeTgt.distanceTo(controls.target) < 1) return;
  badgeT = now; badgeCam.copy(camera.position); badgeTgt.copy(controls.target);
  const W2 = window.innerWidth, H2 = window.innerHeight, unit = H2 / (2 * Math.tan(camera.fov * Math.PI / 360));
  const lim = Math.max(2500, dist * 1.7), cand = [];
  for (const sp of badgeGroup.children) {
    sp.visible = false; if (sp.userData.hut && !showHuts) continue;
    const d = camera.position.distanceTo(sp.position); if (d > lim) continue;
    _bp.copy(sp.position).project(camera); if (_bp.z > 1 || Math.abs(_bp.x) > 1.1 || Math.abs(_bp.y) > 1.1) continue;
    const k = THREE.MathUtils.clamp(2600 / d, 0.62, 1.12), hgt = (sp.userData.hut ? 0.027 : 0.034) * k;      // smaller when far away
    sp.scale.set(hgt * sp.userData.a, hgt, 1);
    const hp = hgt * unit, wp = hp * sp.userData.a, cx = (_bp.x + 1) / 2 * W2, cy = (1 - _bp.y) / 2 * H2;
    cand.push({ sp, d, r: [cx - wp / 2 - 3, cy - hp / 2 - 3, cx + wp / 2 + 3, cy + hp / 2 + 3], prio: sp.userData.prio - d * 50 });
  }
  cand.sort((x, y) => y.prio - x.prio);
  const taken = [];
  for (const l of labels) { // lift name tags (HTML) win over piste numbers
    if (!l.el.classList.contains('lift') || l.el.style.display === 'none' || !l.el.offsetWidth) continue;
    _bp.copy(l.v).project(camera); if (_bp.z > 1) continue;
    const cx = (_bp.x + 1) / 2 * W2, cy = (1 - _bp.y) / 2 * H2, w = l.el.offsetWidth, h = l.el.offsetHeight;
    taken.push([cx - w / 2 - 2, cy - h - 6, cx + w / 2 + 2, cy + 2]);
  }
  for (const c of cand) {
    if (taken.some(t => c.r[0] < t[2] && c.r[2] > t[0] && c.r[1] < t[3] && c.r[3] > t[1])) continue;   // overlaps a more important label
    if (occluded(c.sp.position)) continue;                                                              // hidden behind a ridge
    c.sp.visible = true; taken.push(c.r);
  }
}

// ---------- LEGEND + PANEL COLLAPSING ----------
{
  const lg = $('legend');
  if (window.innerWidth < 600) lg.classList.add('col');
  lg.querySelectorAll('b').forEach(b => b.onclick = () => { lg.classList.toggle('col'); });
  for (const id of ['route', 'profile']) { const g = $(id).querySelector('.grab'); if (g) g.onclick = () => { $(id).classList.toggle('mini'); render(); }; }
}

// ---------- ROUTE STEP FOCUS ----------
var stepHl = null;
function focusStep(res, st, li) {
  document.querySelectorAll('#rt-steps li').forEach(x => x.classList.toggle('sel', x === li));
  if (stepHl) { scene.remove(stepHl); stepHl = null; }
  const pts = routePoints(res, st.i0, st.i1);
  const ps = []; for (let i = 0; i < pts.length - 1; i++) ps.push(pts[i].x, pts[i].y + 12, pts[i].z, pts[i + 1].x, pts[i + 1].y + 12, pts[i + 1].z);
  if (ps.length) { const g = new LineSegmentsGeometry(); g.setPositions(ps); stepHl = new LineSegments2(g, makeLineMat(9, { color: 0x0e6bd8 })); stepHl.renderOrder = 8; stepHl.material.depthWrite = false; scene.add(stepHl); resize(); }
  fitNodes(pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1).map(p => ({ x: p.x, z: p.z, h: p.y })));
}
// detailed points along route edges i0..i1 (lift edges follow the cable)
function routePoints(res, i0 = 0, i1 = res.edges.length - 1) {
  const out = []; let d = 0;
  const push = (x, y, z, ei) => { const last = out[out.length - 1]; if (last) d += Math.hypot(x - last.x, z - last.z); out.push({ x, y, z, d, ei }); };
  for (let ei = i0; ei <= i1; ei++) {
    const { from, to, e } = res.edges[ei];
    if (e.kind === 'lift') { const l = lifts[e.id]; let P = l.path; if (!e.up !== (P[0].y > P[P.length - 1].y)) P = P.slice().reverse(); for (const q of P) push(q.x, q.y, q.z, ei); continue; }
    if (ei === i0 || !out.length) { const a = G.nodes[from]; push(a.x, meshHeight(a.x, a.z), a.z, ei); }
    const b = G.nodes[to]; push(b.x, meshHeight(b.x, b.z), b.z, ei);
  }
  return out;
}

// ---------- GPS ----------
const gps = { watch: null, me: null, xz: null, warned: false, first: true };
const meGroup = new THREE.Group(); scene.add(meGroup);
const meDot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x1a73e8, depthTest: false }));
const meRing = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
const meAcc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x1a73e8, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
meAcc.rotation.x = -Math.PI / 2; meRing.renderOrder = 20; meDot.renderOrder = 21;
meGroup.add(meAcc, meRing, meDot); meGroup.visible = false;
function setLocBtn(state) { const b = $('btn-loc'); b.dataset.state = state; }
function lonlatXZ(lon, lat) { return toXZ(lon, lat); }
function onPos(p) {
  const c = p.coords; gps.me = { lon: c.longitude, lat: c.latitude, acc: c.accuracy, t: p.timestamp };
  const [x, z] = lonlatXZ(c.longitude, c.latitude);
  if (!inside(x, z)) {
    gps.xz = null; meGroup.visible = false; setLocBtn('on');
    if (!gps.warned) { gps.warned = true; const km = Math.hypot(x, z) / 1000; window.__toast && window.__toast(`Du bist gerade nicht in diesem Skigebiet (ca. ${Math.round(km)} km entfernt).`); }
    return;
  }
  gps.xz = [x, z]; setLocBtn('on'); placeMe(x, z, c.accuracy);
  if (gps.first) { gps.first = false; flyTo(x, z, 1800); }
  if (nav.active && !nav.sim) navOnGps(x, z);
  render();
}
function placeMe(x, z, acc) {
  const y = meshHeight(x, z), k = Math.max(6, camera.position.distanceTo(new THREE.Vector3(x, y, z)) * 0.006);
  meGroup.visible = true; meDot.position.set(x, y + k * 1.6, z); meRing.position.copy(meDot.position);
  meDot.scale.setScalar(k); meRing.scale.setScalar(k * 1.35);
  meAcc.position.set(x, y + 2, z); meAcc.scale.setScalar(Math.max(8, acc || 15));
}
function flyTo(x, z, dist = 2000) {
  const y = heightAt(x, z), dir = camera.position.clone().sub(controls.target); dir.y = 0; dir.normalize();
  startTween(new THREE.Vector3(x + dir.x * dist * 0.7, y + dist * 0.75, z + dir.z * dist * 0.7), new THREE.Vector3(x, y, z));
}
function startGps(high = false) {
  if (!navigator.geolocation) { window.__toast && window.__toast('Standort wird von diesem Gerät nicht unterstützt.'); return; }
  if (gps.watch !== null) { if (gps.high === high) return; navigator.geolocation.clearWatch(gps.watch); }
  gps.high = high; setLocBtn('wait');
  gps.watch = navigator.geolocation.watchPosition(onPos, err => {
    setLocBtn('off'); gps.watch = null;
    window.__toast && window.__toast(err.code === 1 ? 'Standort-Zugriff wurde nicht erlaubt. Du kannst ihn in den Browser-Einstellungen freigeben.' : 'Standort gerade nicht verfügbar.');
  }, { enableHighAccuracy: high, maximumAge: high ? 1000 : 10000, timeout: 30000 });
}
function stopGps() { if (gps.watch !== null) navigator.geolocation.clearWatch(gps.watch); gps.watch = null; gps.first = true; setLocBtn('off'); meGroup.visible = false; render(); }
$('btn-loc').onclick = () => {
  if (gps.watch === null) { gps.first = true; startGps(false); }
  else if (gps.xz) flyTo(gps.xz[0], gps.xz[1], 1800);
  else stopGps();
};
document.addEventListener('visibilitychange', () => { if (document.hidden && !nav.active && gps.watch !== null) { navigator.geolocation.clearWatch(gps.watch); gps.watch = null; gps.paused = true; } else if (!document.hidden && gps.paused) { gps.paused = false; startGps(false); } });
function meNode() { return gps.xz ? snap(gps.xz[0], gps.xz[1], 300) : null; }

// ---------- NAVIGATION ----------
const nav = { active: false, sim: false, pts: null, res: null, steps: null, prog: 0, off: 0, simT: 0, camPos: new THREE.Vector3(), camTgt: new THREE.Vector3(), wake: null, done: false };
function stepAtProg(prog) { // step index for the current progress
  for (let k = 0; k < nav.steps.length; k++) if (prog <= nav.steps[k].d1 + 1) return k; return nav.steps.length - 1;
}
function prepareNav(res) {
  nav.res = res; nav.pts = routePoints(res); nav.steps = buildSteps(res);
  for (const st of nav.steps) { const ps = nav.pts.filter(p => p.ei >= st.i0 && p.ei <= st.i1); st.d0 = ps.length ? ps[0].d : 0; st.d1 = ps.length ? ps[ps.length - 1].d : 0; }
  nav.total = nav.pts[nav.pts.length - 1].d; nav.prog = 0; nav.off = 0; nav.done = false;
}
function posAt(d) {
  const P = nav.pts; d = Math.max(0, Math.min(nav.total, d));
  let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].d <= d) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, ei: a.ei };
}
const bearing = (dx, dz) => (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
function dirAt(d, span = 40) { const a = posAt(d - span / 2), b = posAt(d + span / 2); return bearing(b.x - a.x, b.z - a.z); }
function stepLabel(st) {
  if (st.kind === 'lift') { const l = lifts[st.id]; return { icon: liftIcon(l.cls), text: `${l.name || LIFT_DE[l.cls]} ${st.up ? 'hoch' : 'talwärts'} nehmen` }; }
  if (st.kind === 'run') { const r = runs[st.id]; const t = r.name ? (r.ref ? r.ref + ' ' : '') + r.name : (r.ref ? 'Piste ' + r.ref : 'Verbindungspiste'); return { icon: '⛷', text: t, cls: r.cls }; }
  return { icon: '🚶', text: 'Zu Fuß weiter' };
}
function renderNav() {
  const k = stepAtProg(nav.prog), cur = nav.steps[k], next = nav.steps[k + 1];
  const left = nav.total - nav.prog;
  let remT = 0; for (let i = k; i < nav.steps.length; i++) { const st = nav.steps[i], span = Math.max(1, st.d1 - st.d0); remT += i === k ? st.t * Math.max(0, (st.d1 - nav.prog) / span) : st.t; }
  let main, sub, icon;
  if (nav.done) { icon = '🏁'; main = 'Ziel erreicht'; sub = route.b !== null ? placeName(route.b) : ''; }
  else if (cur.kind === 'lift' && nav.prog > cur.d0 + 15) { const l = lifts[cur.id]; icon = liftIcon(l.cls); main = `Auf ${l.name || LIFT_DE[l.cls]}`; sub = `Ausstieg in ca. ${fmtMin(cur.t * Math.max(0, (cur.d1 - nav.prog) / Math.max(1, cur.d1 - cur.d0)))}`; }
  else if (next) {
    const lb = stepLabel(next), dist = Math.max(0, next.d0 - nav.prog);
    let turn = '';
    if (next.kind === 'run' && cur.kind !== 'lift') { const delta = ((dirAt(next.d0 + 30, 40) - dirAt(next.d0 - 25, 40) + 540) % 360) - 180; turn = Math.abs(delta) < 25 ? 'Geradeaus auf ' : delta > 0 ? 'Rechts auf ' : 'Links auf '; }
    else if (next.kind === 'run') turn = 'Weiter auf ';
    icon = next.kind === 'run' ? (turn.startsWith('Rechts') ? '↱' : turn.startsWith('Links') ? '↰' : '↑') : lb.icon;
    main = (next.kind === 'run' ? turn + lb.text : lb.text);
    if (next.kind === 'walk') main = 'Zu Fuß zum nächsten Lift';
    sub = dist < 25 ? 'jetzt' : 'in ' + (dist >= 1000 ? (dist / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(dist / 10) * 10 + ' m');
    if (next.kind === 'run') sub += ` · ${diff(runs[next.id].cls).de}`;
    else if (cur.kind === 'run' && dist > 60) sub += ' · bis dahin ' + stepLabel(cur).text;
  } else { const lb = stepLabel(cur); icon = '🏁'; main = 'Bis zum Ziel'; sub = 'noch ' + fmtLen(left); }
  $('nv-icon').textContent = icon; $('nv-main').textContent = main; $('nv-sub').textContent = sub;
  $('nv-rem').textContent = nav.done ? 'Angekommen' : `noch ca. ${fmtMin(remT)} · ${fmtLen(left)}`;
}
async function startNav(isSim) {
  if (!route.res) return;
  prepareNav(route.res); nav.active = true; nav.sim = isSim;
  if (isSim) { sim.d = 0; sim.lat = 0; sim.latT = 0; sim.fixT = 0; sim.paused = false; sim.pos = null; simUi(); }
  document.body.classList.add('navi'); $('route').classList.add('hidden');
  routeGroup.children.forEach(o => { if (o.geometry === markerGeo) o.visible = false; }); startLbl.el.style.visibility = 'hidden';
  controls.enabled = false; tween = null;
  const p = posAt(0); nav.camTgt.set(p.x, p.y, p.z); nav.camPos.copy(camera.position);
  if (!isSim) { startGps(true); try { nav.wake = await navigator.wakeLock?.request('screen'); } catch { } }
  $('nv-sim').classList.toggle('hidden', !isSim); $('nv-tools').classList.toggle('hidden', !isSim);
  renderNav(); render();
}
function stopNav() {
  if (nav.sim) { gps.xz = null; meGroup.visible = false; }
  nav.active = false; document.body.classList.remove('navi'); controls.enabled = true;
  routeGroup.children.forEach(o => { o.visible = true; }); if (route.a !== null) startLbl.el.style.visibility = '';
  try { nav.wake?.release(); } catch { } nav.wake = null;
  if (gps.watch !== null && gps.high) startGps(false);
  controls.target.copy(nav.camTgt); controls.update();
  if (routing) $('route').classList.remove('hidden');
  render();
}
function navOnGps(x, z) {
  // project position on the route, searching near the last progress so it never jumps backwards over loops
  let best = null, bd = Infinity;
  for (const p of nav.pts) { if (p.d < nav.prog - 150 || p.d > nav.prog + 900) continue; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
  if (best && bd < 70) { nav.prog = Math.max(nav.prog, best.d); nav.off = 0; }
  else if (++nav.off >= 3) { // off route: recalc from here
    const a = snap(x, z, 300);
    if (a !== null && route.b !== null) { const r2 = dijkstra(a, route.b, route.rank, route.allowDown); if (r2) { route.a = a; route.res = r2; drawRoute(); routeGroup.children.forEach(o => { if (o.geometry === markerGeo) o.visible = false; }); startLbl.el.style.visibility = 'hidden'; prepareNav(r2); if (nav.sim) { sim.d = 0; sim.lat = 0; sim.latT = 0; } window.__toast && window.__toast('Neue Route berechnet.'); } }
    nav.off = 0;
  }
  if (nav.total - nav.prog < 35 || (nav.sim && nav.total - sim.d < 5)) nav.done = true;
  renderNav();
}
var navLastT = 0;
// test drive: a virtual skier follows the instructions, the app only sees noisy GPS fixes (same logic as outdoors)
const sim = { d: 0, mult: 4, paused: false, lat: 0, latT: 0, fixT: 0, pos: null };
function simTruth() { // true position of the virtual skier
  const p = posAt(sim.d), hd = dirAt(sim.d, 30) * Math.PI / 180;
  return { x: p.x + Math.cos(hd) * sim.lat, z: p.z + Math.sin(hd) * sim.lat };
}
function navUpdate(t) {
  const dt = Math.min(0.1, t - navLastT || 0.016); navLastT = t;
  if (nav.sim && !nav.done && !sim.paused) {
    const st = nav.steps[stepAtProg(sim.d)];
    const v = st.kind === 'lift' ? (LIFT_SPEED[lifts[st.id].cls] || 3) : st.kind === 'walk' ? WALK_V * 2 : SKI_V;
    sim.d = Math.min(nav.total, sim.d + v * sim.mult * dt);
    if (sim.latT > 0) { sim.latT -= dt * sim.mult; sim.lat = Math.min(160, sim.lat + 25 * sim.mult * dt); }   // drifting off the route
    sim.pos = simTruth();
    sim.fixT -= dt;
    if (sim.fixT <= 0) { // one GPS fix per second (scaled), ±6 m noise
      sim.fixT = 1 / Math.max(1, sim.mult / 2);
      const nx = sim.pos.x + (Math.random() - 0.5) * 12, nz = sim.pos.z + (Math.random() - 0.5) * 12;
      gps.xz = [nx, nz]; gps.me = { acc: 8 }; navOnGps(nx, nz);
    }
  }
  const P = posAt(nav.prog), hd = dirAt(nav.prog + 30, 60) * Math.PI / 180;
  const fx = Math.sin(hd), fz = -Math.cos(hd);
  const pos = nav.sim && sim.pos ? { x: sim.pos.x, z: sim.pos.z, y: meshHeight(sim.pos.x, sim.pos.z) } : !gps.xz ? P : { x: gps.xz[0], z: gps.xz[1], y: meshHeight(gps.xz[0], gps.xz[1]) };
  placeMe(pos.x, pos.z, nav.sim ? 8 : gps.me?.acc);
  const want = new THREE.Vector3(pos.x - fx * 260, Math.max(pos.y, meshHeight(pos.x - fx * 260, pos.z - fz * 260)) + 150, pos.z - fz * 260);
  const tgt = new THREE.Vector3(pos.x + fx * 140, pos.y + 10, pos.z + fz * 140);
  const a = 1 - Math.pow(0.02, dt);
  nav.camPos.lerp(want, a); nav.camTgt.lerp(tgt, a);
  camera.position.copy(nav.camPos); camera.lookAt(nav.camTgt);
}
function simUi() {
  $('nv-speed').textContent = sim.mult + '×';
  $('nv-pause').textContent = sim.paused ? '▶' : '⏸';
}
$('nv-speed').onclick = () => { sim.mult = sim.mult === 1 ? 4 : sim.mult === 4 ? 10 : 1; simUi(); };
$('nv-pause').onclick = () => { sim.paused = !sim.paused; simUi(); };
$('nv-off').onclick = () => { sim.latT = 6; window.__toast && window.__toast('Test: Du fährst jetzt von der Route ab …'); };
$('rt-nav').onclick = () => startNav(false);
$('rt-sim').onclick = () => startNav(true);
$('rt-me').onclick = () => {
  if (!gps.xz) { startGps(false); window.__toast && window.__toast('Suche deinen Standort …'); const wait = setInterval(() => { if (gps.xz) { clearInterval(wait); const a = meNode(); if (a !== null) { route.a = a; computeRoute(); } } }, 700); setTimeout(() => clearInterval(wait), 30000); return; }
  const a = meNode(); if (a !== null) { route.a = a; computeRoute(); } else window.__toast && window.__toast('Keine Piste oder Lift in deiner Nähe gefunden.');
};
$('nv-stop').onclick = stopNav;


// ---------- HUTS / RESTAURANTS ----------
const HUT_DE = { alpine_hut: 'Berghütte', wilderness_hut: 'Hütte', restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Kneipe', fast_food: 'Imbiss', biergarten: 'Biergarten' };
const HUT_IC = { alpine_hut: '🏠', wilderness_hut: '🏠', restaurant: '🍴', cafe: '☕', bar: '🍺', pub: '🍺', fast_food: '🍟', biergarten: '🍺' };
const huts = []; const hutAtNode = new Map(); const hutGroup = new THREE.Group(); scene.add(hutGroup);
var showHuts = true;
function setHuts(list) {
  huts.length = 0; hutGroup.clear(); hutAtNode.clear();
  for (const b of [...badgeGroup.children]) if (b.userData.hut) badgeGroup.remove(b);
  for (const h of list) {
    const [x, z] = toXZ(h.lon, h.lat); if (!inside(x, z)) continue;
    // only places on the mountain: close to a piste or lift
    let best = null, bd = 260; for (const [id, d] of near(x, z, 260)) if (d < bd) { bd = d; best = id; }
    if (best === null) continue;
    const hh = heightAt(x, z);
    // valley villages: lowest lift station within 3 km defines the local valley floor
    let floor = Infinity; for (const l of lifts) { const b0 = G.nodes[l.bottom]; if (Math.hypot(b0.x - x, b0.z - z) < 3000) floor = Math.min(floor, b0.h); }
    if (!isFinite(floor)) floor = VALLEY_H - 350;
    if (bd > 60 && hh < floor + 120) continue;               // in the village only if right at the piste / lift
    huts.push({ ...h, x, z, h: hh, node: best, dist: bd });
  }
  // dedupe same name within 80 m
  for (let i = huts.length - 1; i >= 0; i--) for (let j = 0; j < i; j++) if (huts[i].name && huts[i].name === huts[j].name && Math.hypot(huts[i].x - huts[j].x, huts[i].z - huts[j].z) < 80) { huts.splice(i, 1); break; }
  const m4 = [];
  for (const h of huts) {
    hutAtNode.set(h.node, h);
    _m.compose(_v.set(h.x, meshHeight(h.x, h.z) - 1, h.z), _q.setFromAxisAngle(_up, (h.lon * 1000) % 6.28), _s.set(1, 1, 1)); m4.push(_m.clone());
    // name tag
    const label = (HUT_IC[h.type] || '🍴') + ' ' + (h.name ? (h.name.length > 22 ? h.name.slice(0, 21) + '…' : h.name) : HUT_DE[h.type] || 'Hütte');
    const c = document.createElement('canvas'), fs = 40, ctx = c.getContext('2d'); ctx.font = `650 ${fs}px system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(label).width) + fs * 0.9, hgt = fs * 1.45; c.width = w + 6; c.height = hgt + 6; ctx.font = `650 ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = '#7a4a2a'; ctx.beginPath(); ctx.roundRect(1, 1, w + 4, hgt + 4, 14); ctx.fill();
    ctx.fillStyle = '#fff8ee'; ctx.beginPath(); ctx.roundRect(4, 4, w - 2, hgt - 2, 11); ctx.fill();
    ctx.fillStyle = '#3b2414'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, c.width / 2, c.height / 2 + 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthWrite: false, depthTest: false, transparent: true }));
    sp.position.set(h.x, meshHeight(h.x, h.z) + 55, h.z); sp.renderOrder = 11;
    sp.userData = { hut: h, a: c.width / c.height, prio: 3e6 + (h.name ? 1e5 : 0) };
    badgeGroup.add(sp);
  }
  if (m4.length) {
    const roof = new THREE.CylinderGeometry(0.62, 0.62, 1.06, 3, 1); roof.rotateZ(Math.PI / 2); roof.rotateY(Math.PI / 2); roof.scale(1, 0.5, 1);
    const geo = mergeGeometries([part(new THREE.BoxGeometry(14, 6, 10), 0x8a5a36, 0, 3, 0), part(new THREE.BoxGeometry(14.2, 2.2, 10.2), 0xe9e2d6, 0, 1.1, 0), part(roof.scale(15, 7, 11.5), 0xf4f7fa, 0, 8.3, 0), part(new THREE.BoxGeometry(1.2, 3, 1.2), 0x5a3c26, 4, 11, 2)]);
    const im = new THREE.InstancedMesh(geo, objMat, m4.length); m4.forEach((m, i) => im.setMatrixAt(i, m)); im.computeBoundingSphere(); hutGroup.add(im);
  }
  badgeT = 0; render();
  return huts.length;
}
function hoursDe(s) {
  if (!s) return '';
  const D = { Mo: 'Mo', Tu: 'Di', We: 'Mi', Th: 'Do', Fr: 'Fr', Sa: 'Sa', Su: 'So', PH: 'Feiertag' };
  return s.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, m => D[m]).replace(/\boff\b/g, 'geschlossen').replace(/;\s*/g, ' · ');
}
function showHut(h) {
  highlight(null); pinGroup.clear(); ui.prof.classList.add('hidden');
  const web = h.web && /^https?:\/\//.test(h.web) ? `<a href="${h.web.replace(/"/g, '')}" target="_blank" rel="noopener">Webseite</a>` : '';
  ui.info.innerHTML = `<div class="ph"><span class="badge hut">${HUT_IC[h.type] || '🍴'}</span><div><div class="pt">${h.name || HUT_DE[h.type] || 'Hütte'}</div><div class="ps">${HUT_DE[h.type] || ''} · ${Math.round(h.ele || h.h)} m</div></div></div>
    ${h.hours ? `<div class="i-row"><span>🕘 ${hoursDe(h.hours)}</span></div>` : '<div class="i-row"><span>Öffnungszeiten nicht eingetragen</span></div>'}
    ${web ? `<div class="i-row">${web}</div>` : ''}
    <div class="rt-opts"><button class="tg primary" id="hut-route">Route hierher</button><button class="tg" id="hut-meet">Als Treffpunkt</button></div>
    <div class="i-src">Daten: OpenStreetMap – Zeiten ohne Gewähr</div>`;
  ui.info.classList.remove('hidden');
  $('hut-route').onclick = () => {
    setRouting(true); setTab('route'); route.b = h.node;
    if (route.a === null && gps.xz) route.a = meNode();
    if (route.a !== null) computeRoute(); else { drawRoute(); renderRoutePanel(); $('rt-sum').innerHTML = `<div class="rt-hint">Ziel: <b>${h.name || 'Hütte'}</b>. Tippe jetzt auf der Karte, wo du bist – oder „📍 Start = mein Standort“.</div>`; }
    updateUi();
  };
  $('hut-meet').onclick = () => { setRouting(true); setTab('meet'); meet.node = h.node; meet.fairMsg = ''; meet.target = nextTarget(); computeMeet(); updateUi(); };
  render();
}

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
$('tg-huts').onclick = () => { showHuts = !showHuts; hutGroup.visible = showHuts; $('tg-huts').classList.toggle('on', showHuts); badgeT = 0; render(); };
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
  const t = clock.getElapsedTime();
  let moving;
  if (nav.active) { navUpdate(t); moving = true; }
  else if (stepTween()) moving = true;
  else moving = controls.update();
  if (!needs && !moving && t - last < 1 / 30) return;
  if (nav.active && t - last < 1 / 30) return;          // navigation: 30 fps is plenty and saves battery
  last = t; needs = false;
  { // keep the 3D focus above whatever bottom panel is open
    let ph = 0; for (const id of ['route', 'profile', 'info']) { const el = $(id); if (!el.classList.contains('hidden')) ph = Math.max(ph, window.innerHeight - el.getBoundingClientRect().top - 90); }
    const w = window.innerWidth, h = window.innerHeight, off = Math.round(ph * 0.5);
    if (camera.view?.offsetY !== off) { if (off > 0) camera.setViewOffset(w, h, 0, off, w, h); else camera.clearViewOffset(); }
  }
  const dist = camera.position.distanceTo(controls.target);
  updateCabins(t, dist); updateTrees(); updateBadges(dist); if (gps.xz && !nav.active) placeMe(gps.xz[0], gps.xz[1], gps.me?.acc);
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

window.__app = { applySharedMeet, meetLink, xzToLonLat, setHuts, huts, showHut, nav, gps, startNav, stopNav, focusStep, camera, controls, runs, lifts, showRun, showLift, setMode, G, route, computeRoute, setRouting, buildSteps, meet, computeMeet, setTab, fairMeet, placeName };

}
