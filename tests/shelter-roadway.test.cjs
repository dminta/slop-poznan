const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

// The shelter placement (js/tram-infra.js) must keep every rendered roof/advert footprint off the carriageway,
// out of the tram keep-out and, on a mixed sidewalk/platform, on the sidewalk. tools/audit-shelter-roadway.mjs is
// the same predicate; before the 2026-11-12 fix it found 30 shelters, led by Rondo Rataje (2.47 m into the roadway).
function audit(...args) {
  const output = execFileSync(process.execPath, [join(__dirname, '../tools/audit-shelter-roadway.mjs'), '--json', ...args],
    { encoding: 'utf8', timeout: 180000 });
  return JSON.parse(output);
}

test('no tram shelter footprint overlaps the carriageway', () => {
  const report = audit();
  assert.equal(report.label, 'after');
  assert.equal(report.stops, 232);
  assert.equal(report.shelters, 218);
  assert.equal(report.overlaps, 0, JSON.stringify(report.rows));
  assert.equal(report.moved, 20);
  assert.equal(report.dropped, 10);
  assert.ok(report.movedShelters.some((s) => s.name === 'Rondo Rataje'), 'the Rataje shelter was moved');
  assert.ok(!report.droppedShelters.some((s) => s.name === 'Rondo Rataje'), 'the Rataje stop keeps a shelter');
});
