const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');

test('every emitted city-grid surface clears tram corridors, preserving every untouched record', async () => {
  const { audit } = await import('../tools/audit-tram-bed-surfaces.mjs');
  const before = await audit(resolve(__dirname, '..'), true);
  const after = await audit(resolve(__dirname, '..'));
  assert.equal(before.summary.overlaps, 1440, 'renderer-triangulated city-wide baseline');
  assert.equal(before.summary.junctionOverlaps, 14, 'the reported junction is covered by the baseline audit');
  assert.equal(after.summary.overlaps, 0, 'no emitted piece intersects a tram clearance quad city-wide');
  assert.equal(after.summary.junctionOverlaps, 0, 'Pułaskiego / Grudzieniec stays clear');
  assert.equal(after.rows.length, before.rows.length);
  let changed = 0;
  for (let i = 0; i < before.rows.length; i++) {
    const a = before.rows[i], b = after.rows[i];
    assert.equal(a.input, b.input, `surface input ${i} stays identical`);
    if (a.output !== b.output) {
      assert.ok(a.touch, `only track-touching surface ${i} changes`);
      changed++;
    }
  }
  assert.equal(changed, 1440);
  const lawns = after.rows.filter((r) => r.local && r.kind === 'park lawn');
  assert.ok(lawns.some((r) => r.touch && r.areaAfter > 1000), 'junction lawn remains after its track-edge cut');
  assert.ok(after.rows.some((r) => r.local && r.kind === 'sidewalk' && r.touch && r.areaAfter > 5),
    'junction sidewalks retain surface beside the track');
});
