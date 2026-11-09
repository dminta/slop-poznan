const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(), construct: () => inert()
  });
}
const source = (name) => readFileSync(join(__dirname, '../js', `${name}.js`), 'utf8');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('seeded species assignment preserves the full built city tree sites and colliders', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const road = loadModule(source('road-network'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } }
  });
  const stub = inert();
  let crosswalkClearance;
  const movedSites = [];
  const captureTreeAudit = (check, moved) => {
    if (check) crosswalkClearance = check;
    if (moved) movedSites.push(moved);
  };
  const globals = { captureTreeAudit, document: stub, console: { info() {}, warn() {}, log() {} } };
  const rendering = { 'three/webgpu': stub, 'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub, './tsl-materials.js': stub };
  const gridModule = loadModule(source('city-grid') +
    '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }', {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals
  });
  const grid = gridModule.buildCityGrid(stub);
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };
  const bld = loadModule(source('buildings'), { imports: { ...rendering, './balconies.js': stub, './roofs.js': stub,
    './city-config.js': config, './geodata.js': { GEO }, './city-grid.js': liveGrid }, globals }).buildCityBlocks(stub);
  let sites;
  const details = loadModule(source('street-details')
    .replace('const TREE_SP = 15;', 'captureTreeAudit(clearOfCrosswalks); const TREE_SP = 15;')
    .replace('treePlacement.moved++;', 'treePlacement.moved++; captureTreeAudit(null, { x, z });'), { imports: { ...rendering, './city-config.js': config,
    './road-network.js': road, './city-grid.js': liveGrid,
    './trees.js': { createTreeField: (_scene, trees) => { sites = trees; return { group: stub }; } } }, globals
  }).buildStreetDetails(stub, { buildingColliders: bld.colliders, grid });
  const { auditStreetTrees } = await import('../tools/audit-street-tree-clearance.mjs');
  const routes = loadModule(source('pedestrian-routes'), { imports: { './road-network.js': road } })
    .createPedestrianRoutes(details.roadNetwork, config.blockAt, gridModule.railClearance);
  const clearance = auditStreetTrees({ sites, network: details.roadNetwork, routes, config,
    clearOfCrosswalks: crosswalkClearance, grid, details, movedSites });
  assert.deepEqual(clearance.counts, { landing: 0, zebra: 0, lane: 0, island: 0 });
  assert.ok(clearance.minMovedTreeDistance >= 3.5, 'moved trees keep clear of every other street tree');
  // The west expansion adds a 0.331 m pair at a tight new-street corner; Etap 2 adds another at 0.325 m.
  assert.ok(clearance.minTreeDistance >= 0.325, 'no new pair closer than the west-extension minimum');
  const { treeSpecies } = loadModule(source('trees'), { imports: { 'three/webgpu': stub, './tsl-materials.js': stub, './city-config.js': config }, globals });
  const before = [0, 0, 0, 0], after = [0, 0, 0, 0];
  const siteHash = digest(sites);
  for (const site of sites) { before[site.species || 0]++; after[treeSpecies(site)]++; }
  assert.equal(digest(sites), siteHash, 'assignment must not mutate sites');
  const meshCount = (pick) => {
    const types = new Set();
    for (const t of sites) {
      const cell = `${Math.floor(t.x / 200)},${Math.floor(t.z / 200)}`;
      const hash = Math.sin(t.x * 127.1 + 5.9 * 311.7 + t.z * 74.7) * 43758.5453;
      const variant = hash - Math.floor(hash) < 0.5 ? 0 : 1;
      const species = pick(t);
      for (const lod of [0, 1, 2]) types.add(`${cell}/${species}/${lod}/${lod === 2 ? 0 : variant}`);
    }
    return types.size;
  };
  // Street placement and production crossing constants change these pins; park/grid colliders changed only when the
  // Chartowo corridor moved three block 1304 lamps off the new cut curb. The 2026-11-08 railway-island and park
  // facility carve-outs restored blocks and kept mapped sports centres on their OSM lots, and the block anchors
  // (2026-11-08) replaced 30 generic street-tree sites around the newly occupied mall/hall envelopes. The park-building
  // and estate density passes (2026-11-08) changed the building colliders and street-tree sites again. The same day's
  // real OSM positions add 38,588 surveyed trees and remove the procedural rows within 4 m of them; the mapped
  // species tags put 1,989 robinia sites into `before`, so the fourth model is no longer only the position hash's 4%.
  // See docs/observations/railway-building-islands-2026-11-08.md, park-sports-facilities-2026-11-08.md,
  // block-anchors-2026-11-08.md, building-density-investigation-2026-11-08.md, osm-street-trees-2026-11-08.md
  // and missing-objects-recovery-2026-11-08.md. The 2026-11-08 street-buildings fix (fallback lots kept in the world
  // frame and clear of roads and pedestrian streets) moved a few building colliders and planter/tree sites again.
  // The 2026-11-09 object reserve fix (oriented block objects take their own bounds), the fallback frontage check,
  // Zamek and Stadium landmark reserves, and the Królowej Jadwigi building restoration update tree pins. The same
  // day's central frontage pass (Stare Miasto object reserves as 4 m grid rows, no frontage gaps or piece thinning,
  // and the 0.5 m fallback property-line tolerance) moves the pins again.
  assert.deepEqual(before, [45832, 49644, 22032, 1991]);
  assert.deepEqual(after, [43957, 47576, 21123, 6843]);
  assert.equal(siteHash, 'b826fc5320e44e5133ff0a3217ee97fcf02df6c72e10eb2d3d8bc5edb2045ee2');
  assert.equal(digest(grid.propColliders), '47a6c14dc68bbc1af16401871a15079f70273d9484ee826f45576f18a102a6c4');
  assert.equal(digest(details.colliders), 'c6dd68e1e366347db8eca458c9648f50a72d88a9762230feae2e05a3a1fe02f6');
  assert.equal(meshCount((t) => t.species || 0), 25481);
  assert.equal(meshCount(treeSpecies), 30368);
  // Every surveyed node the clearance rules accept reaches the field exactly at its OSM position. The rest are dropped
  // where a wall, lane, track, water or building doorway leaves no room, rather than moved off the surveyed point.
  const osm = sites.filter((t) => t.source === 'osm');
  assert.equal(osm.length, 33074);
  assert.ok(osm.every((t) => t.tier === 0 || (t.pitRot !== undefined && Number.isFinite(t.pitRot))));
  assert.ok(osm.every((t) => Number.isFinite(t.x) && Number.isFinite(t.z) && t.scale >= 0.55 && t.scale <= 1.3));
});

// Exercise the real field's transform, allocation and regrouping with cheap stand-ins for the generated geometries.
test('createTreeField preserves each site matrix across species', () => {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    distanceToSquared(v) { return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2; }
  }
  class Group {
    constructor() { this.children = []; this.userData = {}; }
    add(child) { this.children.push(child); }
    traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
  }
  class Attribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
    clearUpdateRanges() {}
    addUpdateRange() {}
  }
  class Geometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    setIndex(index) { this.index = index; }
  }
  class Mesh extends Group {
    constructor(geometry, _material, capacity) {
      super(); this.geometry = geometry; this.instanceMatrix = new Attribute(new Float32Array(capacity * 16), 16);
    }
    computeBoundingSphere() { this.boundingSphere = { radius: 1 }; }
  }
  class Object3D {
    constructor() {
      this.position = new Vector3(); this.rotation = new Vector3(); this.scale = new Vector3();
      this.matrix = { toArray: (out, offset) => out.set(this.values, offset) };
    }
    updateMatrix() {
      this.values = [this.position.x, this.position.y, this.position.z, this.rotation.y,
        this.scale.x, this.scale.y, this.scale.z, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    }
  }
  class Color { setHex() { this.r = this.g = this.b = 1; return this; } multiplyScalar() { return this; } }
  const geometry = () => ({ attributes: {}, index: null, boundingBox: { min: { y: 0 }, max: { y: 12 } },
    boundingSphere: { radius: 1 }, userData: { triangles: 0, cards: 0 } });
  const fakeGeometries = () => [geometry(), geometry(), geometry()];
  const code = source('trees').replace('const atlas = createLeafAtlas();', 'const atlas = { texture: {}, tileMeters: [] };')
    .replace('buildTreeGeometries(s, v, atlas.tileMeters)', 'fakeGeometries(s, v, atlas.tileMeters)');
  const { createTreeField, treeSpecies } = loadModule(code, {
    imports: { 'three/webgpu': { Vector3, Group, Object3D, Color, BufferGeometry: Geometry,
      InstancedBufferAttribute: Attribute, InstancedMesh: Mesh }, './tsl-materials.js': { createTreeMaterial: () => ({}) },
      './city-config.js': { SPECIES_CROWN_R: [4.53, 4.74, 6.07, 4.55] } },
    globals: { fakeGeometries }
  });
  const sites = [{ x: 10, y: 0.22, z: 130, scale: 0.8, sx: 0.7 },
    { x: 40, y: 1, z: 125, scale: 1.1, yaw: 0.6, sz: 0.8 }];
  const matrices = [];
  for (let species = 0; species < 4; species++) {
    const input = sites.map((site) => ({ ...site, species }));
    assert.deepEqual(input.map(treeSpecies), [species, species]);
    const field = createTreeField({ onBeforeRender() {} }, input);
    const active = Array.from(field.meshes).filter((mesh) => mesh.count);
    assert.equal(active.reduce((n, mesh) => n + mesh.count, 0), sites.length);
    const records = active.flatMap((mesh) => Array.from({ length: mesh.count }, (_, i) =>
      Array.from(mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16))));
    records.sort((a, b) => a[0] - b[0]);
    matrices.push(records);
  }
  for (const actual of matrices.slice(1)) assert.deepEqual(actual, matrices[0]);
  assert.deepEqual(matrices[0].map((m) => [m[0], m[2]]), [[10, 130], [40, 125]]);
});
