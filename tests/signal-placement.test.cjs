const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
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

let world;
test.before(async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const rendering = {
    'three/webgpu': inert(), 'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert()
  };
  const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };
  const road = loadModule(source('road-network'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } }, globals
  });
  const gridModule = loadModule(source('city-grid') +
    '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }', {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals
  });
  const grid = gridModule.buildCityGrid(inert());
  const heads = [], facings = [];
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };
  const imports = { ...rendering, './city-config.js': config, './road-network.js': road,
    './city-grid.js': liveGrid, './trees.js': { createTreeField: () => ({ group: inert() }) } };
  // The former export kept just the park bounds. Replaying that input reproduces the missing head without
  // changing signal code or disabling the real rail, curb, landing and roadway checks.
  const baseline = loadModule(source('street-details'), {
    imports: { ...imports, './city-grid.js': { ...liveGrid,
      pavedPlazaRects: Array.from(liveGrid.pavedPlazaRects, ({ ring, ...bounds }) => bounds) } }, globals
  }).buildStreetDetails(inert());
  const street = loadModule(source('street-details').replace('          s1Matrices.push(m);',
    '          heads.push({ site, a, p, group0 });\n          s1Matrices.push(m);'
  ).replace('    dummy.rotation.set(0, Math.atan2(fx, fz), 0);',
    '    facings.push({ x, y, z, fx, fz });\n    dummy.rotation.set(0, Math.atan2(fx, fz), 0);'), {
    imports, globals: { ...globals, heads, facings }
  }).buildStreetDetails(inert());
  const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
    imports: { './road-network.js': road }, globals
  });
  world = { createPedestrianRoutes, network, config, GEO, road, gridModule, grid, street, heads, baseline, facings };
});

test('the live Krucza approach has a correctly facing head without changing the furnished road network', () => {
  const { network, heads, facings, config, gridModule, street, baseline, grid, road, createPedestrianRoutes } = world;
  const node = network.nodes.find((n) => Math.hypot(n.x - 699.25, n.z - 2750.75) < 1);
  const edge = node.in.find((e) => e.inArm.ux < -0.9 && e.inArm.uz < -0.2);
  assert.ok(edge, 'the actual western Krucza approach remains drivable');
  const head = heads.find((h) => h.site.timing === node.signalTiming &&
    h.a.ux * edge.inArm.ux + h.a.uz * edge.inArm.uz > 0.98);
  assert.ok(head, 'the actual western Krucza approach has a vehicle head');
  const rendered = facings.find((f) => f.y === 3.55 &&
    Math.hypot(f.x - head.p.x - head.a.ux * 0.18, f.z - head.p.z - head.a.uz * 0.18) < 0.001);
  assert.ok(rendered && rendered.fx * edge.inArm.ux + rendered.fz * edge.inArm.uz > 0.98,
    'the actual rendered lens faces the approaching lane');
  assert.equal(head.group0, edge.axisIndex === 0, 'lens uses the incoming lane signal group');
  assert.ok(gridModule.railClearance(head.p.x, head.p.z, 20) >= 2.22, 'pole keeps 2 m beyond its rail footprint');
  assert.ok(config.roadClearance(head.p.x, head.p.z) >= 0.8, 'pole stays clear of the roadway');
  const pole = street.footprints.find((r) => r.kind === 'signal' &&
    Math.hypot((r.minX + r.maxX) / 2 - head.p.x, (r.minZ + r.maxZ) / 2 - head.p.z) < 0.01);
  assert.ok(pole, 'the pole participates in physical collision and network building');
  const localPoles = street.footprints.filter((r) => r.kind === 'signal' &&
    Math.hypot((r.minX + r.maxX) / 2 - 675, (r.minZ + r.maxZ) / 2 - 2738) < 45);
  const without = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...baseline.footprints]);
  const lanes = (net) => Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  assert.deepEqual(lanes(network), lanes(without), 'the restored signal poles preserve every drivable lane');
  const crossings = (net) => Array.from(createPedestrianRoutes(net, config.blockAt, gridModule.railClearance).crosswalks,
    (c) => [c.ax, c.az, c.bx, c.bz]);
  assert.deepEqual(crossings(network), crossings(without), 'every actual pedestrian crossing remains usable');
  assert.equal(localPoles.length, 1, 'the scoped restoration adds one pole');
});

test('restoring the head leaves other furniture unchanged and retains the park exclusion elsewhere', () => {
  const { street, baseline } = world;
  assert.equal(street.vehicleHeads, baseline.vehicleHeads + 1);
  assert.equal(street.audioSignals.length, baseline.audioSignals.length + 1);
  const nonSignals = (details) => JSON.stringify(details.footprints.filter((r) => r.kind !== 'signal'));
  assert.equal(nonSignals(street), nonSignals(baseline), 'all non-signal footprints retain their locations');
});
