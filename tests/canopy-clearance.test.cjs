const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('tram decks clear tall furniture and support contact wires', () => {
  const r = spawnSync(process.execPath, [join(__dirname, '../tools/audit-canopy-clearance.mjs'), '--json'],
    { encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  const hits = data.hits.filter((h) => data.targetCanopies.includes(h.index) &&
    ['led-lamp', 'gas-lamp', 'park-lamp', 'tree', 'tram-pole', 'tram-arm', 'tram-span'].includes(h.kind));
  assert.deepEqual(hits, []);
  assert.ok(data.targetCanopies.includes(8), 'the overlapping western loop roof is selected');
  assert.ok(data.hangers.length > 8, 'deck hangers replace overhead supports');
  for (const canopy of [7, 8, 9]) {
    assert.ok(data.hangers.some((h) => h.canopy === canopy), `canopy ${canopy} has wire hangers`);
  }
  assert.ok(data.hangers.every((h) => h.top > 5.8 && h.top <= 6.1));
  assert.deepEqual(data.missingSignalSupports, []);
});
