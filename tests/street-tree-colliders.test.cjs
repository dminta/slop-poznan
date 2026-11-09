const assert = require('node:assert/strict');
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

// Build the headless world like tests/tree-distribution.test.cjs, then check that every street tree has a player
// collider. The bug report names Rybaki, so we also assert a local example near those world coordinates.
test('street trees carry player colliders, including Rybaki', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const road = loadModule(source('road-network'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } }
  });
  const stub = inert();
  const globals = { document: stub, console: { info() {}, warn() {}, log() {} } };
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
  const details = loadModule(source('street-details'), { imports: { ...rendering, './city-config.js': config,
    './road-network.js': road, './city-grid.js': liveGrid,
    './trees.js': { createTreeField: (_scene, trees) => { sites = trees; return { group: stub }; } } }, globals
  }).buildStreetDetails(stub, { buildingColliders: bld.colliders, grid });

  // Street trees are the tree sites on the raised sidewalks. The colliders array now carries their trunk boxes.
  // Before 2026-11-04 all of these had no player collider; now every one does, including the 7,207 surveyed OSM
  // positions that stand in a curb row. This fixture omits landmark and bridge walls; the default clearance audit
  // uses the same scope.
  const streetTrees = sites.filter((t) => t.tier === 2 || t.tier === 1 && t.pitRot !== undefined);
  assert.equal(streetTrees.length, 34498, 'street trees in the headless build');
  // Surveyed OSM park trees have no city-grid site of their own, so street-details.js adds their trunk boxes to the
  // same player list as the street rows; count them separately rather than letting them hide a missing street trunk.
  const osmParkTrees = sites.filter((t) => t.source === 'osm' && t.tier === 0).length;
  assert.equal(osmParkTrees, 25824, 'surveyed OSM park trees');

  const colliders = details.colliders;
  const trunkColliders = colliders.filter((c) => c.isTrunk);
  assert.equal(trunkColliders.length, streetTrees.length + osmParkTrees,
    `every street and mapped park tree should have a trunk collider (${streetTrees.length} street + ` +
    `${osmParkTrees} mapped park trees, ${trunkColliders.length} colliders)`);

  // Rybaki runs roughly (-193.5, 642.4) -> (-297, 893); its sidewalk trees stand within a few metres of the curb.
  const rybaki = streetTrees.filter((t) => t.x >= -310 && t.x <= -190 && t.z >= 630 && t.z <= 905);
  assert.ok(rybaki.length > 0, 'expected street trees along Rybaki');
  for (const t of rybaki) {
    const hit = trunkColliders.find((c) => c.minX <= t.x + 0.28 * t.scale && c.maxX >= t.x - 0.28 * t.scale &&
      c.minZ <= t.z + 0.28 * t.scale && c.maxZ >= t.z - 0.28 * t.scale && c.maxY >= 3.2);
    assert.ok(hit, `street tree at ${t.x.toFixed(1)}, ${t.z.toFixed(1)} should have a trunk collider`);
  }
});
