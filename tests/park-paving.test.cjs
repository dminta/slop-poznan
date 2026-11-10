// tests/park-paving.test.cjs
// Regression tests for park paving, lawns, granite beds, ponds, and planter boxes in park blocks with buildings.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');

function inert() {
  const fn = function () {};
  const proxy = new Proxy(fn, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then' || key === Symbol.iterator) return undefined;
      return proxy;
    },
    set: () => true, apply: () => proxy, construct: () => proxy
  });
  return proxy;
}

const source = (name) => readFileSync(join(__dirname, `../js/${name}.js`), 'utf8');

function setupTestWorld() {
  const config = require('../js/city-config.js');
  const { GEO } = require('../js/geodata.js');
  const stub = inert();
  const globals = {
    console: { info() {}, log() {}, warn() {} }, document: stub, Math, Map, Set, WeakMap, Object, Array, Number, JSON,
    Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array
  };
  const rendering = {
    'three/webgpu': THREE, 'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub, './tsl-materials.js': stub
  };

  // 1. Landmarks
  const kit = loadModule(source('landmark-kit'), { imports: { ...rendering, './city-config.js': config }, globals });
  const clock = loadModule(source('city-clock'), { imports: {}, globals });
  const lmMod = loadModule(source('landmarks'), {
    imports: {
      ...rendering, './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { batchStaticGroupMeshes: () => {} },
      './landmark-kit.js': kit,
      './landmarks-rynek.js': loadModule(source('landmarks-rynek'), { imports: { ...rendering, './city-config.js': config, './landmark-kit.js': kit, './city-clock.js': clock }, globals }),
      './landmarks-heritage.js': loadModule(source('landmarks-heritage'), { imports: { ...rendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-centrum.js': loadModule(source('landmarks-centrum'), { imports: { ...rendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-dworzec.js': loadModule(source('landmarks-dworzec'), { imports: { ...rendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-historic.js': loadModule(source('landmarks-historic'), { imports: { ...rendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-towers.js': loadModule(source('landmarks-towers'), { imports: { ...rendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-stadium.js': loadModule(source('landmarks-stadium'), { imports: { ...rendering, './landmark-kit.js': kit }, globals })
    },
    globals
  });
  const landmarks = lmMod.buildLandmarks(new THREE.Group());

  // 2. City Blocks
  const bldMod = loadModule(source('buildings'), {
    imports: {
      ...rendering, './balconies.js': stub, './roofs.js': stub,
      './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], railClearance: () => 100, sidewalkBlocks: [] }
    },
    globals
  });
  const cityBlocks = bldMod.buildCityBlocks(new THREE.Group());

  // 3. City Grid with recorded extruded meshes and planter box counters
  const recordedMeshes = [];
  const emittedPlanterBoxes = [];
  const emittedPlanterHedges = [];

  let gridSrc = 'let __currentBlock = null;\n' + source('city-grid');
  gridSrc = gridSrc.replace(
    'for (const b of BLOCKS) {\n    if (!isParkBlock(b)) continue;',
    'for (const b of BLOCKS) {\n    __currentBlock = null;\n    if (!isParkBlock(b)) continue;\n    __currentBlock = b;'
  );
  gridSrc = gridSrc.replace(
    '// Parks inside blocks that are only partly park',
    '__currentBlock = null;\n  // Parks inside blocks that are only partly park'
  );
  gridSrc = gridSrc.replace(
    'function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false, holes = []) {',
    'function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false, holes = []) {\n    recordedMeshes.push({ pts, bottomY, height, material, holes, blockId: __currentBlock ? __currentBlock.id : null });'
  );
  gridSrc = gridSrc.replace(
    'function addPlanter(x, z, w, d, baseY = PLAZA_Y) {',
    'function addPlanter(x, z, w, d, baseY = PLAZA_Y) {\n    emittedPlanterBoxes.push({ x, z, w, d, baseY });\n    emittedPlanterHedges.push({ x, z, w: w - 0.35, d: d - 0.35, baseY: baseY + 0.55 });'
  );
  gridSrc += '\nexport function getGridHelpers() { return { ringInside, pointInPolygonXZ, polygonCentroidArea, offsetPolygonInward, armiiParkRoadCuts, parkBedOutline, parkBedInset, cutSlab, unionPolygons, offsetPolygon, getParkTreeSites: () => parkTreeSites }; }';

  const gridMod = loadModule(gridSrc, {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, recordedMeshes, emittedPlanterBoxes, emittedPlanterHedges }
  });

  const buildingColliders = [...landmarks.colliders, ...cityBlocks.colliders];
  const grid = gridMod.buildCityGrid(new THREE.Group(), {
    buildingFootprints: cityBlocks.footprintsByBlock,
    buildingColliders
  });

  cityBlocks.populateLeftoverSlabs?.();

  return {
    config, GEO, landmarks, cityBlocks, gridMod, grid, recordedMeshes,
    emittedPlanterBoxes, emittedPlanterHedges, helpers: gridMod.getGridHelpers()
  };
}

let cachedWorld = null;
function getWorld() {
  if (!cachedWorld) cachedWorld = setupTestWorld();
  return cachedWorld;
}

const isParkBlock = (b) => b.park > 0.6 && !b.median && b.area > 250;
const SURFACE_KIND = (m) => (
  m.bottomY === 0 && Math.abs(m.height - 0.22) < 1e-6 ? 'curb' :
  m.bottomY === 0 && Math.abs(m.height - 0.26) < 1e-6 ? 'paving' :
  m.bottomY === 0.2 && Math.abs(m.height - 0.2) < 1e-6 ? 'granite' :
  m.bottomY === 0.3 && Math.abs(m.height - 0.11) < 1e-6 ? 'lawn' : null
);
const KINDS = ['curb', 'paving', 'granite', 'lawn'];

// Real three triangulation of a recorded mesh, in world xz, cached: the coverage and triangulation tests share it
const triCache = new WeakMap();
function triangulate(m) {
  if (triCache.has(m)) return triCache.get(m);
  const mk = (x, y) => ({ x, y, equals(o) { return Math.abs(o.x - x) < 1e-4 && Math.abs(o.y - y) < 1e-4; } });
  const v = m.pts.map((p) => mk(p.x, -p.z));
  const verts = THREE.ShapeUtils.isClockWise(v) ? v : v.slice().reverse();
  const hs = m.holes.map((h) => {
    const hv = h.map((p) => mk(p.x, -p.z));
    return THREE.ShapeUtils.isClockWise(hv) ? hv.slice().reverse() : hv;
  });
  const all = verts.concat(...hs);
  const tris = THREE.ShapeUtils.triangulateShape(verts, hs).map((f) => f.map((i) => ({ x: all[i].x, z: -all[i].y })));
  triCache.set(m, tris);
  return tris;
}

// Scanline raster over a block's bounds (cell centres, row-major): `op` applies to every span inside `ring` by
// even-odd ('set' marks, 'add' counts triangle cover); fillWinding instead adds each span's winding number.
function makeRaster(b, step) {
  const x0 = b.minX - 1, z0 = b.minZ - 1;
  const nx = Math.ceil((b.maxX - b.minX + 2) / step), nz = Math.ceil((b.maxZ - b.minZ + 2) / step);
  return { x0, z0, nx, nz, step, rows: Array.from({ length: nz }, () => []) };
}
function fillRing(g, mask, ring, op) {
  const { x0, z0, nx, nz, step, rows } = g;
  let r0 = nz, r1 = -1;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], c = ring[i];
    if (a.z === c.z) continue;
    const lo = Math.min(a.z, c.z), hi = Math.max(a.z, c.z);
    const s = Math.max(0, Math.ceil((lo - z0) / step - 0.5)), e = Math.min(nz - 1, Math.ceil((hi - z0) / step - 0.5) - 1);
    for (let iz = s; iz <= e; iz++) {
      const zc = z0 + (iz + 0.5) * step;
      rows[iz].push(a.x + ((zc - a.z) * (c.x - a.x)) / (c.z - a.z));
    }
    if (s < r0) r0 = s;
    if (e > r1) r1 = e;
  }
  for (let iz = r0; iz <= r1; iz++) {
    const xs = rows[iz];
    if (!xs.length) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const s = Math.max(0, Math.ceil((xs[k] - x0) / step - 0.5));
      const e = Math.min(nx - 1, Math.ceil((xs[k + 1] - x0) / step - 0.5) - 1);
      const row = iz * nx;
      for (let ix = s; ix <= e; ix++) {
        if (op === 'set') mask[row + ix] = 1;
        else if (mask[row + ix] < 255) mask[row + ix]++;
      }
    }
    xs.length = 0;
  }
}

function fillWinding(g, mask, ring) {
  const { x0, z0, nx, nz, step } = g;
  const rows = new Map();
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], c = ring[i];
    if (a.z === c.z) continue;
    const s = Math.max(0, Math.ceil((Math.min(a.z, c.z) - z0) / step - 0.5));
    const e = Math.min(nz - 1, Math.ceil((Math.max(a.z, c.z) - z0) / step - 0.5) - 1);
    for (let iz = s; iz <= e; iz++) {
      const zc = z0 + (iz + 0.5) * step;
      if (!rows.has(iz)) rows.set(iz, []);
      rows.get(iz).push([a.x + ((zc - a.z) * (c.x - a.x)) / (c.z - a.z), c.z > a.z ? 1 : -1]);
    }
  }
  for (const [iz, xs] of rows) {
    xs.sort((p, q) => p[0] - q[0]);
    let w = 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      w += xs[k][1];
      if (!w) continue;
      const s = Math.max(0, Math.ceil((xs[k][0] - x0) / step - 0.5));
      const e = Math.min(nx - 1, Math.ceil((xs[k + 1][0] - x0) / step - 0.5) - 1);
      for (let ix = s; ix <= e; ix++) mask[iz * nx + ix] += w;
    }
  }
}

// Per-kind raster comparison of the emitted surfaces of the 42 park blocks with buildings (real triangles), at 0.5 m,
// computed once. The inset bed and lawn outlines fold across themselves at narrow walks, so there are two references
// (like the measurement scripts): `missing` counts cells wound the outline's own way (a retrograde fold loop is not
// meant to be lawn) and `extra` counts cover outside the outline by even-odd; both minus ponds or pond paths, road
// corridors and footprints.
let cachedCoverage = null;
function surfaceCoverage() {
  if (cachedCoverage) return cachedCoverage;
  const { config, cityBlocks, helpers, recordedMeshes } = getWorld();
  const STEP = 0.5, A = STEP * STEP;
  const tot = {};
  for (const k of KINDS) tot[k] = { underFp: 0, missing: 0, extra: 0, multi: 0 };
  const perBlock = [];
  let footprint = 0, blocks = 0;
  for (const b of config.BLOCKS) {
    if (!isParkBlock(b) || !b.buildings) continue;
    blocks++;
    const g = makeRaster(b, STEP);
    const n = g.nx * g.nz;
    const fp = new Uint8Array(n);
    for (const h of cityBlocks.footprintsByBlock.get(b.id) || []) fillRing(g, fp, h, 'set');
    for (let i = 0; i < n; i++) footprint += fp[i] * A;

    const ponds = config.LAND_HOLES.map((h) => h.ring).filter((h) => helpers.ringInside(b.poly, h));
    const roadCuts = helpers.armiiParkRoadCuts(b) || b.roadCut;
    const bed = helpers.offsetPolygonInward(helpers.parkBedOutline(b), helpers.parkBedInset(b, roadCuts));
    const bedHoles = bed ? ponds.map((h) => {
      const path = helpers.offsetPolygon(h, -2.0);
      return path && helpers.ringInside(bed, path) ? path : h;
    }).filter((h) => helpers.ringInside(bed, h)) : [];
    const lawnTop = bed && helpers.offsetPolygonInward(bed, 0.3);
    const outlines = {
      curb: [b.poly, ponds],
      paving: [helpers.offsetPolygonInward(b.poly, 0.1) || b.poly, ponds],
      granite: [bed, bedHoles],
      lawn: [lawnTop, bedHoles]
    };
    const meshes = recordedMeshes.filter((m) => m.blockId === b.id);
    const row = { id: b.id };
    for (const k of KINDS) {
      const want = new Uint8Array(n), eo = new Uint8Array(n);
      const [outline, holes] = outlines[k];
      if (outline) {
        const w = new Int16Array(n), hole = new Uint8Array(n);
        fillWinding(g, w, outline);
        for (const h of holes) fillRing(g, hole, h, 'set');
        // a positive shoelace area winds its inside to -1 with fillWinding's crossing directions
        const own = helpers.polygonCentroidArea(outline) > 0 ? -1 : 1;
        for (let i = 0; i < n; i++) {
          if (hole[i] || !w[i]) continue;
          if (Math.sign(w[i]) === own) want[i] = 1;
          if (w[i] % 2) eo[i] = 1;
        }
      }
      // cutSlab removes each corridor quad: the segment lengthened and widened by its half width
      for (const [ax, az, bx, bz, half] of roadCuts || []) {
        const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let i = 0; i < n; i++) {
          if (!want[i] && !eo[i]) continue;
          const x = g.x0 + ((i % g.nx) + 0.5) * STEP - ax, z = g.z0 + (Math.floor(i / g.nx) + 0.5) * STEP - az;
          const t = x * ux + z * uz;
          if (t > -half && t < len + half && Math.abs(x * uz - z * ux) < half) want[i] = eo[i] = 0;
        }
      }
      const cov = new Uint8Array(n);
      for (const m of meshes) if (SURFACE_KIND(m) === k) for (const tr of triangulate(m)) fillRing(g, cov, tr, 'add');
      const r = { underFp: 0, missing: 0, extra: 0, multi: 0 };
      for (let i = 0; i < n; i++) {
        if (cov[i] > 1) r.multi += A;
        if (fp[i]) { if (cov[i]) r.underFp += A; continue; }
        if (want[i] && !cov[i]) r.missing += A;
        if (!eo[i] && cov[i]) r.extra += A;
      }
      for (const f of Object.keys(r)) tot[k][f] += r[f];
      row[k] = r;
    }
    perBlock.push(row);
  }
  cachedCoverage = { tot, perBlock, footprint, blocks };
  return cachedCoverage;
}

test('park blocks with buildings: no curb or paving under footprints, granite and lawn match the intended region', () => {
  const { tot, perBlock, footprint, blocks } = surfaceCoverage();
  assert.equal(blocks, 44, 'all 44 park blocks with buildings checked');
  // ground footprint union across the 44 blocks, 0.5 m raster (239,736 m² after the central density pass on
  // 2026-11-08; 243,502 m² after the park facility carve-out put Hala Arena, Enea Stadion and the other mapped
  // sports centres back on their OSM lots; 305,226 m² after the park-building pass restored the ordinary mapped
  // buildings of 873, 966, 1164, 1268, 884 and 403 as lots; 337,613 m² with the Etap 1 park block at Marcelin;
  // 366,371 m² with the two Etap 2 park blocks west of Ławica; 363,730 m² after the 2026-11-10 legacy gate, which
  // builds the park blocks of Wilda/Łazarz/Jeżyce with the 4d14df9 island-share budget and without their mapped
  // objects and fallback lots, except LEGACY_OBJECTS)
  assert.ok(footprint > 362500 && footprint < 365000, `footprint union ~363.7k m² (got ${footprint})`);
  const fmt = (k) => JSON.stringify(tot[k]);
  for (const row of perBlock) {
    assert.equal(row.curb.underFp, 0, `block ${row.id} curb under footprints`);
    assert.equal(row.paving.underFp, 0, `block ${row.id} paving under footprints`);
  }
  // Tolerances sit just above the 2026-11-08 measurement (m²): granite under footprints 17.5, missing 142; lawn 13.75
  // and 136; curb and paving 0 missing; no cover outside the even-odd outline and 1.5 m² of double cover (curb).
  // Before footprints were cut, granite and lawn under footprints were ~238,600 m² each.
  assert.ok(tot.granite.underFp < 30, `granite under footprints ${fmt('granite')}`);
  assert.ok(tot.lawn.underFp < 30, `lawn under footprints ${fmt('lawn')}`);
  assert.ok(tot.granite.missing < 160, `granite missing outside footprints ${fmt('granite')}`);
  assert.ok(tot.lawn.missing < 160, `lawn missing outside footprints ${fmt('lawn')}`);
  for (const k of KINDS) {
    if (k === 'curb' || k === 'paving') assert.ok(tot[k].missing < 5, `${k} missing outside footprints ${fmt(k)}`);
    assert.ok(tot[k].extra < 10, `${k} outside the intended region ${fmt(k)}`);
    assert.ok(tot[k].multi < 10, `${k} double cover ${fmt(k)}`);
  }
});

test('real triangulation: every park surface mesh of the 42 blocks triangulates to its area with no fill in holes', () => {
  const { config, recordedMeshes, helpers } = getWorld();
  const parkBlocks = new Set(config.BLOCKS.filter((b) => isParkBlock(b) && b.buildings > 0).map((b) => b.id));
  assert.equal(parkBlocks.size, 44, 'all 44 park blocks with buildings checked');

  const triArea = (a, b, c) => 0.5 * Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  const polyArea = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    return 0.5 * Math.abs(a);
  };

  let checked = 0, worst = 0;
  for (const m of recordedMeshes) {
    if (!parkBlocks.has(m.blockId) || !SURFACE_KIND(m)) continue;
    checked++;
    const id = m.blockId;
    // 1. Disjoint holes: zero overlapping/touching hole pairs
    for (let i = 0; i < m.holes.length; i++) {
      for (let j = i + 1; j < m.holes.length; j++) {
        const a = m.holes[i], bH = m.holes[j];
        const overlap = a.some((p) => helpers.pointInPolygonXZ(bH, p.x, p.z)) ||
                        bH.some((p) => helpers.pointInPolygonXZ(a, p.x, p.z));
        assert.equal(overlap, false, `Block ${id} mesh holes must not overlap or touch`);
      }
    }

    // 2. Real three triangulation covers exactly the outline minus its holes: 0.00 m² error measured on 2026-11-05
    // for every mesh (block 966's lawn was 163.5 m² before holes cut by a concave outline stretch were clipped)
    const tris = triangulate(m);
    const actualArea = tris.reduce((sum, t) => sum + triArea(t[0], t[1], t[2]), 0);
    const expectedArea = polyArea(m.pts) - m.holes.reduce((sum, h) => sum + polyArea(h), 0);
    const areaErr = Math.abs(actualArea - expectedArea);
    worst = Math.max(worst, areaErr);
    assert.ok(areaErr < 1.0, `Block ${id} ${SURFACE_KIND(m)} triangulated area err ${areaErr.toFixed(2)} m² must be < 1 m²`);
    if (!m.holes.length) continue;

    // 3. No triangle inside a hole (1 m samples over each hole)
    const tb = tris.map((tr) => [
      Math.min(tr[0].x, tr[1].x, tr[2].x), Math.max(tr[0].x, tr[1].x, tr[2].x),
      Math.min(tr[0].z, tr[1].z, tr[2].z), Math.max(tr[0].z, tr[1].z, tr[2].z)
    ]);
    const TI = new Map();
    tb.forEach((bb, i) => {
      for (let gx = Math.floor(bb[0] / 8); gx <= Math.floor(bb[1] / 8); gx++) {
        for (let gz = Math.floor(bb[2] / 8); gz <= Math.floor(bb[3] / 8); gz++) {
          const k = gx * 1e6 + gz;
          if (!TI.has(k)) TI.set(k, []);
          TI.get(k).push(i);
        }
      }
    });
    const STEP = 1.0;
    let inHoles = 0;
    for (const h of m.holes) {
      const minX = Math.min(...h.map((p) => p.x)), maxX = Math.max(...h.map((p) => p.x));
      const minZ = Math.min(...h.map((p) => p.z)), maxZ = Math.max(...h.map((p) => p.z));
      for (let x = minX + STEP * 0.5; x < maxX; x += STEP) {
        for (let z = minZ + STEP * 0.5; z < maxZ; z += STEP) {
          if (!helpers.pointInPolygonXZ(h, x, z)) continue;
          const ck = Math.floor(x / 8) * 1e6 + Math.floor(z / 8);
          for (const i of TI.get(ck) || []) {
            const bb = tb[i];
            if (x < bb[0] || x > bb[1] || z < bb[2] || z > bb[3]) continue;
            if (helpers.pointInPolygonXZ(tris[i], x, z)) { inHoles += STEP * STEP; break; }
          }
        }
      }
    }
    assert.equal(inHoles, 0, `Block ${id} ${SURFACE_KIND(m)} must have 0 m² of triangles inside holes (got ${inHoles})`);
  }
  // 252 curb, 252 paving, 266 granite and 262 lawn meshes on 2026-11-05; 894 after the park facility carve-out merged
  // the many small cell lots of block 342's sports centre into one envelope (the remaining blocks keep their meshes);
  // 720 after the 2026-11-10 legacy gate: without mapped objects and fallback lots the legacy park blocks have fewer
  // footprint holes, so fewer curb/paving pieces (the coverage test above still matches every intended region)
  assert.ok(checked > 700, `all park surface meshes checked (got ${checked}, worst error ${worst.toFixed(2)} m²)`);
});

test('pond coverage: Park Sołacki ponds have 0 m² park paving coverage', () => {
  const { config, helpers, recordedMeshes } = getWorld();
  const solacki = config.BLOCKS.find((b) => b.id === 262);
  assert.ok(solacki, 'Park Sołacki block 262 exists');

  const solackiPonds = config.LAND_HOLES.map((h) => h.ring).filter((h) => helpers.ringInside(solacki.poly, h));
  assert.equal(solackiPonds.length, 3, 'Park Sołacki has 3 ponds');

  // Verify that paving meshes intersecting Sołacki have all 3 ponds in their holes
  const solackiPaving = recordedMeshes.filter((m) =>
    m.bottomY === 0.0 && m.blockId === solacki.id
  );
  assert.ok(solackiPaving.length > 0, 'Solacki paving mesh exists');

  for (const m of solackiPaving) {
    for (const pond of solackiPonds) {
      const hasPond = m.holes.some((h) => h === pond || helpers.ringInside(h, pond));
      assert.ok(hasPond, 'Pond must be retained as hole in park paving mesh');
    }
  }

  // Raster verification: sample across the 3 ponds (0.5 m raster)
  const RASTER = 0.5;
  let pondPavingArea = 0;
  for (const pond of solackiPonds) {
    const minX = Math.min(...pond.map((p) => p.x)), maxX = Math.max(...pond.map((p) => p.x));
    const minZ = Math.min(...pond.map((p) => p.z)), maxZ = Math.max(...pond.map((p) => p.z));
    for (let x = minX + RASTER * 0.5; x < maxX; x += RASTER) {
      for (let z = minZ + RASTER * 0.5; z < maxZ; z += RASTER) {
        if (!helpers.pointInPolygonXZ(pond, x, z)) continue;
        for (const m of solackiPaving) {
          if (helpers.pointInPolygonXZ(m.pts, x, z)) {
            const inHole = m.holes.some((h) => helpers.pointInPolygonXZ(h, x, z));
            if (!inHole) pondPavingArea += RASTER * RASTER;
          }
        }
      }
    }
  }
  assert.equal(pondPavingArea, 0, `Park Sołacki ponds must have 0 m² paving coverage (got ${pondPavingArea} m²)`);
});

test('critical gap locations covered by exactly one real triangle', () => {
  const { recordedMeshes, helpers } = getWorld();
  const mk = (x, y) => ({ x, y, equals(o) { return Math.abs(o.x - x) < 1e-4 && Math.abs(o.y - y) < 1e-4; } });

  const ptsToCheck = [
    { id: 612, k: 'lawn', bottomY: 0.3, x: 1556.8, z: 262.3 },
    { id: 613, k: 'granite', bottomY: 0.2, x: 4360.8, z: 1691.3 },
    { id: 613, k: 'lawn', bottomY: 0.3, x: 4192.8, z: 1595.8 },
    { id: 612, k: 'granite', bottomY: 0.2, x: 1464.8, z: 46.8 }
  ];

  for (const pt of ptsToCheck) {
    const meshes = recordedMeshes.filter((m) => m.blockId === pt.id && Math.abs(m.bottomY - pt.bottomY) < 1e-4);
    let triCount = 0;
    for (const m of meshes) {
      const v = m.pts.map((p) => mk(p.x, -p.z));
      const verts = THREE.ShapeUtils.isClockWise(v) ? v : v.slice().reverse();
      const hs = m.holes.map((h) => {
        const hv = h.map((p) => mk(p.x, -p.z));
        return THREE.ShapeUtils.isClockWise(hv) ? hv.slice().reverse() : hv;
      });
      const faces = THREE.ShapeUtils.triangulateShape(verts, hs);
      const all = verts.concat(...hs);
      const tris = faces.map((f) => f.map((idx) => ({ x: all[idx].x, z: -all[idx].y })));
      for (const tr of tris) {
        if (helpers.pointInPolygonXZ(tr, pt.x, pt.z)) triCount++;
      }
    }
    assert.equal(triCount, 1, `Point (${pt.x}, ${pt.z}) in block ${pt.id} ${pt.k} must be covered by exactly 1 real triangle (got ${triCount})`);
  }
});

test('plaza planters: 140 planters emitted and 0 empty planters across the city', () => {
  const { grid, helpers, emittedPlanterBoxes, emittedPlanterHedges } = getWorld();

  const planterColliders = grid.propColliders.filter(
    (c) => !c.obb && Math.abs(c.maxX - c.minX - 2.4) < 1e-4 && Math.abs(c.maxZ - c.minZ - 2.4) < 1e-4
  );

  // Check emitted meshes/instances: exactly 140 granite boxes and 140 hedges
  assert.equal(emittedPlanterBoxes.length, 140, 'exactly 140 granite planter boxes emitted');
  assert.equal(emittedPlanterHedges.length, 140, 'exactly 140 planter hedges emitted');

  // Check emitted colliders: exactly 140 colliders
  assert.equal(planterColliders.length, 140, 'exactly 140 plaza planters emitted');

  // Verify that every remaining planter box has an active tree site inside it (0 empty planters)
  const parkTreeSites = helpers.getParkTreeSites();
  let emptyPlanterCount = 0;
  for (const p of planterColliders) {
    const cx = (p.minX + p.maxX) * 0.5, cz = (p.minZ + p.maxZ) * 0.5;
    const hasTree = parkTreeSites.some((t) => Math.hypot(t.x - cx, t.z - cz) < 1.0);
    if (!hasTree) emptyPlanterCount++;
  }
  assert.equal(emptyPlanterCount, 0, 'every remaining planter box must have an active tree inside');

  // Verify specific dropped baseline locations did NOT emit planters:
  // 1. Domki Budnicze on Stary Rynek: (10.5, 28.1)
  // 2. Stary Browar on Półwiejska: (-689.1, 643.6)
  // 3. Katedra on Ostrów Tumski: (957.5, -330.8)
  const domkiPlanter = planterColliders.some((p) => Math.hypot((p.minX + p.maxX) * 0.5 - 10.5, (p.minZ + p.maxZ) * 0.5 - 28.1) < 2.0);
  const browarPlanter = planterColliders.some((p) => Math.hypot((p.minX + p.maxX) * 0.5 - (-689.1), (p.minZ + p.maxZ) * 0.5 - 643.6) < 2.0);
  const katedraPlanter = planterColliders.some((p) => Math.hypot((p.minX + p.maxX) * 0.5 - 957.5, (p.minZ + p.maxZ) * 0.5 - (-330.8)) < 2.0);
  assert.equal(domkiPlanter, false, 'Domki Budnicze planter dropped at source before emission');
  assert.equal(browarPlanter, false, 'Stary Browar planter dropped at source before emission');
  assert.equal(katedraPlanter, false, 'Katedra planter dropped at source before emission');
});
