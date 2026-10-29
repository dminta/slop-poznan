const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const { buildTrackGraph, TramPath } = loadModule(readFileSync(join(__dirname, '../js/trams.js'), 'utf8'), {
  imports: {
    'three/webgpu': {}, './geodata.js': { GEO: {} }, './city-config.js': {},
    './tsl-materials.js': {}, './actor-models.js': {}, './vehicle-lights.js': {}
  }
});
let GEO, graph;
test.before(async () => {
  ({ GEO } = await import('../js/geodata.js'));
  graph = buildTrackGraph(GEO.rail);
});
const at = (node, point) => Math.hypot(node.x - point[0], node.z - point[1]) < 0.2;

function checkLoop(arrival, departure, terminal, refs) {
  const inbound = graph.edges.find((e) => at(e.to, arrival) && e.routes.length);
  assert.ok(inbound, `${terminal}: arrival track exists`);
  assert.deepEqual(inbound.routes.map((i) => GEO.tramRoutes[i].ref).sort(), refs.slice().sort());
  for (const route of inbound.routes) {
    for (const random of [0, 0.999]) {
      let edge = inbound;
      for (let i = 0; !at(edge.to, departure) && i < 8; i++) {
        const next = edge.next.filter((e) => e.routes.includes(route));
        assert.equal(next.length, 1, `${terminal}: line ${GEO.tramRoutes[route].ref} has one loop to its departure stop`);
        edge = next[0];
      }
      assert.ok(at(edge.to, departure), `${terminal}: the loop visits the actual departure stop`);
      const path = new TramPath(GEO.tramRoutes);
      path.route = route;
      path.reset(inbound, inbound.len - 0.1, 0, () => random);
      path.extend(250, () => random);
      assert.ok(path.edges.slice(0, path.n).some((e) => at(e.from, departure)));
      assert.equal(GEO.tramRoutes[path.route].ref, GEO.tramRoutes[route].ref, 'the tram keeps its line after turning');
      assert.equal(GEO.tramRoutes[path.route].from, terminal);
      assert.notEqual(GEO.tramRoutes[path.route].to, terminal);
    }
  }
}

test('Zawady line 5 uses the loop through its departure stop and turns onto the return route', () => {
  checkLoop([1635.7, -502.7], [1650.1, -561.4], 'Zawady', ['5']);
});

test('Ogrody lines use the main loop through their departure stop, avoiding the siding and bypass', () => {
  checkLoop([-3501.3, -945.7], [-3475.8, -870.5], 'Ogrody', ['2', '7', '8', '18']);
});

test('Starołęka routes continue across the detail boundary in both directions', () => {
  const inbound = graph.edges.find((e) => at(e.to, [695.5, 2718.1]) && e.routes.length);
  const outbound = graph.edges.find((e) => at(e.from, [699.2, 2719.4]) && e.routes.length);
  assert.ok(inbound && outbound);
  assert.deepEqual(inbound.routes.map((i) => GEO.tramRoutes[i].ref).sort(), ['12', '13', '7']);
  for (const route of inbound.routes) {
    const next = inbound.next.filter((e) => e.routes.includes(route));
    assert.equal(next.length, 1, 'a route must not disappear before the boundary');
    assert.ok(next[0].to.z > GEO.frame.detailBox[3], 'the route reaches beyond the detail box');
  }
  for (const route of outbound.routes) {
    const previous = outbound.prev.filter((e) => e.routes.includes(route));
    assert.equal(previous.length, 1, 'the return route begins outside the boundary');
    assert.ok(previous[0].from.z > GEO.frame.detailBox[3]);
  }
});
