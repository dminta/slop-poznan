import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const audit = fileURLToPath(new URL('../tools/audit-tram-opposing-lanes.mjs', import.meta.url));

test('opposing-lane audit lists close runs and excludes the corrected long lane', () => {
  const result = spawnSync(process.execPath, [audit], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split('\n').map(JSON.parse);
  assert.ok(rows.length > 0, 'the known remaining close runs stay visible');
  assert.ok(rows.every((row) => row.length >= 5 && row.minimum < 2.3));
  assert.ok(!rows.some((row) => row.road === 7500 && row.track === 275), 'the corrected lane clears that track');
  const total = JSON.parse(result.stderr.trim());
  assert.equal(total.segments, rows.length);
  assert.equal(total.lanes, new Set(rows.map((row) => `${row.road}:${row.lane}`)).size);
});
