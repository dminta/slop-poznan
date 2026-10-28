const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

function trafficFunction(name, context) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return vm.runInNewContext(`(${match[0].trim()})`, context);
}

function intersectionHarness() {
  const n = { signal: true, in: [] };
  const exit = { lanes: [0], outSide: 1, setbackFrom: 1.75 };
  const edge = { to: n, axisIndex: 0, occ: [[]], opposite: null, inSide: 0, len: 100, setbackTo: 1.75 };
  const car = { edge, move: { to: exit, out: [0], turn: 'S' }, lane: 0, s: 80, speed: 4,
    driver: { b: 3 }, half: 2.25, wait: 0, commit: null, isPolice: false };
  const state = { phase: 'red', occupied: false, pedestrians: false, space: true, conflict: false, tram: false };
  const context = {
    LOOKAHEAD: 70,
    CROSSWALK: 4.3,
    shortOfZebra: (f) => f.setbackFrom + 4.3 + 0.5,
    phaseOf: () => state.phase,
    canStopBefore: () => true,
    stopAt: () => -3,
    boxBusy: () => state.occupied,
    ahead: () => null,
    connector: () => ({ len: 20 }),
    yieldToCrossTraffic: () => state.conflict,
    pedestrianOn: () => state.pedestrians,
    laneCoord: () => 0,
    timeTo: () => 1,
    room: () => state.space,
    alongside: () => false,
    mergingAhead: () => null,
    tramBlocks: () => state.tram,
    refuse: (v, why) => { v.held = why; return false; },
    PED_COURTESY: 5
  };
  return { car, state, mayEnter: trafficFunction('mayEnter', context), signalAhead: trafficFunction('signalAhead', context) };
}

test('police pass red and amber signals while ordinary cars stop', () => {
  const { car, state, mayEnter, signalAhead } = intersectionHarness();
  for (const phase of ['red', 'amber']) {
    state.phase = phase;
    car.isPolice = false;
    assert.equal(mayEnter(car, 18), false);
    assert.equal(signalAhead(car, car.edge, 18), -3);
    car.isPolice = true;
    assert.equal(mayEnter(car, 18), true);
    assert.equal(signalAhead(car, car.edge, 18), 0);
  }
});

test('red and amber together still holds ordinary cars, but not police', () => {
  const { car, state, mayEnter, signalAhead } = intersectionHarness();
  state.phase = 'redAmber';
  assert.equal(mayEnter(car, 18), false);
  assert.equal(mayEnter(car, 0), false, 'not even waiting at the line');
  assert.equal(signalAhead(car, car.edge, 18), -3);
  car.isPolice = true;
  assert.equal(mayEnter(car, 18), true);
  assert.equal(signalAhead(car, car.edge, 18), 0);
});

test('police still wait for crossing traffic, pedestrians, a tram and a blocked exit', () => {
  const { car, state, mayEnter } = intersectionHarness();
  car.isPolice = true;
  for (const [key, blocked] of [['occupied', true], ['pedestrians', true], ['space', false], ['conflict', true], ['tram', true]]) {
    const initial = state[key];
    state[key] = blocked;
    assert.equal(mayEnter(car, 18), false, key);
    state[key] = initial;
  }
  assert.equal(mayEnter(car, 18), true);
});

test('police running a red yield to fast cross traffic regardless of how long they waited', () => {
  const car = { edge: { axisIndex: 0 }, wait: 20 };
  const lead = { s: 85, v: { speed: 10 } };
  const side = { axisIndex: 1, occ: [[lead]], len: 100 };
  const node = { signal: true, in: [{ axisIndex: 0, occ: [[lead]] }, side] };
  const context = {
    leadOf: (list) => list.at(-1),
    canStopBefore: () => true
  };
  lead.v.half = 2.25;
  context.canStop = trafficFunction('canStop', context);
  const yieldToCrossTraffic = trafficFunction('yieldToCrossTraffic', context);
  assert.equal(yieldToCrossTraffic(car, node), true);
  lead.v.speed = 0;
  assert.equal(yieldToCrossTraffic(car, node), false);
  lead.v.speed = 10;
  lead.s = 10;
  assert.equal(yieldToCrossTraffic(car, node), false);
});

test('left turns account for oncoming police even when their signal is red', () => {
  const edge = { to: { signal: true }, through: 0, len: 100, occ: [] };
  const car = { edge, move: { turn: 'S', out: [0] }, lane: 0, speed: 10, half: 2.25, isPolice: false };
  edge.occ.push([{ v: car, s: 85 }]);
  const context = { phaseOf: () => 'red', leadOf: (list) => list.at(-1) };
  context.canStop = trafficFunction('canStop', context);
  const yieldOncoming = trafficFunction('yieldOncoming', context);
  assert.equal(yieldOncoming(edge, false), false);
  car.isPolice = true;
  assert.equal(yieldOncoming(edge, false), true);
  car.speed = 0;
  assert.equal(yieldOncoming(edge, false), false);
  // red and amber together holds oncoming traffic like red
  context.phaseOf = () => 'redAmber';
  car.speed = 10;
  car.isPolice = false;
  assert.equal(yieldOncoming(edge, false), false);
  context.phaseOf = () => 'green';
  assert.equal(yieldOncoming(edge, false), true);
});

function populationContext() {
  const context = {
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    hasView: true, camX: 0, camY: 10, camZ: 0, visible: () => true,
    focusX: 0, focusZ: 0, player: { active: false },
    clock: 0,
    VEHICLE_SPAWN_DISTANCE: 250, PED_SPAWN_DISTANCE: 150, NEAR_RADIUS: 350,
    VEHICLE_DENSITY: 20, MIN_VEHICLES: 30, vehicles: new Array(212), nearLanes: 0, nearTarget: 0,
    nearEdges: [], nearCrossings: [], track: {}, KERB: 1.6, QUEUE_GAP: 0.62,
    atCurb: () => {}, laneClear: () => true, nearTram: () => false,
    place: (v, e, lane, s) => Object.assign(v, { edge: e, lane, s })
  };
  context.nearView = trafficFunction('nearView', context);
  return context;
}

function straightEdge(z, len = 20) {
  return { sx: 0, sz: z, dx: 0, dz: 1, rx: -1, rz: 0, len, lanes: [0], occ: [[]] };
}

test('cars replenish the road ahead while nearby visible spawning stays blocked', () => {
  const context = populationContext();
  const edge = straightEdge(140);
  context.nearEdges.push(edge);
  const spawnVehicle = trafficFunction('spawnVehicle', context);
  const car = { half: 2.25 };
  assert.equal(spawnVehicle(car, 100, 350, true), false);
  edge.sz = 290;
  assert.equal(spawnVehicle(car, 100, 350, true), true);
  assert.equal(edge.sz + car.s, 300);
  edge.sz = 140;
  context.visible = () => false;
  assert.equal(spawnVehicle(car, 100, 350, true), true);
});

test('buses spawn only on major roads', () => {
  const context = populationContext();
  const edge = straightEdge(250, 100);
  context.nearEdges.push(edge);
  const spawnVehicle = trafficFunction('spawnVehicle', context);
  const bus = { bus: true, half: 6 };
  assert.equal(spawnVehicle(bus, 100, 350, false), false);
  edge.major = true;
  assert.equal(spawnVehicle(bus, 100, 350, false), true);
  assert.equal(bus.edge, edge);
});

test('pedestrians replenish visible sidewalks ahead without appearing nearby', () => {
  const context = populationContext();
  context.nearEdges.push(straightEdge(0));
  let z = 100;
  context.sidewalkTrack = () => {
    Object.assign(context.track, { ax: 0, az: z - 10, ux: 0, uz: 1, len: 20, node: null });
    return true;
  };
  const spawnPed = trafficFunction('spawnPed', context);
  const ped = { crossesStreets: false, speed: 1.4, rig: {} };
  assert.equal(spawnPed(ped, 60, 280, true), false);
  z = 220;
  assert.equal(spawnPed(ped, 60, 280, true), true);
  assert.equal(ped.z, 220);
  assert.equal(ped.v, ped.speed);
});

test('long roads are available near their ends and spawn only in the local section', () => {
  const context = populationContext();
  const edge = straightEdge(100, 2000);
  Object.assign(context, { edges: [edge, straightEdge(2000)], crossingNodes: [], nearX: Infinity, nearZ: Infinity });
  trafficFunction('refreshNear', context)();
  assert.deepEqual(context.nearEdges, [edge]);
  const car = { half: 2.25 };
  assert.equal(trafficFunction('spawnVehicle', context)(car, 0, 350, false), true);
  assert.ok(edge.sz + car.s <= 350);
  assert.ok(car.s >= car.half + 5);
});

test('as many vehicles drive as the lanes within reach carry at VEHICLE_DENSITY, within the pool', () => {
  const context = populationContext();
  // 2 km of road from z = -1000: 700 m of it inside the 350 m circle; two lanes, then four
  const edge = Object.assign(straightEdge(-1000, 2000), { lanes: [0, 3.5] });
  Object.assign(context, { edges: [edge], crossingNodes: [], nearX: Infinity, nearZ: Infinity });
  trafficFunction('refreshNear', context)();
  assert.ok(Math.abs(context.nearLanes - 1400) < 1e-6);
  assert.equal(context.nearTarget, 30, 'never below MIN_VEHICLES');
  edge.lanes = [0, 3.5, 7, 10.5, 14, 17.5];
  Object.assign(context, { nearX: Infinity, nearZ: Infinity });
  trafficFunction('refreshNear', context)();
  assert.equal(context.nearTarget, 84);
  context.edges = Array.from({ length: 4 }, () => edge);
  Object.assign(context, { nearX: Infinity, nearZ: Infinity });
  trafficFunction('refreshNear', context)();
  assert.equal(context.nearTarget, 212, 'never above the pool');
});

test('crossing pedestrians start at nearby zebras whether signalised or not', () => {
  const context = populationContext();
  const signalised = { x: 50, z: 0, signal: true }, unsignalised = { x: 0, z: 120, signal: false };
  const far = { x: 0, z: 900, signal: false };
  Object.assign(context, { edges: [], crossingNodes: [signalised, unsignalised, far], nearX: Infinity, nearZ: Infinity });
  trafficFunction('refreshNear', context)();
  assert.deepEqual(context.nearCrossings.slice(), [signalised, unsignalised]);
  const started = [];
  context.crosswalkTrack = (n) => {
    started.push(n);
    Object.assign(context.track, { ax: n.x - 10, az: n.z, ux: 1, uz: 0, len: 20, node: { curb: [] } });
    return true;
  };
  context.Math = Object.assign(Object.create(Math), { random: () => 0.75 }); // the second node, the far end's curb
  const ped = { crossesStreets: true, speed: 1.4, rig: {} };
  assert.equal(trafficFunction('spawnPed', context)(ped, 60, 280, false), true);
  assert.deepEqual(started, [unsignalised]);
  assert.equal(ped.v, 0, 'waiting at the curb');
});

test('crossing pedestrians fall back to a sidewalk when nearby crosswalks are unusable', () => {
  const context = populationContext();
  context.nearCrossings.push({});
  context.nearEdges.push(straightEdge(200));
  let crossings = 0;
  context.crosswalkTrack = () => { crossings++; return false; };
  context.sidewalkTrack = () => {
    Object.assign(context.track, { ax: 0, az: 200, ux: 0, uz: 1, len: 20, node: null });
    return true;
  };
  const ped = { crossesStreets: true, speed: 1.4, rig: {} };
  assert.equal(trafficFunction('spawnPed', context)(ped, 60, 280, true), true);
  assert.equal(crossings, 5);
  assert.equal(ped.node, null);
  assert.equal(ped.z, 210);
});

// ---------------------------------------------------------------------------------------------------------------------
// Trams (docs/actors.md "Trams"): cars yield, pedestrians wait, the player bumps into them
// ---------------------------------------------------------------------------------------------------------------------
// A tram whose front is at u on a one-edge path (te: 300 m of track)
function tramOn(te, u, speed = 5) {
  return {
    length: 31.8, speed, v0: 13, waitReason: '', obstacle: null,
    path: { n: 1, edges: [te], start: [0], u, indexAt: () => 0 }
  };
}

function tramLaneContext(trams) {
  const context = {
    trams, tramFrame: 7, tramProxies: [], tramProxiesUsed: 0, TRAM_REACH: 70, TRAM_PROXY_DRIVER: { a: 1.15, b: 1.4, T: 1.6, s0: 3 },
    Math, Infinity,
    occupy(list, v, s) {
      list.push({ v, s });
      list.sort((a, b) => a.s - b.s);
    }
  };
  context.occupyTrams = trafficFunction('occupyTrams', context);
  return context;
}

test('a tram goes into the car lanes under it as a leader, reaching a little ahead but never over a car', () => {
  const road = { occ: [[], []] };
  const te = {
    len: 300,
    // lane 0 runs along the track for 200 m, its way; lane 1 crosses it at lane position 50 (track s 120)
    lanes: [
      { edge: road, lane: 0, s0: 0, s1: 200, l0: 0, l1: 200, dir: 1, pad: 0.5 },
      { edge: road, lane: 1, s0: 118, s1: 122, l0: 50, l1: 50, dir: 0, pad: 1.7 }
    ],
    junctions: [{ s0: 120, s1: 125, held: -1, by: null }, { s0: 150, s1: 160, held: -1, by: null }]
  };
  const t = tramOn(te, 100);
  const context = tramLaneContext([t]);
  context.occupyTrams();
  const [entry] = road.occ[0];
  assert.equal(road.occ[0].length, 1);
  assert.equal(entry.v.tram, t);
  // body [68.2, 100] and 4 m + 1 s at its speed ahead, widened by the pad
  assert.ok(Math.abs(entry.s - entry.v.half - 67.7) < 1e-9 && Math.abs(entry.s + entry.v.half - 109.5) < 1e-9);
  assert.equal(entry.v.speed, 5, 'running the lane\'s way: a moving leader');
  assert.ok(entry.v.driver.s0 > 0 && entry.v.claimed === true && entry.v.move === null, 'skipped where cars look for the claims and moves of others');
  // the crossing lane: the tram reaches it within its hold (8 m + 6 s at 5 m/s ahead): held, as a stopped obstacle
  assert.equal(road.occ[1].length, 1);
  assert.equal(road.occ[1][0].v.speed, 0);
  assert.ok(road.occ[1][0].s - road.occ[1][0].v.half < 50 && road.occ[1][0].s + road.occ[1][0].v.half > 50);
  assert.equal(te.junctions[0].held, 7);
  assert.equal(te.junctions[0].by, t);
  assert.equal(te.junctions[1].held, -1, 'beyond the hold');

  // A car already ahead of the front in the stretch: the stretch ends short of it; one on the crossing keeps it
  for (const list of road.occ) list.length = 0;
  const car = { half: 2.25 };
  road.occ[0].push({ v: car, s: 106 });
  road.occ[1].push({ v: car, s: 50 });
  context.tramFrame++;
  context.occupyTrams();
  const proxy = road.occ[0].find((o) => o.v.tram);
  assert.ok(Math.abs(proxy.s + proxy.v.half - (106 - 2.25 - 0.3)) < 1e-9);
  assert.equal(road.occ[1].filter((o) => o.v.tram).length, 0, 'a car on the crossing keeps its place: the tram brakes for it');
  assert.equal(context.tramProxiesUsed, 1, 'pooled');
  // While the tram waits for a car it holds only what its body is over
  t.waitReason = 'car';
  context.tramFrame++;
  context.occupyTrams();
  assert.equal(te.junctions[0].held, context.tramFrame - 1);
});

test('cars leave a junction curve held by a tram alone, unless they are ahead of it or it waits for them', () => {
  const lane = { lanes: [] };
  const te = { lanes: [{ edge: lane, lane: 0, dir: 1 }] };
  const t = tramOn(te, 100);
  t.frontX = 0;
  t.frontZ = 0;
  t.sections = [{ heading: 0, halfWidth: 1.2 }]; // heading +z
  const e = {};
  const other = {};
  const f = {};
  const conflict = { e, i: 0, f, j: 0, held: 3, by: t };
  const n = { tramConflicts: [conflict] };
  const context = { tramFrame: 3, TRAM_REACH: 70, Math };
  context.inTramLane = trafficFunction('inTramLane', context);
  const tramBlocks = trafficFunction('tramBlocks', context);
  const car = { edge: e, lane: 0, x: 10, z: 20, halfWidth: 0.9 };
  assert.equal(tramBlocks(car, n, f, 0), true, 'a car across the tram\'s way waits');
  assert.equal(tramBlocks(car, n, f, 1), false, 'another curve');
  assert.equal(tramBlocks(car, { }, f, 0), false, 'a junction without track');
  context.tramFrame = 4;
  assert.equal(tramBlocks(car, n, f, 0), false, 'held last frame only');
  context.tramFrame = 3;
  t.obstacle = car;
  assert.equal(tramBlocks(car, n, f, 0), false, 'the tram waits for it: it goes');
  t.obstacle = null;
  Object.assign(car, { x: 0.5, z: 15 });
  assert.equal(tramBlocks(car, n, f, 0), false, 'right in front of the tram: it leads');
  Object.assign(car, { x: 6, z: 15, edge: lane });
  conflict.e = lane;
  assert.equal(tramBlocks(car, n, f, 0), false, 'ahead in a lane the tram runs along');
  te.lanes[0].dir = -1;
  assert.equal(tramBlocks(car, n, f, 0), true);
  Object.assign(car, { x: 0.5, z: -40 });
  assert.equal(tramBlocks(car, n, f, 0), true, 'behind the tram');
  assert.equal(tramBlocks({ ...car, edge: other }, n, f, 0), false);
});

test('a tram section pushes the player out of its body (SAT) and knocks a car back like a bus', () => {
  const reports = [];
  const sparks = [];
  const context = {
    Math, clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    satHit: { nx: 0, nz: 0, pen: 0, localX: 0, localZ: 0, pSin: 0, pCos: 1 },
    reportCollision: (...args) => reports.push(args),
    spawnCollisionSparks: (...args) => sparks.push(args)
  };
  context.overlapWithPlayer = trafficFunction('overlapWithPlayer', context);
  const pe = { type: 'car', position: { x: 1.9, y: 0, z: 2, copy() {} }, heading: 0.2, speed: 0, vx: -6, vz: 0 };
  context.player = { entity: pe, halfW: 0.86, halfL: 2.18 };
  const collideWithTram = trafficFunction('collideWithTram', context);
  const tram = { speed: 0, sections: [{ x: 0, z: 0, heading: 0, halfLength: 6, halfWidth: 1.2 }, { x: 0, z: 30, heading: 0, halfLength: 6, halfWidth: 1.2 }] };
  assert.ok(context.overlapWithPlayer(pe.position.x, pe.position.z, 0, 1.2, 6, pe.heading, 0.86, 2.18), 'overlapping to begin with');
  collideWithTram(tram);
  assert.equal(context.overlapWithPlayer(pe.position.x, pe.position.z, 0, 1.2, 6, pe.heading, 0.86, 2.18), null, 'pushed clear');
  assert.ok(pe.position.x > 1.9, 'out the side it came from, the tram unmoved');
  assert.ok(pe.vx > -6, 'knocked back');
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1], tram);
  assert.equal(sparks.length, 1);
  // A pedestrian is pushed aside without a crash sound
  const walker = { type: 'person', position: { x: -1.3, y: 0, z: 31, copy() {} }, heading: 0, speed: 1.4 };
  context.player = { entity: walker, halfW: 0.32, halfL: 0.32 };
  trafficFunction('collideWithTram', context)(tram);
  assert.ok(walker.position.x <= -1.52 + 1e-9);
  assert.equal(reports.length, 1);
});

test('pedestrians stop short of a tram track while a tram is over it or coming', () => {
  // a tram edge along x, and a crosswalk across it at x = 50 (z -10..10)
  const te = { pts: new Float64Array([0, 0, 100, 0]), cum: new Float64Array([0, 100]), len: 100, box: [0, 100, 0, 0], flip: false, reverse: null };
  const route = { ax: 50, az: -10, ux: 0, uz: 1, len: 20 };
  const t = tramOn(te, 30, 10);
  const context = { trams: [t], tramGraph: { edges: [te] }, PED_TRAM_TIME: 6, Math, Infinity };
  context.tramCrossings = trafficFunction('tramCrossings', context);
  context.tramNear = trafficFunction('tramNear', context);
  const tramRoom = trafficFunction('tramRoom', context);
  const p = { route, t: 2, dir: 1 };
  assert.ok(Math.abs(tramRoom(p) - 6.2) < 1e-9, 'stops 1.8 m before the rails (10 m along)');
  assert.equal(route.tramCrossings.length, 1, 'worked out once and kept on the track');
  t.path.u = -100;
  assert.equal(tramRoom(p), Infinity, 'tram far off');
  t.path.u = 60;
  assert.ok(tramRoom(p) < 7, 'its body over the crossing');
  t.path.u = 90;
  assert.equal(tramRoom(p), Infinity, 'gone by');
  t.path.u = 30;
  assert.equal(tramRoom({ route, t: 9.5, dir: 1 }), Infinity, 'already on the rails: walks on');
  assert.ok(Math.abs(tramRoom({ route, t: 18, dir: -1 }) - 6.2) < 1e-9, 'from the other side');
  t.path.edges[0] = { reverse: te };
  te.reverse = t.path.edges[0];
  t.path.edges[0].len = 100;
  t.path.u = 30; // on the reverse edge, its front at 30 = x 70: heading for x 50
  assert.ok(tramRoom(p) < 7, 'a tram the other way on the same track');
});

// Gridlock regressions (Phase 15.6, tools/bench-traffic.mjs): each pattern below once held cars or trams 90-260 s
test('a tram standing short of a crosswalk for the people on it lets them cross; its body over it never does', () => {
  // the deadlock: someone stopped 1.8 m off the rails for a tram 2 m short of the crosswalk, which waited for them
  const te = { pts: new Float64Array([0, 0, 100, 0]), cum: new Float64Array([0, 100]), len: 100, box: [0, 100, 0, 0], flip: false, reverse: null };
  const route = { ax: 50, az: -10, ux: 0, uz: 1, len: 20 };
  const t = tramOn(te, 48, 0);
  const context = { trams: [t], tramGraph: { edges: [te] }, PED_TRAM_TIME: 6, Math, Infinity };
  context.tramCrossings = trafficFunction('tramCrossings', context);
  context.tramNear = trafficFunction('tramNear', context);
  const tramRoom = trafficFunction('tramRoom', context);
  const p = { route, t: 7, dir: 1 };
  t.waitReason = 'signal';
  assert.ok(tramRoom(p) < 2, 'a tram 2 m off held by its signal: wait for it');
  t.waitReason = 'pedestrian';
  assert.equal(tramRoom(p), Infinity, 'it waits for the people in its way: they cross');
  t.speed = 2;
  assert.ok(tramRoom(p) < 2, 'unless it is moving');
  t.speed = 0;
  t.path.u = 70;
  assert.ok(tramRoom(p) < 2, 'its body over the crossing: wait, whatever it waits for');
});

test('a tram held at a stop, a red or behind another tram holds only the junction curves under its body', () => {
  const road = { occ: [[]] };
  const te = {
    len: 300, lanes: [],
    // a junction curve 6 m ahead of the front (at 100)
    junctions: [{ s0: 106, s1: 110, held: -1, by: null }]
  };
  const t = tramOn(te, 100, 0);
  const context = tramLaneContext([t]);
  for (const [reason, atStop, held] of [['', false, true], ['curve', false, true], ['signal', false, false], ['tram', false, false],
    ['switch', false, false], ['', true, false]]) {
    t.waitReason = reason;
    t.atStop = atStop;
    context.tramFrame++;
    context.occupyTrams();
    assert.equal(te.junctions[0].held === context.tramFrame, held, `${reason || 'free'}${atStop ? ' at a stop' : ''}`);
  }
  assert.equal(road.occ[0].length, 0);
});

test('a driver kept waiting at an unsignalised zebra gets its turn: people still at the curb no longer hold it', () => {
  const { car } = intersectionHarness();
  car.edge.to.signal = false;
  // pedestrianOn stand-in: someone waiting at the curb, who counts unless the car's turn has come (onIt)
  const match = source.match(/  function mayEnter\([^]*?\n  \}/)[0];
  const calls = [];
  const enter = vm.runInNewContext(`(${match.trim()})`, {
    LOOKAHEAD: 70, CROSSWALK: 4.3, PED_COURTESY: 5, shortOfZebra: () => 6.55, phaseOf: () => 'green', canStopBefore: () => true,
    stopAt: () => -3, boxBusy: () => false, ahead: () => null, connector: () => ({ len: 20 }), yieldToCrossTraffic: () => false,
    pedestrianOn: (n, side, coord, t0, t1, onIt) => (calls.push(onIt), !onIt), laneCoord: () => 0, timeTo: () => 1, room: () => true,
    alongside: () => false, mergingAhead: () => null, tramBlocks: () => false, refuse: (v, why) => ((v.held = why), false)
  });
  car.speed = 0;
  car.pedWait = 3;
  assert.equal(enter(car, 0), false);
  assert.equal(car.held, 'pedestrian');
  car.pedWait = 6;
  assert.equal(enter(car, 0), true, 'after PED_COURTESY seconds it goes once the zebra is clear');
  car.edge.to.signal = true;
  car.commit = null;
  assert.equal(enter(car, 0), false, 'at a signal the WALK decides, not courtesy');
  assert.deepEqual(calls.slice(0, 2), [false, true], 'the turn is passed on as onIt');
  const courtesy = source.match(/  function courtesy\([^]*?\n  \}/);
  assert.ok(courtesy, 'courtesy() marks the crosswalks it passes as crossed, so people at the curb wait');
  const n = { signal: false, crossing: [0, 0, 0] };
  const touched = [];
  const mark = vm.runInNewContext(`(${courtesy[0].trim()})`, { touchNode: (node) => touched.push(node) });
  mark({ edge: { to: n, inSide: 0 }, move: { to: { outSide: 2 } }, conn: null });
  assert.deepEqual(n.crossing.slice(), [1, 0, 1]);
  assert.equal(touched[0], n);
});

test('drivers aim at their pace times the posted limit, within the vehicle top speed', () => {
  const line = source.match(/  const desiredOn = [^\n]*;/)?.[0];
  assert.ok(line, 'desiredOn is present');
  const desiredOn = vm.runInNewContext(`${line.trim()} desiredOn`, { URBAN_LIMIT: 50 / 3.6, Math });
  const car = { pace: 1.1, vmax: 80 / 3.6 };
  close(desiredOn(car, { limit: 30 / 3.6 }), 33 / 3.6);
  close(desiredOn(car, {}), 55 / 3.6); // no limit on the edge: the built-up 50 km/h
  close(desiredOn({ pace: 0.8, vmax: 50 / 3.6 }, { limit: 70 / 3.6 }), 50 / 3.6); // a bus on a 70 km/h artery
});
