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
  assert.deepEqual(before.summary.counts, { A: 17, B: 27, C: 113, D: 10 });
  assert.deepEqual(after.summary.counts, { A: 47, B: 0, C: 110, D: 10 });
  assert.equal(before.summary.vehicleHeads, 903);
  assert.equal(after.summary.vehicleHeads, 933);
  assert.equal(after.summary.pedestrianHeads, 1572);
  assert.equal(after.summary.runtimePoles, 24);
  assert.equal(after.summary.reusedPoles, 6);
  const placements = after.summary.placements.map((row) => row.map((v) =>
    typeof v === 'number' ? Number(v.toFixed(3)) : v));
  assert.equal(createHash('sha256').update(JSON.stringify(placements)).digest('hex'),
    '767ab9fa897ac165e4b84b7a3919a0b61c0311bd90508384549919edae0ee748');
  for (const [x, z] of [[1374.2, 566.1], [-2086.95, 2421.3]]) {
    assert.ok(before.rows.some((r) => Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01 && r.class === 'B'));
    assert.ok(after.rows.some((r) => Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01 && r.class === 'A'));
  }
  assert.ok(after.rows.filter((row) => row.class === 'A').every((row) => row.along <= 2));
  assert.ok(before.rows.filter((row) => row.class === 'C').every((row) =>
    row.sampleCount === 60 && row.decisive.length && Object.keys(row.reasonCounts).length));
});
