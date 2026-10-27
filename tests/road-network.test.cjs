const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');

// The network comes from GEO.roadGraph alone
function buildPureGraph(roadGraph) {
  const config = { BLOCKS: [], SIGNAL_SITES: [], isLand: () => true };
  const { buildRoadNetwork } = loadModule(source, {
    imports: { './city-config.js': config, './geodata.js': { GEO: { roadGraph } } },
    globals: { console: { info() {} } },
    filename: 'road-network.js'
  });
  return buildRoadNetwork([], []);
}

// Three east-west roads over four north-south ones, 120 m apart. Links: [a, b, nameIdx, w, lanes, dir, inner]
function syntheticGraph() {
  const nodes = [];
  for (const z of [0, 120, 240]) for (const x of [0, 120, 240, 360]) nodes.push(x, z);
  const id = (col, row) => row * 4 + col;
  const names = ['MAIN ST', 'SIDE ST', 'GAP ST', 'CROSS ST'];
  const links = [];
  // MAIN ST: 18 m except one 10 m stretch (major over 2/3 of its length); SIDE ST: 9 m, a lane each way; GAP ST: no
  // width on its first link, 16 m on the others
  [[18, 18, 10], [9, 9, 9], [0, 16, 16]].forEach((widths, row) => {
    widths.forEach((w, col) => links.push([id(col, row), id(col + 1, row), row, w, 2, 0, []]));
  });
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 2; row++) links.push([id(col, row), id(col, row + 1), 3, 9, 2, 0, []]);
  }
  return { nodes, links, names };
}

const near = (a, b) => Math.abs(a - b) < 1e-6;
const along = (net, z) => net.edges.filter((e) => near(e.dz, 0) && near(e.z0, z));

test('the road network builds from the centreline graph', () => {
  const net = buildPureGraph(syntheticGraph());
  assert.equal(net.nodes.length, 12);
  assert.equal(net.edges.length, 34); // 17 two-way links
  assert.ok(net.nodes.every((n) => n.sideCount === n.arms.length && n.sideCount >= 2 && n.groupCount >= 2));
  assert.ok(net.edges.every((e) => e.lanes.length && e.inArm && e.outArm));
});

test('major roads come from width and lanes, over most of a named road', () => {
  const net = buildPureGraph(syntheticGraph());
  const main = along(net, 0);
  assert.equal(main.length, 6);
  assert.ok(main.every((e) => e.major && e.axis === 'ave'), 'the 10 m stretch of a mostly 18 m road stays major');
  const side = along(net, 120);
  assert.equal(side.length, 6);
  assert.ok(side.every((e) => !e.major && e.axis === 'st'));
  assert.ok(net.edges.filter((e) => near(e.dx, 0)).every((e) => !e.major));
  const gap = along(net, 240);
  assert.ok(gap.every((e) => e.major));
  const unmeasured = gap.filter((e) => Math.min(e.x0, e.x0 + e.dx * e.span) < 1);
  assert.equal(unmeasured.length, 2);
  assert.ok(unmeasured.every((e) => e.half === 8), 'a link with no width takes its road\'s median width');
});

test('edges carry their link\'s speed limit, 50 km/h where it has none', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) if (l[2] === 1) l.push(0, 30); // SIDE ST: a 30 zone (flags 0, 30 km/h)
  const net = buildPureGraph(graph);
  assert.ok(along(net, 120).every((e) => near(e.limit, 30 / 3.6)));
  assert.ok(along(net, 0).every((e) => near(e.limit, 50 / 3.6)));
});

test('bike lane flags reach both directions\' curbs and the paint edges', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) if (l[2] === 1) l.push(8, 50); // SIDE ST: a bike lane right of a -> b (east)
  const net = buildPureGraph(graph);
  const side = along(net, 120);
  const east = side.filter((e) => e.dx > 0);
  const west = side.filter((e) => e.dx < 0);
  assert.ok(east.length && east.every((e) => !e.bike[0] && e.bike[1]), 'eastbound: on its right');
  assert.ok(west.length && west.every((e) => e.bike[0] && !e.bike[1]), 'westbound: on its left');
  assert.ok(net.paintEdges.filter((e) => near(e.dz, 0) && near(e.z0, 120)).every((e) => e.bike[0] !== e.bike[1]));
  assert.ok(net.edges.filter((e) => near(e.dx, 0)).every((e) => !e.bike[0] && !e.bike[1]));
});

test('three travel lanes make a narrow road major', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) if (l[2] === 1) l[4] = 3;
  assert.ok(along(buildPureGraph(graph), 120).every((e) => e.major));
});

test('lanes follow the OSM lane count and direction within the roadway', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) {
    if (l[2] === 0) l[4] = 4; // MAIN ST: four lanes, two each way
    if (l[2] === 3) { l[3] = 3.4; l[4] = 1; } // CROSS ST: a two-way lane 3.4 m wide
  }
  const net = buildPureGraph(graph);
  const main = along(net, 0).filter((e) => e.half > 8);
  assert.ok(main.length && main.every((e) => e.lanes.length === 2 && near(e.lanes[0], 1.8) && near(e.lanes[1], 5.4)));
  const cross = net.edges.filter((e) => near(e.dx, 0));
  assert.equal(cross.length, 16);
  assert.ok(cross.every((e) => e.lanes.length === 1 && near(e.lanes[0], e.half / 2)), 'each way keeps to its half of a narrow road');
});

// The real Poznań graph on the real land, bare and with the street furniture street-details.js stands along the curbs
// (signal poles, lamps, gas lanterns, hydrants, bollards, kiosks: built here with inert three.js stubs, since only its footprints matter). An
// obstacle within LANE_CLEAR of a lane closes the lane over its whole edge, and a lost one-way edge can take whole
// loops out of the largest strongly connected set, so a big drop with the furniture means a placement or lane geometry
// rule broke (docs/world.md). Measured 2026-10: bare 6925 edges long enough, 4300 (193.8 km) in the set; with the
// furniture (14520 footprints: signal poles, lamps, hydrants, bollards, kiosks, ...) 4294 (193.5 km). The rest of the
// bare graph is mostly cul-de-sacs and roads cut at the detail box.
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

test('most of the Poznań road graph survives the largest strongly connected set, street furniture included', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const logs = [];
  const { buildRoadNetwork, CROSSWALK } = loadModule(source, {
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
  const km = (net) => net.edges.reduce((sum, e) => sum + e.span, 0) / 1000;

  const bare = buildRoadNetwork([], []);
  const counts = /(\d+) long enough, (\d+) in the largest strongly connected set/.exec(logs.join('\n'));
  assert.ok(counts, 'the edge counts are logged');
  assert.equal(Number(counts[2]), bare.edges.length);
  assert.ok(Number(counts[1]) > 6200, `${counts[1]} edges long enough`);
  assert.ok(bare.edges.length > 3850 && km(bare) > 175, `${bare.edges.length} edges, ${km(bare).toFixed(1)} km in the set`);
  assert.ok(bare.nodes.filter((n) => n.signal).length > 150, 'signal sites mark their junctions');
  // OSM speed limits (GEO.roadGraph links): most of the network at the built-up 50 km/h, a good part in 30/20 zones
  const kmAt = (f) => bare.edges.filter((e) => f(Math.round(e.limit * 3.6))).reduce((sum, e) => sum + e.span, 0) / 1000;
  assert.ok(kmAt((v) => v === 50) > 0.4 * km(bare), `${kmAt((v) => v === 50).toFixed(1)} km at 50 km/h`);
  assert.ok(kmAt((v) => v <= 30) > 0.2 * km(bare), `${kmAt((v) => v <= 30).toFixed(1)} km at 30 km/h or less`);
  assert.ok(kmAt((v) => v >= 70) > 3, `${kmAt((v) => v >= 70).toFixed(1)} km at 70 km/h`);

  const { footprints, colliders } = buildStreetDetails(inert());
  assert.ok(footprints.length > 5000, `${footprints.length} street furniture footprints`);
  const furnished = buildRoadNetwork([], footprints);
  assert.ok(km(furnished) > 0.99 * km(bare), `${km(furnished).toFixed(1)} of ${km(bare).toFixed(1)} km survive the furniture`);
  // every piece of it is a player collider too, as small as the thing itself
  assert.equal(colliders.length, footprints.length);
  assert.ok(colliders.every((c) => c.maxX - c.minX < 3 && c.maxZ - c.minZ < 3 && c.maxY > 1 && c.maxY < 10),
    'street furniture colliders are prop-sized');
});
