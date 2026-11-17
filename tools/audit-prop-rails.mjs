// Headless exact-geometry audit: every static prop/object as actually built in the scene,
// measured from its real footprint (oriented box or circle) to every GEO.rail centreline segment
// (both kind:'tram' and kind:'rail').
//
//   node tools/audit-prop-rails.mjs [--json] [--top N] [--near x,z,r] [--category NAME]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const { THREE: mockTHREE } = require('../tests/helpers/three-stub.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

// Patch InstancedMesh.setMatrixAt so final instance transforms are retained in instanceMatrix.array.
const { InstancedMesh, BufferGeometry, BoxGeometry: OrigBoxGeometry, Quaternion, Group, Matrix4 } = mockTHREE;
if (!Quaternion.prototype.identity) Quaternion.prototype.identity = function () { return this.set(0, 0, 0, 1); };
if (!Quaternion.prototype.copy) Quaternion.prototype.copy = function (q) { return this.set(q.x, q.y, q.z, q.w); };
if (!BufferGeometry.prototype.setIndex) BufferGeometry.prototype.setIndex = function () { return this; };
if (!BufferGeometry.prototype.clearGroups) BufferGeometry.prototype.clearGroups = function () {};
if (!BufferGeometry.prototype.addGroup) BufferGeometry.prototype.addGroup = function () {};
if (!BufferGeometry.prototype.toNonIndexed) BufferGeometry.prototype.toNonIndexed = function () { return this; };
if (!BufferGeometry.prototype.rotateY) BufferGeometry.prototype.rotateY = function () { return this; };
if (!BufferGeometry.prototype.rotateZ) BufferGeometry.prototype.rotateZ = function () { return this; };
if (!BufferGeometry.prototype.scale) BufferGeometry.prototype.scale = function () { return this; };
if (!BufferGeometry.prototype.getAttribute) BufferGeometry.prototype.getAttribute = function (n) { return this.attributes[n] || { count: 0, array: [] }; };
if (!BufferGeometry.prototype.computeBoundingSphere) BufferGeometry.prototype.computeBoundingSphere = function () {};
class BoxGeometry extends OrigBoxGeometry {
  constructor(w = 1, h = 1, d = 1) {
    super(w, h, d);
    if (!this.index) this.index = { array: [0, 1, 2] };
    if (!this.attributes.position) this.attributes.position = { array: new Float32Array(9), count: 3 };
    if (!this.attributes.normal) this.attributes.normal = { array: new Float32Array(9), count: 3 };
    if (!this.attributes.uv) this.attributes.uv = { array: new Float32Array(6), count: 3 };
  }
}
const threeExt = new Proxy(mockTHREE, {
  get(t, k) {
    if (k === 'BoxGeometry') return BoxGeometry;
    if (k in t) return t[k];
    return class extends BufferGeometry {};
  }
});
const origSetMatrixAt = InstancedMesh.prototype.setMatrixAt;
InstancedMesh.prototype.setMatrixAt = function (index, matrix) {
  if (this.instanceMatrix && this.instanceMatrix.array && matrix && matrix.elements) {
    this.instanceMatrix.array.set(matrix.elements, index * 16);
  }
  return origSetMatrixAt.call(this, index, matrix);
};

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

// ============================================================================
// Exact 2D XZ geometry helpers
// ============================================================================

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distPointToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function orient2d(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = orient2d(cx, cz, dx, dz, ax, az);
  const d2 = orient2d(cx, cz, dx, dz, bx, bz);
  const d3 = orient2d(ax, az, bx, bz, cx, cz);
  const d4 = orient2d(ax, az, bx, bz, dx, dz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const onSeg = (px, pz, qx, qz, rx, rz) =>
    rx >= Math.min(px, qx) - 1e-9 && rx <= Math.max(px, qx) + 1e-9 &&
    rz >= Math.min(pz, qz) - 1e-9 && rz <= Math.max(pz, qz) + 1e-9;
  if (Math.abs(d1) < 1e-9 && onSeg(cx, cz, dx, dz, ax, az)) return true;
  if (Math.abs(d2) < 1e-9 && onSeg(cx, cz, dx, dz, bx, bz)) return true;
  if (Math.abs(d3) < 1e-9 && onSeg(ax, az, bx, bz, cx, cz)) return true;
  if (Math.abs(d4) < 1e-9 && onSeg(ax, az, bx, bz, dx, dz)) return true;
  return false;
}

function distPolyToSeg(poly, ax, az, bx, bz) {
  if (pointInPoly(poly, ax, az) || pointInPoly(poly, bx, bz)) return 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    if (segmentsIntersect(p.x, p.z, q.x, q.z, ax, az, bx, bz)) return 0;
  }
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    best = Math.min(
      best,
      distPointToSeg(p.x, p.z, ax, az, bx, bz),
      distPointToSeg(ax, az, p.x, p.z, q.x, q.z),
      distPointToSeg(bx, bz, p.x, p.z, q.x, q.z)
    );
  }
  return best;
}

function obbCorners(cx, cz, hx, hz, cs, sn) {
  const pt = (u, v) => ({ x: cx + u * cs + v * sn, z: cz - u * sn + v * cs });
  return [pt(-hx, -hz), pt(hx, -hz), pt(hx, hz), pt(-hx, hz)];
}

function colliderPoly(c) {
  if (c.obb) {
    const { cx, cz, hx, hz, cs, sn } = c.obb;
    return obbCorners(cx, cz, hx, hz, cs, sn);
  }
  return [
    { x: c.minX, z: c.minZ }, { x: c.maxX, z: c.minZ },
    { x: c.maxX, z: c.maxZ }, { x: c.minX, z: c.maxZ }
  ];
}

function buildSegIndex(segments, cellSize, pad) {
  const grid = new Map();
  for (const seg of segments) {
    const x0 = Math.floor((Math.min(seg.ax, seg.bx) - pad) / cellSize);
    const x1 = Math.floor((Math.max(seg.ax, seg.bx) + pad) / cellSize);
    const z0 = Math.floor((Math.min(seg.az, seg.bz) - pad) / cellSize);
    const z1 = Math.floor((Math.max(seg.az, seg.bz) + pad) / cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = ix * 100003 + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(seg);
      }
    }
  }
  return (x0, x1, z0, z1) => {
    const out = new Set();
    const ix0 = Math.floor((x0 - pad) / cellSize);
    const ix1 = Math.floor((x1 + pad) / cellSize);
    const iz0 = Math.floor((z0 - pad) / cellSize);
    const iz1 = Math.floor((z1 + pad) / cellSize);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = grid.get(ix * 100003 + iz);
        if (list) for (const s of list) out.add(s);
      }
    }
    return out;
  };
}

// ============================================================================
// Scene build + prop extraction
// ============================================================================

export async function runAudit() {
  const plateCounter = { count: 0 };
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const stub = inert();
  const globals = {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => inert() }) },
    console: { info() {}, warn() {}, log() {} },
    performance,
    Math, Object, Array, Set, Map, WeakMap, Number, Infinity, NaN, JSON, Symbol,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error
  };
  const materialsStub = new Proxy({
    createPreWarBuildingMaterial: () => ({}),
    createCurtainWallMaterial: () => ({}),
    createFacadeBoxes: (_geos, _mat, count = 1) => new InstancedMesh(new BufferGeometry(), {}, count),
    cityUniforms: stub
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => inert();
    }
  });
  const threeRendering = {
    'three/webgpu': threeExt,
    'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': {
      mergeGeometries: (geos) => (geos && geos[0]) || new mockTHREE.BufferGeometry()
    },
    './tsl-materials.js': materialsStub
  };
  const inertRendering = {
    'three/webgpu': stub,
    'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub,
    './tsl-materials.js': stub
  };

  // 1. Landmarks
  const kit = loadModule(source('landmark-kit'), {
    imports: { ...threeRendering, './city-config.js': config },
    globals: { ...globals, _plateCounter: plateCounter }
  });
  const clock = loadModule(source('city-clock'), { imports: {}, globals });
  const landmarksMod = loadModule(source('landmarks'), {
    imports: {
      ...threeRendering, './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { batchStaticGroupMeshes: () => {} },
      './landmark-kit.js': kit,
      './landmarks-rynek.js': loadModule(source('landmarks-rynek'), { imports: { ...threeRendering, './city-config.js': config, './landmark-kit.js': kit, './city-clock.js': clock }, globals }),
      './landmarks-heritage.js': loadModule(source('landmarks-heritage'), { imports: { ...threeRendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-centrum.js': loadModule(source('landmarks-centrum'), { imports: { ...threeRendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-dworzec.js': loadModule(source('landmarks-dworzec'), { imports: { ...threeRendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-historic.js': loadModule(source('landmarks-historic'), { imports: { ...threeRendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-towers.js': loadModule(source('landmarks-towers'), { imports: { ...threeRendering, './city-config.js': config, './landmark-kit.js': kit, './baltyk-disco.js': { createBaltykDisco: () => ({ group: new threeRendering['three/webgpu'].Group(), update() {} }) } }, globals }),
      './landmarks-piotrowo.js': loadModule(source('landmarks-piotrowo'), { imports: { ...threeRendering, './city-config.js': config, './geodata.js': { GEO }, './landmark-kit.js': kit }, globals }),
      './landmarks-stadium.js': loadModule(source('landmarks-stadium'), { imports: { ...threeRendering, './landmark-kit.js': kit }, globals })
    },
    globals: { ...globals, _plateCounter: plateCounter }
  });
  const landmarks = landmarksMod.buildLandmarks(new Group());

  // 2. City grid (instrumented slightly to tag tree source & propCollider categories)
  let gridSrc = source('city-grid');
  gridSrc = gridSrc.replace(
    'treeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species, planter: true });',
    'treeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species, planter: true, _src: "plaza-planter" });'
  );
  gridSrc = gridSrc.replace(
    'treeSites.push({ x: tx, y: BED_Y, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });',
    'treeSites.push({ x: tx, y: BED_Y, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2), _src: "park" });'
  );
  gridSrc = gridSrc.replace(
    'treeSites.push({ x: tx, y: SW_TOP, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });',
    'treeSites.push({ x: tx, y: SW_TOP, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2), _src: "part-park" });'
  );
  gridSrc = gridSrc.replace(
    'addPropCollider(x, z, w * 0.5, d * 0.5, baseY + 0.85);',
    'addPropCollider(x, z, w * 0.5, d * 0.5, baseY + 0.85)._kind = "plaza-planter";'
  );
  gridSrc = gridSrc.replace(
    'addPropCollider(x, z, 0.95, 0.27, y + 0.92, rotY);',
    'addPropCollider(x, z, 0.95, 0.27, y + 0.92, rotY)._kind = "bench";'
  );
  gridSrc = gridSrc.replace(
    'addPropCollider(x, z, 0.2, 0.2, y + 4.45);',
    'addPropCollider(x, z, 0.2, 0.2, y + 4.45)._kind = "plaza-park-lamp";'
  );
  gridSrc += '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }';

  const treesMod = loadModule(source('trees'), {
    imports: { 'three/webgpu': stub, './tsl-materials.js': stub, './city-config.js': config },
    globals: { ...globals, _plateCounter: plateCounter }
  });

  const gridModule = loadModule(gridSrc, {
    imports: { ...inertRendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, _plateCounter: plateCounter }
  });

  // 3. City blocks (built before grid in main.js, then populateLeftoverSlabs after grid)
  let bldSrc = source('buildings');
  bldSrc = bldSrc.replace(
    'sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1 });',
    'sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1, _src: "leftover-slab" });'
  );
  const bldModule = loadModule(bldSrc, {
    imports: {
      ...inertRendering,
      './balconies.js': stub,
      './roofs.js': stub,
      './city-config.js': config,
      './geodata.js': { GEO },
      './city-grid.js': gridModule
    },
    globals: { ...globals, _plateCounter: plateCounter }
  });
  const cityBlocks = bldModule.buildCityBlocks(stub);
  const buildingColliders = [...landmarks.colliders, ...cityBlocks.colliders];

  const cityGrid = gridModule.buildCityGrid(stub, {
    buildingFootprints: cityBlocks.footprintsByBlock,
    buildingColliders
  });
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };

  // Re-bind liveGrid exports for populateLeftoverSlabs by updating the bindings via a tiny helper?
  // Wait: bldModule captured gridModule's initial undefined let bindings, so let's run populateLeftoverSlabs
  // logic directly on liveGrid.parkTreeSites/sidewalkBlocks/pavedPlazaRects if needed, OR load buildings with liveGrid!
  // Let's check: in main.js, cityBlocks.populateLeftoverSlabs() runs after cityGrid. In VM, buildings.js has a snapshot
  // of gridModule's exports at load time. Let's call a second load or run populateLeftoverSlabs on liveGrid?
  // Actually, if we pass liveGrid after buildCityGrid? No, buildCityGrid needed cityBlocks.footprintsByBlock.
  // So let's replicate the exact populateLeftoverSlabs call or expose a setter in bldSrc!
  // Even simpler: inject `export function setLiveGrid(g) { pavedPlazaRects = g.pavedPlazaRects; parkTreeSites = g.parkTreeSites; sidewalkBlocks = g.sidewalkBlocks; }`
  // Wait: `pavedPlazaRects` is an import const in module scope, so let's replace `import { pavedPlazaRects, parkTreeSites` in bldSrc?
  // Easier: let's patch `buildings.js` in memory so `populateLeftoverSlabs` uses `liveGrid`!
  // Actually, let's just run `populateLeftoverSlabs` by patching `const sites = parkTreeSites;` in `bldSrc` to read from `globalThis._liveGrid`!
  const bldModule2 = loadModule(
    bldSrc.replace(
      'const plazas = pavedPlazaRects || [];\n    const sites = parkTreeSites;',
      'const plazas = (globalThis._liveGrid && globalThis._liveGrid.pavedPlazaRects) || pavedPlazaRects || [];\n    const sites = (globalThis._liveGrid && globalThis._liveGrid.parkTreeSites) || parkTreeSites;'
    ).replace(
      'for (const s of (sites && sidewalkBlocks) || []) {',
      'const swBlocks = (globalThis._liveGrid && globalThis._liveGrid.sidewalkBlocks) || sidewalkBlocks;\n    for (const s of (sites && swBlocks) || []) {'
    ),
    {
      imports: {
        ...inertRendering,
        './balconies.js': stub,
        './roofs.js': stub,
        './city-config.js': config,
        './geodata.js': { GEO },
        './city-grid.js': gridModule
      },
      globals: { ...globals, globalThis: { _liveGrid: liveGrid } }
    }
  );
  const cityBlocks2 = bldModule2.buildCityBlocks(stub);
  cityBlocks2.populateLeftoverSlabs();

  // 4. Airport, Canopies, Outskirts, Bridges
  const airport = loadModule(source('airport'), {
    imports: { ...threeRendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, _plateCounter: plateCounter }
  }).buildAirport(new Group());

  const canopies = loadModule(source('canopies'), {
    imports: { ...threeRendering, './geodata.js': { GEO } },
    globals: { ...globals, _plateCounter: plateCounter }
  }).buildCanopies(new Group());

  const satMod = loadModule(source('satellite-sites'), {
    imports: { ...threeRendering, './city-config.js': config },
    globals: { ...globals, _plateCounter: plateCounter }
  });
  const outskirtsGroup = new Group();
  const outskirts = loadModule(source('outskirts'), {
    imports: { ...threeRendering, './city-config.js': config, './geodata.js': { GEO }, './satellite-sites.js': satMod, './city-grid.js': liveGrid },
    globals: { ...globals, _plateCounter: plateCounter }
  }).buildOutskirts(outskirtsGroup);

  const bridges = loadModule(source('bridges'), {
    imports: { ...threeRendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, _plateCounter: plateCounter }
  }).buildBridges(new Group(), { sidewalks: cityGrid.sidewalks });

  const allColliders = [
    ...landmarks.colliders, ...cityBlocks2.colliders, ...airport.colliders, ...canopies.colliders,
    ...outskirts.colliders, ...bridges.colliders, ...(cityGrid.colliders || [])
  ];

  // 5. Street Details + Road Network + Traffic + Tram Infra
  const roadNetMod = loadModule(source('road-network'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, _plateCounter: plateCounter }
  });

  let capturedTrees = [];
  const treesCapture = {
    ...treesMod,
    createTreeField: (_scene, sites) => {
      capturedTrees = sites.slice();
      return { group: new Group(), update() {} };
    }
  };

  let streetSrc = source('street-details');
  // Tag street trees vs OSM trees
  streetSrc = streetSrc.replace(
    'const t = { x, y: 0.22, z, scale, species, acrossX, ...extra };',
    'const t = { x, y: 0.22, z, scale, species, acrossX, _src: "street", ...extra };'
  );
  streetSrc = streetSrc.replace(
    'const site = { x, y, z, scale, species, acrossX: false, tier: 1, pitRot: 0, grate: false, pitS: 0.7 };',
    'const site = { x, y, z, scale, species, acrossX: false, tier: 1, pitRot: 0, grate: false, pitS: 0.7, _src: "osm-street" };'
  );
  streetSrc = streetSrc.replace(
    'const site = { x, y, z, scale, species };',
    'const site = { x, y, z, scale, species, _src: "osm-park" };'
  );
  // Tag colliders in street-details by kind
  streetSrc = streetSrc.replace(
    'const addCollider = (x, z, hx, hz, maxY) => {',
    'const addCollider = (x, z, hx, hz, maxY, kind = "prop") => {'
  );
  streetSrc = streetSrc.replace(
    'const c = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, maxY };',
    'const c = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, maxY, _kind: kind };'
  );
  streetSrc = streetSrc.replace(
    'addCollider(p.x, p.z, 0.08, 0.08, 0.1 + SIGNAL_POLE_H);',
    'addCollider(p.x, p.z, 0.08, 0.08, 0.1 + SIGNAL_POLE_H, "signal-pole");'
  );
  streetSrc = streetSrc.replace(
    'addCollider(p.x, p.z, 0.1, 0.1, 0.1 + height);',
    'addCollider(p.x, p.z, 0.1, 0.1, 0.1 + height, "signal-mast");'
  );
  streetSrc = streetSrc.replace(
    'addCollider(px, pz, 0.18, 0.18, 4.36);',
    'addCollider(px, pz, 0.18, 0.18, 4.36, "gas-lantern");'
  );
  streetSrc = streetSrc.replace(
    'addCollider(lx, lz, 0.14, 0.14, 0.1 + 8.6 * scale);',
    'addCollider(lx, lz, 0.14, 0.14, 0.1 + 8.6 * scale, "led-mast");'
  );
  streetSrc = streetSrc.replace(
    'addCollider(p.x, p.z, FURNITURE_TOP[kind][0], FURNITURE_TOP[kind][0], FURNITURE_TOP[kind][1]);',
    'addCollider(p.x, p.z, FURNITURE_TOP[kind][0], FURNITURE_TOP[kind][0], FURNITURE_TOP[kind][1], kind);'
  );
  streetSrc = streetSrc.replace(
    'if (kind === \'column\') addCollider(x, z, 0.62, 0.62, 3.4);',
    'if (kind === \'column\') addCollider(x, z, 0.62, 0.62, 3.4, "ad-column");'
  );
  streetSrc = streetSrc.replace(
    'colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: kind === \'kiosk\' ? 2.72 : 2.4,',
    'colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: kind === \'kiosk\' ? 2.72 : 2.4, _kind: kind,'
  );
  streetSrc = streetSrc.replace(
    'const c = addCollider(x, z, 0.28 * scale, 0.28 * scale, SIDEWALK_Y + 3.0);',
    'const c = addCollider(x, z, 0.28 * scale, 0.28 * scale, SIDEWALK_Y + 3.0, "tree-trunk");'
  );
  streetSrc = streetSrc.replace(
    'const c = addCollider(x, z, 0.28 * scale, 0.28 * scale, y + 3.0);',
    'const c = addCollider(x, z, 0.28 * scale, 0.28 * scale, y + 3.0, "tree-trunk");'
  );
  streetSrc = streetSrc.replace(
    'placedPlates.push({ x: wx, z: wz, name: a.name });',
    'placedPlates.push({ x: wx, z: wz, name: a.name }); _plateCounter.count++;'
  );

  const streetMod = loadModule(streetSrc, {
    imports: {
      ...threeRendering,
      './city-config.js': config,
      './road-network.js': roadNetMod,
      './trees.js': treesCapture,
      './city-grid.js': liveGrid
    },
    globals: { ...globals, _plateCounter: plateCounter }
  });

  const streetDetails = streetMod.buildStreetDetails(new Group(), {
    buildingColliders: allColliders,
    grid: cityGrid
  });

  const network = streetDetails.roadNetwork;
  const pedRoutesMod = loadModule(source('pedestrian-routes'), {
    imports: { './city-config.js': config, './road-network.js': roadNetMod },
    globals: { ...globals, _plateCounter: plateCounter }
  });
  const pedestrianRoutes = pedRoutesMod.createPedestrianRoutes(
    network, config.blockAt, liveGrid.railClearance, buildingColliders, config.PEDESTRIAN_WAYS
  );

  const tramInfraMod = loadModule(source('tram-infra'), {
    imports: { ...inertRendering, './geodata.js': { GEO }, './city-config.js': config },
    globals: { ...globals, _plateCounter: plateCounter }
  });
  const tramLayout = tramInfraMod.layoutTramInfrastructure(network, cityGrid);
  const railLayout = tramInfraMod.layoutRailInfrastructure(network);
  const signalSupports = [...tramLayout.poles, ...railLayout.masts];
  streetDetails.addRuntimeSignalHeads(network, pedestrianRoutes, signalSupports);
  const tramInfra = tramInfraMod.buildTramInfrastructure(new Group(), network, { tram: tramLayout, rail: railLayout });

  // ==========================================================================
  // Build GEO.rail spatial index (both tram and rail)
  // ==========================================================================
  const railSegs = [];
  for (const chain of GEO.rail || []) {
    const kind = chain.kind || 'rail';
    const pts = chain.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      railSegs.push({
        ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3],
        kind, street: chain.street || ''
      });
    }
  }
  const queryRail = buildSegIndex(railSegs, 32, 12);

  // Street/block lookup for reporting
  const roadSegs = [];
  for (const r of config.ROADS) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      roadSegs.push({ ax: r.pts[i].x, az: r.pts[i].z, bx: r.pts[i + 1].x, bz: r.pts[i + 1].z, name: r.name || '' });
    }
  }
  const queryRoad = buildSegIndex(roadSegs, 64, 40);

  function locationLabel(x, z) {
    const blk = config.blockAt(x, z);
    let bestStreet = '';
    let bestD = 40;
    for (const r of queryRoad(x, x, z, z)) {
      if (!r.name) continue;
      const d = distPointToSeg(x, z, r.ax, r.az, r.bx, r.bz);
      if (d < bestD) { bestD = d; bestStreet = r.name; }
    }
    const parts = [];
    if (blk) parts.push(`block ${blk.id}${blk.district ? ` (${blk.district})` : ''}`);
    if (bestStreet) parts.push(bestStreet);
    return parts.join(' / ') || 'open';
  }

  // ============================================================================
  // Measure helper
  // ============================================================================
  // Constants from the codebase:
  // - js/trams.js: TRAM_HALF_WIDTH = 1.2 m (2.4 m tram body)
  // - js/tram-infra.js: RAIL_KEEP = 2.6 m (structure gauge), RAIL_SLEEPER = 2.6 m (half = 1.3 m), TRACK_KEEP = 1.75 m
  // - js/city-grid.js: RAIL_PROP_KEEP = 2.0 m
  const TRAM_HALF_WIDTH = 1.2;
  const RAIL_HALF_WIDTH = 1.3; // half of RAIL_SLEEPER (2.6 m) / train body ~1.5 m; we also track < 2.0 m (RAIL_PROP_KEEP)
  const ON_TRACK_DIST = 0.5;

  function measureCircle(x, z, r) {
    let bestDist = Infinity, bestKind = null, bestStreet = '';
    let minTram = Infinity, minRail = Infinity;
    for (const s of queryRail(x - r, x + r, z - r, z + r)) {
      const d = Math.max(0, distPointToSeg(x, z, s.ax, s.az, s.bx, s.bz) - r);
      if (d < bestDist) { bestDist = d; bestKind = s.kind; bestStreet = s.street; }
      if (s.kind === 'tram' && d < minTram) minTram = d;
      if (s.kind === 'rail' && d < minRail) minRail = d;
    }
    return { dist: bestDist, kind: bestKind, railStreet: bestStreet, minTram, minRail };
  }

  function measurePoly(poly) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of poly) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
    }
    let bestDist = Infinity, bestKind = null, bestStreet = '';
    let minTram = Infinity, minRail = Infinity;
    for (const s of queryRail(x0, x1, z0, z1)) {
      const d = distPolyToSeg(poly, s.ax, s.az, s.bx, s.bz);
      if (d < bestDist) { bestDist = d; bestKind = s.kind; bestStreet = s.street; }
      if (s.kind === 'tram' && d < minTram) minTram = d;
      if (s.kind === 'rail' && d < minRail) minRail = d;
    }
    return { dist: bestDist, kind: bestKind, railStreet: bestStreet, minTram, minRail };
  }

  // ============================================================================
  // Collect all static objects as actually built
  // ============================================================================
  const items = [];
  const pushPoly = (cat, cx, cz, poly, extra = {}) => {
    const m = measurePoly(poly);
    const onTrack = m.dist < ON_TRACK_DIST;
    const inEnvelope = m.minTram < TRAM_HALF_WIDTH || m.minRail < RAIL_HALF_WIDTH;
    items.push({ cat, cx: +cx.toFixed(2), cz: +cz.toFixed(2), ...m, onTrack, inEnvelope, ...extra });
  };
  const pushCircle = (cat, cx, cz, r, extra = {}) => {
    const m = measureCircle(cx, cz, r);
    const onTrack = m.dist < ON_TRACK_DIST;
    const inEnvelope = m.minTram < TRAM_HALF_WIDTH || m.minRail < RAIL_HALF_WIDTH;
    items.push({ cat, cx: +cx.toFixed(2), cz: +cz.toFixed(2), r: +r.toFixed(3), ...m, onTrack, inEnvelope, ...extra });
  };

  // A. Trees (all species: park, part-park, plaza-planter, leftover-slab, osm, site, street)
  const TRUNK_R = [0.28, 0.25, 0.36, 0.27];
  for (const t of capturedTrees) {
    const r = (TRUNK_R[t.species] || 0.28) * (t.scale || 1);
    const src = t._src || t.source || (t.planter ? 'plaza-planter' : t.tier ? 'street' : 'park');
    pushCircle(`tree:${src}`, t.x, t.z, r, { species: t.species, scale: +(t.scale || 1).toFixed(2) });
  }
  // Street tree pit curbs (1.7 * pitS x 2.6 m) — all street/osm-street/leftover-slab trees with tier
  for (const t of capturedTrees) {
    if (!t.tier) continue;
    const hx = 0.85 * (t.pitS || 1), hz = 1.3;
    const ry = t.pitRot || 0;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    pushPoly('tree-pit-curb', t.x, t.z, obbCorners(t.x, t.z, hx, hz, cs, sn));
  }

  // B. City-grid propColliders (benches, plaza/park lamps, plaza planters; skip isTrunk since trees are audited above)
  for (const c of cityGrid.propColliders) {
    if (c.isTrunk) continue;
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    pushPoly(c._kind || 'grid-prop', cx, cz, colliderPoly(c));
  }

  // C. Street-details colliders (lamps, gas lanterns, hydrants, postboxes, parking, bollards, ad-columns, kiosks, flower-stands, signal-poles)
  for (const c of streetDetails.colliders) {
    if (c._kind === 'tree-trunk' || c.isTrunk) continue; // covered by tree:* above
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    if (c._kind === 'ad-column') {
      pushCircle('ad-column', cx, cz, 0.65);
    } else if (c._kind === 'kiosk') {
      // Check actual roof overhang (2.5 x 1.8 m) as well as body
      const { hx, hz, cs, sn } = c.obb;
      pushPoly('kiosk', cx, cz, obbCorners(cx, cz, hx, hz, cs, sn));
    } else {
      pushPoly(c._kind || 'street-prop', cx, cz, colliderPoly(c));
    }
  }

  // D. Tram & rail infrastructure (non-exempt)
  for (const p of tramLayout.poles) {
    pushCircle('tram-catenary-pole', p.x, p.z, 0.14);
  }
  for (const m of railLayout.masts) {
    pushPoly('rail-catenary-mast', m.x, m.z, obbCorners(m.x, m.z, 0.15, 0.15, 1, 0));
  }
  for (const s of tramLayout.stops) {
    if (s.shelter) {
      // Shelter roof footprint: 4.6 x 1.6 m (SHELTER_HALF_LEN = 2.3 * len / 4.4, SHELTER_HALF_DEPTH = 0.8), oriented by sh.yaw
      const sh = s.shelter;
      const cs = Math.cos(sh.yaw), sn = Math.sin(sh.yaw);
      const hx = 2.3 * (sh.len || 4.4) / 4.4;
      pushPoly('tram-shelter', sh.x, sh.z, obbCorners(sh.x, sh.z, hx, 0.8, cs, sn), { stop: s.name });
    }
    if (s.sign) {
      pushPoly('tram-stop-sign', s.sign.x, s.sign.z, obbCorners(s.sign.x, s.sign.z, 0.15, 0.15, 1, 0), { stop: s.name });
    }
    if (s.machine) {
      const mcs = Math.cos(s.machine.yaw || 0), msn = Math.sin(s.machine.yaw || 0);
      pushPoly('tram-ticket-machine', s.machine.x, s.machine.z, obbCorners(s.machine.x, s.machine.z, 0.31, 0.24, mcs, msn), { stop: s.name });
    }
  }
  // Rail fences from railLayout (rail-end-wall is a concrete retaining wall across cut railway beds; check vs tram only)
  let railEndWallsExempt = 0;
  for (const e of railLayout.ends || []) {
    const w = e.w || 7.5;
    const corners = obbCorners(e.x, e.z, 0.25, w * 0.5, e.dx, -e.dz);
    const { minTram } = measurePoly(corners);
    if (minTram < TRAM_HALF_WIDTH) {
      pushPoly('rail-end-wall', e.x, e.z, corners);
    } else {
      railEndWallsExempt++;
    }
  }
  for (const run of railLayout.runs || []) {
    const pts = run.pts || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const t = run.solid && run.solid[i] ? 0.3 : 0.22;
      pushPoly('rail-fence', mx, mz, obbCorners(mx, mz, len * 0.5, t * 0.5, dx, -dz));
    }
  }

  // E. Canopies (ground posts only; roof decks have minY >= 4.5 m)
  for (const c of canopies.colliders) {
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    if ((c.minY || 0) >= 4.0) continue; // overhead canopy roof (exempt, above 4.3 m vehicle)
    pushPoly('canopy-post', cx, cz, colliderPoly(c));
  }

  // F. Bridges (parapets)
  for (const c of bridges.colliders) {
    if ((c.minY || 0) >= 4.0) continue;
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    pushPoly('bridge-parapet', cx, cz, colliderPoly(c));
  }

  // G. Landmarks (ground-level colliders; overhead ones >= 4.5 m are exempt)
  for (const c of landmarks.colliders) {
    if ((c.minY || 0) >= 4.5) continue;
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    pushPoly('landmark-collider', cx, cz, colliderPoly(c));
  }

  // H. Airport colliders
  for (const c of airport.colliders) {
    if ((c.minY || 0) >= 4.5) continue;
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    pushPoly('airport-collider', cx, cz, colliderPoly(c));
  }

  // I. Outskirts buildings (traverse InstancedMeshes in outskirtsGroup)
  function walkOutskirts(obj) {
    if (obj.isInstancedMesh && obj.name &&
        obj.name !== 'OutskirtsLand' && obj.name !== 'OutskirtsBanks' && obj.name !== 'OutskirtsFiller') {
      const arr = obj.instanceMatrix.array;
      for (let i = 0; i < obj.count; i++) {
        const off = i * 16;
        const sx = Math.hypot(arr[off], arr[off + 1], arr[off + 2]);
        const sz = Math.hypot(arr[off + 8], arr[off + 9], arr[off + 10]);
        const cx = arr[off + 12], cz = arr[off + 14];
        const cs = sx > 0 ? arr[off] / sx : 1;
        const sn = sx > 0 ? -arr[off + 2] / sx : 0;
        pushPoly('outskirts-building', cx, cz, obbCorners(cx, cz, sx * 0.5, sz * 0.5, cs, sn));
      }
    }
    for (const c of obj.children || []) walkOutskirts(c);
  }
  walkOutskirts(outskirtsGroup);

  // Exempt counts (legitimately at the track)
  const exempt = {
    'tram-rail-pieces': tramLayout.pieces.length,
    'tram-platforms': tramLayout.stops.filter((s) => s.kind === 'island').length,
    'tram-overhead-spans-arms': tramLayout.spans.length + tramLayout.arms.length,
    'rail-ballast-sleepers': railLayout.pieces.length,
    'rail-level-crossings': railLayout.level.length,
    'rail-viaducts': railLayout.viaducts.length,
    'rail-overhead-arms-portals': railLayout.arms.length + railLayout.portals.length,
    'rail-end-walls-cut-beds': railEndWallsExempt,
    'canopy-overhead-roofs': canopies.colliders.filter((c) => (c.minY || 0) >= 4.0).length,
    'name-plates-wall-mounted': plateCounter.count
  };

  // Annotate worst items with block/street
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  const summary = [];
  for (const [cat, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const onTrack = list.filter((i) => i.onTrack);
    const inEnv = list.filter((i) => i.inEnvelope);
    const worst = [...list]
      .filter((i) => Number.isFinite(i.dist))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10)
      .map((i) => ({
        cx: i.cx, cz: i.cz,
        dist: +i.dist.toFixed(4),
        kind: i.kind,
        where: locationLabel(i.cx, i.cz),
        ...(i.stop ? { stop: i.stop } : {})
      }));
    summary.push({
      category: cat,
      count: list.length,
      onTrack: onTrack.length,
      inEnvelope: inEnv.length,
      minDist: worst.length ? worst[0].dist : null,
      worst
    });
  }

  return {
    constants: { ON_TRACK_DIST, TRAM_HALF_WIDTH, RAIL_HALF_WIDTH },
    totalAudited: items.length,
    exempt,
    summary,
    items
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const topIdx = args.indexOf('--top');
  const top = topIdx >= 0 ? Number(args[topIdx + 1]) : 10;
  const catIdx = args.indexOf('--category');
  const catFilter = catIdx >= 0 ? args[catIdx + 1] : null;

  const res = await runAudit();
  if (asJson) {
    console.log(JSON.stringify({
      constants: res.constants,
      totalAudited: res.totalAudited,
      exempt: res.exempt,
      summary: res.summary
    }, null, 2));
  } else {
    console.log(`Static objects audited: ${res.totalAudited}`);
    console.log(`Thresholds: onTrack < ${res.constants.ON_TRACK_DIST} m; inEnvelope < ${res.constants.TRAM_HALF_WIDTH} m (TRAM_HALF_WIDTH) / < ${res.constants.RAIL_HALF_WIDTH} m (RAIL_SLEEPER/2)`);
    console.log(`\nExempt track-side/overhead categories:`);
    for (const [k, v] of Object.entries(res.exempt)) console.log(`  ${k}: ${v}`);
    console.log(`\nPer-category summary:`);
    for (const s of res.summary) {
      if (catFilter && !s.category.includes(catFilter)) continue;
      console.log(`  ${s.category.padEnd(24)} count=${String(s.count).padStart(6)}  onTrack(<0.5m)=${String(s.onTrack).padStart(4)}  inEnv=${String(s.inEnvelope).padStart(4)}  minDist=${s.minDist !== null ? s.minDist.toFixed(3) + 'm' : 'n/a'}`);
      if (s.onTrack > 0 || s.inEnvelope > 0 || catFilter) {
        for (const w of s.worst.slice(0, top)) {
          console.log(`    worst: (${w.cx}, ${w.cz}) dist=${w.dist}m [${w.kind}] ${w.where}${w.stop ? ` (${w.stop})` : ''}`);
        }
      }
    }
  }
}
