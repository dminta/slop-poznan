const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('no placed prop, lamp, tree, pit, sign, pole or machine intrudes on any tram shelter or its open front', () => {
  const r = spawnSync(process.execPath, [join(__dirname, '../tools/audit-shelter-clearance.mjs'), '--json'],
    { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) throw new Error(r.stdout || r.stderr || `audit exited ${r.status}`);
  const data = JSON.parse(r.stdout);
  assert.equal(data.shelters, 224);
  assert.equal(data.affectedShelters, 0, JSON.stringify(data.hits));
  assert.equal(data.furnitureHits.length, 0, JSON.stringify(data.furnitureHits));
  assert.equal(data.strictAffectedShelters, 1);
  assert.deepEqual(data.strictPoleHits.map((p) => p.name), ['Rondo Rataje']);
  assert.deepEqual(data.byZone, { footprint: 0, margin: 0, access: 0 });
  assert.deepEqual(data.byKind, {});
});
