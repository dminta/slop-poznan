import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildWorld } from '../tools/bench-world.mjs';

const audit = fileURLToPath(new URL('../tools/audit-tram-opposing-lanes.mjs', import.meta.url));

test('opposing-lane audit lists used street runs and counts off-street and unused track separately', () => {
  const result = spawnSync(process.execPath, [audit], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split('\n').map(JSON.parse);
  assert.ok(rows.length > 0, 'the known remaining close runs stay visible');
  assert.ok(rows.every((row) => row.length >= 5 && row.minimum < 2.3));
  assert.ok(rows.every((row) => row.street && row.routes > 0),
    'only street-running tracks a route uses can collide with a car');
  assert.ok(!rows.some((row) => row.road === 7500 && row.track === 275), 'the corrected lane clears that track');
  for (const road of [3015, 3201, 305]) {
    assert.ok(!rows.some((row) => row.road === road), `edge ${road} now clears its opposing track`);
  }
  for (const road of [266, 8154, 8212, 8213]) {
    assert.ok(!rows.some((row) => row.road === road), `the short-stub pass moved edge ${road} clear`);
  }
  assert.ok(!rows.some((row) => [3389, 3390, 3391, 6770, 8798].includes(row.road)),
    'off-street tracks are not body-overlap rows');
  assert.ok(!rows.some((row) => Math.hypot(row.roadStart[0] + 1216.6, row.roadStart[1] + 591.4) < 1),
    'the crossing-track pass moves the Pułaskiego stub clear');
  const total = JSON.parse(result.stderr.trim());
  assert.equal(total.segments, rows.length);
  assert.equal(total.lanes, new Set(rows.map((row) => `${row.road}:${row.lane}`)).size);
  assert.ok(total.segments <= 42 && total.lanes <= 40 && total.length <= 377,
    `${total.segments} runs / ${total.lanes} lanes / ${total.length} m remain: only used street tracks`);
  assert.ok(!rows.some((row) => row.road === 4581),
    'the station profile moves the Głogowska 4257 shared lane clear across the bend');
  assert.deepEqual([total.skipped.segments, total.skipped.lanes, total.skipped.length], [14, 12, 200],
    'unused and off-street tracks are counted separately, not hidden');

  const all = spawnSync(process.execPath, [audit, '--all'], { encoding: 'utf8' });
  assert.equal(all.status, 0, all.stderr);
  const allRows = all.stdout.trim().split('\n').map(JSON.parse);
  const allTotal = JSON.parse(all.stderr.trim());
  assert.equal(allRows.length, total.segments + total.skipped.segments);
  assert.ok(allRows.some((row) => [3389, 3390, 3391, 6770, 8798].includes(row.road)), '--all restores off-street rows');
  assert.deepEqual([allTotal.segments, allTotal.lanes, allTotal.length], [56, 52, 577]);
});

test('a station profile shifts the Głogowska 4257 lane smoothly across the bend', () => {
  const { network } = buildWorld({ noPeds: true });
  const edge = network.edges.find((e) => Math.hypot(e.sx + 2987, e.sz - 2474.8) < 2);
  assert.ok(edge && edge.laneShift, 'edge 4581 carries a station profile');
  const max = Math.max(...edge.laneShift.map((p) => Math.abs(p.d)));
  assert.ok(max > 2.3, `${max.toFixed(2)} m clears the opposing track`);
  const previous = network.edges.find((e) => Math.hypot(e.sx + 3022.1, e.sz - 2519.3) < 2);
  assert.ok(previous && previous.laneShift, 'the bend neighbour tapers the same shift');
  const join = Math.abs(previous.laneShift[previous.laneShift.length - 1].d - edge.laneShift[0].d);
  assert.ok(join < 0.05, `${join.toFixed(3)} m step at the bend station`);
  for (const e of network.edges) {
    if (!e.laneShift) continue;
    for (const point of e.laneShift) {
      assert.ok(Math.abs(point.d) <= 3, `${e.id} stays within the carriageway`);
    }
  }
});
