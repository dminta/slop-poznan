const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');
const { createHash } = require('node:crypto');

function audit(...args) {
  const output = execFileSync(process.execPath, [join(__dirname, '../tools/audit-signal-heads.mjs'), ...args],
    { encoding: 'utf8', timeout: 180000 });
  const rows = output.trim().split('\n').map((line) => JSON.parse(line));
  return { summary: rows.pop(), rows };
}

test('the furnished audit classifies historical approaches before and after runtime placement', () => {
  const before = audit('--before'), after = audit();
  assert.equal(before.rows.length, 167);
  assert.equal(after.rows.length, 167);
  assert.deepEqual(before.summary.counts, { A: 17, B: 74, C: 66, D: 10 });
  assert.deepEqual(after.summary.counts, { A: 117, B: 0, C: 40, D: 10 });
  assert.equal(before.summary.vehicleHeads, 903);
  assert.equal(after.summary.vehicleHeads, 1004);
  assert.equal(after.summary.pedestrianHeads, 1572);
  assert.equal(after.summary.runtimePoles, 81);
  assert.equal(after.summary.reusedPoles, 20);
  assert.equal(after.summary.overheadHeads, 26);
  assert.equal(after.summary.overheadPoles, 12);
  assert.equal(after.summary.overheadReused, 14);
  assert.equal(after.summary.overheadStrict, 10);
  assert.equal(after.summary.overheadBand, 11);
  assert.equal(after.summary.overheadException, 15);
  assert.deepEqual(after.summary.overheadFallbackAlong,
    [1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 0.031, 1.75, 1.75, -0.816, 1.75, 1.75, 1.75, 1.75]);
  assert.ok(after.summary.overheadFootRailMin >= 3.1, 'mast feet keep 0.5 m from a 2.6 m mast setback');
  assert.ok(after.summary.overheadArmRailMin >= 2.22, 'every sampled arm and head keeps 2.22 m from rails');
  assert.ok(after.summary.overheadFallbackSupportMin > 12 && after.summary.overheadFallbackSupportMin < 13,
    'the closest fallback support misses the 12 m arm');
  const placements = after.summary.placements.map((row) => row.map((v) =>
    typeof v === 'number' ? Number(v.toFixed(3)) : v));
  assert.equal(createHash('sha256').update(JSON.stringify(placements)).digest('hex'),
    '636398ec0efe2462b097f78fae04d5c51391ae81996189916e66c8b2ade48976');
  for (const [x, z] of [[1374.2, 566.1], [-2086.95, 2421.3]]) {
    assert.ok(before.rows.some((r) => Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01 && r.class === 'B'));
    assert.ok(after.rows.some((r) => Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01 && r.class === 'A'));
  }
  assert.ok(after.rows.filter((row) => row.class === 'A').every((row) =>
    row.along <= 2 && Math.abs(row.lateral) <= 15));
  for (const [stage, report] of [['before', before], ['after', after]]) {
    for (const row of report.rows.filter((r) => r.class === 'A')) {
      assert.ok(row.head, `A row without a head at ${row.node} (${stage})`);
      assert.equal(row.group0 !== row.swap, row.axis0,
        `A head has the wrong arm group at ${row.node} (${stage})`);
    }
  }
  assert.ok(before.rows.filter((row) => row.class === 'C').every((row) =>
    row.sampleCount === 300 && row.decisive.length && Object.keys(row.reasonCounts).length));
});
