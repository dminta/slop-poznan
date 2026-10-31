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

test('the live Krucza approaches have correctly facing heads without changing the furnished road network', () => {
  const { network, heads, facings, config, gridModule, street, baseline, grid, road, createPedestrianRoutes } = world;
  const node = network.nodes.find((n) => Math.hypot(n.x - 699.25, n.z - 2750.75) < 1);

  // Western approach
  const westEdge = node.in.find((e) => e.inArm.ux < -0.9 && e.inArm.uz < -0.2);
  assert.ok(westEdge, 'the actual western Krucza approach remains drivable');
  const westHead = heads.find((h) => h.site.timing === node.signalTiming &&
    h.a.ux * westEdge.inArm.ux + h.a.uz * westEdge.inArm.uz > 0.98);
  assert.ok(westHead, 'the actual western Krucza approach has a vehicle head');
  const renderedWest = facings.find((f) => f.y === 3.55 &&
    Math.hypot(f.x - westHead.p.x - westHead.a.ux * 0.18, f.z - westHead.p.z - westHead.a.uz * 0.18) < 0.001);
  assert.ok(renderedWest && renderedWest.fx * westEdge.inArm.ux + renderedWest.fz * westEdge.inArm.uz > 0.98,
    'the actual rendered western lens faces the approaching lane');
  assert.equal(westHead.group0, westEdge.axisIndex === 0, 'western lens uses the incoming lane signal group');
  assert.ok(gridModule.railClearance(westHead.p.x, westHead.p.z, 20) >= 2.22, 'western pole keeps 2 m beyond its rail footprint');
  assert.ok(config.roadClearance(westHead.p.x, westHead.p.z) >= 0.8, 'western pole stays clear of the roadway');
  const westPole = street.footprints.find((r) => r.kind === 'signal' &&
    Math.hypot((r.minX + r.maxX) / 2 - westHead.p.x, (r.minZ + r.maxZ) / 2 - westHead.p.z) < 0.01);
  assert.ok(westPole, 'the western pole participates in physical collision and network building');

  // Eastern approach
  const eastEdge = node.in.find((e) => e.inArm.ux > 0.9);
  assert.ok(eastEdge, 'the actual eastern Krucza approach remains drivable');
  const eastHead = heads.find((h) => h.site.timing === node.signalTiming &&
    h.a.ux * eastEdge.inArm.ux + h.a.uz * eastEdge.inArm.uz > 0.98);
  assert.ok(eastHead, 'the actual eastern Krucza approach has a vehicle head');
  const renderedEast = facings.find((f) => f.y === 3.55 &&
    Math.hypot(f.x - eastHead.p.x - eastHead.a.ux * 0.18, f.z - eastHead.p.z - eastHead.a.uz * 0.18) < 0.001);
  assert.ok(renderedEast && renderedEast.fx * eastEdge.inArm.ux + renderedEast.fz * eastEdge.inArm.uz > 0.98,
    'the actual rendered eastern lens faces the approaching lane');
  assert.equal(eastHead.group0, eastEdge.axisIndex === 0, 'eastern lens uses the incoming lane signal group');
  assert.ok(gridModule.railClearance(eastHead.p.x, eastHead.p.z, 20) >= 2.22, 'eastern pole keeps 2 m beyond its rail footprint');
  assert.ok(config.roadClearance(eastHead.p.x, eastHead.p.z) >= 0.8, 'eastern pole stays clear of the roadway');
  const eastPole = street.footprints.find((r) => r.kind === 'signal' &&
    Math.hypot((r.minX + r.maxX) / 2 - eastHead.p.x, (r.minZ + r.maxZ) / 2 - eastHead.p.z) < 0.01);
  assert.ok(eastPole, 'the eastern pole participates in physical collision and network building');

  const localPoles = street.footprints.filter((r) => r.kind === 'signal' &&
    Math.hypot((r.minX + r.maxX) / 2 - 675, (r.minZ + r.maxZ) / 2 - 2738) < 45);
  const without = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...baseline.footprints]);
  const lanes = (net) => Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  assert.deepEqual(lanes(network), lanes(without), 'the restored signal poles preserve every drivable lane');
  const crossings = (net) => Array.from(createPedestrianRoutes(net, config.blockAt, gridModule.railClearance).crosswalks,
    (c) => [c.ax, c.az, c.bx, c.bz]);
  assert.deepEqual(crossings(network), crossings(without), 'every actual pedestrian crossing remains usable');
  assert.equal(localPoles.length, 7, 'the Krucza/Zamenhofa junction has all 7 poles on unblocked park sidewalks');
});

test('restoring park-bordering signal heads leaves other furniture unchanged across the city', () => {
  const { street, baseline, config, gridModule } = world;
  assert.equal(street.vehicleHeads, baseline.vehicleHeads + 154, 'restores 154 vehicle heads across 128 junctions');
  assert.equal(street.audioSignals.length, baseline.audioSignals.length + 276, 'restores 276 pedestrian heads');
  const nonSignals = (details) => JSON.stringify(details.footprints.filter((r) => r.kind !== 'signal'));
  assert.equal(nonSignals(street), nonSignals(baseline), 'all non-signal footprints retain their locations');

  // Verify clearances for all restored signal poles
  const basePoles = new Set(baseline.footprints.filter((r) => r.kind === 'signal')
    .map((r) => `${((r.minX + r.maxX) / 2).toFixed(2)},${((r.minZ + r.maxZ) / 2).toFixed(2)}`));
  const newPoles = street.footprints.filter((r) => r.kind === 'signal' &&
    !basePoles.has(`${((r.minX + r.maxX) / 2).toFixed(2)},${((r.minZ + r.maxZ) / 2).toFixed(2)}`));
  assert.equal(newPoles.length, 276, 'adds exactly 276 restored signal poles');
  for (const p of newPoles) {
    const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
    assert.ok(config.roadClearance(cx, cz) >= 0.8, `pole at ${cx}, ${cz} keeps >= 0.8 m road clearance`);
    assert.ok(gridModule.railClearance(cx, cz, 20) >= 2.22, `pole at ${cx}, ${cz} keeps >= 2.22 m rail clearance`);
  }
});
