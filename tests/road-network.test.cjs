const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');

// A city with no Manhattan grid (no avenues or streets): the network comes from GEO.roadGraph alone
function buildPureGraph(roadGraph) {
  const config = {
    ALL_AVENUES: [], ALL_STREETS: [], AVENUES: [], STREETS: [], BLOCKS: [], SIGNAL_SITES: [],
    CITY_BOUNDS: { minX: -200, maxX: 600, minZ: -200, maxZ: 400 },
    isLand: () => true
  };
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

test('the road network builds from the centreline graph alone when there is no grid', () => {
  const net = buildPureGraph(syntheticGraph());
  assert.equal(net.nodes.length, 12);
  assert.equal(net.edges.length, 34); // 17 two-way links
  assert.ok(net.nodes.every((n) => n.general && n.sideCount >= 4 && n.groupCount >= 2));
  assert.ok(net.edges.every((e) => e.general && e.lanes.length && e.inArm && e.outArm));
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

test('three travel lanes make a narrow road major', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) if (l[2] === 1) l[4] = 3;
  assert.ok(along(buildPureGraph(graph), 120).every((e) => e.major));
});
