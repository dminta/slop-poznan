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
    construct: () => inert()
  });
}

test('furnished road network keeps SCC-restored streets and re-enabled signal plans', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const rendering = {
    'three/webgpu': inert(),
    'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    './tsl-materials.js': inert()
  };
  const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };

  const road = loadModule(source('road-network'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals
  });
  const gridModule = loadModule(
    source('city-grid') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks, railClearance }; }',
    { imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals }
  );
  const grid = gridModule.buildCityGrid(inert());
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };
  const street = loadModule(source('street-details'), {
    imports: {
      ...rendering,
      './city-config.js': config,
      './road-network.js': road,
      './city-grid.js': liveGrid,
      './trees.js': { createTreeField: () => ({ group: inert() }) }
    },
    globals
  }).buildStreetDetails(inert());

  config.resetSignalPlans();
  const bare = road.buildRoadNetwork([], []);
  const furnished = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);

  assert.ok(
    furnished.edges.length >= bare.edges.length - 5,
    `expected furnished edges (${furnished.edges.length}) within 5 of bare (${bare.edges.length})`
  );

  // Restored road clusters from the SCC audit must remain in the furnished network.
  const requiredStreets = [
    ['Dąbrowskiego', -3945.6, -1250.5],
    ['Wiejska', 2756.3, -1488.6],
    ['Szelągowska', 418.6, -993.8],
    ['gen. St. Maczka', -1107.6, -1853.7],
    ['Szeherezady', -6863.2, -136.1]
  ];
  for (const [label, tx, tz] of requiredStreets) {
    const found = furnished.edges.some((e) => {
      const mx = (e.from.x + e.to.x) * 0.5;
      const mz = (e.from.z + e.to.z) * 0.5;
      return Math.hypot(mx - tx, mz - tz) < 60;
    });
    assert.ok(found, `${label} near (${tx}, ${tz}) must remain in furnished.edges`);
  }

  const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
    imports: { './road-network.js': road },
    globals
  });
  const pedRoutes = createPedestrianRoutes(furnished, config.blockAt, liveGrid.railClearance);
  const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
  vm.runInNewContext(`(${configure})`, {
    nodes: furnished.nodes,
    pedRoutes,
    KERB: 1.6,
    signalNodes: [],
    configurePedestrianSignal: config.configurePedestrianSignal,
    configureSignalClearance: config.configureSignalClearance
  })();

  for (const idx of [63, 103, 125, 132, 140, 153, 233, 363, 415, 473, 477]) {
    assert.ok(!config.SIGNAL_PLANS[idx].disabled, `SIGNAL_PLANS[${idx}] must remain enabled`);
  }
});
