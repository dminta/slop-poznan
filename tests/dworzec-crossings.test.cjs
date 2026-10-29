const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Rendering is inert, but the grid's curb/median footprints and live plaza/park sites feed the next builders as in
// main.js. A bare road graph can accept a crossing that the raised median's traffic footprint later closes.
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

test('the western Dworzec refuge stays walkable with the actual curbs and furniture', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const quiet = { info() {}, log() {}, warn() {} };
  const load = (name, imports, extra = '') => loadModule(source(name) + extra, {
    imports,
    globals: { console: quiet, document: inert() },
    filename: name + '.js'
  });
  const rendering = {
    'three/webgpu': inert(),
    'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    './tsl-materials.js': inert()
  };
  const road = load('road-network', { './city-config.js': config, './geodata.js': { GEO } });
  // loadModule returns exported lets by value. Read the populated values after the grid reassigns them.
  const gridModule = load('city-grid', { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }');
  const grid = gridModule.buildCityGrid(inert());
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };
  const street = load('street-details', {
    ...rendering,
    './city-config.js': config,
    './road-network.js': road,
    './city-grid.js': liveGrid,
    './trees.js': { createTreeField: () => ({ group: inert() }) }
  }).buildStreetDetails(inert());
  const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  const blockedRefuges = road.buildRoadNetwork(grid.sidewalks, [
    ...grid.footprints.map((r) => ({ ...r, walkable: false })), ...street.footprints
  ]);
  const lanes = (net) => Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  assert.deepEqual(lanes(network), lanes(blockedRefuges), 'opening pedestrian refuges preserves every car lane');
  const { createPedestrianRoutes } = load('pedestrian-routes', { './road-network.js': road });
  const routes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  const before = createPedestrianRoutes(blockedRefuges, config.blockAt, gridModule.railClearance);
  const key = (c) => `${c.node.x},${c.node.z},${c.side}`;
  const originalCrossings = new Set(Array.from(before.crosswalks, key));
  const restored = routes.crosswalks.filter((c) => !originalCrossings.has(key(c)));
  const node = network.nodes.find((n) => Math.hypot(n.x + 1592.6, n.z - 579.6) < 1);
  assert.ok(node, 'the western Roosevelta / Most Dworcowy approach is in the drivable network');
  const crossings = routes.crosswalks.filter((c) => c.node === node &&
    Math.hypot((c.ax + c.bx) / 2 + 1588.93, (c.az + c.bz) / 2 - 562.39) < 1);
  assert.ok(crossings.length > 0, 'the crossing onto the existing western refuge is usable');
  for (const crossing of restored) {
    for (const track of crossing.tracks) {
      for (const end of [0, 1]) {
        const x = track.ax + track.ux * track.len * end;
        const z = track.az + track.uz * track.len * end;
        assert.ok(config.blockAt(x, z) || track.refuge?.[end]?.length, 'the walk reaches a curb island or refuge');
        if (!track.cramped?.[end]) {
          // Pedestrians wait KERB=1.6 m from the track endpoint, towards the carriageway.
          const direction = end ? -1 : 1;
          const waitX = x + track.ux * direction * 1.6;
          const waitZ = z + track.uz * direction * 1.6;
          assert.ok(gridModule.railClearance(waitX, waitZ, 3) >= 2, 'the waiting point stays 2 m off the rails');
        }
      }
    }
  }
});
