const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('full-scene span stays clear viaducts and facades with separated anchors', { timeout: 180000 }, () => {
  const out = execFileSync(process.execPath, [join(__dirname, '../tools/audit-signal-spans.mjs'), '--json'],
    { encoding: 'utf8', timeout: 170000 });
  const { summary, rows } = JSON.parse(out);
  assert.ok(rows.length > 0);
  assert.equal(summary.railEnvelopeStays, 0);
  assert.equal(summary.nearCollinear, 0);
  assert.equal(summary.facadeHits, 0);
  assert.deepEqual(summary.unplaced, []);
});
