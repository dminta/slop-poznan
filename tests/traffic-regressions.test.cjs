const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');

function trafficFunction(name, context) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return vm.runInNewContext(`(${match[0].trim()})`, context);
}

test('a short link takes a free sibling lane only when it keeps the same movements', () => {
  // Kaponiera's 10 m exit at (-1497, 198): the graph feeds two approach lanes into lane 1, which also serves the
  // right turn, while lane 0 (straight only) stays empty. One car per green became two.
  const exit = { len: 10, lanes: [1.4, 5.0], moves: [{ turn: 'S', out: [0, 1] }, { turn: 'R', out: [-1, 1] }],
    occ: [[], [{ v: { speed: 0, held: 'signal' }, s: 7 }]] };
  const edge = { len: 20.7 };
  const v = { s: 10, lane: 1 };
  const state = { full: new Set([1]), len: 20 };
  const shortLinkLane = trafficFunction('shortLinkLane', {
    room: (f, j) => !state.full.has(j),
    connector: () => ({ len: state.len }),
    alongside: () => false
  });
  const straight = { turn: 'S', out: [0, 1] };
  assert.equal(shortLinkLane(v, edge, exit, straight, 1, true), 0, 'the free straight lane takes the car');
  state.full.clear();
  assert.equal(shortLinkLane(v, edge, exit, straight, 1, true), 1, 'a lane with room is kept');
  state.full.add(1);
  const turnOnly = { len: 10, lanes: [0, 1], moves: [{ turn: 'L', out: [0] }, { turn: 'R', out: [0] }] };
  assert.equal(shortLinkLane(v, edge, turnOnly, straight, 1, true), 1,
    'a sibling with movements the planned lane lacks is not used (it crosses the tram tracks at Kaponiera 230)');
  const noStraight = { ...exit, moves: [{ turn: 'R', out: [0, 1] }] };
  assert.equal(shortLinkLane(v, edge, noStraight, straight, 1, true), 1,
    'a sibling that cannot make the current move is not used');
});

test('a give-way feeder into a short link leaves the upstream junction clear', () => {
  // The 20.7 m approach to Kaponiera's 10 m give-way exit filled to the junction behind it and stood in its box for
  // 51 s (seed 4242). With a stationary rear car and no space behind it, a stoppable car now waits upstream.
  const n = { signal: false };
  const exit = { len: 10, occ: [[]], from: n, to: { signal: true } };
  const feeder = { len: 20.7, occ: [[]], from: { signal: false, in: [] }, to: { out: [exit] } };
  const lead = { s: 4, v: { half: 2.2, driver: { s0: 2 }, speed: 0 } };
  feeder.occ[0] = [lead];
  const v = { half: 2.2, driver: { s0: 2 }, bus: false };
  const room = trafficFunction('room', {});
  assert.equal(room(feeder, 0, v, false), false, 'a stopped queue leaves too little room behind it');
  assert.equal(room(feeder, 0, v, true), false, 'a car that cannot stop is refused as before');
  lead.v.speed = 4;
  assert.equal(room(feeder, 0, v, false), true, 'a moving rear car lets traffic follow it into the feeder');
  exit.from = { signal: true };
  lead.v.speed = 0;
  assert.equal(room(feeder, 0, v, false), true, 'a signalised feeder keeps the stoppable-car estimate');
});

test('a car records the short-link lane it actually takes', () => {
  // The exit reservation and merge braking must follow the chosen lane, not move.out, or two cars reserve the same
  // slot while the free lane is reported empty.
  const n = { signal: true, in: [] };
  const a = { id: 1, to: n, occ: [], phase: 'green' };
  const b = { id: 2, to: n, occ: [], phase: 'green' };
  const exit = { len: 10, occ: [[], []], from: n };
  const car = (edge, s) => ({ edge, lane: 0, s, wait: 5, half: 2.2, speed: 0, driver: { s0: 2 },
    move: { to: exit, out: [0] }, mergeArrival: Infinity });
  const lead = car(a, 9);
  lead.outEdge = exit;
  lead.out = 1; // the planned move says lane 0, but it took the free lane 1
  a.occ = [[{ v: lead, s: lead.s }]];
  const newer = car(b, 9);
  b.occ = [[{ v: newer, s: newer.s }]];
  n.in = [a, b];
  const context = { leadOf: (list) => list.at(-1), precedence: (v, s) => s + v.half, phaseOf: (e) => e.phase };
  context.mergeFirst = trafficFunction('mergeFirst', context);
  const room = trafficFunction('room', context);
  assert.equal(room(exit, 1, newer), false, 'the lead reserves the lane it actually entered');
  assert.equal(room(exit, 0, newer), true, 'the lane the graph planned but the lead did not take stays free');
});

test('a tram stopped for a car yields its own crossing pad in the car\'s exit lane', () => {
  // Kaponiera (-1468, 118), seed 5: car 66 waited for room behind tram 13's crossing pad at s 0.3, while the tram
  // waited for the car's front corner 0.5 m from its centreline - a 70 s deadlock. The tram cannot move until the car
  // clears its swept path, so the car goes first once both have waited for a real cycle and the lane holds it clear
  // of the pad. Releasing on any momentary stop left an unrelated seed-99 car in a 124 s red-light hold.
  const proxyFor = (obstacle, stuck, speed) => ({ tram: { obstacle, speed, stuck }, half: 2.4, s: 0.3, speed: 0,
    driver: { s0: 3 } });
  const v = { half: 2.1, driver: { s0: 2 }, bus: false, wait: 25, speed: 0 };
  const exit = { len: 10, lanes: [0, 0], occ: [[], []], from: { signal: false, in: [] } };
  exit.occ[0] = [{ v: proxyFor(v, 30, 0), s: 0.3 }];
  const context = { proxyYieldsTo: trafficFunction('proxyYieldsTo', { PROXY_RELEASE_WAIT: 20 }) };
  const room = trafficFunction('room', context);
  const alongside = trafficFunction('alongside', context);
  assert.equal(room(exit, 0, v, false), true, 'the car enters the lane its exit queue leaves free');
  assert.equal(alongside(exit, 0, v, -3.3, false), false, 'the pad no longer reads as a body it would come alongside');
  v.wait = 10;
  assert.equal(room(exit, 0, v, false), false, 'a car that has not waited for the cycle keeps the old refusal');
  v.wait = 25;
  exit.occ[0][0].v.tram.stuck = 10;
  assert.equal(room(exit, 0, v, false), false, 'a momentary tram stop does not release the car');
  exit.occ[0][0].v.tram.stuck = 30;
  exit.occ[0][0].v.tram.obstacle = { half: 2.1 };
  assert.equal(room(exit, 0, v, false), false, 'a tram waiting for another car still holds its pad');
  exit.occ[0][0].v.tram.obstacle = v;
  exit.occ[0][0].v.tram.speed = 1;
  assert.equal(room(exit, 0, v, false), false, 'a tram already moving is never released');
  exit.occ[0][0].v.tram.speed = 0;
  // A real car queued in the lane pushes the entry slot back. A 12 m exit with one stopped 4.2 m car still passes
  // the plain free-length test (free 4.8 >= 4.7), but the queue-from-the-line rear is 0.6 m, inside the 3.2 m pad.
  exit.len = 12;
  exit.occ[0].push({ v: { half: 2.1, driver: { s0: 2 }, speed: 0 }, s: 8 });
  assert.equal(room(exit, 0, v, false), false, 'a real car ahead can leave the car\'s rear on the track');
  exit.occ[0].pop();
  assert.equal(room(exit, 0, v, false), true, 'with the lane clear again the release returns');
  exit.len = 7;
  assert.equal(room(exit, 0, v, false), false, 'a lane too short to hold the car clear of the pad keeps the refusal');
});
