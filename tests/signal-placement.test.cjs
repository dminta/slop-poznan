const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
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
  const heads = [], facings = [], runtimeHeads = [], meshRecords = [], meshTypes = [], testInternals = [], attributeRecords = [];
  const buildingColliders = [];
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
  ).replace('      signalArmPoles.set(a, { site, poles: armPoles, hasHead: false });',
    '      signalArmPoles.set(a, { site, poles: armPoles, hasHead: false, corner });'
  ).replace('        record.hasHead = true;\n        vehicleHeadSites.push({ site, a, p, group0 });',
    '        record.hasHead = true;\n        runtimeHeads.push({ site, a, p, group0, corner: record.corner, poles: record.poles });\n        vehicleHeadSites.push({ site, a, p, group0 });'
  ).replace('      vehicleHeadSites.push({ site, a, p, group0 });\n    }\n    addMatrixArrayInstanced(s1HousingGeo',
    '      runtimeHeads.push({ site, a, p, group0 });\n      vehicleHeadSites.push({ site, a, p, group0 });\n    }\n    addMatrixArrayInstanced(s1HousingGeo'
  ).replace('        g.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(data), size));',
    '        const attr = new THREE.InstancedBufferAttribute(new Float32Array(data), size);\n        attributeRecords.push({ key, size, data: Array.from(data), attr });\n        g.setAttribute(key, attr);'
  ).replace('    const inst = new THREE.InstancedMesh(g, mat, matrices.length);',
    '    meshRecords.push({ geo, matrices: [...matrices], attrs });\n    const inst = new THREE.InstancedMesh(g, mat, matrices.length);'
  ).replace('  function addRuntimeSignalHeads(network, pedRoutes = null) {',
    '  function addRuntimeSignalHeads(network, pedRoutes = null) {\n    testInternals.push(vehicleHeadSites);'
  ).replace('    addMatrixArrayInstanced(s1HousingGeo, signalHousingMat, matrices);',
    '    meshTypes.push({ s1HousingGeo, s1LensGeo, backplateGeo, backplateBorderGeo });\n    addMatrixArrayInstanced(s1HousingGeo, signalHousingMat, matrices);'
  ).replace('    dummy.rotation.set(0, Math.atan2(fx, fz), 0);',
    '    facings.push({ x, y, z, fx, fz });\n    dummy.rotation.set(0, Math.atan2(fx, fz), 0);'), {
    imports, globals: { ...globals, heads, facings, runtimeHeads, meshRecords, meshTypes, testInternals, attributeRecords }
  }).buildStreetDetails(inert(), { buildingColliders });
  const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  const { createPedestrianRoutes } = loadModule(source('pedestrian-routes').replace(
    'return { along, across, next, crosswalks, segments, segmentsNear };',
    'return { along, across, next, crosswalks, segments, segmentsNear, links };'), {
    imports: { './road-network.js': road }, globals
  });
  world = { createPedestrianRoutes, network, config, GEO, road, gridModule, grid, street, heads, baseline, facings, runtimeHeads, meshRecords, meshTypes, testInternals, attributeRecords, buildingColliders };
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
  const withoutSignals = [
    ...grid.footprints,
    ...street.footprints.filter((r) => r.kind !== 'signal'),
    ...baseline.footprints.filter((r) => r.kind === 'signal')
  ];
  const without = road.buildRoadNetwork(grid.sidewalks, withoutSignals);
  const lanes = (net) => Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  assert.deepEqual(lanes(network), lanes(without), 'the restored signal poles preserve every drivable lane');
  const crossings = (net) => Array.from(createPedestrianRoutes(net, config.blockAt, gridModule.railClearance).crosswalks,
    (c) => [c.ax, c.az, c.bx, c.bz]);
  assert.deepEqual(crossings(network), crossings(without), 'every actual pedestrian crossing remains usable');
  assert.equal(localPoles.length, 7, 'the Krucza/Zamenhofa junction has all 7 poles on unblocked park sidewalks');
});

test('exact park polygons restore signal heads and street furniture across the city', () => {
  const { street, baseline, config, gridModule } = world;
  assert.equal(street.vehicleHeads, baseline.vehicleHeads + 154, 'restores 154 vehicle heads across 128 junctions');
  assert.equal(street.audioSignals.length, baseline.audioSignals.length + 276, 'restores 276 pedestrian heads');
  const nonSignals = (details) => details.footprints.filter((r) => r.kind !== 'signal').length;
  assert.equal(nonSignals(street), nonSignals(baseline) + 4649, 'restores 4,649 non-signal street furniture footprints');

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


// This test must be last: it configures the shared network and adds meshes to the shared street fixture.
test('runtime approaches use existing left poles when no right head or pole serves them', () => {
  const { network, street, grid, road, gridModule, config, createPedestrianRoutes, runtimeHeads, facings, heads, meshRecords, meshTypes, testInternals, attributeRecords } = world;
  const cases = [
    [3842.73, 1646.90, 0.911037, -0.412325, 3859.696, 1648.169],
    [2177.60, -2103.13, 0.371391, -0.928477, 2195.702, -2104.292],
    [2005.84, 2631.76, 0.782705, 0.622392, 2010.926, 2650.607],
    [-1503.29, 224.03, -0.999765, 0.021656, -1524.356, 206.256],
    [-839.60, 793.82, -0.330681, 0.943742, -858.505, 791.542],
    [-2263.10, 281.65, -0.538850, 0.842402, -2268.839, 278.142],
    [967.00, 863.48, -0.936642, -0.350289, 965.736, 843.225],
    [-294.30, -336.60, 0.993506, -0.113781, -287.534, -331.939]
  ];
  const footprints = JSON.stringify(street.footprints), colliders = JSON.stringify(street.colliders);
  const audioSignals = Array.from(street.audioSignals, (s) => [s.x, s.y, s.z, s.isAvenue, s.signalTiming]);
  const lanes = (net) => Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  const crossings = (net) => Array.from(createPedestrianRoutes(net, config.blockAt, gridModule.railClearance).crosswalks,
    (c) => [c.ax, c.az, c.bx, c.bz]);
  const originalLanes = lanes(network), originalCrossings = crossings(network), count = street.vehicleHeads;
  const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  const configure = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8').match(/  function configureSignals\([^]*?\n  \}/)[0];
  vm.runInNewContext(`(${configure})`, { nodes: network.nodes, pedRoutes, KERB: 1.6, signalNodes: [],
    configurePedestrianSignal: config.configurePedestrianSignal, configureSignalClearance: config.configureSignalClearance })();
  street.addRuntimeSignalHeads({ nodes: [] });
  const node = network.nodes.find((n) => Math.hypot(n.x - cases[0][0], n.z - cases[0][1]) < 0.03);
  const edge = node.in.find((e) => e.inArm.ux * cases[0][2] + e.inArm.uz * cases[0][3] > 0.9999);
  const fakePlan = { index: -1, alias: { index: -2, alias: node.signalTiming } };
  testInternals[0].push({ site: { timing: fakePlan }, a: edge.inArm, p: { x: node.x, z: node.z } });
  assert.equal(street.addRuntimeSignalHeads({ nodes: [{ ...node, in: [edge] }] }), 0,
    'a head on an alias of the same plan prevents a duplicate');
  testInternals[0].pop();
  const meshStart = meshRecords.length, attributeStart = attributeRecords.length;
  street.addRuntimeSignalHeads(network);
  for (const [x, z, ux, uz, px, pz] of cases) {
    const node = network.nodes.find((n) => Math.hypot(n.x - x, n.z - z) < 0.03);
    assert.ok(node, `runtime node ${x}, ${z}`);
    const edge = node.in.find((e) => e.inArm.ux * ux + e.inArm.uz * uz > 0.9999);
    assert.ok(edge, `incoming edge ${x}, ${z}`);
    const head = runtimeHeads.find((h) => Math.hypot(h.p.x - px, h.p.z - pz) < 0.01);
    assert.ok(head, `head on existing pole at ${px}, ${pz}`);
    if (head.corner !== undefined) {
      const dt = (head.p.x - head.a.x) * head.a.ux + (head.p.z - head.a.z) * head.a.uz - head.corner;
      assert.ok(dt >= 4.79 && dt <= 15.61, `pole setback ${dt} at ${x}, ${z}`);
    }
    assert.ok(street.footprints.some((p) => p.kind === 'signal' &&
      Math.hypot((p.minX + p.maxX) / 2 - px, (p.minZ + p.maxZ) / 2 - pz) < 0.01));
    const facing = facings.find((f) => f.y === 3.55 &&
      Math.hypot(f.x - head.p.x - head.a.ux * 0.18, f.z - head.p.z - head.a.uz * 0.18) < 0.001);
    assert.ok(facing && -facing.fx * edge.dx - facing.fz * edge.dz > 0.98, `facing at ${x}, ${z}`);
    for (const time of [0, 10, 20, 30, 40, 50, 60, 70]) {
      assert.equal(config.signalPhase(time, head.group0, head.site),
        config.signalPhase(time, edge.axisIndex === 0, node), `phase at ${x}, ${z}, time ${time}`);
    }
  }
  const disabled = network.nodes.find((n) => Math.hypot(n.x + 944.85, n.z + 2366.2) < 0.03);
  assert.ok(disabled && !disabled.signal, 'Mieszka I crossing is disabled after pedestrian route configuration');
  for (const [x, z, ux, uz] of [[988.8, -1640.75, -0.903469, -0.428653],
    [341.67, -1972.7, 0.993764, 0.111506]]) {
    const node = network.nodes.find((n) => Math.hypot(n.x - x, n.z - z) < 0.03);
    const edge = node.in.find((e) => e.inArm.ux * ux + e.inArm.uz * uz > 0.9999);
    const endX = edge.sx + edge.dx * edge.len, endZ = edge.sz + edge.dz * edge.len;
    const rightHead = heads.find((h) => h.site.timing.index === node.signalTiming.index &&
      Math.hypot(h.p.x - x, h.p.z - z) < 45 &&
      (h.p.x - endX) * edge.rx + (h.p.z - endZ) * edge.rz > Math.max(...edge.lanes) &&
      -h.a.ux * edge.dx - h.a.uz * edge.dz > 0.82);
    assert.ok(rightHead, `Winogrady at ${x}, ${z} already has a head on the right`);
    for (const time of [0, 10, 20, 30, 40, 50]) {
      assert.equal(config.signalPhase(time, rightHead.group0, rightHead.site),
        config.signalPhase(time, edge.axisIndex === 0, node));
    }
    assert.ok(!runtimeHeads.some((h) => Math.hypot(h.p.x - x, h.p.z - z) < 30));
  }
  const meshes = meshRecords.slice(meshStart), types = meshTypes[meshTypes.length - 1];
  const housing = meshes.filter((m) => m.geo === types.s1HousingGeo);
  const lenses = meshes.filter((m) => m.geo === types.s1LensGeo);
  const plates = meshes.filter((m) => m.geo === types.backplateGeo || m.geo === types.backplateBorderGeo);
  const plateCount = runtimeHeads.filter((h) => h.a.w >= 14.5 || h.a.lanes >= 3).length;
  assert.equal(housing.length, 1);
  assert.equal(housing[0].matrices.length, cases.length);
  assert.equal(lenses.reduce((sum, m) => sum + m.matrices.length, 0), cases.length);
  assert.ok(plateCount > 0);
  assert.equal(plates.length, 2);
  for (const plate of plates) assert.equal(plate.matrices.length, plateCount);
  const indices = lenses.flatMap((m) => Array.from(m.attrs.signalIndex.data)).sort((a, b) => a - b);
  const expectedIndices = runtimeHeads.map((h) => (h.site.timing.index + 0.5) / config.SIGNAL_PLANS.length)
    .sort((a, b) => a - b);
  assert.deepEqual(indices, expectedIndices);
  const attrs = attributeRecords.slice(attributeStart);
  assert.equal(attrs.length, lenses.length);
  assert.ok(attrs.every((a) => a.key === 'signalIndex' && a.size === 1 && a.attr));
  assert.deepEqual(attrs.flatMap((a) => a.data).sort((a, b) => a - b), expectedIndices);
  assert.equal(runtimeHeads.length, cases.length);
  assert.equal(street.vehicleHeads, count + cases.length);
  assert.equal(JSON.stringify(street.footprints), footprints);
  assert.equal(JSON.stringify(street.colliders), colliders);
  assert.deepEqual(Array.from(street.audioSignals, (s) => [s.x, s.y, s.z, s.isAvenue, s.signalTiming]), audioSignals);
  const rebuilt = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  assert.deepEqual(lanes(rebuilt), originalLanes);
  assert.deepEqual(crossings(rebuilt), originalCrossings);
});


test('runtime poles preserve the furnished network and nearby pedestrian routes', () => {
  const { network, street, grid, road, gridModule, config, createPedestrianRoutes, buildingColliders } = world;
  // Block the first otherwise clear runtime site with a wall; the search must use a different site.
  const wall = { minX: 1383.25, maxX: 1383.65, minZ: 559.7, maxZ: 560.1, maxY: 4.5 };
  buildingColliders.push(wall);
  const routes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  routes.segments = () => { throw new Error('runtime placement must not materialise every pedestrian route'); };
  const segmentsNear = routes.segmentsNear, neighbourhoods = new Map();
  routes.segmentsNear = (...args) => {
    const result = segmentsNear(...args), node = args[3];
    if (node && neighbourhoods.has(node)) assert.equal(result, neighbourhoods.get(node));
    if (node) neighbourhoods.set(node, result);
    return result;
  };
  const lanes = (net) => Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  const crossings = (r) => Array.from(r.crosswalks, (c) => [c.ax, c.az, c.bx, c.bz]);
  const localRoutes = (r, p) => {
    const tracks = r.segmentsNear(p.x, p.z, 2);
    const key = (s) => [s.ax, s.az, s.ux, s.uz, s.len].join(',');
    const records = Array.from(tracks, (track) => `segment:${key(track)}`);
    for (const track of tracks) for (const dir of [-1, 1]) {
      const endX = track.ax + (dir > 0 ? track.ux * track.len : 0);
      const endZ = track.az + (dir > 0 ? track.uz * track.len : 0);
      if (Math.hypot(endX - p.x, endZ - p.z) > 42) continue;
      for (const path of r.links(track, dir)) {
        records.push(`${key(track)}:${dir}:` + path.map((leg) =>
          `${key(leg.track)}:${leg.dir}:${leg.hold ? key(leg.hold) : ''}`).join('|'));
      }
    }
    return createHash('sha256').update(records.sort().join('\n')).digest('hex');
  };
  const originalLanes = lanes(network), originalCrossings = crossings(routes);
  const audio = Array.from(street.audioSignals, (s) => [s.x, s.y, s.z, s.isAvenue, s.signalTiming]);
  const oldCount = street.vehicleHeads, oldFootprints = street.footprints.length, oldColliders = street.colliders.length;
  const footprintSnapshot = JSON.stringify(street.footprints), colliderSnapshot = JSON.stringify(street.colliders);
  street.addRuntimeSignalHeads(network, routes);
  assert.ok(street.runtimeHeads.some((h) => h.existing && Math.hypot(h.node.x + 2086.95, h.node.z - 2421.3) < 0.1));
  assert.ok(street.runtimeHeads.some((h) => !h.existing && Math.hypot(h.node.x - 1374.2, h.node.z - 566.1) < 0.1));
  const newPoles = street.runtimeHeads.filter((h) => !h.existing);
  assert.ok(newPoles.length > 0);
  assert.ok(newPoles.every(({ p }) => p.x < wall.minX - 0.15 || p.x > wall.maxX + 0.15 ||
    p.z < wall.minZ - 0.15 || p.z > wall.maxZ + 0.15), 'new poles avoid building colliders');
  assert.equal(street.footprints.length, oldFootprints + newPoles.length);
  assert.equal(street.colliders.length, oldColliders + newPoles.length);
  assert.equal(JSON.stringify(street.footprints.slice(0, oldFootprints)), footprintSnapshot);
  assert.equal(JSON.stringify(street.colliders.slice(0, oldColliders)), colliderSnapshot);
  assert.equal(street.vehicleHeads, oldCount + street.runtimeHeads.length);
  for (const h of street.runtimeHeads) {
    const e = h.edge, x = e.sx + e.dx * e.len, z = e.sz + e.dz * e.len;
    const along = (h.p.x - x) * e.dx + (h.p.z - z) * e.dz;
    const lateral = Math.abs((h.p.x - x) * e.rx + (h.p.z - z) * e.rz);
    assert.ok(along >= -15 && along <= road.STOP_SETBACK + 1e-6, `setback ${along}`);
    assert.ok(lateral >= e.half + 0.6 && lateral <= e.half + 2.6, `curb offset ${lateral - e.half}`);
    assert.ok(-h.a.ux * e.dx - h.a.uz * e.dz > 0.9999);
    assert.equal(h.group0, e.axisIndex === 0);
    assert.ok(config.roadClearance(h.p.x, h.p.z) >= 0.8);
    assert.ok(gridModule.railClearance(h.p.x, h.p.z, 20) >= 2.22);
  }
  assert.deepEqual(Array.from(street.audioSignals, (s) => [s.x, s.y, s.z, s.isAvenue, s.signalTiming]), audio);
  const rebuilt = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  assert.deepEqual(lanes(rebuilt), originalLanes, 'all lanes survive the new footprints');
  const rebuiltRoutes = createPedestrianRoutes(rebuilt, config.blockAt, gridModule.railClearance);
  assert.deepEqual(crossings(rebuiltRoutes), originalCrossings, 'all crossings survive the new footprints');
  for (const { p } of newPoles) {
    assert.equal(localRoutes(rebuiltRoutes, p), localRoutes(routes, p),
      `pedestrian tracks and connections near ${p.x}, ${p.z} are unchanged`);
  }
});
