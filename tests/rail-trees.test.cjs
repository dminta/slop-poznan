const test = require('node:test');
const assert = require('node:assert/strict');

test('all tree placers keep trunks and instance-scaled canopy envelopes off mainline ballast', async () => {
  const { runRailTreeAudit } = await import('../tools/audit-rail-trees.mjs');
  const after = await runRailTreeAudit();
  assert.equal(after.halfBed, 2.5, 'use the renderer’s shared 5 m ballast foot');
  assert.ok(after.trees > 100000, 'audit the full furnished world');
  assert.ok(after.niskaTrees > 50, 'retain trees in the reported neighbourhood');
  assert.equal(after.count, 0, 'no trunk or crown envelope reaches a mainline corridor');
  assert.equal(after.renderedCount, 0, 'no trunk or crown envelope reaches rendered ballast');
  assert.equal(after.renderedTrunkCount, 0, 'no square trunk collider intersects a rendered bed');
  assert.equal(after.niskaCount, 0, 'Niska is clear');
  const before = await runRailTreeAudit({ before: true });
  assert.ok(before.niskaCount >= 20, 'the same audit catches the reported Niska row before the fix');
  assert.ok(before.renderedNiskaCount >= 15, 'Niska overlaps include actual rendered beds');
  assert.ok(before.bySource.osm.canopy > 0, 'mapped trees are audited too');
  assert.ok(before.bySource['park sites'].canopy > 0, 'park trees are audited too');
  assert.ok(before.bySource['street trees wide'].trunk > 0, 'catch the pre-fix conservative trunk envelope case');
});
