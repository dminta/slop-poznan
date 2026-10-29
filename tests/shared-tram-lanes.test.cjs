const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');
function alignment(edge, tracks, open = () => true) {
  const body = source.match(/  function alignSharedTramLane\([^]*?\n  \}/)[0];
  const streetTracks = tracks.map(([ax, az, bx, bz]) => {
    const len = Math.hypot(bx - ax, bz - az);
    return { ax, az, bx, bz, len, ux: (bx - ax) / len, uz: (bz - az) / len };
  });
  vm.runInNewContext(`(${body})`, { streetTracks, LANE_CLEAR: 1.2, laneOpen: open })(edge);
}
const edge = () => ({ sharedTram: true, x0: 0, z0: 0, dx: 1, dz: 0, rx: 0, rz: 1, span: 100, half: 8, lanes: [0] });
const tracks = [[100, 0, 0, 0], [0, 3.2, 100, 3.2]];

test('a shared lane overlapping the opposing track aligns to the right-hand track', () => {
  const east = edge();
  alignment(east, tracks);
  assert.equal(east.lanes[0], 3.2);
  const west = { ...edge(), x0: 100, dx: -1, rz: -1 };
  alignment(west, tracks);
  assert.equal(west.lanes[0], 0, 'the correct opposing direction keeps its own track');
});

test('alignment preserves lanes when tracks are absent, ambiguous, segregated, blocked or outside the curbs', () => {
  for (const [changes, rails, open] of [
    [{}, [], () => true], [{}, tracks.slice(0, 1), () => true],
    [{}, [...tracks, [0, 6.4, 100, 6.4]], () => true],
    [{ sharedTram: false }, tracks, () => true], [{ lanes: [0, 3.6] }, tracks, () => true],
    [{}, tracks, () => false], [{ half: 4 }, tracks, () => true]
  ]) {
    const e = { ...edge(), ...changes }, before = [...e.lanes];
    alignment(e, rails, open);
    assert.deepEqual(e.lanes, before);
  }
});

function opposingClearance(network, GEO) {
  const incoming = network.edges.find((e) => Math.hypot(e.to.x + 2023, e.to.z + 448) < 2 && e.from.x < -2060);
  assert.ok(incoming);
  const move = incoming.moves.find((m) => m.turn === 'S' && m.to.to.x > -2000);
  assert.ok(move);
  const curve = network.connector(incoming, 0, move.to, move.out[0]);
  const point = {};
  let minimum = Infinity;
  for (let s = curve.len - 10; s <= curve.len; s += 0.5) {
    network.curvePoint(curve, s, point);
    for (const r of GEO.rail) {
      if (r.kind !== 'tram' || !r.oneway) continue;
      const p = r.pts;
      for (let k = 2; k < p.length; k += 2) {
        const ax = p[k - 2], az = p[k - 1], dx = p[k] - ax, dz = p[k + 1] - az;
        const length = Math.hypot(dx, dz);
        if (!length || (dx * point.dx + dz * point.dz) / length > -0.95) continue;
        const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.z - az) * dz) / (length * length)));
        minimum = Math.min(minimum, Math.hypot(ax + dx * t - point.x, az + dz * t - point.z));
      }
    }
  }
  return minimum;
}

test('Rynek Jeżycki eastbound cars clear opposing trams without losing lanes or stale paint', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const build = (text) => loadModule(text, {
    imports: { './city-config.js': config, './geodata.js': { GEO } }, globals: { console: { info() {} } }
  }).buildRoadNetwork([], []);
  const before = build(source.replace('  for (const e of edges) alignSharedTramLane(e);', ''));
  const after = build(source);
  assert.ok(opposingClearance(before, GEO) < 1.6, 'the control reproduces the opposing-track overlap');
  const clearance = opposingClearance(after, GEO);
  assert.ok(clearance > 2.4, `${clearance.toFixed(2)} m clears a car and tram body`);
  assert.ok(after.edges.length >= before.edges.length, 'no road-network edges lost to the correction');
  const laneCount = (n) => n.edges.reduce((sum, e) => sum + e.lanes.length, 0);
  assert.ok(laneCount(after) >= laneCount(before), 'no traffic lanes dropped');
  for (const driven of after.edges) {
    const painted = after.paintEdges.find((e) => e.lanes === driven.lanes);
    assert.ok(painted, 'paint keeps the corrected lane offsets');
    assert.equal(painted.sx, driven.sx);
    assert.equal(painted.sz, driven.sz);
  }
});
