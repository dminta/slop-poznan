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
