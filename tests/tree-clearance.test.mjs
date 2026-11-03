import assert from 'node:assert/strict';
import test from 'node:test';
import { runAudit } from '../tools/audit-tree-clearance.mjs';

test('tree clearance audit: zero trunks inside colliders and zero crown-wall overlaps', { timeout: 120000 }, async () => {
  const result = await runAudit();
  assert.equal(result.citySummary.inside, 0, 'zero trunks inside building/landmark/bridge colliders');
  assert.equal(result.citySummary.crownIntersects, 0, 'zero crown-wall overlaps under clearance rule');
});
