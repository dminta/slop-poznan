// tools/poz-canopies.mjs — open platform, station, fuel-station and market canopies for tools/build-poznan.mjs.
// The building snapshot keeps every building=roof outline, but poz-buildings.mjs deliberately leaves it out of the
// built mass: a roof has no walls. The world then lost the platform canopies of Poznań Główny, Dworzec Zachodni,
// Dworzec Letni, the tram loop shelters and the petrol-station forecourts (1,038 OSM roof elements, 210 of them at
// least 60 m², 0.87 km² of outline). This module turns those outlines into oriented rectangular canopy records plus
// their regular column grid, keeping a 2.6 m column clearance from every GEO.rail centreline so no pillar stands in a
// running line.
//
// - One canopy per outer ring of at least MIN_AREA 60 m², inside the detail box. Small bins, kiosk roofs and bicycle
//   shelters are below the threshold; 149 of 210 large roofs are within 15% of their minimum-area rectangle, and the
//   few irregular outlines that would overbuild by more than RECT_MAX 2.4x are dropped unless they are a platform,
//   tram, fuel or market canopy.
// - `kind` (platform, tram, fuel, market, shelter, roof) comes from the OSM tags and the proximity to rail/tram track
//   and tram stops. It only picks the canopy's height, colour and column material.
// - `clearance` is the underside: 4.5-5.6 m, above a 4.3 m train/tram body and a 1.9 m pedestrian. `h` is the top of
//   the 0.35-0.6 m slab, 4.8-6.2 m above the ground. The roof never reaches a vehicle body; the columns are the only
//   colliders.
// - Columns run in two or three rows along the long side, 6-8 m apart, inset 0.7 m from the edges. A candidate within
//   RAIL_COLUMN_KEEP 2.6 m of a track centreline is skipped; a canopy that loses every candidate is dropped rather
//   than left floating.
//
// Exports: canopies as [{ x0, x1, z0, z1, h, clearance, kind, cx, cz, w, d, ang, area, columns: [x, z, ...] }];
// x0..z1 is the axis-aligned bounds, cx/cz/w/d/ang the oriented rectangle (ang: long side east from +x towards +z,
// radians; turn a local +x to world (cos ang, sin ang); the runtime uses rotation.y = -ang), area the OSM ring area,
// and columns a flat world [x, z, ...] list (0.4 m square posts).
import { DETAIL_BOX, load, log, toWorld } from './poz-base.mjs';
import { elemRings, ringArea } from './geo-util.mjs';
import { rail, tramStops } from './poz-roads.mjs';

const MIN_AREA = 60; // m²; below this a roof is a bin lid, a kiosk awning or a bus-shelter top
const RECT_MAX = 2.4; // drop generic shapes whose minimum rectangle overbuilds their outline by more than this
const COLUMN_INSET = 0.7; // m from the roof edge
const COLUMN_BAY = 7.5; // m, nominal spacing along the long side
// metres from every track centreline: outside a 1.5 m train/tram body half-width plus sway; +0.1 m absorbs rounding
const RAIL_COLUMN_KEEP = 2.6;
const [BX0, BX1, BZ0, BZ1] = DETAIL_BOX;

// Height table, m: underside clearance and top of the slab. A platform roof sits above a train body and its doors;
// a fuel forecourt is lower, a market hall higher. Both stay inside the 4.5-6.5 m band the world expects.
const SPEC = {
  platform: { clearance: 5.0, h: 5.4, column: 'concrete' },
  tram: { clearance: 4.8, h: 5.2, column: 'steel' },
  fuel: { clearance: 4.6, h: 5.0, column: 'steel' },
  market: { clearance: 5.6, h: 6.2, column: 'steel' },
  shelter: { clearance: 4.5, h: 4.8, column: 'steel' },
  roof: { clearance: 4.6, h: 5.0, column: 'steel' }
};

// --- Rail distance index --------------------------------------------------------------------------------------------
// Same 32 m bucket idea as city-grid.js's railClearance, but built once here so classification and column placement
// can both ask for the nearest mainline/tram centreline. Kind is kept so a roof beside a tram track is not mistaken
// for a railway platform.
const RAIL_CELL = 32;
const railCells = new Map();
const railSegs = [];
for (const r of rail) {
  const p = r.pts;
  for (let i = 0; i + 1 < p.length; i++) {
    const s = { ax: p[i][0], az: p[i][1], bx: p[i + 1][0], bz: p[i + 1][1], mainline: r.kind === 'rail' };
    railSegs.push(s);
    const ix0 = Math.floor(Math.min(s.ax, s.bx) / RAIL_CELL), ix1 = Math.floor(Math.max(s.ax, s.bx) / RAIL_CELL);
    const iz0 = Math.floor(Math.min(s.az, s.bz) / RAIL_CELL), iz1 = Math.floor(Math.max(s.az, s.bz) / RAIL_CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = `${ix},${iz}`;
        if (!railCells.has(k)) railCells.set(k, []);
        railCells.get(k).push(s);
      }
    }
  }
}
const STOPS = tramStops.filter((s) => s.x >= BX0 && s.x <= BX1 && s.z >= BZ0 && s.z <= BZ1);
const STOP_CELL = 32;
const stopCells = new Map();
for (const s of STOPS) {
  const k = `${Math.floor(s.x / STOP_CELL)},${Math.floor(s.z / STOP_CELL)}`;
  if (!stopCells.has(k)) stopCells.set(k, []);
  stopCells.get(k).push(s);
}

/** Distance from (x, z) to the nearest rail centreline, capped at `reach`; `mainline` limits it to railway track. */
function railDistance(x, z, reach = 26, mainline = null) {
  let best = reach;
  for (let ix = Math.floor((x - reach) / RAIL_CELL); ix <= Math.floor((x + reach) / RAIL_CELL); ix++) {
    for (let iz = Math.floor((z - reach) / RAIL_CELL); iz <= Math.floor((z + reach) / RAIL_CELL); iz++) {
      for (const s of railCells.get(`${ix},${iz}`) || []) {
        if (mainline !== null && s.mainline !== mainline) continue;
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const L2 = ex * ex + ez * ez;
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
        best = Math.min(best, Math.hypot(s.ax + ex * t - x, s.az + ez * t - z));
      }
    }
  }
  return best;
}

function nearTramStop(x, z, reach = 20) {
  let best = reach;
  for (let ix = Math.floor((x - reach) / STOP_CELL); ix <= Math.floor((x + reach) / STOP_CELL); ix++) {
    for (let iz = Math.floor((z - reach) / STOP_CELL); iz <= Math.floor((z + reach) / STOP_CELL); iz++) {
      for (const s of stopCells.get(`${ix},${iz}`) || []) best = Math.min(best, Math.hypot(s.x - x, s.z - z));
    }
  }
  return best;
}

// --- Minimum-area rectangle ----------------------------------------------------------------------------------------
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const normAngle = (a) => {
  while (a < -Math.PI / 2) a += Math.PI;
  while (a >= Math.PI / 2) a -= Math.PI;
  return a;
};

/** Oriented minimum-area rectangle of a ring: { cx, cz, w (long side), d, ang, area } */
function minRect(ring) {
  const hull = convexHull(ring);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cs = Math.cos(th), sn = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of hull) {
      const u = x * cs + z * sn, v = -x * sn + z * cs;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, th, cs, sn, u0, u1, v0, v1 };
  }
  const midU = (best.u0 + best.u1) * 0.5, midV = (best.v0 + best.v1) * 0.5;
  // Centre in world before the axes are swapped: the projection above uses best.cs / best.sn.
  const cx = midU * best.cs - midV * best.sn;
  const cz = midU * best.sn + midV * best.cs;
  let ang = normAngle(best.th);
  let w = best.u1 - best.u0, d = best.v1 - best.v0;
  // Long side along local +x keeps the bay rhythm and the two-column rows readable.
  if (d > w) {
    [w, d] = [d, w];
    ang = normAngle(ang + Math.PI / 2);
  }
  return { cx, cz, w, d, ang, area: best.area };
}

// --- Columns -------------------------------------------------------------------------------------------------------
/** Local grid of column centres for a w (long) x d rectangle, before the rail filter. */
function columnGrid(w, d) {
  const hw = w * 0.5 - COLUMN_INSET, hd = d * 0.5 - COLUMN_INSET;
  const out = [];
  if (hw <= 0 || hd <= 0) return out;
  const rows = d >= 7 ? [-hd, 0, hd] : d >= 2.4 ? [-hd, hd] : [0];
  const bays = Math.max(2, Math.round((hw * 2) / COLUMN_BAY) + 1);
  for (const v of rows) {
    for (let i = 0; i < bays; i++) {
      const u = -hw + (i * hw * 2) / (bays - 1);
      out.push([u, v]);
    }
  }
  return out;
}

function canopyColumns(rect, kind) {
  const { cx, cz, w, d, ang } = rect;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const columns = [];
  const seen = new Set();
  for (const [u, v] of columnGrid(w, d)) {
    const x = cx + u * cs - v * sn;
    const z = cz + u * sn + v * cs;
    if (railDistance(x, z, RAIL_COLUMN_KEEP + 1) < RAIL_COLUMN_KEEP) continue;
    const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push(x, z);
  }
  // A long platform canopy can lose a whole row to the tracks between platforms: keep the far edge only. If nothing
  // survives, the outline is a roof over a running yard and is left out of GEO.canopies entirely.
  return columns;
}

// --- Classification ------------------------------------------------------------------------------------------------
const PLATFORM_NOTE = /zadaszenie peronu|peron|przystanek|platform/i;
const MARKET_NOTE = /targ|market|hala targ/i;
const FUEL_TAG = (t) => t.amenity === 'fuel' || t.amenity === 'car_wash' || t.car_wash === 'yes' ||
  !!t['fuel:diesel'] || !!t['fuel:octane_95'] || !!t['fuel:lpg'];

function classify(tags, rect, ring) {
  const name = `${tags.name || ''} ${tags['name:pl'] || ''} ${tags.note || ''}`;
  let nearMain = Infinity, nearTram = Infinity;
  for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 8))) {
    const [x, z] = ring[i];
    nearMain = Math.min(nearMain, railDistance(x, z, 40, true));
    nearTram = Math.min(nearTram, railDistance(x, z, 40, false));
  }
  nearMain = Math.min(nearMain, railDistance(rect.cx, rect.cz, 40, true));
  nearTram = Math.min(nearTram, railDistance(rect.cx, rect.cz, 40, false));
  if (PLATFORM_NOTE.test(name) || tags.railway || tags.public_transport) return 'platform';
  if (FUEL_TAG(tags)) return 'fuel';
  if (MARKET_NOTE.test(name) || tags.amenity === 'marketplace') return 'market';
  if (tags.amenity === 'shelter' || tags.shelter_type) return nearTram < 25 ? 'tram' : 'shelter';
  // An unnamed 10-20 m wide strip beside the mainline is a platform canopy; the OSM note only survives on a few of
  // them. Random trackside sheds are short, so the long/narrow ratio keeps them out.
  if (nearMain < 22 && rect.w >= 10 && rect.d >= 3 && rect.w / rect.d >= 2.5) return 'platform';
  if (nearTram < 10 && nearTramStop(rect.cx, rect.cz, 20) < 15 && rect.w >= 8) return 'tram';
  return 'roof';
}

// --- Build ---------------------------------------------------------------------------------------------------------
const osm = load('poz_buildings.json');
const r1 = (v) => Math.round(v * 10) / 10;
const canopies = [];
let rings = 0, tooSmall = 0, tooIrregular = 0, noColumns = 0, outside = 0;
for (const e of osm.elements) {
  if (!e.tags || e.tags.building !== 'roof') continue;
  for (const ring of elemRings(e, toWorld)) {
    if (ring.length < 3) continue;
    rings++;
    const area = Math.abs(ringArea(ring));
    if (area < MIN_AREA) { tooSmall++; continue; }
    const rect = minRect(ring);
    if (!rect) continue;
    if (rect.cx < BX0 || rect.cx > BX1 || rect.cz < BZ0 || rect.cz > BZ1) { outside++; continue; }
    const kind = classify(e.tags, rect, ring);
    // Keep the real platform/fuel/market roofs even when the outline is an L or a curve: their rectangles are still a
    // useful approximation and the alternative is no canopy at all. Ordinary irregular pergolas are dropped.
    if (rect.area > area * RECT_MAX && kind === 'roof') { tooIrregular++; continue; }
    const spec = SPEC[kind];
    const height = Math.min(6.5, Math.max(4.8, spec.h));
    const clearance = Math.min(height - 0.35, Math.max(4.5, spec.clearance));
    const columns = canopyColumns(rect, kind);
    if (!columns.length) { noColumns++; continue; }
    const cs = Math.cos(rect.ang), sn = Math.sin(rect.ang);
    const hw = rect.w * 0.5, hd = rect.d * 0.5;
    const xs = [0, 1, 2, 3].map((i) => {
      const u = i === 0 || i === 3 ? -hw : hw;
      const v = i < 2 ? -hd : hd;
      return rect.cx + u * cs - v * sn;
    });
    const zs = [0, 1, 2, 3].map((i) => {
      const u = i === 0 || i === 3 ? -hw : hw;
      const v = i < 2 ? -hd : hd;
      return rect.cz + u * sn + v * cs;
    });
    canopies.push({
      x0: r1(Math.min(...xs)), x1: r1(Math.max(...xs)),
      z0: r1(Math.min(...zs)), z1: r1(Math.max(...zs)),
      h: r1(height), clearance: r1(clearance), kind,
      cx: r1(rect.cx), cz: r1(rect.cz), w: r1(rect.w), d: r1(rect.d), ang: Math.round(rect.ang * 1e4) / 1e4,
      area: Math.round(area),
      columns: columns.map(r1)
    });
  }
}
canopies.sort((a, b) => b.area - a.area);
const byKind = {};
let columnCount = 0;
for (const c of canopies) {
  byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  columnCount += c.columns.length / 2;
}
const total = canopies.reduce((s, c) => s + c.area, 0);
log(`canopies: ${rings} roof rings, ${canopies.length} canopies / ${(total / 1e4).toFixed(2)} ha, ` +
  `${columnCount} columns (${tooSmall} under ${MIN_AREA} m², ${tooIrregular} too irregular, ` +
  `${noColumns} no clear column, ${outside} outside the box)`);
log(`canopies: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}`);

export { canopies, railDistance };
