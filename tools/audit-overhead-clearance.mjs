// tools/audit-overhead-clearance.mjs
// Headless geometric audit of all overhead structures (canopies, railway viaducts, bridges,
// catenary portals, and landmarks) against swept envelopes of mainline trains, trams, buses,
// cars, and the player's taxi on GEO.rail tracks and road-network lanes/connectors.
// Usage: node tools/audit-overhead-clearance.mjs [--json] [--top N]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const { THREE: mockTHREE } = require('../tests/helpers/three-stub.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const topIdx = args.indexOf('--top');
const TOP_N = topIdx >= 0 ? Math.max(1, Number(args[topIdx + 1]) || 10) : 10;

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_t, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

// =================================================================================================
// 1. Load world modules headlessly
// =================================================================================================
const config = await import('../js/city-config.js');
const { GEO } = await import('../js/geodata.js');
const stub = inert();
const globals = {
  document: stub,
  performance,
  console: { info() {}, warn() {}, log() {} },
  Math, Map, Set, WeakMap, Object, Array, Number, JSON,
  Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array
};

const threeWithExtras = {
  ...mockTHREE,
  MeshStandardNodeMaterial: class {
    constructor(p) { Object.assign(this, p || {}); }
    clone() { return new this.constructor(this); }
  },
  MeshBasicNodeMaterial: class {
    constructor(p) { Object.assign(this, p || {}); }
    clone() { return new this.constructor(this); }
  },
  DoubleSide: 2,
  FrontSide: 0,
  BackSide: 1
};

const tslStub = inert();
const bufUtilsStub = {
  mergeGeometries(geos) {
    // Minimal merge for bounding-box computation if needed
    const valid = (geos || []).filter(Boolean);
    if (!valid.length) return new mockTHREE.BufferGeometry();
    return valid[0];
  }
};

const roadMod = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals
});

const gridMod = loadModule(
  source('city-grid') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
  {
    imports: {
      'three/webgpu': stub,
      'three/tsl': stub,
      'three/addons/utils/BufferGeometryUtils.js': stub,
      './tsl-materials.js': stub,
      './city-config.js': config,
      './geodata.js': { GEO }
    },
    globals
  }
);
const grid = gridMod.buildCityGrid(inert());

// Build road network with grid sidewalks & footprints (same as traffic fallback)
const network = roadMod.buildRoadNetwork(grid.sidewalks, grid.footprints);

// Build canopies
const canopiesMod = loadModule(source('canopies'), {
  imports: { 'three/webgpu': threeWithExtras, './geodata.js': { GEO } },
  globals
});
const canopyScene = new mockTHREE.Group();
const canopiesRes = canopiesMod.buildCanopies(canopyScene);

// Build bridges
const bridgesMod = loadModule(source('bridges'), {
  imports: {
    'three/webgpu': threeWithExtras,
    'three/tsl': tslStub,
    'three/addons/utils/BufferGeometryUtils.js': bufUtilsStub,
    './tsl-materials.js': stub,
    './city-config.js': config,
    './geodata.js': { GEO }
  },
  globals
});
const bridgeStructures = bridgesMod.bridgeStructures();
const bridgeScene = new mockTHREE.Group();
const bridgesRes = bridgesMod.buildBridges(bridgeScene, { sidewalks: grid.sidewalks });

// Build tram & rail infrastructure layouts
const tramInfraMod = loadModule(source('tram-infra'), {
  imports: {
    'three/webgpu': stub,
    'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': bufUtilsStub,
    './tsl-materials.js': stub,
    './city-config.js': config,
    './geodata.js': { GEO }
  },
  globals
});
const tramLayout = tramInfraMod.layoutTramInfrastructure(network, grid);
const railLayout = tramInfraMod.layoutRailInfrastructure(network);

// Build landmarks (using real three-stub so fitToSite computes world transforms/colliders)
const landmarkKitMod = loadModule(source('landmark-kit'), {
  imports: {
    'three/webgpu': threeWithExtras,
    'three/addons/utils/BufferGeometryUtils.js': bufUtilsStub,
    './tsl-materials.js': stub,
    './city-config.js': config
  },
  globals
});

function loadLandmarkSub(name) {
  return loadModule(source(name), {
    imports: {
      'three/webgpu': threeWithExtras,
      'three/tsl': tslStub,
      'three/addons/utils/BufferGeometryUtils.js': bufUtilsStub,
      './landmark-kit.js': landmarkKitMod,
      './city-config.js': config,
      './city-clock.js': stub,
      './tsl-materials.js': stub,
      './baltyk-disco.js': { createBaltykDisco: () => ({ group: new threeWithExtras.Group(), update() {} }) },
      './geodata.js': { GEO }
    },
    globals
  });
}

const landmarksMod = loadModule(source('landmarks'), {
  imports: {
    'three/webgpu': threeWithExtras,
    './city-grid.js': { batchStaticGroupMeshes: () => {} },
    './landmark-kit.js': landmarkKitMod,
    './landmarks-rynek.js': loadLandmarkSub('landmarks-rynek'),
    './landmarks-heritage.js': loadLandmarkSub('landmarks-heritage'),
    './landmarks-centrum.js': loadLandmarkSub('landmarks-centrum'),
    './landmarks-dworzec.js': loadLandmarkSub('landmarks-dworzec'),
    './landmarks-towers.js': loadLandmarkSub('landmarks-towers'),
    './landmarks-historic.js': loadLandmarkSub('landmarks-historic'),
    './landmarks-stadium.js': loadLandmarkSub('landmarks-stadium'),
    './landmarks-piotrowo.js': loadLandmarkSub('landmarks-piotrowo')
  },
  globals
});
const landmarkScene = new mockTHREE.Group();
const landmarksRes = landmarksMod.buildLandmarks(landmarkScene);

// =================================================================================================
// 2. Vehicle Swept Envelopes (exact values from actor-models.js, trams.js, tram-infra.js)
// =================================================================================================
const VEHICLES = {
  car_saloon_taxi: { label: 'Car (saloon/player taxi)', halfW: 0.874, height: 1.47 + 0.16, notes: '1.47 m roof + 0.16 m TAXI sign (1.63 m)' },
  car_crossover:   { label: 'Car (crossover)',          halfW: 0.895, height: 1.70,        notes: '1.665 m roofY + 0.035 m crown' },
  car_van_prm:     { label: 'Van / PRM ambulance',      halfW: 1.000, height: 2.65,        notes: '2.50 m roofY + 0.035 m crown + ~0.115 m lightbar' },
  fire_truck:      { label: 'PSP fire truck',           halfW: 1.250, height: 3.40,        notes: '3.28 m roof + 0.12 m lightbar' },
  bus_12_18:       { label: 'Bus (12 m & 18 m artic.)', halfW: 1.275, height: 3.255,       notes: '2.96 m edge + 0.045 m crown + 0.25 m AC pod' },
  tram_body:       { label: 'Tram (body)',              halfW: 1.200, height: 3.18,        notes: 'TRAM_ROOF = 3.18 m (2.40 m wide)' },
  tram_panto:      { label: 'Tram (pantograph)',        halfW: 0.930, height: 5.795,       notes: 'TRAM_PANTOGRAPH_HEAD 5.77 + 0.025 m collector' },
  train_body:      { label: 'Mainline train (body)',    halfW: 1.500, height: 4.30,        notes: '3.0 m wide, 4.3 m UIC body gauge above rail/deck' },
  train_catenary:  { label: 'Mainline catenary wire',   halfW: 0.200, height: 5.60,        notes: 'RAIL_WIRE_Y = 5.60 m (messenger 7.00 m)' }
};

// =================================================================================================
// 3. Build Track & Road Lane Segments for Spatial Queries
// =================================================================================================
function extractSegments(pts) {
  const segs = [];
  if (!pts || pts.length < 2) return segs;
  if (typeof pts[0] === 'number') {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      segs.push({ ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3] });
    }
  } else if (Array.isArray(pts[0])) {
    for (let i = 0; i + 1 < pts.length; i++) {
      segs.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] });
    }
  } else {
    for (let i = 0; i + 1 < pts.length; i++) {
      segs.push({ ax: pts[i].x, az: pts[i].z, bx: pts[i + 1].x, bz: pts[i + 1].z });
    }
  }
  return segs;
}

const tramSegs = [];
for (const p of tramLayout.pieces || []) {
  tramSegs.push({ ax: p.ax, az: p.az, bx: p.bx, bz: p.bz, railIndex: p.railIndex, yA: p.ground || 0, yB: p.ground || 0, kind: 'tram', name: '' });
}

const railSegs = [];
for (const p of railLayout.pieces || []) {
  railSegs.push({ ax: p.ax, az: p.az, bx: p.bx, bz: p.bz, railIndex: p.railIndex, yA: p.yA || 0, yB: p.yB || 0, kind: 'rail', name: '' });
}
for (const v of railLayout.viaducts || []) {
  for (const p of v.pieces || []) {
    railSegs.push({ ax: p.ax, az: p.az, bx: p.bx, bz: p.bz, railIndex: v.railIndex, yA: v.deckY, yB: v.deckY, kind: 'rail-viaduct', name: '' });
  }
}
for (const p of railLayout.level || []) {
  railSegs.push({ ax: p.ax, az: p.az, bx: p.bx, bz: p.bz, railIndex: p.railIndex, yA: p.ground || 0, yB: p.ground || 0, kind: 'rail-level', name: '' });
}

// Road lanes: each edge e in network.edges has lanes[] lateral offsets along right normal (e.rx, e.rz)
// plus laneShiftAt(e, s) if present, and junction connectors.
const laneSegs = [];
for (const e of network.edges) {
  if (!e.lanes || !e.lanes.length) continue;
  for (let li = 0; li < e.lanes.length; li++) {
    const off = e.lanes[li];
    const ox = e.rx * off;
    const oz = e.rz * off;
    laneSegs.push({
      ax: e.sx + ox, az: e.sz + oz,
      bx: e.sx + e.dx * e.len + ox, bz: e.sz + e.dz * e.len + oz,
      edgeId: e.id, laneIndex: li, street: e.street || '', major: !!e.major
    });
  }
}
// Also include junction connector curves (sampled into ~2 m chords)
for (const e of network.edges) {
  if (!e.moves) continue;
  for (const m of e.moves) {
    const f = m.to;
    if (!f || !m.out) continue;
    for (let i = 0; i < e.lanes.length; i++) {
      const j = m.out[i];
      if (j == null || j < 0) continue;
      const c = network.connector(e, i, f, j);
      if (!c) continue;
      const n = Math.max(2, Math.ceil(c.len / 2));
      let prev = network.curvePoint(c, 0, { x: 0, z: 0 });
      for (let k = 1; k <= n; k++) {
        const cur = network.curvePoint(c, (c.len * k) / n, { x: 0, z: 0 });
        laneSegs.push({
          ax: prev.x, az: prev.z, bx: cur.x, bz: cur.z,
          edgeId: e.id, laneIndex: i, street: `${e.street || ''}->${f.street || ''}`, connector: true, major: !!(e.major || f.major)
        });
        prev = cur;
      }
    }
  }
}

// 2D spatial grid for fast segment queries
function makeSegGrid(segs, cell = 32) {
  const map = new Map();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const x0 = Math.floor(Math.min(s.ax, s.bx) / cell);
    const x1 = Math.floor(Math.max(s.ax, s.bx) / cell);
    const z0 = Math.floor(Math.min(s.az, s.bz) / cell);
    const z1 = Math.floor(Math.max(s.az, s.bz) / cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = (ix + 2048) * 4096 + (iz + 2048);
        let arr = map.get(k);
        if (!arr) map.set(k, (arr = []));
        arr.push(i);
      }
    }
  }
  return {
    queryBox(minX, maxX, minZ, maxZ, pad = 0) {
      const x0 = Math.floor((minX - pad) / cell);
      const x1 = Math.floor((maxX + pad) / cell);
      const z0 = Math.floor((minZ - pad) / cell);
      const z1 = Math.floor((maxZ + pad) / cell);
      const seen = new Set();
      const out = [];
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const arr = map.get((ix + 2048) * 4096 + (iz + 2048));
          if (!arr) continue;
          for (const idx of arr) {
            if (!seen.has(idx)) { seen.add(idx); out.push(segs[idx]); }
          }
        }
      }
      return out;
    }
  };
}

const tramGrid = makeSegGrid(tramSegs);
const railGrid = makeSegGrid(railSegs);
const laneGrid = makeSegGrid(laneSegs);

// =================================================================================================
// 4. Geometry helpers (OBB distance & segment-vs-OBB intersection)
// =================================================================================================
function pointToSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  if (L2 < 1e-12) return { dist: Math.hypot(px - ax, pz - az), x: ax, z: az };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  const x = ax + t * dx, z = az + t * dz;
  return { dist: Math.hypot(px - x, pz - z), x, z };
}

function obbWorldBounds(obb) {
  const ex = Math.abs(obb.cs) * obb.hx + Math.abs(obb.sn) * obb.hz;
  const ez = Math.abs(obb.sn) * obb.hx + Math.abs(obb.cs) * obb.hz;
  return { minX: obb.cx - ex, maxX: obb.cx + ex, minZ: obb.cz - ez, maxZ: obb.cz + ez };
}

// Minimum distance between segment (a->b) and OBB { cx, cz, hx, hz, cs, sn }
// In OBB local coords: lx = dx*cs - dz*sn, lz = dx*sn + dz*cs (matching buildingContact / bridges.js)
function segToObbDist(ax, az, bx, bz, obb) {
  const toLocal = (x, z) => {
    const dx = x - obb.cx, dz = z - obb.cz;
    return [dx * obb.cs - dz * obb.sn, dx * obb.sn + dz * obb.cs];
  };
  const [lx0, lz0] = toLocal(ax, az);
  const [lx1, lz1] = toLocal(bx, bz);
  const dlx = lx1 - lx0, dlz = lz1 - lz0;
  const len = Math.hypot(dlx, dlz);
  const steps = Math.max(2, Math.ceil(len / 0.25));
  let best = Infinity;
  let bestLocal = [0, 0];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lx = lx0 + dlx * t;
    const lz = lz0 + dlz * t;
    const ox = Math.max(0, Math.abs(lx) - obb.hx);
    const oz = Math.max(0, Math.abs(lz) - obb.hz);
    const d = Math.hypot(ox, oz);
    if (d < best) { best = d; bestLocal = [lx, lz]; }
    if (d === 0) break;
  }
  const wx = obb.cx + bestLocal[0] * obb.cs + bestLocal[1] * obb.sn;
  const wz = obb.cz - bestLocal[0] * obb.sn + bestLocal[1] * obb.cs;
  return { dist: best, x: wx, z: wz };
}

// =================================================================================================
// 5. Collect all Overhead Structures & Supports
// =================================================================================================
const overheadParts = []; // { category, name, source, obb, minY, maxY, x, z }
const supportParts = [];  // { category, name, source, obb, minY, maxY, x, z }

// 5A. Canopies (js/canopies.js + GEO.canopies)
for (let i = 0; i < (GEO.canopies || []).length; i++) {
  const c = GEO.canopies[i];
  const cs = Math.cos(c.ang), sn = -Math.sin(c.ang);
  const sinA = Math.sin(c.ang);
  const label = `${c.kind}#${i} (${c.cx.toFixed(1)}, ${c.cz.toFixed(1)})`;
  // Roof deck: underside = c.clearance
  overheadParts.push({
    category: 'canopy-roof',
    kind: c.kind,
    name: label,
    source: 'js/canopies.js:88-93',
    obb: { cx: c.cx, cz: c.cz, hx: c.w * 0.5, hz: c.d * 0.5, cs, sn },
    minY: c.clearance,
    maxY: c.h,
    x: c.cx, z: c.cz
  });
  // Two long-edge beams: underside = c.clearance - 0.28 (js/canopies.js:112-122)
  const off = Math.max(0.35, c.d * 0.5 - 0.7);
  for (const v of [-off, off]) {
    const bx = c.cx - v * sinA;
    const bz = c.cz + v * cs;
    overheadParts.push({
      category: 'canopy-beam',
      kind: c.kind,
      name: `${label} beam`,
      source: 'js/canopies.js:112-122',
      obb: { cx: bx, cz: bz, hx: Math.max(0.1, (c.w - 0.8) * 0.5), hz: 0.11, cs, sn },
      minY: c.clearance - 0.28,
      maxY: c.clearance,
      x: bx, z: bz
    });
  }
  // Columns: 0.4 x 0.4 m axis-aligned (js/canopies.js:97-109)
  const cols = c.columns || [];
  for (let k = 0; k + 1 < cols.length; k += 2) {
    const x = cols[k], z = cols[k + 1];
    supportParts.push({
      category: 'canopy-column',
      kind: c.kind,
      name: `${label} col`,
      source: 'js/canopies.js:97-109',
      obb: { cx: x, cz: z, hx: 0.2, hz: 0.2, cs: 1, sn: 0 },
      minY: 0,
      maxY: c.clearance,
      x, z
    });
  }
}

// 5B. Railway Viaducts & Catenary Portals (js/tram-infra.js)
for (let vi = 0; vi < (railLayout.viaducts || []).length; vi++) {
  const v = railLayout.viaducts[vi];
  const label = `viaduct#${vi} rail#${v.railIndex} (${v.mx.toFixed(1)}, ${v.mz.toFixed(1)})`;
  for (const p of v.pieces) {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    if (len < 0.01) continue;
    const dx = (p.bx - p.ax) / len;
    const dz = (p.bz - p.az) / len;
    const mx = (p.ax + p.bx) / 2;
    const mz = (p.az + p.bz) / 2;
    // Deck slab + side plate girders both have underside = v.yClearance (js/tram-infra.js:1871-1880)
    // Total width across deck + girders: 5.0 + 2*0.21 = 5.42 m (girders at ±2.6, width 0.22 -> ±2.71)
    overheadParts.push({
      category: 'rail-viaduct',
      kind: v.hasTram ? 'tram-viaduct' : 'road-viaduct',
      name: label,
      source: 'js/tram-infra.js:981,1870-1881',
      obb: { cx: mx, cz: mz, hx: (len + 0.05) * 0.5, hz: 2.71, cs: dx, sn: -dz },
      minY: v.yClearance,
      maxY: v.yClearance + 1.2,
      x: mx, z: mz
    });
  }
}
for (const e of railLayout.ends || []) {
  if (!e.viaduct) continue;
  const cx = e.x + e.dx * 0.25;
  const cz = e.z + e.dz * 0.25;
  const w = 2 * (3.6 + 0.15); // 7.5 m
  supportParts.push({
    category: 'viaduct-abutment',
    kind: 'abutment',
    name: `abutment (${cx.toFixed(1)}, ${cz.toFixed(1)})`,
    source: 'js/tram-infra.js:1843-1856',
    obb: { cx, cz, hx: 0.25, hz: w * 0.5, cs: e.dx, sn: -e.dz },
    minY: 0,
    maxY: e.yClearance,
    x: cx, z: cz
  });
}
for (const p of railLayout.portals || []) {
  const dx = p.bx - p.ax, dz = p.bz - p.az;
  const len = Math.hypot(dx, dz) || 1;
  const mx = (p.ax + p.bx) * 0.5, mz = (p.az + p.bz) * 0.5;
  const yElev = railLayout.elevationAt ? Math.max(railLayout.elevationAt(p.ax, p.az), railLayout.elevationAt(p.bx, p.bz)) : 0;
  overheadParts.push({
    category: 'rail-portal',
    kind: 'portal',
    name: `portal (${mx.toFixed(1)}, ${mz.toFixed(1)})`,
    source: 'js/tram-infra.js:2008-2011',
    obb: { cx: mx, cz: mz, hx: len * 0.5, hz: 0.175, cs: dx / len, sn: -dz / len },
    minY: yElev + 8.65,
    maxY: yElev + 9.15,
    x: mx, z: mz
  });
}
for (const q of railLayout.masts || []) {
  const yElev = railLayout.elevationAt ? railLayout.elevationAt(q.x, q.z) : 0;
  const h = q.h + yElev;
  const w = q.h > 9 ? 0.45 : 0.3;
  supportParts.push({
    category: 'rail-mast',
    kind: 'mast',
    name: `mast (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`,
    source: 'js/tram-infra.js:1990-1998',
    obb: { cx: q.x, cz: q.z, hx: w * 0.5, hz: w * 0.5, cs: 1, sn: 0 },
    minY: 0,
    maxY: h,
    x: q.x, z: q.z
  });
}

// 5C. Bridges (js/bridges.js + BRIDGES)
for (const spec of bridgeStructures) {
  const kind = spec.water ? spec.kind : 'overpass';
  const dx = spec.b.x - spec.a.x, dz = spec.b.z - spec.a.z;
  const L = spec.L || Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const Wd = spec.footbridge ? spec.width : spec.width + 2 * 1.9;
  const cs = ux, sn = -uz;

  if (kind === 'arch') {
    const { w0, w1, runs } = spec.water;
    const main = runs.reduce((m, r) => (r.t1 - r.t0 > m.t1 - m.t0 ? r : m), runs[0]);
    const a0 = Math.max(w0 - 1.5, main.t0 - 2);
    const a1 = Math.min(w1 + 1.5, main.t1 + 2);
    const span = a1 - a0;
    const rise = Math.max(8, Math.min(18, span * 0.17));
    const n = Math.max(12, Math.ceil(span / 4));
    const sA = Wd * 0.5 + 0.7;
    for (let i = 1; i < n; i++) {
      const t = a0 + (span * i) / n;
      const ribY = 0.5 + rise * Math.sin((Math.PI * (t - a0)) / span);
      if (ribY < 7.2 || i % 3) continue;
      const cx = spec.a.x + ux * t;
      const cz = spec.a.z + uz * t;
      overheadParts.push({
        category: 'bridge-bracing',
        kind: 'arch-bracing',
        name: `${spec.name} bracing t=${t.toFixed(1)}`,
        source: 'js/bridges.js:730-734',
        obb: { cx, cz, hx: 0.35, hz: sA, cs, sn },
        minY: ribY - 0.55,
        maxY: ribY + 0.15,
        x: cx, z: cz
      });
    }
  } else if (kind === 'covered') {
    const { w0, w1 } = spec.water;
    const t0 = Math.max(0, w0 - 2);
    const t1 = Math.min(L, w1 + 2);
    const cx = spec.a.x + ux * (t0 + t1) * 0.5;
    const cz = spec.a.z + uz * (t0 + t1) * 0.5;
    overheadParts.push({
      category: 'bridge-covered-roof',
      kind: 'covered-footbridge',
      name: `${spec.name} roof`,
      source: 'js/bridges.js:761-766',
      obb: { cx, cz, hx: (t1 - t0) * 0.5, hz: (spec.width + 0.2) * 0.5, cs, sn },
      minY: 3.39, // SIDEWALK_TOP (0.2) + galleryH (3.2) - 0.01
      maxY: 3.61,
      x: cx, z: cz
    });
  }
  // Bridge lamp arms on all girder/arch/overpass bridges (underside = y0 + 7.925 m)
  // Note: deck itself is at y = -0.01 (street level), so nothing passes beneath it.
}

// 5D. Landmarks (js/landmarks*.js colliders & world boxes)
// Check every landmark collider against rails and lanes (to catch any landmark over/in a track or lane)
for (const c of landmarksRes.colliders || []) {
  if (!c.obb && (c.maxX - c.minX > 500 || c.maxZ - c.minZ > 500)) continue;
  const obb = c.obb || {
    cx: (c.minX + c.maxX) * 0.5,
    cz: (c.minZ + c.maxZ) * 0.5,
    hx: (c.maxX - c.minX) * 0.5,
    hz: (c.maxZ - c.minZ) * 0.5,
    cs: 1, sn: 0
  };
  const minY = c.minY ?? 0;
  const maxY = c.maxY ?? 10;
  const target = minY > 0.5 ? overheadParts : supportParts;
  target.push({
    category: 'landmark-collider',
    kind: 'landmark',
    name: `landmark (${obb.cx.toFixed(1)}, ${obb.cz.toFixed(1)})`,
    source: 'js/landmarks*.js',
    obb,
    minY,
    maxY,
    x: obb.cx, z: obb.cz
  });
}

// =================================================================================================
// 6. Evaluate Clearances
// =================================================================================================
const overheadResults = [];
const lateralIntrusions = [];

for (const part of overheadParts) {
  const b = obbWorldBounds(part.obb);
  const pad = 2.0;
  const nearRails = railGrid.queryBox(b.minX, b.maxX, b.minZ, b.maxZ, pad);
  const nearTrams = tramGrid.queryBox(b.minX, b.maxX, b.minZ, b.maxZ, pad);
  const nearLanes = laneGrid.queryBox(b.minX, b.maxX, b.minZ, b.maxZ, pad);

  const clearances = {};
  let worstClearance = Infinity;
  let worstKind = null;
  let worstPt = null;

  const checkEnvelope = (segs, key, spec) => {
    for (const s of segs) {
      const hit = segToObbDist(s.ax, s.az, s.bx, s.bz, part.obb);
      if (hit.dist < spec.halfW) {
        let baseY = 0;
        if (key === 'train_body' || key === 'train_catenary') {
          baseY = (s.yA + s.yB) * 0.5;
          if (part.category === 'rail-viaduct' && Math.abs(baseY - (part.minY + 0.35)) < 1.0) continue;
          if (key === 'train_body') baseY += 0.46; // RAIL_BED_TOP (0.30) + RAIL_HEAD_H (0.16)
        } else if (key === 'tram_body' || key === 'tram_panto') {
          baseY = (s.yA + s.yB) * 0.5;
        }
        const topY = baseY + spec.height;
        const clr = part.minY - topY;
        if (clearances[key] === undefined || clr < clearances[key]) {
          clearances[key] = clr;
        }
        if (clr < worstClearance) {
          worstClearance = clr;
          worstKind = key;
          worstPt = { x: hit.x, z: hit.z };
        }
      }
    }
  };

  checkEnvelope(nearRails, 'train_body', VEHICLES.train_body);
  checkEnvelope(nearRails, 'train_catenary', VEHICLES.train_catenary);
  checkEnvelope(nearTrams, 'tram_body', VEHICLES.tram_body);
  checkEnvelope(nearTrams, 'tram_panto', VEHICLES.tram_panto);
  checkEnvelope(nearLanes, 'fire_truck', VEHICLES.fire_truck);
  checkEnvelope(nearLanes, 'bus_12_18', VEHICLES.bus_12_18);
  checkEnvelope(nearLanes, 'car_van_prm', VEHICLES.car_van_prm);
  checkEnvelope(nearLanes, 'car_crossover', VEHICLES.car_crossover);
  checkEnvelope(nearLanes, 'car_saloon_taxi', VEHICLES.car_saloon_taxi);

  if (worstKind !== null) {
    overheadResults.push({
      category: part.category,
      kind: part.kind,
      name: part.name,
      source: part.source,
      undersideY: part.minY,
      worstKind,
      worstClearance,
      at: worstPt,
      clearances
    });
  }
}

// Check supports against tracks and lanes
for (const sup of supportParts) {
  const b = obbWorldBounds(sup.obb);
  const pad = 2.0;
  const checkSup = (segs, envKey, spec) => {
    for (const s of segs) {
      const hit = segToObbDist(s.ax, s.az, s.bx, s.bz, sup.obb);
      if (hit.dist < spec.halfW) {
        // Ignore a rail mast/abutment against its own rail track if it's a viaduct abutment?
        // Wait: a viaduct abutment is across the rail track! It stands UNDER the viaduct deck (from 0 to yClearance),
        // at the end of the embankment, so the track on top is at yClearance+0.35, NOT at y=0!
        if (sup.category === 'viaduct-abutment' && (envKey === 'train_body')) {
          const elev = railLayout.elevationAt ? railLayout.elevationAt(hit.x, hit.z) : 0;
          if (elev >= sup.maxY - 0.1) continue;
        }
        lateralIntrusions.push({
          category: sup.category,
          name: sup.name,
          source: sup.source,
          envKey,
          distToCenterline: hit.dist,
          intrusion: spec.halfW - hit.dist,
          at: { x: hit.x, z: hit.z },
          detail: s.street || s.name || ''
        });
      }
    }
  };
  checkSup(railGrid.queryBox(b.minX, b.maxX, b.minZ, b.maxZ, pad), 'train_body', VEHICLES.train_body);
  checkSup(tramGrid.queryBox(b.minX, b.maxX, b.minZ, b.maxZ, pad), 'tram_body', VEHICLES.tram_body);
  checkSup(laneGrid.queryBox(b.minX, b.maxX, b.minZ, b.maxZ, pad), 'bus_12_18', VEHICLES.bus_12_18);
}

overheadResults.sort((a, b) => a.worstClearance - b.worstClearance);
lateralIntrusions.sort((a, b) => b.intrusion - a.intrusion);

if (JSON_OUT) {
  console.log(JSON.stringify({
    counts: {
      overheadParts: overheadParts.length,
      overheadOverTraffic: overheadResults.length,
      clashes: overheadResults.filter((r) => r.worstClearance < 0).length,
      supportParts: supportParts.length,
      lateralIntrusions: lateralIntrusions.length
    },
    worstOverhead: overheadResults.slice(0, TOP_N),
    worstIntrusions: lateralIntrusions.slice(0, TOP_N)
  }, null, 2));
} else {
  const clashes = overheadResults.filter((r) => r.worstClearance < 0);
  console.log(`Overhead structures over tracks/lanes: ${overheadResults.length} (clashes < 0 m: ${clashes.length})`);
  console.log(`Support lateral intrusions (< halfW): ${lateralIntrusions.length}`);
  console.log(`\nWorst ${TOP_N} vertical clearances:`);
  for (const r of overheadResults.slice(0, TOP_N)) {
    console.log(`  [${r.category}] ${r.name} | underside=${r.undersideY.toFixed(3)}m | worst=${r.worstKind} clr=${r.worstClearance.toFixed(3)}m at (${r.at.x.toFixed(1)}, ${r.at.z.toFixed(1)})`);
  }
  console.log(`\nWorst ${TOP_N} lateral support intrusions:`);
  for (const r of lateralIntrusions.slice(0, TOP_N)) {
    console.log(`  [${r.category}] ${r.name} | vs=${r.envKey} | intrusion=${r.intrusion.toFixed(3)}m (dist=${r.distToCenterline.toFixed(3)}m) at (${r.at.x.toFixed(1)}, ${r.at.z.toFixed(1)}) ${r.detail}`);
  }
}
