import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CITY_BOUNDS,
  LAND_RINGS,
  LAND_HOLES,
  PLAZAS,
  ROADS,
  BLOCKS,
  distToWater
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

function polygonCentroidArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a * 0.5;
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

/**
 * Tags every vertex of a mesh using the shared park paving material with its paving style (uv.x, see
 * createParkPavingMaterial: 0 hex asphalt pavers, 1 light granite plaza pavers, 2 bluestone slabs).
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
      const seg = { ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3] };
      for (let ix = Math.floor(Math.min(seg.ax, seg.bx) / RAIL_CELL); ix <= Math.floor(Math.max(seg.ax, seg.bx) / RAIL_CELL); ix++) {
        for (let iz = Math.floor(Math.min(seg.az, seg.bz) / RAIL_CELL); iz <= Math.floor(Math.max(seg.az, seg.bz) / RAIL_CELL); iz++) {
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
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const L2 = ex * ex + ez * ez;
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
        best = Math.min(best, Math.hypot(s.ax + ex * t - x, s.az + ez * t - z));
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

/**
 * A slab outline with the track corridors cut out, as convex pieces: the ring is ear-clipped, then every piece loses
 * each corridor quad (a track segment widened by `half` either side and lengthened by `half` at both ends, so the
 * corridor stays closed round bends). Subtracting a convex quad from a convex piece leaves at most four convex pieces,
 * one per quad edge, so every step is plain half-plane clipping. Slivers under 0.02 m² are dropped.
 */
function cutSlab(ring, segs, half) {
  let pieces = triangulateRing(ring);
  const area = (p) => polygonCentroidArea(p);
  for (const [ax, az, bx, bz] of segs) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = ((bx - ax) / len) * half, uz = ((bz - az) / len) * half;
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
  // centreline length of the segments a -> b inside the square (not in a building on it)
  const lengthInside = (p, a, b) => {
    if (Math.max(a.x, b.x) < p.minX || Math.min(a.x, b.x) > p.maxX || Math.max(a.z, b.z) < p.minZ || Math.min(a.z, b.z) > p.maxZ) return 0;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / STEP));
    let inside = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (pointInPolygonXZ(p.ring, x, z) && !p.holes.some((h) => pointInPolygonXZ(h, x, z))) inside += len / n;
    }
    return inside;
  };
  const kept = list.filter((p) => {
    let inside = 0;
    for (const r of ROADS) {
      for (let i = 0; i + 1 < r.pts.length; i++) inside += lengthInside(p, r.pts[i], r.pts[i + 1]);
    }
    return inside <= 30;
  });
  for (const p of kept) {
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

function buildCityGrid(scene) {
  const group = new THREE.Group();
  group.name = 'CityGrid';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const B = CITY_BOUNDS;

  // Ground footprints that traffic and pedestrians must keep clear of (medians, parks)
  const footprints = [];
  const addFootprint = (x, z, w, d) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

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
      if (b.median) addFootprint(slab.cx, slab.cz, slab.w, slab.d);
      else roadSidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    } else {
      // curb (granite) ring under a sidewalk slab inset by 0.25 m, like the instanced pair below
      const ponds = pondsIn(b.poly);
      const curb = createExtrudedPolygonMesh(b.poly, 0.0, 0.18, curbMat, true, false, ponds).geometry;
      curbGeos.push(curb);
      const inner = offsetPolygonInward(b.poly, 0.25);
      if (inner) slabGeos.push(createExtrudedPolygonMesh(inner, 0.03, SW_TOP - 0.03, sidewalkMat, true, false, ponds.filter((h) => ringInside(inner, h))).geometry);
      // rect cover for the consumers that work on rectangles: the lot rects grown back out to the curb. The road
      // network gets the lot rects as they are: on a turned block a rect grown 4.4 m along the world axes reaches into
      // the roadway, and the largest strongly connected set fell from ~3150 to ~1660 edges with them
      for (const [x0, x1, z0, z1] of b.rects) {
        const r = { minX: x0 - 4.4, maxX: x1 + 4.4, minZ: z0 - 4.4, maxZ: z1 + 4.4 };
        blockSidewalks.push({ cx: (r.minX + r.maxX) * 0.5, cz: (r.minZ + r.maxZ) * 0.5, w: r.maxX - r.minX, d: r.maxZ - r.minZ, block: b, cover: true });
        if (!b.median) roadSidewalks.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
      }
      if (b.median) addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    // Planted malls down the middle of the wide streets: a clipped hedge on the slab
    if (b.median && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) > 2.2) {
      const hedge = offsetPolygonInward(b.poly, 1.0);
      if (hedge) hedgeGeos.push(createExtrudedPolygonMesh(hedge, SW_TOP, 0.55, medianHedgeMat).geometry);
    }
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
  function addPropCollider(x, z, hx, hz, maxY, rotY = 0) {
    if (!rotY) {
      propColliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, maxY });
      return;
    }
    // local x maps to world (cos, -sin) under a three.js y rotation, local z to (sin, cos): the controllers' obb frame
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    propColliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY, obb: { cx: x, cz: z, hx, hz, cs, sn } });
  }
  const prand = (x, z, k = 0) => {
    const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };

  const cutPlazas = []; // { name, curb, top }: the convex slab pieces of the squares paved round tram track
  function addPavedPlaza(pts, style, topY = PLAZA_Y, holes = [], tramSegs = null, name = '') {
    pavedRects.push(...coverRects(pts));
    const inner = offsetPolygonInward(pts, 0.3) || pts;
    if (tramSegs) {
      // the curb-stone rim runs along the cut edges too: the paving keeps 0.3 m back from them as from the outline
      const curb = cutSlab(pts, tramSegs, TRAM_CUT);
      const top = cutSlab(inner, tramSegs, TRAM_CUT + 0.3);
      for (const piece of curb) group.add(createExtrudedPolygonMesh(piece, 0.0, topY - 0.04, curbMat));
      for (const piece of top) {
        const mesh = createExtrudedPolygonMesh(piece, 0.0, topY, pavingMat);
        setPavingStyle(mesh.geometry, style);
        group.add(mesh);
      }
      cutPlazas.push({ name, curb, top });
      return;
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
  function addPlanterTree(x, z, species = 1, scale = 0.85) {
    if (!railClear(x, z, 1.7)) return false; // the 2.4 m planter's corner
    addPlanter(x, z, 2.4, 2.4);
    treeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species });
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
    const holes = pl.holes.filter((h) => h.length >= 3 && ringInside(pl.ring, h));
    // cutSlab has no holes: a square with both buildings and tram track on it (none so far) is left unpaved rather
    // than burying the rails
    if (pl.tramSegs && holes.length) continue;
    addPavedPlaza(pl.ring, 1, PLAZA_Y, holes, pl.tramSegs, pl.name || '');
    // furniture keeps 2 m in from the plaza's edge and 2.5 m off the buildings on it
    const edge = offsetPolygonInward(pl.ring, 2.0);
    if (!edge) continue;
    const grownHoles = holes.map((h) => offsetPolygon(h, -2.5) || h);
    const clear = (x, z) => !grownHoles.some((h) => pointInPolygonXZ(h, x, z));
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
        const px = a.x + tx * t, pz = a.z + tz * t;
        if (!clear(px, pz) || !pointInPolygonXZ(pl.ring, px, pz)) continue;
        if (!addLamp(px, PLAZA_Y, pz)) continue;
        // the bench 2.4 m along the edge from the lamp, its back to the edge
        const bx = px + nx * 1.0 + tx * 2.4, bz = pz + nz * 1.0 + tz * 2.4;
        if (k % 2 === 0 && clear(bx, bz)) addBench(bx, PLAZA_Y, bz, Math.atan2(nx, nz));
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
          if (!pointInPolygonXZ(inner, gx, gz) || !clear(gx, gz)) continue;
          addPlanterTree(gx, gz, prand(gz, gx, 12) < 0.6 ? 1 : 0, 0.8 + prand(gx, gz, 13) * 0.2);
        }
      }
    }
  }

  // =========================================================================
  // 6. PARKS: every park block (BLOCKS with a park share over 0.6: the Cytadela, Park Wilsona, Park Sołacki...): its
  //    curb island paved like a park walk, a granite-coped lawn inset from it under scattered trees, lampposts round the
  //    walk, its ponds cut out with a paved path round them
  // =========================================================================
  const PARK_Y = 0.26; // hex-paver walks (sidewalk tops are at 0.22)
  const BED_Y = 0.41; // lawn top inside the granite bed copings
  const parkLawnGeos = [];
  for (const b of BLOCKS) {
    if (!isParkBlock(b)) continue;
    const ponds = pondsIn(b.poly);
    const slab = offsetPolygonInward(b.poly, 0.1) || b.poly;
    group.add(createExtrudedPolygonMesh(b.poly, 0.0, PARK_Y - 0.04, curbMat, true, false, ponds));
    const top = createExtrudedPolygonMesh(slab, 0.0, PARK_Y, pavingMat, true, false, ponds.filter((h) => ringInside(slab, h)));
    setPavingStyle(top.geometry, 0);
    group.add(top);
    pavedRects.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    const bed = offsetPolygonInward(b.poly, Math.min(5, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.2));
    if (!bed) continue;
    // the lawn keeps a 2 m paved path round each pond (or meets the water where the pond comes too close to the walk)
    const bedHoles = ponds.map((h) => {
      const path = offsetPolygon(h, -2.0);
      return path && ringInside(bed, path) ? path : h;
    }).filter((h) => ringInside(bed, h));
    group.add(createExtrudedPolygonMesh(bed, 0.2, BED_Y - 0.21, graniteMat, true, false, bedHoles));
    const lawnTop = offsetPolygonInward(bed, 0.3);
    if (lawnTop) parkLawnGeos.push(createExtrudedPolygonMesh(lawnTop, 0.3, BED_Y - 0.3, lawnMat, true, false, bedHoles.filter((h) => ringInside(lawnTop, h))).geometry);
    // trees on a jittered grid inside the bed, sparser in the big parks (the Cytadela alone is ~1 km²), never within
    // 4 m of a pond
    const SP = b.area > 20000 ? 14 : 11;
    const inner = lawnTop || bed;
    for (let gx = b.minX + SP * 0.5; gx < b.maxX; gx += SP) {
      for (let gz = b.minZ + SP * 0.5; gz < b.maxZ; gz += SP) {
        const tx = gx + (prand(gx, gz) - 0.5) * SP * 0.7;
        const tz = gz + (prand(gz, gx, 1) - 0.5) * SP * 0.7;
        if (prand(tx, tz, 9) < 0.3) continue; // glades
        if (!pointInPolygonXZ(inner, tx, tz) || distToWater(tx, tz) < 4) continue;
        const r = prand(tx, tz, 2);
        treeSites.push({ x: tx, y: BED_Y, z: tz, scale: 0.9 + prand(tx, tz, 3) * 0.4, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });
      }
    }
    // lampposts every ~34 m along the walk
    for (let i = 0; i < slab.length; i++) {
      const a = slab[i];
      const c = slab[(i + 1) % slab.length];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      for (let t = 17; t < len - 8; t += 34) {
        const px = a.x + ((c.x - a.x) * t) / len;
        const pz = a.z + ((c.z - a.z) * t) / len;
        addLamp(px, PARK_Y, pz);
      }
    }
  }

  // Parks inside blocks that are only partly park (Park Wilsona, Park Dąbrowskiego behind Stary Browar, Park
  // Mazowieckiego): buildings.js leaves their rings unbuilt, so they get a lawn over the sidewalk slab (a ring wholly
  // inside its block; one crossing the curb keeps the paving) and trees kept PARK_TREE_EDGE inside the ring, clear of
  // the 20 m building cells that only clip it
  const PARK_TREE_EDGE = 10;
  const partParkRings = (GEO.parks || []).flatMap((p) => p.rings || []).map((r) => {
    const pts = [];
    for (let i = 0; i + 1 < r.length; i += 2) pts.push({ x: r[i], z: r[i + 1] });
    return pts;
  });
  for (const b of BLOCKS) {
    if (!(b.park > 0) || isParkBlock(b) || b.median) continue;
    for (const ring of partParkRings) {
      if (!ring.some((p) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ)) continue;
      // A ring mostly inside (Park Dąbrowskiego: 37 of 38 vertices) has the stray vertices pulled onto the block's
      // outline 1 m in
      const inside = ring.filter((p) => pointInPolygonXZ(b.poly, p.x, p.z)).length;
      if (inside >= ring.length * 0.8) {
        const edge = inside < ring.length ? offsetPolygonInward(b.poly, 1) : null;
        const pts = edge ? ring.map((p) => (pointInPolygonXZ(edge, p.x, p.z) ? p : nearestOnRing(edge, p.x, p.z))) : ring;
        const lawn = offsetPolygonInward(pts, 0.5);
        if (lawn) parkLawnGeos.push(createExtrudedPolygonMesh(lawn, SW_TOP - 0.02, 0.06, lawnMat).geometry);
      }
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      const SP = 12;
      const E = PARK_TREE_EDGE;
      for (let gx = Math.max(x0, b.minX) + SP * 0.5; gx < Math.min(x1, b.maxX); gx += SP) {
        for (let gz = Math.max(z0, b.minZ) + SP * 0.5; gz < Math.min(z1, b.maxZ); gz += SP) {
          const tx = gx + (prand(gx, gz) - 0.5) * SP * 0.7;
          const tz = gz + (prand(gz, gx, 1) - 0.5) * SP * 0.7;
          if (prand(tx, tz, 9) < 0.3) continue; // glades
          if (!pointInPolygonXZ(b.poly, tx, tz) || distToWater(tx, tz) < 4) continue;
          if (![[0, 0], [E, 0], [-E, 0], [0, E], [0, -E]].every(([dx, dz]) => pointInPolygonXZ(ring, tx + dx, tz + dz))) continue;
          const r = prand(tx, tz, 2);
          treeSites.push({ x: tx, y: SW_TOP, z: tz, scale: 0.9 + prand(tx, tz, 3) * 0.4, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });
        }
      }
    }
  }

  // One merged lawn mesh for every park
  if (parkLawnGeos.length) {
    const parkLawnMesh = new THREE.Mesh(mergeGeometries(parkLawnGeos, false), lawnMat);
    parkLawnMesh.receiveShadow = true;
    group.add(parkLawnMesh);
  }

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
  for (const s of treeSites) addPropCollider(s.x, s.z, 0.28 * s.scale, 0.28 * s.scale, s.y + 3.0);

  // Park & plaza tree and lamp sites, read by street-details.js after the city grid is built
  parkTreeSites = treeSites;
  parkLampSites = lampMatrices.map((m) => ({ x: m.elements[12], y: m.elements[13] + 4.17, z: m.elements[14] }));
  pavedPlazaRects = pavedRects;
  sidewalkBlocks = blockSidewalks; // { cx, cz, w, d } raised sidewalk slabs (cross-street tree rows)

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
  return { group, sidewalks, footprints, colliders, propColliders, cutPlazas };
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
