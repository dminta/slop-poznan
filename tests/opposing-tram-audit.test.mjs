import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
  assert.ok(!rows.some((row) => [3096, 3097, 3098].includes(row.road)), 'off-street tracks are not body-overlap rows');
  const total = JSON.parse(result.stderr.trim());
  assert.equal(total.segments, rows.length);
  assert.equal(total.lanes, new Set(rows.map((row) => `${row.road}:${row.lane}`)).size);
  assert.ok(total.lanes <= 45 && total.length <= 420,
    `${total.lanes} lanes / ${total.length} m remain: only used street tracks`);
  assert.deepEqual([total.skipped.segments, total.skipped.lanes, total.skipped.length], [14, 12, 200],
    'unused and off-street tracks are counted separately, not hidden');

  const all = spawnSync(process.execPath, [audit, '--all'], { encoding: 'utf8' });
  assert.equal(all.status, 0, all.stderr);
  const allRows = all.stdout.trim().split('\n').map(JSON.parse);
  const allTotal = JSON.parse(all.stderr.trim());
  assert.equal(allRows.length, total.segments + total.skipped.segments);
  assert.ok(allRows.some((row) => [3096, 3097, 3098].includes(row.road)), '--all restores off-street rows');
  assert.deepEqual([allTotal.segments, allTotal.lanes, allTotal.length], [61, 57, 617]);
});
