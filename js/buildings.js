import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBalconies } from './balconies.js';
import {
  Fn,
  float,
  vec2,
  vec4,
  color,
  uv,
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
  mx_noise_float,
  mx_worley_noise_float
} from 'three/tsl';
import {
  CITY_BOUNDS,
  BLOCKS,
  BRIDGES,
  LANDMARK_SITES,
  PLAZAS,
  SPAWN,
  SRODKA_MURAL,
  blockAt,
  pointInPark,
  parkFreeCells,
  splitDeep
} from './city-config.js';
import {
  parkLawnColorNode,
  parkLawnNormalNode,
  setParkLawnSpecular,
  createPreWarBuildingMaterial,
  createCurtainWallMaterial,
  createPanelBlockMaterial,
  createRoofMaterial,
  createDormerWindowMaterial,
  createGableScreenMaterial,
  createFacadeBoxes,
  WALL_KINDS
} from './tsl-materials.js';
import { createRoofs } from './roofs.js';
import { GEO } from './geodata.js';
import { pavedPlazaRects, parkTreeSites, sidewalkBlocks } from './city-grid.js';

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
  let srcRects = []; // its lot rects { x0, x1, z0, z1 } in their frames { cs, sn, px, pz } (see frontages)
  let srcLotArea = 0; // the area of the lot pieces it builds on (m², see steerProfile)
  let fullLotArea = 0; // lot area before park carve-out (m², see steerProfile)
  const toWorld = (x, z) => (xf
    ? [xf.px + (x - xf.px) * xf.cs + (z - xf.pz) * xf.sn, xf.pz - (x - xf.px) * xf.sn + (z - xf.pz) * xf.cs]
    : [x, z]);
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

  // Spatial quadtree over the whole detail box
  const quadtree = new Quadtree({
    minX: CITY_BOUNDS.minX - 50,
    maxX: CITY_BOUNDS.maxX + 50,
    minZ: CITY_BOUNDS.minZ - 50,
    maxZ: CITY_BOUNDS.maxZ + 50
  }, 6, 9);
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
  // buildings, copper on turrets, risalits and domes. One shader for all three (createRoofMaterial keeps the kind in
  // uniforms); the gable ends are render. Staged by commit, written once by finish() below
  const roofs = createRoofs({
    materials: {
      tile: createRoofMaterial({ kind: 'tile' }),
      slate: createRoofMaterial({ kind: 'slate' }),
      copper: createRoofMaterial({ kind: 'copper' }),
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
        bridgeCorridors.push({
          cx: (a.x + c.x) * 0.5, cz: (a.z + c.z) * 0.5, ux: (c.x - a.x) / L, uz: (c.z - a.z) / L, hl: L * 0.5 + 4, hw: link.width * 0.5 + 3
        });
      }
    }
  }
  // Separating-axis test of the rect [x0, x1] x [z0, z1] (of the current frame) against every corridor box
  function hitsBridgeCorridor(x0, x1, z0, z1) {
    const hx = (x1 - x0) * 0.5;
    const hz = (z1 - z0) * 0.5;
    const [cx, cz] = toWorld(x0 + hx, z0 + hz);
    // the rect's axes in the world (R_y(θ) of local x and z)
    const ax = xf ? xf.cs : 1, az = xf ? -xf.sn : 0;
    const bx = xf ? xf.sn : 0, bz = xf ? xf.cs : 1;
    for (const o of bridgeCorridors) {
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
   *      get a residential entrance), freestanding, walls (see wallKinds), dormers (share of such buildings with
 *      roofs.js dormers on their pitched tile or slate roofs) }
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
          if (w < 6 || !b.street[side] || Math.abs(c - wallAt(b.lot, side)) > EPS) continue;
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
      if (plan === 'L') {
        const ea = chance(0.5) ? 0 : L - wing;
        wings.push(sideRect(lot, side, ea, ea + wing, front, front + wd));
      } else if (plan === 'U' || plan === 'ring') {
        wings.push(sideRect(lot, side, 0, wing, front, front + wd), sideRect(lot, side, L - wing, L, front, front + wd));
        if (plan === 'ring') wings.push(sideRect(lot, side, wing, L - wing, front + wd - range(6, 7.5), front + wd));
      }
      mass(b, wings, 0, wf);
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
      const depthRun = range(kind.depth[0], kind.depth[1]);
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
      const court = cfg.dense ? Math.max(9, floors * storeys[mat] * 0.6) : Math.max(14, floors * storeys[mat]);
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
  }

  // Mid-rise office block, glass or sandstone-clad, with a recessed top floor
  function officeSlab(blk, side, lot, cfg) {
    const mat = chance(0.7) ? pickW(GLASS) : pickW([[F.sandstone, 1], [F.cream, 1]]);
    const b = building(blk, mat, lot);
    const L = sideLen(lot, side);
    const D = Math.min(sideDepth(lot, side), range(16, 24));
    const f = irange(cfg.mid[0], cfg.mid[1]);
    mass(b, [sideRect(lot, side, 0, L, 0, D)], 0, f);
    if (D >= 12 && L >= 6 && chance(0.6)) mass(b, [sideRect(lot, side, 1, L - 1, range(2, 3), D - 1)], f, f + 1);
    commit(blk, b, { cornice: !isGlass(mat), hvac: true, hvacH: range(2.6, 3.6), shops: 'all' });
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
    // built up like a frontless lot; sides without a frontage face the block's other lot rects
    const inset = (s) => (reach[s] ? Math.min(reach[s], ROW_REACH) : 0) + (cfg.dense ? 3 : INNER_YARD);
    const core = rect(R.x0 + inset('w'), R.x1 - inset('e'), R.z0 + inset('n'), R.z1 - inset('s'));
    if (!cfg.noCore && Math.min(rectW(core), rectD(core)) >= 16) innerBuildings(blk, core, cfg.inner || INNER_RES, cfg);
  }
  // Deepest a row lot builds: kamienica depth 34 m × the ±5% run jitter (fillFrontage), rounded up
  const ROW_REACH = 36;

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
  // deep
  function officeBlock(blk, cfg) {
    const R = blockRect(blk);
    blk.yards.push(insetAll(R, 1.5));
    const main = mainFront(blk);
    if (!main) {
      innerLot(blk, R, cfg);
      return;
    }
    const L = sideLen(R, main);
    const D = Math.min(sideDepth(R, main), 48);
    let a = 0;
    while (L - a > 0.5) {
      let w = range(26, 52);
      if (L - a - w < 18) w = L - a;
      const lot = sideRect(R, main, a, a + w, 0, D);
      if (w >= 22 && D >= 22 && chance(cfg.towerP)) officeTower(blk, main, lot, cfg);
      else officeSlab(blk, main, lot, cfg);
      a += w;
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
    let set = range(cfg.setback[0], cfg.setback[1]);
    if (wid < 2 * set + 11) set = Math.max(3, (wid - 11) * 0.5);
    const place = (u0, u1, v0, v1, floors) => {
      const r = alongX ? rect(R.x0 + u0, R.x0 + u1, R.z0 + v0, R.z0 + v1) : rect(R.x0 + v0, R.x0 + v1, R.z0 + u0, R.z0 + u1);
      const b = building(blk, pickW(PANELS), r);
      mass(b, [r], 0, floors);
      commit(blk, b, { cornice: false, hvac: 'small', hvacH: 2.6, awnings: false, shops: 'none', freestanding: true });
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
      const dep = floors >= 16 ? range(18, 22) : range(10.5, 12.5);
      if (v + dep > wid - set) break;
      if (lastEnd >= 0) service(lastEnd, v);
      lastEnd = v + dep;
      if (floors >= 16) {
        const gap = range(24, 36);
        const n = Math.floor((len - 2 * set + gap) / (dep + gap));
        const off = (len - n * dep - (n - 1) * gap) * 0.5;
        for (let k = 0; k < n; k++) place(off + k * (dep + gap), off + k * (dep + gap) + dep, v, v + dep, floors);
      } else {
        let u = set + range(0, 6);
        while (len - set - u >= 24) {
          const seg = Math.min(len - set - u, range(40, 110));
          place(u, u + seg, v, v + dep, floors);
          u += seg + range(18, 30);
        }
      }
      v += dep + Math.max(18, floors * storeys[F.panel] * 0.9);
    }
    if (lastEnd >= 0) service(lastEnd, wid - set + 6);
    // An estate's frontage frames cut its blocks into strips 12-20 m deep that hold no row above: one slab along the
    // strip, 1-2 m off its ends (Nowe Winogrady Południe went from 4.4% to 14.9% built with it, 17.2% real)
    if (lastEnd < 0 && cfg.estate && wid >= 11 && len >= 24) {
      const dep = Math.min(wid - 1, range(10.5, 12.5));
      const seg = Math.min(len - 2, range(40, 110));
      const u0 = (len - seg) * range(0.3, 0.7);
      const v0 = (wid - dep) * 0.5;
      place(u0, u0 + seg, v0, v0 + dep, pickW(cfg.types));
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

  // Hospital and university campuses: institutional blocks along the streets and a loose grid of clinics and
  // institutes inside, with 12-18 m service alleys between them. `cfg.share` is the block's real OSM built share over
  // its lot area (steerProfile), so each lot rect builds its target: the frontage takes up to 60% of that budget and
  // the core pavilions the rest. Before this, a 16 ha hospital block in Łazarz/Grunwald built 14.9% against 21% real.
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

  const LAYOUTS = {
    res: residentialBlock,
    rynek: residentialBlock, // with cfg.rynekRows on the frontages facing the square
    cesarska: cesarskaBlock,
    offices: officeBlock,
    loft: loftBlock,
    projects: projectsBlock,
    lowrise: lowriseBlock,
    fair: fairBlock,
    villas: villaBlock,
    campus: campusBlock
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
  // Stare Miasto round the Rynek, Garbary, Chwaliszewo: 3-5-storey kamienice, mixed, war gaps and pavilions
  const RES_STARE = res({
    corner: [14, 20],
    cornerFloors: [4, 5],
    turretP: 0.15,
    shops: 0.6,
    rows: [['kamienica', 7], ['infill', 1], ['postwarBlock', 0.8], ['low', 0.6], ['gap', 1]],
    kf: { kamienica: [3, 5], postwarBlock: [4, 5] }
  });
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
  // Round Rondo Kaponiera, Plac Andersa and Collegium Altum: offices of 6-20 storeys (podium 2-4 + shaft 4-16)
  const OFFICES = { kind: 'offices', tower: [4, 16], mid: [6, 9], towerP: 0.45, inner: [['pavilion', 3], ['works', 1], ['yard', 1]] };
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
    campus: 0.3
  };
  const RES_KINDS = new Set(['res', 'rynek', 'cesarska']);
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
    let base = cfg;
    if (cfg.kind === 'projects' && !cfg.estate && ((L && L < 7) || T > KIND_SHARE.projects * 1.4)) base = RES_KAMIENICE;
    const q = T / KIND_SHARE[base.kind];
    const out = { ...base };
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
      if (q >= 1) {
        out.rows = others;
        // (the villas' only inner kind is the yard: a dense villa block, Górczyn's houses on 30% of their lots, falls
        // back to the outbuildings of the kamienica blocks)
        const inner = (base.inner || INNER_RES).filter(([k]) => k !== 'yard');
        out.inner = inner.length ? inner : INNER_RES.filter(([k]) => k !== 'yard');
        // Well above the typical share (the centre's 50-85% blocks): oficyny round every courtyard, rear houses on
        // tighter light courts, yards 3 m wide
        if (q >= 1.3) out.dense = true;
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
        if (q < 0.6) {
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
    // Large, sparse campuses only: on dense central blocks (827, 769, 814, 192 and the like) the campus grid cannot
    // spend their steep share on the fragmented lot rects and would build less than the district profile did
    if (srcBlock && srcBlock.program && srcBlock.park <= 0.5 && srcBlock.area >= 50000 && srcBlock.built <= 0.4) {
      return srcBlock.program === 2 ? UNIVERSITY : HOSPITAL;
    }
    if (OFFICE_SITES.some((t) => Math.hypot(t.x - wx, t.z - wz) < OFFICE_REACH)) return OFFICES;
    if (inBox(CESARSKA_BOX, wx, wz)) return CESARSKA;
    if (blk.rynekSides) return RYNEK;
    switch (district) {
      case 'Stare Miasto':
        if (inBox(OLD_TOWN_BOX, wx, wz)) return chance(0.08) ? LOFT_BASE : RES_STARE;
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
  function outlineDist(x, z) {
    const poly = srcBlock.poly;
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
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
    return Math.sqrt(best);
  }
  const FRONT_RAY = 18;
  // Distance along the ray from (x, z) in direction (nx, nz) to where it first crosses the curb outline
  function outlineRay(x, z, nx, nz) {
    const poly = srcBlock.poly;
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
      const ex = poly[i].x - a.x;
      const ez = poly[i].z - a.z;
      const den = nx * ez - nz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - x) * ez - (a.z - z) * ex) / den;
      const u = ((a.x - x) * nz - (a.z - z) * nx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best;
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
  function populateBlock(minX, maxX, minZ, maxZ, district = null) {
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

    const profile = steerProfile(blockProfile(blockDetail, district), srcBlock);
    if (!(profile.skipP && chance(profile.skipP))) LAYOUTS[profile.kind](blockDetail, profile, minX, maxX);
    openOntoVoidLots(blockDetail);

    // Renovation scaffolding with green netting up one stretch of street facade, on the longest ground-floor street
    // front of ~1 lot rect in 8; a third of them carry a building-wrap advert (siatka reklamowa) instead
    const fronts = blockDetail.streetFronts;
    if (fronts.length && chance(0.12)) {
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
    }
    quadtree.insert(blockDetail);
    allBlocks.push(blockDetail);
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
    'Kościół św. Wojciecha', 'Kościół Bożego Ciała'
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
  // [x0, x1, z0, z1] minus the reserved rects, as up to four slabs per hole (strips across the full depth first). In a
  // frontage frame the reserves are their bounds in the frame
  function minusReserves(r) {
    let reserves = LANDMARK_RESERVE;
    if (xf) {
      reserves = LANDMARK_RESERVE.map((h) => outlineBounds(h.pts.map(([x, z]) => [
        xf.px + (x - xf.px) * xf.cs - (z - xf.pz) * xf.sn,
        xf.pz + (x - xf.px) * xf.sn + (z - xf.pz) * xf.cs
      ])));
    }
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
    srcRects = (b.frames || [[0, 0, 0, b.rects]]).flatMap(([th, px, pz, rects]) => rects.map(([x0, x1, z0, z1]) => (
      { cs: Math.cos(th), sn: Math.sin(th), px, pz, x0, x1, z0, z1 })));
    // The block's pieces first: their area is the lot area the villa layouts steer by (srcLotArea)
    const pieces = [];
    srcLotArea = 0;
    fullLotArea = 0;
    for (const [th, px, pz, rects] of b.frames || [[0, 0, 0, b.rects]]) {
      xf = th ? { th, cs: Math.cos(th), sn: Math.sin(th), px, pz } : null;
      for (const r of rects) {
        for (const part of minusReserves(r)) {
          for (const piece of splitDeep(part)) {
            if (piece[1] - piece[0] >= minLot && piece[3] - piece[2] >= minLot) {
              fullLotArea += (piece[1] - piece[0]) * (piece[3] - piece[2]);
            }
            for (const [x0, x1, z0, z1] of (b.park > 0) ? parkFreeCells(...piece, xf) : [piece]) {
              if (x1 - x0 < minLot || z1 - z0 < minLot) continue;
              pieces.push([xf, x0, x1, z0, z1]);
              srcLotArea += (x1 - x0) * (z1 - z0);
            }
          }
        }
      }
    }
    for (const [f, x0, x1, z0, z1] of pieces) {
      xf = f;
      populateBlock(x0, x1, z0, z1, b.district);
    }
    xf = null;
  }
  minLot = 15;
  srcBlock = null;
  srcRects = [];
  srcLotArea = 0;
  fullLotArea = 0;

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

  // Rear yards, light courts & project lawns: one thin slab per patch just above the sidewalk (buildings standing on
  // it hide the rest). Lawn, paving and tree canopies come from world-space noise; paving and canopy detail finer
  // than a pixel fades to its average, and the lawn is the parks' own turf (createParkLawnMaterial's nodes)
  const yardMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0.0 });
  const yardSurface = Fn(() => {
    const p = positionWorld.xz;
    const px = length(fwidth(p)); // metres per pixel
    const fine = smoothstep(0.9, 0.12, px);
    const crownLOD = smoothstep(8.0, 3.0, px); // crowns a few pixels wide or more are drawn, smaller ones averaged
    const grain = mx_noise_float(p.mul(1.9)).mul(fine).mul(0.5).add(0.5);
    const clump = mx_noise_float(p.mul(0.7).add(5.3)).mul(smoothstep(2.0, 0.4, px)).mul(0.5).add(0.5);

    // Lawns with grey / beige patios & light-court paving
    const patch = mx_noise_float(p.mul(0.21)).mul(smoothstep(12.0, 4.0, px));
    const lawn = parkLawnColorNode();
    const paving = mix(color(0x8c8679), color(0xa59e90), grain);
    const pavingMask = smoothstep(0.15, 0.45, patch);
    const ground = mix(lawn, paving, pavingMask);

    // Street-tree-sized (~12 m) & small (~6 m) crowns, domed: sunlit crowns, softer & darker towards their rims
    const w1 = mx_worley_noise_float(p.mul(0.085));
    const w2 = mx_worley_noise_float(p.mul(0.16).add(17.0));
    const crowns = max(smoothstep(0.55, 0.3, w1), smoothstep(0.45, 0.25, w2).mul(0.85));
    const rim = smoothstep(0.0, 1.0, min(w1.div(0.55), w2.div(0.45)));
    const leaves = mix(color(0x3f5e2a), color(0x5e7f3b), clump.mul(0.6).add(grain.mul(0.4))).mul(mix(float(1.08), float(0.78), rim));
    const leavesMean = mix(color(0x3f5e2a), color(0x5e7f3b), 0.5).mul(0.93);
    const canopy = mix(float(0.5), crowns, crownLOD);
    return vec4(mix(ground, mix(leavesMean, leaves, crownLOD), canopy),
      float(1.0).sub(pavingMask).mul(float(1.0).sub(canopy)));
  })();
  yardMat.colorNode = yardSurface.rgb;
  yardMat.normalNode = parkLawnNormalNode(yardSurface.a);
  yardMat.roughnessNode = mix(float(0.94), float(0.86), yardSurface.a);
  setParkLawnSpecular(yardMat, yardSurface.a);
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
    { bg: '#101622', border: '#95a5a6', text: 'KRAWIEC', color: '#ecf0f1', light: new THREE.Color(0xf0f4f8) }
  ];
  const MAX_SIGNS_PER_THEME = Math.max(128, Math.ceil(MAX_AWNINGS / signThemes.length) + 64);
  const signInsts = signThemes.map((st) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = st.border;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 84);
    ctx.fillStyle = st.color;
    ctx.font = '800 28px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.text, 256, 50, 470);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sMat = new THREE.MeshBasicNodeMaterial({ map: tex });
    const sInst = new THREE.InstancedMesh(unitBox, sMat, MAX_SIGNS_PER_THEME);
    sInst.frustumCulled = false;
    group.add(sInst);
    return sInst;
  });

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
    const signCounts = signInsts.map(() => 0);
    const wrapCounts = wrapInsts.map(() => 0);

    for (let bIdx = 0; bIdx < nearbyBlocks.length; bIdx++) {
      const blk = nearbyBlocks[bIdx];
      // every piece of a block turned into a frontage frame shares its turn (see placeInFrame)
      dummy.rotation.set(0, blk.ry || 0, 0);
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
        dummy.scale.set(a.w, 0.75, a.d);
        dummy.updateMatrix();
        awningInst.setMatrixAt(awningCount, dummy.matrix);
        awningInst.setColorAt(awningCount, awningPalette[a.colorIdx % awningPalette.length]);

        // Theme hashed from the shop's position, not its slot in the pool: the slot shifts on every re-query, so the
        // signs used to change as the player moved
        const themeIdx = ((Math.imul(Math.round(a.x * 4), 73856093) ^ Math.imul(Math.round(a.z * 4), 19349663)) >>> 0) % signInsts.length;
        if (signCounts[themeIdx] < MAX_SIGNS_PER_THEME) {
          dummy.position.set(a.x - a.nx * 0.75, 4.68, a.z - a.nz * 0.75);
          if (a.nx !== 0) dummy.scale.set(0.28, 0.86, a.d * 0.92);
          else dummy.scale.set(a.w * 0.92, 0.86, 0.28);
          dummy.updateMatrix();
          signInsts[themeIdx].setMatrixAt(signCounts[themeIdx]++, dummy.matrix);
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

    signInsts.forEach((sInst, idx) => {
      sInst.count = signCounts[idx];
      flagRange(sInst.instanceMatrix, signCounts[idx]);
    });

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
    populateLeftoverSlabs,
    update,
    updateLights
  };
}

export { Quadtree, buildCityBlocks };
