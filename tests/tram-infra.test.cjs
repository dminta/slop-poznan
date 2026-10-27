const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Tram infrastructure placement (js/tram-infra.js layoutTramInfrastructure) on the real Poznań network, with the street
// furniture street-details.js stands along the curbs (three.js stubbed out, as in road-network.test.cjs). Nothing of
// it is handed to the road network in the app (it is built after it), but platforms and poles must still keep clear of
// the car lanes: fed to the network as obstacles, they must leave its largest strongly connected set almost whole
// (docs/world.md obstacle rule). Measured 2026-10: 4294 edges / 193.5 km with the furniture, 4287 / 193.3 km with the
// tram footprints added; 121 stops (97 islands) from 142 stop nodes, 2200+ poles.
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
    apply: () => inert(),
    construct: () => inert()
  });
}

test('tram stops, platforms and poles keep clear of the car lanes', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const logs = [];
  const { buildRoadNetwork, CROSSWALK } = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info: (line) => logs.push(line) } },
    filename: 'road-network.js'
  });
  const { buildStreetDetails } = loadModule(readFileSync(join(__dirname, '../js/street-details.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config, './road-network.js': { CROSSWALK }, './tsl-materials.js': inert(),
      './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [] }
    },
    globals: { console: { info() {}, log() {}, warn() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
      Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
      document: inert() },
    filename: 'street-details.js'
  });
  const { layoutTramInfrastructure } = loadModule(readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8'), {
    imports: {
      'three/webgpu': {}, 'three/tsl': {}, 'three/addons/utils/BufferGeometryUtils.js': {},
      './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': {}
    },
    globals: { Math, Object, Array, Set, Map, Number, Float64Array },
    filename: 'tram-infra.js'
  });
  const km = (net) => net.edges.reduce((sum, e) => sum + e.span, 0) / 1000;

  const { footprints } = buildStreetDetails(inert());
  const network = buildRoadNetwork([], footprints);
  const layout = layoutTramInfrastructure(network);
  const { stops, poles, spans, arms, laneDist, tracks } = layout;

  assert.ok(stops.length >= 100, `${stops.length} stops`);
  assert.ok(stops.filter((s) => s.kind === 'island').length >= 80, 'most stops get a platform island');
  assert.ok(poles.length > 1500 && spans.length + arms.length > 1000, `${poles.length} poles`);
  for (const s of stops) {
    const rail = GEO.rail[s.railIndex];
    assert.equal(rail.kind, 'tram');
    const tr = tracks.find((t) => t.railIndex === s.railIndex);
    assert.ok(s.s >= 0 && s.s <= tr.len + 1e-6 && Number.isFinite(s.heading) && Math.abs(s.dir) === 1);
    if (rail.oneway) assert.equal(s.dir, 1, `${s.name} runs the one-way track's way`);
    // the platform (or sidewalk stop) is on the right of the travel direction
    assert.equal(s.side, s.dir, `${s.name} platform on the right`);
  }
  assert.ok(poles.every((q) => laneDist(q.x, q.z) >= 2), 'poles keep 2 m from every lane centreline');

  logs.length = 0;
  const withTrams = buildRoadNetwork([], [...footprints, ...layout.footprints]);
  assert.ok(withTrams.edges.length >= network.edges.length - 20, `${network.edges.length} -> ${withTrams.edges.length} edges`);
  assert.ok(km(withTrams) > 0.995 * km(network), `${km(network).toFixed(1)} -> ${km(withTrams).toFixed(1)} km`);
});
