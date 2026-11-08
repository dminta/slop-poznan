const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const trafficSource = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
const routeSource = readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8');
const quiet = { info() {}, log() {}, warn() {} };

function trafficBlock(name) {
  const match = trafficSource.match(new RegExp(`  (?:function ${name}\\([^]*?\\n  \\}|const ${name} = [^;]+;)`));
  assert.ok(match, `${name} is present`);
  return match[0].trim();
}

function constant(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*([\\d.]+)`));
  assert.ok(match, `${name} is present`);
  return Number(match[1]);
}

const PED_STUCK_TIME = constant(trafficSource, 'PED_STUCK_TIME');
const PED_STUCK_VIEW_TIME = constant(trafficSource, 'PED_STUCK_VIEW_TIME');
const PED_CELL = constant(trafficSource, 'PED_CELL');
const QUEUE_GAP = constant(trafficSource, 'QUEUE_GAP');
const MEET_CLEAR = constant(trafficSource, 'MEET_CLEAR');
const PED_SPAWN_DISTANCE = constant(trafficSource, 'PED_SPAWN_DISTANCE');

test('a body held in view still recovers after the stuck deadline', () => {
  let inView = true;
  const stuckExpired = vm.runInNewContext(`(${trafficBlock('stuckExpired')})`, {
    PED_STUCK_TIME, PED_STUCK_VIEW_TIME, PED_SPAWN_DISTANCE,
    nearView: () => inView
  });
  const p = { stuck: PED_STUCK_TIME - 1, x: 0, z: 0 };
  assert.equal(stuckExpired(p), false, 'a short stand is legitimately postponed');
  p.stuck = PED_STUCK_TIME + 1;
  assert.equal(stuckExpired(p), false, 'in view, the pop is still postponed right after the deadline');
  inView = false;
  assert.equal(stuckExpired(p), true, 'out of view, the usual 20 s recovery runs');
  inView = true;
  p.stuck = PED_STUCK_VIEW_TIME + 1;
  assert.equal(stuckExpired(p), true, 'the held view must not keep the body forever');
  assert.ok(PED_STUCK_VIEW_TIME > PED_STUCK_TIME, 'the grace period starts after the ordinary deadline');
});

test('the entry and meeting checks see bodies from any route object', () => {
  const pedCells = new Map();
  const NO_PEDS = [];
  const pedNear = vm.runInNewContext(`(${trafficBlock('pedNear')})`, { PED_CELL, pedCells, NO_PEDS });
  const list = [];
  pedCells.set(Math.floor(0 / PED_CELL) * 100000 + Math.floor(0 / PED_CELL), list);
  const p = { placed: true, x: 0, z: 0 }, q = { placed: true, x: 0.3, z: 0.2 };
  list.push(p, q);
  assert.equal(pedNear(0, 0, QUEUE_GAP, p), true, 'a body within the queue gap blocks the entry');
  assert.equal(pedNear(0, 0, QUEUE_GAP), true, 'without a skip, the body itself is found');
  assert.equal(pedNear(20, 20, QUEUE_GAP, p), false, 'a far point is clear');
  assert.equal(pedNear(0, 0, 0.5, p), true, 'the nearby body is found');
  assert.equal(pedNear(0, 0, 0.5, p, q), false, 'skipping both partners leaves the point clear');
  q.x = 5; q.z = 5;
  assert.equal(pedNear(0, 0, QUEUE_GAP, p), false, 'a body in another cell no longer blocks');
});

test('conversations need a body width of clear space around both partners', () => {
  const pedCells = new Map();
  const NO_PEDS = [];
  const pedNear = vm.runInNewContext(`(${trafficBlock('pedNear')})`, { PED_CELL, pedCells, NO_PEDS });
  const meetingCells = new Map();
  const context = {
    clock: 100, nextMeeting: 0, meetingCells, peds: [], NO_PEDS, PED_CELL, pedNear,
    MEET_CLEAR, endConversation: () => {},
    Math: Object.assign(Object.create(Math), { random: () => 0 })
  };
  const meet = vm.runInNewContext(`(${trafficBlock('meet')})`, context);
  const route = { edge: {}, block: { id: 1 } };
  const ped = (x, z) => ({
    placed: true, node: null, route, conversation: null, socialTime: 0, t: 10, len: 40,
    x, z, v: 1
  });
  const a = ped(0, 0), b = ped(0, 1.5), third = ped(0, MEET_CLEAR / 2);
  context.peds.push(a, b, third);
  for (const q of context.peds) {
    const key = Math.floor(q.x / PED_CELL) * 100000 + Math.floor(q.z / PED_CELL);
    if (!pedCells.has(key)) pedCells.set(key, []);
    pedCells.get(key).push(q);
  }
  meet(1 / 15);
  assert.equal(a.conversation, null, 'a third body between the partners must keep them walking');
  assert.equal(b.conversation, null);

  // Move the third body away and let the pair try again.
  third.x = 12;
  third.z = 12;
  pedCells.clear();
  for (const q of context.peds) {
    const key = Math.floor(q.x / PED_CELL) * 100000 + Math.floor(q.z / PED_CELL);
    if (!pedCells.has(key)) pedCells.set(key, []);
    pedCells.get(key).push(q);
  }
  context.nextMeeting = 0;
  meet(1 / 15);
  assert.equal(a.conversation && b.conversation, a.conversation, 'a clear pair may start talking');
  assert.equal(a.conversation === b.conversation, true);
  assert.equal(a.v, 0);
});

test('a connector is keyed by the physical line it lands on, not its own span', () => {
  const routesReturn = 'return { along, across, next, crosswalks, segments, segmentsNear };';
  assert.ok(routeSource.includes(routesReturn), 'the route factory return line is intact');
  const routes = loadModule(routeSource.replace(routesReturn,
    'return { along, across, next, crosswalks, segments, segmentsNear, links };'), {
    imports: { './road-network.js': { CROSSWALK: 4.3, CROSSWALK_REACH: 4 } },
    globals: { console: quiet, Math }, filename: 'pedestrian-routes.js'
  });
  assert.equal(typeof routes.physicalLine, 'function');
  const block = { poly: [{ x: -1, z: -8 }, { x: 51, z: -8 }, { x: 51, z: 8 }, { x: -1, z: 8 }] };
  const blockAt = () => block;
  const walkable = () => true;
  const n = { x: 0, z: 0, in: [], out: [], arms: [], shape: false };
  const m = { x: 50, z: 0, in: [], out: [], arms: [], shape: false };
  const edge = { sx: 0, sz: 0, dx: 1, dz: 0, rx: 0, rz: 1, len: 50, half: 3, from: n, to: m };
  n.out.push(edge);
  m.in.push(edge);
  const built = routes.createPedestrianRoutes(
    { nodes: [n, m], edges: [edge], walkable, configureCrosswalks: null }, blockAt, null, null, null
  );
  const tracks = built.along(edge);
  assert.equal(tracks.length, 4, 'two lateral lines on each side of the street');
  const atNode = (track) => built.links(track, -1).filter((path) => path[0]?.track.walkKey);
  const first = atNode(tracks[0]), second = atNode(tracks[1]);
  assert.ok(first.length >= 2 && second.length >= 2, 'the node has several corner-link choices');
  const byTarget = new Map();
  for (const path of [...first, ...second]) {
    for (const q of tracks) {
      if (path.at(-1).track !== q) continue;
      const line = routes.physicalLine(q);
      assert.equal(path[0].track.walkKey, `corner:${line}`, 'the leg carries its landing line');
      if (!byTarget.has(line)) byTarget.set(line, []);
      byTarget.get(line).push(path[0].track);
    }
  }
  let shared = 0;
  for (const list of byTarget.values()) {
    if (list.length < 2) continue;
    shared++;
    assert.equal(list[0].walkKey, list[1].walkKey, 'two spans onto one line queue as that line');
    assert.notEqual(list[0].len, list[1].len, 'the spans really differ');
  }
  assert.ok(shared > 0, 'some physical landing line is reached from more than one source line');
});
