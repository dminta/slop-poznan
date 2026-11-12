const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

// The shelter placement (js/tram-infra.js) must keep every rendered roof/advert footprint entirely on raised ground
// (a platform piece or a sidewalk block), out of the tram/car keep-outs and off every catenary pole.
// tools/audit-shelter-roadway.mjs is the same predicate; on the `23c5a05` layout before this raised-ground fix it found
// 17 shelters (4 over asphalt, 13 with a pole through the roof), including the Rondo Kaponiera roof corner at
// (-1455.6, 4.1).
function audit(...args) {
  const r = spawnSync(process.execPath, [join(__dirname, '../tools/audit-shelter-roadway.mjs'), '--json', ...args],
    { encoding: 'utf8', timeout: 180000 });
  if (!r.stdout) throw new Error(r.stderr || `audit exited ${r.status}`);
  return JSON.parse(r.stdout);
}

let cached;
const report = () => (cached ??= audit());

test('no tram shelter footprint leaves raised ground', () => {
  const r = report();
  assert.equal(r.label, 'after');
  assert.equal(r.stops, 232);
  assert.equal(r.shelters, 225);
  assert.equal(r.overlaps, 0, JSON.stringify(r.rows));
  assert.equal(r.raisedOverlaps, 0, JSON.stringify(r.raisedShelters));
  assert.equal(r.poleOverlaps, 0, JSON.stringify(r.poleShelters));
  assert.equal(r.moved, 38);
  assert.equal(r.dropped, 3);
  assert.deepEqual(r.droppedShelters.map((s) => s.name).sort(), ['AWF', 'Gwarna', 'Sołacz']);
});

test('the Rondo Kaponiera shelters move off the roadway and the pole', () => {
  const r = report();
  const kaponiera = r.movedShelters.filter((s) => s.name === 'Rondo Kaponiera');
  assert.ok(kaponiera.some((s) => Math.abs(s.x + 1455.6) < 0.2 && Math.abs(s.z - 4.1) < 0.2),
    'the north island shelter moves off its 8 cm roadway overhang');
  assert.ok(kaponiera.some((s) => Math.abs(s.x + 1443.5) < 0.2 && Math.abs(s.z + 28.4) < 0.2),
    'the north pole shelter moves off its catenary pole');
  assert.ok(!r.droppedShelters.some((s) => s.name === 'Rondo Kaponiera'), 'Rondo Kaponiera keeps its shelters');
});

test('the raised-ground predicate catches the pre-fix Kaponiera overhang', () => {
  const before = audit('--before');
  assert.ok(before.raisedShelters.some((s) => s.name === 'Rondo Kaponiera' && Math.abs(s.shelter[0] + 1458.3) < 1));
  assert.ok(before.poleShelters.some((s) => s.name === 'Rondo Kaponiera' && Math.abs(s.x + 1443.5) < 1));
});
