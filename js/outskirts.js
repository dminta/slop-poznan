import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  attribute,
  texture,
  positionWorld,
  positionGeometry,
  normalGeometry,
  normalWorld,
  sin,
  abs,
  floor,
  fract,
  max,
  min,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  fwidth,
  select
} from 'three/tsl';
import { cityUniforms, parkLawnColorNode, parkLawnNormalNode, setParkLawnSpecular, createPanelBlockMaterial, createFacadeBoxes, WALL_KINDS } from './tsl-materials.js';
import { LL, OUTSKIRTS, OUTSKIRTS_HOLES, DISTRICTS, CITY_BOUNDS } from './city-config.js';
import { SATELLITE_SITES, satelliteClearance } from './satellite-sites.js';

// js/outskirts.js
// Poznań beyond the detailed core, at true 1:1 scale on the real geography (1 unit = 1 m, x = east, z = south, origin
// at the Ratusz), built to read as a city from the helicopter and down the long streets while staying cheap at 60 FPS:
// - The low-detail land between the detail box and the city boundary (GEO.outskirts, with its lakes as holes), meeting
//   the box edges where city-grid's land deck takes over, with grassy banks down to the Warta and the lakes
// - A horizon filler beyond the city line, so the city does not float in a sea
// - A procedural "city carpet" ground shader: per-district street grids (a baked zone map), sidewalks, roofs, gardens,
//   forests, cemeteries, industry & rail yards, fields and airfields from a land-use map, street lights at night
// - Instanced buildings on the same grids: 5/11/16-storey panel slabs and point blocks on lawns on the osiedla
//   (Winogrady, Piątkowo, Rataje, Chartowo, Żegrze) in the shared wielka płyta facade (createPanelBlockMaterial),
//   plastered blocks in Grunwald, houses in the suburban belt, sheds on the industrial estates
// - Hand-placed satellite silhouettes just outside the box (satellite-sites.js): the OSM-sized malls, retail parks,
//   VW halls and Karolin's cooling towers/chimney, on the same box pipeline and two instanced non-box structures

// =====================================================================================================================
// 1. GEOMETRY HELPERS & LAND
// =====================================================================================================================

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Colour constants in this file are authored as sRGB swatches (like the hex colours elsewhere) and converted to the
// linear values the shaders and lighting work in
const toLinear = (c) => Math.pow(c, 2.2);
const srgb = (r, g, b) => vec3(toLinear(r), toLinear(g), toLinear(b));

function polygonBounds(pts) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z);
    b.maxZ = Math.max(b.maxZ, p.z);
  }
  return b;
}

function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a * 0.5;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

// Spatial index of a big ring (hundreds of vertices): z-bands holding the edges that span them, for exact
// point-in-polygon tests and row crossings, and a hashed 128 m cell grid of its edges for distance queries
const BAND = 64;
const CELL = 128;
const cellKey = (i, j) => (i + 4096) * 8192 + (j + 4096);

function indexPolygon(pts) {
  const n = pts.length;
  const b = polygonBounds(pts);
  const bands = Array.from({ length: Math.floor((b.maxZ - b.minZ) / BAND) + 1 }, () => []);
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const k1 = Math.floor((Math.max(p.z, q.z) - b.minZ) / BAND);
    for (let k = Math.floor((Math.min(p.z, q.z) - b.minZ) / BAND); k <= k1; k++) bands[k].push(i);
    const i1 = Math.floor(Math.max(p.x, q.x) / CELL);
    const j1 = Math.floor(Math.max(p.z, q.z) / CELL);
    for (let cj = Math.floor(Math.min(p.z, q.z) / CELL); cj <= j1; cj++) {
      for (let ci = Math.floor(Math.min(p.x, q.x) / CELL); ci <= i1; ci++) {
        const key = cellKey(ci, cj);
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(i);
      }
    }
  }
  return { pts, n, b, bands, cells, stamp: new Uint32Array(n), pass: 0 };
}

function insideIndexed(ix, x, z) {
  const { b, pts, n } = ix;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  let inside = false;
  for (const i of ix.bands[Math.floor((z - b.minZ) / BAND)]) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    if ((p.z > z) !== (q.z > z) && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) inside = !inside;
  }
  return inside;
}

// Sorted x of the ring's edge crossings along the row z (inside spans: [xs[0], xs[1]], [xs[2], xs[3]] ...)
function rowCrossings(ix, z, out = []) {
  out.length = 0;
  const { b, pts, n } = ix;
  if (z <= b.minZ || z >= b.maxZ) return out;
  for (const i of ix.bands[Math.floor((z - b.minZ) / BAND)]) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    if ((p.z > z) !== (q.z > z)) out.push(p.x + ((z - p.z) / (q.z - p.z)) * (q.x - p.x));
  }
  return out.sort((a, c) => a - c);
}

// Distance from (x, z) to the ring's edges (Infinity when none lies within `reach`)
function shoreDistIndexed(ix, x, z, reach) {
  const { pts, n } = ix;
  const pass = ++ix.pass;
  let best = Infinity;
  const i1 = Math.floor((x + reach) / CELL);
  const j1 = Math.floor((z + reach) / CELL);
  for (let cj = Math.floor((z - reach) / CELL); cj <= j1; cj++) {
    for (let ci = Math.floor((x - reach) / CELL); ci <= i1; ci++) {
      const list = ix.cells.get(cellKey(ci, cj));
      if (!list) continue;
      for (const i of list) {
        if (ix.stamp[i] === pass) continue;
        ix.stamp[i] = pass;
        const p = pts[i];
        const q = pts[(i + 1) % n];
        const d = distToSegment(x, z, p.x, p.z, q.x, q.z);
        if (d < best) best = d;
      }
    }
  }
  return best <= reach ? best : Infinity;
}

// The detail box (city-grid.js builds everything inside it)
const BOX = { minX: CITY_BOUNDS.minX, maxX: CITY_BOUNDS.maxX, minZ: CITY_BOUNDS.minZ, maxZ: CITY_BOUNDS.maxZ };
const inBox = (x, z) => x > BOX.minX && x < BOX.maxX && z > BOX.minZ && z < BOX.maxZ;
function distToBox(x, z) {
  const dx = Math.max(BOX.minX - x, 0, x - BOX.maxX);
  const dz = Math.max(BOX.minZ - z, 0, z - BOX.maxZ);
  return Math.hypot(dx, dz);
}

// Land pieces: the outskirts rings (west, east, north & south of the box, split further by the Warta), each with the
// lakes inside it as holes. They sit 2 cm under city-grid's road deck (y = 0) where they meet along the box edges.
const LAND_TOP = -0.02;
const LAND = OUTSKIRTS.map((pts, k) => {
  const holes = OUTSKIRTS_HOLES.filter((h) => h.outer === k).map((h) => h.ring);
  return { pts, holes, top: LAND_TOP, bounds: polygonBounds(pts), index: indexPolygon(pts), holeIndex: holes.map(indexPolygon) };
}).filter((l) => l.pts.length >= 3);

const insideLand = (land, x, z) => insideIndexed(land.index, x, z) && !land.holeIndex.some((h) => insideIndexed(h, x, z));

// Region covered by the land-use, zone and land rasters: the city's extent plus a margin (the edge texels carry on to
// the horizon)
const REGION = (() => {
  const b = polygonBounds(LAND.flatMap((l) => l.pts));
  const pad = 2000;
  return { minX: Math.floor(b.minX - pad), maxX: Math.ceil(b.maxX + pad), minZ: Math.floor(b.minZ - pad), maxZ: Math.ceil(b.maxZ + pad) };
})();

// Land-id raster (32 m cells): cells clear of every shoreline answer landAt() with one lookup, shoreline cells (255)
// fall back to the exact polygon tests
const LAND_GRID = (() => {
  const cell = 32;
  const minX = REGION.minX;
  const minZ = REGION.minZ;
  const nx = Math.ceil((REGION.maxX - minX) / cell);
  const nz = Math.ceil((REGION.maxZ - minZ) / cell);
  const data = new Uint8Array(nx * nz);
  const xs = [];
  const fill = (ix, v) => {
    const b = ix.b;
    const j0 = Math.max(0, Math.floor((b.minZ - minZ) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((b.maxZ - minZ) / cell));
    for (let j = j0; j <= j1; j++) {
      rowCrossings(ix, minZ + (j + 0.5) * cell, xs);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil((xs[s] - minX) / cell - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - minX) / cell - 0.5));
        for (let i = i0; i <= i1; i++) data[j * nx + i] = v;
      }
    }
  };
  LAND.forEach((land, k) => {
    fill(land.index, k + 1);
    for (const h of land.holeIndex) fill(h, 0);
  });
  const mark = (x, z) => {
    const i = Math.floor((x - minX) / cell);
    const j = Math.floor((z - minZ) / cell);
    if (i >= 0 && j >= 0 && i < nx && j < nz) data[j * nx + i] = 255;
  };
  const r = cell * 0.3;
  for (const land of LAND) {
    for (const pts of [land.pts, ...land.holes]) {
      for (let e = 0; e < pts.length; e++) {
        const p = pts[e];
        const q = pts[(e + 1) % pts.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (cell * 0.25)));
        for (let s = 0; s <= steps; s++) {
          const x = p.x + ((q.x - p.x) * s) / steps;
          const z = p.z + ((q.z - p.z) * s) / steps;
          mark(x - r, z - r);
          mark(x + r, z - r);
          mark(x - r, z + r);
          mark(x + r, z + r);
        }
      }
    }
  }
  return { cell, minX, minZ, nx, nz, data };
})();

function landAt(x, z) {
  const g = LAND_GRID;
  const i = Math.floor((x - g.minX) / g.cell);
  const j = Math.floor((z - g.minZ) / g.cell);
  if (i >= 0 && j >= 0 && i < g.nx && j < g.nz) {
    const v = g.data[j * g.nx + i];
    if (v === 0) return null;
    if (v !== 255) return LAND[v - 1];
  }
  for (const land of LAND) if (insideLand(land, x, z)) return land;
  return null;
}

// Distance from (x, z) to a land piece's shore or lake edges (Infinity beyond `reach`)
function shoreDist(land, x, z, reach) {
  let d = shoreDistIndexed(land.index, x, z, reach);
  for (const h of land.holeIndex) d = Math.min(d, shoreDistIndexed(h, x, z, reach));
  return d;
}

// Beyond the city line (50 m raster): everything that is neither city land nor water inside the city. The city is the
// outskirts' outer rings plus the box; the rest is opened by a 500 m square (so the Warta and the narrow channels
// between the pieces drop out) and kept where it connects to the raster border (so wide river reaches enclosed by the
// city do too), then grown by 100 m to slide under the outskirts' ragged 10 m edge. Narrow notches in the city line
// stay water; that is the price of not having the boundary itself in GEO.
const FILLER = (() => {
  const cell = 50;
  const minX = REGION.minX;
  const minZ = REGION.minZ;
  const nx = Math.ceil((REGION.maxX - minX) / cell);
  const nz = Math.ceil((REGION.maxZ - minZ) / cell);
  const city = new Uint8Array(nx * nz);
  const xs = [];
  for (const land of LAND) {
    const b = land.bounds;
    for (let j = Math.max(0, Math.floor((b.minZ - minZ) / cell)); j <= Math.min(nz - 1, Math.ceil((b.maxZ - minZ) / cell)); j++) {
      rowCrossings(land.index, minZ + (j + 0.5) * cell, xs);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil((xs[s] - minX) / cell - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - minX) / cell - 0.5));
        for (let i = i0; i <= i1; i++) city[j * nx + i] = 1;
      }
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) if (inBox(minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell)) city[j * nx + i] = 1;
  }
  // Square min / max filter of radius r (cells) over a 0/1 mask, separable via running sums
  const filter = (src, r, erode) => {
    const tmp = new Uint8Array(src.length);
    const out = new Uint8Array(src.length);
    const pass = (a, b, len, count, idx) => {
      for (let line = 0; line < count; line++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) if (k >= 0 && k < len) sum += a[idx(line, k)];
        for (let k = 0; k < len; k++) {
          const lo = Math.max(0, k - r);
          const hi = Math.min(len - 1, k + r);
          b[idx(line, k)] = erode ? (sum === hi - lo + 1 ? 1 : 0) : (sum > 0 ? 1 : 0);
          if (k - r >= 0) sum -= a[idx(line, k - r)];
          if (k + r + 1 < len) sum += a[idx(line, k + r + 1)];
        }
      }
    };
    pass(src, tmp, nx, nz, (j, i) => j * nx + i);
    pass(tmp, out, nz, nx, (i, j) => j * nx + i);
    return out;
  };
  let outside = city.map((v) => 1 - v);
  outside = filter(filter(outside, 5, true), 5, false);
  // keep what the raster border reaches
  const keep = new Uint8Array(nx * nz);
  const stack = [];
  const seed = (i, j) => {
    const k = j * nx + i;
    if (outside[k] && !keep[k]) {
      keep[k] = 1;
      stack.push(k);
    }
  };
  for (let i = 0; i < nx; i++) { seed(i, 0); seed(i, nz - 1); }
  for (let j = 0; j < nz; j++) { seed(0, j); seed(nx - 1, j); }
  while (stack.length) {
    const k = stack.pop();
    const i = k % nx;
    const j = (k - i) / nx;
    if (i > 0) seed(i - 1, j);
    if (i < nx - 1) seed(i + 1, j);
    if (j > 0) seed(i, j - 1);
    if (j < nz - 1) seed(i, j + 1);
  }
  const data = filter(keep, 2, false);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) if (inBox(minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell)) data[j * nx + i] = 0;
  }
  return { cell, minX, minZ, nx, nz, data, core: keep };
})();

// Is (x, z) beyond the city line? `core` leaves out the 100 m the filler grows under the outskirts' edge.
function fillerAt(x, z, core = false) {
  const g = FILLER;
  const i = Math.floor((x - g.minX) / g.cell);
  const j = Math.floor((z - g.minZ) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return true;
  return (core ? g.core : g.data)[j * g.nx + i] === 1;
}

// =====================================================================================================================
// 2. LAND-USE MAP (R = park / forest, G = industry / rail / airfield paving, B = low-density suburbs, A = open fields,
//    meadows & airfield grass), ~26 m texels over REGION (the texture's edge texels carry on to the horizon)
// =====================================================================================================================

const LU = { minX: REGION.minX, maxX: REGION.maxX, minZ: REGION.minZ, maxZ: REGION.maxZ, w: 1024, h: 1024 };
const luData = new Uint8Array(LU.w * LU.h * 4);

// Scanline fill of a polygon over the LU texel grid (texel centres inside): span(j, i0, i1) per covered run of row j
function rasterPolygon(pts, span) {
  const b = polygonBounds(pts);
  const sx = LU.w / (LU.maxX - LU.minX);
  const sz = LU.h / (LU.maxZ - LU.minZ);
  const j0 = Math.max(0, Math.floor((b.minZ - LU.minZ) * sz));
  const j1 = Math.min(LU.h - 1, Math.ceil((b.maxZ - LU.minZ) * sz));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = LU.minZ + (j + 0.5) / sz;
    xs.length = 0;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const a = pts[i];
      const c = pts[k];
      if ((a.z > z) !== (c.z > z)) xs.push(a.x + ((z - a.z) / (c.z - a.z)) * (c.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - LU.minX) * sx - 0.5));
      const i1 = Math.min(LU.w - 1, Math.floor((xs[s + 1] - LU.minX) * sx - 0.5));
      if (i1 >= i0) span(j, i0, i1);
    }
  }
}

function luPaintPolygon(pts, ch, value) {
  rasterPolygon(pts, (j, i0, i1) => {
    for (let i = i0; i <= i1; i++) luData[(j * LU.w + i) * 4 + ch] = value;
  });
}

function luRect(x0, z0, x1, z1, ch, value = 255) {
  luPaintPolygon([{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], ch, value);
}

// Ellipse (radii in m along x / z, turned by rot towards +z) around a world point or a lon / lat pair
function luEllipse(cx, cz, rx, rz, ch, value = 255, rot = 0) {
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ez = Math.sin(a) * rz;
    pts.push({ x: cx + ex * Math.cos(rot) - ez * Math.sin(rot), z: cz + ex * Math.sin(rot) + ez * Math.cos(rot) });
  }
  luPaintPolygon(pts, ch, value);
}
function luEllipseLL(lon, lat, rx, rz, ch, value = 255, rot = 0) {
  const p = LL(lon, lat);
  luEllipse(p.x, p.z, rx, rz, ch, value, rot);
}

// A band of half-width halfW and length len through (lon, lat), turned by rot from east towards south (runways)
function luStripLL(lon, lat, len, halfW, rot, ch, value = 255) {
  const p = LL(lon, lat);
  const ux = Math.cos(rot) * len * 0.5;
  const uz = Math.sin(rot) * len * 0.5;
  const vx = -Math.sin(rot) * halfW;
  const vz = Math.cos(rot) * halfW;
  luPaintPolygon([
    { x: p.x - ux - vx, z: p.z - uz - vz }, { x: p.x + ux - vx, z: p.z + uz - vz },
    { x: p.x + ux + vx, z: p.z + uz + vz }, { x: p.x - ux + vx, z: p.z - uz + vz }
  ], ch, value);
}

// Separable 3-tap box blur of all four channels
function luBlur(passes) {
  const tmp = new Uint8Array(luData.length);
  const W4 = LU.w * 4;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < LU.h; j++) {
      const row = j * W4;
      for (let i = 0; i < LU.w; i++) {
        const o = row + i * 4;
        const l = i > 0 ? o - 4 : o;
        const r = i < LU.w - 1 ? o + 4 : o;
        for (let c = 0; c < 4; c++) tmp[o + c] = (luData[l + c] + luData[o + c] + luData[r + c] + 1) / 3;
      }
    }
    for (let j = 0; j < LU.h; j++) {
      const row = j * W4;
      const up = j > 0 ? row - W4 : row;
      const dn = j < LU.h - 1 ? row + W4 : row;
      for (let i = 0; i < W4; i++) luData[row + i] = (tmp[up + i] + tmp[row + i] + tmp[dn + i] + 1) / 3;
    }
  }
}

function luAt(x, z) {
  const i = Math.max(0, Math.min(LU.w - 1, Math.floor(((x - LU.minX) / (LU.maxX - LU.minX)) * LU.w)));
  const j = Math.max(0, Math.min(LU.h - 1, Math.floor(((z - LU.minZ) / (LU.maxZ - LU.minZ)) * LU.h)));
  const o = (j * LU.w + i) * 4;
  return { park: luData[o] / 255, industry: luData[o + 1] / 255, suburb: luData[o + 2] / 255, open: luData[o + 3] / 255 };
}

const PARK = 0;
const INDUSTRY = 1;
const SUBURB = 2;
const OPEN = 3;

// Coarse, from the map: places within ~200 m, sizes rounded. Runway headings are true bearings turned into the frame.
function paintLandUse() {
  // --- Beyond the city line: fields with villages strung along the roads ---
  for (let j = 0; j < LU.h; j++) {
    const z = LU.minZ + ((j + 0.5) / LU.h) * (LU.maxZ - LU.minZ);
    for (let i = 0; i < LU.w; i++) {
      const x = LU.minX + ((i + 0.5) / LU.w) * (LU.maxX - LU.minX);
      if (!fillerAt(x, z, true)) continue;
      const o = (j * LU.w + i) * 4;
      luData[o + OPEN] = 175;
      luData[o + SUBURB] = 150;
    }
  }

  // --- The suburban belt around the 1970s estates: single-family houses ---
  // West of the detail box (the box itself, Ławica included, is drawn in detail; -5250 keeps the old band filled)
  luRect(-30000, -30000, -5250, 30000, SUBURB, 150);           // Junikowo, Krzyżowniki, Kiekrz (west)
  luRect(-30000, -30000, 30000, -6200, SUBURB, 140);           // Strzeszyn, Morasko, Umultowo (north)
  luRect(-30000, 5200, 30000, 30000, SUBURB, 150);             // Dębiec, Starołęka, Minikowo (south)
  luRect(5600, -30000, 30000, 30000, SUBURB, 160);             // Antoninek, Kobylepole, Szczepankowo (east)

  // --- Forests & parks ---
  luEllipseLL(16.875, 52.432, 1000, 700, PARK, 255);           // Lasek Golęcin & the woods round Jezioro Rusałka
  luEllipseLL(16.835, 52.462, 1300, 1000, PARK, 255);          // Strzeszyn forest & Jezioro Strzeszyńskie
  luEllipseLL(16.800, 52.470, 900, 800, PARK, 220);            // Jezioro Kierskie shore woods
  luEllipseLL(16.895, 52.490, 1500, 900, PARK, 255);           // Morasko forest (meteorite reserve)
  luEllipseLL(16.940, 52.455, 500, 400, PARK, 230);            // Lasek Naramowicki
  luEllipseLL(16.845, 52.393, 1100, 900, PARK, 255);           // Lasek Marceliński
  luEllipseLL(16.925, 52.365, 900, 1400, PARK, 255, 0.3);      // Dębina, along the Warta
  luEllipseLL(17.005, 52.405, 1300, 900, PARK, 255);           // Malta's east end & the Nowe Zoo woods
  luEllipseLL(17.045, 52.420, 1200, 900, PARK, 230);           // Antoninek & Zieliniec woods
  luEllipseLL(17.030, 52.470, 1600, 1500, PARK, 255);          // Puszcza Zielonka's south-western edge
  luEllipseLL(16.835, 52.385, 450, 350, PARK, 230);            // Cmentarz Junikowo
  luEllipseLL(16.835, 52.385, 450, 350, SUBURB, 200);
  luEllipseLL(16.995, 52.425, 450, 400, PARK, 230);            // Cmentarz Miłostowo
  luEllipseLL(16.995, 52.425, 450, 400, SUBURB, 200);

  // --- Open fields & the Warta's meadows ---
  luEllipseLL(16.950, 52.480, 1200, 1500, OPEN, 230);          // Umultowo & the northern Warta meadows
  luEllipseLL(16.940, 52.345, 900, 2000, OPEN, 230);           // Czapury & the southern Warta meadows
  luEllipseLL(16.800, 52.360, 1500, 1200, OPEN, 220);          // Kotowo (south-west)
  luEllipseLL(16.960, 52.505, 1500, 900, OPEN, 220);           // Radojewo (north)
  luEllipseLL(17.030, 52.360, 1500, 1200, OPEN, 220);          // Szczepankowo & Spławie (south-east)

  // --- Airfields: grass with a paved runway & apron ---
  // Ławica is inside the detail box now and drawn by js/airport.js, so only the Krzesiny air base stays painted here.
  luEllipseLL(16.970, 52.332, 2000, 800, OPEN, 255, 0.44);     // Krzesiny air base
  luStripLL(16.970, 52.332, 2500, 30, 0.44, INDUSTRY, 255);

  // --- Industry & rail yards ---
  luEllipseLL(17.000, 52.385, 1200, 400, INDUSTRY, 230, -0.2); // Franowo rail yard & depot
  luEllipseLL(16.955, 52.365, 700, 500, INDUSTRY, 220);        // Starołęka industrial estate
  luEllipseLL(16.985, 52.432, 800, 500, INDUSTRY, 210);        // Główna
  luEllipseLL(17.025, 52.405, 500, 400, INDUSTRY, 240);        // Antoninek works
  luEllipseLL(16.875, 52.390, 600, 200, INDUSTRY, 200);        // Górczyn rail yard

  luBlur(1);
}

paintLandUse();

const landUseTexture = new THREE.DataTexture(luData, LU.w, LU.h, THREE.RGBAFormat);
landUseTexture.magFilter = THREE.LinearFilter;
landUseTexture.minFilter = THREE.LinearMipmapLinearFilter;
landUseTexture.generateMipmaps = true;
landUseTexture.wrapS = THREE.ClampToEdgeWrapping;
landUseTexture.wrapT = THREE.ClampToEdgeWrapping;
landUseTexture.needsUpdate = true;

// =====================================================================================================================
// 3. DISTRICT STREET GRIDS (shared by the ground shader and the building generator so buildings sit on blocks)
//    u runs along each block's long side: u = R(angle) * (p - origin); pu >= pv are the block pitches and su / sv the
//    street widths (m). Which grid applies where is baked into a zone map (one byte per land-use texel) that the ground
//    shader samples too, so the CPU and GPU always agree. Osiedla are superblocks of slabs in greenery, hence the big
//    pitches. Angles follow each district's main streets (degrees, east towards south). Since the 8.2 × 5.7 km detail
//    box (Phase 13.2) Stare and Nowe Winogrady Południe, Rataje, Chartowo, Żegrze, Ogrody and Górczyn lie mostly inside
//    it as real blocks; nothing is built or drawn here inside the box, so the zones now carry on only their outer parts
//    (panel blocks 2168 → 1381, all outskirts buildings 40.8k → 47.4k, as MAX_BUILD_DIST reaches further out).
// =====================================================================================================================

const ZONE_LIST = [
  // Everything else: the suburban house grids (zone 0 is also the shader's fallback)
  { id: 'suburb', kind: 'suburb', angle: 0, o: { x: 0, z: 0 }, pu: 150, pv: 80, su: 10, sv: 8 },
  // Grunwald & Górczyn: pre-war villas and plastered blocks along Grunwaldzka & Hetmańska
  { id: 'grunwald', kind: 'urban', angle: -12, o: LL(16.880, 52.400), pu: 150, pv: 95, su: 16, sv: 12 },
  // Ogrody & Sołacz: garden-city villas, allotments
  { id: 'ogrody', kind: 'garden', angle: 10, o: LL(16.870, 52.415), pu: 140, pv: 75, su: 12, sv: 10 },
  // Naramowice: 1990s-2010s developer estates
  { id: 'naramowice', kind: 'modern', angle: 30, o: LL(16.940, 52.445), pu: 170, pv: 95, su: 14, sv: 11 },
  // Winogrady, Winiary & Piątkowo: the northern panel-block osiedla
  { id: 'winogrady', kind: 'osiedle', angle: 18, o: LL(16.930, 52.430), pu: 300, pv: 190, su: 22, sv: 16 },
  // Rataje, Chartowo & Żegrze: the eastern panel-block osiedla across the Warta
  { id: 'rataje', kind: 'osiedle', angle: -25, o: LL(16.975, 52.390), pu: 280, pv: 180, su: 22, sv: 16 }
];
const ZONES = {};
ZONE_LIST.forEach((z, i) => {
  const a = (z.angle * Math.PI) / 180;
  z.index = i;
  z.ox = z.o.x;
  z.oz = z.o.z;
  z.cos = Math.cos(a);
  z.sin = Math.sin(a);
  ZONES[z.id] = z;
});

// Zone map: zone index per land-use texel
const zoneData = new Uint8Array(LU.w * LU.h);

function paintZones() {
  const DISTRICT_ZONE = {
    'Grunwald Południe': 'grunwald', 'Grunwald Północ': 'grunwald', 'Stary Grunwald': 'grunwald', 'Górczyn': 'grunwald',
    'Ogrody': 'ogrody', 'Sołacz': 'ogrody',
    'Naramowice': 'naramowice',
    'Stare Winogrady': 'winogrady', 'Nowe Winogrady Południe': 'winogrady', 'Nowe Winogrady Wschód': 'winogrady',
    'Winiary': 'winogrady',
    'Rataje': 'rataje', 'Chartowo': 'rataje', 'Żegrze': 'rataje'
  };
  const paint = (pts, id) => {
    const v = ZONES[id].index;
    rasterPolygon(pts, (j, i0, i1) => zoneData.fill(v, j * LU.w + i0, j * LU.w + i1 + 1));
  };
  for (const d of DISTRICTS) if (DISTRICT_ZONE[d.name]) paint(d.ring, DISTRICT_ZONE[d.name]);
  // Osiedla outside the GEO districts (they stop near the core)
  const ellipse = (lon, lat, rx, rz) => {
    const c = LL(lon, lat);
    return Array.from({ length: 24 }, (_, i) => ({ x: c.x + Math.cos((i / 24) * Math.PI * 2) * rx, z: c.z + Math.sin((i / 24) * Math.PI * 2) * rz }));
  };
  paint(ellipse(16.905, 52.452, 1300, 900), 'winogrady'); // Piątkowo
  paint(ellipse(16.965, 52.452, 900, 700), 'winogrady');  // Nowe Winogrady Północ
}
paintZones();

const zoneTexture = new THREE.DataTexture(zoneData, LU.w, LU.h, THREE.RedFormat, THREE.UnsignedByteType);
zoneTexture.magFilter = THREE.NearestFilter;
zoneTexture.minFilter = THREE.NearestFilter;
zoneTexture.generateMipmaps = false;
zoneTexture.wrapS = THREE.ClampToEdgeWrapping;
zoneTexture.wrapT = THREE.ClampToEdgeWrapping;
zoneTexture.needsUpdate = true;

// The zone of a world point: the same texel the ground shader samples (nearest, clamped to the edge)
function zoneAt(x, z) {
  const i = Math.max(0, Math.min(LU.w - 1, Math.floor(((x - LU.minX) / (LU.maxX - LU.minX)) * LU.w)));
  const j = Math.max(0, Math.min(LU.h - 1, Math.floor(((z - LU.minZ) / (LU.maxZ - LU.minZ)) * LU.h)));
  return ZONE_LIST[zoneData[j * LU.w + i]] || ZONE_LIST[0];
}

function zoneToLocal(zone, x, z) {
  const dx = x - zone.ox;
  const dz = z - zone.oz;
  return { u: dx * zone.cos + dz * zone.sin, v: dz * zone.cos - dx * zone.sin };
}

function zoneToWorld(zone, u, v) {
  return { x: zone.ox + u * zone.cos - v * zone.sin, z: zone.oz + u * zone.sin + v * zone.cos };
}

// Grid parameters of the zone texel under luUV: p0 = (cos, sin, origin x, origin z), p1 = (pu, pv, su, sv); green = 1
// in the osiedle zones, whose superblocks are lawns and trees around the slabs rather than lots of roofs
function zoneParamsNode(luUV) {
  const zid = floor(texture(zoneTexture, luUV).r.mul(255.0).add(0.5)).toVar();
  const p0Of = (z) => vec4(z.cos, z.sin, z.ox, z.oz);
  const p1Of = (z) => vec4(z.pu, z.pv, z.su, z.sv);
  let p0 = p0Of(ZONE_LIST[0]);
  let p1 = p1Of(ZONE_LIST[0]);
  let green = float(ZONE_LIST[0].kind === 'osiedle' ? 1 : 0);
  for (let k = 1; k < ZONE_LIST.length; k++) {
    const hit = abs(zid.sub(k)).lessThan(0.5);
    p0 = select(hit, p0Of(ZONE_LIST[k]), p0);
    p1 = select(hit, p1Of(ZONE_LIST[k]), p1);
    green = select(hit, float(ZONE_LIST[k].kind === 'osiedle' ? 1 : 0), green);
  }
  return { p0, p1, green };
}

// =====================================================================================================================
// 4. CHEAP DISTANT MATERIALS
// =====================================================================================================================

const hash12 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const valueNoise = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash12(i);
  const b = hash12(i.add(vec2(1.0, 0.0)));
  const c = hash12(i.add(vec2(0.0, 1.0)));
  const d = hash12(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// Box-filtered periodic pulse (fraction of a footprint `w` around `x` where fract() lies in [a, b]): settles to the mean
// coverage once a period shrinks below a pixel, so grids never shimmer at distance
const boxPulse = Fn(([x, a, b, w]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

// 0 by day, ~0.75 at blue hour, 1 at night
const nightFactorNode = () => smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);

/**
 * Procedural "city carpet" for the outskirts and the horizon filler: district street grids with sidewalks, flat roofs
 * and gardens, overridden by the land-use map (forests, cemeteries, industry, suburbs, fields & airfields) and by slope
 * (the grassy river and lake banks). Street-light grids glow at night.
 */
function createLandMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.0 });
  const wp = positionWorld;
  const luUV = vec2(wp.x.sub(LU.minX).div(LU.maxX - LU.minX), wp.z.sub(LU.minZ).div(LU.maxZ - LU.minZ));
  const lu = texture(landUseTexture, luUV).toVar();
  const { p0, p1, green } = zoneParamsNode(luUV);
  const zp0 = p0.toVar();
  const zp1 = p1.toVar();
  const osiedle = green.toVar();

  const dx = wp.x.sub(zp0.z);
  const dz = wp.z.sub(zp0.w);
  const gu = dx.mul(zp0.x).add(dz.mul(zp0.y)).div(zp1.x).toVar();
  const gv = dz.mul(zp0.x).sub(dx.mul(zp0.y)).div(zp1.y).toVar();
  const fwU = fwidth(gu).toVar();
  const fwV = fwidth(gv).toVar();
  const cell = floor(vec2(gu, gv)).toVar();

  const hu = zp1.z.mul(0.5).div(zp1.x);
  const hv = zp1.w.mul(0.5).div(zp1.y);
  const swU = float(2.2).div(zp1.x);
  const swV = float(2.2).div(zp1.y);
  const inBlock = boxPulse(gu, hu, float(1.0).sub(hu), fwU).mul(boxPulse(gv, hv, float(1.0).sub(hv), fwV)).toVar();
  const inLots = boxPulse(gu, hu.add(swU), float(1.0).sub(hu).sub(swU), fwU)
    .mul(boxPulse(gv, hv.add(swV), float(1.0).sub(hv).sub(swV), fwV)).toVar();

  // Lots ~8 m wide along the block, two rows of roofs with a band of garden trees between them
  const lotsU = max(floor(zp1.x.div(8.5)), 1.0);
  const lotCoord = gu.mul(lotsU);
  const lotId = vec2(floor(lotCoord), cell.y.mul(3.0).add(floor(fract(gv).mul(3.0))));
  const lotHash = hash12(lotId.add(vec2(zp0.z.mul(0.013), zp0.w.mul(0.017)))).toVar();
  const lotDetail = float(1.0).sub(smoothstep(0.35, 1.1, max(fwU.mul(lotsU), fwV.mul(3.0)))).toVar();

  // Flat grey roofs and the red tile of the houses
  const cTar = srgb(0.30, 0.30, 0.29);
  const cGreyRoof = srgb(0.50, 0.495, 0.48);
  const cLightRoof = srgb(0.72, 0.71, 0.69);
  const cTileRoof = srgb(0.52, 0.29, 0.22);
  const roofVar = mix(
    mix(cTar, cGreyRoof, step(0.38, lotHash)),
    mix(cTileRoof, cLightRoof, step(0.86, lotHash)),
    step(0.66, lotHash)
  );
  const roofMean = srgb(0.44, 0.39, 0.36);
  const roofCol = mix(roofMean, roofVar, lotDetail);

  const yardBand = boxPulse(fract(gv), 0.36, 0.64, fwV);
  const treeNoise = valueNoise(wp.xz.mul(0.11)).toVar();
  const cTree = mix(srgb(0.19, 0.26, 0.13), srgb(0.30, 0.37, 0.19), treeNoise);
  const yardAmount = clamp(yardBand.mul(0.85).add(lu.b.mul(0.35)).mul(smoothstep(0.25, 0.65, treeNoise.add(lu.b.mul(0.3)))), 0.0, 1.0);
  // Osiedle superblocks: mown lawns between the slabs with clumps of trees (birches, limes) and pale footpaths
  const clumps = smoothstep(0.5, 0.72, valueNoise(wp.xz.mul(0.05)).mul(0.7).add(treeNoise.mul(0.3)));
  const pathU = boxPulse(gu.mul(4.0), 0.49, 0.51, fwU.mul(4.0));
  const pathV = boxPulse(gv.mul(3.0), 0.485, 0.515, fwV.mul(3.0));
  const turf = parkLawnColorNode();
  const cOsiedle = mix(mix(turf, cTree, clumps), srgb(0.6, 0.59, 0.56), max(pathU, pathV).mul(0.8));
  const lotsCol = mix(mix(roofCol, cTree, yardAmount), cOsiedle, osiedle);

  const cAsphalt = srgb(0.30, 0.30, 0.31);
  const cSidewalk = srgb(0.56, 0.55, 0.53);
  let urban = mix(cAsphalt, mix(cSidewalk, lotsCol, inLots.div(max(inBlock, 0.001))), inBlock);

  // Curbside street trees: canopies over the sidewalks and parking lanes, with gaps; settles to an average canopy cover
  // once single trees shrink below a pixel
  const reachU = min(float(3.2).div(zp1.x), hu.mul(0.9));
  const reachV = min(float(3.2).div(zp1.y), hv.mul(0.9));
  const curbZone = boxPulse(gu, hu.sub(reachU), float(1.0).sub(hu).add(reachU), fwU)
    .mul(boxPulse(gv, hv.sub(reachV), float(1.0).sub(hv).add(reachV), fwV));
  const treeBand = max(curbZone.sub(inLots), 0.0);
  const crowns = smoothstep(0.42, 0.62, valueNoise(wp.xz.mul(0.16).add(vec2(zp0.z, zp0.w).mul(0.01))));
  const canopyFar = smoothstep(1.2, 4.0, max(fwU.mul(zp1.x), fwV.mul(zp1.y)));
  const streetTrees = treeBand.mul(mix(crowns, float(0.5), canopyFar)).mul(float(1.0).sub(lu.g)).toVar();
  urban = mix(urban, cTree.mul(1.12), streetTrees);

  // Industry, rail yards & runways: big light roofs, concrete and asphalt in coarse cells
  const indCell = hash12(floor(wp.xz.div(26.0)));
  const cIndustry = mix(srgb(0.50, 0.49, 0.47), mix(srgb(0.70, 0.69, 0.67), srgb(0.52, 0.42, 0.35), step(0.82, indCell)), step(0.45, indCell));

  // Forests (dense canopy with clearings) and cemeteries (pale lawns speckled with stones)
  const woods = smoothstep(0.3, 0.6, valueNoise(wp.xz.mul(0.045)).add(treeNoise.mul(0.35)));
  const cLawn = turf;
  const cPark = mix(cLawn, cTree.mul(0.85), woods);
  const cCemetery = mix(srgb(0.40, 0.48, 0.27), srgb(0.66, 0.66, 0.64), step(0.8, hash12(floor(wp.xz.mul(0.5)))).mul(0.5));

  // Fields & meadows: strips of crops, stubble and grass in ~120 x 40 m plots
  const plotN = valueNoise(wp.xz.mul(vec2(0.008, 0.025))).toVar();
  const cField = mix(mix(srgb(0.44, 0.50, 0.26), srgb(0.62, 0.56, 0.36), step(0.5, plotN)), srgb(0.36, 0.43, 0.22), treeNoise.mul(0.4));

  const park = lu.r.toVar();
  const cemeteryMix = park.mul(lu.b);
  let col = mix(urban, cIndustry, lu.g.mul(float(1.0).sub(lu.b.mul(0.6))));
  // Runways are painted industry over open grass: open ground stops where the paving starts
  col = mix(col, cField, lu.a.mul(float(1.0).sub(lu.g)));
  col = mix(col, mix(cPark, cCemetery, smoothstep(0.4, 0.8, cemeteryMix)), park);

  // River & lake banks: rough grass and shrubs where the ground slopes down to the water
  const slope = float(1.0).sub(normalWorld.y).toVar();
  col = mix(col, mix(srgb(0.30, 0.37, 0.18), cTree, treeNoise), smoothstep(0.04, 0.12, slope));
  mat.colorNode = col;

  // Follow the same blends as the colour so paths, canopies, fields, cemeteries and banks keep their response.
  const urbanLawn = inLots.mul(osiedle).mul(float(1.0).sub(clumps))
    .mul(float(1.0).sub(max(pathU, pathV).mul(0.8))).mul(float(1.0).sub(streetTrees));
  const industry = lu.g.mul(float(1.0).sub(lu.b.mul(0.6)));
  const openGround = lu.a.mul(float(1.0).sub(lu.g));
  const parkLawn = float(1.0).sub(woods).mul(float(1.0).sub(smoothstep(0.4, 0.8, cemeteryMix)));
  const lawnMask = mix(urbanLawn.mul(float(1.0).sub(industry)).mul(float(1.0).sub(openGround)), parkLawn, park)
    .mul(float(1.0).sub(smoothstep(0.04, 0.12, slope)));
  mat.normalNode = parkLawnNormalNode(lawnMask);
  setParkLawnSpecular(mat, lawnMask);

  mat.roughnessNode = mix(mix(float(0.9), float(0.97), max(park, lu.a)), float(0.86), lawnMask);

  // Night: street lights along the grid (none in forests, fields or yards); faint lit windows on the roofs
  const flat = float(1.0).sub(smoothstep(0.1, 0.3, slope));
  const open = float(1.0).sub(lu.a.mul(float(1.0).sub(lu.g)));
  const street = float(1.0).sub(inBlock).mul(float(1.0).sub(park)).mul(open).mul(flat);
  const windowGlow = inLots.mul(step(0.9, lotHash).mul(lotDetail).add(float(1.0).sub(lotDetail).mul(0.1))).mul(float(1.0).sub(park)).mul(open).mul(flat)
    .mul(float(1.0).sub(osiedle));
  mat.emissiveNode = vec3(1.0, 0.62, 0.3).mul(street.mul(0.55).add(windowGlow.mul(0.18))).mul(nightFactorNode());
  return mat;
}

/**
 * Outskirts building facades (instanced unit boxes): punched windows in plaster or brick, curtain-wall glass,
 * warehouse sashes, a tight 2.8 m panel grid (style 3, unused since the panel blocks moved to createPanelBlockMaterial)
 * or the larger grid of newer blocks by style, a per-building tint, darker ground floors, flat roofs (red tile on low punched-window houses) and lit
 * windows at night. Instance attributes: bInfo = (width, height, depth, seed), bTint = (r, g, b, style).
 */
function createBoroughBuildingMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0 });
  const info = attribute('bInfo', 'vec4');
  const tint = attribute('bTint', 'vec4');
  const pG = positionGeometry;
  const nG = normalGeometry;
  const style = tint.w;

  const isRoof = step(0.5, nG.y).toVar();
  const faceX = step(0.5, abs(nG.x));
  const wallW = mix(info.x, info.z, faceX);
  const u = mix(pG.x, pG.z, faceX).add(0.5).mul(wallW).add(info.w.mul(3.7)).toVar();
  const y = pG.y.mul(info.y).toVar();

  // Styles: 0 plaster / brick (punched), 1 glass, 2 industrial, 3 panel block, 4 modern
  const s0 = style.lessThan(0.5);
  const s1 = style.lessThan(1.5);
  const s2 = style.lessThan(2.5);
  const s3 = style.lessThan(3.5);
  const pick = (a, b, c, d, e) => select(s0, float(a), select(s1, float(b), select(s2, float(c), select(s3, float(d), float(e)))));
  const bay = pick(3.0, 1.6, 4.8, 3.0, 2.6);
  const floorH = pick(3.4, 3.7, 4.6, 2.8, 3.1);
  const winW = pick(0.44, 0.88, 0.62, 0.5, 0.6);
  const winH = pick(0.54, 0.74, 0.46, 0.5, 0.56);
  const litProb = pick(0.32, 0.36, 0.14, 0.36, 0.3);
  const glassy = pick(0.15, 1.0, 0.1, 0.12, 0.3);

  const gu = u.div(bay).toVar();
  const gv = y.div(floorH).toVar();
  const fwU = fwidth(gu).toVar();
  const fwV = fwidth(gv).toVar();
  const winMask = boxPulse(gu, float(0.5).sub(winW.mul(0.5)), float(0.5).add(winW.mul(0.5)), fwU)
    .mul(boxPulse(gv, float(0.42).sub(winH.mul(0.5)), float(0.42).add(winH.mul(0.5)), fwV))
    .mul(float(1.0).sub(isRoof))
    .mul(step(1.0, gv))
    .mul(float(1.0).sub(step(info.y.sub(1.2), y)))
    .toVar();
  const cellHash = hash12(floor(vec2(gu, gv)).add(vec2(info.w.mul(0.61), info.w.mul(1.37))));
  const far = smoothstep(0.35, 1.2, max(fwU, fwV)).toVar();
  const lit = mix(step(cellHash, litProb), litProb, far).toVar();

  const bHash = fract(info.w.mul(0.1373));
  const grime = valueNoise(vec2(u.mul(0.45), y.mul(0.05).add(info.w))).toVar();
  const fwY = fwidth(y);
  const parapet = smoothstep(fwY.negate(), fwY, y.sub(info.y.sub(0.85))).mul(float(1.0).sub(isRoof));
  const wallBase = tint.rgb.mul(float(0.84).add(bHash.mul(0.3))).mul(mix(float(0.78), float(1.0), smoothstep(0.0, 9.0, y)));
  const wallCol = mix(wallBase.mul(mix(float(0.86), float(1.07), grime)), wallBase.mul(mix(float(0.62), float(1.3), step(0.55, bHash))), parapet);
  const storefront = float(1.0).sub(step(3.4, y)).mul(float(1.0).sub(isRoof));
  // Window frames & sills (white trim on plaster, dark mullions on glass & warehouses, light frames on the panels)
  const frameMask = boxPulse(gu, float(0.45).sub(winW.mul(0.5)), float(0.55).add(winW.mul(0.5)), fwU)
    .mul(boxPulse(gv, float(0.36).sub(winH.mul(0.5)), float(0.45).add(winH.mul(0.5)), fwV))
    .mul(float(1.0).sub(isRoof))
    .mul(step(1.0, gv))
    .mul(float(1.0).sub(step(info.y.sub(1.2), y)));
  const frame = max(frameMask.sub(winMask), 0.0);
  const cFrame = vec3(1.0, 0.98, 0.94).mul(pick(0.58, 0.04, 0.05, 0.5, 0.34));
  // Dark interiors (the sky shows up through Fresnel reflection), some drawn curtains; tinted curtain-wall glass
  const winHash = hash12(floor(vec2(gu, gv)).add(vec2(info.w.mul(1.91), 5.3)));
  const blinds = mix(step(0.84, winHash), float(0.16), far).mul(float(1.0).sub(glassy));
  const cGlass = mix(mix(vec3(0.012, 0.014, 0.017), vec3(0.05, 0.065, 0.08), glassy), srgb(0.56, 0.53, 0.47), blinds);
  const tile = step(info.y, 11.0).mul(select(s0, float(1.0), float(0.0))).mul(step(0.3, bHash));
  const roofCol = mix(mix(srgb(0.30, 0.30, 0.31), srgb(0.66, 0.66, 0.65), step(0.72, bHash)), srgb(0.52, 0.27, 0.2), tile);
  let col = mix(wallCol, cFrame, frame);
  col = mix(col, cGlass, winMask);
  col = mix(col, vec3(0.09, 0.085, 0.08), storefront.mul(0.5));
  col = mix(col, roofCol, isRoof);
  mat.colorNode = col;
  mat.roughnessNode = mix(mix(float(0.86), float(0.5), frame), mix(float(0.14), float(0.06), glassy), winMask);
  mat.metalnessNode = winMask.mul(glassy).mul(0.6);

  const night = nightFactorNode();
  const warm = mix(vec3(1.0, 0.66, 0.36), vec3(0.92, 0.86, 0.76), step(0.78, cellHash));
  const dimmer = mix(fract(cellHash.mul(13.7)).mul(0.75).add(0.25), float(0.62), far);
  const shop = storefront.mul(step(0.55, hash12(vec2(floor(gu), info.w)))).mul(0.6);
  mat.emissiveNode = warm.mul(winMask.mul(lit).mul(dimmer).add(shop)).mul(night.mul(0.95).add(cityUniforms.uInteriorGlow.mul(0.1)));
  return mat;
}

// =====================================================================================================================
// 5. LAND MESHES & BANKS
// =====================================================================================================================

const BANK_BOTTOM_Y = CITY_BOUNDS.waterLevel - 0.6;
const BANK_RUN = 5; // horizontal reach of a bank from the shore line out under the water (m)
const FILLER_Y = -0.3; // under the outskirts' edge, which it slides beneath

function smooth01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// Flat land tops (earcut-triangulated rings with their lakes as holes) + sloped grass banks down into the water along
// the real shores. No bank along the detail box edge (city-grid's land continues there), between two pieces, or along
// the city line (the filler continues there).
function buildLandGeometries() {
  const topPos = [];
  const topIdx = [];
  const bankPos = [];

  for (const land of LAND) {
    const base = topPos.length / 3;
    const all = [land.pts, ...land.holes];
    for (const ring of all) for (const p of ring) topPos.push(p.x, land.top, p.z);
    const tris = THREE.ShapeUtils.triangulateShape(
      land.pts.map((p) => new THREE.Vector2(p.x, p.z)),
      land.holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)))
    );
    const flatPts = all.flat();
    for (const t of tris) {
      const a = flatPts[t[0]];
      const b = flatPts[t[1]];
      const c = flatPts[t[2]];
      const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
      if (up) topIdx.push(base + t[0], base + t[1], base + t[2]);
      else topIdx.push(base + t[0], base + t[2], base + t[1]);
    }

    all.forEach((pts, r) => {
      const n = pts.length;
      // Outward (towards the water) edge normals: a positive-area ring's outside is to the right of (dx, dz) turned
      // to (dz, -dx); a lake's water is inside its ring
      const sg = (ringArea(pts) > 0 ? 1 : -1) * (r === 0 ? 1 : -1);
      const en = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        en.push({ x: (sg * (b.z - a.z)) / len, z: (-sg * (b.x - a.x)) / len });
      }
      // Vertex normals (mean of the two edges), so neighbouring bank quads share their foot and leave no gaps
      const vn = pts.map((_, i) => {
        const e0 = en[(i + n - 1) % n];
        const e1 = en[i];
        const x = e0.x + e1.x;
        const z = e0.z + e1.z;
        const l = Math.hypot(x, z) || 1;
        return { x: x / l, z: z / l };
      });
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-3) continue;
        // the cuts between the pieces along the box's west and east edge lines (snapped by the build)
        if ([BOX.minX, BOX.maxX].some((cx) => Math.abs(a.x - cx) < 1 && Math.abs(b.x - cx) < 1)) continue;
        const qx = (a.x + b.x) * 0.5 + en[i].x * 3;
        const qz = (a.z + b.z) * 0.5 + en[i].z * 3;
        if (inBox(qx, qz) || distToBox(qx, qz) < 4 || landAt(qx, qz) || fillerAt(qx, qz)) continue;
        const na = vn[i];
        const nb = vn[(i + 1) % n];
        const at = [a.x, land.top, a.z];
        const bt = [b.x, land.top, b.z];
        const ab = [a.x + na.x * BANK_RUN, BANK_BOTTOM_Y, a.z + na.z * BANK_RUN];
        const bb = [b.x + nb.x * BANK_RUN, BANK_BOTTOM_Y, b.z + nb.z * BANK_RUN];
        // front face towards the water: (a_top, a_bot, b_bot) is counter-clockwise seen from outside when the edge
        // normal is (dz, -dx)-handed like en[i]
        const ccw = (b.z - a.z) * en[i].x - (b.x - a.x) * en[i].z > 0;
        const quad = ccw ? [at, bb, ab, at, bt, bb] : [at, ab, bb, at, bb, bt];
        for (const v of quad) bankPos.push(v[0], v[1], v[2]);
      }
    });
  }

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
  const topNrm = new Float32Array(topPos.length);
  for (let i = 1; i < topNrm.length; i += 3) topNrm[i] = 1;
  topGeo.setAttribute('normal', new THREE.BufferAttribute(topNrm, 3));
  topGeo.setIndex(topIdx);

  const bankGeo = new THREE.BufferGeometry();
  bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(bankPos, 3));
  bankGeo.computeVertexNormals();
  return { topGeo, bankGeo };
}

// The horizon filler: the FILLER raster as merged row runs, plus four big quads from the raster's edge out to 40 km
function buildFillerGeometry() {
  const g = FILLER;
  const pos = [];
  const quad = (x0, z0, x1, z1) => pos.push(x0, FILLER_Y, z0, x0, FILLER_Y, z1, x1, FILLER_Y, z1, x0, FILLER_Y, z0, x1, FILLER_Y, z1, x1, FILLER_Y, z0);
  // Runs of identical rows are merged into one quad
  let prev = null;
  let prevJ0 = 0;
  const flush = (j1) => {
    if (!prev) return;
    for (let s = 0; s < prev.length; s += 2) {
      quad(g.minX + prev[s] * g.cell, g.minZ + prevJ0 * g.cell, g.minX + prev[s + 1] * g.cell, g.minZ + j1 * g.cell);
    }
  };
  for (let j = 0; j <= g.nz; j++) {
    const runs = [];
    if (j < g.nz) {
      for (let i = 0; i < g.nx; i++) {
        if (!g.data[j * g.nx + i]) continue;
        const i0 = i;
        while (i < g.nx && g.data[j * g.nx + i]) i++;
        runs.push(i0, i);
      }
    }
    if (prev && runs.length === prev.length && runs.every((v, k) => v === prev[k])) continue;
    flush(j);
    prev = runs;
    prevJ0 = j;
  }
  const R = 40000;
  const x0 = g.minX;
  const x1 = g.minX + g.nx * g.cell;
  const z0 = g.minZ;
  const z1 = g.minZ + g.nz * g.cell;
  quad(-R, -R, R, z0);
  quad(-R, z1, R, R);
  quad(-R, z0, x0, z1);
  quad(x1, z0, R, z1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return geo;
}

// =====================================================================================================================
// 6. BUILDINGS
// =====================================================================================================================

// Unit box with its base at y = 0 and no bottom face
const BOX_GEO = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const src = g.index.array;
  const keep = [];
  for (let i = 0; i < src.length; i++) if (i < 18 || i >= 24) keep.push(src[i]);
  g.setIndex(keep);
  g.clearGroups();
  return g;
})();

// Facade swatches in sRGB (converted to linear when the instance tints are written)
const PALETTE = {
  // Plastered kamienice & villas: ochre, cream, grey-green, salmon; and red clinker brick
  plaster: [[0.80, 0.66, 0.44], [0.86, 0.80, 0.66], [0.62, 0.66, 0.58], [0.82, 0.62, 0.52], [0.72, 0.71, 0.68], [0.56, 0.28, 0.20]],
  house: [[0.86, 0.84, 0.78], [0.80, 0.76, 0.66], [0.74, 0.72, 0.70], [0.84, 0.74, 0.60], [0.66, 0.70, 0.72]],
  industrial: [[0.58, 0.55, 0.50], [0.62, 0.42, 0.34], [0.72, 0.72, 0.70], [0.50, 0.48, 0.45], [0.66, 0.63, 0.57]],
  modern: [[0.88, 0.87, 0.85], [0.70, 0.70, 0.69], [0.60, 0.62, 0.64], [0.82, 0.76, 0.66], [0.42, 0.40, 0.38]]
};
const PALETTE_STYLE = { panel: 3, plaster: 0, house: 0, industrial: 2, modern: 4 };

const pickFrom = (arr, rand) => arr[Math.floor(rand() * arr.length) % arr.length];

// Panel-block (wielka płyta) finishes for createPanelBlockMaterial, by share of the osiedla: bare grey and cream
// concrete, and the white insulation with blue, ochre or green accents of the 2000s thermal retrofits
// (termomodernizacja), which most Poznań slabs wear today. Each finish is one material (and one draw per chunk) on
// the one boxLocal pipeline; `tint` (sRGB) colours the roof structures on top.
const PANEL_FINISHES = [
  { weight: 0.22, opts: { panelColor: 0xbdbab2, seed: 81.3 }, tint: [0.74, 0.73, 0.70] },
  { weight: 0.14, opts: { panelColor: 0xd9cfb4, seed: 83.7 }, tint: [0.85, 0.81, 0.71] },
  { weight: 0.24, opts: { panelColor: 0xe6e1d6, accentColor: 0x9fb8c9, bandAccent: 0.7, seed: 86.1 }, tint: [0.90, 0.88, 0.84] },
  { weight: 0.22, opts: { panelColor: 0xe6e1d6, accentColor: 0xd8a86b, bandAccent: 0.7, seed: 88.9 }, tint: [0.90, 0.88, 0.84] },
  { weight: 0.18, opts: { panelColor: 0xe6e1d6, accentColor: 0x9cbf8e, bandAccent: 0.7, seed: 91.5 }, tint: [0.90, 0.88, 0.84] }
];
function pickFinish(rand) {
  let r = rand();
  for (let k = 0; k < PANEL_FINISHES.length; k++) if ((r -= PANEL_FINISHES[k].weight) < 0) return k;
  return PANEL_FINISHES.length - 1;
}

// Generic blocks out to ~9 km from the detail box (the aerial perspective swallows the city beyond ~8 km; the ground
// shader carries the street grids on to the horizon)
const MAX_BUILD_DIST = 9000;
const PANEL_STOREY = 2.8;
const PANEL_ATTIC = 1.2; // solid attic parapet over the top storey (the facade shows it as a coping band)
// Clear distance between panel buildings: ~0.9 x the taller one's height, never under 18 m
const panelGap = (h) => Math.max(18, 0.9 * h);

// World rectangles searched for each zone's blocks: the zone map's extent over the outskirts within reach
const BUILD_REGIONS = (() => {
  const regions = {};
  const sx = (LU.maxX - LU.minX) / LU.w;
  const sz = (LU.maxZ - LU.minZ) / LU.h;
  for (let j = 0; j < LU.h; j += 2) {
    const z = LU.minZ + (j + 0.5) * sz;
    for (let i = 0; i < LU.w; i += 2) {
      const x = LU.minX + (i + 0.5) * sx;
      if (inBox(x, z) || distToBox(x, z) > MAX_BUILD_DIST + 200 || fillerAt(x, z, true)) continue;
      const key = ZONE_LIST[zoneData[j * LU.w + i]].id;
      const r = regions[key] || (regions[key] = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
      r.x0 = Math.min(r.x0, x - 2 * sx);
      r.x1 = Math.max(r.x1, x + 2 * sx);
      r.z0 = Math.min(r.z0, z - 2 * sz);
      r.z1 = Math.max(r.z1, z + 2 * sz);
    }
  }
  return regions;
})();

// Building character by district kind and land use (heights, palette, lot width, row depth in m)
function neighbourhood(zone, lu) {
  const H = (hMin, hMax, palette, lot, extra = {}) => ({
    hMin, hMax, palette, style: PALETTE_STYLE[palette], lot, kind: 'rows', gap: 0.05, osiedle: 0, depth: 14, ...extra
  });
  if (lu.industry > 0.5 && lu.park < 0.35) return H(8, 16, 'industrial', 34, { kind: 'industrial', gap: 0.2, depth: 30 });
  if (zone.kind === 'osiedle') return H(0, 0, 'panel', 0, { kind: 'osiedle' });
  if (lu.suburb > 0.55) return H(6.5, 9.5, 'house', 14, { kind: 'suburb', gap: 0.22, depth: 10 });
  switch (zone.kind) {
    case 'urban': return H(11, 18, 'plaster', 13, { osiedle: 0.18 });                              // Grunwald, Górczyn
    case 'garden': return H(7, 12, 'house', 13, { kind: 'suburb', gap: 0.15, depth: 11, osiedle: 0.06 }); // Ogrody, Sołacz
    case 'modern': return H(13, 19, 'modern', 30, { gap: 0.2, osiedle: 0.1 });                     // Naramowice estates
    default: return H(6.5, 9.5, 'house', 14, { kind: 'suburb', gap: 0.25, depth: 10 });
  }
}

/**
 * Lays out one block: an osiedle superblock of 5-storey slabs, 11-storey slabs or 16-storey point blocks in greenery,
 * industrial sheds, or two rows of lots facing the long streets (plastered blocks, newer estates, houses).
 */
function generateBlock(list, zone, land, i, j, c, dM, lu, rand) {
  const rot = (-zone.angle * Math.PI) / 180;
  const u0 = i * zone.pu + zone.su * 0.5 + 2.2;
  const u1 = (i + 1) * zone.pu - zone.su * 0.5 - 2.2;
  const v0 = j * zone.pv + zone.sv * 0.5 + 2.2;
  const v1 = (j + 1) * zone.pv - zone.sv * 0.5 - 2.2;
  const bw = u1 - u0;
  const bd = v1 - v0;
  const radius = Math.hypot(bw, bd) * 0.5;
  const nearShore = shoreDist(land, c.x, c.z, radius + 12) < radius + 8;
  const hood = neighbourhood(zone, lu);

  // Footprint centred at (uc, vc) in zone coordinates, w along u, d along v
  const place = (uc, vc, w, d, h, tint, style) => {
    const p = zoneToWorld(zone, uc, vc);
    // The hand-placed satellite silhouettes stand on these footprints; a generic shed would poke through them
    if (satelliteClearance(p.x, p.z) < Math.hypot(w, d) * 0.5 + 4) return null;
    if (nearShore) {
      for (let k = 0; k < 8; k++) {
        const q = zoneToWorld(zone, uc + [-1, 0, 1, 1, 1, 0, -1, -1][k] * w * 0.5, vc + [-1, -1, -1, 0, 1, 1, 1, 0][k] * d * 0.5);
        if (landAt(q.x, q.z) !== land || shoreDist(land, q.x, q.z, 8) < 5) return null;
      }
    }
    // Zones meet at an angle: keep every footprint inside its own zone (panel blocks half a panelGap clear of the
    // border), so neighbouring grids' buildings don't run into each other
    const m = style === 3 ? 9 : 0;
    for (let k = 0; k < 4; k++) {
      const q = zoneToWorld(zone, uc + (k & 1 ? 1 : -1) * (w * 0.5 + m), vc + (k & 2 ? 1 : -1) * (d * 0.5 + m));
      if (zoneAt(q.x, q.z) !== zone) return null;
    }
    const rec = { x: p.x, y: land.top, z: p.z, w, h, d, rot, tint, style, seed: rand() * 100 };
    list.push(rec);
    return rec;
  };
  // Small roof structures (stair / lift rooms) add relief to the roofscape
  const roofBox = (rec, uc, vc) => {
    if (!rec || rec.h < 16 || dM > 2000 || rand() > 0.5) return;
    const p = zoneToWorld(zone, uc + (rand() - 0.5) * rec.w * 0.4, vc + (rand() - 0.5) * rec.d * 0.3);
    list.push({ x: p.x, y: rec.y + rec.h, z: p.z, w: Math.max(2.5, Math.min(8, rec.w * 0.3)), h: 2.6 + rand() * 1.2, d: Math.max(2.5, Math.min(8, rec.d * 0.3)), rot, tint: rec.tint, style: 2, seed: rand() * 100 });
  };

  const uc = (u0 + u1) * 0.5;
  const vc = (v0 + v1) * 0.5;

  // Osiedle superblock: slabs and point blocks set well apart on a lawn (the ground shader paints osiedle blocks as
  // lawns and trees). Panel buildings carry `panel` (finish, entrance side) and go to createPanelBlockMaterial.
  const panel = (rec, finish, tower) => {
    if (rec) rec.panel = { finish, tower, entry: rand() < 0.5 ? 0 : 1, shop: tower && rand() < 0.3 };
    return rec;
  };
  if (hood.kind === 'osiedle' || (hood.osiedle && rand() < hood.osiedle)) {
    const r = rand();
    const storeys = r < 0.5 ? 5 : r < 0.82 ? 11 : 16;
    const h = storeys * PANEL_STOREY + PANEL_ATTIC;
    const finish = pickFinish(rand);
    const finishOf = () => (rand() < 0.7 ? finish : pickFinish(rand));
    if (storeys === 16) {
      // A row of point blocks with a long 5-storey slab along the far side
      const n = Math.max(1, Math.min(4, Math.floor((bw + panelGap(h)) / (24 + panelGap(h)))));
      for (let k = 0; k < n; k++) {
        const tu = u0 + (bw / n) * (k + 0.5);
        const tv = v0 + bd * (0.3 + rand() * 0.15);
        const f = finishOf();
        roofBox(panel(place(tu, tv, 24, 21, h, PANEL_FINISHES[f].tint, 3), f, true), tu, tv);
      }
      if (bd > 90) {
        const f = finishOf();
        const sh = 5 * PANEL_STOREY + PANEL_ATTIC;
        roofBox(panel(place(uc, v1 - 8, Math.min(bw * 0.8, 110), 12, sh, PANEL_FINISHES[f].tint, 3), f, false), uc, v1 - 8);
      }
      return;
    }
    // Parallel slabs, spaced by about one and a half heights; a quarter of the blocks turn them across. Long 5-storey
    // slabs (60-120 m), shorter 11-storey ones; two slabs end to end keep panelGap between their gable ends.
    const across = rand() < 0.25;
    const lu0 = across ? v0 : u0;
    const span = across ? bd : bw;
    const deep = across ? bw : bd;
    const depth = storeys === 5 ? 12 : 13;
    const pitch = Math.max(30, h * 1.4) + depth;
    const rows = Math.max(1, Math.floor((deep - depth) / pitch) + 1);
    const off = (deep - depth - (rows - 1) * pitch) * 0.5 + depth * 0.5;
    const maxLen = storeys === 5 ? 120 : 80;
    const segs = span > maxLen + panelGap(h) + 30 ? 2 : 1;
    for (let k = 0; k < rows; k++) {
      if (rand() < 0.12) continue;
      for (let s = 0; s < segs; s++) {
        const share = span / segs;
        const len = Math.min(maxLen, share * (0.7 + rand() * 0.2), share - (segs > 1 ? panelGap(h) : 0));
        if (len < 30) continue;
        const a = lu0 + share * (s + 0.5);
        const b = (across ? u0 : v0) + off + k * pitch;
        const f = finishOf();
        const t = PANEL_FINISHES[f].tint;
        const rec = panel(across ? place(b, a, depth, len, h, t, 3) : place(a, b, len, depth, h, t, 3), f, false);
        if (across) roofBox(rec, b, a);
        else roofBox(rec, a, b);
      }
    }
    return;
  }

  // Industrial blocks: one to three big sheds / warehouses
  if (hood.kind === 'industrial') {
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      if (rand() < hood.gap) continue;
      const segW = bw / n;
      const w = segW * (0.7 + rand() * 0.28);
      const d = bd * (0.55 + rand() * 0.4);
      const tu = u0 + segW * (k + 0.5);
      const tv = vc + (rand() - 0.5) * (bd - d);
      place(tu, tv, w, d, hood.hMin + rand() * (hood.hMax - hood.hMin), pickFrom(PALETTE.industrial, rand), 2);
    }
    return;
  }

  // Lot rows (merged into wider buildings with distance)
  const lod = dM < 650 ? 1 : dM < 1600 ? 2.2 : dM < 3200 ? 3.4 : 5;
  const rowD = Math.min(bd * (hood.kind === 'suburb' ? 0.3 : 0.44), hood.depth);
  const blockH = hood.hMin + (hood.hMax - hood.hMin) * Math.pow(rand(), 1.2);
  const palette = PALETTE[hood.palette];
  const blockTint = pickFrom(palette, rand);
  for (const side of [0, 1]) {
    let u = u0;
    while (u < u1 - 2) {
      let w = hood.lot * lod * (0.75 + rand() * 0.6);
      if (u1 - u - w < hood.lot * 0.6) w = u1 - u;
      if (rand() < hood.gap) {
        u += w;
        continue;
      }
      const h = blockH * (0.85 + rand() * 0.3);
      const d = rowD * (0.8 + rand() * 0.2);
      const gap = hood.kind === 'suburb' ? 1.5 + rand() * 1.5 : 0.25;
      const ww = Math.max(3, w - gap);
      const tint = rand() < 0.55 ? blockTint : pickFrom(palette, rand);
      const vcc = side === 0 ? v0 + d * 0.5 : v1 - d * 0.5;
      roofBox(place(u + w * 0.5, vcc, ww, d, h, tint, hood.style), u + w * 0.5, vcc);
      u += w;
    }
  }
}

function generateOutskirtsBuildings() {
  const list = [];
  const stats = {};
  const rand = mulberry32(20261026);
  for (const zone of ZONE_LIST) {
    const reg = BUILD_REGIONS[zone.id];
    if (!reg) continue;
    let umin = Infinity;
    let umax = -Infinity;
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const [x, z] of [[reg.x0, reg.z0], [reg.x1, reg.z0], [reg.x1, reg.z1], [reg.x0, reg.z1]]) {
      const l = zoneToLocal(zone, x, z);
      umin = Math.min(umin, l.u);
      umax = Math.max(umax, l.u);
      vmin = Math.min(vmin, l.v);
      vmax = Math.max(vmax, l.v);
    }
    const before = list.length;
    for (let i = Math.floor(umin / zone.pu); i <= Math.ceil(umax / zone.pu); i++) {
      for (let j = Math.floor(vmin / zone.pv); j <= Math.ceil(vmax / zone.pv); j++) {
        const c = zoneToWorld(zone, (i + 0.5) * zone.pu, (j + 0.5) * zone.pv);
        if (c.x < reg.x0 || c.x > reg.x1 || c.z < reg.z0 || c.z > reg.z1) continue;
        if (zoneAt(c.x, c.z) !== zone) continue;
        // Blocks reaching into the detail box would stand on city-grid's streets
        if (distToBox(c.x, c.z) < Math.hypot(zone.pu, zone.pv) * 0.5) continue;
        const dM = distToBox(c.x, c.z);
        if (dM > MAX_BUILD_DIST) continue;
        const land = landAt(c.x, c.z);
        if (!land) continue;
        const lu = luAt(c.x, c.z);
        if (lu.park > 0.45 || lu.open > 0.45) continue;
        // Thin out with distance (suburbs first); the ground shader carries the texture beyond
        const keep = dM < 1000 ? 1 : 1 - smooth01((dM - 1000) / (MAX_BUILD_DIST - 1000)) * (0.93 + lu.suburb * 0.07);
        if (rand() > keep) continue;
        generateBlock(list, zone, land, i, j, c, dM, lu, rand);
      }
    }
    stats[zone.id] = list.length - before;
  }
  return { list, stats };
}

// Satellite silhouettes: retail panels, sheet-metal sheds and glass entrance wings on the same box pipeline as the
// outskirts buildings, plus a few roof-mounted HVAC boxes so the flat roofs read as roofs from above. One fixed seed
// keeps the roof plant reproducible.
const SATELLITE_STYLE = { panels: 4, steel: 2, glass: 1 };
const SATELLITE_ROOF_TINT = [0.55, 0.54, 0.52];

function buildSatelliteSiteBuildings() {
  const list = [];
  const rand = mulberry32(20261108);
  for (const site of SATELLITE_SITES) {
    for (const p of site.parts) {
      const a = (p.angle * Math.PI) / 180;
      const rot = -a;
      list.push({ x: p.x, y: LAND_TOP, z: p.z, w: p.w, h: p.h, d: p.d, rot, tint: p.tint, style: SATELLITE_STYLE[p.finish], seed: rand() * 100 });
      if (p.w * p.d < 3000) continue;
      const n = Math.max(1, Math.min(4, Math.round((p.w * p.d) / 9000)));
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      for (let k = 0; k < n; k++) {
        const uw = 6 + rand() * 8;
        const ud = 4 + rand() * 6;
        const uu = (rand() - 0.5) * Math.max(0, p.w - uw - 8);
        const vv = (rand() - 0.5) * Math.max(0, p.d - ud - 8);
        list.push({
          x: p.x + cs * uu - sn * vv,
          y: LAND_TOP + p.h,
          z: p.z + sn * uu + cs * vv,
          w: uw, h: 1.2 + rand() * 1.3, d: ud, rot, tint: SATELLITE_ROOF_TINT, style: 2, seed: rand() * 100
        });
      }
    }
  }
  return list;
}

// Karolin's two cooling towers and its 204 m chimney are the only non-box shapes. A unit lathe and a unit cylinder are
// instanced, so the whole skyline costs two draws and two pipelines.
const COOLING_PROFILE = [
  { r: 1.0, y: 0 }, { r: 0.94, y: 0.06 }, { r: 0.78, y: 0.28 }, { r: 0.64, y: 0.52 },
  { r: 0.68, y: 0.72 }, { r: 0.80, y: 0.9 }, { r: 0.86, y: 1.0 }
];

function buildSatelliteStructures() {
  const cooling = [];
  const chimneys = [];
  for (const site of SATELLITE_SITES) {
    for (const s of site.structures || []) (s.kind === 'cooling' ? cooling : chimneys).push(s);
  }
  if (!cooling.length && !chimneys.length) return [];
  const meshes = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const make = (geo, mat, data, name) => {
    const mesh = new THREE.InstancedMesh(geo, mat, data.length);
    for (let i = 0; i < data.length; i++) {
      const s = data[i];
      m.compose(p.set(s.x, LAND_TOP, s.z), q, sc.set(s.radius, s.height, s.radius));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = name;
    meshes.push(mesh);
  };
  if (cooling.length) {
    const geo = new THREE.LatheGeometry(COOLING_PROFILE.map((v) => new THREE.Vector2(v.r, v.y)), 18);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xbcb9b2, roughness: 0.94, metalness: 0 });
    make(geo, mat, cooling, 'OutskirtsSatelliteCoolingTowers');
  }
  if (chimneys.length) {
    const geo = new THREE.CylinderGeometry(0.55, 1, 1, 14);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.76, metalness: 0 });
    mat.colorNode = mix(srgb(0.76, 0.74, 0.70), srgb(0.58, 0.16, 0.13), step(0.5, fract(positionWorld.y.div(28.0))));
    make(geo, mat, chimneys, 'OutskirtsSatelliteChimneys');
  }
  return meshes;
}

// Spatially chunked InstancedMeshes (frustum culled per chunk) sharing one facade material
function buildBuildingChunks(list, material, chunkSize, name) {
  const chunks = new Map();
  for (const b of list) {
    const key = Math.floor(b.x / chunkSize) + ',' + Math.floor(b.z / chunkSize);
    let arr = chunks.get(key);
    if (!arr) chunks.set(key, (arr = []));
    arr.push(b);
  }
  const meshes = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const [key, arr] of chunks) {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(BOX_GEO.index);
    geo.setAttribute('position', BOX_GEO.attributes.position);
    geo.setAttribute('normal', BOX_GEO.attributes.normal);
    const info = new Float32Array(arr.length * 4);
    const tint = new Float32Array(arr.length * 4);
    const mesh = new THREE.InstancedMesh(geo, material, arr.length);
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      q.setFromAxisAngle(yAxis, b.rot);
      m.compose(p.set(b.x, b.y, b.z), q, s.set(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      info[i * 4] = b.w;
      info[i * 4 + 1] = b.h;
      info[i * 4 + 2] = b.d;
      info[i * 4 + 3] = b.seed;
      tint[i * 4] = toLinear(b.tint[0]);
      tint[i * 4 + 1] = toLinear(b.tint[1]);
      tint[i * 4 + 2] = toLinear(b.tint[2]);
      tint[i * 4 + 3] = b.style;
    }
    geo.setAttribute('bInfo', new THREE.InstancedBufferAttribute(info, 4));
    geo.setAttribute('bTint', new THREE.InstancedBufferAttribute(tint, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = name + ':' + key;
    meshes.push(mesh);
  }
  return meshes;
}

// Panel buildings: createFacadeBoxes boxes (whole panel bays on every wall, y = box centre) on the wielka płyta
// facade, one InstancedMesh per chunk and finish. Slabs show windowless gable ends on their short sides and the
// stairwell doors on one long side; point blocks have windows all round, some with glazed shops on the ground floor.
function buildPanelChunks(list, chunkSize, name) {
  const materials = PANEL_FINISHES.map((f) => createPanelBlockMaterial({ ...f.opts, boxLocal: true }));
  const groups = new Map();
  for (const b of list) {
    const key = Math.floor(b.x / chunkSize) + ',' + Math.floor(b.z / chunkSize) + ':' + b.panel.finish;
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push(b);
  }
  const { shop, entry, rear, lotLine } = WALL_KINDS;
  const meshes = [];
  for (const [key, arr] of groups) {
    const boxes = arr.map((b) => {
      const p = b.panel;
      const front = p.shop ? shop : entry;
      let faces;
      if (p.tower) faces = p.entry ? [rear, rear, front, rear] : [rear, rear, rear, front];
      else if (b.w >= b.d) faces = p.entry ? [lotLine, lotLine, entry, rear] : [lotLine, lotLine, rear, entry];
      else faces = p.entry ? [entry, rear, lotLine, lotLine] : [rear, entry, lotLine, lotLine];
      return { x: b.x, y: b.y + b.h * 0.5, z: b.z, w: b.w, h: b.h, d: b.d, ry: b.rot, faces, tone: (b.seed % 1) * 0.98 };
    });
    const mesh = createFacadeBoxes(materials[arr[0].panel.finish], boxes);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = name + ':' + key;
    meshes.push(mesh);
  }
  // Every finish is the same pipeline: precompile one of them
  for (const mesh of meshes) if (mesh !== meshes[0]) mesh.userData.sharesPipelineWith = meshes[0];
  return meshes;
}

// =====================================================================================================================
// 7. ASSEMBLY
// =====================================================================================================================

/**
 * Builds Poznań outside the detail box: the outskirts land with its banks, the horizon filler and the instanced
 * outskirts buildings, under one `Outskirts` group added to the scene. Nothing here moves or collides: the player
 * never leaves the detail box on the ground, so `colliders` is empty.
 */
function buildOutskirts(scene) {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'Outskirts';

  const landMat = createLandMaterial();
  const { topGeo, bankGeo } = buildLandGeometries();
  const landMesh = new THREE.Mesh(topGeo, landMat);
  landMesh.name = 'OutskirtsLand';
  const bankMesh = new THREE.Mesh(bankGeo, landMat);
  bankMesh.name = 'OutskirtsBanks';
  const fillerMesh = new THREE.Mesh(buildFillerGeometry(), landMat);
  fillerMesh.name = 'OutskirtsFiller';
  group.add(landMesh, bankMesh, fillerMesh);

  const { list, stats } = generateOutskirtsBuildings();
  const satellites = buildSatelliteSiteBuildings();
  for (const b of satellites) list.push(b);
  const panels = list.filter((b) => b.panel);
  const others = list.filter((b) => !b.panel);
  const buildingMat = createBoroughBuildingMaterial();
  for (const mesh of buildBuildingChunks(others, buildingMat, 1200, 'OutskirtsBuildings')) group.add(mesh);
  // Bigger chunks for the panel blocks, as each costs one draw per finish: 60 draws over the osiedla (2400 m: 96)
  for (const mesh of buildPanelChunks(panels, 3600, 'OutskirtsPanelBlocks')) group.add(mesh);
  for (const mesh of buildSatelliteStructures()) group.add(mesh);

  scene.add(group);
  console.info(`[outskirts] ${list.length} buildings (${panels.length} panel blocks, ${satellites.length} satellite boxes) ${JSON.stringify(stats)} built in ${(performance.now() - t0).toFixed(0)} ms`);
  return { group, colliders: [] };
}

export { buildOutskirts };
