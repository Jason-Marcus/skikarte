import { runApp } from './main.js';

const $ = id => document.getElementById(id);
const API = 'https://api.openskimap.org';
const TILES = 'https://tiles.openskimap.org/openskimap';
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const METEO = 'https://api.open-meteo.com/v1/forecast';
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }, del(k) { try { localStorage.removeItem(k); } catch { } } };

// ---------------- helpers ----------------
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
async function pool(items, n, fn, onStep) {
  let i = 0, done = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } done++; onStep && onStep(done, items.length); }
  }));
  return out;
}
function progress(text, frac) { $('ld-text').textContent = text; $('ld-bar').style.width = Math.round((frac ?? 0) * 100) + '%'; }

// ---------------- minimal Mapbox Vector Tile decoder ----------------
function reader(u) { let p = 0; const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  return { get p() { return p; }, set p(v) { p = v; }, varint() { let r = 0, s = 0, b; do { b = u[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; }, dv }; }
function msg(u8, cb) { const r = reader(u8); while (r.p < u8.length) { const tag = r.varint(), f = Math.floor(tag / 8), t = tag & 7;
  if (t === 0) cb(f, r.varint()); else if (t === 2) { const l = r.varint(); cb(f, u8.subarray(r.p, r.p + l)); r.p += l; }
  else if (t === 5) { cb(f, r.dv.getFloat32(r.p, true)); r.p += 4; } else if (t === 1) { cb(f, r.dv.getFloat64(r.p, true)); r.p += 8; } else throw new Error('wt' + t); } }
const td = new TextDecoder();
function packed(u8) { const r = reader(u8), a = []; while (r.p < u8.length) a.push(r.varint()); return a; }
const zz = n => (n >>> 1) ^ -(n & 1);
function decodeTile(ab) {
  const out = {};
  msg(new Uint8Array(ab), (f, v) => {
    if (f !== 3) return;
    let name, extent = 4096; const keys = [], vals = [], feats = [];
    msg(v, (f2, v2) => {
      if (f2 === 1) name = td.decode(v2); else if (f2 === 3) keys.push(td.decode(v2)); else if (f2 === 5) extent = v2;
      else if (f2 === 4) { let val = null; msg(v2, (f3, v3) => { val = f3 === 1 ? td.decode(v3) : (f3 === 7 ? !!v3 : v3); }); vals.push(val); }
      else if (f2 === 2) feats.push(v2);
    });
    out[name] = feats.map(fb => {
      const props = {}; let tags = [], type = 0, geom = [];
      msg(fb, (f4, v4) => { if (f4 === 2) tags = packed(v4); else if (f4 === 3) type = v4; else if (f4 === 4) geom = packed(v4); });
      for (let i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      // geometry -> list of lines in tile units
      const lines = []; let x = 0, y = 0, cur = null;
      for (let i = 0; i < geom.length;) {
        const cmd = geom[i] & 7, cnt = geom[i] >> 3; i++;
        if (cmd === 7) { if (cur && cur.length) cur.push(cur[0]); continue; }
        for (let c = 0; c < cnt; c++) { x += zz(geom[i++]); y += zz(geom[i++]); if (cmd === 1) { cur = [[x, y]]; lines.push(cur); } else cur.push([x, y]); }
      }
      return { props, type, lines, extent };
    });
  });
  return out;
}
// clip a polyline to [0,E]x[0,E] (removes the tile buffer so pieces join cleanly)
function clipLine(pts, E) {
  const out = []; let cur = null;
  const inside = p => p[0] >= 0 && p[0] <= E && p[1] >= 0 && p[1] <= E;
  for (let i = 0; i < pts.length - 1; i++) {
    let [x0, y0] = pts[i], [x1, y1] = pts[i + 1], t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    let ok = true;
    for (const [p, q] of [[-dx, x0], [dx, E - x0], [-dy, y0], [dy, E - y0]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } } else { const r = q / p; if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; } }
    }
    if (!ok) { cur = null; continue; }
    const a = [x0 + dx * t0, y0 + dy * t0], b = [x0 + dx * t1, y0 + dy * t1];
    if (!cur) { cur = [a]; out.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return out.filter(l => l.length > 1);
}
function mergePieces(pieces) { // join pieces whose ends touch (≤ 2 m)
  const near = (a, b) => Math.abs(a[0] - b[0]) * 75000 < 2 && Math.abs(a[1] - b[1]) * 111000 < 2;
  const out = pieces.map(p => p.slice());
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) for (let j = 0; j < out.length; j++) {
      if (i === j) continue; const A = out[i], B = out[j];
      if (near(A[A.length - 1], B[0])) { out[i] = A.concat(B.slice(1)); out.splice(j, 1); changed = true; break outer; }
    }
  }
  return out;
}

// ---------------- search ----------------
function downhillKm(p) { const d = p.statistics?.runs?.byActivity?.downhill?.byDifficulty; if (!d) return 0; return Object.values(d).reduce((a, x) => a + (x.lengthInKm || 0), 0); }
function placeOf(p) { const pl = (p.places || [])[0]?.localized?.en; return pl ? [pl.region, pl.country].filter(Boolean).join(', ') : ''; }
let searchSeq = 0;
async function doSearch(q) {
  const seq = ++searchSeq, list = $('sr-list');
  if (q.trim().length < 2) { list.innerHTML = ''; return; }
  list.innerHTML = '<li class="sr-msg">Suche …</li>';
  try {
    const res = await fetch(API + '/search?query=' + encodeURIComponent(q)).then(r => r.json());
    if (seq !== searchSeq) return;
    const areas = res.filter(f => f.properties.type === 'skiArea' && (f.properties.activities || []).includes('downhill'));
    list.innerHTML = areas.length ? '' : '<li class="sr-msg">Kein Skigebiet mit Alpinpisten gefunden.</li>';
    for (const f of areas) {
      const p = f.properties, km = downhillKm(p);
      const li = document.createElement('li');
      li.innerHTML = `<b>${p.name || 'Skigebiet ohne Namen'}</b><small>${placeOf(p)}${km ? ' · ' + Math.round(km) + ' km Pisten' : ''}</small>`;
      li.onclick = () => chooseArea({ id: p.id, name: p.name || 'Skigebiet', place: placeOf(p), km: Math.round(km), center: f.geometry.type === 'Point' ? f.geometry.coordinates : null, vh: p.viewportHint || null });
      list.appendChild(li);
    }
  } catch (e) { if (seq === searchSeq) list.innerHTML = '<li class="sr-msg warn">Suche gerade nicht erreichbar. Internetverbindung prüfen.</li>'; }
}
function chooseArea(a) { LS.set('skiarea', a); location.hash = ''; location.reload(); }

// ---------------- loading a ski area ----------------

// ---------------- Overpass fallback (raw OpenStreetMap) ----------------
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const LIFT_MAP = { cable_car: 'cable_car', gondola: 'gondola', chair_lift: 'chair_lift', mixed_lift: 'mixed_lift', drag_lift: 't-bar', 't-bar': 't-bar', 'j-bar': 'j-bar', platter: 'platter', rope_tow: 'rope_tow', magic_carpet: 'magic_carpet' };
const DIFF_MAP = { novice: 'novice', easy: 'easy', intermediate: 'intermediate', advanced: 'advanced', expert: 'expert', freeride: 'freeride', extreme: 'expert' };
async function loadOverpass(bb) {
  const box = `${bb.s.toFixed(5)},${bb.w.toFixed(5)},${bb.n.toFixed(5)},${bb.e.toFixed(5)}`;
  const ql = `[out:json][timeout:90];(way["piste:type"="downhill"](${box});way["aerialway"](${box});relation["piste:type"="downhill"](${box}););out tags geom qt;`;
  let j = null, lastErr = null;
  for (const srv of OVERPASS) {
    try {
      progress('Pisten direkt aus OpenStreetMap laden … (kann bis zu 1 Minute dauern)', 0.33);
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 100000);
      const r = await fetch(srv, { method: 'POST', body: 'data=' + encodeURIComponent(ql), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) { lastErr = new Error('Overpass ' + r.status); continue; }
      j = await r.json(); break;
    } catch (e) { lastErr = e; }
  }
  if (!j) throw lastErr || new Error('Overpass nicht erreichbar');
  const ways = new Map(), runs = [], lifts = [];
  for (const e of j.elements) if (e.type === 'way') ways.set(e.id, e);
  const runTags = new Map();
  for (const e of j.elements) if (e.type === 'way' && e.tags['piste:type'] === 'downhill' && e.tags.area !== 'yes' && e.geometry?.length > 1) runTags.set(e.id, { ...e.tags, __g: e.geometry });
  for (const rel of j.elements) if (rel.type === 'relation') for (const m of rel.members || []) {
    if (m.type !== 'way' || !m.geometry || m.geometry.length < 2) continue;
    const cur = runTags.get(m.ref) || { __g: m.geometry };
    for (const k of ['piste:difficulty', 'piste:name', 'piste:ref', 'name', 'ref']) if (!cur[k] && rel.tags[k]) cur[k] = rel.tags[k];
    runTags.set(m.ref, cur);
  }
  for (const t of runTags.values()) {
    const ll = t.__g.filter(Boolean).map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6)]); if (ll.length < 2) continue;
    runs.push(['r', t['piste:name'] || t.name || '', t['piste:ref'] || t.ref || '', DIFF_MAP[t['piste:difficulty']] || '', '', ll]);
  }
  for (const e of j.elements) if (e.type === 'way' && LIFT_MAP[e.tags.aerialway] && e.geometry?.length > 1 && !e.tags.disused && e.tags['disused:aerialway'] === undefined)
    lifts.push(['l', e.tags.name || '', e.tags.ref || '', LIFT_MAP[e.tags.aerialway], e.tags['aerialway:capacity'] || '', e.geometry.map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6)])]);
  return { runs, lifts };
}
const lineKm = ln => { let s = 0; for (let i = 1; i < ln.length; i++) s += Math.hypot((ln[i][0] - ln[i - 1][0]) * 111320 * Math.cos(ln[i][1] * Math.PI / 180), (ln[i][1] - ln[i - 1][1]) * 111320); return s / 1000; };

async function loadFeatures(area) {
  const cached = LS.get('sa:' + area.id);
  if (cached && cached.v === 5) return cached;
  // 1) bounding box from the viewport hint
  const c = area.vh?.center || area.center;
  const R = area.vh ? Math.max(3000, Math.hypot(area.vh.rotatedWidthMeters, area.vh.rotatedHeightMeters) / 2 * 1.25) : 8000;
  const dLat = R / 111320, dLon = R / (111320 * Math.cos(c[1] * Math.PI / 180));
  const runPieces = new Map(), liftIds = new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function getTile(z, tx, ty, tries = 2) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const r = await fetch(`${TILES}/${z}/${tx}/${ty}.pbf`); if (!r.ok) return null;
      const ab = await r.arrayBuffer(), t = decodeTile(ab);
      if ((t.runs && t.runs.length) || (t.lifts && t.lifts.length) || ab.byteLength > 400) return t;
      if (attempt < tries - 1) await sleep(1500);   // tile may still be generated on the server
    }
    return {};
  }
  function eat(t, z, tx, ty) {
    for (const f of t.runs || []) {
      if (f.type !== 2 || !('downhill' in f.props)) continue;
      if (!(f.props.skiAreas || '').includes(area.id)) continue;
      for (const ln of f.lines) for (const cl of clipLine(ln, f.extent)) {
        const ll = cl.map(([px, py]) => [+x2lon(tx + px / f.extent, z).toFixed(6), +y2lat(ty + py / f.extent, z).toFixed(6)]);
        if (!runPieces.has(f.props.id)) runPieces.set(f.props.id, { props: f.props, pieces: [] });
        runPieces.get(f.props.id).pieces.push(ll);
      }
    }
    for (const f of t.lifts || []) if ((f.props.skiAreas || '').includes(area.id) && !['proposed', 'abandoned', 'disused', 'construction'].includes(f.props.status)) liftIds.set(f.props.id, f.props);
  }
  const Z = 12;
  const x0 = Math.floor(lon2x(c[0] - dLon, Z)), x1 = Math.floor(lon2x(c[0] + dLon, Z)), y0 = Math.floor(lat2y(c[1] + dLat, Z)), y1 = Math.floor(lat2y(c[1] - dLat, Z));
  const tiles = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  const empty = [];
  await pool(tiles, 6, async ([tx, ty]) => {
    const t = await getTile(Z, tx, ty); if (!t) return;
    if (!(t.runs || t.lifts)) empty.push([tx, ty]);
    eat(t, Z, tx, ty);
  }, (d, n) => progress(`Pisten laden … ${d}/${n}`, d / n * 0.3));
  // tiles that stayed empty: try the four more detailed tiles below them
  const kids = []; for (const [tx, ty] of empty) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) kids.push([tx * 2 + dx, ty * 2 + dy]);
  if (kids.length) await pool(kids, 6, async ([tx, ty]) => { const t = await getTile(Z + 1, tx, ty, 1); if (t) eat(t, Z + 1, tx, ty); }, (d, n) => progress(`Pisten nachladen … ${d}/${n}`, 0.3 + d / n * 0.05));
  const runs = [];
  for (const { props, pieces } of runPieces.values()) {
    let name = props.name || '', ref = '';
    const m = name.match(/^\s*([0-9]+[a-zA-Z]?)\s*[-–]\s*(.+)$/); if (m) { ref = m[1]; name = m[2]; } else if (/^[0-9]+[a-zA-Z]?$/.test(name.trim())) { ref = name.trim(); name = ''; }
    for (const ln of mergePieces(pieces)) runs.push(['r', name, ref, props.difficulty || '', '', ln]);
  }
  // 2) lifts with full details
  const ids = [...liftIds.keys()];
  const lifts = (await pool(ids, 6, async id => {
    const f = await fetch(`${API}/features/openskimap/${id}.geojson`).then(r => r.json());
    if (f.geometry?.type !== 'LineString') return null;
    const p = f.properties;
    return ['l', p.name || '', p.ref || '', p.liftType || '', p.capacity || '', f.geometry.coordinates.map(q => [+q[0].toFixed(6), +q[1].toFixed(6)])];
  }, (d, n) => progress(`Lifte laden … ${d}/${n}`, 0.35 + d / n * 0.25))).filter(Boolean);
  let data = { v: 5, runs, lifts, src: 'OpenSkiMap' };
  // completeness check against the official OpenSkiMap statistics
  const tileKm = runs.reduce((a, r) => a + lineKm(r[5]), 0);
  if (!runs.length || (area.km && tileKm < area.km * 0.8)) {
    try {
      const bb = { w: c[0] - dLon, e: c[0] + dLon, s: c[1] - dLat, n: c[1] + dLat };
      const ov = await loadOverpass(bb);
      const ovKm = ov.runs.reduce((a, r) => a + lineKm(r[5]), 0);
      if (ovKm > tileKm) data = { v: 5, runs: ov.runs, lifts: ov.lifts, src: 'OpenStreetMap (Overpass)' };
    } catch (e) { console.warn('Overpass fallback failed', e); data.partial = true; }
  }
  LS.set('sa:' + area.id, data);
  return data;
}

async function loadDEM(bbox) {
  const latc = (bbox.s + bbox.n) / 2, mlat = 111320, mlon = 111320 * Math.cos(latc * Math.PI / 180);
  const Wm = (bbox.e - bbox.w) * mlon, Hm = (bbox.n - bbox.s) * mlat, maxDim = Math.max(Wm, Hm);
  const Z = maxDim > 22000 ? 12 : 13;
  const RES = Math.max(20, Math.ceil(maxDim / 900 / 5) * 5);
  const x0 = Math.floor(lon2x(bbox.w, Z)), x1 = Math.floor(lon2x(bbox.e, Z)), y0 = Math.floor(lat2y(bbox.n, Z)), y1 = Math.floor(lat2y(bbox.s, Z));
  const TW = (x1 - x0 + 1) * 256, TH = (y1 - y0 + 1) * 256, mos = new Float32Array(TW * TH);
  const tiles = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const ctx = cv.getContext('2d', { willReadFrequently: true });
  let failed = 0;
  await pool(tiles, 6, async ([tx, ty]) => {
    const r = await fetch(`${DEM}/${Z}/${tx}/${ty}.png`); if (!r.ok) { failed++; return; }
    const bmp = await createImageBitmap(await r.blob());
    ctx.drawImage(bmp, 0, 0); const d = ctx.getImageData(0, 0, 256, 256).data;
    const ox = (tx - x0) * 256, oy = (ty - y0) * 256;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const k = (j * 256 + i) * 4; mos[(oy + j) * TW + ox + i] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768; }
  }, (d, n) => progress(`Gelände laden … ${d}/${n}`, 0.6 + d / n * 0.3));
  if (failed > tiles.length / 3) throw new Error('Höhendaten nicht erreichbar');
  const nx = Math.floor(Wm / RES) + 1, ny = Math.floor(Hm / RES) + 1, H = new Float32Array(nx * ny);
  const at = (fx, fy) => { fx = Math.max(0, Math.min(TW - 1.001, fx)); fy = Math.max(0, Math.min(TH - 1.001, fy)); const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    return (mos[j * TW + i] * (1 - u) + mos[j * TW + i + 1] * u) * (1 - v) + (mos[(j + 1) * TW + i] * (1 - u) + mos[(j + 1) * TW + i + 1] * u) * v; };
  for (let j = 0; j < ny; j++) {
    const lat = bbox.n - j * RES / mlat, fy = (lat2y(lat, Z) - y0) * 256 - 0.5;
    for (let i = 0; i < nx; i++) { const lon = bbox.w + i * RES / mlon, fx = (lon2x(lon, Z) - x0) * 256 - 0.5; H[j * nx + i] = at(fx, fy); }
  }
  return { M: { B: bbox, RES, nx, ny, mlat, mlon, Wm, Hm }, H };
}

// textures (same look as the prototype): base terrain + slope overlay
function makeTextures(M, H) {
  const { nx, ny, RES } = M, S = 2, tw = (nx - 1) * S + 1, th = (ny - 1) * S + 1;
  const h = new Float32Array(tw * th);
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const fx = i / S, fy = j / S, a = Math.floor(fx), b = Math.floor(fy), u = fx - a, v = fy - b, a1 = Math.min(nx - 1, a + 1), b1 = Math.min(ny - 1, b + 1);
    h[j * tw + i] = (H[b * nx + a] * (1 - u) + H[b * nx + a1] * u) * (1 - v) + (H[b1 * nx + a] * (1 - u) + H[b1 * nx + a1] * u) * v;
  }
  const px = RES / S, base = new Uint8ClampedArray(tw * th * 4), slope = new Uint8ClampedArray(tw * th * 4);
  const az = 315 * Math.PI / 180, alt = 40 * Math.PI / 180, lx = Math.cos(alt) * Math.sin(az), ly = Math.cos(alt) * Math.cos(az), lz = Math.sin(alt);
  const G = (i, j) => h[Math.max(0, Math.min(th - 1, j)) * tw + Math.max(0, Math.min(tw - 1, i))];
  const forest = [62, 84, 72], snowC = [236, 241, 247], rockC = [120, 118, 122], valley = [214, 222, 226];
  const bands = [[25, [255, 224, 80, 120]], [40, [250, 150, 40, 160]], [60, [225, 60, 45, 175]], [80, [165, 40, 140, 185]], [100, [70, 35, 140, 195]]];
  // elevation-relative snow line: lowest ~15 % of the terrain counts as valley
  let hmin = Infinity, hmax = -Infinity; for (let k = 0; k < H.length; k += 5) { hmin = Math.min(hmin, H[k]); hmax = Math.max(hmax, H[k]); }
  const snowAt = Math.max(hmin + 250, Math.min(1450, hmin + (hmax - hmin) * 0.35));
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const gx = (G(i + 1, j) - G(i - 1, j)) / (2 * px), gy = (G(i, j + 1) - G(i, j - 1)) / (2 * px);
    // smoothed gradient for slope overlay (2 px)
    const sgx = (G(i + 2, j) - G(i - 2, j)) / (4 * px), sgy = (G(i, j + 2) - G(i, j - 2)) / (4 * px);
    const sl = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI, pct = Math.hypot(sgx, sgy) * 100;
    const n = Math.sqrt(gx * gx + gy * gy + 1), shade = Math.max(0, Math.min(1, (-gx * lx + gy * ly + lz) / n));
    const e = h[j * tw + i];
    const snow = Math.max(0, Math.min(1, (e - snowAt) / 350)), rock = Math.max(0, Math.min(1, (sl - 38) / 10)), flat = Math.max(0, Math.min(1, (12 - sl) / 8));
    const lit = 0.45 + 0.75 * shade, k = (j * tw + i) * 4;
    for (let c = 0; c < 3; c++) {
      let v = forest[c] * (1 - snow) + snowC[c] * snow;
      v = v * (1 - flat * (1 - snow)) + valley[c] * flat * (1 - snow);
      v = v * (1 - rock) + rockC[c] * rock;
      base[k + c] = v * lit; slope[k + c] = v * lit;
    }
    base[k + 3] = slope[k + 3] = 255;
    let band = null; for (const [lo, col] of bands) if (pct >= lo) band = col;
    if (band) { const a = band[3] / 255; for (let c = 0; c < 3; c++) slope[k + c] = slope[k + c] * (1 - a) + band[c] * a; }
  }
  const toURL = arr => { const c = document.createElement('canvas'); c.width = tw; c.height = th; c.getContext('2d').putImageData(new ImageData(arr, tw, th), 0, 0); return c.toDataURL('image/jpeg', 0.86); };
  return { base: toURL(base), slope: toURL(slope) };
}

// ---------------- weather ----------------
const WMO = { 0: ['☀️', 'Sonnig'], 1: ['🌤️', 'Überwiegend sonnig'], 2: ['⛅', 'Teils bewölkt'], 3: ['☁️', 'Bewölkt'], 45: ['🌫️', 'Nebel'], 48: ['🌫️', 'Nebel mit Reif'],
  51: ['🌦️', 'Leichter Niesel'], 53: ['🌦️', 'Niesel'], 55: ['🌧️', 'Starker Niesel'], 56: ['🌧️', 'Gefrierender Niesel'], 57: ['🌧️', 'Gefrierender Niesel'],
  61: ['🌧️', 'Leichter Regen'], 63: ['🌧️', 'Regen'], 65: ['🌧️', 'Starker Regen'], 66: ['🌧️', 'Gefrierender Regen'], 67: ['🌧️', 'Gefrierender Regen'],
  71: ['🌨️', 'Leichter Schneefall'], 73: ['🌨️', 'Schneefall'], 75: ['❄️', 'Starker Schneefall'], 77: ['🌨️', 'Schneegriesel'],
  80: ['🌦️', 'Regenschauer'], 81: ['🌧️', 'Regenschauer'], 82: ['🌧️', 'Heftige Schauer'], 85: ['🌨️', 'Schneeschauer'], 86: ['❄️', 'Starke Schneeschauer'],
  95: ['⛈️', 'Gewitter'], 96: ['⛈️', 'Gewitter mit Hagel'], 99: ['⛈️', 'Gewitter mit Hagel'] };
const wmo = c => WMO[c] || ['🌡️', 'Wetter'];
async function loadWeather(lat, lon, hLow, hHigh) {
  const q = (elev, extra) => fetch(`${METEO}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&elevation=${Math.round(elev)}&timezone=auto&${extra}`).then(r => r.json());
  const [lo, hi] = await Promise.all([
    q(hLow, 'current=temperature_2m,weather_code,wind_speed_10m&hourly=freezing_level_height,snow_depth&daily=weather_code,temperature_2m_max,temperature_2m_min&past_days=1&forecast_days=4'),
    q(hHigh, 'current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m&hourly=snowfall&daily=temperature_2m_max,temperature_2m_min,snowfall_sum&past_days=1&forecast_days=4')]);
  return { lo, hi, hLow, hHigh };
}
function renderWeather(w) {
  const { lo, hi } = w, c = lo.current, ch = hi.current;
  const [ic, txt] = wmo(c.weather_code);
  $('wx-chip').innerHTML = `<span>${ic}</span><span><b>${Math.round(ch.temperature_2m)}°</b><small> Berg</small></span>`;
  $('wx-chip').classList.remove('hidden');
  // freezing level now + new snow 24h + snow depth (model)
  const hrs = lo.hourly.time, now = c.time.slice(0, 13); let hi_i = hrs.findIndex(t => t.slice(0, 13) === now); if (hi_i < 0) hi_i = 0;
  const fz = lo.hourly.freezing_level_height[hi_i], sd = lo.hourly.snow_depth[hi_i];
  const hh = hi.hourly.time; let hj = hh.findIndex(t => t.slice(0, 13) === now); if (hj < 0) hj = 0;
  let new24 = 0; for (let k = Math.max(0, hj - 23); k <= hj; k++) new24 += hi.hourly.snowfall[k] || 0;
  const dIdx = Math.max(0, lo.daily.time.indexOf(c.time.slice(0, 10))), days = [];
  for (let d = Math.max(0, dIdx); d < lo.daily.time.length && days.length < 3; d++) {
    const dt = new Date(lo.daily.time[d] + 'T12:00'), name = days.length === 0 ? 'Heute' : dt.toLocaleDateString('de-DE', { weekday: 'short' });
    const [dic] = wmo(lo.daily.weather_code[d]);
    days.push(`<div class="wx-day"><b>${name}</b><span class="wx-ic">${dic}</span><span>Berg ${Math.round(hi.daily.temperature_2m_min[d])}…${Math.round(hi.daily.temperature_2m_max[d])}°</span><span>Tal ${Math.round(lo.daily.temperature_2m_min[d])}…${Math.round(lo.daily.temperature_2m_max[d])}°</span><span>${hi.daily.snowfall_sum[d] >= 0.5 ? '❄ ' + Math.round(hi.daily.snowfall_sum[d]) + ' cm' : 'kein Neuschnee'}</span></div>`);
  }
  $('wx-body').innerHTML = `<div class="wx-now"><div class="wx-big">${ic}</div><div><div class="wx-t">${txt}</div>
      <div class="wx-row"><span>Berg (${Math.round(w.hHigh)} m) <b>${Math.round(ch.temperature_2m)}°</b></span><span>Tal (${Math.round(w.hLow)} m) <b>${Math.round(c.temperature_2m)}°</b></span></div>
      <div class="wx-row"><span>Wind Berg ${Math.round(ch.wind_speed_10m)} km/h, Böen ${Math.round(ch.wind_gusts_10m)}</span></div>
      <div class="wx-row"><span>Nullgradgrenze ${fz != null ? Math.round(fz / 50) * 50 + ' m' : '–'}</span><span>Neuschnee 24 h (Berg) ${Math.round(new24)} cm</span>${sd != null ? `<span>Schneehöhe Tal (Modell) ${Math.round(sd * 100)} cm</span>` : ''}</div></div></div>
    <div class="wx-days">${days.join('')}</div>
    <div class="wx-src">Wetterdaten: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0) · Modellwerte, keine Pistenberichte</div>`;
}

// ---------------- boot ----------------
async function start(area) {
  $('start').classList.add('hidden'); $('loading').classList.remove('hidden');
  $('hd-name').textContent = area.name; $('hd-sub').textContent = area.place || '';
  document.title = area.name + ' · 3D Skikarte';
  try {
    progress('Verbinde …', 0.02);
    const data = await loadFeatures(area);
    if (!data.runs.length) throw new Error('Für dieses Skigebiet sind in OpenStreetMap keine Alpinpisten eingetragen.');
    // bbox of features + margin
    let w = 180, e = -180, s = 90, n = -90;
    for (const f of [...data.runs, ...data.lifts]) for (const [lo, la] of f[5]) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
    const mLat = 900 / 111320, mLon = 900 / (111320 * Math.cos((s + n) / 2 * Math.PI / 180));
    const bbox = { w: w - mLon, e: e + mLon, s: s - mLat, n: n + mLat };
    const { M, H } = await loadDEM(bbox);
    progress('Berechne Gelände und Steilheit …', 0.93);
    await new Promise(r => setTimeout(r, 30));
    const tex = makeTextures(M, H);
    $('img-base').src = tex.base; $('img-slope').src = tex.slope;
    await Promise.all(['img-base', 'img-slope'].map(id => $(id).decode().catch(() => { })));
    window.__META = M; window.__HGT = H; window.__FEATS = [...data.runs, ...data.lifts];
    window.__VIEW = { lon: (w + e) / 2, lat: (s + n) / 2, size: Math.max((e - w) * M.mlon, (n - s) * M.mlat) };
    progress('Fertig', 1);
    runApp();
    $('loading').classList.add('hidden');
    $('src-note').textContent = 'Pistendaten für dieses Gebiet: ' + (data.src || 'OpenSkiMap') + (data.partial ? ' – möglicherweise unvollständig.' : '.');
    // weather (non-blocking)
    let hl = Infinity, hh = -Infinity;
    for (const r of window.__app.runs) for (const q of r.s) { hl = Math.min(hl, q.h); hh = Math.max(hh, q.h); }
    loadWeather((s + n) / 2, (w + e) / 2, hl, hh).then(renderWeather).catch(() => { $('wx-chip').classList.add('hidden'); });
  } catch (err) {
    console.error(err);
    $('ld-text').textContent = (err && err.message && !/fetch/i.test(err.message)) ? err.message : 'Daten konnten nicht geladen werden. Internetverbindung prüfen.';
    $('ld-bar').style.width = '0%'; $('ld-back').classList.remove('hidden');
  }
}
function showStart() {
  $('start').classList.remove('hidden'); $('loading').classList.add('hidden');
  const inp = $('sr-input'); let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(() => doSearch(inp.value), 300); };
  document.querySelectorAll('.sr-chip').forEach(b => b.onclick = () => { inp.value = b.textContent; doSearch(b.textContent); });
  setTimeout(() => inp.focus(), 50);
}
$('btn-switch').onclick = $('ld-back').onclick = () => { LS.del('skiarea'); location.reload(); };
$('wx-chip').onclick = () => $('wx').classList.remove('hidden');
$('wx-close').onclick = () => $('wx').classList.add('hidden');
const area = LS.get('skiarea');
if (area && area.id) start(area); else showStart();
