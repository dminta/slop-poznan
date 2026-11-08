// tools/poz-blocks.mjs — Poznań curb islands, lot rects and frontage frames for tools/build-poznan.mjs: a 1 m raster
// of the detail box with the roadways stamped as capsules at their curb-to-curb width, 4-connected labelling, sidewalk
// erosion, greedy lot rects and frontage frames. Work happens at import time.
//
// What is not a block cell (in stamping order):
// - water and anything outside DETAIL_BOX (poz-water isLandAt), plus a STRIP-wide riverside strip;
// - plazas (pedestrian areas and place=square outlines). A pedestrian multipolygon's inner rings (the buildings standing
//   on the square: Stary Rynek's central block) are given back, grown by SIDEWALK so their property line is the
//   building outline;
// - every at-grade drivable piece except unnamed highway=service, bridges included (D7 decks sit at street level);
// - linear highway=pedestrian ways, outside plazas (inside, the plaza already clears them and they would cut the
//   buildings given back);
// - landuse=railway areas and the corridors of off-street tracks;
// - except the cells under a mapped railway building (station, depot, signal box, or an ordinary warehouse/workshop
//   of at least 60 m² whose centre lies on rail-cleared land), given back grown by SIDEWALK like the buildings on
//   plazas, but only outside the track corridor itself (see "Railway buildings" below).
//
// Only named service roads (167 pieces: Podwale, Wysoka, Stolarska, Za Cytadelą...) are stamped. The other 2,415 are
// courtyard and car-park lanes, many through building_passage gates. Stamped at 4 m, they cut 1,154 blocks against 802
// without them; the extra blocks were mostly courtyard slivers under 2,000 m² (blocks < 300 m²: 258 against 193;
// 300-2,000 m²: 289 against 143). The default road graph leaves service roads out too.
//
// Exports: blocks [{ id, poly, area, bbox, rect, rects, frames, park, parkName }] (poly an open [[x, z]] ring, negative
// winding; rects [[x0, x1, z0, z1]] axis-aligned lots; frames [[θ, px, pz, rects]] lots in the block's frame turned by θ
// about (px, pz), or null), STRIP, SIDEWALK, blockRaster, blockLabels.
import { load, log, toWorld, DETAIL_BOX } from './poz-base.mjs';
import { Raster, elemRings, rdpRing, ringArea } from './geo-util.mjs';
import { TRAM_W, pieces, plazas, pedestrianWays, railCorridors } from './poz-roads.mjs';
import { isLandAt } from './poz-water.mjs';
import { parkCellsByLabel } from './poz-extra.mjs';

// Riverside strip: the Warta embankments (Wybrzeże Wiadrowe, Chwaliszewo, Ostrów Tumski's bank paths) are 10-25 m of
// promenade and green between the water and the first street. 10 m keeps a walkable bank where a block would otherwise
// reach the waterline, and still leaves the narrow Chwaliszewo strip its riverside block.
const STRIP = 10;
const SIDEWALK = 4.6; // property line in from the curb (Poznań sidewalks are ≈ 3-5 m)
const RES = 1;
const T0 = Date.now();
const [BX0, BX1, BZ0, BZ1] = DETAIL_BOX;

// --- Land minus the riverside strip --------------------------------------------------------------------------------
const R = new Raster(BX0, BZ0, BX1, BZ1, RES);
const W = R.w, H = R.h, D = R.d;
{
  // Distance to water on a 2 m raster padded past the box. Cells outside the box count as land, so the box edge itself
  // is not a shore.
  const PAD = 40;
  const S = new Raster(BX0 - PAD, BZ0 - PAD, BX1 + PAD, BZ1 + PAD, 2);
  for (let j = 0; j < S.h; j++) {
    const z = S.z0 + (j + 0.5) * S.res;
    for (let i = 0; i < S.w; i++) {
      const x = S.x0 + (i + 0.5) * S.res;
      S.d[j * S.w + i] = x < BX0 || x > BX1 || z < BZ0 || z > BZ1 || isLandAt(x, z) ? 1 : 0;
    }
  }
  const toWater = STRIP > 0 ? S.edt((v) => v === 0) : null;
  const rc = (STRIP / S.res) ** 2;
  for (let j = 0; j < H; j++) {
    const z = R.z0 + (j + 0.5) * RES;
    const sj = Math.floor((z - S.z0) / S.res);
    for (let i = 0; i < W; i++) {
      const x = R.x0 + (i + 0.5) * RES;
      if (!isLandAt(x, z)) continue;
      const si = Math.floor((x - S.x0) / S.res);
      if (toWater && toWater[sj * S.w + si] <= rc) continue;
      D[j * W + i] = 1;
    }
  }
}

// --- Stamping helpers ----------------------------------------------------------------------------------------------
// Set (to `val`) every cell of raster M whose centre is within r of segment a-b and that `skip` does not mark
function stampSegmentOn(M, ax, az, bx, bz, r, val = 0, skip = null) {
  const { res, x0, z0, w, h, d } = M;
  const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / res));
  const ix1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + r - x0) / res));
  const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - r - z0) / res));
  const iz1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + r - z0) / res));
  if (ix0 > ix1 || iz0 > iz1) return;
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  const r2 = r * r;
  for (let j = iz0; j <= iz1; j++) {
    const pz = z0 + (j + 0.5) * res;
    for (let i = ix0; i <= ix1; i++) {
      const k = j * w + i;
      if (d[k] === val || (skip && skip[k])) continue;
      const px = x0 + (i + 0.5) * res;
      let t = ((px - ax) * dx + (pz - az) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px, ez = az + t * dz - pz;
      if (ex * ex + ez * ez <= r2) d[k] = val;
    }
  }
}
const stampSegment = (ax, az, bx, bz, r, val = 0, skip = null) => stampSegmentOn(R, ax, az, bx, bz, r, val, skip);
const stampLine = (pts, r, skip) => {
  for (let n = 0; n + 1 < pts.length; n++) stampSegment(pts[n][0], pts[n][1], pts[n + 1][0], pts[n + 1][1], r, 0, skip);
};
const inBox = (b, pad = 0) => b.x1 >= R.x0 - pad && b.x0 <= R.x0 + W * RES + pad && b.z1 >= R.z0 - pad && b.z0 <= R.z0 + H * RES + pad;

// --- Plazas: cleared, then the buildings standing on them given back ----------------------------------------------
// plazaMask marks the cells inside any plaza outline. A hole is restored on land only, grown by SIDEWALK with a
// Euclidean distance test so the property line of the restored island follows the building outline.
const plazaMask = new Uint8Array(W * H);
{
  const M = new Raster(R.x0, R.z0, R.x0 + (W - 1) * RES, R.z0 + (H - 1) * RES, RES);
  M.d = plazaMask;
  for (const p of plazas) M.fillRing(p.ring, 1);
  for (let k = 0; k < W * H; k++) if (plazaMask[k]) D[k] = 0;
  let restored = 0, cells = 0;
  for (const p of plazas) {
    for (const h of p.holes || []) {
      const local = new Raster(Math.min(...h.map((q) => q[0])) - SIDEWALK - 2, Math.min(...h.map((q) => q[1])) - SIDEWALK - 2,
        Math.max(...h.map((q) => q[0])) + SIDEWALK + 2, Math.max(...h.map((q) => q[1])) + SIDEWALK + 2, RES);
      local.fillRing(h, 1);
      const dist = local.edt((v) => v === 1);
      const r2 = (SIDEWALK / RES) ** 2;
      for (let j = 0; j < local.h; j++) {
        for (let i = 0; i < local.w; i++) {
          if (dist[j * local.w + i] > r2) continue;
          const gi = Math.round((local.x0 - R.x0) / RES) + i, gj = Math.round((local.z0 - R.z0) / RES) + j;
          if (gi < 0 || gj < 0 || gi >= W || gj >= H) continue;
          const k = gj * W + gi;
          if (!plazaMask[k] || D[k]) continue;
          const x = R.x0 + (gi + 0.5) * RES, z = R.z0 + (gj + 0.5) * RES;
          if (!isLandAt(x, z)) continue;
          D[k] = 1;
          cells++;
        }
      }
      restored++;
    }
  }
  log(`blocks: ${plazas.length} plazas cleared, ${restored} buildings on them given back (${cells} m²)`);
}

// --- Roadways, walking streets, rail land ------------------------------------------------------------------------
let stamped = 0, service = 0;
// A piece whose tram strip lies beside it (poz-roads.mjs tramSide) is stamped about the middle of carriageway and strip
for (const p of pieces) {
  if (p.cls === 'service' && !p.name) { service++; continue; }
  if (!p.tramSide) stampLine(p.pts, p.w / 2, null);
  else {
    const o = p.tramSide * TRAM_W / 2;
    for (let n = 0; n + 1 < p.pts.length; n++) {
      const [ax, az] = p.pts[n], [bx, bz] = p.pts[n + 1];
      const L = Math.hypot(bx - ax, bz - az) || 1, rx = -(bz - az) / L * o, rz = (bx - ax) / L * o;
      stampSegment(ax + rx, az + rz, bx + rx, bz + rz, p.w / 2, 0, null);
    }
  }
  stamped++;
}
for (const p of pedestrianWays) stampLine(p.pts, p.w / 2, plazaMask);
// Cells the rail stamp takes from an otherwise buildable cell: the station and depot buildings are given back out of
// this set only, so a rail building never reopens a road or water cell.
const railCleared = D.slice();
{
  const M = new Raster(R.x0, R.z0, R.x0 + (W - 1) * RES, R.z0 + (H - 1) * RES, RES);
  M.d = D;
  for (const r of railCorridors.rings) M.fillRing(r, 0);
  for (const l of railCorridors.lines) stampLine(l.pts, l.w / 2, null);
}
for (let k = 0; k < W * H; k++) if (railCleared[k] && D[k]) railCleared[k] = 0;
log(`blocks: ${stamped} road pieces stamped (${service} unnamed service pieces not), ${pedestrianWays.length} pedestrian ways, rail land ${railCorridors.rings.length} rings + ${railCorridors.lines.length} track corridors`);

// --- Railway buildings: islands inside the cleared rail land --------------------------------------------------------
// `landuse=railway` and the track corridors clear the whole yard, stations and depots included. OSM maps those
// buildings, so give their footprints back grown by SIDEWALK (the property line, as for the buildings on plazas) and
// leave the track corridor itself clear: the rail stamp is 5 m wide per mainline track and 4 m per tram, and the
// restored cells keep one more metre off the axes so no lot or building can stand on the trackbed.
const RAIL_BUILDING = new Set(['train_station', 'transportation', 'station', 'railway_station', 'bus_station',
  'engine_shed']);
const RAIL_BUILDING_NAME = /dworzec|zajezdni|parowozownia|lokomotywownia|pkp|kolejow|zntk|bocznica|nastawni|signal.?box|centrum sterowania/i;
// Ordinary warehouses and workshops on landuse=railway also count (audit 2026-11-08: only stations/depots were given
// back, so ZNTK's stores and the yard sheds stayed cut). A footprint is a rail building when it is explicit above, or
// when it is at least 60 m² and its centre lies on a cell the rail stamp removed.
const RAIL_BUILDING_MIN = 60;
{
  const K = new Raster(R.x0, R.z0, R.x0 + (W - 1) * RES, R.z0 + (H - 1) * RES, RES);
  const trackKeep = new Uint8Array(W * H);
  K.d = trackKeep;
  for (const l of railCorridors.lines) {
    const r = l.w / 2 + 1;
    for (let n = 0; n + 1 < l.pts.length; n++) stampSegmentOn(K, l.pts[n][0], l.pts[n][1], l.pts[n + 1][0], l.pts[n + 1][1], r, 1);
  }
  const osm = load('poz_buildings.json');
  let islands = 0, cells = 0, skipped = 0;
  for (const e of osm.elements) {
    const t = e.tags || {};
    const kind = String(t.building || '').toLowerCase().split(';')[0];
    if (!kind || kind === 'roof' || kind === 'no') continue;
    const name = `${t.name || ''} ${t['name:pl'] || ''}`;
    const explicit = RAIL_BUILDING.has(kind) || !!t.railway || RAIL_BUILDING_NAME.test(name);
    const outer = elemRings(e, toWorld).filter((r) => r.length > 3);
    if (!outer.length) { if (explicit) skipped++; continue; }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of outer) for (const [x, z] of r) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (x1 < R.x0 - SIDEWALK || x0 > R.x0 + W * RES + SIDEWALK ||
      z1 < R.z0 - SIDEWALK || z0 > R.z0 + H * RES + SIDEWALK) { if (explicit) skipped++; continue; }
    if (!explicit) {
      const area = Math.abs(outer.reduce((s, r) => s + ringArea(r), 0));
      if (area < RAIL_BUILDING_MIN) continue;
      // The centre must be on rail land the stamp cleared; a shed beside a track but on an ordinary street block is
      // left to the curb-island pass.
      const ci = Math.floor(((x0 + x1) * 0.5 - R.x0) / RES), cj = Math.floor(((z0 + z1) * 0.5 - R.z0) / RES);
      if (ci < 0 || cj < 0 || ci >= W || cj >= H || !railCleared[cj * W + ci]) continue;
    }
    const inner = elemRings(e, toWorld, 'inner').filter((r) => r.length > 3);
    const local = new Raster(x0 - SIDEWALK - 2, z0 - SIDEWALK - 2, x1 + SIDEWALK + 2, z1 + SIDEWALK + 2, RES);
    for (const r of outer) local.fillRing(r, 1);
    for (const r of inner) local.fillRing(r, 0);
    const dist = local.edt((v) => v === 1);
    const r2 = (SIDEWALK / RES) ** 2;
    let restored = 0;
    for (let j = 0; j < local.h; j++) {
      for (let i = 0; i < local.w; i++) {
        if (dist[j * local.w + i] > r2) continue;
        const gi = Math.round((local.x0 - R.x0) / RES) + i, gj = Math.round((local.z0 - R.z0) / RES) + j;
        if (gi < 0 || gj < 0 || gi >= W || gj >= H) continue;
        const k = gj * W + gi;
        const footprint = local.d[j * local.w + i] === 1;
        // The footprint itself comes back whole: a depot hall covers its yard tracks, and those tracks are under the
        // roof. Only the SIDEWALK margin stops at the track corridor, so the property line never runs along the bed.
        if (D[k] || !railCleared[k] || (trackKeep[k] && !footprint)) continue;
        // The margin must not bridge two existing curb islands across a narrow rail strip. A one-cell moat keeps the
        // restored building a block of its own; only a footprint touching a block outright (a station on the street)
        // joins it.
        if (!footprint && (
          (gi > 0 && D[k - 1] && !railCleared[k - 1]) || (gi < W - 1 && D[k + 1] && !railCleared[k + 1]) ||
          (gj > 0 && D[k - W] && !railCleared[k - W]) || (gj < H - 1 && D[k + W] && !railCleared[k + W]))) continue;
        const x = R.x0 + (gi + 0.5) * RES, z = R.z0 + (gj + 0.5) * RES;
        if (!isLandAt(x, z)) continue;
        D[k] = 1;
        restored++;
      }
    }
    if (restored) { islands++; cells += restored; }
  }
  log(`blocks: ${islands} railway building islands given back from rail land (${cells} m², ${skipped} footprints outside the box or with no cells)`);
}

// --- Label curb islands (4-connected) ------------------------------------------------------------------------------
const lab = new Int32Array(W * H);
const comps = [];
{
  const stack = new Int32Array(W * H > 4e7 ? 4e7 : W * H);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!D[s0] || lab[s0]) continue;
    const id = comps.length + 1;
    let sp = 0, n = 0, i0 = W, i1 = -1, j0 = H, j1 = -1;
    stack[sp++] = s0;
    lab[s0] = id;
    while (sp) {
      const p = stack[--sp];
      n++;
      const i = p % W, j = (p - i) / W;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      if (i > 0 && D[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (i < W - 1 && D[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (j > 0 && D[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
      if (j < H - 1 && D[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
    }
    comps.push({ id, n, i0, i1, j0, j1, start: s0 });
  }
}
log(`blocks: ${comps.length} curb islands labelled`);

// --- Contour of one component (corner walk keeping the component on the right) --------------------------------------
function traceComponent(c) {
  const at = (i, j) => (i >= 0 && j >= 0 && i < W && j < H && lab[j * W + i] === c.id ? 1 : 0);
  const si = c.start % W, sj = (c.start - si) / W;
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  let cx = si, cz = sj, dir = 0;
  const pts = [];
  let guard = 0;
  do {
    pts.push([R.x0 + cx * RES, R.z0 + cz * RES]);
    cx += DX[dir];
    cz += DZ[dir];
    let left, right;
    if (dir === 0) { left = at(cx, cz - 1); right = at(cx, cz); }
    else if (dir === 1) { left = at(cx, cz); right = at(cx - 1, cz); }
    else if (dir === 2) { left = at(cx - 1, cz); right = at(cx - 1, cz - 1); }
    else { left = at(cx - 1, cz - 1); right = at(cx, cz - 1); }
    if (left && right) dir = (dir + 3) % 4;
    else if (!right) dir = (dir + 1) % 4;
    if (++guard > 4e6) break;
  } while (cx !== si || cz !== sj || dir !== 0);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], n = pts[(i + 1) % pts.length];
    if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) out.push(q);
  }
  return destair(out, RES * 1.5);
}
// Raster stairs -> lines: short edges (stair steps) are replaced by their midpoints, vertices between two long edges
// (true corners) are kept
function destair(out, short) {
  const n = out.length;
  const len = (i) => { const a = out[i], b = out[(i + 1) % n]; return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]); };
  const res = [];
  for (let i = 0; i < n; i++) {
    const prevLong = len((i + n - 1) % n) > short;
    const nextLong = len(i) > short;
    if (prevLong && nextLong) res.push(out[i]);
    if (!nextLong) { const a = out[i], b = out[(i + 1) % n]; res.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  }
  return res;
}

// --- Property line: square erosion of each island by the sidewalk width ------------------------------------------
const ER = Math.round(SIDEWALK / RES);
const prop = new Uint8Array(W * H);
{
  const tmp = new Uint8Array(W * H);
  const left = new Int32Array(W);
  for (let j = 0; j < H; j++) {
    const row = j * W;
    let run = 0;
    for (let i = 0; i < W; i++) {
      const L = lab[row + i];
      run = L && i > 0 && lab[row + i - 1] === L ? run + 1 : L ? 1 : 0;
      left[i] = run;
    }
    run = 0;
    for (let i = W - 1; i >= 0; i--) {
      const L = lab[row + i];
      run = L && i < W - 1 && lab[row + i + 1] === L ? run + 1 : L ? 1 : 0;
      tmp[row + i] = L && left[i] > ER && run > ER ? 1 : 0;
    }
  }
  const up = new Int32Array(H);
  for (let i = 0; i < W; i++) {
    let run = 0;
    for (let j = 0; j < H; j++) {
      const k = j * W + i, L = lab[k];
      run = L && j > 0 && lab[k - W] === L ? run + 1 : L ? 1 : 0;
      up[j] = run;
    }
    run = 0;
    for (let j = H - 1; j >= 0; j--) {
      const k = j * W + i, L = lab[k];
      run = L && j < H - 1 && lab[k + W] === L ? run + 1 : L ? 1 : 0;
      prop[k] = tmp[k] && up[j] > ER && run > ER ? 1 : 0;
    }
  }
}

// --- Greedy axis-aligned lot rects (largest rectangle in a histogram) ----------------------------------------------
function maskRects(m, w, h, maxRects = 8, minSide = 8) {
  let total = 0;
  for (let k = 0; k < w * h; k++) total += m[k];
  const rects = [];
  const hist = new Int32Array(w);
  const stack = new Int32Array(w + 1);
  let covered = 0;
  for (let it = 0; it < maxRects; it++) {
    hist.fill(0);
    let best = 0, bi0 = 0, bi1 = 0, bj0 = 0, bj1 = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) hist[i] = m[j * w + i] ? hist[i] + 1 : 0;
      let sp = 0;
      for (let i = 0; i <= w; i++) {
        const hh = i < w ? hist[i] : 0;
        while (sp && hist[stack[sp - 1]] >= hh) {
          const top = stack[--sp];
          const height = hist[top];
          const left = sp ? stack[sp - 1] + 1 : 0;
          const width = i - left;
          if (height >= minSide && width >= minSide) {
            const area = height * width;
            if (area > best) { best = area; bi0 = left; bi1 = i - 1; bj0 = j - height + 1; bj1 = j; }
          }
        }
        stack[sp++] = i;
      }
    }
    // 2% (it was 6%): with the higher caps below, the deep holes of the big irregular blocks shrank from 115 k to
    // 76 k m² round Królowej Jadwigi, +385 k m² built over the detail box
    if (best < 120 || (rects.length && best < total * 0.02)) break;
    rects.push([bi0, bi1, bj0, bj1]);
    covered += best;
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) m[j * w + i] = 0;
    if (covered > total * 0.93) break;
  }
  return { rects, total, covered };
}
function lotRects(c, maxRects = 8) {
  const w = c.i1 - c.i0 + 1, h = c.j1 - c.j0 + 1;
  const m = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (c.j0 + j) * W + c.i0 + i;
    if (prop[k] && lab[k] === c.id) m[j * w + i] = 1;
  }
  const { rects, total, covered } = maskRects(m, w, h, maxRects);
  return {
    rects: rects.map(([i0, i1, j0, j1]) => [R.x0 + (c.i0 + i0) * RES, R.x0 + (c.i0 + i1 + 1) * RES, R.z0 + (c.j0 + j0) * RES, R.z0 + (c.j0 + j1 + 1) * RES]),
    propArea: total,
    covered
  };
}

// --- Frontage frames -------------------------------------------------------------------------------------------------
// A block whose outline is not an axis-aligned rect gets up to 3 frames, one per dominant street direction: outline
// edges cluster by direction (mod 90°, within 7°; a later cluster needs 12% of the perimeter), each island cell goes
// to the cluster of its nearest edge, and lot rects are packed in each cluster's turned raster, its own region first,
// then whatever the other frames left. Null when the only direction is within 2° of the axes. With bearing 0 nearly
// every Poznań block takes this path. The nearest-edge search scans the edges by their z-distance from the cell's row
// and stops once that alone can't beat the best distance found, which keeps big park and rail-side islands with
// hundreds of edges cheap.
const DEG = Math.PI / 180;
const wrap90 = (a) => ((((a + Math.PI / 4) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) - Math.PI / 4;
function blockFrames(c, poly) {
  const edges = [];
  let per = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    edges.push({ ax, az, bx, bz, L, phi: wrap90(Math.atan2(bz - az, bx - ax)), k: -1 });
    per += L;
  }
  const clusters = [];
  for (let n = 0; n < 3; n++) {
    let seed = null, seedW = 0;
    for (const e of edges) {
      if (e.k >= 0 || e.L < 4) continue;
      let w = 0;
      for (const f of edges) if (f.k < 0 && Math.abs(wrap90(f.phi - e.phi)) <= 7 * DEG) w += f.L;
      if (w > seedW) { seedW = w; seed = e; }
    }
    if (!seed || seedW < 14 || (n > 0 && seedW < per * 0.12)) break;
    const members = edges.filter((f) => f.k < 0 && Math.abs(wrap90(f.phi - seed.phi)) <= 7 * DEG);
    let sx = 0, sy = 0;
    for (const f of members) { sx += f.L * Math.cos(4 * f.phi); sy += f.L * Math.sin(4 * f.phi); }
    for (const f of members) f.k = clusters.length;
    clusters.push({ phi: Math.atan2(sy, sx) / 4 });
  }
  if (!clusters.length || (clusters.length === 1 && Math.abs(clusters[0].phi) < 2 * DEG)) return null;
  for (const e of edges) {
    if (e.k >= 0) continue;
    let bd = Infinity;
    clusters.forEach((cl, k) => { const d = Math.abs(wrap90(e.phi - cl.phi)); if (d < bd) { bd = d; e.k = k; } });
  }

  // Island cells -> cluster of the nearest outline edge
  const w = c.i1 - c.i0 + 1, h = c.j1 - c.j0 + 1;
  const owner = new Int8Array(w * h).fill(-1);
  const sorted = edges.map((e) => ({ e, x0: Math.min(e.ax, e.bx), x1: Math.max(e.ax, e.bx), z0: Math.min(e.az, e.bz), z1: Math.max(e.az, e.bz) }));
  for (let j = 0; j < h; j++) {
    const pz = R.z0 + (c.j0 + j + 0.5) * RES;
    // edges by their z-distance from this row: a lower bound on the distance from any cell of the row
    const rowOrder = sorted.map((s) => ({ s, dz: pz < s.z0 ? s.z0 - pz : pz > s.z1 ? pz - s.z1 : 0 })).sort((a, b) => a.dz - b.dz);
    for (let i = 0; i < w; i++) {
      if (lab[(c.j0 + j) * W + c.i0 + i] !== c.id) continue;
      if (clusters.length === 1) { owner[j * w + i] = 0; continue; }
      const px = R.x0 + (c.i0 + i + 0.5) * RES;
      let bd = Infinity, bk = 0;
      for (const { s, dz } of rowOrder) {
        if (dz * dz >= bd) break;
        const dxb = px < s.x0 ? s.x0 - px : px > s.x1 ? px - s.x1 : 0;
        if (dxb * dxb + dz * dz >= bd) continue;
        const e = s.e;
        const dx = e.bx - e.ax, dzz = e.bz - e.az;
        let t = ((px - e.ax) * dx + (pz - e.az) * dzz) / (e.L * e.L);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = e.ax + t * dx - px, ez = e.az + t * dzz - pz;
        const d = ex * ex + ez * ez;
        if (d < bd) { bd = d; bk = e.k; }
      }
      owner[j * w + i] = bk;
    }
  }

  const px = R.x0 + ((c.i0 + c.i1 + 1) * RES) / 2;
  const pz = R.z0 + ((c.j0 + c.j1 + 1) * RES) / 2;
  const views = clusters.map((cl, k) => {
    const th = -cl.phi;
    const cs = Math.cos(th), sn = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of [[c.i0, c.j0], [c.i1 + 1, c.j0], [c.i0, c.j1 + 1], [c.i1 + 1, c.j1 + 1]]) {
      const dx = R.x0 + x * RES - px, dz = R.z0 + z * RES - pz;
      const u = px + dx * cs - dz * sn, v = pz + dx * sn + dz * cs;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    u0 = Math.floor(u0); v0 = Math.floor(v0);
    const lw = Math.ceil(u1 - u0) + 1, lh = Math.ceil(v1 - v0) + 1;
    const isl = new Uint8Array(lw * lh);
    const reg = new Uint8Array(lw * lh);
    const cell = new Int32Array(lw * lh).fill(-1);
    for (let j = 0; j < lh; j++) {
      const dv = v0 + j + 0.5 - pz;
      for (let i = 0; i < lw; i++) {
        const du = u0 + i + 0.5 - px;
        const x = px + du * cs + dv * sn, z = pz - du * sn + dv * cs;
        const gi = Math.floor((x - R.x0) / RES) - c.i0, gj = Math.floor((z - R.z0) / RES) - c.j0;
        if (gi < 0 || gj < 0 || gi >= w || gj >= h) continue;
        const o = owner[gj * w + gi];
        if (o < 0) continue;
        isl[j * lw + i] = 1;
        cell[j * lw + i] = gj * w + gi;
        if (o === k) reg[j * lw + i] = 1;
      }
    }
    const tmp = new Uint8Array(lw * lh);
    for (let j = 0; j < lh; j++) {
      let run = 0;
      const left = new Int32Array(lw);
      for (let i = 0; i < lw; i++) { run = isl[j * lw + i] ? run + 1 : 0; left[i] = run; }
      run = 0;
      for (let i = lw - 1; i >= 0; i--) { run = isl[j * lw + i] ? run + 1 : 0; tmp[j * lw + i] = left[i] > ER && run > ER ? 1 : 0; }
    }
    const vprop = new Uint8Array(lw * lh);
    for (let i = 0; i < lw; i++) {
      let run = 0;
      const up = new Int32Array(lh);
      for (let j = 0; j < lh; j++) { run = isl[j * lw + i] ? run + 1 : 0; up[j] = run; }
      run = 0;
      for (let j = lh - 1; j >= 0; j--) {
        run = isl[j * lw + i] ? run + 1 : 0;
        vprop[j * lw + i] = tmp[j * lw + i] && up[j] > ER && run > ER ? 1 : 0;
      }
    }
    return { th, u0, v0, lw, lh, prop: vprop, reg, cell, rects: [] };
  });
  const used = new Uint8Array(w * h);
  const markUsed = (k) => {
    const gi = k % w, gj = (k - gi) / w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = gi + di, j = gj + dj;
      if (i >= 0 && j >= 0 && i < w && j < h) used[j * w + i] = 1;
    }
  };
  for (const pass of [1, 2]) {
    for (const vw of views) {
      const { lw, lh, prop: vp, reg, cell } = vw;
      const m = new Uint8Array(lw * lh);
      for (let k = 0; k < lw * lh; k++) m[k] = vp[k] && (pass === 2 || reg[k]) && cell[k] >= 0 && !used[cell[k]] ? 1 : 0;
      const { rects } = maskRects(m, lw, lh, pass === 1 ? 12 : 10, 12);
      for (const [i0, i1, j0, j1] of rects) {
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (cell[j * lw + i] >= 0) markUsed(cell[j * lw + i]);
        vw.rects.push([vw.u0 + i0, vw.u0 + i1 + 1, vw.v0 + j0, vw.v0 + j1 + 1]);
      }
    }
  }
  const frames = views.filter((vw) => vw.rects.length).map((vw) => [vw.th, px, pz, vw.rects]);
  return frames.length ? frames : null;
}

// --- Assemble blocks -----------------------------------------------------------------------------------------------
const T1 = Date.now();
const blocks = [];
let small = 0;
for (const c of comps) {
  const area = c.n * RES * RES;
  if (area < 40) { small++; continue; }
  let poly = traceComponent(c);
  poly = rdpRing(poly, 0.5);
  if (poly.length < 3) continue;
  if (ringArea(poly) > 0) poly.reverse();
  const bw = (c.i1 - c.i0 + 1) * RES, bd = (c.j1 - c.j0 + 1) * RES;
  const rectness = area / (bw * bd);
  const { rects, propArea, covered } = area >= 300 ? lotRects(c) : { rects: [], propArea: 0, covered: 0 };
  const frames = rectness <= 0.985 && area >= 300 ? blockFrames(c, poly) : null;
  blocks.push({
    id: blocks.length,
    label: c.id,
    poly,
    area: Math.round(area),
    bbox: [R.x0 + c.i0 * RES, R.x0 + (c.i1 + 1) * RES, R.z0 + c.j0 * RES, R.z0 + (c.j1 + 1) * RES],
    rect: rectness > 0.985,
    rects,
    frames,
    fill: propArea ? Math.round((covered / propArea) * 100) / 100 : 0
  });
}
const T2 = Date.now();

// --- Park share (share of the block's cells under park land, the park's name above 25 %) ---------------------------
{
  const byLabel = parkCellsByLabel(R, lab);
  let named = 0;
  for (const b of blocks) {
    const pc = byLabel.get(b.label);
    b.park = pc ? Math.min(1, Math.round((pc.cells / b.area) * 100) / 100) : 0;
    b.parkName = pc && b.park > 0.25 ? pc.name : '';
    if (b.parkName) named++;
  }
  log(`blocks: ${blocks.filter((b) => b.park > 0.5).length} mostly park (> 50 %), ${named} carry a park name`);
}
log(`blocks: ${blocks.length} (${blocks.filter((b) => b.rect).length} rectangular, ${blocks.filter((b) => !b.rects.length).length} without lots); ${small} specks dropped`);
log(`blocks: ${blocks.filter((b) => b.frames).length} with frontage frames (${blocks.reduce((t, b) => t + (b.frames ? b.frames.length : 0), 0)} frames); raster ${W} × ${H}, ${T1 - T0} ms stamping and labelling, ${T2 - T1} ms outlines, lots and frames`);

export { blocks, STRIP, SIDEWALK, R as blockRaster, lab as blockLabels };
