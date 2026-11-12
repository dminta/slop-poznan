import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CITY_BOUNDS,
  LAND_RINGS,
  LAND_HOLES,
  PLAZAS,
  ROADS,
  BLOCKS,
  UNDERPASS_SIDEWALKS,
  blockAt,
  distToWater,
  blockLots,
  distToLots,
  createTreeWallChecker,
  TEATR_POLSKI_SITE,
  TEATR_POLSKI_LAWNS,
  SPECIES_CROWN_R,
  createPolygonIndex,
  pointInPolyIndexed,
  pointInBlockPoly,
  releaseParkIndexes
} from './city-config.js';
import { GEO } from './geodata.js';
import {
  createRoadSurfaceMaterial,
  createSidewalkMaterial,
  createCurbMaterial,
  createWaterMaterial,
  createParkLawnMaterial,
  createParkPavingMaterial,
  createParkLampGlobeMaterial,
  createParkLampPoolMaterial
} from './tsl-materials.js';

// Live construction data consumed by the building and street-detail builders after buildCityGrid().
let parkTreeSites;
let parkLampSites;
let pavedPlazaRects;
let sidewalkBlocks;

// Surveyed refuge link between the western Dworzec zebra and the shared crossing to the southern sidewalk.
// Routing is built after the grid; keep its 3 m walking/queuing corridor out of the earlier planted median.
const MEDIAN_REFUGE_CORRIDORS = [[-1582.819, 563.234, -1580.760, 558.363]];

// js/city-grid.js
// Builds the city's ground: the Warta and the ponds at CITY_BOUNDS.waterLevel, the street-level land deck (LAND_RINGS
// minus the ponds) with stone embankments down to the water, the raised sidewalks & curbs of every curb island
// (BLOCKS), the paved squares (PLAZAS) and the lawns, trees & lampposts of the park blocks.

/**
 * Merges static non-instanced THREE.Mesh objects sharing the same material into a single
 * batched BufferGeometry per material to minimize WebGPU render & shadow pass draw calls.
 */
function batchStaticGroupMeshes(rootGroup, excludeMaterials = null) {
  if (!mergeGeometries) return;
  rootGroup.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
  const buckets = new Map();

  rootGroup.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || !obj.geometry || !obj.material) return;
    if (excludeMaterials && excludeMaterials.has(obj.material)) return;
    const attrs = obj.geometry.attributes;
    if (!attrs.position || !attrs.normal || !attrs.uv) return;
    if (!buckets.has(obj.material)) {
      buckets.set(obj.material, []);
    }
    buckets.get(obj.material).push(obj);
  });

  for (const [mat, meshes] of buckets.entries()) {
    if (meshes.length < 2) continue;
    const geos = [];
    let anyCast = false;
    let anyReceive = false;

    for (const m of meshes) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') {
          g.deleteAttribute(key);
        }
      }
      const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      geos.push(g);
      if (m.castShadow) anyCast = true;
      if (m.receiveShadow) anyReceive = true;
      if (m.parent) m.parent.remove(m);
    }

    const merged = mergeGeometries(geos, false);
    if (merged) {
      const batchedMesh = new THREE.Mesh(merged, mat);
      batchedMesh.castShadow = anyCast;
      batchedMesh.receiveShadow = anyReceive;
      rootGroup.add(batchedMesh);
    }
  }
}

/**
 * Helper to convert an array of world {x, z} polygon vertices (and optional hole rings) into a horizontal THREE.Shape
 * in (x, -z) space so that rotating by rotateX(-Math.PI / 2) maps (x, -z, 0) -> (x, 0, z) with an upward (+Y) surface
 * normal. Either winding works for the outline and the holes: ShapeUtils reorders them when triangulating.
 */
function createWorldXZShape(pts, holes = []) {
  const shape = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  }
  shape.closePath();
  for (const h of holes) {
    const path = new THREE.Path();
    for (let i = 0; i < h.length; i++) {
      if (i === 0) path.moveTo(h[i].x, -h[i].z);
      else path.lineTo(h[i].x, -h[i].z);
    }
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false, holes = []) {
  const shape = createWorldXZShape(pts, holes);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bottomY, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  mesh.castShadow = castShadow;
  return mesh;
}

function createFlatPolygonMesh(pts, y, material, receiveShadow = true, holes = []) {
  const shape = createWorldXZShape(pts, holes);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * A simple polygon ([{x, z}], either winding, convex or not) offset inward by d with mitred corners (miters clamped
 * to 3d); null if it collapses
 */
/** The point of ring `pts` ({x, z} list, closed implicitly) nearest to (x, z) */
function nearestOnRing(pts, x, z) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j];
    const dx = pts[i].x - a.x;
    const dz = pts[i].z - a.z;
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    const px = a.x + t * dx;
    const pz = a.z + t * dz;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
  }
  return best;
}

function offsetPolygonInward(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? 1 : -1; // positive area: the inside lies left of each edge, i.e. along (-dz, dx)
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z;
    let bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9;
    const lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s; // inward normals of the two edges
    const n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * d, z: q.z + n1z * d }); continue; }
    mx /= ml; mz /= ml;
    const cos = mx * n1x + mz * n1z; // miter length = d / cos(half angle)
    const len = Math.min(3 * d, d / Math.max(1e-3, cos));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  let a2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a2 += out[j].x * out[i].z - out[i].x * out[j].z;
  return a2 * area > 0 && Math.abs(a2) < Math.abs(area) ? out : null;
}

// Trim the narrow end of Park Maciejewski's island before insetting its bed. The 5 m inset otherwise
// folds across itself where the island tapers to less than 10 m at Św. Marcin.
function parkBedOutline(b) {
  // Shorten the tapered corner near Pułaskiego/Cicha before insetting; otherwise the bed folds over the road.
  if (b.minX === -892 && b.maxX === -503 && b.minZ === -1206 && b.maxZ === -904.5) {
    const cutX = -880;
    const out = [];
    for (let i = 0; i < b.poly.length; i++) {
      const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
      if (a.x >= cutX) out.push(a);
      if ((a.x >= cutX) !== (c.x >= cutX)) {
        const t = (cutX - a.x) / (c.x - a.x);
        out.push({ x: cutX, z: a.z + (c.z - a.z) * t });
      }
    }
    return out;
  }
  if (b.parkName !== 'Park Romana Maciejewskiego') return b.poly;
  const cutZ = 200;
  const out = [];
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i];
    const c = b.poly[(i + 1) % b.poly.length];
    if (a.z >= cutZ) out.push(a);
    if ((a.z >= cutZ) !== (c.z >= cutZ)) {
      const t = (cutZ - a.z) / (c.z - a.z);
      out.push({ x: a.x + (c.x - a.x) * t, z: cutZ });
    }
  }
  return out;
}

// The usual five-metre inset folds these narrow park outlines across themselves. The measured smaller
// insets keep both the coping and its 0.3 m lawn inset simple and within the original park outline.
function parkBedInset(b, roadCuts) {
  if (b.minX === -2384 && b.maxX === -2242 && b.minZ === -2323.5 && b.maxZ === -2174) return 0.2;
  if (b.minX === -2342 && b.maxX === -2214.5 && b.minZ === -2325 && b.maxZ === -2160.5) return 0.2;
  if (b.minX === -2359 && b.maxX === -1917 && b.minZ === -2830 && b.maxZ === -2170) return 0.2;
  if (b.minX === -766.5 && b.maxX === -556 && b.minZ === -1221 && b.maxZ === -1054.5) return 0.2;
  if (b.minX === -1347.5 && b.maxX === -1271.5 && b.minZ === -526 && b.maxZ === -369) return 0.5;
  if (b.minX === -892 && b.maxX === -503 && b.minZ === -1206 && b.maxZ === -904.5) return 1;
  if (b.parkName === 'Park Stanisława Moniuszki') return 0.8;
  if (b.parkName === 'Skwer Sybiraków') return 1;
  if (b.minX === -1804.5 && b.maxX === -1742.5 && b.minZ === -1317 && b.maxZ === -1111) return 0.8;
  if (b.minX === 842.5 && b.maxX === 1049 && b.minZ === -2604 && b.maxZ === -2528.5) return 2;
  if (b.minX === -811.5 && b.maxX === -770.5 && b.minZ === 2667 && b.maxZ === 2759) return 0.1;
  if ((b.minX === 1610 && b.maxX === 2181 && b.minZ === 1687 && b.maxZ === 2106.5) ||
    (b.minX === 2468.5 && b.maxX === 2647 && b.minZ === 2468 && b.maxZ === 2611) ||
    (b.minX === 2492.5 && b.maxX === 2684.5 && b.minZ === 2693.5 && b.maxZ === 2821)) return 0.5;
  // The Chartowo park only loses a corner to the Bolesława Krzywoustego corridor; keep its usual wide bed.
  if (b.minX === 2415.5 && b.maxX === 2544 && b.minZ === 2484 && b.maxZ === 2687) return 5;
  return roadCuts ? 0.8 : Math.min(5, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.2);
}

// Distance from (x, z) to the nearest edge of a closed ring, or `limit` when every edge is farther (the caller only
// compares it with a threshold, so a capped value keeps the comparison exact). The first query builds a 16 m edge grid
// for the ring, then each later query visits only the cells whose lower bound can still beat `best`: the plaza and park
// lamp loops ask the same 300-2,000 vertex outlines dozens of times (ringDist was 203 ms of the 2026-11-11 headless
// city-grid build, mostly on the Cytadela's and the big squares' outlines).
let ringDistIndexes = new WeakMap();
function ringDist(ring, x, z, limit = Infinity) {
  if (limit === Infinity) {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      const dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
    }
    return best;
  }
  let index = ringDistIndexes.get(ring);
  if (!index) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    ringDistIndexes.set(ring, index = { grid: ringEdgeGrid(ring), minX, minZ, maxX, maxZ });
  }
  if (x < index.minX - limit || x > index.maxX + limit || z < index.minZ - limit || z > index.maxZ + limit) return limit;
  const gx = cellOf(x), gz = cellOf(z);
  const n = ring.length;
  let best = limit;
  const visit = (cx, cz) => {
    const list = index.grid.get(cx * 100000 + cz);
    if (!list) return;
    for (const i of list) {
      const a = ring[i];
      const c = ring[(i + 1) % n];
      const dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
      const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
      if (d < best) best = d;
    }
  };
  for (let r = 0; ; r++) {
    // every cell of ring r+1 (and beyond) is at least r * EDGE_CELL from the query point
    if (r > 0 && best <= (r - 1) * EDGE_CELL) break;
    if (r === 0) {
      visit(gx, gz);
      continue;
    }
    for (let i = gx - r; i <= gx + r; i++) {
      visit(i, gz - r);
      visit(i, gz + r);
    }
    for (let j = gz - r + 1; j < gz + r; j++) {
      visit(gx - r, j);
      visit(gx + r, j);
    }
  }
  return best;
}

function polygonCentroidArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a * 0.5;
}

// Cached edge index for a polygon sampled at many points (createPolygonIndex / pointInPolyIndexed in city-config.js).
// The park and plaza loops below test the same curb or park outline every 11-22 m; the index keeps the exact ray test
// but visits only the edges whose z span covers the sample (pointInPolygonXZ fell from 11.1% to 0.3% of the headless
// city-grid build).
const polygonIndexes = new WeakMap();
function polygonIn(pts, x, z) {
  let index = polygonIndexes.get(pts);
  if (!index) polygonIndexes.set(pts, index = createPolygonIndex(pts));
  return pointInPolyIndexed(pts, index, x, z);
}

function pointInPolygonXZ(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Polygon offset by d (d > 0 inward, d < 0 outward), mitred corners clamped to 3|d|; null if it degenerates */
function offsetPolygon(pts, d) {
  if (d > 0) return offsetPolygonInward(pts, d);
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? -1 : 1; // outward normal side
  const D = -d;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], q = pts[i], r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z, bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9, lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s, n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * D, z: q.z + n1z * D }); continue; }
    mx /= ml; mz /= ml;
    const len = Math.min(3 * D, D / Math.max(1e-3, mx * n1x + mz * n1z));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  return out;
}

// Do segments ab and cd properly cross (touching and collinear overlaps excluded)?
function segmentsIntersect(a, b, c, d) {
  const cdx = d.x - c.x, cdz = d.z - c.z;
  const d1 = cdx * (a.z - c.z) - cdz * (a.x - c.x), d2 = cdx * (b.z - c.z) - cdz * (b.x - c.x);
  if (!((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9))) return false;
  const abx = b.x - a.x, abz = b.z - a.z;
  const d3 = abx * (c.z - a.z) - abz * (c.x - a.x), d4 = abx * (d.z - a.z) - abz * (d.x - a.x);
  return (d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9);
}

// Edges of a ring bucketed on a 16 m grid, so checking a park outline (often 1,000+ vertices) against hundreds of
// footprint holes costs a few edge tests per hole edge instead of a full scan
const EDGE_CELL = 16;
const _edgeCells = [];

// Math.floor without the global lookup, which costs ~10x in the vm test harness; edgeCells is the hot loop
const cellOf = (v) => {
  const q = v / EDGE_CELL, i = q | 0;
  return i > q ? i - 1 : i;
};

/**
 * The grid cells segment ab passes through (padded by 1 mm), column by column, into `out`. Walking the segment rather
 * than its bounding box matters: a 500 m diagonal park edge spans ~1,000 bbox cells but only ~60 crossed ones.
 */
function edgeCells(a, b, out = _edgeCells) {
  const m = 1e-3;
  out.length = 0;
  const minX = a.x < b.x ? a.x : b.x, maxX = a.x < b.x ? b.x : a.x;
  const gx0 = cellOf(minX - m), gx1 = cellOf(maxX + m);
  const dx = b.x - a.x, flat = dx < 1e-9 && dx > -1e-9, slope = flat ? 0 : (b.z - a.z) / dx;
  for (let gx = gx0; gx <= gx1; gx++) {
    let zLo, zHi;
    if (gx0 === gx1 || flat) {
      zLo = a.z < b.z ? a.z : b.z; zHi = a.z < b.z ? b.z : a.z;
    } else {
      const x0 = gx * EDGE_CELL - m, x1 = (gx + 1) * EDGE_CELL + m;
      const zl = a.z + ((x0 > minX ? x0 : minX) - a.x) * slope, zr = a.z + ((x1 < maxX ? x1 : maxX) - a.x) * slope;
      zLo = zl < zr ? zl : zr; zHi = zl < zr ? zr : zl;
    }
    const gz1 = cellOf(zHi + m);
    for (let gz = cellOf(zLo - m); gz <= gz1; gz++) out.push(gx * 100000 + gz);
  }
  return out;
}

function ringEdgeGrid(ring) {
  const grid = new Map();
  for (let i = 0, n = ring.length; i < n; i++) {
    for (const k of edgeCells(ring[i], ring[(i + 1) % n])) {
      const list = grid.get(k);
      if (list) list.push(i); else grid.set(k, [i]);
    }
  }
  return grid;
}

/** Does any edge of `inner` properly cross an edge of `outer` (indexed by ringEdgeGrid)? */
function ringCrossesGrid(outer, grid, inner) {
  const n = outer.length;
  for (let i = 0, m = inner.length; i < m; i++) {
    const a = inner[i], b = inner[(i + 1) % m];
    for (const k of edgeCells(a, b)) {
      const list = grid.get(k);
      if (!list) continue;
      for (const j of list) if (segmentsIntersect(a, b, outer[j], outer[(j + 1) % n])) return true;
    }
  }
  return false;
}

function lineIntersection(p1, p2, p3, p4) {
  const d = (p1.x - p2.x) * (p3.z - p4.z) - (p1.z - p2.z) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p1.x - p3.x) * (p3.z - p4.z) - (p1.z - p3.z) * (p3.x - p4.x)) / d;
  return { x: p1.x + t * (p2.x - p1.x), z: p1.z + t * (p2.z - p1.z), t };
}

// Subdivides segments where any vertex lies along a non-adjacent edge so collinear overlaps match exactly. One pass
// inserts every such vertex in order along its edge: the inserted points are existing vertices, so they create no new
// on-edge cases (an earlier one-insertion-per-pass loop stopped after 20 and left folds like block 613's lawn unsplit)
function insertVerticesOnEdges(pts) {
  const n = pts.length;
  const grid = new Map();
  for (let j = 0; j < n; j++) {
    const p = pts[j];
    const k = cellOf(p.x) * 100000 + cellOf(p.z);
    const list = grid.get(k);
    if (list) list.push(j); else grid.set(k, [j]);
  }
  const ring = [];
  const hits = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    ring.push(a);
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-8) continue;
    hits.length = 0;
    for (const k of edgeCells(a, b)) {
      const list = grid.get(k);
      if (!list) continue;
      for (const j of list) {
        if (j === i || j === (i + 1) % n) continue;
        const p = pts[j];
        const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2;
        if (t > 1e-4 && t < 1 - 1e-4 && Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) < 1e-4) hits.push({ t, p });
      }
    }
    if (!hits.length) continue;
    hits.sort((u, v) => u.t - v.t);
    let last = a;
    for (const { p } of hits) {
      if (Math.hypot(p.x - last.x, p.z - last.z) < 1e-4) continue;
      last = { x: p.x, z: p.z };
      ring.push(last);
    }
  }
  return ring;
}

// Splits corridors that collapsed to coincident reverse edges into separate simple rings
function splitReverseEdges(ring) {
  const ptKey = (p) => Math.round(p.x * 20) + ',' + Math.round(p.z * 20);
  const queue = [ring];
  const out = [];
  while (queue.length > 0) {
    let p = queue.pop();
    const n = p.length;
    const edgeMap = new Map();
    let split = false;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const kRev = ptKey(b) + '->' + ptKey(a);
      if (edgeMap.has(kRev)) {
        const j = edgeMap.get(kRev);
        if (Math.abs(i - j) > 1 && Math.abs(i - j) < n - 1) {
          const idx1 = Math.min(i, j), idx2 = Math.max(i, j);
          const r1 = p.slice(idx1 + 1, idx2 + 1);
          const r2 = p.slice(0, idx1 + 1).concat(p.slice(idx2 + 1));
          if (r1.length >= 3 && Math.abs(polygonCentroidArea(r1)) > 0.05) queue.push(r1);
          if (r2.length >= 3 && Math.abs(polygonCentroidArea(r2)) > 0.05) queue.push(r2);
          split = true;
          break;
        }
      }
      edgeMap.set(ptKey(a) + '->' + ptKey(b), i);
    }
    if (!split && p.length >= 3 && Math.abs(polygonCentroidArea(p)) > 0.05) {
      out.push(p);
    }
  }
  return out;
}

// Splits self-touching boundaries where non-adjacent vertices meet at the same location
function splitPinchVertices(ring) {
  const ptKey = (p) => Math.round(p.x * 20) + ',' + Math.round(p.z * 20);
  const queue = [ring];
  const out = [];
  while (queue.length > 0) {
    let p = queue.pop();
    const n = p.length;
    const vMap = new Map();
    let split = false;
    for (let i = 0; i < n; i++) {
      const k = ptKey(p[i]);
      if (vMap.has(k)) {
        const j = vMap.get(k);
        if (Math.abs(i - j) > 1 && Math.abs(i - j) < n - 1) {
          const idx1 = Math.min(i, j), idx2 = Math.max(i, j);
          const r1 = p.slice(idx1, idx2);
          const r2 = p.slice(0, idx1).concat(p.slice(idx2));
          if (r1.length >= 3 && Math.abs(polygonCentroidArea(r1)) > 0.05) queue.push(r1);
          if (r2.length >= 3 && Math.abs(polygonCentroidArea(r2)) > 0.05) queue.push(r2);
          split = true;
          break;
        }
      }
      vMap.set(k, i);
    }
    if (!split && p.length >= 3 && Math.abs(polygonCentroidArea(p)) > 0.05) {
      out.push(p);
    }
  }
  return out;
}

// Splits crossings selecting the first intersection along each edge (t closest to 0) to avoid slicing peninsulas
function splitCrossings(pts) {
  const initialSign = Math.sign(polygonCentroidArea(pts));
  const queue = [pts];
  const result = [];
  while (queue.length > 0) {
    let ring = queue.pop();
    let maxIters = 100;
    let wasSplit = false;
    while (maxIters-- > 0 && !wasSplit) {
      let bestI = -1, bestJ = -1, bestT = Infinity, bestPt = null;
      const n = ring.length;
      // the first crossed edge i, nearest crossing along it (ties to the lowest j); the edge grid keeps this linear
      // for the 1,000-vertex park outlines, which mostly have no crossing at all
      const grid = ringEdgeGrid(ring);
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        for (const k of edgeCells(a, b)) {
          const list = grid.get(k);
          if (!list) continue;
          for (const j of list) {
            if (j < i + 2 || (i === 0 && j === n - 1)) continue;
            if (!segmentsIntersect(a, b, ring[j], ring[(j + 1) % n])) continue;
            const pt = lineIntersection(a, b, ring[j], ring[(j + 1) % n]);
            if (pt && pt.t > 1e-5 && (pt.t < bestT || (pt.t === bestT && j < bestJ))) {
              bestT = pt.t;
              bestI = i;
              bestJ = j;
              bestPt = { x: pt.x, z: pt.z };
            }
          }
        }
        if (bestI !== -1) break;
      }
      if (bestI === -1) break;

      const r1 = ring.slice(0, bestI + 1).concat([bestPt], ring.slice(bestJ + 1));
      const r2 = [bestPt].concat(ring.slice(bestI + 1, bestJ + 1));
      const s1 = polygonCentroidArea(r1);
      const s2 = polygonCentroidArea(r2);
      if (s1 * s2 < 0) {
        ring = Math.sign(s1) === initialSign ? r1 : r2;
      } else if (Math.abs(s1) < 0.05 || Math.abs(s2) < 0.05) {
        ring = Math.abs(s1) > Math.abs(s2) ? r1 : r2;
      } else {
        queue.push(r1);
        queue.push(r2);
        wasSplit = true;
      }
    }
    if (!wasSplit && ring.length >= 3 && Math.abs(polygonCentroidArea(ring)) > 0.05) {
      result.push(ring);
    }
  }
  return result;
}

// Splits a pinched outline into simple disjoint rings: decomposes collinear corridor collapses and crossing folds
function splitIntoSimpleRings(pts) {
  if (!pts || pts.length < 3) return pts ? [pts] : [];
  const sub = insertVerticesOnEdges(pts);
  const rev = splitReverseEdges(sub);
  const pin = [];
  for (const r of rev) pin.push(...splitPinchVertices(r));
  const result = [];
  for (const r of pin) {
    result.push(...splitCrossings(r));
  }
  return result;
}

/**
 * Tags every vertex of a mesh using the shared park paving material with its paving style (uv.x, see
 * createParkPavingMaterial: 0 mineral park walks, 1 granite setts, 2 concrete slabs).
 */
function setPavingStyle(geo, style) {
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, style, 0);
  uvAttr.needsUpdate = true;
  return geo;
}

/** Is every vertex of ring `inner` inside polygon `outer`? (holes must lie wholly inside the shape they cut) */
function ringInside(outer, inner) {
  return inner.every((p) => pointInPolygonXZ(outer, p.x, p.z));
}

/**
 * Axis-aligned rects covering a paved area for the consumers that work on rectangles (street trees and props keep off
 * them): its bounds when it fills at least half of them, else one rect per 10 m row and run inside the ring, so a long
 * L-shaped pedestrian street does not blank out the blocks inside its bounding box.
 */
function coverRects(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  if (Math.abs(polygonCentroidArea(ring)) >= 0.5 * (maxX - minX) * (maxZ - minZ)) return [{ minX, maxX, minZ, maxZ }];
  const ROW = 10;
  const out = [];
  for (let z0 = minZ; z0 < maxZ; z0 += ROW) {
    const z1 = Math.min(maxZ, z0 + ROW);
    // crossings at the row's two edges and centre, so the run takes in the ring's whole width over the row
    const runs = [];
    for (const z of [z0 + 0.01, (z0 + z1) * 0.5, z1 - 0.01]) {
      const xs = [];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a.z > z) !== (b.z > z)) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) runs.push([xs[k], xs[k + 1]]);
    }
    runs.sort((p, q) => p[0] - q[0]);
    let cur = null;
    for (const [a, b] of runs) {
      if (cur && a <= cur[1] + 0.5) cur[1] = Math.max(cur[1], b);
      else {
        if (cur) out.push({ minX: cur[0], maxX: cur[1], minZ: z0, maxZ: z1 });
        cur = [a, b];
      }
    }
    if (cur) out.push({ minX: cur[0], maxX: cur[1], minZ: z0, maxZ: z1 });
  }
  return out;
}

// --- Tram and railway track clearance --------------------------------------------------------------------------------
// Trams do not collide with props, so every piece of square, park and street furniture keeps its footprint
// RAIL_PROP_KEEP from every GEO.rail centreline (a 2.4 m tram body is 1.2 m either side of it, plus its sway and the
// overhang on curves). Squares crossed by tram track are paved round it: the slab is cut TRAM_CUT either side of each
// track (half the 1435 mm gauge, the 70 mm heads and 1.5 m of clearance), so the rails, laid flush on the deck by
// tram-infra.js, stay in sight instead of under the 0.24 m slab.
const RAIL_PROP_KEEP = 2.0;
const TRAM_CUT = 0.7175 + 0.07 + 1.5;
const RAIL_CELL = 32;
let _railCells = null;
function railCells() {
  if (_railCells) return _railCells;
  _railCells = new Map();
  for (const r of GEO.rail || []) {
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const seg = {
        ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3],
        x0: Math.min(p[i], p[i + 2]), x1: Math.max(p[i], p[i + 2]),
        z0: Math.min(p[i + 1], p[i + 3]), z1: Math.max(p[i + 1], p[i + 3])
      };
      for (let ix = Math.floor(seg.x0 / RAIL_CELL); ix <= Math.floor(seg.x1 / RAIL_CELL); ix++) {
        for (let iz = Math.floor(seg.z0 / RAIL_CELL); iz <= Math.floor(seg.z1 / RAIL_CELL); iz++) {
          const k = ix * 100003 + iz;
          if (!_railCells.has(k)) _railCells.set(k, []);
          _railCells.get(k).push(seg);
        }
      }
    }
  }
  return _railCells;
}

/** Distance from (x, z) to the nearest GEO.rail centreline (tram or mainline), capped at `r` */
function railClearance(x, z, r = 8) {
  const cells = railCells();
  let best = r;
  for (let ix = Math.floor((x - r) / RAIL_CELL); ix <= Math.floor((x + r) / RAIL_CELL); ix++) {
    for (let iz = Math.floor((z - r) / RAIL_CELL); iz <= Math.floor((z + r) / RAIL_CELL); iz++) {
      for (const s of cells.get(ix * 100003 + iz) || []) {
        // bbox rejected against the best distance found: most segments in a 32 m cell are farther than the cap, and
        // the park/plaza tree, lamp and bench checks (300 ms of the city-grid build) only ask for a few metres
        if (x < s.x0 - best || x > s.x1 + best || z < s.z0 - best || z > s.z1 + best) continue;
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const L2 = ex * ex + ez * ez;
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
        const d = Math.hypot(s.ax + ex * t - x, s.az + ez * t - z);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** Is a prop whose footprint reaches `radius` from (x, z) at least RAIL_PROP_KEEP from every track? */
function clearOfRails(x, z, radius) {
  return railClearance(x, z, RAIL_PROP_KEEP + radius + 1) >= RAIL_PROP_KEEP + radius;
}

/** Twice the signed area of triangle a, b, c: positive when it turns left in (x, z) */
function cross2(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/**
 * Ear-clipped triangles of a simple ring ({x, z} list, either winding, no holes), each turning left; collinear and
 * repeated vertices are dropped on the way
 */
function triangulateRing(ring) {
  const pts = ring.filter((p, i) => {
    const q = ring[(i + ring.length - 1) % ring.length];
    return Math.abs(p.x - q.x) + Math.abs(p.z - q.z) > 1e-6;
  });
  const s = polygonCentroidArea(pts) > 0 ? 1 : -1;
  const idx = pts.map((_, i) => i);
  const tris = [];
  // on the boundary counts: a reflex vertex on the diagonal a-c makes a-b-c no ear
  const inside = (p, a, b, c) => cross2(a, b, p) * s >= -1e-9 && cross2(b, c, p) * s >= -1e-9 && cross2(c, a, p) * s >= -1e-9;
  while (idx.length > 3) {
    let cut = -1;
    for (let k = 0; k < idx.length && cut < 0; k++) {
      const a = pts[idx[(k + idx.length - 1) % idx.length]], b = pts[idx[k]], c = pts[idx[(k + 1) % idx.length]];
      if (cross2(a, b, c) * s <= 1e-9) continue; // reflex or flat
      if (idx.some((j) => pts[j] !== a && pts[j] !== b && pts[j] !== c && inside(pts[j], a, b, c))) continue;
      tris.push(s > 0 ? [a, b, c] : [c, b, a]);
      cut = k;
    }
    if (cut < 0) {
      // no ear left: only flat vertices (or a self-touching ring) remain; drop the flattest one
      let flat = 0, least = Infinity;
      for (let k = 0; k < idx.length; k++) {
        const v = Math.abs(cross2(pts[idx[(k + idx.length - 1) % idx.length]], pts[idx[k]], pts[idx[(k + 1) % idx.length]]));
        if (v < least) { least = v; flat = k; }
      }
      cut = flat;
    }
    idx.splice(cut, 1);
  }
  if (idx.length === 3 && Math.abs(cross2(pts[idx[0]], pts[idx[1]], pts[idx[2]])) > 1e-9) {
    const [a, b, c] = idx.map((j) => pts[j]);
    tris.push(cross2(a, b, c) > 0 ? [a, b, c] : [c, b, a]);
  }
  return tris;
}

/** The part of convex polygon `poly` left of the line a -> b (right of it when `left` is false) */
function clipHalfPlane(poly, a, b, left) {
  const out = [];
  const f = (p) => cross2(a, b, p) * (left ? 1 : -1);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out;
}

function cleanRing(pts) {
  const res = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (res.length > 0 && Math.hypot(p.x - res[res.length - 1].x, p.z - res[res.length - 1].z) < 0.01) continue;
    res.push(p);
  }
  if (res.length > 2 && Math.hypot(res[res.length - 1].x - res[0].x, res[res.length - 1].z - res[0].z) < 0.01) {
    res.pop();
  }
  return res;
}

/**
 * Merges adjacent and overlapping polygon footprints within a block into disjoint boundary rings.
 * Cancels interior shared segments, keeps buildings separate at pinch points using right-turn angular
 * ordering, and identifies enclosed courtyard rings so three's triangulator encounters no touching
 * holes or collinear split vertices.
 */
function unionPolygons(polys) {
  if (!polys || polys.length === 0) {
    const res = [];
    res.outer = [];
    res.courtyards = [];
    return res;
  }
  if (polys.length === 1) {
    const c = cleanRing(polys[0]);
    const res = [c];
    res.outer = [c];
    res.courtyards = [];
    return res;
  }

  const EPS = 1e-4;
  const CELL = 16;
  const ptKey = (p) => `${Math.round(p.x * 20)},${Math.round(p.z * 20)}`;
  const segments = [];
  const allPts = [];
  const ptMap = new Map();
  const addPt = (p) => {
    const k = ptKey(p);
    if (!ptMap.has(k)) { ptMap.set(k, p); allPts.push(p); }
    return ptMap.get(k);
  };

  const ensureCCW = (pts) => (polygonCentroidArea(pts) > 0 ? pts : pts.slice().reverse());
  for (const poly of polys) {
    const pts = ensureCCW(cleanRing(poly));
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      if (Math.hypot(p2.x - p1.x, p2.z - p1.z) > 0.01) {
        segments.push({ p1: addPt(p1), p2: addPt(p2) });
      }
    }
  }

  const grid = new Map();
  const getCellKey = (gx, gz) => (gx * 100000 + gz);
  segments.forEach((s, idx) => {
    const minX = Math.min(s.p1.x, s.p2.x), maxX = Math.max(s.p1.x, s.p2.x);
    const minZ = Math.min(s.p1.z, s.p2.z), maxZ = Math.max(s.p1.z, s.p2.z);
    const gx0 = Math.floor(minX / CELL), gx1 = Math.floor(maxX / CELL);
    const gz0 = Math.floor(minZ / CELL), gz1 = Math.floor(maxZ / CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const ck = getCellKey(gx, gz);
        let list = grid.get(ck);
        if (!list) { list = []; grid.set(ck, list); }
        list.push(idx);
      }
    }
  });

  const checkedPairs = new Set();
  for (const list of grid.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      const idx1 = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const idx2 = list[j];
        const pk = idx1 < idx2 ? `${idx1},${idx2}` : `${idx2},${idx1}`;
        if (checkedPairs.has(pk)) continue;
        checkedPairs.add(pk);
        const pt = lineIntersection(segments[idx1].p1, segments[idx1].p2, segments[idx2].p1, segments[idx2].p2);
        if (pt) {
          const s1 = segments[idx1], s2 = segments[idx2];
          const dot1 = (pt.x - s1.p1.x) * (s1.p2.x - s1.p1.x) + (pt.z - s1.p1.z) * (s1.p2.z - s1.p1.z);
          const len1 = Math.hypot(s1.p2.x - s1.p1.x, s1.p2.z - s1.p1.z);
          const dot2 = (pt.x - s2.p1.x) * (s2.p2.x - s2.p1.x) + (pt.z - s2.p1.z) * (s2.p2.z - s2.p1.z);
          const len2 = Math.hypot(s2.p2.x - s2.p1.x, s2.p2.z - s2.p1.z);
          if (dot1 > 0.01 && dot1 < len1 * len1 - 0.01 && dot2 > 0.01 && dot2 < len2 * len2 - 0.01) {
            addPt(pt);
          }
        }
      }
    }
  }

  const ptGrid = new Map();
  allPts.forEach((p) => {
    const gx = Math.floor(p.x / CELL), gz = Math.floor(p.z / CELL);
    const ck = getCellKey(gx, gz);
    let list = ptGrid.get(ck);
    if (!list) { list = []; ptGrid.set(ck, list); }
    list.push(p);
  });

  const newSegments = [];
  for (const s of segments) {
    const { p1, p2 } = s;
    const dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    if (len < EPS) continue;
    const ux = dx / len, uz = dz / len;
    const cuts = [0, len];
    const minX = Math.min(p1.x, p2.x) - EPS, maxX = Math.max(p1.x, p2.x) + EPS;
    const minZ = Math.min(p1.z, p2.z) - EPS, maxZ = Math.max(p1.z, p2.z) + EPS;
    const gx0 = Math.floor(minX / CELL), gx1 = Math.floor(maxX / CELL);
    const gz0 = Math.floor(minZ / CELL), gz1 = Math.floor(maxZ / CELL);
    const seenPts = new Set();
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const list = ptGrid.get(getCellKey(gx, gz));
        if (!list) continue;
        for (const p of list) {
          if (seenPts.has(p)) continue;
          seenPts.add(p);
          const cross = Math.abs((p.x - p1.x) * uz - (p.z - p1.z) * ux);
          if (cross < 0.01) {
            const dot = (p.x - p1.x) * ux + (p.z - p1.z) * uz;
            if (dot > 0.01 && dot < len - 0.01) cuts.push(dot);
          }
        }
      }
    }
    cuts.sort((a, b) => a - b);
    const uniq = [];
    for (const c of cuts) if (uniq.length === 0 || c - uniq[uniq.length - 1] > 0.01) uniq.push(c);
    for (let i = 0; i < uniq.length - 1; i++) {
      newSegments.push({
        p1: { x: p1.x + ux * uniq[i], z: p1.z + uz * uniq[i] },
        p2: { x: p1.x + ux * uniq[i + 1], z: p1.z + uz * uniq[i + 1] }
      });
    }
  }

  const segMap = new Map();
  for (const s of newSegments) {
    const kForward = `${ptKey(s.p1)}->${ptKey(s.p2)}`;
    const kReverse = `${ptKey(s.p2)}->${ptKey(s.p1)}`;
    if (segMap.has(kReverse) && segMap.get(kReverse) > 0) {
      segMap.set(kReverse, segMap.get(kReverse) - 1);
    } else {
      segMap.set(kForward, (segMap.get(kForward) || 0) + 1);
    }
  }

  const adj = new Map();
  for (const s of newSegments) {
    const kForward = `${ptKey(s.p1)}->${ptKey(s.p2)}`;
    if (segMap.get(kForward) > 0) {
      segMap.set(kForward, segMap.get(kForward) - 1);
      const k1 = ptKey(s.p1);
      let list = adj.get(k1);
      if (!list) { list = []; adj.set(k1, list); }
      list.push(s.p2);
    }
  }

  const rawRings = [];
  for (const [startK, targets] of adj.entries()) {
    while (targets.length > 0) {
      const startPt = ptMap.get(startK);
      if (!startPt) { targets.pop(); continue; }
      const ring = [startPt];
      let prevPt = startPt;
      let currPt = targets.pop();
      let safety = 2000;
      while (safety-- > 0) {
        ring.push(currPt);
        const currK = ptKey(currPt);
        if (currK === startK) { ring.pop(); break; }
        const nextTargets = adj.get(currK);
        if (!nextTargets || nextTargets.length === 0) break;
        const inAngle = Math.atan2(currPt.z - prevPt.z, currPt.x - prevPt.x);
        let bestIdx = 0;
        let bestTurn = Infinity;
        for (let ti = 0; ti < nextTargets.length; ti++) {
          const cand = nextTargets[ti];
          const outAngle = Math.atan2(cand.z - currPt.z, cand.x - currPt.x);
          let turn = (outAngle - inAngle + Math.PI * 2) % (Math.PI * 2);
          if (turn < bestTurn) { bestTurn = turn; bestIdx = ti; }
        }
        prevPt = currPt;
        currPt = nextTargets.splice(bestIdx, 1)[0];
      }
      const cRing = cleanRing(ring);
      if (cRing.length >= 3 && Math.abs(polygonCentroidArea(cRing)) > 0.05) {
        rawRings.push(cRing);
      }
    }
  }

  const outer = [];
  const courtyards = [];
  for (let i = 0; i < rawRings.length; i++) {
    const r = rawRings[i];
    const depth = rawRings.filter((o, j) => i !== j && r.every((p) => polygonIn(o, p.x, p.z))).length;
    const isCourtyard = depth % 2 === 1 && polygonCentroidArea(r) < 0;
    if (isCourtyard) {
      courtyards.push(ensureCCW(r));
    } else {
      outer.push(ensureCCW(r));
    }
  }

  const res = outer;
  res.outer = outer;
  res.courtyards = courtyards;
  return res;
}

/**
 * A slab outline with the track corridors cut out, as convex pieces: the ring is ear-clipped, then every piece loses
 * each corridor quad (a track segment widened by `half` either side and lengthened by `half` at both ends, so the
 * corridor stays closed round bends). Subtracting a convex quad from a convex piece leaves at most four convex pieces,
 * one per quad edge, so every step is plain half-plane clipping. Slivers under 0.02 m² are dropped.
 */
function cutSlab(ring, segs, half, holes = []) {
  let pieces = triangulateRing(ring);
  // Subtract building holes as triangles before cutting corridors; all pieces remain convex.
  for (const hole of holes) {
    for (const triangle of triangulateRing(hole)) {
      const next = [];
      const minX = Math.min(...triangle.map((p) => p.x)), maxX = Math.max(...triangle.map((p) => p.x));
      const minZ = Math.min(...triangle.map((p) => p.z)), maxZ = Math.max(...triangle.map((p) => p.z));
      for (const piece of pieces) {
        if (piece.every((p) => p.x <= minX) || piece.every((p) => p.x >= maxX) ||
            piece.every((p) => p.z <= minZ) || piece.every((p) => p.z >= maxZ)) {
          next.push(piece);
          continue;
        }
        let overlap = piece;
        for (let i = 0; i < 3 && overlap.length >= 3; i++) {
          overlap = clipHalfPlane(overlap, triangle[i], triangle[(i + 1) % 3], true);
        }
        if (overlap.length < 3 || polygonCentroidArea(overlap) < 1e-8) {
          next.push(piece);
          continue;
        }
        let rest = piece;
        for (let i = 0; i < 3 && rest.length >= 3; i++) {
          const outside = clipHalfPlane(rest, triangle[i], triangle[(i + 1) % 3], false);
          if (outside.length >= 3 && polygonCentroidArea(outside) > 0.01) next.push(outside);
          rest = clipHalfPlane(rest, triangle[i], triangle[(i + 1) % 3], true);
        }
      }
      pieces = next;
    }
  }
  const area = (p) => polygonCentroidArea(p);
  for (const [ax, az, bx, bz, segmentHalf = half] of segs) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = ((bx - ax) / len) * segmentHalf, uz = ((bz - az) / len) * segmentHalf;
    // left-turning: along u, then across to the left (-uz, ux) side
    const quad = [
      { x: ax - ux + uz, z: az - uz - ux }, { x: bx + ux + uz, z: bz + uz - ux },
      { x: bx + ux - uz, z: bz + uz + ux }, { x: ax - ux - uz, z: az - uz + ux }
    ];
    if (cross2(quad[0], quad[1], quad[2]) < 0) quad.reverse();
    let qx0 = Infinity, qx1 = -Infinity, qz0 = Infinity, qz1 = -Infinity;
    for (const q of quad) { qx0 = Math.min(qx0, q.x); qx1 = Math.max(qx1, q.x); qz0 = Math.min(qz0, q.z); qz1 = Math.max(qz1, q.z); }
    const next = [];
    for (const piece of pieces) {
      if (piece.every((p) => p.x < qx0) || piece.every((p) => p.x > qx1) || piece.every((p) => p.z < qz0) ||
        piece.every((p) => p.z > qz1)) {
        next.push(piece);
        continue;
      }
      let rest = piece;
      for (let i = 0; i < 4 && rest.length >= 3; i++) {
        const outside = clipHalfPlane(rest, quad[i], quad[(i + 1) % 4], false);
        if (outside.length >= 3 && area(outside) > 0.01) next.push(outside);
        rest = clipHalfPlane(rest, quad[i], quad[(i + 1) % 4], true);
      }
    }
    pieces = next;
  }
  return pieces;
}

// Both rings must be simple. Triangulating them first lets convex half-plane clipping retain disconnected
// intersections as separate pieces, rather than folding a projected boundary across itself.
function intersectSimpleRings(ring, boundary, border = boundaryTriangles(boundary)) {
  const inside = triangulateRing(polygonCentroidArea(ring) > 0 ? ring : ring.slice().reverse());
  const pieces = [];
  for (const a of inside) {
    const ax0 = Math.min(a[0].x, a[1].x, a[2].x), ax1 = Math.max(a[0].x, a[1].x, a[2].x);
    const az0 = Math.min(a[0].z, a[1].z, a[2].z), az1 = Math.max(a[0].z, a[1].z, a[2].z);
    for (let k = 0; k < border.length; k++) {
      const b = border[k], bb = border.boxes[k];
      if (bb[1] < ax0 || bb[0] > ax1 || bb[3] < az0 || bb[2] > az1) continue;
      let p = a;
      for (let i = 0; i < 3 && p.length >= 3; i++) p = clipHalfPlane(p, b[i], b[(i + 1) % 3], true);
      if (p.length >= 3 && polygonCentroidArea(p) > 1e-6) pieces.push(p);
    }
  }
  return pieces;
}

// The boundary side of intersectSimpleRings, triangulated once with per-triangle bounds so a park outline clipped
// against hundreds of footprint holes is not re-triangulated for each
function boundaryTriangles(boundary) {
  const tris = triangulateRing(polygonCentroidArea(boundary) > 0 ? boundary : boundary.slice().reverse());
  tris.boxes = tris.map((t) => [Math.min(t[0].x, t[1].x, t[2].x), Math.max(t[0].x, t[1].x, t[2].x),
    Math.min(t[0].z, t[1].z, t[2].z), Math.max(t[0].z, t[1].z, t[2].z)]);
  return tris;
}

// The narrow park island at Armii Poznań folds across itself with the normal 5 m inset. Its smaller inset stays
// simple; use the same corridors as the island's raised-ground query.
function armiiParkRoadCuts(b) {
  if (b.minX !== -1003.5 || b.maxX !== -727.5 || b.minZ !== -2060 || b.maxZ !== -1224) return null;
  return b.roadCut;
}

// These partial-park rings overlap mapped service roads. Identify the affected rings and road chains by
// coordinates so unrelated service roads and neighbouring park polygons keep their existing appearance.
function partialParkServiceCuts(b, ring) {
  const sites = [
    [433, 888.5, 483, -1933.7, [[549.6, -1982.5]]],
    [-1719, -1003, -1124.5, -1480.2, [[-1133.9, -1459.1]]],
    [512, 1410, 907.3, -785.5, [[1061.9, -708.8], [1028.2, -700]]],
    [2816.5, 4490, 3920.8, -335.3, [[4093.2, -224.1], [4100, -234.9], [4122.9, -277.5], [4110.1, -224.8], [3887, -241.6]]],
    [322, 822, 739.2, 220, [[700, 220.7]]],
    [1360, 3315.5, 2632.1, 1439.4, [[2491, 1765.7]]]
  ];
  const site = sites.find(([minX, maxX, x, z]) => b.minX === minX && b.maxX === maxX && ring[0].x === x && ring[0].z === z);
  if (!site) return [];
  const segs = [];
  for (const road of GEO.roads) {
    const p = road[5];
    if (road[0] || !site[4].some(([x, z]) => p[0] === x && p[1] === z)) continue;
    for (let i = 0; i + 3 < p.length; i += 2) segs.push([p[i], p[i + 1], p[i + 2], p[i + 3], road[1] * 0.5]);
  }
  return segs;
}

/**
 * The squares worth paving: PLAZAS with the duplicate rings dropped (OSM often maps a square both as a named place and
 * as the pedestrian area around its buildings: the copy with the building holes wins and takes the name), minus the
 * place outlines that take in real streets (more than 30 m of ROADS centreline inside them, e.g. Rynek Wschodni or Plac
 * Andersa), which a paving slab at curb height would bury. Tram track is not a street here: a square with tram track
 * inside (Plac Cyryla Ratajskiego 146 m, Plac Wielkopolski 366 m) keeps its paving with the track cut out of it, and
 * carries the tram segments near it as `tramSegs` ([ax, az, bx, bz]; null on the others).
 */
function pavedPlazas() {
  const key = (p) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const q of p.ring) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
    }
    return { minX, maxX, minZ, maxZ, area: Math.abs(polygonCentroidArea(p.ring)) };
  };
  const list = [];
  for (const p of PLAZAS) {
    if (p.ring.length < 3) continue;
    const k = key(p);
    if (k.area < 40) continue;
    const dup = list.find((q) => Math.abs(q.area - k.area) < 0.5 + k.area * 0.002 && Math.abs(q.minX - k.minX) < 1 &&
      Math.abs(q.maxZ - k.maxZ) < 1 && Math.abs(q.maxX - k.maxX) < 1 && Math.abs(q.minZ - k.minZ) < 1);
    if (dup) {
      if (p.holes.length > dup.holes.length) { dup.ring = p.ring; dup.holes = p.holes; }
      if (!dup.name) dup.name = p.name;
      continue;
    }
    list.push({ name: p.name, ring: p.ring, holes: p.holes, ...k });
  }
  const STEP = 2;
  // A 32 m bucket index over polyline segments, so a square only samples the segments near its box: the full scan was
  // 22,590 road segments per square (lengthInside 134 ms of the 2026-11-11 headless city-grid build). The bucket list is
  // emission-ordered, and the ids are sorted back into source order, so p.roadSegs keeps the old order.
  const SEG_CELL = 32;
  function segmentBuckets(segments) {
    const grid = new Map();
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const ix0 = Math.floor(Math.min(s[0], s[2]) / SEG_CELL), ix1 = Math.floor(Math.max(s[0], s[2]) / SEG_CELL);
      const iz0 = Math.floor(Math.min(s[1], s[3]) / SEG_CELL), iz1 = Math.floor(Math.max(s[1], s[3]) / SEG_CELL);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = ix * 100000 + iz;
          const list = grid.get(k);
          if (list) list.push(i); else grid.set(k, [i]);
        }
      }
    }
    const marks = new Uint32Array(segments.length);
    let stamp = 0;
    return (minX, maxX, minZ, maxZ) => {
      const mark = ++stamp;
      const out = [];
      const ix0 = Math.floor(minX / SEG_CELL), ix1 = Math.floor(maxX / SEG_CELL);
      const iz0 = Math.floor(minZ / SEG_CELL), iz1 = Math.floor(maxZ / SEG_CELL);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          for (const i of grid.get(ix * 100000 + iz) || []) {
            if (marks[i] === mark) continue;
            marks[i] = mark;
            out.push(i);
          }
        }
      }
      out.sort((a, b) => a - b);
      return out;
    };
  }
  const roadSegs = [];
  for (const r of ROADS) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      roadSegs.push([a.x, a.z, b.x, b.z]);
    }
  }
  const nearRoadSegments = segmentBuckets(roadSegs);
  // centreline length of the segments a -> b inside the square (not in a building on it)
  const lengthInsideXY = (p, ax, az, bx, bz) => {
    if (Math.max(ax, bx) < p.minX || Math.min(ax, bx) > p.maxX || Math.max(az, bz) < p.minZ || Math.min(az, bz) > p.maxZ) return 0;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / STEP));
    let inside = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (polygonIn(p.ring, x, z) && !p.holes.some((h) => polygonIn(h, x, z))) inside += len / n;
    }
    return inside;
  };
  const lengthInside = (p, a, b) => lengthInsideXY(p, a.x, a.z, b.x, b.z);
  const kept = list.filter((p) => {
    let inside = 0;
    for (const i of nearRoadSegments(p.minX, p.maxX, p.minZ, p.maxZ)) {
      const s = roadSegs[i];
      inside += lengthInsideXY(p, s[0], s[1], s[2], s[3]);
    }
    return inside <= 30;
  });
  const roadSegments = [];
  const graph = GEO.roadGraph;
  for (const [a, b, , w, , , inner] of graph.links) {
    let x = graph.nodes[a * 2], z = graph.nodes[a * 2 + 1];
    for (let i = 0; i <= inner.length; i += 2) {
      const nx = i < inner.length ? inner[i] : graph.nodes[b * 2];
      const nz = i < inner.length ? inner[i + 1] : graph.nodes[b * 2 + 1];
      roadSegments.push([x, z, nx, nz, w / 2]);
      x = nx; z = nz;
    }
  }
  // Intersect the centreline with every ring edge, then sample each interval. This catches short crossings which
  // the 2 m plaza-deduplication sampling above can miss, while excluding segments entirely inside a building hole.
  function crossesPlaza(p, [ax, az, bx, bz]) {
    if (Math.max(ax, bx) < p.minX || Math.min(ax, bx) > p.maxX ||
      Math.max(az, bz) < p.minZ || Math.min(az, bz) > p.maxZ) return false;
    const dx = bx - ax, dz = bz - az, cuts = [0, 1];
    for (const ring of [p.ring, ...p.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const ex = b.x - a.x, ez = b.z - a.z, den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a.x - ax) * ez - (a.z - az) * ex) / den;
        const u = ((a.x - ax) * dz - (a.z - az) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < 1e-8) continue;
      const t = (cuts[i] + cuts[i - 1]) * 0.5, x = ax + dx * t, z = az + dz * t;
      if (polygonIn(p.ring, x, z) && !p.holes.some((h) => polygonIn(h, x, z))) return true;
    }
    return false;
  }
  const nearGraphSegments = segmentBuckets(roadSegments);
  for (const p of kept) {
    p.roadSegs = nearGraphSegments(p.minX, p.maxX, p.minZ, p.maxZ)
      .map((i) => roadSegments[i])
      .filter((s) => crossesPlaza(p, s));
    let inside = 0;
    const segs = [];
    const m = TRAM_CUT * 2;
    for (const r of GEO.rail || []) {
      if (r.kind !== 'tram') continue;
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const a = { x: r.pts[i], z: r.pts[i + 1] }, b = { x: r.pts[i + 2], z: r.pts[i + 3] };
        if (Math.max(a.x, b.x) < p.minX - m || Math.min(a.x, b.x) > p.maxX + m || Math.max(a.z, b.z) < p.minZ - m ||
          Math.min(a.z, b.z) > p.maxZ + m) continue;
        segs.push([a.x, a.z, b.x, b.z]);
        inside += lengthInside(p, a, b);
      }
    }
    p.tramSegs = inside > 0 ? segs : null;
  }
  return kept;
}

function buildCityGrid(scene, opts = {}) {
  const { buildingFootprints = null, buildingColliders = [] } = opts;
  const group = new THREE.Group();
  group.name = 'CityGrid';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const B = CITY_BOUNDS;

  // Medians block cars but provide pedestrian refuges; park footprints also block walking routes.
  const footprints = [];
  const addFootprint = (x, z, w, d, walkable = false) => footprints.push({
    minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, walkable
  });

  // =========================================================================
  // 1. WATER: one plane at the river level under the whole detail box and far beyond it (the Warta, its old bed, the
  //    Cybina, Malta and the ponds all show through the holes in the land deck)
  // =========================================================================
  const waterMat = createWaterMaterial();
  const waterGeo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set((B.minX + B.maxX) * 0.5, B.waterLevel, (B.minZ + B.maxZ) * 0.5);
  group.add(waterMesh);

  // =========================================================================
  // 2. LAND DECK (y = 0, the roadway asphalt) from each land component, with the ponds it encloses cut out, and the
  //    stone embankments from its edge down below the water
  // =========================================================================
  const roadMat = createRoadSurfaceMaterial();
  LAND_RINGS.forEach((ring, i) => {
    const holes = LAND_HOLES.filter((h) => h.outer === i).map((h) => h.ring);
    group.add(createFlatPolygonMesh(ring, 0.0, roadMat, true, holes));
  });

  // Embankments: a battered stone revetment from the deck edge (y = 0) out 2 m and down to 1.2 m below the water, along
  // every shore edge of the land rings (edges along the detail box's border meet the outskirts, not water) and round
  // every pond. One quad per edge, the bottom corners shared between neighbouring edges so the wall has no gaps.
  const bankMat = new THREE.MeshStandardNodeMaterial({ color: 0x6a665e, roughness: 0.86, metalness: 0.05 });
  const BANK_OUT = 2.0;
  const BANK_Y = B.waterLevel - 1.2;
  const bank = { pos: [], nor: [], uv: [] };
  const _e1 = new THREE.Vector3();
  const _e2 = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _hint = new THREE.Vector3();
  // Quad a-b-c-d (either winding) turned to face `hint`; uv.x runs u0..u1 along a->b, uv.y 0..1 from a-b to d-c
  function quad(A, a, b, c, d, hint, u0 = 0, u1 = 1) {
    _n.crossVectors(_e1.subVectors(b, a), _e2.subVectors(c, a)).normalize();
    let pts = [[a, u0, 0], [b, u1, 0], [c, u1, 1], [d, u0, 1]];
    if (_n.dot(hint) < 0) {
      pts = [pts[0], pts[3], pts[2], pts[1]];
      _n.negate();
    }
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [p, u, v] = pts[k];
      A.pos.push(p.x, p.y, p.z);
      A.nor.push(_n.x, _n.y, _n.z);
      A.uv.push(u, v);
    }
  }
  const onBox = (p, q) => {
    const E = 0.5;
    return (Math.abs(p.x - B.minX) < E && Math.abs(q.x - B.minX) < E) || (Math.abs(p.x - B.maxX) < E && Math.abs(q.x - B.maxX) < E) ||
      (Math.abs(p.z - B.minZ) < E && Math.abs(q.z - B.minZ) < E) || (Math.abs(p.z - B.maxZ) < E && Math.abs(q.z - B.maxZ) < E);
  };
  // waterInside: the water lies inside the ring (a pond) rather than outside it (a land component)
  function addBank(ring, waterInside) {
    const n = ring.length;
    if (n < 3) return;
    const s = polygonCentroidArea(ring) > 0 ? 1 : -1; // inward normal of edge (dx, dz) is s * (-dz, dx)
    const w = waterInside ? s : -s;
    const edgeN = [];
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      const l = Math.hypot(q.x - p.x, q.z - p.z) || 1e-9;
      edgeN.push({ x: (-w * (q.z - p.z)) / l, z: (w * (q.x - p.x)) / l, l });
    }
    const bottom = ring.map((p, i) => {
      const a = edgeN[(i + n - 1) % n], b = edgeN[i];
      let mx = a.x + b.x, mz = a.z + b.z;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) { mx = b.x; mz = b.z; } else { mx /= ml; mz /= ml; }
      return new THREE.Vector3(p.x + mx * BANK_OUT, BANK_Y, p.z + mz * BANK_OUT);
    });
    let u = 0;
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      const e = edgeN[i];
      if (!waterInside && onBox(p, q)) { u += e.l; continue; }
      _hint.set(e.x, 0.5, e.z);
      quad(bank, new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(q.x, 0, q.z), bottom[(i + 1) % n], bottom[i], _hint, u, u + e.l);
      u += e.l;
    }
  }
  for (const ring of LAND_RINGS) addBank(ring, false);
  for (const h of LAND_HOLES) addBank(h.ring, true);
  if (bank.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bank.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bank.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bank.uv, 2));
    const bankMesh = new THREE.Mesh(g, bankMat);
    bankMesh.receiveShadow = true;
    group.add(bankMesh);
  }

  // =========================================================================
  // 3. PARK LAWN MATERIAL
  // =========================================================================
  const lawnMat = createParkLawnMaterial(false);

  // Ponds lying wholly inside a curb island (Park Sołacki's, the Cytadela's...): cut out of its slabs
  const pondsIn = (poly) => LAND_HOLES.map((h) => h.ring).filter((h) => ringInside(poly, h));

  // =========================================================================
  // 4. RAISED SIDEWALKS & GRANITE CURBSTONES: every curb island (city-config.js BLOCKS, from the street centrelines at
  //    their curb-to-curb widths). Rectangular islands are instanced slabs; the rest are extruded from their outlines
  // =========================================================================
  const sidewalkMat = createSidewalkMaterial();
  const curbMat = createCurbMaterial();
  const medianHedgeMat = new THREE.MeshStandardNodeMaterial({ color: 0x366e3b, roughness: 0.82 });
  const blockSidewalks = []; // { cx, cz, w, d, block } axis-aligned slabs (irregular islands: their lot cover)
  const roadSidewalks = []; // the curbs road-network.js bounds the roads with (medians go in as footprints)
  const slabGeos = [];
  const curbGeos = [];
  const hedgeGeos = [];
  const SW_TOP = 0.22;
  const isParkBlock = (b) => b.park > 0.6 && !b.median && b.area > 250;
  for (const b of BLOCKS) {
    if (isParkBlock(b)) continue; // park blocks build their own paved perimeter (section 6)
    if (b.rect) {
      const slab = { cx: (b.minX + b.maxX) * 0.5, cz: (b.minZ + b.maxZ) * 0.5, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b };
      blockSidewalks.push(slab);
      if (b.median) addFootprint(slab.cx, slab.cz, slab.w, slab.d, true);
      else roadSidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    } else {
      // curb (granite) ring under a sidewalk slab inset by 0.25 m, like the instanced pair below
      const ponds = pondsIn(b.poly);
      const curbs = b.tramCut ? cutSlab(b.poly, b.tramCut.segs, b.tramCut.half) : [b.poly];
      for (const piece of curbs) {
        curbGeos.push(createExtrudedPolygonMesh(piece, 0.0, 0.18, curbMat, true, false, ponds).geometry);
      }
      const inner = offsetPolygonInward(b.poly, 0.25);
      if (inner) {
        // Keep the 0.25 m granite rim along the newly cut track corridor too.
        const tops = b.tramCut ? cutSlab(inner, b.tramCut.segs, b.tramCut.half + 0.25) : [inner];
        for (const piece of tops) {
          slabGeos.push(createExtrudedPolygonMesh(piece, 0.03, SW_TOP - 0.03, sidewalkMat, true, false,
            ponds.filter((h) => ringInside(piece, h))).geometry);
        }
      }
      // rect cover for the consumers that work on rectangles: the lot rects grown back out to the curb. The road
      // network gets the lot rects as they are: on a turned block a rect grown 4.4 m along the world axes reaches into
      // the roadway, and the largest strongly connected set fell from ~3150 to ~1660 edges with them
      for (const [x0, x1, z0, z1] of b.rects) {
        const r = { minX: x0 - 4.4, maxX: x1 + 4.4, minZ: z0 - 4.4, maxZ: z1 + 4.4 };
        blockSidewalks.push({ cx: (r.minX + r.maxX) * 0.5, cz: (r.minZ + r.maxZ) * 0.5, w: r.maxX - r.minX, d: r.maxZ - r.minZ, block: b, cover: true });
        if (!b.median) roadSidewalks.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
      }
      if (b.median) addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ, true);
    }
    // Planted malls down the middle of the wide streets: a clipped hedge on the slab
    if (b.median && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) > 2.2) {
      const hedge = offsetPolygonInward(b.poly, 1.0);
      if (hedge) {
        const walks = MEDIAN_REFUGE_CORRIDORS.filter(([ax, az, bx, bz]) =>
          pointInPolygonXZ(b.poly, ax, az) && pointInPolygonXZ(b.poly, bx, bz));
        let pieces = walks.length ? cutSlab(hedge, walks, 1.5) : [hedge];
        if (b.tramCut) pieces = pieces.flatMap((p) => cutSlab(p, b.tramCut.segs, b.tramCut.half));
        for (const piece of pieces) {
          hedgeGeos.push(createExtrudedPolygonMesh(piece, SW_TOP, 0.55, medianHedgeMat).geometry);
        }
      }
    }
  }

  // Extrude sidewalk strips under railway viaducts to bridge curb islands across the railway land
  for (const s of UNDERPASS_SIDEWALKS || []) {
    curbGeos.push(createExtrudedPolygonMesh(s.poly, 0.0, 0.18, curbMat, true, false).geometry);
    const inner = offsetPolygonInward(s.poly, 0.25);
    if (inner) {
      slabGeos.push(createExtrudedPolygonMesh(inner, 0.03, SW_TOP - 0.03, sidewalkMat, true, false).geometry);
    }
    roadSidewalks.push({ minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ });
  }

  const mergeInto = (geos, mat, cast = false) => {
    for (let i = 0; i < geos.length; i += 400) {
      const m = new THREE.Mesh(mergeGeometries(geos.slice(i, i + 400), false), mat);
      m.receiveShadow = true;
      m.castShadow = cast;
      group.add(m);
    }
  };
  mergeInto(curbGeos, curbMat, true);
  mergeInto(slabGeos, sidewalkMat);
  mergeInto(hedgeGeos, medianHedgeMat, true);

  const rectSlabs = blockSidewalks.filter((s) => !s.cover);
  if (rectSlabs.length) {
    const swInstanced = new THREE.InstancedMesh(unitBox, sidewalkMat, rectSlabs.length);
    const curbInstanced = new THREE.InstancedMesh(unitBox, curbMat, rectSlabs.length);
    swInstanced.receiveShadow = true;
    curbInstanced.receiveShadow = true;
    curbInstanced.castShadow = true;

    rectSlabs.forEach((blk, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(blk.cx, 0.125, blk.cz);
      dummy.scale.set(blk.w - 0.5, 0.19, blk.d - 0.5);
      dummy.updateMatrix();
      swInstanced.setMatrixAt(i, dummy.matrix);

      dummy.position.set(blk.cx, 0.095, blk.cz);
      dummy.scale.set(blk.w, 0.17, blk.d);
      dummy.updateMatrix();
      curbInstanced.setMatrixAt(i, dummy.matrix);
    });
    swInstanced.instanceMatrix.needsUpdate = true;
    curbInstanced.instanceMatrix.needsUpdate = true;
    group.add(swInstanced, curbInstanced);
  }

  // =========================================================================
  // 5. SQUARES (city-config.js PLAZAS): granite pavers a little above the sidewalks with the buildings standing on them
  //    (Stary Rynek's central block, Plac Wolności's...) cut out, lampposts & benches round the edges and planted trees
  //    in granite planters on the big ones; plus the shared street-furniture instancing of the squares & parks
  //    (instanced at the end of section 6)
  // =========================================================================
  const pavingMat = createParkPavingMaterial();
  const graniteMat = new THREE.MeshStandardNodeMaterial({ color: 0x86837c, roughness: 0.8 }); // benches, planters, copings
  const benchMatrices = []; // slatted park benches
  const lampMatrices = []; // cast-iron lampposts with glass globes
  const treeSites = []; // { x, y, z, scale, species } park & plaza trees planted by street-details.js (section 7)
  const PLAZA_Y = 0.24;
  const pavedRects = []; // plaza & park slab bounds, exported so street trees (street-details.js) stay off them
  // Player colliders for the square & park furniture (controllers.js: static boxes in its 48 m cells; benches turned off
  // the grid are oriented boxes). main.js adds them only after the road network is built, so the lanes and sidewalk
  // tracks are unchanged (the park blocks are whole footprints already), and they are not walls for street-details.js
  // to hang name plates on.
  const propColliders = [];
  let activePlaza = null;
  function addPropCollider(x, z, hx, hz, maxY, rotY = 0) {
    if (!rotY) {
      const c = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, maxY };
      propColliders.push(c);
      if (activePlaza) activePlaza.props.push(c);
      return c;
    }
    // local x maps to world (cos, -sin) under a three.js y rotation, local z to (sin, cos): the controllers' obb frame
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    const c = { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY, obb: { cx: x, cz: z, hx, hz, cs, sn } };
    propColliders.push(c);
    if (activePlaza) activePlaza.props.push(c);
    return c;
  }
  const prand = (x, z, k = 0) => {
    const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };

  const roadCutPlazas = [];
  const cutPlazas = []; // { name, curb, top }: the convex slab pieces of the squares paved round tram track
  function addPavedPlaza(pts, style, topY = PLAZA_Y, holes = [], tramSegs = null, name = '', roads = []) {
    pavedRects.push(...coverRects(pts));
    const inner = offsetPolygonInward(pts, 0.3) || pts;
    if (tramSegs || roads.length) {
      // the curb-stone rim runs along the cut edges too: the paving keeps 0.3 m back from them as from the outline
      const segments = [...(tramSegs || []).map((s) => [...s, TRAM_CUT]), ...roads];
      const curb = cutSlab(pts, segments, 0, holes);
      const topSegs = segments.map(([ax, az, bx, bz, half]) => [ax, az, bx, bz, half + 0.3]);
      const top = cutSlab(inner, topSegs, 0, holes.filter((h) => ringInside(inner, h)));
      for (const piece of curb) group.add(createExtrudedPolygonMesh(piece, 0.0, topY - 0.04, curbMat));
      for (const piece of top) {
        const mesh = createExtrudedPolygonMesh(piece, 0.0, topY, pavingMat);
        setPavingStyle(mesh.geometry, style);
        group.add(mesh);
      }
      if (tramSegs) cutPlazas.push({ name, curb, top });
      if (roads.length) {
        const result = { name, ring: pts, curb, top, roads, props: [] };
        roadCutPlazas.push(result);
        return result;
      }
      return null;
    }
    group.add(createExtrudedPolygonMesh(pts, 0.0, topY - 0.04, curbMat, true, false, holes));
    const top = createExtrudedPolygonMesh(inner, 0.0, topY, pavingMat, true, false, holes.filter((h) => ringInside(inner, h)));
    setPavingStyle(top.geometry, style);
    group.add(top);
  }
  function addBox(mat, x, y, z, w, h, d, rotY = 0, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h * 0.5, z);
    m.rotation.y = rotY;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function addPlanter(x, z, w, d, baseY = PLAZA_Y) {
    addBox(graniteMat, x, baseY, z, w, 0.55, d);
    addBox(medianHedgeMat, x, baseY + 0.55, z, w - 0.35, 0.3, d - 0.35, 0, false);
    addPropCollider(x, z, w * 0.5, d * 0.5, baseY + 0.85); // granite box and its clipped hedge
  }
  // Each add* below returns false (and places nothing) where the prop would stand within RAIL_PROP_KEEP of a track
  let offTrack = 0;
  const railClear = (x, z, radius) => clearOfRails(x, z, radius) || (offTrack++, false);
  const { isClearOfWalls } = createTreeWallChecker(buildingColliders, SPECIES_CROWN_R);

  function addPlanterTree(x, z, species = 1, scale = 0.85) {
    if (!railClear(x, z, 1.7)) return false; // the 2.4 m planter's corner
    if (!isClearOfWalls(x, z, scale, species, 1.0, PLAZA_Y + 0.55, 1)) return false;
    addPlanter(x, z, 2.4, 2.4);
    treeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species, planter: true }); // street-details.js keeps it over OSM
    return true;
  }
  function addBench(x, y, z, rotY) {
    if (!railClear(x, z, 1.0)) return false;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    benchMatrices.push(dummy.matrix.clone());
    addPropCollider(x, z, 0.95, 0.27, y + 0.92, rotY); // 1.9 m of slats, the back's top at 0.91 m
    return true;
  }
  function addLamp(x, y, z) {
    if (!railClear(x, z, 0.3)) return false;
    lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y, z));
    addPropCollider(x, z, 0.2, 0.2, y + 4.45); // the 0.4 m cast base up to the globe
    return true;
  }

  for (const pl of pavedPlazas()) {
    activePlaza = null;
    const holes = pl.holes.filter((h) => h.length >= 3 && ringInside(pl.ring, h));
    // The Ogrody tram-loop area has both track and buildings and was not paved before the road cuts.
    if (pl.tramSegs && holes.length && !pl.roadSegs.length) continue;
    activePlaza = addPavedPlaza(pl.ring, 1, PLAZA_Y, holes, pl.tramSegs, pl.name || '', pl.roadSegs);
    const clearRoad = (x, z, radius) => pl.roadSegs.every(([ax, az, bx, bz, half]) => {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (!len) return true;
      const ux = dx / len, uz = dz / len;
      const along = (x - ax) * ux + (z - az) * uz;
      const across = Math.abs((x - ax) * uz - (z - az) * ux);
      const da = Math.max(-half - along, along - len - half, 0);
      const dc = Math.max(across - half, 0);
      return Math.hypot(da, dc) >= radius + 0.1;
    });
    // furniture keeps 2 m in from the plaza's edge and 2.5 m off the buildings on it
    const edge = offsetPolygonInward(pl.ring, 2.0);
    if (!edge) continue;
    const grownHoles = holes.map((h) => offsetPolygon(h, -2.5) || h);
    const clear = (x, z) => !grownHoles.some((h) => polygonIn(h, x, z));
    // lampposts every ~30 m round the edge, a bench facing in beside every other one
    const s = polygonCentroidArea(edge) > 0 ? 1 : -1;
    let k = 0;
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i], c = edge[(i + 1) % edge.length];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      if (len < 12) continue;
      const nx = (-s * (c.z - a.z)) / len, nz = (s * (c.x - a.x)) / len; // inward
      const tx = (c.x - a.x) / len, tz = (c.z - a.z) / len;
      for (let t = 6 + ((len - 12) % 30) * 0.5; t < len - 5; t += 30, k++) {
        let px = a.x + tx * t, pz = a.z + tz * t;
        if (!clear(px, pz) || !polygonIn(pl.ring, px, pz)) continue;
        // ensure clearance >= 0.5 m (pole radius 0.2 m -> distance to pl.ring >= 0.70 m)
        let minD = 1e9, closeEdge = -1;
        for (let ri = 0; ri < pl.ring.length; ri++) {
          const ra = pl.ring[ri], rb = pl.ring[(ri + 1) % pl.ring.length];
          const rdx = rb.x - ra.x, rdz = rb.z - ra.z, rl2 = rdx * rdx + rdz * rdz;
          const rt = rl2 ? Math.max(0, Math.min(1, ((px - ra.x) * rdx + (pz - ra.z) * rdz) / rl2)) : 0;
          const rd = Math.hypot(px - ra.x - rt * rdx, pz - ra.z - rt * rdz);
          if (rd < minD) { minD = rd; closeEdge = ri; }
        }
        if (minD < 0.70) {
          const ra = pl.ring[closeEdge], rb = pl.ring[(closeEdge + 1) % pl.ring.length];
          const rdx = rb.x - ra.x, rdz = rb.z - ra.z, rlen = Math.hypot(rdx, rdz);
          const shift = 0.75 - minD;
          let shifted = false;
          for (const sign of [1, -1]) {
            const snx = (-sign * rdz) / rlen, snz = (sign * rdx) / rlen;
            const sx = px + snx * shift, sz = pz + snz * shift;
            if (polygonIn(pl.ring, sx, sz)) {
              if (ringDist(pl.ring, sx, sz, 0.70) >= 0.70 && clear(sx, sz)) {
                px = sx; pz = sz; shifted = true; break;
              }
            }
          }
          if (!shifted) continue;
        }
        if (clearRoad(px, pz, 0.3) && !addLamp(px, PLAZA_Y, pz)) continue;
        // the bench 2.4 m along the edge from the lamp, its back to the edge
        const bx = px + nx * 1.0 + tx * 2.4, bz = pz + nz * 1.0 + tz * 2.4;
        if (k % 2 === 0 && clear(bx, bz) && clearRoad(bx, bz, 1.0)) {
          addBench(bx, PLAZA_Y, bz, Math.atan2(nx, nz));
        }
      }
    }
    // planted squares: a sparse 22 m grid of planter trees, 5 m in from the edge and clear of the buildings
    if (pl.area > 3000) {
      const inner = offsetPolygonInward(pl.ring, 5.0);
      if (!inner) continue;
      const SP = 22;
      for (let gx = pl.minX + SP * 0.5; gx < pl.maxX; gx += SP) {
        for (let gz = pl.minZ + SP * 0.5; gz < pl.maxZ; gz += SP) {
          if (prand(gx, gz, 11) < 0.5) continue;
          if (!polygonIn(inner, gx, gz) || !clear(gx, gz) || !clearRoad(gx, gz, 1.7)) continue;
          addPlanterTree(gx, gz, prand(gz, gx, 12) < 0.6 ? 1 : 0, 0.8 + prand(gx, gz, 13) * 0.2);
        }
      }
    }
  }

  // =========================================================================
  activePlaza = null;
  // 6. PARKS: every park block (BLOCKS with a park share over 0.6: the Cytadela, Park Wilsona, Park Sołacki...): its
  //    curb island paved like a park walk, a granite-coped lawn inset from it under scattered trees, lampposts round the
  //    walk, its ponds cut out with a paved path round them
  // =========================================================================
  const PARK_Y = 0.26; // mineral walks (sidewalk tops are at 0.22)
  const BED_Y = 0.41; // lawn top inside the granite bed copings
  const parkLawnGeos = [];

  function clipHolesToPiece(piece, uHoles) {
    if (!uHoles.length) return [];
    const pMinX = Math.min(...piece.map((p) => p.x)), pMaxX = Math.max(...piece.map((p) => p.x));
    const pMinZ = Math.min(...piece.map((p) => p.z)), pMaxZ = Math.max(...piece.map((p) => p.z));
    const holes = [];
    let edges = null, border = null;
    for (const h of uHoles) {
      const hMinX = Math.min(...h.map((p) => p.x)), hMaxX = Math.max(...h.map((p) => p.x));
      const hMinZ = Math.min(...h.map((p) => p.z)), hMaxZ = Math.max(...h.map((p) => p.z));
      if (hMinX > pMaxX || hMaxX < pMinX || hMinZ > pMaxZ || hMaxZ < pMinZ) continue;
      // all vertices inside is not enough: a concave stretch of the outline can still cut through the hole's edges
      // (block 966's lawn and a 3,499 m² footprint union), and earcut then fills across it
      const crosses = ringCrossesGrid(piece, edges || (edges = ringEdgeGrid(piece)), h);
      if (!crosses && ringInside(piece, h)) {
        holes.push(h);
      } else if (crosses || h.some((p) => pointInPolygonXZ(piece, p.x, p.z)) ||
        piece.some((p) => pointInPolygonXZ(h, p.x, p.z))) {
        // Clip to the piece as convex fragments, each pulled 1 mm towards its centroid so fragments touch neither the
        // outline nor each other (earcut misfills touching holes). Measured on the 41 park blocks with buildings: a
        // 2 cm pull and dropping fragments under 0.5 m² left 319 m² granite and 376 m² lawn under walls; 1 mm and
        // 0.05 m² leave ~17 and ~14 m² for ~15k more triangles.
        const intersected = intersectSimpleRings(h, piece, border || (border = boundaryTriangles(piece)));
        for (const raw of intersected) {
          if (raw.length < 3 || Math.abs(polygonCentroidArea(raw)) < 0.05) continue;
          const cx = raw.reduce((s, p) => s + p.x, 0) / raw.length;
          const cz = raw.reduce((s, p) => s + p.z, 0) / raw.length;
          const nudged = raw.map((p) => {
            const d = Math.hypot(cx - p.x, cz - p.z) || 1e-6;
            const step = Math.min(0.001, d * 0.05);
            return { x: p.x + ((cx - p.x) / d) * step, z: p.z + ((cz - p.z) / d) * step };
          });
          holes.push(nudged);
        }
      }
    }
    return holes;
  }

  for (const b of BLOCKS) {
    if (!isParkBlock(b)) continue;
    const ponds = pondsIn(b.poly);
    const slab = offsetPolygonInward(b.poly, 0.1) || b.poly;
    const armiiCuts = armiiParkRoadCuts(b);
    const roadCuts = armiiCuts || b.roadCut;
    const bHoles = (b.buildings > 0 && buildingFootprints?.get(b.id)) || [];
    const unionHoles = bHoles.length > 0 ? unionPolygons(bHoles) : [];
    const curbPieces = roadCuts ? cutSlab(b.poly, roadCuts, 0, unionHoles) : [b.poly];
    const slabPieces = roadCuts ? cutSlab(slab, roadCuts, 0, unionHoles) : [slab];
    for (const piece of curbPieces) {
      const holes = roadCuts ? [] : [...ponds.filter((h) => ringInside(piece, h)), ...clipHolesToPiece(piece, unionHoles)];
      group.add(createExtrudedPolygonMesh(piece, 0.0, PARK_Y - 0.04, curbMat, true, false, holes));
    }
    for (const piece of slabPieces) {
      const holes = roadCuts ? [] : [...ponds.filter((h) => ringInside(piece, h)), ...clipHolesToPiece(piece, unionHoles)];
      const top = createExtrudedPolygonMesh(piece, 0.0, PARK_Y, pavingMat, true, false, holes);
      setPavingStyle(top.geometry, 0);
      group.add(top);
    }
    // Re-emit open-air enclosed courtyards inside buildings as curb and paving slabs
    for (const cy of unionHoles.courtyards || []) {
      group.add(createExtrudedPolygonMesh(cy, 0.0, PARK_Y - 0.04, curbMat, true, false));
      const top = createExtrudedPolygonMesh(cy, 0.0, PARK_Y, pavingMat, true, false);
      setPavingStyle(top.geometry, 0);
      group.add(top);
    }
    pavedRects.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, ring: b.poly });
    addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    const bed = offsetPolygonInward(parkBedOutline(b), parkBedInset(b, roadCuts));
    if (!bed) continue;
    // the lawn keeps a 2 m paved path round each pond (or meets the water where the pond comes too close to the walk)
    const bedHoles = ponds.map((h) => {
      const path = offsetPolygon(h, -2.0);
      return path && ringInside(bed, path) ? path : h;
    }).filter((h) => ringInside(bed, h));
    const allBedHoles = bedHoles.length > 0 && unionHoles.length > 0
      ? unionPolygons([...bedHoles, ...unionHoles])
      : (bedHoles.length > 0 ? bedHoles : unionHoles);
    // A self-intersecting bed passed raw to cutSlab leaves overlapping convex pieces; split the ring first so every
    // piece has a simple outline (block 1304's folded bed/lawn was the measured case). Blocks without a road cut
    // keep their historical rings unless building footprints already force a split.
    const bedRings = roadCuts || buildingFootprints ? splitIntoSimpleRings(bed) : [bed];
    const beds = roadCuts ? bedRings.flatMap((piece) => cutSlab(piece, roadCuts, 0, unionHoles)) : bedRings;
    for (const piece of beds) {
      const holes = roadCuts ? [] : (buildingFootprints ? clipHolesToPiece(piece, allBedHoles) :
        ponds.map((h) => {
          const path = offsetPolygon(h, -2.0);
          return path && ringInside(piece, path) ? path : h;
        }).filter((h) => ringInside(piece, h)));
      group.add(createExtrudedPolygonMesh(piece, 0.2, BED_Y - 0.21, graniteMat, true, false, holes));
    }
    const lawnTop = offsetPolygonInward(bed, 0.3);
    const lawnRings = lawnTop ? (roadCuts || buildingFootprints ? splitIntoSimpleRings(lawnTop) : [lawnTop]) : [];
    const lawns = roadCuts ? lawnRings.flatMap((piece) => cutSlab(piece, roadCuts, 0, unionHoles)) : lawnRings;
    for (const piece of lawns) {
      const holes = roadCuts ? [] : (buildingFootprints ? clipHolesToPiece(piece, allBedHoles) :
        bedHoles.filter((h) => ringInside(piece, h)));
      parkLawnGeos.push(createExtrudedPolygonMesh(piece, 0.3, BED_Y - 0.3, lawnMat, true, false, holes).geometry);
    }
    // trees on a jittered grid inside the bed, sparser in the big parks (the Cytadela alone is ~1 km²), never within
    // 4 m of a pond
    const SP = b.area > 20000 ? 14 : 11;
    const parkTree0 = treeSites.length;
    const inner = lawnTop || bed;
    const bLots = b.buildings > 0 ? blockLots(b) : [];
    for (let gx = b.minX + SP * 0.5; gx < b.maxX; gx += SP) {
      for (let gz = b.minZ + SP * 0.5; gz < b.maxZ; gz += SP) {
        const tx = gx + (prand(gx, gz) - 0.5) * SP * 0.7;
        const tz = gz + (prand(gz, gx, 1) - 0.5) * SP * 0.7;
        if (!polygonIn(inner, tx, tz) || (roadCuts && !lawns.some((p) => polygonIn(p, tx, tz))) ||
          distToWater(tx, tz) < 4) continue;
        if (prand(tx, tz, 9) < 0.3) continue; // glades (pure hash: after the cheap rejects)
        const scale = 0.9 + prand(tx, tz, 3) * 0.4;
        if (bLots.length > 0 && distToLots(tx, tz, bLots) < Math.max(1.2, 6.07 * scale)) continue;
        const r = prand(tx, tz, 2);
        treeSites.push({ x: tx, y: BED_Y, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });
      }
    }
    // lampposts every ~34 m along the walk, inset ~1.0 m from curb. Where the walk is narrower than that (bed insets
    // of 0.1–0.8 m), the lamp steps up to 2.5 m inward onto the lawn, 0.5 m past the inner edge of the 0.3 m coping
    // and 2.5 m clear of this park's trees; dropping them instead left 15 parks without a single lamp. Offsetting these
    // special-cased bed outlines again can fold them, so the lawn test measures distances to the drawn rings; the bed
    // outline can also reach past the block, hence blockAt.
    const lampLine = offsetPolygonInward(b.poly, 1.05);
    // A lamp on a cut roll keeps 0.7 m from the new curb face (the audit's 0.5 m plus its 0.2 m radius); otherwise a
    // lamp just outside a road corridor but inside the block reads as standing on the curb stone.
    const cutClear = (x, z) => !roadCuts || roadCuts.every(([ax, az, bx, bz, half]) => {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1e-6) return true;
      const along = ((x - ax) * dx + (z - az) * dz) / len;
      const across = ((z - az) * dx - (x - ax) * dz) / len;
      return along < -half - 0.7 || along > len + half + 0.7 || Math.abs(across) > half + 0.7;
    });
    const clearOf = (rings, x, z) => rings.every((h) => !polygonIn(h, x, z) && ringDist(h, x, z, 1) >= 1);
    const onLawn = (x, z) => blockAt(x, z) === b && ringDist(b.poly, x, z, 0.95) >= 0.95 &&
      lawns.some((p) => polygonIn(p, x, z) && ringDist(p, x, z, 0.7) >= 0.7) &&
      beds.every((p) => ringDist(p, x, z, 1) >= 1) && clearOf(bedHoles, x, z) && clearOf(ponds, x, z) &&
      distToWater(x, z) >= 2 && cutClear(x, z);
    const clearOfParkTrees = (x, z) => {
      for (let k = parkTree0; k < treeSites.length; k++) {
        if (Math.hypot(treeSites[k].x - x, treeSites[k].z - z) < 2.5) return false;
      }
      return true;
    };
    if (lampLine) {
      for (let i = 0; i < lampLine.length; i++) {
        const a = lampLine[i];
        const c = lampLine[(i + 1) % lampLine.length];
        const len = Math.hypot(c.x - a.x, c.z - a.z);
        if (len < 1e-6) continue;
        let nx = -(c.z - a.z) / len, nz = (c.x - a.x) / len; // flipped below to point into the park
        for (let t = 17; t < len - 8; t += 34) {
          let px = a.x + ((c.x - a.x) * t) / len;
          let pz = a.z + ((c.z - a.z) * t) / len;
          let y = PARK_Y;
          if (beds.some((p) => polygonIn(p, px, pz))) {
            // 1.3 m outward from the 1.05 m line is past the curb, inward it is still in the park
            if (!pointInBlockPoly(b, px + nx * 1.3, pz + nz * 1.3)) { nx = -nx; nz = -nz; }
            let moved = false;
            for (let d = 0.25; d <= 2.5 && !moved; d += 0.25) {
              const qx = px + nx * d, qz = pz + nz * d;
              if (onLawn(qx, qz) && clearOfParkTrees(qx, qz)) {
                px = qx; pz = qz; y = BED_Y; moved = true;
              }
            }
            if (!moved) continue;
          } else if (roadCuts) {
            if (!slabPieces.some((p) => polygonIn(p, px, pz))) continue;
            if (!cutClear(px, pz)) {
              // Step inward off the cut curb where the walk beside a corridor is narrow; drop the site only if 2.5 m
              // still leaves it on the edge.
              if (!pointInBlockPoly(b, px + nx * 1.3, pz + nz * 1.3)) { nx = -nx; nz = -nz; }
              let moved = false;
              for (let d = 0.25; d <= 2.5 && !moved; d += 0.25) {
                const qx = px + nx * d, qz = pz + nz * d;
                if (cutClear(qx, qz) && slabPieces.some((p) => polygonIn(p, qx, qz))) {
                  px = qx; pz = qz; moved = true;
                }
              }
              if (!moved) continue;
            }
          }
          // A narrow or folded park walk can put the 1.05 m inset line within the audit's 0.5 m of the curb: keep the
          // lamp only when its 0.2 m pole is at least 0.7 m inside the block outline.
          if (ringDist(b.poly, px, pz, 0.7) < 0.7) continue;
          addLamp(px, y, pz);
        }
      }
    }
  }

  // Parks inside blocks that are only partly park (Park Wilsona, Park Dąbrowskiego behind Stary Browar, Park
  // Mazowieckiego): buildings.js leaves their rings unbuilt, so they get a lawn over the sidewalk slab (a ring wholly
  // inside its block; one crossing the curb keeps the paving) and trees kept PARK_TREE_EDGE inside the ring, clear of
  // the 20 m building cells that only clip it
  const PARK_TREE_EDGE = 10;
  const partParkRings = (GEO.parks || []).flatMap((p) => (p.rings || []).map((r) => {
    const pts = [];
    for (let i = 0; i + 1 < r.length; i += 2) pts.push({ x: r[i], z: r[i + 1] });
    // The three Teatr Polski lawns are drawn with their full mapped outlines by the site pass below, including the
    // long one that reaches the 27 Grudnia kerb; the generic 80 % vertex rule would drop it or leave slivers.
    return { pts, teatr: !!p.teatr };
  }));
  for (const b of BLOCKS) {
    if (!(b.park > 0) || isParkBlock(b) || b.median) continue;
    // A block can touch dozens of mapped park rings. Its lot layout is unchanged between them; defer it until
    // the first tree candidate ring and reuse it only for this block (no lot cache escapes construction).
    let bLots = null;
    for (const rec of partParkRings) {
      if (rec.teatr) continue;
      const ring = rec.pts;
      if (!ring.some((p) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ)) continue;
      // A ring mostly inside (Park Dąbrowskiego: 37 of 38 vertices) has the stray vertices pulled onto the block's
      // outline 1 m in
      const inside = ring.filter((p) => pointInBlockPoly(b, p.x, p.z)).length;
      if (inside >= ring.length * 0.8) {
        const edge = inside < ring.length ? offsetPolygonInward(b.poly, 1) : null;
        const pts = edge ? ring.map((p) => (polygonIn(edge, p.x, p.z) ? p : nearestOnRing(edge, p.x, p.z))) : ring;
        // Projecting this narrow mapped strip onto its block pulls one end across Milczańska. Its original
        // ring is simple, so preserve that outline and cut the road corridor from it below.
        const milczanska = b.minX === 1350 && b.maxX === 3048.5 && ring.length === 72 &&
          ring[0].x === 2253.3 && ring[0].z === 1622.1;
        // At these two sites the projected ring or its usual 0.5 m inset folds across itself.
        const tysiac = b.minX === 1360 && b.maxX === 3315.5 && ring[0].x === 2632.1 && ring[0].z === 1439.4;
        const riverside = b.minX === 512 && b.maxX === 1410 && ring[0].x === 907.3 && ring[0].z === -785.5;
        const lawn = milczanska || tysiac ? ring : offsetPolygonInward(pts, riverside ? 0.2 : 0.5);
        if (lawn) {
          // These mapped park rings extend across streets or service roads even after the usual inset.
          // Cut the measured road widths while retaining their other surfaces.
          let roadName = null;
          if (milczanska) roadName = 'Milczańska';
          if (b.minX === 2101 && b.maxX === 2995.5 && pointInPolygonXZ(lawn, 2705.93, -1895.80)) roadName = 'Skromna';
          if (b.minX === -1145 && b.maxX === -722 && pointInPolygonXZ(lawn, -856.19, 2443)) roadName = 'Zmartwychwstańców';
          const segs = partialParkServiceCuts(b, ring);
          if (roadName) {
            for (const road of GEO.roads) {
              if (road[0] !== roadName) continue;
              const p = road[5];
              for (let i = 0; i + 3 < p.length; i += 2) segs.push([p[i], p[i + 1], p[i + 2], p[i + 3], road[1] * 0.5]);
            }
          }
          const bounded = milczanska || tysiac ? intersectSimpleRings(lawn, b.poly) : [lawn];
          const pieces = segs.length ? bounded.flatMap((piece) => cutSlab(piece, segs, 0)) : bounded;
          for (const piece of pieces) parkLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry);
        }
      }
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      const SP = 12;
      const E = PARK_TREE_EDGE;
      if (!bLots) bLots = b.buildings > 0 ? blockLots(b) : [];
      for (let gx = Math.max(x0, b.minX) + SP * 0.5; gx < Math.min(x1, b.maxX); gx += SP) {
        for (let gz = Math.max(z0, b.minZ) + SP * 0.5; gz < Math.min(z1, b.maxZ); gz += SP) {
          const tx = gx + (prand(gx, gz) - 0.5) * SP * 0.7;
          const tz = gz + (prand(gz, gx, 1) - 0.5) * SP * 0.7;
          if (!pointInBlockPoly(b, tx, tz) || distToWater(tx, tz) < 4) continue;
          if (![[0, 0], [E, 0], [-E, 0], [0, E], [0, -E]].every(([dx, dz]) => polygonIn(ring, tx + dx, tz + dz))) continue;
          if (prand(tx, tz, 9) < 0.3) continue; // glades (a pure hash: order does not change the kept sites)
          const scale = 0.9 + prand(tx, tz, 3) * 0.4;
          if (bLots.length > 0 && distToLots(tx, tz, bLots) < Math.max(1.2, 6.07 * scale)) continue;
          const r = prand(tx, tz, 2);
          treeSites.push({ x: tx, y: SW_TOP, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });
        }
      }
    }
  }

  // Piotrowo's mapped lawns and outdoor turf replace the fictional houses. Leave the existing block paving
  // between these outlines as paths; never cover an entire campus block with a new slab.
  const campusCuts = [];
  for (const road of GEO.roads) {
    const p = road[5];
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (Math.max(p[i], p[i + 2]) < 850 || Math.min(p[i], p[i + 2]) > 1380 ||
        Math.max(p[i + 1], p[i + 3]) < 120 || Math.min(p[i + 1], p[i + 3]) > 1005) continue;
      campusCuts.push([p[i], p[i + 1], p[i + 2], p[i + 3], road[1] / 2 + 0.5]);
    }
  }
  for (const rail of GEO.rail) {
    const p = rail.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (Math.max(p[i], p[i + 2]) < 850 || Math.min(p[i], p[i + 2]) > 1380 ||
        Math.max(p[i + 1], p[i + 3]) < 120 || Math.min(p[i + 1], p[i + 3]) > 1005) continue;
      campusCuts.push([p[i], p[i + 1], p[i + 2], p[i + 3], 2.3]);
    }
  }
  for (const surface of GEO.piotrowo?.grounds || []) {
    const ring = [];
    for (let i = 0; i < surface.ring.length; i += 2) ring.push({ x: surface.ring[i], z: surface.ring[i + 1] });
    for (const piece of cutSlab(ring, campusCuts, 0)) {
      parkLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry);
    }
  }

  // One merged lawn mesh for every park
  if (parkLawnGeos.length) {
    const parkLawnMesh = new THREE.Mesh(mergeGeometries(parkLawnGeos, false), lawnMat);
    parkLawnMesh.receiveShadow = true;
    group.add(parkLawnMesh);
  }

  // =========================================================================
  // 6b. TEATR POLSKI SITE (city-config.js TEATR_POLSKI_SITE): the surveyed car parks, the three full mapped lawns, the
  //     27 Grudnia promenade and the portico walk, with benches and lamps. The block frontage
  //     stays open; everything here is the real ground between Okrąglak and Ratajczaka.
  // =========================================================================
  const siteLawnRings = [];
  for (const park of TEATR_POLSKI_LAWNS) {
    for (const flat of park.rings || []) {
      const ring = [];
      for (let i = 0; i + 1 < flat.length; i += 2) ring.push({ x: flat[i], z: flat[i + 1] });
      if (ring.length >= 3) siteLawnRings.push(ring);
    }
  }
  // The path corridors are cut from the lawns first, then drawn as their own paving on top; the cut is 0.25 m wider
  // than the visible path so no uncut grass edge hangs over the paving.
  const sitePathSegs = [];
  for (const path of TEATR_POLSKI_SITE.paths) {
    for (let i = 0; i + 1 < path.pts.length; i++) {
      const a = path.pts[i], b = path.pts[i + 1];
      sitePathSegs.push([a.x, a.z, b.x, b.z, path.half + 0.25]);
    }
  }
  const siteLawnGeos = [];
  for (const ring of siteLawnRings) {
    let block = null;
    for (const p of ring) {
      block = blockAt(p.x, p.z);
      if (block) break;
    }
    let pieces;
    if (block && !ring.every((p) => pointInBlockPoly(block, p.x, p.z))) {
      // The long lawn's south-east corner reaches the 27 Grudnia pavement; clip its full outline to the block's curb
      // instead of dropping the whole ring (the generic 80 % vertex rule left the square without its largest lawn).
      const core = offsetPolygonInward(ring, 0.35) || ring;
      const border = offsetPolygonInward(block.poly, 0.35) || block.poly;
      pieces = intersectSimpleRings(core, border);
    } else {
      const core = offsetPolygonInward(ring, 0.35);
      pieces = core ? [core] : splitIntoSimpleRings(ring);
    }
    if (sitePathSegs.length) pieces = pieces.flatMap((piece) => cutSlab(piece, sitePathSegs, 0));
    for (const piece of pieces) {
      if (piece.length >= 3 && Math.abs(polygonCentroidArea(piece)) > 0.1) {
        siteLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry);
      }
    }
  }
  if (siteLawnGeos.length) {
    const siteLawnMesh = new THREE.Mesh(mergeGeometries(siteLawnGeos, false), lawnMat);
    siteLawnMesh.receiveShadow = true;
    group.add(siteLawnMesh);
  }

  // Paths: the promenade, portico walk and driveway are granite-sett paving (style 1), a little above the sidewalk.
  const sitePathGeos = [];
  for (let i = 0; i < TEATR_POLSKI_SITE.paths.length; i++) {
    const path = TEATR_POLSKI_SITE.paths[i];
    const mesh = createFlatPolygonMesh(path.ring, 0.238 + i * 0.0004, pavingMat);
    // ShapeGeometry carries the uv attribute the paving material reads in the browser; the headless three stub used by
    // park-paving.test.cjs has no attributes, so only tag it when present.
    if (mesh.geometry.attributes?.uv) setPavingStyle(mesh.geometry, 1);
    sitePathGeos.push(mesh.geometry);
  }
  if (sitePathGeos.length) {
    const pathMesh = new THREE.Mesh(mergeGeometries(sitePathGeos, false), pavingMat);
    pathMesh.receiveShadow = true;
    group.add(pathMesh);
  }

  // Car-park surfaces: the real parking polygons, asphalt 12 mm above the block paving, so they read as a different
  // surface and never z-fight with the sidewalk.
  for (const ring of TEATR_POLSKI_SITE.parking) {
    group.add(createFlatPolygonMesh(ring, 0.232, roadMat));
  }

  // Benches and lamps from the OSM survey, and two granite planters flanking the portico walk, so the forecourt is not
  // a featureless 30 × 25 m slab. All of it uses the square/park instanced families created below.
  for (const b of TEATR_POLSKI_SITE.benches) addBench(b.x, 0.238, b.z, b.rot || 0);
  for (const l of TEATR_POLSKI_SITE.lamps) addLamp(l.x, 0.238, l.z);
  addPlanterTree(-709.0, 30.0, 1, 0.72);
  addPlanterTree(-692.0, 30.0, 2, 0.72);

  // Instanced plaza & park furniture: slatted benches (seat facing +z) & cast-iron lampposts with globes
  if (benchMatrices.length) {
    const benchGeo = mergeGeometries([
      new THREE.BoxGeometry(1.9, 0.06, 0.46).translate(0, 0.45, 0.02),
      new THREE.BoxGeometry(1.9, 0.34, 0.05).rotateX(-0.22).translate(0, 0.74, -0.22),
      new THREE.BoxGeometry(0.07, 0.45, 0.52).translate(-0.86, 0.225, 0),
      new THREE.BoxGeometry(0.07, 0.45, 0.52).translate(0.86, 0.225, 0),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(-0.9, 0.62, 0.02),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(0.9, 0.62, 0.02)
    ]);
    const benchMat = new THREE.MeshStandardNodeMaterial({ color: 0x34503a, roughness: 0.66, metalness: 0.15 });
    const benchInst = new THREE.InstancedMesh(benchGeo, benchMat, benchMatrices.length);
    benchMatrices.forEach((m, i) => benchInst.setMatrixAt(i, m));
    benchInst.instanceMatrix.needsUpdate = true;
    benchInst.castShadow = true;
    benchInst.receiveShadow = true;
    benchInst.computeBoundingSphere();
    group.add(benchInst);
  }
  if (lampMatrices.length) {
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8).translate(0, 0.35, 0),
      new THREE.CylinderGeometry(0.055, 0.085, 3.1, 8).translate(0, 2.25, 0),
      new THREE.CylinderGeometry(0.13, 0.07, 0.2, 8).translate(0, 3.85, 0)
    ]);
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x1c201d, roughness: 0.45, metalness: 0.6 });
    const globeGeo = new THREE.SphereGeometry(0.27, 12, 8).translate(0, 4.17, 0);
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampMatrices.length);
    const globeInst = new THREE.InstancedMesh(globeGeo, createParkLampGlobeMaterial(), lampMatrices.length);
    lampMatrices.forEach((m, i) => {
      poleInst.setMatrixAt(i, m);
      globeInst.setMatrixAt(i, m);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    globeInst.instanceMatrix.needsUpdate = true;
    poleInst.castShadow = true;
    poleInst.computeBoundingSphere();
    globeInst.computeBoundingSphere();
    group.add(poleInst, globeInst);

    // Warm pools of lamplight on the walks & bed copings after dusk (additive decal, black by day)
    const poolInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), createParkLampPoolMaterial(), lampMatrices.length);
    const poolM = new THREE.Matrix4();
    lampMatrices.forEach((m, i) => {
      poolInst.setMatrixAt(i, poolM.makeScale(14, 1, 14).setPosition(m.elements[12], m.elements[13] + 0.17, m.elements[14]));
    });
    poolInst.instanceMatrix.needsUpdate = true;
    poolInst.computeBoundingSphere();
    group.add(poolInst);
  }

  // Trunk colliders for every park & plaza tree laid out above (planters, park beds, part-park lawns): a box about the
  // trunk's flared root (trees.js trunk radii 0.25-0.36 m, scaled), tall enough that a jump off a planter can't clear it.
  // The park and lawn trees on a track's way are dropped first (planter trees were checked with their planters).
  let kept = 0;
  for (const s of treeSites) if (railClear(s.x, s.z, 0.4 * s.scale)) treeSites[kept++] = s;
  treeSites.length = kept;
  for (const s of treeSites) {
    const c = addPropCollider(s.x, s.z, 0.28 * s.scale, 0.28 * s.scale, s.y + 3.0);
    c.isTrunk = true;
    s.collider = c;
  }

  // Park & plaza tree and lamp sites, read by street-details.js after the city grid is built
  parkTreeSites = treeSites;
  parkLampSites = lampMatrices.map((m) => ({ x: m.elements[12], y: m.elements[13] + 4.17, z: m.elements[14] }));
  pavedPlazaRects = pavedRects;
  sidewalkBlocks = blockSidewalks; // { cx, cz, w, d } raised sidewalk slabs (cross-street tree rows)
  ringDistIndexes = new WeakMap(); // boot-only: the plaza/park outlines are not measured after this build

  // Batch static sub-meshes by material to reduce per-frame WebGPU draw calls
  batchStaticGroupMeshes(group, new Set([waterMat, roadMat, lawnMat]));

  scene.add(group);

  // Raised sidewalk blocks bound the roads (the planted malls are obstacles in the roadway, handed over with the
  // footprints)
  const sidewalks = roadSidewalks;
  const colliders = [];
  console.info(`[cityGrid] ${benchMatrices.length} benches, ${lampMatrices.length} lampposts, ` +
    `${treeSites.length} park & plaza trees; ${propColliders.length} player colliders; ${offTrack} props kept off the ` +
    `tracks; ${cutPlazas.length} squares paved round tram track`);
  // pointInPark ran for the last boot consumer above (buildings.js built before this, blockLots during it); the park
  // indexes and ring grid are boot-only, so give them back. A late call rebuilds both lazily.
  releaseParkIndexes();
  return { group, sidewalks, footprints, colliders, propColliders, cutPlazas, roadCutPlazas };
}

export {
  buildCityGrid,
  batchStaticGroupMeshes,
  pavedPlazas,
  cutSlab,
  railClearance,
  clearOfRails,
  RAIL_PROP_KEEP,
  TRAM_CUT,
  parkTreeSites,
  parkLampSites,
  pavedPlazaRects,
  sidewalkBlocks
};
