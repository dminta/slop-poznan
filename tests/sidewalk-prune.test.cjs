const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert(),
  });
}

test('underpass sidewalk AABBs are not added to grid.sidewalks and do not prune Roosevelta / Most Teatralny', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const rendering = {
    'three/webgpu': inert(),
    'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    './tsl-materials.js': inert(),
  };
  const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };
  const road = loadModule(source('road-network'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals,
  });
  const grid = loadModule(source('city-grid'), {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    globals,
  }).buildCityGrid(inert());

  const underpassBoxes = new Set(
    (config.UNDERPASS_SIDEWALKS || []).map((s) => `${s.minX},${s.maxX},${s.minZ},${s.maxZ}`)
  );
  const leaked = grid.sidewalks.filter((s) => underpassBoxes.has(`${s.minX},${s.maxX},${s.minZ},${s.maxZ}`));
  assert.equal(leaked.length, 0, 'grid.sidewalks must not include UNDERPASS_SIDEWALKS AABBs');

  config.resetSignalPlans();
  const bare = road.buildRoadNetwork([], []);
  const furnished = road.buildRoadNetwork(grid.sidewalks, grid.footprints);

  assert.ok(
    furnished.edges.length >= bare.edges.length - 10,
    `expected furnished edges (${furnished.edges.length}) close to bare (${bare.edges.length})`
  );

  // Roosevelta northbound segment near (-1253.0, -546.1) must remain in the furnished network
  const hasRoosevelta = furnished.edges.some((e) => {
    const midX = (e.from.x + e.to.x) * 0.5;
    const midZ = (e.from.z + e.to.z) * 0.5;
    return Math.hypot(midX - (-1253.0), midZ - (-546.1)) < 40;
  });
  assert.ok(hasRoosevelta, 'Roosevelta carriageway near (-1253.0, -546.1) must not be pruned');

  // Most Teatralny junction (-1373.2, -213.7) must keep >= 3 arms and keep plan 381 enabled
  const nodes = new Set();
  for (const e of furnished.edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  const teatralny = [...nodes].find((n) => Math.hypot(n.x - (-1373.2), n.z - (-213.7)) < 5);
  assert.ok(teatralny, 'Most Teatralny junction (-1373.2, -213.7) must exist');
  assert.ok(teatralny.arms.length >= 3, `Most Teatralny expected >= 3 arms, got ${teatralny.arms.length}`);

  const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
    imports: { './road-network.js': road },
    globals,
  });
  const gridSnap = loadModule(
    source('city-grid') + '\nexport function snapshot() { return { railClearance }; }',
    { imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals }
  );
  const pedRoutes = createPedestrianRoutes(furnished, config.blockAt, gridSnap.snapshot().railClearance);
  const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
  vm.runInNewContext(`(${configure})`, {
    nodes: furnished.nodes,
    pedRoutes,
    KERB: 1.6,
    signalNodes: [],
    configurePedestrianSignal: config.configurePedestrianSignal,
    configureSignalClearance: config.configureSignalClearance,
  })();
  assert.ok(!config.SIGNAL_PLANS[381].disabled, 'SIGNAL_PLANS[381] (Most Teatralny) must remain enabled');
});
