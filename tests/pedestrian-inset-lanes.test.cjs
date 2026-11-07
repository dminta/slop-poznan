const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const trafficSource = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
const routeSource = readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8');
const constant = (source, name) => {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*([\\d.]+)`));
  assert.ok(match, `${name} is present`);
  return Number(match[1]);
};
const LANE_INSET = constant(routeSource, 'LANE_INSET');
const LANE_BODY = constant(routeSource, 'LANE_BODY');
const PED_LANE_RAMP = constant(trafficSource, 'PED_LANE_RAMP');
const PED_LANE_RATE = constant(trafficSource, 'PED_LANE_RATE');
const QUEUE_GAP = constant(trafficSource, 'QUEUE_GAP');

function laneFunction() {
  const match = trafficSource.match(/  function laneOffset\([^]*?\n  \}/);
  assert.ok(match, 'laneOffset is present');
  return vm.runInNewContext(`(${match[0].trim()})`, { LANE_INSET, PED_LANE_RAMP, PED_LANE_RATE });
}

function pedestrian(overrides) {
  return {
    route: { insetLane: 3 },
    node: null,
    len: 10,
    t: 5,
    dir: 1,
    lane: 0,
    ...overrides
  };
}

test('opposing walkers keep to opposite sides of a marked two-way line', () => {
  const laneOffset = laneFunction();
  const east = pedestrian({ dir: 1 });
  const west = pedestrian({ dir: -1 });
  for (let frame = 0; frame < 30; frame++) {
    laneOffset(east, 1 / 15);
    laneOffset(west, 1 / 15);
  }
  assert.ok(Math.abs(east.lane - LANE_INSET) < 1e-9, `east keeps its right side (${east.lane})`);
  assert.ok(Math.abs(west.lane + LANE_INSET) < 1e-9, `west keeps its right side (${west.lane})`);
  assert.ok(Math.abs(east.lane - west.lane) > QUEUE_GAP,
    `the two lanes clear the ${QUEUE_GAP} m queue gap (${Math.abs(east.lane - west.lane)} m)`);
});

test('the inset fades to zero at track ends so a leg change never teleports a walker', () => {
  const laneOffset = laneFunction();
  const p = pedestrian({ t: 0 });
  const dt = 1 / 15;
  let previous = p.lane, largestStep = 0;
  for (let frame = 0; frame < 100; frame++) {
    p.t = Math.min(p.len, p.t + 1.6 * dt);
    const lane = laneOffset(p, dt);
    largestStep = Math.max(largestStep, Math.abs(lane - previous));
    previous = lane;
  }
  assert.ok(previous < 1e-9, `the lane is back on the centre line at the track end (${previous})`);
  assert.ok(largestStep <= PED_LANE_RATE * dt + 1e-9, `no lateral step exceeds the ease rate (${largestStep})`);

  // The same ramp holds at the start, where a walker steps onto the track.
  const entry = pedestrian({ t: 0.01 });
  laneOffset(entry, dt);
  assert.ok(Math.abs(entry.lane) < LANE_INSET / 10, `the inset starts small at the entrance (${entry.lane})`);
});

test('a reversed walker eases across the line instead of snapping', () => {
  const laneOffset = laneFunction();
  const p = pedestrian({ t: 5, dir: 1, lane: LANE_INSET });
  const dt = 1 / 15;
  p.dir = -1;
  let previous = p.lane;
  for (let frame = 0; frame < 30; frame++) {
    const lane = laneOffset(p, dt);
    assert.ok(Math.abs(lane - previous) <= PED_LANE_RATE * dt + 1e-9, 'the lane moves no faster than the ease rate');
    previous = lane;
  }
  assert.ok(Math.abs(p.lane + LANE_INSET) < 1e-9, 'the walker reaches the other direction\'s side');
});

test('unmarked tracks and crossings keep the centre line', () => {
  const laneOffset = laneFunction();
  const dt = 1 / 15;
  const unmarked = pedestrian({ route: { insetLane: 0 }, lane: LANE_INSET });
  const crossing = pedestrian({ node: {}, lane: LANE_INSET });
  for (let frame = 0; frame < 30; frame++) {
    laneOffset(unmarked, dt);
    laneOffset(crossing, dt);
  }
  assert.equal(unmarked.lane, 0);
  assert.equal(crossing.lane, 0);
});

test('walking tracks carry an inset lane only where that side is walkable on the same block', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const quiet = { info() {}, log() {}, warn() {} };
  const road = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: quiet },
    filename: 'road-network.js'
  });
  const { createPedestrianRoutes } = loadModule(routeSource, {
    imports: { './road-network.js': road }
  });
  const network = road.buildRoadNetwork([], []);
  const routes = createPedestrianRoutes(network, config.blockAt, null);
  let total = 0, marked = 0;
  for (const edge of network.edges) {
    for (const track of routes.along(edge)) {
      total++;
      assert.ok(Number.isInteger(track.insetLane) && track.insetLane >= 0 && track.insetLane <= 3,
        'every walking track records which right-hand lanes have room');
      if (!track.insetLane) continue;
      marked++;
      const rx = -track.uz, rz = track.ux;
      for (const side of [-1, 1]) {
        if (!(track.insetLane & (side > 0 ? 1 : 2))) continue;
        for (let i = 0; i <= 4; i++) {
          const x = track.ax + track.ux * track.len * i / 4 + rx * side * LANE_INSET;
          const z = track.az + track.uz * track.len * i / 4 + rz * side * LANE_INSET;
          assert.ok(config.blockAt(x, z), `the inset line stays on a block at ${x.toFixed(1)},${z.toFixed(1)}`);
          assert.ok(network.walkable(x - LANE_BODY, x + LANE_BODY, z - LANE_BODY, z + LANE_BODY),
            `the inset line stays walkable at ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
  }
  assert.ok(total > 20000, `the bare network has walking lines (${total})`);
  assert.ok(marked > total / 2, `most open sidewalks have room for an inset lane (${marked} of ${total})`);
  assert.ok(marked < total, `some lines are too narrow for an inset lane (${total - marked})`);
});
