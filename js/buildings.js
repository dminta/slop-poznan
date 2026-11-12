import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBalconies } from './balconies.js';
import {
  Fn,
  float,
  vec2,
  color,
  uv,
  texture,
  attribute,
  positionWorld,
  normalWorldGeometry,
  abs,
  fract,
  step,
  smoothstep,
  fwidth,
  max,
  min,
  mix,
  length,
  mx_noise_float
} from 'three/tsl';
import {
  BLOCKS,
  BRIDGES,
  LANDMARK_SITES,
  PLAZAS,
  SPAWN,
  SRODKA_MURAL,
  ZAMEK_FORECOURT,
  TEATR_POLSKI_FORECOURT,
  TEATR_POLSKI_RESERVE_FRAME,
  blockAt,
  pointInPark,
  pointInBlockPoly,
  parkFreeCells,
  splitDeep,
  roadClearance,
  pedestrianClearance
} from './city-config.js';
import {
  createParkLawnMaterial,
  createPreWarBuildingMaterial,
  createCurtainWallMaterial,
  createPanelBlockMaterial,
  createRoofMaterial,
  createDormerWindowMaterial,
  createGableScreenMaterial,
  createFacadeBoxes,
  WALL_KINDS
} from './tsl-materials.js';
import { createRoofs, ROOF_MATERIALS } from './roofs.js';
import { GEO } from './geodata.js';
import { pavedPlazaRects, parkTreeSites, railClearance, sidewalkBlocks } from './city-grid.js';

// js/buildings.js
// Generates the city's generic blocks of buildings (city-config.js BLOCKS), indexed by a spatial 2D quadtree that
// streams high-detail architectural elements (stone cornices, brick chimney stacks, roof skylights, mechanical
// penthouses on modern roofs, balconies, shop awnings, storefront signs and renovation scaffolding) around the player.
//
// Each lot rect is laid out as a Poznań perimeter block: a corner house (narożnik, often with a turret) wherever two
// street frontages meet at a vertex of the block outline, rows of kamienice along every street frontage with their
// oficyny (rear wings) reaching back around the courtyard, the courtyard itself left as yard. District profiles swap in
// the Stary Rynek's narrow pastel houses, the Dzielnica Cesarska's monumental sandstone blocks, offices round Rondo
// Kaponiera and Plac Andersa, villas, works and the osiedle panel slabs. Footprints are rectilinear plans (courts,
// U / L / ring plans, notched towers) built as unions of non-overlapping boxes; pitched roofs are carried as specs on
// the parts they cover (see commit), the boxes stop at the eaves.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUARTER_TURN = Math.PI / 2;
// Difference of two turned-rectangle angles, wrapped to (-45°, 45°]: a rectangle turned by θ + k·90° is the same
// rectangle. Street frames and OSM minimum-area rectangles are both modulo 90°.
const wrapQuarter = (a) => ((((a + Math.PI / 4) % QUARTER_TURN) + QUARTER_TURN) % QUARTER_TURN) - Math.PI / 4;
// OSM minimum-area rectangles carry 1-3° of noise from stepped walls and bays; a building whose plan is genuinely
// 5°+ off every street frame keeps its real turn (swinging a 60-100 m hall round by 10° moves whole frontages).
const OBJECT_FRAME_SNAP = 3 * Math.PI / 180;
// The dense perimeter districts keep the 4d14df9 layout (the user's reference: kamienice rows with oficyny and
// courtyards). The later anchors, mapped objects, fallback lots and programme profiles cut their street walls into
// fragments: interior angles per quarter 1.71 -> 1.96, the 0-16 m street band 32.3 -> 26.8 % built. Główna keeps the
// current path (60 % lowrise carpets and rail yards at 4d14df9).
const LEGACY_LAYOUT_DISTRICTS = new Set(['Stare Miasto', 'Jeżyce', 'Łazarz', 'Wilda', 'Stare Winogrady']);
// The only GEO.blockObjects built inside the legacy districts, each with its exact oriented reserve
// (objectReserveBoxes), so it replaces the generic lots under its own plan and nowhere else. Matched by the object
// centre (within LEGACY_OBJECT_MATCH m), not by block id, so a geodata rebuild that renumbers blocks keeps the list.
// No heuristic: every other mapped object in these districts is laid out as the 4d14df9 kamienice.
const LEGACY_OBJECTS = [
  // Plac Wiosny Ludów 2: the six-storey L-plan model (kupiecBlock), 101 x 63.7 m envelope on block 792
  { name: 'Kupiec Poznański', x: -128.5, z: 364.2 },
  // Królowej Jadwigi 43 and 27/39 opposite Karmelicka (9aa2dba): an office block and a sports complex of 112 x 56 and
  // 111 x 24 m standing on Wilda's park block 939, which has no kamienica frontage there to tear
  { name: 'Biurowiec Maraton', x: -183.9, z: 1057.1 },
  { name: 'AWF Królowej Jadwigi', x: -56.5, z: 1068 },
  // The five-storey corner house at Podgórna/Plac Wiosny Ludów on block 770 (way 365954909, 239 m²): a 4 m reserve
  // cell in the corner of the Podgórna frontage, which the 4d14df9 lots left as a gap
  { name: 'Podgórna corner house', x: -151.9, z: 305.4 }
];
const LEGACY_OBJECT_MATCH = 2;

/**
 * Spatial 2D quadtree for range queries around the active player/camera position.
 */
class Quadtree {
  constructor(bounds, capacity = 6, maxDepth = 6, depth = 0) {
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.items = [];
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  containsPoint(x, z) {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  intersectsCircle(cx, cz, radius) {
    const b = this.bounds;
    const closestX = Math.max(b.minX, Math.min(cx, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return (dx * dx + dz * dz) <= (radius * radius);
  }

  subdivide() {
    const b = this.bounds;
    const midX = (b.minX + b.maxX) * 0.5;
    const midZ = (b.minZ + b.maxZ) * 0.5;
    const nextDepth = this.depth + 1;

    this.nw = new Quadtree({ minX: b.minX, maxX: midX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.ne = new Quadtree({ minX: midX, maxX: b.maxX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.sw = new Quadtree({ minX: b.minX, maxX: midX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.se = new Quadtree({ minX: midX, maxX: b.maxX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.divided = true;

    for (const item of this.items) {
      this._insertIntoChildren(item);
    }
    this.items.length = 0;
  }

  _insertIntoChildren(item) {
    if (this.nw.containsPoint(item.cx, item.cz)) return this.nw.insert(item);
    if (this.ne.containsPoint(item.cx, item.cz)) return this.ne.insert(item);
    if (this.sw.containsPoint(item.cx, item.cz)) return this.sw.insert(item);
    if (this.se.containsPoint(item.cx, item.cz)) return this.se.insert(item);
    return false;
  }

  insert(item) {
    if (!this.containsPoint(item.cx, item.cz)) return false;

    if (!this.divided) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(item);
        return true;
      }
      this.subdivide();
    }
    return this._insertIntoChildren(item);
  }

  queryRange(cx, cz, radius, found = []) {
    if (!this.intersectsCircle(cx, cz, radius)) return found;

    const rSq = radius * radius;
    if (!this.divided) {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const dx = item.cx - cx;
        const dz = item.cz - cz;
        if (dx * dx + dz * dz <= rSq) {
          found.push(item);
        }
      }
      return found;
    }

    this.nw.queryRange(cx, cz, radius, found);
    this.ne.queryRange(cx, cz, radius, found);
    this.sw.queryRange(cx, cz, radius, found);
    this.se.queryRange(cx, cz, radius, found);
    return found;
  }
}

/**
 * Quadtree over the centres of `items` ({ id, cx, cz }), bounded by their own extent plus `margin`. CITY_BOUNDS is
 * not enough: a lot turned to its street frame can reach well past the detail box, and on 2026-11-10 two halls on the
 * southern edge (Chartowo_4139_2917, Rataje_824_2918, centres 23-24 m past maxZ + 50) were refused by a CITY_BOUNDS
 * tree and never streamed their skylights and HVAC. Only a non-finite centre can still miss; it is reported, not
 * dropped silently.
 */
function createDetailQuadtree(items, margin = 50) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const it of items) {
    if (!Number.isFinite(it.cx) || !Number.isFinite(it.cz)) continue;
    minX = Math.min(minX, it.cx); maxX = Math.max(maxX, it.cx);
    minZ = Math.min(minZ, it.cz); maxZ = Math.max(maxZ, it.cz);
  }
  if (minX > maxX) minX = maxX = minZ = maxZ = 0;
  const bounds = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
  const tree = new Quadtree(bounds, 6, 9);
  const refused = [];
  for (const it of items) {
    if (!tree.insert(it)) refused.push(it.id);
  }
  if (refused.length) {
    console.warn(`buildings: ${refused.length} block details outside the quadtree: ${refused.join(', ')}`);
  }
  return tree;
}

// ============================================================================
// RECTILINEAR FOOTPRINTS: plans as unions of non-overlapping axis-aligned rects { x0, x1, z0, z1 }
// (x runs west → east, z north → south)
// ============================================================================
const EPS = 0.05;
const OPPOSITE = { n: 's', s: 'n', w: 'e', e: 'w' };
const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
const rectW = (r) => r.x1 - r.x0;
const rectD = (r) => r.z1 - r.z0;
const insetAll = (r, d) => rect(r.x0 + d, r.x1 - d, r.z0 + d, r.z1 - d);

// Length of side `s` of rect r, and the rect's extent perpendicular to it
const sideLen = (r, s) => (s === 'n' || s === 's' ? r.x1 - r.x0 : r.z1 - r.z0);
const sideDepth = (r, s) => (s === 'n' || s === 's' ? r.z1 - r.z0 : r.x1 - r.x0);

/** Rect in the frame of side `s` of r: `a` runs along that side (from its west / north end), `b` inward from it */
function sideRect(r, s, a0, a1, b0, b1) {
  if (s === 'n') return rect(r.x0 + a0, r.x0 + a1, r.z0 + b0, r.z0 + b1);
  if (s === 's') return rect(r.x0 + a0, r.x0 + a1, r.z1 - b1, r.z1 - b0);
  if (s === 'w') return rect(r.x0 + b0, r.x0 + b1, r.z0 + a0, r.z0 + a1);
  return rect(r.x1 - b1, r.x1 - b0, r.z0 + a0, r.z0 + a1);
}

/** Light court `cw` wide and `cd` deep, cut into the middle of side `s` (shifted `off` along it) */
function courtHole(r, s, cw, cd, off = 0) {
  const L = sideLen(r, s);
  return sideRect(r, s, (L - cw) * 0.5 + off, (L + cw) * 0.5 + off, -1, cd);
}

/** Notches nx (along x) by nz (along z) cut from the given corners of r */
function cornerHoles(r, nx, nz, corners = ['nw', 'ne', 'sw', 'se']) {
  return corners.map((c) => {
    const x0 = c[1] === 'w' ? r.x0 - 1 : r.x1 - nx;
    const z0 = c[0] === 'n' ? r.z0 - 1 : r.z1 - nz;
    return rect(x0, x0 + nx + 1, z0, z0 + nz + 1);
  });
}

/**
 * `r` minus `holes`, as non-overlapping rects: sliced into strips across `axis` ('x': strips running north-south,
 * 'z': strips running east-west) at every hole edge, neighbouring strips with identical spans merged back, so a
 * U-plan comes out as its base bar plus two wings. Slice so the street front stays one piece (one window grid).
 */
function carve(r, holes, axis = 'x') {
  const flip = axis === 'z';
  const U0 = flip ? r.z0 : r.x0;
  const U1 = flip ? r.z1 : r.x1;
  const V0 = flip ? r.x0 : r.z0;
  const V1 = flip ? r.x1 : r.z1;
  const hs = holes.map((h) => (flip ? [h.z0, h.z1, h.x0, h.x1] : [h.x0, h.x1, h.z0, h.z1]));
  const cuts = [U0, U1];
  for (const [u0, u1] of hs) {
    if (u0 > U0 + EPS && u0 < U1 - EPS) cuts.push(u0);
    if (u1 > U0 + EPS && u1 < U1 - EPS) cuts.push(u1);
  }
  cuts.sort((a, b) => a - b);

  const out = [];
  let open = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const ua = cuts[i];
    const ub = cuts[i + 1];
    if (ub - ua < EPS) continue;
    const um = (ua + ub) * 0.5;
    let spans = [[V0, V1]];
    for (const [u0, u1, v0, v1] of hs) {
      if (um <= u0 || um >= u1) continue;
      const next = [];
      for (const [a, b] of spans) {
        if (v1 <= a + EPS || v0 >= b - EPS) {
          next.push([a, b]);
          continue;
        }
        if (v0 > a + EPS) next.push([a, v0]);
        if (v1 < b - EPS) next.push([v1, b]);
      }
      spans = next;
    }
    const nextOpen = [];
    for (const [a, b] of spans) {
      let strip = open.find((o) => Math.abs(o[2] - a) < EPS && Math.abs(o[3] - b) < EPS);
      if (strip) {
        strip[1] = ub;
      } else {
        strip = [ua, ub, a, b];
        out.push(strip);
      }
      nextOpen.push(strip);
    }
    open = nextOpen;
  }
  return out.map(([u0, u1, v0, v1]) => (flip ? rect(v0, v1, u0, u1) : rect(u0, u1, v0, v1)));
}

// Ground-floor shop fronts: one canvas awning and the illuminated fascia sign above it, built from a blk.awnings
// entry { x, y, z, w, d, nx, nz, ry }. The geometry lives here so the overlap resolver checks exactly the boxes the
// instanced meshes draw, in world axes (placeInFrame has already turned x / z and stored the frame's ry).
const SHOP_AWNING_H = 0.75;
const SHOP_SIGN_H = 0.86;
const SHOP_SIGN_Y = 4.68;
const SHOP_SIGN_BACK = 0.75; // sign centre 0.75 m behind the awning centre: 0.15 m proud of the wall
const SHOP_SIGN_THICKNESS = 0.28;
const SHOP_CLEARANCE = 0.15; // air kept between neighbouring shop fronts after a trim (m)
const SHOP_MIN_LENGTH = 2.0; // a front trimmed below this length is dropped instead (m)
const SHOP_CELL = 12; // collision hash cell (m)

function shopBox(cx, cz, ry, hx, hz, y0, y1) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return { cx, cz, ax: c, az: -s, bx: s, bz: c, hx, hz, y0, y1 };
}

/** World boxes of the awning and of the fascia sign above it for one blk.awnings entry. */
function shopFrontBoxes(a, ry) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const ox = a.nx * c + a.nz * s; // wall normal turned into the world
  const oz = a.nz * c - a.nx * s;
  const awning = shopBox(a.x, a.z, ry, a.w * 0.5, a.d * 0.5,
    a.y - SHOP_AWNING_H * 0.5, a.y + SHOP_AWNING_H * 0.5);
  const sign = shopBox(a.x - ox * SHOP_SIGN_BACK, a.z - oz * SHOP_SIGN_BACK, ry,
    a.nx !== 0 ? SHOP_SIGN_THICKNESS * 0.5 : a.w * 0.46,
    a.nx !== 0 ? a.d * 0.46 : SHOP_SIGN_THICKNESS * 0.5,
    SHOP_SIGN_Y - SHOP_SIGN_H * 0.5, SHOP_SIGN_Y + SHOP_SIGN_H * 0.5);
  return { awning, sign };
}

const boxRadius = (b, nx, nz) => b.hx * Math.abs(b.ax * nx + b.az * nz) + b.hz * Math.abs(b.bx * nx + b.bz * nz);

/** Separating-axis test of two yawed boxes, after their y ranges reject most pairs. */
function boxesOverlap(a, b) {
  if (a.y1 <= b.y0 || b.y1 <= a.y0) return false;
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const axes = [[a.ax, a.az], [a.bx, a.bz], [b.ax, b.az], [b.bx, b.bz]];
  for (const [nx, nz] of axes) {
    if (Math.abs(dx * nx + dz * nz) >= boxRadius(a, nx, nz) + boxRadius(b, nx, nz)) return false;
  }
  return true;
}

/** True when two shop fronts (awning plus fascia sign) intersect in world space. */
function shopFrontsOverlap(a, ryA, b, ryB) {
  const A = shopFrontBoxes(a, ryA);
  const B = shopFrontBoxes(b, ryB);
  return boxesOverlap(A.awning, B.awning) || boxesOverlap(A.sign, B.sign);
}

function buildCityBlocks(scene) {
  const group = new THREE.Group();
  group.name = 'CityBlocks';
  const colliders = [];

  // Frame of the lots being populated. Irregular blocks come with frontage frames (city-config.js BLOCKS: lots laid
  // out along the streets they front, in a frame turned by θ about p); the generator works in the frame as on a grid
  // block, and everything it emits is turned into place (placeInFrame), so buildings line up with their street.
  let xf = null; // { th, cs, sn, px, pz }
  let minLot = 15; // smallest lot side built on (frontage frames come in lots of 12 m and up, see geo-blocks.mjs)
  let srcBlock = null; // the BLOCKS entry being populated (its curb outline gives the lot rects' frontages)
  let srcAnchors = []; // its GEO.blockAnchors kept for this block (world [x0, x1, z0, z1, area, use, levels])
  let srcObjects = []; // its GEO.blockObjects (same layout, including education/sacral/health/civic/office uses)
  let srcObjectReserves = []; // srcObjects' reserve rects (objectReserveBoxes in Stare Miasto/legacy, else the AABB)
  let srcFallbackLots = []; // its GEO.blockFallbackLots (world [x0, x1, z0, z1, area, ang])
  let srcLegacy = false; // the block is in LEGACY_LAYOUT_DISTRICTS: lots, profile and steering as at 4d14df9
  let srcRects = []; // its lot rects { x0, x1, z0, z1 } in their frames { cs, sn, px, pz } (see frontages)
  let srcLotArea = 0; // the area of the lot pieces it builds on (m², see steerProfile)
  let fullLotArea = 0; // lot area before park carve-out (m², see steerProfile)
  // Offices steer their interior courts against the block's real OSM share: commit() adds every ground footprint to
  // srcBuiltArea, populateBlock sets a per-piece budget from what the block's built share has left, and officeBlock
  // spends it on frontage slabs first and then on the courtyard core (see officeCore). Without it the office layout
  // built 13.6% of block 816 against 37% real and 33.4% of 868 against 57%.
  let srcBuiltArea = 0; // ground footprint area committed in the current block (m²)
  let srcLeftArea = 0; // lot area of the pieces still to populate (m²)
  let srcTarget = 0; // the block's real built area (m², steerProfile's T × BLOCKS[i].area)
  let srcObjectArea = 0; // mapped objects committed before the generic pieces (their area was removed from the lots)
  let srcPieceBudget = 0; // the current piece's share of the unspent target (m²)
  const toWorld = (x, z) => (xf
    ? [xf.px + (x - xf.px) * xf.cs + (z - xf.pz) * xf.sn, xf.pz - (x - xf.px) * xf.sn + (z - xf.pz) * xf.cs]
    : [x, z]);
  const toFrame = (th, px, pz, x, z) => {
    const cs = Math.cos(th), sn = Math.sin(th);
    return [px + (x - px) * cs - (z - pz) * sn, pz + (x - px) * sn + (z - pz) * cs];
  };
  // An OSM object is built with its world long axis at `-th` (populateObject). A block with frontage frames has the
  // street directions its lots are laid along; snap the object to the nearest one (modulo 90°, since a turned
  // rectangle is the same at θ + k·π/2). Without this, the 1-3° noise of an OSM minimum-area rectangle left mapped
  // schools, churches and offices visibly a few degrees off their neighbours' street wall. A mapped hall more than 3°
  // off every frame keeps its OSM turn: forcing it round would swing 30-90 m of wall out of the frontage (block 877's
  // church and school lost 34 Strzelecka stations); 132 central details stay off-frame this way.
  function snappedObjectAngle(o) {
    const raw = -o[4];
    if (!srcBlock || !srcBlock.frames) return raw;
    let best = raw, bestD = Infinity;
    for (const [th] of srcBlock.frames) {
      const d = wrapQuarter(raw - th);
      if (Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = raw - d;
      }
    }
    return bestD <= OBJECT_FRAME_SNAP ? best : raw;
  }
  // The frontage frame a fallback envelope belongs to. Frames share the block centre and their lot rects can overlap,
  // so a nearest-rect choice sent an Ogrodowa frontage lot to an internal courtyard frame 27° off the street. The
  // fallback's own OSM minimum-area angle is the building's real wall direction: snap to the nearest frame when it is
  // within 12°, but use the building's own turn for one already on a world-axis street that this block's frames do
  // not model (Ogrodowa in block 802). Older data without the angle falls back to the nearest outline edge.
  const FRAME_SNAP = 12 * Math.PI / 180;
  const AXIS_SNAP = 7 * Math.PI / 180;
  function fallbackFrame(f, e) {
    if (!srcBlock || !srcBlock.frames || !srcBlock.frames.length) return null;
    let nearest = null, bestD = Infinity;
    if (f.length > 5 && Number.isFinite(f[5])) {
      const raw = -f[5];
      for (const [th, px, pz] of srcBlock.frames) {
        const d = Math.abs(wrapQuarter(raw - th));
        if (d < bestD) {
          bestD = d;
          nearest = { th, cs: Math.cos(th), sn: Math.sin(th), px, pz };
        }
      }
      if (bestD > FRAME_SNAP && Math.abs(wrapQuarter(raw)) <= AXIS_SNAP) {
        // No block frame models this building's street (Ogrodowa runs at 0° through block 802's 20° frames); use the
        // OSM turn itself around the envelope centre instead of leaving the lot unrotated and reported as ry = 0.
        const mx = (e[0] + e[1]) * 0.5, mz = (e[2] + e[3]) * 0.5;
        return { th: raw, cs: Math.cos(raw), sn: Math.sin(raw), px: mx, pz: mz };
      }
      return nearest;
    }
    if (!srcBlock.poly || srcBlock.poly.length < 3) return null;
    const cx = (e[0] + e[1]) * 0.5, cz = (e[2] + e[3]) * 0.5;
    let edgeAngle = 0, edgeD = Infinity;
    for (let i = 0, j = srcBlock.poly.length - 1; i < srcBlock.poly.length; j = i++) {
      const a = srcBlock.poly[j], b = srcBlock.poly[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const L2 = dx * dx + dz * dz;
      if (L2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cz - a.z) * dz) / L2));
      const d = Math.hypot(a.x + t * dx - cx, a.z + t * dz - cz);
      if (d < edgeD) {
        edgeD = d;
        edgeAngle = Math.atan2(dz, dx);
      }
    }
    const target = -edgeAngle;
    let best = null, bestA = Infinity;
    for (const [th, px, pz] of srcBlock.frames) {
      const d = Math.abs(wrapQuarter(th - target));
      if (d < bestA) {
        bestA = d;
        best = { th, cs: Math.cos(th), sn: Math.sin(th), px, pz };
      }
    }
    return best;
  }
  // A world-axis fallback envelope turned into its frontage frame, keeping the envelope's own width and depth (so it
  // does not grow through the corners of a frame AABB). A frame a quarter turn off swaps them, which is the same
  // rectangle.
  function fallbackLocalRect(e, frame) {
    if (!frame) return e;
    const bw = e[1] - e[0], bd = e[3] - e[2];
    const [lx, lz] = toFrame(frame.th, frame.px, frame.pz, (e[0] + e[1]) * 0.5, (e[2] + e[3]) * 0.5);
    const swap = Math.abs(frame.sn) > Math.abs(frame.cs);
    const w = swap ? bd : bw, d = swap ? bw : bd;
    return [lx - w * 0.5, lx + w * 0.5, lz - d * 0.5, lz + d * 0.5];
  }
  // Player collider over the rect [x0, x1] x [z0, z1] (of the current frame): an oriented box inside its world AABB
  function pushCollider(x0, x1, z0, z1, minY, maxY) {
    if (!xf) {
      colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY, maxY });
      return;
    }
    const [cx, cz] = toWorld((x0 + x1) * 0.5, (z0 + z1) * 0.5);
    const hx = (x1 - x0) * 0.5;
    const hz = (z1 - z0) * 0.5;
    const ex = Math.abs(xf.cs) * hx + Math.abs(xf.sn) * hz;
    const ez = Math.abs(xf.sn) * hx + Math.abs(xf.cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, obb: { cx, cz, hx, hz, cs: xf.cs, sn: xf.sn } });
  }

  // Re-seeded from each block's position (see populateBlock), so every block is reproducible on its own
  let rand = mulberry32(10019);
  const range = (a, b) => a + (b - a) * rand();
  const irange = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const chance = (p) => rand() < p;
  const pick = (items) => items[Math.floor(rand() * items.length)];
  // Weighted pick from [[value, weight], ...]
  function pickW(table) {
    let total = 0;
    for (const e of table) total += e[1];
    let r = rand() * total;
    for (const e of table) {
      r -= e[1];
      if (r < 0) return e[0];
    }
    return table[table.length - 1][0];
  }

  // Every block detail; the streaming quadtree is built over them once they all exist (createDetailQuadtree)
  const allBlocks = [];

  // Facade materials, by name (F) into `facades`. Every masonry style is the one pre-war shader with its colours as
  // uniforms (createPreWarBuildingMaterial caches by options), so the palette costs draw calls, not pipelines.
  // Storey heights: kamienice 3.7-3.8 m (Poznań's 1880-1914 houses run 3.6-4.0 m floor to floor), the Rynek's older
  // houses 3.6 m, the Dzielnica Cesarska's public buildings 4.4 m, panel blocks 2.8 m, offices 3.8-4.1 m.
  const F = {
    ochre: 0, cream: 1, greyGreen: 2, salmon: 3, brick: 4, yellowBrick: 5, sandstone: 6,
    rose: 7, mint: 8, sky: 9, lemon: 10, panel: 11, glassTeal: 12, glassBronze: 13, glassSilver: 14,
    panelCream: 15, panelBlue: 16, panelOchre: 17, panelGreen: 18
  };
  const plaster = (stoneColor, trimColor, seed) => [createPreWarBuildingMaterial, {
    stoneColor, trimColor, windowGlassColor: 0x18242f, windowWidth: 2.3, floorHeight: 3.8, litProbability: 0.55, warmth: 0.84, seed
  }, 'masonry'];
  const pastel = (stoneColor, seed) => [createPreWarBuildingMaterial, {
    stoneColor, trimColor: 0xf1eadb, windowGlassColor: 0x17222c, windowWidth: 1.9, floorHeight: 3.6, litProbability: 0.6, warmth: 0.9, seed
  }, 'masonry'];
  // Panel slabs: one pipeline for every colour (createPanelBlockMaterial keeps them in uniforms); floorHeight must stay
  // in the options, `storeys` below reads it
  const panel = (opts) => [
    createPanelBlockMaterial, { floorHeight: 2.8, litProbability: 0.62, warmth: 0.8, ...opts }, 'panel'
  ];
  // Every panel colour, weighted: grey and cream concrete, and the repainted ones
  const PANELS = [[F.panel, 3], [F.panelCream, 2], [F.panelBlue, 1], [F.panelOchre, 1], [F.panelGreen, 1]];
  const facades = [
    plaster(0xcfa25e, 0xefe2c4, 12.4), // ochre render with cream stucco (Jeżyce, Łazarz)
    plaster(0xe3d8bd, 0xa89c84, 17.1), // cream
    plaster(0xa8b19a, 0xe4e0d0, 23.6), // grey-green
    plaster(0xd49c84, 0xf0e4d0, 31.9), // salmon
    // Red clinker brick with sandstone dressings (Wilda, the works, Garbary's warehouses)
    [createPreWarBuildingMaterial, {
      stoneColor: 0x9c4a38, trimColor: 0xd6c6a8, windowGlassColor: 0x16222e, windowWidth: 2.3, floorHeight: 3.7,
      litProbability: 0.56, warmth: 0.86, seed: 27.8
    }, 'masonry'],
    // Yellow brick with red-brick bands (Wilda)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xc8a466, trimColor: 0x8c5a3e, windowGlassColor: 0x16222e, windowWidth: 2.3, floorHeight: 3.7,
      litProbability: 0.56, warmth: 0.86, seed: 36.2
    }, 'masonry'],
    // Grey sandstone (the Dzielnica Cesarska's public buildings and grander kamienice)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xb4afa2, trimColor: 0x8a8578, windowGlassColor: 0x1a2836, windowWidth: 2.8, floorHeight: 4.4,
      litProbability: 0.48, warmth: 0.78, seed: 44.5
    }, 'masonry'],
    pastel(0xe4aaa0, 51.3), // Stary Rynek polychrome: rose
    pastel(0xa9caa6, 57.8), // mint
    pastel(0xa2c0d6, 62.1), // sky blue
    pastel(0xe9d283, 68.4), // lemon
    // Wielka płyta (panel joints, loggia stacks), 2.8 m storeys: 5 / 11 / 16 storeys = 14 / 31 / 45 m. Grey concrete
    // here, the cream and repainted (insulated, coloured accent bands) slabs after the glass
    panel({ panelColor: 0xbdbab2, seed: 73.7 }),
    // Curtain-wall offices: blue-teal, dark bronze, silver
    [createCurtainWallMaterial, {
      glassTint: 0x1a3a52, frameTint: 0x3b4c5b, windowWidth: 2.7, floorHeight: 3.9, litProbability: 0.60, warmth: 0.52,
      reflectivity: 0.92, seed: 63.5
    }, 'glass'],
    [createCurtainWallMaterial, {
      glassTint: 0x242220, frameTint: 0x3c3631, windowWidth: 2.5, floorHeight: 3.8, litProbability: 0.64, warmth: 0.72,
      reflectivity: 0.88, seed: 81.9
    }, 'glass'],
    [createCurtainWallMaterial, {
      glassTint: 0x264664, frameTint: 0xb0bcc8, windowWidth: 2.9, floorHeight: 4.1, litProbability: 0.58, warmth: 0.48,
      reflectivity: 0.95, seed: 94.3
    }, 'glass'],
    panel({ panelColor: 0xd9cfb4, seed: 76.1 }), // cream
    // Insulated & repainted (termomodernizacja): pale render with blue, ochre or green accent bands
    panel({ panelColor: 0xe6e1d6, accentColor: 0x9fb8c9, bandAccent: 0.7, seed: 78.4 }),
    panel({ panelColor: 0xe6e1d6, accentColor: 0xd8a86b, bandAccent: 0.7, seed: 82.6 }),
    panel({ panelColor: 0xe6e1d6, accentColor: 0x9cbf8e, bandAccent: 0.7, seed: 85.2 })
  ];
  const materials = facades.map(([create, opts]) => create({ ...opts, boxLocal: true }));
  // Storey height of each facade: buildings are massed in whole storeys so every window row lines up across tiers
  const storeys = facades.map(([, opts]) => opts.floorHeight);
  const isMasonry = (m) => facades[m][2] === 'masonry';
  const isGlass = (m) => facades[m][2] === 'glass';
  const GLASS = [[F.glassTeal, 3], [F.glassSilver, 3], [F.glassBronze, 1]];

  const buckets = materials.map(() => []);

  // Pitched roofs (roofs.js): red tile on the kamienice and the Rynek, slate on the grander houses and public
  // buildings, copper on turrets, risalits and domes. One shader and one material for all three (the kind is a
  // per-instance attribute), so each unit piece is one mesh rather than three; the gable ends are render. Staged by
  // commit, written once by finish() below
  const roofMaterial = createRoofMaterial({ kinds: ROOF_MATERIALS });
  let roofs = createRoofs({
    materials: {
      tile: roofMaterial,
      slate: roofMaterial,
      copper: roofMaterial,
      window: createDormerWindowMaterial(),
      gable: createGableScreenMaterial()
    },
    parent: group
  });

  // ============================================================================
  // BUILDING MASSING TOOLKIT
  // A building is a list of non-overlapping parts { x0, x1, z0, z1, y0, y1, roof? } on one lot: footprints carved into
  // plans, extruded storey by storey, tiers stacked on whole storeys
  // ============================================================================
  // Bridge decks and overpasses (city-config.js BRIDGES: the GEO.roadGraph links flagged bridge, flags bit 0, chained
  // per name): no building may stand on a deck or within 3 m of it. Oriented boxes { cx, cz, ux, uz, hl, hw } (u = along
  // the deck), one per link segment, run 4 m past its ends so the abutments stay clear too.
  const bridgeCorridors = [];
  for (const bridge of BRIDGES) {
    for (const link of bridge.links) {
      for (let i = 0; i + 1 < link.pts.length; i++) {
        const a = link.pts[i];
        const c = link.pts[i + 1];
        const L = Math.hypot(c.x - a.x, c.z - a.z);
        if (L < 0.1) continue;
        const ux = (c.x - a.x) / L, uz = (c.z - a.z) / L;
        const hl = L * 0.5 + 4, hw = link.width * 0.5 + 3;
        // world AABB of the oriented corridor box (1 µm of grace), for the cheap reject before the exact test
        const rx = Math.abs(ux) * hl + Math.abs(uz) * hw + 1e-6;
        const rz = Math.abs(uz) * hl + Math.abs(ux) * hw + 1e-6;
        const cx = (a.x + c.x) * 0.5, cz = (a.z + c.z) * 0.5;
        bridgeCorridors.push({ cx, cz, ux, uz, hl, hw, minX: cx - rx, maxX: cx + rx, minZ: cz - rz, maxZ: cz + rz });
      }
    }
  }
  // Separating-axis test of the rect [x0, x1] x [z0, z1] (of the current frame) against every corridor box. The rect's
  // world AABB rejects the far corridors first: 51,899 calls against 85 corridors made 4.4 M full SAT tests in the
  // 2026-11-11 headless block build, while no lot ever touched one (0 hits in the same build).
  function hitsBridgeCorridor(x0, x1, z0, z1) {
    const hx = (x1 - x0) * 0.5;
    const hz = (z1 - z0) * 0.5;
    const [cx, cz] = toWorld(x0 + hx, z0 + hz);
    // the rect's axes in the world (R_y(θ) of local x and z)
    const ax = xf ? xf.cs : 1, az = xf ? -xf.sn : 0;
    const bx = xf ? xf.sn : 0, bz = xf ? xf.cs : 1;
    const rx = Math.abs(ax) * hx + Math.abs(bx) * hz;
    const rz = Math.abs(az) * hx + Math.abs(bz) * hz;
    for (const o of bridgeCorridors) {
      if (cx + rx < o.minX || cx - rx > o.maxX || cz + rz < o.minZ || cz - rz > o.maxZ) continue;
      const dx = cx - o.cx;
      const dz = cz - o.cz;
      const vx = -o.uz, vz = o.ux;
      let apart = false;
      for (const [nx, nz] of [[ax, az], [bx, bz], [o.ux, o.uz], [vx, vz]]) {
        const r = hx * Math.abs(ax * nx + az * nz) + hz * Math.abs(bx * nx + bz * nz) +
          o.hl * Math.abs(o.ux * nx + o.uz * nz) + o.hw * Math.abs(vx * nx + vz * nz);
        if (Math.abs(dx * nx + dz * nz) >= r) { apart = true; break; }
      }
      if (!apart) return true;
    }
    return false;
  }

  const SIDES = ['n', 's', 'w', 'e'];
  // Coordinate of rect r's `side` wall
  const wallAt = (r, side) => (side === 'n' ? r.z0 : side === 's' ? r.z1 : side === 'w' ? r.x0 : r.x1);

  function building(blk, mat, lot) {
    const f = blk.front;
    return {
      mat,
      lot,
      parts: [],
      // Lot sides on a street frontage of the block (see frontages); the others are party walls / rear lot lines
      // shared with neighbours or the courtyard
      street: {
        n: f.n && lot.z0 - blk.minZ < EPS,
        s: f.s && blk.maxZ - lot.z1 < EPS,
        w: f.w && lot.x0 - blk.minX < EPS,
        e: f.e && blk.maxX - lot.x1 < EPS
      }
    };
  }

  // Extrude footprint `rects` from storey f0 up to storey f1; returns the parts added (to hang a roof spec on)
  function mass(b, rects, f0, f1) {
    const added = [];
    if (f1 <= f0) return added;
    const s = storeys[b.mat];
    for (const r of rects) {
      if (r.x1 - r.x0 < 0.5 || r.z1 - r.z0 < 0.5) continue;
      const p = { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y0: f0 * s, y1: f1 * s };
      b.parts.push(p);
      added.push(p);
    }
    return added;
  }

  // Pitched roof over `parts` (see commit for the spec): `ridge` is the ridge's axis in the lot frame, `pitchDeg` the
  // slope of a gable or hip (Poznań kamienice 30-45°, the Rynek's steep gables ~50°). A mansard's rise is its attic
  // storey; the others rise half the span times tan(pitch), capped at 7 m so a deep block doesn't grow a barn roof
  const DEG = Math.PI / 180;
  function pitch(parts, shape, mat, ridge, pitchDeg = 38) {
    for (const p of parts) {
      const span = ridge === 'x' ? p.z1 - p.z0 : p.x1 - p.x0;
      const rise = shape === 'mansard' ? 3.2 : Math.min(7, span * 0.5 * Math.tan(pitchDeg * DEG));
      p.roof = { shape, mat, ridge, rise: Math.round(rise * 100) / 100 };
    }
  }
  // Ridge axis of a roof running along the street on `side` (n/s fronts run along x)
  const alongRidge = (side) => (side === 'n' || side === 's' ? 'x' : 'z');
  const acrossRidge = (side) => (side === 'n' || side === 's' ? 'z' : 'x');

  // `r` pulled back `d` from the lot's street sides (and `party` from its party walls): setbacks
  function streetInset(b, r, d, party = 0) {
    const s = b.street;
    return rect(r.x0 + (s.w ? d : party), r.x1 - (s.e ? d : party), r.z0 + (s.n ? d : party), r.z1 - (s.s ? d : party));
  }

  // How far part p's cornice reaches past its `side` wall: `oh` out into open air, flush against parts of the same
  // building rising past it, tucked just inside party walls (a neighbour's own ledge may run at the same height)
  function corniceReach(b, p, side, oh) {
    const alongX = side === 'n' || side === 's';
    const c = wallAt(p, side);
    const edge = wallAt(b.lot, side);
    if (Math.abs(c - edge) < EPS && !b.street[side]) return -0.03;
    for (const q of b.parts) {
      if (q === p || q.y1 < p.y1 - EPS || q.y0 > p.y1 - EPS) continue;
      const qc = side === 'n' ? q.z1 : side === 's' ? q.z0 : side === 'w' ? q.x1 : q.x0;
      if (Math.abs(qc - c) > EPS) continue;
      if (alongX ? (q.x0 < p.x1 - EPS && q.x1 > p.x0 + EPS) : (q.z0 < p.z1 - EPS && q.z1 > p.z0 + EPS)) return 0;
    }
    return oh;
  }

  // The spans of [a0, a1] left after removing the `cuts` ([c0, c1] pairs)
  function spanMinus(a0, a1, cuts) {
    let spans = [[a0, a1]];
    for (const [c0, c1] of cuts) {
      const next = [];
      for (const [s0, s1] of spans) {
        if (c1 <= s0 + EPS || c0 >= s1 - EPS) {
          next.push([s0, s1]);
          continue;
        }
        if (c0 > s0 + EPS) next.push([s0, c0]);
        if (c1 < s1 - EPS) next.push([c1, s1]);
      }
      spans = next;
    }
    return spans;
  }
  const spanLen = (spans) => spans.reduce((t, [s0, s1]) => t + s1 - s0, 0);

  // What part p's `side` wall looks out on: the spans of it not hidden by parts of the same building built flush
  // against it, and how much of those the building's own wings screen across a court or light well
  function wallView(b, p, side) {
    const alongX = side === 'n' || side === 's';
    const c = wallAt(p, side);
    const flush = [];
    const across = [];
    for (const q of b.parts) {
      if (q === p || q.y1 < p.y0 + EPS || q.y0 > p.y1 - EPS) continue;
      const qc = side === 'n' ? q.z1 : side === 's' ? q.z0 : side === 'w' ? q.x1 : q.x0;
      const gap = side === 'n' || side === 'w' ? c - qc : qc - c;
      if (gap < -EPS) continue; // beside or behind the wall
      (gap < EPS ? flush : across).push(alongX ? [q.x0, q.x1] : [q.z0, q.z1]);
    }
    const visible = spanMinus(alongX ? p.x0 : p.z0, alongX ? p.x1 : p.z1, flush);
    const open = visible.flatMap(([s0, s1]) => spanMinus(s0, s1, across));
    return { visible, screened: spanLen(visible) - spanLen(open) };
  }

  // Facade treatment of each wall of part p, in createFacadeBoxes `faces` order (w, e, n, s). Street fronts (the lot
  // fronts a street there and the building's own wings don't screen most of the wall) get storefronts (`shops[side]`)
  // or a residential entrance, and so do the side walls of courts open to the street; walls on the lot lines shared
  // with neighbours stay windowless; the rest are courtyard, oficyna & light-well walls. A `freestanding` building
  // (villas, osiedle slabs) fronts every way; `o.walls` forces one WALL_KINDS everywhere.
  function wallKinds(b, p, shops, o) {
    if (o.walls !== undefined) return [o.walls, o.walls, o.walls, o.walls];
    const front = (side) => (shops[side] ? WALL_KINDS.shop : WALL_KINDS.entry);
    return ['w', 'e', 'n', 's'].map((side) => {
      if (o.freestanding) return front(side);
      const { visible, screened } = wallView(b, p, side);
      if (b.street[side] && screened < spanLen(visible) * 0.5) return front(side);
      const c = wallAt(p, side);
      const edge = wallAt(b.lot, side);
      if (!b.street[side] && Math.abs(c - edge) < EPS) return WALL_KINDS.lotLine; // (see openOntoVoidLots)
      // A court wall reaching the street line belongs to a court open to the street
      const alongX = side === 'n' || side === 's';
      const [e0, e1, s0, s1] = alongX ? [b.lot.x0, b.lot.x1, b.street.w, b.street.e] : [b.lot.z0, b.lot.z1, b.street.n, b.street.s];
      const onStreet = visible.some(([a, z]) => (s0 && a - e0 < EPS) || (s1 && e1 - z < EPS));
      return screened > EPS && onStreet ? WALL_KINDS.entry : WALL_KINDS.rear;
    });
  }

  // The 4d14df9 frontage frames follow the lot raster, not the curb: on a bend a frame corner crosses the kerb, and a
  // legacy kamienica stood on the Strzelecka carriageway at (122.8, 855.2). Trim the building instead of dropping its
  // lot: every side whose probes (fallbackPartClear's rule: roadway and pedestrian corridors >= 0 m, tracks >= 0.5 m)
  // fail moves in by half a metre until all clear, the lot line with it, so the trimmed house keeps its street face
  // and shopfronts and the frontage stays. False when the building would shrink below 3 m (commit leaves the lot void).
  function trimOffStreets(b) {
    const parts = b.parts;
    const cut = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const p of parts) {
      cut.x0 = Math.min(cut.x0, p.x0);
      cut.x1 = Math.max(cut.x1, p.x1);
      cut.z0 = Math.min(cut.z0, p.z0);
      cut.z1 = Math.max(cut.z1, p.z1);
    }
    const full = { ...cut };
    const clear = (lx, lz) => {
      const [x, z] = toWorld(lx, lz);
      return roadClearance(x, z) >= 0 && pedestrianClearance(x, z) >= 0 && railClearance(x, z) >= 0.5;
    };
    for (let it = 0; ; it++) {
      const fails = { x0: 0, x1: 0, z0: 0, z1: 0 };
      let any = false;
      for (const p of parts) {
        const x0 = Math.max(p.x0, cut.x0), x1 = Math.min(p.x1, cut.x1);
        const z0 = Math.max(p.z0, cut.z0), z1 = Math.min(p.z1, cut.z1);
        if (x1 - x0 < EPS || z1 - z0 < EPS) continue;
        const nx = Math.max(1, Math.ceil((x1 - x0) / 2)), nz = Math.max(1, Math.ceil((z1 - z0) / 2));
        const probes = [[(x0 + x1) * 0.5, (z0 + z1) * 0.5]];
        for (let i = 0; i <= nx; i++) probes.push([x0 + ((x1 - x0) * i) / nx, z0], [x0 + ((x1 - x0) * i) / nx, z1]);
        for (let k = 1; k < nz; k++) probes.push([x0, z0 + ((z1 - z0) * k) / nz], [x1, z0 + ((z1 - z0) * k) / nz]);
        for (const [lx, lz] of probes) {
          if (clear(lx, lz)) continue;
          any = true;
          // charge the failure to the nearest side of the building's current bounds
          const d = { x0: lx - cut.x0, x1: cut.x1 - lx, z0: lz - cut.z0, z1: cut.z1 - lz };
          let side = 'x0';
          for (const k of ['x1', 'z0', 'z1']) if (d[k] < d[side]) side = k;
          fails[side]++;
        }
      }
      if (!any) break;
      if (it >= 40) return false;
      if (fails.x0) cut.x0 += 0.5;
      if (fails.x1) cut.x1 -= 0.5;
      if (fails.z0) cut.z0 += 0.5;
      if (fails.z1) cut.z1 -= 0.5;
      if (cut.x1 - cut.x0 < 3 || cut.z1 - cut.z0 < 3) return false;
    }
    if (cut.x0 === full.x0 && cut.x1 === full.x1 && cut.z0 === full.z0 && cut.z1 === full.z1) return true;
    const trimmed = [];
    for (const p of parts) {
      const q = { ...p, x0: Math.max(p.x0, cut.x0), x1: Math.min(p.x1, cut.x1) };
      q.z0 = Math.max(p.z0, cut.z0);
      q.z1 = Math.min(p.z1, cut.z1);
      // a part the trim narrows below 4 m is dropped rather than left as a sliver (an untrimmed narrow part stays)
      const w = q.x1 - q.x0, d = q.z1 - q.z0;
      if (w < EPS || d < EPS) continue;
      if ((w < 4 && w < p.x1 - p.x0 - EPS) || (d < 4 && d < p.z1 - p.z0 - EPS)) continue;
      trimmed.push(q);
    }
    if (!trimmed.some((p) => p.y0 < EPS)) return false;
    parts.splice(0, parts.length, ...trimmed);
    // The lot follows only the sides that moved, so a street face stays on the (new) lot line
    const lot = { ...b.lot };
    if (cut.x0 > full.x0) lot.x0 = Math.max(lot.x0, cut.x0);
    if (cut.x1 < full.x1) lot.x1 = Math.min(lot.x1, cut.x1);
    if (cut.z0 > full.z0) lot.z0 = Math.max(lot.z0, cut.z0);
    if (cut.z1 < full.z1) lot.z1 = Math.min(lot.z1, cut.z1);
    b.lot = lot;
    return true;
  }

  // Lots left empty under a bridge approach (see commit): the lot-line walls of the buildings next to them look out
  // over the gap, so they get windows like a rear wall
  function openOntoVoidLots(blk) {
    if (!blk.voidLots.length) return;
    for (const e of blk.facadeBoxes) {
      const x0 = e.x - e.w * 0.5;
      const x1 = e.x + e.w * 0.5;
      const z0 = e.z - e.d * 0.5;
      const z1 = e.z + e.d * 0.5;
      // The 2 m strip beyond each wall: w, e, n, s
      const strips = [[x0 - 2, x0, z0, z1], [x1, x1 + 2, z0, z1], [x0, x1, z0 - 2, z0], [x0, x1, z1, z1 + 2]];
      strips.forEach(([a0, a1, b0, b1], k) => {
        if (e.faces[k] !== WALL_KINDS.lotLine) return;
        const open = blk.voidLots.some((v) => v.x0 < a1 - EPS && v.x1 > a0 + EPS && v.z0 < b1 - EPS && v.z1 > b0 + EPS);
        if (open) e.faces[k] = WALL_KINDS.rear;
      });
    }
  }

  // Ground-floor street frontage of part p on `side`: storefront awnings (if it has shops), and remembered for the
  // renovation scaffolding. Awnings are { x, y, z, w, d, nx, nz, colorIdx } in the lot frame: w / d its x / z extents,
  // (nx, nz) the wall's outward normal
  function streetFront(blk, side, p, shops) {
    const alongX = side === 'n' || side === 's';
    const a0 = alongX ? p.x0 : p.z0;
    const len = (alongX ? p.x1 : p.z1) - a0;
    const c = wallAt(p, side);
    const out = side === 'n' || side === 'w' ? -1 : 1;
    blk.streetFronts.push({ side, a0, a1: a0 + len, c, out, h: p.y1 });
    const n = Math.max(1, Math.round(len / 12));
    const seg = len / n;
    if (seg < 4.5) return;
    for (let k = 0; k < n; k++) {
      if (!chance(0.62)) continue;
      const colorIdx = irange(0, 4); // (the dice are rolled either way, so the block stays the same)
      if (!shops) continue;
      const along = a0 + seg * (k + 0.5);
      const span = Math.min(8.5, seg - 1.6);
      blk.awnings.push(alongX
        ? { x: along, y: 3.8, z: c + out * 0.9, w: span, d: 1.8, nx: 0, nz: out, colorIdx }
        : { x: c + out * 0.9, y: 3.8, z: along, w: 1.8, d: span, nx: out, nz: 0, colorIdx });
    }
  }

  // Share of part p's roof covered by parts of the same building standing on it
  function roofCover(b, p) {
    let covered = 0;
    for (const q of b.parts) {
      if (q === p || Math.abs(q.y0 - p.y1) > EPS) continue;
      const w = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
      const d = Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0);
      if (w > 0 && d > 0) covered += w * d;
    }
    return covered / ((p.x1 - p.x0) * (p.z1 - p.z0));
  }
  const coveredAt = (b, p, x, z) => b.parts.some((q) => q !== p && Math.abs(q.y0 - p.y1) < EPS &&
    x > q.x0 - 1 && x < q.x1 + 1 && z > q.z0 - 1 && z < q.z1 + 1);

  // Brick chimney stacks. Kamienica flues rise in the party walls, so a ridge running along the street gets its stacks
  // at both gable ends; a gable turned to the street (the Rynek) carries them on its ridge front and back; a flat roof
  // gets one by a wall. Each tops its roof's ridge by ~1.2 m (the rise comes from the part's roof spec), so the stacks
  // stand clear of the roofs roofs.js adds over these parts
  function addChimneys(blk, b) {
    for (const p of b.parts) {
      const pw = p.x1 - p.x0;
      const pd = p.z1 - p.z0;
      if (pw < 3 || pd < 3 || (p.roof && p.roof.mat === 'copper') || roofCover(b, p) > 0.5) continue;
      const r = p.roof;
      const cx = (p.x0 + p.x1) * 0.5;
      const cz = (p.z0 + p.z1) * 0.5;
      let spots;
      if (r && r.ridge === 'x') spots = [[p.x0 + 0.7, cz], [p.x1 - 0.7, cz]];
      else if (r) spots = [[cx, p.z0 + 0.7], [cx, p.z1 - 0.7]];
      else spots = [[p.x0 + 1 + rand() * (pw - 2), chance(0.5) ? p.z0 + 0.8 : p.z1 - 0.8]];
      const h = (r ? r.rise : 0) + range(0.9, 1.6);
      const w = range(0.7, 1.1);
      const d = range(0.5, 0.7);
      for (const [x, z] of spots) {
        if (chance(r ? 0.8 : 0.5) && !coveredAt(b, p, x, z)) blk.chimneys.push({ x, y: p.y1, z, w, d, h });
      }
    }
  }

  // Roof lights over stairwells and top-floor studios on the flat roofs (oficyny, lofts, works, modernist houses)
  function addSkylights(blk, b) {
    for (const p of b.parts) {
      const pw = p.x1 - p.x0;
      const pd = p.z1 - p.z0;
      if (p.roof || pw < 5 || pd < 5) continue;
      const n = Math.min(3, Math.floor((pw * pd) / 90));
      for (let k = 0; k < n; k++) {
        if (!chance(0.55)) continue;
        const w = Math.min(pw - 2, range(1.2, 2.6));
        const d = Math.min(pd - 2, range(1.2, 3.2));
        const x = p.x0 + 1 + w * 0.5 + rand() * (pw - 2 - w);
        const z = p.z0 + 1 + d * 0.5 + rand() * (pd - 2 - d);
        if (!coveredAt(b, p, x, z)) blk.skylights.push({ x, y: p.y1, z, w, d });
      }
    }
  }

  // Share of kamienice, corner houses and 1930s houses with wrought-iron balcony stacks on their street fronts
  const BALCONY_P = 0.5;

  /**
   * Emits building `b`: facade boxes, map footprints, colliders matching each part (boxes up to the eaves), stone
   * cornices under every masonry roof line, roof gear (brick chimney stacks, skylights, a mechanical penthouse on
   * modern roofs), balcony stacks and street-front awnings.
   * o: { cornice, corniceH, chimneys, skylights, hvac (true | 'small'), hvacH, balconies (balcony stacks), awnings,
   *      shops: 'all' | 'none' | probability of 'all' (street fronts with storefronts on the ground floor, the others
   *      get a residential entrance), freestanding, slabBalconies (freestanding panel slabs keep their long street-side
   *      stacks despite the 8-12 m setback), walls (see wallKinds), dormers (share of such buildings with roofs.js
   *      dormers on their pitched tile or slate roofs) }
   * Pitched roofs ride on the parts they cover (set by `pitch`) and become roofs.js instances here:
   *   part.roof = { shape: 'gable' | 'hip' | 'mansard', mat: 'tile' | 'slate' | 'copper', ridge: 'x' | 'z', rise, front? }
   * ridge: the ridge's axis in the lot frame (the gable ends face the other axis); rise: metres from the eave (the
   * part's y1, where its box and collider stop) to the ridge; front: the lot side ('n' | 's' | 'w' | 'e') a gable end
 * faces the Stary Rynek on, which may get a gable screen (gableStyle). Parts without `roof` are flat, and so is a part mostly
   * covered by the parts stacked on it (roofCover). Roofs are staged in the lot frame; populateBlock moves the ones a
   * turned block added (roofs.transform) where placeInFrame turns the rest.
   */
  const EAVE = 0.3;
  const HVAC_MAX = 12;
  // Rynek gable screens (roofs.js addGable): a share of the gables turned to the square keep their plain render
  // triangle, the rest are split between stepped (Renaissance) and volute (Baroque) attics. Picked off the building's
  // tone, a value it already drew, so the choice is deterministic per house and leaves the block's draws alone
  const GABLE_STYLE_P = [['plain', 0.25], ['stepped', 0.35], ['volute', 0.4]];
  function gableStyle(tone) {
    let t = (tone * 7919.37) % 1;
    for (const [style, p] of GABLE_STYLE_P) {
      if (t < p) return style === 'plain' ? null : style;
      t -= p;
    }
    return null;
  }
  // Dormers (roofs.js addDormers) on the kamienice and corner houses that have them (DORMER_P): every slope over a
  // street front, a share of the courtyard slopes
  const DORMER_P = 0.45;
  const DORMER_STREET_P = 1;
  const DORMER_YARD_P = 0.25;
  function commit(blk, b, o = {}) {
    const parts = b.parts;
    if (!parts.length) return;
    if (srcLegacy && !trimOffStreets(b)) {
      blk.voidLots.push(b.lot);
      return;
    }
    if (parts.some((p) => hitsBridgeCorridor(p.x0, p.x1, p.z0, p.z1))) {
      blk.voidLots.push(b.lot);
      return;
    }
    const mat = b.mat;
    const storey = storeys[mat];
    const tone = rand();
    let shopsOn = o.shops ?? 'all';
    if (typeof shopsOn === 'number') shopsOn = tone < shopsOn ? 'all' : 'none';
    const on = shopsOn !== 'none';
    const shops = { w: on, e: on, n: on, s: on };
    let top = parts[0];
    for (const p of parts) {
      const w = p.x1 - p.x0;
      const d = p.z1 - p.z0;
      const h = p.y1 - p.y0;
      const box = { x: p.x0 + w * 0.5, y: p.y0 + h * 0.5, z: p.z0 + d * 0.5, w, h, d, faces: wallKinds(b, p, shops, o), tone };
      buckets[mat].push(box);
      blk.facadeBoxes.push(box);
      blk.footprints.push({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, y0: p.y0, h: p.y1, tone });
      if (p.y0 < EPS) srcBuiltArea += w * d; // ground footprint, see srcBuiltArea
      if (p.y1 > blk.maxH) blk.maxH = p.y1;
      pushCollider(p.x0, p.x1, p.z0, p.z1, p.y0, p.y1);
      if (p.y1 > top.y1 + EPS || (p.y1 > top.y1 - EPS && w * d > rectW(top) * rectD(top))) top = p;
    }

    // o.dormers is the share of these buildings with dormers, decided off the tone (not a new draw from the block's
    // generator, which would reshuffle everything after it)
    const hasDormers = (tone * 9973.17) % 1 < (o.dormers || 0);
    // 0. Pitched roofs. roofs.js runs a gable's ridge along its w, so a ridge on the frame's z axis is the roof turned
    //    a quarter turn. The eaves overhang the walls by EAVE: the plan grows across the ridge (and along it for hips,
    //    mansards and free-standing houses; a gable end on a party wall stays flush, or neighbours' roofs would
    //    overlap) and the roof is scaled in its cross-section, so the pitch and ridge height stay put and the eave
    //    drops below the cornice line. A hip on a plan whose ridge would run along the shorter side is turned by
    //    roofs.js to the longer one; its rise is scaled to the shorter span so the pitch stays
    for (const p of parts) {
      const r = p.roof;
      if (!r || roofCover(b, p) > 0.5) continue;
      const alongX = r.ridge === 'x';
      let w = alongX ? p.x1 - p.x0 : p.z1 - p.z0;
      let d = alongX ? p.z1 - p.z0 : p.x1 - p.x0;
      let h = r.rise;
      if (r.shape === 'hip' && d > w) h *= w / d;
      // the span the slopes actually cross (roofs.js turns hips and mansards to ridge along the longer side)
      const span = r.shape === 'gable' ? d : Math.min(w, d);
      const drop = (h * 2 * EAVE) / span;
      if (r.shape !== 'gable' || o.freestanding) w += 2 * EAVE;
      d += 2 * EAVE;
      h += drop;
      const ry = alongX ? 0 : Math.PI * 0.5;
      const cx = (p.x0 + p.x1) * 0.5;
      const cz = (p.z0 + p.z1) * 0.5;
      if (!roofs.add(r.shape, r.mat, cx, p.y1 - drop, cz, w, d, h, ry)) continue;
      // A gable turned to the square (r.front, the Rynek's houses) gets a stepped or volute screen in its facade plane
      // in front of the roof's end, in the house's colour, unless the house keeps its plain gable (gableStyle)
      const style = r.shape === 'gable' && r.front && gableStyle(tone);
      if (style && Math.abs(wallAt(p, r.front) - wallAt(b.lot, r.front)) < EPS) {
        const fx = r.front === 'e' ? 1 : r.front === 'w' ? -1 : 0;
        const fz = r.front === 's' ? 1 : r.front === 'n' ? -1 : 0;
        roofs.addGable(style, fx ? wallAt(p, r.front) : cx, p.y1 - 0.05, fz ? wallAt(p, r.front) : cz,
          fx ? p.z1 - p.z0 : p.x1 - p.x0, r.rise + 0.05, Math.atan2(fx, fz), facades[mat][1].stoneColor);
      }
      if (!hasDormers) continue;
      // Dormers from their own generator, seeded by the building's tone and the part, so the block's draws stay put;
      // a slope over a street front always gets its row, one over the courtyard now and then
      const seed = (Math.floor(tone * 4294967296) ^ Math.imul(parts.indexOf(p) + 1, 2654435761)) >>> 0;
      roofs.addDormers(r.shape, r.mat, cx, p.y1 - drop, cz, w, d, h, ry, {
        rand: mulberry32(seed),
        facing: (dx, dz) => (b.street[dx > 0.5 ? 'e' : dx < -0.5 ? 'w' : dz > 0 ? 's' : 'n'] ? DORMER_STREET_P : DORMER_YARD_P)
      });
    }

    // 1. Stone cornices & setback ledges (pitched roofs sit on them too: the eave line)
    if (o.cornice ?? isMasonry(mat)) {
      const ch = o.corniceH ?? 0.8;
      for (const p of parts) {
        const x0 = p.x0 - corniceReach(b, p, 'w', 0.6);
        const x1 = p.x1 + corniceReach(b, p, 'e', 0.6);
        const z0 = p.z0 - corniceReach(b, p, 'n', 0.6);
        const z1 = p.z1 + corniceReach(b, p, 's', 0.6);
        blk.cornices.push({ x: (x0 + x1) * 0.5, y: p.y1, z: (z0 + z1) * 0.5, w: x1 - x0, h: ch, d: z1 - z0 });
      }
    }

    // 2. Roof gear: chimney stacks on the old houses, skylights on flat roofs, a mechanical penthouse (lift motor room,
    //    chillers) on the highest roof of modern buildings only
    if (o.chimneys) addChimneys(blk, b);
    if (o.skylights) addSkylights(blk, b);
    if (o.hvac && !top.roof) {
      const aw = rectW(top);
      const ad = rectD(top);
      // 'small': a lift motor room (panel slabs, post-war infill) rather than a plant floor
      const big = o.hvac !== 'small';
      // A plant room is at most HVAC_MAX across: scaled with the roof alone, the Targi halls (up to 95 m) got 50 m
      // boxes
      const hw = Math.min(aw - 1.2, big ? Math.min(HVAC_MAX, Math.max(3, aw * range(0.4, 0.65))) : range(2.4, 4.2));
      const hd = Math.min(ad - 1.2, big ? Math.min(HVAC_MAX, Math.max(3, ad * range(0.4, 0.65))) : range(2.4, 4.2));
      if (hw >= 1.8 && hd >= 1.8) {
        const jx = (aw - hw) * 0.5 - 0.6;
        const jz = (ad - hd) * 0.5 - 0.6;
        blk.hvacUnits.push({
          x: (top.x0 + top.x1) * 0.5 + range(-jx, jx),
          y: top.y1,
          z: (top.z0 + top.z1) * 0.5 + range(-jz, jz),
          w: hw,
          h: o.hvacH ?? range(3.4, 5.8),
          d: hd
        });
      }
    }

    // 3. Balcony stacks (balconies.js) on the street fronts of the ground-standing parts: one stack per ~7 m of front
    //    (1-3), all of the building's stacks one slab width and railing style, a balcony on every storey from the first
    //    floor (from the second over shops, clear of the awnings) up to the one under the eaves
    if (o.balconies) {
      const bw = range(1.8, 3);
      const style = irange(0, 2);
      for (const p of parts) {
        if (p.y0 > EPS) continue;
        const nf = Math.round(p.y1 / storey);
        for (const side of SIDES) {
          const alongX = side === 'n' || side === 's';
          const w = alongX ? p.x1 - p.x0 : p.z1 - p.z0;
          const c = wallAt(p, side);
          // A freestanding slab (osiedle panel block) is set back from its lot, so its `b.street` flags are all false;
          // slabBalconies reads the block's own street side and keeps the stack on the first row within 20 m of it.
          const edge = side === 'n' ? p.z0 - blk.minZ : side === 's' ? blk.maxZ - p.z1
            : side === 'w' ? p.x0 - blk.minX : blk.maxX - p.x1;
          const street = b.street[side] || (o.slabBalconies && blk.front[side] && edge < 20);
          if (w < 6 || !street || (!o.slabBalconies && Math.abs(c - wallAt(b.lot, side)) > EPS)) continue;
          const first = shops[side] ? 2 : 1;
          const landings = Math.min(nf - first, 6);
          if (landings < 2) continue;
          const out = side === 'n' || side === 'w' ? -1 : 1;
          const facing = side === 'n' ? Math.PI : side === 's' ? 0 : side === 'w' ? -Math.PI / 2 : Math.PI / 2;
          const count = Math.min(3, Math.max(1, Math.round(w / 7)));
          for (let k = 0; k < count; k++) {
            const along = (alongX ? p.x0 : p.z0) + (w * (k + 0.5)) / count;
            blk.balconies.push({
              x: alongX ? along : c + out * 0.55, y: first * storey + 0.1, z: alongX ? c + out * 0.55 : along,
              h: (landings - 1) * storey + 1, storey, landings, facing, w: bw, style
            });
          }
        }
      }
    }

    // 4. Storefront awnings along the ground floor of every street front
    if (o.awnings !== false) {
      for (const p of parts) {
        if (p.y0 > EPS) continue;
        for (const side of SIDES) {
          if (b.street[side] && Math.abs(wallAt(p, side) - wallAt(b.lot, side)) < EPS) streetFront(blk, side, p, shops[side]);
        }
      }
    }
  }

  // Corner treatments for tower shafts: notched (re-entrant corners), stepped (double notches), plus (cruciform),
  // L (one corner cut away) or a plain rect
  function shapeHoles(r, shape) {
    const w = rectW(r);
    const d = rectD(r);
    const m = Math.min(w, d);
    if (shape === 'notched') {
      const n = Math.min(range(2, 4), m * 0.22);
      return n >= 1.2 ? cornerHoles(r, n, n) : [];
    }
    if (shape === 'stepped') {
      const a = Math.min(range(3, 4.5), m * 0.26);
      return a >= 2 ? [...cornerHoles(r, a, a * 0.5), ...cornerHoles(r, a * 0.5, a)] : [];
    }
    if (shape === 'plus') return cornerHoles(r, w * range(0.24, 0.3), d * range(0.24, 0.3));
    if (shape === 'L') return cornerHoles(r, w * range(0.35, 0.5), d * range(0.35, 0.5), [pick(['nw', 'ne', 'sw', 'se'])]);
    return [];
  }

  const blockRect = (blk) => rect(blk.minX, blk.maxX, blk.minZ, blk.maxZ);
  // The block's longest street frontage (null when it has none)
  function mainFront(blk) {
    const R = blockRect(blk);
    let best = null;
    for (const s of SIDES) if (blk.front[s] && (!best || sideLen(R, s) > sideLen(R, best))) best = s;
    return best;
  }

  // ============================================================================
  // ROW LOTS (lots along one street frontage, `side` = that street; k: { mat, floors, depth, cfg })
  // ============================================================================

  // Kamienica: a front house 12-15 m deep on the street line and its oficyny (rear wings 6-8.5 m wide) reaching back
  // along one or both party walls round the courtyard, now and then closed by a cross wing at the back (a ring plan).
  // The oficyny run as high as the front house or a storey lower and have flat roofs; the front house carries the
  // district's mansard, gable or hip roof
  function kamienica(blk, lot, side, k) {
    const cfg = k.cfg;
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = Math.min(sideDepth(lot, side), k.depth);
    const front = Math.min(D, range(12, 15));
    const house = mass(b, [sideRect(lot, side, 0, L, 0, front)], 0, k.floors);
    const rear = D - front;
    if (rear >= 6 && L >= 9) {
      const wing = Math.min(L * 0.45, range(6, 8.5));
      const wd = cfg.dense ? rear : rear * range(0.75, 1);
      const plan = cfg.dense
        ? pickW([['L', 2], ['U', L >= 16 ? 4 : 0], ['ring', wd >= 16 && L >= 15 ? 2.5 : 0]])
        : pickW([['L', 4], ['U', L >= 16 ? 2.5 : 0], ['ring', wd >= 16 && L >= 15 ? 1 : 0], ['none', 1.2]]);
      const wf = Math.max(2, k.floors - (chance(0.5) ? 0 : 1));
      const wings = [];
      let wingAt = 0;
      let back = 0;
      if (plan === 'L') {
        const ea = chance(0.5) ? 0 : L - wing;
        wingAt = ea;
        wings.push(sideRect(lot, side, ea, ea + wing, front, front + wd));
      } else if (plan === 'U' || plan === 'ring') {
        wings.push(sideRect(lot, side, 0, wing, front, front + wd), sideRect(lot, side, L - wing, L, front, front + wd));
        if (plan === 'ring') {
          back = range(6, 7.5);
          wings.push(sideRect(lot, side, wing, L - wing, front + wd - back, front + wd));
        }
      }
      mass(b, wings, 0, wf);
      // Deep dense frontage lots (rear >= 22 m) get a transverse oficyna through the courtyard, as Poznań's centre
      // does: it turns a long open yard into two studnie (or, on an L plan, closes all but one light well) and fills
      // the 15-30 m behind the front house the row used to leave empty
      if (cfg.dense && rear >= 22) {
        const cd = range(6, 8.5);
        let a0 = 0;
        let a1 = 0;
        let vMax = wd;
        if (plan === 'L') {
          const gap = range(6, 9);
          a0 = wingAt === 0 ? wing : gap;
          a1 = wingAt === 0 ? L - gap : L - wing;
        } else if (plan === 'U' || plan === 'ring') {
          a0 = wing;
          a1 = L - wing;
          if (plan === 'ring') vMax = wd - back - 2;
        }
        const clear = vMax - cd;
        if (a1 - a0 >= 4 && clear >= 7) {
          const v = front + clear * range(0.35, 0.65);
          mass(b, [sideRect(lot, side, a0, a1, v, v + cd)], 0, Math.max(2, wf - (chance(0.5) ? 0 : 1)));
        }
      }
    }
    pitch(house, pickW(cfg.roofs), pickW(cfg.roofMats), alongRidge(side), range(32, 42));
    commit(blk, b, { chimneys: true, skylights: true, shops: cfg.shops, balconies: chance(BALCONY_P), dormers: DORMER_P });
  }

  // Stary Rynek house: a narrow lot (6-9 m) with its steep gable turned to the square, 3-4 storeys of polychrome
  // render, a lower rear wing on part of the width; shops and cafés on nearly every ground floor
  function rynekHouse(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = Math.min(sideDepth(lot, side), k.depth);
    const front = Math.min(D, range(13, 18));
    const house = mass(b, [sideRect(lot, side, 0, L, 0, front)], 0, k.floors);
    const ext = Math.min(D - front, range(5, 9));
    if (ext > 3 && chance(0.6)) {
      const ew = L * range(0.5, 0.7);
      const ea = chance(0.5) ? 0 : L - ew;
      mass(b, [sideRect(lot, side, ea, ea + ew, front, front + ext)], 0, Math.max(2, k.floors - 1));
    }
    pitch(house, 'gable', 'tile', acrossRidge(side), range(48, 55));
    for (const p of house) p.roof.front = side; // the stepped or volute attic over the square (commit, gableStyle)
    commit(blk, b, { chimneys: true, skylights: true, shops: 0.9, corniceH: 0.5 });
  }

  // Villa: a free-standing house set back 4-7 m in its garden (Sołacz, the canons' houses on Ostrów Tumski), 2-3
  // storeys under a hipped tile roof
  function villa(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = sideDepth(lot, side);
    const set = range(4, 7);
    const w = Math.min(L - 5, range(10, 15));
    const d = Math.min(D - set - 3, range(10, 13));
    if (w < 7 || d < 7) return;
    const a = (L - w) * range(0.3, 0.7);
    const house = mass(b, [sideRect(lot, side, a, a + w, set, set + d)], 0, k.floors);
    pitch(house, pickW([['hip', 3], ['mansard', 1], ['gable', 1]]), pickW([['tile', 3], ['slate', 1]]), alongRidge(side), range(35, 45));
    commit(blk, b, { chimneys: true, freestanding: true, shops: 'none', awnings: false, corniceH: 0.45 });
  }

  // 1930s modernist house: flat roof behind a thin parapet, the top floor often stepped back behind a terrace, shops
  // on half of them (the interwar infill of Wilda, Łazarz and the streets round the Targi)
  function modernist1930s(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const dep = Math.min(sideDepth(lot, side), k.depth);
    mass(b, [sideRect(lot, side, 0, L, 0, dep)], 0, k.floors);
    const terrace = range(2.2, 3.2);
    if (dep - terrace >= 6 && chance(0.45)) mass(b, [sideRect(lot, side, 0, L, terrace, dep)], k.floors, k.floors + 1);
    commit(blk, b, { corniceH: 0.35, skylights: true, shops: 0.5, balconies: chance(BALCONY_P) });
  }

  // Post-war block filling a war gap: a plain slab of 2.8 m storeys on the street line or behind a planted strip, now
  // and then a rear wing; lift room on the roof
  function postwarBlock(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const D = sideDepth(lot, side);
    const front = chance(0.5) ? range(1.5, 4) : 0;
    const dep = Math.min(D, front + k.depth);
    mass(b, [sideRect(lot, side, 0, L, front, dep)], 0, k.floors);
    if (L > 18 && D - dep > 6 && chance(0.4)) {
      const ww = range(9, 11);
      const ea = chance(0.5) ? 0 : L - ww;
      mass(b, [sideRect(lot, side, ea, ea + ww, dep, Math.min(D, dep + range(8, 14)))], 0, k.floors);
    }
    commit(blk, b, { cornice: false, hvac: 'small', hvacH: range(2.4, 3), shops: 0.35 });
  }

  // Infill (plomba) since the 1990s: fills a gap up to the neighbours' eaves in glass or smooth render, the top floor
  // stepped back
  function infill(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    const L = sideLen(lot, side);
    const dep = Math.min(sideDepth(lot, side), k.depth);
    mass(b, [sideRect(lot, side, 0, L, 0, dep)], 0, k.floors);
    if (dep >= 9 && chance(0.6)) mass(b, [sideRect(lot, side, 0, L, range(1.8, 2.8), dep)], k.floors, k.floors + 1);
    commit(blk, b, { cornice: false, skylights: true, shops: 0.75 });
  }

  // One- and two-storey pavilions, workshops and garages
  function lowRow(blk, lot, side, k) {
    const b = building(blk, k.mat, lot);
    mass(b, [sideRect(lot, side, 0, sideLen(lot, side), 0, Math.min(sideDepth(lot, side), k.depth))], 0, k.floors);
    commit(blk, b, { corniceH: 0.5, skylights: true });
  }

  // Polychrome render of the Rynek houses (and the odd ochre or salmon one)
  const PASTELS = [[F.rose, 1], [F.mint, 1], [F.sky, 1], [F.lemon, 1], [F.ochre, 0.6], [F.salmon, 0.6]];

  // Row lot kinds: lot width (m), run (identical neighbours built together), storeys, depth (m, capped by the frontage
  // strip), facade weights (null: the profile's `mats`, its district's kamienica palette)
  const ROW_KINDS = {
    kamienica: { w: [12, 20], run: [1, 3], floors: [4, 5], depth: [24, 34], mats: null, build: kamienica },
    rynekHouse: { w: [6, 9], run: [2, 6], floors: [3, 4], depth: [16, 26], mats: PASTELS, build: rynekHouse },
    villa: { w: [18, 28], run: [1, 3], floors: [2, 3], depth: [20, 32], mats: [[F.cream, 3], [F.ochre, 2], [F.greyGreen, 1], [F.brick, 1]], build: villa },
    modernist1930s: { w: [14, 24], run: [1, 2], floors: [4, 5], depth: [12, 16], mats: [[F.cream, 4], [F.greyGreen, 2], [F.salmon, 1]], build: modernist1930s },
    postwarBlock: { w: [18, 36], run: [1, 1], floors: [5, 5], depth: [11, 13], mats: [...PANELS, [F.greyGreen, 2], [F.cream, 2]], build: postwarBlock },
    infill: { w: [8, 16], run: [1, 1], floors: [4, 5], depth: [12, 16], mats: [[F.cream, 2], [F.greyGreen, 1], [F.salmon, 1], [F.glassSilver, 1], [F.glassTeal, 1]], build: infill },
    low: { w: [8, 16], run: [1, 1], floors: [1, 2], depth: [10, 20], mats: [[F.brick, 2], [F.cream, 1]], build: lowRow },
    gap: { w: [8, 14], run: [1, 1], floors: [0, 0], depth: [0, 0], mats: [[F.cream, 1]], build: null } // war gap / vacant lot
  };

  // Fill the frontage [a0, a1] along `side` of the lot rect with runs of row lots `depth` deep
  function fillFrontage(blk, side, a0, a1, depth, rows, cfg) {
    const R = blockRect(blk);
    let a = a0;
    while (a1 - a > 0.5) {
      const kindName = pickW(rows);
      const kind = ROW_KINDS[kindName];
      const fl = (cfg.kf && cfg.kf[kindName]) || kind.floors;
      const run = irange(kind.run[0], kind.run[1]);
      const lotW = range(kind.w[0], kind.w[1]);
      const mat = pickW(kind.mats || cfg.mats);
      const floorsRun = irange(fl[0], fl[1]);
      let depthRun = range(kind.depth[0], kind.depth[1]);
      // Deep frontage strips in the centre (50-70 m) built only the first 34 m of kamienica and left the rest of the
      // lot empty; a dense lot takes the whole reach, up to 48 m, so its oficyny and rear wing fill the depth. This
      // also closes the 0-6 m slit two back-to-back rows left through a 50-60 m block.
      if (cfg.dense && kindName === 'kamienica') depthRun = Math.min(depth, DENSE_REACH);
      for (let i = 0; i < run && a1 - a > 0.5; i++) {
        let w = lotW * range(0.96, 1.04);
        if (a1 - a - w < kind.w[0] * 0.6) w = a1 - a;
        if (kind.build && w >= 4) {
          kind.build(blk, sideRect(R, side, a, a + w, 0, depth), side, {
            mat,
            cfg,
            floors: Math.max(1, floorsRun + (chance(0.2) ? pick([-1, 1]) : 0)),
            depth: Math.min(depth, depthRun * range(0.95, 1.05))
          });
        }
        a += w;
      }
    }
  }

  // ============================================================================
  // CORNER HOUSES & PUBLIC BUILDINGS
  // ============================================================================

  // Corner house (narożnik) where two street frontages meet (corner `c`, e.g. 'nw': the n and w streets): two street
  // wings in an L round the courtyard corner, a storey above the row; on many a turret over the corner itself (one
  // storey more under a steep copper helm). On the Rynek it is one more gabled pastel house
  function cornerHouse(blk, c, lot, cfg) {
    const ns = c[0];
    const ew = c[1];
    const W = rectW(lot);
    const D = rectD(lot);
    const rynek = blk.rynekSides && (blk.rynekSides[ns] || blk.rynekSides[ew]);
    const b = building(blk, pickW(rynek ? PASTELS : cfg.mats), lot);
    const f = rynek ? irange(3, 4) : irange(cfg.cornerFloors[0], cfg.cornerFloors[1]);
    const dep = Math.min(W, D, range(12, 15));
    const wingA = mass(b, [sideRect(lot, ns, 0, W, 0, dep)], 0, f);
    const wingB = D - dep >= 3
      ? mass(b, [ns === 'n' ? sideRect(lot, ew, dep, D, 0, dep) : sideRect(lot, ew, 0, D - dep, 0, dep)], 0, f)
      : [];
    if (rynek) {
      pitch(wingA, 'gable', 'tile', acrossRidge(ns), 50);
      pitch(wingB, 'gable', 'tile', acrossRidge(ew), 50);
      if (blk.rynekSides[ns]) for (const p of wingA) p.roof.front = ns;
      if (blk.rynekSides[ew]) for (const p of wingB) p.roof.front = ew;
    } else {
      const shape = pickW(cfg.roofs);
      const mat = pickW(cfg.roofMats);
      pitch(wingA, shape, mat, alongRidge(ns));
      pitch(wingB, shape, mat, alongRidge(ew));
      if (chance(cfg.turretP)) {
        const t = Math.min(dep, range(4.5, 6.5));
        const x0 = ew === 'w' ? lot.x0 : lot.x1 - t;
        const z0 = ns === 'n' ? lot.z0 : lot.z1 - t;
        for (const p of mass(b, [rect(x0, x0 + t, z0, z0 + t)], f, f + 1)) {
          p.roof = { shape: 'hip', mat: 'copper', ridge: 'x', rise: Math.round(t * 120) / 100 };
        }
      }
    }
    commit(blk, b, {
      chimneys: true, skylights: true, shops: chance(cfg.cornerShops) ? 'all' : 'none', balconies: chance(BALCONY_P),
      dormers: rynek ? 0 : DORMER_P
    });
  }

  // A lot rect off every street (the middle of a big block, behind a landmark reserve, a deep-lot split): 20% of the
  // lot area in the core districts and up to 30-40% in Wilda, Główna and Chartowo. Poznań's blocks are built up
  // inside too, so it gets the profile's `inner` buildings kept off its edges, where the front houses' oficyny need
  // their light: INNER_YARD on big lots, down to 2 m on the 12-30 m pieces the frontage frames leave between their
  // rects. Left as bare yard (one in eight a shed) these lots were most of what made the centre look empty
  const INNER_YARD = 6;
  function innerLot(blk, R, cfg) {
    const yard = Math.max(2, Math.min(cfg.dense ? 3 : INNER_YARD, (Math.min(rectW(R), rectD(R)) - 12) * 0.5));
    innerBuildings(blk, insetAll(R, yard), cfg.inner || INNER_RES, cfg);
  }

  // Buildings inside a block's core rect C (already clear of its neighbours), by `kinds` weights:
  // - 'rear': tylne kamienice, 3-5-storey houses across the lot in rows 11-14 m deep, a light court at least as wide
  //   as they are tall between them, split by an 8 m passage when longer than 70 m
  // - 'works': a one- or two-storey brick workshop or garage hall over most of the core
  // - 'pavilion': a free-standing school, clinic or office block of the 1960s-2000s, 3-5 storeys, a bar or an L
  // - 'yard': the yard itself, now and then with a one- or two-storey outbuilding along one side
  const INNER_RES = [['rear', 5], ['works', 2], ['pavilion', 2], ['yard', 1.5]];
  function innerBuildings(blk, C, kinds, cfg) {
    const W = rectW(C);
    const D = rectD(C);
    if (Math.min(W, D) < 8) return;
    const kind = pickW(kinds);
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    // Rect in C's long-axis frame: u along the long side, v across it
    const at = (u0, u1, v0, v1) => (alongX ? rect(C.x0 + u0, C.x0 + u1, C.z0 + v0, C.z0 + v1) : rect(C.x0 + v0, C.x0 + v1, C.z0 + u0, C.z0 + u1));
    if (kind === 'rear' && wid >= 9) {
      const kf = (cfg.kf && cfg.kf.kamienica) || [4, 5];
      const floors = Math.max(3, irange(kf[0], kf[1]) - (chance(0.5) ? 1 : 0));
      const mat = pickW(cfg.mats || RES_BASE.mats);
      const dep = Math.min(wid, range(11, 14));
      // A dense centre's rear rows stand on 7-9 m light wells (Poznań's studnie), not the 11-14 m of an outer block
      const court = cfg.dense
        ? Math.max(7, Math.min(9, floors * storeys[mat] * 0.5))
        : Math.max(14, floors * storeys[mat]);
      const rows = Math.max(1, Math.floor((wid + court) / (dep + court)));
      const v0 = (wid - rows * dep - (rows - 1) * court) * 0.5;
      const runs = len > 70 ? [[0, len * 0.5 - 4], [len * 0.5 + 4, len]] : [[0, len]];
      for (let k = 0; k < rows; k++) {
        const v = v0 + k * (dep + court);
        for (const [u0, u1] of runs) {
          const r = at(u0, u1, v, v + dep);
          const b = building(blk, mat, r);
          const house = mass(b, [r], 0, floors);
          if (chance(0.5)) pitch(house, 'gable', 'tile', alongX ? 'x' : 'z', range(30, 38));
          commit(blk, b, { chimneys: true, skylights: true, shops: 'none', awnings: false, walls: WALL_KINDS.rear });
        }
      }
      return;
    }
    if (kind === 'works' && wid >= 8) {
      const r = at(0, len * range(0.6, 1), 0, wid * range(0.6, 1));
      const b = building(blk, pickW([[F.brick, 3], [F.yellowBrick, 2], [F.cream, 1]]), r);
      mass(b, [r], 0, irange(1, 2));
      commit(blk, b, { corniceH: 0.5, skylights: true, shops: 'none', awnings: false, walls: WALL_KINDS.rear });
      return;
    }
    if (kind === 'pavilion' && wid >= 12) {
      const bl = Math.min(len, range(30, 64));
      const bd = Math.min(wid, range(12, 16));
      const u = (len - bl) * range(0.2, 0.8);
      const v = (wid - bd) * range(0.2, 0.8);
      const r = at(u, u + bl, v, v + bd);
      const parts = [r];
      // An L: a wing off one end, back across the core
      if (wid - bd >= 16 && chance(0.45)) {
        const ww = range(11, 14);
        const end = chance(0.5) ? u : u + bl - ww;
        parts.push(v + bd + 14 <= wid ? at(end, end + ww, v + bd, Math.min(wid, v + bd + range(14, 28))) : at(end, end + ww, Math.max(0, v - range(14, 28)), v));
      }
      const b = building(blk, pickW([[F.cream, 3], [F.greyGreen, 1], [F.salmon, 1], [F.glassSilver, 1], [F.glassTeal, 1]]), r);
      mass(b, parts, 0, irange(3, 5));
      commit(blk, b, { cornice: false, hvac: 'small', hvacH: range(2.4, 3), skylights: true, shops: 'none', awnings: false, freestanding: true });
      return;
    }
    if (Math.min(W, D) < 18 || !chance(0.35)) return;
    const s = pick(SIDES);
    const b = building(blk, pickW([[F.brick, 3], [F.cream, 1]]), C);
    mass(b, [sideRect(C, s, 0, sideLen(C, s), 0, Math.min(sideDepth(C, s) * 0.5, range(6, 9)))], 0, irange(1, 2));
    commit(blk, b, { corniceH: 0.4, skylights: true, shops: 'none', awnings: false, walls: WALL_KINDS.rear });
  }

  // Monumental public building filling its lot rect (the Dzielnica Cesarska's 1902-1914 offices, post office, academy
  // and insurance houses): a perimeter round an inner court, a U or an H, 4-5 storeys of 4.4 m sandstone, a central
  // risalit a storey higher on the main front under a copper mansard, slate or copper roofs on the wings
  function monumental(blk, cfg) {
    const R = blockRect(blk);
    const main = mainFront(blk);
    const L = sideLen(R, main);
    const Dp = sideDepth(R, main);
    const b = building(blk, pickW(cfg.monumentMats), R);
    const f = irange(cfg.monument[0], cfg.monument[1]);
    const wing = range(13, 16);
    const plan = pickW([
      ['ring', Dp >= 2 * wing + 8 && L >= 2 * wing + 8 ? 4 : 0],
      ['U', 2],
      ['H', L >= 50 && Dp >= 40 ? 1 : 0],
      ['rect', Dp < 22 ? 3 : 0]
    ]);
    let holes;
    if (plan === 'ring') holes = [sideRect(R, main, wing, L - wing, wing, Dp - wing)];
    else if (plan === 'U') holes = [sideRect(R, main, wing, L - wing, Math.min(wing, Dp * 0.5), Dp + 1)];
    else if (plan === 'rect') holes = [];
    else holes = [sideRect(R, main, wing, L - wing, -1, Dp * 0.3), sideRect(R, main, wing, L - wing, Dp * 0.7, Dp + 1)];
    // slice so the main front stays one piece (one window grid)
    const body = mass(b, carve(R, holes, main === 'n' || main === 's' ? 'z' : 'x'), 0, f);
    const shape = pickW([['mansard', 3], ['hip', 2]]);
    const mat = pickW(cfg.roofMats);
    for (const p of body) pitch([p], shape, mat, p.x1 - p.x0 >= p.z1 - p.z0 ? 'x' : 'z', 35);
    const rw = Math.min(L * 0.3, range(14, 22));
    pitch(mass(b, [sideRect(R, main, (L - rw) * 0.5, (L + rw) * 0.5, 0, Math.min(wing, Dp))], f, f + 1), 'mansard', 'copper', acrossRidge(main));
    commit(blk, b, { corniceH: 1.2, shops: 'none', awnings: false });
  }

  // Office tower on a podium: the shaft pulled back from the street with notched, stepped or cruciform corners, plain
  // parapet & big mechanical penthouse
  function officeTower(blk, side, lot, cfg) {
    const L = sideLen(lot, side);
    const W = sideDepth(lot, side);
    const b = building(blk, pickW(GLASS), lot);
    const pf = irange(2, 4);
    const f = pf + irange(cfg.tower[0], cfg.tower[1]);
    const plaza = chance(0.3) ? range(3, 6) : 0;
    const podium = sideRect(lot, side, 0, L, plaza, W);
    mass(b, [podium], 0, pf);
    const st = range(1.5, 3.2);
    let shaft = sideRect(lot, side, st, L - st, plaza + range(0, 2.5), W - range(0, 2));
    if (rectW(shaft) < 9 || rectD(shaft) < 9) shaft = podium;
    mass(b, carve(shaft, shapeHoles(shaft, pickW([['notched', 3], ['rect', 2], ['stepped', 1.5], ['plus', 0.8]])), 'x'), pf, f);
    commit(blk, b, { cornice: false, hvac: true, shops: 'all' });
    return W;
  }

  // Mid-rise office block, glass or sandstone-clad, with a recessed top floor. A mid-depth lot takes the whole depth
  // down to a 3-6 m rear service yard (deep = true), since a 16-24 m slab + 12 m court + wing would not fit; a
  // deep floorplate of 34 m or more gets a central atrium/light well so the plan stays lit.
  function officeSlab(blk, side, lot, cfg, deep = false) {
    const mat = chance(0.7) ? pickW(GLASS) : pickW([[F.sandstone, 1], [F.cream, 1]]);
    const b = building(blk, mat, lot);
    const L = sideLen(lot, side);
    const cap = Math.min(sideDepth(lot, side), range(16, 24));
    const D = deep ? Math.max(cap, sideDepth(lot, side) - range(3, 6)) : cap;
    const f = irange(cfg.mid[0], cfg.mid[1]);
    let rects = [sideRect(lot, side, 0, L, 0, D)];
    if (deep && D >= 34 && L >= 26 && chance(0.65)) {
      const r = rects[0];
      const cw = Math.min(L * 0.3, range(6, 10));
      const cd = Math.min(D * 0.3, range(6, 10));
      const cx = (r.x0 + r.x1) * 0.5;
      const cz = (r.z0 + r.z1) * 0.5;
      rects = carve(r, [rect(cx - cw * 0.5, cx + cw * 0.5, cz - cd * 0.5, cz + cd * 0.5)], 'x');
    }
    mass(b, rects, 0, f);
    if (D >= 12 && L >= 6 && chance(0.6)) mass(b, [sideRect(lot, side, 1, L - 1, range(2, 3), D - 1)], f, f + 1);
    commit(blk, b, { cornice: !isGlass(mat), hvac: true, hvacH: range(2.6, 3.6), shops: 'all' });
    return D;
  }

  // ============================================================================
  // BLOCK LAYOUTS: each fills the lot rect [minX, maxX] x [minZ, maxZ] of the current frame (blk.front / blk.corner say
  // which of its sides front a street, see frontages)
  // ============================================================================
  const SIDE_CORNERS = { n: ['nw', 'ne'], s: ['sw', 'se'], w: ['nw', 'sw'], e: ['ne', 'se'] };

  // Perimeter block: a corner house wherever two street frontages meet at the block outline (blk.corner), rows of
  // kamienice along each frontage between them, the courtyard behind left as yard. Sides off the street (the block's
  // other lot rects, landmark reserves, deep-lot splits) are party walls; a rect with no frontage at all is courtyard.
  // On the Rynek the frontages facing the square (blk.rynekSides) take `cfg.rynekRows` instead of `cfg.rows`
  function residentialBlock(blk, cfg) {
    const R = blockRect(blk);
    const W = rectW(R);
    const D = rectD(R);
    const f = blk.front;
    blk.yards.push(insetAll(R, 1.5));
    if (!f.n && !f.s && !f.w && !f.e) {
      innerLot(blk, R, cfg);
      return;
    }
    const cs = range(cfg.corner[0], cfg.corner[1]);
    const csX = Math.min(cs, W * 0.5);
    const csZ = Math.min(cs, D * 0.5);
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      if (blk.corner[c] !== 'street') continue;
      const x0 = c[1] === 'w' ? R.x0 : R.x1 - csX;
      const z0 = c[0] === 'n' ? R.z0 : R.z1 - csZ;
      cornerHouse(blk, c, rect(x0, x0 + csX, z0, z0 + csZ), cfg);
    }
    // Each frontage's row strip runs between the corner squares (a 'notch' corner keeps its square as courtyard)
    const strip = {};
    for (const s of SIDES) {
      if (!f[s]) continue;
      const cA = s === 'n' || s === 's' ? csX : csZ;
      const [c0, c1] = SIDE_CORNERS[s];
      strip[s] = [blk.corner[c0] ? cA : 0, sideLen(R, s) - (blk.corner[c1] ? cA : 0)];
    }
    const open = (s) => !!strip[s] && strip[s][1] - strip[s][0] > 0.5;
    // A strip runs half the rect deep when the opposite side has a strip too, or the whole depth on one side only
    // when the rect is too shallow for two rows back to back (< 26 m: the n / w row runs through to the other street).
    // Strips along the rect's shorter sides stop at the corner squares' depth when a perpendicular strip shares the
    // rect, so the long frontages keep their deep lots (oficyny) and no two rows overlap
    const longX = W >= D;
    const reach = { n: 0, s: 0, w: 0, e: 0 }; // how deep each side's rows can reach into the rect
    for (const s of SIDES) {
      if (!open(s)) continue;
      const alongX = s === 'n' || s === 's';
      let depth = sideDepth(R, s);
      if (open(OPPOSITE[s])) {
        if (depth >= 26) depth *= 0.5;
        else if (s === 's' || s === 'e') continue;
      }
      if (alongX !== longX && (alongX ? ['w', 'e'] : ['n', 's']).some(open)) depth = Math.min(depth, alongX ? csZ : csX);
      reach[s] = depth;
      const rows = blk.rynekSides && blk.rynekSides[s] ? cfg.rynekRows : cfg.rows;
      fillFrontage(blk, s, strip[s][0], strip[s][1], depth, rows, cfg);
    }
    // The core the rows leave in a big rect (at most ROW_REACH deep from each frontage, the corner houses less) is
    // built up like a frontless lot; sides without a frontage face the block's other lot rects. Dense centre blocks
    // keep cores only 8 m across (the common 45-55 m block leaves an 8-15 m sliver behind its deep rows, which was
    // discarded when the threshold was 16 m); elsewhere a core that narrow stays a yard.
    const maxRow = cfg.dense ? DENSE_REACH : ROW_REACH;
    const inset = (s) => (reach[s] ? Math.min(reach[s], maxRow) : 0) + (cfg.dense ? 3 : INNER_YARD);
    const core = rect(R.x0 + inset('w'), R.x1 - inset('e'), R.z0 + inset('n'), R.z1 - inset('s'));
    if (!cfg.noCore && Math.min(rectW(core), rectD(core)) >= (cfg.dense ? 8 : 14)) {
      innerBuildings(blk, core, cfg.inner || INNER_RES, cfg);
    }
  }
  // Deepest a row lot builds: kamienica depth 34 m × the ±5% run jitter (fillFrontage), rounded up; dense centre lots
  // may reach 48 m on deep frontage strips
  const ROW_REACH = 36;
  const DENSE_REACH = 48;

  // Dzielnica Cesarska: a monumental public building on a big lot rect with two or more frontages, grand sandstone
  // kamienice elsewhere
  function cesarskaBlock(blk, cfg) {
    const R = blockRect(blk);
    const fronts = SIDES.filter((s) => blk.front[s]).length;
    if (fronts >= 2 && Math.min(rectW(R), rectD(R)) >= 34 && chance(cfg.monumentP)) {
      blk.yards.push(insetAll(R, 1.5));
      monumental(blk, cfg);
      return;
    }
    residentialBlock(blk, cfg);
  }

  // Offices: glass towers on podiums and mid-rise office blocks in lots of 26-52 m along the main frontage, up to 48 m
  // deep, with a modern courtyard core behind them (see officeCore)
  const OFFICE_BAR = [12, 15]; // wing depth/width of a courtyard office (m)
  const OFFICE_COURT = 12; // minimum light court between two office wings (m)
  function officeCore(blk, C, main, cfg, budget) {
    const L = sideLen(C, main);
    const D = sideDepth(C, main);
    if (L < 12 || D < 12 || budget < 60) return 0;
    const at = (a0, a1, b0, b1) => sideRect(C, main, a0, a1, b0, b1);
    const partArea = (r) => (r.x1 - r.x0 >= 0.5 && r.z1 - r.z0 >= 0.5 ? (r.x1 - r.x0) * (r.z1 - r.z0) : 0);
    const sumArea = (parts) => parts.reduce((t, r) => t + partArea(r), 0);
    const bw = range(OFFICE_BAR[0], OFFICE_BAR[1]);
    // Sizes that leave at least OFFICE_COURT (12 m) between the wings. A rear bar needs D >= 24, an L or U core a
    // 12 m court too; a low 8-12 m pavilion fits a 20-24 m core.
    const sw = Math.min(bw, (L - OFFICE_COURT) * 0.5);
    const swL = Math.min(bw, L - OFFICE_COURT);
    const rd = Math.min(bw, D - OFFICE_COURT);
    const nb = Math.min(bw, (D - OFFICE_COURT) * 0.5);
    const cb = Math.min(bw, D - 2 * OFFICE_COURT);
    const plans = [];
    const add = (name, parts, low, weight) => {
      const p = parts.filter((r) => partArea(r) > 0);
      if (p.length) plans.push({ name, parts: p, area: sumArea(p), low, weight });
    };
    if (sw >= 12 && rd >= 12 && L - 2 * sw >= OFFICE_COURT && D - rd >= OFFICE_COURT) {
      add('U', [at(0, L, D - rd, D), at(0, sw, 0, D - rd), at(L - sw, L, 0, D - rd)], false, 3.5);
      if (nb >= 12 && D - nb - rd >= OFFICE_COURT) {
        add('ring', [at(0, L, D - rd, D), at(0, sw, 0, D - rd), at(L - sw, L, 0, D - rd), at(sw, L - sw, 0, nb)], false, 1.5);
      }
      if (cb >= 12 && (D - cb) * 0.5 >= OFFICE_COURT) {
        add('H', [at(0, sw, 0, D), at(L - sw, L, 0, D), at(sw, L - sw, (D - cb) * 0.5, (D + cb) * 0.5)], false, 1.5);
      }
    }
    if (swL >= 12 && rd >= 12 && L - swL >= OFFICE_COURT && D - rd >= OFFICE_COURT) {
      const wing = chance(0.5) ? at(0, swL, 0, D - rd) : at(L - swL, L, 0, D - rd);
      add('L', [at(0, L, D - rd, D), wing], false, 2.5);
    }
    if (rd >= 12 && D - 2 * rd >= OFFICE_COURT && L >= 16) {
      add('parallel', [at(0, L, 0, rd), at(0, L, D - rd, D)], false, 2);
    }
    if (rd >= 12 && D - rd >= OFFICE_COURT && L >= 16) add('rear', [at(0, L, D - rd, D)], false, 2);
    const pd = Math.min(range(10, 14), D - OFFICE_COURT);
    if (pd >= 8 && L >= 16) add('lowRear', [at(0, L, D - pd, D)], true, 2);
    if (!plans.length) return 0;

    // Prefer the weighted plan; fall back to the largest one the budget can pay for (blocks 816/868 have a lot of
    // unspent share, over-built offices like 593/786 have none and never reach here). A small weighted plan on a
    // budget that could pay for a courtyard bar is replaced by the larger plan, so a 12 m rear bar alone does not
    // waste the core of a deep lot.
    const chosen = pickW(plans.map((p) => [p, p.weight]));
    const fitting = plans.filter((p) => p.area <= budget).sort((a, b) => b.area - a.area);
    if (!fitting.length) return 0;
    const pick = chosen.area <= budget && chosen.area >= fitting[0].area * 0.55 ? chosen : fitting[0];
    const floors = pick.low ? irange(1, 2) : irange(cfg.coreFloors[0], cfg.coreFloors[1]);
    const mat = pick.low
      ? pickW([[F.cream, 2], [F.sandstone, 2], [F.glassSilver, 2], [F.glassTeal, 1]])
      : pickW([[F.glassTeal, 3], [F.glassSilver, 3], [F.glassBronze, 1], [F.cream, 1], [F.sandstone, 1]]);
    const b = building(blk, mat, C);
    mass(b, pick.parts, 0, floors);
    commit(blk, b, {
      cornice: !pick.low && !isGlass(mat), hvac: pick.low ? 'small' : true,
      hvacH: pick.low ? range(2.4, 3) : range(2.6, 3.6), skylights: true, shops: 'none', awnings: false, freestanding: true
    });
    let built = pick.area;

    // A low glazed link across the court: it closes one end of a U, or crosses the 12-16 m well between two parallel
    // bars, while keeping the court itself open to the sky.
    let link = null;
    if (pick.name === 'U' && D - rd - 4 >= OFFICE_COURT && chance(0.45)) {
      const ld = range(4, 6);
      if (D - rd - ld >= OFFICE_COURT) link = { a0: sw, a1: L - sw, b0: 0, b1: ld };
    } else if (pick.name === 'parallel' && chance(0.45)) {
      const lw = range(4, 6);
      link = { a0: (L - lw) * 0.5, a1: (L + lw) * 0.5, b0: rd, b1: D - rd };
    } else if (pick.name === 'ring' && L - 2 * sw >= OFFICE_COURT + 12 && chance(0.35)) {
      const lw = range(4, 6);
      link = { a0: sw, a1: sw + lw, b0: nb, b1: D - rd };
    }
    if (link) {
      const lr = at(link.a0, link.a1, link.b0, link.b1);
      const la = partArea(lr);
      if (built + la <= budget) {
        const lb = building(blk, pickW([[F.glassTeal, 1], [F.glassSilver, 1]]), C);
        mass(lb, [lr], 0, irange(1, 2));
        commit(blk, lb, { cornice: false, hvac: false, skylights: true, shops: 'none', awnings: false, freestanding: true });
        built += la;
      }
    }
    return built;
  }

  // A frontless office piece (the inside of a superblock or a frame sliver): a single office oficyna with 2-5 m side
  // yards, or the courtyard plan when the piece is wide enough for wings
  function officeInnerLot(blk, R, cfg, budget) {
    if (budget < 60) return 0;
    const C = insetAll(R, range(2, 4));
    const W = rectW(C);
    const D = rectD(C);
    if (W < 8 || D < 8) return 0;
    if (Math.min(W, D) >= 22) {
      const built = officeCore(blk, C, W >= D ? 's' : 'e', cfg, budget);
      if (built) return built;
    }
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    const bl = len - range(2, 5);
    const bd = wid - range(2, 4);
    if (bl < 12 || bd < 8) return 0;
    const area = Math.min(bl * bd, budget);
    if (area < 96) return 0;
    const lenFit = Math.min(bl, area / bd);
    const u = (len - lenFit) * range(0.2, 0.8);
    const v = (wid - bd) * range(0.2, 0.8);
    const r = alongX
      ? rect(C.x0 + u, C.x0 + u + lenFit, C.z0 + v, C.z0 + v + bd)
      : rect(C.x0 + v, C.x0 + v + bd, C.z0 + u, C.z0 + u + lenFit);
    const mat = pickW([[F.glassTeal, 3], [F.glassSilver, 2], [F.cream, 2], [F.sandstone, 1]]);
    const b = building(blk, mat, C);
    mass(b, [r], 0, irange(2, 4));
    commit(blk, b, {
      cornice: !isGlass(mat), hvac: 'small', hvacH: range(2.4, 3.2), skylights: true, shops: 'none', awnings: false,
      freestanding: true
    });
    return lenFit * bd;
  }

  function officeBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 1.5));
    const startBuilt = srcBuiltArea;
    const main = mainFront(blk);
    if (!main) {
      const left = Math.max(0, srcPieceBudget - (srcBuiltArea - startBuilt));
      if (cfg.core && left > 0) officeInnerLot(blk, R, cfg, left);
      else innerLot(blk, R, cfg);
      return;
    }
    const L = sideLen(R, main);
    const Dfull = sideDepth(R, main);
    const D = Math.min(Dfull, 48);
    const deep = !!cfg.core && Dfull <= 55;
    const lots = [];
    let a = 0;
    while (L - a > 0.5) {
      let w = range(26, 52);
      if (L - a - w < 18) w = L - a;
      const lot = sideRect(R, main, a, a + w, 0, D);
      const depth = w >= 22 && D >= 22 && chance(cfg.towerP)
        ? officeTower(blk, main, lot, cfg)
        : officeSlab(blk, main, lot, cfg, deep);
      lots.push({ a, w, depth });
      a += w;
    }
    // The core behind each frontage lot, 12-14 m off its rear wall and out to the lot's real depth. Per lot, so a
    // deep tower podium does not kill the courtyard behind its neighbours. Over-built offices (593, 786, 938, 939)
    // have cfg.core off; mid-depth lots (Dfull <= 55) took the full depth in officeSlab instead of a court.
    if (!cfg.core || deep) return;
    let coreLeft = Math.max(0, srcPieceBudget - (srcBuiltArea - startBuilt));
    if (coreLeft < 60) return;
    let avail = 0;
    for (const lot of lots) {
      lot.start = Math.min(Dfull, lot.depth + range(OFFICE_COURT, 14));
      avail += lot.w * Math.max(0, Dfull - lot.start);
    }
    if (avail < 60) return;
    let availLeft = avail;
    for (const lot of lots) {
      const lotAvail = lot.w * Math.max(0, Dfull - lot.start);
      if (lotAvail <= 0) continue;
      const budget = coreLeft * (lotAvail / availLeft);
      availLeft -= lotAvail;
      if (budget < 60) continue;
      const core = sideRect(R, main, lot.a, lot.a + lot.w, lot.start, Dfull);
      const built = officeCore(blk, core, main, cfg, budget);
      coreLeft -= built;
      if (coreLeft < 60) break;
    }
  }

  // Loft building filling its lot: light well / rear yard, setbacks on the tall ones
  function loftBuilding(blk, lot, cfg) {
    const b = building(blk, pickW(cfg.mats), lot);
    const W = rectW(lot);
    const D = rectD(lot);
    const through = b.street.n && b.street.s;
    const f = irange(cfg.floors[0], cfg.floors[1]);
    const holes = [];
    if (!through) {
      const rear = b.street.n ? 's' : 'n';
      if (chance(0.45)) holes.push(sideRect(lot, rear, -1, W + 1, -1, D * range(0.1, 0.28)));
      else if (W > 12 && chance(0.4)) holes.push(courtHole(lot, rear, W * range(0.3, 0.45), D * range(0.25, 0.4)));
    } else if (D > 18 && W > 10 && chance(0.45)) {
      const walls = ['w', 'e'].filter((s) => !b.street[s]);
      if (walls.length) {
        const lw = range(3, 5.5);
        holes.push(sideRect(lot, pick(walls), D * 0.5 - lw * 0.5, D * 0.5 + lw * 0.5, -1, Math.min(W * 0.32, range(2.4, 4))));
      }
    }
    const axis = through ? 'x' : 'z';
    const cuts = [f];
    if (f >= cfg.setbackAt && chance(0.75)) {
      cuts.unshift(f - irange(2, Math.min(5, f - 8)));
      if (f >= cfg.setbackAt + 6 && chance(0.6)) cuts.unshift(cuts[0] - irange(3, 6));
    }
    let fl = 0;
    let foot = lot;
    cuts.forEach((c, i) => {
      if (i > 0) foot = streetInset(b, foot, range(2.4, 3.8));
      mass(b, carve(foot, holes, axis), fl, c);
      fl = c;
    });
    commit(blk, b, { skylights: true, chimneys: chance(0.25), balconies: chance(cfg.balconyP) });
  }

  // Works and warehouses (Garbary, Główna, the rail-side quarters): full lot coverage, corner buildings through to
  // both streets, stretches of independent half-depth buildings back to back between them
  function loftBlock(blk, cfg, x0, x1) {
    const { minZ, maxZ } = blk;
    const halfD = (maxZ - minZ) * 0.5;
    const minW = cfg.lotW[0] * 0.7;
    blk.yards.push(rect(x0 + 2, x1 - 2, minZ + 3, maxZ - 3));
    let x = x0;
    while (x1 - x > 0.5) {
      if (x - blk.minX < EPS || chance(cfg.throughP)) {
        let w = range(cfg.lotW[0], cfg.lotW[1]);
        if (x1 - x - w < minW) w = x1 - x;
        loftBuilding(blk, rect(x, x + w, minZ, maxZ), cfg);
        x += w;
        continue;
      }
      let len = range(18, 40);
      if (x1 - x - len < minW) len = x1 - x;
      for (const side of ['n', 's']) {
        let xx = x;
        while (x + len - xx > 0.5) {
          let w = range(cfg.lotW[0], cfg.lotW[1]);
          if (x + len - xx - w < minW) w = x + len - xx;
          loftBuilding(blk, side === 'n' ? rect(xx, xx + w, minZ, minZ + halfD) : rect(xx, xx + w, maxZ - halfD, maxZ), cfg);
          xx += w;
        }
      }
      x += len;
    }
  }

  // Osiedle (housing estate) of wielka płyta slabs set back in greenery: rows of 5-storey slabs (the commonest type),
  // 11-storey slabs and 16-storey point blocks of 2.8 m storeys, the rows spaced ~0.9 of their height apart (≥ 18 m)
  // and kept 8-12 m off the streets; each slab in one of the panel colours (PANELS)
  function projectsBlock(blk, cfg) {
    const R = blockRect(blk);
    const W = rectW(R);
    const D = rectD(R);
    blk.yards.push(insetAll(R, 1.5));
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    // Dense estate variant (steerProfile's estateP): the low-lot-cover blocks of Rataje, Chartowo and Stare Winogrady
    // need 22-46 % of their lots built, while the standard rows (10.5-12.5 m deep, 18-30 m between segments and
    // >= 18 m between rows) top out at 13-25 %. Interpolating to 12-14 m rows, 8-14 m segment gaps and 10-16 m row
    // gaps closes that difference: 1166 (22 % target) gets the middle setting and 887 (41 %) the full one.
    const dense = cfg.estateP || 0;
    let set = range(cfg.setback[0], cfg.setback[1]);
    if (wid < 2 * set + 11) set = Math.max(3, (wid - 11) * 0.5);
    const place = (u0, u1, v0, v1, floors) => {
      const r = alongX ? rect(R.x0 + u0, R.x0 + u1, R.z0 + v0, R.z0 + v1) : rect(R.x0 + v0, R.x0 + v1, R.z0 + u0, R.z0 + u1);
      const b = building(blk, pickW(PANELS), r);
      mass(b, [r], 0, floors);
      // Panel slabs stand 8-12 m back from the lot line, so the ordinary balcony rule (a part wall flush with the lot
      // wall) would leave every osiedle without balconies. Their long street side still gets the loggia stacks; this
      // keeps the city-wide balcony count in its 14-18k band after Rataje/Stare Winogrady stay PROJECTS.
      commit(blk, b, {
        cornice: false, hvac: 'small', hvacH: 2.6, awnings: false, shops: 'none', freestanding: true,
        balconies: floors >= 5 && chance(0.7), slabBalconies: true
      });
    };
    // Between the slab rows and past the last one: the estate's school or przedszkole (3 storeys, rendered), a
    // pavilion of shops (pawilon handlowy, 1-2 storeys) or a row of lock-up garages, kept 6 m off the slabs, two along
    // a band over 120 m long
    const SERVICES = [['school', 2], ['pavilion', 3], ['garages', 2], ['none', 2]];
    const service = (v0, v1, a0 = set, a1 = len - set) => {
      if (a1 - a0 > 120 && a0 === set) {
        const mid = (a0 + a1) * 0.5;
        service(v0, v1, a0, mid - 6);
        service(v0, v1, mid + 6, a1);
        return;
      }
      const usable = v1 - v0 - 12;
      if (usable < 6) return;
      const kind = pickW(usable >= 12 ? SERVICES : [['garages', 1], ['none', 1]]);
      if (kind === 'none') return;
      const span = a1 - a0;
      const [l, d, floors, mat, opts] = kind === 'school'
        ? [range(50, 80), range(14, 18), 3, pickW([[F.cream, 3], [F.salmon, 1], [F.greyGreen, 1]]), { cornice: false, skylights: true, shops: 'none', awnings: false, freestanding: true }]
        : kind === 'pavilion'
          ? [range(20, 40), range(12, 16), irange(1, 2), pickW([[F.glassSilver, 1], [F.cream, 2], [F.greyGreen, 1]]), { cornice: false, hvac: 'small', hvacH: 2.4, shops: 'all', freestanding: true }]
          : [range(30, 70), 6, 1, pickW([[F.brick, 2], [F.cream, 1]]), { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.lotLine }];
      const bl = Math.min(span, l);
      const bd = Math.min(usable, d);
      if (bl < 12) return;
      const u0 = a0 + (span - bl) * range(0.15, 0.85);
      const c = (v0 + v1) * 0.5;
      const r = alongX ? rect(R.x0 + u0, R.x0 + u0 + bl, R.z0 + c - bd * 0.5, R.z0 + c + bd * 0.5) : rect(R.x0 + c - bd * 0.5, R.x0 + c + bd * 0.5, R.z0 + u0, R.z0 + u0 + bl);
      const b = building(blk, mat, r);
      mass(b, [r], 0, floors);
      commit(blk, b, opts);
    };
    let v = set;
    let lastEnd = -1;
    for (let row = 0; row < 8; row++) {
      const floors = pickW(cfg.types);
      const dep = floors >= 16 ? range(18, 22) : range(10.5 + 1.5 * dense, 12.5 + 1.5 * dense);
      if (v + dep > wid - set) break;
      if (lastEnd >= 0) service(lastEnd, v);
      lastEnd = v + dep;
      if (floors >= 16) {
        const gap = range(24, 36) * (1 - dense) + range(18, 26) * dense;
        const n = Math.floor((len - 2 * set + gap) / (dep + gap));
        const off = (len - n * dep - (n - 1) * gap) * 0.5;
        for (let k = 0; k < n; k++) place(off + k * (dep + gap), off + k * (dep + gap) + dep, v, v + dep, floors);
      } else {
        let u = set + range(0, 6);
        while (len - set - u >= 24 - 6 * dense) {
          const seg = Math.min(len - set - u,
            range(40, 110) * (1 - dense) + range(30, 70) * dense);
          place(u, u + seg, v, v + dep, floors);
          u += seg + range(18, 30) * (1 - dense) + range(8, 14) * dense;
        }
      }
      v += dep + (Math.max(18, floors * storeys[F.panel] * 0.9) * (1 - dense) +
        Math.max(10, Math.min(16, floors * storeys[F.panel] * 0.55)) * dense);
    }
    if (lastEnd >= 0) service(lastEnd, wid - set + 6);
    // An estate's frontage frames cut its blocks into strips 12-20 m deep that hold no row above: one slab along the
    // strip, 1-2 m off its ends (Nowe Winogrady Południe went from 4.4% to 14.9% built with it, 17.2% real). Rataje's
    // PROJECTS have the same strips, so their full-density blocks take the fallback too; a piece too small for a slab
    // gets a garage/pavilion row instead (1166's park-carved 15 x 17 m lots).
    if (lastEnd < 0 && wid >= 10 && len >= 10) {
      if (wid >= 11 && len >= 24 && (cfg.estate || dense >= 0.999)) {
        const dep = Math.min(wid - 1, range(10.5 + 1.5 * dense, 12.5 + 1.5 * dense));
        const seg = Math.min(len - 2, range(40, 110) * (1 - dense) + range(30, 70) * dense);
        const u0 = (len - seg) * range(0.3, 0.7);
        const v0 = (wid - dep) * 0.5;
        place(u0, u0 + seg, v0, v0 + dep, pickW(cfg.types));
      } else if (cfg.pieceFill > 0.05) {
        // Too small for a slab: a garage or pavilion row covering the piece's budget share. Without it the whole block
        // left those 200 pieces empty and stayed at 14 % of its lots.
        const fill = Math.max(0.08, Math.min(0.5, cfg.pieceFill));
        const depth = Math.min(wid - 1, Math.max(5, (fill * wid * len) / (len - 2)));
        const r = alongX
          ? rect(R.x0 + 1, R.x1 - 1, R.z0 + (wid - depth) * 0.5, R.z0 + (wid + depth) * 0.5)
          : rect(R.x0 + (wid - depth) * 0.5, R.x0 + (wid + depth) * 0.5, R.z0 + 1, R.z1 - 1);
        if (Math.min(rectW(r), rectD(r)) >= 5) {
          const b = building(blk, pickW(PANELS), r);
          mass(b, [r], 0, irange(1, 2));
          commit(blk, b, { cornice: false, shops: 'none', awnings: false, freestanding: true });
        }
      }
    }
  }

  // Low-rise blocks: warehouses, garages, sheds and small works
  function lowriseBlock(blk, cfg, x0, x1) {
    const { minZ, maxZ } = blk;
    const halfD = (maxZ - minZ) * 0.5;
    let x = x0;
    while (x1 - x > 0.5) {
      let w = range(10, 26);
      if (x1 - x - w < 8) w = x1 - x;
      const lots = chance(0.6)
        ? [rect(x, x + w, minZ, maxZ)]
        : [rect(x, x + w, minZ, minZ + halfD), rect(x, x + w, maxZ - halfD, maxZ)];
      for (const lot of lots) {
        const mat = pickW([[F.brick, 4], [F.cream, 2], [F.yellowBrick, 2], [F.greyGreen, 1]]);
        const f = irange(cfg.floors[0], cfg.floors[1]);
        const b = building(blk, mat, lot);
        mass(b, [lot], 0, f);
        commit(blk, b, { cornice: chance(0.6), corniceH: 0.6, skylights: true });
      }
      x += w;
    }
  }

  // Villa quarter (Sołacz, Winiary, the garden suburbs): detached houses in their gardens, on plots in rows laid out
  // from the lot rect's main street front (along its long side when it has none: the plots off private lanes inside
  // Sołacz's 30 ha blocks), the back rows facing the opposite street when there is one. cfg.share is the share of the
  // lot rect the houses cover (steerProfile: the block's real built share over its lot area), and sets the plot
  // width for each house drawn; a plot too narrow to leave VILLA_SIDE on each side of the house gets a deeper house
  // instead (Winiary's 25-35% blocks). Real Sołacz villas stand 12 × 14 to 20 × 20 m on plots of 600-1500 m²
  const VILLA_PLOT_D = [30, 44];
  const VILLA_SIDE = 3;
  function villaBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 1.5));
    const share = cfg.share ?? VILLA_SHARE;
    if (!(share > 0)) return;
    const main = mainFront(blk) || (rectW(R) >= rectD(R) ? 'n' : 'w');
    const back = OPPOSITE[main];
    const L = sideLen(R, main);
    const D = sideDepth(R, main);
    const rows = Math.max(1, Math.round(D / range(VILLA_PLOT_D[0], VILLA_PLOT_D[1])));
    const pd = D / rows;
    for (let i = 0; i < rows; i++) {
      const row = sideRect(R, main, 0, L, i * pd, (i + 1) * pd);
      const facing = blk.front[back] && i >= rows / 2 ? back : main;
      const street = facing === main ? i === 0 && !!blk.front[main] : i === rows - 1;
      villaRow(blk, row, facing, street, share, cfg);
    }
  }

  // One row of villa plots across `row`, their street (or lane) on `side`; `street`: that side is a street front.
  // Houses (and the annex, a one-storey wing or garage, on one in three) are drawn until they cover `share` of the
  // row, the last one with the odds of the area still missing, so a row keeps its share on average however short it
  // is (plots sized per house and cut off at the row's end built 0.75 of it). The plots then split the row: each house
  // needs its width and VILLA_SIDE on either side, the rest of the row is shared out at random as wider gardens. A row
  // too short for all of them drops the last ones and deepens the others by their area
  function villaRow(blk, row, side, street, share, cfg) {
    const L = sideLen(row, side);
    const D = sideDepth(row, side);
    const maxD = D - (street ? 6 : 4);
    if (L < 8 || maxD < 6) return;
    const want = share * L * D;
    const houses = [];
    let got = 0;
    while (got < want) {
      const h = { w: range(12, 17), d: Math.min(maxD, range(10, 14)) };
      h.annex = chance(0.35) ? [range(5, 7), range(6, 9)] : null;
      h.area = h.w * h.d + (h.annex ? h.annex[0] * h.annex[1] : 0);
      if (got + h.area > want && !chance((want - got) / h.area)) break;
      houses.push(h);
      got += h.area;
    }
    const need = (h) => h.w + (h.annex ? h.annex[0] : 0) + 2 * VILLA_SIDE;
    let used = houses.reduce((t, h) => t + need(h), 0);
    while (houses.length && used > L) {
      const h = houses.pop();
      used -= need(h);
      // narrow rows keep one house, as wide as the row lets it be
      if (!houses.length && L - 2 * VILLA_SIDE >= 7) {
        h.annex = null;
        h.w = Math.min(h.w, L - 2 * VILLA_SIDE);
        houses.push(h);
        used = need(h);
      }
    }
    if (!houses.length) return;
    let short = got - houses.reduce((t, h) => t + h.w * h.d + (h.annex ? h.annex[0] * h.annex[1] : 0), 0);
    if (short > 1) {
      const span = houses.reduce((t, h) => t + h.w, 0);
      for (const h of houses) h.d = Math.min(maxD, h.d + short / span);
    }
    const slack = L - used;
    const wts = houses.map(() => range(0.5, 1.5));
    const wsum = wts.reduce((t, x) => t + x, 0);
    let a = 0;
    houses.forEach((h, k) => {
      const pw = need(h) + (slack * wts[k]) / wsum;
      villaHouse(blk, sideRect(row, side, a, a + pw, 0, D), side, street, h.w, h.d, h.annex, cfg);
      a += pw;
    });
  }

  // A detached house on `plot` (street or lane on `side`): set back 4-7 m from a street, anywhere in the middle of a
  // back plot; 2-3 storeys under a hipped, mansard or gabled tile or slate roof, one in eight a flat-roofed 1930s
  // modernist villa with its top floor stepped back behind a terrace
  function villaHouse(blk, plot, side, street, hw, hd, annex, cfg) {
    const L = sideLen(plot, side);
    const D = sideDepth(plot, side);
    const set = street ? Math.min(range(4, 7), D - hd - 2) : (D - hd) * range(0.3, 0.6);
    const aw = annex ? annex[0] : 0;
    const a = VILLA_SIDE + (L - hw - aw - 2 * VILLA_SIDE) * range(0.2, 0.8);
    const left = chance(0.5);
    const ha = left ? a + aw : a;
    const r = sideRect(plot, side, ha, ha + hw, set, set + hd);
    const modern = chance(0.12);
    const b = building(blk, modern ? pickW([[F.cream, 3], [F.greyGreen, 1]]) : pickW(cfg.mats), plot);
    const floors = irange(cfg.kf.villa[0], cfg.kf.villa[1]);
    const house = mass(b, [r], 0, floors);
    if (annex) {
      const x0 = left ? a : a + hw;
      const d = Math.min(annex[1], hd);
      mass(b, [sideRect(plot, side, x0, x0 + aw, set + hd - d, set + hd)], 0, 1);
    }
    if (modern) {
      if (floors >= 2 && hd >= 9) {
        mass(b, [sideRect(plot, side, ha, ha + hw, set + range(2.5, 3.5), set + hd)], floors, floors + 1);
      }
      commit(blk, b, { corniceH: 0.35, skylights: true, freestanding: true, shops: 'none', awnings: false });
      return;
    }
    const shape = pickW([['hip', 3], ['mansard', 1], ['gable', 1]]);
    pitch(house, shape, pickW([['tile', 3], ['slate', 1]]), rectW(r) >= rectD(r) ? 'x' : 'z', range(35, 45));
    commit(blk, b, { chimneys: true, freestanding: true, shops: 'none', awnings: false, corniceH: 0.45 });
  }

  // Exhibition halls (FAIRGROUND) over the lot rect, forecourts along its streets: rows of halls across its short side,
  // each a blank-walled box in render or brick, or a glass hall; a third of the box halls front an alley with a
  // two-storey glass foyer
  function fairBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 1.5));
    const f = blk.front;
    const C = rect(R.x0 + (f.w ? cfg.forecourt : 3), R.x1 - (f.e ? cfg.forecourt : 3), R.z0 + (f.n ? cfg.forecourt : 3), R.z1 - (f.s ? cfg.forecourt : 3));
    const W = rectW(C);
    const D = rectD(C);
    if (Math.min(W, D) < 20) return;
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    const at = (u0, u1, v0, v1) => (alongX ? rect(C.x0 + u0, C.x0 + u1, C.z0 + v0, C.z0 + v1) : rect(C.x0 + v0, C.x0 + v1, C.z0 + u0, C.z0 + u1));
    const hall = (r) => {
      const glass = chance(0.35);
      const mat = glass ? pickW(GLASS) : pickW([[F.cream, 3], [F.greyGreen, 2], [F.brick, 1]]);
      const floors = Math.max(2, Math.round(range(cfg.h[0], cfg.h[1]) / storeys[mat]));
      let body = r;
      if (!glass && chance(0.35)) {
        const s = pick(alongX ? ['n', 's'] : ['w', 'e']);
        const foyer = sideRect(r, s, 0, sideLen(r, s), 0, 8);
        body = sideRect(r, s, 0, sideLen(r, s), 8, sideDepth(r, s));
        const fb = building(blk, pickW(GLASS), foyer);
        mass(fb, [foyer], 0, 2);
        commit(blk, fb, { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.rear });
      }
      const b = building(blk, mat, body);
      mass(b, [body], 0, floors);
      commit(blk, b, { cornice: false, hvac: true, skylights: true, shops: 'none', awnings: false, walls: glass ? WALL_KINDS.rear : WALL_KINDS.blankStone });
    };
    let v = 0;
    while (wid - v >= 20) {
      let span = Math.min(range(cfg.span[0], cfg.span[1]), wid - v);
      if (wid - v - span < 20 + cfg.alley[0]) span = wid - v;
      let u = 0;
      while (len - u >= 20) {
        let hl = Math.min(range(cfg.hall[0], cfg.hall[1]), len - u);
        if (len - u - hl < 20 + cfg.alley[0]) hl = len - u;
        hall(at(u, u + hl, v, v + span));
        u += hl + range(cfg.alley[0], cfg.alley[1]);
      }
      v += span + range(cfg.alley[0], cfg.alley[1]);
    }
  }

  // Shopping mall: one broad, low box of 3-4 storeys (11-16 m) over most of its lot, a glazed entrance pavilion on
  // the main street, a central run of rooflights and packaged plant on the flat roof. Slivers too narrow for a hall
  // stay as the car park and service apron round the box; the lot's built share is set by KIND_SHARE (0.75).
  function mallBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 0.5));
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 20) return;
    const front = mainFront(blk) || (W >= D ? 'n' : 'w');
    const fore = Math.min(cfg.forecourt, Math.max(6, Math.min(W, D) * 0.1));
    const C = rect(R.x0 + (front === 'w' ? fore : 3), R.x1 - (front === 'e' ? fore : 3),
      R.z0 + (front === 'n' ? fore : 3), R.z1 - (front === 's' ? fore : 3));
    if (rectW(C) < 14 || rectD(C) < 14) return;
    const floors = irange(cfg.floors[0], cfg.floors[1]);
    const b = building(blk, pickW(cfg.mats), C);
    const body = mass(b, [C], 0, floors);
    commit(blk, b, { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.blankStone });
    // The representative entrance: a glazed box filling the setback on the main front
    const span = sideLen(R, front);
    const ew = Math.min(span - 6, range(22, 40));
    if (ew >= 14) {
      const ea = (span - ew) * 0.5;
      const e = sideRect(R, front, ea, ea + ew, 0, fore);
      const eb = building(blk, pickW(GLASS), e);
      mass(eb, [e], 0, Math.min(3, floors));
      commit(blk, eb, { cornice: false, shops: 'all', awnings: false });
    }
    // A central row of rooflights and packaged plant units; the body stays flat
    const top = body.reduce((y, p) => Math.max(y, p.y1), 0);
    const longX = rectW(C) >= rectD(C);
    const len = longX ? rectW(C) : rectD(C);
    const n = Math.max(2, Math.min(5, Math.round(len / 26)));
    const cx = (C.x0 + C.x1) * 0.5;
    const cz = (C.z0 + C.z1) * 0.5;
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n - 0.5) * len * 0.72;
      const sw = longX ? range(9, 14) : range(5, 8);
      const sd = longX ? range(5, 8) : range(9, 14);
      blk.skylights.push({ x: longX ? cx + t : cx, y: top, z: longX ? cz : cz + t, w: sw, d: sd });
    }
    for (let k = 0; k < 5; k++) {
      blk.hvacUnits.push({
        x: C.x0 + range(4, rectW(C) - 4), y: top, z: C.z0 + range(4, rectD(C) - 4),
        w: range(3, 7), h: range(2.4, 4.5), d: range(3, 7)
      });
    }
  }

  // Retail park / big-box: one to three two-storey halls (7.6 m) behind a front car park, with parking aisles
  // between them and a plain flat roof with packaged plant. The lot's built share is KIND_SHARE (0.6), so the
  // forecourt and aisles take the rest; steerProfile's skip thins whole lot pieces on sparser blocks.
  function retailParkBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 0.5));
    const W = rectW(R);
    const D = rectD(R);
    const narrow = Math.min(W, D);
    if (narrow < 10) return;
    const front = mainFront(blk) || (W >= D ? 'n' : 'w');
    const across = front === 'n' || front === 's' ? D : W;
    // Small frontage pieces (12-18 m deep in the Chartowo, Nowe Winogrady and Górczyn retail quarters) cannot take the
    // 22 m forecourt plus the 4 m rear strip: a 13 x 14 m lot left 8 m of depth and returned nothing. They get a 2-4 m
    // forecourt and a single 7-10 m deep hall instead, so the kept share of lots still produces the real built area.
    const small = narrow < 18;
    const fore = small ? Math.min(4, Math.max(2, across * 0.12))
      : Math.min(cfg.forecourt, Math.max(8, across * 0.22));
    const back = small ? 2 : 4;
    const C = rect(R.x0 + (front === 'w' ? fore : back), R.x1 - (front === 'e' ? fore : back),
      R.z0 + (front === 'n' ? fore : back), R.z1 - (front === 's' ? fore : back));
    const cw = rectW(C);
    const cd = rectD(C);
    if (Math.min(cw, cd) < 6) return;
    if (Math.min(cw, cd) < 12) {
      const r = rect(C.x0 + 0.5, C.x1 - 0.5, C.z0 + 0.5, C.z1 - 0.5);
      if (Math.min(rectW(r), rectD(r)) < 5) return;
      const b = building(blk, pickW(cfg.mats), r);
      mass(b, [r], 0, irange(cfg.floors[0], cfg.floors[1]));
      commit(blk, b, {
        cornice: false, hvac: true, hvacH: range(2.4, 3.6), skylights: true, shops: 'all', awnings: false,
        freestanding: true
      });
      return;
    }
    const alongX = cw >= cd;
    const len = alongX ? cw : cd;
    const wid = alongX ? cd : cw;
    const at = (u0, u1, v0, v1) => (alongX
      ? rect(C.x0 + u0, C.x0 + u1, C.z0 + v0, C.z0 + v1)
      : rect(C.x0 + v0, C.x0 + v1, C.z0 + u0, C.z0 + u1));
    const n = Math.max(1, Math.min(3, Math.round(len / range(55, 85))));
    const cell = len / n;
    for (let k = 0; k < n; k++) {
      const aisle = n > 1 ? range(8, 16) * 0.5 : 0;
      const u0 = k * cell + (k ? aisle : 0);
      const u1 = (k + 1) * cell - (k < n - 1 ? aisle : 0);
      if (u1 - u0 < 16) continue;
      const r = at(u0, u1, wid * 0.04, wid * 0.96);
      if (Math.min(rectW(r), rectD(r)) < 10) continue;
      const b = building(blk, pickW(cfg.mats), r);
      mass(b, [r], 0, irange(cfg.floors[0], cfg.floors[1]));
      commit(blk, b, {
        cornice: false, hvac: true, hvacH: range(2.4, 3.6), skylights: true, shops: 'all', awnings: false,
        freestanding: true
      });
    }
  }

  // Industrial hall: the lot under one long gabled hall split into 18-26 m bays (the sawtooth/north-light rhythm),
  // plus a low office at the street. The bays keep a 0.8 m gap so neighbouring roof eaves never overlap; the lot's
  // built share is KIND_SHARE (0.55).
  function industrialBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 0.5));
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 18) return;
    const front = mainFront(blk) || (W >= D ? 'n' : 'w');
    const fore = Math.min(range(4, 8), Math.min(W, D) * 0.15);
    const C = rect(R.x0 + (front === 'w' ? fore : 4), R.x1 - (front === 'e' ? fore : 4),
      R.z0 + (front === 'n' ? fore : 4), R.z1 - (front === 's' ? fore : 4));
    const cw = rectW(C);
    const cd = rectD(C);
    if (Math.min(cw, cd) < 14) return;
    const alongX = cw >= cd;
    const len = alongX ? cw : cd;
    const wid = alongX ? cd : cw;
    const at = (u0, u1, v0, v1) => (alongX
      ? rect(C.x0 + u0, C.x0 + u1, C.z0 + v0, C.z0 + v1)
      : rect(C.x0 + v0, C.x0 + v1, C.z0 + u0, C.z0 + u1));
    const mat = pickW(cfg.mats);
    const b = building(blk, mat, C);
    const bays = Math.max(2, Math.min(6, Math.round(len / range(18, 26))));
    const gap = 0.8;
    const step = (len - gap * (bays - 1)) / bays;
    for (let k = 0; k < bays; k++) {
      const u0 = k * (step + gap);
      const part = mass(b, [at(u0, u0 + step, 0, wid)], 0, irange(cfg.floors[0], cfg.floors[1]));
      pitch(part, 'gable', pickW([['slate', 2], ['tile', 1]]), alongX ? 'z' : 'x', range(12, 20));
    }
    commit(blk, b, { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.blankStone });
    // A low brick or glass office/workshop on the front strip, where there is room for one
    if (fore >= 6 && chance(0.7)) {
      const span = sideLen(R, front);
      const ow = Math.min(span - 6, range(16, 34));
      if (ow >= 12) {
        const oa = (span - ow) * 0.5;
        const o = sideRect(R, front, oa, oa + ow, 0, fore);
        const ob = building(blk, pickW([[F.brick, 2], [F.cream, 1], [F.glassSilver, 1]]), o);
        mass(ob, [o], 0, 2);
        commit(blk, ob, { cornice: false, shops: 'all', awnings: false });
      }
    }
  }

  // Railway/tram depot: long 2-3-storey halls along the lot's main axis, spaced for the tracks and service yards
  // between them, each under a shallow gable. The lot's built share is KIND_SHARE (0.5); the open tracks stay yard.
  function depotBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 0.5));
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 16) return;
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    const at = (u0, u1, v0, v1) => (alongX
      ? rect(R.x0 + u0, R.x0 + u1, R.z0 + v0, R.z0 + v1)
      : rect(R.x0 + v0, R.x0 + v1, R.z0 + u0, R.z0 + u1));
    const n = Math.max(1, Math.min(3, Math.round(wid / range(24, 38))));
    const cell = wid / n;
    for (let k = 0; k < n; k++) {
      const hallW = Math.min(cell - 10, range(14, 24));
      if (hallW < 10) continue;
      const v0 = k * cell + (cell - hallW) * 0.5;
      const hl = Math.min(len - 6, range(len * 0.55, len * 0.92));
      const u0 = (len - hl) * range(0.1, 0.9);
      const r = at(u0, u0 + hl, v0, v0 + hallW);
      const b = building(blk, pickW(cfg.mats), r);
      const part = mass(b, [r], 0, irange(cfg.floors[0], cfg.floors[1]));
      pitch(part, 'gable', pickW([['slate', 2], ['tile', 1]]), alongX ? 'x' : 'z', range(12, 18));
      commit(blk, b, { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.blankStone });
    }
  }

  // Stadium: four grandstands round a grass pitch, the main stands 6-8 storeys (23-31 m) and the end stands two
  // storeys lower, with the corners open. The pitch stays a lawn (blk.yards); the rest of the lot is concourse and
  // parking. Lots under 80 m across have no room for the bowl and stay open.
  function stadiumBlock(blk, cfg) {
    const R = blockRect(blk);
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 80) return;
    const stand = Math.min(cfg.stand, Math.min(W, D) * 0.18);
    const alongX = W >= D;
    const pw = Math.min(alongX ? cfg.pitch[0] : cfg.pitch[1], W - 2 * stand - 8);
    const pd = Math.min(alongX ? cfg.pitch[1] : cfg.pitch[0], D - 2 * stand - 8);
    if (pw < 60 || pd < 40) return;
    const cx = (R.x0 + R.x1) * 0.5;
    const cz = (R.z0 + R.z1) * 0.5;
    const pitchRect = rect(cx - pw * 0.5, cx + pw * 0.5, cz - pd * 0.5, cz + pd * 0.5);
    blk.yards.push(pitchRect);
    const b = building(blk, pickW(cfg.mats), R);
    const f = irange(cfg.floors[0], cfg.floors[1]);
    const end = Math.max(3, f - 2);
    mass(b, [
      rect(pitchRect.x0 - stand, pitchRect.x0, pitchRect.z0 - stand, pitchRect.z1 + stand),
      rect(pitchRect.x1, pitchRect.x1 + stand, pitchRect.z0 - stand, pitchRect.z1 + stand)
    ], 0, f);
    mass(b, [
      rect(pitchRect.x0, pitchRect.x1, pitchRect.z0 - stand, pitchRect.z0),
      rect(pitchRect.x0, pitchRect.x1, pitchRect.z1, pitchRect.z1 + stand)
    ], 0, end);
    commit(blk, b, {
      cornice: false, hvac: 'small', hvacH: range(2, 3), shops: 'none', awnings: false, freestanding: true
    });
  }

  // Arena / sports hall: one big hall 5-7 storeys (19-27 m) with its corners cut into an octagon, a lower podium
  // round the base and a flat roof with plant. The lot's built share is KIND_SHARE (0.6).
  function arenaBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 0.5));
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 28) return;
    const C = insetAll(R, Math.min(6, Math.min(W, D) * 0.08));
    if (Math.min(rectW(C), rectD(C)) < 22) return;
    const b = building(blk, pickW(cfg.mats), C);
    const f = irange(cfg.floors[0], cfg.floors[1]);
    const cut = Math.min(rectW(C), rectD(C)) * range(0.12, 0.2);
    // A two-storey podium fills the lot; the hall above it is cut back at the corners into an octagon, so the
    // silhouette reads as a free-standing arena rather than a rectangular office block.
    if (cut >= 3) {
      mass(b, [C], 0, Math.min(2, f - 1));
      mass(b, carve(C, cornerHoles(C, cut, cut), 'x'), Math.min(2, f - 1), f);
    } else {
      mass(b, [C], 0, f);
    }
    commit(blk, b, {
      cornice: false, hvac: true, hvacH: range(2.4, 4), shops: 'none', awnings: false, freestanding: true
    });
  }

  // Utility block (power station, pumping works): two plain technical volumes of 4-7 storeys (15-27 m),
  // the tallest a boiler house beside the low turbine hall, in industrial brick or render. The lot's built share
  // is KIND_SHARE (0.45).
  function utilityBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 0.5));
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 18) return;
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    const at = (u0, u1, v0, v1) => (alongX
      ? rect(R.x0 + u0, R.x0 + u1, R.z0 + v0, R.z0 + v1)
      : rect(R.x0 + v0, R.x0 + v1, R.z0 + u0, R.z0 + u1));
    const mat = pickW(cfg.mats);
    const hall = at(0, len * 0.62, wid * 0.08, wid * 0.92);
    const b = building(blk, mat, hall);
    mass(b, [hall], 0, irange(cfg.floors[0], cfg.floors[1] - 1));
    commit(blk, b, { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.blankStone });
    const tall = at(len * 0.7, len * 0.96, wid * 0.18, wid * 0.82);
    if (Math.min(rectW(tall), rectD(tall)) >= 10) {
      const tb = building(blk, mat, tall);
      mass(tb, [tall], 0, irange(cfg.floors[1] - 2, cfg.floors[1]));
      commit(blk, tb, { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.blankStone });
    }
  }

  // GEO.blockAnchors: the largest mapped non-residential boxes of a block. A dedicated building fills the anchor's own
  // OSM envelope (not a generic lot cut out of the quarter), at exactly the mapped plan and the real storey count; the
  // rest of the block is then service yard or a low pavilion, never a row of kamienice. Use codes come from
  // tools/poz-buildings.mjs: 1 retail/mall, 2 industrial/warehouse, 3 rail/depot, 4 sport/leisure, 5 utility.
  function anchorFloors(a, cfg, minF, maxF) {
    const levels = a[6];
    return levels >= 2 ? Math.max(minF, Math.min(maxF, Math.round(levels))) : irange(cfg.floors[0], cfg.floors[1]);
  }
  function anchorProfile(a) {
    const use = a[5];
    const area = a[4];
    if (use === 4) return { ...ARENA, kind: 'anchor', exact: true, anchor: a };
    if (use === 5) return { ...UTILITY, kind: 'anchor', exact: true, anchor: a };
    if (use === 3) return { ...DEPOT, kind: 'anchor', exact: true, anchor: a };
    if (use === 1) return { ...(area >= 8000 ? MALL : RETAIL_PARK), kind: 'anchor', exact: true, anchor: a };
    return { ...INDUSTRIAL_HALL, kind: 'anchor', exact: true, anchor: a };
  }
  // `parts` are the anchor envelope intersected with the block's own lot rects in the current frame (see
  // populateAnchor): the building fills exactly that union, so a mall or hall never spills across a street or into a
  // neighbouring block, while an L-shaped OSM outline is still covered by its own parts.
  function anchorBlock(blk, cfg) {
    fillAnchor(blk, cfg, cfg.parts || [blockRect(blk)]);
  }
  function fillAnchor(blk, cfg, parts) {
    const a = cfg.anchor;
    const use = a[5];
    if (!parts.length) return;
    const lot = rect(Math.min(...parts.map((p) => p[0])), Math.max(...parts.map((p) => p[1])),
      Math.min(...parts.map((p) => p[2])), Math.max(...parts.map((p) => p[3])));
    const area = a[4];
    let mat, floors, opts;
    if (use === 1) {
      // A mall or big-box: one broad low box; the mapped outline already contains the car park and service apron.
      mat = area >= 8000 ? pickW([[F.glassSilver, 3], [F.glassTeal, 1], [F.cream, 1]])
        : pickW([[F.cream, 3], [F.greyGreen, 2], [F.brick, 2]]);
      floors = a[6] >= 2 ? Math.max(3, Math.min(5, Math.round(a[6]))) : irange(cfg.floors[0], cfg.floors[1]);
      opts = { cornice: false, hvac: true, hvacH: range(2.4, 4), skylights: true, shops: 'all', awnings: false,
        freestanding: true };
    } else if (use === 4) {
      // An arena or sports hall: one big hall, no podium stacked over the same plan (the plan footprints must stay
      // disjoint for the park-facility audit). A stadium bowl never reaches here (filtered to its stand layout).
      mat = pickW(ARENA.mats);
      floors = anchorFloors(a, ARENA, 4, 6);
      opts = { cornice: false, hvac: true, hvacH: range(2.4, 4), skylights: true, shops: 'none', awnings: false,
        freestanding: true };
    } else if (use === 5) {
      mat = pickW(UTILITY.mats);
      floors = anchorFloors(a, UTILITY, 3, 6);
      opts = { cornice: false, shops: 'none', awnings: false, walls: WALL_KINDS.blankStone };
    } else {
      mat = pickW(use === 3 ? DEPOT.mats : INDUSTRIAL_HALL.mats);
      floors = anchorFloors(a, use === 3 ? DEPOT : INDUSTRIAL_HALL, 2, 4);
      opts = { cornice: false, hvac: use === 2 && chance(0.4), hvacH: range(2.4, 3.6), skylights: false,
        shops: 'none', awnings: false, walls: WALL_KINDS.blankStone };
    }
    const b = building(blk, mat, lot);
    for (const r of parts) {
      if (Math.min(rectW(r), rectD(r)) < 4) continue;
      if (use === 2 || use === 3) {
        // Industrial hall or depot: each part split into 18-30 m bays, the sawtooth/north-light rhythm, under shallow
        // gables. The mapped anchor is the hall itself, so its bays fill it end to end.
        const alongX = rectW(r) >= rectD(r);
        const len = alongX ? rectW(r) : rectD(r);
        const wid = alongX ? rectD(r) : rectW(r);
        const bays = Math.max(1, Math.min(6, Math.round(len / range(22, 32))));
        const gap = 0.8;
        const step = (len - gap * (bays - 1)) / bays;
        for (let k = 0; k < bays; k++) {
          const u0 = k * (step + gap);
          const part = mass(b, [alongX
            ? rect(r.x0 + u0, r.x0 + u0 + step, r.z0, r.z1)
            : rect(r.x0, r.x1, r.z0 + u0, r.z0 + u0 + step)], 0, floors);
          if (wid >= 12) pitch(part, 'gable', pickW([['slate', 2], ['tile', 1]]), alongX ? 'z' : 'x', range(10, 18));
        }
      } else {
        mass(b, [r], 0, floors);
      }
    }
    commit(blk, b, opts);
  }
  // Remaining lots of an anchored block: only as much low service pavilion as the block's real built share still has
  // unspent (srcPieceBudget, set from srcBuiltArea after the anchors were committed); everything else stays yard.
  function ancillaryBlock(blk) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 1.5));
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 10) return;
    const budget = Math.min(srcPieceBudget, 0.45 * W * D);
    if (budget < 80) return;
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    const dep = Math.min(wid - 2, Math.max(5, Math.sqrt(budget * 0.5)));
    const w = Math.min(len - 2, Math.max(8, budget / dep));
    if (w < 8 || dep < 5) return;
    const r = alongX ? rect(R.x0 + 1, R.x0 + 1 + w, R.z1 - 1 - dep, R.z1 - 1)
      : rect(R.x1 - 1 - dep, R.x1 - 1, R.z0 + 1, R.z0 + 1 + w);
    const b = building(blk, pickW([[F.cream, 2], [F.greyGreen, 2], [F.brick, 1]]), r);
    mass(b, [r], 0, irange(1, 2));
    commit(blk, b, { cornice: false, skylights: true, shops: 'none', awnings: false, walls: WALL_KINDS.rear });
  }

  // Hospital and university campuses: institutional blocks along the streets and a loose grid of clinics and
  // institutes inside, with 9-16 m clear service alleys (10-16 m along a row, 16 m in the wide cores). `cfg.share` is
  // the block's real OSM built share over its lot area (steerProfile), so each lot rect builds its target: the frontage
  // takes up to 60% of that budget and the core pavilions the rest. Before this, a 16 ha hospital block in
  // Łazarz/Grunwald built 14.9% against 21% real.
  function campusBuilding(blk, r, cfg) {
    const b = building(blk, pickW(cfg.mats), r);
    const floors = irange(cfg.floors[0], cfg.floors[1]);
    const body = mass(b, [r], 0, floors);
    if (chance(cfg.pitched || 0)) pitch(body, pickW([['gable', 2], ['hip', 1]]), pickW([['tile', 2], ['slate', 1]]),
      rectW(r) >= rectD(r) ? 'x' : 'z', range(32, 40));
    commit(blk, b, { cornice: !chance(cfg.pitched || 0), hvac: 'small', hvacH: range(2.4, 3.2), skylights: true,
      shops: 'none', awnings: false, freestanding: true, balconies: cfg.program === 2 && chance(0.5) });
  }
  // Pavilions on a 12-18 m alley grid over C, filling at most `budget` m² of footprint; returns the area built
  function campusPavilions(blk, C, cfg, budget) {
    const W = rectW(C);
    const D = rectD(C);
    if (Math.min(W, D) < 8 || budget <= 0) return 0;
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    const alley = Math.min(16, Math.max(9, wid * 0.2));
    const rows = Math.max(1, Math.min(4, Math.floor((wid + alley) / (20 + alley))));
    const dep = Math.min(30, (wid - (rows - 1) * alley) / rows);
    if (dep < 7) return 0;
    const at = (u0, u1, v0, v1) => (alongX
      ? rect(C.x0 + u0, C.x0 + u1, C.z0 + v0, C.z0 + v1)
      : rect(C.x0 + v0, C.x0 + v1, C.z0 + u0, C.z0 + u1));
    const v0 = (wid - rows * dep - (rows - 1) * alley) * 0.5;
    const minW = Math.min(16, Math.max(8, wid * 0.8));
    let spent = 0;
    for (let k = 0; k < rows && spent < budget; k++) {
      const v = v0 + k * (dep + alley);
      let u = range(1, 6);
      while (len - u >= minW && spent < budget) {
        let w = range(24, 48);
        if (len - u - w < minW) w = len - u - range(1, 5);
        if (w < minW) break;
        if (spent + w * dep > budget) {
          const fit = (budget - spent) / dep;
          if (fit < minW) break;
          w = fit;
        }
        campusBuilding(blk, at(u, u + w, v, v + dep), cfg);
        spent += w * dep;
        u += w + range(10, 16);
      }
    }
    return spent;
  }
  // One small clinic, hall or workshop on a sliver, sized to exactly the remaining campus budget
  function campusShed(blk, C, cfg, budget) {
    const W = rectW(C), D = rectD(C);
    if (budget < 40 || Math.min(W, D) < 6) return 0;
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    let w = Math.min(len, Math.max(6, Math.min(14, budget / 6)));
    let dep = Math.min(wid, budget / w);
    if (dep < 5) {
      dep = Math.min(wid, 5);
      w = Math.min(len, budget / dep);
    }
    if (w < 5 || dep < 5) return 0;
    const u = (len - w) * 0.5;
    const v = (wid - dep) * 0.5;
    const r = alongX
      ? rect(C.x0 + u, C.x0 + u + w, C.z0 + v, C.z0 + v + dep)
      : rect(C.x0 + v, C.x0 + v + dep, C.z0 + u, C.z0 + u + w);
    const b = building(blk, pickW([[F.brick, 2], [F.cream, 2], [F.greyGreen, 1]]), r);
    mass(b, [r], 0, irange(1, 2));
    commit(blk, b, { cornice: false, skylights: true, shops: 'none', awnings: false, walls: WALL_KINDS.rear });
    return w * dep;
  }
  function campusBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 1.5));
    const W = rectW(R), D = rectD(R);
    const budget = Math.max(0, (cfg.share || 0.25) * W * D);
    // The frontage frames leave many 12-30 m slivers around a campus; the full alley grid cannot hold a pavilion
    // there, but a single small clinic or hall can, as long as it fits in that piece's share of the campus budget
    if (Math.min(W, D) < 24 || W * D < 2500) {
      const core = insetAll(R, 1);
      if (campusPavilions(blk, core, cfg, budget) === 0) campusShed(blk, core, cfg, budget);
      return;
    }
    const fronts = SIDES.filter((s) => blk.front[s]).sort((a, b) => sideLen(R, b) - sideLen(R, a));
    const depth = { n: 0, s: 0, w: 0, e: 0 };
    for (const s of fronts) depth[s] = Math.min(sideDepth(R, s) * 0.55, range(16, 24));
    const builtDepth = { n: 0, s: 0, w: 0, e: 0 };
    let spent = 0;
    const frontBudget = budget * 0.6;
    const ns = fronts.includes('n') || fronts.includes('s');
    for (const s of fronts) {
      if (spent >= frontBudget || frontBudget < 16 * depth[s]) continue;
      const along = s === 'n' || s === 's';
      const a0 = along || !ns ? 0 : depth.n;
      const a1 = along || !ns ? (along ? W : D) : D - depth.s;
      let a = a0;
      while (a1 - a >= 16 && spent < frontBudget) {
        let w = range(24, 48);
        if (a1 - a - w < 16) w = a1 - a - range(1, 5);
        if (w < 16) break;
        if (spent + w * depth[s] > frontBudget) {
          const fit = (frontBudget - spent) / depth[s];
          if (fit < 16) break;
          w = fit;
        }
        campusBuilding(blk, sideRect(R, s, a, a + w, 0, depth[s]), cfg);
        spent += w * depth[s];
        builtDepth[s] = Math.max(builtDepth[s], depth[s]);
        a += w + range(2, 6);
      }
    }
    const core = rect(R.x0 + (builtDepth.w ? builtDepth.w + 8 : 3), R.x1 - (builtDepth.e ? builtDepth.e + 8 : 3),
      R.z0 + (builtDepth.n ? builtDepth.n + 8 : 3), R.z1 - (builtDepth.s ? builtDepth.s + 8 : 3));
    campusPavilions(blk, core, cfg, budget - spent);
  }

  // Mapped sports/show/public facility on parkland (GEO.blockFootprints through parkFreeCells): one hall fills the
  // building's own OSM envelope, inset a little for its walls. The district profile would spend the same lot on a row
  // of kamienice or a sparse inner core — before this Hala Arena got 20 % of its outline under 3-8 m houses and Enea
  // Stadion 0.2 %. Floors come from the block's median OSM storeys (Wilda 3), with one more for a big footprint.
  function facilityBlock(blk) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 1.5));
    const w = rectW(R);
    const d = rectD(R);
    const inset = Math.max(2, Math.min(8, Math.min(w, d) * 0.07));
    const hall = insetAll(R, inset);
    if (rectW(hall) < 6 || rectD(hall) < 6) return;
    const floors = Math.max(3, Math.min(5, Math.round(((srcBlock && srcBlock.levels) || 3) * 0.9) +
      (rectW(hall) * rectD(hall) > 12000 ? 1 : 0)));
    const b = building(blk, pickW([[F.glassSilver, 2], [F.cream, 2], [F.greyGreen, 2], [F.brick, 1]]), R);
    mass(b, [hall], 0, floors);
    commit(blk, b, {
      cornice: false, hvac: true, hvacH: range(2.4, 3.6), skylights: true, shops: 'none', awnings: false, freestanding: true
    });
  }

  // ============================================================================
  // MAPPED OBJECTS (GEO.blockObjects): one mapped school, church, clinic, office or hall, built on its own OSM envelope.
  // The 2026-11-08 audit found the district profiles replaced these with generic mass; these layouts keep the object's
  // plan and give it the massing its use implies (a nave with a tower, school wings and a gym, hospital light courts,
  // hall bays). The envelope is the real footprint, so no forecourt or setback is added.
  // ============================================================================
  function fallbackEnvelope(f, shrink = true) {
    const [x0, x1, z0, z1, area] = f;
    if (!shrink) return [x0, x1, z0, z1];
    const bw = x1 - x0;
    const bd = z1 - z0;
    const s = area > 0 && bw > 0 && bd > 0 ? Math.min(1, Math.sqrt(area / (bw * bd))) : 1;
    return [x0 + (bw * (1 - s)) / 2, x1 - (bw * (1 - s)) / 2, z0 + (bd * (1 - s)) / 2, z1 - (bd * (1 - s)) / 2];
  }
  // World AABB of an oriented object rect [cx, cz, w, d, ang, area, use, levels]
  function objectBounds(o) {
    const [cx, cz, w, d, ang] = o;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const hw = w * 0.5, hd = d * 0.5;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      const x = cx + u * cs - v * sn, z = cz + u * sn + v * cs;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return [x0, x1, z0, z1];
  }
  // Frame-space AABBs of an object envelope, approximated by 4 m grid rows clipped to its rotated plan. A diagonal
  // hall's single AABB can span 10-40 m of a neighbouring frontage beyond its real walls (Kupiec Poznański's 4,899 m²
  // bloc on block 792 reached the Strzelecka frontage through its bounding-box corners alone, and the generic perimeter
  // layout then lost that whole stretch). The rows are cut in the lot frame, so a turned frontage frame does not turn
  // each row back into a large AABB. They cover the envelope (any touched cell is kept), so no generic lot can overlap
  // the mapped building, while the corners outside its walls stay available for the next kamienica.
  const OBJECT_RESERVE_CELL = 4;
  // Mapped objects stand on their real OSM outlines, so their faces are the property line, not the lot line. The
  // generated frontage lots stand SIDEWALK 4.6 m in from the curb; mapped objects used to accept a face 0.5 m from a
  // roadway, which on Podgórna left a 1.1 m pavement strip (block 770) and put Kupiec Poznański's envelope corner 1.5 m
  // from the curb. Keep a walkable 2.5 m instead. A few narrow objects cannot afford that at both ends and fall back to
  // the old half-metre rule rather than disappearing (see populateObject).
  const OBJECT_CURB_CLEAR = 2.5;
  // Kupiec Poznański (Plac Wiosny Ludów 2): the one retail object on block 792. Its mapped minimum-area rectangle is
  // 101 x 63.7 m across the corner of Podgórna and Plac Wiosny Ludów, and its real L-plan/atrium is not a retail hall.
  const KUPIEC_BLOCK = 792;
  function isKupiecObject(o) {
    return srcBlock && srcBlock.id === KUPIEC_BLOCK && o[6] === 1 && o[7] >= 6 && o[5] >= 4000;
  }
  // The Kupiec plan in its own minimum-area-rectangle frame, relative to the object centre: u runs along Strzelecka,
  // v across it towards the street (positive v is the Strzelecka side, negative v faces Podgórna). The south wall at
  // v = 28.7 keeps the full SIDEWALK 4.6 m pavement after the 2.7° frame-snapped turn; the old +31.5 left only 3.1 m
  // there. The north side at -27.55/-25.75/-25.05/-23.75 likewise clears the Podgórna pavement. The north-west corner
  // steps back from the raw rectangle along Podgórna and Plac Wiosny Ludów, where the rectangle reached across the
  // curb. Each tread lies at least 4.6 m inside the block outline. The fifth value marks the glazed corner module.
  function kupiecParts() {
    return [
      [20, 50, -27.55, -12, 0], // east wing, north of the recess
      [6, 20, -25.75, -12, 0], // front wing on Podgórna
      [4, 6, -25.05, -12, 0], // front wing step
      [4, 50, -12, 28.7, 0], // east wing along Strzelecka (the snapped turn needs 0.8 m more setback)
      [-16, 4, -10, 28.7, 0], // west wing behind the glazed corner
      [-34, -16, -10, 28.7, 1], // glazed west front
      [-34, -24, -12.2, -10, 1], // cut corner tread 1
      [-24, -12, -15.8, -12.2, 1], // cut corner tread 2
      [-12, 0, -20, -15.8, 1], // cut corner tread 3
      [0, 4, -23.75, -20, 1] // cut corner tread 4
    ];
  }
  function objectReserveBoxes(o, frame) {
    const [cx, cz, w0, d0, , area] = o;
    const s = area > 0 && w0 * d0 > 0 ? Math.min(1, Math.sqrt(area / (w0 * d0))) : 1;
    const kupiec = isKupiecObject(o);
    const w = kupiec ? w0 : w0 * s, d = kupiec ? d0 : d0 * s;
    if (!(w > 0 && d > 0)) return [];
    const th = frame ? frame.th : 0;
    const cs = Math.cos(th), sn = Math.sin(th);
    const px = frame ? frame.px : 0, pz = frame ? frame.pz : 0;
    const fcx = px + (cx - px) * cs - (cz - pz) * sn;
    const fcz = pz + (cx - px) * sn + (cz - pz) * cs;
    // The object is built snapped to its street frame (populateObject), so its reserve must use that same turn; the
    // raw OSM angle would leave a wedge of the reserve in the frontage lot and the wall outside it. The built object's
    // world long axis is -snappedObjectAngle(o); in frame coordinates that is alpha + th.
    const phi = -snappedObjectAngle(o) + th;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const C = OBJECT_RESERVE_CELL;
    // A cell is reserved when its centre falls inside the envelope inflated by the cell's half-diagonal: any cell that
    // could touch the building then has its centre within that margin, so the reserve is a superset of the plan (no
    // generic lot can overlap it) while the ring around it stays as thin as the grid allows.
    const margin = C * Math.SQRT1_2;
    const hw = w * 0.5 + margin, hd = d * 0.5 + margin;
    const ex = hw * Math.abs(cp) + hd * Math.abs(sp);
    const ez = hw * Math.abs(sp) + hd * Math.abs(cp);
    const x0 = fcx - ex, x1 = fcx + ex, z0 = fcz - ez, z1 = fcz + ez;
    let inside;
    if (kupiec) {
      // The L-plan leaves the cut Plac corner unbuilt. Reserving only the L let a generic kamienica stand 0.3 m from
      // the Podgórna roadway in that corner; reserving the whole rectangle took the Strzelecka frontage away. Reserve
      // the L plus only the unused cells that fall in the pavement band or outside the block, so safe corners stay
      // buildable.
      const parts = kupiecParts();
      const local = (x, z) => {
        const dx = x - fcx, dz = z - fcz;
        return [dx * cp + dz * sp, -dx * sp + dz * cp];
      };
      const toWorldPoint = (x, z) => (frame
        ? [frame.px + (x - frame.px) * cs + (z - frame.pz) * sn,
          frame.pz - (x - frame.px) * sn + (z - frame.pz) * cs]
        : [x, z]);
      inside = (x, z) => {
        const [u, v] = local(x, z);
        if (parts.some((p) => u >= p[0] - margin && u <= p[1] + margin &&
          v >= p[2] - margin && v <= p[3] + margin)) return true;
        const [wx, wz] = toWorldPoint(x, z);
        return roadClearance(wx, wz) < YARD_ROAD_KEEP || !insideCurbIsland(wx, wz);
      };
    } else {
      inside = (x, z) => {
        const dx = x - fcx, dz = z - fcz;
        return Math.abs(dx * cp + dz * sp) <= hw && Math.abs(-dx * sp + dz * cp) <= hd;
      };
    }
    const i0 = Math.floor(x0 / C), i1 = Math.ceil(x1 / C);
    const j0 = Math.floor(z0 / C), j1 = Math.ceil(z1 / C);
    const boxes = [];
    for (let j = j0; j < j1; j++) {
      const za = j * C, zb = za + C;
      let run = null;
      for (let i = i0; i <= i1; i++) {
        const xa = i * C, xb = xa + C;
        const hit = i < i1 && inside(xa + C * 0.5, za + C * 0.5);
        if (hit && run === null) run = xa;
        if (!hit && run !== null) {
          boxes.push([run, xa, za, zb]);
          run = null;
        }
      }
      if (run !== null) boxes.push([run, i1 * C, za, zb]);
    }
    return boxes;
  }
  // A fallback envelope is a world rect from GEO.blockFallbackLots. It must stand inside the source block's curb
  // island and clear of every roadway and pedestrian corridor: populateBlock fills a whole perimeter block (rows,
  // corner houses, oficyny) on it, so a lot that reaches a street would put houses in the street.
  function insideCurbIsland(x, z, tolerance = 0) {
    if (!srcBlock || !srcBlock.poly || srcBlock.poly.length < 3) return false;
    const inside = pointInBlockPoly(srcBlock, x, z);
    if (inside || tolerance <= 0) return inside;
    const poly = srcBlock.poly;
    // A fallback envelope can share the property line with the curb polygon, and a 0.03 m corner outside it used to
    // drop a whole mapped building (block 802's Ogrodowa/Długa frontage). Accept points within `tolerance` of the line;
    // roadway and pedestrian clearance are checked separately and stay strict.
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      const vx = b.x - a.x, vz = b.z - a.z;
      const len2 = vx * vx + vz * vz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / len2));
      const dx = x - (a.x + vx * t), dz = z - (a.z + vz * t);
      if (dx * dx + dz * dz <= tolerance * tolerance) return true;
    }
    return false;
  }
  // A yard slab is meant to be a courtyard inside the block, never a lawn in the street. Mapped-object envelopes and
  // turned frontage frames could push one far past its lot: Kupiec Poznański's raw 101 x 63.7 m yard reached 6.8 m
  // into Plac Wiosny Ludów / Podgórna and covered the tram tracks and the pavement. Sample the turned rectangle's
  // perimeter every ~2 m plus a 3x3 inner grid, and drop the whole slab on the first probe that leaves the curb island,
  // enters the 4.6 m pavement band (SIDEWALK in tools/poz-blocks.mjs), a pedestrian corridor or a rail/tram track.
  // The old half-metre roadway rule still let a large courtyard cover the pavement, which reads as a lawn in the street.
  const YARD_ROAD_KEEP = 4.6;
  function yardFitsBlock(y) {
    const cs = Math.cos(y.ry || 0), sn = Math.sin(y.ry || 0);
    const cx = (y.x0 + y.x1) * 0.5, cz = (y.z0 + y.z1) * 0.5;
    const hx = (y.x1 - y.x0) * 0.5, hz = (y.z1 - y.z0) * 0.5;
    const check = (u, v) => {
      const x = cx + u * cs + v * sn, z = cz - u * sn + v * cs;
      return roadClearance(x, z) >= YARD_ROAD_KEEP && pedestrianClearance(x, z) >= 0.5 &&
        railClearance(x, z) >= 0.5 && insideCurbIsland(x, z);
    };
    const nu = Math.max(1, Math.ceil((2 * hx) / 2));
    const nv = Math.max(1, Math.ceil((2 * hz) / 2));
    for (let i = 0; i <= nu; i++) {
      const u = -hx + (2 * hx * i) / nu;
      if (!check(u, -hz) || !check(u, hz)) return false;
    }
    for (let j = 0; j <= nv; j++) {
      const v = -hz + (2 * hz * j) / nv;
      if (!check(-hx, v) || !check(hx, v)) return false;
    }
    for (const fu of [-0.5, 0, 0.5]) {
      for (const fv of [-0.5, 0, 0.5]) if (!check(hx * fu, hz * fv)) return false;
    }
    return true;
  }
  // A yard that fails yardFitsBlock is clipped to its largest clear rectangle instead of dropped: the 4d14df9
  // courtyards of a whole perimeter block often touch the pavement band at one corner only, and dropping them left
  // grey block ground where the reference has a courtyard (Łazarz -2600..-2300 x 1500..1800 lost two). The turned
  // rectangle is sampled on a <= YARD_CLIP_STEP grid in its own frame; the largest all-clear sub-rectangle with both
  // sides >= YARD_MIN_SIDE is re-checked with yardFitsBlock (whose 2 m perimeter probes are the test's) and inset by
  // half a metre at a time if a probe between the samples still fails.
  const YARD_CLIP_STEP = 1.25;
  const YARD_MIN_SIDE = 4;
  function clipYard(y) {
    if (yardFitsBlock(y)) return y;
    const cs = Math.cos(y.ry || 0), sn = Math.sin(y.ry || 0);
    const cx = (y.x0 + y.x1) * 0.5, cz = (y.z0 + y.z1) * 0.5;
    const hx = (y.x1 - y.x0) * 0.5, hz = (y.z1 - y.z0) * 0.5;
    if (2 * hx < YARD_MIN_SIDE || 2 * hz < YARD_MIN_SIDE) return null;
    const nu = Math.ceil((2 * hx) / YARD_CLIP_STEP), nv = Math.ceil((2 * hz) / YARD_CLIP_STEP);
    const du = (2 * hx) / nu, dv = (2 * hz) / nv;
    // heights[i]: clear sample points in column i ending at the current row (histogram of the maximal-rectangle scan)
    const heights = new Array(nu + 1).fill(0);
    let best = null, bestArea = 0;
    for (let j = 0; j <= nv; j++) {
      const v = -hz + j * dv;
      for (let i = 0; i <= nu; i++) {
        const u = -hx + i * du;
        const x = cx + u * cs + v * sn, z = cz - u * sn + v * cs;
        const ok = roadClearance(x, z) >= YARD_ROAD_KEEP && pedestrianClearance(x, z) >= 0.5 &&
          railClearance(x, z) >= 0.5 && insideCurbIsland(x, z);
        heights[i] = ok ? heights[i] + 1 : 0;
      }
      // Every maximal rectangle with its bottom on row j: for each column, the widest run at least as tall
      const stack = [];
      for (let i = 0; i <= nu + 1; i++) {
        const h = i <= nu ? heights[i] : 0;
        let start = i;
        while (stack.length && stack[stack.length - 1][1] >= h) {
          const [s0, sh] = stack.pop();
          const w = (i - 1 - s0) * du, d = (sh - 1) * dv;
          if (w >= YARD_MIN_SIDE && d >= YARD_MIN_SIDE && w * d > bestArea) {
            bestArea = w * d;
            best = [-hx + s0 * du, -hx + (i - 1) * du, v - d, v];
          }
          start = s0;
        }
        if (h > 0) stack.push([start, h]);
      }
    }
    if (!best) return null;
    for (let inset = 0; inset <= 1.5; inset += 0.5) {
      const [u0, u1, v0, v1] = [best[0] + inset, best[1] - inset, best[2] + inset, best[3] - inset];
      if (u1 - u0 < YARD_MIN_SIDE || v1 - v0 < YARD_MIN_SIDE) return null;
      const uc = (u0 + u1) * 0.5, vc = (v0 + v1) * 0.5;
      const ncx = cx + uc * cs + vc * sn, ncz = cz - uc * sn + vc * cs;
      const hw = (u1 - u0) * 0.5, hd = (v1 - v0) * 0.5;
      const clipped = { ...y, x0: ncx - hw, x1: ncx + hw, z0: ncz - hd, z1: ncz + hd };
      if (yardFitsBlock(clipped)) return clipped;
    }
    return null;
  }
  function fallbackPartClear(x0, x1, z0, z1) {
    const at = (lx, lz) => toWorld(lx, lz);
    const probes = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      probes.push([x0 + (x1 - x0) * t, z0], [x0 + (x1 - x0) * t, z1],
        [x0, z0 + (z1 - z0) * t], [x1, z0 + (z1 - z0) * t]);
    }
    probes.push([(x0 + x1) * 0.5, (z0 + z1) * 0.5]);
    for (const [lx, lz] of probes) {
      const [x, z] = at(lx, lz);
      if (roadClearance(x, z) < 0 || pedestrianClearance(x, z) < 0 || railClearance(x, z) < 0.5 ||
        !insideCurbIsland(x, z, 0.5)) return false;
    }
    return true;
  }
  function objectProfile(o) {
    const use = o[6];
    const levels = o[7] || 0;
    const floors = use === 7 ? [2, 3] : use === 6 ? [2, 4] : use === 8 ? [3, 5] : use === 10 ? [3, 7]
      : use === 9 ? [3, 5] : use === 1 ? [2, 4] : use === 4 ? [4, 6] : [2, 3];
    return { kind: 'object', objectUse: use, object: o, levels, floors };
  }
  // Kupiec Poznański: a six-storey department store and office block, not the generic 2-4 storey retail hall. The
  // mass follows the safe part of the OSM envelope: an L along Podgórna and Plac Wiosny Ludów with a stepped cut
  // corner, and a glazed corner module (F.glassSilver) at the junction. All local coordinates are in the object's
  // minimum-area-rectangle frame; the object is turned into place by populateObject, so the -z edge faces Podgórna.
  // The plan itself lives in kupiecParts, shared with objectReserveBoxes so the reserve and the walls cannot drift.
  function kupiecBlock(blk, R) {
    const floors = 6; // OSM building:levels and the real 26.6 m block
    const cx = (R.x0 + R.x1) * 0.5; // local u = 0
    const cz = (R.z0 + R.z1) * 0.5; // local v = 0
    const at = ([u0, u1, v0, v1]) => rect(cx + u0, cx + u1, cz + v0, cz + v1);
    const parts = kupiecParts();
    // The glazed west end fills the corner of Plac Wiosny Ludów and the Podgórna cut; the sandstone wings run east
    // along Podgórna and round the large atrium/recess.
    const main = building(blk, F.sandstone, R);
    mass(main, parts.filter((p) => p[4] === 0).map(at), 0, floors);
    // The glazed corner is the whole west end plus the four-tread diagonal cut where the raw minimum-area rectangle
    // crossed Podgórna and Plac Wiosny Ludów.
    const corner = building(blk, F.glassSilver, R);
    mass(corner, parts.filter((p) => p[4] === 1).map(at), 0, floors);
    commit(blk, main, { cornice: false, hvac: true, hvacH: range(3, 4.6), skylights: true, shops: 'all',
      awnings: false, freestanding: true });
    commit(blk, corner, { cornice: false, hvac: false, skylights: false, shops: 'all', awnings: false,
      freestanding: true });
  }

  function objectBlock(blk, cfg) {
    const R = blockRect(blk);
    const W = rectW(R);
    const D = rectD(R);
    if (Math.min(W, D) < 5) return;
    const use = cfg.objectUse;
    const lv = cfg.levels;
    if (srcBlock && srcBlock.id === KUPIEC_BLOCK && use === 1 && lv >= 6) {
      kupiecBlock(blk, R);
      return;
    }
    blk.yards.push(insetAll(R, 0.5));
    const fl = (a, b) => (lv >= 1 ? Math.max(a, Math.min(b, Math.round(lv))) : irange(a, b));
    const alongX = W >= D;
    const len = alongX ? W : D;
    const wid = alongX ? D : W;
    const at = (u0, u1, v0, v1) => (alongX
      ? rect(R.x0 + u0, R.x0 + u1, R.z0 + v0, R.z0 + v1)
      : rect(R.x0 + v0, R.x0 + v1, R.z0 + u0, R.z0 + u1));

    // A nave running along the long axis with a square tower at one end, gabled roofs; chapels too small for a tower
    // stay a single gabled hall.
    if (use === 7) {
      const mat = pickW([[F.brick, 4], [F.cream, 2], [F.yellowBrick, 1], [F.sandstone, 1]]);
      const b = building(blk, mat, R);
      const naveF = Math.max(2, Math.min(3, lv ? Math.round(lv) : 2));
      if (len >= 18 && wid >= 9) {
        const ts = Math.min(wid, Math.max(6, Math.min(11, len * 0.22)));
        const west = chance(0.5);
        const tower = alongX
          ? rect(west ? R.x0 : R.x1 - ts, west ? R.x0 + ts : R.x1, R.z0, R.z0 + ts)
          : rect(R.x0, R.x0 + ts, west ? R.z0 : R.z1 - ts, west ? R.z0 + ts : R.z1);
        const nave = alongX
          ? rect(west ? R.x0 + ts : R.x0, west ? R.x1 : R.x1 - ts, R.z0, R.z1)
          : rect(R.x0, R.x1, west ? R.z0 + ts : R.z0, west ? R.z1 : R.z1 - ts);
        const navePart = mass(b, [nave], 0, naveF);
        pitch(navePart, 'gable', pickW([['tile', 3], ['slate', 1]]), alongX ? 'x' : 'z', range(45, 55));
        const towerPart = mass(b, [tower], 0, Math.max(3, Math.min(6, naveF + 2)));
        pitch(towerPart, 'hip', pickW([['slate', 2], ['copper', 1], ['tile', 1]]), alongX ? 'x' : 'z', 55);
      } else {
        const navePart = mass(b, [insetAll(R, 0.4)], 0, naveF);
        pitch(navePart, 'gable', pickW([['tile', 2], ['slate', 1]]), alongX ? 'x' : 'z', range(40, 50));
      }
      commit(blk, b, { cornice: true, corniceH: 0.5, shops: 'none', awnings: false, chimneys: false });
      return;
    }

    // School: a long main wing with a lower gym/annex on the remaining third and a small entrance pavilion. Pitched
    // roofs on the older schools, flat plant rooms on the newer ones.
    if (use === 6) {
      const mat = pickW([[F.brick, 3], [F.cream, 3], [F.greyGreen, 2], [F.yellowBrick, 1]]);
      const b = building(blk, mat, R);
      const f = fl(2, 4);
      if (len >= 30 && wid >= 12) {
        const mainLen = len * range(0.55, 0.68);
        const gap = range(1.5, 3);
        const main = at(0, mainLen, 0, wid);
        const wing = mass(b, [main], 0, f);
        if (chance(0.55)) pitch(wing, 'hip', pickW([['tile', 2], ['slate', 1]]), alongX ? 'x' : 'z', range(22, 30));
        const annex = at(Math.min(len - 6, mainLen + gap), len, wid * 0.08, wid * 0.92);
        if (rectW(annex) >= 6 && rectD(annex) >= 6) mass(b, [annex], 0, Math.max(1, Math.min(2, f - 1)));
      } else {
        mass(b, [insetAll(R, 0.4)], 0, f);
      }
      commit(blk, b, { cornice: !chance(0.5), hvac: 'small', hvacH: range(2.4, 3.2), skylights: true, shops: 'none',
        awnings: false, freestanding: true });
      return;
    }

    // Hospital / clinic: one continuous block with light courts cut into the core, so the plan reads as wings joined by
    // links instead of a single shed; a taller plant/lift block at one end where the envelope is large.
    if (use === 8) {
      const mat = pickW([[F.cream, 3], [F.greyGreen, 2], [F.glassSilver, 1], [F.brick, 1]]);
      const b = building(blk, mat, R);
      const f = fl(3, 5);
      const holes = [];
      if (W * D > 1800 && len >= 30) {
        const n = Math.max(1, Math.min(3, Math.round(len / 45)));
        for (let k = 0; k < n; k++) {
          const u0 = (len * (k + 0.5)) / n - len / (n * 3.4);
          const u1 = (len * (k + 0.5)) / n + len / (n * 3.4);
          holes.push(at(u0, u1, wid * 0.3, wid * 0.7));
        }
      }
      mass(b, holes.length ? carve(R, holes, alongX ? 'x' : 'z') : [insetAll(R, 0.4)], 0, f);
      const tower = at(len * 0.08, len * 0.08 + Math.min(14, len * 0.3), wid * 0.1, wid * 0.45);
      if (rectW(tower) >= 8 && rectD(tower) >= 8) mass(b, [tower], 0, f + 1);
      commit(blk, b, { cornice: false, hvac: true, hvacH: range(2.4, 4), skylights: true, shops: 'none', awnings: false,
        freestanding: true });
      return;
    }

    // Office: a 2-3 storey podium fills the envelope and the shaft is set back, with a corner notch on the larger plans.
    if (use === 10) {
      const mat = pickW([[F.glassSilver, 2], [F.glassTeal, 1], [F.cream, 2], [F.greyGreen, 1]]);
      const b = building(blk, mat, R);
      const f = fl(3, 7);
      const podium = Math.min(3, f - 1);
      mass(b, [R], 0, podium);
      const setback = Math.min(4, Math.min(W, D) * 0.12);
      const shaft = insetAll(R, setback);
      if (rectW(shaft) >= 8 && rectD(shaft) >= 8) {
        const holes = W * D > 2500 ? shapeHoles(shaft, pick(['notched', 'L', 'plain'])) : [];
        mass(b, holes.length ? carve(shaft, holes, 'x') : [shaft], podium, f);
      } else mass(b, [R], podium, f);
      commit(blk, b, { cornice: false, hvac: true, hvacH: range(2.4, 3.6), shops: 'all', awnings: false,
        freestanding: true });
      return;
    }

    // Civic/public building: a stone institutional block with a raised central bay and a cornice.
    if (use === 9) {
      const mat = pickW([[F.sandstone, 2], [F.cream, 2], [F.greyGreen, 2], [F.brick, 1]]);
      const b = building(blk, mat, R);
      const f = fl(3, 5);
      mass(b, [insetAll(R, 0.4)], 0, f);
      const central = at(len * 0.3, len * 0.7, wid * 0.2, wid * 0.8);
      if (rectW(central) >= 8 && rectD(central) >= 8) mass(b, [central], f, f + 1);
      commit(blk, b, { cornice: true, shops: chance(0.5) ? 'all' : 'none', awnings: false });
      return;
    }

    // Retail/commercial hall: one broad low box; the large ones get rooflights and packaged plant.
    if (use === 1) {
      const mat = pickW([[F.cream, 3], [F.greyGreen, 2], [F.brick, 2], [F.glassSilver, 1]]);
      const b = building(blk, mat, R);
      const f = W * D >= 8000 ? fl(3, 4) : fl(2, 3);
      mass(b, [insetAll(R, 0.4)], 0, f);
      commit(blk, b, { cornice: false, hvac: true, hvacH: range(2.4, 4), skylights: true, shops: 'all', awnings: false,
        freestanding: true });
      return;
    }

    // Industry, rail depot and utility: hall bays under gables, a low office at one end and (for a utility) a taller
    // boiler house.
    if (use === 2 || use === 3 || use === 5) {
      const mat = pickW(use === 3 ? DEPOT.mats : use === 5 ? UTILITY.mats : INDUSTRIAL_HALL.mats);
      const b = building(blk, mat, R);
      const f = use === 5 ? fl(4, 7) : fl(2, 3);
      if (use === 5 && len >= 20) {
        const hall = at(0, len * 0.62, wid * 0.08, wid * 0.92);
        mass(b, [hall], 0, Math.max(2, f - 2));
        const tall = at(len * 0.7, len * 0.96, wid * 0.18, wid * 0.82);
        if (rectW(tall) >= 6 && rectD(tall) >= 6) mass(b, [tall], 0, f);
      } else {
        const bays = Math.max(1, Math.min(6, Math.round(len / range(22, 32))));
        const gap = 0.8;
        const step = (len - gap * (bays - 1)) / bays;
        for (let k = 0; k < bays; k++) {
          const p = mass(b, [at(k * (step + gap), k * (step + gap) + step, 0, wid)], 0, f);
          if (wid >= 10 && chance(0.75)) pitch(p, 'gable', pickW([['slate', 2], ['tile', 1]]), alongX ? 'z' : 'x',
            range(10, 18));
        }
      }
      commit(blk, b, { cornice: false, hvac: use === 2 && chance(0.3), hvacH: range(2.4, 3.6), shops: 'none',
        awnings: false, walls: WALL_KINDS.blankStone, freestanding: true });
      return;
    }

    // Sport/leisure: a hall filling the envelope, with a two-storey podium and a stepped upper volume.
    const mat = pickW(ARENA.mats);
    const b = building(blk, mat, R);
    const f = fl(4, 6);
    mass(b, [R], 0, Math.min(2, f - 1));
    mass(b, [insetAll(R, Math.min(4, Math.min(W, D) * 0.1))], Math.min(2, f - 1), f);
    commit(blk, b, { cornice: false, hvac: true, hvacH: range(2.4, 4), skylights: true, shops: 'none', awnings: false,
      freestanding: true });
  }

  function objectBlockLayout(blk, cfg) {
    objectBlock(blk, cfg);
  }

  const LAYOUTS = {
    res: residentialBlock,
    facility: facilityBlock,
    rynek: residentialBlock, // with cfg.rynekRows on the frontages facing the square
    cesarska: cesarskaBlock,
    offices: officeBlock,
    loft: loftBlock,
    projects: projectsBlock,
    lowrise: lowriseBlock,
    fair: fairBlock,
    villas: villaBlock,
    campus: campusBlock,
    mall: mallBlock,
    retail: retailParkBlock,
    industrial: industrialBlock,
    depot: depotBlock,
    stadium: stadiumBlock,
    arena: arenaBlock,
    utility: utilityBlock,
    anchor: anchorBlock,
    ancillary: ancillaryBlock,
    object: objectBlockLayout
  };

  // ============================================================================
  // DISTRICT PROFILES (GEO.districts osiedla, refined inside Stare Miasto by areas anchored on landmark sites)
  // A ~5-storey European city: kamienice round the perimeter of every block, corner houses a storey taller, nothing
  // generic above 6 storeys outside the office quarters (the real towers are landmark models)
  // ============================================================================
  const RES_BASE = {
    kind: 'res',
    mats: [[F.ochre, 3], [F.cream, 3], [F.greyGreen, 2], [F.salmon, 2], [F.brick, 1]], // kamienice & corner houses
    corner: [18, 24], // corner square (m): the corner house's lot along both streets
    cornerFloors: [5, 5],
    turretP: 0.4,
    cornerShops: 0.85,
    shops: 0.45, // share of row kamienice with storefronts
    roofs: [['mansard', 3], ['gable', 2], ['hip', 1]],
    roofMats: [['tile', 3], ['slate', 2]],
    rows: [['kamienica', 9], ['modernist1930s', 0.7], ['postwarBlock', 0.5], ['infill', 0.6], ['gap', 0.3]],
    kf: { kamienica: [4, 5] }
  };
  const res = (o) => ({ ...RES_BASE, ...o });

  // Jeżyce and Łazarz: unbroken frontages of 4-5-storey kamienice (15-19 m at 3.8 m storeys), turrets on the corners
  const RES_KAMIENICE = res({ turretP: 0.5 });
  // Wilda: the same blocks, in red and yellow brick more often than render
  const RES_WILDA = res({ turretP: 0.45, mats: [[F.brick, 4], [F.yellowBrick, 3], [F.ochre, 1], [F.cream, 1], [F.salmon, 1]] });
  // Centrum (Św. Marcin, Ratajczaka, Półwiejska): a touch grander, shops on nearly every ground floor, more infill
  const RES_CENTRUM = res({
    mats: [[F.cream, 3], [F.ochre, 2], [F.sandstone, 2], [F.greyGreen, 1], [F.salmon, 1]],
    cornerFloors: [5, 6],
    cornerShops: 0.95,
    shops: 0.8,
    rows: [['kamienica', 7], ['postwarBlock', 1], ['infill', 1.2], ['modernist1930s', 1]],
    kf: { kamienica: [4, 5], postwarBlock: [5, 6], infill: [4, 6] }
  });
  // Stare Miasto round the Rynek, Garbary, Chwaliszewo: 3-5-storey kamienice, mixed, pavilions; no base frontage gap
  // (steerProfile adds war gaps only to sparser blocks outside the historic centre)
  const RES_STARE = res({
    corner: [14, 20],
    cornerFloors: [4, 5],
    turretP: 0.15,
    shops: 0.6,
    rows: [['kamienica', 7], ['infill', 1], ['postwarBlock', 0.8], ['low', 0.38]],
    kf: { kamienica: [3, 5], postwarBlock: [4, 5] }
  });
  const RES_STARE_LEGACY = { ...RES_STARE,
    rows: [['kamienica', 7], ['infill', 1], ['postwarBlock', 0.8], ['low', 0.38], ['gap', 0.18]] };
  // Stary Rynek: the frontages facing the square are rows of rynekHouses, the back streets Old Town
  // (corner squares of 10-14 m: the medieval lots are narrow on the corners too)
  const RYNEK = { ...RES_STARE, kind: 'rynek', rynekRows: [['rynekHouse', 1]], corner: [10, 14], cornerShops: 1 };
  // Dzielnica Cesarska: monumental 4-5-storey sandstone public buildings and grand 4-6-storey kamienice
  const CESARSKA = res({
    kind: 'cesarska',
    mats: [[F.sandstone, 4], [F.cream, 2], [F.greyGreen, 1]],
    monumentMats: [[F.sandstone, 3], [F.brick, 1]],
    monument: [4, 5],
    monumentP: 0.6,
    corner: [20, 26],
    cornerFloors: [5, 6],
    turretP: 0.5,
    shops: 0.6,
    roofMats: [['slate', 3], ['copper', 1], ['tile', 1]],
    rows: [['kamienica', 1]],
    kf: { kamienica: [4, 6] },
    inner: [['rear', 2], ['pavilion', 2], ['yard', 1]]
  });
  // Ostrów Tumski, Śródka: two- and three-storey houses among gardens and churches
  const RES_OSTROW = res({
    corner: [12, 16],
    cornerFloors: [2, 3],
    turretP: 0,
    cornerShops: 0.3,
    shops: 0.25,
    roofs: [['gable', 3], ['hip', 2], ['mansard', 1]],
    roofMats: [['tile', 1]],
    rows: [['kamienica', 3], ['villa', 3], ['low', 1], ['gap', 2.5]],
    kf: { kamienica: [2, 3], villa: [2, 3] },
    inner: [['yard', 4], ['rear', 1], ['works', 1]] // the canons' gardens and church yards stay green
  });
  // Sołacz, Winiary and the garden suburbs: detached villas in their gardens (villaBlock), the odd flat-roofed 1930s
  // one. Storeys follow the block's median (steerProfile)
  const RES_VILLAS = { kind: 'villas', mats: ROW_KINDS.villa.mats, kf: { villa: [2, 3] } };
  // Round Rondo Kaponiera, Plac Andersa and Collegium Altum: offices of 6-20 storeys (podium 2-4 + shaft 4-16); the
  // courtyard core behind the frontage slabs is 3-6 storeys (12-24 m) of glass or stone
  const OFFICES = {
    kind: 'offices', tower: [4, 16], mid: [6, 9], towerP: 0.45, coreFloors: [3, 6],
    inner: [['pavilion', 3], ['works', 1], ['yard', 1]]
  };
  // Business Garden Marcelin (blockStats programme 9): modern 4-6 storey office pavilions round courtyards, without
  // the Rondo Kaponiera tower stack. The OSM block is 27 % built and six storeys, so KIND_SHARE.offices 0.29 fits.
  const OFFICE_CAMPUS = {
    kind: 'offices', tower: [6, 6], mid: [4, 6], towerP: 0.25, coreFloors: [2, 4],
    inner: [['pavilion', 2], ['yard', 3], ['works', 1]]
  };
  // Rataje, Chartowo, Winogrady (where they reach the detail box): osiedla of panel slabs, by storeys and weight
  const PROJECTS = { kind: 'projects', types: [[5, 5], [11, 2.5], [16, 1]], setback: [8, 12] };
  // Nowe Winogrady, Żegrze, Piątkowo: whole districts of slabs. `estate` keeps the slabs where steerProfile would turn
  // a low or dense panel block into kamienice (right for Stare Winogrady's mix, wrong here: their 5-storey slabs read
  // as a 5-storey median and their 19% built share is over the slab layout's 10%)
  const ESTATE = { ...PROJECTS, estate: true };
  // Garbary's warehouses, the breweries and works: brick lofts
  const LOFT_BASE = { kind: 'loft', lotW: [10, 24], throughP: 0.5, floors: [3, 6], mats: [[F.brick, 5], [F.yellowBrick, 3], [F.cream, 1]], setbackAt: 99, balconyP: 0 };
  // Główna and the rail-side quarters: brick warehouses, sheds and works
  const LOWRISE = { kind: 'lowrise', floors: [1, 4] };
  // Międzynarodowe Targi Poznańskie: exhibition halls 11-18 m tall in a grid of 12-18 m alleys, glass foyers on some,
  // 8 m forecourts along the streets. The fairground is one 29 ha curb island (the block under the Iglica)
  const FAIRGROUND = { kind: 'fair', hall: [45, 95], span: [35, 70], alley: [12, 18], h: [11, 18], forecourt: 8 };
  // Hospital and university campuses (GEO.blockStats program, from OSM building tags): 2-5 storey clinics, institutes
  // and halls of residence, flat roofs with plant rooms, a minority of the university buildings under tile or slate.
  // The campus layout fills the whole block, not just its perimeter (see campusBlock)
  const HOSPITAL = { kind: 'campus', program: 1, floors: [2, 5], pitched: 0.08,
    mats: [[F.cream, 3], [F.greyGreen, 2], [F.glassSilver, 2], [F.sandstone, 1]] };
  const UNIVERSITY = { kind: 'campus', program: 2, floors: [2, 4], pitched: 0.3,
    mats: [[F.cream, 3], [F.sandstone, 2], [F.greyGreen, 2], [F.brick, 1]] };
  // Civil programmes from the 2026-11-08 missing-objects audit: schools, churches and civic/public blocks no longer
  // fall back to kamienice or osiedle slabs. They keep the low campus layout, with more pitched roofs round a church
  // and institutional stone/cream walls for offices and public buildings.
  const SCHOOL_BLOCK = { kind: 'campus', program: 9, floors: [2, 4], pitched: 0.4,
    mats: [[F.brick, 3], [F.cream, 3], [F.greyGreen, 2], [F.yellowBrick, 1]] };
  const SACRAL_BLOCK = { kind: 'campus', program: 10, floors: [2, 3], pitched: 0.7,
    mats: [[F.brick, 3], [F.cream, 2], [F.yellowBrick, 1], [F.sandstone, 1]] };
  const CIVIC_BLOCK = { kind: 'campus', program: 11, floors: [3, 5], pitched: 0.15,
    mats: [[F.sandstone, 2], [F.cream, 2], [F.greyGreen, 2], [F.brick, 1]] };
  // Non-residential profiles (audit 2026-11-08): one broad mall box, retail-park halls, industrial halls,
  // depots, stadium/arena bowls and technical utility volumes. Heights follow the real objects: a mall is
  // 3-4 storeys of curtain wall (12-16 m), a big-box 2 storeys (7.6 m), an industrial hall 2-3 storeys (7.6-11.4 m),
  // a stadium 6-8 storeys (23-31 m), an arena 5-7 (19-27 m) and a utility 4-7 (15-27 m).
  const MALL = { kind: 'mall', floors: [3, 4], forecourt: 12,
    mats: [[F.glassSilver, 2], [F.glassTeal, 1], [F.cream, 1], [F.greyGreen, 1]] };
  const RETAIL_PARK = { kind: 'retail', floors: [2, 2], forecourt: 22,
    mats: [[F.cream, 3], [F.greyGreen, 2], [F.brick, 2], [F.yellowBrick, 1]] };
  const INDUSTRIAL_HALL = { kind: 'industrial', floors: [2, 3],
    mats: [[F.brick, 4], [F.yellowBrick, 3], [F.greyGreen, 2], [F.cream, 1]] };
  const DEPOT = { kind: 'depot', floors: [2, 3],
    mats: [[F.yellowBrick, 4], [F.brick, 3], [F.cream, 1]] };
  const STADIUM = { kind: 'stadium', floors: [6, 8], stand: 22, pitch: [104, 68],
    mats: [[F.glassSilver, 2], [F.cream, 2], [F.greyGreen, 1], [F.sandstone, 1]] };
  const ARENA = { kind: 'arena', floors: [5, 7],
    mats: [[F.glassSilver, 2], [F.glassTeal, 1], [F.cream, 2], [F.sandstone, 1]] };
  const UTILITY = { kind: 'utility', floors: [4, 7],
    mats: [[F.brick, 3], [F.greyGreen, 2], [F.cream, 1], [F.yellowBrick, 1]] };
  // GEO.blockStats now names the dominant programme (3-7), so most known sites are covered by it. These anchors are
  // the exceptions where OSM tags the object too sparsely to reach the 40 % footprint share: EC Garbary's two halls
  // are untagged building=yes, and Madalińskiego depot is mixed below the threshold. A lot whose centre falls in the
  // reach takes the profile exactly (no thinning, see steerProfile); the footprint itself decides whether the lot is
  // big enough for the hall or stays apron.
  const SPECIAL_SITES = [
    { name: 'EC Garbary', x: 691, z: -902, reach: 150, profile: UTILITY },
    { name: 'Zajezdnia Madalińskiego', x: -1356, z: 2478, reach: 120, profile: DEPOT }
  ];
  // EC Garbary has no cooling tower or chimney in the 2026-10-28 OSM snapshot (only the turbine/boiler halls), so the
  // two landmarks of the plant are curated here: a 65 m concrete stack and a 55 m cooling tower in the free yard east
  // and west of the halls. They are added only when the industry snapshot has no mapped tower within 250 m, so a newer
  // OSM extract replaces them silently.
  const INDUSTRY_FALLBACK = [
    { site: 'EC Garbary', kind: 'chimney', x: 740, z: -930, radius: 5.5, height: 65 },
    { site: 'EC Garbary', kind: 'cooling', x: 655, z: -875, radius: 14, height: 55 }
  ];

  // Areas inside the osiedla, anchored on landmark sites (world metres)
  const siteAt = (name) => LANDMARK_SITES[name] || null;
  const FAIR_BLOCK = (() => {
    const s = siteAt('Iglica');
    const b = s && blockAt(s.x, s.z);
    return b && b.area > 100000 ? b : null;
  })();
  function growBox(sites, m) {
    if (!sites.length) return null;
    const xs = sites.map((t) => t.x);
    const zs = sites.map((t) => t.z);
    return { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m };
  }
  // Dzielnica Cesarska: the box round Zamek Cesarski, Collegium Minus, Teatr Wielki and the 1956 crosses, grown 160 m
  // (≈ 530 × 400 m: al. Niepodległości, Fredry, Św. Marcin's west end)
  const CESARSKA_BOX = growBox(['Zamek Cesarski', 'Collegium Minus', 'Teatr Wielki', 'Pomnik Czerwca 1956'].map(siteAt).filter(Boolean), 160);
  // Office quarters: within 240 m of Bałtyk (Rondo Kaponiera), Andersia / AND2 / PFC (Plac Andersa), Collegium Altum
  const OFFICE_SITES = ['Bałtyk', 'Andersia', 'AND2', 'Poznań Financial Centre', 'Collegium Altum'].map(siteAt).filter(Boolean);
  const OFFICE_REACH = 240;
  // Stare Miasto inside this box is the Old Town, Garbary and Chwaliszewo; the rest is Centrum. Its west edge is
  // al. Marcinkowskiego (Plac Wolności's east side, ≈ 340 m west of the Ratusz), the old town walls' line
  const OLD_TOWN_BOX = { x0: -330, x1: 900, z0: -900, z1: 600 };
  // Ostrów Tumski and Śródka: within 650 m of the Katedra (the rest of that osiedle is Zawady and Komandoria)
  const KATEDRA = siteAt('Katedra');
  const inBox = (o, x, z) => !!o && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1;

  // REAL DENSITY (GEO.blockStats through BLOCKS[i].built / .levels: the share of each curb island under OSM building
  // footprints and their median storeys). Each profile builds a typical share of its block (KIND_SHARE, measured with a
  // headless footprint raster over the detail box); a block whose real share is lower gets bare yards, and frontage
  // gaps only when far lower (kamienice), or empty lots (the rest); one that is higher keeps no gaps or yards, and
  // panel estates whose block is denser or lower than a slab estate take the kamienica profile. Before this, the generator built Główna at 2.5x
  // its real share and Rataje at 0.6x
  const KIND_SHARE = {
    res: 0.28, rynek: 0.4, cesarska: 0.4, offices: 0.29, loft: 0.57, projects: 0.1, lowrise: 0.48, fair: 0.45, villas: 0.15,
    campus: 0.3, mall: 0.75, retail: 0.6, industrial: 0.55, depot: 0.5, stadium: 0.25, arena: 0.6, utility: 0.45
  };
  const RES_KINDS = new Set(['res', 'rynek', 'cesarska']);
  const LOT_TARGET_KINDS = new Set(['retail', 'mall', 'industrial', 'utility', 'depot']);
  // Big-box and industrial blocks: a block whose mapped footprints average over BIG_BOX m² and whose buildings
  // average 1-3 storeys is a mall, retail park or hall, not a perimeter block. The threshold is measured on the
  // OSM snapshot: a kamienica or slab block averages 150-600 m² per building, while Posnania's single outline is
  // 77,000 m², Castorama 2,920 m² and the Główna halls 1,000-7,400 m². The blockStats programme (cases 3-7 above)
  // now classifies tagged objects; this morphology test remains only for unnamed big boxes that OSM leaves as
  // building=yes. A park block with a modest average keeps its district profile.
  const BIG_BOX = 900;
  const INDUSTRIAL_DISTRICTS = new Set([
    'Główna', 'Wilda', 'Antoninek-Zieliniec-Kobylepole', 'Starołęka-Minikowo-Marlewo'
  ]);
  function bigBoxKind(b) {
    if (!b || b.area < 12000 || b.built < 0.12 || b.levels > 3 || b.park > 0.45) return null;
    const avg = (b.built * b.area) / Math.max(1, b.buildings);
    if (avg < BIG_BOX) return null;
    if (b.park > 0.3 && avg < 2500) return null;
    // IKEA's block is a 20-26 m cell grid cut by the park; the district's LOWRISE halls already match its 7.6 m
    // height and fill its footprint, while the retail layout only finds room for a few small boxes there.
    if (b.park > 0.3 && b.area < 30000) return null;
    if (avg >= 12000 && b.built >= 0.45) return 'mall';
    if (avg >= 2500) return INDUSTRIAL_DISTRICTS.has(b.district) ? 'industrial' : 'retail';
    if (INDUSTRIAL_DISTRICTS.has(b.district)) return 'industrial';
    return b.levels <= 2 && avg >= 1200 ? 'retail' : 'industrial';
  }
  // Villa layouts are steered exactly (villaBlock builds cfg.share of its lot rects): the block's real share over the
  // lot area its pieces cover (srcLotArea; the lot rects stand 4.6 m in from the curb, so a Sołacz block's 9% of the
  // island is ~12% of its lots), at most VILLA_MAX
  const VILLA_SHARE = KIND_SHARE.villas;
  const VILLA_MAX = 0.45;
  function steerProfile(cfg, b) {
    if (!b) return cfg;
    // A block with no mapped building stays empty: Poznań's OSM buildings are near complete (85% carry
    // building:levels), and the 37 ha of such blocks over 0.8 ha are meadows, allotments and building sites (the
    // Naramowice bank of the Warta, 17 ha). Built at half the profile's share they added 5 ha that is not there
    if (!b.buildings && !(b.built > 0.01)) return { ...cfg, skipP: 1 };
    // Site-anchored non-residential objects (stadium, arena, utility, depot) stand on their own lot rects: no
    // thinning, because the use is known and its layout leaves the uncovered part as concourse or yard.
    if (cfg.exact) return { ...cfg, skipP: 0 };
    const T = (b.park > 0.6 && cfg.kind !== 'villas' && srcLotArea > 0 && fullLotArea > 0)
      ? (b.built * fullLotArea) / srcLotArea
      : b.built;
    if (cfg.kind === 'villas') {
      // Villas stand 1-3 storeys: 1-2 on blocks of bungalows and garages, 2 on a 2-storey median, 2-3 above it
      const lv = Math.round(b.levels);
      const villa = !lv ? cfg.kf.villa : lv <= 1 ? [1, 2] : lv === 2 ? [2, 2] : [2, 3];
      return { ...cfg, kf: { villa }, share: Math.min(VILLA_MAX, (T * b.area) / Math.max(1, srcLotArea)) };
    }
    // Campuses steer exactly like the villas: the block's real built share over the area of its lot rects. The layout
    // spends that budget on the street frontage first, then on interior pavilions, so a 21% hospital block is not
    // forced to 30% or left at the perimeter-only share the kamienica profile gave it
    if (cfg.kind === 'campus') {
      return { ...cfg, share: Math.min(0.55, (T * b.area) / Math.max(1, srcLotArea)), skipP: 0 };
    }
    const L = b.levels >= 2 ? Math.round(b.levels) : 0;
    // The block's real built share over the lots the generator actually has (after park carve and landmark reserves),
    // not over the island. A park-heavy or reserve-heavy block can only reach its OSM share by filling a larger part
    // of the remaining lots; this is the target for the dense estate variant and the campus/villa budgets.
    const lotTarget = srcLotArea > 0 ? Math.min(1, (b.built * b.area) / srcLotArea) : b.built;
    let base = cfg;
    // Five-storey panel estates (Rataje, Stare Winogrady) stay PROJECTS: the old L < 7 rule turned 887/1166/98 into
    // perimeter kamienice with q < 0.8, noCore and frontage gaps, which left them 20-40 % below their real share.
    // Stare Winogrady's four-storey blocks (192 among them) keep the denser kamienica layout; Rataje's four-storey
    // blocks are panel estates too, and converting them overfilled 930/961/1122.
    if (srcLegacy) {
      if (cfg.kind === 'projects' && !cfg.estate && ((L && L < 7) || T > KIND_SHARE.projects * 1.4)) {
        base = RES_KAMIENICE;
      }
    } else if (cfg.kind === 'projects' && !cfg.estate && L &&
      (L < 4 || (L === 4 && b.district === 'Stare Winogrady'))) base = RES_KAMIENICE;
    // Kamienice steer by the real built share of their lots, not of the island (report 2026-11-08, cause 1a): a block
    // whose lots cover 37 % of the island (98) or 41 % (1166) is systematically underbuilt by the old island-share q.
    // Halls, malls and utility plants use the same lot-aware target to set skipP (cause 1b): a block whose lots cover
    // 61 % (1305), 68 % (417) or 63 % (266) otherwise drops q too far and loses whole pieces to Bernoulli thinning.
    const Tq = srcLegacy ? T : RES_KINDS.has(base.kind)
      ? (srcLotArea > 0 && srcLotArea < 0.5 * b.area ? Math.max(T, lotTarget) : T)
      : LOT_TARGET_KINDS.has(base.kind) ? lotTarget : T;
    const q = Tq / KIND_SHARE[base.kind];
    const out = { ...base };
    if (base.kind === 'projects' && !srcLegacy) out.estateP = Math.max(0, Math.min(1, (lotTarget - 0.15) / 0.2));
    if (RES_KINDS.has(base.kind)) {
      // Storeys follow the block's median but drop at most one below the profile's: OSM's area-weighted median
      // counts the oficyny and outbuildings too (3 storeys on the Kaponiera blocks of 4-5-storey kamienice)
      if (L) {
        const [k0, k1] = (base.kf && base.kf.kamienica) || [4, 5];
        const f = Math.min(L, 7);
        out.kf = { ...base.kf, kamienica: [Math.max(k0 - 1, Math.min(f - 1, 6)), Math.max(k1 - 1, f)] };
        out.cornerFloors = [Math.max(base.cornerFloors[0] - 1, f), Math.max(base.cornerFloors[1] - 1, Math.min(8, f + 1))];
      }
      const others = base.rows.filter(([k]) => k !== 'gap');
      // The historic centre keeps an unbroken street wall: no base frontage gaps, no whole-piece thinning, and war
      // gaps only as the interior thinning leaves them (the user reads a missing kamienica between Strzelecka and
      // Podgórna as a hole in the frontage). Other districts keep the sparse-block gaps below 0.6.
      const denseCentre = !srcLegacy && b.district === 'Stare Miasto';
      if (denseCentre) out.rows = others;
      if (q >= 1) {
        out.rows = others;
        // (the villas' only inner kind is the yard: a dense villa block, Górczyn's houses on 30% of their lots, falls
        // back to the outbuildings of the kamienica blocks)
        const inner = (base.inner || INNER_RES).filter(([k]) => k !== 'yard');
        out.inner = inner.length ? inner : INNER_RES.filter(([k]) => k !== 'yard');
        // Well above the typical share (the centre's 50-85% blocks): oficyny round every courtyard, rear houses on
        // tighter light courts, yards 3 m wide
        if (q >= 1.3) {
          out.dense = true;
          // Deep central courtyards are filled from the inside out: rear houses across the lot and workshop/oficyna
          // halls, with only the odd free-standing pavilion (the centre's yards were studnie, not suburban lawns)
          out.inner = [['rear', 7], ['works', 3], ['pavilion', 0.5]];
        }
      } else {
        // Thinned from the inside out, so the streets keep their frontages. Only very sparse blocks lose the core;
        // between 0.5 and 0.8 the core keeps low pavilions and rear houses (the 100-150 m hospital and campus
        // interiors of Bukowska and Marcelińska stayed bare yards when the cut was 0.8), and a quarter of it stays
        // green. War gaps and vacant lots on the frontage only below 0.6 of the typical share (gaps first, the measured
        // shares came out the same but Św. Marcin and Kaponiera read as empty from the street)
        const fillCore = q >= 0.5 && q < 0.8 && b.area >= 50000 && b.buildings >= 20 && b.park <= 0.3;
        out.inner = fillCore
          ? [['pavilion', 2], ['rear', 1.5], ['works', 1], ['yard', 2]]
          : q < 0.8
            ? [['yard', 1]]
            : [['yard', 3], ...(base.inner || INNER_RES).filter(([k]) => k !== 'yard')];
        out.noCore = q < 0.8 && !fillCore;
        if (q < 0.6 && !denseCentre) {
          const f = Math.min(0.6, 0.6 - q);
          const w = others.reduce((t, [, x]) => t + x, 0);
          out.rows = [...others, ['gap', (w * f) / (1 - f)]];
          out.skipP = Math.max(0, 0.3 - q);
        }
      }
    } else {
      out.skipP = Math.min(0.9, Math.max(0, 1 - q));
      if (base.kind === 'projects' && L) out.types = L >= 9 ? [[11, 2], [16, 1]] : [[5, 3], [11, 1]];
      if (base.kind === 'lowrise' && L) out.floors = [1, Math.max(1, Math.min(4, L))];
      // Office blocks only deepen their frontage slabs and build courtyard cores where the block's real OSM share is
      // above the profile's 29% typical output and the island itself is at least 40% built or park-carved (816 is
      // 37% built but 37% park). 593/786 (1.03/0.97), 938/939 (1.07) and 733 (37%, no park) are already over their
      // real share and keep their plazas; 816, 814, 769 and 868 have room for the core.
      if (base.kind === 'offices') out.core = q >= 1.15 && (b.built >= 0.4 || b.park >= 0.3);
      // Halls follow the block's median only within their own band: OSM often tags a 10-12 m hall as one storey,
      // so the volume stays 2-3 storeys (7.6-11.4 m) and a mall 3-4 (12-16 m) instead of collapsing to a shed.
      if (base.kind === 'industrial' || base.kind === 'depot') {
        if (L) out.floors = [2, Math.max(2, Math.min(3, Math.round(L) + 1))];
      }
      if (base.kind === 'mall' && L) {
        out.floors = [Math.max(3, Math.min(4, Math.round(L) + 1)), Math.max(3, Math.min(4, Math.round(L) + 2))];
      }
    }
    return out;
  }

  // Low blocks of the outer districts: halls and works where the block's mapped buildings average over LOW_HALL m² of
  // footprint, detached houses where they are smaller (a villa with its garage averages ~120 m²)
  const LOW_HALL = 450;
  // Mid-rise blocks of the outer districts: perimeter kamienice where the block is 20% built or more, else slabs in
  // their greenery (the 1950s-70s blocks of Winiary and Ogrody; as kamienice they came out at twice their share)
  const midKind = () => (srcBlock && srcBlock.built < 0.2 ? ESTATE : RES_KAMIENICE);
  const lowKind = () => {
    const b = srcBlock;
    return b && b.buildings && (b.built * b.area) / b.buildings > LOW_HALL ? LOWRISE : RES_VILLAS;
  };

  // Profile of a lot rect by where it stands (world centre) and its osiedle (city-config.js districtAt: `b.district`,
  // null outside every named one)
  function blockProfile(blk, district) {
    const [wx, wz] = toWorld(blk.cx, blk.cz);
    const L = srcBlock && srcBlock.levels >= 2 ? srcBlock.levels : 0;
    const lv = srcBlock ? srcBlock.levels : 0;
    if (FAIR_BLOCK && srcBlock === FAIR_BLOCK) return FAIRGROUND;
    // A blockStats programme comes before the district switch. Programmes 3-9 are the dominant OSM footprint use
    // (>= 40 % of the block's footprint area), so no extra gate: Posnania, Castorama, ZNTK, the depots, the sports
    // parks and Business Garden's offices build their own morphology instead of the district's kamienice or osiedle.
    if (srcLegacy) {
      // 4d14df9: large, sparse hospital/university campuses only; programmes 3-12 keep the district profile
      if (srcBlock && (srcBlock.program === 1 || srcBlock.program === 2) && srcBlock.park <= 0.5 &&
        srcBlock.area >= 50000 && srcBlock.built <= 0.4) return srcBlock.program === 2 ? UNIVERSITY : HOSPITAL;
    } else if (srcBlock && srcBlock.program) {
      // Park-heavy blocks (Termy Maltańskie, the Sołacz speedway ground, Wilda's park frontages) keep their green and
      // district layout: their mapped halls already have their own lots through GEO.blockFootprints, and a block-level
      // retail/arena profile over 60 % park would outbuild the park. Programmes 1/2 keep their own park gates below.
      if (srcBlock.program < 3 || srcBlock.park <= 0.6) switch (srcBlock.program) {
        case 1:
          // Hospitals get a wider gate than universities: #828 (Szpital Kliniczny, 4.7 ha, 50 % built) and #991
          // (Strusia, 1.4 ha, 25 %) are real hospitals that the 5 ha / 40 % campus gate turned into kamienice.
          // A dense university block still keeps its district profile (192, 769, 814), where the campus grid builds
          // less than the existing frontage.
          if (srcBlock.park <= 0.5 && srcBlock.area >= 4000 && srcBlock.built <= 0.55) return HOSPITAL;
          break;
        case 2:
          if (srcBlock.park <= 0.5 && srcBlock.area >= 50000 && srcBlock.built <= 0.4) return UNIVERSITY;
          break;
        case 3: {
          // Posnania is one 77,000 m² box; Castorama and Gigamarket are 1,000-12,000 m² retail-park halls. The average
          // mapped footprint (built × area / buildings) separates them without another blockStats field. A dense
          // central block with a 3+ storey median (Stary Browar's Atrium, Galeria MM) is a mixed-use quarter, not a
          // car-park ring of 7.6 m halls or a single mall box; it keeps OFFICE_SITES and the district profile.
          const avg = srcBlock.buildings ? (srcBlock.built * srcBlock.area) / srcBlock.buildings : 0;
          if (srcBlock.built >= 0.3 && srcBlock.levels >= 3 && avg < 9000) break;
          return avg >= 9000 || (srcBlock.area >= 60000 && srcBlock.built >= 0.6) ? MALL : RETAIL_PARK;
        }
        case 4: return INDUSTRIAL_HALL;
        case 5: return DEPOT;
        case 6: {
          // Enea Stadion's block has 71,800 m² of mapped footprint in a low park share; Hala Arena and the Malta
          // sports grounds are smaller or park-carved, so they take the arena hall rather than a 104 × 68 m pitch.
          const mapped = srcBlock.built * srcBlock.area;
          return mapped >= 30000 && srcBlock.park < 0.6 ? STADIUM : ARENA;
        }
        case 7: return UTILITY;
        case 8: return ARENA;
        case 9: return OFFICE_CAMPUS;
        case 10:
          // Education programme: schools and kindergartens dominate the mapped footprint. Dense central blocks keep
          // their mixed frontage (a school among kamienice), as for hospitals; sparser ones take the low campus.
          if (srcBlock.park <= 0.5 && srcBlock.area >= 4000 && srcBlock.built <= 0.55) return SCHOOL_BLOCK;
          break;
        case 11:
          if (srcBlock.park <= 0.5 && srcBlock.area >= 3000 && srcBlock.built <= 0.5) return SACRAL_BLOCK;
          break;
        case 12:
          if (srcBlock.park <= 0.5 && srcBlock.area >= 4000 && srcBlock.built <= 0.55) return CIVIC_BLOCK;
          break;
      }
    }
    // Fallbacks for blocks OSM leaves without a programme: the EC/Madalińskiego anchors, then the morphology test
    // (big but unnamed footprints on a low-rise block). Both come before OFFICE_SITES and the osiedle switch.
    for (const s of SPECIAL_SITES) {
      if (Math.hypot(s.x - wx, s.z - wz) <= s.reach) return { ...s.profile, exact: true };
    }
    const big = srcLegacy ? null : bigBoxKind(srcBlock);
    if (big === 'mall') return MALL;
    if (big === 'retail') return RETAIL_PARK;
    if (big === 'industrial') return INDUSTRIAL_HALL;
    if (OFFICE_SITES.some((t) => Math.hypot(t.x - wx, t.z - wz) < OFFICE_REACH)) return OFFICES;
    if (inBox(CESARSKA_BOX, wx, wz)) return CESARSKA;
    if (blk.rynekSides) return RYNEK;
    switch (district) {
      case 'Stare Miasto':
        if (inBox(OLD_TOWN_BOX, wx, wz)) return chance(0.08) ? LOFT_BASE : srcLegacy ? RES_STARE_LEGACY : RES_STARE;
        return chance(0.06) ? LOFT_BASE : RES_CENTRUM;
      case 'Jeżyce':
      case 'Łazarz': return chance(0.06) ? LOFT_BASE : RES_KAMIENICE;
      case 'Wilda': return chance(0.1) ? LOFT_BASE : RES_WILDA;
      case 'Ostrów Tumski-Śródka-Zawady-Komandoria':
        if (KATEDRA && Math.hypot(KATEDRA.x - wx, KATEDRA.z - wz) < 650) return RES_OSTROW;
        return chance(0.3) ? LOWRISE : RES_STARE;
      // Sołacz and Winiary: villas, with Winiary's 4-5-storey 1950s blocks (Szczepanowskiego, Niestachowska)
      case 'Sołacz':
      case 'Winiary': return L >= 7 ? ESTATE : L >= 4 ? midKind() : RES_VILLAS;
      case 'Stare Winogrady': return chance(0.3) ? PROJECTS : RES_KAMIENICE;
      case 'Rataje': return chance(0.7) ? PROJECTS : RES_KAMIENICE;
      // Chartowo is slabs throughout (as PROJECTS, a 5-storey median turned them into kamienice and the district came
      // out at 1.4x its real share); its 1-3-storey blocks are houses, garages and halls
      case 'Chartowo': return lv && lv <= 3 ? lowKind() : ESTATE;
      case 'Główna': return chance(0.6) ? LOWRISE : RES_STARE;
      case 'Warszawskie-Pomet-Maltańskie': return lowKind();
      // The districts the 8.2 × 5.7 km box took in (Phase 13.2) mix kinds block by block, so the block's real median
      // storeys (GEO.blockStats, 0 when untagged) pick the kind: slabs from 7, houses up to 3
      case 'Nowe Winogrady Południe':
      case 'Nowe Winogrady Wschód':
      case 'Nowe Winogrady Północ':
      case 'Żegrze':
      case 'Piątkowo': return ESTATE;
      // Grunwald and Górczyn: kamienice along Grunwaldzka, Bukowska and Głogowska, villas behind them, the odd estate
      case 'Stary Grunwald':
      case 'Grunwald Północ':
      case 'Górczyn': return L >= 7 ? ESTATE : L && L <= 3 ? RES_VILLAS : L ? midKind() : RES_KAMIENICE;
      // Garden suburbs: Ogrody, Grunwald Południe's villa streets, Naramowice by the Warta, Junikowo, Ławica, Świerczewo
      case 'Ogrody':
      case 'Grunwald Południe':
      case 'Naramowice':
      case 'Junikowo':
      case 'Ławica':
      case 'Świerczewo':
      case 'Strzeszyn':
      case 'Podolany':
      case 'Wola':
      case 'Fabianowo-Kotowo': return L >= 7 ? ESTATE : L >= 4 ? midKind() : RES_VILLAS;
      case 'Zielony Dębiec': return L >= 5 ? ESTATE : RES_VILLAS;
      // Franowo's depot and the industrial estates along the eastern and southern railways, round Kobylepole's estate
      case 'Antoninek-Zieliniec-Kobylepole':
      case 'Starołęka-Minikowo-Marlewo': return L >= 5 ? ESTATE : lowKind();
      default: return RES_KAMIENICE;
    }
  }

  // ============================================================================
  // STREET FRONTAGES: which sides of a lot rect face a street, read off its block's curb outline (BLOCKS[i].poly). Lot
  // rects stand SIDEWALK 4.6 m in from the curb (poz-blocks.mjs), so a side whose samples mostly lie within FRONT_REACH
  // of the outline fronts the street; the other sides face the block's other lot rects, a landmark reserve or a
  // deep-lot split. FRONT_REACH: side-sample distances to the outline peak at 5-6 m and thin out by 10 m (measured over
  // the 3068 frame lot rects). A side standing farther back still fronts the street when its outward normal leaves the
  // outline within FRONT_RAY with no lot rect of the block in the way: the frontage frames leave slivers of the
  // property line uncovered where their regions meet (the rects stop short by up to ~13 m), and 516 of the 4272 sides
  // that look straight at the curb were left as party walls, 997 of 3634 rects as frontless courtyard (31% of the lot
  // area; with the ray 747 and 19%). A corner is a vertex of the outline where two frontages meet: both sides front
  // and the rect's corner itself lies near the outline ('street'; a filleted curb corner of radius r puts it
  // (s + r)·√2 − r away for a side set back s, 10.6 m for s = 4.6, r = 10); when it doesn't (a re-entrant notch of
  // the outline) the square stays courtyard ('notch')
  // ============================================================================
  const FRONT_REACH = 10;
  // ============================================================================
  // The block outline's edge grid, for the frontage rays. The frontage rule asks the same curb outline thousands of
  // times per block: the 2026-11-11 headless block build made 218 k outlineRay queries over 21,724 lot rects (31 edges
  // on average, 2,015 at most), but only 6% cross within FRONT_RAY; a full scan spent 34% of the block build on edges
  // the answer never read. Each edge is filed once per block in every cell its bbox covers (CSR Int32Array offsets and
  // edge ids, like the polygon index in city-config.js), and the grid goes with the block (outlineIndex is dropped
  // when srcBlock is). The grid only chooses which edges the exact formula sees: its arithmetic is unchanged, and a
  // crossing farther than FRONT_RAY is Infinity either way because the caller ignores any value above it.
  // ============================================================================
  let outlineIndex = null;
  function outlineEdgeGrid() {
    const poly = srcBlock.poly;
    if (outlineIndex && outlineIndex.poly === poly) return outlineIndex;
    const n = poly.length;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of poly) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.z < z0) z0 = p.z;
      if (p.z > z1) z1 = p.z;
    }
    // ~256 cells over the block, so a 100 m block gets 6-7 m cells and an edge stays in one or two of them
    const cell = Math.max(4, Math.min(16, Math.sqrt(((x1 - x0) * (z1 - z0)) / 256))) || 4;
    const cols = Math.max(1, Math.ceil((x1 - x0) / cell));
    const rows = Math.max(1, Math.ceil((z1 - z0) / cell));
    const col = (x) => Math.max(0, Math.min(cols - 1, Math.floor((x - x0) / cell)));
    const row = (z) => Math.max(0, Math.min(rows - 1, Math.floor((z - z0) / cell)));
    const file = (i, at) => {
      const a = poly[i ? i - 1 : n - 1], b = poly[i];
      const i0 = col(Math.min(a.x, b.x)), i1 = col(Math.max(a.x, b.x));
      const j0 = row(Math.min(a.z, b.z)), j1 = row(Math.max(a.z, b.z));
      for (let ix = i0; ix <= i1; ix++) for (let jz = j0; jz <= j1; jz++) at(jz * cols + ix);
    };
    const starts = new Int32Array(cols * rows + 1);
    for (let i = 0; i < n; i++) file(i, (c) => { starts[c + 1]++; });
    for (let c = 0; c < cols * rows; c++) starts[c + 1] += starts[c];
    const edges = new Int32Array(starts[cols * rows]);
    const fill = starts.slice(0, cols * rows);
    for (let i = 0; i < n; i++) file(i, (c) => { edges[fill[c]++] = i; });
    outlineIndex = { poly, x0, z0, x1, z1, cell, cols, rows, starts, edges, stamp: new Int32Array(n), query: 0 };
    return outlineIndex;
  }
  // Rays have a short fixed reach, but outline distances are also read for lots deep inside large blocks. A
  // hierarchy avoids the many empty rings of a nearest-grid search and keeps the exact squared-distance formula.
  function outlineDistanceTree(idx) {
    if (idx.distanceTree) return idx.distanceTree;
    const poly = idx.poly;
    const nodes = [];
    const build = (ids) => {
      const at = nodes.length;
      const node = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, ids: null, left: -1, right: -1 };
      nodes.push(node);
      for (const i of ids) {
        const a = poly[i ? i - 1 : poly.length - 1], b = poly[i];
        node.x0 = Math.min(node.x0, a.x, b.x);
        node.x1 = Math.max(node.x1, a.x, b.x);
        node.z0 = Math.min(node.z0, a.z, b.z);
        node.z1 = Math.max(node.z1, a.z, b.z);
      }
      // A little outward slack keeps the lower bound conservative against projection round-off at an endpoint.
      node.x0 -= 1e-7; node.x1 += 1e-7;
      node.z0 -= 1e-7; node.z1 += 1e-7;
      if (ids.length <= 8) node.ids = ids;
      else {
        node.axis = node.x1 - node.x0 > node.z1 - node.z0 ? 'x' : 'z';
        const axis = node.axis;
        const centre = (i) => poly[i][axis] + poly[i ? i - 1 : poly.length - 1][axis];
        ids.sort((a, b) => centre(a) - centre(b));
        const mid = ids.length >> 1;
        node.split = centre(ids[mid]) * 0.5;
        node.left = build(ids.slice(0, mid));
        node.right = build(ids.slice(mid));
      }
      return at;
    };
    build(Array.from({ length: poly.length }, (_, i) => i));
    idx.distanceTree = { nodes, stack: new Int32Array(nodes.length) };
    return idx.distanceTree;
  }
  function outlineDist(x, z) {
    const idx = outlineEdgeGrid();
    const poly = idx.poly;
    const { nodes, stack } = outlineDistanceTree(idx);
    let top = 0;
    stack[top++] = 0;
    let best = Infinity;
    while (top) {
      const node = nodes[stack[--top]];
      const bx = Math.max(0, node.x0 - x, x - node.x1);
      const bz = Math.max(0, node.z0 - z, z - node.z1);
      if (bx * bx + bz * bz > best) continue;
      if (!node.ids) {
        const nearLeft = (node.axis === 'x' ? x : z) < node.split;
        stack[top++] = nearLeft ? node.right : node.left;
        stack[top++] = nearLeft ? node.left : node.right;
        continue;
      }
      for (const i of node.ids) {
        const a = poly[i ? i - 1 : poly.length - 1];
        const c = poly[i];
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        const L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = a.x + t * dx - x;
        const ez = a.z + t * dz - z;
        const d = ex * ex + ez * ez;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }
  const FRONT_RAY = 18;
  // Distance along the ray from (x, z) in direction (nx, nz) to where it first crosses the curb outline, for a crossing
  // no farther than FRONT_RAY (the only range the frontage rule reads; beyond it returns Infinity either way)
  function outlineRay(x, z, nx, nz) {
    const idx = outlineEdgeGrid();
    const poly = idx.poly;
    let best = Infinity;
    // the segment's cells: any crossing within FRONT_RAY lies in one of them, so no other edge can be nearer
    const ex = x + nx * FRONT_RAY, ez = z + nz * FRONT_RAY;
    const i0 = Math.max(0, Math.min(idx.cols - 1, Math.floor((Math.min(x, ex) - idx.x0) / idx.cell)));
    const i1 = Math.max(0, Math.min(idx.cols - 1, Math.floor((Math.max(x, ex) - idx.x0) / idx.cell)));
    const j0 = Math.max(0, Math.min(idx.rows - 1, Math.floor((Math.min(z, ez) - idx.z0) / idx.cell)));
    const j1 = Math.max(0, Math.min(idx.rows - 1, Math.floor((Math.max(z, ez) - idx.z0) / idx.cell)));
    const q = ++idx.query;
    for (let ix = i0; ix <= i1; ix++) {
      for (let iz = j0; iz <= j1; iz++) {
        const c = iz * idx.cols + ix;
        for (let k = idx.starts[c], end = idx.starts[c + 1]; k < end; k++) {
          const i = idx.edges[k];
          if (idx.stamp[i] === q) continue;
          idx.stamp[i] = q;
          const a = poly[i ? i - 1 : poly.length - 1];
          const edx = poly[i].x - a.x;
          const edz = poly[i].z - a.z;
          const den = nx * edz - nz * edx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((a.x - x) * edz - (a.z - z) * edx) / den;
          const u = ((a.x - x) * nz - (a.z - z) * nx) / den;
          if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
        }
      }
    }
    // a crossing of an edge that merely passes through the segment's cells can still lie past it
    return best <= FRONT_RAY ? best : Infinity;
  }
  // World point (x, z) inside one of the source block's lot rects (srcRects, each in its own frame; 0.5 m grace)
  function inSrcRect(x, z) {
    for (const r of srcRects) {
      const lx = r.px + (x - r.px) * r.cs - (z - r.pz) * r.sn;
      const lz = r.pz + (x - r.px) * r.sn + (z - r.pz) * r.cs;
      if (lx > r.x0 - 0.5 && lx < r.x1 + 0.5 && lz > r.z0 - 0.5 && lz < r.z1 + 0.5) return true;
    }
    return false;
  }
  function frontages(x0, x1, z0, z1) {
    const front = { n: true, s: true, w: true, e: true };
    const corner = { nw: 'street', ne: 'street', sw: 'street', se: 'street' };
    if (!srcBlock || !srcBlock.poly || srcBlock.poly.length < 3) return { front, corner };
    const ends = { n: [x0, z0, x1, z0, 0, -1], s: [x0, z1, x1, z1, 0, 1], w: [x0, z0, x0, z1, -1, 0], e: [x1, z0, x1, z1, 1, 0] };
    const setback = { n: 0, s: 0, w: 0, e: 0 };
    for (const s of SIDES) {
      const [ax, az, bx, bz, lnx, lnz] = ends[s];
      // the side's outward normal in the world
      const nx = xf ? lnx * xf.cs + lnz * xf.sn : lnx;
      const nz = xf ? -lnx * xf.sn + lnz * xf.cs : lnz;
      let near = 0;
      let far = 0;
      for (let k = 0; k < 5; k++) {
        const [wx, wz] = toWorld(ax + (bx - ax) * (0.1 + k * 0.2), az + (bz - az) * (0.1 + k * 0.2));
        const d = outlineDist(wx, wz);
        if (d <= FRONT_REACH) near++;
        far = Math.max(far, d);
      }
      let ray = 0;
      for (let k = 0; k < 5 && near < 3 && ray + 5 - k >= 3; k++) {
        const [wx, wz] = toWorld(ax + (bx - ax) * (0.1 + k * 0.2), az + (bz - az) * (0.1 + k * 0.2));
        const e = outlineRay(wx, wz, nx, nz);
        if (e > FRONT_RAY) continue;
        const m = Math.min(e - 1, 9);
        if (!inSrcRect(wx + nx * 3, wz + nz * 3) && !inSrcRect(wx + nx * m, wz + nz * m)) ray++;
        far = Math.max(far, e);
      }
      front[s] = near >= 3 || ray >= 3;
      setback[s] = far;
    }
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      if (!front[c[0]] || !front[c[1]]) {
        corner[c] = null;
        continue;
      }
      const [wx, wz] = toWorld(c[1] === 'w' ? x0 : x1, c[0] === 'n' ? z0 : z1);
      const reach = Math.max(FRONT_REACH, setback[c[0]], setback[c[1]]) * 1.5;
      corner[c] = outlineDist(wx, wz) <= reach ? 'street' : 'notch';
    }
    return { front, corner };
  }

  // Stary Rynek: the square's outline (PLAZAS) and its bounds grown 40 m, to pick the candidate lot rects
  const RYNEK_RING = (PLAZAS.find((p) => p.name === 'Stary Rynek') || {}).ring || null;
  const RYNEK_BOX = RYNEK_RING ? growBox([
    { x: Math.min(...RYNEK_RING.map((p) => p.x)), z: Math.min(...RYNEK_RING.map((p) => p.z)) },
    { x: Math.max(...RYNEK_RING.map((p) => p.x)), z: Math.max(...RYNEK_RING.map((p) => p.z)) }
  ], 40) : null;
  function inPts(ring, x, z) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const c = ring[j];
      if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  // The street frontages of a lot rect facing the Stary Rynek (probes 11 m out from the side, past the sidewalk, inside
  // the square's outline; the central block stands inside that outline too), or null
  function rynekSides(x0, x1, z0, z1, front) {
    if (!RYNEK_RING) return null;
    const [cx, cz] = toWorld((x0 + x1) * 0.5, (z0 + z1) * 0.5);
    if (!inBox(RYNEK_BOX, cx, cz)) return null;
    let sides = null;
    for (const s of SIDES) {
      if (!front[s]) continue;
      let inside = 0;
      for (const t of [0.25, 0.5, 0.75]) {
        const lx = s === 'w' ? x0 - 11 : s === 'e' ? x1 + 11 : x0 + (x1 - x0) * t;
        const lz = s === 'n' ? z0 - 11 : s === 's' ? z1 + 11 : z0 + (z1 - z0) * t;
        const [wx, wz] = toWorld(lx, lz);
        if (inPts(RYNEK_RING, wx, wz)) inside++;
      }
      if (inside >= 2) (sides || (sides = {}))[s] = true;
    }
    return sides;
  }

  // Building-wrap advert designs on renovation scaffolds (wrapThemes, section D)
  const WRAP_THEMES = 4;

  /**
   * Populates a single block (or lot rect of one) with lots and buildings for its neighbourhood and registers its
   * high-detail architectural features (stone cornices, chimney stacks, skylights, rooftop penthouses, balconies,
   * awnings, storefront fascia signs and renovation scaffolding) into the Quadtree.
   */
  function populateBlock(minX, maxX, minZ, maxZ, district = null, facility = false, anchor = null, ancillary = false,
    object = null, fallback = false) {
    const bw = maxX - minX;
    const bd = maxZ - minZ;
    if (bw < minLot || bd < minLot) return;
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const { front, corner } = frontages(minX, maxX, minZ, maxZ);

    const blockDetail = {
      id: `${district}_${Math.round(cx)}_${Math.round(cz)}`,
      srcBlockId: srcBlock ? srcBlock.id : null,
      cx,
      cz,
      minX,
      maxX,
      minZ,
      maxZ,
      district,
      front, // sides of the lot rect on a street frontage { n, s, w, e } (see frontages)
      corner, // { nw, ne, sw, se }: 'street' (a corner house), 'notch' or null
      rynekSides: rynekSides(minX, maxX, minZ, maxZ, front), // frontages facing the Stary Rynek, or null
      cornices: [],
      chimneys: [], // { x, y, z, w, d, h }: brick stacks standing on the eave line y
      skylights: [], // { x, y, z, w, d } on flat roofs
      hvacUnits: [],
      balconies: [], // balcony stacks (balconies.js)
      awnings: [],
      scaffolds: [], // { x, y, z, w, d, h, ad }: renovation scaffolding, ad = advert wrap theme or -1 (netting)
      footprints: [], // { x0, x1, z0, z1, h, tone } per building part, lowest first (maps; + pts: its world corners when turned)
      yards: [], // courtyards, gardens & lawns { x0, x1, z0, z1 } (+ ry: turned about their centre)
      maxH: 0,
      streetFronts: [], // ground-floor street frontage { side, a0, a1, c, out, h } (until it's built)
      facadeBoxes: [], // this block's facade boxes & the lots left empty under bridge approaches (until it's built)
      voidLots: []
    };
    const bucketMarks = buckets.map((items) => items.length);
    const roofMark = roofs.mark();
    rand = mulberry32((Math.imul(Math.round(minX * 4), 73856093) ^ Math.imul(Math.round(minZ * 4), 19349663) ^ 10019) >>> 0);

    // Anchors are exact by definition (their own OSM envelope); facility lots still build their mapped hall; only an
    // ordinary lot of an anchored block is limited to the low ancillary pavilion.
    const profile = anchor ? { ...anchorProfile(anchor.a), parts: anchor.parts }
      : object ? objectProfile(object)
        : facility ? { kind: 'facility' }
          : ancillary ? { kind: 'ancillary' }
            : steerProfile(blockProfile(blockDetail, district), srcBlock);
    // A fallback lot is a real mapped building the property-line grid missed: never thin it away with skipP.
    if (fallback) profile.skipP = 0;
    // The piece's share of the block's real built area still to spend (srcPieceBudget). Small osiedle lots that cannot
    // hold a full slab use it for a garage/pavilion row, so they still contribute their share of the real stock.
    if (profile.kind === 'projects' && !srcLegacy) {
      profile.pieceFill = Math.max(0, Math.min(0.6, srcPieceBudget / (bw * bd)));
    }
    if (!(profile.skipP && chance(profile.skipP))) LAYOUTS[profile.kind](blockDetail, profile, minX, maxX);
    openOntoVoidLots(blockDetail);

    // Renovation scaffolding with green netting up one stretch of street facade, on the longest ground-floor street
    // front of ~1 lot rect in 8; a third of them carry a building-wrap advert (siatka reklamowa) instead
    const fronts = blockDetail.streetFronts;
    if (!anchor && fronts.length && chance(0.12)) {
      const fr = fronts.reduce((a, b) => (b.a1 - b.a0 > a.a1 - a.a0 ? b : a));
      const len = Math.min(26, (fr.a1 - fr.a0) * 0.9);
      if (len > 8) {
        const along = (fr.a0 + fr.a1) * 0.5;
        const c = fr.c + fr.out * 0.8;
        const alongX = fr.side === 'n' || fr.side === 's';
        blockDetail.scaffolds.push({
          x: alongX ? along : c, y: 0.22, z: alongX ? c : along, w: alongX ? len : 1.4, d: alongX ? 1.4 : len, h: fr.h + 0.8,
          ad: chance(0.35) ? irange(0, WRAP_THEMES - 1) : -1
        });
      }
    }
    delete blockDetail.facadeBoxes;
    delete blockDetail.voidLots;
    delete blockDetail.streetFronts;

    blockDetail.footprints.sort((a, b) => a.h - b.h);
    if (xf) {
      placeInFrame(blockDetail, bucketMarks);
      roofs.transform(roofMark, toWorld, xf.th);
    } else {
      blockDetail.ry = 0; // a world-frame detail still reports its turn (consumers read blk.ry without a fallback)
    }
    blockDetail.yards = blockDetail.yards.map(clipYard).filter(Boolean);
    allBlocks.push(blockDetail);
  }

  // A GEO.blockAnchors box, clipped to the source block's own lot rects in each frontage frame. This keeps the
  // dedicated building off the neighbouring block, a street or an internal park island: an anchor's world AABB can span
  // such a hole (Posnania's L-plan, IKEA's clipped bbox), and a single filled rectangle would build over it.
  function populateAnchor(a) {
    for (const [th, px, pz, rects] of srcBlock.frames || [[0, 0, 0, srcBlock.rects]]) {
      const saved = xf;
      xf = th ? { th, cs: Math.cos(th), sn: Math.sin(th), px, pz } : null;
      const box = inFrameRect(a);
      const parts = [];
      for (const r of rects) {
        const x0 = Math.max(r[0], box[0]);
        const x1 = Math.min(r[1], box[1]);
        const z0 = Math.max(r[2], box[2]);
        const z1 = Math.min(r[3], box[3]);
        if (x1 - x0 >= 4 && z1 - z0 >= 4) parts.push(rect(x0, x1, z0, z1));
      }
      if (parts.length) {
        populateBlock(Math.min(...parts.map((p) => p.x0)), Math.max(...parts.map((p) => p.x1)),
          Math.min(...parts.map((p) => p.z0)), Math.max(...parts.map((p) => p.z1)),
          srcBlock.district, false, { a, parts });
      }
      xf = saved;
    }
  }

  // One mapped object from GEO.blockObjects: its oriented OSM minimum-area rectangle, shrunk to the real outline area
  // when the plan is not a full rectangle, in its own frame so a diagonal hall does not fill a much larger AABB.
  // Landmark reserves are left to the hand-built models. The outline is sampled along its whole perimeter (not only at
  // the corners) in the same frame the lots are built in; an OSM min-area rectangle can still reach a roadway at one
  // end (an L-plan, a corner cut), which used to drop the whole building. Such an envelope is trimmed symmetrically
  // until it clears the curb instead, so the mapped building survives on a slightly smaller footprint.
  function populateObject(o) {
    const [cx, cz, w0, d0, , area] = o;
    // Kupiec Poznański is L-shaped: the min-area rectangle is 101 x 63.7 m, but only its safe L-shaped half is
    // built. Shrinking the rectangle to the 4,899 m² outline would turn it into the small diagonal box this object
    // used to produce, so kupiecBlock gets the full frame instead.
    const kupiec = srcBlock && srcBlock.id === KUPIEC_BLOCK && o[6] === 1 && o[7] >= 6 && area >= 4000;
    const s = kupiec || !(area > 0 && w0 * d0 > 0) ? 1 : Math.min(1, Math.sqrt(area / (w0 * d0)));
    const w = w0 * s, d = d0 * s;
    if (Math.min(w, d) < 4) return;
    const th = snappedObjectAngle(o);
    const cs = Math.cos(th), sn = Math.sin(th);
    // toWorld of the object's own frame (placeInFrame rotates the same way); the old check used -ang here too, which
    // mirrored the outline and rejected Maraton and AWF opposite Karmelicka although their real envelopes stand clear.
    const world = (u, v) => [cx + u * cs + v * sn, cz - u * sn + v * cs];
    const clear = (hw, hd, margin) => {
      const edges = [
        [-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [hw, hd, -hw, hd], [-hw, hd, -hw, -hd]
      ];
      for (const [u0, v0, u1, v1] of edges) {
        const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 8));
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const [x, z] = world(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t);
          // roadClearance (lane centrelines) and the OSM road corridor can disagree by up to ~0.35 m near a junction
          // (Podgórna), so the margin covers both the pavement and that disagreement.
          if (roadClearance(x, z) < margin) return false;
        }
      }
      return true;
    };
    const hw = w * 0.5, hd = d * 0.5;
    const maxInset = Math.min(20, Math.min(hw, hd) - 2);
    let inset = 0;
    // Kupiec's L-plan is built directly in objectBlock: its min-area rectangle crosses Podgórna by design.
    if (!kupiec && !clear(hw, hd, OBJECT_CURB_CLEAR)) {
      let found = false;
      for (inset = 0.5; inset <= maxInset; inset += 0.5) {
        if (clear(hw - inset, hd - inset, OBJECT_CURB_CLEAR)) { found = true; break; }
      }
      // A narrow object that cannot yield 2.5 m at both ends keeps the old half-metre rule instead of disappearing.
      if (!found) {
        inset = 0;
        if (!clear(hw, hd, 0.5)) {
          for (inset = 0.5; inset <= maxInset; inset += 0.5) {
            if (clear(hw - inset, hd - inset, 0.5)) { found = true; break; }
          }
          if (!found) return;
        }
      }
    }
    const x0 = cx - hw + inset, x1 = cx + hw - inset, z0 = cz - hd + inset, z1 = cz + hd - inset;
    const saved = xf;
    xf = { th, cs, sn, px: cx, pz: cz };
    populateBlock(x0, x1, z0, z1, srcBlock.district, false, null, false, o);
    xf = saved;
  }

  // Turns everything a lot of the current frame emitted into place: facade boxes, roof gear, cornices, balconies,
  // awnings & scaffolds get the frame's turn (ry) about their own centre, map footprints their world corners, the block
  // its world centre (streaming) & bounds. (Pitched roofs carry their own yaw, so roofs.transform adds the turn to it
  // instead, from populateBlock.)
  function placeInFrame(blk, marks) {
    const th = xf.th;
    buckets.forEach((items, m) => {
      for (let i = marks[m]; i < items.length; i++) {
        const b = items[i];
        [b.x, b.z] = toWorld(b.x, b.z);
        b.ry = th;
      }
    });
    for (const list of [blk.cornices, blk.chimneys, blk.skylights, blk.hvacUnits, blk.balconies, blk.awnings, blk.scaffolds]) {
      for (const o of list) {
        [o.x, o.z] = toWorld(o.x, o.z);
        o.ry = th;
      }
    }
    const corners = (x0, x1, z0, z1) => [toWorld(x0, z0), toWorld(x1, z0), toWorld(x1, z1), toWorld(x0, z1)].map(([x, z]) => ({ x, z }));
    const bounds = (o, pts) => {
      o.x0 = Math.min(...pts.map((p) => p.x));
      o.x1 = Math.max(...pts.map((p) => p.x));
      o.z0 = Math.min(...pts.map((p) => p.z));
      o.z1 = Math.max(...pts.map((p) => p.z));
    };
    for (const f of blk.footprints) {
      f.pts = corners(f.x0, f.x1, f.z0, f.z1);
      bounds(f, f.pts);
    }
    for (const y of blk.yards) {
      const [cx, cz] = toWorld((y.x0 + y.x1) * 0.5, (y.z0 + y.z1) * 0.5);
      const hw = (y.x1 - y.x0) * 0.5;
      const hd = (y.z1 - y.z0) * 0.5;
      Object.assign(y, { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, ry: th });
    }
    const pts = corners(blk.minX, blk.maxX, blk.minZ, blk.maxZ);
    [blk.cx, blk.cz] = toWorld(blk.cx, blk.cz);
    const b = {};
    bounds(b, pts);
    Object.assign(blk, { minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1, ry: th, pts });
  }

  // ============================================================================
  // LANDMARK LOTS: the footprints landmarks.js builds on (real OpenStreetMap outlines, many turned off the axes by the
  // site's `ang`) plus a 3 m margin stay clear of the generic buildings, which fill the rest of their blocks. Each
  // reserve keeps its outline so a frontage frame clears only the outline's bounds in that frame, not the bounds of
  // its world AABB
  // ============================================================================
  const RESERVE_MARGIN = 3;
  const LANDMARK_RESERVE = [
    'Ratusz', 'Wieża Wójtowska', 'Domki Budnicze', 'Fara', 'Zamek Królewski', 'Katedra', 'Brama Poznania',
    'Zamek Cesarski', 'Bałtyk', 'Okrąglak', 'Collegium Minus', 'Teatr Wielki', 'Pomnik Czerwca 1956', 'Poznań Główny',
    'Stary Dworzec', 'Avenida', 'Stary Browar', 'Iglica', 'Collegium Altum', 'Andersia', 'Poznań Financial Centre',
    'Novotel', 'AND2', 'Nowy Rynek', 'Delta',
    'Biblioteka Raczyńskich', 'Pałac Działyńskich', 'Hotel Bazar', 'Muzeum Narodowe', 'Teatr Polski',
    'Collegium Maius', 'Kościół Bernardynów', 'Kościół Franciszkanów', 'Kościół Najświętszej Marii Panny',
    'Kościół św. Wojciecha', 'Kościół Bożego Ciała',
    // Enea Stadion: its park block (GEO.blockFootprints[1658]) would otherwise put a generic facility hall on the bowl
    'Enea Stadion', 'Centrum Wykładowe PP', 'Biblioteka Techniczna PP', 'Hala Sportowa PP'
  ].map((name) => {
    const t = LANDMARK_SITES[name];
    if (!t) return null;
    let pts = [];
    if (t.ring && t.ring.length >= 6) {
      for (let i = 0; i + 1 < t.ring.length; i += 2) pts.push([t.ring[i], t.ring[i + 1]]);
    } else {
      const c = Math.cos(t.ang || 0), sn = Math.sin(t.ang || 0);
      pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
        const lx = (u * t.w) / 2, lz = (v * t.d) / 2;
        return [t.x + lx * c + lz * sn, t.z - lx * sn + lz * c];
      });
    }
    return outlineBounds(pts);
  }).filter(Boolean);
  // Śródka's mural square (city-config.js SRODKA_MURAL): the house with the mural, built by landmarks-heritage.js,
  // and the square in front of its painted wall out to the curb
  {
    const M = SRODKA_MURAL;
    const hx = M.len * 0.5 + 0.5;
    LANDMARK_RESERVE.push(outlineBounds([[-hx, -M.depth], [hx, -M.depth], [hx, M.square], [-hx, M.square]].map(([x, z]) => {
      const p = M.toWorld(x, z);
      return [p.x, p.z];
    })));
  }
  // Zamek Cesarski's forecourt (city-config.js ZAMEK_FORECOURT): the strip between the castle's south front and Święty
  // Marcin stays an open square, so the castle is not walled off from the street by the block's frontage frames.
  for (const [x0, x1, z0, z1] of ZAMEK_FORECOURT) {
    LANDMARK_RESERVE.push(outlineBounds([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]));
  }
  // Teatr Polski's site (city-config.js TEATR_POLSKI_FORECOURT): the real car parks, lawns and promenade in front of the
  // theatre. The world reserve takes no RESERVE_MARGIN, because its west edge already stops at Okrąglak's mapped
  // object; the block's frontage frames give it their usual 3 m when they cut their own lots. `maxFrameTurn` keeps the
  // long world-axis rect out of the block's 29° and 42° Mielżyńskiego / 3 Maja frames, where its frame AABB would cover
  // the whole deep block: on 2026-11-12 that stripped 20 of block 631's 32 deep footprints (2,341 m²). The 27 Grudnia
  // frame turns -3.5°, well inside the limit.
  for (const [x0, x1, z0, z1] of TEATR_POLSKI_FORECOURT) {
    LANDMARK_RESERVE.push({
      pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], x0, x1, z0, z1, maxFrameTurn: TEATR_POLSKI_RESERVE_FRAME
    });
  }
  function outlineBounds(pts) {
    const m = RESERVE_MARGIN;
    return {
      pts,
      x0: Math.min(...pts.map((p) => p[0])) - m,
      x1: Math.max(...pts.map((p) => p[0])) + m,
      z0: Math.min(...pts.map((p) => p[1])) - m,
      z1: Math.max(...pts.map((p) => p[1])) + m
    };
  }
  const hitR = (a, x0, x1, z0, z1) => a.x0 < x1 && a.x1 > x0 && a.z0 < z1 && a.z1 > z0;
  // World-axis AABB -> bounds in the current frontage frame (the frame's few degrees make the bounds conservative)
  function inFrameRect(f) {
    if (!xf) return [f[0], f[1], f[2], f[3]];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of [[f[0], f[2]], [f[1], f[2]], [f[1], f[3]], [f[0], f[3]]]) {
      const dx = x - xf.px, dz = z - xf.pz;
      const lx = xf.px + dx * xf.cs - dz * xf.sn;
      const lz = xf.pz + dx * xf.sn + dz * xf.cs;
      if (lx < x0) x0 = lx;
      if (lx > x1) x1 = lx;
      if (lz < z0) z0 = lz;
      if (lz > z1) z1 = lz;
    }
    return [x0, x1, z0, z1];
  }
  // [x0, x1, z0, z1] minus the reserved rects, as up to four slabs per hole (strips across the full depth first). In a
  // frontage frame the reserves are their bounds in the frame. Block anchors are reserves too, so no generic lot or
  // park facility lot is laid over a mapped mall, hall, depot or arena.
  // Anchors are world AABBs [x0, x1, z0, z1, ...]; mapped objects are oriented rects [cx, cz, w, d, ang, ...] and
  // must take their world bounds first. Reading the object's first four values as a box cut most of block 648 (the
  // Gwarna frontage) out of its own lots, because the reserve spanned from -949 to +84 in the frontage frame. In
  // Stare Miasto the object reserves are grid rows clipped to its rotated plan (objectReserveBoxes), so a diagonal
  // envelope does not cut a whole frontage through the corners of its AABB. The list is the same for every rect of a
  // block frame: rebuilding the 38 landmark outlines in the frame for each of the 13,233 calls was 11% of the
  // 2026-11-11 block build, so it is cached on the block and the arrays that define it.
  let reserveCache = null;
  function blockReserves() {
    if (reserveCache && reserveCache.block === srcBlock && reserveCache.xf === xf &&
      reserveCache.anchors === srcAnchors && reserveCache.objects === srcObjectReserves) return reserveCache.list;
    const anchors = [
      ...srcAnchors.map((a) => inFrameRect(a)),
      ...srcObjectReserves
    ].map((b) => ({ x0: b[0], x1: b[1], z0: b[2], z1: b[3] }));
    // A world-axis reserve whose frame AABB would over-cover the block (TEATR_POLSKI_FORECOURT) carries maxFrameTurn;
    // it applies in the world frame and in frontage frames within that turn of it, not in the steep frames.
    const active = xf
      ? LANDMARK_RESERVE.filter((h) => h.maxFrameTurn === undefined || Math.abs(xf.th) <= h.maxFrameTurn)
      : LANDMARK_RESERVE;
    let reserves = active;
    if (xf) {
      reserves = active.map((h) => outlineBounds(h.pts.map(([x, z]) => [
        xf.px + (x - xf.px) * xf.cs - (z - xf.pz) * xf.sn,
        xf.pz + (x - xf.px) * xf.sn + (z - xf.pz) * xf.cs
      ])));
    }
    reserveCache = {
      block: srcBlock, xf, anchors: srcAnchors, objects: srcObjectReserves, list: reserves.concat(anchors)
    };
    return reserveCache.list;
  }
  function minusReserves(r) {
    const reserves = blockReserves();
    let parts = [r];
    for (const h of reserves) {
      const next = [];
      for (const [x0, x1, z0, z1] of parts) {
        if (!hitR(h, x0, x1, z0, z1)) { next.push([x0, x1, z0, z1]); continue; }
        if (h.x0 > x0) next.push([x0, h.x0, z0, z1]);
        if (h.x1 < x1) next.push([h.x1, x1, z0, z1]);
        const mx0 = Math.max(x0, h.x0), mx1 = Math.min(x1, h.x1);
        if (h.z0 > z0) next.push([mx0, mx1, z0, h.z0]);
        if (h.z1 < z1) next.push([mx0, mx1, h.z1, z1]);
      }
      parts = next;
    }
    return parts;
  }
  // A world rect on a landmark reserve or inside a park (its centre or a corner in a park outline)
  function overlapsParkOrLandmark(minX, maxX, minZ, maxZ) {
    if (LANDMARK_RESERVE.some((h) => hitR(h, minX, maxX, minZ, maxZ))) return true;
    const probes = [[(minX + maxX) * 0.5, (minZ + maxZ) * 0.5], [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
    return probes.some(([x, z]) => pointInPark(x, z));
  }

  // ============================================================================
  // A. EVERY REAL BLOCK (city-config.js BLOCKS): each curb island's lots inside its property line, filled for its
  //    osiedle. Rectangular blocks are lot rects in the world frame; irregular ones come with frontage frames: lot
  //    rects laid out along each street they front, filled in the frame and turned into place.
  // ============================================================================
  // Superblocks (estates, campuses, rail-side yards) are cut into strips about a street block deep
  // with a ~9 m passage between them, so no lot (and no building) runs 100+ m deep (splitDeep in city-config)
  for (const b of BLOCKS) {
    if ((b.park > 0.6 && !b.buildings) || b.median) continue;
    minLot = b.frames ? 12 : 15;
    srcBlock = b;
    // Mapped anchors of this block: a stadium bowl (>= 2 ha) stays with its park-footprint/facility layout, and an
    // anchor under a landmark reserve is already a hand-built model.
    srcAnchors = (b.anchors || []).filter((a) => !(a[5] === 4 && a[4] >= 20000) &&
      !LANDMARK_RESERVE.some((h) => hitR(h, a[0], a[1], a[2], a[3])));
    // Park blocks keep their calibrated facility layout (blockFootprints/facilityBlock): an anchor there would fill the
    // whole OSM bbox of an oval stadium or arena instead of its footprint area, and park surfaces are rastered from
    // these footprints. A remainder that is tiny next to its island also stays generic: the Stary Browar reserve leaves
    // one 700 m² shop on block 817, and anchoring it would turn a 37%-built office block into yard.
    const anchorArea = srcAnchors.reduce((sum, a) => sum + a[4], 0);
    if (b.park > 0.6 || anchorArea < 0.03 * b.area) srcAnchors = [];
    // Mapped objects are exact buildings of their own; a landmark model already covers the ones in its reserve.
    srcObjects = (b.objects || []).filter((o) => {
      const e = objectBounds(o);
      return !LANDMARK_RESERVE.some((h) => hitR(h, e[0], e[1], e[2], e[3]));
    });
    srcFallbackLots = b.fallbackLots || [];
    // The dense perimeter districts build as at 4d14df9 (LEGACY_LAYOUT_DISTRICTS): no anchors, fallback lots or
    // mapped objects beyond LEGACY_OBJECTS, and the old island-share budget. Park facility lots stay (Hala Arena and
    // the halls on 925/937 are rastered from them). Industrial superblocks (>= 10 ha, programme 4/5/7, mapped halls
    // averaging >= 600 m²: ZNTK, Cegielski) keep the anchored hall layout; 4d14df9 laid kamienice and lowrise carpets
    // over them. Block 416's workshops (468 m² average) stay legacy.
    srcLegacy = LEGACY_LAYOUT_DISTRICTS.has(b.district) && !(b.area >= 100000 && [4, 5, 7].includes(b.program) &&
      (b.built * b.area) / Math.max(1, b.buildings) >= 600);
    if (srcLegacy) {
      srcAnchors = [];
      srcObjects = srcObjects.filter((o) => LEGACY_OBJECTS.some((e) =>
        Math.abs(e.x - o[0]) <= LEGACY_OBJECT_MATCH && Math.abs(e.z - o[1]) <= LEGACY_OBJECT_MATCH));
      srcFallbackLots = [];
    }
    srcRects = (b.frames || [[0, 0, 0, b.rects]]).flatMap(([th, px, pz, rects]) => rects.map(([x0, x1, z0, z1]) => (
      { cs: Math.cos(th), sn: Math.sin(th), px, pz, x0, x1, z0, z1 })));
    // The block's pieces first: their area is the lot area the villa layouts steer by (srcLotArea)
    const pieces = [];
    srcLotArea = 0;
    fullLotArea = 0;
    for (const [th, px, pz, rects] of b.frames || [[0, 0, 0, b.rects]]) {
      xf = th ? { th, cs: Math.cos(th), sn: Math.sin(th), px, pz } : null;
      srcObjectReserves = srcObjects.flatMap((o) => b.district === 'Stare Miasto' || srcLegacy
        ? objectReserveBoxes(o, xf)
        : [inFrameRect(objectBounds(o))]);
      for (const r of rects) {
        for (const part of minusReserves(r)) {
          for (const piece of splitDeep(part)) {
            if (piece[1] - piece[0] >= minLot && piece[3] - piece[2] >= minLot) {
              fullLotArea += (piece[1] - piece[0]) * (piece[3] - piece[2]);
            }
            for (const cell of (b.park > 0) ? parkFreeCells(...piece, xf, b.parkFootprints) : [piece]) {
              const [x0, x1, z0, z1] = cell;
              if (x1 - x0 < minLot || z1 - z0 < minLot) continue;
              pieces.push([xf, x0, x1, z0, z1, !!cell.facility]);
              srcLotArea += (x1 - x0) * (z1 - z0);
            }
          }
        }
      }
    }
    // Objects and fallback lots outside the property-line grid add their own area: the real built area target already
    // contains them, so this only keeps srcLotArea >= srcTarget when the grid missed most of a block.
    const fallbackPieces = [];
    let extraLotArea = 0;
    for (const o of srcObjects) {
      extraLotArea += o[5];
    }
    // GEO.blockFallbackLots are world rects. Each one is turned into the frontage frame it fronts and laid out there,
    // like the block's own lots: built in the world frame it stood at 0° while its neighbours followed the street
    // (a 19° off-axis house between two aligned kamienice). A block without frames keeps the world frame.
    for (const f of srcFallbackLots) {
      const e = fallbackEnvelope(f);
      const frame = fallbackFrame(f, e);
      const local = fallbackLocalRect(e, frame);
      const saved = xf;
      xf = frame;
      srcObjectReserves = srcObjects.flatMap((o) => b.district === 'Stare Miasto'
        ? objectReserveBoxes(o, frame)
        : [inFrameRect(objectBounds(o))]);
      for (const part of minusReserves(local)) {
        if (part[1] - part[0] < 5 || part[3] - part[2] < 5) continue;
        fallbackPieces.push([frame, part[0], part[1], part[2], part[3]]);
        extraLotArea += (part[1] - part[0]) * (part[3] - part[2]);
      }
      xf = saved;
    }
    xf = null;
    srcLotArea += extraLotArea;
    fullLotArea += extraLotArea;
    // The block's real building area (steerProfile's T × the curb island): offices spend what is left of it on
    // their courtyard core (see officeCore). srcLeftArea distributes the unspent budget over the remaining pieces.
    {
      // The budget is the real OSM built area, not steerProfile's park-adjusted T (that T rescales the island share to
      // the surviving lots for the q decision; using it here made park blocks spend up to 2.5x their real stock on
      // pavilions). Landmark reserves are outside srcLotArea, so the generator never builds on them.
      srcTarget = srcLegacy
        ? (b.park > 0.6 && srcLotArea > 0 && fullLotArea > 0 ? (b.built * fullLotArea) / srcLotArea : b.built) * b.area
        : Math.min(srcLotArea, b.built * b.area);
      srcBuiltArea = 0;
      srcLeftArea = srcLotArea;
    }
    // The mapped boxes first: each commits its own footprint to srcBuiltArea, so the remaining lots only get what the
    // block's real built share has left.
    const framedMinLot = minLot;
    minLot = 4;
    for (const a of srcAnchors) populateAnchor(a);
    const beforeObjects = srcBuiltArea;
    for (const o of srcObjects) populateObject(o);
    srcObjectArea = srcBuiltArea - beforeObjects;
    // The object envelopes were removed from the generic lots, so their real area is no longer in srcLotArea. Add it
    // back before budgeting; otherwise a block whose lots were mostly mapped shops or halls loses the target it is
    // supposed to fill. Anchors keep the old budget (their area is already in the block's lot rects).
    if (srcObjectArea > 0 && !srcLegacy) srcTarget = Math.min(srcLotArea + srcObjectArea, b.built * b.area);
    // Fallback lots are real buildings the property-line grid missed; build them before the generic pieces so the
    // block's remaining budget cannot spend their spot on a kamienica elsewhere.
    for (const [frame, x0, x1, z0, z1] of fallbackPieces) {
      xf = frame;
      const pieceArea = (x1 - x0) * (z1 - z0);
      if (fallbackPartClear(x0, x1, z0, z1)) {
        srcPieceBudget = srcLeftArea > 0 ? Math.max(0, (srcTarget - srcBuiltArea) * (pieceArea / srcLeftArea)) : 0;
        populateBlock(x0, x1, z0, z1, b.district, false, null, false, null, true);
      }
      srcLeftArea = Math.max(0, srcLeftArea - pieceArea);
    }
    xf = null;
    minLot = framedMinLot;
    for (const [f, x0, x1, z0, z1, facility] of pieces) {
      xf = f;
      const pieceArea = (x1 - x0) * (z1 - z0);
      srcPieceBudget = srcLeftArea > 0 ? Math.max(0, (srcTarget - srcBuiltArea) * (pieceArea / srcLeftArea)) : 0;
      populateBlock(x0, x1, z0, z1, b.district, facility, null, srcAnchors.length > 0);
      srcLeftArea = Math.max(0, srcLeftArea - pieceArea);
    }
    xf = null;
  }

  // Shop fronts are emitted per building part, so two lots can put storefronts across the same street corner or back
  // to back at a piece seam. Resolve them once every block is in world space: trim the candidate along its own facade
  // (the far end stays put) or, if that leaves nothing worth showing, trim the earlier front instead; only when both
  // are too short does the candidate go. Trimming only ever shrinks a box, so an accepted front can never be pushed
  // into a later one.
  function resolveShopFrontOverlaps() {
    const grid = new Map();
    const cellsOf = (rec) => {
      const { awning, sign } = shopFrontBoxes(rec.a, rec.ry);
      const extents = (b) => {
        const ex = b.hx * Math.abs(b.ax) + b.hz * Math.abs(b.bx);
        const ez = b.hx * Math.abs(b.az) + b.hz * Math.abs(b.bz);
        return [b.cx - ex, b.cx + ex, b.cz - ez, b.cz + ez];
      };
      const [ax0, ax1, az0, az1] = extents(awning);
      const [sx0, sx1, sz0, sz1] = extents(sign);
      const x0 = Math.min(ax0, sx0) - SHOP_CLEARANCE;
      const x1 = Math.max(ax1, sx1) + SHOP_CLEARANCE;
      const z0 = Math.min(az0, sz0) - SHOP_CLEARANCE;
      const z1 = Math.max(az1, sz1) + SHOP_CLEARANCE;
      const cells = [];
      for (let i = Math.floor(x0 / SHOP_CELL); i <= Math.floor(x1 / SHOP_CELL); i++) {
        for (let j = Math.floor(z0 / SHOP_CELL); j <= Math.floor(z1 / SHOP_CELL); j++) cells.push(`${i}|${j}`);
      }
      return cells;
    };
    const add = (rec) => {
      rec.cells = cellsOf(rec);
      for (const key of rec.cells) {
        const list = grid.get(key);
        if (list) list.push(rec);
        else grid.set(key, [rec]);
      }
    };
    const drop = (rec) => {
      for (const key of rec.cells) {
        const list = grid.get(key);
        const i = list ? list.indexOf(rec) : -1;
        if (i >= 0) list.splice(i, 1);
      }
      rec.cells = null;
    };
    const nearby = (rec) => {
      const seen = new Set();
      for (const key of cellsOf(rec)) {
        const list = grid.get(key);
        if (list) for (const r of list) seen.add(r);
      }
      return seen;
    };
    // Shorten rec along its facade until it clears otherRec. false when rec is already shorter than worth keeping.
    const trimAlongFacade = (rec, otherRec) => {
      const a = rec.a;
      const alongX = a.nx === 0; // storefronts on n / s walls run along local x, on w / e walls along local z
      const c = Math.cos(rec.ry);
      const s = Math.sin(rec.ry);
      const fx = alongX ? c : s;
      const fz = alongX ? -s : c;
      const mine = shopFrontBoxes(a, rec.ry);
      const other = shopFrontBoxes(otherRec.a, otherRec.ry);
      const awningHit = boxesOverlap(mine.awning, other.awning);
      const signHit = boxesOverlap(mine.sign, other.sign);
      if (!awningHit && !signHit) return true;
      // A sign is 92% of its awning's width; trim the narrower box when only the signs touch, and map the result back.
      const signOnly = !awningHit;
      const m = signOnly ? mine.sign : mine.awning;
      const o = signOnly ? other.sign : other.awning;
      const scale = signOnly ? 0.92 : 1;
      const half = (alongX ? a.w : a.d) * 0.5 * scale;
      const off = (o.cx - m.cx) * fx + (o.cz - m.cz) * fz;
      const reach = boxRadius(o, fx, fz);
      let lo = -half;
      let hi = half;
      if (off >= 0) hi = off - reach - SHOP_CLEARANCE;
      else lo = off + reach + SHOP_CLEARANCE;
      if (hi - lo < SHOP_MIN_LENGTH * scale) return false;
      const shift = (lo + hi) * 0.5;
      a.x += fx * shift;
      a.z += fz * shift;
      const len = (hi - lo) / scale;
      if (alongX) a.w = len;
      else a.d = len;
      return true;
    };

    for (const blk of allBlocks) {
      if (!blk.awnings.length) continue;
      const ry = blk.ry || 0;
      const keep = [];
      for (const a of blk.awnings) {
        const rec = { a, ry, cells: null };
        let resolved = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          let hit = null;
          for (const other of nearby(rec)) {
            if (shopFrontsOverlap(a, ry, other.a, other.ry)) {
              hit = other;
              break;
            }
          }
          if (!hit) {
            resolved = true;
            break;
          }
          if (trimAlongFacade(rec, hit)) continue;
          if (trimAlongFacade(hit, rec)) {
            drop(hit);
            add(hit);
            continue;
          }
          break;
        }
        if (resolved) {
          keep.push(a);
          add(rec);
        }
      }
      blk.awnings = keep;
    }
  }
  resolveShopFrontOverlaps();

  minLot = 15;
  srcBlock = null;
  outlineIndex = null; // the last block's edge grid is boot-only, like its source poly
  reserveCache = null;
  srcAnchors = [];
  srcObjects = [];
  srcObjectReserves = [];
  srcFallbackLots = [];
  srcLegacy = false;
  srcRects = [];
  srcLotArea = 0;
  fullLotArea = 0;
  srcTarget = 0;
  srcObjectArea = 0;
  srcBuiltArea = 0;
  srcLeftArea = 0;
  srcPieceBudget = 0;

  // B6. Narrow leftover slabs no building fits on (8-26 m wide: wedges between converging streets, slivers by the
  //     bridge approaches) become sitting areas: a row or two of street trees in tree pits (planted by
  //     street-details.js)
  let populatedSlabs = false;
  function populateLeftoverSlabs() {
    if (populatedSlabs) return;
    const plazas = pavedPlazaRects || [];
    const sites = parkTreeSites;
    if (!sites || !sidewalkBlocks) return;
    populatedSlabs = true;
    const hit = (r, x0, x1, z0, z1) => r.minX < x1 && r.maxX > x0 && r.minZ < z1 && r.maxZ > z0;
    for (const s of (sites && sidewalkBlocks) || []) {
      const x0 = s.cx - s.w / 2;
      const x1 = s.cx + s.w / 2;
      const z0 = s.cz - s.d / 2;
      const z1 = s.cz + s.d / 2;
      if (s.cover || (s.block && (s.block.median || s.block.park > 0.6))) continue;
      const narrow = Math.min(s.w, s.d);
      if (narrow < 8 || narrow > 26 || Math.max(s.w, s.d) < 20) continue;
      if (allBlocks.some((b) => hit(b, x0 + 2, x1 - 2, z0 + 2, z1 - 2)) || plazas.some((r) => hit(r, x0, x1, z0, z1))) continue;
      if (overlapsParkOrLandmark(x0, x1, z0, z1)) continue;
      const alongX = s.w > s.d;
      const len = alongX ? s.w : s.d;
      const n = Math.max(1, Math.floor((len - 6) / 8));
      const lanes = narrow >= 15 ? [-narrow / 4, narrow / 4] : [0];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        for (const [j, o] of lanes.entries()) {
          const u = (len - 6) * t + (j % 2) * 2;
          const x = alongX ? s.cx + u : s.cx + o;
          const z = alongX ? s.cz + o : s.cz + u;
          const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
          sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1 });
        }
      }
    }
  }
  populateLeftoverSlabs();

  // ============================================================================
  // C. STATIC CITY-WIDE ARCHITECTURAL MASSING (one instanced facade-box mesh per facade material)
  // ============================================================================
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();

  buckets.forEach((items, matIdx) => {
    if (items.length === 0) return;
    const inst = createFacadeBoxes(materials[matIdx], items);
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  });
  roofs.finish();
  // Facade records and the roof builder are staging data. Streaming below reads allBlocks, not these records;
  // retaining the builder also keeps its pre-chunking meshes alive after scene culling replaces them (~20 MiB).
  buckets.length = 0;
  roofs = null;

  // Rear yards, light courts & project lawns: one thin slab per patch just above the sidewalk (buildings standing on
  // it hide the rest). The turf is the parks' own material, pattern and normal response, so a courtyard reads as the
  // same lawn as the park across the street. The former painted patios and Worley tree crowns were fake detail on a
  // flat slab and made the courtyards blotchy; real paving, where wanted, belongs in city-grid geometry instead.
  const yardMat = createParkLawnMaterial(false);
  const yardRects = [];
  for (const blk of allBlocks) yardRects.push(...blk.yards);
  if (yardRects.length) {
    const yardInst = new THREE.InstancedMesh(unitBox, yardMat, yardRects.length);
    yardRects.forEach((r, i) => {
      dummy.position.set((r.x0 + r.x1) * 0.5, 0.225, (r.z0 + r.z1) * 0.5);
      dummy.rotation.set(0, r.ry || 0, 0);
      dummy.scale.set(r.x1 - r.x0, 0.05, r.z1 - r.z0);
      dummy.updateMatrix();
      yardInst.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    yardInst.receiveShadow = true;
    group.add(yardInst);
  }

  // ============================================================================
  // C2. INDUSTRIAL LANDMARKS: chimneys and cooling towers (GEO.industry, tools/poz-buildings.mjs). Instanced as one
  //     cylinder and one lathe, so the whole skyline costs two draws. The EC Garbary fallback above supplies the two
  //     missing OSM towers; the mapped chimney elsewhere in the box (45 m by the Warta) keeps its real position.
  //     Tanks and silos stay with the block's generated volume.
  // ============================================================================
  const industryStructures = [];
  for (const s of (GEO.industry || [])) {
    if (s.kind !== 'chimney' && s.kind !== 'cooling') continue;
    industryStructures.push({ kind: s.kind, x: s.x, z: s.z, radius: Math.max(2, Math.min(s.w, s.d) * 0.5), height: s.h });
  }
  for (const s of INDUSTRY_FALLBACK) {
    if (industryStructures.some((o) => o.kind === s.kind && Math.hypot(o.x - s.x, o.z - s.z) < 250)) continue;
    industryStructures.push(s);
  }
  if (industryStructures.length) {
    const cooling = industryStructures.filter((s) => s.kind === 'cooling');
    const chimneys = industryStructures.filter((s) => s.kind === 'chimney');
    const place = (mesh, list) => {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        dummy.position.set(s.x, 0, s.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(s.radius, s.height, s.radius);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        colliders.push({ minX: s.x - s.radius, maxX: s.x + s.radius, minZ: s.z - s.radius, maxZ: s.z + s.radius, minY: 0, maxY: s.height });
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    if (cooling.length) {
      const profile = [
        { r: 1.0, y: 0 }, { r: 0.94, y: 0.06 }, { r: 0.78, y: 0.28 }, { r: 0.64, y: 0.52 },
        { r: 0.68, y: 0.72 }, { r: 0.80, y: 0.9 }, { r: 0.86, y: 1.0 }
      ];
      const geo = new THREE.LatheGeometry(profile.map((v) => new THREE.Vector2(v.r, v.y)), 18);
      const mat = new THREE.MeshStandardNodeMaterial({ color: 0xbcb9b2, roughness: 0.94, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geo, mat, cooling.length);
      mesh.name = 'IndustryCoolingTowers';
      place(mesh, cooling);
    }
    if (chimneys.length) {
      const geo = new THREE.CylinderGeometry(0.55, 1, 1, 14);
      geo.translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.76, metalness: 0 });
      mat.colorNode = mix(color(0xbfbab0), color(0x8f211a), step(0.5, fract(positionWorld.y.div(28.0))));
      const mesh = new THREE.InstancedMesh(geo, mat, chimneys.length);
      mesh.name = 'IndustryChimneys';
      place(mesh, chimneys);
    }
  }

  // ============================================================================
  // D. QUADTREE-STREAMED HIGH-DETAIL ARCHITECTURAL POOLS (LOD0 around player)
  // ============================================================================
  const MAX_CORNICES = 7000;
  const MAX_CHIMNEYS = 3000; // ≈ 1600 within STREAM_RADIUS of the Rynek, the densest spot measured
  const MAX_SKYLIGHTS = 1000; // ≈ 280 at most measured
  const MAX_HVAC = 1600;
  const MAX_AWNINGS = 1800;
  const MAX_SCAFFOLDS = 120; // ≈ 35 at most measured
  const MAX_WRAPS = 32; // per advert design

  // 1. Projecting horizontal stone cornices & parapet ledges
  const corniceMat = new THREE.MeshStandardNodeMaterial({ color: 0xc8bca6, roughness: 0.78, metalness: 0.08 });
  const corniceInst = new THREE.InstancedMesh(unitBox, corniceMat, MAX_CORNICES);
  corniceInst.castShadow = true;
  corniceInst.receiveShadow = true;
  corniceInst.frustumCulled = false;
  group.add(corniceInst);

  // 2. Brick chimney stacks: a unit shaft (base at y = 0) with a corbelled cap 15% wider over its top 8%, scaled to
  //    each stack. 7.5 cm brick courses in world space, faded out once a course is under a pixel so far stacks don't
  //    shimmer; soot darkens the top
  const chimneyShaft = new THREE.BoxGeometry(1, 0.92, 1);
  chimneyShaft.translate(0, 0.46, 0);
  const chimneyCap = new THREE.BoxGeometry(1.15, 0.08, 1.15);
  chimneyCap.translate(0, 0.96, 0);
  const chimneyGeo = mergeGeometries([chimneyShaft, chimneyCap], false);
  const chimneyMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
  chimneyMat.colorNode = Fn(() => {
    const y = positionWorld.y;
    const course = fract(y.mul(13.3));
    const mortar = smoothstep(0.82, 0.9, course).mul(smoothstep(0.35, 0.12, fwidth(y).mul(13.3)));
    const brick = mix(color(0x8f4a37), color(0x6e3a2c), mx_noise_float(positionWorld.mul(3.1)).mul(0.5).add(0.5));
    const soot = smoothstep(0.55, 1.0, uv().y).mul(0.55);
    return mix(mix(brick, color(0xb5a891), mortar.mul(0.6)), color(0x2a2522), soot);
  })();
  const chimneyInst = new THREE.InstancedMesh(chimneyGeo, chimneyMat, MAX_CHIMNEYS);
  chimneyInst.castShadow = chimneyInst.receiveShadow = true;
  chimneyInst.frustumCulled = false;
  group.add(chimneyInst);

  // 3. Roof skylights: low glazed boxes on the flat roofs
  const skylightMat = new THREE.MeshStandardNodeMaterial({ color: 0x2b3946, roughness: 0.16, metalness: 0.6 });
  const skylightInst = new THREE.InstancedMesh(unitBox, skylightMat, MAX_SKYLIGHTS);
  skylightInst.receiveShadow = true;
  skylightInst.frustumCulled = false;
  group.add(skylightInst);

  // 4. Rooftop mechanical penthouses & HVAC chillers with top exhaust fans & side louvers (modern roofs only)
  const hvacMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.52, metalness: 0.45 });
  hvacMat.colorNode = Fn(() => {
    const u = uv();
    const isTop = step(0.7, normalWorldGeometry.y);
    const fan1 = length(u.sub(vec2(0.3, 0.5)));
    const fan2 = length(u.sub(vec2(0.7, 0.5)));
    const fanDist = min(fan1, fan2);
    const inFanWell = smoothstep(0.19, 0.17, fanDist);
    const fanRing = smoothstep(0.025, 0.008, abs(fract(fanDist.mul(16.0)).sub(0.5))).mul(inFanWell);
    const topCol = mix(color(0x889098), color(0x1b2026), inFanWell.mul(0.82).sub(fanRing.mul(0.45)));

    const inLouverBox = step(0.12, u.x).mul(step(u.x, 0.88)).mul(step(0.18, u.y)).mul(step(u.y, 0.82));
    const louverSlat = step(0.45, fract(u.y.mul(14.0))).mul(inLouverBox);
    const panelSeam = smoothstep(0.03, 0.0, abs(fract(u.x.mul(3.0)).sub(0.5)));
    const sideCol = mix(color(0x7c848c), color(0x282e36), max(louverSlat.mul(0.72), panelSeam.mul(0.35)));
    return mix(sideCol, topCol, isTop);
  })();
  const hvacInst = new THREE.InstancedMesh(unitBox, hvacMat, MAX_HVAC);
  hvacInst.castShadow = hvacInst.receiveShadow = true;
  hvacInst.frustumCulled = false;
  group.add(hvacInst);

  // 5. Balcony stacks (balconies.js, fed blk.balconies): real geometry nearby, silhouettes in the distance
  const balconySystem = createBalconies(group);

  // 6. Ground-floor retail canvas awnings & illuminated storefront fascia signs
  const awningMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.65 });
  const awningPalette = [
    new THREE.Color(0x9e222e),
    new THREE.Color(0x1f593b),
    new THREE.Color(0x213d68),
    new THREE.Color(0xd9912b),
    new THREE.Color(0x2d2d32)
  ];
  const awningInst = new THREE.InstancedMesh(unitBox, awningMat, MAX_AWNINGS);
  awningInst.castShadow = awningInst.receiveShadow = true;
  awningInst.frustumCulled = false;
  // Pre-initialize instanceColor buffer so dynamic updates work cleanly
  for (let i = 0; i < MAX_AWNINGS; i++) {
    awningInst.setColorAt(i, awningPalette[i % awningPalette.length]);
  }
  group.add(awningInst);

  const signThemes = [
    { bg: '#1c130c', border: '#d49b52', text: 'PIEKARNIA', color: '#ffecbe', light: new THREE.Color(0xffd896) },
    { bg: '#2b1018', border: '#f092a5', text: 'CUKIERNIA', color: '#fff0f3', light: new THREE.Color(0xffe4e8) },
    { bg: '#08331d', border: '#2ecc71', text: 'APTEKA', color: '#ffffff', light: new THREE.Color(0xd8ffe8) },
    { bg: '#13281e', border: '#d4af37', text: 'KSIĘGARNIA', color: '#fff4cc', light: new THREE.Color(0xffeebb) },
    { bg: '#18110d', border: '#c79c6e', text: 'KAWIARNIA', color: '#f7ede2', light: new THREE.Color(0xffedd8) },
    { bg: '#290c12', border: '#ff6b4a', text: 'BAR MLECZNY', color: '#ffe2b8', light: new THREE.Color(0xffcfa8) },
    { bg: '#101419', border: '#c0c8d4', text: 'ZEGARMISTRZ', color: '#f2f6fc', light: new THREE.Color(0xeef4ff) },
    { bg: '#0d1527', border: '#e6c35c', text: 'JUBILER', color: '#fff9e6', light: new THREE.Color(0xfff5cc) },
    { bg: '#142617', border: '#70c976', text: 'KWIACIARNIA', color: '#e8fae8', light: new THREE.Color(0xe2ffe8) },
    { bg: '#121820', border: '#e74c3c', text: 'FRYZJER', color: '#ffffff', light: new THREE.Color(0xffffff) },
    { bg: '#0b2024', border: '#4ecdc4', text: 'OPTYK', color: '#e8ffff', light: new THREE.Color(0xdffffd) },
    { bg: '#101c2e', border: '#f1c40f', text: 'SKLEP SPOŻYWCZY', color: '#ffffff', light: new THREE.Color(0xfffaed) },
    { bg: '#2b0b0e', border: '#c0392b', text: 'WĘDLINY', color: '#ffdede', light: new THREE.Color(0xffe0dc) },
    { bg: '#0e2412', border: '#f39c12', text: 'WARZYWNIAK', color: '#eaffea', light: new THREE.Color(0xecffd8) },
    { bg: '#2d0e07', border: '#e67e22', text: 'PIZZERIA', color: '#fff2d6', light: new THREE.Color(0xffd2a0) },
    { bg: '#1a100c', border: '#e74c3c', text: 'KEBAB', color: '#ffdd59', light: new THREE.Color(0xffe090) },
    { bg: '#121212', border: '#f39c12', text: 'LOMBARD', color: '#f1c40f', light: new THREE.Color(0xffea9f) },
    { bg: '#0d222d', border: '#3498db', text: 'PRALNIA', color: '#eaf6ff', light: new THREE.Color(0xe0f2ff) },
    { bg: '#1a1209', border: '#a07855', text: 'SZEWC', color: '#f5e6d3', light: new THREE.Color(0xffeedd) },
    { bg: '#111822', border: '#ffd200', text: 'KANTOR', color: '#ffffff', light: new THREE.Color(0xfff8c0) },
    { bg: '#240f22', border: '#e056fd', text: 'DROGERIA', color: '#fff0fd', light: new THREE.Color(0xfbe8ff) },
    { bg: '#23121d', border: '#f3a683', text: 'KOSMETYKA', color: '#fcedf2', light: new THREE.Color(0xffeaee) },
    { bg: '#101c2b', border: '#4a90e2', text: 'POCZTA', color: '#f0f6fc', light: new THREE.Color(0xe8f0ff) },
    { bg: '#2a140d', border: '#e58e26', text: 'PIEROGARNIA', color: '#fff5eb', light: new THREE.Color(0xffe2b8) },
    { bg: '#1d1128', border: '#9b59b6', text: 'PASMANTERIA', color: '#f5ebff', light: new THREE.Color(0xf2e8ff) },
    { bg: '#101622', border: '#95a5a6', text: 'KRAWIEC', color: '#ecf0f1', light: new THREE.Color(0xf0f4f8) },
    // Two chain storefronts Poznań shoppers recognise, text-only (no logos): the atlas has exactly 7 x 4 cells.
    { bg: '#0b6e3f', border: '#7bd389', text: 'ŻABKA', color: '#ffffff', light: new THREE.Color(0xd8ffe8) },
    { bg: '#a3121b', border: '#f4b400', text: 'BIEDRONKA', color: '#ffffff', light: new THREE.Color(0xffe8d8) }
  ];
  // Storefront fascia signs: one texture atlas and one InstancedMesh for all 28 Polish shop/brand designs (PIEKARNIA,
  // APTEKA, ŻABKA, …). The former code created one canvas texture and one instanced mesh per design, so the whole city
  // paid 26 draw calls and 26 texture bindings for the same ~1,800 signs. A per-instance `signCell` attribute picks
  // the tile inside the sign shader; 7 x 4 cells of 512 x 96 px with a 2 px gutter keep the street-level text crisp.
  const SIGN_ATLAS_COLS = 7;
  const SIGN_ATLAS_ROWS = Math.ceil(signThemes.length / SIGN_ATLAS_COLS);
  const SIGN_TILE_W = 512;
  const SIGN_TILE_H = 96;
  const SIGN_GUTTER = 2;
  const SIGN_CELL_W = SIGN_TILE_W + SIGN_GUTTER * 2;
  const SIGN_CELL_H = SIGN_TILE_H + SIGN_GUTTER * 2;
  const signCanvas = document.createElement('canvas');
  signCanvas.width = SIGN_ATLAS_COLS * SIGN_CELL_W;
  signCanvas.height = SIGN_ATLAS_ROWS * SIGN_CELL_H;
  const signCtx = signCanvas.getContext('2d');
  signThemes.forEach((st, i) => {
    const x0 = (i % SIGN_ATLAS_COLS) * SIGN_CELL_W + SIGN_GUTTER;
    const y0 = Math.floor(i / SIGN_ATLAS_COLS) * SIGN_CELL_H + SIGN_GUTTER;
    // The gutter repeats the tile's background so mip levels fade into the same colour instead of a neighbour.
    signCtx.fillStyle = st.bg;
    signCtx.fillRect(x0 - SIGN_GUTTER, y0 - SIGN_GUTTER, SIGN_CELL_W, SIGN_CELL_H);
    signCtx.strokeStyle = st.border;
    signCtx.lineWidth = 6;
    signCtx.strokeRect(x0 + 6, y0 + 6, SIGN_TILE_W - 12, SIGN_TILE_H - 12);
    signCtx.fillStyle = st.color;
    signCtx.font = '800 28px Inter, Arial, sans-serif';
    signCtx.textAlign = 'center';
    signCtx.textBaseline = 'middle';
    signCtx.fillText(st.text, x0 + SIGN_TILE_W / 2, y0 + SIGN_TILE_H / 2 + 2, SIGN_TILE_W - 42);
  });
  const signAtlas = new THREE.CanvasTexture(signCanvas);
  signAtlas.colorSpace = THREE.SRGBColorSpace;
  signAtlas.anisotropy = 4;
  const signMat = new THREE.MeshBasicNodeMaterial();
  const signCell = attribute('signCell', 'vec2');
  // Canvas row 0 is the texture's top (flipY), so a cell row counts up from the bottom of the atlas.
  const signUv = uv()
    .mul(vec2(SIGN_TILE_W / signCanvas.width, SIGN_TILE_H / signCanvas.height))
    .add(vec2(signCell.x, float(SIGN_ATLAS_ROWS - 1).sub(signCell.y))
      .mul(vec2(SIGN_CELL_W / signCanvas.width, SIGN_CELL_H / signCanvas.height)))
    .add(vec2(SIGN_GUTTER / signCanvas.width, SIGN_GUTTER / signCanvas.height));
  signMat.colorNode = texture(signAtlas, signUv);
  const signGeo = new THREE.BoxGeometry(1, 1, 1);
  const signCellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_AWNINGS * 2), 2);
  signGeo.setAttribute('signCell', signCellAttr);
  const signInst = new THREE.InstancedMesh(signGeo, signMat, MAX_AWNINGS);
  signInst.name = 'ShopSigns';
  signInst.frustumCulled = false;
  group.add(signInst);

  // 7. Renovation scaffolding: a box 1.4 m deep standing off the facade, its netting drawn in world space (2 m lifts
  //    and 2.5 m bays of steel tube behind a woven green net, the weave averaged out under a pixel); building-wrap
  //    adverts (siatki reklamowe) print one of WRAP_THEMES designs on the net instead
  const netMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0 });
  netMat.colorNode = Fn(() => {
    const p = positionWorld;
    const u = p.x.add(p.z);
    const px = max(length(fwidth(p.xz)), fwidth(p.y)); // metres per pixel
    const tubes = max(step(0.93, fract(p.y.mul(0.5))), step(0.94, fract(u.mul(0.4)))).mul(smoothstep(0.3, 0.08, px));
    const weave = abs(fract(p.y.mul(6.0)).sub(0.5)).add(abs(fract(u.mul(6.0)).sub(0.5))).mul(smoothstep(0.08, 0.02, px));
    const net = mix(color(0x3b7d58), color(0x2a5a40), weave);
    return mix(net, color(0x8b9096), tubes.mul(0.7));
  })();
  const netInst = new THREE.InstancedMesh(unitBox, netMat, MAX_SCAFFOLDS);
  netInst.castShadow = netInst.receiveShadow = true;
  netInst.frustumCulled = false;
  group.add(netInst);

  const wrapThemes = [
    { bg: '#c8102e', fg: '#ffffff', lines: ['ROGALE', 'ŚWIĘTOMARCIŃSKIE', '11 LISTOPADA'] },
    { bg: '#0b3d91', fg: '#ffd400', lines: ['KONCERTY', 'NAD MALTĄ', 'LATO 2026'] },
    { bg: '#f2f0ea', fg: '#1d1d1b', lines: ['NOWE', 'MIESZKANIA', 'WILDA 2027'] },
    { bg: '#1f6b3a', fg: '#ffffff', lines: ['PYRY', 'Z GZIKIEM', 'BAR NA ŁAZARZU'] }
  ].slice(0, WRAP_THEMES);
  const wrapInsts = wrapThemes.map((wt) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = wt.bg;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = wt.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wt.lines.forEach((line, i) => {
      ctx.font = `900 ${i === 2 ? 40 : 58}px Inter, Arial, sans-serif`;
      ctx.fillText(line, 256, 150 + i * 110, 480);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const wInst = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.8 }), MAX_WRAPS);
    wInst.castShadow = wInst.receiveShadow = true;
    wInst.frustumCulled = false;
    group.add(wInst);
    return wInst;
  });

  // 8. Ground-floor storefront clustered SpotLights (awnings/fascia signs)
  const storeLightGroup = new THREE.Group();
  storeLightGroup.name = 'StoreClusteredLights';
  scene.add(storeLightGroup);

  const STORE_SPOT_POOL = 28;
  const storeSpotPool = [];
  for (let i = 0; i < STORE_SPOT_POOL; i++) {
    const spot = new THREE.SpotLight(0xffd896, 0, 12.0, 0.84, 0.80, 1.30);
    spot.castShadow = false;
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    storeLightGroup.add(spot);
    storeLightGroup.add(spot.target);
    storeSpotPool.push(spot);
  }

  const activeAwnings = [];
  // Per-frame light candidates: refs into a fixed pool (one per awning that can be active), sorted by a hoisted
  // comparator, so updateLights allocates nothing
  const spotCandidatePool = Array.from({ length: MAX_AWNINGS }, () => ({ item: null, effDist: 0 }));
  const spotCandidates = [];
  const byEffDist = (a, b) => a.effDist - b.effDist;

  // ============================================================================
  // E. DYNAMIC QUADTREE STREAMING UPDATE AROUND PLAYER / CAMERA
  // ============================================================================
  let lastStreamX = Infinity;
  let lastStreamZ = Infinity;
  const STREAM_RADIUS = 560; // High-detail architectural radius around player in meters

  // Streaming rewrites only the active prefix; unused pool capacity need not cross the GPU queue.
  function flagRange(attribute, count) {
    if (count === 0) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  function update(focusX, focusZ, force = false) {
    const dx = focusX - lastStreamX;
    const dz = focusZ - lastStreamZ;
    if (!force && (dx * dx + dz * dz) < 324) {
      // Player moved less than 18m since last Quadtree stream update
      return;
    }
    lastStreamX = focusX;
    lastStreamZ = focusZ;

    const nearbyBlocks = quadtree.queryRange(focusX, focusZ, STREAM_RADIUS);
    // Sort closest blocks first so if any pool hits capacity, closest blocks around the player always win
    nearbyBlocks.sort((a, b) => {
      const da = (a.cx - focusX) * (a.cx - focusX) + (a.cz - focusZ) * (a.cz - focusZ);
      const db = (b.cx - focusX) * (b.cx - focusX) + (b.cz - focusZ) * (b.cz - focusZ);
      return da - db;
    });
    activeAwnings.length = 0;

    let corniceCount = 0;
    let chimneyCount = 0;
    let skylightCount = 0;
    let hvacCount = 0;
    balconySystem.begin();
    let awningCount = 0;
    let netCount = 0;
    let signCount = 0;
    const wrapCounts = wrapInsts.map(() => 0);

    for (let bIdx = 0; bIdx < nearbyBlocks.length; bIdx++) {
      const blk = nearbyBlocks[bIdx];
      // every piece of a block turned into a frontage frame shares its turn (see placeInFrame)
      const blkRy = blk.ry || 0;
      const blkCs = Math.cos(blkRy);
      const blkSn = Math.sin(blkRy);
      dummy.rotation.set(0, blkRy, 0);
      const collectNearLights = bIdx < 20;

      // 1. Stone cornices & setback ledges, hung just below their roof line (top 0.1h under it, so no two ledges or
      //    roofs share a plane) so roofs & terraces keep their own roofing instead of a stone lid
      for (let i = 0; i < blk.cornices.length && corniceCount < MAX_CORNICES; i++) {
        const c = blk.cornices[i];
        dummy.position.set(c.x, c.y - c.h * 0.6, c.z);
        dummy.scale.set(c.w, c.h, c.d);
        dummy.updateMatrix();
        corniceInst.setMatrixAt(corniceCount++, dummy.matrix);
      }

      // 2. Chimney stacks, standing on the eave line
      for (let i = 0; i < blk.chimneys.length && chimneyCount < MAX_CHIMNEYS; i++) {
        const c = blk.chimneys[i];
        dummy.position.set(c.x, c.y, c.z);
        dummy.scale.set(c.w, c.h, c.d);
        dummy.updateMatrix();
        chimneyInst.setMatrixAt(chimneyCount++, dummy.matrix);
      }

      // 3. Skylights, 0.4 m proud of the roof
      for (let i = 0; i < blk.skylights.length && skylightCount < MAX_SKYLIGHTS; i++) {
        const s = blk.skylights[i];
        dummy.position.set(s.x, s.y + 0.2, s.z);
        dummy.scale.set(s.w, 0.4, s.d);
        dummy.updateMatrix();
        skylightInst.setMatrixAt(skylightCount++, dummy.matrix);
      }

      // 4. Rooftop HVAC & mechanical penthouses
      for (let i = 0; i < blk.hvacUnits.length && hvacCount < MAX_HVAC; i++) {
        const u = blk.hvacUnits[i];
        dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
        dummy.scale.set(u.w, u.h, u.d);
        dummy.updateMatrix();
        hvacInst.setMatrixAt(hvacCount++, dummy.matrix);
      }

      // 5. Balconies
      for (const bal of blk.balconies) balconySystem.add(bal, focusX, focusZ);

      // 6. Retail awnings & illuminated storefront fascia signs (the sign flat on the wall above the awning, thin
      //    along the wall's normal)
      for (let i = 0; i < blk.awnings.length && awningCount < MAX_AWNINGS; i++) {
        const a = blk.awnings[i];
        dummy.position.set(a.x, a.y, a.z);
        dummy.scale.set(a.w, SHOP_AWNING_H, a.d);
        dummy.updateMatrix();
        awningInst.setMatrixAt(awningCount, dummy.matrix);
        awningInst.setColorAt(awningCount, awningPalette[a.colorIdx % awningPalette.length]);

        // Theme hashed from the shop's position, not its slot in the pool: the slot shifts on every re-query, so the
        // signs used to change as the player moved
        const themeIdx = ((Math.imul(Math.round(a.x * 4), 73856093) ^ Math.imul(Math.round(a.z * 4), 19349663)) >>> 0) % signThemes.length;
        if (signCount < MAX_AWNINGS) {
          // The wall normal is a local-frame vector; turn it with the block before stepping back toward the wall
          const ox = a.nx * blkCs + a.nz * blkSn;
          const oz = a.nz * blkCs - a.nx * blkSn;
          dummy.position.set(a.x - ox * SHOP_SIGN_BACK, SHOP_SIGN_Y, a.z - oz * SHOP_SIGN_BACK);
          if (a.nx !== 0) dummy.scale.set(SHOP_SIGN_THICKNESS, SHOP_SIGN_H, a.d * 0.92);
          else dummy.scale.set(a.w * 0.92, SHOP_SIGN_H, SHOP_SIGN_THICKNESS);
          dummy.updateMatrix();
          signInst.setMatrixAt(signCount, dummy.matrix);
          signCellAttr.setXY(signCount, themeIdx % SIGN_ATLAS_COLS, Math.floor(themeIdx / SIGN_ATLAS_COLS));
          signCount++;
        }
        if (collectNearLights) {
          activeAwnings.push({ a, themeIdx, ry: blk.ry || 0 });
        }
        awningCount++;
      }

      // 7. Renovation scaffolding: netting, or a building-wrap advert
      for (let i = 0; i < blk.scaffolds.length; i++) {
        const s = blk.scaffolds[i];
        const inst = s.ad >= 0 ? wrapInsts[s.ad] : netInst;
        const n = s.ad >= 0 ? wrapCounts[s.ad] : netCount;
        if (n >= (s.ad >= 0 ? MAX_WRAPS : MAX_SCAFFOLDS)) continue;
        dummy.position.set(s.x, s.y + s.h * 0.5, s.z);
        dummy.scale.set(s.w, s.h, s.d);
        dummy.updateMatrix();
        inst.setMatrixAt(n, dummy.matrix);
        if (s.ad >= 0) wrapCounts[s.ad]++;
        else netCount++;
      }
    }
    dummy.rotation.set(0, 0, 0);

    corniceInst.count = corniceCount;
    flagRange(corniceInst.instanceMatrix, corniceCount);

    chimneyInst.count = chimneyCount;
    flagRange(chimneyInst.instanceMatrix, chimneyCount);

    skylightInst.count = skylightCount;
    flagRange(skylightInst.instanceMatrix, skylightCount);

    hvacInst.count = hvacCount;
    flagRange(hvacInst.instanceMatrix, hvacCount);

    balconySystem.end();

    awningInst.count = awningCount;
    flagRange(awningInst.instanceMatrix, awningCount);
    if (awningInst.instanceColor) flagRange(awningInst.instanceColor, awningCount);

    signInst.count = signCount;
    flagRange(signInst.instanceMatrix, signCount);
    flagRange(signCellAttr, signCount);

    netInst.count = netCount;
    flagRange(netInst.instanceMatrix, netCount);
    wrapInsts.forEach((wInst, idx) => {
      wInst.count = wrapCounts[idx];
      flagRange(wInst.instanceMatrix, wrapCounts[idx]);
    });
  }

  function smoothFade(d, start, end) {
    const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function updateLights(camera) {
    const glow = 0.85;
    const glowFactor = Math.max(0, (glow - 0.15) / 0.90);
    if (!camera || glowFactor <= 0.001) {
      for (let i = 0; i < STORE_SPOT_POOL; i++) {
        storeSpotPool[i].intensity = 0;
        storeSpotPool[i].position.set(0, -1000, 0);
      }
      return;
    }

    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    const e = camera.matrixWorld.elements;
    const fwdLen = Math.hypot(e[8], e[10]) || 1;
    const fwdX = -e[8] / fwdLen;
    const fwdZ = -e[10] / fwdLen;
    const STORE_MAX_DIST = 115;

    spotCandidates.length = 0;
    for (let i = 0; i < activeAwnings.length; i++) {
      const item = activeAwnings[i];
      const a = item.a;
      const dx = a.x - camX;
      const dz = a.z - camZ;
      const d2 = dx * dx + dz * dz + camY * camY;
      if (d2 > STORE_MAX_DIST * STORE_MAX_DIST) continue;
      const d = Math.sqrt(d2);
      const forwardDot = dx * fwdX + dz * fwdZ;
      const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
      if (effDist >= STORE_MAX_DIST) continue;
      if (spotCandidates.length >= spotCandidatePool.length) break;
      const cand = spotCandidatePool[spotCandidates.length];
      cand.item = item;
      cand.effDist = effDist;
      spotCandidates.push(cand);
    }
    spotCandidates.sort(byEffDist);

    const storeCutoff = spotCandidates.length > STORE_SPOT_POOL
      ? Math.min(STORE_MAX_DIST, spotCandidates[STORE_SPOT_POOL].effDist)
      : STORE_MAX_DIST;
    const activeSpots = Math.min(STORE_SPOT_POOL, spotCandidates.length);
    const spotIntensity = 46 * glowFactor;
    for (let i = 0; i < STORE_SPOT_POOL; i++) {
      const spot = storeSpotPool[i];
      if (i < activeSpots) {
        const cand = spotCandidates[i];
        const { a, themeIdx, ry } = cand.item;
        const fade = smoothFade(cand.effDist, storeCutoff * 0.62, storeCutoff);
        // the wall's outward normal, turned by the block's frame (R_y(ry))
        const cs = Math.cos(ry);
        const sn = Math.sin(ry);
        const outX = a.nx * cs + a.nz * sn;
        const outZ = a.nz * cs - a.nx * sn;
        spot.position.set(a.x + outX * 0.45, 4.35, a.z + outZ * 0.45);
        spot.target.position.set(a.x + outX * 1.85, 0.0, a.z + outZ * 1.85);
        spot.target.updateMatrixWorld();
        spot.color.copy(signThemes[themeIdx % signThemes.length].light);
        spot.intensity = spotIntensity * fade;
      } else {
        spot.intensity = 0;
        spot.position.set(0, -1000, 0);
      }
    }
  }

  // Initial quadtree stream around the spawn point
  const quadtree = createDetailQuadtree(allBlocks);
  update(SPAWN.x, SPAWN.z, true);

  const footprintsByBlock = new Map();
  for (const blk of allBlocks) {
    if (blk.srcBlockId !== null && blk.srcBlockId !== undefined) {
      if (!footprintsByBlock.has(blk.srcBlockId)) footprintsByBlock.set(blk.srcBlockId, []);
      const list = footprintsByBlock.get(blk.srcBlockId);
      for (const f of blk.footprints) {
        if (f.y0 !== undefined && f.y0 > 0.01) continue; // ground-level footprints only (exclude upper-tier stacked parts)
        const pts = f.pts || [
          { x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 },
          { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }
        ];
        list.push(pts);
      }
    }
  }

  scene.add(group);
  return {
    group,
    colliders,
    quadtree,
    allBlocks,
    footprintsByBlock,
    industryStructures,
    populateLeftoverSlabs,
    update,
    updateLights
  };
}

export { Quadtree, buildCityBlocks, shopFrontBoxes, shopFrontsOverlap };
