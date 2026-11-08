const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');

function productionFunction(name) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return match[0];
}

function populationHarness(major = true) {
  const state = { blockBuses: false, attempts: 0 };
  let seed = 4242;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const vehicle = (bus) => ({ bus, half: bus ? 6 : 2.25, edge: null, x: 0, z: 0, speed: 0, vx: 0, vz: 0 });
  const cars = Array.from({ length: 200 }, () => vehicle(false));
  const buses = Array.from({ length: 12 }, () => vehicle(true));
  const edges = [-90, -30, 30, 90].map((x) => ({
    sx: x, sz: -300, dx: 0, dz: 1, rx: -1, rz: 0, len: 600, lanes: [0], occ: [[]], major
  }));
  const rebuildOccupancy = () => {
    for (const edge of edges) edge.occ[0].length = 0;
    for (const v of [...cars, ...buses]) if (v.edge) v.edge.occ[v.lane].push({ v, s: v.s });
  };
  const emptyInst = () => ({ count: 0 });
  const context = {
    cars, buses, edges, crossingNodes: [], nearEdges: [], nearCrossings: [],
    nearX: Infinity, nearZ: Infinity, nearLanes: 0, nearTarget: 0, nearBusTarget: 0,
    focusX: 0, focusZ: 0, player: {}, clock: 0,
    Math: Object.assign(Object.create(Math), { random }),
    clamp: (x, min, max) => Math.max(min, Math.min(max, x)),
    NEAR_RADIUS: 350, VEHICLE_RADIUS: 380, VEHICLE_DENSITY: 12, MIN_VEHICLES: 30,
    VEHICLE_SPAWN_DISTANCE: 250, NUM_PEDS: 0,
    updateSignals() {}, updateView() {}, nearView: () => false,
    nearTram: (_x, _z, radius) => state.blockBuses && radius === 9,
    laneAt: (e, i) => e.lanes[i],
    place(v, edge, lane, s) {
      Object.assign(v, { edge, lane, s, x: edge.sx, z: edge.sz + s });
      edge.occ[lane].push({ v, s });
    },
    buildOccupancy: rebuildOccupancy,
    bodyMeshes: [], lightbarList: [], dirtyPaint: new Set(), dirtyState: new Set(),
    litVehicleCount: 0, wheelCars: 0, visibleCars: 0, visibleBuses: 0, visibleBuses18: 0, updates: 3,
    relateToPlayer() {}, drive() {}, locate() {}, knock() {}, pose() {}, updateBusTrailer() {}, renderBus() {}, renderCar() {},
    flagRange() {}, updateTrafficLights() {}, walkedNodes: [], meet() {}, gatherCurbs() {}, indexRoutePeds() {},
    pedCrowd: { begin() {}, end() {} }, updateSparks() {}
  };
  for (const name of ['carWheelLeftInst', 'carWheelRightInst', 'carShadowInst', 'busBodyInst',
    'busHeaderInst', 'busWheelLeftInst', 'busWheelRightInst', 'busShadowInst',
    'bus18FrontInst', 'bus18RearInst', 'bus18BellowsInst', 'bus18SignInst',
    'bus18WheelLeftInst', 'bus18WheelRightInst', 'bus18ShadowInst']) context[name] = emptyInst();
  const pool = source.match(/  const vehicles = [^]*?;/);
  assert.ok(pool, 'production pool declaration is present');
  const cursors = source.slice(source.indexOf('  let lastFocusX ='), source.indexOf('  function update(dt,'));
  const functions = ['refreshNear', 'laneClear', 'park', 'spawnVehicle', 'update'].map(productionFunction).join('\n');
  context.state = state;
  const instrument = `const spawn = spawnVehicle;
    spawnVehicle = (...args) => { state.attempts++; return spawn(...args); };`;
  const h = vm.runInNewContext(`${pool[0]}\n${cursors}\n${functions}\n${instrument}\n({ update, target: () => nearTarget })`, context);
  return { ...h, state, cars, buses, edges, active: () => [...cars, ...buses].filter((v) => v.edge) };
}

test('local density filling includes buses before cars consume the shared target', () => {
  const h = populationHarness();
  for (let frame = 0; frame < 120; frame++) h.update(1 / 60, frame / 60, { x: 0, z: 0 });
  assert.equal(h.active().length, h.target(), 'the shared density target remains unchanged');
  assert.ok(h.buses.some((v) => v.edge), 'available major roads must receive buses without manually placing one');
  assert.equal(h.buses.filter((v) => v.edge).length, Math.ceil(h.target() * h.buses.length / 212),
    'the local mix retains the fleet share instead of filling the target with buses first');
  assert.ok(h.buses.filter((v) => v.edge).every((v) => v.edge.major));
});

test('a teleport repopulates with buses while retaining the shared population cap', () => {
  const h = populationHarness();
  h.update(1 / 60, 0, { x: 0, z: 0 });
  for (const edge of h.edges) edge.sx += 1000;
  for (let frame = 0; frame < 120; frame++) h.update(1 / 60, 1 + frame / 60, { x: 1000, z: 0 });
  assert.equal(h.active().length, h.target());
  assert.ok(h.buses.some((v) => v.edge && Math.abs(v.x - 1000) < 350), 'buses replenish at the new focus');
});

test('a camera jump corrects a full car-only population even when every car remains nearby', () => {
  const h = populationHarness();
  for (let i = 0; i < 30; i++) {
    const edge = h.edges[i % h.edges.length];
    const s = 50 + Math.floor(i / h.edges.length) * 60;
    const v = h.cars[i];
    Object.assign(v, { edge, lane: 0, s, x: edge.sx, z: edge.sz + s });
    edge.occ[0].push({ v, s });
  }
  assert.equal(h.active().length, 30);
  assert.equal(h.buses.filter((v) => v.edge).length, 0);
  h.update(1 / 60, 0, { x: 0, z: 0 });
  assert.equal(h.active().length, h.target(), 'correcting the mix preserves the full shared density target');
  assert.equal(h.cars.filter((v) => v.edge).length, 28);
  assert.equal(h.buses.filter((v) => v.edge).length, 2, 'the jump replaces excess nearby cars with the bus share');
});

test('roads ineligible for buses still fill the shared target with cars', () => {
  const h = populationHarness(false);
  for (let frame = 0; frame < 120; frame++) h.update(1 / 60, frame / 60, { x: 0, z: 0 });
  assert.equal(h.active().length, h.target(), 'failed bus attempts must not reserve empty density slots forever');
  assert.equal(h.buses.filter((v) => v.edge).length, 0);
});

test('a major road too short for a bus does not reserve unusable population slots', () => {
  const h = populationHarness(false);
  Object.assign(h.edges[0], { major: true, len: 21 });
  for (let frame = 0; frame < 120; frame++) h.update(1 / 60, frame / 60, { x: 0, z: 0 });
  assert.equal(h.active().length, h.target());
  assert.equal(h.buses.filter((v) => v.edge).length, 0);
});

test('buses recover after blocked placements without increasing density or the per-frame attempt budget', () => {
  const h = populationHarness();
  h.state.blockBuses = true;
  for (let frame = 0; frame < 120; frame++) {
    h.state.attempts = 0;
    h.update(1 / 60, frame / 60, { x: 0, z: 0 });
    assert.ok(h.active().length <= h.target());
    assert.ok(h.state.attempts <= (frame === 0 ? 212 : 4));
  }
  assert.equal(h.buses.filter((v) => v.edge).length, 0, 'tram clearance initially rejects every bus placement');
  h.state.blockBuses = false;
  for (let frame = 120; frame < 240; frame++) {
    h.state.attempts = 0;
    h.update(1 / 60, frame / 60, { x: 0, z: 0 });
    assert.ok(h.active().length <= h.target());
    assert.ok(h.state.attempts <= 4, 'normal updates keep the existing four-vehicle placement budget');
  }
  assert.equal(h.active().length, h.target());
  assert.ok(h.buses.some((v) => v.edge), 'buses receive places after the obstruction clears at the same focus');
});

test('emergency liveries are distinct and freed slots follow the ordinary mix', () => {
  const start = source.indexOf('    const livery =', source.indexOf('  for (let i = 0; i < NUM_CARS; i++)'));
  const end = source.indexOf('    bodyCounts[bodyType]++;', start);
  assert.ok(start >= 0 && end > start, 'vehicle mix is present');
  const mix = source.slice(start, end);
  const classify = vm.runInNewContext(`(i) => { ${mix} return { livery, isTaxi, bodyType }; }`, {
    PRIVATE_MIX: [['hatch', 0.38], ['estate', 0.24], ['crossover', 0.28], ['van', 0.1]]
  });
  const cars = Array.from({ length: 200 }, (_, i) => classify(i));
  for (const [livery, indices, body] of [[1, [6, 86, 166], 'estate'], [2, [18, 118], 'van'],
    [3, [42], 'fireTruck']]) {
    assert.deepEqual(cars.flatMap((car, i) => car.livery === livery ? [i] : []), indices);
    assert.ok(indices.every((i) => cars[i].bodyType === body && !cars[i].isTaxi));
  }
  for (const i of [46, 126, 68, 168, 142]) {
    assert.equal(cars[i].livery, 0);
    assert.equal(cars[i].isTaxi, i % 8 === 0);
    assert.equal(cars[i].bodyType === 'taxi', i % 8 === 0);
  }
});
