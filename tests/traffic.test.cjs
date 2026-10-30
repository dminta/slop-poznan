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
    clock: 0,
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
  return { car, state, context, mayEnter: trafficFunction('mayEnter', context), signalAhead: trafficFunction('signalAhead', context) };
}

test('a turned Jeżyce car releases a disjoint approach before its distant exit stop line', () => {
  const roadSource = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');
  const curvePoint = vm.runInNewContext(`(${roadSource.match(/^function curvePoint\([^]*?\n\}/m)[0]})`);
  // The two actual connectors in the car 52 -> tram 18 -> car 51 wait cycle (seed 4242, t=300 s).
  const candidate = {
    x0: -2006.5141968646772, z0: -444.83928839663344, x1: -2020.2024314739708, z1: -447.76114619278775,
    x2: -2033.0030894386184, z2: -453.8944170390878, x3: -2046.1926269820087, z3: -458.5785518675815,
    len: 42.033203515292605, curv: 0.011318223190769574,
    lut: [0, 2.62238765, 5.24252939, 7.86227703, 10.48296356, 13.10546303, 15.73024178, 18.35742188,
      20.98683739, 23.61808968, 26.25061226, 28.88372231, 31.51667595, 34.14872742, 36.77919388, 39.40748596, 42.03320313]
  };
  const curve = {
    x0: -2038.9326693778683, z0: -438.6485354828496, x1: -2036.0473278029735, z1: -445.9832355610863,
    x2: -2019.5374819713206, z2: -446.9538398140908, x3: -2002.080334932214, z3: -440.8150628333061,
    len: 39.43346032690097, curv: 0.16106215152412098,
    lut: [0, 1.47576737, 2.99882746, 4.62286711, 6.38378143, 8.30244827, 10.38873577, 12.64495659,
      15.06837654, 17.65290833, 20.39025497, 23.27067947, 26.28353119, 29.41763878, 32.66158676, 36.00394440, 39.43346024]
  };
  const holder = { edge: { axisIndex: 0 }, conn: curve, cs: 36.88202741072315, half: 2.34, halfWidth: 0.88 };
  const v = { edge: {}, lane: 0, move: { to: {}, out: [0] }, half: 2.23, halfWidth: 0.895 };
  const n = { box: [1, 0], boxVehicles: [holder] };
  let entering = candidate;
  let samples = 0;
  const context = { curvePoint: (...args) => { samples++; return curvePoint(...args); }, boxSample: {}, connector: () => entering };
  context.boxSamples = trafficFunction('boxSamples', context);
  context.boxConflictEnd = trafficFunction('boxConflictEnd', context);
  const boxBusy = trafficFunction('boxBusy', context);
  assert.equal(boxBusy(n, 1, v), false, 'car 51 can clear the tram instead of waiting for the far exit line');
  assert.equal(context.boxConflictEnd(candidate, curve, v.halfWidth + holder.halfWidth), -Infinity,
    'the two opposing lane paths stay disjoint even while the right turn completes');
  const initialSamples = samples;
  for (let i = 0; i < 100; i++) assert.equal(boxBusy(n, 1, v), false);
  assert.equal(samples, initialSamples, 'cached pairs require no further curve sampling');
  holder.half = 6;
  assert.equal(boxBusy(n, 1, v), true, 'a long rigid body on the tight turn still sweeps the opposing lane');
  holder.half = 2.34;
  const line = (x0, z0, x3, z3) => ({ x0, z0, x3, z3, x1: x0 + (x3 - x0) / 3, z1: z0 + (z3 - z0) / 3,
    x2: x0 + 2 * (x3 - x0) / 3, z2: z0 + 2 * (z3 - z0) / 3,
    len: 20, lut: Array.from({ length: 17 }, (_, k) => k * 20 / 16) });
  entering = line(0, -10, 0, 10);
  holder.conn = line(-10, 0, 10, 0);
  const last = context.boxConflictEnd(entering, holder.conn, v.halfWidth + holder.halfWidth);
  assert.ok(Number.isFinite(last) && last > 10, 'a perpendicular crossing retains a physical conflict');
  holder.cs = last + holder.half - 0.01;
  assert.equal(boxBusy(n, 1, v), true, 'the tail still across the conflicting path holds its box');
  holder.cs = last + holder.half + 0.01;
  assert.equal(boxBusy(n, 1, v), false);
  holder.yielding = true;
  assert.equal(boxBusy(n, 1, v), true, 'a car waiting inside to turn retains its claim');
  assert.deepEqual(n.box, [1, 0], 'clearance does not alter the occupancy or crossing counters');
});

test('merge room uses a transitive approach order, so three cars cannot reserve an empty exit against each other', () => {
  const n = { signal: true, in: [] };
  const a = { id: 2, to: n, occ: [], phase: 'green' };
  const b = { id: 3, to: n, occ: [], phase: 'red' };
  const exit = { len: 10.415, occ: [[]], from: n };
  const car = (edge, s, wait) => ({ edge, lane: 0, s, wait, half: 2.2, driver: { s0: 2 }, move: { to: exit, out: [0] } });
  // Kaponiera #7 waits longest, #46 is a little farther forward in its neighbouring lane, and #80 on the other
  // approach has waited longer than #46. Mixing individual wait with same-road front order creates a cycle.
  const oldest = car(a, 7, 62), front = car(a, 7.2, 24), other = car(b, 7, 27);
  front.lane = 1;
  front.move.out.push(0);
  a.occ = [[{ v: oldest, s: oldest.s }], [{ v: front, s: front.s }]];
  b.occ = [[{ v: other, s: other.s }]];
  n.in = [a, b];
  const context = {
    leadOf: (list) => list.at(-1), precedence: (v, s) => s + v.half, phaseOf: (e) => e.phase
  };
  context.mergeFirst = trafficFunction('mergeFirst', context);
  const room = trafficFunction('room', context);
  assert.equal(room(exit, 0, front), true, 'a red approach cannot reserve the green approach\'s empty exit');
  assert.equal(room(exit, 0, oldest), false, 'the nearer front in the same approach still merges first');
  n.signal = false;
  assert.equal(room(exit, 0, front), true, 'the oldest waiting approach wins; its front car goes first');
  assert.equal(room(exit, 0, other), false, 'cross-approach priority agrees with same-approach order');
  a.occ[0][0].s = front.s;
  oldest.s = front.s;
  assert.equal(room(exit, 0, oldest), true, 'equal fronts have a stable lane order');
  assert.equal(room(exit, 0, front), false, 'equal fronts cannot both claim a one-car exit');
  a.occ[0][0].s = oldest.s = 7;
  oldest.mergeArrival = 38;
  front.mergeArrival = 151;
  other.mergeArrival = 80;
  assert.equal(room(exit, 0, oldest), true, 'arrival at the line outranks centimetres of stopping position');
  assert.equal(room(exit, 0, front), false, 'the newer lane queue waits for its predecessor');
  exit.occ[0].push({ v: other, s: 4 });
  assert.equal(room(exit, 0, front), false, 'a committed vehicle already in the exit still reserves physical room');
});

test('a newcomer stopping centimetres farther forward cannot repeatedly pass an older merge queue', () => {
  const exit = { lanes: [0] };
  const edge = { len: 10, lanes: [0, 1], occ: [] };
  const old = { edge, lane: 0, s: 6.5843, half: 2.8, mergeArrival: 38, move: { to: exit, out: [0] } };
  const newcomer = { edge, lane: 1, s: 7.2, half: 2.3, mergeArrival: 151, move: { to: exit, out: [-1, 0] } };
  edge.occ = [[{ v: old, s: old.s }], [{ v: newcomer, s: newcomer.s }]];
  const context = { merger: {}, connector: () => ({ len: 30 }), besideTail: () => false, leadOf: (list) => list.at(-1),
    precedence: (v, s) => s + v.half };
  context.mergeFirst = trafficFunction('mergeFirst', context);
  const mergingAhead = trafficFunction('mergingAhead', context);
  assert.equal(mergingAhead(old, exit, 0), null, 'the older queue keeps its turn through acceleration');
  assert.equal(mergingAhead(newcomer, exit, 0).v, old, 'the newcomer follows its predecessor');
});

test('traffic reads each junction timing once per frame, independently of vehicle count', () => {
  const nodes = [
    { signalTiming: { phase0: 'green', phase1: 'red' } },
    { signalTiming: { phase0: 'red', phase1: 'green' } }
  ];
  let calculations = 0;
  const updateSignals = trafficFunction('updateSignals', {
    signalNodes: nodes,
    updateSignal(time, node) {
      assert.equal(time, 17);
      assert.ok(nodes.includes(node));
      calculations++;
    }
  });
  const phase = source.match(/const phaseOf = ([^;]+);/);
  assert.ok(phase);
  const phaseOf = vm.runInNewContext(`(${phase[1]})`);
  const green = intersectionHarness();
  const red = intersectionHarness();
  green.car.edge.to.signalTiming = nodes[0].signalTiming;
  red.car.edge.to.signalTiming = nodes[1].signalTiming;
  updateSignals(17);
  for (let i = 0; i < 200; i++) {
    assert.equal(phaseOf(green.car.edge), 'green');
    assert.equal(phaseOf(red.car.edge), 'red');
    assert.equal(phaseOf({ to: nodes[1], axisIndex: 1 }), 'green');
  }
  assert.equal(calculations, 2, 'phase computation scales with junctions, not cars');
});

test('two-arm signals use actual crossing width and disappear when no walking route remains', () => {
  const nodes = [
    { signal: true, sideCount: 2, signalTiming: {} },
    { signal: true, sideCount: 2, signalTiming: {} },
    { signal: true, sideCount: 4, signalTiming: {} }
  ];
  const signalNodes = [];
  const configured = [];
  const configureSignals = trafficFunction('configureSignals', {
    nodes, signalNodes, KERB: 1.6,
    configureSignalClearance: () => {},
    pedRoutes: { across: (n) => n === nodes[0] ? [{ len: 13.2, span: 150 }, { len: 15.2, span: 150 }] : [] },
    configurePedestrianSignal(n, crossing, width) {
      configured.push({ n, crossing, width });
      if (!crossing) n.signal = false;
    }
  });
  configureSignals();
  assert.equal(configured.length, 2);
  assert.equal(configured[0].crossing, true);
  close(configured[0].width, 12, 'clearance covers the walk between the waiting curbs');
  assert.equal(nodes[1].signal, false);
  assert.deepEqual(signalNodes, [nodes[0], nodes[2]]);
});

test('pedestrians request a two-arm crossing and wait for its cached WALK', () => {
  const node = { signal: true, signalTiming: { pedestrian: true, walk0: true, walk1: false }, crossing: [0], approach: [null] };
  const pedestrian = { node, side: 0, group: 1 };
  const requests = [];
  const context = { clock: 18, requestWalkSignal: (time, n) => requests.push([time, n]) };
  context.walkOn = trafficFunction('walkOn', context);
  const mayCross = trafficFunction('mayCross', context);
  assert.equal(mayCross(pedestrian), false, 'parallel road green does not release pedestrians');
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], 18);
  assert.equal(requests[0][1], node);
  node.signalTiming.walk1 = true;
  assert.equal(mayCross(pedestrian), true);
  assert.equal(requests.length, 1, 'no new request during WALK');
  node.crossing[0] = 1;
  assert.equal(mayCross(pedestrian), false, 'a vehicle already crossing still has to clear');
});

test('ordinary crossing WALK comes from its own junction and opposing road group', () => {
  const walkOn = trafficFunction('walkOn', {});
  const a = { signal: true, signalTiming: { walk0: true, walk1: false } };
  const b = { signal: true, signalTiming: { walk0: false, walk1: true } };
  assert.equal(walkOn({ node: a, group: 0 }), false);
  assert.equal(walkOn({ node: a, group: 1 }), true);
  assert.equal(walkOn({ node: b, group: 0 }), true);
  assert.equal(walkOn({ node: b, group: 1 }), false);
  assert.equal(walkOn({ node: { signal: false }, group: 0 }), true);
});

test('a compound crossing waits for vehicles on every peer approach', () => {
  const lead = { speed: 12 };
  const peer = { occ: [[{ v: lead, s: 90 }]] };
  const node = { crossing: [0, 0], approach: [null, peer] };
  const sides = [{ side: 0, clx: 1, clz: 0 }, { side: 1, clx: 0.6, clz: 0.8 }];
  let stoppable = false;
  const context = {
    walkOn: () => true,
    leadOf: (list) => list[0] || null,
    canStop: (vehicle, edge, crossing) => {
      assert.equal(vehicle.v, lead);
      assert.equal(edge, peer);
      assert.equal(crossing, true);
      return stoppable;
    }
  };
  const mayCross = trafficFunction('mayCross', context);
  for (const p of [{ node, side: 0, sides }, { node, side: 0, route: { sides } }]) {
    assert.equal(mayCross(p), false, 'the peer approach lead cannot stop');
    stoppable = true;
    assert.equal(mayCross(p), true, 'both approaches are clear or can stop');
    node.crossing[1] = 1;
    assert.equal(mayCross(p), false, 'a committed peer vehicle still owns the shared crossing');
    node.crossing[1] = 0;
    stoppable = false;
  }
});

test('peer approaches wait for the whole shared crossing while its owner uses the walking horizon', () => {
  const sides = [{ side: 0, clx: 0.6, clz: 0.8 }, { side: 1, clx: 1, clz: 0 }, { side: 2, clx: -1, clz: 0 }];
  const p = { side: 0, sides, x: 0, z: 0, ux: 0.6, uz: 0.8, coord: 0, dir: 1, speed: 2, waiting: false };
  const node = { walkers: [p] };
  const pedestrianOn = trafficFunction('pedestrianOn', {});
  for (const side of [1, 2]) {
    for (const coord of [-100, 100]) {
      assert.equal(pedestrianOn(node, side, coord, 20, 21), true,
        'a turning peer can sweep across the walker away from its stop-line lane coordinate');
    }
  }
  assert.equal(pedestrianOn(node, 3, 0, 0, 4), false, 'unrelated approaches are not reserved');
  assert.equal(pedestrianOn(node, 0, 6, 0, 2), true, 'the owner predicts when the walker reaches its lane');
  assert.equal(pedestrianOn(node, 0, 6, 0, 1), false, 'the owner can pass before the walker reaches its lane');
  assert.equal(pedestrianOn(node, 0, -6, 0, 4), false, 'a lane already behind the walker is clear for its owner');
  p.waiting = true;
  assert.equal(pedestrianOn(node, 1, 6, 0, 4), true, 'a peer driver yields to someone waiting to cross');
  assert.equal(pedestrianOn(node, 1, 6, 0, 4, true), false, 'a vehicle holding the crossing lets curb queues wait');
  p.waiting = false;
  p.route = { sides };
  p.sides = null;
  p.dir = -1;
  assert.equal(pedestrianOn(node, 1, 100, 20, 21), true, 'route metadata also reserves the peer for a reversed walker');
  assert.equal(pedestrianOn(node, 0, -6, 0, 2), true, 'the owner also predicts a reversed walker');
});

test('a bus keeps an incoming compound crossing reserved until its tail clears the connector span', () => {
  const node = { box: [0], boxVehicles: [], crossing: [0, 0] };
  const exit = { outSide: 1, occ: [[]] };
  const edge = { to: node, inSide: 0, axisIndex: 0, setbackTo: 2 };
  const bus = { edge, move: { to: exit, turn: 'S' }, conn: { len: 40, crosswalkEnd: 25 }, cs: 20, half: 9, out: 0 };
  const context = { CROSSWALK: 4.3, touchNode: (n) => n, touchEdge: (e) => e, cross: () => {}, occupy: () => {} };
  const claim = trafficFunction('claim', context);
  claim(bus);
  assert.equal(node.crossing[0], 1, 'the front cleared the nominal zebra while the bus tail still covers its peer');
  bus.claimed = false;
  bus.cs = 35;
  node.crossing[0] = 0;
  claim(bus);
  assert.equal(node.crossing[0], 0, 'the reservation ends once the tail clears the whole crossing');
});

test('outgoing occupancy hands a compound crossing reservation to a bus tail beyond the connector', () => {
  const node = { box: [0], boxVehicles: [], crossing: [0, 0, 0], touched: false };
  const edge = { from: node, to: {}, len: 20, occ: [[]], outSide: 0, setbackFrom: 2,
    crosswalkTails: [{ node, side: 2, end: -2 }] };
  const bus = { edge, lane: 0, s: 5, half: 9, conn: null, commit: null };
  const context = {
    filled: [], poolUsed: 0, touchedNodes: [], touchedEdges: [], vehicles: [bus], tramFrame: 0,
    PED_COURTESY: 5, occupy: () => {}, straddle: () => 0, occupyTrams: () => {}, claim: () => {},
    touchNode: (n) => {
      if (!n.touched) { n.touched = true; context.touchedNodes.push(n); }
      return n;
    }
  };
  const buildOccupancy = trafficFunction('buildOccupancy', context);
  buildOccupancy();
  assert.equal(node.crossing[2], 1, 'the bus is on its outgoing edge but its tail still crosses the peer zebra');
  bus.s = 8;
  buildOccupancy();
  assert.equal(node.crossing[2], 0, 'the peer crossing releases after the bus tail passes its end');
  edge.len = 4;
  bus.conn = { len: 20 };
  bus.cs = 1;
  buildOccupancy();
  assert.equal(node.crossing[2], 1, 'on a short edge the tail still owns the previous crossing inside the next connector');
  bus.cs = 4;
  buildOccupancy();
  assert.equal(node.crossing[2], 0, 'the next connector releases the previous crossing once the tail clears');
});

test('entry checks pedestrians for the whole incoming compound crossing span', () => {
  const h = intersectionHarness();
  h.state.phase = 'green';
  h.car.edge.crosswalkEnd = 25;
  const calls = [];
  h.context.timeTo = (v, distance) => distance;
  h.context.pedestrianOn = (...args) => { calls.push(args); return false; };
  assert.equal(h.mayEnter(h.car, 18), true);
  assert.equal(calls[0][4], 18 + 25 + 2 * h.car.half, 'a peer walker arriving after the nominal zebra still conflicts');
});

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
    VEHICLE_DENSITY: 20, MIN_VEHICLES: 30, vehicles: new Array(212), buses: [{ half: 6 }],
    nearLanes: 0, nearTarget: 0, nearBusTarget: 0,
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
  assert.ok(Math.abs(tramRoom(p) - 6.0) < 1e-9, 'stops 2 m before the rails (10 m along)');
  assert.equal(route.tramCrossings.length, 1, 'worked out once and kept on the track');
  t.path.u = -100;
  assert.equal(tramRoom(p), Infinity, 'tram far off');
  t.path.u = 60;
  assert.ok(tramRoom(p) < 7, 'its body over the crossing');
  t.path.u = 90;
  assert.equal(tramRoom(p), Infinity, 'gone by');
  t.path.u = 30;
  assert.equal(tramRoom({ route, t: 9.5, dir: 1 }), Infinity, 'already on the rails: walks on');
  assert.ok(Math.abs(tramRoom({ route, t: 18, dir: -1 }) - 6.0) < 1e-9, 'from the other side');
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

test('a stopped tram before a protected crossing leaves it free while its body and approaching trams still hold it', () => {
  // Measured at Św. Marcin / aleja Niepodległości: the tram stops 0.432 m before a protected car curve. The former
  // 2 m reservation ahead of its nose held the green approach for 139 s across successive waiting trams.
  const te = {
    len: 300, lanes: [],
    junctions: [{ s0: 219.291781584148, s1: 222.52674903824297, held: -1, by: null }]
  };
  const t = tramOn(te, 218.8595495175313, 0);
  const context = tramLaneContext([t]);
  for (const reason of ['signal', 'switch', 'tram', 'car']) {
    t.waitReason = reason;
    context.tramFrame++;
    context.occupyTrams();
    assert.notEqual(te.junctions[0].held, context.tramFrame, `${reason}: stopped short of the protected crossing`);
  }
  t.speed = 2;
  t.waitReason = 'signal';
  context.tramFrame++;
  context.occupyTrams();
  assert.equal(te.junctions[0].held, context.tramFrame, 'an approaching tram retains its lookahead');
  t.waitReason = 'car';
  context.tramFrame++;
  context.occupyTrams();
  assert.equal(te.junctions[0].held, context.tramFrame, 'a tram still braking for a car retains its lookahead');
  t.speed = 0;
  t.path.u = 220;
  context.tramFrame++;
  context.occupyTrams();
  assert.equal(te.junctions[0].held, context.tramFrame, 'a stopped body over the crossing still blocks it');
});

test('a driver kept waiting at an unsignalised zebra gets its turn: people still at the curb no longer hold it', () => {
  const { car } = intersectionHarness();
  car.edge.to.signal = false;
  // pedestrianOn stand-in: someone waiting at the curb, who counts unless the car's turn has come (onIt)
  const match = source.match(/  function mayEnter\([^]*?\n  \}/)[0];
  const calls = [];
  const enter = vm.runInNewContext(`(${match.trim()})`, {
    clock: 0,
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

test('a pedestrian waiting before a diagonal track stays outside the tram safety envelope', () => {
  const h = Math.SQRT1_2;
  const te = { pts: new Float64Array([0, 0, 100, 100]), cum: new Float64Array([0, Math.SQRT2 * 100]),
    len: Math.SQRT2 * 100, box: [0, 100, 0, 100], flip: false, reverse: null };
  const route = { ax: 50 + 10 * h, az: 50 - 10 * h, ux: -h, uz: h, len: 20 };
  const t = { path: { edges: [te], start: [0], n: 1, u: 60 }, length: 32, speed: 2, waitReason: '' };
  const context = { trams: [t], tramGraph: { edges: [te] }, PED_TRAM_TIME: 6, Math, Infinity };
  context.tramCrossings = trafficFunction('tramCrossings', context);
  context.tramNear = trafficFunction('tramNear', context);
  const room = trafficFunction('tramRoom', context);
  const tramSource = readFileSync(join(__dirname, '../js/trams.js'), 'utf8');
  const number = (name) => Number(tramSource.match(new RegExp(`const ${name} = ([0-9.]+);`))[1]);
  const reach = number('PED_REACH');
  const gap = vm.runInNewContext(`(${tramSource.match(/  function obstacleGap\([^]*?\n  \}/)[0].trim()})`, {
    Math, Infinity, TRAM_HALF_WIDTH: number('TRAM_HALF_WIDTH'), SWEEP_STEP: number('SWEEP_STEP'),
    sweepN: 3, sx0: 50 - 2 * h, sx1: 50 + 2 * h, sz0: 50 - 2 * h, sz1: 50 + 2 * h,
    sweepX: [50 - 2 * h, 50, 50 + 2 * h], sweepZ: [50 - 2 * h, 50, 50 + 2 * h],
    sweepTX: [h, h, h], sweepTZ: [h, h, h], _obsV: 0
  });
  for (const dir of [1, -1]) {
    const p = { route, t: dir > 0 ? 2 : 18, dir };
    const stop = p.t + dir * room(p);
    assert.equal(gap(route.ax + route.ux * stop, route.az + route.uz * stop, 0, reach, reach, 0, 0, true), Infinity,
      'a walker holding for the other track must not stop this tram and create a two-track wait cycle');
  }
});

test('straight traffic passes after the rear of an oncoming left turn clears its path, before the far exit line', () => {
  const h = intersectionHarness();
  h.state.phase = 'green';
  h.car.halfWidth = 0.9;
  const line = (x0, z0, x3, z3) => ({ x0, z0, x3, z3, x1: x0 + (x3 - x0) / 3, z1: z0 + (z3 - z0) / 3,
    x2: x0 + 2 * (x3 - x0) / 3, z2: z0 + 2 * (z3 - z0) / 3,
    len: 20, curv: 0, lut: Array.from({ length: 17 }, (_, k) => k * 20 / 16) });
  const candidate = line(0, -10, 0, 10);
  const opposite = { axisIndex: 0, lefts: 1 };
  const holder = { edge: opposite, move: { turn: 'L' }, conn: line(-10, 0, 10, 0), cs: 12, half: 2.3, halfWidth: 0.9 };
  h.car.edge.opposite = opposite;
  Object.assign(h.car.edge.to, { box: [1, 0], boxVehicles: [holder] });
  const roads = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');
  h.context.curvePoint = vm.runInNewContext(`(${roads.match(/^function curvePoint\([^]*?\n\}/m)[0]})`);
  h.context.boxSample = {};
  h.context.connector = () => candidate;
  h.context.boxSamples = trafficFunction('boxSamples', h.context);
  h.context.boxConflictEnd = trafficFunction('boxConflictEnd', h.context);
  h.context.boxBusy = trafficFunction('boxBusy', h.context);
  assert.equal(h.mayEnter(h.car, 0), false, 'the turning tail still sweeps the straight path');
  holder.cs = 19;
  assert.equal(h.mayEnter(h.car, 0), true, 'the left-turn counter alone cannot reserve the disjoint distant exit');
  assert.equal(opposite.lefts, 1, 'the existing turn/exit occupancy remains claimed');
});
